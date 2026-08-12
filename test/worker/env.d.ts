/// <reference types="@cloudflare/vitest-pool-workers/types" />

// `env` from "cloudflare:test" is typed as `Cloudflare.Env`. Declare that
// namespace with our bindings (from wrangler.jsonc) plus the test-only
// TEST_MIGRATIONS binding. Avoids committing the large generated
// worker-configuration.d.ts and keeps typecheck self-contained.
declare namespace Cloudflare {
  interface Env {
    ASSETS: Fetcher;
    DB: D1Database;
    SESSIONS: KVNamespace;
    DECKS: R2Bucket;
    EVAL_QUEUE: Queue<import("../../src/server/types").EvalMessage>;
    ANTHROPIC_API_KEY?: string;
    ANTHROPIC_MODEL?: string;
    // Cloudflare Email Sending. Miniflare has no emulator for the send_email
    // binding, so EMAIL is effectively absent in tests and `sendEmail` takes its
    // audit-only path — which is exactly what the outbox assertions exercise.
    EMAIL?: import("../../src/server/email/outbox").EmailSender;
    EMAIL_FROM?: string;
    EMAIL_FROM_NAME?: string;
    EMAIL_REPLY_TO?: string;
    APP_BASE_URL?: string;
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
    // Flag-gated live Anthropic smoke test (evaluate.live.test.ts) only.
    LIVE_ANTHROPIC?: string;
    LIVE_ANTHROPIC_KEY?: string;
  }
}
