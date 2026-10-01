-- 0083 — T0-SCHEMA · the customer key the database has never had.
--
-- `migrations/0001_init.sql:1` says it in its own words: "Single-tenant: one
-- implicit organization." Sixty-nine live tables and not one records which
-- customer a row belongs to. The product has been getting away with it because
-- there is exactly one customer and because `edition` — which means "which
-- product variant, incubator or VC" — has quietly been doing the job of a
-- customer key.
--
-- MEASURED, not argued. A second accelerator added to a local copy — brand-new
-- account, zero decks — signed in and saw all 15 decks with founder names,
-- emails and phones, plus 8 staff rows and 12 audit rows belonging to the first.
-- The only scope on the deck listing is `d.edition = ?` (`routes/decks.ts:480`)
-- and `edition` has two values, so every accelerator shares a bucket.
--
-- ── A TENANT IS AN ORGANISATION; `edition` SURVIVES ─────────────────────────
-- `plan_multitenancy.md` §5c, and this migration commits to it: `tenant_id` is
-- added ALONGSIDE `edition`, never instead of it. Three reasons, in order of
-- weight:
--
--   1. Collapsing `edition` into the tenant means rewriting 211 predicates and
--      their binds. Adding `tenant_id` alongside leaves all 211 CORRECT BUT
--      INSUFFICIENT rather than WRONG — a failure a negative control can find,
--      not one that silently returns another customer's rows.
--   2. `edition` is also the product variant: four sites branch on it to decide
--      which features exist at all (`diligence.ts:69` answers 403
--      `wrong_edition`; `pipeline.ts:955`, `:1006`; `config.ts:824`).
--   3. `ROLES_BY_EDITION`, `PERMISSION_ROLES`, `DEFAULT_ROLE_PERMISSIONS`,
--      `VISIBILITY_ROLES`, `CALL_KINDS_BY_EDITION`, `NAV_BY_EDITION` and 25
--      `CHECK (edition IN (...))` constraints are all dimensioned on the two
--      values. If `edition` survives, NONE of the 25 CHECKs move.
--
-- So a WORKSPACE is the pair `(tenant_id, edition)` and that is what the
-- configuration tables are keyed on from 0089 onwards.
--
-- ── WHY THERE IS NO `edition` COLUMN ON THIS TABLE ──────────────────────────
-- §5c calls a tenant "an organisation that HAS an edition", which reads like an
-- argument for one. It is not, and the deployed database is the evidence: read
-- READ-ONLY on 2026-09-30 against `startup-jury-db` (`d1_migrations` at 63 rows,
-- latest `0082_ai_gate_threshold.sql` — the remote is in step with the repo, not
-- drifted), `SELECT edition, count(*) FROM users GROUP BY edition` returns
-- `incubator 7` and `vc 6`. The one existing customer runs BOTH workspaces. A
-- single `t_default` carrying one edition could not hold that data, and
-- splitting it into two organisations would invent a second customer that does
-- not exist and has never been invoiced.
--
-- An organisation therefore has MANY workspaces, one per edition it runs, and
-- the entitlement question — which editions may a customer open? — is deferred
-- rather than guessed. §7 Q1 goes to the client in those terms. Keeping
-- `edition` in every key is exactly what makes both answers reachable without a
-- further rebuild.
--
-- ── `account_profiles` IS THE ORGANISATION ROW THIS TABLE REPLACES ──────────
-- `0053_account_profile.sql:12-14` already says "one commercial account per
-- workspace", and the row holds `organization_name`, `org_kind`,
-- `business_type`, `employees`, `city`, `country` and a contact block. It is the
-- closest thing in the schema to an organisations row. It is NOT re-homed here:
-- 0094 re-keys it to `tenant_id` and it stays the COMMERCIAL record (the
-- customer's own account details, editable under My Account), while this table
-- stays the IDENTITY record (what the platform calls this customer, and whether
-- they are allowed in at all). Folding one into the other would put a
-- customer-editable field on the row that gates authentication.
--
-- ── `slug` EXISTS BECAUSE LOGIN NEEDS IT ────────────────────────────────────
-- 0087 turns `users.email`'s global UNIQUE into UNIQUE (tenant_id, email), so an
-- address stops identifying a person on its own. `POST /api/auth/login` needs a
-- way for a caller to say WHICH workspace — see `routes/auth.ts` and §2 A7. The
-- slug is that handle: short, URL-safe, and the same token a per-customer
-- hostname would carry when one exists (`billing/provider.ts:162` hardcodes
-- `returnUrl: "/app/admin?section=bl"`, which is already wrong for a
-- customer-specific host).
--
-- `status` fails CLOSED by being checked at login: a suspended organisation
-- cannot sign in even though its rows are all still there, which is what
-- offboarding needs and what a hard delete cannot give back.
--
-- ── WHY NO `REFERENCES organizations(id)` ON THE 28 COLUMNS ─────────────────
-- Measured on the materialised schema (all 63 migrations applied to a scratch
-- SQLite database) and re-measured inside D1:
--
--   ALTER TABLE decks ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 't_default'
--     REFERENCES organizations(id)
--   → Error: Cannot add a REFERENCES column with non-NULL default value
--
-- You get a backfilled NOT NULL tenant key OR a declared foreign key, not both
-- in one statement. Going nullable → backfill → rebuild for NOT NULL would
-- double the rebuild count from 11 to 28. So: no declared FK, and
-- `0100_tenant_integrity_assert.sql` stands in for it with an assertion that
-- fails the migration chain if any row carries a tenant that is not here.
--
-- The INSERT is `ON CONFLICT DO NOTHING` so the file is re-executable, which is
-- the property `test/worker/migrations-w1b.test.ts` holds the tree to.

CREATE TABLE IF NOT EXISTS organizations (
  -- `t_` prefixed, like every other id in this schema. `t_default` is the one
  -- existing customer and is written below.
  id          TEXT PRIMARY KEY,
  -- What the platform calls this customer. Distinct from
  -- `account_profiles.org_name`, which is what the CUSTOMER calls themselves.
  name        TEXT NOT NULL,
  -- The login/hostname handle. Lower-case, digits and hyphens only, so it can
  -- appear in a URL without escaping.
  slug        TEXT NOT NULL UNIQUE
              CHECK (slug = lower(slug) AND slug <> '' AND slug NOT LIKE '%|%'),
  -- 'active'    — signs in, bills, everything.
  -- 'trial'     — the Stage-2 trial queue's approved state.
  -- 'suspended' — rows retained, sign-in refused. Offboarding without deletion.
  status      TEXT NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'trial', 'suspended')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT
);

-- The one existing customer. Every `tenant_id` added by 0084-0098 backfills to
-- this id, so the whole deployed database becomes this organisation's data and
-- nothing changes shape for anybody signing in today.
INSERT INTO organizations (id, name, slug, status)
VALUES ('t_default', 'ai.STARTUPJURY Demo Workspace', 'default', 'active')
ON CONFLICT (id) DO NOTHING;
