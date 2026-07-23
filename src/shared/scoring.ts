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
