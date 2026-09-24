import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";

// Read D1 migrations at config time and hand them to the test worker as a
// binding; the setup file applies them to the isolated local D1 before tests.
const migrations = await readD1Migrations(
  fileURLToPath(new URL("./migrations", import.meta.url)),
);

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: migrations,
          // Forwarded to the flag-gated live Anthropic smoke test only. Named
          // distinctly from ANTHROPIC_API_KEY so the app binding stays unset.
          LIVE_ANTHROPIC: process.env.LIVE_ANTHROPIC ?? "",
          LIVE_ANTHROPIC_KEY: process.env.ANTHROPIC_API_KEY ?? "",
          // The price catalogue is a PLATFORM-OWNER surface and the router now
          // fails closed without this (`routes/pricing.ts`). The seeded
          // incubator superuser stands in for the AISJ Admin principal that
          // arrives with multi-tenancy, so the existing pricing suites keep
          // exercising the editor. `pricing-owner.test.ts` pins the gate
          // itself, including that an empty value locks everyone out.
          PLATFORM_OWNER_EMAILS: "nisha.kapoor@demo.startupjury.ai",
        },
      },
    }),
  ],
  test: {
    name: "worker",
    // §8 Q32, answered by `W5-A` and applied at Wave 5 integration. Vitest's 5 s
    // default assumes a machine doing nothing else, which no machine in this
    // programme has been: at ambient load 60-90 the suite failed 30-38 tests
    // across 20+ files that the run before had passed, every one of them
    // `Test timed out in 5000ms`, and every one green when re-run alone.
    // `--no-file-parallelism` did not help, which rules out cross-file
    // interference and leaves the clock. With the budget raised and no
    // assertion touched, the same tree was 1321/1321 in 99 s at load 61.
    // This weakens nothing — a test needing 6 s on a busy box is not failing,
    // and a genuinely hung one still fails, 25 s later.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ["test/worker/**/*.test.ts"],
    setupFiles: ["test/worker/apply-migrations.ts"],
  },
});
