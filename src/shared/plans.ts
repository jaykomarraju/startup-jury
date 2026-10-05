/**
 * Plan tiers shared by client and server. The tier gates how much of the
 * evaluation rubric a role may configure (per the prototype's PLAN_META):
 *   • Standard — no parameter configuration at all.
 *   • Pro      — configure the 13 core weighted areas (weights + names).
 *   • Premium  — everything in Pro PLUS the 3 role-scoped additional params.
 */
export type Plan = "standard" | "pro" | "premium";

export const PLANS: readonly Plan[] = ["standard", "pro", "premium"];

export const PLAN_LABELS: Record<Plan, string> = {
  standard: "Standard",
  pro: "Pro",
  premium: "Premium",
};

/** One-line privilege summary per tier (matches the prototype's PLAN_PRIV). */
export const PLAN_PRIVILEGES: Record<Plan, string> = {
  standard: "Cannot configure evaluation parameters.",
  pro: "Can configure the 13 core parameters.",
  premium: "Can configure all 13 core parameters plus 3 additional parameters.",
};

const PLAN_RANK: Record<Plan, number> = { standard: 0, pro: 1, premium: 2 };

/** One row of the Seat-configurability grid: may this tier configure this set? */
export type PlanCapability = Readonly<Record<Plan, boolean>>;

/**
 * Configuring the 13 core weighted areas requires Pro or above **by default**.
 *
 * V3 item 12 made that ladder configurable. The v3 console's *Seat
 * configurability* card (`cfg-table`, inside the base64 admin console) turns
 * "which tier may configure which parameter set" into six toggles, and its
 * stated defaults — "Standard — none · Pro — core only · Premium — core +
 * additional" — are precisely `PLAN_RANK`'s ladder. So this function and its
 * sibling keep their signature and their answer: pass no capability and
 * nothing has changed. `src/server/routes/config.ts` passes the org's
 * persisted grid (`seat_capabilities`, migration 0071) instead.
 *
 * The grid is per-tier booleans, not a rank, so an administrator may now make
 * it non-monotonic (Standard on, Pro off). That is what the prototype's six
 * independent toggles allow, and it is why these read a cell rather than
 * comparing ranks.
 */
export function planAllowsCore(plan: Plan, capability?: PlanCapability): boolean {
  if (capability) return capability[plan] === true;
  return PLAN_RANK[plan] >= PLAN_RANK.pro;
}

/** The role-scoped additional / informational parameters require Premium by default. */
export function planAllowsAdditional(plan: Plan, capability?: PlanCapability): boolean {
  if (capability) return capability[plan] === true;
  return PLAN_RANK[plan] >= PLAN_RANK.premium;
}

export function isPlan(v: unknown): v is Plan {
  return typeof v === "string" && (PLANS as readonly string[]).includes(v);
}

// ─────────────────────────────────────────────────────────────────────────────
// W4-C · Credits & billing — the published catalogue, money, tax and the cycle.
//
// This half of the file is the seam between `W4-C` (which READS published
// prices) and `W4-D` (which writes the catalogue): the types below are what a
// price row looks like once it has left `price_plans` / `price_amounts`, and
// the arithmetic below is the only place the application is allowed to do sums
// on money.
//
// Two rules govern every line of it:
//
//   1. **Money is integer minor units.** Paise, cents. No float ever touches a
//      rupee figure, because `0.18 * 999_00` is not what a ledger means by 18 %.
//      Percentages are held as hundredths of a percent (18 % → 1800) so the
//      whole computation stays in integers.
//   2. **§8 Q1, ruled 2026-09-11: there is no per-deck pricing.** No per-deck
//      rate, no derived "₹X per deck" column and no saving computed against a
//      base rate may be rendered. The catalogue still carries such strings in
//      seeded columns (`price_amounts.per_unit_label`, enterprise taglines like
//      "Save ₹10,000 vs base"), so the publisher below STRIPS them on the way
//      out rather than trusting every call site to remember. This is a ruling on
//      the catalogue, not on metering: a deck still costs exactly one credit,
//      which is usage accounting.
// ─────────────────────────────────────────────────────────────────────────────

/** The four catalogue groups `price_plans.plan_group` holds. */
export type PlanGroup = "free_trial" | "subscription" | "credit_pack" | "enterprise";

/**
 * V3-PT widened this with `quarter` and `half_year` so the seat catalogue and
 * the plan tiers keep ONE period vocabulary. The DB column is unchanged — see
 * `periodOf()` and `migrations/0073_seat_pricing_v3.sql` for why a quarterly
 * plan stores `period = NULL, period_months = 3`.
 */
export type BillingPeriod = "month" | "quarter" | "half_year" | "year" | "one_time";

/** One published price: a catalogue row resolved into a single currency. */
export interface PublishedPlan {
  code: string;
  group: PlanGroup;
  name: string;
  badge: string | null;
  tagline: string | null;
  features: string | null;
  /** Credits the purchase grants. Null for a metered subscription. */
  units: number | null;
  period: BillingPeriod | null;
  currency: string;
  /** The stated price, exclusive or inclusive of tax per `TaxSettings`. */
  amountMinor: number;
}

/** `pricing_settings`, as the screens need it. */
export interface TaxSettings {
  ratePct: number;
  registration: string | null;
  /** Stated prices already contain the tax. */
  inclusive: boolean;
  /** Show the "customer is responsible for local VAT/GST" note off-INR. */
  internationalNotice: boolean;
}

export const GST_DEFAULT_RATE_PCT = 18;

// ── Money ────────────────────────────────────────────────────────────────────

/** A percentage as hundredths of a percent: 18 → 1800, 18.5 → 1850. */
function basisOf(ratePct: number): number {
  if (!Number.isFinite(ratePct) || ratePct < 0) return 0;
  return Math.round(ratePct * 100);
}

/** Half-up division of integers — `round(n / d)` with no float in sight. */
function divideHalfUp(n: number, d: number): number {
  return Math.floor((n + Math.floor(d / 2)) / d);
}

export interface TaxBreakdown {
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  ratePct: number;
  /** True when the stated price already contained the tax. */
  inclusive: boolean;
  /**
   * False when GST does not apply to this price at all — every non-base
   * currency. `src/shared/priceBook.ts` carries the same flag by the same name
   * for the same reason; see `priceBreakdown`.
   */
  taxed: boolean;
}

/**
 * Tax ADDED to a stated price (the default — `prices_include_gst = 0`).
 *
 * Rounded half-up to the minor unit. The prototype does this two different
 * ways in two different flows — `Math.floor(p * 0.18)` in the account overlay
 * and `Math.round(sub * 0.18)` in the seat flow, both on whole rupees — so it
 * cannot be copied; see §8. Half-up on the minor unit is the rule here: it is
 * what an invoice line means by 18 %, it never loses a fraction of a paisa to
 * the house, and every pack in the catalogue is a whole-rupee amount whose 18 %
 * is exact anyway (₹20,000 → ₹3,600.00).
 */
export function taxOnExclusive(subtotalMinor: number, ratePct: number): TaxBreakdown {
  const subtotal = Math.max(0, Math.trunc(subtotalMinor));
  const taxMinor = divideHalfUp(subtotal * basisOf(ratePct), 10_000);
  return {
    subtotalMinor: subtotal,
    taxMinor,
    totalMinor: subtotal + taxMinor,
    ratePct,
    inclusive: false,
    taxed: true,
  };
}

/**
 * Tax EXTRACTED from a stated price (`prices_include_gst = 1`).
 *
 * The total is the figure the customer was shown, so it is held fixed and the
 * tax is the remainder — `subtotal + tax === total` exactly, always, which is
 * the property an invoice cannot be allowed to fail.
 */
export function taxFromInclusive(totalMinor: number, ratePct: number): TaxBreakdown {
  const total = Math.max(0, Math.trunc(totalMinor));
  const basis = basisOf(ratePct);
  const subtotalMinor = divideHalfUp(total * 10_000, 10_000 + basis);
  return {
    subtotalMinor,
    taxMinor: total - subtotalMinor,
    totalMinor: total,
    ratePct,
    inclusive: true,
    taxed: true,
  };
}

/** The currency GST applies to. Everything else is stated exclusive of local tax. */
export const BASE_CURRENCY = "INR";

/**
 * Does GST apply to a price in this currency?
 *
 * Extracted from `priceBreakdown`'s first line — which read
 * `currency !== BASE_CURRENCY` and still means exactly that, byte for byte — so
 * that `resolveBillingLocale` below cannot answer the question differently. The
 * arithmetic is untouched; only the predicate now has a name, and there is one
 * of it. A second copy of `=== "INR"` is how a product ends up charging GST on
 * a screen that says it does not.
 */
export function gstApplies(currency: string | null | undefined): boolean {
  return currency === BASE_CURRENCY;
}

/**
 * The breakdown for `amountMinor` under the org's tax settings.
 *
 * **GST is the INR-billing tax.** The prototype states the rule once — "GST at
 * 18% added at checkout for INR billing. International pricing shown exclusive
 * of local taxes" — and `src/shared/priceBook.ts` (`taxBreakdown`) implements
 * exactly that for the catalogue. This function is the billing side of the same
 * rule, so it takes the price's `currency` and agrees with it: on INR the two
 * produce identical minor units, and off INR both state the price untaxed.
 *
 * Wave 4 integration added the parameter. Before it, this function taxed
 * whatever it was handed, so a USD plan was advertised tax-free by the
 * catalogue and charged 18 % more at checkout, while the very card showing the
 * GST line ALSO showed "customers are responsible for local VAT/GST". Nothing
 * could reach it — `billing_subscriptions.currency` defaults to 'INR' and no
 * route sets it otherwise — but W4-D's seven-currency catalogue exists to make
 * that settable, so the divergence was armed rather than harmless.
 *
 * `currency` is optional and defaults to the base: an INR-only caller is
 * unaffected, which is every caller that existed before.
 */
export function priceBreakdown(
  amountMinor: number,
  tax: TaxSettings,
  currency: string = BASE_CURRENCY,
): TaxBreakdown {
  if (!gstApplies(currency)) {
    const amount = Math.max(0, Math.trunc(amountMinor));
    return {
      subtotalMinor: amount,
      taxMinor: 0,
      totalMinor: amount,
      ratePct: tax.ratePct,
      inclusive: tax.inclusive,
      taxed: false,
    };
  }
  return tax.inclusive
    ? taxFromInclusive(amountMinor, tax.ratePct)
    : taxOnExclusive(amountMinor, tax.ratePct);
}

// ─────────────────────────────────────────────────────────────────────────────
// V6-CURRENCY · the BILLING ADDRESS decides the currency, and the currency
// decides GST.
//
// `AISJ_MyAccount_V6.HTM`'s billing screen (`#acs-billing`) states the rule in
// the sub-line, verbatim:
//
//   "We use this to set your billing currency and generate your invoice. Indian
//    billing addresses are charged in INR with GST; every other country is
//    billed in USD with no GST."
//
// Before this block NOTHING in the product mapped a country to a currency: the
// client sent `currency` with the order and the server priced whatever it was
// handed. That is the whole defect — the billing address was collected (by the
// org screen, for an organisation only) and then never consulted.
//
// ── THREE RULES THIS BLOCK HOLDS ITSELF TO ──────────────────────────────────
//
//  1. **One place answers it.** `billingCurrencyFor` is the only country →
//     currency map in the repo, `gstApplies` is the only "does GST apply", and
//     `resolveBillingLocale` composes them. The screens, the order route and the
//     invoice all read the same answer.
//  2. **The rate is a SETTING, never a literal here.** `resolveBillingLocale`
//     takes `TaxSettings` and reports `tax.ratePct`; it does not spell `18`.
//     `GST_DEFAULT_RATE_PCT` above is the one default in the file, and the
//     configured rate beats it. This product already grew four low-credit
//     thresholds by putting a constant next to a setting; a second GST rate
//     would be the same mistake with money on it.
//  3. **Nothing is derived and then stored.** There is no `billing_currency`
//     column (`0104` deliberately adds none): the currency is a function of the
//     country, so storing it creates two answers that drift. The currency an
//     order was actually priced in IS persisted — on the intent — because that
//     is a historical fact, not a derivation.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * V6: "every other country is billed in USD with no GST". One constant, so the
 * non-Indian branch is named rather than spelled at each call site.
 */
export const INTERNATIONAL_CURRENCY = "USD";

/**
 * How a typed billing country can spell India.
 *
 * V6's field is an `<input list="bill-country-list">` — a datalist is a HINT,
 * not a constraint, so the value is free text and "IN" or "Bharat" reach the
 * server. The prototype's own check is `c==='india'||c==='in'||c==='bharat'`;
 * the two added here are the ISO-3 code and the long form, which a paste or an
 * autofill produces. Everything else is international, which is the safe
 * direction to err: a country this list fails to recognise is billed USD with
 * no GST, i.e. we do not collect a tax we then cannot attribute.
 */
const INDIA_COUNTRY_NAMES: readonly string[] = ["india", "in", "ind", "bharat", "republic of india"];

/** Does this billing country make the customer an Indian-GST customer? */
export function isIndianBillingCountry(country: string | null | undefined): boolean {
  if (typeof country !== "string") return false;
  return INDIA_COUNTRY_NAMES.includes(country.trim().toLowerCase());
}

/**
 * The ONE currency a customer with this billing country may be billed in, or
 * `null` when no billing country is on file.
 *
 * **`null` is load-bearing and is not a default.** Production holds two
 * `account_profiles` rows written before a billing address could be captured at
 * all, and `0104`'s new columns are NULL on both. Answering "INR" for them
 * would start adding 18 % GST to what they are quoted; answering "USD" would
 * stop charging GST that may be due. Both are a billing change made by a
 * migration, which is not a migration's business. So an unrecorded country
 * resolves to `null`, the order route leaves the currency alone exactly as it
 * does today, and the V6 billing screen is what fills it in.
 */
export function billingCurrencyFor(country: string | null | undefined): string | null {
  if (typeof country !== "string" || !country.trim()) return null;
  return isIndianBillingCountry(country) ? BASE_CURRENCY : INTERNATIONAL_CURRENCY;
}

/** Everything the billing address implies, resolved once. */
export interface BillingLocale {
  /** The country as recorded, trimmed. Null when none is on file. */
  country: string | null;
  /** The only currency this customer may be billed in. Null when unresolved. */
  currency: string | null;
  /** True when GST applies — by construction `gstApplies(currency)`. */
  taxed: boolean;
  /** The CONFIGURED rate when GST applies, else 0. Never a literal. */
  ratePct: number;
  /** V6's note for the billing screen. Null while nothing is resolved. */
  note: string | null;
}

/**
 * `country` + the org's tax settings → the currency, the tax treatment and the
 * sentence V6 prints under the country field.
 *
 * `tax` is REQUIRED rather than defaulted: the rate belongs to the published
 * catalogue (`pricing_settings.gst_rate_pct`, via `taxSettingsOf`), and a
 * default here would be a second GST rate living beside the real one.
 */
export function resolveBillingLocale(
  country: string | null | undefined,
  tax: TaxSettings,
): BillingLocale {
  const recorded = typeof country === "string" && country.trim() ? country.trim() : null;
  const currency = billingCurrencyFor(recorded);
  const taxed = gstApplies(currency);
  return {
    country: recorded,
    currency,
    taxed,
    ratePct: taxed ? tax.ratePct : 0,
    // V6's two sentences, which is why they live here and not in three screens.
    note:
      currency === null
        ? null
        : taxed
          ? `Billed in ${currency} with ${tax.ratePct}% GST — GST-compliant invoice provided.`
          : `Billed in ${currency}, no GST applied.`,
  };
}

/** The four fields V6's `#acs-billing` captures. */
export interface BillingAddress {
  /** "Name or company to appear on the invoice". */
  name: string;
  city: string;
  /** Free text — the datalist is a hint. `billingCurrencyFor` interprets it. */
  country: string;
  /** The multi-line "Communication address" — street, area, postal code. */
  address: string;
}

/** Same shape as `accountOrder.ts`'s `FieldErrors`, declared here to keep plans.ts leaf-level. */
export type BillingFieldErrors = Record<string, string>;

const BILLING_MAX = 120;
/** The address is a textarea, so it gets a textarea's budget. */
const BILLING_ADDRESS_MAX = 500;

/**
 * The billing screen's own validation. `{}` means the screen may continue.
 *
 * All four fields are required, which is V6's rule and not an invention:
 * `acBillingValidate()` enables Continue only on `name && city && country &&
 * addr`. The country matters most — it is the currency — but a GST invoice with
 * no address on it is not a GST invoice, so the server asks for the same four.
 */
export function validateBillingAddress(b: {
  name?: unknown;
  city?: unknown;
  country?: unknown;
  address?: unknown;
}): BillingFieldErrors {
  const errors: BillingFieldErrors = {};
  const need = (key: "name" | "city" | "country" | "address", message: string, max: number) => {
    const value = typeof b[key] === "string" ? (b[key] as string).trim() : "";
    if (!value) errors[key] = message;
    else if (value.length > max) errors[key] = `Keep this under ${max} characters.`;
  };
  need("name", "Enter the name or company to appear on the invoice.", BILLING_MAX);
  need("city", "Enter your city.", BILLING_MAX);
  need("country", "Enter your billing country.", BILLING_MAX);
  need("address", "Enter your communication address.", BILLING_ADDRESS_MAX);
  return errors;
}

/** `n` units of a price. Integer multiplication, so nothing drifts. */
export function multiplyMinor(amountMinor: number, quantity: number): number {
  const q = Math.max(0, Math.trunc(quantity));
  return Math.max(0, Math.trunc(amountMinor)) * q;
}

const SYMBOLS: Record<string, string> = {
  INR: "₹",
  USD: "$",
  GBP: "£",
  EUR: "€",
  AED: "د.إ",
  SGD: "S$",
  AUD: "A$",
};

export function currencySymbol(currency: string): string {
  return SYMBOLS[currency] ?? "";
}

/**
 * A minor-unit amount as text. Two decimals only when there are any, so the
 * catalogue's whole-rupee prices read "₹20,000" and a tax line that genuinely
 * has paise reads "₹179.82" instead of hiding them.
 */
export function formatMinor(amountMinor: number, currency: string): string {
  const negative = amountMinor < 0;
  const abs = Math.abs(Math.trunc(amountMinor));
  const major = Math.floor(abs / 100);
  const minor = abs % 100;
  const grouped = major.toLocaleString(currency === "INR" ? "en-IN" : "en-US");
  const body = minor === 0 ? grouped : `${grouped}.${String(minor).padStart(2, "0")}`;
  const symbol = currencySymbol(currency);
  const text = symbol ? `${symbol}${body}` : `${body} ${currency}`;
  return negative ? `−${text}` : text;
}

// ── §8 Q1: no per-deck rate may be published ─────────────────────────────────

/**
 * True when `text` states a per-unit rate or a saving derived from one —
 * "₹400/deck", "₹500 per deck", "Save ₹10,000 vs base", "20% off base rate".
 *
 * The catalogue still holds these strings because `0033` seeded the price
 * document as drawn and `W4-D` owns clearing them. Until then, publishing
 * strips anything this matches, so the ruling holds no matter which column a
 * derivation is hiding in.
 */
export function hasPerDeckDerivation(text: string | null | undefined): boolean {
  if (!text) return false;
  return (
    /(?:\/|\s+per\s+)\s*(?:deck|credit|unit)\b/i.test(text) ||
    /\bsav(?:e|ing|ings)\b[^.]*\bbase\b/i.test(text) ||
    /\bvs\.?\s+base\b/i.test(text) ||
    /\bbase\s+rate\b/i.test(text)
  );
}

/** `text`, or null when it states a per-deck derivation the ruling retired. */
export function withoutPerDeckDerivation(text: string | null | undefined): string | null {
  if (!text) return null;
  return hasPerDeckDerivation(text) ? null : text;
}

/**
 * The catalogue as the app may render it: the `base_rate` pseudo-plan dropped
 * (it IS a per-deck rate) and every derived string stripped.
 */
export function publishablePlans(plans: readonly PublishedPlan[]): PublishedPlan[] {
  return plans
    .filter((p) => p.code !== "base_rate")
    .map((p) => ({
      ...p,
      tagline: withoutPerDeckDerivation(p.tagline),
      features: withoutPerDeckDerivation(p.features),
    }));
}

// ── The billing cycle ────────────────────────────────────────────────────────

export interface BillingCycle {
  /** Inclusive `YYYY-MM-DD` start of the cycle containing `now`. */
  start: string;
  /** Inclusive `YYYY-MM-DD` end — the day before the next renewal. */
  end: string;
  /** `YYYY-MM-DD` the next cycle begins. */
  renewsOn: string;
  period: "month" | "year";
}

function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}

/**
 * The cycle window containing `now`, from a `YYYY-MM-DD` anchor.
 *
 * A monthly anchor on the 31st clamps to the length of each month (so a cycle
 * anchored 31 Jan starts 28 Feb in a non-leap year) rather than rolling into
 * the next month, which is what would silently shorten a customer's month.
 */
export function billingCycle(
  anchor: string,
  period: "month" | "year",
  now: Date = new Date(),
): BillingCycle {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(anchor);
  const anchorDay = m ? Number(m[3]) : 1;
  const anchorMonth = m ? Number(m[2]) - 1 : 0;
  const anchorYear = m ? Number(m[1]) : now.getUTCFullYear();

  const startOf = (index: number): { y: number; m: number; d: number } => {
    if (period === "year") {
      const y = anchorYear + index;
      return {
        y,
        m: anchorMonth,
        d: Math.min(anchorDay, daysInMonth(y, anchorMonth)),
      };
    }
    const total = anchorYear * 12 + anchorMonth + index;
    const y = Math.floor(total / 12);
    const mo = total % 12;
    return { y, m: mo, d: Math.min(anchorDay, daysInMonth(y, mo)) };
  };

  const at = (index: number): number => {
    const s = startOf(index);
    return Date.UTC(s.y, s.m, s.d);
  };

  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  // Walk from the anchor to the cycle containing `now`. Bounded: the step is a
  // whole period, so even a decade-old anchor is ~120 iterations.
  let index = 0;
  if (today >= at(0)) {
    while (at(index + 1) <= today) index += 1;
  } else {
    while (at(index) > today) index -= 1;
  }

  const start = startOf(index);
  const next = startOf(index + 1);
  const endMs = Date.UTC(next.y, next.m, next.d) - 86_400_000;
  const end = new Date(endMs);
  return {
    start: ymd(start.y, start.m, start.d),
    end: ymd(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()),
    renewsOn: ymd(next.y, next.m, next.d),
    period,
  };
}

// ── The section's payload ────────────────────────────────────────────────────

/** `credit_ledger.reason`, as `0032` defines it. */
export type LedgerReason =
  "trial_grant" | "purchase" | "deck_evaluated" | "refund" | "adjustment" | "expiry";

export const LEDGER_REASON_LABELS: Record<LedgerReason, string> = {
  trial_grant: "Free trial grant",
  purchase: "Credit purchase",
  deck_evaluated: "Pitchdeck evaluation",
  refund: "Refund",
  adjustment: "Administrator adjustment",
  expiry: "Credits expired",
};

export interface LedgerEntryView {
  id: string;
  createdAt: string;
  reason: LedgerReason;
  /** Signed credits. Negative consumes. */
  delta: number;
  /** The prototype's left-hand sentence: "GreenGrid Energy — pitchdeck evaluation". */
  description: string;
  deckId: string | null;
  /**
   * Money, when the movement actually cost money — a purchase. A
   * `deck_evaluated` debit carries NONE: §8 Q1 retired the per-deck rate.
   */
  amountMinor: number | null;
  currency: string | null;
  reference: string | null;
  invoiceId: string | null;
}

export interface InvoiceView {
  id: string;
  number: string;
  kind: "invoice" | "receipt";
  description: string;
  units: number | null;
  currency: string;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  ratePct: number;
  registration: string | null;
  reference: string | null;
  issuedAt: string;
}

export interface SubscriptionView {
  /** Catalogue code when the plan is one, else null (a negotiated plan). */
  planCode: string | null;
  /** What the tile prints — "Configurable". */
  planLabel: string;
  /** The tile's sub-line prefix — "Enterprise". */
  tierLabel: string | null;
  seats: number;
  status: "active" | "trialing" | "past_due" | "cancelled";
  currency: string;
  billingEmail: string | null;
  /** The customer's own GSTIN, for a B2B invoice. Ours is `TaxSettings`. */
  gstin: string | null;
  cycleAnchor: string;
  cycle: BillingCycle;
}

export interface PaymentIntentView {
  id: string;
  purpose: "credit_pack" | "subscription" | "enterprise" | "seat";
  planCode: string | null;
  planName: string;
  units: number | null;
  quantity: number;
  currency: string;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  ratePct: number;
  /** `recorded` = the intent exists and NOTHING has been charged. */
  status: "recorded" | "redirected" | "completed" | "failed" | "cancelled";
  /** A provider-hosted page. Null while no provider is configured. */
  checkoutUrl: string | null;
  createdAt: string;
}

export interface CreditsBillingView {
  edition: string;
  balance: number;
  /** Lifetime credits bought — the tile's "of 50 purchased". */
  purchased: number;
  /**
   * Credits consumed in the current CALENDAR month — the tile's "Used this
   * month", which the prototype means literally: its plan is annual and the
   * tile still says month.
   */
  usedThisMonth: number;
  /** Credits consumed inside the current billing cycle, for the cycle card. */
  usedThisCycle: number;
  lowCreditThreshold: number;
  subscription: SubscriptionView;
  tax: TaxSettings;
  ledger: LedgerEntryView[];
  invoices: InvoiceView[];
  /** Grouped catalogue, already stripped of per-deck derivations. */
  plans: PublishedPlan[];
  /** The most recent purchase intents — recorded, not charged. */
  intents: PaymentIntentView[];
  /** Whether a payment provider is configured (§1.3: false on this build). */
  paymentConfigured: boolean;
}

/** A ledger entry consumes credits. */
export function isDebit(entry: { delta: number }): boolean {
  return entry.delta < 0;
}

/** Credits consumed in the `YYYY-MM` calendar month of `now`. */
export function creditsUsedInMonth(
  entries: readonly { delta: number; createdAt: string }[],
  now: Date = new Date(),
): number {
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return entries.reduce(
    (sum, e) => (e.createdAt.slice(0, 7) === month && e.delta < 0 ? sum + -e.delta : sum),
    0,
  );
}

/** Credits consumed by entries inside `[start, end]` (inclusive dates). */
export function creditsUsedBetween(
  entries: readonly { delta: number; createdAt: string }[],
  start: string,
  end: string,
): number {
  return entries.reduce((sum, e) => {
    const day = e.createdAt.slice(0, 10);
    return day >= start && day <= end && e.delta < 0 ? sum + -e.delta : sum;
  }, 0);
}
