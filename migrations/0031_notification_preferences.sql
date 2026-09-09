-- W1-B · migration 7 of 13 (0025 – 0037).
--
-- Admin console → System → **Notifications** (`admin/s-nt.html`): "Control
-- which platform events trigger email and in-app alerts for your account."
--
-- The prototype shows one column of email toggles for the signed-in user. The
-- section title names two channels, so the model is event × channel ×
-- recipient:
--
--   • `event_key` — the ten events, in the prototype's order. One is renamed
--     per edition ("Jury member submitted scores" / "IC member submitted
--     scores"), which is why the row carries an edition.
--   • `channel`   — 'email' | 'in_app'.
--   • `user_id`   — the recipient. **NULL is the workspace default** every user
--     inherits until they toggle their own; a per-user row overrides it. That
--     is what lets an admin set a policy and a user still opt out.
--
-- Seed: the workspace defaults for both editions and both channels, matching
-- the prototype's ON/OFF state exactly (eight on, two off — "Startup responded
-- to clarification questions" and "New team member accepted invite"). In-app
-- mirrors email, because the prototype's bell shows every event it renders.
--
-- W3-B owns the producers. Note that only one of the ten events has a producer
-- today; email still obeys the `EMAIL_FROM` gate and records to `email_outbox`.

CREATE TABLE IF NOT EXISTS notification_preferences (
  id         TEXT PRIMARY KEY,
  edition    TEXT NOT NULL CHECK (edition IN ('incubator', 'vc')),
  -- NULL = the workspace default for this event × channel.
  user_id    TEXT REFERENCES users (id) ON DELETE CASCADE,
  event_key  TEXT NOT NULL,
  channel    TEXT NOT NULL CHECK (channel IN ('email', 'in_app')),
  enabled    INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- One row per (edition, recipient, event, channel). Two partial uniques because
-- SQLite treats every NULL as distinct, so a plain UNIQUE would let the
-- workspace default be inserted twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_notif_pref_user
  ON notification_preferences (edition, user_id, event_key, channel) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_notif_pref_default
  ON notification_preferences (edition, event_key, channel) WHERE user_id IS NULL;

INSERT INTO notification_preferences (id, edition, user_id, event_key, channel, enabled) VALUES
  ('np_inc_deck_submitted_email',              'incubator', NULL, 'deck_submitted',             'email',  1),
  ('np_inc_deck_submitted_inapp',              'incubator', NULL, 'deck_submitted',             'in_app', 1),
  ('np_inc_ai_scoring_complete_email',         'incubator', NULL, 'ai_scoring_complete',        'email',  1),
  ('np_inc_ai_scoring_complete_inapp',         'incubator', NULL, 'ai_scoring_complete',        'in_app', 1),
  ('np_inc_evaluator_scores_submitted_email',  'incubator', NULL, 'evaluator_scores_submitted', 'email',  1),
  ('np_inc_evaluator_scores_submitted_inapp',  'incubator', NULL, 'evaluator_scores_submitted', 'in_app', 1),
  ('np_inc_all_evaluations_complete_email',    'incubator', NULL, 'all_evaluations_complete',   'email',  1),
  ('np_inc_all_evaluations_complete_inapp',    'incubator', NULL, 'all_evaluations_complete',   'in_app', 1),
  ('np_inc_founder_responded_email',           'incubator', NULL, 'founder_responded',          'email',  0),
  ('np_inc_founder_responded_inapp',           'incubator', NULL, 'founder_responded',          'in_app', 0),
  ('np_inc_intro_call_scheduled_email',        'incubator', NULL, 'intro_call_scheduled',       'email',  1),
  ('np_inc_intro_call_scheduled_inapp',        'incubator', NULL, 'intro_call_scheduled',       'in_app', 1),
  ('np_inc_credits_low_email',                 'incubator', NULL, 'credits_low',                'email',  1),
  ('np_inc_credits_low_inapp',                 'incubator', NULL, 'credits_low',                'in_app', 1),
  ('np_inc_crm_sync_failed_email',             'incubator', NULL, 'crm_sync_failed',            'email',  1),
  ('np_inc_crm_sync_failed_inapp',             'incubator', NULL, 'crm_sync_failed',            'in_app', 1),
  ('np_inc_invite_accepted_email',             'incubator', NULL, 'invite_accepted',            'email',  0),
  ('np_inc_invite_accepted_inapp',             'incubator', NULL, 'invite_accepted',            'in_app', 0),
  ('np_inc_monthly_usage_summary_email',       'incubator', NULL, 'monthly_usage_summary',      'email',  1),
  ('np_inc_monthly_usage_summary_inapp',       'incubator', NULL, 'monthly_usage_summary',      'in_app', 1),
  ('np_vc_deck_submitted_email',               'vc',        NULL, 'deck_submitted',             'email',  1),
  ('np_vc_deck_submitted_inapp',               'vc',        NULL, 'deck_submitted',             'in_app', 1),
  ('np_vc_ai_scoring_complete_email',          'vc',        NULL, 'ai_scoring_complete',        'email',  1),
  ('np_vc_ai_scoring_complete_inapp',          'vc',        NULL, 'ai_scoring_complete',        'in_app', 1),
  ('np_vc_evaluator_scores_submitted_email',   'vc',        NULL, 'evaluator_scores_submitted', 'email',  1),
  ('np_vc_evaluator_scores_submitted_inapp',   'vc',        NULL, 'evaluator_scores_submitted', 'in_app', 1),
  ('np_vc_all_evaluations_complete_email',     'vc',        NULL, 'all_evaluations_complete',   'email',  1),
  ('np_vc_all_evaluations_complete_inapp',     'vc',        NULL, 'all_evaluations_complete',   'in_app', 1),
  ('np_vc_founder_responded_email',            'vc',        NULL, 'founder_responded',          'email',  0),
  ('np_vc_founder_responded_inapp',            'vc',        NULL, 'founder_responded',          'in_app', 0),
  ('np_vc_intro_call_scheduled_email',         'vc',        NULL, 'intro_call_scheduled',       'email',  1),
  ('np_vc_intro_call_scheduled_inapp',         'vc',        NULL, 'intro_call_scheduled',       'in_app', 1),
  ('np_vc_credits_low_email',                  'vc',        NULL, 'credits_low',                'email',  1),
  ('np_vc_credits_low_inapp',                  'vc',        NULL, 'credits_low',                'in_app', 1),
  ('np_vc_crm_sync_failed_email',              'vc',        NULL, 'crm_sync_failed',            'email',  1),
  ('np_vc_crm_sync_failed_inapp',              'vc',        NULL, 'crm_sync_failed',            'in_app', 1),
  ('np_vc_invite_accepted_email',              'vc',        NULL, 'invite_accepted',            'email',  0),
  ('np_vc_invite_accepted_inapp',              'vc',        NULL, 'invite_accepted',            'in_app', 0),
  ('np_vc_monthly_usage_summary_email',        'vc',        NULL, 'monthly_usage_summary',      'email',  1),
  ('np_vc_monthly_usage_summary_inapp',        'vc',        NULL, 'monthly_usage_summary',      'in_app', 1)
ON CONFLICT (id) DO NOTHING;
