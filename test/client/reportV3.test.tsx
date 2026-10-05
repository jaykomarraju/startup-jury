import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, configure } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthContext, type AuthUser } from "../../src/client/auth/AuthProvider";
import { EvaluationDrawer } from "../../src/client/components/EvaluationDrawer";
import { EvaluationReportModal } from "../../src/client/components/EvaluationReport";
import { getDeckReport, type DeckReportMatrix, type ReportGroup } from "../../src/client/api";
import type { DeckView } from "../../src/client/types";
import type { Edition, Role } from "../../src/shared/roles";

/**
 * V3-REP — item 1, "evaluation report consistent at each stage".
 *
 * `AISJ_SuperuserV3.HTM` rewrites `window.openReport` (its `_scripts.js`, the
 * SECOND definition, ~line 4042 — the first is overwritten). Against v15 it
 * deletes `__introCols` and `__jTot`, so the **Jury Avg.** and **Avg.** columns
 * are gone and the core table is five columns at every stage, `colspan` 5; and
 * it adds `opts.hideAi`, the report a deck gets before the AI has run.
 *
 * Every literal below is COPIED FROM THE DECODED PROTOTYPE, never imported from
 * the component — a label quietly renamed in the component has to fail here.
 */

configure({ asyncUtilTimeout: 5_000 });

vi.mock("../../src/client/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/api")>()),
  getDeckReport: vi.fn(),
}));

// ── The prototype's own strings ─────────────────────────────────────────────
// v3 `_scripts.js`: the `.jr-ptbl` <thead> of the Parameter evaluation table.
const V3_CORE_HEADERS = ["Parameter", "Weight", "AI", "My score", ""];
// The columns v15 drew at intro/assign/jurypipeline/signup and v3 does not.
//
// Oct-2026 issue 19 took **Avg.** back out of this list for the REPORT MODAL
// only — "Av. Score Column is missing in the eval report" — and where an issue
// and a prototype disagree the issue wins (Aug-2026 log). The drawer below is
// still v3's five columns, which is why the two constants are now separate:
// `V3_DELETED_COLUMNS` is the drawer's, `JURY_AVG` is the one neither surface
// ever got back.
const V3_DELETED_COLUMNS = ["Jury Avg.", "Avg."];
const JURY_AVG = "Jury Avg.";
// `AISJ_IC_Jury_V4` `jr-ptbl`: the Avg. header and the `jr-ptot` footer row.
const PROTO_AVG_HEADER = "Avg.";
const PROTO_TOTAL_ROW = "Weighted total";
// The `custBlock` table — Parameter · Weight · My score · ⌄.
const V3_ADDITIONAL_HEADERS = ["Parameter", "Weight", "My score", ""];
// `.jr-section` titles in the right-hand `.jr-eval` pane, in render order.
const V3_SECTIONS = [
  "Overall AI remarks",
  "Parameter evaluation",
  "My parameters evaluation",
  "Intro call remarks",
];
const V3_TILES = ["AI Score", "My Score"];
const V3_PARAM_HINT = "tap any parameter to read the AI remark and add yours";
const V3_TOTAL_ROW = "Weighted total";
const V3_HIDE_AI_TILE = "Run AI Evaluate to score";
const V3_HIDE_AI_REMARK = "Not evaluated yet — run AI Evaluate to generate the AI remark.";
const V3_HIDE_AI_OVERALL =
  /Not evaluated yet\. Click AI Evaluate on the Evaluate page to generate the AI scores and remarks/;
const V3_ADDL_HINT_EDITABLE = "from My Parameters · auto-filled by assigned role";
const V3_ADDL_REMARK_LABEL = "My remarks for this parameter";

const PARAMS = [
  { key: "problem", name: "Problem & Market Need", weight: 10 },
  { key: "solution", name: "Solution & Product", weight: 10 },
  { key: "traction", name: "Traction & Validation", weight: 15 },
];

/**
 * V4-WEIGHT — the split `GET /decks/:id/report` stamps on its own deck block,
 * and the one the Avg. column blends at. 40:60 is the prototype's default.
 */
const AI_WEIGHT_PCT = 40;

function matrix(over: Partial<DeckReportMatrix> = {}): DeckReportMatrix {
  return {
    deck: { id: "d1", name: "GreenRoute", aiWeightPct: AI_WEIGHT_PCT, aiWeightSource: "org" },
    columns: [{ id: "ai", kind: "ai", name: "AI", rank: 0 }],
    core: PARAMS.map((p) => ({ key: p.key, name: p.name, weight: p.weight, cells: {} })),
    additional: [],
    hiddenEvaluators: 0,
    stage: "default",
    stageAware: true,
    ...over,
  };
}

const DECK: DeckView = { id: "d1", name: "GreenRoute", sector: "ClimateTech", stage: "Seed", city: "Pune" };

function principal(role: Role = "superuser", edition: Edition = "incubator"): AuthUser {
  return { id: "u_super", name: "Test User", initials: "TU", role, edition };
}

function withAuth(node: ReactNode, role: Role = "superuser", edition: Edition = "incubator") {
  return (
    <AuthContext.Provider
      value={{
        user: principal(role, edition),
        loading: false,
        login: vi.fn(),
        logout: vi.fn(),
        updateUser: vi.fn(),
      }}
    >
      {node}
    </AuthContext.Provider>
  );
}

/** Mount the report modal on a named screen, the way its nav slug reaches it. */
function atScreen(navId: string, node: ReactNode, role: Role = "superuser", edition: Edition = "incubator") {
  return render(
    <MemoryRouter initialEntries={[`/app/${navId}`]}>
      <Routes>
        <Route path="/app/:navId" element={withAuth(node, role, edition)} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The header row of a table, by its first header's text. */
function headersOf(table: HTMLElement): string[] {
  return within(table)
    .getAllByRole("columnheader")
    .map((h) => h.textContent ?? "");
}

/** A `.jr-section`'s whole text — the copy that runs through a nested <b>. */
function sectionText(title: string): string {
  const heading = screen.getByRole("heading", { name: new RegExp(`^${title}`) });
  const section = heading.closest("section");
  expect(section, `the "${title}" section is on screen`).not.toBeNull();
  return (section as HTMLElement).textContent ?? "";
}

function tableAfter(title: string): HTMLElement {
  const heading = screen.getByRole("heading", { name: new RegExp(`^${title}`) });
  const section = heading.closest("section");
  expect(section, `the "${title}" section is on screen`).not.toBeNull();
  const table = (section as HTMLElement).querySelector("table");
  expect(table, `the "${title}" section has a table`).not.toBeNull();
  return table as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  // DeckPdfViewer streams the deck; there is none in a unit test.
  globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 })) as typeof fetch;
  vi.mocked(getDeckReport).mockResolvedValue(matrix());
});

// ── The shape v3 settled on ─────────────────────────────────────────────────

describe("the evaluation report overlay matches AISJ_SuperuserV3 openReport()", () => {
  it("draws the prototype's sections, in the prototype's order", () => {
    render(withAuth(<EvaluationDrawer open onClose={() => {}} deck={DECK} />));
    const dialog = screen.getByRole("dialog");
    const titles = within(dialog)
      .getAllByRole("heading", { level: 3 })
      .map((h) => (h.textContent ?? "").trim());
    expect(titles.map((t) => t.replace(/·.*$/, "").trim())).toEqual(
      V3_SECTIONS.map((s) =>
        s === "Parameter evaluation"
          ? `${s}${V3_PARAM_HINT}`
          : s === "Overall AI remarks"
            ? s
            : s === "Intro call remarks"
              ? `${s}your notes after attending the founder call`
              : `${s}role-specific additional parameters`,
      ).map((t) => t.replace(/·.*$/, "").trim()),
    );
  });

  it("prints the eyebrow, both tiles and the parameter hint verbatim", async () => {
    render(
      withAuth(
        <EvaluationDrawer
          open
          onClose={() => {}}
          deck={{ ...DECK, aiScore: 7.2 }}
          scores={PARAMS.map((p) => ({ key: p.key, label: p.name, weight: p.weight, value: 7 }))}
        />,
      ),
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("ai·STARTUPJURY · Evaluation report")).toBeInTheDocument();
    for (const t of V3_TILES) expect(within(dialog).getByText(t)).toBeInTheDocument();
    expect(within(dialog).getByText(V3_PARAM_HINT)).toBeInTheDocument();
    // Gate on a populated cell, not on the heading the empty branch also draws.
    await waitFor(() => expect(within(dialog).getByText(V3_TOTAL_ROW)).toBeInTheDocument());
  });

  it("draws five columns — v3 deleted Jury Avg. and Avg. from every stage", async () => {
    render(
      withAuth(
        <EvaluationDrawer
          open
          onClose={() => {}}
          deck={{ ...DECK, aiScore: 7.2 }}
          scores={PARAMS.map((p) => ({ key: p.key, label: p.name, weight: p.weight, value: 7 }))}
        />,
      ),
    );
    await waitFor(() => expect(screen.getByText(V3_TOTAL_ROW)).toBeInTheDocument());
    expect(headersOf(tableAfter("Parameter evaluation"))).toEqual(V3_CORE_HEADERS);
    for (const gone of V3_DELETED_COLUMNS) {
      expect(screen.queryByRole("columnheader", { name: gone })).toBeNull();
    }
  });
});

// ── Item 1: the same report at every stage ──────────────────────────────────

describe("item 1 — the report is the same at every stage", () => {
  const scores = PARAMS.map((p) => ({ key: p.key, label: p.name, weight: p.weight, value: 7 }));

  async function headersForStage(stage: "assign" | "intro" | "default") {
    vi.mocked(getDeckReport).mockResolvedValue(matrix({ stage }));
    const view = render(
      withAuth(
        <EvaluationDrawer open onClose={() => {}} deck={{ ...DECK, aiScore: 7.2 }} scores={scores} />,
      ),
    );
    await waitFor(() => expect(screen.getByText(V3_TOTAL_ROW)).toBeInTheDocument());
    const out = headersOf(tableAfter("Parameter evaluation"));
    view.unmount();
    return out;
  }

  it("draws the same core columns on the Assign stage and the Intro calls stage", async () => {
    const assign = await headersForStage("assign");
    const intro = await headersForStage("intro");
    const other = await headersForStage("default");
    expect(assign).toEqual(V3_CORE_HEADERS);
    expect(intro).toEqual(assign);
    expect(other).toEqual(assign);
  });

  it("gives the report modal the same core column order on two different screens", async () => {
    const seen: string[][] = [];
    for (const navId of ["assign", "introcalls"]) {
      const view = atScreen(
        navId,
        <EvaluationReportModal deckId="d1" deckName="GreenRoute" onClose={() => {}} />,
      );
      await waitFor(() => expect(screen.getByText(PARAMS[0].name)).toBeInTheDocument());
      seen.push(headersOf(screen.getByRole("dialog").querySelector("table") as HTMLElement));
      view.unmount();
    }
    expect(seen[0]).toEqual(seen[1]);
    // Still stage-INDEPENDENT, which is all item 1 ever asked: v15 grew the
    // two extra columns at intro only. Avg. is now on at BOTH stages (issue
    // 19) and per-stage drift is what this test exists to catch.
    expect(seen[0].slice(0, 2)).toEqual(["Parameter", "Weight"]);
    // `Jury Avg.` — a column per OTHER juror's mean — stays deleted; the report
    // already widens one column per evaluator (issue 20).
    expect(seen[0]).not.toContain(JURY_AVG);
  });

  it("still labels the stage — the server-enforced stage mechanism is untouched", async () => {
    vi.mocked(getDeckReport).mockResolvedValue(matrix({ stage: "assign", stageAware: true }));
    atScreen("assign", <EvaluationReportModal deckId="d1" deckName="GreenRoute" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("report-stage")).toHaveTextContent("Assign stage"));
    expect(vi.mocked(getDeckReport).mock.calls[0][1]).toBe("assign");
  });
});

// ── v3's new `hideAi` report ────────────────────────────────────────────────

describe("v3 hideAi — the report a deck gets before the AI has run", () => {
  it("keeps every parameter row and says what to do, rather than emptying the table", async () => {
    render(withAuth(<EvaluationDrawer open onClose={() => {}} deck={DECK} />));
    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(within(dialog).getByText(V3_TOTAL_ROW)).toBeInTheDocument());

    expect(headersOf(tableAfter("Parameter evaluation"))).toEqual(V3_CORE_HEADERS);
    for (const p of PARAMS) expect(within(dialog).getByText(p.name)).toBeInTheDocument();
    expect(within(dialog).getByText(V3_HIDE_AI_TILE)).toBeInTheDocument();
    expect(sectionText("Overall AI remarks")).toMatch(V3_HIDE_AI_OVERALL);
    expect(within(dialog).getByText(`0 of ${PARAMS.length} parameters scored`)).toBeInTheDocument();

    // Expand a row by its parameter NAME — never by the attribute the click changes.
    fireEvent.click(within(dialog).getByText(PARAMS[0].name));
    expect(within(dialog).getByText(V3_HIDE_AI_REMARK)).toBeInTheDocument();
  });

  it("does NOT say it on an evaluated deck — the negative control", async () => {
    render(
      withAuth(
        <EvaluationDrawer
          open
          onClose={() => {}}
          deck={{ ...DECK, aiScore: 7.2 }}
          scores={PARAMS.map((p) => ({ key: p.key, label: p.name, weight: p.weight, value: 7, comment: "ok" }))}
        />,
      ),
    );
    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(within(dialog).getByText(V3_TOTAL_ROW)).toBeInTheDocument());
    expect(within(dialog).queryByText(V3_HIDE_AI_TILE)).toBeNull();
    // F0197's copy still covers an evaluated deck the AI wrote no narrative for.
    expect(sectionText("Overall AI remarks")).not.toMatch(V3_HIDE_AI_OVERALL);
    expect(
      within(dialog).getByText("The AI has not written an overall remark for this deck yet."),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Weighted across 3 parameters")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByText(PARAMS[0].name));
    expect(within(dialog).queryByText(V3_HIDE_AI_REMARK)).toBeNull();
  });

  it("leaves blind scoring's own wording alone where both would apply", async () => {
    render(withAuth(<EvaluationDrawer open onClose={() => {}} deck={DECK} aiScoreWithheld />));
    const dialog = screen.getByRole("dialog");
    await waitFor(() =>
      expect(within(dialog).getByText("Hidden until you submit your own evaluation")).toBeInTheDocument(),
    );
    expect(within(dialog).queryByText(V3_HIDE_AI_TILE)).toBeNull();
    expect(sectionText("Overall AI remarks")).not.toMatch(V3_HIDE_AI_OVERALL);
  });
});

// ── The `custBlock` additional-parameters table ─────────────────────────────

describe("My parameters evaluation follows the prototype's custBlock", () => {
  const group: ReportGroup = {
    role: "superuser",
    roleLabel: "Super User",
    mode: "editable",
    rows: [
      { key: "add_1", name: "Program & Mandate Fit", weight: 0, cells: { u_super: { value: 8, comment: "Strong fit" } } },
      { key: "add_2", name: "Application Readiness", weight: 0, cells: {} },
    ],
  };

  it("draws four columns and expands a row to the viewer's own remark", async () => {
    vi.mocked(getDeckReport).mockResolvedValue(matrix({ additional: [group] }));
    render(withAuth(<EvaluationDrawer open onClose={() => {}} deck={DECK} />));
    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(within(dialog).getByText("Program & Mandate Fit")).toBeInTheDocument());

    expect(headersOf(tableAfter("My parameters evaluation"))).toEqual(V3_ADDITIONAL_HEADERS);
    expect(within(dialog).getByText("Average of my scores")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByText("Program & Mandate Fit"));
    expect(within(dialog).getByText(V3_ADDL_REMARK_LABEL)).toBeInTheDocument();
    expect(within(dialog).getByText("Strong fit")).toBeInTheDocument();
  });

  it("names the role and the mode in the section's small print", async () => {
    vi.mocked(getDeckReport).mockResolvedValue(matrix({ additional: [group] }));
    render(withAuth(<EvaluationDrawer open onClose={() => {}} deck={DECK} />));
    await waitFor(() =>
      expect(screen.getByText(new RegExp(`Super User · ${V3_ADDL_HINT_EDITABLE}`))).toBeInTheDocument(),
    );
  });

  it("keeps the prototype's empty state when the workspace has no additional parameters", async () => {
    render(withAuth(<EvaluationDrawer open onClose={() => {}} deck={DECK} />));
    expect(screen.getByText(/These auto-fill from the role/)).toBeInTheDocument();
    expect(screen.getByText("role-specific additional parameters")).toBeInTheDocument();
  });
});

// ── Blind scoring, on the surface the leak was on ───────────────────────────

describe("the report modal says why the AI column is absent", () => {
  it("shows the withheld notice and draws no AI column when the route withholds it", async () => {
    vi.mocked(getDeckReport).mockResolvedValue(
      matrix({ columns: [], aiScoreWithheld: true }), // what the route now returns
    );
    atScreen("assign", <EvaluationReportModal deckId="d1" deckName="GreenRoute" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(PARAMS[0].name)).toBeInTheDocument());

    expect(screen.getByTestId("report-ai-withheld")).toHaveTextContent(
      "Blind scoring is on — the AI column appears once you submit your own evaluation for this deck.",
    );
    expect(headersOf(screen.getByRole("dialog").querySelector("table") as HTMLElement)).toEqual([
      "Parameter",
      "Weight",
    ]);
  });

  it("says nothing of the sort on an ordinary report — the negative control", async () => {
    atScreen("assign", <EvaluationReportModal deckId="d1" deckName="GreenRoute" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(PARAMS[0].name)).toBeInTheDocument());
    expect(screen.queryByTestId("report-ai-withheld")).toBeNull();
    expect(headersOf(screen.getByRole("dialog").querySelector("table") as HTMLElement)).toContain("AI");
  });

  it("the drawer takes the flag from the report when no caller passed it", async () => {
    vi.mocked(getDeckReport).mockResolvedValue(matrix({ columns: [], aiScoreWithheld: true }));
    render(withAuth(<EvaluationDrawer open onClose={() => {}} deck={DECK} />));
    const dialog = screen.getByRole("dialog");
    await waitFor(() =>
      expect(within(dialog).getByText("Hidden until you submit your own evaluation")).toBeInTheDocument(),
    );
    // Not the "run AI Evaluate" report: the AI has scored it, this viewer may not see it.
    expect(within(dialog).queryByText(V3_HIDE_AI_TILE)).toBeNull();
    expect(sectionText("Overall AI remarks")).not.toMatch(V3_HIDE_AI_OVERALL);
  });
});

// ── Oct-2026 issues 17 + 19 — the Weighted total row and the Avg. column ─────
//
// 17: "In the Assigned screen, at the end of core parameters the weighted total
//      is missing. The weighted total should appear for AI, My SCORE and Average
//      score, which is what appears all over the platform."
// 19: "Av. Score Column is missing in the eval report."
//
// Both land on the MODAL, which is the surface a juror opens from `jassigned`
// (`EvaluatePage` → the sparkline cell, and the workbench's own report button).
// The drawer above is a different component with a different column set, and it
// has carried a Weighted total row all along — which is the "all over the
// platform" shape the client is comparing against.

describe("the report modal's core table ends in the prototype's jr-ptot row", () => {
  /** A deck both the AI and one juror have scored, as the route returns it. */
  const scored = () =>
    matrix({
      columns: [
        { id: "ai", kind: "ai", name: "AI", rank: 0, total: 7.2 },
        {
          id: "u_jury",
          kind: "human",
          name: "Rajesh Kumar",
          role: "jury",
          roleLabel: "Jury Member",
          initials: "RK",
          rank: 1,
          total: 6.4,
        },
      ],
      core: [
        { key: "problem", name: PARAMS[0].name, weight: 10, cells: { ai: { value: 8 }, u_jury: { value: 6 } } },
        { key: "solution", name: PARAMS[1].name, weight: 10, cells: { ai: { value: 7 }, u_jury: { value: 5 } } },
        { key: "traction", name: PARAMS[2].name, weight: 15, cells: { ai: { value: 6 }, u_jury: { value: 7 } } },
      ],
    });

  /** Every `<td>` of a row, in order. */
  function cellsOf(row: HTMLElement): string[] {
    return [...row.querySelectorAll("td")].map((td) => (td.textContent ?? "").trim());
  }

  function rowOf(name: string): HTMLElement {
    return screen.getByText(name).closest("tr") as HTMLElement;
  }

  async function openOn(navId = "jassigned", role: Role = "jury", edition: Edition = "incubator") {
    atScreen(navId, <EvaluationReportModal deckId="d1" deckName="GreenRoute" onClose={() => {}} />, role, edition);
    await waitFor(() => expect(screen.getByText(PARAMS[0].name)).toBeInTheDocument());
  }

  it("issue 17 — carries the weight sum, each evaluator's composite and the blended Avg.", async () => {
    vi.mocked(getDeckReport).mockResolvedValue(scored());
    await openOn();
    // 7.2 AI · 6.4 juror at 40:60 → 2.88 + 3.84 = 6.72, printed to one decimal.
    expect(cellsOf(screen.getByTestId("report-weighted-total"))).toEqual([
      PROTO_TOTAL_ROW,
      "35%", // 10 + 10 + 15 — the rows' own weights, not a hardcoded 100%
      "7.2",
      "6.4",
      "6.7",
    ]);
  });

  it("issue 19 — adds the Avg. column last and blends every row at the deck's split", async () => {
    vi.mocked(getDeckReport).mockResolvedValue(scored());
    await openOn();
    const headers = headersOf(screen.getByRole("dialog").querySelector("table") as HTMLElement);
    expect(headers).toHaveLength(5);
    expect(headers.slice(0, 2)).toEqual(["Parameter", "Weight"]);
    expect(headers.at(-1)).toBe(PROTO_AVG_HEADER);

    // 8/6 → 6.8 · 7/5 → 5.8 · 6/7 → 6.6, all at 40% AI · 60% evaluator.
    expect(cellsOf(rowOf(PARAMS[0].name))).toEqual([PARAMS[0].name, "10%", "8", "6", "6.8"]);
    expect(cellsOf(rowOf(PARAMS[1].name))).toEqual([PARAMS[1].name, "10%", "7", "5", "5.8"]);
    expect(cellsOf(rowOf(PARAMS[2].name))).toEqual([PARAMS[2].name, "15%", "6", "7", "6.6"]);
    // And it says what the blend is, rather than printing an unexplained number.
    expect(screen.getByText(/blends 40% AI with 60% evaluator/)).toBeInTheDocument();
  });

  it("falls back to the cells when a column carries no submitted roll-up", async () => {
    const data = scored();
    // The route admits this shape on purpose: columns come from `evaluations`
    // AND from `scores`, independently, so per-parameter scores with no roll-up
    // still earn a column.
    data.columns[1] = { ...data.columns[1], total: undefined };
    vi.mocked(getDeckReport).mockResolvedValue(data);
    await openOn();
    // (10·6 + 10·5 + 15·7) / 35 = 6.14, then 7.2/6.14 at 40:60 → 6.56.
    expect(cellsOf(screen.getByTestId("report-weighted-total"))).toEqual([
      PROTO_TOTAL_ROW,
      "35%",
      "7.2",
      "6.1",
      "6.6",
    ]);
  });

  it("draws NO Avg. column when the payload carries no split — the W7-A rule", async () => {
    const data = scored();
    data.deck = { id: "d1", name: "GreenRoute" };
    vi.mocked(getDeckReport).mockResolvedValue(data);
    await openOn();
    expect(screen.queryByRole("columnheader", { name: PROTO_AVG_HEADER })).toBeNull();
    expect(screen.queryByText(/blends 40% AI/)).toBeNull();
    // Issue 17 does not depend on the split: the row is still there, one short.
    expect(cellsOf(screen.getByTestId("report-weighted-total"))).toEqual([
      PROTO_TOTAL_ROW,
      "35%",
      "7.2",
      "6.4",
    ]);
  });

  it("leaves the VC edition's report exactly as it is — neither row nor column", async () => {
    vi.mocked(getDeckReport).mockResolvedValue(scored());
    await openOn("assign", "analyst", "vc");
    expect(screen.queryByTestId("report-weighted-total")).toBeNull();
    expect(screen.queryByRole("columnheader", { name: PROTO_AVG_HEADER })).toBeNull();
    expect(headersOf(screen.getByRole("dialog").querySelector("table") as HTMLElement)).toHaveLength(4);
  });

  it("adds neither to the Addl. parameters tab — those rows have no composite", async () => {
    vi.mocked(getDeckReport).mockResolvedValue(
      matrix({
        ...scored(),
        additional: [
          {
            role: "jury",
            roleLabel: "Jury Member",
            mode: "editable",
            rows: [{ key: "add_1", name: "Barriers of entry", weight: 0, cells: { u_jury: { value: 8 } } }],
          },
        ],
      }),
    );
    atScreen("jassigned", <EvaluationReportModal deckId="d1" deckName="GreenRoute" onClose={() => {}} />, "jury");
    fireEvent.click(await screen.findByRole("tab", { name: "Addl. parameters" }));
    await waitFor(() => expect(screen.getByText("Barriers of entry")).toBeInTheDocument());
    expect(screen.queryByTestId("report-weighted-total")).toBeNull();
    expect(screen.queryByRole("columnheader", { name: PROTO_AVG_HEADER })).toBeNull();
  });

  it("stays out of blind scoring's way — no columns means nothing to average", async () => {
    vi.mocked(getDeckReport).mockResolvedValue({ ...scored(), columns: [], aiScoreWithheld: true });
    await openOn();
    expect(headersOf(screen.getByRole("dialog").querySelector("table") as HTMLElement)).toEqual([
      "Parameter",
      "Weight",
    ]);
    expect(cellsOf(screen.getByTestId("report-weighted-total"))).toEqual([PROTO_TOTAL_ROW, "35%"]);
  });
});
