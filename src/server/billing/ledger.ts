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
 */

import type { Env } from "../types";
import type { Edition } from "../../shared/roles";
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
 */
export async function recordLedgerEntry(
  env: Env,
  edition: Edition,
  entry: LedgerEntry,
): Promise<string> {
  if (entry.delta === 0) throw new Error("credit_ledger: a movement of 0 is not a movement");
  const id = `cl_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  await env.DB.prepare(
    "INSERT INTO credit_ledger (id, edition, delta, reason, deck_id, amount_minor, currency, reference, note, actor_id) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      id,
      edition,
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

/** The most recent movements, newest first. */
export async function listLedger(
  env: Env,
  edition: Edition,
  limit = 50,
): Promise<LedgerEntryView[]> {
  const res = await env.DB.prepare(
    "SELECT l.id, l.created_at, l.reason, l.delta, l.deck_id, l.amount_minor, l.currency, " +
      "l.reference, l.note, d.name AS company, i.id AS invoice_id " +
      "FROM credit_ledger l " +
      "LEFT JOIN decks d ON d.id = l.deck_id " +
      "LEFT JOIN billing_invoices i ON i.ledger_id = l.id " +
      "WHERE l.edition = ? ORDER BY l.created_at DESC, l.id DESC LIMIT ?",
  )
    .bind(edition, Math.max(1, Math.min(500, limit)))
    .all<LedgerRow>();
  return (res.results ?? []).map(toView);
}

export async function readBalance(env: Env, edition: Edition): Promise<number> {
  const row = await env.DB.prepare("SELECT credits_balance FROM org_settings WHERE edition = ?")
    .bind(edition)
    .first<{ credits_balance: number }>();
  return row?.credits_balance ?? 0;
}

/** Lifetime credits bought — the "of 50 purchased" denominator. */
export async function purchasedTotal(env: Env, edition: Edition): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COALESCE(SUM(delta), 0) AS n FROM credit_ledger " +
      "WHERE edition = ? AND reason = 'purchase' AND delta > 0",
  )
    .bind(edition)
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
  edition: Edition,
  now: Date = new Date(),
): Promise<SubscriptionView> {
  const row = await env.DB.prepare(
    "SELECT plan_code, plan_label, tier_label, seats, billing_period, cycle_anchor, currency, " +
      "status, billing_email, gstin FROM billing_subscriptions WHERE edition = ?",
  )
    .bind(edition)
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

export async function listInvoices(env: Env, edition: Edition): Promise<InvoiceView[]> {
  const res = await env.DB.prepare(
    `SELECT ${INVOICE_COLUMNS} FROM billing_invoices WHERE edition = ? ORDER BY issued_at DESC, number DESC`,
  )
    .bind(edition)
    .all<InvoiceRow>();
  return (res.results ?? []).map(invoiceView);
}

export async function loadInvoice(
  env: Env,
  edition: Edition,
  id: string,
): Promise<InvoiceView | null> {
  const row = await env.DB.prepare(
    `SELECT ${INVOICE_COLUMNS} FROM billing_invoices WHERE id = ? AND edition = ?`,
  )
    .bind(id, edition)
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
 * Numbering is `INV-<year>-<nnnn>`, sequential per edition in purchase order. A
 * concurrent reader can lose the race for a number; `UNIQUE (edition, number)`
 * refuses the duplicate and the next read issues it. That is the correct
 * trade: an invoice number is never reused, and a document is at worst late.
 */
export async function issueMissingInvoices(env: Env, edition: Edition): Promise<number> {
  const res = await env.DB.prepare(
    "SELECT l.id, l.note, l.delta, l.amount_minor, l.currency, l.reference, l.created_at " +
      "FROM credit_ledger l LEFT JOIN billing_invoices i ON i.ledger_id = l.id " +
      "WHERE l.edition = ? AND l.reason = 'purchase' AND l.amount_minor IS NOT NULL " +
      "AND i.id IS NULL ORDER BY l.created_at ASC, l.id ASC",
  )
    .bind(edition)
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
  const sub = await env.DB.prepare("SELECT gstin FROM billing_subscriptions WHERE edition = ?")
    .bind(edition)
    .first<{ gstin: string | null }>();

  let issued = 0;
  for (const row of pending) {
    const seq = await env.DB.prepare("SELECT COUNT(*) AS n FROM billing_invoices WHERE edition = ?")
      .bind(edition)
      .first<{ n: number }>();
    const year = row.created_at.slice(0, 4);
    const number = `INV-${year}-${String((seq?.n ?? 0) + 1).padStart(4, "0")}`;
    // The ledger's amount is the price that was charged; whether that price
    // already contained the tax is the org's `prices_include_gst` setting.
    const breakdown = priceBreakdown(row.amount_minor, tax);

    try {
      await env.DB.prepare(
        "INSERT INTO billing_invoices (id, edition, number, kind, ledger_id, intent_id, description, units, " +
          "currency, subtotal_minor, tax_minor, total_minor, gst_rate_pct, gst_registration, place_of_supply, " +
          "reference, issued_at) VALUES (?, ?, ?, 'invoice', ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)",
      )
        .bind(
          `inv_${row.id}`,
          edition,
          number,
          row.id,
          row.note ?? "Credit purchase",
          row.delta,
          row.currency,
          breakdown.subtotalMinor,
          breakdown.taxMinor,
          breakdown.totalMinor,
          tax.ratePct,
          tax.registration ?? sub?.gstin ?? null,
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
  edition: Edition,
  limit = 10,
): Promise<PaymentIntentView[]> {
  const res = await env.DB.prepare(
    "SELECT id, purpose, plan_code, plan_name, units, quantity, currency, subtotal_minor, tax_minor, " +
      "total_minor, gst_rate_pct, status, checkout_url, created_at FROM billing_payment_intents " +
      "WHERE edition = ? ORDER BY created_at DESC LIMIT ?",
  )
    .bind(edition, Math.max(1, Math.min(100, limit)))
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
  edition: Edition,
  cycle: BillingCycle,
  now: Date = new Date(),
): Promise<UsageTotals> {
  const res = await env.DB.prepare(
    "SELECT delta, created_at FROM credit_ledger WHERE edition = ? AND delta < 0",
  )
    .bind(edition)
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
