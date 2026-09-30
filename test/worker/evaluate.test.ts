import { describe, it, expect } from "vitest";
import {
  buildTool,
  buildSystemPrompt,
  buildUserPrompt,
  substituteVars,
  parseEvaluation,
  computeResult,
  type ParameterRow,
  type ParameterBandRow,
  type RawEvaluation,
} from "../../src/server/ai/evaluate";

const PARAMS: ParameterRow[] = [
  { id: "inc_a", key: "problem", name: "Problem", weight: 8 },
  { id: "inc_b", key: "traction", name: "Traction", weight: 10 },
  { id: "inc_c", key: "team", name: "Team", weight: 2 },
];

// 13-core analogue plus one role-scoped additional param (weight 0, assistive).
const WITH_ADDITIONAL: ParameterRow[] = [
  ...PARAMS,
  {
    id: "inc_add",
    key: "add_lens",
    name: "Custom Lens",
    weight: 0,
    informational: true,
    prompt: "Assess {{startup_name}} in {{sector}}. Score 0-10.",
  },
];

// W2-B — anchors are now PER PARAMETER on the specs' five-band scale
// (`parameter_rubric_bands`, 0027), not four global rows. The old fixture and
// the assertion that read "8–10: Strong" before "0–1: Absent" both encoded the
// four-band `rubric_anchors` table that `0039` drops; per plan §4 they are
// replaced rather than weakened — the assertion below is strictly stronger,
// checking the shared five-band scale AND that a parameter's own anchor text
// reaches the prompt.
const BANDS: ParameterBandRow[] = [
  {
    parameter_id: "inc_a",
    band_index: 0,
    band_label: "9–10",
    band_name: "Exceptional",
    description: "Mission-critical problem with regulatory pressure.",
  },
  {
    parameter_id: "inc_a",
    band_index: 4,
    band_label: "0–2",
    band_name: "Insufficient",
    description: "Vague problem, generic framing.",
  },
  // A scaffolded role parameter: rows exist, text does not.
  {
    parameter_id: "inc_add",
    band_index: 0,
    band_label: "9–10",
    band_name: "Exceptional",
    description: null,
  },
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

  it("lists every parameter key and the five-band scale, high band first", () => {
    const prompt = buildUserPrompt(PARAMS, BANDS);
    expect(prompt).toContain("problem — Problem (weight 8)");
    expect(prompt).toContain("traction — Traction (weight 10)");
    expect(prompt.indexOf("9–10: Exceptional")).toBeLessThan(prompt.indexOf("0–2: Insufficient"));
    // …and the middle band the four-band scale had no room for.
    expect(prompt).toContain("7–8: Strong");
  });

  it("gives each area its OWN anchor text, and omits bands with none written", () => {
    const prompt = buildUserPrompt(PARAMS, BANDS);
    expect(prompt).toContain("9–10 Exceptional: Mission-critical problem with regulatory pressure.");
    expect(prompt).toContain("0–2 Insufficient: Vague problem, generic framing.");
    // `traction` has no rows at all — it must not gain an empty Anchors block.
    const traction = prompt.slice(prompt.indexOf("traction — Traction"));
    expect(traction.slice(0, traction.indexOf("\n- "))).not.toContain("Anchors:");
  });

  it("includes a core area's own AI guidance prompt, with vars substituted", () => {
    const withPrompt: ParameterRow[] = [
      { ...PARAMS[0], prompt: "Look for a specific problem at {{startup_name}}." },
      PARAMS[1],
    ];
    const prompt = buildUserPrompt(withPrompt, BANDS, { startupName: "Acme" });
    expect(prompt).toContain("Guidance: Look for a specific problem at Acme.");
  });

  it("lists additional params in a separate assistive section with substituted guidance", () => {
    const prompt = buildUserPrompt(WITH_ADDITIONAL, BANDS, {
      startupName: "Acme",
      sector: "fintech",
    });
    // Core areas still appear in the weighted rubric.
    expect(prompt).toContain("problem — Problem (weight 8)");
    // The additional param is called out separately, not weighted.
    expect(prompt).toContain("Additional parameters (assistive");
    expect(prompt).toContain("add_lens — Custom Lens");
    expect(prompt).toContain("Assess Acme in fintech. Score 0-10.");
  });
});

describe("substituteVars", () => {
  it("fills known vars and leaves unknown/empty placeholders intact", () => {
    expect(
      substituteVars("Hi {{startup_name}} in {{sector}} at {{stage}}", {
        startupName: "Acme",
        sector: "fintech",
      }),
    ).toBe("Hi Acme in fintech at {{stage}}");
    expect(substituteVars("{{unknown}}", {})).toBe("{{unknown}}");
  });
});

describe("additional params are AI-scored but out of the composite", () => {
  it("buildTool's key enum includes additional param keys", () => {
    const tool = buildTool(WITH_ADDITIONAL);
    const schema = tool.input_schema as {
      properties: { scores: { items: { properties: { key: { enum: string[] } } } } };
    };
    expect(schema.properties.scores.items.properties.key.enum).toContain("add_lens");
  });

  it("an informational param (weight 0) never moves the weighted composite", () => {
    const parsed = parseEvaluation(
      {
        complete: true,
        scores: [
          { key: "problem", value: 8 },
          { key: "traction", value: 8 },
          { key: "team", value: 8 },
          { key: "add_lens", value: 1 }, // low assistive score…
        ],
      },
      WITH_ADDITIONAL,
    );
    // …but the composite is identical to the core-only 8.0 (denominator excludes weight 0).
    expect(computeResult(parsed, WITH_ADDITIONAL, "incubator", { gate: 5 }).weightedTotal).toBe(8);
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

/**
 * S2-SERVER (screening wave) — **this block used to be headed "the score > 5
 * gate" and it asserted two things the client's own flow diagram contradicts.**
 * Both are changed here on purpose, not adjusted to stay green:
 *
 *   · `total > GATE` becomes `total >= gate`. His check (3) is "Rating >=
 *     threshold?", so a deck scoring EXACTLY the threshold is Complete under
 *     his spec and was Rejected under ours. The old test named the old
 *     behaviour in its own title ("strictly greater than gate"); the new one
 *     names his.
 *   · a sub-gate INCUBATOR deck is no longer moved to `rejected` by the
 *     evaluator. It waits at `ai_evaluated` with its low score, which is what
 *     makes his "Below threshold" status reachable at all and what finally
 *     makes `reject_ai_gate`'s label true. VC is unchanged — his spec is the
 *     incubator's.
 *
 * And the gate itself is now an ARGUMENT, because it is
 * `org_scoring_settings.ai_gate_threshold` (migration 0082) and no longer a
 * constant. `GATE` below is this test's fixture, not the product's default.
 */
describe("computeResult — the AI screening gate", () => {
  const GATE = 5;

  function parsedWith(values: Record<string, number>): ReturnType<typeof parseEvaluation> {
    return parseEvaluation(
      { complete: true, scores: Object.entries(values).map(([key, value]) => ({ key, value })) },
      PARAMS,
    );
  }

  it("advances an incubator deck above the gate to ai_evaluated", () => {
    // weighted: (8*8 + 10*8 + 2*8)/20 = 8.0 → passes
    const r = computeResult(parsedWith({ problem: 8, traction: 8, team: 8 }), PARAMS, "incubator", { gate: GATE });
    expect(r.weightedTotal).toBe(8);
    expect(r.gatePassed).toBe(true);
    expect(r.status).toBe("ai_evaluated");
    expect(r.signal).toBe("strong");
  });

  it("leaves a sub-gate incubator deck WAITING at ai_evaluated, not rejected", () => {
    // weighted: (8*4 + 10*5 + 2*4)/20 = 4.5 → fails
    const r = computeResult(parsedWith({ problem: 4, traction: 5, team: 4 }), PARAMS, "incubator", { gate: GATE });
    expect(r.gatePassed).toBe(false);
    // The verdict is recorded (`gatePassed: false` becomes `below_gate` on the
    // evaluation row) but the deck is not moved. Rejecting it is now a decision
    // an operator makes from the client's "Below threshold" status — which is
    // the state this line exists to keep reachable.
    expect(r.status).toBe("ai_evaluated");
  });

  it("treats exactly the threshold as PASSING — his words are 'at or above'", () => {
    const r = computeResult(parsedWith({ problem: 5, traction: 5, team: 5 }), PARAMS, "incubator", { gate: GATE });
    expect(r.weightedTotal).toBe(5);
    expect(r.gatePassed).toBe(true);
    expect(r.status).toBe("ai_evaluated");
  });

  it("is the ORG's number, not a constant — a stricter gate fails the same deck", () => {
    // The whole point of 0082: the same 5.0 deck, judged by an org that set its
    // gate to 6. Without this the setting could be ignored and every test above
    // would still pass.
    const r = computeResult(parsedWith({ problem: 5, traction: 5, team: 5 }), PARAMS, "incubator", { gate: 6 });
    expect(r.gatePassed).toBe(false);
    expect(r.status).toBe("ai_evaluated");
    // …and a lenient org passes a deck the default would have stopped.
    const lenient = computeResult(parsedWith({ problem: 4, traction: 4, team: 4 }), PARAMS, "incubator", { gate: 4 });
    expect(lenient.gatePassed).toBe(true);
  });

  it("routes a VC pass to analyst_scoring and a fail to archived", () => {
    // VC is deliberately NOT changed by the screening wave: the client's spec
    // is the incubator's, and whether a sub-gate deal should wait instead of
    // being archived is a question for him.
    expect(
      computeResult(parsedWith({ problem: 9, traction: 9, team: 9 }), PARAMS, "vc", { gate: GATE }).status,
    ).toBe("analyst_scoring");
    expect(
      computeResult(parsedWith({ problem: 2, traction: 2, team: 2 }), PARAMS, "vc", { gate: GATE }).status,
    ).toBe("archived");
  });

  it("uses the full rubric weight — an unscored parameter counts as 0, not dropped", () => {
    // Only 2 of 3 params scored strongly; team (weight 2) is missing → 0.
    // Full denominator: (8*9 + 10*9 + 2*0)/20 = 8.1, not (8*9+10*9)/18 = 9.0.
    const r = computeResult(parsedWith({ problem: 9, traction: 9 }), PARAMS, "incubator", { gate: GATE });
    expect(r.weightedTotal).toBe(8.1);
  });

  it("treats a zero-score response as Incomplete, never a silent rejection", () => {
    const r = computeResult(parseEvaluation({ complete: true, scores: [] }, PARAMS), PARAMS, "incubator", {
      gate: GATE,
    });
    expect(r.status).toBe("incomplete");
    expect(r.signal).toBe("flagged");
    expect(r.gatePassed).toBe(false);
  });

  it("marks an incomplete deck flagged and Incomplete regardless of score", () => {
    const parsed = parseEvaluation(
      { complete: false, scores: [{ key: "problem", value: 9 }, { key: "traction", value: 9 }] },
      PARAMS,
    );
    const r = computeResult(parsed, PARAMS, "incubator", { gate: GATE });
    expect(r.status).toBe("incomplete");
    expect(r.signal).toBe("flagged");
  });
});
