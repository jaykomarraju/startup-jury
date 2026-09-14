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
  driftBand,
  myDecksSummary,
  myScoresSummary,
  type CohortDeck,
  type EvaluationRow,
  type DriftInput,
  type ScoringInput,
  type PortfolioRow,
  type DecisionEvent,
} from "../../src/shared/analytics";
import { RUBRIC_BANDS, rubricBand } from "../../src/shared/types";

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

  it("reproduces panel-funnel.html's KPIs and red step losses from its own counts (24/11/8/7/5/4)", () => {
    const statuses = [
      ...Array(13).fill("uploaded"),
      ...Array(3).fill("ai_evaluated"),
      "jury_evaluation",
      ...Array(2).fill("intro"),
      "signup",
      ...Array(4).fill("onboard_ready"),
    ];
    const f = buildFunnel("incubator", statuses);
    expect(f.rows.map((r) => r.count)).toEqual([24, 11, 8, 7, 5, 4]);
    expect(f.rows.map((r) => r.pctOfTop)).toEqual([100, 46, 33, 29, 21, 17]);
    expect(f.rows.map((r) => r.stepConversion)).toEqual([null, 46, 73, 88, 71, 80]);
    // The prototype's ▼ figures — 13, not 100 − 88 = 12.
    expect(f.rows.map((r) => r.stepDrop)).toEqual([null, 54, 27, 13, 29, 20]);
    expect(f.biggestStepDrop).toEqual({ label: "Uploaded → AI Evaluated", pct: 54 });
    expect(f.introToOnboard).toBe(57);
    expect(f.conversion).toBe(17);
  });

  it("has no step loss after an empty stage and no intro rate on the VC edition", () => {
    const f = buildFunnel("incubator", ["uploaded"]);
    expect(f.rows[2].stepDrop).toBeNull(); // AI Evaluated is 0, so Jury Evaluated has nothing to lose
    expect(f.rows[1].stepDrop).toBe(100);
    expect(buildFunnel("vc", ["uploaded", "onboard_ready"]).introToOnboard).toBeNull();
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
    expect(s.recommendedPct).toBe(33); // 1 of 3 evaluated
    expect(s.total).toBe(4);
    expect(s.window).toBeNull(); // no createdAt supplied
  });

  it("ranks, bands and averages on the final human score when there is one (F0797)", () => {
    const s = cohortSummary([
      { ...decks[0], aiScore: 7.9, finalScore: 8.7, createdAt: "2026-05-09T10:00:00Z" },
      { ...decks[1], aiScore: 6.4, finalScore: 9.1, createdAt: "2026-04-12T10:00:00Z" },
      { ...decks[3], aiScore: 5.2, finalScore: null },
    ]);
    expect(s.ranking.map((r) => [r.name, r.score])).toEqual([
      ["B", 9.1],
      ["A", 8.7],
      ["D", 5.2], // no human final → the AI score
    ]);
    expect(s.distribution.find((b) => b.label === "9–10 Exceptional")!.count).toBe(1);
    expect(s.avgScore).toBe(7.7);
    expect(s.finalScored).toBe(2);
    expect(s.window).toEqual({ from: "2026-04-12T10:00:00Z", to: "2026-05-09T10:00:00Z" });
  });

  it("counts In clarification from open founder queries when the route supplies them (F0798)", () => {
    const s = cohortSummary(decks, { openQueryDeckIds: new Set(["b", "d"]) });
    expect(s.inClarification).toBe(2); // not the intake-status count of 1
  });

  it("caps the sector mix at five rows, the fifth a rolled-up Other (F0877)", () => {
    const many: CohortDeck[] = ["S1", "S1", "S1", "S2", "S2", "S3", "S3", "S4", "S5", "S6", null].map((sector, i) => ({
      id: String(i),
      name: String(i),
      sector,
      stage: null,
      status: "ai_evaluated",
      aiScore: 6,
      topParam: null,
    }));
    const mix = cohortSummary(many).sectorMix;
    expect(mix).toHaveLength(5);
    expect(mix.map((m) => m.label)).toEqual(["S1", "S2", "S3", "S4", "Other"]);
    expect(mix[4].count).toBe(3); // S5 + S6 + the NULL sector
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
    // F0808 — mean |vs cohort| over the three (1.5, 0, 1.5), and the evaluation count.
    expect(r.meanDeviation).toBe(1);
    expect(r.totalEvaluations).toBe(6);
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
  // W8-A — RE-BASELINED, not deleted (§4). These fixtures used to be read
  // through a private four-band table (>=8 strong, >=5 moderate, >=2 weak,
  // <2 absent), under which B (8.0 → 7.0) "crossed the 8-band" and A (6.4 →
  // 7.6) stayed put. Under `RUBRIC_BANDS` — the one table every other surface
  // uses — it is the other way round: 8.0 and 7.0 are both 7–8 Strong, and A
  // climbs from 5–6 Moderate into 7–8 Strong. The COUNT happens to be 1 either
  // way, which is exactly why the old assertion never noticed; the deck is now
  // pinned too.
  const inputs: DriftInput[] = [
    { deckId: "a", name: "A", aiScore: 6.4, humanScore: 7.6 }, // +1.2, Moderate → Strong (change)
    { deckId: "b", name: "B", aiScore: 8.0, humanScore: 7.0 }, // −1.0, Strong → Strong
    { deckId: "c", name: "C", aiScore: 5.0, humanScore: 5.0 }, // 0, Moderate → Moderate
  ];
  it("computes net drift, band changes and agreement", () => {
    const d = scoreDrift(inputs);
    expect(d.rows[0].name).toBe("A"); // sorted by drift desc
    expect(d.rows[0].drift).toBe(1.2);
    expect(d.revisedDown).toBe(1); // B
    expect(d.avgDrift).toBe(round1((1.2 - 1.0 + 0) / 3));
    expect(d.bandChanges).toBe(1);
    expect(d.agreement).toBe(Math.round((2 / 3) * 100));
    expect(d.bandChangePct).toBe(33);
    // Which deck changed band — the retired table said B, the shared one says A.
    const changed = d.rows.filter((r) => driftBand(r.aiScore) !== driftBand(r.humanScore)).map((r) => r.name);
    expect(changed).toEqual(["A"]);
  });

  it("reads bands from RUBRIC_BANDS at every boundary", () => {
    // Each cut-point: just below lands one band lower than the cut-point itself.
    const cuts = RUBRIC_BANDS.filter((b) => b.min > 0);
    expect(cuts.map((b) => b.min)).toEqual([9, 7, 5, 3]);
    for (const b of cuts) {
      expect(driftBand(b.min)).toBe(b.index);
      expect(driftBand(round1(b.min - 0.1))).toBe(b.index + 1);
      expect(driftBand(b.min)).toBe(rubricBand(b.min).index);
      expect(driftBand(b.min - 0.1)).toBe(rubricBand(b.min - 0.1).index);
    }
    expect(driftBand(10)).toBe(0);
    expect(driftBand(0)).toBe(RUBRIC_BANDS.length - 1);
    // The retired cut-points no longer split a band: 8.0/7.9 and 2.0/1.9 agree.
    expect(driftBand(8.0)).toBe(driftBand(7.9));
    expect(driftBand(2.0)).toBe(driftBand(1.9));
  });

  it("counts a band change exactly at 4.9 → 5.0 and 6.9 → 7.0, and none at 7.9 → 8.0", () => {
    const d = scoreDrift([
      { deckId: "1", name: "Cross5", aiScore: 4.9, humanScore: 5.0 },
      { deckId: "2", name: "Cross7", aiScore: 6.9, humanScore: 7.0 },
      { deckId: "3", name: "Old8", aiScore: 7.9, humanScore: 8.0 },
      { deckId: "4", name: "Cross9", aiScore: 8.9, humanScore: 9.0 },
      { deckId: "5", name: "Cross3", aiScore: 2.9, humanScore: 3.0 },
    ]);
    expect(d.bandChanges).toBe(4);
    expect(d.agreement).toBe(20);
  });

  it("carries the jury report's two-place mean and tendency", () => {
    // `repRenderDrift`: mean of the UNROUNDED differences, toFixed(2); ±0.05 decides the word.
    const d = scoreDrift([
      { deckId: "a", name: "A", aiScore: 9.1, humanScore: 8.9 },
      { deckId: "b", name: "B", aiScore: 7.6, humanScore: 7.94 },
    ]);
    expect(d.meanDrift).toBe(0.07);
    expect(d.tendency).toBe("Lenient");
    expect(scoreDrift([{ deckId: "a", name: "A", aiScore: 7, humanScore: 6.9 }]).tendency).toBe("Strict");
    expect(scoreDrift([{ deckId: "a", name: "A", aiScore: 7, humanScore: 7.04 }]).tendency).toBe("Aligned");
    expect(scoreDrift([]).tendency).toBe("Aligned");
  });

  it("attributes drift only to causes it has data for", () => {
    const none = scoreDrift(inputs);
    expect(none.rows.every((r) => r.clarifiedScore === null)).toBe(true);
    expect(none.attribution.clarification).toBeNull();
    expect(none.attribution.reevaluation).toBeNull();
    // No clarification snapshot → final − AI is the juror's step.
    expect(none.attribution.juror).toBe(round1((1.2 - 1.0 + 0) / 3));

    const withClar = scoreDrift([
      { deckId: "g", name: "GreenRoute", aiScore: 6.4, clarifiedScore: 7.2, humanScore: 7.9 },
      { deckId: "c", name: "CreditBridge", aiScore: 5.2, clarifiedScore: 4.6, humanScore: 4.3 },
    ]);
    expect(withClar.rows.find((r) => r.name === "GreenRoute")!.clarifiedScore).toBe(7.2);
    expect(withClar.attribution.clarification).toBe(0.1); // (+0.8 − 0.6) / 2
    expect(withClar.attribution.juror).toBe(0.2); // (+0.7 − 0.3) / 2
  });
});

describe("myDecksSummary / myScoresSummary (jury reports)", () => {
  // `repDecks` from AISJ_IC_Jury_V4/_scripts.js, verbatim.
  const seed = [
    { name: "GreenRoute", sector: "Climatetech", ai: 9.1, my: 8.9, state: "submitted" },
    { name: "InsureFlow", sector: "Insurtech", ai: 8.3, my: 8.1, state: "submitted" },
    { name: "DataForge", sector: "DeepTech", ai: 7.6, my: 7.9, state: "submitted" },
    { name: "WealthOS", sector: "Wealthtech", ai: 7.8, my: 7.6, state: "draft" },
    { name: "FinStack", sector: "B2B Fintech", ai: 7.2, my: 7.0, state: "submitted" },
    { name: "AgriChain", sector: "AgriTech", ai: 7.1, my: 7.3, state: "submitted" },
    { name: "TaxPilot", sector: "B2B SaaS", ai: 6.9, my: 6.7, state: "pending" },
    { name: "CreditBridge", sector: "Lending", ai: 6.4, my: 5.9, state: "submitted" },
  ] as const;

  it("reproduces repRenderDecks' six tiles and breakdown from its own seed", () => {
    const r = myDecksSummary(
      seed.map((s, i) => ({ id: String(i), name: s.name, sector: s.sector, ai: s.ai, mine: s.my, state: s.state, submittedAt: null })),
    );
    expect([r.assigned, r.submitted, r.draft, r.pending]).toEqual([8, 6, 1, 1]);
    expect(r.avgMine).toBe(7.4); // (8.9+8.1+7.9+7.6+7.0+7.3+6.7+5.9)/8 = 7.425
    expect(r.avgAi).toBe(7.6); // 60.4/8 = 7.55 → 7.6
    expect(r.breakdown.map((b) => [b.label, b.count, b.pct])).toEqual([
      ["Submitted", 6, 75],
      ["In draft", 1, 13],
      ["Pending", 1, 13],
    ]);
  });

  it("averages only the scores that exist (a pending deck has none, a withheld AI score is null)", () => {
    const r = myDecksSummary([
      { id: "a", name: "A", sector: null, ai: 8, mine: 7, state: "submitted", submittedAt: "2026-06-09T00:00:00Z" },
      { id: "b", name: "B", sector: null, ai: null, mine: null, state: "pending", submittedAt: null },
    ]);
    expect(r.avgMine).toBe(7);
    expect(r.avgAi).toBe(8);
    expect(myDecksSummary([]).avgMine).toBeNull();
  });

  it("reproduces repRenderScores' above/below counts and keeps a zero delta neutral", () => {
    const s = myScoresSummary(seed.map((d, i) => ({ id: String(i), name: d.name, ai: d.ai, mine: d.my })));
    expect(s.above).toBe(2); // DataForge, AgriChain
    expect(s.below).toBe(6);
    expect(s.avgMine).toBe(7.4);
    const z = myScoresSummary([
      { id: "z", name: "Z", ai: 7, mine: 7 },
      { id: "n", name: "N", ai: null, mine: 6 },
    ]);
    expect(z.above + z.below).toBe(0);
    expect(z.rows[0].delta).toBe(0);
    expect(z.rows[1].delta).toBeNull();
    expect(z.rows[1].sector).toBeNull();
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
    // W9-D — RE-BASELINED, not deleted (§4). This read "Hold": `leanFor` fell back to the AI 7.8
    // and cut it at a private ≥ 6.5. The lean now reads RUBRIC_BANDS from the evaluators' mean
    // alone, and a deal no evaluator has scored is "Need info" — `panel-scoring.html`'s own
    // WealthOS row (AI 7.8, evaluators pending) says exactly that.
    expect(wos.lean).toBe("Need info");
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
  it("reports allocated (reserved) capital as a share of the committed fund", () => {
    const r = capitalDeployment(rows, 100, 60);
    expect(r.allocated).toBe(60);
    expect(r.allocatedPct).toBe(60);
    // Deployed math is unchanged by the allocated dimension.
    expect(r.deployed).toBe(32);
  });
  it("defaults allocated to 0 when not supplied", () => {
    const r = capitalDeployment(rows, 100);
    expect(r.allocated).toBe(0);
    expect(r.allocatedPct).toBe(0);
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
