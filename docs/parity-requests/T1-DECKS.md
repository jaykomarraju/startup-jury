# T1-DECKS — handoff note

*Tenancy wave T1, the deck lane. Cut from `main` @ `dc47712` (T0-SCHEMA merged: migrations
0083–0100, `src/shared/tenant.ts`, `test/worker/tenant-scope.test.ts`). **No migration** — 0101–0108
belong to integration, and this session added none.*

*Gate, re-taken on a settled tree at the end of the session: **typecheck ✓ · lint ✓ · 2770 passed /
1 skipped across 146 files, 0 failed ✓ · build ✓** — all four exit 0. Baseline before this wave began
was 2709 passed / 1 skipped, so the seven T1 sessions have added 61 tests between them.
`tenant-scope.test.ts` alone: **67 passed, 0 failed**, with nothing left `pending`.
e2e, playwright and roles not run, per the prompt and §11's gate.*

---

## Read this first: the tree is shared, and that changes how to read the gate

`git status` in this checkout lists **33 modified files across all seven T1 sessions**, including
`test/worker/tenant-scope.test.ts`, which T1-ESIGN and others are extending at the same time. This
is the `wave-r-shared-tree` situation again — "the six worktree-isolated sessions share ONE
checkout". Consequences, all of which I worked around rather than ignored:

* **No `git stash`, no `commit -a`.** Nothing was stashed and nothing was committed from here.
* **Typecheck and test output is not attributable by totals.** Every number below is filtered to the
  seven files this session owns. At one point `npx tsc` reported fourteen errors in
  `src/server/esign/routes.ts` from T1-ESIGN's in-flight change to `esign/store.ts`; none were mine.
* **The ratchet was edited surgically**, by exact-anchor replacement on three probe lines and two
  additions, never by rewriting a region. T1-ESIGN's `VC_ADMIN`, their two-row
  `agreement_templates` fixture and their `crm_sync_log` re-key are all intact.

### And one thing that happened, which the next wave in a shared tree should expect

At **21:32:09** a sibling session's negative control landed in `src/shared/tenant.ts` — T0's helper,
which nobody owns — and for about four minutes `ScopeBuilder.on()` was this:

```diff
-    this.parts.push(`${alias}.tenant_id = ?`, `${alias}.edition = ?`);
-    this.values.push(this.scope.tenantId, this.scope.edition);
+    this.parts.push(`${alias}.edition = ?`);
+    this.values.push(this.scope.edition);
```

**That one line silently un-scopes every statement all seven sessions have written.** It was restored
by whoever made it, and `git status` on that file is clean again — this is a note, not an incident.

Two things are worth keeping from it:

1. **The ratchet caught it completely**, which is the best evidence yet that it is not a vacuous
   suite. Layer 1's "every direct-column predicate the helper builds excludes tenant B" failed, so
   did "builds the predicate and its binds together, in order", and so did **every single `enforced`
   probe in the file across all seven sessions** — 25 failures from a four-line diff.
2. **A whole-suite number taken during another session's negative control is worthless**, and you
   cannot tell from the output that that is what happened. My own in-flight run at 21:31:47 was
   poisoned 22 seconds in. Both my gate numbers below were re-taken afterwards against the restored
   helper. If you report a number from a shared tree, check `git diff src/shared/tenant.ts` first.

---

## What shipped

| # | Item | Where |
|---|---|---|
| 1 | **§2 B1 closed** — the deck listing, and the fourteen by-id routes behind it | `routes/decks.ts` |
| 2 | **§2 B2 closed at the gate** — `loadDeck` scopes all ten pipeline routes | `routes/pipeline.ts` |
| 3 | **§2 B3 closed** — `/api/queries` and its four per-deck siblings | `routes/pipeline.ts` |
| 4 | **§2 B7 closed** — the evaluator roster and the jury list | `routes/pipeline.ts` |
| 5 | **The AI path scores against its OWN customer's rubric** | `ai/evaluate.ts` |
| 6 | **§2 B24-30's credit leak closed, and it was worse than a leak** | `decks/versions.ts`, `ai/health.ts` |
| 7 | **The duplicate detector stops naming other customers' startups** | `intake.ts` |
| 8 | **The bulk assign route** — 100 decks × 25 people, both lists from the body | `routes/assignments.ts` |
| 9 | **The one `INSERT INTO decks`** takes `insertScope` | `routes/decks.ts` |
| 10 | Three ratchet probes promoted, with the fixtures that make two of them real | `test/worker/tenant-scope.test.ts` |

**Zero `edition = ?` predicates remain in the seven owned files** (verified: the only surviving
occurrence of the string is a comment recording what the deck listing used to be). Every scope goes
through T0's helper — `scopeOf`, `scoped`, `viaParent`, `insertScope`, `TENANT_OWNER`. This session
invented no predicate of its own, with the one documented exception in §"Two column-to-column
conditions" below.

### Statement counts, per file

| File | Scope builders | `viaParent` | `insertScope` |
|---|---|---|---|
| `routes/decks.ts` | 40 | 11 | 1 |
| `routes/pipeline.ts` | 23 | 9 | — |
| `routes/assignments.ts` | 7 | 2 | — |
| `ai/evaluate.ts` | 3 | — | — |
| `intake.ts` | 4 | — | — |
| `decks/versions.ts` | 2 | — | — |
| `ai/health.ts` | — (scope built from the deck row) | — | — |

`viaParent` by table: `evaluations` ×8, `scores` ×4, `queries` ×4, then one each of
`pipeline_events`, `ic_votes`, `deck_versions`, `deck_onboarding`, `deck_extractions`,
`deck_assignments`. That is the proxy bucket the prompt said was the whole job.

---

## The three findings worth a sibling's attention

### 1. `reserveCredits` did not merely leak — it broke its own gate, for both customers

`decks/versions.ts`'s reservation was:

```sql
UPDATE org_settings SET credits_balance = credits_balance - ? WHERE edition = ? AND credits_balance >= ?
```

`org_settings`'s primary key was `edition` and `0096` made it `(tenant_id, edition)`. So with a
second customer this statement **matches two rows**. It would have debited both — and then
`res.meta.changes !== 1` is true (`changes === 2`), so the function returns `false` and the caller
answers **402 `no_credits`**, having just taken a credit from two customers for an upload that never
happened. §2 B24-30 names the refund half ("credit refunds charged to an edition, not a customer");
the reservation half is a transfer of value between customers *plus* a false refusal. The refund had
the mirror-image defect — `UPDATE … + ?` with no tenant predicate credits everyone in the edition.

Both now take `TenantScope`. **This is the arm `billing/ledger.ts`'s header handed to this session**
("deleted when T1-DECKS threads the deck's tenant through `reserveCredits`"), and it is threaded:

* `routes/decks.ts`'s two wrappers pass `scopeOf(c.var.user)` — there is a session there.
* `ai/health.ts`'s `markEvalTerminal` now selects `decks.tenant_id` and refunds to the deck's
  workspace. It has no session; `TenantPrincipal`'s docstring says a row carrying the two columns is
  exactly how a queue consumer builds a scope.
* `addDeckVersion` reads `(tenant_id, edition)` off the deck itself — see the next finding.

### 2. `addDeckVersion`'s signature did NOT change, deliberately, and `args.edition` has a new job

Its other caller is `routes/resubmit.ts` — T1-FLOW's file — and it is the **public tokenized founder
resubmit**, which has no `c.var.user` at all. So there is no scope for a caller to pass. The scope
is read off the deck row instead (`TENANT_OWNER`'s one-hop path, read directly because `decks` is
the owner table), which means **T1-FLOW needs no change and nothing of theirs broke**.

`AddVersionArgs.edition` is kept and is now the **cross-check**: if the row's edition disagrees with
the caller's, `addDeckVersion` throws. A caller that thinks it is re-versioning an incubator deck
and reaches a VC one is a routing bug, and spending one workspace's credit on another workspace's
deck is the §2 B24-30 shape with the sign reversed. Loud beats silent.

### 3. The AI path was scoring decks against whichever customer's rubric came back first

`ai/evaluate.ts` read `parameters`, `parameter_rubric_bands` and `org_settings` by `deck.edition`
alone. `org_settings` is a `.first()`, so with two customers **it returns an arbitrary one of them** —
and that row carries `ai_system_prompt` and `criteria_version`. Nothing leaks into a response. The
*evaluation* is wrong, and a wrong score looks exactly like a right one, which is §11's second
standing instruction applied one level deeper than the aggregates it was written about.

`DeckRow` there gained `tenant_id`, and the deck lookup itself stays unscoped on purpose: there is
no session in a queue consumer, and the row it returns is what every statement below it scopes from.

---

## Ratchet: what I promoted, and the negative control for each

Three probes, all `T1-DECKS`-owned, now `enforced` with the `owner` field dropped. **Every one was
negative-controlled** — I reverted the predicate to its original `edition`-only form, confirmed the
probe FAILS with `… leaked tenant B into …`, and restored. Measured 2026-09-30:

| Probe | Was | Negative control, with the predicate reverted |
|---|---|---|
| **B1 decks** `/api/decks` | `pending` | `× isolates — B1 decks` · `B1 decks leaked tenant B into /api/decks` |
| **B3 queries** `/api/queries` | `unprobed` | `× isolates — B3 queries` · `B3 queries leaked tenant B into /api/queries` |
| **B7 evaluators** `/api/evaluators` | `unprobed` | `× isolates — B7 evaluators` · `B7 evaluators leaked tenant B into /api/evaluators` |

The two `unprobed` ones needed fixtures first, exactly as the file's extension note demands
("promoting an `unprobed` case straight to `enforced` asserts nothing"):

* **`TENANT_B_FIXTURES.users` now writes two rows** — `zz_admin` and a new **`zz_jury`** — in one
  statement, because the registry assertion requires exactly one entry per table. T1-ESIGN used the
  same technique for `agreement_templates`. `zz_jury` exists because `/api/evaluators` and
  `/api/jury` filter to evaluator roles and `zz_admin` is an admin, which was that probe's stated
  `unprobed` reason verbatim.
* **`TENANT_B_PROXY_FIXTURES` is new** — tenant B's rows in tables that carry **no tenant column**,
  hanging off `zz_deck`. It could not go in `TENANT_B_FIXTURES`, whose registry assertion pins it
  equal to `TENANT_KEYED_TABLES`; the extension note names the need outright ("a `queries` /
  `calls` / `signups` row hanging off `zz_deck`"). It currently holds one entry, `queries`, with the
  MARKER in the letter text *and* in the founder's reply.

**It carries its own anti-vacuity assertion**, because a proxy fixture that landed but resolved to
tenant A would make its probe pass while proving nothing: the new case asserts the table has no
`tenant_id` column (so it belongs in the proxy map, not the keyed one) **and** that
`viaParent` puts the row in tenant B.

> **Other sessions: `TENANT_B_PROXY_FIXTURES` is where your `calls`, `signups`, `pipeline_events`
> and `signatures` rows go.** B4 activity, B11 calls and B12 signups are `unprobed` for exactly the
> reason `queries` was.

---

## Three judgement calls a reviewer should check rather than assume

### `DECK_DERIVED`'s twelve correlated subqueries carry no tenant predicate, and that is the answer

`routes/decks.ts`'s derived-column block reads `pipeline_events`, `queries`, `evaluations`, `scores`,
`deck_extractions`, `deck_assignments` and `calls` — about twenty `FROM` sites with no owner join
between them. A grep will flag every one. They are all **correlated on `d.id`**, and `d` is scoped at
all seven sites that interpolate the string, so the correlation *is* the scope: a row in another
customer's `pipeline_events` has a `deck_id` no scoped `d.id` can equal.

This is not the §5b exemption claimed loosely. §5b's hazard is a child read **in its own statement**
relying on a parent check one *frame* up — a guard that can be rearranged away. These cannot be
separated from their parent; `pipeline_events` has no `tenant_id` for a predicate to bind, and
routing each through `viaParent` would emit twelve more `JOIN decks` for an identical result set.
The decision, and the line that voids it ("if any of these is ever lifted out into a statement of
its own, it MUST take `viaParent`"), is written above the constant in the file.

### Two column-to-column conditions, which are the only SQL this session authored by hand

`DECK_JOINS` gained `AND u.tenant_id = d.tenant_id` and `AND pr.tenant_id = d.tenant_id`, and
`/api/evaluators`'s correlated `open_decks` count gained `AND d.tenant_id = u.tenant_id AND
d.edition = u.edition`. These bind **nothing** (column = column), so they cannot disturb bind order
at the seven call sites that interpolate `DECK_JOINS`, and they make a drifted foreign key render
NULL rather than another customer's name. T0's helper has no shape for a column-to-column
comparison, so these are hand-written; they are the only ones.

**I deliberately did NOT add the equivalent to the `cohorts` join.** `AND co.program_id = pr.id`
would silently drop the cohort name from any deck carrying a cohort with its programme column unset.
Correctness beat symmetry.

**And NOT to the two `LEFT JOIN users u ON u.id = s.evaluator_id` joins in the report route**:
`evaluator_id` is NULL on every AI row, so an inner-flavoured condition would delete the AI column
from the evaluation report. Those rows are already fenced by the scoped parent join.

### `decks/assignments.ts` and `decks/deckFile.ts` are untouched, and here is why

* `ASSIGNEE_PAIRS_SQL` is a UNION over two unscoped tables, but it is only ever used **correlated**
  against a scoped `d.id` or `u.id`. Where it is used as a FROM in its own right — `/board`'s
  assignee list — I scoped **both** `d` and `u` on that statement, because a pair whose deck is ours
  and whose evaluator is not would otherwise print that person's name.
* `checkDeckFile` and `decksWithoutFileKey` are preconditions that return a *subset* of an
  already-scoped id set; a cross-tenant id is 404'd by the caller before either runs. Scoping them
  would force a signature change on F-FOUL's deliberately asymmetric pair (its module explains why
  the asymmetry must stay) for no change in behaviour.

---

## Asks of other sessions

### 1. T1-COMMERCE — delete `recordLedgerEntry`'s `Edition` arm and `asScope`, at integration

**Your header's condition is met.** `reserveCredits` and `refundCredits` now thread a real
`TenantScope` from every call site in `src/`, so the transitional arm has **zero production
callers**. I left the `TenantScope | Edition` union on both functions and kept calling your `asScope`
for one reason only: two sibling sessions' **test** files still pass a bare edition —
`test/worker/billing.test.ts` (10 call sites, yours) and `test/worker/notifications.test.ts`
(3 sites, T1-PEOPLE's) — and narrowing the signature now would redden both in a shared tree.

At integration: narrow `reserveCredits`/`refundCredits` to `TenantScope`, delete `asScope`, and
update those 13 test call sites. `grep -rn "asScope" src/` should then return nothing.

### 2. T1-CONFIG — four functions of yours are still called with a bare `edition` from my files

I did not touch `src/server/config/**`. These are my call sites into it, and they will need their
second argument changed when you widen the signatures:

| Your function | My call sites |
|---|---|
| `loadScoringSettings(db, edition)` | `routes/decks.ts` ×7, `routes/pipeline.ts` ×2, `routes/assignments.ts` ×1 |
| `scoringSettingsFor(env, edition)` | `ai/evaluate.ts` ×1 |
| `loadScoreVisibility(…)` | `routes/decks.ts` ×1 |
| `maybeAutoClarify(…)` | `ai/evaluate.ts` ×1 |

**`scoringSettingsFor` is the one to think about**, because `ai/evaluate.ts` has no session: it must
take the scope I already build there from the deck row (`const scope = scopeOf({ tenantId:
deck.tenant_id, edition: deck.edition })`, right after the deck lookup), not a `SessionUser`.

### 3. T1-PEOPLE — `emitNotification` and `sendEmail` still take `edition`

`routes/decks.ts`, `routes/pipeline.ts`, `routes/assignments.ts` and `decks/versions.ts` all call
them with an edition. §2 **B22** is the one leak in the whole table that leaves the building — one
customer's deck event emailing every other customer's admins, startup name in the subject — so this
is the highest-consequence remaining item in my lane and it is not in my files.

What I *could* do from here, I did: every place a recipient address is **read** in my files is now
scoped. Both `uploaded_by` lookups in `routes/pipeline.ts` (the founder-query send and the sign-up
send) and the assignee/member reads in `routes/assignments.ts` take the workspace predicate,
precisely because those rows decide where the mail goes.

### 4. T1-FLOW — nothing, and that is the finding

`addDeckVersion`'s signature is unchanged (see finding 2), so `routes/resubmit.ts` needs no patch.
`mintResubmitToken(c.env, { deckId, edition, toEmail })` is called from `routes/pipeline.ts` with
the scoped deck's own edition; widen it if you like, the deck is already resolved in-workspace.

### 5. Integration — the `0091`–`0095` transitional indexes, and one of mine

Nothing I own upserts on one of the five blocked tables, so I added no `ON CONFLICT` to the nine the
ratchet names. But `routes/decks.ts`'s onboarding writer does
`ON CONFLICT(deck_id)` on `deck_onboarding`, which is a **proxy** table with a one-deck key — not
affected by the transitional indexes, and listed here only so the integration sweep can tick it off
rather than re-deriving it.

---

## The gate, honestly

| Check | Result |
|---|---|
| `npm run typecheck` | ✓ exit 0, whole repo |
| `npm run lint` | ✓ exit 0, whole repo |
| `npm test` | ✓ exit 0 — **2770 passed / 1 skipped, 146 files, 0 failed.** Baseline before the wave: 2709 passed / 1 skipped. |
| `npm run build` | ✓ exit 0 |
| e2e / playwright / roles | **Not run**, per the prompt and §11's gate — eight sessions cannot share the ephemeral port range. |

`test/worker/tenant-scope.test.ts` in isolation: **67 passed, 0 failed.** Nothing is left `pending` in
it, which is the condition §11 sets for integration — though that is the seven sessions' joint
achievement, not this one's. My three cases read `✓ isolates — B1 decks`, `✓ isolates — B3 queries`,
`✓ isolates — B7 evaluators`, and the new `✓ tenant B's proxy rows exist and reach tenant B through
TENANT_OWNER, not through a column`.

The suites that exercise my seven files most directly: `pipeline.test.ts` 23/23,
`vc-pipeline.test.ts` 18/18.

**Read the shared-tree note at the top before comparing these numbers to an earlier run of your own.**
Intermediate runs during this session showed up to 20 failures, and every one of them was either a
sibling's `pending` probe firing because they had just closed their leak, a sibling's half-written
file, or the four minutes when T0's helper was gutted. The numbers above were taken after all of that
settled.

### Two bugs of my own that the suite caught, and they were the same mistake twice

**I rewrote a statement's SQL to use the builder and left the old `.bind()` behind.**
`D1_ERROR: Wrong number of parameter bindings` at `routes/pipeline.ts`'s `/decks/:id/events` and at
`routes/decks.ts`'s post-PATCH re-read. Neither is caught by `tsc` — `.bind()` is variadic — and
neither is caught by the isolation suite, because a statement that throws returns no rows and
therefore leaks nothing. Only a functional test sees it.

So: **grep `\.bind(deck\.id)` and `\.bind(id)` across your owned files before you call your lane
done.** On a statement whose WHERE the builder owns, `...q.binds` should be the only thing in the
`.bind()` — plus head binds for a SET list, in that order. That grep is now clean in my seven files
(the single hit is this instruction, quoted in a comment in `routes/decks.ts`).

---

## What this session did NOT do

* **No migration.** 0101–0108 are integration's, and `ALLOTMENT_CEILING` is untouched.
* **No `src/shared/` edit.** `tenant.ts` is T0's and is read-only here; nothing else under
  `src/shared/` issues a query, and its `edition` is the product variant, per §11's resolved note.
* **No `routes/pricing.ts`.** Platform-global, eight tables, must not gain a tenant key (§3).
* **No change to any sibling's file**, including the two test files whose 13 call sites keep the
  transitional credit arm alive. Those are ask 1.
