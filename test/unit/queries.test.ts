import { describe, it, expect } from "vitest";
import {
  addWorkingDays,
  areasNeedingResponse,
  buildQueryMessage,
  clarificationFlow,
  composeFounderLetters,
  isQueryListed,
  latestQuery,
  parseQueryTimestamp,
  queryDueAt,
  queryListCsvRow,
  queryStatusOf,
  withResponseLink,
  AREA_KIND_LABELS,
  QUERY_LIST_HEADERS,
  QUERY_STATUS_LABELS,
  RESPONSE_LINK_PLACEHOLDER,
  selectClarificationQuestions,
  shouldAutoClarify,
  type BankArea,
} from "../../src/shared/queries";

// Aug-2026 issues 16 & 17 — "Parameters needing response" on the Query list, and
// the "Areas requiring response" drill-down a startup name opens.

describe("areas requiring a founder response", () => {
  it("orders missing details, then missing slides, then weak parameters", () => {
    const areas = areasNeedingResponse({
      missingFields: ["founderPhone"],
      missingSections: ["Traction"],
      weakAreas: ["Business Model & Unit Economics"],
    });
    expect(areas).toEqual([
      { kind: "detail", label: "Phone" },
      { kind: "section", label: "Traction" },
      { kind: "parameter", label: "Business Model & Unit Economics" },
    ]);
  });

  it("de-duplicates within a kind and tolerates absent fields", () => {
    expect(areasNeedingResponse({})).toEqual([]);
    const areas = areasNeedingResponse({
      weakAreas: ["Traction", "Traction", "Team"],
    });
    expect(areas.map((a) => a.label)).toEqual(["Traction", "Team"]);
  });

  it("keeps the same label under two different kinds", () => {
    const areas = areasNeedingResponse({
      missingSections: ["Traction"],
      weakAreas: ["Traction"],
    });
    expect(areas).toHaveLength(2);
  });

  it("builds a message naming the deck and every flagged area", () => {
    const body = buildQueryMessage("GreenGrid", [
      { kind: "detail", label: "Phone" },
      { kind: "parameter", label: "Traction & Validation" },
    ]);
    expect(body).toContain("GreenGrid");
    expect(body).toContain(`Phone (${AREA_KIND_LABELS.detail.toLowerCase()})`);
    expect(body).toContain("Traction & Validation");
  });

  it("still produces a usable message when nothing is flagged", () => {
    const body = buildQueryMessage("GreenGrid", []);
    expect(body).toContain("no specific areas flagged");
  });
});

// ── W2-C · the clarification question bank ─────────────────────────────────
// The bank (`migrations/0028_question_bank.sql`, admin console `s-qb`) holds
// 68 curated questions keyed to `parameters.id` — five per area, eight for
// Climate Impact & Integrity. These cover the selection: which areas draw
// from it, in what order, and what the letter looks like once they do.

/** A slice of the real bank, in `seq` order, as the server hands it over. */
const BANK: BankArea[] = [
  {
    parameterId: "inc_traction_validation",
    name: "Traction & Validation",
    questions: [
      "What is your strongest proof of customer demand?",
      "How many paying customers do you have today?",
      "What has grown fastest in the last 6 months?",
      "What feedback caused you to change your product?",
      "Why did your earliest customers say yes?",
    ],
  },
  {
    parameterId: "inc_climate_impact",
    name: "Climate Impact & Integrity",
    questions: [
      "What environmental problem does this solve?",
      "How is impact measured?",
      "What is the baseline you compare against?",
      "How do you avoid greenwashing?",
      "What third-party validation exists?",
      "What is the impact per unit sold?",
      "How does impact scale with revenue?",
      "What unintended consequences could arise?",
    ],
  },
  {
    parameterId: "inc_business_risks",
    name: "Business Risks",
    questions: ["What could kill this business?"],
  },
];

describe("clarification questions drawn from the bank", () => {
  it("selects a weak-signal area's own questions, in bank order", () => {
    const picked = selectClarificationQuestions(
      areasNeedingResponse({ weakAreas: ["Traction & Validation"] }),
      BANK,
    );
    expect(picked).toHaveLength(1);
    expect(picked[0].area).toBe("Traction & Validation");
    expect(picked[0].questions).toEqual(BANK[0].questions);
  });

  it("returns eight questions for Climate Impact & Integrity, five for the rest", () => {
    const climate = selectClarificationQuestions(
      areasNeedingResponse({ weakAreas: ["Climate Impact & Integrity"] }),
      BANK,
    );
    expect(climate[0].questions).toHaveLength(8);
    const traction = selectClarificationQuestions(
      areasNeedingResponse({ weakAreas: ["Traction & Validation"] }),
      BANK,
    );
    expect(traction[0].questions).toHaveLength(5);
  });

  it("skips inactive questions — they never reach the bank the caller passes", () => {
    // A soft delete (`active = 0`) drops the row from the loaded bank, so the
    // remaining questions renumber without it.
    const withoutSecond: BankArea[] = [
      { ...BANK[0], questions: BANK[0].questions.filter((_, i) => i !== 1) },
    ];
    const picked = selectClarificationQuestions(
      areasNeedingResponse({ weakAreas: ["Traction & Validation"] }),
      withoutSecond,
    );
    expect(picked[0].questions).toHaveLength(4);
    expect(picked[0].questions).not.toContain("How many paying customers do you have today?");
    expect(picked[0].questions[1]).toBe("What has grown fastest in the last 6 months?");
  });

  it("keeps the weak areas in the order the deck flagged them", () => {
    const picked = selectClarificationQuestions(
      areasNeedingResponse({
        weakAreas: ["Business Risks", "Traction & Validation", "Climate Impact & Integrity"],
      }),
      BANK,
    );
    expect(picked.map((p) => p.area)).toEqual([
      "Business Risks",
      "Traction & Validation",
      "Climate Impact & Integrity",
    ]);
  });

  it("asks nothing for a missing detail or an absent slide — the bank has no question for either", () => {
    const picked = selectClarificationQuestions(
      areasNeedingResponse({
        missingFields: ["founderPhone"],
        missingSections: ["Traction"],
      }),
      BANK,
    );
    expect(picked).toEqual([]);
  });

  it("drops an area the bank cannot answer for rather than emitting it empty", () => {
    const picked = selectClarificationQuestions(
      areasNeedingResponse({ weakAreas: ["Go-To-Market Strategy"] }),
      [
        ...BANK,
        {
          parameterId: "inc_gtm_strategy",
          name: "Go-To-Market Strategy",
          questions: [],
        },
      ],
    );
    expect(picked).toEqual([]);
  });
});

describe("the clarification letter", () => {
  const areas = areasNeedingResponse({
    missingFields: ["founderPhone"],
    weakAreas: ["Traction & Validation"],
  });

  it("asks the bank's real questions instead of naming the area (F0030, F0096)", () => {
    const body = buildQueryMessage("GreenGrid", areas, { bank: BANK });
    expect(body).toContain("Traction & Validation (weak signal)");
    expect(body).toContain("  1. What is your strongest proof of customer demand?");
    expect(body).toContain("  5. Why did your earliest customers say yes?");
    // The area is asked about, not listed twice.
    expect(body).not.toContain("• Traction & Validation (weak signal)");
    // A missing intake column stays a bullet — there is nothing to ask.
    expect(body).toContain("• Phone (missing detail)");
  });

  it("is the pre-bank letter when no bank is supplied", () => {
    expect(buildQueryMessage("GreenGrid", areas)).toContain(
      "• Traction & Validation (weak signal)",
    );
  });

  it("falls back to naming an area whose questions were all deleted", () => {
    const emptied: BankArea[] = [{ ...BANK[0], questions: [] }];
    const body = buildQueryMessage("GreenGrid", areas, { bank: emptied });
    expect(body).toContain("• Traction & Validation (weak signal)");
  });
});

describe("the auto-trigger", () => {
  const areas = areasNeedingResponse({ weakAreas: ["Traction & Validation"] });

  it("fires when the toggle is on and an area is flagged", () => {
    expect(shouldAutoClarify({ autoClarification: true, areas })).toBe(true);
  });

  it("does not fire with auto-clarification off", () => {
    expect(shouldAutoClarify({ autoClarification: false, areas })).toBe(false);
  });

  it("does not fire with nothing flagged", () => {
    expect(shouldAutoClarify({ autoClarification: true, areas: [] })).toBe(false);
  });
});

// ── W7-C · the Query screen ─────────────────────────────────────────────────
// `panel-query.html`: the founder queries list (#qview-list), one letter per
// founder on the Email query tab (#qview-email), and the clarification flow
// staff preview (#qview-founder).

describe("one letter per founder (F0215)", () => {
  const decks = [
    { id: "d_green", name: "GreenGrid", missingFields: ["founderPhone" as const], weakAreas: ["Traction & Validation"] },
    { id: "d_pay", name: "PayRoute", missingSections: ["Team"], weakAreas: ["Business Risks"] },
    { id: "d_ledger", name: "LedgerLite", missingFields: ["city" as const] },
  ];

  it("gives every selected founder a letter built from their own deck alone", () => {
    const letters = composeFounderLetters(decks);
    expect(letters.map((l) => l.deckId)).toEqual(["d_green", "d_pay", "d_ledger"]);

    const [green, pay, ledger] = letters;
    expect(green.body).toContain("GreenGrid");
    expect(green.body).toContain("• Phone (missing detail)");
    expect(green.body).toContain("• Traction & Validation (weak signal)");
    expect(pay.body).toContain("• Team (missing slide)");
    expect(pay.body).toContain("• Business Risks (weak signal)");
    expect(ledger.body).toContain("• City (missing detail)");
  });

  it("never unions areas or names across founders — the multi-founder send's confidentiality", () => {
    const letters = composeFounderLetters(decks);
    for (const letter of letters) {
      const others = decks.filter((d) => d.id !== letter.deckId);
      for (const other of others) {
        expect(letter.body, `${letter.deckName} letter names ${other.name}`).not.toContain(other.name);
        // Compared as the bullet the letter would carry — a bare "Team" also
        // matches the sign-off, "The Evaluation Team".
        for (const area of areasNeedingResponse(other)) {
          if (letter.areas.some((a) => a.label === area.label && a.kind === area.kind)) continue;
          const bullet = `• ${area.label} (${AREA_KIND_LABELS[area.kind].toLowerCase()})`;
          expect(letter.body, `${letter.deckName} letter carries ${other.name}'s ${area.label}`).not.toContain(bullet);
        }
      }
      expect(letter.areas).toEqual(areasNeedingResponse(decks.find((d) => d.id === letter.deckId)!));
    }
  });

  it("draws each founder's questions from the bank for their own weak areas only", () => {
    const [green, pay] = composeFounderLetters(decks, { bank: BANK });
    expect(green.body).toContain("What is your strongest proof of customer demand?");
    expect(green.body).not.toContain("What could kill this business?");
    expect(pay.body).toContain("What could kill this business?");
    expect(pay.body).not.toContain("What is your strongest proof of customer demand?");
  });
});

describe("the letter's link and deadline (F0217, F0278, F0341)", () => {
  it("carries the link placeholder and the five-working-day deadline", () => {
    const body = buildQueryMessage("GreenGrid", [{ kind: "detail", label: "Phone" }]);
    expect(body).toContain(`→ ${RESPONSE_LINK_PLACEHOLDER}`);
    expect(body).toContain("Responses are due within 5 working days.");
    expect(body.startsWith("Dear Founder,")).toBe(true);
    expect(body.endsWith("Warm regards,\nThe Evaluation Team")).toBe(true);
  });

  it("swaps the placeholder for the real link, and appends one when it was deleted", () => {
    const link = "https://example.test/resubmit/tok";
    const body = buildQueryMessage("GreenGrid", []);
    expect(withResponseLink(body, link)).toContain(`→ ${link}`);
    expect(withResponseLink(body, link)).not.toContain(RESPONSE_LINK_PLACEHOLDER);
    expect(withResponseLink("Please send your MRR.", link)).toBe(`Please send your MRR.\n\nRespond online: ${link}`);
  });
});

describe("the list's status vocabulary", () => {
  const q = (created_at: string, founder_response: string | null = null) => ({
    deck_id: "d1",
    founder_response,
    created_at,
  });

  it("has exactly the prototype's three labels", () => {
    expect(Object.values(QUERY_STATUS_LABELS)).toEqual(["Pending", "Overdue", "Responded"]);
  });

  it("counts five WORKING days, skipping the weekend", () => {
    // Friday 11 Sep 2026 → due Friday 18 Sep, not Wednesday 16 Sep.
    expect(queryDueAt("2026-09-11T10:00:00.000Z").toISOString()).toBe("2026-09-18T10:00:00.000Z");
    expect(addWorkingDays(new Date("2026-09-14T09:00:00Z"), 5).toISOString()).toBe("2026-09-21T09:00:00.000Z");
    const created = "2026-09-11T10:00:00.000Z";
    expect(queryStatusOf([q(created)], Date.parse("2026-09-17T10:00:00Z"))).toBe("pending");
    expect(queryStatusOf([q(created)], Date.parse("2026-09-18T10:00:01Z"))).toBe("overdue");
  });

  it("reads D1's zone-less datetime('now') as UTC", () => {
    expect(parseQueryTimestamp("2026-09-13 01:19:39").toISOString()).toBe("2026-09-13T01:19:39.000Z");
    expect(queryDueAt("2026-09-11 10:00:00").toISOString()).toBe("2026-09-18T10:00:00.000Z");
  });

  it("is Responded when the NEWEST query is answered, whatever order the rows arrive in", () => {
    const older = q("2026-09-01T10:00:00Z", "MRR is ₹4L.");
    const newer = q("2026-09-10T10:00:00Z");
    expect(queryStatusOf([older, newer], Date.parse("2026-09-11T10:00:00Z"))).toBe("pending");
    expect(queryStatusOf([q("2026-09-01T10:00:00Z"), q("2026-09-10T10:00:00Z", "Done.")])).toBe("responded");
    expect(latestQuery([older, newer])).toBe(newer);
  });
});

describe("which decks the list shows", () => {
  const answered = [{ deck_id: "d1", founder_response: "Here you go.", created_at: "2026-09-01T10:00:00Z" }];
  const open = [{ deck_id: "d1", founder_response: null, created_at: "2026-09-01T10:00:00Z" }];

  it("keeps an incubator deck listed after its founder answers — founder_response moves it to uploaded (F0214)", () => {
    expect(isQueryListed({ statusId: "uploaded" }, answered, "incubator")).toBe(true);
    expect(isQueryListed({ statusId: "pending_ai" }, answered, "incubator")).toBe(true);
    // …until review picks it back up.
    expect(isQueryListed({ statusId: "ai_evaluated" }, answered, "incubator")).toBe(false);
    expect(isQueryListed({ statusId: "shortlisted" }, open, "incubator")).toBe(false);
  });

  it("lists the incubator's own flag stages even with no areas computed yet", () => {
    expect(isQueryListed({ statusId: "incomplete" }, [], "incubator")).toBe(true);
    expect(isQueryListed({ statusId: "manual_review" }, [], "incubator")).toBe(true);
    expect(isQueryListed({ statusId: "uploaded" }, [], "incubator")).toBe(false);
    expect(isQueryListed({ statusId: "ai_evaluated", weakAreas: ["Team"] }, [], "incubator")).toBe(false);
  });

  it("does not list an unflagged VC deal just because it is being scored (F0274)", () => {
    expect(isQueryListed({ statusId: "analyst_scoring" }, [], "vc")).toBe(false);
    expect(isQueryListed({ statusId: "associate_review", weakAreas: [] }, [], "vc")).toBe(false);
    expect(isQueryListed({ statusId: "analyst_scoring", weakAreas: ["Team"] }, [], "vc")).toBe(true);
    expect(isQueryListed({ statusId: "associate_review", missingSections: ["Traction"] }, [], "vc")).toBe(true);
    expect(isQueryListed({ statusId: "associate_review" }, open, "vc")).toBe(true);
    expect(isQueryListed({ statusId: "incomplete" }, [], "vc")).toBe(true);
    expect(isQueryListed({ statusId: "partner_review", weakAreas: ["Team"] }, [], "vc")).toBe(false);
  });

  it("exports a row in the list's own column order", () => {
    expect([...QUERY_LIST_HEADERS]).toEqual([
      "Startup",
      "Founder",
      "Phone",
      "Email",
      "Status",
      "Parameters needing response",
    ]);
    expect(
      queryListCsvRow(
        {
          name: "PayRoute",
          founder: "Vikram Singh",
          founderEmail: "vikram@payroute.in",
          missingFields: ["founderPhone"],
          weakAreas: ["Team & Execution Capability"],
        },
        "overdue",
      ),
    ).toEqual(["PayRoute", "Vikram Singh", "", "vikram@payroute.in", "Overdue", "Phone; Team & Execution Capability"]);
  });
});

describe("the founder clarification flow (#qview-founder, F0275)", () => {
  const scores = [
    { label: "Traction & Validation", weight: 10, value: 2, comment: "No revenue or pilots were found." },
    { label: "Business Risks", weight: 8, value: 4, comment: "  " },
    { label: "Team & Execution Capability", weight: 10, value: 9, comment: "Strong team." },
    { label: "Market Size & Opportunity", weight: 7, value: 6, comment: null },
  ];
  const deck = {
    missingSections: ["The ask"],
    weakAreas: ["Traction & Validation", "Business Risks"],
  };

  it("splits flagged areas from the ones with sufficient signal, and computes completion", () => {
    const flow = clarificationFlow({
      deck,
      scores,
      questions: [{ area: "Traction & Validation", questions: ["How many paying customers do you have today?"] }],
    });

    expect(flow.flagged.map((a) => [a.label, a.signal])).toEqual([
      ["The ask", "absent"],
      ["Traction & Validation", "absent"], // 2 sits in the rubric's Insufficient band
      ["Business Risks", "weak"],
    ]);
    const traction = flow.flagged[1];
    expect(traction.weight).toBe(10);
    expect(traction.found).toBe("No revenue or pilots were found.");
    expect(traction.questions).toEqual(["How many paying customers do you have today?"]);
    // A blank AI comment still says something.
    expect(flow.flagged[2].found.length).toBeGreaterThan(10);
    expect(flow.flagged[0].found).toBe("No The ask section was found in the deck.");

    expect(flow.sufficient).toEqual([
      { label: "Team & Execution Capability", signal: "strong", weight: 10 },
      { label: "Market Size & Opportunity", signal: "moderate", weight: 7 },
    ]);
    expect(flow.total).toBe(4);
    expect(flow.strongCount).toBe(1);
    expect(flow.percent).toBe(50);
  });

  it("is 0% with flags and no scores, and 100% with neither", () => {
    expect(clarificationFlow({ deck: { missingFields: ["city"] }, scores: [], questions: [] }).percent).toBe(0);
    expect(clarificationFlow({ deck: {}, scores: [], questions: [] }).percent).toBe(100);
  });
});
