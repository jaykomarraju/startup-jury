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
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
    // Flag-gated live Anthropic smoke test (evaluate.live.test.ts) only.
    LIVE_ANTHROPIC?: string;
    LIVE_ANTHROPIC_KEY?: string;
  }
}
