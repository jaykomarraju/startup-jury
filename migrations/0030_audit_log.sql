-- W1-B · migration 6 of 13 (0025 – 0037).
--
-- Admin console → System → **Audit log** (`admin/s-al.html`): "Full timestamped
-- trail of all configuration changes, score overrides, team actions, and
-- billing events."
--
-- Today the only append-only trail is `pipeline_events`, and every row there is
-- NOT NULL on `deck_id` — so a threshold change, an invite or a credit purchase
-- has nowhere to go. Two things make this table able to hold them:
--
--   • `deck_id` is NULLABLE, and
--   • `category` carries the prototype's badge (Config · Score · Team ·
--     Billing), widened with `pipeline` and `security` so the existing deck
--     trail can be folded in as one filtered view (W3-C) rather than forked.
--
-- `actor_label` is denormalised on purpose: the prototype renders "Rajan S."
-- next to every row, and an audit trail must stay readable after the user it
-- names is deleted. `detail_json` holds the before/after an override or a
-- weight change needs, without a column per event type.

CREATE TABLE IF NOT EXISTS audit_log (
  id           TEXT PRIMARY KEY,
  edition      TEXT NOT NULL CHECK (edition IN ('incubator', 'vc')),
  category     TEXT NOT NULL CHECK (category IN ('config', 'score', 'team', 'billing', 'pipeline', 'security')),
  actor_id     TEXT REFERENCES users (id) ON DELETE SET NULL,
  actor_label  TEXT,
  -- Machine-readable verb, e.g. 'threshold_changed', 'user_invited'.
  action       TEXT NOT NULL,
  -- The human sentence the log row renders.
  summary      TEXT NOT NULL,
  detail_json  TEXT,
  deck_id      TEXT REFERENCES decks (id) ON DELETE SET NULL,
  -- What was acted on when it is not a deck: 'parameter', 'user', 'permission'…
  target_type  TEXT,
  target_id    TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_log_recent   ON audit_log (edition, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_category ON audit_log (edition, category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_deck     ON audit_log (deck_id, created_at DESC);

-- ── Demo trail, transcribed from the ten rows on `s-al.html` ────────────────
-- Four categories, and eight of the ten with no deck at all — which is the
-- point of the table. Actors are mapped onto this workspace's own seeded users;
-- the prototype's "Rajan S." has no counterpart here.
INSERT INTO audit_log (id, edition, category, actor_id, actor_label, action, summary, deck_id, target_type, target_id, created_at) VALUES
  ('aud_0001', 'incubator', 'config',  'inc_admin', 'Nisha K.', 'crm_rule_updated',
   'Updated Salesforce filter rule trigger value to "Submitted for evaluation"', NULL, 'crm_connection', 'crm_inc_salesforce', '2026-06-04 11:42:00'),
  ('aud_0002', 'incubator', 'score',   'inc_superuser', 'Priya S.', 'score_overridden',
   'Override: Traction score for GreenRoute changed 6.2 → 8.1. Reason: "Pilot data confirmed but not captured by AI text extraction"',
   'inc_deck_greenroute', 'parameter', 'inc_traction_validation', '2026-06-04 10:15:00'),
  ('aud_0003', 'incubator', 'team',    'inc_admin', 'Nisha K.', 'user_invited',
   'Invited Sunita Rao (sunita.rao@demo.startupjury.ai) as Program associate · Standard plan', NULL, 'user', 'inc_pa', '2026-06-04 09:48:00'),
  ('aud_0004', 'incubator', 'config',  'inc_admin', 'Nisha K.', 'area_weights_updated',
   'Area weight updated: Team & execution 10% → 12%, Business model 8% → 6%', NULL, 'parameter', NULL, '2026-06-04 09:02:00'),
  ('aud_0005', 'incubator', 'config',  'inc_admin', 'Nisha K.', 'threshold_changed',
   'Shortlist threshold changed from 6.5 to 7.0', NULL, 'org_scoring_settings', 'incubator', '2026-06-04 08:34:00'),
  ('aud_0006', 'incubator', 'billing', 'inc_admin', 'Nisha K.', 'credits_purchased',
   'Purchased 50-credit pack · ₹20,000 · Transaction ID: RZP250603112244', NULL, 'credit_ledger', NULL, '2026-06-03 16:20:00'),
  ('aud_0007', 'incubator', 'score',   'inc_jury', 'Rajesh K.', 'score_overridden',
   'Override: Problem score for FinStack changed 5.8 → 7.2. Reason: "Page 3 shows validated research not picked up by AI"',
   'inc_deck_finstack', 'parameter', 'inc_problem_market_clarity', '2026-06-03 14:05:00'),
  ('aud_0008', 'incubator', 'config',  'inc_admin', 'Nisha K.', 'rubric_anchor_updated',
   'Rubric anchor updated for Traction & validation — 7–8 band text revised', NULL, 'parameter', 'inc_traction_validation', '2026-06-03 11:10:00'),
  ('aud_0009', 'incubator', 'config',  'inc_pm', 'Raj K.', 'blind_scoring_toggled',
   'AI score visibility toggled OFF for jury — blind evaluation mode enabled', NULL, 'org_scoring_settings', 'incubator', '2026-06-03 10:02:00'),
  ('aud_0010', 'incubator', 'config',  'inc_admin', 'Nisha K.', 'crm_writeback_enabled',
   'CRM sync write-back enabled — AI scores now syncing to Salesforce field AI_Score__c', NULL, 'crm_connection', 'crm_inc_salesforce', '2026-06-02 15:30:00')
ON CONFLICT (id) DO NOTHING;
