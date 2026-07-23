-- Phase 4 demo data: give the seed founder (inc_founder / Meera Sharma) her own
-- submissions so the founder portal, query loop, and sign-up flow are live on the
-- demo. The Phase 1 seed decks are all uploaded by the program associate; founders
-- are scoped to their own uploads, so without these the portal shows empty.

INSERT INTO decks (id, edition, name, sector, stage, city, program, cohort, status, ai_score, signal, uploaded_by, founder, complete) VALUES
  ('inc_deck_meera_incomplete', 'incubator', 'NimbusHR', 'HR Tech',    'Pre-seed', 'Bengaluru', 'SaaS Accelerator', 'Cohort 6', 'incomplete', NULL, 'flagged',  'inc_founder', 'Meera Sharma', 0),
  ('inc_deck_meera_signup',     'incubator', 'LedgerLite', 'B2B Fintech', 'Seed',   'Bengaluru', 'SaaS Accelerator', 'Cohort 6', 'signup',     7.4,  'moderate', 'inc_founder', 'Meera Sharma', 1);

-- An open clarification query on the incomplete deck for the founder to answer.
INSERT INTO queries (id, deck_id, questions, email_status) VALUES
  ('qry_seed_nimbus', 'inc_deck_meera_incomplete',
   'Your deck is missing a Traction slide and team details. Please share current pilots/revenue and your founding team.',
   'sent');

-- Record the corresponding stubbed outbox message (mirrors what the app writes).
INSERT INTO email_outbox (id, deck_id, query_id, kind, to_email, to_name, subject, body, status) VALUES
  ('mail_seed_nimbus', 'inc_deck_meera_incomplete', 'qry_seed_nimbus', 'founder_query',
   'meera.sharma@demo.startupjury.ai', 'Meera Sharma',
   'Action needed: a few questions about NimbusHR',
   'Hi Meera, before we can complete the review we need a Traction slide and team details.',
   'sent');
