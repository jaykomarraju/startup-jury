-- Session 2 — Program & Cohort hierarchy.
--
-- Introduces the Sector → Program → Cohort umbrella. `programs` is the umbrella
-- over everything (an org-admin creates them); each program has many cohorts.
-- VC programs also carry fund fields (committed / allocated / deployed) that feed
-- the Capital Deployment report. `decks` gains program_id / cohort_id FKs; the
-- old free-text `decks.program` / `decks.cohort` columns stay until Session 8 and
-- are backfilled into the new tables below (generic — works for any existing data).

-- A configurable list of sectors per edition (the wizard's Sectors chips + the
-- program's sector field). Free-text `programs.sector` matches a name here.
CREATE TABLE sectors (
  id         TEXT PRIMARY KEY,
  edition    TEXT NOT NULL CHECK (edition IN ('incubator', 'vc')),
  name       TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sectors_edition ON sectors (edition, active);

-- The umbrella object. Fund fields are VC-only (NULL for incubator programs).
CREATE TABLE programs (
  id               TEXT PRIMARY KEY,
  edition          TEXT NOT NULL CHECK (edition IN ('incubator', 'vc')),
  sector           TEXT,
  name             TEXT NOT NULL,
  description      TEXT,
  -- VC fund economics (₹ Cr) — feed Capital Deployment reports.
  fund_size        REAL,
  fund_allocated   REAL,
  capital_deployed REAL,
  active           INTEGER NOT NULL DEFAULT 1,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_programs_edition ON programs (edition, active);

-- A cohort/batch under a program (e.g. Jan cohort, next-quarter cohort).
CREATE TABLE cohorts (
  id         TEXT PRIMARY KEY,
  program_id TEXT NOT NULL REFERENCES programs (id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  starts_on  TEXT,
  ends_on    TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_cohorts_program ON cohorts (program_id, active);

-- Deck FKs into the hierarchy. Old free-text program/cohort kept until Session 8.
ALTER TABLE decks ADD COLUMN program_id TEXT REFERENCES programs (id);
ALTER TABLE decks ADD COLUMN cohort_id  TEXT REFERENCES cohorts (id);
CREATE INDEX idx_decks_program ON decks (program_id);
CREATE INDEX idx_decks_cohort  ON decks (cohort_id);

-- ── Backfill: distinct free-text programs → programs rows ─────────────────────
INSERT INTO programs (id, edition, name, active, sort_order)
WITH distinct_progs AS (
  SELECT DISTINCT edition, program FROM decks
  WHERE program IS NOT NULL AND TRIM(program) <> ''
),
numbered AS (
  SELECT edition, program, ROW_NUMBER() OVER (ORDER BY edition, program) AS rn
  FROM distinct_progs
)
SELECT 'prog_' || edition || '_' || printf('%04d', rn), edition, program, 1, rn FROM numbered;

UPDATE decks SET program_id = (
  SELECT p.id FROM programs p WHERE p.edition = decks.edition AND p.name = decks.program
)
WHERE program IS NOT NULL AND TRIM(program) <> '';

-- ── Backfill: distinct (program, cohort) → cohorts rows ──────────────────────
INSERT INTO cohorts (id, program_id, name, active, sort_order)
WITH distinct_cohorts AS (
  SELECT DISTINCT program_id, cohort FROM decks
  WHERE cohort IS NOT NULL AND TRIM(cohort) <> '' AND program_id IS NOT NULL
),
numbered AS (
  SELECT program_id, cohort, ROW_NUMBER() OVER (ORDER BY program_id, cohort) AS rn
  FROM distinct_cohorts
)
SELECT 'coh_' || printf('%04d', rn), program_id, cohort, 1, rn FROM numbered;

UPDATE decks SET cohort_id = (
  SELECT c.id FROM cohorts c WHERE c.program_id = decks.program_id AND c.name = decks.cohort
)
WHERE cohort IS NOT NULL AND TRIM(cohort) <> '' AND program_id IS NOT NULL;
