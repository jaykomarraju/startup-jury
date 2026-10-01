-- 0092 — T0-SCHEMA · rebuild 5 of 11. `score_visibility` PK
--        `(edition, viewer_role, target_role)` →
--        `(tenant_id, edition, viewer_role, target_role)`.
--
-- Recipe: `0087_users_tenant_rebuild.sql`. Key choice: `0089`. Inbound edges: zero.
--
-- ── IT KEEPS `edition`, AND §6 ALREADY SAID SO ──────────────────────────────
-- `plan_roles_incubator.md` reserves `0076` for R8-AW/SF's V3-SF answer on this
-- table, and §6 of the tenancy plan rules on the overlap: "Not invalidated. A
-- role×role matrix INSIDE a workspace stays edition-scoped and picks up
-- `tenant_id` in the Stage 4 sweep." This is that sweep. `VISIBILITY_ROLES` is
-- dimensioned on the two edition values, so the role pair means what it means
-- per product variant, and the tenant is a fourth axis rather than a replacement.
--
-- `0076` is still unused and still reserved. Nothing here takes it.

-- ── THE `DEFAULT` ON `tenant_id`, UNIFORM ACROSS ALL THIRTY ──────────────────
-- The 19 `ALTER TABLE` columns carry `DEFAULT 't_default'` because SQLite offers
-- no way to add a NOT NULL column to a populated table without one. The eleven
-- rebuilt tables could have gone without, and `0087`'s header records why they do
-- not: the loud form reddened 109 tests in files owned by other T1 sessions, and a
-- foundation session that merges red is seven T1 branches cut from a red commit.
-- The write-side guard is `test/worker/tenant-scope.test.ts`, per table, extended
-- by whichever session owns each INSERT.
--
CREATE TABLE score_visibility__pre_tenant AS SELECT * FROM score_visibility;

PRAGMA defer_foreign_keys = ON;

DROP TABLE score_visibility;

CREATE TABLE score_visibility (
  tenant_id    TEXT NOT NULL DEFAULT 't_default',
  edition      TEXT NOT NULL,
  viewer_role  TEXT NOT NULL,
  target_role  TEXT NOT NULL,
  visible      INTEGER NOT NULL CHECK (visible IN (0, 1)),
  updated_at   TEXT NOT NULL,
  updated_by   TEXT REFERENCES users (id) ON DELETE SET NULL,
  PRIMARY KEY (tenant_id, edition, viewer_role, target_role)
);

INSERT INTO score_visibility (tenant_id, edition, viewer_role, target_role, visible, updated_at, updated_by)
SELECT 't_default', edition, viewer_role, target_role, visible, updated_at, updated_by
FROM score_visibility__pre_tenant;

DROP TABLE score_visibility__pre_tenant;

-- `idx_score_visibility_edition ON score_visibility (edition)` died with the
-- table and comes back tenant-leading. One of the 21 re-cuts.
CREATE INDEX IF NOT EXISTS idx_score_visibility_edition
  ON score_visibility (tenant_id, edition);

-- ══ A TRANSITIONAL UNIQUENESS CONSTRAINT, AND WHY IT IS HERE ════════════════
--
-- Widening a PRIMARY KEY invalidates every `ON CONFLICT (<old key>)` in the
-- codebase: SQLite requires a conflict target to MATCH a uniqueness constraint
-- exactly, so `ON CONFLICT (edition, viewer_role, target_role)` stops resolving the moment `tenant_id`
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
-- stands, inserting a second customer's row for the same (edition, viewer_role, target_role) fails with a UNIQUE
-- violation that names it. That is the correct error for "T1 has not finished yet",
-- and it cannot be mistaken for a leak.
--
-- **IT IS DROPPED AT T1 INTEGRATION, FROM THE DECLARED HEADROOM (0102-0108), ONCE
-- THE NINE UPSERTS ABOVE NAME THE WIDENED KEY.** `test/worker/tenant-scope.test.ts`
-- carries the PENDING row that fails when it is still here and the second tenant is
-- real, so it cannot be forgotten.
CREATE UNIQUE INDEX IF NOT EXISTS score_visibility__pre_tenant_key
  ON score_visibility (edition, viewer_role, target_role);
