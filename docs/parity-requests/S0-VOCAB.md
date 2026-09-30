# S0-VOCAB — handoff

**Session:** the screening-logic wave, S-1. `docs/plan_screening.md` §7.2.
**Closes:** row 6 · the 13-state derivation · the Incomplete tile predicate · C1–C6, C10, C15.
**Owned and changed:** `src/shared/deckStats.ts` · `src/shared/queries.ts` ·
`test/unit/deckStats.test.ts` · `test/unit/queries.test.ts`. Nothing else. No migration.

**Gate:** `npm run typecheck && npm run lint && npm test && npm run build` — green.
Unit/worker/client **2572 passed, 1 skipped** (baseline 2541 passed / 1 skipped; +31 tests, 0
moved red). `test/unit/deckStats.test.ts` 36 → 59, `test/unit/queries.test.ts` 45 → 53.
`npm run test:e2e`, `playwright` and `npm run roles` were **not** run, per the prompt.

---

## 1. The exported surface — the contract the five S2 sessions consume

### `src/shared/deckStats.ts`

| Export | What it is |
|---|---|
| `type ScreeningStatus` | His eleven intermediates + `awaitingAi` (C3) + `noResponse` (his §7 open item). Thirteen. |
| `type ScreeningSink` | `"queried" \| "assigned" \| "archived"` — his three FINAL STATUSES. |
| `type ScreeningValue` | `ScreeningStatus \| ScreeningSink`. **The key type for every per-status map.** |
| `SCREENING_STATUS_LABELS: Record<ScreeningValue, string>` | His words. 16 entries, 16 distinct strings. |
| `SCREENING_STATUS_ORDER: readonly ScreeningValue[]` | The displayed pill set, in his §4 flow's order. 16, no duplicates. |
| `SCREENING_FILTER_OPTIONS: readonly ScreeningValue[]` | The sort/filter dropdown's list (C2). **Eleven, not six — see §4 Q1.** |
| `ROW6_PROVEN_OMISSIONS: readonly ScreeningValue[]` | The five words §2 proves his row 6 leaves out. The narrowing hook. |
| `screeningStatusRank(v): number` | Sort key for S2-DASH's new STATUS column. Unknown → last, never throws. |
| `SCREENING_SINK_TILE: Record<ScreeningSink, V3StatKey \| "assigned">` | His map's third column: which stat box each sink is counted in. |
| `isScreeningSink(v): v is ScreeningSink` | Row 7's latch predicate. |
| `interface ScreeningDeck extends StatDeck` | The inputs. **Every field optional** — see §2. |
| `interface ScreeningOptions` | `{ gate: number; now?: number }`. `gate` is **required, never defaulted**. |
| `screeningStatus(deck, opts): ScreeningValue` | The derivation. |
| `screeningStatusLabel(deck, opts): string` | The one sortable Status string S2-DASH's §7.3 asks for. |
| `isQueryUnanswered(deck, now?): boolean` | C7 — the re-arm predicate for "Archive (no response)". |
| `isScreeningIncompleteTile(deck): boolean` | C10 — the Incomplete box's new predicate. |
| `ASSIGNED_TILE_CONFIRMED_BY_FINAL_STATUS_MAP` | **Renamed** from `ASSIGNED_TILE_RETAINED_PENDING_Q7`. Q7 answered. |

`StatDeck` gains two optional fields: `queried?: boolean` and `sendToAssignAt?: string | null`.

**Still exported, `@deprecated`, behaviour unchanged:** `V3StatusKey`, `V3_STATUS_LABELS`,
`v3StatusKey`. They are alive only because their callers are other sessions' files —
`DashboardPage.tsx:1806` (S2-DASH) and `test/worker/ai-complete.test.ts:254` (S2-SERVER).
**Deleting them is S2-DASH's last step.** One test pins them meanwhile, because an untested
shim drifts.

### `src/shared/queries.ts`

| Export | What it is |
|---|---|
| `QUERY_MEMBERSHIP_IS_DERIVED_PENDING_ROW3: Record<Edition, boolean>` | `{ incubator: true, vc: true }`. **S2-SERVER's one-line flip.** See §3. |
| `deckListRoute(deck, edition, opts)` | `opts` gains `deriveQuery?: boolean`, defaulting to the above, per edition. |
| `isQueryListed(deck, queries, edition, opts?)` | Gains the same pass-through as a 4th optional argument. |

### Building an exhaustive per-status map (S2-DASH's eleven-row whitelist)

```ts
import { SCREENING_STATUS_ORDER, type ScreeningValue } from "../../shared/deckStats";
const ACTIVE: Record<ScreeningValue, readonly DeckAction[]> = { /* 16 keys, compiler-checked */ };
```
`Record<ScreeningValue, …>` is what makes a missing row a type error rather than a silent
`undefined` at render time. A unit test in my file pins that the label map, the order list and
the union agree on exactly 16 keys, so that exhaustiveness check cannot be hollowed out.

---

## 2. Derived, never persisted — and what S2-SERVER must serve

**No new column on `decks`. No new table.** All thirteen statuses and all three sinks are a
function of fields `toDeckView` already serves. Three columns are specifically NOT reused, each
because it has a live job: `decks.status` (the 13-stage pipeline, already carrying a second
meaning `routes/decks.ts:924-925` warns about), `decks.signal` (the rating band, whose
`'flagged'` value is already the incomplete marker) and `decks.complete` (redundant —
`isDeckComplete` re-derives it at read time).

**Two inputs do not exist on any row yet.** Every field on `ScreeningDeck` is optional for that
reason, and each absent field takes the reading that cannot invent a problem — so the function
is correct, not merely crash-free, on today's shape:

| Field | Served by | Until then |
|---|---|---|
| `sendToAssignAt` | S2-SERVER item 3 — the `send_to_assign` marker (`from_stage === to_stage`), one `MAX(created_at)` beside `contact_edited_at` | no deck ever reads the `assigned` sink |
| `lastQueryAt` | S2-SERVER item 4 — the latest query's `created_at` | `isQueryUnanswered` is always false, so every queried deck reads `Incomplete, Queried` and nothing is swept for a window nobody measured |
| `lastQueryAnswered` | S2-SERVER item 4 — whether it was answered | as above |

**`gate` is a required parameter and there is deliberately no fallback constant.** It becomes
`org_scoring_settings.ai_gate_threshold` (migration `0082`, default 5.0). A constant beside the
setting is how this product came to have three thresholds; the compiler now forces the wiring.
`R` is `aiScore >= gate` — **C13's `>=`**, agreeing with S2-SERVER's one-character change at
`evaluate.ts:488`.

---

## 3. Row 3 — implemented, pinned, and parked on one line. Read this before flipping it.

**The reading is not open. Only the flip is.**

`deckListRoute`'s Query arm no longer derives membership from incompleteness — three arms die
(`ASSIGNABLE_STAGES ∧ ¬complete → query`; `FLAG_STAGES` auto-listing; `areasNeedingResponse > 0`
auto-listing) and **the Assign arm is untouched**. Both readings live in the function, the new
one is fully pinned in `test/unit/queries.test.ts` ("row 3 — Query membership is a recorded
action"), and the shipped default is still the old one.

**Why parked and not deleted — measured, not assumed.** I flipped `incubator: false` and ran the
full suite twice (once per predicate revision). **29 tests across 5 files go red, and only 22 of
them are in files this wave assigns to anybody:**

| File | Tests | Owner in this wave |
|---|---|---|
| `test/client/queryPage.test.tsx` | 15 | S2-CHROME |
| `test/client/deckHandoff.test.tsx` | 6 | S2-DASH |
| `test/client/assign.test.tsx` | 4 | **nobody** |
| `test/worker/route-partition.test.ts` | 3 | **nobody** |
| `test/client/allDecks.test.tsx` | 1 | S2-DASH |

(Plus one in `test/unit/queries.test.ts`, mine, which *is* the default's own assertion and is one
line.) Deleting the derivation in this session would therefore have merged `main` with 30 failures
and no session empowered to fix 7 of them. `ASSIGNED_TILE_RETAINED_PENDING_Q7` is this repo's own
precedent for the alternative, and its history is the argument: a decided question parked on a
named constant got answered and flipped in one line — which is what this session just did to it.

**For S2-SERVER.** Set `incubator: false` (one line) in the same change that makes `?list=query`
mean "queried". Then:

- `test/worker/route-partition.test.ts` — **3 tests, and the file has no owner. Claim it or get
  it assigned before you flip.** It is V4-ROUTE's negative control and row 3 reverses V4-ROUTE's
  Query half, so it is not a fixture repair: `partitions the seed…` expects
  `["NimbusHR", "PayRoute"]` on Query and becomes `["NimbusHR"]` (PayRoute has no `queries` row;
  NimbusHR has `qry_seed_nimbus`, so it stays). `(b) blanking a required detail moves an
  evaluated deck from Assign to Query` needs rewriting as *moves it off Assign* — under row 3 it
  reaches Query only on a click. `(c)` likewise.
- `test/client/assign.test.tsx` — **4 tests, no owner.** Same ask.
- `test/client/queryPage.test.tsx` (S2-CHROME) — **15 red, but ~1 real.** Its mock routes the
  fixture list through `deckListRoute`, so the list empties and every test in the file fails
  together. Seeding `queried` on the fixtures, or passing `deriveQuery: true` in the mock, fixes
  14 of the 15 without touching an assertion. Say so in the note you send them or they will read
  15 regressions.
- `test/client/deckHandoff.test.tsx` and `test/client/allDecks.test.tsx` — S2-DASH's, 7 between
  them, already expected in their prompt.

My own file is flip-proof: the retained-reading describe passes `deriveQuery: true` explicitly,
so only the one assertion that *is* the default (`is shipped OFF…`) moves, and it is one line.

**The live defect that justifies row 3, verbatim, because it is the strongest argument for the
whole change.** `POST /api/decks/:id/queries` emails a deck with no contact details —
`src/server/routes/pipeline.ts:770-771`:

```ts
const toEmail = deck.founder_email ?? uploader?.email ?? "founder@portal.local";
```

— then mints a resubmit token and sends both to that placeholder address. `deckListRoute` put
such a deck on the Query list with no click and the Dashboard armed the button from the same
function. He is not describing a preference; he is describing this path. After the flip nothing
*arms* it, but **the path is still live if called directly** — that fix is F-FOUL's file
(`routes/pipeline.ts`), and it is S2-SERVER's ask to hand over or S-INT's to land.

---

## 4. Questions for the client — the readings I shipped and would not choose

Each is §2's reading, shipped as instructed, with the thing that made me want to ship something
else recorded instead of acted on.

**Q1 · Your six status words — we need the list itself.** §2's C2 reading is that your numbered
row 6 is the sort/filter dropdown and your matrix is the displayed pill. That is the only
reading under which both lists are true, and it is shipped. But **your verbatim six-word list is
not transcribed anywhere in this repo** — `spec_screening_flow.md` transcribes your §4 diagram
and your §5 matrix, and row 6 survives only inside the four conflict rows that quote parts of
it. The conflicts prove five words are *absent* from your six (`Both incomplete`,
`Below threshold`, `Rejected`, `Archived`, `Not AI Evaluated`); subtracting those five from the
displayed set leaves **eleven, not six**, so the remaining narrowing cannot be reconstructed.
`SCREENING_FILTER_OPTIONS` ships the eleven, which keeps every value a row can show
filterable — the property C2's own reasoning turns on. `ROW6_PROVEN_OMISSIONS` is where the
narrowing goes when you send the list. **Fallback if unanswered: the eleven.**

**Q2 · Does row 3 apply to the VC edition?** Your screening spec is the incubator's — your §5
matrix, your §4 diagram and your six stat boxes are all the incubator superuser Dashboard, and
`ASSIGNABLE_STAGES.vc` is already empty. The VC Query screen's auto-listing came from the VC
prototype instead (F0274: an unflagged deal in analyst scoring is not listed; F0341: five
working days). So the flag is `Record<Edition, boolean>`, and flipping the incubator leaves VC
exactly where it was. A single boolean would have deleted two prototype behaviours you never
asked about. **Fallback: incubator only.** The consequence of the other answer is pinned
(`does not silently rewrite the VC Query screen`) so it is measured before anyone flips it.

**Q3 · "Incomplete decks" or "Incomplete deck"?** Shipped **"Incomplete decks"**, from §3.2's
own table, which is the plan's shipped reading. Your §4 diagram writes `INCOMPLETE DECK` and
conflict C4 and question Q4 both call it *Incomplete deck*. One `s`, one string, and it is the
word on the pill — cheap to change, worth getting right once. Same family: your remark strings
are *"as incomplete"* and *"as incomplete contact details"*, which are neither of the two.

**Q4 · A deck a human flagged incomplete, where nothing recorded why.** Your machine has no such
state, but the product does: `flag_incomplete` (`manual_review → incomplete`) writes no intake
list and runs no model, so both completeness columns are absent. Read as their own `DEFAULT 1`
that is `D ∧ C` — which under your matrix is **Complete**, and would offer *Send to Assign* on a
deck an operator had just set aside. So an absent verdict on a row that says `incomplete` is read
as ¬D, and the pill says *Incomplete decks*. This is carried forward from the shipped
`v3StatusKey` rather than invented. **Fallback: as described.**

**Q5 · Decks evaluated before 21-Sep read "Both incomplete", and the cause is unrecoverable.**
Migration `0075`'s backfill is `ai_complete = complete`, i.e. the already-ANDed value, and the
migration says in as many words that the cause cannot be recovered. Under the old four words
such a deck read *Incomplete deck* whatever had stopped it; under your new thirteen it reads
*Both incomplete*, which is no more wrong and is a sharper way to notice the same missing data.
The remedy is unchanged and is one request per deck: `POST /api/decks/:id/rescore`. Pinned as a
test so it is not rediscovered as a bug.

**Q6 · Your row 7 latch also fights your own resubmit loop, and the fix is the same shape as
C7's.** Row 7 says no button is active once Send to Query has fired. Read literally that latches a
queried deck for good — but `POST /api/queries/:id/respond` moves an `incomplete` deck back to
`uploaded` and it is re-scored from there, and that is the product's *only* designed recovery from
Incomplete. A latch that outlives it strands every deck whose founder did exactly what they were
asked, which is the same class of defect as your own open item (which needs the latch broken for
the founders who did **not** answer). So `Incomplete, Queried` holds while the sent deck is
**unresolved**, and a deck that came back complete is assignable again. §2 catalogues fourteen
conflicts; this is a fifteenth, found in the code rather than in the documents, and it is
recorded rather than resolved as a preference. **Fallback: as described.**

**Q7 · Your "Contact details edited" row can be reached without any edit — and an edit that
changes nothing does not reach it.** Your matrix fires it on **Edit clicked**; our
`edit_contact` event is written only when a field actually *changed*
(`routes/decks.ts:926-927`, over a `CONTACT_FIELDS` set of exactly your four fields). Clicking
Edit and saving nothing produces our status and not yours. This is a trigger mismatch, flagged
and not guessed; it is also S2-SERVER's trap note at `ai-complete.test.ts:280`.

---

## 5. Notes to specific sessions

**S2-DASH.** `test/client/allDecks.test.tsx:661` pins archived-rows-stay-visible. It stays
green and I did not touch it — it now also needs a sortable Status on an archived row, which
`screeningStatusLabel` gives you (`archived` is in the label map and ranks last). Two more:
`ASSIGNED_TILE_RETAINED_PENDING_Q7` is renamed, so if you import it, import
`ASSIGNED_TILE_CONFIRMED_BY_FINAL_STATUS_MAP`; and sort on `screeningStatusRank`, not on the
label — alphabetical puts "AI Evaluated, Assigned" first and "Archived" second, so the two ends
of the pipeline sit adjacent and read as if archiving were a kind of assignment.

**S2-DASH, the transient.** `screeningStatus` **never returns `contactEdited`** (your I7), and a
test enumerates ten deck shapes to pin that. Your zero-button re-check lasts for the duration of
one `PATCH`, so nothing on the row can express it and nothing should — storing it would be
storing a request. The key and the label are exported; the derivation deliberately is not. Render
it from the in-flight save.

**S2-SERVER, the assigned sink is the marker and only the marker.** `screeningStatus` reads the
`assigned` sink from `sendToAssignAt` and **never** from stage `assigned` or from `assignedTo` —
pinned, because `POST /decks/:id/transition` will move a deck to `assigned` with `assigned_to`
still NULL, which is the exact shape of his row 12 Foul. The *tile* `matchesV3Stat(d,"assigned")`
takes the marker **in addition to** `assignedTo` and the two stages, because the tile means
"allocated to an evaluator" (Aug-2026 issue 4) and the sink means "the click was recorded". Two
different questions, deliberately answered differently.

**S2-SERVER, `noResponse` is inert until you serve two fields.** It is C7 — the one exemption
from row 7's latch — and until `lastQueryAt` exists every queried deck reads
`Incomplete, Queried`. That is the safe direction: no deck is swept for a window nobody measured.
The 5-working-day rule is `queryDueAt` / `QUERY_RESPONSE_WORKING_DAYS`, already in `queries.ts`
and now imported by `deckStats.ts` (that direction only — `queries.ts` does not import
`deckStats.ts`, so there is no cycle; keep it that way).

**S2-SERVER / S-INT, one import direction to preserve.** `deckStats.ts` now imports `queryDueAt`
from `queries.ts`. If tenancy or anything else adds a `deckStats` import to `queries.ts`, that
becomes a cycle.

---

## 6. What C10 actually moved, what it did not, and the defect its obvious form had

`matchesV3Stat(deck, "incomplete")` is now `isScreeningIncompleteTile` — the old three-way
`v3DeckState` answer **or** the `Incomplete, Queried` sink is current. His sink map files that
sink under the Incomplete box, and `queried` is not a stage: `POST_AI_STAGES` contains
`ai_evaluated`, so a deck queried out of the evaluated population counted under **AI Evaluated**.

**The obvious predicate — bare `queried` — is wrong, and it is worth knowing why before anyone
simplifies it back.** `decks.query_count > 0` is permanent. A deck queried months ago, whose
founder answered, which was re-scored and shortlisted, still carries it; counting that under
Incomplete was wrong by two tiles. It was caught by `allDecks.test.tsx`'s denominator test on its
**GreenRoute** row (`shortlisted`, `aiScore: 9.1`, `queried: true`) — S2-DASH's file, which
stayed green because the predicate was fixed rather than the test. His sink is
`Incomplete, **Queried**`; a deck review has picked back up is neither. Pinned in
`test/unit/deckStats.test.ts` on that exact fixture.

So the sink is current while the deck was **sent** and has not since been resolved, and only two
things resolve it — both of which are ways out the product actually has:

1. **Review picked it back up and it is assignable.** Asked through `deckListRoute` with
   `deriveQuery: false`, so "belongs on Assign" has one authority and not a second implementation.
   The flag is pinned false *here* on purpose: the question is about the Assign arm, which row 3
   does not touch, and reading the flag would make this predicate change meaning when S2-SERVER
   flips it.
2. **It advanced past screening** — Shortlisted and beyond, or Rejected.

**It is deliberately not `deckListRoute(...) === "query"`,** which was the second thing I tried.
Under the retained derivation that is true of an incomplete evaluated deck *nobody sent* — the
exact thing row 3 deletes — so it would have let the derivation back in through the status
vocabulary after taking it out of the partition. Measured, it also moved `manual_review` out of Not
AI Evaluated and reddened two of `deckStats.test.ts`'s own denominator tests.

Two more things about C10 are deliberate:

- **The stage is never moved.** The alternative — folding `queried` into `v3DeckState` — reaches
  the same partition but also moves the deprecated `v3StatusKey`, whose callers are S2-DASH's and
  S2-SERVER's files. So the sink is answered in the tile filter and the other two working tiles
  then decline it, which keeps the three **partitioning** the non-archived decks. That invariant is
  what makes the tiles sum to Uploaded, and this file's own builder comment calls breaking it "the
  one thing the tile set must not do".
- **Measured on the seed it re-counts nothing.** The only queried incubator deck is NimbusHR
  (`inc_deck_meera_incomplete`), already at stage `incomplete`. What C10 actually buys is the deck
  **waiting in the resubmit window** — `founder_response` moves it `incomplete → uploaded`, where
  it would otherwise slide into Not AI Evaluated while still being, in his words,
  `Incomplete, Queried`.

Archive-as-a-state is untouched and is now confirmed by his own words. `matchesV3Stat` answers
`archived`, then `all`, then the working tiles — the 2026-09-23 deviation from the prototype's
`else if(d.archived) show=false` — and his display rule ("ALL decks, INCLUDING ARCHIVED, always
remain on the uploaded status screen") is that deviation in his sentence. An archived-and-queried
deck reads Archived, pinned.
