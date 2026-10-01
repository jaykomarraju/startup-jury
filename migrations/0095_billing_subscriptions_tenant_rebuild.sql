-- 0095 — T0-SCHEMA · rebuild 8 of 11. `billing_subscriptions` PK `edition` →
--        `(tenant_id, edition)`.
--
-- Recipe: `0087_users_tenant_rebuild.sql`. Inbound edges: zero.
--
-- ── SAME DEPARTURE FROM §5c, SAME EVIDENCE ──────────────────────────────────
-- §5c pairs this table with `account_profiles` and recommends `tenant_id` alone.
-- `0094`'s header has the full argument; the measurement is the same shape and
-- this time it is reproduced locally too:
--
--   deployed (READ-ONLY, 2026-09-30):  incubator 1, vc 1
--   local, all 63 migrations applied:  incubator 1, vc 1   ← `0046` seeds both
--
-- So unlike `account_profiles` this collision WOULD have been caught by `npm
-- test`. Keying both tables the same way is still the right answer: a
-- `(tenant_id)` subscription and a `(tenant_id, edition)` profile would mean one
-- customer running two workspaces had one subscription and two commercial
-- addresses, and `routes/billing.ts` would have to decide which workspace the
-- single subscription belonged to on every read.
--
-- ── NO AMOUNT COLUMN, WHICH IS THE POINT ────────────────────────────────────
-- §3's fifth measurement: `billing_subscriptions` can hold a negotiated plan
-- LABEL (`0046:35-38`) but has no amount column at all, which is one of the five
-- reasons the price catalogue is platform-global and the eight pricing tables
-- must NOT gain a tenant key. Nothing here changes that. A negotiated price per
-- customer, if the client ever wants one, is a new column on this table and not a
-- per-tenant catalogue — and it is a migration, not a setting, which is why §7 Q2
-- asks for the global reading in writing before the gate moves.

-- ── THE `DEFAULT` ON `tenant_id`, UNIFORM ACROSS ALL THIRTY ──────────────────
-- The 19 `ALTER TABLE` columns carry `DEFAULT 't_default'` because SQLite offers
-- no way to add a NOT NULL column to a populated table without one. The eleven
-- rebuilt tables could have gone without, and `0087`'s header records why they do
-- not: the loud form reddened 109 tests in files owned by other T1 sessions, and a
-- foundation session that merges red is seven T1 branches cut from a red commit.
-- The write-side guard is `test/worker/tenant-scope.test.ts`, per table, extended
-- by whichever session owns each INSERT.
--
CREATE TABLE billing_subscriptions__pre_tenant AS SELECT * FROM billing_subscriptions;

PRAGMA defer_foreign_keys = ON;

DROP TABLE billing_subscriptions;

CREATE TABLE billing_subscriptions (
  tenant_id      TEXT NOT NULL DEFAULT 't_default',
  edition        TEXT NOT NULL CHECK (edition IN ('incubator', 'vc')),
  -- `price_plans.code` when the plan is a catalogue one; NULL for a negotiated
  -- plan, whose name is then `plan_label`.
  plan_code      TEXT,
  plan_label     TEXT NOT NULL,
  -- The tile's sub-line prefix: "Enterprise · 5 seats".
  tier_label     TEXT,
  seats          INTEGER NOT NULL DEFAULT 0 CHECK (seats >= 0),
  billing_period TEXT NOT NULL DEFAULT 'year' CHECK (billing_period IN ('month', 'year')),
  -- YYYY-MM-DD. The cycle containing today is derived from it, never stored.
  cycle_anchor   TEXT NOT NULL,
  currency       TEXT NOT NULL DEFAULT 'INR',
  status         TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'trialing', 'past_due', 'cancelled')),
  billing_email  TEXT,
  -- The CUSTOMER's GSTIN (ours is `pricing_settings.gst_registration`).
  gstin          TEXT,
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, edition)
);

INSERT INTO billing_subscriptions (
  tenant_id, edition, plan_code, plan_label, tier_label, seats, billing_period,
  cycle_anchor, currency, status, billing_email, gstin, updated_at
)
SELECT
  't_default', edition, plan_code, plan_label, tier_label, seats, billing_period,
  cycle_anchor, currency, status, billing_email, gstin, updated_at
FROM billing_subscriptions__pre_tenant;

DROP TABLE billing_subscriptions__pre_tenant;

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
CREATE UNIQUE INDEX IF NOT EXISTS billing_subscriptions__pre_tenant_key
  ON billing_subscriptions (edition);
