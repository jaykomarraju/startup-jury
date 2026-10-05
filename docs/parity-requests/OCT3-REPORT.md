# OCT3-REPORT — the jury's evaluation report: issues 17, 18, 19

*3-Oct-2026 tester table, rows 17–19. Shared checkout on `main`, four sibling lanes editing
other files at the same time. Owned paths: `src/client/components/EvaluationReport.tsx`,
`src/client/components/EvaluationDrawer.tsx`, and the tests covering them. No migration, no
server change, no e2e / Playwright / roles harness (the box is load-sensitive and a full run
shows the siblings' half-finished edits as this lane's failures).*

---

## 1. The gate

| Check | Result |
|---|---|
| `npx tsc -p tsconfig.json` | clean for both owned files |
| `npx tsc -p tsconfig.worker.json` | clean for both owned files |
| `npx eslint` on both owned files + the test | clean |
| `npx vitest run --project client reportV3` | **22 passed** (was 15) |
| the other client specs that mount either component — `evaluateW7d`, `evaluateScoring`, `components`, `allDecks`, `callsPage`, `assign` | **166 passed**, untouched |

Each of the five behaviours added was negative-controlled — fix reverted, new test watched fail,
fix restored. What was reverted and what broke:

| reverted | failures |
|---|---|
| `showTotals={incubator}` → `{false}` | 4 — issue 17, the roll-up fallback, the no-split control, the blind-scoring control |
| `showAvg` → `false` | 3 — issue 17 (its Avg. cell), issue 19, the roll-up fallback |
| `incubator` → `true` (edition gate removed) | 1 — the VC control, which then grew both |
| `columnTotal`'s cell fallback removed | 1 — the no-roll-up column read "—" |
| `aiWeightPct ?? 50` (guessed split) | 1 — the no-split control, which then drew an Avg. |

---

## 2. Which surface the jury actually sees

Four components render a per-parameter table with AI / my-score / average columns. They are
**not interchangeable**, and only one is reachable from the screen the tester named:

| surface | columns today | reachable from |
|---|---|---|
| `EvaluationReportModal` (`EvaluationReport.tsx`) | Parameter · Weight · **one column per evaluator** | `jassigned` (**the jury's Assigned screen**), `jurypipeline` (its "Evaluated"), `assign`, `introcalls`, Dashboard, IC vote, VC ×2 |
| `EvaluationDrawer` | Parameter · Weight · AI · My score · ⌄ + **Weighted total** | Dashboard, `CallsPage`, `StagePage` — **never** `jassigned` |
| `EvalScorecard` (the workbench) | Parameter · Weight · AI · My score · **Avg.** | the workbench on `evaluate` / `jassigned` |
| `ScoreBars` / `ParamSparkline` | roll-ups, not a matrix | — |

`App.tsx:121` routes the jury-exclusive `jassigned` slug through `EvaluatePage`, which imports
`EvaluationReportModal` and **not** the drawer. So:

* **the modal is the surface issues 17 and 19 are filed against**, and it is the one changed here;
* the drawer was never the complaint — it has carried a `Weighted total` row all along
  (`EvaluationDrawer.tsx:463`), which is part of the "what appears all over the platform" shape
  the client is comparing the modal against;
* the workbench already has the `Avg.` column (`EvalScorecard.tsx:111`, `scoreHeaderLabels`) —
  it is the modal that never grew one.

---

## 3. Issue 17 — the Weighted total row

> *"In the Assigned screen, at the end of core parameters the weighted total is missing. The
> weighted total should appear for AI, My SCORE and Average score, which is what appears all
> over the platform."*

Real, and purely presentational. **Every number already exists.**

The prototype row being copied is `AISJ_IC_Jury_V4.html:7058` (`jr-ptot`):

```html
<tr class="jr-ptot"><td>Weighted total</td><td class="c">100%</td>
  <td class="c" style="color:…">aiTot</td>…<td class="c" id="jr-mytot">–</td>
  <td class="c" id="jr-avgtot" data-ai data-jury>–</td></tr>
```

and the repo's existing one is `EvaluationDrawer.tsx:463-472` — same label, same weight-sum
cell, same per-column composites. The modal now draws it at the end of the **Core Parameters**
tab only, `data-testid="report-weighted-total"`.

Per-column composite: `GET /api/decks/:id/report` already puts `evaluations.weighted_total` on
each column (`decks.ts:1754-1763`), and `ColumnHead` was already printing it in the *header*.
`columnTotal()` prefers that value and falls back to the weight-average of the cells on screen,
because the route sources columns from `evaluations` **and** from `scores` independently
(`decks.ts:1745-1749`) specifically so an evaluator with one and not the other still earns a
column — a column with cells and no roll-up is a shape the route deliberately emits.

One deliberate deviation from the prototype: the weight cell sums the rows rather than printing
a hardcoded `100%`, because the admin console's Scoring framework lets the 13 weights add up to
something else and `weightTotalMessage` exists to say so. The drawer already does this.

## 4. Issue 19 — the Avg. column

> *"Av. Score Column is missing in the eval report."*

Real. Added as the last column of the core table, header exactly the prototype's `Avg.`.

**What "Avg. score" means on this platform** — not invented here:

* `CallsPage.tsx:1554` — `{ header: "Av. Score", render: (r) => <BandScore value={r.deck.decisionScore} /> }`
* `StagePage.tsx:312` · `DashboardPage.tsx:411,418,445` · `IcVotePage.tsx:221` — all the same field
* `admin/ScoringFramework.tsx:264` — "The blended **Avg. score** these decks are judged on"
* `EvalScorecard.tsx:176` — the per-parameter cell: `blendScore(ai.value, value, aiWeightPct)`

So the cell computes through `decisionScore(ai, humans, aiWeightPct)` — the one helper the deck
list, the shortlist floor (`decks.ts:362`) and the pipeline transition (`pipeline.ts:343`) all
blend with, so the number beside a parameter cannot disagree with the "Avg. score" column on the
screen behind it.

Two decisions worth keeping:

1. **Blended over the columns ON SCREEN, never from `deck.decisionScore`.** That field averages
   every human evaluation on the deck, including the peers the issue-21 hierarchy filter and the
   `jurySeesPeerScores` toggle withheld from this viewer. A number derived from a withheld score
   still discloses it. For an unrestricted viewer the two agree — same formula, same inputs.
2. **No split in the payload → no Avg. column.** `aiWeightPct` rides in on the report's own deck
   block (`toDeckView`), so it costs no extra request and is the split *this* deck is judged at
   (its cohort's → its programme's → the org's, V4-WEIGHT / 0074). Falling back to a guessed
   50:50 would show an evaluator a different Average from the one the server judges them on,
   which is the W7-A hint-vs-transition defect client-side. `EvalScorecard` takes `aiWeightPct`
   as a *required* prop for exactly this reason; this is the same rule, expressed as "no number
   rather than a wrong one". The split is named on the column's tooltip and in the footer.

### The prototype conflict, and how it was resolved

`AISJ_IC_Jury_V4` draws `Avg.` **only** at the intro stage (`__introCols`), and
`AISJ_SuperuserV3` deletes it outright — which V3-REP measured, applied, and *pinned* in
`test/client/reportV3.test.tsx` (`V3_DELETED_COLUMNS = ["Jury Avg.", "Avg."]`). The tester now
asks for it at every stage. Per the Aug-2026 issue-log rule — **where an issue and a prototype
disagree the issue text wins and the prototype supplies the visual detail** — the column is back
for the modal, with the prototype's literal header.

What stayed deleted: **`Jury Avg.`**, a column holding other jurors' mean. The report already
widens one column per evaluator (issue 20), so that column would be a second, worse rendering of
data already on screen. The test now pins `Jury Avg.` as gone and `Avg.` as present, instead of
pinning both as gone.

## 5. Issue 18 — Reject / Shortlist — **CROSS-LANE, not changed**

> *"Reject/Shortlist buttons should be deleted. Not required since the below threshold levels are
> indicated automatically… Juror is always an external guy."*

The complaint is real and the buttons are reachable exactly as described, but **neither owned
file renders them**:

```
$ grep -n "Shortlist\|Reject" src/client/components/EvaluationReport.tsx \
                              src/client/components/EvaluationDrawer.tsx
(no matches)
```

They live in **`src/client/routes/EvaluatePage.tsx:927-955`**, passed as the `actions` prop to
`EvalScorecard` — unconditionally, for every role:

```tsx
actions={<>
  {selected.shortlistMin !== undefined && (<span …>Shortlist minimum …</span>)}
  <button type="button" className="tbb"    disabled={busy} onClick={() => decide("reject")}>Reject</button>
  <button type="button" className="tbb pr" disabled={busy} onClick={() => decide("shortlist")}>Shortlist</button>
</>}
```

A juror reaches them by clicking a startup name on `/app/jassigned`:
`JuryAssignedTable`'s name cell → `onOpen(deck)` → `openDeck` → the workbench with those actions.

**It is not cosmetic.** `src/pipeline/incubator.ts:113-126` grants the transitions to the jury:

```ts
{ from: "jury_evaluation", to: "shortlisted", action: "shortlist", roles: ["jury", "program_manager", "admin", "superuser"] },
{ from: "jury_evaluation", to: "rejected",    action: "reject",    roles: ["jury", "program_manager", "admin", "superuser"] },
```

So the client's statement is a **permission** change, not a layout one, and closing it properly
is two edits in two other lanes' files:

1. `EvaluatePage.tsx` — render `actions` only for a role that decides. `juryAssigned` already
   exists on line 161 (`edition === "incubator" && role === "jury" && navId === "jassigned"`),
   but gating on *that* leaves the buttons for a juror who reaches the workbench from `evaluate`,
   so the gate should be the **role**, not the slug.
2. `src/pipeline/incubator.ts` — drop `"jury"` from both `roles` arrays, or the server still
   accepts the transition from a juror who calls it directly. This is a role-boundary leak of the
   recurring class: enforce server-side and run the negative control.

Both need their own negative control (a PM must keep both buttons and both transitions —
"It is the prerogative of the Incubator to take a final call"), and `e2e/evaluate-workbench.spec.ts`
and `e2e/evaluate-v3.spec.ts` both drive `/app/jassigned` and will need checking.

## 6. Deliberately NOT changed

* **The drawer's Weighted total row has no Average cell.** It is pinned to v3's five columns by
  `V3_CORE_HEADERS`, it is mounted on `CallsPage` which serves the out-of-scope VC edition, and
  it is **not reachable from the Assigned screen** issue 17 names. If the tester meant the drawer
  (it is reachable from the jury's *Evaluated* screen, `jurypipeline` → StagePage), the same
  `decisionScore` call drops into `EvaluationDrawer.tsx:463` behind an `edition === "incubator"`
  check — one line and one test. Left out rather than guessed at.
* **The role sections (Addl. parameters tab) get neither.** Every additional parameter is seeded
  `weight = 0` (migration 0013) because they do not enter the composite, so a *weighted* total
  there would be zero-over-zero; the drawer's `custBlock` prints "Average of my scores" instead,
  which is the right shape for that table and is already there.
* **Nothing was renamed to "My score".** The modal's convention is one column per evaluator by
  name (issue 20), which the tester's "My SCORE" describes rather than prescribes.

## 7. Why the change is gated on the edition rather than a prop

`EvaluationReportModal` is mounted at **nine** sites across seven route files — `StagePage`,
`CallsPage`, `EvaluatePage`, `AssignPage` ×2, `DashboardPage`, `IcVotePage`, and
`VcEvaluatePage` ×2. The last two are the VC edition, out of scope since 2026-10-01, and none of
the seven route files is this lane's. A prop would be the cleaner API and should replace this
when one of those files is next opened; today the only change that fits in the lane is a check
inside the component, so it reads the viewer's edition from `AuthContext` and leaves VC rendering
byte-for-byte as it is. `test/client/reportV3.test.tsx` has that as an explicit negative control
(a `vc` viewer gets four headers and no total row).
