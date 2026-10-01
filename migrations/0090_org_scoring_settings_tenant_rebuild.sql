-- 0090 — T0-SCHEMA · rebuild 3 of 11. `org_scoring_settings` PK `edition` →
--        `(tenant_id, edition)`.
--
-- Recipe and its justification: `0087_users_tenant_rebuild.sql`. Key choice:
-- `0089_org_settings_tenant_rebuild.sql`. Inbound edges: zero.
--
-- ── `ai_gate_threshold` IS WHY 0082 IS NUMBERED BELOW 0083 ───────────────────
-- `0082_ai_gate_threshold.sql` says so in its own header: "The NUMBER 0082 is not
-- free choice. `org_scoring_settings` is keyed on `edition` and is rebuild #1 of
-- `plan_multitenancy.md` §5e: that wave's `CREATE TABLE
-- org_scoring_settings_new (...)` enumerates its columns explicitly, and it was
-- authored from a branch where this column does not exist."
--
-- It exists now, it is reproduced below with its CHECK intact, and this is the
-- migration that would have silently dropped the screening gate if the screening
-- wave had shipped after tenancy instead of before it. The allotment table in
-- `test/worker/migrations-w1b.test.ts` records the ordering that made that
-- impossible. Seventeen other columns come across the same way, CHECKs and all:
-- the five AI-engine toggles, the four score-composition controls, the four
-- transparency toggles, `updated_at` and `updated_by`.

-- ── THE `DEFAULT` ON `tenant_id`, UNIFORM ACROSS ALL THIRTY ──────────────────
-- The 19 `ALTER TABLE` columns carry `DEFAULT 't_default'` because SQLite offers
-- no way to add a NOT NULL column to a populated table without one. The eleven
-- rebuilt tables could have gone without, and `0087`'s header records why they do
-- not: the loud form reddened 109 tests in files owned by other T1 sessions, and a
-- foundation session that merges red is seven T1 branches cut from a red commit.
-- The write-side guard is `test/worker/tenant-scope.test.ts`, per table, extended
-- by whichever session owns each INSERT.
--
CREATE TABLE org_scoring_settings__pre_tenant AS SELECT * FROM org_scoring_settings;

PRAGMA defer_foreign_keys = ON;

DROP TABLE org_scoring_settings;

CREATE TABLE org_scoring_settings (
  tenant_id                 TEXT NOT NULL DEFAULT 't_default',
  edition                   TEXT NOT NULL CHECK (edition IN ('incubator', 'vc')),

  -- ── Card 1 · AI engine behaviour (5 toggles) ──────────────────────────────
  ai_pre_scoring_enabled    INTEGER NOT NULL DEFAULT 1 CHECK (ai_pre_scoring_enabled IN (0, 1)),
  auto_clarification        INTEGER NOT NULL DEFAULT 1 CHECK (auto_clarification IN (0, 1)),
  show_ai_score_to_jury     INTEGER NOT NULL DEFAULT 1 CHECK (show_ai_score_to_jury IN (0, 1)),
  require_override_rationale INTEGER NOT NULL DEFAULT 1 CHECK (require_override_rationale IN (0, 1)),
  override_rationale_delta  REAL NOT NULL DEFAULT 2.0 CHECK (override_rationale_delta >= 0),
  jury_sees_peer_scores     INTEGER NOT NULL DEFAULT 0 CHECK (jury_sees_peer_scores IN (0, 1)),

  -- ── Card 2 · Score composition (4 controls) ───────────────────────────────
  score_scale               TEXT NOT NULL DEFAULT '0-10' CHECK (score_scale IN ('0-10', '1-5', '0-100')),
  composite_formula         TEXT NOT NULL DEFAULT 'weighted_average'
                              CHECK (composite_formula IN ('weighted_average', 'unweighted_average', 'median')),
  ai_weight_pct             INTEGER NOT NULL DEFAULT 40 CHECK (ai_weight_pct BETWEEN 0 AND 100),
  shortlist_threshold       REAL NOT NULL DEFAULT 7.0 CHECK (shortlist_threshold BETWEEN 0 AND 10),

  -- ── Card 3 · Score transparency & reports (4 toggles) ─────────────────────
  show_three_score_view     INTEGER NOT NULL DEFAULT 1 CHECK (show_three_score_view IN (0, 1)),
  show_score_drift          INTEGER NOT NULL DEFAULT 1 CHECK (show_score_drift IN (0, 1)),
  include_ai_evidence       INTEGER NOT NULL DEFAULT 1 CHECK (include_ai_evidence IN (0, 1)),
  intro_call_ai_prompts     INTEGER NOT NULL DEFAULT 1 CHECK (intro_call_ai_prompts IN (0, 1)),

  updated_at                TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by                TEXT REFERENCES users (id),

  -- 0082 — the SCREENING gate, distinct from `shortlist_threshold` above.
  ai_gate_threshold         REAL NOT NULL DEFAULT 5.0
                              CHECK (ai_gate_threshold BETWEEN 0 AND 10),

  PRIMARY KEY (tenant_id, edition)
);

INSERT INTO org_scoring_settings (
  tenant_id, edition, ai_pre_scoring_enabled, auto_clarification,
  show_ai_score_to_jury, require_override_rationale, override_rationale_delta,
  jury_sees_peer_scores, score_scale, composite_formula, ai_weight_pct,
  shortlist_threshold, show_three_score_view, show_score_drift,
  include_ai_evidence, intro_call_ai_prompts, updated_at, updated_by,
  ai_gate_threshold
)
SELECT
  't_default', edition, ai_pre_scoring_enabled, auto_clarification,
  show_ai_score_to_jury, require_override_rationale, override_rationale_delta,
  jury_sees_peer_scores, score_scale, composite_formula, ai_weight_pct,
  shortlist_threshold, show_three_score_view, show_score_drift,
  include_ai_evidence, intro_call_ai_prompts, updated_at, updated_by,
  ai_gate_threshold
FROM org_scoring_settings__pre_tenant;

DROP TABLE org_scoring_settings__pre_tenant;
