# S2-UPLOAD — handoff

**Session:** the screening-logic wave, S-2. `docs/plan_screening.md` §7.7.
**Closes:** feedback **row 2** — delete the "Mark incomplete" button from "Review uploaded decks",
*"not required since we have automated this part"*.
**Owned and changed:** `src/client/routes/upload/ReviewScreen.tsx` ·
`src/client/routes/UploadPage.tsx` · `src/client/routes/upload/types.ts` ·
`test/client/upload.test.tsx`. Nothing else. **No migration.** No `src/server/**` and no
`DashboardPage.tsx` — see §3 and §4.
**E2E:** `docs/parity-requests/s2-upload.patch`, `git apply --check` clean at `fb49499`.
`e2e/` is untouched in this branch.

---

## 1. What was deleted, and what it was not

The button lived at `ReviewScreen.tsx:318-331`. Its handler
(`UploadPage.tsx:459-462`) toggled `StagedDeck.markedIncomplete` — **browser-only staging state
that reached no route and touched no column.** One writer, no reader outside this one screen. It
is now gone from the type rather than pinned to `false`.

**It was never the server's `flag_incomplete`.** That is a real pipeline transition,
`manual_review -> incomplete` (`src/pipeline/incubator.ts:56-62`), and **nothing in this session
touches it.** §3 establishes where it stays reachable from.

Five things the deleted flag alone drove, all removed with it rather than left as chrome that can
never fire:

| Was | Now |
|---|---|
| the `"Marked incomplete"` filter option (`ReviewFilter`, `FILTER_LABELS`, `matchesFilter`) | the dropdown is **three** options: All decks · Ready to upload · Uploaded |
| `{excluded} marked incomplete (excluded)` in the footer (`:92`, `:195`) | gone; the summary reads `N decks ready to upload · Cost …` |
| the row's `Incomplete · N areas` badge (`:306-310`) | **merged into the surviving AI-Incomplete badge** — see §2 |
| `isUploadable`'s `!d.markedIncomplete` term | a staged deck is uploadable on its file and issues alone |
| the Preview's `"Marked incomplete — this deck will be excluded…"` banner and its `Incomplete` status word | gone; the banner keeps its three real causes (issues, upload error, intake flag) |

The sub-heading also lost the control it promised: *"Select decks to confirm upload · mark any
incomplete · then click Upload"* → *"… · preview each · then click Upload"*.

## 2. The three stranded things, decided

**(a) `isUploadable`** — the flag was the only way to hold a staged deck back from the AI batch.
**Decision: unticking the row is now that way**, which is what the checkbox was always for. The
staged `issues` still hold a deck back on their own. The cost-preview test was rewritten to prove
exclusion by unticking rather than by the deleted button.

**(b) `isFlaggable`** — now `d.deckId && intakeStatusOf(d.deck) === "incomplete"`, so "Parameters
needing response" opens **only for a deck the AI itself landed at `incomplete`.** Per the plan
this is the **intended** consequence, not a regression: it is precisely the automation the client
is invoking. §5 is about the one place that intent has a cost.

**(c) two judgement calls the plan left open, both commented in the file:**

1. **The flagged-area count moved rather than died.** Two badges said "Incomplete": the deleted
   flag's, which carried `· N areas`, and the AI's, which was plain. They are now one badge, the
   AI's, carrying the count. `flagged` is `Object.keys(d.flags).length`, and flags are still
   settable — on exactly the decks the surviving badge marks. The counter can still fire, so it
   was kept, on the row that can now host it.
2. **The "a query needs the deck on file" note was re-gated, not deleted.** The plan says keep it;
   its gate was `markedIncomplete && !deckId`, an intent the operator can no longer express.
   Re-gated on `!deckId && (issues.length || intakeFlag || uploadError)` — the same three signals
   the row's `⚠ Review` badge reads. It answers the question a *warned* staged deck raises and
   stays silent on a clean one, rather than captioning every staged row with an answer to a
   question that row does not ask. Both halves are asserted.

## 3. `flag_incomplete` — established before the deletion, as asked

**It survives, and it stays operator-reachable from the Dashboard row menu.** Traced in full:

- `src/pipeline/incubator.ts:56-62` — `manual_review -> incomplete`, action `flag_incomplete`,
  label **"Flag incomplete"**, roles PM / PA / admin / superuser.
- `src/server/routes/decks.ts:206-212` — `actionsFor` maps **every** `allowedTransitions` entry
  into `DeckView.actions`; it filters nothing.
- `src/client/routes/DashboardPage.tsx:1464-1466` — the row's Actions `<select>` is a
  **blacklist**: `V3_EXCLUDED_ACTIONS` (`:1325`) withholds only `assign_jury` and
  `complete_signup`, plus `archive`, which is drawn separately.
- A deck gets to `manual_review` from the same menu: `send_to_review` on a `pending_ai` deck
  (`incubator.ts:41-48`).

So today a PA can make a hand-flagged Incomplete deck in **two clicks from the Dashboard** — the
exact thing row 2 says is automated. **Deleting the upload button without withholding the action
just moves the capability.**

### The one-line ask for S2-DASH

> Add `flag_incomplete` to `V3_EXCLUDED_ACTIONS` at `DashboardPage.tsx:1325`.

**Not done here, by ownership.** `DashboardPage.tsx` is S2-DASH's file and was not opened for
writing in this branch. It is already written into their prompt
(`plan_screening.md:739`, item 1) — this note is the confirmation that the verification behind it
holds at `fb49499`, unchanged by S0-VOCAB.

**Withholding the menu option does not disable the transition, and must not.**
`POST /api/decks/:id/queries` fires `flag_incomplete` *automatically* when the deck is at
`manual_review` (`src/server/routes/pipeline.ts:786-796`, note `'Query raised'`). That is the
flow diagram's own `Manual Review → Incomplete → Query founder`, and it is the automation the
client means. The exclusion belongs in the client's option list only.

## 4. Second-order effect: the comment that outlives its reason (for S-INT)

The prompt asked for this as a note, not a fix. It is **sharper than "the justification thins"**,
and S0-VOCAB has already carried it into the new code:

`v3StatusKey`'s fall-through arm (`deckStats.ts:587-589`) and `screeningStatus`'s `D` doc block
(`deckStats.ts:1078-1091`) both justify reading an absent `aiComplete` on an `incomplete` row as
`¬D` by naming **"the MANUAL `flag_incomplete` route — a human called the deck incomplete"**.

**The code stays correct. The wording stops being true.** Once S2-DASH withholds the option, no
human can fire `flag_incomplete`; but the arm is still load-bearing, because the **automatic**
firing at `pipeline.ts:786-796` writes no intake list and runs no model, producing a deck with
`aiComplete` absent and `missingFields` empty — exactly the shape the exception describes. Deleting
the arm would still ship a new defect, as S0-VOCAB's comment says.

**Ask:** reword both comment sites from *"a human called the deck incomplete"* to *"a query raised
on a deck in manual review"*, and drop the word **MANUAL**. Two comments, no logic. Neither file is
mine; `deckStats.ts` is S0-VOCAB's and is now merged, so this is S-INT's to land.

## 5. The e2e patch, and the one real cost of (b) — read this before applying

`docs/parity-requests/s2-upload.patch` touches `e2e/upload.spec.ts` and `e2e/vc-intake.spec.ts`.
**It is not a two-line pin removal, and it should not be turned into one.**

Both specs used the deleted button as **the only way to open the flag panel**, and then walked
flag → Send to Query → "the query really exists". After row 2, `isFlaggable` needs a deck the AI
landed at `incomplete`. **Neither spec's dev server has `ANTHROPIC_API_KEY`** — `upload.spec.ts`
asserts *"AI key missing or rejected"* at `:116` — so `intakeStatusOf` returns `"awaiting"` and no
deck of theirs ever leaves `pending_ai`. **The panel is unreachable in that environment by
design.** Deleting the click line alone would leave eight lines asserting a panel that can never
appear; and it cannot be repaired from the spec side either, because `UploadPage`'s AI poll stops
once `aiState === "failed"` (`UploadPage.tsx:377-397`), so a server-side transition would not
refresh the staged row.

**What the patch does instead**, in both specs:

- asserts **`Mark incomplete` has count 0 and `up-flag-panel` has count 0** — row 2 proved in a
  browser, and a standing note so a future session does not read the panel's absence as a bug;
- **keeps the `/app/query` role-boundary walk**, which was reached through the panel's
  "View in Query →" link and is the one thing here only a browser can prove. `upload.spec.ts`'s
  link sweep still receives `/app/query`;
- renames `upload.spec.ts`'s test, which said *"sends it to Query"*.

**The coverage was replaced before it was removed — all of it inside my own file:**

| The deleted e2e assertion | Where it lives now |
|---|---|
| the panel opens on an Incomplete deck | `test/client/upload.test.tsx` — "opens for a deck the AI landed at Incomplete, with nothing clicked first", plus the two negative cases (still reading / found Complete) |
| flag an area → Send to Query → the query exists with the right letter | **"raises the founder query end to end, with no Mark incomplete anywhere in it"** — a real upload through `UploadPage`, the AI verdict handed in via `GET /api/decks`, then asserts the actual `POST /api/decks/deck_uploaded/queries` body contains `• Traction & Validation (absent)` |
| `POST /api/decks/:id/queries` itself | `test/worker/pipeline.test.ts:189-318` (incubator) and `:508-517` (VC partner) — untouched |
| the letter's wording | `test/unit/uploadReview.test.ts:153` — untouched |

The new seam test needed one stub addition: `GET /api/decks` now answers `{ decks: pollDecks }`
with `pollDecks` empty by default. That is behaviourally identical to the 404 it returned before
(the poll's own `catch` swallowed it), so no existing test in the file changes.

## 6. Client question — put to him with row 2, answer not needed to ship

> **Is row 2 incubator-only, or both editions?**

**Shipped for BOTH**, per the plan's instruction, and deliberately: the button lived in the shared
`ReviewScreen`, `e2e/vc-intake.spec.ts:191` shows the VC edition drove it too, and *"not required
since we have automated this part"* is not an incubator-only statement. Keeping it in one edition
only is the harder thing to explain. **Reversible in one place** if he says otherwise — the button
and its three dependents are one component, so an edition gate would go on `DeckRow` alone.

## 7. Gate

`npm run typecheck` · `npm run lint` · `npm test` · `npm run build` — **all green.**
Unit/worker/client **2593 passed, 1 skipped** (measured baseline at `fb49499`: 2587 passed,
1 skipped; **+6 tests, 0 moved red**). `test/client/upload.test.tsx`: **29 → 35**.
`npm run test:e2e`, `playwright` and `npm run roles` were **not** run, per the prompt.
No new file was added under `src/client/routes/`, so the vite-dev filename-collision trap
(HANDOFF.md) is not in play.
