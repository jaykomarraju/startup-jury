import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
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
        "ON CONFLICT (tenant_id, edition, role, task_id) DO UPDATE SET granted = 0",
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
  let usdOrder: AccountOrderView;

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
    // `0073` publishes version 2 — the seat catalogue the reshared prototype sells.
    expect(row).toEqual({ taxed: 1, price_version: 2 });
  });

  it("carries NO GST on a non-INR order", async () => {
    const res = await req("POST", "/api/account/orders", await login(ADMIN), {
      planCode: "standard",
      currency: "USD",
      paymentMethod: "card",
    });
    expect(res.status).toBe(200);
    const { order } = (await res.json()) as { order: AccountOrderView };
    usdOrder = order;
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

  // ── V3-PT · items 15 and 17 ────────────────────────────────────────────────

  /**
   * The seat SKUs `0073` publishes, ordered through the same route. The two new
   * quantities are the reason these exist: the client sends COUNTS and the
   * server prices them, so a crafted request cannot buy 500 credits for nothing.
   */
  it("sells a seat for a billing period the old enum cannot spell", async () => {
    const res = await req("POST", "/api/account/orders", await login(ADMIN), {
      planCode: "seat_pro_3",
      currency: "INR",
      paymentMethod: "upi",
    });
    expect(res.status).toBe(200);
    const { order } = (await res.json()) as { order: AccountOrderView };
    expect(order).toMatchObject({
      planCode: "seat_pro_3",
      group: "subscription",
      // `price_plans.period` CHECKs three values and "quarter" is not one of
      // them; `period_months` is what carries it.
      period: null,
      periodMonths: 3,
      units: 125,
      subtotalMinor: 600_000,
      taxMinor: 108_000,
      totalMinor: 708_000,
    });
    const row = await env.DB.prepare("SELECT period, period_months FROM account_orders WHERE intent_id = ?")
      .bind(order.id)
      .first<{ period: string | null; period_months: number | null }>();
    expect(row).toEqual({ period: null, period_months: 3 });
  });

  it("prices extra credits itself, from the tier's annual seat", async () => {
    const res = await req("POST", "/api/account/orders", await login(ADMIN), {
      planCode: "seat_standard_12",
      currency: "INR",
      paymentMethod: "upi",
      extraCredits: 250,
    });
    expect(res.status).toBe(200);
    const { order } = (await res.json()) as { order: AccountOrderView };
    // ₹11,520 / 500 decks = ₹23.04 per credit; 250 credits = ₹5,760.
    expect(order.subtotalMinor).toBe(1_152_000 + 576_000);
    expect(order.units).toBe(750);
  });

  it("multiplies a paid-trial pack by the published per-deck rate", async () => {
    const res = await req("POST", "/api/account/orders", await login(ADMIN), {
      planCode: "paid_trial",
      currency: "INR",
      paymentMethod: "upi",
      quantity: 30,
    });
    expect(res.status).toBe(200);
    const { order } = (await res.json()) as { order: AccountOrderView };
    expect(order.subtotalMinor).toBe(300_000);
    expect(order.totalMinor).toBe(354_000);
    expect(order.units).toBe(30);
    const intent = await env.DB.prepare("SELECT quantity, units FROM billing_payment_intents WHERE id = ?")
      .bind(order.id)
      .first<{ quantity: number; units: number }>();
    expect(intent).toEqual({ quantity: 30, units: 30 });
  });

  it("refuses a quantity or an extra-credit count it cannot honour", async () => {
    const c = await login(ADMIN);
    const post = (body: object) => req("POST", "/api/account/orders", c, body);
    const cases: Array<[object, number, string]> = [
      [{ planCode: "paid_trial", currency: "INR", paymentMethod: "upi", quantity: 0 }, 400, "invalid_quantity"],
      [{ planCode: "paid_trial", currency: "INR", paymentMethod: "upi", quantity: 2.5 }, 400, "invalid_quantity"],
      [{ planCode: "paid_trial", currency: "INR", paymentMethod: "upi", quantity: -5 }, 400, "invalid_quantity"],
      [{ planCode: "seat_pro_3", currency: "INR", paymentMethod: "upi", extraCredits: -1 }, 400, "invalid_quantity"],
      // A seat has no extra-credit rate in a currency its annual row is not sold in.
      [{ planCode: "pack_50", currency: "INR", paymentMethod: "upi", extraCredits: 125 }, 400, "extras_not_priced"],
    ];
    for (const [body, status, error] of cases) {
      const res = await post(body);
      expect(res.status, JSON.stringify(body)).toBe(status);
      expect(await res.json(), JSON.stringify(body)).toMatchObject({ error });
      }
    // The negative control: the same order without the bad count goes through.
    const ok = await post({ planCode: "seat_pro_3", currency: "INR", paymentMethod: "upi" });
    expect(ok.status).toBe(200);
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

    // Held from the test that placed it: `GET /api/account` returns the five
    // most recent orders, and V3-PT's seat orders push this one past that edge.
    const usdHtml = await (await req("GET", `/api/account/orders/${usdOrder.id}/document`, c)).text();
    expect(usdHtml).not.toContain("GST (");
    expect(usdHtml).toContain("exclusive of local taxes");
  });

  it("serves no per-deck figure anywhere (§8 Q1)", async () => {
    const c = await login(ADMIN);
    const text = await (await req("GET", "/api/account", c)).text();
    expect(text).not.toMatch(PER_DECK);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T1-COMMERCE · TENANT ISOLATION
// ─────────────────────────────────────────────────────────────────────────────
//
// §2 B18: `GET /api/account` was scoped by `account.ts:208` — `o.edition = ?` —
// over **order history and receipt documents**, and §2 A6 names its catalogue
// read as a leak as well. The catalogue is NOT one: `pricing_versions` is one of
// §3's eight platform-global tables and must never gain a tenant key, so the
// cases below assert that the catalogue still crosses (one book, product-wide)
// while everything commercial does not.
//
// ── THE MARKER TAKES ONE HOP, AND THAT IS NOT AN ACCIDENT ──────────────────
//
// `account_orders` has no free-text column of its own: `intent_id` is both its
// primary key and a foreign key to `billing_payment_intents`, so the order IS its
// intent and the only visible string is `plan_name` one table away. A probe that
// put a marker on `account_orders` would have nothing to put it in. That is why
// the fixture seeds BOTH rows and why `ORDER_SELECT`'s JOIN now matches the
// workspace on both sides.

const AX = "t_ax_account";
const AX_MARK = "AXTENANT";
const AX_ADMIN = "ax.admin@axtenant.test";
/** A third customer, in the `vc` edition — see the POST /orders case for why. */
const AY = "t_ay_account";
const AY_ADMIN = "ay.admin@aytenant.test";

/** The outermost frame: isolated storage pops a per-describe `beforeAll`. */
beforeAll(async () => {
  await env.DB.prepare(
    "INSERT INTO organizations (id, name, slug, status) VALUES (?, ?, 'ax-account', 'active') " +
      "ON CONFLICT (id) DO NOTHING",
  )
    .bind(AX, `${AX_MARK} Accelerator`)
    .run();
  await env.DB.prepare(
    "INSERT INTO users (id, tenant_id, name, email, role, edition, initials, password_hash) " +
      "SELECT 'ax_admin', ?, ?, ?, 'admin', 'incubator', 'AX', password_hash FROM users WHERE email = ?",
  )
    .bind(AX, `${AX_MARK} Admin`, AX_ADMIN, ADMIN)
    .run();
  await env.DB.prepare(
    "INSERT INTO billing_payment_intents (id, tenant_id, edition, purpose, plan_name, currency, " +
      "subtotal_minor, tax_minor, total_minor, gst_rate_pct) " +
      "VALUES ('ax_pi', ?, 'incubator', 'enterprise', ?, 'INR', 1000, 180, 1180, 18)",
  )
    .bind(AX, `${AX_MARK} annual plan`)
    .run();
  await env.DB.prepare(
    "INSERT INTO account_orders (intent_id, tenant_id, edition, account_type, plan_group, " +
      "payment_method, taxed) VALUES ('ax_pi', ?, 'incubator', 'organization', 'enterprise', 'upi', 1)",
  )
    .bind(AX)
    .run();

  await env.DB.prepare(
    "INSERT INTO organizations (id, name, slug, status) VALUES (?, 'AYTENANT Fund', 'ay-account', 'active') " +
      "ON CONFLICT (id) DO NOTHING",
  )
    .bind(AY)
    .run();
  await env.DB.prepare(
    "INSERT INTO users (id, tenant_id, name, email, role, edition, initials, password_hash) " +
      "SELECT 'ay_admin', ?, 'AYTENANT Admin', ?, 'admin', 'vc', 'AY', password_hash FROM users WHERE email = ?",
  )
    .bind(AY, AY_ADMIN, ADMIN)
    .run();
});

describe("tenancy — My account shows one customer their own orders", () => {
  it("the fixture really landed, so nothing below passes for the wrong reason", async () => {
    const row = await env.DB.prepare("SELECT count(*) n FROM account_orders WHERE tenant_id = ?")
      .bind(AX)
      .first<{ n: number }>();
    expect(row!.n, "tenant B has no order — every case below is vacuous").toBe(1);
    expect(await login(AX_ADMIN), "tenant B's admin cannot sign in").toBeTruthy();
  });

  it("GET / lists each customer only their own orders", async () => {
    const theirs = await (
      await SELF.fetch(`${BASE}/api/account`, { headers: { cookie: await login(AX_ADMIN) } })
    ).json<{ orders: AccountOrderView[] }>();
    expect(theirs.orders.map((o) => o.id)).toEqual(["ax_pi"]);

    const ours = await (
      await SELF.fetch(`${BASE}/api/account`, { headers: { cookie: await login(ADMIN) } })
    ).text();
    expect(ours, "§2 B18 — tenant B's order history crossed into tenant A").not.toContain(AX_MARK);
  });

  it("a receipt and its pro-forma cannot be fetched across customers", async () => {
    // The id is known and the row exists; only the scope keeps it out. A 404 here
    // rather than a 403 is correct — tenant A has no business learning that an
    // order with this id exists at all.
    const ours = await login(ADMIN);
    expect((await SELF.fetch(`${BASE}/api/account/orders/ax_pi`, { headers: { cookie: ours } })).status).toBe(404);
    expect(
      (await SELF.fetch(`${BASE}/api/account/orders/ax_pi/document`, { headers: { cookie: ours } })).status,
    ).toBe(404);
    // And tenant B's own admin can fetch both, so the 404s above are the scope and
    // not a broken route.
    const theirs = await login(AX_ADMIN);
    expect((await SELF.fetch(`${BASE}/api/account/orders/ax_pi`, { headers: { cookie: theirs } })).status).toBe(200);
    const doc = await SELF.fetch(`${BASE}/api/account/orders/ax_pi/document`, {
      headers: { cookie: theirs },
    });
    expect(doc.status).toBe(200);
    expect(await doc.text()).toContain(AX_MARK);
  });

  it("a second customer's profile opens pre-filled and unsaved, not holding the first one's", async () => {
    // `account_profiles` is one of the five tables `0094`'s transitional
    // `UNIQUE (edition)` still blocks, so tenant B cannot be GIVEN a profile row —
    // which makes this the one assertion available, and it is the right one: a
    // profile read that was scoped by `edition` alone would hand tenant B the
    // organisation name, business type, city and contact block that the
    // incubator-edition blocks above saved for tenant A.
    const res = await SELF.fetch(`${BASE}/api/account`, {
      headers: { cookie: await login(AX_ADMIN) },
    });
    const body = await res.json<{
      saved: boolean;
      profile: { workEmail: string; org: unknown };
    }>();
    expect(body.saved).toBe(false);
    expect(body.profile.org).toBeNull();
    expect(body.profile.workEmail).toBe(AX_ADMIN);
  });

  it("the price catalogue still crosses, because one book serves the whole product", async () => {
    // The deliberate NON-isolation, asserted so a later sweep cannot "finish the
    // job" by scoping `pricing_versions` without this test objecting. §3 measured
    // five independent reasons, and `0100`'s integrity assertion fails the
    // migration chain if a tenant key appears on any of the eight.
    const read = async (email: string) =>
      (
        await (
          await SELF.fetch(`${BASE}/api/account`, { headers: { cookie: await login(email) } })
        ).json<{ profile: unknown }>()
      ) as Record<string, unknown>;
    const theirs = await read(AX_ADMIN);
    const ours = await read(ADMIN);
    // Both customers are offered the same plans — whatever the catalogue holds,
    // it holds identically for each of them.
    expect(JSON.stringify(theirs.plans ?? null)).toBe(JSON.stringify(ours.plans ?? null));
    const row = await env.DB.prepare(
      "SELECT count(*) n FROM pragma_table_info('pricing_versions') WHERE name = 'tenant_id'",
    ).first<{ n: number }>();
    expect(row!.n, "pricing_versions must NOT be tenant-scoped — plan_multitenancy.md §3").toBe(0);
  });
});

describe("tenancy — the profile upsert, and the refusal that replaces an overwrite", () => {
  it("a second customer's save in an OCCUPIED edition gets its OWN row, and the first's survives", async () => {
    // ══ THIS CASE HAS HAD THREE CORRECT ANSWERS. THE HISTORY IS THE POINT ════
    //
    //   1. `PUT /profile`'s two upserts targeted `ON CONFLICT (edition)`. `0094`
    //      widened the PRIMARY KEY to `(tenant_id, edition)` and left
    //      `UNIQUE (edition)` standing as `account_profiles__pre_tenant_key`, so
    //      that target kept resolving — to THE OTHER CUSTOMER'S ROW. Measured in
    //      D1 in `billing.test.ts`'s `ON CONFLICT` block: the old target wrote the
    //      second customer's organisation name, business type, city, country and
    //      whole contact block INTO the first customer's row, kept
    //      `tenant_id = 't_default'`, added no row, and answered 200.
    //   2. Named against the widened key it was REFUSED with a 500 instead — the
    //      error `0094`'s header intended, and the honest answer while that index
    //      stood, because there was nothing the handler could do that was correct.
    //   3. NOW, after T1 integration's `0101` dropped the index: it SUCCEEDS. The
    //      second customer gets a profile of its own and the first keeps theirs.
    //
    // Both halves are asserted, because either alone can be true for the wrong
    // reason: a save that silently did nothing would also leave tenant A intact.
    const before = await env.DB.prepare(
      "SELECT tenant_id, org_name, city FROM account_profiles WHERE tenant_id = 't_default' AND edition = 'incubator'",
    ).first<{ tenant_id: string; org_name: string | null; city: string | null }>();
    expect(before, "tenant A must hold the incubator profile, or this proves nothing").toBeTruthy();

    // The ORGANISATION branch — the first of this session's three `ON CONFLICT`
    // sites, and the one whose silent overwrite destroyed the most: eleven
    // organisation-details fields plus the whole contact block.
    const res = await req("PUT", "/api/account/profile", await login(AX_ADMIN), {
      ...INDIVIDUAL,
      accountType: "organization",
      workEmail: AX_ADMIN,
      org: { ...ORG, name: `${AX_MARK} Foundation` },
    });
    expect(res.status, await res.text()).toBe(200);

    // Tenant A, untouched. Queried BY TENANT rather than with `first()` over the
    // edition: there are two rows now, and `first()` would pick one arbitrarily —
    // which is how an assertion like this goes quietly vacuous.
    const after = await env.DB.prepare(
      "SELECT tenant_id, org_name, city FROM account_profiles WHERE tenant_id = 't_default' AND edition = 'incubator'",
    ).first<{ tenant_id: string; org_name: string | null; city: string | null }>();
    expect(after, "tenant A's commercial record was destroyed by another customer's save").toEqual(
      before,
    );

    // And tenant B's row exists, under its own key, carrying its own org name.
    const theirs = await env.DB.prepare(
      "SELECT tenant_id, org_name FROM account_profiles WHERE tenant_id = ? AND edition = 'incubator'",
    )
      .bind(AX)
      .first<{ tenant_id: string; org_name: string | null }>();
    expect(theirs, "tenant B's save did not create a row of its own").toBeTruthy();
    expect(theirs!.org_name).toBe(`${AX_MARK} Foundation`);

    // Two profiles in one edition — impossible until `0101`.
    const rows = await env.DB.prepare(
      "SELECT count(*) n FROM account_profiles WHERE edition = 'incubator'",
    ).first<{ n: number }>();
    expect(rows!.n).toBe(2);
  });

  it("POST /orders files the order AND its intent under the buying customer", async () => {
    // The silent half. `account_orders.tenant_id` and
    // `billing_payment_intents.tenant_id` both carry `DEFAULT 't_default'`
    // (`0086:31,33`), so an INSERT naming no tenant answers 200, writes two rows,
    // and files the second customer's purchase against the first. Nothing in the
    // response says so, which is why this reads the rows.
    //
    // ── WHY THIS ONE CUSTOMER IS IN THE **vc** EDITION, STATED PLAINLY ──────
    // Placing an order needs a profile (`account_required`), and the case above is
    // the proof that a second customer cannot get one in an edition tenant A
    // already occupies. The `vc` slot is free in this file — nothing here saves a
    // vc profile — so `t_ay` can hold it and walk the whole wizard.
    //
    // That makes this pair differ in BOTH halves of the workspace key, so it is
    // **not** a test that reads isolate; the same-edition pair above is. What it
    // does prove, and what nothing else can, is that the two INSERTs bind the
    // tenant they were handed rather than falling through to the column default.
    const cookie = await login(AY_ADMIN);
    const saved = await req("PUT", "/api/account/profile", cookie, INDIVIDUAL);
    expect(saved.status, await saved.text()).toBe(200);
    const profileRow = await env.DB.prepare(
      "SELECT tenant_id FROM account_profiles WHERE edition = 'vc'",
    ).first<{ tenant_id: string }>();
    expect(profileRow!.tenant_id).toBe(AY);

    const res = await req("POST", "/api/account/orders", cookie, {
      planCode: "pack_50",
      currency: "INR",
      paymentMethod: "upi",
    });
    const payload = await res.text();
    expect(res.status, payload).toBe(200);
    const { order } = JSON.parse(payload) as { order: AccountOrderView };
    const row = await env.DB.prepare(
      "SELECT o.tenant_id AS o_tenant, i.tenant_id AS i_tenant FROM account_orders o " +
        "JOIN billing_payment_intents i ON i.id = o.intent_id WHERE o.intent_id = ?",
    )
      .bind(order.id)
      .first<{ o_tenant: string; i_tenant: string }>();
    expect(row!.o_tenant).toBe(AY);
    expect(row!.i_tenant).toBe(AY);
    // And it did NOT land in the default tenant, which is the failure being ruled out.
    expect(row!.o_tenant).not.toBe("t_default");
  });
});
