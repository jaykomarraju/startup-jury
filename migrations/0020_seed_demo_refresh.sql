-- Session 8 — demo-seed refresh. No schema change: this migration only makes the
-- demo COHERENT, so that every screen a stakeholder can reach shows real data
-- rather than an empty state or a headline number with nothing behind it.
--
-- What the audit of the 0001–0018 seed found, and what this fixes:
--
--  1. AI BREAKDOWNS existed on exactly two decks (0010's TaxPilot + WealthOS).
--     Every other deck advertised an `ai_score` in the list with an empty
--     per-parameter breakdown behind it. All 28 remaining scored decks now carry
--     a full 13-parameter AI breakdown with rationale comments plus an AI
--     `evaluations` roll-up. The per-parameter values were solved so the weighted
--     total over the FULL 13-weight rubric reproduces each deck's EXISTING
--     `ai_score` exactly — the same arithmetic `weightedTotal()` and
--     `rescoreEdition()` use, so an admin weight edit re-scores these decks
--     without the headline number jumping. (This also retires the Session-5
--     gotcha that a weight edit collapsed FinStack/InsureFlow 8.6 → 0.87,
--     because they had one score row against a 13-weight denominator.)
--     Scores are whole numbers 0–10, the shape the live model actually returns.
--
--  2. The two Incomplete decks (PayRoute, NimbusHR) are deliberately left with
--     NO breakdown: they never completed an evaluation, so a breakdown would be
--     fiction. Same for `deck_extractions` on the 28 — they have no R2 object,
--     and inventing extracted slide text for a PDF that does not exist would put
--     a lie in the report drawer. Both surfaces have graceful empty states.
--
--  3. Duplicate / returning intake flags were never populated, even though the
--     seed contains the exact cases the feature exists for.
--  4. The AI-health banner (§9, Session 7) had nothing to render.
--  5. VC had no Incomplete deck and no founder query, so the VC Query screen and
--     the resubmit loop were incubator-only.
--  6. Decks in DD stages had no `investment_dd` / `term_sheets` / `legal_dd` row.
--  7. Every ticket and issue was 'open'; every call was 'scheduled' at sequence 0.
--  8. `branding_json` was '{}', so the org name never appeared anywhere.
--  9. Real decks uploaded against the live Worker have `program_id IS NULL`, so
--     the Program/Cohort toolbar filters excluded them.


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Full AI breakdowns for every scored deck
-- ─────────────────────────────────────────────────────────────────────────────
-- 0008 seeded a single "top driver" score for eight incubator decks; clear those
-- so the full sets below are authoritative and no deck ends up with duplicates.
-- Scoped by `evaluator_kind='ai'` — human `evaluations` from 0008 are untouched,
-- which is what keeps Evaluator Scores / Score Drift meaningful.
DELETE FROM scores WHERE evaluator_kind = 'ai' AND deck_id IN (
  'inc_deck_finstack','inc_deck_insureflow','inc_deck_greenroute','inc_deck_greengrid',
  'inc_deck_wealthosi','inc_deck_creditbri','inc_deck_agrofresh','inc_deck_edulift',
  'inc_deck_medixir','inc_deck_solarc','inc_deck_meera_signup',
  'vc_deck_creditbridge','vc_deck_agrichain','vc_deck_medgrid','vc_deck_solarnest',
  'vc_deck_dockflow','vc_deck_learnloop','vc_deck_freshcart','vc_deck_cybervault',
  'vc_deck_quantiq','vc_deck_petpal','vc_deck_gridzero','vc_deck_finstackvc',
  'vc_deck_insureflowvc','vc_deck_agrichainvc','vc_deck_b2bsaas','vc_deck_climacore',
  'vc_deck_paywise');
DELETE FROM evaluations WHERE evaluator_id IS NULL AND deck_id IN (
  'inc_deck_finstack','inc_deck_insureflow','inc_deck_greenroute','inc_deck_greengrid',
  'inc_deck_wealthosi','inc_deck_creditbri','inc_deck_agrofresh','inc_deck_edulift',
  'inc_deck_medixir','inc_deck_solarc','inc_deck_meera_signup',
  'vc_deck_creditbridge','vc_deck_agrichain','vc_deck_medgrid','vc_deck_solarnest',
  'vc_deck_dockflow','vc_deck_learnloop','vc_deck_freshcart','vc_deck_cybervault',
  'vc_deck_quantiq','vc_deck_petpal','vc_deck_gridzero','vc_deck_finstackvc',
  'vc_deck_insureflowvc','vc_deck_agrichainvc','vc_deck_b2bsaas','vc_deck_climacore',
  'vc_deck_paywise');

-- INCUBATOR
-- FinStack — ai_score 7.8
INSERT INTO scores (id, deck_id, evaluator_id, evaluator_kind, parameter_id, value, comment) VALUES
  ('ais_fs_pmc', 'inc_deck_finstack', NULL, 'ai', 'inc_problem_market_clarity', 7, 'The problem is stated clearly enough, though the affected segment stays broad.'),
  ('ais_fs_svp', 'inc_deck_finstack', NULL, 'ai', 'inc_solution_value_prop', 8, 'The value proposition is concrete and clearly better than the status quo.'),
  ('ais_fs_mkt', 'inc_deck_finstack', NULL, 'ai', 'inc_market_size', 7, 'TAM is cited top-down; a bottom-up build would strengthen it.'),
  ('ais_fs_prod', 'inc_deck_finstack', NULL, 'ai', 'inc_product_technology', 9, 'A working product with genuine technical depth behind it.'),
  ('ais_fs_bm', 'inc_deck_finstack', NULL, 'ai', 'inc_business_model', 9, 'Pricing and unit economics are shown and hold together.'),
  ('ais_fs_trac', 'inc_deck_finstack', NULL, 'ai', 'inc_traction_validation', 9, 'Strong, verifiable traction with consistent growth quarter on quarter.'),
  ('ais_fs_comp', 'inc_deck_finstack', NULL, 'ai', 'inc_competitive_landscape', 6, 'Competition is acknowledged but incumbents are not directly addressed.'),
  ('ais_fs_gtm', 'inc_deck_finstack', NULL, 'ai', 'inc_gtm_strategy', 8, 'A specific channel plan with sensible CAC payback assumptions.'),
  ('ais_fs_team', 'inc_deck_finstack', NULL, 'ai', 'inc_team_execution', 9, 'Founders have direct, relevant operating experience in this domain.'),
  ('ais_fs_risk', 'inc_deck_finstack', NULL, 'ai', 'inc_business_risks', 7, 'Some risk is acknowledged; regulatory exposure is under-explored.'),
  ('ais_fs_attr', 'inc_deck_finstack', NULL, 'ai', 'inc_business_attractiveness', 7, 'A solid opportunity, but not breakout on this deck.'),
  ('ais_fs_clim', 'inc_deck_finstack', NULL, 'ai', 'inc_climate_impact', 6, 'A sustainability angle is claimed but not quantified.'),
  ('ais_fs_story', 'inc_deck_finstack', NULL, 'ai', 'inc_storytelling', 10, 'A clean, investor-ready narrative that is easy to follow.');
INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, verdict, remarks, submitted_at, scored_criteria_version, scored_content_version) VALUES
  ('inc_deck_finstack_ai_eval', 'inc_deck_finstack', NULL, 7.8, 'advanced', 'AI evaluation', '2026-04-02T09:00:00Z', 1, 1);

-- InsureFlow — ai_score 8.6
INSERT INTO scores (id, deck_id, evaluator_id, evaluator_kind, parameter_id, value, comment) VALUES
  ('ais_if_pmc', 'inc_deck_insureflow', NULL, 'ai', 'inc_problem_market_clarity', 6, 'The problem is stated clearly enough, though the affected segment stays broad.'),
  ('ais_if_svp', 'inc_deck_insureflow', NULL, 'ai', 'inc_solution_value_prop', 7, 'The solution is understandable but its advantage over incumbents is thin.'),
  ('ais_if_mkt', 'inc_deck_insureflow', NULL, 'ai', 'inc_market_size', 10, 'Market is sized bottom-up from a defensible wedge.'),
  ('ais_if_prod', 'inc_deck_insureflow', NULL, 'ai', 'inc_product_technology', 10, 'A working product with genuine technical depth behind it.'),
  ('ais_if_bm', 'inc_deck_insureflow', NULL, 'ai', 'inc_business_model', 9, 'Pricing and unit economics are shown and hold together.'),
  ('ais_if_trac', 'inc_deck_insureflow', NULL, 'ai', 'inc_traction_validation', 8, 'Strong, verifiable traction with consistent growth quarter on quarter.'),
  ('ais_if_comp', 'inc_deck_insureflow', NULL, 'ai', 'inc_competitive_landscape', 10, 'Competitors are named and the wedge against them is argued well.'),
  ('ais_if_gtm', 'inc_deck_insureflow', NULL, 'ai', 'inc_gtm_strategy', 8, 'A specific channel plan with sensible CAC payback assumptions.'),
  ('ais_if_team', 'inc_deck_insureflow', NULL, 'ai', 'inc_team_execution', 8, 'Founders have direct, relevant operating experience in this domain.'),
  ('ais_if_risk', 'inc_deck_insureflow', NULL, 'ai', 'inc_business_risks', 10, 'Key risks are named candidly with credible mitigations.'),
  ('ais_if_attr', 'inc_deck_insureflow', NULL, 'ai', 'inc_business_attractiveness', 7, 'A solid opportunity, but not breakout on this deck.'),
  ('ais_if_clim', 'inc_deck_insureflow', NULL, 'ai', 'inc_climate_impact', 10, 'Credible, measured climate or sustainability impact with real numbers.'),
  ('ais_if_story', 'inc_deck_insureflow', NULL, 'ai', 'inc_storytelling', 10, 'A clean, investor-ready narrative that is easy to follow.');
INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, verdict, remarks, submitted_at, scored_criteria_version, scored_content_version) VALUES
  ('inc_deck_insureflow_ai_eval', 'inc_deck_insureflow', NULL, 8.6, 'advanced', 'AI evaluation', '2026-04-03T09:00:00Z', 1, 1);

-- GreenRoute — ai_score 7.2
INSERT INTO scores (id, deck_id, evaluator_id, evaluator_kind, parameter_id, value, comment) VALUES
  ('ais_gr_pmc', 'inc_deck_greenroute', NULL, 'ai', 'inc_problem_market_clarity', 4, 'The problem is asserted rather than evidenced; no customer is named.'),
  ('ais_gr_svp', 'inc_deck_greenroute', NULL, 'ai', 'inc_solution_value_prop', 9, 'The value proposition is concrete and clearly better than the status quo.'),
  ('ais_gr_mkt', 'inc_deck_greenroute', NULL, 'ai', 'inc_market_size', 7, 'TAM is cited top-down; a bottom-up build would strengthen it.'),
  ('ais_gr_prod', 'inc_deck_greenroute', NULL, 'ai', 'inc_product_technology', 9, 'A working product with genuine technical depth behind it.'),
  ('ais_gr_bm', 'inc_deck_greenroute', NULL, 'ai', 'inc_business_model', 8, 'Pricing and unit economics are shown and hold together.'),
  ('ais_gr_trac', 'inc_deck_greenroute', NULL, 'ai', 'inc_traction_validation', 7, 'Early traction is present but the numbers are directional.'),
  ('ais_gr_comp', 'inc_deck_greenroute', NULL, 'ai', 'inc_competitive_landscape', 7, 'Competition is acknowledged but incumbents are not directly addressed.'),
  ('ais_gr_gtm', 'inc_deck_greenroute', NULL, 'ai', 'inc_gtm_strategy', 8, 'A specific channel plan with sensible CAC payback assumptions.'),
  ('ais_gr_team', 'inc_deck_greenroute', NULL, 'ai', 'inc_team_execution', 9, 'Founders have direct, relevant operating experience in this domain.'),
  ('ais_gr_risk', 'inc_deck_greenroute', NULL, 'ai', 'inc_business_risks', 6, 'Some risk is acknowledged; regulatory exposure is under-explored.'),
  ('ais_gr_attr', 'inc_deck_greenroute', NULL, 'ai', 'inc_business_attractiveness', 6, 'A solid opportunity, but not breakout on this deck.'),
  ('ais_gr_clim', 'inc_deck_greenroute', NULL, 'ai', 'inc_climate_impact', 7, 'A sustainability angle is claimed but not quantified.'),
  ('ais_gr_story', 'inc_deck_greenroute', NULL, 'ai', 'inc_storytelling', 6, 'Readable deck, though the story loses shape in the middle.');
INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, verdict, remarks, submitted_at, scored_criteria_version, scored_content_version) VALUES
  ('inc_deck_greenroute_ai_eval', 'inc_deck_greenroute', NULL, 7.2, 'advanced', 'AI evaluation', '2026-04-08T09:00:00Z', 1, 1);

-- GreenGrid Energy — ai_score 8.7
INSERT INTO scores (id, deck_id, evaluator_id, evaluator_kind, parameter_id, value, comment) VALUES
  ('ais_gg_pmc', 'inc_deck_greengrid', NULL, 'ai', 'inc_problem_market_clarity', 10, 'The problem is sharply framed with a named customer and a real cost.'),
  ('ais_gg_svp', 'inc_deck_greengrid', NULL, 'ai', 'inc_solution_value_prop', 8, 'The value proposition is concrete and clearly better than the status quo.'),
  ('ais_gg_mkt', 'inc_deck_greengrid', NULL, 'ai', 'inc_market_size', 10, 'Market is sized bottom-up from a defensible wedge.'),
  ('ais_gg_prod', 'inc_deck_greengrid', NULL, 'ai', 'inc_product_technology', 8, 'A working product with genuine technical depth behind it.'),
  ('ais_gg_bm', 'inc_deck_greengrid', NULL, 'ai', 'inc_business_model', 10, 'Pricing and unit economics are shown and hold together.'),
  ('ais_gg_trac', 'inc_deck_greengrid', NULL, 'ai', 'inc_traction_validation', 8, 'Strong, verifiable traction with consistent growth quarter on quarter.'),
  ('ais_gg_comp', 'inc_deck_greengrid', NULL, 'ai', 'inc_competitive_landscape', 9, 'Competitors are named and the wedge against them is argued well.'),
  ('ais_gg_gtm', 'inc_deck_greengrid', NULL, 'ai', 'inc_gtm_strategy', 8, 'A specific channel plan with sensible CAC payback assumptions.'),
  ('ais_gg_team', 'inc_deck_greengrid', NULL, 'ai', 'inc_team_execution', 8, 'Founders have direct, relevant operating experience in this domain.'),
  ('ais_gg_risk', 'inc_deck_greengrid', NULL, 'ai', 'inc_business_risks', 7, 'Some risk is acknowledged; regulatory exposure is under-explored.'),
  ('ais_gg_attr', 'inc_deck_greengrid', NULL, 'ai', 'inc_business_attractiveness', 9, 'Compelling category-leader potential on the evidence shown.'),
  ('ais_gg_clim', 'inc_deck_greengrid', NULL, 'ai', 'inc_climate_impact', 9, 'Credible, measured climate or sustainability impact with real numbers.'),
  ('ais_gg_story', 'inc_deck_greengrid', NULL, 'ai', 'inc_storytelling', 10, 'A clean, investor-ready narrative that is easy to follow.');
INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, verdict, remarks, submitted_at, scored_criteria_version, scored_content_version) VALUES
  ('inc_deck_greengrid_ai_eval', 'inc_deck_greengrid', NULL, 8.7, 'advanced', 'AI evaluation', '2026-04-10T09:00:00Z', 1, 1);

-- WealthOS — ai_score 6.9
INSERT INTO scores (id, deck_id, evaluator_id, evaluator_kind, parameter_id, value, comment) VALUES
  ('ais_wi_pmc', 'inc_deck_wealthosi', NULL, 'ai', 'inc_problem_market_clarity', 7, 'The problem is stated clearly enough, though the affected segment stays broad.'),
  ('ais_wi_svp', 'inc_deck_wealthosi', NULL, 'ai', 'inc_solution_value_prop', 9, 'The value proposition is concrete and clearly better than the status quo.'),
  ('ais_wi_mkt', 'inc_deck_wealthosi', NULL, 'ai', 'inc_market_size', 9, 'Market is sized bottom-up from a defensible wedge.'),
  ('ais_wi_prod', 'inc_deck_wealthosi', NULL, 'ai', 'inc_product_technology', 7, 'Product exists and functions; the technical moat is not yet obvious.'),
  ('ais_wi_bm', 'inc_deck_wealthosi', NULL, 'ai', 'inc_business_model', 9, 'Pricing and unit economics are shown and hold together.'),
  ('ais_wi_trac', 'inc_deck_wealthosi', NULL, 'ai', 'inc_traction_validation', 7, 'Early traction is present but the numbers are directional.'),
  ('ais_wi_comp', 'inc_deck_wealthosi', NULL, 'ai', 'inc_competitive_landscape', 9, 'Competitors are named and the wedge against them is argued well.'),
  ('ais_wi_gtm', 'inc_deck_wealthosi', NULL, 'ai', 'inc_gtm_strategy', 6, 'Channel plan is reasonable but acquisition cost is unclear.'),
  ('ais_wi_team', 'inc_deck_wealthosi', NULL, 'ai', 'inc_team_execution', 8, 'Founders have direct, relevant operating experience in this domain.'),
  ('ais_wi_risk', 'inc_deck_wealthosi', NULL, 'ai', 'inc_business_risks', 6, 'Some risk is acknowledged; regulatory exposure is under-explored.'),
  ('ais_wi_attr', 'inc_deck_wealthosi', NULL, 'ai', 'inc_business_attractiveness', 7, 'A solid opportunity, but not breakout on this deck.'),
  ('ais_wi_clim', 'inc_deck_wealthosi', NULL, 'ai', 'inc_climate_impact', 1, 'No climate or sustainability dimension is presented.'),
  ('ais_wi_story', 'inc_deck_wealthosi', NULL, 'ai', 'inc_storytelling', 6, 'Readable deck, though the story loses shape in the middle.');
INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, verdict, remarks, submitted_at, scored_criteria_version, scored_content_version) VALUES
  ('inc_deck_wealthosi_ai_eval', 'inc_deck_wealthosi', NULL, 6.9, 'advanced', 'AI evaluation', '2026-04-12T09:00:00Z', 1, 1);

-- CreditBridge — ai_score 4.3
INSERT INTO scores (id, deck_id, evaluator_id, evaluator_kind, parameter_id, value, comment) VALUES
  ('ais_cb_pmc', 'inc_deck_creditbri', NULL, 'ai', 'inc_problem_market_clarity', 5, 'The problem is stated clearly enough, though the affected segment stays broad.'),
  ('ais_cb_svp', 'inc_deck_creditbri', NULL, 'ai', 'inc_solution_value_prop', 4, 'The solution reads as a feature list; the value to the buyer is unclear.'),
  ('ais_cb_mkt', 'inc_deck_creditbri', NULL, 'ai', 'inc_market_size', 3, 'No credible sizing — a headline market number with no derivation.'),
  ('ais_cb_prod', 'inc_deck_creditbri', NULL, 'ai', 'inc_product_technology', 5, 'Product exists and functions; the technical moat is not yet obvious.'),
  ('ais_cb_bm', 'inc_deck_creditbri', NULL, 'ai', 'inc_business_model', 5, 'Revenue model is stated but unit economics remain unproven.'),
  ('ais_cb_trac', 'inc_deck_creditbri', NULL, 'ai', 'inc_traction_validation', 4, 'Little evidence of validation — no revenue, pilots or usage data.'),
  ('ais_cb_comp', 'inc_deck_creditbri', NULL, 'ai', 'inc_competitive_landscape', 5, 'Competition is acknowledged but incumbents are not directly addressed.'),
  ('ais_cb_gtm', 'inc_deck_creditbri', NULL, 'ai', 'inc_gtm_strategy', 6, 'Channel plan is reasonable but acquisition cost is unclear.'),
  ('ais_cb_team', 'inc_deck_creditbri', NULL, 'ai', 'inc_team_execution', 4, 'Team slide is thin — little evidence of relevant execution history.'),
  ('ais_cb_risk', 'inc_deck_creditbri', NULL, 'ai', 'inc_business_risks', 3, 'Risks are absent from the deck entirely.'),
  ('ais_cb_attr', 'inc_deck_creditbri', NULL, 'ai', 'inc_business_attractiveness', 7, 'A solid opportunity, but not breakout on this deck.'),
  ('ais_cb_clim', 'inc_deck_creditbri', NULL, 'ai', 'inc_climate_impact', 2, 'No climate or sustainability dimension is presented.'),
  ('ais_cb_story', 'inc_deck_creditbri', NULL, 'ai', 'inc_storytelling', 4, 'Cluttered and hard to follow; the argument does not build.');
INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, verdict, remarks, submitted_at, scored_criteria_version, scored_content_version) VALUES
  ('inc_deck_creditbri_ai_eval', 'inc_deck_creditbri', NULL, 4.3, 'rejected', 'AI evaluation', '2026-04-14T09:00:00Z', 1, 1);

-- AgroFresh — ai_score 7.1
INSERT INTO scores (id, deck_id, evaluator_id, evaluator_kind, parameter_id, value, comment) VALUES
  ('ais_af_pmc', 'inc_deck_agrofresh', NULL, 'ai', 'inc_problem_market_clarity', 6, 'The problem is stated clearly enough, though the affected segment stays broad.'),
  ('ais_af_svp', 'inc_deck_agrofresh', NULL, 'ai', 'inc_solution_value_prop', 8, 'The value proposition is concrete and clearly better than the status quo.'),
  ('ais_af_mkt', 'inc_deck_agrofresh', NULL, 'ai', 'inc_market_size', 9, 'Market is sized bottom-up from a defensible wedge.'),
  ('ais_af_prod', 'inc_deck_agrofresh', NULL, 'ai', 'inc_product_technology', 7, 'Product exists and functions; the technical moat is not yet obvious.'),
  ('ais_af_bm', 'inc_deck_agrofresh', NULL, 'ai', 'inc_business_model', 6, 'Revenue model is stated but unit economics remain unproven.'),
  ('ais_af_trac', 'inc_deck_agrofresh', NULL, 'ai', 'inc_traction_validation', 10, 'Strong, verifiable traction with consistent growth quarter on quarter.'),
  ('ais_af_comp', 'inc_deck_agrofresh', NULL, 'ai', 'inc_competitive_landscape', 9, 'Competitors are named and the wedge against them is argued well.'),
  ('ais_af_gtm', 'inc_deck_agrofresh', NULL, 'ai', 'inc_gtm_strategy', 9, 'A specific channel plan with sensible CAC payback assumptions.'),
  ('ais_af_team', 'inc_deck_agrofresh', NULL, 'ai', 'inc_team_execution', 8, 'Founders have direct, relevant operating experience in this domain.'),
  ('ais_af_risk', 'inc_deck_agrofresh', NULL, 'ai', 'inc_business_risks', 7, 'Some risk is acknowledged; regulatory exposure is under-explored.'),
  ('ais_af_attr', 'inc_deck_agrofresh', NULL, 'ai', 'inc_business_attractiveness', 7, 'A solid opportunity, but not breakout on this deck.'),
  ('ais_af_clim', 'inc_deck_agrofresh', NULL, 'ai', 'inc_climate_impact', 1, 'No climate or sustainability dimension is presented.'),
  ('ais_af_story', 'inc_deck_agrofresh', NULL, 'ai', 'inc_storytelling', 7, 'Readable deck, though the story loses shape in the middle.');
INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, verdict, remarks, submitted_at, scored_criteria_version, scored_content_version) VALUES
  ('inc_deck_agrofresh_ai_eval', 'inc_deck_agrofresh', NULL, 7.1, 'advanced', 'AI evaluation', '2026-04-16T09:00:00Z', 1, 1);

-- EduLift — ai_score 5.6
INSERT INTO scores (id, deck_id, evaluator_id, evaluator_kind, parameter_id, value, comment) VALUES
  ('ais_el_pmc', 'inc_deck_edulift', NULL, 'ai', 'inc_problem_market_clarity', 3, 'The problem is asserted rather than evidenced; no customer is named.'),
  ('ais_el_svp', 'inc_deck_edulift', NULL, 'ai', 'inc_solution_value_prop', 7, 'The solution is understandable but its advantage over incumbents is thin.'),
  ('ais_el_mkt', 'inc_deck_edulift', NULL, 'ai', 'inc_market_size', 9, 'Market is sized bottom-up from a defensible wedge.'),
  ('ais_el_prod', 'inc_deck_edulift', NULL, 'ai', 'inc_product_technology', 7, 'Product exists and functions; the technical moat is not yet obvious.'),
  ('ais_el_bm', 'inc_deck_edulift', NULL, 'ai', 'inc_business_model', 5, 'Revenue model is stated but unit economics remain unproven.'),
  ('ais_el_trac', 'inc_deck_edulift', NULL, 'ai', 'inc_traction_validation', 6, 'Early traction is present but the numbers are directional.'),
  ('ais_el_comp', 'inc_deck_edulift', NULL, 'ai', 'inc_competitive_landscape', 7, 'Competition is acknowledged but incumbents are not directly addressed.'),
  ('ais_el_gtm', 'inc_deck_edulift', NULL, 'ai', 'inc_gtm_strategy', 7, 'Channel plan is reasonable but acquisition cost is unclear.'),
  ('ais_el_team', 'inc_deck_edulift', NULL, 'ai', 'inc_team_execution', 5, 'Capable team, though a key functional gap is still open.'),
  ('ais_el_risk', 'inc_deck_edulift', NULL, 'ai', 'inc_business_risks', 7, 'Some risk is acknowledged; regulatory exposure is under-explored.'),
  ('ais_el_attr', 'inc_deck_edulift', NULL, 'ai', 'inc_business_attractiveness', 4, 'The opportunity as presented is narrow and hard to scale.'),
  ('ais_el_clim', 'inc_deck_edulift', NULL, 'ai', 'inc_climate_impact', 3, 'No climate or sustainability dimension is presented.'),
  ('ais_el_story', 'inc_deck_edulift', NULL, 'ai', 'inc_storytelling', 4, 'Cluttered and hard to follow; the argument does not build.');
INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, verdict, remarks, submitted_at, scored_criteria_version, scored_content_version) VALUES
  ('inc_deck_edulift_ai_eval', 'inc_deck_edulift', NULL, 5.6, 'advanced', 'AI evaluation', '2026-04-18T09:00:00Z', 1, 1);

-- Medixir — ai_score 7.9
INSERT INTO scores (id, deck_id, evaluator_id, evaluator_kind, parameter_id, value, comment) VALUES
  ('ais_mx_pmc', 'inc_deck_medixir', NULL, 'ai', 'inc_problem_market_clarity', 9, 'The problem is sharply framed with a named customer and a real cost.'),
  ('ais_mx_svp', 'inc_deck_medixir', NULL, 'ai', 'inc_solution_value_prop', 9, 'The value proposition is concrete and clearly better than the status quo.'),
  ('ais_mx_mkt', 'inc_deck_medixir', NULL, 'ai', 'inc_market_size', 8, 'Market is sized bottom-up from a defensible wedge.'),
  ('ais_mx_prod', 'inc_deck_medixir', NULL, 'ai', 'inc_product_technology', 10, 'A working product with genuine technical depth behind it.'),
  ('ais_mx_bm', 'inc_deck_medixir', NULL, 'ai', 'inc_business_model', 8, 'Pricing and unit economics are shown and hold together.'),
  ('ais_mx_trac', 'inc_deck_medixir', NULL, 'ai', 'inc_traction_validation', 9, 'Strong, verifiable traction with consistent growth quarter on quarter.'),
  ('ais_mx_comp', 'inc_deck_medixir', NULL, 'ai', 'inc_competitive_landscape', 10, 'Competitors are named and the wedge against them is argued well.'),
  ('ais_mx_gtm', 'inc_deck_medixir', NULL, 'ai', 'inc_gtm_strategy', 9, 'A specific channel plan with sensible CAC payback assumptions.'),
  ('ais_mx_team', 'inc_deck_medixir', NULL, 'ai', 'inc_team_execution', 7, 'Capable team, though a key functional gap is still open.'),
  ('ais_mx_risk', 'inc_deck_medixir', NULL, 'ai', 'inc_business_risks', 9, 'Key risks are named candidly with credible mitigations.'),
  ('ais_mx_attr', 'inc_deck_medixir', NULL, 'ai', 'inc_business_attractiveness', 8, 'Compelling category-leader potential on the evidence shown.'),
  ('ais_mx_clim', 'inc_deck_medixir', NULL, 'ai', 'inc_climate_impact', 1, 'No climate or sustainability dimension is presented.'),
  ('ais_mx_story', 'inc_deck_medixir', NULL, 'ai', 'inc_storytelling', 9, 'A clean, investor-ready narrative that is easy to follow.');
INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, verdict, remarks, submitted_at, scored_criteria_version, scored_content_version) VALUES
  ('inc_deck_medixir_ai_eval', 'inc_deck_medixir', NULL, 7.9, 'advanced', 'AI evaluation', '2026-04-20T09:00:00Z', 1, 1);

-- SolarCircuit — ai_score 3.8
INSERT INTO scores (id, deck_id, evaluator_id, evaluator_kind, parameter_id, value, comment) VALUES
  ('ais_sc_pmc', 'inc_deck_solarc', NULL, 'ai', 'inc_problem_market_clarity', 1, 'The problem is asserted rather than evidenced; no customer is named.'),
  ('ais_sc_svp', 'inc_deck_solarc', NULL, 'ai', 'inc_solution_value_prop', 2, 'The solution reads as a feature list; the value to the buyer is unclear.'),
  ('ais_sc_mkt', 'inc_deck_solarc', NULL, 'ai', 'inc_market_size', 5, 'TAM is cited top-down; a bottom-up build would strengthen it.'),
  ('ais_sc_prod', 'inc_deck_solarc', NULL, 'ai', 'inc_product_technology', 5, 'Product exists and functions; the technical moat is not yet obvious.'),
  ('ais_sc_bm', 'inc_deck_solarc', NULL, 'ai', 'inc_business_model', 5, 'Revenue model is stated but unit economics remain unproven.'),
  ('ais_sc_trac', 'inc_deck_solarc', NULL, 'ai', 'inc_traction_validation', 5, 'Early traction is present but the numbers are directional.'),
  ('ais_sc_comp', 'inc_deck_solarc', NULL, 'ai', 'inc_competitive_landscape', 6, 'Competition is acknowledged but incumbents are not directly addressed.'),
  ('ais_sc_gtm', 'inc_deck_solarc', NULL, 'ai', 'inc_gtm_strategy', 3, 'Go-to-market is aspirational; no channel has been tested.'),
  ('ais_sc_team', 'inc_deck_solarc', NULL, 'ai', 'inc_team_execution', 4, 'Team slide is thin — little evidence of relevant execution history.'),
  ('ais_sc_risk', 'inc_deck_solarc', NULL, 'ai', 'inc_business_risks', 5, 'Some risk is acknowledged; regulatory exposure is under-explored.'),
  ('ais_sc_attr', 'inc_deck_solarc', NULL, 'ai', 'inc_business_attractiveness', 4, 'The opportunity as presented is narrow and hard to scale.'),
  ('ais_sc_clim', 'inc_deck_solarc', NULL, 'ai', 'inc_climate_impact', 1, 'No climate or sustainability dimension is presented.'),
  ('ais_sc_story', 'inc_deck_solarc', NULL, 'ai', 'inc_storytelling', 5, 'Readable deck, though the story loses shape in the middle.');
INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, verdict, remarks, submitted_at, scored_criteria_version, scored_content_version) VALUES
  ('inc_deck_solarc_ai_eval', 'inc_deck_solarc', NULL, 3.8, 'rejected', 'AI evaluation', '2026-04-22T09:00:00Z', 1, 1);

-- LedgerLite — ai_score 7.4
INSERT INTO scores (id, deck_id, evaluator_id, evaluator_kind, parameter_id, value, comment) VALUES
  ('ais_ll_pmc', 'inc_deck_meera_signup', NULL, 'ai', 'inc_problem_market_clarity', 6, 'The problem is stated clearly enough, though the affected segment stays broad.'),
  ('ais_ll_svp', 'inc_deck_meera_signup', NULL, 'ai', 'inc_solution_value_prop', 5, 'The solution is understandable but its advantage over incumbents is thin.'),
  ('ais_ll_mkt', 'inc_deck_meera_signup', NULL, 'ai', 'inc_market_size', 8, 'Market is sized bottom-up from a defensible wedge.'),
  ('ais_ll_prod', 'inc_deck_meera_signup', NULL, 'ai', 'inc_product_technology', 8, 'A working product with genuine technical depth behind it.'),
  ('ais_ll_bm', 'inc_deck_meera_signup', NULL, 'ai', 'inc_business_model', 8, 'Pricing and unit economics are shown and hold together.'),
  ('ais_ll_trac', 'inc_deck_meera_signup', NULL, 'ai', 'inc_traction_validation', 9, 'Strong, verifiable traction with consistent growth quarter on quarter.'),
  ('ais_ll_comp', 'inc_deck_meera_signup', NULL, 'ai', 'inc_competitive_landscape', 8, 'Competitors are named and the wedge against them is argued well.'),
  ('ais_ll_gtm', 'inc_deck_meera_signup', NULL, 'ai', 'inc_gtm_strategy', 8, 'A specific channel plan with sensible CAC payback assumptions.'),
  ('ais_ll_team', 'inc_deck_meera_signup', NULL, 'ai', 'inc_team_execution', 6, 'Capable team, though a key functional gap is still open.'),
  ('ais_ll_risk', 'inc_deck_meera_signup', NULL, 'ai', 'inc_business_risks', 8, 'Key risks are named candidly with credible mitigations.'),
  ('ais_ll_attr', 'inc_deck_meera_signup', NULL, 'ai', 'inc_business_attractiveness', 9, 'Compelling category-leader potential on the evidence shown.'),
  ('ais_ll_clim', 'inc_deck_meera_signup', NULL, 'ai', 'inc_climate_impact', 7, 'A sustainability angle is claimed but not quantified.'),
  ('ais_ll_story', 'inc_deck_meera_signup', NULL, 'ai', 'inc_storytelling', 6, 'Readable deck, though the story loses shape in the middle.');
INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, verdict, remarks, submitted_at, scored_criteria_version, scored_content_version) VALUES
  ('inc_deck_meera_signup_ai_eval', 'inc_deck_meera_signup', NULL, 7.4, 'advanced', 'AI evaluation', '2026-04-24T09:00:00Z', 1, 1);

-- VC
-- CreditBridge — ai_score 7.5
INSERT INTO scores (id, deck_id, evaluator_id, evaluator_kind, parameter_id, value, comment) VALUES
  ('ais_vcb_pmc', 'vc_deck_creditbridge', NULL, 'ai', 'vc_problem_market_clarity', 10, 'The problem is sharply framed with a named customer and a real cost.'),
  ('ais_vcb_svp', 'vc_deck_creditbridge', NULL, 'ai', 'vc_solution_value_prop', 9, 'The value proposition is concrete and clearly better than the status quo.'),
  ('ais_vcb_mkt', 'vc_deck_creditbridge', NULL, 'ai', 'vc_market_size', 7, 'TAM is cited top-down; a bottom-up build would strengthen it.'),
  ('ais_vcb_prod', 'vc_deck_creditbridge', NULL, 'ai', 'vc_product_technology', 5, 'Product exists and functions; the technical moat is not yet obvious.'),
  ('ais_vcb_bm', 'vc_deck_creditbridge', NULL, 'ai', 'vc_business_model', 7, 'Revenue model is stated but unit economics remain unproven.'),
  ('ais_vcb_trac', 'vc_deck_creditbridge', NULL, 'ai', 'vc_traction_validation', 7, 'Early traction is present but the numbers are directional.'),
  ('ais_vcb_comp', 'vc_deck_creditbridge', NULL, 'ai', 'vc_competitive_landscape', 8, 'Competitors are named and the wedge against them is argued well.'),
  ('ais_vcb_gtm', 'vc_deck_creditbridge', NULL, 'ai', 'vc_gtm_strategy', 7, 'Channel plan is reasonable but acquisition cost is unclear.'),
  ('ais_vcb_team', 'vc_deck_creditbridge', NULL, 'ai', 'vc_team_execution', 9, 'Founders have direct, relevant operating experience in this domain.'),
  ('ais_vcb_risk', 'vc_deck_creditbridge', NULL, 'ai', 'vc_business_risks', 5, 'Some risk is acknowledged; regulatory exposure is under-explored.'),
  ('ais_vcb_attr', 'vc_deck_creditbridge', NULL, 'ai', 'vc_business_attractiveness', 8, 'Compelling category-leader potential on the evidence shown.'),
  ('ais_vcb_clim', 'vc_deck_creditbridge', NULL, 'ai', 'vc_climate_impact', 8, 'Credible, measured climate or sustainability impact with real numbers.'),
  ('ais_vcb_story', 'vc_deck_creditbridge', NULL, 'ai', 'vc_storytelling', 6, 'Readable deck, though the story loses shape in the middle.');
INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, verdict, remarks, submitted_at, scored_criteria_version, scored_content_version) VALUES
  ('vc_deck_creditbridge_ai_eval', 'vc_deck_creditbridge', NULL, 7.5, 'advanced', 'AI evaluation', '2026-05-02T09:00:00Z', 1, 1);

-- AgriChain — ai_score 6.9
INSERT INTO scores (id, deck_id, evaluator_id, evaluator_kind, parameter_id, value, comment) VALUES
  ('ais_vac_pmc', 'vc_deck_agrichain', NULL, 'ai', 'vc_problem_market_clarity', 7, 'The problem is stated clearly enough, though the affected segment stays broad.'),
  ('ais_vac_svp', 'vc_deck_agrichain', NULL, 'ai', 'vc_solution_value_prop', 6, 'The solution is understandable but its advantage over incumbents is thin.'),
  ('ais_vac_mkt', 'vc_deck_agrichain', NULL, 'ai', 'vc_market_size', 9, 'Market is sized bottom-up from a defensible wedge.'),
  ('ais_vac_prod', 'vc_deck_agrichain', NULL, 'ai', 'vc_product_technology', 9, 'A working product with genuine technical depth behind it.'),
  ('ais_vac_bm', 'vc_deck_agrichain', NULL, 'ai', 'vc_business_model', 5, 'Revenue model is stated but unit economics remain unproven.'),
  ('ais_vac_trac', 'vc_deck_agrichain', NULL, 'ai', 'vc_traction_validation', 9, 'Strong, verifiable traction with consistent growth quarter on quarter.'),
  ('ais_vac_comp', 'vc_deck_agrichain', NULL, 'ai', 'vc_competitive_landscape', 6, 'Competition is acknowledged but incumbents are not directly addressed.'),
  ('ais_vac_gtm', 'vc_deck_agrichain', NULL, 'ai', 'vc_gtm_strategy', 6, 'Channel plan is reasonable but acquisition cost is unclear.'),
  ('ais_vac_team', 'vc_deck_agrichain', NULL, 'ai', 'vc_team_execution', 7, 'Capable team, though a key functional gap is still open.'),
  ('ais_vac_risk', 'vc_deck_agrichain', NULL, 'ai', 'vc_business_risks', 9, 'Key risks are named candidly with credible mitigations.'),
  ('ais_vac_attr', 'vc_deck_agrichain', NULL, 'ai', 'vc_business_attractiveness', 7, 'A solid opportunity, but not breakout on this deck.'),
  ('ais_vac_clim', 'vc_deck_agrichain', NULL, 'ai', 'vc_climate_impact', 2, 'No climate or sustainability dimension is presented.'),
  ('ais_vac_story', 'vc_deck_agrichain', NULL, 'ai', 'vc_storytelling', 10, 'A clean, investor-ready narrative that is easy to follow.');
INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, verdict, remarks, submitted_at, scored_criteria_version, scored_content_version) VALUES
  ('vc_deck_agrichain_ai_eval', 'vc_deck_agrichain', NULL, 6.9, 'advanced', 'AI evaluation', '2026-05-03T09:00:00Z', 1, 1);

-- MedGrid — ai_score 8.4
INSERT INTO scores (id, deck_id, evaluator_id, evaluator_kind, parameter_id, value, comment) VALUES
  ('ais_vmg_pmc', 'vc_deck_medgrid', NULL, 'ai', 'vc_problem_market_clarity', 8, 'The problem is sharply framed with a named customer and a real cost.'),
  ('ais_vmg_svp', 'vc_deck_medgrid', NULL, 'ai', 'vc_solution_value_prop', 8, 'The value proposition is concrete and clearly better than the status quo.'),
  ('ais_vmg_mkt', 'vc_deck_medgrid', NULL, 'ai', 'vc_market_size', 9, 'Market is sized bottom-up from a defensible wedge.'),
  ('ais_vmg_prod', 'vc_deck_medgrid', NULL, 'ai', 'vc_product_technology', 7, 'Product exists and functions; the technical moat is not yet obvious.'),
  ('ais_vmg_bm', 'vc_deck_medgrid', NULL, 'ai', 'vc_business_model', 10, 'Pricing and unit economics are shown and hold together.'),
  ('ais_vmg_trac', 'vc_deck_medgrid', NULL, 'ai', 'vc_traction_validation', 10, 'Strong, verifiable traction with consistent growth quarter on quarter.'),
  ('ais_vmg_comp', 'vc_deck_medgrid', NULL, 'ai', 'vc_competitive_landscape', 8, 'Competitors are named and the wedge against them is argued well.'),
  ('ais_vmg_gtm', 'vc_deck_medgrid', NULL, 'ai', 'vc_gtm_strategy', 7, 'Channel plan is reasonable but acquisition cost is unclear.'),
  ('ais_vmg_team', 'vc_deck_medgrid', NULL, 'ai', 'vc_team_execution', 7, 'Capable team, though a key functional gap is still open.'),
  ('ais_vmg_risk', 'vc_deck_medgrid', NULL, 'ai', 'vc_business_risks', 7, 'Some risk is acknowledged; regulatory exposure is under-explored.'),
  ('ais_vmg_attr', 'vc_deck_medgrid', NULL, 'ai', 'vc_business_attractiveness', 8, 'Compelling category-leader potential on the evidence shown.'),
  ('ais_vmg_clim', 'vc_deck_medgrid', NULL, 'ai', 'vc_climate_impact', 10, 'Credible, measured climate or sustainability impact with real numbers.'),
  ('ais_vmg_story', 'vc_deck_medgrid', NULL, 'ai', 'vc_storytelling', 10, 'A clean, investor-ready narrative that is easy to follow.');
INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, verdict, remarks, submitted_at, scored_criteria_version, scored_content_version) VALUES
  ('vc_deck_medgrid_ai_eval', 'vc_deck_medgrid', NULL, 8.4, 'advanced', 'AI evaluation', '2026-05-04T09:00:00Z', 1, 1);

-- SolarNest — ai_score 7.9
INSERT INTO scores (id, deck_id, evaluator_id, evaluator_kind, parameter_id, value, comment) VALUES
  ('ais_vsn_pmc', 'vc_deck_solarnest', NULL, 'ai', 'vc_problem_market_clarity', 10, 'The problem is sharply framed with a named customer and a real cost.'),
  ('ais_vsn_svp', 'vc_deck_solarnest', NULL, 'ai', 'vc_solution_value_prop', 7, 'The solution is understandable but its advantage over incumbents is thin.'),
  ('ais_vsn_mkt', 'vc_deck_solarnest', NULL, 'ai', 'vc_market_size', 9, 'Market is sized bottom-up from a defensible wedge.'),
  ('ais_vsn_prod', 'vc_deck_solarnest', NULL, 'ai', 'vc_product_technology', 7, 'Product exists and functions; the technical moat is not yet obvious.'),
  ('ais_vsn_bm', 'vc_deck_solarnest', NULL, 'ai', 'vc_business_model', 10, 'Pricing and unit economics are shown and hold together.'),
  ('ais_vsn_trac', 'vc_deck_solarnest', NULL, 'ai', 'vc_traction_validation', 8, 'Strong, verifiable traction with consistent growth quarter on quarter.'),
  ('ais_vsn_comp', 'vc_deck_solarnest', NULL, 'ai', 'vc_competitive_landscape', 7, 'Competition is acknowledged but incumbents are not directly addressed.'),
  ('ais_vsn_gtm', 'vc_deck_solarnest', NULL, 'ai', 'vc_gtm_strategy', 7, 'Channel plan is reasonable but acquisition cost is unclear.'),
  ('ais_vsn_team', 'vc_deck_solarnest', NULL, 'ai', 'vc_team_execution', 10, 'Founders have direct, relevant operating experience in this domain.'),
  ('ais_vsn_risk', 'vc_deck_solarnest', NULL, 'ai', 'vc_business_risks', 10, 'Key risks are named candidly with credible mitigations.'),
  ('ais_vsn_attr', 'vc_deck_solarnest', NULL, 'ai', 'vc_business_attractiveness', 9, 'Compelling category-leader potential on the evidence shown.'),
  ('ais_vsn_clim', 'vc_deck_solarnest', NULL, 'ai', 'vc_climate_impact', 1, 'No climate or sustainability dimension is presented.'),
  ('ais_vsn_story', 'vc_deck_solarnest', NULL, 'ai', 'vc_storytelling', 9, 'A clean, investor-ready narrative that is easy to follow.');
INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, verdict, remarks, submitted_at, scored_criteria_version, scored_content_version) VALUES
  ('vc_deck_solarnest_ai_eval', 'vc_deck_solarnest', NULL, 7.9, 'advanced', 'AI evaluation', '2026-05-05T09:00:00Z', 1, 1);

-- DockFlow — ai_score 8.2
INSERT INTO scores (id, deck_id, evaluator_id, evaluator_kind, parameter_id, value, comment) VALUES
  ('ais_vdf_pmc', 'vc_deck_dockflow', NULL, 'ai', 'vc_problem_market_clarity', 8, 'The problem is sharply framed with a named customer and a real cost.'),
  ('ais_vdf_svp', 'vc_deck_dockflow', NULL, 'ai', 'vc_solution_value_prop', 7, 'The solution is understandable but its advantage over incumbents is thin.'),
  ('ais_vdf_mkt', 'vc_deck_dockflow', NULL, 'ai', 'vc_market_size', 8, 'Market is sized bottom-up from a defensible wedge.'),
  ('ais_vdf_prod', 'vc_deck_dockflow', NULL, 'ai', 'vc_product_technology', 8, 'A working product with genuine technical depth behind it.'),
  ('ais_vdf_bm', 'vc_deck_dockflow', NULL, 'ai', 'vc_business_model', 8, 'Pricing and unit economics are shown and hold together.'),
  ('ais_vdf_trac', 'vc_deck_dockflow', NULL, 'ai', 'vc_traction_validation', 10, 'Strong, verifiable traction with consistent growth quarter on quarter.'),
  ('ais_vdf_comp', 'vc_deck_dockflow', NULL, 'ai', 'vc_competitive_landscape', 10, 'Competitors are named and the wedge against them is argued well.'),
  ('ais_vdf_gtm', 'vc_deck_dockflow', NULL, 'ai', 'vc_gtm_strategy', 9, 'A specific channel plan with sensible CAC payback assumptions.'),
  ('ais_vdf_team', 'vc_deck_dockflow', NULL, 'ai', 'vc_team_execution', 7, 'Capable team, though a key functional gap is still open.'),
  ('ais_vdf_risk', 'vc_deck_dockflow', NULL, 'ai', 'vc_business_risks', 8, 'Key risks are named candidly with credible mitigations.'),
  ('ais_vdf_attr', 'vc_deck_dockflow', NULL, 'ai', 'vc_business_attractiveness', 8, 'Compelling category-leader potential on the evidence shown.'),
  ('ais_vdf_clim', 'vc_deck_dockflow', NULL, 'ai', 'vc_climate_impact', 8, 'Credible, measured climate or sustainability impact with real numbers.'),
  ('ais_vdf_story', 'vc_deck_dockflow', NULL, 'ai', 'vc_storytelling', 8, 'A clean, investor-ready narrative that is easy to follow.');
INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, verdict, remarks, submitted_at, scored_criteria_version, scored_content_version) VALUES
  ('vc_deck_dockflow_ai_eval', 'vc_deck_dockflow', NULL, 8.2, 'advanced', 'AI evaluation', '2026-05-06T09:00:00Z', 1, 1);

-- LearnLoop — ai_score 8
INSERT INTO scores (id, deck_id, evaluator_id, evaluator_kind, parameter_id, value, comment) VALUES
  ('ais_vll_pmc', 'vc_deck_learnloop', NULL, 'ai', 'vc_problem_market_clarity', 8, 'The problem is sharply framed with a named customer and a real cost.'),
  ('ais_vll_svp', 'vc_deck_learnloop', NULL, 'ai', 'vc_solution_value_prop', 10, 'The value proposition is concrete and clearly better than the status quo.'),
  ('ais_vll_mkt', 'vc_deck_learnloop', NULL, 'ai', 'vc_market_size', 8, 'Market is sized bottom-up from a defensible wedge.'),
  ('ais_vll_prod', 'vc_deck_learnloop', NULL, 'ai', 'vc_product_technology', 6, 'Product exists and functions; the technical moat is not yet obvious.'),
  ('ais_vll_bm', 'vc_deck_learnloop', NULL, 'ai', 'vc_business_model', 8, 'Pricing and unit economics are shown and hold together.'),
  ('ais_vll_trac', 'vc_deck_learnloop', NULL, 'ai', 'vc_traction_validation', 7, 'Early traction is present but the numbers are directional.'),
  ('ais_vll_comp', 'vc_deck_learnloop', NULL, 'ai', 'vc_competitive_landscape', 7, 'Competition is acknowledged but incumbents are not directly addressed.'),
  ('ais_vll_gtm', 'vc_deck_learnloop', NULL, 'ai', 'vc_gtm_strategy', 6, 'Channel plan is reasonable but acquisition cost is unclear.'),
  ('ais_vll_team', 'vc_deck_learnloop', NULL, 'ai', 'vc_team_execution', 8, 'Founders have direct, relevant operating experience in this domain.'),
  ('ais_vll_risk', 'vc_deck_learnloop', NULL, 'ai', 'vc_business_risks', 10, 'Key risks are named candidly with credible mitigations.'),
  ('ais_vll_attr', 'vc_deck_learnloop', NULL, 'ai', 'vc_business_attractiveness', 8, 'Compelling category-leader potential on the evidence shown.'),
  ('ais_vll_clim', 'vc_deck_learnloop', NULL, 'ai', 'vc_climate_impact', 9, 'Credible, measured climate or sustainability impact with real numbers.'),
  ('ais_vll_story', 'vc_deck_learnloop', NULL, 'ai', 'vc_storytelling', 8, 'A clean, investor-ready narrative that is easy to follow.');
INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, verdict, remarks, submitted_at, scored_criteria_version, scored_content_version) VALUES
  ('vc_deck_learnloop_ai_eval', 'vc_deck_learnloop', NULL, 8, 'advanced', 'AI evaluation', '2026-05-07T09:00:00Z', 1, 1);

-- FreshCart — ai_score 7.7
INSERT INTO scores (id, deck_id, evaluator_id, evaluator_kind, parameter_id, value, comment) VALUES
  ('ais_vfc_pmc', 'vc_deck_freshcart', NULL, 'ai', 'vc_problem_market_clarity', 7, 'The problem is stated clearly enough, though the affected segment stays broad.'),
  ('ais_vfc_svp', 'vc_deck_freshcart', NULL, 'ai', 'vc_solution_value_prop', 9, 'The value proposition is concrete and clearly better than the status quo.'),
  ('ais_vfc_mkt', 'vc_deck_freshcart', NULL, 'ai', 'vc_market_size', 7, 'TAM is cited top-down; a bottom-up build would strengthen it.'),
  ('ais_vfc_prod', 'vc_deck_freshcart', NULL, 'ai', 'vc_product_technology', 7, 'Product exists and functions; the technical moat is not yet obvious.'),
  ('ais_vfc_bm', 'vc_deck_freshcart', NULL, 'ai', 'vc_business_model', 7, 'Revenue model is stated but unit economics remain unproven.'),
  ('ais_vfc_trac', 'vc_deck_freshcart', NULL, 'ai', 'vc_traction_validation', 6, 'Early traction is present but the numbers are directional.'),
  ('ais_vfc_comp', 'vc_deck_freshcart', NULL, 'ai', 'vc_competitive_landscape', 8, 'Competitors are named and the wedge against them is argued well.'),
  ('ais_vfc_gtm', 'vc_deck_freshcart', NULL, 'ai', 'vc_gtm_strategy', 8, 'A specific channel plan with sensible CAC payback assumptions.'),
  ('ais_vfc_team', 'vc_deck_freshcart', NULL, 'ai', 'vc_team_execution', 7, 'Capable team, though a key functional gap is still open.'),
  ('ais_vfc_risk', 'vc_deck_freshcart', NULL, 'ai', 'vc_business_risks', 10, 'Key risks are named candidly with credible mitigations.'),
  ('ais_vfc_attr', 'vc_deck_freshcart', NULL, 'ai', 'vc_business_attractiveness', 9, 'Compelling category-leader potential on the evidence shown.'),
  ('ais_vfc_clim', 'vc_deck_freshcart', NULL, 'ai', 'vc_climate_impact', 9, 'Credible, measured climate or sustainability impact with real numbers.'),
  ('ais_vfc_story', 'vc_deck_freshcart', NULL, 'ai', 'vc_storytelling', 5, 'Readable deck, though the story loses shape in the middle.');
INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, verdict, remarks, submitted_at, scored_criteria_version, scored_content_version) VALUES
  ('vc_deck_freshcart_ai_eval', 'vc_deck_freshcart', NULL, 7.7, 'advanced', 'AI evaluation', '2026-05-08T09:00:00Z', 1, 1);

-- CyberVault — ai_score 8.6
INSERT INTO scores (id, deck_id, evaluator_id, evaluator_kind, parameter_id, value, comment) VALUES
  ('ais_vcv_pmc', 'vc_deck_cybervault', NULL, 'ai', 'vc_problem_market_clarity', 9, 'The problem is sharply framed with a named customer and a real cost.'),
  ('ais_vcv_svp', 'vc_deck_cybervault', NULL, 'ai', 'vc_solution_value_prop', 7, 'The solution is understandable but its advantage over incumbents is thin.'),
  ('ais_vcv_mkt', 'vc_deck_cybervault', NULL, 'ai', 'vc_market_size', 9, 'Market is sized bottom-up from a defensible wedge.'),
  ('ais_vcv_prod', 'vc_deck_cybervault', NULL, 'ai', 'vc_product_technology', 9, 'A working product with genuine technical depth behind it.'),
  ('ais_vcv_bm', 'vc_deck_cybervault', NULL, 'ai', 'vc_business_model', 8, 'Pricing and unit economics are shown and hold together.'),
  ('ais_vcv_trac', 'vc_deck_cybervault', NULL, 'ai', 'vc_traction_validation', 9, 'Strong, verifiable traction with consistent growth quarter on quarter.'),
  ('ais_vcv_comp', 'vc_deck_cybervault', NULL, 'ai', 'vc_competitive_landscape', 8, 'Competitors are named and the wedge against them is argued well.'),
  ('ais_vcv_gtm', 'vc_deck_cybervault', NULL, 'ai', 'vc_gtm_strategy', 8, 'A specific channel plan with sensible CAC payback assumptions.'),
  ('ais_vcv_team', 'vc_deck_cybervault', NULL, 'ai', 'vc_team_execution', 8, 'Founders have direct, relevant operating experience in this domain.'),
  ('ais_vcv_risk', 'vc_deck_cybervault', NULL, 'ai', 'vc_business_risks', 9, 'Key risks are named candidly with credible mitigations.'),
  ('ais_vcv_attr', 'vc_deck_cybervault', NULL, 'ai', 'vc_business_attractiveness', 8, 'Compelling category-leader potential on the evidence shown.'),
  ('ais_vcv_clim', 'vc_deck_cybervault', NULL, 'ai', 'vc_climate_impact', 10, 'Credible, measured climate or sustainability impact with real numbers.'),
  ('ais_vcv_story', 'vc_deck_cybervault', NULL, 'ai', 'vc_storytelling', 10, 'A clean, investor-ready narrative that is easy to follow.');
INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, verdict, remarks, submitted_at, scored_criteria_version, scored_content_version) VALUES
  ('vc_deck_cybervault_ai_eval', 'vc_deck_cybervault', NULL, 8.6, 'advanced', 'AI evaluation', '2026-05-09T09:00:00Z', 1, 1);

-- QuantIQ — ai_score 9
INSERT INTO scores (id, deck_id, evaluator_id, evaluator_kind, parameter_id, value, comment) VALUES
  ('ais_vqi_pmc', 'vc_deck_quantiq', NULL, 'ai', 'vc_problem_market_clarity', 9, 'The problem is sharply framed with a named customer and a real cost.'),
  ('ais_vqi_svp', 'vc_deck_quantiq', NULL, 'ai', 'vc_solution_value_prop', 10, 'The value proposition is concrete and clearly better than the status quo.'),
  ('ais_vqi_mkt', 'vc_deck_quantiq', NULL, 'ai', 'vc_market_size', 10, 'Market is sized bottom-up from a defensible wedge.'),
  ('ais_vqi_prod', 'vc_deck_quantiq', NULL, 'ai', 'vc_product_technology', 10, 'A working product with genuine technical depth behind it.'),
  ('ais_vqi_bm', 'vc_deck_quantiq', NULL, 'ai', 'vc_business_model', 10, 'Pricing and unit economics are shown and hold together.'),
  ('ais_vqi_trac', 'vc_deck_quantiq', NULL, 'ai', 'vc_traction_validation', 8, 'Strong, verifiable traction with consistent growth quarter on quarter.'),
  ('ais_vqi_comp', 'vc_deck_quantiq', NULL, 'ai', 'vc_competitive_landscape', 9, 'Competitors are named and the wedge against them is argued well.'),
  ('ais_vqi_gtm', 'vc_deck_quantiq', NULL, 'ai', 'vc_gtm_strategy', 10, 'A specific channel plan with sensible CAC payback assumptions.'),
  ('ais_vqi_team', 'vc_deck_quantiq', NULL, 'ai', 'vc_team_execution', 8, 'Founders have direct, relevant operating experience in this domain.'),
  ('ais_vqi_risk', 'vc_deck_quantiq', NULL, 'ai', 'vc_business_risks', 8, 'Key risks are named candidly with credible mitigations.'),
  ('ais_vqi_attr', 'vc_deck_quantiq', NULL, 'ai', 'vc_business_attractiveness', 10, 'Compelling category-leader potential on the evidence shown.'),
  ('ais_vqi_clim', 'vc_deck_quantiq', NULL, 'ai', 'vc_climate_impact', 7, 'A sustainability angle is claimed but not quantified.'),
  ('ais_vqi_story', 'vc_deck_quantiq', NULL, 'ai', 'vc_storytelling', 10, 'A clean, investor-ready narrative that is easy to follow.');
INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, verdict, remarks, submitted_at, scored_criteria_version, scored_content_version) VALUES
  ('vc_deck_quantiq_ai_eval', 'vc_deck_quantiq', NULL, 9, 'advanced', 'AI evaluation', '2026-05-11T09:00:00Z', 1, 1);

-- PetPal — ai_score 5.4
INSERT INTO scores (id, deck_id, evaluator_id, evaluator_kind, parameter_id, value, comment) VALUES
  ('ais_vpp_pmc', 'vc_deck_petpal', NULL, 'ai', 'vc_problem_market_clarity', 6, 'The problem is stated clearly enough, though the affected segment stays broad.'),
  ('ais_vpp_svp', 'vc_deck_petpal', NULL, 'ai', 'vc_solution_value_prop', 4, 'The solution reads as a feature list; the value to the buyer is unclear.'),
  ('ais_vpp_mkt', 'vc_deck_petpal', NULL, 'ai', 'vc_market_size', 5, 'TAM is cited top-down; a bottom-up build would strengthen it.'),
  ('ais_vpp_prod', 'vc_deck_petpal', NULL, 'ai', 'vc_product_technology', 5, 'Product exists and functions; the technical moat is not yet obvious.'),
  ('ais_vpp_bm', 'vc_deck_petpal', NULL, 'ai', 'vc_business_model', 3, 'No clear path from usage to revenue is presented.'),
  ('ais_vpp_trac', 'vc_deck_petpal', NULL, 'ai', 'vc_traction_validation', 6, 'Early traction is present but the numbers are directional.'),
  ('ais_vpp_comp', 'vc_deck_petpal', NULL, 'ai', 'vc_competitive_landscape', 8, 'Competitors are named and the wedge against them is argued well.'),
  ('ais_vpp_gtm', 'vc_deck_petpal', NULL, 'ai', 'vc_gtm_strategy', 4, 'Go-to-market is aspirational; no channel has been tested.'),
  ('ais_vpp_team', 'vc_deck_petpal', NULL, 'ai', 'vc_team_execution', 6, 'Capable team, though a key functional gap is still open.'),
  ('ais_vpp_risk', 'vc_deck_petpal', NULL, 'ai', 'vc_business_risks', 7, 'Some risk is acknowledged; regulatory exposure is under-explored.'),
  ('ais_vpp_attr', 'vc_deck_petpal', NULL, 'ai', 'vc_business_attractiveness', 6, 'A solid opportunity, but not breakout on this deck.'),
  ('ais_vpp_clim', 'vc_deck_petpal', NULL, 'ai', 'vc_climate_impact', 5, 'A sustainability angle is claimed but not quantified.'),
  ('ais_vpp_story', 'vc_deck_petpal', NULL, 'ai', 'vc_storytelling', 5, 'Readable deck, though the story loses shape in the middle.');
INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, verdict, remarks, submitted_at, scored_criteria_version, scored_content_version) VALUES
  ('vc_deck_petpal_ai_eval', 'vc_deck_petpal', NULL, 5.4, 'archived', 'AI evaluation', '2026-05-12T09:00:00Z', 1, 1);

-- GridZero — ai_score 8.3
INSERT INTO scores (id, deck_id, evaluator_id, evaluator_kind, parameter_id, value, comment) VALUES
  ('ais_vgz_pmc', 'vc_deck_gridzero', NULL, 'ai', 'vc_problem_market_clarity', 6, 'The problem is stated clearly enough, though the affected segment stays broad.'),
  ('ais_vgz_svp', 'vc_deck_gridzero', NULL, 'ai', 'vc_solution_value_prop', 7, 'The solution is understandable but its advantage over incumbents is thin.'),
  ('ais_vgz_mkt', 'vc_deck_gridzero', NULL, 'ai', 'vc_market_size', 10, 'Market is sized bottom-up from a defensible wedge.'),
  ('ais_vgz_prod', 'vc_deck_gridzero', NULL, 'ai', 'vc_product_technology', 10, 'A working product with genuine technical depth behind it.'),
  ('ais_vgz_bm', 'vc_deck_gridzero', NULL, 'ai', 'vc_business_model', 9, 'Pricing and unit economics are shown and hold together.'),
  ('ais_vgz_trac', 'vc_deck_gridzero', NULL, 'ai', 'vc_traction_validation', 7, 'Early traction is present but the numbers are directional.'),
  ('ais_vgz_comp', 'vc_deck_gridzero', NULL, 'ai', 'vc_competitive_landscape', 9, 'Competitors are named and the wedge against them is argued well.'),
  ('ais_vgz_gtm', 'vc_deck_gridzero', NULL, 'ai', 'vc_gtm_strategy', 8, 'A specific channel plan with sensible CAC payback assumptions.'),
  ('ais_vgz_team', 'vc_deck_gridzero', NULL, 'ai', 'vc_team_execution', 7, 'Capable team, though a key functional gap is still open.'),
  ('ais_vgz_risk', 'vc_deck_gridzero', NULL, 'ai', 'vc_business_risks', 8, 'Key risks are named candidly with credible mitigations.'),
  ('ais_vgz_attr', 'vc_deck_gridzero', NULL, 'ai', 'vc_business_attractiveness', 10, 'Compelling category-leader potential on the evidence shown.'),
  ('ais_vgz_clim', 'vc_deck_gridzero', NULL, 'ai', 'vc_climate_impact', 10, 'Credible, measured climate or sustainability impact with real numbers.'),
  ('ais_vgz_story', 'vc_deck_gridzero', NULL, 'ai', 'vc_storytelling', 7, 'Readable deck, though the story loses shape in the middle.');
INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, verdict, remarks, submitted_at, scored_criteria_version, scored_content_version) VALUES
  ('vc_deck_gridzero_ai_eval', 'vc_deck_gridzero', NULL, 8.3, 'advanced', 'AI evaluation', '2026-05-13T09:00:00Z', 1, 1);

-- FinStack — ai_score 8
INSERT INTO scores (id, deck_id, evaluator_id, evaluator_kind, parameter_id, value, comment) VALUES
  ('ais_vfs_pmc', 'vc_deck_finstackvc', NULL, 'ai', 'vc_problem_market_clarity', 10, 'The problem is sharply framed with a named customer and a real cost.'),
  ('ais_vfs_svp', 'vc_deck_finstackvc', NULL, 'ai', 'vc_solution_value_prop', 9, 'The value proposition is concrete and clearly better than the status quo.'),
  ('ais_vfs_mkt', 'vc_deck_finstackvc', NULL, 'ai', 'vc_market_size', 6, 'TAM is cited top-down; a bottom-up build would strengthen it.'),
  ('ais_vfs_prod', 'vc_deck_finstackvc', NULL, 'ai', 'vc_product_technology', 8, 'A working product with genuine technical depth behind it.'),
  ('ais_vfs_bm', 'vc_deck_finstackvc', NULL, 'ai', 'vc_business_model', 7, 'Revenue model is stated but unit economics remain unproven.'),
  ('ais_vfs_trac', 'vc_deck_finstackvc', NULL, 'ai', 'vc_traction_validation', 9, 'Strong, verifiable traction with consistent growth quarter on quarter.'),
  ('ais_vfs_comp', 'vc_deck_finstackvc', NULL, 'ai', 'vc_competitive_landscape', 8, 'Competitors are named and the wedge against them is argued well.'),
  ('ais_vfs_gtm', 'vc_deck_finstackvc', NULL, 'ai', 'vc_gtm_strategy', 7, 'Channel plan is reasonable but acquisition cost is unclear.'),
  ('ais_vfs_team', 'vc_deck_finstackvc', NULL, 'ai', 'vc_team_execution', 8, 'Founders have direct, relevant operating experience in this domain.'),
  ('ais_vfs_risk', 'vc_deck_finstackvc', NULL, 'ai', 'vc_business_risks', 7, 'Some risk is acknowledged; regulatory exposure is under-explored.'),
  ('ais_vfs_attr', 'vc_deck_finstackvc', NULL, 'ai', 'vc_business_attractiveness', 9, 'Compelling category-leader potential on the evidence shown.'),
  ('ais_vfs_clim', 'vc_deck_finstackvc', NULL, 'ai', 'vc_climate_impact', 7, 'A sustainability angle is claimed but not quantified.'),
  ('ais_vfs_story', 'vc_deck_finstackvc', NULL, 'ai', 'vc_storytelling', 9, 'A clean, investor-ready narrative that is easy to follow.');
INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, verdict, remarks, submitted_at, scored_criteria_version, scored_content_version) VALUES
  ('vc_deck_finstackvc_ai_eval', 'vc_deck_finstackvc', NULL, 8, 'advanced', 'AI evaluation', '2026-05-14T09:00:00Z', 1, 1);

-- InsureFlow — ai_score 7.8
INSERT INTO scores (id, deck_id, evaluator_id, evaluator_kind, parameter_id, value, comment) VALUES
  ('ais_vif_pmc', 'vc_deck_insureflowvc', NULL, 'ai', 'vc_problem_market_clarity', 8, 'The problem is sharply framed with a named customer and a real cost.'),
  ('ais_vif_svp', 'vc_deck_insureflowvc', NULL, 'ai', 'vc_solution_value_prop', 9, 'The value proposition is concrete and clearly better than the status quo.'),
  ('ais_vif_mkt', 'vc_deck_insureflowvc', NULL, 'ai', 'vc_market_size', 8, 'Market is sized bottom-up from a defensible wedge.'),
  ('ais_vif_prod', 'vc_deck_insureflowvc', NULL, 'ai', 'vc_product_technology', 10, 'A working product with genuine technical depth behind it.'),
  ('ais_vif_bm', 'vc_deck_insureflowvc', NULL, 'ai', 'vc_business_model', 9, 'Pricing and unit economics are shown and hold together.'),
  ('ais_vif_trac', 'vc_deck_insureflowvc', NULL, 'ai', 'vc_traction_validation', 9, 'Strong, verifiable traction with consistent growth quarter on quarter.'),
  ('ais_vif_comp', 'vc_deck_insureflowvc', NULL, 'ai', 'vc_competitive_landscape', 8, 'Competitors are named and the wedge against them is argued well.'),
  ('ais_vif_gtm', 'vc_deck_insureflowvc', NULL, 'ai', 'vc_gtm_strategy', 6, 'Channel plan is reasonable but acquisition cost is unclear.'),
  ('ais_vif_team', 'vc_deck_insureflowvc', NULL, 'ai', 'vc_team_execution', 8, 'Founders have direct, relevant operating experience in this domain.'),
  ('ais_vif_risk', 'vc_deck_insureflowvc', NULL, 'ai', 'vc_business_risks', 7, 'Some risk is acknowledged; regulatory exposure is under-explored.'),
  ('ais_vif_attr', 'vc_deck_insureflowvc', NULL, 'ai', 'vc_business_attractiveness', 10, 'Compelling category-leader potential on the evidence shown.'),
  ('ais_vif_clim', 'vc_deck_insureflowvc', NULL, 'ai', 'vc_climate_impact', 2, 'No climate or sustainability dimension is presented.'),
  ('ais_vif_story', 'vc_deck_insureflowvc', NULL, 'ai', 'vc_storytelling', 9, 'A clean, investor-ready narrative that is easy to follow.');
INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, verdict, remarks, submitted_at, scored_criteria_version, scored_content_version) VALUES
  ('vc_deck_insureflowvc_ai_eval', 'vc_deck_insureflowvc', NULL, 7.8, 'advanced', 'AI evaluation', '2026-05-15T09:00:00Z', 1, 1);

-- AgriChain — ai_score 7.4
INSERT INTO scores (id, deck_id, evaluator_id, evaluator_kind, parameter_id, value, comment) VALUES
  ('ais_vac2_pmc', 'vc_deck_agrichainvc', NULL, 'ai', 'vc_problem_market_clarity', 8, 'The problem is sharply framed with a named customer and a real cost.'),
  ('ais_vac2_svp', 'vc_deck_agrichainvc', NULL, 'ai', 'vc_solution_value_prop', 8, 'The value proposition is concrete and clearly better than the status quo.'),
  ('ais_vac2_mkt', 'vc_deck_agrichainvc', NULL, 'ai', 'vc_market_size', 7, 'TAM is cited top-down; a bottom-up build would strengthen it.'),
  ('ais_vac2_prod', 'vc_deck_agrichainvc', NULL, 'ai', 'vc_product_technology', 9, 'A working product with genuine technical depth behind it.'),
  ('ais_vac2_bm', 'vc_deck_agrichainvc', NULL, 'ai', 'vc_business_model', 7, 'Revenue model is stated but unit economics remain unproven.'),
  ('ais_vac2_trac', 'vc_deck_agrichainvc', NULL, 'ai', 'vc_traction_validation', 8, 'Strong, verifiable traction with consistent growth quarter on quarter.'),
  ('ais_vac2_comp', 'vc_deck_agrichainvc', NULL, 'ai', 'vc_competitive_landscape', 7, 'Competition is acknowledged but incumbents are not directly addressed.'),
  ('ais_vac2_gtm', 'vc_deck_agrichainvc', NULL, 'ai', 'vc_gtm_strategy', 8, 'A specific channel plan with sensible CAC payback assumptions.'),
  ('ais_vac2_team', 'vc_deck_agrichainvc', NULL, 'ai', 'vc_team_execution', 6, 'Capable team, though a key functional gap is still open.'),
  ('ais_vac2_risk', 'vc_deck_agrichainvc', NULL, 'ai', 'vc_business_risks', 8, 'Key risks are named candidly with credible mitigations.'),
  ('ais_vac2_attr', 'vc_deck_agrichainvc', NULL, 'ai', 'vc_business_attractiveness', 6, 'A solid opportunity, but not breakout on this deck.'),
  ('ais_vac2_clim', 'vc_deck_agrichainvc', NULL, 'ai', 'vc_climate_impact', 7, 'A sustainability angle is claimed but not quantified.'),
  ('ais_vac2_story', 'vc_deck_agrichainvc', NULL, 'ai', 'vc_storytelling', 8, 'A clean, investor-ready narrative that is easy to follow.');
INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, verdict, remarks, submitted_at, scored_criteria_version, scored_content_version) VALUES
  ('vc_deck_agrichainvc_ai_eval', 'vc_deck_agrichainvc', NULL, 7.4, 'advanced', 'AI evaluation', '2026-05-16T09:00:00Z', 1, 1);

-- LedgerLoop — ai_score 8.1
INSERT INTO scores (id, deck_id, evaluator_id, evaluator_kind, parameter_id, value, comment) VALUES
  ('ais_vlp_pmc', 'vc_deck_b2bsaas', NULL, 'ai', 'vc_problem_market_clarity', 8, 'The problem is sharply framed with a named customer and a real cost.'),
  ('ais_vlp_svp', 'vc_deck_b2bsaas', NULL, 'ai', 'vc_solution_value_prop', 7, 'The solution is understandable but its advantage over incumbents is thin.'),
  ('ais_vlp_mkt', 'vc_deck_b2bsaas', NULL, 'ai', 'vc_market_size', 10, 'Market is sized bottom-up from a defensible wedge.'),
  ('ais_vlp_prod', 'vc_deck_b2bsaas', NULL, 'ai', 'vc_product_technology', 8, 'A working product with genuine technical depth behind it.'),
  ('ais_vlp_bm', 'vc_deck_b2bsaas', NULL, 'ai', 'vc_business_model', 9, 'Pricing and unit economics are shown and hold together.'),
  ('ais_vlp_trac', 'vc_deck_b2bsaas', NULL, 'ai', 'vc_traction_validation', 7, 'Early traction is present but the numbers are directional.'),
  ('ais_vlp_comp', 'vc_deck_b2bsaas', NULL, 'ai', 'vc_competitive_landscape', 6, 'Competition is acknowledged but incumbents are not directly addressed.'),
  ('ais_vlp_gtm', 'vc_deck_b2bsaas', NULL, 'ai', 'vc_gtm_strategy', 6, 'Channel plan is reasonable but acquisition cost is unclear.'),
  ('ais_vlp_team', 'vc_deck_b2bsaas', NULL, 'ai', 'vc_team_execution', 9, 'Founders have direct, relevant operating experience in this domain.'),
  ('ais_vlp_risk', 'vc_deck_b2bsaas', NULL, 'ai', 'vc_business_risks', 9, 'Key risks are named candidly with credible mitigations.'),
  ('ais_vlp_attr', 'vc_deck_b2bsaas', NULL, 'ai', 'vc_business_attractiveness', 7, 'A solid opportunity, but not breakout on this deck.'),
  ('ais_vlp_clim', 'vc_deck_b2bsaas', NULL, 'ai', 'vc_climate_impact', 10, 'Credible, measured climate or sustainability impact with real numbers.'),
  ('ais_vlp_story', 'vc_deck_b2bsaas', NULL, 'ai', 'vc_storytelling', 8, 'A clean, investor-ready narrative that is easy to follow.');
INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, verdict, remarks, submitted_at, scored_criteria_version, scored_content_version) VALUES
  ('vc_deck_b2bsaas_ai_eval', 'vc_deck_b2bsaas', NULL, 8.1, 'advanced', 'AI evaluation', '2026-05-17T09:00:00Z', 1, 1);

-- ClimaCore — ai_score 8.5
INSERT INTO scores (id, deck_id, evaluator_id, evaluator_kind, parameter_id, value, comment) VALUES
  ('ais_vcc_pmc', 'vc_deck_climacore', NULL, 'ai', 'vc_problem_market_clarity', 8, 'The problem is sharply framed with a named customer and a real cost.'),
  ('ais_vcc_svp', 'vc_deck_climacore', NULL, 'ai', 'vc_solution_value_prop', 9, 'The value proposition is concrete and clearly better than the status quo.'),
  ('ais_vcc_mkt', 'vc_deck_climacore', NULL, 'ai', 'vc_market_size', 7, 'TAM is cited top-down; a bottom-up build would strengthen it.'),
  ('ais_vcc_prod', 'vc_deck_climacore', NULL, 'ai', 'vc_product_technology', 9, 'A working product with genuine technical depth behind it.'),
  ('ais_vcc_bm', 'vc_deck_climacore', NULL, 'ai', 'vc_business_model', 7, 'Revenue model is stated but unit economics remain unproven.'),
  ('ais_vcc_trac', 'vc_deck_climacore', NULL, 'ai', 'vc_traction_validation', 9, 'Strong, verifiable traction with consistent growth quarter on quarter.'),
  ('ais_vcc_comp', 'vc_deck_climacore', NULL, 'ai', 'vc_competitive_landscape', 9, 'Competitors are named and the wedge against them is argued well.'),
  ('ais_vcc_gtm', 'vc_deck_climacore', NULL, 'ai', 'vc_gtm_strategy', 8, 'A specific channel plan with sensible CAC payback assumptions.'),
  ('ais_vcc_team', 'vc_deck_climacore', NULL, 'ai', 'vc_team_execution', 9, 'Founders have direct, relevant operating experience in this domain.'),
  ('ais_vcc_risk', 'vc_deck_climacore', NULL, 'ai', 'vc_business_risks', 8, 'Key risks are named candidly with credible mitigations.'),
  ('ais_vcc_attr', 'vc_deck_climacore', NULL, 'ai', 'vc_business_attractiveness', 8, 'Compelling category-leader potential on the evidence shown.'),
  ('ais_vcc_clim', 'vc_deck_climacore', NULL, 'ai', 'vc_climate_impact', 10, 'Credible, measured climate or sustainability impact with real numbers.'),
  ('ais_vcc_story', 'vc_deck_climacore', NULL, 'ai', 'vc_storytelling', 9, 'A clean, investor-ready narrative that is easy to follow.');
INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, verdict, remarks, submitted_at, scored_criteria_version, scored_content_version) VALUES
  ('vc_deck_climacore_ai_eval', 'vc_deck_climacore', NULL, 8.5, 'advanced', 'AI evaluation', '2026-05-18T09:00:00Z', 1, 1);

-- PayWise — ai_score 7.6
INSERT INTO scores (id, deck_id, evaluator_id, evaluator_kind, parameter_id, value, comment) VALUES
  ('ais_vpw_pmc', 'vc_deck_paywise', NULL, 'ai', 'vc_problem_market_clarity', 5, 'The problem is stated clearly enough, though the affected segment stays broad.'),
  ('ais_vpw_svp', 'vc_deck_paywise', NULL, 'ai', 'vc_solution_value_prop', 8, 'The value proposition is concrete and clearly better than the status quo.'),
  ('ais_vpw_mkt', 'vc_deck_paywise', NULL, 'ai', 'vc_market_size', 10, 'Market is sized bottom-up from a defensible wedge.'),
  ('ais_vpw_prod', 'vc_deck_paywise', NULL, 'ai', 'vc_product_technology', 10, 'A working product with genuine technical depth behind it.'),
  ('ais_vpw_bm', 'vc_deck_paywise', NULL, 'ai', 'vc_business_model', 8, 'Pricing and unit economics are shown and hold together.'),
  ('ais_vpw_trac', 'vc_deck_paywise', NULL, 'ai', 'vc_traction_validation', 9, 'Strong, verifiable traction with consistent growth quarter on quarter.'),
  ('ais_vpw_comp', 'vc_deck_paywise', NULL, 'ai', 'vc_competitive_landscape', 7, 'Competition is acknowledged but incumbents are not directly addressed.'),
  ('ais_vpw_gtm', 'vc_deck_paywise', NULL, 'ai', 'vc_gtm_strategy', 10, 'A specific channel plan with sensible CAC payback assumptions.'),
  ('ais_vpw_team', 'vc_deck_paywise', NULL, 'ai', 'vc_team_execution', 8, 'Founders have direct, relevant operating experience in this domain.'),
  ('ais_vpw_risk', 'vc_deck_paywise', NULL, 'ai', 'vc_business_risks', 7, 'Some risk is acknowledged; regulatory exposure is under-explored.'),
  ('ais_vpw_attr', 'vc_deck_paywise', NULL, 'ai', 'vc_business_attractiveness', 10, 'Compelling category-leader potential on the evidence shown.'),
  ('ais_vpw_clim', 'vc_deck_paywise', NULL, 'ai', 'vc_climate_impact', 2, 'No climate or sustainability dimension is presented.'),
  ('ais_vpw_story', 'vc_deck_paywise', NULL, 'ai', 'vc_storytelling', 6, 'Readable deck, though the story loses shape in the middle.');
INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, verdict, remarks, submitted_at, scored_criteria_version, scored_content_version) VALUES
  ('vc_deck_paywise_ai_eval', 'vc_deck_paywise', NULL, 7.6, 'advanced', 'AI evaluation', '2026-05-19T09:00:00Z', 1, 1);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Duplicate / returning-company intake flags (Session 5)
-- ─────────────────────────────────────────────────────────────────────────────
-- The seed already contained the two cases the feature exists for; they were
-- simply never flagged, because `classifyIntake` runs at upload time and these
-- decks were inserted by a migration.
--
-- AgriChain appears twice inside the VC edition: once in Deep Tech Fund
-- (partner_review) and once in Fund II (onboarded). The later one is a RETURNING
-- company — the earlier application concluded and the cohort differs — which is
-- the soft history tag, never a block.
UPDATE decks
   SET intake_flag = 'returning',
       intake_flag_note = 'AgriChain applied to Deep Tech Fund earlier; that application concluded and this is a new fund.',
       related_deck_id = 'vc_deck_agrichain'
 WHERE id = 'vc_deck_agrichainvc';

-- FinStack and InsureFlow each appear in BOTH editions. That is not a duplicate —
-- the editions are separate workspaces and `classifyIntake` only ever matches
-- within an edition — so they are deliberately left unflagged.

-- WealthOS is the incubator's own returning case: it graduated the incubator and
-- the VC edition holds a separate application. Within the incubator the deck is
-- a first application, so no flag. Left unflagged on purpose.

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. AI-health surface (§9 / Session 7) — one deck that genuinely failed
-- ─────────────────────────────────────────────────────────────────────────────
-- Without this the dashboard's "could not be evaluated" banner, the deck row's
-- failure reason and `POST /decks/:id/retry-ai` have nothing to render on the
-- demo. `ai_failed_at` is set, so the `*/10 * * * *` cron sweep SKIPS this deck
-- (`sweepStuckEvaluations` filters on `ai_failed_at IS NULL`) — the fixture
-- cannot be re-driven behind your back, and it does not consume a credit.
--
-- NB it has no `r2_key`. "Re-run AI" on this deck will re-reserve a credit and
-- then fail again with a missing-PDF error, which is honest but not a good demo
-- beat — the runbook says to demo the recovery on a freshly uploaded deck.
INSERT INTO decks
  (id, edition, name, sector, stage, city, status, ai_score, signal, uploaded_by,
   complete, program_id, cohort_id, founder, founder_email, founder_phone,
   ai_error, ai_attempts, ai_last_attempt_at, ai_failed_at, ai_credit_refunded,
   created_at, updated_at)
VALUES
  ('inc_deck_pitchloop', 'incubator', 'PitchLoop', 'Edtech', 'Pre-seed', 'Pune',
   'pending_ai', NULL, NULL, 'inc_pa', 1,
   'prog_incubator_0001', 'coh_0001', 'Nandita Bose', 'nandita@pitchloop.example', '+91 98200 41155',
   'Anthropic rejected the request: credit balance too low.', 3,
   '2026-08-11T18:40:00.000Z', '2026-08-11T18:40:00.000Z', 1,
   '2026-08-11T18:10:00.000Z', '2026-08-11T18:40:00.000Z');

-- The seeded issue `iss_seed_3` describes exactly this class of failure, so
-- point it at the deck that now demonstrates it.
UPDATE tickets
   SET body = 'Two of twenty never left Pending AI after a bulk upload; no error was surfaced anywhere in the UI. '
              || 'Since the Session-7 fix the reason is recorded on the deck (see PitchLoop) and the sweep re-drives it.',
       -- ISSUE_STATUSES is open | in_progress | closed — there is no 'resolved'.
       status = 'closed',
       resolution = 'Fixed: dead-letter queue + a 10-minute cron sweep now record the real failure reason, refund the credit once, and surface an AI-health banner with a Re-run AI action.',
       updated_at = '2026-08-12T10:00:00.000Z'
 WHERE id = 'iss_seed_3';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. VC Incomplete deck + founder query — the VC half of the resubmit loop
-- ─────────────────────────────────────────────────────────────────────────────
-- The VC Query screen lists decks in incomplete/analyst_scoring/associate_review;
-- before this, only WealthOS matched and it had no query thread at all.
INSERT INTO decks
  (id, edition, name, sector, stage, city, status, ai_score, signal, uploaded_by,
   complete, program_id, founder, founder_email, missing_fields, created_at, updated_at)
VALUES
  ('vc_deck_northbeam', 'vc', 'Northbeam Robotics', 'Deep Tech', 'Series A', 'Bengaluru',
   'incomplete', NULL, 'flagged', 'vc_analyst', 0,
   'prog_vc_0004', 'Arjun Varma', 'arjun@northbeam.example', 'founderPhone,city',
   '2026-08-11T07:20:00.000Z', '2026-08-11T07:25:00.000Z');

INSERT INTO deck_extractions (id, deck_id, label, heading, text, sort_order, missing) VALUES
  ('nb_ext_0','vc_deck_northbeam','Cover','Northbeam Robotics','Autonomous inspection robots for transmission infrastructure.',0,0),
  ('nb_ext_1','vc_deck_northbeam','Problem','Manual inspection','Line inspection is manual, slow and dangerous.',1,0),
  ('nb_ext_2','vc_deck_northbeam','Solution','Autonomous crawler','A crawler with an on-board fault-detection model.',2,0),
  ('nb_ext_3','vc_deck_northbeam','Traction',NULL,NULL,3,1),
  ('nb_ext_4','vc_deck_northbeam','Team',NULL,NULL,4,1),
  ('nb_ext_5','vc_deck_northbeam','The ask',NULL,NULL,5,1);

INSERT INTO queries (id, deck_id, questions, email_status, created_at) VALUES
  ('qry_seed_northbeam', 'vc_deck_northbeam',
   'Traction, Team and The ask are missing from the deck. Please add deployment counts, founder bios and the round size, then re-upload.',
   'sent', '2026-08-11T08:00:00.000Z');

INSERT INTO email_outbox (id, deck_id, query_id, kind, to_email, to_name, subject, body, status, created_at) VALUES
  ('mail_seed_northbeam', 'vc_deck_northbeam', 'qry_seed_northbeam', 'founder_query',
   'arjun@northbeam.example', 'Arjun Varma',
   'Action needed: a few questions about Northbeam Robotics',
   'Hi Arjun,' || char(10) || char(10) ||
   'Thanks for submitting Northbeam Robotics. Before we can complete the review, our team needs a little more detail:' || char(10) || char(10) ||
   'Traction, Team and The ask are missing from the deck.' || char(10) || char(10) ||
   '— The ai.STARTUPJURY team',
   'recorded', '2026-08-11T08:00:00.000Z');

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Diligence artifacts for the VC decks sitting in diligence stages
-- ─────────────────────────────────────────────────────────────────────────────
-- These rows are normally written as transition SIDE EFFECTS (Phase 5), so decks
-- placed directly into a DD stage by a seed migration never got one. Per §8,
-- legal DD is a checklist/status only — it is not conducted on-platform — so the
-- row records that it is running, nothing more.
INSERT INTO investment_dd (id, deck_id, notes, mp_approved, created_at) VALUES
  ('idd_seed_solarnest', 'vc_deck_solarnest',
   'Commercial and technical diligence underway; grid-interconnect assumptions under review.', 1,
   '2026-07-28T09:00:00.000Z'),
  ('idd_seed_dockflow', 'vc_deck_dockflow',
   'Diligence complete; MP approved and the file is with the committee for a final decision.', 1,
   '2026-07-30T09:00:00.000Z');

INSERT INTO term_sheets (id, deck_id, valuation, ownership, notes, created_at) VALUES
  ('ts_seed_freshcart', 'vc_deck_freshcart', '₹180 Cr post', '12%',
   'Issued after the alignment call; 1x non-participating preference, standard protective provisions.',
   '2026-08-01T09:00:00.000Z'),
  ('ts_seed_cybervault', 'vc_deck_cybervault', '₹240 Cr post', '10%',
   'Signed; proceeding to legal diligence.', '2026-08-04T09:00:00.000Z');

INSERT INTO legal_dd (id, deck_id, notes, created_at) VALUES
  ('ldd_seed_cybervault', 'vc_deck_cybervault',
   'Checklist with external counsel: cap table, IP assignment, key customer contracts, employment agreements. Status tracked here; the work itself happens off-platform.',
   '2026-08-05T09:00:00.000Z');

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Triage states — not everything is 'open'
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE tickets SET severity = 'low',    area = 'Billing',    status = 'closed',
                   resolution = 'Credits were added to the account; balance confirmed with the admin.',
                   updated_at = '2026-08-09T12:00:00.000Z'
 WHERE category = 'support' AND billing_routed = 1 AND edition = 'incubator';
UPDATE tickets SET severity = 'medium', area = 'Evaluate'
 WHERE category = 'support' AND severity IS NULL;
UPDATE tickets SET status = 'in_progress', assignee_id = 'inc_admin', updated_at = '2026-08-12T05:00:00.000Z'
 WHERE id = 'iss_seed_1';

-- A rescheduled call: same ICS UID, SEQUENCE bumped to 1 — which is what makes a
-- calendar client UPDATE the existing entry instead of creating a second one.
UPDATE calls
   SET scheduled_at = '2026-08-22T11:00:00.000Z',
       ics_sequence = 1,
       remarks = 'Moved at the founder''s request. Re-invited at sequence 1, so calendars update the existing entry.',
       updated_at = '2026-08-12T10:15:00.000Z'
 WHERE id = 'call_seed_medgrid_partner';

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Org identity — branding, sectors
-- ─────────────────────────────────────────────────────────────────────────────
-- `branding_json` was '{}', so the Set up wizard opened blank, the branding
-- preview had nothing to preview, and the Incomplete email said "the programme"
-- rather than naming the org (see `orgName()` in src/server/resubmit.ts).
UPDATE org_settings
   SET branding_json = '{"orgName":"Anthill Ventures Incubator","orgType":"incubator","accent":"#e8a020"}'
 WHERE edition = 'incubator' AND (branding_json IS NULL OR branding_json = '{}');
UPDATE org_settings
   SET branding_json = '{"orgName":"Anthill Capital","orgType":"vc","accent":"#e8a020"}'
 WHERE edition = 'vc' AND (branding_json IS NULL OR branding_json = '{}');

-- `programs.sector` is free text matched against `sectors.name` (Session 2
-- gotcha), and Fund II's 'Multi-sector' had no matching row, so the wizard's
-- sector select had nothing selected for it.
INSERT INTO sectors (id, edition, name, active) VALUES
  ('sec_vc_multi',    'vc',        'Multi-sector', 1),
  ('sec_inc_edtech',  'incubator', 'EdTech',       1),
  ('sec_inc_logistics','incubator','Logistics',    1),
  ('sec_vc_consumer', 'vc',        'Consumer',     1),
  ('sec_vc_cyber',    'vc',        'Cybersecurity',1);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Real uploaded decks — put them inside the hierarchy
-- ─────────────────────────────────────────────────────────────────────────────
-- Decks uploaded against the LIVE Worker (real R2 PDFs, real Claude scores) were
-- created before/outside the Session-2 program selectors and carry
-- `program_id IS NULL`, so the toolbar Program/Cohort filters hid them. Matching
-- on id keeps this a no-op on a fresh local database, where those decks do not
-- exist. Nothing else about them is touched — the scores are genuinely the
-- model's.
UPDATE decks SET program_id = 'prog_incubator_0001', cohort_id = 'coh_0001'
 WHERE edition = 'incubator' AND program_id IS NULL;
UPDATE decks SET program_id = 'prog_vc_0004'
 WHERE edition = 'vc' AND program_id IS NULL;

-- CloudBridge (`deck_1a5467f7…`) is the live demo's §9 victim: it sat at
-- `pending_ai` for 19 days, the Session-7 sweep re-drove it, and after the
-- `temperature` fix it scored and landed Incomplete because two required intake
-- columns really are absent from the PDF. It is KEPT as a second, fully real
-- resubmit-loop case — a genuine deck, a genuine failure, a genuine recovery.
--
-- Its original token was minted at runtime and only its hash was stored, so the
-- link is unrecoverable. Issue a fresh demo token, exactly as 0017 did for
-- NimbusHR (a deliberately readable value on a documented demo deck, granting
-- access to that one deck and nothing else):
--
--   Link: /resubmit/aisj-demo-cloudbridge-resubmit-2026
--
-- Guarded by a SELECT so it is a no-op wherever that deck does not exist.
UPDATE resubmit_tokens SET revoked = 1
 WHERE deck_id = 'deck_1a5467f7-30cb-4967-9e6e-3ac0eb03a942' AND revoked = 0;

INSERT INTO resubmit_tokens (id, deck_id, edition, token_hash, to_email, created_at, expires_at)
SELECT 'rst_seed_cloudbridge', id, 'incubator',
       '668039b4cbfd6f520e8d7191f25953ce340d13a275144861eb002cadc2ded465',
       'priya.sharma@demo.startupjury.ai', '2026-08-12T10:00:00.000Z', '2030-01-01T00:00:00Z'
  FROM decks WHERE id = 'deck_1a5467f7-30cb-4967-9e6e-3ac0eb03a942';

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Make the two Session-1 workbench decks internally consistent
-- ─────────────────────────────────────────────────────────────────────────────
-- 0010 hand-wrote TaxPilot's and WealthOS's thirteen AI scores and, separately,
-- an `ai_score` headline — and the two never agreed: the seeded breakdowns
-- actually weight out to 5.93 and 8.06, not the advertised 6.2 and 8.1. Harmless
-- until an admin edits a weight, at which point `rescoreEdition` recomputes from
-- the score rows and the headline silently jumps.
--
-- The breakdown is the evidence and the composite is derived from it, so the
-- composite moves, not the scores (which carry hand-written rationales that
-- must keep matching their values). Both stay in the same signal band.
UPDATE decks SET ai_score = 5.93 WHERE id = 'inc_deck_taxpilot';
UPDATE decks SET ai_score = 8.06 WHERE id = 'vc_deck_wealthos';
UPDATE evaluations SET weighted_total = 5.93 WHERE id = 'inc_deck_taxpilot_ai_eval';
UPDATE evaluations SET weighted_total = 8.06 WHERE id = 'vc_deck_wealthos_ai_eval';
