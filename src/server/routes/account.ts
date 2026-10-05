/**
 * W6-B — **My account**: the purchase wizard's API (`/api/account`).
 *
 * The prototype's `#acct-overlay` captures who is buying (Account · Org type ·
 * Org details), sells a plan (fixed/credit packs for an individual, an annual
 * plan for an organisation), takes a payment method and prints a receipt with an
 * invoice. This router is the server half of that flow:
 *
 *   GET  /                      the saved profile (or a prefill), recent orders
 *   PUT  /profile               the Account + Org details screens
 *   POST /orders                Payment → records an intent, charges nothing
 *   GET  /orders/:id            the receipt
 *   GET  /orders/:id/document   "Download invoice" — a PRO-FORMA, see below
 *
 * The catalogue it prices against is the PUBLISHED one (`pricing_versions`),
 * never `0033`'s draft tables: a draft edit an administrator has not published
 * must not be what a customer is charged. The money is `quoteOrder` →
 * `priceBreakdown` (`src/shared/accountOrder.ts` → `src/shared/plans.ts`); there
 * is no arithmetic in this file.
 *
 * **§1.2 — card data never reaches this application.** No route here reads a
 * card number, CVV, expiry, UPI ID or bank credential; `paymentMethod` is only
 * the category the provider's hosted page should open on. A body carrying a
 * card-shaped key is simply never read, and a worker test posts one to prove it.
 *
 * **§1.3 — provider-stubbed.** An order goes through `W4-C`'s
 * `recordPaymentIntent`, so on every build today it lands `status='recorded'`,
 * grants no credits, activates no plan, and says so in the payload. Because no
 * payment has been taken, "Download invoice" produces a **pro-forma invoice**
 * that states it is not a tax invoice: issuing a GST tax invoice for money that
 * was never received would be the one document this flow must not produce.
 */
import { Hono } from "hono";
import type { AppEnv, Env } from "../types";
import { requireAuth, requireTask } from "../auth/middleware";
// T1-COMMERCE — T0-SCHEMA's one scope helper. A workspace is `(tenant_id, edition)`
// and `scopeOf()` reads both halves off the session, never off the request.
import { scopeOf, scoped, insertScope, type TenantScope } from "../../shared/tenant";
import { recordAudit } from "../audit/log";
import { recordPaymentIntent, paymentConfigured, type IntentPurpose } from "../billing/provider";
import {
  billingCurrencyFor,
  formatMinor,
  resolveBillingLocale,
  validateBillingAddress,
  GST_DEFAULT_RATE_PCT,
  type BillingAddress,
  type BillingFieldErrors,
  type BillingLocale,
  type TaxSettings,
} from "../../shared/plans";
import type { PriceBook, PublishedPriceBook } from "../../shared/priceBook";
import {
  billingCycleLine,
  isPaymentMethod,
  orderStatusLabel,
  quoteOrder,
  taxSettingsOf,
  validateAccountFields,
  validateOrgDetails,
  type AccountOrderView,
  type AccountProfile,
  type AccountType,
  type OrgDetails,
} from "../../shared/accountOrder";

const account = new Hono<AppEnv>();
account.use("*", requireAuth);
// Buying is the `upgrade` task ("Purchase/Upgrade plan") — the same gate the nav
// puts on Buy credits and `config.ts` puts on every credit route, so revoking
// that one cell closes the wizard's screen and its API together (§8 Q16).
account.use("*", requireTask("upgrade", "admin"));

// ── Reading ──────────────────────────────────────────────────────────────────

interface ProfileRow {
  account_type: AccountType;
  work_email: string;
  first_name: string;
  last_name: string;
  phone_dial: string | null;
  phone: string | null;
  designation: string | null;
  organization_name: string | null;
  org_kind: "incubator" | "investor" | null;
  org_name: string | null;
  business_type: string | null;
  employees: string | null;
  associates: number | null;
  city: string | null;
  country: string | null;
  contact_name: string | null;
  contact_designation: string | null;
  contact_dial: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  // V6-CURRENCY · `0104`. Distinct from `city`/`country` above, which are the Org
  // details screen's fields — see `0104`'s header for why they are not reused.
  billing_name: string | null;
  billing_city: string | null;
  billing_country: string | null;
  billing_address: string | null;
}

function toProfile(r: ProfileRow): AccountProfile {
  const org: OrgDetails | null =
    r.org_kind && r.org_name
      ? {
          kind: r.org_kind,
          name: r.org_name,
          businessType: r.business_type,
          employees: r.employees,
          associates: r.associates,
          city: r.city,
          country: r.country,
          contactName: r.contact_name ?? "",
          designation: r.contact_designation,
          dialCode: r.contact_dial,
          phone: r.contact_phone,
          email: r.contact_email ?? "",
        }
      : null;
  return {
    accountType: r.account_type,
    workEmail: r.work_email,
    firstName: r.first_name,
    lastName: r.last_name,
    dialCode: r.phone_dial,
    phone: r.phone,
    designation: r.designation,
    organizationName: r.organization_name,
    org,
  };
}

/**
 * The billing address, or null when the V6 billing screen has not been filled.
 *
 * All-or-nothing on purpose: `validateBillingAddress` requires all four fields,
 * so a row either has a complete billing address or has none. A half-filled one
 * cannot be written through this router, and reporting a partial object would
 * invite a caller to resolve a currency from a country it had not checked.
 */
function toBilling(r: ProfileRow): BillingAddress | null {
  if (!r.billing_name || !r.billing_city || !r.billing_country || !r.billing_address) return null;
  return {
    name: r.billing_name,
    city: r.billing_city,
    country: r.billing_country,
    address: r.billing_address,
  };
}

/**
 * One workspace's commercial record: the profile the wizard's screens write,
 * plus the billing address `0104` added.
 *
 * `AccountProfile` lives in `src/shared/accountOrder.ts`, which this wave does
 * not own, so the billing address travels BESIDE it rather than inside it — and
 * that turns out to be the better shape anyway: the API serves `billing` as its
 * own object with the resolved currency attached, so no consumer has to know
 * that a country means a currency.
 */
interface AccountRecord {
  profile: AccountProfile;
  billing: BillingAddress | null;
}

/**
 * The commercial record for one workspace.
 *
 * ── THE PLAN CORRECTION THAT LANDS HERE ────────────────────────────────────
 * §5c said `account_profiles` "should be keyed by `tenant_id` ALONE — they are the
 * commercial record". `0094` could not apply that reading: a read-only check of the
 * deployed database found `incubator 1, vc 1` — the one existing customer holds TWO
 * commercial records, one per workspace — so a `PRIMARY KEY (tenant_id)` gives two
 * backfilled rows one key and the restoring INSERT dies on a UNIQUE violation. The
 * table is `(tenant_id, edition)`, and `0094` notes this is the `0038` shape: the
 * table is EMPTY in the seed and in every test database, so a `tenant_id`-only key
 * would have been green on `npm test` and failed mid-chain on the production apply.
 *
 * So the scope here carries BOTH columns — `.on()`, not `.onTenantOnly()`. The
 * helper's own `onTenantOnly` doc says the same thing and cites this migration.
 */
async function readProfile(env: Env, scope: TenantScope): Promise<AccountRecord | null> {
  const q = scoped(scope).on("p");
  const row = await env.DB.prepare(`SELECT p.* FROM account_profiles p ${q.whereClause()}`)
    .bind(...q.binds)
    .first<ProfileRow>();
  return row ? { profile: toProfile(row), billing: toBilling(row) } : null;
}

/**
 * The signed-in user's own details, so the Account screen opens filled in.
 *
 * Scoped even though `userId` is always the caller's own id: `users.id` is globally
 * unique, so this cannot cross today — but an unscoped `WHERE id = ?` on `users` is
 * the exact shape that becomes a leak the moment a caller passes an id it did not
 * get from its own session, and the predicate costs one bind.
 */
async function prefill(env: Env, scope: TenantScope, userId: string): Promise<AccountProfile> {
  const q = scoped(scope).on("u").and("u.id = ?", userId);
  const row = await env.DB.prepare(`SELECT u.email, u.name, u.title FROM users u ${q.whereClause()}`)
    .bind(...q.binds)
    .first<{ email: string; name: string; title: string | null }>();
  const [first, ...rest] = (row?.name ?? "").trim().split(/\s+/);
  return {
    accountType: "individual",
    workEmail: row?.email ?? "",
    firstName: first ?? "",
    lastName: rest.join(" "),
    dialCode: "+91",
    phone: null,
    designation: row?.title ?? null,
    organizationName: null,
    org: null,
  };
}

/**
 * The live catalogue. `src/server/routes/pricing.ts` has the same three lines as
 * a private `livePublished`; it is `W4-D`'s file and does not export it, so the
 * read is repeated here rather than edited there (§9 records the one-word export
 * that would remove this copy).
 *
 * **DELIBERATELY UNSCOPED, and it must stay that way.** `pricing_versions` is one
 * of §3's eight PLATFORM-GLOBAL tables: one catalogue serves the whole product,
 * `CREATE UNIQUE INDEX pricing_versions_one_published ON pricing_versions (status)
 * WHERE status = 'published'` enforces exactly one live book product-wide, and
 * `0100`'s integrity assertion fails the migration chain if a sweep "finishes the
 * job" by scoping these. §2 A6 names this read as a leak; the leak is the GATE on
 * the write side (closed by `pricing-owner.test.ts`), not the absence of a tenant
 * key on the read.
 */
async function publishedBook(env: Env): Promise<PublishedPriceBook | null> {
  const row = await env.DB.prepare(
    "SELECT version, document, published_at FROM pricing_versions WHERE status = 'published'",
  ).first<{ version: number; document: string; published_at: string }>();
  if (!row) return null;
  const book = JSON.parse(row.document) as PriceBook;
  return { ...book, version: row.version, publishedAt: row.published_at };
}

interface OrderRow {
  id: string;
  plan_code: string | null;
  plan_name: string;
  units: number | null;
  currency: string;
  subtotal_minor: number;
  tax_minor: number;
  total_minor: number;
  gst_rate_pct: number;
  status: AccountOrderView["status"];
  checkout_url: string | null;
  created_at: string;
  plan_group: AccountOrderView["group"];
  period: AccountOrderView["period"];
  period_months: number | null;
  payment_method: AccountOrderView["paymentMethod"];
  account_type: AccountType;
  taxed: number;
}

/**
 * An order IS its intent — `account_orders.intent_id` is both its primary key and
 * its foreign key — so the JOIN also matches the workspace. Both tables carry
 * `tenant_id`, the condition is column-to-column and binds nothing, and an
 * `intent_id` that ever drifted across customers would otherwise put another
 * customer's plan name, amount and payment status on this receipt.
 */
const ORDER_SELECT =
  "SELECT i.id, i.plan_code, i.plan_name, i.units, i.currency, i.subtotal_minor, i.tax_minor, " +
  "i.total_minor, i.gst_rate_pct, i.status, i.checkout_url, i.created_at, o.plan_group, o.period, " +
  "o.period_months, o.payment_method, o.account_type, o.taxed " +
  "FROM account_orders o JOIN billing_payment_intents i " +
  "ON i.id = o.intent_id AND i.tenant_id = o.tenant_id AND i.edition = o.edition ";

function toOrder(r: OrderRow): AccountOrderView {
  return {
    id: r.id,
    planCode: r.plan_code,
    planName: r.plan_name,
    group: r.plan_group,
    period: r.period,
    periodMonths: r.period_months,
    units: r.units,
    currency: r.currency,
    subtotalMinor: r.subtotal_minor,
    taxMinor: r.tax_minor,
    totalMinor: r.total_minor,
    ratePct: r.gst_rate_pct,
    taxed: r.taxed === 1,
    status: r.status,
    checkoutUrl: r.checkout_url,
    paymentMethod: r.payment_method,
    accountType: r.account_type,
    createdAt: r.created_at,
  };
}

async function loadOrder(
  env: Env,
  scope: TenantScope,
  id: string,
): Promise<AccountOrderView | null> {
  const q = scoped(scope).on("o").and("o.intent_id = ?", id);
  const row = await env.DB.prepare(`${ORDER_SELECT}${q.whereClause()}`)
    .bind(...q.binds)
    .first<OrderRow>();
  return row ? toOrder(row) : null;
}

/**
 * The tax settings a billing locale is resolved against.
 *
 * The published catalogue is the authority (`pricing_settings.gst_rate_pct` via
 * `taxSettingsOf`). The fallback is **not a second GST rate**: it reuses
 * `GST_DEFAULT_RATE_PCT`, the one default `plans.ts` declares and
 * `test/unit/pricing-seam.test.ts` already pins, and it is reachable only when
 * nothing is published — a state in which there is no price to tax, so the rate
 * only ever labels an empty screen. Inventing an `18` here is the mistake this
 * lane exists to avoid.
 */
function taxOf(book: PublishedPriceBook | null): TaxSettings {
  if (book) return taxSettingsOf(book.tax);
  return {
    ratePct: GST_DEFAULT_RATE_PCT,
    registration: null,
    inclusive: false,
    internationalNotice: true,
  };
}

/**
 * The billing block every consumer reads — the four captured fields plus the
 * ONE resolved answer about currency and tax.
 *
 * The resolution happens here, on the server, and is served rather than
 * recomputed: §4 of the lane brief — "the country driving the currency on read
 * so every consumer gets one answer". A screen that re-derives it from the
 * country is free to, because `resolveBillingLocale` is shared, but it does not
 * have to.
 */
function billingPayload(
  billing: BillingAddress | null,
  book: PublishedPriceBook | null,
): BillingAddressPayload {
  return {
    name: billing?.name ?? null,
    city: billing?.city ?? null,
    country: billing?.country ?? null,
    address: billing?.address ?? null,
    locale: resolveBillingLocale(billing?.country ?? null, taxOf(book)),
  };
}

interface BillingAddressPayload {
  name: string | null;
  city: string | null;
  country: string | null;
  address: string | null;
  locale: BillingLocale;
}

account.get("/", async (c) => {
  const { id } = c.var.user;
  // §2 B18 measured this route as leaking order history and receipts across
  // customers. The MARKER that reaches it is `billing_payment_intents.plan_name`
  // one hop away: `account_orders` carries no free-text column of its own, so the
  // order's identity is its intent's.
  const scope = scopeOf(c.var.user);
  const saved = await readProfile(c.env, scope);
  const listQ = scoped(scope).on("o");
  const orders = await c.env.DB.prepare(
    `${ORDER_SELECT}${listQ.whereClause()} ORDER BY o.created_at DESC, o.rowid DESC LIMIT 5`,
  )
    .bind(...listQ.binds)
    .all<OrderRow>();
  return c.json({
    profile: saved?.profile ?? (await prefill(c.env, scope, id)),
    saved: saved !== null,
    // V6-CURRENCY. Always present, even unsaved: `locale.currency` is then null,
    // which is the screens' cue that the billing step has not been taken. It is
    // NOT a currency default — see `0104`'s header on the two production rows.
    billing: billingPayload(saved?.billing ?? null, await publishedBook(c.env)),
    orders: (orders.results ?? []).map(toOrder),
    paymentConfigured: paymentConfigured(c.env),
  });
});

// ── PUT /profile — the Account and Org details screens ───────────────────────

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * V6-CURRENCY — the billing address, validated and written.
 *
 * Returns the field errors when the body is not a complete address, so both
 * verbs refuse identically. Writing is a plain scoped `UPDATE` rather than a
 * fifth column list bolted onto the two upserts above: the row is already there
 * by the time this runs (PUT has just upserted it, PATCH has just checked it),
 * and those two upserts carry the load-bearing `ON CONFLICT (tenant_id,
 * edition)` commentary that should not be re-threaded for four nullable columns.
 */
async function writeBilling(
  env: Env,
  scope: TenantScope,
  actorId: string,
  body: Record<string, unknown>,
): Promise<BillingFieldErrors | null> {
  const candidate = {
    name: body.name,
    city: body.city,
    country: body.country,
    address: body.address,
  };
  const errors = validateBillingAddress(candidate);
  if (Object.keys(errors).length > 0) return errors;
  const q = scoped(scope).on("account_profiles");
  await env.DB.prepare(
    "UPDATE account_profiles SET billing_name = ?, billing_city = ?, billing_country = ?, " +
      `billing_address = ?, updated_by = ?, updated_at = datetime('now') ${q.whereClause()}`,
  )
    .bind(
      text(candidate.name),
      text(candidate.city),
      text(candidate.country),
      text(candidate.address),
      actorId,
      ...q.binds,
    )
    .run();
  return null;
}

account.put("/profile", async (c) => {
  const { id } = c.var.user;
  const scope = scopeOf(c.var.user);
  const body = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;

  const errors = validateAccountFields({
    accountType: body.accountType,
    workEmail: body.workEmail,
    firstName: body.firstName,
    lastName: body.lastName,
    dialCode: text(body.dialCode),
    phone: body.phone,
    designation: body.designation,
    organizationName: body.organizationName,
  });
  if (Object.keys(errors).length > 0) return c.json({ error: "invalid_profile", fields: errors }, 400);
  const accountType = body.accountType as AccountType;

  const orgBody =
    body.org && typeof body.org === "object" ? (body.org as Record<string, unknown>) : null;
  // An organisation account is not saved until its organisation is (`0053`
  // CHECKs it): the prototype's "Create account" button is on Org details.
  if (accountType === "organization" && !orgBody) {
    return c.json({ error: "org_details_required" }, 400);
  }
  if (orgBody) {
    const orgErrors = validateOrgDetails(orgBody);
    if (Object.keys(orgErrors).length > 0) {
      return c.json({ error: "invalid_org_details", fields: orgErrors }, 400);
    }
  }

  // V6-CURRENCY — a full save MAY carry the billing address, and an omitted
  // `billing` key leaves whatever is on file alone. That is the same rule the
  // individual branch already applies to the organisation block below: the
  // wizard saves one screen at a time, so a screen that does not draw a field
  // must not be able to erase it. Validated BEFORE anything is written, so an
  // invalid address does not half-save the profile.
  const billingBody =
    body.billing && typeof body.billing === "object"
      ? (body.billing as Record<string, unknown>)
      : null;
  if (billingBody) {
    const billingErrors = validateBillingAddress({
      name: billingBody.name,
      city: billingBody.city,
      country: billingBody.country,
      address: billingBody.address,
    });
    if (Object.keys(billingErrors).length > 0) {
      return c.json({ error: "invalid_billing_address", fields: billingErrors }, 400);
    }
  }

  const before = await readProfile(c.env, scope);
  // ══ ON CONFLICT 1 AND 2 OF THE 9 THAT BLOCK INTEGRATION ═══════════════════
  //
  // Both upserts below targeted `ON CONFLICT (edition)`, which `0094` left
  // resolvable on purpose — it widened the PRIMARY KEY to `(tenant_id, edition)`
  // and kept the old key as the transitional unique index
  // `account_profiles__pre_tenant_key`, so T0 could merge green.
  //
  // ── WHAT THE OLD TARGET ACTUALLY DOES, MEASURED ───────────────────────────
  // `0094`'s header expects it to fail with "ON CONFLICT clause does not match any
  // PRIMARY KEY or UNIQUE constraint". It does not fail. The transitional index is
  // a matching unique constraint, so the statement runs — and on SQLite 3.51,
  // against this exact shape, a second customer's save is a **cross-tenant
  // destructive overwrite that answers 200**: the handler writes the second
  // customer's organisation name, business type, city, country and the whole
  // contact block into the FIRST customer's row, the row keeps
  // `tenant_id = 't_default'`, no new row appears, and `readProfile` then reads it
  // back and reports success. The commercial record of the customer who was
  // already there is simply gone.
  //
  // Naming the widened key converts that into the loud `UNIQUE constraint failed:
  // account_profiles.edition` that `0094` intended — verified both directions:
  // tenant A's own save still updates in place, tenant B's insert is refused. That
  // refusal is why `account_profiles` stays in `BLOCKED_BY_TRANSITIONAL_KEY`.
  // **The transitional index is NOT dropped here**; 0101-0108 does that once all
  // nine upserts name the widened key.
  const t = insertScope(scope);
  const accountValues = [
    accountType,
    text(body.workEmail)!.toLowerCase(),
    text(body.firstName),
    text(body.lastName),
    text(body.dialCode),
    text(body.phone),
    text(body.designation),
    text(body.organizationName),
  ];

  if (orgBody) {
    const associates =
      orgBody.associates === null || orgBody.associates === undefined || orgBody.associates === ""
        ? null
        : Number(orgBody.associates);
    await c.env.DB.prepare(
      `INSERT INTO account_profiles (${t.columns}, account_type, work_email, first_name, last_name, phone_dial, ` +
        "phone, designation, organization_name, org_kind, org_name, business_type, employees, associates, " +
        "city, country, contact_name, contact_designation, contact_dial, contact_phone, contact_email, " +
        `updated_by, updated_at) VALUES (${t.placeholders}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now')) ` +
        "ON CONFLICT (tenant_id, edition) DO UPDATE SET account_type = excluded.account_type, work_email = excluded.work_email, " +
        "first_name = excluded.first_name, last_name = excluded.last_name, phone_dial = excluded.phone_dial, " +
        "phone = excluded.phone, designation = excluded.designation, organization_name = excluded.organization_name, " +
        "org_kind = excluded.org_kind, org_name = excluded.org_name, business_type = excluded.business_type, " +
        "employees = excluded.employees, associates = excluded.associates, city = excluded.city, " +
        "country = excluded.country, contact_name = excluded.contact_name, " +
        "contact_designation = excluded.contact_designation, contact_dial = excluded.contact_dial, " +
        "contact_phone = excluded.contact_phone, contact_email = excluded.contact_email, " +
        "updated_by = excluded.updated_by, updated_at = excluded.updated_at",
    )
      .bind(
        ...t.binds,
        ...accountValues,
        orgBody.kind,
        text(orgBody.name),
        text(orgBody.businessType),
        text(orgBody.employees),
        associates,
        text(orgBody.city),
        text(orgBody.country),
        text(orgBody.contactName),
        text(orgBody.designation),
        text(orgBody.dialCode),
        text(orgBody.phone),
        text(orgBody.email)?.toLowerCase() ?? null,
        id,
      )
      .run();
  } else {
    // An individual save leaves any organisation details already on file alone:
    // switching the account type back and forth must not throw them away.
    await c.env.DB.prepare(
      `INSERT INTO account_profiles (${t.columns}, account_type, work_email, first_name, last_name, phone_dial, ` +
        "phone, designation, organization_name, updated_by, updated_at) " +
        `VALUES (${t.placeholders}, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now')) ` +
        "ON CONFLICT (tenant_id, edition) DO UPDATE SET account_type = excluded.account_type, work_email = excluded.work_email, " +
        "first_name = excluded.first_name, last_name = excluded.last_name, phone_dial = excluded.phone_dial, " +
        "phone = excluded.phone, designation = excluded.designation, organization_name = excluded.organization_name, " +
        "updated_by = excluded.updated_by, updated_at = excluded.updated_at",
    )
      .bind(...t.binds, ...accountValues, id)
      .run();
  }

  // After the upsert, so the row exists for the UPDATE to find. Already
  // validated above.
  if (billingBody) await writeBilling(c.env, scope, id, billingBody);

  const record = (await readProfile(c.env, scope))!;
  const after = record.profile;
  await recordAudit(c, {
    category: "billing",
    action: before ? "account_profile_updated" : "account_profile_created",
    summary:
      `Account details ${before ? "updated" : "saved"} — ${after.accountType === "organization" ? "Organization" : "Individual"}` +
      (after.accountType === "organization" && after.org ? ` · ${after.org.name}` : ""),
    detail: { accountType: after.accountType },
    targetType: "account_profiles",
    // The row's identity is the PAIR now (`0094`), so `targetId: edition` named a
    // row that two customers would share.
    targetId: `${scope.tenantId}:${scope.edition}`,
  });
  return c.json({
    ok: true,
    profile: after,
    billing: billingPayload(record.billing, await publishedBook(c.env)),
  });
});

// ── PATCH /profile — V6's billing screen, which saves only itself ────────────

/**
 * `#acs-billing` is its own step in both of V6's steppers, reached after the
 * plan and before payment, and it draws four fields and nothing else. Making it
 * re-send the whole Account screen to save them would mean the payment step
 * could fail on a validation error belonging to a screen three steps back — and
 * on a phone, where this flow actually happens, that is a dead end.
 *
 * So the billing screen PATCHes. It **cannot create** a profile: the row carries
 * `work_email NOT NULL` and `0053`'s CHECK that an organisation account names
 * its organisation, so there is no honest way to materialise one from an
 * address. A caller with no profile gets the same `account_required` that
 * `POST /orders` gives, which is the condition the Account screen fixes.
 */
account.patch("/profile", async (c) => {
  const { id } = c.var.user;
  const scope = scopeOf(c.var.user);
  const body = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const billingBody =
    body.billing && typeof body.billing === "object"
      ? (body.billing as Record<string, unknown>)
      : body;

  const existing = await readProfile(c.env, scope);
  if (!existing) return c.json({ error: "account_required" }, 409);

  const errors: BillingFieldErrors | null = await writeBilling(c.env, scope, id, billingBody);
  if (errors) return c.json({ error: "invalid_billing_address", fields: errors }, 400);

  const record = (await readProfile(c.env, scope))!;
  const payload = billingPayload(record.billing, await publishedBook(c.env));
  await recordAudit(c, {
    category: "billing",
    action: "account_billing_address_saved",
    // The currency is the consequence worth auditing: this is the one screen
    // whose four text fields decide what a customer is charged in.
    summary:
      `Billing address saved — ${payload.city}, ${payload.country}` +
      (payload.locale.currency
        ? ` · billed in ${payload.locale.currency}${payload.locale.taxed ? ` with ${payload.locale.ratePct}% GST` : " with no GST"}`
        : ""),
    detail: {
      country: payload.country,
      currency: payload.locale.currency,
      taxed: payload.locale.taxed,
      ratePct: payload.locale.ratePct,
    },
    targetType: "account_profiles",
    targetId: `${scope.tenantId}:${scope.edition}`,
  });
  return c.json({ ok: true, profile: record.profile, billing: payload });
});

// ── POST /orders — records an intent; charges nothing ────────────────────────

const PURPOSE: Record<AccountOrderView["group"], IntentPurpose> = {
  subscription: "subscription",
  credit_pack: "credit_pack",
  enterprise: "enterprise",
};

account.post("/orders", async (c) => {
  const { id: actorId } = c.var.user;
  const scope = scopeOf(c.var.user);
  // Only these three keys are read. Anything else a client sends — a card
  // number, a CVV, a UPI ID — is never touched, logged or stored (§1.2).
  const body = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const planCode = typeof body.planCode === "string" ? body.planCode : "";
  const currency = typeof body.currency === "string" ? body.currency.toUpperCase() : "";
  if (!planCode) return c.json({ error: "plan_required" }, 400);
  if (!/^[A-Z]{3}$/.test(currency)) return c.json({ error: "currency_required" }, 400);
  if (!isPaymentMethod(body.paymentMethod)) return c.json({ error: "payment_method_required" }, 400);
  const paymentMethod = body.paymentMethod;
  // V3-PT — the two quantities a v3 order can carry: a paid-trial pack's deck
  // count and the extra credits taken beside a seat. Both are PRICED HERE from
  // the published catalogue, never from anything the client sent; a client that
  // sends a non-integer is refused rather than coerced.
  const quantity = typeof body.quantity === "number" ? body.quantity : undefined;
  const extraCredits = typeof body.extraCredits === "number" ? body.extraCredits : undefined;

  const record = await readProfile(c.env, scope);
  if (!record) return c.json({ error: "account_required" }, 409);
  const profile = record.profile;

  // ══ V6-CURRENCY · THE INVARIANT ════════════════════════════════════════════
  //
  // **A customer whose billing country is India is never priced in USD.**
  //
  // It is enforced HERE, before a single figure is computed, and not on the
  // screen that shows the total. `currency` arrives in the request body: a
  // client that asked for USD with an Indian billing address would otherwise be
  // obeyed, and `priceBreakdown` would then correctly apply no GST — producing a
  // quote that is internally consistent, looks right, and is wrong. The screens
  // cannot be the guard, because the body is what the server reads.
  //
  // REFUSED, not silently corrected. Re-denominating a purchase under the
  // customer is worse than refusing it: ₹1,178 and $1,178 are not the same
  // money, and the figure the screen last showed would no longer be the figure
  // charged. The refusal names the required currency so the caller can retry
  // with it — the same answer `GET /api/account` serves as `billing.locale`.
  //
  // `null` means NO billing country is on file, and then nothing is enforced:
  // the request is priced exactly as it is today. `0104`'s header states why —
  // the two rows in production predate the billing screen, and guessing their
  // currency in either direction would change what a real customer is billed.
  const requiredCurrency = billingCurrencyFor(record.billing?.country ?? null);
  if (requiredCurrency && currency !== requiredCurrency) {
    return c.json(
      {
        error: "currency_not_for_billing_country",
        required: requiredCurrency,
        requested: currency,
        country: record.billing?.country ?? null,
      },
      400,
    );
  }

  const book = await publishedBook(c.env);
  if (!book) return c.json({ error: "not_published" }, 503);

  const quote = quoteOrder(book, planCode, currency, profile.accountType, { quantity, extraCredits });
  if ("error" in quote) {
    const status = quote.error === "unknown_plan" ? 404 : 400;
    // 400 for every other refusal, including the two V3-PT added: a bad
    // quantity and extras the catalogue cannot price.
    return c.json({ error: quote.error }, status);
  }

  const intent = await recordPaymentIntent(c.env, {
    tenantId: scope.tenantId,
    edition: scope.edition,
    purpose: PURPOSE[quote.group],
    planCode: quote.plan.code,
    planName: quote.plan.name,
    units: quote.unitsTotal,
    quantity: quote.quantity,
    currency: quote.currency,
    money: quote.breakdown,
    actorId,
  });

  // The write side, where the failure is silent: `account_orders.tenant_id` carries
  // `DEFAULT 't_default'` (`0086:31`), so an INSERT that simply omitted the column
  // would answer 200 and file the second customer's order against the first.
  // `insertScope` is what makes the column impossible to forget.
  const orderT = insertScope(scope);
  await c.env.DB.prepare(
    `INSERT INTO account_orders (intent_id, ${orderT.columns}, account_type, plan_group, period, period_months, ` +
      "payment_method, taxed, price_version, created_by, created_at) " +
      `VALUES (?, ${orderT.placeholders}, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      intent.id,
      ...orderT.binds,
      profile.accountType,
      quote.group,
      quote.plan.period,
      quote.plan.periodMonths,
      paymentMethod,
      quote.breakdown.taxed ? 1 : 0,
      book.version,
      actorId,
      intent.createdAt,
    )
    .run();

  const total = formatMinor(quote.breakdown.totalMinor, quote.currency);
  await recordAudit(c, {
    category: "billing",
    action: "account_order_recorded",
    summary:
      `Order recorded from My account — ${quote.plan.name} · ${total}` +
      `${quote.breakdown.taxed ? " incl. GST" : ""} · no payment taken`,
    detail: {
      intentId: intent.id,
      planCode: quote.plan.code,
      currency: quote.currency,
      paymentMethod,
      priceVersion: book.version,
      status: intent.status,
    },
    targetType: "billing_payment_intents",
    targetId: intent.id,
  });

  const order = (await loadOrder(c.env, scope, intent.id))!;
  return c.json({
    ok: true,
    order,
    // The contract, spelled out so no client can misreport it (§1.3).
    completed: false,
    creditsGranted: 0,
    checkout: order.checkoutUrl ? { hosted: true, url: order.checkoutUrl } : { hosted: false, url: null },
    message: order.checkoutUrl
      ? "Continue on the payment provider's secure page to complete this order."
      : "Order recorded. No payment provider is connected, so nothing has been charged and no " +
        "credits have been added — our team will follow up to complete it.",
  });
});

// ── The receipt and its document ─────────────────────────────────────────────

account.get("/orders/:id", async (c) => {
  const order = await loadOrder(c.env, scopeOf(c.var.user), c.req.param("id"));
  if (!order) return c.json({ error: "not_found" }, 404);
  return c.json(order);
});

const escapeHtml = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch,
  );

/**
 * "Download invoice", honestly. A pro-forma invoice is the standard document
 * issued BEFORE payment; it is explicitly not a tax invoice and cannot be used
 * for input tax credit. The GST tax invoice (`billing_invoices`, `W4-C`) is
 * issued from a confirmed payment, which no build today can produce.
 */
account.get("/orders/:id/document", async (c) => {
  const scope = scopeOf(c.var.user);
  const order = await loadOrder(c.env, scope, c.req.param("id"));
  if (!order) return c.json({ error: "not_found" }, 404);
  const record = await readProfile(c.env, scope);
  const profile = record?.profile ?? null;
  const billing = record?.billing ?? null;
  const registration = (await publishedBook(c.env))?.tax.gstRegistration ?? null;

  // V6-CURRENCY — "We use this to ... generate your invoice." The billing name
  // is the one the customer asked to appear on the invoice, so when it is on
  // file it wins over the account holder's own name; the account's email stays,
  // because the billing screen captures no email.
  const billedTo =
    billing && profile
      ? `${billing.name} · ${profile.accountType === "organization" && profile.org ? profile.org.email : profile.workEmail}`
      : profile?.accountType === "organization" && profile.org
        ? `${profile.org.name} · ${profile.org.contactName} · ${profile.org.email}`
        : profile
          ? `${profile.firstName} ${profile.lastName}${profile.organizationName ? ` · ${profile.organizationName}` : ""} · ${profile.workEmail}`
          : "—";
  const amount = (m: number) => escapeHtml(formatMinor(m, order.currency));
  const row = (label: string, value: string) =>
    `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`;
  const number = `PF-${order.id.replace(/^pi_/, "").slice(0, 8).toUpperCase()}`;

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${escapeHtml(number)}</title>
<style>
 body{font:13px/1.5 -apple-system,"Segoe UI",sans-serif;color:#1A1E2E;margin:40px;max-width:640px}
 h1{font-size:18px;margin:0 0 2px} .sub{color:#6B6355;font-size:12px;margin:0 0 24px}
 .flag{display:inline-block;border:1px solid #B87A10;color:#B87A10;border-radius:6px;padding:2px 8px;font-size:11px;font-weight:600;margin-bottom:14px}
 table{border-collapse:collapse;width:100%;margin-bottom:20px}
 th,td{text-align:left;padding:6px 0;border-bottom:1px solid #E8E3D9;vertical-align:top}
 th{font-weight:600;color:#6B6355;width:200px}
 .tot td,.tot th{border-bottom:none;font-weight:700;font-size:15px}
 .note{color:#6B6355;font-size:11.5px;border-top:1px solid #E8E3D9;padding-top:12px}
 /* MOBILE-FIRST, standing client instruction. This document is opened on a
    phone — it is the thing a customer taps "Download invoice" for — and the
    billing address added above is the longest value on it. A 200px label column
    beside it at 390px leaves 110px for a street address. So below 480px the
    label/value pairs STACK: no fixed width, no min-width, and a 16px gutter
    instead of 40px. Nothing here can overflow horizontally, because the only
    table is label/value and it no longer has a column that insists on a size. */
 @media (max-width:480px){
  body{margin:16px}
  th,td{display:block;width:auto;padding:2px 0}
  th{border-bottom:none}
  td{border-bottom:1px solid #E8E3D9;padding-bottom:8px}
  .tot td{border-bottom:none}
 }
</style></head><body>
<h1>Pro-forma invoice ${escapeHtml(number)}</h1>
<p class="sub">ai.STARTUPJURY${registration ? ` · GSTIN ${escapeHtml(registration)}` : ""}</p>
<div class="flag">NOT A TAX INVOICE · NO PAYMENT RECEIVED</div>
<table>
${row("Issued", order.createdAt.slice(0, 10))}
${row("Reference", order.id)}
${row("Billed to", billedTo)}
${billing ? row("Billing address", `${billing.address}, ${billing.city}, ${billing.country}`) : ""}
${row("Plan", order.planName)}
${order.units !== null ? row("Credits", String(order.units)) : ""}
${row("Billing cycle", billingCycleLine(order.period, order.periodMonths))}
${row("Status", orderStatusLabel(order.status))}
<tr><th>Subtotal</th><td>${amount(order.subtotalMinor)}</td></tr>
${order.taxed ? `<tr><th>GST (${escapeHtml(String(order.ratePct))}%)</th><td>${amount(order.taxMinor)}</td></tr>` : ""}
<tr class="tot"><th>${order.taxed ? "Total (incl. GST)" : "Total"}</th><td>${amount(order.totalMinor)}</td></tr>
</table>
<p class="note">This pro-forma records an order; no payment has been taken and it cannot be used to
claim input tax credit. ${
    order.taxed
      ? "A GST-compliant tax invoice is issued once payment is confirmed."
      : "Prices are shown exclusive of local taxes; the customer is responsible for any VAT/GST due in their jurisdiction."
  }</p>
</body></html>`;

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-disposition": `attachment; filename="${number}.html"`,
    },
  });
});

export default account;
