import { describe, it, expect } from "vitest";
import { weightedTotal, signalTag, cohortRating } from "../../src/shared/scoring";

describe("weightedTotal", () => {
  it("returns 0 for no scores", () => {
    expect(weightedTotal([])).toBe(0);
  });

  it("computes a weight-average", () => {
    // (10*8 + 5*2) / (8+2) = 90/10 = 9
    expect(
      weightedTotal([
        { weight: 8, value: 10 },
        { weight: 2, value: 5 },
      ]),
    ).toBe(9);
  });

  it("rounds to two decimals", () => {
    // (10*1 + 7*1 + 6*1) / 3 = 23/3 = 7.666… -> 7.67
    expect(
      weightedTotal([
        { weight: 1, value: 10 },
        { weight: 1, value: 7 },
        { weight: 1, value: 6 },
      ]),
    ).toBe(7.67);
  });
});

describe("signalTag", () => {
  it("maps scores to rubric bands", () => {
    expect(signalTag(9)).toBe("strong");
    expect(signalTag(6)).toBe("moderate");
    expect(signalTag(3)).toBe("weak");
    expect(signalTag(1)).toBe("absent");
  });
});

describe("cohortRating", () => {
  it("buckets scores by the configurable thresholds (inclusive at each floor)", () => {
    // Best ≥ 7.0, Mediocre ≥ 5.0.
    expect(cohortRating(7.0, 7.0, 5.0)).toBe("best");
    expect(cohortRating(6.9, 7.0, 5.0)).toBe("mediocre");
    expect(cohortRating(5.0, 7.0, 5.0)).toBe("mediocre");
    expect(cohortRating(4.9, 7.0, 5.0)).toBe("poor");
  });

  it("re-buckets when the admin raises the bands", () => {
    // A 7.5 deck is Best at ≥7.0 but only Mediocre once Best is raised to 8.0.
    expect(cohortRating(7.5, 7.0, 5.0)).toBe("best");
    expect(cohortRating(7.5, 8.0, 6.0)).toBe("mediocre");
  });
});
