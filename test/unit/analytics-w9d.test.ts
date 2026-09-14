import { describe, it, expect } from "vitest";
import {
  checkSizeBucket,
  checkSizeMix,
  clarificationQuestion,
  fundLabel,
  leanFor,
  pacingByYear,
  scoringSummary,
  HIGH_DISAGREEMENT_SIGMA,
  MODERATE_DISAGREEMENT_SIGMA,
  type PortfolioRow,
} from "../../src/shared/analytics";
import { RUBRIC_BANDS } from "../../src/shared/types";

/** W9-D — the VC reports' additive aggregation (`W9-D-vc-report-data.patch`). */

const pos = (name: string, capitalDeployed: number | null, onboardedAt: string | null = null): PortfolioRow => ({
  deckId: name,
  name,
  sector: null,
  stage: null,
  city: null,
  capitalDeployed,
  onboardedAt,
});

describe("leanFor — the Lean pill reads RUBRIC_BANDS", () => {
  it("Exceptional and Strong lean Invest, Moderate Hold, Weak and Insufficient Pass, unscored Need info", () => {
    expect([9.5, 8, 7, 6.9, 5, 4.9, 1, null].map(leanFor)).toEqual([
      "Invest",
      "Invest",
      "Invest",
      "Hold",
      "Hold",
      "Pass",
      "Pass",
      "Need info",
    ]);
  });

  it("every cut-point is a band's own minimum — none of the retired 8 / 6.5 / 5 splits survives", () => {
    // The lean changes exactly where a band boundary changes it: Strong/Moderate and Moderate/Weak.
    const strong = RUBRIC_BANDS.find((b) => b.key === "strong")!;
    const moderate = RUBRIC_BANDS.find((b) => b.key === "moderate")!;
    expect(leanFor(strong.min)).not.toBe(leanFor(strong.min - 0.01));
    expect(leanFor(moderate.min)).not.toBe(leanFor(moderate.min - 0.01));
    expect(leanFor(7)).toBe("Invest");
    expect(leanFor(6.99)).toBe("Hold");
    expect(leanFor(5)).toBe("Hold");
    expect(leanFor(4.99)).toBe("Pass");
    // The old table split at 8.0 and 6.5; both sides of each now agree.
    expect(leanFor(8)).toBe(leanFor(7.99));
    expect(leanFor(6.5)).toBe(leanFor(6.49));
  });
});

describe("scoringSummary — blind scoring", () => {
  const rows = scoringSummary(
    [
      { deckId: "a", name: "A", aiScore: 9.1, humanScores: [], aiWithheld: true },
      { deckId: "b", name: "B", aiScore: 6.0, humanScores: [7, 7] },
    ],
    1,
  ).rows;

  it("a withheld row carries no AI number and says why", () => {
    const a = rows.find((r) => r.name === "A")!;
    expect(a.ai).toBeNull();
    expect(a.aiWithheld).toBe(true);
    expect(a.lean).toBe("Need info");
  });

  it("the withheld AI score does not leak through the sort order", () => {
    expect(rows.map((r) => r.name)).toEqual(["B", "A"]);
    expect(rows.find((r) => r.name === "B")!.aiWithheld).toBeUndefined();
  });
});

describe("fundLabel", () => {
  it("names the fund only when exactly one programme carries a committed size", () => {
    expect(fundLabel([{ name: "Fund II", fundSize: 300 }, { name: "Deep Tech Fund", fundSize: null }])).toBe("Fund II");
    expect(fundLabel([{ name: "Fund II", fundSize: 300 }, { name: "Fund III", fundSize: 500 }])).toBe("All funds");
    expect(fundLabel([{ name: "Deep Tech Fund", fundSize: 0 }])).toBe("All funds");
  });
});

describe("pacingByYear", () => {
  it("sums deployed capital per calendar year, runs a cumulative total, and marks the current year YTD", () => {
    const rows = [pos("A", 10, "2025-03-01T00:00:00Z"), pos("B", 5.5, "2026-01-02T00:00:00Z"), pos("C", 4, "2026-07-01T00:00:00Z"), pos("D", 0, "2024-01-01T00:00:00Z"), pos("E", 9, null)];
    expect(pacingByYear(rows, new Date("2026-09-13T00:00:00Z"))).toEqual([
      { year: 2025, ytd: false, planned: null, actual: 10, cumulative: 10, variance: null },
      { year: 2026, ytd: true, planned: null, actual: 9.5, cumulative: 19.5, variance: null },
    ]);
  });
});

describe("checkSizeMix", () => {
  it("buckets on the panel's four labels, each bucket owning its lower edge", () => {
    expect([2.9, 3, 7.9, 8, 20, 20.1].map(checkSizeBucket)).toEqual([0, 1, 1, 2, 2, 3]);
    const mix = checkSizeMix([pos("a", 2), pos("b", 4), pos("c", 12), pos("d", 22), pos("e", null)]);
    expect(mix.map((m) => m.label)).toEqual(["< ₹3 Cr", "₹3–8 Cr", "₹8–20 Cr", "> ₹20 Cr"]);
    expect(mix.map((m) => m.pct)).toEqual([25, 25, 25, 25]);
  });
});

describe("disagreement thresholds", () => {
  it("reproduce panel-scoring.html's colours: 1.4 red, 0.9 / 0.6 gold, 0.3 olive", () => {
    expect(1.4 >= HIGH_DISAGREEMENT_SIGMA).toBe(true);
    expect([0.9, 0.6].every((s) => s < HIGH_DISAGREEMENT_SIGMA && s >= MODERATE_DISAGREEMENT_SIGMA)).toBe(true);
    expect(0.3 < MODERATE_DISAGREEMENT_SIGMA).toBe(true);
  });
});

describe("clarificationQuestion", () => {
  it("takes the first non-empty line and shortens a long one", () => {
    expect(clarificationQuestion("\n  Churn definition \nWhat counts as churn?")).toBe("Churn definition");
    const long = "x".repeat(100);
    expect(clarificationQuestion(long)).toHaveLength(80);
    expect(clarificationQuestion(long).endsWith("…")).toBe(true);
  });
});
