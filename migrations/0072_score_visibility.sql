-- V3-SF · migration 0072 — the allotted number (the V3 superuser wave is
-- 0066–0074, one per session; `docs/plan_v3_superuser.md` §7).
--
-- V3 item 13 — "Visibility of other's evaluations". The v3 superuser
-- prototype's admin console (base64 `ADMIN_B64`, section `s-fw`) replaces the
-- single "Jury can see each other's scores" toggle with two matrices,
-- `Visibility for Incubator` (4×4) and `Visibility for VC` (5×5), captioned
-- "Viewer (row) → can see scores of (column)". Until now this was the FIXED
-- rank ladder `EVALUATION_RANK` in src/shared/roles.ts.
--
-- One row per configured cell. The table is intentionally SPARSE: an unwritten
-- cell falls back to `DEFAULT_VISIBILITY` in src/shared/scoreVisibility.ts,
-- which is the prototype's own printed toggle state, so a fresh org and an org
-- that has never opened the console behave identically and the console renders
-- the state the server actually enforces.
--
-- `viewer_role` / `target_role` are role STRINGS rather than FKs: they name
-- roles, not users, and the resolver drops any pair outside the edition's own
-- matrix so a stale row can never grant visibility the console cannot draw.

CREATE TABLE IF NOT EXISTS score_visibility (
  edition      TEXT NOT NULL,
  viewer_role  TEXT NOT NULL,
  target_role  TEXT NOT NULL,
  visible      INTEGER NOT NULL CHECK (visible IN (0, 1)),
  updated_at   TEXT NOT NULL,
  updated_by   TEXT REFERENCES users (id) ON DELETE SET NULL,
  PRIMARY KEY (edition, viewer_role, target_role)
);

CREATE INDEX IF NOT EXISTS idx_score_visibility_edition ON score_visibility (edition);
