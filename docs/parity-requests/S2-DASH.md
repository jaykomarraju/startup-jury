# S2-DASH — handoff

**Session:** the screening-logic wave, S-2. `docs/plan_screening.md` §7.3.
**Closes:** rows **1, 4, 5, 7** · the eleven-row status/button matrix · the composed Status
string · the STATUS column sort · the one line S2-UPLOAD's row 2 strands.
**Owned and changed:** `src/client/routes/DashboardPage.tsx` · `test/client/allDecks.test.tsx` ·
`test/client/deckHandoff.test.tsx`. Nothing else. No migration.
**Also written:** `docs/parity-requests/s2-dash.patch` (e2e, for S-INT).

**Gate:** `npm run typecheck && npm run lint && npm test && npm run build` — green.
Unit/worker/client **2615 passed, 1 skipped** (baseline after S0-VOCAB: 2572 / 1; **+43, 0 moved
red**). `allDecks.test.tsx` 35 → 58 tests, `deckHandoff.test.tsx` 8 → 9.
`npm run test:e2e`, `playwright` and `npm run roles` were **not** run, per the prompt — but the
screen itself was walked in a real browser against the seed (see §5).

---

## 1. The one structural change, and it is one defect

His §5 matrix is a **whitelist**: per status, "Active buttons: X, Y. Disabled: everything else."
`v3ActionCell` was a **blacklist** — `deck.actions` minus `V3_EXCLUDED_ACTIONS` minus `archive`,
plus two guarded navigations — so every transition the server happened to permit from the deck's
stage rendered active. That is the single reason ten of his eleven rows showed "extra active
options" against the build. **One inverted mechanism, not eleven omissions**, and every "extra
active option" in the comparison table is a symptom of it.

**Two layers, deliberately not collapsed:**

| Layer | What it is | Where |
|---|---|---|
| **Permission** | `deck.actions` — what this ROLE may do from this STAGE, computed server-side and re-checked on the way in. Nothing here widens it. | unchanged |
| **Enablement** | `V3_ACTIVE_ACTIONS: Record<ScreeningValue, readonly string[]>` — which of them his STATUS leaves active. It only ever narrows. | new, module scope |

An option is active iff **both** say yes; everything else rendered is disabled with a remark.
The whitelist is asked **first** and its reason wins, because his matrix's reason is the one he
wrote down. `Record<ScreeningValue, …>` rather than a lookup with a default, so a status added to
the union is a compile error rather than a silent "nothing is active" at render time.

The handler re-checks the whitelist as well as the two navigation guards: a disabled `<option>` is
a presentation fact and the rule is not.

## 2. The rows, one line each

| Row | What shipped |
|---|---|
| **1** | Every disabled remark now opens with **"as"**, which is the word he wrote. `:1409`'s `not available at ${stage}` → `as ${stage}` ("Send to Assign — as Shortlisted"), and the branch that emitted the bare Status word with NO prefix is **gone**: the whitelist produces the same word with his prefix ("— as incomplete contact details"), so the vocabulary is not duplicated across the two layers. Both surfaces, one place. |
| **4** | A deck with a missing founder email is refused **both** handoffs. `incompleteContact` whitelists Edit and Archive only. The test that asserted the opposite is rewritten, comment and all — see §3. |
| **5** | Send to Query is armed at `incompleteDeck` (C4 · Q4) and `incompleteDeckEdited`, and nowhere else. |
| **7** | The three sinks have an empty whitelist. `queried` and `assigned` are latched outright; `archived` keeps `restore` (§2 — his machine has no Restore, we shipped one as Aug-2026 issue 31, and his silence is not a deletion). C7's one exception: on a `noResponse` deck the option re-arms and renames itself **"Archive (no response)"**. |
| **matrix** | Sixteen rows, compiler-checked, with the five deviations marked and reasoned in place (C4, C5, C8, C6's self-cancelling "all except Archive", and `restore`). |
| **status string** | One pill, no chips. `screeningStatusLabel`'s value, `data-status` on the cell. |
| **sort** | New construction — there was no column-sort primitive in `src/client`. `aria-sort`, three-state cycle, `screeningStatusRank`, stable over the prototype's activity order. |
| **S2-UPLOAD's line** | `flag_incomplete` added to `V3_EXCLUDED_ACTIONS`. Withheld outright, not merely disabled: a disabled option still prints the name of a capability he asked us to stop offering. |

## 3. The trap, handled as instructed

`allDecks.test.tsx:1100-1124` pinned `v3SendToQuery` to do the **opposite** of row 4: on
`{aiComplete:true, complete:true, missingFields:["founderEmail"]}` it asserted Send to Query
ENABLED. The comment block written on 23-Sep to stop that block returning was documenting his
requirement as a regression. **Both were rewritten, not deleted** — the replacement test carries
the three-date history (21-Sep disabled · 23-Sep corrected · 24-Sep row 4) so the next reader is
not arguing with a ghost, and it says the thing that keeps both true: **row 4 is not a reversal of
the 23-Sep correction.** Send to Query is still guarded navigation and still armed — at
`incompleteDeck`, pinned in the next test. What row 4 narrows is his own reason for row 3: a deck
with no email address cannot be emailed. The `V3_STATUS_HINTS` tooltips that said "it is on Query,
not Assign" were rewritten for the same reason: row 3 makes that sentence false.

## 4. Three things that need somebody else, in priority order

1. **`DeckView` is missing the three fields S2-SERVER serves** — `sendToAssignAt`, `lastQueryAt`,
   `lastQueryAnswered`. **`src/client/types.ts` belongs to no session in wave S-2.** The screen
   compiles without them (every `ScreeningDeck` field is optional) and the two statuses that
   depend on them are simply unreachable until they are served, which is the safe direction. The
   tests widen `DeckView` locally (`ScreeningDeckView`) so those statuses are **pinned before they
   can be served**. **One-line addition for S-INT**, and then the local widening in the test file
   can go.
2. **The AI gate is read through a cast.** `DashboardPage` reads `aiGateThreshold` off the config
   summary it already fetches, widening `ConfigSummary` inline, and falls back to **5.0** — the
   `0082` default, so no deck's verdict moves when the cast goes. `src/client/api.ts` is nobody's
   in this wave either. One line for S-INT once S2-SERVER serves it. (`screeningStatus` takes
   `gate` as a required parameter with no fallback of its own, and that is right — a constant
   beside the setting is how this product came to have three thresholds. The fallback here is in
   the CLIENT, named for its own deletion, and the test drives the served value in both
   directions.)
3. **Row 3 takes the evaluated-but-incomplete deck off the Assign screen's column 1.**
   `isQueryStageWindow` (`shared/queries.ts`) does not contain `ai_evaluated`, so once
   `QUERY_MEMBERSHIP_IS_DERIVED_PENDING_ROW3.incubator` is `false`, a deck that was evaluated and
   then stripped of a required detail is on **neither** list — and `AssignPage`'s greyed,
   untickable column-1 rows come from `?list=query`. V4-ROUTE's "keep the marked-incomplete decks
   visible" therefore stops applying to the evaluated arm. `AssignPage.tsx` and `assign.test.tsx`
   belong to no session in this wave. **Measured, not inferred** — see §6.

## 5. Measured, not assumed

**Both my test files were run against S2-SERVER's flip.** I set
`QUERY_MEMBERSHIP_IS_DERIVED_PENDING_ROW3.incubator = false`, ran both files, fixed what moved, and
reverted. **They are now green under both readings**, which is the thing S0-VOCAB's note asked for
and is worth more than either answer:

- `v3SendToQuery` **stopped being `deckListRoute(...) === "query"`**, and this is the find of the
  session. Under the derivation, "is it on the Query list" also answered "may it be sent there".
  Row 3 deletes the derivation, so for every deck nobody has sent the answer becomes `null` — and
  the button would have gone dead at **exactly the status his matrix needs it live on**
  (`incompleteDeck`, whose only other exit is Edit-to-nowhere), in another session's one-line flip,
  with nothing in this file saying so. It now asks `QUERYABLE_STAGES` and `queried`, neither of
  which row 3 moves.
- `deckHandoff.test.tsx`'s Query-side fixtures now carry `queried`, because that is what row 3
  makes them: a deck is on the Query list because it was **sent** there. The file stopped depending
  on the wrong thing rather than being pinned to today's answer.

**The screen was walked in a real browser** (Playwright against `e2e:serve` on the real seed, 15
incubator decks). Every row's status is in his vocabulary, the header cycles
`none → ascending → descending → none`, ascending is his flow order
(`Awaiting AI evaluation · Both incomplete · Rejected · Complete… · Incomplete, Queried ·
Archived`), and the menus read as the matrix says — e.g. `SolarCircuit` (archived) offers
**Restore** and nothing else, `NimbusHR` (`Incomplete, Queried`) offers nothing at all, `Medixir`
(`onboard_ready`) reads "Archive — not available to you here" because the stage has no archive
edge.

**One thing that walk showed and no fixture would have:** on the live seed **no deck is at
`Incomplete decks`** (`¬D ∧ C`), so Send to Query is armed on zero rows today. PayRoute and
NimbusHR are both `ai_complete = 0 AND missing_fields = 'founderPhone'`, i.e. `¬D ∧ ¬C` — **Both
incomplete**, where his row 4 correctly withholds it. The state C4/Q4 argues about is real and
unpopulated. Worth a seed row before the client is shown this.

## 6. What the whitelist costs, stated rather than discovered later

Post-screening transitions the Dashboard row menu used to arm now render **disabled with a
remark**: `shortlist`, `reject`, `schedule_intro`, `send_signup`, `founder_response`,
`start_jury_eval`, `submit_for_ai`. That is his matrix applied, and **nothing becomes unreachable
in the product** — `StagePage` still offers `deck.actions` in full (minus `assign_jury`) on Jury
Pipeline and Prog-manager pipeline, which is where those decisions are taken. Verified in the
browser walk above. The one genuinely narrowed path is `founder_response` as a manual override; the
real resubmit loop, `POST /api/queries/:id/respond`, is untouched.

**One status declines to narrow, and it is the one that is ours and not his.** `awaitingAi` is C3;
his flow diagram *begins* at "Deck complete?", so there is nothing to read a whitelist off, and
narrowing it anyway would delete `submit_for_ai` / `send_to_review` / `approve_review` — real
workflow he never mentioned. `V3_PERMISSION_LAYER_ONLY` is the sentinel, named so it cannot be
mistaken for an oversight.

**One chip said something the string does not.** A deck queried long ago, answered, and since
shortlisted used to carry a "Queried" chip for good. His sink is `Incomplete, **Queried**` — sent
and not yet resolved — so such a row now reads `Complete` and its query history lives in the deck's
pipeline events. GreenRoute in the fixtures is exactly that deck, and the test says so.

## 7. Questions for the client

| # | Question | What we ship |
|---|---|---|
| **A** | **Two remarks on one row read differently, on purpose.** A shortlisted deck shows "Send to Assign — as Shortlisted" (the STAGE, from the permission layer) beside "Send to Query — as complete" (the STATUS, from your matrix). Both are true and they are different facts. Do you want one of them suppressed? | Both, with "as" in front of each. Suppressing the stage one would leave an option refused for a reason the row does not state. |
| **B** | **`awaitingAi`'s buttons.** Your flow diagram starts at "Deck complete?", so it says nothing about a deck the AI has not read yet — but that is one of your six stat boxes. Should it have a whitelist of its own? | The permission layer alone, i.e. what the screen did before. Narrowing it would delete Submit for AI evaluation and Approve for AI evaluation, which you have not mentioned. |
| **C** | **Sorting "on all stat boxes" cannot be literal.** Six of the seven share the default shape and sort; **Shortlisted has no Status column at all** (`Startup name · AI score · Avg. score · Signup status · Actions`, your own prototype's second `thead`). Add one there, or leave it? | Leave it. Six boxes sort; the seventh has nothing to sort. |
| **D** | **Restore.** Your machine has no Restore, and a literal whitelist over Archived would have removed the only way back out of it. Keeping it? | Kept, on Rejected and on Archived. Aug-2026 issue 31 is your own ask. |
