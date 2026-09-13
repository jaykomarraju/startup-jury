import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { AuthContext, type AuthUser } from "../../src/client/auth/AuthProvider";
import {
  CohortSummaryPage,
  EvaluatorScoresPage,
  ScoreDriftPage,
  FunnelPage,
} from "../../src/client/routes/analytics/IncubatorReports";
import { RepDecksPage, RepScoresPage, RepDriftPage } from "../../src/client/routes/analytics/JuryReports";
import {
  getCohortSummary,
  getEvaluatorScores,
  getScoreDrift,
  getFunnel,
  getMyDecks,
  getMyReportScores,
  getMyDrift,
} from "../../src/client/api";
import {
  buildFunnel,
  cohortSummary,
  evaluatorScores,
  myDecksSummary,
  scoreDrift,
  type CohortDeck,
  type MyDeckInput,
} from "../../src/shared/analytics";
import type { Edition, Role } from "../../src/shared/roles";

/**
 * W8-A — the seven reports' "report format", which is what the client named.
 *
 * Every header, KPI label, card heading and chart series name below is a
 * LITERAL copied from the prototype — `AISJ_IC_SuserV15/panel-{cohortsummary,
 * evaluatorscores,scoredrift,funnel}.html` for the staff reports and
 * `AISJ_IC_Jury_V4/_scripts.js` `repRenderDecks / repRenderScores /
 * repRenderDrift` for the jury's — never imported from the screen, so renaming
 * a column fails here.
 */

vi.mock("../../src/client/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/api")>()),
  getCohortSummary: vi.fn(),
  getEvaluatorScores: vi.fn(),
  getScoreDrift: vi.fn(),
  getFunnel: vi.fn(),
  getMyDecks: vi.fn(),
  getMyReportScores: vi.fn(),
  getMyDrift: vi.fn(),
}));

function mount(node: React.ReactNode, role: Role = "admin", edition: Edition = "incubator") {
  const user: AuthUser = { id: "u1", name: "Nisha Kapoor", initials: "NK", role, edition };
  return render(
    <AuthContext.Provider value={{ user, loading: false, login: vi.fn(), logout: vi.fn(), updateUser: vi.fn() }}>
      {node}
    </AuthContext.Provider>,
  );
}

const headers = () => screen.getAllByRole("columnheader").map((th) => th.textContent);
/** `.rep-kpi` labels in order (value first, label second). */
const repKpiLabels = () => screen.getAllByTestId("rep-kpi").map((t) => t.children[1].textContent);
/** `.sc` labels in order (label first). */
const scLabels = () => screen.getAllByTestId("sc-tile").map((t) => t.children[0].textContent);
const barLabels = (container: HTMLElement) =>
  within(container).getAllByTestId("rep-bar-row").map((r) => r.children[0].textContent);
const cardByTitle = (title: string) => screen.getByRole("heading", { level: 2, name: title }).closest("section")!;

beforeEach(() => vi.clearAllMocks());

// ── Staff reports ──────────────────────────────────────────────────────────

const COHORT: CohortDeck[] = [
  { id: "g", name: "GreenGrid Energy", sector: "CleanTech", stage: "Seed", status: "shortlisted", aiScore: 7.9, topParam: "Climate Impact & Integrity", finalScore: 8.7, createdAt: "2026-04-12T09:00:00Z" },
  { id: "f", name: "FinStack", sector: "Fintech", stage: "Seed", status: "intro", aiScore: 7.6, topParam: "Traction & Validation", createdAt: "2026-05-09T09:00:00Z" },
  { id: "w", name: "WealthOS", sector: "Wealthtech", stage: "Pre-seed", status: "ai_evaluated", aiScore: 6.9, topParam: null },
  { id: "c", name: "CreditBridge", sector: "Lending", stage: "Pre-seed", status: "rejected", aiScore: 4.3, topParam: null },
];

describe("Cohort summary", () => {
  it("renders the panel's five KPIs, both bar cards, the ranking columns and the reading note", async () => {
    vi.mocked(getCohortSummary).mockResolvedValue(cohortSummary(COHORT));
    mount(<CohortSummaryPage />);
    expect(await screen.findByText("GreenGrid Energy")).toBeInTheDocument();

    expect(screen.getByRole("heading", { level: 1, name: "Cohort summary" })).toBeInTheDocument();
    expect(
      screen.getByText("Aggregate evaluation view across an entire cohort — scoring distribution, recommendations and sector mix."),
    ).toBeInTheDocument();
    expect(repKpiLabels()).toEqual([
      "Decks evaluated",
      "Avg weighted score / 10",
      "Recommended for IC",
      "In clarification",
      "Screened out",
    ]);
    expect(screen.getByText("50% of cohort")).toBeInTheDocument();
    expect(screen.getByText("awaiting founder input")).toBeInTheDocument();
    expect(headers()).toEqual(["Startup", "Sector · Stage", "Score", "Top driver", "Recommendation"]);

    // Series names. The prototype's lowest band reads "0–2 Absent"; the specs'
    // five-band table (W2-B, §1.1 precedence) names it "Insufficient".
    expect(barLabels(cardByTitle("Score distribution"))).toEqual([
      "9–10 Exceptional",
      "7–8 Strong",
      "5–6 Moderate",
      "3–4 Weak",
      "0–2 Insufficient",
    ]);
    expect(barLabels(cardByTitle("Sector mix"))).toEqual(["CleanTech", "Fintech", "Wealthtech", "Lending"]);
    expect(cardByTitle("Top of cohort — weighted ranking")).toBeInTheDocument();

    // Ranked on the final score (8.7), not the AI pre-score (7.9); Pass is the red pill.
    const row = screen.getByText("GreenGrid Energy").closest("tr")!;
    expect(within(row).getByText("8.7")).toBeInTheDocument();
    expect(screen.getByText("Pass")).toHaveAttribute("data-pill", "no");
    expect(screen.getByTestId("report-meta")).toHaveTextContent(
      "All cohorts · 4 decks · evaluation window 12 Apr – 9 May 2026 · generated for IC review",
    );
    expect(screen.getByText("AI read of the cohort:")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export PDF" })).toBeInTheDocument();
  });

  it("has an empty state when nothing is scored", async () => {
    vi.mocked(getCohortSummary).mockResolvedValue(cohortSummary([]));
    mount(<CohortSummaryPage />);
    expect(await screen.findByText("No decks evaluated yet")).toBeInTheDocument();
    expect(screen.queryAllByRole("columnheader")).toHaveLength(0);
  });
});

describe("Evaluator scores", () => {
  it("renders five KPIs, the calibration columns, the prototype's role words and the flat band", async () => {
    vi.mocked(getEvaluatorScores).mockResolvedValue(
      evaluatorScores([
        { evaluatorId: "a", evaluatorName: "Arjun Verma", role: "jury", deckId: "d1", weightedTotal: 8 },
        { evaluatorId: "m", evaluatorName: "Meera Singh", role: "program_associate", deckId: "d1", weightedTotal: 6 },
        { evaluatorId: "v", evaluatorName: "Vikram Nair", role: "admin", deckId: "d1", weightedTotal: 7 },
      ]),
    );
    mount(<EvaluatorScoresPage />);
    expect(await screen.findByText("Arjun Verma")).toBeInTheDocument();

    expect(repKpiLabels()).toEqual([
      "Active evaluators",
      "Avg inter-rater agreement",
      "Mean deviation from cohort",
      "Most lenient scorer",
      "Strictest scorer",
    ]);
    expect(headers()).toEqual(["Evaluator", "Role", "Decks scored", "Avg given", "vs cohort", "Agreement"]);
    expect(cardByTitle("Evaluator calibration")).toBeInTheDocument();
    expect(screen.getByText("Arjun V.")).toBeInTheDocument();
    expect(screen.getByText("Meera S.")).toBeInTheDocument();
    expect(screen.getByText("Jury member")).toBeInTheDocument();
    expect(screen.getByText("Admin / analyst")).toBeInTheDocument();
    expect(screen.getByTestId("report-meta")).toHaveTextContent(
      `3 active evaluators · 3 deck-evaluations · "vs cohort" = evaluator's mean minus the cohort mean for the decks they scored`,
    );
    // Vikram Nair sits exactly at the peers' mean → .rep-flat, not red.
    const vikram = screen.getByText("Vikram Nair").closest("tr")!;
    expect(within(vikram).getByText("0.0")).toHaveAttribute("data-tone", "flat");
    const meera = screen.getByText("Meera Singh").closest("tr")!;
    expect(within(meera).getByText("−1.5")).toHaveAttribute("data-tone", "down");
  });
});

describe("Score drift", () => {
  const rows = [
    { deckId: "g", name: "GreenRoute", aiScore: 6.4, humanScore: 7.6 },
    { deckId: "c", name: "CreditBridge", aiScore: 5.2, humanScore: 4.3 },
  ];

  it("renders four KPIs, the five-column journey and the three attribution series", async () => {
    vi.mocked(getScoreDrift).mockResolvedValue(scoreDrift(rows));
    mount(<ScoreDriftPage />);
    expect(await screen.findByText("GreenRoute")).toBeInTheDocument();

    expect(
      screen.getByText(
        "How a deck's score moves from the AI pre-score through clarification and human review — and where the movement comes from.",
      ),
    ).toBeInTheDocument();
    expect(repKpiLabels()).toEqual([
      "Avg drift after clarification",
      "Decks that changed band",
      "AI ↔ final agreement",
      "Decks revised downward",
    ]);
    expect(headers()).toEqual(["Startup", "AI pre-score", "After clarification", "Final (juror)", "Net drift"]);
    expect(cardByTitle("Score journey — AI to final")).toBeInTheDocument();
    expect(barLabels(cardByTitle("Where the drift comes from"))).toEqual([
      "Clarification responses",
      "Juror override & remark",
      "Re-evaluation pass",
    ]);
    expect(screen.getByTestId("report-meta")).toHaveTextContent(
      "Tracks AI pre-score → post-clarification → final juror score across 2 decks",
    );
    expect(screen.getByText("▲ +1.2")).toBeInTheDocument();
    expect(screen.getByText("▼ −0.9")).toBeInTheDocument();
    // No clarification snapshot exists: the column says so rather than inventing one.
    const greenRoute = screen.getByText("GreenRoute").closest("tr")!;
    expect(within(greenRoute).getAllByRole("cell")[2]).toHaveTextContent("—");
  });

  it("empty and turned-off are different states", async () => {
    vi.mocked(getScoreDrift).mockResolvedValue(scoreDrift([]));
    const empty = mount(<ScoreDriftPage />);
    expect(await screen.findByText("No score drift yet")).toBeInTheDocument();
    expect(screen.queryByText("Score drift analysis is turned off")).not.toBeInTheDocument();
    empty.unmount();

    vi.mocked(getScoreDrift).mockResolvedValue({ ...scoreDrift([]), disabled: true });
    mount(<ScoreDriftPage />);
    expect(await screen.findByText("Score drift analysis is turned off")).toBeInTheDocument();
    expect(screen.getByText(/Show score drift analysis in reports/)).toBeInTheDocument();
    expect(screen.queryByText("No score drift yet")).not.toBeInTheDocument();
  });
});

describe("Pipeline funnel", () => {
  const statuses = [
    ...Array(13).fill("uploaded"),
    ...Array(3).fill("ai_evaluated"),
    "jury_evaluation",
    "intro",
    "intro",
    "signup",
    ...Array(4).fill("onboard_ready"),
  ];

  it("incubator: four KPIs, six coloured stage bars with red step losses, and the breakdown columns", async () => {
    vi.mocked(getFunnel).mockResolvedValue(buildFunnel("incubator", statuses));
    mount(<FunnelPage />);
    const chart = await screen.findByTestId("funnel-chart");

    expect(screen.getByRole("heading", { level: 1, name: "Pipeline funnel" })).toBeInTheDocument();
    expect(repKpiLabels()).toEqual(["Decks uploaded", "Onboarded", "Biggest drop-off", "Intro → Onboard rate"]);
    expect(screen.getByText("−54%")).toBeInTheDocument();
    expect(screen.getByText("Uploaded → AI Evaluated")).toBeInTheDocument();
    expect(screen.getByText("57%")).toBeInTheDocument();
    expect(screen.getByText("17% of uploaded")).toBeInTheDocument();
    expect(headers()).toEqual(["Stage", "Count", "% of uploaded", "Step conversion"]);

    const stageRows = within(chart).getAllByTestId("funnel-row");
    expect(stageRows.map((r) => r.children[0].textContent)).toEqual([
      "Uploaded",
      "AI Evaluated",
      "Jury Evaluated",
      "Intro calls",
      "Sign ups",
      "Onboarded",
    ]);
    expect(stageRows.map((r) => (r.children[1].firstElementChild as HTMLElement).style.background)).toEqual([
      "var(--olive-dk)",
      "var(--olive)",
      "var(--blue)",
      "var(--gold-dk)",
      "var(--amber)",
      "var(--green)",
    ]);
    expect(within(chart).getAllByText(/^▼ /).map((s) => s.textContent)).toEqual(["▼ 54%", "▼ 27%", "▼ 13%", "▼ 29%", "▼ 20%"]);
    expect(cardByTitle("Stage breakdown")).toBeInTheDocument();
    expect(screen.getByTestId("report-meta")).toHaveTextContent(
      "All cohorts · 24 decks uploaded · 4 onboarded (17%) · generated for IC review",
    );
  });

  it("VC: the shared route keeps the pre-W8-A VC screen exactly (W9-D's)", async () => {
    vi.mocked(getFunnel).mockResolvedValue(buildFunnel("vc", ["uploaded", "analyst_scoring", "onboard_ready"]));
    mount(<FunnelPage />, "admin", "vc");
    expect(await screen.findByText("Funnel — Sourced to Closed")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Pipeline Funnel" })).toBeInTheDocument();
    expect(headers()).toEqual(["Stage", "Count", "% of top", "Step conversion"]);
    expect(screen.getByText("Deals sourced")).toBeInTheDocument();
    expect(screen.getByText("Overall conversion")).toBeInTheDocument();
    expect(screen.queryByTestId("funnel-chart")).not.toBeInTheDocument();
  });
});

// ── Jury reports ───────────────────────────────────────────────────────────

const MY: MyDeckInput[] = [
  { id: "g", name: "GreenRoute", sector: "Climatetech", ai: 9.1, mine: 8.9, state: "submitted", submittedAt: "2026-06-09T10:00:00Z" },
  { id: "w", name: "WealthOS", sector: "Wealthtech", ai: 7.8, mine: 7.6, state: "draft", submittedAt: null },
  { id: "t", name: "TaxPilot", sector: "B2B SaaS", ai: null, mine: null, state: "pending", submittedAt: null },
];

describe("My decks summary", () => {
  it("renders the six tiles, the status breakdown series and the deck activity columns", async () => {
    vi.mocked(getMyDecks).mockResolvedValue(myDecksSummary(MY) as never);
    mount(<RepDecksPage />, "jury");
    expect(await screen.findByText("GreenRoute")).toBeInTheDocument();

    expect(screen.getByText("Your evaluation activity at a glance")).toBeInTheDocument();
    expect(scLabels()).toEqual(["Assigned", "Submitted", "In draft", "Pending", "Avg my score", "Avg AI score"]);
    expect(screen.getByRole("heading", { level: 2, name: "Status breakdown" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Deck activity" })).toBeInTheDocument();
    expect(
      within(screen.getByTestId("status-bars"))
        .getAllByTestId("status-bar")
        .map((b) => b.firstElementChild!.childNodes[1].textContent),
    ).toEqual(["Submitted", "In draft", "Pending"]);
    expect(headers()).toEqual(["Startup", "Status", "My score", "AI score", "Submitted"]);

    const green = screen.getByText("GreenRoute").closest("tr")!;
    expect(within(green).getByText("Climatetech")).toBeInTheDocument(); // sname() sector line
    expect(within(green).getByText("9 Jun 2026")).toBeInTheDocument();
    expect(screen.getByText("TaxPilot").closest("tr")!.querySelector("[data-state]")).toHaveTextContent("Pending");
    // No export on the jury panels — their topbar is title + subtitle only.
    expect(screen.queryByRole("button", { name: "Export PDF" })).not.toBeInTheDocument();
  });

  it("reads the pre-patch payload as submitted decks without inventing scores it does not have", async () => {
    vi.mocked(getMyDecks).mockResolvedValue({
      evaluated: 1,
      avgGiven: 7.2,
      shortlisted: 0,
      pending: 0,
      decks: [{ id: "x", name: "LegacyCo", status: "jury_evaluation", score: 7.2 }],
    } as never); // the pre-patch payload; `never` so the test still typechecks once api.ts re-types it
    mount(<RepDecksPage />, "jury");
    const row = (await screen.findByText("LegacyCo")).closest("tr")!;
    expect(within(row).getByText("Submitted")).toBeInTheDocument();
    expect(within(row).getAllByRole("cell")[3]).toHaveTextContent("—");
  });

  it("has an empty state", async () => {
    vi.mocked(getMyDecks).mockResolvedValue(myDecksSummary([]) as never);
    mount(<RepDecksPage />, "jury");
    expect(await screen.findByText("No decks assigned to you yet")).toBeInTheDocument();
  });
});

describe("My Scores", () => {
  it("renders the four tiles and the prototype's headers, with a neutral zero delta", async () => {
    vi.mocked(getMyReportScores).mockResolvedValue({
      rows: [
        { id: "d", name: "DataForge", ai: 7.6, mine: 7.9 },
        { id: "c", name: "CreditBridge", ai: 6.4, mine: 5.9 },
        { id: "z", name: "ZeroCo", ai: 7.0, mine: 7.0 },
      ],
    });
    mount(<RepScoresPage />, "jury");
    expect(await screen.findByText("DataForge")).toBeInTheDocument();

    expect(screen.getByText("How you scored each deck vs the AI baseline")).toBeInTheDocument();
    expect(scLabels()).toEqual(["Avg my score", "Avg AI score", "Above AI", "Below AI"]);
    expect(screen.getByRole("heading", { level: 2, name: "My score vs AI score" })).toBeInTheDocument();
    expect(headers()).toEqual(["Startup", "AI score", "My score", "Δ (my − AI)"]);
    const zero = within(screen.getByText("ZeroCo").closest("tr")!).getByText("0.0");
    expect(zero).toHaveStyle({ color: "var(--text-3)" });
  });
});

describe("My scores drift", () => {
  it("renders the three tiles, the per-deck heading and its reading note", async () => {
    vi.mocked(getMyDrift).mockResolvedValue(
      scoreDrift([
        { deckId: "g", name: "GreenRoute", aiScore: 9.1, humanScore: 8.9 },
        { deckId: "d", name: "DataForge", aiScore: 7.6, humanScore: 8.0 },
      ]),
    );
    mount(<RepDriftPage />, "jury");
    const bars = await screen.findByTestId("axis-drift");

    expect(scLabels()).toEqual(["Avg drift", "Tendency", "Decks"]);
    expect(screen.getByText("+0.10")).toBeInTheDocument(); // toFixed(2): (−0.2 + 0.4) / 2
    expect(screen.getByText("Lenient")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Per-deck drift (my score − AI score)" })).toBeInTheDocument();
    expect(screen.getByText("Bars right of centre = you scored higher than the AI; left = lower.")).toBeInTheDocument();
    expect(within(bars).getAllByTestId("axis-drift-row").map((r) => r.children[0].textContent)).toEqual([
      "DataForge",
      "GreenRoute",
    ]);
    expect(screen.queryAllByRole("columnheader")).toHaveLength(0);
  });

  it("empty and turned-off are different states", async () => {
    vi.mocked(getMyDrift).mockResolvedValue(scoreDrift([]));
    const empty = mount(<RepDriftPage />, "jury");
    expect(await screen.findByText("No drift yet")).toBeInTheDocument();
    expect(screen.queryByText("Score drift analysis is turned off")).not.toBeInTheDocument();
    empty.unmount();

    vi.mocked(getMyDrift).mockResolvedValue({ ...scoreDrift([]), disabled: true });
    mount(<RepDriftPage />, "jury");
    expect(await screen.findByText("Score drift analysis is turned off")).toBeInTheDocument();
    expect(screen.queryByText("No drift yet")).not.toBeInTheDocument();
  });
});
