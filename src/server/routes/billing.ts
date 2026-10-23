/**
 * W4-C — Admin console → Organisation → **Credits & billing** (`admin/s-bl.html`).
 *
 * The prototype's section is three tiles, a usage-history list and three buttons
 * (Buy more credits · Download invoice · Upgrade plan). This router is that
 * section's whole read surface plus the three things those buttons need and the
 * prototype never wired: a purchase that records an intent, an invoice document,
 * and the billing cycle / GST settings the amounts are computed under.
 *
 * Two rules govern it.
 *
 * **§1.2 — card data never reaches this application.** No route here accepts a
 * card number, CVV, expiry or cardholder name, in any field, in any state. The
 * only thing `POST /purchase` takes is *what* is being bought; the instrument is
 * the provider's business, on a page the provider hosts
 * (`src/server/billing/provider.ts`).
 *
 * **§1.3 — interface-complete, provider-stubbed.** A purchase RECORDS its intent
 * in `billing_payment_intents` with `status='recorded'`, exactly as
 * `crm_sync_log` records a sync it did not perform and `email_outbox` records a
 * message it did not send. It grants no credits and activates no plan, and the
 * response says so in as many words. Reporting a recorded intent as a completed
 * payment is the one failure this whole module is shaped to prevent.
 *
 * Metering is untouched and stays where it is: `decks/versions.ts` reserves one
 * credit per evaluation under a conditional UPDATE, and now writes the ledger
 * row for it. Prices are READ from `src/shared/plans.ts`; W4-D writes the
 * catalogue (`/api/pricing`).
 */
import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAuth, requireTask } from "../auth/middleware";
// T1-COMMERCE — T0-SCHEMA's one scope helper. `scopeOf(user)` takes the WORKSPACE
// off the session and never off the request, which is what keeps §2's one piece of
// good news true: not one of the 211 existing predicates takes its key from the
// browser, and a `scopeOf(c.req.query())` would not compile.
import { scopeOf, scoped, insertScope, type TenantScope } from "../../shared/tenant";
// The Billing audit category — the same one W3-C's `recordCreditMovement` writes.
import { changedFragment, recordAudit } from "../audit/log";
import { LOW_CREDIT_THRESHOLD } from "../../shared/notifications";
import {
  billingCurrencyFor,
  formatMinor,
  type CreditsBillingView,
  type PlanGroup,
  type SubscriptionView,
} from "../../shared/plans";
import { quoteOrder, taxSettingsOf, type AccountType } from "../../shared/accountOrder";
import { publishedBook, publishedPlansFor } from "../billing/catalogue";
import {
  issueMissingInvoices,
  listIntents,
  listInvoices,
  listLedger,
  loadInvoice,
  purchasedTotal,
  readBalance,
  readSubscription,
  readTaxSettings,
  usageTotals,
} from "../billing/ledger";
import { paymentConfigured, recordPaymentIntent, type IntentPurpose } from "../billing/provider";
// V6-INVOICE — the two templates, the record behind them, and the 10 GB-per-seat
// figure. All in `src/server/billing/**` so this router stays a router.
import { loadInvoiceRecord, renderInvoiceDocument } from "../billing/invoice";
import { storageAllowanceForSeats } from "../billing/storage";
import { emailDeliveryConfigured } from "../email/outbox";

const billing = new Hono<AppEnv>();
billing.use("*", requireAuth);
// The whole Admin console is admin + superuser, gated on the `adminconsole` task
// so that revoking that cell closes the screen AND its API in one place (§8 Q16).
//
// F0043 / F0158 record that the PROTOTYPE shows this section to all eleven roles,
// read-only. That is a nav change plus a read-only contract for two sections, and
// `src/shared/nav.ts` is a serialisation-hazard file this session does not own —
// left open in §8 rather than half-built here.
billing.use("*", requireTask("adminconsole", "admin"));

// ── The published catalogue ──────────────────────────────────────────────────

/**
 * P2 — **this section used to read `price_plans` × `price_amounts` directly**:
 * Price configuration's DRAFT tables, so an administrator's unpublished edit was
 * the price this panel charged, and the panel sold the pre-V3 10 / 50 / 100 packs
 * that the incubator's My account wizard never offers. The two "Buy" surfaces
 * showed two price lists. Both now read the PUBLISHED book and select with the
 * same predicate (`src/server/billing/catalogue.ts`, which carries the measured
 * account of the divergence), and `POST /purchase` below prices with the same
 * `quoteOrder` that `POST /api/account/orders` does.
 */

/**
 * Who is buying, as far as the commercial record says. `account_profiles` is
 * the My account wizard's row; this panel has no screen of its own for it.
 */
interface Buyer {
  accountType: AccountType | null;
  billingCountry: string | null;
}

async function readBuyer(env: AppEnv["Bindings"], scope: TenantScope): Promise<Buyer> {
  const q = scoped(scope).on("p");
  const row = await env.DB.prepare(
    `SELECT p.account_type, p.billing_country FROM account_profiles p ${q.whereClause()}`,
  )
    .bind(...q.binds)
    .first<{ account_type: AccountType; billing_country: string | null }>();
  return { accountType: row?.account_type ?? null, billingCountry: row?.billing_country ?? null };
}

/**
 * The ONE currency this panel quotes and charges in.
 *
 * V6-CURRENCY's rule — the billing address decides — applied here too. Before
 * P2 this panel priced in `billing_subscriptions.currency` and nothing else, so
 * a customer whose billing country is the United States was quoted in rupees
 * with GST here and in dollars without it in My account. With no billing
 * country on file, the subscription's currency stands, exactly as before: `0104`
 * records why an unrecorded country must not be guessed in either direction.
 */
function panelCurrency(buyer: Buyer, subscription: SubscriptionView): string {
  return billingCurrencyFor(buyer.billingCountry) ?? subscription.currency;
}

// ── GET / — everything the section renders ───────────────────────────────────

billing.get("/", async (c) => {
  const { edition } = c.var.user;
  // §2 B16 measured this one route as leaking invoices, subscriptions and payment
  // intents across customers. Every number below is now a workspace read; `tax` and
  // `plans` are the two that are NOT, and must not be — `pricing_settings` and
  // `price_plans` are platform-global (§3).
  const scope = scopeOf(c.var.user);
  const now = new Date();

  // A paid purchase with no document is a gap a customer notices at audit time.
  // Idempotent, and a no-op on every request after the first.
  await issueMissingInvoices(c.env, scope);

  const subscription = await readSubscription(c.env, scope, now);
  const tax = await readTaxSettings(c.env);
  const usage = await usageTotals(c.env, scope, subscription.cycle, now);
  const book = await publishedBook(c.env);
  const currency = panelCurrency(await readBuyer(c.env, scope), subscription);

  const view: CreditsBillingView = {
    edition,
    balance: await readBalance(c.env, scope),
    purchased: await purchasedTotal(c.env, scope),
    usedThisMonth: usage.usedThisMonth,
    usedThisCycle: usage.usedThisCycle,
    lowCreditThreshold: LOW_CREDIT_THRESHOLD,
    subscription,
    // The panel computes its GST line from this, so it must be the rate the
    // order is CHARGED at — the published book's (`quoteOrder` →
    // `taxSettingsOf(book.tax)`), not `pricing_settings`, which Price
    // configuration edits before publishing. Invoices keep snapshotting
    // `readTaxSettings` at issue (`issueMissingInvoices`); that is W4-C's
    // document rule and unchanged here.
    tax: book ? taxSettingsOf(book.tax) : tax,
    ledger: await listLedger(c.env, scope, 50),
    invoices: await listInvoices(c.env, scope),
    // Nothing published → nothing to sell, and the panel already says "Publish
    // the price list in Price configuration first" for an empty list.
    plans: book ? publishedPlansFor(book, edition, currency) : [],
    intents: await listIntents(c.env, scope, 10),
    paymentConfigured: paymentConfigured(c.env),
  };

  // ── V6 additions, served BESIDE `CreditsBillingView` ──────────────────────
  //
  // `CreditsBillingView` lives in `src/shared/plans.ts`, another lane's file this
  // wave, so these two are additive keys on the payload rather than fields on the
  // interface. Both exist so that a screen never writes the answer into copy.
  //
  // `storage` — "10 GB storage each" appears on four V6 plan screens and is
  // markup in the prototype (`:2671`, `:2674`, `:3271`). Served from the seat
  // model instead (`src/server/billing/storage.ts`).
  //
  // `invoiceDelivery` — V6's success screen promises "GST-compliant invoice sent
  // to your registered email" (`:2807`). With `EMAIL_FROM` unset on every
  // deployment that sentence is false, so the screen is handed the condition and
  // the sentence that is true, rather than a literal to print unconditionally.
  // This is the 2026-10-02 correction applied before the fact: do not tell the
  // customer something was sent until something says it was.
  const emailConfigured = emailDeliveryConfigured(c.env);
  return c.json({
    ...view,
    storage: storageAllowanceForSeats(subscription.seats),
    invoiceDelivery: {
      configured: emailConfigured,
      // Both branches keep V6's "suitable for input tax credit", because that is
      // a property of the DOCUMENT, not of the delivery.
      promise: emailConfigured
        ? "GST-compliant invoice sent to your registered email · suitable for input tax credit"
        : "GST-compliant invoice available to download · suitable for input tax credit",
    },
  });
});

// ── PUT /subscription — billing contact and cycle ────────────────────────────

const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z][Z][0-9A-Z]$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function readBody<T>(c: { req: { json: () => Promise<unknown> } }): Promise<Partial<T>> {
  return ((await c.req.json().catch(() => ({}))) ?? {}) as Partial<T>;
}

billing.put("/subscription", async (c) => {
  const scope: TenantScope = scopeOf(c.var.user);
  const body = await readBody<{
    billingEmail: string | null;
    gstin: string | null;
    cycleAnchor: string;
    billingPeriod: "month" | "year";
  }>(c);

  const before = await readSubscription(c.env, scope);

  const billingEmail =
    body.billingEmail === undefined ? before.billingEmail : body.billingEmail || null;
  if (billingEmail !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billingEmail)) {
    return c.json({ error: "invalid_email" }, 400);
  }

  const gstin = body.gstin === undefined ? before.gstin : body.gstin || null;
  // A GSTIN that is not one would print on an invoice and make it unusable for
  // input tax credit, which is the whole point of the field.
  if (gstin !== null && !GSTIN.test(gstin.toUpperCase())) {
    return c.json({ error: "invalid_gstin" }, 400);
  }

  const cycleAnchor = body.cycleAnchor ?? before.cycleAnchor;
  if (!DATE.test(cycleAnchor) || Number.isNaN(Date.parse(cycleAnchor))) {
    return c.json({ error: "invalid_cycle_anchor" }, 400);
  }

  const billingPeriod = body.billingPeriod ?? before.cycle.period;
  if (billingPeriod !== "month" && billingPeriod !== "year") {
    return c.json({ error: "invalid_billing_period" }, 400);
  }

  // ══ ON CONFLICT 3 of the 9 THAT BLOCK INTEGRATION ═════════════════════════
  //
  // `0095` widened this table's PRIMARY KEY from `(edition)` to
  // `(tenant_id, edition)` and left the old key standing as the transitional
  // unique index `billing_subscriptions__pre_tenant_key`, so that this upsert's
  // `ON CONFLICT (edition)` kept resolving and T0 could merge green.
  //
  // ── MEASURED, AND WORSE THAN `0095`'s HEADER PREDICTED ────────────────────
  // That header says the old target "stops resolving ... with 'ON CONFLICT clause
  // does not match any PRIMARY KEY or UNIQUE constraint'". It does not: the
  // transitional index IS a matching unique constraint, so the statement runs. What
  // it then does, measured on SQLite 3.51 against exactly this shape — widened PK
  // plus a standing `UNIQUE (edition)` — is far worse than an error:
  //
  //   INSERT INTO ap (tenant_id, edition, v) VALUES ('t_zz','incubator','tenantB')
  //     ON CONFLICT (edition) DO UPDATE SET v = excluded.v;
  //   → t_default|incubator|tenantB      (one row, still tenant A's, now B's data)
  //
  // The second customer's billing email, GSTIN and cycle are written INTO THE FIRST
  // CUSTOMER'S ROW, the row keeps `tenant_id = 't_default'`, no new row appears, and
  // the handler answers 200. A cross-tenant destructive write that reports success —
  // the silent half of §11's write-side warning, in the one table that carries a
  // customer's tax identity.
  //
  // Naming the widened key is what converts that into the loud failure `0095`
  // intended. Same measurement, target corrected:
  //
  //   ... ON CONFLICT (tenant_id, edition) DO UPDATE ...
  //   → tenant A's own upsert still updates in place (verified);
  //     tenant B's insert fails with `UNIQUE constraint failed: ap.edition`
  //
  // which is the correct error for "integration has not dropped the transitional
  // index yet", and the reason `billing_subscriptions` stays in
  // `BLOCKED_BY_TRANSITIONAL_KEY`. **The index is NOT dropped here** — 0101–0108
  // does that, once all nine upserts name the widened key.
  const t = insertScope(scope);
  await c.env.DB.prepare(
    `INSERT INTO billing_subscriptions (${t.columns}, plan_label, seats, billing_period, cycle_anchor, ` +
      `billing_email, gstin, updated_at) VALUES (${t.placeholders}, ?, 0, ?, ?, ?, ?, datetime('now')) ` +
      "ON CONFLICT (tenant_id, edition) DO UPDATE SET billing_period = excluded.billing_period, " +
      "cycle_anchor = excluded.cycle_anchor, billing_email = excluded.billing_email, " +
      "gstin = excluded.gstin, updated_at = datetime('now')",
  )
    .bind(
      ...t.binds,
      before.planLabel,
      billingPeriod,
      cycleAnchor,
      billingEmail,
      gstin?.toUpperCase() ?? null,
    )
    .run();

  const after = await readSubscription(c.env, scope);
  const changes = [
    changedFragment("billing email", before.billingEmail, after.billingEmail, (v) => v ?? "none"),
    changedFragment("GSTIN", before.gstin, after.gstin, (v) => v ?? "none"),
    changedFragment("cycle anchor", before.cycleAnchor, after.cycleAnchor),
    changedFragment("billing period", before.cycle.period, after.cycle.period),
  ].filter((f): f is string => f !== null);
  if (changes.length > 0) {
    await recordAudit(c, {
      category: "billing",
      action: "billing_details_updated",
      summary: `Billing details updated — ${changes.join("; ")}`,
      detail: { changes },
      targetType: "billing_subscriptions",
      // The row's identity is now the PAIR, so the audit target has to be the
      // pair: `targetId: edition` named a row that two customers would share.
      targetId: `${scope.tenantId}:${scope.edition}`,
    });
  }
  return c.json({ ok: true, subscription: after });
});

// ── POST /purchase — records an intent; charges nothing ──────────────────────

const PURPOSE_OF_GROUP: Record<Exclude<PlanGroup, "free_trial">, IntentPurpose> = {
  credit_pack: "credit_pack",
  subscription: "subscription",
  enterprise: "enterprise",
};

billing.post("/purchase", async (c) => {
  const scope = scopeOf(c.var.user);
  const body = await readBody<{ planCode: string; quantity: number }>(c);

  const planCode = typeof body.planCode === "string" ? body.planCode : "";
  if (!planCode) return c.json({ error: "plan_required" }, 400);

  const quantity = body.quantity === undefined ? 1 : Number(body.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
    return c.json({ error: "invalid_quantity" }, 400);
  }

  const book = await publishedBook(c.env);
  if (!book) return c.json({ error: "not_published" }, 503);
  const subscription = await readSubscription(c.env, scope);
  const buyer = await readBuyer(c.env, scope);
  // Chosen by the SERVER from the billing address, never read from the body —
  // so V6's invariant ("an Indian billing address is never priced in USD") holds
  // here by construction rather than by the refusal `POST /api/account/orders`
  // needs for a currency a client sent.
  const currency = panelCurrency(buyer, subscription);

  // P2 — the same function, and therefore the same price, as My account. With no
  // profile on file the buyer is taken to be an ORGANISATION: this is the admin
  // console of an incubator's workspace, `quoteOrder` sells enterprise plans to
  // organisations only, and an individual is somebody who said so in My account.
  // A free trial is refused (`plan_not_purchasable`) — it is taken, not bought.
  const quote = quoteOrder(book, planCode, currency, buyer.accountType ?? "organization", { quantity });
  if ("error" in quote) {
    return c.json({ error: quote.error }, quote.error === "unknown_plan" ? 404 : 400);
  }
  const money = quote.breakdown;
  const plan = quote.plan;

  const intent = await recordPaymentIntent(c.env, {
    tenantId: scope.tenantId,
    edition: scope.edition,
    purpose: PURPOSE_OF_GROUP[quote.group],
    planCode: plan.code,
    planName: plan.name,
    // The TOTAL the purchase grants — what fulfilment credits (`billing/
    // fulfilment.ts`) — the same meaning `POST /api/account/orders` gives it.
    units: quote.unitsTotal,
    quantity,
    currency,
    money,
    actorId: c.var.user.id,
  });

  await recordAudit(c, {
    category: "billing",
    action: "billing_intent_recorded",
    summary:
      `Purchase intent recorded — ${quantity} × ${plan.name} · ` +
      `${formatMinor(money.totalMinor, currency)}${money.taxed ? " incl. GST" : ""} · no payment taken`,
    detail: {
      intentId: intent.id,
      planCode: plan.code,
      quantity,
      status: intent.status,
      priceVersion: book.version,
    },
    targetType: "billing_payment_intents",
    targetId: intent.id,
  });

  // The contract, spelled out in the payload so no client can misreport it: the
  // intent is RECORDED, no payment has been taken, and no credits were granted.
  return c.json({
    ok: true,
    intent,
    completed: false,
    creditsGranted: 0,
    checkout: intent.checkoutUrl
      ? { hosted: true, url: intent.checkoutUrl }
      : { hosted: false, url: null },
    message: intent.checkoutUrl
      ? "Continue on the payment provider's own page to complete this purchase."
      : "Purchase intent recorded. No payment provider is configured, so nothing has been " +
        "charged and no credits have been added — our team will follow up to complete it.",
  });
});

// ── Invoices ─────────────────────────────────────────────────────────────────

billing.get("/invoices/:id", async (c) => {
  const invoice = await loadInvoice(c.env, scopeOf(c.var.user), c.req.param("id"));
  if (!invoice) return c.json({ error: "not_found" }, 404);
  return c.json(invoice);
});

/**
 * The document behind V6's "Download invoice" (`AISJ_MyAccount_V6.HTM:2810`).
 *
 * **The server renders it and hands back a real response.** The prototype does
 * the opposite — `acDownloadInvoice()` (`:3417`) builds the markup in the page and
 * `window.open`s it, which needs a popup allowance it then apologises for
 * ("Please allow pop-ups to download the invoice") and which a sandboxed client
 * cannot do at all. A tax document also must not be assembled by code the
 * customer can edit.
 *
 * Printable HTML rather than a generated PDF: a PDF writer is a dependency on the
 * critical path for a page a browser already prints, and §1.3's rule about vendors
 * on this lane is the same rule. The stylesheet carries `@media print`.
 *
 * Which of the two templates, and what the document may legally claim, are
 * decided in `src/server/billing/invoice.ts` from the STORED record — not from
 * today's settings, and not from the billing address, which is one rule owned by
 * `src/shared/plans.ts`. This handler only resolves the record and serves it.
 */
billing.get("/invoices/:id/document", async (c) => {
  const { edition } = c.var.user;
  const scope = scopeOf(c.var.user);
  const record = await loadInvoiceRecord(
    c.env,
    scope,
    c.req.param("id"),
    edition === "vc" ? "Investor workspace" : "Incubator workspace",
  );
  if (!record) return c.json({ error: "not_found" }, 404);

  const html = renderInvoiceDocument(record);
  if (html === null) {
    // A non-INR invoice carrying tax. Refused rather than rendered either way:
    // see `invoiceTemplateOf`. 409 because the stored row, not the request, is
    // what is wrong — and a named error is what gets it repaired.
    return c.json(
      {
        error: "invoice_tax_contradicts_currency",
        detail:
          `Invoice ${record.number} is in ${record.currency} and carries tax. ` +
          "An export invoice cannot declare a supply without payment of IGST over a taxed line, " +
          "and a GST tax invoice cannot be issued in a foreign currency. The row needs repair.",
      },
      409,
    );
  }
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-disposition": `attachment; filename="${record.number}.html"`,
    },
  });
});

export default billing;
