-- Session 1 (Evaluator Workbench): rescore guard via monotonic version counters.
--
-- The AI is nondeterministic, so we do NOT re-run it unless something material
-- changed: either the deck's CONTENT (a new PDF version) or the admin's scoring
-- CRITERIA (core weights / AI prompt / additional params). Two counters capture
-- exactly those two axes; the AI evaluation records the versions it scored under,
-- and a re-score is blocked when both still match (see routes/decks.ts /rescore).
--
-- Versions (integers) rather than content hashes: cheap, seedable from SQL, and
-- they need no R2 read to compare — the guard is a pure metadata check.

-- Bumped whenever an admin changes the scoring criteria (weights / AI prompt /
-- additional params) — see routes/config.ts.
ALTER TABLE org_settings ADD COLUMN criteria_version INTEGER NOT NULL DEFAULT 1;

-- Bumped whenever the deck's PDF content is replaced (deck versioning lands in a
-- later session; the column exists now so the guard's content axis is wired).
ALTER TABLE decks ADD COLUMN content_version INTEGER NOT NULL DEFAULT 1;

-- The criteria/content versions in force when the AI evaluation was produced.
-- Set on the AI roll-up row (evaluator_id IS NULL) by evaluateDeck; NULL for
-- human evaluation rows (the guard only governs the AI re-run).
ALTER TABLE evaluations ADD COLUMN scored_criteria_version INTEGER;
ALTER TABLE evaluations ADD COLUMN scored_content_version INTEGER;
