import { describe, it, expect } from "vitest";
import {
  billingCycle,
  creditsUsedBetween,
  creditsUsedInMonth,
  formatMinor,
  hasPerDeckDerivation,
  multiplyMinor,
  priceBreakdown,
  publishablePlans,
  taxFromInclusive,
  taxOnExclusive,
  withoutPerDeckDerivation,
  type PublishedPlan,
  type TaxSettings,
} from "../../src/shared/plans";

/**
 * W4-C — the arithmetic behind Credits & billing.
 *
 * This is the half of the session that is real money, so these are the
 * assertions that matter most: the tax rounds one stated way at 18 %, an
 * inclusive price always splits into parts that add back to exactly the price
 * the customer was shown, and nothing anywhere reintroduces the per-deck rate
 * §8 Q1 retired.
 */

const EXCLUSIVE: TaxSettings = {
  ratePct: 18,
  registration: "29ABCDE1234F1Z5",
  inclusive: false,
  internationalNotice: true,
};

describe("GST at 18 %", () => {
  it("adds tax to a whole-rupee pack exactly", () => {
    // ₹20,000 → ₹3,600 → ₹23,600. The catalogue's prices are whole rupees, so
    // the common case has no rounding to get wrong.
    expect(taxOnExclusive(2_000_000, 18)).toEqual({
      subtotalMinor: 2_000_000,
      taxMinor: 360_000,
      totalMinor: 2_360_000,
      ratePct: 18,
      inclusive: false,
    });
  });

  it("keeps the paise on an amount whose 18 % is not whole rupees", () => {
    // ₹999 → ₹179.82. The prototype floors this to ₹179 in one flow and rounds
    // it in another (§8); paise are kept here, because an invoice line means
    // 18 % of the price, not 18 % rounded to the nearest rupee.
    const t = taxOnExclusive(99_900, 18);
    expect(t.taxMinor).toBe(17_982);
    expect(t.totalMinor).toBe(117_882);
    expect(formatMinor(t.totalMinor, "INR")).toBe("₹1,178.82");
  });

  it("rounds half UP at the minor unit, and only there", () => {
    // ₹0.25 × 18 % = 0.045 paise short of 5 — exactly the .5 boundary.
    expect(taxOnExclusive(25, 18).taxMinor).toBe(5);
    // 0.18 paise rounds down to 0; the house never collects a fraction it is
    // not owed, and the customer is never charged one.
    expect(taxOnExclusive(1, 18).taxMinor).toBe(0);
    // 2.7 paise → 3.
    expect(taxOnExclusive(15, 18).taxMinor).toBe(3);
  });

  it("is integer-only — no float residue at any scale", () => {
    for (const minor of [1, 7, 25, 99_900, 2_000_000, 800_000_000]) {
      const t = taxOnExclusive(minor, 18);
      expect(Number.isInteger(t.taxMinor)).toBe(true);
      expect(Number.isInteger(t.totalMinor)).toBe(true);
      expect(t.subtotalMinor + t.taxMinor).toBe(t.totalMinor);
    }
  });

  it("handles a fractional rate without floats leaking in", () => {
    // 18.5 % of ₹1,000 = ₹185.
    expect(taxOnExclusive(100_000, 18.5).taxMinor).toBe(18_500);
  });

  it("charges nothing at a 0 % rate", () => {
    expect(taxOnExclusive(500_000, 0)).toMatchObject({
      taxMinor: 0,
      totalMinor: 500_000,
    });
  });

  it("refuses to invent a negative amount", () => {
    expect(taxOnExclusive(-500, 18)).toMatchObject({
      subtotalMinor: 0,
      taxMinor: 0,
    });
  });
});

describe("GST extracted from an inclusive price", () => {
  it("splits ₹118 into ₹100 + ₹18", () => {
    expect(taxFromInclusive(11_800, 18)).toEqual({
      subtotalMinor: 10_000,
      taxMinor: 1_800,
      totalMinor: 11_800,
      ratePct: 18,
      inclusive: true,
    });
  });

  it("always adds back to the price the customer was shown", () => {
    // The property that an invoice cannot be allowed to fail: whatever the
    // rounding does to the halves, the parts sum to the stated total.
    for (let minor = 1; minor <= 4_000; minor += 7) {
      const t = taxFromInclusive(minor, 18);
      expect(t.subtotalMinor + t.taxMinor).toBe(minor);
      expect(t.subtotalMinor).toBeGreaterThanOrEqual(0);
      expect(t.taxMinor).toBeGreaterThanOrEqual(0);
    }
  });

  it("is what priceBreakdown picks when the org prices inclusively", () => {
    expect(priceBreakdown(11_800, { ...EXCLUSIVE, inclusive: true })).toMatchObject({
      subtotalMinor: 10_000,
      taxMinor: 1_800,
    });
    expect(priceBreakdown(10_000, EXCLUSIVE)).toMatchObject({
      subtotalMinor: 10_000,
      taxMinor: 1_800,
    });
  });
});

describe("quantity and formatting", () => {
  it("multiplies in integers", () => {
    expect(multiplyMinor(2_000_000, 3)).toBe(6_000_000);
    expect(multiplyMinor(2_000_000, 0)).toBe(0);
    expect(multiplyMinor(2_000_000, -4)).toBe(0);
  });

  it("prints paise only when there are any", () => {
    expect(formatMinor(2_000_000, "INR")).toBe("₹20,000");
    expect(formatMinor(117_882, "INR")).toBe("₹1,178.82");
    expect(formatMinor(360_000, "INR")).toBe("₹3,600");
    expect(formatMinor(24_000, "USD")).toBe("$240");
    expect(formatMinor(-99_900, "INR")).toBe("−₹999");
  });
});

describe("§8 Q1 — no per-deck rate survives publishing", () => {
  it("recognises a derivation however it is spelled", () => {
    for (const text of [
      "₹400/deck",
      "₹500 per deck",
      "Save ₹10,000 vs base",
      "Save ₹50,000 vs base · ₹400/deck",
      "20% saving on the base rate",
      "1 credit = 1 deck. Effective rate: ₹500/deck",
    ]) {
      expect(hasPerDeckDerivation(text), text).toBe(true);
      expect(withoutPerDeckDerivation(text)).toBeNull();
    }
  });

  it("leaves honest copy alone", () => {
    for (const text of [
      "Most popular",
      "One-time purchase · Credits never expire",
      "Priority WhatsApp support · Up to 10 evaluators",
      "25 seats (5 Premium + 20 Pro)",
    ]) {
      expect(hasPerDeckDerivation(text), text).toBe(false);
      expect(withoutPerDeckDerivation(text)).toBe(text);
    }
  });

  it("drops the base-rate pseudo-plan and strips derived strings", () => {
    const plan = (over: Partial<PublishedPlan>): PublishedPlan => ({
      code: "pack_50",
      group: "credit_pack",
      name: "50-unit pack",
      badge: "Most popular",
      tagline: null,
      features: null,
      units: 50,
      period: "one_time",
      currency: "INR",
      amountMinor: 2_000_000,
      ...over,
    });
    const published = publishablePlans([
      plan({
        code: "base_rate",
        name: "Base rate",
        units: 1,
        amountMinor: 50_000,
      }),
      plan({
        features: "Priority WhatsApp support",
        tagline: "Save ₹10,000 vs base",
      }),
      plan({
        code: "ent_500",
        group: "enterprise",
        tagline: "Best value · ₹400/deck",
      }),
    ]);
    expect(published.map((p) => p.code)).toEqual(["pack_50", "ent_500"]);
    expect(published[0].tagline).toBeNull();
    expect(published[0].features).toBe("Priority WhatsApp support");
    expect(published[1].tagline).toBeNull();
    // No published string anywhere may state a rate per deck.
    for (const p of published) {
      for (const text of [p.name, p.badge, p.tagline, p.features]) {
        expect(hasPerDeckDerivation(text)).toBe(false);
      }
    }
  });
});

describe("the billing cycle", () => {
  it("finds the annual cycle containing today", () => {
    expect(billingCycle("2026-01-01", "year", new Date("2026-09-11T00:00:00Z"))).toEqual({
      start: "2026-01-01",
      end: "2026-12-31",
      renewsOn: "2027-01-01",
      period: "year",
    });
  });

  it("finds the monthly cycle containing today", () => {
    expect(billingCycle("2026-06-04", "month", new Date("2026-09-11T00:00:00Z"))).toMatchObject({
      start: "2026-09-04",
      end: "2026-10-03",
      renewsOn: "2026-10-04",
    });
  });

  it("treats the anchor day itself as the first day of the new cycle", () => {
    expect(billingCycle("2026-06-04", "month", new Date("2026-09-04T00:00:00Z"))).toMatchObject({
      start: "2026-09-04",
      renewsOn: "2026-10-04",
    });
    expect(billingCycle("2026-06-04", "month", new Date("2026-09-03T00:00:00Z"))).toMatchObject({
      start: "2026-08-04",
      renewsOn: "2026-09-04",
    });
  });

  it("clamps a 31st anchor to short months instead of rolling over", () => {
    // February has no 31st. The cycle starts on the 28th, not 3 March, which
    // would silently shorten the customer's month.
    expect(billingCycle("2026-01-31", "month", new Date("2026-02-14T00:00:00Z"))).toMatchObject({
      start: "2026-01-31",
      end: "2026-02-27",
      renewsOn: "2026-02-28",
    });
    expect(billingCycle("2026-01-31", "month", new Date("2026-03-01T00:00:00Z"))).toMatchObject({
      start: "2026-02-28",
      renewsOn: "2026-03-31",
    });
  });

  it("handles 29 February in a leap year", () => {
    expect(billingCycle("2024-01-31", "month", new Date("2024-02-29T00:00:00Z"))).toMatchObject({
      start: "2024-02-29",
      renewsOn: "2024-03-31",
    });
  });

  it("works when today is before the anchor", () => {
    expect(billingCycle("2026-06-01", "month", new Date("2026-03-15T00:00:00Z"))).toMatchObject({
      start: "2026-03-01",
      renewsOn: "2026-04-01",
    });
  });

  it("survives a nonsense anchor rather than throwing", () => {
    const c = billingCycle("not-a-date", "year", new Date("2026-09-11T00:00:00Z"));
    expect(c.start).toMatch(/^\d{4}-01-01$/);
  });
});

describe("credits used", () => {
  const entries = [
    { delta: 3, createdAt: "2026-05-28 09:00:00" },
    { delta: 50, createdAt: "2026-06-03 16:20:00" },
    { delta: -1, createdAt: "2026-06-04 10:02:00" },
    { delta: -1, createdAt: "2026-06-03 10:02:00" },
    { delta: -1, createdAt: "2026-06-02 10:02:00" },
    { delta: -1, createdAt: "2026-09-02 10:02:00" },
  ];

  it("counts only debits inside the window", () => {
    expect(creditsUsedBetween(entries, "2026-06-01", "2026-06-30")).toBe(3);
    expect(creditsUsedBetween(entries, "2026-01-01", "2026-12-31")).toBe(4);
    expect(creditsUsedBetween(entries, "2026-07-01", "2026-07-31")).toBe(0);
  });

  it("counts the calendar month, which is what the tile says", () => {
    expect(creditsUsedInMonth(entries, new Date("2026-09-11T00:00:00Z"))).toBe(1);
    expect(creditsUsedInMonth(entries, new Date("2026-06-30T00:00:00Z"))).toBe(3);
    expect(creditsUsedInMonth(entries, new Date("2026-07-01T00:00:00Z"))).toBe(0);
  });
});
