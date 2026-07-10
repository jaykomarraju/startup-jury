import { applyD1Migrations, env } from "cloudflare:test";

// Applied to each test's isolated D1 snapshot before any test runs.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
