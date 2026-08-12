-- Session 2 — seed enrichment for the Program/Cohort hierarchy. Backfill
-- (0011) created the programs/cohorts from the free-text columns; here we give
-- them sectors, descriptions, VC fund economics, and cohort dates so every new
-- screen (Set up wizard, toolbar filters, Applies-to, Capital Deployment) is
-- live on the demo seed. Matching is by (edition, name) so it stays robust.

-- ── Sectors (the wizard's configurable list per edition) ─────────────────────
INSERT INTO sectors (id, edition, name, sort_order) VALUES
  ('sec_inc_fintech',   'incubator', 'FinTech',     1),
  ('sec_inc_climate',   'incubator', 'ClimateTech', 2),
  ('sec_inc_saas',      'incubator', 'SaaS',        3),
  ('sec_inc_health',    'incubator', 'HealthTech',  4),
  ('sec_inc_agri',      'incubator', 'AgriTech',    5),
  ('sec_vc_fintech',    'vc',        'FinTech',     1),
  ('sec_vc_climate',    'vc',        'ClimateTech', 2),
  ('sec_vc_deeptech',   'vc',        'Deep Tech',   3),
  ('sec_vc_b2bsaas',    'vc',        'B2B SaaS',    4),
  ('sec_vc_health',     'vc',        'HealthTech',  5);

-- ── Incubator program details ────────────────────────────────────────────────
UPDATE programs SET sector = 'FinTech',
  description = 'Early-stage fintech cohort — payments, lending and wealth startups.'
  WHERE edition = 'incubator' AND name = 'Fintech Accelerator';
UPDATE programs SET sector = 'ClimateTech',
  description = 'Climate & sustainability venture cohort with an impact-weighted rubric.'
  WHERE edition = 'incubator' AND name = 'Climate Cohort';
UPDATE programs SET sector = 'SaaS',
  description = 'Vertical & horizontal SaaS studio for B2B software founders.'
  WHERE edition = 'incubator' AND name = 'SaaS Accelerator';

-- ── VC program details + fund economics (₹ Cr) ───────────────────────────────
-- Fund II is the active deployment fund: 300 committed, 210 allocated to deals,
-- 92 already deployed across onboarded portfolio companies (matches the seeded
-- portfolio positions). Deep Tech Fund is an earlier sourcing track with no
-- committed capital yet, so it leaves the fund fields NULL.
UPDATE programs SET sector = 'Deep Tech',
  description = 'Deep-tech sourcing track — frontier hardware, climate and AI deal flow.'
  WHERE edition = 'vc' AND name = 'Deep Tech Fund';
UPDATE programs SET sector = 'Multi-sector',
  description = 'Fund II — the active early-growth deployment vehicle.',
  fund_size = 300, fund_allocated = 210, capital_deployed = 92
  WHERE edition = 'vc' AND name = 'Fund II';

-- ── Cohort dates (backfilled incubator cohorts) ──────────────────────────────
UPDATE cohorts SET starts_on = '2025-07-01', ends_on = '2025-12-15' WHERE name = 'Cohort 5';
UPDATE cohorts SET starts_on = '2026-01-15', ends_on = '2026-06-30' WHERE name = 'Cohort 6';
