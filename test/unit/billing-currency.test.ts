import { describe, it, expect } from "vitest";
import {
  BASE_CURRENCY,
  GST_DEFAULT_RATE_PCT,
  INTERNATIONAL_CURRENCY,
  billingCurrencyFor,
  gstApplies,
  isIndianBillingCountry,
  priceBreakdown,
  resolveBillingLocale,
  validateBillingAddress,
  type TaxSettings,
} from "../../src/shared/plans";

/**
 * V6-CURRENCY — the billing address decides the currency, and the currency
 * decides GST.
 *
 * `docs/prototype/source/incubator/AISJ_MyAccount_V6.HTM`, `#acs-billing`,
 * verbatim: "We use this to set your billing currency and generate your
 * invoice. Indian billing addresses are charged in INR with GST; every other
 * country is billed in USD with no GST."
 *
 * The cases below are the four properties that matter, in the order they matter:
 *
 *  1. India resolves to INR WITH GST and everywhere else to USD WITHOUT, at the
 *     CONFIGURED rate rather than a literal 18.
 *  2. An unrecorded country resolves to NOTHING. This is the production-safety
 *     property: two `account_profiles` rows predate the billing screen, and
 *     defaulting them in either direction changes what a real customer is
 *     billed. `0104`'s header is the long form.
 *  3. The resolver and the tax arithmetic cannot disagree, because they share
 *     `gstApplies`.
 *  4. All four fields of the screen are required, which is V6's own rule.
 */

const TAX: TaxSettings = {
  ratePct: GST_DEFAULT_RATE_PCT,
  registration: "29ABCDE1234F1Z5",
  inclusive: false,
  internationalNotice: true,
};

describe("country → currency", () => {
  it("bills an Indian address in INR with GST at the configured rate", () => {
    const locale = resolveBillingLocale("India", TAX);
    expect(locale).toEqual({
      country: "India",
      currency: "INR",
      taxed: true,
      ratePct: 18,
      note: "Billed in INR with 18% GST — GST-compliant invoice provided.",
    });
    // The currency GST applies to is the base currency, by construction.
    expect(locale.currency).toBe(BASE_CURRENCY);
  });

  it("bills every other country in USD with no GST", () => {
    for (const country of [
      "United States",
      "United Kingdom",
      "Singapore",
      "United Arab Emirates",
      "Germany",
      "Canada",
      "Other",
      // A country nobody listed. V6's field is free text, and the safe answer
      // for an unrecognised one is USD with no GST — we do not collect a tax we
      // cannot then attribute.
      "Narnia",
    ]) {
      const locale = resolveBillingLocale(country, TAX);
      expect(locale.currency, country).toBe(INTERNATIONAL_CURRENCY);
      expect(locale.taxed, country).toBe(false);
      expect(locale.ratePct, country).toBe(0);
      expect(locale.note, country).toBe("Billed in USD, no GST applied.");
    }
  });

  it("reads the rate off the SETTING, never a literal 18", () => {
    // The lane's rule 2: a constant beside a setting is how this product came to
    // have four low-credit thresholds. A workspace whose catalogue publishes 12 %
    // must see 12 % here, in the number AND in the sentence.
    const locale = resolveBillingLocale("India", { ...TAX, ratePct: 12 });
    expect(locale.ratePct).toBe(12);
    expect(locale.note).toContain("12% GST");
    expect(locale.note).not.toContain("18");
  });

  it("recognises the spellings a free-text field actually receives", () => {
    // V6's own check is `c==='india'||c==='in'||c==='bharat'` on a trimmed,
    // lower-cased value, because the datalist is a hint and not a constraint.
    for (const spelling of ["India", "india", "  INDIA  ", "in", "IN", "Bharat", "Republic of India"]) {
      expect(isIndianBillingCountry(spelling), spelling).toBe(true);
      expect(billingCurrencyFor(spelling), spelling).toBe("INR");
    }
    // And does not over-reach. "Indiana" is a US state, not India.
    for (const spelling of ["Indiana", "Indonesia", "British Indian Ocean Territory"]) {
      expect(isIndianBillingCountry(spelling), spelling).toBe(false);
      expect(billingCurrencyFor(spelling), spelling).toBe("USD");
    }
  });

  it("resolves NOTHING when no country is on file — no silent default either way", () => {
    // The whole point. `null` is not "INR by default" and not "USD by default":
    // it is "nobody has told us", which is the state the two production rows are
    // in. The order route enforces no currency while it holds.
    for (const missing of [null, undefined, "", "   "]) {
      expect(billingCurrencyFor(missing)).toBeNull();
      const locale = resolveBillingLocale(missing, TAX);
      expect(locale).toEqual({
        country: null,
        currency: null,
        taxed: false,
        ratePct: 0,
        note: null,
      });
    }
  });
});

describe("the resolver and the tax arithmetic cannot disagree", () => {
  it("prices the resolved currency the way the resolver said it would", () => {
    // ₹999 → ₹179.82 GST → ₹1,178.82, which is V6's own order summary (it floors
    // the paise; `plans.ts` keeps them, per §8 — the arithmetic is untouched here).
    const india = resolveBillingLocale("India", TAX);
    const inr = priceBreakdown(99_900, TAX, india.currency!);
    expect(inr.taxed).toBe(india.taxed);
    expect(inr.taxMinor).toBe(17_982);

    const abroad = resolveBillingLocale("United States", TAX);
    const usd = priceBreakdown(1_200, TAX, abroad.currency!);
    expect(usd.taxed).toBe(abroad.taxed);
    expect(usd.taxMinor).toBe(0);
    expect(usd.totalMinor).toBe(1_200);
  });

  it("answers 'does GST apply' in exactly one place", () => {
    // If this ever disagrees with `priceBreakdown`, a screen can say "no GST" on
    // an invoice that charges it. Over the catalogue's seven currencies: the
    // ANCHOR is the concrete expectation (INR taxed, the other six not) — a
    // property test alone would pass vacuously here, because flipping
    // `gstApplies` flips `priceBreakdown` with it.
    expect(gstApplies("INR")).toBe(true);
    for (const currency of ["INR", "USD", "GBP", "EUR", "AED", "SGD", "AUD"]) {
      const breakdown = priceBreakdown(100_000, TAX, currency);
      expect(breakdown.taxed, currency).toBe(currency === "INR");
      expect(breakdown.taxed, currency).toBe(gstApplies(currency));
    }
    // And the default argument is the base currency, which is the taxed one.
    expect(priceBreakdown(100_000, TAX).taxed).toBe(true);
    expect(BASE_CURRENCY).toBe("INR");
  });
});

describe("the billing screen's four fields", () => {
  const COMPLETE = {
    name: "Demo Incubator Foundation",
    city: "Hyderabad",
    country: "India",
    address: "Plot 42, Hitec City, 500081",
  };

  it("accepts a complete address", () => {
    expect(validateBillingAddress(COMPLETE)).toEqual({});
  });

  it("requires all four, which is what V6's Continue button is gated on", () => {
    // `acBillingValidate()`: `btn.disabled = !(name && city && country && addr)`.
    for (const key of ["name", "city", "country", "address"] as const) {
      const errors = validateBillingAddress({ ...COMPLETE, [key]: "" });
      expect(Object.keys(errors), key).toEqual([key]);
    }
    // Whitespace is not a value, and a non-string is not one either.
    expect(validateBillingAddress({ ...COMPLETE, city: "   " })).toHaveProperty("city");
    expect(validateBillingAddress({ ...COMPLETE, country: 91 })).toHaveProperty("country");
    expect(Object.keys(validateBillingAddress({}))).toEqual(["name", "city", "country", "address"]);
  });

  it("caps the fields, with the textarea getting a textarea's budget", () => {
    expect(validateBillingAddress({ ...COMPLETE, city: "x".repeat(121) })).toHaveProperty("city");
    // 500 for the multi-line communication address, which 121 characters must not trip.
    expect(validateBillingAddress({ ...COMPLETE, address: "x".repeat(121) })).toEqual({});
    expect(validateBillingAddress({ ...COMPLETE, address: "x".repeat(501) })).toHaveProperty("address");
  });
});
