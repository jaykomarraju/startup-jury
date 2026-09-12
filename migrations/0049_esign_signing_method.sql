-- W5-B · migration 0049 (Wave 5 allotment 0048–0049; W5-A holds 0048).
--
-- **Read this before assuming anything is missing.** W1-B already built almost
-- all of this session's schema: `migrations/0034_signups_and_documents.sql`
-- carries `signups` WITH the signing-method columns (`signing_provider`,
-- `sig_type`, `in_app`, `wet_ink`) and `authorised_signatory_user_id`, and
-- `0035_agreements_and_signatures.sql` carries `agreement_templates`, its
-- fields / programme map / flow steps, `agreements`, `signatures` and
-- `authorised_signatories`, seeded from `SU_TPL` and `s-susign.html`. The
-- findings F0007 / F0008 / F0025 / F0032 / F0035 all say "REPO NONE" because the
-- audit predates Wave 1. This migration adds only the four things Wave 1 did not
-- leave behind:
--
--   1. `signups.authorised_signatory_role` — the prototype's assign picker
--      offers "By role" AND "Named individuals" (`_scripts.js:2291-2292`), so an
--      assignment is a role OR a person. 0034 modelled only the person.
--   2. `signups.founder_signed_at` — the lock. The prototype's `d.founderSigned`
--      is the one field with an explicit immutability rule in both specs §8.3,
--      and nothing in the repo recorded it. `agreements.method_locked` is
--      per-agreement; the METHOD is per sign-up record, so the timestamp lives
--      where the method lives.
--   3. `agreement_templates.updated_at` — the library lists a version and a
--      lifecycle; without this a "New version" leaves no trace of when.
--   4. `esign_outbox` — §1.3. The provider call is interface-complete and
--      stubbed, and the stub **records instead of sending**, exactly as
--      `email_outbox` does for mail and `crm_sync_log` does for CRM. Nothing
--      here holds a credential: the columns are the app's own data plus the
--      reference a live provider would hand back.
--
-- ALTER TABLE ADD COLUMN is not re-runnable, which is fine — D1's migration
-- ledger applies each file exactly once. `test/worker/migrations-w1b.test.ts`
-- asserts idempotence over the W1-B block (0025–0037) only, for that reason.

ALTER TABLE signups ADD COLUMN authorised_signatory_role TEXT;
ALTER TABLE signups ADD COLUMN founder_signed_at TEXT;
ALTER TABLE agreement_templates ADD COLUMN updated_at TEXT;

-- One row per e-signature call the application made, or would have made.
--
-- `status` follows `email_outbox`'s vocabulary verbatim, and for the same
-- reason: 'recorded' is NOT 'sent'. No provider adapter is registered (see
-- src/server/esign/provider.ts), so every row on the shipped build is
-- 'recorded' — audited, never claimed as delivered.
CREATE TABLE IF NOT EXISTS esign_outbox (
  id           TEXT PRIMARY KEY,
  -- Both nullable: an attempt may precede the `agreements` row (a method
  -- preview) and a voided envelope may outlive its sign-up.
  signup_id    TEXT REFERENCES signups (id) ON DELETE SET NULL,
  agreement_id TEXT REFERENCES agreements (id) ON DELETE SET NULL,
  -- What the call was for. `envelope_create` sends a document out for
  -- signature; `founder_signature` and `countersign` record one act; `void`
  -- withdraws an envelope.
  kind         TEXT NOT NULL
                 CHECK (kind IN ('envelope_create', 'founder_signature', 'countersign', 'void')),
  provider     TEXT NOT NULL
                 CHECK (provider IN ('SignDesk', 'DocuSign', 'Adobe', 'Zoho', 'eMudhra')),
  sig_type     TEXT NOT NULL CHECK (sig_type IN ('standard', 'certificate')),
  -- JSON array of the signer emails the envelope would carry. The app's own
  -- data; no credential ever reaches this table.
  recipients_json TEXT NOT NULL DEFAULT '[]',
  document_name   TEXT,
  status       TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'recorded')),
  -- The stub's recorded reference, or a real envelope id once a provider is
  -- configured. Mirrors `signatures.provider_reference`.
  provider_reference TEXT,
  error        TEXT,
  -- Makes an attempt idempotent: a queue retry or a double-clicked button must
  -- not raise a second envelope. Same mechanic as `email_outbox.dedupe_key`.
  dedupe_key   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_esign_outbox_signup ON esign_outbox (signup_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_esign_outbox_dedupe
  ON esign_outbox (dedupe_key) WHERE dedupe_key IS NOT NULL;

-- The seeded sign-ups carry no chosen method (0034 inserted none), which is
-- correct — a method is chosen per record. Give the one record that is still
-- `initiated` nothing, and the records already in `progress` the platform
-- default, so a screen opened on them shows a locked card with real values
-- rather than an empty one. `progress` means the founder has already acted
-- (0034's own status comment), so their method is locked by definition and this
-- is the only chance to write it.
UPDATE signups
   SET signing_provider = COALESCE(signing_provider, 'SignDesk'),
       sig_type         = COALESCE(sig_type, 'standard'),
       in_app           = 1,
       wet_ink          = 1,
       founder_signed_at = COALESCE(founder_signed_at, created_at)
 WHERE status IN ('progress', 'completed', 'onboarded');

-- `updated_at` starts at the row's creation time so the library can sort and
-- print it without a NULL branch on the eight seeded templates.
UPDATE agreement_templates SET updated_at = created_at WHERE updated_at IS NULL;
