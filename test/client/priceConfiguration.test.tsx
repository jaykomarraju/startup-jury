import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { PriceConfigurationSection } from "../../src/client/routes/admin/PriceConfiguration";
import { AdminSaveContext, type AdminSaveState } from "../../src/client/routes/admin/saveContext";
import type { PriceBook, PricePlanRow } from "../../src/shared/priceBook";

/**
 * W4-D — Admin console → Price configuration.
 *
 * What this suite holds: the prototype's four catalogues rendered from data
 * (and **without** the per-deck and Saving columns §8 Q1 retired), the draft →
 * preview → publish loop, and the two derivations the screen performs live —
 * FX conversion and the override that stops it.
 */

function plan(over: Partial<PricePlanRow> = {}): PricePlanRow {
  return {
    id: "pp_standard",
    group: "subscription",
    code: "standard",
    name: "Standard",
    badge: "No configurable params",
    tagline: null,
    features: "20 decks/mo · All 13 areas",
    units: null,
    period: "month",
    periodMonths: null,
    tier: null,
    seats: null,
    active: true,
    sortOrder: 2,
    // GBP is FX-derived (99 900 × 0.00944 = 943); USD is typed over, which is
    // what the seed itself looks like.
    amounts: { INR: 99900, USD: 1200, GBP: 943 },
    overrides: ["USD"],
    ...over,
  };
}

const GROUPS: PriceBook["groups"] = [
  {
    group: "free_trial",
    title: "Free trial",
    badge: "Always free · No card required",
    icon: "gift",
    cardName: "Free trial — 3 deck evaluations",
    cardSub: "Included with every new account.",
    cardTag: "₹0 always",
    footnote: null,
    sortOrder: 1,
  },
  {
    group: "subscription",
    title: "Individual plans",
    badge: "Monthly subscription · Per seat",
    icon: "user",
    cardName: "Standard & Pro — monthly plans",
    cardSub: "Individual subscriptions billed monthly.",
    cardTag: null,
    footnote: "GST at {gst}% added at checkout for INR billing.",
    sortOrder: 2,
  },
  {
    group: "credit_pack",
    title: "Pay-as-you-go credit packs",
    badge: "One-time purchase · Credits never expire",
    icon: "stack",
    cardName: "Credit packs — buy in bulk, save more",
    cardSub: "Minimum 10 units.",
    cardTag: null,
    footnote: null,
    sortOrder: 3,
  },
  {
    group: "enterprise",
    title: "Enterprise annual plans",
    badge: "Annual contract · Units reset yearly",
    icon: "building",
    cardName: "Enterprise — full configuration control",
    cardSub: "Annual invoice.",
    cardTag: null,
    footnote: "Enterprise invoiced annually in INR.",
    sortOrder: 4,
  },
];

function book(over: Partial<PriceBook> = {}): PriceBook {
  return {
    baseCurrency: "INR",
    currencies: [
      { code: "INR", symbol: "₹", flag: "🇮🇳", active: true, sortOrder: 1 },
      { code: "USD", symbol: "$", flag: "🇺🇸", active: true, sortOrder: 2 },
      { code: "GBP", symbol: "£", flag: "🇬🇧", active: true, sortOrder: 3 },
      { code: "AED", symbol: "د.إ", flag: "🇦🇪", active: false, sortOrder: 5 },
    ],
    fx: [
      { currency: "INR", rate: 1, source: "manual", updatedAt: "2026-06-05 09:02:00" },
      { currency: "USD", rate: 0.01199, source: "manual", updatedAt: "2026-06-05 09:02:00" },
      { currency: "GBP", rate: 0.00944, source: "manual", updatedAt: "2026-06-05 09:02:00" },
    ],
    groups: GROUPS,
    plans: [
      plan({
        id: "pp_free_trial",
        code: "free_trial",
        group: "free_trial",
        name: "Free trial",
        badge: null,
        features: null,
        period: null,
        units: 3,
        sortOrder: 1,
        amounts: { INR: 0, USD: 0, GBP: 0 },
        overrides: [],
      }),
      plan(),
      plan({
        id: "pp_pack_50",
        code: "pack_50",
        group: "credit_pack",
        name: "50-unit pack",
        badge: "Most popular",
        features: "Priority WhatsApp support",
        period: "one_time",
        units: 50,
        sortOrder: 3,
        amounts: { INR: 2000000, USD: 24000, GBP: 18900 },
        overrides: ["USD", "GBP"],
      }),
      plan({
        id: "pp_ent_100",
        code: "ent_100",
        group: "enterprise",
        name: "100 units / year",
        badge: null,
        features: "Entry Enterprise · +config access",
        period: "year",
        units: 100,
        sortOrder: 4,
        amounts: { INR: 6000000, USD: 72000, GBP: 56600 },
        overrides: ["USD", "GBP"],
      }),

      // ── V3-PT · the rows the prototype's three cards edit ──────────────────
      plan({ id: "pp_paid_trial", code: "paid_trial", group: "credit_pack", name: "Paid trial", badge: null, features: null, period: null, units: 1, sortOrder: 20, amounts: { INR: 10000, USD: 120, GBP: 94 }, overrides: [] }),
      ...(["standard", "pro", "premium"] as const).flatMap((tier, ti) =>
        ([3, 6, 12] as const).map((m, mi) =>
          plan({
            id: `pp_seat_${tier}_${m}`,
            code: `seat_${tier}_${m}`,
            group: "subscription",
            name: tier === "standard" ? "Standard" : tier === "pro" ? "Pro" : "Premium",
            badge: null,
            features: null,
            period: m === 12 ? "year" : null,
            periodMonths: m,
            tier,
            units: m === 3 ? 125 : m === 6 ? 250 : 500,
            sortOrder: 21 + ti * 3 + mi,
            // 4500/7200/11520 · 6000/9600/15360 · 8000/12800/20480, ×100.
            amounts: { INR: [[450000, 720000, 1152000], [600000, 960000, 1536000], [800000, 1280000, 2048000]][ti][mi] },
            overrides: [],
          }),
        ),
      ),
      ...([5, 10, 15] as const).map((seats, i) =>
        plan({
          id: `pp_ent_s${seats}`,
          code: `ent_s${seats}`,
          group: "enterprise",
          name: ["Family Office Plan", "Enterprise Plan", "Large Organisation Plan"][i],
          badge: null,
          features: null,
          period: "year",
          periodMonths: 12,
          seats,
          units: seats * 500,
          sortOrder: 30 + i,
          amounts: { INR: [8000000, 16000000, 24000000][i] },
          overrides: [],
        }),
      ),
    ],
    tax: {
      gstRatePct: 18,
      gstRegistration: "29ABCDE1234F1Z5",
      pricesIncludeGst: false,
      showInternationalTaxNotice: true,
    },
    trial: { decks: 3, expiryDays: 0, showOnPricingPage: true },
    ...over,
  };
}

interface Sent {
  url: string;
  method: string;
  body: Record<string, unknown>;
}

function mockFetch(over: { published?: PriceBook | null } = {}) {
  const sent: Sent[] = [];
  const draft = book();
  const published = over.published === undefined ? book() : over.published;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method !== "GET") sent.push({ url, method, body: JSON.parse(String(init?.body ?? "{}")) });
    if (method !== "GET" && url.endsWith("/publish")) {
      return new Response(JSON.stringify({ published: { ...draft, version: 2 } }), { status: 200 });
    }
    if (method !== "GET") return new Response(JSON.stringify({ draft, dirty: true }), { status: 200 });
    return new Response(
      JSON.stringify({
        draft,
        published: published ? { ...published, version: 1, publishedAt: "2026-06-05 09:02:00" } : null,
        dirty: false,
        errors: [],
        lastSavedAt: "2026-06-05 09:02:00",
        versions: [{ version: 1, status: "published", publishedAt: "2026-06-05 09:02:00", note: null }],
        previousVersion: null,
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  return sent;
}

let save: AdminSaveState | null = null;

function mount() {
  save = null;
  return render(
    <AdminSaveContext.Provider value={{ register: (s) => (save = s) }}>
      <PriceConfigurationSection />
    </AdminSaveContext.Provider>,
  );
}

/** A catalogue's table, found by the card name above it. */
function tableFor(name: string): HTMLElement {
  return screen.getByText(name).closest("section")?.querySelector("table") as HTMLElement;
}

function headers(table: HTMLElement): string[] {
  return within(table)
    .getAllByRole("columnheader")
    .map((th) => (th.textContent ?? "").replace(/\s+/g, " ").trim());
}

beforeEach(() => {
  mockFetch();
});

describe("the catalogues", () => {
  it("renders all four from data, with the prototype's copy", async () => {
    mount();
    expect(await screen.findByText("Free trial")).toBeInTheDocument();
    expect(screen.getByText("Individual plans")).toBeInTheDocument();
    expect(screen.getByText("Pay-as-you-go credit packs")).toBeInTheDocument();
    expect(screen.getByText("Enterprise annual plans")).toBeInTheDocument();
    expect(screen.getByText("Standard & Pro — monthly plans")).toBeInTheDocument();
    expect(screen.getByText("Most popular")).toBeInTheDocument();
  });

  it("has NO per-deck column and NO saving column — §8 Q1", async () => {
    mount();
    await screen.findByText("Individual plans");

    expect(headers(tableFor("Credit packs — buy in bulk, save more"))).toEqual([
      "Pack",
      "🇮🇳 INR",
      "🇺🇸 USD",
      "🇬🇧 GBP",
      "Active",
    ]);
    expect(headers(tableFor("Enterprise — full configuration control"))).toEqual([
      "Tier",
      "🇮🇳 INR/year",
      "🇺🇸 USD/year",
      "🇬🇧 GBP/year",
      "Active",
    ]);
    expect(headers(tableFor("Standard & Pro — monthly plans"))).toEqual([
      "Plan",
      "🇮🇳 INR/mo",
      "🇺🇸 USD/mo",
      "🇬🇧 GBP/mo",
      "Active",
    ]);
    // The words themselves, anywhere on the screen.
    expect(screen.queryByText(/per deck/i)).toBeNull();
    expect(screen.queryByText(/\/deck/i)).toBeNull();
    expect(screen.queryByText("Saving")).toBeNull();
    expect(screen.queryByText("Base rate")).toBeNull();
  });

  it("draws a column per ACTIVE currency, and drops one that is switched off", async () => {
    mount();
    await screen.findByText("Individual plans");
    expect(headers(tableFor("Standard & Pro — monthly plans"))).toContain("🇬🇧 GBP/mo");

    fireEvent.click(screen.getByTestId("pc-currency-GBP"));
    await waitFor(() =>
      expect(headers(tableFor("Standard & Pro — monthly plans"))).not.toContain("🇬🇧 GBP/mo"),
    );
    // The inactive chip is offered but unrated, exactly as the prototype has it.
    expect(screen.getByTestId("pc-currency-AED")).toHaveAttribute("aria-checked", "false");
  });

  it("renders the free-trial settings and the tax card the prototype specifies", async () => {
    mount();
    expect(await screen.findByTestId("pc-trial-decks")).toHaveValue(3);
    expect(screen.getByTestId("pc-trial-expiry")).toHaveValue(0);
    expect(screen.getByTestId("pc-trial-visible")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("pc-gst-rate")).toHaveValue(18);
    expect(screen.getByTestId("pc-gstin")).toHaveValue("29ABCDE1234F1Z5");
    expect(screen.getByTestId("pc-gst-inclusive")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("pc-intl-tax")).toHaveAttribute("aria-checked", "true");
  });

  it("substitutes the configured GST rate into the catalogue footnote", async () => {
    mount();
    expect(
      await screen.findByText("GST at 18% added at checkout for INR billing."),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("pc-gst-rate"), { target: { value: "12" } });
    await waitFor(() =>
      expect(screen.getByText("GST at 12% added at checkout for INR billing.")).toBeInTheDocument(),
    );
  });
});

describe("FX derivation", () => {
  it("moves a derived price when the rate changes and leaves a typed one alone", async () => {
    mount();
    await screen.findByText("Individual plans");
    // Standard's GBP is derived (99 900 × 0.00944 = £9.43); its USD is typed.
    expect(screen.getByTestId("pc-amount-standard-GBP")).toHaveValue(9.43);
    expect(screen.getByTestId("pc-amount-standard-USD")).toHaveValue(12);

    fireEvent.change(screen.getByTestId("pc-fx-GBP"), { target: { value: "0.02" } });
    await waitFor(() => expect(screen.getByTestId("pc-amount-standard-GBP")).toHaveValue(19.98));
    expect(screen.getByTestId("pc-amount-standard-USD")).toHaveValue(12);
  });

  it("re-derives every converted price when the base price changes", async () => {
    mount();
    await screen.findByText("Individual plans");
    fireEvent.change(screen.getByTestId("pc-amount-standard-INR"), { target: { value: "2000" } });
    await waitFor(() => expect(screen.getByTestId("pc-amount-standard-GBP")).toHaveValue(18.88));
  });

  it("typing in a converted column pins it, and ↺ puts it back on the rate", async () => {
    mount();
    await screen.findByText("Individual plans");
    fireEvent.change(screen.getByTestId("pc-amount-standard-GBP"), { target: { value: "11" } });
    await waitFor(() => expect(screen.getByTestId("pc-amount-standard-GBP")).toHaveValue(11));

    // Pinned: the base price moves, the typed one does not.
    fireEvent.change(screen.getByTestId("pc-amount-standard-INR"), { target: { value: "2000" } });
    await waitFor(() => expect(screen.getByTestId("pc-amount-standard-INR")).toHaveValue(2000));
    expect(screen.getByTestId("pc-amount-standard-GBP")).toHaveValue(11);

    fireEvent.click(screen.getByTestId("pc-reset-standard-GBP"));
    await waitFor(() => expect(screen.getByTestId("pc-amount-standard-GBP")).toHaveValue(18.88));
  });
});

describe("draft · preview · publish", () => {
  it("the preview reflects the unpublished draft and the live catalogue does not", async () => {
    mount();
    await screen.findByText("Individual plans");

    fireEvent.change(screen.getByTestId("pc-amount-standard-INR"), { target: { value: "1299" } });
    fireEvent.click(screen.getByTestId("pc-preview-toggle"));

    const draftColumn = await screen.findByTestId("pc-preview-draft");
    const liveColumn = screen.getByTestId("pc-preview-live");
    await waitFor(() =>
      expect(within(draftColumn).getByTestId("pc-preview-draft-standard")).toHaveTextContent("₹1,299"),
    );
    // The published catalogue is untouched by an unsaved edit — the whole point.
    expect(within(liveColumn).getByTestId("pc-preview-live-standard")).toHaveTextContent("₹999");
    expect(screen.getByTestId("pc-preview-dirty")).toBeInTheDocument();
  });

  it("shows GST beside a price in the preview, at the configured rate", async () => {
    mount();
    fireEvent.click(await screen.findByTestId("pc-preview-toggle"));
    const draftColumn = await screen.findByTestId("pc-preview-draft");
    expect(within(draftColumn).getByTestId("pc-preview-draft-standard")).toHaveTextContent(
      "+ ₹179.82 GST",
    );
  });

  it("hides the free trial from the preview when its switch is off", async () => {
    mount();
    await screen.findByText("Free trial");
    fireEvent.click(screen.getByTestId("pc-preview-toggle"));
    expect(await screen.findByTestId("pc-preview-draft-free_trial")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("pc-trial-visible"));
    await waitFor(() => expect(screen.queryByTestId("pc-preview-draft-free_trial")).toBeNull());
  });

  it("refuses to publish an unsaved draft, and says why", async () => {
    mount();
    await screen.findByText("Individual plans");
    expect(screen.getByTestId("pc-publish")).not.toBeDisabled();

    fireEvent.change(screen.getByTestId("pc-amount-standard-INR"), { target: { value: "1299" } });
    await waitFor(() => expect(screen.getByTestId("pc-publish")).toBeDisabled());
    expect(screen.getByTestId("pc-publish")).toHaveAttribute(
      "title",
      "Save your changes before publishing them.",
    );
  });

  it("hands the console's Save button a dirty draft, and PUTs what changed", async () => {
    const sent = mockFetch();
    mount();
    await screen.findByText("Individual plans");
    expect(save?.dirty).toBe(false);

    fireEvent.change(screen.getByTestId("pc-amount-standard-INR"), { target: { value: "1299" } });
    await waitFor(() => expect(save?.dirty).toBe(true));

    await save?.onSave();
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ url: "/api/pricing/draft", method: "PUT" });
    const plans = sent[0].body.plans as { id: string; amounts: Record<string, number> }[];
    expect(plans.find((p) => p.id === "pp_standard")?.amounts.INR).toBe(129900);
  });

  it("publishes, and reports the version it published", async () => {
    const sent = mockFetch();
    mount();
    await screen.findByText("Individual plans");
    fireEvent.click(screen.getByTestId("pc-publish"));

    await waitFor(() => expect(screen.getByTestId("pc-notice")).toHaveTextContent("version 2"));
    expect(sent.some((s) => s.url === "/api/pricing/publish" && s.method === "POST")).toBe(true);
  });

  it("says so when nothing is published yet", async () => {
    mockFetch({ published: null });
    mount();
    expect(await screen.findByTestId("pc-live-version")).toHaveTextContent("Nothing published yet");
  });

  it("shows the draft's last-saved stamp as a wall clock", async () => {
    mount();
    expect(await screen.findByTestId("pc-last-saved")).toHaveTextContent("Saved 5 Jun 2026, 9:02 am");
  });
});

describe("adding a currency", () => {
  it("asks for a rate, because a column without one would publish as zero", async () => {
    mount();
    fireEvent.click(await screen.findByTestId("pc-add-currency"));

    fireEvent.change(screen.getByTestId("pc-new-currency-code"), { target: { value: "SGD" } });
    fireEvent.change(screen.getByTestId("pc-new-currency-symbol"), { target: { value: "S$" } });
    expect(screen.getByTestId("pc-new-currency-add")).toBeDisabled();

    fireEvent.change(screen.getByTestId("pc-new-currency-rate"), { target: { value: "0.0155" } });
    expect(screen.getByTestId("pc-new-currency-add")).not.toBeDisabled();

    fireEvent.click(screen.getByTestId("pc-new-currency-add"));
    await waitFor(() =>
      expect(headers(tableFor("Standard & Pro — monthly plans"))).toContain("🏳 SGD/mo"),
    );
    // Priced from the base at the rate just entered: 99 900 × 0.0155 = S$15.48.
    expect(screen.getByTestId("pc-amount-standard-SGD")).toHaveValue(15.48);
  });
});

// ── V3-PT · item 15, the prototype's three cards ─────────────────────────────

/**
 * v3 rebuilt `s-pc` from a 235-byte iframe around a 37 KB base64 document into
 * a 2 KB inline section: `Paid trial`, `Individual plans — ₹ per period`,
 * `Enterprise plans — ₹ annual`, and one `Save & apply to My Account`.
 *
 * Every literal below is copied from the decoded prototype rather than imported
 * from the component, so renaming a heading fails here.
 */
describe("the seat-pricing cards", () => {
  function cardTable(testId: string): HTMLElement {
    return within(screen.getByTestId(testId)).getByRole("table");
  }

  it("draws the three cards, in the prototype's order and with its column headers", async () => {
    mount();
    await screen.findByTestId("pc-individual-plans");

    expect(screen.getByTestId("pc-paid-trial")).toHaveTextContent("Paid trial");
    expect(screen.getByTestId("pc-paid-trial")).toHaveTextContent("Per-deck rate (₹)");
    expect(screen.getByTestId("pc-individual-plans")).toHaveTextContent("Individual plans — ₹ per period");
    expect(screen.getByTestId("pc-enterprise-plans")).toHaveTextContent("Enterprise plans — ₹ annual");

    expect(headers(cardTable("pc-individual-plans"))).toEqual([
      "Seat",
      "Quarterly",
      "Half-yearly",
      "Annual",
    ]);
    expect(headers(cardTable("pc-enterprise-plans"))).toEqual(["Plan", "Seats", "Annual price"]);

    // The three cards come before everything the v3 section does not have.
    const order = Array.from(document.querySelectorAll("[data-testid]"))
      .map((e) => e.getAttribute("testid") ?? e.getAttribute("data-testid"))
      .filter((id): id is string =>
        ["pc-paid-trial", "pc-individual-plans", "pc-enterprise-plans", "pc-apply", "pc-beyond-prototype"].includes(
          id ?? "",
        ),
      );
    expect(order).toEqual([
      "pc-paid-trial",
      "pc-individual-plans",
      "pc-enterprise-plans",
      "pc-apply",
      "pc-beyond-prototype",
    ]);
  });

  it("shows every one of the thirteen prices in WHOLE rupees, as the prototype's inputs do", async () => {
    mount();
    await screen.findByTestId("pc-individual-plans");
    expect(screen.getByTestId("pc-paid-rate")).toHaveValue(100);
    // 3 tiers × 3 periods, `PRICING_ADMIN.ind` verbatim.
    expect(screen.getByTestId("pc-seat-standard-3")).toHaveValue(4500);
    expect(screen.getByTestId("pc-seat-standard-6")).toHaveValue(7200);
    expect(screen.getByTestId("pc-seat-standard-12")).toHaveValue(11520);
    expect(screen.getByTestId("pc-seat-pro-3")).toHaveValue(6000);
    expect(screen.getByTestId("pc-seat-pro-6")).toHaveValue(9600);
    expect(screen.getByTestId("pc-seat-pro-12")).toHaveValue(15360);
    expect(screen.getByTestId("pc-seat-premium-3")).toHaveValue(8000);
    expect(screen.getByTestId("pc-seat-premium-6")).toHaveValue(12800);
    expect(screen.getByTestId("pc-seat-premium-12")).toHaveValue(20480);
    // `PRICING_ADMIN.ent`, with the seat count as a read-only column.
    expect(screen.getByTestId("pc-ent-5")).toHaveValue(80000);
    expect(screen.getByTestId("pc-ent-10")).toHaveValue(160000);
    expect(screen.getByTestId("pc-ent-15")).toHaveValue(240000);
    const rows = within(cardTable("pc-enterprise-plans")).getAllByRole("row").slice(1);
    expect(
      rows.map((r) =>
        within(r)
          .getAllByRole("cell")
          .slice(0, 2)
          .map((c) => c.textContent),
      ),
    ).toEqual([
      ["Family Office Plan", "5"],
      ["Enterprise Plan", "10"],
      ["Large Organisation Plan", "15"],
    ]);
  });

  it("an edited price is SAVED and then PUBLISHED by one click — a draft is invisible to My Account", async () => {
    const sent = mockFetch();
    mount();
    await screen.findByTestId("pc-individual-plans");

    fireEvent.change(screen.getByTestId("pc-seat-pro-12"), { target: { value: "17000" } });
    fireEvent.change(screen.getByTestId("pc-paid-rate"), { target: { value: "125" } });
    fireEvent.click(screen.getByTestId("pc-apply"));

    await waitFor(() => expect(sent.filter((c) => c.url.endsWith("/publish"))).toHaveLength(1));
    const draft = sent.find((c) => c.url.endsWith("/draft"));
    const plans = draft?.body.plans as { id: string; amounts: Record<string, number> }[];
    // Whole rupees in, minor units out.
    expect(plans.find((p) => p.id === "pp_seat_pro_12")?.amounts.INR).toBe(1700000);
    expect(plans.find((p) => p.id === "pp_paid_trial")?.amounts.INR).toBe(12500);
    // The draft goes first: publishing an unsaved draft would publish the old prices.
    expect(sent.map((c) => c.url.replace(/^.*\/api\/pricing/, ""))).toEqual(["/draft", "/publish"]);
    expect(await screen.findByTestId("pc-notice")).toHaveTextContent("Saved — applied to My Account");
  });

  it("does not publish when the save is refused", async () => {
    const sent: { url: string; method: string }[] = [];
    const draft = book();
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method !== "GET") {
        sent.push({ url, method });
        return new Response(JSON.stringify({ errors: ["A price is not a whole number."] }), { status: 400 });
      }
      return new Response(
        JSON.stringify({
          draft,
          published: null,
          dirty: false,
          errors: [],
          lastSavedAt: null,
          versions: [],
          previousVersion: null,
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    mount();
    await screen.findByTestId("pc-individual-plans");
    fireEvent.change(screen.getByTestId("pc-ent-10"), { target: { value: "170000" } });
    fireEvent.click(screen.getByTestId("pc-apply"));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].url).toContain("/draft");
    expect(sent.some((c) => c.url.endsWith("/publish"))).toBe(false);
    expect(await screen.findByText("A price is not a whole number.")).toBeInTheDocument();
  });

  it("a catalogue with no seat rows says so rather than drawing empty inputs", async () => {
    const bare = book();
    bare.plans = bare.plans.filter((p) => p.tier === null && p.seats === null && p.code !== "paid_trial");
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          draft: bare,
          published: null,
          dirty: false,
          errors: [],
          lastSavedAt: null,
          versions: [],
          previousVersion: null,
        }),
        { status: 200 },
      ),
    ) as typeof fetch;
    mount();
    await screen.findByTestId("pc-individual-plans");
    expect(screen.getByTestId("pc-paid-trial")).toHaveTextContent("No paid-trial rate is in the catalogue.");
    expect(within(cardTable("pc-individual-plans")).queryAllByRole("row")).toHaveLength(1);
    expect(within(cardTable("pc-enterprise-plans")).queryAllByRole("row")).toHaveLength(1);
  });
});
