/**
 * W6-B — **My account**, the prototype's `#acct-overlay` (`_rest.html:558-907`).
 *
 * A full-screen overlay, not a page in the app shell: `position:fixed; inset:0`
 * over the dashboard, a centred wordmark, an X at the top right, Escape to
 * close and the body scroll locked (`openAccount` / `acctClose`,
 * `_scripts.js:3054-3078`). The stepper and receipt depend on the full-bleed
 * 780 px column, and an account-and-payment flow framed by the sidebar reads as
 * a settings screen — which is what the application used to ship under this name.
 *
 * Two entries, one flow:
 *   • My account  (`/app/account`) opens at Account — `openAccount()`.
 *   • Buy credits (`/app/billing`) opens at Plan on the credit packs —
 *     `openBuyCredits()`, which the prototype defines as exactly that.
 *
 * Branches (`acAccountNext`):
 *   Individual   → Account → Plan → Payment → Done
 *   Organization → Account → Org type → Org details → Plan → Payment → Done
 *
 * What it does NOT reproduce, and why (each is recorded in plan_parity.md §8):
 *   • Any price literal. Plans, packs and annual plans are the PUBLISHED
 *     catalogue's rows (`GET /api/pricing/published`).
 *   • Card, UPI-ID or bank fields (§1.2). The method is the category the
 *     provider's hosted page opens on.
 *   • "Payment successful" for a payment nobody took (§1.3). The receipt says
 *     what happened: the order is recorded.
 *   • The password field. Everyone who can open this overlay is already signed
 *     in; a password box here would either do nothing or change a credential
 *     without the current one.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { usePermissions } from "../../auth/usePermissions";
import { useBranding } from "../../theme/useBranding";
import { landingNavId } from "../../../shared/nav";
import {
  enterpriseSeatPlans,
  isSeatCatalogueRow,
  paidTrialPlan,
  seatPlanFor,
  type PlanGroupId,
  type PublishedPriceBook,
} from "../../../shared/priceBook";
import {
  PLAN_LABELS,
  resolveBillingLocale,
  validateBillingAddress,
  type BillingAddress,
  type BillingLocale,
  type Plan,
} from "../../../shared/plans";
import {
  EMPTY_BILLING_ADDRESS,
  INDIVIDUAL_GROUPS,
  ORGANIZATION_GROUPS,
  PAID_TRIAL_PACKS,
  FREE_TRIAL_DECKS,
  TEAM_ROLES,
  annualCartQuote,
  billableCurrencies,
  initialAnnualCart,
  nextAfterAccount,
  planScreenFor,
  purchasablePlans,
  quoteOrder,
  sellableGroups,
  stepperFor,
  teamSeatsFull,
  taxSettingsOf,
  validateAccountFields,
  validateOrgDetails,
  validateSuperUser,
  type AccountOrderView,
  type AccountProfile,
  type AccountScreen,
  type AnnualCart,
  type FieldErrors,
  type OrgKind,
  type PaymentMethod,
  type SuperUserNomination,
  type TeamInvite,
  type TeamSeatTierId,
} from "../../../shared/accountOrder";
import {
  AccountApiError,
  getAccount,
  getPublishedCatalogue,
  orderDocumentUrl,
  placeOrder,
  saveBillingAddress,
  saveProfile,
  type AccountState,
} from "./accountApi";
import {
  AccountScreen as AccountStep,
  AnnualSubscriptionScreen,
  BTN_GHOST,
  BillingDetailsScreen,
  Card,
  EnterprisePlansScreen,
  EnterpriseSeatScreen,
  LegacyOrgPlanScreen,
  LegacyPlanScreen,
  OrgDetailsScreen,
  OrgTypeScreen,
  PaidTrialScreen,
  PaymentScreen,
  ReceiptScreen,
  SeatScreen,
  Stepper,
  SuperUserScreen,
  TeamScreen,
  TrialScreen,
  type AccountDraft,
  type OrgDraft,
} from "./AccountScreens";

/** `#acct-overlay`'s own palette (`--ac-green*`), scoped to the overlay. */
const OVERLAY_VARS = {
  "--ac-green": "#4E9C84",
  "--ac-green-dk": "color-mix(in srgb, #2F7A66 80%, var(--fg))",
  "--ac-green-lt": "color-mix(in srgb, #4E9C84 12%, var(--surface))",
} as CSSProperties;

export type AccountEntry = "account" | "buy-credits";

/**
 * What `resolveBillingLocale` answers when there is nothing to resolve against.
 * `note: null` is what keeps V6's `#bill-currency-note` hidden, and `currency:
 * null` is what leaves the currency picker alone — neither is a default.
 */
const UNRESOLVED_LOCALE: BillingLocale = {
  country: null,
  currency: null,
  taxed: false,
  ratePct: 0,
  note: null,
};

function accountDraftOf(p: AccountProfile): AccountDraft {
  return {
    accountType: p.accountType,
    workEmail: p.workEmail,
    firstName: p.firstName,
    lastName: p.lastName,
    dialCode: p.dialCode ?? "+91",
    phone: p.phone ?? "",
    designation: p.designation ?? "",
    organizationName: p.organizationName ?? "",
  };
}

function orgDraftOf(p: AccountProfile, fallbackKind: OrgKind): { kind: OrgKind; draft: OrgDraft } {
  const o = p.org;
  return {
    kind: o?.kind ?? fallbackKind,
    draft: {
      name: o?.name ?? p.organizationName ?? "",
      businessType: o?.businessType ?? "",
      employees: o?.employees ?? "",
      associates: o?.associates == null ? "" : String(o.associates),
      city: o?.city ?? "",
      country: o?.country ?? "",
      contactName: o?.contactName ?? `${p.firstName} ${p.lastName}`.trim(),
      designation: o?.designation ?? p.designation ?? "",
      dialCode: o?.dialCode ?? p.dialCode ?? "+91",
      phone: o?.phone ?? p.phone ?? "",
      email: o?.email ?? p.workEmail,
    },
  };
}

const blank = (s: string) => (s.trim() ? s.trim() : null);

/** What the server's refusal means to the person at the keyboard. */
function orderErrorMessage(err: unknown): string {
  const code = err instanceof AccountApiError ? err.code : "";
  switch (code) {
    case "not_priced_in_currency":
      return "That plan is not sold in this currency. Choose another currency or plan.";
    case "currency_not_for_billing_country":
      // The server refuses rather than re-denominating, so the honest fix is to
      // go back to the address that set the currency.
      return "Your billing address sets the currency for this order. Go back to Billing details and check the country.";
    case "invalid_billing_address":
      return "Your billing details are incomplete. Go back and fill all four fields.";
    case "organization_required":
      return "Annual plans are for organisation accounts. Switch your account type to Organization first.";
    case "plan_not_purchasable":
    case "unknown_plan":
      return "That plan is no longer on sale. Go back and choose another.";
    case "account_required":
      return "Add your account details before placing an order.";
    case "forbidden":
      return "Your role cannot purchase plans or credits.";
    default:
      return "We couldn't record your order. Try again.";
  }
}

export function AccountOverlay({ entry }: { entry: AccountEntry }) {
  const { user } = useAuth();
  const can = usePermissions();
  const { branding } = useBranding();
  const navigate = useNavigate();
  const location = useLocation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [cameFromApp] = useState(() => location.key !== "default");

  const [state, setState] = useState<AccountState | null>(null);
  const [book, setBook] = useState<PublishedPriceBook | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const [screen, setScreen] = useState<AccountScreen>(entry === "buy-credits" ? "plan" : "account");
  const [account, setAccount] = useState<AccountDraft | null>(null);
  const [orgKind, setOrgKind] = useState<OrgKind>(user?.edition === "vc" ? "investor" : "incubator");
  const [org, setOrg] = useState<OrgDraft | null>(null);
  const [saved, setSaved] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** A plan was chosen before the account existed ("Buy credits" first). */
  const [pendingPayment, setPendingPayment] = useState(false);

  const [currency, setCurrency] = useState<string>("INR");
  /**
   * V3-PT — the seat choice, `iTier` / `iPeriod` / `iExtra`.
   *
   * The prototype disables both footer buttons on every tier change and
   * re-enables them only when a period is picked (`acPickTier` → `acPickPeriod`),
   * so `months` is cleared with the tier rather than carried across.
   */
  const [individualGroup, setIndividualGroup] = useState<PlanGroupId>(
    entry === "buy-credits" ? "credit_pack" : "subscription",
  );
  const [planCode, setPlanCode] = useState<string | null>(null);
  const [tier, setTier] = useState<Plan | null>(null);
  const [months, setMonths] = useState<number | null>(null);
  const [extraCredits, setExtraCredits] = useState(0);
  /** `iPaidPack` — decks of the paid trial, 0 while none is chosen. */
  const [paidPack, setPaidPack] = useState(0);
  /** `iTrialLeft`, counted up rather than down. Local, spends nothing. */
  const [trialUsed, setTrialUsed] = useState(0);
  const [orgPlanCode, setOrgPlanCode] = useState<string | null>(null);

  // ── V6's five new screens ─────────────────────────────────────────────────
  /** `#acs-super` — `#ac-super-name` / `#ac-super-email`. */
  const [superUser, setSuperUser] = useState<SuperUserNomination>({ name: "", email: "" });
  /** `#acs-billing` — the address that decides the currency, tax and invoice. */
  const [billing, setBilling] = useState<BillingAddress>(EMPTY_BILLING_ADDRESS);
  /**
   * `billingBackTarget` — which screen sent us to Billing, and the flag that
   * says we went through it at all. `acPayBack()` in V6 always returns to
   * Billing; here Payment returns there only on the paths that visit it, so the
   * legacy and VC flows keep going back to their own plan screen.
   */
  const [billingBack, setBillingBack] = useState<AccountScreen | null>(null);
  /** `annSeats` + the extra decks taken with them. Starts at one Premium seat. */
  const [annualCart, setAnnualCart] = useState<AnnualCart>(initialAnnualCart);
  /** `entBundleKey` — the chosen fixed Enterprise bundle. */
  const [entPlanCode, setEntPlanCode] = useState<string | null>(null);
  /** `acPayMode` — which selection the Payment screen is pricing. */
  const [payMode, setPayMode] = useState<"" | "annual" | "entplans">("");
  /** `#acs-team` — `aetPlanKey`, `aetMembers` and the add-member row. */
  const [teamTier, setTeamTier] = useState<TeamSeatTierId>("basic");
  const [teamMembers, setTeamMembers] = useState<TeamInvite[]>([]);
  const [teamEmail, setTeamEmail] = useState("");
  const [teamRole, setTeamRole] = useState<string>(TEAM_ROLES[1]);
  const [teamError, setTeamError] = useState<string | null>(null);

  const [method, setMethod] = useState<PaymentMethod>("upi");
  const [orderError, setOrderError] = useState<string | null>(null);
  const [order, setOrder] = useState<AccountOrderView | null>(null);

  const edition = user?.edition ?? "incubator";
  const role = user?.role ?? "admin";

  const close = useCallback(() => {
    if (cameFromApp) navigate(-1);
    else navigate(`/app/${landingNavId(edition, role, can)}`, { replace: true });
  }, [cameFromApp, navigate, edition, role, can]);

  // ── Load, once per retry. The drafts are seeded from the FIRST response only:
  // StrictMode runs this effect twice, and a second response landing after the
  // first keystroke must not overwrite what the person has typed.
  const seeded = useRef(false);
  useEffect(() => {
    let live = true;
    setLoadError(null);
    Promise.all([getAccount(), getPublishedCatalogue()])
      .then(([acct, catalogue]) => {
        if (!live) return;
        setState(acct);
        setBook(catalogue);
        if (!seeded.current) {
          seeded.current = true;
          setAccount(accountDraftOf(acct.profile));
          const o = orgDraftOf(acct.profile, edition === "vc" ? "investor" : "incubator");
          setOrgKind(o.kind);
          setOrg(o.draft);
          // V6 ships `#acs-super` with both fields already filled (with mock
          // names). The faithful translation is the organisation's own contact
          // person, who is the likeliest super user — not a blank screen and not
          // somebody else's name. The BILLING screen stays empty on purpose:
          // V6 hides its currency note until a country is typed, so prefilling
          // a country would decide the currency behind the customer's back.
          setSuperUser({ name: o.draft.contactName, email: o.draft.email });
          setBilling({
            name: acct.billing.name ?? "",
            city: acct.billing.city ?? "",
            country: acct.billing.country ?? "",
            address: acct.billing.address ?? "",
          });
          setSaved(acct.saved);
          const currencies = billableCurrencies(catalogue);
          // V6-CURRENCY: a billing country ALREADY on file has already decided
          // the currency, and `POST /orders` will refuse any other. So the
          // picker's default is the resolved one, not the catalogue's base —
          // otherwise an Indian customer would be quoted in whatever the base
          // happens to be and then refused at Pay. `null` means no country is
          // recorded, and then nothing is enforced and the base stands.
          const resolved = acct.billing.locale.currency;
          const fallback = currencies.includes(catalogue.baseCurrency)
            ? catalogue.baseCurrency
            : currencies[0] ?? catalogue.baseCurrency;
          setCurrency(resolved && currencies.includes(resolved) ? resolved : fallback);
        }
      })
      .catch((err: unknown) => {
        if (!live) return;
        setLoadError(
          err instanceof AccountApiError && err.code === "not_published"
            ? "No price list has been published yet, so nothing can be bought. An administrator can publish one from Admin console → Price configuration."
            : "We couldn't load your account. Check your connection and try again.",
        );
      });
    return () => {
      live = false;
    };
  }, [reload, edition]);

  // ── Overlay behaviour: Escape, scroll lock, focus, and an inert shell behind.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    containerRef.current?.focus();
    return () => opener?.focus?.();
  }, []);

  useEffect(() => {
    const shell = document.querySelector<HTMLElement>("[data-app-shell-frame]");
    if (!shell) return;
    shell.setAttribute("inert", "");
    shell.setAttribute("aria-hidden", "true");
    return () => {
      shell.removeAttribute("inert");
      shell.removeAttribute("aria-hidden");
    };
  }, []);

  // Each screen starts at the top (`acGo` → `scrollTop = 0`).
  useEffect(() => {
    containerRef.current?.scrollTo?.({ top: 0 });
  }, [screen]);

  /**
   * **S3-ACCOUNT — the audience, widened on the client's word, not the file's.**
   *
   * `V3-PT` gated v3's seat flow to `incubator` + `superuser` because only
   * `AISJ_SuperuserV3.HTM` had been reshared (§4 Q85): `AISJ_ICAdmin_V6` still
   * draws "Choose your plan" with zero occurrences of `acs-trial` or `itiers`.
   * The client's 21-Sep row for **My account** says **Superuser/Admin**, so the
   * incubator ADMIN gets the same wizard — the instruction beats a prototype
   * file that was never re-exported, the same way item 13's "Not required"
   * beats the console copy it contradicts. **Recorded as a deviation in §12.4**;
   * the next parity capture of `AISJ_ICAdmin_V6` will otherwise revert it.
   *
   * It also closes an inconsistency §4 Q86 had already named from the other
   * side. A price book is GLOBAL — one `pricing_versions` row is live for
   * everybody — which is why the console's seat-price cards were deliberately
   * left UNgated for the admin. Until now that admin could EDIT the seat prices
   * and then not see a seat to buy: a partial view of one set of numbers.
   *
   * **In the incubator this makes the legacy plan screens unreachable**, because
   * `billing` is `roles: ["admin"]` plus the superuser bypass (`shared/nav.ts`)
   * — the overlay has no third incubator audience. They stay in the code and
   * stay reachable for the VC edition, which was NOT rescoped, and the negative
   * controls that prove it moved to VC with them.
   */
  const seatFlow = edition === "incubator" && (role === "superuser" || role === "admin");

  // ── The catalogue, projected ─────────────────────────────────────────────
  const currencies = useMemo(() => (book ? billableCurrencies(book) : []), [book]);

  // ── The legacy projection, for every audience v3 did not rescope ─────────
  const individualGroups = useMemo(
    () => (book && !seatFlow ? sellableGroups(book, INDIVIDUAL_GROUPS, currency) : []),
    [book, currency, seatFlow],
  );
  const legacyOrgGroup = useMemo(
    () =>
      book && !seatFlow
        ? (sellableGroups(book, ORGANIZATION_GROUPS, currency)[0] ??
          book.groups.find((g) => g.group === "enterprise"))
        : undefined,
    [book, currency, seatFlow],
  );
  const plansByGroup = useMemo(() => {
    const out: Record<string, ReturnType<typeof purchasablePlans>> = {};
    if (!book || seatFlow) return out;
    for (const g of [...INDIVIDUAL_GROUPS, ...ORGANIZATION_GROUPS]) {
      // The seat SKUs belong to the new screens; the old ones never drew them.
      out[g] = purchasablePlans(book, g, currency).filter((p) => !isSeatCatalogueRow(p));
    }
    return out;
  }, [book, currency, seatFlow]);
  const activeIndividual =
    individualGroups.find((g) => g.group === individualGroup) ?? individualGroups[0];
  const defaultPlanFor = useCallback(
    (group: PlanGroupId): string | null => {
      const plans = plansByGroup[group] ?? [];
      return (plans.find((p) => p.badge) ?? plans[0])?.code ?? null;
    },
    [plansByGroup],
  );
  const legacyScreenGroup: PlanGroupId | undefined = seatFlow
    ? undefined
    : screen === "orgplan"
      ? "enterprise"
      : screen === "plan"
        ? activeIndividual?.group
        : undefined;
  const legacySelectedCode = useMemo(() => {
    if (seatFlow) return null;
    if (!legacyScreenGroup) return planCode;
    const plans = plansByGroup[legacyScreenGroup] ?? [];
    return plans.some((p) => p.code === planCode) ? planCode : defaultPlanFor(legacyScreenGroup);
  }, [seatFlow, legacyScreenGroup, plansByGroup, planCode, defaultPlanFor]);

  /** `#ac-orgplans` — the three enterprise seat-count plans, ascending. */
  const orgPlans = useMemo(
    () => (book ? enterpriseSeatPlans(book).filter((p) => (p.amounts[currency] ?? 0) > 0) : []),
    [book, currency],
  );

  const accountType = account?.accountType ?? "individual";

  /**
   * V6-CURRENCY — what the typed billing country implies, resolved by
   * `src/shared/plans.ts` and by nothing here. `tax` is the PUBLISHED
   * catalogue's, through `taxSettingsOf`, so the note never names a rate of its
   * own. `currency` is null until a country is typed, which is exactly when V6
   * reveals `#bill-currency-note`.
   */
  const billingLocale = useMemo(
    // Before the catalogue lands there is no configured rate to report, and the
    // one thing this must not do is name a rate of its own — so it reports
    // nothing resolved at all, which is the same state as "no country typed".
    () => (book ? resolveBillingLocale(billing.country, taxSettingsOf(book.tax)) : UNRESOLVED_LOCALE),
    [billing.country, book],
  );

  /**
   * The currencies the customer may still choose between.
   *
   * V6 deletes `CurrencyPicker`: the address decides. Rather than delete a
   * control three other prototypes still draw, the LIST is narrowed — once a
   * billing country is on file there is exactly one legal currency, and
   * `CurrencyPicker` renders nothing below two. A picker left open here would
   * offer a currency `POST /orders` refuses.
   */
  const offeredCurrencies = useMemo(() => {
    const fixed = billingLocale.currency;
    return fixed && currencies.includes(fixed) ? [fixed] : currencies;
  }, [billingLocale.currency, currencies]);

  /**
   * The selection, always valid for the screen it is shown on. Derived during
   * render rather than repaired in an effect: an effect leaves one committed
   * frame with nothing selected, and a Continue clicked in that frame did nothing.
   *
   * The INDIVIDUAL branch starts with nothing chosen — v3's footer buttons are
   * disabled until a seat AND a period have been picked, so defaulting one in
   * would enable a Continue the prototype keeps shut. The ORGANISATION branch
   * keeps the old default (`acOrgPlanKey = 's10'`, the middle card), because
   * `renderOrgPlans` draws one selected on arrival.
   */
  const orgSelected = useMemo(() => {
    if (orgPlans.length === 0) return null;
    if (orgPlanCode && orgPlans.some((p) => p.code === orgPlanCode)) return orgPlanCode;
    return (orgPlans[Math.min(1, orgPlans.length - 1)] ?? orgPlans[0]).code;
  }, [orgPlans, orgPlanCode]);

  const seatPlan = useMemo(
    () => (book && tier && months ? seatPlanFor(book, tier, months) : undefined),
    [book, tier, months],
  );

  /** `#acs-entplans` — V6's fixed bundles are the catalogue's enterprise rows. */
  const entSelected = useMemo(
    () => (entPlanCode && orgPlans.some((p) => p.code === entPlanCode) ? entPlanCode : null),
    [entPlanCode, orgPlans],
  );

  /**
   * `#acs-annual`'s running total — priced from the catalogue and taxed by the
   * one tax rule, in `annualCartQuote`. Nothing here adds money up.
   */
  const annualQuote = useMemo(
    () => (book ? annualCartQuote(book, annualCart, currency) : null),
    [book, annualCart, currency],
  );

  /**
   * What the person is buying right now. Three shapes share one quote:
   *   a paid-trial pack (`paidPack` decks of `paid_trial`),
   *   an enterprise plan (+ extra decks at the Premium rate), or
   *   a seat for a period (+ extra decks at its own tier's rate).
   */
  const quote = useMemo(() => {
    if (!book) return null;
    if (!seatFlow) {
      if (!legacySelectedCode) return null;
      const legacy = quoteOrder(book, legacySelectedCode, currency, accountType);
      return "error" in legacy ? null : legacy;
    }
    let code: string | null = null;
    let extras: { quantity?: number; extraCredits?: number } = {};
    // V6's `acPayMode` branches come FIRST: an annual cart or an Enterprise
    // bundle is what the customer picked last, and it must beat the seat or
    // organisation default that is still sitting in state behind it.
    if (payMode === "annual") {
      if (!annualQuote?.order) return null;
      code = annualQuote.order.planCode;
      extras = { quantity: annualQuote.order.quantity, extraCredits: annualQuote.order.extraCredits };
    } else if (payMode === "entplans") {
      code = entSelected;
    } else if (paidPack > 0) {
      code = paidTrialPlan(book)?.code ?? null;
      extras = { quantity: paidPack };
    } else if (accountType === "organization") {
      code = orgSelected;
      extras = { extraCredits };
    } else if (seatPlan) {
      code = seatPlan.code;
      extras = { extraCredits };
    }
    if (!code) return null;
    const q = quoteOrder(book, code, currency, accountType, extras);
    return "error" in q ? null : q;
  }, [
    book, seatFlow, legacySelectedCode, paidPack, accountType, orgSelected, seatPlan,
    extraCredits, currency, payMode, annualQuote, entSelected,
  ]);

  /** The plan name the trial screen puts in "free on your <b>…</b>". */
  const chosenPlanName =
    accountType === "organization"
      ? (orgPlans.find((p) => p.code === orgSelected)?.name ?? "Enterprise Plan")
      : tier
        ? `${PLAN_LABELS[tier]} plan`
        : "selected plan";

  // ── Transitions ──────────────────────────────────────────────────────────
  const go = (next: AccountScreen) => {
    setErrors({});
    setOrderError(null);
    // `acGo`: "if(name==='plan'||name==='orgplan'||name==='account') acPayMode=''".
    // Returning to a plan screen abandons the annual cart or Enterprise bundle,
    // so the Payment screen cannot price a selection the customer left behind.
    if (next === "plan" || next === "orgplan" || next === "account") {
      setPayMode("");
      setBillingBack(null);
    }
    setScreen(next);
  };

  /** `acGoBilling(back)` — remember who sent us, then show Billing details. */
  const goBilling = (from: AccountScreen) => {
    setBillingBack(from);
    setErrors({});
    setOrderError(null);
    setScreen("billing");
  };

  /**
   * `acBillingNext()` — validate, SAVE, and adopt the currency the address
   * implies before the Payment screen quotes a single figure.
   *
   * The order of those three matters. `POST /orders` refuses a currency that
   * disagrees with the saved billing country (`currency_not_for_billing_country`,
   * and it refuses rather than re-denominating), so the currency has to change
   * here — on the screen that explains why — and not underneath the customer at
   * the moment they press Pay. The server's resolution wins over the local one:
   * it is the one the order will be checked against.
   */
  async function continueFromBilling() {
    const found = validateBillingAddress(billing);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    setBusy(true);
    try {
      const res = await saveBillingAddress(billing);
      const resolved = res.billing.locale.currency;
      // Only if the catalogue actually sells in it — otherwise every price on
      // the next screen would read zero, which is worse than the wrong currency.
      if (resolved && currencies.includes(resolved)) setCurrency(resolved);
      go("payment");
    } catch (err) {
      setErrors(
        err instanceof AccountApiError && Object.keys(err.fields).length
          ? err.fields
          : { country: "We couldn't save your billing details. Try again." },
      );
    } finally {
      setBusy(false);
    }
  }

  /** `acSuperNext()`, with the work-email rule the Account screen already has. */
  function continueFromSuperUser() {
    const found = validateSuperUser(superUser);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    go("orgplan");
  }

  /** `acStartAnnual()` — resets the cart, exactly as V6 does on every entry. */
  function startAnnual() {
    setPaidPack(0);
    setAnnualCart(initialAnnualCart());
    setPayMode("annual");
    go("annual");
  }

  /** `acStartEntPlans()` — clears the bundle so nothing arrives pre-chosen. */
  function startEnterprisePlans() {
    setEntPlanCode(null);
    setPayMode("entplans");
    go("entplans");
  }

  /**
   * `acUpgradeToEnt()` — V6 flips `accountType` to enterprise and jumps to Org
   * details. This build goes to Org TYPE first, because `createOrganization`
   * sends the `kind` that screen chooses and V6's jump would leave it at a
   * default the customer never saw.
   */
  function upgradeToEnterprise() {
    setAccount((a) => (a ? { ...a, accountType: "organization" } : a));
    setSaved(false);
    go("orgtype");
  }

  /** `aetAdd()`, plus the refusal V6 leaves out: a blank or repeated address. */
  function addTeamMember() {
    const email = teamEmail.trim();
    if (teamSeatsFull(teamTier, teamMembers.length)) return;
    if (!email) {
      setTeamError("Enter a work email to invite.");
      return;
    }
    if (teamMembers.some((m) => m.email.toLowerCase() === email.toLowerCase())) {
      setTeamError("That address is already on the list.");
      return;
    }
    setTeamError(null);
    setTeamMembers((list) => [...list, { email, role: teamRole, params: ["", "", ""] }]);
    setTeamEmail("");
  }

  async function continueFromAccount() {
    if (!account) return;
    const payload = {
      accountType: account.accountType,
      workEmail: account.workEmail,
      firstName: account.firstName,
      lastName: account.lastName,
      dialCode: account.dialCode,
      phone: account.phone,
      designation: account.designation,
      organizationName: account.organizationName,
    };
    const found = validateAccountFields(payload);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    setNotice(null);
    if (account.accountType === "organization") {
      // Saved with its organisation, on "Create account" (Org details).
      go(nextAfterAccount("organization"));
      return;
    }
    setBusy(true);
    try {
      await saveProfile({
        ...payload,
        dialCode: blank(account.dialCode),
        phone: blank(account.phone),
        designation: blank(account.designation),
        organizationName: blank(account.organizationName),
      });
      setSaved(true);
      go(pendingPayment && quote ? "payment" : nextAfterAccount("individual"));
      setPendingPayment(false);
    } catch (err) {
      setErrors(err instanceof AccountApiError && Object.keys(err.fields).length ? err.fields : { workEmail: "We couldn't save your details. Try again." });
    } finally {
      setBusy(false);
    }
  }

  async function createOrganization() {
    if (!account || !org) return;
    const orgPayload = {
      kind: orgKind,
      name: org.name,
      businessType: blank(org.businessType),
      employees: blank(org.employees),
      associates: org.associates.trim() === "" ? null : Number(org.associates),
      city: blank(org.city),
      country: blank(org.country),
      contactName: org.contactName,
      designation: blank(org.designation),
      dialCode: blank(org.dialCode),
      phone: blank(org.phone),
      email: org.email,
    };
    const found = validateOrgDetails(orgPayload);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    setBusy(true);
    try {
      await saveProfile({
        accountType: "organization",
        workEmail: account.workEmail,
        firstName: account.firstName,
        lastName: account.lastName,
        dialCode: blank(account.dialCode),
        phone: blank(account.phone),
        designation: blank(account.designation),
        organizationName: blank(account.organizationName),
        org: { ...orgPayload, contactName: orgPayload.contactName.trim(), email: orgPayload.email.trim(), name: orgPayload.name.trim() },
      });
      setSaved(true);
      // A credit pack chosen before the account existed goes straight to payment;
      // otherwise an organisation chooses its annual plan (`acs-orgplan`).
      const packChosen = pendingPayment && quote !== null && quote.group !== "enterprise";
      setPendingPayment(false);
      // V6 puts `#acs-super` between Org details and the plan. It is added only
      // on the incubator seat flow (§1.3 — the VC edition was not rescoped, and
      // `e2e/account-purchase.spec.ts` walks the VC organisation branch straight
      // from "Create account" to "Choose your plan").
      go(packChosen ? "payment" : seatFlow ? "super" : "orgplan");
    } catch (err) {
      setErrors(err instanceof AccountApiError && Object.keys(err.fields).length ? err.fields : { name: "We couldn't save your organisation. Try again." });
    } finally {
      setBusy(false);
    }
  }

  function continueToPayment() {
    if (!quote) return;
    if (!saved) {
      // "Buy credits" opens on the seat step; the order needs to know who is
      // buying, so the Account screen comes next and then returns here.
      setPendingPayment(true);
      setNotice("Add your account details, then continue to payment.");
      go("account");
      return;
    }
    go("payment");
  }

  /** `acTrialBack()` — the trial screens go back to whichever plan screen sent them. */
  const planScreen: AccountScreen = accountType === "organization" ? "orgplan" : "plan";
  /**
   * Where Payment's "Back to plan selection" goes.
   *
   * V6's `acPayBack()` is `acGo('billing')` unconditionally, because every V6
   * path reaches Payment through Billing details. Here it is conditional: the
   * legacy and VC flows never visit that screen, so they keep returning to
   * their own plan screen and `e2e/account-purchase.spec.ts` stays green.
   */
  const paymentBack = (): AccountScreen => {
    if (billingBack) return "billing";
    if (seatFlow) return paidPack > 0 ? "paidtrial" : planScreen;
    return quote ? planScreenFor(accountType, quote.group) : planScreen;
  };

  /** The amber "Take a 3-deck free trial" button on both plan screens. */
  function takeTrial() {
    setPaidPack(0);
    setTrialUsed(0);
    go("trial");
  }

  async function pay() {
    if (!quote) return;
    setBusy(true);
    setOrderError(null);
    try {
      const res = await placeOrder({
        planCode: quote.plan.code,
        currency: quote.currency,
        paymentMethod: method,
        // Sent so the server can PRICE them; it never trusts a price from here.
        quantity: quote.quantity,
        extraCredits: quote.extraCredits,
      });
      setOrder(res.order);
      go("success");
    } catch (err) {
      setOrderError(orderErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!user) return null;

  const steps = stepperFor(accountType, screen, seatFlow);

  let body: ReactNode;
  if (loadError) {
    body = (
      <Card>
        <h1 className="text-[23px] font-bold leading-[1.2] text-fg">My account</h1>
        <p role="alert" className="mt-3 text-[13.5px] text-fg-2">
          {loadError}
        </p>
        <div className="mt-[26px] flex justify-end">
          <button type="button" className={BTN_GHOST} onClick={() => setReload((n) => n + 1)}>
            Try again
          </button>
        </div>
      </Card>
    );
  } else if (!state || !book || !account || !org) {
    body = (
      <Card>
        <h1 className="text-[23px] font-bold leading-[1.2] text-fg">My account</h1>
        <p className="mt-3 text-[13.5px] text-fg-muted" aria-live="polite">
          Loading your account…
        </p>
      </Card>
    );
  } else if (screen === "account") {
    body = (
      <AccountStep
        draft={account}
        trialDecks={seatFlow ? 0 : book.trial.decks}
        onChange={(patch) => setAccount((a) => (a ? { ...a, ...patch } : a))}
        errors={errors}
        onContinue={continueFromAccount}
        busy={busy}
        notice={notice}
      />
    );
  } else if (screen === "orgtype") {
    body = (
      <OrgTypeScreen kind={orgKind} onKind={setOrgKind} onBack={() => go("account")} onContinue={() => go("orgdetails")} />
    );
  } else if (screen === "orgdetails") {
    body = (
      <OrgDetailsScreen
        draft={org}
        onChange={(patch) => setOrg((o) => (o ? { ...o, ...patch } : o))}
        errors={errors}
        onBack={() => go("orgtype")}
        onCreate={createOrganization}
        busy={busy}
      />
    );
  } else if (screen === "super") {
    body = (
      <SuperUserScreen
        draft={superUser}
        onChange={(patch) => setSuperUser((s) => ({ ...s, ...patch }))}
        errors={errors}
        onBack={() => go("orgdetails")}
        onContinue={continueFromSuperUser}
      />
    );
  } else if (screen === "annual" && annualQuote) {
    body = (
      <AnnualSubscriptionScreen
        book={book}
        currency={currency}
        cart={annualCart}
        quote={annualQuote}
        onSeats={(t, next) =>
          setAnnualCart((c) => ({ ...c, seats: { ...c.seats, [t]: Math.max(0, next) } }))
        }
        onExtra={(credits) => setAnnualCart((c) => ({ ...c, extraCredits: credits }))}
        canUpgradeToEnterprise={accountType !== "organization"}
        onUpgradeToEnterprise={upgradeToEnterprise}
        onEnterprisePlans={startEnterprisePlans}
        onBack={() => go("trial")}
        onContinue={() => goBilling("annual")}
      />
    );
  } else if (screen === "entplans") {
    body = (
      <EnterprisePlansScreen
        book={book}
        currency={currency}
        plans={orgPlans}
        planCode={entSelected}
        onPlan={setEntPlanCode}
        isOrganization={accountType === "organization"}
        onUpgradeToEnterprise={upgradeToEnterprise}
        onBack={() => go("annual")}
        onContinue={() => goBilling("entplans")}
      />
    );
  } else if (screen === "billing") {
    body = (
      <BillingDetailsScreen
        draft={billing}
        onChange={(patch) => setBilling((b) => ({ ...b, ...patch }))}
        errors={errors}
        locale={billingLocale}
        onBack={() => go(billingBack ?? planScreen)}
        onContinue={continueFromBilling}
        busy={busy}
      />
    );
  } else if (screen === "team") {
    body = (
      <TeamScreen
        tierId={teamTier}
        onTier={setTeamTier}
        members={teamMembers}
        onAdd={addTeamMember}
        onRemove={(i) => setTeamMembers((list) => list.filter((_, n) => n !== i))}
        onParam={(i, slot, value) =>
          setTeamMembers((list) =>
            list.map((m, n) => {
              if (n !== i) return m;
              const params: TeamInvite["params"] = [...m.params];
              params[slot] = value;
              return { ...m, params };
            }),
          )
        }
        draftEmail={teamEmail}
        draftRole={teamRole}
        onDraftEmail={setTeamEmail}
        onDraftRole={setTeamRole}
        error={teamError ?? undefined}
        onSkip={close}
        onConfirm={close}
      />
    );
  } else if (screen === "orgplan") {
    body = seatFlow ? (
      <EnterpriseSeatScreen
        book={book}
        plans={orgPlans}
        planCode={orgSelected}
        onPlan={setOrgPlanCode}
        extraCredits={extraCredits}
        onExtra={setExtraCredits}
        currencies={offeredCurrencies}
        currency={currency}
        onCurrency={setCurrency}
        onBack={() => go("orgdetails")}
        onTrial={takeTrial}
        onContinue={continueToPayment}
      />
    ) : (
      <LegacyOrgPlanScreen
        book={book}
        group={legacyOrgGroup}
        plans={plansByGroup.enterprise ?? []}
        planCode={legacySelectedCode}
        onPlan={setPlanCode}
        currencies={offeredCurrencies}
        currency={currency}
        onCurrency={setCurrency}
        onBack={() => go("orgdetails")}
        onContinue={continueToPayment}
      />
    );
  } else if (screen === "plan") {
    body = seatFlow ? (
      <SeatScreen
        book={book}
        choice={{ tier, months, extraCredits }}
        onTier={(t) => {
          // `acPickTier` clears the period, which is what disables both footer
          // buttons again — a Pro quarter must not silently become a Premium one.
          setTier(t);
          setMonths(null);
        }}
        onPeriod={setMonths}
        onExtra={setExtraCredits}
        currencies={offeredCurrencies}
        currency={currency}
        onCurrency={setCurrency}
        onBack={() => go("account")}
        onTrial={takeTrial}
        onContinue={continueToPayment}
      />
    ) : (
      <LegacyPlanScreen
        book={book}
        accountType={accountType}
        groups={individualGroups}
        activeGroup={activeIndividual}
        onGroup={(g) => {
          setIndividualGroup(g.group);
          setPlanCode(defaultPlanFor(g.group));
        }}
        plansByGroup={plansByGroup}
        planCode={legacySelectedCode}
        onPlan={setPlanCode}
        currencies={offeredCurrencies}
        currency={currency}
        onCurrency={setCurrency}
        onBack={() => go("account")}
        onContinue={continueToPayment}
      />
    );
  } else if (screen === "trial") {
    body = (
      <TrialScreen
        planName={chosenPlanName}
        used={trialUsed}
        onUse={() => setTrialUsed((n) => Math.min(n + 1, FREE_TRIAL_DECKS))}
        onBack={() => go(planScreen)}
        onPayChosen={() => {
          setPaidPack(0);
          go("payment");
        }}
        onPaidTrial={() => {
          setPaidPack(0);
          go("paidtrial");
        }}
        /* V6's third option, and the only route into `#acs-annual`. Offered on
           the incubator seat flow only — the legacy plan screens sell packs and
           monthly plans, not annual seats, so there is no cart to build there. */
        onAnnual={seatFlow ? startAnnual : undefined}
      />
    );
  } else if (screen === "paidtrial") {
    body = (
      <PaidTrialScreen
        book={book}
        currency={currency}
        packs={PAID_TRIAL_PACKS}
        rateMinor={paidTrialPlan(book)?.amounts[currency] ?? 0}
        selected={paidPack}
        onSelect={setPaidPack}
        onBack={() => go("trial")}
        onContinue={continueToPayment}
      />
    );
  } else if (screen === "payment" && quote) {
    body = (
      <PaymentScreen
        book={book}
        quote={quote}
        accountType={accountType}
        method={method}
        onMethod={setMethod}
        paymentConfigured={state.paymentConfigured}
        onPay={pay}
        onBack={() => go(paymentBack())}
        busy={busy}
        error={orderError}
        billing={billingBack ? billing : null}
      />
    );
  } else if (screen === "success" && order) {
    body = (
      <ReceiptScreen
        book={book}
        brand={[branding.wordmarkPrefix, branding.wordmark].filter(Boolean).join(".")}
        order={order}
        documentUrl={orderDocumentUrl(order.id)}
        onDashboard={close}
        /* `#acs-team` is "enterprise only" in V6 and nothing in its drawn flow
           reaches it; the receipt's own step 2 is "Invite team members", so this
           is where an organisation gets it. */
        onTeam={order.accountType === "organization" ? () => go("team") : undefined}
      />
    );
  } else {
    // A payment screen with no valid selection (the plan went off sale, or the
    // currency changed underneath it): back to choosing.
    body = (
      <Card>
        <h1 className="text-[23px] font-bold leading-[1.2] text-fg">Choose your plan</h1>
        <p className="mt-3 text-[13.5px] text-fg-2">That selection is no longer available.</p>
        <div className="mt-[26px] flex justify-end">
          <button type="button" className={BTN_GHOST} onClick={() => go(planScreen)}>
            Back to plan selection
          </button>
        </div>
      </Card>
    );
  }

  const ready = state && book && account && !loadError;

  return createPortal(
    <div
      ref={containerRef}
      id="acct-overlay"
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="My account"
      data-screen={screen}
      style={OVERLAY_VARS}
      className="fixed inset-0 z-50 overflow-y-auto bg-stone text-fg outline-none"
    >
      <button
        type="button"
        onClick={close}
        aria-label="Back to dashboard"
        className="fixed right-5 top-4 z-10 flex h-[34px] w-[34px] items-center justify-center rounded-[9px] border border-stone-dk bg-surface text-fg-2 hover:border-fg-muted hover:text-fg"
      >
        <X className="h-[18px] w-[18px]" aria-hidden="true" />
      </button>
      <div className="mx-auto max-w-[780px] px-[22px] pb-16 pt-9">
        <div className="mb-1 text-center text-[18px] tracking-[.02em]" aria-label={`${branding.wordmarkPrefix}.${branding.wordmark}`}>
          <span className="font-bold text-fg">{branding.wordmarkPrefix}</span>
          <span className="mx-px font-black text-gold">.</span>
          <span className="font-bold tracking-[.05em] text-gold">{branding.wordmark}</span>
        </div>
        {ready && <Stepper steps={steps} />}
        {!ready && <div className="h-7" />}
        {body}
        {ready && screen === "account" && (
          <div className="mt-4 text-center text-[12px]">
            <Link to="/app/account?view=profile" className="text-fg-muted underline hover:text-fg">
              Profile, title &amp; notification settings
            </Link>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
