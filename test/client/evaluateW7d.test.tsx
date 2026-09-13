import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthContext, type AuthUser } from "../../src/client/auth/AuthProvider";
import { ScoreBars, scoreColor, COMPOSITE_LABELS } from "../../src/client/components/ScoreBars";
import { EvalScorecard, scoreHeaderLabels } from "../../src/client/components/EvalScorecard";
import { EvaluationReportModal } from "../../src/client/components/EvaluationReport";
import { EvaluatePage } from "../../src/client/routes/EvaluatePage";
import { ScoringFrameworkSection } from "../../src/client/routes/admin/ScoringFramework";
import { AdminSaveContext, type AdminSaveState } from "../../src/client/routes/admin/saveContext";
import { SIGNAL_STYLES } from "../../src/client/theme/signals";
import { DEFAULT_SCORING_SETTINGS, type ScoringSettings } from "../../src/shared/scoring";
import { RUBRIC_BANDS } from "../../src/shared/types";
import { reportLayout, parseReportStage } from "../../src/shared/reportStage";
import type { DeckView } from "../../src/client/types";
import type { DeckReportMatrix, RubricParameter } from "../../src/client/api";
import {
  getDeckReport,
  listDecks,
  listParameters,
  listRecommendations,
  setRecommendation,
  getDeck,
  getMyScores,
  updateThresholds,
} from "../../src/client/api";
import {
  getScoringFramework,
  saveScoringFramework,
  scoringSettings,
} from "../../src/client/routes/admin/scoringApi";
import type { Edition, Role } from "../../src/shared/roles";

/**
 * W7-D — the Evaluate workbench, the stage-aware evaluation report (spec §8.4),
 * and the three §9 scale defects: `scoreColor` on the retired cut-points, a
 * composite that ignored the org's formula and scale, and a delta/threshold
 * authored on one scale and enforced on another.
 */

vi.mock("../../src/client/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/api")>()),
  getDeckReport: vi.fn(),
  listDecks: vi.fn(),
  listParameters: vi.fn(),
  listRecommendations: vi.fn(),
  setRecommendation: vi.fn(),
  getDeck: vi.fn(),
  getMyScores: vi.fn(),
  submitJuryScores: vi.fn(),
  transitionDeck: vi.fn(),
  rescoreDeck: vi.fn(),
  updateThresholds: vi.fn(),
}));

vi.mock("../../src/client/routes/admin/scoringApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/routes/admin/scoringApi")>()),
  scoringSettings: vi.fn(),
  getScoringFramework: vi.fn(),
  saveScoringFramework: vi.fn(),
}));

function principal(role: Role, edition: Edition = "incubator"): AuthUser {
  return { id: `u_${role}`, name: "Rajesh Kumar", initials: "RK", role, edition };
}

function withAuth(node: ReactNode, role: Role) {
  return (
    <AuthContext.Provider
      value={{ user: principal(role), loading: false, login: vi.fn(), logout: vi.fn(), updateUser: vi.fn() }}
    >
      {node}
    </AuthContext.Provider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // DeckPdfViewer streams the PDF; the seed has none.
  globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 })) as typeof fetch;
  vi.mocked(scoringSettings).mockResolvedValue({ ...DEFAULT_SCORING_SETTINGS });
});

// ── §9 (a) — scoreColor ──────────────────────────────────────────────────────

describe("scoreColor derives from RUBRIC_BANDS", () => {
  it("paints every band's own colour from its cut-point, and the band below it just under", () => {
    RUBRIC_BANDS.forEach((band, i) => {
      expect(scoreColor(band.min), `${band.key} at ${band.min}`).toBe(SIGNAL_STYLES[band.key].color);
      const below = RUBRIC_BANDS[i + 1];
      if (below) {
        expect(scoreColor(band.min - 0.01), `just under ${band.key}`).toBe(SIGNAL_STYLES[below.key].color);
      }
    });
  });

  it("moves the colour at the five-band boundaries the retired four-band copy did not have", () => {
    // Retired copies: ≥8 strong · ≥5 moderate · ≥2 weak · else absent.
    // 6.9 and 7.0 were BOTH moderate there; 7 is Strong on the spec's scale.
    expect(scoreColor(7)).not.toBe(scoreColor(6.9));
    expect(scoreColor(7)).toBe(SIGNAL_STYLES.strong.color);
    // 2.9 and 3.0 were BOTH weak there; below 3 is Insufficient.
    expect(scoreColor(3)).not.toBe(scoreColor(2.9));
    expect(scoreColor(2.5)).toBe(SIGNAL_STYLES.insufficient.color);
  });
});

// ── §9 (b) — the composite readout ───────────────────────────────────────────

describe("ScoreBars honours composite_formula AND score_scale", () => {
  const scores = [
    { label: "Traction", weight: 30, value: 10 },
    { label: "Team", weight: 10, value: 2 },
    { label: "Market", weight: 10, value: 4 },
  ];

  it("a median org sees the median, labelled as one — not a weighted total", () => {
    render(<ScoreBars scores={scores} scoring={{ compositeFormula: "median", scoreScale: "0-10" }} />);
    expect(screen.getByText("Median")).toBeInTheDocument();
    expect(screen.queryByText("Weighted total")).not.toBeInTheDocument();
    expect(screen.getByText("4.00")).toBeInTheDocument(); // the weighted average would be 7.20
  });

  it("prints the composite on the org's scale", () => {
    render(<ScoreBars scores={scores} scoring={{ compositeFormula: "weighted_average", scoreScale: "1-5" }} />);
    expect(screen.getByText(COMPOSITE_LABELS.weighted_average)).toBeInTheDocument();
    // 7.2 canonical → 1 + 0.72·4 = 3.88 on 1–5.
    expect(screen.getByText("3.88")).toBeInTheDocument();
  });

  it("a caller that passes nothing still gets the org's formula, read from the framework", async () => {
    vi.mocked(scoringSettings).mockResolvedValue({ ...DEFAULT_SCORING_SETTINGS, compositeFormula: "median" });
    render(<ScoreBars scores={scores} />);
    expect(await screen.findByText("Median")).toBeInTheDocument();
    expect(screen.getByText("4.00")).toBeInTheDocument();
  });
});

// ── The workbench scorecard ──────────────────────────────────────────────────

const deck: DeckView = { id: "d1", name: "TaxPilot", sector: "B2B SaaS", stage: "Seed", city: "Chennai" };
const core: RubricParameter[] = [
  { key: "traction", name: "Traction & Validation", weight: 10 },
  { key: "team", name: "Team & Execution Capability", weight: 10 },
];
const mine: RubricParameter[] = [
  { key: "barriers", name: "Barriers of entry", weight: 0, informational: true, roleScope: "jury" },
];

function Scorecard({ scoring, initial = {} }: { scoring?: ScoringSettings; initial?: Record<string, number> }) {
  const [values, setValues] = useState<Record<string, number>>(initial);
  const [comments, setComments] = useState<Record<string, string>>({});
  return (
    <EvalScorecard
      deck={deck}
      params={core}
      additionalParams={mine}
      values={values}
      onChangeValue={(k, v) => setValues((s) => ({ ...s, [k]: v }))}
      remarks=""
      onChangeRemarks={() => {}}
      aiScores={new Map([["traction", { value: 8 }]])}
      aiTotal={8}
      scoring={scoring}
      comments={comments}
      onChangeComment={(k, v) => setComments((c) => ({ ...c, [k]: v }))}
      onSave={() => {}}
    />
  );
}

describe("EvalScorecard — the prototype's parameter table", () => {
  it("carries the header set Parameter · Weight · AI · My score · Avg.", () => {
    render(<Scorecard />);
    const headers = screen.getAllByTestId("score-header");
    expect(headers.length).toBe(2); // core + my additional parameters
    for (const header of headers) {
      const labels = Array.from(header.children)
        .map((c) => c.textContent?.trim())
        .filter(Boolean);
      expect(labels).toEqual(scoreHeaderLabels(true));
    }
    expect(scoreHeaderLabels(true)).toEqual(["Parameter", "Weight", "AI", "My score", "Avg."]);
  });

  it("starts every parameter unscored — '–', never a silent 5 — and locks submit until all are scored", () => {
    render(<Scorecard />);
    const inputs = [...core, ...mine].map(
      (p) => screen.getByLabelText(`My score for ${p.name}`) as HTMLInputElement,
    );
    for (const input of inputs) {
      expect(input.value).toBe("");
      expect(input.placeholder).toBe("–");
      expect(input.step).toBe("0.5");
    }
    const submit = screen.getByRole("button", { name: "Submit my evaluation" });
    expect(submit).toBeDisabled();
    expect(screen.getByText(/Score all 3 parameters before submitting \(0\/3\)/)).toBeInTheDocument();

    fireEvent.change(inputs[0], { target: { value: "7.5" } });
    fireEvent.change(inputs[1], { target: { value: "6" } });
    expect(screen.getByText(/\(2\/3\)/)).toBeInTheDocument();
    expect(submit).toBeDisabled();
    fireEvent.change(inputs[2], { target: { value: "5" } });
    expect(submit).toBeEnabled();
  });

  it("on a 1–5 org the rationale caption speaks the org's points (0.8), not canonical 2", () => {
    render(<Scorecard scoring={{ ...DEFAULT_SCORING_SETTINGS, scoreScale: "1-5" }} initial={{ traction: 2 }} />);
    // AI 8 (4.2 on 1–5) vs my 2 (1.8) — far outside the delta.
    expect(screen.getByText(/more than 0\.8 points from the AI/)).toBeInTheDocument();
    expect(screen.queryByText(/more than 2 points/)).not.toBeInTheDocument();
  });

  it("each row's remarks open from its chevron — the prototype's 'My remarks for this parameter'", () => {
    render(<Scorecard initial={{ traction: 8 }} />);
    expect(screen.queryByLabelText("My remarks for Team & Execution Capability")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remarks for Team & Execution Capability" }));
    expect(screen.getByText("My remarks for this parameter")).toBeInTheDocument();
    expect(screen.getByLabelText("My remarks for Team & Execution Capability")).toBeInTheDocument();
  });
});

// ── §8.4 — the report in each of its three stage shapes ──────────────────────

const PARAMS_BY_ROLE: Record<string, string[]> = {
  program_associate: ["Program fit", "Investment stage", "Ask"],
  program_manager: ["TRL stage", "Product-Market Fit", "Traction"],
  jury: ["Barriers of entry", "Scalability", "Industry growth"],
};
const LABELS: Record<string, string> = {
  program_associate: "Program Associate",
  program_manager: "Program Manager",
  jury: "Jury Member",
};

/** A server double that lays the report out by the real rule, so the screen is tested against it. */
function fakeReport(role: Role) {
  return async (_id: string, stage?: string): Promise<DeckReportMatrix> => {
    const layout = reportLayout("incubator", parseReportStage(stage), role);
    return {
      deck: { id: "d1", name: "GreenRoute" },
      columns: [
        { id: "ai", kind: "ai", name: "AI", rank: 0, total: 7.2 },
        { id: "inc_jury", kind: "human", name: "Rajesh Kumar", role: "jury", roleLabel: "Jury Member", rank: 1, total: 7.5 },
      ],
      core: [{ key: "traction", name: "Traction & Validation", weight: 10, cells: { ai: { value: 7 } } }],
      additional: layout.sections.map((s) => ({
        role: s.role,
        roleLabel: LABELS[s.role],
        mode: s.mode,
        readOnly: s.mode !== "editable",
        rows: PARAMS_BY_ROLE[s.role].map((name, i) => ({
          key: `${s.role}_${i}`,
          name,
          weight: 0,
          cells: (s.role === "jury" ? { inc_jury: { value: 8 } } : {}) as Record<string, { value: number }>,
        })),
      })),
      hiddenEvaluators: 0,
      stage: layout.stage,
      stageAware: layout.stageAware,
      scoring: { scoreScale: "0-10" },
    };
  };
}

function openReportOn(navId: string, role: Role) {
  vi.mocked(getDeckReport).mockImplementation(fakeReport(role));
  render(
    withAuth(
      <MemoryRouter initialEntries={[`/app/${navId}`]}>
        <Routes>
          <Route
            path="/app/:navId"
            element={<EvaluationReportModal deckId="d1" deckName="GreenRoute" initialTab="additional" onClose={() => {}} />}
          />
        </Routes>
      </MemoryRouter>,
      role,
    ),
  );
}

async function sections() {
  // Gate on a POPULATED element — a role section — never the loading branch.
  const found = await screen.findAllByRole("region", { name: / parameters$/ });
  return found.map((el) => `${el.getAttribute("aria-label")}:${el.getAttribute("data-mode")}`);
}

describe("the evaluation report is stage-aware (spec §8.4)", () => {
  it("opened from Assign: Program associate + Program manager, no jury section", async () => {
    openReportOn("assign", "program_manager");
    expect(await sections()).toEqual([
      "Program Associate parameters:read_only",
      "Program Manager parameters:editable",
    ]);
    expect(getDeckReport).toHaveBeenCalledWith("d1", "assign");
    expect(screen.getByTestId("report-stage")).toHaveTextContent("Assign stage");
    expect(screen.queryByText("Barriers of entry")).not.toBeInTheDocument();
  });

  it("opened from Intro calls: PA + PM + Jury, the jury section read-only 'completed · Submitted'", async () => {
    openReportOn("introcalls", "program_manager");
    expect(await sections()).toEqual([
      "Program Associate parameters:read_only",
      "Program Manager parameters:editable",
      "Jury Member parameters:completed",
    ]);
    expect(getDeckReport).toHaveBeenCalledWith("d1", "intro");
    const jury = screen.getByRole("region", { name: "Jury Member parameters" });
    expect(within(jury).getByText(/completed by jury/)).toBeInTheDocument();
    expect(within(jury).getByText("Submitted")).toBeInTheDocument();
    expect(within(jury).queryByText(/yours to score/)).not.toBeInTheDocument();
    expect(screen.getByTestId("report-stage")).toHaveTextContent("Intro calls stage");
  });

  it("opened anywhere else: single-role — only the viewer's own section", async () => {
    openReportOn("evaluate", "program_associate");
    expect(await sections()).toEqual(["Program Associate parameters:editable"]);
    expect(getDeckReport).toHaveBeenCalledWith("d1", "default");
    expect(screen.getByTestId("report-stage")).toHaveTextContent("Evaluation stage");
  });

  it("the jury's own Assigned screen adds a PA reference section and keeps its own editable", async () => {
    openReportOn("jassigned", "jury");
    expect(await sections()).toEqual(["Program Associate parameters:read_only", "Jury Member parameters:editable"]);
  });
});

// ── The Evaluate screen ──────────────────────────────────────────────────────

const DECKS: DeckView[] = [
  { id: "inc_deck_taxpilot", name: "TaxPilot", sector: "B2B SaaS", stage: "Seed", city: "Chennai", statusId: "assigned", assignedTo: "u_jury", aiScore: 6.9, missingFields: ["founderPhone"] },
  { id: "inc_deck_insureflow", name: "InsureFlow", sector: "Insurtech", stage: "Seed", city: "Bengaluru", statusId: "jury_evaluation", assignedTo: "u_jury", aiScore: 8.6 },
  { id: "inc_deck_other", name: "NotMine", sector: "Fintech", statusId: "assigned", assignedTo: "someone_else", aiScore: 5 },
  { id: "inc_deck_done", name: "Shortlisted Co", statusId: "shortlisted", assignedTo: "u_jury" },
];

const PARAMETERS: RubricParameter[] = [
  {
    key: "traction",
    name: "Traction & Validation",
    weight: 10,
    prompt: "Has reality said 'yes'?",
    questions: ["What is your strongest proof of customer demand?", "How many paying customers do you have today?"],
    bands: [
      { index: 0, label: "9–10", name: "Exceptional", description: "Category traction." },
      { index: 1, label: "7–8", name: "Strong", description: "Repeatable revenue." },
      { index: 2, label: "5–6", name: "Moderate", description: "Early pilots." },
      { index: 3, label: "3–4", name: "Weak", description: "Anecdotes." },
      { index: 4, label: "0–2", name: "Insufficient", description: "None." },
    ],
  },
  { key: "team", name: "Team & Execution Capability", weight: 10 },
  { key: "add_barriers", name: "Barriers of entry", weight: 0, informational: true, roleScope: "jury", description: "Defensibility vs new entrants." },
  { key: "add_trl", name: "TRL stage", weight: 0, informational: true, roleScope: "program_manager" },
];

function mountEvaluate(role: Role = "jury", recommendations?: () => ReturnType<typeof listRecommendations>) {
  vi.mocked(listDecks).mockResolvedValue({ decks: DECKS } as never);
  vi.mocked(listParameters).mockResolvedValue({ parameters: PARAMETERS, anchors: [] });
  if (recommendations) {
    vi.mocked(listRecommendations).mockImplementation(recommendations);
  } else {
    vi.mocked(listRecommendations).mockResolvedValue({
      recommendations: { inc_deck_insureflow: "hold" },
      evaluated: ["inc_deck_insureflow"],
    });
  }
  vi.mocked(setRecommendation).mockResolvedValue({ ok: true, deckId: "inc_deck_taxpilot", status: "shortlist" });
  vi.mocked(getDeck).mockResolvedValue({ scores: [], weightedTotal: undefined } as never);
  vi.mocked(getMyScores).mockResolvedValue({ scores: [] });
  return render(
    withAuth(
      <MemoryRouter initialEntries={["/app/jassigned"]}>
        <Routes>
          <Route path="/app/:navId" element={<EvaluatePage />} />
        </Routes>
      </MemoryRouter>,
      role,
    ),
  );
}

describe("Evaluate — the prototype's toolbar, columns and status vocabulary", () => {
  it("renders the toolbar, the three column headers and the deck rows", async () => {
    mountEvaluate();
    // Populated first: the loading branch renders the same headings.
    const list = await screen.findByRole("list", { name: "Decks to evaluate" });
    await within(list).findByText("TaxPilot");

    expect(screen.getByRole("heading", { level: 1, name: "Evaluate" })).toBeInTheDocument();
    expect(screen.getByText("Click a deck to open its evaluation report · set its status alongside")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();

    expect(screen.getByTestId("ev-decks-label")).toHaveTextContent("2 decks · click to open report");
    expect(screen.getByText("Evaluation parameters")).toBeInTheDocument();
    expect(screen.getByText("Click Review to see the full prompt")).toBeInTheDocument();
    expect(screen.getByText("My additional parameters (Jury Member)")).toBeInTheDocument();
    expect(screen.getByText("Core evaluation parameters")).toBeInTheDocument();

    // Negative: another juror's deck and a deck past evaluation are not here;
    // another role's additional parameter is not either.
    expect(within(list).queryByText("NotMine")).not.toBeInTheDocument();
    expect(within(list).queryByText("Shortlisted Co")).not.toBeInTheDocument();
    expect(screen.queryByText("TRL stage")).not.toBeInTheDocument();

    // Badges: AI, flags, Evaluated.
    const taxpilot = within(list).getByText("TaxPilot").closest("li") as HTMLElement;
    expect(within(taxpilot).getByText("AI 6.9")).toBeInTheDocument();
    expect(within(taxpilot).getByText("1 flag")).toBeInTheDocument();
    const insureflow = within(list).getByText("InsureFlow").closest("li") as HTMLElement;
    // (The select's own "Evaluated" option shares the word — the BADGE is the span.)
    expect(within(insureflow).getAllByText("Evaluated").some((el) => el.tagName === "SPAN")).toBe(true);
    expect(within(taxpilot).getAllByText("Evaluated").every((el) => el.tagName === "OPTION")).toBe(true);
  });

  it("the status select carries the five-word vocabulary and records a recommendation", async () => {
    mountEvaluate();
    const select = (await screen.findByLabelText("Status for TaxPilot")) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "Shortlist",
      "Hold",
      "Need more info",
      "Reject",
      "Evaluated",
    ]);
    // Default for an unscored deck with no recommendation is the prototype's.
    expect(select.value).toBe("need_more_info");
    expect((screen.getByLabelText("Status for InsureFlow") as HTMLSelectElement).value).toBe("hold");

    fireEvent.change(select, { target: { value: "shortlist" } });
    await waitFor(() => expect(setRecommendation).toHaveBeenCalledWith("inc_deck_taxpilot", "shortlist"));
    expect((screen.getByLabelText("Status for TaxPilot") as HTMLSelectElement).value).toBe("shortlist");
  });

  it("a choice made before the recommendations fetch lands is not overwritten by it", async () => {
    // Found by the e2e: the list fetch is a mount effect, and on a busy dev
    // server it resolved AFTER the juror picked Hold — resetting the select.
    const pending: Array<(v: { recommendations: Record<string, never>; evaluated: string[] }) => void> = [];
    mountEvaluate("jury", () => new Promise((resolve) => pending.push(resolve)));
    const select = (await screen.findByLabelText("Status for TaxPilot")) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "hold" } });
    await waitFor(() => expect(setRecommendation).toHaveBeenCalledWith("inc_deck_taxpilot", "hold"));
    // The stale answers arrive (StrictMode may have asked twice): no stored
    // recommendation, and TaxPilot already evaluated — which alone would say "evaluated".
    expect(pending.length).toBeGreaterThan(0);
    pending.forEach((resolve) => resolve({ recommendations: {}, evaluated: ["inc_deck_taxpilot"] }));
    const row = select.closest("li") as HTMLElement;
    await waitFor(() => expect(within(row).getAllByText("Evaluated").some((el) => el.tagName === "SPAN")).toBe(true));
    expect((screen.getByLabelText("Status for TaxPilot") as HTMLSelectElement).value).toBe("hold");
  });

  it("opens on the caller's additional parameters at a glance; Review shows prompt, questions and anchors", async () => {
    mountEvaluate();
    const glance = await screen.findByRole("article", { name: "My additional parameters" });
    expect(within(glance).getByText("Your three additional parameters at a glance")).toBeInTheDocument();
    expect(within(glance).getByText("Defensibility vs new entrants.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Review Traction & Validation" }));
    const card = await screen.findByRole("article", { name: "Traction & Validation detail" });
    for (const heading of ["Evaluation prompt", "AI clarification questions (asked when signals are weak)", "Rubric anchors"]) {
      expect(within(card).getByText(heading)).toBeInTheDocument();
    }
    expect(within(card).getByText("Weight:")).toBeInTheDocument();
    expect(within(card).getByText("What is your strongest proof of customer demand?")).toBeInTheDocument();
    expect(within(card).getByText("Category traction.")).toBeInTheDocument();
    // A juror cannot reach Core Parameters, so there is no Configure to click.
    expect(within(card).queryByRole("link", { name: /Configure/ })).not.toBeInTheDocument();
  });

  it("Filter narrows the list; a deck row opens the workbench with nothing pre-scored", async () => {
    mountEvaluate();
    const list = await screen.findByRole("list", { name: "Decks to evaluate" });
    await within(list).findByText("TaxPilot");
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.change(screen.getByLabelText("Search decks"), { target: { value: "insure" } });
    expect(within(list).queryByText("TaxPilot")).not.toBeInTheDocument();
    expect(screen.getByTestId("ev-decks-label")).toHaveTextContent("1 deck · click to open report");
    fireEvent.change(screen.getByLabelText("Search decks"), { target: { value: "" } });

    fireEvent.click(within(list).getByText("TaxPilot"));
    const dialog = await screen.findByRole("dialog", { name: "Evaluate TaxPilot" });
    expect(within(dialog).getByLabelText("My score for Traction & Validation")).toHaveValue(null);
    expect(within(dialog).getByRole("button", { name: "Submit my evaluation" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: /Evaluation report/ })).toBeInTheDocument();
  });
});

// ── §9 (c) — authoring the delta and threshold on the org's scale ────────────

describe("Scoring framework authors the delta and threshold on the org's scale", () => {
  function mount(scale: ScoringSettings["scoreScale"]) {
    vi.mocked(getScoringFramework).mockResolvedValue({
      scoring: { ...DEFAULT_SCORING_SETTINGS, scoreScale: scale },
      thresholdBest: 7,
      thresholdMediocre: 5,
      editable: true,
    });
    vi.mocked(saveScoringFramework).mockResolvedValue({
      ok: true,
      scoring: { ...DEFAULT_SCORING_SETTINGS },
      rescored: { decks: 0, evaluations: 0 },
    } as never);
    vi.mocked(updateThresholds).mockResolvedValue({ ok: true, thresholdBest: 7, thresholdMediocre: 5 });
    const saved: { state: AdminSaveState | null } = { state: null };
    render(
      withAuth(
        <AdminSaveContext.Provider
          value={{
            register: (s) => {
              saved.state = s;
            },
          }}
        >
          <ScoringFrameworkSection />
        </AdminSaveContext.Provider>,
        "admin",
      ),
    );
    return saved;
  }

  it("is unchanged on a 0–10 org: 2 points and 7.0, stored as typed", async () => {
    const saved = mount("0-10");
    await screen.findByText("AI engine behaviour");
    expect(screen.getByLabelText("Override threshold (points)")).toHaveValue(2);
    expect(screen.getByLabelText("Shortlist threshold")).toHaveValue(7);
    expect(screen.getByText("Jury must explain overrides greater than 2 points from AI score")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Override threshold (points)"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Shortlist threshold"), { target: { value: "6.5" } });
    await waitFor(() => expect(saved.state?.dirty).toBe(true));
    await saved.state!.onSave();
    await waitFor(() =>
      expect(saveScoringFramework).toHaveBeenCalledWith(
        expect.objectContaining({ overrideRationaleDelta: 3, shortlistThreshold: 6.5 }),
      ),
    );
  });

  it("on a 1–5 org shows 0.8 and 3.8, and a typed 1 point / 4.0 is stored as 2.5 / 7.5 canonical", async () => {
    const saved = mount("1-5");
    await screen.findByText("AI engine behaviour");
    expect(screen.getByLabelText("Override threshold (points)")).toHaveValue(0.8);
    expect(screen.getByLabelText("Shortlist threshold")).toHaveValue(3.8);
    expect(screen.getByText("Jury must explain overrides greater than 0.8 points from AI score")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Override threshold (points)"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Shortlist threshold"), { target: { value: "4" } });
    await waitFor(() => expect(saved.state?.dirty).toBe(true));
    await saved.state!.onSave();
    await waitFor(() =>
      expect(saveScoringFramework).toHaveBeenCalledWith(
        expect.objectContaining({ overrideRationaleDelta: 2.5, shortlistThreshold: 7.5 }),
      ),
    );
  });
});
