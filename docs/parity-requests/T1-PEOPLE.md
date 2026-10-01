# T1-PEOPLE — handoff note

*Tenancy wave T1, the people lane: `routes/users.ts` · `routes/seats.ts` · `src/server/seats/**` ·
`routes/notifications.ts` · `src/server/email/**` · `src/server/scheduled.ts`. Cut from `main` @
`dc47712` (T0-SCHEMA merged: migrations `0083`–`0100`, `src/shared/tenant.ts`,
`test/worker/tenant-scope.test.ts`). **No migration** — `0101`–`0108` are integration's headroom and
this session added none.*

*e2e, playwright and `npm run roles` were **not** run, per the prompt and §11's gate.*

**Gate, re-taken on the settled live tree at the end of the session — all four exit 0:**

| | pristine `dc47712` | live tree, end of session |
|---|---|---|
| `npm test` | 2711 passed · 1 skipped · 0 failed (147 files) | **2780 passed · 1 skipped · 0 failed (147 files)** |
| `npm run typecheck` | pass | **pass** |
| `npm run lint` | pass | **pass** |
| `npm run build` | pass | **pass** |

That live number is **all seven T1 sessions** together, so +69 tests is the wave's, not mine.
`tenant-scope.test.ts` alone: **67 passed, 0 failed, nothing left `pending`**. The eight test files
covering this session's surface: **170 passed, 0 failed**. This session's diff is
**1,019 insertions / 227 deletions across 9 files** (6 source, 3 test).

---

## Read the gate numbers with this caveat first

`git status` in this checkout lists **51 changed paths belonging to five of the seven T1 sessions** at
once — the [[wave-r-shared-tree]] situation again. Only **T1-CONFIG** and **T1-REPORTS** got real
worktrees (`../sj-T1-CONFIG`, `../sj-T1-REPORTS`); **T1-DECKS, T1-COMMERCE, T1-ESIGN, T1-FLOW and
T1-PEOPLE all share this one**, including `test/worker/tenant-scope.test.ts`. Which also explains a
reading that would otherwise look odd: `B5 audit` and the three `B9 config` rows are still `pending`
in the live ratchet, because the two sessions that own them are working somewhere else and their
promotions land at integration.

Consequences I worked around rather than ignored:

* **Nothing was stashed and nothing was committed from here.** No `git stash`, no `commit -a`.
* **The first baseline I took was worthless** and that is worth recording. `npm test` on this
  checkout at 21:02 reported **52 failed / 2657 passed**, which looks like a catastrophe and is
  nothing of the kind: `src/server/routes/decks.ts` was mid-edit by T1-DECKS. A pristine
  `git worktree` at `dc47712` gave the real baseline, **2711 passed · 1 skipped · 0 failed across 147
  files**. If you report a number from a shared tree, say which tree.
* **Every negative control in §8 was run in an isolated worktree, except the five against
  `scheduled.ts`**, which I ran in this checkout with a `.bak` beside each file and restored
  immediately. That is the same hazard T1-DECKS recorded about `src/shared/tenant.ts` at 21:32, and
  mine had the same shape: for a few seconds at a time, a sibling's in-flight `npm test` would have
  seen `scheduled.ts` with its tenant predicate removed. `find src test -name '*.bak'` is empty and
  `git diff src/server/scheduled.ts` is mine alone. **Next wave: run negative controls in a
  worktree, not in the shared checkout.**

### Measured, isolated: my work alone, against the sibling APIs it calls

This was taken MID-session, while the siblings were still mid-edit; it is kept because it is the only
reading that attributes failures, and because the twelve it found were all explained.

A worktree at `dc47712` + the whole working tree, with `tenant-scope.test.ts` reduced to
HEAD + only this session's edits (the live file was being extended by three sessions at once):

| | pristine `dc47712` | this session, isolated |
|---|---|---|
| `npm test` | 2711 passed · 1 skipped · 0 failed | **2724 passed · 1 skipped · 12 failed** |
| `npm run typecheck` | pass | **pass** |
| `npm run lint` | pass | **pass** |
| `npm run build` | pass | **pass** |

**All twelve failures are attributable, and none is mine:**

* **10** are sibling sessions' `pending` ratchet rows firing because that worktree carried their
  source changes — B1 decks (T1-DECKS), B15 ×2 (T1-ESIGN), B16/B18/B20 ×2 + layer 3 tickets
  (T1-COMMERCE), B24/B13 (T1-FLOW). Theirs to promote; I touched none of them.
* **2** are one bug in `src/server/routes/pipeline.ts:1214` (T1-DECKS, in flight):
  `D1_ERROR: Wrong number of parameter bindings`, reddening the incubator and VC happy paths.
  **Verified not mine**: it reproduces in a worktree carrying every sibling change with my six source
  files and three test files reverted to `dc47712`.

By the end of the session the siblings had promoted their rows and fixed the `pipeline.ts` bind bug,
and the live tree is green on all four gate commands — the table at the top is that reading.

---

## What shipped

### 1. The call site T0 left here deliberately — `routes/users.ts:287`

`getUserByEmail` → `getUserByEmailInScope(c.env.DB, email, scope)`.

It is not tidiness. `0001_init.sql:7` made `users.email` globally `UNIQUE`, so "does this address
exist?" and "is this address free *here*?" were the same question and the 409 was right. `0087` made
the constraint `UNIQUE (tenant_id, email)`, and from that moment the global form is wrong in **both**
directions:

* it **refuses** tenant B's admin the right to add a colleague tenant A already employs — §7 Q4's
  "two customers employing the same person is not an edge case; it is the second customer";
* and the 409 itself **discloses** that the address is in use somewhere on the platform, which is a
  membership oracle an administrator should not hold.

Asserted both ways in `tenant-scope.test.ts`'s new layer-3 case, which creates a colleague **using
tenant A's admin's own address**: a 409 there is the bug, a 200 is the fix.

### 2. §2 B22 — the one leak in the table that leaves the building

`emitNotification`'s fan-out (`email/outbox.ts`) chose recipients with
`SELECT … FROM users WHERE edition = ? AND active = 1 AND <roles>`. No tenant. One customer's deck
event **emailed every other customer's admins and programme managers**, with the startup's name in
the subject. Nobody has to open a screen for that to have happened.

It is now `scoped(scope).on("u")`, and the `alsoNotify` ids are inside the same scoped predicate
rather than beside it — an `OR id IN (…)` outside the scope would be a hole the same size.

**And it closes for callers whose files I do not own.** `sendEmail` has 7 call sites and
`emitNotification` 10, across five sessions' files; a required `scope` field would not compile in nine
of them and §11 forbids merging red. So `scope` is **optional and resolved** (`resolveTenant`), in
descending order of authority:

1. the caller's own `scope`;
2. **the tenant of the deck the message is about** — which covers `ai/evaluate.ts`,
   `routes/pipeline.ts`, `routes/decks.ts`, `routes/assignments.ts`, `routes/calls.ts`, `resubmit.ts`
   and `config/autoQuery.ts` without editing any of them;
3. `DEFAULT_TENANT_ID` with a `console.warn`. Identical to today while one customer exists, and
   visible in logs the moment a second is not.

It deliberately does **not** fall back to the recipient's `users` row: under
`UNIQUE (tenant_id, email)` an address resolves to a *set*, not a tenant, and picking one is guessing.

### 3. §2 A8 — the dedupe key, and a correction to what A8 says

`monthly_usage_summary:${edition}:${month}` → `…:${scope.tenantId}:${scope.edition}:${month}`. It was
the one key in the codebase not derived from a globally unique id, which is why §2 singles it out and
`0099`'s header hands the call-site half to this session.

**The correction, and it changes the risk rather than the fix.** A8 says tenant B's digest is
"silently swallowed as a duplicate of tenant A's". **Measured, it would not have been.**
`emitNotification` appends `:${user.id}` to every per-recipient key (`email/outbox.ts`), and
`users.id` is globally unique, so the two customers' keys already differed. What **was** true, and is
worse, is that the producer looped over the two **editions** and the fan-out choosing those
recipients carried no tenant at all (B22) — so each pass mailed **every** customer's administrators a
report whose four numbers were summed across all of them. **Not a lost digest: a wrong one, sent to
the wrong people, and filed in `email_outbox` as the evidence that it was sent.**

Both halves are closed, and the key is asserted three ways so neither can come back: both customers
reached, every key naming its own customer, and the per-recipient suffix still present — because
`idx_outbox_dedupe ON email_outbox (dedupe_key)` is **still globally unique** (`0099` re-cut the
`notifications` one and had no slot for this), so without a unique component no second customer could
hold a row at all.

### 4. The `ON CONFLICT` site — `seats/ledger.ts:203`

`ON CONFLICT (edition)` → `ON CONFLICT (tenant_id, edition)`, naming `0095`'s widened PRIMARY KEY.
**The transitional index `billing_subscriptions__pre_tenant_key` is NOT dropped** — this session has
no migration slot, and three of the nine sites were still unwidened when I finished.

Worth naming what the old target would have done rather than just that it was stale: a second
customer's seat grant would have found **tenant A's subscription row by `(edition)` alone and added
its seats to it** — which is exactly what T1-COMMERCE measured independently and recorded as
[[on-conflict-silent-cross-tenant-overwrite]]: the transitional index *is* a matching unique
constraint, so `DO UPDATE` runs against the other tenant's row and returns 200. `0091`–`0095`'s
headers predict a loud "does not match any PRIMARY KEY or UNIQUE constraint" and are wrong.

**I measured the widened form in D1 rather than inferring it from those same headers**, since they
had already proved unreliable. A second customer's first seat purchase, widened target, transitional
index still standing:

```
THREW:  UNIQUE constraint failed: billing_subscriptions.edition
BEFORE: t_default | vc | 5
AFTER : t_default | vc | 5      ← untouched
```

Loud, and tenant A's row unchanged. **One detail for whoever reads the logs: the error names the
COLUMN, not the index** — grepping for `__pre_tenant_key` will not find it.

### 5. The cron — the one place in the wave with no principal

`scheduled.ts` runs from a Cron Trigger, so there is no session to take a scope from. The file
carried a note addressed to this session saying so and calling itself "the single genuine leak site
in the whole body of work"; the note is answered in place.

* **`liveWorkspaces(env)`** enumerates `organizations WHERE status IN ('active','trial')` × the two
  editions. It **replaced** the old top-level `for (const edition of …)` rather than nesting inside
  it, so the note's requirement — the tenant dimension at exactly one site — holds.
* `suspended` is excluded: `routes/auth.ts` already refuses a suspended organisation's sign-in, and
  continuing to mail a workspace nobody can open is worse than silence.
* **`runReminders` carried no scope of any kind** — not even `edition`. It swept every deck on the
  platform. Its signature is unchanged because `src/server/index.ts` calls it and is not this
  session's file; the tenant dimension is internal.
* The reminder join is `JOIN users u ON u.id = ap.evaluator_id AND u.tenant_id = d.tenant_id`.
  `decks.assigned_to` is a plain FK to `users(id)` with nothing tenant-aware about it, so a
  cross-tenant assignment is **representable** even though no route should create one — and without
  that condition the sweep scopes the deck correctly and then mails whoever the id points at.
  Asserted, with the corrupt row created on purpose.
* `usageSummary`'s four counts are §11's dangerous shape at its sharpest: they are not displayed,
  they are **emailed as a report**. `creditsRemaining` is the worst of them because it is a
  single-row `.first()` on `org_settings` — unscoped, a customer with no row at all is handed the
  seeded workspace's balance and told they have credits they never bought.

### 6. Everything else, by statement

**37 prepared statements across six files.** All of them now name the owner, except the one that must
not (`readPublishedBook`, `pricing_versions` — one of §3's eight platform-global tables; a sweep that
"finishes the job" there fails `0100`'s integrity assertion).

Three worth calling out beyond the mechanical widening:

* **`GET /api/notifications/outbox`'s `users` join changed MEANING, not just scope.** It was
  `LEFT JOIN users u ON u.email = o.to_email`, single-valued only because `users.email` was globally
  `UNIQUE`. Under `0087` an address held by two customers matches two rows, so every outbox entry
  addressed to that person would have been **duplicated** — and the duplicate would carry the other
  customer's edition, defeating the `COALESCE` that was the route's only scope.
  `AND u.tenant_id = o.tenant_id` makes it single-valued again, and costs no bind. **This is a bug
  `0087` introduced into a file `0087` did not touch; there may be others of its shape** — see
  *Escalate* below.
* **`email_outbox` is `onTenantOnly`.** `0086` gave it a direct key (the plan correction: every FK it
  holds is nullable, so no join can scope it) but no `edition` companion. So the tenant half is
  direct and the edition half keeps the route's existing `COALESCE(d.edition, u.edition)`, which
  still fails closed.
* **`wouldStrandTheConsole` is an aggregate, and the dangerous kind.** A leaking `COUNT` there does
  not show anybody another customer's staff — it silently answers "yes, removing this administrator
  is fine" because somebody at *another* customer still holds the console. The workspace is then left
  with nobody able to open it and the refusal that exists to prevent exactly that never fires.

### 7. The ratchet, extended

| Change | Status |
|---|---|
| `B6 users` | `pending` → **`enforced`** |
| `B17 seats` | `pending` → **`enforced`** |
| `B21 outbox` (`/api/notifications/outbox`) | **new, `enforced`** |
| `B21 notifications` (`/api/notifications`) | stays **`unprobed`**, reason rewritten |
| `email_outbox` fixture | gains `deck_id = 'zz_deck'` |

Edited by **exact-anchor replacement on individual probe lines and five additions**, never by
rewriting a region — T1-DECKS' `TENANT_B_PROXY_FIXTURES`, T1-FLOW's proxy-row array and T1-ESIGN's
`B14`/`B19`/`B20 issues` rows are all intact. At one point the live file carried **two** declarations
of `TENANT_B_PROXY_FIXTURES`, one from T1-DECKS and one from T1-FLOW, which is a parse error that
blocks every sibling's gate. I did not merge them: both were in flight and either edit could have
been mid-keystroke. They resolved it themselves within a few minutes. **If you hit that again, say so
rather than fixing it — a shared file's collision belongs to the sessions that caused it.**
| layer **2c** — 5 new cases | new |
| layer 3 — "creating a colleague as tenant B…" | new |

**`B21 notifications` stays `unprobed` on purpose**, and this is the file's own rule rather than a
shortcut: `readGrid` resolves a fixed `NOTIFICATION_EVENTS × NOTIFICATION_CHANNELS` vocabulary into
**booleans**, so tenant B's `np` fixture (whose marker is in `event_key`) is discarded before the
response is built, and a real leak there moves a boolean. No fixture fixes that. Promoting it to
`enforced` would assert nothing — so the leak is asserted directly instead, in layer 2c.

**Layer 2c exists because Layer 2 is structurally blind to both findings on this surface.** Layer 2
signs in as tenant A and sweeps response bodies for a marker; B22 is outbound mail (no response to
sweep) and the workspace preference default is one boolean. Its five cases:

1. a deck event reaches **only** the owning customer's staff, called the way the eight unscoped
   producers call it — `edition` + `deckId`, no scope;
2. a mail with neither scope nor deck is still filed somewhere and warns in the log;
3. an explicit scope **beats** a deck, so a cron pass cannot be re-tenanted by a row it reads;
4. the workspace notification default a customer inherits is their own — one customer's admin
   turning an alert off must not silence another customer's staff;
5. the digest reaches every customer with a key of its own.

---

## 8. Negative controls — all thirteen bite

Every assertion added or promoted was checked by reverting the predicate it guards and confirming
**that** test, by name, goes red.

| Reverted | Test that goes red |
|---|---|
| roster drops `tenant_id` | `isolates — B6 users` |
| `seatHolders` drops it | `isolates — B17 seats` |
| outbox read drops `o.tenant_id` | `isolates — B21 outbox` |
| fan-out drops it | `a deck event reaches ONLY the owning customer's staff` |
| `resolveNotificationPreferences` drops it | `the workspace notification default…` |
| digest key loses the tenant | `the monthly digest reaches every customer…` |
| `POST /api/users` INSERT names only `edition` | `creating a colleague as tenant B…` |
| global `getUserByEmail` restored | `creating a colleague as tenant B…` |
| `liveWorkspaces` includes suspended orgs | `skips a suspended customer entirely` |
| reminder join drops `u.tenant_id = d.tenant_id` | `a deck assigned to another customer's evaluator…` |
| reminder `sendEmail` loses its scope | `reminds a live customer's evaluator…` |
| `usageSummary` decks unscoped | `a workspace's usage numbers count that workspace` |
| `usageSummary` credits unscoped | `a workspace's usage numbers count that workspace` |

**Two of them did not bite at first, and both failures were in the test, not the product.** Worth
recording because each is a shape a reviewer would not spot:

1. **`POST /api/users`'s INSERT had no guard at all.** Reverting it to name only `edition` left
   *every* test in `tenant-scope.test.ts` green — including "tenant B's own principal can sign in",
   which uses the fixture's direct SQL and not the route. `0087`'s header explicitly moved the
   loudness for this write here ("the single worst silent write in the schema, because that account
   then signs in and sees everything") and nothing had taken delivery of it. That is what the new
   layer-3 case is for.
2. **`runReminders` returns one group per evaluator PER WORKSPACE PASS**, so a cross-tenant leak
   appears as a *second* group with the same `evaluatorId` further down the array — and
   `reminders.find(…)` returns the legitimate one and reports success. Measured: the `.find()` form
   stayed green with the join's tenant condition removed; the `filter().flatMap()` form goes red.

And one assertion was **rewritten because it could not fail**: the digest case first asserted that no
two customers share a dedupe key, which the per-recipient `:${user.id}` suffix makes true regardless.
It now asserts the key *names its own customer*, which is the property this session actually added.

---

## 9. For integration — asks, in priority order

1. **Drop `billing_subscriptions__pre_tenant_key`** (headroom `0101`–`0108`), together with the other
   four transitional indexes, once all nine `ON CONFLICT` sites name their widened key. Mine does.
   Until then `billing_subscriptions` cannot hold a second customer's row — recorded as
   `BLOCKED_BY_TRANSITIONAL_KEY`.
2. **Drop `DEFAULT 't_default'` from `users.tenant_id`.** `0087`'s header says this is T1-PEOPLE's to
   unblock and integration's to do: the default exists *only* because `routes/users.ts`'s INSERT
   named no tenant and the loud form reddened 109 tests. **That INSERT now supplies the column**, so
   the reason is gone and `0087`'s rebuild recipe is proven and reusable. The write is guarded by a
   test either way.
3. **Re-cut `idx_outbox_dedupe` as `(tenant_id, dedupe_key)`** to match what `0099` did to
   `notifications`. The two halves of the same dedupe mechanism currently disagree: the in-app index
   is tenant-scoped and the email one is global. Nothing depends on the asymmetry today — every key
   is unique per recipient — but `findByDedupeKey` is deliberately left **unscoped** to match the
   global index, and that comment stops being true the day the index changes. The cross-tenant
   detector (`warnIfCrossTenant`) can come out at the same time.
4. **Thread a `scope` into the two producers that have neither a scope nor a deck**, and then make
   `OutboundEmail.scope` / `NotificationInput.scope` **required** — the field is optional only
   because nine call sites are in other sessions' files:
   * `src/server/crm/provider.ts:244` — `crm_sync_failed` (T1-ESIGN)
   * `src/server/routes/auth.ts:191` — `invite_accepted` (T0's file)

   The other eight resolve correctly through their `deckId` today, but resolution is a fallback and
   a required field is the design `PaymentIntentAttempt.tenantId` already uses.
5. **`loadEditionOverrides` (`auth/permissions.ts:53`) reads `role_permissions WHERE edition = ?` in
   THIS tree, and T1-CONFIG has already fixed it in theirs.** `role_permissions` is tenant-owned, so
   the permission grid is currently shared across customers here — which makes
   `wouldStrandTheConsole`'s *role list* shared even though its count is scoped.
   **T1-CONFIG renamed it `loadWorkspaceOverrides` and took a strict `TenantScope`**
   ([[tenancy-permissions-boundary]]), deliberately so a stale call conflicts loudly instead of
   compiling with a changed meaning. They work in `../sj-T1-CONFIG`, so **that rename is not in this
   tree and will not merge cleanly**: `routes/users.ts`'s one call site in `wouldStrandTheConsole`
   needs the new name and `scopeOf(c.var.user)` in place of `edition`. One line, but it is a
   merge-time edit nobody owns on either side — fix it when the two branches meet, not by guessing
   now.
6. **Rename `runMonthlyUsageSummary`.** It runs daily off `"0 8 * * *"` and only the digest's dedupe
   key makes that one job monthly; it now also carries the no-response sweep. The name is narrower
   than the body. It stays that way here only because `src/server/index.ts` calls it and is not this
   session's file — a one-line change at the call site.
7. **`src/server/resubmit.ts` still exports the edition-only `orgName`** beside the scoped
   `orgNameInScope` I switched to. If nothing else uses it, delete it; if something does, that is a
   cross-tenant read.

---

## 10. Escalate — one class, found by accident

**`0087`'s change to `users.email` silently changed the meaning of every join on that column, in
files `0087` did not touch.** I found one: `GET /api/notifications/outbox`'s
`LEFT JOIN users u ON u.email = o.to_email`, which was single-valued only because the constraint was
global and now fan-outs a duplicate row per customer sharing an address. **Nothing in the suite would
have caught it** — it needs two customers *and* a shared address *and* a route that joins on email,
and `tenant-scope.test.ts` is specified per table.

Worth a one-line sweep at integration: `grep -rn 'users[^,]*\.email *=' src/server/`. Every hit is
either already tenant-qualified or a latent row multiplier. A join on a column whose uniqueness
*scope* changed is a different defect from a predicate that is merely insufficient, and §5c's
reassurance — that adding `tenant_id` leaves the 211 predicates "correct but insufficient rather than
wrong" — does not cover it.

---

## 11. Plan corrections measured here

1. **§5b calls `email_outbox` scoped-by-proxy; it cannot be.** Already corrected by T0 in
   `0086`'s header (every FK it holds is nullable, so no join scopes it; it got a direct key, making
   **30** key-carrying tables, not 28). Confirmed from the consuming side: it has 3 `FROM` sites and
   **zero** `JOIN`s, and the one route that reads it had to resolve a scope through a
   `COALESCE` over two `LEFT JOIN`s precisely because no join could.
2. **§2 A8 overstates the mechanism and understates the damage.** See §3 above. The digest was never
   swallowed; it was mailed to every customer with numbers summed across all of them. A8's remedy is
   still right.
3. **§5b's "`email_outbox` 3/0" is a count of reads; the write side is worse.** The INSERT named no
   tenant and the column's `DEFAULT 't_default'` would have absorbed it silently. Three of this
   session's statements were in that position (`email_outbox`, `notifications`, `seat_grants`) plus
   `users` and `notification_preferences` — **five silent writes, not one.**

---

## 12. Not committed

Nothing was committed or stashed from this checkout, for the reason at the top: a `git commit` here
would carry four other sessions' in-flight work, and `test/worker/tenant-scope.test.ts` alone holds
edits from four. The nine paths that are **this session's** are:

```
src/server/routes/users.ts          src/server/routes/notifications.ts
src/server/routes/seats.ts          src/server/email/outbox.ts
src/server/seats/ledger.ts          src/server/scheduled.ts
test/worker/scheduled.test.ts       test/worker/seats.test.ts
test/worker/screening-status.test.ts
```

plus this note, plus the five edits to `tenant-scope.test.ts` listed in §7. `test/worker/seats.test.ts`
and `test/worker/screening-status.test.ts` are touched only because this session changed a signature
they call (`seatCapacity`/`writeSeatGrants`, `runNoResponseSweep`) — a session that changes a
signature fixes its callers.

---

*Related memory: [[wave-r-shared-tree]], [[startup-jury-tenancy-t0]], [[role-boundary-leaks]],
[[d1-table-rebuild-recipe]].*
