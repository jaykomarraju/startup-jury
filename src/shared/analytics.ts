/**
 * Pure analytics aggregation (Phase 7). Every function takes plain row arrays and
 * returns a JSON-ready report shape — no DB, no Env, no I/O — so the whole module
 * is unit-testable at the node tier (like `scoring.ts`). The analytics routes in
 * `src/server/routes/analytics.ts` do the D1 queries and hand the rows here.
 *
 * The reports mirror the prototype panels (see the Phase 7 visual-gate notes):
 * incubator Cohort summary / Evaluator scores / Score drift / Pipeline funnel and
 * VC Pipeline funnel / Capital deployment / Portfolio construction / Scoring
 * summary / Diligence & risk / Decision history.
 */
import type { Edition } from "./roles";

// ── Small stat helpers ───────────────────────────────────────────────────────

export function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Population standard deviation (0 for <2 values). */
export function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

export function round(n: number, dp = 1): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function pct(n: number, total: number): number {
  return total === 0 ? 0 : Math.round((n / total) * 100);
}

// ── Pipeline funnel ──────────────────────────────────────────────────────────

export interface FunnelStageDef {
  label: string;
  /** Pipeline statuses that count as having *reached* this stage. */
  statuses: string[];
}

/**
 * Ordered main-funnel stages per edition. A deck's "reached index" is the highest
 * stage whose `statuses` include its current status; a deck contributes to every
 * bucket at or below that index (cumulative, monotonically non-increasing counts).
 * Terminal exits (rejected/incomplete/archived) fold back to the furthest stage
 * they demonstrably cleared.
 */
export const FUNNEL_STAGES: Record<Edition, FunnelStageDef[]> = {
  incubator: [
    { label: "Uploaded", statuses: ["uploaded", "pending_ai", "manual_review", "incomplete"] },
    { label: "AI Evaluated", statuses: ["ai_evaluated", "assigned", "rejected", "archived"] },
    { label: "Jury Evaluated", statuses: ["jury_evaluation", "shortlisted"] },
    { label: "Intro calls", statuses: ["intro"] },
    { label: "Sign ups", statuses: ["signup"] },
    { label: "Onboarded", statuses: ["onboard_ready"] },
  ],
  vc: [
    { label: "Sourced", statuses: ["uploaded", "pending_ai"] },
    { label: "Screened", statuses: ["analyst_scoring", "associate_review", "partner_review", "archived"] },
    { label: "Partner call", statuses: ["partner_call"] },
    { label: "Diligence", statuses: ["investment_dd"] },
    { label: "IC review", statuses: ["ic_review", "mp_decision"] },
    { label: "Term sheet", statuses: ["alignment_call", "term_sheet", "legal_dd"] },
    { label: "Closed", statuses: ["onboard_ready"] },
  ],
};

export interface FunnelRow {
  label: string;
  count: number;
  pctOfTop: number;
  /** Conversion from the previous stage (null for the first). */
  stepConversion: number | null;
}

export interface FunnelReport {
  rows: FunnelRow[];
  top: number;
  bottom: number;
  /** Overall top→bottom conversion, %. */
  conversion: number;
  biggestDropLabel: string | null;
  biggestDropPct: number;
}

/** Highest funnel index a status has reached (default 0 for unknown statuses). */
function reachedIndex(stages: FunnelStageDef[], status: string): number {
  let idx = 0;
  for (let i = 0; i < stages.length; i++) {
    if (stages[i].statuses.includes(status)) idx = i;
  }
  return idx;
}

export function buildFunnel(edition: Edition, statuses: string[]): FunnelReport {
  const stages = FUNNEL_STAGES[edition];
  const reached = statuses.map((s) => reachedIndex(stages, s));
  const counts = stages.map((_, i) => reached.filter((r) => r >= i).length);
  const top = counts[0] ?? 0;

  const rows: FunnelRow[] = stages.map((s, i) => ({
    label: s.label,
    count: counts[i],
    pctOfTop: pct(counts[i], top),
    stepConversion: i === 0 ? null : pct(counts[i], counts[i - 1]),
  }));

  // Biggest drop-off = the step with the largest absolute % loss of the top.
  let biggestDropLabel: string | null = null;
  let biggestDropPct = 0;
  for (let i = 1; i < counts.length; i++) {
    const drop = pct(counts[i - 1] - counts[i], top);
    if (drop > biggestDropPct) {
      biggestDropPct = drop;
      biggestDropLabel = `${stages[i - 1].label} → ${stages[i].label}`;
    }
  }

  return {
    rows,
    top,
    bottom: counts[counts.length - 1] ?? 0,
    conversion: pct(counts[counts.length - 1] ?? 0, top),
    biggestDropLabel,
    biggestDropPct,
  };
}

// ── Cohort summary (incubator) ───────────────────────────────────────────────

export interface CohortDeck {
  id: string;
  name: string;
  sector: string | null;
  stage: string | null;
  status: string;
  aiScore: number | null;
  topParam: string | null;
}

export interface DistributionBand {
  label: string;
  min: number;
  count: number;
}

export interface CohortSummary {
  evaluated: number;
  avgScore: number;
  recommended: number;
  inClarification: number;
  screenedOut: number;
  distribution: DistributionBand[];
  sectorMix: Array<{ label: string; count: number }>;
  ranking: Array<{
    id: string;
    name: string;
    sector: string | null;
    stage: string | null;
    score: number;
    topParam: string | null;
    recommendation: "Recommend" | "Hold · clarify" | "Pass";
  }>;
}

const RECOMMENDED_STATUSES = new Set(["shortlisted", "intro", "signup", "onboard_ready"]);
const CLARIFICATION_STATUSES = new Set(["incomplete", "manual_review"]);
const SCREENED_STATUSES = new Set(["rejected", "archived"]);

function recommendationFor(score: number, status: string): "Recommend" | "Hold · clarify" | "Pass" {
  if (RECOMMENDED_STATUSES.has(status)) return "Recommend";
  if (SCREENED_STATUSES.has(status) || score < 5) return "Pass";
  return "Hold · clarify";
}

export function cohortSummary(decks: CohortDeck[]): CohortSummary {
  const scored = decks.filter((d) => d.aiScore !== null) as Array<CohortDeck & { aiScore: number }>;
  const bands: DistributionBand[] = [
    { label: "9–10 Exceptional", min: 9, count: 0 },
    { label: "7–8 Strong", min: 7, count: 0 },
    { label: "5–6 Moderate", min: 5, count: 0 },
    { label: "3–4 Weak", min: 3, count: 0 },
    { label: "0–2 Absent", min: 0, count: 0 },
  ];
  for (const d of scored) {
    const band = bands.find((b) => d.aiScore >= b.min);
    if (band) band.count += 1;
  }

  const sectorCounts = new Map<string, number>();
  for (const d of decks) {
    const key = d.sector ?? "Other";
    sectorCounts.set(key, (sectorCounts.get(key) ?? 0) + 1);
  }
  const sectorMix = [...sectorCounts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);

  const ranking = [...scored]
    .sort((a, b) => b.aiScore - a.aiScore)
    .slice(0, 8)
    .map((d) => ({
      id: d.id,
      name: d.name,
      sector: d.sector,
      stage: d.stage,
      score: round(d.aiScore, 1),
      topParam: d.topParam,
      recommendation: recommendationFor(d.aiScore, d.status),
    }));

  return {
    evaluated: scored.length,
    avgScore: round(mean(scored.map((d) => d.aiScore)), 1),
    recommended: decks.filter((d) => RECOMMENDED_STATUSES.has(d.status)).length,
    inClarification: decks.filter((d) => CLARIFICATION_STATUSES.has(d.status)).length,
    screenedOut: decks.filter((d) => SCREENED_STATUSES.has(d.status)).length,
    distribution: bands,
    sectorMix,
    ranking,
  };
}

// ── Evaluator scores / calibration ───────────────────────────────────────────

/** One human evaluation roll-up: which evaluator scored which deck, and how high. */
export interface EvaluationRow {
  evaluatorId: string;
  evaluatorName: string;
  role: string;
  deckId: string;
  weightedTotal: number;
}

export interface EvaluatorStat {
  evaluatorId: string;
  name: string;
  role: string;
  decksScored: number;
  avgGiven: number;
  /** Evaluator's mean minus the cohort mean over the decks they scored. */
  vsCohort: number;
  /** Inter-rater agreement %, from mean absolute deviation vs the deck consensus. */
  agreement: number;
}

export interface EvaluatorReport {
  evaluators: EvaluatorStat[];
  cohortMean: number;
  avgAgreement: number;
  mostLenient: EvaluatorStat | null;
  strictest: EvaluatorStat | null;
}

/**
 * Per-evaluator calibration. "vs cohort" is a **leave-one-out** comparison: for
 * each deck, the evaluator's score minus the mean of the *other* evaluators on
 * that deck (a lenient scorer runs positive), averaged over the decks with ≥2
 * scorers. Including the evaluator's own score in the consensus would bias every
 * delta toward zero (and read exactly 0 on solo-scored decks), so solo decks are
 * excluded. Agreement = 100 − 10 × mean|leave-one-out deviation|, floored at 0.
 */
export function evaluatorScores(rows: EvaluationRow[]): EvaluatorReport {
  // Per-deck sum + count of all human scores (for leave-one-out consensus).
  const deckAgg = new Map<string, { sum: number; count: number }>();
  for (const r of rows) {
    const a = deckAgg.get(r.deckId) ?? { sum: 0, count: 0 };
    a.sum += r.weightedTotal;
    a.count += 1;
    deckAgg.set(r.deckId, a);
  }

  const byEval = new Map<string, EvaluationRow[]>();
  for (const r of rows) {
    const list = byEval.get(r.evaluatorId) ?? [];
    list.push(r);
    byEval.set(r.evaluatorId, list);
  }

  const evaluators: EvaluatorStat[] = [...byEval.values()].map((evalRows) => {
    const first = evalRows[0];
    const given = evalRows.map((r) => r.weightedTotal);
    const deltas: number[] = [];
    const devs: number[] = [];
    for (const r of evalRows) {
      const agg = deckAgg.get(r.deckId)!;
      if (agg.count < 2) continue; // no peers → no leave-one-out consensus
      const peerMean = (agg.sum - r.weightedTotal) / (agg.count - 1);
      deltas.push(r.weightedTotal - peerMean);
      devs.push(Math.abs(r.weightedTotal - peerMean));
    }
    return {
      evaluatorId: first.evaluatorId,
      name: first.evaluatorName,
      role: first.role,
      decksScored: evalRows.length,
      avgGiven: round(mean(given), 1),
      vsCohort: round(mean(deltas), 1),
      agreement: devs.length === 0 ? 100 : Math.max(0, Math.round(100 - 10 * mean(devs))),
    };
  });
  evaluators.sort((a, b) => b.avgGiven - a.avgGiven);

  const cohortMean = round(mean(rows.map((r) => r.weightedTotal)), 1);
  const withDelta = [...evaluators].sort((a, b) => b.vsCohort - a.vsCohort);
  return {
    evaluators,
    cohortMean,
    avgAgreement: Math.round(mean(evaluators.map((e) => e.agreement))),
    mostLenient: withDelta[0] ?? null,
    strictest: withDelta[withDelta.length - 1] ?? null,
  };
}

// ── Score drift (AI vs human final) ──────────────────────────────────────────

export interface DriftInput {
  deckId: string;
  name: string;
  aiScore: number;
  /** Final human score (mean of human evaluations for the deck). */
  humanScore: number;
}

export interface DriftRow {
  deckId: string;
  name: string;
  aiScore: number;
  humanScore: number;
  drift: number;
}

export interface DriftReport {
  rows: DriftRow[];
  avgDrift: number;
  bandChanges: number;
  revisedDown: number;
  /** % of decks where AI and human land in the same signal band. */
  agreement: number;
}

/** Signal band index for agreement/band-change accounting (0=absent … 3=strong). */
function band(score: number): number {
  if (score >= 8) return 3;
  if (score >= 5) return 2;
  if (score >= 2) return 1;
  return 0;
}

export function scoreDrift(inputs: DriftInput[]): DriftReport {
  const rows: DriftRow[] = inputs.map((i) => ({
    deckId: i.deckId,
    name: i.name,
    aiScore: round(i.aiScore, 1),
    humanScore: round(i.humanScore, 1),
    drift: round(i.humanScore - i.aiScore, 1),
  }));
  rows.sort((a, b) => b.drift - a.drift);
  const total = rows.length;
  const sameBand = rows.filter((r) => band(r.aiScore) === band(r.humanScore)).length;
  return {
    rows,
    avgDrift: round(mean(rows.map((r) => r.drift)), 1),
    bandChanges: rows.filter((r) => band(r.aiScore) !== band(r.humanScore)).length,
    revisedDown: rows.filter((r) => r.drift < 0).length,
    agreement: pct(sameBand, total),
  };
}

// ── Scoring summary (VC) ─────────────────────────────────────────────────────

export interface ScoringInput {
  deckId: string;
  name: string;
  aiScore: number | null;
  /** Human evaluation totals for the deck (one per evaluator). */
  humanScores: number[];
}

export interface ScoringRow {
  deckId: string;
  name: string;
  ai: number | null;
  evaluatorAvg: number | null;
  variance: number | null;
  spreadLow: number | null;
  spreadHigh: number | null;
  lean: "Invest" | "Hold" | "Need info" | "Pass";
}

export interface ScoringSummary {
  rows: ScoringRow[];
  avgScore: number;
  dealsScored: number;
  evaluators: number;
  avgVariance: number;
}

function leanFor(score: number | null): "Invest" | "Hold" | "Need info" | "Pass" {
  if (score === null) return "Need info";
  if (score >= 8) return "Invest";
  if (score >= 6.5) return "Hold";
  if (score >= 5) return "Need info";
  return "Pass";
}

/**
 * @param evaluatorCount distinct human evaluators (supplied by the caller, which
 *   has evaluator identity — the score arrays here don't carry it).
 */
export function scoringSummary(inputs: ScoringInput[], evaluatorCount: number): ScoringSummary {
  const rows: ScoringRow[] = inputs.map((i) => {
    const hasHuman = i.humanScores.length > 0;
    // Variance needs ≥2 scorers — a single score is not "0 disagreement".
    const multi = i.humanScores.length >= 2;
    const avg = hasHuman ? mean(i.humanScores) : null;
    return {
      deckId: i.deckId,
      name: i.name,
      ai: i.aiScore === null ? null : round(i.aiScore, 1),
      evaluatorAvg: avg === null ? null : round(avg, 1),
      variance: multi ? round(stddev(i.humanScores), 1) : null,
      spreadLow: hasHuman ? round(Math.min(...i.humanScores), 1) : null,
      spreadHigh: hasHuman ? round(Math.max(...i.humanScores), 1) : null,
      lean: leanFor(avg ?? i.aiScore),
    };
  });
  const scoredRows = rows.filter((r) => r.evaluatorAvg !== null);
  const varianceRows = rows.filter((r) => r.variance !== null);
  return {
    rows: rows.sort((a, b) => (b.ai ?? 0) - (a.ai ?? 0)),
    avgScore: round(mean(scoredRows.map((r) => r.evaluatorAvg as number)), 1),
    dealsScored: scoredRows.length,
    evaluators: evaluatorCount,
    avgVariance: round(mean(varianceRows.map((r) => r.variance as number)), 1),
  };
}

// ── Capital deployment (VC) ──────────────────────────────────────────────────

export interface PortfolioRow {
  deckId: string;
  name: string;
  sector: string | null;
  stage: string | null;
  city: string | null;
  capitalDeployed: number | null;
}

export interface CapitalReport {
  committed: number;
  deployed: number;
  dryPowder: number;
  deployedPct: number;
  companies: number;
  medianCheck: number;
  byCompany: Array<{ name: string; amount: number }>;
}

export function capitalDeployment(rows: PortfolioRow[], committed: number): CapitalReport {
  const funded = rows.filter((r) => r.capitalDeployed !== null && r.capitalDeployed > 0) as Array<
    PortfolioRow & { capitalDeployed: number }
  >;
  const deployed = funded.reduce((s, r) => s + r.capitalDeployed, 0);
  const amounts = funded.map((r) => r.capitalDeployed).sort((a, b) => a - b);
  const median =
    amounts.length === 0
      ? 0
      : amounts.length % 2
        ? amounts[(amounts.length - 1) / 2]
        : (amounts[amounts.length / 2 - 1] + amounts[amounts.length / 2]) / 2;
  return {
    committed,
    deployed: round(deployed, 1),
    dryPowder: round(Math.max(0, committed - deployed), 1),
    deployedPct: committed === 0 ? 0 : Math.round((deployed / committed) * 100),
    companies: funded.length,
    medianCheck: round(median, 1),
    byCompany: funded
      .map((r) => ({ name: r.name, amount: round(r.capitalDeployed, 1) }))
      .sort((a, b) => b.amount - a.amount),
  };
}

// ── Portfolio construction (VC) ──────────────────────────────────────────────

export interface MixSlice {
  label: string;
  count: number;
  pct: number;
}

export interface PortfolioReport {
  companies: number;
  medianCheck: number;
  sectors: number;
  sectorMix: MixSlice[];
  stageMix: MixSlice[];
  geoMix: MixSlice[];
}

function mix(values: Array<string | null>): MixSlice[] {
  const counts = new Map<string, number>();
  for (const v of values) {
    const key = v ?? "Other";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const total = values.length;
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count, pct: pct(count, total) }))
    .sort((a, b) => b.count - a.count);
}

export function portfolioConstruction(rows: PortfolioRow[]): PortfolioReport {
  const funded = rows.filter((r) => r.capitalDeployed !== null && r.capitalDeployed > 0) as Array<
    PortfolioRow & { capitalDeployed: number }
  >;
  const amounts = funded.map((r) => r.capitalDeployed).sort((a, b) => a - b);
  const median =
    amounts.length === 0
      ? 0
      : amounts.length % 2
        ? amounts[(amounts.length - 1) / 2]
        : (amounts[amounts.length / 2 - 1] + amounts[amounts.length / 2]) / 2;
  const sectorMix = mix(funded.map((r) => r.sector));
  return {
    companies: funded.length,
    medianCheck: round(median, 1),
    sectors: sectorMix.length,
    sectorMix,
    stageMix: mix(funded.map((r) => r.stage)),
    geoMix: mix(funded.map((r) => r.city)),
  };
}

// ── Decision history (VC) ────────────────────────────────────────────────────

export interface DecisionEvent {
  createdAt: string;
  company: string;
  action: string;
  actorName: string | null;
  note: string | null;
}

export type DecisionKind = "Invest" | "Pass" | "Revisit";

/** Map a pipeline action to an IC decision outcome (or null if not a decision). */
export function decisionKind(action: string): DecisionKind | null {
  switch (action) {
    case "invest":
    case "issue_term_sheet":
    case "complete_legal_dd":
      return "Invest";
    case "pass":
    case "pass_at_call":
    case "not_shortlisted":
    case "not_shortlisted_partner":
      return "Pass";
    case "return_to_partner":
    case "another_meeting":
      return "Revisit";
    default:
      return null;
  }
}

export interface DecisionRow {
  date: string;
  company: string;
  decision: DecisionKind;
  lead: string;
  note: string | null;
}

export interface DecisionReport {
  rows: DecisionRow[];
  total: number;
  invest: number;
  pass: number;
  revisit: number;
}

export function decisionHistory(events: DecisionEvent[]): DecisionReport {
  const rows: DecisionRow[] = [];
  for (const e of events) {
    const kind = decisionKind(e.action);
    if (!kind) continue;
    rows.push({
      date: e.createdAt,
      company: e.company,
      decision: kind,
      lead: e.actorName ?? "—",
      note: e.note,
    });
  }
  rows.sort((a, b) => (a.date < b.date ? 1 : -1));
  return {
    rows,
    total: rows.length,
    invest: rows.filter((r) => r.decision === "Invest").length,
    pass: rows.filter((r) => r.decision === "Pass").length,
    revisit: rows.filter((r) => r.decision === "Revisit").length,
  };
}
