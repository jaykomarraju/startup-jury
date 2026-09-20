/**
 * W4-D — the **price book**: the shape of the price catalogue, and every piece
 * of pure arithmetic the Price configuration section and its API both need.
 *
 * Why a module of its own, and why this name. `src/shared/plans.ts` is `W4-C`'s
 * (plan *tiers* — what a tier may configure); the catalogue is a different
 * thing, it is read by the client, the Worker and the unit tests alike, and the
 * repo's convention for a contract three places share is `src/shared`. The name
 * is deliberately not `pricing.ts`: Wave 4 runs four sessions in parallel and a
 * file two of them might independently invent is the one merge conflict §2.2
 * calls genuinely painful.
 *
 * ── §8 Q1 IS RULED: there is NO per-deck pricing ────────────────────────────
 * The prototype's price tables derive a "₹X per deck" column and a saving
 * percentage from a per-deck base rate (`calcPacks()`, `calcEnt()`), and its
 * three mutually contradictory base rates are what made the lane unbuildable.
 * The user ruled on 2026-09-11: plans, packs and seats carry **stated prices**
 * and nothing is derived from a rate per deck. So this model has
 *
 *   • no base-rate plan, no `perDeck` field, no `savingPct` field, and
 *   • `perDeckArtefacts()`, which the publish path runs as a REFUSAL — a
 *     catalogue whose copy re-introduces a per-deck figure cannot be published.
 *
 * The ruling is about PRICE, not metering: an evaluation still costs one credit
 * (§8 Q40). Money is integer **minor units** throughout (paise, cents) — no
 * float ever touches a price. FX rates are the one real number here, and they
 * are editable data, never a network call (§1.3).
 */

import type { Plan } from "./plans";

/** Every price is stated in the base currency first; the rest derive from it. */
export const BASE_CURRENCY = "INR";

export type PlanGroupId = "free_trial" | "subscription" | "credit_pack" | "enterprise";

/** The order the four catalogues appear in, which is the prototype's order. */
export const PLAN_GROUPS: readonly PlanGroupId[] = [
  "free_trial",
  "subscription",
  "credit_pack",
  "enterprise",
];

/**
 * The period a plan bills on.
 *
 * `quarter` and `half_year` arrive with V3-PT's seat model and exist ONLY in
 * this type — `price_plans.period` still CHECKs the original three tokens,
 * because widening a SQLite CHECK means rebuilding the table and `price_plans`
 * is the parent of `price_amounts … ON DELETE CASCADE`. A quarterly seat is
 * stored as `period = NULL, period_months = 3`, which the old CHECK already
 * accepts, and `periodOf()` is what every reader goes through. See
 * `migrations/0073_seat_pricing_v3.sql`.
 */
export type BillingPeriod = "month" | "quarter" | "half_year" | "year" | "one_time";

export const PERIOD_SUFFIX: Record<BillingPeriod, string> = {
  month: "/mo",
  quarter: "/quarter",
  half_year: "/half-year",
  year: "/year",
  one_time: "",
};

/** The prototype's `IPERIODS` keys, in its order: Quarter · Half-year · Year. */
export const SEAT_PERIOD_MONTHS: readonly number[] = [3, 6, 12];

const MONTHS_TO_PERIOD: Record<number, BillingPeriod> = {
  1: "month",
  3: "quarter",
  6: "half_year",
  12: "year",
};

/**
 * A plan's real period. `periodMonths` WINS where both are present, because it
 * is the only one of the two that can say "quarter".
 */
export function periodOf(plan: Pick<PricePlanRow, "period" | "periodMonths">): BillingPeriod | null {
  if (plan.periodMonths != null) return MONTHS_TO_PERIOD[plan.periodMonths] ?? plan.period;
  return plan.period;
}

export function monthsOf(plan: Pick<PricePlanRow, "period" | "periodMonths">): number | null {
  if (plan.periodMonths != null) return plan.periodMonths;
  if (plan.period === "month") return 1;
  if (plan.period === "year") return 12;
  return null;
}

export interface CurrencyRow {
  code: string;
  symbol: string;
  flag: string;
  /** On the currency bar as an active chip, and therefore a column. */
  active: boolean;
  sortOrder: number;
}

export interface FxRow {
  currency: string;
  /** 1 base unit = `rate` units of `currency`. The base's own rate is 1. */
  rate: number;
  /**
   * Always `manual`. The prototype offers a per-currency "Live" refresh; §1.3
   * forbids putting a rates vendor on the critical path, so a rate is whatever
   * an administrator entered here and the UI says so rather than implying a feed.
   */
  source: "manual";
  updatedAt: string;
}

/**
 * A catalogue's own chrome — its title, badge and card copy — as DATA.
 *
 * This is what makes §8 Q1's surviving ambiguity a data change: the prototype
 * carries four enterprise vocabularies (unit tiers · Standard/Pro/Premium seats
 * · Basic/Configurable/Customisable · Basic/Customizable Enterprise) and only
 * the client can settle which is current. Every word the screen renders for a
 * group is a row here, so switching vocabulary is an UPDATE, not a rewrite.
 *
 * `{gst}` in `footnote` is substituted with the configured GST rate, so the
 * prototype's "GST at 18% added at checkout" cannot go stale when the rate moves.
 */
export interface PriceGroupRow {
  group: PlanGroupId;
  title: string;
  badge: string | null;
  /** An icon token the client maps to a lucide icon; unknown tokens fall back. */
  icon: string;
  cardName: string;
  cardSub: string | null;
  cardTag: string | null;
  footnote: string | null;
  sortOrder: number;
}

export interface PricePlanRow {
  id: string;
  group: PlanGroupId;
  code: string;
  name: string;
  /** The pill beside the name — "Most popular", "3 configurable params". */
  badge: string | null;
  tagline: string | null;
  features: string | null;
  /** Decks included. NULL for a subscription, which is metered by its own rules. */
  units: number | null;
  /**
   * The legacy period token. NULL on a quarterly or half-yearly plan — the
   * column's CHECK cannot spell either. Read `periodOf()`, never this.
   */
  period: BillingPeriod | null;
  /** 3 · 6 · 12 on a seat SKU; NULL on everything that predates V3-PT. */
  periodMonths: number | null;
  /**
   * `standard` · `pro` · `premium` on a SEAT SKU, NULL on everything else. The
   * prototype's "Choose your seat" screen is (tier × period), so a tier is a
   * fact about the row rather than something parsed out of its code.
   */
  tier: Plan | null;
  /**
   * Premium seats included, on an ENTERPRISE seat plan (5 · 10 · 15); NULL
   * elsewhere. The prototype's enterprise table shows it as a read-only column
   * beside the one editable price.
   */
  seats: number | null;
  active: boolean;
  sortOrder: number;
  /** Currency code → minor units. Every active currency has an entry. */
  amounts: Record<string, number>;
  /**
   * The currencies whose amount an administrator typed over the FX derivation.
   * Everything else is recomputed from the base amount whenever a rate moves.
   */
  overrides: string[];
}

export interface TaxConfig {
  gstRatePct: number;
  gstRegistration: string | null;
  /** Off by default: GST is added at checkout, not folded into the sticker. */
  pricesIncludeGst: boolean;
  showInternationalTaxNotice: boolean;
}

export interface TrialConfig {
  decks: number;
  /** 0 = the free trial never expires. */
  expiryDays: number;
  showOnPricingPage: boolean;
}

/** The whole catalogue. One of these is what a publish freezes. */
export interface PriceBook {
  baseCurrency: string;
  currencies: CurrencyRow[];
  fx: FxRow[];
  groups: PriceGroupRow[];
  plans: PricePlanRow[];
  tax: TaxConfig;
  trial: TrialConfig;
}

/** A published book carries the version it was published as. */
export interface PublishedPriceBook extends PriceBook {
  version: number;
  publishedAt: string;
}

// ── FX ───────────────────────────────────────────────────────────────────────

/**
 * Convert a base-currency amount into `currency`, in minor units.
 *
 * Every currency the page offers is a two-decimal currency, so minor units
 * convert directly: 99 900 paise × 0.01199 = 1 197.8 → 1 198 cents. Rounds
 * half away from zero, which is what an administrator reading the table expects.
 */
export function convertMinor(baseMinor: number, rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return Math.round(baseMinor * rate);
}

export function fxRateFor(book: PriceBook, currency: string): number | null {
  if (currency === book.baseCurrency) return 1;
  const row = book.fx.find((f) => f.currency === currency);
  return row ? row.rate : null;
}

/**
 * The amounts a plan SHOULD carry: the base amount as stated, every overridden
 * currency as typed, and every other active currency derived from the rate. The
 * server runs this on every draft save, so editing a rate moves every price
 * that has not been typed over — which is the prototype's own promise,
 * "Converted prices are auto-calculated from INR base. You can override any
 * converted price manually."
 *
 * An INACTIVE currency keeps whatever it already held and is never derived: a
 * chip switched off is a column the page stops drawing, not a price the
 * administrator threw away.
 */
export function deriveAmounts(book: PriceBook, plan: PricePlanRow): Record<string, number> {
  const base = plan.amounts[book.baseCurrency] ?? 0;
  const out: Record<string, number> = { [book.baseCurrency]: base };
  for (const currency of book.currencies) {
    if (currency.code === book.baseCurrency) continue;
    const stored = plan.amounts[currency.code];
    if (!currency.active) {
      if (stored !== undefined) out[currency.code] = stored;
      continue;
    }
    if (plan.overrides.includes(currency.code)) {
      out[currency.code] = stored ?? 0;
      continue;
    }
    const rate = fxRateFor(book, currency.code);
    out[currency.code] = rate === null ? 0 : convertMinor(base, rate);
  }
  return out;
}

// ── Tax ──────────────────────────────────────────────────────────────────────

/** GST on an amount, in minor units. 18 % of ₹999 is ₹179.82. */
export function gstMinor(amountMinor: number, ratePct: number): number {
  if (!Number.isFinite(ratePct) || ratePct <= 0) return 0;
  return Math.round((amountMinor * ratePct) / 100);
}

export interface TaxBreakdown {
  /** Ex-tax. */
  netMinor: number;
  taxMinor: number;
  /** What the customer pays. */
  grossMinor: number;
  /** False for every non-base currency — GST is the INR-billing tax. */
  taxed: boolean;
}

/**
 * Split one stated amount into net · tax · gross.
 *
 * The prototype states the rule twice: "GST at 18% added at checkout for INR
 * billing. International pricing shown exclusive of local taxes." So GST
 * applies to the base currency only; an international customer is liable for
 * their own VAT/GST, which is what `showInternationalTaxNotice` announces.
 *
 * With `pricesIncludeGst` on, the stated price is the gross and the tax is
 * extracted from it — the same money, presented the other way round.
 */
export function taxBreakdown(
  amountMinor: number,
  currency: string,
  tax: TaxConfig,
  baseCurrency: string = BASE_CURRENCY,
): TaxBreakdown {
  if (currency !== baseCurrency || amountMinor === 0) {
    return { netMinor: amountMinor, taxMinor: 0, grossMinor: amountMinor, taxed: false };
  }
  if (tax.pricesIncludeGst) {
    const net = Math.round(amountMinor / (1 + tax.gstRatePct / 100));
    return {
      netMinor: net,
      taxMinor: amountMinor - net,
      grossMinor: amountMinor,
      taxed: true,
    };
  }
  const gst = gstMinor(amountMinor, tax.gstRatePct);
  return {
    netMinor: amountMinor,
    taxMinor: gst,
    grossMinor: amountMinor + gst,
    taxed: true,
  };
}

// ── Formatting ───────────────────────────────────────────────────────────────

/**
 * Minor units → a price string. Whole amounts print whole ("₹20,000"), because
 * every figure in the prototype's tables is whole; a fraction only appears once
 * GST has been applied ("₹1,178.82").
 */
export function formatMinor(amountMinor: number, symbol: string): string {
  const whole = amountMinor % 100 === 0;
  const value = amountMinor / 100;
  return (
    symbol +
    value.toLocaleString("en-IN", {
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: 2,
    })
  );
}

/** Substitute `{gst}` in group copy with the configured rate. */
export function applyCopyTokens(copy: string, tax: TaxConfig): string {
  return copy.replace(/\{gst\}/g, String(tax.gstRatePct));
}

// ── Reading a book ───────────────────────────────────────────────────────────

export function activeCurrencies(book: PriceBook): CurrencyRow[] {
  return book.currencies.filter((c) => c.active);
}

export function plansInGroup(book: PriceBook, group: PlanGroupId): PricePlanRow[] {
  return book.plans.filter((p) => p.group === group);
}

export function groupOf(book: PriceBook, group: PlanGroupId): PriceGroupRow | undefined {
  return book.groups.find((g) => g.group === group);
}

// ── V3-PT · the seat catalogue ───────────────────────────────────────────────

/**
 * The prototype's `Individual plans — ₹ per period` table, as rows.
 *
 * A seat SKU is any active subscription plan that carries a `tier`, which is
 * exactly what `0073` seeds and nothing that predates it has. Selecting on the
 * COLUMN rather than on a code prefix is what keeps the legacy `standard` /
 * `pro` monthly plans — which `src/shared/seats.ts` still prices a purchased
 * seat from — out of the seat screens without deleting them.
 */
export function seatPlans(book: PriceBook): PricePlanRow[] {
  return book.plans.filter((p) => p.group === "subscription" && p.tier !== null && p.active);
}

/** The seat SKU for one (tier, months) cell, or undefined if it is not sold. */
export function seatPlanFor(book: PriceBook, tier: Plan, months: number): PricePlanRow | undefined {
  return seatPlans(book).find((p) => p.tier === tier && p.periodMonths === months);
}

/** The tiers the catalogue actually sells a seat for, in `PLAN_ORDER`. */
export function seatTiers(book: PriceBook): Plan[] {
  const order: readonly Plan[] = ["standard", "pro", "premium"];
  const sold = new Set(seatPlans(book).map((p) => p.tier));
  return order.filter((t) => sold.has(t));
}

/** The billing periods sold for `tier`, ascending — 3 · 6 · 12 months. */
export function seatPeriodsFor(book: PriceBook, tier: Plan): number[] {
  return seatPlans(book)
    .filter((p) => p.tier === tier && p.periodMonths !== null)
    .map((p) => p.periodMonths as number)
    .sort((a, b) => a - b);
}

/**
 * The prototype's `Enterprise plans — ₹ annual` table: the three seat-count
 * plans, ascending by seats. Selected on `seats`, so the legacy `ent_100…500`
 * unit tiers stay in the catalogue and off the screen.
 */
export function enterpriseSeatPlans(book: PriceBook): PricePlanRow[] {
  return book.plans
    .filter((p) => p.group === "enterprise" && p.seats !== null && p.active)
    .sort((a, b) => (a.seats as number) - (b.seats as number));
}

/** The prototype's `Paid trial` card: one plan, whose price is the deck rate. */
export const PAID_TRIAL_CODE = "paid_trial";

/**
 * True for every row `0073` added — the nine seats, the three enterprise seat
 * plans and the paid-trial rate.
 *
 * Only the incubator SUPERUSER prototype was reshared, so the pre-V3 plan
 * screens every other role still sees must draw NONE of them. One predicate,
 * used by both sides, is what keeps the two lists from drifting: add a seat SKU
 * and it appears on the new screens and stays off the old ones, automatically.
 */
export function isSeatCatalogueRow(plan: PricePlanRow): boolean {
  return plan.tier !== null || plan.seats !== null || plan.code === PAID_TRIAL_CODE;
}

export function paidTrialPlan(book: PriceBook): PricePlanRow | undefined {
  return book.plans.find((p) => p.code === PAID_TRIAL_CODE);
}

/**
 * `ICREDIT_RATE` — what one extra deck costs on a tier, in minor units.
 *
 * The prototype states it as "annual plan price / 500 included decks" and hard
 * codes 23.04 / 30.72 / 40.96. Deriving it from the ANNUAL seat SKU keeps the
 * two in step when an administrator edits the annual price, which is the whole
 * point of item 15 feeding item 17. Returns null when the tier has no annual
 * seat priced in `currency`.
 */
export function extraCreditRateMinor(
  book: PriceBook,
  tier: Plan,
  currency: string,
): number | null {
  const annual = seatPlanFor(book, tier, 12);
  const price = annual?.amounts[currency];
  if (!annual || price === undefined || !annual.units) return null;
  return price / annual.units;
}

/**
 * What the public pricing page may show: active plans, with the free trial
 * dropped unless `trial.showOnPricingPage` is on (the prototype's third
 * free-trial row, "Displayed as first option").
 */
export function listedPlans(book: PriceBook): PricePlanRow[] {
  return book.plans.filter(
    (p) => p.active && (p.group !== "free_trial" || book.trial.showOnPricingPage),
  );
}

// ── The §8 Q1 guard ──────────────────────────────────────────────────────────

/**
 * Any place the catalogue has re-acquired a per-deck figure or a saving stated
 * against a per-deck base. The publish path REFUSES a book this returns
 * anything for, which is how the 2026-09-11 ruling survives the next person who
 * copies a line of prototype copy without reading §8 Q1.
 */
const PER_DECK = /(\/\s*deck\b|\bper[\s-]?deck\b)/i;
const SAVING_VS_BASE = /\bsav(?:e|ing)s?\b[^.;·]*\bvs\.?\s+base\b/i;

export function perDeckArtefacts(book: PriceBook): string[] {
  const found: string[] = [];
  const check = (where: string, copy: string | null) => {
    if (!copy) return;
    if (PER_DECK.test(copy)) found.push(`${where}: per-deck figure in ${JSON.stringify(copy)}`);
    else if (SAVING_VS_BASE.test(copy)) {
      found.push(`${where}: saving stated against a per-deck base in ${JSON.stringify(copy)}`);
    }
  };
  for (const g of book.groups) {
    check(`group ${g.group}`, g.title);
    check(`group ${g.group}`, g.badge);
    check(`group ${g.group}`, g.cardName);
    check(`group ${g.group}`, g.cardSub);
    check(`group ${g.group}`, g.cardTag);
    check(`group ${g.group}`, g.footnote);
  }
  for (const p of book.plans) {
    check(`plan ${p.code}`, p.name);
    check(`plan ${p.code}`, p.badge);
    check(`plan ${p.code}`, p.tagline);
    check(`plan ${p.code}`, p.features);
  }
  return found;
}

// ── Validation ───────────────────────────────────────────────────────────────

/**
 * Everything that must hold before a book may be saved as a draft or published.
 * Returns human sentences; an empty array is a valid book.
 */
export function validatePriceBook(book: PriceBook): string[] {
  const errors: string[] = [];
  const codes = new Set(book.currencies.map((c) => c.code));

  if (!codes.has(book.baseCurrency)) {
    errors.push(`The base currency ${book.baseCurrency} is not in the currency list.`);
  }
  const base = book.currencies.find((c) => c.code === book.baseCurrency);
  if (base && !base.active) errors.push(`The base currency ${book.baseCurrency} cannot be inactive.`);

  for (const currency of book.currencies) {
    if (!/^[A-Z]{3}$/.test(currency.code)) {
      errors.push(`"${currency.code}" is not a three-letter currency code.`);
    }
    if (currency.code === book.baseCurrency || !currency.active) continue;
    const rate = fxRateFor(book, currency.code);
    if (rate === null || !(rate > 0)) {
      errors.push(`${currency.code} is active but has no exchange rate — set one or deactivate it.`);
    }
  }

  for (const fx of book.fx) {
    if (!codes.has(fx.currency)) errors.push(`Exchange rate for unknown currency ${fx.currency}.`);
    if (!(fx.rate > 0)) errors.push(`${fx.currency}'s exchange rate must be greater than zero.`);
  }

  for (const plan of book.plans) {
    for (const [currency, amount] of Object.entries(plan.amounts)) {
      if (!codes.has(currency)) {
        errors.push(`${plan.name} carries a price in unknown currency ${currency}.`);
      }
      if (!Number.isInteger(amount) || amount < 0) {
        errors.push(`${plan.name}'s ${currency} price must be a whole number of minor units.`);
      }
    }
    if (plan.units !== null && (!Number.isInteger(plan.units) || plan.units < 0)) {
      errors.push(`${plan.name}'s unit count must be a whole number.`);
    }
  }

  if (!(book.tax.gstRatePct >= 0 && book.tax.gstRatePct <= 100)) {
    errors.push("The GST rate must be between 0 and 100 per cent.");
  }
  if (!Number.isInteger(book.trial.decks) || book.trial.decks < 0) {
    errors.push("The free deck limit must be a whole number.");
  }
  if (!Number.isInteger(book.trial.expiryDays) || book.trial.expiryDays < 0) {
    errors.push("The free trial expiry must be a whole number of days (0 = never).");
  }

  return errors.concat(perDeckArtefacts(book));
}

// ── Stable form ──────────────────────────────────────────────────────────────

/**
 * One canonical ordering, so two books can be compared byte for byte — which is
 * how the section knows whether the draft differs from what is published, and
 * how the seeded published version is pinned to the seeded draft in the tests.
 */
export function normalisePriceBook(book: PriceBook): PriceBook {
  const byOrder = <T extends { sortOrder: number }>(a: T, b: T) => a.sortOrder - b.sortOrder;
  return {
    baseCurrency: book.baseCurrency,
    currencies: [...book.currencies].sort(byOrder).map((c) => ({ ...c })),
    fx: [...book.fx].sort((a, b) => a.currency.localeCompare(b.currency)).map((f) => ({ ...f })),
    groups: [...book.groups].sort(byOrder).map((g) => ({ ...g })),
    plans: [...book.plans]
      .sort(byOrder)
      .map((p) => ({ ...p, overrides: [...p.overrides].sort(), amounts: sortKeys(p.amounts) })),
    tax: { ...book.tax },
    trial: { ...book.trial },
  };
}

function sortKeys(amounts: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of Object.keys(amounts).sort()) out[key] = amounts[key];
  return out;
}

export function priceBooksEqual(a: PriceBook, b: PriceBook): boolean {
  return JSON.stringify(normalisePriceBook(a)) === JSON.stringify(normalisePriceBook(b));
}
