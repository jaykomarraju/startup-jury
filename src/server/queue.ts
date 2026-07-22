// Queue consumer: runs one AI evaluation per enqueued deck (bulk-upload path).
// A failed message retries per the wrangler `max_retries`; a message whose deck
// no longer exists is acked (nothing to retry).

import type { Env, EvalMessage } from "./types";
import { evaluateDeck } from "./ai/evaluate";

/** Per-deck evaluator seam so the batch loop can be unit-tested in isolation. */
export type Evaluator = (env: Env, deckId: string) => Promise<unknown>;

export async function handleQueue(
  batch: MessageBatch<EvalMessage>,
  env: Env,
  evaluate: Evaluator = evaluateDeck,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await evaluate(env, message.body.deckId);
      message.ack();
    } catch (err) {
      console.error(`evaluation failed for deck ${message.body.deckId}:`, err);
      message.retry();
    }
  }
}
