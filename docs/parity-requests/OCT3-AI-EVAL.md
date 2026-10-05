# OCT3-AI-EVAL — issue 15: an evaluation that produced nothing and reported success

Lane: `src/server/ai/evaluate.ts`, `src/server/ai/health.ts`, `test/worker/ai-unscorable.test.ts`.

## The contradiction, and which of the five candidates it was

Production carried two rows named "Ushakiran" with `ai_complete = 1` and
`ai_score = 0.00`, and a third upload of the same deck ("UshaKiran Ecoplast")
scored 5.51. Reproduced in the worker harness against the unfixed code, with a
`{ complete: true, scores: [] }` model response:

    RESULT  { weightedTotal: 0, signal: "flagged", status: "incomplete", complete: true }
    DECKROW { status: "incomplete", ai_score: 0, ai_complete: 1, complete: 1,
              signal: "flagged", ai_attempts: 0, ai_error: null, ai_rows: 0 }
    EVALROW { weighted_total: 0, verdict: "below_gate" }

That is the production row, column for column. So of the five candidates in the
brief it is **"the model returned an empty `scores` array and nothing rejected
it"** — with the specific mechanism being a response the parser accepted as
whole when it was not:

* `buildTool` constrains `scores[].key` to an `enum` of the org's real parameter
  keys and `require`s `complete`, `extractions` and `scores`. So a *well-formed*
  response cannot have unmappable keys or a missing `complete`. **A truncated one
  can**: `max_tokens` returns a 200 with the `tool_use` block present and only
  the properties the model finished emitting. `callAnthropic` never looked at
  `stop_reason`. Negative-controlled: with the new check removed, a
  `stop_reason: "max_tokens"` response parses to exactly `{ complete: true }` —
  which is the input that produces the row above.
* `max_tokens` was **4096**, and this rubric's answer does not reliably fit:
  22 parameters × `{key,value,comment}` ≈ 770 tokens, 8–12 summarised
  `extractions` ≈ 960, plus the contact block. A terse run lands near 1.8k and a
  verbose one near 4k — the ceiling sat *inside* the spread, which is what "the
  same deck scored 5.51 once and 0.00 twice" looks like from outside.
* `parseEvaluation` read a missing `complete` as the model's affirmative
  (`raw.complete !== false`) → the `ai_complete = 1` half.
* `computeResult` scores every parameter over the full weight denominator, so a
  payload with nothing mappable makes every term 0 → the `ai_score = 0.00` half.
  It *does* already return `status: "incomplete"` for that case, but it returns a
  status, and `evaluateDeck` persisted the zero anyway.

Not the other three candidates: the weight-sum divide is already guarded
(`composite()` returns 0 when `Σw === 0`); a genuine refusal cannot reach the
tool at all (`tool_choice` is forced and a missing block already throws); and a
scanned/no-text PDF is indistinguishable from the above once it arrives here —
it funnels into the same hole and is closed by the same fix.

## Was a failed run distinguishable from a zero-scoring one? No.

The whole §9 health machinery keys on `status = 'pending_ai'`
(`sweepStuckEvaluations`, `markEvalTerminal`). The dead run's own success UPDATE
moved the deck *off* `pending_ai` and set `ai_error = NULL, ai_failed_at = NULL,
ai_attempts = 0`. Measured above: a deck seeded with `ai_attempts = 2` came back
`0`. So the retry cap — and therefore the **credit refund** — was unreachable for
this failure class, and the spent credit stayed spent.

Worse, the three DELETEs at the top of the persist batch are unconditional and
ran before the new result was known good: `ai_rows: 0` above is the prior good
run's AI score row, destroyed by a run with nothing to replace it with. That is
how a deck that once scored 5.51 came to read 0.00.

## What changed

1. `evaluateDeck` **throws** on a response that scores no rubric parameter
   (`unscorableReason`, new export), before the first DB read. Every caller
   already routes a thrown evaluation into `recordEvalFailure` → queue retry →
   dead-letter → `markEvalTerminal` + credit refund, so this needed no new
   plumbing. The deck stays at `pending_ai`, which the sweep can see.
2. `callAnthropic` throws on `stop_reason === "max_tokens"`, and `max_tokens`
   goes 4096 → 8192. Both are needed: the check turns a silent wrong answer into
   a loud failure, the ceiling is what lets the deck actually score.
3. `parseEvaluation` drops a score entry with no finite `value` instead of
   `clampScore`-ing it to a real `scores` row reading 0, attributed to the AI.
   The composite is unchanged (an absent parameter already counts as 0 over the
   full denominator); what goes away is a fabricated AI opinion in the
   workbench's AI column.
4. `classifyEvalError` names a cut-off run separately from an unusable one — the
   recoveries differ, and the client already renders this string
   (`DeckCard`, `DashboardPage`, `ReviewScreen`).

An explicit `complete: false` is deliberately still a verdict and still
persists (`ai_complete = 0`) — that is the legitimate route to Incomplete and is
Turaga's row. Negative-controlled in the new suite from both sides.

## For the STAGE lane

* "Archive button should be active atleast" (the second half of issue 15) needs
  nothing from here: `pending_ai` is already in the `archive` whitelist
  (`src/pipeline/incubator.ts`), so a failed run lands somewhere Archive is
  offered. The greyed buttons the tester saw are the stage-staleness bug.
* `test/worker/ai-complete.test.ts:162` now fails — `expected 'ai_evaluated' to
  be 'incomplete'` after a PATCH. That is the stage lane's own
  `incomplete -> ai_evaluated` promotion in `routes/decks.ts` landing; the
  assertion is the old behaviour and belongs to whoever wrote the promotion.
  Untouched here.

## Open, not fixed

* **A partially-scored response still persists as a verdict.** 14 of 22
  parameters scored deflates the composite over the full denominator — by design,
  so a truncation cannot *inflate* past the gate — but the resulting number is
  then presented as the AI's judgement with nothing recording the coverage.
  MOSS AIR (3.36) and Scion Algae (3.75) are candidates and I could not measure
  them (production reads are not permitted from this session). Closing this
  wants a `scores_returned` / coverage column, which is a migration and outside
  this lane.
* `evaluations.verdict` and `decks.status` could disagree: `verdict` is computed
  from `effective.complete` while `status` comes from `computeResult`, so the
  scoreless payload wrote `verdict = 'below_gate'` on a deck at `incomplete`
  (see EVALROW above). Now unreachable for that payload, but the two
  computations are still independent.
* The two "Ushakiran" rows already in production keep their false `0.00`. Nothing
  here backfills them; they need a re-score, which is now safe because a second
  dead run can no longer overwrite a good one.
