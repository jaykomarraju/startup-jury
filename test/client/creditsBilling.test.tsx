import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { CreditsBillingSection } from "../../src/client/routes/admin/CreditsBilling";
import { AdminSaveContext, type AdminSaveState } from "../../src/client/routes/admin/saveContext";
import type { CreditsBillingView } from "../../src/shared/plans";

/**
 * W4-C — Admin console → Credits & billing.
 *
 * Four things this suite holds: the prototype's three tiles and their sub-lines;
 * the usage history's **empty and populated** states; that a purchase reports a
 * recorded intent and never a completed payment (§1.3) with **no card field
 * anywhere** (§1.2); and that no per-deck rate is rendered (§8 Q1).
 */

function view(over: Partial<CreditsBillingView> = {}): CreditsBillingView {
  return {
    edition: "incubator",
    balance: 47,
    purchased: 50,
    usedThisMonth: 3,
    usedThisCycle: 3,
    lowCreditThreshold: 10,
    subscription: {
      planCode: null,
      planLabel: "Configurable",
      tierLabel: "Enterprise",
      seats: 5,
      status: "active",
      currency: "INR",
      billingEmail: "accounts@incubator.in",
      gstin: "29ABCDE1234F1Z5",
      cycleAnchor: "2026-01-01",
      cycle: {
        start: "2026-01-01",
        end: "2026-12-31",
        renewsOn: "2027-01-01",
        period: "year",
      },
    },
    tax: {
      ratePct: 18,
      registration: "29ABCDE1234F1Z5",
      inclusive: false,
      internationalNotice: true,
    },
    ledger: [
      {
        id: "cl_1",
        createdAt: "2026-06-04 10:02:00",
        reason: "deck_evaluated",
        delta: -1,
        description: "GreenGrid Energy — pitchdeck evaluation",
        deckId: "inc_deck_greengrid",
        amountMinor: null,
        currency: null,
        reference: null,
        invoiceId: null,
      },
      {
        id: "cl_2",
        createdAt: "2026-06-03 16:20:00",
        reason: "purchase",
        delta: 50,
        description: "50-unit pack",
        deckId: null,
        amountMinor: 2_000_000,
        currency: "INR",
        reference: "RZP250603112244",
        invoiceId: "inv_cl_2",
      },
    ],
    invoices: [
      {
        id: "inv_cl_2",
        number: "INV-2026-0001",
        kind: "invoice",
        description: "50-unit pack",
        units: 50,
        currency: "INR",
        subtotalMinor: 2_000_000,
        taxMinor: 360_000,
        totalMinor: 2_360_000,
        ratePct: 18,
        registration: "29ABCDE1234F1Z5",
        reference: "RZP250603112244",
        issuedAt: "2026-06-03 16:20:00",
      },
    ],
    plans: [
      {
        code: "pack_50",
        group: "credit_pack",
        name: "50-unit pack",
        badge: "Most popular",
        tagline: null,
        features: "Priority WhatsApp support · Up to 10 evaluators",
        units: 50,
        period: "one_time",
        currency: "INR",
        amountMinor: 2_000_000,
      },
      {
        code: "pro",
        group: "subscription",
        name: "Pro",
        badge: null,
        tagline: "3 configurable params",
        features: null,
        units: null,
        period: "month",
        currency: "INR",
        amountMinor: 199_900,
      },
    ],
    intents: [],
    paymentConfigured: false,
    ...over,
  };
}

interface Sent {
  url: string;
  method: string;
  body: Record<string, unknown>;
}

function mockFetch(payload: CreditsBillingView, purchase?: Record<string, unknown>) {
  const sent: Sent[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method !== "GET") {
      sent.push({
        url,
        method,
        body: JSON.parse(String(init?.body ?? "{}")),
      });
    }
    if (url.includes("/purchase")) {
      return new Response(
        JSON.stringify(
          purchase ?? {
            ok: true,
            completed: false,
            creditsGranted: 0,
            checkout: { hosted: false, url: null },
            message:
              "Purchase intent recorded. No payment provider is configured, so nothing has " +
              "been charged and no credits have been added — our team will follow up to complete it.",
            intent: {
              id: "pi_1",
              purpose: "credit_pack",
              planCode: "pack_50",
              planName: "50-unit pack",
              units: 50,
              quantity: 1,
              currency: "INR",
              subtotalMinor: 2_000_000,
              taxMinor: 360_000,
              totalMinor: 2_360_000,
              ratePct: 18,
              status: "recorded",
              checkoutUrl: null,
              createdAt: "2026-09-11 10:00:00",
            },
          },
        ),
        { status: 200 },
      );
    }
    if (url.includes("/subscription")) {
      return new Response(JSON.stringify({ ok: true, subscription: payload.subscription }), {
        status: 200,
      });
    }
    return new Response(JSON.stringify(payload), { status: 200 });
  }) as typeof fetch;
  return sent;
}

let save: AdminSaveState | null = null;

function mount() {
  save = null;
  return render(
    <AdminSaveContext.Provider value={{ register: (s) => (save = s) }}>
      <CreditsBillingSection />
    </AdminSaveContext.Provider>,
  );
}

/** The card whose title is `title`. */
function card(title: string) {
  return screen.getByText(title).closest("div.rounded-xl") as HTMLElement;
}

/** Mount and wait for the payload — the section renders a loading card first. */
async function mounted() {
  const rendered = mount();
  await screen.findByText("Credits remaining");
  return rendered;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("the three tiles", () => {
  it("renders the prototype's labels, values and sub-lines", async () => {
    mockFetch(view());
    mount();
    await screen.findByText("Credits remaining");

    expect(screen.getByText("47")).toBeTruthy();
    expect(screen.getByText("of 50 purchased")).toBeTruthy();
    expect(screen.getByText("Used this month")).toBeTruthy();
    expect(screen.getByText("Current plan")).toBeTruthy();
    // The plan tile: "Configurable" over "Enterprise · 5 seats".
    expect(screen.getByText("Configurable")).toBeTruthy();
    expect(screen.getByText("Enterprise · 5 seats")).toBeTruthy();
  });

  it("says so when there is no plan and no seat allocation", async () => {
    mockFetch(
      view({
        subscription: {
          ...view().subscription,
          planLabel: "Free trial",
          tierLabel: null,
          seats: 0,
          status: "trialing",
        },
      }),
    );
    mount();
    expect(await screen.findByText("Free trial")).toBeTruthy();
    expect(screen.getByText("No seats allocated")).toBeTruthy();
  });

  it("warns below the low-credit line", async () => {
    mockFetch(view({ balance: 4 }));
    mount();
    expect(await screen.findByText(/below the 10-credit warning line/)).toBeTruthy();
  });

  it("does not warn above it", async () => {
    mockFetch(view());
    await mounted();
    expect(screen.queryByText(/warning line/)).toBeNull();
  });
});

describe("usage history", () => {
  it("has an empty state when nothing has moved", async () => {
    mockFetch(view({ ledger: [], invoices: [], purchased: 0, balance: 3 }));
    mount();
    expect(await screen.findByText(/No credit movements yet/)).toBeTruthy();
    expect(screen.getByText(/No invoices yet/)).toBeTruthy();
    // "Download invoice" has nothing to download, and says so rather than 404ing.
    const button = screen.getByRole("button", { name: /Download invoice/ });
    expect(button.getAttribute("disabled")).not.toBeNull();
  });

  it("renders one row per movement, with the prototype's sentence", async () => {
    mockFetch(view());
    await mounted();
    const history = card("Usage history");
    expect(within(history).getByText(/GreenGrid Energy — pitchdeck evaluation/)).toBeTruthy();
    // "1 credit · 4 Jun 2026" — the prototype's meta, MINUS the ₹999 §8 Q1 retired.
    expect(within(history).getByText("1 credit · 4 Jun 2026")).toBeTruthy();
    // A purchase really did cost money, so it keeps its amount.
    expect(within(history).getByText("+50 credits · ₹20,000 · 3 Jun 2026")).toBeTruthy();
  });

  it("renders no per-deck rate anywhere on the screen (§8 Q1)", async () => {
    mockFetch(view());
    const { container } = await mounted();
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/₹999/);
    expect(text).not.toMatch(/₹2,997/);
    expect(text).not.toMatch(/\/deck/);
    expect(text).not.toMatch(/per deck/i);
  });

  it("offers the prototype's three actions", async () => {
    mockFetch(view());
    await mounted();
    expect(screen.getByRole("button", { name: /Buy more credits/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Download invoice/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Upgrade plan/ })).toBeTruthy();
  });
});

describe("the billing cycle card", () => {
  it("prints the window, the renewal and the GST rule", async () => {
    mockFetch(view());
    await mounted();
    const cycle = card("Billing cycle");
    expect(within(cycle).getByText("1 Jan 2026 – 31 Dec 2026")).toBeTruthy();
    expect(within(cycle).getByText("1 Jan 2027")).toBeTruthy();
    expect(within(cycle).getByText("3 credits")).toBeTruthy();
    expect(within(cycle).getByText("18% · added at checkout")).toBeTruthy();
  });

  it("saves the billing contact through the console's Save button", async () => {
    const sent = mockFetch(view());
    await mounted();

    expect(save?.dirty).toBe(false);
    fireEvent.change(screen.getByPlaceholderText("accounts@example.com"), {
      target: { value: "finance@incubator.in" },
    });
    await waitFor(() => expect(save?.dirty).toBe(true));
    await save!.onSave();

    const put = sent.find((s) => s.method === "PUT");
    expect(put?.url).toContain("/api/billing/subscription");
    expect(put?.body.billingEmail).toBe("finance@incubator.in");
  });
});

describe("buying credits", () => {
  it("shows the GST breakdown and never a card field (§1.2)", async () => {
    mockFetch(view());
    const { container } = await mounted();
    fireEvent.click(screen.getByRole("button", { name: /Buy more credits/ }));

    const panel = card("Choose a credit pack");
    expect(within(panel).getByText("Subtotal")).toBeTruthy();
    // The pack price, on the option and again as the subtotal.
    expect(within(panel).getAllByText("₹20,000").length).toBeGreaterThan(0);
    expect(within(panel).getByText("GST (18%)")).toBeTruthy();
    expect(within(panel).getByText("₹3,600")).toBeTruthy();
    // The gross total, on the option card and again as the breakdown's Total.
    expect(within(panel).getAllByText("₹23,600").length).toBeGreaterThan(0);
    expect(within(panel).getByText(/never entered into or stored/)).toBeTruthy();

    // The rule, asserted structurally: no input on this screen could take a card.
    for (const input of Array.from(container.querySelectorAll("input"))) {
      const signature = `${input.getAttribute("name") ?? ""} ${input.getAttribute("placeholder") ?? ""} ${input.getAttribute("autocomplete") ?? ""} ${input.getAttribute("type") ?? ""}`;
      expect(signature).not.toMatch(/card|cvv|cvc|pan\b|expiry|security code/i);
    }
    expect(container.textContent ?? "").not.toMatch(/card number|cvv|cvc/i);
  });

  it("reports a recorded intent and NEVER a completed payment (§1.3)", async () => {
    const sent = mockFetch(view());
    await mounted();
    fireEvent.click(screen.getByRole("button", { name: /Buy more credits/ }));
    fireEvent.click(screen.getByRole("button", { name: /Continue to secure checkout/ }));

    expect(await screen.findByText("Purchase intent recorded")).toBeTruthy();
    expect(screen.getByText(/nothing has been charged/)).toBeTruthy();
    expect(screen.queryByText("Payment complete")).toBeNull();
    const panel = card("Purchase intent recorded");
    expect(within(panel).getByText("Credits added")).toBeTruthy();
    expect(within(panel).getByText("recorded")).toBeTruthy();

    const post = sent.find((s) => s.method === "POST");
    expect(post?.url).toContain("/api/billing/purchase");
    expect(post?.body).toEqual({ planCode: "pack_50", quantity: 1 });
    // Nothing card-shaped can even be in the request.
    expect(JSON.stringify(post?.body)).not.toMatch(/card|cvv/i);
  });

  it("prices a quantity before anything is recorded", async () => {
    const sent = mockFetch(view());
    await mounted();
    fireEvent.click(screen.getByRole("button", { name: /Buy more credits/ }));
    fireEvent.change(screen.getByLabelText(/Quantity/), {
      target: { value: "2" },
    });

    const panel = card("Choose a credit pack");
    // 2 × ₹20,000 = ₹40,000 + ₹7,200 GST.
    expect(within(panel).getByText("₹40,000")).toBeTruthy();
    expect(within(panel).getByText("₹7,200")).toBeTruthy();
    expect(within(panel).getAllByText("₹47,200").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /Continue to secure checkout/ }));
    await screen.findByText("Purchase intent recorded");
    expect(sent.find((s) => s.method === "POST")?.body.quantity).toBe(2);
  });

  it("offers plans, not packs, from Upgrade plan", async () => {
    mockFetch(view());
    await mounted();
    fireEvent.click(screen.getByRole("button", { name: /Upgrade plan/ }));
    const panel = card("Choose a plan");
    expect(within(panel).getByText("Pro")).toBeTruthy();
    expect(within(panel).queryByText("50-unit pack")).toBeNull();
  });

  it("says so when the catalogue is empty rather than offering nothing", async () => {
    mockFetch(view({ plans: [] }));
    await mounted();
    fireEvent.click(screen.getByRole("button", { name: /Buy more credits/ }));
    expect(screen.getByText(/No credit packs are published yet/)).toBeTruthy();
  });
});

describe("invoices", () => {
  it("lists each invoice with its gross total and a download link", async () => {
    mockFetch(view());
    await mounted();
    const invoices = card("Invoices & receipts");
    expect(within(invoices).getByText(/INV-2026-0001 — 50-unit pack/)).toBeTruthy();
    expect(within(invoices).getByText("₹23,600 incl. GST · 3 Jun 2026")).toBeTruthy();
    const link = within(invoices).getByRole("link", { name: "Download" });
    expect(link.getAttribute("href")).toBe("/api/billing/invoices/inv_cl_2/document");
  });
});

describe("recorded purchase requests", () => {
  it("labels a recorded intent as not charged", async () => {
    mockFetch(
      view({
        intents: [
          {
            id: "pi_1",
            purpose: "credit_pack",
            planCode: "pack_50",
            planName: "50-unit pack",
            units: 50,
            quantity: 1,
            currency: "INR",
            subtotalMinor: 2_000_000,
            taxMinor: 360_000,
            totalMinor: 2_360_000,
            ratePct: 18,
            status: "recorded",
            checkoutUrl: null,
            createdAt: "2026-09-10 10:00:00",
          },
        ],
      }),
    );
    await mounted();
    const panel = card("Recent purchase requests");
    expect(within(panel).getByText(/recorded · not charged/)).toBeTruthy();
    expect(
      within(panel).getByText(/nothing has been charged and no credits have been added/),
    ).toBeTruthy();
  });
});

describe("failure states", () => {
  it("offers a retry when the payload cannot be loaded", async () => {
    globalThis.fetch = vi.fn(async () => new Response("nope", { status: 500 })) as typeof fetch;
    mount();
    expect(await screen.findByText(/Couldn’t load your credits and billing/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
