import { describe, it, expect } from "vitest";
import {
  areasNeedingResponse,
  buildQueryMessage,
  AREA_KIND_LABELS,
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
