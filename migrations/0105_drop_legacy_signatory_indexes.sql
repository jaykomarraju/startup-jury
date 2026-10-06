-- 0105 — L5 · the two transitional unique keys `0101` missed.
--
-- `0101` is the statement nine `ON CONFLICT` upserts were waiting for, and it drops
-- exactly five indexes: `role_permissions__pre_tenant_key`,
-- `score_visibility__pre_tenant_key`, `seat_capabilities__pre_tenant_key`,
-- `account_profiles__pre_tenant_key` and `billing_subscriptions__pre_tenant_key`.
-- Five names, one naming convention, one `IN (...)` list to assert over.
--
-- `authorised_signatories` is the SIXTH table in that transaction and its two keys
-- are not in the list. `0101`'s own header line 39 names it —
--
--   authorised_signatories esign/store.ts ×2       (tenant_id, edition, role|user_id)
--
-- — among the upserts it had to widen, and the widening landed: `esign/store.ts:503`
-- and `:518` both name the tenant-scoped targets today. But the legacy pair survives,
-- because it was created five months earlier by
-- `0035_agreements_and_signatures.sql:113-114` under the names `idx_auth_sig_role`
-- and `idx_auth_sig_user` rather than `<table>__pre_tenant_key`, so the set assertion
-- that proves `0101` finished its job cannot see them and reports `ok`.
--
-- `0099_tenant_index_pass.sql:116-128` records the decision precisely and correctly:
-- it ADDED `idx_auth_sig_role_tenant` and `idx_auth_sig_user_tenant` beside the old
-- pair rather than re-cutting them, and says in as many words that "integration
-- drops the old pair from the declared headroom once those two upserts name the
-- widened key". Both halves happened. The drop did not.
--
-- ── WHAT IT COSTS TODAY ─────────────────────────────────────────────────────
-- MEASURED twice (2026-09-30 against the materialised chain, again 2026-10-01 on a
-- fully provisioned second tenant): `PUT /api/esign/signatories` for a second
-- customer is a hard **HTTP 500**,
--
--   UNIQUE constraint failed: authorised_signatories.edition, authorised_signatories.role
--
-- …because `0035`'s index spans `(edition, role)` with no tenant, and the incubator
-- seed at `0035:211-216` already holds every incubator role for `t_default`. So the
-- SECOND customer to grant signing authority to their Program Manager cannot: the
-- admin console's Sign-up section 500s, and the Authorised signatories pool is a
-- prerequisite for a founder's agreement to be counter-signed at all.
--
-- Note which direction this fails in, because it is the OPPOSITE of the one `0101`'s
-- header warns about. There, a surviving transitional index was a *matching* unique
-- constraint, so `ON CONFLICT (edition) DO UPDATE` resolved silently to the other
-- tenant's row and overwrote it — 200, no trace. Here the two upserts name the
-- WIDENED key, which the legacy index does not match, so the legacy index has
-- nothing to resolve against and simply refuses the INSERT. Loud and safe, and the
-- reason this one is a bug report rather than a data-loss incident.
--
-- ── WHY THE USER ARM NEVER COMPLAINED ───────────────────────────────────────
-- `idx_auth_sig_user ON (edition, user_id)` collides only when two customers name
-- the same `users.id`, and ids are UUIDs — so it never fires in practice and never
-- fired in a test. `test/worker/tenant-scope.test.ts`'s fixture for this table is
-- precisely that arm (`user_id = 'zz_admin'`, no role), which is why a suite built
-- to catch exactly this class of defect has been green over it since T0. The
-- ROLE-ARM case added to that file alongside this migration is the one that
-- exercises the collision: role names are a closed vocabulary, so every customer
-- holds the same six, and the second customer to store one collides by definition.
-- Dropping these indexes without that case would be a drop nothing proves.

-- 1. GUARD, BEFORE THE DROP. `0101`'s pattern, and it is not ceremony here either.
--    These are the table's ONLY uniqueness: `authorised_signatories` has `id` as its
--    primary key — `0086:35` added `tenant_id` as a plain column and no migration
--    rebuilt the PK — so "exactly one grant per (workspace, role)" is enforced by
--    `idx_auth_sig_role_tenant` and by nothing else. On an instance where `0099` did
--    not apply (the rebuild drift this deployment has hit every wave, and the shape
--    `0038` failed on), dropping the legacy pair would leave the table with NO
--    uniqueness at all: the upsert's `ON CONFLICT` target would not exist, every
--    toggle would INSERT a second row, and `loadSignatoryPool` would read whichever
--    one it saw first. Silent, and worse than the 500 this file fixes.
INSERT INTO _tenancy_assert (id, verdict)
SELECT '0105.tenant_scoped_signatory_keys_present_before_drop',
       CASE WHEN (SELECT count(*) FROM sqlite_master
                  WHERE type = 'index'
                    AND name IN ('idx_auth_sig_role_tenant', 'idx_auth_sig_user_tenant')) = 2
            THEN 'ok'
            ELSE 'FAIL: 0099 did not apply on this instance — the tenant-scoped '
              || 'signatory indexes are not both present, so dropping the legacy pair '
              || 'would leave authorised_signatories with no uniqueness at all. '
              || 'Present: ' || coalesce((SELECT group_concat(name, ', ') FROM sqlite_master
                   WHERE type = 'index'
                     AND name IN ('idx_auth_sig_role_tenant', 'idx_auth_sig_user_tenant')), 'neither') END
ON CONFLICT (id) DO UPDATE SET verdict = excluded.verdict, at = datetime('now');

-- 2. AND THE REPLACEMENTS MUST ACTUALLY CARRY THE TENANT. An index of the right
--    NAME proves nothing: `0099` creates these with `IF NOT EXISTS`, so an instance
--    that somehow holds a same-named index over the wrong columns would pass step 1
--    and still lose the constraint. `pragma_index_info` is the columns themselves.
INSERT INTO _tenancy_assert (id, verdict)
SELECT '0105.replacement_keys_are_tenant_scoped',
       CASE WHEN (SELECT count(*) FROM pragma_index_info('idx_auth_sig_role_tenant') WHERE name = 'tenant_id')
               + (SELECT count(*) FROM pragma_index_info('idx_auth_sig_user_tenant') WHERE name = 'tenant_id')
            = 2
            THEN 'ok'
            ELSE 'FAIL: idx_auth_sig_role_tenant / idx_auth_sig_user_tenant exist but do '
              || 'not both include tenant_id — they are not the replacements 0099 declared' END
ON CONFLICT (id) DO UPDATE SET verdict = excluded.verdict, at = datetime('now');

-- 3. THE DROP. `IF EXISTS` so the chain is idempotent on an instance that already ran
--    it — and on a fresh database too, where `0035` created them and nothing since
--    has. The assertion below is what proves the outcome, not this statement.
DROP INDEX IF EXISTS idx_auth_sig_role;
DROP INDEX IF EXISTS idx_auth_sig_user;

-- 4. BOTH GONE, named individually so a partial outcome says which one survived.
INSERT INTO _tenancy_assert (id, verdict)
SELECT '0105.legacy_signatory_keys_dropped',
       CASE WHEN (SELECT count(*) FROM sqlite_master
                  WHERE type = 'index' AND name IN ('idx_auth_sig_role', 'idx_auth_sig_user')) = 0
            THEN 'ok'
            ELSE 'FAIL: a pre-tenant signatory key survived the drop: '
              || (SELECT group_concat(name, ', ') FROM sqlite_master
                  WHERE type = 'index' AND name IN ('idx_auth_sig_role', 'idx_auth_sig_user')) END
ON CONFLICT (id) DO UPDATE SET verdict = excluded.verdict, at = datetime('now');

-- 5. AND NOTHING WAS LOST BY DROPPING THEM. `0101`'s fourth assertion, applied to this
--    table's two partial arms: within ONE workspace the same role, and the same user,
--    may still appear at most once. This is what distinguishes "the narrow constraint
--    was replaced by a wider one" from "the constraint is gone" — a duplicate inside
--    one customer is the regression this file could cause, and it would surface as
--    two grants where the console renders one checkbox.
--
--    The `WHERE … IS NOT NULL` arms are not decoration: the table's own
--    `CHECK ((role IS NULL) <> (user_id IS NULL))` makes exactly one column set per
--    row, so grouping without them would count every user grant as a duplicate
--    `role = NULL`.
INSERT INTO _tenancy_assert (id, verdict)
SELECT '0105.no_duplicate_signatory_grants_within_a_workspace',
       CASE WHEN (
      (SELECT count(*) FROM (SELECT tenant_id, edition, role FROM authorised_signatories
                             WHERE role IS NOT NULL GROUP BY 1,2,3 HAVING count(*) > 1))
    + (SELECT count(*) FROM (SELECT tenant_id, edition, user_id FROM authorised_signatories
                             WHERE user_id IS NOT NULL GROUP BY 1,2,3 HAVING count(*) > 1))
       ) = 0
            THEN 'ok'
            ELSE 'FAIL: dropping a legacy signatory key left duplicate grants inside one '
              || 'workspace — idx_auth_sig_role_tenant / idx_auth_sig_user_tenant are not '
              || 'being enforced on this instance' END
ON CONFLICT (id) DO UPDATE SET verdict = excluded.verdict, at = datetime('now');
