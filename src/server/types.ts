import type { Edition, Role } from "../shared/roles";
import type { EmailSender } from "./email/outbox";

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
  /**
   * Cloudflare Email Sending (`send_email` binding). Optional: absent in tests
   * and in any deployment whose sending domain isn't onboarded yet, in which
   * case `email/outbox.ts` records the message with status='recorded' instead of
   * delivering it. Miniflare has no local emulator for this binding.
   */
  EMAIL?: EmailSender;
  /** Verified From address, e.g. `no-reply@yourdomain.com`. No send without it. */
  EMAIL_FROM?: string;
  /** Display name on the From header (defaults to "ai.STARTUPJURY"). */
  EMAIL_FROM_NAME?: string;
  /** Optional Reply-To, so founder replies reach a real inbox. */
  EMAIL_REPLY_TO?: string;
  /** Public origin used to build tokenized founder links in outbound email. */
  APP_BASE_URL?: string;
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
