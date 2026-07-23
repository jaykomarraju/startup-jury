-- Phase 4: stubbed email outbox. Real outbound email (Cloudflare Email Sending)
-- lands in Phase 7+; until then the founder-query loop and signup invites record
-- a row here instead of dispatching. Every "sent" message is auditable.
CREATE TABLE email_outbox (
  id           TEXT PRIMARY KEY,
  deck_id      TEXT REFERENCES decks (id) ON DELETE CASCADE,
  query_id     TEXT REFERENCES queries (id) ON DELETE SET NULL,
  kind         TEXT NOT NULL,                       -- 'founder_query' | 'signup_invite'
  to_email     TEXT NOT NULL,
  to_name      TEXT,
  subject      TEXT NOT NULL,
  body         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'sent',        -- stub always 'sent'
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_outbox_deck ON email_outbox (deck_id, created_at);
