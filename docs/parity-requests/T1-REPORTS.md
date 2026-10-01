# T1-REPORTS — the reports and the audit trail, scoped by customer

*Tenancy wave, `docs/plan_multitenancy.md` §11. Branch `tenancy/T1-REPORTS`, cut from
`main` @ `dc47712` (T0-SCHEMA). Owned paths: `src/server/routes/analytics.ts`,
`src/server/audit/**`, `src/server/routes/audit.ts`, plus the two tests the session
table allots. No migration. No e2e, no Playwright, no roles harness.*

---

## 1. The gate

| Check | Result |
|---|---|
| `npm run typecheck` | clean (3 projects) |
| `npm run lint` | clean |
| `npm test` | **2721 passed · 1 skipped · 147 files** (baseline on `dc47712` was 2709/1; +12 are this session's) |
| `npm run build` | clean, 1.12 s |

Run in a dedicated worktree (`../sj-T1-REPORTS`), not the shared checkout — T1-DECKS,
T1-ESIGN and others were editing `routes/decks.ts` and `test/worker/tenant-scope.test.ts`
underneath it during this session, and a result from a tree that moves means nothing.

**Zero behaviour change for the single tenant that exists.** All 2709 pre-existing tests
pass untouched, which is the regression proof: 18 widened predicates in `analytics.ts`
return exactly the rows they returned before for `t_default`.

---

## 2. What was wrong, in order of how much it mattered

§11 says T1-REPORTS carries the lowest weight (145) and the highest risk, because the
other six sessions leak **lists** and this one leaks **numbers**. That turned out to
understate it in one direction and overstate it in another, and both are worth recording.

### 2a. The write side was worse than the read side — `audit_log` (§2 B4/B5)

`recordAudit` named no `tenant_id` at all. Every audit row written by every mutating
route in the product took the column's `DEFAULT 't_default'`, so under two customers the
whole platform's trail would have been filed against the first one — a 200, a row, and
nothing to notice.

On a trail that is not a misplaced row. **It is a false accusation**: tenant A's audit log
would show tenant B's administrator changing tenant A's settings. Measured, not argued —
`tenant-scope.test.ts`'s new layer-3 case drives `PUT /api/audit/retention` as tenant B's
own admin and reads the row back; against `HEAD` it comes back `t_default`.

Same shape in `recordCreditMovement` (same file, `credit_ledger`): §2 B24's "credit
refunds charged to an edition, not a customer". `sum(delta)` is the balance, so a
misfiled refund credits one customer for another's failed evaluation.

### 2b. `purgeExpiredAudit` does not leak, it DESTROYS

`DELETE FROM audit_log WHERE edition = ? AND created_at < …`. Scoped by edition alone, one
customer setting a 30-day retention window deleted **every other customer's** expired trail,
on their schedule, and reported the combined count as `purged` — so a console showing
`purged: 4` looked exactly like one showing `purged: 1`.

This is the only finding in the session that is not recoverable, and `setAuditRetention`'s
`UPDATE … WHERE edition = ?` is how it was reached: tenant B's console set tenant A's
window, then the purge in the same request ran on it. Both are now measured by
`test/worker/audit.test.ts` ("purges only the caller's workspace, and counts only what it
purged" → reports `2` against HEAD) and by the ratchet's layer 3.

### 2c. The aggregates, which is what the session was warned about

Eighteen statements in `analytics.ts`, every one of them counting or averaging rows in a
table scoped only through `decks`. The three worst, each now with a live control:

* **`loadFundTotals`** — two `SUM`s over `programs.fund_size`, rendered as committed and
  allocated capital with `dryPowder` and `deployedPct` computed from them. Against HEAD the
  new VC case reports committed capital moving **300 → 5300** because another customer
  raised a fund. That does not read as a leak; it reads as a good quarter.
* **`humanEvalsByDeck`** — one statement, three reports. Against HEAD `/api/analytics/cohort`
  reports `avgScore` moving **7.1 → 6.7** because another customer scored a deck.
* **`/diligence`'s σ** — a standard deviation. A foreign score widens the spread and raises
  a "High evaluator disagreement" flag **against this customer's deal**.

### 2d. One statement had no workspace predicate of any kind

`myEvals` (`/my/scores`, `/my/drift`) was `WHERE e.evaluator_id = ?` with an unfiltered
`JOIN decks`. Not a read of someone else's evaluations — user ids are globally unique — but
a row whose `deck_id` pointed outside the caller's workspace would have been reported as
theirs. Now `.on("d")`, with the caller's id kept as the narrowing predicate it always was.

---

## 3. The one edit outside this session's paths

**`src/server/routes/pipeline.ts`, 3 lines** (an import and one property). Please look at
this at integration rather than merging it blind.

`GET /api/activity` is §2 B4 and the ratchet's `B4 activity` case names **T1-REPORTS** as its
owner, but the route *handler* lives in T1-DECKS' file. The leak itself is entirely in
`audit/log.ts` — both union branch predicates — and the fix required `AuditQuery.edition:
Edition` to become `AuditQuery.scope: TenantScope`.

That break was chosen deliberately over the alternative. An optional `tenantId` alongside
the old field would have compiled at both call sites and silently returned every customer's
rows from the one that did not pass it. A `TenantScope` cannot be half-supplied and
`scopeOf` takes a principal, so `scopeOf(c.req.query())` does not typecheck. The cost is one
line in a file another session owns:

```diff
   const { rows } = await listAudit(c.env.DB, {
-    edition,
+    scope: scopeOf(c.var.user),
     categories: ["pipeline"],
```

If it conflicts with T1-DECKS, the resolution is that line; nothing else in the hunk matters.

---

## 4. What changed in `test/worker/tenant-scope.test.ts`

The ratchet is now **5 enforced · 15 pending · 7 unprobed** (was 2 · 15 · 10). Every flip
below was watched failing first; none was promoted on faith.

| Case | Was | Now | How it was proved |
|---|---|---|---|
| `B5 audit` | pending | **enforced** | the ratchet fired on its own: the response had carried `ZZTENANTB transferred ownership`, §2's own example |
| `B4 activity` | unprobed | **enforced** | the fixture its `reason` asked for was added FIRST, the case was watched leaking, then the route was scoped |
| `B8 analytics evaluators` / `cohort` / `drift` | *absent* | **enforced** | three reports this session owns that the file carried no probe for at all; all three leak against HEAD |
| `B7 evaluators` | unprobed | **pending (T1-DECKS)** | this session supplied the `zz_jury` row its `reason` named, and it promptly leaked — see §5 |
| `B8 analytics funnel` | unprobed | **unprobed, with a different reason** | it cannot be marker-probed by anything; see §6 |

### New: `TENANT_B_PROXY_FIXTURES`

Ten cases were `unprobed` because `TENANT_B_FIXTURES` is asserted 1:1 against
`TENANT_KEYED_TABLES`, so a row in a scoped-**by-proxy** table had nowhere to go — while the
file's own "HOW TO EXTEND IT" §1b asked for "a `queries` / `calls` / `signups` row hanging
off `zz_deck`". `TENANT_B_PROXY_FIXTURES` is that place. It seeds after the keyed fixtures,
is asserted non-empty by row count, and carries three entries today (`zz_jury`, `zz_eval`,
`zz_pe`).

**T1-FLOW and T1-DECKS: your `unprobed` cases (B3 queries, B11 calls, B12 signups) need one
line each here.** That is the whole fixture.

### New: layer 2c — the aggregate ROUTES

`AGGREGATE_PROBES` compares two SQL statements the test writes itself. It never calls the
product, so nothing in the file could see the leak §11 calls the dangerous one. Layer 2c
asserts the product's own number, by value, with the control that cannot go vacuous: **give
tenant B more rows and require the number not to move**, while proving in the same test that
the rows landed and that an unscoped count does move.

---

## 5. Four measured corrections to what the plan and the test file assumed

**1. `zz_deck`'s `ai_score` was load-bearing and absent.** `GET /api/analytics/drift` selects
`WHERE ai_score IS NOT NULL`, so with it null the drift probe answered 200 with tenant B
absent and **passed against a completely unscoped `analytics.ts`**. Caught by the negative
control, not by reading. The `decks` fixture now carries `ai_score = 1.1` with a comment
saying not to remove it without re-marking that probe `unprobed`. *This is the failure mode
the `unprobed` status exists to prevent, reappearing inside an `enforced` case.*

**2. A control whose before and after cannot differ is not a control.** The first version of
the cohort-mean case added a second `9.9` evaluation to a deck that already had one. The mean
stayed 9.9, the body was byte-identical, and the case passed against unscoped code. It adds
`1.0` now.

**3. An unscoped `first()` over `org_settings` passes by luck of insert order.** Nothing
indexes `edition` alone, so `WHERE edition = ?` is a table scan and the migration's own row
is reached before any row a test inserts. The retention-read case therefore inserts the other
customer's row with an **explicit negative `rowid`**, which is what makes it a control rather
than a coincidence. Any session asserting "the caller's own row" against a `first()` needs
this trick or it is testing nothing.

**4. Supplying a missing fixture moves another session's case, and should.** `zz_jury` was
added for this session's own reports; it immediately made `B7 evaluators` (T1-DECKS) leak.
Marked `pending` with its real owner rather than worked around — T1-DECKS now has a negative
control on `pipeline.ts:1186` instead of a case that could not have failed. Expect more of
this as the other six sessions add proxy fixtures; a sibling's `unprobed` turning `pending`
is the file working.

---

## 6. What this session did NOT close, and why

**`GET /api/analytics/funnel` stays `unprobed`, permanently.** `buildFunnel` returns stage
labels from a constant and counts from the rows; no text from any deck reaches the response,
so **no fixture can put a marker in it**. The case keeps its status with a rewritten reason
pointing at layer 2c, which is where the funnel's isolation is actually asserted — by value,
against tenant B gaining three decks. Marking it `enforced` on a marker sweep would have been
the most misleading line in the file.

**Two loaders this session calls are unscoped and belong to T1-CONFIG.** Both take an
`Edition` and read a tenant-owned table:

| Function | File (T1-CONFIG's) | Table |
|---|---|---|
| `loadScoringSettings` | `src/server/config/scoringSettings.ts:79` | `org_scoring_settings` |
| `loadScoreVisibility` | `src/server/config/scoreVisibility.ts:25` | `score_visibility` |

`analytics.ts` calls both on seven code paths. They decide whether drift analysis renders,
whether a juror sees an AI score, and **which evaluators' scores fold into every mean** — so
unscoped they are a settings leak with a numeric consequence, not a cosmetic one. Not touched
here: changing their signatures is the same compile-time break §3 describes, in a file this
session does not own. `score_visibility` is additionally one of the five
`BLOCKED_BY_TRANSITIONAL_KEY` tables, so it cannot be probed until integration drops
`score_visibility__pre_tenant_key`. **T1-CONFIG: these are two of yours.**

**The VC aggregate cases live in `analytics.test.ts`, not in the ratchet.** The isolation
file's tenant B is an incubator workspace, and the four VC reports answer 403 `wrong_edition`
to an incubator principal — so none of its layers can reach `/capital`, the worst number in
the file. T1-ESIGN is adding a `VC_ADMIN` principal to that file for `/api/diligence` (§2
B14); **at integration these two cases should move across behind it** rather than staying a
second home for the same idea.

---

## 7. Negative controls run

Every assertion added here was watched failing. Restores were by file copy, never via git —
the shared checkout had other sessions' uncommitted work in it all session.

| # | What was broken | What failed |
|---|---|---|
| NC1 | `routes/analytics.ts` → HEAD | `B8 analytics evaluators` · `cohort` · `drift`; funnel top 16→19; cohort `avgScore` 7.1→6.7 |
| NC2 | `audit/log.ts` + `routes/audit.ts` + `routes/pipeline.ts` → HEAD | `B5 audit` · `B4 activity`; audit row filed as `t_default`; tenant A's retention window set to tenant B's 3650 |
| NC3 | the purge predicate only | `purged: 2` instead of 1, and tenant B's expired row deleted |
| NC4 | the retention-read predicate only | the console read `30` — another customer's window — instead of `365` |
| NC5 | `routes/analytics.ts` → HEAD, VC cases | committed capital 300→5300; `RIVALCO` in the portfolio and decision reports |

One statement in the owned paths is deliberately **not** scoped: `packPriceMinor`, which
reads `price_plans` and `price_amounts` — two of the eight `PLATFORM_GLOBAL_TABLES`. One
catalogue serves the whole product (§3), and `0100`'s integrity assertion fails the chain if
a tenant key is ever added to them. It carries a comment saying so, because it is the one
edit in this file a sweep "finishing the job" would get wrong.

Census after the change: 28 `prepare()` across the four owned files, 28 accounted for — 27
scoped (18 analytics · 8 `log.ts` · 1 `events.ts`), 3 of them writes through `insertScope`,
and `packPriceMinor` excluded on the record. No bare `edition = ?` predicate survives in any
owned path.
