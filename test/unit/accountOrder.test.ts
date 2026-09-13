import { describe, expect, it } from "vitest";
import {
  STEPS_INDIVIDUAL,
  STEPS_ORGANIZATION,
  billableCurrencies,
  featureBullets,
  isWorkEmail,
  nextAfterAccount,
  planScreenFor,
  purchasablePlans,
  quoteOrder,
  sellableGroups,
  stepperFor,
  taxSettingsOf,
  validateAccountFields,
  validateOrgDetails,
  type OrderQuote,
} from "../../src/shared/accountOrder";
import { priceBreakdown } from "../../src/shared/plans";
import { taxBreakdown } from "../../src/shared/priceBook";
import { catalogueFixture } from "./fixtures/accountCatalogue";

/**
 * W6-B — the account wizard's pure logic: the two-branch stepper, the form
 * rules, and the ONE path from a published catalogue row to an order total.
 */

function ok(q: ReturnType<typeof quoteOrder>): OrderQuote {
  if ("error" in q) throw new Error(`expected a quote, got ${q.error}`);
  return q;
}

describe("the stepper (the prototype's setSteps)", () => {
  it("draws three steps for an individual and six for an organisation", () => {
    expect(stepperFor("individual", "account").map((s) => s.label)).toEqual([...STEPS_INDIVIDUAL]);
    expect(stepperFor("organization", "account").map((s) => s.label)).toEqual([...STEPS_ORGANIZATION]);
  });

  it("marks earlier steps done and the current one active", () => {
    expect(stepperFor("individual", "plan").map((s) => s.state)).toEqual(["done", "active", "todo"]);
    expect(stepperFor("organization", "orgdetails").map((s) => s.state)).toEqual([
      "done",
      "done",
      "active",
      "todo",
      "todo",
      "todo",
    ]);
    // Org plan and the individual plan screen share the organisation's Plan position.
    expect(stepperFor("organization", "orgplan")[3].state).toBe("active");
    expect(stepperFor("organization", "plan")[3].state).toBe("active");
    expect(stepperFor("organization", "payment")[4].state).toBe("active");
  });

  it("completes every step on success, relabelling the individual's last step Done", () => {
    const ind = stepperFor("individual", "success");
    expect(ind.map((s) => s.label)).toEqual(["Account", "Plan", "Done"]);
    expect(ind.every((s) => s.state === "done")).toBe(true);
    const org = stepperFor("organization", "success");
    expect(org.map((s) => s.label)).toEqual([...STEPS_ORGANIZATION]);
    expect(org.every((s) => s.state === "done")).toBe(true);
  });

  it("branches after Account and returns to the right plan screen from Payment", () => {
    expect(nextAfterAccount("individual")).toBe("plan");
    expect(nextAfterAccount("organization")).toBe("orgtype");
    expect(planScreenFor("organization", "enterprise")).toBe("orgplan");
    expect(planScreenFor("organization", "credit_pack")).toBe("plan");
    expect(planScreenFor("individual", "subscription")).toBe("plan");
  });
});

describe("the account form", () => {
  it("refuses personal mailboxes, as the prototype's hint promises", () => {
    expect(isWorkEmail("priya@acmeventures.in")).toBe(true);
    expect(isWorkEmail("priya@gmail.com")).toBe(false);
    expect(isWorkEmail("PRIYA@Outlook.com")).toBe(false);
    expect(isWorkEmail("not-an-email")).toBe(false);
    expect(
      validateAccountFields({ accountType: "individual", workEmail: "p@yahoo.com", firstName: "P", lastName: "S" })
        .workEmail,
    ).toBe("Personal email addresses are not accepted.");
  });

  it("requires a type, an email and both names, and accepts the prototype's dial codes only", () => {
    expect(validateAccountFields({ accountType: "team", workEmail: "", firstName: " ", lastName: "" })).toEqual({
      accountType: expect.any(String),
      workEmail: expect.any(String),
      firstName: expect.any(String),
      lastName: expect.any(String),
    });
    expect(
      validateAccountFields({
        accountType: "organization",
        workEmail: "p@acme.in",
        firstName: "P",
        lastName: "S",
        dialCode: "+999",
      }),
    ).toEqual({ dialCode: expect.any(String) });
    expect(
      validateAccountFields({ accountType: "individual", workEmail: "p@acme.in", firstName: "P", lastName: "S", dialCode: "+44", phone: "20 7946 0958" }),
    ).toEqual({});
  });

  it("validates the eleven org fields against the prototype's option lists", () => {
    const good = {
      kind: "investor",
      name: "Acme Ventures",
      businessType: "VC Firm",
      employees: "11–50",
      associates: 12,
      city: "Hyderabad",
      country: "India",
      contactName: "Priya Sharma",
      designation: "Managing Partner",
      dialCode: "+91",
      phone: "98765 43210",
      email: "hello@acme.vc",
    };
    expect(validateOrgDetails(good)).toEqual({});
    expect(
      validateOrgDetails({ ...good, kind: "bank", businessType: "Bank", employees: "9000", country: "Atlantis", associates: -1 }),
    ).toEqual({
      kind: expect.any(String),
      businessType: expect.any(String),
      employees: expect.any(String),
      country: expect.any(String),
      associates: expect.any(String),
    });
    expect(validateOrgDetails({ ...good, name: "", contactName: "", email: "nope" })).toEqual({
      name: expect.any(String),
      contactName: expect.any(String),
      email: expect.any(String),
    });
  });
});

describe("the catalogue, projected onto the wizard", () => {
  const book = catalogueFixture();

  it("offers active, priced, non-free plans only — in catalogue order", () => {
    expect(purchasablePlans(book, "credit_pack", "INR").map((p) => p.code)).toEqual([
      "pack_10",
      "pack_50",
      "pack_100",
    ]);
    // pack_100 has no GBP price: it is not for sale in GBP rather than sold for zero.
    expect(purchasablePlans(book, "credit_pack", "GBP").map((p) => p.code)).toEqual(["pack_10", "pack_50"]);
    expect(purchasablePlans(book, "free_trial", "INR")).toEqual([]);
    expect(sellableGroups(book, ["subscription", "credit_pack"], "INR").map((g) => g.title)).toEqual([
      "Individual plans",
      "Pay-as-you-go credit packs",
    ]);
  });

  it("bills only in the active currencies, base first", () => {
    expect(billableCurrencies(book)).toEqual(["INR", "USD", "GBP"]);
  });

  it("splits a plan's features into bullets", () => {
    expect(featureBullets({ features: "Priority WhatsApp support · Up to 10 evaluators" })).toEqual([
      "Priority WhatsApp support",
      "Up to 10 evaluators",
    ]);
    expect(featureBullets({ features: null })).toEqual([]);
  });

  it("follows the data: renaming or repricing a row changes the projection, with no literal to update", () => {
    const edited = catalogueFixture();
    edited.plans = edited.plans.map((p) =>
      p.code === "pack_50" ? { ...p, units: 35, name: "35-unit pack", amounts: { ...p.amounts, INR: 1_575_000 } } : p,
    );
    const pack = purchasablePlans(edited, "credit_pack", "INR").find((p) => p.code === "pack_50")!;
    expect(pack.units).toBe(35);
    expect(ok(quoteOrder(edited, "pack_50", "INR", "individual")).breakdown.subtotalMinor).toBe(1_575_000);
  });
});

describe("order totals and GST", () => {
  const book = catalogueFixture();

  it("adds GST at the CONFIGURED rate to an INR order", () => {
    const q = ok(quoteOrder(book, "pack_50", "INR", "individual"));
    expect(q.amountMinor).toBe(2_000_000);
    expect(q.breakdown).toMatchObject({
      subtotalMinor: 2_000_000,
      taxMinor: 360_000,
      totalMinor: 2_360_000,
      ratePct: 18,
      taxed: true,
    });

    const at5 = catalogueFixture();
    at5.tax = { ...at5.tax, gstRatePct: 5 };
    expect(ok(quoteOrder(at5, "pack_50", "INR", "individual")).breakdown).toMatchObject({
      taxMinor: 100_000,
      totalMinor: 2_100_000,
    });
  });

  it("carries a fractional GST exactly — ₹999 at 18% is ₹179.82", () => {
    const q = ok(quoteOrder(book, "standard", "INR", "individual"));
    expect(q.breakdown).toMatchObject({ subtotalMinor: 99_900, taxMinor: 17_982, totalMinor: 117_882 });
  });

  it("carries NO GST on a non-INR order — the rule both pricing modules agree on", () => {
    for (const currency of ["USD", "GBP"]) {
      const q = ok(quoteOrder(book, "pro", currency, "individual"));
      expect(q.breakdown.taxed).toBe(false);
      expect(q.breakdown.taxMinor).toBe(0);
      expect(q.breakdown.totalMinor).toBe(q.amountMinor);
    }
    expect(ok(quoteOrder(book, "ent_500", "USD", "organization")).breakdown).toMatchObject({
      subtotalMinor: 239_900,
      taxMinor: 0,
      totalMinor: 239_900,
      taxed: false,
    });
  });

  it("extracts rather than adds GST when catalogue prices include it", () => {
    const inclusive = catalogueFixture();
    inclusive.tax = { ...inclusive.tax, pricesIncludeGst: true };
    const q = ok(quoteOrder(inclusive, "pack_50", "INR", "individual"));
    expect(q.breakdown.totalMinor).toBe(2_000_000);
    expect(q.breakdown.subtotalMinor + q.breakdown.taxMinor).toBe(2_000_000);
    expect(q.breakdown.inclusive).toBe(true);
  });

  it("is priceBreakdown and nothing else — and agrees with the catalogue's own taxBreakdown", () => {
    for (const code of ["standard", "pack_10", "pack_100"]) {
      for (const currency of ["INR", "USD"]) {
        const q = ok(quoteOrder(book, code, currency, "individual"));
        expect(q.breakdown).toEqual(priceBreakdown(q.amountMinor, taxSettingsOf(book.tax), currency));
        const cat = taxBreakdown(q.amountMinor, currency, book.tax);
        expect([q.breakdown.subtotalMinor, q.breakdown.taxMinor, q.breakdown.totalMinor, q.breakdown.taxed]).toEqual([
          cat.netMinor,
          cat.taxMinor,
          cat.grossMinor,
          cat.taxed,
        ]);
      }
    }
  });

  it("refuses what cannot be bought", () => {
    expect(quoteOrder(book, "nope", "INR", "individual")).toEqual({ error: "unknown_plan" });
    expect(quoteOrder(book, "free_trial", "INR", "individual")).toEqual({ error: "plan_not_purchasable" });
    expect(quoteOrder(book, "pack_250", "INR", "individual")).toEqual({ error: "plan_not_purchasable" });
    expect(quoteOrder(book, "pack_100", "GBP", "individual")).toEqual({ error: "not_priced_in_currency" });
    // AED is a catalogue currency, but switched off: not billable.
    expect(quoteOrder(book, "pack_10", "AED", "individual")).toEqual({ error: "not_priced_in_currency" });
    // Annual plans are sold through the Organization branch only.
    expect(quoteOrder(book, "ent_100", "INR", "individual")).toEqual({ error: "organization_required" });
    expect("error" in quoteOrder(book, "ent_100", "INR", "organization")).toBe(false);
  });
});
