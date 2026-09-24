import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, within, configure } from "@testing-library/react";
import {
  StagePage,
  SignupPaneBody,
  INCUBATOR_STAGE_CONFIG,
  VC_STAGE_CONFIG,
  type StageConfig,
} from "../../src/client/routes/StagePage";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthContext, type AuthContextValue } from "../../src/client/auth/AuthProvider";
import type { SignupSummary } from "../../src/client/routes/SignupWorkspace";
import type { DeckView } from "../../src/client/types";
import type { Role } from "../../src/shared/roles";

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
  // The BASE config, rendered with no AuthContext, so no `roleVariants` entry
  // applies. Since R4-JP that shape is the JURY's alone — the three staff roles
  // get `JURY_PIPELINE_V3`, asserted in the V3 block at the bottom of this file.
  it("Jury Pipeline — the base config's nine headers (the jury's shape), and its footer sentence", async () => {
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

// ═══════════════════════════════════════════════════════════════════════════

/**
 * V3 item 2 — Jury Pipeline, the three STAFF roles.
 *
 * `AISJ_SuperuserV3` `panel-jurypipeline` deletes `<th>Status</th>`, collapses
 * `jpRender`'s juror pills to Evaluated / Pending, and drops the Action select
 * from five options to two.
 *
 * R4-JP widened it from the superuser to the admin and the program manager
 * (`docs/plan_roles_incubator.md` §2 row `11 · V3-JP`, footnote ʳ): both reach
 * the slug and both drew the same v15 shape, so the repeat the client reported
 * — the row Status pill restating the per-juror `jp-jstat` pills — was on their
 * screens identically. Each shape test therefore runs for all three.
 *
 * The JURY is the negative control, and it is a deliberate one (§2 ˢ, §5 item
 * 7): `AISJ_IC_Jury_V4` declares BOTH a Status and an Action column and a
 * four-option select, and their table has no per-juror pill column, so the
 * repeat does not exist there and the column is one they need. The last test
 * asserts they still get the v15 screen whole.
 *
 * Every assertion is gated on a POPULATED row, never on the toolbar title.
 */
describe("V3 · Jury Pipeline is redrawn for the three staff roles, and not for the jury", () => {
  /** The roles `roleVariants` now carries — superuser since V3-JP, the other two since R4-JP. */
  const STAFF = ["superuser", "admin", "program_manager"] as const;

  /** A deck under jury evaluation: staff may shortlist or reject it. */
  const underJury = (over: Partial<DeckView> = {}) =>
    deck({
      id: "d-jury",
      name: "InsureFlow",
      statusId: "jury_evaluation",
      status: "Jury Evaluation",
      assignedToName: "Rajesh Kumar",
      assigneeSubmitted: true,
      actions: [
        { action: "shortlist", label: "Shortlist", to: "shortlisted" },
        { action: "reject", label: "Reject", to: "rejected" },
      ],
      ...over,
    });

  /** A deck still at Assigned: the stage Assign can still act on. */
  const assigned = (over: Partial<DeckView> = {}) =>
    deck({
      id: "d-assigned",
      name: "TaxPilot",
      statusId: "assigned",
      status: "Assigned",
      assignedToName: "Rajesh Kumar",
      assigneeSubmitted: false,
      actions: [{ action: "start_jury_eval", label: "Begin jury evaluation", to: "jury_evaluation" }],
      ...over,
    });

  function renderAs(role: Role) {
    const auth: AuthContextValue = {
      user: { id: "u1", name: "Priya Sharma", initials: "PS", role, edition: "incubator" },
      loading: false,
      login: () => Promise.reject(new Error("not used in these tests")),
      logout: () => Promise.resolve(),
      updateUser: () => {},
    };
    return render(
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={["/app/jurypipeline"]}>
          <Routes>
            <Route path="/app/jurypipeline" element={<StagePage config={INCUBATOR_STAGE_CONFIG.jurypipeline} />} />
            <Route path="/app/assign" element={<div>Assign screen</div>} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );
  }

  const optionsOf = (row: HTMLElement) =>
    within(row)
      .getAllByRole("option")
      .map((o) => o.textContent);

  it.each(STAFF)(
    "%s drops the Status column — the prototype's eight headers, Status absent",
    async (role) => {
      mockApi([underJury(), assigned()]);
      renderAs(role);
      await screen.findByRole("row", { name: /InsureFlow/ });

      expect(headers(screen.getByRole("table"))).toEqual([
        "Startup",
        "Jury members & status",
        "AI score",
        "Jury score",
        "Avg. score",
        "Addl. Parameter scores",
        "Assigned date",
        "Action",
      ]);
      expect(screen.queryByRole("columnheader", { name: "Status" })).not.toBeInTheDocument();
    },
  );

  it.each(STAFF)("%s — the juror pill reads Evaluated / Pending, not Submitted", async (role) => {
    mockApi([underJury(), assigned()]);
    renderAs(role);
    await screen.findByRole("row", { name: /InsureFlow/ });

    expect(within(screen.getByRole("row", { name: /InsureFlow/ })).getByText("Evaluated")).toBeInTheDocument();
    expect(within(screen.getByRole("row", { name: /TaxPilot/ })).getByText("Pending")).toBeInTheDocument();
    expect(screen.queryByText("Submitted")).not.toBeInTheDocument();
  });

  it.each(STAFF)(
    "%s — the Action select offers exactly two options, and none of the three v15 deleted",
    async (role) => {
      mockApi([underJury(), assigned()]);
      renderAs(role);
      await screen.findByRole("row", { name: /InsureFlow/ });

      // `jpToIntroCalls` → the `shortlist` transition, which is what puts a deck
      // on the Intro calls screen (`INCUBATOR_CALLS_CONFIG.introcalls`).
      expect(optionsOf(screen.getByRole("row", { name: /InsureFlow/ }))).toEqual([
        "Action ▾",
        "Send to intro calls",
      ]);
      // `addToAssign` + `showPanel('assign')`, offered from an ASSIGNABLE_STAGES stage.
      expect(optionsOf(screen.getByRole("row", { name: /TaxPilot/ }))).toEqual([
        "Action ▾",
        "Reassign / add jury",
      ]);

      // The three v15 options v3 deletes, plus the transition label the prototype
      // never had — none of them anywhere on the screen.
      for (const gone of ["View deck", "Shortlist", "Reject", "Begin jury evaluation"]) {
        expect(screen.queryByRole("option", { name: gone })).not.toBeInTheDocument();
      }
    },
  );

  it.each(STAFF)("%s — Send to intro calls posts `shortlist`, and the cell becomes the flow tag", async (role) => {
    const live = [underJury()];
    const posted: { url: string; body: unknown }[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if ((init?.method ?? "GET") === "POST") {
        posted.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
        // The server moves the deck on; the reload that follows sees it there.
        live[0] = underJury({ statusId: "shortlisted", status: "Shortlisted", actions: [] });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      const body =
        url === "/api/decks" || url.startsWith("/api/decks?") ? { decks: live } : {};
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    renderAs(role);
    const row = await screen.findByRole("row", { name: /InsureFlow/ });
    fireEvent.change(within(row).getByRole("combobox"), { target: { value: "shortlist" } });

    await screen.findByText("Sent to intro calls");
    expect(posted).toEqual([{ url: "/api/decks/d-jury/transition", body: { action: "shortlist" } }]);
    // A decided row offers nothing further — the select is gone with it.
    expect(within(screen.getByRole("row", { name: /InsureFlow/ })).queryByRole("combobox")).toBeNull();
  });

  it.each(STAFF)("%s — Reassign / add jury navigates to Assign and moves nothing", async (role) => {
    const calls = mockApi([assigned()]);
    renderAs(role);
    const row = await screen.findByRole("row", { name: /TaxPilot/ });
    fireEvent.change(within(row).getByRole("combobox"), { target: { value: "__reassign" } });

    // `addToAssign` + `showPanel('assign')`: the deck is already assignable, so
    // the screen change IS the whole action — no transition is posted.
    await screen.findByText("Assign screen");
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);
  });

  it.each(STAFF)(
    "%s — a rejected deck still reads as decided, and the footer keeps its sentence while the legend goes",
    async (role) => {
      mockApi([
        underJury(),
        deck({ id: "d-sl", name: "GreenRoute", statusId: "shortlisted", status: "Shortlisted", actions: [] }),
        deck({ id: "d-rj", name: "CreditBridge", statusId: "rejected", status: "Rejected", actions: [] }),
      ]);
      renderAs(role);
      await screen.findByRole("row", { name: /CreditBridge/ });

      expect(within(screen.getByRole("row", { name: /GreenRoute/ })).getByText("Sent to intro calls")).toBeInTheDocument();
      expect(within(screen.getByRole("row", { name: /CreditBridge/ })).getByText("Rejected")).toBeInTheDocument();
      // `jpFoot` is byte-identical in v3 — it counts rows in the stage, which the
      // deleted column never provided.
      expect(screen.getByTestId("stage-footer-stat")).toHaveTextContent(
        "3 decks · 1 shortlisted · 1 rejected · 1 in progress",
      );
      // …but the colour key for a pill that no longer exists does not survive.
      expect(screen.queryByTestId("stage-legend")).not.toBeInTheDocument();
    },
  );

  // ── The negative control ──────────────────────────────────────────────────
  //
  // Not "the role we ran out of time for" — the role whose own prototype says
  // no. `AISJ_IC_Jury_V4`'s `panel-jurypipeline` declares twelve `<th>`,
  // Status and Action among them, and `jpRender` emits View deck · Submit ·
  // Save draft · Re-assign. §5 item 7: do not extend V3-JP to the jury.
  it("the jury still draws the v15 screen — nine headers, Status, and the legend", async () => {
    mockApi([underJury(), assigned()]);
    renderAs("jury");
    await screen.findByRole("row", { name: /InsureFlow/ });

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
    expect(within(screen.getByTestId("stage-legend")).getAllByText(/./).map((n) => n.textContent)).toEqual([
      "Assigned",
      "Shortlisted",
      "Rejected",
      "Pending",
    ]);
    // The v15 transitions, as buttons — not the two-option select.
    expect(screen.getByRole("button", { name: "Shortlist" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
    expect(within(screen.getByRole("row", { name: /InsureFlow/ })).getByText("Submitted")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Send to intro calls" })).not.toBeInTheDocument();
  });

  // The program associate has no `jurypipeline` nav at all (`nav.ts`,
  // `roles: ["admin","program_manager","jury"]`), so there is no PA row to
  // assert here — footnote ʳ marks the cell n/a, and their missing screen is a
  // pre-existing permission gap listed in §5 item 10, not this session's.
});
