-- W1-B · migration 11 of 13 (0025 – 0037).
--
-- Spec §12 `agreements` / `signatures`, spec §8.3 "Agreement — agreements
-- library … an Authorised signatory must be assigned in-workspace … a signing
-- method is chosen per record and locked once the founder signs", and the two
-- admin console sections behind them: **Agreements library**
-- (`admin/s-suagr.html`) and **Authorised signatories** (`admin/s-susign.html`).
--
--   agreement_templates          the library: source file, version, status,
--                                stage, per-edition.
--   agreement_template_fields    the merge fields marked on that file.
--   agreement_template_programs  which programmes a template is offered on.
--   agreement_flow_steps         the signing-workflow builder: who does what,
--                                in order (fill blanks → sign first →
--                                countersign).
--   agreements                   one instance of a template on one sign-up.
--   signatures                   one signer's act on one agreement.
--   authorised_signatories       who may countersign: by role, by named
--                                individual, or both.
--
-- §1.3 — e-signature is interface-complete and provider-stubbed. `signatures`
-- keeps only `method_provider` and the reference the stub records. No vendor
-- SDK, no credential, nothing that must be configured for this to compile.

CREATE TABLE IF NOT EXISTS agreement_templates (
  id         TEXT PRIMARY KEY,
  edition    TEXT NOT NULL CHECK (edition IN ('incubator', 'vc')),
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  file_name  TEXT,
  file_url   TEXT,
  version    TEXT NOT NULL DEFAULT 'v1',
  -- "Retired templates stay for audit but can't be picked for new sign-ups."
  status     TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'retired')),
  stage      TEXT NOT NULL DEFAULT 'on_signup' CHECK (stage IN ('pre_signup', 'on_signup', 'post_signup')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (edition, code)
);

CREATE TABLE IF NOT EXISTS agreement_template_fields (
  id          TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES agreement_templates (id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  label       TEXT NOT NULL,
  sample      TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (template_id, key)
);

CREATE TABLE IF NOT EXISTS agreement_template_programs (
  template_id TEXT NOT NULL REFERENCES agreement_templates (id) ON DELETE CASCADE,
  program_id  TEXT NOT NULL REFERENCES programs (id) ON DELETE CASCADE,
  PRIMARY KEY (template_id, program_id)
);

CREATE TABLE IF NOT EXISTS agreement_flow_steps (
  id          TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES agreement_templates (id) ON DELETE CASCADE,
  step_index  INTEGER NOT NULL,
  -- A role id, or the literal 'founder' for the startup's own signer.
  actor_role  TEXT NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('fill_blanks', 'sign_first', 'countersign')),
  UNIQUE (template_id, step_index)
);

CREATE TABLE IF NOT EXISTS agreements (
  id                TEXT PRIMARY KEY,
  signup_id         TEXT NOT NULL REFERENCES signups (id) ON DELETE CASCADE,
  -- NULL if the template was deleted after this agreement was raised.
  template_id       TEXT REFERENCES agreement_templates (id) ON DELETE SET NULL,
  -- Spec §12: kind[incubation_agreement|mentorship_mou|…]. Denormalised from
  -- the template so a retired template still reads correctly in the audit.
  kind              TEXT NOT NULL,
  template_url      TEXT,
  -- The filled merge fields for this instance.
  merge_values_json TEXT,
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'retired')),
  -- §8.3: the signing method locks once the founder signs.
  method_locked     INTEGER NOT NULL DEFAULT 0 CHECK (method_locked IN (0, 1)),
  countersigned_by  TEXT REFERENCES users (id) ON DELETE SET NULL,
  countersigned_at  TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((countersigned_by IS NULL) = (countersigned_at IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_agreements_signup ON agreements (signup_id);

CREATE TABLE IF NOT EXISTS signatures (
  id             TEXT PRIMARY KEY,
  agreement_id   TEXT NOT NULL REFERENCES agreements (id) ON DELETE CASCADE,
  -- A staff signer has a users row; a founder signer is identified by email.
  signer_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  signer_email   TEXT,
  signer_name    TEXT,
  method_provider TEXT CHECK (method_provider IS NULL OR method_provider IN ('SignDesk', 'DocuSign', 'Adobe', 'Zoho', 'eMudhra')),
  sig_type       TEXT CHECK (sig_type IS NULL OR sig_type IN ('standard', 'certificate')),
  -- §1.3: the stub's recorded reference, or a real envelope id once configured.
  provider_reference TEXT,
  signed_at      TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (signer_user_id IS NOT NULL OR signer_email IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_signatures_agreement ON signatures (agreement_id);

CREATE TABLE IF NOT EXISTS authorised_signatories (
  id      TEXT PRIMARY KEY,
  edition TEXT NOT NULL CHECK (edition IN ('incubator', 'vc')),
  -- Exactly one of role / user_id: "Grant by role, by named individual, or both."
  role    TEXT,
  user_id TEXT REFERENCES users (id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  CHECK ((role IS NULL) <> (user_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_sig_role ON authorised_signatories (edition, role) WHERE role IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_sig_user ON authorised_signatories (edition, user_id) WHERE user_id IS NOT NULL;

-- ── Templates, from `SU_TPL` in each Super User build's admin script ────────
INSERT INTO agreement_templates (id, edition, code, name, file_name, version, status, stage) VALUES
  ('at_inc_incub', 'incubator', 'incubation_agreement', 'Incubation Agreement', 'incubation-agreement-v3.docx', 'v3', 'active',  'on_signup'),
  ('at_inc_safe',  'incubator', 'safe_note',            'SAFE Note',            'safe-note-v2.pdf',            'v2', 'active',  'on_signup'),
  ('at_inc_mou',   'incubator', 'mentorship_mou',       'Mentorship MOU',       'mentorship-mou-v1.docx',      'v1', 'draft',   'on_signup'),
  ('at_inc_nda',   'incubator', 'mutual_nda',           'Mutual NDA',           'mutual-nda-v1.pdf',           'v1', 'retired', 'pre_signup'),
  ('at_vc_term',   'vc',        'term_sheet',           'Term Sheet',           'term-sheet-v3.docx',          'v3', 'active',  'on_signup'),
  ('at_vc_safe',   'vc',        'safe_note',            'SAFE Note',            'safe-note-v2.pdf',            'v2', 'active',  'on_signup'),
  ('at_vc_sha',    'vc',        'shareholders_agreement','Shareholders Agreement','sha-v1.docx',               'v1', 'draft',   'post_signup'),
  ('at_vc_cnote',  'vc',        'convertible_note',     'Convertible Note',     'convertible-note-v1.pdf',     'v1', 'retired', 'on_signup')
ON CONFLICT (id) DO NOTHING;

INSERT INTO agreement_template_fields (id, template_id, key, label, sample, sort_order) VALUES
  ('atf_inc_incub_1', 'at_inc_incub', 'startup',  'Startup legal name',  'NeuraLeaf AI Pvt Ltd',   1),
  ('atf_inc_incub_2', 'at_inc_incub', 'founder',  'Founder name',        'Ananya Menon',           2),
  ('atf_inc_incub_3', 'at_inc_incub', 'date',     'Effective date',      '03 Jul 2026',            3),
  ('atf_inc_incub_4', 'at_inc_incub', 'term',     'Program term',        '6 months',               4),
  ('atf_inc_incub_5', 'at_inc_incub', 'equity',   'Equity consideration','4%',                     5),
  ('atf_inc_safe_1',  'at_inc_safe',  'company',  'Company legal name',  'Aether Systems Pvt Ltd', 1),
  ('atf_inc_safe_2',  'at_inc_safe',  'cap',      'Valuation cap',       '₹12 Cr',                 2),
  ('atf_inc_safe_3',  'at_inc_safe',  'disc',     'Discount rate',       '20%',                    3),
  ('atf_inc_safe_4',  'at_inc_safe',  'amt',      'Investment amount',   '₹1,50,00,000',           4),
  ('atf_inc_mou_1',   'at_inc_mou',   'startup',  'Startup name',        NULL,                     1),
  ('atf_inc_mou_2',   'at_inc_mou',   'mentor',   'Mentor name',         NULL,                     2),
  ('atf_inc_nda_1',   'at_inc_nda',   'party',    'Counterparty',        NULL,                     1),
  ('atf_vc_term_1',   'at_vc_term',   'company',  'Company legal name',  'Aether Systems Pvt Ltd', 1),
  ('atf_vc_term_2',   'at_vc_term',   'amount',   'Investment amount',   '₹2 Cr',                  2),
  ('atf_vc_term_3',   'at_vc_term',   'equity',   'Equity stake',        '8%',                     3),
  ('atf_vc_term_4',   'at_vc_term',   'premoney', 'Pre-money valuation', '₹23 Cr',                 4),
  ('atf_vc_term_5',   'at_vc_term',   'board',    'Board rights',        '1 observer seat',        5),
  ('atf_vc_term_6',   'at_vc_term',   'expiry',   'Valid until',         '15 Jul 2026',            6),
  ('atf_vc_safe_1',   'at_vc_safe',   'company',  'Company legal name',  'Aether Systems Pvt Ltd', 1),
  ('atf_vc_safe_2',   'at_vc_safe',   'cap',      'Valuation cap',       '₹12 Cr',                 2),
  ('atf_vc_safe_3',   'at_vc_safe',   'disc',     'Discount rate',       '20%',                    3),
  ('atf_vc_safe_4',   'at_vc_safe',   'amt',      'Investment amount',   '₹1,50,00,000',           4),
  ('atf_vc_safe_5',   'at_vc_safe',   'date',     'Effective date',      '03 Jul 2026',            5),
  ('atf_vc_sha_1',    'at_vc_sha',    'company',  'Company legal name',  NULL,                     1),
  ('atf_vc_sha_2',    'at_vc_sha',    'date',     'Effective date',      NULL,                     2),
  ('atf_vc_sha_3',    'at_vc_sha',    'reserved', 'Reserved matters',    'Investor consent',       3),
  ('atf_vc_sha_4',    'at_vc_sha',    'tag',      'Tag-along threshold', NULL,                     4),
  ('atf_vc_cnote_1',  'at_vc_cnote',  'company',  'Company name',        NULL,                     1),
  ('atf_vc_cnote_2',  'at_vc_cnote',  'principal','Principal amount',    NULL,                     2),
  ('atf_vc_cnote_3',  'at_vc_cnote',  'interest', 'Interest rate',       NULL,                     3),
  ('atf_vc_cnote_4',  'at_vc_cnote',  'cap',      'Conversion cap',      NULL,                     4)
ON CONFLICT (id) DO NOTHING;

-- Signing workflows, from each template's `flow` array. 'Client Admin' and
-- 'Startup founder' map to `admin` and `founder`; the VC build's 'Managing
-- Partner' is this product's `superuser` (ROLE_LABELS.vc.superuser).
INSERT INTO agreement_flow_steps (id, template_id, step_index, actor_role, action) VALUES
  ('afs_inc_incub_1', 'at_inc_incub', 1, 'program_associate', 'fill_blanks'),
  ('afs_inc_incub_2', 'at_inc_incub', 2, 'founder',           'sign_first'),
  ('afs_inc_incub_3', 'at_inc_incub', 3, 'superuser',         'countersign'),
  ('afs_inc_safe_1',  'at_inc_safe',  1, 'program_manager',   'fill_blanks'),
  ('afs_inc_safe_2',  'at_inc_safe',  2, 'founder',           'sign_first'),
  ('afs_inc_safe_3',  'at_inc_safe',  3, 'superuser',         'countersign'),
  ('afs_inc_mou_1',   'at_inc_mou',   1, 'program_associate', 'fill_blanks'),
  ('afs_inc_mou_2',   'at_inc_mou',   2, 'founder',           'sign_first'),
  ('afs_inc_mou_3',   'at_inc_mou',   3, 'program_manager',   'countersign'),
  ('afs_inc_nda_1',   'at_inc_nda',   1, 'program_associate', 'fill_blanks'),
  ('afs_inc_nda_2',   'at_inc_nda',   2, 'founder',           'sign_first'),
  ('afs_inc_nda_3',   'at_inc_nda',   3, 'program_manager',   'countersign'),
  ('afs_vc_term_1',   'at_vc_term',   1, 'associate',         'fill_blanks'),
  ('afs_vc_term_2',   'at_vc_term',   2, 'founder',           'sign_first'),
  ('afs_vc_term_3',   'at_vc_term',   3, 'superuser',         'countersign'),
  ('afs_vc_safe_1',   'at_vc_safe',   1, 'analyst',           'fill_blanks'),
  ('afs_vc_safe_2',   'at_vc_safe',   2, 'founder',           'sign_first'),
  ('afs_vc_safe_3',   'at_vc_safe',   3, 'partner',           'countersign'),
  ('afs_vc_sha_1',    'at_vc_sha',    1, 'associate',         'fill_blanks'),
  ('afs_vc_sha_2',    'at_vc_sha',    2, 'founder',           'sign_first'),
  ('afs_vc_sha_3',    'at_vc_sha',    3, 'superuser',         'countersign'),
  ('afs_vc_cnote_1',  'at_vc_cnote',  1, 'analyst',           'fill_blanks'),
  ('afs_vc_cnote_2',  'at_vc_cnote',  2, 'founder',           'sign_first'),
  ('afs_vc_cnote_3',  'at_vc_cnote',  3, 'partner',           'countersign')
ON CONFLICT (id) DO NOTHING;

-- Programme mapping. The prototype's programme names are its own demo data
-- ('Accelerator · Cohort 8', 'Seed Fund II'); these link the same two active
-- templates per edition to the programmes this workspace actually seeds, so
-- the mapping is live rather than dangling. A programme that is absent simply
-- inserts no row.
INSERT INTO agreement_template_programs (template_id, program_id)
SELECT 'at_inc_incub', p.id FROM programs p WHERE p.edition = 'incubator' AND p.name = 'Fintech Accelerator'
UNION ALL
SELECT 'at_inc_safe',  p.id FROM programs p WHERE p.edition = 'incubator' AND p.name = 'SaaS Accelerator'
UNION ALL
SELECT 'at_vc_term',   p.id FROM programs p WHERE p.edition = 'vc'        AND p.name = 'Fund II'
UNION ALL
SELECT 'at_vc_safe',   p.id FROM programs p WHERE p.edition = 'vc'        AND p.name = 'Deep Tech Fund'
ON CONFLICT (template_id, program_id) DO NOTHING;

-- ── Authorised signatories, from `s-susign.html` ────────────────────────────
-- By role: incubator grants Super user + Program manager; VC grants Managing
-- Partner (superuser) + Partner. By individual: the same two people per
-- edition, with the admin listed but off.
INSERT INTO authorised_signatories (id, edition, role, user_id, enabled) VALUES
  ('as_inc_role_superuser',         'incubator', 'superuser',         NULL, 1),
  ('as_inc_role_program_manager',   'incubator', 'program_manager',   NULL, 1),
  ('as_inc_role_program_associate', 'incubator', 'program_associate', NULL, 0),
  ('as_inc_role_jury',              'incubator', 'jury',              NULL, 0),
  ('as_vc_role_superuser',          'vc',        'superuser',         NULL, 1),
  ('as_vc_role_partner',            'vc',        'partner',           NULL, 1),
  ('as_vc_role_ic_member',          'vc',        'ic_member',         NULL, 0),
  ('as_vc_role_associate',          'vc',        'associate',         NULL, 0),
  ('as_vc_role_analyst',            'vc',        'analyst',           NULL, 0),
  ('as_inc_user_superuser',         'incubator', NULL, 'inc_superuser', 1),
  ('as_inc_user_pm',                'incubator', NULL, 'inc_pm',        1),
  ('as_inc_user_admin',             'incubator', NULL, 'inc_admin',     0),
  ('as_vc_user_superuser',          'vc',        NULL, 'vc_superuser',  1),
  ('as_vc_user_partner',            'vc',        NULL, 'vc_partner',    1),
  ('as_vc_user_admin',              'vc',        NULL, 'vc_admin',      0)
ON CONFLICT (id) DO NOTHING;
