# OCT1-AIGATE — the gate is configured, saved and now READ

**Lane:** issues 7, 8, and the tail of issue 6.
**Date:** 2026-10-01. **Branch:** `main`, shared checkout with three sibling lanes.

Files touched (all inside the lane except the two flagged under *Cross-lane*):

- `src/server/routes/config.ts`
- `src/client/api.ts`
- `src/client/routes/DashboardPage.tsx`
- `src/shared/deckStats.ts`
- `src/server/routes/decks.ts`
- `test/worker/screening-status.test.ts`, `test/client/allDecks.test.tsx`

`src/shared/queries.ts` is **untouched** — see §2.

---

## 1 · Issue 7 — the gate was served to nobody

`org_scoring_settings.ai_gate_threshold` was written by the console and read back
by nothing on the screening path. Three ends of one break, all closed:

| Where | Was | Now |
|---|---|---|
| `GET /api/config/summary` | did not return it | returns `aiGateThreshold` |
| `GET /api/config` (full) | did not return it | returns it too (`FullConfig extends ConfigSummary`) |
| `ConfigSummary` | did not declare it | declares it **required** |
| `DashboardPage.tsx` | `(c as ConfigSummary & { aiGateThreshold?: number }).aiGateThreshold` behind `typeof === "number"` | `setAiGate(c.aiGateThreshold)` |

**The measured detail the task brief got slightly wrong, and it matters.** The
old cast was not merely a stand-in that happened to hold the default — the guard
was **false on every response**, so `setAiGate` never fired once and the only
gate the Dashboard ever used was the `useState(5.0)` literal. It read correctly
solely because production holds 5. Every test in `screening-status.test.ts`
passed throughout, because they assert the gate at evaluation time where it was
always read properly.

**Deviation from the brief (deliberate, please read).** The brief says "SELECT the
column in `loadSettings`". `loadSettings` reads `org_settings`; the gate lives on
`org_scoring_settings`. Doing it literally meant either a second table in that
query or a second place that knows the column name and its default — a duplicate
threshold reader, which is the exact fault this number has a history of. Instead
there is a one-line `loadGate()` over `loadScoringSettings`, which `config.ts`
already imports. One reader, one default, one extra D1 read on a route that
already makes three.

**`aiGateThreshold` is required, not optional, and that is the whole fix.** With
`?: number` the read site needs a `?? 5` or a guard, which is how this got lost
the first time. Required means a fixture that omits it hands `screeningStatus`
an undefined `gate`, every scored deck reads "Below threshold", and you see it
immediately. The initial `useState(5.0)` stays — it is the one pre-fetch render,
not a fallback, and nothing else reads it. **No default was reintroduced**;
`screeningStatus` still takes `gate` as a required parameter.

---

## 2 · Issue 8 — the Assign roster now consults the gate

**I chose (b): a post-filter in the `?list=assign` arm of `routes/decks.ts`.
`deckListRoute` is untouched.** Verified before deciding, and (b) is both smaller
and the only one of the two that does not change what the status vocabulary
means:

- (a), an **optional** `gate` on `deckListRoute`, compiles and cascades nowhere —
  but it puts the rule *inside* the shared function while leaving it off for
  every caller that forgets the argument. A routing function whose answer
  depends on which parameter you remembered is worse than no rule. The row-3
  paragraph already in that route gives the same reasoning for `deriveQuery`
  being an override there rather than the shared default.
- (b) keeps the rule where it is enforced. `scoring` (with `aiGateThreshold`) was
  **already loaded** in that handler for blind scoring, so the fix costs no query.

**The circular-import question, resolved rather than duplicated.**
`ratingAtOrAboveGate` is now `export`ed from `deckStats.ts` and imported by
`routes/decks.ts`. It could not move next to `deckListRoute` in `queries.ts`
because `deckStats.ts` imports *from* `queries.ts` — the reverse is a cycle.
`routes/decks.ts` already imported `latestTimestamp` from `deckStats.ts`, so the
new import adds no edge. **The predicate is not rewritten at the call site**: it
keeps `>=` (C13) and "an absent score is not below the gate".

**One judgement call the brief did not name, and it is load-bearing.** The gate
is **skipped on a deck already handed over** — `isAllocatedDeck()`: the
`send_to_assign` marker, `assigned_to`, or the `assigned` / `jury_evaluation`
stages. Two reasons:

1. Column 1 of the Assign screen deliberately keeps allocated rows so a second
   juror can be added. Every deck in production was routed with the gate unread,
   so a strict filter would have pulled decks off a screen they are already being
   worked on — including any the tester already sent.
2. It is `screeningStatus`'s own precedence. The `assigned` sink is answered
   *before* the rating check ever runs, so the status vocabulary never calls an
   allocated deck "Below threshold". The list now agrees with the pill instead of
   contradicting it.

That carve-out has its own test and its own negative control.

**One behaviour change you should know about.** The partition now runs on the
**unblinded** views: the handler maps, routes, then blanks, where it used to
blank inside the map. Routing is not a visibility question — `ratingAtOrAboveGate`
reads an absent score as "not below the gate", so filtering already-blanked rows
would have given a juror mid-blind-scoring a *different* Assign roster from the
PM's. `score-visibility-gate` and `score-visibility-v3` are green.

**VC:** `AI_GATE_NARROWS_ASSIGN = { incubator: true, vc: false }`. The filter is
unreachable for VC by construction (`ASSIGNABLE_STAGES.vc` is empty, so
`deckListRoute` can never answer `"assign"`), but that is a property of another
file, so the per-edition table says it out loud — same shape and reason as
`ROW3_RECORDED_QUERY` beside it. `allDecksVc.test.tsx` green, unchanged;
`VcEvaluatePage.tsx` / `VcDiligence.tsx` untouched. `e2e/vc-intake.spec.ts`
contains no reference to `?list=assign`, `/api/config/summary`, the gate, the
row action menu or any screening status word — I did not run it (standing rule 3).

---

## 3 · Issue 6's tail — the one dead end

`incompleteContactEdited: ["archive"]` → `[V3_EDIT, "archive"]`. A deck whose
contact edit missed a field could only be archived, with its own four editable
inputs sitting in the row. Reasoning on the entry; it is the sixth deviation
from the client's literal matrix and the header comment now says six, with the
bullet added beside C8 (the same reading).

Both preconditions confirmed, not assumed:

- **`withEdit`** — `incompleteContactEdited` renders on the `v3Default` shape,
  which passes `v3ActionCell(deck, true)`. Asserted behaviourally (the option is
  drawn AND choosing it opens the four inputs), because the handler re-checks the
  whitelist and an entry missed there would still read as armed.
- **`V3_STATUS_HINTS`** — rewritten. The old gloss ended at "still cannot be
  emailed", which told the operator there was nothing to do while the menu now
  offers the remedy. It now names Edit.

`incompleteDeckEdited: [V3_QUERY, "archive"]` **not touched** (`spec_screening_flow.md:50`).
`rejected` vs `archived` **not collapsed** — no change to `deckStats.ts:1211` or
`SCREENING_SINK_TILE`. No `spec_screening_flow.md` §3 decision reopened.

---

## 4 · Tests, and the negative control for each

Every one below was negative-controlled by reverting the fix, watching the named
test fail, and restoring (checksum-verified restore each time, in the shared
tree, one command per control to keep the window at seconds — no `git stash`).

**`test/worker/screening-status.test.ts`** (new §5, 10 assertions over 7 tests):

| Test | Control: reverted | Result |
|---|---|---|
| summary serves the org's number, and it MOVES (6.5 → 3) | `aiGateThreshold` off `/summary` | FAIL (`undefined`) |
| the full admin config carries it | `aiGateThreshold` off `/` | FAIL |
| every role that screens gets it (superuser · admin · PM) | `aiGateThreshold` off `/summary` | FAIL |
| sub-gate deck dropped from Assign, deck AT the gate kept | the `gated(v)` clause | FAIL |
| it is the ORG's gate — same deck moves at 5 → 7 → 5 | the `gated(v)` clause | FAIL |
| a deck already SENT to Assign stays on the roster | `isAllocatedDeck(v) \|\|` alone | FAIL |
| the QUERY arm is untouched | — (invariant; stays green under every control) | green |

Written against a gate of **6.5 / 7 / 3**, never 5: a test at 5 agrees with the bug.

**`test/client/allDecks.test.tsx`:**

| Test | Control: reverted | Result |
|---|---|---|
| MATRIX row `Incomplete contact details, Edited → Edit · Archive` | the whitelist entry | FAIL |
| `issue 6 — Edit is a real exit…` (option armed, editor opens, field editable) | the whitelist entry | FAIL |
| the same test's hint assertion | the `V3_STATUS_HINTS` rewrite | FAIL |
| existing `…raising the org's gate past it moves the same deck Below threshold` | `setAiGate(c.aiGateThreshold)` | FAIL |

Suites run green: client `allDecks` (66), `allDecksVc`, `assign`, `deckHandoff`,
`queryPage`, `config-branding`, `coreParams`, `branding`, `accountOverlay`,
`setupWizard`; worker `screening-status` (35), `config`, `decks`,
`route-partition`, `deck-scope`, `assignments`, `assignments-mine`,
`ai-complete`, `score-visibility-gate`, `score-visibility-v3`,
`scoring-framework`, `branding`, `branding-w4b`, `parameters-w8b`,
`alldecks-shortlist-hint`, `alldecks-v3-activity`; unit `deckStats`, `queries`.
`npx tsc` clean on both configs for every file in this lane; `npx eslint` clean.

---

## 5 · Cross-lane — two edits I made OUTSIDE my lane, and why

Making `ConfigSummary.aiGateThreshold` required breaks any `FullConfig` literal
that omits it. Exactly two exist, both stale test fixtures, neither touched by
any sibling (`git status` checked):

- `test/client/config-branding.test.tsx` — added `aiGateThreshold: 5` to `CFG`
- `test/client/coreParams.test.tsx` — added `aiGateThreshold: 5` to `CFG`

One property each, plus a two-line comment; nothing else in either file. I made
them rather than only reporting them because the alternative was knowingly
leaving the repo non-compiling for three siblings who are told not to run
`typecheck` and so would not have seen it. **Revert these two lines if either
file belongs to another lane** — nothing else in my change depends on them.

Same mechanism, inside my lane: `test/client/allDecks.test.tsx`'s default
`getConfigSummary` mock now carries `aiGateThreshold: 5`. Any **new** client test
that renders `DashboardPage` must do the same or every scored deck will read
"Below threshold". `allDecksVc.test.tsx` omits it and is green — the VC dashboard
does not use the v3 screening vocabulary.

---

## 6 · Not done / for integration

1. **`deckListRoute` still knows nothing about the gate.** Only
   `GET /api/decks?list=assign` applies it. Any future caller that asks "does
   this deck belong on Assign?" will get the pre-gate answer. The Dashboard's
   `v3SendToAssign` is the one live example, and it is already correct for a
   different reason: the whitelist refuses `V3_ASSIGN` at `belowThreshold` first
   and its remark wins. That now works *only because issue 7 landed* — the two
   fixes in this lane are one fix, in that order.
2. **The deploy order is server-then-client, and it is not optional.** A client
   built with this change against a worker that does not serve `aiGateThreshold`
   reads `undefined` and renders every scored deck as "Below threshold". Ship the
   worker first, or ship both together.
3. **Production will change verdicts the moment the gate is edited.** It holds 5
   today, so deploying this moves nothing. The first admin who sets it to
   anything else gets the behaviour the setting always promised, including four
   of the tester's five decks leaving the Assign roster.
4. **`org_scoring_settings.ai_gate_threshold` is per `(tenant_id, edition)`**
   (`0090`). `loadGate` goes through `loadScoringSettings`, so it is scoped —
   but `/api/config/summary` now reads that table for every authed user on every
   Dashboard mount. If the extra D1 read shows up, cache it beside the scoring
   framework rather than inlining the column here.
5. **Not reopened, flagged only — and I traced exactly which of the tester's
   rows my fixes reach.** Auto-clarification firing on all eleven production
   decks is another lane's (`src/server/config/autoQuery.ts`,
   `routes/pipeline.ts`, `routes/questions.ts` — all outside mine). Measured
   against the latch rather than assumed:

   - **The five at `ai_evaluated` with complete contact are NOT latched.**
     `isQueriedSinkCurrent` resolves the sink through `deckListRoute`, whose
     assign arm answers `"assign"` for a complete evaluated deck whatever its
     `queries` row says. So those five read `belowThreshold` / `complete`, and
     **issue 7's fix reaches them today**: the four below the gate arm Reject and
     Archive, and the fifth (5.25) arms Send to Assign. Issue 8's filter takes
     the four off the Assign roster.
   - **The six at stage `incomplete` ARE latched to `"queried"`**
     (`QUERYABLE_STAGES.incubator = ["incomplete", "manual_review"]`, so
     `isQueryStageWindow` holds), and `V3_ACTIVE_ACTIONS.queried` is `[]`. On
     those rows every action is inactive, so **the Edit I re-armed in §3 is still
     unreachable** until the auto-clarify lane lands. Nothing in my lane can or
     should change that — the latch is correct behaviour for a deck that really
     was queried; the defect is that it was queried at all.

   My fixtures therefore carry no `queries` row, which is what those rows look
   like once that lane lands.
