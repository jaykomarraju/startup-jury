import type { PricePlanRow, PublishedPriceBook } from "../../../src/shared/priceBook";

/**
 * W6-B — a published catalogue shaped like the one `0047` seeds, trimmed to
 * what the account wizard reads. Shared by the unit and client suites so both
 * prove the SAME thing: the wizard renders whatever this says, and nothing it
 * does not. Change a row here and the screen must change with it.
 */

function plan(over: Partial<PricePlanRow> & Pick<PricePlanRow, "code" | "group" | "name">): PricePlanRow {
  return {
    id: `pp_${over.code}`,
    badge: null,
    tagline: null,
    features: null,
    units: null,
    period: null,
    active: true,
    sortOrder: 0,
    amounts: {},
    overrides: [],
    ...over,
  };
}

export function catalogueFixture(): PublishedPriceBook {
  return {
    version: 3,
    publishedAt: "2026-09-01 10:00:00",
    baseCurrency: "INR",
    currencies: [
      { code: "INR", symbol: "₹", flag: "🇮🇳", active: true, sortOrder: 1 },
      { code: "USD", symbol: "$", flag: "🇺🇸", active: true, sortOrder: 2 },
      { code: "GBP", symbol: "£", flag: "🇬🇧", active: true, sortOrder: 3 },
      { code: "AED", symbol: "د.إ", flag: "🇦🇪", active: false, sortOrder: 5 },
    ],
    fx: [
      { currency: "INR", rate: 1, source: "manual", updatedAt: "2026-06-05 09:02:00" },
      { currency: "USD", rate: 0.01199, source: "manual", updatedAt: "2026-06-05 09:02:00" },
      { currency: "GBP", rate: 0.00944, source: "manual", updatedAt: "2026-06-05 09:02:00" },
    ],
    groups: [
      { group: "free_trial", title: "Free trial", badge: "Always free", icon: "gift", cardName: "Free trial — 3 deck evaluations", cardSub: null, cardTag: null, footnote: null, sortOrder: 1 },
      { group: "subscription", title: "Individual plans", badge: "Monthly subscription · Per seat", icon: "user", cardName: "Standard & Pro — monthly plans", cardSub: "Upgrade or downgrade anytime.", cardTag: null, footnote: "GST at {gst}% added at checkout for INR billing.", sortOrder: 2 },
      { group: "credit_pack", title: "Pay-as-you-go credit packs", badge: "One-time purchase · Credits never expire", icon: "stack", cardName: "Credit packs", cardSub: "Minimum 10 units.", cardTag: null, footnote: null, sortOrder: 3 },
      { group: "enterprise", title: "Enterprise annual plans", badge: "Annual contract", icon: "building", cardName: "Enterprise — full configuration control", cardSub: "Annual invoice.", cardTag: null, footnote: null, sortOrder: 4 },
    ],
    plans: [
      plan({ code: "free_trial", group: "free_trial", name: "Free trial — 3 deck evaluations", units: 3, sortOrder: 1, amounts: { INR: 0, USD: 0, GBP: 0 } }),
      plan({ code: "standard", group: "subscription", name: "Standard", badge: "No configurable params", features: "20 decks/mo · All 13 areas · Override & remark", period: "month", sortOrder: 2, amounts: { INR: 99_900, USD: 1_200, GBP: 900 } }),
      plan({ code: "pro", group: "subscription", name: "Pro", badge: "3 configurable params", features: "Unlimited decks · CRM sync", period: "month", sortOrder: 3, amounts: { INR: 199_900, USD: 2_400, GBP: 1_900 } }),
      plan({ code: "pack_10", group: "credit_pack", name: "10-unit pack", features: "Minimum purchase · Entry tier", units: 10, period: "one_time", sortOrder: 5, amounts: { INR: 500_000, USD: 6_000, GBP: 4_700 } }),
      plan({ code: "pack_50", group: "credit_pack", name: "50-unit pack", badge: "Most popular", features: "Priority WhatsApp support · Up to 10 evaluators", units: 50, period: "one_time", sortOrder: 6, amounts: { INR: 2_000_000, USD: 24_000, GBP: 18_900 } }),
      plan({ code: "pack_100", group: "credit_pack", name: "100-unit pack", badge: "Best value", units: 100, period: "one_time", sortOrder: 7, amounts: { INR: 3_000_000, USD: 36_000, GBP: 0 } }),
      // Switched off in the console: never drawn, never purchasable.
      plan({ code: "pack_250", group: "credit_pack", name: "250-unit pack", units: 250, period: "one_time", active: false, sortOrder: 8, amounts: { INR: 6_000_000, USD: 72_000, GBP: 56_000 } }),
      plan({ code: "ent_100", group: "enterprise", name: "100 units / year", features: "Entry Enterprise · +config access", units: 100, period: "year", sortOrder: 9, amounts: { INR: 6_000_000, USD: 72_000, GBP: 56_600 } }),
      plan({ code: "ent_500", group: "enterprise", name: "500 units / year", badge: "Best value", units: 500, period: "year", sortOrder: 10, amounts: { INR: 20_000_000, USD: 239_900, GBP: 188_800 } }),
    ],
    tax: { gstRatePct: 18, gstRegistration: "29ABCDE1234F1Z5", pricesIncludeGst: false, showInternationalTaxNotice: true },
    trial: { decks: 3, expiryDays: 0, showOnPricingPage: true },
  };
}
