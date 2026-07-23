-- Phase 7 analytics demo data. Enriches both editions so every report screen
-- renders real aggregates:
--   • more incubator decks across stages (cohort / funnel / drift / distribution)
--   • human `evaluations` from multiple evaluators (evaluator calibration + drift +
--     VC scoring variance), attributed to real seed users
--   • one AI "top driver" score per incubator deck (cohort ranking's top-driver col)
--   • a VC funded portfolio with capital_deployed (Capital / Portfolio screens)
--   • VC pipeline_events for the Decision History log
--   • sample tickets + contact messages so the Tickets / Contact screens aren't empty
-- No schema changes — all columns exist from 0001.

-- ── Incubator: additional decks across the pipeline ──────────────────────────
INSERT INTO decks (id, edition, name, sector, stage, city, program, cohort, status, ai_score, signal, assigned_to, uploaded_by, complete) VALUES
  ('inc_deck_greengrid',  'incubator', 'GreenGrid Energy', 'CleanTech',    'Seed',     'Bengaluru', 'Climate Cohort', 'Cohort 6', 'ai_evaluated',    8.7, 'strong',   NULL,       'inc_pa', 1),
  ('inc_deck_taxpilot',   'incubator', 'TaxPilot',         'B2B SaaS',     'Seed',     'Delhi',     'Climate Cohort', 'Cohort 6', 'assigned',        6.2, 'moderate', 'inc_jury', 'inc_pa', 1),
  ('inc_deck_wealthosi',  'incubator', 'WealthOS',         'Wealthtech',   'Pre-seed', 'Pune',      'Climate Cohort', 'Cohort 6', 'jury_evaluation', 6.9, 'moderate', 'inc_jury', 'inc_pa', 1),
  ('inc_deck_creditbri',  'incubator', 'CreditBridge',     'Lending',      'Pre-seed', 'Mumbai',    'Climate Cohort', 'Cohort 6', 'rejected',        4.3, 'weak',     NULL,       'inc_pa', 1),
  ('inc_deck_agrofresh',  'incubator', 'AgroFresh',        'AgriTech',     'Seed',     'Hyderabad', 'Climate Cohort', 'Cohort 6', 'shortlisted',     7.1, 'moderate', 'inc_jury', 'inc_pa', 1),
  ('inc_deck_edulift',    'incubator', 'EduLift',          'Edtech',       'Seed',     'Chennai',   'Climate Cohort', 'Cohort 6', 'intro',           5.6, 'moderate', 'inc_jury', 'inc_pa', 1),
  ('inc_deck_medixir',    'incubator', 'Medixir',          'Healthtech',   'Seed',     'Bengaluru', 'Climate Cohort', 'Cohort 6', 'onboard_ready',   7.9, 'strong',   'inc_jury', 'inc_pa', 1),
  ('inc_deck_solarc',     'incubator', 'SolarCircuit',     'Climatetech',  'Pre-seed', 'Ahmedabad', 'Climate Cohort', 'Cohort 6', 'archived',        3.8, 'weak',     NULL,       'inc_pa', 1);

-- ── Incubator: AI "top driver" score (one high param per deck) ────────────────
INSERT INTO scores (id, deck_id, evaluator_id, evaluator_kind, parameter_id, value, comment) VALUES
  ('ai_top_greengrid',  'inc_deck_greengrid',  NULL, 'ai', 'inc_climate_impact',      8.9, NULL),
  ('ai_top_finstack',   'inc_deck_finstack',   NULL, 'ai', 'inc_traction_validation', 8.2, NULL),
  ('ai_top_insureflow', 'inc_deck_insureflow', NULL, 'ai', 'inc_traction_validation', 8.8, NULL),
  ('ai_top_greenroute', 'inc_deck_greenroute', NULL, 'ai', 'inc_team_execution',      7.6, NULL),
  ('ai_top_taxpilot',   'inc_deck_taxpilot',   NULL, 'ai', 'inc_business_model',      6.4, NULL),
  ('ai_top_wealthosi',  'inc_deck_wealthosi',  NULL, 'ai', 'inc_product_technology',  7.1, NULL),
  ('ai_top_agrofresh',  'inc_deck_agrofresh',  NULL, 'ai', 'inc_traction_validation', 7.4, NULL),
  ('ai_top_edulift',    'inc_deck_edulift',    NULL, 'ai', 'inc_gtm_strategy',        6.0, NULL),
  ('ai_top_medixir',    'inc_deck_medixir',    NULL, 'ai', 'inc_product_technology',  8.1, NULL);

-- ── Incubator: human evaluations (evaluator calibration + AI↔human drift) ─────
-- Evaluators: inc_jury (lenient), inc_pm (high), inc_pa (neutral), inc_admin (strict).
INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, verdict, remarks, submitted_at) VALUES
  ('ev_greengrid_jury',  'inc_deck_greengrid',  'inc_jury',  8.9, 'scored', NULL, '2026-05-02T10:00:00Z'),
  ('ev_greengrid_pm',    'inc_deck_greengrid',  'inc_pm',    8.8, 'scored', NULL, '2026-05-02T10:00:00Z'),
  ('ev_greengrid_pa',    'inc_deck_greengrid',  'inc_pa',    8.7, 'scored', NULL, '2026-05-02T10:00:00Z'),
  ('ev_greengrid_admin', 'inc_deck_greengrid',  'inc_admin', 8.6, 'scored', NULL, '2026-05-02T10:00:00Z'),
  ('ev_finstack_jury',   'inc_deck_finstack',   'inc_jury',  8.3, 'scored', NULL, '2026-05-03T10:00:00Z'),
  ('ev_finstack_pm',     'inc_deck_finstack',   'inc_pm',    8.0, 'scored', NULL, '2026-05-03T10:00:00Z'),
  ('ev_finstack_pa',     'inc_deck_finstack',   'inc_pa',    7.9, 'scored', NULL, '2026-05-03T10:00:00Z'),
  ('ev_finstack_admin',  'inc_deck_finstack',   'inc_admin', 7.6, 'scored', NULL, '2026-05-03T10:00:00Z'),
  ('ev_insure_jury',     'inc_deck_insureflow', 'inc_jury',  8.2, 'scored', NULL, '2026-05-04T10:00:00Z'),
  ('ev_insure_pm',       'inc_deck_insureflow', 'inc_pm',    8.0, 'scored', NULL, '2026-05-04T10:00:00Z'),
  ('ev_insure_pa',       'inc_deck_insureflow', 'inc_pa',    7.9, 'scored', NULL, '2026-05-04T10:00:00Z'),
  ('ev_insure_admin',    'inc_deck_insureflow', 'inc_admin', 7.7, 'scored', NULL, '2026-05-04T10:00:00Z'),
  ('ev_greenroute_jury', 'inc_deck_greenroute', 'inc_jury',  8.1, 'scored', NULL, '2026-05-05T10:00:00Z'),
  ('ev_greenroute_pm',   'inc_deck_greenroute', 'inc_pm',    7.8, 'scored', NULL, '2026-05-05T10:00:00Z'),
  ('ev_greenroute_pa',   'inc_deck_greenroute', 'inc_pa',    7.6, 'scored', NULL, '2026-05-05T10:00:00Z'),
  ('ev_greenroute_admin','inc_deck_greenroute', 'inc_admin', 7.3, 'scored', NULL, '2026-05-05T10:00:00Z'),
  ('ev_taxpilot_jury',   'inc_deck_taxpilot',   'inc_jury',  6.9, 'scored', NULL, '2026-05-06T10:00:00Z'),
  ('ev_taxpilot_pm',     'inc_deck_taxpilot',   'inc_pm',    6.5, 'scored', NULL, '2026-05-06T10:00:00Z'),
  ('ev_taxpilot_pa',     'inc_deck_taxpilot',   'inc_pa',    6.1, 'scored', NULL, '2026-05-06T10:00:00Z'),
  ('ev_taxpilot_admin',  'inc_deck_taxpilot',   'inc_admin', 5.6, 'scored', NULL, '2026-05-06T10:00:00Z'),
  ('ev_agrofresh_jury',  'inc_deck_agrofresh',  'inc_jury',  7.4, 'scored', NULL, '2026-05-07T10:00:00Z'),
  ('ev_agrofresh_pm',    'inc_deck_agrofresh',  'inc_pm',    7.2, 'scored', NULL, '2026-05-07T10:00:00Z'),
  ('ev_agrofresh_pa',    'inc_deck_agrofresh',  'inc_pa',    7.0, 'scored', NULL, '2026-05-07T10:00:00Z'),
  ('ev_agrofresh_admin', 'inc_deck_agrofresh',  'inc_admin', 6.8, 'scored', NULL, '2026-05-07T10:00:00Z'),
  -- CreditBridge: widest evaluator disagreement (calibration flag).
  ('ev_creditbri_jury',  'inc_deck_creditbri',  'inc_jury',  5.6, 'scored', NULL, '2026-05-08T10:00:00Z'),
  ('ev_creditbri_pm',    'inc_deck_creditbri',  'inc_pm',    4.4, 'scored', NULL, '2026-05-08T10:00:00Z'),
  ('ev_creditbri_pa',    'inc_deck_creditbri',  'inc_pa',    4.0, 'scored', NULL, '2026-05-08T10:00:00Z'),
  ('ev_creditbri_admin', 'inc_deck_creditbri',  'inc_admin', 3.2, 'scored', NULL, '2026-05-08T10:00:00Z'),
  ('ev_medixir_jury',    'inc_deck_medixir',    'inc_jury',  8.0, 'scored', NULL, '2026-05-09T10:00:00Z'),
  ('ev_medixir_pa',      'inc_deck_medixir',    'inc_pa',    7.8, 'scored', NULL, '2026-05-09T10:00:00Z');

-- ── VC: human evaluations (Scoring Summary — AI vs evaluator avg + variance) ──
-- Evaluators: vc_analyst, vc_associate, vc_partner.
INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, verdict, remarks, submitted_at) VALUES
  ('vev_wealthos_an',   'vc_deck_wealthos',     'vc_analyst',   8.0, 'scored', NULL, '2026-05-10T10:00:00Z'),
  ('vev_wealthos_as',   'vc_deck_wealthos',     'vc_associate', 8.2, 'scored', NULL, '2026-05-10T10:00:00Z'),
  ('vev_wealthos_pt',   'vc_deck_wealthos',     'vc_partner',   7.9, 'scored', NULL, '2026-05-10T10:00:00Z'),
  ('vev_creditb_an',    'vc_deck_creditbridge', 'vc_analyst',   6.6, 'scored', NULL, '2026-05-11T10:00:00Z'),
  ('vev_creditb_as',    'vc_deck_creditbridge', 'vc_associate', 7.8, 'scored', NULL, '2026-05-11T10:00:00Z'),
  ('vev_creditb_pt',    'vc_deck_creditbridge', 'vc_partner',   6.4, 'scored', NULL, '2026-05-11T10:00:00Z'),
  ('vev_agrichain_an',  'vc_deck_agrichain',    'vc_analyst',   7.0, 'scored', NULL, '2026-05-12T10:00:00Z'),
  ('vev_agrichain_as',  'vc_deck_agrichain',    'vc_associate', 6.8, 'scored', NULL, '2026-05-12T10:00:00Z'),
  ('vev_agrichain_pt',  'vc_deck_agrichain',    'vc_partner',   7.1, 'scored', NULL, '2026-05-12T10:00:00Z'),
  ('vev_medgrid_an',    'vc_deck_medgrid',      'vc_analyst',   8.6, 'scored', NULL, '2026-05-13T10:00:00Z'),
  ('vev_medgrid_as',    'vc_deck_medgrid',      'vc_associate', 8.3, 'scored', NULL, '2026-05-13T10:00:00Z'),
  ('vev_medgrid_pt',    'vc_deck_medgrid',      'vc_partner',   8.5, 'scored', NULL, '2026-05-13T10:00:00Z'),
  ('vev_solarnest_an',  'vc_deck_solarnest',    'vc_analyst',   7.6, 'scored', NULL, '2026-05-14T10:00:00Z'),
  ('vev_solarnest_as',  'vc_deck_solarnest',    'vc_associate', 8.0, 'scored', NULL, '2026-05-14T10:00:00Z'),
  ('vev_solarnest_pt',  'vc_deck_solarnest',    'vc_partner',   7.7, 'scored', NULL, '2026-05-14T10:00:00Z'),
  ('vev_dockflow_an',   'vc_deck_dockflow',     'vc_analyst',   8.4, 'scored', NULL, '2026-05-15T10:00:00Z'),
  ('vev_dockflow_as',   'vc_deck_dockflow',     'vc_associate', 8.1, 'scored', NULL, '2026-05-15T10:00:00Z'),
  ('vev_dockflow_pt',   'vc_deck_dockflow',     'vc_partner',   8.0, 'scored', NULL, '2026-05-15T10:00:00Z');

-- ── VC: funded portfolio (Capital Deployment & Portfolio Construction) ────────
INSERT INTO decks (id, edition, name, sector, stage, city, program, cohort, status, ai_score, signal, uploaded_by, complete) VALUES
  ('vc_deck_gridzero',    'vc', 'GridZero',     'Climatetech', 'Seed',     'Bengaluru', 'Fund II', NULL, 'onboard_ready', 8.3, 'strong',   'vc_analyst', 1),
  ('vc_deck_finstackvc',  'vc', 'FinStack',     'Fintech',     'Series A', 'Mumbai',    'Fund II', NULL, 'onboard_ready', 8.0, 'strong',   'vc_analyst', 1),
  ('vc_deck_insureflowvc','vc', 'InsureFlow',   'Fintech',     'Seed',     'Bengaluru', 'Fund II', NULL, 'onboard_ready', 7.8, 'moderate', 'vc_analyst', 1),
  ('vc_deck_agrichainvc', 'vc', 'AgriChain',    'AgriTech',    'Seed',     'Hyderabad', 'Fund II', NULL, 'onboard_ready', 7.4, 'moderate', 'vc_analyst', 1),
  ('vc_deck_b2bsaas',     'vc', 'LedgerLoop',   'B2B SaaS',    'Series A', 'Bengaluru', 'Fund II', NULL, 'onboard_ready', 8.1, 'strong',   'vc_analyst', 1),
  ('vc_deck_climacore',   'vc', 'ClimaCore',    'Climatetech', 'Series A', 'Pune',      'Fund II', NULL, 'onboard_ready', 8.5, 'strong',   'vc_analyst', 1),
  ('vc_deck_paywise',     'vc', 'PayWise',      'Fintech',     'Seed',     'Delhi',     'Fund II', NULL, 'onboard_ready', 7.6, 'moderate', 'vc_analyst', 1);

-- Portfolio positions with capital_deployed (₹ Cr). QuantIQ (0006) is also funded.
INSERT INTO portfolio (id, deck_id, capital_deployed, onboarded_at) VALUES
  ('pf_quantiq',     'vc_deck_quantiq',     '22', '2026-04-01T10:00:00Z'),
  ('pf_gridzero',    'vc_deck_gridzero',    '8',  '2026-04-05T10:00:00Z'),
  ('pf_finstackvc',  'vc_deck_finstackvc',  '12', '2026-04-10T10:00:00Z'),
  ('pf_insureflowvc','vc_deck_insureflowvc','6',  '2026-04-15T10:00:00Z'),
  ('pf_agrichainvc', 'vc_deck_agrichainvc', '5',  '2026-04-20T10:00:00Z'),
  ('pf_b2bsaas',     'vc_deck_b2bsaas',     '15', '2026-04-25T10:00:00Z'),
  ('pf_climacore',   'vc_deck_climacore',   '20', '2026-05-01T10:00:00Z'),
  ('pf_paywise',     'vc_deck_paywise',     '4',  '2026-05-05T10:00:00Z');

-- ── VC: decision-history events (Decision History log) ───────────────────────
INSERT INTO pipeline_events (id, deck_id, actor_id, from_stage, to_stage, action, note, created_at) VALUES
  ('de_dockflow_inv',  'vc_deck_dockflow',   'vc_superuser', 'mp_decision',     'alignment_call', 'invest',          'Category leader; strong conviction', '2026-06-12T09:00:00Z'),
  ('de_climacore_inv', 'vc_deck_climacore',  'vc_superuser', 'mp_decision',     'alignment_call', 'invest',          'Climate thesis fit, ₹20 Cr',         '2026-06-10T09:00:00Z'),
  ('de_petpal_pass',   'vc_deck_petpal',     'vc_associate', 'associate_review','archived',       'not_shortlisted', 'Weak retention, pass',               '2026-06-08T09:00:00Z'),
  ('de_paywise_rev',   'vc_deck_paywise',    'vc_partner',   'partner_call',    'partner_review', 'another_meeting', 'Revisit after Q3 numbers',           '2026-06-05T09:00:00Z'),
  ('de_gridzero_ts',   'vc_deck_gridzero',   'vc_partner',   'alignment_call',  'term_sheet',     'issue_term_sheet','Term sheet issued ₹8 Cr',            '2026-06-03T09:00:00Z'),
  ('de_freshcart_pass','vc_deck_freshcart',  'vc_partner',   'partner_call',    'archived',       'pass_at_call',    'Co-founder departure',               '2026-06-01T09:00:00Z'),
  ('de_b2bsaas_inv',   'vc_deck_b2bsaas',    'vc_superuser', 'mp_decision',     'alignment_call', 'invest',          'Strong SaaS metrics',                '2026-05-28T09:00:00Z'),
  ('de_finstackvc_ts', 'vc_deck_finstackvc', 'vc_partner',   'alignment_call',  'term_sheet',     'issue_term_sheet','₹12 Cr term sheet',                  '2026-05-25T09:00:00Z');

-- ── Sample tickets & contact messages (Tickets / Contact screens) ────────────
INSERT INTO tickets (id, edition, subject, body, status, created_by, billing_routed, created_at) VALUES
  ('tkt_seed_inc_billing', 'incubator', 'Credit top-up not reflected', 'We purchased 50 credits but the balance still shows the old value.', 'open', 'inc_pm', 1, '2026-07-18T09:00:00Z'),
  ('tkt_seed_inc_bug',     'incubator', 'Export PDF button does nothing', 'On the Cohort summary screen the Export PDF button has no effect.', 'open', 'inc_pa', 0, '2026-07-20T09:00:00Z'),
  ('tkt_seed_vc_billing',  'vc',        'Invoice for Q2 usage',         'Please send the Q2 invoice for our Fund II workspace.',            'open', 'vc_associate', 1, '2026-07-19T09:00:00Z');

INSERT INTO messages (id, edition, from_id, to_scope, body, created_at) VALUES
  ('msg_seed_inc_admin', 'incubator', 'inc_jury', 'admin', 'Can you reassign the TaxPilot deck? I have a conflict of interest.', '2026-07-21T09:00:00Z'),
  ('msg_seed_inc_team',  'incubator', 'inc_pa',   'team',  'Cohort 6 intro calls are scheduled for next week — please review the shortlist.', '2026-07-21T10:00:00Z'),
  ('msg_seed_vc_admin',  'vc',        'vc_analyst','admin', 'Requesting access to the Legal DD checklist for CyberVault.', '2026-07-22T09:00:00Z');
