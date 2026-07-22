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
        },
      },
    }),
  ],
  test: {
    name: "worker",
    include: ["test/worker/**/*.test.ts"],
    setupFiles: ["test/worker/apply-migrations.ts"],
  },
});
