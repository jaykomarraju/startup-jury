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
  seatPlanFor,
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
  PLAN_LABELS,
  PLANS,
  type BillingAddress,
  type Plan,
  type TaxBreakdown,
  type TaxSettings,
} from "./plans";

// ── The two branches and their stepper ───────────────────────────────────────

export type AccountType = "individual" | "organization";

export type AccountScreen =
  | "account"
  | "orgtype"
  | "orgdetails"
  /**
   * `#acs-orgplan` — the organisation's enterprise seat-count plans.
   *
   * **V6 does not draw this screen and it is NOT being deleted.** `AISJ_MyAccount_V6`
   * drops the `<div id="acs-orgplan">` markup but keeps every line of its driver
   * (`renderOrgPlans`, `acOrgPlan`, `acOrgPlanKey`, `acSetOrgSel`, the `acGo`
   * hook and the `acRefreshPricing` branch), and the file's own comment calls
   * the ₹ `PRICING.ent` figures behind it "dead code — unreachable path". That
   * is a statement about the INCUBATOR superuser mockup, which is the only file
   * V6 re-exports. In this build the screen is still reached by a case V6 does
   * not draw: the VC edition's organisation branch, where `seatFlow` is false
   * and `LegacyOrgPlanScreen` renders it (`e2e/account-purchase.spec.ts`, the
   * out-of-scope tripwire, walks exactly that path). V6's `entplans` replaces
   * it only for the incubator, and only with FIXED bundles — so the incubator
   * path moves to `super` and `orgplan` keeps serving the edition that was
   * never rescoped.
   */
  | "orgplan"
  | "plan"
  /** V3-PT · `#acs-trial` — the three free decks, used one at a time. */
  | "trial"
  /** V3-PT · `#acs-paidtrial` — buy 10–50 more decks at the paid-trial rate. */
  | "paidtrial"
  /** V6 · `#acs-super` — nominate the organisation's top account authority. */
  | "super"
  /** V6 · `#acs-annual` — one Premium seat, plus seats and credits added to it. */
  | "annual"
  /** V6 · `#acs-entplans` — the fixed annual bundles, reached from `annual`. */
  | "entplans"
  /** V6 · `#acs-billing` — the address that decides currency, tax and invoice. */
  | "billing"
  /** V6 · `#acs-team` — invite colleagues and assign roles, after the order. */
  | "team"
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
  // V6's `setSteps()`, both maps verbatim, with one key the file leaves out.
  //
  //   enterprise {account:0,orgtype:1,orgdetails:2,super:2,plan:3,trial:3,
  //               paidtrial:3,annual:3,entplans:3,billing:4,payment:4,success:5}
  //   individual {account:0,plan:1,trial:1,paidtrial:1,annual:1,entplans:1,
  //               super:2,billing:2,payment:2,success:2}
  //
  // `team` is in V6's `SCREENS` but in neither map, so the prototype renders a
  // stepper with NOTHING active on it — `idx` is `undefined` there and every
  // step falls through to "todo". It is the post-purchase step, so it takes the
  // last position (already "done" on arrival, which is what it is).
  const index =
    type === "organization"
      ? {
          account: 0, orgtype: 1, orgdetails: 2, super: 2, orgplan: 3, plan: 3,
          trial: 3, paidtrial: 3, annual: 3, entplans: 3,
          billing: 4, payment: 4, success: 5, team: 5,
        }[screen]
      : {
          account: 0, orgtype: 0, orgdetails: 0, orgplan: 1, plan: 1,
          trial: 1, paidtrial: 1, annual: 1, entplans: 1,
          super: 2, billing: 2, payment: 2, success: 2, team: 2,
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

// ── V6 · `#acs-billing` — the address that decides the money ─────────────────

/**
 * `#bill-country-list`, verbatim and in the mockup's order.
 *
 * It is a `<datalist>` in V6, not a `<select>`: the field accepts anything typed
 * and these are suggestions. So this list is NOT a validation allow-list the way
 * `COUNTRIES` is for `#acs-orgdetails` — a customer in a country V6 did not list
 * must still be able to be billed. `validateBillingDetails` therefore checks
 * that the field is FILLED, never that it is one of these.
 */
export const BILLING_COUNTRIES = [
  "India",
  "United States",
  "United Kingdom",
  "United Arab Emirates",
  "Singapore",
  "Canada",
  "Australia",
  "Germany",
  "Other",
] as const;

/**
 * **The address itself, its validation and the currency it implies all live in
 * `src/shared/plans.ts`** — `BillingAddress`, `validateBillingAddress` and
 * `resolveBillingLocale`, beside the `TaxSettings` the rate comes from. This
 * lane wrote neither, on purpose and then in fact: a second copy of
 * "India → INR + GST" next to this form is precisely how the product grew four
 * different AI-gate thresholds, and the server refuses an order whose currency
 * disagrees with the saved country (`currency_not_for_billing_country`), so a
 * screen answering it differently would simply produce a 400.
 *
 * Only the screen's own furniture is here: the datalist and a blank seed.
 */
export const EMPTY_BILLING_ADDRESS: BillingAddress = { name: "", city: "", country: "", address: "" };

// ── V6 · `#acs-super` — the organisation's top account authority ──────────────

/** `#ac-super-name` / `#ac-super-email`. */
export interface SuperUserNomination {
  name: string;
  email: string;
}

/**
 * `acSuperNext()` — V6 refuses to continue on a blank email and focuses the
 * field (`if(e && !e.value.trim()){ e.focus(); return; }`); it never checks the
 * name. This adds the work-email check the Account screen already applies,
 * because V6's own hint says "They'll log in with this email and set their
 * password" — a personal mailbox the rest of the wizard rejects cannot be the
 * one account that manages billing.
 */
export function validateSuperUser(s: { name?: unknown; email?: unknown }): FieldErrors {
  const errors: FieldErrors = {};
  const name = typeof s.name === "string" ? s.name.trim() : "";
  const email = typeof s.email === "string" ? s.email.trim() : "";
  if (!name) errors.name = "Enter the super user's full name.";
  if (!email) errors.email = "Enter the super user's work email.";
  else if (!isEmail(email)) errors.email = "Enter a valid email address.";
  else if (!isWorkEmail(email)) errors.email = "Personal email addresses are not accepted.";
  tooLong(errors, "name", name);
  return errors;
}

// ── V6 · `#acs-team` — add your team ─────────────────────────────────────────

/** `AET_ROLES`, verbatim. */
export const TEAM_ROLES = [
  "Superuser",
  "Program Manager",
  "Program Associate",
  "Jury Member",
] as const;

export type TeamSeatTierId = "basic" | "configurable" | "customisable";

/**
 * `AET_PLANS` — the three seat tiers the Team screen previews, in the mockup's
 * own words. `seats: null` is V6's `Infinity`: unlimited.
 *
 * These are SEAT CEILINGS, not prices — no amount appears on this screen, so
 * nothing here is a price literal. The "Preview plan" pills let a superuser see
 * what each ceiling allows before buying it, which is what V6 draws.
 */
export const TEAM_SEAT_TIERS: readonly {
  id: TeamSeatTierId;
  /** The pill's label, e.g. "Basic (3 seats)". */
  pill: string;
  /** The plan bar's name. */
  name: string;
  sub: string;
  seats: number | null;
  /** V6 hides "Upgrade plan" on the unlimited tier. */
  upgradable: boolean;
}[] = [
  { id: "basic", pill: "Basic (3 seats)", name: "Basic plan", sub: "Up to 3 users · Fixed monthly quota", seats: 3, upgradable: true },
  { id: "configurable", pill: "Configurable (5 seats)", name: "Configurable plan", sub: "Up to 5 users · CRM sync included", seats: 5, upgradable: true },
  { id: "customisable", pill: "Customisable (unlimited)", name: "Customisable plan", sub: "Unlimited users · Dedicated support + SLA", seats: null, upgradable: false },
];

export function teamSeatTier(id: TeamSeatTierId) {
  // Non-null: `id` is the union of the three literals above.
  return TEAM_SEAT_TIERS.find((t) => t.id === id)!;
}

/** `aetSeatsFull()` — `p.seats!==Infinity && aetMembers.length>=p.seats`. */
export function teamSeatsFull(id: TeamSeatTierId, memberCount: number): boolean {
  const seats = teamSeatTier(id).seats;
  return seats !== null && memberCount >= seats;
}

/** `aet-pb-seat` — "2 / 3 seats used", or "Unlimited seats". */
export function teamSeatLabel(id: TeamSeatTierId, memberCount: number): string {
  const seats = teamSeatTier(id).seats;
  return seats === null ? "Unlimited seats" : `${memberCount} / ${seats} seats used`;
}

/** V6's `aetMembers` rows — client-side until a server route exists for them. */
export interface TeamInvite {
  email: string;
  role: string;
  /** Each member's own 3 configurable parameters (`m.params`). */
  params: [string, string, string];
}

/** `aetInitials()` — two letters from the local part, split on `. _ -`. */
export function teamInitials(email: string): string {
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[._-]/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return local.slice(0, 2).toUpperCase();
}

// ── V6 · `#acs-annual` — one Premium seat, plus what you add to it ────────────

/**
 * **10 GB of storage per seat, on Standard / Pro / Premium alike.** V6 states it
 * on every seat row of `#acs-annual` ("Standard seat (10 GB storage)", …) and on
 * the base line, and never varies it by tier. One constant, so no screen can
 * disagree with another about it.
 */
export const SEAT_STORAGE_GB = 10;

/** The annual seat's period, in months. `#acs-annual` sells nothing shorter. */
export const ANNUAL_SEAT_MONTHS = 12;

/**
 * `annSeats` — how many of each annual seat tier the cart holds.
 *
 * V6's base line is "1 Premium Seat (10 GB storage) — Annual · 125 Credits
 * included", and `annTotal()` adds `annBase` to the stepper counts. Here the
 * base is simply `premium: 1` in the starting cart, so one sum covers both and
 * nothing is special-cased: `annualCartQuote` prices what the cart says.
 */
export type AnnualSeatCounts = Record<Plan, number>;

export interface AnnualCart {
  seats: AnnualSeatCounts;
  /** Extra decks taken with the subscription, at the Premium credit rate. */
  extraCredits: number;
}

/** V6's starting cart: the subscription "starts with one Premium seat". */
export function initialAnnualCart(): AnnualCart {
  return { seats: { standard: 0, pro: 0, premium: 1 }, extraCredits: 0 };
}

export function annualSeatsTotal(cart: AnnualCart): number {
  return PLANS.reduce((n, tier) => n + Math.max(0, cart.seats[tier] ?? 0), 0);
}

/** One priced row of the annual cart. `unitMinor` is the catalogue's own figure. */
export interface AnnualCartLine {
  key: string;
  label: string;
  sub: string;
  quantity: number;
  unitMinor: number;
  amountMinor: number;
  /** Decks the line grants, from the catalogue row's `units`. */
  units: number | null;
}

/**
 * Why a cart cannot be placed as one order.
 *
 * `mixed_tiers` is not a rule of V6's — it is a limit of THIS build, and it is
 * recorded rather than papered over. `POST /api/account/orders` takes a single
 * `planCode` with a `quantity` and re-prices it server-side (§1.1: the server
 * never trusts a price from the client). A cart holding two different seat
 * tiers is two catalogue rows, so there is no `planCode` that describes it, and
 * the only ways to "fix" that from this lane would be to send one tier's code
 * with the other tier's money — which is the class of bug this programme keeps
 * finding — or to compute a total here that the server would not agree with.
 */
export type AnnualCartBlock = "nothing_priced" | "mixed_tiers";

export interface AnnualCartQuote {
  lines: AnnualCartLine[];
  seatsTotal: number;
  extraCredits: number;
  extraMinor: number;
  subtotalMinor: number;
  breakdown: TaxBreakdown;
  /** Decks the whole cart grants, or null when no row states any. */
  unitsTotal: number | null;
  /** The one catalogue line this cart reduces to, ready for `placeOrder`. */
  order: { planCode: string; quantity: number; extraCredits: number } | null;
  blocked: AnnualCartBlock | null;
}

/**
 * The annual cart, priced from the PUBLISHED catalogue and taxed by the one
 * tax rule (`priceBreakdown` ← `taxSettingsOf`). No figure in this function is
 * written here: the seat prices are `seat_<tier>_12` rows, the extra-credit rate
 * is derived from the Premium annual seat the same way `extraCreditRate` does
 * it, and the GST rate is the catalogue's.
 */
export function annualCartQuote(
  book: PublishedPriceBook,
  cart: AnnualCart,
  currency: string,
): AnnualCartQuote {
  const listed = new Set(listedPlans(book).map((p) => p.id));
  const lines: AnnualCartLine[] = [];
  const codes: { planCode: string; quantity: number }[] = [];
  let unitsTotal: number | null = null;

  for (const tier of PLANS) {
    const quantity = Math.max(0, Math.trunc(cart.seats[tier] ?? 0));
    if (quantity === 0) continue;
    const plan = seatPlanFor(book, tier, ANNUAL_SEAT_MONTHS);
    const unitMinor = plan && listed.has(plan.id) ? (plan.amounts[currency] ?? 0) : 0;
    if (!plan || unitMinor <= 0) continue;
    lines.push({
      key: `seat_${tier}`,
      label: `${PLAN_LABELS[tier]} seat (${SEAT_STORAGE_GB} GB storage)`,
      sub: "Annual",
      quantity,
      unitMinor,
      amountMinor: unitMinor * quantity,
      units: plan.units,
    });
    codes.push({ planCode: plan.code, quantity });
    if (plan.units !== null) unitsTotal = (unitsTotal ?? 0) + plan.units * quantity;
  }

  // The rate the extras are priced at, derived from the PREMIUM annual seat —
  // the same choice `renderOrgExtra()` makes, because V6's base seat is Premium.
  const rate = extraCreditRateMinor(book, "premium", currency) ?? 0;
  const extraCredits = Math.max(0, Math.trunc(cart.extraCredits));
  const extraMinor = rate > 0 ? Math.round(rate * extraCredits) : 0;
  if (extraCredits > 0 && extraMinor > 0) {
    lines.push({
      key: "extra_credits",
      label: `${extraCredits.toLocaleString("en-IN")} extra deck credits`,
      sub: "1 credit = 1 deck · credits never expire",
      quantity: extraCredits,
      unitMinor: Math.round(rate),
      amountMinor: extraMinor,
      units: extraCredits,
    });
    unitsTotal = (unitsTotal ?? 0) + extraCredits;
  }

  const subtotalMinor = lines.reduce((sum, l) => sum + l.amountMinor, 0);
  const blocked: AnnualCartBlock | null =
    codes.length === 0 ? "nothing_priced" : codes.length > 1 ? "mixed_tiers" : null;

  return {
    lines,
    seatsTotal: annualSeatsTotal(cart),
    extraCredits,
    extraMinor,
    subtotalMinor,
    breakdown: priceBreakdown(subtotalMinor, taxSettingsOf(book.tax), currency),
    unitsTotal,
    order:
      blocked === null && codes[0]
        ? { planCode: codes[0].planCode, quantity: codes[0].quantity, extraCredits }
        : null,
    blocked,
  };
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
