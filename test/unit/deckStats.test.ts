import { describe, it, expect } from "vitest";
import {
  deckStats,
  icMemberStats,
  matchesIcStat,
  matchesStat,
  matchesV3Stat,
  pipelineProgress,
  v3DeckState,
  v3DeckStats,
  v3StatusKey,
  V3_STATUS_LABELS,
  vcFunnelLabel,
  isArchivedDeck,
  latestTimestamp,
  ASSIGNED_TILE_RETAINED_PENDING_Q7,
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

// ═══════════════════════════════════════════════════════════════════════════
// V3-DASH — the reshared superuser Dashboard (`AISJ_SuperuserV3.HTM`)
// ═══════════════════════════════════════════════════════════════════════════

describe("V3 superuser Dashboard stat boxes", () => {
  // Nine decks. THREE are archived, so the denominator is 6, not 9 — which is
  // the whole point of this block: `build()` divides by `decks.length` and
  // would put every percentage below here 33% too low.
  const V3: StatDeck[] = [
    { statusId: "pending_ai" }, //            noteval
    { statusId: "uploaded" }, //              noteval
    { statusId: "manual_review" }, //         noteval
    { statusId: "incomplete" }, //            incomplete
    { statusId: "ai_evaluated", aiScore: 7.2 }, //  aieval
    { statusId: "shortlisted", aiScore: 8.6 }, //   aieval + shortlisted
    { statusId: "archived", aiScore: 5.2 }, //      ARCHIVED
    { statusId: "archived" }, //                    ARCHIVED
    { statusId: "archived", aiScore: 9.0 }, //      ARCHIVED
  ];

  it("draws the v3 six in the prototype's order, with its static sub-labels", () => {
    // Literals from `panel-alldecks.html`, not imported from the module, so a
    // rename in either direction fails here.
    const stats = v3DeckStats(V3).filter((s) => s.key !== "assigned");
    expect(stats.map((s) => s.label)).toEqual([
      "Uploaded",
      "AI Evaluated",
      "Not AI Evaluated",
      "Incomplete",
      "Archived",
      "Shortlisted",
    ]);
    expect(stats.map((s) => s.sublabel)).toEqual([
      "All decks in the pipeline",
      "Scored by AI",
      "Awaiting AI score",
      "Deck missing slides",
      "Set aside",
      "Advanced to signup",
    ]);
    // v3's `.scs` is STATIC prose: the computed "+3 since yesterday" and
    // "46% of uploaded" strings are gone with their helpers.
    expect(stats.some((s) => /since yesterday|% of uploaded|shortlist rate/.test(s.sublabel))).toBe(false);
    // `.scf` background, verbatim: AI Evaluated green, Archived --text-3,
    // Shortlisted purple (it was --green in v15).
    expect(Object.fromEntries(stats.map((s) => [s.key, s.color]))).toEqual({
      all: "var(--olive)",
      aieval: "var(--green)",
      noteval: "var(--amber)",
      incomplete: "var(--red)",
      archived: "var(--text-3)",
      shortlisted: "var(--purple)",
    });
  });

  it("counts an archived deck ONLY under Archived", () => {
    const by = Object.fromEntries(v3DeckStats(V3).map((s) => [s.key, s.value]));
    expect(by.archived).toBe(3);
    // Uploaded excludes them: 9 decks, 6 live.
    expect(by.all).toBe(6);
    // The archived decks carry an AI score and one is at a shortlist stage in
    // no version of this data — but even scored, they are absent here.
    expect(by.aieval).toBe(2);
    expect(by.noteval).toBe(3);
    expect(by.incomplete).toBe(1);
    expect(by.shortlisted).toBe(1);
    // The three states partition the live decks, exactly as `adData[].state` does.
    expect(by.aieval + by.noteval + by.incomplete).toBe(by.all);
  });

  it("THE DENOMINATOR: every bar divides by the live count, not the deck count", () => {
    const by = Object.fromEntries(v3DeckStats(V3).map((s) => [s.key, s.progress]));
    // 6 live decks. 2/6 = 33%, not 2/9 = 22%.
    expect(by.aieval).toBe(33);
    expect(by.noteval).toBe(50); // 3/6, not 3/9 = 33
    expect(by.incomplete).toBe(17); // 1/6, not 1/9 = 11
    expect(by.shortlisted).toBe(17); // 1/6, not 1/9 = 11
    // Uploaded's bar is pinned full, as `(k==='all')?100` pins it.
    expect(by.all).toBe(100);
    // Archived divides by the LIVE count too — the prototype applies the same
    // `c[k]/c.all` to it, so 3 archived against 6 live is 50%.
    expect(by.archived).toBe(50);
  });

  it("an all-archived workspace reports zeroes rather than dividing by zero", () => {
    const stats = v3DeckStats([{ statusId: "archived" }, { statusId: "archived" }]);
    const by = Object.fromEntries(stats.map((s) => [s.key, s]));
    expect(by.all.value).toBe(0);
    expect(by.archived.value).toBe(2);
    expect(by.archived.progress).toBe(0);
    expect(by.aieval.progress).toBe(0);
  });

  it("reads the AI state off the STAGE, so blind scoring cannot empty the box", () => {
    // A juror who has not submitted gets `aiScore: undefined` from the list
    // route; the deck is still AI evaluated.
    expect(v3DeckState({ statusId: "ai_evaluated", aiScore: undefined })).toBe("aieval");
    expect(v3DeckState({ statusId: "jury_evaluation", aiScore: undefined })).toBe("aieval");
    // …and a score with no stage still counts.
    expect(v3DeckState({ statusId: "manual_review", aiScore: 6.1 })).toBe("aieval");
    expect(v3DeckState({ statusId: "manual_review" })).toBe("noteval");
    expect(v3DeckState({ statusId: "uploaded" })).toBe("noteval");
    // Incomplete wins over both, so the three stay disjoint.
    expect(v3DeckState({ statusId: "incomplete", aiScore: 4.1 })).toBe("incomplete");
    expect(v3DeckState({ statusId: "ai_evaluated", aiScore: 4.1, signal: "flagged" })).toBe("incomplete");
  });

  // ── S1-DASH item 3 — the Status column's four words ──────────────────────
  //
  // The client asked for "Incomplete deck" and "Incomplete contact details" as
  // SEPARATE statuses. They are the two causes of `complete = 0` that plan §8.1
  // records as indistinguishable, so the word is a function of the pair
  // migration 0075 made readable: (ai_complete, missing_fields).
  describe("v3StatusKey — which of the two things is incomplete", () => {
    const evaluated = { statusId: "ai_evaluated", aiScore: 7.2 };

    it("derives all four combinations of (aiComplete, missingFields)", () => {
      // (0, set) — both wrong. The deck wins: there is nothing to ask a founder
      // whose deck could not be read in the first place.
      expect(v3StatusKey({ ...evaluated, aiComplete: false, missingFields: ["founderPhone"] })).toBe("incompleteDeck");
      // (0, empty) — the model could not read it; the contacts are fine.
      expect(v3StatusKey({ ...evaluated, aiComplete: false, missingFields: [] })).toBe("incompleteDeck");
      // (1, set) — the deck scored; a required intake column is blank. This is
      // the word that did not exist before, and plan §4.1 case (b)'s row.
      expect(v3StatusKey({ ...evaluated, aiComplete: true, missingFields: ["founderEmail"] })).toBe(
        "incompleteContact",
      );
      // (1, empty) — neither fires, so the AI-evaluation state answers.
      expect(v3StatusKey({ ...evaluated, aiComplete: true, missingFields: [] })).toBe("aieval");
    });

    it("prints the client's own words", () => {
      expect(V3_STATUS_LABELS.incompleteDeck).toBe("Incomplete deck");
      expect(V3_STATUS_LABELS.incompleteContact).toBe("Incomplete contact details");
      // The prototype's other two are unchanged (`adRenderTable`'s `stMap`).
      expect(V3_STATUS_LABELS.aieval).toBe("AI Evaluated");
      expect(V3_STATUS_LABELS.noteval).toBe("Not AI Evaluated");
    });

    it("absent reads as complete, matching the columns' own DEFAULT 1", () => {
      // A caller that selected neither column must not turn every deck red.
      expect(v3StatusKey({ statusId: "ai_evaluated", aiScore: 7.2 })).toBe("aieval");
      expect(v3StatusKey({ statusId: "uploaded" })).toBe("noteval");
    });

    it("says nothing about completeness before the AI has run", () => {
      // The shipped resubmit loop: `POST /queries/:id/respond` walks an
      // `incomplete` deck back to `uploaded` and raises `complete` without
      // re-reading it, so the columns still hold the PREVIOUS run's verdict.
      // The stage is the truth here, and the row must not contradict the
      // Not-AI-Evaluated tile it is counted under.
      expect(v3StatusKey({ statusId: "uploaded", aiComplete: false, missingFields: ["founderPhone"] })).toBe("noteval");
      expect(v3StatusKey({ statusId: "pending_ai", aiComplete: false })).toBe("noteval");
      // It costs the two words nothing: an evaluation lands a deck at
      // `ai_evaluated` or `incomplete`, so a deck that HAS a verdict is never
      // `noteval` and never reaches that early return.
      for (const statusId of ["ai_evaluated", "incomplete"]) {
        expect(v3DeckState({ statusId, aiScore: 4.1 })).not.toBe("noteval");
      }
    });

    it("falls back to Incomplete deck where a human flagged it and no cause was recorded", () => {
      // `flag_incomplete` (manual_review -> incomplete) writes no intake list
      // and runs no model. Saying "contact details" there would name a cause
      // nothing on the row supports.
      expect(v3StatusKey({ statusId: "incomplete" })).toBe("incompleteDeck");
      expect(v3StatusKey({ statusId: "ai_evaluated", signal: "flagged" })).toBe("incompleteDeck");
    });

    // NEGATIVE CONTROL. `aiComplete` is the ONLY thing separating the two
    // words: take it away — which is every deck evaluated before 0075, whose
    // backfill is `ai_complete = complete` — and both collapse onto one, which
    // is exactly the indistinguishability §8.1 reported and could not fix.
    it("collapses to one word when the model's verdict was never recorded", () => {
      const stuck = { ...evaluated, aiComplete: false };
      expect(v3StatusKey({ ...stuck, missingFields: ["founderPhone"] })).toBe("incompleteDeck");
      expect(v3StatusKey({ ...stuck, missingFields: [] })).toBe("incompleteDeck");
    });

    // The word refines the STATUS only. `v3DeckState` and `matchesV3Stat` are
    // untouched, so every V3-DASH tile count stays where item 19 put it — a
    // deck can read "Incomplete contact details" and still be counted under AI
    // Evaluated, because it was AI-evaluated.
    it("does not move a tile", () => {
      const stripped = { ...evaluated, aiComplete: true, missingFields: ["founderEmail"] };
      expect(v3StatusKey(stripped)).toBe("incompleteContact");
      expect(v3DeckState(stripped)).toBe("aieval");
      expect(matchesV3Stat(stripped, "aieval")).toBe(true);
      expect(matchesV3Stat(stripped, "incomplete")).toBe(false);
    });
  });

  it("matchesV3Stat is the table filter: archived decks appear in ONE view", () => {
    const archived: StatDeck = { statusId: "archived", aiScore: 5.2 };
    expect(matchesV3Stat(archived, "archived")).toBe(true);
    for (const key of ["all", "aieval", "noteval", "incomplete", "shortlisted"] as const) {
      expect(matchesV3Stat(archived, key), `archived must not show under ${key}`).toBe(false);
    }
    // …and a live deck never appears under Archived.
    expect(matchesV3Stat({ statusId: "shortlisted", aiScore: 8.6 }, "archived")).toBe(false);
    expect(matchesV3Stat({ statusId: "shortlisted", aiScore: 8.6 }, "shortlisted")).toBe(true);
    expect(matchesV3Stat({ statusId: "shortlisted", aiScore: 8.6 }, "all")).toBe(true);
    // Every tile's count equals the rows its view draws — including Uploaded,
    // whose predicate IS "not archived".
    for (const tile of v3DeckStats(V3)) {
      expect(V3.filter((d) => matchesV3Stat(d, tile.key)).length, `${tile.key} count vs rows`).toBe(tile.value);
    }
    expect(V3.filter((d) => matchesV3Stat(d, "all")).length).toBe(V3.filter((d) => !isArchivedDeck(d)).length);
  });

  it("Q7 — the Assigned tile is RETAINED until the client confirms its removal", () => {
    // v3 deletes it, which reverses Aug-2026 issue 4. plan_v3_superuser.md §4
    // Q7 is unanswered, so it stays, in its issue-4 position (before
    // Shortlisted). Flip ASSIGNED_TILE_RETAINED_PENDING_Q7 to ship the six.
    expect(ASSIGNED_TILE_RETAINED_PENDING_Q7).toBe(true);
    expect(v3DeckStats(V3).map((s) => s.key)).toEqual([
      "all",
      "aieval",
      "noteval",
      "incomplete",
      "archived",
      "assigned",
      "shortlisted",
    ]);
    // It counts what issue 4 said it counts, minus the archived.
    const assigned = v3DeckStats([
      { statusId: "assigned", assignedTo: "u1" },
      { statusId: "jury_evaluation" },
      { statusId: "archived", assignedTo: "u1" },
      { statusId: "uploaded" },
    ]).find((s) => s.key === "assigned");
    expect(assigned?.value).toBe(2);
  });

  it("the rail drops Uploaded and keeps the rest, titles intact (issue 7)", () => {
    expect(pipelineProgress(v3DeckStats(V3)).map((s) => s.label)).toEqual([
      "AI Evaluated",
      "Not AI Evaluated",
      "Incomplete",
      "Archived",
      "Assigned",
      "Shortlisted",
    ]);
  });

  it("the OLD incubator six are untouched — admin, PM, PA and jury keep their screen", () => {
    // Only the superuser prototype was reshared. `deckStats("incubator", …)`
    // must still answer exactly as it did, denominator included.
    const stats = deckStats("incubator", V3);
    expect(stats.map((s) => s.label)).toEqual([
      "Uploaded",
      "Pending",
      "Incomplete",
      "AI Evaluated",
      "Assigned",
      "Shortlisted",
    ]);
    // Nine decks, archived included — the old set has no archived exclusion.
    expect(stats.find((s) => s.key === "all")?.value).toBe(9);
    expect(stats.find((s) => s.key === "evaluated")?.progress).toBe(
      Math.round((V3.filter((d) => d.aiScore !== undefined).length / 9) * 100),
    );
  });
});

describe("latestTimestamp", () => {
  it("compares parsed instants, not strings, across D1's two formats", () => {
    // "2026-09-20 10:00:00" (datetime('now')) is LATER than
    // "2026-09-20T09:00:00.000Z" (toISOString) — but sorts below it as a
    // string, because " " < "T". A plain SQL MAX() gets this backwards.
    expect(latestTimestamp("2026-09-20T09:00:00.000Z", "2026-09-20 10:00:00")).toBe("2026-09-20 10:00:00");
    expect(latestTimestamp("2026-09-20 08:00:00", "2026-09-20T09:00:00.000Z")).toBe("2026-09-20T09:00:00.000Z");
  });

  it("ignores nulls, blanks and unparseable values, and returns undefined for nothing", () => {
    expect(latestTimestamp(null, undefined, "")).toBeUndefined();
    expect(latestTimestamp(undefined, "2026-01-01 00:00:00", null)).toBe("2026-01-01 00:00:00");
    expect(latestTimestamp("not a date", "2026-01-01 00:00:00")).toBe("2026-01-01 00:00:00");
    expect(latestTimestamp()).toBeUndefined();
  });
});
