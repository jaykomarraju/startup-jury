/**
 * V6-INVOICE — the two invoice templates, and the record each one is rendered
 * from.
 *
 * ═══ 1. WHAT V6 ACTUALLY SAYS, MEASURED ════════════════════════════════════
 *
 * `docs/prototype/source/incubator/AISJ_MyAccount_V6.HTM`, read rather than
 * recalled:
 *
 *   `:2711`  "We use this to set your billing currency and generate your
 *            invoice. Indian billing addresses are charged in **INR with GST**;
 *            every other country is billed in **USD with no GST**."
 *   `:2784`  order summary — "GST-compliant invoice provided"
 *   `:3277`  the same line off-INR — "Invoice provided (no GST — billed outside
 *            India)"
 *   `:2807`  success screen — "GST-compliant invoice sent to your registered
 *            email · suitable for input tax credit"
 *   `:2810`  success screen — "Download invoice"
 *   `:3415`  `acDownloadInvoice()`, "rendered to match
 *            AISJ_Invoice_Template_V1.0.xlsx"
 *
 * **"LUT" DOES NOT APPEAR IN V6.** The brief for this lane says the file mentions
 * it 17 times; it does not mention it once. All 17 case-insensitive matches are
 * substrings — 16 × `position:abso{lut}e` in the stylesheet and 1 × `AI
 * SO{LUT}IONS` in the company name on the invoice header (`:3464`). "IGST"
 * appears zero times; the single occurrence of "export" (`:2843`) is a feature
 * bullet about report exports. Measured:
 *
 *     grep -o -iE "[a-z]*lut[a-z]*" AISJ_MyAccount_V6.HTM | sort | uniq -c
 *     → 16 absolute · 1 SOLUTIONS
 *
 * What V6 *does* draw off-INR is `isINR ? bank details : "Payment: Processed via
 * Razorpay · billed in USD, no GST (billing address outside India)"` (`:3478`).
 * So the **export template and its LUT declaration come from the client's 24-Sep
 * checklist, not from this mockup**, and the exact wording is theirs to confirm —
 * `LUT_DECLARATION` below is one editable constant for that reason, and the
 * handoff asks the question.
 *
 * ═══ 2. AN INVOICE IS A RECORD, NOT A VIEW ═════════════════════════════════
 *
 * Every number and every name on a tax document has to be the one that was true
 * when it was issued. A template that re-reads today's settings does not render
 * an old invoice — it rewrites one, silently, and the customer's copy and ours
 * stop matching the day an admin edits a rate.
 *
 * `renderInvoiceDocument` therefore takes a **fully materialised
 * `InvoiceRecord`** and reads no settings, no clock and no database. Byte
 * identity is then a property of the INPUT, which makes "what is not yet stored"
 * a single answerable question instead of a diffuse worry.
 *
 * SNAPSHOTTED in `billing_invoices` today, and so correct on a reissue: the
 * number, the issue date, the currency, the description, the units, subtotal /
 * tax / total in minor units, `gst_rate_pct`, `gst_registration`,
 * `place_of_supply`, `reference`. `0097`'s own header makes the point about the
 * rate; `0046` added the column for it.
 *
 * NOT snapshotted, and therefore read LIVE on every render — the declared gap,
 * enumerated in `UNSNAPSHOTTED_INVOICE_FIELDS` so it is greppable and testable
 * rather than a sentence in a comment:
 *
 *   • the buyer's name, billing address, GSTIN and billing email — these live in
 *     `org_settings.branding_json`, `billing_subscriptions` and (once the sibling
 *     lane lands it) the V6 billing-address table, all mutable;
 *   • the seller's registered address — not in the product at all.
 *
 * Closing it is one `ALTER TABLE` adding a `party_snapshot_json`, and migrations
 * need the shared `ALLOTMENT_CEILING` that two other lanes are also holding this
 * wave. It is the first item in `docs/parity-requests/V6-INVOICE.md` and it is
 * NOT fixed here.
 *
 * ═══ 3. WHICH TEMPLATE, AND WHY NOT FROM THE ADDRESS ═══════════════════════
 *
 * `invoiceTemplateOf` reads the invoice's **stored currency**. It deliberately
 * does not look at a country, an address or a live resolver:
 *
 *   • the country → currency rule is ONE rule and it belongs to
 *     `src/shared/plans.ts`, where the sibling lane is making it resolvable. Two
 *     implementations of "is this India" drift, and the one that drifts last wins
 *     on a legal document;
 *   • that rule answers at ORDER time. By render time the customer may have moved.
 *     `currency` is the frozen answer the order was actually priced under, which
 *     is the only answer a historical invoice may use.
 *
 * `place_of_supply` carries the country for the human to read; it is never what
 * picks the template, so a NULL (every row before the billing-address table) is a
 * missing line rather than the wrong document.
 *
 * ═══ 4. HONESTY, WHICH IS THE WHOLE POINT OF THIS MODULE ═══════════════════
 *
 * `EMAIL_FROM` is unset on every deployment, `ADAPTERS` in `provider.ts` is empty
 * by design, and `status='completed'` is unreachable. So:
 *
 *   • the GST / export heading is the **template**; whether the document is a tax
 *     invoice is the **payment state**. With payment unconfirmed both templates
 *     carry `NOT A TAX INVOICE · NO PAYMENT RECEIVED` — the band
 *     `routes/account.ts:596` already prints — and the ITC line is withheld,
 *     because a document issued against no payment cannot support input tax
 *     credit however compliant its layout;
 *   • the LUT declaration is withheld on an unpaid export document for the
 *     stronger reason that it is a **statement to the authorities about a supply
 *     that has not happened**. The pro-forma states the declaration that *will*
 *     apply instead;
 *   • the delivery line reports what the outbox DID — the 2026-10-02 correction,
 *     where a row was stamped `'sent'` forty lines before delivery was attempted.
 *     `invoiceDeliveryOf` reads `email_outbox` and reports `sent`, `failed`,
 *     `recorded` or `not_attempted`. **V6's "sent to your registered email" is
 *     never printed unless a row says it was sent.**
 *
 * Every one of those switches on data. Going live changes no line in this file.
 */

import type { Env } from "../types";
import { scoped, type TenantScope } from "../../shared/tenant";
// `gstApplies` is the SIBLING LANE's single predicate for "does GST apply to a
// price in this currency", extracted from `priceBreakdown` this wave. Imported
// rather than re-spelled, because its own header says why: "A second copy of
// `=== \"INR\"` is how a product ends up charging GST on a screen that says it
// does not" — and on this lane the second copy would be on a legal document.
import { formatMinor, gstApplies, type InvoiceView } from "../../shared/plans";
import { loadInvoice, readSubscription, readTaxSettings } from "./ledger";
import { storageAllowanceForSeats, type StorageAllowance } from "./storage";

// ── The record ───────────────────────────────────────────────────────────────

/** The two templates the client's 24-Sep checklist named. */
export type InvoiceTemplate = "gst_tax_invoice" | "export_invoice";

/**
 * Fields a reissued invoice reads LIVE because no column holds them yet.
 *
 * Exported so the gap is one grep and one assertion rather than prose. A test
 * pins the list; when the snapshot column lands, entries leave this array and the
 * test moves with them.
 */
export const UNSNAPSHOTTED_INVOICE_FIELDS: readonly string[] = [
  // `account_profiles.billing_name` / `_address` / `_city` / `_country` (`0104`)
  // and `billing_subscriptions.billing_email` / `gstin` — all editable from the
  // billing screen, so a reissue follows today's values.
  "buyer.name",
  "buyer.addressLines",
  "buyer.country",
  "buyer.gstin",
  "buyer.email",
  // Not stored anywhere in the product; see `SELLER_LEGAL_NAME`.
  "seller.addressLines",
];

export interface InvoiceParty {
  name: string;
  /** Free-form address lines. Empty when the product does not hold an address. */
  addressLines: readonly string[];
  gstin: string | null;
  email: string | null;
  /** The billing country, when one is recorded. */
  country: string | null;
}

/**
 * What actually happened to the money, as the payment intent recorded it.
 *
 * `"unconfirmed"` is the state of every document this build can produce: either
 * the invoice has no linked intent (`0046`'s seeded rows) or the intent is
 * `recorded` / `redirected` / `failed`. Only a provider webhook writing
 * `completed` moves a document out of pro-forma, which is the one line
 * `provider.ts` reserves for going live.
 */
export type InvoicePaymentState = "unconfirmed" | "completed";

export interface InvoicePayment {
  state: InvoicePaymentState;
  /** The intent id or the provider's own transaction reference. */
  reference: string | null;
  /** `billing_payment_intents.status`, verbatim, when there is an intent. */
  intentStatus: string | null;
}

/** What the outbox DID with this invoice — never what we hope it will do. */
export type InvoiceDeliveryState = "not_attempted" | "recorded" | "sent" | "failed";

export interface InvoiceDelivery {
  state: InvoiceDeliveryState;
  to: string | null;
  attemptedAt: string | null;
  /** `email_outbox.error`, when the attempt failed. */
  reason: string | null;
}

export interface InvoiceRecord {
  id: string;
  number: string;
  /** ISO date-time, exactly as stored. Never `new Date()`. */
  issuedAt: string;
  currency: string;
  description: string;
  /** Credits the purchase granted, when it granted any. */
  units: number | null;
  /** Seats the subscription carries, for the storage line. */
  seats: number;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  ratePct: number;
  placeOfSupply: string | null;
  seller: InvoiceParty;
  buyer: InvoiceParty;
  payment: InvoicePayment;
  delivery: InvoiceDelivery;
  storage: StorageAllowance;
}

// ── The seller ───────────────────────────────────────────────────────────────

/**
 * The supplier block, as V6's own invoice header states it (`:3464`, `:3484`).
 *
 * `addressLines` is EMPTY and that is not an oversight: a GST tax invoice must
 * carry the supplier's registered address, and this product stores it nowhere —
 * not in `pricing_settings`, which holds only `gst_registration`, and not in
 * `org_settings`, which is the *customer's* branding. Inventing one would put a
 * fabricated address on a legal document, so the block is omitted and the
 * requirement is in the handoff. `gstin` comes from `pricing_settings` at render
 * time via `sellerParty`, which is the one seller field that IS configurable.
 */
export const SELLER_LEGAL_NAME = "STARTUPJURY AI SOLUTIONS PRIVATE LIMITED";
export const SELLER_SUPPORT_EMAIL = "support@startupjury.ai";

/**
 * The export declaration, in the form the client's 24-Sep checklist named.
 *
 * One constant, because the exact wording is a question for the client's CA and
 * because V6 does not state it (see the module header). The alternative form —
 * supply on payment of IGST, claimed as a refund — is a different sentence and a
 * different tax position, so this is not a string to guess at in a template.
 */
export const LUT_DECLARATION = "Supply meant for export under LUT without payment of IGST";

function sellerParty(gstin: string | null): InvoiceParty {
  return {
    name: SELLER_LEGAL_NAME,
    addressLines: [],
    gstin,
    email: SELLER_SUPPORT_EMAIL,
    country: "India",
  };
}

// ── Which template ───────────────────────────────────────────────────────────

/**
 * The template this stored invoice is, decided from the record alone.
 *
 * `null` means the record CONTRADICTS ITSELF — a non-INR invoice carrying tax.
 * That cannot be rendered either way: an export invoice would declare "without
 * payment of IGST" over a line that charged it, and a GST invoice would be in the
 * wrong currency. The caller's job is to refuse the download and say so, not to
 * pick the less wrong document. Reachable only through a direct write, which is
 * exactly why it is checked here rather than assumed away — `priceBreakdown` has
 * returned `taxMinor: 0` off-INR only since Wave 4 integration, and rows written
 * before it are still in the table.
 */
export function invoiceTemplateOf(record: {
  currency: string;
  taxMinor: number;
}): InvoiceTemplate | null {
  if (gstApplies(record.currency)) return "gst_tax_invoice";
  return record.taxMinor > 0 ? null : "export_invoice";
}

/** True only for a GST tax invoice against a confirmed payment. */
export function supportsInputTaxCredit(record: InvoiceRecord): boolean {
  return (
    invoiceTemplateOf(record) === "gst_tax_invoice" &&
    record.payment.state === "completed" &&
    record.buyer.gstin !== null
  );
}

/**
 * The document's own title — the template, qualified by what was paid.
 *
 * The *layout* is the GST (or export) invoice either way; the title is what the
 * document legally IS. Every build today produces the pro-forma titles, and
 * nothing here changes when one does not.
 */
export function invoiceTitleOf(record: InvoiceRecord): string {
  const paid = record.payment.state === "completed";
  switch (invoiceTemplateOf(record)) {
    case "gst_tax_invoice":
      return paid ? "Tax invoice" : "Pro-forma tax invoice";
    case "export_invoice":
      return paid ? "Export invoice" : "Pro-forma export invoice";
    default:
      return "Invoice";
  }
}

/**
 * The delivery sentence. V6's "sent to your registered email" is one of four
 * possible sentences and the only one that requires a row saying `sent`.
 */
export function deliverySentence(delivery: InvoiceDelivery): string {
  const to = delivery.to ? ` to ${delivery.to}` : "";
  const on = delivery.attemptedAt ? ` on ${delivery.attemptedAt.slice(0, 10)}` : "";
  switch (delivery.state) {
    case "sent":
      return `Emailed${to}${on}.`;
    case "failed":
      return (
        `Email${to} failed${on}${delivery.reason ? ` — ${delivery.reason}` : ""}. ` +
        "This copy is the one to keep."
      );
    case "recorded":
      return (
        `Recorded for delivery${to}${on} but NOT emailed — this deployment has no verified ` +
        "sending domain. Download this copy."
      );
    default:
      return "Not emailed. Email delivery is not configured on this deployment — download this copy.";
  }
}

// ── Reading the record ───────────────────────────────────────────────────────

/**
 * The dedupe key an invoice email would carry.
 *
 * Id-derived, and `billing_invoices.id` is globally unique, so the key is
 * tenant-safe for the reason `outbox.ts`'s header gives: `idx_outbox_dedupe` is a
 * GLOBAL unique index and the KEY STRINGS are what carry the tenant.
 */
export function invoiceEmailDedupeKey(invoiceId: string): string {
  return `invoice:${invoiceId}`;
}

/**
 * What the outbox did with this invoice's email.
 *
 * Reads, never writes. **Nothing in this wave sends the invoice email** — doing
 * so needs one more member on `EmailKind` in `src/server/email/outbox.ts`, which
 * is another lane's file (the ask is in the handoff). Until then every invoice
 * reports `not_attempted`, which is the true answer, and the day the kind is
 * added this function reports the real outcome with no change here.
 *
 * Deliberately matched to `idx_outbox_dedupe`'s GLOBAL shape — `dedupe_key` only
 * — for the reason `outbox.ts`'s `findByDedupeKey` documents at length: a lookup
 * scoped tighter than the unique index it guards misses the row and then collides
 * on insert. `tenant_id` is selected and CHECKED instead, so a key that somehow
 * crossed customers reports `not_attempted` rather than another customer's
 * delivery status.
 */
export async function invoiceDeliveryOf(
  env: Env,
  scope: TenantScope,
  invoiceId: string,
  to: string | null,
): Promise<InvoiceDelivery> {
  const row = await env.DB.prepare(
    "SELECT status, to_email, created_at, error, tenant_id FROM email_outbox WHERE dedupe_key = ?",
  )
    .bind(invoiceEmailDedupeKey(invoiceId))
    .first<{
      status: string;
      to_email: string;
      created_at: string;
      error: string | null;
      tenant_id: string;
    }>();
  if (!row) return { state: "not_attempted", to, attemptedAt: null, reason: null };
  if (row.tenant_id !== scope.tenantId) {
    console.error(
      `invoice delivery: dedupe key for ${invoiceId} belongs to ${row.tenant_id}, not ${scope.tenantId}`,
    );
    return { state: "not_attempted", to, attemptedAt: null, reason: null };
  }
  const state: InvoiceDeliveryState =
    row.status === "sent" ? "sent" : row.status === "failed" ? "failed" : "recorded";
  return {
    state,
    to: row.to_email ?? to,
    attemptedAt: row.created_at,
    reason: row.error,
  };
}

/**
 * The payment state behind an invoice.
 *
 * `billing_invoices.intent_id` is the link, and it is NULL for `0046`'s seeded
 * rows and for every invoice `issueMissingInvoices` writes from the ledger. A
 * missing intent is `unconfirmed`: the seeded rows carry a `reference` that LOOKS
 * like a Razorpay transaction id, and treating that string as proof of payment is
 * precisely the failure §1.3 exists to prevent — demo data would promote itself
 * to a tax invoice.
 */
async function paymentOf(
  env: Env,
  scope: TenantScope,
  invoice: InvoiceView & { intentId: string | null },
): Promise<InvoicePayment> {
  if (!invoice.intentId) {
    return { state: "unconfirmed", reference: invoice.reference, intentStatus: null };
  }
  const q = scoped(scope).on("p").and("p.id = ?", invoice.intentId);
  const row = await env.DB.prepare(
    `SELECT p.status, p.provider_ref FROM billing_payment_intents p ${q.whereClause()}`,
  )
    .bind(...q.binds)
    .first<{ status: string; provider_ref: string | null }>();
  return {
    state: row?.status === "completed" ? "completed" : "unconfirmed",
    reference: row?.provider_ref ?? invoice.reference ?? invoice.intentId,
    intentStatus: row?.status ?? null,
  };
}

/**
 * Assemble the record behind one invoice — the only function here that touches
 * the database, so that `renderInvoiceDocument` stays provably a pure function of
 * what was stored.
 *
 * The scoped reads matter as much as the arithmetic: a customer's own trading
 * name goes on their tax invoice, so an unscoped `org_settings` read prints one
 * customer's branding on another's GST document (§2 B16, §11 — the session owning
 * the FILE scopes the statement, whoever owns the table).
 */
export async function loadInvoiceRecord(
  env: Env,
  scope: TenantScope,
  id: string,
  fallbackName: string,
): Promise<InvoiceRecord | null> {
  const invoice = await loadInvoice(env, scope, id);
  if (!invoice) return null;

  // `intent_id` and `place_of_supply` are both STORED on the invoice and neither
  // is on `InvoiceView` (`src/shared/plans.ts`, another lane's file this wave), so
  // they are read here rather than re-derived — which for place of supply would
  // mean guessing a state from a currency.
  const intentQ = scoped(scope).on("v").and("v.id = ?", id);
  const link = await env.DB.prepare(
    `SELECT v.intent_id, v.place_of_supply FROM billing_invoices v ${intentQ.whereClause()}`,
  )
    .bind(...intentQ.binds)
    .first<{ intent_id: string | null; place_of_supply: string | null }>();

  const subscription = await readSubscription(env, scope);
  const tax = await readTaxSettings(env);

  // The V6 billing address (`0104`, the sibling lane's four columns on
  // `account_profiles`). "Name or company to appear on the invoice" is literally
  // what the field is for, so when it is filled it OUTRANKS the workspace's
  // trading name below.
  //
  // Read LIVE and listed in `UNSNAPSHOTTED_INVOICE_FIELDS`: these four columns are
  // editable from the billing screen, so a reissue follows today's address rather
  // than the one the invoice was issued to. `0104` is four nullable columns and
  // adds no snapshot, by its own header's reasoning — closing that is the
  // `party_snapshot_json` ask in the handoff, not something this read can fix.
  const billQ = scoped(scope).on("a");
  const bill = await env.DB.prepare(
    "SELECT a.billing_name, a.billing_city, a.billing_country, a.billing_address " +
      `FROM account_profiles a ${billQ.whereClause()}`,
  )
    .bind(...billQ.binds)
    .first<{
      billing_name: string | null;
      billing_city: string | null;
      billing_country: string | null;
      billing_address: string | null;
    }>();

  const orgQ = scoped(scope).on("o");
  const org = await env.DB.prepare(
    `SELECT o.branding_json FROM org_settings o ${orgQ.whereClause()}`,
  )
    .bind(...orgQ.binds)
    .first<{ branding_json: string | null }>();
  let buyerName = fallbackName;
  try {
    const parsed = JSON.parse(org?.branding_json ?? "{}") as { orgName?: string };
    if (parsed.orgName) buyerName = parsed.orgName;
  } catch {
    // Branding is free-form JSON written by the Set up wizard; a malformed blob
    // must not stop an invoice being issued.
  }

  const payment = await paymentOf(env, scope, { ...invoice, intentId: link?.intent_id ?? null });
  const billingEmail = subscription.billingEmail;

  return {
    id: invoice.id,
    number: invoice.number,
    issuedAt: invoice.issuedAt,
    currency: invoice.currency,
    description: invoice.description,
    units: invoice.units,
    seats: subscription.seats,
    subtotalMinor: invoice.subtotalMinor,
    taxMinor: invoice.taxMinor,
    totalMinor: invoice.totalMinor,
    // SNAPSHOTTED, and the reason this module exists: the rate the document was
    // issued under, not `tax.ratePct`. An admin raising GST to 28 % must not
    // rewrite an invoice the customer filed at 18 %.
    ratePct: invoice.ratePct,
    // SNAPSHOTTED (`0046` added the column). NULL on every row issued from the
    // ledger, because nothing stores a billing country yet; a missing line, never
    // a wrong document — see the module header, §3.
    placeOfSupply: link?.place_of_supply ?? null,
    seller: sellerParty(tax.registration),
    buyer: {
      // "Name or company to appear on the invoice" (V6 `:2715`) first; the
      // workspace's trading name only when nobody filled the billing screen.
      name: bill?.billing_name?.trim() || buyerName,
      addressLines: [
        // The textarea is multi-line; each line is a line on the invoice.
        ...(bill?.billing_address ?? "")
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean),
        bill?.billing_city?.trim() || null,
      ].filter((l): l is string => Boolean(l)),
      gstin: subscription.gstin,
      email: billingEmail,
      country: bill?.billing_country?.trim() || null,
    },
    payment,
    delivery: await invoiceDeliveryOf(env, scope, invoice.id, billingEmail),
    storage: storageAllowanceForSeats(subscription.seats),
  };
}

// ── The document ─────────────────────────────────────────────────────────────

const escapeHtml = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch,
  );

/**
 * Mobile-first, because this is a document people open on a phone from an email
 * or a success screen — and because ten screens in this product already carry a
 * table wider than the viewport from being built desktop-first and retrofitted.
 *
 * The rules this stylesheet keeps, at 390 px:
 *   • one column, `padding:16px` on `body` — the 16 px side gutter, from the
 *     first declaration rather than a media query;
 *   • **no `min-width` anywhere.** The line-items table is `width:100%` with
 *     `table-layout:fixed` and a wrapping description cell, so four columns
 *     compress instead of forcing a page scroll. `.scroll` wraps it in its own
 *     `overflow-x:auto` so an un-breakable string scrolls the TABLE, never the
 *     page;
 *   • the label/value meta rows stack by default and only become two columns at
 *     ≥ 560 px, so a 200 px label column never eats a 358 px content box the way
 *     `routes/account.ts:586`'s `th{width:200px}` does;
 *   • `@media print` strips the chrome, because "download" here means a page the
 *     browser prints to PDF — `routes/billing.ts` explains why a PDF writer is
 *     not on this critical path.
 */
const STYLE = `
*{box-sizing:border-box}
body{margin:0;padding:16px;font:14px/1.55 -apple-system,"Segoe UI",Roboto,sans-serif;
 color:#1A1E2E;background:#F4F4F2}
.doc{max-width:720px;margin:0 auto;background:#fff;border:1px solid #E8E3D9;border-radius:10px;
 overflow:hidden}
.hd{padding:18px 16px;background:#3F4A2E;color:#fff}
.hd .co{font-size:13px;font-weight:700;letter-spacing:.02em;margin:0 0 6px}
.hd h1{font-size:19px;margin:0;font-weight:700}
.hd .no{font-size:12.5px;opacity:.88;margin-top:4px}
.band{margin:0;padding:10px 16px;background:#FDF4E3;color:#8A5A00;border-bottom:1px solid #F0E0BC;
 font-size:12px;font-weight:700;letter-spacing:.04em}
.sec{padding:16px;border-bottom:1px solid #EFEBE3}
.sec:last-child{border-bottom:none}
.sec h2{font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#6B6355;
 margin:0 0 10px}
.party{margin:0 0 4px;font-weight:600}
.party+.line,.line{margin:0;color:#4A4A48;font-size:13px}
.kv{display:grid;grid-template-columns:1fr;gap:2px 16px;margin:0}
.kv>dt{font-size:12px;color:#6B6355}
.kv>dd{margin:0 0 8px;font-weight:600;word-break:break-word}
.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
table{width:100%;border-collapse:collapse;table-layout:fixed}
th,td{padding:8px 6px;font-size:12.5px;text-align:right;border-bottom:1px solid #EFEBE3;
 vertical-align:top}
th{font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:#6B6355;font-weight:700}
th:first-child,td:first-child{text-align:left;width:46%;word-break:break-word}
tr.sum td{border-bottom:none;padding-top:6px;padding-bottom:2px}
tr.tot td{border-top:2px solid #3F4A2E;border-bottom:none;font-size:15px;font-weight:700;
 padding-top:8px}
.note{margin:0 0 8px;font-size:12px;color:#4A4A48}
.note.decl{font-weight:600;color:#1A1E2E}
.ft{padding:14px 16px;font-size:11.5px;color:#6B6355;background:#FAF9F6}
@media (min-width:560px){
 body{padding:24px}
 .hd,.sec,.ft{padding-left:24px;padding-right:24px}
 .band{padding-left:24px;padding-right:24px}
 .kv{grid-template-columns:170px 1fr}
 .kv>dd{margin-bottom:4px}
}
@media print{
 body{background:#fff;padding:0}
 .doc{border:none;border-radius:0}
}
`;

function kv(rows: readonly (readonly [string, string | null])[]): string {
  const live = rows.filter((r): r is readonly [string, string] => Boolean(r[1]));
  if (live.length === 0) return "";
  return `<dl class="kv">${live
    .map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`)
    .join("")}</dl>`;
}

function partyBlock(heading: string, party: InvoiceParty, placeOfSupply: string | null): string {
  const lines = [
    ...party.addressLines,
    party.country,
    party.gstin ? `GSTIN ${party.gstin}` : null,
    party.email,
    placeOfSupply ? `Place of supply: ${placeOfSupply}` : null,
  ].filter((l): l is string => Boolean(l));
  return (
    `<div class="sec"><h2>${escapeHtml(heading)}</h2>` +
    `<p class="party">${escapeHtml(party.name)}</p>` +
    lines.map((l) => `<p class="line">${escapeHtml(l)}</p>`).join("") +
    `</div>`
  );
}

/**
 * Render one of the two templates from a stored record.
 *
 * **Pure.** No `Date`, no `env`, no settings read — see the module header. That
 * is what makes a reissue byte-identical for every snapshotted field, and it is
 * asserted by calling this twice on one record and comparing the strings.
 *
 * Returns `null` for a self-contradictory record (see `invoiceTemplateOf`); the
 * route turns that into a refusal rather than a wrong document.
 */
export function renderInvoiceDocument(record: InvoiceRecord): string | null {
  const template = invoiceTemplateOf(record);
  if (template === null) return null;

  const gst = template === "gst_tax_invoice";
  const paid = record.payment.state === "completed";
  const money = (m: number) => formatMinor(m, record.currency);
  const title = invoiceTitleOf(record);

  const lineDescription = [
    record.description,
    record.units !== null ? `${record.units} credits` : null,
    // 10 GB per seat, carried from the seat model and never typed into copy.
    record.seats > 0 ? record.storage.totalLabel : null,
  ]
    .filter((p): p is string => Boolean(p))
    .join(" · ");

  const taxRow = gst
    ? `<tr class="sum"><td colspan="3">GST (${escapeHtml(record.ratePct.toFixed(record.ratePct % 1 === 0 ? 0 : 2))}%)</td>` +
      `<td>${escapeHtml(money(record.taxMinor))}</td></tr>`
    : `<tr class="sum"><td colspan="3">GST</td><td>Not applicable</td></tr>`;

  // The declaration, and the reason it is conditional: an LUT declaration is a
  // statement to the authorities about a supply that HAS been made. On an unpaid
  // document it would be false, so the pro-forma states the position that will
  // apply instead of asserting one that has not.
  const declaration = !gst
    ? paid
      ? `<p class="note decl">${escapeHtml(LUT_DECLARATION)}</p>`
      : `<p class="note decl">On payment, this supply will be invoiced under LUT without payment of IGST ` +
        `— ${escapeHtml(LUT_DECLARATION.toLowerCase())}.</p>`
    : "";

  const itc = gst
    ? supportsInputTaxCredit(record)
      ? `<p class="note">GST-compliant tax invoice · suitable for input tax credit.</p>`
      : `<p class="note">This document uses the GST tax-invoice format, but no payment has been ` +
        `received against it, so it <b>cannot be used to claim input tax credit</b>. A tax invoice ` +
        `is issued once payment is confirmed.</p>`
    : `<p class="note">Billed outside India — no GST applied. The customer is responsible for any ` +
      `VAT, GST or equivalent due in their own jurisdiction.</p>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(record.number)} — ${escapeHtml(title)}</title>
<style>${STYLE}</style></head><body>
<div class="doc">
 <div class="hd">
  <p class="co">${escapeHtml(record.seller.name)}</p>
  <h1>${escapeHtml(title)}</h1>
  <p class="no">${escapeHtml(record.number)} · ${escapeHtml(record.issuedAt.slice(0, 10))}</p>
 </div>
 ${paid ? "" : `<p class="band">NOT A TAX INVOICE · NO PAYMENT RECEIVED</p>`}
 ${partyBlock("Supplier", record.seller, null)}
 ${partyBlock("Billed to", record.buyer, record.placeOfSupply)}
 <div class="sec">
  <div class="scroll"><table>
   <thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>
   <tbody>
    <tr><td>${escapeHtml(lineDescription)}</td><td>1</td><td>${escapeHtml(money(record.subtotalMinor))}</td><td>${escapeHtml(money(record.subtotalMinor))}</td></tr>
    <tr class="sum"><td colspan="3">Subtotal</td><td>${escapeHtml(money(record.subtotalMinor))}</td></tr>
    ${taxRow}
    <tr class="tot"><td colspan="3">Total${gst ? " (incl. GST)" : ""}</td><td>${escapeHtml(money(record.totalMinor))}</td></tr>
   </tbody>
  </table></div>
 </div>
 <div class="sec"><h2>Payment</h2>
  ${kv([
    ["Status", paid ? "Paid" : "No payment received"],
    ["Reference", record.payment.reference],
    ["Recorded as", record.payment.intentStatus],
    ["Currency", record.currency],
  ])}
 </div>
 <div class="sec"><h2>Notes</h2>
  ${declaration}
  ${itc}
  <p class="note">${escapeHtml(deliverySentence(record.delivery))}</p>
 </div>
 <div class="ft">Queries to ai.STARTUPJURY · ${escapeHtml(record.seller.email ?? "")}</div>
</div>
</body></html>`;
}
