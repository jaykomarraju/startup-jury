-- V4-WEIGHT · the AI/jury split a programme (or cohort) was created under.
--
-- The client, 2026-09-20, on making 50:50 the default:
--
--   "If you are making 50:50 as default, previous cohorts will remain same.
--    only the new program or cohorts would take effect."
--
-- `org_scoring_settings.ai_weight_pct` (0026) is ONE ROW PER EDITION and the
-- blend happens at READ time, so moving that single value re-blends the
-- displayed "Avg. score" of every deck ever uploaded — precisely the thing he
-- ruled out. There is also no second row to give a new default to: 0026 seeds
-- `incubator` and `vc` and nothing in the app ever INSERTs another. So a
-- new-things-only default has to be stored on the new thing itself.
--
-- NULL means "follow the organisation's split" and is what EVERY row existing
-- when this migration runs keeps — no DEFAULT is declared, because SQLite's
-- ALTER TABLE ADD COLUMN ... DEFAULT backfills existing rows with that value,
-- which would re-weight every previous cohort on the spot. New programmes and
-- cohorts are stamped by the routes that create them, from
-- `NEW_PROGRAMME_AI_WEIGHT_PCT` in src/shared/scoring.ts.
--
-- Resolution is cohort -> programme -> org (`aiWeightFor`, same shape as the
-- `shortlistFloor` fallback 0016 introduced for `programs.shortlist_min`).
-- Nothing STORED changes here and nothing is re-scored: this column only
-- selects which split the read-time blend uses.

ALTER TABLE programs ADD COLUMN ai_weight_pct INTEGER
  CHECK (ai_weight_pct IS NULL OR ai_weight_pct BETWEEN 0 AND 100);

ALTER TABLE cohorts ADD COLUMN ai_weight_pct INTEGER
  CHECK (ai_weight_pct IS NULL OR ai_weight_pct BETWEEN 0 AND 100);
