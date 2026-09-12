-- W4-D · migration 0047 — the price catalogue's publish machinery, and the
-- §8 Q1 ruling applied to what `0033_price_configuration.sql` seeded.
--
-- `0033` (W1-B) created the five tables the Price configuration section edits:
-- `currencies`, `fx_rates`, `price_plans`, `price_amounts`, `pricing_settings`.
-- It left three things this section cannot work without.
--
-- ── 1. Draft versus published ───────────────────────────────────────────────
-- `0033` has one catalogue, mutated in place, and a single `published_at`
-- stamp. That cannot express what the prototype's topbar promises — a "Publish
-- changes" button implies edits that are NOT yet live — and it gives a reader
-- (Credits & billing, Buy credits, the public pricing page) no way to read a
-- consistent catalogue while an administrator is halfway through editing one.
--
-- So: `0033`'s tables are the DRAFT, and `pricing_versions` holds published
-- snapshots. One row is one COMPLETE catalogue, serialised as JSON, which makes
-- a half-published catalogue structurally impossible rather than merely
-- unlikely — there is no sequence of writes that leaves a reader looking at
-- half a price list, because a reader reads one row. The partial unique index
-- enforces the other half: at most one version is ever `published`.
-- A publish never deletes its predecessor, so it is reversible (`POST
-- /api/pricing/rollback` republishes the last superseded document).
--
-- ── 2. Catalogue chrome as data ─────────────────────────────────────────────
-- `price_groups` holds each catalogue's title, badge and card copy. §8 Q1's
-- ruling retired the per-deck contradiction but left two ambiguities only the
-- client can settle — which pay-as-you-go ladder is current, and which of the
-- four enterprise vocabularies to use. Putting every word a group renders in a
-- table is what makes switching either one an UPDATE rather than a rewrite.
--
-- ── 3. The §8 Q1 ruling, applied ────────────────────────────────────────────
-- RULED BY THE USER, 2026-09-11: there is no per-deck pricing. `0033` seeded
-- the prototype's per-deck artefacts faithfully — a `base_rate` plan at
-- ₹500/deck, a `per_unit_label` on every INR row, a `saving_pct` computed
-- against a per-deck base, and enterprise taglines reading "Save ₹10,000 vs
-- base". All of it is retired below. Metering is untouched: an evaluation still
-- costs one credit (§8 Q40).
--
-- `per_unit_label` and `saving_pct` are `0033`'s columns and stay in the schema
-- (dropping a column is not worth a table rebuild); they are emptied here, no
-- code reads them, and `perDeckArtefacts()` in `src/shared/priceBook.ts` makes
-- publishing a catalogue that re-introduces one a 400.

-- ── Catalogue chrome ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS price_groups (
  plan_group TEXT PRIMARY KEY
    CHECK (plan_group IN ('free_trial', 'subscription', 'credit_pack', 'enterprise')),
  title      TEXT NOT NULL,
  badge      TEXT,
  -- An icon token the client maps to a lucide icon; unknown tokens fall back.
  icon       TEXT NOT NULL DEFAULT 'coin',
  card_name  TEXT NOT NULL,
  card_sub   TEXT,
  card_tag   TEXT,
  -- `{gst}` is substituted with the configured rate, so the prototype's
  -- "GST at 18% added at checkout" cannot go stale when the rate moves.
  footnote   TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

INSERT INTO price_groups (plan_group, title, badge, icon, card_name, card_sub, card_tag, footnote, sort_order) VALUES
  ('free_trial', 'Free trial', 'Always free · No card required', 'gift',
   'Free trial — 3 deck evaluations',
   'Included with every new account. Full AI evaluation across all 13 areas.',
   '₹0 always', NULL, 1),
  ('subscription', 'Individual plans', 'Monthly subscription · Per seat', 'user',
   'Standard & Pro — monthly plans',
   'Individual subscriptions billed monthly. Upgrade or downgrade anytime.',
   NULL,
   'GST at {gst}% added at checkout for INR billing. International pricing shown exclusive of local taxes.',
   2),
  -- The prototype's card sub ends "Per-deck rate shown alongside pack price."
  -- and its footnote explains the saving column; both are §8 Q1 artefacts and
  -- are omitted rather than reproduced.
  ('credit_pack', 'Pay-as-you-go credit packs', 'One-time purchase · Credits never expire', 'stack',
   'Credit packs — buy in bulk, save more', 'Minimum 10 units.', NULL, NULL, 3),
  ('enterprise', 'Enterprise annual plans', 'Annual contract · Units reset yearly', 'building',
   'Enterprise — full configuration control',
   'Annual invoice. Role-based 3-parameter system. Dedicated account manager. Unlimited evaluators.',
   NULL,
   'Enterprise invoiced annually in INR. International billing available via wire transfer. GST invoice provided.',
   4)
ON CONFLICT (plan_group) DO NOTHING;

-- ── Published versions ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pricing_versions (
  version      INTEGER PRIMARY KEY AUTOINCREMENT,
  status       TEXT NOT NULL CHECK (status IN ('published', 'superseded')),
  -- One complete `PriceBook` (src/shared/priceBook.ts). Never a fragment.
  document     TEXT NOT NULL,
  published_at TEXT NOT NULL DEFAULT (datetime('now')),
  published_by TEXT,
  note         TEXT
);

-- At most one live version, enforced by the database rather than by care.
CREATE UNIQUE INDEX IF NOT EXISTS pricing_versions_one_published
  ON pricing_versions (status) WHERE status = 'published';

-- The prototype's ".last-saved — Saved 5 Jun 2026, 9:02 am": when the DRAFT was
-- last written, which is not when it was last published.
CREATE TABLE IF NOT EXISTS pricing_draft_meta (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT
);

INSERT INTO pricing_draft_meta (id, updated_at, updated_by) VALUES (1, '2026-06-05 09:02:00', NULL)
ON CONFLICT (id) DO NOTHING;

-- ── §8 Q1: retire the per-deck model ────────────────────────────────────────

-- The ₹500/deck "Base rate" row IS the per-deck rate. Its amounts are deleted
-- explicitly rather than left to `ON DELETE CASCADE`: whether D1 enforces
-- foreign keys is not something a migration should have to assume, and four
-- orphaned rows would be four prices belonging to a plan that does not exist.
DELETE FROM price_amounts WHERE plan_id IN (SELECT id FROM price_plans WHERE code = 'base_rate');
DELETE FROM price_plans WHERE code = 'base_rate';

-- The derived "₹X per deck" column.
UPDATE price_amounts SET per_unit_label = NULL WHERE per_unit_label IS NOT NULL;

-- The saving percentage, which the prototype computes as 1 − (pack per-deck ÷
-- base per-deck).
UPDATE price_plans SET saving_pct = NULL WHERE saving_pct IS NOT NULL;

-- "Save ₹10,000 vs base", "Save ₹50,000 vs base · ₹400/deck" — the same saving
-- in words.
UPDATE price_plans SET tagline = NULL WHERE plan_group = 'enterprise' AND tagline LIKE 'Save %';

-- ── Normalise badge · tagline · features ────────────────────────────────────
-- `0033` put the prototype's `.badge` pill in `tagline` for the two
-- subscriptions and its `.row-desc` in `tagline` for some rows and `features`
-- for others. One rule from here: `badge` is the pill beside the name,
-- `features` is the description line, `tagline` is unused by these rows.

UPDATE price_plans SET badge = 'No configurable params', tagline = NULL WHERE code = 'standard';
UPDATE price_plans SET badge = '3 configurable params', tagline = NULL WHERE code = 'pro';
UPDATE price_plans SET features = tagline, tagline = NULL
  WHERE code IN ('pack_10', 'ent_100') AND features IS NULL;
-- The free trial's card copy now lives on its group row.
UPDATE price_plans SET tagline = NULL, features = NULL WHERE code = 'free_trial';

-- ── Currencies and rates ───────────────────────────────────────────────────
-- The prototype's currency bar activates four and offers three inactive chips
-- (AED, SGD, AUD carry no rate at all); `0033` seeded all seven active, which
-- would render three unpriced columns. Activating one is now a two-part act:
-- switch the chip on AND enter its rate, which `validatePriceBook()` enforces.
UPDATE currencies SET active = 0 WHERE code IN ('AED', 'SGD', 'AUD');

-- §1.3 — no rates vendor is on the critical path, so every stored rate is one
-- an administrator entered. `0033` marked three 'live'; nothing fetched them.
-- The stamp is pinned rather than left at `datetime('now')`: `0033` dated the
-- rates at install time, which makes the seeded catalogue differ on every
-- install and the seeded published version below impossible to pin. 5 Jun 2026
-- is the prototype's own "FX rates auto-updated · 5 Jun 2026".
UPDATE fx_rates SET source = 'manual', updated_at = '2026-06-05 09:02:00';

-- Every non-INR figure the prototype prints is hand-set, not FX-derived
-- (₹999 × 0.01199 is $11.98, and the table says $12). Marking them overridden
-- is what stops the first draft save silently repricing the whole catalogue;
-- clearing the override in the UI recomputes from the rate.
UPDATE price_amounts SET overridden = 1 WHERE currency <> 'INR' AND amount_minor > 0;

-- ── The catalogue as first published ────────────────────────────────────────
-- Version 1 is the seeded draft above, frozen. It is a literal rather than a
-- query because that is what a published version IS — a snapshot that must not
-- move when the draft does. `test/worker/pricing.test.ts` pins the two
-- together: serialising the seeded draft must equal this document, so the day
-- someone edits a seed row and forgets this line, the suite says so.

INSERT INTO pricing_versions (version, status, document, published_at, published_by, note)
VALUES (1, 'published', '{"baseCurrency":"INR","currencies":[{"code":"INR","symbol":"₹","flag":"🇮🇳","active":true,"sortOrder":1},{"code":"USD","symbol":"$","flag":"🇺🇸","active":true,"sortOrder":2},{"code":"GBP","symbol":"£","flag":"🇬🇧","active":true,"sortOrder":3},{"code":"EUR","symbol":"€","flag":"🇪🇺","active":true,"sortOrder":4},{"code":"AED","symbol":"د.إ","flag":"🇦🇪","active":false,"sortOrder":5},{"code":"SGD","symbol":"S$","flag":"🇸🇬","active":false,"sortOrder":6},{"code":"AUD","symbol":"A$","flag":"🇦🇺","active":false,"sortOrder":7}],"fx":[{"currency":"EUR","rate":0.01102,"source":"manual","updatedAt":"2026-06-05 09:02:00"},{"currency":"GBP","rate":0.00944,"source":"manual","updatedAt":"2026-06-05 09:02:00"},{"currency":"INR","rate":1,"source":"manual","updatedAt":"2026-06-05 09:02:00"},{"currency":"USD","rate":0.01199,"source":"manual","updatedAt":"2026-06-05 09:02:00"}],"groups":[{"group":"free_trial","title":"Free trial","badge":"Always free · No card required","icon":"gift","cardName":"Free trial — 3 deck evaluations","cardSub":"Included with every new account. Full AI evaluation across all 13 areas.","cardTag":"₹0 always","footnote":null,"sortOrder":1},{"group":"subscription","title":"Individual plans","badge":"Monthly subscription · Per seat","icon":"user","cardName":"Standard & Pro — monthly plans","cardSub":"Individual subscriptions billed monthly. Upgrade or downgrade anytime.","cardTag":null,"footnote":"GST at {gst}% added at checkout for INR billing. International pricing shown exclusive of local taxes.","sortOrder":2},{"group":"credit_pack","title":"Pay-as-you-go credit packs","badge":"One-time purchase · Credits never expire","icon":"stack","cardName":"Credit packs — buy in bulk, save more","cardSub":"Minimum 10 units.","cardTag":null,"footnote":null,"sortOrder":3},{"group":"enterprise","title":"Enterprise annual plans","badge":"Annual contract · Units reset yearly","icon":"building","cardName":"Enterprise — full configuration control","cardSub":"Annual invoice. Role-based 3-parameter system. Dedicated account manager. Unlimited evaluators.","cardTag":null,"footnote":"Enterprise invoiced annually in INR. International billing available via wire transfer. GST invoice provided.","sortOrder":4}],"plans":[{"id":"pp_free_trial","group":"free_trial","code":"free_trial","name":"Free trial — 3 deck evaluations","badge":null,"tagline":null,"features":null,"units":3,"period":null,"active":true,"sortOrder":1,"amounts":{"EUR":0,"GBP":0,"INR":0,"USD":0},"overrides":[]},{"id":"pp_standard","group":"subscription","code":"standard","name":"Standard","badge":"No configurable params","tagline":null,"features":"20 decks/mo · All 13 areas · Override & remark","units":null,"period":"month","active":true,"sortOrder":2,"amounts":{"EUR":1100,"GBP":900,"INR":99900,"USD":1200},"overrides":["EUR","GBP","USD"]},{"id":"pp_pro","group":"subscription","code":"pro","name":"Pro","badge":"3 configurable params","tagline":null,"features":"Unlimited decks · CRM sync · Intro call prompts","units":null,"period":"month","active":true,"sortOrder":3,"amounts":{"EUR":2200,"GBP":1900,"INR":199900,"USD":2400},"overrides":["EUR","GBP","USD"]},{"id":"pp_pack_10","group":"credit_pack","code":"pack_10","name":"10-unit pack","badge":null,"tagline":null,"features":"Minimum purchase · Entry tier","units":10,"period":"one_time","active":true,"sortOrder":5,"amounts":{"EUR":5500,"GBP":4700,"INR":500000,"USD":6000},"overrides":["EUR","GBP","USD"]},{"id":"pp_pack_50","group":"credit_pack","code":"pack_50","name":"50-unit pack","badge":"Most popular","tagline":null,"features":"Priority WhatsApp support · Up to 10 evaluators","units":50,"period":"one_time","active":true,"sortOrder":6,"amounts":{"EUR":22100,"GBP":18900,"INR":2000000,"USD":24000},"overrides":["EUR","GBP","USD"]},{"id":"pp_pack_100","group":"credit_pack","code":"pack_100","name":"100-unit pack","badge":"Best value","tagline":null,"features":"Score drift analysis · Onboarding session · Up to 25 evaluators","units":100,"period":"one_time","active":true,"sortOrder":7,"amounts":{"EUR":33100,"GBP":28300,"INR":3000000,"USD":36000},"overrides":["EUR","GBP","USD"]},{"id":"pp_ent_100","group":"enterprise","code":"ent_100","name":"100 units / year","badge":null,"tagline":null,"features":"Entry Enterprise · +config access","units":100,"period":"year","active":true,"sortOrder":8,"amounts":{"EUR":66100,"GBP":56600,"INR":6000000,"USD":72000},"overrides":["EUR","GBP","USD"]},{"id":"pp_ent_200","group":"enterprise","code":"ent_200","name":"200 units / year","badge":null,"tagline":null,"features":null,"units":200,"period":"year","active":true,"sortOrder":9,"amounts":{"EUR":121200,"GBP":103800,"INR":11000000,"USD":131900},"overrides":["EUR","GBP","USD"]},{"id":"pp_ent_300","group":"enterprise","code":"ent_300","name":"300 units / year","badge":null,"tagline":null,"features":null,"units":300,"period":"year","active":true,"sortOrder":10,"amounts":{"EUR":165300,"GBP":141600,"INR":15000000,"USD":179900},"overrides":["EUR","GBP","USD"]},{"id":"pp_ent_400","group":"enterprise","code":"ent_400","name":"400 units / year","badge":null,"tagline":null,"features":null,"units":400,"period":"year","active":true,"sortOrder":11,"amounts":{"EUR":198300,"GBP":169900,"INR":18000000,"USD":215900},"overrides":["EUR","GBP","USD"]},{"id":"pp_ent_500","group":"enterprise","code":"ent_500","name":"500 units / year","badge":"Best value","tagline":null,"features":null,"units":500,"period":"year","active":true,"sortOrder":12,"amounts":{"EUR":220400,"GBP":188800,"INR":20000000,"USD":239900},"overrides":["EUR","GBP","USD"]}],"tax":{"gstRatePct":18,"gstRegistration":"29ABCDE1234F1Z5","pricesIncludeGst":false,"showInternationalTaxNotice":true},"trial":{"decks":3,"expiryDays":0,"showOnPricingPage":true}}', '2026-06-05 09:02:00', NULL, 'Seeded catalogue — the prototype master table under the 2026-09-11 no-per-deck ruling')
ON CONFLICT (version) DO NOTHING;
