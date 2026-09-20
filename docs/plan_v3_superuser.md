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
| 11 | Core Parameters: AI prompts per seat | **DONE** (`V3-AW`) | Console `s-wt`: `<th>Type</th>` → `<th>AI prompt</th>`, a `wt-prompt-btn` on each of the 13 rows opening an inline editor (Edit ↔ Save, `Restore default`), and `Restore all core AI prompts`. The role cards' 4th column `Permit configuration` → `AI prompt`, plus `Restore all additional-parameter prompts` — **the additional half is not in §3's original scope note but is half the diff**: v3 deletes the three static role cards and renders them from `ADDL` via `addlRender()`. **What was missing was the DEFAULT, not the prompts**: `parameters.prompt` has existed since `0013` and `0027` wrote a real extraction prompt into all 26 core rows + 18 additional. Migration `0071` adds `prompt_default`. Superuser-only — see Q64. |
| 12 | Configurability toggles under Area Weights | **DONE** (`V3-AW`) | Section `Configurability` → card `Seat configurability`: `Parameter set · Standard · Pro · Premium` × `Core parameters` / `Addl. parameters`. **The prototype's stated defaults are already the application's hard-coded ladder** — `planAllowsCore` / `planAllowsAdditional` in `src/shared/plans.ts` are byte-for-byte "Standard — none · Pro — core only · Premium — core + additional". So item 12 is *making that ladder data*: `seat_capabilities` (0071), a capability argument those two functions now take (defaulting to today's answer), and every gate in `config.ts` reading it. Enforced server-side — 402 on the WRITE, with the negative control run. v3 also **deletes the per-parameter `Permit configuration` pill** this replaces, and its sub-line sentence with it. |
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
### `V3-AW` (items 11, 12) — Q61–Q66

- **Q61 — Which surface wins for the `Type` column?** Confirmed by measurement: the outer
  `panel-coreparams` drops `Type` and goes to **four** columns (`# · Evaluation area · Weight % ·
  Visual`), while the console's `s-wt` replaces it with **`AI prompt`** and stays at five. Both are
  in the v3 file; they simply disagree. **Built: the console only.** `ConfigPage.tsx` (the outer
  `/app/coreparams` screen) is not in any session's ownership this wave and is untouched, so its
  four `e2e/parity.spec.ts` rows still read `["#","EVALUATION AREA","TYPE","WEIGHT %","VISUAL"]`
  and needed no re-capture. If the client wants the outer panel aligned too, that is a one-column
  deletion in `ConfigPage.tsx` **plus** four parity rows — and it must be done by one session,
  because those rows are shared with admin/PM/PA/jury whose prototypes still show `Type`.
- **Q62 — Whose 13 core prompts?** *(the real decision in item 11, and it changes scores)*
  The prototype ships `CORE_PROMPTS` — thirteen section headings ("What can kill this?", "Does the
  business make sense?") each followed by an identical 200-character tail about the follow-up
  email. The application already has thirteen *different* ones per edition, written by `0027`
  (W2-B) as extraction instructions ("Look for credible TAM/SAM/SOM built bottom-up and a reachable
  beachhead. Flag top-down-only sizing."), and `evaluate.ts` renders them into every rubric.
  **Adopting the prototype's would change what the model is asked on every incubator deck.** So
  `0071` takes each org's CURRENT prompt as its shipped default — `Restore default` returns you to
  the text you were evaluating against — and the prototype's thirteen are recorded verbatim and
  **unapplied** in `src/shared/aiPrompts.ts` as `PROTOTYPE_CORE_PROMPTS`, asserted intact by
  `test/worker/aiPrompts.test.ts`. If the client confirms they are the intended content, applying
  them is one migration; **it is a re-score event, so it needs the same yes/no as Q2.**
- **Q63 — Does the VC edition get any of this?** Built as **no**. `AISJ_VC_Superuser_V8`'s own
  console still draws `<th>Type</th>` with no prompt button and no `cfg-table` (checked in the
  split), and §7 says every VC test passes unchanged. `seat_capabilities` seeds VC rows at today's
  ladder so nothing moves there either. One line in `usesV3AreaWeights` if that is wrong.
- **Q64 — And the incubator ADMIN?** Built as **no**, for the same reason: `AISJ_ICAdmin_V6`'s
  console is the old section, and only admin + superuser can open the console at all
  (`canOpenAdminConsole`). So the screen is forked on `edition === "incubator" && role ===
  "superuser"`, with a client test asserting the admin still gets `Type` and `Permit
  configuration`. Note the consequence: **an admin can no longer reach the prompt editors at all.**
  If admins are meant to edit prompts, the fork needs widening — the server already allows them
  (`requireTask("adminconsole", "admin")` + a Pro seat), so it is a UI change only.
- **Q65 — Do the AI+ / AI++ / AI+++ badges stay?** Built as **yes**, against the prototype.
  v3's `addlRender()` drops them and the `Set total: max 30` footer. The footer went (its sentence
  is duplicated in the sub-line above, so nothing was lost); the badges stayed, because F0078 put
  them there deliberately, `AssignPage.tsx` and the report still print AI+ / AI++ / AI+++, and
  nothing else on the screen says which role produces which. That same rewritten block is also
  demonstrably careless — its prose says the three owners are *Super User*, Program Manager and
  Jury Member while its own JS renders *Program Associate*, Program Manager and Jury Member, which
  is what the repo already has. Removal is one `{!v3 && …}` if the client wants it.
- **Q66 — Who grants `config_permitted` now?** *(a live permission the prototype's deletion drops)*
  The `Permit configuration` pill v3 removes is not decoration. `parameters.config_permitted` is a
  **per-parameter** grant that lets an owner role edit its own additional parameter from *My
  Parameters* — `config.ts:280` and `:560` read it, and `PUT /api/config/additional-params/:id`
  refuses without it. The Seat-configurability grid does NOT replace it: the grid is per **tier**,
  the pill is per **parameter**, and the two answer different questions.
  Built so the grant survives: the pill still renders for the incubator admin and the VC superuser,
  and the route is untouched. But **an incubator superuser can no longer grant or revoke it** —
  only an admin can. If a superuser must keep that control, the cleanest fix is to move the pill
  into the row's AI-prompt expander rather than restore the column.

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
  from a `toHaveCount`. Zero drops means look at the code.
  **`V3-AW` found a SECOND infrastructure tell that grep misses entirely, and MEASURED its cause** —
  with several worktree servers up the box runs out of EPHEMERAL PORTS, and the Vite plugin can no
  longer reach its own worker. macOS has 16,384 of them (`sysctl net.inet.ip.portrange` → 49152–65535);
  with three or four worktrees running e2e this session watched `TIME_WAIT`
  (`netstat -an | grep -c TIME_WAIT`) climb 4,376 → 11,514 → **15,382, which is 94 % of the whole
  range**, and a single run logged **192** `fetch failed`s before it was killed at 85/224. That is the real ceiling behind "stagger the gates": it is not CPU, and raising
  a timeout cannot help. It surfaces as `[vite] Internal server error:
  fetch failed` from **undici inside `Miniflare.dispatchFetch`**, and a test sees it as a page whose
  title is literally `"Internal Server Error"`, or as `EADDRNOTAVAIL` when the server will not boot
  at all. So grep for **`fetch failed` and `Internal Server Error`** as well. The giveaway that it
  is not your code: **no frame from `src/` anywhere in the trace**, and the set of failing
  roles/screens CHANGES between runs of the same tree. Never conclude from a red run at load 40+
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

One row per session, with the gate it MEASURED (never a gate copied from a prompt).

### `V3-AW` — items 11 and 12

**Shipped.** `src/client/routes/admin/AreaWeights.tsx` · `src/shared/aiPrompts.ts` (new) ·
`src/server/routes/aiPrompts.ts` (new, mounted at `/api/ai-prompts`) ·
`src/client/routes/admin/aiPromptsApi.ts` (new) · `migrations/0071_ai_prompts_seat_capability.sql` ·
the capability argument on `src/shared/plans.ts` and its nine readers in `src/server/routes/config.ts` ·
five probes in `scripts/role-matrix.ts` · `test/worker/aiPrompts.test.ts` (26) ·
`test/client/areaWeights.test.tsx` (24).

**Three things the BUILD block did not say, found by decoding:**

1. **The additional-parameter half is as big as the core half.** §3 item 11 describes the 13 core
   rows. v3 *also* deletes the three hard-coded role cards (`Super User` / `Program Manager` /
   `Jury Member`, each with a `Permit configuration` column) and renders them from a new `ADDL`
   object via `addlRender()` — with `AI prompt` in place of the permit pill, a
   `Restore all additional-parameter prompts` button, real parameter names and five rubric anchors
   each. `ADDL` is shared with section `s-rb`, which nobody owns (§9).
2. **Nothing was missing except a default.** `parameters.prompt` has existed since `0013`, and
   `0027` (W2-B) wrote a real extraction prompt into **all 26 core rows and all 18 additional
   ones** — `evaluate.ts` renders every one into the rubric. The premise "core areas have no
   prompt", which `0013`'s own comment still states, was superseded four migrations later. So item
   11 is the EDITOR plus the thing a `Restore default` needs and the schema never had:
   `prompt_default`. See Q62 for why the prototype's own thirteen were recorded and not applied.
3. **Item 12's stated defaults already ARE the code.** `planAllowsCore` / `planAllowsAdditional`
   have hard-coded "Standard — none · Pro — core only · Premium — core + additional" since
   `plans.ts` was written. Item 12 is making that ladder data, not inventing a rule — which is why
   the migration can seed the grid and assert that nothing changes.

**And one constraint the block did not state:** the console is reachable by **admin as well as
superuser** (`canOpenAdminConsole`), and neither `AISJ_ICAdmin_V6` nor `AISJ_VC_Superuser_V8` was
reshared — both still draw `<th>Type</th>`, no prompt button, no `cfg-table` (checked in the
split). Rendering v3 for everyone would have changed a screen for roles whose design the client did
not revise. The section is forked on `edition === "incubator" && role === "superuser"`
(`usesV3AreaWeights`), and the client test asserts BOTH sides. Q64/Q63 record it; Q66 records the
one thing the fork costs.

**Enforcement.** The grid is a permission, so it is enforced on the server and asserted on the
response, never by not-rendering: `402 plan_required` on the write, in `/api/ai-prompts` *and* in the
`config.ts` gates it now feeds. **Negative control run, twice** — disabling the gate in
`aiPrompts.ts` reddens 4 tests, disabling the `config.ts` wiring reddens 2, and both go green again
when restored.

**Measured gate** (this worktree, `sj-V3-AW`, Node 22.23.1):

| Leg | Result |
|---|---|
| `npm run typecheck` | clean (all three projects) |
| `npm run lint` | clean |
| `npm test` | **2119 passed · 0 failed · 1 skipped** (81.6 s). Exactly baseline 2069 + 26 worker + 24 client. An earlier run of the same tree showed one failure in `test/client/teamRoles.test.tsx` ("Transfer ownership" rendering its loading branch); it passed 21/21 alone, the file is untouched here, and it is green in this run — ambient load, as the `e2e-load-sensitivity` note predicts. |
| `npm run build` | clean |
| `npm run roles` | **1180 / 1180, 0 failed.** Baseline 1115 + the 5 new probes × 13 seed accounts = 1180. Run against a server proved mine by PID and cwd (`lsof -a -p <pid> -d cwd`). |
| `npm run test:e2e` | **One real regression found and fixed; no clean full-suite number obtainable on this box.** See the paragraph below — every failure is accounted for individually, and the blocker is measured, not guessed. |
| Visual | both designs screenshotted at `/app/admin?section=wt` — superuser (AI prompt column, expander, Configurability grid, both Restore buttons) and admin (Type, Core chips, Permit configuration, `Set total: max 30`). |

### The e2e leg, in full — what was measured and what was not

**Run 1** (3 worktrees, load 9–16, 12.2 min): `193 passed · 4 failed · 18 flaky · 9 did not run`.
Every one of the four was chased to a cause rather than re-run until green:

| Failure | Verdict |
|---|---|
| `vc-calls.spec.ts:75` | **REAL, and mine.** Fixed — see below. Now `17/17` with `nav.spec.ts` as control. |
| `agreements.spec.ts:174` | Environmental. Passes alone. |
| `signup-config.spec.ts:72` | Environmental. Passes alone. |
| `parity.spec.ts` *vc/admin* | Environmental. Passes alone in 37.7 s. |

The one real bug is worth the next session's attention because nothing about it looks like a bug:
`e2e/vc-calls.spec.ts:78` records every request whose URL `.includes("/prompts")` and asserts the
list is EMPTY on the VC Partner call screen — it guards `GET /api/calls/:id/prompts`, the AI
questions. **In `vite dev` a source module is fetched over HTTP**, so Playwright counts it, and the
new client file `promptsApi.ts` was served at `/src/client/routes/admin/promptsApi.ts` — which
contains `/prompts`. **A VC spec went red because of a FILENAME**, on a screen that never calls the
route. Fixed by renaming this session's own files (`aiPromptsApi.ts`, `aiPrompts.ts`,
`/api/ai-prompts`), never by touching a VC test, since §7 requires those to pass unchanged. §9
carries the general form and the one-line hardening for that matcher.

**Runs 2–4 could not produce a clean full-suite number, and the reason is measured.** Every
subsequent `parity.spec.ts` role-walk that failed passed when run alone (`vc/admin` 37.7 s,
`incubator/program_associate` 28.7 s, `incubator/program_manager`, `vc/superuser` on retry), and
the SET of failing roles changed on every run of the identical tree — the signature of contention,
not of a defect. The mechanism is ephemeral-port exhaustion (see the TEST + GATE note above): a
fourth attempt never started at all, dying on `EADDRNOTAVAIL` with 14,106 sockets in `TIME_WAIT`.

**So: the full suite has not been observed green on one run of this branch, and this row does not
claim it has.** What IS established is that no failure seen at any point traces to this session's
code except the one that was fixed, and that the specs touching this session's surfaces
(`scoring-framework`, `config`, `parameters`, `vc-calls`, `nav`, `parity`) pass individually. **V3
integration must run the full suite on a quiet box before merging this branch** — that is the one
piece of my own gate I am handing on rather than closing.

`e2e/parity.spec.ts` needed **no re-capture**: it never opens a console section (`section=` appears
nowhere in it), and the four `coreparams` rows belong to `ConfigPage.tsx`, which is untouched (Q61).

**A trap worth the next session's five minutes.** `test/worker/apply-migrations.ts` says "each
test's isolated D1 snapshot" and the pool's `isolatedStorage` defaults to `true`, so it is natural
to assume worker tests start clean. **They do not** — probed with a two-test file: the second sees
the first's `UPDATE`. Four of this session's gate tests failed on inherited state and read exactly
like an authorisation bug. Filed in `docs/plan_parity.md` §9.
