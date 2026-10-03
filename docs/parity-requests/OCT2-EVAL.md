# OCT2-EVAL — "evaluators cannot score" (issue 6)

**Lane:** `src/client/components/EvalScorecard.tsx` · `src/client/components/EvaluationDrawer.tsx` ·
`src/client/routes/EvaluatePage.tsx` · tests covering them. Shared tree, `main` @ `be5b62b`.

Tester, 2-Oct-2026, two rows with one symptom:

> Jury member — My score — *Not editable. Unable to score the deck. My score column is inactive*
> Prog Manager — My score — *Not editable. Unable to score the deck. My score column is inactive*

---

## 1. The headline: nothing is disabled, and no role is blocked

The brief's hypothesis was right — two different roles with the same symptom is not a per-role
permission bug. **Measured, the scoring inputs are editable for both roles.**

`test/client/evaluateScoring.test.tsx` opens the workbench as `jury` (from `panel-jassigned`, their
only nav slug) and as `program_manager` (from `/app/evaluate`), and for every parameter asserts
`input.disabled === false`, `input.readOnly === false`, then types a score and reads it back. Both
roles pass, and **Submit my evaluation** enables once every parameter carries a value.

There is no `disabled`, no `readOnly`, no `can(edition, role, "evaluate")` test and no `assigned_to`
test anywhere near `ScoreRow`'s input (`EvalScorecard.tsx:218-235`). The only gate on the whole
surface is the submit button's `disabled={busy || !allScored}` (`:558`) — the spec §8.1 "score all 13
first" rule, which is role-blind and clears itself.

**`EvalScorecard.tsx` is unchanged by this session, because it was not the defect.**

### 1a. 1-Oct's `inert` / `hidden` change did NOT cause this

The brief flagged it as the likeliest regression and invited me to name it. It is not the cause.
`inert` is on the **list panel** (`EvaluatePage.tsx:592`) and the workbench is its **sibling**, not
its descendant — it opens after that `</div>` closes. React 19 handles `inert` as a real boolean
prop, so `inert={false}` is not rendered (the React 18 `inert="false"` trap does not apply here).

Asserted, not reasoned: `openAndScore` checks `dialog.closest("[inert]")` and
`dialog.closest("[hidden]")` are both `null` while the workbench is the only thing open. This is
checked **on the DOM** on purpose — `fireEvent` types happily into an `inert` subtree, so a
keyboard-shaped test would have missed a real regression. Controlled by forcing `inert` onto the
workbench's own wrapper: 7 of 11 tests fail. Controlled the other way by forcing
`inert={true}` on the list panel: all 11 still pass, which is the sibling relationship stated as a
measurement.

## 2. What the client actually saw — and this part IS a defect

Three "My score" columns exist in the product. Exactly one is read-only, and it is the one every
screen **other than** Evaluate opens when you click a startup's name: `EvaluationDrawer`.

It is titled **"Evaluate — {deck name}"** (`:224`). It carries a **My Score** tile reading `–`
(`:335`), a **My score** column of dashes (`:403`), a second one in *My parameters evaluation*
(`:612`), and — directly above the dead column — the hint *"tap any parameter to read the AI remark
**and add yours**"* (`:387`). Expanding a row shows *"My remarks for this parameter"* as static
text, with no field.

Every one of those strings is correct **in the prototype**, where that overlay has editable My-score
inputs and its own *Save draft* / *Submit my evaluation* bar. The build made the overlay read-only
(one scoring surface — `EvalScorecard` owns the score scale, the override-rationale rule and the
submit; there is no draft state to save to — F0195, plan §8) **and kept the prototype's copy**. So a
juror or a PM lands on a screen that calls itself Evaluate, tells them to add their score, and has
no way to.

`reportV3.test.tsx` pins the hint, both tile labels, the five column headers and the four section
titles verbatim against `AISJ_SuperuserV3`, so none of that copy may move.

**Shipped:** an additive paragraph under the Parameter evaluation table —

> **My score is read-only on this report.** Scores and per-parameter remarks are entered in the
> evaluator workbench on **Evaluate**, which opens a deck for scoring once it has been assigned for
> evaluation.

A `<p>`, deliberately not another `<h3>`: `reportV3`'s first test collects *all* level-3 headings in
the dialog and compares the list, in order, to the prototype's four.

**Still open for the client — §4 below.** Whether the prototype's editable report should be built is
a design decision, not a bug; this makes the current screen honest, it does not answer the question.

## 3. The other half of "unable to score": a refused submit said "Try again"

`POST /decks/:id/evaluate` refuses for three reasons an evaluator can act on, and the action differs
for each:

| Refusal | Status | Carries a written `message`? |
|---|---|---|
| `rationale_required` | 422 | yes |
| `no_pdf` (the F-FOUL deck-file guard, `pipeline.ts:545`) | 409 | yes — *"X has no uploaded deck, so it cannot be scored."* |
| `not_assigned` (juror not on the roster, `pipeline.ts:530`) | 403 | **no** |

`reportScoreError` special-cased `rationale_required` and collapsed everything else to **"Couldn't
submit your evaluation. Try again."** For the other two, retrying can never work — the evaluator sat
on a screen that said their scores would not save and would not say why. That is "unable to score
the deck", literally, and it is the same defect 1-Oct fixed on the Upload screen.

**Shipped:** the rule is now general rather than a list — print the server's own words whenever it
sent any (`err.body.message`), name `not_assigned` (which sends none), and keep the generic fallback
for a failure that is not an `ApiError` at all. Four tests, each negative-controlled.

## 4. For the client — one question, one consequence

**Q-EVAL-1. Should the report overlay be editable, as the prototype draws it?**
The prototype's `openReport()` has My-score inputs, *Save draft* and *Submit my evaluation* on the
overlay that opens from every screen. The build has one scoring surface instead. Honouring the
prototype means a second write path that must re-implement the score scale, the override-rationale
rule and the submit guard, plus a draft store that does not exist (F0195) — and two surfaces that
can disagree about the same deck. **Recommendation: keep one scorer, and keep §2's note.** If the
answer is "match the prototype exactly", it is its own session, not a flip.

**The consequence, which is NOT this lane's to fix.** Only a deck at `assigned` or `jury_evaluation`
reaches the workbench (`EvaluatePage.tsx:262`, `queue`), and a juror additionally has to be on its
roster (enforced server-side — `isAssignedEvaluator`). Production holds **1 `assigned` deck out of
17**: 7 `incomplete`, 6 `ai_evaluated`, 3 `archived`. So for the jury, and for the PM beyond that one
deck, there is genuinely nothing on the screen to score — and 1-Oct's gate post-filter on
`?list=assign` now also keeps every sub-gate deck (4.85, 4.00, 3.19, 2.66 against a gate of 5) out of
Assign, so those six can never *become* `assigned`. Two tests pin this as the reason rather than
patching it here: the PM's list reads `0 decks` and the juror's footer reads `0 decks assigned to
you` against production's deck shape. **The fix belongs to the Assign / AI-gate lane.**

## 5. Gate

`npx tsc -p tsconfig.json` and `-p tsconfig.worker.json` clean for all four files; `npx eslint` clean.
`npx vitest run --project client` over `evaluateScoring` · `evaluateW7d` · `evaluateV3` · `reportV3` ·
`allDecks` · `workbench` — 147 passed. Plus `stagePage` · `callsPage` · `vcEvaluate` · `components`
(the other `EvaluationDrawer` call sites and the VC tripwire) — 89 passed.

**VC untouched.** `EvalScorecard` has no diff, so `VcEvaluatePage`'s workbench is byte-identical;
`EvaluationDrawer` and `EvaluatePage` are incubator-only surfaces (VC has `VcEvaluatePage`). The
drawer's new paragraph names the incubator's **Evaluate** screen and is reached only from
`DashboardPage` / `StagePage` / `CallsPage`.
