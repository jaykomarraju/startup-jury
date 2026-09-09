-- ═══════════════════════════════════════════════════════════════════════════
-- W1-B · migration 1 of 13 (0025 – 0037) — parity programme schema block.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Corrects the nine role-scoped ADDITIONAL parameters per edition to the
-- canonical set the written specs declare, and gives every parameter the two
-- fields the spec's `parameter_definitions` sketch names but the table lacks:
-- a scorer-facing `description` and the admin console's `config_permitted`
-- ("Permit configuration") flag.
--
-- SOURCE OF TRUTH (plan §1.1 — the specs outrank the prototypes' seed data):
--   docs/prototype/source/specs/incubator.html §6.2 and vc.html §6.2. Both end
--   with the same consistency rule: "these role-parameter names are canonical
--   across every file … Keep the standard 13 areas and these 3×3 role
--   parameters identical everywhere."
--
--   incubator  Program Manager    TRL stage · Product-Market Fit · Traction
--              Program Associate  Program fit · Investment stage · Ask
--              Jury Member        Barriers of entry · Scalability · Industry growth
--   vc         Inv. Associate     Thesis fit · Investment stage · Ask / Ticket size fit
--              Partner            TRL stage · Product-Market Fit · Traction
--              IC Member          Barriers of entry · Scalability · Exit attractiveness
--
-- The 0013 seed invented its own names ("Program & Mandate Fit", "Deal
-- Readiness", "Conviction to Sponsor", …). Row **ids are left untouched** so
-- every seeded score in 0014 / 0024 and every FK keeps pointing at the same
-- parameter; only `key`, `name`, `prompt` and the new `description` change.
--
-- `config_permitted` is the prototype's per-parameter *Permit configuration*
-- button (admin console → Area weights → Additional configurable parameters).
-- Prototype default: parameter 1 of each role's three is permitted, 2 and 3 are
-- not — reproduced below.

ALTER TABLE parameters ADD COLUMN description TEXT;
ALTER TABLE parameters ADD COLUMN config_permitted INTEGER NOT NULL DEFAULT 0;

-- ── Incubator · Program Manager (spec §6.2) ─────────────────────────────────
UPDATE parameters SET key = 'add_trl_stage', name = 'TRL stage',
  description = 'Maturity on the Technology Readiness Level scale (1–9): concept (1–3), validated prototype/pilots (4–6), market-ready/proven (7–9).',
  prompt = 'From the deck, determine {{startup_name}}''s Technology Readiness Level. Look for prototypes, pilots, deployments and third-party validation, then map to TRL 1–9. Score 0–10 accordingly.',
  config_permitted = 1
  WHERE id = 'inc_add_pm_1';
UPDATE parameters SET key = 'add_product_market_fit', name = 'Product-Market Fit',
  description = 'Strength of PMF: retention, repeat/organic usage, unsolicited demand, customers who''d be disappointed without it.',
  prompt = 'Assess product-market fit for {{startup_name}} — retention, repeat usage, organic referrals and customer love. Score 0–10.'
  WHERE id = 'inc_add_pm_2';
UPDATE parameters SET key = 'add_traction', name = 'Traction',
  description = 'Revenue, active customers/users, growth rate, pipeline, notable logos — relative to stage.',
  prompt = 'Evaluate {{startup_name}}''s traction (revenue, users, growth rate, pipeline, key customers) relative to {{stage}}. Score 0–10.'
  WHERE id = 'inc_add_pm_3';

-- ── Incubator · Program Associate (spec §6.2) ───────────────────────────────
UPDATE parameters SET key = 'add_program_fit', name = 'Program fit',
  description = 'Alignment with the programme''s sector focus, stage requirements and thesis — strategic fit beyond financials.',
  prompt = 'Assess {{startup_name}}''s fit with the {{program_type}} programme operating in {{sector}} — stage alignment, sector relevance and thesis fit. Score 0–10.',
  config_permitted = 1
  WHERE id = 'inc_add_pa_1';
UPDATE parameters SET key = 'add_investment_stage', name = 'Investment stage',
  description = 'Pre-seed / seed / post-seed classification from traction, funding, team — and fit with the target stage.',
  prompt = 'From traction, funding history and team size, classify {{startup_name}} as pre-seed, seed or post-seed, and rate alignment with the programme''s target stage. Score 0–10.'
  WHERE id = 'inc_add_pa_2';
UPDATE parameters SET key = 'add_ask', name = 'Ask',
  description = 'Reasonableness of the funding ask given stage, traction, use of funds, runway.',
  prompt = 'Assess whether {{startup_name}}''s funding ask is reasonable for its stage and traction, and whether use-of-funds and runway are credible. Score 0–10.'
  WHERE id = 'inc_add_pa_3';

-- ── Incubator · Jury Member (spec §6.2) ─────────────────────────────────────
UPDATE parameters SET key = 'add_barriers_of_entry', name = 'Barriers of entry',
  description = 'Defensibility vs new entrants — IP, network effects, switching costs, data advantage, regulatory moats.',
  prompt = 'Assess {{startup_name}}''s barriers to entry — IP, network effects, switching costs, data advantage or regulatory moats. Score 0–10.',
  config_permitted = 1
  WHERE id = 'inc_add_jury_1';
UPDATE parameters SET key = 'add_scalability', name = 'Scalability',
  description = 'Ability to grow revenue without proportional cost — margins, operational leverage, unit economics.',
  prompt = 'Evaluate the scalability of {{startup_name}} — gross margins, operational leverage and whether growth requires proportional cost. Score 0–10.'
  WHERE id = 'inc_add_jury_2';
UPDATE parameters SET key = 'add_industry_growth', name = 'Industry growth',
  description = 'Growth trajectory and tailwinds of the industry — market expansion, regulation, structural demand.',
  prompt = 'Assess the growth of {{sector}} for {{startup_name}} — TAM expansion, tailwinds, regulation and demand drivers. Score 0–10.'
  WHERE id = 'inc_add_jury_3';

-- ── VC · Investment Associate (spec §6.2, JP_ADDL.jp) ───────────────────────
UPDATE parameters SET key = 'add_thesis_fit', name = 'Thesis fit',
  description = 'Alignment with the fund''s thesis, sector focus and stage.',
  prompt = 'Assess how well {{startup_name}} ({{sector}}, {{stage}}) aligns with the fund''s thesis, sector focus and stage. Score 0–10.',
  config_permitted = 1
  WHERE id = 'vc_add_assoc_1';
UPDATE parameters SET key = 'add_investment_stage', name = 'Investment stage',
  description = 'Pre-seed / seed / post-seed classification and fit with the fund''s target stage.',
  prompt = 'From traction, funding history and team size, classify {{startup_name}} as pre-seed, seed or post-seed, and rate alignment with the fund''s target stage. Score 0–10.'
  WHERE id = 'vc_add_assoc_2';
UPDATE parameters SET key = 'add_ask_ticket_fit', name = 'Ask / Ticket size fit',
  description = 'Reasonableness of the raise and fit with the fund''s ticket size and reserves.',
  prompt = 'Assess whether {{startup_name}}''s raise is reasonable and fits the fund''s ticket size and reserve strategy. Score 0–10.'
  WHERE id = 'vc_add_assoc_3';

-- ── VC · Partner / Principal (spec §6.2, JP_ADDL.pp) ────────────────────────
UPDATE parameters SET key = 'add_trl_stage', name = 'TRL stage',
  description = 'Technology maturity on the Technology Readiness Level scale (1–9).',
  prompt = 'From the deck, determine {{startup_name}}''s Technology Readiness Level. Look for prototypes, pilots, deployments and third-party validation, then map to TRL 1–9. Score 0–10 accordingly.',
  config_permitted = 1
  WHERE id = 'vc_add_partner_1';
UPDATE parameters SET key = 'add_product_market_fit', name = 'Product-Market Fit',
  description = 'Retention, repeat/organic usage, unsolicited demand.',
  prompt = 'Assess product-market fit for {{startup_name}} — retention, repeat usage, organic referrals and customer love. Score 0–10.'
  WHERE id = 'vc_add_partner_2';
UPDATE parameters SET key = 'add_traction', name = 'Traction',
  description = 'Revenue, active customers, growth rate, pipeline, notable logos relative to stage.',
  prompt = 'Evaluate {{startup_name}}''s traction (revenue, active customers, growth rate, pipeline, notable logos) relative to {{stage}}. Score 0–10.'
  WHERE id = 'vc_add_partner_3';

-- ── VC · IC Member (spec §6.2) ──────────────────────────────────────────────
UPDATE parameters SET key = 'add_barriers_of_entry', name = 'Barriers of entry',
  description = 'Defensibility — IP, network effects, switching costs, data advantage, regulatory moats.',
  prompt = 'Assess {{startup_name}}''s barriers to entry — IP, network effects, switching costs, data advantage or regulatory moats. Score 0–10.',
  config_permitted = 1
  WHERE id = 'vc_add_ic_1';
UPDATE parameters SET key = 'add_scalability', name = 'Scalability',
  description = 'Ability to grow revenue without proportional cost.',
  prompt = 'Evaluate the scalability of {{startup_name}} — gross margins, operational leverage and whether growth requires proportional cost. Score 0–10.'
  WHERE id = 'vc_add_ic_2';
UPDATE parameters SET key = 'add_exit_attractiveness', name = 'Exit attractiveness',
  description = 'Plausibility and quality of exit paths — strategic acquirers, comparable exits, timing.',
  prompt = 'Assess exit attractiveness for {{startup_name}} — plausible strategic acquirers, comparable exits and realistic timing. Score 0–10.'
  WHERE id = 'vc_add_ic_3';
