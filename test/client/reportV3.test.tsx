import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, configure } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthContext, type AuthUser } from "../../src/client/auth/AuthProvider";
import { EvaluationDrawer } from "../../src/client/components/EvaluationDrawer";
import { EvaluationReportModal } from "../../src/client/components/EvaluationReport";
import { getDeckReport, type DeckReportMatrix, type ReportGroup } from "../../src/client/api";
import type { DeckView } from "../../src/client/types";
import type { Role } from "../../src/shared/roles";

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
const V3_DELETED_COLUMNS = ["Jury Avg.", "Avg."];
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

function matrix(over: Partial<DeckReportMatrix> = {}): DeckReportMatrix {
  return {
    deck: { id: "d1", name: "GreenRoute" },
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

function principal(role: Role = "superuser"): AuthUser {
  return { id: "u_super", name: "Test User", initials: "TU", role, edition: "incubator" };
}

function withAuth(node: ReactNode, role: Role = "superuser") {
  return (
    <AuthContext.Provider
      value={{ user: principal(role), loading: false, login: vi.fn(), logout: vi.fn(), updateUser: vi.fn() }}
    >
      {node}
    </AuthContext.Provider>
  );
}

/** Mount the report modal on a named screen, the way its nav slug reaches it. */
function atScreen(navId: string, node: ReactNode) {
  return render(
    <MemoryRouter initialEntries={[`/app/${navId}`]}>
      <Routes>
        <Route path="/app/:navId" element={withAuth(node)} />
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
    // The AI column is first and the jury-average columns are not there at all.
    expect(seen[0].slice(0, 2)).toEqual(["Parameter", "Weight"]);
    for (const gone of V3_DELETED_COLUMNS) expect(seen[0]).not.toContain(gone);
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
