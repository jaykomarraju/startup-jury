-- 0098 — T0-SCHEMA · rebuild 11 of 11, the last. `crm_connections`
--        `UNIQUE (edition, provider)` → `UNIQUE (tenant_id, edition, provider)`.
--
-- Recipe: `0087_users_tenant_rebuild.sql`.
--
-- ── TWO INBOUND EDGES ───────────────────────────────────────────────────────
-- `crm_field_mappings` and `crm_sync_log` are children of this table, so the
-- deferral below is load-bearing as it is in 0096, and the rename recipe would
-- have rewritten both clauses. `crm_sync_log` took its own `tenant_id` in 0086
-- rather than waiting for the join — it is a log, read by `/api/crm/*` without
-- the parent in the statement (§5b counts `crm_sync_log` among the proxy tables),
-- so giving it a direct column removes a judgement from T1-ESIGN rather than
-- adding one.
--
-- ── `UNIQUE (edition, provider)` IS THE ONE-CONNECTION-PER-PROVIDER RULE ────
-- It is a correct rule inside a workspace: one HubSpot connection, not three. It
-- is the wrong rule across customers, and it is the cheapest possible
-- demonstration of why the whole block exists — with two customers on one
-- edition, the second one to connect HubSpot gets a UNIQUE violation and
-- `routes/crm.ts` reports it as "already connected", pointing at a connection
-- belonging to someone else.
--
-- ── WHAT IS IN THIS TABLE, WHICH IS WHY §2 B19 IS ON THE LEAK LIST ──────────
-- `base_url`, `webhook_path`, `credential_ref` and `credential_hint`. No secret
-- is stored here by design, but a credential HINT plus a base URL plus a webhook
-- path is a map of another customer's integration. The six `/api/crm/*` routes
-- are scoped by `crm/store.ts:72` on `edition` alone today.

CREATE TABLE _tenancy_census_crm_connections AS SELECT
  (SELECT count(*) FROM crm_field_mappings) AS n_crm_field_mappings,
  (SELECT count(*) FROM crm_sync_log) AS n_crm_sync_log,
  (SELECT count(*) FROM crm_field_mappings WHERE connection_id IS NOT NULL) AS nn_crm_field_mappings__connection_id,
  (SELECT count(*) FROM crm_sync_log WHERE connection_id IS NOT NULL) AS nn_crm_sync_log__connection_id;

-- stash the 2 tables whose rows have to go: the ON DELETE CASCADE
-- children, plus any SET NULL child whose own CHECK forbids the NULL (see header).
-- Every one has ZERO inbound edges (measured), so deleting them cascades nowhere.
CREATE TABLE crm_field_mappings__fk_stash AS SELECT * FROM crm_field_mappings;
CREATE TABLE crm_sync_log__fk_stash AS SELECT * FROM crm_sync_log;

-- stash the 0 columns that will be blanked, with the companion column
-- a CHECK ties them to where there is one.

-- DETACH. After this nothing in the database references a row of crm_connections,
-- so the DROP's implicit DELETE fires no action at all and no child CHECK
-- can be violated by one.
DELETE FROM crm_field_mappings;
DELETE FROM crm_sync_log;

-- ── THE `DEFAULT` ON `tenant_id`, UNIFORM ACROSS ALL THIRTY ──────────────────
-- The 19 `ALTER TABLE` columns carry `DEFAULT 't_default'` because SQLite offers
-- no way to add a NOT NULL column to a populated table without one. The eleven
-- rebuilt tables could have gone without, and `0087`'s header records why they do
-- not: the loud form reddened 109 tests in files owned by other T1 sessions, and a
-- foundation session that merges red is seven T1 branches cut from a red commit.
-- The write-side guard is `test/worker/tenant-scope.test.ts`, per table, extended
-- by whichever session owns each INSERT.
--
CREATE TABLE crm_connections__pre_tenant AS SELECT * FROM crm_connections;

PRAGMA defer_foreign_keys = ON;

DROP TABLE crm_connections;

CREATE TABLE crm_connections (
  id                      TEXT PRIMARY KEY,
  tenant_id               TEXT NOT NULL DEFAULT 't_default',
  edition                 TEXT NOT NULL CHECK (edition IN ('incubator', 'vc')),
  provider                TEXT NOT NULL CHECK (provider IN ('salesforce', 'hubspot', 'pipedrive', 'custom')),
  status                  TEXT NOT NULL DEFAULT 'inactive' CHECK (status IN ('live', 'inactive', 'error')),
  -- Non-secret settings only.
  base_url                TEXT,
  webhook_path            TEXT,
  -- Filter rules: pull a deal when `trigger_field` reaches `trigger_value`.
  trigger_field           TEXT,
  trigger_value           TEXT,
  monthly_deck_cap        INTEGER CHECK (monthly_deck_cap IS NULL OR monthly_deck_cap >= 0),
  score_writeback_field   TEXT,
  auto_approve_within_cap INTEGER NOT NULL DEFAULT 0 CHECK (auto_approve_within_cap IN (0, 1)),
  write_back_scores       INTEGER NOT NULL DEFAULT 0 CHECK (write_back_scores IN (0, 1)),
  last_sync_at            TEXT,
  last_sync_count         INTEGER,
  last_error              TEXT,
  updated_at              TEXT NOT NULL DEFAULT (datetime('now')),
  sync_direction          TEXT NOT NULL DEFAULT 'pull',
  sync_schedule           TEXT NOT NULL DEFAULT 'manual',
  credential_ref          TEXT,
  credential_hint         TEXT,
  credential_set_at       TEXT,
  connected_at            TEXT,
  UNIQUE (tenant_id, edition, provider)
);

INSERT INTO crm_connections (
  id, tenant_id, edition, provider, status, base_url, webhook_path,
  trigger_field, trigger_value, monthly_deck_cap, score_writeback_field,
  auto_approve_within_cap, write_back_scores, last_sync_at, last_sync_count,
  last_error, updated_at, sync_direction, sync_schedule, credential_ref,
  credential_hint, credential_set_at, connected_at
)
SELECT
  id, 't_default', edition, provider, status, base_url, webhook_path,
  trigger_field, trigger_value, monthly_deck_cap, score_writeback_field,
  auto_approve_within_cap, write_back_scores, last_sync_at, last_sync_count,
  last_error, updated_at, sync_direction, sync_schedule, credential_ref,
  credential_hint, credential_set_at, connected_at
FROM crm_connections__pre_tenant;

DROP TABLE crm_connections__pre_tenant;

-- ── the restore, and its proof. See 0087's TRAP 2. ─────────────────────────
-- put the detached rows back. INSERT OR IGNORE, never REPLACE: a REPLACE is a
-- delete-then-insert and would cascade onward.
INSERT OR IGNORE INTO crm_field_mappings SELECT * FROM crm_field_mappings__fk_stash;
INSERT OR IGNORE INTO crm_sync_log SELECT * FROM crm_sync_log__fk_stash;

-- un-blank the columns, companion and all.

-- drop the stashes
DROP TABLE crm_field_mappings__fk_stash;
DROP TABLE crm_sync_log__fk_stash;

-- THE PROOF, inside the same transaction as the damage. Every row count, every
-- non-null FK count and every companion column's non-null count across the
-- 2 affected tables must equal the census taken before the detach. A failing
-- comparison writes its own message into a column whose CHECK admits only 'ok',
-- which errors the statement and rolls the whole migration back -- so a restore
-- that loses one row loses nothing, because the rebuild is undone with it.
INSERT INTO _tenancy_assert (id, verdict)
SELECT 'crm_connections.fk_actions_fully_restored',
       CASE WHEN (
              (SELECT count(*) FROM crm_field_mappings) <> (SELECT n_crm_field_mappings FROM _tenancy_census_crm_connections)
           OR (SELECT count(*) FROM crm_sync_log) <> (SELECT n_crm_sync_log FROM _tenancy_census_crm_connections)
           OR (SELECT count(*) FROM crm_field_mappings WHERE connection_id IS NOT NULL) <> (SELECT nn_crm_field_mappings__connection_id FROM _tenancy_census_crm_connections)
           OR (SELECT count(*) FROM crm_sync_log WHERE connection_id IS NOT NULL) <> (SELECT nn_crm_sync_log__connection_id FROM _tenancy_census_crm_connections)
           ) THEN 'FAIL: the crm_connections rebuild did not restore everything it detached'
            ELSE 'ok' END
ON CONFLICT (id) DO UPDATE SET verdict = excluded.verdict, at = datetime('now');
