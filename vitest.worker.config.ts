import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

// Vitest 4: the cloudflareTest plugin resolves the `cloudflare:test` module and
// wires the Workers pool (running tests inside workerd with local bindings).
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
  test: {
    name: "worker",
    include: ["test/worker/**/*.test.ts"],
  },
});
