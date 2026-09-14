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
import { RUBRIC_BANDS, rubricBand } from "./types";

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
  /**
   * W8-A — the share of the previous stage lost at this step, the prototype's
   * red `▼ 54%` under each bar (`panel-funnel.html` `.fn-pct small`). Computed
   * from the counts, not as `100 − stepConversion`: 7 of 8 is a 12.5 % loss,
   * which the prototype prints as 13 and the complement of a rounded 88 would
   * print as 12. Null on the first stage and after an empty one.
   */
  stepDrop: number | null;
}

export interface FunnelReport {
  rows: FunnelRow[];
  top: number;
  bottom: number;
  /** Overall top→bottom conversion, %. */
  conversion: number;
  biggestDropLabel: string | null;
  biggestDropPct: number;
  /**
   * W8-A — the incubator KPI "Biggest drop-off": the largest `stepDrop`, so the
   * tile and the bar it names print the same number. `biggestDropPct` above is
   * the loss as a share of the TOP and stays for the VC screen, unchanged.
   */
  biggestStepDrop: { label: string; pct: number } | null;
  /** W8-A — "Intro → Onboard rate": bottom ÷ the "Intro calls" stage; null where the edition has no such stage. */
  introToOnboard: number | null;
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
    stepDrop: i === 0 || counts[i - 1] === 0 ? null : pct(counts[i - 1] - counts[i], counts[i - 1]),
  }));

  let biggestStepDrop: FunnelReport["biggestStepDrop"] = null;
  for (let i = 1; i < rows.length; i++) {
    const drop = rows[i].stepDrop;
    if (drop !== null && drop > 0 && (biggestStepDrop === null || drop > biggestStepDrop.pct)) {
      biggestStepDrop = { label: `${stages[i - 1].label} → ${stages[i].label}`, pct: drop };
    }
  }
  const introIdx = stages.findIndex((s) => s.label === "Intro calls");

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
    biggestStepDrop,
    introToOnboard: introIdx < 0 ? null : pct(counts[counts.length - 1] ?? 0, counts[introIdx]),
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
  /**
   * W8-A (F0797) — the mean human weighted total, when the deck has one. The
   * prototype's ranking is on FINAL scores (GreenGrid 8.7 is `panel-scoredrift`'s
   * "Final (juror)", not its 7.9 AI pre-score), so a deck is ranked, banded and
   * averaged on this, falling back to the AI score. Optional: the route supplies
   * it once `docs/parity-requests/W8-A-report-data.patch` is applied (§9).
   */
  finalScore?: number | null;
  /** W8-A — `decks.created_at`, for the report's "evaluation window". */
  createdAt?: string | null;
}

export interface CohortSummaryOptions {
  /**
   * W8-A (F0798) — decks with an UNANSWERED founder query. "In clarification —
   * awaiting founder input" is the query loop, not the intake states. When the
   * route does not supply it, the legacy intake-status reading is kept.
   */
  openQueryDeckIds?: ReadonlySet<string>;
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
  /** W8-A — "25% of cohort": recommended as a share of the decks evaluated. */
  recommendedPct: number;
  inClarification: number;
  screenedOut: number;
  /** W8-A — every deck in the report's population, scored or not. */
  total: number;
  /** W8-A — first and last `createdAt` among the evaluated decks (ISO), or null. */
  window: { from: string; to: string } | null;
  /** W8-A — how many ranked scores are a human final rather than the AI pre-score. */
  finalScored: number;
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

/** The prototype's Sector mix card shows exactly five rows, the last a rolled-up "Other" (F0877). */
export const SECTOR_MIX_ROWS = 5;

export function cohortSummary(decks: CohortDeck[], opts: CohortSummaryOptions = {}): CohortSummary {
  const scored = decks
    .map((d) => ({ ...d, score: d.finalScore ?? d.aiScore }))
    .filter((d): d is CohortDeck & { score: number } => d.score !== null);
  // W2-B — built from `RUBRIC_BANDS`, the one band table `shared/scoring.ts`
  // also derives from. It was hand-written here with a fifth label ("0–2
  // Absent") that matched neither the spec nor `signalTag`; that divergence was
  // the §1.5 defect. Do not re-inline these five rows.
  const bands: DistributionBand[] = RUBRIC_BANDS.map((b) => ({
    label: `${b.label} ${b.name}`,
    min: b.min,
    count: 0,
  }));
  for (const d of scored) bands[rubricBand(d.score).index].count += 1;

  const sectorCounts = new Map<string, number>();
  for (const d of decks) {
    const key = d.sector ?? "Other";
    sectorCounts.set(key, (sectorCounts.get(key) ?? 0) + 1);
  }
  const sorted = [...sectorCounts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
  // Top four named sectors, the rest folded into "Other" — a NULL sector is
  // already "Other", so it joins the roll-up rather than competing with it.
  const named = sorted.filter((s) => s.label !== "Other");
  const sectorMix =
    sorted.length <= SECTOR_MIX_ROWS
      ? sorted
      : [
          ...named.slice(0, SECTOR_MIX_ROWS - 1),
          {
            label: "Other",
            count:
              (sectorCounts.get("Other") ?? 0) +
              named.slice(SECTOR_MIX_ROWS - 1).reduce((n, s) => n + s.count, 0),
          },
        ];

  const ranking = [...scored]
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((d) => ({
      id: d.id,
      name: d.name,
      sector: d.sector,
      stage: d.stage,
      score: round(d.score, 1),
      topParam: d.topParam,
      recommendation: recommendationFor(d.score, d.status),
    }));

  const dates = scored
    .map((d) => d.createdAt)
    .filter((c): c is string => typeof c === "string" && c.length > 0)
    .sort();
  const recommended = decks.filter((d) => RECOMMENDED_STATUSES.has(d.status)).length;

  return {
    evaluated: scored.length,
    avgScore: round(mean(scored.map((d) => d.score)), 1),
    recommended,
    recommendedPct: pct(recommended, scored.length),
    inClarification: opts.openQueryDeckIds
      ? decks.filter((d) => opts.openQueryDeckIds!.has(d.id)).length
      : decks.filter((d) => CLARIFICATION_STATUSES.has(d.status)).length,
    screenedOut: decks.filter((d) => SCREENED_STATUSES.has(d.status)).length,
    total: decks.length,
    window: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
    finalScored: scored.filter((d) => d.finalScore !== null && d.finalScore !== undefined).length,
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
  /**
   * W8-A (F0808) — "Mean deviation from cohort" (±0.5): the mean |vs cohort|
   * across evaluators who had peers to be compared with. How far apart the
   * scorers are on average, whichever direction each one leans.
   */
  meanDeviation: number;
  /** W8-A — "206 deck-evaluations": every human evaluation the report rests on. */
  totalEvaluations: number;
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

  const compared = new Set<string>();
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
    if (deltas.length > 0) compared.add(first.evaluatorId);
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
    meanDeviation: round(mean(evaluators.filter((e) => compared.has(e.evaluatorId)).map((e) => Math.abs(e.vsCohort))), 1),
    totalEvaluations: rows.length,
    mostLenient: withDelta[0] ?? null,
    strictest: withDelta[withDelta.length - 1] ?? null,
  };
}

// ── Score drift (AI vs human final) ──────────────────────────────────────────

export interface DriftInput {
  deckId: string;
  name: string;
  /** The AI score before the clarification loop — `decks.ai_score` today, which a re-score overwrites. */
  aiScore: number;
  /** Final human score (mean of human evaluations for the deck). */
  humanScore: number;
  /**
   * W8-A (F0828) — the AI score after founder clarification, when one was
   * recorded. Nothing records it yet (`evaluateDeck` DELETEs the prior AI
   * roll-up on every re-score), so this is null everywhere today and the column
   * reads "—" rather than inventing a middle stage. §9 names the snapshot.
   */
  clarifiedScore?: number | null;
}

export interface DriftRow {
  deckId: string;
  name: string;
  aiScore: number;
  /** W8-A — "After clarification"; null when no post-clarification AI score was recorded. */
  clarifiedScore: number | null;
  humanScore: number;
  drift: number;
}

export type DriftTendency = "Lenient" | "Strict" | "Aligned";

export interface DriftReport {
  rows: DriftRow[];
  avgDrift: number;
  /**
   * W8-A — the mean drift to TWO places, from the unrounded scores: the jury
   * report prints `adrift.toFixed(2)` (`repRenderDrift`), and averaging
   * already-rounded row drifts would move the second place.
   */
  meanDrift: number;
  /** W8-A — "Lenient" / "Strict" / "Aligned", `repRenderDrift`'s ±0.05 rule on the unrounded mean. */
  tendency: DriftTendency;
  bandChanges: number;
  /** W8-A — "37% of cohort": band changes as a share of the decks compared. */
  bandChangePct: number;
  revisedDown: number;
  /** % of decks where AI and human land in the same signal band. */
  agreement: number;
  /**
   * W8-A (F0829) — "Where the drift comes from": mean movement per cause. A
   * cause with no recorded data is null, never 0 — "no clarification snapshot"
   * is not "clarification moved nothing". Juror override is the step the data
   * does hold: final − (after-clarification, else AI).
   */
  attribution: { clarification: number | null; juror: number | null; reevaluation: number | null };
  /**
   * Admin console → Scoring framework → "Show score drift analysis in reports"
   * is OFF: the route returns an empty report with this set, and the screens
   * render the turned-off state rather than the no-data one.
   */
  disabled?: true;
}

/**
 * The band a score falls in, as an index into `RUBRIC_BANDS`.
 *
 * W8-A — this was a private four-band table (`>=8` strong … `<2` absent) left
 * behind when W2-B moved every other surface onto the specs' five bands, so a
 * deck could be Strong on its row and a band lower in this report. It is the
 * shared table now; there is no second one to drift.
 */
export function driftBand(score: number): number {
  return rubricBand(score).index;
}

export function scoreDrift(inputs: DriftInput[]): DriftReport {
  const rows: DriftRow[] = inputs.map((i) => ({
    deckId: i.deckId,
    name: i.name,
    aiScore: round(i.aiScore, 1),
    clarifiedScore: i.clarifiedScore === null || i.clarifiedScore === undefined ? null : round(i.clarifiedScore, 1),
    humanScore: round(i.humanScore, 1),
    drift: round(i.humanScore - i.aiScore, 1),
  }));
  rows.sort((a, b) => b.drift - a.drift);
  const total = rows.length;
  const sameBand = rows.filter((r) => driftBand(r.aiScore) === driftBand(r.humanScore)).length;
  const bandChanges = total - sameBand;
  const exact = mean(inputs.map((i) => i.humanScore - i.aiScore));

  const clarified = inputs.filter(
    (i): i is DriftInput & { clarifiedScore: number } => i.clarifiedScore !== null && i.clarifiedScore !== undefined,
  );
  return {
    rows,
    avgDrift: round(mean(rows.map((r) => r.drift)), 1),
    meanDrift: round(exact, 2),
    tendency: exact > 0.05 ? "Lenient" : exact < -0.05 ? "Strict" : "Aligned",
    bandChanges,
    bandChangePct: pct(bandChanges, total),
    revisedDown: rows.filter((r) => r.drift < 0).length,
    agreement: pct(sameBand, total),
    attribution: {
      clarification: clarified.length ? round(mean(clarified.map((i) => i.clarifiedScore - i.aiScore)), 1) : null,
      juror: total ? round(mean(inputs.map((i) => i.humanScore - (i.clarifiedScore ?? i.aiScore))), 1) : null,
      reevaluation: null,
    },
  };
}

// ── Jury-personal reports (incubator) ────────────────────────────────────────

/** `repRenderDecks`' three evaluation states — whether the juror has finished THEIR scoring, not the deck's pipeline stage. */
export type MyDeckState = "submitted" | "draft" | "pending";

export const MY_DECK_STATE_LABEL: Record<MyDeckState, string> = {
  submitted: "Submitted",
  draft: "In draft",
  pending: "Pending",
};

export interface MyDeckInput {
  id: string;
  name: string;
  sector: string | null;
  /** The AI score, or null when there is none or blind scoring withholds it. */
  ai: number | null;
  /** The juror's own weighted total, or null until they score. */
  mine: number | null;
  state: MyDeckState;
  /** ISO timestamp of the juror's submission. */
  submittedAt: string | null;
}

export interface MyDecksReport {
  assigned: number;
  submitted: number;
  draft: number;
  pending: number;
  /** Mean of the juror's own scores (null with none). */
  avgMine: number | null;
  avgAi: number | null;
  /** "Status breakdown": count and % of assigned for each state, in the prototype's order. */
  breakdown: Array<{ state: MyDeckState; label: string; count: number; pct: number }>;
  rows: MyDeckInput[];
}

function meanOrNull(xs: Array<number | null>): number | null {
  const vals = xs.filter((x): x is number => x !== null);
  return vals.length ? round(mean(vals), 1) : null;
}

export function myDecksSummary(inputs: MyDeckInput[]): MyDecksReport {
  const count = (s: MyDeckState) => inputs.filter((i) => i.state === s).length;
  const states: MyDeckState[] = ["submitted", "draft", "pending"];
  return {
    assigned: inputs.length,
    submitted: count("submitted"),
    draft: count("draft"),
    pending: count("pending"),
    avgMine: meanOrNull(inputs.map((i) => i.mine)),
    avgAi: meanOrNull(inputs.map((i) => i.ai)),
    breakdown: states.map((state) => ({
      state,
      label: MY_DECK_STATE_LABEL[state],
      count: count(state),
      pct: pct(count(state), inputs.length),
    })),
    rows: inputs.map((i) => ({
      ...i,
      ai: i.ai === null ? null : round(i.ai, 1),
      mine: i.mine === null ? null : round(i.mine, 1),
    })),
  };
}

export interface MyScoreInput {
  id: string;
  name: string;
  /** Added by the §9 data patch; absent from the route's payload until then. */
  sector?: string | null;
  ai: number | null;
  mine: number;
}

export interface MyScoresSummary {
  rows: Array<MyScoreInput & { sector: string | null; delta: number | null }>;
  avgMine: number | null;
  avgAi: number | null;
  /** Decks the juror scored above the AI — `my > ai`, strictly. */
  above: number;
  below: number;
}

/** `repRenderScores`' four tiles over the juror's rows. A deck with no AI score counts toward neither side. */
export function myScoresSummary(inputs: MyScoreInput[]): MyScoresSummary {
  const rows = inputs.map((i) => ({
    ...i,
    sector: i.sector ?? null,
    delta: i.ai === null ? null : round(i.mine - i.ai, 1),
  }));
  return {
    rows,
    avgMine: meanOrNull(inputs.map((i) => i.mine)),
    avgAi: meanOrNull(inputs.map((i) => i.ai)),
    above: inputs.filter((i) => i.ai !== null && i.mine > i.ai).length,
    below: inputs.filter((i) => i.ai !== null && i.mine < i.ai).length,
  };
}

// ── Scoring summary (VC) ─────────────────────────────────────────────────────

export interface ScoringInput {
  deckId: string;
  name: string;
  aiScore: number | null;
  /** Human evaluation totals for the deck (one per evaluator). */
  humanScores: number[];
  /**
   * W9-D — blind scoring withheld the AI score from this viewer
   * (`withholdsAiScore`). The row then carries no AI number at all, and nothing
   * derived from one: not the lean, not its position in the sort.
   */
  aiWithheld?: boolean;
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
  /** W9-D — present (true) only when blind scoring withheld `ai` from this viewer. */
  aiWithheld?: true;
}

export interface ScoringSummary {
  rows: ScoringRow[];
  avgScore: number;
  dealsScored: number;
  evaluators: number;
  avgVariance: number;
}

/**
 * The Scoring Summary's Lean pill, from the evaluators' mean.
 *
 * W9-D — this held a private cut-point table (≥ 8 / ≥ 6.5 / ≥ 5), the defect
 * Waves 2, 7 and 8 removed from every other report: an 8.0 read "Invest" here
 * and "Strong" on the rubric, a 6.9 "Hold" beside a "Moderate" band. It reads
 * `RUBRIC_BANDS` now — Exceptional and Strong lean Invest, Moderate Hold, Weak
 * and Insufficient Pass. A deal no evaluator has scored is "Need info", which is
 * what `panel-scoring.html` shows for WealthOS (AI 7.8, evaluators pending):
 * the lean is the evaluators' call, never the AI's (§8 Q156).
 */
export function leanFor(evaluatorAvg: number | null): "Invest" | "Hold" | "Need info" | "Pass" {
  if (evaluatorAvg === null) return "Need info";
  const i = rubricBand(evaluatorAvg).index;
  return i <= 1 ? "Invest" : i === 2 ? "Hold" : "Pass";
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
      ai: i.aiWithheld || i.aiScore === null ? null : round(i.aiScore, 1),
      evaluatorAvg: avg === null ? null : round(avg, 1),
      variance: multi ? round(stddev(i.humanScores), 1) : null,
      spreadLow: hasHuman ? round(Math.min(...i.humanScores), 1) : null,
      spreadHigh: hasHuman ? round(Math.max(...i.humanScores), 1) : null,
      lean: leanFor(avg === null ? null : round(avg, 1)),
      ...(i.aiWithheld ? { aiWithheld: true as const } : {}),
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
  /** W9-D — when the position was recorded (`portfolio.onboarded_at`); feeds pacing by period. */
  onboardedAt?: string | null;
}

export interface CapitalReport {
  committed: number;
  /** Committed to specific deals (reserved), from the programs' fund_allocated. */
  allocated: number;
  deployed: number;
  dryPowder: number;
  deployedPct: number;
  /** Allocated as a share of the committed fund. */
  allocatedPct: number;
  companies: number;
  medianCheck: number;
  byCompany: Array<{ name: string; amount: number }>;
}

/**
 * Capital pacing for a VC edition. `committed` (total fund size) and `allocated`
 * (reserved to deals) come from the program-level fund fields; `deployed` is the
 * sum of the onboarded portfolio positions.
 */
export function capitalDeployment(
  rows: PortfolioRow[],
  committed: number,
  allocated = 0,
): CapitalReport {
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
    allocated: round(allocated, 1),
    deployed: round(deployed, 1),
    dryPowder: round(Math.max(0, committed - deployed), 1),
    deployedPct: committed === 0 ? 0 : Math.round((deployed / committed) * 100),
    allocatedPct: committed === 0 ? 0 : Math.round((allocated / committed) * 100),
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

// ═══════════════════════════════════════════════════════════════════════════
// W9-D — the VC reports' data the prototype panels draw and the shapes above
// did not carry. Everything here is additive; `VcReports.tsx` reads each field
// as optional, so a route without it still renders.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The fund a VC report is about. `loadFundTotals` sums every active programme
 * with a committed size, so the chip may only NAME a fund when exactly one
 * programme carries one — otherwise "Fund II" would label a sum of several.
 */
export function fundLabel(programs: Array<{ name: string; fundSize: number | null }>): string {
  const funded = programs.filter((p) => p.fundSize !== null && p.fundSize > 0);
  return funded.length === 1 ? funded[0].name : "All funds";
}

export interface PacingRow {
  year: number;
  /** The current calendar year, still running — the panel's "2026 (YTD)". */
  ytd: boolean;
  /** No deployment plan is modelled (§8 Q152): null, never a guess. */
  planned: number | null;
  actual: number;
  cumulative: number;
  variance: number | null;
}

/** `panel-capital.html` "Pacing against plan": capital deployed per calendar year, and running total. */
export function pacingByYear(rows: PortfolioRow[], now: Date): PacingRow[] {
  const byYear = new Map<number, number>();
  for (const r of rows) {
    if (r.capitalDeployed === null || r.capitalDeployed <= 0 || !r.onboardedAt) continue;
    const y = new Date(r.onboardedAt).getUTCFullYear();
    if (!Number.isFinite(y)) continue;
    byYear.set(y, (byYear.get(y) ?? 0) + r.capitalDeployed);
  }
  let cumulative = 0;
  return [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, actual]) => {
      cumulative += actual;
      return {
        year,
        ytd: year === now.getUTCFullYear(),
        planned: null,
        actual: round(actual, 1),
        cumulative: round(cumulative, 1),
        variance: null,
      };
    });
}

/**
 * `panel-portfolio.html` "Check-size mix": `< ₹3 Cr` · `₹3–8 Cr` · `₹8–20 Cr` ·
 * `> ₹20 Cr`. The labels leave both inner edges open; a bucket owns its LOWER
 * edge (₹3 Cr is 3–8, ₹8 Cr is 8–20) and "> ₹20 Cr" is strictly above, so
 * ₹20 Cr is 8–20 (§8 Q157).
 */
export const CHECK_SIZE_BUCKETS = ["< ₹3 Cr", "₹3–8 Cr", "₹8–20 Cr", "> ₹20 Cr"] as const;

export function checkSizeBucket(crore: number): number {
  return crore < 3 ? 0 : crore < 8 ? 1 : crore <= 20 ? 2 : 3;
}

export function checkSizeMix(rows: PortfolioRow[]): MixSlice[] {
  const amounts = rows.map((r) => r.capitalDeployed).filter((v): v is number => v !== null && v > 0);
  const counts = [0, 0, 0, 0];
  for (const a of amounts) counts[checkSizeBucket(a)]++;
  return CHECK_SIZE_BUCKETS.map((label, i) => ({ label, count: counts[i], pct: pct(counts[i], amounts.length) }));
}

/**
 * Evaluator disagreement a red flag is raised for: `panel-diligence.html` flags
 * CreditBridge "High evaluator disagreement (σ 1.4)", and `panel-scoring.html`
 * paints the same σ red where 0.9 and 0.6 are gold. Canonical 0–10 units.
 */
export const HIGH_DISAGREEMENT_SIGMA = 1;
/** Below this, `panel-scoring.html` paints σ olive (0.3); from it up to `HIGH_DISAGREEMENT_SIGMA`, gold. */
export const MODERATE_DISAGREEMENT_SIGMA = 0.5;

/** The panel's "Question" cell — a founder clarification's first line, shortened. */
export function clarificationQuestion(text: string, max = 80): string {
  const line = text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}
