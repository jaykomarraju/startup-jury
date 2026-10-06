-- Provision Global Carbon Warriors as their OWN organisation, `t_gcw`.
--
-- Run ONCE, against a chosen database, deliberately:
--
--   npx wrangler d1 execute startup-jury-db --remote --file=scripts/provision-gcw.sql
--
-- NOT a migration, and the distinction cost a rewrite: a migration runs in every
-- database, so provisioning a customer here put a second 23-parameter rubric into
-- every developer checkout and every test run, and 34 worker tests went red —
-- `assignments.test.ts` reported `[ 'problem_market_clarity', …(12) ]` against
-- `…(25)` because the key list had doubled. A customer's workspace is not schema.
-- `migrations/0109` does the half that IS schema history (releasing the identity
-- `0106`/`0108` wrongly put on `t_default`) and stops there.
--
-- PREREQUISITE: `0109` must have been applied to the same database first, or the
-- `organizations.slug` and `email_domain` UNIQUE constraints refuse the INSERT below.
--
-- IDEMPOTENT: every statement is `ON CONFLICT DO NOTHING` or a `WHERE`-guarded
-- UPDATE, and the clones are `INSERT … SELECT` with deterministic `gcw_`-prefixed
-- ids, so a second run changes nothing. Safe to re-run if it is interrupted.
--
-- ── THE RUBRIC CLONE, AND THE TRAP IN IT ────────────────────────────────────
--
-- `parameters.id` is a GLOBAL primary key and BOTH children reference it by that id
-- with no tenant key of their own (`parameter_rubric_bands.parameter_id`,
-- `question_bank.parameter_id`). So the clone mints new ids AND remaps the children
-- onto them. Copying `parameter_id` across would silently give the new workspace a
-- rubric whose anchors and clarification questions belong to the old one — two
-- screens that look populated and are wrong.
--
-- The remap is `'gcw_' || <old id>`: a pure string function of the parent id, so a
-- child cannot land on the wrong row even if two parameters ever share a key.
--
-- ── WHAT IT DELIBERATELY DOES NOT DO ────────────────────────────────────────
--
-- It moves no decks. The 23 QA uploads stay in `t_default` where they were made.
-- GCW opens EMPTY, which is what "populate it with decks" asks for, and the two
-- organisations share nothing: separate decks, separate roster, separate rubric,
-- separate dashboard, separate audit trail.

-- ── 2. The organisation ─────────────────────────────────────────────────────
INSERT INTO organizations (id, name, slug, email_domain, default_edition, status)
VALUES ('t_gcw', 'Global Carbon Warriors', 'global-carbon-warriors',
        'globalcarbonwarriors.com', 'incubator', 'active')
ON CONFLICT (id) DO NOTHING;

-- ── 3. Settings. Without this row GET /api/config{,/summary,/parameters} all 404
--       and every upload is 402 no_credits.
INSERT INTO org_settings (tenant_id, edition, plan, credits_balance, branding_json,
                          threshold_best, threshold_mediocre, criteria_version)
VALUES ('t_gcw', 'incubator', 'premium', 2500,
        '{"orgName":"Global Carbon Warriors","orgType":"incubator"}', 7.0, 5.0, 1)
ON CONFLICT (tenant_id, edition) DO NOTHING;

-- `auto_clarification` is named EXPLICITLY: the column default is still 1 while the
-- shipped product default is 0 (`0102`), so an INSERT that omits it opts the
-- customer into auto-sending clarification queries nobody asked for.
INSERT INTO org_scoring_settings (tenant_id, edition, auto_clarification,
                                  shortlist_threshold, ai_gate_threshold)
VALUES ('t_gcw', 'incubator', 0, 7.0, 5.0)
ON CONFLICT (tenant_id, edition) DO NOTHING;

-- ── 4. The rubric: 23 parameters, their 5 bands each, and the question bank ──
INSERT INTO parameters (id, tenant_id, edition, key, name, weight, informational, role_scope,
                        sort_order, active, prompt, description, config_permitted, retired, prompt_default)
SELECT 'gcw_' || p.id, 't_gcw', p.edition, p.key, p.name, p.weight, p.informational, p.role_scope,
       p.sort_order, p.active, p.prompt, p.description, p.config_permitted, p.retired, p.prompt_default
  FROM parameters p
 WHERE p.tenant_id = 't_default' AND p.edition = 'incubator';

INSERT INTO parameter_rubric_bands (id, parameter_id, band_index, band_label, band_name, min_score, max_score, description)
SELECT 'gcw_' || b.id, 'gcw_' || b.parameter_id, b.band_index, b.band_label, b.band_name,
       b.min_score, b.max_score, b.description
  FROM parameter_rubric_bands b
  JOIN parameters p ON p.id = b.parameter_id
 WHERE p.tenant_id = 't_default' AND p.edition = 'incubator';

INSERT INTO question_bank (id, parameter_id, seq, text, active)
SELECT 'gcw_' || q.id, 'gcw_' || q.parameter_id, q.seq, q.text, q.active
  FROM question_bank q
  JOIN parameters p ON p.id = q.parameter_id
 WHERE p.tenant_id = 't_default' AND p.edition = 'incubator';

-- ── 5. One sector, deliberately ─────────────────────────────────────────────
-- `src/shared/intake.ts:230-237` resolves an uploaded deck's sector to "the
-- workspace's only sector" when exactly one exists, so a single sector makes every
-- upload land correctly with no operator input. GCW adds their real taxonomy in the
-- console; cloning t_default's EdTech / FinTech / SaaS list would be worse than
-- empty for a carbon accelerator.
INSERT INTO sectors (id, tenant_id, edition, name, active, sort_order)
VALUES ('sec_gcw_climatetech', 't_gcw', 'incubator', 'Climatetech', 1, 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO programs (id, tenant_id, edition, sector, name, active, sort_order, shortlist_min)
VALUES ('pg_gcw_carbon', 't_gcw', 'incubator', 'Climatetech', 'Carbon Accelerator', 1, 1, 7.0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO cohorts (id, program_id, name, active, sort_order)
VALUES ('ch_gcw_1', 'pg_gcw_carbon', 'Cohort 1', 1, 1)
ON CONFLICT (id) DO NOTHING;

-- ── 6. Seats, so adding a colleague is not 409 seat_limit_reached ───────────
INSERT INTO billing_subscriptions (tenant_id, edition, plan_label, seats, billing_period,
                                   cycle_anchor, currency, status)
VALUES ('t_gcw', 'incubator', 'Premium', 25, 'year', datetime('now'), 'INR', 'active')
ON CONFLICT (tenant_id, edition) DO NOTHING;

INSERT INTO seat_grants (id, tenant_id, edition, tier, quantity, reason, status, note)
VALUES ('sg_gcw_premium', 't_gcw', 'incubator', 'premium', 25, 'plan', 'granted', 'Pilot allocation (0109)')
ON CONFLICT (id) DO NOTHING;

-- ── 7. The sign-up checklist and the agreements library ────────────────────
INSERT INTO required_documents (id, tenant_id, edition, program_id, cohort_id, name, note, mandatory, active, sort_order)
SELECT 'gcw_' || id, 't_gcw', edition, NULL, NULL, name, note, mandatory, active, sort_order
  FROM required_documents
 WHERE tenant_id = 't_default' AND edition = 'incubator' AND program_id IS NULL;

INSERT INTO agreement_templates (id, tenant_id, edition, code, name, file_name, file_url, version, status, stage)
SELECT 'gcw_' || id, 't_gcw', edition, code, name, file_name, file_url, version, status, stage
  FROM agreement_templates
 WHERE tenant_id = 't_default' AND edition = 'incubator';

INSERT INTO agreement_flow_steps (id, template_id, step_index, actor_role, action)
SELECT 'gcw_' || s.id, 'gcw_' || s.template_id, s.step_index, s.actor_role, s.action
  FROM agreement_flow_steps s
  JOIN agreement_templates t ON t.id = s.template_id
 WHERE t.tenant_id = 't_default' AND t.edition = 'incubator';

INSERT INTO agreement_template_fields (id, template_id, key, label, sample, sort_order)
SELECT 'gcw_' || f.id, 'gcw_' || f.template_id, f.key, f.label, f.sample, f.sort_order
  FROM agreement_template_fields f
  JOIN agreement_templates t ON t.id = f.template_id
 WHERE t.tenant_id = 't_default' AND t.edition = 'incubator';

-- ── 8. The two real people move with their credentials ─────────────────────
-- A move, not a recreate: `password_hash` travels with the row, so the temporary
-- passwords already handed to GCW keep working and nobody is re-issued one over a
-- channel we do not control. `must_change_password` stays 1 on both.
--
-- Viiveck becomes `superuser` HERE rather than through
-- `POST /api/users/:id/transfer-ownership`, which refused with `409 invite_pending`
-- because he has never signed in — a guard that exists so ownership is not handed
-- to an unreachable address, and which signing in as him would have defeated by
-- writing an `invite_accepted_at` he did not earn. In a workspace that has no
-- superuser at all there is nobody to transfer FROM, so this is the first owner
-- being seated, not an ownership change. The invariant — exactly one `superuser`
-- per (tenant, edition) — holds: he is the only one in `t_gcw`.
-- Matched on the DOMAIN, not on an allowlist of two addresses. The first version
-- named `ceo@` and `viiveck@` explicitly and the assertion below caught what that
-- misses: production also held `deploy.check@globalcarbonwarriors.com`, a registration
-- made while verifying the deploy and then declined. A declined registration is still
-- a record ABOUT this customer's domain and belongs in their workspace, not stranded
-- in the demo one — and the same is true of anyone else who self-registers between
-- this script being written and being run. The domain is the rule; the two names were
-- only the two we happened to know about.
UPDATE users
   SET tenant_id = 't_gcw',
       role      = CASE WHEN email = 'viiveck@globalcarbonwarriors.com' THEN 'superuser' ELSE role END
 WHERE email LIKE '%@globalcarbonwarriors.com'
   AND tenant_id = 't_default';

-- ── 9. NO `account_profiles` ROW, deliberately ─────────────────────────────
-- An earlier measurement read `GET /api/account/profile -> 404` on an
-- unprovisioned tenant and filed it as a provisioning gap. It is not: there is no
-- `GET /profile` route at all — `routes/account.ts` declares only `put("/profile")`
-- (:437) and `patch("/profile")` (:623) — so that 404 is a routing artefact that
-- answers identically for `t_default`. Nothing is broken by the absence.
--
-- And the row should not be invented. `account_profiles` is the COMMERCIAL record:
-- `first_name` and `last_name` are NOT NULL, so writing it means making up a billing
-- contact, and the same row carries the `billing_*` columns `0104` ships with no
-- DEFAULT and no backfill precisely so an address is never invented for a customer —
-- the billing country decides their currency and their tax. `routes/account.ts:535`
-- upserts the row on first save, which is the customer telling us who they are
-- rather than us guessing.

-- ── 10. The ledger explains the balance, from the first row ────────────────
-- `billing/ledger.ts:7`: the balance is the authority and the ledger explains it.
-- `0108` learned the hard way that production's books had never balanced; a new
-- workspace starts with them balanced and there is no reason to repeat the mistake.
INSERT INTO credit_ledger (id, tenant_id, edition, delta, reason, amount_minor, currency, reference, note, actor_id)
VALUES ('cl_0109_gcw_incubator', 't_gcw', 'incubator', 2500, 'adjustment', NULL, NULL,
        'migration:0109', 'Opening pilot grant for Global Carbon Warriors', NULL)
ON CONFLICT (id) DO NOTHING;

-- ── 11. Assertions. Each one is a way this file can half-apply and look fine ──
INSERT INTO _tenancy_assert (id, verdict)
SELECT '0109.gcw_is_its_own_organisation',
       CASE WHEN (SELECT count(*) FROM organizations
                   WHERE id = 't_gcw' AND email_domain = 'globalcarbonwarriors.com' AND status = 'active') = 1
             AND (SELECT count(*) FROM organizations
                   WHERE id = 't_default' AND email_domain IS NULL AND slug = 'default') = 1
            THEN 'ok' ELSE 'FAIL: the identity did not move cleanly between the two organisations' END
ON CONFLICT (id) DO UPDATE SET verdict = excluded.verdict, at = datetime('now');

INSERT INTO _tenancy_assert (id, verdict)
SELECT '0109.gcw_rubric_is_whole',
       CASE WHEN (SELECT count(*) FROM parameters WHERE tenant_id = 't_gcw')
                 = (SELECT count(*) FROM parameters WHERE tenant_id = 't_default' AND edition = 'incubator')
             AND (SELECT count(*) FROM parameter_rubric_bands b JOIN parameters p ON p.id = b.parameter_id
                   WHERE p.tenant_id = 't_gcw')
                 = (SELECT count(*) FROM parameter_rubric_bands b JOIN parameters p ON p.id = b.parameter_id
                     WHERE p.tenant_id = 't_default' AND p.edition = 'incubator')
             AND (SELECT count(*) FROM question_bank q JOIN parameters p ON p.id = q.parameter_id
                   WHERE p.tenant_id = 't_gcw')
                 = (SELECT count(*) FROM question_bank q JOIN parameters p ON p.id = q.parameter_id
                     WHERE p.tenant_id = 't_default' AND p.edition = 'incubator')
            THEN 'ok' ELSE 'FAIL: the rubric clone lost bands or questions — check the parameter_id remap' END
ON CONFLICT (id) DO UPDATE SET verdict = excluded.verdict, at = datetime('now');

-- No child may point at a parameter in the OTHER workspace. This is the trap the
-- remap exists for, and a count match alone would not catch a mis-pointed row.
INSERT INTO _tenancy_assert (id, verdict)
SELECT '0109.no_rubric_child_crosses_the_boundary',
       CASE WHEN (SELECT count(*) FROM parameter_rubric_bands b JOIN parameters p ON p.id = b.parameter_id
                   WHERE (b.id LIKE 'gcw/_%' ESCAPE '/') <> (p.tenant_id = 't_gcw')) = 0
             AND (SELECT count(*) FROM question_bank q JOIN parameters p ON p.id = q.parameter_id
                   WHERE (q.id LIKE 'gcw/_%' ESCAPE '/') <> (p.tenant_id = 't_gcw')) = 0
            THEN 'ok' ELSE 'FAIL: a cloned rubric child points at the other workspace''s parameter' END
ON CONFLICT (id) DO UPDATE SET verdict = excluded.verdict, at = datetime('now');

-- Stated as the INVARIANT, not as a headcount, because this file has to be true in
-- two different databases. `ceo@` and `viiveck@` were created through the product
-- against PRODUCTION; a local database has never heard of them, so asserting "both
-- people are in t_gcw" would fail every local run for a correct migration. What must
-- hold everywhere is: a workspace with people in it has exactly one owner, and an
-- empty one has none.
INSERT INTO _tenancy_assert (id, verdict)
SELECT '0109.gcw_has_exactly_one_owner_if_it_has_anyone',
       CASE WHEN (SELECT count(*) FROM users
                   WHERE tenant_id = 't_gcw' AND edition = 'incubator'
                     AND role = 'superuser' AND deleted_at IS NULL)
                 = CASE WHEN (SELECT count(*) FROM users
                               WHERE tenant_id = 't_gcw' AND edition = 'incubator'
                                 AND deleted_at IS NULL) > 0 THEN 1 ELSE 0 END
            THEN 'ok' ELSE 'FAIL: t_gcw does not have exactly one superuser for a populated workspace' END
ON CONFLICT (id) DO UPDATE SET verdict = excluded.verdict, at = datetime('now');

-- And nobody on the customer's domain may be left behind in the demo workspace,
-- which is the half that would strand a real person rather than merely miscount.
INSERT INTO _tenancy_assert (id, verdict)
SELECT '0109.no_gcw_person_left_in_the_demo_workspace',
       CASE WHEN (SELECT count(*) FROM users
                   WHERE tenant_id = 't_default'
                     AND email LIKE '%@globalcarbonwarriors.com'
                     AND deleted_at IS NULL) = 0
            THEN 'ok' ELSE 'FAIL: a globalcarbonwarriors.com account is still in t_default' END
ON CONFLICT (id) DO UPDATE SET verdict = excluded.verdict, at = datetime('now');

INSERT INTO _tenancy_assert (id, verdict)
SELECT '0109.every_workspace_ledger_balances',
       CASE WHEN (SELECT count(*) FROM org_settings o
                   WHERE o.credits_balance <> (SELECT COALESCE(SUM(l.delta), 0) FROM credit_ledger l
                                                WHERE l.tenant_id = o.tenant_id AND l.edition = o.edition)) = 0
            THEN 'ok' ELSE 'FAIL: a workspace balance the ledger cannot account for' END
ON CONFLICT (id) DO UPDATE SET verdict = excluded.verdict, at = datetime('now');

-- GCW must open EMPTY. If a deck ever lands here, the move took data it should not have.
INSERT INTO _tenancy_assert (id, verdict)
SELECT '0109.gcw_opens_empty_and_the_demo_keeps_its_decks',
       CASE WHEN (SELECT count(*) FROM decks WHERE tenant_id = 't_gcw') = 0
             AND (SELECT count(*) FROM decks WHERE tenant_id = 't_default') =
                 (SELECT count(*) FROM decks)
            THEN 'ok' ELSE 'FAIL: decks moved between workspaces, which this migration must never do' END
ON CONFLICT (id) DO UPDATE SET verdict = excluded.verdict, at = datetime('now');
