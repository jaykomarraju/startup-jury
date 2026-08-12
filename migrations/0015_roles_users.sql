-- Session 4 — Roles & permissions.
--
-- Two additive columns + demo seed:
--   1. programs.owner_id — the Program Manager who LEADS a program. The Jul-24
--      demo made the PM the decision maker who "manages cohorts for programs they
--      lead"; owner_id is how a PM's cohort-management authority is scoped (see
--      routes/programs.ts). NULL = no owning PM (admin/superuser manage it).
--   2. users.user_type — 'staff' (default; ordinary platform users) or 'mentor'.
--      MENTOR DECISION (Session 4): mentor is a USER-TYPE, not an authorization
--      role. Evidence: the role-assignment matrix has no mentor column, and NONE
--      of the incubator/VC prototype user-creation dropdowns offer "Mentor" — it
--      appears only as advisor terminology (a mentor assigned to a startup) and a
--      scoring-parameter label. So a mentor is a directory/advisor record with no
--      pipeline authority; dedicated mentor tooling is future work. A mentor row
--      carries user_type='mentor' AND role='mentor' (a non-privileged value that
--      is in no authZ/nav list), so mentors never gain evaluation powers.

ALTER TABLE programs ADD COLUMN owner_id TEXT REFERENCES users (id);
ALTER TABLE users ADD COLUMN user_type TEXT NOT NULL DEFAULT 'staff';

-- ── Demo seed ────────────────────────────────────────────────────────────────
-- Raj Kumar (inc_pm, Program Manager) leads the incubator programs, so he can
-- manage their cohorts in the Set up wizard (owner-scoped).
UPDATE programs SET owner_id = 'inc_pm' WHERE edition = 'incubator';

-- One demo mentor so the Admin-console roster shows the mentor user-type live.
-- role='mentor' grants no pipeline/nav access (advisor tooling is future work).
INSERT INTO users (id, name, email, password_hash, role, edition, initials, user_type) VALUES
  ('inc_mentor', 'Anil Mehta', 'anil.mehta@demo.startupjury.ai', 'pbkdf2$100000$WZJYdAIVAjK8mx0Ac0g+WA==$sf3KrNCz3DIODrtWC5mgxMf9SA2gY2b6Mbq7B9l5R2Y=', 'mentor', 'incubator', 'AM', 'mentor');
