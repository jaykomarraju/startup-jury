import { describe, it, expect } from "vitest";
import {
  ASSIGNMENT_DEADLINE_DAYS,
  assignBottomSummary,
  assignResultsSubtitle,
  assignRoleHeading,
  assignRoleName,
  assignRoleSubline,
  assignScope,
  capacityFor,
  crossProduct,
  dueAtFrom,
  loadBand,
  loadPercent,
  missingInfoText,
  paramScoreColour,
  sortAssignableRoles,
  weightedParamTotal,
} from "../../src/shared/assignment";

// W7-E — the Assign screen's arithmetic and copy, against
// `AISJ_IC_SuserV15/_scripts.js` renderAsUsers / renderAs4 / updateAsState.

describe("the cross product (asConfirm)", () => {
  it("pairs every deck with every member, decks outer", () => {
    expect(crossProduct(["A", "B"], [1, 2, 3]).map(({ deck, member }) => `${deck}${member}`)).toEqual([
      "A1", "A2", "A3", "B1", "B2", "B3",
    ]);
    expect(crossProduct([], [1])).toEqual([]);
  });

  it("states the scope in the summary card's words", () => {
    expect(assignScope(2, 3)).toBe("2 decks × 3 jury members = 6 evaluations");
    expect(assignScope(1, 1)).toBe("1 deck × 1 jury member = 1 evaluation");
  });
});

describe("updateAsState's four sentences", () => {
  it("covers every state verbatim", () => {
    expect(assignBottomSummary(0, 0)).toBe("Select decks and jury members to enable assignment.");
    expect(assignBottomSummary(2, 0)).toBe("2 decks selected — now pick one or more jury members.");
    expect(assignBottomSummary(0, 1)).toBe("1 jury member selected — now select decks.");
    expect(assignBottomSummary(1, 2)).toBe("1 deck → 2 jury members · click Confirm to assign.");
  });

  it("and asShowResults' subtitle", () => {
    expect(assignResultsSubtitle(3, 1)).toBe(
      "3 decks assigned to 1 evaluator · evaluation report sent along · deadline 7 days",
    );
  });
});

describe("the deadline", () => {
  it("is 7 days from the assignment", () => {
    expect(ASSIGNMENT_DEADLINE_DAYS).toBe(7);
    expect(dueAtFrom("2026-09-12T10:00:00.000Z")).toBe("2026-09-19T10:00:00.000Z");
  });
});

describe("load and capacity (renderAsUsers)", () => {
  it("bands at 80 % and 50 %", () => {
    expect(loadBand(5, 6)).toBe("high"); // 83 %
    expect(loadBand(8, 10)).toBe("high"); // exactly 80
    expect(loadBand(5, 10)).toBe("mid"); // exactly 50
    expect(loadBand(4, 10)).toBe("low");
    expect(loadBand(1, 0)).toBe("high");
  });

  it("clamps the fill to the track", () => {
    expect(loadPercent(9, 12)).toBe(75);
    expect(loadPercent(20, 10)).toBe(100);
  });

  it("uses a user's own capacity, else the role default", () => {
    expect(capacityFor("jury")).toBe(6);
    expect(capacityFor("program_manager")).toBe(10);
    expect(capacityFor("program_associate", null)).toBe(12);
    expect(capacityFor("jury", 9)).toBe(9);
    expect(capacityFor("jury", 0)).toBe(6);
  });
});

describe("column 2 and 3 copy", () => {
  it("orders Program manager → Program associate → Jury member whatever the server sent", () => {
    const sorted = sortAssignableRoles("incubator", [{ role: "jury" }, { role: "program_associate" }, { role: "program_manager" }]);
    expect(sorted.map((g) => g.role)).toEqual(["program_manager", "program_associate", "jury"]);
  });

  it("writes names in sentence case, headings plural, and the description sub-line", () => {
    expect(assignRoleName("incubator", "program_manager")).toBe("Program manager");
    expect(assignRoleName("incubator", "jury")).toBe("Jury member");
    expect(assignRoleHeading("incubator", "jury")).toBe("Jury members");
    expect(assignRoleSubline("jury", 4)).toBe("Domain expert evaluators · 4 available");
    expect(assignRoleSubline("program_manager", 2)).toBe("Programme oversight & decision · 2 available");
  });
});

describe("the incomplete deck's missing-information line", () => {
  it("names what was not captured and what the deck lacks", () => {
    expect(missingInfoText({ missingFields: ["founderEmail", "founderPhone"] })).toBe("Founder email & Phone not captured");
    expect(missingInfoText({ missingSections: ["Traction", "Team"] })).toBe("No traction, team data");
    expect(missingInfoText({ missingFields: ["city"], missingSections: ["Traction"] })).toBe("City not captured · no traction data");
    expect(missingInfoText({})).toBe("Insufficient information for AI evaluation");
  });
});

describe("the per-parameter breakdown", () => {
  it("colours green ≥ 7, amber ≥ 5, red below", () => {
    expect(paramScoreColour(7)).toBe("#3A7D44");
    expect(paramScoreColour(5)).toBe("#BA7517");
    expect(paramScoreColour(4.9)).toBe("#B42318");
  });

  it("weights the total by each parameter's weight", () => {
    expect(weightedParamTotal([{ weight: 8, value: 8 }, { weight: 10, value: 4 }])).toBe(5.8);
    expect(weightedParamTotal([])).toBe(0);
  });
});
