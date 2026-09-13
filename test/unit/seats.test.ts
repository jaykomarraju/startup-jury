import { describe, it, expect } from "vitest";
import {
  countByTier,
  describeSeatOrder,
  holdsSeat,
  initialsFromEmail,
  isSeatOrderError,
  nameFromEmail,
  seatOrder,
  seatPricesFromBook,
  seatRefusal,
  seatSummary,
  taxSettingsFromBook,
  tierMoveRefusal,
  type SeatOrder,
  type SeatPrice,
  type SeatTier,
} from "../../src/shared/seats";
import { priceBreakdown, type TaxSettings } from "../../src/shared/plans";
import type { PricePlanRow } from "../../src/shared/priceBook";

/**
 * W6-C — the purchased seat's arithmetic, and the GST on a seat order.
 *
 * Tax is `priceBreakdown` from `src/shared/plans.ts`. These tests assert the
 * seat order agrees with it, not with a rate of their own — a second tax
 * calculation is precisely what Wave 4 integration had to delete (§8 Q55).
 */

const GST: TaxSettings = { ratePct: 18, registration: null, inclusive: false, internationalNotice: true };

function plan(over: Partial<PricePlanRow>): PricePlanRow {
  return {
    id: `pp_${over.code}`,
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
    amounts: { INR: 99_900, USD: 1_200 },
    overrides: [],
    ...over,
  };
}

const BOOK = {
  plans: [
    plan({ code: "standard", name: "Standard", amounts: { INR: 99_900, USD: 1_200 } }),
    plan({ code: "pro", name: "Pro", amounts: { INR: 199_900, USD: 2_400 } }),
    // A credit pack named like a tier is NOT a seat.
    plan({ code: "premium", group: "credit_pack", name: "Premium pack", amounts: { INR: 500_000 } }),
  ],
};

const counts = (standard: number, pro: number, premium: number) => ({ standard, pro, premium });

describe("seat capacity", () => {
  it("counts per tier, reports availability and floors it at zero", () => {
    const s = seatSummary(counts(5, 20, 5), counts(2, 20, 6));
    expect(s.tiers.standard).toEqual({ tier: "standard", capacity: 5, used: 2, available: 3, over: 0 });
    expect(s.tiers.pro).toEqual({ tier: "pro", capacity: 20, used: 20, available: 0, over: 0 });
    expect(s.tiers.premium).toEqual({ tier: "premium", capacity: 5, used: 6, available: 0, over: 1 });
    // "Seats left" is the free seats a member could be added into — three
    // Standard — not capacity − users (2), which an over-full tier would skew.
    expect(s).toMatchObject({ capacity: 30, used: 28, left: 3, over: 1 });
  });

  it("'seats left' never goes negative, and equals capacity − users when no tier is over", () => {
    expect(seatSummary(counts(1, 0, 0), counts(3, 0, 0)).left).toBe(0);
    const s = seatSummary(counts(5, 20, 5), counts(2, 1, 1));
    expect(s.left).toBe(s.capacity - s.used);
  });

  it("refuses the member at capacity and admits the one below it", () => {
    const below = seatSummary(counts(2, 0, 0), counts(1, 0, 0));
    expect(seatRefusal(below, "standard")).toBeNull();
    const at = seatSummary(counts(2, 0, 0), counts(2, 0, 0));
    expect(seatRefusal(at, "standard")).toEqual({
      error: "seat_limit_reached",
      tier: "standard",
      capacity: 2,
      used: 2,
      message: "No Standard seats left — buy a Standard seat below, then add this user.",
    });
    // A free seat in ANOTHER tier does not help: seats are capped per tier.
    expect(seatRefusal(seatSummary(counts(2, 9, 0), counts(2, 0, 0)), "standard")?.error).toBe("seat_limit_reached");
  });

  it("a tier move needs a free seat in the destination and nothing in the source", () => {
    const s = seatSummary(counts(0, 1, 0), counts(0, 1, 0));
    expect(tierMoveRefusal(s, "pro", "pro")).toBeNull();
    expect(tierMoveRefusal(s, "pro", "standard")?.tier).toBe("standard");
    expect(tierMoveRefusal(seatSummary(counts(1, 1, 0), counts(0, 1, 0)), "pro", "standard")).toBeNull();
  });

  it("buying N seats raises that tier's capacity by exactly N", () => {
    const before = seatSummary(counts(1, 3, 1), counts(1, 3, 1));
    const after = seatSummary(counts(1 + 2, 3, 1), counts(1, 3, 1));
    expect(after.tiers.standard.capacity - before.tiers.standard.capacity).toBe(2);
    expect(after.capacity - before.capacity).toBe(2);
    expect(seatRefusal(before, "standard")).not.toBeNull();
    expect(seatRefusal(after, "standard")).toBeNull();
  });

  it("only live staff hold a seat", () => {
    expect(holdsSeat({ role: "jury", userType: "staff", deleted: false })).toBe(true);
    expect(holdsSeat({ role: "founder", userType: "staff", deleted: false })).toBe(false);
    expect(holdsSeat({ role: "mentor", userType: "mentor", deleted: false })).toBe(false);
    expect(holdsSeat({ role: "jury", userType: "staff", deleted: true })).toBe(false);
    expect(countByTier([{ tier: "pro" }, { tier: "pro" }, { tier: "standard" }])).toEqual(counts(1, 2, 0));
  });
});

describe("seat prices come from the catalogue", () => {
  it("reads each tier from its active per-seat subscription plan, in the billing currency", () => {
    const inr = seatPricesFromBook(BOOK, "INR");
    expect(inr.standard).toEqual({ tier: "standard", code: "standard", name: "Standard", currency: "INR", amountMinor: 99_900, period: "month" });
    expect(inr.pro?.amountMinor).toBe(199_900);
    // No subscription plan is coded `premium`: not purchasable, not invented.
    expect(inr.premium).toBeNull();
    expect(seatPricesFromBook(BOOK, "USD").pro?.amountMinor).toBe(2_400);
    // A currency the plan has no amount in sells nothing.
    expect(seatPricesFromBook(BOOK, "GBP").standard).toBeNull();
  });

  it("an inactive plan is not a price, and no book is no prices", () => {
    const off = { plans: [plan({ code: "pro", active: false, amounts: { INR: 199_900 } })] };
    expect(seatPricesFromBook(off, "INR").pro).toBeNull();
    expect(seatPricesFromBook(null, "INR")).toEqual({ standard: null, pro: null, premium: null });
  });

  it("maps the published tax block onto the shape priceBreakdown takes", () => {
    expect(
      taxSettingsFromBook({ tax: { gstRatePct: 18, gstRegistration: "29ABCDE1234F1Z5", pricesIncludeGst: false, showInternationalTaxNotice: true } }),
    ).toEqual({ ratePct: 18, registration: "29ABCDE1234F1Z5", inclusive: false, internationalNotice: true });
  });
});

describe("a seat order", () => {
  const INR = seatPricesFromBook(BOOK, "INR");

  function order(q: Partial<Record<SeatTier, number>>, tax = GST, currency = "INR", prices = INR): SeatOrder {
    const o = seatOrder(q, prices, tax, currency);
    if (isSeatOrderError(o)) throw new Error(JSON.stringify(o));
    return o;
  }

  it("prices each line from the catalogue and taxes the order total through priceBreakdown", () => {
    const o = order({ standard: 2, pro: 1 });
    expect(o.lines).toEqual([
      { tier: "pro", name: "Pro", quantity: 1, unitMinor: 199_900, amountMinor: 199_900, period: "month" },
      { tier: "standard", name: "Standard", quantity: 2, unitMinor: 99_900, amountMinor: 199_800, period: "month" },
    ]);
    expect(o.seats).toBe(3);
    expect(o.statedMinor).toBe(399_700);
    // The breakdown IS priceBreakdown's — the same call, the same answer.
    expect(o.money).toEqual(priceBreakdown(399_700, GST, "INR"));
    // ₹3,997 + 18 % = ₹4,716.46
    expect(o.money).toMatchObject({ subtotalMinor: 399_700, taxMinor: 71_946, totalMinor: 471_646, taxed: true });
    expect(o.period).toBe("month");
    expect(describeSeatOrder(o)).toBe("1 × Pro, 2 × Standard");
  });

  it("a non-INR order carries NO GST", () => {
    const o = order({ pro: 2 }, GST, "USD", seatPricesFromBook(BOOK, "USD"));
    expect(o.money).toEqual({ subtotalMinor: 4_800, taxMinor: 0, totalMinor: 4_800, ratePct: 18, inclusive: false, taxed: false });
  });

  it("GST-inclusive pricing holds the total and extracts the tax", () => {
    const o = order({ standard: 1 }, { ...GST, inclusive: true });
    expect(o.money.totalMinor).toBe(99_900);
    expect(o.money.subtotalMinor + o.money.taxMinor).toBe(99_900);
    expect(o.money.inclusive).toBe(true);
  });

  it("refuses what it cannot price or count", () => {
    expect(seatOrder({ premium: 1 }, INR, GST, "INR")).toEqual({ error: "tier_not_purchasable", tier: "premium" });
    expect(seatOrder({}, INR, GST, "INR")).toEqual({ error: "no_seats_selected" });
    expect(seatOrder({ standard: 0, pro: 0 }, INR, GST, "INR")).toEqual({ error: "no_seats_selected" });
    expect(seatOrder(undefined, INR, GST, "INR")).toEqual({ error: "no_seats_selected" });
    expect(seatOrder({ standard: 21 }, INR, GST, "INR")).toEqual({ error: "invalid_quantity", tier: "standard" });
    expect(seatOrder({ standard: -1 }, INR, GST, "INR")).toEqual({ error: "invalid_quantity", tier: "standard" });
    expect(seatOrder({ standard: "2x" }, INR, GST, "INR")).toEqual({ error: "invalid_quantity", tier: "standard" });
    expect(seatOrder({ gold: 1 }, INR, GST, "INR")).toEqual({ error: "invalid_quantity", tier: "gold" });
    // A price quoted in another currency is not a price in this one.
    const usdPrices: Record<SeatTier, SeatPrice | null> = seatPricesFromBook(BOOK, "USD");
    expect(seatOrder({ pro: 1 }, usdPrices, GST, "INR")).toEqual({ error: "tier_not_purchasable", tier: "pro" });
  });

  it("the prototype's quantity range is 0 – 20 per tier", () => {
    expect(isSeatOrderError(seatOrder({ standard: 20 }, INR, GST, "INR"))).toBe(false);
  });
});

describe("the prototype's roster helpers", () => {
  it("derive a name and initials from an address", () => {
    expect(nameFromEmail("meera.sharma@firm.com")).toBe("Meera Sharma");
    expect(nameFromEmail("vikram_nair-2@firm.com")).toBe("Vikram Nair 2");
    expect(initialsFromEmail("priya.sharma@company.com")).toBe("PS");
    expect(initialsFromEmail("rhea@firm.com")).toBe("RH");
  });
});
