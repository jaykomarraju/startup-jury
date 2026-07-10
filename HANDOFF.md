# HANDOFF — ai.STARTUPJURY

Single source of truth for resuming this build in a new/compacted session. Read this +
the plan at `~/.claude/plans/ok-do-we-need-goofy-barto.md` + `git log`.

---

## Status

- **Complete:** Phase 0 — Scaffold & CI · Phase 1 — Data & auth.
- **Next:** Phase 2 — Design system & app shell (Tailwind brand tokens, fonts, logo assets;
  shared components; role-based sidebar + route guards; real login → launcher → role landing).
  Start with the **visual mockup review gate**: render each role's prototype HTML from
  `STARTUPJURY-TEAM-FOLDER` and match it.
- **Workflow:** commit directly to `main`, no PRs. Green gate (typecheck+lint+tests+build)
  before each push. Node 22 (`nvm use`).

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

## Phase 1 — Data & auth (shipped)

- **Domain model** (`src/shared/roles.ts`): `Edition`, incubator/VC `Role` unions, labels,
  helpers. **Pipeline** (`src/pipeline/`): typed state machine, `incubator.ts` + `vc.ts`
  configs from the flow diagrams, engine (`getPipeline`, `allowedTransitions`,
  `canTransition`, `performAction`) with role-gated transitions + terminal/unknown handling.
- **Database** (`migrations/0001_init.sql`): full schema — users, org_settings, parameters,
  rubric_anchors, decks, deck_extractions, scores, evaluations, pipeline_events, queries,
  calls, investment_dd, ic_votes, term_sheets, legal_dd, portfolio, tickets, messages.
  `0002_seed.sql`: 13 core weighted params per edition, anchors, thresholds, 12 demo users,
  7 demo decks. Dev password for all seed users: **`demo1234`**.
- **Auth** (`src/server/auth/`): `password.ts` (PBKDF2-HMAC-SHA256, constant-time verify),
  `session.ts` (KV sessions, 7-day TTL, cookie `sj_session`), `middleware.ts`
  (`requireAuth`, `requireRole(...)` with superuser bypass). Routes `src/server/routes/auth.ts`
  (`POST /api/auth/login|logout`, `GET /api/auth/me`). Shared `src/server/types.ts`
  (`Env`, `AppEnv`, `SessionUser`); `src/server/db.ts` user queries.
- **Bindings:** D1 `DB` + KV `SESSIONS` in `wrangler.jsonc` (ids are `local-dev-placeholder`
  — replaced with real created resources in Phase 8).
- **Tests (29 total):** unit — scoring + pipeline structural/role-matrix; worker — health,
  404, full auth + role-gate flow. Worker tests apply migrations to isolated local D1 via
  `test/worker/apply-migrations.ts` (migrations read in `vitest.worker.config.ts`).

### Phase 1 gotchas
- **Test env typing:** `env` from `cloudflare:test` is `Cloudflare.Env`. We declare that
  namespace in `test/worker/env.d.ts` (bindings + `TEST_MIGRATIONS`) instead of committing
  the large generated `worker-configuration.d.ts` (still gitignored). If you add bindings,
  update that declaration (or `npm run cf-typegen` locally, but don't commit it).
- **Session staleness:** sessions cache `role`/`edition` in KV; a role change won't take
  effect until the 7-day session expires. Revisit if roles become editable.
- **Local D1:** apply migrations for manual dev with
  `npx wrangler d1 migrations apply startup-jury-db --local`.

## Resume here (Phase 2)

Run the visual mockup review gate, then build the design system (Tailwind brand tokens from
`startupjury_brand_guidelines.docx`: amber #E8A020, navy #1A1E2E, off-white #F5F7F2, military
green #3B4A3F, deep green #4A6644; DM Sans UI / DM Mono scores), shared components, and the
role-based app shell (sidebar nav derived from the permission matrix + route guards) wired to
`/api/auth`. **Acceptance:** each role logs in and sees only its permitted nav (Playwright
e2e asserts against the matrix); component unit tests pass. Commit directly to `main`.
