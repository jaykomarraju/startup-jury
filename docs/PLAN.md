# ai.STARTUPJURY — Full-Stack Build on Cloudflare

> Versioned copy of the build plan (originally authored in plan mode). The live
> resume pointer lives in [`../HANDOFF.md`](../HANDOFF.md); this file is the full plan.

## Context

`Documents/GitHub/startup-jury` is an empty repo (just a README). We are building
**ai.STARTUPJURY** ("Venture intelligence first") — an AI-powered pitch-deck evaluation
platform for incubators/accelerators and VC firms — as a production full-stack app
deployed **entirely on Cloudflare** (no other infra providers).

The design source of truth is `Documents/STARTUPJURY-TEAM-FOLDER`: brand guidelines
(docx), a role×stage permission matrix, two pipeline flow diagrams, and polished
single-file HTML prototype dashboards for every role. These prototypes are static mocks
with hard-coded data; our job is to rebuild them as a real, data-driven application.

**Decisions locked with the user:**
1. **Scope:** Build **both products together** — Incubator + VC — to functional parity.
2. **AI backend:** **Claude via Workers** — the Anthropic API is called from inside a
   Cloudflare Worker for extraction + scoring. Everything else stays 100% Cloudflare.
3. **Frontend:** **React SPA** (Vite + Tailwind), rebuilding the mockup screens faithfully
   to the design system, served from Cloudflare Workers static assets.
4. **Tenancy:** **Single-tenant for now** — one organization, no tenant isolation. Model
   users/roles cleanly so multi-tenancy can be added later without a rewrite.

## Cloudflare Stack (everything on Cloudflare)

| Concern | Cloudflare primitive |
|---|---|
| Hosting (SPA + API) | **Workers** with static-assets binding (single Worker serves React build + `/api/*`) |
| API framework | **Hono** on the Worker |
| Database | **D1** (SQLite) — users, decks, scores, pipeline, config |
| File storage | **R2** — uploaded pitch-deck PDFs, exported reports, branding assets |
| Sessions/cache | **KV** — session tokens, magic-link tokens, rate limits |
| Async AI eval | **Queues** — bulk uploads enqueue per-deck evaluation jobs |
| Scheduled jobs | **Cron Triggers** — evaluator reminders, stale-deck sweeps |
| AI inference | **Anthropic API (Claude)** called from the Worker via `fetch` (secret API key) |
| Email (founder queries, invites) | **Cloudflare Email** (Email Sending / Routing) — see `cloudflare-email-service` skill |

**AI model:** use `claude-sonnet-5` for deck extraction + rubric scoring (structured
JSON via tool-use / structured output). Claude accepts the PDF directly as a `document`
content block, so we send the R2 PDF bytes and get both extraction and scores in one flow.
Consult the `claude-api` skill for exact request shape, model IDs, and PDF handling before
writing the evaluation code.

## Data Model (D1 schema — key tables)

- **users** — id, name, email, password_hash (or magic-link only), role, initials, active.
  Roles enum spans both editions (see Roles below). Single `org` implied.
- **plans / org_settings** — plan tier (Standard/Pro/Premium) gating core-only vs
  core+additional parameters; credits_balance; branding (logo, theme colors); AI system
  prompt overrides; cohort rating thresholds (Best ≥7.0 / Mediocre 5.0–6.9 / Poor <5.0).
- **parameters** — the 13 weighted **core** rubric parameters (Problem & Market Clarity 8,
  Solution & Value Prop 8, Market Size 7, Product & Tech 7, Business Model & Unit Econ 8,
  Traction & Validation 10, Competitive Landscape 6, GTM 6, Team & Execution 10,
  Business Risks 8, Business Attractiveness 8, Climate Impact 10, Storytelling 4), plus
  **additional/informational** (unweighted) parameters, each with `role_scope`
  (which role configured it) and `weight`/`informational` flag. Weights editable by
  Superuser/Admin.
- **rubric_anchors** — 0–1 Absent / 2–4 Weak / 5–7 Moderate / 8–10 Strong bands +
  per-parameter anchor text used in the AI prompt.
- **decks** — the central object: name, sector/stage/city meta, program/cohort, status
  (pipeline stage), edition (incubator|vc), ai_score, signal tag (strong/med/weak/flagged),
  assigned_to, uploaded_by, created_at, r2_key (PDF), completeness flag.
- **deck_extractions** — AI-extracted slide content: `{label, heading, text}` per slide
  (Cover, Problem, Market, Traction, Team, Ask…), plus missing-slide flags.
- **scores** — one row per (deck, evaluator, parameter): value 0–10, comment. AI scores
  stored as evaluator = "AI". Enables **Score Drift** / **Evaluator Scores** analytics
  (AI vs human comparison).
- **evaluations** — per (deck, evaluator) roll-up: weighted_total, verdict
  (shortlist/reject/invest/hold/pass/return…), remarks, submitted_at.
- **pipeline_events** — append-only audit log of stage transitions + actor (drives the
  Activity Log and Decision History).
- **queries** — founder clarification requests: deck, questions, email status, founder
  responses (the Incomplete → Query → Response loop).
- **intro_calls / partner_calls / alignment_calls** — scheduling + remarks.
- **VC-specific:** investment_dd, ic_votes (per IC member: Invest/Hold/Need more info/Pass),
  term_sheets (valuation, ownership), legal_dd, portfolio (capital deployed).
- **tickets** — support tickets with billing routing; **messages** — contact admin/team.

## Roles & Pipelines (both editions)

**Incubator roles:** Super User, Admin, Program Manager, Program Associate, Jury Member,
+ external Startup/Founder. Permissions follow the role×stage matrix
(`Startupjury role assignment role matrix.jpg`).

**Incubator pipeline** (`INC_DIAGRAM_2.PNG`): Uploaded → Pending (AI) → Manual Review →
(No → Incomplete → Query founder → Responses → Uploaded) / (Yes → **AI Evaluate, gate
score > 5**) → Assigned (jury) → Jury evaluation (Score/Shortlist/Reject) → Reject→Archive
/ Shortlisted → Intro (associate sets calls) → Signup → Ready to onboard.

**VC roles:** Managing Partner (Superuser), Admin, Partner/Principal, IC Member,
Investment Associate, Analyst (read-only).

**VC pipeline** (`AISJ_VC_eval_roleflow_v2.png`): Analyst (upload, AI eval, core scores) →
Associate (core+additional, shortlist) → Partner (core+additional, shortlist) → Partner
call (Sponsor to IC / Pass / Another meeting) → Investment DD (MP approval) → IC members
(per-member: Invest/Hold/Need more info/Pass) → Managing Partner discretion →
Pass→Archived / Invest→Alignment call→Term sheet→Legal DD→Onboard ready /
Revisit→Return to Partner. Not-shortlisted → Archived (revivable).

Model both pipelines as a **shared state-machine module** (`src/pipeline/`): a config
object per edition defining stages, allowed transitions, and which role may perform each
transition. This keeps the two products on one engine instead of forked code.

## Backend (Worker + Hono) — `src/server/`

- `index.ts` — Hono app; serves static assets fallback + mounts `/api`.
- `auth/` — email + password (or magic-link via KV token), session cookies in KV,
  role-based middleware `requireRole(...)`. Founder auth is a lighter guest/token path.
- `routes/` — resource routers: `decks`, `uploads` (R2 presigned/put + Queue enqueue),
  `evaluation`, `scores`, `pipeline` (transitions), `assign`, `queries`, `calls`,
  `analytics`, `config` (parameters/weights/prompts/thresholds), `users`, `tickets`,
  `plans`.
- `ai/evaluate.ts` — builds the extraction+scoring prompt from `parameters` +
  `rubric_anchors` + org system-prompt override, sends R2 PDF as a document block to
  Claude, parses structured JSON into `deck_extractions` + AI `scores`, applies the
  `score > 5` gate. Invoked by the Queue consumer for bulk and directly for single upload.
- `queue.ts` — consumer that runs `ai/evaluate.ts` per enqueued deck.
- `scheduled.ts` — cron: reminder emails to evaluators with pending decks.

## Frontend (React SPA) — `src/client/`

- **Vite + React + TypeScript + Tailwind**, built to static assets the Worker serves.
- **Design system** (`src/client/theme/`): encode brand tokens as Tailwind theme —
  amber `#E8A020`, near-black `#1A1A2E`, off-white `#F5F7F2`, military green `#3B4A3F`,
  deep green `#4A6644`, dividers `#D8DDD2`/`#2D3D2A`, muted `#888888`; **DM Sans** UI font,
  **DM Mono** for scores; uppercase letter-spaced labels; light + dark surfaces. Bundle the
  logo PNGs (`SJ logo *`) as assets; self-host fonts.
- **Shared component library**: KPI tile, deck card/table row with signal tag, score
  radar/bars, rubric editor, pipeline board, evaluation drawer ("Evaluation report"),
  parameter/weight config, activity log, funnel/drift charts (use `dataviz` skill).
- **Role-based shell**: sidebar navigation is derived from the current role's permitted
  stages/features (mirrors each prototype's nav). One app; the launcher becomes a real
  post-login role landing. Route guards enforce role access.
- **Screens to rebuild** (per role, from the mockups): dashboard/KPIs, Upload (single/bulk/
  CRM), Review decks, Evaluate + Evaluation report, Assign, per-stage Pipelines, Intro/
  Partner/Alignment calls, Investment DD, IC voting, Term sheet, Legal DD, Onboard ready,
  Archive, Founder query flow, Config (Core/My parameters, AI prompt, thresholds), Branding,
  Tickets, Contact, and all analytics (Cohort summary, Evaluator scores, Score drift,
  Pipeline funnel; Capital Deployment, Portfolio Construction, Scoring Summary, Diligence &
  Risk, Decision History). Plus a **Founder portal** (register, upload, respond to queries,
  sign up).
- Use the existing prototype HTML in `STARTUPJURY-TEAM-FOLDER` as the pixel/UX reference
  for each screen while rebuilding with live data.

## Repo layout & tooling

```
startup-jury/
  wrangler.jsonc          # Worker, static assets, D1/R2/KV/Queue bindings, cron
  package.json            # scripts: dev (vite + wrangler), build, deploy, db:migrate
  migrations/             # D1 SQL migrations (schema + seed rubric/params + demo data)
  src/client/             # React SPA (Vite root)
  src/server/             # Hono API, ai/, queue.ts, scheduled.ts, auth/
  src/pipeline/           # shared stage machine (incubator + vc configs)
  src/shared/             # types shared client/server (roles, stages, parameter defs)
```

Secrets: `ANTHROPIC_API_KEY` via `wrangler secret`. Follow `workers-best-practices` and
`wrangler` skills for config; `cloudflare-email-service` for outbound email setup.

## Session-scoped build phases

This is a multi-session build. Each phase below is scoped to fit **one working context
window**: it has a single theme, a bounded file set, its own tests, and ends at a green,
committed, pushed state. A new session can start cold from `git log` + this plan + the
phase's acceptance criteria without needing prior conversation history. Phases are ordered
by dependency; each builds on a working previous phase.

**Phase 0 — Scaffold & CI.** _(done)_ Worker + Vite + Hono + Tailwind + TypeScript;
`wrangler.jsonc` with bindings + local dev; Vitest (unit) + `@cloudflare/vitest-pool-workers`
(Worker integration) + Playwright (e2e) wired; `.github/workflows/ci.yml` runs
typecheck + lint + all tests. Health-check route + one passing test of each kind.
_Acceptance:_ `npm run dev` serves a page hitting `/api/health`; `npm test` green in CI.

**Phase 1 — Data & auth.** _(done)_ D1 schema + migrations; seed 13 core params, rubric
anchors, thresholds, demo users/decks; auth (login, KV sessions, `requireRole`);
`src/shared` role/stage/parameter types; `src/pipeline` state-machine configs (no UI yet).
_Tests:_ migration applies clean; pipeline transition matrix unit tests (legal/illegal
transitions per role for both editions); auth middleware tests (session, role gate).

**Visual mockup review gate (start of Phases 2, 4, 5, 7).** Before building any role's UI,
render that role's prototype HTML from `STARTUPJURY-TEAM-FOLDER` in a headless browser,
screenshot every screen/state, and match layout, copy, and interactions exactly. The two
Superuser mockups are the feature supersets; per-role mockups trim nav/actions per the
permission matrix. This is where pixel/UX detail is verified — not up front.

**Phase 2 — Design system & app shell.** _(done)_ Tailwind brand tokens, fonts, logo assets;
shared components (KPI tile, deck card/row+signal tag, score bars, drawer, nav); role-based
sidebar + route guards; real login → launcher → role landing.
_Tests:_ component unit tests; Playwright e2e — each role logs in and sees only its
permitted nav (asserted against the permission matrix).

**Live demo deployed (from Phase 2).** _(done)_ To let non-technical stakeholders view the
product as it's built, the app is **deployed to Cloudflare early** and kept live from Phase 2
onward, rather than deploying only once at the end. Provisioned so far: remote **D1**
(`startup-jury-db`) + **KV** (`SESSIONS`), real ids in `wrangler.jsonc`, remote migrations
applied, `wrangler deploy` → `https://startup-jury.jay-komarraju.workers.dev`. A viewer guide
lives at `docs/DEMO.md` (demo URL + per-role logins). **This does not change the final target
app** — it front-loads provisioning that was originally bundled into Phase 8. Remaining
infra (R2, Queues, `ANTHROPIC_API_KEY` secret, Cron) is provisioned in the phase that first
needs it (below). **Keep the demo current: redeploy at each phase boundary** (`wrangler deploy`
+ `wrangler d1 migrations apply … --remote` for new migrations) after the green gate passes.

**Phase 3 — Upload & AI evaluation.** R2 upload (single/bulk), Queue consumer,
`ai/evaluate.ts` (Claude PDF→structured extraction+scores), `score > 5` gate, Review-decks
+ Evaluation-report screens. **Infra:** provision remote **R2** bucket + **Queue** and add
their bindings to `wrangler.jsonc`; `wrangler secret put ANTHROPIC_API_KEY`. Redeploy at the
end so the demo gains live upload+scoring.
_Tests:_ evaluate.ts with a **mocked Anthropic response** (deterministic) — parsing, gate,
DB writes; Worker integration test of upload→queue→stage; one live-API smoke test behind a
flag using a real sample PDF.

**Phase 4 — Incubator pipeline.** assign → jury eval → shortlist → intro → signup →
onboard/archive; founder query loop + email (stubbed outbox); Incubator role dashboards/nav.
_Tests:_ full-path integration test (upload→onboard) + reject/archive + query-loop branch;
authZ per stage; e2e for jury + associate happy paths.

**Phase 5 — VC pipeline.** Analyst → Associate → Partner → Partner call → Investment DD →
IC voting → MP decision → Alignment call → Term sheet → Legal DD → Onboard; VC dashboards/nav.
_Tests:_ full VC-path integration (analyst→term sheet→onboard) + pass/archive + return-to-
partner branch; per-member IC vote aggregation; e2e for IC member + partner.

**Phase 6 — Config, plans & credits.** Parameter/weight editors, AI-prompt customization,
threshold editor, branding, plan-tier gating (Standard/Pro/Premium) of additional params,
admin-granted credits.
_Tests:_ weight-change re-scoring math; plan gating hides/shows additional params; credit
decrement on upload.

**Phase 7 — Analytics & polish.** Incubator + VC dashboards (Cohort summary, Evaluator
scores, Score drift, Pipeline funnel; Capital Deployment, Portfolio Construction, Scoring
Summary, Diligence & Risk, Decision History); tickets/contact; reminder cron; empty/loading/
error states.
_Tests:_ analytics aggregation unit tests against seeded AI-vs-human scores; cron reminder
selects correct pending decks; e2e dashboard render.

**Phase 8 — Production hardening & final deploy.** The app has been continuously deployed
since Phase 2 (D1/KV from Phase 2; R2/Queue/secret/Cron added in the phases that needed
them), so this phase is **finalization, not first deploy**: verify all bindings/secrets are
provisioned; optional custom domain + route; remove/secure the demo seed logins (or gate the
public demo) for a real launch; final remote migration run; full live smoke test of
upload→evaluate→advance across both editions.
_Tests:_ post-deploy smoke script against the live Workers URL.

## Testing strategy (every phase)

- **Unit** (Vitest): pure logic — pipeline transitions, scoring math, prompt building,
  parsers, authZ decisions.
- **Worker integration** (`@cloudflare/vitest-pool-workers`): routes against real local
  D1/R2/KV/Queue bindings; Anthropic mocked by default.
- **E2E** (Playwright): role logins, nav visibility, full pipeline click-throughs.
- **Definition of done per phase:** typecheck clean, lint clean, all three test tiers green
  for that phase's surface, acceptance criteria met, and the `verify` skill used to drive the
  real flow where there's a UI. Run `/code-review` on the phase diff before pushing.
- No phase is "done" with failing/skipped tests; if a flow is stubbed (e.g. email), the stub
  is tested and the stub is called out in the commit.

## Git workflow (direct to main — no PRs)

- **Commit directly on `main`.** No per-phase branches, no PRs (solo build; the local green
  gate below is the review gate).
- **Commit frequently within a phase** at each meaningful green step (small, described
  commits) so a compacted/new session can resume from `git log`.
- **Green gate before every push:** typecheck + lint + all test tiers + build pass locally,
  and `/code-review` on the phase diff, before pushing. `main` stays deployable at all times.
- **Push at each phase boundary** (and mid-phase when convenient). CI also runs on push to
  `main` as a backstop.
- Commit messages end with the required `Co-Authored-By` trailer.
- Deploys use the user's already-authenticated `wrangler` CLI. A **public demo is live from
  Phase 2** (`https://startup-jury.jay-komarraju.workers.dev`); **redeploy at each phase
  boundary** after the green gate so it reflects the latest build. Provisioning new remote
  resources (R2/Queue/secret) and the redeploy are outward-facing — proceed for the demo, but
  confirm with the user before anything destructive (deleting resources, custom domains, a
  "real" launch that removes demo logins).

## Handoff document (updated after every phase)

A detailed **`HANDOFF.md`** at the repo root is the single source of truth for resuming in a
new/compacted session. It is **rewritten/appended at the end of every phase** and committed
as part of that phase's final commit. Each phase entry records: status; what shipped;
architecture decisions; data/API changes; how to run/test; gotchas/TODO/stubs; and a precise
"resume here" pointer with acceptance criteria.

A new session should be able to start from `HANDOFF.md` + this plan + `git log` alone.

## Tooling notes
- **No Cloudflare MCP server is enabled**; provisioning/migrations/secrets/deploys go through
  the authenticated `wrangler` CLI. Node 22 required (`nvm use`).

## Verification (applies throughout)

- **Local dev:** `wrangler dev`/`npm run dev` with local D1/R2/KV; seeded demo data; click
  each role's launcher → dashboard → key flow via the `verify` skill.
- **End-to-end AI flow:** real sample PDF → R2 object → Queue job → Claude structured scores
  → correct stage per the `>5` gate → Evaluation report renders extraction + per-parameter
  scores + weighted total.
- **Pipeline correctness:** drive a deck through full Incubator (upload→onboard) and full VC
  (analyst→term sheet→onboard) paths, asserting role-gated transitions and reject/archive/
  return branches; verify `pipeline_events` audit + Activity Log.
- **AuthZ:** each role sees only permitted nav/actions; founder portal isolated to own decks.
- **Deployed check:** after `wrangler deploy`, repeat the core upload→evaluate→advance smoke
  test against the live Workers URL.

## Open items to confirm during build
- Outbound email: enable Cloudflare Email Sending (verify domain) — needed for founder
  queries/invites; stub to a logged outbox until the domain is verified.
- PDF-only uploads to start (matches "pitch deck"); other formats later.
- Credits/billing is admin-granted (no external payment provider), per Cloudflare-only.
