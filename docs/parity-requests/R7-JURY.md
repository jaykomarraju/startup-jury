# R7-JURY — the jury's own three screens

**Branch `parity/R7-JURY`, cut from `main` @ `64feb98`** (Wave R merged, R6-SCOPE live and verified in
production). Scoped against `AISJ_IC_Jury_V4`, split to panels with
`docs/prototype/tools/split-prototypes.py`; its `ADMIN_B64` console was decoded and confirmed
irrelevant — `openAdmin()` has zero callers in the jury file, exactly as the PM/PA case in
`plan_roles_incubator.md` §2 footnote ˡ. The base64 trap fires here in the "decoding finds content,
and the content is not scope" direction.

---

## 1. What shipped

### 1a. `jurypipeline` — "Evaluated", the jury's twelve columns

`JURY_PIPELINE_JURY` in `src/client/routes/StagePage.tsx`, a **new `roleVariant` object**, not a
widening of `JURY_PIPELINE_V3`. `StagePage` applies exactly one variant per role with no composition
(`:391-394`), and the two screens disagree about the two things V3 *is* — so reusing it was never
available. §5 items 3 and 7 are binding and were not relitigated: Status survives, the legend
survives, and the two-option "Send to intro calls" select never reaches the jury.

The prototype's `<th>` set, in its order, and what each one cost:

| # | Column | Before | Now |
|---|---|---|---|
| 1 | Startup | already right | unchanged |
| 2 | AI score | already right | unchanged |
| 3 | Parameters score | absent | `ParamSparkCell` — the AI's 13 core bars, opening the report's Core tab (`jaSparkCell`) |
| 4 | Addl. Parameters Score | a *View scores* button, mislabelled "Addl. Parameter scores" | `MyAddlCell` — the viewer's three chips (`jaAddlCell`), relabelled |
| 5 | My score | absent | the viewer's own weighted total, blank until they submit (`jpOpenScores(i,'my')`) |
| 6 | Avg. score | already right | unchanged (`deck.decisionScore`) |
| 7 | Assigned date | already right | unchanged |
| 8 | Due date | absent, and not on `DeckView` | from `GET /api/assignments/mine` — **the one new route** |
| 9 | Submitted date | absent | the viewer's own `submittedAt` from the report |
| 10 | +/- Days | absent | `dayDelta` + `DeltaChip` — "-3d early" / "On time" / "+4d late" / "—" |
| 11 | Status | the DECK's stage word | `jpStatusLabel` — the JUROR's own state |
| 12 | Action | Shortlist / Reject buttons | the prototype's one `Action ▾` select, View deck first — see §3 |

Two columns the **staff** screen draws were removed for the jury only: *Jury members & status* and
*Jury score*. Neither is on the jury's prototype, because their per-evaluator number **is** "My
score" and their deck-level one **is** "Avg. score".

Also: the H1 is now **"Evaluated"** (`.jp-tb-title`), which is what the sidebar has called it since
`nav.ts` shipped the jury's `labelOverrides` — the `homeTitle`-vs-label mismatch §6 Q-B names, closed
here for this screen. The footer is `jpFoot`: `N decks · N submitted · N in draft · N pending`,
counted on the juror's own status rather than the stage's.

**The Status change has the sharpest edge in the wave.** A shortlisted deck this juror never scored
used to read "Shortlisted"; it now reads "Pending", because the prototype's column is about the
juror's obligation, not the deck's position. That is the intended reading and it is pinned.

### 1b. `jassigned` — "Assigned to me", the allocation table

`JuryAssignedTable` inside `src/client/routes/EvaluatePage.tsx` — a branch in the existing component,
not a new route, so the scoring workbench modal it launches is **completely unchanged**. This swaps
what launches the scorer, not the scorer. `jaRender`'s six `<th>` verbatim (Startup · AI Score ·
Parameter scores · Assigned date · Due date · Assigned by), the name/`sector · stage · city`
sub-line, the clickable sparkline, and `jaDecks.length + ' decks assigned to you'`.

It is gated on the **slug**, not on the role: `user.role === "jury" && navId === "jassigned"`.
`App.tsx` routes both `evaluate` and `jassigned` through this component, and `jassigned` is the only
one the jury prototype speaks for. A juror who somehow reaches `/app/evaluate` still gets the v15
surface, which `evaluate-v3` pins and which this session kept pinned.

**Not V3-UP.** `V3_UP_ROLES` / `isV3Up` were not touched and the jury is still excluded;
`PROGRAM_MANAGER_PENDING_Q_P` is untouched.

### 1c. `GET /api/assignments/mine` — the only server change

`src/server/routes/assignments.ts`. Three of the prototype's cells ask for facts `DeckView` does not
carry — Due date, Assigned by, and the deadline `+/- Days` is measured against. All three live on
`deck_assignments`, whose only previous reader was `GET /api/assignments/board`, which is
`requireRole("program_manager","program_associate","admin")` — unreachable by a juror.

The route returns **the caller's own allotment and nothing else**: the WHERE clause binds
`evaluator_id = <viewer>`, so it cannot widen R6-SCOPE. No founder contact detail, no other
evaluator's identity, no score — only when a deck was given to this juror, by whom, and when it is
due. `deck_assignments` is a whole-edition table, so a route over it that forgot to bind the caller
would hand every juror the complete allocation map; that is asserted directly, both ways.

It deliberately does **not** grow `DeckView`. `src/server/routes/decks.ts` is owned by other work this
wave, and `due_at` is per (deck, evaluator) while every `DECK_DERIVED` column today is per deck — a
shape change, not an added column.

### 1d. P2, fixed — My Pipeline was narrower than the server's scope

`DashboardPage`'s `mine` filtered `d.assignedTo === user.id`. Since migration 0058 a deck carries
several evaluators and `decks.assigned_to` is only the **first** of them, so a juror added as a
second assignee was fetched by the server (R6-SCOPE correctly returns them the deck) and then dropped
by the screen — the one deck they had been asked to score was the one they could not see. It now
reads `assigneeIds`, which is the join table's list and is already served on every row. The stale
"F0193 asks the API to scope this; until it does, the screen does" comment went with it.

---

## 2. Deliberately NOT built

### 2a. The Drafts tile stays at zero — and that is now a recorded decision

This was the third named deliverable and it is the one that did not ship. The tile itself is already
the prototype's: label, "Not yet submitted" sub-line, `var(--text-3)`, its rail row, its empty view.
What it cannot do is count, because the build has no unsubmitted evaluation to count.

`evaluations.submitted_at` is already nullable (`0001_init.sql`), so a draft needs **no migration** —
the hard rule is not what blocks this. Four server derivations read `evaluations` unconditionally and
each would be corrupted by a draft row:

1. `decks.ts:110` — `assignee_submitted` counts any row, so a draft would report the deck as scored,
   which is what `juryBucket` buckets on and what §1a's new Status column reads.
2. `decks.ts:88` — `human_avg` averages `weighted_total` over all rows, so a half-finished score would
   enter the deck's jury mean and hence `decisionScore`, i.e. the **Avg. score** column above.
3. `decks.ts:1120` — blind scoring lifts on "has this evaluator a row", so saving a draft would hand
   the juror the AI's numbers.
4. `pipeline.ts:579-591` — an `assigned` deck advances to `jury_evaluation` on any score write, so a
   draft save would fire `start_jury_eval`.

**Three of the four are in `src/server/routes/decks.ts`, which this session was told not to touch.**
Shipping the tile without narrowing all four would have made the other four tiles, the Status column
and the deck's Avg. score wrong — a worse outcome than a tile that counts nothing. The reason is now
written at `juryTiles` in `DashboardPage.tsx` and the test that pins the fallback says it is a
decision rather than a stub. `jpFoot`'s "N in draft" is 0 for the same reason, and the Status column
has no "In draft" case.

**To finish it later:** one session that owns `decks.ts` and `pipeline.ts`, narrowing all four to
`submitted_at IS NOT NULL`, plus a `Save draft` companion to `EvalScorecard`'s "Submit my
evaluation". The DELETE-then-INSERT at `pipeline.ts:560-576` already makes submit-over-draft
idempotent, so the write path is the easy half.

### 2b. The Dashboard's three literal `—` cells

`DashboardPage`'s Assigned by, Due date and Submitted to are still dashes. Due date and Assigned by
are now *available* — `GET /api/assignments/mine` serves both — but My Pipeline is a different lane
from the two screens R7 owns, its `juryOpen`/`jurySubmitted` shapes are pinned in four places, and
"Submitted to" has no concept in the model at all (F0195). Filling two of three and leaving the third
would have been the worse half-measure. Named here so the next session has the route waiting.

### 2c. The Action column's Submit / Save draft / Re-assign

See §3 — this is the question, not an omission.

---

## 3. The one question for the client, and what shipped meanwhile

**The jury's Action column offers `View deck · Submit · Save draft · Re-assign`. The build can honour
exactly one of those four, and it holds two permissions the prototype's select does not offer.**

- **View deck** — built. It is the first option, and it opens the `#jp-side` "Pitch deck" pane.
- **Submit / Save draft** — **not built.** These are *scoring*, not pipeline transitions, and the
  build's one scoring surface is the workbench, deliberately (`plan_parity.md` Q80). Firing a submit
  from a table row with no scores entered has no meaning, and Save draft has no state to write (§2a).
- **Re-assign** — **not built.** The prototype's own `jpAction` branch only toasts. The jury has no
  `assign` nav and `canAccessNav("incubator","jury","assign")` is pinned `false`, so it cannot
  navigate the way the staff cell does; it needs a request-style affordance that does not exist.
- **Shortlist / Reject** — **kept.** These are real permissions (`pipeline/incubator.ts:102`, `:109`)
  that the prototype's select does not contain. Dropping them to match the option list literally
  would silently remove two transitions a juror holds.

**What shipped: the prototype's SHAPE with the build's substance inside it** — one `Action ▾` select,
View deck first, then Shortlist and Reject. That is closer to the prototype than four buttons and
closer to the product than four options that do nothing. **Ask the client:** should Submit and Save
draft route into the workbench (open it; open it on the draft) rather than becoming a second scoring
surface, and is Re-assign a request-to-the-PM or withheld?

**A second, smaller one.** `panel-jassigned` declares no toolbar, no Status and no Action, so
rebuilding it removed the v15 screen's per-row recommendation select for the jury. `EvaluatePage:697`
is its only render site and `/app/evaluate` is not in the jury's nav, so a juror can no longer set a
recommendation. Every other role that reaches `/app/evaluate` is unaffected. Matching the prototype
is what the 2026-09-09 instruction asks for, so it shipped that way — but it is a capability the build
had and the prototype does not, and `e2e/evaluate-stage-report.spec.ts` is the test that should grow
it back if the client wants it.

---

## 4. Gate

Measured in this worktree on Node 22.23.1. The worktree's `node_modules` arrived as a **symlink to the
main checkout**, which vite's `fs.allow` rejects — 45 test files failed to collect with `Denied ID …`
and nothing else. It is an environment artifact, not a code failure; `npm ci` in the worktree fixed
it, and the numbers below are from after that. Worth knowing, because the signature reads exactly
like a broken branch.

| | |
|---|---|
| `npm run typecheck` | clean (all three projects) |
| `npm run lint` | clean |
| `npm test` | **140 files passed · 1 skipped — 2522 tests passed · 1 skipped** |
| `npm run build` | clean · `index-*.js` 1,236.04 kB (gzip 326.67 kB) |
| e2e | see below |

**e2e.** Every run was started on a drained box (`TIME_WAIT` measured first: 7, then 1, then 4) with
only one run in flight. Specs: the six the change touches (`automation`, `evaluate-stage-report`,
`evaluate-v3`, `evaluate-workbench`, `incubator`, `parameters`) plus four run as insurance
(`all-decks` for the jury's tiles, `coverage` for `/app/jurypipeline` as the **admin**, which must keep
`JURY_PIPELINE_V3`, and `pipeline-stages` + `calls` for the jury's thirteen-column intro calls,
because `CallsPage` was refactored onto the lifted cells).

**Final run (10 specs): `47 passed · 1 flaky · 1 failed`.** Every spec this branch touches is green.
The one failure is `coverage.spec.ts:133` — "VC stage screens are live across the diligence path" — a
VC route with no jury code in it, which R7 does not touch (`MyAddlCell` and `ParamSparkCell` reach
only the jury's thirteen-column `CallsPage` variant, the jury's `EvaluatePage` table and the jury's
`StagePage` config). It was run alone on a drained box, per the rule, and **passes in 3.2s**. Its
failure signature in the batch was `heading level 1 … element(s) not found` — the page never rendered
— and `TIME_WAIT` peaked at **3,936** during that run.

`coverage.spec.ts` is worth calling out on its own, because it will waste someone's afternoon: it
walks every nav slug for every role, so it **self-exhausts the port range even when it is the only
thing running** (measured alone: `TIME_WAIT` 2,785, and `1 failed · 1 flaky · 16 passed`). It redded
a *different* test on each run — `:133` in the batch, `:272` and `:254` alone — and each one passes
in some other run. That is the leak in `plan_v3_superuser.md` §12.9, not a branch defect, and fewer
workers will not fix it.

**A flake that was NOT the socket leak, and is now fixed.** The first pass came back
`37 passed · 3 flaky · 0 failed`. Two of the three were the documented miniflare signature. The
third — `evaluate-stage-report` · "a juror works a deck end to end" — was **not**, and the rule about
verifying a suspect spec alone on a drained box is what caught it: run by itself with `TIME_WAIT` at
0, the first attempt still timed out after 120s and the retry still passed in 1.9s. Playwright's
failure snapshot named the cause exactly. The test clicked the Addl. Parameters Score cell as
`getByRole("button", { name: /View scores/ })`, but "View scores" is only that cell's **empty**
state; this juror has their own three chips on GreenRoute (Barriers of entry 8.0 · Scalability 8.5 ·
Industry growth 8.5), so the moment the report matrix lands the fallback is gone and the click can
never resolve. It passed only when it beat the fetch.

The companion PM test in the same file looks identical and is **not** the same cell, which is worth
knowing before anyone "fixes" it too: `MyAddlCell` is on the jury's thirteen-column variant only, and
the staff column set draws its own "Addl. Parameter scores" as a plain, permanent `View scores`
button. That locator has no state to race. Re-pointing it at the stable name was tried, hung the PM
test, and was reverted — recorded here so the next reader does not repeat it.

The race predates R7 (`CallsPage`'s `myAddlCell` had the same two states), but the cell is now
R7's — `MyAddlCell`, which the new Evaluated table also draws — so it was fixed here rather than
left: the button carries a stable `aria-label`, and both locators name the cell instead of its
current contents. Re-run alone afterwards: **2 passed, 0 flaky.**

`e2e/parity.spec.ts` was **not** run and must not be: `EXPECTED` is owned by the integration session.
Two of its rows move, shipped as `docs/parity-requests/R7-parity.patch` — `jassigned` becomes
`{ "Assigned to me", six headers }` and `jurypipeline` becomes `{ "Evaluated", twelve headers }`.
`alldecks` does not move. `git apply --check` it at integration; R1, R3, R4 and R5 all fail that check
today because they are already in `main`, which is not a trap this wave.

---

## 5. Negative controls — every one measured, with the edit that was reverted

| Test | Production edit reverted | Result |
|---|---|---|
| `allDecks.test.tsx` · "counts a deck this juror is a SECOND assignee on" | `DashboardPage`'s `mine` back to `d.assignedTo === user.id` | **RED** (1 failed) |
| `assignments-mine.test.ts` · "sees NOT ONE row belonging to another evaluator" + 3 more | dropped the caller binding from the route's WHERE clause | **RED** (4 failed of 8) |
| `stagePage.test.tsx` · all five new jury tests | removed `jury: JURY_PIPELINE_JURY` from `roleVariants` | **RED** (5 failed) |
| `stagePage.test.tsx` · "Status is the juror's own state" + "the footer counts the juror's own statuses" | `jurorStatus` back to the deck's stage word | **RED** (2 failed, and *only* 2 — the twelve-header test stayed green, so the Status assertion is specific) |
| `evaluateV3` + `evaluateW7d` · the whole `panel-jassigned` block | `juryAssigned` forced false in `EvaluatePage` | **RED** (6 failed across 2 files) |

**One claimed control did not hold, and was corrected rather than left standing.**
`evaluateW7d` · "survives a failed assignments read" documented itself as pinning
`useMyAssignments`'s `catch(() => setRows({}))`. Emptying that handler leaves the test **green**
(measured), because `null` and `{}` both render dashes — the fallback is not observable. Removing the
`catch` outright only produces an unhandled rejection, which vitest reports but does not fail the test
on. The test is a real regression guard with a real control (the `juryAssigned` revert reddens it with
the rest of its block), so it stayed; its comment now states that accurately and stops claiming the
`catch`, and `useMyAssignments`'s own docstring says the `catch` is there to keep the rejection
handled, not to drive a different rendering. A test that passes with the bug restored is worse than no
test — so it is no longer sold as that test.

---

## 6. Shared code, for the next session

Four cells the jury draws on three of their panels were built once already, inside `CallsPage`, for
the thirteen-column intro calls table — which is why the prototype scopes `jaSparkCell` and
`jaAddlCell` to `window`. They were lifted into `src/client/routes/StageKit.tsx` and `CallsPage` now
calls them, so `StagePage`, `CallsPage` and `EvaluatePage` draw the juror's numbers from one
implementation instead of three: `ParamSparkCell`, `MyAddlCell`, `myEvaluation`, `aiParamValues`,
`dayDelta`, `DeltaChip`, `useMyAssignments`.

`StageConfig` gained `rowDetail: { reports?, assignments? }`. A screen opts in to the per-row report
(one request per row) and the caller's assignments (one per screen); a screen that does not declare it
pays nothing, so every other `StagePage` screen costs exactly what it did before. `StageContext`
gained `viewerId`, and `footer` now receives the context so it can count "my" statuses.
