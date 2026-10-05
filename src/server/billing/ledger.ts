/**
 * W4-C — the credit ledger's own module: the Env-level writer that metering
 * calls, and the reads the Credits & billing section renders.
 *
 * Three facts to hold on to before changing anything here.
 *
 * **1. `org_settings.credits_balance` is the authority; the ledger explains it.**
 * The conditional `UPDATE … WHERE credits_balance >= n` in
 * `src/server/decks/versions.ts` is what makes spending atomic and what stops
 * two concurrent uploads sharing the last credit. The ledger row is written
 * immediately after that UPDATE reports one change, so there is exactly one row
 * per successful reservation and none for a refused one. Moving the arithmetic
 * into the ledger would trade a correct counter for a race.
 *
 * **2. Money is integer minor units.** `src/shared/plans.ts` does the sums. A
 * `deck_evaluated` debit carries no money at all: §8 Q1 (ruled 2026-09-11)
 * retired per-deck pricing, so an evaluation's whole record is "one credit".
 *
 * **3. W3-C already writes this table** from `routes/config.ts` through
 * `recordCreditMovement`, which needs a Hono context for the Billing audit row.
 * Metering has no context — the public founder resubmit path has no `c.var.user`
 * at all — so `recordLedgerEntry` below is the Env-level half. They write the
 * same columns; the difference is only that one of them also audits.
 *
 * ── T1-COMMERCE · WHAT A SCOPE IS HERE, AND THE ONE ARM THAT IS NOT MINE ────
 *
 * Every READ in this file now binds the WORKSPACE — `(tenant_id, edition)` —
 * through `scoped()` from `src/shared/tenant.ts`, because `credit_ledger`,
 * `billing_invoices`, `billing_subscriptions` and `billing_payment_intents` are
 * four of the 28 tenant-owned tables and `edition` has only two values. The
 * balance tile, the usage history, the invoice list and the purchased-credits
 * denominator all summed across customers before this.
 *
 * `readTaxSettings` keeps taking an `Env` and nothing else, deliberately:
 * `pricing_settings` is one of §3's eight PLATFORM-GLOBAL tables and must not
 * gain a tenant key. So does the `price_plans` lookup in `readSubscription` — the
 * catalogue owns a plan's NAME product-wide.
 *
 * **`recordLedgerEntry` is the one entry point that still accepts a bare
 * `Edition`, and that arm belongs to T1-DECKS.** It is called from
 * `decks/versions.ts`'s `reserveCredits`/`refundCredits`, which have no session to
 * read a tenant from — the public founder resubmit path reaches them with no
 * `c.var.user` at all — so the tenant has to come off the deck row, which is
 * `TENANT_OWNER`'s one-hop path and T1-DECKS' work in T1-DECKS' files. Widening it
 * here would cascade through `decks/versions.ts`, `routes/decks.ts` (8 sites),
 * `ai/health.ts` and two sibling sessions' test files. The arm is typed, named and
 * pinned by a `pending` case in `test/worker/tenant-scope.test.ts`; the ask is in
 * `docs/parity-requests/T1-COMMERCE.md`.
 */

import type { Env } from "../types";
import type { Edition } from "../../shared/roles";
import { scoped, insertScope, DEFAULT_TENANT_ID, type TenantScope } from "../../shared/tenant";
import {
  billingCycle,
  creditsUsedBetween,
  creditsUsedInMonth,
  priceBreakdown,
  type BillingCycle,
  type InvoiceView,
  type LedgerEntryView,
  type LedgerReason,
  type PaymentIntentView,
  type SubscriptionView,
  type TaxSettings,
} from "../../shared/plans";

// ── Writing ──────────────────────────────────────────────────────────────────

export interface LedgerEntry {
  /** Signed credits. Negative consumes. Never 0 — `0032` CHECKs it. */
  delta: number;
  reason: LedgerReason;
  deckId?: string | null;
  /** Only where money really changed hands. Never a per-deck rate (§8 Q1). */
  amountMinor?: number | null;
  currency?: string | null;
  reference?: string | null;
  note?: string | null;
  actorId?: string | null;
}

/**
 * Append one movement to `credit_ledger`.
 *
 * Not swallowed on failure, and deliberately so: a balance that moved with no
 * ledger row is an accounting defect, not a lost log line. The one exception is
 * the caller in `reserveCredits`, which documents its own reason.
 *
 * ── THE SECOND ARGUMENT, AND WHY IT IS A UNION ──────────────────────────────
 *
 * A `TenantScope` writes the movement into the workspace that asked for it. A
 * bare `Edition` is the TRANSITIONAL arm and lands the row in
 * `DEFAULT_TENANT_ID` — which is what the column's `DEFAULT 't_default'`
 * (`0086:32`) would have done anyway, except that here it is visible in the type,
 * named at the call site, and counted by a test rather than inferred.
 *
 * The only callers on that arm are `reserveCredits` and `refundCredits` in
 * `src/server/decks/versions.ts`, a file T1-DECKS owns. They are reached from the
 * public founder resubmit path with no session at all, so their tenant has to be
 * read off the deck — a `TENANT_OWNER` one-hop lookup inside their file, not a
 * signature this session can supply from outside it.
 */
export async function recordLedgerEntry(
  env: Env,
  scope: TenantScope | Edition,
  entry: LedgerEntry,
): Promise<string> {
  if (entry.delta === 0) throw new Error("credit_ledger: a movement of 0 is not a movement");
  const id = `cl_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const t = insertScope(asScope(scope));
  await env.DB.prepare(
    `INSERT INTO credit_ledger (id, ${t.columns}, delta, reason, deck_id, amount_minor, currency, reference, note, actor_id) ` +
      `VALUES (?, ${t.placeholders}, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      ...t.binds,
      Math.trunc(entry.delta),
      entry.reason,
      entry.deckId ?? null,
      entry.amountMinor ?? null,
      entry.currency ?? null,
      entry.reference ?? null,
      entry.note ?? null,
      entry.actorId ?? null,
    )
    .run();
  return id;
}

/**
 * Normalise `recordLedgerEntry`'s transitional arm. Exported ONLY so the test
 * that pins the arm can count what it does, and so a reader of
 * `decks/versions.ts` can find the one sentence that explains it.
 *
 * **Not a general-purpose constructor.** `scopeOf()` in `src/shared/tenant.ts` is
 * the only way a scope should be built in new code; this is the named edge of a
 * migration in progress, and it is deleted when T1-DECKS threads the deck's
 * tenant through `reserveCredits`.
 */
export function asScope(scope: TenantScope | Edition): TenantScope {
  return typeof scope === "string" ? { tenantId: DEFAULT_TENANT_ID, edition: scope } : scope;
}

// ── Reading ──────────────────────────────────────────────────────────────────

interface LedgerRow {
  id: string;
  created_at: string;
  reason: LedgerReason;
  delta: number;
  deck_id: string | null;
  amount_minor: number | null;
  currency: string | null;
  reference: string | null;
  note: string | null;
  company: string | null;
  invoice_id: string | null;
}

const REASON_SENTENCE: Record<LedgerReason, string> = {
  trial_grant: "Free trial credits",
  purchase: "Credit purchase",
  deck_evaluated: "Pitchdeck evaluation",
  refund: "Credit refunded",
  adjustment: "Administrator adjustment",
  expiry: "Credits expired",
};

/**
 * The prototype's left-hand sentence: "GreenGrid Energy — pitchdeck
 * evaluation". The company comes from the linked deck when there is one; a debit
 * taken before its deck row existed (the upload path reserves the credit first,
 * so an empty balance is refused before anything is stored) falls back to the
 * movement's own words.
 */
function describe(row: LedgerRow): string {
  if (row.company) return `${row.company} — pitchdeck evaluation`;
  if (row.note) return row.note;
  return REASON_SENTENCE[row.reason];
}

function toView(row: LedgerRow): LedgerEntryView {
  return {
    id: row.id,
    createdAt: row.created_at,
    reason: row.reason,
    delta: row.delta,
    description: describe(row),
    deckId: row.deck_id,
    // §8 Q1 — an evaluation has no rupee value to show. Belt and braces: `0046`
    // cleared the seeded per-deck figures, and this refuses to surface one even
    // if some other writer puts one back.
    amountMinor: row.reason === "deck_evaluated" ? null : row.amount_minor,
    currency: row.reason === "deck_evaluated" ? null : row.currency,
    reference: row.reference,
    invoiceId: row.invoice_id,
  };
}

/**
 * The most recent movements, newest first.
 *
 * Both LEFT JOINs also match the workspace. They are reached by an id that
 * belongs to a scoped ledger row, so another customer's name could only appear if
 * a `deck_id` or a `ledger_id` had drifted across tenants — but the whole point of
 * `describe()` is that `decks.name` becomes the sentence the usage history prints,
 * so a drifted id would put another customer's startup name on this screen. The
 * extra conditions are column-to-column and bind nothing, so they cannot disturb
 * bind order; a drift renders NULL and falls back to the movement's own words.
 */
export async function listLedger(
  env: Env,
  scope: TenantScope,
  limit = 50,
): Promise<LedgerEntryView[]> {
  const q = scoped(scope).on("l");
  const res = await env.DB.prepare(
    "SELECT l.id, l.created_at, l.reason, l.delta, l.deck_id, l.amount_minor, l.currency, " +
      "l.reference, l.note, d.name AS company, i.id AS invoice_id " +
      "FROM credit_ledger l " +
      "LEFT JOIN decks d ON d.id = l.deck_id AND d.tenant_id = l.tenant_id AND d.edition = l.edition " +
      "LEFT JOIN billing_invoices i ON i.ledger_id = l.id AND i.tenant_id = l.tenant_id " +
      `${q.whereClause()} ORDER BY l.created_at DESC, l.id DESC LIMIT ?`,
  )
    .bind(...q.binds, Math.max(1, Math.min(500, limit)))
    .all<LedgerRow>();
  return (res.results ?? []).map(toView);
}

/**
 * The balance tile. `org_settings` is a T1-CONFIG table, but this READ lives in a
 * T1-COMMERCE file, so the predicate is scoped here — §11's rule is that the
 * session owning the FILE scopes the statement, whoever owns the table.
 */
export async function readBalance(env: Env, scope: TenantScope): Promise<number> {
  const q = scoped(scope).on("o");
  const row = await env.DB.prepare(`SELECT o.credits_balance FROM org_settings o ${q.whereClause()}`)
    .bind(...q.binds)
    .first<{ credits_balance: number }>();
  return row?.credits_balance ?? 0;
}

/**
 * Lifetime credits bought — the "of 50 purchased" denominator.
 *
 * §11's second standing instruction in one line: this is a `SUM`, so an unscoped
 * one returns a perfectly ordinary-looking number rather than another customer's
 * name. `AGGREGATE_PROBES` in `test/worker/tenant-scope.test.ts` is the layer that
 * can see it, and `billing.test.ts` asserts it by value against a second tenant.
 */
export async function purchasedTotal(env: Env, scope: TenantScope): Promise<number> {
  const q = scoped(scope).on("l").andRaw("l.reason = 'purchase'").andRaw("l.delta > 0");
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(l.delta), 0) AS n FROM credit_ledger l ${q.whereClause()}`,
  )
    .bind(...q.binds)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

// ── Tax settings and the subscription ────────────────────────────────────────

export const FALLBACK_TAX: TaxSettings = {
  ratePct: 18,
  registration: null,
  inclusive: false,
  internationalNotice: true,
};

/** `pricing_settings`, the singleton W4-D's screen edits. */
export async function readTaxSettings(env: Env): Promise<TaxSettings> {
  const row = await env.DB.prepare(
    "SELECT gst_rate_pct, gst_registration, prices_include_gst, show_international_tax_notice " +
      "FROM pricing_settings WHERE id = 1",
  ).first<{
    gst_rate_pct: number;
    gst_registration: string | null;
    prices_include_gst: number;
    show_international_tax_notice: number;
  }>();
  if (!row) return FALLBACK_TAX;
  return {
    ratePct: row.gst_rate_pct,
    registration: row.gst_registration,
    inclusive: row.prices_include_gst === 1,
    internationalNotice: row.show_international_tax_notice === 1,
  };
}

interface SubscriptionRow {
  plan_code: string | null;
  plan_label: string;
  tier_label: string | null;
  seats: number;
  billing_period: "month" | "year";
  cycle_anchor: string;
  currency: string;
  status: SubscriptionView["status"];
  billing_email: string | null;
  gstin: string | null;
}

/**
 * The "Current plan" tile's row. A workspace with no row is on no plan yet —
 * reported as a trialing Free trial rather than invented, because a plan tile
 * that makes up a plan is worse than one that says there isn't one.
 */
export async function readSubscription(
  env: Env,
  scope: TenantScope,
  now: Date = new Date(),
): Promise<SubscriptionView> {
  const q = scoped(scope).on("s");
  const row = await env.DB.prepare(
    "SELECT s.plan_code, s.plan_label, s.tier_label, s.seats, s.billing_period, s.cycle_anchor, " +
      `s.currency, s.status, s.billing_email, s.gstin FROM billing_subscriptions s ${q.whereClause()}`,
  )
    .bind(...q.binds)
    .first<SubscriptionRow>();

  if (!row) {
    const anchor = `${now.getUTCFullYear()}-01-01`;
    return {
      planCode: null,
      planLabel: "Free trial",
      tierLabel: null,
      seats: 0,
      status: "trialing",
      currency: "INR",
      billingEmail: null,
      gstin: null,
      cycleAnchor: anchor,
      cycle: billingCycle(anchor, "year", now),
    };
  }

  // The catalogue owns the NAME when the plan is a catalogue plan, so a rename
  // in W4-D's Price configuration flows through to this tile without a copy here.
  // DELIBERATELY UNSCOPED: `price_plans` is one of §3's eight platform-global
  // tables. One catalogue serves the whole product, so a plan's name is the same
  // name for every customer and a tenant predicate here would find no column.
  let label = row.plan_label;
  if (row.plan_code) {
    const named = await env.DB.prepare("SELECT name FROM price_plans WHERE code = ? AND active = 1")
      .bind(row.plan_code)
      .first<{ name: string }>();
    if (named?.name) label = named.name;
  }

  return {
    planCode: row.plan_code,
    planLabel: label,
    tierLabel: row.tier_label,
    seats: row.seats,
    status: row.status,
    currency: row.currency,
    billingEmail: row.billing_email,
    gstin: row.gstin,
    cycleAnchor: row.cycle_anchor,
    cycle: billingCycle(row.cycle_anchor, row.billing_period, now),
  };
}

// ── Invoices ─────────────────────────────────────────────────────────────────

interface InvoiceRow {
  id: string;
  number: string;
  kind: "invoice" | "receipt";
  description: string;
  units: number | null;
  currency: string;
  subtotal_minor: number;
  tax_minor: number;
  total_minor: number;
  gst_rate_pct: number;
  gst_registration: string | null;
  place_of_supply: string | null;
  reference: string | null;
  issued_at: string;
}

function invoiceView(row: InvoiceRow): InvoiceView {
  return {
    id: row.id,
    number: row.number,
    kind: row.kind,
    description: row.description,
    units: row.units,
    currency: row.currency,
    subtotalMinor: row.subtotal_minor,
    taxMinor: row.tax_minor,
    totalMinor: row.total_minor,
    ratePct: row.gst_rate_pct,
    registration: row.gst_registration,
    reference: row.reference,
    issuedAt: row.issued_at,
  };
}

const INVOICE_COLUMNS =
  "id, number, kind, description, units, currency, subtotal_minor, tax_minor, total_minor, " +
  "gst_rate_pct, gst_registration, place_of_supply, reference, issued_at";

export async function listInvoices(env: Env, scope: TenantScope): Promise<InvoiceView[]> {
  const q = scoped(scope).on("v");
  const res = await env.DB.prepare(
    `SELECT ${INVOICE_COLUMNS} FROM billing_invoices v ${q.whereClause()} ` +
      "ORDER BY v.issued_at DESC, v.number DESC",
  )
    .bind(...q.binds)
    .all<InvoiceRow>();
  return (res.results ?? []).map(invoiceView);
}

export async function loadInvoice(
  env: Env,
  scope: TenantScope,
  id: string,
): Promise<InvoiceView | null> {
  const q = scoped(scope).on("v").and("v.id = ?", id);
  const row = await env.DB.prepare(`SELECT ${INVOICE_COLUMNS} FROM billing_invoices v ${q.whereClause()}`)
    .bind(...q.binds)
    .first<InvoiceRow>();
  return row ? invoiceView(row) : null;
}

/**
 * Issue the invoices that the ledger's paid purchases are missing.
 *
 * Idempotent by construction: the invoice id is derived from the ledger row id
 * and `billing_invoices` holds `UNIQUE (ledger_id)`, so a movement can carry at
 * most one document however many times this runs. The GST rate and registration
 * are SNAPSHOTTED at issue — re-deriving an old invoice from today's settings
 * would silently rewrite a document a customer has already filed.
 *
 * Why lazily, on read, rather than at the moment of purchase: the purchases that
 * exist today were written by `routes/config.ts`, which this session does not
 * own, and by `0032`'s seed. Issuing from the ledger covers every writer there
 * is — including ones added later — with no cross-session edit and no path where
 * a paid purchase quietly has no document.
 *
 * Numbering is `INV-<year>-<nnnn>`, sequential **per workspace** in purchase
 * order. A concurrent reader can lose the race for a number;
 * `UNIQUE (tenant_id, edition, number)` refuses the duplicate and the next read
 * issues it. That is the correct trade: an invoice number is never reused, and a
 * document is at worst late.
 *
 * ── T1-COMMERCE · THE SEQUENCE IS THE TENANCY BUG HERE, NOT THE LIST ────────
 *
 * `0097`'s header is explicit that it widened `UNIQUE (edition, number)` to
 * `UNIQUE (tenant_id, edition, number)` precisely so the second customer's first
 * invoice does not compete for `INV-2026-0001`. That removed the collision; it did
 * NOT fix the counter. The `SELECT COUNT(*)` below was `WHERE edition = ?`, so a
 * second customer's very first invoice would have been numbered from the FIRST
 * customer's invoice count — `INV-2026-0009` on day one, with no 0001 to 0008
 * anywhere in their account. No error, no duplicate, and a numbering gap a
 * customer's auditor asks about. Scoping the count is what makes `0097`'s widened
 * key mean what its header says.
 */
export async function issueMissingInvoices(env: Env, scope: TenantScope): Promise<number> {
  const ledgerQ = scoped(scope)
    .on("l")
    .andRaw("l.reason = 'purchase'")
    .andRaw("l.amount_minor IS NOT NULL")
    .andRaw("i.id IS NULL");
  const res = await env.DB.prepare(
    "SELECT l.id, l.note, l.delta, l.amount_minor, l.currency, l.reference, l.created_at " +
      "FROM credit_ledger l LEFT JOIN billing_invoices i ON i.ledger_id = l.id " +
      `AND i.tenant_id = l.tenant_id ${ledgerQ.whereClause()} ` +
      "ORDER BY l.created_at ASC, l.id ASC",
  )
    .bind(...ledgerQ.binds)
    .all<{
      id: string;
      note: string | null;
      delta: number;
      amount_minor: number;
      currency: string;
      reference: string | null;
      created_at: string;
    }>();
  const pending = res.results ?? [];
  if (pending.length === 0) return 0;

  const tax = await readTaxSettings(env);
  const t = insertScope(scope);
  let issued = 0;
  for (const row of pending) {
    const seqQ = scoped(scope).on("v");
    const seq = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM billing_invoices v ${seqQ.whereClause()}`,
    )
      .bind(...seqQ.binds)
      .first<{ n: number }>();
    const year = row.created_at.slice(0, 4);
    const number = `INV-${year}-${String((seq?.n ?? 0) + 1).padStart(4, "0")}`;
    // The ledger's amount is the price that was charged; whether that price
    // already contained the tax is the org's `prices_include_gst` setting.
    const breakdown = priceBreakdown(row.amount_minor, tax, row.currency);

    try {
      await env.DB.prepare(
        `INSERT INTO billing_invoices (id, ${t.columns}, number, kind, ledger_id, intent_id, description, units, ` +
          "currency, subtotal_minor, tax_minor, total_minor, gst_rate_pct, gst_registration, place_of_supply, " +
          `reference, issued_at) VALUES (?, ${t.placeholders}, ?, 'invoice', ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      )
        .bind(
          `inv_${row.id}`,
          ...t.binds,
          number,
          row.id,
          row.note ?? "Credit purchase",
          row.delta,
          row.currency,
          breakdown.subtotalMinor,
          breakdown.taxMinor,
          breakdown.totalMinor,
          tax.ratePct,
          // ── V6-INVOICE · THE SELLER'S GSTIN, AND ONLY THE SELLER'S ────────
          //
          // This was `tax.registration ?? sub?.gstin ?? null`: OUR GST
          // registration, falling back to THE CUSTOMER'S, into one column.
          // `0046`'s own comment on `billing_subscriptions.gstin` says it plainly
          // — "The CUSTOMER's GSTIN (ours is `pricing_settings.gst_registration`)"
          // — and `routes/billing.ts` then printed this column under the label
          // "Our GST registration".
          //
          // So on any workspace where `pricing_settings.gst_registration` is NULL
          // (it is nullable, and the Price configuration screen can clear it), the
          // invoice declared the CUSTOMER as the supplier of their own purchase.
          // That is not a cosmetic mislabel: a GST tax invoice naming the wrong
          // supplier GSTIN is unusable for input tax credit, which is the one job
          // V6 (`:2807`) gives this document. The customer's GSTIN belongs in the
          // "Billed to" block and is read from the subscription at render time
          // (`invoice.ts`, `loadInvoiceRecord`).
          //
          // NULL is now the honest value when we hold no registration, and the
          // template omits the line rather than printing someone else's number.
          tax.registration,
          row.reference,
          row.created_at,
        )
        .run();
      issued += 1;
    } catch {
      // A UNIQUE collision means another request issued it (or claimed the
      // number) first. Nothing to repair: the next read tries again.
    }
  }
  return issued;
}

// ── Payment intents ──────────────────────────────────────────────────────────

export async function listIntents(
  env: Env,
  scope: TenantScope,
  limit = 10,
): Promise<PaymentIntentView[]> {
  const q = scoped(scope).on("p");
  const res = await env.DB.prepare(
    "SELECT p.id, p.purpose, p.plan_code, p.plan_name, p.units, p.quantity, p.currency, " +
      "p.subtotal_minor, p.tax_minor, p.total_minor, p.gst_rate_pct, p.status, p.checkout_url, " +
      `p.created_at FROM billing_payment_intents p ${q.whereClause()} ` +
      "ORDER BY p.created_at DESC LIMIT ?",
  )
    .bind(...q.binds, Math.max(1, Math.min(100, limit)))
    .all<{
      id: string;
      purpose: PaymentIntentView["purpose"];
      plan_code: string | null;
      plan_name: string;
      units: number | null;
      quantity: number;
      currency: string;
      subtotal_minor: number;
      tax_minor: number;
      total_minor: number;
      gst_rate_pct: number;
      status: PaymentIntentView["status"];
      checkout_url: string | null;
      created_at: string;
    }>();
  return (res.results ?? []).map((r) => ({
    id: r.id,
    purpose: r.purpose,
    planCode: r.plan_code,
    planName: r.plan_name,
    units: r.units,
    quantity: r.quantity,
    currency: r.currency,
    subtotalMinor: r.subtotal_minor,
    taxMinor: r.tax_minor,
    totalMinor: r.total_minor,
    ratePct: r.gst_rate_pct,
    status: r.status,
    checkoutUrl: r.checkout_url,
    createdAt: r.created_at,
  }));
}

// ── Aggregates the tiles print ───────────────────────────────────────────────

export interface UsageTotals {
  usedThisMonth: number;
  usedThisCycle: number;
}

/**
 * "Used this month" is the CALENDAR month, which is what the prototype's tile
 * means: its own workspace is on an annual Enterprise plan and the tile still
 * says month. The cycle figure is reported separately, by the cycle card.
 */
export async function usageTotals(
  env: Env,
  scope: TenantScope,
  cycle: BillingCycle,
  now: Date = new Date(),
): Promise<UsageTotals> {
  const q = scoped(scope).on("l").andRaw("l.delta < 0");
  const res = await env.DB.prepare(
    `SELECT l.delta, l.created_at FROM credit_ledger l ${q.whereClause()}`,
  )
    .bind(...q.binds)
    .all<{ delta: number; created_at: string }>();
  const rows = (res.results ?? []).map((r) => ({
    delta: r.delta,
    createdAt: r.created_at,
  }));
  return {
    usedThisMonth: creditsUsedInMonth(rows, now),
    usedThisCycle: creditsUsedBetween(rows, cycle.start, cycle.end),
  };
}
