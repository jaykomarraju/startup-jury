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
| 15 | Price config control panel | **DONE** (`V3-PT`) | Rebuilt from an iframe into an inline section: `Paid trial`, `Individual plans — ₹ per period`, `Enterprise plans — ₹ annual`, and `Save & apply to My Account`. **Measured:** v15's `s-pc` is a 235-byte iframe around `PC_B64` — 49,952 base64 chars → **37,464 bytes**, md5 `aeb76663…`; v3's is **2,134 bytes** inline and `PC_B64` is *still defined and never loaded* (2 references in v15's admin script, 1 in v3's). A 37 KB orphan, byte-identical to v15's. The repo's `PriceConfiguration.tsx` implements that orphan. Built: the three cards, `Save & apply` = save-then-publish (the account screens read the PUBLISHED catalogue, so a draft is applied to nothing), migration `0073`. Everything the v3 section drops but the product still reads — currencies, FX, the four catalogues, tax — is kept below a divider: §4 Q82. |
| 16 | Setup → Team & Roles realigned | **DONE** (`V3-PT`) | Wizard step 4 becomes *Nominate your super user*; the add-member block is deleted (−45 lines) and replaced by a handoff card to **Team & roles**, which gains an inline add-member form. **Measured:** `#setup-overlay` 16,168 → 13,679 bytes, 232 → 187 lines — **−45 lines exactly**, as stated. The wizard IIFE is +182 bytes over 13 diff lines: every function is KEPT and only `renderTeam()` narrows to `renderSuper()`. `s-tm` +1,082 bytes is one `onclick="tmAddToggle(true)"` plus a 33-line `#tm-addform`. Team & roles already had the inline invite form, the plan pill and the Active/Invite-pending pill; what it lacked was the **Seat** select, which is built here and now posts to `POST /api/seats/members` (capacity-checked, seat-recording) instead of `POST /api/users`. |
| 17 | My account → Pricing revisited | **MEASURED + DONE** (`V3-PT`) | **The diff is read.** Measured with explicit boundaries: the `<style id="ac-style">` + `#acct-overlay` markup is 39,338 → 39,315 bytes (560 → 552 lines, **−23 bytes**, 154 diff lines: +62 / −70), and the `/* My Account / Onboarding flow */` IIFE in `_scripts.js` is 17,668 → 32,482 bytes (294 → 477 lines, **+14,814**, 276 diff lines: +215 / −32), plus an 8-rule `.ipt-pack*` CSS block v15 has none of. **57,006 → 71,797, +14,791 over 430 diff lines** — the plan's 56,019 → 71,008 / 517 lines is the same delta cut slightly differently, and is confirmed rather than corrected. **What is in it:** two new screens (`#acs-trial`, `#acs-paidtrial`); `STEPS_IND[1]` "Plan" → "Seat & pricing"; the plan screen becomes tier-then-period with both footer buttons disabled until a period is picked; extra-credit packs 125/250/375/500 priced at annual ÷ 500 decks; the org screen becomes three seat-count cards; the fixed-pack / pay-as-you-go segmented control, the `ac-trialstrip` and the account screen's "Evaluate 3 pitchdecks free" strip are DELETED; the order summary and receipt each gain three branches. **All of it built, gated to the incubator superuser** (§4 Q85). |
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

### `V3-PT` — Q81 … Q86 (items 15, 16, 17)

- **Q81 — wizard invites: migrated or stranded? ANSWERED BY MEASUREMENT, no client input needed.**
  Nothing is stranded. Every member the wizard's add-member row created went through
  `POST /api/seats/members`, which forwards to `POST /api/users` and then sets `plan_tier` —
  ordinary `users` rows that Team & roles has always listed, with the same invite lifecycle
  (pending · resend · cancel) and the same plan pill. Deleting the wizard block removes a second
  door onto one table, not a table. The ONE capability that lived only behind that door was
  choosing a **seat tier at invite time**, with the tier's capacity checked; that is why the Seat
  select was added to Team & roles' form in the same commit rather than left for later.

- **Q82 — does v3's `s-pc` REPLACE the rest of Price configuration, or sit above it?**
  The reshared section is three cards and one button — no currency bar, no FX panel, no plan/pack
  catalogues, no tax card. The rest of the product still reads all four: the account wizard's
  currency picker, `priceBreakdown`'s GST rate, and the `subscription` rows coded `standard` /
  `pro` that `src/shared/seats.ts` prices a purchased seat from. Built as: three cards first, in
  the prototype's order, then a labelled divider and everything else. Deleting the remainder is a
  data-reachability decision, not a layout one.

- **Q83 — retire the superseded SKUs?** `0073` is purely additive: the legacy `standard` / `pro`
  monthly subscriptions, the `base_rate` / `pack_*` ladder and the `ent_100…ent_500` unit tiers are
  all still active and priced. The new screens select on the `tier` and `seats` COLUMNS, so the old
  rows are filtered out rather than deleted, and re-including them is one ruling. Deleting them
  needs an answer here **and** a replacement for `seats.ts`'s per-tier seat price.

- **Q84 — the seat bar, and the "Programs accessible" column.** v3's step-4 markup deletes
  `su-seatbar` along with the roster. The seat bar is the ONLY entry point to the
  Buy-additional-seats sub-flow, and v3 offers no replacement — the same orphaning shape as the
  Evaluate screen elsewhere in this wave. It is therefore KEPT on the narrowed step. Moving
  "Buy seats" into Team & roles would satisfy the prototype exactly; say so and it is a small move.
  The deleted "View all members" table also carried a read-only **Programs accessible** column that
  Team & roles has no equivalent for; that is the only information the deletion actually loses.

- **Q85 — when the other five prototypes are reshared, does the seat flow widen to them?**
  Only `AISJ_SuperuserV3.HTM` was reshared. Checked, not assumed: `AISJ_ICAdmin_V6` and
  `AISJ_VC_Superuser_V8` both still contain "Choose your plan", zero occurrences of `acs-trial` or
  `itiers`, a 235-byte `s-pc` and a 5,583-byte `s-tm` — byte-identical to v15's. So the whole of
  item 17, and step 4's narrowing in item 16, are gated to `edition === "incubator" && role ===
  "superuser"`, and BOTH layouts live in the code. Four negative controls in
  `accountOverlay.test.tsx` and two in `setupTeam.test.tsx` fail the moment that gate is widened.
  Deleting the pre-V3 screens is this question.

- **Q86 — should the console's two additions be superuser-only too?** They are NOT gated, and
  deliberately: a price book is global (one `pricing_versions` row is live for everybody), so
  hiding the seat-price cards from an admin would leave a second editor of the same numbers with a
  partial view; and hiding the Seat select would make every member an admin invites seatless now
  that the wizard no longer assigns one. Both are additive — nothing an admin could do yesterday
  has moved or gone. Say the word and both become superuser-only.

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

| Session | Items | State | Measured gate |
|---|---|---|---|
| `V3-PT` | 15 · 16 · 17 | **All three built.** Migration `0073`. Gated to the incubator superuser where the prototype gates it (§4 Q85). | *(this row's own measurements are below)* |

### `V3-PT` — what landed

**Migration `0073_seat_pricing_v3.sql`, and why it is additive.** v3 bills a seat per QUARTER and per
HALF-YEAR. `price_plans.period` and `account_orders.period` both CHECK a three-value enum, and SQLite
cannot widen a CHECK without rebuilding the table — which for `price_plans` means dropping the parent
of `price_amounts.plan_id … ON DELETE CASCADE`, a data-loss shape on a deployment whose D1 is already
known to drift behind the repo. So the enum is untouched and three nullable columns carry what it
cannot: `period_months` (3 · 6 · 12, and it WINS over `period` wherever both exist — `periodOf()` is
what every reader goes through), `tier` and `seats`. A quarterly seat stores `period = NULL,
period_months = 3`, which the old CHECK already accepts. Four `ALTER TABLE … ADD COLUMN`, thirteen
plans, fifty-two amounts, all `ON CONFLICT DO NOTHING`. Nothing is deleted or deactivated.

It also **publishes version 2**. The account overlay reads `GET /api/pricing/published`, so seat SKUs
that existed only in the draft would leave a fresh deployment with nothing to sell; version 1 stays in
the table, superseded, which is what keeps it reversible. `test/worker/pricing.test.ts` pins the
serialised draft against that literal, so editing a seed row and forgetting the document fails there —
and every version assertion in that file now reads `SEEDED_VERSION` rather than a number.

**The thirteen prices, from the prototype's own `PRICING_ADMIN`:** paid trial ₹100/deck; Standard
4 500 / 7 200 / 11 520, Pro 6 000 / 9 600 / 15 360, Premium 8 000 / 12 800 / 20 480 per quarter /
half-year / year; Family Office (5 seats) ₹80 000, Enterprise (10) ₹1 60 000, Large Organisation (15)
₹2 40 000 annual. Decks included 125 / 250 / 500 per period and 500 per enterprise seat. The
extra-credit rate is **derived** — annual price ÷ included decks — which reproduces the prototype's
hard-coded 23.04 / 30.72 / 40.96 exactly and keeps moving when an administrator edits the annual price.

**§8 Q1 is intact and was not narrowed.** `perDeckArtefacts()` scans catalogue COPY, and no copy this
session wrote contains a per-deck figure: the paid trial's card renders `formatMinor(rate) + " / deck"`
in the component, exactly as `PERIOD_SUFFIX` renders "/mo". The guard needed no exemption, so there is
nothing left to check is still inside it.

**What is gated, and what is not.** Only `AISJ_SuperuserV3.HTM` was reshared — verified, not assumed:
`AISJ_ICAdmin_V6` and `AISJ_VC_Superuser_V8` both still contain "Choose your plan", zero occurrences of
`acs-trial` or `itiers`, a 235-byte `s-pc` and a 5 583-byte `s-tm`. So **item 17 in full and step 4's
narrowing in item 16 are gated** to `edition === "incubator" && role === "superuser"`, both layouts
live in the code, and six negative controls fail the moment the gate widens. The console's two
additions — the three price cards and the Seat select — are **not** gated, deliberately: §4 Q86.

**One regression, found by e2e and fixed properly.** Routing Team & roles' invite through
`POST /api/seats/members` added a per-tier capacity refusal this screen has never had and has no
Buy-seats control to answer with; `e2e/roles.spec.ts:20` went red at once because every tier in the
seed is full. Creation is back on `POST /api/users`, unchanged, and the seat is a second, non-fatal
step — a refused seat leaves the member created on the default tier and the callout says so rather
than losing the invite. §9 of `docs/plan_parity.md` asks `users.ts`'s owner for a `planTier` parameter
that would collapse the two calls into one.

**Gate, measured on this branch** (load 8–15 throughout; five siblings were running their own suites):

| Leg | Result | Baseline |
|---|---|---|
| `npm run typecheck` | clean | clean |
| `npm run lint` | clean | clean |
| `npm test` | **2108 passed · 1 skipped**, 119 files | 2069 · 1 skipped |
| `npm run build` | clean | clean |
| `npm run roles` | **1115 / 1115**, 0 failed | 1115 / 1115 |
| `npm run test:e2e` | **217 passed · 6 flaky · 1 failed**, 224 tests, 8.9 min, **0 connection drops** | ~224 |

No gate changed, which is why `roles` did not move; no probe was added to `scripts/role-matrix.ts`
because no `requireTask` or `requireRole` in this change set is new or different.

**The one e2e failure is `e2e/evaluate-stage-report.spec.ts:36`** — the test `docs/plan_parity.md` §9
already describes as "an unstable test nobody has explained", which failed three of five full runs at
Wave 9 integration. It touches nothing this session changed. That row asked the next owner to capture
`error-context.md` before the next run clears it; **this session did**, and the snapshot answers it:
the GreenRoute row is present and simply has no `View scores` button, because the call is still
`Not yet` / `Mark completed`. The details, and the fix that follows from them, are in that §9 row; the
snapshot is preserved outside `test-results/`.

**The six flaky all passed on retry** and none is in this session's files except by coincidence of
scheduling: `branding`, `calls`, `parity vc/superuser`, `query`, `rubric-anchors`, `scoring-framework`.
`parity vc/superuser` is worth naming because it *could* have been mine — it is the row that must still
read "Choose your plan". It was not: the failure was `locator('h1').first()` not found after 30 s, which
is a dead page, never a title mismatch (a mismatch reports both strings), and it passed on retry.

**Two earlier red runs were diagnosed, not waved past.** (1) `e2e/roles.spec.ts:20` went red because
Team & roles' invite had been routed through `POST /api/seats/members` — a real regression, fixed by
putting creation back on `POST /api/users` (above). (2) Both `coverage.spec.ts` nav sweeps failed in a
run at load 15; re-run alone they **passed**, and the run that replaced them failed two entirely
different untouched tests — the ambient-load signature, with the vite HMR overlay's `fetch failed`
standing in for the `Network connection lost` tell §9 documents.
