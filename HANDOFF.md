# HANDOFF — ai.STARTUPJURY

Single source of truth for resuming this build in a new/compacted session. Read this +
the full plan at `docs/PLAN.md` + `git log`.

---

## Status

- **Complete:** Phase 0 — Scaffold & CI · Phase 1 — Data & auth · Phase 2 — Design system & app shell.
- **Next:** Phase 3 — Upload & AI evaluation (R2 upload single/bulk, Queue consumer,
  `ai/evaluate.ts` Claude PDF→structured extraction+scores, `score > 5` gate, Review-decks +
  Evaluation-report screens). See **Resume here (Phase 3)** at the bottom.
- **Workflow:** commit directly to `main`, no PRs. Green gate (typecheck+lint+tests+build,
  plus `test:e2e` for UI) before each push. Node 22 (`nvm use`).

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

## Phase 2 — Design system & app shell (shipped)

- **Deps added:** `react-router-dom` v7; Tailwind v4 (`@tailwindcss/vite`, CSS-first tokens);
  self-hosted `@fontsource-variable/dm-sans` + `@fontsource/dm-mono`; `lucide-react`;
  `@testing-library/react`+`jsdom` (client test tier). **Toolchain aligned:** `wrangler`
  4.86→4.113 and `@cloudflare/workers-types` 4→5 so the standalone CLI and the vite-plugin's
  bundled wrangler agree on local D1/DO state (see gotcha below).
- **Design system** (`src/client/index.css` + `theme/`): Tailwind `@theme` fixed brand palette +
  semantic light/dark runtime tokens (`bg/surface/line/fg/topbar/sidebar/accent/positive`) via
  `@theme inline`; `data-theme="dark"` variant; uppercase `.u-label`; signal hues.
  `ThemeProvider`/`useTheme` (persisted to `localStorage`, respects `prefers-color-scheme`).
  `theme/signals.ts` maps `SignalTag`+`flagged` → pill/color classes.
- **Components** (`src/client/components/`, all prop-driven, theme-aware, unit-tested):
  `Logo` (inline-SVG radar + wordmark), `Button/Card/Badge/EmptyState`, `KpiTile`, `SignalTag`,
  `DeckCard`/`DeckRow`(+`secondary` col)+`ScoreChip`, `ScoreBar(s)` (weighted-total via
  `shared/scoring`), `EvaluationDrawer` (report slide-over), `Sidebar`/`Topbar`/`AppShell`,
  `icons.tsx` (lucide registry for nav icon names).
- **Nav model** (`src/shared/nav.ts`): typed `NavItem` manifest per edition +
  `navForUser/canAccessNav/navLabel/landingNavId`. Derived from the two Superuser mockups,
  trimmed per the incubator role×stage matrix and VC pipeline role-gating; **founder** isolated
  to a `portal` set; jury-personal items marked `exclusive` (no superuser bypass, keeps the
  superuser superset at 20). `canSeeNav` mirrors `requireRole`'s superuser bypass.
- **Shell/routing** (`src/client/`): `main.tsx` wraps `ThemeProvider`→`AuthProvider`→
  `BrowserRouter`. `auth/AuthProvider`+`useAuth` (cookie-session: `/api/auth/me` on mount,
  `login`, `logout`). Routes: `/login` (branded, seed-login hints), `/app` (RequireAuth) →
  index redirect to role landing, `/app/:navId` (RequireNav) → `DashboardPage` for `alldecks`
  else `StubPage`. Guards `RequireAuth`/`RequireNav` mirror server authZ.
- **Dashboard** (`routes/DashboardPage.tsx`): edition-aware role landing (KPI row, deck table,
  edition-specific pipeline-progress + cohort-thresholds rail, EvaluationDrawer) with
  **placeholder data** — live decks API arrives in Phase 3.
- **Tests (49 unit/worker/client + 16 e2e):** `test/unit/nav.test.ts` (matrix + pipeline
  cross-checks), `test/client/*` (components + ThemeProvider), `e2e/nav.spec.ts` (all 12 seed
  roles log in via UI and the sidebar equals `navForUser`; forbidden deep-link guarded; founder
  isolated).

### Phase 2 gotchas
- **Two wranglers → local-state skew.** The `@cloudflare/vite-plugin` bundles its own
  `wrangler` (was 4.110 vs the repo's 4.86). Different versions write incompatible
  `.wrangler/state` (D1/DO) — symptoms were `table _cf_ALARM has 3 columns but 2 values`
  crashes and a silently-empty seed DB. Fixed by bumping the repo's `wrangler` (and
  `workers-types`) to match. If this recurs after a plugin bump, realign versions.
- **Playwright seeds D1 in the webServer command, not a hook.** Playwright starts `webServer`
  **before** `globalSetup`, so migrating in a hook is too late (dev server boots on an empty DB).
  `e2e:serve` = `rm -rf .wrangler/state && db:migrate:local && dev` guarantees seed-before-serve.
  Note: a cold local `npm run test:e2e` wipes local `.wrangler/state`; devs with a running dev
  server are unaffected (`reuseExistingServer`).
- **Fonts self-host** as woff2 via `@fontsource` CSS imports (no runtime CDN). Logo PNGs bundled
  in `src/client/assets/`; favicon is `public/favicon.png`. Brand doc names SVGs but only PNGs
  exist in the team folder — the `Logo` component uses an inline SVG for the header mark.
- **Local dev DB:** `npm run db:migrate:local` (applies Phase 1 migrations to local D1). If
  workerd/vite processes are orphaned on port 5173, `pkill -f workerd` then re-run.

## Resume here (Phase 3)

Build **Upload & AI evaluation**. Add R2 upload (single + bulk) and a Queue consumer; write
`src/server/ai/evaluate.ts` — build the extraction+scoring prompt from `parameters` +
`rubric_anchors` + org system-prompt override, send the R2 PDF as a Claude `document` block
(model `claude-sonnet-5`; consult the **`claude-api`** skill for request shape + PDF handling),
parse structured JSON into `deck_extractions` + AI `scores`, and apply the **`score > 5` gate**.
Wire `src/server/queue.ts` (per-deck consumer) and the single-upload direct path. Add R2 + Queue
bindings to `wrangler.jsonc`; `ANTHROPIC_API_KEY` via `wrangler secret` (Phase 8 for prod).
Build the **Review-decks** and **Evaluation-report** screens against the live model — the
Phase 2 `DashboardPage` deck table + `EvaluationDrawer` are the presentational shells to fill
with real extraction + per-parameter scores (replace the placeholder data blocks).
**Tests:** `evaluate.ts` with a **mocked Anthropic response** (deterministic) — parsing, gate,
DB writes; Worker integration test of upload→queue→stage transition; one live-API smoke test
behind a flag using a real sample PDF. **Acceptance:** a PDF upload flows R2 → (queue) →
Claude structured scores → correct stage per the `>5` gate → Evaluation report renders. Commit
directly to `main`; run the green gate + `/code-review` before pushing.
