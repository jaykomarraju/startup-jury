-- Phase 6 — Config, plans & credits.
--
-- No schema change: org_settings (plan, credits_balance, branding_json,
-- ai_system_prompt, threshold_best/mediocre) and parameters (informational flag,
-- role_scope) already exist from 0001. This migration only seeds data:
--   1. A generous demo credit balance so uploads (which now decrement credits)
--      work on the live demo, and admins can lower it to demo the at-zero block.
--   2. Two additional / informational parameters per edition (weight 0, so they
--      never move the composite) — gated by plan tier: hidden on Standard, shown
--      on Pro/Premium. The seed plan is Premium, so they surface on the demo.

UPDATE org_settings SET credits_balance = 50;

INSERT INTO parameters (id, edition, key, name, weight, informational, role_scope, sort_order) VALUES
  ('inc_add_program_fit',  'incubator', 'add_program_fit',  'Program & Mandate Fit',   0, 1, 'program_manager', 101),
  ('inc_add_founder_grit', 'incubator', 'add_founder_grit', 'Founder Grit & Coachability', 0, 1, 'jury',         102),
  ('vc_add_thesis_fit',    'vc',        'add_thesis_fit',   'Thesis & Mandate Fit',    0, 1, 'associate',       101),
  ('vc_add_ownership_math','vc',        'add_ownership_math','Ownership & Return Math', 0, 1, 'partner',         102);
