-- W1-B · migration 10 of 13 (0025 – 0037).
--
-- Spec §12 `signups` / `signup_documents`, and spec §8.3 "Sign-up / onboarding
-- workspace (three tabs)". Plus the admin console's **Required documents**
-- section (`admin/s-sudocs.html`), which is the per-programme checklist every
-- new sign-up inherits.
--
--   signups            one per deck that enters the sign-up funnel. Carries the
--                      signing-method model (§8.3), the authorised signatory,
--                      the PM assignment gate, and the `seatless` flag.
--   required_documents the admin-configured checklist, per programme / cohort.
--   signup_documents   the instance of that checklist on one sign-up, walking
--                      not_requested → awaiting → submitted → verified.
--
-- The Documents tab and the Founder tab share ONE document set (§8.3) — hence
-- one table, read by both surfaces, rather than a founder copy.
--
-- §1.3 — `signing_provider` names a provider; nothing here holds a credential
-- or calls one. The provider interface is stubbed, exactly like
-- `src/server/email/outbox.ts`.

CREATE TABLE IF NOT EXISTS signups (
  id           TEXT PRIMARY KEY,
  deck_id      TEXT NOT NULL UNIQUE REFERENCES decks (id) ON DELETE CASCADE,
  -- Spec §8.2, sign-up half of the funnel. initiated → progress → completed →
  -- onboarded is the happy path; archived is terminal.
  status       TEXT NOT NULL DEFAULT 'initiated'
                 CHECK (status IN ('initiated', 'progress', 'completed', 'onboarded', 'archived')),
  -- Spec §8.3 signing-method model, locked once the founder signs.
  signing_provider TEXT CHECK (signing_provider IS NULL OR signing_provider IN ('SignDesk', 'DocuSign', 'Adobe', 'Zoho', 'eMudhra')),
  sig_type         TEXT CHECK (sig_type IS NULL OR sig_type IN ('standard', 'certificate')),
  in_app           INTEGER NOT NULL DEFAULT 1 CHECK (in_app IN (0, 1)),
  wet_ink          INTEGER NOT NULL DEFAULT 0 CHECK (wet_ink IN (0, 1)),
  -- §8.3: countersign stays disabled until a signatory is assigned in-workspace.
  authorised_signatory_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  -- §8.3 assignment gate: a Program Manager's workspace is READ-ONLY until a
  -- Super User / Admin assigns them here.
  assigned_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  -- `s-suseat.html`: "Sign-up is never blocked by seats — startups that complete
  -- without one are flagged seatless so the team can allocate a seat … from the
  -- pipeline."
  seatless         INTEGER NOT NULL DEFAULT 0 CHECK (seatless IN (0, 1)),
  seat_allocated_at TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at     TEXT,
  CHECK (seatless = 0 OR seat_allocated_at IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_signups_status ON signups (status);

CREATE TABLE IF NOT EXISTS required_documents (
  id         TEXT PRIMARY KEY,
  edition    TEXT NOT NULL CHECK (edition IN ('incubator', 'vc')),
  -- NULL program = the edition-wide default checklist. A programme (and
  -- optionally a cohort) row overrides it.
  program_id TEXT REFERENCES programs (id) ON DELETE CASCADE,
  cohort_id  TEXT REFERENCES cohorts (id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  note       TEXT,
  -- The prototype's toggle: "Mandatory when ON".
  mandatory  INTEGER NOT NULL DEFAULT 1 CHECK (mandatory IN (0, 1)),
  active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  CHECK (cohort_id IS NULL OR program_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_required_documents ON required_documents (edition, program_id, sort_order);

CREATE TABLE IF NOT EXISTS signup_documents (
  id                   TEXT PRIMARY KEY,
  signup_id            TEXT NOT NULL REFERENCES signups (id) ON DELETE CASCADE,
  -- NULL when the team added this item ad hoc on the individual sign-up rather
  -- than inheriting it — the prototype allows exactly that.
  required_document_id TEXT REFERENCES required_documents (id) ON DELETE SET NULL,
  name                 TEXT NOT NULL,
  note                 TEXT,
  -- Spec §8.3, in order. Skipping a state is illegal; W5-A enforces it.
  status               TEXT NOT NULL DEFAULT 'not_requested'
                         CHECK (status IN ('not_requested', 'awaiting', 'submitted', 'verified')),
  file_url             TEXT,
  -- The prototype lets the team waive one item, with a reason.
  waived               INTEGER NOT NULL DEFAULT 0 CHECK (waived IN (0, 1)),
  waived_reason        TEXT,
  verified_by          TEXT REFERENCES users (id) ON DELETE SET NULL,
  verified_at          TEXT,
  sort_order           INTEGER NOT NULL DEFAULT 0,
  CHECK (waived = 0 OR waived_reason IS NOT NULL),
  CHECK (status <> 'verified' OR verified_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_signup_documents ON signup_documents (signup_id, sort_order);

-- ── Default checklists, from `s-sudocs.html` (both editions) ────────────────
-- Edition-wide defaults (program_id NULL); a programme may override later.
INSERT INTO required_documents (id, edition, program_id, cohort_id, name, note, mandatory, sort_order) VALUES
  ('rd_inc_incorporation', 'incubator', NULL, NULL, 'Certificate of incorporation', 'PDF · one file',       1, 1),
  ('rd_inc_founder_id',    'incubator', NULL, NULL, 'Founder ID proof',             'Per founder',          1, 2),
  ('rd_inc_cap_table',     'incubator', NULL, NULL, 'Cap table',                    'Current shareholding', 1, 3),
  ('rd_inc_bank',          'incubator', NULL, NULL, 'Bank account details',         'Cancelled cheque',     0, 4),
  ('rd_inc_gst',           'incubator', NULL, NULL, 'GST / tax registration',       'If applicable',        0, 5),
  ('rd_vc_incorporation',  'vc',        NULL, NULL, 'Certificate of incorporation', 'PDF · one file',       1, 1),
  ('rd_vc_founder_id',     'vc',        NULL, NULL, 'Founder ID proof',             'Per founder',          1, 2),
  ('rd_vc_cap_table',      'vc',        NULL, NULL, 'Cap table',                    'Current shareholding', 1, 3),
  ('rd_vc_financials',     'vc',        NULL, NULL, 'Audited financials',           'Last 2 years',         0, 4),
  ('rd_vc_bank',           'vc',        NULL, NULL, 'Bank account details',         'Cancelled cheque',     0, 5),
  ('rd_vc_gst',            'vc',        NULL, NULL, 'GST / tax registration',       'If applicable',        0, 6)
ON CONFLICT (id) DO NOTHING;

-- ── Back-fill a sign-up row for every deck already in the sign-up funnel ────
-- 0022 created `deck_onboarding` for the same decks; this is the workspace that
-- sits behind it, so the two agree from the first render.
INSERT INTO signups (id, deck_id, status, created_at)
SELECT 'su_' || d.id, d.id,
       CASE WHEN d.status = 'onboard_ready' THEN 'progress' ELSE 'initiated' END,
       d.created_at
FROM decks d
WHERE d.status IN ('signup', 'onboard_ready')
  AND NOT EXISTS (SELECT 1 FROM signups s WHERE s.deck_id = d.id);

-- Each of those sign-ups inherits its edition's default checklist.
INSERT INTO signup_documents (id, signup_id, required_document_id, name, note, status, sort_order)
SELECT 'sd_' || s.id || '_' || rd.id, s.id, rd.id, rd.name, rd.note,
       CASE WHEN rd.mandatory = 1 THEN 'awaiting' ELSE 'not_requested' END,
       rd.sort_order
FROM signups s
JOIN decks d ON d.id = s.deck_id
JOIN required_documents rd ON rd.edition = d.edition AND rd.program_id IS NULL AND rd.active = 1
WHERE NOT EXISTS (
  SELECT 1 FROM signup_documents sd WHERE sd.signup_id = s.id AND sd.required_document_id = rd.id
);
