/**
 * Session 7 — the full fix for FINISH-PLAN §9, "decks stuck at pending".
 *
 * Root cause (confirmed in Session 1): every deck is created at `pending_ai` and
 * `evaluateDeck` only moves it off on **full success** — one terminal UPDATE
 * after the model call. Any throw (Anthropic billing/rate, a bad key, a missing
 * R2 object) left the status untouched, and nothing re-drove it: the single
 * upload swallowed the error, the bulk consumer retried three times and the
 * message was then **dropped** (no dead-letter queue), the reminder cron only
 * looks at `assigned` decks, and the credit stayed spent.
 *
 * The fix has four parts, and this module owns three of them:
 *
 *   1. **Record every failure.** `recordEvalFailure` stamps the reason, the
 *      attempt count and the time on the deck, so "in progress" and "failed" stop
 *      looking identical in the UI.
 *   2. **Re-drive.** `sweepStuckEvaluations` (cron) re-enqueues decks parked at
 *      `pending_ai` past a grace period, up to `MAX_AI_ATTEMPTS`.
 *   3. **Give up honestly.** Past the cap — or on a dead-letter delivery —
 *      `markEvalTerminal` marks the deck failed AND **refunds the credit**,
 *      exactly once (`decks.ai_credit_refunded` is the idempotency guard, so a
 *      sweep and a dead-letter delivery racing over the same deck can't
 *      double-refund).
 *
 * The fourth part is the dead-letter queue itself, configured in
 * `wrangler.jsonc` and routed in `src/server/queue.ts`.
 */

import type { Env } from "../types";
import type { Edition } from "../../shared/roles";
import { refundCredits } from "../decks/versions";

/** How many evaluation attempts a deck gets before it is declared failed. */
export const MAX_AI_ATTEMPTS = 3;

/**
 * How long a deck may sit at `pending_ai` before the sweep re-drives it. A real
 * evaluation is a single synchronous Anthropic call (10–30s), so ten minutes is
 * far outside the healthy band while still leaving a slow batch alone.
 */
export const STUCK_AFTER_MINUTES = 10;

/** Trim a provider error down to something safe to store and show an operator. */
export function summariseError(err: unknown, max = 300): string {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const flat = raw.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * Turn a raw error into the one-line cause an evaluator reads on the decks
 * table. The old UI hardcoded "no AI key configured yet" for every failure mode,
 * which was wrong for all of them except one.
 */
export function classifyEvalError(reason: string | null | undefined): string | null {
  if (!reason) return null;
  const r = reason.toLowerCase();
  if (r.includes("api_key") || r.includes("api key") || r.includes("401")) {
    return "AI key missing or rejected";
  }
  if (r.includes("credit balance") || r.includes("billing") || r.includes("402")) {
    return "AI provider billing — out of credits";
  }
  if (r.includes("429") || r.includes("rate")) return "AI provider rate limit";
  if (r.includes("r2 object missing") || r.includes("no r2 key")) return "Deck PDF is missing";
  if (r.includes("deck not found")) return "Deck record is missing";
  if (r.includes("submit_evaluation")) return "AI returned an unusable response";
  if (/\b5\d\d\b/.test(r)) return "AI provider unavailable";
  return "AI evaluation failed";
}

/**
 * Record a failed evaluation attempt. Never throws — it runs inside a catch
 * block on paths whose real job is something else, and losing the audit note
 * must not turn a recoverable failure into a 500.
 */
export async function recordEvalFailure(env: Env, deckId: string, err: unknown): Promise<void> {
  try {
    await env.DB.prepare(
      "UPDATE decks SET ai_error = ?, ai_attempts = ai_attempts + 1, ai_last_attempt_at = ? WHERE id = ?",
    )
      .bind(summariseError(err), new Date().toISOString(), deckId)
      .run();
  } catch (dbErr) {
    console.error(`could not record eval failure for ${deckId}:`, dbErr);
  }
}

/** Clear the failure state — called when an evaluation finally succeeds. */
export async function clearEvalFailure(env: Env, deckId: string): Promise<void> {
  try {
    await env.DB.prepare(
      "UPDATE decks SET ai_error = NULL, ai_failed_at = NULL, ai_attempts = 0 WHERE id = ? AND " +
        "(ai_error IS NOT NULL OR ai_failed_at IS NOT NULL OR ai_attempts > 0)",
    )
      .bind(deckId)
      .run();
  } catch (dbErr) {
    console.error(`could not clear eval failure for ${deckId}:`, dbErr);
  }
}

export interface TerminalResult {
  marked: boolean;
  refunded: boolean;
}

/**
 * Give up on a deck's evaluation: stamp `ai_failed_at` with the reason and give
 * the credit back.
 *
 * The refund is claimed with a conditional UPDATE on `ai_credit_refunded`, so
 * whichever caller wins the race does the refund and every other caller sees
 * `changes === 0` and does nothing. That matters because two independent paths
 * can reach this function for the same deck: a dead-letter delivery and the
 * cron sweep's attempt cap.
 */
export async function markEvalTerminal(
  env: Env,
  deckId: string,
  reason: string,
  now: () => string = () => new Date().toISOString(),
): Promise<TerminalResult> {
  const deck = await env.DB.prepare(
    "SELECT id, edition, status, ai_credit_refunded FROM decks WHERE id = ?",
  )
    .bind(deckId)
    .first<{ id: string; edition: string; status: string; ai_credit_refunded: number }>();
  // The deck was deleted (or already scored) — nothing to mark, nothing to refund.
  if (!deck || deck.status !== "pending_ai") return { marked: false, refunded: false };

  await env.DB.prepare("UPDATE decks SET ai_failed_at = ?, ai_error = ? WHERE id = ?")
    .bind(now(), reason, deckId)
    .run();

  const claim = await env.DB.prepare(
    "UPDATE decks SET ai_credit_refunded = 1 WHERE id = ? AND ai_credit_refunded = 0",
  )
    .bind(deckId)
    .run();
  const refunded = claim.meta.changes === 1;
  if (refunded) await refundCredits(env, deck.edition as Edition, 1);

  return { marked: true, refunded };
}

export interface StuckDeck {
  id: string;
  name: string;
  edition: string;
  attempts: number;
  createdAt: string;
}

export interface SweepResult {
  requeued: string[];
  failed: string[];
  refunded: number;
}

/**
 * Cron sweep: find decks parked at `pending_ai` past the grace period and either
 * re-drive them or declare them failed.
 *
 * Keyed on `created_at` rather than `updated_at` on purpose — nothing on the
 * failure path currently touches `updated_at`, so it would make an ancient
 * stranded deck look fresh. `ai_last_attempt_at` provides the second clock so a
 * deck the sweep just re-enqueued isn't picked up again on the next tick.
 */
export async function sweepStuckEvaluations(
  env: Env,
  opts: { now?: () => string; staleMinutes?: number; limit?: number } = {},
): Promise<SweepResult> {
  const now = opts.now ?? (() => new Date().toISOString());
  const staleMinutes = opts.staleMinutes ?? STUCK_AFTER_MINUTES;
  const cutoff = new Date(new Date(now()).getTime() - staleMinutes * 60_000).toISOString();

  // `datetime()` on BOTH sides, not a raw string compare. `decks.created_at`
  // defaults to SQLite's `datetime('now')` → "2026-08-12 19:10:00", while the
  // columns this module writes are ISO-8601 → "2026-08-12T19:10:00.000Z". A
  // space (0x20) sorts before "T" (0x54), so a plain `created_at <= ?` would
  // treat EVERY deck uploaded later on the cutoff's own date as already stale
  // and re-drive it while its first evaluation was still running.
  const rows = (
    await env.DB.prepare(
      "SELECT id, name, edition, ai_attempts AS attempts, created_at AS createdAt FROM decks " +
        "WHERE status = 'pending_ai' AND ai_failed_at IS NULL AND datetime(created_at) <= datetime(?) " +
        "AND (ai_last_attempt_at IS NULL OR datetime(ai_last_attempt_at) <= datetime(?)) " +
        "ORDER BY created_at ASC LIMIT ?",
    )
      .bind(cutoff, cutoff, opts.limit ?? 50)
      .all<StuckDeck>()
  ).results;

  const result: SweepResult = { requeued: [], failed: [], refunded: 0 };
  for (const deck of rows) {
    if (deck.attempts >= MAX_AI_ATTEMPTS) {
      const outcome = await markEvalTerminal(
        env,
        deck.id,
        `Gave up after ${deck.attempts} evaluation attempts`,
        now,
      );
      if (outcome.marked) result.failed.push(deck.id);
      if (outcome.refunded) result.refunded += 1;
      continue;
    }
    try {
      await env.EVAL_QUEUE.send({ deckId: deck.id });
      await env.DB.prepare(
        "UPDATE decks SET ai_attempts = ai_attempts + 1, ai_last_attempt_at = ? WHERE id = ?",
      )
        .bind(now(), deck.id)
        .run();
      result.requeued.push(deck.id);
    } catch (err) {
      console.error(`sweep could not re-enqueue ${deck.id}:`, err);
    }
  }
  return result;
}
