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
| 6 | Assign: only "Evaluated & Complete" | **BLOCKED → Q91** | `V3-FLOW` re-measured independently: `panel-assign` is byte-identical v15↔v3 (md5 `deaa3247289a35ee50ee3cb090f0a20e` both sides, 16,159 B), and the string occurs **0 times** in either .HTM **and 0 times in either decoded admin console**. `renderAsDecks` still draws incomplete rows inline (greyed, untickable) *and* the `asShowIncomplete()` drawer. **Four candidate readings written to §4 Q91; no filter inferred, nothing built.** |
| 7 | Query: only "Evaluated & Incomplete" | **BLOCKED → Q92** | Same class, re-measured: `panel-query` is −78 B and its **entire** diff is the deleted `#q-selall` select-all checkbox (one line, verified by tag-split diff); `qRenderList` renders `qFounders` whole and filters nothing. String occurs 0 times anywhere. **Four candidate readings at §4 Q92; the orphaned `qToggleAll` is §4 Q93.** |
| 8 | Upload → "Upload & Evaluate", redev | **ASK** | The redev is mostly a **deletion**: `#up-results` is gone and the footer collapses to one button — which is literally `showPanel('alldecks')` — while the screen still promises *"You approve → Credits deducted"*. Worse, a richer inline results card has **CSS and ~110 lines of JS but no markup**; `renderUpResults([0,3,5,7])` runs at load into a swallowed `catch`. **Likely a broken export — ask for a corrected file.** |
| 9 | Query after Evaluate in sidebar | **BUILD** | Already satisfied by §2. Zero-cost. |
| 10 | Evaluate page redev | **BUILD + DECIDE entry** | +533 B: new `AI Evaluate` toolbar button, select-all + "N selected" in column 1, sub-line *"evaluated decks move to the Assign screen"*. `evAiEvaluate()` → toast → `showPanel('assign')`. But the screen has no entry point (§2). |
| 11 | Core Parameters: AI prompts per seat | **BUILD** (console) | In the decoded console: Area-weights header `<th>Type</th>` → `<th>AI prompt</th>`, every one of the 13 rows gains an `AI prompt` button, plus `Restore all core AI prompts`. "prompt" occurs **91× in admin-v3 vs 7× in admin-v15**. Note the outer `panel-coreparams` drops `Type` *without* adding the column — the two surfaces disagree. |
| 12 | Configurability toggles under Area Weights | **BUILD** (console) | New: `Seat configurability` card, columns `Parameter set · Standard · Pro · Premium`, rows `Core parameters` / `Addl. parameters`. Defaults stated: *Standard — none · Pro — core only · Premium — core + additional.* It is an **edit permission**, not per-tier prompt content. |
| 13 | Visibility of other's evaluations | **BUILD** (console) — highest risk | New `Visibility for Incubator` (4×4) and `Visibility for VC` (5×5) matrices, *"Viewer (row) → can see scores of (column)"*. Footnote: *"Super User & Program Manager see everyone; Program Associate and Jury Member see no one — jury members cannot see each other (blind evaluation) until turned on here."* **This is the `role-boundary-leaks` class — enforce server-side, negative control mandatory.** |
| 14 | Intro calls scheduling flow | **MEASURED + BUILT** (`V3-FLOW`) | Confirmed, and **tightened**: `panel-introcalls` is byte-identical v15↔v3 (md5 `9de0d3e0…`, 9,430 B both) — so the panel's delta is **zero, CSS included** — and all **16** `nc*` functions are byte-identical (per-function md5, §3.1). The `+410` is trap (b) again: the four new `.jp-flowtag` rules sit at offset **189,876**, past this panel's end (~186,154), among the `.jp-jstat` rules in the **jury-pipeline** style block. They are **`V3-JP`'s** (item 2), not ours. So item 14 has **zero v3 delta**: the whole gap is ours against v15. **Measured: 8 gaps, §3.1.** Built the four that are evidenced; 2 are DECIDE (§4 Q94), 1 is a documented deviation (§8 Q104), 1 is dead state. |
| 15 | Price config control panel | **BUILD** (console) | Rebuilt from an iframe into an inline section: `Paid trial`, `Individual plans — ₹ per period`, `Enterprise plans — ₹ annual`, and `Save & apply to My Account`. |
| 16 | Setup → Team & Roles realigned | **BUILD** | Wizard step 4 becomes *Nominate your super user*; the add-member block is deleted (−45 lines) and replaced by a handoff card to **Team & roles**, which gains an inline add-member form. |
| 17 | My account → Pricing revisited | **MEASURE** | The account overlay grew 56,019 → 71,008 bytes (**517 diff lines, unread**). It is item 15's other end: `prSave()` → `postMessage({type:'aisjPricing'})` → `acRefreshPricing()`. Do not let anyone estimate this without reading it. |
| 18 | All decks → "Dashboard" | **BUILD** | Verbatim. Superuser-only per the client, so use `labelOverrides`, not `label`. |
| 19 | Dashboard stat boxes + screens | **BUILD + DECIDE** | Six boxes, new order/labels/colours: Uploaded · AI Evaluated · Not AI Evaluated · Incomplete · **Archived** · Shortlisted. **`Assigned` is deleted — reversing Aug-2026 issue 4**, which is quoted in `deckStats.ts:166-167`. Tables collapse 4 shapes → 2. Archived is excluded from every other count, so the tile **denominator changes**. |

---

### 3.1 Item 14 measured — the incubator intro-call flow, `CallsPage.tsx` vs `nc*`

The plan called this *"the one item on the list whose cost is entirely unmeasured"*. Measured here
against `AISJ_SuperuserV3` **and** `AISJ_IC_SuserV15` (identical), plus the three other incubator
**scheduler** builds — `AISJ_ICAdmin_V6`, `AISJ_IC_PM_V5`, `AISJ_IC_PA_V3` — which head the table the
same way and carry a byte-identical `ncRoles`. The jury build (`AISJ_IC_Jury_V4`) has its own thirteen
columns and is already served by `participantColumns: "jury"`; it is untouched here.

**Correction to §1's delta table, for whoever reads it next.** `introcalls +410 (CSS only)` is the same
boundary artefact as trap (b). `panel-introcalls.html` is byte-identical between the two versions
(md5 `9de0d3e00a8d446e468de3de7b088f4a`, 9,430 B), so its delta including its inline `<style>` is
**zero**. The four new rules are `.jp-flowtag{…}` / `.intro` / `.reassigned` / `.jp-flowtag .ti`, at
offset **189,876** in the v3 .HTM — past this panel's end at ~186,154, sitting among the `.jp-jstat`
rules of the **jury-pipeline** block. They belong to **item 2 / `V3-JP`**, whose flow tags they style.

**First, the thing that changes the estimate.** The prompt says *"the prototype has NO date input, NO
duration, NO location, NO founder email and NO additional-guests field — several repo fields are
inventions. Say which of ours must go."* **Four of those five are not inventions.** `FINISH-PLAN.md`
records a Jul-24 client decision that post-dates and explicitly replaces the prototype's modal:

> **Scheduling = ICS (final verdict).** App generates a universal **.ics** invite to all participants
> (any email domain — Outlook/Gmail/etc.); organizer adds **team + founder**. Applies to intro,
> partner, and alignment calls.

An RFC 5545 `VEVENT` cannot exist without `DTSTART`, so **date & time is mandated**, and `DTEND`
makes **duration** mandated with it. **Founder email (any domain)** is the decision's own words.
**Location** is `LOCATION`, and the prototype's three providers survive as its presets — the §8 note
at `CallsPage.tsx:11-17` says exactly that. **Only `Additional guests` is unbacked by either the
prototype or the Jul-24 decision**, and even that is the natural reading of "organizer adds team +
founder". Nothing here should be deleted on the prototype's authority alone; the prototype's
deep-link modal is the design the client replaced.

**A. The table (`ncRender`) — prototype 9 columns, ours 10.** Columns 1–8 match exactly.

| # | Prototype | Ours (before) | Verdict |
|---|---|---|---|
| 1–8 | Startup · AI score · Jury score · Avg. score · Addl. Parameter scores · Call scheduled · Call date · Call completed | identical, Schedule inside Call scheduled | **match** |
| 9 | **Assign scheduler** — role → user → Assign, then `<user> · <role>` with Change (`ncAssign`) | **Scheduler** — read-only organiser + participant count | **GAP-1 · BUILT** |
| — | *(the prototype's table ends)* | **Action** | **GAP-2 · §8 Q104**, a documented deviation with a stated drop condition |

**GAP-1 was not a missing feature — it was a stale consumer.** §8 Q102 parked the column as read-only
because the delegation model was unspecified; **Q163 specified it with the user on 2026-09-13 and
`W9-E` built it** (`call_schedulers`, migration 0065, `PUT /api/calls/scheduler`). The route is
edition-agnostic and already role-probed. Only the **VC** config was switched over.

**GAP-3 · BUILT — and it is why GAP-1 could not simply be switched on.** `ncRoles` names three
*different* roles per edition, and `ASSIGN_SCHEDULER_ROLES` hard-coded the **VC** triple:

| | prototype `ncRoles` |
|---|---|
| incubator (superuser V3 **and** V15, admin V6, PM V5, PA V3 — byte-identical in all five) | `Jury member` · `Program associate` · `Program manager` |
| VC (`AISJ_VC_Superuser_V8`) | `IC member` · `Analyst` · `Partner` |

Turning the column on without this would have offered incubator staff three roles the incubator does
not have. The negative control is in `callsPage.test.tsx`.

**B. The modal (`ncCallOpenModal` → `ncCallOpen`).**

| Prototype | Ours | Verdict |
|---|---|---|
| Title `Schedule intro call`; both sub-line variants; Meeting title defaulting `Intro call — <name>` / `— ai.STARTUPJURY` | same, verbatim | **match** |
| Participants across roles — group per role, row = avatar · name · `· meta` | row was `· <role> · <email>`, repeating the group heading | **GAP-4 · BUILT** — dropped the duplicated role, kept the email |
| Selected chips; empty `No participants selected yet.` | `Nobody from the team yet.` | **GAP-5 · BUILT** — the prototype's own sentence |
| `N participants selected`; `Schedule call` disabled at 0 | same, but the count includes founder + guests | **GAP-6 · kept deliberately** — the .ics goes to all of them, so counting only the team would make the footer lie |
| Provider strip → Meet · Zoom · Teams **deep links** | 2 composer links + 3 location presets, **alongside** a real .ics | superseded by the Jul-24 ICS verdict (F0617) |
| — | Startup select · Date & time · Duration · Where · Founder email · "Email the .ics now" · Cancel | additions; all but one required by the ICS verdict (above) |
| — | **`Additional guests`** | **GAP-7 · DECIDE, §4 Q94** — the one field neither source backs |
| — | `notes` state round-trips an existing call but has **no input anywhere** | **GAP-8 · DECIDE, §4 Q94** — dead, but deleting it would drop server-side notes on every reschedule |

**C. Effort.** GAP-1+3 together: one config key, one edition-keyed map, ~25 lines of test — **S, ~1–2 h,
no migration and no server change**. GAP-4/5: **XS**. GAP-2/6/7/8: **decisions, not work.**
**Migration 0074 was allotted to this session and is NOT used** — `ALLOTMENT_CEILING` untouched at 65.

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
  **→ `V3-FLOW` split this into Q91 (Assign) and Q92 (Query) below, four candidate readings each, written
  in the repo's own stage vocabulary. Answer those rather than this.**
- **Q5 — Upload results screen (item 8).** Is the inline results card real markup we did not receive, or
  is the single `Evaluate & Go to Dashboard →` button the whole design? Credits are deducted here.
- **Q6 — Evaluate entry point (item 10).** The screen is orphaned in v3. Where is it reached from?
- **Q7 — Assigned stat box (item 19).** Deleting it reverses Aug-2026 issue 4. Confirm.
- **Q8 — Upload size (item 5).** Target ceiling, and acceptance that >24 MB decks cannot be AI-evaluated
  without a streaming/Files-API change.

### `V3-FLOW` — Q91–Q94

**Items 6 and 7 are blocked and nothing was built for them.** Both strings occur **0 times** in
`AISJ_SuperuserV3.HTM`, in `AISJ_IC_SuserV15.HTM`, and in both **decoded** admin consoles (checked with
and without `&amp;`). `panel-assign` is byte-identical between the two versions; `panel-query`'s entire
diff is one deleted checkbox. The candidate readings below are written in the repo's own stage
vocabulary (`src/pipeline/incubator.ts`, `src/shared/queries.ts`). **We did not pick one.**

Today, for reference: Assign's column 1 is `statusId ∈ {ai_evaluated, assigned}` with a separate
`incomplete` drawer (`AssignPage.tsx:219-223`); Query's list is `isQueryListed`, i.e.
`QUERYABLE_STAGES.incubator = ["incomplete", "manual_review"]`, widened to
`AWAITING_REVIEW_STAGES = ["uploaded", "pending_ai"]` for a deck that already has query history so an
answered query stays listed as **Responded** (F0214).

- **Q91 — Assign, "only Evaluated & Complete". Which of these four?**
  - **(a) Strict stage filter.** Column 1 becomes `statusId === "ai_evaluated"` alone; `assigned` drops
    out and the Incomplete drawer goes. **Cost:** you can no longer add a second juror to a deck from
    this screen — the prototype keeps assigned rows, badged `Assigned`, precisely so you can. Contradicts
    the prototype twice.
  - **(b) Drawer removal only.** Roster unchanged (`ai_evaluated` + `assigned`); just the `Incomplete N`
    toolbar button and its drawer go. **Cost:** `asSendToQuery` loses its only surface — incomplete decks
    then reach Query by some other route, or not at all. Needs that route named.
  - **(c) A label, not a filter.** "Evaluated & Complete" is column 1's heading (the prototype's
    `.as-col-lbl`, today "Evaluated decks"). Filter nothing, relabel. **Cost: one string.** This is the
    only reading consistent with the prototype being byte-identical and the string appearing nowhere.
  - **(d) Intake completeness, which we do not filter on today.** `statusId === "ai_evaluated" &&
    areasNeedingResponse(deck).length === 0`. A deck can be AI-evaluated *and* still be missing required
    intake fields; this is the one reading that changes what a user sees for a reason the current model
    does not already cover. **Cost: S**, and it needs the "complete" definition confirmed.

- **Q92 — Query, "only Evaluated & Incomplete". Which of these four?**
  - **(a) Strict.** `QUERYABLE_STAGES.incubator = ["incomplete"]` **and** drop the
    `AWAITING_REVIEW_STAGES` tail. **Cost: this reverses F0214** — a founder's answer makes the row
    vanish instead of showing as Responded with the answer one click away. That is a tested behaviour
    with a finding number; do not do it on an inference.
  - **(b) Strict, tail kept.** `QUERYABLE_STAGES.incubator = ["incomplete"]`, `AWAITING_REVIEW_STAGES`
    untouched. `manual_review` decks drop off, Responded rows stay. **Smallest change that honours the
    words. Cost: XS.**
  - **(c) A label, not a filter.** The status chips / sub-title say "Evaluated & Incomplete"; the row set
    is unchanged. Consistent with `qRenderList` filtering nothing in **both** prototypes.
  - **(d) "Evaluated" is load-bearing.** `statusId === "incomplete" && aiScore != null` — only decks the
    AI actually scored before flagging them. **This would empty the screen:** the prototype's own
    incomplete rows render `No AI score`, and `ai` is `''` for both of them in `asDecks`. That is strong
    evidence "Evaluated" is loose language here, not a filter term — but it is the client's word, so it
    is listed.

  **Cross-cutting, and worth putting to the client as one question:** items 6 and 7 are a matched pair —
  Assign takes *Complete*, Query takes *Incomplete*. Read as one sentence ("split the evaluated decks
  across two screens by completeness") **the build already does this**: Assign is `ai_evaluated`/`assigned`,
  Query is `incomplete`/`manual_review`. Under that reading both items are **(c)** — naming, not filtering
  — which is also the only reading that leaves the byte-identical prototype telling the truth.

- **Q93 — the one real v3 change on my two panels, and it is a deletion.** `panel-query` v3 deletes
  `<input id="q-selall" onclick="qToggleAll(this)">`, leaving `qToggleAll` with no caller. Applying it
  removes bulk select from Query — which is what **F0215's one-letter-per-founder multi-send** is driven
  from. **Not applied.** Confirm: is the select-all deliberately gone (and the multi-founder send with
  it), or is this export noise like item 8's missing `#up-results` markup?

- **Q94 — two intro-call modal fields with no backing either way (§3.1 GAP-7/8).** (i) `Additional
  guests` is in neither the prototype nor the Jul-24 ICS decision, though "organizer adds team + founder"
  reads as permitting it — keep or drop? (ii) `notes` round-trips an existing call's notes but has no
  input on any screen; deleting the state would silently drop server-side notes on every reschedule.
  Give it an input, or leave it as pass-through?

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

| Session | Items | State | Measured gate | Notes |
|---|---|---|---|---|
| `V3-FLOW` | 6, 7, 14 | **14 done · 6 and 7 blocked, by design** | typecheck ✓ · lint ✓ · **unit 2074 passed / 1 skipped** ✓ (baseline 2069/1 — exactly the +5 written here) · build ✓ · **e2e 196 passed / 8 failed / 16 flaky** — every failure is a pre-existing dev-server crash, **proved by a base-commit control** (§8.1) · `roles` **not run, and not required**: no route, no permission and no probe changed — `calls.scheduler` already allows `admin`/`program_manager`/`program_associate` with no edition restriction (`scripts/role-matrix.ts:571`) | Migration **0074 allotted and NOT used**; `ALLOTMENT_CEILING` untouched at 65. |

**Items 6 and 7 — stopped at the measurement, deliberately.** Re-verified independently rather than
taken from §3: `panel-assign` md5 `deaa3247289a35ee50ee3cb090f0a20e` on both sides (16,159 B);
`panel-query` −78 B whose whole diff is the deleted `#q-selall` checkbox; both strings 0 occurrences in
both .HTMs **and** both decoded consoles. Four candidate readings each in §4 Q91/Q92, in the repo's own
stage vocabulary, plus Q93 for the deleted checkbox. **No filter was inferred and no filter code was
written** — the prompt's instruction, and the right call: reading (a) of Q92 alone would reverse F0214.

**Item 14 — measured (§3.1), then built smallest-first.** The headline is that **the client is right
that our flow diverges, and the divergence was a stale consumer, not a missing feature**: §8 Q102 parked
Assign scheduler as a read-only column pending a delegation model, Q163 settled that model with the user
on 2026-09-13, `W9-E` built it (`call_schedulers`, 0065, `PUT /api/calls/scheduler`) — and wired only the
**VC** config. The incubator screen, which four prototypes head `Assign scheduler`, was left on W7-F's
read-only `Scheduler`. Built in this order:

1. `No participants selected yet.` — `ncCallRenderSelected`'s own sentence (was "Nobody from the team yet.").
2. Participant rows drop the role that the group heading above them already states; the email stays.
3. `ASSIGN_SCHEDULER_ROLES` becomes **edition-keyed**. `ncRoles` names three *different* roles per
   edition and the constant held the **VC** triple, so switching the column on without this would have
   offered incubator staff IC member · Analyst · Partner.
4. `INCUBATOR_CALLS_CONFIG.introcalls.trailing = ["assignScheduler", "action"]`.

**The negative control was run.** All four fixes were reverted in one pass and the suite went
**7 failed / 24 passed**, each failure naming its fix; the VC guard correctly stayed green, since it is a
regression guard and not a fix-detector. Restored, 31/31.

**Correction to the prompt's premise, with the evidence.** The prompt says the repo's date, duration,
location, founder-email and additional-guest fields are "inventions … say which of ours must go". Four of
the five are mandated by a client decision that post-dates the prototype: `FINISH-PLAN.md` line 1045,
*"Scheduling = ICS (final verdict) … organizer adds **team + founder** (any email domain)"*, which
explicitly replaced the prototype's Meet/Zoom/Teams deep link. A `VEVENT` needs `DTSTART`/`DTEND`, so
date and duration are not optional; founder email is the decision's own words; `LOCATION` is where the
three providers went, as `CallsPage.tsx:11-17` records. **Only `Additional guests` is unbacked**, and it
is left in place pending §4 Q94 rather than deleted on the prototype's authority.

**Shared files touched, so siblings know.** `e2e/parity.spec.ts` — the FOUR incubator `introcalls` rows
(`superuser`, `admin`, `program_manager`, `program_associate`), `"SCHEDULER"` → `"ASSIGN SCHEDULER"`,
which are exactly the rows this change moves and the only four occurrences of that pair in the file; no
row anyone else owns was touched, added or deleted. `e2e/pipeline-stages.spec.ts` (the *"PM — Intro
calls"* test's header list, one word) and `e2e/calls.spec.ts` (the incubator intro-call test's Scheduler
assertion, replaced by the Assign scheduler roster) — both assert **this session's screen** and both fail
without the change. Flagged in `docs/plan_parity.md` §9 for `V3-JP`/`V3-UP`, who also run in these files.


### 8.1 The e2e picture, and a dev-server crash the runbook's check does not catch

**Do not read the red as this session's.** Four runs, and a control:

| Run | Scope | Result |
|---|---|---|
| 1 | full suite, load 8.6 at start, siblings arrived during it | 196 passed · **8 failed** · 16 flaky · 4 did not run (14.5 m) |
| 2 | the 3 specs this change touches + `branding.spec.ts` as an untouched control, load 4.9, `--workers=1` | **28 passed · 1 failed** (6.5 m) |
| 3 | `parity.spec.ts` alone, load 5.5, `--workers=1` | 9 passed · 2 flaky · **1 failed** (7.8 m) |
| **control** | **`parity.spec.ts` alone at `HEAD~1`** — `git checkout HEAD~1 -- src e2e test`, so this session's change is **absent from the tree** | **11 passed · 1 failed** (6.3 m) |

**The control is the point: the base commit fails the same way.** The crash is pre-existing on `main`
and nothing to do with item 14.

**The failing role rotates every run** — superuser + admin → program_manager → jury → admin — which is
the shape of an environmental fault, not a deterministic assertion. **All six failure contexts across
the runs carry one signature** and not one is a title or column mismatch:

    fetch failed … at async _Miniflare.dispatchFetch (node_modules/miniflare/dist/src/index.js:91788)

The worker runtime dies, Vite raises its HMR overlay, and the walk either reads the page title as the
literal **`Internal Server Error`** or — when the overlay wins the race — cannot click at all
(`<vite-error-overlay> intercepts pointer events`, 349 retries before the 180 s timeout).

**⚠ The runbook's drop check does not catch this.** `grep -c "Network connection lost"` returns **0** on
a run with eight server-caused failures, and so does `Received: undefined`. Following §7's instruction
literally — *"Zero drops means look at the code"* — sends you hunting a code fault that is not there.
**Add these three tells:** `Internal server error: fetch failed` in the server log, `Internal Server
Error` as a page **title**, and `vite-error-overlay` in a Playwright call log. And note run 2 and the
control both lost a worker at **load ~5** — so this is genuine miniflare instability, not only contention.

**All four parity rows this session edited have passed, repeatedly, with the change applied:**

| row | run 1 | run 2 | run 3 |
|---|---|---|---|
| `incubator/superuser` | cleared `introcalls` (nav idx 7) before dying at `billing` (idx 20) — the walk is fail-fast | **pass** | **pass** |
| `incubator/admin` | server crash | **pass** | **pass** (on retry) |
| `incubator/program_manager` | **pass** | server crash | **pass** (on retry) |
| `incubator/program_associate` | **pass** | **pass** | **pass** |

`incubator/jury` failed once and is **not** this session's: the jury screen renders
`participantColumns: "jury"`, a column set item 14 does not touch, and its parity row was not edited.
