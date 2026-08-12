# FINISH-PLAN — ai.STARTUPJURY completion track

Master plan to take the app from "backend/pipeline complete" to the **fully finished product** —
full parity with the design prototypes **plus** every ask from the meetings. Single source of truth
for a build split across multiple **fresh** Claude sessions (each started with no prior context).
Updated at the end of every session.

**Reconciled against the full Jul 24, 2026 demo transcript** (see §8 — Meeting clarifications). If §8
and older notes ever disagree, **§8 wins.**

**Target delivery:** Saturday **15 Aug 2026, 09:00 IST** (fully completed, at least this scope).

---

## 0. How to use this document — READ FIRST, every session

Each build session is a **fresh Claude session with zero memory of the others.** Before doing anything:

1. **Read this whole file** — the §8 clarifications, your session's spec (§4), the §6 Progress Log
   (what the previous session actually changed), and §9 Known issues.
2. **Read [`HANDOFF.md`](../HANDOFF.md)** (architecture, bindings, workflow, gotchas) and skim
   [`docs/PLAN.md`](PLAN.md).
3. **Recall the project memories** (auto-loaded): `startup-jury-completion-gap`,
   `startup-jury-requirements-sources`, `startup-jury-open-scope-decisions`,
   `startup-jury-meeting-clarifications`, `phase5-vc-visual-gate`.
4. **Open the relevant prototype(s)** for your session from
   `/Users/jayanthkomarraju/Downloads/STARTUPJURY-TEAM-FOLDER/` (Incubator + VC "Final files") — the
   visual source of truth. Live copies: https://aisj-incubator-v2.netlify.app ·
   https://aisj-venturecapitalv2.netlify.app

Then do the session's work **thoroughly**, and before finishing complete the **End-of-session
checklist** (§5): update this file, commit, and write the next session's copy-paste prompt into §7.

---

## 1. Definition of Done — the final deliverable

Full parity + all asks. Check items off as sessions land them.

### Evaluator workbench (Session 1) ✅
- [x] In-app **pitch-deck PDF viewer** on both eval screens + report drawer (auth'd R2 stream) — slides visible, click to enlarge, next/prev
- [x] Per-parameter **AI score breakdown** visible to the evaluator (not just the composite)
- [x] **Research** button (top-right) → juror's own ChatGPT/Claude/Perplexity/Gemini/Copilot (external, **no company tokens**)
- [x] **AI · Jury · Average** columns; the Average auto-updates live as the juror scores each parameter
- [x] **Deck X of N** progress ("deck 3 of 5 assigned to you") + next/prev across the assigned queue
- [x] **Rescore guard** — only allow re-score when the **deck content changed** OR the **admin criteria/prompt changed**; otherwise block with an "already scored" alert

### Program & cohort hierarchy + configuration (Sessions 2–3)
- [x] `programs` + `cohorts` tables (Sector→Program→Cohort); decks FK; backfill migration _(S2, migrations 0011/0012 — also a `sectors` table)_
- [x] **Program is the umbrella** over everything; an org-admin creates programs; every evaluation belongs to a program _(S2)_
- [x] Program-level **project details**, incl. **VC fund fields** (fund size / allocated / deployed) that feed the Capital Deployment report _(S2)_
- [x] **First-run / org config** (incubator or VC name, branding) + **Set up wizard** (Org type → Configure → Select → Team) _(S2)_
- [x] Program/Cohort **filter dropdowns** in toolbar; "Applies to" program+cohort on parameters _(S2)_
- [x] **Parameter model:** core **13** (=100% composite) + **up to 3 role-scoped additional** params per role → **13 + 9 = 22** per edition; additional are **AI-scored (assistive)** + owned/remarked by their role, shown separately (own average), NOT folded into the 100% _(S3)_
- [x] Additional params are a **default list they can change**, each with a **configurable prompt** _(S3)_
- [x] **Plan gating:** Standard = no config (default 13) · Pro = configure core 13 · Premium = configure the additional 3 _(S3)_

### Roles & permissions (Session 4)
- [ ] **Program Manager decision authority** — jury shortlist routes to the **PM**, who decides/schedules (or assigns who schedules) the intro call; PM can also evaluate. Associate is the frontline executor.
- [ ] **Investment Associate** distinct from Analyst (associate = one shade senior; analyst can be an intern/uploader)
- [ ] **User management** — Super User (and per matrix) can **create users** (jurors, mentors, etc.)
- [ ] **Mentor** concept (role vs. user-type — confirm; see §8)
- [ ] **Admin console / My account / Buy credits** flows to prototype parity

### Automation & intake (Session 5)
- [ ] **Per-program minimum shortlist threshold** in the admin dashboard; the system **blocks** a juror from shortlisting a deck scoring **below** the program's threshold
- [ ] **AI determinism** — minimize run-to-run score variance (target ≤10%); rescore guard prevents needless re-runs
- [ ] **Duplicate / returning-startup flags** — soft alert on likely duplicate (cost-driven) and a **history tag** when a known company returns (e.g. seed→Series A); not a hard block
- [ ] **Upload validation** — required founder/contact columns (founder, email, phone, city, sector) enforced; **PDF-only**; missing detail → **Incomplete**
- [ ] **Deck versioning** — re-uploads saved as a new version with history

### Incomplete-deck resubmit loop + real email (Session 6)
- [ ] **Real email** via Cloudflare Email (replaces stub outbox)
- [ ] On **Incomplete**, auto-send the founder an email with a **tokenized link** listing the **missing/feedback sections** (traction/team/ask/etc.)
- [ ] Link → founder **updates those sections in the deck and re-uploads** (new version) → **auto re-score** → back to the evaluator with a fresh perspective (consolidated in the deck, not scattered Q&A)

### De-stub, scheduling, issue log (Session 7)
- [ ] VC **Query** + **Intro calls** screens (currently stubs) → real
- [ ] **ICS (.ics) invites** for **intro / partner / alignment** calls — organizer picks participants (team + founder, any email domain), app generates the universal `.ics`; populate `calls.scheduled_at`
- [ ] Internal **issue log** (in-app admin tracker) so the team logs testing issues in one place
- [ ] Investigate/fix the **stuck-at-"pending"** upload bug (§9)

### Polish & ship (Session 8)
- [ ] Brand polish; remove deprecated free-text program/cohort columns once migrated
- [ ] e2e coverage for every new screen/role; full green gate
- [ ] HANDOFF.md + demo docs + runbook updated; seed refreshed (programs/cohorts/params/fund data) so every screen is live
- [ ] Final `npm run smoke` green against the live URL

---

## 2. Standing rules for every session

- **Be thorough — spend the tokens.** Optimize for completeness per session, not for fewer tokens.
  Use parallel subagents for discovery and cross-file work; write real tests (unit + worker + e2e);
  don't defer or stub to "save context." Finish the session's scope before writing the handoff.
- **Green gate before every push:** `npm run typecheck && npm run lint && npm test && npm run build`,
  plus `npm run test:e2e` for any UI change. Fix, don't skip.
- **Workflow:** commit **directly to `main`** with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
  trailer. Keep `wrangler` pinned at **4.110.0**. Node 22 (`nvm use`).
- **Deploy at the session boundary:** `npm run build && npx wrangler deploy`; if the session added
  migrations, `npx wrangler d1 migrations apply startup-jury-db --remote` FIRST. Then `npm run smoke`.
- **Match the prototypes** for layout/copy; follow the **dataviz** skill for charts and the brand doc
  for color/type. Theme-aware (light/dark), CSP-safe (no external CDNs/fonts).
- **Keep the demo seed live and pristine** so every new screen is demoable.
- **Update this file** at the end of the session (§5). This doc is the only cross-session memory.

---

## 3. Progress tracker

| # | Session | Status | Landed commit(s) | Date |
|---|---------|--------|------------------|------|
| 1 | Evaluator Workbench | ✅ Done | `3f3bd30` (+ docs) | 2026-08-11 |
| 2 | Program & Cohort hierarchy + config wizard (+ VC fund fields) | ✅ Done | `c70cbcd` (+ docs) | 2026-08-11 |
| 3 | Parameter model — core 13 + role-scoped additional (AI-scored) + prompts + plan gating | ✅ Done | `f19b50b` (+ docs) | 2026-08-12 |
| 4 | Roles & permissions — PM authority, Associate/Analyst, user mgmt/mentor, admin console/account/credits | ⬜ Not started | — | — |
| 5 | Automation — shortlist floor, AI determinism, duplicates/returning, upload validation, deck versioning | ⬜ Not started | — | — |
| 6 | Incomplete-deck resubmit loop + real email | ⬜ Not started | — | — |
| 7 | De-stub VC screens + ICS scheduling + issue log + pending-bug fix | ⬜ Not started | — | — |
| 8 | Polish, full e2e, docs, final deploy | ⬜ Not started | — | — |

Legend: ⬜ Not started · 🔶 In progress · ✅ Done.

---

## 4. Session specs

Complete each session end-to-end (build + tests + deploy + doc update) in one fresh session.

### Session 1 — Evaluator Workbench
**Prototype:** `Incubator Final files/AISJ_INC_Jury_V3.html` (eval overlay ~6826–7029: deck viewer,
Research, AI|My|Avg). **Touch:** `EvaluatePage.tsx`, `VcEvaluatePage.tsx`, `EvaluationDrawer.tsx`,
`src/server/routes/decks.ts`, `src/client/api.ts`, `src/server/routes/pipeline.ts`.
1. **PDF viewer** — `GET /api/decks/:id/file` (requireAuth, edition/owner-scoped) streaming the R2 PDF
   (`application/pdf`); viewer pane on both eval screens + the report drawer (slide thumbnails + click-to-enlarge + next/prev). Graceful "pending/no PDF" state.
2. **AI breakdown** — show the per-parameter AI score alongside each parameter (not just the composite).
3. **Research button** (top-right) — dropdown opening the evaluator's own ChatGPT/Claude/Perplexity/
   Gemini/Copilot in a new tab, prefilled with a query from the startup name/sector. External only — **no company tokens, no API calls.**
4. **AI · Jury · Average** — three columns per parameter; the **Average** (e.g. AI 9 + juror 5 → 7)
   updates live as the juror scores. Header tiles AI / My / Average.
5. **Deck X of N** — "deck 3 of 5" + prev/next across the filtered assigned queue.
6. **Rescore guard** — persist a content+criteria fingerprint per evaluation; allow re-score ONLY when
   deck content changed OR admin criteria/prompt changed; else block with "already scored — nothing changed" (per §8).
**Acceptance:** both editions; unit/worker tests for the endpoint + guard; e2e (juror opens deck → sees
PDF + AI/My/Avg → rescore block fires). Green gate + deploy + smoke. Also glance at §9 pending bug.

### Session 2 — Program & Cohort hierarchy + configuration wizard
**Prototype:** `AISJ_IC_SuserV11.HTM` Set up wizard ~7009–7178, toolbar ~825–843, "Applies to" ~3269.
1. **Schema** (migration): `programs` (id, edition, sector, name, description, **fund_size/fund_allocated/
   capital_deployed** for VC, active) + `cohorts` (id, program_id FK, name, dates, active); add
   `decks.program_id`/`cohort_id`; backfill from existing free-text `decks.program`/`cohort` (keep old cols until S8).
2. **API** (new `programs.ts` or extend `config.ts`): CRUD sectors/programs/cohorts; list for filters.
   (Full PM ownership gating lands in S4 — for now admin/superuser.)
3. **First-run / org config** — org (incubator/VC) name + branding; **Set up wizard** (Org type →
   Configure → Select → Team) reachable from Settings.
4. **Toolbar Program/Cohort filters** feeding the decks list; **"Applies to"** program+cohort on parameters.
**Acceptance:** hierarchy persists; decks filter by program/cohort; VC program fund fields captured and
readable by the Capital report. Tests + green gate + deploy (migrate --remote first) + smoke.

### Session 3 — Parameter model: core 13 + role-scoped additional (AI-scored) + prompts + plan gating
**Prototype:** Core Parameters + My Parameters screens (13-param array `AISJ_IC_SuserV11.HTM` ~3910;
VC ~4411). **Read the prototype to confirm exact additional-param owners per edition.**
1. **Additional params first-class** — role-scoped (Incubator: **program_associate, program_manager,
   jury**; VC: **analyst/associate, partner, ic_member** — CONFIRM from prototype), **up to 3 per role**,
   default examples that can be **renamed** with a **configurable AI prompt** each. Total 13 + 9 = **22**/edition.
2. **AI scores them (assistive)** — `evaluate.ts` already includes active params in the tool enum;
   ensure additional-param prompts are passed and their AI scores stored, but keep the **weighted
   composite = core 13 (=100%)**; surface additional AI+human scores separately (own average).
3. **Human ownership** — the owning role scores/remarks its 3 additional params (extend the eval form / My Parameters).
4. **Plan gating** — Standard: no config · Pro: configure core 13 · Premium: configure additional 3.
   Configuring prompts happens in program setup / admin console.
5. Update the **rescore guard** trigger set so an admin criteria/prompt change is a valid re-score reason.
**Acceptance:** 22 params visible/scored per edition; plan gating enforced (402/hide); prompts editable;
tests for AI-includes-additional + composite-unchanged + plan gates. Green gate + deploy + smoke.

### Session 4 — Roles & permissions
**Prototype:** ProgManager vs Prog assoc Set up authority diff; `openAdmin/openAccount/openBuyCredits`.
1. **PM decision authority** — update `src/pipeline/incubator.ts` + `pipeline.ts`: a jury **shortlist**
   routes to the **program_manager**, who decides and **schedules or assigns** the intro call; PM can
   assign jury and evaluate; PM manages cohorts for programs they lead (owner-scoped). Associate stays
   frontline executor; Associate read-only in Set up "Standard seat." Fix affected tests.
2. **Investment Associate vs Analyst** — ensure both exist distinctly (they do in code now) with the
   right VC flow (analyst uploads+scores → associate scores + schedules intro call → partner …). Verify permissions.
3. **User management** — Super User (+ per role matrix) can **create users** (jurors, mentors, staff):
   new admin screen + `POST /api/users` (superuser/admin-gated). **Mentor:** decide role vs user-type
   (see §8) and implement the chosen shape.
4. **Admin console / My account / Buy credits** to prototype parity (extend `ConfigPage` or new screens).
**Acceptance:** PM drives decisions in a live walkthrough; user creation works; authZ tests updated. Green gate + deploy + smoke.

### Session 5 — Automation: shortlist floor, determinism, duplicates, upload validation, versioning
1. **Per-program shortlist threshold** — admin sets a **minimum score per program**; block a juror
   shortlisting below it with a clear message ("below the program's shortlist minimum"). Store on the program (or org+program).
2. **AI determinism** — reduce run-to-run variance (deterministic model settings/temperature; the
   rescore guard prevents needless re-runs). Document the residual-variance expectation.
3. **Duplicate / returning** — at upload, match on name/founder/email: soft **duplicate alert**
   (cost-driven, not a block) + a **returning-company history tag** when a known company re-applies.
4. **Upload validation** — enforce required columns (founder, email, phone, city, sector), **PDF-only**;
   missing detail → **Incomplete**. Bulk: extraction fills details; per-row errors surfaced.
5. **Deck versioning** — re-upload saves a new version with history (feeds the resubmit loop in S6).
**Touch:** `decks.ts`, `evaluate.ts`, `UploadPage.tsx`, `config.ts`, `shared/scoring.ts`, migration.
**Acceptance:** tests for each rule (block-below-threshold, duplicate alert, required-fields, versioning). Green gate + deploy + smoke.

### Session 6 — Incomplete-deck resubmit loop + real email
**⚠️ Needs the sending domain (ask if not in §6 log).**
1. **Real email** — wire Cloudflare Email Sending (see the `cloudflare-email-service` skill) into
   `src/server/email/outbox.ts`; keep `email_outbox` as an audit log. Add binding/secret to `wrangler.jsonc`.
2. **Auto-notify on Incomplete** — when `evaluateDeck` sets `status='incomplete'`, automatically email
   the founder a **tokenized link** listing the **missing/feedback sections** (from the extraction's missing flags). No separate Q&A form — feedback sections only.
3. **Resubmit loop** — link → founder page to view feedback + **re-upload the updated deck** (new
   version via S5) → **auto re-score** → deck returns to the evaluator. Everything automatic.
**Acceptance:** worker test (incomplete → outbox row + send with link); a real live test to an inbox; resubmit → new version → re-score. Green gate + deploy + smoke.

### Session 7 — De-stub VC screens + ICS scheduling + issue log + pending bug
1. **VC Query + Intro calls** — implement the real screens (currently `StubPage`); wire the VC branch in
   `App.tsx` + `StagePage`/components. Prototype `AISJ_VC_Superuser_V6.html`.
2. **ICS scheduling** — `.ics` (VCALENDAR/VEVENT) generation for **intro / partner / alignment** calls;
   organizer picks participants (team + founder, any email domain); populate `calls.scheduled_at`; offer
   .ics download + email invite. Jury/IC involved in a call can **view** their calls (read-only). Pure builder + tests.
3. **Issue log** — in-app admin issue tracker (reuse tickets infra with an internal category/route) for the team to log testing issues.
4. **Pending bug** — investigate/fix decks stuck at "pending" (§9).
**Acceptance:** no remaining nav stubs; ICS validates in a real calendar; issue log CRUD. Green gate + deploy + smoke.

### Session 8 — Polish, full e2e, docs, final deploy, demo readiness
Brand polish; drop deprecated free-text program/cohort columns if fully migrated; comprehensive e2e
across all new screens/roles; refresh seed (programs/cohorts/22 params/VC fund data) so every screen is
demoable; update `HANDOFF.md` (finish track complete), `docs/DEMO*.md`, runbook. Final green gate +
deploy + `npm run smoke`. Mark all §1 boxes and the §3 tracker ✅.

---

## 5. End-of-session checklist (do before finishing every session)

1. ✅ Green gate passed; deployed; `npm run smoke` green.
2. ✅ Checked off completed **§1** items; set the **§3** row to ✅ + commit hash + date.
3. ✅ Appended a **§6** Progress Log entry: what changed, files/migrations, new bindings/secrets,
   decisions made, and anything the next session needs (gotchas, the email domain, the mentor decision, etc.).
4. ✅ Replaced the **§7** CURRENT NEXT-SESSION PROMPT with the next session's prompt (use the template).
5. ✅ Committed everything to `main`, including this updated file.

---

## 6. Progress log

_(Append newest at the bottom. One entry per completed session.)_

- **2026-08-11 — Planning.** Gap analysis done; scope locked (full parity + all asks, marketing site
  separate, real email with domain ready, PM decision authority). Plan created.
- **2026-08-11 — Reconciled with the Jul 24 demo transcript.** Restructured to 8 sessions; added §8
  clarifications and §9 known issues. Key adds/changes: additional params are AI-scored + role-scoped +
  prompt-configurable with precise plan gating (Standard/Pro/Premium) and a 22-param total; shortlist
  threshold is a **per-program floor that blocks below**, not full auto-shortlist; incomplete flow =
  email a tokenized link → founder updates sections in the deck → **re-upload (new version)** → auto
  re-score (no scattered Q&A); ICS is the final scheduling verdict for intro/partner/alignment calls;
  duplicate **alert** + returning-company **history tag** (soft, cost-driven); user management + a
  **mentor** concept; VC **program fund fields** feed Capital Deployment; deck **versioning**. No code yet.
  **Next session: Session 1 (Evaluator Workbench).**

- **2026-08-11 — Session 1 (Evaluator Workbench) shipped.** Commit `3f3bd30` (+ this doc commit).
  Both incubator + VC evaluate screens now render a shared **`EvalScorecard`** workbench, and the report
  drawer got the deck viewer too. Green gate: typecheck + lint + **168 unit/worker (1 skipped)** + build +
  **29 e2e**. Deployed (remote D1 migrated first) + `npm run smoke` 26/26; live-verified the new endpoints.
  - **PDF viewer.** New auth'd **`GET /api/decks/:id/file`** streams the R2 PDF (edition/owner-scoped;
    404 `no_pdf` when there's no object). Client **`DeckPdfViewer`** renders pages with **pdf.js**
    (`pdfjs-dist@4.10.38`, pinned) as a slide strip → click-to-enlarge lightbox with prev/next + a
    graceful "no PDF / error → Open PDF" fallback. The pdf.js worker is **self-hosted** via a Vite
    `?url` import (CSP-safe) and the lib is **dynamically imported** (never loads in node/jsdom tests).
  - **AI breakdown.** Detail endpoint (`GET /api/decks/:id`) now returns the parameter **`key`** on each
    AI score so the client joins scores→rubric; the per-parameter AI score + its rationale `comment` show
    inline on the scorecard (and as a tooltip in the drawer's `ScoreBars`).
  - **AI · My · Average.** Three columns per row + three header tiles; the **Average** recomputes live
    from `(ai+my)/2` as the juror moves a slider. **Research** button = new `ResearchMenu` opening the
    juror's OWN ChatGPT/Claude/Perplexity/Gemini/Copilot (prototype URLs) — external only, no tokens.
    **Deck X of N** + prev/next walks the filtered assigned queue.
  - **Rescore guard = version counters (not hashes).** Migration **0009** adds
    `org_settings.criteria_version`, `decks.content_version`, and `evaluations.scored_criteria_version` /
    `scored_content_version`. `evaluateDeck` stamps the AI roll-up with the current versions; new
    **`POST /api/decks/:id/rescore`** (team roles; founders 403) returns **409 `already_scored`** when both
    versions still match, else re-runs `evaluateDeck`. Admin criteria edits — `PUT /config/parameters`,
    `PUT /config/ai-prompt`, add/delete additional-params — **bump `criteria_version`** (so a criteria
    change validly unblocks a re-score; **content_version** bump is wired for the deck-versioning session).
  - **Seed (migration 0010).** TaxPilot (incubator, assigned) + WealthOS (VC, associate_review) get a full
    13-param AI breakdown + an AI evaluation row carrying versions, so the AI breakdown **and** rescore
    guard are live on the demo without a real R2 PDF (viewer shows its graceful "no PDF" state for those).
    The real slide viewer is demoed on a fresh upload.
  - **§9 pending-bug — quick look done + mitigated.** Root cause confirmed (throw-and-drop with no
    re-drive). Shipped a low-risk mitigation: **single upload now enqueues to the retry queue** on a
    synchronous model/billing error instead of stranding at `pending_ai`. Full fix (DLQ, cron sweep,
    clearer status surfacing, a manual re-drive lever) remains **Session 7's** scope — see §9.
  - **Gotchas for later sessions:** (1) worker-test storage is isolated **per file, not per test** — writes
    accumulate across `it`s in a file, so read current state (e.g. `criteria_version`) rather than
    hardcoding. (2) Playwright's port is now **`E2E_PORT`-overridable** (defaults 5173) because the dev box
    had another app on 5173; CI is unaffected. (3) The rescore-block e2e assertion is deterministic on the
    **VC** flow only — the incubator `config.spec` edits weights in parallel and bumps incubator
    `criteria_version`, so the incubator workbench e2e asserts the control's presence and the block itself
    is covered by worker + client tests.

- **2026-08-11 — Session 2 (Program & Cohort hierarchy + config wizard) shipped.** Commit `c70cbcd` (+ this
  doc commit). Sector → Program → Cohort is now the umbrella over everything, with VC fund economics feeding
  the Capital Deployment report. Green gate: typecheck + lint + **179 unit/worker (1 skipped)** + build +
  **31 e2e**. Deployed (remote D1 migrated first) + `npm run smoke` 26/26; live-verified the new endpoints +
  capital numbers on the deployed Worker.
  - **Schema (migrations 0011 + 0012).** `0011` adds **`sectors`** (id, edition, name, active), **`programs`**
    (id, edition, sector, name, description, **fund_size/fund_allocated/capital_deployed**, active) and
    **`cohorts`** (id, program_id FK, name, starts_on/ends_on, active); adds **`decks.program_id`/`cohort_id`**
    (+ indexes) and does a **generic backfill** from the free-text `decks.program`/`cohort` using
    `ROW_NUMBER()`-derived deterministic ids (old text columns kept until S8). `0012` enriches for the demo:
    sectors per edition, program sectors/descriptions, **VC fund data (Fund II = 300/210/92; Deep Tech Fund
    left NULL so `SUM(fund_size)` = the old 300 constant)**, and cohort dates. Backfill result: incubator →
    Fintech Accelerator / Climate Cohort / SaaS Accelerator (+ Cohort 5/6 nested); VC → Deep Tech Fund /
    Fund II. **`Climate Cohort` is a program name, not a cohort** (the word is a coincidence) — the backfill
    handles it correctly since it reads `decks.program`.
  - **API (`src/server/routes/programs.ts`, mounted `/api/programs`).** `GET /` (any authed — feeds the
    toolbar filters, the Applies-to selector and the wizard) returns `{ sectors, programs:[{…, cohorts:[…]}] }`,
    active-only unless `?all=1` (admin). Admin/superuser CRUD: `POST/DELETE /sectors`, `POST / · PUT/DELETE
    /:id` (programs, incl. fund fields, partial-update semantics — a fund key is only overwritten when
    present), `POST /:id/cohorts · PUT/DELETE /cohorts/:id`. All **edition-scoped** (cross-edition mutation →
    404). Hierarchy changes do **not** bump `criteria_version` (no scoring impact).
  - **Capital report wired to the DB.** `analytics.ts /capital` now sums the edition's **active programs'**
    `fund_size` (committed) + `fund_allocated` (allocated), falling back to the old `FUND_COMMITTED=300`
    constant only when no program carries a size. `CapitalReport` gains **`allocated`/`allocatedPct`**;
    `capitalDeployment(rows, committed, allocated=0)` (3rd arg optional — back-compat). `deployed` is still
    the sum of `portfolio.capital_deployed` (per-company, drives byCompany/median). Client CapitalPage adds
    **Committed + Allocated tiles** and an Allocated bar.
  - **Client.** New **`SetupWizard`** at `/app/setup` (Settings nav item `setup`, admin-only, icon `Wrench`):
    4 steps — Org type (writes `branding.orgName/orgType`, merges onto existing branding), Configure (real
    sector/program/cohort CRUD), Select (writes the active context), Team (read-only owner + a note that full
    user management lands in S4). New **`src/client/activeContext.ts`** — a per-edition localStorage store
    (`useSyncExternalStore`) shared by the dashboard toolbar filters, the upload form and the Applies-to card.
    Dashboard gets **Program/Cohort filter dropdowns** (+ a **first-run banner** when 0 programs) that re-fetch
    `GET /api/decks?programId=&cohortId=`. ConfigPage gets an **"Applies to"** card. UploadPage gets
    **Program/Cohort selectors** (default from active context) → `storeDeck` now writes `program_id/cohort_id`
    (legacy text columns left NULL on new uploads; they're dropped in S8).
  - **Gotchas for later sessions:** (1) **New uploads set `program_id`/`cohort_id`, NOT the legacy
    `program`/`cohort` text** — anything still reading the old columns sees NULL for post-S2 decks (they're
    deprecated; S8 drops them). (2) The capital test asserts `committed=300` — it comes from **Fund II's**
    seeded `fund_size`; if S3+ adds VC programs with fund sizes to the seed, that sum changes (soft-deleted /
    `active=0` programs are excluded). (3) The superuser nav superset is now **21** (added `setup`) — the
    `nav.test.ts` length assertion tracks it. (4) `program.sector` is **free text matched against
    `sectors.name`**, not an FK — deleting a sector doesn't rewrite programs that reference it.

- **2026-08-12 — Session 3 (Parameter model: core 13 + role-scoped additional) shipped.** Commit `f19b50b`
  (+ this doc commit). The rubric is now **13 core + 9 additional = 22 params per edition.** Green gate:
  typecheck + lint + **185 unit/worker (1 skipped)** + build + **31 e2e**. Deployed (remote D1 migrated
  first) + `npm run smoke` 26/26; **live-verified** 13+9 on both editions (incubator PA/PM/Jury ×3, VC
  associate/partner/ic_member ×3) with prompts, and the 9 assistive AI scores on the workbench decks.
  - **Owner roles — reconciled + CONFIRMED from the prototypes.** Incubator: **program_associate,
    program_manager, jury**; VC: **associate (Investment Associate), partner, ic_member**. The VC prototype
    tabs (`AISJ_VC_Superuser_V6.html` ~3717) are exactly these three (analyst is a distinct role — the
    Investment Associate is "an analyst with 3 configurable params", so the **associate** owns them, not the
    analyst). The incubator prototype (`AISJ_IC_SuserV11.HTM` ~3308) only drew **PM + Jury** tabs (a blank 3rd
    slot), but §8 names program_associate too and 3 roles × 3 = the required 22 total, so we seed all three
    (**§8 wins**, per the plan's own rule). Constants live in `shared/roles.ts`
    (`ADDITIONAL_PARAM_OWNERS`, `MAX_ADDITIONAL_PER_ROLE = 3`, `isAdditionalParamOwner`).
  - **Schema (migrations 0013 + 0014).** `0013` adds **`parameters.prompt`** (the configurable AI extraction
    prompt), **retires the interim 2-per-edition additional params from 0007** (`UPDATE … active=0 WHERE
    informational=1`), and inserts the **full 9-per-edition role-scoped set** (18 rows, all
    `informational=1, weight 0, role_scope set, prompt set`, sort_order 101–109). `0014` seeds **assistive AI
    scores for all 9 additional params** on the two workbench decks (TaxPilot inc, WealthOS vc) so the
    workbench's separate additional section + its own average are live on the seed (core-13 roll-ups 6.2 / 8.1
    are unchanged — additional weight 0).
  - **AI scores them (assistive).** `evaluate.ts` `ParameterRow` gains `informational?`/`prompt?`;
    `buildUserPrompt(params, anchors, ctx?)` lists the **core** areas as the weighted rubric and the
    **additional** params in a separate "assistive — NOT in the composite" section, each with its configurable
    prompt run through **`substituteVars`** ({{startup_name}}/{{sector}}/{{stage}}/{{program_type}} filled
    from the deck row + edition; unknown placeholders left intact). The forced-tool key enum already includes
    every active param, so the AI scores all 22; the composite = `weightedTotal` over the full weight, and
    additional params carry weight 0 → **composite stays core-13 = 100%** (unit-tested).
  - **Human ownership.** `POST /decks/:id/evaluate` now loads `informational/role_scope` and **stores an
    additional-param human score ONLY if `role_scope === user.role`** (silently skips other roles' — the form
    only presents the caller's own). `GET /parameters` returns `informational` + `roleScope` so the client
    splits core vs owned-additional. Client: **`EvalScorecard`** renders a separate **"Additional parameters ·
    your lens"** section (own AI·My·Avg, not in the composite); `EvaluatePage`/`VcEvaluatePage` derive
    `coreParams` + `ownedAdditional` (by `roleScope === user.role`) and submit both. **NB:** the eval-form
    roles that reach the workbench are jury/PM (inc) and associate/partner (vc); **program_associate &
    ic_member** own params (AI-scored + configurable + visible) but don't have a rubric eval screen yet, so
    their *human* additional scoring lands with the role-screen work in **Session 4**.
  - **Plan gating (authoritative `PLAN_META`).** `shared/plans.ts`: **`planAllowsCore` = Pro+**,
    **`planAllowsAdditional` = Premium** (moved up from Pro), plus `PLAN_PRIVILEGES` copy. `config.ts` gates
    **`PUT /parameters` (core 13) → 402 on Standard**, and **all additional-param CRUD → 402 unless Premium.**
    `POST /additional-params` now requires a valid **owner `roleScope`** (400 otherwise) and enforces **≤3 per
    role** (409 `role_full`). New **`PUT /additional-params/:id`** renames + edits the prompt. Summary/full
    config expose **`coreConfigEnabled`** + `additionalEnabled` and each param's `prompt`. Client:
    `ConfigPage` weights section locks read-only on Standard; `MyParamsPage` rewritten — grouped by owner role,
    editable label + AI-prompt per param, add (≤3) / rename / remove, **Premium** gate copy.
  - **Rescore-guard trigger set.** `criteria_version` already bumped on core-weight / AI-prompt /
    add / delete; **added the bump on `PUT /additional-params/:id`** so an admin **renaming or editing an
    additional param's prompt** is a valid AI re-score reason (worker-tested).
  - **Deviations from the prototype (intentional).** The prototype offers a per-additional-param weight select
    ("Informational / 5% / 10%"); we do **NOT** implement the weighted option — additional params are always
    informational (weight 0), because a 5%/10% additional weight would violate the plan's invariant
    "**composite = core 13 = 100%, additional shown separately**". Noted here so a later session doesn't
    "restore" it and silently break the composite.
  - **Gotchas for later sessions:** (1) **New uploads / AI runs now score 22 params**, but a human evaluator
    stores only core + their own role's additional — so per-evaluator `scores` counts are **role-dependent**
    (analyst/PA = 13; jury/PM/associate/partner/ic = 13 + up-to-3). Tests that counted `keys.length` were
    updated to count `informational=0 OR role_scope=<caller>`. (2) `0013` **retired** the 0007 additional
    params (`inc_add_program_fit` etc. are now `active=0`) — don't reference them. (3) Wrangler's OAuth token
    is **missing the `d1` scope in `whoami`** yet `d1 … --remote` still worked after a **transient 7403** on
    the first apply — just **retry** the migrate/deploy if you hit `code 7403`; it's not a code fault.
    (4) The `myparams` nav already lists all owner roles per edition (no nav change this session).

---

## 7. CURRENT NEXT-SESSION PROMPT

> Copy-paste the block below into a brand-new Claude Code session (in this repo) to run the next session.

```
You are continuing the ai.STARTUPJURY finishing build. This is a FRESH session with no prior context.

START by reading, in order:
1. docs/FINISH-PLAN.md  (the master plan — read ALL of it, especially §8 meeting clarifications, §9 known
   issues, and the §6 Progress Log entries for Sessions 1–3 — what shipped + gotchas left for you)
2. HANDOFF.md           (architecture, bindings, workflow, gotchas)
Recall the project memories (startup-jury-completion-gap, startup-jury-requirements-sources,
startup-jury-open-scope-decisions, startup-jury-meeting-clarifications, phase5-vc-visual-gate). Open the
ROLE / permission prototypes (the target UI) for this session:
- Incubator: "Incubator Final files/AISJ_INC_ProgManager_V2.HTM" + "AISJ_INC_Prog assoc.HTM" (Set up authority
  diff PM vs associate) and the Superuser "AISJ_IC_SuserV11.HTM" (openAdmin/openAccount/openBuyCredits, Team &
  roles / user creation).
- VC: "VC Final files/AISJ_VC_Superuser_V6.html" + per-role files (Analyst/Associate/Partner/IC member).
Also open the role-matrix image at the STARTUPJURY-TEAM-FOLDER root
("Startupjury role assignment role matrix.jpg").

YOUR JOB THIS SESSION: complete **Session 4 — Roles & permissions** exactly as specified in
docs/FINISH-PLAN.md §4 (Session 4):
- **PM decision authority** — a jury **shortlist** routes to the **program_manager**, who decides and
  **schedules or assigns** the intro call; PM can assign jury + evaluate; PM manages cohorts for programs they
  lead (owner-scoped). Associate stays the frontline executor (read-only in Set up "Standard seat"). Update
  `src/pipeline/incubator.ts` + `src/server/routes/pipeline.ts` role gates and fix affected tests.
- **Investment Associate vs Analyst (VC)** — both already exist as distinct roles; VERIFY the flow (analyst
  uploads+scores → associate scores + schedules intro call → partner …) and the permissions are right.
- **User management** — Super User (+ per the role matrix) can **create users** (jurors, mentors, staff): a new
  admin screen + **`POST /api/users`** (superuser/admin-gated). **Mentor:** DECIDE role vs user-type (see §8 —
  it's referenced but not yet a role) and implement the chosen shape; record the decision in §6.
- **Admin console / My account / Buy credits** — build to prototype parity (extend `ConfigPage` or add screens
  for `openAdmin`/`openAccount`/`openBuyCredits`).

Context you'll build on (from Sessions 1–3): the 22-param model + role-scoped additional params are done —
**program_associate & ic_member OWN additional params but have no rubric eval screen yet**, so if this
session gives them evaluation surfaces, wire their owned-additional section too (the eval endpoint already
accepts `role_scope === user.role`; `ADDITIONAL_PARAM_OWNERS` lives in `shared/roles.ts`). Roles are seeded in
`0002_seed.sql`; `ROLE_LABELS`/`ROLES_BY_EDITION` in `shared/roles.ts`; nav in `shared/nav.ts` (superuser
superset is 21). New uploads set `decks.program_id/cohort_id`.

Be thorough — spend the tokens: use parallel subagents for discovery, write unit/worker/e2e tests, and
follow the Standing Rules in §2 (green gate; commit to main with the Co-Authored-By trailer; wrangler
pinned 4.110.0; deploy — **`wrangler d1 migrations apply startup-jury-db --remote` FIRST** if you add a
migration — + npm run smoke at the end; keep the demo seed live). Node 22 via `nvm use`. If port 5173 is
busy, e2e takes `E2E_PORT=<free port>`. NB: if `wrangler … --remote` hits a transient `code 7403`, just retry.

BEFORE FINISHING: do the §5 End-of-session checklist — check off §1 items, update the §3 tracker, append
a §6 Progress Log entry, and replace this §7 prompt with the Session 5 prompt. Commit the updated plan to main.
```

### Next-session prompt template (for future sessions)

```
You are continuing the ai.STARTUPJURY finishing build. This is a FRESH session with no prior context.

START by reading: docs/FINISH-PLAN.md (ALL of it — esp. §8 and §9) + HANDOFF.md; recall the project
memories; open the prototype(s) named in this session's §4 spec.

YOUR JOB THIS SESSION: complete **Session <N> — <title>** exactly as specified in docs/FINISH-PLAN.md §4.
Check the §6 Progress Log for what the previous session changed and any notes left for you (email domain,
mentor decision, additional-param owners, etc.).

Be thorough — spend the tokens (parallel subagents, real tests, follow §2 Standing Rules: green gate,
commit to main, wrangler 4.110.0, deploy + npm run smoke, keep the seed live).

BEFORE FINISHING: do the §5 End-of-session checklist — update §1/§3, append a §6 log entry, and replace
the §7 prompt with the Session <N+1> prompt. Commit the updated plan to main.
```

---

## 8. Meeting clarifications — Jul 24, 2026 demo transcript (authoritative)

Concrete decisions from the recorded demo with Chandrasekhar (product), Ravi, Kalyan, and Jay:

- **Incomplete decks → resubmit the DECK (not scattered Q&A).** On Incomplete, auto-email the founder a
  **link**; they see the **missing/feedback sections** (traction, team, ask, financials…), **update those
  sections in the deck, and re-upload**. App **re-scores** and returns it to the evaluator. Chosen because
  otherwise info is scattered across the deck + separate artifacts. Re-upload saves as a **new version**.
  All automatic. (No separate question-answer form needed — feedback sections suffice.)
- **Rescore prevention.** Do **not** rescore unless the **deck text content changes** OR the **admin
  changes the criteria/prompt** (the 13–14 prompt criteria). If someone tries with no change → **alert /
  block**: "already scored, we will not score again." Protects confidence (AI is nondeterministic).
- **AI variance.** Run-to-run scores vary (nondeterministic). Target: keep variance **within ~10%**;
  minimize it. (Separately, flagging AI-vs-jury score **differentials >20–30%** for model feedback is a
  future analytics idea.) Human review is always the final decision — never AI-only.
- **PDF viewer** in the evaluation screen: show the actual uploaded deck (slides on top, click to
  enlarge, next/prev), plus the **per-parameter AI breakdown**, alongside jury scoring.
- **AI · Jury · Average.** Third column = **average**, auto-updating as the juror scores (AI 9 + juror 5 → 7).
- **Deck X of N** progress on the eval screen ("you're on deck 3 of 5 assigned to you today").
- **Research button** (top-right): evaluator uses their **own** AI access (Claude/Gemini/etc.) — **must
  not consume company tokens** (fixed-price model; tokens are for evaluation only).
- **Shortlist threshold.** Admin dashboard sets, **per program**, a **minimum score**; a juror **cannot
  shortlist** a deck scoring **below** it (system prevents it). Uniform, program-specific floor. (Jury
  still does the shortlisting; this is a guardrail, not full auto-shortlist.)
- **Program Manager role.** Program associate = frontline "does all the work"; **program manager = decision
  maker.** Jury shortlist → **PM** decides/schedules (or assigns who schedules) the intro call. PM can also
  evaluate. Add/confirm this authority.
- **Investment Associate (VC)** is a distinct role, "one shade senior" to Analyst (analysts can be interns).
  Analyst uploads + scores; associate reviews + scores + schedules intro call; partner sponsors + may add a
  call; IC members evaluate + remark + **vote**; Managing Partner decides at discretion; alignment call;
  term sheet (valuation/ownership); **legal DD is a checklist/status only** (not done on-platform); then signup/onboard.
- **Scheduling = ICS (final verdict).** App generates a universal **.ics** invite to all participants (any
  email domain — Outlook/Gmail/etc.); organizer adds team + founder. Applies to **intro, partner, and
  alignment** calls. Back-and-forth rescheduling / availability is a future refinement.
- **Duplicate / returning company.** Same company returning (seed→Series A) must submit a **new deck**, but
  show a **history tag** + a soft "are you sure you're returning?" flag. Also a **duplicate alert** among
  many decks (each AI run costs money). Soft alerts, not hard blocks.
- **Upload validation.** Validate required founder/contact columns (founder, email, phone, city, sector);
  missing → **Incomplete**. Bulk upload: AI **extracts** these details (no manual per-deck entry). **PDF-only** (final).
- **Program is the hierarchy umbrella.** An **org-admin above** creates programs (like a project/industry
  vertical — EV, wind, carbon…). A program has **multiple cohorts** (e.g. Jan cohort, next-quarter cohort).
  Everything (upload/evaluate/score/reports) happens **within a program**. Program creation is a **wizard**
  (name, description, then parameters/prompts per plan). For **VC programs**, capture **fund amount /
  allocated / deployed** so Capital Deployment reports show real data. First-time users also configure their
  **org (incubator/VC) name + branding**.
- **Parameters = 13 core + up to 3 additional per role (role-scoped) = 22/edition.** Incubator adders:
  **program associate, program manager, jury**. VC adders: **analyst/associate, partner, IC member**
  (confirm exact set from the prototype). Additional params are a **default list they can change**, each
  with a **configurable prompt**, and **AI scores them too** (assistive) — but the weighted composite stays
  the **core 13 (=100%)**. **Plan gating:** Standard = no config; Pro = configure core 13; Premium =
  configure additional 3. Prompts are edited in the admin console / program wizard.
- **User management.** Super User (and per matrix) can **create users** — jurors, **mentors**, staff.
  ("Mentor" is referenced but not yet a role — decide role vs. user-type in Session 4.)
- **Website / marketing (OUT of app scope, separate site):** hybrid headline — open with "decision
  intelligence for the venture ecosystem," then get specific fast; positioned as more than deck-evaluation
  (whole ecosystem: investors, mentors, incubators). LinkedIn + About + team photos. Not this repo.

---

## 9. Known issues / bugs to investigate

- **Decks stuck at "pending".** _Root cause confirmed (Session 1)._ Every deck is created at `pending_ai`
  and `evaluateDeck` only moves it off on **full success** (one terminal `UPDATE` after the model call).
  On any throw — Anthropic billing/credit (`400 credit balance too low`) or rate (`429`), missing/invalid
  key, or missing R2 — nothing rewrote the status, and **nothing re-drove it**: single upload caught the
  throw and returned `202` (deck stranded, credit not refunded); bulk retried 3× then the message was
  **dropped (no DLQ)**; the cron only touches `assigned` decks; config re-score ignores unscored decks.
  So a persistent billing error strands the deck permanently.
  **Session 1 shipped a partial mitigation:** single upload now **falls back to `EVAL_QUEUE.send` on a
  synchronous eval error** (so it rides the retrying consumer instead of dead-ending). **Still owned by
  Session 7 (full fix):** configure a **dead-letter queue** for `startup-jury-evals`; add a **cron sweep**
  (or a manual **re-drive endpoint** / "re-run AI" action) for `pending_ai` decks older than N minutes;
  **refund the credit** on a terminal eval failure; and **surface the real reason** (replace the hardcoded
  "no AI key configured yet" upload copy, and distinguish "failed" from "in progress" in the decks table).
- **E42 sample** scored ~3.4 (missing team/traction/ask → Incomplete). That's correct behavior, not a bug —
  it's the canonical "incomplete deck" demo case for the resubmit loop.
