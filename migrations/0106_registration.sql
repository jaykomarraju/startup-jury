-- 0106 — SELF-SERVICE REGISTRATION, PASSWORD RESET, AND GCW'S OWN ROW.
--
-- The pilot customer's administrator creates their workspace on a live call and
-- their colleagues sign themselves up. Four schema facts have to exist before any
-- of that can be a route: the organisation has to CLAIM a domain, it has to say
-- which workspace a registrant lands in, a `users` row has to be able to say
-- "not yet let in", and a password reset has to be a storable, single-use,
-- expiring credential rather than a temporary password relayed by hand.
--
-- ══ 1. WHY REGISTRATION JOINS AN ORGANISATION AND NEVER CREATES ONE ═════════
--
-- `plan_pilot_gcw.md` §6 measured the alternative and it is not viable: a public
-- route that creates an organisation also has to create the `account_profiles`
-- row, and that table is PK `(tenant_id, edition)` — one row per workspace
-- (`0094:96`) — so a second person walking the same wizard OVERWRITES the first
-- one's commercial record, including the V6 billing address that decides the
-- billing currency (`0104`). A public POST that can silently re-denominate a
-- subscription is not a sign-up, it is a defect with a form in front of it.
--
-- So registration RESOLVES an organisation that already exists, from the email
-- domain, server-side. Provisioning stays manual, which is also the recorded
-- client decision (`plan_multitenancy.md:315` — "he approves, and provisioning is
-- manual until Stage 4").
--
-- ══ 2. `organizations.email_domain` — NULLABLE, LOWER-CASE, UNIQUE ══════════
--
-- Nullable because claiming a domain is a per-customer act, not a schema
-- requirement: an organisation with no claim simply has no self-service sign-up
-- and invites its people through `POST /api/users`, which is what every customer
-- does today. Unique WHERE NOT NULL because two organisations claiming one domain
-- makes the resolution ambiguous — and an ambiguous resolution would put a
-- registrant in the wrong CUSTOMER's workspace, which is the exact failure the
-- whole tenancy block (0083–0101) exists to prevent. A plain `UNIQUE` would have
-- worked too, since SQLite treats NULLs as distinct in a unique index; the partial
-- index is written out so a reader does not have to know that rule to be sure.
--
-- **Never `ON CONFLICT` against this index.** `tenancy-partial-index-on-conflict`
-- is a recorded, measured trap in this repo: a partial index's `WHERE` is part of
-- the key, and an upsert that names the columns without the predicate resolves
-- against the wrong index. Nothing in this migration or in
-- `src/server/routes/registration.ts` upserts an organisation.
--
-- Stored lower-case. There is no `CHECK (email_domain = lower(email_domain))`
-- because `ALTER TABLE ADD COLUMN` admits a CHECK only for rows written after it,
-- so the constraint would be a half-truth; the assertion at the foot of this file
-- checks the one row that exists, and `routes/registration.ts` resolves with
-- `lower(?)` on both sides so a mixed-case stored value could not match anyway.
--
-- ══ 3. `organizations.default_edition` — WHICH WORKSPACE, NOT WHICH PRODUCT ══
--
-- A workspace is the pair `(tenant_id, edition)` (`src/shared/tenant.ts`), and an
-- organisation may legitimately run both: `scheduled.ts:36-47` already builds the
-- cross product of every active organisation with BOTH editions. So "resolve the
-- tenant from the domain" is only half an answer — a registrant still has to land
-- in one workspace, and a public route must not take that from the request body
-- (a body-supplied `edition` would let a stranger pick the VC workspace of an
-- incubator customer).
--
-- NOT NULL DEFAULT 'incubator' because that is the edition every existing row's
-- data is in, and because the VC edition is out of scope from 2026-10-01 (client
-- decision; `e2e/vc-intake.spec.ts` is the tripwire that keeps it WORKING, not
-- growing). No CHECK, for the ADD COLUMN reason in §2; the route narrows the value
-- with a type predicate and refuses anything else, and the assertion below pins
-- the one row.
--
-- ══ 4. `users.approval_state` — WHY `active` WAS NOT ENOUGH ═════════════════
--
-- `active = 0` already refuses a login (`routes/auth.ts`), so a registrant could
-- have landed `active = 0` and nothing else. It is not enough, in both directions:
--
--   • An administrator looking at the roster cannot tell a person who was
--     DEACTIVATED (an offboarded employee) from a person who has NEVER BEEN LET IN
--     (a sign-up awaiting approval). Those need different buttons.
--   • Login cannot tell the caller which one they are. `plan_pilot_gcw.md` §5.2
--     and the four-code decision this wave implements require
--     `403 pending_approval` to be distinguishable from `403 account_disabled`,
--     because a registrant told "your password is wrong" on a conference call
--     retypes their password instead of ringing their administrator.
--
-- DEFAULT 'approved' so every one of the accounts that already exists — the seeded
-- demo logins, GCW's real staff, every account `POST /api/users` has ever created
-- — keeps signing in with no backfill and no behaviour change. 'pending' is
-- written by exactly one place, the public registration route, and that is the
-- only state in which `active = 0` means "not yet" rather than "no longer".
--
-- This column DOES carry its CHECK: a three-value vocabulary that a typo could
-- widen is worth refusing at the write, and every row that exists already
-- satisfies it through the default.
--
-- ══ 5. `password_reset_tokens` — MODELLED ON `0017_resubmit_tokens` ══════════
--
-- Same security shape as the founder resubmit link, for the same reason: the token
-- IS the credential, so only a SHA-256 hash is stored and a database leak cannot
-- be replayed as a working link. `src/server/resubmit.ts` already holds the
-- generator (192 bits of CSPRNG entropy, base64url) and the hash, and
-- `routes/registration.ts` reuses both rather than inventing a second one.
--
-- Three differences from `resubmit_tokens`, each deliberate:
--
--   • **SINGLE USE.** `resubmit_tokens` carries `use_count` and admits repeated
--     uploads through one link. A password reset must not: a link that still works
--     after the password changed is a standing key to the account. `used_at` is
--     stamped by a conditional UPDATE (`WHERE used_at IS NULL`) so two concurrent
--     redemptions cannot both win.
--   • **SHORT EXPIRY.** `RESUBMIT_TOKEN_TTL_DAYS` is 30 because a founder may be
--     slow; a password reset is minutes-to-an-hour work. The TTL lives in
--     `routes/registration.ts` beside the route that mints it.
--   • **NO `edition`, so this table is keyed on the TENANT ALONE.** The token
--     authorises a PERSON, and `user_id` is a NOT NULL reference to the row that
--     already carries the edition — so an `edition` column here could only ever
--     agree with `users.edition` or contradict it, and a credential table is the
--     worst place in the schema to keep a second answer. `ScopeBuilder` has
--     `onTenantOnly()` for exactly this case (`src/shared/tenant.ts`), and
--     `tenant-scope.test.ts`'s layer-1 loop already branches on whether a table
--     has the column.
--
-- `tenant_id TEXT NOT NULL` with **no default**. The 17 `ALTER TABLE` columns of
-- 0084–0086 took `DEFAULT 't_default'` only because SQLite offers no other way to
-- backfill a NOT NULL column on a populated table; this table is new and empty, so
-- it takes the LOUD form — a forgotten bind is an error, not a credential filed
-- against the first customer. `src/shared/tenant.ts` calls that asymmetry out.
--
-- `token_hash` is GLOBALLY unique, not unique per tenant, for the reason `0085`'s
-- header gives for `resubmit_tokens`: scoping a bearer credential's hash per tenant
-- would make a stolen token valid in a second workspace.
--
-- The `REFERENCES users (id) ON DELETE CASCADE` is declarable here because this is
-- a `CREATE TABLE` — §5d's measured restriction is on `ADD COLUMN` with a non-null
-- default, not on new tables. A future rebuild of `users` must stash and restore
-- this child the way `0087` did its seven, or the cascade will take live reset
-- tokens with it. In practice it rarely fires: `DELETE /api/users/:id` is a SOFT
-- delete that stamps `deleted_at` and never removes the row.
--
-- ══ 6. GCW'S ROW, AND THE TWO MEANINGS OF "ORGANISATION" ════════════════════
--
-- `t_default` IS Global Carbon Warriors — §0 of `plan_pilot_gcw.md` chose to
-- REBRAND the existing tenant rather than migrate 23 real climate decks into a new
-- one. The row still says "ai.STARTUPJURY Demo Workspace" from `0083:118`, which is
-- what a vendor calls a sandbox, not what the platform should call its pilot
-- customer.
--
-- **`organizations.name` is the PLATFORM's name for the customer**; the
-- CUSTOMER-FACING name is `org_settings.branding_json.orgName`, set separately in
-- the Admin console's Branding section. `0083:98-99` says so in the column comment
-- and `plan_pilot_gcw.md` §6 lists conflating the two as one of the traps nobody
-- flagged. This migration sets the platform's name only. Renaming the workspace as
-- GCW's own people see it is a console action on the live call, not a migration.
--
-- The slug moves too — `default` → `global-carbon-warriors`. It is the login
-- `tenant` handle and the future hostname label (`acme.startupjury.ai`), so leaving
-- it as `default` would mean the pilot customer's subdomain is the word "default".
-- One test asserts the old literal; see the note at the foot of this file.
--
-- ══ 7. RE-EXECUTABILITY ════════════════════════════════════════════════════
--
-- Every statement here is re-executable except the three `ALTER TABLE ADD COLUMN`s,
-- which D1's migration ledger runs exactly once — the same property
-- `test/worker/migrations-w1b.test.ts` holds the tree to. The UPDATE is idempotent
-- and the assertions upsert on their own id.

-- ── 1. The organisation claims a domain, and names its default workspace ─────
ALTER TABLE organizations ADD COLUMN email_domain    TEXT;
ALTER TABLE organizations ADD COLUMN default_edition TEXT NOT NULL DEFAULT 'incubator';

-- Ambiguity here puts a registrant in the wrong CUSTOMER's workspace. Partial so
-- the many organisations with no claim do not collide on NULL.
CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_email_domain
  ON organizations (email_domain) WHERE email_domain IS NOT NULL;

-- ── 2. A `users` row can say "not yet let in" ──────────────────────────────
ALTER TABLE users ADD COLUMN approval_state TEXT NOT NULL DEFAULT 'approved'
  CHECK (approval_state IN ('pending', 'approved', 'declined'));

-- The roster read an administrator opens is "this workspace's pending sign-ups",
-- so the index leads with the tenant. `0087`'s note applies: an index that leads
-- with `edition` stops being selective the day a second customer exists.
CREATE INDEX IF NOT EXISTS idx_users_approval
  ON users (tenant_id, edition, approval_state);

-- ── 3. Password reset tokens ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          TEXT PRIMARY KEY,
  -- No DEFAULT: new and empty, so a forgotten bind must be loud. See §5.
  tenant_id   TEXT NOT NULL,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- SHA-256 hex of the raw token; never the token itself. Globally unique — see §5.
  token_hash  TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL,
  -- Stamped once, by `UPDATE … WHERE used_at IS NULL`. Single use.
  used_at     TEXT
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user
  ON password_reset_tokens (user_id, created_at);

-- ── 4. GCW's row ────────────────────────────────────────────────────────────
UPDATE organizations
   SET name            = 'Global Carbon Warriors',
       slug            = 'global-carbon-warriors',
       email_domain    = 'globalcarbonwarriors.com',
       default_edition = 'incubator',
       updated_at      = datetime('now')
 WHERE id = 't_default';

-- ── 5. Assertions, in `0100`'s style ────────────────────────────────────────
--
-- `_tenancy_assert` (created by 0088) has one CHECK admitting only 'ok', so a
-- failing verdict cannot commit: the statement errors, the transaction rolls back,
-- and the chain stops with the reason in the error text. `RAISE(ABORT, …)` would be
-- the natural way to say this and exists only inside a trigger.
--
-- Repeated with IF NOT EXISTS so this file does not depend on the order in which a
-- partial restore replayed the tenancy block.
CREATE TABLE IF NOT EXISTS _tenancy_assert (
  id      TEXT PRIMARY KEY,
  verdict TEXT NOT NULL CHECK (verdict = 'ok'),
  at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 1. The pilot customer claims its domain, lower-case, and names a real edition.
--    If this fails, every registration lands 403 `no_workspace_for_domain` and the
--    live call stops at the first screen.
INSERT INTO _tenancy_assert (id, verdict)
SELECT '0106.gcw_claims_its_domain',
       CASE WHEN (SELECT count(*) FROM organizations
                   WHERE id = 't_default'
                     AND email_domain = 'globalcarbonwarriors.com'
                     AND default_edition IN ('incubator', 'vc')) = 1
            THEN 'ok'
            ELSE 'FAIL: t_default does not claim globalcarbonwarriors.com with a real default_edition'
       END
ON CONFLICT (id) DO UPDATE SET verdict = excluded.verdict, at = datetime('now');

-- 2. No two organisations claim one domain, and no claim is stored mixed-case.
--    The partial unique index enforces the first on WRITES; this is the check on
--    the DATABASE, which is what catches a drifted or hand-edited instance — the
--    distinction `0100`'s header draws between an FK and this.
INSERT INTO _tenancy_assert (id, verdict)
SELECT '0106.one_organisation_per_email_domain',
       CASE WHEN (
              (SELECT count(*) FROM (SELECT email_domain FROM organizations
                                      WHERE email_domain IS NOT NULL
                                      GROUP BY email_domain HAVING count(*) > 1))
            + (SELECT count(*) FROM organizations
                WHERE email_domain IS NOT NULL AND email_domain <> lower(email_domain))
            ) = 0
            THEN 'ok'
            ELSE 'FAIL: an email_domain is claimed twice, or is not stored lower-case'
       END
ON CONFLICT (id) DO UPDATE SET verdict = excluded.verdict, at = datetime('now');

-- 3. Every existing account is 'approved'. The whole no-behaviour-change claim of
--    §4 rests on this, and a row that somehow landed 'pending' would be an account
--    that silently stopped being able to sign in.
INSERT INTO _tenancy_assert (id, verdict)
SELECT '0106.no_existing_account_was_left_pending',
       CASE WHEN (SELECT count(*) FROM users WHERE approval_state <> 'approved') = 0
            THEN 'ok' ELSE 'FAIL: an account that predates 0106 is not approved' END
ON CONFLICT (id) DO UPDATE SET verdict = excluded.verdict, at = datetime('now');

-- 4. `0100`'s shape, for the table `0100` does not know about: every reset token
--    resolves to a real organisation. Vacuous on a fresh database and deliberately
--    so — it is the standing check, not a proof.
INSERT INTO _tenancy_assert (id, verdict)
SELECT '0106.password_reset_tokens_resolve_their_tenant',
       CASE WHEN (SELECT count(*) FROM password_reset_tokens x
                   LEFT JOIN organizations o ON o.id = x.tenant_id
                   WHERE o.id IS NULL) = 0
            THEN 'ok' ELSE 'FAIL: a password reset token names a tenant that does not exist' END
ON CONFLICT (id) DO UPDATE SET verdict = excluded.verdict, at = datetime('now');

-- ── NOTE FOR INTEGRATION ───────────────────────────────────────────────────
-- Two assertions in files this lane does not own move with the two changes above,
-- and both are one literal:
--
--   • `test/worker/tenant-scope.test.ts:1178` expects the 409 `tenant_required`
--     body to list slugs `["default", "zz-isolation"]`. §6 renames the slug, so it
--     becomes `["global-carbon-warriors", "zz-isolation"]` — still sorted, so only
--     the literal changes.
--   • `test/worker/tenant-scope.test.ts:919` asserts `TENANT_B_FIXTURES` has exactly
--     one entry per `TENANT_KEYED_TABLES` entry. `password_reset_tokens` is added to
--     that list in `src/shared/tenant.ts`, so it needs its fixture:
--
--       password_reset_tokens: {
--         sql:
--           "INSERT INTO password_reset_tokens (id, tenant_id, user_id, token_hash, expires_at) " +
--           "VALUES ('zz_prt', ?, 'zz_admin', ?, '2099-01-01T00:00:00Z')",
--         binds: [TENANT_B, `${MARKER.toLowerCase()}resettokenhash`],
--       },
--
--     It belongs in `TENANT_B_FIXTURES` and NOT in the proxy map: the table carries
--     `tenant_id` itself, which is what `:1084` refuses.
