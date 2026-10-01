# T1-FLOW — handoff

**Session:** the tenancy wave, T1. `docs/plan_multitenancy.md` §11, after T0-SCHEMA merged
(`dc47712`).
**Owned and changed:** `src/server/routes/calls.ts` · `src/server/routes/signups.ts` ·
`src/server/routes/signup-config.ts` · `src/server/routes/programs.ts` ·
`src/server/routes/resubmit.ts` · `src/server/resubmit.ts`, plus the four matching worker test
files and this session's extensions to `test/worker/tenant-scope.test.ts`. **No migration.**
`src/shared/` untouched — `git diff --stat src/shared/` is empty.

**Closes, from §2's leak table:** **B11** `/api/calls/*` · **B12** `/api/signups/*` ·
**B13** `/api/signup-config/*` · **B24** `/api/programs/*`, and the `resubmit_tokens` half of B24.

**Gate (run on a clear box, in this order):**

| Step | Result |
|---|---|
| `npm run typecheck` | green |
| `npm run lint` | green |
| `npm test` | **2788 passed · 1 skipped · 146 files** |
| `npm run build` | green |

`npm run test:e2e`, `playwright` and `npm run roles` were **not** run, per the prompt and §11's
"`npm run test:e2e` is forbidden until integration".

---

## 0. Read this first: the baseline was not green, and the tree was not mine alone

Two measurements that change how the numbers above should be read.

**The suite was red when this session started.** `npm test` on `main` at `dc47712` reported
**1 failed · 2708 passed**: `tenant-scope.test.ts > still leaks (pending) — B1 decks`, failing with
*"B1 decks NO LONGER LEAKS — T1-DECKS has scoped /api/decks"*. That is T1-DECKS' row, not
this session's, and it was failing before a line was changed here. My two `pending` rows (B24, B13)
were leaking exactly as asserted at that point, which is what made them a usable before/after.

**Six T1 sessions share this checkout** (the `wave-r-shared-tree` hazard, now confirmed for T1 as
well). Over the course of this session `git status` showed 19 then 27 modified files across
`ai/evaluate.ts`, `routes/decks.ts`, `routes/pipeline.ts`, `billing/**`, `crm/**`, `esign/**`,
`routes/users.ts`, `routes/seats.ts` and more — none of them mine. Consequences worth knowing:

- **A whole-project `typecheck` is not a signal about one session.** Mid-session it reported 68
  error lines, every one in another session's in-flight file. The only reliable per-session check
  is `npx tsc -p tsconfig.worker.json 2>&1 | grep <your files>`, which was clean from the first
  pass onward. The final full `typecheck` is green, but that is a fact about the tree at the moment
  it ran, not a durable one.
- **`npm test` totals move under you.** Measured 2708 → 2770 → 2788 across three runs while other
  sessions landed work. Only the per-file deltas below are this session's.
- **Two sessions wrote the same new construct.** T1-DECKS added
  `TENANT_B_PROXY_FIXTURES` to `tenant-scope.test.ts` while this session was writing an
  identically-named one. Theirs landed first and is the better shape (it asserts each proxy table
  has *no* `tenant_id` column and resolves through `viaParent`), so mine was deleted and its five
  rows merged into theirs. **Integration should expect more of this in the ratchet file than in the
  route files** — the route ownership table is disjoint by path, the test file is not.
- **T1-ESIGN edited `routes/signups.ts`** (line ~395, `listTemplates` now takes a `TenantScope`),
  which is one of my files. It is correct, it is marked, and it is preserved here. The convention
  it sets — fix another session's *call site* to keep the tree compiling, and say so in a comment —
  is the right one; this session did the same for nobody, because nothing of mine changed a
  signature another live session consumes (see §4).

---

## 1. The shape of the change

Every predicate goes through T0's helper. No session-local scoping idiom was invented, and
`TENANT_OWNER` was read rather than re-derived — which mattered, because four of the six tables
here are proxy-scoped and one of them (`cohorts`) is the only path in the schema that reaches its
owner through `programs` instead of `decks`.

| Table | How it is scoped | Where |
|---|---|---|
| `programs`, `sectors`, `required_documents` | tenant-OWNED (`0085`) — `scoped(scope).on(alias)` | programs.ts, signups.ts, signup-config.ts |
| `resubmit_tokens` | tenant-OWNED — **and a bearer credential**; see §2 | resubmit.ts |
| `cohorts` | proxy, 1 hop → `programs` | programs.ts, signups.ts, signup-config.ts |
| `calls`, `call_outcomes`, `call_schedulers`, `signups` | proxy, 1 hop → `decks` | calls.ts, signups.ts, signup-config.ts |
| `call_participants`, `signup_documents`, `agreements` | proxy, **2 hops** → `decks` | calls.ts, signups.ts, signup-config.ts |
| `deck_extractions`, `deck_versions` | proxy, 1 hop → `decks` | resubmit.ts, routes/resubmit.ts |
| `users`, `org_settings` | tenant-OWNED, read from these routes | calls.ts, signups.ts, resubmit.ts |

**One literal is gone.** `loadFundRows` read `FROM programs WHERE edition = 'vc'` — the shape §2
B14 singles out in `diligence.ts` because *"a literal is worse than a bound parameter: there is not
even a variable to re-point"*. The route is already behind `requireVc`, so the caller's own scope
carries `edition = 'vc'` and the literal was never doing work the session could not do. It was
only hiding the missing half of the key. The matching `UPDATE … WHERE id = ? AND edition = 'vc'`
in `PUT /fund` went with it.

**The five `ON CONFLICT` sites named in the prompt were left alone**, verified after the fact.
The prompt cited them at their pre-change lines; here they are at both:

| Prompt | Now | Key |
|---|---|---|
| `signups.ts:120` | `signups.ts:128` | `(deck_id)` — `signups` |
| `signups.ts:203` | `signups.ts:228` | `(deck_id)` — `deck_onboarding` |
| `signup-config.ts:372` | `signup-config.ts:389` | `(deck_id)` — `deck_onboarding` |
| `calls.ts:518` | `calls.ts:569` | `(deck_id, kind)` — `call_schedulers` |
| `calls.ts:575` | `calls.ts:627` | `(deck_id, kind)` — `call_outcomes` |

All five key on a deck, not an edition, so none of them is part of the nine blocking integration.

**And none of them is destructive, which is worth saying explicitly** now that T1-COMMERCE has
measured what the nine actually do: an `ON CONFLICT (<old tenant-blind key>)` upsert against a
table whose PK has been widened does **not** fail the way `0091`–`0095`'s headers predict — the
transitional UNIQUE index matches, so `DO UPDATE` resolves to the *other* tenant's row and
destroys it, silently, with a 200. That hazard needs a tenant-blind unique constraint to land on.
Every conflict target in this session's files is `deck_id` or `(deck_id, kind)`, and `decks.id` is
a globally unique primary key — two customers cannot collide on it. No upsert in T1-FLOW's six
files keys on `edition`, and none of the four tenant-OWNED tables here (`programs`, `sectors`,
`required_documents`, `resubmit_tokens`) is written by an upsert at all.

**Two rows now carry their own workspace so the outbound paths can scope themselves.** `CALL_SELECT`
selects `d.tenant_id` and `loadRow` selects `d.tenant_id`, giving `CallRow` and `WorkspaceRow` the
two columns `TenantPrincipal` wants. `rowScope(row)` then builds a scope from the record rather
than re-deriving the session — which is what `announceCall`, `dispatchInvite` and every child read
in the sign-up workspace use. T0's own comment licenses this: *"any row carrying the two columns —
which is what lets a cron job or a queue consumer build a scope from the row it is processing"*.

---

## 2. `resubmit_tokens` — the part that is a door, not a leak

The prompt asked for both the issue and the redeem path. They are now two halves of one guard, and
the asymmetry between them is deliberate.

**Issue.** `mintResubmitToken` no longer binds the workspace. It reads it out of `decks` **in the
INSERT itself**:

```sql
INSERT INTO resubmit_tokens (id, tenant_id, deck_id, edition, token_hash, to_email, created_at, expires_at)
SELECT ?, d.tenant_id, d.id, d.edition, ?, ?, ?, ? FROM decks d WHERE d.id = ? AND d.edition = ?
```

`0085` gave the column `NOT NULL DEFAULT 't_default'`, so a forgotten bind does not fail — it files
a **bearer credential** against the first customer, with a 200, a row, and nothing in the response
to notice. Deriving the value removes the possibility rather than documenting it. `args.edition`
stops being the source of the value and becomes a cross-check in the `WHERE`.

**One ordering fix worth recording.** The first version threw on `changes === 0` *after* the batch.
That is a correct refusal and a wrong one: the batch's first statement is
`UPDATE resubmit_tokens SET revoked = 1 WHERE deck_id = ?`, so a mint that failed would already
have revoked the deck's working link. The deck is now checked **before** the batch. A mint that
fails must not take the founder's live link with it.

**The revoke stays keyed on `deck_id` alone**, unscoped, on purpose: it supersedes every live token
for that deck whatever workspace the row claims. Scoping it would leave a token mis-filed *before*
this change alive forever, because the next mint's predicate would no longer match it. Strictly
safer unscoped.

**Redeem.** `verifyResubmitToken` still looks up by `token_hash` with no workspace predicate, and
that is correct — the hash is globally unique (`0085`'s header says scoping it per tenant *"would
make a stolen token valid in a second workspace"*) and the founder has no session to scope by.
What changed is what the token then authorises: `tokenScope(token)` is derived from the stored row,
and `loadDeck` loads the deck **inside that workspace**. A token whose `tenant_id` disagrees with
its deck's now opens nothing — a 404, the same answer a forged token gets. It **fails closed**.

`deck_extractions` and `deck_versions` on that page are scoped through `TENANT_OWNER` too, so the
public page cannot be made to render another customer's rows even if a token row were tampered with
in the database.

Three cases in `tenant-scope.test.ts` layer 3 hold this:

1. a token minted for tenant B's deck lands in **tenant B**, not `t_default`;
2. minting with the wrong `edition` throws rather than issuing a dead link;
3. a token whose `tenant_id` is rewritten to tenant A by hand — the only way to construct the
   mismatch now — **404s**, and the test says why that matters in the message.

---

## 3. Negative controls — measured, not asserted

Every new assertion was run against a deliberately broken predicate. In each case the tenant half
was replaced by `edition` alone (never deleted outright — an `edition`-only predicate is exactly
what the product shipped, and both tenants in every fixture share edition `incubator`, because §2's
whole argument is that there are two edition values and every customer shares a bucket).

| Control | Files restored from | Result |
|---|---|---|
| `programs.ts` — `loadQ`, and the `.on("sectors")` UPDATE form | scratch copy | **3 failed** (2 new + the pre-existing *"updates a program's fund fields, then soft-deletes it"*), 12 passed |
| `calls.ts` — `loadVisibleCall`, 3 deck lookups, `dispatchInvite` | scratch copy | **exactly my 2 new tenancy tests failed**, 39 passed |
| `signups.ts` — `loadRow`, the listing, `ensureSignups`, the esign gate | scratch copy | **exactly my 3 new tenancy tests failed**, 19 passed |
| `signup-config.ts` — 8 call sites | scratch copy | **exactly my 5 new tenancy tests failed**, 63 passed |

All four files were restored byte-for-byte afterwards and re-run green. The `programs.ts` control
is the interesting one: it took a *pre-existing* test down with it, which means that route's
workspace predicate is load-bearing for behaviour the suite already cared about.

**And two controls that live in the suite permanently**, because an `enforced` row asserts an
ABSENCE and an absence has two explanations — the route is scoped, or the marker was never
reachable:

- **`OLD_PREDICATE_PROBES`** (5 cases): for `programs`, `cohorts`, `calls`, `signups` and
  `required_documents`, run the predicate the product *used* to carry and assert tenant B's row
  **comes back**, then run the scoped one and assert it does not. This is the before/after in SQL,
  kept, so a fixture that stops being reachable fails loudly instead of making an `enforced` case
  vacuous.
- **`MIRROR_PROBES`** (4 cases): the same four routes, hit by **tenant B's own admin**, asserting
  the marker **is** present. If tenant B cannot see tenant B's row, the matching tenant-A assertion
  is measuring nothing.

Both generalise; any session promoting a probe can add a line.

---

## 4. The ratchet — what moved, and what this session added

**Promoted `pending` → `enforced` (2):** `B24 programs`, `B13 signup-config documents`. Both were
measured leaking on `main` at `dc47712` and both failed with *"NO LONGER LEAKS"* after the fix,
which is the ratchet working as designed.

**Promoted `unprobed` → `enforced` (2):** `B11 calls`, `B12 signups`. Done the long way the file's
instruction 1b asks for — fixture first, watch it become a real leak, then scope and promote.
Promoting an `unprobed` case straight to `enforced` asserts nothing, and these two were sitting on
*"tenant B has no `calls` row"* / *"no `signups` row"*.

**Added to `TENANT_B_PROXY_FIXTURES` (5 rows, merged into T1-DECKS' map):** `signups`,
`signup_documents`, `cohorts`, `calls`, `call_participants`. Declaration order is dependency order
because the seeding loop uses `Object.entries`.

**Added `ZZ_SIGNUP_DECK`, seeded on its own, with its own assertion.** A second tenant-B deck at
`status = 'signup'`. It fits in **neither** map and both exclusions are real, not oversights:
`TENANT_B_FIXTURES` is asserted to hold exactly one entry per tenant-keyed table, and
`TENANT_B_PROXY_FIXTURES` is asserted to hold only tables with **no** `tenant_id` column. It exists
because `GET /api/signups` lists only decks at `signup`/`onboard_ready`, and `zz_deck` is
T1-DECKS' probe subject at `status = 'new'` — moving it to make my probe work would have quietly
changed what theirs measures. **Integration: if a third session needs a second row on a keyed
table, this is the precedent; it should not become a fourth mechanism.**

Per-file test deltas this session is responsible for: `programs.test.ts` 13 → 15,
`calls.test.ts` 39 → 41, `signups.test.ts` 19 → 22, `signup-config.test.ts` 63 → 68, and
~18 cases added to `tenant-scope.test.ts` (5 SQL controls, 4 mirror probes, 3 resubmit-token
cases, 1 second-deck assertion, plus the 4 promotions which replace existing cases rather than
adding them). Each delta was measured at both ends.

---

## 5. Left for other sessions — named, with the line

This session edited none of these. Each is behaving exactly as it does today while one tenant
exists, so nothing regresses by waiting.

| Owner | What | Where |
|---|---|---|
| **T1-PEOPLE** | `orgName(env, edition)` is now marked `@deprecated` and cross-tenant as written. `org_settings` was re-keyed `(tenant_id, edition)` by `0089`, so *"the org settings for this edition"* is no longer a singular question — with a second customer this returns whichever row the planner reaches first, and the branding in a **founder-facing email** could be another customer's. `orgNameInScope(env, scope)` is the replacement and `src/server/resubmit.ts` already uses it. | the one caller is `routes/users.ts:134`. Same pattern T0 used for `db.ts`'s `getUserByEmail`. |
| **T1-PEOPLE** | `sendEmail` and `emitNotification` take no tenant, so `email_outbox` and `notifications` rows written from `calls.ts` (`dispatchInvite`, `announceCall`) and `resubmit.ts` (`notifyIncompleteDeck`) land in `t_default` by column default. That is §2 **B22**, the outbound leak — not something a route can fix from outside `email/**`. | `src/server/email/outbox.ts` |
| **T1-CONFIG** | `introCallPrompts(c.env, edition, deckId)` at `calls.ts:1008`. The deck id is scope-validated before the call, so the blast radius is contained, but the function itself reads `parameters`/`scores` by edition. | `src/server/config/callPrompts.ts` |
| **T1-ESIGN** | `agreements` is read from `signups.ts` through `TENANT_OWNER` (2 hops) and that read is closed. `signatures` — §5b's deepest path, 1 `FROM` site and **zero** JOINs — is in `esign/store.ts:663,686`, not here. | `src/server/esign/store.ts` |

**Nothing of this session's changed a signature a live sibling consumes.** The three exported
functions whose signatures did change — `missingSections`, and the new `tokenScope` /
`orgNameInScope` / `deckScope` — are consumed only inside `src/server/resubmit.ts` and
`src/server/routes/resubmit.ts`. `mintResubmitToken` and `notifyIncompleteDeck` kept their
signatures precisely so `routes/pipeline.ts:834` and `ai/evaluate.ts` (both T1-DECKS') would not
need touching; the workspace is derived internally instead.

---

## 6. Judgement calls, so integration can disagree with them cheaply

1. **`UPDATE` predicates are attached to the table name, not an alias** — `scoped(scope).on("programs")`
   emits `WHERE programs.tenant_id = ? AND programs.edition = ?`, because SQLite's `UPDATE` takes no
   alias. Valid, and now covered by a test with its own negative control, but it is a shape that is
   easy to get subtly wrong and it appears four times (`sectors` ×1, `programs` ×3).
2. **Child writes keyed on an id a scoped read just vouched for were left unscoped** —
   `UPDATE signups … WHERE id = ?`, `UPDATE cohorts SET seats_filled … WHERE id = ?`,
   `UPDATE signup_documents … WHERE id = ? AND status = ?`. Every one of them follows a scoped load
   in the same handler. This is the property §5b warns *"breaks together"*, and it was traded off
   case by case: the reads that end in **founder paperwork streamed from R2**, **participant email
   addresses**, or **outbound mail** were all given the owner join anyway (`loadParticipants`,
   `dispatchInvite`, the two `signup_documents` lookups), and the pure in-handler follow-up writes
   were not. If integration wants that line drawn differently, these are the sites.
3. **`ensureSignups` was the quietest finding.** `GET /api/signups` materialises a `signups` row for
   every deck of the caller's scope sitting at `signup`. Unscoped, a tenant-A admin's ordinary page
   load **wrote rows into tenant B's workspace** — a leak with no response body to notice it in.
   `test/worker/signups.test.ts` now asserts the count stays 0, and the ratchet's B12 comment
   records that it leaked both ways.
4. **`reconcileSeatless` is a blind `UPDATE signups`** whose only possible scope is its deck
   subquery. Unscoped, one admin saving one capacity table re-derived the `seatless` flag for every
   customer on the platform. The inner correlated `NOT EXISTS` needed its alias renamed to `d2` to
   make room.
