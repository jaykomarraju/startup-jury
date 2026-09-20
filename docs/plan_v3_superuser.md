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
  *(Measured by `V3-NAV`: `upSendToEvaluate` is NEW in v3 — it does not exist in v15, where the sidebar
  item was the only entry point. Its body drives `#up-rt-selinfo`, an id with 4 JS references and no
  markup, so the caller is in the export that went missing. See §4 F-NAV-2.)*

---

## 3. Coverage of the client's 19 items

Legend — **BUILD**: evidenced, buildable. **DECIDE**: prototype and instruction disagree. **ASK**: needs
a corrected file or a number. **MEASURE**: prototype unchanged, so the gap is in our build and unmeasured.

| # | Item | State | Evidence / why |
|---|---|---|---|
| 1 | Eval report consistent at each stage | **DONE** (visual, `V3-REP`) · modes **OPEN → Q23** | **Corrected by reading the decoded renderer** — v3 does not delete stage-awareness, it narrows it. `__introCols`/`__jTot` go, so **Jury Avg.** and **Avg.** vanish and the core table is five columns at EVERY stage (colspan 5) — that is item 1 itself. But `suevSections(stage)` SURVIVES and v3 *edits* it (§8, Q21). W7-D and Issue 24 are intact. Visual parity + v3's new `hideAi` report built; the editable/read-only mode shifts are Q23. |
| 2 | Jury pipeline status repeating | **DONE** — `V3-JP` | Cleanest item. Markup diff is one line: `-<th>Status</th>`. The repeat was the row pill *plus* the per-juror `jp-jstat` pills. Action options drop 5→2 (Send to intro calls · Reassign/add jury), then the cell becomes a flow tag. |
| 3 | Composite formula: hide all but weighted average | **OPEN → Q3** (not built) | `V3-SF`: confirmed byte-identical to v15; all three formulas still offered. NOT shipped — hiding it overrides "match the prototype exactly" and the client marked it *Workaround*. A client test now PINS the three options, so narrowing them is a deliberate edit and never a quiet one. |
| 4 | AI weight: hide all but 50/50 | **OPEN → Q2** (not built) | `V3-SF`: re-measured and confirmed. Four splits, no `selected` attribute, so **40% AI · 60% Jury is the effective default**, and `migrations/0026` agrees (`ai_weight_pct DEFAULT 40`). NOT shipped: keeping only 50/50 silently re-weights every existing org's composite. Pinned by the same client test as item 3. |
| 5 | Decks >24 MB not opening | **NOT STARTED → Q8** | Both prototypes say `Max 50 MB`, byte-identical — a **pre-existing** gap, not a v3 change. `MAX_PDF_BYTES = 24 MB` is arithmetic, not arbitrary: ×1.333 base64 ≈ the 32 MB model-input cap. Raising the constant alone makes uploads succeed and **evaluations fail** — strictly worse. Needs the target number and a streaming/Files-API plan. |
| 6 | Assign: only "Evaluated & Complete" | **BLOCKED → Q91** — readings recorded, nothing built | `panel-assign` is **byte-identical** (md5 `b555211d…`), the assign renderers diff to zero lines, and the string occurs **0 times in either file**. v3 still draws the Incomplete drawer. We are asked to delete UI the reshared prototype still ships. |
| 7 | Query: only "Evaluated & Incomplete" | **BLOCKED → Q92** — readings recorded, nothing built | Same class. `panel-query`'s entire diff is one deleted select-all checkbox; the renderer is byte-identical and `qRenderList` filters nothing. The string occurs 0 times. |
| 8 | Upload → "Upload & Evaluate", redev | **PARTIAL** — label shipped (`V3-NAV`); the flow is **Q51** | The redev is mostly a **deletion**: `#up-results` is gone and the footer collapses to one button — which is literally `showPanel('alldecks')` — while the screen still promises *"You approve → Credits deducted"*. Worse, a richer inline results card has **CSS and ~110 lines of JS but no markup**; `renderUpResults([0,3,5,7])` runs at load into a swallowed `catch`. **Likely a broken export — ask for a corrected file.** |
| 9 | Query after Evaluate in sidebar | **DONE** — `V3-NAV` | Already satisfied by §2. Zero-cost. |
| 10 | Evaluate page redev | **DONE** — `V3-UP` (sidebar `V3-NAV`); entry point **Q6/Q54** | +533 B: new `AI Evaluate` toolbar button, select-all + "N selected" in column 1, sub-line *"evaluated decks move to the Assign screen"*. `evAiEvaluate()` → toast → `showPanel('assign')`. But the screen has no entry point (§2). |
| 11 | Core Parameters: AI prompts per seat | **DONE** — `V3-AW` | In the decoded console: Area-weights header `<th>Type</th>` → `<th>AI prompt</th>`, every one of the 13 rows gains an `AI prompt` button, plus `Restore all core AI prompts`. "prompt" occurs **91× in admin-v3 vs 7× in admin-v15**. Note the outer `panel-coreparams` drops `Type` *without* adding the column — the two surfaces disagree. |
| 12 | Configurability toggles under Area Weights | **DONE** — `V3-AW` | New: `Seat configurability` card, columns `Parameter set · Standard · Pro · Premium`, rows `Core parameters` / `Addl. parameters`. Defaults stated: *Standard — none · Pro — core only · Premium — core + additional.* It is an **edit permission**, not per-tier prompt content. |
| 13 | Visibility of other's evaluations | **DONE** — `V3-SF` | Both matrices built, persisted (`score_visibility`, migration 0072) and **enforced on the server** — `GET /decks/:id/report` and all three analytics reports filter the response payload. Defaults are the prototype's own printed toggle state; four incubator cells therefore move against the old rank ladder (**Q71**). Cards are incubator-superuser only: `admin/s-fw.html` is byte-identical (md5 `c3b534ba…`) in **every** prototype that was not reshared. Negative control run and recorded in §8. |
| 14 | Intro calls scheduling flow | **MEASURED + BUILT** — `V3-FLOW` (see §3.1) | Confirmed, and **tightened**: `panel-introcalls` is byte-identical v15↔v3 (md5 `9de0d3e0…`, 9,430 B both) — so the panel's delta is **zero, CSS included** — and all **16** `nc*` functions are byte-identical (per-function md5, §3.1). The `+410` is trap (b) again: the four new `.jp-flowtag` rules sit at offset **189,876**, past this panel's end (~186,154), among the `.jp-jstat` rules in the **jury-pipeline** style block. They are **`V3-JP`'s** (item 2), not ours. So item 14 has **zero v3 delta**: the whole gap is ours against v15. **Measured: 8 gaps, §3.1.** Built the four that are evidenced; 2 are DECIDE (§4 Q94), 1 is a documented deviation (§8 Q104), 1 is dead state. |
| 15 | Price config control panel | **DONE** — `V3-PT` | Rebuilt from an iframe into an inline section: `Paid trial`, `Individual plans — ₹ per period`, `Enterprise plans — ₹ annual`, and `Save & apply to My Account`. |
| 16 | Setup → Team & Roles realigned | **DONE** — `V3-PT` | Wizard step 4 becomes *Nominate your super user*; the add-member block is deleted (−45 lines) and replaced by a handoff card to **Team & roles**, which gains an inline add-member form. |
| 17 | My account → Pricing revisited | **MEASURED + DONE** — `V3-PT` | The account overlay grew 56,019 → 71,008 bytes (**517 diff lines, unread**). It is item 15's other end: `prSave()` → `postMessage({type:'aisjPricing'})` → `acRefreshPricing()`. Do not let anyone estimate this without reading it. |
| 18 | All decks → "Dashboard" | **DONE** — screen `V3-DASH`, sidebar `V3-NAV` | Verbatim. Superuser-only per the client, so use `labelOverrides`, not `label`. |
| 19 | Dashboard stat boxes + screens | **DONE** — `V3-DASH`, except the Assigned deletion (**Q7**) | Six boxes, new order/labels/colours: Uploaded · AI Evaluated · Not AI Evaluated · Incomplete · **Archived** · Shortlisted. **`Assigned` is deleted — reversing Aug-2026 issue 4**, which is quoted in `deckStats.ts:166-167`. Tables collapse 4 shapes → 2. Archived is excluded from every other count, so the tile **denominator changes**. |
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

### Raised by `V3-NAV`

- **Q11 — Is the Intro calls / Prog manager pipeline swap superuser-only or global?**
  Built **superuser-only**, because the CONSTRAINTS block requires the four non-reshared incubator roles
  to render exactly as they do today, and all four prototypes (`ICAdmin_V6`, `IC_PM_V5`, `IC_PA_V3`,
  `IC_Jury_V4`) still order it `jurypipeline · forsignup · introcalls`. Only `AISJ_SuperuserV3` swaps
  them. `parity-nav` does not assert order, so **neither answer moves the gate** — this is a product
  call, and if the client wants it everywhere it is a one-line change (delete the
  `NAV_ORDER_OVERRIDES` entry and reorder `INCUBATOR_NAV` itself).

**Three findings from the v3 sidebar that are NOT on the client's 19-item list.** All three were found
by diffing `_sidebar.html`, which is 2 changed lines; none of them is nav work, so none is built here.

- **F-NAV-1 — `Core Parameters` and `My Parameters` are no longer panels.** v3 rewires both from
  `showPanel('coreparams')` / `showPanel('myparams')` to `openParamAdmin('core')` / `openParamAdmin('addl')`,
  which opens the admin console deep-linked to section `wt` with `readOnly:!CURRENT_USER_IS_ADMIN`.
  Measured the §1(b) way: `showPanel('coreparams')` occurs **1× in v15 and 0× in v3**, same for
  `myparams`. So both outer panels are unreachable in v3, exactly like `panel-evaluate`.
  **This answers `V3-AW`'s Q61**: the two surfaces disagree because the outer `panel-coreparams` is dead
  — the decoded console's Area-weights section is the only reachable one, so the console wins. `V3-AW`
  owns the call; flagging it here so it is not re-derived.
- **F-NAV-2 — Q5 and Q6 are the same question.** The only `showPanel('evaluate')` in v3 is inside
  `upSendToEvaluate()` (`_scripts.js:743`), which has **zero callers**, and its body drives
  `#up-rt-selinfo` — an id with **4 JS references and no markup anywhere in the file**. That is the
  same dangling-id signature as the missing `#up-results` card in item 8. So the button that would call
  `upSendToEvaluate()` lives in the markup that did not survive the export: **Q6's answer is whatever
  Q5's turns out to be**, and the "broken export" reading in item 8 is now the stronger one.
  (Note for the record: `upSendToEvaluate` does not exist in v15 at all, and in v15 the only
  `showPanel('evaluate')` is the sidebar item. v3 did not orphan the screen by accident — it **moved**
  the entry point to Upload and then shipped without the markup.)
- **F-NAV-3 — the Dashboard badge became dynamic.** `<span class="bx bx-b">24</span>` →
  `<span class="bx bx-b" id="sb-dash-count">7</span>`. The id has no writer anywhere in v3, so it is a
  binding the prototype declares and never fills. Sidebar badges are W1-A's; `V3-DASH` owns the count.
### V3-REP (Q21–Q23)

- **Q21 — Q1 has an answer, and it is in the prototype.** §3's "v3 deletes stage-awareness" was read off
  a grep. The decoded renderer says something narrower: `__introCols` and `__jTot` are deleted, so the
  **Jury Avg.** and **Avg.** columns are gone and the core table is five columns at every stage — which
  IS "consistent at each stage". `suevSections(stage)` is **not** deleted; v3 rewrites it (see Q23) and
  drops only `jurypipeline`. So Q1 resolves to reading (b) — *same visual design, stage-appropriate
  content* — and `reportStage.ts` and the route's `stage` parameter stay. **Confirm and Q1 closes.**
- **Q22 — the build has TWO report surfaces; the prototype has one.** `EvaluationDrawer` is the
  `openReport()` replica (3 call sites, deck pane + tiles + parameter table); `EvaluationReportModal` is
  the Aug-2026 issue-20/23/24 column-per-evaluator matrix (9 call sites, 7 screens). v3 has no
  counterpart to the second. Merging them is not props-additive and rewrites seven screens four sibling
  sessions are editing right now, so V3-REP pinned BOTH to the v3 column shape and left the split alone.
  **Which one is "the evaluation report" the client is looking at?**
- **Q23 — v3 lets the superuser EDIT the PA and PM sections; this build does not.** `suevSections` in
  the superuser file: `assign` moves `editable('pa')+readOnly('pm')+juryDone()` → `editable('pa')+
  editable('pm')`, and `intro` moves `readOnly('pa')` → `editable('pa')`. `reportLayout`'s `own()` marks
  a section `editable` only when `role === viewer`, so a superuser gets both read-only. That is a
  permission change in the `role-boundary-leaks` class, not a visual one, and it was NOT made on an
  inference. **Is the superuser meant to score on a program associate's behalf?**
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
### `V3-SF` · Q71–Q75 — score visibility (item 13)

The matrix is built, persisted and server-enforced. These five are about what it
should *default to* and how far it should reach — none of them blocks the build,
all of them change a number someone will read.

- **Q71 — the four cells the defaults move. Confirm.** We ship the prototype's
  own printed toggle state, so the screen's footnote is true. Against the rank
  ladder that shipped, four incubator cells differ:

  | cell | ladder | v3 default | direction |
  |---|---|---|---|
  | `program_manager → superuser` | off | **on** | **WIDENS** |
  | `program_associate → program_associate` | on | off | narrows |
  | `jury → program_associate` | on | off | narrows |
  | `jury → jury` | on | off | narrows (this is "blind evaluation") |

  Measured blast radius: **on the deck report, at the shipped settings, nothing
  moves at all** — `jurySeesPeerScores` ships OFF and already reduces every
  assignable evaluator to "AI + own". The deltas appear (a) once an org turns
  that toggle on, and (b) on `/cohort`, `/drift` and `/evaluators`, which never
  applied it. The one *grant* is `program_manager → superuser`, and it sits
  against the Aug-2026 issue-21 quote carried in `roles.ts:151` — *"lower guys
  must not be able to view the evaluators' scores up in the hierarchy"*. If that
  quote still governs, say so and that single cell flips off.

- **Q72 — v3 DELETES the "Jury can see each other's scores" toggle from `s-fw`.
  We kept it.** It is F0109's blind-round kill switch and it is a conjunctive
  gate *ahead* of the matrix (off → an evaluator sees AI + own, matrix not
  consulted). Deleting it would remove a control the client previously asked
  for, so it is recorded rather than shipped. The prototype's caption says the
  diagonal carries the same meaning at finer grain, so the toggle can go — but
  that is a decision, not an inference.

- **Q73 — `admin` is in NEITHER matrix.** The prototype draws 4 incubator roles
  and 5 VC roles and no admin row or column, yet `admin` holds evaluations on
  the seed. So an admin can configure a program manager to see the *superuser's*
  scores but never the *admin's*, which falls through to the old ladder. Is
  admin deliberately outside this control, or is the column an omission?

- **Q74 — the VC 5×5 is drawn on the INCUBATOR superuser's console.** We
  therefore let an incubator superuser read and write the VC matrix, as the
  prototype shows. The VC prototypes were not reshared, so their own consoles
  still render the old single toggle and cannot see or change it. Confirm that
  is intended rather than a copy-paste in the prototype.

- **Q75 — a pre-existing disagreement this made visible, NOT fixed here.** The
  deck report applies `jurySeesPeerScores`; `/cohort`, `/drift` and
  `/evaluators` never have. So with the toggle off a juror sees only their own
  column on the report while the same juror's analytics means still fold in
  every evaluator the role rule allows. Left alone because fixing it changes
  behaviour well beyond item 13 — but it should be someone's row.

### Q41 — what the Jury Pipeline footer and legend say now (`V3-JP`, DECIDED and built)

The v3 panel keeps `.jp-legend` (Assigned · Shortlisted · Rejected · Pending) and `jpFoot`
("N decks · N shortlisted · N rejected · N in progress") **byte-identical to v15**, while deleting the
only column either of them decorated. Decided, with the reasoning, so the next audit does not revert it:

- **The footer sentence stays, verbatim.** It counts rows *in the stage set*; it never read the Status
  column. Every number in it is still true and still the only place the screen states them.
- **The colour legend goes.** In this codebase a `LegendItem.statuses` entry exists to tint a Status /
  Sign-up pill (`legendFor(config.legend, deck.statusId)` in `StagePage`'s `status` case). With the
  column deleted its four swatches decode nothing on screen. The **Filter menu keeps all four words**
  (`legendFilters(JURY_LEGEND, …)` is inherited), so the vocabulary is still reachable — as a filter,
  which is what the v3 toolbar offers, rather than as a key to an absent pill.
- **Outcome moves to the flow tag, read from the deck's real stage** rather than the prototype's
  `jpData[i].flow` (in-memory, lost on reload): `shortlisted` → *"Sent to intro calls"*.
- **One extension beyond the prototype, deliberate:** `rejected` → *"Rejected"*. v3 has no such tag
  because v3's screen cannot reject — but ours still **lists** rejected decks (they now arrive from
  Evaluate, §8), and with the Status column gone they would otherwise read as undecided. It is not the
  repeat the client reported: no juror pill says "rejected".

**Companion decision — where rejection lives now.** Dropping `Reject` from this screen is not a lost
capability: `EvaluatePage.decide("reject")` offers it to admin / PM / superuser via `evaluate`, and to
jury via `jassigned`. Superuser-only, so the PM's surface here is untouched. Flagged in §9.
### `V3-UP` (items 8, 10) — Q51–Q54

- **Q51 — the missing results card (item 8; the concrete form of Q5).** *Not* "is the card real" — it
  plainly is. v3 ships its complete CSS and its complete behaviour and omits only its markup, and the
  same export also orphaned the review step (`upShowReview` has no caller in v3). **Please reshare a
  corrected `panel-upload`.** Everything below is already recoverable from `_style.css` +
  `_scripts.js`, so a one-line "yes, build it from those" also unblocks us:
  - container `#up-inline-results` — `min(940px, 100vw − 48px)`, centred under the wizard,
    `upScrollToResults()` scrolls it into view after an upload;
  - summary `#up-results-sum` — *"**N startups uploaded.** The AI recorded each founder's name, phone,
    email and city from the deck. **R Ready for Eval.** · **N Not Ready for Eval.** (missing details).
    Nothing has been sent for evaluation yet."*;
  - action bar `.up-rt-actions` — `Edit` (toggles to `Save changes`), `Archive`, primary
    `Send to Evaluate`, and `#up-rt-selinfo` (*"Select startups to act on"* / *"N selected · filtered: …"*);
  - head `#up-rt-head` — ☐ · Startup name · Founder name · Phone · Email · City · Status, the Status
    header carrying a sort/filter menu (All · Ready for Eval. · Not Ready for Eval.);
  - rows — a checkbox, the four detail cells (inline `<input class="up-edit-in">` while editing), and a
    per-row `Ready / Not Ready for Eval.` select that **overrides** the computed completeness.

  **Until it is answered `V3-UP` changed the label and nothing else.** Our review step is where the
  credit cost preview lives and where the operator approves the spend; v3's card runs *after* upload.
  Deleting the review on an export this damaged would spend credits with no preview, which is exactly
  what the screen's own flow chips promise not to do.

- **Q52 — which decks the Evaluate screen holds.** The prototype's `evDecks` is the *freshly uploaded*
  population — `addToEvaluate()` is called from Upload — and the screen's job is to run the AI and push
  them onward. Ours (`EvaluatePage`, W7-D) is the scoring workbench: `assigned` + `jury_evaluation`,
  and for a juror only their own decks. v3 does not touch `renderEvDecks`, so `V3-UP` did not touch the
  queue. If the client means the prototype's population, say so — it is a real change, it costs the
  superuser their entry to the scoring workbench from this screen, and it must stay superuser-only
  because jury, admin, PM and PA were not rescoped.

- **Q53 — where the AI actually runs, and so where credits are spent.** Items 8 and 10 only reconcile
  once this is settled, and the two prototypes disagree with each other:
  - **the repo today** — upload spends and evaluates in one step (`uploadSingle` → `evaluateDeck`), which
    is what the wizard's own chips say: *Credits required → Cost preview → You approve → Credits
    deducted → AI evaluates*;
  - **v3** — upload records details only (*"Nothing has been sent for evaluation yet"*), and the AI runs
    later, from the Evaluate screen's `AI Evaluate`.

  These are different products, not different wordings. `V3-UP` mapped `AI Evaluate` onto
  `POST /decks/:id/rescore`, the repo's one AI-evaluation trigger, which refuses a re-run that would
  change nothing (`already_scored`) — honest under today's answer, and the right seam under either.

- **Q54 — the Evaluate entry point (the concrete form of Q6).** **Chosen and shipped:** a
  `Send to Evaluate →` action on the post-upload results screen, which is exactly where the prototype
  puts `upSendToEvaluate()` — the single occurrence of `showPanel('evaluate')` in the whole v3 file.
  **The risk this leaves, stated plainly:** with `V3-NAV` hiding the sidebar item from the superuser,
  that is the superuser's *only* route to Evaluate, and it exists only in a session where they have
  just uploaded. The prototype has the same dead end; we do not have to. Two remedies, either is one
  line — keep the sidebar item for the superuser, or add Evaluate to the Dashboard's new `Actions ▾`
  (`V3-DASH`). Both are other sessions' files; see the §9 row.
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

## 4.1 The client's answers — 2026-09-20 (Chandrasekhar PS)

**Q3 / Q4 — misread twice: first by us, then by our own first measurement.**
He did NOT want the options hidden as a design change. He asked for it as a
WORKAROUND for something he observed:

> *"nothing was changing when I changed from 40:60 or 50:50 or any other option,
> I saw no difference."*

**Measured — `test/worker/ai-weight-effect.test.ts`. The control IS wired; the
problem is that its effect is invisible.**

| Claim | Verdict |
|---|---|
| It changes STORED scores | **No — and correctly so.** The weight blends at READ time; `rescoreEdition` reads `compositeFormula` only (0 references to `ai_weight_pct`). Re-weighting must not rewrite history. |
| It changes the blended `decisionScore` | **Yes.** Seed, sweeping 0% → 50% AI: FinStack **7.95 → 7.88**, GreenGrid **8.75 → 8.73**. |
| A user can SEE that change | **Barely, and usually not at all.** |

**Two reasons he saw nothing, and neither is "the setting is inert":**

1. **Magnitude.** On real data the AI score and the jury average sit close
   together, so the ENTIRE 0%→50% sweep moves the number by ~0.02–0.07 — smaller
   than the rounding most cells display.
2. **Placement.** `decisionScore` is drawn as *"Avg. score"* on the Shortlisted
   table, StagePage, CallsPage, IcVotePage and EvaluatePage — **not in the V3
   Dashboard's default 8-column set**, which is the screen an admin is most
   likely to be on. `blendScore()` itself has only two call sites, both a live
   preview inside `EvalScorecard` while an evaluator is mid-score.

**So the fix is VISIBILITY, not hiding and not rewiring:** make the effect of the
control observable where it is set (a live before/after in the console) and make
sure the blended number is actually on screen where decisions are made. His
ruling on migration stands either way: *"If you are making 50:50 as default,
previous cohorts will remain same. only the new program or cohorts would take
effect."*

**A note on how this was nearly got wrong.** The first version of the test
compared only `aiScore` and `humanAverage`, found them identical at 0% and 50%,
and PASSED — implying the control did nothing. It was not until `decisionScore`
was included that the truth appeared. **A green test that omits the field the
feature actually writes is worse than no test**; it is the same shape as the
Wave 9 vacuous-assertion trap, inverted.

**Q4 (items 6, 7) — answered, and it is not a screen filter.** It is a guard on
the BULK ACTION from the **Evaluated** stat box:

> *"in the stat box of 'Evaluated' only the ones that are marked 'complete' in
> the status column have to be sent to 'assign', even if someone selects all and
> chooses to click 'send to assign'. Similarly, the ones that are marked
> 'incomplete' have to go to 'Query', even if someone selects all clicks 'send
> to query'."*

So Select-all + Send to Assign must silently **drop the incomplete rows**, and
Select-all + Send to Query must drop the complete ones. Nothing is removed from
the screen — which is why the prototype still draws both. **Our reading of
"only X shows on this screen" was wrong in both directions.**

**Q8 (item 5) — 50 MB**, reviewed after beta. Note the standing constraint: above
~24 MB a deck cannot be AI-evaluated without the streaming / Files-API change
(base64 x1.333 vs the 32 MB model-input cap). Raising the limit alone makes
uploads succeed and evaluation fail.

**Approach approved.** *"This approach works, so that we don't duplicate errors."*
Superuser first; the other roles follow once these screens are signed off.

**Payment gateway — there is no existing one.** *"No we don't. I said if Digital
Catalyst might be familiar with that for their marketing clients."* So the
integration is a new gateway, chosen by us; banking details and the firm's
registration information will be provided.

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

---

## 8. V3 wave integration — the record

**All nine branches merged.** The partition held: 87 files changed
(+11,702 / −484) and only **eight** touched by more than one session. Merge
order was `V3-NAV` → `V3-REP` → `V3-DASH` → `V3-SF` (the three sharing
`decks.ts`, in route order) → the rest.

| Leg | Result | Before the wave |
|---|---|---|
| typecheck · lint · build | clean | clean |
| `npm test` | **2280 passed / 1 skipped / 0 failed** | 2069 / 1 |
| `roles` | **1180 / 1180**, exit 0 (server proved mine: PID + cwd) | 1115 / 1115 |
| `parity:tokens` | 27/27 · 0 gaps | 0 gaps |
| `parity:nav` | ok · **62** known gaps, unchanged | 62 |

### The by-route split on `decks.ts` worked

Three sessions edited it and the one conflict was a clean union: `V3-REP`'s
blind-scoring block and `V3-SF`'s visibility-matrix load landed at the same
insertion point because each owned a different concern. `V3-REP`'s
`columns = blind ? [] : [...]` supersedes `V3-SF`'s unconditional line; the
visibility load goes first because `addEvaluator` below reads it.

### One P0, filed by the session that caused it

`V3-NAV` split `nav.ts`: `canSeeNav`/`reachableNav` is REACHABILITY (still the
route guard and the roles-harness invariant), `navForUser` is THE SIDEBAR
(reachability minus `hiddenFor`, reordered). V3 item 10 takes `evaluate` out of
the superuser's sidebar while leaving the route live — so every caller still
using `navForUser` to mean "can reach" lost it silently. Three sites, placed at
integration:

- `DashboardPage` — the superuser lost the **"Score in Evaluate"** link outright.
- `Sidebar` rendered `item.icon`, so `V3-NAV`'s per-role `iconOverrides` was
  delivered as data, unit-tested, and **never drawn**.
- `e2e/coverage.spec.ts` walked `navForUser`, so it stopped covering
  `/app/evaluate` the moment the item left the sidebar.

**The P0 shipped without a test**; `navIcon` and `reachableNav` were covered but
the link was not. `test/client/allDecks.test.tsx` now pins it for the SUPERUSER
(hidden, reachable) and the ADMIN (never hidden). Negative control: reverting to
`navForUser` fails the superuser case and leaves the admin case green.

### The e2e leg — stated as it happened, because a clean full run was never obtained

The first ran **52.3 min** (normally ~12) during heavy contention, with
`TIME_WAIT` at **11,371** against macOS's ~16,384 ephemeral range — the
port-exhaustion condition `V3-NAV` documented at 7,105. It reported 2 failed /
226 passed. One failure was `evaluate-workbench`, which asserts an AI rationale
visible to a juror — genuinely suspicious, because `V3-REP` had just added
blind-scoring withholding to the report route. **Checked rather than assumed:**
both failures plus an untouched control re-ran on a quiet box with retries off
at **7 passed in 19.5 s**, `TIME_WAIT` back to 3. Environmental.

**Rule this wave adds:** a run whose WALL-CLOCK is 4× normal is already telling
you the result is about the machine. Check `netstat -an | grep -c TIME_WAIT`
before `grep`-ing for `Network connection lost` — at exhaustion the drop
signatures barely appear (2 in a 52-minute run) while everything still fails.

**Three full runs of this identical tree, none clean, and the failing SET
differed every time:**

| Run | Wall-clock | Result | `fetch failed` | TIME_WAIT |
|---|---|---|---|---|
| 1 | 52.3 min | 2 failed / 226 passed — `home`, `evaluate-workbench` | 2 | 11,371 |
| 2 | killed | — | 73 by test 62 | 12,721 |
| 3 | **6.0 min** | 2 failed · 7 flaky / 218 passed — `branding` ×2 | **210** | 0 → 9,175 |

**A single full run burns ~9,000 of the 16,384 ephemeral ports by itself**, so
run 3 started drained and still finished starved. Note run 3's wall-clock was
NORMAL — the 4× heuristic does not catch it, and `Network connection lost` was
**0** while `fetch failed` was 210. **`fetch failed` is the reliable signature;
wall-clock and `Network connection lost` are both capable of looking fine.**

**Every failure was verified individually on a drained box, with untouched
controls alongside** — `home` + `evaluate-workbench` + `upload` = **7/7 in
19.5 s**; `branding` + `calls` + `coverage` = **30/31 in 1.4 min** (the one
failure being a `/login` page that never rendered, 45 `fetch failed` in that
run); that founder test alone = **1 passed in 13.5 s, 0 `fetch failed`**.

**What this means for the record: the e2e leg was NOT obtained as a single
green full run on this machine.** What was obtained is every constituent spec
passing on a drained box, a failing set that reshuffles between identical runs,
and zero failures whose trace contains a frame from `src/`. That is the honest
state — recorded rather than rounded up to green.

### Document hygiene

The nine-way union left two `## 8. Progress` headings and **39 rows in §3's
19-item table** — every session appended its state rather than editing in place.
§3 now carries one authoritative row per item, keeping each original's scoping
evidence.

### Where the 19 items stand

**Thirteen done.** Six are not, and **five of those are waiting on the client,
not on us** — see §4: items 3 and 4 (the prototype still offers every option,
and keeping only 50/50 re-weights every existing org's composite), items 6 and 7
(the strings appear zero times in either prototype, and it still draws the UI
those rules would delete — `V3-FLOW` recorded both readings and correctly
refused to infer), and item 5 (needs a target ceiling plus acceptance that
>24 MB cannot be AI-evaluated without streaming work). Item 8's label shipped;
its flow is Q51.

## 9. Progress — measured gates, one row per session

Every number here was MEASURED on the session's own branch, never copied from a
prompt. Baselines off `main` at the start of the wave: unit **2069 passed /
1 skipped**, roles **1115/1115**, `parity:tokens` 0 gaps, `parity:nav` 62 known
gaps, e2e ~224.

| Session | Items | Migration | typecheck · lint | unit | roles | e2e | notes |
|---|---|---|---|---|---|---|---|
| `V3-SF` | 13 done · 3, 4 recorded | 0072 | clean · clean | **2093 passed / 1 skipped** (+24) | **1115 / 1115** | **209 passed · 15 flaky · 2 failed** of 226 (+2) — both failures are dev-server casualties, see below | negative control run on all four filters, the console gate and the audit trail |

### `V3-SF` — what the negative control actually proved

The point of this session is a permission, so "the tests pass" is worth nothing
on its own. Each filter was reverted and the suite re-run:

| reverted | tests that failed |
|---|---|
| `decks.ts` report filter → the old ladder | *the matrix decides the report, cells included* · *turning a cell ON hands over columns that were withheld* · *turning a cell OFF withholds a column the default allowed* |
| the three `analytics.ts` filters → the old ladder | */evaluators names only evaluators the viewer's row allows* · */drift's mean MOVES with the matrix* |
| the `showMatrices` superuser gate → always on | *the roles whose prototype was NOT reshared see the section exactly as today* |
| the `auditScoreVisibility` call → dropped | *audits the CELLS that moved, by name* |

`/drift` is asserted on a MEAN, not a row count: every seeded incubator deck
carries a programme-associate evaluation, so the row set never moves and a
count assertion would pass with the filter gone. That is the vacuous-test shape
Wave 9 integration caught on the first issue-21 test, and it is the reason this
file asserts cell OWNERS on the report rather than column headers alone.

### `V3-SF` — the e2e run, stated as it happened

One real regression, found and fixed; everything else is the machine.

**The real one.** `DEFAULT_ADMIN_SECTION` is `"fw"`, so `/app/admin` with no `?section=` lands on
Scoring framework — which had carried no `<table>` at all until item 13 and now carries two. The
walk failed with `incubator/superuser/admin table headers`, reproducibly, on both attempts. Fixed by
re-capturing that ONE row and unioning the two header sets beside the Team & roles set already
there. The same read returns `tables: []` for `incubator/admin`, which is the superuser gate working,
so that row was deliberately left alone. `grep -c "table headers"` is **0** across all three runs
since.

**The machine.** The box carried three to five sibling e2e runs throughout. Each run logged
**319–375 `[vite] Internal server error: fetch failed`**, and the two remaining failures are that and
nothing else: `incubator/superuser/scoredrift` read its title as **`"Sign in"`** (the session was
dropped mid-walk) and `incubator/admin/incuration` read **`"Internal Server Error"`**. Neither screen
is one this session touches. Note for the next session: **`grep -c "Network connection lost"` returned
ZERO in every one of these runs** — the drop's tell in this vite version is `fetch failed`, plus
`Internal Server Error` or `Sign in` appearing as a page TITLE, and 180 s timeouts on `/login`
itself. Grep for both strings.

Per the protocol, the failing file was re-run alone with an untouched spec as a control:
`coverage.spec.ts`, which this session does not touch, failed the same way in the same run. That is
what separates the two causes.

### `V3-SF` — measurements worth keeping

- **`s-fw` is byte-identical (md5 `c3b534ba…`) in six prototypes**: the incubator
  admin, PM and PA, the incubator superuser **v15**, and BOTH VC consoles. Only
  `AISJ_SuperuserV3` (`de4dfe4e…`) differs. That is the whole justification for
  gating the matrices on incubator-superuser, and it is checkable in one command.
- **v15 already shipped `Jury can see each other's scores` OFF** (`class="tog"`,
  no `on`) while `canSeeEvaluatorScores` returned `true` for jury→jury. So the
  repo has diverged from the prototype on the blind-evaluation point since
  before v3; v3's footnote only made it explicit.
- **At the shipped settings the deck report does not move at all.** The four
  default cells that change (§4 Q71) are masked on that surface by
  `jurySeesPeerScores`, which ships OFF. They are visible on `/cohort`,
  `/drift` and `/evaluators`, which never applied that toggle — which is Q75.
- Items 3 and 4 were re-measured and confirmed exactly as §3 describes: the two
  selects are byte-identical v15→v3, and the AI-weight select carries no
  `selected` attribute.


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
  the box runs out of EPHEMERAL PORTS and the Vite plugin can no longer reach its own worker. macOS
  has 16,384 of them (`sysctl net.inet.ip.portrange` → 49152–65535), and **ONE full e2e run burns
  thousands**: this session watched `TIME_WAIT` (`netstat -an | grep -c TIME_WAIT`) go from **15 to
  14,603 with only TWO worktrees running, at load 4.5**, and peak at **15,382 — 94 % of the whole
  range** — while a single run logged **192** `fetch failed`s before dying at 85/224. So the
  threshold is far lower than "don't run nine at once": **two concurrent `test:e2e` runs already
  saturate this machine.** It is NOT CPU (load was 4–6 throughout the worst of it) and raising a
  timeout cannot help. **Practical rule: check `netstat -an | grep -c TIME_WAIT` BEFORE you start.**
  Under ~4,000 the run is sound; over ~10,000 do not bother — it drains in minutes once runs stop. It surfaces as `[vite] Internal server error:
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

### Sessions that recorded their gate as a Branch/State table

| Session | Branch | State | Measured gate |
|---|---|---|---|
| `V3-NAV` | `parity/V3-NAV` | **complete** — items 9 and 18-label closed; 8-label and 10-sidebar closed | typecheck ✓ · lint ✓ · unit **2076 passed / 1 skipped** (2069+7 new) · build ✓ · roles **1115/1115** · `parity:nav` **62 known gaps, 0 unexpected, 0 fixed** · `parity:tokens` 27/27, 0 gaps · e2e **197 passed / 4 failed / 23 flaky**, then green — see below |

### `V3-NAV` — what landed

**Commit 1 (`32e79f2`), the one the other eight were waiting on.** `scripts/parity-lib.ts` repointed
from `AISJ_IC_SuserV15` to `AISJ_SuperuserV3`, superuser row only. `parity:tokens` stayed 27/27 with
zero gaps against the new file; `parity:nav` kept its 62 known gaps and surfaced exactly three
unexpected ones — `label alldecks`, `label upload`, `extra evaluate` — which is the V3-NAV worklist and
nothing else. Landed before any other work in this session.

**Commit 2, the sidebar.** Four changes, all scoped to `incubator/superuser`:

| | v15 / today | v3 / now |
|---|---|---|
| `alldecks` | All decks · `Layers` | **Dashboard** · `LayoutDashboard` |
| `upload` | Upload | **Upload & Evaluate** |
| `evaluate` | in the sidebar | **not in the sidebar** — route still live |
| order | … jurypipeline · pmpipeline · introcalls … | … jurypipeline · **introcalls · pmpipeline** … |

Item 9 ("shift Query after Evaluate") needed no work and no move: deleting the standalone Evaluate item
leaves Query directly after Upload & Evaluate, which is what the prototype shows.

**The design decision worth knowing about.** The BUILD block suggested `hiddenFor?: Role[]` be honoured
by `canSeeNav`. It must not be, and the reason is measurable: `canSeeNav` is also the route guard
(`routes/guards.tsx`), the analytics gate (`routes/analytics.ts`) and the roles harness's invariant
*"superuser sees every non-portal, non-exclusive item"* (`role-matrix.ts:264-271`). Honouring
`hiddenFor` there would 404 `/app/evaluate` — which the plan explicitly requires to stay alive for
`V3-UP` — and drop `npm run roles` to 1114/1115. So the split is:

- `canSeeNav` / `canAccessNav` / `reachableNav` → **reachability**, unchanged for every role.
- `isInSidebar` / `navForUser` → **the sidebar**, which is reachability minus `hiddenFor`, reordered.

`navForUser` is therefore no longer a synonym for "can reach", and two callers outside this session's
ownership are relying on the old meaning — both are §9 rows below.

**Verification.**
- Every role's sidebar was diffed against `main`'s `nav.ts` compiled side by side, as `id:label:icon`
  in draw order. **Exactly one of the thirteen changed:** `incubator/superuser` (25 → 24 items).
  `incubator/{admin, program_manager, program_associate, jury, founder}` and all six VC roles are
  identical — which is the CONSTRAINTS block's requirement, measured rather than asserted.
- The resulting superuser order matches `AISJ_SuperuserV3/_sidebar.html` item for item, with the
  prototype's `forsignup` mapped to `pmpipeline` and the two recorded parity extras (`billing`,
  `issues`) in their app positions.
- **Negative control run on all three mechanisms.** Reverting `hiddenFor` fails 3 tests; reverting the
  order override fails 2; reverting the label/icon overrides fails 1 — verified by evaluating
  `navLabel`/`navIcon` directly to confirm all three overrides were really gone, not just one. No
  assertion here passes with its fix removed.
- `npm run roles` was run against a dev server proved to be this worktree's own (PID 31287, `lsof` cwd
  `/Users/jayanthkomarraju/Documents/GitHub/sj-V3-NAV`, port 5273), and the output shows
  `C. RUNTIME PROBE · target: http://localhost:5273` — not the serverless run that fakes a pass.
- **One coverage gap, and it is the §9 row's whole point.** After this change nothing in e2e walks
  `/app/evaluate` as the incubator superuser: both walks that did (`coverage.spec.ts:53`,
  `parity.spec.ts`) are driven by `navForUser`, which is now the sidebar. The route is asserted at the
  unit level (`canAccessNav("incubator","superuser","evaluate") === true`, with a negative control),
  but it has no browser-level guard until `coverage.spec.ts:53` moves to `reachableNav`. The incubator
  Evaluate e2e test logs in as a **jury** member, who reaches the screen by a different slug
  (`jassigned`), so it does not cover this.

**The e2e leg, measured honestly.** The full suite ran at load ~10 with three sibling Playwright
stacks live (there was no quiet window — 20 minutes of waiting never saw the count reach zero):
**197 passed · 4 failed · 23 flaky (224 total, = the baseline) in 15.5 min.** `Network connection lost`
occurred **0** times, so per the gate's own rule the failures were read as code, not as drops.

- **One was real and was mine.** `e2e/chrome.spec.ts:93` asserted a link named `/All decks/` while
  logged in as the incubator superuser — the label item 18 renames. It failed on the original *and*
  the retry, which is what separated it from the noise. Fixed by updating the literal only (§9).
- **Three were environmental, and the control proves it.** `incubator/superuser` failed on
  `contactadmin` with *"Internal Server Error"* — a screen this session does not touch — and
  `vc/superuser` / `vc/partner` failed with no `<h1>` at all, in an edition it does not touch.
  Re-running `chrome.spec` + `parity.spec` + `nav.spec` together: **28 passed, 2 flaky, 0 failed.**
  Both VC walks passed outright, and the two that stayed flaky were `incubator/superuser` **and
  `incubator/admin`** — a role with a byte-identical sidebar, which is the untouched control. The
  flakiness tracks the machine, not the branch.
- **A NEW failure mode this wave will hit, and it is not a code fault.** Two of three full-suite
  attempts never started at all: the Playwright `webServer` died during `npm run db:migrate:local`
  with `✘ [ERROR] Migration 00NN.sql failed` followed by
  `connect EADDRNOTAVAIL 127.0.0.1:<port>`. It is **not** load — the second time it happened the load
  average was **2.7**. It is ephemeral-port exhaustion: measured **7,105 sockets in `TIME_WAIT`**
  against macOS's 49152–65535 range (16,384 ports, ~43 % consumed), because wrangler opens a
  connection per migration statement and nine sessions have been cycling local D1 for hours.
  Tells it apart from a real failure: the migration number VARIES between runs (0046, then 0060),
  the error is a SOCKET error rather than SQL, and `git diff --name-only main..HEAD -- migrations/`
  is empty. Diagnose with `netstat -an | grep -c TIME_WAIT`; the fix is to wait, or to stagger the
  stacks. Do not go looking at the migration it names.
- **The proof this session actually wanted is `e2e/nav.spec.ts`, and all 14 passed both times.**
  `incubator/superuser sees only its permitted nav` compares the RENDERED sidebar's link texts
  one-for-one against `navForUser(...).map(navLabel)`, so it is a real browser check that the sidebar
  draws Dashboard · Upload & Evaluate · no Evaluate · Intro calls above Prog manager pipeline — while
  the other eleven role walks stayed green.

**Migration 0066 was NOT taken.** This session changes a manifest and two scripts — no schema, no data.
`main` still ends at `0065` and `ALLOTMENT_CEILING` is untouched at 65, so 0066 is free for whoever
needs it next.

**Not done, deliberately.** The `Dashboard` icon is delivered as data (`iconOverrides`) and covered by
tests, but `Sidebar.tsx` still renders `item.icon`, so the rendered icon does not change until the §9
patch is applied. `Sidebar.tsx` is not this session's to edit. Three §9 rows are filed in
`docs/plan_parity.md`, and **the first is a P0 regression this session caused**: `DashboardPage.tsx:922`
resolves a route through `navForUser`, which no longer means "can reach", so the incubator superuser
loses the report modal's "Score in Evaluate" link until that one-word patch lands.
### `V3-REP` — item 1, the evaluation report

**Item 1 is not what §3 said it was, and the correction matters.** §3 was scoped off a grep and
reported that v3 "deletes stage-awareness". The decoded renderer — `window.openReport`, the SECOND
definition in `_scripts.js` (v3 ~4042 / v15 ~3713; the earlier one is overwritten and is a 5-line
stub) — says something narrower. The whole diff is 27 lines:

| v15 → v3 | What it is |
|---|---|
| `__introCols` and `__jTot` deleted | The **Jury Avg.** and **Avg.** columns go. The core table is now `Parameter · Weight · AI · My score · ⌄` at EVERY stage, colspan hard-coded 5. **This is item 1 itself.** |
| new `opts.hideAi` | A whole new report state: the deck the AI has not evaluated yet. Four pieces of copy, all verbatim below. |
| `suevSections(stage)` **kept**, and edited | `assign`: `editable(pa)+readOnly(pm)+juryDone()` → `editable(pa)+editable(pm)`. `intro`: `readOnly(pa)` → `editable(pa)`. |
| `jurypipeline` dropped from `suevStage()` and from the roleBlock list | One stage retired. |

So **v3 answers Q1 in favour of reading (b)** — *same visual design, stage-appropriate content*. It
does not delete `reportStage.ts`, the `?stage=` parameter or `reportLayout`; it deletes the columns
that made the table a different SHAPE per stage. W7-D and Issue 24 are not reversed. See §4 Q21.

**Built** (props-additive throughout — neither `EvaluationDrawer`'s nor `EvaluationReportModal`'s
signature changed, so the seven screens four siblings are editing are untouched):

1. **The v3 column shape, pinned at three stages.** The drawer never had `__introCols`, so nothing
   needed deleting — but nothing asserted it either. `test/client/reportV3.test.tsx` now pins the
   five headers as literals copied from the decoded markup and asserts the SAME set at `assign`,
   `intro` and `default`, for both surfaces. Negative control: re-adding a `Jury Avg.` column fails
   3 of 12 tests.
2. **`hideAi`, verbatim.** Before the AI has run, the report keeps all 13 rows instead of emptying
   the table: AI cells `—`, tile sub-line *"Run AI Evaluate to score"*, overall remarks *"Not
   evaluated yet. Click **AI Evaluate** on the Evaluate page to generate the AI scores and remarks —
   they'll then appear here and on the Assign page."*, expanded row *"Not evaluated yet — run AI
   Evaluate to generate the AI remark."* Rows come from the report route's `core`, which lists every
   active parameter whether or not anyone scored it (pinned in `test/worker/report-v3.test.ts`).
   Blind scoring (F0106) empties the same cells for an unrelated reason and keeps its own wording.
3. **The `custBlock` table.** Four columns and an expanding row (`Parameter · Weight · My score · ⌄`
   → *"My remarks for this parameter"*), and the section's small print is now the prototype's three
   variants chosen by mode: *"{Role} · from My Parameters · auto-filled by assigned role"* /
   *"· read only"* / *"· completed by jury"* + a **Submitted** badge.
4. **The hint verbatim** — *"tap any parameter to read the AI remark and add yours"* (was "…and your
   own").

**Found while building it, and fixed: blind scoring did not hold on this route.** `GET
/api/decks/:id` withholds the AI score from an evaluator who has not submitted, and Wave 2
integration closed the same hole on the LIST route, noting that *"withholding on the detail route
alone does not make scoring independent"*. **`GET /decks/:id/report` was never given the rule** — and
it is the widest of the three, because seven screens render the report and `EvaluationReportModal`
draws `data.core` directly. Measured on the seed before the fix, with `show_ai_score_to_jury = 0`:
the juror's deck detail correctly said `aiScoreWithheld: true, scores: []`, while the report handed
the same juror **13 of 13 AI cells with their rationales**. Now dropped server-side; the response
carries `aiScoreWithheld` and both surfaces say why. Three tests, and the negative control is in the
pair itself — same juror, same deck, toggle on and off, and the *row count* moves, not a mean.
**Note for integration:** this widens the known org-wide window in `e2e/scoring-framework.spec.ts`
(plan_parity §8 Q17) from one route to two. No spec asserts the report's AI column inside it.

**Not done, deliberately:**
- **The `suevSections` mode shifts (§4 Q23)** — v3 lets the superuser EDIT the PA and PM sections;
  `reportLayout`'s `own()` gives `editable` only for the viewer's own role. That is a permission
  change in the `role-boundary-leaks` class, not a visual one, and not something to infer.
- **Migration 0067 was NOT used** — `hideAi` is derivable from data the route already returns.
  0067 is free for whoever needs it; `ALLOTMENT_CEILING` untouched at 65.
- **`Pitch deck` was never missing.** `DeckPdfViewer` already draws the prototype's `.jr-deck-h`
  title with its icon and "· N slides". Adding a second one broke `e2e/upload.spec.ts:143` on a
  strict-mode violation and was reverted. The prototype puts **Research** inside that header row;
  this build has it above. One line, in `DeckPdfViewer.tsx`, which is not this session's file.
- **Additional-parameter Weight reads "Informational", not a percentage.** Every additional
  parameter is seeded `weight = 0` (migration 0013) because they do not enter the composite; the
  prototype's role parameters carry invented weights. "0%" would state the opposite of what it means.
- **The two report surfaces were not merged** — §4 Q22.

**Measured gate** (own worktree, `E2E_PORT=5207`, Node 22, eight siblings live on the box):

| Leg | Result | Baseline |
|---|---|---|
| `typecheck` | clean | clean |
| `lint` | clean | clean |
| `npm test` | **2096 passed · 1 skipped** | 2069 · 1 |
| `build` | clean | clean |
| `roles` | **1115 / 1115**, own server on :5209 (PID + cwd checked) | 1115 / 1115 |
| `test:e2e` | **210 passed · 1 failed · 13 flaky** | ~224 |

New tests: `test/client/reportV3.test.tsx` (15) · `test/worker/report-v3.test.ts` (12) — +27.

**Read the e2e number with its control.** The box carried all nine sessions at once and the dev
server dropped connections throughout: **409 `[vite] Internal server error: fetch failed`** in that
run. The tell here is NOT `"Network connection lost"` (0 occurrences) — it is that string, and a
`locator('h1')` that finds **no element at all**, i.e. a page that never rendered.

The one failure, `crm-sync.spec.ts:193 a non-admin is refused the CRM API`, touches nothing this
session owns, and a *different* test in that same file failed on the previous run — the signature of
load, not a regression. Run alone with `--workers=1`: **`crm-sync.spec.ts` + `evaluate-stage-report.spec.ts`
= 9/9 passed in 18.8s, zero server errors.**

The control the plan asks for, run on **`main`** with none of this work on it:
`e2e/parity.spec.ts --workers=1` → **3 hard failures** (vc/superuser, vc/admin, vc/associate) + 3
flaky, 191 server errors. The same spec on this branch: 2 failures, then flaky-only. **`main` is
strictly worse than this branch on the spec most often blamed.** Nothing here is a code fault.

One real regression WAS caught by e2e and fixed: the duplicate `Pitch deck` heading — see "Not done".

**Files touched outside this session's four:** `src/client/api.ts` — one additive optional field on
`DeckReportMatrix`; `test/client/allDecks.test.tsx` — one assertion the v3 copy supersedes. Both are
§9 rows in `docs/plan_parity.md`.
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
### `V3-JP` — item 2, Jury Pipeline. **Complete.**

Branch `parity/V3-JP`. Owned: `INCUBATOR_STAGE_CONFIG.jurypipeline` in `StagePage.tsx`. Nothing else
in that file, and no other file except this plan, `plan_parity.md` §9, my own tests and one
`e2e/parity.spec.ts` row.

**The scoping fact the brief did not have: both v3 actions already exist as repo transitions.**

| v3 `jpAction` branch | prototype does | repo equivalent | new transition? |
|---|---|---|---|
| `introcall` | `jpToIntroCalls(i)` — pushes the deck into `ncData`, i.e. onto the **Intro calls** screen | `INCUBATOR_CALLS_CONFIG.introcalls` has `statuses: ["shortlisted", "intro"]`, so **`shortlist` IS "send to intro calls"** — the deck lands on Intro calls the moment it is shortlisted | **no** — a relabel |
| `reassign` | `addToAssign(d)` then `showPanel('assign')` | `AssignPage` lists `ai_evaluated` + `assigned`; a deck already at `assigned` is already there, so this is `showPanel('assign')` with nothing to move | **no** — a navigation |

So "Action options drop 5→2" is not a capability deletion. `Shortlist` is **renamed** to the client's
words; `View deck` goes (and v3 orphans that pane anyway — `jpOpen` has **zero callers** in v3, one in
v15); `Reject` moves to Evaluate (§4 Q41); `Begin jury evaluation` had no prototype counterpart in
either version and goes with them.

**Superuser-only, because it has to be.** `jurypipeline` is one nav slug shared by **four** incubator
roles — `roles: ["admin", "program_manager", "jury"]` plus superuser's bypass — and only the superuser
prototype was reshared. The base config is byte-unchanged and all of v3 lives in
`roleVariants.superuser` (W9-C's mechanism, as `VC_STAGE_CONFIG.curation` already uses it). `parity.spec`
proves it: **one** of the four `*/jurypipeline` rows changed and three did not.

**Built** — all inside my config entry, via `col()` custom columns; no case in the shared `cell()`
switch and no line of `StagePage()` or `actionCell()` was touched:
1. `status` column deleted → the prototype's exact eight headers.
2. Juror pill `Submitted` → **`Evaluated`** / `Pending`. v3 collapses `jpJurorLabel`'s four states to a
   binary and adds `.jp-jstat.evaluated` — **new CSS in v3**, which is how you know it is deliberate.
3. Action select: `Action ▾` · `Send to intro calls` (the `shortlist` transition) · `Reassign / add
   jury` (navigates to `/app/assign`, offered only from a stage `ASSIGNABLE_STAGES` accepts).
4. `.jp-flowtag` once decided, from the deck's real stage: `shortlisted` → "Sent to intro calls"
   (green + `PhoneCall`, matching `.jp-flowtag.intro`), `rejected` → "Rejected". No select on a
   decided row.
5. Legend dropped, footer kept, `emptyDescription` reworded off "Score / Shortlist / Reject". §4 Q41.

**Migration 0069 is UNUSED and free for anyone.** Nothing here persists new state; `ALLOTMENT_CEILING`
is untouched at 65. No server route, no permission and no gate changed, so `scripts/role-matrix.ts`
needed no probe.

**Not built, filed as §9 requests in `plan_parity.md` with exact diffs:**
- `ASSIGNABLE_STAGES` (`server/routes/assignments.ts:32`) refuses `jury_evaluation`, which is the case
  "add another juror" is actually *for*. Offering a dead menu entry would be worse than omitting it.
- Two now-role-specific comments, in `nav.ts` (a §2.2 hazard file) and in `pmpipeline`'s entry.

**Measured gate** (this worktree, Node v22.23.1, `main` @ `6785fb5`):

| Step | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm test` | **2078 passed / 1 skipped** (baseline 2069/1; +9 = 6 superuser + `it.each` × 3 roles) |
| `npm run build` | built in 648 ms |
| `npm run test:e2e` | **220 passed · 3 flaky · 1 failed** (224 = baseline ~224), 10.1 min. The one failure is NOT mine — see below |
| `e2e/parity.spec.ts` alone | **12/12 role walks green** (7 outright, 5 on retry at load 14). `incubator/superuser` passed outright; the admin / PM / jury rows passed unchanged |
| `npm run roles` | not run — see below |

**Negative control, run and recorded.** With `roleVariants` deleted from the config and nothing else
changed, the five superuser tests fail (`5 failed | 18 passed`) and the three role-control cases keep
passing — which is the point of them: they must hold in *both* states, because those three roles must
not move. A test that had passed with the fix reverted would have been decoration.

`npm run roles` was not run: this change adds no route, gate or permission, so no probe moved and the
1115/1115 baseline cannot have shifted. Said plainly rather than quoted from the brief.

**The one e2e failure, diagnosed rather than waved at.**
`e2e/scoring-framework.spec.ts:48` ("blind scoring withholds the AI score from the API") failed on
`expect(before.aiScoreWithheld).toBeUndefined()` — received `true`, i.e. the toggle was ALREADY off
when the test read its baseline. **Zero `Network connection lost` in the run**, so it is not the
recorded infrastructure pattern; this one has its own mechanism:

- `showAiScoreToJury` is a **global** config row, and `scoring-framework.spec.ts:48` is the only test
  in the suite that writes it — `:106` and `:145` only read. So nothing external flipped it.
- The run is `fullyParallel`, `workers: 2`, `retries: 1`. The failure is recorded under `…-retry1`,
  so the FIRST attempt left the toggle off: its `finally` does `login(ADMIN)` then `setFramework(…true)`,
  and `setFramework` itself asserts `expect(res.ok()).toBe(true)` — under load a slow login or PUT
  throws *inside the `finally`* and the restore never lands. The retry then fails deterministically on
  its very first assertion. `:106` in the same file went flaky in the same run on a plain
  render timeout, which is the load that triggers it.
- **Measured, not argued:** the file re-run ALONE on a fresh server + fresh D1 is **3 passed (41.8 s)**.

It is in `V3-SF`'s file, exercises `GET /api/decks/:id` for a jury member, and has no path to a change
that touches one incubator-superuser stage config. Filed in `plan_parity.md` §9 with the fix.
| Session | Items | Measured gate | What landed |
|---|---|---|---|
| `V3-UP` | 10 **done** · 8 **partial (Q51)** | typecheck ✓ · lint ✓ · **unit 2088 passed / 1 skipped** ✓ (`main` measured at 2069/1 in this same worktree — +19 exactly: 10 in `evaluateV3.test.tsx`, 9 added to `upload.test.tsx`, which goes 14 → 23) · build ✓ · **e2e — see the note below, the short answer is nothing here broke** · `roles` **not run, and provably untouched**: no route, middleware, permission, migration or nav changed — `AI Evaluate` reuses `POST /decks/:id/rescore`, whose `requireTask` already bypasses the role list for `superuser` (`auth/middleware.ts:63`) · `e2e/parity.spec.ts` **no rows re-captured**: the walk records only `<h1>` and `<thead>` sets, and neither screen's title nor tables moved · **migration `0070` unused, stays free** | **Item 10 complete**, incubator superuser only: the `AI Evaluate` toolbar button, the select-all checkbox + `N selected` counter, a per-row checkbox, and the new sub-line verbatim. `evAiEvaluate` → `rescoreDeck` per target (nothing ticked evaluates them all, as the prototype does) → toast → `/app/assign`; count and batch are the same set even under a filter, which the prototype never had to solve because its Filter is inert. **Item 8: the label only** — the export is broken, measured symbol by symbol in §3. Entry point (Q54) is the prototype's own `upSendToEvaluate`, on the post-upload results card. New: `test/client/evaluateV3.test.tsx` (10), `e2e/evaluate-v3.spec.ts` (2), 9 cases in `test/client/upload.test.tsx`. **Both gates carry a RUN negative control**: forcing `isV3Evaluate` true fails all four non-rescoped incubator roles; forcing `v3Superuser` true fails PM, PA, admin, VC partner and VC superuser. Raised **Q51–Q54** and three §9 rows in `plan_parity.md`. |

### `V3-UP`'s e2e, measured honestly

Two FULL runs on a genuinely idle machine (1-min load under 3, `workerd` down to 2, no sibling
suite running), both with **zero** `Network connection lost` — so the plan's usual excuse does not
apply and the code is what to look at.

| | passed | failed | flaky | note |
|---|---|---|---|---|
| run 1 | 218 | 2 | 6 | `coverage.spec.ts:69` · `evaluate-stage-report.spec.ts:36` |
| run 2 | 215 | 1 | 9 | `branding.spec.ts:124`; 1 did not run |

**The failing set rotates between runs and has never once included a spec this session touched.**
Each of the three passes clean when run on its own, on this branch: `coverage.spec.ts` 18/18,
`evaluate-stage-report.spec.ts` **2/2 in 11.3 s**, `branding.spec.ts` **4/4 in 13.3 s**. They are
state-mutating specs racing each other under `fullyParallel` against one D1 — branding rewrites the
org's global mark, `evaluate-stage-report` advances GreenRoute through intro, and `coverage` walks
every slug across both.

**The control was run.** Detached at untouched `main` (`6785fb5`) in this same worktree, same machine,
same pairing: `evaluate-stage-report.spec.ts:36` is flaky there too. Pre-existing.

**What is positively green in BOTH full runs**, never flaky in either: `e2e/evaluate-v3.spec.ts`
(both tests), `e2e/upload.spec.ts` (all three) and `e2e/vc-intake.spec.ts` — the VC edition's intake,
which shares `UploadPage` and was not rescoped.

A session that wants a single clean number should expect roughly **226 total, ~218 green, the
remainder rotating interference**. Reducing it is a suite-wide serialisation question, not this
session's — it is already §9's long-running `coverage.spec.ts` thread.
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

**Runs 2–6 could not produce a clean full-suite number, and the reason is measured.** Six attempts
across ~3 hours. The last began on a genuinely idle box — **`TIME_WAIT` 15, load 3.4**, the only such
window in the whole wave — and still degraded: 64/224 after ~50 minutes with 50 `fetch failed`s, by
which point `TIME_WAIT` was 14,603 **with just this run and one sibling**. That is what establishes
the threshold above, and why waiting for a quieter box was never going to work while any sibling was
active: the suite is self-limiting at two concurrent runs. Every
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

`e2e/parity.spec.ts` needed **no re-capture**, and that was PROVED rather than reasoned. The walk
visits nav slugs with no query string, so `<edition>/<role>/admin` records whatever the console's
DEFAULT section draws — and `DEFAULT_ADMIN_SECTION = "fw"` (Scoring framework), not `wt`. Since item
12 adds a `<table>`, that distinction matters: signing in against my own server and reading
`/app/admin` with no `?section=` (the walk's exact request) returned **`tables=[]` for incubator
superuser, incubator admin AND vc superuser** — the Seat-configurability grid is not on that page.
The four `coreparams` rows belong to `ConfigPage.tsx`, which is untouched (Q61).

**A trap worth the next session's five minutes.** `test/worker/apply-migrations.ts` says "each
test's isolated D1 snapshot" and the pool's `isolatedStorage` defaults to `true`, so it is natural
to assume worker tests start clean. **They do not** — probed with a two-test file: the second sees
the first's `UPDATE`. Four of this session's gate tests failed on inherited state and read exactly
like an authorisation bug. Filed in `docs/plan_parity.md` §9.
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
