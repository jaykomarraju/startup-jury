/**
 * W6-B — **My account**: the purchase wizard's contract, shared by the overlay,
 * the `/api/account` router and the unit tests.
 *
 * The prototype's `#acct-overlay` (`_rest.html:558-907`, driver `_scripts.js:2795-3085`)
 * is an eight-screen flow with two branches. Everything here is pure: the step
 * labels and which one is active, the form's option lists and its validation,
 * and the projection of the PUBLISHED catalogue onto the screens.
 *
 * Three rules this module exists to hold.
 *
 *   1. **No price is a literal.** Every figure the wizard shows or charges comes
 *      from a `PublishedPriceBook` (`src/shared/priceBook.ts`, `W4-D`). The
 *      prototype's `PACKS` (20 / 35 / 50), `ORG_PLANS` (₹1,60,000 / ₹8,00,000)
 *      and fixed packs (₹5,000 / ₹6,000 / ₹7,000) are not reproduced — the
 *      catalogue rows are rendered instead, which is what makes §8 Q51 and Q52
 *      a data change.
 *   2. **One tax rule.** The order total is `priceBreakdown(amount, tax, currency)`
 *      from `src/shared/plans.ts`. This file maps the catalogue's `TaxConfig`
 *      onto that function's `TaxSettings` and does no arithmetic of its own —
 *      Wave 4 integration had to reconcile two GST rules once (§8 Q55).
 *   3. **§8 Q1: no per-deck pricing.** No per-deck rate, no saving against a base.
 */
import {
  plansInGroup,
  groupOf,
  extraCreditRateMinor,
  listedPlans,
  type BillingPeriod,
  type PlanGroupId,
  type PricePlanRow,
  type PriceGroupRow,
  type PublishedPriceBook,
  type TaxConfig,
} from "./priceBook";
import {
  currencySymbol,
  priceBreakdown,
  type TaxBreakdown,
  type TaxSettings,
} from "./plans";

// ── The two branches and their stepper ───────────────────────────────────────

export type AccountType = "individual" | "organization";

export type AccountScreen =
  | "account"
  | "orgtype"
  | "orgdetails"
  | "orgplan"
  | "plan"
  /** V3-PT · `#acs-trial` — the three free decks, used one at a time. */
  | "trial"
  /** V3-PT · `#acs-paidtrial` — buy 10–50 more decks at the paid-trial rate. */
  | "paidtrial"
  | "payment"
  | "success";

/**
 * `_scripts.js` `STEPS_IND` / `STEPS_ENT`, verbatim.
 *
 * v3 renamed the individual branch's middle step from "Plan" to "Seat &
 * pricing", but ONLY the incubator superuser prototype was reshared — every
 * other role's file still says "Plan". So the label is a parameter of
 * `stepperFor`, not a constant, and `STEPS_INDIVIDUAL` stays what it was.
 */
export const STEPS_INDIVIDUAL = ["Account", "Plan", "Payment"] as const;

/** v3's `STEPS_IND`, for the incubator superuser. */
export const STEPS_INDIVIDUAL_SEATS = ["Account", "Seat & pricing", "Payment"] as const;
export const STEPS_ORGANIZATION = [
  "Account",
  "Org type",
  "Org details",
  "Plan",
  "Payment",
  "Done",
] as const;

export interface StepView {
  label: string;
  state: "done" | "active" | "todo";
}

/**
 * The stepper for a screen — a port of the prototype's `setSteps()`.
 *
 * On success every step is done, and the individual branch relabels its last
 * step "Done" (the organisation branch already ends in one). A screen that does
 * not belong to the branch (the individual `plan` step reached from the
 * organisation branch through "Buy credits") takes the branch's Plan position.
 */
export function stepperFor(
  type: AccountType,
  screen: AccountScreen,
  /** True for the incubator superuser, whose middle step v3 renamed. */
  seatFlow = false,
): StepView[] {
  const labels: string[] =
    type === "organization"
      ? [...STEPS_ORGANIZATION]
      : [...(seatFlow ? STEPS_INDIVIDUAL_SEATS : STEPS_INDIVIDUAL)];
  const index =
    type === "organization"
      ? {
          account: 0, orgtype: 1, orgdetails: 2, orgplan: 3, plan: 3,
          trial: 3, paidtrial: 3, payment: 4, success: 5,
        }[screen]
      : {
          account: 0, orgtype: 0, orgdetails: 0, orgplan: 1, plan: 1,
          trial: 1, paidtrial: 1, payment: 2, success: 2,
        }[screen];
  const onSuccess = screen === "success";
  // v3 relabels the LAST step, not index 2 — the individual branch's labels are
  // three long today but the expression must not care.
  if (onSuccess && type === "individual") labels[labels.length - 1] = "Done";
  return labels.map((label, i) => ({
    label,
    state: onSuccess || i < index ? "done" : i === index ? "active" : "todo",
  }));
}

/** Where Continue goes from the Account screen (`acAccountNext`). */
export function nextAfterAccount(type: AccountType): AccountScreen {
  return type === "organization" ? "orgtype" : "plan";
}

/** Where "Back to plan selection" goes from Payment (`acPayBack`). */
export function planScreenFor(type: AccountType, group: PlanGroupId | null): AccountScreen {
  if (group === "enterprise") return "orgplan";
  if (group === "subscription" || group === "credit_pack") return "plan";
  return type === "organization" ? "orgplan" : "plan";
}

// ── The form ─────────────────────────────────────────────────────────────────

/** `#acs-account` and `#acs-orgdetails` phone selects. */
export const DIAL_CODES = ["+91", "+1", "+44", "+65", "+971", "+61", "+49", "+81", "+27"] as const;

/** `#acs-orgdetails` "Type of business". */
export const BUSINESS_TYPES = [
  "Incubator",
  "Accelerator",
  "VC Firm",
  "Angel Network",
  "Corporate Venture",
  "Family Office",
  "Other",
] as const;

/** `#acs-orgdetails` "No. of employees". */
export const EMPLOYEE_BANDS = ["1–10", "11–50", "51–200", "201–500", "500+"] as const;

/** `#acs-orgdetails` "Country". */
export const COUNTRIES = [
  "India",
  "United States",
  "United Kingdom",
  "Singapore",
  "United Arab Emirates",
  "Australia",
  "Germany",
  "Japan",
  "South Africa",
  "Other",
] as const;

export type OrgKind = "incubator" | "investor";

export interface OrgDetails {
  kind: OrgKind;
  name: string;
  businessType: string | null;
  employees: string | null;
  associates: number | null;
  city: string | null;
  country: string | null;
  contactName: string;
  designation: string | null;
  dialCode: string | null;
  phone: string | null;
  email: string;
}

export interface AccountProfile {
  accountType: AccountType;
  workEmail: string;
  firstName: string;
  lastName: string;
  dialCode: string | null;
  phone: string | null;
  designation: string | null;
  organizationName: string | null;
  /** Present exactly when `accountType` is `organization` and its details are saved. */
  org: OrgDetails | null;
}

/**
 * Consumer mailboxes. The prototype's hint is "Personal email addresses are not
 * accepted"; it never says which, so this is the short list of free providers
 * that account for nearly every personal address, and nothing more ambitious.
 */
export const PERSONAL_EMAIL_DOMAINS = [
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.in",
  "ymail.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "rediffmail.com",
] as const;

const EMAIL = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/;

export function isEmail(value: string): boolean {
  return EMAIL.test(value.trim());
}

export function isWorkEmail(value: string): boolean {
  const m = EMAIL.exec(value.trim().toLowerCase());
  if (!m) return false;
  return !(PERSONAL_EMAIL_DOMAINS as readonly string[]).includes(m[1]);
}

export type FieldErrors = Record<string, string>;

const MAX = 120;

function tooLong(errors: FieldErrors, key: string, value: string | null | undefined) {
  if (value && value.length > MAX) errors[key] = `Keep this under ${MAX} characters.`;
}

/** The Account screen. Returns `{}` when the screen may continue. */
export function validateAccountFields(p: {
  accountType: unknown;
  workEmail: unknown;
  firstName: unknown;
  lastName: unknown;
  dialCode?: unknown;
  phone?: unknown;
  designation?: unknown;
  organizationName?: unknown;
}): FieldErrors {
  const errors: FieldErrors = {};
  if (p.accountType !== "individual" && p.accountType !== "organization") {
    errors.accountType = "Choose Individual or Organization.";
  }
  const email = typeof p.workEmail === "string" ? p.workEmail.trim() : "";
  if (!email) errors.workEmail = "Enter your work email.";
  else if (!isEmail(email)) errors.workEmail = "Enter a valid email address.";
  else if (!isWorkEmail(email)) errors.workEmail = "Personal email addresses are not accepted.";
  if (typeof p.firstName !== "string" || !p.firstName.trim()) errors.firstName = "Enter your first name.";
  if (typeof p.lastName !== "string" || !p.lastName.trim()) errors.lastName = "Enter your last name.";
  if (p.dialCode != null && !(DIAL_CODES as readonly unknown[]).includes(p.dialCode)) {
    errors.dialCode = "Choose a country code from the list.";
  }
  if (typeof p.phone === "string" && p.phone.trim() && !/^[0-9 ()-]{6,20}$/.test(p.phone.trim())) {
    errors.phone = "Enter a phone number using digits only.";
  }
  for (const k of ["firstName", "lastName", "designation", "organizationName"] as const) {
    tooLong(errors, k, typeof p[k] === "string" ? (p[k] as string) : null);
  }
  return errors;
}

/** The Org type + Org details screens. */
export function validateOrgDetails(o: {
  kind?: unknown;
  name?: unknown;
  businessType?: unknown;
  employees?: unknown;
  associates?: unknown;
  city?: unknown;
  country?: unknown;
  contactName?: unknown;
  designation?: unknown;
  dialCode?: unknown;
  phone?: unknown;
  email?: unknown;
}): FieldErrors {
  const errors: FieldErrors = {};
  if (o.kind !== "incubator" && o.kind !== "investor") errors.kind = "Choose what describes your organisation.";
  if (typeof o.name !== "string" || !o.name.trim()) errors.name = "Enter your organisation's name.";
  const pick = (key: string, value: unknown, list: readonly string[]) => {
    if (value != null && value !== "" && !list.includes(value as string)) {
      errors[key] = "Choose an option from the list.";
    }
  };
  pick("businessType", o.businessType, BUSINESS_TYPES);
  pick("employees", o.employees, EMPLOYEE_BANDS);
  pick("country", o.country, COUNTRIES);
  pick("dialCode", o.dialCode, DIAL_CODES);
  if (o.associates != null && o.associates !== "") {
    const n = Number(o.associates);
    if (!Number.isInteger(n) || n < 0 || n > 1_000_000) errors.associates = "Enter a whole number.";
  }
  if (typeof o.contactName !== "string" || !o.contactName.trim()) {
    errors.contactName = "Enter the contact person's name.";
  }
  const email = typeof o.email === "string" ? o.email.trim() : "";
  if (!email) errors.email = "Enter the organisation's email.";
  else if (!isEmail(email)) errors.email = "Enter a valid email address.";
  if (typeof o.phone === "string" && o.phone.trim() && !/^[0-9 ()-]{6,20}$/.test(o.phone.trim())) {
    errors.phone = "Enter a phone number using digits only.";
  }
  for (const k of ["name", "city", "contactName", "designation"] as const) {
    tooLong(errors, k, typeof o[k] === "string" ? (o[k] as string) : null);
  }
  return errors;
}

// ── Payment method ───────────────────────────────────────────────────────────

export type PaymentMethod = "upi" | "card" | "netbanking" | "wallet";

/**
 * `#acs-payment`'s four `.ac-method` rows. A method is the CATEGORY the
 * provider's hosted page opens on — the instrument itself (a card number, a UPI
 * ID, a bank login) is typed on that page and never here (§1.2).
 */
export const PAYMENT_METHODS: readonly { id: PaymentMethod; label: string; chips: string[] }[] = [
  { id: "upi", label: "UPI", chips: ["GPay", "PhonePe", "Paytm"] },
  { id: "card", label: "Credit / Debit card", chips: ["Visa", "MC", "Rupay"] },
  { id: "netbanking", label: "Net banking", chips: ["HDFC", "ICICI", "SBI"] },
  { id: "wallet", label: "Wallets", chips: ["Paytm", "Amazon"] },
];

export function isPaymentMethod(v: unknown): v is PaymentMethod {
  return PAYMENT_METHODS.some((m) => m.id === v);
}

// ── The catalogue, projected onto the wizard ─────────────────────────────────

/** The groups the individual plan screen offers, in catalogue order. */
export const INDIVIDUAL_GROUPS: readonly PlanGroupId[] = ["subscription", "credit_pack"];
/** The group the organisation plan screen offers. */
export const ORGANIZATION_GROUPS: readonly PlanGroupId[] = ["enterprise"];

/**
 * Plans in `group` a customer may buy in `currency`: listed (active), priced in
 * that currency, and not free. The free trial is granted, never bought.
 */
export function purchasablePlans(
  book: PublishedPriceBook,
  group: PlanGroupId,
  currency: string,
): PricePlanRow[] {
  if (group === "free_trial") return [];
  const listed = new Set(listedPlans(book).map((p) => p.id));
  return plansInGroup(book, group)
    .filter((p) => listed.has(p.id))
    .filter((p) => (p.amounts[currency] ?? 0) > 0)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/** The groups that actually have something to sell, so an empty tab is never drawn. */
export function sellableGroups(
  book: PublishedPriceBook,
  groups: readonly PlanGroupId[],
  currency: string,
): PriceGroupRow[] {
  return groups
    .filter((g) => purchasablePlans(book, g, currency).length > 0)
    .map((g) => groupOf(book, g))
    .filter((g): g is PriceGroupRow => g !== undefined);
}

/** The currencies a customer may be billed in — the catalogue's active chips. */
export function billableCurrencies(book: PublishedPriceBook): string[] {
  return book.currencies
    .filter((c) => c.active)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((c) => c.code);
}

/** The catalogue's `TaxConfig`, in the shape `priceBreakdown` takes. A mapping, not a rule. */
export function taxSettingsOf(tax: TaxConfig): TaxSettings {
  return {
    ratePct: tax.gstRatePct,
    registration: tax.gstRegistration,
    inclusive: tax.pricesIncludeGst,
    internationalNotice: tax.showInternationalTaxNotice,
  };
}

/** A plan's `features` copy as bullets — the catalogue joins them with " · ". */
export function featureBullets(plan: Pick<PricePlanRow, "features">): string[] {
  if (!plan.features) return [];
  return plan.features
    .split("·")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The symbol a currency prints with, from the catalogue first. */
export function symbolFor(book: PublishedPriceBook, currency: string): string {
  return book.currencies.find((c) => c.code === currency)?.symbol ?? currencySymbol(currency);
}

export type QuoteError =
  | "unknown_plan"
  | "plan_not_purchasable"
  | "not_priced_in_currency"
  | "organization_required"
  | "invalid_quantity"
  | "extras_not_priced";

export interface OrderQuote {
  plan: PricePlanRow;
  group: Exclude<PlanGroupId, "free_trial">;
  currency: string;
  /** The stated price of ONE unit in `currency`, as the catalogue publishes it. */
  amountMinor: number;
  /**
   * How many of the plan were ordered. 1 for a seat or an enterprise plan; the
   * deck count for a paid-trial pack, which the prototype sells in 10s (`PAID_PACKS`).
   */
  quantity: number;
  /** `IEXTRA_PACKS` — extra decks bought on top, at the tier's credit rate. */
  extraCredits: number;
  /** What those extra decks cost, in minor units. Zero when none were taken. */
  extraMinor: number;
  /** Decks the order grants in total: `units × quantity + extraCredits`. */
  unitsTotal: number | null;
  /** `amountMinor × quantity + extraMinor`, before tax. */
  subtotalMinor: number;
  breakdown: TaxBreakdown;
}

/** The two quantities a v3 order can carry beyond the plan itself. */
export interface OrderExtras {
  quantity?: number;
  extraCredits?: number;
}

/**
 * The extra-credit rate for the plan being bought, in minor units per deck.
 *
 * The prototype hard codes `ICREDIT_RATE` as 23.04 / 30.72 / 40.96 and says in
 * a comment where they came from: the ANNUAL plan price divided by its 500
 * included decks. Deriving it keeps the rate honest when an administrator edits
 * that annual price in Price configuration — which is the whole point of item
 * 15 feeding item 17. An enterprise order uses the Premium rate, exactly as
 * `renderOrgExtra()` does.
 */
export function extraCreditRate(
  book: PublishedPriceBook,
  plan: PricePlanRow,
  currency: string,
): number {
  const tier = plan.group === "enterprise" ? "premium" : plan.tier;
  if (!tier) return 0;
  return extraCreditRateMinor(book, tier, currency) ?? 0;
}

/**
 * What an order for `planCode` costs, in `currency`, under the published book —
 * the ONE place the wizard and the server both turn a catalogue row into money.
 *
 * Enterprise plans are for organisation accounts only (the prototype offers
 * them on `#acs-orgplan`, reached only through the Organization branch).
 */
export function quoteOrder(
  book: PublishedPriceBook,
  planCode: string,
  currency: string,
  accountType: AccountType,
  extras: OrderExtras = {},
): OrderQuote | { error: QuoteError } {
  const plan = book.plans.find((p) => p.code === planCode);
  if (!plan) return { error: "unknown_plan" };
  if (plan.group === "free_trial") return { error: "plan_not_purchasable" };
  if (!listedPlans(book).some((p) => p.id === plan.id)) return { error: "plan_not_purchasable" };
  if (plan.group === "enterprise" && accountType !== "organization") {
    return { error: "organization_required" };
  }
  const amountMinor = plan.amounts[currency] ?? 0;
  if (!billableCurrencies(book).includes(currency) || amountMinor <= 0) {
    return { error: "not_priced_in_currency" };
  }

  const quantity = normaliseCount(extras.quantity, 1);
  const extraCredits = normaliseCount(extras.extraCredits, 0);
  if (quantity < 1) return { error: "invalid_quantity" };
  if (extraCredits < 0) return { error: "invalid_quantity" };
  // A rate of 0 means the catalogue has no annual seat to derive one from, so
  // extra credits cannot be priced — refusing beats charging nothing for them.
  const rate = extraCredits > 0 ? extraCreditRate(book, plan, currency) : 0;
  if (extraCredits > 0 && rate <= 0) return { error: "extras_not_priced" };
  const extraMinor = Math.round(rate * extraCredits);
  const subtotalMinor = amountMinor * quantity + extraMinor;

  return {
    plan,
    group: plan.group,
    currency,
    amountMinor,
    quantity,
    extraCredits,
    extraMinor,
    unitsTotal: plan.units === null ? (extraCredits || null) : plan.units * quantity + extraCredits,
    subtotalMinor,
    breakdown: priceBreakdown(subtotalMinor, taxSettingsOf(book.tax), currency),
  };
}

/** A count from a request body: a non-negative integer, or NaN to be refused. */
function normaliseCount(v: number | undefined, fallback: number): number {
  if (v === undefined) return fallback;
  return Number.isInteger(v) ? v : -1;
}

// ── The receipt ──────────────────────────────────────────────────────────────

/** What `/api/account/orders` returns and the receipt renders. */
export interface AccountOrderView {
  /** The payment intent id — the receipt's reference. */
  id: string;
  planCode: string | null;
  planName: string;
  group: Exclude<PlanGroupId, "free_trial">;
  period: BillingPeriod | null;
  /** 3 · 6 · 12 on a seat order; NULL on everything that predates V3-PT. */
  periodMonths: number | null;
  units: number | null;
  currency: string;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  ratePct: number;
  taxed: boolean;
  /** `recorded` on every build today: nothing has been charged (§1.3). */
  status: "recorded" | "redirected" | "completed" | "failed" | "cancelled";
  checkoutUrl: string | null;
  paymentMethod: PaymentMethod;
  accountType: AccountType;
  createdAt: string;
}

/**
 * The receipt's "Billing cycle" line. Stated from the plan's period, never a
 * date we invent. `periodMonths` wins where both are present — it is the only
 * one of the two that can say "quarter" (`migrations/0073`).
 */
export function billingCycleLine(
  period: AccountOrderView["period"],
  periodMonths: number | null = null,
): string {
  const p = periodMonths != null ? periodFromMonths(periodMonths) ?? period : period;
  if (p === "year") return "Annual subscription · renews yearly";
  if (p === "half_year") return "Billed per half-year · renews every 6 months";
  if (p === "quarter") return "Billed per quarter · renews every 3 months";
  if (p === "month") return "Monthly subscription · renews monthly";
  return "One-time purchase · credits never expire";
}

function periodFromMonths(months: number): BillingPeriod | null {
  if (months === 1) return "month";
  if (months === 3) return "quarter";
  if (months === 6) return "half_year";
  if (months === 12) return "year";
  return null;
}

/** The label a plan's price carries beside it on a card ("/mo", "Annual"). */
export function periodLabel(period: PricePlanRow["period"]): string {
  if (period === "month") return "/mo";
  if (period === "quarter") return "/quarter";
  if (period === "half_year") return "/half-year";
  if (period === "year") return "Annual";
  return "";
}

/** The prototype's `IPERIODS` — label, sub-line and its "Best value" flag. */
export const SEAT_PERIOD_VIEWS: readonly {
  months: number;
  label: string;
  sub: string;
  best?: true;
}[] = [
  { months: 3, label: "Quarter", sub: "3 months" },
  { months: 6, label: "Half-year", sub: "6 months" },
  { months: 12, label: "Year", sub: "12 months", best: true },
];

/** `IPLABEL` — the word after "per" on the payment and receipt lines. */
export function seatPeriodWord(months: number | null): string {
  if (months === 3) return "quarter";
  if (months === 6) return "half-year";
  if (months === 12) return "year";
  if (months === 1) return "month";
  return "period";
}

/** The prototype's `IEXTRA_PACKS` — the extra-credit pack sizes, in decks. */
export const EXTRA_CREDIT_PACKS: readonly number[] = [125, 250, 375, 500];

/** The prototype's `PAID_PACKS` — the paid trial's deck counts. */
export const PAID_TRIAL_PACKS: readonly number[] = [10, 20, 30, 40, 50];

/** The prototype's free trial: three decks, used one at a time. */
export const FREE_TRIAL_DECKS = 3;

/** Human status for a recorded order. Never "Paid" unless a provider said so. */
export function orderStatusLabel(status: AccountOrderView["status"]): string {
  switch (status) {
    case "completed":
      return "Paid";
    case "redirected":
      return "Awaiting payment";
    case "failed":
      return "Payment could not be started";
    case "cancelled":
      return "Cancelled";
    default:
      return "Recorded — not charged";
  }
}
