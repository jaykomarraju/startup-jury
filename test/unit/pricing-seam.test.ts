import { describe, expect, it } from "vitest";

import {
  BASE_CURRENCY,
  GST_DEFAULT_RATE_PCT,
  priceBreakdown,
  type TaxSettings,
} from "../../src/shared/plans";
import { taxBreakdown, type TaxConfig } from "../../src/shared/priceBook";

/**
 * The Wave 4 seam: `src/shared/plans.ts` (`W4-C`, the billing side) and
 * `src/shared/priceBook.ts` (`W4-D`, the catalogue side) each implement GST.
 * They were written in parallel worktrees, live in different files, and so
 * merged with no git conflict — the shape of every cross-session defect this
 * programme has hit so far.
 *
 * They agreed on INR and disagreed on every other currency: the catalogue
 * stated a USD price tax-free, billing added 18 % to it, and W4-C's own card
 * rendered the GST line and "customers are responsible for local VAT/GST" at
 * the same time. Nothing could reach it — `billing_subscriptions.currency`
 * defaults to 'INR' — but W4-D's seven-currency catalogue exists to make that
 * settable.
 *
 * This file is the guard: the two modules must state the SAME rule for the
 * SAME money. If one of them changes, this fails rather than the invoice.
 */

const CURRENCIES = [BASE_CURRENCY, "USD", "GBP", "EUR", "AED", "SGD", "AUD"];
const AMOUNTS = [1, 25, 50, 333, 99_900, 199_900, 2_000_000, 99_999, 123_456_789];

function settings(inclusive: boolean): TaxSettings {
  return {
    ratePct: GST_DEFAULT_RATE_PCT,
    registration: null,
    inclusive,
    internationalNotice: true,
  };
}

function config(pricesIncludeGst: boolean): TaxConfig {
  return { gstRatePct: GST_DEFAULT_RATE_PCT, pricesIncludeGst } as TaxConfig;
}

describe("the billing module and the catalogue module price the same money", () => {
  for (const inclusive of [false, true]) {
    const label = inclusive ? "prices include GST" : "GST added at checkout";

    it(`agrees on net, tax and gross for every currency — ${label}`, () => {
      for (const currency of CURRENCIES) {
        for (const amountMinor of AMOUNTS) {
          const billing = priceBreakdown(amountMinor, settings(inclusive), currency);
          const catalogue = taxBreakdown(amountMinor, currency, config(inclusive));

          expect(
            {
              net: billing.subtotalMinor,
              tax: billing.taxMinor,
              gross: billing.totalMinor,
              taxed: billing.taxed,
            },
            `${currency} ${amountMinor} (${label})`,
          ).toEqual({
            net: catalogue.netMinor,
            tax: catalogue.taxMinor,
            gross: catalogue.grossMinor,
            taxed: catalogue.taxed,
          });
        }
      }
    });
  }

  it("taxes the base currency and only the base currency", () => {
    for (const currency of CURRENCIES) {
      const b = priceBreakdown(199_900, settings(false), currency);
      if (currency === BASE_CURRENCY) {
        expect(b.taxed, currency).toBe(true);
        expect(b.taxMinor, currency).toBeGreaterThan(0);
      } else {
        expect(b.taxed, currency).toBe(false);
        expect(b.taxMinor, currency).toBe(0);
        expect(b.totalMinor, currency).toBe(b.subtotalMinor);
      }
    }
  });

  it("defaults to the base currency, so every pre-Wave-4 caller is unchanged", () => {
    const withArg = priceBreakdown(199_900, settings(false), BASE_CURRENCY);
    const without = priceBreakdown(199_900, settings(false));
    expect(without).toEqual(withArg);
    expect(without.taxMinor).toBe(35_982);
  });
});
