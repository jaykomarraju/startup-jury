-- Aug-2026 issue log — items 29, 30 and 31 need real state behind the columns
-- the design asks for:
--
--  • 29 (Sign up Pipeline)  — Payment status and Documents status per startup.
--  • 30 (Onboard ready)     — Curation stage, jury-member lead and progress.
--  • 31 (Archive)           — reason / stage reached / archived on / archived by
--                             already exist in `pipeline_events`, so nothing new
--                             is needed there; the "restore back into the
--                             workflow" action is added to the pipeline config.
--
-- One row per deck, created lazily the first time someone records onboarding
-- state. Absent row = everything pending / not started.
CREATE TABLE deck_onboarding (
  deck_id          TEXT PRIMARY KEY REFERENCES decks (id) ON DELETE CASCADE,
  payment_status   TEXT NOT NULL DEFAULT 'pending'
                     CHECK (payment_status IN ('pending', 'partial', 'paid', 'waived')),
  documents_status TEXT NOT NULL DEFAULT 'pending'
                     CHECK (documents_status IN ('pending', 'partial', 'complete')),
  -- Free text: whatever the programme calls this point of the curation journey
  -- (Orientation, Mentor matching, Milestone review, Demo-day prep…).
  curation_stage   TEXT,
  progress         INTEGER NOT NULL DEFAULT 0,
  -- The jury member / mentor leading this startup through the cohort.
  lead_user_id     TEXT REFERENCES users (id),
  notes            TEXT,
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by       TEXT REFERENCES users (id)
);

-- Demo state so the Sign up Pipeline and Onboard ready screens are populated on
-- the seeded workspace.
INSERT INTO deck_onboarding (deck_id, payment_status, documents_status, curation_stage, progress, lead_user_id)
SELECT id,
       CASE WHEN status = 'onboard_ready' THEN 'paid' ELSE 'partial' END,
       CASE WHEN status = 'onboard_ready' THEN 'complete' ELSE 'pending' END,
       CASE WHEN status = 'onboard_ready' THEN 'Orientation' ELSE NULL END,
       CASE WHEN status = 'onboard_ready' THEN 25 ELSE 0 END,
       CASE WHEN edition = 'incubator' THEN 'inc_jury' ELSE NULL END
FROM decks
WHERE status IN ('signup', 'onboard_ready');
