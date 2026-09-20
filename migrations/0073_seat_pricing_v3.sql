-- 0073 — V3-PT · the seat-subscription price model the reshared superuser
-- prototype (`AISJ_SuperuserV3.HTM`, 2026-09-19) sells.
--
-- Item 15 rebuilt Price configuration from a 37 KB base64 iframe (`PC_B64`,
-- still defined in v3 and no longer loaded by anything) into a 2 KB inline
-- console section with exactly three editable cards:
--
--   Paid trial                        one per-deck rate        ₹100
--   Individual plans — ₹ per period   3 seats × 3 periods      9 prices
--   Enterprise plans — ₹ annual       3 seat counts            3 prices
--
-- and item 17 is the other end of the same wire: the My Account overlay's
-- "Choose your seat" → "Billing period · per seat" flow reads those thirteen
-- numbers (`window.PRICING`, refreshed by `prSave()`'s postMessage).
--
-- ── Why this migration is purely additive ───────────────────────────────────
-- The prototype's periods are QUARTER, HALF-YEAR and YEAR. `price_plans.period`
-- and `account_orders.period` both CHECK a three-value enum ('month', 'year',
-- 'one_time'), and SQLite cannot widen a CHECK without rebuilding the table —
-- which for `price_plans` means dropping the parent of
-- `price_amounts.plan_id … ON DELETE CASCADE`. That is a data-loss shape, on a
-- deployment whose D1 is already known to drift behind the repo. So the enum is
-- left exactly as it is and the period is carried by a NEW nullable column:
--
--   period_months  3 · 6 · 12, and it WINS over `period` wherever both exist
--                  (`periodOf()` in src/shared/priceBook.ts).
--
-- A quarterly seat therefore stores `period = NULL, period_months = 3`, which
-- the old CHECK already permits, and an annual one stores both. Nothing that
-- reads `period` today sees a value it did not see before.
--
-- `tier` and `seats` are the other two facts the prototype's tables carry and
-- the old model had nowhere to put: a seat SKU is (tier, period_months), an
-- enterprise SKU is (seats). They are what `seatPlans()` and
-- `enterpriseSeatPlans()` select on, so the new screens never parse a code.
--
-- ── What is NOT removed ─────────────────────────────────────────────────────
-- The legacy `standard` / `pro` monthly subscriptions, the `base_rate`/`pack_*`
-- ladder and the `ent_100…ent_500` unit tiers all stay, active and priced.
--   • `src/shared/seats.ts` prices a purchased seat from the `subscription`
--     plan CODED `standard` / `pro` / `premium`; deleting those rows would make
--     every seat unpurchasable.
--   • The new screens select by `tier` / `seats`, so the old rows simply are
--     not drawn — a filter, not a deletion, and reversible by one ruling.
-- Retiring them is §4 Q83.

ALTER TABLE price_plans ADD COLUMN period_months INTEGER;
ALTER TABLE price_plans ADD COLUMN tier TEXT;
ALTER TABLE price_plans ADD COLUMN seats INTEGER;

-- The order an account's receipt was billed on, for the same reason: a
-- quarterly order must not be reported as monthly by `billingCycleLine`.
ALTER TABLE account_orders ADD COLUMN period_months INTEGER;

-- The thirteen prices the console's three cards edit. ON CONFLICT DO NOTHING
-- so a re-run never overwrites a price an administrator has since changed.
INSERT INTO price_plans
  (id, plan_group, code, name, badge, tagline, features, units, period, period_months, tier, seats, sort_order)
VALUES
  ('pp_paid_trial', 'credit_pack', 'paid_trial', 'Paid trial', NULL, 'Extend your trial before choosing a longer plan', '1 credit evaluates 1 deck · Credits never expire · Buy 10 to 50 at a time', 1, NULL, NULL, NULL, NULL, 20),
  ('pp_seat_standard_3', 'subscription', 'seat_standard_3', 'Standard', NULL, 'Cannot configure evaluation parameters', 'AI pre-scores each deck · 13-area weighted rubric · Score & remark on decks', 125, NULL, 3, 'standard', NULL, 21),
  ('pp_seat_standard_6', 'subscription', 'seat_standard_6', 'Standard', NULL, 'Cannot configure evaluation parameters', 'AI pre-scores each deck · 13-area weighted rubric · Score & remark on decks', 250, NULL, 6, 'standard', NULL, 22),
  ('pp_seat_standard_12', 'subscription', 'seat_standard_12', 'Standard', NULL, 'Cannot configure evaluation parameters', 'AI pre-scores each deck · 13-area weighted rubric · Score & remark on decks', 500, 'year', 12, 'standard', NULL, 23),
  ('pp_seat_pro_3', 'subscription', 'seat_pro_3', 'Pro', 'Most chosen', 'Configure the 13 core parameters', 'Everything in Standard · Configure all 13 core parameters · Override score & remark', 125, NULL, 3, 'pro', NULL, 24),
  ('pp_seat_pro_6', 'subscription', 'seat_pro_6', 'Pro', 'Most chosen', 'Configure the 13 core parameters', 'Everything in Standard · Configure all 13 core parameters · Override score & remark', 250, NULL, 6, 'pro', NULL, 25),
  ('pp_seat_pro_12', 'subscription', 'seat_pro_12', 'Pro', 'Most chosen', 'Configure the 13 core parameters', 'Everything in Standard · Configure all 13 core parameters · Override score & remark', 500, 'year', 12, 'pro', NULL, 26),
  ('pp_seat_premium_3', 'subscription', 'seat_premium_3', 'Premium', NULL, '13 core + 3 additional parameters', 'Everything in Pro · +3 additional parameters per user · Priority support & onboarding', 125, NULL, 3, 'premium', NULL, 27),
  ('pp_seat_premium_6', 'subscription', 'seat_premium_6', 'Premium', NULL, '13 core + 3 additional parameters', 'Everything in Pro · +3 additional parameters per user · Priority support & onboarding', 250, NULL, 6, 'premium', NULL, 28),
  ('pp_seat_premium_12', 'subscription', 'seat_premium_12', 'Premium', NULL, '13 core + 3 additional parameters', 'Everything in Pro · +3 additional parameters per user · Priority support & onboarding', 500, 'year', 12, 'premium', NULL, 29),
  ('pp_ent_s5', 'enterprise', 'ent_s5', 'Family Office Plan', NULL, 'Annual · all Premium seats', NULL, 2500, 'year', 12, NULL, 5, 30),
  ('pp_ent_s10', 'enterprise', 'ent_s10', 'Enterprise Plan', NULL, 'Annual · all Premium seats', NULL, 5000, 'year', 12, NULL, 10, 31),
  ('pp_ent_s15', 'enterprise', 'ent_s15', 'Large Organisation Plan', NULL, 'Annual · all Premium seats', NULL, 7500, 'year', 12, NULL, 15, 32)
ON CONFLICT (id) DO NOTHING;

-- Non-INR amounts are the 0033 FX derivation, seeded so a seat is
-- purchasable in every active currency from the first load.
INSERT INTO price_amounts (id, plan_id, currency, amount_minor, overridden)
VALUES
  ('pa_paid_trial_inr', 'pp_paid_trial', 'INR', 10000, 0),
  ('pa_paid_trial_usd', 'pp_paid_trial', 'USD', 120, 0),
  ('pa_paid_trial_gbp', 'pp_paid_trial', 'GBP', 94, 0),
  ('pa_paid_trial_eur', 'pp_paid_trial', 'EUR', 110, 0),
  ('pa_seat_standard_3_inr', 'pp_seat_standard_3', 'INR', 450000, 0),
  ('pa_seat_standard_3_usd', 'pp_seat_standard_3', 'USD', 5396, 0),
  ('pa_seat_standard_3_gbp', 'pp_seat_standard_3', 'GBP', 4248, 0),
  ('pa_seat_standard_3_eur', 'pp_seat_standard_3', 'EUR', 4959, 0),
  ('pa_seat_standard_6_inr', 'pp_seat_standard_6', 'INR', 720000, 0),
  ('pa_seat_standard_6_usd', 'pp_seat_standard_6', 'USD', 8633, 0),
  ('pa_seat_standard_6_gbp', 'pp_seat_standard_6', 'GBP', 6797, 0),
  ('pa_seat_standard_6_eur', 'pp_seat_standard_6', 'EUR', 7934, 0),
  ('pa_seat_standard_12_inr', 'pp_seat_standard_12', 'INR', 1152000, 0),
  ('pa_seat_standard_12_usd', 'pp_seat_standard_12', 'USD', 13812, 0),
  ('pa_seat_standard_12_gbp', 'pp_seat_standard_12', 'GBP', 10875, 0),
  ('pa_seat_standard_12_eur', 'pp_seat_standard_12', 'EUR', 12695, 0),
  ('pa_seat_pro_3_inr', 'pp_seat_pro_3', 'INR', 600000, 0),
  ('pa_seat_pro_3_usd', 'pp_seat_pro_3', 'USD', 7194, 0),
  ('pa_seat_pro_3_gbp', 'pp_seat_pro_3', 'GBP', 5664, 0),
  ('pa_seat_pro_3_eur', 'pp_seat_pro_3', 'EUR', 6612, 0),
  ('pa_seat_pro_6_inr', 'pp_seat_pro_6', 'INR', 960000, 0),
  ('pa_seat_pro_6_usd', 'pp_seat_pro_6', 'USD', 11510, 0),
  ('pa_seat_pro_6_gbp', 'pp_seat_pro_6', 'GBP', 9062, 0),
  ('pa_seat_pro_6_eur', 'pp_seat_pro_6', 'EUR', 10579, 0),
  ('pa_seat_pro_12_inr', 'pp_seat_pro_12', 'INR', 1536000, 0),
  ('pa_seat_pro_12_usd', 'pp_seat_pro_12', 'USD', 18417, 0),
  ('pa_seat_pro_12_gbp', 'pp_seat_pro_12', 'GBP', 14500, 0),
  ('pa_seat_pro_12_eur', 'pp_seat_pro_12', 'EUR', 16927, 0),
  ('pa_seat_premium_3_inr', 'pp_seat_premium_3', 'INR', 800000, 0),
  ('pa_seat_premium_3_usd', 'pp_seat_premium_3', 'USD', 9592, 0),
  ('pa_seat_premium_3_gbp', 'pp_seat_premium_3', 'GBP', 7552, 0),
  ('pa_seat_premium_3_eur', 'pp_seat_premium_3', 'EUR', 8816, 0),
  ('pa_seat_premium_6_inr', 'pp_seat_premium_6', 'INR', 1280000, 0),
  ('pa_seat_premium_6_usd', 'pp_seat_premium_6', 'USD', 15347, 0),
  ('pa_seat_premium_6_gbp', 'pp_seat_premium_6', 'GBP', 12083, 0),
  ('pa_seat_premium_6_eur', 'pp_seat_premium_6', 'EUR', 14106, 0),
  ('pa_seat_premium_12_inr', 'pp_seat_premium_12', 'INR', 2048000, 0),
  ('pa_seat_premium_12_usd', 'pp_seat_premium_12', 'USD', 24556, 0),
  ('pa_seat_premium_12_gbp', 'pp_seat_premium_12', 'GBP', 19333, 0),
  ('pa_seat_premium_12_eur', 'pp_seat_premium_12', 'EUR', 22569, 0),
  ('pa_ent_s5_inr', 'pp_ent_s5', 'INR', 8000000, 0),
  ('pa_ent_s5_usd', 'pp_ent_s5', 'USD', 95920, 0),
  ('pa_ent_s5_gbp', 'pp_ent_s5', 'GBP', 75520, 0),
  ('pa_ent_s5_eur', 'pp_ent_s5', 'EUR', 88160, 0),
  ('pa_ent_s10_inr', 'pp_ent_s10', 'INR', 16000000, 0),
  ('pa_ent_s10_usd', 'pp_ent_s10', 'USD', 191840, 0),
  ('pa_ent_s10_gbp', 'pp_ent_s10', 'GBP', 151040, 0),
  ('pa_ent_s10_eur', 'pp_ent_s10', 'EUR', 176320, 0),
  ('pa_ent_s15_inr', 'pp_ent_s15', 'INR', 24000000, 0),
  ('pa_ent_s15_usd', 'pp_ent_s15', 'USD', 287760, 0),
  ('pa_ent_s15_gbp', 'pp_ent_s15', 'GBP', 226560, 0),
  ('pa_ent_s15_eur', 'pp_ent_s15', 'EUR', 264480, 0)
ON CONFLICT (id) DO NOTHING;
-- Version 2 — the seeded draft with the seat catalogue above added, frozen.
-- A publish is what a customer reads: the account overlay reads
-- `GET /api/pricing/published`, so seat SKUs that exist only in the draft
-- would leave a fresh deployment with nothing to sell. Version 1 stays in
-- the table, superseded, which is what makes this reversible.
--
-- `test/worker/pricing.test.ts` pins this against the serialised draft:
-- edit a seed row above and forget this line, and the suite says so.
UPDATE pricing_versions SET status = 'superseded' WHERE status = 'published' AND version <> 2;

INSERT INTO pricing_versions (version, status, document, published_at, published_by, note)
VALUES (2, 'published', '{"baseCurrency":"INR","currencies":[{"code":"INR","symbol":"₹","flag":"🇮🇳","active":true,"sortOrder":1},{"code":"USD","symbol":"$","flag":"🇺🇸","active":true,"sortOrder":2},{"code":"GBP","symbol":"£","flag":"🇬🇧","active":true,"sortOrder":3},{"code":"EUR","symbol":"€","flag":"🇪🇺","active":true,"sortOrder":4},{"code":"AED","symbol":"د.إ","flag":"🇦🇪","active":false,"sortOrder":5},{"code":"SGD","symbol":"S$","flag":"🇸🇬","active":false,"sortOrder":6},{"code":"AUD","symbol":"A$","flag":"🇦🇺","active":false,"sortOrder":7}],"fx":[{"currency":"EUR","rate":0.01102,"source":"manual","updatedAt":"2026-06-05 09:02:00"},{"currency":"GBP","rate":0.00944,"source":"manual","updatedAt":"2026-06-05 09:02:00"},{"currency":"INR","rate":1,"source":"manual","updatedAt":"2026-06-05 09:02:00"},{"currency":"USD","rate":0.01199,"source":"manual","updatedAt":"2026-06-05 09:02:00"}],"groups":[{"group":"free_trial","title":"Free trial","badge":"Always free · No card required","icon":"gift","cardName":"Free trial — 3 deck evaluations","cardSub":"Included with every new account. Full AI evaluation across all 13 areas.","cardTag":"₹0 always","footnote":null,"sortOrder":1},{"group":"subscription","title":"Individual plans","badge":"Monthly subscription · Per seat","icon":"user","cardName":"Standard & Pro — monthly plans","cardSub":"Individual subscriptions billed monthly. Upgrade or downgrade anytime.","cardTag":null,"footnote":"GST at {gst}% added at checkout for INR billing. International pricing shown exclusive of local taxes.","sortOrder":2},{"group":"credit_pack","title":"Pay-as-you-go credit packs","badge":"One-time purchase · Credits never expire","icon":"stack","cardName":"Credit packs — buy in bulk, save more","cardSub":"Minimum 10 units.","cardTag":null,"footnote":null,"sortOrder":3},{"group":"enterprise","title":"Enterprise annual plans","badge":"Annual contract · Units reset yearly","icon":"building","cardName":"Enterprise — full configuration control","cardSub":"Annual invoice. Role-based 3-parameter system. Dedicated account manager. Unlimited evaluators.","cardTag":null,"footnote":"Enterprise invoiced annually in INR. International billing available via wire transfer. GST invoice provided.","sortOrder":4}],"plans":[{"id":"pp_free_trial","group":"free_trial","code":"free_trial","name":"Free trial — 3 deck evaluations","badge":null,"tagline":null,"features":null,"units":3,"period":null,"periodMonths":null,"tier":null,"seats":null,"active":true,"sortOrder":1,"amounts":{"EUR":0,"GBP":0,"INR":0,"USD":0},"overrides":[]},{"id":"pp_standard","group":"subscription","code":"standard","name":"Standard","badge":"No configurable params","tagline":null,"features":"20 decks/mo · All 13 areas · Override & remark","units":null,"period":"month","periodMonths":null,"tier":null,"seats":null,"active":true,"sortOrder":2,"amounts":{"EUR":1100,"GBP":900,"INR":99900,"USD":1200},"overrides":["EUR","GBP","USD"]},{"id":"pp_pro","group":"subscription","code":"pro","name":"Pro","badge":"3 configurable params","tagline":null,"features":"Unlimited decks · CRM sync · Intro call prompts","units":null,"period":"month","periodMonths":null,"tier":null,"seats":null,"active":true,"sortOrder":3,"amounts":{"EUR":2200,"GBP":1900,"INR":199900,"USD":2400},"overrides":["EUR","GBP","USD"]},{"id":"pp_pack_10","group":"credit_pack","code":"pack_10","name":"10-unit pack","badge":null,"tagline":null,"features":"Minimum purchase · Entry tier","units":10,"period":"one_time","periodMonths":null,"tier":null,"seats":null,"active":true,"sortOrder":5,"amounts":{"EUR":5500,"GBP":4700,"INR":500000,"USD":6000},"overrides":["EUR","GBP","USD"]},{"id":"pp_pack_50","group":"credit_pack","code":"pack_50","name":"50-unit pack","badge":"Most popular","tagline":null,"features":"Priority WhatsApp support · Up to 10 evaluators","units":50,"period":"one_time","periodMonths":null,"tier":null,"seats":null,"active":true,"sortOrder":6,"amounts":{"EUR":22100,"GBP":18900,"INR":2000000,"USD":24000},"overrides":["EUR","GBP","USD"]},{"id":"pp_pack_100","group":"credit_pack","code":"pack_100","name":"100-unit pack","badge":"Best value","tagline":null,"features":"Score drift analysis · Onboarding session · Up to 25 evaluators","units":100,"period":"one_time","periodMonths":null,"tier":null,"seats":null,"active":true,"sortOrder":7,"amounts":{"EUR":33100,"GBP":28300,"INR":3000000,"USD":36000},"overrides":["EUR","GBP","USD"]},{"id":"pp_ent_100","group":"enterprise","code":"ent_100","name":"100 units / year","badge":null,"tagline":null,"features":"Entry Enterprise · +config access","units":100,"period":"year","periodMonths":null,"tier":null,"seats":null,"active":true,"sortOrder":8,"amounts":{"EUR":66100,"GBP":56600,"INR":6000000,"USD":72000},"overrides":["EUR","GBP","USD"]},{"id":"pp_ent_200","group":"enterprise","code":"ent_200","name":"200 units / year","badge":null,"tagline":null,"features":null,"units":200,"period":"year","periodMonths":null,"tier":null,"seats":null,"active":true,"sortOrder":9,"amounts":{"EUR":121200,"GBP":103800,"INR":11000000,"USD":131900},"overrides":["EUR","GBP","USD"]},{"id":"pp_ent_300","group":"enterprise","code":"ent_300","name":"300 units / year","badge":null,"tagline":null,"features":null,"units":300,"period":"year","periodMonths":null,"tier":null,"seats":null,"active":true,"sortOrder":10,"amounts":{"EUR":165300,"GBP":141600,"INR":15000000,"USD":179900},"overrides":["EUR","GBP","USD"]},{"id":"pp_ent_400","group":"enterprise","code":"ent_400","name":"400 units / year","badge":null,"tagline":null,"features":null,"units":400,"period":"year","periodMonths":null,"tier":null,"seats":null,"active":true,"sortOrder":11,"amounts":{"EUR":198300,"GBP":169900,"INR":18000000,"USD":215900},"overrides":["EUR","GBP","USD"]},{"id":"pp_ent_500","group":"enterprise","code":"ent_500","name":"500 units / year","badge":"Best value","tagline":null,"features":null,"units":500,"period":"year","periodMonths":null,"tier":null,"seats":null,"active":true,"sortOrder":12,"amounts":{"EUR":220400,"GBP":188800,"INR":20000000,"USD":239900},"overrides":["EUR","GBP","USD"]},{"id":"pp_paid_trial","group":"credit_pack","code":"paid_trial","name":"Paid trial","badge":null,"tagline":"Extend your trial before choosing a longer plan","features":"1 credit evaluates 1 deck · Credits never expire · Buy 10 to 50 at a time","units":1,"period":null,"periodMonths":null,"tier":null,"seats":null,"active":true,"sortOrder":20,"amounts":{"EUR":110,"GBP":94,"INR":10000,"USD":120},"overrides":[]},{"id":"pp_seat_standard_3","group":"subscription","code":"seat_standard_3","name":"Standard","badge":null,"tagline":"Cannot configure evaluation parameters","features":"AI pre-scores each deck · 13-area weighted rubric · Score & remark on decks","units":125,"period":null,"periodMonths":3,"tier":"standard","seats":null,"active":true,"sortOrder":21,"amounts":{"EUR":4959,"GBP":4248,"INR":450000,"USD":5396},"overrides":[]},{"id":"pp_seat_standard_6","group":"subscription","code":"seat_standard_6","name":"Standard","badge":null,"tagline":"Cannot configure evaluation parameters","features":"AI pre-scores each deck · 13-area weighted rubric · Score & remark on decks","units":250,"period":null,"periodMonths":6,"tier":"standard","seats":null,"active":true,"sortOrder":22,"amounts":{"EUR":7934,"GBP":6797,"INR":720000,"USD":8633},"overrides":[]},{"id":"pp_seat_standard_12","group":"subscription","code":"seat_standard_12","name":"Standard","badge":null,"tagline":"Cannot configure evaluation parameters","features":"AI pre-scores each deck · 13-area weighted rubric · Score & remark on decks","units":500,"period":"year","periodMonths":12,"tier":"standard","seats":null,"active":true,"sortOrder":23,"amounts":{"EUR":12695,"GBP":10875,"INR":1152000,"USD":13812},"overrides":[]},{"id":"pp_seat_pro_3","group":"subscription","code":"seat_pro_3","name":"Pro","badge":"Most chosen","tagline":"Configure the 13 core parameters","features":"Everything in Standard · Configure all 13 core parameters · Override score & remark","units":125,"period":null,"periodMonths":3,"tier":"pro","seats":null,"active":true,"sortOrder":24,"amounts":{"EUR":6612,"GBP":5664,"INR":600000,"USD":7194},"overrides":[]},{"id":"pp_seat_pro_6","group":"subscription","code":"seat_pro_6","name":"Pro","badge":"Most chosen","tagline":"Configure the 13 core parameters","features":"Everything in Standard · Configure all 13 core parameters · Override score & remark","units":250,"period":null,"periodMonths":6,"tier":"pro","seats":null,"active":true,"sortOrder":25,"amounts":{"EUR":10579,"GBP":9062,"INR":960000,"USD":11510},"overrides":[]},{"id":"pp_seat_pro_12","group":"subscription","code":"seat_pro_12","name":"Pro","badge":"Most chosen","tagline":"Configure the 13 core parameters","features":"Everything in Standard · Configure all 13 core parameters · Override score & remark","units":500,"period":"year","periodMonths":12,"tier":"pro","seats":null,"active":true,"sortOrder":26,"amounts":{"EUR":16927,"GBP":14500,"INR":1536000,"USD":18417},"overrides":[]},{"id":"pp_seat_premium_3","group":"subscription","code":"seat_premium_3","name":"Premium","badge":null,"tagline":"13 core + 3 additional parameters","features":"Everything in Pro · +3 additional parameters per user · Priority support & onboarding","units":125,"period":null,"periodMonths":3,"tier":"premium","seats":null,"active":true,"sortOrder":27,"amounts":{"EUR":8816,"GBP":7552,"INR":800000,"USD":9592},"overrides":[]},{"id":"pp_seat_premium_6","group":"subscription","code":"seat_premium_6","name":"Premium","badge":null,"tagline":"13 core + 3 additional parameters","features":"Everything in Pro · +3 additional parameters per user · Priority support & onboarding","units":250,"period":null,"periodMonths":6,"tier":"premium","seats":null,"active":true,"sortOrder":28,"amounts":{"EUR":14106,"GBP":12083,"INR":1280000,"USD":15347},"overrides":[]},{"id":"pp_seat_premium_12","group":"subscription","code":"seat_premium_12","name":"Premium","badge":null,"tagline":"13 core + 3 additional parameters","features":"Everything in Pro · +3 additional parameters per user · Priority support & onboarding","units":500,"period":"year","periodMonths":12,"tier":"premium","seats":null,"active":true,"sortOrder":29,"amounts":{"EUR":22569,"GBP":19333,"INR":2048000,"USD":24556},"overrides":[]},{"id":"pp_ent_s5","group":"enterprise","code":"ent_s5","name":"Family Office Plan","badge":null,"tagline":"Annual · all Premium seats","features":null,"units":2500,"period":"year","periodMonths":12,"tier":null,"seats":5,"active":true,"sortOrder":30,"amounts":{"EUR":88160,"GBP":75520,"INR":8000000,"USD":95920},"overrides":[]},{"id":"pp_ent_s10","group":"enterprise","code":"ent_s10","name":"Enterprise Plan","badge":null,"tagline":"Annual · all Premium seats","features":null,"units":5000,"period":"year","periodMonths":12,"tier":null,"seats":10,"active":true,"sortOrder":31,"amounts":{"EUR":176320,"GBP":151040,"INR":16000000,"USD":191840},"overrides":[]},{"id":"pp_ent_s15","group":"enterprise","code":"ent_s15","name":"Large Organisation Plan","badge":null,"tagline":"Annual · all Premium seats","features":null,"units":7500,"period":"year","periodMonths":12,"tier":null,"seats":15,"active":true,"sortOrder":32,"amounts":{"EUR":264480,"GBP":226560,"INR":24000000,"USD":287760},"overrides":[]}],"tax":{"gstRatePct":18,"gstRegistration":"29ABCDE1234F1Z5","pricesIncludeGst":false,"showInternationalTaxNotice":true},"trial":{"decks":3,"expiryDays":0,"showOnPricingPage":true}}', '2026-09-19 10:00:00', NULL, 'V3-PT — the reshared superuser prototype''s seat pricing (items 15 and 17)')
ON CONFLICT (version) DO NOTHING;
