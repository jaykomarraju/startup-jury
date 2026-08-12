import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { handleQueue, DLQ_NAME } from "../../src/server/queue";
import {
  classifyEvalError,
  markEvalTerminal,
  recordEvalFailure,
  summariseError,
  sweepStuckEvaluations,
  MAX_AI_ATTEMPTS,
} from "../../src/server/ai/health";
import { runStuckSweep } from "../../src/server/scheduled";
import type { EvalMessage } from "../../src/server/types";

// Session 7 — the full fix for FINISH-PLAN §9 ("decks stuck at pending").
//
// The old behaviour: any evaluation error left the deck at `pending_ai` with no
// reason, no re-drive and the credit spent; a bulk message that exhausted its
// retries was dropped entirely. These tests lock in the four replacements —
// record, re-drive, give up honestly (with a refund), and surface the reason.
//
// NB storage is isolated per FILE, so each `it` uses its own deck id.

const BASE = "https://example.com";
const INC_ADMIN = "nisha.kapoor@demo.startupjury.ai";
const INC_JURY = "rajesh.kumar@demo.startupjury.ai";

async function login(email: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo1234" }),
  });
  const setCookie = res.headers.get("set-cookie");
  return setCookie ? setCookie.split(";")[0] : "";
}

/** Insert a deck parked at `pending_ai`, `ageMinutes` old. */
async function stuckDeck(id: string, ageMinutes: number, attempts = 0): Promise<void> {
  const createdAt = new Date(Date.now() - ageMinutes * 60_000).toISOString();
  await env.DB.prepare(
    "INSERT INTO decks (id, edition, name, status, uploaded_by, r2_key, created_at, updated_at, ai_attempts) " +
      "VALUES (?, 'incubator', ?, 'pending_ai', 'inc_pa', ?, ?, ?, ?)",
  )
    .bind(id, `Stuck ${id}`, `decks/${id}.pdf`, createdAt, createdAt, attempts)
    .run();
}

async function creditBalance(): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT credits_balance AS n FROM org_settings WHERE edition = 'incubator'",
  ).first<{ n: number }>();
  return row?.n ?? 0;
}

/** Minimal MessageBatch stand-in that records ack/retry per message. */
function batchOf(queue: string, deckIds: string[]) {
  const acked: string[] = [];
  const retried: string[] = [];
  const messages = deckIds.map((deckId, i) => ({
    id: `m${i}`,
    timestamp: new Date(0),
    body: { deckId } as EvalMessage,
    attempts: 1,
    ack: () => acked.push(deckId),
    retry: () => retried.push(deckId),
  }));
  return {
    batch: { queue, messages, ackAll: () => {}, retryAll: () => {} } as unknown as MessageBatch<EvalMessage>,
    acked,
    retried,
  };
}

describe("classifyEvalError", () => {
  it("names the real cause instead of guessing 'no AI key'", () => {
    expect(classifyEvalError("Error: ANTHROPIC_API_KEY is not configured")).toBe(
      "AI key missing or rejected",
    );
    expect(classifyEvalError("Anthropic API error 400: your credit balance is too low")).toBe(
      "AI provider billing — out of credits",
    );
    expect(classifyEvalError("Anthropic API error 429: rate_limit")).toBe("AI provider rate limit");
    expect(classifyEvalError("Error: R2 object missing: decks/x.pdf")).toBe("Deck PDF is missing");
    expect(classifyEvalError("Error: deck not found: abc")).toBe("Deck record is missing");
    expect(classifyEvalError("Anthropic response missing submit_evaluation tool_use")).toBe(
      "AI returned an unusable response",
    );
    expect(classifyEvalError("Anthropic API error 503: overloaded")).toBe("AI provider unavailable");
    expect(classifyEvalError("something odd")).toBe("AI evaluation failed");
    expect(classifyEvalError(null)).toBeNull();
  });
});

describe("summariseError", () => {
  it("flattens and truncates so a provider dump can't fill the column", () => {
    expect(summariseError(new Error("boom"))).toBe("Error: boom");
    expect(summariseError("a\n  b\tc")).toBe("a b c");
    const long = summariseError(new Error("x".repeat(500)));
    expect(long.length).toBeLessThanOrEqual(300);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("recordEvalFailure", () => {
  it("stamps the reason and counts the attempt", async () => {
    await stuckDeck("deck_record_1", 0);
    await recordEvalFailure(env, "deck_record_1", new Error("Anthropic API error 429: slow down"));
    await recordEvalFailure(env, "deck_record_1", new Error("Anthropic API error 429: slow down"));
    const row = await env.DB.prepare(
      "SELECT ai_error, ai_attempts, ai_last_attempt_at FROM decks WHERE id = 'deck_record_1'",
    ).first<{ ai_error: string; ai_attempts: number; ai_last_attempt_at: string }>();
    expect(row?.ai_attempts).toBe(2);
    expect(row?.ai_error).toContain("429");
    expect(row?.ai_last_attempt_at).toBeTruthy();
  });

  it("never throws on a deck that no longer exists", async () => {
    await expect(recordEvalFailure(env, "deck_gone", new Error("x"))).resolves.toBeUndefined();
  });
});

describe("markEvalTerminal", () => {
  it("marks the deck failed and refunds the credit exactly once", async () => {
    await stuckDeck("deck_terminal_1", 60);
    const before = await creditBalance();

    const first = await markEvalTerminal(env, "deck_terminal_1", "billing");
    expect(first).toEqual({ marked: true, refunded: true });
    expect(await creditBalance()).toBe(before + 1);

    // A second caller (the sweep racing the dead-letter handler) must not
    // double-refund — that would mint credits out of a failure.
    const second = await markEvalTerminal(env, "deck_terminal_1", "billing");
    expect(second.refunded).toBe(false);
    expect(await creditBalance()).toBe(before + 1);

    const row = await env.DB.prepare(
      "SELECT ai_failed_at, ai_error FROM decks WHERE id = 'deck_terminal_1'",
    ).first<{ ai_failed_at: string; ai_error: string }>();
    expect(row?.ai_failed_at).toBeTruthy();
    expect(row?.ai_error).toBe("billing");
  });

  it("does nothing for a deck that already left pending_ai (or vanished)", async () => {
    const before = await creditBalance();
    expect(await markEvalTerminal(env, "inc_deck_finstack", "late")).toEqual({
      marked: false,
      refunded: false,
    });
    expect(await markEvalTerminal(env, "deck_never_existed", "late")).toEqual({
      marked: false,
      refunded: false,
    });
    expect(await creditBalance()).toBe(before);
  });
});

describe("queue consumer", () => {
  it("acks a success and records nothing", async () => {
    await stuckDeck("deck_queue_ok", 0);
    const { batch, acked, retried } = batchOf("startup-jury-evals", ["deck_queue_ok"]);
    await handleQueue(batch, env, async () => undefined);
    expect(acked).toEqual(["deck_queue_ok"]);
    expect(retried).toEqual([]);
  });

  it("records the reason BEFORE retrying, so the cause survives the retries", async () => {
    await stuckDeck("deck_queue_fail", 0);
    const { batch, retried } = batchOf("startup-jury-evals", ["deck_queue_fail"]);
    await handleQueue(batch, env, async () => {
      throw new Error("Anthropic API error 400: credit balance too low");
    });
    expect(retried).toEqual(["deck_queue_fail"]);
    const row = await env.DB.prepare(
      "SELECT ai_error, ai_attempts FROM decks WHERE id = 'deck_queue_fail'",
    ).first<{ ai_error: string; ai_attempts: number }>();
    expect(row?.ai_attempts).toBe(1);
    expect(row?.ai_error).toContain("credit balance");
  });

  it("dead-letters: marks the deck failed with its reason, refunds, and acks", async () => {
    await stuckDeck("deck_dlq_1", 0);
    await recordEvalFailure(env, "deck_dlq_1", new Error("Anthropic API error 400: credit balance too low"));
    const before = await creditBalance();

    const { batch, acked, retried } = batchOf(DLQ_NAME, ["deck_dlq_1"]);
    await handleQueue(batch, env);
    // A dead-lettered message is terminal — re-queueing it would loop forever.
    expect(acked).toEqual(["deck_dlq_1"]);
    expect(retried).toEqual([]);
    expect(await creditBalance()).toBe(before + 1);

    const row = await env.DB.prepare(
      "SELECT ai_failed_at, ai_error FROM decks WHERE id = 'deck_dlq_1'",
    ).first<{ ai_failed_at: string; ai_error: string }>();
    expect(row?.ai_failed_at).toBeTruthy();
    expect(row?.ai_error).toContain("credit balance");
  });

  it("dead-letters a deck with no recorded reason using a fallback", async () => {
    await stuckDeck("deck_dlq_2", 0);
    const { batch, acked } = batchOf(DLQ_NAME, ["deck_dlq_2"]);
    await handleQueue(batch, env);
    expect(acked).toEqual(["deck_dlq_2"]);
    const row = await env.DB.prepare("SELECT ai_error FROM decks WHERE id = 'deck_dlq_2'").first<{
      ai_error: string;
    }>();
    expect(row?.ai_error).toBe("AI evaluation failed after all retries");
  });

  it("acks a malformed dead-letter message instead of looping on it", async () => {
    const { batch, acked } = batchOf(DLQ_NAME, [""]);
    await handleQueue(batch, env);
    expect(acked).toEqual([""]);
  });
});

describe("sweepStuckEvaluations", () => {
  it("ignores decks inside the grace period", async () => {
    await stuckDeck("deck_sweep_fresh", 1);
    const res = await sweepStuckEvaluations(env, { staleMinutes: 10 });
    expect(res.requeued).not.toContain("deck_sweep_fresh");
    expect(res.failed).not.toContain("deck_sweep_fresh");
  });

  it("re-enqueues a stale deck and counts the attempt", async () => {
    await stuckDeck("deck_sweep_stale", 30);
    const res = await sweepStuckEvaluations(env, { staleMinutes: 10 });
    expect(res.requeued).toContain("deck_sweep_stale");
    const row = await env.DB.prepare(
      "SELECT ai_attempts, ai_last_attempt_at FROM decks WHERE id = 'deck_sweep_stale'",
    ).first<{ ai_attempts: number; ai_last_attempt_at: string }>();
    expect(row?.ai_attempts).toBe(1);
    expect(row?.ai_last_attempt_at).toBeTruthy();

    // The freshly-stamped attempt keeps it out of the very next sweep.
    const again = await sweepStuckEvaluations(env, { staleMinutes: 10 });
    expect(again.requeued).not.toContain("deck_sweep_stale");
  });

  it("respects the grace period for a deck stored with SQLite's own timestamp", async () => {
    // `storeDeck` lets `created_at` DEFAULT to `datetime('now')`, which writes
    // "YYYY-MM-DD HH:MM:SS" — not the ISO-8601 this module produces. A raw
    // string compare puts the space-separated form before the "T" form on the
    // SAME date, so a deck uploaded minutes ago would look stale and get
    // re-driven while its first evaluation was still running.
    await env.DB.prepare(
      "INSERT INTO decks (id, edition, name, status, uploaded_by, r2_key, created_at, updated_at) " +
        "VALUES ('deck_sweep_sqlitefmt', 'incubator', 'SQLite Fmt', 'pending_ai', 'inc_pa', " +
        "'decks/deck_sweep_sqlitefmt.pdf', datetime('now'), datetime('now'))",
    ).run();
    const res = await sweepStuckEvaluations(env, { staleMinutes: 10 });
    expect(res.requeued).not.toContain("deck_sweep_sqlitefmt");
    expect(res.failed).not.toContain("deck_sweep_sqlitefmt");
  });

  it("still catches a genuinely old deck stored in SQLite's format", async () => {
    await env.DB.prepare(
      "INSERT INTO decks (id, edition, name, status, uploaded_by, r2_key, created_at, updated_at) " +
        "VALUES ('deck_sweep_sqliteold', 'incubator', 'SQLite Old', 'pending_ai', 'inc_pa', " +
        "'decks/deck_sweep_sqliteold.pdf', datetime('now', '-3 hours'), datetime('now', '-3 hours'))",
    ).run();
    const res = await sweepStuckEvaluations(env, { staleMinutes: 10 });
    expect(res.requeued).toContain("deck_sweep_sqliteold");
  });

  it("gives up past the attempt cap and refunds the credit", async () => {
    await stuckDeck("deck_sweep_capped", 60, MAX_AI_ATTEMPTS);
    const before = await creditBalance();
    const res = await sweepStuckEvaluations(env, { staleMinutes: 10 });
    expect(res.failed).toContain("deck_sweep_capped");
    expect(res.refunded).toBeGreaterThanOrEqual(1);
    expect(await creditBalance()).toBe(before + 1);
  });

  it("never re-picks a deck it already declared failed", async () => {
    await stuckDeck("deck_sweep_done", 60, MAX_AI_ATTEMPTS);
    await sweepStuckEvaluations(env, { staleMinutes: 10 });
    const second = await sweepStuckEvaluations(env, { staleMinutes: 10 });
    expect(second.failed).not.toContain("deck_sweep_done");
    expect(second.requeued).not.toContain("deck_sweep_done");
  });

  it("leaves scored decks alone", async () => {
    const res = await sweepStuckEvaluations(env, { staleMinutes: 0 });
    expect(res.requeued).not.toContain("inc_deck_finstack");
    expect(res.failed).not.toContain("inc_deck_finstack");
  });

  it("runStuckSweep is the cron wrapper over the same logic", async () => {
    const res = await runStuckSweep(env);
    expect(Array.isArray(res.requeued)).toBe(true);
    expect(Array.isArray(res.failed)).toBe(true);
  });
});

describe("deck views surface AI health", () => {
  beforeAll(async () => {
    await stuckDeck("deck_view_failed", 60);
    await markEvalTerminal(env, "deck_view_failed", "Anthropic API error 400: credit balance too low");
    await stuckDeck("deck_view_running", 0);
  });

  it("distinguishes failed from in-progress, with the real reason", async () => {
    const admin = await login(INC_ADMIN);
    const res = await SELF.fetch(`${BASE}/api/decks`, { headers: { cookie: admin } });
    const { decks } = (await res.json()) as {
      decks: { id: string; status: string; aiState: string; aiError?: string }[];
    };
    const failed = decks.find((d) => d.id === "deck_view_failed")!;
    const running = decks.find((d) => d.id === "deck_view_running")!;

    // Both still read "Pending AI" as a pipeline stage — that's the bug's shape.
    expect(failed.status).toBe("Pending AI");
    expect(running.status).toBe("Pending AI");
    // …but they are no longer indistinguishable.
    expect(failed.aiState).toBe("failed");
    expect(failed.aiError).toBe("AI provider billing — out of credits");
    expect(running.aiState).toBe("in_progress");
    expect(running.aiError).toBeUndefined();
  });
});

describe("POST /api/decks/:id/retry-ai", () => {
  it("re-drives a failed deck, re-reserving the refunded credit", async () => {
    await stuckDeck("deck_retry_1", 60);
    await markEvalTerminal(env, "deck_retry_1", "Anthropic API error 429");
    const afterRefund = await creditBalance();

    const admin = await login(INC_ADMIN);
    const res = await SELF.fetch(`${BASE}/api/decks/deck_retry_1/retry-ai`, {
      method: "POST",
      headers: { cookie: admin },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { queued: boolean }).queued).toBe(true);
    // The re-drive spends the credit the failure had returned.
    expect(await creditBalance()).toBe(afterRefund - 1);

    const row = await env.DB.prepare(
      "SELECT ai_error, ai_failed_at, ai_attempts, ai_credit_refunded FROM decks WHERE id = 'deck_retry_1'",
    ).first<{
      ai_error: string | null;
      ai_failed_at: string | null;
      ai_attempts: number;
      ai_credit_refunded: number;
    }>();
    expect(row?.ai_error).toBeNull();
    expect(row?.ai_failed_at).toBeNull();
    expect(row?.ai_attempts).toBe(0);
    expect(row?.ai_credit_refunded).toBe(0);
  });

  it("refuses a deck that is not pending, and 404s across editions", async () => {
    const admin = await login(INC_ADMIN);
    const notPending = await SELF.fetch(`${BASE}/api/decks/inc_deck_finstack/retry-ai`, {
      method: "POST",
      headers: { cookie: admin },
    });
    expect(notPending.status).toBe(409);

    const crossEdition = await SELF.fetch(`${BASE}/api/decks/vc_deck_medgrid/retry-ai`, {
      method: "POST",
      headers: { cookie: admin },
    });
    expect(crossEdition.status).toBe(404);
  });

  it("is closed to roles that can't re-score", async () => {
    await stuckDeck("deck_retry_authz", 0);
    const jury = await login(INC_JURY);
    const res = await SELF.fetch(`${BASE}/api/decks/deck_retry_authz/retry-ai`, {
      method: "POST",
      headers: { cookie: jury },
    });
    expect(res.status).toBe(403);
  });
});
