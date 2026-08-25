import { describe, it, expect } from "vitest";
import {
  deckStats,
  matchesStat,
  pipelineProgress,
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

  it("uses the VC pipeline's own stages for Shortlisted", () => {
    const vcDecks: StatDeck[] = [
      { statusId: "analyst_scoring", aiScore: 7 },
      { statusId: "partner_review", aiScore: 8 },
      { statusId: "term_sheet", aiScore: 8.5 },
      { statusId: "archived", aiScore: 5 },
    ];
    const by = Object.fromEntries(deckStats("vc", vcDecks).map((s) => [s.key, s.value]));
    expect(by.shortlisted).toBe(2); // partner_review + term_sheet
    expect(by.assigned).toBe(1); // analyst_scoring
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
