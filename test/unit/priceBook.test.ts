import { describe, it, expect } from "vitest";
import {
  convertMinor,
  deriveAmounts,
  formatMinor,
  gstMinor,
  listedPlans,
  normalisePriceBook,
  perDeckArtefacts,
  priceBooksEqual,
  taxBreakdown,
  validatePriceBook,
  type PriceBook,
  type PricePlanRow,
} from "../../src/shared/priceBook";

/**
 * W4-D — the price book's pure logic.
 *
 * Two of the three things the session's brief asks for live here: **FX
 * conversion** and **the GST rate applied at 18 %**. The third — per-deck
 * derivation — does not exist to test, because §8 Q1 ruled it out on
 * 2026-09-11; what is tested instead is that it cannot come back, which is
 * `perDeckArtefacts()` and the refusal built on it.
 */

function plan(over: Partial<PricePlanRow> = {}): PricePlanRow {
  return {
    id: "pp_standard",
    group: "subscription",
    code: "standard",
    name: "Standard",
    badge: null,
    tagline: null,
    features: null,
    units: null,
    period: "month",
    active: true,
    sortOrder: 1,
    amounts: { INR: 99900, USD: 1200 },
    overrides: [],
    ...over,
  };
}

function book(over: Partial<PriceBook> = {}): PriceBook {
  return {
    baseCurrency: "INR",
    currencies: [
      { code: "INR", symbol: "₹", flag: "🇮🇳", active: true, sortOrder: 1 },
      { code: "USD", symbol: "$", flag: "🇺🇸", active: true, sortOrder: 2 },
      { code: "AED", symbol: "د.إ", flag: "🇦🇪", active: false, sortOrder: 5 },
    ],
    fx: [
      { currency: "INR", rate: 1, source: "manual", updatedAt: "2026-06-05 09:02:00" },
      { currency: "USD", rate: 0.01199, source: "manual", updatedAt: "2026-06-05 09:02:00" },
    ],
    groups: [
      {
        group: "subscription",
        title: "Individual plans",
        badge: "Monthly subscription · Per seat",
        icon: "user",
        cardName: "Standard & Pro — monthly plans",
        cardSub: null,
        cardTag: null,
        footnote: "GST at {gst}% added at checkout for INR billing.",
        sortOrder: 2,
      },
    ],
    plans: [plan()],
    tax: {
      gstRatePct: 18,
      gstRegistration: "29ABCDE1234F1Z5",
      pricesIncludeGst: false,
      showInternationalTaxNotice: true,
    },
    trial: { decks: 3, expiryDays: 0, showOnPricingPage: true },
    ...over,
  };
}

describe("FX conversion", () => {
  it("converts minor units at the stored rate, rounding to the nearest minor unit", () => {
    // ₹999.00 at 1 INR = 0.01199 USD is $11.978 → $11.98.
    expect(convertMinor(99900, 0.01199)).toBe(1198);
    expect(convertMinor(2000000, 0.00944)).toBe(18880);
    expect(convertMinor(0, 0.01199)).toBe(0);
  });

  it("refuses to invent a price from a missing or nonsense rate", () => {
    expect(convertMinor(99900, 0)).toBe(0);
    expect(convertMinor(99900, -1)).toBe(0);
    expect(convertMinor(99900, Number.NaN)).toBe(0);
  });

  it("derives every active currency from the base, and leaves an override alone", () => {
    const derived = deriveAmounts(book(), plan());
    expect(derived).toEqual({ INR: 99900, USD: 1198 });

    const typed = deriveAmounts(book(), plan({ overrides: ["USD"] }));
    expect(typed.USD).toBe(1200);
  });

  it("moves every derived price when a rate moves, and no overridden one", () => {
    const b = book({
      fx: [
        { currency: "INR", rate: 1, source: "manual", updatedAt: "x" },
        { currency: "USD", rate: 0.02, source: "manual", updatedAt: "x" },
      ],
    });
    expect(deriveAmounts(b, plan()).USD).toBe(1998);
    expect(deriveAmounts(b, plan({ overrides: ["USD"] })).USD).toBe(1200);
  });

  it("keeps an inactive currency's stored price instead of dropping or deriving it", () => {
    const withAed = plan({ amounts: { INR: 99900, USD: 1200, AED: 4400 } });
    expect(deriveAmounts(book(), withAed).AED).toBe(4400);
  });
});

describe("GST at 18 %", () => {
  it("applies the configured rate to the base currency", () => {
    expect(gstMinor(99900, 18)).toBe(17982); // ₹999 → ₹179.82
    expect(gstMinor(2000000, 18)).toBe(360000); // ₹20,000 → ₹3,600
  });

  it("adds GST at checkout by default — the sticker price is net", () => {
    const split = taxBreakdown(99900, "INR", book().tax);
    expect(split).toEqual({ netMinor: 99900, taxMinor: 17982, grossMinor: 117882, taxed: true });
  });

  it("extracts GST from the sticker price when prices are shown inclusive", () => {
    const tax = { ...book().tax, pricesIncludeGst: true };
    const split = taxBreakdown(117882, "INR", tax);
    expect(split.grossMinor).toBe(117882);
    expect(split.netMinor).toBe(99900);
    expect(split.taxMinor).toBe(17982);
  });

  it("never applies GST to an international price", () => {
    expect(taxBreakdown(1200, "USD", book().tax)).toEqual({
      netMinor: 1200,
      taxMinor: 0,
      grossMinor: 1200,
      taxed: false,
    });
  });

  it("honours a rate that is not 18", () => {
    expect(gstMinor(100000, 5)).toBe(5000);
    expect(taxBreakdown(100000, "INR", { ...book().tax, gstRatePct: 0 }).taxMinor).toBe(0);
  });
});

describe("formatting", () => {
  it("prints whole prices whole and taxed prices to the paisa", () => {
    expect(formatMinor(2000000, "₹")).toBe("₹20,000");
    expect(formatMinor(117882, "₹")).toBe("₹1,178.82");
    expect(formatMinor(1198, "$")).toBe("$11.98");
  });
});

describe("§8 Q1 — no per-deck pricing survives in a catalogue", () => {
  it("finds nothing in a catalogue built under the ruling", () => {
    expect(perDeckArtefacts(book())).toEqual([]);
  });

  it("catches a per-deck rate smuggled back in as copy", () => {
    const smuggled = book({ plans: [plan({ features: "₹500/deck · pay per use" })] });
    expect(perDeckArtefacts(smuggled)).toHaveLength(1);
    expect(perDeckArtefacts(smuggled)[0]).toContain("per-deck figure");
    // …and validation refuses the whole book, which is what the publish path uses.
    expect(validatePriceBook(smuggled).length).toBeGreaterThan(0);
  });

  it("catches the prototype's own derived phrasings", () => {
    expect(perDeckArtefacts(book({ plans: [plan({ tagline: "Per-deck rate shown" })] }))).toHaveLength(1);
    expect(
      perDeckArtefacts(book({ plans: [plan({ features: "Save ₹10,000 vs base" })] })),
    ).toHaveLength(1);
  });

  it("does not mistake a deck allowance for a per-deck rate", () => {
    expect(perDeckArtefacts(book({ plans: [plan({ features: "20 decks/mo · All 13 areas" })] }))).toEqual(
      [],
    );
  });

  it("has no field a per-deck rate or a saving percentage could live in", () => {
    // `trial.decks` is an allowance, not a price — the ruling is about what a
    // deck COSTS, so the check is on field names, not on the word "deck".
    const fields = new Set<string>();
    const walk = (value: unknown) => {
      if (Array.isArray(value)) return value.forEach(walk);
      if (value && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) {
          fields.add(key);
          walk(child);
        }
      }
    };
    walk(book());
    for (const field of fields) {
      expect(field).not.toMatch(/perdeck|per_deck|saving/i);
    }
  });
});

describe("validation", () => {
  it("passes a well-formed book", () => {
    expect(validatePriceBook(book())).toEqual([]);
  });

  it("refuses an active currency with no exchange rate", () => {
    const b = book({
      currencies: [
        { code: "INR", symbol: "₹", flag: "🇮🇳", active: true, sortOrder: 1 },
        { code: "AED", symbol: "د.إ", flag: "🇦🇪", active: true, sortOrder: 5 },
      ],
    });
    expect(validatePriceBook(b).join(" ")).toContain("AED is active but has no exchange rate");
  });

  it("refuses a deactivated base currency and an impossible GST rate", () => {
    const b = book();
    b.currencies[0].active = false;
    b.tax.gstRatePct = 180;
    const errors = validatePriceBook(b).join(" ");
    expect(errors).toContain("cannot be inactive");
    expect(errors).toContain("between 0 and 100");
  });

  it("refuses a fractional or negative amount — money is whole minor units", () => {
    expect(
      validatePriceBook(book({ plans: [plan({ amounts: { INR: 999.5 } })] })).join(" "),
    ).toContain("whole number of minor units");
    expect(validatePriceBook(book({ plans: [plan({ amounts: { INR: -1 } })] })).join(" ")).toContain(
      "whole number of minor units",
    );
  });
});

describe("the listed catalogue", () => {
  it("drops an inactive plan and honours the free trial's visibility switch", () => {
    const trial = plan({ id: "pp_trial", code: "free_trial", group: "free_trial", amounts: { INR: 0 } });
    const b = book({ plans: [trial, plan(), plan({ id: "pp_pro", code: "pro", active: false })] });
    expect(listedPlans(b).map((p) => p.code)).toEqual(["free_trial", "standard"]);

    const hidden = { ...b, trial: { ...b.trial, showOnPricingPage: false } };
    expect(listedPlans(hidden).map((p) => p.code)).toEqual(["standard"]);
  });
});

describe("comparison", () => {
  it("is insensitive to row order and key order, and sensitive to a price", () => {
    const a = book();
    const shuffled = normalisePriceBook({ ...book(), fx: [...book().fx].reverse() });
    expect(priceBooksEqual(a, shuffled)).toBe(true);
    expect(priceBooksEqual(a, book({ plans: [plan({ amounts: { INR: 99800, USD: 1200 } })] }))).toBe(
      false,
    );
  });
});
