-- W1-B · migration 9 of 13 (0025 – 0037).
--
-- Admin console → Organisation → **Price configuration**. That section is a
-- 235-byte iframe; the real ~37 KB document is base64 in the admin script as
-- `PC_B64` and is byte-identical in both Super User builds. It is a
-- PLATFORM-OWNER surface ("Super admin · Platform owner"), so none of these
-- tables carry an edition — one catalogue serves the whole product.
--
-- Five tables:
--   `currencies`       the seven the page activates; INR is base.
--   `fx_rates`         1 INR = rate units of the currency. The page shows four.
--   `price_plans`      the four catalogues: free trial · monthly subscription ·
--                      pay-as-you-go credit packs · annual enterprise tiers.
--   `price_amounts`    one row per plan × currency, in MINOR units so no float
--                      ever touches money. `overridden` marks a figure an admin
--                      typed over the FX-derived one.
--   `pricing_settings` the singleton: GST, the free-trial grant, publish state.
--
-- §1.2 — there is deliberately NO card, CVV, or payment-instrument column in
-- this or any other table. Purchase runs through a provider-hosted surface and
-- only its reference reaches us (`credit_ledger.reference`).
--
-- W4-D — the prototype contradicts itself on pricing (three per-deck base
-- rates, two pay-as-you-go catalogues, four enterprise vocabularies). What is
-- seeded here is the **price-configuration document's own master table**, which
-- that page calls authoritative: "All prices below are the master configuration
-- — changes here update the public pricing page and all in-app plan displays."
-- Settling the contradiction is W4-D's call with the user; see plan §8.

CREATE TABLE IF NOT EXISTS currencies (
  code       TEXT PRIMARY KEY,
  symbol     TEXT NOT NULL,
  flag       TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS fx_rates (
  currency      TEXT PRIMARY KEY REFERENCES currencies (code) ON DELETE CASCADE,
  base_currency TEXT NOT NULL DEFAULT 'INR' REFERENCES currencies (code),
  -- 1 base unit = `rate` units of `currency`.
  rate          REAL NOT NULL CHECK (rate > 0),
  source        TEXT NOT NULL DEFAULT 'live' CHECK (source IN ('live', 'manual')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS price_plans (
  id         TEXT PRIMARY KEY,
  plan_group TEXT NOT NULL CHECK (plan_group IN ('free_trial', 'subscription', 'credit_pack', 'enterprise')),
  code       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  badge      TEXT,
  tagline    TEXT,
  features   TEXT,
  -- Decks included. NULL for a subscription, which is metered by its own rules.
  units      INTEGER,
  period     TEXT CHECK (period IS NULL OR period IN ('month', 'year', 'one_time')),
  saving_pct INTEGER,
  active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS price_amounts (
  id             TEXT PRIMARY KEY,
  plan_id        TEXT NOT NULL REFERENCES price_plans (id) ON DELETE CASCADE,
  currency       TEXT NOT NULL REFERENCES currencies (code),
  -- Paise / cents. Integers only.
  amount_minor   INTEGER NOT NULL CHECK (amount_minor >= 0),
  overridden     INTEGER NOT NULL DEFAULT 0 CHECK (overridden IN (0, 1)),
  per_unit_label TEXT,
  UNIQUE (plan_id, currency)
);

-- Singleton: `id` is pinned to 1 so a second row cannot exist.
CREATE TABLE IF NOT EXISTS pricing_settings (
  id                            INTEGER PRIMARY KEY CHECK (id = 1),
  gst_rate_pct                  REAL NOT NULL DEFAULT 18 CHECK (gst_rate_pct BETWEEN 0 AND 100),
  gst_registration              TEXT,
  prices_include_gst            INTEGER NOT NULL DEFAULT 0 CHECK (prices_include_gst IN (0, 1)),
  show_international_tax_notice INTEGER NOT NULL DEFAULT 1 CHECK (show_international_tax_notice IN (0, 1)),
  free_trial_decks              INTEGER NOT NULL DEFAULT 3 CHECK (free_trial_decks >= 0),
  -- 0 = free-trial credits never expire.
  free_trial_expiry_days        INTEGER NOT NULL DEFAULT 0 CHECK (free_trial_expiry_days >= 0),
  show_free_trial               INTEGER NOT NULL DEFAULT 1 CHECK (show_free_trial IN (0, 1)),
  published_at                  TEXT,
  updated_at                    TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO currencies (code, symbol, flag, active, sort_order) VALUES
  ('INR', '₹', '🇮🇳', 1, 1),
  ('USD', '$', '🇺🇸', 1, 2),
  ('GBP', '£', '🇬🇧', 1, 3),
  ('EUR', '€', '🇪🇺', 1, 4),
  ('AED', 'د.إ', '🇦🇪', 1, 5),
  ('SGD', 'S$', '🇸🇬', 1, 6),
  ('AUD', 'A$', '🇦🇺', 1, 7)
ON CONFLICT (code) DO NOTHING;

-- The page publishes live rates for four of the seven; AED, SGD and AUD are
-- activated but unrated, so they carry no row until someone sets one.
INSERT INTO fx_rates (currency, base_currency, rate, source) VALUES
  ('INR', 'INR', 1.0, 'manual'),
  ('USD', 'INR', 0.01199, 'live'),
  ('GBP', 'INR', 0.00944, 'live'),
  ('EUR', 'INR', 0.01102, 'live')
ON CONFLICT (currency) DO NOTHING;

INSERT INTO price_plans (id, plan_group, code, name, badge, tagline, features, units, period, saving_pct, active, sort_order) VALUES
  ('pp_free_trial', 'free_trial', 'free_trial', 'Free trial — 3 deck evaluations', NULL, 'Always free · No card required', 'Included with every new account. Full AI evaluation across all 13 areas.', 3, NULL, NULL, 1, 1),
  ('pp_standard', 'subscription', 'standard', 'Standard', NULL, 'No configurable params', '20 decks/mo · All 13 areas · Override & remark', NULL, 'month', NULL, 1, 2),
  ('pp_pro', 'subscription', 'pro', 'Pro', NULL, '3 configurable params', 'Unlimited decks · CRM sync · Intro call prompts', NULL, 'month', NULL, 1, 3),
  ('pp_base_rate', 'credit_pack', 'base_rate', 'Base rate', NULL, 'Pay-per-use', 'No pack — single deck rate', 1, 'one_time', NULL, 1, 4),
  ('pp_pack_10', 'credit_pack', 'pack_10', '10-unit pack', NULL, 'Minimum purchase · Entry tier', NULL, 10, 'one_time', 0, 1, 5),
  ('pp_pack_50', 'credit_pack', 'pack_50', '50-unit pack', 'Most popular', NULL, 'Priority WhatsApp support · Up to 10 evaluators', 50, 'one_time', 20, 1, 6),
  ('pp_pack_100', 'credit_pack', 'pack_100', '100-unit pack', 'Best value', NULL, 'Score drift analysis · Onboarding session · Up to 25 evaluators', 100, 'one_time', 40, 1, 7),
  ('pp_ent_100', 'enterprise', 'ent_100', '100 units / year', NULL, 'Entry Enterprise · +config access', NULL, 100, 'year', NULL, 1, 8),
  ('pp_ent_200', 'enterprise', 'ent_200', '200 units / year', NULL, 'Save ₹10,000 vs base', NULL, 200, 'year', 8, 1, 9),
  ('pp_ent_300', 'enterprise', 'ent_300', '300 units / year', NULL, 'Save ₹30,000 vs base', NULL, 300, 'year', 17, 1, 10),
  ('pp_ent_400', 'enterprise', 'ent_400', '400 units / year', NULL, 'Save ₹40,000 vs base', NULL, 400, 'year', 25, 1, 11),
  ('pp_ent_500', 'enterprise', 'ent_500', '500 units / year', 'Best value', 'Save ₹50,000 vs base · ₹400/deck', NULL, 500, 'year', 33, 1, 12)
ON CONFLICT (id) DO NOTHING;

INSERT INTO price_amounts (id, plan_id, currency, amount_minor, overridden, per_unit_label) VALUES
  ('pa_free_trial_inr', 'pp_free_trial', 'INR', 0, 0, NULL),
  ('pa_free_trial_usd', 'pp_free_trial', 'USD', 0, 0, NULL),
  ('pa_free_trial_gbp', 'pp_free_trial', 'GBP', 0, 0, NULL),
  ('pa_free_trial_eur', 'pp_free_trial', 'EUR', 0, 0, NULL),
  ('pa_standard_inr', 'pp_standard', 'INR', 99900, 0, NULL),
  ('pa_standard_usd', 'pp_standard', 'USD', 1200, 0, NULL),
  ('pa_standard_gbp', 'pp_standard', 'GBP', 900, 0, NULL),
  ('pa_standard_eur', 'pp_standard', 'EUR', 1100, 0, NULL),
  ('pa_pro_inr', 'pp_pro', 'INR', 199900, 0, NULL),
  ('pa_pro_usd', 'pp_pro', 'USD', 2400, 0, NULL),
  ('pa_pro_gbp', 'pp_pro', 'GBP', 1900, 0, NULL),
  ('pa_pro_eur', 'pp_pro', 'EUR', 2200, 0, NULL),
  ('pa_base_rate_inr', 'pp_base_rate', 'INR', 50000, 0, '₹500/deck'),
  ('pa_base_rate_usd', 'pp_base_rate', 'USD', 600, 0, NULL),
  ('pa_base_rate_gbp', 'pp_base_rate', 'GBP', 500, 0, NULL),
  ('pa_base_rate_eur', 'pp_base_rate', 'EUR', 600, 0, NULL),
  ('pa_pack_10_inr', 'pp_pack_10', 'INR', 500000, 0, '₹500/deck'),
  ('pa_pack_10_usd', 'pp_pack_10', 'USD', 6000, 0, NULL),
  ('pa_pack_10_gbp', 'pp_pack_10', 'GBP', 4700, 0, NULL),
  ('pa_pack_10_eur', 'pp_pack_10', 'EUR', 5500, 0, NULL),
  ('pa_pack_50_inr', 'pp_pack_50', 'INR', 2000000, 0, '₹400/deck'),
  ('pa_pack_50_usd', 'pp_pack_50', 'USD', 24000, 0, NULL),
  ('pa_pack_50_gbp', 'pp_pack_50', 'GBP', 18900, 0, NULL),
  ('pa_pack_50_eur', 'pp_pack_50', 'EUR', 22100, 0, NULL),
  ('pa_pack_100_inr', 'pp_pack_100', 'INR', 3000000, 0, '₹300/deck'),
  ('pa_pack_100_usd', 'pp_pack_100', 'USD', 36000, 0, NULL),
  ('pa_pack_100_gbp', 'pp_pack_100', 'GBP', 28300, 0, NULL),
  ('pa_pack_100_eur', 'pp_pack_100', 'EUR', 33100, 0, NULL),
  ('pa_ent_100_inr', 'pp_ent_100', 'INR', 6000000, 0, '₹600/deck'),
  ('pa_ent_100_usd', 'pp_ent_100', 'USD', 72000, 0, NULL),
  ('pa_ent_100_gbp', 'pp_ent_100', 'GBP', 56600, 0, NULL),
  ('pa_ent_100_eur', 'pp_ent_100', 'EUR', 66100, 0, NULL),
  ('pa_ent_200_inr', 'pp_ent_200', 'INR', 11000000, 0, '₹550/deck'),
  ('pa_ent_200_usd', 'pp_ent_200', 'USD', 131900, 0, NULL),
  ('pa_ent_200_gbp', 'pp_ent_200', 'GBP', 103800, 0, NULL),
  ('pa_ent_200_eur', 'pp_ent_200', 'EUR', 121200, 0, NULL),
  ('pa_ent_300_inr', 'pp_ent_300', 'INR', 15000000, 0, '₹500/deck'),
  ('pa_ent_300_usd', 'pp_ent_300', 'USD', 179900, 0, NULL),
  ('pa_ent_300_gbp', 'pp_ent_300', 'GBP', 141600, 0, NULL),
  ('pa_ent_300_eur', 'pp_ent_300', 'EUR', 165300, 0, NULL),
  ('pa_ent_400_inr', 'pp_ent_400', 'INR', 18000000, 0, '₹450/deck'),
  ('pa_ent_400_usd', 'pp_ent_400', 'USD', 215900, 0, NULL),
  ('pa_ent_400_gbp', 'pp_ent_400', 'GBP', 169900, 0, NULL),
  ('pa_ent_400_eur', 'pp_ent_400', 'EUR', 198300, 0, NULL),
  ('pa_ent_500_inr', 'pp_ent_500', 'INR', 20000000, 0, '₹400/deck'),
  ('pa_ent_500_usd', 'pp_ent_500', 'USD', 239900, 0, NULL),
  ('pa_ent_500_gbp', 'pp_ent_500', 'GBP', 188800, 0, NULL),
  ('pa_ent_500_eur', 'pp_ent_500', 'EUR', 220400, 0, NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO pricing_settings (id, gst_rate_pct, gst_registration, prices_include_gst, show_international_tax_notice,
                              free_trial_decks, free_trial_expiry_days, show_free_trial, published_at) VALUES
  (1, 18, '29ABCDE1234F1Z5', 0, 1, 3, 0, 1, '2026-06-05 09:02:00')
ON CONFLICT (id) DO NOTHING;
