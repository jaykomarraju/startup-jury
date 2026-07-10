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
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  }
}
