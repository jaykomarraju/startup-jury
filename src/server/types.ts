import type { Edition, Role } from "../shared/roles";

/** A per-deck AI-evaluation job carried on the EVAL_QUEUE. */
export interface EvalMessage {
  deckId: string;
}

export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  SESSIONS: KVNamespace;
  /** Pitch-deck PDFs (key `decks/<id>.pdf`) + exported reports. */
  DECKS: R2Bucket;
  /** Bulk-upload evaluation jobs consumed by `src/server/queue.ts`. */
  EVAL_QUEUE: Queue<EvalMessage>;
  /** Anthropic API key (set via `wrangler secret`); absent in tests (mocked). */
  ANTHROPIC_API_KEY?: string;
  /** Override the evaluation model (defaults to `claude-sonnet-5`). */
  ANTHROPIC_MODEL?: string;
}

/** The authenticated principal stored in the session and exposed on the context. */
export interface SessionUser {
  id: string;
  name: string;
  initials: string;
  role: Role;
  edition: Edition;
}

/** Hono environment for typed bindings + context variables. */
export type AppEnv = {
  Bindings: Env;
  Variables: { user: SessionUser };
};
