import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type { AccountOrderView } from "../../src/shared/accountOrder";

/**
 * W6-B — My account's purchase wizard (`/api/account`).
 *
 * What this suite holds, in the order it matters:
 *
 *  1. **The money.** An order is priced from the PUBLISHED catalogue through
 *     `priceBreakdown`: GST at the configured rate on INR, and NO GST at all on
 *     a non-INR order. A draft an administrator has not published is never what
 *     a customer is charged.
 *  2. **An order records an intent and completes nothing** (§1.3): no credits,
 *     no ledger row, no tax invoice, `completed: false`. And no route reads a
 *     card (§1.2) — a card-shaped body is posted and proven untouched.
 *  3. **The profile** — both branches persist, with the prototype's validation.
 *  4. **AuthZ** — the `upgrade` task: admin and superuser in, everyone else 403.
 *
 * One D1 snapshot per file, so the blocks run in order and the edition-level
 * profile they build up is deliberate: incubator walks the Individual branch
 * and then becomes an Organization; vc is kept clean for the isolation checks.
 */

const BASE = "https://example.com";
const ADMIN = "nisha.kapoor@demo.startupjury.ai"; // incubator admin
const SUPERUSER = "priya.sharma@demo.startupjury.ai"; // incubator superuser
const PA = "sunita.rao@demo.startupjury.ai"; // incubator program_associate
const JURY = "rajesh.kumar@demo.startupjury.ai"; // incubator jury
const VC_PARTNER = "ishaan.sethi@demo.startupjury.ai";
const VC_ADMIN = "nisha.kapoor.vc@demo.startupjury.ai";

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

const PER_DECK = /per[- ]deck|\/\s*deck/i;

const INDIVIDUAL = {
  accountType: "individual",
  workEmail: "nisha.kapoor@demo.startupjury.ai",
  firstName: "Nisha",
  lastName: "Kapoor",
  dialCode: "+91",
  phone: "98765 43210",
  designation: "Head of Programs",
  organizationName: "Demo Incubator",
};

const ORG = {
  kind: "incubator",
  name: "Demo Incubator Foundation",
  businessType: "Incubator",
  employees: "11–50",
  associates: 12,
  city: "Hyderabad",
  country: "India",
  contactName: "Nisha Kapoor",
  designation: "Programme Director",
  dialCode: "+91",
  phone: "98765 43210",
  email: "programs@demo.startupjury.ai",
};

async function counts(edition = "incubator") {
  const one = async (sql: string) =>
    (await env.DB.prepare(sql).bind(edition).first<{ n: number }>())!.n;
  return {
    balance: (await env.DB.prepare("SELECT credits_balance AS n FROM org_settings WHERE edition = ?")
      .bind(edition)
      .first<{ n: number }>())!.n,
    ledger: await one("SELECT COUNT(*) AS n FROM credit_ledger WHERE edition = ?"),
    invoices: await one("SELECT COUNT(*) AS n FROM billing_invoices WHERE edition = ?"),
    intents: await one("SELECT COUNT(*) AS n FROM billing_payment_intents WHERE edition = ?"),
  };
}

describe("authorisation — the upgrade task", () => {
  it("refuses a signed-out caller", async () => {
    expect((await SELF.fetch(`${BASE}/api/account`)).status).toBe(401);
  });

  it("refuses every non-buying role on every verb, in both editions", async () => {
    for (const email of [PA, JURY, VC_PARTNER]) {
      const c = await login(email);
      expect((await req("GET", "/api/account", c)).status, email).toBe(403);
      expect((await req("PUT", "/api/account/profile", c, INDIVIDUAL)).status, email).toBe(403);
      expect(
        (await req("POST", "/api/account/orders", c, { planCode: "pack_50", currency: "INR", paymentMethod: "upi" })).status,
        email,
      ).toBe(403);
      expect((await req("GET", "/api/account/orders/pi_x", c)).status, email).toBe(403);
      expect((await req("GET", "/api/account/orders/pi_x/document", c)).status, email).toBe(403);
    }
  });

  it("lets an admin and a superuser in", async () => {
    for (const email of [ADMIN, SUPERUSER]) {
      expect((await req("GET", "/api/account", await login(email))).status, email).toBe(200);
    }
  });

  it("closes the API when the upgrade cell is revoked, superuser bypass aside", async () => {
    await env.DB.prepare(
      "INSERT INTO role_permissions (edition, role, task_id, granted) VALUES ('vc', 'admin', 'upgrade', 0) " +
        "ON CONFLICT (edition, role, task_id) DO UPDATE SET granted = 0",
    ).run();
    try {
      expect((await req("GET", "/api/account", await login(VC_ADMIN))).status).toBe(403);
    } finally {
      await env.DB.prepare(
        "UPDATE role_permissions SET granted = 1 WHERE edition = 'vc' AND role = 'admin' AND task_id = 'upgrade'",
      ).run();
    }
    expect((await req("GET", "/api/account", await login(VC_ADMIN))).status).toBe(200);
  });
});

describe("the profile — Account, Org type, Org details", () => {
  it("opens pre-filled from the signed-in user, unsaved, with no provider configured", async () => {
    const res = await req("GET", "/api/account", await login(ADMIN));
    const body = (await res.json()) as {
      saved: boolean;
      profile: { workEmail: string; firstName: string; lastName: string; accountType: string };
      orders: unknown[];
      paymentConfigured: boolean;
    };
    expect(body.saved).toBe(false);
    expect(body.profile).toMatchObject({
      accountType: "individual",
      workEmail: ADMIN,
      firstName: "Nisha",
      lastName: "Kapoor",
    });
    expect(body.orders).toEqual([]);
    expect(body.paymentConfigured).toBe(false);
  });

  it("refuses an order before anyone has said who is buying", async () => {
    const res = await req("POST", "/api/account/orders", await login(ADMIN), {
      planCode: "pack_50",
      currency: "INR",
      paymentMethod: "upi",
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "account_required" });
  });

  it("validates the Account screen — personal mail is refused, names are required", async () => {
    const c = await login(ADMIN);
    const bad = await req("PUT", "/api/account/profile", c, { ...INDIVIDUAL, workEmail: "nisha@gmail.com", lastName: "" });
    expect(bad.status).toBe(400);
    const body = (await bad.json()) as { error: string; fields: Record<string, string> };
    expect(body.error).toBe("invalid_profile");
    expect(Object.keys(body.fields).sort()).toEqual(["lastName", "workEmail"]);
  });

  it("does not save an Organization without its organisation", async () => {
    const c = await login(ADMIN);
    const res = await req("PUT", "/api/account/profile", c, { ...INDIVIDUAL, accountType: "organization" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "org_details_required" });
    const bad = await req("PUT", "/api/account/profile", c, {
      ...INDIVIDUAL,
      accountType: "organization",
      org: { ...ORG, kind: "bank", employees: "lots", email: "" },
    });
    expect(bad.status).toBe(400);
    expect(Object.keys(((await bad.json()) as { fields: object }).fields).sort()).toEqual(["email", "employees", "kind"]);
  });

  it("saves the Individual branch and audits it", async () => {
    const c = await login(ADMIN);
    const res = await req("PUT", "/api/account/profile", c, INDIVIDUAL);
    expect(res.status).toBe(200);
    const { profile } = (await res.json()) as { profile: { accountType: string; org: unknown; designation: string } };
    expect(profile).toMatchObject({ accountType: "individual", org: null, designation: "Head of Programs" });
    const audit = await env.DB.prepare(
      "SELECT category FROM audit_log WHERE action = 'account_profile_created' AND edition = 'incubator'",
    ).first<{ category: string }>();
    expect(audit?.category).toBe("billing");
    expect(((await (await req("GET", "/api/account", c)).json()) as { saved: boolean }).saved).toBe(true);
  });
});

describe("orders — priced from the published catalogue, charged nothing", () => {
  let inrOrder: AccountOrderView;

  it("records an INR credit pack with GST at the configured rate, and grants nothing", async () => {
    const c = await login(ADMIN);
    const before = await counts();
    const res = await req("POST", "/api/account/orders", c, {
      planCode: "pack_50",
      currency: "INR",
      paymentMethod: "upi",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      order: AccountOrderView;
      completed: boolean;
      creditsGranted: number;
      checkout: { hosted: boolean; url: string | null };
      message: string;
    };
    expect(body.completed).toBe(false);
    expect(body.creditsGranted).toBe(0);
    expect(body.checkout).toEqual({ hosted: false, url: null });
    expect(body.message).toMatch(/nothing has been charged/);
    // The published seed sells the 50-unit pack for ₹20,000; GST 18 % = ₹3,600.
    expect(body.order).toMatchObject({
      planCode: "pack_50",
      group: "credit_pack",
      period: "one_time",
      units: 50,
      currency: "INR",
      subtotalMinor: 2_000_000,
      taxMinor: 360_000,
      totalMinor: 2_360_000,
      ratePct: 18,
      taxed: true,
      status: "recorded",
      paymentMethod: "upi",
      accountType: "individual",
    });
    inrOrder = body.order;

    const after = await counts();
    expect(after.balance).toBe(before.balance);
    expect(after.ledger).toBe(before.ledger);
    expect(after.invoices).toBe(before.invoices);
    expect(after.intents).toBe(before.intents + 1);

    const intent = await env.DB.prepare("SELECT status, provider, purpose FROM billing_payment_intents WHERE id = ?")
      .bind(inrOrder.id)
      .first<{ status: string; provider: string; purpose: string }>();
    expect(intent).toEqual({ status: "recorded", provider: "none", purpose: "credit_pack" });
    const row = await env.DB.prepare("SELECT taxed, price_version FROM account_orders WHERE intent_id = ?")
      .bind(inrOrder.id)
      .first<{ taxed: number; price_version: number }>();
    expect(row).toEqual({ taxed: 1, price_version: 1 });
  });

  it("carries NO GST on a non-INR order", async () => {
    const res = await req("POST", "/api/account/orders", await login(ADMIN), {
      planCode: "standard",
      currency: "USD",
      paymentMethod: "card",
    });
    expect(res.status).toBe(200);
    const { order } = (await res.json()) as { order: AccountOrderView };
    // Standard is published at $12.00 a month.
    expect(order).toMatchObject({
      currency: "USD",
      subtotalMinor: 1_200,
      taxMinor: 0,
      totalMinor: 1_200,
      taxed: false,
      group: "subscription",
      period: "month",
    });
    const row = await env.DB.prepare(
      "SELECT o.taxed, i.tax_minor, i.subtotal_minor + i.tax_minor = i.total_minor AS balanced " +
        "FROM account_orders o JOIN billing_payment_intents i ON i.id = o.intent_id WHERE o.intent_id = ?",
    )
      .bind(order.id)
      .first<{ taxed: number; tax_minor: number; balanced: number }>();
    expect(row).toEqual({ taxed: 0, tax_minor: 0, balanced: 1 });
  });

  it("prices from the PUBLISHED book — an unpublished draft edit is not what is charged", async () => {
    await env.DB.prepare("UPDATE price_amounts SET amount_minor = 1 WHERE plan_id = 'pp_pack_10' AND currency = 'INR'").run();
    const res = await req("POST", "/api/account/orders", await login(ADMIN), {
      planCode: "pack_10",
      currency: "INR",
      paymentMethod: "netbanking",
    });
    const { order } = (await res.json()) as { order: AccountOrderView };
    expect(order.subtotalMinor).toBe(500_000);
    expect(order.totalMinor).toBe(590_000);
  });

  it("never reads a card: card-shaped keys are ignored, stored nowhere and audited nowhere (§1.2)", async () => {
    const res = await req("POST", "/api/account/orders", await login(ADMIN), {
      planCode: "pack_100",
      currency: "INR",
      paymentMethod: "card",
      cardNumber: "4242424242424242",
      cvv: "123",
      expiry: "12/30",
      upiId: "nisha@okhdfc",
    });
    expect(res.status).toBe(200);
    const text = JSON.stringify(await res.json());
    expect(text).not.toMatch(/4242|okhdfc|"cvv"|12\/30/);
    const { id } = JSON.parse(text).order as AccountOrderView;
    const stored = await env.DB.prepare(
      "SELECT i.*, o.* FROM billing_payment_intents i JOIN account_orders o ON o.intent_id = i.id WHERE i.id = ?",
    )
      .bind(id)
      .first();
    expect(JSON.stringify(stored)).not.toMatch(/4242|okhdfc|12\/30/);
    const audit = await env.DB.prepare("SELECT summary, detail_json FROM audit_log WHERE target_id = ?")
      .bind(id)
      .all<{ summary: string; detail_json: string }>();
    expect(audit.results.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit.results)).not.toMatch(/4242|okhdfc|12\/30/);
    expect(audit.results.some((a) => /no payment taken/.test(a.summary))).toBe(true);
  });

  it("refuses what cannot be bought", async () => {
    const c = await login(ADMIN);
    const post = (body: object) => req("POST", "/api/account/orders", c, body);
    const cases: Array<[object, number, string]> = [
      [{ currency: "INR", paymentMethod: "upi" }, 400, "plan_required"],
      [{ planCode: "pack_50", paymentMethod: "upi" }, 400, "currency_required"],
      [{ planCode: "pack_50", currency: "INR" }, 400, "payment_method_required"],
      [{ planCode: "pack_50", currency: "INR", paymentMethod: "cash" }, 400, "payment_method_required"],
      [{ planCode: "nope", currency: "INR", paymentMethod: "upi" }, 404, "unknown_plan"],
      [{ planCode: "free_trial", currency: "INR", paymentMethod: "upi" }, 400, "plan_not_purchasable"],
      // AED is in the catalogue but switched off.
      [{ planCode: "pack_50", currency: "AED", paymentMethod: "upi" }, 400, "not_priced_in_currency"],
      // Annual plans belong to the Organization branch.
      [{ planCode: "ent_100", currency: "INR", paymentMethod: "upi" }, 400, "organization_required"],
    ];
    for (const [body, status, error] of cases) {
      const res = await post(body);
      expect(res.status, JSON.stringify(body)).toBe(status);
      expect(await res.json(), JSON.stringify(body)).toMatchObject({ error });
    }
  });

  it("saves the Organization branch, and then sells it an annual plan", async () => {
    const c = await login(ADMIN);
    const saved = await req("PUT", "/api/account/profile", c, {
      ...INDIVIDUAL,
      accountType: "organization",
      org: ORG,
    });
    expect(saved.status).toBe(200);
    const { profile } = (await saved.json()) as { profile: { accountType: string; org: typeof ORG } };
    expect(profile.accountType).toBe("organization");
    expect(profile.org).toMatchObject({ ...ORG });

    const res = await req("POST", "/api/account/orders", c, {
      planCode: "ent_100",
      currency: "INR",
      paymentMethod: "netbanking",
    });
    expect(res.status).toBe(200);
    const { order } = (await res.json()) as { order: AccountOrderView };
    // ₹60,000 a year + 18 % GST.
    expect(order).toMatchObject({
      group: "enterprise",
      period: "year",
      accountType: "organization",
      subtotalMinor: 6_000_000,
      taxMinor: 1_080_000,
      totalMinor: 7_080_000,
    });
    const purpose = await env.DB.prepare("SELECT purpose FROM billing_payment_intents WHERE id = ?")
      .bind(order.id)
      .first<{ purpose: string }>();
    expect(purpose?.purpose).toBe("enterprise");
  });

  it("keeps the organisation on file when the account is switched back to Individual", async () => {
    const c = await login(ADMIN);
    await req("PUT", "/api/account/profile", c, INDIVIDUAL);
    const row = await env.DB.prepare("SELECT account_type, org_name FROM account_profiles WHERE edition = 'incubator'")
      .first<{ account_type: string; org_name: string }>();
    expect(row).toEqual({ account_type: "individual", org_name: ORG.name });
  });

  it("serves the receipt to its own edition only", async () => {
    const own = await req("GET", `/api/account/orders/${inrOrder.id}`, await login(ADMIN));
    expect(own.status).toBe(200);
    expect(await own.json()).toMatchObject({ id: inrOrder.id, totalMinor: 2_360_000 });
    const other = await req("GET", `/api/account/orders/${inrOrder.id}`, await login(VC_ADMIN));
    expect(other.status).toBe(404);
    expect((await req("GET", `/api/account/orders/${inrOrder.id}/document`, await login(VC_ADMIN))).status).toBe(404);

    const list = (await (await req("GET", "/api/account", await login(ADMIN))).json()) as { orders: AccountOrderView[] };
    expect(list.orders.length).toBeGreaterThanOrEqual(4);
    expect(list.orders.every((o) => o.status === "recorded")).toBe(true);
  });

  it("downloads a PRO-FORMA, never a tax invoice for money not received", async () => {
    const c = await login(ADMIN);
    const res = await req("GET", `/api/account/orders/${inrOrder.id}/document`, c);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="PF-[0-9A-F]{8}\.html"/);
    const html = await res.text();
    expect(html).toContain("Pro-forma invoice");
    expect(html).toContain("NOT A TAX INVOICE");
    expect(html).not.toMatch(/Tax invoice /);
    expect(html).toContain("GST (18%)");
    expect(html).toContain("₹23,600");
    expect(html).not.toMatch(PER_DECK);

    const list = (await (await req("GET", "/api/account", c)).json()) as { orders: AccountOrderView[] };
    const usd = list.orders.find((o) => o.currency === "USD")!;
    const usdHtml = await (await req("GET", `/api/account/orders/${usd.id}/document`, c)).text();
    expect(usdHtml).not.toContain("GST (");
    expect(usdHtml).toContain("exclusive of local taxes");
  });

  it("serves no per-deck figure anywhere (§8 Q1)", async () => {
    const c = await login(ADMIN);
    const text = await (await req("GET", "/api/account", c)).text();
    expect(text).not.toMatch(PER_DECK);
  });
});
