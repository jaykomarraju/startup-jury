# FINISH-PLAN — ai.STARTUPJURY completion track

Master plan to take the app from "backend/pipeline complete" to the **fully finished product** —
full parity with the design prototypes **plus** every ask from the meetings. Single source of truth
for a build split across multiple **fresh** Claude sessions (each started with no prior context).
Updated at the end of every session.

**Reconciled against the full Jul 24, 2026 demo transcript** (see §8 — Meeting clarifications). If §8
and older notes ever disagree, **§8 wins.**

**Target delivery:** Saturday **15 Aug 2026, 09:00 IST** (fully completed, at least this scope).

---

## 0. How to use this document

> **✅ The finish track is COMPLETE — all 8 sessions shipped (2026-08-11 → 2026-08-12).** There is no
> next session; §7 records the one open item (the email sending domain, an external step). What
> follows is the plan as executed, kept as the record of what was decided and why. **§8 (the meeting
> clarifications) and §9 (known issues) remain the authoritative reference** for anyone maintaining
> the app.

### The per-session procedure that was followed

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

### Roles & permissions (Session 4) ✅
- [x] **Program Manager decision authority** — jury shortlist routes to the **PM**, who decides/schedules (or delegates to the associate) the intro call; PM can assign jury + evaluate + shortlist/override. Associate is the frontline executor. PM manages cohorts for programs they lead (owner-scoped). _(S4)_
- [x] **Investment Associate** distinct from Analyst (associate = one shade senior; analyst can be an intern/uploader) — verified + locked with tests _(S4; VC intro-call scheduling screen + ICS is S7)_
- [x] **User management** — Super User / Admin **create users** (jurors, mentors, staff): `POST/GET/PATCH /api/users` + Admin console screen, edition-scoped, temp-password issue _(S4)_
- [x] **Mentor** = a **user-type**, not a role (role matrix + prototype dropdowns confirm) — `users.user_type` _(S4)_
- [x] **Admin console / My account / Buy credits** flows built (Buy credits = a simulated demo top-up, no real payment capture) _(S4)_

### Automation & intake (Session 5) ✅
- [x] **Per-program minimum shortlist threshold** in the admin dashboard; the system **blocks** a juror from shortlisting a deck scoring **below** the program's threshold _(S5, `programs.shortlist_min`)_
- [x] **AI determinism** — minimize run-to-run score variance (target ≤10%); rescore guard prevents needless re-runs _(S5, `temperature: 0`)_
- [x] **Duplicate / returning-startup flags** — soft alert on likely duplicate (cost-driven) and a **history tag** when a known company returns (e.g. seed→Series A); not a hard block _(S5)_
- [x] **Upload validation** — required founder/contact columns (founder, email, phone, city, sector) enforced; **PDF-only**; missing detail → **Incomplete** _(S5)_
- [x] **Deck versioning** — re-uploads saved as a new version with history _(S5, `deck_versions`)_

### Incomplete-deck resubmit loop + real email (Session 6) ✅
- [x] **Real email** via Cloudflare Email (replaces stub outbox) _(S6, `send_email` binding + `EMAIL_FROM`; **audit-only until the sending domain is onboarded** — see the §6 log)_
- [x] On **Incomplete**, auto-send the founder an email with a **tokenized link** listing the **missing/feedback sections** (traction/team/ask/etc.) _(S6, `resubmit_tokens`, migration 0017)_
- [x] Link → founder **updates those sections in the deck and re-uploads** (new version) → **auto re-score** → back to the evaluator with a fresh perspective (consolidated in the deck, not scattered Q&A) _(S6, public `/resubmit/:token`)_

### De-stub, scheduling, issue log (Session 7) ✅
- [x] VC **Query** + **Intro calls** screens (currently stubs) → real _(S7; Query is now one prototype-accurate screen for both editions, Intro/Partner/Alignment calls share the new `CallsPage`)_
- [x] **ICS (.ics) invites** for **intro / partner / alignment** calls — organizer picks participants (team + founder, any email domain), app generates the universal `.ics`; populate `calls.scheduled_at` _(S7, `shared/ics.ts` + `routes/calls.ts`, migration 0018)_
- [x] Internal **issue log** (in-app admin tracker) so the team logs testing issues in one place _(S7, `tickets.category='issue'`)_
- [x] Investigate/fix the **stuck-at-"pending"** upload bug (§9) _(S7 — DLQ + cron sweep + credit refund + real failure reason)_

### Polish & ship (Session 8) ✅
- [x] **`POST /api/users` emails the temp password** (Session 4's leftover) — `buildAccountInviteEmail`
      + `deliverInvite`, with the credential returned only when delivery genuinely didn't happen _(S8)_
- [⚠️] **Set the email sending domain** — **NOT DONE: the domain is still not onboarded** (confirmed
      with the user, 2026-08-12). This is the one item the finish track could not close, because it is
      an external DNS/dashboard step, not code. Delivery is audit-only and **no live inbox test has
      ever been run**. To go live: onboard the domain, set `vars.EMAIL_FROM`, `npx wrangler deploy` —
      **no code change.** Everything downstream (Incomplete notices, `.ics` call invites, user
      invites) starts delivering on that one line.
- [x] Brand polish; **deprecated free-text `decks.program`/`cohort` dropped** _(S8, migration 0019)_
- [x] e2e coverage for every new screen/role; full green gate _(S8, `e2e/coverage.spec.ts`, 69 e2e)_
- [x] HANDOFF.md + demo docs + runbook updated; seed refreshed so every screen is live _(S8, 0020)_
- [x] Final `npm run smoke` green against the live URL _(S8, **40/40**)_

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
| 4 | Roles & permissions — PM authority, Associate/Analyst, user mgmt/mentor, admin console/account/credits | ✅ Done | `4467bf7` (+ docs) | 2026-08-12 |
| 5 | Automation — shortlist floor, AI determinism, duplicates/returning, upload validation, deck versioning | ✅ Done | `aebe362`, `28c331e` (+ docs) | 2026-08-12 |
| 6 | Incomplete-deck resubmit loop + real email | ✅ Done | `2b385ff` (+ docs) | 2026-08-12 |
| 7 | De-stub VC screens + ICS scheduling + issue log + pending-bug fix | ✅ Done | `29c78e1` (+ docs) | 2026-08-12 |
| 8 | Polish, full e2e, docs, final deploy | ✅ Done | `7a011f7` (+ docs) | 2026-08-12 |

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

- **2026-08-12 — Session 4 (Roles & permissions) shipped.** Commit `4467bf7` (+ this doc commit). The
  incubator **Program Manager is now the decision maker**, **user management** (Admin console) + **My account**
  + **Buy credits** ship, and **mentor is resolved as a user-type**. Green gate: typecheck + lint +
  **206 unit/worker (1 skipped)** + build + **37 e2e**. Deployed (remote D1 migrated first — `0015`) +
  `npm run smoke` **27/27**; **live-verified** the mentor seed, PM login + owned programs on the deployed Worker.
  - **PM decision authority.** `src/pipeline/incubator.ts`: `program_manager` added to **`assign_jury`,
    `shortlist`, `reject`, `schedule_intro`** (jury shortlist routes to the PM who decides/schedules the intro
    call, or delegates to the associate — who keeps `schedule_intro`; associate stays the executor, e.g.
    `send_signup`). `pipeline.ts` `/assign` coarse gate now admits `program_manager` (lock-step with the
    config). Nav (`shared/nav.ts`): PM gains **`jurypipeline`** (oversight) + **`introcalls`** (decision
    surface). PM already could `/evaluate` + read `/jury`. Flipped the old "PM rejected by assign (403)"
    worker test → 200, added PM shortlist→intro (worker) + PM-authority + analyst/associate (unit) tests.
  - **Investment Associate vs Analyst (VC) — verified + locked (no structural change).** The VC intro-call
    **screen + ICS is Session 7**, so S4 only hardened the permissions with unit tests: analyst uploads +
    scores (`submit_for_ai`/`submit_core_scores`) but **cannot `shortlist_to_partner`** (associate-only), and
    the associate **cannot `sponsor_to_ic`** (partner-only). Roles already distinct in code.
  - **User management (Admin console).** New **`src/server/routes/users.ts`** (`/api/users`, superuser/admin
    via `requireRole("admin")`, **edition-scoped**): `GET` roster · `POST` create (generates a one-time
    **temp password** returned once; `hashPassword`; role validated by the shared **`creatableStaffRoles`** —
    excludes `superuser` + `founder`; unique email → 409) · `PATCH` activate/deactivate/rename/re-role
    (can't touch self or a superuser). Client **`AdminConsolePage`** (nav `admin`): roster + create form
    (name/email/user-type/role) + activate/deactivate. Mounted in `index.ts`.
  - **MENTOR DECISION = user-type, not a role.** Evidence: the role-assignment matrix has **no mentor
    column**, and **none** of the four prototype user-creation dropdowns list "Mentor" — it appears only as
    advisor terminology (a `mentor` field on cohort rows) + a scoring-parameter label. Implemented via
    **`users.user_type`** (`'staff'` default | `'mentor'`); a mentor row is `user_type='mentor'` +
    `role='mentor'` (a value in **no** authZ/nav list → zero pipeline power). Dedicated mentor tooling is
    future work. Seeded one demo mentor (`inc_mentor`, "Anil Mehta").
  - **PM owner-scoped cohorts.** Migration `0015` adds **`programs.owner_id`** (seed: `inc_pm` owns the
    incubator programs). `programs.ts` cohort CRUD (`POST /:id/cohorts`, `PUT/DELETE /cohorts/:id`) now
    admits `program_manager` + an inner **`canManageCohorts`** (admin/superuser OR the owning PM);
    **sector/program CRUD stays admin-only**. `ProgramView` gains `ownerId`. Worker tests: PM-owns ✓ /
    PM-doesn't-own → 403 / PA → 403 / sector+program CRUD by PM → 403.
  - **Set up wizard seats.** `SetupWizard` is role-aware: admin/superuser = full; **program_manager** =
    cohorts-only (owner-scoped, sectors/programs view-only); **program_associate** = read-only with the gold
    **"Standard seat"** banner (matches the prototype). Nav `setup` opened to PM + PA (incubator).
  - **My account + Buy credits.** `AccountPage` (nav `account`, all internal roles) — profile + plan/org +
    sign out. `BuyCreditsPage` (nav `billing`, admin) — the prototype's pay-as-you-go packs (Pro/Premium,
    20–50 credits) as a **SIMULATED demo top-up**: `POST /api/config/credits/purchase` atomically increments
    the balance. **No real payment / no card capture** — a Razorpay/UPI/card flow is deliberately out of
    scope (prohibited); the screen is clearly labelled "Demo mode."
  - **Nav.** Incubator superuser superset **21 → 24** (`admin`/`account`/`billing`); `nav.test.ts` bumped.
    VC superset 28 → 31 (unpinned, auto-derived). Icons `Building2`/`UserCog`/`CreditCard` registered.
  - **Gotchas for later sessions:** (1) The demo **mentor** (`inc_mentor`, `role='mentor'`) has an **empty
    nav** — if they log in they hit the "not available for your role" state (advisor tooling is future work);
    `nav.spec` uses a **hardcoded 12-user list** so the 13th user doesn't affect it. (2) **Buy credits is a
    simulated top-up** — real billing would replace it; do NOT add card/UPI/bank capture (prohibited).
    (3) Programs created via **`POST /api/programs` have `owner_id=NULL`** → no PM can manage their cohorts
    until an admin assigns an owner; there is **no owner-assignment UI** yet (only the column + the seed).
    (4) The §8 "associate schedules the intro call" (VC) is **deferred to Session 7** (Intro-calls de-stub +
    ICS) — S4 only verified the permissions. (5) `POST /api/users` returns the plaintext **`tempPassword`
    once** (no email yet); Session 6's real email should send it instead of surfacing it in the UI.

- **2026-08-12 — Session 5 (Automation) shipped.** Commits `aebe362` + `28c331e` (report-drawer read
  surface) (+ this doc commit). Intake now has real
  guardrails: a **per-program shortlist floor**, **deterministic AI scoring**, **soft duplicate / returning
  flags**, **required founder-detail validation → Incomplete**, and **deck versioning**. Green gate: typecheck
  + lint + **252 unit/worker (1 skipped)** + build + **40 e2e**. Deployed (remote D1 migrated first — `0016`)
  + `npm run smoke` **27/27**; **live-verified** on the deployed Worker (the floor returned a real
  `409 below_shortlist_minimum` with its message, the deck did not move, `versions` served 200, and
  `shortlistMin`/`decisionScore`/`shortlistBlocked` render on the deck view). The verification program+deck
  were inserted straight into remote D1 and **deleted afterwards** (`leftover_deck=0`, no credits spent), so
  the demo seed is untouched.
  - **Per-program shortlist floor.** Migration `0016` adds **`programs.shortlist_min`** (NULL = no floor).
    `routes/pipeline.ts` gates the two human "this deck moves forward on merit" actions — **`shortlist`**
    (incubator, jury_evaluation→shortlisted) and **`shortlist_to_partner`** (VC, associate_review→
    partner_review) — returning **409 `below_shortlist_minimum`** with `{message, score, minimum,
    programName}`. The check runs **after** `performAction`'s role gate, so a forbidden action still 403s
    first. The floor is **uniform — a superuser is held to it too** (§8: "the system prevents it"); the
    escape hatch is an admin lowering the floor, which is an auditable config change rather than a silent
    per-deck override. Non-shortlist transitions (e.g. `reject`) are never blocked.
  - **The deck is judged on its `decisionScore`, not `ai_score`.** New pure
    `shared/scoring.ts decisionScore(aiScore, humanTotals[])` = the AI composite averaged with the **mean of
    the human composites** — the composite form of the workbench's **AI · My · Average** column, so the
    number the floor rejects is the number the evaluator was looking at. AI-only when there are no human
    evaluations; **null (⇒ blocked) when the deck is unscored**. Deck list + detail now carry
    `decisionScore` / `shortlistMin` / `shortlistBlocked`, so `EvaluatePage` shows a live
    "Shortlist minimum 5.5 · this deck 6.11" hint next to the Shortlist button.
  - **Admin UI.** `PUT/POST /api/programs` accept **`shortlistMin`** (0–10, blank clears; `400
    invalid_shortlist_min`; present-key-only semantics like the fund fields). The **Set up wizard** gains the
    field on the create form plus an **inline per-program editor** so an existing program's floor can be
    raised/lowered without re-creating it.
  - **AI determinism.** `callAnthropic` now sends **`temperature: 0`** on top of the existing
    `thinking: { type: "disabled" }` + forced `tool_choice`. **The Messages API has no seed parameter** —
    temperature 0 is the strongest lever available. Prompt construction was already deterministic
    (`sort_order`ed params, sorted anchor bands). **Residual-variance expectation (documented in
    `ai/evaluate.ts`):** most re-runs identical; occasional single-parameter ±1 drift from serving-stack
    non-determinism; composite within roughly ±0.3/10 — inside the ~10% target. The real protection is still
    the S1 **rescore guard** (we don't re-run at all unless content or criteria changed).
  - **Upload validation → Incomplete.** Required columns = **founder, email, phone, city, sector** (exactly
    the prototype's `founder && email && phone && city && sector` completeness rule). New pure
    **`src/shared/intake.ts`** owns `missingIntakeFields` / `mergeIntakeDetails` / normalisation /
    validation. The single-upload form now collects founder+email+phone; the model extracts all five (new
    `founder_email`/`founder_phone`/`city`/`sector` tool fields, told explicitly to return **null rather
    than guess**); `evaluateDeck` merges with the **typed value winning** and the extraction filling blanks
    (which is how a bulk upload gets its details). **Anything still missing forces `status='incomplete'`,
    `complete=0` regardless of score**, and is stored as a CSV in **`decks.missing_fields`** — Session 6's
    resubmit email reads exactly that column. The Upload screen renders the prototype's
    "AI-extracted details" table with **"not captured"** cells and a Complete/Incomplete pill.
  - **Bulk per-row errors.** `POST /api/decks/bulk` no longer 413s the whole batch on one oversized file or
    silently drops a non-PDF: each file is validated individually and reported in **`results[]`**
    (`{file, ok, deckId?, error?, flag?, note?}`); credits are reserved for the **accepted** files only,
    still all-or-nothing. `400 pdf_required` only when *every* file is rejected (the response still carries
    `results` so the UI can say which).
  - **Duplicate / returning flags (soft, never blocking).** `classifyIntake` matches a submission against
    the edition's decks on **name / founder / email / phone** (names normalised past legal suffixes —
    "GreenGrid Energy Pvt Ltd" == "greengrid energy"; phones keyed on the last 10 digits). A match is
    **returning** when the earlier application already concluded (exit/terminal stage), the funding stage
    moved (seed→Series A), or the cohort differs; otherwise **duplicate**. Duplicate outranks returning.
    Stored on `decks.intake_flag` / `intake_flag_note` / `related_deck_id`. The check runs **before the AI
    call** (cost-driven — each run spends a credit) and again **inside `evaluateDeck`** with the extracted
    founder details, which is what catches duplicates in a bulk upload (filenames only up front).
  - **Deck versioning.** New **`deck_versions`** table (v1 backfilled for every deck with an `r2_key`).
    **`POST /api/decks/:id/version`** (staff + the owning founder) stores the new PDF at
    `decks/<id>_v<n>.pdf` **beside** the old object, appends a version row, re-points `decks.r2_key` and
    **bumps `content_version`** — which is exactly the signal the S1 rescore guard waits on, so the deck is
    **re-scored automatically** (queue fallback on a model error). **`GET /api/decks/:id/versions`** serves
    the history. v1 keeps the historical `decks/<id>.pdf` key so every pre-S5 object still resolves.
    This is the mechanism Session 6's incomplete-resubmit loop drives. The **report drawer** renders the
    history (v1…vN with note/uploader/date) alongside the missing-founder-detail list and the intake alert,
    so all three new data surfaces are readable in-app.
  - **Prototype reality check (mined all 13 prototype HTMLs).** The **upload validation** copy is real and
    was matched ("Uploaded decks — AI-extracted details", the `Deck | Founder name | Email ID | Phone
    number | City | Sector | Status` table, "not captured", Complete/Incomplete pills). The **shortlist
    threshold, duplicate/returning flags, deck versioning and bulk per-row errors do NOT exist anywhere in
    the prototypes** — they are §8-only asks, so their UI is our invention. (The only "threshold" in the
    prototypes is the static Best/Mediocre/Poor cohort-rating legend, already built in Phase 6, with a dead
    "Save & apply" button.) Prototypes also say "PDF or PPTX" — §8's **PDF-only is final**, so that stands.
  - **Deviation:** the prototype's juror screen has **no Shortlist control at all** (Submit / Save draft /
    Re-assign only); shortlisting lives on the admin/PM jury-pipeline. Our app has had a jury Shortlist
    button since Phase 4 per §8 ("the jury still does the shortlisting"), so the floor guards both surfaces.
  - **Gotchas for later sessions:** (1) **`evaluateDeck` now forces Incomplete on missing founder detail**,
    so every mocked `callModel` must return `founder_email`/`founder_phone`/`city`/`sector` or the deck lands
    `incomplete` — four existing worker tests were updated for this. (2) **No shortlist floor is seeded on
    Fintech Accelerator on purpose**: its demo decks (FinStack/InsureFlow) carry only ONE seeded AI parameter
    score each, so the parallel `config.spec` weight edit re-scores them over the full 13-weight denominator
    and `ai_score` collapses 8.6 → 0.87 — a floor there would then block the demo's canonical jury shortlist
    after an unrelated config change. Climate Cohort's decks have the full 13-param breakdown (0010) and are
    stable, so the seeded floors are **Climate Cohort 5.5 · Deep Tech Fund 5.5 · Fund II 6.5**, with Fintech
    and SaaS Accelerator as the "no floor" case. (3) The floor **block** is covered exhaustively in
    `test/worker/automation.test.ts` rather than e2e — raising a seeded program's floor in a spec would race
    the parallel incubator/config specs. (4) `json()` in `src/client/api.ts` now throws a typed **`ApiError`**
    (status + parsed body) instead of a bare `Error`; existing `.catch(() => …)` callers are unaffected.
    (5) A **re-upload costs a credit** (it triggers a real AI run), consistent with every other evaluation.
    (6) Running the full worker suite occasionally logs a Miniflare `EnvironmentTeardownError` /
    "Dropped message … on queue" after the run — the new upload tests leave retrying queue messages behind
    (there is still no DLQ; that's §9/Session 7). **Exit code stays 0**; it is log noise, not a failure.

- **2026-08-12 — Session 6 (Incomplete-deck resubmit loop + real email) shipped.** Commit `2b385ff`
  (+ this doc commit). Delivery is no longer stubbed, and an Incomplete deck now **notifies its founder
  automatically** with a tokenized link that takes a corrected deck straight back into scoring. Green gate:
  typecheck + lint + **286 unit/worker/client (1 skipped)** + build + **43 e2e**. Deployed (remote D1
  migrated first — `0017`) + `npm run smoke` **27/27**; **live-verified** the public endpoints on the
  deployed Worker with the demo seed left untouched.
  - **⚠️ THE SENDING DOMAIN IS STILL NOT SET — this is the one open item from this session.** The user was
    asked and confirmed the domain isn't ready, so S6 built the real path **fully and configurably** instead
    of blocking. The `send_email` binding **is deployed** (`env.EMAIL (unrestricted)` shows in
    `wrangler deploy` output) and `sendEmail` really calls it — but sending is additionally gated on
    `vars.EMAIL_FROM`, which is `""`. **To go live: (1) onboard the domain (Dashboard → Compute & AI →
    Email Service → Email Sending → Onboard Domain, which adds SPF/DKIM; or `npx wrangler email sending
    enable <domain>`), (2) set `EMAIL_FROM` in `wrangler.jsonc` to a verified address on it, (3)
    `npx wrangler deploy`.** No code change. **NB the current wrangler OAuth token lacks the email scope**
    — `wrangler email sending list` returns `Unauthorized [code: 2036]`, so onboarding must be done in the
    dashboard or after a `wrangler login` that grants it. Consequently **no live inbox test was performed**;
    that half of the §4 acceptance criterion is deliberately left for whoever sets the domain.
  - **Real email.** `sendEmail(env, email, now?)` keeps its signature and `email_outbox` stays the audit
    log, but `status` now tells the truth: **`sent`** (Cloudflare accepted it, `provider_id` recorded) ·
    **`failed`** (attempted and threw — the reason lands in the new `error` column) · **`recorded`**
    (no binding/from configured → audited only). `0017` **backfills the historical `'sent'` stub rows to
    `'recorded'`**, because they were never dispatched. A send failure is **caught, never propagated** — a
    misconfigured domain must not break the evaluation or pipeline action that triggered the mail. New
    `EmailKind` `incomplete_resubmit`; new pure `buildIncompleteEmail` (text **and** HTML, with escaping).
    **Miniflare has no emulator for `send_email`**, so tests exercise the `recorded` path by default and
    inject a stub `EmailSender` to test real delivery.
  - **Idempotency via `email_outbox.dedupe_key` (UNIQUE).** The key is
    `incomplete:<deckId>:v<content_version>`, so a **queue retry or manual re-score of unchanged content
    sends nothing**, while a **new version that is still incomplete sends again** with a fresh list. The
    UNIQUE index (not just a read-then-write check) closes the concurrent-run race; `sendEmail` catches the
    constraint violation and returns the row that won.
  - **Tokens (`resubmit_tokens`, migration `0017`).** 192 bits of CSPRNG entropy, base64url; **only a
    SHA-256 hash is stored** (unsalted on purpose — the token is already high-entropy and the lookup must be
    `WHERE token_hash = ?`, which a salted PBKDF2 hash can't support). Scoped to one deck, **30-day TTL**,
    revocable, and **superseded on re-mint** so a stale email stops working. Failures are distinguished:
    `invalid_token` → 404, `token_expired` / `token_revoked` → 410, each with a founder-facing `message`.
  - **Auto-notify.** `evaluateDeck` fires `notifyIncompleteDeck` **after `env.DB.batch` commits**, so the
    email can never describe a state the DB doesn't hold. It is wrapped in try/catch — **a mail failure must
    not fail the evaluation** (the caller would re-enqueue and re-score a deck that scored fine) — and is
    injectable as `EvaluateOptions.notify`, matching the existing `callModel`/`now` seams. The deck SELECT
    was widened for `uploaded_by`. **Recipient = `decks.founder_email`** (the merged value from the S5
    intake merge) **falling back to the uploader's account email**, which is what covers the case where the
    founder's own address is one of the missing fields, plus staff bulk uploads.
  - **Public route `/api/resubmit/:token`** (`routes/resubmit.ts`, mounted in `index.ts` **without**
    `requireAuth` — the pattern is `auth.ts`, whose router is also public). `GET` returns **only what the
    founder must fix**: the deck's identity, `missingFields`, the `deck_extractions.missing` sections, and
    their own upload history — **no scores, no evaluator data, no other deck** (test-locked). `POST` takes
    the corrected PDF. Uses are **capped at 10 per token** → 429 `too_many_resubmits`, so a leaked link
    can't be turned into an unbounded credit/Anthropic bill.
  - **Shared re-upload path (`src/server/decks/versions.ts`).** The Session-5 version logic was extracted
    out of `routes/decks.ts` into env-level helpers (`addDeckVersion`, `versionStatement`, `versionKey`,
    `reserveCredits`, `refundCredits`, `isPdf`, `MAX_PDF_BYTES`) so the **authenticated** re-upload and the
    **public tokenized** one run the *same* path — same credit accounting, same R2 layout, same
    `content_version` bump (which is what makes the re-score legitimate under the S1 rescore guard). They
    differ only in how the actor is authorised. `decks.ts` keeps thin `c`-bound credit wrappers.
    A resubmit is attributed to **`uploaded_by = NULL`** with note *"Founder resubmission via secure link"* —
    the actor is a link holder, not a platform login, and the note is what identifies the source.
  - **Founder page** `src/client/routes/ResubmitPage.tsx` at **`/resubmit/:token`**, declared in `App.tsx`
    as a **sibling of `/login`** (the `path="*"` catch-all would otherwise bounce it to the login screen).
    `AuthProvider` wraps it harmlessly — it swallows the 401 from `/api/auth/me` and never redirects. Layout
    follows the prototype's founder portal (`#fp-*` / `#qview-founder`): dark branded shell, "Action
    required" badge, "Sections requiring your input", confirmation state. **Adapted per §8 from the
    prototype's per-question textareas to a single re-upload control** — the meeting settled on updating the
    sections *in the deck*, so there is deliberately no Q&A form (e2e asserts zero textareas).
  - **Demo fixture.** `0017` seeds a working link for **NimbusHR** (`inc_deck_meera_incomplete` — real
    founder account, one missing field `founderPhone`) plus the notification that carried it, so the whole
    loop is demoable with **no credit spent**: `/resubmit/aisj-demo-nimbushr-resubmit-2026`. That token is a
    **deliberately readable demo value** on a deck in the publicly-documented demo seed — it is not a
    secret and grants nothing else. No `deck_versions` row was seeded for it: NimbusHR has no R2 object, and
    a version row pointing at a non-existent file would be a lie in the audit trail.
  - **Live verification (deployed Worker, seed untouched).** Public `GET` → 200 with NimbusHR +
    `["founderPhone"]`, no cookie involved · bogus token → 404 with its founder-facing message · `POST` with
    a non-PDF → 400 `pdf_required` (validation runs before any credit or R2 side effect) · `/resubmit/<token>`
    serves the SPA as `text/html`. Afterwards remote D1 confirmed **`credits_balance` 42 unchanged**,
    NimbusHR still `content_version=1` with 0 version rows, and **0 outbox rows claiming `'sent'`**. The
    live **POST-with-a-real-PDF** path was deliberately **not** exercised against production (it would spend
    a credit and an Anthropic call and mutate the demo deck) — it is covered by 20 worker tests + 3 e2e.
  - **Gotchas for later sessions:** (1) **`sendEmail` no longer returns `status: 'sent'` in tests** — with no
    binding it is `'recorded'`. Two existing assertions (`outbox.test.ts`, `pipeline.test.ts`) were updated;
    anything new asserting on the outbox must expect `'recorded'` locally. (2) **`evaluateDeck` now writes an
    `email_outbox` row + a `resubmit_tokens` row for every deck that lands Incomplete**, including in tests —
    a test that counts outbox rows for a deck must account for it, or pass `opts.notify`. (3) The
    `wrangler email …` CLI commands **fail with `Unauthorized [code: 2036]`** on the current OAuth token
    (no email scope) — use the dashboard, or re-login. (4) **Session 4's leftover** — "`POST /api/users`
    should email the temp password instead of surfacing it" — was **NOT** done: it is outside §4's Session-6
    scope and the transport is audit-only until the domain lands, so mailing a credential now would silently
    strand new users. Do it in **Session 8** once `EMAIL_FROM` is set; the composer pattern is
    `buildIncompleteEmail`. (5) The e2e resubmit spec **mutates NimbusHR in the local e2e DB** (adds v2) —
    harmless, since `e2e:serve` wipes `.wrangler/state` and re-migrates before every run. (6) A parallel
    full-e2e run flaked **once** on `analytics.spec` "VC admin sees capital deployment" (passes alone; 43/43
    on three consecutive full runs afterwards) — same parallel-config-edit interference already noted for
    S5; unrelated to this session's code.

- **2026-08-12 — Session 7 (De-stub VC screens + ICS scheduling + issue log + the §9 pending bug) shipped.**
  Commit `29c78e1` (+ this doc commit). **There are no `StubPage` slugs left in either edition.**
  Scheduling is real (universal `.ics`), the team has an in-app issue log, and the "stuck at Pending AI"
  bug is fully fixed end to end. Green gate: typecheck + lint + **379 unit/worker/client (1 skipped)** +
  build + **52 e2e**. Deployed (DLQ created + remote D1 migrated first — `0018`) + `npm run smoke`
  **34/34** (7 new checks). **Live-verified** every new endpoint on the deployed Worker with the demo
  seed left untouched (`credits_balance` 42 / 49, unchanged).
  - **Schema (migration `0018`).** `calls` finally becomes a real table rather than a write-only audit:
    **`title`, `duration_minutes`, `location`, `ics_uid`, `ics_sequence`, `status`, `organizer_id`,
    `updated_at`** + an index on `deck_id`, plus a new **`call_participants`** child table
    (`user_id` NULLABLE — the founder and any external guest have no login). `tickets` gains
    **`category`** (`'support'` | `'issue'`), `severity`, `area`, `assignee_id`, `resolution`,
    `updated_at`. `decks` gains the §9 AI-health columns: **`ai_error`, `ai_attempts`,
    `ai_last_attempt_at`, `ai_failed_at`, `ai_credit_refunded`**. Demo seed: 4 scheduled calls
    (GreenRoute intro · WealthOS intro · MedGrid partner · LearnLoop alignment) with participants
    including founders on **their own domains**, and 3 internal issues.
  - **ICS builder (`src/shared/ics.ts`) — pure, dependency-free, 23 unit tests.** RFC 5545: CRLF
    endings, **75-octet folding that never splits a multi-byte character**, TEXT escaping
    (`\ ; ,` + newlines), UTC-only timestamps (no VTIMEZONE), ORGANIZER as `ROLE=CHAIR`, ATTENDEEs
    with `RSVP=TRUE`, `SEQUENCE`, `STATUS`, optional `VALARM`. A reschedule keeps the **same UID** and
    bumps `SEQUENCE`, so a calendar client *updates* the existing entry instead of creating a second
    one; a cancel emits `METHOD:CANCEL` + `STATUS:CANCELLED`.
  - **Calls API (`src/server/routes/calls.ts`, `/api/calls`).** `GET /` (deckId/kind/mine filters) ·
    `GET /directory` (edition roster for the participant picker — **not** `/api/users`, which is
    admin-only and exposes account management) · `POST /` (schedule) · `PATCH /:id`
    (reschedule/cancel/re-invite) · `GET /:id/ics` (a real `text/calendar` download) ·
    `POST /:id/invite`. **Two authZ tiers** (`CALL_SCHEDULER_ROLES` in `shared/roles.ts`): schedulers
    are incubator **PM + associate** and VC **partner + associate** (§8's "the associate schedules the
    intro call" — the Session-4 deferral is now closed) plus admin/superuser; **everyone else is
    read-only and sees ONLY the calls they are a participant on**, matched on user id *or* account
    email. That is §8's "jury/IC members can view their calls" without turning an IC member's calendar
    into a listing of every deal in the firm.
  - **Scheduling an incubator intro call performs `schedule_intro` in the same request.** §8 has the PM
    *deciding and scheduling* as one act, so the screen doesn't make them click twice. Best-effort: if
    `performAction` refuses, the call is still created and the response reports `advanced: false`.
  - **Email invites carry the `.ics` as an attachment.** `OutboundEmail` gains `attachments` (the
    Workers `send_email` binding takes **raw string** content for text parts — base64 is the REST API's
    convention, not the binding's), new `EmailKind` `call_invite`, new pure `buildCallInviteEmail`
    (text + HTML, escaped). Idempotency key is `call:<id>:s<sequence>:<email>`, so a double-click sends
    nothing twice but a **genuine reschedule does re-send** (the sequence moved). Still **audit-only**
    until `EMAIL_FROM` is set — unchanged from S6.
  - **`CallsPage`** replaces `StagePage` for incubator `introcalls` and VC `introcalls` /
    `partnercall` / `alignmentcall`: the prototype's table (Startup · AI score · Avg. score · Call
    scheduled · Call date · Participants) plus the stage's own decision buttons and the alignment
    call's term-sheet valuation/ownership capture (ported over so nothing was lost). The scheduling
    modal keeps the prototype's shape (Meeting title · participants across roles · Selected count) but
    **deviates deliberately**: the prototype ends in a Google/Zoom/Teams **deep link** into the
    organizer's own calendar composer, which §8 replaced with the universal `.ics`. The three providers
    survive as location presets.
  - **Query screen — one screen, both editions.** The incubator and VC prototype `#panel-query` markup
    is byte-identical (three CSS deltas), so `QueryPage` was rebuilt to the prototype's table
    (Startup · Founder · Phone · Email · Status · Parameters needing response) and now serves both.
    Status is derived from real query history (`Not asked` / `Pending` / `Overdue` after 5 days /
    `Responded`) via the new **`GET /api/queries`** edition-wide listing; "parameters needing response"
    reads the Session-5 `missing_fields`. `POST /decks/:id/queries` opened to VC `analyst` + `associate`,
    and now mails **`decks.founder_email`** in preference to the uploader (a staff bulk upload was
    mailing the analyst). **Deviation:** the prototype's "Email query" tab composes a mail with a
    hardcoded fake tokenized link and a fake send; ours posts a real query that sends a real email, and
    the tokenized founder link belongs to S6's automatic resubmit loop, not here.
  - **Issue log — same table, split by category.** `routes/support.ts` gains an `issues` router
    (`GET /api/issues[?status=]` · `POST` · `PATCH /:id`); **both existing ticket queries were scoped to
    `category='support'`**, so neither queue can ever see the other's rows (test-locked in both
    directions). Any internal role files (a tester who can't file files it in chat instead — the exact
    fragmentation this replaces); **triage is admin-only**, and an assignee from another edition is
    rejected 400 rather than silently orphaning the issue. Founders 403.
  - **§9 pending bug — the full fix.** New `src/server/ai/health.ts`:
    1. **Record.** `recordEvalFailure` stamps reason + attempt count + time; the queue consumer records
       **before** retrying, so the cause survives the retries that would otherwise erase it.
    2. **Dead-letter queue.** `startup-jury-evals-dlq` (created via `wrangler queues create`, wired as
       `dead_letter_queue` + a second consumer). `handleQueue` branches on **`batch.queue`**; the
       terminal handler marks the deck failed with its real reason, refunds, and **acks** (re-queueing
       a dead letter would loop forever). This also **replaced the worker suite's "Dropped message …"
       noise** with "Moving message … to dead letter queue".
    3. **Cron sweep.** New cron **`*/10 * * * *`** → `runStuckSweep` → `sweepStuckEvaluations`:
       re-enqueues decks parked at `pending_ai` past a 10-minute grace period, up to
       `MAX_AI_ATTEMPTS = 3`, then gives up. `index.ts` now branches on **`controller.cron`** so the
       daily `0 8 * * *` reminder job is unaffected.
    4. **Refund, exactly once.** `markEvalTerminal` claims the refund with a conditional UPDATE on
       `ai_credit_refunded`, so the sweep and a dead-letter delivery racing over the same deck cannot
       double-refund (which would mint credits out of a failure).
    5. **Surface the real reason.** Deck views carry **`aiState`** (`ok` / `in_progress` / `retrying` /
       `failed`), `aiError` (via `classifyEvalError` — billing vs rate limit vs bad key vs missing PDF)
       and `aiAttempts`. The decks table shows it under the status; the dashboard gets a banner listing
       failed decks with a **"Re-run AI"** button (`POST /api/decks/:id/retry-ai`, narrower than
       `RESCORE_ROLES` because a re-drive can *re-reserve* the refunded credit). The upload screen's
       hardcoded **"no AI key configured yet"** is gone — it now names the real cause and says whether
       anything is still going to retry. A successful `evaluateDeck` clears all of it in its own batch
       statement, so a recovered deck can never read as failed.
  - **🔴 THE SWEEP IMMEDIATELY FOUND A LIVE PRODUCTION BUG — `temperature` is rejected by
    `claude-sonnet-5`, and ALL live AI scoring had been broken since Session 5.** The new `*/10` cron
    re-drove `CloudBridge` (the real §9 victim, stranded since 2026-07-24), and the failure it recorded was
    `400 {"type":"invalid_request_error","message":"\`temperature\` is deprecated for this model."}`.
    Session 5 added **`temperature: 0`** to `callAnthropic` for AI determinism; `claude-sonnet-5` **rejects
    non-default sampling parameters with a 400**, so from that moment **every real upload failed and
    stranded its deck at `pending_ai`** — invisibly, because the old code neither recorded the reason nor
    re-drove anything. This is the §9 bug's true present-day cause, and the fix surfaced it within ten
    minutes of going live. **`temperature` (and `top_p`/`top_k`) removed** from the request; determinism now
    rests on `thinking: { type: "disabled" }` + the forced `tool_choice` + the deterministic prompt, with the
    Session-1 rescore guard as the real protection against needless re-runs. A test asserts the parameters
    are **absent** so they can't come back, and the module header says loudly why. **Verified end to end on
    production:** the sweep marked CloudBridge failed and refunded its credit (42 → 43); after the fix,
    `POST /api/decks/:id/retry-ai` re-reserved the credit (43 → 42), re-queued it, and **the deck scored** —
    Claude read the PDF, extracted the founder ("Ravi Komarraju"), and the deck landed at **`incomplete`**
    because two required intake columns (`founderEmail`, `founderPhone`) are genuinely absent from it, which
    is the Session-5 rule working correctly. Record → re-drive → give up → refund → re-drive → score, every
    step exercised against a real broken deck. **`SELECT COUNT(*) FROM decks WHERE status='pending_ai'` on
    production is now 0**, credits are back at 42 / 49, and all 20 outbox rows still read `recorded` (nothing
    falsely claims a delivery).
  - **Bug found and fixed during live verification (worth knowing).** `decks.created_at` defaults to
    SQLite's `datetime('now')` → `"2026-08-12 19:10:00"`, while every timestamp this code writes is
    ISO-8601 → `"2026-08-12T19:10:00.000Z"`. A **space (0x20) sorts before "T" (0x54)**, so a plain
    `created_at <= ?` string compare marked *every deck uploaded later on the cutoff's own date* as
    already stale — the sweep would have re-driven a deck while its first evaluation was still running.
    The query now uses **`datetime(created_at) <= datetime(?)`** on both sides (SQLite normalises both
    formats, verified against remote D1), with two regression tests that insert a deck the way
    `storeDeck` actually does. **Anything else comparing these columns as strings has the same
    latent bug.**
  - **Nav.** New `issues` item in Support for every internal role (incubator superuser superset
    **24 → 25**, `nav.test.ts` bumped). VC `introcalls` opened from admin+partner to **admin, partner,
    associate, analyst, ic_member**, with `labelOverrides` "My Intro calls" for the two read-only roles;
    `CallsPage` renders the per-role nav label as its heading. New `Bug` icon registered.
  - **Live verification (deployed Worker, seed untouched).** VC associate lists the WealthOS intro call
    with all three participants · `GET /:id/ics` returns `content-type: text/calendar` +
    `content-disposition: attachment; filename="wealthos-founder-intro-call.ics"` and a well-formed
    VCALENDAR/VEVENT · IC member sees only MedGrid + LearnLoop, is **403** on the directory and **404**
    on a call they're not on · issue log is edition-scoped, IC member **403** on triage ·
    `retry-ai` → **409 `not_pending`** on a scored deck and **404** cross-edition · every deck row
    carries `aiState`. Deploy output confirms both crons and **both queue consumers** (incl. the DLQ).
  - **Gotchas for later sessions:** (1) **`CloudBridge` (`deck_1a5467f7…`, incubator, uploaded
    2026-07-24) was the live demo's real §9 victim** and is now **resolved**: after the `temperature`
    fix it re-scored and sits at **`incomplete`** (missing `founderEmail`/`founderPhone` — a correct
    Session-5 outcome, and a second live demo case for the resubmit loop). Its credit was refunded and
    re-reserved once each, so the incubator balance is back at **42**. Nothing is stranded at `pending_ai`
    any more. (2) **`e2e/analytics.spec` had a latent
    ambiguous locator**, not a flake: `getByText("Decision log")` also matched the report shell's
    caption ("…decision **log**, drawn from…"), so it resolved to 2 elements as soon as any VC spec had
    recorded a decision. Fixed with `{ exact: true }`. (3) `pipeline_events` columns are
    **`from_stage`/`to_stage`**, not `from_status`/`to_status`. (4) A valueless `download` attribute
    makes the browser name the file from the URL path (`…/ics` → "ics.html"), ignoring
    `Content-Disposition`; `CallsPage` passes an explicit `download={icsFilename(...)}`. (5) The bare
    `/queries` listing needed its **own** `pipeline.use("/queries", requireAuth)` — the existing
    `"/queries/*"` does not match it. (6) **ICS was NOT imported into a real calendar app** — doing so
    would add events to the user's personal calendar without asking. The file is structurally validated
    by 23 unit tests + a live fetch; a one-click human check remains (same shape as S6's live inbox
    test). (7) `StagePage` no longer owns `introcalls`/`partnercall`/`alignmentcall`; a future session
    adding a stage config for those slugs will be **shadowed** by `CallsPage`, which is checked first.


- **2026-08-12 — Session 8 (Polish, full e2e, docs, final deploy) shipped. THE FINISH TRACK IS
  COMPLETE.** Commit `7a011f7` (+ this doc commit). Green gate: typecheck + lint + **400
  unit/worker/client (1 skipped)** + build + **69 e2e** (52 → 69). Deployed (remote D1 migrated first —
  `0019` + `0020`) + `npm run smoke` **40/40** (6 new checks). Live-verified on the deployed Worker.
  - **⚠️ THE ONE THING THAT DID NOT SHIP: the email sending domain is still not onboarded.** The user
    was asked at the top of this session and confirmed it isn't ready, so per the session brief this
    did **not** block — everything else shipped. Delivery remains audit-only (`status='recorded'`) and
    **the live inbox test has still never been run**; that half of the §4 Session-6 acceptance
    criterion is the finish track's single open item. It is an external DNS/dashboard step, not code:
    onboard the domain → set `vars.EMAIL_FROM` in `wrangler.jsonc` → `npx wrangler deploy`. The
    `send_email` binding is deployed (`env.EMAIL (unrestricted)` in the deploy output) and every
    composer, attachment and dedupe key is built and tested.
  - **`POST /api/users` now emails the temp password — Session 4's leftover, closed.** New pure
    **`buildAccountInviteEmail`** (text + HTML, escaped, correct English article for the role label)
    and **`emailDeliveryConfigured(env)`**. `users.ts` gained **`deliverInvite()`**, which sends and
    then reports what actually happened: the response carries `tempPassword` **only when the mail did
    not get through** (`skipped` — no verified domain — or `failed`). That is deliberately driven by
    the outbox's real `status`, not by configuration alone: S6's gotcha #4 warned that mailing a
    credential over a dead transport would silently strand every new user, and this is the shape that
    can't. **`OutboundEmail` gained `auditBody`** so the outbox — a durable log — records
    `[redacted]` instead of the plaintext password. Three worker tests cover all three branches,
    including recovering the password from the sent message and logging in with it.
  - **Migration `0019` — `decks.program` / `decks.cohort` dropped.** A subagent inventory confirmed
    **no code anywhere outside `migrations/` had read them since Session 2** — only the 0002/0005/0006/
    0008 seed inserts and the 0011 backfill that consumed them, all of which run *before* 0019, so a
    fresh replay is unaffected. **A plain `ALTER TABLE … DROP COLUMN` was the right call, not the
    twelve-step rebuild the plan anticipated:** SQLite only rejects DROP COLUMN for an indexed /
    view-referenced / generated column, and neither of these is any of those — whereas a rebuild would
    have meant re-creating **eleven inbound `ON DELETE CASCADE` foreign keys** by hand, which is the
    genuinely risky option. Verified locally first; regression tests assert both columns are gone and
    all four `decks` indexes survived.
  - **Migration `0020` — the demo-seed refresh (no schema change).** A seed audit found the demo was
    coherent only on the two decks Session 1 hand-wrote. Fixed:
    1. **Full 13-parameter AI breakdowns for all 28 remaining scored decks.** Previously *two* decks
       had one; every other deck advertised an `ai_score` in the list with an empty breakdown behind
       it. The values were **solved so the weighted total over the full 13-weight rubric reproduces
       each deck's existing `ai_score` exactly** — the same arithmetic `weightedTotal()` and
       `rescoreEdition()` use — so an admin weight edit re-scores from the rows without the headline
       jumping. That **retires the Session-5 gotcha** that a weight edit collapsed FinStack/InsureFlow
       from 8.6 to 0.87 (they had one score row against a 13-weight denominator), which had made the
       demo fragile to an unrelated config change. Scores are **whole numbers 0–10**, the shape the
       live model returns, generated deterministically (no `Math.random`) with rationale text keyed to
       each score's band, and a per-deck check that the arithmetic actually closes.
    2. **A latent Session-1 inconsistency fixed:** 0010's hand-written TaxPilot and WealthOS
       breakdowns weight out to **5.93 / 8.06**, not the **6.2 / 8.1** the deck rows advertised. The
       composite now derives from its own evidence (the scores carry hand-written rationales that must
       keep matching their values). Both stay in the same signal band, and no test asserted the old
       numbers.
    3. **New fixtures for the newest surfaces.** **PitchLoop** — incubator, seeded `pending_ai` with
       `ai_failed_at` + a real failure reason, so the §9 AI-health banner and "Re-run AI" have
       something to render. It is safe: `sweepStuckEvaluations` filters on `ai_failed_at IS NULL`, so
       the `*/10` cron will never re-drive it or spend a credit. **Northbeam Robotics** — VC,
       Incomplete with missing intake columns, extraction sections marked missing, and a founder
       query, because the whole query/resubmit surface had been incubator-only and the VC Query screen
       matched exactly one deck with no thread on it.
    4. Also: the **returning-company** flag on `vc_deck_agrichainvc` (the seed already contained the
       case the feature exists for — AgriChain applying to a second VC fund — it was just never
       flagged); `investment_dd` / `term_sheets` / `legal_dd` rows for the decks parked in those
       stages (those rows are normally *transition side effects*, so seed-placed decks never got one);
       non-`open` ticket/issue states and a **rescheduled call at `ics_sequence = 1`** so the
       SEQUENCE-bump path is demoable; org **branding** (`branding_json` was `{}`, so `orgName()` made
       the Incomplete email say "the programme"); the missing `sectors` rows incl. Fund II's
       `Multi-sector`; and `program_id` for the **real uploaded decks**, which had `NULL` and were
       therefore hidden by the toolbar filters.
  - **CloudBridge (`deck_1a5467f7…`) — KEPT, deliberately.** It is the finish track's best artifact: a
    real deck that sat at `pending_ai` for 19 days, was re-driven by the Session-7 sweep, and landed
    **Incomplete** because `founderEmail`/`founderPhone` genuinely are absent from its PDF. Its
    original token was only ever stored as a hash, so `0020` revokes it and mints a fresh readable demo
    link — **`/resubmit/aisj-demo-cloudbridge-resubmit-2026`** — verified live: it returns Claude's own
    extraction of the two missing sections (Traction, Ask/CTA) with no session at all.
  - **Brand / theme / a11y pass** against `startupjury_brand_guidelines.docx`. The audit found **zero
    hex literals and zero raw Tailwind palette classes** in the sixteen finish-track screens — the
    design system had held — but two real theme bugs: `text-white` on amber in the Set up stepper
    (**2.43:1**, below AA, on the most-looked-at element of that screen) and the Research button's
    fixed `bg-navy`, which in dark theme measured **1.06:1 against its own surface** — the control was
    invisible on a core demo path. Both fixed with semantic pairings. Also unified the **three**
    divergent table-header styles onto the house markup, gave the calls modal
    `role="dialog"`/`aria-modal`/document-level Escape and the brand scrim, turned `StagePage`'s
    `<td onClick>` into a real button, labelled the icon-only pills, aligned two page wrappers, and
    replaced the wizard's stale "team management is coming to the Admin console" copy (it shipped in
    S4). **CSP audit clean** — no CDN, external font, remote image, `eval` or `dangerouslySetInnerHTML`
    anywhere; the pdf.js worker is self-hosted; the only outbound URLs are the Research menu's, opened
    by explicit user action with `noopener,noreferrer`. **No CSP header was added** — doing it properly
    needs `img-src data:` (the deck viewer renders pages as data URIs), `style-src 'unsafe-inline'` and
    `worker-src blob:`, and getting it wrong blanks the deck viewer; noted as follow-up work rather
    than risked on the last day.
  - **The Export button does something.** It had been a live-looking, handler-less button since Phase 2
    on **All decks and every stage screen**. New pure **`src/client/exportCsv.ts`** exports the
    on-screen table (post-filter, in order) as RFC 4180 CSV with a UTF-8 BOM, and **defuses
    spreadsheet formula injection** on the attacker-influenced columns — a founder picks their own
    company name, and Excel executes a cell opening with `= + - @`. Client-side on purpose: the rows
    are already loaded, so there's no round-trip and no new authZ surface. `GET /api/decks` now also
    returns `programName`/`cohortName` (the `programs` join already existed for `shortlist_min`).
  - **e2e coverage sweep — `e2e/coverage.spec.ts`, 17 tests, 52 → 69.** An inventory found whole
    families with no browser coverage: **every `StagePage` slug in both editions** (twelve), the
    **founder portal** (four screens, nav-only until now), **eight of the twelve** analytics reports
    incl. all three jury-exclusive ones, the support queue, the team channel, the AI-health banner,
    the Upload intake table, and the Set up wizard's last two steps. All added, all read-only on shared
    state (the suite is `fullyParallel` over one D1 — S5/S6/S7 each recorded a real race). The headline
    addition is a **regression guard that walks every nav slug for a superuser in both editions and
    asserts none renders `StubPage`** — the property the whole finish track was aiming at, previously
    asserted only on the two screens Session 7 happened to de-stub.
  - Fixed a React **`key`-spread warning** in `ScoreBars` that the fuller seed made visible on every
    report drawer: a score carries the *parameter* key (Session 1, so the client can join scores to the
    rubric), and spreading it into JSX made React read it as the reconciliation key.
  - **Live verification (deployed Worker).** `credits_balance` **42 / 49 — unchanged** (no credit was
    spent this session); **42 decks, 0 without a program**; **0 composite/breakdown mismatches**; **0
    decks stuck at `pending_ai`** other than the deliberate PitchLoop fixture; both `decks.program` and
    `decks.cohort` gone; both resubmit links live and the superseded CloudBridge token revoked.
  - **Follow-ups deliberately NOT taken** (recorded so nobody assumes they were missed): a real CSP
    header (see above); `deck_extractions` for the 28 newly-broken-down decks (they have no R2 object,
    and inventing extracted slide text for a PDF that doesn't exist would put a lie in the report
    drawer — the empty state is the honest answer); and a `deck_versions` row for any seeded deck, for
    the same reason Session 6 declined it.

- **2026-08-12 — Maintenance: the CSP header (Session 8's deferred follow-up) shipped.** Green gate:
  typecheck + lint + **410 unit/worker/client (1 skipped)** + build + **72 e2e** (69 → 72). Deployed (no
  migration) + `npm run smoke` **44/44** (4 new checks). The email sending domain was asked about again
  at the top of this session and is **still not onboarded**, so §7's one open item is unchanged.
  - **The policy (`src/server/security.ts`).** `default-src 'self'` · `base-uri 'self'` ·
    `object-src 'none'` · `frame-src 'none'` · `frame-ancestors 'none'` · `form-action 'self'` ·
    **`img-src 'self' data:`** · `font-src 'self'` · **`style-src 'self' 'unsafe-inline'`** ·
    **`worker-src 'self' blob:`** · `script-src 'self'` · `connect-src 'self'`. Plus `nosniff` +
    `Referrer-Policy: strict-origin-when-cross-origin` on **every** response.
  - **CSP is applied to HTML documents ONLY, deliberately.** Chrome renders a top-level PDF through a
    plugin document and `object-src 'none'` on that response **blanks it** — which would break the deck
    viewer's "Open PDF" fallback. `withSecurityHeaders` branches on `content-type`; a worker test locks
    the `application/pdf` case.
  - **Dev vs production.** `npm run e2e:serve` is the Vite dev server, whose injected React Refresh
    preamble is an inline script, so the policy relaxes exactly two directives when
    `import.meta.env.DEV` (`script-src 'unsafe-inline'`, `connect-src ws: wss:`). Vite **statically
    inlines that to `false`** in the deployed bundle (verified in `dist/startup_jury/index.js`), so the
    flag fails **closed**. Everything the deck viewer needs is byte-identical in both.
  - **🔴 The e2e suite could not see the header at all, and would have passed vacuously.**
    `@cloudflare/vite-plugin` short-circuits navigation requests (`Sec-Fetch-Dest: document` — note the
    `Vary` it sets) into Vite's own HTML pipeline, so **in dev the Worker never serves the document**.
    New `e2e/csp-enforce.ts` asks the Worker for the real policy over a non-navigation fetch and stamps
    it onto the document via `page.route`, so Chromium enforces it for real. **Both load-bearing
    directives were then negative-controlled:** dropping `data:` from `img-src` leaves the slide `<img>`
    at `naturalWidth 0`, and `worker-src 'none'` raises console violations (pdf.js silently falls back
    to main-thread rendering, so only the violation assertion catches that one).
  - **🔴 THE HEADER REACHED `curl` BUT NOT BROWSERS ON THE FIRST DEPLOY.** The deploy changed only the
    Worker, not the asset bundle, and Cloudflare's edge kept answering navigations from a cached
    pre-deploy `index.html` (`cf-cache-status: HIT`, `content-encoding: zstd`) — a different cache
    variant from the one a plain `curl` gets, which is why curl showed the CSP and headless Chromium
    showed **none**. Fixed with **`assets.run_worker_first: ["/*", "!/assets/*", "!/favicon.png"]`** in
    `wrangler.jsonc` (every navigation now reaches the Worker; the hashed, immutable `/assets/*` still
    go straight to the Asset Worker and keep their edge caching) plus `Cache-Control: no-store` on the
    document. **NB Cloudflare's asset layer rewrites that `no-store` back to
    `public, max-age=0, must-revalidate` at the edge** — still revalidate-before-reuse, so the intent
    holds; only the local response shows `no-store` verbatim, and the smoke check asserts the property,
    not the literal.
  - **Live verification (deployed Worker, real browser, seed untouched).** Headless Chromium against
    production: the document carries the production policy (`script-src 'self'`, no `unsafe-inline` for
    scripts), the app boots and logs in, and **CloudBridge's real 12-page PDF rendered 12 slides in
    1.3 s** — first slide `naturalWidth 1008`, `src` a `data:image/png` — with **0 CSP violations**. The
    PDF stream itself returns `200 application/pdf` with **no CSP** and `nosniff`. No credit spent; no
    deck, seed row or R2 object touched.
  - **Tests.** `test/worker/security.test.ts` (10) — the load-bearing directives, the lockdown set,
    prod-vs-dev deltas, per-content-type behaviour, header/body/status preservation, the 101
    passthrough, and the middleware actually being wired in. `e2e/csp.spec.ts` (3) — the served
    document's headers, the API's, and a violation sweep over the core authed screens.
    `e2e/upload.spec.ts` was upgraded from a **stub PDF buffer to the real
    `docs/demo-assets/gridbloom-sample-deck.pdf`**, so it now also proves the viewer renders actual
    slides under the policy. `npm run smoke` gained 4 live header checks (40 → 44).
  - **Gotchas for later sessions:** (1) **`run_worker_first` and the CSP are one change** — remove
    either and browsers silently stop receiving the header while `curl` still shows it. (2) A CSP on a
    **PDF** response blanks Chrome's viewer; keep the content-type branch. (3) `/assets/*` bypasses the
    Worker by design, so the hashed bundles carry **no** `nosniff` — they are content-hashed static
    files served with correct content types. (4) e2e specs that assert on the CSP must go through
    `enforceWorkerCsp`; asserting straight off `page.goto` passes vacuously in dev. (5) Re-running the
    full e2e suite against an **already-running** `e2e:serve` fails ~6 mutating specs — the DB is only
    wiped when the server boots. Kill it, or let Playwright start its own.

---

## 7. FINISH TRACK COMPLETE — no next session

**All 8 sessions shipped between 2026-08-11 and 2026-08-12.** The §3 tracker is fully ✅ and every §1
box is ticked. Target delivery was Saturday 15 Aug 2026, 09:00 IST; the scope landed on 12 Aug.

Live: **https://startup-jury.jay-komarraju.workers.dev** · finish-track commit `7a011f7` ·
green gate typecheck + lint + **410** unit/worker/client + build + **72** e2e · `npm run smoke` **44/44**
_(counts as of the 2026-08-12 CSP maintenance entry at the end of §6 — the last of Session 8's two
deferred follow-ups is now closed; the other, `deck_extractions` for the seeded decks, was declined on
purpose)._

**One item is open, and it is not code.** The **email sending domain is still not onboarded** —
re-confirmed with the user again on 2026-08-12 in the first post-finish maintenance session, so
delivery is audit-only and the live inbox test has never run. To switch it on:

1. Onboard the domain — Cloudflare Dashboard → Compute & AI → Email Service → Email Sending → Onboard
   Domain (this adds the SPF/DKIM records). NB the current wrangler OAuth token lacks the email scope,
   so `wrangler email sending …` returns `Unauthorized [code: 2036]` — use the dashboard, or re-login.
2. Set `vars.EMAIL_FROM` in `wrangler.jsonc` to a verified address on it (optionally `EMAIL_REPLY_TO`).
3. `npx wrangler deploy`.

That is the entire change. Incomplete-deck notices, `.ics` call invites and new-user invites all start
delivering, and `POST /api/users` stops returning the temporary password because the recipient will
have it. Then do the live inbox test Sessions 6, 7 and 8 could not: trigger an Incomplete resubmit mail
and a call invite, and confirm the `.ics` attachment lands and imports into a real calendar.

For anything else, the app is in **maintenance mode** — see `HANDOFF.md` → *Project complete /
maintenance* for the standing change procedure (green gate → migrate `--remote` → deploy → smoke).

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
  **✅ FIXED IN SESSION 7 — all five parts shipped.** Dead-letter queue `startup-jury-evals-dlq`
  (`wrangler.jsonc` `dead_letter_queue` + a second consumer; `handleQueue` branches on `batch.queue`);
  a **`*/10 * * * *` cron sweep** (`sweepStuckEvaluations` in `src/server/ai/health.ts`, 10-minute grace
  period, `MAX_AI_ATTEMPTS = 3`); a manual re-drive **`POST /api/decks/:id/retry-ai`** plus a dashboard
  "Re-run AI" banner; a **once-only credit refund** guarded by `decks.ai_credit_refunded`; and the real
  reason surfaced via `decks.ai_error`/`ai_attempts`/`ai_failed_at` → `aiState` (`in_progress` /
  `retrying` / `failed`) on every deck view, replacing the hardcoded "no AI key configured yet" copy.
  See the Session-7 §6 entry for the timestamp-comparison bug found while verifying this.
  _(Session 1's partial mitigation — single upload falling back to `EVAL_QUEUE.send` — is still in place
  and is now the first line of defence rather than the only one.)_
  **The one live victim is resolved.** `CloudBridge` (`deck_1a5467f7…`, incubator, uploaded
  2026-07-24) sat at `pending_ai` for 19 days. The Session-7 cron re-drove it, which is how the
  `temperature` bug was found; after the fix it re-scored and landed **`incomplete`**, because
  `founderEmail`/`founderPhone` genuinely are absent from its PDF — the Session-5 rule working
  correctly. **Session 8 KEPT it deliberately** as a second, fully real resubmit-loop demo case (a
  genuine deck, a genuine failure, a genuine recovery) and minted it a readable demo link,
  `/resubmit/aisj-demo-cloudbridge-resubmit-2026`. Production has **0 decks at `pending_ai`** other
  than `inc_deck_pitchloop`, the deliberate AI-health fixture seeded by `0020` (which the sweep skips
  because its `ai_failed_at` is set).
- **E42 sample** scored ~3.4 (missing team/traction/ask → Incomplete). That's correct behavior, not a bug —
  it's the canonical "incomplete deck" demo case for the resubmit loop.
