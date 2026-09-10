import { describe, it, expect } from "vitest";
import {
  REQUIRED_WEIGHT_TOTAL,
  SCORE_SCALE_BOUNDS,
  WEAK_SIGNAL_MAX,
  cohortRating,
  composite,
  decisionScore,
  formatScore,
  fromDisplayScale,
  isWeakSignal,
  overrideNeedsRationale,
  scaleMax,
  shortlistFloor,
  signalTag,
  snapToScale,
  toDisplayScale,
  weightBarWidth,
  weightTotal,
  weightTotalMessage,
  weightedTotal,
  withholdsAiScore,
} from "../../src/shared/scoring";
import { COMPOSITE_FORMULAS } from "../../src/shared/types";

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

describe("decisionScore", () => {
  // The composite form of the workbench's AI · My · Average column — the number
  // the per-program shortlist floor is applied to (Session 5).
  it("averages the AI composite with the mean of the human composites", () => {
    // InsureFlow on the demo seed: AI 8.6, four evaluators at 8.2/8.0/7.9/7.7.
    expect(decisionScore(8.6, [8.2, 8.0, 7.9, 7.7])).toBe(8.28);
    expect(decisionScore(9, [5])).toBe(7);
  });

  it("falls back to whichever side exists", () => {
    expect(decisionScore(6.9, [])).toBe(6.9);
    expect(decisionScore(null, [6, 7])).toBe(6.5);
  });

  it("is null for an unscored deck, so it can never clear a floor", () => {
    expect(decisionScore(null, [])).toBeNull();
    expect(decisionScore(undefined)).toBeNull();
  });

  it("ignores non-finite human totals", () => {
    expect(decisionScore(8, [Number.NaN])).toBe(8);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// W2-A — the admin console's Scoring framework, made real.
// ═══════════════════════════════════════════════════════════════════════════

describe("composite formula (admin console → Score composition)", () => {
  // Five areas, deliberately skewed so the three formulas disagree: the heavy
  // weight sits on the highest score, so weighting pulls the composite up and
  // the median ignores the weights entirely.
  const scores = [
    { weight: 50, value: 9 },
    { weight: 20, value: 6 },
    { weight: 15, value: 4 },
    { weight: 10, value: 3 },
    { weight: 5, value: 1 },
  ];

  it("weighted_average is the weight-average (and the default)", () => {
    // (50·9 + 20·6 + 15·4 + 10·3 + 5·1) / 100 = 665/100
    expect(composite(scores, "weighted_average")).toBe(6.65);
    expect(composite(scores)).toBe(6.65);
    expect(weightedTotal(scores)).toBe(6.65);
  });

  it("unweighted_average ignores the weights", () => {
    // (9 + 6 + 4 + 3 + 1) / 5 = 4.6
    expect(composite(scores, "unweighted_average")).toBe(4.6);
  });

  it("median really computes a median, not an average", () => {
    // sorted 1,3,4,6,9 → 4
    expect(composite(scores, "median")).toBe(4);
    // Even count → the mean of the two middles: 1,3,4,6 → (3+4)/2 = 3.5.
    expect(composite(scores.slice(1), "median")).toBe(3.5);
  });

  it("counts only weighted parameters in the two unweighted formulas", () => {
    // A weight-0 informational parameter is passed in by every call site. It
    // must not drag the mean or shift the median — it is not in the composite.
    const withInformational = [...scores, { weight: 0, value: 10 }];
    expect(composite(withInformational, "unweighted_average")).toBe(4.6);
    expect(composite(withInformational, "median")).toBe(4);
    expect(composite(withInformational, "weighted_average")).toBe(6.65);
  });

  it("is 0 for an empty set under every formula", () => {
    for (const f of COMPOSITE_FORMULAS) expect(composite([], f)).toBe(0);
  });
});

describe("score scale (canonical storage stays 0–10)", () => {
  it("0–10 is the identity", () => {
    expect(toDisplayScale(7.5, "0-10")).toBe(7.5);
    expect(fromDisplayScale(7.5, "0-10")).toBe(7.5);
    expect(formatScore(8, "0-10")).toBe("8");
    expect(scaleMax("0-10")).toBe(10);
  });

  it("1–5 maps the ends onto the ends and round-trips", () => {
    expect(toDisplayScale(0, "1-5")).toBe(1);
    expect(toDisplayScale(10, "1-5")).toBe(5);
    expect(toDisplayScale(5, "1-5")).toBe(3);
    // A 1–5 org types a 4; 7.5 out of 10 is stored.
    expect(fromDisplayScale(4, "1-5")).toBe(7.5);
    expect(toDisplayScale(fromDisplayScale(4, "1-5"), "1-5")).toBe(4);
  });

  it("0–100 is a plain ×10", () => {
    expect(toDisplayScale(6.2, "0-100")).toBe(62);
    expect(fromDisplayScale(62, "0-100")).toBe(6.2);
    expect(formatScore(6.2, "0-100")).toBe("62");
    // 0–100 prints whole numbers — it already has finer resolution than a
    // half-step out of ten.
    expect(formatScore(6.25, "0-100")).toBe("63");
  });

  it("clamps anything outside the scale rather than storing it", () => {
    expect(fromDisplayScale(99, "1-5")).toBe(10);
    expect(fromDisplayScale(-4, "1-5")).toBe(0);
    expect(toDisplayScale(40, "0-10")).toBe(10);
  });

  it("snaps only the SLIDER, never a composite", () => {
    // 8/10 is 4.2 on a 1–5 scale; the control sits on 4.0, the average prints 4.2.
    expect(snapToScale(8, "1-5")).toBe(4);
    expect(toDisplayScale(8, "1-5")).toBe(4.2);
    // Half-steps are the spec's §7 granularity on the 0–10 scale (F0167).
    expect(SCORE_SCALE_BOUNDS["0-10"].step).toBe(0.5);
    expect(snapToScale(7.4, "0-10")).toBe(7.5);
  });
});

describe("decisionScore at the org's AI/jury split", () => {
  it("defaults to the historical 50/50 mean when no split is given", () => {
    expect(decisionScore(8, [4])).toBe(6);
  });

  it("honours the prototype's 40 % AI · 60 % jury default", () => {
    expect(decisionScore(8, [4], 40)).toBe(5.6);
    expect(decisionScore(8.6, [8.2, 8.0, 7.9, 7.7], 40)).toBe(8.21);
  });

  it("honours 30/70 and 50/50", () => {
    expect(decisionScore(8, [4], 30)).toBe(5.2);
    expect(decisionScore(8, [4], 50)).toBe(6);
  });

  it("0 % AI is jury-only — the AI composite cannot move the decision", () => {
    expect(decisionScore(10, [4], 0)).toBe(4);
    expect(decisionScore(0, [7, 9], 0)).toBe(8);
    // …but with no jury score at all there is nothing else to go on.
    expect(decisionScore(8.6, [], 0)).toBe(8.6);
  });

  it("still falls back to whichever side exists, at any split", () => {
    expect(decisionScore(null, [6, 7], 40)).toBe(6.5);
    expect(decisionScore(null, [], 40)).toBeNull();
  });
});

describe("override rationale rule", () => {
  const on = { requireOverrideRationale: true, overrideRationaleDelta: 2 };

  it("bites only STRICTLY beyond the delta", () => {
    expect(overrideNeedsRationale(8, 5, on)).toBe(true);
    expect(overrideNeedsRationale(2, 5, on)).toBe(true);
    expect(overrideNeedsRationale(7, 5, on)).toBe(false); // exactly 2 is fine
    expect(overrideNeedsRationale(3, 5, on)).toBe(false);
  });

  it("never bites with the toggle off, or with no AI score to override", () => {
    expect(overrideNeedsRationale(10, 0, { ...on, requireOverrideRationale: false })).toBe(false);
    expect(overrideNeedsRationale(10, null, on)).toBe(false);
    expect(overrideNeedsRationale(10, undefined, on)).toBe(false);
  });

  it("follows the configured delta", () => {
    expect(overrideNeedsRationale(8, 5, { ...on, overrideRationaleDelta: 4 })).toBe(false);
    expect(overrideNeedsRationale(6, 5, { ...on, overrideRationaleDelta: 0.5 })).toBe(true);
  });
});

describe("shortlist floor", () => {
  it("a programme's own minimum wins over the org threshold", () => {
    expect(shortlistFloor(8.5, 7)).toEqual({ minimum: 8.5, source: "program" });
    expect(shortlistFloor(0, 7)).toEqual({ minimum: 0, source: "program" });
  });

  it("falls back to the org-wide Scoring-framework threshold (F0187)", () => {
    expect(shortlistFloor(null, 7)).toEqual({ minimum: 7, source: "org" });
    expect(shortlistFloor(undefined, 6.5)).toEqual({ minimum: 6.5, source: "org" });
  });
});

describe("blind scoring", () => {
  const off = { showAiScoreToJury: false };
  const on = { showAiScoreToJury: true };

  it("withholds from an evaluator who has not submitted", () => {
    expect(withholdsAiScore(off, { isEvaluator: true, hasSubmitted: false })).toBe(true);
  });

  it("reveals once they submit — independence before scoring, not secrecy after", () => {
    expect(withholdsAiScore(off, { isEvaluator: true, hasSubmitted: true })).toBe(false);
  });

  it("leaves oversight roles alone, and does nothing at all when it is on", () => {
    expect(withholdsAiScore(off, { isEvaluator: false, hasSubmitted: false })).toBe(false);
    expect(withholdsAiScore(on, { isEvaluator: true, hasSubmitted: false })).toBe(false);
  });
});

describe("area weights (admin/s-wt.html)", () => {
  it("reproduces the prototype's three footer strings verbatim", () => {
    expect(weightTotalMessage(100)).toEqual({ text: "Total: 100% ✓", ok: true });
    expect(weightTotalMessage(96)).toEqual({ text: "Total: 96% — 4% remaining", ok: false });
    expect(weightTotalMessage(104)).toEqual({ text: "Total: 104% — over by 4%", ok: false });
  });

  it("sums the seeded rubric to exactly 100", () => {
    expect(weightTotal([8, 8, 7, 7, 8, 10, 6, 6, 10, 8, 8, 10, 4])).toBe(REQUIRED_WEIGHT_TOTAL);
  });

  it("draws the bar at the prototype's ×3.3 scale, capped at 100 %", () => {
    expect(weightBarWidth(8)).toBeCloseTo(26.4, 1);
    expect(weightBarWidth(10)).toBe(33);
    expect(weightBarWidth(4)).toBeCloseTo(13.2, 1);
    expect(weightBarWidth(90)).toBe(100);
  });
});

describe("weak signal", () => {
  it("is the rubric's Weak/Insufficient bands, not a cohort threshold (F0042)", () => {
    expect(isWeakSignal(4.9)).toBe(true);
    expect(isWeakSignal(3)).toBe(true);
    expect(isWeakSignal(5)).toBe(false);
    expect(isWeakSignal(7)).toBe(false);
    expect(WEAK_SIGNAL_MAX).toBe(5);
  });
});
