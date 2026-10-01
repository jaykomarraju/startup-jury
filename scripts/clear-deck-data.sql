-- Empty every deck and everything a deck owns, so the dashboard shows none.
--
-- Run against a chosen database, deliberately:
--   npx wrangler d1 execute startup-jury-db --remote --file=scripts/clear-deck-data.sql
--
-- ── SCOPE, AND WHERE IT COMES FROM ──────────────────────────────────────────
-- The table list is `TENANT_OWNER` in `src/shared/tenant.ts`, which is the
-- schema's authoritative answer to "what owns this table?". Deepest path first,
-- so a child is never orphaned by its parent going away:
--
--   signatures -> agreements -> signups -> decks        (three hops, the deepest)
--
-- ── WHAT IS DELIBERATELY NOT TOUCHED ────────────────────────────────────────
-- users · organizations · programs · cohorts · parameters · the rubric ·
-- role_permissions · score_visibility · seat_capabilities · pricing ·
-- account_profiles · billing_subscriptions · billing_invoices · agreement
-- TEMPLATES (as opposed to signed agreements) · crm_connections.
--
-- Those are the workspace's own configuration and commercial record. A deck is a
-- submission; none of them is.
--
-- ── THE FIVE MIXED TABLES AT THE END ────────────────────────────────────────
-- `audit_log`, `email_outbox`, `credit_ledger`, `notifications` and
-- `crm_sync_log` carry a NULLABLE `deck_id` and hold rows that have nothing to do
-- with any deck — a user invite, a role change, a billing notification, a CRM
-- sync of a contact. Those are filtered on `deck_id IS NOT NULL` so the account
-- keeps its own history instead of losing it alongside the decks. Deleting them
-- outright would erase the record of who was invited and who changed whose role,
-- which is the audit trail, not deck data.
--
-- ── R2 IS NOT TOUCHED ───────────────────────────────────────────────────────
-- The deck PDFs live in the `startup-jury-decks` R2 bucket, outside D1. They are
-- left in place on purpose: D1 time-travel can restore these rows, and a restore
-- is only useful if the files the rows point at are still there.

-- ── three hops ──────────────────────────────────────────────────────────────
DELETE FROM signatures;

-- ── two hops ────────────────────────────────────────────────────────────────
DELETE FROM agreements;
DELETE FROM signup_documents;
DELETE FROM call_participants;

-- ── one hop ─────────────────────────────────────────────────────────────────
DELETE FROM signups;
DELETE FROM call_outcomes;
DELETE FROM call_schedulers;
DELETE FROM calls;
DELETE FROM scores;
DELETE FROM evaluations;
DELETE FROM evaluation_recommendations;
DELETE FROM dd_items;
DELETE FROM ic_votes;
DELETE FROM investment_dd;
DELETE FROM legal_dd;
DELETE FROM term_sheets;
DELETE FROM vc_deals;
DELETE FROM portfolio;
DELETE FROM deck_assignments;
DELETE FROM deck_extractions;
DELETE FROM deck_onboarding;
DELETE FROM deck_versions;
DELETE FROM pipeline_events;
DELETE FROM queries;
DELETE FROM resubmit_tokens;

-- ── mixed: only the rows that are ABOUT a deck ──────────────────────────────
DELETE FROM audit_log      WHERE deck_id IS NOT NULL;
DELETE FROM email_outbox   WHERE deck_id IS NOT NULL;
DELETE FROM credit_ledger  WHERE deck_id IS NOT NULL;
DELETE FROM notifications  WHERE deck_id IS NOT NULL;
DELETE FROM crm_sync_log   WHERE deck_id IS NOT NULL;

-- ── and the decks themselves ────────────────────────────────────────────────
DELETE FROM decks;
