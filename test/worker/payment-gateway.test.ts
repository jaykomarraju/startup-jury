import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { ledgerSum, readBalance } from "../../src/server/billing/ledger";
import type { TenantScope } from "../../src/shared/tenant";
import type { AccountOrderView } from "../../src/shared/accountOrder";
import type { Env } from "../../src/server/types";

/**
 * P2 (23-Oct tracker, row 12) — "Payment gateway", against a fake Razorpay.
 *
 * The brief's acceptance, as tests:
 *
 *   **A real payment either completes and grants credits or is honestly refused
 *   — no third state where money is taken and nothing is granted.**
 *
 *   • Completes and grants: by the customer's signed return, by the signed
 *     webhook, and — when both went missing — by looking the link up when the
 *     receipt is opened. Each grants ONCE however many of them arrive.
 *   • Honestly refused: a provider that will not open a checkout is a 502 with
 *     nothing charged, and a confirmation that does not match the intent is
 *     recorded for review rather than granted against a guess.
 *   • Never trusted: a forged return, a forged webhook, a signed return the
 *     provider's own API does not back up.
 *
 * The fake is the HTTP contract `billing/razorpay.ts` speaks — `POST` and `GET
 * /v1/payment_links` — holding real state, so "the customer paid" is a state
 * change at the provider and not a flag in the test. `fetch` is stubbed on the
 * global, which is what the adapter calls; the Worker under test runs in this
 * isolate, so the stub is what it reaches.
 *
 * The key and secrets below are TEST values invented here. No Razorpay key, test
 * or live, is in this repository.
 */

const BASE = "https://example.com";
const DEMO_ADMIN = "nisha.kapoor@demo.startupjury.ai";

const KEY_ID = "rzp_test_P2fakeKeyId";
const KEY_SECRET = "p2-fake-key-secret";
const WEBHOOK_SECRET = "p2-fake-webhook-secret";

const TENANT = "t_p2_pay";
const ADMIN = "admin@p2-pay.test";
const SCOPE: TenantScope = { tenantId: TENANT, edition: "incubator" };
const DEMO: TenantScope = { tenantId: "t_default", edition: "incubator" };

const E = () => env as unknown as Env;

/**
 * Carried between describes in module scope, not a `beforeAll`: isolated
 * storage rolls back a fixture made inside one (project note). D1 rows written
 * by an `it` DO persist across the file, which is what these name.
 */
let paidOrder = "";
let paidPayment = "";
/** Orders paid AT THE PROVIDER whose confirmation this application refused or never got. */
const reconcileLater: string[] = [];

// ── The fake provider ────────────────────────────────────────────────────────

interface FakeLink {
  id: string;
  short_url: string;
  reference_id: string;
  amount: number;
  amount_paid: number;
  currency: string;
  status: "created" | "paid" | "expired" | "cancelled";
  accept_partial: boolean;
  callback_url: string;
  callback_method: string;
  payments: { payment_id: string; amount: number; status: string; plink_id: string }[];
}

const links = new Map<string, FakeLink>();
const created: Record<string, unknown>[] = [];
let failNextCreate = false;
let seq = 0;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function fakeRazorpay(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  if (!url.startsWith("https://api.razorpay.com/v1/")) throw new Error(`unexpected outbound fetch: ${url}`);
  const headers = new Headers(init?.headers);
  if (headers.get("authorization") !== `Basic ${btoa(`${KEY_ID}:${KEY_SECRET}`)}`) {
    return json(401, { error: { code: "BAD_REQUEST_ERROR", description: "Authentication failed" } });
  }
  if (url === "https://api.razorpay.com/v1/payment_links" && init?.method === "POST") {
    if (failNextCreate) {
      failNextCreate = false;
      return json(500, { error: { code: "SERVER_ERROR", description: "The server encountered an error" } });
    }
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    created.push(body);
    seq += 1;
    const id = `plink_P2fake${String(seq).padStart(4, "0")}`;
    const link: FakeLink = {
      id,
      short_url: `https://rzp.io/i/${id}`,
      reference_id: String(body.reference_id),
      amount: Number(body.amount),
      amount_paid: 0,
      currency: String(body.currency),
      status: "created",
      accept_partial: body.accept_partial === true,
      callback_url: String(body.callback_url),
      callback_method: String(body.callback_method),
      payments: [],
    };
    links.set(id, link);
    return json(200, link);
  }
  const m = /^https:\/\/api\.razorpay\.com\/v1\/payment_links\/(plink_\w+)$/.exec(url);
  if (m && (init?.method ?? "GET") === "GET") {
    const link = links.get(m[1]);
    return link ? json(200, link) : json(400, { error: { description: "The id provided does not exist" } });
  }
  return json(404, { error: { description: "no such route in the fake" } });
}

/** The customer pays on Razorpay's page. Returns the payment id. */
function pay(linkId: string): string {
  const link = links.get(linkId)!;
  const paymentId = `pay_P2fake${linkId.slice(-4)}`;
  link.status = "paid";
  link.amount_paid = link.amount;
  link.payments = [{ payment_id: paymentId, amount: link.amount, status: "captured", plink_id: linkId }];
  return paymentId;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The query string Razorpay appends to `callback_url`, signed as it signs it. */
async function returnQuery(link: FakeLink, paymentId: string, secret = KEY_SECRET): Promise<string> {
  const signature = await hmacHex(secret, `${link.id}|${link.reference_id}|${link.status}|${paymentId}`);
  return new URLSearchParams({
    razorpay_payment_id: paymentId,
    razorpay_payment_link_id: link.id,
    razorpay_payment_link_reference_id: link.reference_id,
    razorpay_payment_link_status: link.status,
    razorpay_signature: signature,
  }).toString();
}

function paidEvent(link: FakeLink): string {
  const payment = link.payments[0];
  return JSON.stringify({
    entity: "event",
    account_id: "acc_P2fake",
    event: "payment_link.paid",
    contains: ["payment_link", "order", "payment"],
    payload: {
      payment_link: { entity: link },
      payment: { entity: { id: payment.payment_id, amount: payment.amount, currency: link.currency, status: "captured" } },
    },
    created_at: 1761264000,
  });
}

async function webhook(body: string, secret: string | null = WEBHOOK_SECRET): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== null) headers["x-razorpay-signature"] = await hmacHex(secret, body);
  return SELF.fetch(`${BASE}/api/billing/webhooks/razorpay`, { method: "POST", headers, body });
}

// ── The app side ─────────────────────────────────────────────────────────────

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
    redirect: "manual",
  });
}

interface OrderResponse {
  ok?: true;
  error?: string;
  order: AccountOrderView;
  completed: boolean;
  creditsGranted: number;
  checkout?: { hosted: boolean; url: string | null };
  message: string;
}

/** A paid-trial order of `decks` credits from this file's customer. */
async function order(decks: number): Promise<OrderResponse> {
  const res = await req("POST", "/api/account/orders", await login(ADMIN), {
    planCode: "paid_trial",
    currency: "INR",
    paymentMethod: "upi",
    quantity: decks,
  });
  return res.json<OrderResponse>();
}

function linkFor(intentId: string): FakeLink {
  const link = [...links.values()].find((l) => l.reference_id === intentId);
  if (!link) throw new Error(`no link for ${intentId}`);
  return link;
}

async function intentRow(id: string) {
  return env.DB.prepare("SELECT status, provider, provider_ref, error, total_minor FROM billing_payment_intents WHERE id = ?")
    .bind(id)
    .first<{ status: string; provider: string; provider_ref: string | null; error: string | null; total_minor: number }>();
}

async function purchaseRows(reference: string) {
  const res = await env.DB.prepare(
    "SELECT id, tenant_id, edition, delta, reason, amount_minor, currency, reference FROM credit_ledger " +
      "WHERE reason = 'purchase' AND reference = ?",
  )
    .bind(reference)
    .all<{ id: string; tenant_id: string; edition: string; delta: number; reason: string; amount_minor: number; currency: string; reference: string }>();
  return res.results ?? [];
}

beforeAll(async () => {
  await env.DB.prepare(
    "INSERT INTO organizations (id, name, slug, status) VALUES (?, 'P2 Pay', 'p2-pay', 'active') ON CONFLICT (id) DO NOTHING",
  )
    .bind(TENANT)
    .run();
  await env.DB.prepare(
    "INSERT INTO users (id, tenant_id, name, email, role, edition, initials, password_hash) " +
      "SELECT 'p2_pay_admin', ?, 'P2 Pay Admin', ?, 'admin', 'incubator', 'PP', password_hash FROM users WHERE email = ?",
  )
    .bind(TENANT, ADMIN, DEMO_ADMIN)
    .run();
  // The commercial record, through the routes a customer uses: the Account
  // screen, then V6's billing screen with an Indian address (INR, GST).
  const cookie = await login(ADMIN);
  expect(
    (
      await req("PUT", "/api/account/profile", cookie, {
        accountType: "individual",
        workEmail: "finance@p2-pay.test",
        firstName: "Pia",
        lastName: "Rao",
        dialCode: "+91",
        phone: "98765 43210",
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await req("PATCH", "/api/account/profile", cookie, {
        billing: { name: "P2 Pay Pvt Ltd", city: "Pune", country: "India", address: "1 FC Road, 411004" },
      })
    ).status,
  ).toBe(200);

  vi.stubGlobal("fetch", vi.fn(fakeRazorpay));
  Object.assign(env, {
    PAYMENTS_RAZORPAY_KEY: `${KEY_ID}:${KEY_SECRET}`,
    PAYMENTS_RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(env, "PAYMENTS_RAZORPAY_KEY");
  Reflect.deleteProperty(env, "PAYMENTS_RAZORPAY_WEBHOOK_SECRET");
});

// ── 1. Opening a checkout ────────────────────────────────────────────────────

describe("with the Razorpay key set, an order opens a hosted checkout and grants nothing yet", () => {
  it("says a provider is configured", async () => {
    const body = await (await req("GET", "/api/account", await login(ADMIN))).json<{ paymentConfigured: boolean }>();
    expect(body.paymentConfigured).toBe(true);
  });

  it("creates a full-amount Payment Link for the intent and hands back its page", async () => {
    const before = await readBalance(E(), SCOPE);
    const res = await order(20);
    expect(res.ok).toBe(true);
    expect(res.order.status).toBe("redirected");
    expect(res.completed).toBe(false);
    expect(res.creditsGranted).toBe(0);
    const link = linkFor(res.order.id);
    expect(res.checkout).toEqual({ hosted: true, url: link.short_url });

    // What Razorpay was asked for: the intent's TOTAL, partial payments OFF, our
    // intent as the reference, and a return to this deployment's return route.
    const sent = created.find((b) => b.reference_id === res.order.id)!;
    expect(sent).toMatchObject({
      amount: 236_000, // 20 × ₹100 + 18 % GST
      currency: "INR",
      accept_partial: false,
      reference_id: res.order.id,
      callback_method: "get",
    });
    expect(String(sent.callback_url)).toBe(`${E().APP_BASE_URL}/api/billing/return`);
    // §1.2 — nothing card-shaped crosses to the provider either.
    expect(JSON.stringify(sent)).not.toMatch(/card|cvv|expiry|upi_id/i);
    // Redirected is not paid.
    expect(await readBalance(E(), SCOPE)).toBe(before);
    expect(await purchaseRows(res.order.id)).toEqual([]);
  });
});

// ── 2. Completes and grants — by the return ──────────────────────────────────

describe("the customer's return", () => {
  it("is NOT trusted when the signature is forged — nothing is granted", async () => {
    const res = await order(10);
    const link = linkFor(res.order.id);
    const paymentId = pay(link.id);
    const before = await readBalance(E(), SCOPE);
    const forged = await returnQuery(link, paymentId, "not-the-key-secret");
    const back = await SELF.fetch(`${BASE}/api/billing/return?${forged}`, { redirect: "manual" });
    expect(back.status).toBe(303);
    expect((await intentRow(res.order.id))?.status).toBe("redirected");
    expect(await readBalance(E(), SCOPE)).toBe(before);
    // Leave it paid-at-the-provider: the reconcile test below applies it.
    reconcileLater.push(res.order.id);
  });

  it("is NOT trusted for the amount — a signed 'paid' the provider's API does not back is ignored", async () => {
    const res = await order(10);
    const link = linkFor(res.order.id);
    // Sign a "paid" return for a link Razorpay still holds as unpaid.
    link.status = "paid";
    const query = await returnQuery(link, "pay_P2neverHappened");
    link.status = "created";
    const before = await readBalance(E(), SCOPE);
    await SELF.fetch(`${BASE}/api/billing/return?${query}`, { redirect: "manual" });
    expect((await intentRow(res.order.id))?.status).toBe("redirected");
    expect(await readBalance(E(), SCOPE)).toBe(before);
  });

  it("completes the order and grants its credits — balance, ledger and invoice together", async () => {
    const res = await order(20);
    const link = linkFor(res.order.id);
    const paymentId = pay(link.id);
    const before = await readBalance(E(), SCOPE);

    const back = await SELF.fetch(`${BASE}/api/billing/return?${await returnQuery(link, paymentId)}`, {
      redirect: "manual",
    });
    expect(back.status).toBe(303);
    expect(back.headers.get("location")).toBe(`/app/account?order=${res.order.id}`);

    expect((await intentRow(res.order.id))?.status).toBe("completed");
    expect(await readBalance(E(), SCOPE)).toBe(before + 20);
    const rows = await purchaseRows(paymentId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenant_id: TENANT,
      edition: "incubator",
      delta: 20,
      amount_minor: 200_000, // the stated price, ex-GST — `0032`'s meaning
      currency: "INR",
      reference: paymentId,
    });
    const invoice = await env.DB.prepare(
      "SELECT number, intent_id, ledger_id, subtotal_minor, tax_minor, total_minor, reference FROM billing_invoices WHERE intent_id = ?",
    )
      .bind(res.order.id)
      .first<Record<string, unknown>>();
    expect(invoice).toMatchObject({
      intent_id: res.order.id,
      ledger_id: rows[0].id,
      subtotal_minor: 200_000,
      tax_minor: 36_000,
      total_minor: 236_000,
      reference: paymentId,
    });
    expect(String(invoice?.number)).toMatch(/^INV-\d{4}-\d{4}$/);
    const audit = await env.DB.prepare(
      "SELECT actor_id, actor_label, summary FROM audit_log WHERE action = 'payment_completed' AND target_id = ?",
    )
      .bind(res.order.id)
      .first<{ actor_id: string | null; actor_label: string; summary: string }>();
    expect(audit).toMatchObject({ actor_id: null, actor_label: "Razorpay" });
    expect(audit?.summary).toContain(`Transaction ID: ${paymentId}`);
    expect(await ledgerSum(E(), SCOPE)).toBe(await readBalance(E(), SCOPE));
    paidOrder = res.order.id;
    paidPayment = paymentId;
  });

  it("grants once however many times the customer comes back", async () => {
    const link = linkFor(paidOrder);
    const before = await readBalance(E(), SCOPE);
    for (let i = 0; i < 3; i += 1) {
      await SELF.fetch(`${BASE}/api/billing/return?${await returnQuery(link, paidPayment)}`, { redirect: "manual" });
    }
    expect(await readBalance(E(), SCOPE)).toBe(before);
    expect(await purchaseRows(paidPayment)).toHaveLength(1);
  });

  it("serves the paid order's REAL invoice, and the unpaid one's pro-forma", async () => {
    const cookie = await login(ADMIN);
    const paid = await (await req("GET", `/api/account/orders/${paidOrder}/document`, cookie)).text();
    expect(paid).toMatch(/INV-\d{4}-\d{4}/);
    expect(paid).not.toContain("NOT A TAX INVOICE");
    const unpaid = await order(10);
    const pro = await (await req("GET", `/api/account/orders/${unpaid.order.id}/document`, cookie)).text();
    expect(pro).toContain("NOT A TAX INVOICE · NO PAYMENT RECEIVED");
  });
});

// ── 3. Completes and grants — by the webhook ─────────────────────────────────

describe("the webhook", () => {
  it("grants a payment whose customer never came back", async () => {
    const res = await order(10);
    const link = linkFor(res.order.id);
    const paymentId = pay(link.id);
    const before = await readBalance(E(), SCOPE);
    const hook = await webhook(paidEvent(link));
    expect(hook.status).toBe(200);
    expect(await hook.json()).toEqual({ ok: true, outcome: "granted" });
    expect(await readBalance(E(), SCOPE)).toBe(before + 10);
    expect(await purchaseRows(paymentId)).toHaveLength(1);

    // Razorpay delivers at least once: the second delivery changes nothing.
    const again = await webhook(paidEvent(link));
    expect(await again.json()).toEqual({ ok: true, outcome: "already_completed" });
    expect(await readBalance(E(), SCOPE)).toBe(before + 10);
  });

  it("does not double-grant a payment the return already applied", async () => {
    const before = await readBalance(E(), SCOPE);
    const hook = await webhook(paidEvent(linkFor(paidOrder)));
    expect(await hook.json()).toEqual({ ok: true, outcome: "already_completed" });
    expect(await readBalance(E(), SCOPE)).toBe(before);
  });

  it("refuses a forged webhook with 401 and grants nothing", async () => {
    const res = await order(10);
    const link = linkFor(res.order.id);
    pay(link.id);
    const before = await readBalance(E(), SCOPE);
    expect((await webhook(paidEvent(link), "not-the-webhook-secret")).status).toBe(401);
    expect((await webhook(paidEvent(link), null)).status).toBe(401);
    expect((await intentRow(res.order.id))?.status).toBe("redirected");
    expect(await readBalance(E(), SCOPE)).toBe(before);
    reconcileLater.push(res.order.id);
  });

  it("answers 503 — so Razorpay retries — while the webhook secret is not set", async () => {
    Reflect.deleteProperty(env, "PAYMENTS_RAZORPAY_WEBHOOK_SECRET");
    try {
      const res = await webhook(JSON.stringify({ event: "payment_link.paid" }));
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "webhook_secret_not_configured" });
    } finally {
      Object.assign(env, { PAYMENTS_RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET });
    }
  });

  it("records a payment that does not match its intent for review, and grants nothing", async () => {
    const res = await order(10);
    const link = linkFor(res.order.id);
    pay(link.id);
    // The provider reports a different sum than the intent's. With partial
    // payments off this cannot happen at Razorpay; if it ever does, it must be
    // visible — not granted against a guess, and not silently dropped.
    link.amount = 1_000;
    link.amount_paid = 1_000;
    link.payments[0].amount = 1_000;
    const before = await readBalance(E(), SCOPE);
    const hook = await webhook(paidEvent(link));
    expect(await hook.json()).toEqual({ ok: true, outcome: "needs_review" });
    expect(await readBalance(E(), SCOPE)).toBe(before);
    const row = await intentRow(res.order.id);
    expect(row?.status).toBe("redirected");
    expect(row?.error).toMatch(/^payment_needs_review: paid ₹10, intent total is ₹1,180/);
    const audit = await env.DB.prepare(
      "SELECT summary FROM audit_log WHERE action = 'payment_needs_review' AND target_id = ?",
    )
      .bind(res.order.id)
      .first<{ summary: string }>();
    expect(audit?.summary).toMatch(/received but NOT applied/);
  });

  it("closes a link that expired unpaid, and a late 'expired' never undoes a payment", async () => {
    const res = await order(10);
    const link = linkFor(res.order.id);
    link.status = "expired";
    const closed = JSON.stringify({ event: "payment_link.expired", payload: { payment_link: { entity: link } } });
    expect((await webhook(closed)).status).toBe(200);
    expect((await intentRow(res.order.id))?.status).toBe("cancelled");

    const paid = linkFor(paidOrder);
    const late = JSON.stringify({
      event: "payment_link.expired",
      payload: { payment_link: { entity: { ...paid, status: "expired" } } },
    });
    await webhook(late);
    expect((await intentRow(paidOrder))?.status).toBe("completed");
  });

  it("acknowledges a reference that is not this deployment's without retrying forever", async () => {
    const stranger: FakeLink = {
      id: "plink_P2stranger",
      short_url: "https://rzp.io/i/x",
      reference_id: "pi_00000000-0000-4000-8000-000000000000",
      amount: 100,
      amount_paid: 100,
      currency: "INR",
      status: "paid",
      accept_partial: false,
      callback_url: "",
      callback_method: "get",
      payments: [{ payment_id: "pay_P2stranger", amount: 100, status: "captured", plink_id: "plink_P2stranger" }],
    };
    const hook = await webhook(paidEvent(stranger));
    expect(hook.status).toBe(200);
    expect(await hook.json()).toEqual({ ok: true, outcome: "unknown_reference" });
  });
});

// ── 4. Completes and grants — when both went missing ─────────────────────────

describe("opening the receipt applies a payment nobody reported", () => {
  it("looks the link up and grants, for each order paid at the provider but never confirmed here", async () => {
    expect(reconcileLater.length).toBe(2);
    const cookie = await login(ADMIN);
    for (const id of reconcileLater) {
      const before = await readBalance(E(), SCOPE);
      const view = await (await req("GET", `/api/account/orders/${id}`, cookie)).json<AccountOrderView>();
      expect(view.status, id).toBe("completed");
      expect(await readBalance(E(), SCOPE)).toBe(before + 10);
      // And opening it again is a read, not a second grant.
      await req("GET", `/api/account/orders/${id}`, cookie);
      expect(await readBalance(E(), SCOPE)).toBe(before + 10);
    }
  });
});

// ── 5. Honestly refused ──────────────────────────────────────────────────────

describe("a checkout the provider will not open", () => {
  it("is a 502 that says nothing was charged — not an `ok: true`", async () => {
    failNextCreate = true;
    const before = await readBalance(E(), SCOPE);
    const res = await req("POST", "/api/account/orders", await login(ADMIN), {
      planCode: "paid_trial",
      currency: "INR",
      paymentMethod: "upi",
      quantity: 10,
    });
    expect(res.status).toBe(502);
    const body = await res.json<OrderResponse>();
    expect(body.error).toBe("checkout_failed");
    expect(body.order.status).toBe("failed");
    expect(body.message).toMatch(/Nothing has been charged/);
    expect(await readBalance(E(), SCOPE)).toBe(before);
    // The provider's own words reach the row; the key does not.
    const row = await intentRow(body.order.id);
    expect(row?.error).toBe("Error: razorpay 500: The server encountered an error");
    expect(JSON.stringify(row)).not.toContain(KEY_SECRET);
  });
});

// ── 6. The console's purchase goes through the same gateway ─────────────────

describe("Admin console → Credits & billing", () => {
  it("opens a checkout, and the payment lands in the buying workspace and nowhere else", async () => {
    const cookie = await login(DEMO_ADMIN);
    const tenantBefore = await readBalance(E(), SCOPE);
    const demoBefore = await readBalance(E(), DEMO);
    const res = await req("POST", "/api/billing/purchase", cookie, { planCode: "paid_trial", quantity: 15 });
    expect(res.status).toBe(200);
    const { intent } = await res.json<{ intent: { id: string; status: string; checkoutUrl: string } }>();
    expect(intent.status).toBe("redirected");
    const link = linkFor(intent.id);
    const paymentId = pay(link.id);

    const back = await SELF.fetch(`${BASE}/api/billing/return?${await returnQuery(link, paymentId)}`, {
      redirect: "manual",
    });
    // A console purchase has no My account order, so it lands back on the console.
    expect(back.headers.get("location")).toBe("/app/admin?section=bl");
    expect(await readBalance(E(), DEMO)).toBe(demoBefore + 15);
    expect(await readBalance(E(), SCOPE)).toBe(tenantBefore);
  });
});

// ── 7. The session boundary did not move ─────────────────────────────────────

describe("only the webhook and the return are reachable without a session", () => {
  it("still answers 401 to every other billing and account route with no cookie", async () => {
    // Negative control for registering two routes ahead of `requireAuth`.
    for (const [method, path] of [
      ["GET", "/api/billing"],
      ["POST", "/api/billing/purchase"],
      ["PUT", "/api/billing/subscription"],
      ["GET", "/api/account"],
      ["POST", "/api/account/orders"],
      ["POST", "/api/account/trial"],
    ] as const) {
      const res = await SELF.fetch(`${BASE}${path}`, { method, headers: { "content-type": "application/json" }, body: method === "GET" ? undefined : "{}" });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });
});

// ── The invariant, over everything above ─────────────────────────────────────

describe("SUM(credit_ledger.delta) = credits_balance, for EVERY workspace", () => {
  it("holds after every grant, replay, refusal and review in this file", async () => {
    const res = await env.DB.prepare(
      "SELECT w.tenant_id AS tenant, w.edition AS edition, " +
        "COALESCE((SELECT o.credits_balance FROM org_settings o WHERE o.tenant_id = w.tenant_id AND o.edition = w.edition), 0) AS balance, " +
        "COALESCE((SELECT SUM(l.delta) FROM credit_ledger l WHERE l.tenant_id = w.tenant_id AND l.edition = w.edition), 0) AS ledger " +
        "FROM (SELECT tenant_id, edition FROM org_settings UNION SELECT tenant_id, edition FROM credit_ledger) w",
    ).all<{ tenant: string; edition: string; balance: number; ledger: number }>();
    const rows = res.results ?? [];
    expect(rows.some((r) => r.tenant === TENANT)).toBe(true);
    expect(rows.filter((r) => r.balance !== r.ledger)).toEqual([]);
  });
});
