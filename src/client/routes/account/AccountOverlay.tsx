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
import { PLAN_LABELS, type Plan } from "../../../shared/plans";
import {
  INDIVIDUAL_GROUPS,
  ORGANIZATION_GROUPS,
  PAID_TRIAL_PACKS,
  FREE_TRIAL_DECKS,
  billableCurrencies,
  nextAfterAccount,
  planScreenFor,
  purchasablePlans,
  quoteOrder,
  sellableGroups,
  stepperFor,
  validateAccountFields,
  validateOrgDetails,
  type AccountOrderView,
  type AccountProfile,
  type AccountScreen,
  type FieldErrors,
  type OrgKind,
  type PaymentMethod,
} from "../../../shared/accountOrder";
import {
  AccountApiError,
  getAccount,
  getPublishedCatalogue,
  orderDocumentUrl,
  placeOrder,
  saveProfile,
  type AccountState,
} from "./accountApi";
import {
  AccountScreen as AccountStep,
  BTN_GHOST,
  Card,
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
          setSaved(acct.saved);
          const currencies = billableCurrencies(catalogue);
          setCurrency(currencies.includes(catalogue.baseCurrency) ? catalogue.baseCurrency : currencies[0] ?? catalogue.baseCurrency);
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
   * **Only the incubator superuser prototype was reshared** (2026-09-19). The
   * incubator admin, program manager, program associate and jury files, and
   * every VC file, still draw "Choose your plan" over fixed packs and the
   * pay-as-you-go ladder — so v3's seat flow is gated to exactly one audience
   * and everyone else's screens render as they did yesterday. Widening this is
   * §4 Q85; it needs the other prototypes reshared first.
   */
  const seatFlow = edition === "incubator" && role === "superuser";

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
    if (paidPack > 0) {
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
  }, [book, seatFlow, legacySelectedCode, paidPack, accountType, orgSelected, seatPlan, extraCredits, currency]);

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
    setScreen(next);
  };

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
      go(packChosen ? "payment" : "orgplan");
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
  } else if (screen === "orgplan") {
    body = seatFlow ? (
      <EnterpriseSeatScreen
        book={book}
        plans={orgPlans}
        planCode={orgSelected}
        onPlan={setOrgPlanCode}
        extraCredits={extraCredits}
        onExtra={setExtraCredits}
        currencies={currencies}
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
        currencies={currencies}
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
        currencies={currencies}
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
        currencies={currencies}
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
        onBack={() =>
          go(seatFlow ? (paidPack > 0 ? "paidtrial" : planScreen) : planScreenFor(accountType, quote.group))
        }
        busy={busy}
        error={orderError}
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
