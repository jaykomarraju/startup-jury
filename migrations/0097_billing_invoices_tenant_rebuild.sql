-- 0097 — T0-SCHEMA · rebuild 10 of 11. `billing_invoices`
--        `UNIQUE (edition, number)` → `UNIQUE (tenant_id, edition, number)`.
--
-- Recipe: `0087_users_tenant_rebuild.sql`. Inbound edges: zero.
--
-- ── AN INVOICE NUMBER IS PER CUSTOMER, AND THIS IS A LEGAL DOCUMENT ─────────
-- §2 B16 lists invoices, subscriptions and payment intents as crossing on day
-- one. The sequence is the part that cannot wait for a read predicate: with
-- `UNIQUE (edition, number)`, customer B's first invoice competes for a number
-- with customer A's, so the SECOND customer to issue `INV-2026-0001` gets a
-- UNIQUE violation at the moment of purchase. That is not a leak, it is an
-- outage on the billing path, and it arrives on the day the second customer
-- buys anything.
--
-- `UNIQUE (ledger_id)` is kept exactly as it is and NOT widened. It enforces "one
-- invoice per credit movement", and `credit_ledger.id` is already globally unique,
-- so scoping it per tenant would weaken an invariant that is currently correct —
-- it would permit two invoices for one movement as long as they sat in different
-- tenants. The same reasoning keeps `resubmit_tokens.token_hash` global (0085).
--
-- The `CHECK (subtotal_minor + tax_minor = total_minor)` and the three
-- non-negativity CHECKs come across verbatim: a snapshotted tax document whose
-- arithmetic is enforced by the database is the one thing in the billing stack
-- that cannot be fixed by a later UPDATE.

-- ── THE `DEFAULT` ON `tenant_id`, UNIFORM ACROSS ALL THIRTY ──────────────────
-- The 19 `ALTER TABLE` columns carry `DEFAULT 't_default'` because SQLite offers
-- no way to add a NOT NULL column to a populated table without one. The eleven
-- rebuilt tables could have gone without, and `0087`'s header records why they do
-- not: the loud form reddened 109 tests in files owned by other T1 sessions, and a
-- foundation session that merges red is seven T1 branches cut from a red commit.
-- The write-side guard is `test/worker/tenant-scope.test.ts`, per table, extended
-- by whichever session owns each INSERT.
--
CREATE TABLE billing_invoices__pre_tenant AS SELECT * FROM billing_invoices;

PRAGMA defer_foreign_keys = ON;

DROP TABLE billing_invoices;

CREATE TABLE billing_invoices (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL DEFAULT 't_default',
  edition          TEXT NOT NULL CHECK (edition IN ('incubator', 'vc')),
  number           TEXT NOT NULL,
  kind             TEXT NOT NULL DEFAULT 'invoice' CHECK (kind IN ('invoice', 'receipt')),
  -- The purchase this documents. One invoice per movement, enforced below.
  ledger_id        TEXT REFERENCES credit_ledger (id) ON DELETE SET NULL,
  intent_id        TEXT REFERENCES billing_payment_intents (id) ON DELETE SET NULL,
  description      TEXT NOT NULL,
  units            INTEGER,
  currency         TEXT NOT NULL,
  subtotal_minor   INTEGER NOT NULL CHECK (subtotal_minor >= 0),
  tax_minor        INTEGER NOT NULL CHECK (tax_minor >= 0),
  total_minor      INTEGER NOT NULL CHECK (total_minor >= 0),
  -- Snapshotted at issue. A later rate change never rewrites this document.
  gst_rate_pct     REAL NOT NULL CHECK (gst_rate_pct BETWEEN 0 AND 100),
  gst_registration TEXT,
  place_of_supply  TEXT,
  reference        TEXT,
  issued_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, edition, number),
  -- Deliberately NOT tenant-scoped: see the header.
  UNIQUE (ledger_id),
  CHECK (subtotal_minor + tax_minor = total_minor)
);

INSERT INTO billing_invoices (
  id, tenant_id, edition, number, kind, ledger_id, intent_id, description, units,
  currency, subtotal_minor, tax_minor, total_minor, gst_rate_pct,
  gst_registration, place_of_supply, reference, issued_at
)
SELECT
  id, 't_default', edition, number, kind, ledger_id, intent_id, description, units,
  currency, subtotal_minor, tax_minor, total_minor, gst_rate_pct,
  gst_registration, place_of_supply, reference, issued_at
FROM billing_invoices__pre_tenant;

DROP TABLE billing_invoices__pre_tenant;
