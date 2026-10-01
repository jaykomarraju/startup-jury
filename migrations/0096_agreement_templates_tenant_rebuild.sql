-- 0096 — T0-SCHEMA · rebuild 9 of 11. `agreement_templates`
--        `UNIQUE (edition, code)` → `UNIQUE (tenant_id, edition, code)`.
--
-- Recipe: `0087_users_tenant_rebuild.sql`.
--
-- ── FIVE INBOUND EDGES, SO THE DEFERRAL IS LOAD-BEARING HERE ────────────────
-- Unlike the six rebuilds above, this table is a parent:
-- `agreement_template_fields`, `agreement_template_programs`,
-- `agreement_flow_steps`, `agreements` and `vc_deals` hold foreign keys to it.
-- Measured. So the `DROP TABLE` below orphans real child rows for the length of
-- three statements, and `PRAGMA defer_foreign_keys = ON` is what makes that legal
-- — the restoring INSERT supplies every referenced key back and the deferred
-- counter returns to zero before the transaction commits.
--
-- It is also why the recipe must not rename: `ALTER TABLE agreement_templates
-- RENAME TO …` would rewrite those five child clauses to point at a table about to
-- be dropped, silently, exactly as it does for `users`' 41.
--
-- ── WHY THE UNIQUE HAS TO WIDEN ─────────────────────────────────────────────
-- `code` is the template's stable handle — `esign/store.ts:66-72` selects on it —
-- and templates are per customer: §2 B15 lists "agreement templates, authorised
-- signatories" as crossing. Two customers each with an `nda` template is the
-- ordinary case, and `UNIQUE (edition, code)` makes it impossible. A table-level
-- UNIQUE cannot be widened by `ALTER TABLE`, which is the whole reason this table
-- is in the rebuild set rather than taking a plain `ADD COLUMN` with the other 17.
--
-- `status` and `stage` CHECKs come across verbatim. `0049_esign_signing_method.sql`
-- added nothing to this table, so the column list below is `0001`-era plus the two
-- columns later migrations appended.

CREATE TABLE _tenancy_census_agreement_templates AS SELECT
  (SELECT count(*) FROM agreement_flow_steps) AS n_agreement_flow_steps,
  (SELECT count(*) FROM agreement_template_fields) AS n_agreement_template_fields,
  (SELECT count(*) FROM agreement_template_programs) AS n_agreement_template_programs,
  (SELECT count(*) FROM agreements) AS n_agreements,
  (SELECT count(*) FROM vc_deals) AS n_vc_deals,
  (SELECT count(*) FROM agreement_flow_steps WHERE template_id IS NOT NULL) AS nn_agreement_flow_steps__template_id,
  (SELECT count(*) FROM agreement_template_fields WHERE template_id IS NOT NULL) AS nn_agreement_template_fields__template_id,
  (SELECT count(*) FROM agreement_template_programs WHERE template_id IS NOT NULL) AS nn_agreement_template_programs__template_id,
  (SELECT count(*) FROM agreements WHERE template_id IS NOT NULL) AS nn_agreements__template_id,
  (SELECT count(*) FROM vc_deals WHERE term_sheet_template_id IS NOT NULL) AS nn_vc_deals__term_sheet_template_id,
  (SELECT count(*) FROM vc_deals WHERE term_sheet_file IS NOT NULL) AS nn_vc_deals__term_sheet_file;

-- stash the 3 tables whose rows have to go: the ON DELETE CASCADE
-- children, plus any SET NULL child whose own CHECK forbids the NULL (see header).
-- Every one has ZERO inbound edges (measured), so deleting them cascades nowhere.
CREATE TABLE agreement_flow_steps__fk_stash AS SELECT * FROM agreement_flow_steps;
CREATE TABLE agreement_template_fields__fk_stash AS SELECT * FROM agreement_template_fields;
CREATE TABLE agreement_template_programs__fk_stash AS SELECT * FROM agreement_template_programs;

-- stash the 2 columns that will be blanked, with the companion column
-- a CHECK ties them to where there is one.
CREATE TABLE agreements__template_id__fk_stash AS SELECT id, template_id FROM agreements WHERE template_id IS NOT NULL;
CREATE TABLE vc_deals__term_sheet_template_id__fk_stash AS SELECT deck_id, term_sheet_template_id, term_sheet_file FROM vc_deals WHERE term_sheet_template_id IS NOT NULL;

-- DETACH. After this nothing in the database references a row of agreement_templates,
-- so the DROP's implicit DELETE fires no action at all and no child CHECK
-- can be violated by one.
DELETE FROM agreement_flow_steps;
DELETE FROM agreement_template_fields;
DELETE FROM agreement_template_programs;
UPDATE agreements SET template_id = NULL WHERE template_id IS NOT NULL;
UPDATE vc_deals SET term_sheet_template_id = NULL, term_sheet_file = NULL WHERE term_sheet_template_id IS NOT NULL;

-- ── THE `DEFAULT` ON `tenant_id`, UNIFORM ACROSS ALL THIRTY ──────────────────
-- The 19 `ALTER TABLE` columns carry `DEFAULT 't_default'` because SQLite offers
-- no way to add a NOT NULL column to a populated table without one. The eleven
-- rebuilt tables could have gone without, and `0087`'s header records why they do
-- not: the loud form reddened 109 tests in files owned by other T1 sessions, and a
-- foundation session that merges red is seven T1 branches cut from a red commit.
-- The write-side guard is `test/worker/tenant-scope.test.ts`, per table, extended
-- by whichever session owns each INSERT.
--
CREATE TABLE agreement_templates__pre_tenant AS SELECT * FROM agreement_templates;

PRAGMA defer_foreign_keys = ON;

DROP TABLE agreement_templates;

CREATE TABLE agreement_templates (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL DEFAULT 't_default',
  edition    TEXT NOT NULL CHECK (edition IN ('incubator', 'vc')),
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  file_name  TEXT,
  file_url   TEXT,
  version    TEXT NOT NULL DEFAULT 'v1',
  -- "Retired templates stay for audit but can't be picked for new sign-ups."
  status     TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'retired')),
  stage      TEXT NOT NULL DEFAULT 'on_signup' CHECK (stage IN ('pre_signup', 'on_signup', 'post_signup')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,
  UNIQUE (tenant_id, edition, code)
);

INSERT INTO agreement_templates (
  id, tenant_id, edition, code, name, file_name, file_url, version, status,
  stage, created_at, updated_at
)
SELECT
  id, 't_default', edition, code, name, file_name, file_url, version, status,
  stage, created_at, updated_at
FROM agreement_templates__pre_tenant;

DROP TABLE agreement_templates__pre_tenant;

-- ── the restore, and its proof. See 0087's TRAP 2. ─────────────────────────
-- put the detached rows back. INSERT OR IGNORE, never REPLACE: a REPLACE is a
-- delete-then-insert and would cascade onward.
INSERT OR IGNORE INTO agreement_flow_steps SELECT * FROM agreement_flow_steps__fk_stash;
INSERT OR IGNORE INTO agreement_template_fields SELECT * FROM agreement_template_fields__fk_stash;
INSERT OR IGNORE INTO agreement_template_programs SELECT * FROM agreement_template_programs__fk_stash;

-- un-blank the columns, companion and all.
UPDATE agreements
  SET template_id = (SELECT s.template_id FROM agreements__template_id__fk_stash s WHERE s.id = agreements.id)
  WHERE EXISTS (SELECT 1 FROM agreements__template_id__fk_stash s WHERE s.id = agreements.id);
UPDATE vc_deals
  SET term_sheet_template_id = (SELECT s.term_sheet_template_id FROM vc_deals__term_sheet_template_id__fk_stash s WHERE s.deck_id = vc_deals.deck_id),
      term_sheet_file = (SELECT s.term_sheet_file FROM vc_deals__term_sheet_template_id__fk_stash s WHERE s.deck_id = vc_deals.deck_id)
  WHERE EXISTS (SELECT 1 FROM vc_deals__term_sheet_template_id__fk_stash s WHERE s.deck_id = vc_deals.deck_id);

-- drop the stashes
DROP TABLE agreement_flow_steps__fk_stash;
DROP TABLE agreement_template_fields__fk_stash;
DROP TABLE agreement_template_programs__fk_stash;
DROP TABLE agreements__template_id__fk_stash;
DROP TABLE vc_deals__term_sheet_template_id__fk_stash;

-- THE PROOF, inside the same transaction as the damage. Every row count, every
-- non-null FK count and every companion column's non-null count across the
-- 5 affected tables must equal the census taken before the detach. A failing
-- comparison writes its own message into a column whose CHECK admits only 'ok',
-- which errors the statement and rolls the whole migration back -- so a restore
-- that loses one row loses nothing, because the rebuild is undone with it.
INSERT INTO _tenancy_assert (id, verdict)
SELECT 'agreement_templates.fk_actions_fully_restored',
       CASE WHEN (
              (SELECT count(*) FROM agreement_flow_steps) <> (SELECT n_agreement_flow_steps FROM _tenancy_census_agreement_templates)
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
           ) THEN 'FAIL: the agreement_templates rebuild did not restore everything it detached'
            ELSE 'ok' END
ON CONFLICT (id) DO UPDATE SET verdict = excluded.verdict, at = datetime('now');
