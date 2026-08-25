-- Aug-2026 issue 8 (Activity log), 25 (Assigned date) and 31 (Archive's Reason /
-- Stage reached / Archived on / Archived by).
--
-- The incubator seed placed every deck at its final stage but recorded no
-- `pipeline_events`, so the new screens had nothing real to show. This backfills
-- a consistent history for the seeded incubator decks — the same rows the app
-- writes itself on every transition, so nothing here is special-cased in code.

INSERT INTO pipeline_events (id, deck_id, actor_id, from_stage, to_stage, action, note, created_at) VALUES
  -- AI evaluations
  ('ie_finstack_ai',    'inc_deck_finstack',    NULL,       'pending_ai',      'ai_evaluated',    'ai_evaluated', 'AI weighted total 7.80 · advanced', '2026-08-18T09:05:00Z'),
  ('ie_greengrid_ai',   'inc_deck_greengrid',   NULL,       'pending_ai',      'ai_evaluated',    'ai_evaluated', 'AI weighted total 8.10 · advanced', '2026-08-18T09:12:00Z'),
  ('ie_payroute_ai',    'inc_deck_payroute',    NULL,       'pending_ai',      'incomplete',      'ai_evaluated', 'AI evaluation · incomplete — missing founder details', '2026-08-18T09:20:00Z'),
  ('ie_nimbus_ai',      'inc_deck_meera_incomplete', NULL,  'pending_ai',      'incomplete',      'ai_evaluated', 'AI evaluation · incomplete — missing founder details', '2026-08-18T09:24:00Z'),

  -- Assignments
  ('ie_taxpilot_as',    'inc_deck_taxpilot',    'inc_pa',   'ai_evaluated',    'assigned',        'assign_jury',  'Assigned to Rajesh Kumar', '2026-08-19T06:30:00Z'),
  ('ie_insureflow_as',  'inc_deck_insureflow',  'inc_pa',   'ai_evaluated',    'assigned',        'assign_jury',  'Assigned to Rajesh Kumar', '2026-08-19T06:32:00Z'),
  ('ie_wealthos_as',    'inc_deck_wealthosi',   'inc_pa',   'ai_evaluated',    'assigned',        'assign_jury',  'Assigned to Rajesh Kumar', '2026-08-19T06:35:00Z'),
  ('ie_greenroute_as',  'inc_deck_greenroute',  'inc_pa',   'ai_evaluated',    'assigned',        'assign_jury',  'Assigned to Rajesh Kumar', '2026-08-17T06:35:00Z'),
  ('ie_agrofresh_as',   'inc_deck_agrofresh',   'inc_pa',   'ai_evaluated',    'assigned',        'assign_jury',  'Assigned to Rajesh Kumar', '2026-08-17T06:40:00Z'),
  ('ie_edulift_as',     'inc_deck_edulift',     'inc_pa',   'ai_evaluated',    'assigned',        'assign_jury',  'Assigned to Rajesh Kumar', '2026-08-14T06:40:00Z'),
  ('ie_medixir_as',     'inc_deck_medixir',     'inc_pa',   'ai_evaluated',    'assigned',        'assign_jury',  'Assigned to Rajesh Kumar', '2026-08-10T06:40:00Z'),

  -- Jury evaluation started
  ('ie_insureflow_ev',  'inc_deck_insureflow',  'inc_jury', 'assigned',        'jury_evaluation', 'start_jury_eval', 'Jury evaluation begun', '2026-08-20T05:10:00Z'),
  ('ie_wealthos_ev',    'inc_deck_wealthosi',   'inc_jury', 'assigned',        'jury_evaluation', 'start_jury_eval', 'Jury evaluation begun', '2026-08-20T05:14:00Z'),

  -- Decisions
  ('ie_greenroute_sl',  'inc_deck_greenroute',  'inc_jury', 'jury_evaluation', 'shortlisted',     'shortlist',    'Shortlisted by the jury', '2026-08-21T07:00:00Z'),
  ('ie_agrofresh_sl',   'inc_deck_agrofresh',   'inc_jury', 'jury_evaluation', 'shortlisted',     'shortlist',    'Shortlisted by the jury', '2026-08-21T07:05:00Z'),
  ('ie_creditbri_rj',   'inc_deck_creditbri',   'inc_jury', 'jury_evaluation', 'rejected',        'reject',       'Traction and unit economics below the cohort bar', '2026-08-21T07:15:00Z'),
  ('ie_solarc_rj',      'inc_deck_solarc',      'inc_pm',   'ai_evaluated',    'rejected',        'reject_ai_gate', 'Below the AI gate', '2026-08-12T07:20:00Z'),
  ('ie_solarc_ar',      'inc_deck_solarc',      'inc_pm',   'rejected',        'archived',        'archive',      'Archived after the cohort closed', '2026-08-13T07:25:00Z'),

  -- Onboarding path
  ('ie_edulift_in',     'inc_deck_edulift',     'inc_pm',   'shortlisted',     'intro',           'schedule_intro', 'Intro call scheduled', '2026-08-22T04:30:00Z'),
  ('ie_ledgerlite_su',  'inc_deck_meera_signup','inc_pa',   'intro',           'signup',          'send_signup',  'Sign-up invite sent', '2026-08-23T04:40:00Z'),
  ('ie_medixir_ob',     'inc_deck_medixir',     'inc_admin','signup',          'onboard_ready',   'complete_signup', 'Sign-up complete — ready to onboard', '2026-08-24T04:50:00Z');

-- Aug-2026 issue 6 — the All-decks table is now Startup · Founder name · Email
-- ID · Phone · City · Sector · Status, and issues 16/17 key the Query screen off
-- the same columns. The seeded decks predate those requirements and carried no
-- founder contact detail, so backfill it here. The two decks parked at
-- `incomplete` keep real gaps, so the Incomplete state and the founder-query
-- loop still have something genuine to act on.
UPDATE decks SET founder = 'Rohan Mehta',   founder_email = 'rohan@finstack.io',       founder_phone = '+91 99012 88456' WHERE id = 'inc_deck_finstack';
UPDATE decks SET founder = 'Ananya Reddy',  founder_email = 'ananya@greengrid.in',     founder_phone = '+91 98480 21345' WHERE id = 'inc_deck_greengrid';
UPDATE decks SET founder = 'Nikhil Rao',    founder_email = 'nikhil@solarcircuit.in',  founder_phone = '+91 98330 41290' WHERE id = 'inc_deck_solarc';
UPDATE decks SET founder = 'Arjun Pillai',  founder_email = 'arjun@taxpilot.in',       founder_phone = '+91 99622 51190' WHERE id = 'inc_deck_taxpilot';
UPDATE decks SET founder = 'Vikram Singh',  founder_email = 'vikram@payroute.in'                                        WHERE id = 'inc_deck_payroute';
UPDATE decks SET founder = 'Priyanka Bose', founder_email = 'priyanka@edulift.co',     founder_phone = '+91 90210 66743' WHERE id = 'inc_deck_edulift';
UPDATE decks SET founder = 'Kavya Nair',    founder_email = 'kavya@insureflow.com',    founder_phone = '+91 90043 77219' WHERE id = 'inc_deck_insureflow';
UPDATE decks SET founder = 'Diya Kapoor',   founder_email = 'diya@wealthos.app',       founder_phone = '+91 91678 40023' WHERE id = 'inc_deck_wealthosi';
UPDATE decks SET founder = 'Sanjay Menon',  founder_email = 'sanjay@medixir.health',   founder_phone = '+91 98450 77315' WHERE id = 'inc_deck_medixir';
UPDATE decks SET founder = 'Ishita Verma',  founder_email = 'ishita@creditbridge.co',  founder_phone = '+91 98860 22417' WHERE id = 'inc_deck_creditbri';
UPDATE decks SET founder = 'Sneha Iyer',    founder_email = 'sneha@greenroute.eco',    founder_phone = '+91 90087 66341' WHERE id = 'inc_deck_greenroute';
UPDATE decks SET founder = 'Harsh Patel',   founder_email = 'harsh@agrofresh.farm',    founder_phone = '+91 99745 30028' WHERE id = 'inc_deck_agrofresh';
UPDATE decks SET founder = 'Meera Sharma',  founder_email = 'meera.sharma@demo.startupjury.ai', founder_phone = '+91 98801 45512' WHERE id = 'inc_deck_meera_signup';
UPDATE decks SET founder = 'Aditi Ghosh',   founder_email = 'aditi@pitchloop.io',      founder_phone = '+91 98190 55621' WHERE id = 'inc_deck_pitchloop';

-- Incomplete decks: record exactly which required columns are still absent, so
-- the Query screen's "Parameters needing response" is not invented.
UPDATE decks SET missing_fields = 'founderPhone' WHERE id = 'inc_deck_payroute';
UPDATE decks SET missing_fields = 'founderPhone' WHERE id = 'inc_deck_meera_incomplete';

-- VC decks get the same treatment so the VC edition's All-decks table is populated.
UPDATE decks SET founder = 'Nandita Shah',  founder_email = 'nandita@wealthos.vc',     founder_phone = '+91 98111 22004' WHERE id = 'vc_deck_wealthos';
UPDATE decks SET founder = 'Imran Qureshi', founder_email = 'imran@creditbridge.co',   founder_phone = '+91 98860 22417' WHERE id = 'vc_deck_creditbridge';
UPDATE decks SET founder = 'Leela Menon',   founder_email = 'leela@paywise.money',     founder_phone = '+91 98450 90210' WHERE id = 'vc_deck_paywise';
UPDATE decks SET founder = 'Rahul Bhatia',  founder_email = 'rahul@medgrid.health',    founder_phone = '+91 99000 43127' WHERE id = 'vc_deck_medgrid';
UPDATE decks SET founder = 'Tara Suresh',   founder_email = 'tara@agrichain.io',       founder_phone = '+91 90080 71234' WHERE id = 'vc_deck_agrichain';
UPDATE decks SET founder = 'Dev Anand',     founder_email = 'dev@freshcart.in',        founder_phone = '+91 98330 55810' WHERE id = 'vc_deck_freshcart';
