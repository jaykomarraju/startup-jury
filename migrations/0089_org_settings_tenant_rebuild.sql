-- 0089 — T0-SCHEMA · rebuild 2 of 11. `org_settings` PK `edition` →
--        `(tenant_id, edition)`.
--
-- Read `0087_users_tenant_rebuild.sql`'s header first: it carries the measured
-- recipe (never rename the table; stash, drop, recreate under the same name,
-- restore, all in one transaction with `PRAGMA defer_foreign_keys = ON`) and the
-- four escape hatches that do not work in D1 — including that
-- `PRAGMA foreign_keys = OFF` is accepted and silently ignored. The same recipe
-- is used here and in 0090-0098 without restating it.
--
-- ── WHY THE KEY IS THE PAIR AND NOT `tenant_id` ALONE ───────────────────────
-- Because what this table configures is edition-shaped. `plan` and
-- `credits_balance` are a workspace's, `threshold_best` / `threshold_mediocre`
-- are the cohort rating bands a workspace reports against, and
-- `ai_system_prompt` is written for one product variant. §5c: these tables
-- "become `(tenant_id, edition)`-keyed".
--
-- It is also what the data requires. `SELECT edition, count(*) FROM org_settings
-- GROUP BY edition` returns one incubator row and one vc row — the single
-- existing customer runs both workspaces — so a `PRIMARY KEY (tenant_id)` and a
-- backfill to one `t_default` would have two rows competing for one key.
--
-- ── INBOUND EDGES: ZERO ─────────────────────────────────────────────────────
-- Measured on the materialised schema: nothing in the schema holds a foreign key
-- to `org_settings`, so §5f's 41-edge hazard does not apply here. Eight of the
-- eleven rebuilds are in that position; only `users` (41 edges / 34 tables),
-- `agreement_templates` (5) and `crm_connections` (2) are not. The deferral below
-- is kept anyway — it costs nothing, and a rebuild whose safety depends on a
-- hand-counted edge total being zero is a rebuild one future `REFERENCES` clause
-- away from being wrong.

-- ── THE `DEFAULT` ON `tenant_id`, UNIFORM ACROSS ALL THIRTY ──────────────────
-- The 19 `ALTER TABLE` columns carry `DEFAULT 't_default'` because SQLite offers
-- no way to add a NOT NULL column to a populated table without one. The eleven
-- rebuilt tables could have gone without, and `0087`'s header records why they do
-- not: the loud form reddened 109 tests in files owned by other T1 sessions, and a
-- foundation session that merges red is seven T1 branches cut from a red commit.
-- The write-side guard is `test/worker/tenant-scope.test.ts`, per table, extended
-- by whichever session owns each INSERT.
--
CREATE TABLE org_settings__pre_tenant AS SELECT * FROM org_settings;

PRAGMA defer_foreign_keys = ON;

DROP TABLE org_settings;

CREATE TABLE org_settings (
  tenant_id           TEXT NOT NULL DEFAULT 't_default',
  edition             TEXT NOT NULL CHECK (edition IN ('incubator', 'vc')),
  plan                TEXT NOT NULL DEFAULT 'standard' CHECK (plan IN ('standard', 'pro', 'premium')),
  credits_balance     INTEGER NOT NULL DEFAULT 0,
  branding_json       TEXT NOT NULL DEFAULT '{}',
  ai_system_prompt    TEXT,
  threshold_best      REAL NOT NULL DEFAULT 7.0,
  threshold_mediocre  REAL NOT NULL DEFAULT 5.0,
  criteria_version    INTEGER NOT NULL DEFAULT 1,
  audit_retention_days INTEGER,
  PRIMARY KEY (tenant_id, edition)
);

INSERT INTO org_settings (
  tenant_id, edition, plan, credits_balance, branding_json, ai_system_prompt,
  threshold_best, threshold_mediocre, criteria_version, audit_retention_days
)
SELECT
  't_default', edition, plan, credits_balance, branding_json, ai_system_prompt,
  threshold_best, threshold_mediocre, criteria_version, audit_retention_days
FROM org_settings__pre_tenant;

DROP TABLE org_settings__pre_tenant;
