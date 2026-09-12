-- W4-C · migration 0046 (Wave 4 allotment 0044–0047; this session owns 0046 and
-- only 0046).
--
-- Admin console → Organisation → **Credits & billing** (`admin/s-bl.html`).
--
-- `0032` created `credit_ledger` and W3-C started writing it, so the balance
-- now has a history. Three things the section needs still have nowhere to live:
--
--   `billing_subscriptions`   what the "Current plan" tile prints, and the
--                             billing cycle behind "Used this month" — plan,
--                             seat count, period, cycle anchor, billing contact.
--                             Keyed by `edition`, exactly as `org_settings` is:
--                             the product is single-tenant by a recorded
--                             decision (`HANDOFF.md:621`), and introducing an
--                             organisations table is F0088's much larger job.
--   `billing_payment_intents` what a purchase RECORDS. §1.2 and §1.3: card data
--                             never reaches this application, so there is no
--                             PAN, no CVV, no expiry and no instrument column
--                             here or anywhere else — only the intent (what was
--                             being bought, for how much, with how much tax) and
--                             a provider-hosted URL when a provider exists.
--                             `status='recorded'` is the `crm_sync_log` contract:
--                             audited, never claimed as charged.
--   `billing_invoices`        the document behind "Download invoice". Issued from
--                             a purchase and never recomputed, because it
--                             SNAPSHOTS the tax rate and registration that
--                             applied when it was issued — a later rate change
--                             must not rewrite a document a customer has filed.
--
-- Money is integer minor units throughout, and every table CHECKs that its own
-- arithmetic adds up. `src/shared/plans.ts` holds the sums.

CREATE TABLE IF NOT EXISTS billing_subscriptions (
  edition        TEXT PRIMARY KEY CHECK (edition IN ('incubator', 'vc')),
  -- `price_plans.code` when the plan is a catalogue one; NULL for a negotiated
  -- plan, whose name is then `plan_label`.
  plan_code      TEXT,
  plan_label     TEXT NOT NULL,
  -- The tile's sub-line prefix: "Enterprise · 5 seats".
  tier_label     TEXT,
  seats          INTEGER NOT NULL DEFAULT 0 CHECK (seats >= 0),
  billing_period TEXT NOT NULL DEFAULT 'year' CHECK (billing_period IN ('month', 'year')),
  -- YYYY-MM-DD. The cycle containing today is derived from it, never stored.
  cycle_anchor   TEXT NOT NULL,
  currency       TEXT NOT NULL DEFAULT 'INR',
  status         TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'trialing', 'past_due', 'cancelled')),
  billing_email  TEXT,
  -- The CUSTOMER's GSTIN (ours is `pricing_settings.gst_registration`).
  gstin          TEXT,
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS billing_payment_intents (
  id             TEXT PRIMARY KEY,
  edition        TEXT NOT NULL CHECK (edition IN ('incubator', 'vc')),
  purpose        TEXT NOT NULL CHECK (purpose IN ('credit_pack', 'subscription', 'enterprise', 'seat')),
  plan_code      TEXT,
  plan_name      TEXT NOT NULL,
  -- Credits the purchase would grant, per unit of `quantity`.
  units          INTEGER,
  quantity       INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  currency       TEXT NOT NULL,
  subtotal_minor INTEGER NOT NULL CHECK (subtotal_minor >= 0),
  tax_minor      INTEGER NOT NULL CHECK (tax_minor >= 0),
  total_minor    INTEGER NOT NULL CHECK (total_minor >= 0),
  gst_rate_pct   REAL NOT NULL CHECK (gst_rate_pct BETWEEN 0 AND 100),
  gst_inclusive  INTEGER NOT NULL DEFAULT 0 CHECK (gst_inclusive IN (0, 1)),
  provider       TEXT NOT NULL DEFAULT 'none',
  -- 'recorded' = the intent exists and NOTHING has been charged. Nothing in this
  -- build can write 'completed': no adapter is registered (§1.3).
  status         TEXT NOT NULL DEFAULT 'recorded'
                 CHECK (status IN ('recorded', 'redirected', 'completed', 'failed', 'cancelled')),
  -- A provider-hosted page (redirect or iframe src). Never a card field.
  checkout_url   TEXT,
  provider_ref   TEXT,
  error          TEXT,
  actor_id       TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (subtotal_minor + tax_minor = total_minor)
);
CREATE INDEX IF NOT EXISTS idx_billing_intents_recent
  ON billing_payment_intents (edition, created_at DESC);

CREATE TABLE IF NOT EXISTS billing_invoices (
  id               TEXT PRIMARY KEY,
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
  UNIQUE (edition, number),
  UNIQUE (ledger_id),
  CHECK (subtotal_minor + tax_minor = total_minor)
);

-- ── §8 Q1, ruled 2026-09-11: no per-deck pricing ────────────────────────────
-- `0032` seeded each `deck_evaluated` debit with a ₹999 per-deck rate, and
-- `s-bl.html` renders it ("1 credit · ₹999 · 4 Jun 2026") along with a tile
-- derived from it ("₹2,997 consumed"). The ruling retires the rate itself, so
-- the figure is cleared from the DATA and not merely hidden by a screen — a
-- ledger column no one may render is a per-deck rate waiting to be resurrected
-- by the next reader. An evaluation is one credit; that is the whole record of
-- it. Purchases keep their money: a pack really did cost ₹20,000.
UPDATE credit_ledger SET amount_minor = NULL, currency = NULL WHERE reason = 'deck_evaluated';

-- ── The seeded workspaces' plans ────────────────────────────────────────────
-- `s-bl.html`'s tile: "Current plan · Configurable · Enterprise · 5 seats". The
-- name is the prototype's own AET_PLANS vocabulary; it is a display label
-- because no catalogue row carries it — settling the enterprise vocabulary is
-- W4-D's call (§8 Q1/Q40), and this row points at a `plan_code` the moment one
-- exists. Anchored 1 Jan so the cycle is the calendar year the seeded history
-- sits in.
INSERT INTO billing_subscriptions
  (edition, plan_code, plan_label, tier_label, seats, billing_period, cycle_anchor, currency, status, billing_email, gstin)
VALUES
  ('incubator', NULL, 'Configurable', 'Enterprise', 5, 'year', '2026-01-01', 'INR', 'active',
   'nisha.kapoor@demo.startupjury.ai', '29ABCDE1234F1Z5'),
  ('vc',        NULL, 'Configurable', 'Enterprise', 5, 'year', '2026-01-01', 'INR', 'active',
   'rohan.mehta@demo.startupjury.ai',  '29ABCDE1234F1Z5')
ON CONFLICT (edition) DO NOTHING;

-- ── Invoices for the purchases already in the ledger ────────────────────────
-- Both seeded purchases are ₹20,000 packs, billed GST-exclusive at the 18 % rate
-- `0033` seeded, so each invoice is ₹20,000 + ₹3,600 = ₹23,600. Runtime issuance
-- (`src/server/billing/ledger.ts`) covers every later purchase; these two are
-- seeded so the numbering starts where the history does.
INSERT INTO billing_invoices
  (id, edition, number, kind, ledger_id, intent_id, description, units, currency,
   subtotal_minor, tax_minor, total_minor, gst_rate_pct, gst_registration, place_of_supply, reference, issued_at)
VALUES
  ('inv_cl_inc_0002', 'incubator', 'INV-2026-0001', 'invoice', 'cl_inc_0002', NULL,
   '50-unit pack', 50, 'INR', 2000000, 360000, 2360000, 18, '29ABCDE1234F1Z5', 'Karnataka',
   'RZP250603112244', '2026-06-03 16:20:00'),
  ('inv_cl_vc_0002',  'vc',        'INV-2026-0001', 'invoice', 'cl_vc_0002',  NULL,
   '50-unit pack', 50, 'INR', 2000000, 360000, 2360000, 18, '29ABCDE1234F1Z5', 'Karnataka',
   'RZP250603118871', '2026-06-03 16:40:00')
ON CONFLICT (id) DO NOTHING;
