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
| 18 | All decks → "Dashboard" | **DONE** (screen) / `V3-NAV` (sidebar) | `V3-DASH`: the `<h1>` is "Dashboard" for the incubator superuser only; `updateTitle()`'s `(activeStat !== 'all') ? statPart : 'Dashboard'` reproduced, context suffix intact. The sidebar LABEL is `V3-NAV`'s. |
| 19 | Dashboard stat boxes + screens | **DONE**, except the Assigned deletion (**Q7**) | `V3-DASH`: `v3DeckStats` / `matchesV3Stat` in `deckStats.ts`, superuser-only. Six boxes in prototype order with the static sub-labels and the prototype's colours (Shortlisted moved `--green` → `--purple`). **Denominator fixed**: `adUpdateStats`'s `c.all` is the NON-archived count, so an archived deck is counted once and excluded from every other tile and every other view — pinned at both layers with the negative control run (`22 to be 33`). Tables collapsed 4 → 2 (`v3Default` 8 cols shared by every box but Shortlisted; `v3Shortlisted` 5 cols), rows sort by `lastActivityAt` desc with the "· 2h ago" clock, and each row carries an `Actions ▾` select (Q32). **`Assigned` is RETAINED** pending Q7 — one constant, `ASSIGNED_TILE_RETAINED_PENDING_Q7`. |

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

### `V3-DASH` (Q31–Q34)

- **Q31 — `lastActivityAt` is DERIVED, not stored.** The prototype's `adData[].act` is a hand-placed
  integer with a hand-written `actLbl` ("2h ago"). Nothing here records "last activity", so
  `GET /api/decks` now computes it as the latest of: the deck's last `pipeline_events.created_at`, its
  own `decks.updated_at`, and `decks.created_at`. That means a **tag edit or a contact correction
  re-sorts a row to the top**, because both bump `updated_at`. If "activity" is meant to be pipeline
  movement ONLY, drop `updated_at` from `latestTimestamp(...)` in `toDeckView` — one argument.
  *(No migration needed; 0068 was allotted to this session and is UNUSED, still free.)*
- **Q32 — what the `Actions ▾` select offers.** The prototype's four options are `Send to Assign` ·
  `Send to Query` · `Edit` · `Archive`, against in-memory data with no pipeline behind them. Two of
  them are not transitions this app has from an arbitrary stage — `archive` is reachable only from
  `rejected`, and `assign_jury` only from `ai_evaluated` — so offering them verbatim would produce a
  menu whose entries 403. The select therefore lists **`deck.actions`**: the transitions the SERVER
  says this role may make from this deck's stage, plus `Edit` (the prototype's inline contact edit) on
  the default shape only. Confirm, or give the four literal options and the routes behind them.
  **Two transitions are withheld even where the server permits them** — the same two `StagePage`
  withholds. `assign_jury`: `POST /decks/:id/transition` would move the deck to Assigned with
  `assigned_to` still NULL, because only `POST /decks/:id/assign` sets an evaluator. Nothing is lost,
  since our Assign screen already lists every deck at `ai_evaluated` — the prototype's "Send to
  Assign" pushes a row onto an in-memory list and has no work to do here. `complete_signup`: the
  sign-up bypass. Both are pinned by tests asserting the option is ABSENT.
- **Q33 — the Shortlisted shape's `Signup status` is READ-ONLY.** `adSetSignup` writes
  `In progress / Completed / Delayed / Dropped` to an in-memory field that resets on reload; neither
  "Delayed" nor "Dropped" has any backing state here, and making the cell writable would reintroduce
  the sign-up bypass `StagePage.actionCell` deliberately removed ("a sign-up completes on the
  countersign, not on a click"). The cell reads the real sign-up record's status instead. Confirm, or
  say what Delayed and Dropped mean in the sign-up workflow.
- **Q34 — three states, thirteen stages.** `adData[].state` is one of `aieval` / `noteval` /
  `incomplete`, and the three must partition the live decks or the tiles stop summing to Uploaded.
  Read here as: *incomplete* = the existing Incomplete predicate (`statusId === "incomplete" ||
  signal === "flagged"`), so no deck changes box on the way to the new design; *aieval* = at
  `ai_evaluated` or past it, **or** carrying a score — off the STAGE first, so blind scoring cannot
  empty the box; *noteval* = `uploaded` / `pending_ai` / `manual_review`. Note this puts a **rejected**
  deck under AI Evaluated, which is true but may not be wanted on a dashboard.

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

## 7. The parallel wave — nine sessions, disjoint ownership

Run all nine at once. The partition is by FILE, so no session waits on another.

| Session | Items | Owns (and nothing else) | Migration |
|---|---|---|---|
| `V3-NAV`  | 9, 18-label, 8-label, 10-sidebar | `src/shared/nav.ts` · `scripts/parity-lib.ts` · `scripts/parity-nav.ts` · `test/unit/nav.test.ts` | 0066 |
| `V3-REP`  | 1 | `EvaluationReport.tsx` · `EvaluationDrawer.tsx` · `src/shared/reportStage.ts` · `GET /decks/:id/report` | 0067 |
| `V3-DASH` | 18-screen, 19 | `DashboardPage.tsx` · `src/shared/deckStats.ts` · the `GET /api/decks` list payload | 0068 |
| `V3-JP`   | 2 | `StagePage.tsx` → `INCUBATOR_STAGE_CONFIG.jurypipeline` only | 0069 |
| `V3-UP`   | 8, 10 | `UploadPage.tsx` · `src/client/routes/upload/**` · `EvaluatePage.tsx` | 0070 |
| `V3-AW`   | 11, 12 | `admin/AreaWeights.tsx` · AI-prompt storage + its route | 0071 |
| `V3-SF`   | 3, 4, 13 | `admin/ScoringFramework.tsx` · `canSeeEvaluatorScores` + its enforcement | 0072 |
| `V3-PT`   | 15, 16, 17 | `admin/PriceConfiguration.tsx` · `admin/TeamRoles.tsx` · `SetupWizard.tsx` · My account | 0073 |
| `V3-FLOW` | 6, 7, 14 | `AssignPage.tsx` · `QueryPage.tsx` · `CallsPage.tsx` incubator configs | 0074 |

**Ordering: there is none. Start all nine at once.** `parity:nav`/`parity:tokens` are not in the green
gate, and no vitest or Playwright test reads `parity-lib` or the prototype files — so no session's work
depends on another's landing. The only real contention is the GATE: nine concurrent gates turn a
~6-minute suite into a 40-minute one. Stagger those, not the starts.

**`main` ends at migration 0065 and `ALLOTMENT_CEILING` is 65.** Take only your number, and raise the
ceiling in `test/worker/migrations-w1b.test.ts` in the SAME commit if you use it.

**`src/server/routes/decks.ts` is wanted by three sessions — ownership is BY ROUTE, not by file:**
`V3-REP` owns `GET /decks/:id/report`; `V3-DASH` owns the `GET /api/decks` list payload; `V3-SF` owns
the score-visibility filter. Touch only your own; anything else is a §9 request with an exact diff.

**Question numbering** (so no session renumbers another's): `V3-NAV` Q11 · `V3-REP` Q21 · `V3-DASH` Q31 ·
`V3-JP` Q41 · `V3-UP` Q51 · `V3-AW` Q61 · `V3-SF` Q71 · `V3-PT` Q81 · `V3-FLOW` Q91. §4 holds Q1–Q8.

### The block every prompt carries

```
SETUP
  cd /Users/jayanthkomarraju/Documents/GitHub/startup-jury && nvm use
  git worktree add ../sj-<ID> -b parity/<ID> main
  cd ../sj-<ID> && npm ci
  python3 docs/prototype/tools/split-prototypes.py
  python3 docs/prototype/tools/decode-embedded.py \
    docs/prototype/source/incubator/AISJ_SuperuserV3.HTM ${TMPDIR:-/tmp}/v3
  python3 docs/prototype/tools/decode-embedded.py \
    docs/prototype/source/incubator/AISJ_IC_SuserV15.HTM ${TMPDIR:-/tmp}/v15

READ FIRST
  1. docs/plan_v3_superuser.md — ALL of it (295 lines). §1 is why your grep will lie to you.
  2. **The admin console is base64.** Scoring framework, Composite formula, AI weight, Price
     configuration, Team & roles, the Configurability card and BOTH visibility matrices exist ONLY
     inside ADMIN_B64. A plain grep of the .HTM returns ZERO hits for every one of them. Decode first
     (SETUP does it) and diff ${TMPDIR:-/tmp}/v15/admin.html against ${TMPDIR:-/tmp}/v3/admin.html.
  3. Your panels from ${TMPDIR:-/tmp}/sj-prototype-split/. Grep `_scripts.js` by function name —
     it is 600+ KB and must NEVER be read whole. Never read a prototype .HTM whole, and never read
     docs/PARITY-FINDINGS.md (1.4 MB).

CONSTRAINTS
  - Incubator SUPERUSER only. Only the superuser prototype was reshared — admin, program manager,
    program associate and jury still ship the OLD design, so their screens must render exactly as they
    do today and a client test must say so.
  - The VC edition was NOT rescoped. Where a file is shared with VC, every VC test passes unchanged.
  - §2.2 hazard files — `src/client/index.css`, `src/shared/nav.ts`, `src/shared/roles.ts`,
    `src/client/App.tsx`. Only `V3-NAV` may edit nav.ts. For anyone else it is a §9 request.
  - A changed gate changes `npm run roles`: probes in `scripts/role-matrix.ts` in the SAME commit,
    against a server you PROVED you own with `lsof` (check the PID **and** its cwd). Baseline 1115/1115.
  - `e2e/parity.spec.ts`: re-capture ONLY your own rows (`PARITY_CAPTURE=1`, `TMPDIR` at your own
    scratchpad, union into `EXPECTED`). NEVER delete a row you did not capture — eight siblings are
    re-capturing theirs at the same moment. 247 rows today.

TEST + GATE
  Green gate: npm run typecheck && npm run lint && npm test && npm run build && npm run test:e2e
  **`nvm use` first** — the build needs Node 22; on Node 20 it dies with a `registerHooks` error that
  reads as a code fault and is not. Baselines off `main`, never from a prompt: unit **2069 passed /
  1 skipped**, roles **1115/1115**, `parity:tokens` 0 gaps, `parity:nav` 62 known gaps, e2e ~224.
  `uptime` BEFORE the gate; never run yours while a sibling runs theirs
  (`ps -eo args | grep -E "playwright test|vitest"`); run e2e on YOUR `E2E_PORT`.
  Before diagnosing ANY e2e failure, `grep -c "Network connection lost"` the run log — the dev server
  drops connections under load and takes unrelated specs with it; its tell is `Received: undefined`
  from a `toHaveCount`. Zero drops means look at the code. Never conclude from a red run at load 40+
  without re-running the file alone AND an untouched spec as a control.
  Traps this codebase has actually paid for: gate client assertions on a POPULATED element, never a
  heading the loading branch also renders; never locate an element by the attribute your click is
  about to change; one sign-in per e2e test; guard a draft against StrictMode's double mount; and when
  you narrow a guard, CHECK SOMETHING IS STILL LEFT INSIDE IT.

FINISH
  Update docs/plan_v3_superuser.md — §3 state for each item you closed, §4 for any decision you hit,
  and a §8 Progress row with your MEASURED gate. Anything outside your ownership is a §9 row in
  docs/plan_parity.md with an exact diff. Commit to parity/<ID>. Do not merge to main.
```

### Per-session BUILD blocks

**`V3-NAV`** — the sidebar, and the parity pin that stops the harness fighting everyone.
```
BUILD
  1. Register the new source and REPOINT the harness, first commit:
     `scripts/parity-lib.ts:38` currently reads
       { dir: "AISJ_IC_SuserV15", edition: "incubator", role: "superuser" }
     Point the superuser row at the v3 file (already committed at
     docs/prototype/source/incubator/AISJ_SuperuserV3.HTM). Until it is repointed, `npm run parity:nav`
     compares your sidebar against the OLD prototype and reports every correct change as a gap.
     **This blocks only YOU** — `parity:nav` and `parity:tokens` are not in the green gate, and no
     vitest or Playwright test reads `parity-lib` or the prototypes, so the other eight sessions are
     unaffected either way. Do it first because your own work is unreadable until you do.
  2. Superuser-only labels, via `labelOverrides`, NOT by changing `label`:
       alldecks -> "Dashboard" (icon "LayoutDashboard"; NavIcon already maps it)
       upload   -> "Upload & Evaluate"
     Changing `label` instead adds four new label gaps against the admin/PM/PA/jury prototypes, which
     were NOT reshared.
  3. Hide the standalone `evaluate` item FROM SUPERUSER ONLY. This needs a new mechanism: `roles`
     lists non-superuser roles and superuser bypasses it (nav.ts:44 "Superuser always sees all").
     Add something minimal and tested — e.g. `hiddenFor?: Role[]` honoured by `canSeeNav` — and keep
     the ROUTE alive: `/app/evaluate` must still render (V3-UP reaches it from Upload).
  4. Order: `introcalls` moves ABOVE the prog-manager-pipeline item. `parity-nav` asserts
     missing-route / role-gap / label / extra and does NOT assert order, so this is free to the
     harness but visible to every role — record in §4 (Q11) whether it is superuser-only or global.
TEST
  Unit: `navForUser("incubator","superuser")` — exact ids in exact order, `evaluate` absent, and the
  two labels via `navLabel`. Then the SAME assertion for admin, program_manager, program_associate and
  jury proving their sidebars are byte-identical to today.
  `npm run parity:nav` — report the number before and after; it should not grow.
```

**`V3-REP`** — the evaluation report. The shared leaf: nine call sites across seven screens.
```
BUILD
  The client wants this replicated EXACTLY, "including the positions of the items". Build from the
  prototype's own markup: every section in order, every column in order, every label verbatim.
  Extract the renderer first — in v3/_scripts.js the report builder is `window.openReport` (~line 4042,
  10,539 bytes); the v15 one is at ~3713 (11,175 bytes). Diff them.
  **GATED ON Q1 (§4).** v3 DELETES stage-awareness: `__introCols`, `__jTot` and the `__roleBlock`
  stage switch are gone and colspan is hard-coded 5. That reverses W7-D and Issue 24, and it is
  SERVER-ENFORCED — `reportLayout(edition, parseReportStage(...), role)` in the report route.
  If Q1 is unanswered: bring the VISUAL design to parity and LEAVE THE STAGE MECHANISM ALONE. Do not
  delete a tested, server-enforced behaviour on an inference. Record what you would have done.
  **Props-additive only.** Seven screens render `EvaluationReportModal`; a required new prop breaks
  all of them and collides with four sibling sessions. Change internals, not the signature.
CONSTRAINTS
  You own `GET /decks/:id/report` in decks.ts and NOTHING else in that file — V3-DASH owns the list
  payload, V3-SF owns the visibility filter.
TEST
  Client: the report's exact section order and column order, literals copied from the decoded markup
  (not imported from the component, so a rename fails). Open it from two different screens and assert
  the SAME structure. Worker: the report route for an allowed and a forbidden role.
```

**`V3-DASH`** — Dashboard, and the denominator that will silently lie if you miss it.
```
BUILD
  1. Six stat boxes, v3 order and labels: Uploaded · AI Evaluated · Not AI Evaluated · Incomplete ·
     Archived · Shortlisted. Colours from the prototype (AI Evaluated green, Archived `--text-3`,
     Shortlisted purple). Sub-labels become STATIC prose — the computed "+3 since yesterday" /
     "N% of uploaded" strings are gone, so their helpers die with them.
  2. **The denominator changes.** An archived deck is counted ONLY in Archived and excluded from every
     other tile and every other view. `build()` in deckStats.ts divides by `decks.length` today — fix
     that or every tile is quietly wrong, which no test will notice unless you write it.
  3. Tables collapse from four shapes to two: a default 8-column set (Startup · Founder · Phone ·
     Email · City · AI score · Status · Actions) shared by five boxes, and a Shortlisted set
     (Startup · AI score · Avg. score · Signup status · Actions). Sector, Assigned-to/date, Due date,
     Jury score and the parameter-score sparkline all go. Rows gain an `Actions ▾` select — note the
     Shortlisted shape's select omits `Edit`.
  4. `Assigned` tile deleted — **GATED ON Q7**: this reverses Aug-2026 issue 4, which is quoted in
     `deckStats.ts:166-167`. If unanswered, build the other five and leave Assigned in place.
  5. Rows sort by recent activity descending with a "· 2h ago" clock. That field is not on the list
     payload — you own `GET /api/decks`, so add it, or record in §4 (Q31) that it is derived.
TEST
  Unit: deckStats — the archived exclusion AND the denominator, asserted as numbers.
  Client: the six tiles in order with exact labels; both table shapes' exact headers.
```

**`V3-JP`** — the cleanest item in the wave.
```
BUILD
  The repeat is the row-level Status pill PLUS the per-juror `jp-jstat` pills in the Jury cell. The
  v3 markup diff is ONE line: `-<th>Status</th>`. Delete the row-level Status column from
  `INCUBATOR_STAGE_CONFIG.jurypipeline` in StagePage.tsx.
  Action options drop from five to two — `Send to intro calls` and `Reassign / add jury` — and once
  used the cell becomes a flow tag ("Sent to intro calls" / "Reassigned").
  The footer legend (Assigned / Shortlisted / Rejected / Pending) and `jpFoot`'s "N shortlisted ·
  N rejected" still name statuses the screen no longer sets. Decide what the footer says now and
  record it (Q41) — do not leave a legend decoding a column that no longer exists.
CONSTRAINTS
  Own ONLY the `jurypipeline` entry. The other INCUBATOR_STAGE_CONFIG entries and every VC entry
  belong to other people; StagePage's shared renderer is not yours to restructure.
TEST
  Client: the screen's exact headers (Status ABSENT), the two action options, the flow tag after use,
  and the footer sentence. Plus: every other incubator stage screen renders unchanged.
```

**`V3-UP`** — Upload & Evaluate. Two open questions; do the evidenced half.
```
BUILD
  1. Evaluate (item 10) is fully evidenced — build it: the `AI Evaluate` toolbar button, a select-all
     plus "N selected" in column 1, and the sub-line "Select decks and click AI Evaluate · evaluated
     decks move to the Assign screen. Click a deck to open its report." `evAiEvaluate` with nothing
     selected evaluates ALL, toasts "N decks evaluated — sent to Assign", then navigates to Assign.
  2. **GATED ON Q6** — the prototype ORPHANS this screen: the sidebar item is gone and
     `showPanel('evaluate')` appears once, inside `upSendToEvaluate()`, which has no callers. Keep the
     route working and reach it from Upload; record the entry point you chose.
  3. **GATED ON Q5** — Upload's "redev" is mostly a DELETION: `#up-results` is gone and the footer is
     one button that is literally `showPanel('alldecks')`, while the screen still promises
     "You approve → Credits deducted". A richer inline results card has CSS and ~110 lines of JS but
     NO markup (`renderUpResults([0,3,5,7])` runs at load into a swallowed catch). That reads as a
     broken export. **Do not spend credits with no preview.** If Q5 is unanswered, keep the existing
     review step and change only the title/label, and say so.
  4. Do NOT touch the upload size limit (item 5) — Q8, and raising `MAX_PDF_BYTES` alone makes uploads
     succeed and AI evaluation FAIL (×1.333 base64 ≈ the 32 MB model-input cap). Strictly worse.
CONSTRAINTS
  These files are SHARED WITH THE VC EDITION, which the client did not rescope. Every VC upload and
  VC intake test must pass unchanged — assert it.
```

**`V3-AW`** — Area weights: the AI prompts, and who may edit them.
```
BUILD
  Everything here is in the DECODED console (${TMPDIR:-/tmp}/v3/admin.html), section `s-wt`.
  1. Item 11: the Area-weights table header `<th>Type</th>` becomes `<th>AI prompt</th>`, and each of
     the 13 areas gains an `AI prompt` button opening its prompt editor, plus `Restore all core AI
     prompts`. "prompt" occurs 91× in admin-v3 vs 7× in admin-v15 — that is the size of this.
  2. Item 12: the `Seat configurability` card — columns `Parameter set · Standard · Pro · Premium`,
     rows `Core parameters` and `Addl. parameters`, with the prototype's stated defaults:
     "Standard — none · Pro — core only · Premium — core + additional."
     It is an EDIT PERMISSION, not per-tier prompt content: all three tiers read the same 13 prompts.
  3. The prototype has NO persistence — `CFG_CAP`, `CORE_PROMPTS` and `ADDL` are in-memory JS that
     reset on reload. You must design the storage and the route. Take migration 0071.
  4. Note the outer `panel-coreparams` drops `Type` WITHOUT adding the AI-prompt column, so the two
     surfaces disagree. Record which one wins (Q61).
TEST
  Worker: the prompt route — an allowed role and a forbidden one; and a seat tier that may NOT
  configure gets 403 on the WRITE, not merely a hidden button.
```

**`V3-SF`** — Scoring framework. The highest-risk session in the wave; treat it as such.
```
BUILD
  All three items are in the DECODED console, section `s-fw`.
  1. **Item 13 — the visibility matrices. This is a PERMISSION SYSTEM, not a screen.**
     `Visibility for Incubator` is 4×4 (Super User · Program Mgr · Program Assoc · Jury Member) and
     `Visibility for VC` is 5×5 (Mng Partner · IC · Partner · Inv. Assoc · Analyst), captioned
     "Viewer (row) → can see scores of (column)". The prototype states the defaults: "Super User &
     Program Manager see everyone; Program Associate and Jury Member see no one — jury members cannot
     see each other (blind evaluation) until turned on here."
     Today this is the FIXED rank ladder `canSeeEvaluatorScores` / `EVALUATION_RANK` in roles.ts.
     Making it configurable means persisting a matrix and reading it everywhere that helper is called.
     **This repo has a named, recurring history of exactly this class leaking** — grep
     docs/plan_parity.md for `issue 21`. Enforce it in the SERVER and assert on the RESPONSE PAYLOAD,
     never by not-rendering. **Run the negative control: revert your filter and watch the test fail.**
     A test that still passes with the fix reverted is decoration — that exact mistake was caught here
     at Wave 9 integration, where the first issue-21 test was vacuous because row COUNTS never moved
     and only the means did.
  2. **Items 3 and 4 — GATED ON Q2/Q3, and item 4 is not cosmetic.** The console still offers all
     three formulas and all four AI splits, so hiding them OVERRIDES "match the prototype exactly" —
     the client marked both *Workaround*. Worse: the AI-weight select has NO `selected` attribute, so
     `40% AI · 60% Jury` is the effective default, and `migrations/0026` agrees
     (`ai_weight_pct DEFAULT 40`). Keeping only 50/50 SILENTLY RE-WEIGHTS every existing org's
     composite. Do not ship that on an inference — if Q2 is unanswered, hide nothing and record it.
CONSTRAINTS
  You own `canSeeEvaluatorScores` and its enforcement, and NOTHING else in decks.ts.
```

**`V3-PT`** — pricing and team: one producer, one consumer, one wizard.
```
BUILD
  1. Item 15 — Price configuration is rebuilt from an IFRAME into an inline console section: three
     cards, `Paid trial`, `Individual plans — ₹ per period` (Seat · Quarterly · Half-yearly · Annual)
     and `Enterprise plans — ₹ annual` (Plan · Seats · Annual price), plus `Save & apply to My
     Account`. The repo's PriceConfiguration.tsx was built against the OLD iframe — compare before
     rewriting.
  2. Item 17 — My account's pricing is the OTHER END of item 15. In the prototype the wire is
     `prSave()` → `postMessage({type:'aisjPricing'})` → `acRefreshPricing()`; in the repo it must be a
     real store, so BUILD 15 FIRST. The account overlay grew 56,019 → 71,008 bytes and those ~517
     diff lines are UNREAD — read them before you estimate, and put the measurement in §3.
  3. Item 16 — setup wizard step 4 becomes "Nominate your super user": the add-member block is deleted
     (−45 lines) and replaced by a handoff card to Team & roles, which gains an inline add-member
     form and `plan + Active/Invited` member pills.
     Confirm existing wizard invites are MIGRATED, not stranded (Q81).
```

**`V3-FLOW`** — the two filter rules the prototype contradicts, and the one item nobody has measured.
```
BUILD
  1. **Items 6 and 7 are BLOCKED ON Q4 and the prototype disagrees with the instruction.**
     `panel-assign` is BYTE-IDENTICAL between v15 and v3 (md5 b555211d…), the assign renderers diff to
     zero lines, v3 still draws the `Incomplete` toolbar button and the Incomplete drawer, and
     `qRenderList` filters nothing. The strings "Evaluated & Complete" and "Evaluated & Incomplete"
     occur ZERO times in either file. You are being asked to delete UI the reshared prototype still
     ships. **Do not infer the rule.** Write the two candidate readings into §4 (Q91) in the repo's own
     stage vocabulary (read src/pipeline/incubator.ts and src/shared/queries.ts) and stop there.
  2. **Item 14 is the one item on the list whose cost is entirely unmeasured — MEASURE IT.**
     `panel-introcalls` is +410 bytes of CSS ONLY (jury-pipeline flow-tag styles), and all 16 `nc*`
     functions are BYTE-IDENTICAL between v15 and v3. So the client is right that our scheduling flow
     diverges — but from v15, and nobody has ever diffed it. Diff `CallsPage.tsx`'s incubator intro-call
     modal against the prototype's (`ncCallOpenModal`, `ncCallSchedule`, `ncCallRenderRoles`, `ncAssign`)
     and write the gap list into §3 with an effort estimate. The prototype has NO date input, NO
     duration, NO location, NO founder email and NO additional-guests field — several repo fields are
     inventions. Say which of ours must go.
     Then build what the measurement shows, smallest-first.
```

---

## 8. Progress

| Session | State | Items | Measured gate | Notes |
|---|---|---|---|---|
| `V3-DASH` | **done** (branch `parity/V3-DASH`, not merged) | **18** (screen half) and **19** closed, except the Assigned deletion which is held on **Q7** | typecheck ✓ · lint ✓ · **`npm test` 2098 passed / 1 skipped** ✓ (baseline 2069/1 → +29: 12 unit · 6 worker · 11 client) · build ✓ · **e2e 212 passed / 0 failed / 12 flaky** ✓ (9.1 min, load 3, port 5241) · **roles 1115/1115, 0 failed** ✓ (port 5242, PID's cwd `lsof`-proved to be this worktree) | Two e2e runs — see "The e2e result". |

### What landed

**`src/shared/deckStats.ts`** — a third incubator set at the foot of the file: `v3DeckStats`,
`matchesV3Stat`, `v3DeckState`, `isArchivedDeck`, `latestTimestamp`. It is **superuser-only**;
`STAT_ORDER` and `build()` are untouched, so admin / PM / PA and the whole VC edition keep the six
they have. The computed sub-label helpers (`uploadedSince`, the `pct`-based `sub`s) therefore do NOT
die with v3's static prose — those roles still use them.

**The denominator.** `adUpdateStats`'s `c.all` is the count of NON-archived decks, and every bar
divides by it — Archived's own bar included. `build()` divides by `decks.length`, which is correct
for the old sets (they have no archived exclusion) and silently wrong for these, so the v3 set has
its own builder rather than another `STAT_ORDER` row. Every tile's count now comes from
`matchesV3Stat` — the same predicate the table filter uses — so a tile cannot disagree with the rows
its own view draws, and that is asserted as a loop over all seven keys.

**Both negative controls were run, and the first version of one test was decoration.**
Reverting `active.length` → `decks.length` fails with `expected 22 to be 33` (unit) and
`Uploaded: "7"` (client); removing the `if (isArchivedDeck(deck)) return false` guard fails six
tests across both layers. The worker test's "format trap" case, however, **passed with the broken
implementation** on its first draft, because its two timestamps were on different DAYS — and once the
dates differ, lexicographic order happens to agree with real order. Re-cut onto a single day in both
directions; it now fails as `expected '2026-06-02T09:00:00.000Z' to be '2026-06-02 15:00:00'`.

**`GET /api/decks`** gains `lastActivityAt` and `queried` (Q31). No migration: **0068 was allotted to
this session and is UNUSED, still free.** `lastActivityAt` is folded in TypeScript with
`latestTimestamp()`, never with SQL `MAX()` — D1 writes `datetime('now')` and `toISOString()` into
columns that get compared here, and " " sorts below "T", so a lexicographic max returns the ISO value
whatever the real order.

**`DashboardPage.tsx`** — `isV3Dash` gates the whole change on `incubator` + `superuser`. Title
"Dashboard", the six boxes with the prototype's static prose and colours (Shortlisted `--green` →
`--purple`), two table shapes replacing four, rows sorted by activity with the `· 2h ago` clock, the
`Actions ▾` select (Q32), the inline contact edit, and the read-only Sign-up status (Q33). Aug-2026
issue 2's tag chips stay on the row: item 19 names exactly what the collapse drops and tags are not
on that list.

### Tests, and what they are for

`test/client/allDecks.test.tsx`'s `mount()` default role moved **superuser → admin**, so every
pre-existing assertion in that file now stands as the proof that the un-reshared design did not move,
and a new block adds `admin` · `program_manager` · `program_associate` each asserting All decks, the
v15 six, the founder-details headers, the v15 denominator (7, archived included) and no row-action
select — plus the jury's My Pipeline. `test/worker/alldecks-v3-activity.test.ts` is new.
`e2e/parity.spec.ts`: **one row re-captured**, `incubator/superuser/alldecks`; the four sibling
incubator rows untouched. `e2e/all-decks.spec.ts`'s superuser test was **restated, not weakened** —
same three things proved (the table re-shapes per box, a box narrows the rows to its own count, the
report opens from the name) against the new design, plus a data-independent archived-exclusion check.
No other e2e spec needed touching: `programs`, `coverage`, `csp`, `config` and `audit-log` walk
`alldecks` as the **admin**, `upload` as the **program associate**, and `chrome` asserts only shell
geometry.

### Two transitions the row menu withholds

`assign_jury` and `complete_signup` — the same two `StagePage` withholds, for the same reasons.
`POST /decks/:id/transition` would apply `assign_jury` **without an evaluator**, stranding the deck at
Assigned with `assigned_to` NULL (only `POST /decks/:id/assign` sets one); nothing is lost, because
our Assign screen already lists every deck at `ai_evaluated`, so the prototype's "Send to Assign" —
a push onto an in-memory list — has no work to do here. `complete_signup` is the sign-up bypass.
Both are pinned by tests asserting the option is ABSENT.

### The e2e result, read honestly

**Run 2, at load 3 on a quiet box: 212 passed · 0 FAILED · 12 flaky (9.1 min). The gate is green.**
`incubator/superuser` passed **first try** — not even flaky — as did both `e2e/all-decks.spec.ts`
tests. Run 2 carried **271** `fetch failed` (more than twice run 1's 112) and still failed nothing,
which is the clearest statement of what that noise is: endemic to this dev server, absorbed by the
one configured retry, and unrelated to any assertion.

**A mechanism, not a guess.** Minutes after run 1, starting an ordinary dev server on this box for
the roles probe died at `connect EADDRNOTAVAIL 127.0.0.1:54647` while applying migration 0037 — the
machine could not allocate a local ephemeral port. Vite proxies to miniflare's workerd over exactly
such a socket, so `undici` → `miniflare.dispatchFetch` → `fetch failed` is that same exhaustion seen
from the other side. Nine sibling worktrees running gates concurrently is what exhausts it. The
server booted first try once the box was quiet.

**Run 1, for the record — 3 failed · 3 flaky · 218 passed at load 15–40, and not one of the six named
a column set or a title.**
All six are `e2e/parity.spec.ts` role walks or a login, and the run log carries **112
`[vite] Internal server error: fetch failed`** out of `miniflare.dispatchFetch`. The preserved
`error-context.md` snapshots show the page served was **vite's own error page** — `heading "Internal
Server Error"` / `heading "fetch failed"` — so the app was never reached. The three that got far
enough to name a screen name `account`, `issues` and `contactadmin`; the other three are `h1
element(s) not found` and `locator.fill` timeouts on a dead page.

This is the §9 infra pattern `plan_parity.md` records, **with a different signature**: that row says
the tell is `Network connection lost` and `Received: undefined`, and BOTH runs had **zero** of those.
On this vite/undici build it surfaces as `fetch failed` and `Received: "Internal Server Error"`.
**Grep for BOTH** — a session that greps only the recorded string will conclude "zero drops, look at
the code" and go hunting a defect that is not there.

**The positive evidence that this branch is not the cause:** `alldecks` is item **0** of the
superuser walk and the assertion is inside the loop — the failing retry reached `account`, item
**18**. Screens 0–17 passed, so the new `Dashboard` title and the new 8-column header set were
observed and matched before the server died. `incubator/program_associate` and `vc/superuser` are
roles this branch does not touch at all.

Run-1 artefacts (log + all nine `error-context.md`) were preserved to this session's scratchpad
BEFORE run 2 — Playwright clears `test-results/` at the start of the next run, and `plan_parity.md`
§9 records that snapshot being lost twice before.

### `npm run roles` — 1115/1115, unchanged

No gate changed here: no route guard, no nav item, no permission. Confirmed rather than assumed —
**1115 checks · 1115 passed · 0 failed**, against a server whose PID's cwd was `lsof`-proved to be
this worktree before any number from it was believed. `scripts/role-matrix.ts` therefore needed no
new probe.
