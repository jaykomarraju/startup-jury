-- W3-B · migration 0041 (the number this session is allotted, §10). It adds
-- nothing to `notification_preferences` — `0031` already models
-- event × channel × recipient and seeds the prototype's 8-on/2-off mask. What
-- is missing is the OTHER half of the channel pair the section's sub-line
-- promises ("email and in-app alerts"), and one column a producer needs.
--
-- 1. `notifications` — the in-app channel. `_topnav.html` carries a `.nb` bell
--    in every one of the eleven prototypes, and it is inert there: no dropdown
--    markup, so the panel's contents are unspecified (F0058). This is the
--    minimum a notification centre needs and no more — one row per recipient
--    per event, a deep link, and a read stamp.
--
--    `dedupe_key` mirrors `email_outbox`'s: a producer that can legitimately
--    re-run (a queue retry, a re-score, an idempotent score re-submit) must not
--    stack duplicates in someone's bell. The UNIQUE index is what closes the
--    concurrent-run race a read-then-write check would leave open, which is
--    why the emitter inserts with OR IGNORE and reads `meta.changes` back.
--
-- 2. `users.invite_accepted_at` — the producer for "New team member accepted
--    invite". `account_invite` is the OUTBOUND invite; nothing recorded the
--    acceptance, which is why that event had no trigger (F0016) and why `W1-C`
--    asked for this column in §9. It is stamped on the invitee's first
--    successful sign-in. Every user that exists today is backfilled as already
--    accepted, so turning this on does not fire an alert for all thirty-odd
--    seeded demo logins the next time they sign in.
--
-- 3. An index for the delivery log the Notifications section renders (F0144):
--    `email_outbox` is indexed by deck, and that view reads by recency.

CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  edition    TEXT NOT NULL CHECK (edition IN ('incubator', 'vc')),
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  event_key  TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  -- In-app deep link, e.g. `/app/decks/inc_deck_greenroute`. Never external.
  link       TEXT,
  deck_id    TEXT REFERENCES decks (id) ON DELETE SET NULL,
  read_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  dedupe_key TEXT
);

CREATE INDEX IF NOT EXISTS idx_notifications_user
  ON notifications (user_id, created_at DESC);
-- Partial: SQLite treats every NULL as distinct, so an un-keyed notification
-- must not be constrained by this at all.
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe
  ON notifications (dedupe_key) WHERE dedupe_key IS NOT NULL;

ALTER TABLE users ADD COLUMN invite_accepted_at TEXT;
UPDATE users SET invite_accepted_at = created_at WHERE invite_accepted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_outbox_recent ON email_outbox (created_at DESC);
