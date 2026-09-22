import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { AccountPage } from "../../src/client/routes/AccountPage";
import { BuyCreditsPage } from "../../src/client/routes/BuyCreditsPage";
import { AuthContext, type AuthUser } from "../../src/client/auth/AuthProvider";
import type { PublishedPriceBook } from "../../src/shared/priceBook";
import { quoteOrder, type AccountOrderView, type AccountProfile, type AccountType } from "../../src/shared/accountOrder";
import { catalogueFixture } from "../unit/fixtures/accountCatalogue";

/**
 * W6-B — My account's full-screen purchase wizard.
 *
 * Four things this suite holds:
 *   1. The overlay's steps, for both branches, with the prototype's stepper.
 *   2. Every price comes from the FETCHED catalogue — change the fixture and the
 *      screen changes; nothing on screen matches a per-deck rate (§8 Q1).
 *   3. GST on INR only, in the order summary.
 *   4. **No card-shaped input exists in any state** (§1.2), and a recorded
 *      order is never described as a payment (§1.3).
 */

vi.mock("../../src/client/routes/admin/Notifications", () => ({
  NotificationPreferences: () => <div>notification preferences</div>,
}));
vi.mock("../../src/client/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/api")>()),
  getConfigSummary: vi.fn(async () => ({ plan: "pro", branding: {} })),
}));

const PER_DECK = /per[- ]deck|\/\s*deck/i;
/** Anything a card, UPI ID or bank credential could be typed into. */
const CARD_SHAPED = /card|cvv|cvc|expir|pan\b|cc-|upi|iban|ifsc|account.?number|routing/i;

function principal(role: AuthUser["role"] = "admin", permissions: string[] = ["upgrade", "adminconsole"]): AuthUser {
  return { id: "inc_admin", name: "Nisha Kapoor", initials: "NK", role, edition: "incubator", permissions };
}

/**
 * The seat flow's audience, after `S3-ACCOUNT` widened it (the client's 21-Sep
 * row for My account reads **Superuser/Admin**): the incubator SUPERUSER and the
 * incubator ADMIN. The **VC edition was not rescoped** and still draws "Choose
 * your plan" — which is what the controls at the end of this file assert, and
 * the only place the legacy screens are still reachable from.
 */
const SUPERUSER: AuthUser = { ...principal("superuser"), id: "inc_super", name: "Priya Sharma", initials: "PS" };
const VC_SUPERUSER: AuthUser = { ...SUPERUSER, id: "vc_super", edition: "vc" };
const VC_ADMIN: AuthUser = { ...principal("admin"), id: "vc_admin", edition: "vc" };

const PROFILE: AccountProfile = {
  accountType: "individual",
  workEmail: "nisha.kapoor@demo.startupjury.ai",
  firstName: "Nisha",
  lastName: "Kapoor",
  dialCode: "+91",
  phone: null,
  designation: null,
  organizationName: null,
  org: null,
};

interface Server {
  book: PublishedPriceBook | null;
  saved: boolean;
  calls: Array<{ method: string; url: string; body: unknown }>;
}

let server: Server;

/**
 * The stand-in for `POST /api/account/orders`. It prices the order the way the
 * real route does — `quoteOrder`, from the same published book — rather than
 * echoing what the screen sent, so an order the server would refuse or price
 * differently cannot pass here.
 */
function orderFrom(
  body: { planCode: string; currency: string; paymentMethod: string; quantity?: number; extraCredits?: number },
  accountType: string,
): AccountOrderView {
  const book = server.book!;
  const quote = quoteOrder(book, body.planCode, body.currency, accountType as AccountType, {
    quantity: body.quantity,
    extraCredits: body.extraCredits,
  });
  if ("error" in quote) throw new Error(`the wizard sent an order the catalogue refuses: ${quote.error}`);
  const plan = quote.plan;
  const sub = quote.subtotalMinor;
  const taxed = body.currency === "INR";
  const tax = taxed ? Math.round((sub * 18) / 100) : 0;
  return {
    id: "pi_0f3c2a9e-test",
    planCode: plan.code,
    planName: plan.name,
    group: plan.group as AccountOrderView["group"],
    period: plan.period,
    periodMonths: plan.periodMonths,
    units: quote.unitsTotal,
    currency: body.currency,
    subtotalMinor: sub,
    taxMinor: tax,
    totalMinor: sub + tax,
    ratePct: 18,
    taxed,
    status: "recorded",
    checkoutUrl: null,
    paymentMethod: body.paymentMethod as AccountOrderView["paymentMethod"],
    accountType: accountType as AccountOrderView["accountType"],
    createdAt: "2026-09-12T10:00:00.000Z",
  };
}

let lastAccountType = "individual";

function json(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

beforeEach(() => {
  server = { book: catalogueFixture(), saved: false, calls: [] };
  lastAccountType = "individual";
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      server.calls.push({ method, url, body });
      if (url === "/api/account" && method === "GET") {
        return json(200, { profile: PROFILE, saved: server.saved, orders: [], paymentConfigured: false });
      }
      if (url === "/api/pricing/published") {
        return server.book ? json(200, server.book) : json(404, { error: "not_published" });
      }
      if (url === "/api/account/profile" && method === "PUT") {
        server.saved = true;
        lastAccountType = body.accountType;
        return json(200, { ok: true, profile: { ...PROFILE, ...body } });
      }
      if (url === "/api/account/orders" && method === "POST") {
        return json(200, {
          ok: true,
          order: orderFrom(body, lastAccountType),
          completed: false,
          creditsGranted: 0,
          checkout: { hosted: false, url: null },
          message: "Order recorded.",
        });
      }
      return json(404, { error: "not_found" });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname + loc.search}</div>;
}

function mount(path: string, user: AuthUser = principal()) {
  return render(
    <AuthContext.Provider value={{ user, loading: false, login: vi.fn(), logout: vi.fn(), updateUser: vi.fn() }}>
      <MemoryRouter initialEntries={[path]}>
        <Where />
        <Routes>
          <Route path="/app/account" element={<AccountPage />} />
          <Route path="/app/billing" element={<BuyCreditsPage />} />
          <Route path="*" element={<div>the dashboard</div>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

const stepLabels = () =>
  within(screen.getByTestId("ac-steps"))
    .getAllByText(/./)
    .filter((el) => !/^\d+$/.test(el.textContent ?? ""))
    .map((el) => el.textContent);

const activeStep = () =>
  screen.getByTestId("ac-steps").querySelector('[aria-current="step"]')?.textContent?.replace(/^\d+/, "");

/** Every control a value could be typed or picked into, as a flat description. */
function describeInputs(): string[] {
  const overlay = document.getElementById("acct-overlay")!;
  return Array.from(overlay.querySelectorAll("input, select, textarea")).map((el) =>
    [
      el.tagName,
      el.getAttribute("type"),
      el.getAttribute("name"),
      el.id,
      el.getAttribute("placeholder"),
      el.getAttribute("autocomplete"),
      el.getAttribute("aria-label"),
      el.closest("div")?.querySelector("label")?.textContent,
    ]
      .filter(Boolean)
      .join(" | "),
  );
}

function assertNoCardField() {
  const inputs = describeInputs();
  for (const d of inputs) expect(d, "a card-shaped field").not.toMatch(CARD_SHAPED);
  expect(document.querySelectorAll('#acct-overlay input[type="password"]')).toHaveLength(0);
}

function assertNoPerDeck() {
  expect(document.getElementById("acct-overlay")!.textContent).not.toMatch(PER_DECK);
}

const byRadio = (name: RegExp | string) => screen.getByRole("radio", { name });

describe("the overlay itself", () => {
  it("is a full-screen dialog outside the app shell, with a close control and Escape", async () => {
    mount("/app/account");
    const dialog = await screen.findByRole("dialog", { name: "My account" });
    expect(dialog.className).toMatch(/fixed/);
    expect(dialog.className).toMatch(/inset-0/);
    expect(dialog.parentElement).toBe(document.body);
    expect(document.body.style.overflow).toBe("hidden");
    await screen.findByRole("heading", { level: 1, name: "Create your account" });
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/app/alldecks"));
  });

  it("shows a loading state, then an honest error when nothing is published", async () => {
    server.book = null;
    mount("/app/account");
    expect(screen.getByText("Loading your account…")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("No price list has been published yet");
  });

  it("keeps the profile page for a role that cannot buy", async () => {
    mount("/app/account", { ...principal("jury"), name: "Rajesh Kumar" });
    expect(await screen.findByRole("heading", { name: "My account" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "My account" })).toBeNull();
  });

  it("keeps the profile page for an admin whose upgrade permission was revoked", async () => {
    mount("/app/account", principal("admin", ["adminconsole"]));
    expect(await screen.findByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("the Individual branch", () => {
  /**
   * V3-PT item 17 — the seat flow. v3 replaced "Choose your plan" (a segmented
   * control over fixed packs and a pay-as-you-go ladder) with "Choose your
   * seat": tier first, then billing period, and NEITHER footer button works
   * until both are chosen. Every literal below is copied from the decoded
   * prototype, not imported from the component, so a rename fails here.
   */
  it("walks Account → Choose your seat → Payment → receipt, reading every price from the catalogue", async () => {
    mount("/app/account", SUPERUSER);
    await screen.findByRole("heading", { level: 1, name: "Create your account" });
    expect(stepLabels()).toEqual(["Account", "Seat & pricing", "Payment"]);
    expect(activeStep()).toBe("Account");
    // v3 deleted the "Evaluate 3 pitchdecks free" strip from this screen.
    expect(screen.queryByText(/Evaluate 3 pitchdecks free/)).toBeNull();
    expect(screen.getByLabelText("Work email")).toHaveValue("nisha.kapoor@demo.startupjury.ai");
    assertNoCardField();

    // Personal mail is refused before anything is sent.
    fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "nisha@gmail.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    expect(await screen.findByText("Personal email addresses are not accepted.")).toBeInTheDocument();
    expect(server.calls.some((c) => c.method === "PUT")).toBe(false);

    fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "nisha.kapoor@demo.startupjury.ai" } });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    await screen.findByRole("heading", { level: 1, name: "Choose your seat" });
    expect(server.calls.find((c) => c.method === "PUT")?.body).toMatchObject({ accountType: "individual" });
    expect(activeStep()).toBe("Seat & pricing");
    expect(
      screen.getByText("Pick a seat type — its pricing appears once selected. Billed per seat, per period."),
    ).toBeInTheDocument();

    // Three seats, no price on any of them, and nothing selected on arrival.
    const tiers = within(screen.getByTestId("ac-tiers")).getAllByRole("radio");
    expect(tiers.map((t) => t.getAttribute("data-testid"))).toEqual([
      "ac-tier-standard",
      "ac-tier-pro",
      "ac-tier-premium",
    ]);
    expect(tiers.every((t) => t.getAttribute("aria-checked") === "false")).toBe(true);
    expect(screen.getByTestId("ac-tier-pro")).toHaveTextContent("Configure the 13 core parameters");
    expect(screen.getByTestId("ac-tier-pro")).toHaveTextContent("Most chosen");
    expect(screen.queryByTestId("ac-periods")).toBeNull();
    // Both footer buttons are shut until a period is chosen (`acPickTier`).
    expect(screen.getByTestId("ac-take-trial")).toBeDisabled();
    expect(screen.getByRole("button", { name: /Continue to pay/ })).toBeDisabled();

    fireEvent.click(screen.getByTestId("ac-tier-pro"));
    const periods = within(screen.getByTestId("ac-periods")).getAllByRole("radio");
    expect(periods.map((p) => p.textContent)).toEqual([
      expect.stringContaining("Quarter"),
      expect.stringContaining("Half-year"),
      expect.stringContaining("Year"),
    ]);
    expect(screen.getByTestId("ac-period-3")).toHaveTextContent("₹6,000");
    expect(screen.getByTestId("ac-period-3")).toHaveTextContent("125 decks included");
    expect(screen.getByTestId("ac-period-12")).toHaveTextContent("Best value");
    // Still shut: a tier alone is not a purchase.
    expect(screen.getByRole("button", { name: /Continue to pay/ })).toBeDisabled();

    fireEvent.click(screen.getByTestId("ac-period-12"));
    expect(screen.getByRole("button", { name: /Continue to pay/ })).toBeEnabled();
    expect(screen.getByTestId("ac-take-trial")).toBeEnabled();

    // Extra credits are priced from the ANNUAL seat: ₹15,360 / 500 decks = ₹30.72.
    expect(screen.getByTestId("ac-extra")).toHaveTextContent("₹30.72/credit");
    fireEvent.click(screen.getByTestId("ac-extra-125"));
    expect(screen.getByTestId("ac-extra-125")).toHaveTextContent("₹3,840");

    fireEvent.click(screen.getByRole("button", { name: /Continue to pay/ }));
    await screen.findByRole("heading", { level: 1, name: "Complete payment" });
    expect(activeStep()).toBe("Payment");

    const summary = screen.getByTestId("ac-order-summary");
    expect(summary).toHaveTextContent("Individual · per year");
    expect(summary).toHaveTextContent("Pro seat");
    expect(within(summary).getByTestId("ac-line-period")).toHaveTextContent("Year");
    expect(within(summary).getByTestId("ac-line-decks")).toHaveTextContent("500 decks");
    expect(within(summary).getByTestId("ac-line-extra")).toHaveTextContent("Extra credits (125)₹3,840");
    // ₹15,360 + ₹3,840 = ₹19,200; GST 18 % = ₹3,456; total ₹22,656.
    expect(within(summary).getByTestId("ac-gst-line")).toHaveTextContent("₹3,456");
    expect(within(summary).getByTestId("ac-total")).toHaveTextContent("₹22,656");
    expect(within(summary).getByTestId("ac-decks-line")).toHaveTextContent("625 decks available with your plan");
    assertNoCardField();

    fireEvent.click(screen.getByTestId("ac-pm-card"));
    fireEvent.click(screen.getByTestId("ac-pay"));
    await screen.findByRole("heading", { level: 1, name: "Order recorded" });
    expect(server.calls.find((c) => c.method === "POST")?.body).toEqual({
      planCode: "seat_pro_12",
      currency: "INR",
      paymentMethod: "card",
      quantity: 1,
      extraCredits: 125,
    });
    expect(stepLabels()).toEqual(["Account", "Seat & pricing", "Done"]);
    expect(screen.getByTestId("ac-receipt-status")).toHaveTextContent("Recorded — not charged");
    expect(screen.getByTestId("ac-receipt-decks")).toHaveTextContent("625 decks ready to use");
    expect(document.body.textContent).not.toMatch(/Payment successful|Amount paid/);
    assertNoCardField();
    assertNoPerDeck();
  });

  it("carries no GST line on a non-INR order", async () => {
    mount("/app/account", SUPERUSER);
    await screen.findByRole("heading", { level: 1, name: "Create your account" });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    await screen.findByRole("heading", { level: 1, name: "Choose your seat" });
    fireEvent.click(byRadio(/USD/));
    fireEvent.click(screen.getByTestId("ac-tier-pro"));
    expect(screen.getByTestId("ac-period-3")).toHaveTextContent("$71.94");
    expect(screen.getByText(/exclusive of local taxes/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("ac-period-3"));
    fireEvent.click(screen.getByRole("button", { name: /Continue to pay/ }));
    await screen.findByRole("heading", { level: 1, name: "Complete payment" });
    const summary = screen.getByTestId("ac-order-summary");
    expect(within(summary).queryByTestId("ac-gst-line")).toBeNull();
    expect(within(summary).getByTestId("ac-untaxed-line")).toHaveTextContent("Not included");
    expect(within(summary).getByTestId("ac-total")).toHaveTextContent("$71.94");
  });

  it("renders the catalogue it is given — change the data and the screen changes", async () => {
    const edited = catalogueFixture();
    edited.plans = edited.plans
      // Premium is withdrawn entirely, so the seat grid is two cards wide.
      .filter((p) => p.tier !== "premium")
      .map((p) =>
        p.code === "seat_standard_6"
          ? { ...p, active: false }
          : p.code === "seat_standard_3"
            ? { ...p, name: "Starter", amounts: { ...p.amounts, INR: 111_100 } }
            : p,
      );
    server.book = edited;
    mount("/app/account", SUPERUSER);
    await screen.findByRole("heading", { level: 1, name: "Create your account" });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    await screen.findByRole("heading", { level: 1, name: "Choose your seat" });
    const tiers = within(screen.getByTestId("ac-tiers")).getAllByRole("radio");
    expect(tiers.map((t) => t.getAttribute("data-testid"))).toEqual(["ac-tier-standard", "ac-tier-pro"]);
    expect(screen.getByTestId("ac-tier-standard")).toHaveTextContent("Starter");
    fireEvent.click(screen.getByTestId("ac-tier-standard"));
    // The switched-off half-year row leaves a two-column period grid.
    expect(
      within(screen.getByTestId("ac-periods")).getAllByRole("radio").map((p) => p.getAttribute("data-testid")),
    ).toEqual(["ac-period-3", "ac-period-12"]);
    expect(screen.getByTestId("ac-period-3")).toHaveTextContent("₹1,111");
  });

  it("walks the 3-deck free trial, then the paid one, and orders the pack it chose", async () => {
    mount("/app/account", SUPERUSER);
    await screen.findByRole("heading", { level: 1, name: "Create your account" });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    await screen.findByRole("heading", { level: 1, name: "Choose your seat" });
    fireEvent.click(screen.getByTestId("ac-tier-premium"));
    fireEvent.click(screen.getByTestId("ac-period-6"));
    fireEvent.click(screen.getByTestId("ac-take-trial"));

    await screen.findByRole("heading", { level: 1, name: "Your 3-deck free trial" });
    // The trial belongs to the seat step, not a step of its own.
    expect(activeStep()).toBe("Seat & pricing");
    expect(screen.getByText(/Premium plan/)).toBeInTheDocument();
    expect(screen.getByTestId("ac-trial-count")).toHaveTextContent("3");
    const decks = () =>
      Array.from(screen.getByTestId("ac-trial-decks").children).map((d) => d.getAttribute("data-used"));
    expect(decks()).toEqual(["false", "false", "false"]);
    expect(screen.queryByTestId("ac-trial-done")).toBeNull();

    fireEvent.click(screen.getByTestId("ac-use-trial-deck"));
    expect(screen.getByTestId("ac-trial-count")).toHaveTextContent("2");
    expect(decks()).toEqual(["true", "false", "false"]);
    fireEvent.click(screen.getByTestId("ac-use-trial-deck"));
    fireEvent.click(screen.getByTestId("ac-use-trial-deck"));
    expect(screen.getByTestId("ac-trial-count")).toHaveTextContent("0");
    expect(decks()).toEqual(["true", "true", "true"]);
    expect(screen.getByTestId("ac-use-trial-deck")).toBeDisabled();
    expect(screen.getByTestId("ac-trial-done")).toHaveTextContent(
      "Trial complete — how would you like to continue?",
    );

    fireEvent.click(screen.getByTestId("ac-try-paid"));
    await screen.findByRole("heading", { level: 1, name: "Try a paid trial" });
    expect(screen.getByText(/₹100 per deck/)).toBeInTheDocument();
    expect(
      within(screen.getByTestId("ac-paid-packs")).getAllByRole("radio").map((p) => p.textContent),
    ).toEqual([
      expect.stringContaining("10"),
      expect.stringContaining("20"),
      expect.stringContaining("30"),
      expect.stringContaining("40"),
      expect.stringContaining("50"),
    ]);
    expect(screen.getByRole("button", { name: /Continue to payment/ })).toBeDisabled();
    fireEvent.click(screen.getByTestId("ac-paid-pack-30"));
    expect(screen.getByTestId("ac-paid-pack-30")).toHaveTextContent("₹3,000");

    fireEvent.click(screen.getByRole("button", { name: /Continue to payment/ }));
    await screen.findByRole("heading", { level: 1, name: "Complete payment" });
    const summary = screen.getByTestId("ac-order-summary");
    expect(summary).toHaveTextContent("Trial credits (30 decks)");
    expect(within(summary).getByTestId("ac-total")).toHaveTextContent("₹3,540");
    expect(within(summary).getByTestId("ac-decks-line")).toHaveTextContent("30 decks · credits never expire");

    fireEvent.click(screen.getByTestId("ac-pay"));
    await screen.findByRole("heading", { level: 1, name: "Order recorded" });
    expect(server.calls.find((c) => c.method === "POST")?.body).toEqual({
      planCode: "paid_trial",
      currency: "INR",
      paymentMethod: "upi",
      quantity: 30,
      extraCredits: 0,
    });
  });
});

describe("Buy credits", () => {
  it("opens at the seat step and asks who is buying before payment", async () => {
    mount("/app/billing", SUPERUSER);
    await screen.findByRole("heading", { level: 1, name: "Choose your seat" });
    expect(activeStep()).toBe("Seat & pricing");
    fireEvent.click(screen.getByTestId("ac-tier-standard"));
    fireEvent.click(screen.getByTestId("ac-period-3"));
    fireEvent.click(screen.getByRole("button", { name: /Continue to pay/ }));
    await screen.findByRole("heading", { level: 1, name: "Create your account" });
    expect(screen.getByText("Add your account details, then continue to payment.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    await screen.findByRole("heading", { level: 1, name: "Complete payment" });
    expect(screen.getByTestId("ac-order-summary")).toHaveTextContent("Standard seat");
  });
});

describe("the Organization branch", () => {
  it("walks Account → Org type → Org details → Plan → Payment → Done", async () => {
    mount("/app/account", SUPERUSER);
    await screen.findByRole("heading", { level: 1, name: "Create your account" });
    fireEvent.click(screen.getByTestId("ac-type-organization"));
    expect(stepLabels()).toEqual(["Account", "Org type", "Org details", "Plan", "Payment", "Done"]);
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    await screen.findByRole("heading", { level: 1, name: "What best describes your organisation?" });
    expect(activeStep()).toBe("Org type");
    // Nothing is saved until the organisation is.
    expect(server.calls.some((c) => c.method === "PUT")).toBe(false);
    fireEvent.click(screen.getByTestId("ac-org-investor"));
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    await screen.findByRole("heading", { level: 1, name: "Create your account" });
    expect(activeStep()).toBe("Org details");
    for (const label of [
      "Organization name",
      "Type of business",
      "No. of employees",
      "No. of associates",
      "City",
      "Country",
      "Contact person name",
      "Designation",
      "Organisation country code",
      "Phone number",
      "Email ID",
    ]) {
      expect(screen.getByLabelText(label), label).toBeInTheDocument();
    }
    expect(screen.getAllByRole("option", { name: "Family Office" })).toHaveLength(1);
    expect(screen.getAllByRole("option", { name: "201–500" })).toHaveLength(1);
    assertNoCardField();

    fireEvent.click(screen.getByRole("button", { name: /Create account/ }));
    expect(await screen.findByText("Enter your organisation's name.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Organization name"), { target: { value: "Acme Ventures" } });
    fireEvent.change(screen.getByLabelText("Type of business"), { target: { value: "VC Firm" } });
    fireEvent.change(screen.getByLabelText("No. of employees"), { target: { value: "11–50" } });
    fireEvent.change(screen.getByLabelText("No. of associates"), { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText("Country"), { target: { value: "India" } });
    fireEvent.click(screen.getByRole("button", { name: /Create account/ }));

    await screen.findByRole("heading", { level: 1, name: "Choose your Enterprise plan" });
    expect(activeStep()).toBe("Plan");
    expect(server.calls.find((c) => c.method === "PUT")?.body).toMatchObject({
      accountType: "organization",
      org: {
        kind: "investor",
        name: "Acme Ventures",
        businessType: "VC Firm",
        employees: "11–50",
        associates: 12,
        country: "India",
        contactName: "Nisha Kapoor",
        email: "nisha.kapoor@demo.startupjury.ai",
      },
    });
    // V3-PT — the three SEAT-COUNT plans, ascending. The legacy `ent_100` /
    // `ent_500` unit tiers are still in the catalogue and are NOT drawn: the
    // screen selects on `seats`, which only `0073`'s rows carry.
    const cards = within(screen.getByTestId("ac-orgplans")).getAllByRole("radio");
    expect(cards.map((c) => c.getAttribute("data-testid"))).toEqual([
      "ac-plan-ent_s5",
      "ac-plan-ent_s10",
      "ac-plan-ent_s15",
    ]);
    expect(screen.getByTestId("ac-plan-ent_s10")).toHaveTextContent("₹1,60,000 Annual + GST");
    expect(screen.getByTestId("ac-plan-ent_s10")).toHaveTextContent("10 seats — all Premium");
    expect(screen.getByTestId("ac-plan-ent_s10")).toHaveTextContent("5,000 decks / year (500 per seat)");
    // `acOrgPlanKey = 's10'` — the middle card arrives selected.
    expect(screen.getByTestId("ac-plan-ent_s10")).toHaveAttribute("aria-checked", "true");
    assertNoPerDeck();

    fireEvent.click(screen.getByTestId("ac-plan-ent_s15"));
    // `renderOrgExtra()` prices an organisation's extra decks at the PREMIUM
    // rate: ₹20,480 / 500 = ₹40.96.
    expect(screen.getByTestId("ac-orgextra")).toHaveTextContent("₹40.96/credit");
    fireEvent.click(screen.getByRole("button", { name: /Continue to pay/ }));
    await screen.findByRole("heading", { level: 1, name: "Complete payment" });
    expect(activeStep()).toBe("Payment");
    const summary = screen.getByTestId("ac-order-summary");
    expect(summary).toHaveTextContent("Organization · 15 Premium seats · annual");
    expect(summary).toHaveTextContent("Annual plan");
    expect(within(summary).getByTestId("ac-line-seats")).toHaveTextContent("15 · all Premium");
    expect(within(summary).getByTestId("ac-line-decks")).toHaveTextContent("7,500 decks");
    expect(within(summary).getByTestId("ac-total")).toHaveTextContent("₹2,83,200");

    fireEvent.click(screen.getByTestId("ac-pay"));
    await screen.findByRole("heading", { level: 1, name: "Order recorded" });
    expect(stepLabels()).toEqual(["Account", "Org type", "Org details", "Plan", "Payment", "Done"]);
    expect(
      Array.from(screen.getByTestId("ac-steps").querySelectorAll("[data-state]")).every(
        (s) => s.getAttribute("data-state") === "done",
      ),
    ).toBe(true);
    expect(screen.getByTestId("ac-receipt")).toHaveTextContent("Annual subscription · renews yearly");
    expect(screen.getByTestId("ac-receipt")).toHaveTextContent("Large Organisation Plan · Organization");
    expect(screen.getByTestId("ac-receipt-decks")).toHaveTextContent("7,500 decks ready to use");
    assertNoCardField();
  });
});

// ── S3-ACCOUNT · the incubator ADMIN now gets the seat flow ──────────────────

/**
 * The client's 21-Sep row for My account reads **Superuser/Admin**, so `V3-PT`'s
 * `edition === "incubator" && role === "superuser"` gained the admin. These are
 * the positive controls: each one is the superuser's screen, asserted for the
 * admin, and each fails if the gate is narrowed back.
 *
 * Note what this costs and why it is acceptable: `billing` is
 * `roles: ["admin"]` plus the superuser bypass, so **the incubator has no third
 * audience for this overlay** and its legacy plan screens are now unreachable.
 * They are still the VC edition's screens, and the block below is where that is
 * held — the negative controls moved there rather than being deleted.
 */
describe("the incubator ADMIN gets v3's seat flow", () => {
  async function openPlanScreen(user: AuthUser) {
    mount("/app/account", user);
    await screen.findByRole("heading", { level: 1, name: "Create your account" });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
  }

  it("chooses a SEAT, not a plan, and the stepper says so", async () => {
    await openPlanScreen(principal("admin"));
    await screen.findByRole("heading", { level: 1, name: "Choose your seat" });
    expect(screen.getByTestId("ac-tiers")).toBeInTheDocument();
    // Not one thing the pre-v3 screen drew is on it.
    expect(screen.queryByRole("tab", { name: "Individual plans" })).toBeNull();
    expect(screen.queryByTestId("ac-plan-standard")).toBeNull();
    expect(stepLabels()).toEqual(["Account", "Seat & pricing", "Payment"]);
  });

  it("reaches the period, the extra decks and the free trial the superuser reaches", async () => {
    await openPlanScreen(principal("admin"));
    await screen.findByRole("heading", { level: 1, name: "Choose your seat" });
    // Both footer buttons stay shut until a seat AND a period are picked.
    expect(screen.getByTestId("ac-take-trial")).toBeDisabled();
    fireEvent.click(screen.getByTestId("ac-tier-pro"));
    expect(screen.getByTestId("ac-take-trial")).toBeDisabled();
    fireEvent.click(screen.getByTestId("ac-period-12"));
    expect(screen.getByTestId("ac-take-trial")).toBeEnabled();
    expect(screen.getByTestId("ac-periods")).toBeInTheDocument();
    expect(screen.getByTestId("ac-extra")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("ac-take-trial"));
    await screen.findByRole("heading", { level: 1, name: "Your 3-deck free trial" });
    expect(screen.getByTestId("ac-trial-count")).toHaveTextContent("3");
  });

  it("loses the free-trial strip v3 deleted from the Account screen", async () => {
    mount("/app/account", principal("admin"));
    await screen.findByRole("heading", { level: 1, name: "Create your account" });
    expect(screen.queryByText(/Evaluate 3 pitchdecks free/)).toBeNull();
  });

  it("gets the seat-count Enterprise plans on the Organization branch", async () => {
    mount("/app/account", principal("admin"));
    await screen.findByRole("heading", { level: 1, name: "Create your account" });
    fireEvent.click(screen.getByTestId("ac-type-organization"));
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    await screen.findByRole("heading", { level: 1, name: "What best describes your organisation?" });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    await screen.findByRole("heading", { level: 1, name: "Create your account" });
    fireEvent.change(screen.getByLabelText("Organization name"), { target: { value: "Acme" } });
    fireEvent.change(screen.getByLabelText("Country"), { target: { value: "India" } });
    fireEvent.click(screen.getByRole("button", { name: /Create account/ }));

    await screen.findByRole("heading", { level: 1, name: "Choose your Enterprise plan" });
    expect(screen.getByTestId("ac-orgextra")).toBeInTheDocument();
    expect(screen.queryByTestId("ac-plan-ent_100")).toBeNull();
  });
});

// ── The VC edition, which was NOT rescoped ───────────────────────────────────

/**
 * Only `AISJ_SuperuserV3.HTM` was reshared, and no VC file was: every one still
 * contains "Choose your plan" and none contains `acs-trial` or `itiers` —
 * checked against the decoded prototypes.
 *
 * These are the negative controls, and after the widening above the VC edition
 * is the ONLY place left that can hold them. Each one fails the moment the seat
 * flow stops being gated by edition, which is the only way this suite can still
 * tell the difference between "the incubator's screen" and "everybody's".
 */
describe("the VC edition keeps the old plan screen", () => {
  async function openPlanScreen(user: AuthUser) {
    mount("/app/account", user);
    await screen.findByRole("heading", { level: 1, name: "Create your account" });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
  }

  it("the VC ADMIN still chooses a plan, from the tabbed catalogues", async () => {
    await openPlanScreen(VC_ADMIN);
    await screen.findByRole("heading", { level: 1, name: "Choose your plan" });
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Individual plans",
      "Pay-as-you-go credit packs",
    ]);
    expect(screen.getByTestId("ac-plan-standard")).toHaveTextContent("₹999/mo");
    // Not one thing v3 added is on this screen.
    expect(screen.queryByTestId("ac-tiers")).toBeNull();
    expect(screen.queryByTestId("ac-periods")).toBeNull();
    expect(screen.queryByTestId("ac-take-trial")).toBeNull();
    expect(screen.queryByTestId("ac-extra")).toBeNull();
    // The account screen keeps its trial strip, which v3 deleted.
    expect(stepLabels()).toEqual(["Account", "Plan", "Payment"]);
  });

  it("the VC superuser still chooses a plan — the VC edition was not rescoped", async () => {
    await openPlanScreen(VC_SUPERUSER);
    await screen.findByRole("heading", { level: 1, name: "Choose your plan" });
    expect(screen.queryByTestId("ac-tiers")).toBeNull();
    expect(stepLabels()).toEqual(["Account", "Plan", "Payment"]);
  });

  it("keeps the seat SKUs off the old screen entirely", async () => {
    await openPlanScreen(VC_ADMIN);
    await screen.findByRole("heading", { level: 1, name: "Choose your plan" });
    const plans = within(screen.getByRole("radiogroup", { name: "Individual plans" })).getAllByRole("radio");
    // The catalogue has eleven subscription rows; nine of them are seats and
    // belong to the superuser's screen. This one still draws exactly two.
    expect(plans.map((p) => p.getAttribute("data-testid"))).toEqual([
      "ac-plan-standard",
      "ac-plan-pro",
    ]);
    fireEvent.click(screen.getByRole("tab", { name: "Pay-as-you-go credit packs" }));
    const packs = within(screen.getByRole("radiogroup", { name: "Pay-as-you-go credit packs" })).getAllByRole("radio");
    expect(packs.map((p) => p.getAttribute("data-testid"))).toEqual([
      "ac-plan-pack_10",
      "ac-plan-pack_50",
      "ac-plan-pack_100",
    ]);
    expect(screen.queryByTestId("ac-plan-paid_trial")).toBeNull();
  });

  it("says so when the catalogue prices no paid trial in the chosen currency", async () => {
    const noRate = catalogueFixture();
    // GBP is a billable currency here; the paid-trial row simply is not priced in it.
    noRate.plans = noRate.plans.map((p) =>
      p.code === "paid_trial" ? { ...p, amounts: { ...p.amounts, GBP: 0 } } : p,
    );
    server.book = noRate;
    mount("/app/account", SUPERUSER);
    await screen.findByRole("heading", { level: 1, name: "Create your account" });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    await screen.findByRole("heading", { level: 1, name: "Choose your seat" });
    fireEvent.click(byRadio(/GBP/));
    fireEvent.click(screen.getByTestId("ac-tier-pro"));
    fireEvent.click(screen.getByTestId("ac-period-12"));
    fireEvent.click(screen.getByTestId("ac-take-trial"));
    await screen.findByRole("heading", { level: 1, name: "Your 3-deck free trial" });
    fireEvent.click(screen.getByTestId("ac-use-trial-deck"));
    fireEvent.click(screen.getByTestId("ac-use-trial-deck"));
    fireEvent.click(screen.getByTestId("ac-use-trial-deck"));
    fireEvent.click(screen.getByTestId("ac-try-paid"));
    await screen.findByRole("heading", { level: 1, name: "Try a paid trial" });
    // Not five packs priced at zero with a Continue that does nothing.
    expect(screen.queryByTestId("ac-paid-packs")).toBeNull();
    expect(screen.getByText(/A paid trial is not sold in GBP right now/)).toBeInTheDocument();
  });

  it("the VC admin's account screen keeps the free-trial strip v3 deleted", async () => {
    mount("/app/account", VC_ADMIN);
    await screen.findByRole("heading", { level: 1, name: "Create your account" });
    expect(screen.getByText(/Evaluate 3 pitchdecks free/)).toBeInTheDocument();
    // …and the incubator superuser's does not.
    cleanup();
    mount("/app/account", SUPERUSER);
    await screen.findByRole("heading", { level: 1, name: "Create your account" });
    expect(screen.queryByText(/Evaluate 3 pitchdecks free/)).toBeNull();
  });

  it("the VC admin's Organization branch still shows the unit tiers, not the seat counts", async () => {
    mount("/app/account", VC_ADMIN);
    await screen.findByRole("heading", { level: 1, name: "Create your account" });
    fireEvent.click(screen.getByTestId("ac-type-organization"));
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    await screen.findByRole("heading", { level: 1, name: "What best describes your organisation?" });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    await screen.findByRole("heading", { level: 1, name: "Create your account" });
    fireEvent.change(screen.getByLabelText("Organization name"), { target: { value: "Acme" } });
    fireEvent.change(screen.getByLabelText("Country"), { target: { value: "India" } });
    fireEvent.click(screen.getByRole("button", { name: /Create account/ }));

    await screen.findByRole("heading", { level: 1, name: "Choose your plan" });
    const cards = within(screen.getByRole("radiogroup", { name: "Enterprise annual plans" })).getAllByRole("radio");
    expect(cards.map((c) => c.getAttribute("data-testid"))).toEqual(["ac-plan-ent_100", "ac-plan-ent_500"]);
    expect(screen.queryByTestId("ac-plan-ent_s10")).toBeNull();
    expect(screen.queryByTestId("ac-orgextra")).toBeNull();
  });
});
