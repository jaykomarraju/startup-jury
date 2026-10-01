-- 0101 — T1 INTEGRATION · drop the five transitional pre-tenant unique keys.
--
-- This is the statement `0091`–`0095` were each written to wait for, and it is the
-- last thing standing between the schema and a second customer.
--
-- ── WHAT THOSE FIVE MIGRATIONS LEFT, AND WHY ────────────────────────────────
-- Each of them widened a PRIMARY KEY to include `tenant_id`. Widening a PK
-- invalidates every `ON CONFLICT (<old key>)` that names the old one, and there
-- were NINE such upserts in six files owned by four different T1 sessions. A
-- migration cannot land ahead of code it would break, so the old key survived
-- alongside the new PK as an ordinary `UNIQUE INDEX`, named `<table>__pre_tenant_key`.
--
-- ── WHAT THOSE MIGRATIONS' HEADERS GOT WRONG ABOUT THE FAILURE MODE ─────────
-- All five predict that, while the transitional index stands, a second customer's
-- row "fails with a UNIQUE violation that names it" — a loud, safe error.
--
-- **Measured on SQLite 3.51 and again inside D1: that is wrong in the dangerous
-- direction.** The transitional index IS a matching unique constraint, so an
-- `ON CONFLICT (edition) DO UPDATE` statement does not fail at all — it resolves
-- to the OTHER TENANT'S ROW and updates it:
--
--   -- PK (tenant_id, edition), standing UNIQUE (edition), existing row is t_default's
--   INSERT INTO t (tenant_id, edition, v) VALUES ('t_zz','incubator','B')
--     ON CONFLICT (edition) DO UPDATE SET v = excluded.v;
--   -- → t_default|incubator|B    ONE row, tenant A's key, tenant B's data, HTTP 200
--
-- No exception, no second row, no audit trail. Tenant B's save DESTROYS tenant A's
-- row. So correcting the nine conflict targets was a prerequisite for this file,
-- not a tidy-up after it — and all nine now name the widened key:
--
--   role_permissions       routes/permissions.ts   (tenant_id, edition, role, task_id)
--   score_visibility       routes/config.ts        (tenant_id, edition, viewer_role, target_role)
--   seat_capabilities      routes/aiPrompts.ts     (tenant_id, edition, param_set, tier)
--   account_profiles       routes/account.ts ×2    (tenant_id, edition)
--   billing_subscriptions  routes/billing.ts       (tenant_id, edition)
--                          seats/ledger.ts         (tenant_id, edition)
--   authorised_signatories esign/store.ts ×2       (tenant_id, edition, role|user_id)
--
-- ── WHY THE ASSERTIONS COME FIRST ──────────────────────────────────────────
-- Dropping a unique index is only safe if the widened key is really there. On an
-- instance where a rebuild silently did not apply — the drift this deployment has
-- hit every wave, and the shape `0038` failed on — the table would still carry its
-- OLD narrow PK, and dropping the index would leave it with NO uniqueness at all:
-- duplicate rows, no error, discovered later. So assertion 1 refuses to proceed
-- unless `tenant_id` is part of the primary key in all five tables.
--
-- The FUNCTIONAL proof — that a second tenant's row can now actually be stored —
-- is deliberately not here. A migration that inserts and deletes probe rows on
-- live data is the wrong place for it. It lives where `0091`'s header says it
-- does: `test/worker/tenant-scope.test.ts` seeds all five tables for tenant B,
-- which is impossible while this file has not run.

-- 1. GUARD. `tenant_id` is part of the primary key in all five tables. `pk > 0` in
--    `pragma_table_info` means "participates in the PK", and its value is the
--    1-based position, so this also catches a column that exists but was left out.
INSERT INTO _tenancy_assert (id, verdict)
SELECT '0101.widened_keys_present_before_drop',
       CASE WHEN (SELECT count(*) FROM pragma_table_info('role_permissions')      WHERE name = 'tenant_id' AND pk > 0)
               + (SELECT count(*) FROM pragma_table_info('score_visibility')      WHERE name = 'tenant_id' AND pk > 0)
               + (SELECT count(*) FROM pragma_table_info('seat_capabilities')     WHERE name = 'tenant_id' AND pk > 0)
               + (SELECT count(*) FROM pragma_table_info('account_profiles')      WHERE name = 'tenant_id' AND pk > 0)
               + (SELECT count(*) FROM pragma_table_info('billing_subscriptions') WHERE name = 'tenant_id' AND pk > 0)
            = 5
            THEN 'ok'
            ELSE 'FAIL: a rebuild from 0091-0095 did not apply on this instance — '
              || 'tenant_id is not in the primary key of all five tables, so dropping '
              || 'the transitional index would leave the table with no uniqueness at all' END
ON CONFLICT (id) DO UPDATE SET verdict = excluded.verdict, at = datetime('now');

-- 2. THE DROP. `IF EXISTS` so the chain is idempotent on an instance that already
--    ran it; the assertion below is what actually proves the outcome.
DROP INDEX IF EXISTS role_permissions__pre_tenant_key;
DROP INDEX IF EXISTS score_visibility__pre_tenant_key;
DROP INDEX IF EXISTS seat_capabilities__pre_tenant_key;
DROP INDEX IF EXISTS account_profiles__pre_tenant_key;
DROP INDEX IF EXISTS billing_subscriptions__pre_tenant_key;

-- 3. All five are gone. Named individually in the message so a partial outcome
--    says which one survived rather than that "something" did.
INSERT INTO _tenancy_assert (id, verdict)
SELECT '0101.transitional_keys_dropped',
       CASE WHEN (SELECT count(*) FROM sqlite_master
                  WHERE type = 'index'
                    AND name IN ('role_permissions__pre_tenant_key',
                                 'score_visibility__pre_tenant_key',
                                 'seat_capabilities__pre_tenant_key',
                                 'account_profiles__pre_tenant_key',
                                 'billing_subscriptions__pre_tenant_key')) = 0
            THEN 'ok'
            ELSE 'FAIL: a pre-tenant unique key survived the drop: '
              || (SELECT group_concat(name, ', ') FROM sqlite_master
                  WHERE type = 'index'
                    AND name IN ('role_permissions__pre_tenant_key',
                                 'score_visibility__pre_tenant_key',
                                 'seat_capabilities__pre_tenant_key',
                                 'account_profiles__pre_tenant_key',
                                 'billing_subscriptions__pre_tenant_key')) END
ON CONFLICT (id) DO UPDATE SET verdict = excluded.verdict, at = datetime('now');

-- 4. AND NOTHING WAS LOST BY DROPPING THEM. The old key is still enforced, as the
--    LEADING EDITION-WISE part of the wider PK: within one tenant, the same
--    `(edition, …)` tuple is still unique. This is the assertion that distinguishes
--    "the narrow constraint was replaced by a wider one" from "the constraint is
--    gone" — a duplicate inside one tenant is the regression this file could cause,
--    and it would otherwise surface as two rows where the UI expects one.
INSERT INTO _tenancy_assert (id, verdict)
SELECT '0101.no_duplicate_rows_within_a_tenant',
       CASE WHEN (
      (SELECT count(*) FROM (SELECT tenant_id, edition, role, task_id FROM role_permissions
                             GROUP BY 1,2,3,4 HAVING count(*) > 1))
    + (SELECT count(*) FROM (SELECT tenant_id, edition, viewer_role, target_role FROM score_visibility
                             GROUP BY 1,2,3,4 HAVING count(*) > 1))
    + (SELECT count(*) FROM (SELECT tenant_id, edition, param_set, tier FROM seat_capabilities
                             GROUP BY 1,2,3,4 HAVING count(*) > 1))
    + (SELECT count(*) FROM (SELECT tenant_id, edition FROM account_profiles
                             GROUP BY 1,2 HAVING count(*) > 1))
    + (SELECT count(*) FROM (SELECT tenant_id, edition FROM billing_subscriptions
                             GROUP BY 1,2 HAVING count(*) > 1))
       ) = 0
            THEN 'ok'
            ELSE 'FAIL: dropping a transitional key left duplicate rows inside one tenant — '
              || 'the widened PRIMARY KEY is not being enforced on this instance' END
ON CONFLICT (id) DO UPDATE SET verdict = excluded.verdict, at = datetime('now');
