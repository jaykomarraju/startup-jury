# HANDOFF — ai.STARTUPJURY

Single source of truth for resuming this build in a new/compacted session. Read this +
the plan at `~/.claude/plans/ok-do-we-need-goofy-barto.md` + `git log`.

---

## Status

- **Complete:** Phase 0 — Scaffold & CI.
- **Next:** Phase 1 — Data & auth (D1 schema + migrations, seed rubric/params/demo, auth +
  KV sessions + `requireRole`, `src/shared` role/stage/parameter types, `src/pipeline`
  state-machine configs — no UI yet).
- **Branch:** `phase-0-scaffold` (PR into `main`).

## Environment (important)

- **Node 22 is required** (`@cloudflare/vite-plugin` + Vite 8 use `node:module.registerHooks`,
  added in Node 22). Node 20 fails the build. `.nvmrc` pins `22`.
- To work locally: `nvm use` (installs via `nvm install 22` if missing). CI uses Node 22.
- Wrangler CLI is authenticated with the user's Cloudflare account (deploys allowed; prod
  deploy is confirmed with the user first).
- No Cloudflare MCP server; use the `wrangler` CLI. Cloudflare skills are installed.

## What shipped (Phase 0)

- **Full-stack single-Worker app**: Cloudflare Vite plugin builds the Worker + React SPA
  together; local dev runs bindings via Miniflare.
  - `src/server/index.ts` — Hono app. `GET /api/health` returns `{status:"ok",service:...}`.
    Catch-all `app.all("*")` forwards to `env.ASSETS.fetch` (SPA fallback via
    `not_found_handling: single-page-application`).
  - `src/client/` — React 19 SPA (`main.tsx`, `App.tsx` fetches `/api/health`, `index.css`
    with brand color CSS vars as a placeholder — real design system is Phase 2).
  - `src/shared/scoring.ts` — `weightedTotal()` + `signalTag()`: the seed of the rubric
    scoring logic (weight-average 0–10, rounded 2dp; 8/5/2 anchor bands).
- **Config:** `wrangler.jsonc` (name `startup-jury`, main = worker, ASSETS binding, SPA
  not-found, observability, compat date 2026-07-09, `nodejs_compat`). `vite.config.ts`
  (react + cloudflare plugins).
- **TypeScript:** split by runtime to avoid lib conflicts — `tsconfig.json` (client/DOM),
  `tsconfig.worker.json` (workers-types), `tsconfig.node.json` (tooling). `typecheck`
  runs all three.
- **Tests (3 tiers, all green):**
  - Unit (Vitest, node) — `test/unit/scoring.test.ts` (4 tests). Config `vitest.unit.config.ts`.
  - Worker integration (`@cloudflare/vitest-pool-workers`) — `test/worker/health.test.ts`
    uses `SELF.fetch`. Config `vitest.worker.config.ts`.
  - E2E (Playwright) — `e2e/home.spec.ts` boots `npm run dev`, asserts page + healthy API.
  - `vitest.config.ts` runs both Vitest projects; `npm test` = both.
- **CI:** `.github/workflows/ci.yml` (Node 22) → `npm ci`, typecheck, lint, `npm test`,
  build, playwright chromium, e2e.
- **Lint:** flat ESLint (`eslint.config.js`) with typescript-eslint recommended.

## Key versions (July 2026)

React 19, Vite 8, Hono 4, Vitest 4, TypeScript 6, ESLint 10, wrangler 4,
`@cloudflare/vitest-pool-workers` 0.18, `@cloudflare/vite-plugin` 1.44.

## Gotchas / notes for next session

- **vitest-pool-workers v0.18 API changed** (Vitest 4): no `defineWorkersConfig`. Use the
  `cloudflareTest({ wrangler: { configPath } })` **Vite plugin** in `plugins` — it resolves
  the `cloudflare:test` module and wires the pool. (`cloudflarePool` exists but the plugin is
  the supported path.)
- `cloudflare:test` types need `/// <reference types="@cloudflare/vitest-pool-workers/types" />`
  — see `test/worker/env.d.ts`.
- `worker-configuration.d.ts` (from `wrangler types`) is gitignored; Phase 0 code defines its
  own inline `Env`. When bindings grow (Phase 1+), run `npm run cf-typegen` and consider
  importing the generated `Env`.
- No bindings yet (D1/R2/KV/Queue) — added in Phase 1+ to `wrangler.jsonc`.

## How to run / test

```bash
nvm use                 # Node 22
npm install
npm run dev             # http://localhost:5173 (SPA + /api/*)
npm run typecheck       # all three tsconfigs
npm run lint
npm test                # unit + worker
npm run build
npm run test:e2e        # Playwright (auto-starts dev server)
```

## Resume here (Phase 1)

Build D1 schema + migrations and seed data; auth with KV sessions and `requireRole`
middleware; `src/shared` types for roles/stages/parameters; `src/pipeline` incubator + VC
state-machine configs. **Acceptance:** migrations apply clean; pipeline transition-matrix
unit tests (legal/illegal transitions per role, both editions) and auth middleware tests
pass. Start on branch `phase-1-data-auth`.
