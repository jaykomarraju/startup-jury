import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { AccountPage } from "../../src/client/routes/AccountPage";
import { BuyCreditsPage } from "../../src/client/routes/BuyCreditsPage";
import { AuthContext, type AuthUser } from "../../src/client/auth/AuthProvider";
import type { PublishedPriceBook } from "../../src/shared/priceBook";
import type { AccountOrderView, AccountProfile } from "../../src/shared/accountOrder";
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

function orderFrom(body: { planCode: string; currency: string; paymentMethod: string }, accountType: string): AccountOrderView {
  const book = server.book!;
  const plan = book.plans.find((p) => p.code === body.planCode)!;
  const sub = plan.amounts[body.currency];
  const taxed = body.currency === "INR";
  const tax = taxed ? Math.round((sub * 18) / 100) : 0;
  return {
    id: "pi_0f3c2a9e-test",
    planCode: plan.code,
    planName: plan.name,
    group: plan.group as AccountOrderView["group"],
    period: plan.period,
    units: plan.units,
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
  it("walks Account → Plan → Payment → receipt, reading every price from the catalogue", async () => {
    mount("/app/account");
    await screen.findByRole("heading", { level: 1, name: "Create your account" });
    expect(stepLabels()).toEqual(["Account", "Plan", "Payment"]);
    expect(activeStep()).toBe("Account");
    expect(screen.getByText(/Evaluate 3 pitchdecks free/)).toBeInTheDocument();
    expect(screen.getByLabelText("Work email")).toHaveValue("nisha.kapoor@demo.startupjury.ai");
    assertNoCardField();

    // Personal mail is refused before anything is sent.
    fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "nisha@gmail.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    expect(await screen.findByText("Personal email addresses are not accepted.")).toBeInTheDocument();
    expect(server.calls.some((c) => c.method === "PUT")).toBe(false);

    fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "nisha.kapoor@demo.startupjury.ai" } });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    await screen.findByRole("heading", { level: 1, name: "Choose your plan" });
    expect(server.calls.find((c) => c.method === "PUT")?.body).toMatchObject({ accountType: "individual" });
    expect(activeStep()).toBe("Plan");

    // The two tabs ARE the catalogue's group titles.
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Individual plans",
      "Pay-as-you-go credit packs",
    ]);
    expect(within(screen.getByRole("radiogroup", { name: "Individual plans" })).getAllByRole("radio")).toHaveLength(2);
    expect(screen.getByTestId("ac-plan-standard")).toHaveTextContent("₹999/mo");
    assertNoPerDeck();
    assertNoCardField();

    fireEvent.click(screen.getByRole("tab", { name: "Pay-as-you-go credit packs" }));
    const packs = within(screen.getByRole("radiogroup", { name: "Pay-as-you-go credit packs" })).getAllByRole("radio");
    // Active packs only: the switched-off 250-unit pack is not drawn.
    expect(packs.map((p) => p.getAttribute("data-testid"))).toEqual(["ac-plan-pack_10", "ac-plan-pack_50", "ac-plan-pack_100"]);
    expect(screen.getByTestId("ac-plan-pack_50")).toHaveTextContent("50 credits");
    expect(screen.getByTestId("ac-plan-pack_50")).toHaveTextContent("₹20,000");
    expect(screen.getByTestId("ac-plan-pack_50")).toHaveTextContent("Most popular");
    // The badged pack is the default selection.
    expect(screen.getByTestId("ac-plan-pack_50")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/Free trial — 3 decks included/)).toBeInTheDocument();
    assertNoPerDeck();

    fireEvent.click(screen.getByTestId("ac-plan-pack_100"));
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    await screen.findByRole("heading", { level: 1, name: "Complete payment" });
    expect(activeStep()).toBe("Payment");

    const summary = screen.getByTestId("ac-order-summary");
    expect(summary).toHaveTextContent("100-unit pack");
    expect(summary).toHaveTextContent("100 credits");
    expect(within(summary).getByTestId("ac-gst-line")).toHaveTextContent("GST (18%)₹5,400");
    expect(within(summary).getByTestId("ac-total")).toHaveTextContent("₹35,400");
    expect(screen.getByTestId("ac-no-provider")).toHaveTextContent("nothing is charged");
    expect(screen.getByTestId("ac-pay")).toHaveTextContent("Place order · ₹35,400");
    expect(screen.getAllByRole("radio").map((r) => r.textContent)).toEqual([
      expect.stringContaining("UPI"),
      expect.stringContaining("Credit / Debit card"),
      expect.stringContaining("Net banking"),
      expect.stringContaining("Wallets"),
    ]);
    fireEvent.click(screen.getByTestId("ac-pm-card"));
    // Choosing "card" opens NO card field — the number is typed on the provider's page.
    assertNoCardField();

    fireEvent.click(screen.getByTestId("ac-pay"));
    await screen.findByRole("heading", { level: 1, name: "Order recorded" });
    expect(server.calls.find((c) => c.method === "POST")?.body).toEqual({
      planCode: "pack_100",
      currency: "INR",
      paymentMethod: "card",
    });
    expect(stepLabels()).toEqual(["Account", "Plan", "Done"]);
    const receipt = screen.getByTestId("ac-receipt");
    expect(receipt).toHaveTextContent("Amount due");
    expect(screen.getByTestId("ac-receipt-amount")).toHaveTextContent("₹35,400 (incl. GST)");
    expect(screen.getByTestId("ac-receipt-ref")).toHaveTextContent("pi_0f3c2a9e-test");
    expect(screen.getByTestId("ac-receipt-status")).toHaveTextContent("Recorded — not charged");
    expect(receipt).toHaveTextContent("One-time purchase · credits never expire");
    expect(screen.getByTestId("ac-download-invoice")).toHaveAttribute("href", "/api/account/orders/pi_0f3c2a9e-test/document");
    expect(document.body.textContent).not.toMatch(/Payment successful|Amount paid/);
    assertNoCardField();
    assertNoPerDeck();
  });

  it("carries no GST line on a non-INR order", async () => {
    mount("/app/account");
    await screen.findByRole("heading", { level: 1, name: "Create your account" });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    await screen.findByRole("heading", { level: 1, name: "Choose your plan" });
    fireEvent.click(byRadio(/USD/));
    expect(screen.getByTestId("ac-plan-pro")).toHaveTextContent("$24/mo");
    expect(screen.getByText(/exclusive of local taxes/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("ac-plan-pro"));
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    await screen.findByRole("heading", { level: 1, name: "Complete payment" });
    const summary = screen.getByTestId("ac-order-summary");
    expect(within(summary).queryByTestId("ac-gst-line")).toBeNull();
    expect(within(summary).getByTestId("ac-untaxed-line")).toHaveTextContent("Not included");
    expect(within(summary).getByTestId("ac-total")).toHaveTextContent("$24");
  });

  it("renders the catalogue it is given — change the data and the screen changes", async () => {
    const edited = catalogueFixture();
    edited.plans = edited.plans.map((p) =>
      p.code === "pack_10"
        ? { ...p, units: 20, name: "20-unit pack", badge: "Starter", amounts: { ...p.amounts, INR: 1_000_000 } }
        : p.code === "pack_100"
          ? { ...p, active: false }
          : p,
    );
    server.book = edited;
    mount("/app/billing");
    await screen.findByRole("heading", { level: 1, name: "Choose your plan" });
    const packs = within(screen.getByRole("radiogroup", { name: "Pay-as-you-go credit packs" })).getAllByRole("radio");
    expect(packs.map((p) => p.getAttribute("data-testid"))).toEqual(["ac-plan-pack_10", "ac-plan-pack_50"]);
    expect(screen.getByTestId("ac-plan-pack_10")).toHaveTextContent("20 credits");
    expect(screen.getByTestId("ac-plan-pack_10")).toHaveTextContent("₹10,000");
    expect(screen.getByTestId("ac-plan-pack_10")).toHaveTextContent("Starter");
    expect(screen.queryByText("100 credits")).toBeNull();
  });
});

describe("Buy credits", () => {
  it("opens at Plan on the credit packs, and asks who is buying before payment", async () => {
    mount("/app/billing");
    await screen.findByRole("heading", { level: 1, name: "Choose your plan" });
    expect(screen.getByRole("tab", { name: "Pay-as-you-go credit packs" })).toHaveAttribute("aria-selected", "true");
    expect(activeStep()).toBe("Plan");
    expect(screen.getByTestId("ac-plan-pack_50")).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    await screen.findByRole("heading", { level: 1, name: "Create your account" });
    expect(screen.getByText("Add your account details, then continue to payment.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    await screen.findByRole("heading", { level: 1, name: "Complete payment" });
    expect(screen.getByTestId("ac-order-summary")).toHaveTextContent("50-unit pack");
  });
});

describe("the Organization branch", () => {
  it("walks Account → Org type → Org details → Plan → Payment → Done", async () => {
    mount("/app/account");
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

    await screen.findByRole("heading", { level: 1, name: "Choose your plan" });
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
    const cards = within(screen.getByRole("radiogroup", { name: "Enterprise annual plans" })).getAllByRole("radio");
    expect(cards.map((c) => c.getAttribute("data-testid"))).toEqual(["ac-plan-ent_100", "ac-plan-ent_500"]);
    expect(screen.getByTestId("ac-plan-ent_500")).toHaveTextContent("₹2,00,000 Annual");
    expect(screen.getByTestId("ac-plan-ent_500")).toHaveTextContent("500 Credits AI pre-score");
    assertNoPerDeck();

    fireEvent.click(screen.getByTestId("ac-plan-ent_500"));
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    await screen.findByRole("heading", { level: 1, name: "Complete payment" });
    expect(activeStep()).toBe("Payment");
    const summary = screen.getByTestId("ac-order-summary");
    expect(summary).toHaveTextContent("Organization · annual");
    expect(summary).toHaveTextContent("Annual plan");
    expect(within(summary).getByTestId("ac-total")).toHaveTextContent("₹2,36,000");

    fireEvent.click(screen.getByTestId("ac-pay"));
    await screen.findByRole("heading", { level: 1, name: "Order recorded" });
    expect(stepLabels()).toEqual(["Account", "Org type", "Org details", "Plan", "Payment", "Done"]);
    expect(
      Array.from(screen.getByTestId("ac-steps").querySelectorAll("[data-state]")).every(
        (s) => s.getAttribute("data-state") === "done",
      ),
    ).toBe(true);
    expect(screen.getByTestId("ac-receipt")).toHaveTextContent("Annual subscription · renews yearly");
    expect(screen.getByTestId("ac-receipt")).toHaveTextContent("500 units / year · Organization");
    assertNoCardField();
  });
});
