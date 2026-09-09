-- W1-B · migration 13 of 13 (0025 – 0037) — end of the W1-B block.
--
-- Admin console → System → **CRM sync** (`admin/s-crm.html`): four providers
-- (Salesforce live, HubSpot, Pipedrive and a Custom API inactive) plus the
-- Salesforce filter-rule card — trigger field, trigger value, monthly deck cap,
-- score write-back field, and two toggles.
--
-- §1.3 — interface-complete, provider-stubbed. This table holds ONLY non-secret
-- connection settings: the instance base URL and the webhook path. API keys,
-- OAuth tokens and client secrets belong in Worker secrets, never in D1, so
-- nothing stored here can leak a credential. W3-D builds the provider interface
-- and the recording stub behind it, the same shape as
-- `src/server/email/outbox.ts`.
--
-- One row per (edition, provider) — a workspace may connect more than one, and
-- the prototype lists all four whether or not they are configured.

CREATE TABLE IF NOT EXISTS crm_connections (
  id                      TEXT PRIMARY KEY,
  edition                 TEXT NOT NULL CHECK (edition IN ('incubator', 'vc')),
  provider                TEXT NOT NULL CHECK (provider IN ('salesforce', 'hubspot', 'pipedrive', 'custom')),
  status                  TEXT NOT NULL DEFAULT 'inactive' CHECK (status IN ('live', 'inactive', 'error')),
  -- Non-secret settings only.
  base_url                TEXT,
  webhook_path            TEXT,
  -- Filter rules: pull a deal when `trigger_field` reaches `trigger_value`.
  trigger_field           TEXT,
  trigger_value           TEXT,
  monthly_deck_cap        INTEGER CHECK (monthly_deck_cap IS NULL OR monthly_deck_cap >= 0),
  score_writeback_field   TEXT,
  auto_approve_within_cap INTEGER NOT NULL DEFAULT 0 CHECK (auto_approve_within_cap IN (0, 1)),
  write_back_scores       INTEGER NOT NULL DEFAULT 0 CHECK (write_back_scores IN (0, 1)),
  last_sync_at            TEXT,
  last_sync_count         INTEGER,
  last_error              TEXT,
  updated_at              TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (edition, provider)
);

INSERT INTO crm_connections
  (id, edition, provider, status, trigger_field, trigger_value, monthly_deck_cap,
   score_writeback_field, auto_approve_within_cap, write_back_scores, last_sync_at, last_sync_count) VALUES
  ('crm_inc_salesforce', 'incubator', 'salesforce', 'live', 'Stage', 'Submitted for evaluation', 50, 'AI_Score__c', 1, 1, '2026-06-04 11:42:00', 3),
  ('crm_inc_hubspot',    'incubator', 'hubspot',    'inactive', NULL, NULL, NULL, NULL, 0, 0, NULL, NULL),
  ('crm_inc_pipedrive',  'incubator', 'pipedrive',  'inactive', NULL, NULL, NULL, NULL, 0, 0, NULL, NULL),
  ('crm_inc_custom',     'incubator', 'custom',     'inactive', NULL, NULL, NULL, NULL, 0, 0, NULL, NULL),
  ('crm_vc_salesforce',  'vc',        'salesforce', 'live', 'Stage', 'Submitted for evaluation', 50, 'AI_Score__c', 1, 1, '2026-06-04 11:42:00', 3),
  ('crm_vc_hubspot',     'vc',        'hubspot',    'inactive', NULL, NULL, NULL, NULL, 0, 0, NULL, NULL),
  ('crm_vc_pipedrive',   'vc',        'pipedrive',  'inactive', NULL, NULL, NULL, NULL, 0, 0, NULL, NULL),
  ('crm_vc_custom',      'vc',        'custom',     'inactive', NULL, NULL, NULL, NULL, 0, 0, NULL, NULL)
ON CONFLICT (id) DO NOTHING;
