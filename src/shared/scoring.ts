/**
 * Weighted scoring used across both editions, and the org-wide **scoring
 * framework** the admin console configures (`org_scoring_settings`, migration
 * 0026 — the prototype's `admin/s-fw.html`).
 *
 * W2-A re-cut this module so the three Score-composition controls are real:
 * `composite_formula` picks the aggregation, `ai_weight_pct` splits the
 * decision score, and `score_scale` governs the surface an evaluator types
 * into. None of them is cosmetic — a median composite computes a median.
 *
 * **Canonical storage is 0–10.** `scores.value` is a REAL 0–10 everywhere, and
 * so are the cohort thresholds, the shortlist threshold and the rubric bands.
 * `score_scale` is the *display and input* scale: a 1–5 organisation types a 4
 * and 8.0 is stored (`fromDisplayScale`), and 8.0 renders back as 4
 * (`toDisplayScale`). Converting at the edges is what keeps a threshold of 7.0
 * meaningful when an admin switches scales, and keeps every seeded score valid.
 */
import type { CompositeFormula, ScoreScale } from "./types";

export interface ParameterScore {
  weight: number;
  value: number;
}

/** Round to two decimals — every composite in this file lands here. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Aggregate per-parameter scores into one composite, per the org's configured
 * formula (`org_scoring_settings.composite_formula`).
 *
 * - `weighted_average` — Σ(w·v) / Σw. The historical behaviour and the default.
 * - `unweighted_average` — the plain mean.
 * - `median` — the middle value (mean of the two middles when even).
 *
 * The two unweighted formulas count only parameters that **participate** in the
 * composite, i.e. `weight > 0`. Callers hand this the full active parameter set
 * including the weight-0 informational / role-scoped ones; counting those
 * equally would silently pull every composite towards the assistive lens.
 */
export function composite(
  scores: ParameterScore[],
  formula: CompositeFormula = "weighted_average",
): number {
  if (formula === "weighted_average") {
    const totalWeight = scores.reduce((sum, p) => sum + p.weight, 0);
    if (totalWeight === 0) return 0;
    const weighted = scores.reduce((sum, p) => sum + p.weight * p.value, 0);
    return round2(weighted / totalWeight);
  }

  const values = scores.filter((p) => p.weight > 0).map((p) => p.value);
  if (values.length === 0) return 0;

  if (formula === "unweighted_average") {
    return round2(values.reduce((a, b) => a + b, 0) / values.length);
  }

  // median
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return round2(sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * The weight-average composite — `composite(scores, "weighted_average")`.
 * Kept as its own export because it is the default formula and the name every
 * existing call site and test uses.
 */
export function weightedTotal(scores: ParameterScore[]): number {
  return composite(scores, "weighted_average");
}

export type SignalTag = "strong" | "moderate" | "weak" | "absent";

/** Maps a 0–10 score to the rubric anchor band from the brand spec. */
export function signalTag(value: number): SignalTag {
  if (value >= 8) return "strong";
  if (value >= 5) return "moderate";
  if (value >= 2) return "weak";
  return "absent";
}

/**
 * Cohort rating band (Best / Mediocre / Poor) from the org's *configurable*
 * thresholds (org_settings.threshold_best/threshold_mediocre). Distinct from the
 * fixed rubric signal bands above — this is the admin-tunable classification the
 * dashboard cohort rail uses, so editing thresholds actually re-buckets decks.
 */
export type CohortRating = "best" | "mediocre" | "poor";

export function cohortRating(score: number, best: number, mediocre: number): CohortRating {
  if (score >= best) return "best";
  if (score >= mediocre) return "mediocre";
  return "poor";
}

/**
 * The deck's **decision score** — the number a shortlist decision is judged on,
 * and the composite form of the evaluator workbench's "Average" column.
 *
 * The workbench shows AI · My · Average per parameter, where Average blends the
 * two at the org's configured `ai_weight_pct` (prototype default 40 % AI ·
 * 60 % jury). The composite equivalent is the AI composite blended with the mean
 * of the human composites, so the floor a juror is held to is exactly the number
 * they are looking at. With no human evaluation yet it's just the AI composite;
 * with no AI score it's the human mean; with neither it's `null` (unscored).
 *
 * `aiWeightPct` defaults to **50** — the plain mean this function computed
 * before the setting existed — so a caller that has not loaded settings behaves
 * exactly as before. Every production call site passes the org's value.
 *
 * Used by the per-program shortlist floor and the org shortlist threshold.
 */
export function decisionScore(
  aiScore: number | null | undefined,
  humanTotals: number[] = [],
  aiWeightPct = 50,
): number | null {
  const finite = humanTotals.filter((v) => typeof v === "number" && Number.isFinite(v));
  const human = finite.length > 0 ? finite.reduce((a, b) => a + b, 0) / finite.length : null;
  const ai = typeof aiScore === "number" && Number.isFinite(aiScore) ? aiScore : null;
  if (ai === null && human === null) return null;
  if (ai === null) return round2(human!);
  if (human === null) return round2(ai);
  return round2(blendScore(ai, human, aiWeightPct));
}

/** Blend one AI value with one human value at the org's split (the Avg cell). */
export function blendScore(ai: number, human: number, aiWeightPct = 50): number {
  const w = Math.max(0, Math.min(100, aiWeightPct)) / 100;
  return ai * w + human * (1 - w);
}

// ═══════════════════════════════════════════════════════════════════════════
// Score scale — the display / input surface (canonical storage stays 0–10)
// ═══════════════════════════════════════════════════════════════════════════

export interface ScoreScaleBounds {
  min: number;
  max: number;
  /**
   * Input granularity. Specs §7: "Per-area score: integer/half-step 0–10 (step
   * 0.5)" — F0167. The 0–100 scale is whole numbers; it already has finer
   * resolution than a half-step out of ten.
   */
  step: number;
  /** The prototype's own select-option wording (`admin/s-fw.html`). */
  label: string;
  /** Decimals to render a value with on this scale. */
  decimals: number;
}

export const SCORE_SCALE_BOUNDS: Record<ScoreScale, ScoreScaleBounds> = {
  "0-10": { min: 0, max: 10, step: 0.5, label: "0 – 10 (default)", decimals: 1 },
  "1-5": { min: 1, max: 5, step: 0.5, label: "1 – 5", decimals: 1 },
  "0-100": { min: 0, max: 100, step: 1, label: "0 – 100", decimals: 0 },
};

/**
 * Convert a canonical 0–10 value to the org's display scale.
 *
 * Deliberately does NOT snap to `step`: this converts composites and averages
 * as well as individual scores, and quantising an average to the input's
 * granularity would print 5.5 where the composite is 5.6. The slider's own
 * `step` attribute governs the values an evaluator can *enter*.
 */
export function toDisplayScale(value: number, scale: ScoreScale): number {
  const b = SCORE_SCALE_BOUNDS[scale];
  const raw = b.min + (value / 10) * (b.max - b.min);
  return Math.max(b.min, Math.min(b.max, round2(raw)));
}

/**
 * A display-scale value snapped to the scale's input granularity — what a
 * slider shows. A score stored before the org changed scale can land between
 * two steps (8/10 is 4.2 on a 1–5 scale); the control shows the step it can
 * actually sit on.
 */
export function snapToScale(value: number, scale: ScoreScale): number {
  const b = SCORE_SCALE_BOUNDS[scale];
  const shown = toDisplayScale(value, scale);
  const snapped = b.min + Math.round((shown - b.min) / b.step) * b.step;
  return Math.max(b.min, Math.min(b.max, round2(snapped)));
}

/** Convert a value typed on the org's display scale back to canonical 0–10. */
export function fromDisplayScale(value: number, scale: ScoreScale): number {
  const b = SCORE_SCALE_BOUNDS[scale];
  const clamped = Math.max(b.min, Math.min(b.max, value));
  return round2(((clamped - b.min) / (b.max - b.min)) * 10);
}

/**
 * Render a canonical 0–10 value on the org's scale — `8` stays `8`, `7.55`
 * becomes `7.6`, and on a 1–5 scale `8` reads `4`. Whole numbers print plain,
 * which is what the workbench and the deck tables have always shown.
 */
export function formatScore(value: number, scale: ScoreScale = "0-10"): string {
  const b = SCORE_SCALE_BOUNDS[scale];
  const shown = toDisplayScale(value, scale);
  return Number.isInteger(shown) ? String(shown) : shown.toFixed(b.decimals);
}

/** The denominator the workbench prints beside a score ("/10", "/5", "/100"). */
export function scaleMax(scale: ScoreScale = "0-10"): number {
  return SCORE_SCALE_BOUNDS[scale].max;
}

// ═══════════════════════════════════════════════════════════════════════════
// The org scoring framework — the shared view of `org_scoring_settings`
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The thirteen controls of `admin/s-fw.html` plus the delta its copy names,
 * camel-cased for the API and the client. The two cohort-rating thresholds stay
 * on `org_settings` (threshold_best / threshold_mediocre) — see 0026's header.
 *
 * §1.2: the prototype's fourth transparency toggle, "Mentor can adjust
 * composite after all jury complete", is deliberately absent. `mentor` is a
 * directory record with no pipeline authority (commit 8822db2).
 */
export interface ScoringSettings {
  // Card 1 · AI engine behaviour
  aiPreScoringEnabled: boolean;
  autoClarification: boolean;
  showAiScoreToJury: boolean;
  requireOverrideRationale: boolean;
  overrideRationaleDelta: number;
  jurySeesPeerScores: boolean;
  // Card 2 · Score composition
  scoreScale: ScoreScale;
  compositeFormula: CompositeFormula;
  aiWeightPct: number;
  shortlistThreshold: number;
  // Card 3 · Score transparency & reports
  showThreeScoreView: boolean;
  showScoreDrift: boolean;
  includeAiEvidence: boolean;
  introCallAiPrompts: boolean;
}

/** Migration 0026's column defaults — the prototype's shipped ON/OFF state. */
export const DEFAULT_SCORING_SETTINGS: ScoringSettings = {
  aiPreScoringEnabled: true,
  autoClarification: true,
  showAiScoreToJury: true,
  requireOverrideRationale: true,
  overrideRationaleDelta: 2,
  jurySeesPeerScores: false,
  scoreScale: "0-10",
  compositeFormula: "weighted_average",
  aiWeightPct: 40,
  shortlistThreshold: 7,
  showThreeScoreView: true,
  showScoreDrift: true,
  includeAiEvidence: true,
  introCallAiPrompts: true,
};

/**
 * Signal below which an area counts as **weak** for the clarification loop —
 * the specs' §7 five-band scale, where 3–4 is Weak and 0–2 Insufficient, so
 * anything under 5 is worth asking the founder about.
 *
 * F0042: the shipped code derived this from `org_settings.threshold_mediocre`,
 * the *cohort rating* threshold, so an admin re-bucketing the All Decks
 * overview silently re-targeted founder questions. Two unrelated scales. This
 * constant is the rubric one. When W2-B's per-parameter `parameter_rubric_bands`
 * lands, the boundary should come from the Weak band's `max_score`.
 */
export const WEAK_SIGNAL_MAX = 5;

export function isWeakSignal(value: number): boolean {
  return value < WEAK_SIGNAL_MAX;
}

/**
 * Does this human score need a written rationale?
 *
 * `admin/s-fw.html`: "Jury must explain overrides greater than 2 points from AI
 * score". Strictly greater — a delta of exactly the threshold is fine. With no
 * AI score to override there is nothing to explain.
 */
export function overrideNeedsRationale(
  human: number,
  ai: number | null | undefined,
  settings: Pick<ScoringSettings, "requireOverrideRationale" | "overrideRationaleDelta">,
): boolean {
  if (!settings.requireOverrideRationale) return false;
  if (typeof ai !== "number" || !Number.isFinite(ai)) return false;
  return Math.abs(human - ai) > settings.overrideRationaleDelta;
}

/**
 * The shortlist floor a deck must clear: the programme's own `shortlist_min`
 * when it has one, otherwise the org-wide `shortlist_threshold` from the
 * Scoring framework (F0187 — the prototype puts a single org-wide field there
 * and the build only had the per-programme override).
 */
export function shortlistFloor(
  programMin: number | null | undefined,
  orgThreshold: number,
): { minimum: number; source: "program" | "org" } {
  return typeof programMin === "number" && Number.isFinite(programMin)
    ? { minimum: programMin, source: "program" }
    : { minimum: orgThreshold, source: "org" };
}

/**
 * Blind scoring (F0106). When "Show AI score to jury before they score" is off,
 * an evaluator who has not yet submitted must not receive the AI numbers **from
 * the API** — hiding them in the client is not blind scoring, it is a CSS rule.
 * Admins, superusers and anyone who is not an assignable evaluator are
 * unaffected: they oversee the workspace rather than score in it.
 */
export function withholdsAiScore(
  settings: Pick<ScoringSettings, "showAiScoreToJury">,
  viewer: { isEvaluator: boolean; hasSubmitted: boolean },
): boolean {
  if (settings.showAiScoreToJury) return false;
  return viewer.isEvaluator && !viewer.hasSubmitted;
}

// ═══════════════════════════════════════════════════════════════════════════
// Area weights — the `admin/s-wt.html` table's arithmetic
// ═══════════════════════════════════════════════════════════════════════════

/** The area-weights total the prototype's footer polices ("Total: 100% ✓"). */
export const REQUIRED_WEIGHT_TOTAL = 100;

export function weightTotal(weights: readonly number[]): number {
  return weights.reduce((sum, w) => sum + (Number.isFinite(w) ? w : 0), 0);
}

/** `admin/_scripts.js:256-259` — the three footer strings, verbatim. */
export function weightTotalMessage(total: number): { text: string; ok: boolean } {
  if (total === REQUIRED_WEIGHT_TOTAL) return { text: "Total: 100% ✓", ok: true };
  if (total < REQUIRED_WEIGHT_TOTAL) {
    return { text: `Total: ${total}% — ${REQUIRED_WEIGHT_TOTAL - total}% remaining`, ok: false };
  }
  return { text: `Total: ${total}% — over by ${total - REQUIRED_WEIGHT_TOTAL}%`, ok: false };
}

/** Bar fill width, `admin/_scripts.js:254`: `Math.min(v*3.3,100)+'%'`. */
export function weightBarWidth(weight: number): number {
  return Math.min(weight * 3.3, 100);
}
