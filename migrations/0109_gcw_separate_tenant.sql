-- 0109 — `t_default` goes back to being the demo workspace.
--
-- `0106` renamed `t_default` to Global Carbon Warriors and `0108` put their name and
-- their credits on it. Both were built on a measurement read correctly and
-- interpreted wrongly: production held 23 ClimateTech decks uploaded 1-3 Oct, and
-- that was taken as "GCW's workspace already exists, so rebrand it".
--
-- `SELECT count(*), uploaded_by FROM decks GROUP BY uploaded_by` settles it:
-- **11 by `priya.sharma@demo.startupjury.ai`, 12 by `sunita.rao@demo.startupjury.ai`.
-- Every one was uploaded through a demo login during QA.** The deck SUBJECTS are the
-- customer's real pipeline; the uploads are ours. The state agrees — 20 of the 23 are
-- `archived`, three score 0.00, and three startups appear more than once.
--
-- So `t_default` is the workspace QA runs in, and renaming it handed a customer our
-- test data, our demo roster and our audit trail. The customer gets their own
-- organisation instead, and the two share nothing.
--
-- ── WHY THE NEW ORGANISATION IS NOT IN THIS FILE ────────────────────────────
--
-- A migration runs in EVERY database — every developer checkout, every test run, CI.
-- The first draft of this file provisioned `t_gcw` here, including a clone of the
-- 23-parameter rubric, and that put a second rubric in every local database:
-- 34 worker tests went red, `assignments.test.ts` reporting
-- `[ 'problem_market_clarity', …(12) ]` against `…(25)` because the key list had
-- doubled. The tests were right. A specific customer's workspace is not schema and
-- does not belong in the schema's history — it is a deliberate, once, named operation
-- against one chosen database, which is what `scripts/` is for in this repo
-- (`clear-deck-data.sql`, `clear-auto-queries.sql`).
--
-- **GCW is provisioned by `scripts/provision-gcw.sql`.** This file only undoes what
-- `0106` and `0108` wrote, which genuinely IS in every database and genuinely is wrong
-- everywhere.
--
-- It does not touch a single deck. The 23 uploads stay in `t_default` with their
-- evaluations, scores and reports — QA's record and the demo corpus.

-- `organizations.slug` is UNIQUE and `email_domain` is UNIQUE WHERE NOT NULL, so this
-- reversion is also what RELEASES both for the provisioning script to claim.
UPDATE organizations
   SET name         = 'ai.STARTUPJURY Demo Workspace',
       slug         = 'default',
       email_domain = NULL,
       updated_at   = datetime('now')
 WHERE id = 't_default';

-- Not back to "Anthill Ventures Incubator" — a different real accelerator, which
-- `0020` should never have written. The demo workspace is named for what it is.
UPDATE org_settings
   SET branding_json = json_set(COALESCE(branding_json, '{}'), '$.orgName', 'ai.STARTUPJURY Demo Workspace')
 WHERE tenant_id = 't_default';

INSERT INTO _tenancy_assert (id, verdict)
SELECT '0109.demo_workspace_released_the_customer_identity',
       CASE WHEN (SELECT count(*) FROM organizations
                   WHERE id = 't_default' AND slug = 'default' AND email_domain IS NULL
                     AND name = 'ai.STARTUPJURY Demo Workspace') = 1
             AND (SELECT count(*) FROM org_settings
                   WHERE tenant_id = 't_default'
                     AND json_extract(branding_json, '$.orgName') <> 'ai.STARTUPJURY Demo Workspace') = 0
            THEN 'ok' ELSE 'FAIL: t_default still carries the customer identity' END
ON CONFLICT (id) DO UPDATE SET verdict = excluded.verdict, at = datetime('now');
