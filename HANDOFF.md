# HANDOFF — ai.STARTUPJURY

Single source of truth for resuming this build in a new/compacted session. Read this +
the full plan at `docs/PLAN.md` + `git log`.

---

## Status

- **Complete:** Phase 0 — Scaffold & CI · Phase 1 — Data & auth · Phase 2 — Design system & app shell ·
  Phase 3 — Upload & AI evaluation.
- **Live demo:** deployed to Cloudflare — **https://startup-jury.jay-komarraju.workers.dev**
  (remote D1 + KV + **R2 + Queue**, seeded demo logins, password `demo1234`). Viewer guide: `docs/DEMO.md`.
  See **Live demo & deploy** below. Keep it current: **redeploy at each phase boundary.**
- **Next:** Phase 4 — Incubator pipeline (assign → jury eval → shortlist → intro → signup →
  onboard/archive; founder query loop + stubbed email; incubator role dashboards/nav).
  See **Resume here (Phase 4)** at the bottom.
- **⚠️ One open item:** the live demo's `ANTHROPIC_API_KEY` secret. Uploads store to R2 + enqueue,
  but **live AI scoring stays pending until the secret is set** (see **Live demo & deploy**). The user
  approved setting it ("Set it now, spend OK"); if it's not yet set, run
  `wrangler secret put ANTHROPIC_API_KEY` and the flag-gated live smoke test.
- **Workflow:** commit directly to `main`, no PRs. Green gate (typecheck+lint+tests+build,
  plus `test:e2e` for UI) before each push. Node 22 (`nvm use`).

## Live demo & deploy

- **URL:** https://startup-jury.jay-komarraju.workers.dev · **account:** jay.komarraju@gmail.com
  (`wrangler` already authenticated).
- **Provisioned (remote):** D1 `startup-jury-db` (id `6353d3a9-e2f0-459a-9acc-411373197232`),
  KV `SESSIONS` (id `a6b70566774d4f03900a05c5c77f1365`), **R2 bucket `startup-jury-decks`**, and
  **Queue `startup-jury-evals`** (id `a8e8467445f0456eadceacabc71f5b37`, producer+consumer). Bindings
  in `wrangler.jsonc`. The account is on **Workers Paid** (queue consumers deploy fine).
- **Secret:** `ANTHROPIC_API_KEY` — set with `wrangler secret put ANTHROPIC_API_KEY` (Anthropic
  console key). **Until set, single-upload returns 202 "pending" and bulk decks sit at `pending_ai`.**
  No redeploy needed after setting a secret — it applies to the running Worker immediately.
  **Not yet provisioned:** Cron (Phase 7).
- **Redeploy after each phase** (post-green-gate): `npm run build && npx wrangler deploy`; if
  the phase added migrations, first `npx wrangler d1 migrations apply startup-jury-db --remote`.
  Then smoke-test the live URL (`/api/health`, a login). `wrangler.jsonc` is the source of truth
  for bindings — the vite build emits a redirected config the CLI deploys.
- **Demo is public** with shared seed logins — fine for a preview, but a real launch must gate
  it / remove demo accounts (tracked in Phase 8).

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
- **Pin `wrangler` to EXACTLY the vite-plugin's bundled version (`4.110.0`).** The
  `@cloudflare/vite-plugin` bundles its own `wrangler`; a version mismatch with the repo's
  top-level `wrangler` breaks two ways: (1) different versions write incompatible
  `.wrangler/state` (D1/DO) — `table _cf_ALARM has 3 columns but 2 values` crashes + silently
  empty seed DB (seen with 4.86 vs 4.110); (2) going **above** the plugin (4.113) makes
  `wrangler deploy` reject the plugin-generated build config (`legacy_env` field removed in
  4.113). Fix = pin the exact bundled version (`"wrangler": "4.110.0"`, `--save-exact`) so npm
  hoists a single copy (`workers-types` v5 is its optional peer). If the plugin bumps its
  bundle later, re-pin to match; check with
  `node -e "require('./node_modules/@cloudflare/vite-plugin/node_modules/wrangler/package.json')"`
  (absent path = unified/hoisted).
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

## Phase 3 — Upload & AI evaluation (shipped)

- **Infra:** R2 bucket `DECKS` + Queue `EVAL_QUEUE` (producer+consumer) in `wrangler.jsonc`;
  provisioned remote (see **Live demo & deploy**). `Env` (`src/server/types.ts`) gains `DECKS`,
  `EVAL_QUEUE`, optional `ANTHROPIC_API_KEY` + `ANTHROPIC_MODEL`. Migration `0003` adds
  `decks.founder` (AI-extracted on upload).
- **AI evaluation** (`src/server/ai/evaluate.ts`): pure builders (`buildTool` — a forced
  `submit_evaluation` tool whose `key` enum is the edition's parameter keys; `buildSystemPrompt`
  with org `ai_system_prompt` override; `buildUserPrompt` = rubric + anchor bands), `parseEvaluation`
  (validate/clamp/dedupe against known keys), `computeResult` (**weighted total over the FULL rubric
  weight — an unscored param counts 0 so a partial response can't inflate past the `>5` gate**;
  `!complete` **or** zero scores → `incomplete`/`flagged`; pass → `ai_evaluated` (inc) /
  `analyst_scoring` (vc); fail → `rejected` (inc) / `archived` (vc)). `callAnthropic` = raw `fetch`
  to `/v1/messages`, `claude-sonnet-5`, `thinking:disabled`, PDF as base64 `document` block, forced
  `tool_choice`. `evaluateDeck(env, deckId, { callModel? })` loads deck+params+anchors+org, reads the
  R2 PDF, calls the model (injectable seam for tests), then D1-batches: delete+insert
  `deck_extractions` + AI `scores` (`evaluator_kind='ai'`) + an `evaluations` roll-up, updates the
  deck (`ai_score`/`signal`/`status`/`founder`/`complete`), appends a `pipeline_events` audit row.
  **Idempotent** (re-eval deletes prior AI rows first).
- **Queue** (`src/server/queue.ts`): `handleQueue(batch, env, evaluate=evaluateDeck)` — ack on
  success, `retry()` on throw (wrangler `max_retries: 3`, no DLQ). `index.ts` now exports
  `{ fetch, queue }` (`ExportedHandler<Env, EvalMessage>`).
- **Routes** (`src/server/routes/decks.ts`, all `requireAuth`): `GET /api/decks` (edition list →
  `DeckView`, status→stage label via `pipeline`), `GET /api/decks/:id` (edition-scoped report:
  extraction + per-parameter AI scores + weighted total + verdict; cross-edition → 404),
  `POST /api/decks/upload` (single → R2 → **direct** `evaluateDeck`; no key → 202 pending),
  `POST /api/decks/bulk` (many → R2 → `EVAL_QUEUE.send` per deck). PDF-only, **24 MB cap** (Anthropic
  32 MB request limit after base64).
- **Client:** `src/client/api.ts` (typed fetchers); `DashboardPage` fetches `/api/decks`,
  data-derived KPIs + pipeline-progress rail, opens `EvaluationDrawer` from `/api/decks/:id`;
  new `UploadPage` (single = evaluate now, bulk = queue) routed for `upload`/`founder-upload`;
  `.sj-input` utility in `index.css`.
- **Tests (71 unit/worker/client + 17 e2e; 1 skipped):** `test/worker/evaluate.test.ts` (prompt/tool
  build, parsing, full-rubric gate incl. partial + zero-score → Incomplete),
  `test/worker/decks.test.ts` (evaluateDeck DB writes + transition with mocked Anthropic, report
  endpoints, upload→R2→direct/queue, `handleQueue` ack/retry), `test/worker/evaluate.live.test.ts`
  (**flag-gated** live smoke test), `e2e/upload.spec.ts` (upload → appears in All decks).

### Phase 3 gotchas
- **`ai/evaluate.ts` + its tests live under the WORKER tsconfig, not `test/unit`.** The module imports
  `Env` (which references `R2Bucket`/`Queue`) and uses `D1PreparedStatement`, so it needs
  `@cloudflare/workers-types`. `tsconfig.json` (client/DOM, covers `test/unit`) has no workers-types —
  putting evaluate tests there breaks typecheck. They run fine in the workerd pool (pure fns + mocks).
- **Live smoke test gating.** `test/worker/evaluate.live.test.ts` is `describe.skipIf`'d on Miniflare
  bindings `LIVE_ANTHROPIC` + `LIVE_ANTHROPIC_KEY`, forwarded from `process.env.LIVE_ANTHROPIC` /
  `process.env.ANTHROPIC_API_KEY` in `vitest.worker.config.ts`. **Named distinctly from
  `ANTHROPIC_API_KEY`** so the app binding stays unset during the normal suite (keeps single-upload
  tests on the deferred 202 path). Run live with:
  `LIVE_ANTHROPIC=1 ANTHROPIC_API_KEY=sk-... npm test`.
- **Queue deploy needs the queue to exist first** (`wrangler queues create startup-jury-evals`) and
  **Workers Paid** — otherwise `wrangler deploy` rejects the consumer. Both are in place.
- **Model call is raw `fetch`** (no `@anthropic-ai/sdk` dependency in the Worker), per the
  Cloudflare-only plan. Forced tool-use + `thinking:disabled` keeps the JSON deterministic.
- **Code-review follow-ups (documented, not blocking Phase 3 acceptance):** single-upload runs the
  Claude call **synchronously in the request** (10–30s; consider enqueue-and-poll if it bites);
  bulk upload has no per-file failure isolation / DLQ (a mid-loop `send` throw 500s the batch);
  `DashboardPage.PASS_STATUSES` hard-codes stage **labels** (fragile if a pipeline label changes) —
  prefer deriving "advanced" from a gate flag; progress-rail dot color is sampled from the first deck
  in each status bucket.

## Resume here (Phase 4)

Build the **Incubator pipeline** end-to-end on top of the Phase 1 state machine
(`src/pipeline/incubator.ts`) and the Phase 3 deck model. Add role-gated stage transitions
(assign jury → jury evaluation Score/Shortlist/Reject → intro calls → signup → onboard-ready /
archive) plus the **founder query loop** (Manual Review → Incomplete → Query founder → founder
response → back to Uploaded) with a **stubbed, tested outbox** for email (real Cloudflare Email is
Phase 7+). Server: a `POST /api/decks/:id/transition` (or per-action) route that calls
`performAction(edition, from, action, role)` (already in `src/pipeline`), persists the new
`status`, writes a `pipeline_events` row, and enforces `requireRole` per transition; `queries`
CRUD for the founder loop; `scores`/`evaluations` writes for human jury scoring (mirror the AI
path — `evaluator_kind='human'`, `evaluator_id`). Client: fill the incubator Assign / Evaluate /
Jury Pipeline / Intro calls / For Sign up / Onboard ready / Archive stub screens with live data
and the transition actions; wire the founder portal (`founder-*` slugs) upload+query+signup.
**Visual mockup review gate FIRST** for the incubator role screens (render `AISJ_INC_*` /
`AISJ_IC_SuserV11` prototypes, screenshot, match layout/copy/interactions). **Tests:** full
happy-path integration (upload→AI→assign→jury shortlist→intro→signup→onboard) + reject/archive +
query-loop branch; per-stage authZ (legal/illegal transitions per role); e2e for jury + associate
happy paths. Keep human scoring feeding the **Score Drift / Evaluator Scores** analytics (AI vs
human) that land in Phase 7. Green gate + `/code-review`, commit to `main`, **redeploy the demo**
(no new remote infra expected — D1 migration only if you add tables). Keep scope to Phase 4; do
not start Phase 5 (VC).
