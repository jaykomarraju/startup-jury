import { describe, it, expect } from "vitest";
import {
  DEFAULT_SCORING_SETTINGS,
  SCORE_SCALE_BOUNDS,
  composite,
  deltaFromDisplayScale,
  deltaToDisplayScale,
  formatDelta,
  formatPoints,
  formatScore,
  fromDisplayScale,
  overrideNeedsRationale,
  shortlistFloor,
  toDisplayScale,
} from "../../src/shared/scoring";
import { SCORE_SCALES } from "../../src/shared/types";

// W7-D — plan §9, Wave 2 integration: `overrideRationaleDelta` and
// `shortlistThreshold` were enforced in canonical 0–10 but authored and
// captioned in the org's display scale. Settled by converting at the boundary:
// storage and enforcement stay canonical, every surface converts. These tests
// pin the conversion, and pin that a 0–10 org sees no change at all.

describe("override delta — a distance, converted by span with no offset", () => {
  it("is the identity on the default 0–10 scale", () => {
    for (const d of [0, 0.5, 2, 3.25, 10]) {
      expect(deltaToDisplayScale(d, "0-10")).toBe(d);
      expect(deltaFromDisplayScale(d, "0-10")).toBe(d);
    }
    expect(formatDelta(DEFAULT_SCORING_SETTINGS.overrideRationaleDelta, "0-10")).toBe("2");
  });

  it("on a 1–5 org, 2 canonical points is 0.8 of the org's points — not 1.8, not 4", () => {
    // A position would pick up the scale's offset (1 + 0.2·4 = 1.8). A distance
    // must not: the span of 1–5 is 4, so 2/10 of it is 0.8.
    expect(deltaToDisplayScale(2, "1-5")).toBe(0.8);
    expect(toDisplayScale(2, "1-5")).toBe(1.8);
    expect(formatDelta(2, "1-5")).toBe("0.8");
    // …and an admin who types "1 point" on a 1–5 org is stored as 2.5 canonical.
    expect(deltaFromDisplayScale(1, "1-5")).toBe(2.5);
  });

  it("on a 0–100 org it is a plain ×10", () => {
    expect(deltaToDisplayScale(2, "0-100")).toBe(20);
    expect(deltaFromDisplayScale(15, "0-100")).toBe(1.5);
    expect(formatDelta(2, "0-100")).toBe("20");
  });

  it("says it the way the copy does — '1 point', otherwise 'points'", () => {
    expect(formatPoints(2, "0-10")).toBe("2 points");
    expect(formatPoints(2.5, "1-5")).toBe("1 point");
    expect(formatPoints(2, "1-5")).toBe("0.8 points");
  });

  it("round-trips on every scale", () => {
    for (const scale of SCORE_SCALES) {
      for (const d of [0.5, 1, 2, 4.5]) {
        expect(deltaFromDisplayScale(deltaToDisplayScale(d, scale), scale)).toBeCloseTo(d, 1);
      }
    }
  });

  it("what a 1–5 admin authors is what a 1–5 juror is held to", () => {
    // The admin types "1 point" into the console on a 1–5 org.
    const settings = { requireOverrideRationale: true, overrideRationaleDelta: deltaFromDisplayScale(1, "1-5") };
    const ai = fromDisplayScale(4, "1-5"); // AI shown as 4
    // Juror types 2.5 — 1.5 of the org's points away. Over the admin's 1.
    expect(overrideNeedsRationale(fromDisplayScale(2.5, "1-5"), ai, settings)).toBe(true);
    // Juror types 3.5 — 0.5 away. Inside it.
    expect(overrideNeedsRationale(fromDisplayScale(3.5, "1-5"), ai, settings)).toBe(false);
    // Exactly 1 point away is fine (strictly greater bites).
    expect(overrideNeedsRationale(fromDisplayScale(3, "1-5"), ai, settings)).toBe(false);

    // The defect, for the record: the SAME "1" stored raw is a canonical 1, and
    // a juror a mere 0.5 of the org's points away (1.25 canonical) is refused.
    const raw = { requireOverrideRationale: true, overrideRationaleDelta: 1 };
    expect(overrideNeedsRationale(fromDisplayScale(3.5, "1-5"), ai, raw)).toBe(true);
  });
});

describe("shortlist threshold — a position, converted with the scale's offset", () => {
  it("is the identity on 0–10 and unchanged for every existing floor", () => {
    expect(toDisplayScale(7, "0-10")).toBe(7);
    expect(fromDisplayScale(7, "0-10")).toBe(7);
    expect(shortlistFloor(null, DEFAULT_SCORING_SETTINGS.shortlistThreshold)).toEqual({ minimum: 7, source: "org" });
  });

  it("a 1–5 admin who types 4 holds decks to 7.5 canonical — and a 4.0 deck clears it", () => {
    const stored = fromDisplayScale(4, "1-5");
    expect(stored).toBe(7.5);
    const { minimum } = shortlistFloor(null, stored);
    expect(formatScore(minimum, "1-5")).toBe("4");
    // A deck that displays 4 clears a floor that displays 4.
    expect(fromDisplayScale(4, "1-5") >= minimum).toBe(true);
    expect(fromDisplayScale(3.5, "1-5") >= minimum).toBe(false);
  });

  it("the seeded 7.0 reads 3.8 on 1–5 and 70 on 0–100 — the stored value never moves", () => {
    expect(formatScore(7, "1-5")).toBe("3.8");
    expect(formatScore(7, "0-100")).toBe("70");
  });
});

describe("composite honours BOTH composite_formula and score_scale", () => {
  const scores = [
    { weight: 30, value: 10 },
    { weight: 10, value: 2 },
    { weight: 10, value: 4 },
  ];

  it("three formulas give three different composites over the same scores", () => {
    expect(composite(scores, "weighted_average")).toBe(7.2); // (300+20+40)/50
    expect(composite(scores, "unweighted_average")).toBe(5.33);
    expect(composite(scores, "median")).toBe(4);
  });

  it("the scale changes what is shown, never what is computed", () => {
    const median = composite(scores, "median");
    expect(formatScore(median, "0-10")).toBe("4");
    expect(formatScore(median, "1-5")).toBe("2.6");
    expect(formatScore(median, "0-100")).toBe("40");
    expect(SCORE_SCALE_BOUNDS["1-5"].max).toBe(5);
  });
});
