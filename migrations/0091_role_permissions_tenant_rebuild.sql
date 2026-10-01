-- 0091 — T0-SCHEMA · rebuild 4 of 11. `role_permissions` PK
--        `(edition, role, task_id)` → `(tenant_id, edition, role, task_id)`.
--
-- Recipe: `0087_users_tenant_rebuild.sql`. Key choice: `0089`. Inbound edges: zero.
--
-- ── THIS IS THE AUTHORISATION MATRIX ITSELF ─────────────────────────────────
-- §2 B10: `GET/PUT /api/permissions` is scoped by `edition` only, so a
-- cross-tenant WRITE here re-gates another customer's entire admin console. That
-- is a different kind of leak from a list that shows the wrong rows — it changes
-- who may do what, in a workspace the actor has no business in.
--
-- The scoping belongs on the QUERY that loads these rows
-- (`routes/permissions.ts`, T1-CONFIG's), not on `src/shared/permissions.ts`.
-- `can(edition, role, taskId)` takes an `overrides` map and is a pure function of
-- it; its `edition` is the PRODUCT VARIANT that picks which matrix applies, not a
-- customer key. §11 is explicit: "A T1 session that 'fixes' `src/shared/` has
-- misread the boundary." Nothing under `src/shared/` issues a query — verified,
-- `grep -rln 'prepare(\|DB\.' src/shared/` returns nothing — and that stays true
-- of `src/shared/tenant.ts`, which is a pure predicate builder.
--
-- ── A COMPOSITE PK DOES NOT FORCE THE REBUILD; A TABLE-LEVEL ONE DOES ───────
-- §5d measured `ALTER TABLE role_permissions ADD COLUMN tenant_id …` → OK, on
-- this very table, composite PK and all. So the column could have been added
-- without a rebuild. What cannot be added is a fourth column to the PRIMARY KEY,
-- and without that two customers' grants for the same (edition, role, task_id)
-- are one row. The rebuild buys the key, not the column.

-- ── THE `DEFAULT` ON `tenant_id`, UNIFORM ACROSS ALL THIRTY ──────────────────
-- The 19 `ALTER TABLE` columns carry `DEFAULT 't_default'` because SQLite offers
-- no way to add a NOT NULL column to a populated table without one. The eleven
-- rebuilt tables could have gone without, and `0087`'s header records why they do
-- not: the loud form reddened 109 tests in files owned by other T1 sessions, and a
-- foundation session that merges red is seven T1 branches cut from a red commit.
-- The write-side guard is `test/worker/tenant-scope.test.ts`, per table, extended
-- by whichever session owns each INSERT.
--
CREATE TABLE role_permissions__pre_tenant AS SELECT * FROM role_permissions;

PRAGMA defer_foreign_keys = ON;

DROP TABLE role_permissions;

CREATE TABLE role_permissions (
  tenant_id  TEXT NOT NULL DEFAULT 't_default',
  edition    TEXT NOT NULL CHECK (edition IN ('incubator', 'vc')),
  role       TEXT NOT NULL,
  task_id    TEXT NOT NULL,
  granted    INTEGER NOT NULL DEFAULT 0 CHECK (granted IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT REFERENCES users (id),
  PRIMARY KEY (tenant_id, edition, role, task_id)
);

INSERT INTO role_permissions (tenant_id, edition, role, task_id, granted, updated_at, updated_by)
SELECT 't_default', edition, role, task_id, granted, updated_at, updated_by
FROM role_permissions__pre_tenant;

DROP TABLE role_permissions__pre_tenant;

-- `idx_role_permissions_lookup ON role_permissions (edition, role)` died with the
-- table. Tenant-leading on the way back: this index serves
-- `loadPermissionOverrides(db, edition, role)` on every gated request, and an
-- `edition`-leading index over two values stops narrowing anything the day a
-- second customer exists. One of the 21 re-cuts; the other 20 are in 0099.
CREATE INDEX IF NOT EXISTS idx_role_permissions_lookup
  ON role_permissions (tenant_id, edition, role);

-- ══ A TRANSITIONAL UNIQUENESS CONSTRAINT, AND WHY IT IS HERE ════════════════
--
-- Widening a PRIMARY KEY invalidates every `ON CONFLICT (<old key>)` in the
-- codebase: SQLite requires a conflict target to MATCH a uniqueness constraint
-- exactly, so `ON CONFLICT (edition, role, task_id)` stops resolving the moment `tenant_id`
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
-- stands, inserting a second customer's row for the same (edition, role, task_id) fails with a UNIQUE
-- violation that names it. That is the correct error for "T1 has not finished yet",
-- and it cannot be mistaken for a leak.
--
-- **IT IS DROPPED AT T1 INTEGRATION, FROM THE DECLARED HEADROOM (0102-0108), ONCE
-- THE NINE UPSERTS ABOVE NAME THE WIDENED KEY.** `test/worker/tenant-scope.test.ts`
-- carries the PENDING row that fails when it is still here and the second tenant is
-- real, so it cannot be forgotten.
CREATE UNIQUE INDEX IF NOT EXISTS role_permissions__pre_tenant_key
  ON role_permissions (edition, role, task_id);
