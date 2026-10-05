# OCT3-STAGE — the stale pipeline stage

Lane: **3-Oct issues 10, 11, 12, 14 and 16** (and the finding behind 13).
Files: `src/server/routes/decks.ts` · `src/shared/deckStats.ts` (one comment) ·
`test/worker/stage-rejoin.test.ts` (new) · `test/worker/ai-complete.test.ts`
(one assertion reversed, see §5).
`src/pipeline/incubator.ts` is **unchanged** — see §3.

---

## 1 · One cause, five rows

Nothing moved a deck's STAGE off `incomplete` when the operator supplied what
made it incomplete. BiocharIND passed both completeness axes and scored 5.14
against a gate of 5, so its pill correctly read "Complete, Edited" while
`decks.status` still said `incomplete` — and four systems key off that stage:

| system | what the stale stage did |
|---|---|
| `v3DeckState` (`shared/deckStats.ts`) | Incomplete stat box (issues **11**, **16**) |
| `deckListRoute` (`shared/queries.ts`) | never reached the Assign roster (issue **10**) |
| `reject_ai_gate` — exists only `from: ai_evaluated` | Reject greyed, in fact **never rendered** (issues **12**, **14**) |
| `v3SendToAssign` (`DashboardPage.tsx`) | "Send to Assign — as Incomplete", disabled (issue **10**) |

`PATCH /api/decks/:id` now repairs it, where the blocking arm is lifted.

## 2 · The stage was only half of it — `decks.signal` goes stale with it

Measured, and it is the half that would have left issues 11 and 16 open:
`computeResult` (`ai/evaluate.ts`) returns `status: 'incomplete'` **and**
`signal: 'flagged'` from the SAME `!effective.complete` branch, where
`effective.complete` is the model's verdict ANDed with the intake checklist. So
a deck the model read perfectly well and scored 5.14 carries both the moment one
founder phone number is missing — and `v3DeckState` reads EITHER as
"incomplete".

Moving only the stage leaves the row in the wrong stat box. `stage-rejoin.test.ts`
pins this directly: tie the band repair to the stage and the restored-deck case
goes red; drop it entirely and two tests go red on `v3DeckState → aieval`.

The band is therefore re-derived from the score the AI already stored
(`signalTag`), and it is repaired **wherever it is still `flagged`**, not only
`from: incomplete` — because `restore` (`archived -> ai_evaluated`) and
`founder_response` (`incomplete -> uploaded`) both move a deck without
re-reading it, so a deck that already left by one of those routes sits at a
post-AI stage still carrying the contact arm's flag.

## 3 · Why (a) — the transition, and not the derivation

The ground truth offered both. (a) is what shipped:

* **(b) — stop keying the tile / rosters / whitelist on `status`** — changes what
  ~44 references to `matchesV3Stat` count in order to fix one list, which is the
  reasoning `OCT2-LISTS.md` §2 and the 1-Oct AI-gate note already settled in the
  opposite direction. Worse, it leaves `decks.status` permanently false: the Jury
  and Prog-manager pipelines, the kanban and every `pipeline_events.from_stage`
  would keep reporting a deck as Incomplete after it had been assigned.
* **(a) — move the stage** fixes all four systems with one write and leaves the
  status vocabulary untouched.

**The target stage is asked, not assumed** (the trap the ground truth names).
`repairsAfterDetails` has three shared arms and one extra on the stage:

1. the intake list is now empty — the contact axis, freshly derived;
2. `ai_complete !== 0` — the DECK axis, which is what leaves **Turaga** at
   `incomplete` where Send to Query is its one exit (§3 item 1);
3. the AI produced **rubric rows** — "it has been evaluated". `ai_score` cannot
   answer it (`computeResult` stores the composite of nothing as 0.00, so
   UshaKiran's 0.00 is indistinguishable from a genuinely low score) and nor can
   the `ai_evaluated` event, which is written on that run too;
4. stage `incomplete` only, so a deck shortlisted and then stripped of a detail
   is not walked backwards.

All five arms are independently negative-controlled; see §5.

**`details_completed` is deliberately NOT a transition in
`incubatorPipeline`.** `allowedTransitions` would then offer it as a row action,
and a one-click `incomplete -> ai_evaluated` is exactly the laundering arm 2
exists to prevent. A system `pipeline_events.action` with no transition entry is
the established shape here — `ai_evaluated`, `ai_skipped`, `edit_contact` and
`send_to_assign` are all four of them.

**The audit property that caused this is kept.** `edit_contact` stays a record
of a CLICK (`from_stage === to_stage`). The stage move is a SECOND event with a
real `from`/`to`, written after it. It must not be an `ai_evaluated` row:
`evaluationRuns` counts those, and a second one would relabel the deck
"Reevaluated" for an edit the model never saw (Oct-2026 issue 5) — asserted.

## 4 · Issue 13 is a different bug, and it is NOT in this lane

Turaga's "Send to Query is not going to Query Screen" was not refused by the
server. **Nothing asked it.** `POST /api/decks/:id/send-to-query` and
`POST /api/decks/:id/send-to-assign` — the two routes S2-SERVER built to make
membership a recorded action — have **zero callers in `src/client`** (measured:
`grep -rn "send-to" src/` hits only the server file and the e2e specs). The
Dashboard's two options are still guarded NAVIGATION:
`navigate("/app/query", { state: { deckIds: [deck.id] } })`.

Under row 3 (`ROW3_RECORDED_QUERY.incubator = true`) Query membership is the
recorded click, so the click navigates to a screen the deck is not on and
`QueryPage` resolves the handed id against `?list=query` and drops it. That is
exactly the tester's sentence, and production confirms it: `queries = 0` on
Turaga after the click.

**Cross-lane request (A) — `src/client/routes/DashboardPage.tsx`.** The
`V3_QUERY` branch of `v3ActionCell`'s `onChange` must `POST
/api/decks/:id/send-to-query` (then reload, then navigate), the way
`saveRowEdit` already calls `updateDeckDetails`. The route is idempotent on an
unanswered query and emails nothing, and it 409s `contact_incomplete` — which
the whitelist already withholds at those statuses, so the 409 is a belt. The
mirror for `V3_ASSIGN` / `send-to-assign` is the same change and is what makes
the `AI Evaluated, Assigned` sink reachable from the UI at all; issue 10 no
longer needs it (the deck now reaches the roster by itself, which is the "either
of the logic should work" the tester asked for) but the sink does.

## 5 · Issues 12 and 14 — both halves, and the second reason

The ground truth asked for the second reason behind "none of the action buttons
are active", and it is not the stage:

* **Reject** — `reject_ai_gate` exists only `from: ai_evaluated`, so at stage
  `incomplete` it is not in `deck.actions` and the Dashboard's action cell can
  only draw options the server permitted. It was **never rendered**, not greyed.
  Asserted before and after.
* **Archive** — `archive` *is* permitted from `incomplete`, so it was active all
  along for a superuser / admin / PM. Asserted in the "before" half of the test.
  For a **program associate** it reads "Archive — not available to you here",
  because `archive`'s role list is PM / admin / superuser only. If the tester was
  signed in as a programme associate, that is the whole of the second reason and
  it is a **client question, not a bug**: widening `archive` to the associate is
  a one-line change to `pipeline/incubator.ts` and nobody has asked for it.

## 6 · Tests, and what each negative control broke

`test/worker/stage-rejoin.test.ts`, 9 cases, every one driving the real
evaluate → PATCH path and handing the served view to the same
`screeningStatus` / `matchesV3Stat` the Dashboard renders.

| reverted | what went red |
|---|---|
| the whole move (`target = null`) | 4 — `expected 'incomplete' to be 'ai_evaluated'` ×3, and the missing `details_completed` row |
| the band re-derive (`band = row.signal`) | 2 — `expected 'incomplete' to be 'aieval'` (the stat box) and `'flagged' to be 'weak'` |
| the band's stage-independence | 1 — the archived-then-restored case, `'flagged' to be 'strong'` |
| the rubric-rows arm | 2 — UshaKiran and the never-evaluated deck both moved |
| the `ai_complete` arm | 1 — Turaga moved to `ai_evaluated` (and `screening-status.test.ts`'s own "BOTH incomplete, then the details are entered" also went red) |
| the stage arm (`status !== 'incomplete'`) | 1 — a shortlisted deck dragged back to `ai_evaluated` |

**One existing assertion is reversed, deliberately.**
`test/worker/ai-complete.test.ts:162` read `.toBe("incomplete")` under the
comment *"this repairs the mark, not the pipeline"* — S1-DASH's scope boundary.
The client's five rows ARE that boundary, so it now reads
`.toBe("ai_evaluated")` with the reason in place. Its sibling at line ~300 ("the
deck did not move") still passes and is still a valid control: `seedDeck` runs no
evaluation, so that deck has no rubric rows and no verdict to return to — the
comment now says so.

Regression: 255 worker tests across the 14 deck-touching files, 117 unit
(`deckStats`, `queries`), 76 client (`allDecks`, `deckHandoff`). Clean
`tsc -p tsconfig.worker.json`, `tsc -p tsconfig.json`, eslint.

## 7 · Cross-lane and open items

**(A) `DashboardPage.tsx` — wire the two recorded-click routes.** §4.

**(B) `routes/pipeline.ts` — `restore` leaves the band stale.**
`archived -> ai_evaluated` and `rejected -> ai_evaluated` run no model, so a deck
whose `signal` is the contact arm's `'flagged'` lands at a post-AI stage still
reading "incomplete" in the stat box. This lane closes it on the deck's next
edit (§2) but not on the restore itself. **This matters now:** the tester
archived five of the six decks in response to these issues, so restoring them is
the next thing they will do. Same three arms as `repairsAfterDetails`.

**(C) The six production rows are already stale and no code change heals them
retroactively.** BiocharIND (stage `incomplete`) needs one more Save — the
Dashboard's Edit sends all four contact fields, so re-saving the same values
re-runs the repair. The five archived ones need `restore` plus (B), or a Save
after restore. A one-shot data correction is a migration and is out of this
lane; the predicate is exactly §3's, as SQL:

```sql
-- decks that are complete on both axes, carry rubric rows, and still lie
SELECT d.id, d.name, d.status, d.signal, d.ai_score FROM decks d
WHERE d.edition = 'incubator' AND d.ai_complete = 1
  AND (d.missing_fields IS NULL OR d.missing_fields = '')
  AND (SELECT COUNT(*) FROM scores s WHERE s.deck_id = d.id AND s.evaluator_kind = 'ai') > 0
  AND (d.status = 'incomplete' OR d.signal = 'flagged');
```

**(D) Client question — Archive for the programme associate.** §5.

**(E) Client question — `vc: null`.** The VC edition is out of scope
(2026-10-01) and its stages differ (`PASS_STAGE.vc = 'analyst_scoring'`,
`FAIL_STAGE.vc = 'archived'`), so one target could not serve both. A VC deal
stopped by missing contact details stays at `incomplete` exactly as it does
today. Whether it should rejoin, and where, is his question.
