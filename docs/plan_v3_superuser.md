# V3 — the reshared incubator superuser prototype

**Source:** `docs/prototype/source/incubator/AISJ_SuperuserV3.HTM` (1,001,779 bytes, shared 2026-09-19).
It supersedes `AISJ_IC_SuserV15.HTM` **for the superuser role only** — the admin, program-manager,
program-associate and jury prototypes were NOT reshared.

**Scope:** incubator, superuser first (the client's words). Nineteen change items, listed in §3.

---

## 1. Two traps that hid ~40% of this work. Read before you scope anything.

**(a) The admin console is base64.** `var ADMIN_B64="PCFET0NUWVBFIGh0bWw+..."` is decoded at runtime
into an iframe `srcdoc` (`atob` → `TextDecoder` → `f.srcdoc`). **A plain grep of the outer file returns
ZERO hits for everything inside it** — Scoring framework, Composite formula, AI weight, Price
configuration, Team & roles, and the two new sections. Scoping this release with grep alone reported
"no prototype backing" for six client items that have the *most precise* backing on the list.

    python3 docs/prototype/tools/decode-embedded.py \
      docs/prototype/source/incubator/AISJ_SuperuserV3.HTM  <outdir>

Decoded: **v3 210,144 bytes vs v15 174,399 — +36 KB, the largest delta in the release.**
This is the second time this trap has been hit here (see the `startup-jury-admin-console-gap` note).

**(b) `panel-settings` is the last panel in the file.** Any "from this id to the next id" extent
measurement swallows every trailing `<script>` and reports a false +74 KB. The settings panel is
**unreachable in BOTH versions** — `showPanel('settings')` occurs 0 times in v15 and 0 times in v3;
`si-settings` → `openSetup()` → the 4-step setup wizard. It is not new and it is not the headline.

**Measured deltas that ARE real** (panel markup only, boundaries checked):
`alldecks +1006` · `evaluate +533` · `introcalls +410` (CSS only) · `coreparams −13` ·
`jurypipeline −34` · `query −78` · `upload −2136` · `assign ±0 (byte-identical)` ·
**decoded admin console +35,745**.

---

## 2. The sidebar, which reframes three client items

| | v15 | v3 |
|---|---|---|
| Workflows | All decks | **Dashboard** (`ti-layout-dashboard`) |
| Evaluation | Upload · Query · **Evaluate** · Assign · Jury Pipeline · Prog manager pipeline · Intro calls · … | **Upload & Evaluate** · Query · Assign · Jury Pipeline · **Intro calls** · **Prog manager pipeline** · … |

Three consequences the client's list does not state:
- **There is no standalone `Evaluate` sidebar item in v3.** So "shift Query after Evaluate" is already
  satisfied: Query sits directly after *Upload & Evaluate*. Zero-cost.
- **`Intro calls` and `Prog manager pipeline` swapped order.** Not on the client's list at all.
- **The Evaluate screen is orphaned.** `showPanel('evaluate')` appears once, inside `upSendToEvaluate()`,
  which has no callers. We are asked to redevelop a screen the prototype gives no way to reach (§4, Q6).

---

## 3. Coverage of the client's 19 items

Legend — **BUILD**: evidenced, buildable. **DECIDE**: prototype and instruction disagree. **ASK**: needs
a corrected file or a number. **MEASURE**: prototype unchanged, so the gap is in our build and unmeasured.

| # | Item | State | Evidence / why |
|---|---|---|---|
| 1 | Eval report consistent at each stage | **DECIDE** | v3 **deletes** stage-awareness: `__introCols`, `__jTot` and the `__roleBlock` stage switch are gone; colspan hard-coded 5. That reverses **W7-D and Issue 24**, which are server-enforced (`decks.ts` `reportLayout(edition, stage, role)`). |
| 2 | Jury pipeline status repeating | **BUILD** | Cleanest item. Markup diff is one line: `-<th>Status</th>`. The repeat was the row pill *plus* the per-juror `jp-jstat` pills. Action options drop 5→2 (Send to intro calls · Reassign/add jury), then the cell becomes a flow tag. |
| 3 | Composite formula: hide all but weighted average | **DECIDE** | Console still offers all three, byte-identical to v15. Client marked it *Workaround* — an explicit override of "match the prototype exactly". Record it or the next parity audit reverts it. |
| 4 | AI weight: hide all but 50/50 | **DECIDE** | Console offers 40/30/50/0 and **has no `selected` attribute, so 40% AI · 60% Jury is the effective default** — and `migrations/0026` agrees (`ai_weight_pct DEFAULT 40`). Keeping only 50/50 **silently re-weights every existing org's composite.** Needs a yes/no on re-scoring. |
| 5 | Decks >24 MB not opening | **ASK** | Both prototypes say `Max 50 MB`, byte-identical — a **pre-existing** gap, not a v3 change. `MAX_PDF_BYTES = 24 MB` is arithmetic, not arbitrary: ×1.333 base64 ≈ the 32 MB model-input cap. Raising the constant alone makes uploads succeed and **evaluations fail** — strictly worse. Needs the target number and a streaming/Files-API plan. |
| 6 | Assign: only "Evaluated & Complete" | **DECIDE** | `panel-assign` is **byte-identical** (md5 `b555211d…`), the assign renderers diff to zero lines, and the string occurs **0 times in either file**. v3 still draws the Incomplete drawer. We are asked to delete UI the reshared prototype still ships. |
| 7 | Query: only "Evaluated & Incomplete" | **DECIDE** | Same class. `panel-query`'s entire diff is one deleted select-all checkbox; the renderer is byte-identical and `qRenderList` filters nothing. The string occurs 0 times. |
| 8 | Upload → "Upload & Evaluate", redev | **ASK** | The redev is mostly a **deletion**: `#up-results` is gone and the footer collapses to one button — which is literally `showPanel('alldecks')` — while the screen still promises *"You approve → Credits deducted"*. Worse, a richer inline results card has **CSS and ~110 lines of JS but no markup**; `renderUpResults([0,3,5,7])` runs at load into a swallowed `catch`. **Likely a broken export — ask for a corrected file.** |
| 9 | Query after Evaluate in sidebar | **BUILD** | Already satisfied by §2. Zero-cost. |
| 10 | Evaluate page redev | **BUILD + DECIDE entry** | +533 B: new `AI Evaluate` toolbar button, select-all + "N selected" in column 1, sub-line *"evaluated decks move to the Assign screen"*. `evAiEvaluate()` → toast → `showPanel('assign')`. But the screen has no entry point (§2). |
| 11 | Core Parameters: AI prompts per seat | **BUILD** (console) | In the decoded console: Area-weights header `<th>Type</th>` → `<th>AI prompt</th>`, every one of the 13 rows gains an `AI prompt` button, plus `Restore all core AI prompts`. "prompt" occurs **91× in admin-v3 vs 7× in admin-v15**. Note the outer `panel-coreparams` drops `Type` *without* adding the column — the two surfaces disagree. |
| 12 | Configurability toggles under Area Weights | **BUILD** (console) | New: `Seat configurability` card, columns `Parameter set · Standard · Pro · Premium`, rows `Core parameters` / `Addl. parameters`. Defaults stated: *Standard — none · Pro — core only · Premium — core + additional.* It is an **edit permission**, not per-tier prompt content. |
| 13 | Visibility of other's evaluations | **BUILD** (console) — highest risk | New `Visibility for Incubator` (4×4) and `Visibility for VC` (5×5) matrices, *"Viewer (row) → can see scores of (column)"*. Footnote: *"Super User & Program Manager see everyone; Program Associate and Jury Member see no one — jury members cannot see each other (blind evaluation) until turned on here."* **This is the `role-boundary-leaks` class — enforce server-side, negative control mandatory.** |
| 14 | Intro calls scheduling flow | **MEASURE** | `panel-introcalls` is +410 B of **CSS only** (jury-pipeline flow-tag styles), and all 16 `nc*` functions are **byte-identical**. The client is right that our flow diverges — but from **v15**. This is a build defect nobody has measured. |
| 15 | Price config control panel | **BUILD** (console) | Rebuilt from an iframe into an inline section: `Paid trial`, `Individual plans — ₹ per period`, `Enterprise plans — ₹ annual`, and `Save & apply to My Account`. |
| 16 | Setup → Team & Roles realigned | **BUILD** | Wizard step 4 becomes *Nominate your super user*; the add-member block is deleted (−45 lines) and replaced by a handoff card to **Team & roles**, which gains an inline add-member form. |
| 17 | My account → Pricing revisited | **MEASURE** | The account overlay grew 56,019 → 71,008 bytes (**517 diff lines, unread**). It is item 15's other end: `prSave()` → `postMessage({type:'aisjPricing'})` → `acRefreshPricing()`. Do not let anyone estimate this without reading it. |
| 18 | All decks → "Dashboard" | **BUILD** | Verbatim. Superuser-only per the client, so use `labelOverrides`, not `label`. |
| 19 | Dashboard stat boxes + screens | **BUILD + DECIDE** | Six boxes, new order/labels/colours: Uploaded · AI Evaluated · Not AI Evaluated · Incomplete · **Archived** · Shortlisted. **`Assigned` is deleted — reversing Aug-2026 issue 4**, which is quoted in `deckStats.ts:166-167`. Tables collapse 4 shapes → 2. Archived is excluded from every other count, so the tile **denominator changes**. |

---

## 4. Decisions required before code is written

Four of these are *"delete something the client previously asked us to build"*.

- **Q1 — Stage-aware reports (item 1).** v3 deletes what W7-D and Issue 24 built, server-side included.
  Does "consistent at each stage" mean *identical everywhere* (delete `reportStage.ts` and the server's
  `stage` parameter), or *same visual design, stage-appropriate content*? These are very different builds.
- **Q2 — AI weight default (item 4).** Hiding all but 50/50 moves the effective default from 40/60.
  Do existing cohorts re-score, or is 50/50 new-orgs-only?
- **Q3 — Composite formula / AI weight (items 3, 4).** Confirm these override "match the prototype exactly".
- **Q4 — Assign & Query filters (items 6, 7).** The prototype contradicts both. Give the rule in words
  (which stages, which statuses), and confirm the Assign *Incomplete* drawer is to be removed.
- **Q5 — Upload results screen (item 8).** Is the inline results card real markup we did not receive, or
  is the single `Evaluate & Go to Dashboard →` button the whole design? Credits are deducted here.
- **Q6 — Evaluate entry point (item 10).** The screen is orphaned in v3. Where is it reached from?
- **Q7 — Assigned stat box (item 19).** Deleting it reverses Aug-2026 issue 4. Confirm.
- **Q8 — Upload size (item 5).** Target ceiling, and acceptance that >24 MB decks cannot be AI-evaluated
  without a streaming/Files-API change.

---

## 5. Build order (what blocks what)

1. **`nav.ts`, one commit, first.** Items 8, 9, 10, 18 all edit one array. Superuser-only
   `labelOverrides`, or `parity:nav` grows gaps against the four role prototypes that were *not* reshared.
   **In the same commit**, register `AISJ_SuperuserV3.HTM` and re-point `scripts/parity-lib.ts` — until
   then every change made from v3 registers as a *new* parity gap.
2. **Item 1 (report) before 2, 10, 19.** `EvaluationReportModal` has **9 call sites** across seven screens,
   and every one of those screens is edited by another item. Settle the shared leaf first.
3. **Item 15 before 17** (pricing producer before consumer). **Item 16 before any other wizard edit**
   (step 4 is deleted wholesale). **Item 11 before 12** (prompts must exist to be gated).
   **Item 10 before 6** (`evAiEvaluate` is what makes Assign post-evaluation).
4. **Item 5 last**, and only with the streaming work.

## 6. Files touched by more than one item

| File | Items |
|---|---|
| `src/shared/nav.ts` | 8, 9, 10, 18 — four items, one array |
| `src/server/routes/decks.ts` | 1, 5, 13, 19 — **the most dangerous file here** |
| `src/client/components/EvaluationReport.tsx` | 1, read by 2, 10, 19 via 9 call sites |
| `src/client/routes/admin/ScoringFramework.tsx` | 3, 4, 13 |
| `src/client/routes/admin/AreaWeights.tsx` | 11, 12 |
| the admin console registry | 3, 4, 11, 12, 13, 15, 16 |
| `src/client/routes/DashboardPage.tsx` | 1, 18, 19 |
| `UploadPage.tsx` + `upload/**` | 5, 8 — **and shared with the VC edition, which was not rescoped** |
| `e2e/parity.spec.ts` | 2, 6, 7, 8, 10, 18, 19 |

---

## 7. The session prompt

```
You are running session V3-SU — rebuilding the incubator SUPERUSER surfaces against the reshared
prototype AISJ_SuperuserV3.HTM. You have no prior context. Everything you need is in the repo.

SETUP
  cd /Users/jayanthkomarraju/Documents/GitHub/startup-jury && nvm use
  git worktree add ../sj-V3-SU -b parity/V3-SU main
  cd ../sj-V3-SU && npm ci
  python3 docs/prototype/tools/split-prototypes.py

READ FIRST — in this order, and nothing else
  1. docs/plan_v3_superuser.md — ALL of it. It is 128 lines and it is the brief. §1 especially.
  2. **Decode the admin console before you form any opinion about what is missing:**
       python3 docs/prototype/tools/decode-embedded.py \
         docs/prototype/source/incubator/AISJ_SuperuserV3.HTM ${TMPDIR:-/tmp}/v3
       python3 docs/prototype/tools/decode-embedded.py \
         docs/prototype/source/incubator/AISJ_IC_SuserV15.HTM ${TMPDIR:-/tmp}/v15
       diff -u ${TMPDIR:-/tmp}/v15/admin.html ${TMPDIR:-/tmp}/v3/admin.html > ${TMPDIR:-/tmp}/admin.diff
     **`Configurability`, `Visibility for Incubator`, `Visibility for VC`, `Price configuration`,
     `Composite formula`, `AI weight`, `Team & roles` and the 13 `AI prompt` buttons live ONLY inside
     that blob.** A plain grep of the .HTM returns ZERO hits for them. Scoping this release with grep
     alone already produced one wrong answer — do not repeat it.
  3. The outer panels, already split for you by step SETUP, under
     ${TMPDIR:-/tmp}/sj-prototype-split/. Diff each changed one against AISJ_IC_SuserV15's:
     alldecks +1006 · evaluate +533 · introcalls +410 (CSS only) · coreparams -13 · jurypipeline -34 ·
     query -78 · upload -2136 · assign IDENTICAL. Read only the renderers you need — grep
     `_scripts.js` by function name; it is 600+ KB and must never be read whole.
  4. docs/plan_parity.md — §1, §2, §4, and grep it for `W7-D` (it built the stage-aware report you may
     be asked to delete), `W7-A` and `W9-A` (the Dashboard), `W7-F` (the stage-screen config),
     `W8-B` (Core/My Parameters) and `issue 21` (the visibility class item 13 belongs to).
  Do NOT read docs/PARITY-FINDINGS.md (1.4 MB). Do NOT read a prototype .HTM whole.

STOP — eight decisions gate this work (§4). Before writing code for an item below, check whether its
question is answered in §4 of docs/plan_v3_superuser.md. If it is NOT, do the OTHER items, and record
the blocked one in §4 with what you would have done. Four of these ask you to DELETE something the
client previously asked for — never delete a tested behaviour on an unanswered question.
  Q1 report stage-awareness · Q2 AI-weight default re-scoring · Q3 formula/weight override ·
  Q4 Assign+Query filter rules · Q5 Upload results screen · Q6 Evaluate entry point ·
  Q7 Assigned stat box · Q8 upload ceiling

BUILD — in this order. The order is the point; it is derived from what blocks what.

  1. **nav.ts + the parity pin, ONE commit, first.**
     `src/shared/nav.ts`: `alldecks` label -> "Dashboard" and icon -> "LayoutDashboard";
     `upload` label -> "Upload & Evaluate"; the standalone `evaluate` item removed from the sidebar;
     `introcalls` moved ABOVE `forsignup`/prog-manager-pipeline. **Superuser-only, via
     `labelOverrides`, NOT by changing `label`** — the admin, PM, PA and jury prototypes were not
     reshared, and a global rename adds four new `parity:nav` gaps against them.
     In the SAME commit: register the new source in `scripts/parity-lib.ts:38`
     (`AISJ_IC_SuserV15` -> the v3 dir for role superuser). Until that is repointed EVERY change you
     make from v3 registers as a brand-new parity gap and the harness fights you all session.
     Removing `evaluate` from the sidebar does NOT remove its route — see step 4.

  2. **The evaluation report (item 1) — the shared leaf, before the screens that open it.**
     `EvaluationReportModal` has NINE call sites across `DashboardPage`, `EvaluatePage`, `AssignPage`,
     `StagePage`, `CallsPage`, `IcVotePage`, `VcEvaluatePage`. Change it first and the rest build on a
     settled component; change it last and you re-edit seven files.
     The client wants the report replicated EXACTLY, "including the positions of the items". Build it
     from the decoded prototype's own markup: every section in order, every column in order.
     **Gated on Q1.** v3 deletes `__introCols` / `__jTot` / the `__roleBlock` stage switch and
     hard-codes colspan 5 — i.e. it reverses `src/shared/reportStage.ts`, `reportStageForScreen()`,
     the `data-testid="report-stage"` badge AND the server's `reportLayout(edition, stage, role)` in
     `src/server/routes/decks.ts`. If Q1 is unanswered, bring the VISUAL design to parity and leave
     the stage mechanism alone. Do not delete a server-enforced behaviour on an inference.

  3. **Jury pipeline (item 2) — the cleanest item on the list, do it early for a win.**
     `src/client/routes/StagePage.tsx`, `INCUBATOR_STAGE_CONFIG.jurypipeline`. Delete the row-level
     Status column (the repeat was that pill PLUS the per-juror pills in the Jury cell). Action options
     drop from five to two — `Send to intro calls`, `Reassign / add jury` — and once used the cell
     becomes a flow tag ("Sent to intro calls" / "Reassigned"). The footer legend and `jpFoot`'s
     "N shortlisted · N rejected" counts still reference statuses the screen no longer sets: decide
     and record what the footer says now.

  4. **Dashboard (items 18, 19).** `src/shared/deckStats.ts` + `src/client/routes/DashboardPage.tsx`.
     Six boxes, v3 order and labels: Uploaded · AI Evaluated · Not AI Evaluated · Incomplete ·
     Archived · Shortlisted, with v3's colours (AI Evaluated green, Archived `--text-3`,
     Shortlisted purple). Sub-labels become STATIC prose — the computed "+3 since yesterday" /
     "N% of uploaded" strings are gone.
     **The denominator changes**: an archived deck is counted ONLY in Archived and excluded from every
     other tile and view. `build()` currently divides by `decks.length` — fix that or every tile is
     quietly wrong. Tables collapse from four shapes to two (a default 8-column set and a Shortlisted
     set); Sector, Assigned-to/date, Due date, Jury score and the parameter-score sparkline all go.
     `Assigned` is deleted — **gated on Q7**, because it reverses Aug-2026 issue 4, which is quoted in
     `deckStats.ts:166-167`.

  5. **Upload & Evaluate (items 8, 10).** `UploadPage.tsx` + `upload/**`, `EvaluatePage.tsx`.
     Evaluate gains the `AI Evaluate` toolbar button, a select-all + "N selected" in column 1, and the
     sub-line "evaluated decks move to the Assign screen"; `evAiEvaluate` with nothing selected
     evaluates all, toasts "N decks evaluated — sent to Assign", and navigates to Assign.
     **Gated on Q5 and Q6.** In v3 the Upload footer is one button that goes to the Dashboard while the
     screen still promises "You approve → Credits deducted", and the richer inline results card has CSS
     and ~110 lines of JS but NO markup. A literal build either spends credits with no preview or
     uploads nothing. **These files are shared with the VC edition, which the client did NOT rescope —
     every VC upload test must still pass unchanged.**

  6. **The admin console.** Everything here comes from the decoded blob, not the outer file.
     `src/client/routes/admin/` — `AreaWeights.tsx` (item 11: `Type` -> `AI prompt` column, a prompt
     button on each of the 13 areas, `Restore all core AI prompts`; item 12: the `Seat configurability`
     card — Parameter set × Standard/Pro/Premium, rows Core/Addl., defaults "Standard none · Pro core
     only · Premium core + additional"), `ScoringFramework.tsx` (items 3, 4 — gated on Q2/Q3; and the
     two new Visibility matrices), `PriceConfiguration.tsx` (item 15 — the iframe becomes an inline
     section: Paid trial, Individual plans ₹ per period, Enterprise plans ₹ annual, Save & apply),
     `TeamRoles.tsx` + `SetupWizard.tsx` (item 16 — wizard step 4 becomes "Nominate your super user",
     the add-member block moves into Team & roles).
     **Item 13 is the highest-risk thing in this session.** The visibility matrices are a PERMISSION
     SYSTEM, not a screen: a 4×4 incubator and 5×5 VC matrix of who may see whose scores, defaulting to
     "Super User & Program Manager see everyone; Program Associate and Jury Member see no one; jury
     cannot see each other until turned on". This repo has a named, recurring history of exactly this
     class leaking — grep docs/plan_parity.md for `issue 21`. **Enforce it in the server
     (`src/server/routes/decks.ts`, `canSeeEvaluatorScores`), never by not-rendering, and prove it with
     a negative control: revert the filter and watch the test fail.** A test that passes with the fix
     reverted is decoration — that exact mistake was caught here at Wave 9 integration.

  7. **Do NOT start:** item 5 (upload ceiling — Q8, and raising the constant alone makes uploads
     succeed and AI evaluation fail), item 14 (Intro calls — the prototype is byte-identical, so the
     gap is against v15 and nobody has measured it; MEASURE it and write the measurement into §3),
     item 17 (My account pricing — 517 unread diff lines; read `acct` in the decoded output first).

CONSTRAINTS
  - Incubator SUPERUSER only. Every other role's prototype is unchanged, so every other role's screens
    must render exactly as they do today, and a client test must say so.
  - The VC edition was not rescoped. `UploadPage`, `EvaluatePage`'s shared pieces and the report are
    shared — VC tests pass unchanged or you have broken something.
  - You own migration **0066** onward (`main` ends at 0065). Raise `ALLOTMENT_CEILING` in
    test/worker/migrations-w1b.test.ts from 65 in the SAME commit as any migration you add.
  - §2.2 hazard files: `src/client/index.css`, `src/shared/nav.ts`, `src/shared/roles.ts`,
    `src/client/App.tsx`. nav.ts is step 1 and is expected; declare anything else in §9.
  - A changed gate changes `npm run roles`: probes in `scripts/role-matrix.ts` in the SAME commit,
    against a server you PROVED you own with `lsof` (check the PID **and** its cwd). Baseline 1115/1115.

TEST
  - Client: every screen you touch, under a superuser, asserting the EXACT labels/headers/order from
    the prototype — literals copied from the decoded markup, not imported from the screen, so a rename
    fails the test. Plus: the same screens under admin / PM / PA / jury are UNCHANGED.
  - Worker: the visibility matrix — for each viewer role, a subject whose scores it may see (200 with
    the score present) and one it may not (absent from the PAYLOAD, not just the DOM). Then the
    negative control.
  - Unit: `deckStats` — the archived exclusion and the tile denominator.
  - E2E: a superuser walks Dashboard -> Upload & Evaluate -> Evaluate -> Assign and opens the report
    from two different screens, seeing the same layout. Create what you mutate; the suite is
    fullyParallel over one D1.
  - `e2e/parity.spec.ts`: re-capture ONLY the rows you own (`PARITY_CAPTURE=1`, `TMPDIR` at your own
    scratchpad, union into `EXPECTED`). Never delete a row you did not capture. 247 rows today.
  Green gate: npm run typecheck && npm run lint && npm test && npm run build && npm run test:e2e
  **`nvm use` first — the build needs Node 22; on Node 20 it dies with a `registerHooks` error that
  reads as a code fault and is not.** Baselines off `main`, never from a prompt: unit 2069 passed /
  1 skipped, roles 1115/1115, parity:tokens 0 gaps, parity:nav 62 known gaps, e2e ~224.
  `uptime` before the gate. Never conclude anything from a red run at load 40+ without re-running the
  file alone AND an untouched spec as a control. Before diagnosing an e2e failure,
  `grep -c "Network connection lost"` the run log — the dev server drops connections under load and
  takes unrelated specs with it; its tell is `Received: undefined` from a `toHaveCount`.
  Traps this codebase has actually paid for: gate client assertions on a POPULATED element, never a
  heading the loading branch also renders; never locate an element by the attribute your click is about
  to change; one sign-in per e2e test; guard a draft against StrictMode's double mount; and when you
  narrow a guard, check something is still left inside it.

FINISH
  Update docs/plan_v3_superuser.md: §3 states for what you closed, §4 answers or records each decision,
  and a new §8 Progress row with your measured gate. Anything you could not own goes in §9 of
  docs/plan_parity.md as a cross-session request with an exact diff.
  Commit to parity/V3-SU. Do not merge to main.
```
