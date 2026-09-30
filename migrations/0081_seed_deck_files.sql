-- 0081 — F-FOUL: make the demo seed coherent. Give the seeded decks that carry
-- evaluation data the file their scores imply.
--
-- Sep-2026 client feedback rows 8 and 12. What he saw is real and it is ours:
-- all 34 seeded decks were created with `r2_key` NULL, 30 of them carrying 648
-- `scores` rows and 80 `evaluations` rows between them, and 25 sitting at or
-- past the evaluation gate — nine VC decks in `onboard_ready`, the terminal
-- stage — having never had a PDF. The seed therefore asserted something the code
-- forbids: `ai/evaluate.ts` throws on a missing key and again on a missing
-- object, so those 30 decks carry AI scores for files the AI would have refused
-- to read.
--
-- The NULLs were never a decision. Five migrations wrote these rows
-- (0002_seed.sql, 0005_seed_founder_decks.sql, 0006_seed_vc_decks.sql,
-- 0008_seed_analytics.sql, 0020_seed_demo_refresh.sql) and not one of them names
-- the `r2_key` column at all — it is NULL by omission.
--
-- WHY A NEW MIGRATION AND NOT AN EDIT TO THOSE FIVE. Wrangler's applied-
-- migrations table keys on FILENAME, so an edited file never re-runs: production
-- would keep the bad rows while every fresh local database got the good ones.
-- That is exactly the deploy drift this repo already suffers, manufactured on
-- purpose.
--
-- WHY THE KEY IS COMPUTED, NOT LISTED. `'decks/' || id || '.pdf'` is
-- `versionKey(id, 1)` (src/server/decks/versions.ts) spelled in SQL: version 1
-- takes no suffix. Every seeded deck has `content_version = 1`, so this is the
-- key the product itself would have written.
--
-- WHY A MIGRATION IS ONLY HALF THE FIX. SQL cannot write to R2, and an `r2_key`
-- pointing at nothing is WORSE than NULL: `GET /api/decks/:id/file` already
-- returns `no_pdf` for a dangling key, so the UI is unchanged — but a guard
-- written as `r2_key IS NOT NULL` would now PASS, defeated by the very fix meant
-- to satisfy it. `scripts/seed-deck-assets.mjs` puts the object behind each key,
-- and the single-deck guards check the object and not just the column. Run the
-- script; `npm run seed:deck-assets` is wired into `e2e:serve` for local runs and
-- `npm run seed:deck-assets:remote` is the one-off for a deployed bucket.
--
-- IDEMPOTENT AND SAFE ON A PARTIALLY-DRIFTED DATABASE. `WHERE r2_key IS NULL`
-- never overwrites a real upload; the explicit id list assumes nothing about
-- which of the 34 rows a given database actually has. The deployed D1 runs
-- behind the repo every wave.
--
-- THE FOUR DECKS DELIBERATELY LEFT WITHOUT A FILE, and they are correct:
--   inc_deck_payroute           `incomplete` — a deck whose intake failed is
--   inc_deck_meera_incomplete   `incomplete`   SUPPOSED to be thin
--   vc_deck_northbeam           `incomplete`
--   inc_deck_pitchloop          `pending_ai` — the deliberate AI-failure
--                               fixture, whose whole purpose is to have nothing
--                               to read (see 0020_seed_demo_refresh.sql).
-- They are also, exactly, the four seeded decks that carry no evaluation data:
-- the "has a file" and "has been evaluated" partitions are made to agree here.
--
-- If this list ever changes, `test/worker/deck-file-guard.test.ts` fails: it
-- parses this file and `scripts/seed-deck-assets.mjs` and asserts the two id
-- lists are identical, so the objects and the keys cannot drift apart.

UPDATE decks
   SET r2_key = 'decks/' || id || '.pdf',
       updated_at = COALESCE(updated_at, created_at)
 WHERE r2_key IS NULL
   AND id IN (
     -- incubator (12)
     'inc_deck_agrofresh',
     'inc_deck_creditbri',
     'inc_deck_edulift',
     'inc_deck_finstack',
     'inc_deck_greengrid',
     'inc_deck_greenroute',
     'inc_deck_insureflow',
     'inc_deck_medixir',
     'inc_deck_meera_signup',
     'inc_deck_solarc',
     'inc_deck_taxpilot',
     'inc_deck_wealthosi',
     -- VC (18)
     'vc_deck_agrichain',
     'vc_deck_agrichainvc',
     'vc_deck_b2bsaas',
     'vc_deck_climacore',
     'vc_deck_creditbridge',
     'vc_deck_cybervault',
     'vc_deck_dockflow',
     'vc_deck_finstackvc',
     'vc_deck_freshcart',
     'vc_deck_gridzero',
     'vc_deck_insureflowvc',
     'vc_deck_learnloop',
     'vc_deck_medgrid',
     'vc_deck_paywise',
     'vc_deck_petpal',
     'vc_deck_quantiq',
     'vc_deck_solarnest',
     'vc_deck_wealthos'
   );

-- The v1 history row 0016 meant these decks to have.
--
-- `0016_automation.sql` backfills one `deck_versions` row per deck "that already
-- has a stored PDF, so the history view is never empty for a deck that has one"
-- — and inserted ZERO rows, because at that point every seeded deck's `r2_key`
-- was NULL. The 30 rows above now have one, so they get the row 0016 intended;
-- without it the Versions view would be empty for a deck that shows a PDF, and
-- a re-upload would compute its next version off nothing.
--
-- Same shape as 0016's statement (`COALESCE(d.content_version, 1)`, all 34 are
-- 1), guarded by NOT EXISTS so a re-run and a partially-drifted database both
-- land on the same state.
INSERT INTO deck_versions (id, deck_id, version, r2_key, uploaded_by, note, created_at)
SELECT d.id || '_v1', d.id, COALESCE(d.content_version, 1), d.r2_key, d.uploaded_by,
       'Initial upload', d.created_at
  FROM decks d
 WHERE d.r2_key = 'decks/' || d.id || '.pdf'
   AND (d.id LIKE 'inc_deck_%' OR d.id LIKE 'vc_deck_%')
   AND NOT EXISTS (SELECT 1 FROM deck_versions v WHERE v.deck_id = d.id);
