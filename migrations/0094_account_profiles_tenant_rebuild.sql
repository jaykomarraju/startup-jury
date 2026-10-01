-- 0094 — T0-SCHEMA · rebuild 7 of 11. `account_profiles` PK `edition` →
--        `(tenant_id, edition)`.
--
-- Recipe: `0087_users_tenant_rebuild.sql`. Inbound edges: zero.
--
-- ══ THIS MIGRATION DEPARTS FROM THE PLAN, AND PRODUCTION IS WHY ═════════════
--
-- §5c says: "`account_profiles` and `billing_subscriptions` should be keyed by
-- `tenant_id` ALONE — they are the commercial record, and
-- `0053_account_profile.sql:12-14`'s own words, 'one commercial account per
-- workspace', become true per customer."
--
-- That reading cannot be applied to the data that exists. Measured READ-ONLY
-- against the deployed `startup-jury-db` on 2026-09-30:
--
--   SELECT edition, count(*) FROM account_profiles GROUP BY edition
--   → incubator 1, vc 1
--
-- The one existing customer holds TWO commercial records, one per workspace. A
-- `PRIMARY KEY (tenant_id)` with every row backfilled to `t_default` gives two
-- rows one key, so the restoring INSERT fails on a UNIQUE violation and the
-- migration chain stops. Keying it on the pair is not a compromise; it is what
-- "one commercial account per workspace" says once you accept §5c's own primary
-- decision that a workspace is `(tenant_id, edition)`.
--
-- ── AND THIS IS THE `0038` SHAPE, CAUGHT BY LOOKING ─────────────────────────
-- `0038` is the precedent for a migration that passed on a fresh seed and died on
-- real data. This one would have done exactly that, and more quietly, because the
-- seed does not reproduce it:
--
--   local, all 63 migrations applied:  account_profiles → 0 rows
--   deployed:                          account_profiles → 2 rows
--
-- `0053` creates the table and seeds nothing; the rows in production were written
-- by the My Account screens. So `npm test` would have been green on a
-- `PRIMARY KEY (tenant_id)` rebuild — the table it collides on is EMPTY in every
-- test database — and the failure would have arrived during the production apply,
-- in the middle of a 18-migration chain, with eleven table rebuilds behind it.
-- The instruction to check the deployed instance read-only before writing the
-- backfill is what found it, and it is the only thing that could have.
--
-- ── WHAT STAYS HERE AND WHAT MOVED TO `organizations` ───────────────────────
-- Nothing moved. `0083` deliberately did not re-home the org columns: this row
-- stays the COMMERCIAL record — the customer's own account details, editable
-- under My Account, including the eleven organisation-details fields and the
-- contact block — while `organizations` is the IDENTITY record the platform owns
-- and login reads. Folding one into the other would put a customer-editable field
-- on the row that gates authentication.

-- ── THE `DEFAULT` ON `tenant_id`, UNIFORM ACROSS ALL THIRTY ──────────────────
-- The 19 `ALTER TABLE` columns carry `DEFAULT 't_default'` because SQLite offers
-- no way to add a NOT NULL column to a populated table without one. The eleven
-- rebuilt tables could have gone without, and `0087`'s header records why they do
-- not: the loud form reddened 109 tests in files owned by other T1 sessions, and a
-- foundation session that merges red is seven T1 branches cut from a red commit.
-- The write-side guard is `test/worker/tenant-scope.test.ts`, per table, extended
-- by whichever session owns each INSERT.
--
CREATE TABLE account_profiles__pre_tenant AS SELECT * FROM account_profiles;

PRAGMA defer_foreign_keys = ON;

DROP TABLE account_profiles;

CREATE TABLE account_profiles (
  tenant_id            TEXT NOT NULL DEFAULT 't_default',
  edition              TEXT NOT NULL CHECK (edition IN ('incubator', 'vc')),
  account_type         TEXT NOT NULL DEFAULT 'individual'
                       CHECK (account_type IN ('individual', 'organization')),
  -- Account screen.
  work_email           TEXT NOT NULL,
  first_name           TEXT NOT NULL,
  last_name            TEXT NOT NULL,
  phone_dial           TEXT,
  phone                TEXT,
  designation          TEXT,
  organization_name    TEXT,
  -- Org type screen (Organization only).
  org_kind             TEXT CHECK (org_kind IS NULL OR org_kind IN ('incubator', 'investor')),
  -- Org details screen (Organization only) — the prototype's eleven fields.
  org_name             TEXT,
  business_type        TEXT,
  employees            TEXT,
  associates           INTEGER CHECK (associates IS NULL OR associates >= 0),
  city                 TEXT,
  country              TEXT,
  contact_name         TEXT,
  contact_designation  TEXT,
  contact_dial         TEXT,
  contact_phone        TEXT,
  contact_email        TEXT,
  updated_by           TEXT REFERENCES users (id) ON DELETE SET NULL,
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  -- An organisation account must carry the organisation it is for.
  CHECK (account_type = 'individual' OR (org_kind IS NOT NULL AND org_name IS NOT NULL)),
  PRIMARY KEY (tenant_id, edition)
);

INSERT INTO account_profiles (
  tenant_id, edition, account_type, work_email, first_name, last_name,
  phone_dial, phone, designation, organization_name, org_kind, org_name,
  business_type, employees, associates, city, country, contact_name,
  contact_designation, contact_dial, contact_phone, contact_email, updated_by,
  updated_at
)
SELECT
  't_default', edition, account_type, work_email, first_name, last_name,
  phone_dial, phone, designation, organization_name, org_kind, org_name,
  business_type, employees, associates, city, country, contact_name,
  contact_designation, contact_dial, contact_phone, contact_email, updated_by,
  updated_at
FROM account_profiles__pre_tenant;

DROP TABLE account_profiles__pre_tenant;

-- ══ A TRANSITIONAL UNIQUENESS CONSTRAINT, AND WHY IT IS HERE ════════════════
--
-- Widening a PRIMARY KEY invalidates every `ON CONFLICT (<old key>)` in the
-- codebase: SQLite requires a conflict target to MATCH a uniqueness constraint
-- exactly, so `ON CONFLICT (edition)` stops resolving the moment `tenant_id`
-- joins the key, and the upsert fails with "ON CONFLICT clause does not match any
-- PRIMARY KEY or UNIQUE constraint".
--
-- Measured: nine such sites exist, in six files owned by FOUR DIFFERENT T1
-- SESSIONS —
--
--   routes/permissions.ts:112   (edition, role, task_id)        T1-CONFIG
--   routes/config.ts:931        (edition, viewer_role, target_role) T1-CONFIG
--   routes/aiPrompts.ts:349     (edition, param_set, tier)      T1-CONFIG
--   routes/account.ts:288,:323  (edition)                       T1-COMMERCE
--   routes/billing.ts:197       (edition)                       T1-COMMERCE
--   seats/ledger.ts:203         (edition)                       T1-PEOPLE
--   esign/store.ts:379,:393     (edition, role) / (edition, user_id)  T1-ESIGN
--
-- Fixing them is not a one-token edit. Each needs `tenant_id` added to the INSERT
-- column list, a placeholder, a bind, and a scope threaded into the handler — which
-- is precisely the work those four sessions exist to do, in files T0 does not own
-- (§11's ownership table; §6 on `users.ts` in particular). T0 doing it would be four
-- sessions' work done badly from a branch that cannot test the rest of their files.
--
-- And T0 cannot merge red. "Do not start a T1 session before T0 merges" means seven
-- branches are cut from this commit; a red `main` here is seven red branches.
--
-- So the old key survives as an ordinary UNIQUE INDEX alongside the new PRIMARY KEY.
-- Every existing conflict target keeps resolving, nothing in those six files has to
-- change today, and the index is a LOUD placeholder rather than a quiet one: while it
-- stands, inserting a second customer's row for the same (edition) fails with a UNIQUE
-- violation that names it. That is the correct error for "T1 has not finished yet",
-- and it cannot be mistaken for a leak.
--
-- **IT IS DROPPED AT T1 INTEGRATION, FROM THE DECLARED HEADROOM (0102-0108), ONCE
-- THE NINE UPSERTS ABOVE NAME THE WIDENED KEY.** `test/worker/tenant-scope.test.ts`
-- carries the PENDING row that fails when it is still here and the second tenant is
-- real, so it cannot be forgotten.
CREATE UNIQUE INDEX IF NOT EXISTS account_profiles__pre_tenant_key
  ON account_profiles (edition);
