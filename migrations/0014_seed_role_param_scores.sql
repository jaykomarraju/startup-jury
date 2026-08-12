-- Session 3 demo data — AI scores for the role-scoped ADDITIONAL parameters on
-- the two workbench decks (TaxPilot incubator, WealthOS VC), so the evaluator
-- workbench's separate "Additional parameters" section and its own average are
-- live on the seed. These are assistive AI scores (weight 0) and do NOT change
-- the core-13 composite roll-up (6.2 / 8.1) written in 0010.

DELETE FROM scores WHERE evaluator_kind = 'ai' AND parameter_id IN (
  'inc_add_pa_1','inc_add_pa_2','inc_add_pa_3',
  'inc_add_pm_1','inc_add_pm_2','inc_add_pm_3',
  'inc_add_jury_1','inc_add_jury_2','inc_add_jury_3',
  'vc_add_assoc_1','vc_add_assoc_2','vc_add_assoc_3',
  'vc_add_partner_1','vc_add_partner_2','vc_add_partner_3',
  'vc_add_ic_1','vc_add_ic_2','vc_add_ic_3'
);

-- ── TaxPilot (incubator) — assistive AI scores for the 9 additional params ────
INSERT INTO scores (id, deck_id, evaluator_id, evaluator_kind, parameter_id, value, comment) VALUES
  ('ai_tp_add_pa_1',   'inc_deck_taxpilot', NULL, 'ai', 'inc_add_pa_1',   7, 'Strong fit for an SMB fintech accelerator track.'),
  ('ai_tp_add_pa_2',   'inc_deck_taxpilot', NULL, 'ai', 'inc_add_pa_2',   6, 'Deck is coherent; some financial detail is thin.'),
  ('ai_tp_add_pa_3',   'inc_deck_taxpilot', NULL, 'ai', 'inc_add_pa_3',   7, 'Founders frame their open questions candidly.'),
  ('ai_tp_add_pm_1',   'inc_deck_taxpilot', NULL, 'ai', 'inc_add_pm_1',   7, 'Clear fit with the accelerator mandate and stage.'),
  ('ai_tp_add_pm_2',   'inc_deck_taxpilot', NULL, 'ai', 'inc_add_pm_2',   7, 'Concrete GTM and pricing gaps a mentor could close.'),
  ('ai_tp_add_pm_3',   'inc_deck_taxpilot', NULL, 'ai', 'inc_add_pm_3',   6, 'Tax and compliance domain expertise helps peers.'),
  ('ai_tp_add_jury_1', 'inc_deck_taxpilot', NULL, 'ai', 'inc_add_jury_1', 7, 'Domain founders with evident persistence.'),
  ('ai_tp_add_jury_2', 'inc_deck_taxpilot', NULL, 'ai', 'inc_add_jury_2', 6, 'Early pull; retention is not yet shown.'),
  ('ai_tp_add_jury_3', 'inc_deck_taxpilot', NULL, 'ai', 'inc_add_jury_3', 7, 'Direct tax and payments execution experience.');

-- ── WealthOS (VC) — assistive AI scores for the 9 additional params ───────────
INSERT INTO scores (id, deck_id, evaluator_id, evaluator_kind, parameter_id, value, comment) VALUES
  ('ai_wo_add_assoc_1',   'vc_deck_wealthos', NULL, 'ai', 'vc_add_assoc_1',   8, 'Squarely in the fund fintech/wealthtech thesis.'),
  ('ai_wo_add_assoc_2',   'vc_deck_wealthos', NULL, 'ai', 'vc_add_assoc_2',   8, 'Series A materials look diligence-ready.'),
  ('ai_wo_add_assoc_3',   'vc_deck_wealthos', NULL, 'ai', 'vc_add_assoc_3',   8, 'Strong early read on founder quality.'),
  ('ai_wo_add_partner_1', 'vc_deck_wealthos', NULL, 'ai', 'vc_add_partner_1', 7, 'Round supports a meaningful ownership target.'),
  ('ai_wo_add_partner_2', 'vc_deck_wealthos', NULL, 'ai', 'vc_add_partner_2', 8, 'Fits the fund fintech concentration well.'),
  ('ai_wo_add_partner_3', 'vc_deck_wealthos', NULL, 'ai', 'vc_add_partner_3', 8, 'High conviction to sponsor to the committee.'),
  ('ai_wo_add_ic_1',      'vc_deck_wealthos', NULL, 'ai', 'vc_add_ic_1',      8, 'Experienced, credible founding team.'),
  ('ai_wo_add_ic_2',      'vc_deck_wealthos', NULL, 'ai', 'vc_add_ic_2',      8, 'Clear demand signal beyond the AUM headline.'),
  ('ai_wo_add_ic_3',      'vc_deck_wealthos', NULL, 'ai', 'vc_add_ic_3',      9, 'Repeat operators with regulatory depth.');
