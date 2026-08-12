-- Session 3 — Parameter model: core 13 + role-scoped additional (AI-scored).
--
-- Additional parameters become first-class and role-scoped. Each edition gets
-- THREE owner roles × THREE additional parameters = 9 additional params, so the
-- rubric is 13 core + 9 additional = 22 per edition. They are all informational
-- (weight 0 → NEVER folded into the core-13 composite, which stays = 100%); the
-- AI scores them assistively and the owning role scores/remarks its ≤3. Each
-- carries a configurable AI prompt (the new `prompt` column) that can be renamed
-- and edited in the admin console (Premium plan).
--
-- Owner roles (reconciled: §8 meeting transcript for incubator + the VC prototype
-- tabs; analyst is a distinct role, the Investment Associate is the owner there):
--   incubator: program_associate, program_manager, jury
--   vc:        associate (Investment Associate), partner, ic_member

-- Configurable per-parameter AI extraction prompt (used by evaluate.ts for the
-- additional params; NULL for core areas, which fall back to name + weight).
ALTER TABLE parameters ADD COLUMN prompt TEXT;

-- Retire the interim 2-per-edition additional params seeded in 0007 — the full
-- role-scoped set below replaces them (soft delete keeps any historical scores).
UPDATE parameters SET active = 0 WHERE informational = 1;

INSERT INTO parameters (id, edition, key, name, weight, informational, role_scope, prompt, sort_order, active) VALUES
  -- ── Incubator · Program Associate ──────────────────────────────────────────
  ('inc_add_pa_1', 'incubator', 'add_pa_mandate_fit', 'Program & Mandate Fit', 0, 1, 'program_associate',
    'Assess how well {{startup_name}} ({{sector}}, {{stage}}) fits the {{program_type}} programme mandate, stage focus and eligibility. Score 0-10.', 101, 1),
  ('inc_add_pa_2', 'incubator', 'add_pa_readiness', 'Application Readiness', 0, 1, 'program_associate',
    'Judge whether the {{startup_name}} application and deck are complete and diligence-ready: required sections present, contact details clear, materials coherent. Score 0-10.', 102, 1),
  ('inc_add_pa_3', 'incubator', 'add_pa_coachability', 'Founder Coachability Signal', 0, 1, 'program_associate',
    'From the deck, gauge founder openness to feedback and evidence of a learning orientation for {{startup_name}}. Score 0-10.', 103, 1),
  -- ── Incubator · Program Manager ────────────────────────────────────────────
  ('inc_add_pm_1', 'incubator', 'add_pm_program_fit', 'Program Fit', 0, 1, 'program_manager',
    'Assess fit of {{startup_name}} with the {{program_type}} programme operating in {{sector}}: stage alignment, sector relevance, willingness to engage mentors, and evidence of learning orientation. Score 0-10.', 104, 1),
  ('inc_add_pm_2', 'incubator', 'add_pm_mentor_fit', 'Mentor Engagement Potential', 0, 1, 'program_manager',
    'Is {{startup_name}} ready to benefit from structured mentorship? Look for concrete asks, gaps a mentor could close, and coachability. Score 0-10.', 105, 1),
  ('inc_add_pm_3', 'incubator', 'add_pm_cohort_value', 'Cohort Contribution Potential', 0, 1, 'program_manager',
    'Will {{startup_name}} add value to other {{program_type}} cohort members through domain expertise, network or peer learning? Score 0-10.', 106, 1),
  -- ── Incubator · Jury ───────────────────────────────────────────────────────
  ('inc_add_jury_1', 'incubator', 'add_jury_resilience', 'Founder Resilience & Coachability', 0, 1, 'jury',
    'A personal read on the {{startup_name}} founders: resilience, self-awareness and coachability beyond the metrics. Score 0-10.', 107, 1),
  ('inc_add_jury_2', 'incubator', 'add_jury_pmf', 'Product-Market Fit Signal', 0, 1, 'jury',
    'The jury read on product-market fit for {{startup_name}} beyond standard traction metrics: pull, retention signals, demand. Score 0-10.', 108, 1),
  ('inc_add_jury_3', 'incubator', 'add_jury_execution', 'Team Execution Capability', 0, 1, 'jury',
    'A domain-specific read on {{startup_name}} team quality and ability to execute in {{sector}}. Score 0-10.', 109, 1),
  -- ── VC · Investment Associate ──────────────────────────────────────────────
  ('vc_add_assoc_1', 'vc', 'add_assoc_thesis_fit', 'Thesis & Mandate Fit', 0, 1, 'associate',
    'How well does {{startup_name}} ({{sector}}, {{stage}}) match the fund sector, stage and check-size thesis? Score 0-10.', 101, 1),
  ('vc_add_assoc_2', 'vc', 'add_assoc_readiness', 'Deal Readiness', 0, 1, 'associate',
    'Is {{startup_name}} at the right stage with data-room materials ready for diligence? Score 0-10.', 102, 1),
  ('vc_add_assoc_3', 'vc', 'add_assoc_conviction', 'Founder Conviction Signal', 0, 1, 'associate',
    'Early read on founder quality and conviction for {{startup_name}} from the deck. Score 0-10.', 103, 1),
  -- ── VC · Partner ───────────────────────────────────────────────────────────
  ('vc_add_partner_1', 'vc', 'add_partner_ownership', 'Ownership & Return Math', 0, 1, 'partner',
    'Assess whether the {{startup_name}} round supports the fund target ownership and a fund-returning outcome at plausible exit multiples. Score 0-10.', 104, 1),
  ('vc_add_partner_2', 'vc', 'add_partner_portfolio_fit', 'Portfolio Construction Fit', 0, 1, 'partner',
    'How well does {{startup_name}} fit fund portfolio construction: concentration, stage mix and thematic balance? Score 0-10.', 105, 1),
  ('vc_add_partner_3', 'vc', 'add_partner_sponsor', 'Conviction to Sponsor', 0, 1, 'partner',
    'Partner conviction to sponsor {{startup_name}} to the investment committee. Score 0-10.', 106, 1),
  -- ── VC · IC Member ─────────────────────────────────────────────────────────
  ('vc_add_ic_1', 'vc', 'add_ic_resilience', 'Founder Resilience & Coachability', 0, 1, 'ic_member',
    'An IC member personal assessment of the {{startup_name}} founders: resilience, integrity and coachability. Score 0-10.', 107, 1),
  ('vc_add_ic_2', 'vc', 'add_ic_pmf', 'Product-Market Fit Signal', 0, 1, 'ic_member',
    'The IC member read on product-market fit for {{startup_name}} beyond standard traction metrics. Score 0-10.', 108, 1),
  ('vc_add_ic_3', 'vc', 'add_ic_execution', 'Team Execution Capability', 0, 1, 'ic_member',
    'The IC member domain-specific read on {{startup_name}} team quality and ability to execute in {{sector}}. Score 0-10.', 109, 1);
