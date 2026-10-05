import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import {
  AnnualSubscriptionScreen,
  BillingDetailsScreen,
  EnterprisePlansScreen,
  SuperUserScreen,
  TeamScreen,
} from "../../src/client/routes/account/AccountScreens";
import {
  ANNUAL_SEAT_MONTHS,
  EMPTY_BILLING_ADDRESS,
  SEAT_STORAGE_GB,
  annualCartQuote,
  initialAnnualCart,
  taxSettingsOf,
  type AnnualCart,
  type TeamInvite,
} from "../../src/shared/accountOrder";
import {
  resolveBillingLocale,
  validateBillingAddress,
  type BillingAddress,
} from "../../src/shared/plans";
import { enterpriseSeatPlans, seatPlanFor, formatMinor } from "../../src/shared/priceBook";
import { catalogueFixture } from "../unit/fixtures/accountCatalogue";

/**
 * **My Account V6's five new screens**, rendered on their own.
 *
 * They are presentational, so they are tested presentationally — the overlay's
 * walk through them lives in `accountOverlay.test.tsx`. Three things this file
 * holds, and each is a hard constraint of the wave rather than a nicety:
 *
 *   1. **Mobile-first.** A sweep of the product found ten screens that were
 *      built desktop-first and retrofitted. `assertNoFixedWidthAbovePhone`
 *      fails if any of these five declares a width that cannot fit a 390 px
 *      viewport with its 16 px gutters — the mechanical part of that promise,
 *      which jsdom can actually check.
 *   2. **No money is written here.** Every figure asserted is read back out of
 *      the catalogue fixture, so a price edited there moves the assertion.
 *   3. **No discount.** V6 carries none, and §8 Q1 forbids publishing a saving
 *      derived from a base rate.
 */

const book = catalogueFixture();

/** 390 px phone, less the overlay's two 16 px side gutters. */
const PHONE_CONTENT_PX = 358;

/**
 * Fails on any UNCONDITIONAL class that forces an element wider than a phone's
 * content box: `w-[Npx]`, `min-w-[Npx]`, `basis-[Npx]` or a grid track
 * `minmax(Npx, …)`. A class behind a `min-[Npx]:` / `sm:` variant is exempt —
 * that is what mobile-first means. `max-w-` is exempt because it caps a width
 * rather than demanding one.
 */
function assertNoFixedWidthAbovePhone(container: HTMLElement, label: string) {
  const offenders: string[] = [];
  for (const el of [container, ...Array.from(container.querySelectorAll<HTMLElement>("*"))]) {
    for (const token of (el.className || "").toString().split(/\s+/).filter(Boolean)) {
      // Anything with a `variant:` prefix is conditional — skip it.
      if (/^[^[]*:/.test(token.replace(/\[[^\]]*\]/g, ""))) continue;
      for (const m of token.matchAll(/(?:^|[^a-z-])(?:min-)?(?:w|basis)-\[(\d+(?:\.\d+)?)px\]/g)) {
        if (Number(m[1]) > PHONE_CONTENT_PX) offenders.push(`${label}: ${token}`);
      }
      for (const m of token.matchAll(/minmax\((\d+(?:\.\d+)?)px/g)) {
        if (Number(m[1]) > PHONE_CONTENT_PX) offenders.push(`${label}: ${token}`);
      }
    }
  }
  expect(offenders, `${label} declares a width a 390 px phone cannot hold`).toEqual([]);
}

const noop = () => {};

/**
 * The screen takes the locale it is HANDED. The caller resolves it with the one
 * resolver (`resolveBillingLocale`) against the published catalogue's tax
 * settings, which is exactly what `AccountOverlay` does — so these tests cannot
 * pass against a screen that computed the rule for itself.
 */
function billingProps(draft: BillingAddress) {
  return {
    draft,
    onChange: noop,
    errors: {},
    locale: resolveBillingLocale(draft.country, taxSettingsOf(book.tax)),
    onBack: noop,
    onContinue: noop,
  };
}

function annualProps(cart: AnnualCart, over: Partial<Parameters<typeof AnnualSubscriptionScreen>[0]> = {}) {
  return {
    book,
    currency: "INR",
    cart,
    quote: annualCartQuote(book, cart, "INR"),
    onSeats: noop,
    onExtra: noop,
    canUpgradeToEnterprise: false,
    onUpgradeToEnterprise: noop,
    onEnterprisePlans: noop,
    onBack: noop,
    onContinue: noop,
    ...over,
  };
}

function teamProps(over: Partial<Parameters<typeof TeamScreen>[0]> = {}) {
  return {
    tierId: "basic" as const,
    onTier: noop,
    members: [] as TeamInvite[],
    onAdd: noop,
    onRemove: noop,
    onParam: noop,
    draftEmail: "",
    draftRole: "Program Manager",
    onDraftEmail: noop,
    onDraftRole: noop,
    onSkip: noop,
    onConfirm: noop,
    ...over,
  };
}

// ── 1. Mobile-first, measured ────────────────────────────────────────────────

describe("V6 · the five new screens are mobile-first", () => {
  it("declares no width a 390 px phone cannot hold", () => {
    const entPlans = enterpriseSeatPlans(book);
    const cases: [string, React.ReactElement][] = [
      ["billing", <BillingDetailsScreen {...billingProps(EMPTY_BILLING_ADDRESS)} />],
      [
        "super",
        <SuperUserScreen draft={{ name: "", email: "" }} onChange={noop} errors={{}} onBack={noop} onContinue={noop} />,
      ],
      ["annual", <AnnualSubscriptionScreen {...annualProps(initialAnnualCart())} />],
      [
        "entplans",
        <EnterprisePlansScreen
          book={book}
          currency="INR"
          plans={entPlans}
          planCode={entPlans[0]?.code ?? null}
          onPlan={noop}
          isOrganization
          onUpgradeToEnterprise={noop}
          onBack={noop}
          onContinue={noop}
        />,
      ],
      [
        "team",
        <TeamScreen
          {...teamProps({ members: [{ email: "meera.sharma@vcfirm.com", role: "Program Manager", params: ["", "", ""] }] })}
        />,
      ],
    ];
    for (const [label, element] of cases) {
      const { container, unmount } = render(element);
      assertNoFixedWidthAbovePhone(container, label);
      unmount();
    }
  });
});

// ── 2. `#acs-billing` ────────────────────────────────────────────────────────

describe("V6 · `#acs-billing` — Billing details", () => {
  it("keeps telling the customer that the address decides the currency and the tax", () => {
    render(<BillingDetailsScreen {...billingProps(EMPTY_BILLING_ADDRESS)} />);
    const card = screen.getByRole("heading", { level: 1, name: "Billing details" }).parentElement!;
    // V6's own sentence, which is the only place this is explained.
    expect(card).toHaveTextContent(/Indian billing addresses are charged in\s*INR with GST/);
    expect(card).toHaveTextContent(/every other country is billed in\s*USD with no GST/);
    // And what V6 promises about the document itself.
    expect(card).toHaveTextContent(/invoice is emailed to you/i);
    expect(card).toHaveTextContent(/Razorpay/);
  });

  it("holds Continue shut until all four fields are filled", () => {
    const { rerender } = render(<BillingDetailsScreen {...billingProps(EMPTY_BILLING_ADDRESS)} />);
    expect(screen.getByTestId("ac-billing-continue")).toBeDisabled();
    rerender(
      <BillingDetailsScreen
        {...billingProps({ name: "Acme Pvt Ltd", city: "Hyderabad", country: "India", address: "12 MG Road" })}
      />,
    );
    expect(screen.getByTestId("ac-billing-continue")).toBeEnabled();
    // The screen and the validator agree — one rule, not two.
    expect(validateBillingAddress({ name: "Acme Pvt Ltd", city: "Hyderabad", country: "India", address: "12 MG Road" })).toEqual({});
  });

  it("offers V6's countries as suggestions on a field that still takes anything", () => {
    render(<BillingDetailsScreen {...billingProps(EMPTY_BILLING_ADDRESS)} />);
    const country = screen.getByLabelText("Country") as HTMLInputElement;
    expect(country.tagName).toBe("INPUT");
    expect(country.getAttribute("list")).toBe("ac-bill-countries");
    const options = Array.from(document.querySelectorAll("#ac-bill-countries option")).map((o) =>
      o.getAttribute("value"),
    );
    expect(options).toContain("India");
    expect(options).toContain("Other");
  });

  it("names a currency only once the country resolves one, and names the shared rate", () => {
    // Nothing typed: V6 keeps `#bill-currency-note` hidden, so the screen must
    // not guess. India: INR + the CONFIGURED rate. Elsewhere: USD, no GST.
    const { rerender } = render(<BillingDetailsScreen {...billingProps(EMPTY_BILLING_ADDRESS)} />);
    expect(screen.queryByTestId("ac-billing-currency")).toBeNull();

    rerender(<BillingDetailsScreen {...billingProps({ name: "A", city: "Hyderabad", country: "India", address: "x" })} />);
    const note = screen.getByTestId("ac-billing-currency");
    expect(note).toHaveTextContent(`Billed in INR with ${book.tax.gstRatePct}% GST`);
    expect(note).toHaveTextContent(/input tax credit/);

    rerender(<BillingDetailsScreen {...billingProps({ name: "A", city: "London", country: "United Kingdom", address: "x" })} />);
    expect(screen.getByTestId("ac-billing-currency")).toHaveTextContent("Billed in USD, no GST applied");
    expect(screen.getByTestId("ac-billing-currency")).not.toHaveTextContent(/input tax credit/);
  });

  it("takes the rate from the catalogue, not from a number of its own", () => {
    // The configured rate beats any literal: move it in the book and the note
    // moves. A screen with `18` written in it fails here.
    const at12 = { ...book, tax: { ...book.tax, gstRatePct: 12 } };
    render(
      <BillingDetailsScreen
        {...billingProps({ name: "A", city: "Hyderabad", country: "India", address: "x" })}
        locale={resolveBillingLocale("India", taxSettingsOf(at12.tax))}
      />,
    );
    expect(screen.getByTestId("ac-billing-currency")).toHaveTextContent("Billed in INR with 12% GST");
  });
});

// ── 3. `#acs-super` ──────────────────────────────────────────────────────────

describe("V6 · `#acs-super` — Nominate your super user", () => {
  it("names the authority the role carries, and labels both fields", () => {
    const onChange = vi.fn();
    const { container } = render(
      <SuperUserScreen draft={{ name: "Priya Sharma", email: "" }} onChange={onChange} errors={{}} onBack={noop} onContinue={noop} />,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Nominate your super user");
    expect(container.textContent).toMatch(/top account authority who manages the team, roles and billing/);
    expect(container.textContent).toMatch(/They'll log in with this email and set their own password/);
    expect(screen.getByLabelText("Super user — full name")).toHaveValue("Priya Sharma");
    fireEvent.change(screen.getByLabelText("Super user — work email"), { target: { value: "priya@company.com" } });
    expect(onChange).toHaveBeenCalledWith({ email: "priya@company.com" });
  });

  it("shows the field error it is given, against the field", () => {
    render(
      <SuperUserScreen
        draft={{ name: "Priya", email: "priya@gmail.com" }}
        onChange={noop}
        errors={{ email: "Personal email addresses are not accepted." }}
        onBack={noop}
        onContinue={noop}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Personal email addresses are not accepted.");
  });
});

// ── 4. `#acs-annual` ─────────────────────────────────────────────────────────

describe("V6 · `#acs-annual` — Annual subscription", () => {
  const premium = seatPlanFor(book, "premium", ANNUAL_SEAT_MONTHS)!;
  const inr = (m: number) => formatMinor(m, "₹");

  it("starts with one Premium seat, priced from the catalogue, 10 GB of storage", () => {
    render(<AnnualSubscriptionScreen {...annualProps(initialAnnualCart())} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Annual subscription");
    expect(screen.getByTestId("ac-ann-baseprice")).toHaveTextContent(inr(premium.amounts.INR));
    expect(screen.getByTestId("ac-ann-total")).toHaveTextContent(inr(premium.amounts.INR));
    // Every seat row states the same storage, on all three tiers.
    const rows = screen.getByTestId("ac-ann-seats");
    for (const tier of ["Standard", "Pro", "Premium"]) {
      expect(rows).toHaveTextContent(new RegExp(`${tier} seat \\(${SEAT_STORAGE_GB} GB storage\\)`));
    }
    expect(screen.getByTestId("ac-ann-seat-premium")).toHaveTextContent("1");
  });

  it("names no discount anywhere", () => {
    const { container } = render(<AnnualSubscriptionScreen {...annualProps({ seats: { standard: 0, pro: 0, premium: 2 }, extraCredits: 125 })} />);
    expect(container.textContent).not.toMatch(/you save|save \d|% off|discount/i);
    // §8 Q1 — and no per-deck rate either.
    expect(container.textContent).not.toMatch(/per[- ]deck|\/\s*deck/i);
  });

  it("moves the subtotal with the steppers, and never adds the money itself", () => {
    const onSeats = vi.fn();
    const two: AnnualCart = { seats: { standard: 0, pro: 0, premium: 2 }, extraCredits: 0 };
    const { rerender } = render(<AnnualSubscriptionScreen {...annualProps(initialAnnualCart(), { onSeats })} />);
    fireEvent.click(screen.getByTestId("ac-ann-seat-premium-plus"));
    expect(onSeats).toHaveBeenCalledWith("premium", 2);
    rerender(<AnnualSubscriptionScreen {...annualProps(two)} />);
    expect(screen.getByTestId("ac-ann-total")).toHaveTextContent(inr(premium.amounts.INR * 2));
    expect(screen.getByTestId("ac-ann-total")).toHaveTextContent("2 seats");
    // The GST line quotes the catalogue's rate, not one of its own.
    expect(screen.getByTestId("ac-ann-gst")).toHaveTextContent(`GST (${book.tax.gstRatePct}%)`);
  });

  it("cannot be decremented below zero", () => {
    const onSeats = vi.fn();
    render(<AnnualSubscriptionScreen {...annualProps(initialAnnualCart(), { onSeats })} />);
    expect(screen.getByTestId("ac-ann-seat-standard-minus")).toBeDisabled();
    expect(screen.getByTestId("ac-ann-seat-premium-minus")).toBeEnabled();
  });

  it("shuts Continue on a two-tier cart and says why, rather than ordering one of them", () => {
    const mixed: AnnualCart = { seats: { standard: 2, pro: 0, premium: 1 }, extraCredits: 0 };
    render(<AnnualSubscriptionScreen {...annualProps(mixed)} />);
    expect(screen.getByTestId("ac-ann-continue")).toBeDisabled();
    expect(screen.getByRole("heading", { level: 1 }).parentElement).toHaveTextContent(/an order carries one plan/i);
  });

  it("offers the Enterprise upgrade only while the account is not an organisation", () => {
    const { rerender } = render(<AnnualSubscriptionScreen {...annualProps(initialAnnualCart(), { canUpgradeToEnterprise: true })} />);
    expect(screen.getByTestId("ac-ann-upgrade")).toHaveTextContent(/Upgrade to an Enterprise account/);
    rerender(<AnnualSubscriptionScreen {...annualProps(initialAnnualCart(), { canUpgradeToEnterprise: false })} />);
    expect(screen.queryByTestId("ac-ann-upgrade")).toBeNull();
  });

  it("says so, instead of totalling zero, when no annual seat is sold in the currency", () => {
    const noInr = {
      ...book,
      plans: book.plans.map((p) => (p.tier === "premium" && p.periodMonths === 12 ? { ...p, amounts: {} } : p)),
    };
    render(
      <AnnualSubscriptionScreen
        {...annualProps(initialAnnualCart())}
        book={noInr}
        quote={annualCartQuote(noInr, initialAnnualCart(), "INR")}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 }).parentElement).toHaveTextContent(/not sold in INR/);
    expect(screen.queryByTestId("ac-ann-continue")).toBeNull();
  });
});

// ── 5. `#acs-entplans` ───────────────────────────────────────────────────────

describe("V6 · `#acs-entplans` — Enterprise Plans", () => {
  const plans = enterpriseSeatPlans(book);

  it("draws the catalogue's bundles with their seats and credits, and no saving", () => {
    const { container } = render(
      <EnterprisePlansScreen
        book={book}
        currency="INR"
        plans={plans}
        planCode={null}
        onPlan={noop}
        isOrganization
        onUpgradeToEnterprise={noop}
        onBack={noop}
        onContinue={noop}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Enterprise Plans");
    expect(container.textContent).toContain("Fixed annual bundles for larger teams");
    const cards = within(screen.getByTestId("ac-entplans")).getAllByRole("radio");
    expect(cards.map((c) => c.getAttribute("data-testid"))).toEqual(plans.map((p) => `ac-entplan-${p.code}`));
    const first = screen.getByTestId(`ac-entplan-${plans[0].code}`);
    expect(first).toHaveTextContent(formatMinor(plans[0].amounts.INR, "₹"));
    expect(first).toHaveTextContent(`${plans[0].seats} Premium seats (${SEAT_STORAGE_GB} GB storage each)`);
    expect(first).toHaveTextContent(`${plans[0].units!.toLocaleString("en-IN")} Credits`);
    // V6's own cards carry a "You save $X" pill; §8 Q1 forbids it.
    expect(container.textContent).not.toMatch(/you save|save \d|% off/i);
  });

  it("holds Continue shut until a bundle is chosen", () => {
    const { rerender } = render(
      <EnterprisePlansScreen
        book={book}
        currency="INR"
        plans={plans}
        planCode={null}
        onPlan={noop}
        isOrganization
        onUpgradeToEnterprise={noop}
        onBack={noop}
        onContinue={noop}
      />,
    );
    expect(screen.getByTestId("ac-entplan-continue")).toBeDisabled();
    rerender(
      <EnterprisePlansScreen
        book={book}
        currency="INR"
        plans={plans}
        planCode={plans[1].code}
        onPlan={noop}
        isOrganization
        onUpgradeToEnterprise={noop}
        onBack={noop}
        onContinue={noop}
      />,
    );
    expect(screen.getByTestId("ac-entplan-continue")).toBeEnabled();
    expect(screen.getByTestId(`ac-entplan-${plans[1].code}`)).toHaveAttribute("aria-checked", "true");
  });

  it("routes an individual to the upgrade instead of a Continue the server would refuse", () => {
    // `quoteOrder` returns `organization_required` for an enterprise plan on an
    // individual account, so a Continue here would be a dead end.
    const onUpgrade = vi.fn();
    render(
      <EnterprisePlansScreen
        book={book}
        currency="INR"
        plans={plans}
        planCode={plans[0].code}
        onPlan={noop}
        isOrganization={false}
        onUpgradeToEnterprise={onUpgrade}
        onBack={noop}
        onContinue={noop}
      />,
    );
    expect(screen.queryByTestId("ac-entplan-continue")).toBeNull();
    fireEvent.click(screen.getByTestId("ac-entplan-upgrade"));
    expect(onUpgrade).toHaveBeenCalled();
  });
});

// ── 6. `#acs-team` ───────────────────────────────────────────────────────────

describe("V6 · `#acs-team` — Add your team", () => {
  const two: TeamInvite[] = [
    { email: "meera.sharma@vcfirm.com", role: "Program Manager", params: ["Founder resilience", "", ""] },
    { email: "rajesh.kumar@vcfirm.com", role: "Program Associate", params: ["", "", ""] },
  ];

  it("shows the previewed tier's ceiling and both of V6's footer actions", () => {
    render(<TeamScreen {...teamProps({ members: two })} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Add your team");
    expect(screen.getByTestId("ac-team-seats")).toHaveTextContent("2 / 3 seats used");
    expect(screen.getByTestId("ac-team-planbar")).toHaveTextContent("Basic plan");
    expect(screen.getByTestId("ac-team-skip")).toHaveTextContent("Skip for now");
    expect(screen.getByTestId("ac-team-confirm")).toHaveTextContent("Confirm & go to dashboard");
  });

  it("offers the three tiers in the mockup's words and switches the ceiling", () => {
    const onTier = vi.fn();
    const { rerender } = render(<TeamScreen {...teamProps({ members: two, onTier })} />);
    expect(screen.getByTestId("ac-team-pill-basic")).toHaveTextContent("Basic (3 seats)");
    expect(screen.getByTestId("ac-team-pill-configurable")).toHaveTextContent("Configurable (5 seats)");
    expect(screen.getByTestId("ac-team-pill-customisable")).toHaveTextContent("Customisable (unlimited)");
    fireEvent.click(screen.getByTestId("ac-team-pill-customisable"));
    expect(onTier).toHaveBeenCalledWith("customisable");
    rerender(<TeamScreen {...teamProps({ members: two, tierId: "customisable" })} />);
    expect(screen.getByTestId("ac-team-seats")).toHaveTextContent("Unlimited seats");
  });

  it("stops adding at the ceiling and says why", () => {
    const full: TeamInvite[] = [...two, { email: "a.b@vcfirm.com", role: "Jury Member", params: ["", "", ""] }];
    const { rerender } = render(<TeamScreen {...teamProps({ members: two })} />);
    expect(screen.getByTestId("ac-team-add")).toBeEnabled();
    expect(screen.queryByTestId("ac-team-seatfull")).toBeNull();
    rerender(<TeamScreen {...teamProps({ members: full })} />);
    expect(screen.getByTestId("ac-team-add")).toBeDisabled();
    expect(screen.getByTestId("ac-team-seatfull")).toHaveTextContent(/All seats on this plan are in use/);
    // The unlimited tier never fills.
    rerender(<TeamScreen {...teamProps({ members: full, tierId: "customisable" })} />);
    expect(screen.getByTestId("ac-team-add")).toBeEnabled();
  });

  it("gives every member their own three parameters, and claims nothing was sent", () => {
    const onParam = vi.fn();
    const { container } = render(<TeamScreen {...teamProps({ members: two, onParam })} />);
    // Each member's three fields are their own, so they are addressed by index.
    const first = within(screen.getByTestId("ac-team-members").children[0] as HTMLElement);
    expect(first.getByLabelText(/Parameter 1/)).toHaveValue("Founder resilience");
    expect(first.getByLabelText(/Parameter 2 — their own evaluation lens/)).toHaveValue("");
    fireEvent.change(first.getByLabelText(/Parameter 2/), { target: { value: "Market timing" } });
    expect(onParam).toHaveBeenCalledWith(0, 1, "Market timing");
    // The SECOND member's slots are a different set of three.
    const second = within(screen.getByTestId("ac-team-members").children[1] as HTMLElement);
    fireEvent.change(second.getByLabelText(/Parameter 1/), { target: { value: "Traction" } });
    expect(onParam).toHaveBeenCalledWith(1, 0, "Traction");
    // Nothing has been emailed: there is no route that creates a pending member.
    expect(container.textContent).not.toMatch(/invitation sent|invites? sent|we've emailed/i);
    expect(container.textContent).toMatch(/Invitations are sent from/);
  });
});
