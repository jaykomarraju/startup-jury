-- 0085 — T0-SCHEMA · `tenant_id` on the configuration tables (5 of 17).
--
-- The rationale for the one-statement `NOT NULL DEFAULT 't_default'` form, and
-- the price of leaving the default on the column, are in
-- `0084_tenant_id_pipeline.sql`'s header. Read that one first.
--
-- These five are T1-CONFIG's and T1-FLOW's. The pair worth naming:
--
--   · `parameters` is the rubric. It carries THREE `edition`-keyed indexes, one
--     of them UNIQUE and PARTIAL — `idx_parameters_edition_key_active ON
--     parameters (edition, key) WHERE active = 1`. That index is why two
--     customers cannot both have a parameter keyed `team` until 0099 re-cuts it
--     as `(tenant_id, edition, key)`. It is a UNIQUE INDEX and not a table-level
--     UNIQUE, so it drops and recreates with no rebuild — which is the whole
--     reason `parameters` is in this batch and not in 0089-0098.
--   · `resubmit_tokens` keeps `token_hash TEXT NOT NULL UNIQUE` GLOBALLY unique
--     and that is correct, not an oversight: the hash of a random token must not
--     collide across the platform, and scoping it per tenant would make a
--     stolen token valid in a second workspace. It is the one table-level UNIQUE
--     on a tenant-owned table that is deliberately left tenant-blind. The other
--     four — `users (email)`, `agreement_templates (edition, code)`,
--     `billing_invoices (edition, number)`, `crm_connections (edition,
--     provider)` — are all rebuilt.

ALTER TABLE parameters         ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 't_default';
ALTER TABLE programs           ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 't_default';
ALTER TABLE required_documents ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 't_default';
ALTER TABLE sectors            ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 't_default';
ALTER TABLE resubmit_tokens    ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 't_default';
