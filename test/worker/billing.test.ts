import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { reserveCredits, refundCredits } from "../../src/server/decks/versions";
import { recordPaymentIntent, type PaymentClient } from "../../src/server/billing/provider";
import { issueMissingInvoices, listLedger } from "../../src/server/billing/ledger";
import type { CreditsBillingView } from "../../src/shared/plans";

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
    expect(await issueMissingInvoices(E(), "incubator")).toBe(0);
  });

  it("issues one for a purchase written after the fact, with the tax added", async () => {
    await env.DB.prepare(
      "INSERT INTO credit_ledger (id, edition, delta, reason, amount_minor, currency, reference, note, created_at) " +
        "VALUES ('cl_new_purchase', 'vc', 10, 'purchase', 500000, 'INR', 'SIM123', '10-unit pack', '2026-07-01 10:00:00')",
    ).run();
    const issued = await issueMissingInvoices(E(), "vc");
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
        },
        actorId: null,
      },
      () => "2026-09-11T00:00:00.000Z",
      client,
    );
    expect(intent.status).toBe("redirected");
    expect(intent.checkoutUrl).toBe("https://pay.example/checkout/abc");
    // A redirect is still not a payment: no credits moved.
    const rows = await listLedger(E(), "incubator");
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
        "ON CONFLICT (edition, role, task_id) DO UPDATE SET granted = 0",
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
