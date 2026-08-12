-- Session 1 (Evaluator Workbench) demo data. Gives one deck per edition a FULL
-- per-parameter AI score set (with rationale comments), an AI evaluation roll-up
-- carrying the current criteria/content versions, and a handful of extracted
-- slides — so the workbench's AI breakdown, AI/My/Average columns and the
-- rescore guard are all live on the seed without needing a real R2 PDF or a live
-- Anthropic call.
--
--   • inc_deck_taxpilot   — status 'assigned' to inc_jury (juror scores it)
--   • vc_deck_wealthos     — status 'associate_review' (VC scoring stage)
--
-- Both have no R2 object, so the in-app PDF viewer shows its graceful
-- "PDF not stored" state; the real slide viewer is exercised on a fresh upload.

-- Clear any prior AI rows for these two decks (0008 seeded a single top-driver
-- score for taxpilot) so the full set below is authoritative, no duplicates.
DELETE FROM scores      WHERE deck_id IN ('inc_deck_taxpilot','vc_deck_wealthos') AND evaluator_kind = 'ai';
DELETE FROM evaluations WHERE deck_id IN ('inc_deck_taxpilot','vc_deck_wealthos') AND evaluator_id IS NULL;
DELETE FROM deck_extractions WHERE deck_id IN ('inc_deck_taxpilot','vc_deck_wealthos');

-- ── TaxPilot (incubator) — full AI breakdown ─────────────────────────────────
INSERT INTO scores (id, deck_id, evaluator_id, evaluator_kind, parameter_id, value, comment) VALUES
  ('ai_tp_pmc',  'inc_deck_taxpilot', NULL, 'ai', 'inc_problem_market_clarity',  7, 'Tax-filing pain is well framed for the SMB segment.'),
  ('ai_tp_svp',  'inc_deck_taxpilot', NULL, 'ai', 'inc_solution_value_prop',     6, 'Automation is clear but differentiation from incumbents is thin.'),
  ('ai_tp_mkt',  'inc_deck_taxpilot', NULL, 'ai', 'inc_market_size',             6, 'TAM is cited top-down; a bottom-up build would strengthen it.'),
  ('ai_tp_prod', 'inc_deck_taxpilot', NULL, 'ai', 'inc_product_technology',      7, 'Working product; the accounting integrations are the moat.'),
  ('ai_tp_bm',   'inc_deck_taxpilot', NULL, 'ai', 'inc_business_model',          6, 'SaaS pricing shown; unit economics are still unproven.'),
  ('ai_tp_trac', 'inc_deck_taxpilot', NULL, 'ai', 'inc_traction_validation',     6, 'A handful of paying customers and modest ARR.'),
  ('ai_tp_comp', 'inc_deck_taxpilot', NULL, 'ai', 'inc_competitive_landscape',   5, 'Crowded category; incumbents are not directly addressed.'),
  ('ai_tp_gtm',  'inc_deck_taxpilot', NULL, 'ai', 'inc_gtm_strategy',            6, 'Channel plan is reasonable but CAC is unclear.'),
  ('ai_tp_team', 'inc_deck_taxpilot', NULL, 'ai', 'inc_team_execution',          7, 'Founders have direct domain experience in tax and payroll.'),
  ('ai_tp_risk', 'inc_deck_taxpilot', NULL, 'ai', 'inc_business_risks',          6, 'Regulatory dependency is acknowledged in the deck.'),
  ('ai_tp_attr', 'inc_deck_taxpilot', NULL, 'ai', 'inc_business_attractiveness', 6, 'Solid opportunity but not breakout on this deck.'),
  ('ai_tp_clim', 'inc_deck_taxpilot', NULL, 'ai', 'inc_climate_impact',          3, 'No climate or sustainability angle presented.'),
  ('ai_tp_story','inc_deck_taxpilot', NULL, 'ai', 'inc_storytelling',            7, 'Clean, readable deck with a clear narrative.');

INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, verdict, remarks, submitted_at, scored_criteria_version, scored_content_version) VALUES
  ('inc_deck_taxpilot_ai_eval', 'inc_deck_taxpilot', NULL, 6.2, 'advanced', 'AI evaluation', '2026-05-06T09:00:00Z', 1, 1);

INSERT INTO deck_extractions (id, deck_id, label, heading, text, sort_order, missing) VALUES
  ('tp_ext_0','inc_deck_taxpilot','Cover','TaxPilot','Automated tax filing and compliance for Indian SMBs.',0,0),
  ('tp_ext_1','inc_deck_taxpilot','Problem','Filing is painful','SMBs juggle GST, TDS and payroll filings across disconnected tools.',1,0),
  ('tp_ext_2','inc_deck_taxpilot','Solution','One filing workspace','A single workspace that syncs ledgers and auto-prepares returns.',2,0),
  ('tp_ext_3','inc_deck_taxpilot','Market','SMB accounting','63M SMBs; wedge is the 8M that already use cloud accounting.',3,0),
  ('tp_ext_4','inc_deck_taxpilot','Traction','Early revenue','140 paying businesses, 18 lakh ARR, growing 12% MoM.',4,0),
  ('tp_ext_5','inc_deck_taxpilot','Team','Founders','Ex-tax-consultant CEO and a payments-infra CTO.',5,0),
  ('tp_ext_6','inc_deck_taxpilot','The ask','Raising','Raising a seed round to expand integrations and GTM.',6,0);

-- ── WealthOS (VC) — full AI breakdown ────────────────────────────────────────
INSERT INTO scores (id, deck_id, evaluator_id, evaluator_kind, parameter_id, value, comment) VALUES
  ('ai_wo_pmc',  'vc_deck_wealthos', NULL, 'ai', 'vc_problem_market_clarity',  8, 'Retail wealth access gap is sharply defined.'),
  ('ai_wo_svp',  'vc_deck_wealthos', NULL, 'ai', 'vc_solution_value_prop',     8, 'Goal-based investing UX is a clear step up on incumbents.'),
  ('ai_wo_mkt',  'vc_deck_wealthos', NULL, 'ai', 'vc_market_size',             8, 'Large, credibly-sized wealthtech market with a bottom-up build.'),
  ('ai_wo_prod', 'vc_deck_wealthos', NULL, 'ai', 'vc_product_technology',      8, 'Full-stack platform with proprietary portfolio engine.'),
  ('ai_wo_bm',   'vc_deck_wealthos', NULL, 'ai', 'vc_business_model',          8, 'AUM-based fee with healthy contribution margins.'),
  ('ai_wo_trac', 'vc_deck_wealthos', NULL, 'ai', 'vc_traction_validation',     9, 'Strong AUM growth and rising net inflows quarter on quarter.'),
  ('ai_wo_comp', 'vc_deck_wealthos', NULL, 'ai', 'vc_competitive_landscape',   7, 'Differentiated but faces well-funded neobank entrants.'),
  ('ai_wo_gtm',  'vc_deck_wealthos', NULL, 'ai', 'vc_gtm_strategy',            8, 'Advisor-led plus referral loop with attractive CAC payback.'),
  ('ai_wo_team', 'vc_deck_wealthos', NULL, 'ai', 'vc_team_execution',          9, 'Repeat fintech operators with regulatory experience.'),
  ('ai_wo_risk', 'vc_deck_wealthos', NULL, 'ai', 'vc_business_risks',          7, 'Market-cycle and regulatory risks are addressed candidly.'),
  ('ai_wo_attr', 'vc_deck_wealthos', NULL, 'ai', 'vc_business_attractiveness', 8, 'Compelling category-leader potential.'),
  ('ai_wo_clim', 'vc_deck_wealthos', NULL, 'ai', 'vc_climate_impact',          8, 'Credible ESG portfolio tilt with an impact-investing option.'),
  ('ai_wo_story','vc_deck_wealthos', NULL, 'ai', 'vc_storytelling',            8, 'Polished, investor-ready narrative.');

INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, verdict, remarks, submitted_at, scored_criteria_version, scored_content_version) VALUES
  ('vc_deck_wealthos_ai_eval', 'vc_deck_wealthos', NULL, 8.1, 'advanced', 'AI evaluation', '2026-05-10T09:00:00Z', 1, 1);

INSERT INTO deck_extractions (id, deck_id, label, heading, text, sort_order, missing) VALUES
  ('wo_ext_0','vc_deck_wealthos','Cover','WealthOS','Goal-based wealth management for the next 100M investors.',0,0),
  ('wo_ext_1','vc_deck_wealthos','Problem','Advice is elite','Quality wealth advice is locked behind high minimums.',1,0),
  ('wo_ext_2','vc_deck_wealthos','Solution','Automated advisor','A goal-based robo-advisor with human escalation.',2,0),
  ('wo_ext_3','vc_deck_wealthos','Market','Wealthtech','Fast-growing retail wealth market; bottom-up TAM build shown.',3,0),
  ('wo_ext_4','vc_deck_wealthos','Traction','AUM growth','420 Cr AUM, net inflows up 20% QoQ.',4,0),
  ('wo_ext_5','vc_deck_wealthos','Team','Founders','Repeat fintech operators with prior regulated-entity exits.',5,0),
  ('wo_ext_6','vc_deck_wealthos','The ask','Raising','Raising a Series A to deepen the platform and expand distribution.',6,0);
