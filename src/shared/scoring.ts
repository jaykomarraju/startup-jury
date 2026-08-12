/**
 * Weighted scoring used across both editions. Each parameter has a weight and a
 * 0–10 value; the weighted total is the weight-average, rounded to 2 decimals.
 * This is the seed of the rubric scoring logic expanded in later phases.
 */
export interface ParameterScore {
  weight: number;
  value: number;
}

export function weightedTotal(scores: ParameterScore[]): number {
  const totalWeight = scores.reduce((sum, p) => sum + p.weight, 0);
  if (totalWeight === 0) return 0;
  const weighted = scores.reduce((sum, p) => sum + p.weight * p.value, 0);
  return Math.round((weighted / totalWeight) * 100) / 100;
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
 * The workbench shows AI · My · Average per parameter, where Average = (AI + jury)
 * / 2. The composite equivalent is the AI weighted total averaged with the mean of
 * the human weighted totals, so the floor a juror is held to is exactly the number
 * they are looking at. With no human evaluation yet it's just the AI composite;
 * with no AI score it's the human mean; with neither it's `null` (unscored).
 *
 * Used by the per-program shortlist floor (Session 5, FINISH-PLAN §8).
 */
export function decisionScore(
  aiScore: number | null | undefined,
  humanTotals: number[] = [],
): number | null {
  const finite = humanTotals.filter((v) => typeof v === "number" && Number.isFinite(v));
  const human = finite.length > 0 ? finite.reduce((a, b) => a + b, 0) / finite.length : null;
  const ai = typeof aiScore === "number" && Number.isFinite(aiScore) ? aiScore : null;
  if (ai === null && human === null) return null;
  const combined = ai === null ? human! : human === null ? ai : (ai + human) / 2;
  return Math.round(combined * 100) / 100;
}
