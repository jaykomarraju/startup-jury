# OCT2-LISTS — list membership, and the re-evaluation word

Lane: **issues 1 and 5, plus the client's screening flow of 2026-10-02.**
Files: `src/shared/deckStats.ts` · `src/server/routes/decks.ts` ·
`src/client/routes/DashboardPage.tsx` · `src/shared/uploadReview.ts` (one line, see
§5) · `test/unit/deckStats.test.ts` · `test/worker/route-partition.test.ts` ·
`test/worker/screening-status.test.ts` · `test/client/allDecks.test.tsx`.
`src/shared/queries.ts` is **unchanged** — see §2.

---

## 1 · What shipped

**Issue 1 and the flow.** His first two screening checks now narrow the two
rosters as well as the row's buttons:

| state | Assign roster | Query roster | Send to Query |
|---|---|---|---|
| incomplete CONTACT (`missing_fields` set) | off | **off** | **409** |
| BOTH incomplete | off | **off** | **409** |
| incomplete DECK (`ai_complete = 0`, contacts fine) | off | **on** | 200 |

Two halves, both in `routes/decks.ts`:

* `screened(...)` — a post-filter on `GET /api/decks?list=`, beside the AI
  gate's, keyed per edition on `SCREENING_NARROWS_LISTS` (`incubator: true`,
  `vc: false`);
* a 409 on `POST /decks/:id/send-to-query` (contact axis) and on
  `POST /decks/:id/send-to-assign` (both axes), because the marker those routes
  write is what `screeningStatus` reads as a LATCHED sink. Without the guard the
  click produced a deck the Dashboard called "Incomplete, Queried" — whitelist
  empty, row 7 — that was on no list at all. A button that creates an
  un-actionable deck.

**Issue 5.** `evaluationRuns` is served from
`COUNT(pipeline_events WHERE action = 'ai_evaluated')` and `screeningStatus`
returns the new `reevaluated` status (label "Reevaluated") when it is above 1.
No migration: see §4.

Measured on the seed: `?list=assign` unchanged at FinStack · GreenGrid · TaxPilot;
`?list=query` goes **NimbusHR → empty** (NimbusHR is `ai_complete = 0` with
`missing_fields = 'founderPhone'`).

## 2 · Why none of it is in `deckListRoute`

`shared/queries.ts` is untouched on purpose, and the reasoning is the AI gate's
from 1-Oct, re-measured. `deckListRoute` is re-entered from inside the STATUS
vocabulary (`isQueriedSinkCurrent` → `isScreeningIncompleteTile` →
`matchesV3Stat`, ~44 references), so teaching it the new rule changes what the
six stat boxes COUNT in order to fix two lists — and his own display rule is the
opposite of that: *"all decks, including archived, stay on the uploaded status
screen"*. The tiles keep counting every deck; only the rosters narrow.

The axes are `deckComplete` / `contactComplete`, now exported from
`shared/deckStats.ts` for the same reason `ratingAtOrAboveGate` was. They are
**not** `isDeckComplete` (`shared/queries.ts`), which `deckListRoute` already
applies on the Assign arm, and the difference is a real row:
`POST /api/queries/:id/respond` raises the frozen ANDed `decks.complete` to 1
without re-reading the deck and without touching `ai_complete`, and `restore`
(`archived → ai_evaluated`) then needs no model run. That deck reached the Assign
roster while its own Status pill read "Incomplete decks". Pinned in both worker
files ("a raised `complete` mark cannot carry an unread deck onto Assign").

## 3 · THE OPEN QUESTION FOR THE CLIENT — this is the important one

**Under his rule, no deck with a missing required intake field can ever be
queried, so the Query screen can no longer ask a founder for their phone number
or city.**

`missing_fields` is the whole intake checklist — founder, email, phone, city,
sector — and "contact complete" in his own §4 is exactly that column. So the
Query screen's "Parameters needing response" column loses its `detail` kind
entirely (`areasNeedingResponse` in `shared/queries.ts`: `detail` rows come only
from `missingFields`), and the clarification letter can no longer carry "we need
your phone number". The remedy his flow leaves is **Edit** — the four contact
fields are drawn on the Dashboard row.

This is the third time this contradiction has surfaced and it is the second time
it has been resolved differently:

* **1-Oct, `routes/pipeline.ts`** (`POST /decks/:id/queries`): a first cut
  refused any deck with a non-empty `missing_fields` and reddened
  `e2e/query.spec.ts` and `e2e/incubator.spec.ts`. It was narrowed to
  REACHABILITY — invalid founder email only — and the contradiction recorded as a
  question. That route still refuses on reachability alone.
* **2-Oct, here**: his flow is explicit about membership, and his own §2 FINAL
  STATUSES map agrees with it — `Incomplete contact · Both incomplete · Edited,
  incomplete contact · Rejected → Archived`. An incomplete-contact deck has never
  had "Incomplete, Queried" as a final status in his document. So the whole
  contact axis guards membership here.

The two now differ: `send-to-query` refuses the whole axis, `queries` refuses
only an undeliverable address. **That is deliberate** (membership is what he
asked about, and the narrower rule cannot be the one that guards it) but it
should be ONE rule. Ask him:

> A deck whose only gap is the city, or the phone number — do you want to be able
> to email the founder and ask for it, or should the only way to fill it in be
> Edit on the Dashboard row?

If the answer is "email them", the fix is one line here (`contactComplete` →
the reachability predicate) and §6's two e2e specs go green again.

## 4 · Issue 5 — what distinguishes a re-run, measured

`ai/evaluate.ts` writes one `pipeline_events` row per run at
`action = 'ai_evaluated'` under a fresh id, and nothing ever deletes them. That
is the counter. The four obvious alternatives are all blind to a re-run and each
was checked:

* **`evaluations`** — `evaluate.ts:1052` DELETEs the AI row and re-inserts it
  under the fixed id `${deckId}_ai_eval`. One row for two runs; asserted in
  `screening-status.test.ts`.
* **`decks.content_version`** — moves when the FILE is replaced. Neither
  necessary (a re-score needs no new file) nor sufficient.
* **`decks.ai_attempts`** — reset to 0 by a success.
* **`deck_versions`** — uploads, not evaluations.

**Placement, which is the part he left open ("i guess").** `reevaluated` displaces
only `complete` and `completeEdited`. Every other status in the machine is an
INSTRUCTION — `incompleteDeck` is why the only exit is Send to Query,
`belowThreshold` is why the only exit is Reject — and writing "Reevaluated" over
one of those deletes the reason the row's buttons are what they are. It wins over
`completeEdited` when both hold, because the edit is usually why the deck was
re-read. It **inherits `complete`'s whitelist verbatim** (`Send to Assign · Edit ·
Archive`), green tone, and sits next to `complete` in `SCREENING_STATUS_ORDER`.

Worth confirming with him: *is "Reevaluated" meant to replace the word, or to sit
beside it as a second chip?* A chip would be a composite cell again, which S2-DASH
deliberately collapsed into one sortable string — hence the status.

## 5 · The one edit outside the lane

`src/shared/uploadReview.ts` — **one line**, `reevaluated: "good"` in
`SCREENING_TONES`. `ScreeningValue` is a closed union over a `Record`, so without
it `npx tsc` fails for every agent in this checkout. It is the third of the three
maps the lane brief names. Nothing else in that file was read or changed.

## 6 · CROSS-LANE / FOLLOW-UP

1. **`e2e/query.spec.ts` and `e2e/incubator.spec.ts` will redden.** Both drive
   the API directly to query a deck whose only gap is a required intake field:
   `query.spec.ts` uploads two decks and PATCHes away `founderPhone` / `city`
   before `POST /send-to-query` (now 409); `incubator.spec.ts:85` sends
   `inc_deck_payroute`, which is `missing_fields = 'founderPhone'` (now 409).
   `query.spec.ts`'s premise — "each founder gets THEIR areas", where the area IS
   the missing detail — is void under his rule, so it needs re-pointing at a
   missing SLIDE or a weak-signal area, not a flag flip. **Blocked on §3.**
2. **`AssignPage.tsx` still DRAWS incomplete decks in column 1 of the Assign
   screen** — `visibleIncomplete.map(...)` at ~:721, greyed, untickable, with an
   "Incomplete" pill, under the assignable rows. That is literally "incomplete
   decks showing up in the assign screen" and it is the half of issue 1 a server
   filter cannot reach: the rows come from `?list=query`, so after this change
   they are the incomplete-DECK ones, which he wants off the Assign screen too.
   One `useMemo` and one `.map`. Not my file.
3. **Nothing in the client calls `POST /decks/:id/send-to-query` or
   `/send-to-assign`** — zero hits in `src/client/`. The Dashboard's two handoffs
   are still pure `navigate(...)` (`DashboardPage.tsx` ~:1872-1882). So under row 3
   **"Send to Query" is a dead end in production**: it navigates to the Query
   screen, which resolves the handed id against `?list=query` and silently drops
   an id that is not there — and an unsent deck never is. That is the one exit his
   matrix gives `Incomplete decks` and it does nothing. Needs
   `sendDeckToQuery` / `sendDeckToAssign` in `src/client/api.ts` (not my file) and
   two `await`s in `DashboardPage.tsx` (mine) — hand both to one session.
4. **`src/client/types.ts` needs `evaluationRuns?: number` on `DeckView`** (one
   line, same shape as `sendToAssignAt` at :138). The field arrives at runtime and
   `screeningStatus` reads it correctly today — `ScreeningDeck` has every field
   optional — so this is for the type, not for the behaviour.
5. **`test/client/deckHandoff.test.tsx`'s mock no longer matches the server.** Its
   `listDecks` stub partitions with `deckListRoute` alone, so it still hands the
   Assign screen a deck (PAYROUTE: `missingFields: ['founderPhone']`) that
   `?list=query` now withholds. Green today; the fixture is simply no longer a
   model of the response.
