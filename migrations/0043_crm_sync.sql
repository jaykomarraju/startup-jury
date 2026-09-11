-- W3-D · migration 0043 (this session's ONE allotted number, plan §2.2).
--
-- Admin console → Organisation → **CRM sync** (`admin/s-crm.html`). `0037`
-- created `crm_connections` with the prototype's filter-rule fields; this
-- migration adds the three things the section needs on top of them and that
-- `0037` did not anticipate:
--
--   1. **Sync direction and schedule** — the section configures *which way*
--      records move and *how often*, neither of which `0037` has a column for.
--   2. **Field mapping** — `crm_field_mappings`, one row per CRM field ↔ app
--      field pair. `0037`'s `trigger_field` / `score_writeback_field` are the
--      two singleton fields the prototype draws; a real pull needs the founder
--      / email / phone / city / sector columns mapped too.
--   3. **Sync telemetry** — `crm_sync_log`, the CRM counterpart of
--      `email_outbox`: every attempt is recorded with the payload it WOULD have
--      sent, and `status='recorded'` while no provider is configured (§1.3).
--
-- **Credentials are never stored here.** `0037` already says so and this
-- migration keeps the promise: the added columns hold a *reference* to the
-- Worker secret a live deployment would read (`credential_ref`), a masked tail
-- for the operator to recognise it by (`credential_hint`, e.g. `••••4f2a`) and
-- when it was set. The secret itself is a `wrangler secret`, so no GET on
-- /api/crm can return one and no D1 dump can leak one.
--
-- Plain ADD COLUMNs with no CHECK, matching `0036`/`0021`: SQLite's ALTER TABLE
-- is narrow, and the enums are validated in `src/server/routes/crm.ts`.

ALTER TABLE crm_connections ADD COLUMN sync_direction    TEXT NOT NULL DEFAULT 'pull';
ALTER TABLE crm_connections ADD COLUMN sync_schedule     TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE crm_connections ADD COLUMN credential_ref    TEXT;
ALTER TABLE crm_connections ADD COLUMN credential_hint   TEXT;
ALTER TABLE crm_connections ADD COLUMN credential_set_at TEXT;
ALTER TABLE crm_connections ADD COLUMN connected_at      TEXT;

-- One CRM field ↔ one app field. `direction` says which way THIS pair moves:
-- 'inbound'  — read the CRM field into the app field when a deal is pulled.
-- 'outbound' — write the app value back into the CRM field after evaluation.
-- `app_field` is validated against APP_FIELDS in src/server/crm/mapping.ts; it
-- is deliberately not a CHECK, so adding a mappable field is a code change and
-- not a migration.
CREATE TABLE IF NOT EXISTS crm_field_mappings (
  id            TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES crm_connections (id) ON DELETE CASCADE,
  crm_field     TEXT NOT NULL,
  app_field     TEXT NOT NULL,
  direction     TEXT NOT NULL DEFAULT 'inbound',
  sort_order    INTEGER NOT NULL DEFAULT 0,
  UNIQUE (connection_id, app_field, direction)
);

CREATE INDEX IF NOT EXISTS idx_crm_field_mappings_conn ON crm_field_mappings (connection_id, sort_order);

-- The recording store. Mirrors `email_outbox`: `status='recorded'` means the
-- attempt was audited and nothing left the Worker, which is the only status
-- this build can produce. 'sent' / 'failed' exist so wiring a real provider
-- later is configuration, not a schema change.
CREATE TABLE IF NOT EXISTS crm_sync_log (
  id            TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES crm_connections (id) ON DELETE CASCADE,
  edition       TEXT NOT NULL,
  provider      TEXT NOT NULL,
  direction     TEXT NOT NULL,
  operation     TEXT NOT NULL,
  status        TEXT NOT NULL,
  deck_id       TEXT,
  record_count  INTEGER NOT NULL DEFAULT 0,
  -- What the provider call WOULD have carried. Never a credential: the payload
  -- is built from deck/deal fields only (src/server/crm/provider.ts).
  payload_json  TEXT,
  error         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_crm_sync_log_conn ON crm_sync_log (connection_id, created_at DESC);

-- The two live Salesforce rows `0037` seeded say "3 deals pulled" on 4 Jun; give
-- them the mappings and the log row that claim implies, so the section renders
-- the prototype's populated state rather than a connected-but-empty one.
INSERT INTO crm_field_mappings (id, connection_id, crm_field, app_field, direction, sort_order) VALUES
  ('crmmap_inc_sf_1', 'crm_inc_salesforce', 'Account.Name',        'companyName',  'inbound', 1),
  ('crmmap_inc_sf_2', 'crm_inc_salesforce', 'Contact.Name',        'founder',      'inbound', 2),
  ('crmmap_inc_sf_3', 'crm_inc_salesforce', 'Contact.Email',       'founderEmail', 'inbound', 3),
  ('crmmap_inc_sf_4', 'crm_inc_salesforce', 'Contact.Phone',       'founderPhone', 'inbound', 4),
  ('crmmap_inc_sf_5', 'crm_inc_salesforce', 'Account.BillingCity', 'city',         'inbound', 5),
  ('crmmap_inc_sf_6', 'crm_inc_salesforce', 'Account.Industry',    'sector',       'inbound', 6),
  ('crmmap_inc_sf_7', 'crm_inc_salesforce', 'AI_Score__c',         'aiScore',      'outbound', 7),
  ('crmmap_vc_sf_1',  'crm_vc_salesforce',  'Account.Name',        'companyName',  'inbound', 1),
  ('crmmap_vc_sf_2',  'crm_vc_salesforce',  'Contact.Name',        'founder',      'inbound', 2),
  ('crmmap_vc_sf_3',  'crm_vc_salesforce',  'Contact.Email',       'founderEmail', 'inbound', 3),
  ('crmmap_vc_sf_4',  'crm_vc_salesforce',  'Contact.Phone',       'founderPhone', 'inbound', 4),
  ('crmmap_vc_sf_5',  'crm_vc_salesforce',  'Account.BillingCity', 'city',         'inbound', 5),
  ('crmmap_vc_sf_6',  'crm_vc_salesforce',  'Account.Industry',    'sector',       'inbound', 6),
  ('crmmap_vc_sf_7',  'crm_vc_salesforce',  'AI_Score__c',         'aiScore',      'outbound', 7)
ON CONFLICT (id) DO NOTHING;

UPDATE crm_connections
   SET sync_direction = 'both',
       sync_schedule  = 'hourly',
       connected_at   = '2026-05-02 09:15:00',
       credential_ref = 'CRM_SALESFORCE_TOKEN',
       credential_hint = '••••4f2a',
       credential_set_at = '2026-05-02 09:15:00'
 WHERE id IN ('crm_inc_salesforce', 'crm_vc_salesforce');

INSERT INTO crm_sync_log
  (id, connection_id, edition, provider, direction, operation, status, record_count, payload_json, created_at) VALUES
  ('crmlog_inc_seed', 'crm_inc_salesforce', 'incubator', 'salesforce', 'pull', 'pull_deals', 'recorded', 3,
   '{"note":"Recorded only — no provider configured.","query":{"triggerField":"Stage","triggerValue":"Submitted for evaluation"},"matched":3}',
   '2026-06-04 11:42:00'),
  ('crmlog_vc_seed',  'crm_vc_salesforce',  'vc',        'salesforce', 'pull', 'pull_deals', 'recorded', 3,
   '{"note":"Recorded only — no provider configured.","query":{"triggerField":"Stage","triggerValue":"Submitted for evaluation"},"matched":3}',
   '2026-06-04 11:42:00')
ON CONFLICT (id) DO NOTHING;
