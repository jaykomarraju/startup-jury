-- ═══════════════════════════════════════════════════════════════════════════
-- W2-A · migration 0038 — three fix-ups Wave 1 integration assigned this
-- session (plan_parity.md §9), plus the criteria bump the Scoring framework's
-- own composition controls need.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Every table this session's UI writes already exists: `org_scoring_settings`
-- (0026) holds all thirteen controls at the prototype's exact defaults, and
-- `parameters.config_permitted` (0025) holds the *Permit configuration* flag.
-- Nothing here adds a column for the feature; these are corrections.

-- ── 1. Re-score is returning 409 for every seeded deck ──────────────────────
--
-- `0025` rewrote all eighteen role-parameter AI prompts (and `0027` rewrote the
-- thirteen core ones) but neither bumped `org_settings.criteria_version`. The
-- re-score guard (src/server/routes/decks.ts) compares a deck's
-- `scored_criteria_version` against the current one and refuses when they
-- match, so every seeded AI evaluation reads as current against a rubric that
-- changed underneath it and "Re-run AI score" answers `409 already_scored`.
--
-- Bumping the version is exactly what the config routes do on any criteria
-- edit; doing it here makes the shipped feature work again on the seed.
UPDATE org_settings SET criteria_version = criteria_version + 1;

-- ── 2. Duplicate (edition, key) parameter rows ──────────────────────────────
--
-- `0007` seeded four interim informational parameters; `0013` retired them
-- (`active = 0`) and seeded the full 3-per-role set. `0025` then renamed two of
-- those newer rows onto keys `0007` had already used:
--
--   add_program_fit   inc_add_program_fit (0007, retired)  ⟷  inc_add_pa_1
--   add_thesis_fit    vc_add_thesis_fit   (0007, retired)  ⟷  vc_add_assoc_1
--
-- Latent rather than live — the `0007` rows are inactive and nothing in `src/`
-- looks a parameter up by key — but it is a trap for the first `WHERE key = ?`
-- that forgets `active = 1`. Delete the two retired rows and make the collision
-- impossible. Neither carries a child row: `scores` (0001), the five-band
-- anchors (0027) and the question bank (0028) are all seeded by explicit id and
-- none names these two.
DELETE FROM parameters WHERE id IN ('inc_add_program_fit', 'vc_add_thesis_fit');

-- Partial, so a soft-deleted row can still release its key for re-use — which
-- is what `DELETE /api/config/additional-params/:id` does (it sets active = 0).
CREATE UNIQUE INDEX IF NOT EXISTS idx_parameters_edition_key_active
  ON parameters (edition, key) WHERE active = 1;

-- ── 3. Twelve of eighteen seeded AI comments describe the wrong parameter ───
--
-- `0014` wrote its demo comments against the pre-`0025` names, so the workbench
-- explains "Founder Resilience & Coachability" under a heading that now reads
-- "Barriers of entry". Cosmetic in production, but it is what a client sees in
-- the demo. All eighteen are re-written here against the specs' §6.2 canonical
-- set so the two files can never drift apart again by halves.
--
--   TaxPilot   PA  Program fit · Investment stage · Ask
--              PM  TRL stage · Product-Market Fit · Traction
--              Jury Barriers of entry · Scalability · Industry growth
--   WealthOS   Assoc  Thesis fit · Investment stage · Ask / Ticket size fit
--              Partner TRL stage · Product-Market Fit · Traction
--              IC     Barriers of entry · Scalability · Exit attractiveness
--
-- Values are left exactly as `0014` seeded them: the roll-ups in `0010` and the
-- workbench averages on the demo are computed from them.

UPDATE scores SET comment = 'Squarely in the SMB fintech accelerator track — sector and stage both line up.'
  WHERE id = 'ai_tp_add_pa_1';
UPDATE scores SET comment = 'Post-seed on traction and team size; the deck targets a seed-stage programme.'
  WHERE id = 'ai_tp_add_pa_2';
UPDATE scores SET comment = 'Ask is proportionate to the stage; use of funds and runway are spelled out.'
  WHERE id = 'ai_tp_add_pa_3';
UPDATE scores SET comment = 'TRL 7 — deployed with paying customers, though not yet at scale.'
  WHERE id = 'ai_tp_add_pm_1';
UPDATE scores SET comment = 'Repeat filings and low churn point to real fit; retention data is thin.'
  WHERE id = 'ai_tp_add_pm_2';
UPDATE scores SET comment = 'Early revenue with a named pipeline; growth rate is not yet evidenced.'
  WHERE id = 'ai_tp_add_pm_3';
UPDATE scores SET comment = 'Compliance integrations and filing history raise switching costs.'
  WHERE id = 'ai_tp_add_jury_1';
UPDATE scores SET comment = 'Software margins, but onboarding still needs hands-on support per customer.'
  WHERE id = 'ai_tp_add_jury_2';
UPDATE scores SET comment = 'Digital tax compliance is expanding on regulatory tailwinds.'
  WHERE id = 'ai_tp_add_jury_3';

UPDATE scores SET comment = 'Squarely in the fund''s fintech / wealthtech thesis.'
  WHERE id = 'ai_wo_add_assoc_1';
UPDATE scores SET comment = 'Series A metrics and materials are consistent with the fund''s target stage.'
  WHERE id = 'ai_wo_add_assoc_2';
UPDATE scores SET comment = 'Round size fits the fund''s ticket range with room to reserve.'
  WHERE id = 'ai_wo_add_assoc_3';
UPDATE scores SET comment = 'TRL 8 — live platform with regulated AUM under management.'
  WHERE id = 'ai_wo_add_partner_1';
UPDATE scores SET comment = 'Strong retention and organic inflows beyond the AUM headline.'
  WHERE id = 'ai_wo_add_partner_2';
UPDATE scores SET comment = 'AUM growth and named institutional customers, well ahead of stage.'
  WHERE id = 'ai_wo_add_partner_3';
UPDATE scores SET comment = 'Licences and custody relationships are a real regulatory moat.'
  WHERE id = 'ai_wo_add_ic_1';
UPDATE scores SET comment = 'Marginal cost per account is near zero once the platform is live.'
  WHERE id = 'ai_wo_add_ic_2';
UPDATE scores SET comment = 'Credible strategic acquirers among incumbent wealth platforms.'
  WHERE id = 'ai_wo_add_ic_3';
