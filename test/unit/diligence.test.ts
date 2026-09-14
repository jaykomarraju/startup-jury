import { describe, it, expect } from "vitest";
import {
  INVESTMENT_DD_ITEMS,
  LEGAL_DD_ITEMS,
  deriveMpApproval,
  deriveRowStatus,
  investReadyStage,
  investReadyStatus,
  isComplete,
  legendKeyOf,
  summarise,
  termSheetVersion,
  trackOpenAt,
  type DdItemStatus,
} from "../../src/shared/diligence";

/** W9-C — the pure rules behind the VC diligence screens (`src/shared/diligence.ts`). */

const items = (...s: DdItemStatus[]) => s.map((status) => ({ status }));

describe("the prototype's checklists", () => {
  it("are DD_ITEMS and LD_ITEMS verbatim, in order", () => {
    expect(INVESTMENT_DD_ITEMS).toEqual([
      "Market",
      "Team references",
      "Customer calls",
      "Product / Tech review",
      "Financials & metrics",
      "Competitive positioning",
    ]);
    expect(LEGAL_DD_ITEMS).toHaveLength(7);
    expect(LEGAL_DD_ITEMS.at(-1)).toBe("Legal documentation (SHA / SSA)");
  });
});

describe("summarise — ddSummary / ldSummary", () => {
  it("counts done and flagged, and calls anything off not_started started", () => {
    expect(summarise(items("done", "flagged", "in_progress", "not_started"))).toEqual({
      done: 1,
      total: 4,
      flagged: 1,
      started: true,
    });
    expect(summarise(items("not_started", "not_started")).started).toBe(false);
    expect(summarise([])).toEqual({ done: 0, total: 0, flagged: 0, started: false });
  });

  it("decodes to the legend: a flag outranks completeness; untouched and empty decode to nothing", () => {
    expect(legendKeyOf(summarise(items("done", "flagged")))).toBe("flagged");
    expect(legendKeyOf(summarise(items("done", "done")))).toBe("done");
    expect(legendKeyOf(summarise(items("done", "not_started")))).toBe("in_progress");
    expect(legendKeyOf(summarise(items("not_started")))).toBeUndefined();
    expect(legendKeyOf(summarise([]))).toBeUndefined();
    expect(isComplete(summarise([]))).toBe(false);
  });
});

describe("ddInitRow — derived until chosen", () => {
  it("row status follows the checklist, and a chosen value always wins", () => {
    expect(deriveRowStatus(null, summarise(items("done", "done")))).toBe("completed");
    expect(deriveRowStatus(null, summarise(items("in_progress", "not_started")))).toBe("in_progress");
    expect(deriveRowStatus(null, summarise(items("not_started")))).toBe("yet_to_start");
    expect(deriveRowStatus("yet_to_start", summarise(items("done")))).toBe("yet_to_start");
    expect(deriveRowStatus(null, null)).toBe("yet_to_start");
  });

  it("MP approval reads Approved once diligence starts, unless someone chose otherwise", () => {
    expect(deriveMpApproval(null, summarise(items("in_progress")))).toBe("approved");
    expect(deriveMpApproval(null, summarise(items("not_started")))).toBe("not_approved");
    expect(deriveMpApproval("not_approved", summarise(items("done")))).toBe("not_approved");
  });
});

describe("stages and the term sheet", () => {
  it("opens investment diligence at investment_dd and legal at legal_dd, through close", () => {
    expect(trackOpenAt("investment", "investment_dd")).toBe(true);
    expect(trackOpenAt("investment", "onboard_ready")).toBe(true);
    expect(trackOpenAt("investment", "partner_call")).toBe(false);
    expect(trackOpenAt("legal", "term_sheet")).toBe(false);
    expect(trackOpenAt("legal", "legal_dd")).toBe(true);
    expect(trackOpenAt("legal", "archived")).toBe(false);
  });

  it("tsDoc's badge follows the status: Signed → Executed, Issued → Issued, else Draft", () => {
    expect(termSheetVersion("signed")).toBe("executed");
    expect(termSheetVersion("issued")).toBe("issued");
    expect(termSheetVersion("drafted")).toBe("draft");
    expect(termSheetVersion("declined")).toBe("draft");
    expect(termSheetVersion(null)).toBe("draft");
  });

  it("Invest ready's stage and status chips", () => {
    expect(investReadyStage("alignment_call")).toBe("Term sheet");
    expect(investReadyStage("legal_dd")).toBe("Legal DD");
    expect(investReadyStage("onboard_ready")).toBe("Closed");
    expect(investReadyStage("ic_review")).toBeUndefined();

    const now = Date.parse("2026-09-13T00:00:00Z");
    expect(investReadyStatus("onboard_ready", "2020-01-01T00:00:00Z", now)).toBe("Funded");
    expect(investReadyStatus("term_sheet", "2026-09-01T00:00:00Z", now)).toBe("On track");
    expect(investReadyStatus("term_sheet", "2026-08-01T00:00:00Z", now)).toBe("Stalled");
    // SQLite's `datetime('now')` shape parses as UTC.
    expect(investReadyStatus("legal_dd", "2026-08-01 10:00:00", now)).toBe("Stalled");
    expect(investReadyStatus("legal_dd", null, now)).toBe("On track");
  });
});
