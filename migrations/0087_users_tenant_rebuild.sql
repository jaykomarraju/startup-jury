-- 0087 — T0-SCHEMA · rebuild `users`: `UNIQUE (email)` becomes
--        `UNIQUE (tenant_id, email)`. ALONE IN ITS MIGRATION, BY INSTRUCTION.
--
-- This is the most dangerous statement in the programme. Read the whole header
-- before changing a character of it. Three traps, each measured, each of which
-- produces a migration that REPORTS SUCCESS and leaves the database wrong.
--
-- ── WHY IT HAS TO HAPPEN ────────────────────────────────────────────────────
-- `0001_init.sql:7` declares `email TEXT NOT NULL UNIQUE`, globally. Two
-- customers therefore cannot both employ `alice@gmail.com`, and §7 Q4 answers
-- that per-tenant: "Two customers employing the same person is not an edge case;
-- it is the second customer." Today's seed already shows the cost of the global
-- form — `0002_seed.sql` ships Nisha Kapoor TWICE (`nisha.kapoor@` and
-- `nisha.kapoor.vc@`), one human with two mangled addresses, purely to get past a
-- tenant-blind unique index. The deployed database still has them: a READ-ONLY
-- query on 2026-09-30 found 3 such collapsed humans among 13 rows.
--
-- `UNIQUE (email)` is an implicit index (`sqlite_autoindex_users_2`), and
-- `DROP INDEX sqlite_autoindex_users_2` is refused — "index associated with
-- UNIQUE or PRIMARY KEY constraint cannot be dropped", verified in D1. There is
-- no ALTER that removes it. A rebuild is the only way.
--
-- ══ TRAP 1 — RENAMING THE TABLE REWRITES 35 OTHER TABLES ════════════════════
-- 41 inbound foreign-key edges from 34 tables point at `users` — the most in the
-- schema, out of 99 edges total (measured: decks, scores, evaluations,
-- pipeline_events, calls, ic_votes, tickets, messages, programs, deck_versions,
-- call_participants, deck_onboarding, org_scoring_settings, role_permissions,
-- audit_log, notification_preferences, credit_ledger, signups, signup_documents,
-- agreements, signatures, authorised_signatories, notifications,
-- billing_payment_intents, seat_grants, account_profiles, account_orders,
-- evaluation_recommendations, deck_assignments, dd_items, vc_deals,
-- call_schedulers, call_outcomes, score_visibility).
--
-- The standard SQLite rebuild starts with a rename. Run inside the Worker against
-- a migrated D1, `ALTER TABLE users RENAME TO users_old` REWROTE 35 child tables'
-- DDL to `REFERENCES "users_old" (id)` — `decks` came back carrying it twice. The
-- rebuild reports success and leaves 41 foreign keys in 34 tables pointing at a
-- table you are about to drop. Invisible on the seed and invisible on production;
-- nothing surfaces until a later INSERT or DELETE behaves as though the
-- constraint were gone.
--
-- And the escape hatches do not exist, each measured in D1:
--   · `PRAGMA foreign_keys = OFF` — D1 ACCEPTS IT AND IGNORES IT. The statement
--     returns `success: true`; reading the pragma back still gives 1; an orphan
--     INSERT immediately afterwards still fails. This is the one to know about,
--     because it is the obvious fix and it fails SILENTLY: a migration written
--     around it looks correct in review and rewrites 35 tables anyway.
--   · `PRAGMA legacy_alter_table = ON` — accepted; the rename still rewrote all
--     41 edges. It governs views and triggers, not foreign keys.
--   · `PRAGMA writable_schema = ON` — refused outright, `SQLITE_AUTH`.
--   · rename-then-drop under `PRAGMA defer_foreign_keys = ON` — the DROP's
--     implicit DELETE increments the deferred counter and nothing decrements it,
--     so the COMMIT fails and everything rolls back. Not a path, but not quiet.
--
-- The answer to trap 1: NEVER RENAME THE TABLE. Stash the rows in a
-- constraint-free copy, drop and recreate `users` under its own name, restore,
-- all in one transaction with `PRAGMA defer_foreign_keys = ON`. Deferral works
-- here and not in the rename variant because the parent rows come BACK: SQLite
-- decrements the deferred counter as the restoring INSERT supplies each
-- referenced key, and the transaction commits with the counter at zero.
--
-- ══ TRAP 2 — `defer_foreign_keys` DEFERS THE CONSTRAINT, NOT THE ACTION ═════
-- Never renaming the table is right and it is not enough. `DROP TABLE`, with
-- foreign keys enabled, performs an implicit `DELETE FROM` before removing the
-- table, and that delete fires every `ON DELETE` ACTION the children declare.
-- `PRAGMA defer_foreign_keys` postpones the CONSTRAINT CHECK to commit time; it
-- does not suppress `CASCADE` or `SET NULL`. The first run of this block died at
-- 0096 with
--
--   CHECK constraint failed: term_sheet_file IS NULL OR term_sheet_template_id IS NOT NULL
--
-- because dropping `agreement_templates` nulled `vc_deals.term_sheet_template_id`
-- and `vc_deals` forbids a term-sheet file with no template.
--
-- THAT failure was loud, and it was luck. Measured on the edges into `users`:
--
--   6 edges are ON DELETE CASCADE — `authorised_signatories`, `call_schedulers`,
--     `deck_assignments`, `evaluation_recommendations`,
--     `notification_preferences`, `notifications`. Dropping `users` DELETES EVERY
--     ROW in them, because the implicit delete removes every parent row.
--   17 edges are ON DELETE SET NULL — `audit_log.actor_id`,
--     `account_profiles.updated_by`, `signups.assigned_user_id`,
--     `signatures.signer_user_id` and 13 more. Dropping `users` BLANKS every one.
--   18 edges are NO ACTION and are the only ones deferral alone protects.
--
-- None of those 23 raises anything by itself. `PRAGMA foreign_key_check` comes
-- back clean afterwards — a NULLed column satisfies its foreign key and a
-- cascade-deleted row cannot violate one. My own first measurement of this recipe
-- reported "13 rows preserved, foreign_key_check clean, the deck→user join still
-- resolves" and was, at that moment, silently destroying the audit trail's actor
-- ids and every notification in the database. It passed because the seed happens
-- to leave most of those columns NULL. That is the `0038` shape exactly, one level
-- deeper than §5f found it: green on a fresh seed, silent on real data.
--
-- ── AND THREE OF THOSE ACTIONS ARE NOT EVEN LEGAL ───────────────────────────
-- A SET NULL that a child's own CHECK forbids does not blank a column, it fails
-- the statement. Three exist, found by parsing every affected child's CHECKs for
-- its foreign-key column:
--
--   agreements.countersigned_by   CHECK ((countersigned_by IS NULL) = (countersigned_at IS NULL))
--   signatures.signer_user_id     CHECK (signer_user_id IS NOT NULL OR signer_email IS NOT NULL)
--   vc_deals.term_sheet_template_id  CHECK (term_sheet_file IS NULL OR term_sheet_template_id IS NOT NULL)
--
-- Only the third one fired, because the seed has no countersigned agreement and no
-- signature that carries a user and no email. On production either of the other
-- two would abort the chain mid-rebuild. `authorised_signatories`' CHECK
-- (`(role IS NULL) <> (user_id IS NULL)`) looks like a fourth and is not: its edge
-- is CASCADE, so the row goes rather than the column.
--
-- ── THE ANSWER: DETACH FIRST, SO THE ACTIONS NEVER FIRE ─────────────────────
-- Stash everything an action would touch, then detach it BY HAND before the drop,
-- so that at the moment `DROP TABLE` runs, nothing in the database references a
-- row of this table and the implicit DELETE has no action to fire and no CHECK to
-- break. Then put it all back. Two shapes, chosen per child by measurement:
--
--   · DELETE-and-reinsert for the CASCADE children, whose rows go anyway, plus
--     `signatures`, whose CHECK cannot be satisfied by a NULL. All of them have
--     ZERO inbound edges, so deleting them cascades nowhere.
--   · UPDATE-to-NULL-and-restore for the remaining SET NULL columns, carrying the
--     companion column where a CHECK ties one to it — `countersigned_at` with
--     `countersigned_by`, `term_sheet_file` with `term_sheet_template_id`. These
--     are only ever UPDATEd, which matters because four of them are themselves
--     parents: `agreements`, `billing_payment_intents`, `credit_ledger`, `signups`.
--
-- The restore uses `INSERT OR IGNORE` and `UPDATE`, never `REPLACE`, because a
-- REPLACE is a delete-then-insert and would cascade onward.
--
-- A census taken BEFORE the detach is compared AFTER the restore, inside the same
-- transaction: every row count, every foreign-key column's non-null count and
-- every companion column's non-null count. A restore that loses one row fails the
-- migration and takes the rebuild down with it, so nothing is lost.
-- `_tenancy_census_users` is kept rather than dropped — 0100 compares it again
-- AFTER the transaction commits, which is the one thing an in-transaction
-- assertion cannot do.
--
-- ══ TRAP 3 — ONE TRANSACTION IS A FACT ABOUT THE RUNNERS, NOT A HOPE ════════
-- `PRAGMA defer_foreign_keys` is transaction-scoped, so the whole file must run
-- as one transaction or the DROP commits on its own and takes the database with
-- it. All three runners do, verified in their source:
--
--   · the test harness — `applyD1Migrations` in
--     `@cloudflare/vitest-pool-workers` splits each file and runs it as a single
--     `db.batch([...])`, appending the ledger INSERT to the same batch
--     (`dist/worker/lib/cloudflare/test-internal.mjs:37-42`);
--   · `wrangler d1 migrations apply --local` — `executeLocally` splits and calls
--     `db.batch(...)`;
--   · `wrangler d1 migrations apply --remote` — `buildMigrationQuery` hands the
--     whole file plus the ledger INSERT to the D1 `/query` endpoint as one
--     multi-statement request, which D1 runs in an implicit transaction.
--
-- The remote path is the one that could not be proved from this session without
-- writing to production, so 0088 proves it AFTER the fact: a separate migration
-- whose only job is to fail loudly if this one half-applied. If 0088 fails, 0087
-- half-applied — restore from the `wrangler d1 time-travel` bookmark and stop.
--
-- ── THE `DEFAULT` ON THIS COLUMN, AND A REVERSAL WORTH RECORDING ────────────
-- The 17 `ALTER TABLE` tables keep `DEFAULT 't_default'` because SQLite gives no
-- choice: there is no way to add a NOT NULL column to a populated table without
-- one (0084's header). Here there IS a choice, and this file first took the loud
-- option — `tenant_id TEXT NOT NULL` with no default, so that an `INSERT INTO
-- users` forgetting the tenant FAILS rather than quietly creating tenant B's
-- colleague inside tenant A, which is the single worst silent write in the schema
-- because that account then signs in and sees everything.
--
-- Measured, it reddened 109 tests. `routes/users.ts:263` is the only place a
-- `users` row is created and its INSERT names no tenant — and that file is
-- T1-PEOPLE's, which T0 does not edit, and which §6 names as the file a foundation
-- session must not touch at all. T0 merging red is seven T1 branches cut from a red
-- commit.
--
-- So the column takes the default, uniform with the other twenty-nine, and the
-- loudness moves to where it can be per-table and extended by the session that
-- owns each write: `test/worker/tenant-scope.test.ts` asserts that a row created
-- through the API as tenant B comes back carrying B's tenant_id. Integration may
-- drop this default once `routes/users.ts` supplies the column — the recipe below
-- is proven and reusable for exactly that — but it is T1-PEOPLE's change to make,
-- not T0's to pre-empt.
--
-- The backfill itself is still the explicit `'t_default'` literal in the restoring
-- SELECT rather than a reliance on the default, so it stays visible in review.
--
-- ── WHAT IS NOT TOUCHED ─────────────────────────────────────────────────────
-- Every column, every CHECK and the `id` primary key are reproduced VERBATIM from
-- the materialised schema — `plan_tier`'s three-value CHECK,
-- `evaluation_capacity`'s, `must_change_password`, `deleted_email` (0044's
-- soft-delete slot that frees the address), all of it. The only differences are
-- the new `tenant_id` column and `UNIQUE (email)` becoming
-- `UNIQUE (tenant_id, email)`.
--
-- `users.ts:724` transfer-ownership is NOT touched, by instruction and for the
-- reason §6 gives: its authorisation is expressed as an ABSENCE
-- (`requireTask("adminconsole")` with an empty role list reduces to
-- `role === "superuser"`), its two UPDATEs are `WHERE id = ? AND edition = ?`, and
-- with `tenant_id` on the table but not in those clauses it would promote a target
-- and demote the actor in whichever customer's row matched. That is T1-PEOPLE's,
-- with the invariant at `users.ts:719` becoming "exactly one superuser per
-- (tenant, edition)".

-- The assertion ledger. Created here because 0087 is its first user; 0088 and
-- 0100 add to it. A failing assertion writes its own message into a column whose
-- CHECK admits only 'ok', which errors the statement and rolls the transaction
-- back. `RAISE(ABORT, …)` would be the natural way to say this and it exists only
-- inside a trigger.
CREATE TABLE IF NOT EXISTS _tenancy_assert (
  id      TEXT PRIMARY KEY,
  verdict TEXT NOT NULL CHECK (verdict = 'ok'),
  at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── TRAP 2's census and stashes, taken BEFORE anything is dropped ────────────
-- `_tenancy_census_users` is kept rather than dropped: 0100 compares it again
-- AFTER the transaction commits, which is the one thing an in-transaction
-- assertion cannot do.
CREATE TABLE _tenancy_census_users AS SELECT
  (SELECT count(*) FROM account_orders) AS n_account_orders,
  (SELECT count(*) FROM account_profiles) AS n_account_profiles,
  (SELECT count(*) FROM agreements) AS n_agreements,
  (SELECT count(*) FROM audit_log) AS n_audit_log,
  (SELECT count(*) FROM authorised_signatories) AS n_authorised_signatories,
  (SELECT count(*) FROM billing_payment_intents) AS n_billing_payment_intents,
  (SELECT count(*) FROM call_outcomes) AS n_call_outcomes,
  (SELECT count(*) FROM call_schedulers) AS n_call_schedulers,
  (SELECT count(*) FROM credit_ledger) AS n_credit_ledger,
  (SELECT count(*) FROM dd_items) AS n_dd_items,
  (SELECT count(*) FROM deck_assignments) AS n_deck_assignments,
  (SELECT count(*) FROM evaluation_recommendations) AS n_evaluation_recommendations,
  (SELECT count(*) FROM notification_preferences) AS n_notification_preferences,
  (SELECT count(*) FROM notifications) AS n_notifications,
  (SELECT count(*) FROM score_visibility) AS n_score_visibility,
  (SELECT count(*) FROM seat_grants) AS n_seat_grants,
  (SELECT count(*) FROM signatures) AS n_signatures,
  (SELECT count(*) FROM signup_documents) AS n_signup_documents,
  (SELECT count(*) FROM signups) AS n_signups,
  (SELECT count(*) FROM vc_deals) AS n_vc_deals,
  (SELECT count(*) FROM account_orders WHERE created_by IS NOT NULL) AS nn_account_orders__created_by,
  (SELECT count(*) FROM account_profiles WHERE updated_by IS NOT NULL) AS nn_account_profiles__updated_by,
  (SELECT count(*) FROM agreements WHERE countersigned_by IS NOT NULL) AS nn_agreements__countersigned_by,
  (SELECT count(*) FROM audit_log WHERE actor_id IS NOT NULL) AS nn_audit_log__actor_id,
  (SELECT count(*) FROM authorised_signatories WHERE user_id IS NOT NULL) AS nn_authorised_signatories__user_id,
  (SELECT count(*) FROM billing_payment_intents WHERE actor_id IS NOT NULL) AS nn_billing_payment_intents__actor_id,
  (SELECT count(*) FROM call_outcomes WHERE set_by IS NOT NULL) AS nn_call_outcomes__set_by,
  (SELECT count(*) FROM call_schedulers WHERE assigned_by IS NOT NULL) AS nn_call_schedulers__assigned_by,
  (SELECT count(*) FROM call_schedulers WHERE user_id IS NOT NULL) AS nn_call_schedulers__user_id,
  (SELECT count(*) FROM credit_ledger WHERE actor_id IS NOT NULL) AS nn_credit_ledger__actor_id,
  (SELECT count(*) FROM dd_items WHERE updated_by IS NOT NULL) AS nn_dd_items__updated_by,
  (SELECT count(*) FROM deck_assignments WHERE assigned_by IS NOT NULL) AS nn_deck_assignments__assigned_by,
  (SELECT count(*) FROM deck_assignments WHERE evaluator_id IS NOT NULL) AS nn_deck_assignments__evaluator_id,
  (SELECT count(*) FROM evaluation_recommendations WHERE user_id IS NOT NULL) AS nn_evaluation_recommendations__user_id,
  (SELECT count(*) FROM notification_preferences WHERE user_id IS NOT NULL) AS nn_notification_preferences__user_id,
  (SELECT count(*) FROM notifications WHERE user_id IS NOT NULL) AS nn_notifications__user_id,
  (SELECT count(*) FROM score_visibility WHERE updated_by IS NOT NULL) AS nn_score_visibility__updated_by,
  (SELECT count(*) FROM seat_grants WHERE actor_id IS NOT NULL) AS nn_seat_grants__actor_id,
  (SELECT count(*) FROM signatures WHERE signer_user_id IS NOT NULL) AS nn_signatures__signer_user_id,
  (SELECT count(*) FROM signup_documents WHERE verified_by IS NOT NULL) AS nn_signup_documents__verified_by,
  (SELECT count(*) FROM signups WHERE assigned_user_id IS NOT NULL) AS nn_signups__assigned_user_id,
  (SELECT count(*) FROM signups WHERE authorised_signatory_user_id IS NOT NULL) AS nn_signups__authorised_signatory_user_id,
  (SELECT count(*) FROM vc_deals WHERE updated_by IS NOT NULL) AS nn_vc_deals__updated_by,
  (SELECT count(*) FROM agreements WHERE countersigned_at IS NOT NULL) AS nn_agreements__countersigned_at;

-- stash the 7 tables whose rows have to go: the ON DELETE CASCADE
-- children, plus any SET NULL child whose own CHECK forbids the NULL (see header).
-- Every one has ZERO inbound edges (measured), so deleting them cascades nowhere.
CREATE TABLE authorised_signatories__fk_stash AS SELECT * FROM authorised_signatories;
CREATE TABLE call_schedulers__fk_stash AS SELECT * FROM call_schedulers;
CREATE TABLE deck_assignments__fk_stash AS SELECT * FROM deck_assignments;
CREATE TABLE evaluation_recommendations__fk_stash AS SELECT * FROM evaluation_recommendations;
CREATE TABLE notification_preferences__fk_stash AS SELECT * FROM notification_preferences;
CREATE TABLE notifications__fk_stash AS SELECT * FROM notifications;
CREATE TABLE signatures__fk_stash AS SELECT * FROM signatures;

-- stash the 14 columns that will be blanked, with the companion column
-- a CHECK ties them to where there is one.
CREATE TABLE account_orders__created_by__fk_stash AS SELECT intent_id, created_by FROM account_orders WHERE created_by IS NOT NULL;
CREATE TABLE account_profiles__updated_by__fk_stash AS SELECT edition, updated_by FROM account_profiles WHERE updated_by IS NOT NULL;
CREATE TABLE agreements__countersigned_by__fk_stash AS SELECT id, countersigned_by, countersigned_at FROM agreements WHERE countersigned_by IS NOT NULL;
CREATE TABLE audit_log__actor_id__fk_stash AS SELECT id, actor_id FROM audit_log WHERE actor_id IS NOT NULL;
CREATE TABLE billing_payment_intents__actor_id__fk_stash AS SELECT id, actor_id FROM billing_payment_intents WHERE actor_id IS NOT NULL;
CREATE TABLE call_outcomes__set_by__fk_stash AS SELECT deck_id, kind, set_by FROM call_outcomes WHERE set_by IS NOT NULL;
CREATE TABLE credit_ledger__actor_id__fk_stash AS SELECT id, actor_id FROM credit_ledger WHERE actor_id IS NOT NULL;
CREATE TABLE dd_items__updated_by__fk_stash AS SELECT id, updated_by FROM dd_items WHERE updated_by IS NOT NULL;
CREATE TABLE score_visibility__updated_by__fk_stash AS SELECT edition, viewer_role, target_role, updated_by FROM score_visibility WHERE updated_by IS NOT NULL;
CREATE TABLE seat_grants__actor_id__fk_stash AS SELECT id, actor_id FROM seat_grants WHERE actor_id IS NOT NULL;
CREATE TABLE signup_documents__verified_by__fk_stash AS SELECT id, verified_by FROM signup_documents WHERE verified_by IS NOT NULL;
CREATE TABLE signups__assigned_user_id__fk_stash AS SELECT id, assigned_user_id FROM signups WHERE assigned_user_id IS NOT NULL;
CREATE TABLE signups__authorised_signatory_user_id__fk_stash AS SELECT id, authorised_signatory_user_id FROM signups WHERE authorised_signatory_user_id IS NOT NULL;
CREATE TABLE vc_deals__updated_by__fk_stash AS SELECT deck_id, updated_by FROM vc_deals WHERE updated_by IS NOT NULL;

-- DETACH. After this nothing in the database references a row of users,
-- so the DROP's implicit DELETE fires no action at all and no child CHECK
-- can be violated by one.
DELETE FROM authorised_signatories;
DELETE FROM call_schedulers;
DELETE FROM deck_assignments;
DELETE FROM evaluation_recommendations;
DELETE FROM notification_preferences;
DELETE FROM notifications;
DELETE FROM signatures;
UPDATE account_orders SET created_by = NULL WHERE created_by IS NOT NULL;
UPDATE account_profiles SET updated_by = NULL WHERE updated_by IS NOT NULL;
UPDATE agreements SET countersigned_by = NULL, countersigned_at = NULL WHERE countersigned_by IS NOT NULL;
UPDATE audit_log SET actor_id = NULL WHERE actor_id IS NOT NULL;
UPDATE billing_payment_intents SET actor_id = NULL WHERE actor_id IS NOT NULL;
UPDATE call_outcomes SET set_by = NULL WHERE set_by IS NOT NULL;
UPDATE credit_ledger SET actor_id = NULL WHERE actor_id IS NOT NULL;
UPDATE dd_items SET updated_by = NULL WHERE updated_by IS NOT NULL;
UPDATE score_visibility SET updated_by = NULL WHERE updated_by IS NOT NULL;
UPDATE seat_grants SET actor_id = NULL WHERE actor_id IS NOT NULL;
UPDATE signup_documents SET verified_by = NULL WHERE verified_by IS NOT NULL;
UPDATE signups SET assigned_user_id = NULL WHERE assigned_user_id IS NOT NULL;
UPDATE signups SET authorised_signatory_user_id = NULL WHERE authorised_signatory_user_id IS NOT NULL;
UPDATE vc_deals SET updated_by = NULL WHERE updated_by IS NOT NULL;

-- ── the rebuild itself. `users` is never renamed. ───────────────────────────
CREATE TABLE users__pre_tenant AS SELECT * FROM users;

PRAGMA defer_foreign_keys = ON;

DROP TABLE users;

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  password_hash TEXT,
  role          TEXT NOT NULL,
  edition       TEXT NOT NULL CHECK (edition IN ('incubator', 'vc')),
  initials      TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  user_type     TEXT NOT NULL DEFAULT 'staff',
  title         TEXT,
  invite_accepted_at   TEXT,
  invite_sent_at       TEXT,
  deleted_at           TEXT,
  deleted_email        TEXT,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  plan_tier     TEXT NOT NULL DEFAULT 'standard'
                CHECK (plan_tier IN ('standard', 'pro', 'premium')),
  evaluation_capacity INTEGER
                CHECK (evaluation_capacity IS NULL OR evaluation_capacity > 0),
  -- The customer this account belongs to.
  tenant_id     TEXT NOT NULL DEFAULT 't_default',
  -- WAS `UNIQUE (email)`. One human may now hold an account at two customers.
  UNIQUE (tenant_id, email)
);

INSERT INTO users (
  id, name, email, password_hash, role, edition, initials, active, created_at,
  user_type, title, invite_accepted_at, invite_sent_at, deleted_at,
  deleted_email, must_change_password, plan_tier, evaluation_capacity, tenant_id
)
SELECT
  id, name, email, password_hash, role, edition, initials, active, created_at,
  user_type, title, invite_accepted_at, invite_sent_at, deleted_at,
  deleted_email, must_change_password, plan_tier, evaluation_capacity, 't_default'
FROM users__pre_tenant;

DROP TABLE users__pre_tenant;

-- `idx_users_live ON users (edition, deleted_at)` died with the table. It comes
-- back tenant-leading: the "live staff roster" read is per workspace, and an
-- index that leads with `edition` stops being selective the day a second customer
-- exists. One of the 21 re-cuts; the other 20 are in 0091, 0092 and 0099.
CREATE INDEX IF NOT EXISTS idx_users_live ON users (tenant_id, edition, deleted_at);

-- ── TRAP 2's restore and its proof ────────────────────────────────────────
-- put the detached rows back. INSERT OR IGNORE, never REPLACE: a REPLACE is a
-- delete-then-insert and would cascade onward.
INSERT OR IGNORE INTO authorised_signatories SELECT * FROM authorised_signatories__fk_stash;
INSERT OR IGNORE INTO call_schedulers SELECT * FROM call_schedulers__fk_stash;
INSERT OR IGNORE INTO deck_assignments SELECT * FROM deck_assignments__fk_stash;
INSERT OR IGNORE INTO evaluation_recommendations SELECT * FROM evaluation_recommendations__fk_stash;
INSERT OR IGNORE INTO notification_preferences SELECT * FROM notification_preferences__fk_stash;
INSERT OR IGNORE INTO notifications SELECT * FROM notifications__fk_stash;
INSERT OR IGNORE INTO signatures SELECT * FROM signatures__fk_stash;

-- un-blank the columns, companion and all.
UPDATE account_orders
  SET created_by = (SELECT s.created_by FROM account_orders__created_by__fk_stash s WHERE s.intent_id = account_orders.intent_id)
  WHERE EXISTS (SELECT 1 FROM account_orders__created_by__fk_stash s WHERE s.intent_id = account_orders.intent_id);
UPDATE account_profiles
  SET updated_by = (SELECT s.updated_by FROM account_profiles__updated_by__fk_stash s WHERE s.edition = account_profiles.edition)
  WHERE EXISTS (SELECT 1 FROM account_profiles__updated_by__fk_stash s WHERE s.edition = account_profiles.edition);
UPDATE agreements
  SET countersigned_by = (SELECT s.countersigned_by FROM agreements__countersigned_by__fk_stash s WHERE s.id = agreements.id),
      countersigned_at = (SELECT s.countersigned_at FROM agreements__countersigned_by__fk_stash s WHERE s.id = agreements.id)
  WHERE EXISTS (SELECT 1 FROM agreements__countersigned_by__fk_stash s WHERE s.id = agreements.id);
UPDATE audit_log
  SET actor_id = (SELECT s.actor_id FROM audit_log__actor_id__fk_stash s WHERE s.id = audit_log.id)
  WHERE EXISTS (SELECT 1 FROM audit_log__actor_id__fk_stash s WHERE s.id = audit_log.id);
UPDATE billing_payment_intents
  SET actor_id = (SELECT s.actor_id FROM billing_payment_intents__actor_id__fk_stash s WHERE s.id = billing_payment_intents.id)
  WHERE EXISTS (SELECT 1 FROM billing_payment_intents__actor_id__fk_stash s WHERE s.id = billing_payment_intents.id);
UPDATE call_outcomes
  SET set_by = (SELECT s.set_by FROM call_outcomes__set_by__fk_stash s WHERE s.deck_id = call_outcomes.deck_id AND s.kind = call_outcomes.kind)
  WHERE EXISTS (SELECT 1 FROM call_outcomes__set_by__fk_stash s WHERE s.deck_id = call_outcomes.deck_id AND s.kind = call_outcomes.kind);
UPDATE credit_ledger
  SET actor_id = (SELECT s.actor_id FROM credit_ledger__actor_id__fk_stash s WHERE s.id = credit_ledger.id)
  WHERE EXISTS (SELECT 1 FROM credit_ledger__actor_id__fk_stash s WHERE s.id = credit_ledger.id);
UPDATE dd_items
  SET updated_by = (SELECT s.updated_by FROM dd_items__updated_by__fk_stash s WHERE s.id = dd_items.id)
  WHERE EXISTS (SELECT 1 FROM dd_items__updated_by__fk_stash s WHERE s.id = dd_items.id);
UPDATE score_visibility
  SET updated_by = (SELECT s.updated_by FROM score_visibility__updated_by__fk_stash s WHERE s.edition = score_visibility.edition AND s.viewer_role = score_visibility.viewer_role AND s.target_role = score_visibility.target_role)
  WHERE EXISTS (SELECT 1 FROM score_visibility__updated_by__fk_stash s WHERE s.edition = score_visibility.edition AND s.viewer_role = score_visibility.viewer_role AND s.target_role = score_visibility.target_role);
UPDATE seat_grants
  SET actor_id = (SELECT s.actor_id FROM seat_grants__actor_id__fk_stash s WHERE s.id = seat_grants.id)
  WHERE EXISTS (SELECT 1 FROM seat_grants__actor_id__fk_stash s WHERE s.id = seat_grants.id);
UPDATE signup_documents
  SET verified_by = (SELECT s.verified_by FROM signup_documents__verified_by__fk_stash s WHERE s.id = signup_documents.id)
  WHERE EXISTS (SELECT 1 FROM signup_documents__verified_by__fk_stash s WHERE s.id = signup_documents.id);
UPDATE signups
  SET assigned_user_id = (SELECT s.assigned_user_id FROM signups__assigned_user_id__fk_stash s WHERE s.id = signups.id)
  WHERE EXISTS (SELECT 1 FROM signups__assigned_user_id__fk_stash s WHERE s.id = signups.id);
UPDATE signups
  SET authorised_signatory_user_id = (SELECT s.authorised_signatory_user_id FROM signups__authorised_signatory_user_id__fk_stash s WHERE s.id = signups.id)
  WHERE EXISTS (SELECT 1 FROM signups__authorised_signatory_user_id__fk_stash s WHERE s.id = signups.id);
UPDATE vc_deals
  SET updated_by = (SELECT s.updated_by FROM vc_deals__updated_by__fk_stash s WHERE s.deck_id = vc_deals.deck_id)
  WHERE EXISTS (SELECT 1 FROM vc_deals__updated_by__fk_stash s WHERE s.deck_id = vc_deals.deck_id);

-- drop the stashes
DROP TABLE authorised_signatories__fk_stash;
DROP TABLE call_schedulers__fk_stash;
DROP TABLE deck_assignments__fk_stash;
DROP TABLE evaluation_recommendations__fk_stash;
DROP TABLE notification_preferences__fk_stash;
DROP TABLE notifications__fk_stash;
DROP TABLE signatures__fk_stash;
DROP TABLE account_orders__created_by__fk_stash;
DROP TABLE account_profiles__updated_by__fk_stash;
DROP TABLE agreements__countersigned_by__fk_stash;
DROP TABLE audit_log__actor_id__fk_stash;
DROP TABLE billing_payment_intents__actor_id__fk_stash;
DROP TABLE call_outcomes__set_by__fk_stash;
DROP TABLE credit_ledger__actor_id__fk_stash;
DROP TABLE dd_items__updated_by__fk_stash;
DROP TABLE score_visibility__updated_by__fk_stash;
DROP TABLE seat_grants__actor_id__fk_stash;
DROP TABLE signup_documents__verified_by__fk_stash;
DROP TABLE signups__assigned_user_id__fk_stash;
DROP TABLE signups__authorised_signatory_user_id__fk_stash;
DROP TABLE vc_deals__updated_by__fk_stash;

-- THE PROOF, inside the same transaction as the damage. Every row count, every
-- non-null FK count and every companion column's non-null count across the
-- 20 affected tables must equal the census taken before the detach. A failing
-- comparison writes its own message into a column whose CHECK admits only 'ok',
-- which errors the statement and rolls the whole migration back -- so a restore
-- that loses one row loses nothing, because the rebuild is undone with it.
INSERT INTO _tenancy_assert (id, verdict)
SELECT 'users.fk_actions_fully_restored',
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
           ) THEN 'FAIL: the users rebuild did not restore everything it detached'
            ELSE 'ok' END
ON CONFLICT (id) DO UPDATE SET verdict = excluded.verdict, at = datetime('now');
