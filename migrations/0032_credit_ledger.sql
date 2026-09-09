-- W1-B · migration 8 of 13 (0025 – 0037).
--
-- Spec §12: `credit_ledger ( id, org_id, delta int, reason[trial_grant|
-- deck_evaluated|purchase], deck_id nullable, created_at )`, and the admin
-- console's **Credits & billing** usage history (`admin/s-bl.html`), which
-- renders one line per evaluation with its rupee value and date.
--
-- `org_settings.credits_balance` is today the whole story: `decks/versions.ts`
-- decrements it atomically on upload and increments it back on failure, and no
-- row records that it happened. This is the append-only trail behind that
-- number — the balance stays the fast read, the ledger explains it.
--
-- `reason` widens the spec's three values with the ones the shipped metering
-- already performs: `refund` (the compensating increment) and `adjustment`
-- (an admin grant), plus `expiry` for the free-trial clock the price
-- configuration exposes.
--
-- Money is stored in MINOR units (paise) with its currency, so no float ever
-- touches a rupee figure. NULL money = a movement with no charge, e.g. a
-- trial grant or a refund.

CREATE TABLE IF NOT EXISTS credit_ledger (
  id           TEXT PRIMARY KEY,
  edition      TEXT NOT NULL CHECK (edition IN ('incubator', 'vc')),
  -- Signed: negative consumes, positive adds. Never 0.
  delta        INTEGER NOT NULL CHECK (delta <> 0),
  reason       TEXT NOT NULL CHECK (reason IN ('trial_grant', 'purchase', 'deck_evaluated', 'refund', 'adjustment', 'expiry')),
  deck_id      TEXT REFERENCES decks (id) ON DELETE SET NULL,
  amount_minor INTEGER CHECK (amount_minor IS NULL OR amount_minor >= 0),
  currency     TEXT,
  -- Provider transaction id / invoice number. §1.3: recorded, never a card.
  reference    TEXT,
  note         TEXT,
  actor_id     TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((amount_minor IS NULL) = (currency IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_recent ON credit_ledger (edition, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_deck   ON credit_ledger (deck_id);

-- ── Demo history, matching `s-bl.html` ("47 of 50 purchased", three lines) ──
-- ₹999 per deck, ₹20,000 for the 50-pack. The grant + purchase + three debits
-- net to the balance 0007 already set, so the ledger and the counter agree.
INSERT INTO credit_ledger (id, edition, delta, reason, deck_id, amount_minor, currency, reference, note, actor_id, created_at) VALUES
  ('cl_inc_0001', 'incubator',   3, 'trial_grant',    NULL,                   NULL,     NULL,  NULL,                 'Free trial — 3 deck evaluations', NULL,        '2026-05-28 09:00:00'),
  ('cl_inc_0002', 'incubator',  50, 'purchase',       NULL,                2000000,   'INR',  'RZP250603112244',    '50-unit pack',                    'inc_admin', '2026-06-03 16:20:00'),
  ('cl_inc_0003', 'incubator',  -1, 'deck_evaluated', 'inc_deck_greenroute',   99900,   'INR',  NULL,                 'GreenRoute — pitchdeck evaluation', NULL,      '2026-06-04 10:02:00'),
  ('cl_inc_0004', 'incubator',  -1, 'deck_evaluated', 'inc_deck_insureflow',   99900,   'INR',  NULL,                 'InsureFlow — pitchdeck evaluation', NULL,      '2026-06-03 10:02:00'),
  ('cl_inc_0005', 'incubator',  -1, 'deck_evaluated', 'inc_deck_finstack',     99900,   'INR',  NULL,                 'FinStack — pitchdeck evaluation',   NULL,      '2026-06-02 10:02:00'),
  ('cl_vc_0001',  'vc',          3, 'trial_grant',    NULL,                   NULL,     NULL,  NULL,                 'Free trial — 3 deck evaluations', NULL,        '2026-05-28 09:00:00'),
  ('cl_vc_0002',  'vc',         50, 'purchase',       NULL,                2000000,   'INR',  'RZP250603118871',    '50-unit pack',                    'vc_admin',  '2026-06-03 16:40:00'),
  ('cl_vc_0003',  'vc',         -1, 'deck_evaluated', 'vc_deck_wealthos',      99900,   'INR',  NULL,                 'WealthOS — pitchdeck evaluation',   NULL,      '2026-06-04 09:30:00'),
  ('cl_vc_0004',  'vc',         -1, 'deck_evaluated', 'vc_deck_creditbridge',  99900,   'INR',  NULL,                 'CreditBridge — pitchdeck evaluation', NULL,    '2026-06-03 09:30:00'),
  ('cl_vc_0005',  'vc',         -1, 'deck_evaluated', 'vc_deck_agrichain',     99900,   'INR',  NULL,                 'AgriChain — pitchdeck evaluation',  NULL,      '2026-06-02 09:30:00')
ON CONFLICT (id) DO NOTHING;
