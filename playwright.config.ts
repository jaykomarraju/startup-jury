import { defineConfig } from "@playwright/test";

const PORT = 5173;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : "html",
  use: { baseURL, trace: "on-first-retry" },
  webServer: {
    // Seed the local D1 (Phase 1 migrations) BEFORE the dev server boots, so the
    // browser login flows have the demo users. Playwright starts webServer before
    // any globalSetup, so seeding must happen here, in-command, not in a hook.
    command: "npm run e2e:serve",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
