import { describe, it, expect } from "vitest";
import {
  ANNUAL_SEAT_MONTHS,
  BILLING_COUNTRIES,
  SEAT_STORAGE_GB,
  TEAM_SEAT_TIERS,
  annualCartQuote,
  initialAnnualCart,
  planScreenFor,
  stepperFor,
  teamInitials,
  teamSeatLabel,
  teamSeatsFull,
  validateSuperUser,
  type AnnualCart,
} from "../../src/shared/accountOrder";
import { validateBillingAddress } from "../../src/shared/plans";
import { seatPlanFor } from "../../src/shared/priceBook";
import { catalogueFixture } from "./fixtures/accountCatalogue";

/**
 * **My Account V6** — `docs/prototype/source/incubator/AISJ_MyAccount_V6.HTM`,
 * the five screens it adds and the one it appears to drop.
 *
 * Everything asserted here is read off that file: the stepper maps from
 * `setSteps()`, the Billing rule from `acBillingValidate()`, the seat ceilings
 * from `AET_PLANS`, the cart's shape from `annTotal()`. No price is written in
 * this file either — the catalogue fixture is the source, so a figure that
 * moves there moves the assertion with it.
 */

const book = catalogueFixture();

describe("V6 · the stepper learns five screens", () => {
  it("puts `super` on Org details and `billing` on Payment, per `setSteps()`", () => {
    // V6: enterprise `{… orgdetails:2, super:2, … billing:4, payment:4, success:5}`.
    const labels = stepperFor("organization", "super").map((s) => s.label);
    expect(stepperFor("organization", "super")[2].state).toBe("active");
    expect(labels[2]).toBe("Org details");
    expect(stepperFor("organization", "billing")[4].state).toBe("active");
    expect(stepperFor("organization", "billing")[4].label).toBe("Payment");
  });

  it("keeps the annual and Enterprise-bundle screens on the individual's middle step", () => {
    // V6: individual `{account:0, plan:1, … annual:1, entplans:1, super:2, billing:2 …}`.
    for (const screen of ["annual", "entplans"] as const) {
      const steps = stepperFor("individual", screen, true);
      expect(steps[1].state, screen).toBe("active");
      expect(steps[1].label, screen).toBe("Seat & pricing");
    }
    expect(stepperFor("individual", "billing", true)[2].state).toBe("active");
  });

  it("gives `team` the last step rather than V6's stepper with nothing active", () => {
    // `team` is in V6's `SCREENS` and in NEITHER of its two index maps, so the
    // mockup renders every step "todo" there. It is the post-purchase step.
    const steps = stepperFor("organization", "team");
    expect(steps[5].state).toBe("active");
    expect(steps.some((s) => s.state === "todo")).toBe(false);
  });

  it("has NOT dropped `orgplan` — the VC organisation branch still lands on it", () => {
    // V6 deletes the `#acs-orgplan` markup but keeps its whole driver, and this
    // build still reaches it where `seatFlow` is false (the VC edition, which
    // the client put out of scope on 2026-10-01). Deleting it would strand that
    // branch, so this guard fails if a later sweep removes it.
    expect(planScreenFor("organization", "enterprise")).toBe("orgplan");
    expect(stepperFor("organization", "orgplan")[3].state).toBe("active");
  });
});

describe("V6 · `#acs-billing` — the datalist this lane owns", () => {
  it("carries V6's nine suggestions, in the mockup's order", () => {
    // `#bill-country-list`, verbatim. The address, its validation and the
    // currency it implies all live in `src/shared/plans.ts` (the V6-CURRENCY
    // lane) and are tested there — this lane owns only the field's suggestions.
    expect([...BILLING_COUNTRIES]).toEqual([
      "India",
      "United States",
      "United Kingdom",
      "United Arab Emirates",
      "Singapore",
      "Canada",
      "Australia",
      "Germany",
      "Other",
    ]);
  });

  it("is a hint, not an allow-list — a country off it still validates", () => {
    // V6's `#bill-country` is an `<input list=…>`, not a `<select>`, so a
    // customer in Kenya must still be billable. If a later change turns the
    // field into a `<select>` over this list, that is a behaviour change and
    // this assertion is what should have to be deleted first.
    expect(BILLING_COUNTRIES).not.toContain("Kenya");
    expect(validateBillingAddress({ name: "A", city: "Nairobi", country: "Kenya", address: "x" })).toEqual({});
  });
});

describe("V6 · `#acs-super` — the top account authority", () => {
  it("rejects a personal mailbox for the account that manages billing", () => {
    // V6 checks only that the field is non-blank. Its own hint is "They'll log
    // in with this email", and every other email field in this wizard refuses a
    // consumer mailbox, so this one does too.
    expect(validateSuperUser({ name: "Priya Sharma", email: "priya@company.com" })).toEqual({});
    expect(validateSuperUser({ name: "Priya Sharma", email: "priya@gmail.com" }).email).toMatch(/Personal email/);
    expect(validateSuperUser({ name: "", email: "priya@company.com" }).name).toMatch(/full name/);
  });
});

describe("V6 · `#acs-team` — three seat tiers in the mockup's own words", () => {
  it("holds the ceilings `AET_PLANS` states: 3, 5 and unlimited", () => {
    expect(TEAM_SEAT_TIERS.map((t) => t.pill)).toEqual([
      "Basic (3 seats)",
      "Configurable (5 seats)",
      "Customisable (unlimited)",
    ]);
    expect(TEAM_SEAT_TIERS.map((t) => t.seats)).toEqual([3, 5, null]);
  });

  it("fills up at the ceiling, and never on the unlimited tier", () => {
    // `aetSeatsFull()`: `p.seats!==Infinity && aetMembers.length>=p.seats`.
    expect(teamSeatsFull("basic", 2)).toBe(false);
    expect(teamSeatsFull("basic", 3)).toBe(true);
    expect(teamSeatsFull("configurable", 3)).toBe(false);
    expect(teamSeatsFull("customisable", 500)).toBe(false);
    expect(teamSeatLabel("basic", 2)).toBe("2 / 3 seats used");
    expect(teamSeatLabel("customisable", 2)).toBe("Unlimited seats");
  });

  it("initials come from the local part, split on dot, underscore or dash", () => {
    expect(teamInitials("meera.sharma@vcfirm.com")).toBe("MS");
    expect(teamInitials("rajesh_kumar@vcfirm.com")).toBe("RK");
    expect(teamInitials("ops@vcfirm.com")).toBe("OP");
  });
});

describe("V6 · `#acs-annual` — the cart, priced from the catalogue", () => {
  const premium = seatPlanFor(book, "premium", ANNUAL_SEAT_MONTHS)!;
  const standard = seatPlanFor(book, "standard", ANNUAL_SEAT_MONTHS)!;

  it("starts at one Premium seat and prices it from the catalogue row, taxed once", () => {
    const quote = annualCartQuote(book, initialAnnualCart(), "INR");
    expect(quote.seatsTotal).toBe(1);
    expect(quote.subtotalMinor).toBe(premium.amounts.INR);
    expect(quote.lines.map((l) => l.key)).toEqual(["seat_premium"]);
    // 10 GB per seat, stated on the row, on every tier alike.
    expect(quote.lines[0].label).toContain(`${SEAT_STORAGE_GB} GB storage`);
    // The ONE tax rule: the catalogue's 18 %, applied by `priceBreakdown`.
    expect(quote.breakdown.taxed).toBe(true);
    expect(quote.breakdown.ratePct).toBe(book.tax.gstRatePct);
    expect(quote.breakdown.taxMinor).toBe(Math.round((premium.amounts.INR * 18) / 100));
    expect(quote.order).toEqual({ planCode: premium.code, quantity: 1, extraCredits: 0 });
  });

  it("multiplies the catalogue row by the quantity the stepper holds", () => {
    const cart: AnnualCart = { seats: { standard: 0, pro: 0, premium: 3 }, extraCredits: 0 };
    const quote = annualCartQuote(book, cart, "INR");
    expect(quote.subtotalMinor).toBe(premium.amounts.INR * 3);
    expect(quote.unitsTotal).toBe(premium.units! * 3);
    expect(quote.order).toEqual({ planCode: premium.code, quantity: 3, extraCredits: 0 });
  });

  it("refuses to reduce a two-tier cart to one order, and says which limit bit", () => {
    // `POST /api/account/orders` carries ONE `planCode` and re-prices it. A cart
    // holding a Standard seat AND a Premium seat is two catalogue rows, so there
    // is no code that describes it — sending either one would charge the wrong
    // money for the other. The cart still PRICES, so the screen can show it.
    const cart: AnnualCart = { seats: { standard: 2, pro: 0, premium: 1 }, extraCredits: 0 };
    const quote = annualCartQuote(book, cart, "INR");
    expect(quote.subtotalMinor).toBe(standard.amounts.INR * 2 + premium.amounts.INR);
    expect(quote.lines.map((l) => l.key)).toEqual(["seat_standard", "seat_premium"]);
    expect(quote.blocked).toBe("mixed_tiers");
    expect(quote.order).toBeNull();
  });

  it("drops a tier the catalogue does not price in this currency", () => {
    // `pack_100` has no GBP amount in the fixture; the seat rows all do, so
    // this is proved the other way round — an unlisted row is skipped, never
    // priced at zero. `0` amounts are the shape a withdrawn SKU has.
    const noGbp = {
      ...book,
      plans: book.plans.map((p) => (p.code === standard.code ? { ...p, amounts: { ...p.amounts, GBP: 0 } } : p)),
    };
    const cart: AnnualCart = { seats: { standard: 2, pro: 0, premium: 1 }, extraCredits: 0 };
    const quote = annualCartQuote(noGbp, cart, "GBP");
    expect(quote.lines.map((l) => l.key)).toEqual(["seat_premium"]);
    expect(quote.subtotalMinor).toBe(premium.amounts.GBP);
    // One priced row left, so it IS orderable — the blocked state is about the
    // rows that priced, not the ones the customer asked for.
    expect(quote.blocked).toBeNull();
  });

  it("prices extra credits at the derived rate and counts them into the decks", () => {
    // The rate is the Premium ANNUAL seat over its own included decks, exactly
    // as `extraCreditRate` derives it — never a literal.
    const rate = premium.amounts.INR / premium.units!;
    const cart: AnnualCart = { seats: { standard: 0, pro: 0, premium: 1 }, extraCredits: 125 };
    const quote = annualCartQuote(book, cart, "INR");
    expect(quote.extraMinor).toBe(Math.round(rate * 125));
    expect(quote.subtotalMinor).toBe(premium.amounts.INR + Math.round(rate * 125));
    expect(quote.unitsTotal).toBe(premium.units! + 125);
    expect(quote.order).toEqual({ planCode: premium.code, quantity: 1, extraCredits: 125 });
  });

  it("has nothing to order when every seat count is zero", () => {
    const quote = annualCartQuote(book, { seats: { standard: 0, pro: 0, premium: 0 }, extraCredits: 0 }, "INR");
    expect(quote.subtotalMinor).toBe(0);
    expect(quote.blocked).toBe("nothing_priced");
    expect(quote.order).toBeNull();
  });
});
