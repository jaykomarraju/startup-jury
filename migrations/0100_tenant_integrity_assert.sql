-- 0100 — T0-SCHEMA · the standing integrity assertion, and the last statement of
--        the T0 block. It stands in for 28 foreign keys the schema is not allowed
--        to declare.
--
-- ── WHY THERE IS NO `REFERENCES organizations(id)` TO RELY ON ────────────────
-- Measured in §5d and re-measured inside D1 against the current schema:
--
--   ALTER TABLE decks ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 't_default'
--     REFERENCES organizations(id)
--   → Error: Cannot add a REFERENCES column with non-NULL default value
--
-- and the same statement without `REFERENCES` succeeds. You get a backfilled NOT
-- NULL tenant key or a declared foreign key, not both. The alternative —
-- nullable, backfill, then rebuild for NOT NULL — turns 11 rebuilds into 28, so
-- §5d's recommendation is "no declared FK on the added columns, with the
-- integrity assertion of §5f standing in for it." This is that assertion.
--
-- It is not a weaker check than a foreign key; it is a check that runs at a
-- different time. An FK refuses the bad write; this refuses the bad DATABASE, on
-- every apply of the chain, which is when a drifted or hand-edited instance gets
-- caught. What it cannot do is stop a bad write between applies — that is what
-- `test/worker/tenant-scope.test.ts` is for, and why its write-side arm exists.
--
-- ── THE MECHANISM ───────────────────────────────────────────────────────────
-- `_tenancy_assert` and its one-value CHECK, created by 0088. A failing assertion
-- writes its own message into a column that admits only 'ok', the CHECK refuses
-- it, the statement errors, the transaction rolls back and the chain stops with
-- the reason in the error text. `RAISE(ABORT, …)` would be the natural way to say
-- this and it only exists inside a trigger.
--
-- ── WHAT ELSE GUARDS THIS BLOCK, SO THE SET IS KNOWN ────────────────────────
-- Four things now assert tenancy, deliberately at four different levels:
--
--   1. 0088 — did the `users` rebuild apply whole? Six assertions including the
--      rename trap and all 41 inbound edges, on the one table where a half-apply
--      is silent.
--   2. 0100 (here) — does every row in all 28 tenant-owned tables carry a tenant
--      that exists? The FK stand-in.
--   3. `test/worker/migrations-w1b.test.ts` — `PRAGMA foreign_key_check` over the
--      whole database after the chain applies, which no SQL statement can express
--      because D1 refuses the pragma's table-valued form with SQLITE_AUTH; plus
--      the 28-table column census, so a table that silently misses its column
--      fails at `npm test` rather than at the first cross-tenant read.
--   4. `test/worker/tenant-scope.test.ts` — the read AND write isolation
--      invariant, per table, which is the only one of the four that can see a
--      missing predicate in a route.
--
-- Before this block, `grep -rn "foreign_key_check\|integrity_check" src test e2e
-- scripts package.json` returned zero.

-- Created by 0088; repeated here with IF NOT EXISTS so this file does not depend
-- on the order in which a partial restore replayed the block.
CREATE TABLE IF NOT EXISTS _tenancy_assert (
  id      TEXT PRIMARY KEY,
  verdict TEXT NOT NULL CHECK (verdict = 'ok'),
  at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 1. `t_default` exists and is the organisation every backfill named. If this
--    fails, 0083 did not apply and the 27 assertions below would all be vacuous.
INSERT INTO _tenancy_assert (id, verdict)
SELECT '0100.default_tenant_exists',
       CASE WHEN (SELECT count(*) FROM organizations WHERE id = 't_default') = 1
            THEN 'ok' ELSE 'FAIL: organizations has no t_default row' END
ON CONFLICT (id) DO UPDATE SET verdict = excluded.verdict, at = datetime('now');

-- 2. EVERY ROW IN ALL 30 KEY-CARRYING TABLES RESOLVES TO A REAL ORGANISATION.
--    One LEFT JOIN per table, summed, asserted as zero. The list is §5b's 28
--    tenant-owned tables — verified by parsing every `CREATE TABLE` body for an
--    `edition` column on the materialised schema; the buckets sum to 69 live
--    tables with no remainder, and there is no table in this schema that is
--    indifferent to tenancy — PLUS `email_outbox` and `esign_outbox`, which §5b
--    counts as scoped-by-proxy and which hold only NULLABLE foreign keys, so no
--    join can scope them. 0086's second half has that measurement.
INSERT INTO _tenancy_assert (id, verdict)
SELECT '0100.all_30_tables_resolve_their_tenant',
       CASE WHEN (
      (SELECT count(*) FROM account_orders x LEFT JOIN organizations o ON o.id = x.tenant_id WHERE o.id IS NULL)
    + (SELECT count(*) FROM account_profiles x LEFT JOIN organizations o ON o.id = x.tenant_id WHERE o.id IS NULL)
    + (SELECT count(*) FROM agreement_templates x LEFT JOIN organizations o ON o.id = x.tenant_id WHERE o.id IS NULL)
    + (SELECT count(*) FROM audit_log x LEFT JOIN organizations o ON o.id = x.tenant_id WHERE o.id IS NULL)
    + (SELECT count(*) FROM authorised_signatories x LEFT JOIN organizations o ON o.id = x.tenant_id WHERE o.id IS NULL)
    + (SELECT count(*) FROM billing_invoices x LEFT JOIN organizations o ON o.id = x.tenant_id WHERE o.id IS NULL)
    + (SELECT count(*) FROM billing_payment_intents x LEFT JOIN organizations o ON o.id = x.tenant_id WHERE o.id IS NULL)
    + (SELECT count(*) FROM billing_subscriptions x LEFT JOIN organizations o ON o.id = x.tenant_id WHERE o.id IS NULL)
    + (SELECT count(*) FROM credit_ledger x LEFT JOIN organizations o ON o.id = x.tenant_id WHERE o.id IS NULL)
    + (SELECT count(*) FROM crm_connections x LEFT JOIN organizations o ON o.id = x.tenant_id WHERE o.id IS NULL)
    + (SELECT count(*) FROM crm_sync_log x LEFT JOIN organizations o ON o.id = x.tenant_id WHERE o.id IS NULL)
    + (SELECT count(*) FROM decks x LEFT JOIN organizations o ON o.id = x.tenant_id WHERE o.id IS NULL)
    + (SELECT count(*) FROM messages x LEFT JOIN organizations o ON o.id = x.tenant_id WHERE o.id IS NULL)
    + (SELECT count(*) FROM notification_preferences x LEFT JOIN organizations o ON o.id = x.tenant_id WHERE o.id IS NULL)
    + (SELECT count(*) FROM notifications x LEFT JOIN organizations o ON o.id = x.tenant_id WHERE o.id IS NULL)
    + (SELECT count(*) FROM org_scoring_settings x LEFT JOIN organizations o ON o.id = x.tenant_id WHERE o.id IS NULL)
    + (SELECT count(*) FROM org_settings x LEFT JOIN organizations o ON o.id = x.tenant_id WHERE o.id IS NULL)
    + (SELECT count(*) FROM parameters x LEFT JOIN organizations o ON o.id = x.tenant_id WHERE o.id IS NULL)
    + (SELECT count(*) FROM programs x LEFT JOIN organizations o ON o.id = x.tenant_id WHERE o.id IS NULL)
    + (SELECT count(*) FROM required_documents x LEFT JOIN organizations o ON o.id = x.tenant_id WHERE o.id IS NULL)
    + (SELECT count(*) FROM resubmit_tokens x LEFT JOIN organizations o ON o.id = x.tenant_id WHERE o.id IS NULL)
    + (SELECT count(*) FROM role_permissions x LEFT JOIN organizations o ON o.id = x.tenant_id WHERE o.id IS NULL)
    + (SELECT count(*) FROM score_visibility x LEFT JOIN organizations o ON o.id = x.tenant_id WHERE o.id IS NULL)
    + (SELECT count(*) FROM seat_capabilities x LEFT JOIN organizations o ON o.id = x.tenant_id WHERE o.id IS NULL)
    + (SELECT count(*) FROM seat_grants x LEFT JOIN organizations o ON o.id = x.tenant_id WHERE o.id IS NULL)
    + (SELECT count(*) FROM sectors x LEFT JOIN organizations o ON o.id = x.tenant_id WHERE o.id IS NULL)
    + (SELECT count(*) FROM tickets x LEFT JOIN organizations o ON o.id = x.tenant_id WHERE o.id IS NULL)
    + (SELECT count(*) FROM users x LEFT JOIN organizations o ON o.id = x.tenant_id WHERE o.id IS NULL)
  + (SELECT count(*) FROM email_outbox x LEFT JOIN organizations o ON o.id = x.tenant_id WHERE o.id IS NULL)
  + (SELECT count(*) FROM esign_outbox x LEFT JOIN organizations o ON o.id = x.tenant_id WHERE o.id IS NULL)
       ) = 0
            THEN 'ok'
            ELSE 'FAIL: a tenant-owned table holds a row whose tenant_id has no organizations row' END
ON CONFLICT (id) DO UPDATE SET verdict = excluded.verdict, at = datetime('now');

-- 3. The eight PLATFORM-GLOBAL tables must NOT have acquired a tenant key. §3
--    measured five independent reasons the price catalogue is one book for the
--    whole product — `routes/pricing.ts` contains the string `edition` zero
--    times, none of the eight tables carries an `edition` column, and
--    `CREATE UNIQUE INDEX pricing_versions_one_published ON pricing_versions
--    (status) WHERE status = 'published'` enforces one live catalogue
--    product-wide. §7 Q2 asks the client to confirm it in writing, because
--    per-customer pricing afterwards is a migration and not a setting.
--
--    This assertion is the guard rail for the seven T1 sessions and for whoever
--    comes after them: a sweep that "finishes the job" by adding `tenant_id` to
--    the price book fails the migration chain here, with a message that says why.
INSERT INTO _tenancy_assert (id, verdict)
SELECT '0100.pricing_tables_stay_global',
       CASE WHEN (SELECT count(*) FROM pragma_table_info('price_plans') WHERE name = 'tenant_id')
               + (SELECT count(*) FROM pragma_table_info('price_amounts') WHERE name = 'tenant_id')
               + (SELECT count(*) FROM pragma_table_info('price_groups') WHERE name = 'tenant_id')
               + (SELECT count(*) FROM pragma_table_info('pricing_settings') WHERE name = 'tenant_id')
               + (SELECT count(*) FROM pragma_table_info('pricing_versions') WHERE name = 'tenant_id')
               + (SELECT count(*) FROM pragma_table_info('pricing_draft_meta') WHERE name = 'tenant_id')
               + (SELECT count(*) FROM pragma_table_info('currencies') WHERE name = 'tenant_id')
               + (SELECT count(*) FROM pragma_table_info('fx_rates') WHERE name = 'tenant_id') = 0
            THEN 'ok'
            ELSE 'FAIL: a platform-global pricing table gained a tenant_id — see plan_multitenancy.md 3' END
ON CONFLICT (id) DO UPDATE SET verdict = excluded.verdict, at = datetime('now');

-- 4. THE THREE REBUILDS THAT DETACHED CHILD ROWS PUT EVERY ONE OF THEM BACK,
--    RE-CHECKED AFTER THE TRANSACTIONS COMMITTED.
--
-- `users` (0087), `agreement_templates` (0096) and `crm_connections` (0098) are the
-- three of the eleven rebuilds that are PARENTS — 41 inbound foreign-key edges from
-- 34 tables, 5, and 2 respectively. Each of them had to detach every child row that
-- referenced it before dropping the table, because `PRAGMA defer_foreign_keys`
-- defers the CONSTRAINT and not the `ON DELETE` ACTION: the implicit delete inside
-- `DROP TABLE` would otherwise have emptied six tables by CASCADE, blanked 17
-- columns by SET NULL, and aborted outright on three child CHECKs that forbid the
-- NULL. 0087's header has the whole measurement.
--
-- Each of those migrations already proved its own restore INSIDE its transaction,
-- which is what makes a bad restore roll back rather than commit. This assertion is
-- the other half: the same comparison, now that all three have COMMITTED. It is the
-- one check an in-transaction assertion cannot make, and it is the reason the three
-- `_tenancy_census_*` tables are kept rather than dropped — one row each, and the
-- only record of what the database looked like before the rebuilds touched it.
INSERT INTO _tenancy_assert (id, verdict)
SELECT '0100.rebuild_detachments_still_restored',
       CASE WHEN (
              (SELECT count(*) FROM account_orders) <> (SELECT n_account_orders FROM _tenancy_census_users)
           OR (SELECT count(*) FROM account_profiles) <> (SELECT n_account_profiles FROM _tenancy_census_users)
           OR (SELECT count(*) FROM agreements) <> (SELECT n_agreements FROM _tenancy_census_users)
           OR (SELECT count(*) FROM audit_log) <> (SELECT n_audit_log FROM _tenancy_census_users)
           OR (SELECT count(*) FROM authorised_signatories) <> (SELECT n_authorised_signatories FROM _tenancy_census_users)
           OR (SELECT count(*) FROM billing_payment_intents) <> (SELECT n_billing_payment_intents FROM _tenancy_census_users)
           OR (SELECT count(*) FROM call_outcomes) <> (SELECT n_call_outcomes FROM _tenancy_census_users)
           OR (SELECT count(*) FROM call_schedulers) <> (SELECT n_call_schedulers FROM _tenancy_census_users)
           OR (SELECT count(*) FROM credit_ledger) <> (SELECT n_credit_ledger FROM _tenancy_census_users)
           OR (SELECT count(*) FROM dd_items) <> (SELECT n_dd_items FROM _tenancy_census_users)
           OR (SELECT count(*) FROM deck_assignments) <> (SELECT n_deck_assignments FROM _tenancy_census_users)
           OR (SELECT count(*) FROM evaluation_recommendations) <> (SELECT n_evaluation_recommendations FROM _tenancy_census_users)
           OR (SELECT count(*) FROM notification_preferences) <> (SELECT n_notification_preferences FROM _tenancy_census_users)
           OR (SELECT count(*) FROM notifications) <> (SELECT n_notifications FROM _tenancy_census_users)
           OR (SELECT count(*) FROM score_visibility) <> (SELECT n_score_visibility FROM _tenancy_census_users)
           OR (SELECT count(*) FROM seat_grants) <> (SELECT n_seat_grants FROM _tenancy_census_users)
           OR (SELECT count(*) FROM signatures) <> (SELECT n_signatures FROM _tenancy_census_users)
           OR (SELECT count(*) FROM signup_documents) <> (SELECT n_signup_documents FROM _tenancy_census_users)
           OR (SELECT count(*) FROM signups) <> (SELECT n_signups FROM _tenancy_census_users)
           OR (SELECT count(*) FROM vc_deals) <> (SELECT n_vc_deals FROM _tenancy_census_users)
           OR (SELECT count(*) FROM account_orders WHERE created_by IS NOT NULL) <> (SELECT nn_account_orders__created_by FROM _tenancy_census_users)
           OR (SELECT count(*) FROM account_profiles WHERE updated_by IS NOT NULL) <> (SELECT nn_account_profiles__updated_by FROM _tenancy_census_users)
           OR (SELECT count(*) FROM agreements WHERE countersigned_by IS NOT NULL) <> (SELECT nn_agreements__countersigned_by FROM _tenancy_census_users)
           OR (SELECT count(*) FROM audit_log WHERE actor_id IS NOT NULL) <> (SELECT nn_audit_log__actor_id FROM _tenancy_census_users)
           OR (SELECT count(*) FROM authorised_signatories WHERE user_id IS NOT NULL) <> (SELECT nn_authorised_signatories__user_id FROM _tenancy_census_users)
           OR (SELECT count(*) FROM billing_payment_intents WHERE actor_id IS NOT NULL) <> (SELECT nn_billing_payment_intents__actor_id FROM _tenancy_census_users)
           OR (SELECT count(*) FROM call_outcomes WHERE set_by IS NOT NULL) <> (SELECT nn_call_outcomes__set_by FROM _tenancy_census_users)
           OR (SELECT count(*) FROM call_schedulers WHERE assigned_by IS NOT NULL) <> (SELECT nn_call_schedulers__assigned_by FROM _tenancy_census_users)
           OR (SELECT count(*) FROM call_schedulers WHERE user_id IS NOT NULL) <> (SELECT nn_call_schedulers__user_id FROM _tenancy_census_users)
           OR (SELECT count(*) FROM credit_ledger WHERE actor_id IS NOT NULL) <> (SELECT nn_credit_ledger__actor_id FROM _tenancy_census_users)
           OR (SELECT count(*) FROM dd_items WHERE updated_by IS NOT NULL) <> (SELECT nn_dd_items__updated_by FROM _tenancy_census_users)
           OR (SELECT count(*) FROM deck_assignments WHERE assigned_by IS NOT NULL) <> (SELECT nn_deck_assignments__assigned_by FROM _tenancy_census_users)
           OR (SELECT count(*) FROM deck_assignments WHERE evaluator_id IS NOT NULL) <> (SELECT nn_deck_assignments__evaluator_id FROM _tenancy_census_users)
           OR (SELECT count(*) FROM evaluation_recommendations WHERE user_id IS NOT NULL) <> (SELECT nn_evaluation_recommendations__user_id FROM _tenancy_census_users)
           OR (SELECT count(*) FROM notification_preferences WHERE user_id IS NOT NULL) <> (SELECT nn_notification_preferences__user_id FROM _tenancy_census_users)
           OR (SELECT count(*) FROM notifications WHERE user_id IS NOT NULL) <> (SELECT nn_notifications__user_id FROM _tenancy_census_users)
           OR (SELECT count(*) FROM score_visibility WHERE updated_by IS NOT NULL) <> (SELECT nn_score_visibility__updated_by FROM _tenancy_census_users)
           OR (SELECT count(*) FROM seat_grants WHERE actor_id IS NOT NULL) <> (SELECT nn_seat_grants__actor_id FROM _tenancy_census_users)
           OR (SELECT count(*) FROM signatures WHERE signer_user_id IS NOT NULL) <> (SELECT nn_signatures__signer_user_id FROM _tenancy_census_users)
           OR (SELECT count(*) FROM signup_documents WHERE verified_by IS NOT NULL) <> (SELECT nn_signup_documents__verified_by FROM _tenancy_census_users)
           OR (SELECT count(*) FROM signups WHERE assigned_user_id IS NOT NULL) <> (SELECT nn_signups__assigned_user_id FROM _tenancy_census_users)
           OR (SELECT count(*) FROM signups WHERE authorised_signatory_user_id IS NOT NULL) <> (SELECT nn_signups__authorised_signatory_user_id FROM _tenancy_census_users)
           OR (SELECT count(*) FROM vc_deals WHERE updated_by IS NOT NULL) <> (SELECT nn_vc_deals__updated_by FROM _tenancy_census_users)
           OR (SELECT count(*) FROM agreements WHERE countersigned_at IS NOT NULL) <> (SELECT nn_agreements__countersigned_at FROM _tenancy_census_users)
           OR (SELECT count(*) FROM agreement_flow_steps) <> (SELECT n_agreement_flow_steps FROM _tenancy_census_agreement_templates)
           OR (SELECT count(*) FROM agreement_template_fields) <> (SELECT n_agreement_template_fields FROM _tenancy_census_agreement_templates)
           OR (SELECT count(*) FROM agreement_template_programs) <> (SELECT n_agreement_template_programs FROM _tenancy_census_agreement_templates)
           OR (SELECT count(*) FROM agreements) <> (SELECT n_agreements FROM _tenancy_census_agreement_templates)
           OR (SELECT count(*) FROM vc_deals) <> (SELECT n_vc_deals FROM _tenancy_census_agreement_templates)
           OR (SELECT count(*) FROM agreement_flow_steps WHERE template_id IS NOT NULL) <> (SELECT nn_agreement_flow_steps__template_id FROM _tenancy_census_agreement_templates)
           OR (SELECT count(*) FROM agreement_template_fields WHERE template_id IS NOT NULL) <> (SELECT nn_agreement_template_fields__template_id FROM _tenancy_census_agreement_templates)
           OR (SELECT count(*) FROM agreement_template_programs WHERE template_id IS NOT NULL) <> (SELECT nn_agreement_template_programs__template_id FROM _tenancy_census_agreement_templates)
           OR (SELECT count(*) FROM agreements WHERE template_id IS NOT NULL) <> (SELECT nn_agreements__template_id FROM _tenancy_census_agreement_templates)
           OR (SELECT count(*) FROM vc_deals WHERE term_sheet_template_id IS NOT NULL) <> (SELECT nn_vc_deals__term_sheet_template_id FROM _tenancy_census_agreement_templates)
           OR (SELECT count(*) FROM vc_deals WHERE term_sheet_file IS NOT NULL) <> (SELECT nn_vc_deals__term_sheet_file FROM _tenancy_census_agreement_templates)
           OR (SELECT count(*) FROM crm_field_mappings) <> (SELECT n_crm_field_mappings FROM _tenancy_census_crm_connections)
           OR (SELECT count(*) FROM crm_sync_log) <> (SELECT n_crm_sync_log FROM _tenancy_census_crm_connections)
           OR (SELECT count(*) FROM crm_field_mappings WHERE connection_id IS NOT NULL) <> (SELECT nn_crm_field_mappings__connection_id FROM _tenancy_census_crm_connections)
           OR (SELECT count(*) FROM crm_sync_log WHERE connection_id IS NOT NULL) <> (SELECT nn_crm_sync_log__connection_id FROM _tenancy_census_crm_connections)
           ) THEN 'FAIL: a rebuild detachment did not survive its commit — compare _tenancy_census_*'
            ELSE 'ok' END
ON CONFLICT (id) DO UPDATE SET verdict = excluded.verdict, at = datetime('now');
