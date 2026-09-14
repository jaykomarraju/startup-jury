import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import {
  VcFunnelPage,
  CapitalPage,
  PortfolioPage,
  ScoringPage,
  DiligencePage,
  DecisionsPage,
  fmtShare,
  fmtCr,
  sectorRows,
  signalName,
  varianceColor,
  fmtDecisionDate,
  type VcCapitalPayload,
  type VcDiligencePayload,
  type VcPortfolioPayload,
  type VcScoringPayload,
} from "../../src/client/routes/analytics/VcReports";
import { getFunnel, getCapital, getPortfolio, getScoringSummary, getDiligence, getDecisions } from "../../src/client/api";
import { scoringSettings } from "../../src/client/routes/admin/scoringApi";
import {
  buildFunnel,
  capitalDeployment,
  decisionHistory,
  portfolioConstruction,
  scoringSummary,
  type PortfolioRow,
} from "../../src/shared/analytics";
import { DEFAULT_SCORING_SETTINGS } from "../../src/shared/scoring";

/**
 * W9-D — the six VC reports' "report format", which is what the client named.
 *
 * Every header, KPI label, card heading, subtitle and bar-series name below is a
 * LITERAL copied from `AISJ_VC_Superuser_V8/panel-{funnel,capital,portfolio,
 * scoring,diligence,decisions}.html` (the VC builds render these panels as
 * static markup — there is no JS renderer to copy from) — never imported from
 * the screen, so renaming a column fails here. The four other VC role builds
 * carry the same panels; only the funnel's subtitle differs (see below).
 */

vi.mock("../../src/client/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/api")>()),
  getFunnel: vi.fn(),
  getCapital: vi.fn(),
  getPortfolio: vi.fn(),
  getScoringSummary: vi.fn(),
  getDiligence: vi.fn(),
  getDecisions: vi.fn(),
}));

vi.mock("../../src/client/routes/admin/scoringApi", () => ({ scoringSettings: vi.fn() }));

const headers = () => screen.getAllByRole("columnheader").map((th) => th.textContent);
/** Header sets per table, in page order. */
const tableHeaders = () =>
  screen.getAllByRole("table").map((t) => within(t).getAllByRole("columnheader").map((th) => th.textContent));
const repKpiLabels = () => screen.getAllByTestId("rep-kpi").map((t) => t.children[1].textContent);
const repKpiValues = () => screen.getAllByTestId("rep-kpi").map((t) => t.children[0].textContent);
const cardTitles = () => screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
const cardByTitle = (title: string) => screen.getByRole("heading", { level: 2, name: title }).closest("section")!;
const barLabels = (card: HTMLElement) => within(card).getAllByTestId("rep-bar-row").map((r) => r.children[0].textContent);
const barValues = (card: HTMLElement) => within(card).getAllByTestId("rep-bar-row").map((r) => r.children[2].textContent);
const barWidths = (card: HTMLElement) =>
  within(card)
    .getAllByTestId("rep-bar-row")
    .map((r) => (r.children[1].firstElementChild as HTMLElement).style.width);
const chip = () => document.querySelector("span.tbb")?.textContent;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(scoringSettings).mockResolvedValue({ ...DEFAULT_SCORING_SETTINGS });
});

// ── Pipeline Funnel ──────────────────────────────────────────────────────────

const FUNNEL_STATUSES = [
  ...Array(4).fill("uploaded"),
  ...Array(2).fill("analyst_scoring"),
  "partner_call",
  "investment_dd",
  "ic_review",
  "term_sheet",
  ...Array(2).fill("onboard_ready"),
];

describe("Pipeline Funnel (VC)", () => {
  it("renders the panel's tiles, the stage bars and the breakdown columns", async () => {
    vi.mocked(getFunnel).mockResolvedValue(buildFunnel("vc", FUNNEL_STATUSES));
    render(<VcFunnelPage />);
    expect(await screen.findByRole("table")).toBeInTheDocument();

    expect(screen.getByRole("heading", { level: 1, name: "Pipeline Funnel" })).toBeInTheDocument();
    expect(screen.getByText("Stage-by-stage counts and conversion rates from Sourced to Closed.")).toBeInTheDocument();
    expect(screen.queryByText(/Limited to deals in your pipeline\./)).toBeNull();
    expect(screen.getByRole("button", { name: "Export PDF" })).toBeInTheDocument();

    expect(repKpiLabels()).toEqual(["Deals sourced", "Closed", "Biggest drop-off", "Term sheet → Close"]);
    // Reached counts 12 · 8 · 6 · 5 · 4 · 3 · 2. The biggest step loss is Sourced → Screened (4 of 12,
    // tied with the last step and named first); 2 of 3 term sheets closed.
    expect(repKpiValues()).toEqual(["12", "2", "−33%", "67%"]);
    expect(screen.getByText("Sourced → Screened")).toBeInTheDocument();
    expect(screen.getByText("17% of sourced")).toBeInTheDocument();

    expect(cardTitles()).toEqual(["Funnel — Sourced to Closed", "Stage breakdown & conversion"]);
    expect(headers()).toEqual(["Stage", "Count", "% of sourced", "Step conversion"]);
    // The pipeline's seven gates (§8 Q154 — the panel draws six).
    expect(barLabels(cardByTitle("Funnel — Sourced to Closed"))).toEqual([
      "Sourced",
      "Screened",
      "Partner call",
      "Diligence",
      "IC review",
      "Term sheet",
      "Closed",
    ]);
    expect(screen.getByTestId("report-meta").textContent).toBe(
      "All deals · all time · 12 sourced · 2 closed (17%) · generated for IC review",
    );
  });

  it("stage bars carry the panel's hues, not one flat colour", async () => {
    vi.mocked(getFunnel).mockResolvedValue(buildFunnel("vc", FUNNEL_STATUSES));
    render(<VcFunnelPage />);
    const card = (await screen.findByRole("heading", { level: 2, name: "Funnel — Sourced to Closed" })).closest("section")!;
    const fills = within(card)
      .getAllByTestId("rep-bar-row")
      .map((r) => (r.children[1].firstElementChild as HTMLElement).style.background);
    expect(fills[0]).toBe("var(--olive-dk)");
    expect(fills[1]).toBe("var(--olive)");
    expect(fills[6]).toBe("var(--green)");
    expect(new Set(fills).size).toBe(7);
  });

  it("a pipeline-scoped payload adds the role builds' subtitle sentence", async () => {
    vi.mocked(getFunnel).mockResolvedValue({ ...buildFunnel("vc", FUNNEL_STATUSES), scope: "mine" } as never);
    render(<VcFunnelPage />);
    expect(await screen.findByRole("table")).toBeInTheDocument();
    // `AISJ_VC_{Partner_V1,IC_member_V2,Associate_V1,Analyst_V1}/panel-funnel.html`, verbatim.
    expect(
      screen.getByText("Stage-by-stage counts and conversion rates from Sourced to Closed. Limited to deals in your pipeline."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("report-meta").textContent).toMatch(/^Your pipeline · /);
  });

  it("empty: no deals sourced", async () => {
    vi.mocked(getFunnel).mockResolvedValue(buildFunnel("vc", []));
    const { container } = render(<VcFunnelPage />);
    expect(await screen.findByText("No deals sourced yet")).toBeInTheDocument();
    expect(container.querySelector('[data-report-state="empty"]')).not.toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

// ── Capital Deployment & Pacing ──────────────────────────────────────────────

const POSITIONS: PortfolioRow[] = [
  { deckId: "q", name: "QuantIQ", sector: "AI Infra", stage: "Series B", city: "Bengaluru", capitalDeployed: 22 },
  { deckId: "g", name: "GridZero", sector: "Climatetech", stage: "Seed", city: "Bengaluru", capitalDeployed: 8 },
  { deckId: "f", name: "FinStack", sector: "Fintech", stage: "Series A", city: "Mumbai", capitalDeployed: 12 },
  { deckId: "i", name: "InsureFlow", sector: "Fintech", stage: "Seed", city: "Bengaluru", capitalDeployed: 6 },
  { deckId: "a", name: "AgriChain", sector: "AgriTech", stage: "Seed", city: "Hyderabad", capitalDeployed: 2 },
];

describe("Capital Deployment & Pacing", () => {
  it("renders the panel's four tiles, both cards' series and the pacing columns — slots where no model exists", async () => {
    vi.mocked(getCapital).mockResolvedValue(capitalDeployment(POSITIONS, 300, 210));
    render(<CapitalPage />);
    expect(await screen.findByRole("heading", { level: 2, name: "Pacing against plan" })).toBeInTheDocument();

    expect(screen.getByRole("heading", { level: 1, name: "Capital Deployment & Pacing" })).toBeInTheDocument();
    expect(screen.getByText("Deployed vs. dry powder, reserves, pace against plan.")).toBeInTheDocument();
    expect(chip()).toBe("All funds · ₹300 Cr");

    expect(repKpiLabels()).toEqual(["Deployed", "Dry powder", "Reserves earmarked", "Pace vs. plan"]);
    expect(repKpiValues()).toEqual(["₹50 Cr", "₹250 Cr", "—", "—"]);
    expect(screen.getByText("17% of fund")).toBeInTheDocument();

    expect(cardTitles().slice(0, 2)).toEqual(["Deployed vs. dry powder", "Pacing against plan"]);
    const bars = cardByTitle("Deployed vs. dry powder");
    expect(barLabels(bars)).toEqual(["Deployed (new)", "Deployed (follow-on)", "Reserves (held)", "Uncommitted"]);
    expect(barValues(bars)).toEqual(["₹50 Cr", "—", "—", "₹250 Cr"]);
    // Against the whole fund, not the largest bar.
    expect(barWidths(bars)[0]).toBe("17%");

    expect(tableHeaders()).toEqual([["Period", "Planned", "Actual", "Cumulative", "Variance"]]);
    expect(screen.getByText("No deployments recorded by period yet.")).toBeInTheDocument();
    expect(screen.getByText(/No deployment plan or follow-on reserve is recorded for this fund/)).toBeInTheDocument();
    // The repo-only card stays, below the prototype's two (F0888).
    expect(cardTitles()[2]).toBe("Capital by company");
  });

  it("with the §9 data: the fund's name on the chip and pacing rows by year", async () => {
    const payload: VcCapitalPayload = {
      ...capitalDeployment(POSITIONS, 300, 210),
      fund: { label: "Fund II" },
      reserves: null,
      paceVsPlan: null,
      deployedFollowOn: null,
      pacing: [
        { year: 2025, ytd: false, planned: null, actual: 20, cumulative: 20, variance: null },
        { year: 2026, ytd: true, planned: null, actual: 30, cumulative: 50, variance: null },
      ],
    };
    vi.mocked(getCapital).mockResolvedValue(payload);
    render(<CapitalPage />);
    const table = await screen.findByRole("table");
    expect(chip()).toBe("Fund II · ₹300 Cr");
    const rows = within(table).getAllByRole("row").slice(1).map((r) => [...r.children].map((c) => c.textContent));
    expect(rows).toEqual([
      ["2025", "—", "₹20 Cr", "₹20 Cr", "—"],
      ["2026 (YTD)", "—", "₹30 Cr", "₹50 Cr", "—"],
    ]);
    expect(screen.queryByText("No deployments recorded by period yet.")).toBeNull();
  });

  it("empty: no capital deployed", async () => {
    vi.mocked(getCapital).mockResolvedValue(capitalDeployment([], 300, 0));
    render(<CapitalPage />);
    expect(await screen.findByText("No capital deployed yet")).toBeInTheDocument();
  });
});

// ── Portfolio Construction ───────────────────────────────────────────────────

describe("Portfolio Construction", () => {
  it("renders the four tiles, the 2×2 cards, the thesis table's columns and every mix series", async () => {
    vi.mocked(getPortfolio).mockResolvedValue(portfolioConstruction(POSITIONS));
    render(<PortfolioPage />);
    expect(await screen.findByRole("table")).toBeInTheDocument();

    expect(screen.getByRole("heading", { level: 1, name: "Portfolio Construction" })).toBeInTheDocument();
    expect(screen.getByText("Sector, stage, geography, and check-size mix vs. thesis.")).toBeInTheDocument();
    expect(chip()).toBe("All funds · 5 companies");

    expect(repKpiLabels()).toEqual(["Active companies", "Median check", "Sectors", "Follow-on rate"]);
    expect(repKpiValues()).toEqual(["5", "₹8 Cr", "4", "—"]);
    expect(cardTitles()).toEqual(["Sector mix vs. thesis", "Stage mix", "Geography", "Check-size mix"]);
    expect(headers()).toEqual(["Sector", "Actual", "Target", "Drift"]);
    expect(barLabels(cardByTitle("Check-size mix"))).toEqual(["< ₹3 Cr", "₹3–8 Cr", "₹8–20 Cr", "> ₹20 Cr"]);
    expect(barValues(cardByTitle("Check-size mix"))).toEqual(["—", "—", "—", "—"]);
    expect(barLabels(cardByTitle("Stage mix"))).toEqual(["Seed", "Series B", "Series A"]);
    // A mix bar is drawn against 100 %, as the panel draws 33 % at width 33 %.
    expect(barWidths(cardByTitle("Stage mix"))[0]).toBe("60%");
    expect(screen.getByText(/No fund thesis targets are recorded/)).toBeInTheDocument();
  });

  it("with the §9 data: check-size buckets and the deployed total in the meta line", async () => {
    const payload: VcPortfolioPayload = {
      ...portfolioConstruction(POSITIONS),
      deployed: 50,
      checkSizeMix: [
        { label: "< ₹3 Cr", count: 1, pct: 20 },
        { label: "₹3–8 Cr", count: 1, pct: 20 },
        { label: "₹8–20 Cr", count: 2, pct: 40 },
        { label: "> ₹20 Cr", count: 1, pct: 20 },
      ],
      followOnRate: null,
    };
    vi.mocked(getPortfolio).mockResolvedValue(payload);
    render(<PortfolioPage />);
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(barValues(cardByTitle("Check-size mix"))).toEqual(["20%", "20%", "40%", "20%"]);
    expect(screen.getByTestId("report-meta").textContent).toBe("5 active companies · ₹50 Cr deployed");
  });

  it("empty: no portfolio companies", async () => {
    vi.mocked(getPortfolio).mockResolvedValue(portfolioConstruction([]));
    render(<PortfolioPage />);
    expect(await screen.findByText("No portfolio companies yet")).toBeInTheDocument();
  });
});

// ── Scoring Summary ──────────────────────────────────────────────────────────

const SCORING = scoringSummary(
  [
    { deckId: "g", name: "GreenRoute", aiScore: 9.1, humanScores: [8.8, 9.0] },
    { deckId: "c", name: "CreditBridge", aiScore: 6.4, humanScores: [4.0, 6.6, 7.0] },
    { deckId: "f", name: "FinStack", aiScore: 7.2, humanScores: [6.0, 7.8] },
    { deckId: "w", name: "WealthOS", aiScore: 7.8, humanScores: [] },
  ],
  5,
);

describe("Scoring Summary", () => {
  it("renders the tiles, the aggregated table's columns, and the highest-variance bars with their note", async () => {
    vi.mocked(getScoringSummary).mockResolvedValue(SCORING);
    render(<ScoringPage />);
    expect(await screen.findByRole("table")).toBeInTheDocument();

    expect(screen.getByRole("heading", { level: 1, name: "Scoring Summary" })).toBeInTheDocument();
    expect(screen.getByText("Aggregated deal scores with evaluator variance.")).toBeInTheDocument();
    expect(repKpiLabels()).toEqual(["Avg. deal score", "Deals scored", "Evaluators", "Avg. variance"]);
    expect(screen.getByText("std. dev across scorers")).toBeInTheDocument();
    expect(cardTitles()).toEqual(["Aggregated scores & evaluator variance", "Highest-variance deals"]);
    expect(headers()).toEqual(["Startup", "AI", "Evaluator avg", "Variance", "Spread", "Lean"]);

    const variance = cardByTitle("Highest-variance deals");
    // Population σ: CreditBridge 1.3, FinStack 0.9, GreenRoute 0.1; WealthOS has no second score.
    expect(barLabels(variance)).toEqual(["CreditBridge", "FinStack", "GreenRoute"]);
    const fills = within(variance)
      .getAllByTestId("rep-bar-row")
      .map((r) => (r.children[1].firstElementChild as HTMLElement).style.background);
    expect(fills).toEqual(["var(--red)", "var(--gold-dk)", "var(--olive)"]);
    expect(
      within(variance).getByText(
        "CreditBridge shows the widest evaluator disagreement (σ 1.3) — recommend a calibration discussion before the IC vote.",
      ),
    ).toBeInTheDocument();
    // Scored by one evaluator or none → the panel's grey "pending".
    const wealth = screen.getByText("WealthOS").closest("tr")!;
    expect(within(wealth).getByText("pending")).toBeInTheDocument();
  });

  it("renders scores on the org's display scale", async () => {
    vi.mocked(scoringSettings).mockResolvedValue({ ...DEFAULT_SCORING_SETTINGS, scoreScale: "1-5" });
    vi.mocked(getScoringSummary).mockResolvedValue(SCORING);
    render(<ScoringPage />);
    const green = (await screen.findByText("GreenRoute", { selector: "td" })).closest("tr")!;
    // On 1–5: AI 9.1 → 4.6 (1 + 0.91 × 4), avg 8.9 → 4.6, σ 0.1 → 0.04 (a distance: no offset), spread 8.8–9.0 → 4.5–4.6.
    await waitFor(() =>
      expect([...green.children].map((c) => c.textContent)).toEqual(["GreenRoute", "4.6", "4.6", "0.04", "4.5–4.6", "Invest"]),
    );
  });

  it("blind scoring on: a withheld AI score is its own state, not a missing one", async () => {
    const payload: VcScoringPayload = {
      ...SCORING,
      rows: SCORING.rows.map((r) => (r.name === "FinStack" ? { ...r, ai: null, aiWithheld: true } : r)),
    };
    vi.mocked(getScoringSummary).mockResolvedValue(payload);
    render(<ScoringPage />);
    const fin = (await screen.findByText("FinStack", { selector: "td" })).closest("tr")!;
    expect(within(fin).getByText("hidden")).toBeInTheDocument();
    expect(screen.getByText(/The AI score is hidden on 1 deal you have not scored yet — blind scoring is on\./)).toBeInTheDocument();
    const wealth = screen.getByText("WealthOS").closest("tr")!;
    expect(within(wealth).queryByText("hidden")).toBeNull();
  });

  it("no variance yet: the card says why instead of drawing nothing", async () => {
    vi.mocked(getScoringSummary).mockResolvedValue(
      scoringSummary([{ deckId: "w", name: "WealthOS", aiScore: 7.8, humanScores: [] }], 0),
    );
    render(<ScoringPage />);
    expect(await screen.findByText("Variance appears once a deal has two or more evaluator scores.")).toBeInTheDocument();
  });

  it("empty: no deals scored", async () => {
    vi.mocked(getScoringSummary).mockResolvedValue(scoringSummary([], 0));
    render(<ScoringPage />);
    expect(await screen.findByText("No deals scored yet")).toBeInTheDocument();
  });
});

// ── Diligence & Risk Status ──────────────────────────────────────────────────

const DILIGENCE: VcDiligencePayload = {
  inDiligence: 3,
  redFlags: 1,
  clarifications: 1,
  onTrack: 2,
  items: [
    { company: "SolarNest", stage: "investment_dd", signal: "strong", status: "In progress" },
    { company: "CreditBridge", stage: "ic_review", signal: "weak", status: "Flagged" },
    { company: "CyberVault", stage: "legal_dd", signal: "exceptional", status: "In progress" },
  ],
  flags: [{ company: "CreditBridge", flag: "Weak overall signal" }],
};

describe("Diligence & Risk Status", () => {
  it("renders the tiles and every card's exact columns, in the panel's order", async () => {
    vi.mocked(getDiligence).mockResolvedValue(DILIGENCE);
    render(<DiligencePage />);
    expect(await screen.findAllByRole("table")).toHaveLength(4);

    expect(screen.getByRole("heading", { level: 1, name: "Diligence & Risk Status" })).toBeInTheDocument();
    expect(screen.getByText("Open items, red flags, and founder clarifications.")).toBeInTheDocument();
    expect(chip()).toBe("Active diligence");
    expect(repKpiLabels()).toEqual(["Open items", "Red flags", "Founder clarifications", "On track"]);
    expect(repKpiValues()).toEqual(["—", "1", "1", "2"]);
    expect(cardTitles()).toEqual(["Open diligence items", "Red flags", "Founder clarifications", "Companies in diligence"]);
    expect(tableHeaders()).toEqual([
      ["Item", "Company", "Owner", "Status"],
      ["Company", "Flag"],
      ["Company", "Question", "Status"],
      ["Company", "Stage", "Signal", "Status"],
    ]);
    expect(screen.getByTestId("report-meta").textContent).toBe("3 companies in diligence · status as of today");
    expect(screen.getByText("No diligence checklist items are recorded yet.")).toBeInTheDocument();
    // The band NAME from RUBRIC_BANDS — never the stored key, and never a retired band.
    const credit = within(cardByTitle("Companies in diligence")).getByText("CreditBridge").closest("tr")!;
    expect(within(credit).getByText("Weak")).toBeInTheDocument();
    // The pipeline's own stage label, not a title-cased status key ("Ic Review").
    expect(within(credit).getByText("IC Review")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/absent/i);
  });

  it("with the §9 data: founder clarification rows with Answered / Pending pills", async () => {
    const payload: VcDiligencePayload = {
      ...DILIGENCE,
      clarificationRows: [
        { company: "SolarNest", question: "Churn definition", status: "Answered" },
        { company: "CreditBridge", question: "Client concentration", status: "Pending" },
      ],
    };
    vi.mocked(getDiligence).mockResolvedValue(payload);
    render(<DiligencePage />);
    const card = (await screen.findByRole("heading", { level: 2, name: "Founder clarifications" })).closest("section")!;
    expect(within(card).getByText("Churn definition")).toBeInTheDocument();
    expect(within(card).getByText("Answered").getAttribute("data-pill")).toBe("go");
    expect(within(card).getByText("Pending").getAttribute("data-pill")).toBe("hold");
  });

  it("empty: no deals in diligence", async () => {
    vi.mocked(getDiligence).mockResolvedValue({ ...DILIGENCE, inDiligence: 0, items: [], flags: [] });
    render(<DiligencePage />);
    expect(await screen.findByText("No deals in diligence")).toBeInTheDocument();
  });
});

// ── Decision History ─────────────────────────────────────────────────────────

describe("Decision History", () => {
  it("renders the tiles with their shares and the log's five columns", async () => {
    vi.mocked(getDecisions).mockResolvedValue(
      decisionHistory([
        { createdAt: "2026-06-12T09:00:00Z", company: "GreenRoute", action: "invest", actorName: "M. Sharma", note: "Term sheet issued, ₹3 Cr" },
        { createdAt: "2026-06-10T09:00:00Z", company: "CreditBridge", action: "pass", actorName: "R. Kumar", note: "Weak unit economics" },
        { createdAt: "2026-06-08T09:00:00Z", company: "FinStack", action: "return_to_partner", actorName: "V. Nair", note: null },
        { createdAt: "2026-06-05T09:00:00Z", company: "AgriChain", action: "invest", actorName: "M. Sharma", note: null },
      ]),
    );
    render(<DecisionsPage />);
    expect(await screen.findByRole("table")).toBeInTheDocument();

    expect(screen.getByRole("heading", { level: 1, name: "Decision History" })).toBeInTheDocument();
    expect(screen.getByText("Log of past Invest / Pass / Revisit outcomes.")).toBeInTheDocument();
    expect(repKpiLabels()).toEqual(["Total decisions", "Invest", "Pass", "Revisit"]);
    expect(repKpiValues()).toEqual(["4", "2", "1", "1"]);
    expect(cardTitles()).toEqual(["Decision log"]);
    expect(headers()).toEqual(["Date", "Company", "Decision", "IC lead", "Note"]);
    const first = screen.getAllByRole("row")[1];
    expect([...first.children].map((c) => c.textContent)).toEqual([
      "12 Jun 2026",
      "GreenRoute",
      "Invest",
      "M. Sharma",
      "Term sheet issued, ₹3 Cr",
    ]);
    expect(screen.getByTestId("report-meta").textContent).toBe("Complete IC decision log · 5 Jun 2026 – 12 Jun 2026");
  });

  it("empty: no decisions recorded", async () => {
    vi.mocked(getDecisions).mockResolvedValue(decisionHistory([]));
    render(<DecisionsPage />);
    expect(await screen.findByText("No decisions recorded yet")).toBeInTheDocument();
  });
});

// ── Formatting ───────────────────────────────────────────────────────────────

describe("VC report formatting", () => {
  it("fmtShare prints the funnel panel's figures: whole from 10 %, one decimal below", () => {
    expect([96, 28, 14, 8, 6, 320].map((n) => fmtShare(n, 320))).toEqual(["30%", "8.8%", "4.4%", "2.5%", "1.9%", "100%"]);
    expect(fmtShare(1, 0)).toBe("0%");
  });

  it("fmtCr prints whole crores plain", () => {
    expect([fmtCr(182), fmtCr(11.5), fmtCr(10.04)]).toEqual(["₹182 Cr", "₹11.5 Cr", "₹10 Cr"]);
  });

  it("sectorRows collapses past five into the panel's 'Other'", () => {
    const mix = ["A", "B", "C", "D", "E", "F"].map((label, i) => ({ label, count: 6 - i, pct: 0 }));
    expect(sectorRows(mix, 21).map((r) => r.label)).toEqual(["A", "B", "C", "D", "Other"]);
    expect(sectorRows(mix, 21)[4].pct).toBe(14); // (2 + 1) / 21
  });

  it("varianceColor reproduces the panel's σ colours: 1.4 red, 0.9 and 0.6 gold, 0.3 olive", () => {
    expect([1.4, 0.9, 0.6, 0.3].map(varianceColor)).toEqual(["var(--red)", "var(--gold-dk)", "var(--gold-dk)", "var(--olive)"]);
  });

  it("signalName reads RUBRIC_BANDS — the five names, and a dash for anything else", () => {
    expect(["exceptional", "strong", "moderate", "weak", "insufficient", "absent", null].map(signalName)).toEqual([
      "Exceptional",
      "Strong",
      "Moderate",
      "Weak",
      "Insufficient",
      "—",
      "—",
    ]);
  });

  it("fmtDecisionDate is the panel's '12 Jun 2026'", () => {
    expect(fmtDecisionDate("2026-06-05T23:30:00Z")).toBe("5 Jun 2026");
  });
});
