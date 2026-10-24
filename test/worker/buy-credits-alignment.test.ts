import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { sellablePlans, type PublishedPriceBook } from "../../src/shared/priceBook";
import type { CreditsBillingView } from "../../src/shared/plans";

/**
 * P2 (23-Oct tracker, row 7) — "Buy Credits should align with 'My account plans
 * & prices'".
 *
 * Measured before the change: the Admin console's Credits & billing panel
 * (`/api/billing`) priced from `price_plans` × `price_amounts` — Price
 * configuration's DRAFT tables — and sold the pre-V3 10 / 50 / 100 packs, while
 * My account / Buy credits (`/api/pricing/published` → `quoteOrder`) sold the
 * incubator's seat flow from the PUBLISHED book. Two lists, two sources.
 *
 * What this file holds:
 *   1. The panel lists exactly what the wizard sells to the edition, at the
 *      published book's prices — compared against `/api/pricing/published`,
 *      the very response the wizard renders.
 *   2. An UNPUBLISHED draft edit moves neither the panel nor the charge
 *      (negative control: the draft tables are written, and nothing follows).
 *   3. The panel's currency is the billing address's, and so is the charge.
 *   4. The VC edition keeps the list it had (VC is out of scope and must not move).
 */

const BASE = "https://example.com";
const DEMO_ADMIN = "nisha.kapoor@demo.startupjury.ai";
const VC_ADMIN = "nisha.kapoor.vc@demo.startupjury.ai";

/** A customer of this file's own whose billing address is in the United States. */
const US = "t_p2_align_us";
const US_ADMIN = "admin@p2-align-us.test";

async function login(email: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo1234" }),
  });
  return res.headers.get("set-cookie")?.split(";")[0] ?? "";
}

function req(method: string, path: string, cookie: string, body?: unknown) {
  return SELF.fetch(`${BASE}${path}`, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function panel(cookie: string): Promise<CreditsBillingView> {
  const res = await req("GET", "/api/billing", cookie);
  expect(res.status).toBe(200);
  return res.json<CreditsBillingView>();
}

/** What My account renders its plans and prices from. */
async function wizardBook(cookie: string): Promise<PublishedPriceBook> {
  const res = await req("GET", "/api/pricing/published", cookie);
  expect(res.status).toBe(200);
  return res.json<PublishedPriceBook>();
}

interface PurchasePayload {
  intent: { id: string; currency: string; subtotalMinor: number; taxMinor: number; totalMinor: number };
}

beforeAll(async () => {
  await env.DB.prepare(
    "INSERT INTO organizations (id, name, slug, status) VALUES (?, 'Align US', 'p2-align-us', 'active') " +
      "ON CONFLICT (id) DO NOTHING",
  )
    .bind(US)
    .run();
  await env.DB.prepare(
    "INSERT INTO users (id, tenant_id, name, email, role, edition, initials, password_hash) " +
      "SELECT 'p2_align_us_admin', ?, 'Align US Admin', ?, 'admin', 'incubator', 'AU', password_hash FROM users WHERE email = ?",
  )
    .bind(US, US_ADMIN, DEMO_ADMIN)
    .run();
  // The commercial record V6's billing screen writes — an organisation, billed
  // in the United States. Written directly: the route is `account.ts`'s and has
  // its own tests; this file is about what the PANEL does with the row.
  await env.DB.prepare(
    "INSERT INTO account_profiles (tenant_id, edition, account_type, work_email, first_name, last_name, " +
      "org_kind, org_name, contact_name, contact_email, billing_name, billing_city, billing_country, billing_address) " +
      "VALUES (?, 'incubator', 'organization', 'finance@p2-align-us.test', 'Ada', 'Lane', 'incubator', " +
      "'Align US Inc', 'Ada Lane', 'finance@p2-align-us.test', 'Align US Inc', 'Austin', 'United States', '600 Congress Ave')",
  )
    .bind(US)
    .run();
});

describe("the console lists what My account sells, at My account's prices", () => {
  it("is the incubator wizard's list, from the published book, and nothing else", async () => {
    const cookie = await login(DEMO_ADMIN);
    const view = await panel(cookie);
    const book = await wizardBook(cookie);

    const expected = sellablePlans(book, "incubator").filter((p) => (p.amounts.INR ?? 0) > 0);
    expect(view.plans.map((p) => p.code)).toEqual(expected.map((p) => p.code));
    for (const plan of view.plans) {
      const row = book.plans.find((p) => p.code === plan.code)!;
      expect(plan.amountMinor, plan.code).toBe(row.amounts.INR);
      expect(plan.currency, plan.code).toBe("INR");
    }
    // The paid trial is how the wizard sells credits on their own…
    expect(view.plans.find((p) => p.code === "paid_trial")).toMatchObject({ group: "credit_pack", amountMinor: 10_000 });
    // …and the pre-V3 packs, which the wizard never shows an incubator, are gone.
    for (const legacy of ["pack_10", "pack_50", "pack_100", "standard", "pro", "ent_100"]) {
      expect(view.plans.map((p) => p.code), legacy).not.toContain(legacy);
    }
    // The free trial is taken, not bought.
    expect(view.plans.map((p) => p.code)).not.toContain("free_trial");
  });

  it("quotes GST at the published book's rate — the rate the order is charged at", async () => {
    const cookie = await login(DEMO_ADMIN);
    const view = await panel(cookie);
    const book = await wizardBook(cookie);
    expect(view.tax.ratePct).toBe(book.tax.gstRatePct);
    expect(view.tax.inclusive).toBe(book.tax.pricesIncludeGst);
  });

  it("charges the price the panel showed — the same `quoteOrder` My account uses", async () => {
    const cookie = await login(DEMO_ADMIN);
    const res = await req("POST", "/api/billing/purchase", cookie, { planCode: "paid_trial", quantity: 30 });
    expect(res.status).toBe(200);
    const { intent } = await res.json<PurchasePayload>();
    // 30 × ₹100, + 18 % GST — the figure the wizard's paid-trial screen totals.
    expect(intent).toMatchObject({ currency: "INR", subtotalMinor: 300_000, taxMinor: 54_000, totalMinor: 354_000 });
    const row = await env.DB.prepare("SELECT units, quantity FROM billing_payment_intents WHERE id = ?")
      .bind(intent.id)
      .first<{ units: number; quantity: number }>();
    // `units` is the TOTAL granted on completion, the meaning `/api/account/orders` gives it.
    expect(row).toEqual({ units: 30, quantity: 30 });
  });
});

describe("an UNPUBLISHED draft edit reaches neither the list nor the charge", () => {
  it("ignores a draft price an administrator has not published", async () => {
    // Negative control. Before P2 this UPDATE was, by itself, the price the panel
    // charged: `readCatalogue` joined straight onto `price_amounts`.
    await env.DB.prepare(
      "UPDATE price_amounts SET amount_minor = 1 WHERE currency = 'INR' AND plan_id = " +
        "(SELECT id FROM price_plans WHERE code = 'paid_trial')",
    ).run();
    const drafted = await env.DB.prepare(
      "SELECT a.amount_minor FROM price_amounts a JOIN price_plans p ON p.id = a.plan_id " +
        "WHERE p.code = 'paid_trial' AND a.currency = 'INR'",
    ).first<{ amount_minor: number }>();
    expect(drafted?.amount_minor, "the draft row must exist for this control to mean anything").toBe(1);

    const cookie = await login(DEMO_ADMIN);
    expect((await panel(cookie)).plans.find((p) => p.code === "paid_trial")?.amountMinor).toBe(10_000);
    const res = await req("POST", "/api/billing/purchase", cookie, { planCode: "paid_trial", quantity: 10 });
    expect((await res.json<PurchasePayload>()).intent.subtotalMinor).toBe(100_000);
  });
});

describe("the billing address decides the panel's currency, as it does the wizard's", () => {
  it("lists and charges a US-billed customer in USD, with no GST", async () => {
    const cookie = await login(US_ADMIN);
    const view = await panel(cookie);
    const book = await wizardBook(cookie);
    expect(view.plans.length).toBeGreaterThan(0);
    for (const plan of view.plans) {
      expect(plan.currency, plan.code).toBe("USD");
      expect(plan.amountMinor, plan.code).toBe(book.plans.find((p) => p.code === plan.code)!.amounts.USD);
    }
    const res = await req("POST", "/api/billing/purchase", cookie, { planCode: "paid_trial", quantity: 10 });
    expect(res.status).toBe(200);
    const { intent } = await res.json<PurchasePayload>();
    const usd = book.plans.find((p) => p.code === "paid_trial")!.amounts.USD;
    expect(intent).toMatchObject({ currency: "USD", subtotalMinor: usd * 10, taxMinor: 0, totalMinor: usd * 10 });
  });

  it("keeps the demo workspace — no billing country on file — in its subscription's INR", async () => {
    // `0104`: an unrecorded country is not guessed in either direction.
    const view = await panel(await login(DEMO_ADMIN));
    expect(new Set(view.plans.map((p) => p.currency))).toEqual(new Set(["INR"]));
  });
});

describe("the VC edition keeps its list (out of scope, must not move)", () => {
  it("still offers every listed plan it offered before — seat SKUs included — now at published prices", async () => {
    // Measured against the pre-P2 route: the VC panel listed every active DRAFT
    // row, the nine `seat_*` SKUs and the paid trial among them. The list is
    // kept; only its SOURCE moves to the published book. Narrowing it to the VC
    // wizard's list would be a VC change nobody asked for.
    const cookie = await login(VC_ADMIN);
    const view = await panel(cookie);
    const book = await wizardBook(cookie);
    const codes = view.plans.map((p) => p.code);
    const listed = book.plans.filter((p) => p.active && p.group !== "free_trial" && (p.amounts.INR ?? 0) > 0);
    expect(codes).toEqual(listed.map((p) => p.code));
    expect(codes).toEqual(expect.arrayContaining(["pack_10", "pack_50", "pack_100", "standard", "pro", "seat_pro_12"]));
    for (const plan of view.plans) {
      expect(plan.amountMinor, plan.code).toBe(book.plans.find((p) => p.code === plan.code)!.amounts.INR);
    }
    // And it is NOT the incubator rule — the control that the edition split is real.
    expect(codes).not.toEqual(sellablePlans(book, "incubator").map((p) => p.code));
  });
});
