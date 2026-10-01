-- 0093 — T0-SCHEMA · rebuild 6 of 11. `seat_capabilities` PK
--        `(edition, param_set, tier)` → `(tenant_id, edition, param_set, tier)`.
--
-- Recipe: `0087_users_tenant_rebuild.sql`. Key choice: `0089`. Inbound edges: zero.
--
-- ── THIS ONE IS A QUESTION THE CLIENT HAS NOT ANSWERED, AND IT SHIPS THE
--    REVERSIBLE WAY ─────────────────────────────────────────────────────────
-- §5c and §7 Q7: `seat_capabilities` says which parameter sets each purchased
-- TIER may configure. That is an entitlement of a purchased tier, and the client
-- has just said tier pricing is ai.STARTUPJURY's. If entitlement follows price,
-- this table belongs in the PLATFORM-GLOBAL bucket beside the eight pricing
-- tables, and the tenant-owned count is 27 rather than 28.
--
-- We ship the customer's reading — `(tenant_id, edition)`-keyed, here — for one
-- reason: the two directions are not equally recoverable. Per-tenant now and
-- global later is a DELETE of the redundant rows plus dropping a key column.
-- Global now and per-tenant later is this rebuild again, after customers have
-- configured against a table that was never theirs. So the cheap mistake is the
-- one that ships.
--
-- If the client answers "AISJ's", the follow-up is a single migration out of this
-- block's headroom, not a re-plan.

-- ── THE `DEFAULT` ON `tenant_id`, UNIFORM ACROSS ALL THIRTY ──────────────────
-- The 19 `ALTER TABLE` columns carry `DEFAULT 't_default'` because SQLite offers
-- no way to add a NOT NULL column to a populated table without one. The eleven
-- rebuilt tables could have gone without, and `0087`'s header records why they do
-- not: the loud form reddened 109 tests in files owned by other T1 sessions, and a
-- foundation session that merges red is seven T1 branches cut from a red commit.
-- The write-side guard is `test/worker/tenant-scope.test.ts`, per table, extended
-- by whichever session owns each INSERT.
--
CREATE TABLE seat_capabilities__pre_tenant AS SELECT * FROM seat_capabilities;

PRAGMA defer_foreign_keys = ON;

DROP TABLE seat_capabilities;

CREATE TABLE seat_capabilities (
  tenant_id  TEXT NOT NULL DEFAULT 't_default',
  edition    TEXT NOT NULL CHECK (edition IN ('incubator', 'vc')),
  param_set  TEXT NOT NULL CHECK (param_set IN ('core', 'addl')),
  tier       TEXT NOT NULL CHECK (tier IN ('standard', 'pro', 'premium')),
  allowed    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, edition, param_set, tier)
);

INSERT INTO seat_capabilities (tenant_id, edition, param_set, tier, allowed)
SELECT 't_default', edition, param_set, tier, allowed
FROM seat_capabilities__pre_tenant;

DROP TABLE seat_capabilities__pre_tenant;

-- ══ A TRANSITIONAL UNIQUENESS CONSTRAINT, AND WHY IT IS HERE ════════════════
--
-- Widening a PRIMARY KEY invalidates every `ON CONFLICT (<old key>)` in the
-- codebase: SQLite requires a conflict target to MATCH a uniqueness constraint
-- exactly, so `ON CONFLICT (edition, param_set, tier)` stops resolving the moment `tenant_id`
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
-- stands, inserting a second customer's row for the same (edition, param_set, tier) fails with a UNIQUE
-- violation that names it. That is the correct error for "T1 has not finished yet",
-- and it cannot be mistaken for a leak.
--
-- **IT IS DROPPED AT T1 INTEGRATION, FROM THE DECLARED HEADROOM (0102-0108), ONCE
-- THE NINE UPSERTS ABOVE NAME THE WIDENED KEY.** `test/worker/tenant-scope.test.ts`
-- carries the PENDING row that fails when it is still here and the second tenant is
-- real, so it cannot be forgotten.
CREATE UNIQUE INDEX IF NOT EXISTS seat_capabilities__pre_tenant_key
  ON seat_capabilities (edition, param_set, tier);
