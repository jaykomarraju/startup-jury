import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { reserveCredits, refundCredits } from "../../src/server/decks/versions";
import { recordPaymentIntent, type PaymentClient } from "../../src/server/billing/provider";
import {
  issueMissingInvoices,
  listInvoices,
  listLedger,
  loadInvoice,
  purchasedTotal,
  readBalance,
  readSubscription,
  usageTotals,
} from "../../src/server/billing/ledger";
import type { CreditsBillingView } from "../../src/shared/plans";
import { DEFAULT_TENANT_ID, type TenantScope } from "../../src/shared/tenant";
import type { Edition } from "../../src/shared/roles";

/**
 * W4-C — Credits & billing (`/api/billing`) and the metering behind it.
 *
 * What this suite exists to hold, in the order it matters:
 *
 *  1. **The money.** An evaluation writes exactly one debit; a refund reverses
 *     it and leaves the balance where it started; two concurrent evaluations
 *     cannot both spend the last credit.
 *  2. **A purchase records an intent and completes nothing** (§1.3) — no credits
 *     granted, no `status='completed'`, and no route here accepts a card (§1.2).
 *  3. **No per-deck rate is served** (§8 Q1, ruled 2026-09-11).
 *  4. AuthZ: a non-admin gets 403 on every verb.
 */

const BASE = "https://example.com";

// Seed incubator logins (migrations/0002_seed.sql).
const ADMIN = "nisha.kapoor@demo.startupjury.ai"; // admin
const PA = "sunita.rao@demo.startupjury.ai"; // program_associate (non-admin)
const JURY = "rajesh.kumar@demo.startupjury.ai"; // jury (non-admin)

async function login(email: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo1234" }),
  });
  const setCookie = res.headers.get("set-cookie");
  return setCookie ? setCookie.split(";")[0] : "";
}

const get = (p: string, c: string) => SELF.fetch(`${BASE}${p}`, { headers: { cookie: c } });

function req(method: string, path: string, cookie: string, body?: unknown) {
  return SELF.fetch(`${BASE}${path}`, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const E = () => env as unknown as import("../../src/server/types").Env;

/**
 * Tests in a worker file share one D1 snapshot, so the metering block works in
 * the **vc** edition and the HTTP block in **incubator**: neither can disturb
 * the other's seeded ledger, and nothing has to be deleted to get a clean read.
 */
const M = "vc" as const;

/**
 * T1-COMMERCE — the workspace helper this suite binds through.
 *
 * `DEFAULT_TENANT_ID` is the organisation every seeded row was backfilled to by
 * `0083`-`0100`, so `W("vc")` is the workspace the seed actually describes. The
 * second-tenant isolation cases below build their own scope instead, which is the
 * point: a suite that only ever passes the default tenant proves the signature
 * compiles and nothing about isolation.
 */
const W = (edition: Edition): TenantScope => ({ tenantId: DEFAULT_TENANT_ID, edition });

async function balance(edition = "incubator"): Promise<number> {
  const row = await env.DB.prepare("SELECT credits_balance FROM org_settings WHERE edition = ?")
    .bind(edition)
    .first<{ credits_balance: number }>();
  return row!.credits_balance;
}

async function setBalance(n: number, edition = "incubator"): Promise<void> {
  await env.DB.prepare("UPDATE org_settings SET credits_balance = ? WHERE edition = ?")
    .bind(n, edition)
    .run();
}

async function ledgerRows(edition = "incubator") {
  const res = await env.DB.prepare(
    "SELECT id, delta, reason, deck_id, amount_minor, currency, note FROM credit_ledger " +
      "WHERE edition = ? ORDER BY rowid ASC",
  )
    .bind(edition)
    .all<{
      id: string;
      delta: number;
      reason: string;
      deck_id: string | null;
      amount_minor: number | null;
      currency: string | null;
      note: string | null;
    }>();
  return res.results ?? [];
}

/** The signed sum of every movement — which must equal the balance. */
async function ledgerSum(edition = "incubator"): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COALESCE(SUM(delta), 0) AS n FROM credit_ledger WHERE edition = ?",
  )
    .bind(edition)
    .first<{ n: number }>();
  return row!.n;
}

// ── 1. Metering: the ledger is the explanation of the balance ────────────────

describe("metering writes the ledger", () => {
  /** Rows this test added, in order. */
  let before = 0;

  beforeEach(async () => {
    await setBalance(50, M);
    before = (await ledgerRows(M)).length;
  });

  const added = async () => (await ledgerRows(M)).slice(before);

  it("an evaluation writes exactly one debit", async () => {
    expect(await reserveCredits(E(), M, 1)).toBe(true);
    const rows = await added();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ delta: -1, reason: "deck_evaluated" });
    expect(await balance(M)).toBe(49);
  });

  it("carries no money — §8 Q1 retired the per-deck rate", async () => {
    await reserveCredits(E(), M, 1);
    const rows = await added();
    expect(rows[0].amount_minor).toBeNull();
    expect(rows[0].currency).toBeNull();
  });

  it("links the debit to its deck when the caller knows it", async () => {
    await reserveCredits(E(), M, 1, { deckId: "vc_deck_wealthos" });
    expect((await added())[0].deck_id).toBe("vc_deck_wealthos");
  });

  it("a refused reservation writes NO row", async () => {
    await setBalance(0, M);
    expect(await reserveCredits(E(), M, 1)).toBe(false);
    expect(await added()).toHaveLength(0);
    expect(await balance(M)).toBe(0);
  });

  it("a refund reverses the debit and leaves the balance where it started", async () => {
    const start = await balance(M);
    await reserveCredits(E(), M, 1, { deckId: "vc_deck_wealthos" });
    await refundCredits(E(), M, 1, { deckId: "vc_deck_wealthos" });

    expect(await balance(M)).toBe(start);
    const rows = await added();
    // The debit is not erased — it is reversed. Two rows that net to zero.
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.reason)).toEqual(["deck_evaluated", "refund"]);
    expect(rows.reduce((sum, r) => sum + r.delta, 0)).toBe(0);
  });

  it("a refund of 0 does nothing at all", async () => {
    await refundCredits(E(), M, 0);
    expect(await added()).toHaveLength(0);
    expect(await balance(M)).toBe(50);
  });

  it("two concurrent evaluations cannot both spend the last credit", async () => {
    await setBalance(1, M);
    const results = await Promise.all([reserveCredits(E(), M, 1), reserveCredits(E(), M, 1)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await balance(M)).toBe(0);
    // And the ledger agrees: one spend happened, so one row exists.
    expect(await added()).toHaveLength(1);
  });

  it("keeps the ledger's sum and the balance moving together", async () => {
    const drift = (await ledgerSum(M)) - (await balance(M));
    await reserveCredits(E(), M, 3);
    await refundCredits(E(), M, 1);
    // Every movement wrote a row of the same size, so the gap never widens.
    expect((await ledgerSum(M)) - (await balance(M))).toBe(drift);
  });

  it("a bulk reservation of n writes one debit of n", async () => {
    await setBalance(50, M);
    expect(await reserveCredits(E(), M, 4)).toBe(true);
    const rows = await added();
    expect(rows).toHaveLength(1);
    expect(rows[0].delta).toBe(-4);
    expect(rows[0].note).toMatch(/4 decks/);
    expect(await balance(M)).toBe(46);
  });
});

// ── 2. The section payload ──────────────────────────────────────────────────

describe("GET /api/billing", () => {
  it("reports the tiles, the plan, the cycle and the ledger", async () => {
    const admin = await login(ADMIN);
    const res = await get("/api/billing", admin);
    expect(res.status).toBe(200);
    const view = (await res.json()) as CreditsBillingView;

    expect(view.edition).toBe("incubator");
    expect(view.balance).toBeGreaterThan(0);
    // `0032` seeds one 50-unit pack purchase — the tile's "of 50 purchased".
    expect(view.purchased).toBe(50);
    expect(view.subscription.planLabel).toBe("Configurable");
    expect(view.subscription.tierLabel).toBe("Enterprise");
    expect(view.subscription.seats).toBe(5);
    expect(view.subscription.cycle).toMatchObject({
      start: "2026-01-01",
      end: "2026-12-31",
      period: "year",
    });
    expect(view.tax).toMatchObject({ ratePct: 18, inclusive: false });
    expect(view.ledger.length).toBeGreaterThanOrEqual(5);
    // §1.3 — no payment provider is configured on any build today.
    expect(view.paymentConfigured).toBe(false);
  });

  it("renders a deck debit as a company sentence with no rupee value", async () => {
    const admin = await login(ADMIN);
    const view = (await (await get("/api/billing", admin)).json()) as CreditsBillingView;
    const debits = view.ledger.filter((e) => e.reason === "deck_evaluated");
    expect(debits.length).toBeGreaterThan(0);
    for (const debit of debits) {
      expect(debit.delta).toBe(-1);
      expect(debit.amountMinor).toBeNull();
      expect(debit.currency).toBeNull();
      expect(debit.description).toMatch(/pitchdeck evaluation$/i);
    }
  });

  it("publishes no per-deck rate anywhere in the catalogue", async () => {
    const admin = await login(ADMIN);
    const view = (await (await get("/api/billing", admin)).json()) as CreditsBillingView;
    expect(view.plans.length).toBeGreaterThan(0);
    expect(view.plans.map((p) => p.code)).not.toContain("base_rate");
    const serialised = JSON.stringify(view);
    expect(serialised).not.toMatch(/\/deck/);
    expect(serialised).not.toMatch(/per deck/i);
    expect(serialised).not.toMatch(/vs base/i);
  });

  it("issues an invoice for each purchase already in the ledger, once", async () => {
    const admin = await login(ADMIN);
    const first = (await (await get("/api/billing", admin)).json()) as CreditsBillingView;
    expect(first.invoices).toHaveLength(1);
    expect(first.invoices[0]).toMatchObject({
      number: "INV-2026-0001",
      currency: "INR",
      subtotalMinor: 2_000_000,
      taxMinor: 360_000,
      totalMinor: 2_360_000,
      ratePct: 18,
      reference: "RZP250603112244",
    });
    // Idempotent: a second read must not issue a duplicate.
    const second = (await (await get("/api/billing", admin)).json()) as CreditsBillingView;
    expect(second.invoices).toHaveLength(1);
    expect(await issueMissingInvoices(E(), W("incubator"))).toBe(0);
  });

  it("issues one for a purchase written after the fact, with the tax added", async () => {
    await env.DB.prepare(
      "INSERT INTO credit_ledger (id, edition, delta, reason, amount_minor, currency, reference, note, created_at) " +
        "VALUES ('cl_new_purchase', 'vc', 10, 'purchase', 500000, 'INR', 'SIM123', '10-unit pack', '2026-07-01 10:00:00')",
    ).run();
    const issued = await issueMissingInvoices(E(), W("vc"));
    expect(issued).toBe(1);
    const row = await env.DB.prepare(
      "SELECT number, subtotal_minor, tax_minor, total_minor FROM billing_invoices WHERE ledger_id = 'cl_new_purchase'",
    ).first<{
      number: string;
      subtotal_minor: number;
      tax_minor: number;
      total_minor: number;
    }>();
    expect(row).toMatchObject({
      subtotal_minor: 500_000,
      tax_minor: 90_000,
      total_minor: 590_000,
    });
    expect(row!.number).toMatch(/^INV-2026-\d{4}$/);
  });

  it("serves the invoice document as a download", async () => {
    const admin = await login(ADMIN);
    const view = (await (await get("/api/billing", admin)).json()) as CreditsBillingView;
    const seeded = view.invoices.find((i) => i.number === "INV-2026-0001")!;
    const res = await get(`/api/billing/invoices/${seeded.id}/document`, admin);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="INV-2026-0001/);
    const html = await res.text();
    expect(html).toContain("INV-2026-0001");
    expect(html).toContain("GST (18%)");
    expect(html).toContain("₹23,600");
    expect(html).toContain("suitable for input tax credit");
  });

  it("404s an invoice from another edition", async () => {
    const admin = await login(ADMIN);
    expect((await get("/api/billing/invoices/inv_cl_vc_0002", admin)).status).toBe(404);
    expect((await get("/api/billing/invoices/inv_nope/document", admin)).status).toBe(404);
  });
});

// ── 3. A purchase records an intent and completes nothing ────────────────────

describe("POST /api/billing/purchase", () => {
  it("records an intent WITHOUT completing a payment", async () => {
    const admin = await login(ADMIN);
    const before = await balance();
    const invoicesBefore = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM billing_invoices WHERE edition = 'incubator'",
    ).first<{ n: number }>();

    const res = await req("POST", "/api/billing/purchase", admin, {
      planCode: "pack_50",
      quantity: 1,
    });
    expect(res.status).toBe(200);
    const payload = (await res.json()) as {
      intent: {
        id: string;
        status: string;
        totalMinor: number;
        checkoutUrl: string | null;
      };
      completed: boolean;
      creditsGranted: number;
      checkout: { hosted: boolean; url: string | null };
      message: string;
    };

    // Recorded, and said to be recorded.
    expect(payload.completed).toBe(false);
    expect(payload.creditsGranted).toBe(0);
    expect(payload.intent.status).toBe("recorded");
    expect(payload.checkout).toEqual({ hosted: false, url: null });
    expect(payload.message).toMatch(/nothing has been charged/i);
    // ₹20,000 + 18 % GST.
    expect(payload.intent.totalMinor).toBe(2_360_000);

    // Nothing was granted and nothing was invoiced.
    expect(await balance()).toBe(before);
    const invoicesAfter = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM billing_invoices WHERE edition = 'incubator'",
    ).first<{ n: number }>();
    expect(invoicesAfter!.n).toBe(invoicesBefore!.n);

    const row = await env.DB.prepare(
      "SELECT status, provider, subtotal_minor, tax_minor, total_minor, checkout_url, plan_code " +
        "FROM billing_payment_intents WHERE id = ?",
    )
      .bind(payload.intent.id)
      .first<Record<string, unknown>>();
    expect(row).toMatchObject({
      status: "recorded",
      provider: "none",
      subtotal_minor: 2_000_000,
      tax_minor: 360_000,
      total_minor: 2_360_000,
      checkout_url: null,
      plan_code: "pack_50",
    });
  });

  it("prices a quantity in integers", async () => {
    const admin = await login(ADMIN);
    const res = await req("POST", "/api/billing/purchase", admin, {
      planCode: "pack_50",
      quantity: 3,
    });
    const payload = (await res.json()) as {
      intent: { totalMinor: number; subtotalMinor: number };
    };
    expect(payload.intent.subtotalMinor).toBe(6_000_000);
    expect(payload.intent.totalMinor).toBe(7_080_000);
  });

  it("never lets a card field in — an instrument in the body is simply not read", async () => {
    const admin = await login(ADMIN);
    const res = await req("POST", "/api/billing/purchase", admin, {
      planCode: "pack_50",
      quantity: 1,
      cardNumber: "4111111111111111",
      cvv: "123",
    });
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { intent: { id: string } };
    // §1.2 — nothing card-shaped is persisted, in any column, anywhere.
    const row = await env.DB.prepare("SELECT * FROM billing_payment_intents WHERE id = ?")
      .bind(payload.intent.id)
      .first<Record<string, unknown>>();
    const serialised = JSON.stringify(row);
    expect(serialised).not.toContain("4111111111111111");
    expect(serialised).not.toContain("123");
    const columns = await env.DB.prepare("PRAGMA table_info(billing_payment_intents)").all<{
      name: string;
    }>();
    for (const col of columns.results ?? []) {
      expect(col.name).not.toMatch(/card|cvv|pan|cvc|expiry/i);
    }
  });

  it("refuses a plan that is not purchasable, unknown, or a bad quantity", async () => {
    const admin = await login(ADMIN);
    expect((await req("POST", "/api/billing/purchase", admin, {})).status).toBe(400);
    expect((await req("POST", "/api/billing/purchase", admin, { planCode: "nope" })).status).toBe(
      404,
    );
    expect(
      (
        await req("POST", "/api/billing/purchase", admin, {
          planCode: "free_trial",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await req("POST", "/api/billing/purchase", admin, {
          planCode: "pack_50",
          quantity: 0,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await req("POST", "/api/billing/purchase", admin, {
          planCode: "pack_50",
          quantity: 2.5,
        })
      ).status,
    ).toBe(400);
    // The base rate is not in the catalogue at all — §8 Q1 removed it.
    expect(
      (
        await req("POST", "/api/billing/purchase", admin, {
          planCode: "base_rate",
        })
      ).status,
    ).toBe(404);
  });

  it("writes a Billing audit row that says no payment was taken", async () => {
    const admin = await login(ADMIN);
    await req("POST", "/api/billing/purchase", admin, {
      planCode: "pack_50",
      quantity: 1,
    });
    const row = await env.DB.prepare(
      "SELECT category, summary FROM audit_log WHERE action = 'billing_intent_recorded' " +
        "ORDER BY created_at DESC LIMIT 1",
    ).first<{ category: string; summary: string }>();
    expect(row?.category).toBe("billing");
    expect(row?.summary).toMatch(/no payment taken/);
  });

  it("reports a provider redirect as redirected, never as completed", async () => {
    // `ADAPTERS` is empty by design (§1.3), so the redirect branch is otherwise
    // unreachable. The seam takes a client the same way `recordSyncAttempt` does.
    const client: PaymentClient = {
      provider: "razorpay",
      createCheckout: async () => ({
        url: "https://pay.example/checkout/abc",
        providerRef: "pr_1",
      }),
    };
    const intent = await recordPaymentIntent(
      E(),
      {
        tenantId: DEFAULT_TENANT_ID,
        edition: "incubator",
        purpose: "credit_pack",
        planCode: "pack_50",
        planName: "50-unit pack",
        units: 50,
        quantity: 1,
        currency: "INR",
        money: {
          subtotalMinor: 2_000_000,
          taxMinor: 360_000,
          totalMinor: 2_360_000,
          ratePct: 18,
          inclusive: false,
          taxed: true,
        },
        actorId: null,
      },
      () => "2026-09-11T00:00:00.000Z",
      client,
    );
    expect(intent.status).toBe("redirected");
    expect(intent.checkoutUrl).toBe("https://pay.example/checkout/abc");
    // A redirect is still not a payment: no credits moved.
    const rows = await listLedger(E(), W("incubator"));
    expect(rows.some((r) => r.reason === "purchase" && r.reference === "pr_1")).toBe(false);
  });

  it("records a provider failure as failed, and never throws", async () => {
    const client: PaymentClient = {
      provider: "stripe",
      createCheckout: async () => {
        throw new Error("gateway down");
      },
    };
    const intent = await recordPaymentIntent(
      E(),
      {
        tenantId: DEFAULT_TENANT_ID,
        edition: "incubator",
        purpose: "subscription",
        planCode: "pro",
        planName: "Pro",
        units: null,
        quantity: 1,
        currency: "INR",
        money: {
          subtotalMinor: 199_900,
          taxMinor: 35_982,
          totalMinor: 235_882,
          ratePct: 18,
          inclusive: false,
          taxed: true,
        },
        actorId: null,
      },
      () => "2026-09-11T00:00:00.000Z",
      client,
    );
    expect(intent.status).toBe("failed");
    expect(intent.checkoutUrl).toBeNull();
    const row = await env.DB.prepare("SELECT error FROM billing_payment_intents WHERE id = ?")
      .bind(intent.id)
      .first<{ error: string }>();
    expect(row?.error).toContain("gateway down");
  });
});

// ── 4. Billing details ──────────────────────────────────────────────────────

describe("PUT /api/billing/subscription", () => {
  it("saves the billing contact and cycle, and audits the change", async () => {
    const admin = await login(ADMIN);
    const res = await req("PUT", "/api/billing/subscription", admin, {
      billingEmail: "accounts@incubator.in",
      gstin: "29abcde1234f1z5",
      cycleAnchor: "2026-04-01",
      billingPeriod: "month",
    });
    expect(res.status).toBe(200);
    const payload = (await res.json()) as {
      subscription: CreditsBillingView["subscription"];
    };
    expect(payload.subscription.billingEmail).toBe("accounts@incubator.in");
    // Normalised — a GSTIN prints on an invoice.
    expect(payload.subscription.gstin).toBe("29ABCDE1234F1Z5");
    expect(payload.subscription.cycle.period).toBe("month");
    // The plan itself is NOT editable here: it changes by purchase.
    expect(payload.subscription.planLabel).toBe("Configurable");
    expect(payload.subscription.seats).toBe(5);

    const audit = await env.DB.prepare(
      "SELECT category, summary FROM audit_log WHERE action = 'billing_details_updated' LIMIT 1",
    ).first<{ category: string; summary: string }>();
    expect(audit?.category).toBe("billing");
    expect(audit?.summary).toMatch(/billing email/);
  });

  it("refuses an invalid email, GSTIN, anchor or period", async () => {
    const admin = await login(ADMIN);
    const bad = async (body: unknown) =>
      (await req("PUT", "/api/billing/subscription", admin, body)).status;
    expect(await bad({ billingEmail: "not-an-email" })).toBe(400);
    expect(await bad({ gstin: "29ABC" })).toBe(400);
    expect(await bad({ cycleAnchor: "01-04-2026" })).toBe(400);
    expect(await bad({ billingPeriod: "fortnight" })).toBe(400);
  });

  it("clears an optional field with null rather than rejecting it", async () => {
    const admin = await login(ADMIN);
    const res = await req("PUT", "/api/billing/subscription", admin, {
      billingEmail: null,
      gstin: null,
    });
    expect(res.status).toBe(200);
    const payload = (await res.json()) as {
      subscription: { billingEmail: null; gstin: null };
    };
    expect(payload.subscription.billingEmail).toBeNull();
    expect(payload.subscription.gstin).toBeNull();
  });
});

// ── 5. AuthZ ────────────────────────────────────────────────────────────────

describe("billing authZ", () => {
  const VERBS: [string, string, unknown?][] = [
    ["GET", "/api/billing"],
    ["PUT", "/api/billing/subscription", { billingEmail: "x@y.co" }],
    ["POST", "/api/billing/purchase", { planCode: "pack_50" }],
    ["GET", "/api/billing/invoices/inv_cl_inc_0002"],
    ["GET", "/api/billing/invoices/inv_cl_inc_0002/document"],
  ];

  it("a non-admin is forbidden from every verb", async () => {
    for (const email of [PA, JURY]) {
      const cookie = await login(email);
      for (const [method, path, body] of VERBS) {
        const res = await req(method, path, cookie, body);
        expect(res.status, `${email} ${method} ${path}`).toBe(403);
      }
    }
  });

  it("an unauthenticated caller is refused", async () => {
    for (const [method, path, body] of VERBS) {
      const res = await req(method, path, "", body);
      expect([401, 403]).toContain(res.status);
    }
  });

  it("revoking the adminconsole task closes the API too", async () => {
    // §8 Q16 — the console and its API are gated on one cell.
    await env.DB.prepare(
      "INSERT INTO role_permissions (edition, role, task_id, granted) " +
        "VALUES ('incubator', 'admin', 'adminconsole', 0) " +
        "ON CONFLICT (tenant_id, edition, role, task_id) DO UPDATE SET granted = 0",
    ).run();
    try {
      const admin = await login(ADMIN);
      expect((await get("/api/billing", admin)).status).toBe(403);
    } finally {
      await env.DB.prepare(
        "UPDATE role_permissions SET granted = 1 WHERE edition = 'incubator' AND role = 'admin' AND task_id = 'adminconsole'",
      ).run();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T1-COMMERCE · TENANT ISOLATION
// ─────────────────────────────────────────────────────────────────────────────
//
// §2 B16: `/api/billing` carried `billing.ts:122,161,242,313,373` — five
// predicates on `edition` alone — over **invoices, subscriptions and payment
// intents**. `edition` has two values, so every customer shared a bucket.
//
// ── WHY EACH CASE ASSERTS BOTH DIRECTIONS ──────────────────────────────────
//
// A scoped read that returns nothing passes an "A cannot see B" assertion for
// the wrong reason — a typo in the predicate, a bind in the wrong position, or a
// fixture that was never written all look identical from that side. So every case
// here also asserts that **tenant B's own read returns tenant B's row**, and the
// aggregate cases additionally assert that the UNSCOPED number still includes
// B's contribution. If the fixture ever stops landing, the negative control fails
// instead of passing vacuously.
//
// `account_profiles` and `billing_subscriptions` are the two tables this session
// cannot give tenant B a row in: `0094`/`0095` left `UNIQUE (edition)` standing as
// a transitional index so T0 could merge green, and integration drops it in
// 0101-0108. That constraint is not worked around here — it is ASSERTED, in the
// upsert block at the end, because the correction this session makes to those
// three `ON CONFLICT` targets is precisely what turns a silent cross-tenant
// overwrite into that loud refusal.

const CX = "t_cx_billing";
const CX_MARK = "CXTENANT";
const CX_ADMIN = "cx.admin@cxtenant.test";
const CX_SCOPE: TenantScope = { tenantId: CX, edition: "incubator" };
const A_SCOPE: TenantScope = W("incubator");

/**
 * FILE-LEVEL, not per-describe, and that is a measured requirement rather than a
 * style choice. `@cloudflare/vitest-pool-workers` runs with isolated storage: each
 * suite's writes sit in their own frame and are popped when the suite ends. A
 * `beforeAll` inside the first `describe` created `cx_admin` and the THIRD
 * describe's login then answered 401, because the user no longer existed. The
 * outermost frame is visible to every suite in the file.
 */
beforeAll(async () => {
  {
    await env.DB.prepare(
      "INSERT INTO organizations (id, name, slug, status) VALUES (?, ?, 'cx-billing', 'active') " +
        "ON CONFLICT (id) DO NOTHING",
    )
      .bind(CX, `${CX_MARK} Ventures`)
      .run();
    // The seeded demo hash, so tenant B's admin can actually sign in — which is
    // what the "B sees its own" half of every route case needs.
    await env.DB.prepare(
      "INSERT INTO users (id, tenant_id, name, email, role, edition, initials, password_hash) " +
        "SELECT 'cx_admin', ?, ?, ?, 'admin', 'incubator', 'CX', password_hash FROM users WHERE email = ?",
    )
      .bind(CX, `${CX_MARK} Admin`, CX_ADMIN, ADMIN)
      .run();
    // Tenant B's own balance row. `org_settings` is NOT one of the five tables a
    // transitional key still blocks (`0089` widened its PK and dropped the old
    // one), so the balance tile is genuinely testable across customers.
    await env.DB.prepare(
      "INSERT INTO org_settings (tenant_id, edition, credits_balance) VALUES (?, 'incubator', 4242)",
    )
      .bind(CX)
      .run();
    // Deliberately extreme values. §11: "a COUNT(*) or an AVG(score) that leaks
    // returns a perfectly ordinary-looking number" — 777 and 4242 are numbers no
    // seeded aggregate can produce, so a leak MOVES and isolation does not.
    await env.DB.prepare(
      "INSERT INTO credit_ledger (id, tenant_id, edition, delta, reason, amount_minor, currency, reference, note, created_at) " +
        "VALUES ('cx_cl_buy', ?, 'incubator', 777, 'purchase', 1000000, 'INR', 'CXREF1', ?, ?)",
    )
      .bind(CX, `${CX_MARK} credit purchase`, new Date().toISOString().replace("T", " ").slice(0, 19))
      .run();
    await env.DB.prepare(
      "INSERT INTO credit_ledger (id, tenant_id, edition, delta, reason, note, created_at) " +
        "VALUES ('cx_cl_spend', ?, 'incubator', -11, 'deck_evaluated', ?, ?)",
    )
      .bind(CX, `${CX_MARK} evaluation`, new Date().toISOString().replace("T", " ").slice(0, 19))
      .run();
    await env.DB.prepare(
      "INSERT INTO billing_payment_intents (id, tenant_id, edition, purpose, plan_name, currency, " +
        "subtotal_minor, tax_minor, total_minor, gst_rate_pct) " +
        "VALUES ('cx_pi', ?, 'incubator', 'credit_pack', ?, 'INR', 100, 18, 118, 18)",
    )
      .bind(CX, `${CX_MARK} intent`)
      .run();
  }
});

describe("tenancy — /api/billing isolates one customer from another", () => {
  it("the fixture really landed, so nothing below passes for the wrong reason", async () => {
    const row = await env.DB.prepare(
      "SELECT count(*) n FROM credit_ledger WHERE tenant_id = ?",
    )
      .bind(CX)
      .first<{ n: number }>();
    expect(row!.n, "tenant B has no ledger rows — every case below is vacuous").toBe(2);
    expect(await login(CX_ADMIN), "tenant B's admin cannot sign in").toBeTruthy();
  });

  it("the balance tile reads one customer's balance, and the other's separately", async () => {
    expect(await readBalance(E(), CX_SCOPE)).toBe(4242);
    expect(await readBalance(E(), A_SCOPE)).not.toBe(4242);
  });

  it("the purchased-credits denominator does not sum across customers", async () => {
    const theirs = await purchasedTotal(E(), CX_SCOPE);
    const ours = await purchasedTotal(E(), A_SCOPE);
    expect(theirs).toBe(777);
    expect(ours).not.toBe(777);
    // The negative control an aggregate needs: prove the numbers are
    // distinguishable at all. The unscoped SUM — which is what this denominator
    // was — is the whole table, and the whole table is exactly the three
    // workspaces that exist in this file: tenant A incubator, tenant A vc (the
    // seed ships both editions), and tenant B. Decomposing it that way rather than
    // asserting `unscoped > ours` is what keeps the case honest: if the fixture
    // ever stops landing, or a fourth workspace appears, the sum stops balancing
    // and this fails instead of quietly losing its power to detect a leak.
    const unscoped = (
      await env.DB.prepare(
        "SELECT COALESCE(SUM(delta), 0) n FROM credit_ledger WHERE reason = 'purchase' AND delta > 0",
      ).first<{ n: number }>()
    )!.n;
    const oursVc = await purchasedTotal(E(), W("vc"));
    expect(unscoped).toBe(ours + oursVc + theirs);
    expect(unscoped).not.toBe(ours);
  });

  it("usage totals count only the asking customer's debits", async () => {
    const cycle = (await readSubscription(E(), CX_SCOPE)).cycle;
    const theirs = await usageTotals(E(), CX_SCOPE, cycle);
    const ours = await usageTotals(E(), A_SCOPE, cycle);
    expect(theirs.usedThisMonth).toBe(11);
    expect(ours.usedThisMonth).not.toBe(theirs.usedThisMonth);
  });

  it("the usage history shows neither customer the other's rows", async () => {
    const theirs = await listLedger(E(), CX_SCOPE);
    const ours = await listLedger(E(), A_SCOPE);
    expect(theirs.map((r) => r.id).sort()).toEqual(["cx_cl_buy", "cx_cl_spend"]);
    expect(ours.some((r) => r.id.startsWith("cx_"))).toBe(false);
  });

  it("an invoice cannot be loaded, listed or downloaded across customers", async () => {
    await issueMissingInvoices(E(), CX_SCOPE);
    const theirs = await listInvoices(E(), CX_SCOPE);
    expect(theirs).toHaveLength(1);
    expect(theirs[0].description).toContain(CX_MARK);
    const ours = await listInvoices(E(), A_SCOPE);
    expect(ours.some((v) => v.description.includes(CX_MARK))).toBe(false);
    // The id is known and the row exists; only the scope keeps it out.
    expect(await loadInvoice(E(), A_SCOPE, theirs[0].id)).toBeNull();
    expect(await loadInvoice(E(), CX_SCOPE, theirs[0].id)).not.toBeNull();
  });

  it("invoice numbering restarts per customer rather than continuing the first one's", async () => {
    // `0097` widened `UNIQUE (edition, number)` to `UNIQUE (tenant_id, edition,
    // number)` so the second customer's first invoice no longer COLLIDES. That
    // removed the outage and left the counter wrong: the sequence was
    // `COUNT(*) WHERE edition = ?`, so tenant B's first document would have been
    // numbered from tenant A's invoice count — a customer whose account opens at
    // INV-2026-0009 with no 0001-0008 anywhere in it.
    const theirs = await listInvoices(E(), CX_SCOPE);
    expect(theirs[0].number).toMatch(/^INV-\d{4}-0001$/);
    const aCount = (
      await env.DB.prepare(
        "SELECT count(*) n FROM billing_invoices WHERE tenant_id = ?",
      )
        .bind(DEFAULT_TENANT_ID)
        .first<{ n: number }>()
    )!.n;
    expect(aCount, "tenant A must already hold an invoice, or the counter proves nothing")
      .toBeGreaterThan(0);
  });

  it("GET /api/billing shows each admin only their own customer's money", async () => {
    const theirs = await (await get("/api/billing", await login(CX_ADMIN))).text();
    expect(theirs).toContain(CX_MARK);
    const ours = await (await get("/api/billing", await login(ADMIN))).text();
    expect(ours, "§2 B16 — tenant B's invoices, intents and ledger crossed into tenant A").not.toContain(
      CX_MARK,
    );
  });
});

describe("tenancy — the ON CONFLICT target, measured in D1 itself", () => {
  // ══ THE CORRECTION THIS SESSION MAKES, AND WHY IT IS NOT COSMETIC ═════════
  //
  // `0095` widened `billing_subscriptions`'s PRIMARY KEY from `(edition)` to
  // `(tenant_id, edition)` and left the old key standing as the transitional
  // unique index `billing_subscriptions__pre_tenant_key`. Its header predicts the
  // old conflict target then fails with "ON CONFLICT clause does not match any
  // PRIMARY KEY or UNIQUE constraint".
  //
  // **It does not fail.** The transitional index IS a matching unique constraint,
  // so `ON CONFLICT (edition)` keeps resolving — and resolves to THE OTHER
  // CUSTOMER'S ROW. The first case below runs the old statement in D1 and records
  // what it really does; the second runs the corrected one. This is the pair of
  // measurements the three-line `ON CONFLICT` edit rests on, and it is asserted
  // here rather than in a comment because D1's SQLite is the only authority on it.
  const PROBE = "cx_oc_probe";

  beforeAll(async () => {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS ${PROBE} (` +
        "tenant_id TEXT NOT NULL DEFAULT 't_default', edition TEXT NOT NULL, v TEXT, " +
        "PRIMARY KEY (tenant_id, edition))",
    ).run();
    await env.DB.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS ${PROBE}__pre_tenant_key ON ${PROBE} (edition)`,
    ).run();
  });

  beforeEach(async () => {
    await env.DB.prepare(`DELETE FROM ${PROBE}`).run();
    await env.DB.prepare(
      `INSERT INTO ${PROBE} (tenant_id, edition, v) VALUES ('t_default', 'incubator', 'tenantA')`,
    ).run();
  });

  it("the OLD target silently overwrites the other customer's row and reports success", async () => {
    // No throw. One row. Still tenant A's key, now holding tenant B's value.
    await env.DB.prepare(
      `INSERT INTO ${PROBE} (tenant_id, edition, v) VALUES (?, 'incubator', 'tenantB') ` +
        "ON CONFLICT (edition) DO UPDATE SET v = excluded.v",
    )
      .bind(CX)
      .run();
    const { results } = await env.DB.prepare(
      `SELECT tenant_id, v FROM ${PROBE}`,
    ).all<{ tenant_id: string; v: string }>();
    expect(results).toEqual([{ tenant_id: "t_default", v: "tenantB" }]);
  });

  it("the WIDENED target still upserts a customer's own row in place", async () => {
    // The positive control, and the reason this correction can ship before
    // integration drops the transitional index: naming the new key does not break
    // the existing single-customer upsert.
    await env.DB.prepare(
      `INSERT INTO ${PROBE} (tenant_id, edition, v) VALUES ('t_default', 'incubator', 'updatedA') ` +
        "ON CONFLICT (tenant_id, edition) DO UPDATE SET v = excluded.v",
    ).run();
    const { results } = await env.DB.prepare(
      `SELECT tenant_id, v FROM ${PROBE}`,
    ).all<{ tenant_id: string; v: string }>();
    expect(results).toEqual([{ tenant_id: "t_default", v: "updatedA" }]);
  });

  it("the WIDENED target refuses a second customer LOUDLY while the transitional index stands", async () => {
    // This is the error `0095` wanted: the correct failure for "T1 integration has
    // not dropped the transitional index yet". It is why `billing_subscriptions`
    // and `account_profiles` stay in `BLOCKED_BY_TRANSITIONAL_KEY`, and it is
    // strictly better than the silent overwrite above.
    await expect(
      env.DB.prepare(
        `INSERT INTO ${PROBE} (tenant_id, edition, v) VALUES (?, 'incubator', 'tenantB') ` +
          "ON CONFLICT (tenant_id, edition) DO UPDATE SET v = excluded.v",
      )
        .bind(CX)
        .run(),
    ).rejects.toThrow(/UNIQUE constraint failed/);
    // And tenant A's row is untouched, which is the whole point.
    const row = await env.DB.prepare(`SELECT v FROM ${PROBE}`).first<{ v: string }>();
    expect(row!.v).toBe("tenantA");
  });

  it("PUT /subscription files a second customer's tax identity BESIDE the first's, not over it", async () => {
    // The THIRD of this session's `ON CONFLICT` sites, exercised through the route
    // rather than the probe table — because the probe proves what SQLite does and
    // this proves what the handler does with it.
    //
    // This case has had three different correct answers, and the history is the
    // point:
    //
    //   1. OLD TARGET, `ON CONFLICT (edition)` — answered 200 and wrote tenant B's
    //      billing email, GSTIN and cycle anchor INTO tenant A's row. GSTIN is what
    //      makes this the worst of the three sites: it prints on every tax invoice
    //      tenant A issues, so one customer's save put another customer's GST
    //      registration on documents already filed.
    //   2. WIDENED TARGET, transitional index still standing — refused with a 500.
    //      Strictly better: an honest failure, and the error `0095` intended.
    //   3. NOW, after `0101` dropped that index — it SUCCEEDS, and the two
    //      customers' subscriptions coexist. This is the outcome the whole wave is
    //      for, and the assertion below is that both halves are true at once: the
    //      second customer got a row, and the first customer's is byte-identical.
    const before = await env.DB.prepare(
      "SELECT tenant_id, billing_email, gstin, cycle_anchor FROM billing_subscriptions " +
        "WHERE tenant_id = 't_default' AND edition = 'incubator'",
    ).first<Record<string, unknown>>();
    expect(before, "tenant A must hold the incubator subscription, or this proves nothing").toBeTruthy();

    const res = await req("PUT", "/api/billing/subscription", await login(CX_ADMIN), {
      billingEmail: `billing@${CX_MARK.toLowerCase()}.test`,
      gstin: "27AAAAA0000A1Z5",
      cycleAnchor: "2027-03-01",
      billingPeriod: "month",
    });
    expect(res.status, await res.text()).toBe(200);

    // Tenant A, untouched — queried BY TENANT, not by `first()`, because there are
    // now two rows in this edition and `first()` would pick one arbitrarily. That
    // is exactly how a test like this goes quietly vacuous.
    const after = await env.DB.prepare(
      "SELECT tenant_id, billing_email, gstin, cycle_anchor FROM billing_subscriptions " +
        "WHERE tenant_id = 't_default' AND edition = 'incubator'",
    ).first<Record<string, unknown>>();
    expect(after, "tenant A's billing identity was overwritten by another customer").toEqual(before);

    // And tenant B has its OWN row, carrying its own GSTIN.
    const theirs = await env.DB.prepare(
      "SELECT tenant_id, billing_email, gstin FROM billing_subscriptions WHERE tenant_id = ? AND edition = 'incubator'",
    )
      .bind(CX)
      .first<{ tenant_id: string; billing_email: string; gstin: string }>();
    expect(theirs, "tenant B's save did not create a row of its own").toBeTruthy();
    expect(theirs!.gstin).toBe("27AAAAA0000A1Z5");
    expect(theirs!.billing_email).toBe(`billing@${CX_MARK.toLowerCase()}.test`);

    // Two rows in one edition — which the transitional index made impossible.
    const rows = await env.DB.prepare(
      "SELECT count(*) n FROM billing_subscriptions WHERE edition = 'incubator'",
    ).first<{ n: number }>();
    expect(rows!.n).toBe(2);
  });

  it("both real tables have SHED the transitional index, and can hold two customers at once", async () => {
    // The predecessor of this case asserted the index was still THERE, as a guard
    // against this suite outliving its subject. It did outlive it: `0101` dropped
    // both, this case failed, and it said what to do. This is that.
    for (const table of ["account_profiles", "billing_subscriptions"]) {
      const idx = await env.DB.prepare(
        "SELECT count(*) n FROM sqlite_master WHERE type = 'index' AND name = ?",
      )
        .bind(`${table}__pre_tenant_key`)
        .first<{ n: number }>();
      expect(
        idx!.n,
        `${table}'s transitional UNIQUE (edition) is back — 0101 has been reverted or did not apply`,
      ).toBe(0);

      // Structural is not enough — but the functional half is asserted only for the
      // table THIS FILE populates. Worker D1 state is shared across test files in
      // this pool, so asserting `account_profiles` holds two customers here would
      // make this case depend on `account.test.ts` having run first: green or red by
      // file order, which is the exact flakiness shape this repo keeps rediscovering.
      // `account.test.ts` owns that proof, through the route.
      if (table === "billing_subscriptions") {
        const tenants = await env.DB.prepare(
          `SELECT count(DISTINCT tenant_id) n FROM ${table} WHERE edition = 'incubator'`,
        ).first<{ n: number }>();
        expect(
          tenants!.n,
          `${table}: only one customer has a row in this edition, so the drop is unproven here`,
        ).toBeGreaterThanOrEqual(2);
      }
    }
  });
});

describe("tenancy — a purchase is recorded against the customer that made it", () => {
  it("POST /api/billing/purchase files the intent under the buying customer, not the first one", async () => {
    // The silent half of the wave. `billing_payment_intents.tenant_id` carries
    // `DEFAULT 't_default'` (`0086:33`), so an INSERT that named no tenant answered
    // 200, wrote a row, and filed the second customer's purchase against the first.
    // Nothing in the response says so, which is why this is asserted on the ROW.
    const cookie = await login(CX_ADMIN);
    const before = (
      await env.DB.prepare("SELECT count(*) n FROM billing_payment_intents WHERE tenant_id = ?")
        .bind(CX)
        .first<{ n: number }>()
    )!.n;
    const res = await req("POST", "/api/billing/purchase", cookie, { planCode: "pack_50", quantity: 1 });
    const payload = await res.text();
    expect(res.status, payload).toBe(200);
    const { intent } = JSON.parse(payload) as { intent: { id: string } };
    const row = await env.DB.prepare("SELECT tenant_id FROM billing_payment_intents WHERE id = ?")
      .bind(intent.id)
      .first<{ tenant_id: string }>();
    expect(row!.tenant_id).toBe(CX);
    const after = (
      await env.DB.prepare("SELECT count(*) n FROM billing_payment_intents WHERE tenant_id = ?")
        .bind(CX)
        .first<{ n: number }>()
    )!.n;
    expect(after).toBe(before + 1);
  });
});
