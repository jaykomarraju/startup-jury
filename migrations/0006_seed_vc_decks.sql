-- Phase 5 demo data: populate the VC pipeline across every stage so each VC
-- workflow screen (Assoc./Partner pipeline, Partner call, Investment DD, IC
-- Pipeline, Alignment call, Term sheet, Legal DD, Onboard ready, Archive) has live
-- decks on the demo and the e2e IC-member + partner happy paths have something to
-- drive. All VC decks are analyst-uploaded (vc_analyst). The Phase 1 seed already
-- covers associate_review (WealthOS), ic_review (CreditBridge), partner_review (AgriChain).

INSERT INTO decks (id, edition, name, sector, stage, city, program, cohort, status, ai_score, signal, uploaded_by, complete) VALUES
  ('vc_deck_medgrid',    'vc', 'MedGrid',    'Healthtech',  'Series A', 'Bengaluru', 'Deep Tech Fund', NULL, 'partner_call',   8.4, 'strong',   'vc_analyst', 1),
  ('vc_deck_solarnest',  'vc', 'SolarNest',  'Climatetech', 'Seed',     'Chennai',   'Deep Tech Fund', NULL, 'investment_dd',  7.9, 'moderate', 'vc_analyst', 1),
  ('vc_deck_dockflow',   'vc', 'DockFlow',   'Logistics',   'Series A', 'Mumbai',    'Deep Tech Fund', NULL, 'mp_decision',    8.2, 'strong',   'vc_analyst', 1),
  ('vc_deck_learnloop',  'vc', 'LearnLoop',  'Edtech',      'Seed',     'Pune',      'Deep Tech Fund', NULL, 'alignment_call', 8.0, 'strong',   'vc_analyst', 1),
  ('vc_deck_freshcart',  'vc', 'FreshCart',  'Consumer',    'Series A', 'Delhi',     'Deep Tech Fund', NULL, 'term_sheet',     7.7, 'moderate', 'vc_analyst', 1),
  ('vc_deck_cybervault', 'vc', 'CyberVault', 'Cybersecurity','Series A','Hyderabad', 'Deep Tech Fund', NULL, 'legal_dd',       8.6, 'strong',   'vc_analyst', 1),
  ('vc_deck_quantiq',    'vc', 'QuantIQ',    'AI Infra',    'Series B', 'Bengaluru', 'Deep Tech Fund', NULL, 'onboard_ready',  9.0, 'strong',   'vc_analyst', 1),
  ('vc_deck_petpal',     'vc', 'PetPal',     'Consumer',    'Pre-seed', 'Mumbai',    'Deep Tech Fund', NULL, 'archived',       5.4, 'weak',     'vc_analyst', 1);

-- Seed a couple of IC ballots on CreditBridge (ic_review) so the tally is non-empty
-- on the demo. The e2e IC member (vc_ic) is intentionally left unvoted so it casts a
-- fresh vote. Partners sit on the committee, so partner/superuser ballots are valid.
INSERT INTO ic_votes (id, deck_id, member_id, vote, comment) VALUES
  ('icv_seed_cb_partner', 'vc_deck_creditbridge', 'vc_partner',   'invest', 'Strong unit economics, backable team.'),
  ('icv_seed_cb_mp',      'vc_deck_creditbridge', 'vc_superuser', 'hold',   'Want to see one more month of retention.');

-- A closed IC vote on DockFlow (now at mp_decision) for a realistic committee history.
INSERT INTO ic_votes (id, deck_id, member_id, vote, comment) VALUES
  ('icv_seed_df_ic',      'vc_deck_dockflow', 'vc_ic',        'invest', 'Clear category leader.'),
  ('icv_seed_df_partner', 'vc_deck_dockflow', 'vc_partner',   'invest', 'Conviction after the partner call.'),
  ('icv_seed_df_mp',      'vc_deck_dockflow', 'vc_superuser', 'invest', NULL);
