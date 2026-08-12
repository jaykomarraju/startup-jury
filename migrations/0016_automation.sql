-- Session 5 — Automation: intake guardrails, deck versioning, shortlist floor.
--
-- Four additive concerns, all from the Jul-24 demo (FINISH-PLAN §8):
--
--   1. programs.shortlist_min — the per-program MINIMUM SCORE a deck must reach
--      before a juror may shortlist it. NULL = no floor (the program is ungated).
--      Enforced in routes/pipeline.ts when a shortlist action runs; the jury still
--      does the shortlisting, this is only a guardrail.
--
--   2. decks.founder_email / founder_phone — the required founder/contact detail
--      the upload validation enforces (founder, email, phone, city, sector). The
--      form supplies them on a single upload; the AI extraction fills them in on a
--      bulk upload. decks.missing_fields records the ones still absent (CSV of the
--      shared/intake field keys) so an Incomplete deck can say WHAT is missing —
--      Session 6's resubmit email reads exactly this column.
--
--   3. decks.intake_flag / intake_flag_note / related_deck_id — the SOFT duplicate
--      alert (cost-driven: every AI run costs a credit) and the returning-company
--      history tag (seed → Series A). Never a hard block; the deck is stored and
--      scored either way.
--
--   4. deck_versions — a re-upload keeps the deck row and saves a NEW version with
--      history. decks.r2_key always points at the latest version; content_version
--      (0009) is the version counter the AI rescore guard reads, so a re-upload is
--      automatically a valid reason to re-score. Feeds Session 6's resubmit loop.

-- ── 1. Per-program shortlist floor ───────────────────────────────────────────
ALTER TABLE programs ADD COLUMN shortlist_min REAL;

-- ── 2/3. Deck intake columns ─────────────────────────────────────────────────
ALTER TABLE decks ADD COLUMN founder_email    TEXT;
ALTER TABLE decks ADD COLUMN founder_phone    TEXT;
ALTER TABLE decks ADD COLUMN missing_fields   TEXT;
ALTER TABLE decks ADD COLUMN intake_flag      TEXT;
ALTER TABLE decks ADD COLUMN intake_flag_note TEXT;
ALTER TABLE decks ADD COLUMN related_deck_id  TEXT REFERENCES decks (id);

-- ── 4. Deck version history ──────────────────────────────────────────────────
CREATE TABLE deck_versions (
  id          TEXT PRIMARY KEY,
  deck_id     TEXT NOT NULL REFERENCES decks (id),
  version     INTEGER NOT NULL,
  r2_key      TEXT NOT NULL,
  file_name   TEXT,
  size_bytes  INTEGER,
  uploaded_by TEXT REFERENCES users (id),
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (deck_id, version)
);

CREATE INDEX idx_deck_versions_deck ON deck_versions (deck_id, version);

-- Backfill v1 for every deck that already has a stored PDF, so the history view
-- is never empty for a deck that has one.
INSERT INTO deck_versions (id, deck_id, version, r2_key, uploaded_by, note, created_at)
SELECT d.id || '_v1', d.id, COALESCE(d.content_version, 1), d.r2_key, d.uploaded_by,
       'Initial upload', d.created_at
FROM decks d
WHERE d.r2_key IS NOT NULL;

-- ── Demo seed ────────────────────────────────────────────────────────────────
-- Shortlist floors so the guardrail is live on the demo. Values sit BELOW every
-- currently shortlistable deck's decision score, so the seeded happy paths still
-- work; raise a floor in Set up to demo the block.
--
-- **Fintech Accelerator is deliberately left with NO floor.** Its demo decks
-- (FinStack / InsureFlow) carry only ONE seeded AI parameter score each, so any
-- admin weight edit re-scores them over the full 13-weight denominator and their
-- ai_score collapses (8.6 → 0.87). That is correct re-score behaviour, but it
-- would make a floor there block the demo's canonical jury shortlist after an
-- unrelated config change. Climate Cohort's decks carry the full 13-parameter
-- breakdown (migration 0010) and are stable, so the floor lives there.
UPDATE programs SET shortlist_min = 5.5 WHERE edition = 'incubator' AND name = 'Climate Cohort';
UPDATE programs SET shortlist_min = 5.5 WHERE edition = 'vc'        AND name = 'Deep Tech Fund';
UPDATE programs SET shortlist_min = 6.5 WHERE edition = 'vc'        AND name = 'Fund II';
-- Fintech Accelerator + SaaS Accelerator are the "no floor configured" case.

-- Founder contact detail on the decks that already carry a founder name, so the
-- intake panel and the S6 resubmit email have real recipients on the demo.
UPDATE decks SET founder_email = 'meera.sharma@demo.startupjury.ai', founder_phone = '9845012345'
  WHERE id = 'inc_deck_meera_signup';
-- NimbusHR is the canonical Incomplete case: contact email known, phone missing.
UPDATE decks SET founder_email = 'meera.sharma@demo.startupjury.ai'
  WHERE id = 'inc_deck_meera_incomplete';

-- The two seeded Incomplete decks record WHY they are incomplete, so the missing-
-- sections surface (and Session 6's tokenized resubmit email) is demoable at once.
UPDATE decks SET missing_fields = 'founderEmail,founderPhone'
  WHERE id = 'inc_deck_payroute';
UPDATE decks SET missing_fields = 'founderPhone'
  WHERE id = 'inc_deck_meera_incomplete';
