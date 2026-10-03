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
  latestTimestamp,
  ASSIGNED_TILE_CONFIRMED_BY_FINAL_STATUS_MAP,
  isScreeningIncompleteTile,
  isQueryUnanswered,
  contactComplete,
  deckComplete,
  screeningStatus,
  screeningStatusLabel,
  screeningStatusRank,
  isScreeningSink,
  ROW6_PROVEN_OMISSIONS,
  SCREENING_FILTER_OPTIONS,
  SCREENING_SINK_TILE,
  SCREENING_STATUS_LABELS,
  SCREENING_STATUS_ORDER,
  type ScreeningDeck,
  type ScreeningValue,
  type IcStatDeck,
  type MyBallot,
  type StatDeck,
} from "../../src/shared/deckStats";
import { deckListRoute } from "../../src/shared/queries";

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

  /**
   * 2026-09-23 — the client: "archive is a state, not a move." Archiving used
   * to drop the row out of Uploaded entirely, so the "Archived" status their
   * own row asks for was a status no row ever showed again. These three tests
   * are the old ones inverted; the relocation cannot come back unnoticed.
   */
  it("keeps an archived deck in Uploaded, and counts it under Archived only", () => {
    const by = Object.fromEntries(v3DeckStats(V3).map((s) => [s.key, s.value]));
    expect(by.archived).toBe(3);
    // Uploaded holds every deck now — 9, not the 6 live ones.
    expect(by.all).toBe(9);
    // The WORKING tiles still exclude them: an archived deck's state is
    // Archived, and letting it also sit under AI Evaluated would double-count
    // it and make the six boxes overlap.
    expect(by.aieval).toBe(2);
    expect(by.noteval).toBe(3);
    expect(by.incomplete).toBe(1);
    expect(by.shortlisted).toBe(1);
    // So the four states — three live plus Archived — partition Uploaded.
    expect(by.aieval + by.noteval + by.incomplete + by.archived).toBe(by.all);
  });

  it("THE DENOMINATOR: every bar divides by Uploaded, which now includes archived", () => {
    const by = Object.fromEntries(v3DeckStats(V3).map((s) => [s.key, s.progress]));
    // 9 decks in Uploaded. 2/9 = 22%, not 2/6 = 33%.
    expect(by.aieval).toBe(22);
    expect(by.noteval).toBe(33); // 3/9
    expect(by.incomplete).toBe(11); // 1/9
    expect(by.shortlisted).toBe(11); // 1/9
    // Uploaded's bar is pinned full, as `(k==='all')?100` pins it.
    expect(by.all).toBe(100);
    expect(by.archived).toBe(33); // 3/9
    // The base is the All tile itself — the invariant that keeps a bar from
    // disagreeing with the rows its view draws.
    const all = v3DeckStats(V3).find((t) => t.key === "all")!.value;
    expect(all).toBe(V3.length);
  });

  it("an all-archived workspace reports every deck, not an empty screen", () => {
    const stats = v3DeckStats([{ statusId: "archived" }, { statusId: "archived" }]);
    const by = Object.fromEntries(stats.map((s) => [s.key, s]));
    // This is the case the old behaviour made unreachable: archive everything
    // and Uploaded read 0 with the rows nowhere to be seen.
    expect(by.all.value).toBe(2);
    expect(by.archived.value).toBe(2);
    expect(by.archived.progress).toBe(100);
    expect(by.aieval.progress).toBe(0);
  });

  it("still does not divide by zero on an empty workspace", () => {
    const by = Object.fromEntries(v3DeckStats([]).map((s) => [s.key, s]));
    expect(by.all.value).toBe(0);
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

  // ── S0-VOCAB — the client's 24-Sep screening machine ─────────────────────
  //
  // `v3StatusKey`'s four words are SUPERSEDED by `screeningStatus`'s thirteen
  // statuses and three sinks. Every guard the four-word describe made
  // un-revertable is carried forward below, on the new contract — including the
  // two that INVERT, each marked with why the old one was right then and the new
  // one is right now. The readings are `docs/plan_screening.md` §2's, conflict by
  // conflict; a test that disagreed with §2 would be a fifteenth resolution.
  //
  // The shim itself keeps ONE test (`v3StatusKey is kept alive…` below), because
  // its remaining callers are other sessions' files and an untested shim drifts.
  describe("screeningStatus — the thirteen statuses and the three sinks", () => {
    // The gate is a REQUIRED parameter, never a constant: it becomes
    // `org_scoring_settings.ai_gate_threshold` (migration 0082, default 5.0) and
    // a fallback constant beside a setting is how this product came to have
    // three thresholds. 5 here is that default, written out, not imported.
    const at = (deck: ScreeningDeck, gate = 5) => screeningStatus(deck, { gate });
    /** Evaluated, scored above the gate — the row every `(D, C)` case varies. */
    const evaluated: ScreeningDeck = { statusId: "ai_evaluated", aiScore: 7.2 };

    it("derives all four combinations of (deck complete, contact complete)", () => {
      // (0, set) — BOTH wrong, and it is now its own word. C2: today
      // deck-before-contact collapses this into "Incomplete deck", and two live
      // seed decks are in the collapse (inc_deck_payroute,
      // inc_deck_meera_incomplete: ai_complete = 0 AND
      // missing_fields = 'founderPhone'). The DATA always distinguished the
      // pair; only the label did not.
      expect(at({ ...evaluated, aiComplete: false, missingFields: ["founderPhone"] as const })).toBe("bothIncomplete");
      // (0, empty) — the model could not read it; the contacts are fine.
      expect(at({ ...evaluated, aiComplete: false, missingFields: [] })).toBe("incompleteDeck");
      // (1, set) — the deck scored; a required intake column is blank.
      expect(at({ ...evaluated, aiComplete: true, missingFields: ["founderEmail"] as const })).toBe("incompleteContact");
      // (1, empty) — both axes pass, so the RATING is asked, and only now.
      expect(at({ ...evaluated, aiComplete: true, missingFields: [] })).toBe("complete");
    });

    // THE GUARD THAT INVERTS, and the reason is C2. The old negative control
    // asserted that (0, set) and (0, empty) COLLAPSE onto one word — which was
    // the indistinguishability plan §8.1 reported and migration 0075 fixed at
    // the column level without ever spending the new word. Row 6 of his 24-Sep
    // feedback spends it. So the same fixture that used to prove a collapse now
    // proves a separation.
    it("no longer collapses Both incomplete onto Incomplete decks", () => {
      const both = { ...evaluated, aiComplete: false, missingFields: ["founderPhone"] as const };
      expect(at(both)).toBe("bothIncomplete");
      expect(at({ ...both, missingFields: [] })).toBe("incompleteDeck");
      expect(SCREENING_STATUS_LABELS[at(both)]).toBe("Both incomplete");
      // …and the old word is what the superseded function still says, which is
      // the measurement of what changed rather than a claim that nothing did.
      expect(v3StatusKey(both)).toBe("incompleteDeck");
    });

    it("keeps his check order: deck, then contact, then RATING — asked last and only of a complete deck", () => {
      // His fixed order, already the build's (`computeResult` short-circuits on
      // completeness before applying the gate, ai/evaluate.ts:484-489). A deck
      // failing either axis never reaches the threshold question, so a thin deck
      // scoring 2.0 is "Incomplete decks" and never "Below threshold".
      expect(at({ statusId: "ai_evaluated", aiScore: 2.0, aiComplete: false, missingFields: [] })).toBe(
        "incompleteDeck",
      );
      expect(at({ statusId: "ai_evaluated", aiScore: 2.0, aiComplete: true, missingFields: ["city"] as const })).toBe(
        "incompleteContact",
      );
      // Complete on both axes: NOW the gate decides.
      expect(at({ statusId: "ai_evaluated", aiScore: 2.0, aiComplete: true, missingFields: [] })).toBe(
        "belowThreshold",
      );
    });

    it("C13 — 'at or above the threshold' means >=, and one seeded deck turns on it", () => {
      // His words are unambiguous; ours came from a different diagram
      // (`evaluate.ts:27`, "strictly-greater-than gate from the flow diagram",
      // applied at :488 as `total > GATE`). A deck scoring exactly the gate is
      // Complete under his spec and Rejected under ours. One character.
      const scored = (aiScore: number) => at({ statusId: "ai_evaluated", aiScore, aiComplete: true });
      expect(scored(5.0)).toBe("complete");
      expect(scored(4.9)).toBe("belowThreshold");
      // And the gate is the caller's, so an org that raises it re-labels rows.
      expect(screeningStatus({ statusId: "ai_evaluated", aiScore: 6.5 }, { gate: 7 })).toBe("belowThreshold");
      expect(screeningStatus({ statusId: "ai_evaluated", aiScore: 6.5 }, { gate: 6.5 })).toBe("complete");
    });

    it("an absent score is not below the gate — blind scoring must not announce a verdict", () => {
      // A juror who has not submitted gets `aiScore: undefined` from the list
      // route, and the same view feeds this function. "Below threshold" there
      // would state the number the caller was not allowed to see.
      expect(at({ statusId: "ai_evaluated", aiComplete: true, missingFields: [] })).toBe("complete");
      expect(at({ statusId: "jury_evaluation", aiComplete: true })).toBe("complete");
    });

    it("the EDITED branch reverses his order — contact, then deck, then rating", () => {
      // His own asymmetry, drawn twice in his own §4 diagram: the fresh branch
      // asks "deck complete?" first, the edit branch asks "contact complete?"
      // first. It is not a slip to tidy — the branch exists BECAUSE somebody
      // edited the contact details, so the first thing it re-asks is whether
      // that worked.
      const edited: ScreeningDeck = { ...evaluated, contactEditedAt: "2026-09-29T10:00:00Z" };
      expect(at({ ...edited, aiComplete: true, missingFields: ["founderPhone"] as const })).toBe("incompleteContactEdited");
      expect(at({ ...edited, aiComplete: false, missingFields: [] })).toBe("incompleteDeckEdited");
      expect(at({ ...edited, aiComplete: true, missingFields: [], aiScore: 4.1 })).toBe("belowThresholdEdited");
      expect(at({ ...edited, aiComplete: true, missingFields: [] })).toBe("completeEdited");
    });

    it("has NO 'Both incomplete, Edited', and the reversed order is exactly why", () => {
      // The one visible consequence of the asymmetry above, and the reason his
      // eleven rows contain no such state: after an edit, a deck failing BOTH
      // axes is asked about contact first, so it reads "Incomplete contact
      // details, Edited". Unedited, the same columns read "Both incomplete".
      const columns = { ...evaluated, aiComplete: false, missingFields: ["founderPhone"] as const };
      expect(at(columns)).toBe("bothIncomplete");
      expect(at({ ...columns, contactEditedAt: "2026-09-29T10:00:00Z" })).toBe("incompleteContactEdited");
      expect(SCREENING_STATUS_ORDER).not.toContain("bothIncompleteEdited" as ScreeningValue);
    });

    it("is HISTORY, not columns — the pair his spec cannot tell apart any other way", () => {
      // The whole reason this is not `v3StatusKey` with more strings. These two
      // rows have IDENTICAL columns; only `contactEditedAt` separates them, and
      // it is already persisted (`pipeline_events.action = 'edit_contact'`,
      // served at routes/decks.ts:121 from a CONTACT_FIELDS set of exactly his
      // four fields). No migration, and no new column on `decks`.
      const columns = { ...evaluated, aiComplete: true, missingFields: ["founderPhone"] as const };
      expect(at(columns)).toBe("incompleteContact");
      expect(at({ ...columns, contactEditedAt: "2026-09-29T10:00:00Z" })).toBe("incompleteContactEdited");
      expect(SCREENING_STATUS_LABELS.incompleteContact).toBe("Incomplete contact details");
      expect(SCREENING_STATUS_LABELS.incompleteContactEdited).toBe("Incomplete contact details, Edited");
    });

    it("C3 — says nothing about completeness before the AI has run", () => {
      // Carried forward whole. The shipped resubmit loop
      // (`POST /queries/:id/respond`) walks an `incomplete` deck back to
      // `uploaded` and raises `complete` WITHOUT re-reading it, so the two
      // completeness columns still hold the previous run's verdict.
      expect(at({ statusId: "uploaded", aiComplete: false, missingFields: ["founderPhone"] as const })).toBe("awaitingAi");
      expect(at({ statusId: "pending_ai", aiComplete: false })).toBe("awaitingAi");
      // It is the NOTEVAL TILE's own predicate and not a stage list, which is
      // what makes the pill and the box unable to disagree — C3's whole point.
      for (const deck of [{ statusId: "uploaded" }, { statusId: "pending_ai" }, { statusId: "manual_review" }]) {
        expect(v3DeckState(deck)).toBe("noteval");
        expect(at(deck)).toBe("awaitingAi");
        expect(matchesV3Stat(deck, "noteval")).toBe(true);
      }
      // …and it costs the thirteen nothing: an evaluation lands a deck at
      // `ai_evaluated` or `incomplete`, so a deck that HAS a verdict is never
      // `noteval` and never reaches that early return.
      for (const statusId of ["ai_evaluated", "incomplete"]) {
        expect(v3DeckState({ statusId, aiScore: 4.1 })).not.toBe("noteval");
      }
    });

    it("C3 — the word his row 6 deletes, on the tile his row 6 cannot delete", () => {
      // Row 6 drops "Not AI Evaluated". It is a stat BOX as well as a word, and
      // `inc_deck_pitchloop` sits in it at `pending_ai`. A populated stat box
      // whose rows have nothing to say is worse than a seventh word.
      expect(SCREENING_STATUS_LABELS.awaitingAi).toBe("Awaiting AI evaluation");
      expect(v3DeckStats([{ statusId: "pending_ai" }]).map((t) => t.key)).toContain("noteval");
      expect(ROW6_PROVEN_OMISSIONS).toContain("awaitingAi");
    });

    it("still blames the deck where a human flagged it and no cause was recorded", () => {
      // Carried forward from `v3StatusKey`, and it is load-bearing in a way the
      // new (D, C, R) table is not: `flag_incomplete` (manual_review ->
      // incomplete) writes no intake list and runs no model, so `aiComplete` is
      // ABSENT and `missingFields` empty. Read as DEFAULT 1 on both axes that is
      // `D ∧ C`, which would offer Send to Assign on a deck an operator had just
      // set aside. An absent verdict on a row that says `incomplete` is ¬D.
      expect(at({ statusId: "incomplete" })).toBe("incompleteDeck");
      expect(at({ statusId: "incomplete", aiScore: 7.2 })).toBe("incompleteDeck");
      expect(at({ statusId: "incomplete", aiScore: 7.2, missingFields: [] })).toBe("incompleteDeck");
      expect(at({ statusId: "ai_evaluated", aiScore: 7.2, signal: "flagged" })).toBe("incompleteDeck");
      // A RECORDED verdict always wins over the stage — plan §12.9's regression.
      expect(at({ statusId: "incomplete", aiScore: 7.2, aiComplete: false })).toBe("incompleteDeck");
      expect(at({ statusId: "incomplete", aiScore: 7.2, aiComplete: true, missingFields: ["founderPhone"] as const })).toBe(
        "incompleteContact",
      );
    });

    it("does not call a readable deck incomplete once its contacts are filled in", () => {
      // plan §12.9's regression, on the new machine. Evaluated, then stripped of
      // a required detail: the STAGE is `incomplete`, the model read the deck
      // perfectly well. The operator types the phone number; `PATCH
      // /api/decks/:id` empties the intake list and raises `complete`, and the
      // stage lags until the resubmit loop moves it. The row must not now blame
      // the deck — or, worse under the new machine, name BOTH causes.
      const stripped = { statusId: "incomplete", aiScore: 7.2, aiComplete: true };
      expect(at({ ...stripped, missingFields: ["founderPhone"] as const })).toBe("incompleteContact");
      expect(at({ ...stripped, missingFields: [] })).toBe("complete");
      expect(screeningStatusLabel({ ...stripped, missingFields: [] }, { gate: 5 })).toBe("Complete");
    });

    // ── Oct-2026 issue 1 · the two axes, now exported for the list filter ──
    it("the two axes are exported, and they are NOT `isDeckComplete`", () => {
      // `routes/decks.ts` narrows both rosters with these (his 2026-10-02 flow),
      // and it has to ask the STATUS's axes rather than `deckListRoute`'s own
      // `isDeckComplete`. This is the row where the two disagree: the resubmit
      // loop raises the frozen ANDed `complete` column without re-reading the
      // deck or touching `ai_complete`, so `isDeckComplete` says yes while the
      // model never managed to read the deck at all.
      const unread: ScreeningDeck = { statusId: "ai_evaluated", aiScore: 8, aiComplete: false, complete: true };
      expect(deckComplete(unread)).toBe(false);
      expect(contactComplete(unread)).toBe(true);
      expect(at(unread)).toBe("incompleteDeck");
      // Absent reads as complete on both, matching each column's DEFAULT 1.
      expect(deckComplete({})).toBe(true);
      expect(contactComplete({})).toBe(true);
      // …except that an absent VERDICT on a row whose stage says `incomplete`
      // is read as the deck's fault, which is the one exception `deckComplete`
      // carries forward from `v3StatusKey` (the manual `flag_incomplete` route).
      expect(deckComplete({ statusId: "incomplete" })).toBe(false);
      expect(contactComplete({ missingFields: ["city"] })).toBe(false);
    });

    it("absent columns read as complete — the columns' own DEFAULT 1", () => {
      // A caller that selected neither column must not turn every row red.
      // Every field on `ScreeningDeck` is optional for the same reason: two of
      // them do not exist on any row until S2-SERVER serves them.
      expect(at({ statusId: "ai_evaluated", aiScore: 7.2 })).toBe("complete");
      expect(at({ statusId: "uploaded" })).toBe("awaitingAi");
      expect(at({})).toBe("awaitingAi");
    });

    // ── The three sinks, and the row-7 latch they stand for ────────────────
    it("answers the three sinks first, because reaching one empties the whitelist", () => {
      // His feedback row 7: no action is active once Send to Query / Send to
      // Assign / Archive has fired. A deck that reached a final must not be
      // re-described by an intermediate predicate that still holds.
      const incomplete = { aiComplete: false, missingFields: ["founderPhone"] as const };
      expect(at({ ...incomplete, statusId: "archived" })).toBe("archived");
      expect(at({ ...incomplete, statusId: "ai_evaluated", queried: true })).toBe("queried");
      expect(at({ ...incomplete, statusId: "ai_evaluated", sendToAssignAt: "2026-09-29T10:00:00Z" })).toBe("assigned");
      for (const sink of ["archived", "queried", "assigned"] as const) expect(isScreeningSink(sink)).toBe(true);
      for (const v of ["complete", "belowThreshold", "rejected"] as const) expect(isScreeningSink(v)).toBe(false);
      // Archived outranks the other two: it is the only terminal one, so a deck
      // queried and THEN archived is Archived.
      expect(at({ statusId: "archived", queried: true, sendToAssignAt: "x" })).toBe("archived");
    });

    it("C1 — ONE string for the assigned sink, and it is the map's, not row 6's", () => {
      // Row 6 says "Complete, Assigned"; his §5 matrix AND his FINAL STATUSES
      // map both say "AI Evaluated, Assigned". Two of his three lists agree, and
      // the agreeing one is the authoritative stat-box map.
      expect(SCREENING_STATUS_LABELS.assigned).toBe("AI Evaluated, Assigned");
      expect(Object.values(SCREENING_STATUS_LABELS)).not.toContain("Complete, Assigned");
    });

    it("the assigned sink is the MARKER, never the `assigned` stage (his row 12)", () => {
      // `POST /decks/:id/transition` will move a deck to `assigned` with
      // `assigned_to` still NULL (DashboardPage.tsx:1316-1320) — exactly the
      // shape of his row 12 Foul. The marker latches the deck onto the Assign
      // roster while `assigned_to` keeps meaning a real evaluator, which is the
      // only way his Send-to-Assign row and his row 12 both hold.
      expect(at({ statusId: "assigned", assignedTo: "u1", aiComplete: true, aiScore: 7.2 })).not.toBe("assigned");
      expect(at({ statusId: "assigned", assignedTo: "u1", aiComplete: true, aiScore: 7.2 })).toBe("complete");
      expect(at({ statusId: "ai_evaluated", aiScore: 7.2, sendToAssignAt: "2026-09-29T10:00:00Z" })).toBe("assigned");
    });

    // ── Oct-2026 issue 5 · "it should say reevaluated" ─────────────────────
    describe("reevaluated — the AI has read this deck more than once", () => {
      it("displaces `complete`, and only once the count is above one", () => {
        // The count is `COUNT(pipeline_events WHERE action = 'ai_evaluated')`,
        // served as `evaluationRuns`. One run is a first evaluation, which is
        // every deck the model has scored exactly once.
        expect(at({ ...evaluated, evaluationRuns: 1 })).toBe("complete");
        expect(at({ ...evaluated, evaluationRuns: 2 })).toBe("reevaluated");
        expect(screeningStatusLabel({ ...evaluated, evaluationRuns: 2 }, { gate: 5 })).toBe("Reevaluated");
      });

      it("absent, zero and one all read as a FIRST run", () => {
        // Same reading as every other field on `ScreeningDeck`: absent never
        // invents a claim. A caller that did not select the count loses a word;
        // it does not relabel every scored deck.
        expect(at(evaluated)).toBe("complete");
        expect(at({ ...evaluated, evaluationRuns: 0 })).toBe("complete");
      });

      it("never displaces a word the operator has to act on", () => {
        // The reason it sits only on the passing status: every other status is
        // an INSTRUCTION — why the only exit is Query, or Reject, or Edit — and
        // "Reevaluated" over any of them deletes that reason for the sake of a
        // fact about history.
        const twice = { evaluationRuns: 3 };
        expect(at({ ...evaluated, ...twice, aiScore: 4.1 })).toBe("belowThreshold");
        expect(at({ ...evaluated, ...twice, aiComplete: false })).toBe("incompleteDeck");
        expect(at({ ...evaluated, ...twice, missingFields: ["founderPhone"] as const })).toBe("incompleteContact");
        expect(at({ ...evaluated, ...twice, aiComplete: false, missingFields: ["city"] as const })).toBe(
          "bothIncomplete",
        );
        expect(at({ ...evaluated, ...twice, statusId: "rejected" })).toBe("rejected");
        // And the three sinks still answer first — row 7's latch is unmoved.
        expect(at({ ...evaluated, ...twice, statusId: "archived" })).toBe("archived");
        expect(at({ ...evaluated, ...twice, sendToAssignAt: "2026-09-29T10:00:00Z" })).toBe("assigned");
        // The queried sink takes an UNRESOLVED deck, as `isQueriedSinkCurrent`
        // already requires (it asks `deckListRoute`, which reads the ANDed
        // `complete`) — so this is the same fixture the sink test above uses.
        expect(
          at({ ...evaluated, ...twice, aiComplete: false, missingFields: ["founderPhone"], queried: true }),
        ).toBe("queried");
        // Nothing is said before the model has run at all, whatever the count.
        expect(at({ statusId: "uploaded", ...twice })).toBe("awaitingAi");
      });

      it("wins over `completeEdited`, because the edit is why it was re-read", () => {
        const edited = { ...evaluated, contactEditedAt: "2026-10-01T09:00:00Z" };
        expect(at({ ...edited, evaluationRuns: 1 })).toBe("completeEdited");
        expect(at({ ...edited, evaluationRuns: 2 })).toBe("reevaluated");
        // The edited branch's own order is untouched above the rating check.
        expect(at({ ...edited, evaluationRuns: 2, missingFields: ["city"] as const })).toBe(
          "incompleteContactEdited",
        );
        expect(at({ ...edited, evaluationRuns: 2, aiComplete: false })).toBe("incompleteDeckEdited");
        expect(at({ ...edited, evaluationRuns: 2, aiScore: 4.1 })).toBe("belowThresholdEdited");
      });
    });

    it("Rejected is an INTERMEDIATE, and Archive is what makes it final", () => {
      // His matrix gives stage `rejected` the whitelist "Archive", and his
      // final-status map files it under Archived. So it is a pill on its own row
      // until somebody archives it, not a sink.
      expect(at({ statusId: "rejected", aiScore: 4.1 })).toBe("rejected");
      expect(isScreeningSink("rejected")).toBe(false);
      expect(at({ statusId: "archived", aiScore: 4.1 })).toBe("archived");
    });

    // ── C7 / C15 · his §7 open item ────────────────────────────────────────
    it("C7 — a queried deck past five working days reads No response, not Queried", () => {
      // His open item: decks Queried whose founder never responds get archived
      // with the reason "no response". Row 7 forbids any action on a queried
      // deck and his open item requires archiving exactly those, so the two
      // cannot both hold literally — this status is the narrowest exception, and
      // it is what S2-DASH re-arms "Archive (no response)" on.
      const sent: ScreeningDeck = { statusId: "incomplete", queried: true, lastQueryAt: "2026-09-11T10:00:00.000Z" };
      // Five WORKING days from Friday 11 Sep is Friday 18 Sep (the rule the
      // founder-query list already uses for "Overdue", QUERY_RESPONSE_WORKING_DAYS).
      expect(screeningStatus(sent, { gate: 5, now: Date.parse("2026-09-18T09:59:59Z") })).toBe("queried");
      expect(screeningStatus(sent, { gate: 5, now: Date.parse("2026-09-18T10:00:01Z") })).toBe("noResponse");
      // An ANSWERED query never becomes No response, however old it is.
      expect(
        screeningStatus({ ...sent, lastQueryAnswered: true }, { gate: 5, now: Date.parse("2026-10-30T10:00:00Z") }),
      ).toBe("queried");
      expect(SCREENING_STATUS_LABELS.noResponse).toBe("No response");
    });

    it("No response is INERT until S2-SERVER serves the two fields", () => {
      // NEGATIVE CONTROL, and the reason both fields are optional.
      // `DeckView.queried` is a boolean over `query_count` (routes/decks.ts:366)
      // and throws away exactly the timestamp this needs. Until the two
      // subqueries land, every queried deck is Queried — never a crash, and
      // never a deck silently swept for a window nobody measured.
      const noFields: ScreeningDeck = { statusId: "incomplete", queried: true };
      expect(isQueryUnanswered(noFields, Date.parse("2027-01-01T00:00:00Z"))).toBe(false);
      expect(screeningStatus(noFields, { gate: 5, now: Date.parse("2027-01-01T00:00:00Z") })).toBe("queried");
      // And an un-queried deck is never unanswered, whatever timestamps it has.
      expect(isQueryUnanswered({ lastQueryAt: "2026-01-01T00:00:00Z" })).toBe(false);
    });

    it("C15 — the open item's box is Archived, and the reason needs no schema", () => {
      // "no response" has no stat box of its own, and his own "counted in the
      // matching stat box" does not describe moving decks OUT of Incomplete. It
      // lands in Archived with `exit_note = 'no response'`, which `exit_note`
      // already surfaces from `pipeline_events.note` (routes/decks.ts:130).
      expect(SCREENING_SINK_TILE.archived).toBe("archived");
      // Before the sweep runs the row is still counted under Incomplete, which
      // is what makes the re-armed action reachable at all.
      const overdue: ScreeningDeck = { statusId: "incomplete", queried: true, lastQueryAt: "2026-09-11T10:00:00.000Z" };
      expect(matchesV3Stat(overdue, "incomplete")).toBe(true);
      expect(matchesV3Stat({ ...overdue, statusId: "archived" }, "archived")).toBe(true);
      expect(matchesV3Stat({ ...overdue, statusId: "archived" }, "incomplete")).toBe(false);
    });

    // ── C10 · the one tile predicate his spec moves ─────────────────────────
    it("C10 — a queried deck is counted under Incomplete whatever stage it sits at", () => {
      // His sink map files "Incomplete, Queried" under the Incomplete box, and
      // `queried` is not a stage: POST_AI_STAGES contains `ai_evaluated`, so a
      // deck queried out of the evaluated population counted under AI Evaluated.
      const queriedEvaluated: ScreeningDeck = {
        statusId: "ai_evaluated",
        aiScore: 4.2,
        queried: true,
        missingFields: ["founderPhone"] as const,
      };
      expect(SCREENING_SINK_TILE.queried).toBe("incomplete");
      expect(isScreeningIncompleteTile(queriedEvaluated)).toBe(true);
      expect(matchesV3Stat(queriedEvaluated, "incomplete")).toBe(true);
      // The three working tiles must still PARTITION, or they stop summing to
      // Uploaded — so AI Evaluated now declines it.
      expect(matchesV3Stat(queriedEvaluated, "aieval")).toBe(false);
      expect(matchesV3Stat(queriedEvaluated, "noteval")).toBe(false);
      expect(matchesV3Stat(queriedEvaluated, "all")).toBe(true);
      const tiles = Object.fromEntries(v3DeckStats([queriedEvaluated]).map((t) => [t.key, t.value]));
      expect(tiles.all).toBe(1);
      expect(tiles.incomplete).toBe(1);
      expect(tiles.aieval).toBe(0);
      expect(tiles.noteval).toBe(0);
    });

    // THE DEFECT THIS PREDICATE HAD IN ITS FIRST FORM, and the fixture that
    // caught it, kept because bare `queried` is the obvious reading and it is
    // wrong. `queried` is `query_count > 0` and therefore PERMANENT: a deck
    // queried months ago, whose founder answered, which was re-scored and
    // shortlisted, still carries it. Counting that under Incomplete was wrong by
    // two tiles — caught by allDecks.test.tsx's denominator test on its
    // GreenRoute row (shortlisted, aiScore 9.1, queried: true), which is S2-DASH's
    // file and stayed green. His sink is "Incomplete, QUERIED"; a deck review has
    // picked back up is neither.
    it("C10 — but a deck review has picked back up is not Incomplete, however old its query", () => {
      const greenRoute: ScreeningDeck = { statusId: "shortlisted", aiScore: 9.1, queried: true };
      expect(isScreeningIncompleteTile(greenRoute)).toBe(false);
      expect(matchesV3Stat(greenRoute, "incomplete")).toBe(false);
      expect(matchesV3Stat(greenRoute, "aieval")).toBe(true);
      expect(matchesV3Stat(greenRoute, "shortlisted")).toBe(true);
      // …and the STATUS does not claim the sink either.
      expect(at(greenRoute)).not.toBe("queried");
      expect(at(greenRoute)).toBe("complete");
      // The same is true of an assignable deck with query history behind it:
      // `deckListRoute` sends it to Assign, so it is not "on Query".
      const resubmitted: ScreeningDeck = { statusId: "ai_evaluated", aiScore: 7.2, queried: true, complete: true };
      expect(at(resubmitted)).toBe("complete");
      expect(isScreeningIncompleteTile(resubmitted)).toBe(false);
    });

    it("C10 — the authority is deckListRoute, so the tile and the Query screen cannot disagree", () => {
      // One function, one answer: the same predicate the server partitions
      // `?list=` on, which also already knows the stage window an answered query
      // stays listed in (F0214, W9-A). A deck waiting in the resubmit window —
      // `founder_response` moves it `incomplete -> uploaded` — is the case C10
      // actually buys: it would otherwise slide into Not AI Evaluated.
      const waiting: ScreeningDeck = { statusId: "uploaded", queried: true };
      expect(deckListRoute(waiting, "incubator", { queried: true })).toBe("query");
      expect(isScreeningIncompleteTile(waiting)).toBe(true);
      expect(matchesV3Stat(waiting, "noteval")).toBe(false);
      expect(at(waiting)).toBe("queried");
      // Every deck the tile claims is a deck the Query screen would draw, and
      // vice versa — asserted over a spread of shapes rather than one.
      const shapes: ScreeningDeck[] = [
        { statusId: "uploaded", queried: true },
        { statusId: "incomplete", queried: true },
        { statusId: "shortlisted", queried: true },
        { statusId: "ai_evaluated", aiScore: 7.2, queried: true, complete: true },
        { statusId: "ai_evaluated", aiScore: 4.2, queried: true, missingFields: ["city"] as const },
        { statusId: "pending_ai" },
      ];
      for (const deck of shapes) {
        const onQuery = deckListRoute(deck, "incubator", { queried: deck.queried === true }) === "query";
        const tileSaysIncomplete = isScreeningIncompleteTile(deck);
        // The tile is the union of "on Query" and the old incomplete state, so
        // "on Query" must imply the tile, never the other way round.
        if (onQuery) expect(tileSaysIncomplete, `${deck.statusId}`).toBe(true);
      }
    });

    it("C10 — and the STAGE is never moved, which is why every other count holds", () => {
      // NEGATIVE CONTROL for the alternative that was rejected: folding
      // `queried` into `v3DeckState` reaches the same partition but also moves
      // the deprecated `v3StatusKey`, whose callers are other sessions' files.
      const queriedEvaluated: ScreeningDeck = {
        statusId: "ai_evaluated",
        aiScore: 4.2,
        queried: true,
        missingFields: ["founderPhone"] as const,
      };
      expect(v3DeckState(queriedEvaluated)).toBe("aieval");
      expect(queriedEvaluated.statusId).toBe("ai_evaluated");
      // Measured on the seed this moves nothing: the only queried incubator deck
      // is NimbusHR (inc_deck_meera_incomplete), already at stage `incomplete`.
      const nimbus: ScreeningDeck = { statusId: "incomplete", signal: "flagged", queried: true };
      expect(matchesV3Stat(nimbus, "incomplete")).toBe(true);
      expect(isScreeningIncompleteTile({ statusId: "incomplete" })).toBe(true);
    });

    it("the archived tile still wins over Queried — a state, not a move, both ways", () => {
      // `matchesV3Stat` answers Archived, then All, then the working tiles
      // (2026-09-23's deliberate deviation from the prototype's
      // `else if(d.archived) show=false`). His own display rule is that
      // deviation in his words — "ALL decks, INCLUDING ARCHIVED, always remain
      // on the uploaded status screen" — so the order is confirmed, not changed.
      const archivedQueried: StatDeck = { statusId: "archived", queried: true };
      expect(matchesV3Stat(archivedQueried, "archived")).toBe(true);
      expect(matchesV3Stat(archivedQueried, "all")).toBe(true);
      expect(matchesV3Stat(archivedQueried, "incomplete")).toBe(false);
    });

    it("the assigned TILE takes the marker too, so the sink's box is populated", () => {
      const sent: StatDeck = { statusId: "ai_evaluated", sendToAssignAt: "2026-09-29T10:00:00Z" };
      expect(matchesV3Stat(sent, "assigned")).toBe(true);
      // `assignedTo` and the two stages stay — they are what "allocated to an
      // evaluator" has meant since Aug-2026 issue 4, and the marker is additive.
      expect(matchesV3Stat({ statusId: "assigned", assignedTo: "u1" }, "assigned")).toBe(true);
      expect(matchesV3Stat({ statusId: "archived", sendToAssignAt: "x" }, "assigned")).toBe(false);
    });

    // ── The vocabulary as a contract for the five S2 sessions ──────────────
    it("prints his own words, and every status has exactly one", () => {
      // Literals, not imports, so a rename in either direction fails here.
      expect(SCREENING_STATUS_LABELS.incompleteContact).toBe("Incomplete contact details");
      expect(SCREENING_STATUS_LABELS.incompleteDeck).toBe("Incomplete decks");
      expect(SCREENING_STATUS_LABELS.bothIncomplete).toBe("Both incomplete");
      expect(SCREENING_STATUS_LABELS.belowThreshold).toBe("Below threshold");
      expect(SCREENING_STATUS_LABELS.rejected).toBe("Rejected");
      expect(SCREENING_STATUS_LABELS.complete).toBe("Complete");
      expect(SCREENING_STATUS_LABELS.contactEdited).toBe("Contact details edited");
      expect(SCREENING_STATUS_LABELS.incompleteDeckEdited).toBe("Incomplete decks, Edited");
      expect(SCREENING_STATUS_LABELS.belowThresholdEdited).toBe("Below threshold, Edited");
      expect(SCREENING_STATUS_LABELS.completeEdited).toBe("Complete, Edited");
      expect(SCREENING_STATUS_LABELS.queried).toBe("Incomplete, Queried");
      expect(SCREENING_STATUS_LABELS.archived).toBe("Archived");
      // Thirteen statuses + three sinks, each ordered exactly once. The five S2
      // sessions build `Record<ScreeningValue, …>` maps against this — S2-DASH's
      // eleven-row action whitelist is one — so a duplicate or a missing entry
      // is a hole in somebody else's exhaustiveness check.
      // Seventeen since Oct-2026 issue 5 added `reevaluated` — the second value
      // in here that is ours and not his (`awaitingAi` is the first).
      const labelled = Object.keys(SCREENING_STATUS_LABELS) as ScreeningValue[];
      expect(labelled).toHaveLength(17);
      expect(SCREENING_STATUS_LABELS.reevaluated).toBe("Reevaluated");
      expect(new Set(SCREENING_STATUS_ORDER).size).toBe(17);
      expect([...SCREENING_STATUS_ORDER].sort()).toEqual([...labelled].sort());
      expect(new Set(Object.values(SCREENING_STATUS_LABELS)).size).toBe(17);
    });

    it("C2 — the filter list and the pill set are exported SEPARATELY", () => {
      // The only reading under which both of his lists can be true: row 6 is the
      // sort/filter dropdown, the matrix is the displayed pill. A filter list may
      // be coarser than a display value; it may not omit the value a row shows.
      expect(SCREENING_FILTER_OPTIONS).not.toBe(SCREENING_STATUS_ORDER);
      for (const omitted of ROW6_PROVEN_OMISSIONS) {
        // Each one is PROVEN absent from his six by §2 — C2 for the first four,
        // C3 for `awaitingAi` — and each is still a pill a row can show.
        expect(SCREENING_FILTER_OPTIONS).not.toContain(omitted);
        expect(SCREENING_STATUS_ORDER).toContain(omitted);
      }
      // Eleven, NOT six: his verbatim six-word list is not transcribed anywhere
      // in this repo, so narrowing eleven to six is a question, not a guess.
      // Shipping the wider list keeps every displayed value filterable.
      expect(SCREENING_FILTER_OPTIONS).toHaveLength(12);
      expect(SCREENING_FILTER_OPTIONS).toContain("assigned");
      // `reevaluated` is ours and his row 6 cannot have omitted a word he had
      // not asked for yet, so the same rule applies: a value a row can show is
      // filterable.
      expect(SCREENING_FILTER_OPTIONS).toContain("reevaluated");
    });

    it("sorts on the flow's order, not on the string", () => {
      // S2-DASH's new STATUS column sort reads the rank. Alphabetical would put
      // "AI Evaluated, Assigned" first and "Archived" second, so the two ends of
      // the pipeline sit adjacent and read as if archiving were a kind of
      // assignment; the flow's order groups each pair with its Edited twin.
      expect(screeningStatusRank("awaitingAi")).toBe(0);
      expect(screeningStatusRank("archived")).toBe(SCREENING_STATUS_ORDER.length - 1);
      expect(screeningStatusRank("incompleteDeck")).toBeLessThan(screeningStatusRank("incompleteDeckEdited"));
      expect(screeningStatusRank("complete")).toBeLessThan(screeningStatusRank("assigned"));
      // Unknown values sort last and never throw — the column must survive a
      // status this file has not heard of yet.
      expect(screeningStatusRank("nonsense" as ScreeningValue)).toBe(SCREENING_STATUS_ORDER.length);
    });

    it("never returns I7 — 'Contact details edited' is a request, not a row state", () => {
      // His transient zero-button re-check. It lasts for the duration of one
      // PATCH, so nothing on the row can express it and nothing should: storing
      // it would be storing a request. S2-DASH renders it from the in-flight
      // save (generalising `rowBusy`, DashboardPage.tsx:1474), which is why the
      // key and the label are exported and the derivation is not.
      expect(SCREENING_STATUS_LABELS.contactEdited).toBe("Contact details edited");
      const everyShape: ScreeningDeck[] = [
        {},
        { statusId: "uploaded" },
        { statusId: "incomplete" },
        { statusId: "rejected" },
        { statusId: "archived" },
        { statusId: "ai_evaluated", aiScore: 7.2 },
        { statusId: "ai_evaluated", aiScore: 7.2, contactEditedAt: "2026-09-29T10:00:00Z" },
        { statusId: "ai_evaluated", aiComplete: false, contactEditedAt: "2026-09-29T10:00:00Z" },
        { statusId: "ai_evaluated", queried: true },
        { statusId: "ai_evaluated", sendToAssignAt: "x" },
      ];
      for (const deck of everyShape) expect(at(deck)).not.toBe("contactEdited");
    });

    it("v3StatusKey is kept alive UNCHANGED for its two remaining callers", () => {
      // DashboardPage.tsx:1806 (S2-DASH) and test/worker/ai-complete.test.ts:254
      // (S2-SERVER). Deleting it is S2-DASH's last step; until then an untested
      // shim drifts, so its four words stay pinned here.
      expect(V3_STATUS_LABELS.incompleteDeck).toBe("Incomplete deck");
      expect(V3_STATUS_LABELS.incompleteContact).toBe("Incomplete contact details");
      expect(V3_STATUS_LABELS.aieval).toBe("AI Evaluated");
      expect(V3_STATUS_LABELS.noteval).toBe("Not AI Evaluated");
      expect(v3StatusKey({ statusId: "ai_evaluated", aiScore: 7.2 })).toBe("aieval");
      expect(v3StatusKey({ statusId: "uploaded" })).toBe("noteval");
      expect(v3StatusKey({ statusId: "incomplete" })).toBe("incompleteDeck");
    });

    // ── The data caveat migration 0075 wrote down, in its new form ─────────
    it("a pre-0075 row reads Both incomplete, and the cause is still unrecoverable", () => {
      // 0075's backfill is `ai_complete = complete`, i.e. the ALREADY-ANDED
      // value, and the migration says in as many words that the cause cannot be
      // recovered. Under the old machine such a deck read "Incomplete deck"
      // whatever stopped it; under the new one it reads "Both incomplete", which
      // is no more wrong and is a sharper way to notice the same missing data.
      // The remedy is unchanged: one `POST /api/decks/:id/rescore`.
      const preMigration = { statusId: "ai_evaluated", aiScore: 6.1, aiComplete: false, missingFields: ["founderPhone"] as const };
      expect(v3StatusKey(preMigration)).toBe("incompleteDeck");
      expect(at(preMigration)).toBe("bothIncomplete");
      // A real re-evaluation writes a real verdict, and the word sharpens.
      expect(at({ ...preMigration, aiComplete: true })).toBe("incompleteContact");
    });
  });

  it("matchesV3Stat is the table filter: an archived deck stays in Uploaded", () => {
    const archived: StatDeck = { statusId: "archived", aiScore: 5.2 };
    expect(matchesV3Stat(archived, "archived")).toBe(true);
    // The whole point of "a state, not a move": the row is still in the list.
    expect(matchesV3Stat(archived, "all")).toBe(true);
    for (const key of ["aieval", "noteval", "incomplete", "shortlisted"] as const) {
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
    expect(V3.filter((d) => matchesV3Stat(d, "all")).length).toBe(V3.length);
  });

  it("Q7 — the Assigned tile is CONFIRMED by his own final-status map", () => {
    // Was "retained pending Q7": v3 deleted the tile, reversing Aug-2026 issue
    // 4, and the instruction was to leave it until the client said. His 24-Sep
    // FINAL STATUSES map says — "AI Evaluated, Assigned -> Assigned" names the
    // stat box a sink is counted in, so the box is required by his document. It
    // keeps its issue-4 position, immediately before Shortlisted.
    expect(ASSIGNED_TILE_CONFIRMED_BY_FINAL_STATUS_MAP).toBe(true);
    expect(SCREENING_SINK_TILE.assigned).toBe("assigned");
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
