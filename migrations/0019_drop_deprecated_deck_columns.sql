-- Session 8 — retire the deprecated free-text `decks.program` / `decks.cohort`.
--
-- Session 2 (migration 0011) introduced the real hierarchy — `sectors` →
-- `programs` → `cohorts` — added `decks.program_id` / `decks.cohort_id`, and
-- BACKFILLED them from these two text columns. Since then every upload has
-- written the FK columns only, so the text columns have been dead weight that
-- reads NULL for every post-Session-2 deck. Nothing in `src/**`, `test/**`,
-- `e2e/**` or `scripts/**` reads or writes them; the only references left are
-- the seed inserts in 0002/0005/0006/0008 and the 0011 backfill that consumed
-- them — all of which run BEFORE this migration, so a fresh replay still works.
--
-- SQLite has supported `ALTER TABLE … DROP COLUMN` since 3.35 (D1 is far newer)
-- and neither column is indexed, used in a view, a generated column, or a
-- partial-index predicate — the four things that make DROP COLUMN fail. So no
-- twelve-step table rebuild is needed here: a rebuild would have to re-create
-- the eleven inbound `ON DELETE CASCADE` foreign keys that point at
-- `decks(id)`, and getting that subtly wrong is a far bigger risk than the
-- statement below. (Verified against local D1 before the remote apply.)

ALTER TABLE decks DROP COLUMN program;
ALTER TABLE decks DROP COLUMN cohort;
