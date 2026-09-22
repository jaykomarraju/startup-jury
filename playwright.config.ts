import { defineConfig } from "@playwright/test";

// Defaults to 5173; override with E2E_PORT when that port is already in use.
const PORT = Number(process.env.E2E_PORT) || 5173;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // One vite+miniflare dev server backs the whole suite, and the worker count
  // is a RATE limiter on a fixed OS resource, not a concurrency fix.
  //
  // Measured at the 21-Sep wave integration (plan §12.9). `miniflare`'s
  // `DispatchFetchDispatcher.dispatch()` sets undici's `options.reset = true`,
  // which sends `connection: close` and tears the socket down after every
  // response — defeating the connection `Pool` miniflare itself built. So each
  // request the Cloudflare vite plugin proxies to workerd costs ~2 fresh TCP
  // sockets. This suite drives ~16,600 requests in ~42s (most of them `/src/*`,
  // because every test gets an empty browser cache and vite dev serves
  // unbundled modules), against a macOS ephemeral range of 16,384 ports with a
  // 30s TIME_WAIT. The range saturates ~25-30s in and `connect()` then fails
  // with EADDRNOTAVAIL — which surfaces as "fetch failed".
  //
  // Fewer workers only slows the request RATE enough to squeak under the
  // ceiling (measured: `--workers=1` peaks at 15,684 of 16,384, i.e. 95.7%).
  // That is why this number is 2 and why raising it reddens the tail.
  workers: 2,
  forbidOnly: !!process.env.CI,
  // `W5-A`'s measurement, applied at Wave 5 integration (§8 Q28 / Q32), with
  // its DIAGNOSIS corrected at the 21-Sep wave integration.
  //
  // The failures this suite produces locally are not assertion failures. But
  // the dev server does NOT die mid-run, which is what this comment used to
  // say: a 0.5s PID sampler showed one stable workerd for the whole run, with
  // no restart, reload or OOM in the logs. It stays up and cannot open sockets
  // — see the `workers` note above for the mechanism.
  //
  // One retry is the cheapest honest mitigation: a genuinely broken test still
  // fails twice, and an exhausted port range is reported as `flaky` rather than
  // `failed`, which keeps the instability VISIBLE and countable instead of
  // either fatal or hidden. It is a mitigation, not the fix; the fix is the
  // one-line upstream change recorded in plan §12.9.
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
