# S2-SERVER — handoff note

*Screening wave S-2. Branch `screening/S2-SERVER`, cut from `main` @ `fb49499` (F-FOUL and
S0-VOCAB both merged). Gate: typecheck ✓ · lint ✓ · **2616 passed / 1 skipped** ✓ (baseline 2586;
+30 new) · build ✓. e2e, playwright and roles not run, per the prompt.*

---

## What shipped

| # | Item | Where |
|---|---|---|
| 1 | The AI gate is a per-org setting, and **"at or above" wins** | `migrations/0082`, `config/scoringSettings.ts`, `routes/config.ts`, `ai/evaluate.ts` |
| 2 | A sub-gate **incubator** deck waits at `ai_evaluated` instead of being rejected | `ai/evaluate.ts` (`FAIL_STAGE`), `pipeline/incubator.ts` (the two comments it falsified) |
| 3 | The `send_to_assign` **marker**, and `sendToAssignAt` | `routes/decks.ts` |
| 4 | Row 3 server side — `?list=query` means **queried** | `routes/decks.ts` |
| 4b | **`POST /api/decks/:id/send-to-query`** — row 3's other half. Not in the prompt; see below | `routes/decks.ts` |
| 5 | The two no-response derived fields, and the cron sweep | `routes/decks.ts`, `scheduled.ts` |

Migration **0082** is the only schema: `org_scoring_settings.ai_gate_threshold REAL NOT NULL
DEFAULT 5.0 CHECK (BETWEEN 0 AND 10)`. Verified against a real D1 in the worker suite — the column
is `real`, defaults to 5 on both editions, and the CHECK bites at the database
(`D1_ERROR: CHECK constraint failed: ai_gate_threshold BETWEEN 0 AND 10`), not only at the route.
`const GATE = 5` is **deleted**, not defaulted: `computeResult` now takes a required `opts.gate`.

---

## Read this first: four ownership deviations, all deliberate

**1. `POST /api/decks/:id/send-to-query` is an addition beyond the four items, and row 3 does not
ship without it.** The plan's §3.1 records `A = Send to Query` as "**Yes**, already persisted" via
the `queries` row. That is true, but the only writer of a `queries` row is the compose-and-send on
the Query screen — and once membership stops being derived, **the deck cannot reach that screen
until a `queries` row exists.** Send to Query would navigate to a list the deck is not on, and
`?list=query` would be a screen an operator could never populate. `v3SendToQuery`
(`DashboardPage.tsx:1434`) gates the click on `deckListRoute` returning `"query"`, so with the
derivation gone it would be permanently disabled on every deck that had not already been queried.

The prototype answers it and the build had lost the answer: **`upSendToQuery` puts the deck on the
Query list as `pending` before any email goes out** — which is why `queryStatusOf` has a Pending
status at all, and is recorded as Q89 in `plan_parity.md`. So the recorded send is a pending query
with no questions yet; the operator composes on the screen the deck has just joined, and
`POST /decks/:id/queries` sends exactly as before. **The click mails nothing**, which is what keeps
the defect his own row-3 reason names out of reach. Six tests, including an assertion that the
outbox count does not move.

**2. Two `src/shared/` files were edited, additively, and neither is in flight.** The prompt says
"do not edit `src/shared/`", but `ai_gate_threshold` cannot be surfaced "exactly as
`shortlistThreshold` is surfaced" without the type it lives on:
* `src/shared/types.ts` — `OrgScoringSettingsRow.ai_gate_threshold`;
* `src/shared/scoring.ts` — `ScoringSettings.aiGateThreshold` + `DEFAULT_SCORING_SETTINGS`.

Neither file is owned by any S-2 session (S2-CHROME owns `shared/nav.ts`; S0-VOCAB owns
`deckStats.ts` / `queries.ts` and has merged). `src/client/types.ts` got the three new `DeckView`
fields for the same reason — S2-DASH needs them and its file list does not include that file.

**3. `QUERY_MEMBERSHIP_IS_DERIVED_PENDING_ROW3` was NOT flipped, and the measurement is why.**
S0-VOCAB's own comment names S2-SERVER as the flipper of that one line. I tried it and measured the
blast radius: **21 tests across three files**, all belonging to sessions running in parallel with
this one — `test/client/queryPage.test.tsx` (14, S2-CHROME), `test/client/deckHandoff.test.tsx` (6,
S2-DASH), `test/client/allDecks.test.tsx` (1, S2-DASH) — plus 4 in `test/client/assign.test.tsx`,
which no session owns. Flipping it would hand two in-flight sessions a red tree in the exact files
they are rewriting.

So the server half lands as a per-edition override at the `?list=` filter
(`ROW3_RECORDED_QUERY`, `routes/decks.ts`), and **the shared default flip is the one line left
for the client half.** It still goes through `deckListRoute` — one implementation of the rule,
two call sites, which is what the "never two implementations of it" comment protects.
**→ Owner: S2-DASH or S2-CHROME if either wants it; otherwise S-INT, one line.**

**4. Three unowned test files moved with the behaviour, because they asserted the old behaviour in
their own titles.** None is owned by an S-2 session:
* `test/worker/evaluate.test.ts` — `describe("computeResult — the score > 5 gate")`, including
  `it("treats exactly 5 as failing (strictly greater than gate)")`. Both are now his reading.
  **This file is missing from the plan's scope for S2-SERVER and should be added** — §6.3 item 4
  already notes that neither plan names `ai/evaluate.ts`, and its test has the same gap.
* `test/worker/decks.test.ts` — `it("rejects a deck at or below the gate")` → waits at
  `ai_evaluated`, and now also asserts the `below_gate` verdict is still recorded.
* `test/worker/route-partition.test.ts` — V4-ROUTE's negative control. Three tests asserted the
  conclusion row 3 deletes ("off Assign therefore on Query"). Rewritten, not adjusted: each now
  pins that the deck **leaves Assign, does not appear on Query, and is still in the unfiltered
  response**, which is the invariant that replaced it. Every Assign assertion in the file is
  unchanged, because that is the half of his sentence that survives.
* `test/worker/evaluate.live.test.ts` — one call site, gate argument only.

---

## Measured consequences worth knowing

**The incubator Query list went from 2 seeded decks to 1.** `NimbusHR` stays (it has a real
`queries` row); **`PayRoute` drops off** — it was listed purely because its stage is `incomplete`,
which is the derivation row 3 deletes. It is not lost: it is on the uploaded status screen, as his
own display rule requires, and one `send-to-query` click puts it back on Query. The Assign list is
unchanged at 3 (`FinStack`, `GreenGrid Energy`, `TaxPilot`).

**⚠ The sweep archives `Northbeam Robotics` on the first cron tick of ANY database, including a
fresh one. Measured, not inferred.** The VC seed gives it an **absolute-dated** query —
`created_at = "2026-08-11T08:00:00.000Z"`, with real questions and no `founder_response` — and it
sits at stage `incomplete`, which is in `SWEEPABLE_STAGES`. So it is ~50 days late on the day this
was written and gets later. Running `runNoResponseSweep(env, "vc")` moves it to `archived` with
`exit_note = "no response"`, verified in this session.

**That is the rule the client asked for, working exactly as specified**, and it is not exempted —
quietly special-casing a demo row would be worse than the surprise. But know three things:
* **`npm test` and `npm run test:e2e` are unaffected.** The sweep runs only from the Cron Trigger,
  and `wrangler dev` does not fire one unless `--test-scheduled` is used and the endpoint is hit.
  The full suite is green.
* **Two e2e specs WOULD break if anyone ever ran the sweep during e2e** — `e2e/vc-intake.spec.ts:61`
  asserts Northbeam's row reads "Incomplete", and `e2e/query.spec.ts:206` asserts it is selectable
  on the VC Query screen. Not in my patch, because nothing in the e2e run triggers the sweep.
* **Production will archive it on the first daily tick after deploy.** If the client is demoing the
  VC Incomplete tile, that row disappears from it and appears in Archived. Either tell him, or
  re-date the seed's query relative to `datetime('now')` the way the incubator's `NimbusHR` query
  already is — a one-line seed fix, and a migration slot somebody would have to allot.

`NimbusHR` (incubator) is safe by contrast: its query is seeded at `datetime('now')`, so it is
never past the window on a fresh database.

**`I4` / `I10` ("Below threshold", "…Edited") are reachable for the first time.** Measured before
the change, nothing `<= 5` waited at `ai_evaluated` — the only sub-gate decks were `creditbri`
(4.3, already `rejected`) and `solarc` (3.8, `archived`). Both states are now pure predicates over
served fields, and `reject_ai_gate`'s label is true of the decks it is offered on for the first
time. `screening-status.test.ts` asserts the whole path: evaluate at 3 → `belowThreshold` →
`reject_ai_gate` → `rejected`.

---

## Handed over — things I found in files I do not own

**1. THE LIVE DEFECT, and it is the client's own stated reason for row 3, verbatim.**
`src/server/routes/pipeline.ts:809`:
```
const toEmail = deck.founder_email ?? uploader?.email ?? "founder@portal.local";
```
`POST /api/decks/:id/queries` emails a deck with no founder email, mints a resubmit token, and
sends both to a placeholder address. **F-FOUL has merged and did not close it** (its scope was the
deck-file guard; the same fallback is also at `:935` for `signup_invite`). After my partition
change nothing ARMS it automatically any more — and `send-to-query` deliberately mails nothing —
but the path is live if called directly.
**→ Owner: S-INT, or whoever next opens `routes/pipeline.ts`. One-line ask: refuse the send, or
record it undelivered, when `deck.founder_email` is absent.**

**2. `src/server/audit/events.ts` audits `shortlistThreshold` and now silently misses
`aiGateThreshold`.** `auditScoringFramework` (`:123-126`) names the shortlist floor moving; an
admin moving the **screening gate** — which decides whether decks stay in the funnel at all — is
recorded nowhere. Additive, ~4 lines, same shape as its neighbour. Not edited: the file is outside
this session's list and nothing breaks without it. **→ Owner: S-INT.**

**3. `src/client/routes/admin/ScoringFramework.tsx` has no control for the new setting.** The
column, the API and the validation all ship; the console cannot yet move it. `shortlistThreshold`'s
own input at `:664-666` is the template, `toDisplayScale`/`fromDisplayScale` and all — the gate is
canonical 0–10 like its neighbour. **→ Owner: S2-ADMIN owns `admin/sections.ts` and
`AdminConsole.tsx` but not this file; S-INT or a My Account follow-up.**

**4. `src/server/index.ts` — `runMonthlyUsageSummary` now does two jobs and its name says one.**
The sweep rides that function's existing edition loop, which is the placement the plan asked for
(one edition loop in the file, so tenancy nests in one place) and the right cadence (`index.ts`
calls it **daily** off `"0 8 * * *"`; only the digest's dedupe key makes it monthly). The name is
narrower than the body, and it stays that way here only because `index.ts` is not this session's
file. **→ Owner: S-INT. Rename to `runDailyEditionPass` in `scheduled.ts` + `index.ts`, two lines.**

---

## Client questions this session produced

| # | Question | What ships meanwhile |
|---|---|---|
| S1 | **Trigger mismatch on "Contact details edited".** Your diagram fires the state on the operator pressing **Edit**; our event is written only when a contact field **actually changed**. They differ in one case: open Edit and save without changing a contact detail — you get the state and its re-check branch, we get the deck's original status. | Ours. Recording "a form was opened" is a different kind of fact, and in the case where the two differ your branch has nothing new to re-check. The note is on the assertion that shows it (`ai-complete.test.ts`). |
| S2 | **VC and the gate.** A sub-gate **incubator** deck now waits at `ai_evaluated`; a sub-gate **VC** deal is still archived by the evaluator (`FAIL_STAGE.vc`). Your screening spec is the incubator's. Should VC change too? | VC unchanged. Same per-edition reasoning S0-VOCAB used for row 3's flag. |
| S3 | **VC and row 3.** Same question for Query membership: `ROW3_RECORDED_QUERY.vc` is `false`, so VC's own listing rules (F0274, F0341) survive. | VC keeps the derivation. |
| S4 | **Should the gate be per program or cohort, not just per organisation?** `ai_weight_pct` already cascades org → program → cohort (`0074`). The gate does not. | Org-wide, matching `shortlist_threshold`. Say the word and it is the same three-level read. |
| — | Q10, Q11 and Q14 of `plan_screening.md` §8 are **shipped as their fallbacks**: the gate is the AI screening gate and admin-settable at 5.0; `>=`; automatic after five working days into Archived with the reason "no response". |  |

---

## The e2e patch — `docs/parity-requests/s2-server.patch`

`git apply --check` verified on this branch. **Two specs, both broken by row 3, both fixed by
adding the click the client asked for:**

* `e2e/query.spec.ts` — `flaggedDeck()` pulled its decks to `manual_review` and relied on
  `FLAG_STAGES` auto-listing them. One `POST /api/decks/:id/send-to-query` after the transition.
* `e2e/incubator.spec.ts` — "staff query an incomplete deck" expects `PayRoute` on `/app/query`.
  One `POST /api/decks/inc_deck_payroute/send-to-query` plus a reload.

**Nothing in the patch depends on S2-DASH's button**, so it can be applied before or after the
client sessions land. If S2-DASH wires Send to Query to this route, the e2e specs could instead
drive it through the UI — a better test, and a note for whoever applies this.
