-- W1-B · migration 3 of 13 (0025 – 0037).
--
-- Admin console → Evaluation → **Rubric anchors** (`admin/s-rb.html`). Two
-- things live on that screen, and neither had anywhere to be stored:
--
--   1. a per-area **AI guidance prompt** — "what should the AI look for?" —
--      which is the `parameters.prompt` column 0013 added for the role-scoped
--      additional params and left NULL for the 13 core areas. Filled in below
--      from the prototype's RB_PROMPTS (identical in both editions).
--   2. per-area **band anchors on the spec's five-band scale**, 9–10 / 7–8 /
--      5–6 / 3–4 / 0–2 (specs §7 — "Store as ParameterRubricBand(parameter_id,
--      band_label, description)"). The prototype's RUBRICS literal supplies 65
--      anchor strings per edition; the nine role-scoped parameters get their
--      five band rows scaffolded with NULL text, exactly as the prototype
--      renders p1–p3 with empty textareas.
--
-- NOTE for W2-B — this does NOT replace the global four-band `rubric_anchors`
-- table from 0001 (0–1 / 2–4 / 5–7 / 8–10), which `src/server/ai/evaluate.ts`
-- and `src/server/routes/pipeline.ts` still read. That four-vs-five band split
-- is the §1.5 defect W2-B owns; this table is the five-band store it should
-- reconcile onto. `band_name` carries the spec §7 labels so scoring and
-- analytics can share one source.

CREATE TABLE IF NOT EXISTS parameter_rubric_bands (
  id           TEXT PRIMARY KEY,
  parameter_id TEXT NOT NULL REFERENCES parameters (id) ON DELETE CASCADE,
  -- 0 = highest band (9–10) … 4 = lowest (0–2), matching spec §7's band(v).
  band_index   INTEGER NOT NULL CHECK (band_index BETWEEN 0 AND 4),
  band_label   TEXT NOT NULL,
  band_name    TEXT NOT NULL,
  min_score    INTEGER NOT NULL CHECK (min_score BETWEEN 0 AND 10),
  max_score    INTEGER NOT NULL CHECK (max_score BETWEEN 0 AND 10),
  -- The editable anchor text. NULL = not yet written for this parameter.
  description  TEXT,
  CHECK (max_score >= min_score),
  UNIQUE (parameter_id, band_index)
);
CREATE INDEX IF NOT EXISTS idx_rubric_bands_param ON parameter_rubric_bands (parameter_id, band_index);

-- ── Per-area AI guidance prompts (13 core areas × 2 editions) ───────────────
UPDATE parameters SET prompt = 'Look for a specific, clearly-articulated problem; evidence it is frequent and painful; a well-defined target customer. Flag vague or ''nice-to-have'' problems.' WHERE id = 'inc_problem_market_clarity';
UPDATE parameters SET prompt = 'Check the solution directly addresses the stated problem with a clear, differentiated value proposition. Flag feature lists with no core benefit.' WHERE id = 'inc_solution_value_prop';
UPDATE parameters SET prompt = 'Look for credible TAM/SAM/SOM built bottom-up and a reachable beachhead. Flag top-down-only sizing or inflated numbers.' WHERE id = 'inc_market_size';
UPDATE parameters SET prompt = 'Assess product maturity, technical defensibility, and proven vs aspirational tech. Flag undifferentiated or unbuilt technology.' WHERE id = 'inc_product_technology';
UPDATE parameters SET prompt = 'Look for a clear revenue model, pricing and unit economics (CAC, LTV, margins, payback). Flag missing or implausible economics.' WHERE id = 'inc_business_model';
UPDATE parameters SET prompt = 'Look for real demand signals — revenue, users, growth, pilots, LOIs, retention. Flag vanity metrics or no validation.' WHERE id = 'inc_traction_validation';
UPDATE parameters SET prompt = 'Check awareness of real competitors and substitutes and a defensible moat. Flag ''no competition'' claims.' WHERE id = 'inc_competitive_landscape';
UPDATE parameters SET prompt = 'Look for a concrete, channel-specific acquisition plan with realistic costs. Flag generic ''we''ll do marketing'' statements.' WHERE id = 'inc_gtm_strategy';
UPDATE parameters SET prompt = 'Assess founder–market fit, relevant experience and ability to execute. Flag gaps in key roles.' WHERE id = 'inc_team_execution';
UPDATE parameters SET prompt = 'Look for honest identification of key risks (market, regulatory, execution) with credible mitigations. Flag unacknowledged risks.' WHERE id = 'inc_business_risks';
UPDATE parameters SET prompt = 'Assess overall investability — scalability, margins and return potential for this stage. Flag low-ceiling businesses.' WHERE id = 'inc_business_attractiveness';
UPDATE parameters SET prompt = 'Look for measurable, attributable, additional climate impact with credible methodology. Flag greenwashing or unquantified claims.' WHERE id = 'inc_climate_impact';
UPDATE parameters SET prompt = 'Assess narrative clarity, structure and whether the deck makes the investment case. Flag clutter or missing key slides.' WHERE id = 'inc_storytelling';
UPDATE parameters SET prompt = 'Look for a specific, clearly-articulated problem; evidence it is frequent and painful; a well-defined target customer. Flag vague or ''nice-to-have'' problems.' WHERE id = 'vc_problem_market_clarity';
UPDATE parameters SET prompt = 'Check the solution directly addresses the stated problem with a clear, differentiated value proposition. Flag feature lists with no core benefit.' WHERE id = 'vc_solution_value_prop';
UPDATE parameters SET prompt = 'Look for credible TAM/SAM/SOM built bottom-up and a reachable beachhead. Flag top-down-only sizing or inflated numbers.' WHERE id = 'vc_market_size';
UPDATE parameters SET prompt = 'Assess product maturity, technical defensibility, and proven vs aspirational tech. Flag undifferentiated or unbuilt technology.' WHERE id = 'vc_product_technology';
UPDATE parameters SET prompt = 'Look for a clear revenue model, pricing and unit economics (CAC, LTV, margins, payback). Flag missing or implausible economics.' WHERE id = 'vc_business_model';
UPDATE parameters SET prompt = 'Look for real demand signals — revenue, users, growth, pilots, LOIs, retention. Flag vanity metrics or no validation.' WHERE id = 'vc_traction_validation';
UPDATE parameters SET prompt = 'Check awareness of real competitors and substitutes and a defensible moat. Flag ''no competition'' claims.' WHERE id = 'vc_competitive_landscape';
UPDATE parameters SET prompt = 'Look for a concrete, channel-specific acquisition plan with realistic costs. Flag generic ''we''ll do marketing'' statements.' WHERE id = 'vc_gtm_strategy';
UPDATE parameters SET prompt = 'Assess founder–market fit, relevant experience and ability to execute. Flag gaps in key roles.' WHERE id = 'vc_team_execution';
UPDATE parameters SET prompt = 'Look for honest identification of key risks (market, regulatory, execution) with credible mitigations. Flag unacknowledged risks.' WHERE id = 'vc_business_risks';
UPDATE parameters SET prompt = 'Assess overall investability — scalability, margins and return potential for this stage. Flag low-ceiling businesses.' WHERE id = 'vc_business_attractiveness';
UPDATE parameters SET prompt = 'Look for measurable, attributable, additional climate impact with credible methodology. Flag greenwashing or unquantified claims.' WHERE id = 'vc_climate_impact';
UPDATE parameters SET prompt = 'Assess narrative clarity, structure and whether the deck makes the investment case. Flag clutter or missing key slides.' WHERE id = 'vc_storytelling';

-- ── Five-band anchors: 65 seeded strings + 45 scaffolded rows per edition ───
INSERT INTO parameter_rubric_bands
  (id, parameter_id, band_index, band_label, band_name, min_score, max_score, description)
VALUES
  ('inc_problem_market_clarity_b0', 'inc_problem_market_clarity', 0, '9–10', 'Exceptional', 9, 10, 'Mission-critical problem with regulatory or economic pressure.'),
  ('inc_problem_market_clarity_b1', 'inc_problem_market_clarity', 1, '7–8', 'Strong', 7, 8, 'High-frequency, costly pain with evidence.'),
  ('inc_problem_market_clarity_b2', 'inc_problem_market_clarity', 2, '5–6', 'Moderate', 5, 6, 'Specific ICP, real pain, limited proof.'),
  ('inc_problem_market_clarity_b3', 'inc_problem_market_clarity', 3, '3–4', 'Weak', 3, 4, 'Clear problem, unclear urgency or ICP.'),
  ('inc_problem_market_clarity_b4', 'inc_problem_market_clarity', 4, '0–2', 'Insufficient', 0, 2, 'Vague problem, generic sustainability framing.'),
  ('inc_solution_value_prop_b0', 'inc_solution_value_prop', 0, '9–10', 'Exceptional', 9, 10, '10× improvement or category-defining approach.'),
  ('inc_solution_value_prop_b1', 'inc_solution_value_prop', 1, '7–8', 'Strong', 7, 8, 'Strong differentiation, customer-visible value.'),
  ('inc_solution_value_prop_b2', 'inc_solution_value_prop', 2, '5–6', 'Moderate', 5, 6, 'Clear value prop, moderate advantage.'),
  ('inc_solution_value_prop_b3', 'inc_solution_value_prop', 3, '3–4', 'Weak', 3, 4, 'Logical solution, little differentiation.'),
  ('inc_solution_value_prop_b4', 'inc_solution_value_prop', 4, '0–2', 'Insufficient', 0, 2, 'Buzzwords, weak linkage to problem.'),
  ('inc_market_size_b0', 'inc_market_size', 0, '9–10', 'Exceptional', 9, 10, 'Structural tailwinds + multi-market expansion.'),
  ('inc_market_size_b1', 'inc_market_size', 1, '7–8', 'Strong', 7, 8, 'Large, expanding, reachable market.'),
  ('inc_market_size_b2', 'inc_market_size', 2, '5–6', 'Moderate', 5, 6, 'Bottom-up logic, narrow beachhead.'),
  ('inc_market_size_b3', 'inc_market_size', 3, '3–4', 'Weak', 3, 4, 'Top-down market sizing.'),
  ('inc_market_size_b4', 'inc_market_size', 4, '0–2', 'Insufficient', 0, 2, 'Inflated or unsubstantiated TAM.'),
  ('inc_product_technology_b0', 'inc_product_technology', 0, '9–10', 'Exceptional', 9, 10, 'Defensible, hard-to-replicate tech.'),
  ('inc_product_technology_b1', 'inc_product_technology', 1, '7–8', 'Strong', 7, 8, 'Proven tech, scalable architecture.'),
  ('inc_product_technology_b2', 'inc_product_technology', 2, '5–6', 'Moderate', 5, 6, 'MVP with pilots.'),
  ('inc_product_technology_b3', 'inc_product_technology', 3, '3–4', 'Weak', 3, 4, 'Early prototype, high uncertainty.'),
  ('inc_product_technology_b4', 'inc_product_technology', 4, '0–2', 'Insufficient', 0, 2, 'Concept only.'),
  ('inc_business_model_b0', 'inc_business_model', 0, '9–10', 'Exceptional', 9, 10, 'Highly scalable, compounding economics.'),
  ('inc_business_model_b1', 'inc_business_model', 1, '7–8', 'Strong', 7, 8, 'Strong margins, repeatable model.'),
  ('inc_business_model_b2', 'inc_business_model', 2, '5–6', 'Moderate', 5, 6, 'Early unit economics, improving.'),
  ('inc_business_model_b3', 'inc_business_model', 3, '3–4', 'Weak', 3, 4, 'Revenue identified, weak pricing logic.'),
  ('inc_business_model_b4', 'inc_business_model', 4, '0–2', 'Insufficient', 0, 2, 'No monetization clarity.'),
  ('inc_traction_validation_b0', 'inc_traction_validation', 0, '9–10', 'Exceptional', 9, 10, 'Category traction.'),
  ('inc_traction_validation_b1', 'inc_traction_validation', 1, '7–8', 'Strong', 7, 8, 'Strong growth, renewals.'),
  ('inc_traction_validation_b2', 'inc_traction_validation', 2, '5–6', 'Moderate', 5, 6, 'Paying customers.'),
  ('inc_traction_validation_b3', 'inc_traction_validation', 3, '3–4', 'Weak', 3, 4, 'Pilots, LOIs.'),
  ('inc_traction_validation_b4', 'inc_traction_validation', 4, '0–2', 'Insufficient', 0, 2, 'No validation.'),
  ('inc_competitive_landscape_b0', 'inc_competitive_landscape', 0, '9–10', 'Exceptional', 9, 10, 'Defensible leadership position.'),
  ('inc_competitive_landscape_b1', 'inc_competitive_landscape', 1, '7–8', 'Strong', 7, 8, 'Strong moat emerging.'),
  ('inc_competitive_landscape_b2', 'inc_competitive_landscape', 2, '5–6', 'Moderate', 5, 6, 'Clear differentiation.'),
  ('inc_competitive_landscape_b3', 'inc_competitive_landscape', 3, '3–4', 'Weak', 3, 4, 'Shallow mapping.'),
  ('inc_competitive_landscape_b4', 'inc_competitive_landscape', 4, '0–2', 'Insufficient', 0, 2, '“No competitors”.'),
  ('inc_gtm_strategy_b0', 'inc_gtm_strategy', 0, '9–10', 'Exceptional', 9, 10, 'Distribution advantage.'),
  ('inc_gtm_strategy_b1', 'inc_gtm_strategy', 1, '7–8', 'Strong', 7, 8, 'Repeatable GTM.'),
  ('inc_gtm_strategy_b2', 'inc_gtm_strategy', 2, '5–6', 'Moderate', 5, 6, 'Working channel, early learnings.'),
  ('inc_gtm_strategy_b3', 'inc_gtm_strategy', 3, '3–4', 'Weak', 3, 4, 'One channel, untested.'),
  ('inc_gtm_strategy_b4', 'inc_gtm_strategy', 4, '0–2', 'Insufficient', 0, 2, 'Hand-wavy.'),
  ('inc_team_execution_b0', 'inc_team_execution', 0, '9–10', 'Exceptional', 9, 10, 'Proven execution track record.'),
  ('inc_team_execution_b1', 'inc_team_execution', 1, '7–8', 'Strong', 7, 8, 'Strong founder-problem fit.'),
  ('inc_team_execution_b2', 'inc_team_execution', 2, '5–6', 'Moderate', 5, 6, 'Relevant experience.'),
  ('inc_team_execution_b3', 'inc_team_execution', 3, '3–4', 'Weak', 3, 4, 'Passionate but incomplete.'),
  ('inc_team_execution_b4', 'inc_team_execution', 4, '0–2', 'Insufficient', 0, 2, 'Skill gaps, no domain fit.'),
  ('inc_business_risks_b0', 'inc_business_risks', 0, '9–10', 'Exceptional', 9, 10, 'Robust risk resilience.'),
  ('inc_business_risks_b1', 'inc_business_risks', 1, '7–8', 'Strong', 7, 8, 'Risks understood & managed.'),
  ('inc_business_risks_b2', 'inc_business_risks', 2, '5–6', 'Moderate', 5, 6, 'Known risks, partial mitigation.'),
  ('inc_business_risks_b3', 'inc_business_risks', 3, '3–4', 'Weak', 3, 4, 'Major unresolved risks.'),
  ('inc_business_risks_b4', 'inc_business_risks', 4, '0–2', 'Insufficient', 0, 2, 'Multiple existential risks.'),
  ('inc_business_attractiveness_b0', 'inc_business_attractiveness', 0, '9–10', 'Exceptional', 9, 10, 'Category-defining return potential.'),
  ('inc_business_attractiveness_b1', 'inc_business_attractiveness', 1, '7–8', 'Strong', 7, 8, 'Large, strategic upside.'),
  ('inc_business_attractiveness_b2', 'inc_business_attractiveness', 2, '5–6', 'Moderate', 5, 6, 'Solid venture outcome.'),
  ('inc_business_attractiveness_b3', 'inc_business_attractiveness', 3, '3–4', 'Weak', 3, 4, 'Moderate business.'),
  ('inc_business_attractiveness_b4', 'inc_business_attractiveness', 4, '0–2', 'Insufficient', 0, 2, 'Small or capped outcome.'),
  ('inc_climate_impact_b0', 'inc_climate_impact', 0, '9–10', 'Exceptional', 9, 10, 'Transformational impact — large, verifiable, scalable; potential to materially shift emissions trajectories or resource use at a sector or system level.'),
  ('inc_climate_impact_b1', 'inc_climate_impact', 1, '7–8', 'Strong', 7, 8, 'Direct and significant impact — measurable, attributable reductions or savings at scale, aligned with sector decarbonization needs.'),
  ('inc_climate_impact_b2', 'inc_climate_impact', 2, '5–6', 'Moderate', 5, 6, 'Direct but limited impact — clear, attributable impact, but per-unit or total impact is small, niche, or slow to scale.'),
  ('inc_climate_impact_b3', 'inc_climate_impact', 3, '3–4', 'Weak', 3, 4, 'Indirect but credible impact — improves efficiency, reporting, or decisions that may lead to impact, but reductions are not directly attributable or guaranteed.'),
  ('inc_climate_impact_b4', 'inc_climate_impact', 4, '0–2', 'Insufficient', 0, 2, 'Indirect, unclear, or non-attributable impact — claims are vague, enabling-only, or cannot be linked to measurable environmental outcomes.'),
  ('inc_storytelling_b0', 'inc_storytelling', 0, '9–10', 'Exceptional', 9, 10, 'Memorable, persuasive, jury-ready.'),
  ('inc_storytelling_b1', 'inc_storytelling', 1, '7–8', 'Strong', 7, 8, 'Compelling, logical, easy to follow.'),
  ('inc_storytelling_b2', 'inc_storytelling', 2, '5–6', 'Moderate', 5, 6, 'Clear story, some clutter.'),
  ('inc_storytelling_b3', 'inc_storytelling', 3, '3–4', 'Weak', 3, 4, 'Understandable but fragmented.'),
  ('inc_storytelling_b4', 'inc_storytelling', 4, '0–2', 'Insufficient', 0, 2, 'Confusing, incoherent, marketing-heavy.'),
  ('inc_add_pm_1_b0', 'inc_add_pm_1', 0, '9–10', 'Exceptional', 9, 10, NULL),
  ('inc_add_pm_1_b1', 'inc_add_pm_1', 1, '7–8', 'Strong', 7, 8, NULL),
  ('inc_add_pm_1_b2', 'inc_add_pm_1', 2, '5–6', 'Moderate', 5, 6, NULL),
  ('inc_add_pm_1_b3', 'inc_add_pm_1', 3, '3–4', 'Weak', 3, 4, NULL),
  ('inc_add_pm_1_b4', 'inc_add_pm_1', 4, '0–2', 'Insufficient', 0, 2, NULL),
  ('inc_add_pm_2_b0', 'inc_add_pm_2', 0, '9–10', 'Exceptional', 9, 10, NULL),
  ('inc_add_pm_2_b1', 'inc_add_pm_2', 1, '7–8', 'Strong', 7, 8, NULL),
  ('inc_add_pm_2_b2', 'inc_add_pm_2', 2, '5–6', 'Moderate', 5, 6, NULL),
  ('inc_add_pm_2_b3', 'inc_add_pm_2', 3, '3–4', 'Weak', 3, 4, NULL),
  ('inc_add_pm_2_b4', 'inc_add_pm_2', 4, '0–2', 'Insufficient', 0, 2, NULL),
  ('inc_add_pm_3_b0', 'inc_add_pm_3', 0, '9–10', 'Exceptional', 9, 10, NULL),
  ('inc_add_pm_3_b1', 'inc_add_pm_3', 1, '7–8', 'Strong', 7, 8, NULL),
  ('inc_add_pm_3_b2', 'inc_add_pm_3', 2, '5–6', 'Moderate', 5, 6, NULL),
  ('inc_add_pm_3_b3', 'inc_add_pm_3', 3, '3–4', 'Weak', 3, 4, NULL),
  ('inc_add_pm_3_b4', 'inc_add_pm_3', 4, '0–2', 'Insufficient', 0, 2, NULL),
  ('inc_add_pa_1_b0', 'inc_add_pa_1', 0, '9–10', 'Exceptional', 9, 10, NULL),
  ('inc_add_pa_1_b1', 'inc_add_pa_1', 1, '7–8', 'Strong', 7, 8, NULL),
  ('inc_add_pa_1_b2', 'inc_add_pa_1', 2, '5–6', 'Moderate', 5, 6, NULL),
  ('inc_add_pa_1_b3', 'inc_add_pa_1', 3, '3–4', 'Weak', 3, 4, NULL),
  ('inc_add_pa_1_b4', 'inc_add_pa_1', 4, '0–2', 'Insufficient', 0, 2, NULL),
  ('inc_add_pa_2_b0', 'inc_add_pa_2', 0, '9–10', 'Exceptional', 9, 10, NULL),
  ('inc_add_pa_2_b1', 'inc_add_pa_2', 1, '7–8', 'Strong', 7, 8, NULL),
  ('inc_add_pa_2_b2', 'inc_add_pa_2', 2, '5–6', 'Moderate', 5, 6, NULL),
  ('inc_add_pa_2_b3', 'inc_add_pa_2', 3, '3–4', 'Weak', 3, 4, NULL),
  ('inc_add_pa_2_b4', 'inc_add_pa_2', 4, '0–2', 'Insufficient', 0, 2, NULL),
  ('inc_add_pa_3_b0', 'inc_add_pa_3', 0, '9–10', 'Exceptional', 9, 10, NULL),
  ('inc_add_pa_3_b1', 'inc_add_pa_3', 1, '7–8', 'Strong', 7, 8, NULL),
  ('inc_add_pa_3_b2', 'inc_add_pa_3', 2, '5–6', 'Moderate', 5, 6, NULL),
  ('inc_add_pa_3_b3', 'inc_add_pa_3', 3, '3–4', 'Weak', 3, 4, NULL),
  ('inc_add_pa_3_b4', 'inc_add_pa_3', 4, '0–2', 'Insufficient', 0, 2, NULL),
  ('inc_add_jury_1_b0', 'inc_add_jury_1', 0, '9–10', 'Exceptional', 9, 10, NULL),
  ('inc_add_jury_1_b1', 'inc_add_jury_1', 1, '7–8', 'Strong', 7, 8, NULL),
  ('inc_add_jury_1_b2', 'inc_add_jury_1', 2, '5–6', 'Moderate', 5, 6, NULL),
  ('inc_add_jury_1_b3', 'inc_add_jury_1', 3, '3–4', 'Weak', 3, 4, NULL),
  ('inc_add_jury_1_b4', 'inc_add_jury_1', 4, '0–2', 'Insufficient', 0, 2, NULL),
  ('inc_add_jury_2_b0', 'inc_add_jury_2', 0, '9–10', 'Exceptional', 9, 10, NULL),
  ('inc_add_jury_2_b1', 'inc_add_jury_2', 1, '7–8', 'Strong', 7, 8, NULL),
  ('inc_add_jury_2_b2', 'inc_add_jury_2', 2, '5–6', 'Moderate', 5, 6, NULL),
  ('inc_add_jury_2_b3', 'inc_add_jury_2', 3, '3–4', 'Weak', 3, 4, NULL),
  ('inc_add_jury_2_b4', 'inc_add_jury_2', 4, '0–2', 'Insufficient', 0, 2, NULL),
  ('inc_add_jury_3_b0', 'inc_add_jury_3', 0, '9–10', 'Exceptional', 9, 10, NULL),
  ('inc_add_jury_3_b1', 'inc_add_jury_3', 1, '7–8', 'Strong', 7, 8, NULL),
  ('inc_add_jury_3_b2', 'inc_add_jury_3', 2, '5–6', 'Moderate', 5, 6, NULL),
  ('inc_add_jury_3_b3', 'inc_add_jury_3', 3, '3–4', 'Weak', 3, 4, NULL),
  ('inc_add_jury_3_b4', 'inc_add_jury_3', 4, '0–2', 'Insufficient', 0, 2, NULL),
  ('vc_problem_market_clarity_b0', 'vc_problem_market_clarity', 0, '9–10', 'Exceptional', 9, 10, 'Mission-critical problem with regulatory or economic pressure.'),
  ('vc_problem_market_clarity_b1', 'vc_problem_market_clarity', 1, '7–8', 'Strong', 7, 8, 'High-frequency, costly pain with evidence.'),
  ('vc_problem_market_clarity_b2', 'vc_problem_market_clarity', 2, '5–6', 'Moderate', 5, 6, 'Specific ICP, real pain, limited proof.'),
  ('vc_problem_market_clarity_b3', 'vc_problem_market_clarity', 3, '3–4', 'Weak', 3, 4, 'Clear problem, unclear urgency or ICP.'),
  ('vc_problem_market_clarity_b4', 'vc_problem_market_clarity', 4, '0–2', 'Insufficient', 0, 2, 'Vague problem, generic sustainability framing.'),
  ('vc_solution_value_prop_b0', 'vc_solution_value_prop', 0, '9–10', 'Exceptional', 9, 10, '10× improvement or category-defining approach.'),
  ('vc_solution_value_prop_b1', 'vc_solution_value_prop', 1, '7–8', 'Strong', 7, 8, 'Strong differentiation, customer-visible value.'),
  ('vc_solution_value_prop_b2', 'vc_solution_value_prop', 2, '5–6', 'Moderate', 5, 6, 'Clear value prop, moderate advantage.'),
  ('vc_solution_value_prop_b3', 'vc_solution_value_prop', 3, '3–4', 'Weak', 3, 4, 'Logical solution, little differentiation.'),
  ('vc_solution_value_prop_b4', 'vc_solution_value_prop', 4, '0–2', 'Insufficient', 0, 2, 'Buzzwords, weak linkage to problem.'),
  ('vc_market_size_b0', 'vc_market_size', 0, '9–10', 'Exceptional', 9, 10, 'Structural tailwinds + multi-market expansion.'),
  ('vc_market_size_b1', 'vc_market_size', 1, '7–8', 'Strong', 7, 8, 'Large, expanding, reachable market.'),
  ('vc_market_size_b2', 'vc_market_size', 2, '5–6', 'Moderate', 5, 6, 'Bottom-up logic, narrow beachhead.'),
  ('vc_market_size_b3', 'vc_market_size', 3, '3–4', 'Weak', 3, 4, 'Top-down market sizing.'),
  ('vc_market_size_b4', 'vc_market_size', 4, '0–2', 'Insufficient', 0, 2, 'Inflated or unsubstantiated TAM.'),
  ('vc_product_technology_b0', 'vc_product_technology', 0, '9–10', 'Exceptional', 9, 10, 'Defensible, hard-to-replicate tech.'),
  ('vc_product_technology_b1', 'vc_product_technology', 1, '7–8', 'Strong', 7, 8, 'Proven tech, scalable architecture.'),
  ('vc_product_technology_b2', 'vc_product_technology', 2, '5–6', 'Moderate', 5, 6, 'MVP with pilots.'),
  ('vc_product_technology_b3', 'vc_product_technology', 3, '3–4', 'Weak', 3, 4, 'Early prototype, high uncertainty.'),
  ('vc_product_technology_b4', 'vc_product_technology', 4, '0–2', 'Insufficient', 0, 2, 'Concept only.'),
  ('vc_business_model_b0', 'vc_business_model', 0, '9–10', 'Exceptional', 9, 10, 'Highly scalable, compounding economics.'),
  ('vc_business_model_b1', 'vc_business_model', 1, '7–8', 'Strong', 7, 8, 'Strong margins, repeatable model.'),
  ('vc_business_model_b2', 'vc_business_model', 2, '5–6', 'Moderate', 5, 6, 'Early unit economics, improving.'),
  ('vc_business_model_b3', 'vc_business_model', 3, '3–4', 'Weak', 3, 4, 'Revenue identified, weak pricing logic.'),
  ('vc_business_model_b4', 'vc_business_model', 4, '0–2', 'Insufficient', 0, 2, 'No monetization clarity.'),
  ('vc_traction_validation_b0', 'vc_traction_validation', 0, '9–10', 'Exceptional', 9, 10, 'Category traction.'),
  ('vc_traction_validation_b1', 'vc_traction_validation', 1, '7–8', 'Strong', 7, 8, 'Strong growth, renewals.'),
  ('vc_traction_validation_b2', 'vc_traction_validation', 2, '5–6', 'Moderate', 5, 6, 'Paying customers.'),
  ('vc_traction_validation_b3', 'vc_traction_validation', 3, '3–4', 'Weak', 3, 4, 'Pilots, LOIs.'),
  ('vc_traction_validation_b4', 'vc_traction_validation', 4, '0–2', 'Insufficient', 0, 2, 'No validation.'),
  ('vc_competitive_landscape_b0', 'vc_competitive_landscape', 0, '9–10', 'Exceptional', 9, 10, 'Defensible leadership position.'),
  ('vc_competitive_landscape_b1', 'vc_competitive_landscape', 1, '7–8', 'Strong', 7, 8, 'Strong moat emerging.'),
  ('vc_competitive_landscape_b2', 'vc_competitive_landscape', 2, '5–6', 'Moderate', 5, 6, 'Clear differentiation.'),
  ('vc_competitive_landscape_b3', 'vc_competitive_landscape', 3, '3–4', 'Weak', 3, 4, 'Shallow mapping.'),
  ('vc_competitive_landscape_b4', 'vc_competitive_landscape', 4, '0–2', 'Insufficient', 0, 2, '“No competitors”.'),
  ('vc_gtm_strategy_b0', 'vc_gtm_strategy', 0, '9–10', 'Exceptional', 9, 10, 'Distribution advantage.'),
  ('vc_gtm_strategy_b1', 'vc_gtm_strategy', 1, '7–8', 'Strong', 7, 8, 'Repeatable GTM.'),
  ('vc_gtm_strategy_b2', 'vc_gtm_strategy', 2, '5–6', 'Moderate', 5, 6, 'Working channel, early learnings.'),
  ('vc_gtm_strategy_b3', 'vc_gtm_strategy', 3, '3–4', 'Weak', 3, 4, 'One channel, untested.'),
  ('vc_gtm_strategy_b4', 'vc_gtm_strategy', 4, '0–2', 'Insufficient', 0, 2, 'Hand-wavy.'),
  ('vc_team_execution_b0', 'vc_team_execution', 0, '9–10', 'Exceptional', 9, 10, 'Proven execution track record.'),
  ('vc_team_execution_b1', 'vc_team_execution', 1, '7–8', 'Strong', 7, 8, 'Strong founder-problem fit.'),
  ('vc_team_execution_b2', 'vc_team_execution', 2, '5–6', 'Moderate', 5, 6, 'Relevant experience.'),
  ('vc_team_execution_b3', 'vc_team_execution', 3, '3–4', 'Weak', 3, 4, 'Passionate but incomplete.'),
  ('vc_team_execution_b4', 'vc_team_execution', 4, '0–2', 'Insufficient', 0, 2, 'Skill gaps, no domain fit.'),
  ('vc_business_risks_b0', 'vc_business_risks', 0, '9–10', 'Exceptional', 9, 10, 'Robust risk resilience.'),
  ('vc_business_risks_b1', 'vc_business_risks', 1, '7–8', 'Strong', 7, 8, 'Risks understood & managed.'),
  ('vc_business_risks_b2', 'vc_business_risks', 2, '5–6', 'Moderate', 5, 6, 'Known risks, partial mitigation.'),
  ('vc_business_risks_b3', 'vc_business_risks', 3, '3–4', 'Weak', 3, 4, 'Major unresolved risks.'),
  ('vc_business_risks_b4', 'vc_business_risks', 4, '0–2', 'Insufficient', 0, 2, 'Multiple existential risks.'),
  ('vc_business_attractiveness_b0', 'vc_business_attractiveness', 0, '9–10', 'Exceptional', 9, 10, 'Category-defining return potential.'),
  ('vc_business_attractiveness_b1', 'vc_business_attractiveness', 1, '7–8', 'Strong', 7, 8, 'Large, strategic upside.'),
  ('vc_business_attractiveness_b2', 'vc_business_attractiveness', 2, '5–6', 'Moderate', 5, 6, 'Solid venture outcome.'),
  ('vc_business_attractiveness_b3', 'vc_business_attractiveness', 3, '3–4', 'Weak', 3, 4, 'Moderate business.'),
  ('vc_business_attractiveness_b4', 'vc_business_attractiveness', 4, '0–2', 'Insufficient', 0, 2, 'Small or capped outcome.'),
  ('vc_climate_impact_b0', 'vc_climate_impact', 0, '9–10', 'Exceptional', 9, 10, 'Transformational impact — large, verifiable, scalable; potential to materially shift emissions trajectories or resource use at a sector or system level.'),
  ('vc_climate_impact_b1', 'vc_climate_impact', 1, '7–8', 'Strong', 7, 8, 'Direct and significant impact — measurable, attributable reductions or savings at scale, aligned with sector decarbonization needs.'),
  ('vc_climate_impact_b2', 'vc_climate_impact', 2, '5–6', 'Moderate', 5, 6, 'Direct but limited impact — clear, attributable impact, but per-unit or total impact is small, niche, or slow to scale.'),
  ('vc_climate_impact_b3', 'vc_climate_impact', 3, '3–4', 'Weak', 3, 4, 'Indirect but credible impact — improves efficiency, reporting, or decisions that may lead to impact, but reductions are not directly attributable or guaranteed.'),
  ('vc_climate_impact_b4', 'vc_climate_impact', 4, '0–2', 'Insufficient', 0, 2, 'Indirect, unclear, or non-attributable impact — claims are vague, enabling-only, or cannot be linked to measurable environmental outcomes.'),
  ('vc_storytelling_b0', 'vc_storytelling', 0, '9–10', 'Exceptional', 9, 10, 'Memorable, persuasive, jury-ready.'),
  ('vc_storytelling_b1', 'vc_storytelling', 1, '7–8', 'Strong', 7, 8, 'Compelling, logical, easy to follow.'),
  ('vc_storytelling_b2', 'vc_storytelling', 2, '5–6', 'Moderate', 5, 6, 'Clear story, some clutter.'),
  ('vc_storytelling_b3', 'vc_storytelling', 3, '3–4', 'Weak', 3, 4, 'Understandable but fragmented.'),
  ('vc_storytelling_b4', 'vc_storytelling', 4, '0–2', 'Insufficient', 0, 2, 'Confusing, incoherent, marketing-heavy.'),
  ('vc_add_assoc_1_b0', 'vc_add_assoc_1', 0, '9–10', 'Exceptional', 9, 10, NULL),
  ('vc_add_assoc_1_b1', 'vc_add_assoc_1', 1, '7–8', 'Strong', 7, 8, NULL),
  ('vc_add_assoc_1_b2', 'vc_add_assoc_1', 2, '5–6', 'Moderate', 5, 6, NULL),
  ('vc_add_assoc_1_b3', 'vc_add_assoc_1', 3, '3–4', 'Weak', 3, 4, NULL),
  ('vc_add_assoc_1_b4', 'vc_add_assoc_1', 4, '0–2', 'Insufficient', 0, 2, NULL),
  ('vc_add_assoc_2_b0', 'vc_add_assoc_2', 0, '9–10', 'Exceptional', 9, 10, NULL),
  ('vc_add_assoc_2_b1', 'vc_add_assoc_2', 1, '7–8', 'Strong', 7, 8, NULL),
  ('vc_add_assoc_2_b2', 'vc_add_assoc_2', 2, '5–6', 'Moderate', 5, 6, NULL),
  ('vc_add_assoc_2_b3', 'vc_add_assoc_2', 3, '3–4', 'Weak', 3, 4, NULL),
  ('vc_add_assoc_2_b4', 'vc_add_assoc_2', 4, '0–2', 'Insufficient', 0, 2, NULL),
  ('vc_add_assoc_3_b0', 'vc_add_assoc_3', 0, '9–10', 'Exceptional', 9, 10, NULL),
  ('vc_add_assoc_3_b1', 'vc_add_assoc_3', 1, '7–8', 'Strong', 7, 8, NULL),
  ('vc_add_assoc_3_b2', 'vc_add_assoc_3', 2, '5–6', 'Moderate', 5, 6, NULL),
  ('vc_add_assoc_3_b3', 'vc_add_assoc_3', 3, '3–4', 'Weak', 3, 4, NULL),
  ('vc_add_assoc_3_b4', 'vc_add_assoc_3', 4, '0–2', 'Insufficient', 0, 2, NULL),
  ('vc_add_partner_1_b0', 'vc_add_partner_1', 0, '9–10', 'Exceptional', 9, 10, NULL),
  ('vc_add_partner_1_b1', 'vc_add_partner_1', 1, '7–8', 'Strong', 7, 8, NULL),
  ('vc_add_partner_1_b2', 'vc_add_partner_1', 2, '5–6', 'Moderate', 5, 6, NULL),
  ('vc_add_partner_1_b3', 'vc_add_partner_1', 3, '3–4', 'Weak', 3, 4, NULL),
  ('vc_add_partner_1_b4', 'vc_add_partner_1', 4, '0–2', 'Insufficient', 0, 2, NULL),
  ('vc_add_partner_2_b0', 'vc_add_partner_2', 0, '9–10', 'Exceptional', 9, 10, NULL),
  ('vc_add_partner_2_b1', 'vc_add_partner_2', 1, '7–8', 'Strong', 7, 8, NULL),
  ('vc_add_partner_2_b2', 'vc_add_partner_2', 2, '5–6', 'Moderate', 5, 6, NULL),
  ('vc_add_partner_2_b3', 'vc_add_partner_2', 3, '3–4', 'Weak', 3, 4, NULL),
  ('vc_add_partner_2_b4', 'vc_add_partner_2', 4, '0–2', 'Insufficient', 0, 2, NULL),
  ('vc_add_partner_3_b0', 'vc_add_partner_3', 0, '9–10', 'Exceptional', 9, 10, NULL),
  ('vc_add_partner_3_b1', 'vc_add_partner_3', 1, '7–8', 'Strong', 7, 8, NULL),
  ('vc_add_partner_3_b2', 'vc_add_partner_3', 2, '5–6', 'Moderate', 5, 6, NULL),
  ('vc_add_partner_3_b3', 'vc_add_partner_3', 3, '3–4', 'Weak', 3, 4, NULL),
  ('vc_add_partner_3_b4', 'vc_add_partner_3', 4, '0–2', 'Insufficient', 0, 2, NULL),
  ('vc_add_ic_1_b0', 'vc_add_ic_1', 0, '9–10', 'Exceptional', 9, 10, NULL),
  ('vc_add_ic_1_b1', 'vc_add_ic_1', 1, '7–8', 'Strong', 7, 8, NULL),
  ('vc_add_ic_1_b2', 'vc_add_ic_1', 2, '5–6', 'Moderate', 5, 6, NULL),
  ('vc_add_ic_1_b3', 'vc_add_ic_1', 3, '3–4', 'Weak', 3, 4, NULL),
  ('vc_add_ic_1_b4', 'vc_add_ic_1', 4, '0–2', 'Insufficient', 0, 2, NULL),
  ('vc_add_ic_2_b0', 'vc_add_ic_2', 0, '9–10', 'Exceptional', 9, 10, NULL),
  ('vc_add_ic_2_b1', 'vc_add_ic_2', 1, '7–8', 'Strong', 7, 8, NULL),
  ('vc_add_ic_2_b2', 'vc_add_ic_2', 2, '5–6', 'Moderate', 5, 6, NULL),
  ('vc_add_ic_2_b3', 'vc_add_ic_2', 3, '3–4', 'Weak', 3, 4, NULL),
  ('vc_add_ic_2_b4', 'vc_add_ic_2', 4, '0–2', 'Insufficient', 0, 2, NULL),
  ('vc_add_ic_3_b0', 'vc_add_ic_3', 0, '9–10', 'Exceptional', 9, 10, NULL),
  ('vc_add_ic_3_b1', 'vc_add_ic_3', 1, '7–8', 'Strong', 7, 8, NULL),
  ('vc_add_ic_3_b2', 'vc_add_ic_3', 2, '5–6', 'Moderate', 5, 6, NULL),
  ('vc_add_ic_3_b3', 'vc_add_ic_3', 3, '3–4', 'Weak', 3, 4, NULL),
  ('vc_add_ic_3_b4', 'vc_add_ic_3', 4, '0–2', 'Insufficient', 0, 2, NULL)
ON CONFLICT (parameter_id, band_index) DO NOTHING;
