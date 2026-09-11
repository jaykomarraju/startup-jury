-- W3-C · migration 0042 (the only number this session owns; Wave 3's
-- allotment is 0040 W3-A · 0041 W3-B · 0042 W3-C · 0043 W3-D).
--
-- `0030` created `audit_log` and seeded the prototype's ten rows. Nothing has
-- ever written to it. This migration adds the two things the Admin console →
-- System → **Audit log** section needs that the table did not carry:
--
--   1. A RETENTION WINDOW. `org_settings.audit_retention_days` is NULL by
--      default — keep everything, which is the only safe default for a trail
--      whose purpose is to answer "who changed this?" long after the fact.
--      A non-NULL value is a deliberate act and is floored at 30 days
--      (`MIN_AUDIT_RETENTION_DAYS`, `src/shared/audit.ts`).
--
--   2. An ACTOR index. The section filters by actor, and `0030` indexed only
--      (edition, created_at), (edition, category, created_at) and (deck_id).
--
-- Deliberately NOT here: a backfill of `pipeline_events` into `audit_log`.
-- `0030`'s own header asks for the deck trail to be folded in "as one filtered
-- view … rather than forked", and copying rows would fork it — two tables
-- holding the same event, drifting the moment one of them is written without
-- the other. `listAudit()` (`src/server/audit/log.ts`) reads the union instead,
-- which is what makes the All-decks Activity card and this section the same
-- store rather than two sources of truth.

ALTER TABLE org_settings ADD COLUMN audit_retention_days INTEGER;

CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log (edition, actor_id, created_at DESC);
