import { defineConfig } from "vitest/config";

// Two projects: pure logic runs in Node; Worker integration runs inside workerd
// via @cloudflare/vitest-pool-workers with real local bindings.
export default defineConfig({
  test: {
    projects: [
      "vitest.unit.config.ts",
      "vitest.worker.config.ts",
      "vitest.client.config.ts",
    ],
  },
});
