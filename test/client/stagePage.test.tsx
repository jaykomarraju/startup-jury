import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, within, configure } from "@testing-library/react";
import {
  StagePage,
  SignupPaneBody,
  INCUBATOR_STAGE_CONFIG,
  VC_STAGE_CONFIG,
  type StageConfig,
} from "../../src/client/routes/StagePage";
import type { SignupSummary } from "../../src/client/routes/SignupWorkspace";
import type { DeckView } from "../../src/client/types";

/**
 * W7-F — the stage screen's config extension, and the two `W5-A` consumers.
 *
 *  • A stage that DECLARES `toolbar`, `subTabs`, `legend` and `footer` gets the
 *    Filter menu, Export, the slide-over with its tabs and the pinned legend.
 *  • A stage that declares NONE of them gets none of them — the half that stops
 *    the extension leaking into every screen that shares the renderer.
 *  • The incubator screens' exact header sets, from their real configs.
 *  • Documents status is a read-only roll-up; the seat card draws both states.
 *
 * Every assertion is gated on a POPULATED row, never on the toolbar title — the
 * title renders before the deck list resolves.
 */

configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 30_000 });

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function deck(over: Partial<DeckView>): DeckView {
  return {
    id: "d1",
    name: "GreenRoute",
    sector: "Climatetech",
    stage: "Pre-seed",
    city: "Hyderabad",
    aiScore: 8.6,
    juryScore: 7.4,
    decisionScore: 8.0,
    statusId: "shortlisted",
    status: "Shortlisted",
    actions: [],
    ...over,
  };
}

function signup(over: Partial<SignupSummary>): SignupSummary {
  return {
    signupId: "su1",
    deckId: "d1",
    startup: "GreenRoute",
    status: "progress",
    deckStatus: "signup",
    founderSigned: false,
    documentsStatus: "partial",
    verifiable: 1,
    seatless: false,
    seated: false,
    assignedName: null,
    readOnly: false,
    ...over,
  };
}

const EXTRACTION = [{ label: "Cover", heading: "GreenRoute", text: "EV logistics for last-mile fleets." }];
const SCORES = [
  { key: "p1", label: "Problem clarity", value: 8.2, weight: 10 },
  { key: "p2", label: "Traction & Validation", value: 5.5, weight: 30 },
];

function mockApi(decks: DeckView[], signups: SignupSummary[] = []) {
  const calls: { url: string; method: string }[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    let body: unknown = {};
    if (url === "/api/decks" || url.startsWith("/api/decks?")) body = { decks };
    else if (url.startsWith("/api/signups")) body = { signups };
    // Wave 7 integration: `/api/decks/:id/report` is `W7-D`'s stage-aware
    // endpoint and it ALSO starts with "/api/decks/", so the catch-all below
    // was answering it with a deck payload. The drawer then read `report.core`
    // off an object that has none. Answer it as itself.
    else if (/^\/api\/decks\/[^/]+\/report/.test(url)) {
      body = { core: [], additional: [] };
    } else if (url.startsWith("/api/decks/")) {
      body = { deck: decks[0], scores: SCORES, extraction: EXTRACTION, versions: [] };
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return calls;
}

const headers = (table: HTMLElement) =>
  within(table)
    .getAllByRole("columnheader")
    .map((th) => th.textContent);

// ═══════════════════════════════════════════════════════════════════════════

const DECLARED: StageConfig = {
  title: "Declared stage",
  subtitle: "Every extension point",
  statuses: ["shortlisted", "rejected"],
  columns: ["startup", "ai", "status"],
  toolbar: {
    filters: [
      { id: "shortlisted", label: "Shortlisted", match: (r) => r.deck.statusId === "shortlisted" },
      { id: "rejected", label: "Rejected", match: (r) => r.deck.statusId === "rejected" },
    ],
    export: true,
  },
  subTabs: ["deck", "scores"],
  legend: [
    { label: "Shortlisted", color: "var(--green)", statuses: ["shortlisted"] },
    { label: "Rejected", color: "var(--red)", statuses: ["rejected"] },
  ],
  footer: (rows) => `${rows.length} decks in this stage`,
};

const BARE: StageConfig = {
  title: "Bare stage",
  subtitle: "No extension points",
  statuses: ["shortlisted", "rejected"],
  columns: ["startup", "ai", "status"],
};

const TWO = [
  deck({ id: "d1", name: "GreenRoute", statusId: "shortlisted", status: "Shortlisted" }),
  deck({ id: "d2", name: "PayRoute", statusId: "rejected", status: "Rejected" }),
];

describe("a stage that declares the extension", () => {
  it("draws Filter, Export, the pinned legend and the footer sentence", async () => {
    mockApi(TWO);
    render(<StagePage config={DECLARED} />);
    await screen.findByRole("row", { name: /PayRoute/ });

    expect(screen.getByRole("button", { name: "Filter" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
    const legend = screen.getByTestId("stage-legend");
    expect(within(legend).getByText("Shortlisted")).toBeInTheDocument();
    expect(within(legend).getByText("Rejected")).toBeInTheDocument();
    expect(screen.getByTestId("stage-footer-stat")).toHaveTextContent("2 decks in this stage");
  });

  it("filters the table from the toolbar and says so on the button, while the footer still counts the stage", async () => {
    mockApi(TWO);
    render(<StagePage config={DECLARED} />);
    await screen.findByRole("row", { name: /PayRoute/ });

    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Rejected" }));

    expect(screen.queryByRole("row", { name: /GreenRoute/ })).not.toBeInTheDocument();
    expect(screen.getByRole("row", { name: /PayRoute/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter · Rejected" })).toBeInTheDocument();
    expect(screen.getByTestId("stage-footer-stat")).toHaveTextContent("2 decks in this stage");

    fireEvent.click(screen.getByRole("button", { name: "Filter · Rejected" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "All" }));
    expect(screen.getByRole("row", { name: /GreenRoute/ })).toBeInTheDocument();
  });

  it("opens the slide-over with exactly the declared tabs, beside the table rather than over it", async () => {
    mockApi(TWO);
    render(<StagePage config={DECLARED} />);
    fireEvent.click(await screen.findByRole("button", { name: "GreenRoute" }));

    const pane = screen.getByRole("complementary", { name: "GreenRoute detail" });
    const tabs = within(pane).getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["Deck", "All scores"]);
    expect(within(pane).getByRole("tab", { name: "Deck" })).toHaveAttribute("aria-selected", "true");
    expect(await within(pane).findByText("EV logistics for last-mile fleets.")).toBeInTheDocument();
    // Not the overlay drawer: no dialog opened, and the table is still there.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("row", { name: /PayRoute/ })).toBeInTheDocument();

    fireEvent.click(within(pane).getByRole("tab", { name: "All scores" }));
    const scores = await within(pane).findByTestId("pane-scores");
    expect(within(scores).getByText("Traction & Validation")).toBeInTheDocument();
    expect(within(scores).getByText("AI composite")).toBeInTheDocument();
    // Weight is each parameter's share of the whole.
    expect(within(scores).getByText("Weight 75%")).toBeInTheDocument();
  });

  it("tints each status pill with the legend entry that decodes it", async () => {
    mockApi(TWO);
    render(<StagePage config={DECLARED} />);
    const row = await screen.findByRole("row", { name: /PayRoute/ });
    expect(within(row).getByText("Rejected")).toHaveStyle({ color: "var(--red)" });
  });
});

describe("a stage that declares none of it", () => {
  it("draws no Filter, no Export, no legend, no footer — and no tabs", async () => {
    mockApi(TWO);
    render(<StagePage config={BARE} />);
    await screen.findByRole("row", { name: /PayRoute/ });

    expect(screen.queryByRole("button", { name: /^Filter/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("stage-legend")).not.toBeInTheDocument();
    expect(screen.queryByTestId("stage-footer")).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("opens the Evaluation drawer from the startup name, not a slide-over", async () => {
    mockApi(TWO);
    render(<StagePage config={BARE} />);
    fireEvent.click(await screen.findByRole("button", { name: "GreenRoute" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByTestId("stage-pane")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });

  it("every VC stage screen is declared — Wave 9 left none at the bare Export default", () => {
    // This once asserted the opposite: that the VC screens stayed bare "until
    // Wave 9 declares it". Wave 9 declared all seven — W9-B's two pipelines
    // (test/client/vcPipelines.test.tsx) and W9-C's five diligence-to-archive
    // screens (test/client/vcDiligence.test.tsx) — so the old filter would now
    // loop over nothing and assert nothing. Inverted to the invariant that
    // actually holds, which fails if a config is reverted to the default.
    expect(Object.keys(VC_STAGE_CONFIG).length).toBe(7);
    for (const [slug, cfg] of Object.entries(VC_STAGE_CONFIG)) {
      expect(cfg.toolbar, slug).not.toEqual({ export: true });
      expect(cfg.footer, slug).toBeTypeOf("function");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════

describe("the incubator stage screens, from their real configs", () => {
  it("Jury Pipeline — the prototype's nine headers, and its footer sentence", async () => {
    mockApi([
      deck({ id: "d1", name: "GreenRoute", statusId: "shortlisted" }),
      deck({ id: "d2", name: "AgroFresh", statusId: "jury_evaluation", status: "Jury Evaluation" }),
      deck({ id: "d3", name: "PayRoute", statusId: "rejected", status: "Rejected", exitAction: "reject" }),
    ]);
    render(<StagePage config={INCUBATOR_STAGE_CONFIG.jurypipeline} />);
    await screen.findByRole("row", { name: /AgroFresh/ });

    expect(headers(screen.getByRole("table"))).toEqual([
      "Startup",
      "Jury members & status",
      "AI score",
      "Jury score",
      "Avg. score",
      "Addl. Parameter scores",
      "Assigned date",
      "Status",
      "Action",
    ]);
    expect(screen.getByTestId("stage-footer-stat")).toHaveTextContent(
      "3 decks · 1 shortlisted · 1 rejected · 1 in progress",
    );
    expect(within(screen.getByTestId("stage-legend")).getAllByText(/./).map((n) => n.textContent)).toEqual([
      "Assigned",
      "Shortlisted",
      "Rejected",
      "Pending",
    ]);
  });

  it("Prog manager pipeline — panel-forsignup's columns, and only the jury's rejections", async () => {
    mockApi([
      deck({ id: "d1", name: "GreenRoute", statusId: "shortlisted" }),
      deck({ id: "d2", name: "PayRoute", statusId: "rejected", exitAction: "reject" }),
      deck({ id: "d3", name: "GateReject", statusId: "rejected", exitAction: "reject_ai_gate" }),
      deck({ id: "d4", name: "StillScoring", statusId: "jury_evaluation" }),
    ]);
    render(<StagePage config={INCUBATOR_STAGE_CONFIG.pmpipeline} />);
    await screen.findByRole("row", { name: /PayRoute/ });

    expect(headers(screen.getByRole("table"))).toEqual([
      "Startup",
      "AI score",
      "Jury score",
      "Avg. score",
      "Addl. Parameter scores",
      "Call scheduled",
      "Call date",
      "Call completed",
      "Sign-up status",
      "Action",
    ]);
    expect(screen.queryByRole("row", { name: /GateReject/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /StillScoring/ })).not.toBeInTheDocument();
  });

  it("Sign up Pipeline — Call completed is back between Call date and Sign-up status", async () => {
    mockApi([deck({ id: "d1", name: "LedgerLite", statusId: "signup", status: "Signup" })], [signup({ deckId: "d1" })]);
    render(<StagePage config={INCUBATOR_STAGE_CONFIG.incuration} />);
    await screen.findByRole("row", { name: /LedgerLite/ });

    expect(headers(screen.getByRole("table"))).toEqual([
      "Startup",
      "AI score",
      "Jury score",
      "Avg. score",
      "Addl. Parameter scores",
      "Call scheduled",
      "Call date",
      "Call completed",
      "Sign-up status",
      "Payment status",
      "Documents status",
      "Action",
    ]);
    expect(screen.getByTestId("stage-footer-stat")).toHaveTextContent(
      "1 startup in curation · 0 fully paid · 0 with all documents",
    );
  });

  it("every incubator stage screen declares Filter + Export (the prototype draws both on each)", () => {
    for (const [slug, cfg] of Object.entries(INCUBATOR_STAGE_CONFIG)) {
      expect(cfg.toolbar?.export, slug).toBe(true);
      expect(cfg.toolbar?.filters?.length, slug).toBeGreaterThan(0);
      expect(cfg.footer, slug).toBeTypeOf("function");
    }
  });
});

describe("the W5-A consumers", () => {
  it("Documents status is a read-only roll-up badge that opens the set — never a select", async () => {
    mockApi(
      [deck({ id: "d1", name: "LedgerLite", statusId: "signup", status: "Signup", documentsStatus: "complete" })],
      [signup({ deckId: "d1", documentsStatus: "partial" })],
    );
    render(<StagePage config={INCUBATOR_STAGE_CONFIG.incuration} />);
    const row = await screen.findByRole("row", { name: /LedgerLite/ });

    // The roll-up comes from the sign-up record, not the stale deck column.
    const badge = within(row).getByRole("button", { name: "Documents status for LedgerLite: Docs partial" });
    expect(badge).toBeInTheDocument();
    expect(within(row).queryByRole("combobox", { name: /Documents status/ })).not.toBeInTheDocument();
    // Payment IS still hand-set (issue 29): the absence above is specific, not a table with no selects.
    expect(within(row).getByRole("combobox", { name: "Payment status for LedgerLite" })).toBeInTheDocument();
  });

  it("no screen that reads sign-up records offers the unguarded Complete signup", async () => {
    const complete = { action: "complete_signup", label: "Complete signup", to: "onboard_ready" };
    mockApi(
      [deck({ id: "d1", name: "LedgerLite", statusId: "signup", status: "Signup", actions: [complete] })],
      [signup({ deckId: "d1" })],
    );
    render(<StagePage config={INCUBATOR_STAGE_CONFIG.pmpipeline} />);
    const row = await screen.findByRole("row", { name: /LedgerLite/ });
    expect(within(row).getByText("Sign-up in progress")).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Complete signup" })).not.toBeInTheDocument();
  });

  it("the Sign-up tab draws the red Seatless card with Allocate seat, and allocates through the pipeline's verb", async () => {
    const calls = mockApi(
      [deck({ id: "d1", name: "LedgerLite", statusId: "signup", status: "Signup" })],
      [signup({ deckId: "d1", status: "completed", seatless: true, seated: false })],
    );
    render(<StagePage config={INCUBATOR_STAGE_CONFIG.incuration} />);
    fireEvent.click(await screen.findByRole("button", { name: "LedgerLite" }));
    const pane = screen.getByRole("complementary", { name: "LedgerLite detail" });
    fireEvent.click(within(pane).getByRole("tab", { name: "Sign-up" }));

    const card = await within(pane).findByTestId("pane-seatless");
    expect(card).toHaveTextContent("Seatless — no cohort seat allocated yet");
    fireEvent.click(within(card).getByRole("button", { name: "Allocate seat" }));
    await vi.waitFor(() =>
      expect(calls.some((c) => c.url === "/api/signups/su1/seat" && c.method === "POST")).toBe(true),
    );
  });

  it("the seat card turns green once seated, and is absent before sign-up completes", () => {
    const { rerender } = render(
      <SignupPaneBody
        row={{ deck: deck({}), signup: signup({ status: "onboarded", seated: true }) }}
        busy={false}
        onOpenWorkspace={() => {}}
        onAllocate={() => {}}
      />,
    );
    expect(screen.getByTestId("pane-seat-allocated")).toHaveTextContent("Seat allocated · founder access provisioned");
    expect(screen.queryByTestId("pane-seatless")).not.toBeInTheDocument();

    rerender(
      <SignupPaneBody
        row={{ deck: deck({}), signup: signup({ status: "progress", seatless: false, seated: false }) }}
        busy={false}
        onOpenWorkspace={() => {}}
        onAllocate={() => {}}
      />,
    );
    expect(screen.queryByTestId("pane-seat-allocated")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pane-seatless")).not.toBeInTheDocument();
  });
});
