import { describe, it, expect } from "vitest";
import {
  buildTool,
  buildSystemPrompt,
  buildUserPrompt,
  parseEvaluation,
  computeResult,
  type ParameterRow,
  type AnchorRow,
  type RawEvaluation,
} from "../../src/server/ai/evaluate";

const PARAMS: ParameterRow[] = [
  { id: "inc_a", key: "problem", name: "Problem", weight: 8 },
  { id: "inc_b", key: "traction", name: "Traction", weight: 10 },
  { id: "inc_c", key: "team", name: "Team", weight: 2 },
];

const ANCHORS: AnchorRow[] = [
  { band: "strong", min_score: 8, max_score: 10, label: "Strong" },
  { band: "moderate", min_score: 5, max_score: 7, label: "Moderate" },
  { band: "weak", min_score: 2, max_score: 4, label: "Weak" },
  { band: "absent", min_score: 0, max_score: 1, label: "Absent" },
];

describe("buildTool", () => {
  it("constrains score keys to the known parameter keys", () => {
    const tool = buildTool(PARAMS);
    const schema = tool.input_schema as {
      properties: { scores: { items: { properties: { key: { enum: string[] } } } } };
    };
    expect(schema.properties.scores.items.properties.key.enum).toEqual([
      "problem",
      "traction",
      "team",
    ]);
    expect(tool.name).toBe("submit_evaluation");
  });
});

describe("prompt building", () => {
  it("appends the org system-prompt override", () => {
    expect(buildSystemPrompt("Weight climate heavily.")).toContain("Weight climate heavily.");
    expect(buildSystemPrompt(null)).not.toContain("Organisation guidance");
  });

  it("lists every parameter key and the anchor bands, high band first", () => {
    const prompt = buildUserPrompt(PARAMS, ANCHORS);
    expect(prompt).toContain("problem — Problem (weight 8)");
    expect(prompt).toContain("traction — Traction (weight 10)");
    expect(prompt.indexOf("8–10: Strong")).toBeLessThan(prompt.indexOf("0–1: Absent"));
  });
});

describe("parseEvaluation", () => {
  it("maps known keys to parameter ids, clamps values, drops unknowns/dupes", () => {
    const raw: RawEvaluation = {
      complete: true,
      founder: "  Ada Lovelace ",
      extractions: [
        { label: "Cover", heading: "Acme", text: "one-liner" },
        { label: "", text: "dropped — no label" },
        { label: "Team", missing: true },
      ],
      scores: [
        { key: "problem", value: 12, comment: "great" }, // clamps to 10
        { key: "traction", value: -3 }, // clamps to 0
        { key: "problem", value: 5 }, // duplicate ignored
        { key: "unknown", value: 9 }, // unknown key dropped
        { key: "team", value: 6 },
      ],
    };
    const parsed = parseEvaluation(raw, PARAMS);
    expect(parsed.founder).toBe("Ada Lovelace");
    expect(parsed.extractions.map((e) => e.label)).toEqual(["Cover", "Team"]);
    expect(parsed.extractions[1].missing).toBe(true);
    expect(parsed.scores).toEqual([
      { parameterId: "inc_a", key: "problem", value: 10, comment: "great" },
      { parameterId: "inc_b", key: "traction", value: 0, comment: null },
      { parameterId: "inc_c", key: "team", value: 6, comment: null },
    ]);
  });

  it("defaults complete to true and founder to null when absent", () => {
    const parsed = parseEvaluation({ scores: [] }, PARAMS);
    expect(parsed.complete).toBe(true);
    expect(parsed.founder).toBeNull();
  });
});

describe("computeResult — the score > 5 gate", () => {
  function parsedWith(values: Record<string, number>): ReturnType<typeof parseEvaluation> {
    return parseEvaluation(
      { complete: true, scores: Object.entries(values).map(([key, value]) => ({ key, value })) },
      PARAMS,
    );
  }

  it("advances an incubator deck above the gate to ai_evaluated", () => {
    // weighted: (8*8 + 10*8 + 2*8)/20 = 8.0 → passes
    const r = computeResult(parsedWith({ problem: 8, traction: 8, team: 8 }), PARAMS, "incubator");
    expect(r.weightedTotal).toBe(8);
    expect(r.gatePassed).toBe(true);
    expect(r.status).toBe("ai_evaluated");
    expect(r.signal).toBe("strong");
  });

  it("rejects an incubator deck at or below the gate", () => {
    // weighted: (8*4 + 10*5 + 2*4)/20 = 4.5 → fails
    const r = computeResult(parsedWith({ problem: 4, traction: 5, team: 4 }), PARAMS, "incubator");
    expect(r.gatePassed).toBe(false);
    expect(r.status).toBe("rejected");
  });

  it("treats exactly 5 as failing (strictly greater than gate)", () => {
    const r = computeResult(parsedWith({ problem: 5, traction: 5, team: 5 }), PARAMS, "incubator");
    expect(r.weightedTotal).toBe(5);
    expect(r.gatePassed).toBe(false);
  });

  it("routes a VC pass to analyst_scoring and a fail to archived", () => {
    expect(computeResult(parsedWith({ problem: 9, traction: 9, team: 9 }), PARAMS, "vc").status).toBe(
      "analyst_scoring",
    );
    expect(computeResult(parsedWith({ problem: 2, traction: 2, team: 2 }), PARAMS, "vc").status).toBe(
      "archived",
    );
  });

  it("uses the full rubric weight — an unscored parameter counts as 0, not dropped", () => {
    // Only 2 of 3 params scored strongly; team (weight 2) is missing → 0.
    // Full denominator: (8*9 + 10*9 + 2*0)/20 = 8.1, not (8*9+10*9)/18 = 9.0.
    const r = computeResult(parsedWith({ problem: 9, traction: 9 }), PARAMS, "incubator");
    expect(r.weightedTotal).toBe(8.1);
  });

  it("treats a zero-score response as Incomplete, never a silent rejection", () => {
    const r = computeResult(parseEvaluation({ complete: true, scores: [] }, PARAMS), PARAMS, "incubator");
    expect(r.status).toBe("incomplete");
    expect(r.signal).toBe("flagged");
    expect(r.gatePassed).toBe(false);
  });

  it("marks an incomplete deck flagged and Incomplete regardless of score", () => {
    const parsed = parseEvaluation(
      { complete: false, scores: [{ key: "problem", value: 9 }, { key: "traction", value: 9 }] },
      PARAMS,
    );
    const r = computeResult(parsed, PARAMS, "incubator");
    expect(r.status).toBe("incomplete");
    expect(r.signal).toBe("flagged");
  });
});
