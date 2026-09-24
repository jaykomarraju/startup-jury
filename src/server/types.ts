import type { Edition, Role } from "../shared/roles";
import type { EmailSender } from "./email/outbox";
import type { PermissionContext } from "./auth/permissions";

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
  /**
   * JURYbuddy help clips (key `help/clips/<clipId>.mp4`), V3 item 15. A SEPARATE
   * bucket from `DECKS` on purpose: these are product media any authenticated
   * user may stream, while `DECKS` holds tenant-confidential PDFs behind a
   * per-deck authorisation check. Sharing one bucket would put a
   * read-for-everyone path on the same keyspace as that data.
   *
   * OPTIONAL because the bucket is created out-of-band (see wrangler.jsonc) and
   * the clips are uploaded by hand: `GET /api/help/clips/:clipId` answers 404
   * when the binding or the object is missing, and the Help screen then shows
   * the answer text with no player. A forgotten bucket is a missing video,
   * never a broken screen.
   */
  HELP_MEDIA?: R2Bucket;
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
  /**
   * The ai.STARTUPJURY operators who own the PRICE CATALOGUE — a comma-separated
   * list of email addresses, matched case-insensitively against the session.
   *
   * A deployment-level var rather than a role, because the role it wants does
   * not exist yet: the schema is single-tenant (`0001_init.sql:1`) and
   * `roles.ts` tops out at `superuser` INSIDE the customer's workspace. The
   * client confirmed on 24-Sep that AISJ Admin is coming and that pricing
   * "has to be in AISJ Admin control, NOT the client admin"; this is the
   * interim that stops a customer editing the vendor's catalogue in the
   * meantime, and it is replaced by the real principal when tenancy lands.
   *
   * EMPTY is the safe default: nobody may edit the catalogue, and the published
   * catalogue stays readable. A misconfigured deployment therefore fails
   * CLOSED, which is the correct direction for a surface that prices the whole
   * product.
   */
  PLATFORM_OWNER_EMAILS?: string;
}

/** The authenticated principal stored in the session and exposed on the context. */
export interface SessionUser {
  id: string;
  name: string;
  initials: string;
  role: Role;
  edition: Edition;
  /**
   * Organizational ALIAS title shown in the top ribbon instead of the platform
   * role label (Aug-2026 issue 1). Presentation only — `role` still drives every
   * permission check. Undefined = fall back to the role label.
   */
  title?: string;
}

/** Hono environment for typed bindings + context variables. */
export type AppEnv = {
  Bindings: Env;
  /**
   * `perms` is the request-scoped permission resolver (W3-A). `requireAuth`
   * sets both, so any middleware or handler that runs after it may use either.
   */
  Variables: { user: SessionUser; perms: PermissionContext };
};
