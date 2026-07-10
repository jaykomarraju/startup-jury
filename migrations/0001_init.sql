-- Phase 1 schema. Single-tenant: one implicit organization; both editions
-- (incubator | vc) coexist. Sessions live in KV, not here.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  role          TEXT NOT NULL,
  edition       TEXT NOT NULL CHECK (edition IN ('incubator', 'vc')),
  initials      TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Per-edition settings singleton (plan tier, credits, branding, AI prompt,
-- cohort thresholds Best/Mediocre).
CREATE TABLE org_settings (
  edition             TEXT PRIMARY KEY CHECK (edition IN ('incubator', 'vc')),
  plan                TEXT NOT NULL DEFAULT 'standard' CHECK (plan IN ('standard', 'pro', 'premium')),
  credits_balance     INTEGER NOT NULL DEFAULT 0,
  branding_json       TEXT NOT NULL DEFAULT '{}',
  ai_system_prompt    TEXT,
  threshold_best      REAL NOT NULL DEFAULT 7.0,
  threshold_mediocre  REAL NOT NULL DEFAULT 5.0
);

-- Scoring parameters. Core parameters are weighted; informational ones are
-- unweighted extras gated by plan tier. role_scope marks role-configured extras.
CREATE TABLE parameters (
  id            TEXT PRIMARY KEY,
  edition       TEXT NOT NULL CHECK (edition IN ('incubator', 'vc')),
  key           TEXT NOT NULL,
  name          TEXT NOT NULL,
  weight        REAL NOT NULL DEFAULT 0,
  informational INTEGER NOT NULL DEFAULT 0,
  role_scope    TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_parameters_edition ON parameters (edition, active);

-- Global rubric anchor bands (0-1 / 2-4 / 5-7 / 8-10).
CREATE TABLE rubric_anchors (
  band        TEXT PRIMARY KEY,
  min_score   INTEGER NOT NULL,
  max_score   INTEGER NOT NULL,
  label       TEXT NOT NULL
);

-- The central object: a pitch deck moving through a pipeline.
CREATE TABLE decks (
  id           TEXT PRIMARY KEY,
  edition      TEXT NOT NULL CHECK (edition IN ('incubator', 'vc')),
  name         TEXT NOT NULL,
  sector       TEXT,
  stage        TEXT,
  city         TEXT,
  program      TEXT,
  cohort       TEXT,
  status       TEXT NOT NULL,
  ai_score     REAL,
  signal       TEXT,
  assigned_to  TEXT REFERENCES users (id),
  uploaded_by  TEXT REFERENCES users (id),
  r2_key       TEXT,
  complete     INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_decks_edition_status ON decks (edition, status);

CREATE TABLE deck_extractions (
  id         TEXT PRIMARY KEY,
  deck_id    TEXT NOT NULL REFERENCES decks (id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  heading    TEXT,
  text       TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  missing    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_extractions_deck ON deck_extractions (deck_id);

-- One row per (deck, evaluator, parameter). AI scores use evaluator_kind='ai'.
CREATE TABLE scores (
  id             TEXT PRIMARY KEY,
  deck_id        TEXT NOT NULL REFERENCES decks (id) ON DELETE CASCADE,
  evaluator_id   TEXT REFERENCES users (id),
  evaluator_kind TEXT NOT NULL DEFAULT 'human' CHECK (evaluator_kind IN ('human', 'ai')),
  parameter_id   TEXT NOT NULL REFERENCES parameters (id),
  value          REAL NOT NULL,
  comment        TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_scores_deck ON scores (deck_id);

-- Per (deck, evaluator) roll-up with the verdict.
CREATE TABLE evaluations (
  id             TEXT PRIMARY KEY,
  deck_id        TEXT NOT NULL REFERENCES decks (id) ON DELETE CASCADE,
  evaluator_id   TEXT REFERENCES users (id),
  weighted_total REAL,
  verdict        TEXT,
  remarks        TEXT,
  submitted_at   TEXT
);
CREATE INDEX idx_evaluations_deck ON evaluations (deck_id);

-- Append-only audit of stage transitions (drives Activity Log / Decision History).
CREATE TABLE pipeline_events (
  id         TEXT PRIMARY KEY,
  deck_id    TEXT NOT NULL REFERENCES decks (id) ON DELETE CASCADE,
  actor_id   TEXT REFERENCES users (id),
  from_stage TEXT,
  to_stage   TEXT NOT NULL,
  action     TEXT NOT NULL,
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_events_deck ON pipeline_events (deck_id, created_at);

-- Founder clarification loop (Incomplete → Query → Response).
CREATE TABLE queries (
  id              TEXT PRIMARY KEY,
  deck_id         TEXT NOT NULL REFERENCES decks (id) ON DELETE CASCADE,
  questions       TEXT NOT NULL,
  email_status    TEXT NOT NULL DEFAULT 'pending',
  founder_response TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at     TEXT
);

CREATE TABLE calls (
  id           TEXT PRIMARY KEY,
  deck_id      TEXT NOT NULL REFERENCES decks (id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('intro', 'partner', 'alignment')),
  scheduled_at TEXT,
  remarks      TEXT,
  created_by   TEXT REFERENCES users (id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- VC-specific.
CREATE TABLE investment_dd (
  id          TEXT PRIMARY KEY,
  deck_id     TEXT NOT NULL REFERENCES decks (id) ON DELETE CASCADE,
  notes       TEXT,
  mp_approved INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE ic_votes (
  id         TEXT PRIMARY KEY,
  deck_id    TEXT NOT NULL REFERENCES decks (id) ON DELETE CASCADE,
  member_id  TEXT NOT NULL REFERENCES users (id),
  vote       TEXT NOT NULL CHECK (vote IN ('invest', 'hold', 'need_more_info', 'pass')),
  comment    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_ic_votes_deck ON ic_votes (deck_id);

CREATE TABLE term_sheets (
  id         TEXT PRIMARY KEY,
  deck_id    TEXT NOT NULL REFERENCES decks (id) ON DELETE CASCADE,
  valuation  TEXT,
  ownership  TEXT,
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE legal_dd (
  id         TEXT PRIMARY KEY,
  deck_id    TEXT NOT NULL REFERENCES decks (id) ON DELETE CASCADE,
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE portfolio (
  id               TEXT PRIMARY KEY,
  deck_id          TEXT NOT NULL REFERENCES decks (id) ON DELETE CASCADE,
  capital_deployed TEXT,
  onboarded_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE tickets (
  id            TEXT PRIMARY KEY,
  edition       TEXT NOT NULL CHECK (edition IN ('incubator', 'vc')),
  subject       TEXT NOT NULL,
  body          TEXT,
  status        TEXT NOT NULL DEFAULT 'open',
  created_by    TEXT REFERENCES users (id),
  billing_routed INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE messages (
  id         TEXT PRIMARY KEY,
  edition    TEXT NOT NULL CHECK (edition IN ('incubator', 'vc')),
  from_id    TEXT REFERENCES users (id),
  to_scope   TEXT NOT NULL CHECK (to_scope IN ('admin', 'team')),
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
