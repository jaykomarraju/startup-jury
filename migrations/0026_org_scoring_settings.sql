-- W1-B · migration 2 of 13 (0025 – 0037).
--
-- Admin console → Evaluation → **Scoring framework** (`admin/s-fw.html`, byte
-- identical in the incubator and VC Super User builds). Fifteen controls in
-- three cards; this table holds thirteen of them plus the override delta the
-- copy names. The remaining two — the Best / Poor cohort rating thresholds —
-- already exist as `org_settings.threshold_best` / `.threshold_mediocre` and
-- stay there so nothing that reads them has to move.
--
-- One row per edition, mirroring `org_settings` (single-tenant, two editions).
-- Seeded to the prototype's ON/OFF and default values exactly.
--
-- §1.2 — the prototype's fifth transparency toggle, "Mentor can adjust
-- composite after all jury complete", is deliberately ABSENT. `mentor` is a
-- directory record with no pipeline authority (commit 8822db2); storing the
-- flag would invite someone to honour it.

CREATE TABLE IF NOT EXISTS org_scoring_settings (
  edition                   TEXT PRIMARY KEY CHECK (edition IN ('incubator', 'vc')),

  -- ── Card 1 · AI engine behaviour (5 toggles) ──────────────────────────────
  -- "AI reads and scores every deck before jury sees it"
  ai_pre_scoring_enabled    INTEGER NOT NULL DEFAULT 1 CHECK (ai_pre_scoring_enabled IN (0, 1)),
  -- "Send targeted questions to startup when AI detects weak signal"
  auto_clarification        INTEGER NOT NULL DEFAULT 1 CHECK (auto_clarification IN (0, 1)),
  -- "Turn off for blind independent jury evaluation"
  show_ai_score_to_jury     INTEGER NOT NULL DEFAULT 1 CHECK (show_ai_score_to_jury IN (0, 1)),
  -- "Jury must explain overrides greater than N points from AI score"
  require_override_rationale INTEGER NOT NULL DEFAULT 1 CHECK (require_override_rationale IN (0, 1)),
  override_rationale_delta  REAL NOT NULL DEFAULT 2.0 CHECK (override_rationale_delta >= 0),
  -- "Turn off for fully independent scoring rounds" — OFF in the prototype.
  jury_sees_peer_scores     INTEGER NOT NULL DEFAULT 0 CHECK (jury_sees_peer_scores IN (0, 1)),

  -- ── Card 2 · Score composition (4 controls) ───────────────────────────────
  score_scale               TEXT NOT NULL DEFAULT '0-10' CHECK (score_scale IN ('0-10', '1-5', '0-100')),
  composite_formula         TEXT NOT NULL DEFAULT 'weighted_average'
                              CHECK (composite_formula IN ('weighted_average', 'unweighted_average', 'median')),
  -- The prototype offers 40/30/50/0 % AI; the rest of the composite is human.
  ai_weight_pct             INTEGER NOT NULL DEFAULT 40 CHECK (ai_weight_pct BETWEEN 0 AND 100),
  shortlist_threshold       REAL NOT NULL DEFAULT 7.0 CHECK (shortlist_threshold BETWEEN 0 AND 10),

  -- ── Card 3 · Score transparency & reports (4 toggles; mentor one omitted) ─
  show_three_score_view     INTEGER NOT NULL DEFAULT 1 CHECK (show_three_score_view IN (0, 1)),
  show_score_drift          INTEGER NOT NULL DEFAULT 1 CHECK (show_score_drift IN (0, 1)),
  include_ai_evidence       INTEGER NOT NULL DEFAULT 1 CHECK (include_ai_evidence IN (0, 1)),
  intro_call_ai_prompts     INTEGER NOT NULL DEFAULT 1 CHECK (intro_call_ai_prompts IN (0, 1)),

  updated_at                TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by                TEXT REFERENCES users (id)
);

INSERT INTO org_scoring_settings (edition) VALUES ('incubator'), ('vc')
  ON CONFLICT (edition) DO NOTHING;
