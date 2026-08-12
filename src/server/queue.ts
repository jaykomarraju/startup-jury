// Queue consumer: runs one AI evaluation per enqueued deck (bulk-upload path,
// plus the single-upload and re-upload fallbacks and the cron re-drive).
//
// Session 7 added the **dead-letter queue**. Before it, a message that exhausted
// `max_retries` was silently dropped: the deck stayed at `pending_ai` forever
// with the credit spent and no reason recorded anywhere (FINISH-PLAN §9). Now the
// exhausted message lands on `startup-jury-evals-dlq`, which the same `queue()`
// handler serves — `batch.queue` is what tells the two apart — and the deck is
// marked failed with its reason, with the credit returned exactly once.

import type { Env, EvalMessage } from "./types";
import { evaluateDeck } from "./ai/evaluate";
import { markEvalTerminal, recordEvalFailure, summariseError } from "./ai/health";

/** Per-deck evaluator seam so the batch loop can be unit-tested in isolation. */
export type Evaluator = (env: Env, deckId: string) => Promise<unknown>;

/** Queue name carrying messages that exhausted their retries. */
export const DLQ_NAME = "startup-jury-evals-dlq";

export async function handleQueue(
  batch: MessageBatch<EvalMessage>,
  env: Env,
  evaluate: Evaluator = evaluateDeck,
): Promise<void> {
  if (batch.queue === DLQ_NAME) return handleDeadLetter(batch, env);

  for (const message of batch.messages) {
    const deckId = message.body.deckId;
    try {
      // `evaluateDeck` clears the deck's failure state as part of its own
      // success batch, so a recovered deck needs nothing extra here.
      await evaluate(env, deckId);
      message.ack();
    } catch (err) {
      console.error(`evaluation failed for deck ${deckId}:`, err);
      // Persist the reason before retrying: if this is the attempt that
      // exhausts `max_retries`, the dead-letter handler and the decks table
      // both need to know WHY, and the exception object won't survive.
      await recordEvalFailure(env, deckId, err);
      message.retry();
    }
  }
}

/**
 * Terminal handler. A message only gets here after `max_retries` real attempts,
 * so there is nothing left to try: mark the deck failed, refund its credit, and
 * ack so the message doesn't circulate. Acking is deliberate — the deck row is
 * now the durable record of the failure and the "Re-run AI" action (or a config
 * fix plus the cron sweep) is how it gets picked back up.
 */
async function handleDeadLetter(batch: MessageBatch<EvalMessage>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    const deckId = message.body?.deckId;
    if (!deckId) {
      message.ack();
      continue;
    }
    try {
      const deck = await env.DB.prepare("SELECT ai_error FROM decks WHERE id = ?")
        .bind(deckId)
        .first<{ ai_error: string | null }>();
      const reason = deck?.ai_error ?? "AI evaluation failed after all retries";
      const { marked, refunded } = await markEvalTerminal(env, deckId, reason);
      console.error(
        `dead-lettered evaluation for deck ${deckId}: ${reason} (marked=${marked}, refunded=${refunded})`,
      );
    } catch (err) {
      console.error(`dead-letter handling failed for deck ${deckId}: ${summariseError(err)}`);
    }
    message.ack();
  }
}
