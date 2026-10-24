import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AccountPage } from "../../src/client/routes/AccountPage";
import { BuyCreditsPage } from "../../src/client/routes/BuyCreditsPage";
import { AuthContext, type AuthUser } from "../../src/client/auth/AuthProvider";
import { resolveBillingLocale, type FreeTrialStatus } from "../../src/shared/plans";
import { taxSettingsOf, type AccountOrderView } from "../../src/shared/accountOrder";
import { catalogueFixture } from "../unit/fixtures/accountCatalogue";
import { openCheckout } from "../../src/client/routes/account/accountApi";

/**
 * P2 (23-Oct tracker, row 12) — the payment gateway, from the customer's side.
 *
 *   1. With a provider configured, Pay sends the customer to the PROVIDER's page
 *      (and the button promises what a payment does — credits — not "activate
 *      plan", which nothing behind it does).
 *   2. The provider's return lands on `/app/account?order=<id>`, and the
 *      receipt says what the SERVER says: paid and credited, or still waiting.
 *   3. A checkout the provider refused is said to have charged nothing.
 *
 * `openCheckout` is mocked because jsdom cannot navigate away; everything else
 * in `accountApi.ts` is the real module talking to the stubbed `fetch` below.
 */

vi.mock("../../src/client/routes/account/accountApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/routes/account/accountApi")>()),
  openCheckout: vi.fn(() => true),
}));
vi.mock("../../src/client/routes/admin/Notifications", () => ({
  NotificationPreferences: () => <div>notification preferences</div>,
}));

const SUPERUSER: AuthUser = {
  id: "inc_super",
  name: "Priya Sharma",
  initials: "PS",
  role: "superuser",
  edition: "incubator",
  permissions: ["upgrade", "adminconsole"],
};

const PROFILE = {
  accountType: "individual",
  workEmail: "priya@demo.startupjury.ai",
  firstName: "Priya",
  lastName: "Sharma",
  dialCode: "+91",
  phone: null,
  designation: null,
  organizationName: null,
  org: null,
};

const TRIAL: FreeTrialStatus = { decks: 3, taken: true, grantedAt: "2026-05-28 09:00:00", granted: 3, used: 3 };

function orderView(over: Partial<AccountOrderView>): AccountOrderView {
  return {
    id: "pi_0f3c2a9e-1111-4222-8333-444455556666",
    planCode: "seat_pro_12",
    planName: "Pro",
    group: "subscription",
    period: "year",
    periodMonths: 12,
    units: 500,
    currency: "INR",
    subtotalMinor: 1_536_000,
    taxMinor: 276_480,
    totalMinor: 1_812_480,
    ratePct: 18,
    taxed: true,
    status: "redirected",
    checkoutUrl: "https://rzp.io/i/plink_P2client",
    paymentMethod: "upi",
    accountType: "individual",
    createdAt: "2026-10-23T21:00:00.000Z",
    ...over,
  };
}

let orderResponse: { status: number; body: unknown };
let storedOrder: AccountOrderView;

function json(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

beforeEach(() => {
  vi.mocked(openCheckout).mockClear();
  storedOrder = orderView({});
  orderResponse = {
    status: 200,
    body: {
      ok: true,
      order: storedOrder,
      completed: false,
      creditsGranted: 0,
      checkout: { hosted: true, url: storedOrder.checkoutUrl },
      message: "Continue on the payment provider's secure page to complete this order.",
    },
  };
  const book = catalogueFixture();
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/account" && method === "GET") {
        return json(200, {
          profile: PROFILE,
          saved: true,
          billing: {
            name: null,
            city: null,
            country: null,
            address: null,
            locale: resolveBillingLocale(null, taxSettingsOf(book.tax)),
          },
          orders: [],
          paymentConfigured: true,
          trial: TRIAL,
          balance: 0,
        });
      }
      if (url === "/api/pricing/published") return json(200, book);
      if (url === "/api/account/orders" && method === "POST") return json(orderResponse.status, orderResponse.body);
      if (url === `/api/account/orders/${storedOrder.id}` && method === "GET") return json(200, storedOrder);
      return json(404, { error: "not_found" });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mount(path: string) {
  return render(
    <AuthContext.Provider value={{ user: SUPERUSER, loading: false, login: vi.fn(), logout: vi.fn(), updateUser: vi.fn() }}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/app/account" element={<AccountPage />} />
          <Route path="/app/billing" element={<BuyCreditsPage />} />
          <Route path="*" element={<div>the dashboard</div>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

async function reachPayment() {
  mount("/app/billing");
  await screen.findByRole("heading", { level: 1, name: "Choose your seat" });
  fireEvent.click(screen.getByTestId("ac-tier-pro"));
  fireEvent.click(screen.getByTestId("ac-period-12"));
  fireEvent.click(screen.getByRole("button", { name: /Continue to pay/ }));
  await screen.findByRole("heading", { level: 1, name: "Complete payment" });
}

describe("paying, with Razorpay configured", () => {
  it("promises what a payment does, then sends the customer to the provider's page", async () => {
    await reachPayment();
    // No "No payment provider is connected yet" note, and no "& activate plan":
    // a completed payment grants decks; it does not change the tier.
    expect(screen.queryByTestId("ac-no-provider")).toBeNull();
    expect(screen.getByTestId("ac-pay")).toHaveTextContent(/^Pay ₹18,124.80 securely$/);
    expect(screen.getByTestId("ac-pay")).not.toHaveTextContent(/activate/i);

    fireEvent.click(screen.getByTestId("ac-pay"));
    await screen.findByRole("heading", { level: 1, name: "Continue to payment" });
    expect(vi.mocked(openCheckout)).toHaveBeenCalledWith("https://rzp.io/i/plink_P2client");
    // The fallback, if the navigation is blocked: the link, and nothing paid yet.
    expect(screen.getByRole("link", { name: /Continue to secure payment/ })).toHaveAttribute(
      "href",
      "https://rzp.io/i/plink_P2client",
    );
    expect(screen.getByTestId("ac-receipt-status")).toHaveTextContent("Awaiting payment");
    expect(screen.getByTestId("ac-receipt-lead")).toHaveTextContent(/nothing has been charged yet/);
  });

  it("says nothing was charged when the provider will not open a checkout — and goes nowhere", async () => {
    orderResponse = {
      status: 502,
      body: {
        error: "checkout_failed",
        order: orderView({ status: "failed", checkoutUrl: null }),
        completed: false,
        creditsGranted: 0,
        message: "The payment provider could not start this payment. Nothing has been charged — try again.",
      },
    };
    await reachPayment();
    fireEvent.click(screen.getByTestId("ac-pay"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not start this payment\. Nothing has been charged/);
    // Still on the payment screen, so the customer can try again.
    expect(screen.getByRole("heading", { level: 1, name: "Complete payment" })).toBeInTheDocument();
    expect(vi.mocked(openCheckout)).not.toHaveBeenCalled();
  });
});

describe("coming back from the provider", () => {
  it("opens on the receipt, and a PAID order says paid, credited, with a real invoice", async () => {
    storedOrder = orderView({ status: "completed", checkoutUrl: "https://rzp.io/i/plink_P2client" });
    mount(`/app/account?order=${storedOrder.id}`);
    await screen.findByRole("heading", { level: 1, name: "Payment successful" });
    expect(screen.getByTestId("ac-receipt-lead")).toHaveTextContent("Payment received — 500 credits are now in your balance.");
    // Not V6's "Your Pro plan is now active" — nothing behind the payment changes the tier.
    expect(screen.queryByText(/plan is now active/)).toBeNull();
    expect(screen.getByTestId("ac-receipt-status")).toHaveTextContent("Paid");
    expect(screen.getByTestId("ac-receipt-amount")).toHaveTextContent("₹18,124.80");
    expect(within(screen.getByTestId("ac-receipt")).getByText("Amount paid")).toBeInTheDocument();
    expect(screen.getByTestId("ac-download-invoice")).toHaveTextContent("Download tax invoice");
    // A paid order is never sent back to the provider.
    expect(vi.mocked(openCheckout)).not.toHaveBeenCalled();
  });

  it("says a still-waiting order is still waiting — the return alone proves nothing", async () => {
    storedOrder = orderView({ status: "redirected" });
    mount(`/app/account?order=${storedOrder.id}`);
    await screen.findByRole("heading", { level: 1, name: "Continue to payment" });
    expect(screen.getByTestId("ac-receipt-status")).toHaveTextContent("Awaiting payment");
    expect(screen.getByTestId("ac-download-invoice")).toHaveTextContent("Download pro-forma invoice");
    expect(screen.queryByText("Payment successful")).toBeNull();
  });

  it("says so when the order cannot be loaded, rather than showing a blank receipt", async () => {
    mount("/app/account?order=pi_00000000-0000-4000-8000-000000000000");
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't load that order.");
    expect(screen.queryByText("Payment successful")).toBeNull();
  });
});
