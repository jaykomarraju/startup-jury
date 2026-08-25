import { describe, it, expect } from "vitest";
import {
  areasNeedingResponse,
  buildQueryMessage,
  AREA_KIND_LABELS,
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
    const areas = areasNeedingResponse({ weakAreas: ["Traction", "Traction", "Team"] });
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
