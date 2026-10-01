-- 0099 — T0-SCHEMA · re-cut every index whose leading column stopped being
--        selective. 18 indexes on the 17 `ALTER TABLE` tables, plus one
--        tenant-blind unique that is a silent-data-loss bug in waiting.
--
-- ── THE COUNT IN THE PLAN IS WRONG, AND HERE IS THE MEASUREMENT ─────────────
-- §5e says "21 non-unique indexes lead with `edition`" and "5 unique indexes
-- mention it", calling both counts verified. Measured on the materialised schema
-- (all 63 migrations applied):
--
--   CREATE INDEX        … LIKE '%edition%'  → 16
--   CREATE UNIQUE INDEX … LIKE '%edition%'  →  5
--                                            ───
--                                             21
--
-- So 21 is the TOTAL, not the non-unique subset: **16 non-unique and 5 unique.**
-- Three of the 16 live on tables that 0087-0098 rebuilt and were recreated
-- tenant-leading inside their own rebuild migrations (`idx_users_live` in 0087,
-- `idx_role_permissions_lookup` in 0091, `idx_score_visibility_edition` in 0092),
-- because a `DROP TABLE` takes its indexes with it and leaving them to this file
-- would mean nine statements running against a table with no index on it.
--
-- That leaves 13 non-unique and 5 unique here, and the 19th statement below.
--
-- ── WHY THIS IS NOT COSMETIC ────────────────────────────────────────────────
-- `edition` has exactly two values and `CHECK (edition IN ('incubator','vc'))` is
-- asserted in 25 places. An index leading with a two-valued column narrows a scan
-- to half the table and no further, which is harmless while half the table is one
-- customer's data and useless the moment it is fifty customers'. Every one of
-- these is re-cut as `(tenant_id, edition, …)` — tenant first, because tenant is
-- the predicate that is always present once `src/shared/tenant.ts` is in use, and
-- `edition` second so the existing two-column lookups still hit a prefix.
--
-- ── THE 19TH STATEMENT IS §2's A8, AT THE INDEX LEVEL ───────────────────────
--   CREATE UNIQUE INDEX idx_notifications_dedupe
--     ON notifications (dedupe_key) WHERE dedupe_key IS NOT NULL
--
-- Globally unique, on a column whose values are composed by hand. §2 A8 names the
-- consequence: `monthly_usage_summary:${edition}:${month}` (`scheduled.ts:199`) is
-- tenant-blind, so tenant B's month-end digest is SILENTLY SWALLOWED as a
-- duplicate of tenant A's. Nothing errors, nothing is logged, a notification
-- simply never appears. It will not show up until the second customer's first
-- month-end — which is the worst possible time to find out, because by then it has
-- already not happened.
--
-- Re-cutting the index as `(tenant_id, dedupe_key)` fixes the swallow for every
-- key, including the id-derived ones that are already safe. The KEY STRING itself
-- is still tenant-blind and still wants fixing at the call site; that is
-- T1-PEOPLE's (`email/outbox.ts`, `scheduled.ts`), and with this index in place
-- their change is an improvement rather than the only thing standing between two
-- customers and a lost digest.
--
-- ── WHAT IS DELIBERATELY NOT TOUCHED ────────────────────────────────────────
-- Eight indexes on tenant-owned tables lead with a selective id or status instead
-- of `edition`: `idx_audit_log_deck (deck_id, …)`, `idx_decks_program`,
-- `idx_decks_cohort`, `idx_decks_pending_ai (status, created_at)`,
-- `idx_credit_ledger_deck`, `idx_notifications_user (user_id, …)`,
-- `idx_crm_sync_log_conn (connection_id, …)` and `idx_resubmit_tokens_deck`.
-- Putting `tenant_id` in front of a `deck_id` or a `user_id` would make them
-- WORSE: the id already narrows to a handful of rows and the tenant is implied by
-- it. `idx_decks_pending_ai` is the cron's scan across all customers and must stay
-- that way. Re-cutting all 21 and leaving these eight alone is the measured
-- answer, not a shortcut.
--
-- Every statement is DROP-then-CREATE with `IF EXISTS` / `IF NOT EXISTS`, so the
-- file is re-executable — the property `test/worker/migrations-w1b.test.ts` holds
-- the tree to.

-- ── 13 non-unique, `edition`-leading ────────────────────────────────────────
DROP INDEX IF EXISTS idx_decks_edition_status;
CREATE INDEX IF NOT EXISTS idx_decks_edition_status ON decks (tenant_id, edition, status);

DROP INDEX IF EXISTS idx_audit_log_recent;
CREATE INDEX IF NOT EXISTS idx_audit_log_recent ON audit_log (tenant_id, edition, created_at DESC);

DROP INDEX IF EXISTS idx_audit_log_category;
CREATE INDEX IF NOT EXISTS idx_audit_log_category ON audit_log (tenant_id, edition, category, created_at DESC);

DROP INDEX IF EXISTS idx_audit_log_actor;
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log (tenant_id, edition, actor_id, created_at DESC);

DROP INDEX IF EXISTS idx_tickets_edition_category;
CREATE INDEX IF NOT EXISTS idx_tickets_edition_category ON tickets (tenant_id, edition, category, status);

DROP INDEX IF EXISTS idx_parameters_edition;
CREATE INDEX IF NOT EXISTS idx_parameters_edition ON parameters (tenant_id, edition, active);

DROP INDEX IF EXISTS idx_programs_edition;
CREATE INDEX IF NOT EXISTS idx_programs_edition ON programs (tenant_id, edition, active);

DROP INDEX IF EXISTS idx_sectors_edition;
CREATE INDEX IF NOT EXISTS idx_sectors_edition ON sectors (tenant_id, edition, active);

DROP INDEX IF EXISTS idx_required_documents;
CREATE INDEX IF NOT EXISTS idx_required_documents ON required_documents (tenant_id, edition, program_id, sort_order);

DROP INDEX IF EXISTS idx_account_orders_recent;
CREATE INDEX IF NOT EXISTS idx_account_orders_recent ON account_orders (tenant_id, edition, created_at DESC);

DROP INDEX IF EXISTS idx_credit_ledger_recent;
CREATE INDEX IF NOT EXISTS idx_credit_ledger_recent ON credit_ledger (tenant_id, edition, created_at DESC);

DROP INDEX IF EXISTS idx_billing_intents_recent;
CREATE INDEX IF NOT EXISTS idx_billing_intents_recent ON billing_payment_intents (tenant_id, edition, created_at DESC);

DROP INDEX IF EXISTS idx_seat_grants_capacity;
CREATE INDEX IF NOT EXISTS idx_seat_grants_capacity ON seat_grants (tenant_id, edition, tier, status);

-- ── 5 unique, `edition`-leading. These are CONSTRAINTS, so the re-cut is what
--    lets two customers hold the same key — the partial `WHERE` clauses are
--    preserved exactly, because they are what make the constraint conditional on
--    a row being live / a default / user-specific. ────────────────────────────
DROP INDEX IF EXISTS idx_parameters_edition_key_active;
CREATE UNIQUE INDEX IF NOT EXISTS idx_parameters_edition_key_active
  ON parameters (tenant_id, edition, key) WHERE active = 1;

-- `authorised_signatories`' two partial uniques are NOT dropped, and that is the
-- same transitional decision the five PK rebuilds take (see
-- `0091_role_permissions_tenant_rebuild.sql`'s header for the full argument).
-- `esign/store.ts:379` and `:393` use them as `ON CONFLICT` targets, complete with
-- the `WHERE` clause a partial-index target requires, and widening those two
-- upserts is T1-ESIGN's work in a file T0 does not own. The tenant-scoped pair is
-- ADDED beside them under new names; integration drops the old pair from the
-- declared headroom once those two upserts name the widened key.
CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_sig_role_tenant
  ON authorised_signatories (tenant_id, edition, role) WHERE role IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_sig_user_tenant
  ON authorised_signatories (tenant_id, edition, user_id) WHERE user_id IS NOT NULL;

DROP INDEX IF EXISTS idx_notif_pref_default;
CREATE UNIQUE INDEX IF NOT EXISTS idx_notif_pref_default
  ON notification_preferences (tenant_id, edition, event_key, channel) WHERE user_id IS NULL;

DROP INDEX IF EXISTS idx_notif_pref_user;
CREATE UNIQUE INDEX IF NOT EXISTS idx_notif_pref_user
  ON notification_preferences (tenant_id, edition, user_id, event_key, channel) WHERE user_id IS NOT NULL;

-- ── The 19th: the tenant-blind dedupe key. See the header. ───────────────────
DROP INDEX IF EXISTS idx_notifications_dedupe;
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe
  ON notifications (tenant_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
