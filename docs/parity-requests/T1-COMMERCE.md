# T1-COMMERCE — handoff

*Session T1-COMMERCE of the tenancy wave (`docs/plan_multitenancy.md` §11), run 2026-09-30 from
`main` @ `dc47712` (T0-SCHEMA merged). Owned: `src/server/routes/account.ts` ·
`src/server/routes/billing.ts` · `src/server/billing/**` · `src/server/routes/support.ts` and the
three tests §11 assigns. **No migration.** Every number below was measured on this tree.*

---

## 1. The gate

| Check | Result |
|---|---|
| `npm run typecheck` | clean (all three projects) |
| `npm run lint` | clean |
| `npm test` | **2770 passed · 1 skipped · 0 failed** (147 files), 138 s at load average 44 |
| `npm run build` | clean |
| `npm run test:e2e` / `npm run roles` | **not run — forbidden until integration** (§11, §12.9) |

Owned-file counts, before → after: `account.test.ts` 24 → **30**, `billing.test.ts` 32 → **43**,
`support.test.ts` 14 → **21**, `tenant-scope.test.ts` 43 → **67** (the last figure includes other
sessions' rows landing in the same file).

**The starting baseline was NOT green and none of it was mine.** `npm test` at session start was 52
failed / 2657 passed, in `esign-provider`, `esign`, `seats`, `signups` and `tenant-scope` — all of it
sibling sessions' uncommitted work in the shared tree (see §6). My seven relevant files were
122/122, and my four ratchet rows plus the layer-3 write probe all passed as `pending` facts, which
is the baseline that matters: the leaks this session closed were measured as present.

---

## 2. The three `ON CONFLICT` sites — and the plan correction that is bigger than the plan expected

The brief named these as three of the nine upserts blocking integration:

| Site | Table | Was | Now |
|---|---|---|---|
| `routes/account.ts` organisation branch | `account_profiles` | `ON CONFLICT (edition)` | `ON CONFLICT (tenant_id, edition)` |
| `routes/account.ts` individual branch | `account_profiles` | `ON CONFLICT (edition)` | `ON CONFLICT (tenant_id, edition)` |
| `routes/billing.ts` `PUT /subscription` | `billing_subscriptions` | `ON CONFLICT (edition)` | `ON CONFLICT (tenant_id, edition)` |

All three also now name `tenant_id` in the INSERT column list, via `insertScope()`.

### 2a. `0094`/`0095`'s headers predict the wrong failure, and the truth is worse

Both migration headers say the old target *"stops resolving"* once `tenant_id` joins the key, with
`ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint`. **It does not stop
resolving.** The transitional index those migrations deliberately left standing —
`account_profiles__pre_tenant_key` / `billing_subscriptions__pre_tenant_key`, both
`UNIQUE (edition)` — *is* a matching unique constraint, so the statement runs.

Measured on SQLite 3.51 against exactly that shape (widened PK + standing `UNIQUE (edition)`), and
then re-measured inside D1 itself:

```sql
-- widened PRIMARY KEY (tenant_id, edition), plus a standing UNIQUE (edition)
INSERT INTO ap (tenant_id, edition, v) VALUES ('t_zz','incubator','tenantB')
  ON CONFLICT (edition) DO UPDATE SET v = excluded.v;
-- → t_default|incubator|tenantB      ONE row. Still tenant A's key. Tenant B's data.
```

No error. No second row. **A cross-tenant destructive overwrite that answers 200.** Through the
routes that means:

- `PUT /api/account/profile` — the second customer's organisation name, business type, employee
  band, city, country and the entire contact block are written **into the first customer's
  commercial record**, which is then read back and reported as saved. The first customer's record is
  simply gone.
- `PUT /api/billing/subscription` — the second customer's billing email, cycle anchor and **GSTIN**
  replace the first's. GSTIN is the worst field in the three tables to get wrong: it prints on every
  tax invoice that customer issues, so one customer's save puts another customer's GST registration
  on documents already filed.

Naming the widened key converts that into the loud `UNIQUE constraint failed: …edition` the two
migrations intended. Verified in both directions:

| | result |
|---|---|
| tenant A upserts its own row, widened target | updates in place — **unchanged behaviour** |
| tenant B inserts, widened target | `UNIQUE constraint failed` — refused |
| tenant B inserts, old target | silently overwrites tenant A, returns 200 |

**That is why these three sites block integration, and the reason is not the one the plan gives.**
It is not that a second tenant's row *cannot be stored*; it is that it *is* stored, in the first
tenant's row, destructively and silently. The fix is strictly a prerequisite to 0101–0108 rather
than a tidy-up after it.

### 2b. The transitional indexes are NOT dropped

As instructed. Both still stand, and `billing.test.ts` has a case that **fails when they go**,
naming what to do next:

> `<table>`'s transitional UNIQUE (edition) is gone — integration has run, so the two "blocked"
> cases above can become real second-tenant isolation cases

`account_profiles` and `billing_subscriptions` therefore stay in `BLOCKED_BY_TRANSITIONAL_KEY` in
`test/worker/tenant-scope.test.ts`, correctly.

### 2c. The key is the PAIR, and your correction is confirmed from a second direction

The brief's correction — both tables are `(tenant_id, edition)`, not `tenant_id` alone — is what
`0094`'s production read found (`incubator 1, vc 1`: one customer, two commercial records). This
session carries both columns everywhere, `.on()` and never `.onTenantOnly()`.

It also found the **consequence** the schema correction implies for application code: because the
row's identity is now the pair, `targetId: edition` on the two audit rows named a target two
customers would share. Both are now `` `${tenantId}:${edition}` `` — `routes/account.ts`
(`account_profiles`) and `routes/billing.ts` (`billing_subscriptions`).

---

## 3. A second silent defect, in `0097`'s own subject

`0097` widened `billing_invoices UNIQUE (edition, number)` to
`UNIQUE (tenant_id, edition, number)` precisely so the second customer's first invoice would not
compete for `INV-2026-0001`. That removed the **collision**. It did not fix the **counter**:

```ts
// issueMissingInvoices, before:
"SELECT COUNT(*) AS n FROM billing_invoices WHERE edition = ?"
```

So the second customer's very first invoice would have been numbered from the *first* customer's
invoice count — an account that opens at `INV-2026-0009` with no 0001–0008 anywhere in it. No error,
no duplicate, and a numbering gap a customer's auditor asks about. The count is now workspace-scoped
and `billing.test.ts` asserts tenant B's first document matches `/^INV-\d{4}-0001$/` while tenant A
already holds invoices.

**This is `0097`'s header being right about the constraint and silent about the sequence.** Worth
checking the other widened `UNIQUE`s for the same shape — `agreement_templates` (`0096`) and
`crm_connections` (`0098`) belong to T1-ESIGN.

---

## 4. What was scoped

Every prepared statement in the four owned file groups was classified; **38 sites, nothing left
over**:

| File | Scoped | Deliberately platform-global |
|---|---|---|
| `routes/account.ts` | 7 | 1 — `pricing_versions` |
| `routes/billing.ts` | 2 | 1 — `price_plans` |
| `routes/support.ts` | 11 | 0 |
| `billing/ledger.ts` | 12 | 3 — `pricing_settings`, `price_plans` ×2 |
| `billing/provider.ts` | 1 | 0 |

The four global reads are §3's price catalogue and are **left unscoped on purpose**, each with the
reason at the call site. `account.test.ts` has a case that asserts the catalogue still crosses
(one book, product-wide) *and* that `pricing_versions` carries no `tenant_id` column — so a later
sweep that "finishes the job" fails a test rather than `0100`'s integrity assertion in production.
`routes/pricing.ts` was not touched.

Signatures widened in `src/server/billing/**` (all now take a `TenantScope`): `listLedger`,
`readBalance`, `purchasedTotal`, `readSubscription`, `listInvoices`, `loadInvoice`,
`issueMissingInvoices`, `listIntents`, `usageTotals`. `readTaxSettings` deliberately still takes
only an `Env`. `PaymentIntentAttempt.tenantId` is a **required** field — an optional one would have
let the column's backfill default file one customer's purchase against another with a 200.

Two shapes beyond the plan's three, both now covered everywhere in these files:

- **Joins to tenant-keyed tables also match the workspace** — column-to-column, no bind, so bind
  order at the interpolating call sites cannot move. These are reached by an id that a scoped parent
  validated, so they cannot cross today; what they can do is *render* a drifted id as another
  customer's text, and in each case the joined column is the one the screen prints:
  `decks.name` → the usage-history sentence, `users.name` → a ticket's `creator`, an issue's
  `assignee`, a message's `sender`, `billing_payment_intents.plan_name` → a receipt.
- **`UPDATE`s**, which are where an insufficient predicate stops leaking and starts mutating:
  `POST /api/tickets/:id/status` and `PATCH /api/issues/:id` could both have closed, re-severed or
  re-assigned another customer's row and reported `changes === 1` doing it.

### Two findings inside `support.ts` worth repeating

1. **`GET /api/messages`'s per-user arm looked safe and was not.** `m.from_id = ?` already narrows
   the rows, so the query appeared bounded — but that is a property of *this caller* (it binds its
   own id), not of the statement. The same reasoning is in `tenant-scope.test.ts`'s `unprobed` note
   for `/api/notifications`, which is **T1-PEOPLE's** row: *"scoped per USER, so tenant A's admin
   would not see tenant B's notification even with no tenant predicate at all."* That reasoning is
   true of the caller and not of the query, and it is the same shape as the recurring
   role-boundary-leak class. Worth T1-PEOPLE re-checking rather than promoting on that note alone.
2. **`/api/issues` was not on the worklist.** §2 B20 names `/api/tickets`, `/api/issues` and
   `/api/messages`, but `ROUTE_PROBES` carried only two of the three. It leaked identically
   (`support.ts:133`, one flat edition-keyed pool). It is now scoped and has a new `enforced`
   ratchet row — `{ id: "B20 issues", … }`.

Also: `PATCH /api/issues/:id`'s existing `invalid_assignee` guard checked the *edition*. Under
tenancy that let an administrator assign their own issue to **another customer's employee**, whose
name then renders as `assignee` on the log — a one-field leak of somebody else's roster through a
write. The guard was already the right shape; it needed the other half of the key.

---

## 5. The ratchet

| Row | Was | Now |
|---|---|---|
| `B16 billing` → `/api/billing` | `pending` (T1-COMMERCE) | **`enforced`** |
| `B18 account` → `/api/account` | `pending` (T1-COMMERCE) | **`enforced`** |
| `B20 tickets` → `/api/tickets` | `pending` (T1-COMMERCE) | **`enforced`** |
| `B20 messages` → `/api/messages` | `pending` (T1-COMMERCE) | **`enforced`** |
| `B20 issues` → `/api/issues` | *(absent)* | **`enforced`**, added |
| layer 3 — `POST /api/tickets` lands in `t_default` | `pending` fact | **promoted**: lands in `TENANT_B` |

The layer-3 promotion is the one that could not have been reached any other way. The pending fact
recorded on 2026-09-30 was that `support.ts`'s INSERT named no tenant, so `tickets.tenant_id`'s
`DEFAULT 't_default'` (`0084:62`) took effect and a second customer's ticket was filed against the
first — **200, a row present and complete, nothing in the response to notice.** No read-side
negative control can see that.

`AGGREGATE_PROBES`' `credit balance must not sum across customers` row needed no change: it asserts
the probe stays *detectable*, not the product. The product assertion is in `billing.test.ts`.

---

## 6. Two notes on how this session ran, for whoever runs the next one

**(a) The "worktree-isolated" sessions share one checkout — again.** `git status` went from one
dirty file to 34 while this session ran, across `decks/**`, `esign/**`, `seats/**`, `crm/**`,
`scheduled.ts` and `tenant-scope.test.ts`. Consequences actually hit:

- The starting `npm test` baseline was 52-red and none of it was mine. Per-file runs were the only
  way to establish a real baseline.
- `tenant-scope.test.ts` was transiently **unparseable** mid-session — a duplicate `import type
  { Env }` from a concurrent edit — and self-resolved a minute later. A single run is not evidence
  about that file; re-run before concluding anything.
- Nothing was `git stash`ed, `git commit -a`'d, or reverted. Mutation testing (§7) was done on
  copies restored immediately, and the one shared file I mutated (`src/shared/tenant.ts`) ends the
  session byte-identical to T0's version — verified with `git diff`.

**(b) Zero cross-session edits were needed, because the siblings had already converged.**
T1-PEOPLE's in-flight code carried comments asking T1-COMMERCE to widen `readSubscription` and to
add a tenant to `recordPaymentIntent`, and by the time I shipped those signatures their call sites
already passed `scope` and `tenantId`. T1-DECKS had independently imported `asScope` and threaded
real scopes through `reserveCredits`/`refundCredits`. **I edited no file another session owns.** If
the wave is run again, that convergence is worth relying on deliberately rather than by luck:
publish the module boundary signatures first, then let the owners adapt their own files.

---

## 7. Every new test was negative-controlled

Three mutations, each reverting a different half of the work on an otherwise-correct tree:

| Mutation | Result |
|---|---|
| `ScopeBuilder.on()` drops `tenant_id` (i.e. the whole wave reverts to edition-only) | **19 failures** across the three owned test files |
| `insertScope()` drops `tenant_id`, reads left correct | **9 failures** — every write assertion, independently of the read ones, plus `tenant-scope.test.ts` layer 3 |
| the three `ON CONFLICT` targets revert to `(edition)`, everything else correct | **2 failures**, one per real table, through the HTTP routes — `"tenant A's commercial record was destroyed by another customer's save"` and `"expected 200 to be 500"` |

Each isolation case also asserts the **positive** half — tenant B's own read returns tenant B's row,
tenant B's own admin can close its own ticket, tenant B's own invoice loads — so a scoped read that
returns nothing because of a typo, a mis-ordered bind or a fixture that never landed fails instead
of passing. Each describe block opens with a *"the fixture really landed"* case, and the aggregate
case decomposes the unscoped `SUM` into the exact three workspaces that exist in the file, so it
fails if a fourth appears rather than quietly losing its power to detect a leak.

One measured testing trap, which cost an hour and will cost the next session the same: **the workers
pool runs with isolated storage, and a `beforeAll` inside a `describe` is popped when that suite
ends.** A second tenant created in the first describe's `beforeAll` no longer existed by the third,
and the symptom was a bare `401 unauthorized` from `login()` with nothing to indicate why. Every
second-tenant fixture in these three files is therefore at **file level**.

---

## 8. Open, and who owns it

1. **`recordLedgerEntry` still accepts a bare `Edition` — T1-DECKS.** The signature is
   `TenantScope | Edition`; the `Edition` arm normalises through the exported, named `asScope()` and
   lands in `DEFAULT_TENANT_ID`. Widening it outright would have cascaded through `decks/versions.ts`,
   `routes/decks.ts` (8 sites), `ai/health.ts` and two sibling test files — and the real blocker is
   design, not signature: `reserveCredits`/`refundCredits` are reached from the **public founder
   resubmit path with no session at all**, so their tenant must come off the deck row
   (`TENANT_OWNER`'s one-hop path), inside T1-DECKS' files. **As of this session's end T1-DECKS has
   already done it** — they import `asScope` and pass real scopes — so what remains is deleting the
   `Edition` arm and `asScope()` once no caller needs them. One commit, at integration.
2. **`src/server/audit/log.ts:183` writes `credit_ledger` with no tenant — T1-REPORTS.**
   `recordCreditMovement` is the other writer of that table and it is in their file. Every *read* of
   `credit_ledger` is scoped by this session, so a mis-tenanted write there lands in `t_default` and
   becomes invisible to the customer that made it — silent in both directions.
3. **The two `blocked` tables become testable at integration.** Once 0101–0108 drops
   `account_profiles__pre_tenant_key` and `billing_subscriptions__pre_tenant_key`, three cases turn
   over together: the guard in `billing.test.ts` fails by design, and the two "refused loudly" cases
   (`account.test.ts`'s profile upsert, `billing.test.ts`'s `PUT /subscription`) should become real
   second-tenant isolation cases. They are written to be converted, not deleted — the fixtures and
   the before/after row comparisons stay; only the expected status changes from 500 to 200 and the
   assertion becomes "tenant B now has its own row, and tenant A's is still there".
4. **`account.test.ts`'s `POST /orders` tenancy case uses a customer in the `vc` edition**, because
   the wizard needs a profile and a second customer cannot have one in an occupied edition while
   (3) stands. That pair differs in **both** halves of the workspace key, so it proves only that the
   two INSERTs bind the tenant they were handed — which is the silent-failure assertion and nothing
   else. Read isolation is proven on the same-edition pair in the describe above it. When (3) lands,
   move this case to the same-edition pair; the comment at the case says so.
5. **Check `0096` and `0098` for `0097`'s counter defect (§3) — T1-ESIGN.** Widening a `UNIQUE` that
   contains a derived sequence fixes the collision and leaves the sequence wrong.
