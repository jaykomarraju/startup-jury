import { env } from "cloudflare:test";
import { describe, it, expect, vi } from "vitest";
import {
  callAnthropic,
  evaluateDeck,
  parseEvaluation,
  unscorableReason,
  type ParameterRow,
  type RawEvaluation,
} from "../../src/server/ai/evaluate";
import { classifyEvalError } from "../../src/server/ai/health";
import type { Env } from "../../src/server/types";

/**
 * **Oct-3 issue 15 — "Ushakiran didn't get evaluated. It was showing AI score as
 * zero inspite of proper deck being present."**
 *
 * Production carried two rows named "Ushakiran" with `ai_complete = 1` and
 * `ai_score = 0.00`, while a third upload of the same deck scored 5.51. The pair
 * of columns is the contradiction: the model is recorded as having read the deck
 * AND as having scored nothing in it. There was no state for "the run produced
 * nothing", so a failed run was stored as a legitimately terrible deck — and the
 * AI gate, the stat boxes and every action whitelist then believed it.
 *
 * What is pinned here:
 *   · a response that scores no rubric parameter is a FAILURE — `evaluateDeck`
 *     throws, so the §9 health machinery (reason, attempts, retry, credit
 *     refund) takes over instead of a 0.00 being written;
 *   · that failure destroys nothing: the previous run's scores, extractions,
 *     evaluation roll-up and `ai_score` all survive it (an unconditional DELETE
 *     ran before the new result was known good, which is how a deck that once
 *     scored 5.51 came to read 0.00);
 *   · an explicit `complete: false` is still a verdict and still persists — the
 *     negative control that stops this from becoming "everything throws";
 *   · a `max_tokens` truncation is detected rather than parsed as a whole
 *     answer;
 *   · a score entry with no number is dropped, not stored as a 0 the AI "gave".
 *
 * NB (worker-test gotcha, as stated at the top of automation.test.ts): storage
 * is isolated per FILE, not per test, so every fixture below has a unique id.
 */

const PARAMS: ParameterRow[] = [
  { id: "p_a", key: "problem", name: "Problem", weight: 8, informational: false, prompt: null },
  { id: "p_b", key: "traction", name: "Traction", weight: 10, informational: false, prompt: null },
  { id: "p_c", key: "team", name: "Team", weight: 2, informational: false, prompt: null },
];

describe("unscorableReason — the shape that produced ai_complete=1 / ai_score=0", () => {
  it("rejects the exact Ushakiran payload: complete, and nothing scored", () => {
    const reason = unscorableReason({ complete: true, scores: [] }, PARAMS);
    expect(reason).toBe("the response scored none of the 3 rubric parameters");
  });

  it("rejects a payload whose `complete` never arrived at all", () => {
    // The half-finished tool input. `parseEvaluation` reads a missing `complete`
    // as the model's affirmative (`raw.complete !== false`), which is the
    // `ai_complete = 1` half of the contradiction — so this must be caught on
    // the RAW payload, before that default is applied.
    expect(parseEvaluation({ scores: [] }, PARAMS).complete).toBe(true);
    expect(unscorableReason({}, PARAMS)).toBe("the response carried no scores array");
  });

  it("rejects scores the rubric does not recognise, and ones with no number", () => {
    expect(unscorableReason({ complete: true, scores: [{ key: "vibes", value: 7 }] }, PARAMS)).toBe(
      "the response scored none of the 3 rubric parameters",
    );
    expect(unscorableReason({ complete: true, scores: [{ key: "team" }] }, PARAMS)).toBe(
      "the response scored none of the 3 rubric parameters",
    );
  });

  it("accepts a partial answer — one real score is an evaluation", () => {
    // Deliberately NOT a failure: `computeResult` scores the missing parameters
    // as 0 over the full denominator on purpose, so a truncated response cannot
    // inflate a composite past the gate.
    expect(unscorableReason({ complete: true, scores: [{ key: "team", value: 4 }] }, PARAMS)).toBeNull();
  });

  it("accepts an explicit `complete: false` with no scores — that IS a verdict", () => {
    // The model saying "this deck is not evaluable" is the legitimate route to
    // Incomplete, and it stores `ai_complete = 0`, so it was never confusable
    // with the row this suite exists for.
    expect(unscorableReason({ complete: false, scores: [] }, PARAMS)).toBeNull();
  });
});

describe("parseEvaluation — a missing number is not a zero", () => {
  it("drops a valueless entry instead of attributing a 0 score to the AI", () => {
    const parsed = parseEvaluation(
      { complete: true, scores: [{ key: "problem", value: 6 }, { key: "team" }] },
      PARAMS,
    );
    expect(parsed.scores.map((s) => s.key)).toEqual(["problem"]);
  });

  it("still clamps an out-of-range number — the model did answer there", () => {
    const parsed = parseEvaluation({ complete: true, scores: [{ key: "team", value: -3 }] }, PARAMS);
    expect(parsed.scores).toEqual([{ parameterId: "p_c", key: "team", value: 0, comment: null }]);
  });

  it("lets a later, valid duplicate through after a valueless one", () => {
    const parsed = parseEvaluation(
      { complete: true, scores: [{ key: "team" }, { key: "team", value: 7 }] },
      PARAMS,
    );
    expect(parsed.scores).toEqual([{ parameterId: "p_c", key: "team", value: 7, comment: null }]);
  });
});

describe("callAnthropic — a truncated response is not an answer", () => {
  async function call(body: Record<string, unknown>): Promise<RawEvaluation> {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }),
    );
    try {
      return await callAnthropic({
        apiKey: "sk-test",
        model: "claude-sonnet-5",
        system: "sys",
        userText: "user",
        pdfBase64: "JVBERg==",
        tool: { name: "submit_evaluation", description: "d", input_schema: {} },
      });
    } finally {
      spy.mockRestore();
    }
  }

  it("throws on stop_reason max_tokens even though the tool_use block is there", async () => {
    // The request is a 200 and the block parses; only `stop_reason` says the
    // `scores` array was cut off rather than empty.
    await expect(
      call({
        stop_reason: "max_tokens",
        content: [{ type: "tool_use", name: "submit_evaluation", input: { complete: true } }],
      }),
    ).rejects.toThrow(/truncated at max_tokens/);
  });

  it("passes a normal tool_use stop through", async () => {
    const raw = await call({
      stop_reason: "tool_use",
      content: [
        {
          type: "tool_use",
          name: "submit_evaluation",
          input: { complete: true, scores: [{ key: "team", value: 5 }] },
        },
      ],
    });
    expect(raw.scores).toEqual([{ key: "team", value: 5 }]);
  });
});

describe("classifyEvalError — the operator-facing reason", () => {
  it("names a cut-off run and an unusable one differently", () => {
    expect(
      classifyEvalError("Error: Anthropic response for submit_evaluation was truncated at max_tokens"),
    ).toBe("AI response was cut off before it finished");
    expect(
      classifyEvalError(
        "Error: submit_evaluation returned nothing usable: the response scored none of the 22 rubric parameters",
      ),
    ).toBe("AI returned an unusable response");
  });
});

// ── The persisted half: what a dead run must NOT do to the deck ──────────────

async function paramIds(): Promise<Array<{ id: string; key: string }>> {
  return (
    await env.DB.prepare(
      "SELECT id, key FROM parameters WHERE edition = 'incubator' AND active = 1 ORDER BY sort_order",
    ).all<{ id: string; key: string }>()
  ).results;
}

/** A deck that has ALREADY been scored well — the state issue 15 overwrote. */
async function seedScoredDeck(id: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO decks (id, edition, name, stage, city, founder, founder_email, founder_phone, " +
      "status, r2_key, uploaded_by, complete, ai_complete, ai_score, signal) " +
      "VALUES (?, 'incubator', ?, 'Seed', 'Pune', 'Ada Founder', 'ada@testco.example', " +
      "'+91 90000 00000', 'pending_ai', ?, 'inc_pa', 1, 1, 5.51, 'moderate')",
  )
    .bind(id, `Deck ${id}`, `decks/${id}.pdf`)
    .run();
  await env.DECKS.put(`decks/${id}.pdf`, new Uint8Array([37, 80, 68, 70]));
  const params = await paramIds();
  await env.DB.prepare(
    "INSERT INTO scores (id, deck_id, evaluator_id, evaluator_kind, parameter_id, value, comment, created_at) " +
      "VALUES (?, ?, NULL, 'ai', ?, 6, 'from the good run', '2026-10-01T00:00:00Z')",
  )
    .bind(`${id}_prior_ai`, id, params[0].id)
    .run();
  await env.DB.prepare(
    "INSERT INTO deck_extractions (id, deck_id, label, heading, text, sort_order, missing) " +
      "VALUES (?, ?, 'Cover', 'Ushakiran', 'from the good run', 0, 0)",
  )
    .bind(`${id}_prior_ext`, id)
    .run();
  await env.DB.prepare(
    "INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, verdict, remarks, submitted_at, " +
      "scored_criteria_version, scored_content_version) " +
      "VALUES (?, ?, NULL, 5.51, 'advanced', 'AI evaluation', '2026-10-01T00:00:00Z', 1, 1)",
  )
    .bind(`${id}_ai_eval`, id)
    .run();
}

interface DeckMarks {
  status: string;
  ai_score: number | null;
  ai_complete: number | null;
  signal: string | null;
}

function marks(id: string): Promise<DeckMarks | null> {
  return env.DB.prepare("SELECT status, ai_score, ai_complete, signal FROM decks WHERE id = ?")
    .bind(id)
    .first<DeckMarks>();
}

async function aiRowCounts(id: string): Promise<Record<string, number>> {
  const one = async (sql: string): Promise<number> =>
    ((await env.DB.prepare(sql).bind(id).first<{ n: number }>())?.n ?? 0);
  return {
    scores: await one("SELECT COUNT(*) AS n FROM scores WHERE deck_id = ? AND evaluator_kind = 'ai'"),
    extractions: await one("SELECT COUNT(*) AS n FROM deck_extractions WHERE deck_id = ?"),
    evaluations: await one("SELECT COUNT(*) AS n FROM evaluations WHERE deck_id = ? AND evaluator_id IS NULL"),
  };
}

describe("evaluateDeck refuses to store a run that scored nothing", () => {
  it("throws, leaving the deck at pending_ai with its real score intact", async () => {
    await seedScoredDeck("usk_dead");
    await expect(
      evaluateDeck(env as Env, "usk_dead", {
        // The payload the live model actually returned: it claims the deck is
        // readable and scores nothing.
        callModel: async (): Promise<RawEvaluation> => ({
          complete: true,
          founder: "Ada Founder",
          extractions: [{ label: "Cover", text: "Ushakiran Ecoplast" }],
          scores: [],
        }),
      }),
    ).rejects.toThrow(/returned nothing usable/);

    // `pending_ai` is both what `sweepStuckEvaluations` looks for and a stage
    // `archive` is available from — the tester's "Archive should be active at
    // least" holds without a stage change.
    expect(await marks("usk_dead")).toMatchObject({
      status: "pending_ai",
      ai_score: 5.51,
      ai_complete: 1,
      signal: "moderate",
    });
  });

  it("destroys nothing on the way out — the previous run's rows survive", async () => {
    await seedScoredDeck("usk_keep");
    await expect(
      evaluateDeck(env as Env, "usk_keep", {
        callModel: async (): Promise<RawEvaluation> => ({ complete: true, scores: [] }),
      }),
    ).rejects.toThrow(/returned nothing usable/);
    // The three DELETEs at the top of the persist batch are unconditional, so
    // reaching them at all would have wiped a good evaluation and replaced it
    // with 0.00 — the "same deck scored 5.51 once and 0.00 twice" row.
    expect(await aiRowCounts("usk_keep")).toEqual({ scores: 1, extractions: 1, evaluations: 1 });
  });

  it("does not clear the failure state a prior attempt recorded", async () => {
    await seedScoredDeck("usk_attempts");
    await env.DB.prepare("UPDATE decks SET ai_attempts = 2, ai_error = 'earlier reason' WHERE id = ?")
      .bind("usk_attempts")
      .run();
    await expect(
      evaluateDeck(env as Env, "usk_attempts", {
        callModel: async (): Promise<RawEvaluation> => ({ complete: true, scores: [] }),
      }),
    ).rejects.toThrow();
    // The success UPDATE resets `ai_attempts = 0, ai_error = NULL`. A dead run
    // reaching it reset the attempt counter every time, so the sweep's
    // MAX_AI_ATTEMPTS cap — and therefore the credit refund — was unreachable.
    const row = await env.DB.prepare("SELECT ai_attempts, ai_error FROM decks WHERE id = ?")
      .bind("usk_attempts")
      .first<{ ai_attempts: number; ai_error: string | null }>();
    expect(row).toMatchObject({ ai_attempts: 2, ai_error: "earlier reason" });
  });

  it("NEGATIVE CONTROL: an explicit `complete: false` still persists as Incomplete", async () => {
    // Without this, the fix above would be indistinguishable from "any deck the
    // model scores nothing on now fails", which would break the legitimate
    // Incomplete route (Turaga's row: ai_complete = 0, ai_score = 0).
    await seedScoredDeck("usk_unreadable");
    const result = await evaluateDeck(env as Env, "usk_unreadable", {
      callModel: async (): Promise<RawEvaluation> => ({ complete: false, scores: [] }),
      notify: async () => ({ sent: false, reason: "no_recipient" }),
    });
    expect(result.status).toBe("incomplete");
    expect(await marks("usk_unreadable")).toMatchObject({ status: "incomplete", ai_complete: 0 });
  });

  it("NEGATIVE CONTROL: a real scored run still persists normally", async () => {
    await seedScoredDeck("usk_good");
    const params = await paramIds();
    const result = await evaluateDeck(env as Env, "usk_good", {
      callModel: async (): Promise<RawEvaluation> => ({
        complete: true,
        founder: "Ada Founder",
        scores: params.map((p) => ({ key: p.key, value: 8 })),
      }),
    });
    expect(result.weightedTotal).toBeGreaterThan(5);
    expect(await marks("usk_good")).toMatchObject({ status: "ai_evaluated", ai_complete: 1 });
  });
});
