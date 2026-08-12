-- Session 6 — Incomplete-deck resubmit loop + real email.
--
-- Two additive concerns (FINISH-PLAN §4 Session 6, §8 Jul-24 demo):
--
--   1. resubmit_tokens — the tokenized link a founder receives when their deck
--      lands `status='incomplete'`. The link is the ONLY credential: it opens a
--      public (unauthenticated) page listing the missing intake fields + the
--      deck sections the extraction flagged absent, with a re-upload control.
--      Only a SHA-256 hash of the token is stored, so a database leak cannot be
--      replayed as a working link (same reasoning as users.password_hash).
--      One live token per deck: minting a new one revokes the deck's earlier
--      tokens, so an old email stops working once a newer one goes out.
--
--   2. email_outbox gains real-delivery columns. Delivery is no longer stubbed —
--      `sendEmail` now calls the Cloudflare Email Sending binding when one is
--      configured, and the outbox stays as the audit log:
--        status 'sent'     — accepted by Cloudflare Email Sending
--               'failed'   — the send was attempted and threw (see `error`)
--               'recorded' — no email binding/from address configured, so the
--                            message was audited only (the pre-Session-6 stub
--                            behaviour, kept so local dev + tests still work)
--      `dedupe_key` makes a notification idempotent: `evaluateDeck` re-runs on
--      the same deck content must not re-email the founder, but a NEW version
--      that is still incomplete must. The key carries the content version, so
--      that distinction falls out for free. NULLs are distinct in SQLite, so a
--      plain UNIQUE index leaves every un-keyed message unaffected.

-- ── 1. Tokenized founder resubmit links ──────────────────────────────────────
CREATE TABLE resubmit_tokens (
  id          TEXT PRIMARY KEY,
  deck_id     TEXT NOT NULL REFERENCES decks (id) ON DELETE CASCADE,
  edition     TEXT NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,   -- SHA-256 hex of the raw token; never the token itself
  to_email    TEXT,                   -- who the link was issued to (audit only)
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL,
  used_at     TEXT,                   -- last successful re-upload through this link
  use_count   INTEGER NOT NULL DEFAULT 0,
  revoked     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_resubmit_tokens_deck ON resubmit_tokens (deck_id, created_at);

-- ── 2. Real-delivery columns on the outbox ───────────────────────────────────
ALTER TABLE email_outbox ADD COLUMN error       TEXT;
ALTER TABLE email_outbox ADD COLUMN provider_id TEXT;
ALTER TABLE email_outbox ADD COLUMN dedupe_key  TEXT;

CREATE UNIQUE INDEX idx_outbox_dedupe ON email_outbox (dedupe_key);

-- Existing rows predate real delivery: they were audited, never dispatched.
UPDATE email_outbox SET status = 'recorded' WHERE status = 'sent';

-- ── Demo seed ────────────────────────────────────────────────────────────────
-- NimbusHR (inc_deck_meera_incomplete) is the canonical Incomplete fixture: a
-- real founder account, a known contact email, exactly one missing field
-- (founderPhone — 0016). Seeding its link makes the whole resubmit loop
-- demoable without first spending a credit on a live AI run.
--
-- The token below is a FIXED DEMO VALUE, deliberately readable, on a deck in the
-- publicly-documented demo seed (see HANDOFF "Demo access decision"). It is not
-- a secret and grants nothing beyond that one demo deck. Real tokens are 192
-- bits of CSPRNG entropy — see newResubmitToken() in src/server/resubmit.ts.
--
--   Link:  /resubmit/aisj-demo-nimbushr-resubmit-2026
--   Hash:  SHA-256 of that string.
--
-- Expiry is far out so the demo doesn't rot; a real token lives 30 days.
INSERT INTO resubmit_tokens (id, deck_id, edition, token_hash, to_email, created_at, expires_at) VALUES
  ('rst_seed_nimbus', 'inc_deck_meera_incomplete', 'incubator',
   'a2405fe1d8df4d8a880f9329926264dd97f50ed2378d58e1ee313b46e22cc3db',
   'meera.sharma@demo.startupjury.ai', '2026-08-12T00:00:00Z', '2030-01-01T00:00:00Z');

-- The notification that carried that link, so the outbox shows the real shape.
-- 'recorded' because the demo Worker has no verified sending domain yet.
INSERT INTO email_outbox (id, deck_id, kind, to_email, to_name, subject, body, status, created_at, dedupe_key) VALUES
  ('mail_seed_nimbus_incomplete', 'inc_deck_meera_incomplete', 'incomplete_resubmit',
   'meera.sharma@demo.startupjury.ai', 'Meera Sharma',
   'Action needed: NimbusHR is incomplete',
   'Hi Meera,' || char(10) || char(10) ||
   'Thanks for submitting NimbusHR to the programme. Our review flagged it as **Incomplete** — a few things we need are missing, so it can''t go to the evaluation panel yet.' || char(10) || char(10) ||
   '  • Contact details we could not find: Phone.' || char(10) || char(10) ||
   'Open the secure link below to see exactly what''s missing, update those sections in your deck, and upload the new version. We''ll re-score it automatically and put it back in front of the evaluators — you don''t need to send anything else.' || char(10) || char(10) ||
   'https://startup-jury.jay-komarraju.workers.dev/resubmit/aisj-demo-nimbushr-resubmit-2026' || char(10) || char(10) ||
   'The link is personal to this submission, so please don''t forward it.' || char(10) || char(10) ||
   '— The ai.STARTUPJURY team',
   'recorded', '2026-08-12T00:00:00Z', 'incomplete:inc_deck_meera_incomplete:v1');

-- NB no `deck_versions` row is seeded for NimbusHR: it has no R2 object (the
-- 0016 v1 backfill skipped it for exactly that reason), and a version row
-- pointing at a file that doesn't exist would be a lie in the audit trail. The
-- founder page simply hides the history section until a real upload lands.
