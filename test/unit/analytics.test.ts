import { describe, it, expect } from "vitest";
import {
  mean,
  stddev,
  buildFunnel,
  cohortSummary,
  evaluatorScores,
  scoreDrift,
  scoringSummary,
  capitalDeployment,
  portfolioConstruction,
  decisionHistory,
  decisionKind,
  type CohortDeck,
  type EvaluationRow,
  type DriftInput,
  type ScoringInput,
  type PortfolioRow,
  type DecisionEvent,
} from "../../src/shared/analytics";

describe("stat helpers", () => {
  it("mean and population stddev", () => {
    expect(mean([2, 4, 6])).toBe(4);
    expect(mean([])).toBe(0);
    expect(stddev([5, 5, 5])).toBe(0);
    expect(round2(stddev([2, 4]))).toBe(1); // popn sd of {2,4} = 1
  });
});

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

describe("buildFunnel", () => {
  it("produces monotonic cumulative counts + conversions (incubator)", () => {
    // 3 uploaded-ish, 2 reached AI eval, 1 reached jury, 1 onboarded.
    const statuses = ["uploaded", "incomplete", "ai_evaluated", "shortlisted", "onboard_ready"];
    const f = buildFunnel("incubator", statuses);
    expect(f.top).toBe(5); // all reached Uploaded
    // Counts are non-increasing.
    const counts = f.rows.map((r) => r.count);
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]);
    expect(f.rows[0].label).toBe("Uploaded");
    expect(f.rows[f.rows.length - 1].label).toBe("Onboarded");
    expect(f.bottom).toBe(1); // one onboard_ready
    expect(f.rows[0].stepConversion).toBeNull();
    expect(f.biggestDropLabel).not.toBeNull();
  });

  it("VC funnel closes only onboard_ready decks", () => {
    const f = buildFunnel("vc", ["uploaded", "analyst_scoring", "ic_review", "term_sheet", "onboard_ready", "archived"]);
    expect(f.rows[0].label).toBe("Sourced");
    expect(f.bottom).toBe(1);
    expect(f.conversion).toBe(Math.round((1 / 6) * 100));
  });
});

describe("cohortSummary", () => {
  const decks: CohortDeck[] = [
    { id: "a", name: "A", sector: "CleanTech", stage: "Seed", status: "shortlisted", aiScore: 8.7, topParam: "Climate Impact" },
    { id: "b", name: "B", sector: "Fintech", stage: "Seed", status: "ai_evaluated", aiScore: 6.2, topParam: null },
    { id: "c", name: "C", sector: "CleanTech", stage: "Pre-seed", status: "incomplete", aiScore: null, topParam: null },
    { id: "d", name: "D", sector: "Lending", stage: "Pre-seed", status: "rejected", aiScore: 4.3, topParam: null },
  ];
  it("buckets distribution, recommendations and sector mix", () => {
    const s = cohortSummary(decks);
    expect(s.evaluated).toBe(3); // 3 have ai_score
    expect(s.recommended).toBe(1); // shortlisted
    expect(s.inClarification).toBe(1); // incomplete
    expect(s.screenedOut).toBe(1); // rejected
    // distribution bands sum to evaluated count.
    expect(s.distribution.reduce((n, b) => n + b.count, 0)).toBe(3);
    // 8.7 → Strong band (7–8 label is min 7), 6.2 → Moderate, 4.3 → Weak.
    expect(s.distribution.find((b) => b.label === "7–8 Strong")!.count).toBe(1);
    expect(s.distribution.find((b) => b.label === "5–6 Moderate")!.count).toBe(1);
    expect(s.sectorMix[0].label).toBe("CleanTech"); // 2 CleanTech
    expect(s.ranking[0].name).toBe("A"); // highest score first
    expect(s.ranking[0].recommendation).toBe("Recommend");
    expect(s.ranking.find((r) => r.name === "D")!.recommendation).toBe("Pass");
  });
});

describe("evaluatorScores", () => {
  // Two decks, three evaluators: lenient, neutral, strict.
  const rows: EvaluationRow[] = [
    { evaluatorId: "len", evaluatorName: "Lenient", role: "jury", deckId: "d1", weightedTotal: 8 },
    { evaluatorId: "neu", evaluatorName: "Neutral", role: "jury", deckId: "d1", weightedTotal: 7 },
    { evaluatorId: "str", evaluatorName: "Strict", role: "admin", deckId: "d1", weightedTotal: 6 },
    { evaluatorId: "len", evaluatorName: "Lenient", role: "jury", deckId: "d2", weightedTotal: 6 },
    { evaluatorId: "neu", evaluatorName: "Neutral", role: "jury", deckId: "d2", weightedTotal: 5 },
    { evaluatorId: "str", evaluatorName: "Strict", role: "admin", deckId: "d2", weightedTotal: 4 },
  ];
  it("computes leave-one-out deltas and flags lenient/strict", () => {
    const r = evaluatorScores(rows);
    expect(r.evaluators).toHaveLength(3);
    const len = r.evaluators.find((e) => e.evaluatorId === "len")!;
    const str = r.evaluators.find((e) => e.evaluatorId === "str")!;
    // Leave-one-out peer mean for len on d1 = mean(7,6)=6.5 → 8−6.5 = +1.5 (same on d2).
    expect(len.vsCohort).toBe(1.5);
    expect(str.vsCohort).toBe(-1.5);
    expect(r.mostLenient!.evaluatorId).toBe("len");
    expect(r.strictest!.evaluatorId).toBe("str");
    expect(r.cohortMean).toBe(6); // mean of all six
  });

  it("excludes solo-scored decks from the leave-one-out delta", () => {
    const solo: EvaluationRow[] = [
      { evaluatorId: "a", evaluatorName: "A", role: "jury", deckId: "only", weightedTotal: 9 },
    ];
    const r = evaluatorScores(solo);
    // No peers → no consensus → delta 0 (not a false lenient reading), agreement 100.
    expect(r.evaluators[0].vsCohort).toBe(0);
    expect(r.evaluators[0].agreement).toBe(100);
  });
});

describe("scoreDrift", () => {
  const inputs: DriftInput[] = [
    { deckId: "a", name: "A", aiScore: 6.4, humanScore: 7.6 }, // +1.2, band 2→2
    { deckId: "b", name: "B", aiScore: 8.0, humanScore: 7.0 }, // -1.0, band 3→2 (change)
    { deckId: "c", name: "C", aiScore: 5.0, humanScore: 5.0 }, // 0
  ];
  it("computes net drift, band changes and agreement", () => {
    const d = scoreDrift(inputs);
    expect(d.rows[0].name).toBe("A"); // sorted by drift desc
    expect(d.rows[0].drift).toBe(1.2);
    expect(d.revisedDown).toBe(1); // B
    expect(d.avgDrift).toBe(round1((1.2 - 1.0 + 0) / 3));
    expect(d.bandChanges).toBe(1); // B crosses 8-band
    expect(d.agreement).toBe(Math.round((2 / 3) * 100));
  });
});

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

describe("scoringSummary", () => {
  const inputs: ScoringInput[] = [
    { deckId: "a", name: "GreenRoute", aiScore: 9.1, humanScores: [8.9, 9.0, 8.8] },
    { deckId: "b", name: "CreditBridge", aiScore: 6.4, humanScores: [4.6, 6.6, 5.6] },
    { deckId: "c", name: "WealthOS", aiScore: 7.8, humanScores: [] }, // pending
  ];
  it("aggregates AI vs evaluator avg + variance", () => {
    const s = scoringSummary(inputs, 3); // caller supplies the distinct-evaluator count
    expect(s.dealsScored).toBe(2);
    expect(s.evaluators).toBe(3);
    const cb = s.rows.find((r) => r.name === "CreditBridge")!;
    expect(cb.evaluatorAvg).toBe(round1((4.6 + 6.6 + 5.6) / 3));
    expect(cb.variance).toBeGreaterThan(0);
    expect(cb.spreadLow).toBe(4.6);
    expect(cb.spreadHigh).toBe(6.6);
    const wos = s.rows.find((r) => r.name === "WealthOS")!;
    expect(wos.evaluatorAvg).toBeNull();
    expect(wos.variance).toBeNull();
    expect(wos.lean).toBe("Hold"); // no human scores → falls back to AI 7.8 → Hold band
  });

  it("treats a single-scorer deck as having no measurable variance", () => {
    const s = scoringSummary([{ deckId: "x", name: "Solo", aiScore: 7, humanScores: [8] }], 1);
    const row = s.rows[0];
    expect(row.evaluatorAvg).toBe(8); // avg still defined
    expect(row.variance).toBeNull(); // but variance is not 0
    expect(s.avgVariance).toBe(0); // no variance rows → mean([]) = 0
  });
});

describe("capitalDeployment", () => {
  const rows: PortfolioRow[] = [
    { deckId: "a", name: "A", sector: "Fintech", stage: "Seed", city: "Mumbai", capitalDeployed: 12 },
    { deckId: "b", name: "B", sector: "Climatetech", stage: "Series A", city: "Pune", capitalDeployed: 20 },
    { deckId: "c", name: "C", sector: "Fintech", stage: "Seed", city: "Delhi", capitalDeployed: null },
  ];
  it("sums deployed, computes dry powder and median", () => {
    const r = capitalDeployment(rows, 100);
    expect(r.deployed).toBe(32);
    expect(r.dryPowder).toBe(68);
    expect(r.companies).toBe(2);
    expect(r.medianCheck).toBe(16); // (12+20)/2
    expect(r.deployedPct).toBe(32);
    expect(r.byCompany[0].name).toBe("B"); // largest first
  });
});

describe("portfolioConstruction", () => {
  const rows: PortfolioRow[] = [
    { deckId: "a", name: "A", sector: "Fintech", stage: "Seed", city: "Mumbai", capitalDeployed: 12 },
    { deckId: "b", name: "B", sector: "Fintech", stage: "Series A", city: "Pune", capitalDeployed: 20 },
    { deckId: "c", name: "C", sector: "Climatetech", stage: "Seed", city: "Mumbai", capitalDeployed: 5 },
  ];
  it("computes sector/stage/geo mixes over funded companies", () => {
    const r = portfolioConstruction(rows);
    expect(r.companies).toBe(3);
    expect(r.sectors).toBe(2);
    expect(r.sectorMix[0].label).toBe("Fintech");
    expect(r.sectorMix[0].pct).toBe(Math.round((2 / 3) * 100));
    expect(r.geoMix.find((g) => g.label === "Mumbai")!.count).toBe(2);
  });
});

describe("decisionHistory", () => {
  it("maps actions to Invest/Pass/Revisit and tallies", () => {
    expect(decisionKind("invest")).toBe("Invest");
    expect(decisionKind("pass_at_call")).toBe("Pass");
    expect(decisionKind("another_meeting")).toBe("Revisit");
    expect(decisionKind("submit_for_ai")).toBeNull();

    const events: DecisionEvent[] = [
      { createdAt: "2026-06-12T09:00:00Z", company: "A", action: "invest", actorName: "MP", note: "go" },
      { createdAt: "2026-06-08T09:00:00Z", company: "B", action: "not_shortlisted", actorName: "Assoc", note: null },
      { createdAt: "2026-06-05T09:00:00Z", company: "C", action: "another_meeting", actorName: "P", note: null },
      { createdAt: "2026-06-01T09:00:00Z", company: "D", action: "submit_for_ai", actorName: "An", note: null },
    ];
    const r = decisionHistory(events);
    expect(r.total).toBe(3); // submit_for_ai excluded
    expect(r.invest).toBe(1);
    expect(r.pass).toBe(1);
    expect(r.revisit).toBe(1);
    expect(r.rows[0].date).toBe("2026-06-12T09:00:00Z"); // newest first
  });
});
