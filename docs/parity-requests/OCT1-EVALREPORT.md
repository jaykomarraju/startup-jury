# OCT1-EVALREPORT — the evaluation report drew on top of the workbench (issue 3)

**Lane:** `src/client/routes/EvaluatePage.tsx` · `src/client/components/EvaluationReport.tsx` · tests
covering them. Shared tree, `main` @ `248bdf3`.

Tester, 1-Oct-2026: *"any evaluation report is smudged with an override of two reports."*

---

## 1. What was wrong

`EvaluatePage` draws two full-screen surfaces behind **independent** guards:

| Surface | Guard | Wrapper |
|---|---|---|
| Scoring workbench (`EvalScorecard`) | `{selected && (` | `fixed inset-0 z-50` + `aria-modal` |
| Consolidated report (`EvaluationReportModal`) | `{reportFor && (` | `fixed inset-0 z-50` + `aria-modal` |

`EvalScorecard`'s "Evaluation report" button sets `reportFor` and never clears `selected`, so the
ONLY way to reach the report from the workbench left both mounted: two backdrops (`bg-navy/50`
painted twice, so the dim doubles), two cards at the same layer, and two `aria-modal="true"`
dialogs. That is the smudge, and it needs no exotic click path — it is the normal route.

Everything the brief listed as "established" was verified in source and holds. One correction worth
recording: the brief read the symptom as "two DIFFERENT decks' reports". It is **one report over one
workbench**, and that alone produces the overlap. A second deck's report over the first IS reachable
— the jury Assigned table's sparkline (`EvaluatePage:602`, `onOpenParams`) sets `reportFor` to
another deck and sat in the tab order behind the open workbench — but that path needs a keyboard and
is not the common case. Both are closed below; neither is asserted as the tester's path.

## 2. What shipped

**a. The two surfaces are mutually exclusive — the workbench is `hidden` while the report is up.**
`hidden={reportFor !== null}` on the workbench wrapper.

**HIDDEN rather than unmounted, deliberately.** `values`, `comments`, `remarks` and `aiScores` are
page-level and survive either way, but `EvalScorecard` holds state this page does not mirror:
per-parameter row expansion (`EvalScorecard.tsx:172`), `rescoring` and `rescoreMsg` (`:315`/`:316`),
plus scroll position. The report is read **mid-scoring**, to settle a score — so `{selected &&
!reportFor && (` would collapse the remark rows the evaluator had just opened every single time they
consulted the report. Measured: the unmount variant passes the overlap test and fails the
state-preservation test (negative control C below).

The **HTML attribute**, not Tailwind's `hidden` utility. `hidden` and `flex` are both display
utilities, so which wins is a question about stylesheet order; the attribute is
`display: none !important` in Tailwind 4's preflight (`node_modules/tailwindcss/preflight.css:391`)
and `display: none` in jsdom's UA sheet, so it behaves identically in the browser and under test.
It also removes the subtree from the tab order and the accessibility tree, which is the half of the
defect that is not visible: exactly one dialog is on screen and exactly one is reachable.

**b. The panel behind an open overlay is `inert`.** `inert={selected !== null || reportFor !== null}`
on the content div. Neither overlay traps focus and nothing marked the screen behind them inert, so
Tab reached the deck list, the per-deck status selects and the jury table's sparkline.

Scoped to **this panel**, not to `[data-app-shell-frame]` the way `AdminConsole.tsx:178` and
`AccountOverlay.tsx:278` do it: those two are portalled to `<body>` (see the comment at
`AppShell.tsx:121`) and these two overlays are not, so marking the frame would have made the
overlays themselves inert. See §4 for what that leaves open.

**c. The z-layer is untouched, on purpose.** The brief flagged that `z-[60]` is taken by
`DeckPdfViewer.tsx:161`. No layer was needed: the workbench was the only other thing this screen
draws at `z-50` (`EvaluatePage:956` is `z-10`; `ParamSparkCell` is a plain button, not a nested
modal), and it is `hidden` whenever the report is up — so the tie is removed rather than moved.
Restacking would also have meant editing the shared component, whose layer is not EvaluatePage's to
choose.

**d. `EvaluationReport.tsx` was NOT touched.** No change to the shared component, so none of the
nine mount sites across seven routes can move — including `VcEvaluatePage`, which is out of scope.
The `aria-label` at `:245` is untouched (brief item 4).

## 3. Tests — `test/client/evaluateW7d.test.tsx`

Added to the existing file because its `mountEvaluate` harness already mounts `EvaluatePage` with
the auth, router and API doubles. New describe: *"Evaluate — the workbench and the consolidated
report are mutually exclusive"*, three tests, 28 pass in that file (25 before).

Every one was negative-controlled by reverting the fix, watching it fail, and restoring:

| Control | Reverted | Result |
|---|---|---|
| A | `hidden={reportFor !== null}` | 2 fail — "expected [2 dialogs] to have a length of 1"; `closest("[hidden]")` null |
| B | `inert={…}` | 1 fail — the deck list is in no inert subtree |
| C | `hidden` → `{selected && !reportFor && (` (the unmount variant) | 1 fail — the expanded remark row and the typed score are gone after the round trip |

Control C is the one that earns the design decision: the overlap test passes against the unmount
variant, so without it "hide vs unmount" would have been an untested preference.

## 4. Open / not done — for whoever owns these files

1. **The app shell's own top bar and rail stay in the tab order behind both overlays.** `inert` is
   scoped to this panel because these overlays are not portalled. The real fix is to portal them to
   `<body>` and mark `[data-app-shell-frame]`, as the Admin console does — that is
   `AppShell.tsx`/a portal change and was out of lane. Same gap: `PanelFrame`'s toolbar (AI
   Evaluate · Filter · Export) renders outside the content div, so it is also still tabbable.
2. **The same two-independent-guards shape exists elsewhere and was not touched.**
   `AssignPage.tsx:1022-1029` sets `reportFor` from `ParamScoresModal` without closing it —
   `ParamSparkline.tsx:79` is another `fixed inset-0 z-50 aria-modal` dialog, and
   `AssignPage.tsx:477` and `:1028` render `EvaluationReportModal` **twice in one tree**.
   `VcEvaluatePage.tsx:258` sets `reportOpen` without clearing its workbench (out of scope today).
   `CallsPage`, `IcVotePage` and `StagePage` were not checked.
3. **`EvaluationReportModal` does not trap focus and does not restore focus on close**, at any of
   its nine sites. Fixing it there is one change that moves nine screens including VC's, so it
   belongs in its own session with the VC gate thought through.
4. **The workbench has no Escape handler** (the report does). Left as-is: unchanged behaviour, and
   not what was reported.

## 5. Checks run

`npx tsc -p tsconfig.json` and `-p tsconfig.worker.json` filtered to my files: clean.
`npx eslint src/client/routes/EvaluatePage.tsx src/client/components/EvaluationReport.tsx
test/client/evaluateW7d.test.tsx`: clean.
`npx vitest run --project client test/client/evaluateW7d.test.tsx test/client/evaluateV3.test.tsx
test/client/reportV3.test.tsx` — 57 pass. No full suite, per the standing rules.

**VC:** `e2e/vc-intake.spec.ts` visits `/app/evaluate` at `:244` and `:272`, which looks alarming and
is not. `App.tsx:132` routes `evaluate` to `VcEvaluatePage` for the VC edition; `App.tsx:121` serves
`EvaluatePage` only inside `if (user.edition === "incubator")`. Both of those tests assert
VcEvaluatePage's own strings (`ev-sel-label`, "Deals at IC", "Select decks · review parameters").
Nothing in this change is reachable from the VC edition, and the shared report component was not
edited. (`EvaluatePage.tsx`'s header comment already says VC "never reaches this one" — confirmed
rather than taken on trust, because the e2e grep said otherwise.)
