# T1-ESIGN — handoff note

*Tenancy wave T1. Cut from `main` @ `dc47712` (T0-SCHEMA merged). Owns `src/server/esign/**` ·
`routes/diligence.ts` · `routes/crm.ts` · `src/server/crm/**`. **No migration.***

*Gate: typecheck ✓ (all three projects) · lint ✓ · build ✓ · `npm test` **2770 passed / 1
skipped / 0 failed** ✓ (146 files). e2e, playwright and roles not run, per the prompt. The tree is
shared with six sibling T1 sessions, so runs during this session showed up to 9 failures that were
all theirs; the final run above is clean. See "Reading the gate in a shared tree" below.*

---

## What shipped

**70 statements widened across 8 files.** Every one binds the workspace through
`src/shared/tenant.ts`; this session wrote no predicate of its own except the one `EXISTS` helper
named below, which exists because SQLite's `UPDATE` has no `FROM`.

| # | Surface | Leak table | Where |
|---|---|---|---|
| 1 | Agreements library, signatory pool, signing method, **agreements and signatures** | B15 | `esign/store.ts`, `esign/routes.ts` |
| 2 | The e-signature outbox and its dedupe | — (plan correction, below) | `esign/provider.ts` |
| 3 | **Term sheets, valuations, legal + investment DD** | B14 | `routes/diligence.ts` |
| 4 | CRM connections, field mappings, sync log, the monthly cap, the **outbound** write-back | B19 | `crm/store.ts`, `crm/sync.ts`, `crm/provider.ts`, `routes/crm.ts` |

Signature shape throughout: every function that took `edition: Edition` now takes
`scope: TenantScope`, and `routes/*.ts` builds it with `scopeOf(c.var.user)` — from the session,
never from a parameter. `scopeOf` takes a `TenantPrincipal`, so `scopeOf(c.req.query())` does not
compile, which keeps true the one piece of good news §2 records: all 211 existing predicates read
their key from the logged-in session.

---

## 1. The plan correction this session owns: `esign_outbox` has no parent

§5b classified `esign_outbox` "scoped by proxy". It cannot be. **Both of its foreign keys are
nullable by design** — `0049`'s own comment: *"an attempt may precede the `agreements` row (a
method preview) and a voided envelope may outlive its sign-up"*. A join through a nullable
reference drops precisely the rows that have no parent, which is to say the rows a proxy scope was
supposed to cover. There is no parent; T0 was right to give it a direct `tenant_id` in `0086`, and
`TENANT_KEYED_TABLES` lists it.

Two consequences for anyone reading this file later:

- It has **no `edition` column**, so `onTenantOnly()` is correct at both sites and `.on()` would
  not compile a valid statement. Its 2 `FROM` sites (`store.ts` `listAttempts`, `provider.ts`
  `findByDedupeKey`) and 0 `JOIN`s are exactly as §5b counted.
- The write is the dangerous half. `tenant_id` carries `DEFAULT 't_default'`, so a forgotten bind
  files another customer's signing attempt under the first customer and returns an ordinary
  record. `insertScope(scope, { tenantOnly: true })` is what makes that unforgettable;
  `esign-provider.test.ts`'s last case is the negative control, and it was measured to report
  `['t_default', 't_default']` with the bind removed.

---

## 2. The two `ON CONFLICT` sites — widened, and what was measured

`esign/store.ts` `setRoleGrant` / `setUserGrant`:

```
ON CONFLICT (tenant_id, edition, role)    WHERE role    IS NOT NULL DO UPDATE SET enabled = …
ON CONFLICT (tenant_id, edition, user_id) WHERE user_id IS NOT NULL DO UPDATE SET enabled = …
```

**The `WHERE` clause survived verbatim and that is not cosmetic** — SQLite accepts a partial index
as a conflict target only when the statement repeats its predicate, so dropping it stops the
upsert matching an index at all. The transitional indexes were **not** dropped; that is
`0101`–`0108`'s job.

Measured on the materialised chain (`for f in migrations/*.sql; do sqlite3 s.db < $f; done`,
2026-09-30), with **both** index pairs standing as they do today:

| Case | Result |
|---|---|
| Same tenant, widened target | **Upserts correctly.** Updates the existing row and keeps its original id — pre-tenancy ids need no rewriting |
| A second tenant | `UNIQUE constraint failed: authorised_signatories.edition, authorised_signatories.role` |
| Same, after `DROP INDEX idx_auth_sig_role; DROP INDEX idx_auth_sig_user` | **Succeeds**, both tenants' rows coexist |

The middle row is the legacy index refusing, by name — the correct error for "integration has not
run yet", and the same situation `tenant-scope.test.ts` records for the five tables in
`BLOCKED_BY_TRANSITIONAL_KEY`. **Nothing here needs changing when `0101`–`0108` drop the pair.**

The id gains the tenant separately from the index, because it is the PRIMARY KEY and
`as_${edition}_role_${role}` collides across customers.

---

## 3. B14 — the four hardcoded literals are gone

§2 called `routes/diligence.ts` the worst case of its class: *"hardcoded `edition = 'vc'`
(verified) … a literal is worse than a bound parameter: there is not even a variable to
re-point."* All four are now `scoped(dealScope(c))`. The `'vc'` half of the old predicate is not
lost — the router's own middleware answers 403 `wrong_edition` above every handler, so a scope
reaching one always carries `edition = 'vc'`. The product rule and the tenancy predicate are now
the same bind instead of a literal standing in for both.

The worst of the four was not a read. `POST /:deckId/term-sheet/attach` takes `templateId` **off
the request body** and looked it up with the literal, so unscoped it would stamp another
customer's term-sheet template onto this deal and name it in the audit row.

One subtlety worth keeping: the `agreement_templates` join inside the `DealView` projection
carries the predicate **on the join, not in the `WHERE`**, so it stays a LEFT JOIN — a cross-tenant
template reads as "no template" rather than dropping the deal out of the list.

---

## 4. The writes, which is where this would have failed silently

`agreements` and `signatures` carry no scope column at all — §5b counts `signatures` 1 `FROM` site
/ 0 `JOIN`s, and its path (`signatures → agreements → signups → decks`) is the deepest in the
schema. Reads go through `ScopeBuilder.viaParent`. The eight **writes** cannot: SQLite's `UPDATE`
has no `FROM`, so they correlate through one helper, `ownedSignup(scope, correlate)` in
`esign/store.ts`, which emits
`EXISTS (SELECT 1 FROM signups own_s JOIN decks own_d ON … WHERE own_s.id = <correlate> AND …)`.
`correlate` is authored at every call site (`signups.id` or `agreements.signup_id`), never taken
from a request.

**`recordSignature` throws rather than no-ops** when the agreement is outside the scope. That is
deliberately the opposite of the read side: a read that finds nothing is an ordinary 404, but a
signature addressed at another customer's agreement is not an ordinary outcome, and a silent
no-op would leave a countersigned agreement with no signature row and no complaint.

Three guards were added where a scoped statement was followed by unscoped children — the shape §5b
calls *safe because the check happened above them, which is precisely why they break together*:
`ownsTemplate()` before `updateTemplate`'s three child writes, the same before
`replaceMappings`, and the correlated `EXISTS` on every `signups`/`agreements` update.

**This layering was measured, not asserted.** With `loadSignup`'s tenant predicate removed, the
route returned another customer's sign-up (404 → 200) but the write guard still held and the
agreement was untouched. Only with **both** removed did the other customer's agreement come back
`method_locked: 1`.

---

## 5. The ratchet — four probes, each measured in both directions

| Probe | Was | Now |
|---|---|---|
| `B15 esign templates` | `pending` | **`enforced`** |
| `B15 esign signatories` | `pending` | **`enforced`** |
| `B14 diligence templates` | *did not exist* | **`enforced`** |
| `B19 crm sync log` | *did not exist* | **`enforced`** |
| `B19 crm connections` (`GET /api/crm`) | `unprobed`, owner T1-ESIGN | `unprobed`, owner **T1-INT** — see below |

Every one was verified to go **red** with its predicate removed (predicate broken by script, spec
run, file restored from a scratchpad copy — no git operation at any point):

```
× isolates — B15 esign templates     … leaked tenant B into /api/esign/templates
× isolates — B15 esign signatories   … leaked tenant B into /api/esign/signatories
× isolates — B14 diligence templates … leaked tenant B into /api/diligence/templates
× isolates — B19 crm sync log        … leaked tenant B into /api/crm/hubspot/log
```

**Two fixtures changed, and both changes are load-bearing.**

1. `agreement_templates` now inserts **two** rows, one per edition, in one statement. The library
   is reached by two routers under two editions — `/api/esign/templates` (B15, either) and
   `/api/diligence/templates` (B14, **VC only**). An incubator-only fixture left the single
   highest-value row in the leak table with a green suite and no coverage. B14 also needs the VC
   principal, `nisha.kapoor.vc@demo.startupjury.ai`, now exported as `VC_ADMIN`.

2. `crm_sync_log`'s `connection_id` moved from `zz_crm` to **tenant A's `crm_inc_hubspot`**. That
   is not a contrivance: CRM connection ids are **deterministic** — `crm_<edition>_<provider>` in
   `0037`'s seed and in `crm/store.ts`'s `blankRow` — not UUIDs, so two customers' hubspot
   connections genuinely share an id until the seed is re-keyed, which is why `0098` rebuilt
   `crm_connections` for `UNIQUE (tenant_id, edition, provider)`. Pointing it at the shared id is
   what finally made B19 probeable; with it on `zz_crm`, nothing a tenant-A admin could ask for
   ever reached the row.

**`GET /api/crm` was deliberately NOT promoted.** The route is scoped, but the marker still cannot
reach the response and promoting it would be exactly the vacuous promotion the file warns about:
the handler answers `CRM_PROVIDERS.map(provider => rows.find(r => r.provider === provider))`, so
with or without a predicate a second customer's hubspot row is **shadowed** by the seeded one and
never rendered. The reason is structural, not a missing fixture. Its `owner` moved to `T1-INT` and
the assertion that the predicate exists lives at `B19 crm sync log` and in
`crm-provider.test.ts`'s two negative controls. **Integration: this is `unprobed`, not `pending` —
it does not block the "nothing left pending" assertion.**

Beyond the ratchet, **8 new cases** across three files, all negative controls with a real row on
the other side of the predicate and each measured red with the predicate removed:

- `esign.test.ts` — a second customer holding a *complete* signing chain (deck → sign-up →
  template → agreement → signature): 404 on all six workspace routes, the other customer's
  agreement and signature unchanged by a refused call, `agreementCount` not inflated, library and
  pool clean.
- `crm-provider.test.ts` — the monthly cap (asserted by **value**: unscoped 102, scoped 2) and the
  outbound write-back.
- `esign-provider.test.ts` — the `esign_outbox` tenant key.

---

## 6. Three things integration must carry

**(a) One cross-session edit, already applied.** `listTemplates` now takes a `TenantScope`, which
broke its one caller outside this session's paths. `src/server/routes/signups.ts:398` (T1-FLOW) is
patched to `listTemplates(c.env, scopeOf(c.var.user))` plus one import — two lines, left applied
rather than filed as a patch, because an unapplied signature change means `main` does not compile.
`test/worker/notifications.test.ts` (T1-PEOPLE) has the same, two call sites, for
`recordSyncAttempt`. **Expect a textual conflict on exactly those lines and keep this side.**

**(b) `crm_sync_failed` still fans out across customers — T1-PEOPLE's to finish.**
`crm/provider.ts` emits it through `emitNotification`, which lives in `src/server/email/**` and
whose recipient query is §2 B22 verbatim: `SELECT … FROM users WHERE edition = ?`. Its signature
has no tenant parameter, so this session passes `scope.edition` and nothing more. **Until
T1-PEOPLE widens that query, a CRM failure in one workspace still emails every other customer's
admins.** The call site is commented with this.

**(c) Two index observations, neither blocking.**

- `idx_esign_outbox_dedupe ON esign_outbox (dedupe_key) WHERE dedupe_key IS NOT NULL` is still
  **tenant-blind**; `0099` re-cut `notifications`' dedupe but not this one. No collision is
  reachable today — both keys this module mints are `<kind>:<signups.id>` and a sign-up id is a
  UUID, which is why §2 A8 names `email_outbox`'s `monthly_usage_summary:${edition}:${month}` as
  the dangerous one and calls every id-derived key safe. The scoped read added here means that if
  a tenant-blind key is ever introduced, the failure is a `UNIQUE constraint failed` on insert
  rather than a silent cross-tenant `deduped: true` suppressing another customer's envelope.
  Worth re-cutting in the `0101`–`0108` block while the file is open.
- **`agreements.template_id` is `ON DELETE SET NULL` (`0035:70`), and the scoped `agreementCount`
  changes what that means.** Correctly scoped, `DELETE /templates/:id` no longer counts another
  customer's agreement as "in use", so deleting the draft detaches that agreement from its
  template. This is reachable only from a row the application can no longer create — every write
  path now picks its template out of a scoped `listTemplates` — so it is a **pre-tenancy data
  shape**, and the fix belongs in a `0100`-class assertion that no agreement references a template
  outside its own tenant. **Unscoping the count to avoid it would reinstate the leak**, which
  would also be a denial of service: another customer's row would decide whether you can delete
  your own draft. Asserted as the measured behaviour in `esign.test.ts`.

---

## Reading the gate in a shared tree

**The seven T1 sessions are not worktree-isolated; they share the main checkout.** This session
opened on a `git status` that read clean and within the hour `git diff --stat` showed ~40 files
from six siblings. So a full-suite number is the tree's, not this session's, and it moves under you:
**judge a failure by whether its stack lands in a path you own**, and do not "fix" a sibling's. Every
failure seen mid-session belonged to one and every one had cleared by the final run —
`pipeline.test.ts` / `vc-pipeline.test.ts` 500s out of `routes/pipeline.ts` (T1-DECKS), then
`support.test.ts` with the `tenant-scope` probes B16 billing · B18 account · B20 tickets ·
B20 messages and the layer-3 `POST /api/tickets` case (T1-COMMERCE's un-promoted probes).

The flip side is that **your own API changes DO ripple into their files, and that part is yours** —
see (a) in §6.

**One episode worth naming, because committing it would have been catastrophic.** Mid-session,
`src/shared/tenant.ts` — the one file no T1 session owns — appeared with `insertScope` returning
`{ columns: "edition" }` on **both** branches, i.e. emitting no `tenant_id` at all. It was a
sibling's unrestored negative control and was put back within minutes, but while it stood it broke
every INSERT in the wave, and it broke them **asymmetrically**: `esign_outbox` failed loudly
(`table esign_outbox has no column named edition`, because it has no `edition` column — exactly
the plan correction in §1 above), while every table that *does* have both columns failed
**silently**, omitting `tenant_id`, taking the `DEFAULT 't_default'` and returning a 201. That is
precisely the silent-write shape `tenant.ts`'s own header warns about, reached through the helper
written to prevent it. **Integration: diff `src/shared/tenant.ts` against `dc47712` before
merging anything** — it should be unchanged, and a one-line difference there is worth more
scrutiny than a thousand lines anywhere else.

All five of this session's own suites are green on their own:
`esign.test.ts` **61/61** · `esign-provider.test.ts` **11/11** · `crm.test.ts` ✓ ·
`crm-provider.test.ts` **12/12** · `diligence.test.ts` ✓, and all four T1-ESIGN probes in
`tenant-scope.test.ts` pass. The seven-file run covering this session's surface plus the ratchet
and `signups.test.ts` is **205/205**.
