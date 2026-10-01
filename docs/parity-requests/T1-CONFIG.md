# T1-CONFIG — the configuration surface, scoped

Branch `tenancy/T1-CONFIG`, worktree `../sj-T1-CONFIG`, cut from `dc47712` (T0's merge).
No migration. The three `ON CONFLICT` sites this session held are closed.

**Gate:** typecheck ✓ · lint ✓ · `npm test` **2724 passed / 1 skipped, 148 files** (baseline
2709 / 147) · build ✓. No e2e, no playwright, no roles, as instructed.

---

## 1. The three `ON CONFLICT` sites — closed

All three now name the widened primary key, so integration can drop the transitional unique
indexes 0091–0093 left standing. **This session did NOT drop them**; that is 0101–0108's job.

| Site | Was | Now | PK from |
|---|---|---|---|
| `routes/permissions.ts` | `ON CONFLICT (edition, role, task_id)` | `(tenant_id, edition, role, task_id)` | `0091` |
| `routes/config.ts` `visibilityWrites` | `ON CONFLICT (edition, viewer_role, target_role)` | `(tenant_id, edition, viewer_role, target_role)` | `0092` |
| `routes/aiPrompts.ts` `PUT /capability` | `ON CONFLICT (edition, param_set, tier)` | `(tenant_id, edition, param_set, tier)` | `0093` |

All three write through `insertScope()` rather than hand-written binds, because all three
tables' `tenant_id` carries `DEFAULT 't_default'` — a forgotten bind on any of them does not
fail, it files a second customer's row against the first and answers 200.

**Six of the nine remain**, in three other sessions' files, each still resolving against its
transitional index: `routes/account.ts:288,:323` and `routes/billing.ts:197` (T1-COMMERCE),
`seats/ledger.ts:203` (T1-PEOPLE), `esign/store.ts:379,:393` (T1-ESIGN).

**`parameter_rubric_bands`'s `ON CONFLICT (parameter_id, band_index)` in `anchors.ts` is NOT
one of the nine and is unchanged.** That table has no tenant column — it is owned through
`parameters` — so its key did not widen.

---

## 2. What was measured leaking, and is not now

**Eleven** assertions in `test/worker/tenant-scope.test.ts`, every one of them run against T0's
unmodified `src/` and confirmed to fail there. The negative control is the whole evidence;
without it, "the test passes" means nothing on a route that never leaked.

Method, which matters: the final control reverted the **whole** of `src/` by file copy
(`cp -R src <scratch>` → `git checkout HEAD~1 -- src/` → copy back), not `git stash`
(`[[wave-r-shared-tree]]`) and not file-by-file. A partial revert was tried first and gave a
useless answer — reverting `routes/config.ts` while `routes/aiPrompts.ts` still carried the new
`loadSeatCapability` signature made `/api/config` answer 500, and a 500 is not evidence that an
unscoped read returns the wrong row. One of the two positive controls below read as
*inconclusive* on that run and only came back genuinely red on the full revert.

**Reads — the marker sweep (Layer 2):** `/api/config/parameters`, `/api/config/summary`,
`/api/config`, `/api/ai-prompts`, `/api/questions`, `/api/anchors` all returned tenant B's
`ZZTENANTB Parameter`. Three were `pending` rows flipped to `enforced`; three were routes §2
B24 names in prose and the leak table gave no probe, added as new `enforced` cases.

**Writes — the silent half (Layer 3):** three new cases, one per `ON CONFLICT` site. The worst
measurement of the session is the middle one: on unfixed source, **tenant B's
`PUT /api/ai-prompts/capability` flipped tenant A's `(core, premium)` grid cell from 1 to 0** —
an authorisation change in another customer's workspace, with a 200 and nothing in the response
to notice. The grid decides who may configure the rubric at all.

Those three cases are written to hold in **both** worlds, before and after integration drops
0091–0093's indexes: either the write is refused (loudly, naming the index) or it succeeds and
belongs to tenant B. They assert only that it never lands in tenant A, so they do not need
rewriting when the indexes go.

**Two positive controls, because two reads on these routes cannot be marker-swept at all.**
`loadSettings` and `loadScoringSettings` are both `.first()` over a single-row key, and
T1-REPORTS measured the trap: with `(tenant_id, edition)` as the key and nothing indexing
`edition` alone, an UNSCOPED scan reaches the MIGRATION's `t_default` row first — so
`/api/config` withholds tenant B's prompt from tenant A by luck of insert order, with no
predicate at all, and an `enforced` case passes while proving nothing. Inverting the probe
removes the luck: signed in as tenant B's *own* admin, the correct answer is tenant B's row,
which an unscoped read cannot return. Both failed red against T0's source with genuine
wrong-value failures (`expected '' to be 'ZZTENANTB system prompt'`; `expected 40 to be 11`).
They are paired with the marker sweeps, not a replacement for them.

**Two cases stay `unprobed`, and deliberately:**

- `B10 permissions` — `role_permissions` is one of the five tables the transitional keys still
  block, so tenant B cannot hold a row to leak. Both statements and the upsert are scoped;
  promoting the case now would assert nothing. Its `reason` was updated to say so.
- `B9 config scoring` (new) — every field is a number or a boolean. The one free-text path is
  `weightPreview`, which carries deck names and needs `zz_deck` to have an `ai_score` and a
  human `evaluations` row. **The fixture that makes it probeable belongs with T1-DECKS'
  evaluation rows** — see §5.

---

## 3. The boundary that was not crossed

`src/shared/permissions.ts` is **untouched**. `can(edition, role, taskId, overrides)` is a pure
function and its `edition` is the product variant choosing which matrix applies. What is
tenant-owned is the `overrides` map it consumes, so the scope went on the two queries that
produce that map — both in `src/server/auth/permissions.ts`, not in `routes/permissions.ts` as
the prompt's wording suggested. Correcting that is §4.

Nothing under `src/shared/` gained a predicate. `src/shared/tenant.ts` is used, not edited.

---

## 4. THREE EDITS OUTSIDE THIS SESSION'S DECLARED PATHS — read before integrating

Each is one expression, each was unavoidable, and each is named here rather than left for a
merge to discover.

### 4a. `src/server/auth/permissions.ts` — T0's directory, nobody's T1 path

T0 created the tenant key but did not scope this file, and **no T1 session owns it.** It holds
the only two reads of `role_permissions` outside `routes/permissions.ts`, and one of them —
`loadPermissionOverrides`, via `createPermissionContext` — runs on **every gated request** as
the input to `requireTask`. Unscoped, the authorisation gate answers from whichever customer's
grid the edition matched.

Both loaders now take a `TenantScope`, **strictly — no `ConfigScopeArg` bridge.** A
default-tenant fallback on a read that decides who may act, behind a loader that already fails
open to the shipped defaults, would be a gate silently answering from the wrong workspace and
looking ordinary while it did.

`loadEditionOverrides` is **renamed `loadWorkspaceOverrides`**, on purpose: an edition is no
longer what it loads, and a rename makes the merge conflict loud rather than letting a
same-named call compile with a changed meaning.

### 4b. `src/server/routes/users.ts:562-568` — T1-PEOPLE's file, one line

`wouldStrandTheConsole` calls the renamed loader. The line now reads
`loadWorkspaceOverrides(c.env.DB, scopeOf(c.var.user))`, with a comment saying why T1-CONFIG is
in this file. **The `users` COUNT three lines below it is still `WHERE edition = ?` and is
T1-PEOPLE's to widen** — it was left alone.

### 4c. `src/server/routes/auth.ts:22-31` — T0's file, one expression

`permissionsFor` calls `loadPermissionOverrides` for the `/api/auth/me` payload; same rename
consequence, same reason.

---

## 5. WHAT OTHER SESSIONS MUST DO — the bridge, and the ratchet that counts it

`src/server/config/**` is this session's by §11, but **five of its exported loaders have 22
call sites in four other sessions' route files.** Changing their signature to `TenantScope`
would redden `decks.ts`, `analytics.ts`, `pipeline.ts`, `assignments.ts`, `calls.ts` and
`ai/evaluate.ts` on a branch that cannot test any of them — and two of those sites
(`pipeline.ts:520`, `ai/evaluate.ts:897`) cannot be fixed from here at all, because they derive
the key from a `decks` row whose `SELECT` does not carry `tenant_id`.

So `src/server/config/scope.ts` (new) defines `ConfigScopeArg = TenantScope | Edition`. A bare
edition resolves to `DEFAULT_TENANT_ID` — today's behaviour exactly, and **wrong for a second
customer**, because `org_settings`, `org_scoring_settings` and `score_visibility` all have
`(tenant_id, edition)` keys and a second customer has rows of its own.

**`test/unit/config-scope-bridge.test.ts` (new) is what stops that becoming permanent.** It
scans `src/server/` and asserts the exact per-file count of edition-only calls. Both directions
fail: a new site fails it, a fixed one fails it too and the fix is to decrement.

| File | Edition-only calls | Owner |
|---|---|---|
| `routes/decks.ts` | 9 | T1-DECKS |
| `routes/analytics.ts` | 7 | T1-REPORTS |
| `routes/pipeline.ts` | 2 | T1-DECKS (`:520` needs the `loadDeck` SELECT widened) |
| `routes/assignments.ts` | 1 | T1-DECKS |
| `routes/calls.ts` | 1 | T1-FLOW |
| `ai/evaluate.ts` | 1 | T1-DECKS (`:897` needs the deck SELECT widened) |
| `ai/evaluate.ts` `maybeAutoClarify` | 1 (a missing `tenantId:` field) | T1-DECKS |

Counts, not line numbers: six sessions are editing these files in parallel, and a line-number
assertion would redden for reasons that are not about tenancy and then be switched off.

The scan reads sources through `import.meta.glob(..., { query: "?raw", eager: true })`, not
`node:fs`: `test/unit` is compiled by `tsconfig.json`, whose `types` are deliberately not
`node`, and adding `"node"` there to let one test call `readFileSync` would hand ambient Node
globals to all of `src/client`. One case asserts the glob matched the tree, so an empty scan
cannot make the count case pass by comparing two empty maps.

**Each session's edit is `edition` → `scopeOf(c.var.user)`**, except the two row-derived ones,
which need `tenant_id` added to their `decks` SELECT and row type first, then
`scopeOf(deck)`. `maybeAutoClarify` needs `tenantId: deck.tenant_id` in its input object.

**T1 integration, when every count reaches zero:** delete the `Edition` arm of
`ConfigScopeArg`, make the five loaders take a `TenantScope`, and delete
`test/unit/config-scope-bridge.test.ts`. The compiler then carries the invariant instead of a
grep. The last case in that file asserts the remaining total (21) so the number is printed on
every run.

---

## 6. Files changed

**New (2):** `src/server/config/scope.ts` · `test/unit/config-scope-bridge.test.ts`

**Owned (10):** `routes/config.ts` · `routes/aiPrompts.ts` · `routes/questions.ts` ·
`routes/permissions.ts` · `routes/anchors.ts` · `config/scoringSettings.ts` ·
`config/scoreVisibility.ts` · `config/rescore.ts` · `config/autoQuery.ts` ·
`config/callPrompts.ts`

**Outside (3):** `auth/permissions.ts` · `routes/users.ts` · `routes/auth.ts` — all of §4.

**Shared (1):** `test/worker/tenant-scope.test.ts` — three flips, four new route probes, two
positive controls, three new Layer-3 cases, one `reason` corrected. **Expect a conflict here with every sibling
session**; T0 designed the file to be extended by all seven, and a sibling was already adding a
`VC_ADMIN` constant to `main`'s copy while this session ran.

---

## 7. Judgements worth a second pair of eyes

**`rescoreEdition` takes a `TenantScope` strictly, not the bridge.** Both call sites are in
`routes/config.ts`. It is also the only WRITE among the config helpers, over every deck the
predicate selects — unscoped, a weight edit in one console rewrote every other customer's
`decks.ai_score`, `decks.signal`, `decks.updated_at` and `evaluations.weighted_total` against
*this* customer's weights.

**`loadScoreVisibility` is called with `inEdition(scope, …)`, six times.** `s-fw` draws
*Visibility for Incubator* and *Visibility for VC* side by side regardless of the viewer's
edition, so those statements are scoped by the viewer's TENANT and the matrix's own EDITION.
`visibilityWrites` binds `scope.tenantId` with the loop's `edition` for the same reason, which
is why it does not use `insertScope`.

**`loadEdition` in `anchors.ts` is renamed `loadWorkspace`.** An edition is not what it loads.

**`aiPrompts.ts`'s `SELECT_PARAMS` constant is gone**, replaced by `SELECT_PARAM_COLUMNS`.
`findParam` used to build its statement by `String.replace`-ing `WHERE edition = ?` — fine
while the predicate was one token wide, and the exact shape that silently drops half of a
two-column one.

**`questions.ts`'s `GET /draft/:deckId` had a correlated sub-select on
`o.edition = d.edition`.** It read whichever customer's `threshold_mediocre` the edition
matched first and then decided which of *this* deck's areas count as weak. It correlates on
`o.tenant_id = d.tenant_id` as well now.

**One statement is deliberately left unscoped:** `autoQuery.ts`'s
`SELECT email, name FROM users WHERE id = ?`. `AutoClarifyInput.tenantId` is optional (§5), so
a predicate there would bind the default tenant for every caller that has not passed one, fail
to find a second customer's uploader, and silently mail the clarification letter to
`founder@portal.local`. The comment at the call site says this. T1-DECKS closes it.

**`parameters` writes carry the predicate as well as the scoped load above them.** §2 B9 names
those four `WHERE id = ?` writes specifically; a predicate on the write cannot be invalidated
by a later edit to the read that fed it.

**Not changed, and flagged rather than guessed:** `auditConfig(..., { targetId: edition })` on
the four `org_settings` mutations still names the edition alone, though that table's key is now
`(tenant_id, edition)`. `audit_log` rows carry their own `tenant_id`, so nothing leaks; the
field is merely now an incomplete identifier. `audit/**` is T1-REPORTS'.
