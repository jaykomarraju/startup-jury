import { describe, it, expect } from "vitest";
import {
  deckStats,
  icMemberStats,
  matchesIcStat,
  matchesStat,
  pipelineProgress,
  vcFunnelLabel,
  type IcStatDeck,
  type MyBallot,
  type StatDeck,
} from "../../src/shared/deckStats";

// Aug-2026 issues 4, 5 and 7 — the six All-decks stat boxes (the fifth is
// ASSIGNED, the sixth SHORTLISTED) and the pipeline-progress rail derived from
// exactly those titles.

const DECKS: StatDeck[] = [
  { statusId: "pending_ai" }, // pending — no AI score yet
  { statusId: "incomplete", aiScore: undefined }, // incomplete
  { statusId: "ai_evaluated", aiScore: 7.2 }, // evaluated
  { statusId: "assigned", aiScore: 6.4, assignedTo: "u1" }, // evaluated + assigned
  { statusId: "jury_evaluation", aiScore: 8.1, assignedTo: "u1" }, // evaluated + assigned
  { statusId: "shortlisted", aiScore: 8.6, assignedTo: "u1" }, // + shortlisted
  { statusId: "intro", aiScore: 7.9, assignedTo: "u2" }, // + shortlisted
  { statusId: "rejected", aiScore: 4.1 }, // evaluated only
];

describe("All-decks stat boxes", () => {
  it("orders the six boxes with Assigned fifth and Shortlisted sixth", () => {
    const stats = deckStats("incubator", DECKS);
    expect(stats.map((s) => s.label)).toEqual([
      "Uploaded",
      "Pending",
      "Incomplete",
      "AI Evaluated",
      "Assigned",
      "Shortlisted",
    ]);
  });

  it("counts each box off the deck's real state", () => {
    const by = Object.fromEntries(deckStats("incubator", DECKS).map((s) => [s.key, s.value]));
    expect(by.all).toBe(8);
    expect(by.pending).toBe(1);
    expect(by.incomplete).toBe(1);
    expect(by.evaluated).toBe(6);
    // assigned/jury_evaluation/shortlisted/intro all carry an assignee.
    expect(by.assigned).toBe(4);
    expect(by.shortlisted).toBe(2);
  });

  it("expresses every box except Uploaded as a percentage of Uploaded", () => {
    const stats = deckStats("incubator", DECKS);
    expect(stats[0].progress).toBe(100);
    expect(stats.find((s) => s.key === "shortlisted")?.progress).toBe(25); // 2 of 8
  });

  it("carries the prototype's incubator copy and bar colours (F0323, folded home from the screen)", () => {
    const now = Date.parse("2026-06-03T12:00:00Z");
    const stats = deckStats(
      "incubator",
      [
        { statusId: "pending_ai", uploadedAt: "2026-06-03 09:00:00" },
        { statusId: "pending_ai", uploadedAt: "2026-06-01T09:00:00Z" },
      ],
      now,
    );
    expect(stats[0].sublabel).toBe("+1 since yesterday");
    expect(stats.find((s) => s.key === "incomplete")?.sublabel).toBe("Missing slides");
    expect(stats.map((s) => s.color)).toEqual([
      "var(--olive)",
      "var(--amber)",
      "var(--red)",
      "var(--olive)",
      "var(--blue)",
      "var(--green)",
    ]);
  });

  it("pipeline progress is the stat-box titles minus the Uploaded total", () => {
    const stats = deckStats("incubator", DECKS);
    expect(pipelineProgress(stats).map((s) => s.label)).toEqual([
      "Pending",
      "Incomplete",
      "AI Evaluated",
      "Assigned",
      "Shortlisted",
    ]);
  });

  it("matchesStat drives the table filter for each box", () => {
    const shortlisted = DECKS.filter((d) => matchesStat("incubator", d, "shortlisted"));
    expect(shortlisted.map((d) => d.statusId)).toEqual(["shortlisted", "intro"]);
    expect(DECKS.every((d) => matchesStat("incubator", d, "all"))).toBe(true);
  });

  it("an empty workspace reports zeroes rather than dividing by zero", () => {
    const stats = deckStats("incubator", []);
    expect(stats.every((s) => s.value === 0)).toBe(true);
    expect(stats.find((s) => s.key === "shortlisted")?.progress).toBe(0);
  });
});

// W9-A — `AISJ_VC_Superuser_V8` panel-alldecks.html:32-37 (F0437 / F0440).
describe("VC All-decks stat boxes — the deal funnel", () => {
  const VC: StatDeck[] = [
    { statusId: "pending_ai", uploadedAt: "2026-06-02T09:00:00Z" },
    { statusId: "incomplete", uploadedAt: "2026-05-01T09:00:00Z" },
    { statusId: "analyst_scoring" },
    { statusId: "partner_review" },
    { statusId: "investment_dd" },
    { statusId: "ic_review" },
    { statusId: "mp_decision" },
    { statusId: "alignment_call" },
    { statusId: "legal_dd" },
    { statusId: "onboard_ready" },
    { statusId: "archived" },
  ];
  const now = Date.parse("2026-06-03T12:00:00Z");

  it("has the VC labels, sub-labels, order and colours — not the incubator's", () => {
    const stats = deckStats("vc", VC, now);
    expect(stats.map((s) => s.label)).toEqual([
      "Uploaded",
      "Incomplete",
      "AI Evaluated",
      "In Diligence",
      "IC ready",
      "Onboard ready",
    ]);
    expect(stats.map((s) => s.sublabel)).toEqual([
      "+1 this week",
      "Missing materials",
      "82% of uploaded",
      "Active diligence",
      "Queued for committee",
      "Cleared to onboard",
    ]);
    expect(stats.map((s) => s.color)).toEqual([
      "var(--olive)",
      "var(--red)",
      "var(--olive)",
      "var(--amber)",
      "var(--blue)",
      "var(--green)",
    ]);
  });

  it("counts a funnel: a deal is under every box it has reached, and an archived deal under none past AI", () => {
    const by = Object.fromEntries(deckStats("vc", VC, now).map((s) => [s.key, s.value]));
    expect(by).toEqual({
      uploaded: 11,
      vcIncomplete: 1,
      // everything past the AI except Incomplete — archived included, pending AI not
      aiEvaluated: 9,
      inDiligence: 6, // investment_dd … onboard_ready
      icReady: 5, // ic_review … onboard_ready
      onboardReady: 3, // alignment_call, legal_dd, onboard_ready
    });
  });

  it("reads AI Evaluated off the stage, so a blind-scoring withheld score cannot empty it", () => {
    expect(matchesStat("vc", { statusId: "analyst_scoring", aiScore: undefined }, "aiEvaluated")).toBe(true);
    expect(matchesStat("vc", { statusId: "pending_ai", aiScore: 7 }, "aiEvaluated")).toBe(false);
  });

  it("never matches another edition's key", () => {
    expect(matchesStat("vc", { statusId: "shortlisted" }, "shortlisted")).toBe(false);
    expect(matchesStat("incubator", { statusId: "ic_review" }, "icReady")).toBe(false);
  });

  it("names each deal's furthest box for the Uploaded view's Stage column", () => {
    expect(vcFunnelLabel("pending_ai").label).toBe("Pending AI");
    expect(vcFunnelLabel("incomplete").label).toBe("Incomplete");
    expect(vcFunnelLabel("associate_review").label).toBe("AI Evaluated");
    expect(vcFunnelLabel("partner_call").label).toBe("AI Evaluated");
    expect(vcFunnelLabel("investment_dd").label).toBe("In Diligence");
    expect(vcFunnelLabel("mp_decision").label).toBe("IC ready");
    expect(vcFunnelLabel("term_sheet").label).toBe("Onboard ready");
    expect(vcFunnelLabel("archived").label).toBe("Archived");
  });

  it("the rail is the five boxes after Uploaded", () => {
    expect(pipelineProgress(deckStats("vc", VC, now)).map((s) => s.label)).toEqual([
      "Incomplete",
      "AI Evaluated",
      "In Diligence",
      "IC ready",
      "Onboard ready",
    ]);
  });
});

// W9-A — `AISJ_VC_IC_member_V2` "Awaiting my vote" (F0434).
describe("the IC member's stat boxes", () => {
  const DEALS: IcStatDeck[] = [
    { id: "a", statusId: "ic_review" }, // no ballot
    { id: "b", statusId: "ic_review" }, // voted
    { id: "c", statusId: "mp_decision" }, // voted
    { id: "d", statusId: "term_sheet" },
    { id: "e", statusId: "legal_dd" },
    { id: "f", statusId: "onboard_ready" },
    { id: "g", statusId: "partner_review" }, // not at IC — outside the pool
    { id: "h", statusId: "archived" },
  ];
  const ballots: Record<string, MyBallot> = { a: null, b: "invest", c: "hold", d: null, e: null, f: "invest" };

  it("draws the six first-person boxes over the deals that reached the committee", () => {
    const stats = icMemberStats(DEALS, ballots);
    expect(stats.map((s) => s.label)).toEqual([
      "At IC",
      "Awaiting my vote",
      "Evaluated by me",
      "On agenda",
      "Investment pipeline",
      "Funded",
    ]);
    expect(Object.fromEntries(stats.map((s) => [s.key, s.value]))).toEqual({
      atIc: 6,
      myvote: 1,
      myeval: 3,
      agenda: 2,
      pipeline: 2,
      funded: 1,
    });
    expect(stats.find((s) => s.key === "pipeline")?.sublabel).toBe("1 term sheet · 1 legal DD");
  });

  it("does not count a deal as awaiting a vote before its ballots have been read", () => {
    expect(matchesIcStat({ statusId: "ic_review" }, "myvote", undefined)).toBe(false);
    expect(matchesIcStat({ statusId: "ic_review" }, "myvote", null)).toBe(true);
    expect(matchesIcStat({ statusId: "ic_review" }, "myeval", "pass")).toBe(true);
  });
});
