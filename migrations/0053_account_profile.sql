-- W6-B · migration 0053 — NOT an allotted number, declared loudly per §2.2.
--
-- Wave 6's allotment was 0050 (`Wx-PWD`), 0051 (`W6-A`) and 0052 (`W6-C`);
-- `W6-B`'s prompt allotted nothing because it was written (by `W4-D`) before
-- anyone knew the account overlay needed a table. It does: the prototype's
-- eleven-field organisation form (`#acs-orgdetails`) has no column anywhere in
-- the schema (F1028, F1033). 0053 is the first number above every one in flight.
--
-- My account → the purchase wizard (`_rest.html` `#acct-overlay`).
--
--   `account_profiles`   what the Account, Org type and Org details screens
--                        capture. Keyed by `edition`, exactly as `org_settings`
--                        and `billing_subscriptions` are: the product is
--                        single-tenant by a recorded decision, so there is one
--                        commercial account per workspace. `org_kind` is a
--                        recorded FACT about the customer, not a switch — the
--                        edition already is the workspace type (§8 Q41).
--   `account_orders`     the wizard's own record of a purchase it placed: which
--                        branch placed it and which payment method the customer
--                        PREFERRED. The money lives on the payment intent `W4-C`
--                        already records (`billing_payment_intents`); this row
--                        only points at it.
--
-- §1.2 is structural here as it is in 0046: there is no PAN, CVV, expiry, UPI ID,
-- bank account or instrument column in either table. `payment_method` is a
-- CATEGORY the provider's hosted page opens on ("upi"), never an instrument.

CREATE TABLE IF NOT EXISTS account_profiles (
  edition              TEXT PRIMARY KEY CHECK (edition IN ('incubator', 'vc')),
  account_type         TEXT NOT NULL DEFAULT 'individual'
                       CHECK (account_type IN ('individual', 'organization')),
  -- Account screen.
  work_email           TEXT NOT NULL,
  first_name           TEXT NOT NULL,
  last_name            TEXT NOT NULL,
  phone_dial           TEXT,
  phone                TEXT,
  designation          TEXT,
  organization_name    TEXT,
  -- Org type screen (Organization only).
  org_kind             TEXT CHECK (org_kind IS NULL OR org_kind IN ('incubator', 'investor')),
  -- Org details screen (Organization only) — the prototype's eleven fields.
  org_name             TEXT,
  business_type        TEXT,
  employees            TEXT,
  associates           INTEGER CHECK (associates IS NULL OR associates >= 0),
  city                 TEXT,
  country              TEXT,
  contact_name         TEXT,
  contact_designation  TEXT,
  contact_dial         TEXT,
  contact_phone        TEXT,
  contact_email        TEXT,
  updated_by           TEXT REFERENCES users (id) ON DELETE SET NULL,
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  -- An organisation account must carry the organisation it is for.
  CHECK (account_type = 'individual' OR (org_kind IS NOT NULL AND org_name IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS account_orders (
  intent_id       TEXT PRIMARY KEY REFERENCES billing_payment_intents (id) ON DELETE CASCADE,
  edition         TEXT NOT NULL CHECK (edition IN ('incubator', 'vc')),
  account_type    TEXT NOT NULL CHECK (account_type IN ('individual', 'organization')),
  plan_group      TEXT NOT NULL CHECK (plan_group IN ('subscription', 'credit_pack', 'enterprise')),
  period          TEXT CHECK (period IS NULL OR period IN ('month', 'year', 'one_time')),
  payment_method  TEXT NOT NULL CHECK (payment_method IN ('upi', 'card', 'netbanking', 'wallet')),
  -- Whether GST applied, as `priceBreakdown` decided at the moment of the order.
  -- Stored rather than re-derived so a receipt can never disagree with the
  -- intent it documents if the rule is ever revisited.
  taxed           INTEGER NOT NULL CHECK (taxed IN (0, 1)),
  -- The published catalogue version the price was read from.
  price_version   INTEGER,
  created_by      TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_account_orders_recent ON account_orders (edition, created_at DESC);
