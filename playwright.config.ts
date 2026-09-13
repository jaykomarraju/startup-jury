import { defineConfig } from "@playwright/test";

// Defaults to 5173; override with E2E_PORT when that port is already in use.
const PORT = Number(process.env.E2E_PORT) || 5173;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // One vite+miniflare dev server backs the whole suite. Above ~4 browser
  // workers the local Worker runtime starts dropping requests ("fetch failed" /
  // ERR_ADDRESS_INVALID) and the tail of the run fails for reasons that have
  // nothing to do with the app. Two workers is both reliable and faster than the
  // default, because nothing burns a 30s timeout.
  workers: 2,
  forbidOnly: !!process.env.CI,
  // `W5-A`'s measurement, applied at Wave 5 integration (§8 Q28 / Q32). The
  // failures this suite produces locally are not assertion failures: the dev
  // server itself dies mid-run with `[vite] Internal server error: Network
  // connection lost` out of miniflare's runner-worker, and every test after it
  // fails for a reason that has nothing to do with the app. A sibling
  // Playwright stack makes that near-certain but is not required for it.
  // One retry is the cheapest honest mitigation: a genuinely broken test still
  // fails twice, and a dropped connection is reported as `flaky` rather than
  // `failed`, which keeps the instability VISIBLE and countable instead of
  // either fatal or hidden.
  retries: 1,
  reporter: process.env.CI ? "list" : "html",
  use: { baseURL, trace: "on-first-retry" },
  webServer: {
    // Seed the local D1 (Phase 1 migrations) BEFORE the dev server boots, so the
    // browser login flows have the demo users. Playwright starts webServer before
    // any globalSetup, so seeding must happen here, in-command, not in a hook.
    command: "npm run e2e:serve",
    url: baseURL,
    // `W6-C` found this the hard way in Wave 6 (memory + §9). With
    // `reuseExistingServer` on, a run that finds ANY server already listening on
    // its port silently adopts it — a sibling session's server, serving a
    // sibling's CODE against a sibling's MUTATED database. The result is not a
    // crash; it is a green run that proved nothing, or a red one blaming your
    // branch for someone else's state. `e2e:serve` wipes and re-migrates on
    // start, so a fresh server per run is also the only way the seed is clean —
    // which is `W0`'s recorded "e2e on a dirty seed" trap, same root cause.
    // The cost is one server boot per run; correctness is worth more.
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
