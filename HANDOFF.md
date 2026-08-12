# HANDOFF — ai.STARTUPJURY

Single source of truth for resuming this build in a new/compacted session. Read this +
the full plan at `docs/PLAN.md` + `git log`.

---

## Status

- **PROJECT COMPLETE — all 9 phases (0–8) shipped, PLUS the 8-session FINISH TRACK
  (full prototype parity + every Jul-24 demo ask). Both are done and on `main`;
  see `docs/FINISH-PLAN.md` and the **Finish track** section at the bottom.**
- **All 9 phases (0–8) shipped and on `main`.** Phase 0 — Scaffold & CI ·
  Phase 1 — Data & auth · Phase 2 — Design system & app shell · Phase 3 — Upload & AI evaluation ·
  Phase 4 — Incubator pipeline · Phase 5 — VC pipeline · Phase 6 — Config, plans & credits ·
  Phase 7 — Analytics & polish · **Phase 8 — Production hardening & final deploy.** The app is in
  maintenance mode — see **Project complete / maintenance** at the bottom.
- **Live demo:** deployed to Cloudflare — **https://startup-jury.jay-komarraju.workers.dev**
  (remote D1 + KV + **R2 + Queue + Cron**, seeded demo logins, password `demo1234`). Viewer guide: `docs/DEMO.md`.
  See **Live demo & deploy** below. Phase 8 verified all 5 bindings + the `ANTHROPIC_API_KEY` secret
  on the deployed Worker (`wrangler versions view`), API-confirmed the Cron `0 8 * * *` schedule is
  registered, and added a **post-deploy smoke script** (`npm run smoke`, 26 checks) that is green
  against the live URL across both editions incl. cross-edition + intra-VC authZ 403s.
- **Demo access decision (Phase 8, with the user):** the shared seed logins stay **open and
  documented** — the user wants multi-role end-to-end walkthroughs for a stakeholder demo. No gate,
  no password rotation. A custom domain was **deferred** (keep the `workers.dev` URL; addable later
  with no code change). Both are outward-facing choices the user confirmed.
- **✅ Live AI scoring VERIFIED WORKING (2026-07-23).** Anthropic credits were added and a real
  single-upload against the live Worker returned `200 evaluated:true` in ~12s — Claude extracted the
  slides and returned structured per-parameter scores (the earlier `$0 credit balance` 400 is gone).
  The `ANTHROPIC_API_KEY` secret is set on the deployed Worker; no code/config change was needed. The
  verification deck was removed and its credit refunded afterward, so the demo seed stays pristine.
  Graceful degradation still applies if the account is ever out of credits (single-upload → `202
  pending`; bulk decks retry 3× then drop at `pending_ai`).
- **Workflow:** commit directly to `main`, no PRs. Green gate (typecheck+lint+tests+build,
  plus `test:e2e` for UI) before each push. Node 22 (`nvm use`).

## Live demo & deploy

- **URL:** https://startup-jury.jay-komarraju.workers.dev · **account:** jay.komarraju@gmail.com
  (`wrangler` already authenticated).
- **Provisioned (remote):** D1 `startup-jury-db` (id `6353d3a9-e2f0-459a-9acc-411373197232`),
  KV `SESSIONS` (id `a6b70566774d4f03900a05c5c77f1365`), **R2 bucket `startup-jury-decks`**, and
  **Queue `startup-jury-evals`** (id `a8e8467445f0456eadceacabc71f5b37`, producer+consumer). Bindings
  in `wrangler.jsonc`. The account is on **Workers Paid** (queue consumers deploy fine).
- **Secret:** `ANTHROPIC_API_KEY` — **already set** on the deployed Worker (`wrangler secret list`
  shows it). No redeploy needed after a secret change — it applies to the running Worker immediately.
  **Live scoring is blocked only by the Anthropic account's $0 credit balance** (see the ⚠️ item under
  **Status**) — add credits, no other change required. **Cron is now provisioned** (Phase 7 —
  `triggers.crons: ["0 8 * * *"]`, the daily evaluator-reminder sweep; confirmed registered at deploy).
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
  tests on the deferred 202 path). Run just the live file with:
  `LIVE_ANTHROPIC=1 ANTHROPIC_API_KEY=sk-... npx vitest run test/worker/evaluate.live.test.ts`
  (or `… npm test` for the whole suite). **Status:** last run returned `400 credit balance too low` —
  the key is valid and the payload is accepted; it's purely the Anthropic account's $0 balance. Add
  credits, then this passes and a real demo upload scores end-to-end.
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

## Phase 4 — Incubator pipeline (shipped)

- **Pipeline** (`src/pipeline/incubator.ts`): added `pending_ai → manual_review` (`send_to_review`)
  so the Manual Review node is reachable, and added `program_associate` to `flag_incomplete` (the
  associate drives the founder-query loop). The AI path still auto-lands decks at
  `ai_evaluated`/`incomplete`/`rejected` (Phase 3, via `evaluateDeck`, not `performAction`).
- **Email outbox (stub)** (`src/server/email/outbox.ts` + migration `0004_email_outbox.sql`):
  `sendEmail` records to the `email_outbox` table (status `sent`); pure `buildQueryEmail` /
  `buildSignupEmail` composers. **Real Cloudflare Email is Phase 7+** — swap `sendEmail`'s body then,
  callers unchanged.
- **Workflow API** (`src/server/routes/pipeline.ts`, mounted at **`/api`** — owns `/queries`, `/jury`,
  `/parameters` alongside `/decks/:id/*`; auth is scoped to those prefixes, NOT `use("*")`, so the
  app's JSON 404 on unknown `/api/*` still works):
  - `POST /decks/:id/transition` `{action,note?}` → `performAction` (per-transition role gate; 403
    forbidden / 409 unknown_action|terminal), persists status + a `pipeline_events` row.
  - `POST /decks/:id/assign` `{assigneeId}` (associate/admin) → sets `assigned_to` + `assign_jury`.
  - `POST /decks/:id/evaluate` `{scores,remarks?}` — **human** jury scoring mirroring the AI path
    (`evaluator_kind='human'`, `evaluator_id`, full-rubric weighted total; idempotent re-submit);
    auto-advances `assigned → jury_evaluation`. **Jury may only score decks assigned to them** (403).
  - Founder loop: `GET/POST /decks/:id/queries` (create sends a stubbed email; a `manual_review`
    deck is flagged `incomplete` first) + `POST /queries/:id/respond` (founder answers →
    `founder_response` → back to `uploaded`, `complete=1`).
  - `POST /decks/:id/send-signup` (associate/admin) → `send_signup` + a stubbed invite email.
  - `GET /decks/:id/events` (audit feed), `GET /jury`, `GET /parameters`.
  - **Per-record authZ:** `loadDeck` scopes founders to their own uploads (non-owned → 404), so
    queries/events/transition/respond can't leak another startup's data.
- **Decks routes** (`src/server/routes/decks.ts`): list+detail now emit `statusId`, `assignedTo`(+Name),
  and the caller's allowed `actions` (from `allowedTransitions`) so stage screens render buttons;
  **founders are scoped to their own decks** in both list and detail.
- **Client:** `api.ts` fetchers (transition/assign/evaluate/send-signup/queries/respond/jury/
  parameters/events); `DeckView` gains `statusId/assignedTo/assignedToName/actions`. Screens:
  `StagePage` (config-driven — Jury Pipeline / Intro calls / For Sign up / Sign up Pipeline /
  Onboard ready / Archive), `AssignPage`, `EvaluatePage` (rubric sliders + live weighted total;
  reached via staff **Evaluate** and a jury member's **Assigned** slug), `QueryPage`, and the founder
  portal (`FounderPortal.tsx`: My Startup / Queries / Sign up). Wired in `App.tsx` `NavRoute` for the
  incubator edition only (VC keeps stubs).
- **Demo seed** (`0005_seed_founder_decks.sql`): founder `inc_founder` (Meera Sharma) gets an
  `incomplete` deck with an open query + a `signup` deck, so the founder portal/query loop/sign-up
  are live on the demo (the Phase 1 seed decks are all associate-uploaded → founder saw an empty portal).
- **Tests (90 unit/worker + 20 e2e; 1 skipped):** `test/worker/pipeline.test.ts` (full happy path
  upload→AI→assign→jury→shortlist→intro→signup→onboard with `pipeline_events` audit, reject/archive,
  query loop incl. manual_review flag, per-stage authZ 403/409/404, jury-not-assigned 403, PM-assign
  403, founder read isolation, human-score persistence, list actions), `test/worker/outbox.test.ts`
  (builders + `sendEmail` persistence), `e2e/incubator.spec.ts` (associate assign · jury score+shortlist
  · staff query). `/code-review` run and its 6 findings fixed (authZ gaps + dead Reassign action).

### Phase 4 gotchas / notes
- **Two users named "Rajesh Kumar"** in seed (inc_jury + vc_ic). `GET /jury` is edition-scoped so the
  incubator Assign dropdown shows one; e2e selects by label safely.
- **`jurypipeline` nav is admin/jury only** (not associate) — a program_associate deep-linking it
  correctly hits the "Not available for your role" guard. That's the matrix, not a bug.
- **Single `assigned_to`** per deck (one jury member). Multi-juror panels + the AI-vs-human **Score
  Drift / Evaluator Scores** analytics are Phase 7; human scores are already stored to feed them.
- **`complete_signup` transition is role-gated but not owner-gated** — any incubator founder could
  complete another's signup. Low-risk on a single-tenant demo; revisit if founders get real accounts.
- **outbox tests live under the WORKER tsconfig** (same reason as `ai/evaluate.ts` — the module imports
  `Env`, which needs `@cloudflare/workers-types`).

## Phase 5 — VC pipeline (shipped)

- **Visual review gate** done first: the `VC Final files/AISJ_VC_*.html` prototypes are interactive
  (`window.showPanel('<slug>')` renders each nav screen — panel ids == `nav.ts` slugs). Screens matched
  per role; details in the `phase5-vc-visual-gate` memory. Build decision: the generic `StagePage`
  renders role-gated transition buttons from `deck.actions`, covering most VC stages; dedicated screens
  only for IC voting and scoring.
- **Server** (`src/server/routes/pipeline.ts`, mounted at `/api`):
  - **IC voting** — `POST /decks/:id/ic-vote` `{vote,comment?}` (roles `ic_member`/`partner`/`admin`+MP;
    only at `ic_review`; one vote per member, idempotent replace) + `GET /decks/:id/ic-votes`
    (**committee-only read** — ballots are confidential) returning per-member ballots, the aggregated
    `tally`, plurality `recommendation` (invest breaks ties upward), and the caller's `myVote`.
  - **Transition side-effects** (`transitionSideEffects`, keyed by action, folded into the existing
    `POST /decks/:id/transition` batch): `sponsor_to_ic`/`another_meeting`/`pass_at_call` → a `partner`
    `calls` row; `mp_approve_dd` → an approved `investment_dd`; `issue_term_sheet` → an `alignment`
    `calls` row **+** a `term_sheets` row (valuation/ownership from the body); `start_legal_dd` →
    `legal_dd`; `complete_legal_dd` → a `portfolio` position. VC action names don't collide with
    incubator ones, so incubator transitions never trigger these.
  - **VC human scoring** — `POST /decks/:id/evaluate` generalized to `analyst`/`associate`/`partner`
    (`evaluator_kind='human'`, full-rubric weighted total); **guarded to the VC scoring stages**
    (`analyst_scoring`/`associate_review`/`partner_review`) so a late score can't overwrite a deal in
    diligence/IC/archived. `GET /decks/:id/my-scores` returns the caller's saved scores (form prefill).
- **Client:** `IcVotePage` (`icpipeline` — committee master-detail: per-member vote buttons + rationale,
  live tally + recommendation, ballots list with comments, MP close-vote + final decision transitions);
  `VcEvaluatePage` (`evaluate` + `assign`/Submit — rubric scoring, prefilled from `my-scores`, then
  role-gated advance actions); `StagePage` `VC_STAGE_CONFIG` drives `jurypipeline` (Assoc. Pipeline),
  `partnerpipeline`, `partnercall`, `investmentdd`, `alignmentcall` (with inline **term-sheet valuation/
  ownership capture** on Issue term sheet), `incuration` (Term sheet Pipeline), `legaldd`, `curation`
  (Onboard ready), `archive`. `App.tsx` `NavRoute` has a `user.edition === "vc"` branch; `api.ts` gains
  IC-vote + `my-scores` fetchers and a `transitionDeck` `extra` arg.
- **Demo seed** (`0006_seed_vc_decks.sql`): VC decks across every stage (`partner_call` … `onboard_ready`
  + `archived`) so each VC screen is live on the demo, plus seed IC ballots on `CreditBridge` (ic_review)
  and a closed vote on `DockFlow` (mp_decision). No new tables — the VC domain tables already exist from `0001`.
- **Tests (104 unit/worker + 22 e2e; 1 skipped):** `test/worker/vc-pipeline.test.ts` (full VC path
  analyst→onboard with the `pipeline_events` audit + every side-effect row, pass/archive + return-to-
  partner branches, IC vote aggregation incl. vote-change, per-stage authZ 403/409, committee-only ballot
  read, late-score 409, `my-scores` prefill scoping); `e2e/vc.spec.ts` (partner sponsors from partner
  call; IC member casts a vote). `/code-review` run and its 6 findings fixed (commit `76d63e4`).

### Phase 5 gotchas / notes
- **Two "Rajesh Kumar" users** (inc_jury + vc_ic). VC e2e/tests use the VC login `rajesh.kumar.vc@…`.
- **MP decision surfaces on the IC Pipeline screen:** `mp_decision` decks appear in `IcVotePage`
  alongside `ic_review` ones — the MP closes the vote (superuser-only `close_ic_vote`) then renders
  Invest / Pass / Return to partner there (superuser-only), matching `vc.ts`.
- **`calls`/`term_sheets`/`legal_dd`/`investment_dd`/`portfolio` writes are transition side-effects**,
  not separate endpoints — the prototype's per-stage dropdowns just advance state, so the domain row is
  recorded as the deck moves. `portfolio.capital_deployed` is left NULL (entered in Phase 7 Capital
  Deployment analytics); the position row is created on onboard.
- **`partner` can cast IC votes** (partners sit on the committee — the endpoint allows
  `ic_member`/`partner`/`admin` + superuser). The `icpipeline` **nav** is `admin`/`ic_member` only, so a
  partner votes via the deep-linked screen / API, not a sidebar item — matches the matrix.

## Phase 6 — Config, plans & credits (shipped)

- **Visual gate** first: extracted the Superuser/Admin prototype config panels (`coreparams` Area
  weights, `myparams` role config, `settings` AI-prompt, `branding`, plans) from the team-folder HTMLs
  and matched layout/copy. Build decision: fold the admin config superset (weights + thresholds + AI
  prompt + branding + plan/credits) into **one screen** on the `coreparams` slug (nav already exposes it,
  admin-only) rather than adding nav items; `myparams` is the plan-gated additional-params screen. Nav
  (`src/shared/nav.ts`) is **unchanged**, so `nav.spec` is unaffected.
- **Server** (`src/server/routes/config.ts`, mounted at `/api/config`; admin-gated except `/summary`):
  - `GET /summary` (any authed user) — safe read subset: `plan`, `additionalEnabled`, thresholds,
    branding, core + additional params. Drives the dashboard cohort rail + the read-only My Params view.
  - `GET /` (admin) — full settings incl. `aiSystemPrompt` + `creditsBalance`. **NB: Hono strict routing —
    the bare mount matches `/api/config` (no trailing slash, what the client calls); `/api/config/` 404s.**
  - `PUT /parameters` (admin) — update core weights (+ optional renames), then **re-score the edition**
    via `src/server/config/rescore.ts` (`rescoreEdition`): recompute AI + per-human `evaluations.weighted_total`
    and `decks.ai_score`/`signal` from persisted `scores` against the new weights, over the full rubric
    denominator (unscored param = 0, mirrors `evaluate.ts`). **Pipeline stage is never moved** (a weight
    edit can't rewind a deck); a `flagged` deck keeps its signal.
  - `PUT /thresholds` (best/mediocre, `best > mediocre` enforced — equal bands rejected),
    `PUT /ai-prompt` (org `ai_system_prompt`, read by `evaluate.ts buildSystemPrompt`),
    `PUT /branding`, `PUT /plan`, `POST /credits` (absolute set).
  - `POST /additional-params` (admin, **plan-gated → 402 `plan_required` on Standard**) + soft-delete
    `DELETE /additional-params/:id` (informational only; `active=0`, re-scores).
- **Cohort thresholds are functional, not just display:** `shared/scoring.ts cohortRating(score,best,mediocre)`
  buckets decks Best/Mediocre/Poor; `DashboardPage` shows per-band **counts** using the configured
  thresholds, so an edit re-buckets the cohort (fixed a code-review finding that they were inert).
- **Credits** (`src/server/routes/decks.ts`): `reserveCredits` atomically decrements
  `org_settings.credits_balance` (conditional `>= n` UPDATE) — one credit per deck, single **and** bulk
  (bulk is all-or-nothing). `402 no_credits` at an empty balance, before any R2 write. `refundCredits`
  compensates a store/enqueue failure after reservation (single: refund 1; bulk: refund the un-stored
  remainder) so a transient error never silently burns credits.
- **Data:** no schema change (columns existed from `0001`). Migration `0007_config_plans_credits.sql`
  seeds a generous demo credit balance (50) + **two informational params per edition** (weight 0, so they
  never move the composite; plan-gated — hidden on Standard, shown on Pro/Premium; seed plan is Premium).
- **Client:** `routes/ConfigPage.tsx` (`coreparams`, admin — weights w/ live total + re-score, thresholds,
  AI prompt, branding preview, plan + credits), `routes/MyParamsPage.tsx` (`myparams` — plan-gated
  additional params, admin add/remove, read-only for other roles), dashboard rail reads config; wired in
  `App.tsx` NavRoute (edition-agnostic). `api.ts` gains the config fetchers; `Lock` icon added.
- **Tests (119 unit/worker + 24 e2e; 1 skipped):** unit — `cohortRating` bucketing/re-bucket; worker —
  `config.test.ts` (per-role authZ 401/403, summary subset, threshold persist + inverted/equal reject,
  AI-prompt persist, **weight-change re-score math** 1.00→3.57, plan gating 402/enable + delete, credits
  set/negative), `decks.test.ts` credit-decrement (single -1, at-zero 402 stores nothing, bulk
  all-or-nothing); e2e — `config.spec.ts` (admin edits weight + thresholds → rail reflects; jury sees
  read-only My Params). `/code-review` run; 4 of 5 findings fixed (functional thresholds, single + bulk
  credit refunds, `best==mediocre` guard).

### Phase 6 gotchas / notes
- **`rescore.ts` + `config/rescore` live under the WORKER tsconfig** (imports `Env`) — same reason as
  `ai/evaluate.ts`; its integration test is a worker test, and the pure math is unit-tested via `weightedTotal`/
  `cohortRating`.
- **Founder-portal uploads consume the org's shared credit pool** (reserveCredits keys on edition, and
  `founder-upload` posts to `/api/decks/upload`). This is intentional — a founder submission triggers a
  real AI evaluation, so it legitimately costs a credit; exempting founders would let AI-costing uploads
  bypass the credit/cost system. Consequence: founders get `402 no_credits` once an admin exhausts credits
  (code-review finding #4, kept by design). If founder intake should be decoupled from the eval budget,
  revisit when founders get first-class tenancy.
- **Thresholds vs signal bands are two different things:** `signalTag` (fixed 8/5/2) is the rubric signal
  pill; `cohortRating` (admin-tunable) is the Best/Mediocre/Poor cohort classification. Editing thresholds
  changes the cohort rail, not the signal pills.

## Phase 7 — Analytics & polish (shipped)

- **Visual gate** first: extracted every report panel (incubator `cohortsummary`/`evaluatorscores`/
  `scoredrift`/`funnel`; VC `funnel`/`capital`/`portfolio`/`scoring`/`diligence`/`decisions`) from the
  Superuser/Admin/per-role prototype HTMLs and matched header/KPI-row/chart/table/AI-narrative layout +
  copy. Charts follow the **dataviz** skill: single-hue magnitude bars, signal hues for score bands, a
  green/red diverging pair for drift, text always in ink tokens (never the series colour), every chart
  paired with a table so identity is never colour-alone.
- **Pure aggregation** (`src/shared/analytics.ts`) — `buildFunnel` (cumulative reached-stage counts +
  step conversion, per-edition stage map), `cohortSummary` (distribution bands / recommendation buckets /
  sector mix / ranking), `evaluatorScores` (per-evaluator avg, vs-consensus delta, agreement),
  `scoreDrift` (AI vs human final, band changes, agreement), `scoringSummary` (AI vs evaluator avg +
  σ variance + spread + lean), `capitalDeployment`, `portfolioConstruction`, `decisionHistory` +
  `decisionKind`. No Env/DB import → **unit-tested at the node tier** (`test/unit/analytics.test.ts`).
- **Analytics API** (`src/server/routes/analytics.ts`, mounted `/api/analytics`, `use("*", requireAuth)`):
  `/funnel` (edition-aware), `/cohort`, `/evaluators`, `/drift` (incubator); `/scoring`, `/capital`,
  `/portfolio`, `/diligence`, `/decisions` (VC); `/my/decks`, `/my/scores`, `/my/drift` (jury-personal).
  The route does the D1 queries and hands rows to the pure module. **AuthZ is nav-derived:** a `guard(slug)`
  middleware enforces `canAccessNav(edition, role, slug)` — the same predicate that shows the sidebar item
  (superuser bypass built in; jury-personal reports are `exclusive`, no bypass). So a cross-edition slug
  (incubator admin → VC `capital`) and founders both 403 automatically, in lock-step with the nav.
- **Tickets & Contact** (`src/server/routes/support.ts`): `tickets` router — `POST /api/tickets` (any
  authed; billing-keyword auto-routes `billing_routed`), `GET /api/tickets` + `POST /:id/status` (admin);
  `messages` router — `POST /api/messages` + `GET /api/messages?scope=admin|team` (**`team` is a shared
  broadcast; `admin` is a private inbox — admins see all, others see only their own sent**). Screens:
  `routes/SupportPages.tsx` (`TicketsPage` admin triage, `ContactPage` scope from the nav slug).
- **Reminder cron** (`src/server/scheduled.ts`): `selectReminders` (pure, one reminder per evaluator) +
  `runReminders(env)` (selects incubator decks parked at `assigned` with an assignee → stubbed
  `evaluator_reminder` emails via `email/outbox.ts`). Wired to `scheduled` in `index.ts` and a Cron
  Trigger `triggers.crons: ["0 8 * * *"]` in `wrangler.jsonc` — **now provisioned on the deployed Worker.**
- **Client:** `routes/analytics/AnalyticsKit.tsx` (chart/table primitives + `useReport` loading/error/empty
  hook + `ReportShell`/`ReportBody`), `IncubatorReports.tsx` (Cohort/Evaluator/Drift + shared `FunnelPage`),
  `VcReports.tsx` (Capital/Portfolio/Scoring/Diligence/Decisions), `JuryReports.tsx` (Rep*). Typed
  fetchers in `api.ts` (report types re-exported from `shared/analytics`). Wired in `App.tsx` NavRoute
  (analytics slugs edition-agnostic; nav guard restricts per edition/role).
- **Data:** migration `0008_seed_analytics.sql` — more incubator decks across stages; human `evaluations`
  from 4 incubator + 3 VC evaluators (calibration + drift + variance); one AI "top driver" score per
  incubator deck; a VC funded **portfolio** with `capital_deployed` (₹92 Cr / 8 companies vs ₹300 Cr
  committed); VC `pipeline_events` for the decision log; sample tickets + messages. No schema change.
- **Tests (150 unit/worker + 27 e2e; 1 skipped):** `test/unit/analytics.test.ts` (every aggregator),
  `test/worker/analytics.test.ts` (real aggregates from seed + per-role/cross-edition authZ 403 + 401),
  `test/worker/support.test.ts` (ticket create/list/close, message send/list/inbox authZ),
  `test/worker/scheduled.test.ts` (`selectReminders` grouping + `runReminders` picks TaxPilot for
  `inc_jury` + outbox row), `e2e/analytics.spec.ts` (incubator cohort/funnel render · VC capital/decisions
  render · jury raises a contact message). Green gate passed (typecheck+lint+150 tests+build+27 e2e).

### Phase 7 gotchas / notes
- **`/code-review` ran and its 6 findings were fixed** (commit `55d26f8`): diligence red-flag filter
  now matches the real signal domain (`weak`/`absent`, not a nonexistent `flagged`) and the clarifications
  count is scoped to decks in diligence stages; `evaluatorScores` "vs cohort" uses a **leave-one-out** peer
  consensus (solo-scored decks excluded) so leniency isn't biased toward zero; `scoringSummary` takes a
  real distinct-evaluator count from the route (not the max scores on any one deck) and reports variance
  as `null` for single-scorer decks (no false 0-disagreement); and the "Most lenient/Strictest" sublabels
  use a signed formatter (no `+-0.3`). A first attempt hit an Anthropic session limit before producing
  findings; the second run completed. (A manual self-review had already relocated analytics imports to the
  top of `api.ts` and made the `team` message scope a shared channel.)
- **`shared/analytics.ts` is pure and lives under the client tsconfig** (like `scoring.ts`) — client can
  import its report types directly; the server route imports the same functions. Keep it Env-free so its
  tests stay at the node unit tier.
- **`scoringSummary.evaluators`** is the max scorers on any single deck (a proxy headcount — the pure
  input carries only score arrays, not evaluator ids). Fine for the demo; pass distinct ids if an exact
  count is ever needed.
- **Cron selection is incubator-shaped** (`status = 'assigned'`) — VC has no `assigned` stage, so the
  sweep is a no-op there today. Broaden the query if VC gets an equivalent "awaiting evaluator" stage.
- **Funnel exit mapping is approximate** — `rejected`/`archived` fold back to the AI-Evaluated/Screened
  bucket regardless of how far they actually got. Good enough for the demo funnel; revisit if exact
  exit-stage attribution is needed.

## Phase 8 — Production hardening & final deploy (shipped)

Finalization, not first deploy (the app has been continuously deployed since Phase 2). No schema or
Worker-behavior change this phase — the work was verification, a post-deploy smoke harness, and doc/launch
hardening.

- **Bindings/secrets/cron verified on the deployed Worker.** `wrangler versions view <id>` on the live
  version confirms handlers `fetch, queue, scheduled` + all bindings: `DB` (D1), `SESSIONS` (KV), `DECKS`
  (R2), `EVAL_QUEUE` (Queue), `ASSETS`, and secret `ANTHROPIC_API_KEY`. The Cron `0 8 * * *` schedule is
  **API-confirmed registered** (`GET /accounts/:acct/workers/scripts/startup-jury/schedules`). Workers
  invocation analytics over the last 3 days: 0 errors. **To watch a real cron firing:** Cloudflare
  dashboard → Workers → startup-jury → Triggers → Cron (last-run) after 08:00 UTC, or `wrangler tail` at
  that time. (Didn't fire a mutating cron against the demo seed to "prove" it — the `scheduled` handler is
  deployed + unit-tested in `test/worker/scheduled.test.ts`.)
- **Post-deploy smoke script** (`scripts/smoke.mjs`, `npm run smoke [url]`, `SMOKE_URL=` env override):
  read-only / non-mutating — health, auth gate + bad-creds 401, both-edition logins, decks/config/analytics
  reads, **cross-edition authZ 403** (incubator→capital, VC→cohort) and an **intra-VC role gate**
  (analyst→capital 403). Runs as **role-gated principals, not superuser** (incubator admin `nisha.kapoor`,
  VC partner `ishaan.sethi`, VC analyst `rhea.nair`), so `canAccessNav` is genuinely exercised. **26 checks,
  green against the live URL.**
- **Remote migrations:** `wrangler d1 migrations list … --remote` → **no migrations to apply** (0008 was
  the last, applied in Phase 7). Redeployed the demo at the phase boundary.
- **Demo guide refresh** (`docs/DEMO.md`): rewrote the stale "coming next" section — upload/AI scoring, the
  full pipeline for both editions, analytics, config/credits, and the founder portal are all **live now**;
  added an AI-scoring note (built; live scoring needs Anthropic account credits).
- **Launch decisions (with the user):** keep the shared seed logins **open + documented** (the user wants
  multi-role end-to-end demos); **defer** a custom domain (keep `workers.dev`). Both recorded under
  **Status**.
- **Anthropic billing — resolved & verified (2026-07-23).** Credits were added; a real single-upload
  against the live Worker returned `200 evaluated:true` in ~12s with structured slide extraction + 15
  per-parameter scores (the `$0` 400 is gone). Verification deck deleted + credit refunded afterward, so
  the demo seed is unchanged. Live upload→score→advance now works with no code change.
- **Tests:** three tiers stayed green (typecheck + lint + **152 tests / 1 skipped** + build + **27 e2e**);
  `/code-review main` ran and its 5 findings (all smoke-script robustness/coverage) were fixed in `32d9f34`.

### Carried-over follow-ups — resolution
- **`complete_signup` owner-gating: already closed.** `loadDeck` (pipeline.ts) scopes founders to
  `uploaded_by === user.id`, so a founder gets 404 on another founder's deck — they can only ever complete
  **their own** signup. No code change needed (the Phase 4 gotcha predates that guard).
- **Left as documented maintenance items** (architectural, not hardening; and not exercised while Anthropic
  is at $0): single-upload runs Claude **synchronously** in-request (consider enqueue-and-poll); bulk upload
  has no per-file DLQ (has credit-refund compensation, not a DLQ); founder uploads couple external intake to
  the internal credit budget (by design — see Phase 6 gotchas); **multi-juror drift** — decks carry a single
  `assigned_to` while Phase 7 analytics attribute human scores per evaluator from seeded `evaluations` rows.

## Demo docs + end-to-end validation (2026-07-23)

Post-completion session (docs + live validation, **no feature or behavior change**):

- **Two demo docs added** (`docs/`): `DEMO-AUDIENCE.md` (shareable, non-technical
  overview — editions, live URL, seed-login tables, 5-min try-it path) and
  `DEMO-RUNBOOK.md` (presenter script — ~12-min narrative, exact login order +
  click-path for both editions, per-screen talking points, credit notes, and a
  fallback/troubleshooting + rehearsal-reset section). A ready-to-upload sample
  deck lives at `docs/demo-assets/gridbloom-sample-deck.pdf`.
- **Full live end-to-end test passed against the deployed Worker (32/32 checks).**
  `npm run smoke` = 26/26. Then a real upload for **both editions**: Claude scored
  the sample deck live (incubator **7.77**, VC **7.87**, both signal _moderate_,
  gate passed) → landed at `ai_evaluated` / `analyst_scoring` → report renders
  (extraction + per-parameter scores + weighted total + verdict) → advanced through
  pipeline transitions (inc: assign→jury_eval→shortlist→intro; VC: core-scores→
  associate→partner→partner_call) with the `pipeline_events` audit log written →
  analytics endpoints 200 per edition.
- **Runbook gotcha discovered + documented:** the rubric includes a **weight-10
  `climate_impact` ("Climate Impact & Integrity")** parameter. A deck with no
  climate/impact angle scores ~0 there, dragging the weighted total under the `>5`
  gate → deck lands **Incomplete**, not the pass stage (verified: a thin fintech
  deck → 4.9/Incomplete vs the climate deck → 7.8/AI-Evaluated). Demo with a
  well-rounded, climate-relevant deck (the sample PDF is built to pass). This is
  captured in the runbook's "Which PDF to upload" section.
- **Seed kept pristine.** All 4 test decks (2 exploratory Incomplete + 2 passing)
  deleted — R2 PDFs removed, D1 rows deleted (explicit child deletes + cascade),
  and the 2 credits/edition refunded. Verified `leftover_deck=0`, no orphan child
  rows, `credits_balance = 50` for both editions.
- Green gate stayed green (typecheck + lint + **152 tests / 1 skipped** + build).

## Project complete / maintenance

All 9 phases (0–8) are shipped, green, and on `main`; the app is live at
**https://startup-jury.jay-komarraju.workers.dev**. There is **no next phase.** For ongoing maintenance:

- **Live AI scoring is on** (verified 2026-07-23 — see Status). The `ANTHROPIC_API_KEY` secret is set and
  the account has credits; uploads score end-to-end. If scoring ever regresses to `202 pending`, check the
  Anthropic account's credit balance first (uploads degrade gracefully on a billing error — it's not a
  code fault). Re-verify with the Phase 3 flag-gated live smoke test or one real demo upload.
- **After any change:** run the green gate (`npm run typecheck && npm run lint && npm test && npm run build`,
  `+ npm run test:e2e` for UI), then `npm run build && npx wrangler deploy`, apply new migrations
  `--remote` first if any, and finish with **`npm run smoke`** against the live URL. Commit direct to `main`
  with the `Co-Authored-By` trailer; keep `wrangler` pinned at `4.110.0` (Phase 2 gotcha).
  **Current baselines: 410 unit/worker/client (1 skipped) · 72 e2e · smoke 44/44.**
- **Security headers / CSP** (`src/server/security.ts`, added 2026-08-12 — the last of Session 8's deferred
  follow-ups). A real `Content-Security-Policy` on the SPA document plus `nosniff` + `Referrer-Policy`
  everywhere. Three things will bite you:
  1. **`assets.run_worker_first` in `wrangler.jsonc` and the CSP are ONE change.** Without it Cloudflare's
     asset layer can answer a navigation from the edge and the Worker never runs — the header then reaches
     `curl` but **not browsers**, silently. That exact failure happened on the first deploy of it.
  2. **The CSP goes on HTML documents only.** Chrome renders a top-level PDF through a plugin document and
     `object-src 'none'` on that response blanks it, breaking the deck viewer's "Open PDF" link.
  3. **`img-src 'self' data:`, `worker-src 'self' blob:` and `style-src 'unsafe-inline'` are load-bearing**
     for `DeckPdfViewer`. A green e2e run does **not** prove the viewer still works unless it goes through
     `e2e/csp-enforce.ts` — in dev the Vite plugin serves the document itself, so an assertion straight off
     `page.goto` passes vacuously. After touching the policy, open a deck with a real PDF in a browser.
- **For a wider public launch:** revisit the open demo access (gate via Cloudflare Access or rotate the
  shared password) and consider a custom domain — both deferred by choice, neither is a code change.
- The **carried-over follow-ups** above (sync upload / DLQ, founder-credit coupling, multi-juror panels) are
  the natural next feature work if the product goes beyond a single-tenant demo.

## Finish track (post-completion) — ✅ COMPLETE. See `docs/FINISH-PLAN.md`

A multi-session **finishing build** (full prototype parity + all Jul-24 demo asks) ran on top of the
complete Phase 0–8 app. **All 8 sessions shipped** (2026-08-11 → 2026-08-12); the master plan + the
per-session progress log is `docs/FINISH-PLAN.md`. **There is no next session.** What landed:

- **Session 1 — Evaluator Workbench** (commit `3f3bd30`). Both evaluate screens + the report drawer render a
  shared `EvalScorecard`: an in-app **pdf.js** deck viewer (`DeckPdfViewer`, worker self-hosted via a Vite
  `?url` import, lib dynamically imported), per-parameter **AI breakdown**, **AI · My · Average** columns
  (Average live), a **Research** menu to the juror's own external AI (no tokens), **Deck X of N**, and an AI
  **rescore guard**. New endpoints on `decks.ts`: **`GET /api/decks/:id/file`** (auth'd R2 PDF stream,
  edition/owner-scoped) and **`POST /api/decks/:id/rescore`** (team roles; 409 `already_scored` unless a
  version changed). New schema (migration `0009`): `org_settings.criteria_version`, `decks.content_version`,
  `evaluations.scored_criteria_version` / `scored_content_version` — admin criteria edits in `config.ts`
  bump `criteria_version`; `evaluateDeck` stamps the AI roll-up. New dep: **`pdfjs-dist@4.10.38`** (pinned).
  Single upload now **enqueues on a synchronous eval error** (partial fix for the `pending_ai` stranding
  bug; full fix is Session 7). Playwright port is **`E2E_PORT`-overridable**.

- **Session 2 — Program & Cohort hierarchy + config wizard** (commit `c70cbcd`). **Sector → Program → Cohort**
  is the umbrella over everything. New schema (migrations `0011`/`0012`): `sectors`, `programs`
  (edition, sector, name, description, VC **`fund_size`/`fund_allocated`/`capital_deployed`**, active),
  `cohorts` (program_id FK, name, dates, active); `decks.program_id`/`cohort_id` FKs **generically backfilled**
  from the free-text `decks.program`/`cohort` (old text columns kept until Session 8). New route
  **`src/server/routes/programs.ts`** (`/api/programs`): read for any authed user (feeds filters / wizard /
  Applies-to), admin/superuser CRUD for sectors/programs/cohorts, all edition-scoped. The VC **Capital
  Deployment** report now sources committed/allocated from the programs' fund fields (`CapitalReport` gains
  `allocated`/`allocatedPct`; fallback `FUND_COMMITTED=300` only when no program has a size). Client: a
  **Set up wizard** (`SetupWizard`, `/app/setup`, Settings nav `setup`, admin-only) — Org type → Configure →
  Select → Team; a per-edition **active-context** store (`src/client/activeContext.ts`); dashboard
  **Program/Cohort toolbar filters** + first-run banner; an **"Applies to"** card on Core Parameters; and
  **Program/Cohort selectors** on Upload. New uploads write `program_id/cohort_id` (legacy text left NULL).

- **Session 3 — Parameter model: core 13 + role-scoped additional** (commit `f19b50b`). The rubric is now
  **13 core + 9 additional = 22 params/edition.** Owner roles (`shared/roles.ts ADDITIONAL_PARAM_OWNERS`):
  incubator = program_associate/program_manager/jury, VC = associate/partner/ic_member. Additional params are
  **AI-scored (assistive) but informational (weight 0)** → the weighted composite stays core-13 = 100%; each has
  a **configurable AI prompt** (`parameters.prompt`, migration `0013`; scores seeded `0014`). **Plan gating**
  (`shared/plans.ts`): Standard = no config · Pro = core 13 · Premium = additional 3. Config CRUD (`config.ts`)
  gates 402; renaming/prompt edits bump `criteria_version` (rescore guard). **NB:** program_associate + ic_member
  own params but had no eval screen (their human additional scoring is a later concern).

- **Session 4 — Roles & permissions** (commit `4467bf7`). The incubator **Program Manager is the decision
  maker**: `program_manager` added to `assign_jury`/`shortlist`/`reject`/`schedule_intro` (`pipeline/incubator.ts`
  + the `/assign` gate + nav `jurypipeline`/`introcalls`); associate stays the executor. **User management** —
  new **`src/server/routes/users.ts`** (`/api/users`: GET roster · POST create with a one-time temp password ·
  PATCH activate/deactivate/re-role; superuser/admin, edition-scoped) + **`AdminConsolePage`** (nav `admin`).
  **Mentor = a user-type** (`users.user_type`), not a role. **PM owner-scoped cohorts**: migration `0015` adds
  **`programs.owner_id`** (seed: `inc_pm` owns the incubator programs); `programs.ts` cohort CRUD is
  admin/superuser OR the owning PM (`canManageCohorts`); the **Set up wizard** is seat-aware (PM cohorts-only,
  PA read-only "Standard seat"). New **My account** (`AccountPage`, nav `account`) + **Buy credits**
  (`BuyCreditsPage`, nav `billing`) — Buy credits is a **simulated demo top-up** (`POST /api/config/credits/
  purchase`, atomic increment; **no real payment / card capture** — out of scope). Nav superuser superset
  21→24 (`admin`/`account`/`billing`). Investment Associate vs Analyst (VC) verified + test-locked (the VC
  intro-call screen + ICS is Session 7).

- **Session 5 — Automation** (commit `aebe362`). Migration `0016` adds **`programs.shortlist_min`**,
  `decks.founder_email`/`founder_phone`/`missing_fields`/`intake_flag`/`intake_flag_note`/`related_deck_id`,
  and a **`deck_versions`** table (v1 backfilled for every deck with an `r2_key`).
  - **Per-program shortlist floor.** `routes/pipeline.ts` gates the `shortlist` (incubator) and
    `shortlist_to_partner` (VC) actions → **409 `below_shortlist_minimum`** with an evaluator-facing
    `message`. The deck is judged on **`shared/scoring.ts decisionScore`** = the AI composite averaged with
    the mean human composite (the composite form of the workbench's AI · My · Average column). Uniform for
    every role incl. superuser; the escape hatch is an admin lowering the floor in **Set up** (a new
    per-program field + inline editor). Deck views carry `shortlistMin`/`decisionScore`/`shortlistBlocked`.
  - **AI determinism.** `callAnthropic` sends **`temperature: 0`** (plus the existing `thinking: disabled`
    + forced `tool_choice`). The Messages API has no seed param; the residual-variance expectation is
    documented in `ai/evaluate.ts`.
  - **Upload validation.** Required columns = founder, email, phone, city, sector. The form collects them,
    the model extracts them (new `founder_email`/`founder_phone`/`city`/`sector` tool fields), and
    `mergeIntakeDetails` lets the **typed value win**. Anything still missing forces **Incomplete**
    regardless of score and is stored in `decks.missing_fields` (Session 6 emails exactly this list).
    **Bulk upload now reports per-file errors** (`results[]`) instead of 413-ing the whole batch.
  - **Duplicate / returning flags.** Pure **`src/shared/intake.ts`** (normalisation + `classifyIntake`) with
    the DB-backed **`src/server/intake.ts`**. Matches on name / founder / email / phone: a live same-stage
    match = soft **duplicate** alert (run *before* the AI call — each run costs a credit), a
    concluded / stage-moved / different-cohort match = **returning** history tag. Never blocks;
    `evaluateDeck` re-checks after extraction (that's what catches bulk duplicates).
  - **Deck versioning.** **`POST /api/decks/:id/version`** (staff + the owning founder) stores the new PDF
    at `decks/<id>_v<n>.pdf`, appends to `deck_versions`, re-points `r2_key` and bumps `content_version` —
    which **unblocks the Session-1 rescore guard**, so the new version is scored automatically. Plus
    **`GET /api/decks/:id/versions`**. This is the mechanism Session 6's resubmit loop drives.
  - New client `ApiError` (carries status + JSON error body) so the workbench/stage screens can surface the
    floor's message verbatim.

- **Session 6 — Incomplete-deck resubmit loop + real email** (commit `2b385ff`). Migration `0017` adds
  **`resubmit_tokens`** and the outbox's **`error` / `provider_id` / `dedupe_key`** columns.
  - **Real email.** `src/server/email/outbox.ts` `sendEmail` now dispatches through the **Cloudflare Email
    Sending binding** (`send_email` → `env.EMAIL`, added to `wrangler.jsonc`), keeping `email_outbox` as the
    audit log. `status` is **`sent`** (accepted; `provider_id` recorded) · **`failed`** (attempted and threw;
    reason in `error`) · **`recorded`** (no binding/from configured → audited only). A send failure is caught
    and recorded, never propagated. `dedupe_key` (UNIQUE) makes a notification idempotent.
    **⚠️ Delivery is audit-only until `vars.EMAIL_FROM` is set** to an address on an onboarded sending
    domain — one config line plus `wrangler deploy`, no code change. The binding itself is deployed.
  - **Auto-notify on Incomplete.** `evaluateDeck` fires `notifyIncompleteDeck` (`src/server/resubmit.ts`)
    **after its D1 batch commits**, wrapped so a mail failure never fails the evaluation, and injectable via
    `EvaluateOptions.notify`. Idempotent on `content_version`, so a retry/re-score of unchanged content sends
    nothing but a new-yet-still-incomplete version does. Recipient is `decks.founder_email` falling back to
    the uploader's account. The email lists the missing intake columns **and** the `deck_extractions.missing`
    sections.
  - **Tokens.** 192-bit CSPRNG, **only the SHA-256 hash stored**, one deck, 30-day TTL, revocable, and
    superseded on re-mint. `invalid_token` → 404; `token_expired`/`token_revoked` → 410.
  - **Public route** **`/api/resubmit/:token`** (`routes/resubmit.ts`, mounted in `index.ts` **without**
    `requireAuth`). `GET` returns only what the founder must fix — **no scores or evaluator data**. `POST`
    takes the corrected PDF; uses are capped at 10 per token (429 `too_many_resubmits`).
  - **Shared re-upload path.** The Session-5 version logic moved to **`src/server/decks/versions.ts`**
    (`addDeckVersion`, `versionStatement`, `versionKey`, `reserveCredits`, `refundCredits`, `isPdf`,
    `MAX_PDF_BYTES`), so the authed `POST /api/decks/:id/version` and the public tokenized POST run the same
    path. A tokenized resubmit is attributed to `uploaded_by = NULL` with the note "Founder resubmission via
    secure link".
  - **Founder page** `src/client/routes/ResubmitPage.tsx` at **`/resubmit/:token`** — public, declared as a
    **sibling of `/login`** in `App.tsx` (the `path="*"` catch-all would otherwise bounce it to login).
    Feedback sections + one re-upload control; no Q&A form, per §8. Demo link seeded for NimbusHR:
    `/resubmit/aisj-demo-nimbushr-resubmit-2026`.
  - **NB `sendEmail` returns `status: 'recorded'` under Miniflare** (no email emulator), and `evaluateDeck`
    now writes an outbox + token row for every Incomplete deck — including in tests.

- **Session 7 — De-stub VC screens + ICS scheduling + issue log + the §9 pending bug** (commit
  `29c78e1`). Migration `0018`. **No nav slug renders `StubPage` in either edition any more.**
  - **Scheduling / ICS.** New pure **`src/shared/ics.ts`** (RFC 5545 VCALENDAR/VEVENT — CRLF, 75-octet
    folding that never splits a multi-byte char, TEXT escaping, UTC-only, ORGANIZER/ATTENDEE, SEQUENCE,
    optional VALARM; 23 unit tests). New **`src/server/routes/calls.ts`** (`/api/calls`): list (deckId /
    kind / mine filters), `GET /directory` (participant picker roster), `POST` schedule, `PATCH`
    reschedule/cancel, **`GET /:id/ics`** (a real `text/calendar` download) and `POST /:id/invite`.
    `calls` gained `title`/`duration_minutes`/`location`/`ics_uid`/`ics_sequence`/`status`/
    `organizer_id`, plus a **`call_participants`** table whose `user_id` is nullable so the founder and
    any external guest can be invited **at any email domain**. Two authZ tiers
    (`CALL_SCHEDULER_ROLES` in `shared/roles.ts`): incubator PM+associate / VC partner+associate (plus
    admin/superuser) schedule; everyone else is **read-only and sees only the calls they are on**.
    Scheduling an incubator intro call also performs `schedule_intro` in the same request.
    `sendEmail` now accepts **`attachments`** (raw string content for the Workers binding — base64 is
    the REST API's convention) and the invite carries the `.ics`, deduped on `call:<id>:s<seq>:<email>`.
  - **Client.** New **`CallsPage`** serves incubator `introcalls` and VC `introcalls`/`partnercall`/
    `alignmentcall` — it **shadows `StagePage`** for those slugs (checked first in `App.tsx`), and the
    alignment call's term-sheet capture moved with it. **`QueryPage`** rebuilt to the prototype's table
    and now serves **both** editions (VC `query` was a stub); status comes from the new edition-wide
    **`GET /api/queries`**. New **`IssueLogPage`** on nav `issues`.
  - **Internal issue log.** Same `tickets` table, split by a new **`category`** column
    (`'support'` | `'issue'`) — both pre-existing ticket queries were scoped to `'support'`, so the two
    queues can never see each other. `issues` router in `routes/support.ts`; any internal role files,
    **triage is admin-only**.
  - **§9 "stuck at Pending AI" — fully fixed.** Dead-letter queue **`startup-jury-evals-dlq`**
    (`dead_letter_queue` + a second consumer; `handleQueue` branches on `batch.queue`), a
    **`*/10 * * * *` cron sweep** (`src/server/ai/health.ts`; `index.ts` branches on `controller.cron`
    so the daily reminder job is untouched), a **once-only credit refund** guarded by
    `decks.ai_credit_refunded`, `POST /api/decks/:id/retry-ai` + a dashboard "Re-run AI" banner, and
    `aiState`/`aiError` on every deck view replacing the hardcoded "no AI key configured yet" copy.
    Adding the DLQ also silenced the worker suite's "Dropped message …" noise.
  - **🔴 `temperature` is rejected by `claude-sonnet-5` — live AI scoring had been broken since S5.**
    The new cron sweep re-drove the demo's stranded `CloudBridge` deck and recorded the real error:
    `400 … "\`temperature\` is deprecated for this model."` Session 5's `temperature: 0` (added for AI
    determinism) meant **every real upload had been failing and stranding at `pending_ai`** ever since,
    invisibly. `temperature`/`top_p`/`top_k` are now **absent** from `callAnthropic` and a test asserts
    they stay absent; determinism rests on `thinking: { type: "disabled" }` + the forced `tool_choice` +
    the deterministic prompt, with the S1 rescore guard preventing needless re-runs. **Do not re-add a
    sampling parameter to the Anthropic call on this model family.**
  - **⚠️ Timestamp gotcha.** `decks.created_at` defaults to SQLite's `datetime('now')`
    (`"YYYY-MM-DD HH:MM:SS"`) while everything this codebase writes is ISO-8601 (`"…T…Z"`). A space
    (0x20) sorts **before** "T" (0x54), so comparing them as raw strings is wrong for same-date values —
    use `datetime(a) <= datetime(b)`. This was a real bug in the first cut of the sweep.

- **Session 8 — Polish, full e2e, docs, final deploy** (this session). Migrations `0019` + `0020`.
  The finish track's closing pass: coherence, coverage and the last leftovers.
  - **`POST /api/users` now EMAILS the temporary password** (Session 4's leftover). New pure
    **`buildAccountInviteEmail`** + **`emailDeliveryConfigured(env)`**; `users.ts` `deliverInvite()`
    sends the invite and reports whether it actually left the building. The credential is returned in
    the response **only when delivery did not happen** (`status: 'skipped'` — no verified sending
    domain — or `'failed'`), so a new account can never be stranded by a transport problem; the Admin
    console copy switches with it. `OutboundEmail` gained **`auditBody`**, used here to keep the
    plaintext password out of the durable `email_outbox` log.
  - **⚠️ THE SENDING DOMAIN IS STILL NOT ONBOARDED** (confirmed with the user, 2026-08-12). Delivery
    stays audit-only and **no live inbox test has ever been run** — that is the one acceptance
    criterion the finish track could not close. To go live: onboard the domain, set `vars.EMAIL_FROM`
    in `wrangler.jsonc`, `npx wrangler deploy`. **No code change** — the invite, the Incomplete notice
    and the `.ics` call invite all start delivering on that one line.
  - **Migration `0019` — dropped the deprecated `decks.program` / `decks.cohort`.** Session 2 replaced
    them with `program_id`/`cohort_id` FKs and backfilled; nothing in `src/**`, `test/**`, `e2e/**` or
    `scripts/**` had read them since. A plain `ALTER TABLE … DROP COLUMN` was correct — neither column
    was indexed or referenced by a view/generated column, so the twelve-step table rebuild (and
    re-creating eleven inbound `ON DELETE CASCADE` FKs by hand) was avoidable risk. Regression tests
    assert the columns are gone and all four `decks` indexes survived.
  - **Migration `0020` — the demo-seed refresh.** No schema change; it makes the demo *coherent*:
    - **Full 13-parameter AI breakdowns for all 28 remaining scored decks** (only TaxPilot + WealthOS
      had one). The per-parameter values are **solved so the weighted total reproduces each deck's
      existing `ai_score` exactly**, so an admin weight edit re-scores from the rows without the
      headline jumping. This also retires the Session-5 gotcha that a weight edit collapsed
      FinStack/InsureFlow 8.6 → 0.87. Scores are whole numbers, the shape the model really returns.
    - **Fixed a latent Session-1 inconsistency:** 0010's hand-written TaxPilot/WealthOS breakdowns
      weight out to **5.93 / 8.06**, not the advertised 6.2 / 8.1. The composite now derives from its
      own evidence (the scores carry hand-written rationales that must keep matching their values).
    - New fixtures so the newest surfaces have something to render: **PitchLoop** (incubator, seeded
      `pending_ai` + `ai_failed_at` → the §9 AI-health banner; the `*/10` sweep skips it because
      `ai_failed_at IS NOT NULL`, so it can't be re-driven behind your back) and **Northbeam Robotics**
      (VC, Incomplete + a founder query — the VC half of the resubmit loop, which was incubator-only).
    - Also: the **returning-company** flag on `vc_deck_agrichainvc`; `investment_dd` / `term_sheets` /
      `legal_dd` rows for the decks parked in those stages; non-`open` ticket/issue states and one
      **rescheduled call at `ics_sequence = 1`**; org **branding** (so `orgName()` stops saying "the
      programme"); the missing `sectors` rows; and `program_id` for the real uploaded decks so the
      toolbar filters stop hiding them.
  - **CloudBridge (`deck_1a5467f7…`) is KEPT** as a second, fully real resubmit case — a genuine deck
    that was stranded 19 days, re-driven by the Session-7 sweep, and landed Incomplete because two
    required intake columns really are absent from its PDF. Its original token was only ever stored as
    a hash, so `0020` mints a fresh readable demo link:
    **`/resubmit/aisj-demo-cloudbridge-resubmit-2026`**.
  - **Brand/theme/a11y pass** against the brand doc. Fixed the two real theme bugs — `text-white` on
    amber in the Set up stepper (**2.4:1**, below AA → `text-navy`) and the Research button's fixed
    `bg-navy`, which was **1.06:1 against the dark-theme surface** and effectively invisible. Unified
    the three divergent table-header styles onto the house markup; gave the calls modal
    `role="dialog"`/`aria-modal`/Escape and the brand scrim; turned `StagePage`'s `<td onClick>` into a
    real button; labelled the icon-only pills; refreshed the wizard's stale "team management is coming"
    copy. **CSP audit came back clean** — no CDN, no external font, no remote image, no `eval`; the
    pdf.js worker is self-hosted and the only outbound URLs are the Research menu's, opened by explicit
    user action with `noopener,noreferrer`.
  - **The Export button does something.** It had been live-looking and inert since Phase 2. New pure
    **`src/client/exportCsv.ts`** exports the on-screen deck table (post-filter, in order) as RFC 4180
    CSV with a BOM, **defusing spreadsheet formula injection** on the attacker-influenced columns (a
    founder picks their own company name). `GET /api/decks` now also returns `programName`/`cohortName`.
  - **e2e coverage sweep — `e2e/coverage.spec.ts` (17 tests, 52 → 69 total).** Closes the families no
    session had covered: **every `StagePage` slug in both editions**, the **founder portal**, the
    **eight** analytics reports nothing opened, the support queue, the team channel, the AI-health
    banner, the Upload intake table, the Set up wizard's last two steps, and the CSV export. The
    headline addition is a **regression guard that walks every nav slug in both editions and asserts
    none of them renders `StubPage`** — the property the finish track was actually aiming at.
  - Fixed a React `key`-spread warning in `ScoreBars` that the fuller seed made visible everywhere: a
    score carries the *parameter* key, and spreading it into JSX made React read it as the
    reconciliation key.

## Post-finish maintenance log

- **2026-08-12 — Content-Security-Policy shipped** (Session 8's deferred follow-up; see
  `docs/FINISH-PLAN.md` §6, last entry). New `src/server/security.ts` + a Hono middleware in
  `src/server/index.ts`; `wrangler.jsonc` gained `assets.run_worker_first`. Green gate: typecheck + lint +
  **410 unit/worker/client (1 skipped)** + build + **72 e2e**; deployed; `npm run smoke` **44/44**.
  Live-verified in a real browser against production: CloudBridge's **12-page PDF rendered 12 slides in
  1.3 s with 0 CSP violations**, and the PDF stream still returns `application/pdf` with no CSP. No credit
  spent, demo seed untouched (`credits_balance` 42 / 49). See the three CSP gotchas under
  **Project complete / maintenance** before touching the policy.
- **The email sending domain is STILL not onboarded** (asked and re-confirmed with the user, 2026-08-12,
  in the same session). Delivery stays audit-only (`email_outbox.status='recorded'`) and **the live inbox
  test has still never been run.** It remains a one-line change — `vars.EMAIL_FROM` + `npx wrangler deploy`
  — with no code to write. `docs/DEMO.md`, `docs/DEMO-AUDIENCE.md` and `docs/DEMO-RUNBOOK.md` still
  correctly describe email as composed-but-not-delivered; update them the day it lands.
