-- Aug-2026 issue log — items 1 (alias titles) and 2 (search & tag decks).
--
-- 1. `users.title` is an ORGANIZATIONAL ALIAS shown in the top ribbon and on
--    reports instead of the platform role label. The underlying `role` is
--    untouched, so every permission check, nav manifest and pipeline transition
--    keeps working exactly as before — this is presentation only.
-- 2. `decks.tags` is a JSON array of free-text tags used by the new deck search
--    + tag facility on All decks.

ALTER TABLE users ADD COLUMN title TEXT;
ALTER TABLE decks ADD COLUMN tags TEXT;

-- Issue 12 — "startup name, stage, sector, cohort must be automatically
-- recognized with manual over-ride facility". The uploader may leave the name
-- blank, in which case the file name is used as a PROVISIONAL name and this flag
-- is set; the AI extraction then replaces it with the real startup name off the
-- deck. Anything the uploader actually typed always wins, and every field stays
-- editable afterwards via PATCH /api/decks/:id.
ALTER TABLE decks ADD COLUMN name_auto INTEGER NOT NULL DEFAULT 0;

-- Search hits `name`/`founder`/`sector`/`city` with LIKE; this index keeps the
-- edition+status pre-filter cheap on the way in.
CREATE INDEX IF NOT EXISTS idx_decks_edition_status ON decks (edition, status);

-- Demo alias titles, so the ribbon shows the feature working on the seeded logins.
UPDATE users SET title = 'Head of Programs'            WHERE id = 'inc_superuser';
UPDATE users SET title = 'Operations Lead'             WHERE id = 'inc_admin';
UPDATE users SET title = 'Cohort Director'             WHERE id = 'inc_pm';
UPDATE users SET title = 'Programme Coordinator'       WHERE id = 'inc_pa';
UPDATE users SET title = 'External Jury — Fintech'     WHERE id = 'inc_jury';
UPDATE users SET title = 'Managing Partner'            WHERE id = 'vc_superuser';
UPDATE users SET title = 'Fund Operations'             WHERE id = 'vc_admin';
UPDATE users SET title = 'General Partner'             WHERE id = 'vc_partner';
UPDATE users SET title = 'Investment Committee'        WHERE id = 'vc_ic';
UPDATE users SET title = 'Investment Associate'        WHERE id = 'vc_associate';
UPDATE users SET title = 'Research Analyst'            WHERE id = 'vc_analyst';

-- Demo tags so the tag filter has something to filter on.
UPDATE decks SET tags = '["priority","fintech"]'  WHERE id = 'inc_deck_finstack';
UPDATE decks SET tags = '["insurtech"]'           WHERE id = 'inc_deck_insureflow';
UPDATE decks SET tags = '["follow-up"]'           WHERE id = 'inc_deck_payroute';
UPDATE decks SET tags = '["climate","priority"]'  WHERE id = 'inc_deck_greenroute';
UPDATE decks SET tags = '["priority"]'            WHERE id = 'vc_deck_wealthos';
UPDATE decks SET tags = '["fintech"]'             WHERE id = 'vc_deck_creditbridge';
