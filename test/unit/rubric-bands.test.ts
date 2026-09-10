import { describe, it, expect } from "vitest";
import { RUBRIC_BANDS, rubricBand, type RubricBandKey } from "../../src/shared/types";
import { signalTag } from "../../src/shared/scoring";
import { cohortSummary, type CohortDeck } from "../../src/shared/analytics";

/**
 * The §1.5 defect: `shared/scoring.ts` labelled a score on a FOUR-band scale
 * (≥8 strong / ≥5 moderate / ≥2 weak / else absent) while `shared/analytics.ts`
 * bucketed the same score on the specs' FIVE (§7: v≥9 Exceptional, v≥7 Strong,
 * v≥5 Moderate, v≥3 Weak, else Insufficient). A 7.5 deck therefore read
 * "Moderate" on its own row and "7–8 Strong" in the cohort distribution.
 *
 * These tests hold both to ONE band table, `RUBRIC_BANDS`. If someone re-inlines
 * a band list in either module, the agreement test fails.
 */

function deck(aiScore: number): CohortDeck {
  return {
    id: `d${aiScore}`,
    name: `Deck ${aiScore}`,
    sector: "Climate",
    stage: "Seed",
    status: "ai_evaluated",
    aiScore,
    topParam: null,
  };
}

/** The distribution label a score lands in — analytics' view of the band. */
function analyticsBand(score: number): string {
  const s = cohortSummary([deck(score)]);
  return s.distribution.find((b) => b.count === 1)!.label;
}

describe("the one band table", () => {
  it("is the specs' five bands, highest first", () => {
    expect(RUBRIC_BANDS.map((b) => b.name)).toEqual([
      "Exceptional",
      "Strong",
      "Moderate",
      "Weak",
      "Insufficient",
    ]);
    expect(RUBRIC_BANDS.map((b) => b.min)).toEqual([9, 7, 5, 3, 0]);
  });

  it("maps a score by the spec's band(v) cut-points, half-steps included", () => {
    const cases: Array<[number, RubricBandKey]> = [
      [10, "exceptional"],
      [9, "exceptional"],
      [8.5, "strong"],
      [7, "strong"],
      [6.2, "moderate"],
      [5, "moderate"],
      [4.9, "weak"],
      [3, "weak"],
      [2.9, "insufficient"],
      [0, "insufficient"],
    ];
    for (const [value, key] of cases) expect(signalTag(value)).toBe(key);
  });

  it("gives scoring and analytics the SAME label for the same score", () => {
    // Every half-step 0 … 10 — the whole domain of a stored score.
    for (let v = 0; v <= 10; v += 0.5) {
      const fromScoring = signalTag(v);
      const fromAnalytics = analyticsBand(v);
      const band = RUBRIC_BANDS.find((b) => b.key === fromScoring)!;
      expect(fromAnalytics, `score ${v}`).toBe(`${band.label} ${band.name}`);
    }
  });

  it("no longer labels 0–2 'Absent' anywhere — the spec calls it Insufficient", () => {
    expect(analyticsBand(1)).toBe("0–2 Insufficient");
    expect(signalTag(1)).toBe("insufficient");
  });

  it("falls back to the lowest band below the scale rather than returning undefined", () => {
    expect(rubricBand(-1).key).toBe("insufficient");
  });
});
