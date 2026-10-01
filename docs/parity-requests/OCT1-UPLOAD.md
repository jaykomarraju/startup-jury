# OCT1-UPLOAD — the upload flow's ending, and its vocabulary

**Lane:** issues 1, 2, 12, and the LABEL half of 5 (plus the client half of 4).
**Date:** 2026-10-01. **Branch:** `main`, shared checkout with three sibling lanes.

Files touched, all inside the lane:

- `src/client/routes/UploadPage.tsx`
- `src/client/routes/upload/Wizard.tsx`, `ReviewScreen.tsx`, `ResultsScreen.tsx`, `types.ts`
- `src/shared/uploadReview.ts`
- `test/unit/uploadReview.test.ts`, `test/client/upload.test.tsx`, `e2e/upload.spec.ts`

`src/shared/deckStats.ts` is **read only** here — imported, never edited.
`e2e/vc-intake.spec.ts` is **untouched**, and §4 says why it is still green.

---

## 1 · Issue 1 — the forward button said something it has never done

`Wizard.tsx`'s bottom-right button read `props.forwardLabel ?? "Go to dashboard →"`,
and for V3-UP's roles `"Evaluate & Go to Dashboard →"`. Its handler is `onReview`
→ `goToReview`, which calls no router navigate at all: it advances the wizard to
"Review uploaded decks".

The default is now **"Continue"**, which is also what the Set up wizard's own
step buttons say (`e2e/coverage.spec.ts:314`), so the product has one word for
"advance a step". `UploadPage` no longer passes a V3 string.

`isV3Up` stays live and unchanged: `v3Up` still gates `showSendToEvaluate` on the
results card, and `v3Up.ts` still records Q-P. Dropping `forwardLabel` retired
nothing.

The SECOND button in that cluster (`View uploaded details →`, shown when
`uploadedCount > 0`) is **kept**. It is not the button the tester means — the
forward button is the right-most — and it is now the only route to the results
card at all (§3).

## 2 · Issues 2 and 12 — "once upload is successful, we need to go to the dashboard"

`uploadSelected` ended a fully successful batch with `setView("wizard")`, which
put the operator back in front of the dropzone they had just finished with.

| Batch outcome | Was | Now (incubator) |
|---|---|---|
| all uploaded | back to the wizard, with a notice | `navigate("/app/alldecks")` |
| some failed | stayed on the review list | unchanged — stays, so the failures stay visible |

`/app/alldecks` is the screen titled **Dashboard** for every incubator staff role
(`nav.ts:81-99`, V3 item 18 / R1-DASH item 10a). There is no `/app/dashboard`.

On a partial failure the review screen's bottom bar changes: **"Go to dashboard →"**
becomes the right-most primary, "Upload selected decks" is demoted to a secondary
retry (the failed decks stay ticked, so it still works), and "Cancel" is dropped —
it would name the wrong thing for the decks that did upload.

## 3 · What issue 2 moved off the path, deliberately

Two things are now only reachable behind a partly failed batch, because a
successful one leaves the screen:

- **the "Uploaded decks — AI-extracted details" card** (`#up-results`). V3 item 8
  deletes it outright, so this is the direction the prototype already points.
- **`evalNote`** — "Uploaded — the AI evaluation is queued and will retry
  automatically · <reason>". A deck that uploads but whose evaluation does not
  start now shows that note to nobody on the success path. It is not a silent
  loss: the note's own last sentence says "You can re-run it from All decks",
  which is exactly where the operator is sent. **Flagged rather than fixed** —
  surfacing it on the Dashboard would be the Dashboard lane's change, not this
  one's.

## 4 · Issue 5 — the screen could not say the right words

`INTAKE_STATUS_LABELS` is `{complete, incomplete, awaiting}` and `intakeStatusOf`
reads `missingFields` **and nothing else**. So a deck the AI could not READ and a
deck whose FOUNDER details are missing arrive at the same word — and that word is
what the operator is asked to act on. Renaming the constant would not have fixed
it; the vocabulary had no third slot.

The lane now reads `screeningStatus` through one new pure function,
`uploadDeckStatus(deck, {gate, edition})` in `uploadReview.ts`, which returns the
label, a tone, the two completeness axes as booleans, and `flaggable`. **Eight
call sites moved**, as predicted — and two of them were the reason a one-constant
fix would have failed:

- `ReviewScreen.tsx` DeckRow badge — the words `Complete` / `Incomplete` were
  **hardcoded in JSX**, not read from the map. One badge now, reading the status.
- `ReviewScreen.tsx` DeckRow `meta`, `Preview` statusText, `Preview` Meta tone,
  `isFlaggable`
- `ResultsScreen.tsx` `PILL` record, the row pill, the `awaiting` em-dash branch
- `uploadReview.ts` `resultsSummary`, which counted one "N marked Incomplete"

`resultsSummary` now counts the two axes **separately**, and a deck failing both
is counted on both: "1 deck with incomplete contact details. 1 deck the AI could
not read." Two sentences of static copy on the results card that asserted
"marked Incomplete" were made cause-neutral rather than edition-branched.

**The gate.** `screeningStatus` requires `gate: number`. `UploadPage` reads
`config.aiGateThreshold` — OCT1-AIGATE's field, which **had landed** by the time
this was written and is declared *required* on `ConfigSummary`, so no cast was
needed. `statusCtx.gate` is `number | null`, null meaning "the summary has not
arrived". A null gate applies **no rating check** (`UNGATED = -Infinity`) rather
than silently applying five — that is the whole point of the sibling lane's fix,
and this lane does not become the fourth place a threshold is typed.

**The VC edition keeps `INTAKE_STATUS_LABELS`.** Not an omission: the thirteen
screening statuses are the incubator's by construction (`ScreeningOptions.edition`
exists for that reason, and the client's §5 matrix and §4 diagram are both his
incubator Dashboard), and VC was out of scope on 2026-10-01. The edition fork
lives in ONE pure function, so there is one place to delete when VC is rescoped.

## 5 · Issue 4's client half — Send to Query was armed on the wrong axis

`isFlaggable` fired on `missingFields.length > 0`. Per the spec's §1 tree that is
the branch where **Query is disabled** ("Incomplete contact · Edit, Archive
active · Query + Assign disabled"); Send to Query is armed on the DECK axis
("Incomplete deck: Send to Query active", settled against the §5 table in §3
note 1). Re-armed on `aiComplete === false` with contacts intact — and on that
alone: **Both incomplete disables it too**, per the same tree.

One consequence worth reading: raising a query latches the deck into the
`Incomplete, Queried` sink, which is not flaggable, so the panel — and its
"✓ Sent to Query" — would have vanished under the next 4-second AI poll. The
panel's render condition is now `isFlaggable(d, ctx) || d.sentToQuery`.

The SERVER guard for issue 4 is another lane's.

## 6 · Tests, and the negative control run for each

Every one of these was negative-controlled by reverting the fix, watching the
named test fail, and restoring it. The reverts and their results:

| Control | Reverted | Reds |
|---|---|---|
| A | incubator branch back on `intakeStatusOf` | 7 unit + 5 client |
| B | `ctx.gate ?? 5` instead of `?? UNGATED` | 1 unit |
| C | `flaggable` back on the contact axis | 1 unit + 4 client |
| D | one "N marked Incomplete" banner line | 1 unit |
| E | `Wizard` default back to "Go to dashboard →" | 17 client |
| F | `navigate` removed, `setView("wizard")` restored | 1 client |
| G | `showDashboard={false}` | 2 client |
| H | VC dragged onto the screening words + the new label | 2 client |

New or rewritten tests:

- `test/unit/uploadReview.test.ts` — a new describe, 7 cases: the contact cause,
  the deck cause, both, neither, pre-AI, the gate (4.85 / 5.0 / 5.25 against a
  gate of 5, and the ungated reading), the deck-axis arming, the VC fork, and the
  two-axis banner.
- `test/client/upload.test.tsx` — a new "the end of the upload flow" describe:
  the label for four incubator roles, the VC label, the navigation on success,
  VC landing where it does today, and the partial-failure bar. The results-table
  test gained a fourth row — contacts complete, PDF unreadable — and asserts the
  bare word "Incomplete" is **gone from the screen**, not merely joined.
- The flag-panel fixtures moved to `aiComplete: false` decks, and the
  end-to-end Send-to-Query walk is driven on a **partly failed bulk batch**,
  which is the only state the product still shows that screen in.
- `e2e/upload.spec.ts` — step 3 is now `waitForURL(/\/app\/alldecks/)` plus the
  absence of the wizard button and the results card. Steps 3-4's old assertions
  and where each one went are listed in the spec's own header comment.

Totals for the lane: **unit 28/28, client 37/37**. Per rule 3, no full suite,
typecheck or e2e was run; `npx tsc -p tsconfig.json`, `-p tsconfig.worker.json`
and `npx eslint` are clean for every file above.

## 7 · Cross-lane

1. **OCT1-AIGATE's `ConfigSummary.aiGateThreshold` — DEPENDED ON AND PRESENT.**
   Read directly, no cast. If that lane's `api.ts` change were reverted,
   `UploadPage.tsx` stops compiling at one line.
2. **The auto-clarify defect dominates this lane's new words on real data.**
   All eleven production decks carry a `queries` row, so `queried = true`, so
   `isQueriedSinkCurrent` latches them and `screeningStatus` returns `queried` —
   "Incomplete, Queried" — *before* either incomplete word is reached. The
   vocabulary here is correct and the latch is upstream of it: until
   auto-clarification stops firing on decks with complete contact details, the
   upload screen will mostly read "Incomplete, Queried" too, not "Incomplete
   contact details". **Re-check this lane's screens after that fix lands.**
3. **`evalNote` on the success path** — §3, for whoever owns the Dashboard.
4. **`SCREENING_STATUS_LABELS.incompleteDeck` is the plural "Incomplete decks"**,
   which on a single row reads as "Incomplete decks · 1 area". It is the client's
   own string and `deckStats.ts` is not this lane's file, so it was not changed.
   Worth one question to him.

## 8 · Not reopened

- §3 of `docs/spec_screening_flow.md` — no decision there was touched.
- "archive and rejected are different" — `deckStats.ts` already models this and
  nothing here collapses them; `SCREENING_TONES` gives `rejected` and `archived`
  different tones, which is as close as this lane comes to the distinction.
