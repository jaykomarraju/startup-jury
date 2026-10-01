-- 0088 — T0-SCHEMA · prove 0087 applied WHOLE. Nothing else.
--
-- `0038` is this repo's precedent for a migration that passed on a fresh seed and
-- died on real data, and its failure was LOUD — a FOREIGN KEY constraint error on
-- apply, recoverable. 0087's failure mode is the opposite: the rebuild it routes
-- around reports SUCCESS and leaves 41 foreign keys in 34 tables pointing at a
-- table that no longer exists, and nothing surfaces until a later INSERT or
-- DELETE behaves as though the constraint were gone.
--
-- `grep -rn "foreign_key_check\|integrity_check" src test e2e scripts package.json`
-- returned ZERO before this file. `test/worker/migrations-w1b.test.ts` asserts
-- numbering, contiguity, `IF NOT EXISTS` guards, re-executable inserts and
-- idempotent re-apply — it has never asserted referential integrity. §5f: "the
-- detector has to be written before the first rebuild lands". This is half of it;
-- the other half is the `PRAGMA foreign_key_check` assertion now in that test
-- file, which can read a PRAGMA where SQL cannot.
--
-- ── WHY A SEPARATE MIGRATION AND NOT THE TAIL OF 0087 ───────────────────────
-- Because 0087 runs as ONE transaction. An assertion inside it can only fail
-- together with the thing it is asserting, which tells you nothing you would not
-- already know. Here it runs AFTER 0087 has committed — including on the
-- `--remote` path, which is the one that could not be proved from this session
-- without writing to production. If this file fails, 0087 half-applied: restore
-- from the `wrangler d1 time-travel` bookmark and do not continue.
--
-- ── HOW AN ASSERTION FAILS A MIGRATION IN SQLite ────────────────────────────
-- `RAISE(ABORT, …)` only exists inside a trigger. So the verdict is INSERTed
-- into a column whose CHECK admits exactly one value: a failing assertion writes
-- its own message, the CHECK refuses it, the statement errors, the transaction
-- rolls back and the chain stops with the reason in the error text. The
-- `ON CONFLICT … DO UPDATE` makes the file re-executable AND makes a re-run
-- re-check rather than skip — a plain `DO NOTHING` would turn the second apply
-- into a no-op that proves nothing.
--
-- `_tenancy_assert` is kept, not dropped: it is a two-column ledger of which
-- tenancy invariants have been proved against THIS database, readable with one
-- SELECT when someone asks six months from now whether the rebuild was clean.

CREATE TABLE IF NOT EXISTS _tenancy_assert (
  id      TEXT PRIMARY KEY,
  -- The whole mechanism. A failing assertion supplies its own message and this
  -- CHECK turns it into a failed migration.
  verdict TEXT NOT NULL CHECK (verdict = 'ok'),
  at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 1. The stash table is gone, so the rebuild reached its last statement.
INSERT INTO _tenancy_assert (id, verdict)
SELECT '0088.stash_dropped',
       CASE WHEN (SELECT count(*) FROM sqlite_master
                  WHERE type = 'table' AND name = 'users__pre_tenant') = 0
            THEN 'ok' ELSE 'FAIL 0087: users__pre_tenant still exists' END
ON CONFLICT (id) DO UPDATE SET verdict = excluded.verdict, at = datetime('now');

-- 2. `users` carries the new key and no longer carries the global one. Matched
--    against the stored DDL rather than against behaviour, because a behavioural
--    probe would have to write a duplicate row to find out.
INSERT INTO _tenancy_assert (id, verdict)
SELECT '0088.users_unique_is_per_tenant',
       CASE WHEN (SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'users'
                  AND sql LIKE '%UNIQUE (tenant_id, email)%'
                  -- Whitespace-proof: the OLD column-level constraint, with every
                  -- space and newline removed, must be gone.
                  AND replace(replace(replace(sql, ' ', ''), char(10), ''), char(9), '')
                      NOT LIKE '%emailTEXTNOTNULLUNIQUE%') = 1
            THEN 'ok' ELSE 'FAIL 0087: users UNIQUE is not (tenant_id, email)' END
ON CONFLICT (id) DO UPDATE SET verdict = excluded.verdict, at = datetime('now');

-- 3. THE TRAP ITSELF. No table's DDL may mention a renamed `users`. This is the
--    assertion that would have caught the rename recipe 0087 rejected: it fires
--    on 35 tables at once.
INSERT INTO _tenancy_assert (id, verdict)
SELECT '0088.no_child_points_at_a_renamed_users',
       CASE WHEN (SELECT count(*) FROM sqlite_master
                  WHERE type = 'table'
                    AND (sql LIKE '%users_old%' OR sql LIKE '%users__pre_tenant%'
                         OR sql LIKE '%users_new%')) = 0
            THEN 'ok'
            ELSE 'FAIL 0087: child DDL references a renamed users table — '
                 || (SELECT group_concat(name) FROM sqlite_master WHERE type = 'table'
                     AND (sql LIKE '%users_old%' OR sql LIKE '%users__pre_tenant%'
                          OR sql LIKE '%users_new%')) END
ON CONFLICT (id) DO UPDATE SET verdict = excluded.verdict, at = datetime('now');

-- 4. The rows survived. A rebuild that drops the table and restores nothing
--    passes assertions 1-3 and leaves nobody able to sign in.
INSERT INTO _tenancy_assert (id, verdict)
SELECT '0088.users_not_empty',
       CASE WHEN (SELECT count(*) FROM users) > 0
            THEN 'ok' ELSE 'FAIL 0087: users is empty after the rebuild' END
ON CONFLICT (id) DO UPDATE SET verdict = excluded.verdict, at = datetime('now');

-- 5. Every row landed in a real organisation. This is the FK that §5d measured
--    cannot be declared — `ALTER TABLE … ADD COLUMN … NOT NULL DEFAULT …
--    REFERENCES organizations(id)` is refused — so it is asserted instead.
INSERT INTO _tenancy_assert (id, verdict)
SELECT '0088.users_tenant_resolves',
       CASE WHEN (SELECT count(*) FROM users u
                  LEFT JOIN organizations o ON o.id = u.tenant_id
                  WHERE o.id IS NULL) = 0
            THEN 'ok' ELSE 'FAIL 0087: users rows carry a tenant_id with no organizations row' END
ON CONFLICT (id) DO UPDATE SET verdict = excluded.verdict, at = datetime('now');

-- 6. ALL 41 INBOUND EDGES STILL RESOLVE, one LEFT JOIN per edge, enumerated from
--    `pragma_foreign_key_list` over the materialised schema rather than typed by
--    hand. This is `PRAGMA foreign_key_check` expressed in SQL, which is what the
--    migration runner can execute: the PRAGMA's table-valued form
--    (`pragma_foreign_key_list(...)` in a SELECT) is refused by D1 with
--    SQLITE_AUTH, so it cannot be used here. The statement form works and is
--    asserted from `migrations-w1b.test.ts` instead.
INSERT INTO _tenancy_assert (id, verdict)
SELECT '0088.all_41_user_edges_resolve',
       CASE WHEN (
      (SELECT count(*) FROM account_orders c LEFT JOIN users u ON u.id = c.created_by WHERE c.created_by IS NOT NULL AND u.id IS NULL)
    + (SELECT count(*) FROM account_profiles c LEFT JOIN users u ON u.id = c.updated_by WHERE c.updated_by IS NOT NULL AND u.id IS NULL)
    + (SELECT count(*) FROM agreements c LEFT JOIN users u ON u.id = c.countersigned_by WHERE c.countersigned_by IS NOT NULL AND u.id IS NULL)
    + (SELECT count(*) FROM audit_log c LEFT JOIN users u ON u.id = c.actor_id WHERE c.actor_id IS NOT NULL AND u.id IS NULL)
    + (SELECT count(*) FROM authorised_signatories c LEFT JOIN users u ON u.id = c.user_id WHERE c.user_id IS NOT NULL AND u.id IS NULL)
    + (SELECT count(*) FROM billing_payment_intents c LEFT JOIN users u ON u.id = c.actor_id WHERE c.actor_id IS NOT NULL AND u.id IS NULL)
    + (SELECT count(*) FROM call_outcomes c LEFT JOIN users u ON u.id = c.set_by WHERE c.set_by IS NOT NULL AND u.id IS NULL)
    + (SELECT count(*) FROM call_participants c LEFT JOIN users u ON u.id = c.user_id WHERE c.user_id IS NOT NULL AND u.id IS NULL)
    + (SELECT count(*) FROM call_schedulers c LEFT JOIN users u ON u.id = c.assigned_by WHERE c.assigned_by IS NOT NULL AND u.id IS NULL)
    + (SELECT count(*) FROM call_schedulers c LEFT JOIN users u ON u.id = c.user_id WHERE c.user_id IS NOT NULL AND u.id IS NULL)
    + (SELECT count(*) FROM calls c LEFT JOIN users u ON u.id = c.created_by WHERE c.created_by IS NOT NULL AND u.id IS NULL)
    + (SELECT count(*) FROM calls c LEFT JOIN users u ON u.id = c.organizer_id WHERE c.organizer_id IS NOT NULL AND u.id IS NULL)
    + (SELECT count(*) FROM credit_ledger c LEFT JOIN users u ON u.id = c.actor_id WHERE c.actor_id IS NOT NULL AND u.id IS NULL)
    + (SELECT count(*) FROM dd_items c LEFT JOIN users u ON u.id = c.updated_by WHERE c.updated_by IS NOT NULL AND u.id IS NULL)
    + (SELECT count(*) FROM deck_assignments c LEFT JOIN users u ON u.id = c.assigned_by WHERE c.assigned_by IS NOT NULL AND u.id IS NULL)
    + (SELECT count(*) FROM deck_assignments c LEFT JOIN users u ON u.id = c.evaluator_id WHERE c.evaluator_id IS NOT NULL AND u.id IS NULL)
    + (SELECT count(*) FROM deck_onboarding c LEFT JOIN users u ON u.id = c.lead_user_id WHERE c.lead_user_id IS NOT NULL AND u.id IS NULL)
    + (SELECT count(*) FROM deck_onboarding c LEFT JOIN users u ON u.id = c.updated_by WHERE c.updated_by IS NOT NULL AND u.id IS NULL)
    + (SELECT count(*) FROM deck_versions c LEFT JOIN users u ON u.id = c.uploaded_by WHERE c.uploaded_by IS NOT NULL AND u.id IS NULL)
    + (SELECT count(*) FROM decks c LEFT JOIN users u ON u.id = c.assigned_to WHERE c.assigned_to IS NOT NULL AND u.id IS NULL)
    + (SELECT count(*) FROM decks c LEFT JOIN users u ON u.id = c.uploaded_by WHERE c.uploaded_by IS NOT NULL AND u.id IS NULL)
    + (SELECT count(*) FROM evaluation_recommendations c LEFT JOIN users u ON u.id = c.user_id WHERE c.user_id IS NOT NULL AND u.id IS NULL)
    + (SELECT count(*) FROM evaluations c LEFT JOIN users u ON u.id = c.evaluator_id WHERE c.evaluator_id IS NOT NULL AND u.id IS NULL)
    + (SELECT count(*) FROM ic_votes c LEFT JOIN users u ON u.id = c.member_id WHERE c.member_id IS NOT NULL AND u.id IS NULL)
    + (SELECT count(*) FROM messages c LEFT JOIN users u ON u.id = c.from_id WHERE c.from_id IS NOT NULL AND u.id IS NULL)
    + (SELECT count(*) FROM notification_preferences c LEFT JOIN users u ON u.id = c.user_id WHERE c.user_id IS NOT NULL AND u.id IS NULL)
    + (SELECT count(*) FROM notifications c LEFT JOIN users u ON u.id = c.user_id WHERE c.user_id IS NOT NULL AND u.id IS NULL)
    + (SELECT count(*) FROM org_scoring_settings c LEFT JOIN users u ON u.id = c.updated_by WHERE c.updated_by IS NOT NULL AND u.id IS NULL)
    + (SELECT count(*) FROM pipeline_events c LEFT JOIN users u ON u.id = c.actor_id WHERE c.actor_id IS NOT NULL AND u.id IS NULL)
    + (SELECT count(*) FROM programs c LEFT JOIN users u ON u.id = c.owner_id WHERE c.owner_id IS NOT NULL AND u.id IS NULL)
    + (SELECT count(*) FROM role_permissions c LEFT JOIN users u ON u.id = c.updated_by WHERE c.updated_by IS NOT NULL AND u.id IS NULL)
    + (SELECT count(*) FROM score_visibility c LEFT JOIN users u ON u.id = c.updated_by WHERE c.updated_by IS NOT NULL AND u.id IS NULL)
    + (SELECT count(*) FROM scores c LEFT JOIN users u ON u.id = c.evaluator_id WHERE c.evaluator_id IS NOT NULL AND u.id IS NULL)
    + (SELECT count(*) FROM seat_grants c LEFT JOIN users u ON u.id = c.actor_id WHERE c.actor_id IS NOT NULL AND u.id IS NULL)
    + (SELECT count(*) FROM signatures c LEFT JOIN users u ON u.id = c.signer_user_id WHERE c.signer_user_id IS NOT NULL AND u.id IS NULL)
    + (SELECT count(*) FROM signup_documents c LEFT JOIN users u ON u.id = c.verified_by WHERE c.verified_by IS NOT NULL AND u.id IS NULL)
    + (SELECT count(*) FROM signups c LEFT JOIN users u ON u.id = c.assigned_user_id WHERE c.assigned_user_id IS NOT NULL AND u.id IS NULL)
    + (SELECT count(*) FROM signups c LEFT JOIN users u ON u.id = c.authorised_signatory_user_id WHERE c.authorised_signatory_user_id IS NOT NULL AND u.id IS NULL)
    + (SELECT count(*) FROM tickets c LEFT JOIN users u ON u.id = c.assignee_id WHERE c.assignee_id IS NOT NULL AND u.id IS NULL)
    + (SELECT count(*) FROM tickets c LEFT JOIN users u ON u.id = c.created_by WHERE c.created_by IS NOT NULL AND u.id IS NULL)
    + (SELECT count(*) FROM vc_deals c LEFT JOIN users u ON u.id = c.updated_by WHERE c.updated_by IS NOT NULL AND u.id IS NULL)
       ) = 0
            THEN 'ok' ELSE 'FAIL 0087: orphaned child rows reference a user that no longer exists' END
ON CONFLICT (id) DO UPDATE SET verdict = excluded.verdict, at = datetime('now');
