-- Phase 1 seed: rubric anchors, per-edition settings, the 13 core weighted
-- parameters (both editions), demo users, and demo decks.
-- Demo users share the dev password "demo1234".

INSERT INTO rubric_anchors (band, min_score, max_score, label) VALUES
  ('strong',   8, 10, 'Strong signal'),
  ('moderate', 5,  7, 'Moderate signal'),
  ('weak',     2,  4, 'Weak signal'),
  ('absent',   0,  1, 'Absent');

INSERT INTO org_settings (edition, plan, credits_balance) VALUES
  ('incubator', 'premium', 3),
  ('vc',        'premium', 3);

-- 13 core weighted parameters for both editions. id = <edition>_<key>.
INSERT INTO parameters (id, edition, key, name, weight, sort_order) VALUES
  ('inc_problem_market_clarity',  'incubator', 'problem_market_clarity',  'Problem & Market Clarity',        8,  1),
  ('inc_solution_value_prop',     'incubator', 'solution_value_prop',     'Solution & Value Proposition',    8,  2),
  ('inc_market_size',             'incubator', 'market_size',             'Market Size & Opportunity',       7,  3),
  ('inc_product_technology',      'incubator', 'product_technology',      'Product & Technology',            7,  4),
  ('inc_business_model',          'incubator', 'business_model',          'Business Model & Unit Economics', 8,  5),
  ('inc_traction_validation',     'incubator', 'traction_validation',     'Traction & Validation',          10,  6),
  ('inc_competitive_landscape',   'incubator', 'competitive_landscape',   'Competitive Landscape',           6,  7),
  ('inc_gtm_strategy',            'incubator', 'gtm_strategy',            'Go-To-Market Strategy',           6,  8),
  ('inc_team_execution',          'incubator', 'team_execution',          'Team & Execution Capability',    10,  9),
  ('inc_business_risks',          'incubator', 'business_risks',          'Business Risks',                  8, 10),
  ('inc_business_attractiveness', 'incubator', 'business_attractiveness', 'Business Attractiveness',         8, 11),
  ('inc_climate_impact',          'incubator', 'climate_impact',          'Climate Impact & Integrity',     10, 12),
  ('inc_storytelling',            'incubator', 'storytelling',            'Storytelling & Deck Quality',     4, 13),
  ('vc_problem_market_clarity',   'vc',        'problem_market_clarity',  'Problem & Market Clarity',        8,  1),
  ('vc_solution_value_prop',      'vc',        'solution_value_prop',     'Solution & Value Proposition',    8,  2),
  ('vc_market_size',              'vc',        'market_size',             'Market Size & Opportunity',       7,  3),
  ('vc_product_technology',       'vc',        'product_technology',      'Product & Technology',            7,  4),
  ('vc_business_model',           'vc',        'business_model',          'Business Model & Unit Economics', 8,  5),
  ('vc_traction_validation',      'vc',        'traction_validation',     'Traction & Validation',          10,  6),
  ('vc_competitive_landscape',    'vc',        'competitive_landscape',   'Competitive Landscape',           6,  7),
  ('vc_gtm_strategy',             'vc',        'gtm_strategy',            'Go-To-Market Strategy',           6,  8),
  ('vc_team_execution',           'vc',        'team_execution',          'Team & Execution Capability',    10,  9),
  ('vc_business_risks',           'vc',        'business_risks',          'Business Risks',                  8, 10),
  ('vc_business_attractiveness',  'vc',        'business_attractiveness', 'Business Attractiveness',         8, 11),
  ('vc_climate_impact',           'vc',        'climate_impact',          'Climate Impact & Integrity',     10, 12),
  ('vc_storytelling',             'vc',        'storytelling',            'Storytelling & Deck Quality',     4, 13);

INSERT INTO users (id, name, email, password_hash, role, edition, initials) VALUES
  ('inc_superuser', 'Priya Sharma',  'priya.sharma@demo.startupjury.ai',    'pbkdf2$100000$WZJYdAIVAjK8mx0Ac0g+WA==$sf3KrNCz3DIODrtWC5mgxMf9SA2gY2b6Mbq7B9l5R2Y=', 'superuser',         'incubator', 'PS'),
  ('inc_admin',     'Nisha Kapoor',  'nisha.kapoor@demo.startupjury.ai',    'pbkdf2$100000$WZJYdAIVAjK8mx0Ac0g+WA==$sf3KrNCz3DIODrtWC5mgxMf9SA2gY2b6Mbq7B9l5R2Y=', 'admin',             'incubator', 'NK'),
  ('inc_pm',        'Raj Kumar',     'raj.kumar@demo.startupjury.ai',       'pbkdf2$100000$WZJYdAIVAjK8mx0Ac0g+WA==$sf3KrNCz3DIODrtWC5mgxMf9SA2gY2b6Mbq7B9l5R2Y=', 'program_manager',   'incubator', 'RK'),
  ('inc_pa',        'Sunita Rao',    'sunita.rao@demo.startupjury.ai',      'pbkdf2$100000$WZJYdAIVAjK8mx0Ac0g+WA==$sf3KrNCz3DIODrtWC5mgxMf9SA2gY2b6Mbq7B9l5R2Y=', 'program_associate', 'incubator', 'SR'),
  ('inc_jury',      'Rajesh Kumar',  'rajesh.kumar@demo.startupjury.ai',    'pbkdf2$100000$WZJYdAIVAjK8mx0Ac0g+WA==$sf3KrNCz3DIODrtWC5mgxMf9SA2gY2b6Mbq7B9l5R2Y=', 'jury',              'incubator', 'RK'),
  ('inc_founder',   'Meera Sharma',  'meera.sharma@demo.startupjury.ai',    'pbkdf2$100000$WZJYdAIVAjK8mx0Ac0g+WA==$sf3KrNCz3DIODrtWC5mgxMf9SA2gY2b6Mbq7B9l5R2Y=', 'founder',           'incubator', 'MS'),
  ('vc_superuser',  'Aarav Khanna',  'aarav.khanna@demo.startupjury.ai',    'pbkdf2$100000$WZJYdAIVAjK8mx0Ac0g+WA==$sf3KrNCz3DIODrtWC5mgxMf9SA2gY2b6Mbq7B9l5R2Y=', 'superuser',         'vc',        'AK'),
  ('vc_admin',      'Nisha Kapoor',  'nisha.kapoor.vc@demo.startupjury.ai', 'pbkdf2$100000$WZJYdAIVAjK8mx0Ac0g+WA==$sf3KrNCz3DIODrtWC5mgxMf9SA2gY2b6Mbq7B9l5R2Y=', 'admin',             'vc',        'NK'),
  ('vc_partner',    'Ishaan Sethi',  'ishaan.sethi@demo.startupjury.ai',    'pbkdf2$100000$WZJYdAIVAjK8mx0Ac0g+WA==$sf3KrNCz3DIODrtWC5mgxMf9SA2gY2b6Mbq7B9l5R2Y=', 'partner',           'vc',        'IS'),
  ('vc_ic',         'Rajesh Kumar',  'rajesh.kumar.vc@demo.startupjury.ai', 'pbkdf2$100000$WZJYdAIVAjK8mx0Ac0g+WA==$sf3KrNCz3DIODrtWC5mgxMf9SA2gY2b6Mbq7B9l5R2Y=', 'ic_member',         'vc',        'RK'),
  ('vc_associate',  'Sunita Rao',    'sunita.rao.vc@demo.startupjury.ai',   'pbkdf2$100000$WZJYdAIVAjK8mx0Ac0g+WA==$sf3KrNCz3DIODrtWC5mgxMf9SA2gY2b6Mbq7B9l5R2Y=', 'associate',         'vc',        'SR'),
  ('vc_analyst',    'Rhea Nair',     'rhea.nair@demo.startupjury.ai',       'pbkdf2$100000$WZJYdAIVAjK8mx0Ac0g+WA==$sf3KrNCz3DIODrtWC5mgxMf9SA2gY2b6Mbq7B9l5R2Y=', 'analyst',           'vc',        'RN');

INSERT INTO decks (id, edition, name, sector, stage, city, program, cohort, status, ai_score, signal, assigned_to, uploaded_by, complete) VALUES
  ('inc_deck_finstack',   'incubator', 'FinStack',   'B2B Fintech', 'Seed',     'Hyderabad', 'Fintech Accelerator', 'Cohort 5', 'ai_evaluated',    7.8,  'strong',   NULL,       'inc_pa', 1),
  ('inc_deck_insureflow', 'incubator', 'InsureFlow', 'Insurtech',   'Seed',     'Bengaluru', 'Fintech Accelerator', 'Cohort 5', 'jury_evaluation', 8.6,  'strong',   'inc_jury', 'inc_pa', 1),
  ('inc_deck_payroute',   'incubator', 'PayRoute',   'Fintech',     'Pre-seed', 'Pune',      'Fintech Accelerator', 'Cohort 5', 'incomplete',      NULL, NULL,       NULL,       'inc_pa', 0),
  ('inc_deck_greenroute', 'incubator', 'GreenRoute', 'Climatetech', 'Seed',     'Mumbai',    'Climate Cohort',      'Cohort 6', 'shortlisted',     7.2,  'moderate', 'inc_jury', 'inc_pa', 1),
  ('vc_deck_wealthos',    'vc',        'WealthOS',   'Wealthtech',  'Seed',     'Bengaluru', 'Deep Tech Fund',      NULL,       'associate_review', 8.1, 'strong',   NULL,       'vc_analyst', 1),
  ('vc_deck_creditbridge','vc',        'CreditBridge','Fintech',    'Series A', 'Mumbai',    'Deep Tech Fund',      NULL,       'ic_review',       7.5,  'moderate', NULL,       'vc_analyst', 1),
  ('vc_deck_agrichain',   'vc',        'AgriChain',  'Agritech',    'Seed',     'Hyderabad', 'Deep Tech Fund',      NULL,       'partner_review',  6.9,  'moderate', NULL,       'vc_analyst', 1);
