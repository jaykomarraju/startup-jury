import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";

/**
 * V6-CURRENCY — the server side: the billing address is captured, and the
 * currency it implies is ENFORCED where the price is computed.
 *
 * The invariant under test, stated once: **a customer whose billing country is
 * India is never priced in USD.** It cannot be a screen rule — `currency`
 * arrives in the request body, so a client that asks for USD with an Indian
 * address would be obeyed, and `priceBreakdown` would then correctly apply no
 * GST, producing a quote that is internally consistent and wrong.
 *
 * ── WHY THIS FILE HAS ITS OWN CUSTOMER ──────────────────────────────────────
 * Worker suites share D1 state in practice (see the project note on it), and
 * `account_profiles` holds ONE row per `(tenant_id, edition)`. If this file
 * saved an Indian billing address on the seeded demo incubator, it would make
 * `account.test.ts`'s "carries NO GST on a non-INR order" fail — correctly,
 * which is exactly why it must not. So `t_cv_v6` is this file's own tenant, with
 * its own admin, and nothing here touches the demo workspace.
 */

const BASE = "https://example.com";
const DEMO_ADMIN = "nisha.kapoor@demo.startupjury.ai";

/** This file's own customer, so no other suite's profile is disturbed. */
const CV = "t_cv_v6";
const CV_ADMIN = "cv.admin@cvtenant.test";
/** A second one, to prove the billing UPDATE is scoped. */
const CW = "t_cw_v6";
const CW_ADMIN = "cw.admin@cwtenant.test";
/** A third, which never fills the billing screen — the shape production is in. */
const CX = "t_cx_v6";
const CX_ADMIN = "cx.admin@cxtenant.test";

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

const PROFILE = {
  accountType: "individual",
  workEmail: "finance@cvtenant.test",
  firstName: "Chitra",
  lastName: "Venkat",
  dialCode: "+91",
  phone: "98765 43210",
  designation: "Finance Lead",
  organizationName: "CV Accelerator",
};

const INDIAN_ADDRESS = {
  name: "CV Accelerator Private Limited",
  city: "Hyderabad",
  country: "India",
  address: "Plot 42, Hitec City, 500081",
};

const US_ADDRESS = {
  name: "CV Accelerator Inc",
  city: "Austin",
  country: "United States",
  address: "600 Congress Ave, TX 78701",
};

interface BillingPayload {
  name: string | null;
  city: string | null;
  country: string | null;
  address: string | null;
  locale: {
    country: string | null;
    currency: string | null;
    taxed: boolean;
    ratePct: number;
    note: string | null;
  };
}

/** `beforeAll` at FILE level: isolated storage rolls back one inside a `describe`. */
beforeAll(async () => {
  for (const [tenant, slug, email, id] of [
    [CV, "cv-v6", CV_ADMIN, "cv_admin"],
    [CW, "cw-v6", CW_ADMIN, "cw_admin"],
    [CX, "cx-v6", CX_ADMIN, "cx_admin"],
  ] as const) {
    await env.DB.prepare(
      "INSERT INTO organizations (id, name, slug, status) VALUES (?, ?, ?, 'active') " +
        "ON CONFLICT (id) DO NOTHING",
    )
      .bind(tenant, `${slug} Accelerator`, slug)
      .run();
    // The password hash is copied off a seeded user, so `demo1234` signs in.
    await env.DB.prepare(
      "INSERT INTO users (id, tenant_id, name, email, role, edition, initials, password_hash) " +
        "SELECT ?, ?, ?, ?, 'admin', 'incubator', 'CV', password_hash FROM users WHERE email = ?",
    )
      .bind(id, tenant, `${slug} Admin`, email, DEMO_ADMIN)
      .run();
  }
});

describe("the fixture, so nothing below passes for the wrong reason", () => {
  it("has three customers of its own, each able to sign in", async () => {
    expect(await login(CV_ADMIN)).toBeTruthy();
    expect(await login(CW_ADMIN)).toBeTruthy();
    expect(await login(CX_ADMIN)).toBeTruthy();
    const row = await env.DB.prepare(
      "SELECT count(*) n FROM account_profiles WHERE tenant_id IN (?, ?, ?)",
    )
      .bind(CV, CW, CX)
      .first<{ n: number }>();
    expect(row!.n, "this file's customers must start with no profile").toBe(0);
  });

  it("0104's four columns exist and are NULL on every row that predates them", async () => {
    for (const column of ["billing_name", "billing_city", "billing_country", "billing_address"]) {
      const info = await env.DB.prepare(
        "SELECT count(*) n FROM pragma_table_info('account_profiles') WHERE name = ?",
      )
        .bind(column)
        .first<{ n: number }>();
      expect(info!.n, column).toBe(1);
    }
    // The production-safety property, asserted against the schema rather than
    // the prose: no DEFAULT, so applying `0104` writes nothing to any row.
    const dflt = await env.DB.prepare(
      "SELECT count(*) n FROM pragma_table_info('account_profiles') " +
        "WHERE name LIKE 'billing_%' AND dflt_value IS NOT NULL",
    ).first<{ n: number }>();
    expect(dflt!.n, "a DEFAULT would re-denominate the rows already in production").toBe(0);
  });
});

describe("GET /api/account — the billing block", () => {
  it("resolves NO currency before the billing screen is filled in", async () => {
    const body = await (
      await req("GET", "/api/account", await login(CV_ADMIN))
    ).json<{ billing: BillingPayload }>();
    expect(body.billing).toEqual({
      name: null,
      city: null,
      country: null,
      address: null,
      locale: { country: null, currency: null, taxed: false, ratePct: 0, note: null },
    });
  });
});

describe("PATCH /api/account/profile — V6's billing screen saves only itself", () => {
  it("refuses to invent a profile from an address alone", async () => {
    // `work_email` is NOT NULL and `0053` CHECKs that an organisation account
    // names its organisation, so there is no honest row to write. The Account
    // screen is what fixes this, and 409 is the same answer POST /orders gives.
    const res = await req("PATCH", "/api/account/profile", await login(CV_ADMIN), {
      billing: INDIAN_ADDRESS,
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "account_required" });
  });

  it("refuses an incomplete address, field by field, and writes nothing", async () => {
    const cookie = await login(CV_ADMIN);
    expect((await req("PUT", "/api/account/profile", cookie, PROFILE)).status).toBe(200);

    const res = await req("PATCH", "/api/account/profile", cookie, {
      billing: { ...INDIAN_ADDRESS, country: "" },
    });
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string; fields: Record<string, string> }>();
    expect(body.error).toBe("invalid_billing_address");
    expect(Object.keys(body.fields)).toEqual(["country"]);
    const row = await env.DB.prepare(
      "SELECT billing_country FROM account_profiles WHERE tenant_id = ?",
    )
      .bind(CV)
      .first<{ billing_country: string | null }>();
    expect(row!.billing_country, "a refused address must not half-write").toBeNull();
  });

  it("saves the four fields, resolves INR with GST, and audits the currency", async () => {
    const res = await req("PATCH", "/api/account/profile", await login(CV_ADMIN), {
      billing: INDIAN_ADDRESS,
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ billing: BillingPayload }>();
    expect(body.billing).toEqual({
      ...INDIAN_ADDRESS,
      locale: {
        country: "India",
        currency: "INR",
        taxed: true,
        ratePct: 18,
        note: "Billed in INR with 18% GST — GST-compliant invoice provided.",
      },
    });
    // The consequence is what is audited: four text fields decided a currency.
    const audit = await env.DB.prepare(
      "SELECT summary FROM audit_log WHERE action = 'account_billing_address_saved' " +
        "AND tenant_id = ? ORDER BY rowid DESC LIMIT 1",
    )
      .bind(CV)
      .first<{ summary: string }>();
    expect(audit?.summary).toContain("billed in INR with 18% GST");
  });

  it("writes only the patching customer's row", async () => {
    // The scope on the UPDATE. Without it, `UPDATE account_profiles SET
    // billing_* = ...` with no predicate rewrites every customer's billing
    // address — and answers 200 doing it.
    const cookie = await login(CW_ADMIN);
    expect(
      (await req("PUT", "/api/account/profile", cookie, { ...PROFILE, workEmail: "ops@cwtenant.test" }))
        .status,
    ).toBe(200);
    expect((await req("PATCH", "/api/account/profile", cookie, { billing: US_ADDRESS })).status).toBe(200);

    const rows = await env.DB.prepare(
      "SELECT tenant_id, billing_city, billing_country FROM account_profiles " +
        "WHERE tenant_id IN (?, ?) ORDER BY tenant_id",
    )
      .bind(CV, CW)
      .all<{ tenant_id: string; billing_city: string; billing_country: string }>();
    expect(rows.results).toEqual([
      { tenant_id: CV, billing_city: "Hyderabad", billing_country: "India" },
      { tenant_id: CW, billing_city: "Austin", billing_country: "United States" },
    ]);
  });
});

describe("PUT /api/account/profile — the full save may carry the address", () => {
  it("accepts a billing block, and an omitted one does not erase what is on file", async () => {
    const cookie = await login(CV_ADMIN);
    // A full save with no `billing` key: the address survives, the way the
    // organisation block already survives an individual save.
    expect((await req("PUT", "/api/account/profile", cookie, PROFILE)).status).toBe(200);
    let body = await (await req("GET", "/api/account", cookie)).json<{ billing: BillingPayload }>();
    expect(body.billing.country).toBe("India");
    expect(body.billing.locale.currency).toBe("INR");

    // And a full save that DOES carry one replaces it, currency and all.
    const res = await req("PUT", "/api/account/profile", cookie, { ...PROFILE, billing: US_ADDRESS });
    expect(res.status).toBe(200);
    body = await res.json<{ billing: BillingPayload }>();
    expect(body.billing.city).toBe("Austin");
    expect(body.billing.locale).toMatchObject({ currency: "USD", taxed: false, ratePct: 0 });

    // Put it back: the order cases below are about the Indian address.
    expect((await req("PATCH", "/api/account/profile", cookie, { billing: INDIAN_ADDRESS })).status).toBe(200);
  });

  it("refuses an invalid billing block without half-saving the profile", async () => {
    const cookie = await login(CV_ADMIN);
    const res = await req("PUT", "/api/account/profile", cookie, {
      ...PROFILE,
      designation: "Chief Financial Officer",
      billing: { ...INDIAN_ADDRESS, address: "" },
    });
    expect(res.status).toBe(400);
    expect((await res.json<{ error: string }>()).error).toBe("invalid_billing_address");
    const row = await env.DB.prepare("SELECT designation FROM account_profiles WHERE tenant_id = ?")
      .bind(CV)
      .first<{ designation: string }>();
    expect(row!.designation, "validated BEFORE the upsert, so nothing was written").toBe("Finance Lead");
  });
});

describe("POST /api/account/orders — the invariant", () => {
  async function orderCount(tenant: string): Promise<number> {
    const row = await env.DB.prepare("SELECT count(*) n FROM account_orders WHERE tenant_id = ?")
      .bind(tenant)
      .first<{ n: number }>();
    return row!.n;
  }

  it("REFUSES to price an Indian billing address in USD, and records nothing", async () => {
    const cookie = await login(CV_ADMIN);
    const before = await orderCount(CV);
    const res = await req("POST", "/api/account/orders", cookie, {
      planCode: "standard",
      currency: "USD",
      paymentMethod: "card",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "currency_not_for_billing_country",
      required: "INR",
      requested: "USD",
      country: "India",
    });
    // Refused BEFORE the price is computed: no intent, no order, nothing to
    // reconcile later. This is the half a 400 alone would not prove.
    expect(await orderCount(CV)).toBe(before);
    const intents = await env.DB.prepare(
      "SELECT count(*) n FROM billing_payment_intents WHERE tenant_id = ? AND currency = 'USD'",
    )
      .bind(CV)
      .first<{ n: number }>();
    expect(intents!.n).toBe(0);
  });

  it("prices the same customer in INR with GST", async () => {
    // The positive control for the case above: the refusal is the currency and
    // not a broken route.
    const res = await req("POST", "/api/account/orders", await login(CV_ADMIN), {
      planCode: "standard",
      currency: "INR",
      paymentMethod: "upi",
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const { order } = await res.json<{ order: { currency: string; taxed: boolean; taxMinor: number } }>();
    expect(order.currency).toBe("INR");
    expect(order.taxed).toBe(true);
    expect(order.taxMinor).toBeGreaterThan(0);
  });

  it("refuses INR for a US billing address, and prices it in USD with no GST", async () => {
    const cookie = await login(CW_ADMIN);
    const refused = await req("POST", "/api/account/orders", cookie, {
      planCode: "standard",
      currency: "INR",
      paymentMethod: "upi",
    });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({
      error: "currency_not_for_billing_country",
      required: "USD",
      country: "United States",
    });

    const ok = await req("POST", "/api/account/orders", cookie, {
      planCode: "standard",
      currency: "USD",
      paymentMethod: "card",
    });
    expect(ok.status, await ok.clone().text()).toBe(200);
    const { order } = await ok.json<{ order: { currency: string; taxed: boolean; taxMinor: number } }>();
    expect(order).toMatchObject({ currency: "USD", taxed: false, taxMinor: 0 });
  });

  it("leaves a customer with NO billing country exactly as it is today", async () => {
    // The production question, as a test. Two `account_profiles` rows predate the
    // billing screen; `0104` adds no default, so they resolve to nothing and the
    // order route constrains nothing. A USD order from such a customer must still
    // be accepted — if this ever starts failing, a migration has begun deciding
    // what a real customer is billed. `t_cx_v6` is that customer: a saved profile
    // and no billing address, which is exactly the deployed rows' shape.
    const cookie = await login(CX_ADMIN);
    expect(
      (await req("PUT", "/api/account/profile", cookie, { ...PROFILE, workEmail: "ops@cxtenant.test" }))
        .status,
    ).toBe(200);
    const body = await (await req("GET", "/api/account", cookie)).json<{ billing: BillingPayload }>();
    expect(body.billing.locale.currency, "this customer must have no billing country").toBeNull();
    const res = await req("POST", "/api/account/orders", cookie, {
      planCode: "standard",
      currency: "USD",
      paymentMethod: "card",
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await res.json<{ order: { currency: string } }>()).order.currency).toBe("USD");
  });

  it("puts the billing address on the pro-forma it generates", async () => {
    // V6: "We use this to set your billing currency and generate your invoice."
    const cookie = await login(CV_ADMIN);
    const { order } = await (
      await req("POST", "/api/account/orders", cookie, {
        planCode: "pack_50",
        currency: "INR",
        paymentMethod: "netbanking",
      })
    ).json<{ order: { id: string } }>();
    const html = await (await req("GET", `/api/account/orders/${order.id}/document`, cookie)).text();
    expect(html).toContain("CV Accelerator Private Limited");
    expect(html).toContain("Plot 42, Hitec City, 500081, Hyderabad, India");
    expect(html).toContain("GST (18%)");
  });
});
