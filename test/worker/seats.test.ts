import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, it, expect } from "vitest";
import { writeSeatGrants, seatCapacity } from "../../src/server/seats/ledger";
import type { SeatOrder, SeatPurchaseResult, SeatsView } from "../../src/shared/seats";

/**
 * W6-C — `/api/seats`: the PURCHASED seat (F0111), enforced and sold.
 *
 * The seed (`0052`) splits each workspace's five purchased seats across tiers to
 * cover the members it already has, highest tier first:
 *   incubator  Premium 1/1 · Pro 3/3 · Standard 1/1   — exactly full
 *   vc         Premium 1/1 · Pro 3/3 · Standard 2/1   — one member over
 * so every test below that adds a member first has to BUY the seat it adds
 * into. Worker storage is isolated per FILE and accumulates across `it`s, so
 * the order of the tests is the order of a real workspace's history.
 *
 * `cohorts.seat_capacity` — the other seat — is asserted untouched at the end.
 */

const BASE = "https://example.com";

const INC_ADMIN = "nisha.kapoor@demo.startupjury.ai";
const INC_SUPER = "priya.sharma@demo.startupjury.ai";
const INC_PM = "raj.kumar@demo.startupjury.ai";
const INC_PA = "sunita.rao@demo.startupjury.ai";
const INC_JURY = "rajesh.kumar@demo.startupjury.ai";
const INC_FOUNDER = "meera.sharma@demo.startupjury.ai";
const VC_ADMIN = "nisha.kapoor.vc@demo.startupjury.ai";
const VC_ANALYST = "rhea.nair@demo.startupjury.ai";

async function login(email: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo1234" }),
  });
  const setCookie = res.headers.get("set-cookie");
  expect(setCookie, `login ${email}`).toBeTruthy();
  return setCookie!.split(";")[0];
}

function req(method: string, path: string, cookie: string, body?: unknown) {
  return SELF.fetch(`${BASE}${path}`, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function view(cookie: string): Promise<SeatsView> {
  const res = await req("GET", "/api/seats", cookie);
  expect(res.status).toBe(200);
  return (await res.json()) as SeatsView;
}

const tier = (v: SeatsView, t: "standard" | "pro" | "premium") => v.tiers.find((x) => x.tier === t)!;

async function purchasedSeats(edition: string): Promise<number> {
  const row = await env.DB.prepare("SELECT seats FROM billing_subscriptions WHERE edition = ?")
    .bind(edition)
    .first<{ seats: number }>();
  return row!.seats;
}

async function userByEmail(email: string) {
  return env.DB.prepare("SELECT id, plan_tier, role, edition FROM users WHERE email = ?")
    .bind(email)
    .first<{ id: string; plan_tier: string; role: string; edition: string }>();
}

/** `cohorts.seat_capacity` / `seats_filled` — the startup seat, which nothing here may move. */
async function cohortSeats() {
  return env.DB.prepare(
    "SELECT COALESCE(SUM(seat_capacity), -1) AS capacity, COALESCE(SUM(seats_filled), -1) AS filled FROM cohorts",
  ).first<{ capacity: number; filled: number }>();
}
let cohortSeatsAtStart: Awaited<ReturnType<typeof cohortSeats>>;
beforeAll(async () => {
  cohortSeatsAtStart = await cohortSeats();
});

// ── The payload ──────────────────────────────────────────────────────────────

describe("GET /api/seats", () => {
  it("reports per-tier capacity, the members holding each seat and the catalogue's prices", async () => {
    const v = await view(await login(INC_ADMIN));
    expect(v.edition).toBe("incubator");
    expect(tier(v, "premium")).toMatchObject({ capacity: 1, used: 1, available: 0, over: 0 });
    expect(tier(v, "pro")).toMatchObject({ capacity: 3, used: 3, available: 0 });
    expect(tier(v, "standard")).toMatchObject({ capacity: 1, used: 1, available: 0 });
    expect(v.capacity).toBe(5);
    // The seat ledger and the Credits & billing tile agree from the first row.
    expect(v.purchasedSeats).toBe(5);
    expect(v.used).toBe(5);
    expect(v.left).toBe(0);

    // Founders and the seeded mentor hold no seat.
    const emails = v.members.map((m) => m.email);
    expect(emails).not.toContain(INC_FOUNDER);
    expect(emails).not.toContain("anil.mehta@demo.startupjury.ai");
    expect(v.superuser?.email).toBe(INC_SUPER);
    expect(v.members.find((m) => m.email === INC_ADMIN)?.isViewer).toBe(true);

    // Prices come from the PUBLISHED catalogue's per-seat subscription plans —
    // nothing in this lane names an amount. The catalogue sells no Premium seat.
    expect(tier(v, "standard").price).toMatchObject({ code: "standard", currency: "INR", amountMinor: 99_900, period: "month" });
    expect(tier(v, "pro").price).toMatchObject({ code: "pro", amountMinor: 199_900 });
    expect(tier(v, "premium").price).toBeNull();
    expect(v.tax.ratePct).toBe(18);
    expect(v.catalogue?.version).toBeGreaterThanOrEqual(1);
    expect(v.paymentConfigured).toBe(false);
  });

  it("reports a workspace holding more members than seats as over, not topped up", async () => {
    const v = await view(await login(VC_ADMIN));
    expect(tier(v, "standard")).toMatchObject({ capacity: 1, used: 2, available: 0, over: 1 });
    expect(v.over).toBe(1);
    expect(v.purchasedSeats).toBe(5);
  });
});

// ── AuthZ: every route, an allowed role and forbidden ones ───────────────────

describe("authorisation", () => {
  const ROUTES: [string, string, unknown][] = [
    ["GET", "/api/seats", undefined],
    ["POST", "/api/seats/members", { email: "x@example.com", role: "jury", tier: "standard" }],
    ["PUT", "/api/seats/members/inc_jury/tier", { tier: "pro" }],
    ["POST", "/api/seats/purchase", { quantities: { standard: 1 } }],
  ];

  it.each([INC_PM, INC_PA, INC_JURY, INC_FOUNDER, VC_ANALYST])("%s is refused every seat route (403)", async (email) => {
    const cookie = await login(email);
    for (const [method, path, body] of ROUTES) {
      const res = await req(method, path, cookie, body);
      expect(res.status, `${method} ${path}`).toBe(403);
    }
    // And a refused purchase recorded nothing.
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM billing_payment_intents WHERE purpose = 'seat'").first<{ n: number }>();
    expect(n!.n).toBe(0);
  });

  it("an unauthenticated caller gets 401", async () => {
    expect((await SELF.fetch(`${BASE}/api/seats`)).status).toBe(401);
  });

  it("an admin and the super user are allowed", async () => {
    expect((await req("GET", "/api/seats", await login(INC_ADMIN))).status).toBe(200);
    expect((await req("GET", "/api/seats", await login(INC_SUPER))).status).toBe(200);
  });
});

// ── Capacity enforced at creation ────────────────────────────────────────────

describe("POST /api/seats/members — capacity", () => {
  it("refuses a member at capacity with a named error, and creates nobody", async () => {
    const admin = await login(INC_ADMIN);
    const res = await req("POST", "/api/seats/members", admin, {
      email: "at.capacity@example.com",
      role: "jury",
      tier: "standard",
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: "seat_limit_reached",
      tier: "standard",
      capacity: 1,
      used: 1,
      message: "No Standard seats left — buy a Standard seat below, then add this user.",
    });
    expect(await userByEmail("at.capacity@example.com")).toBeNull();
  });

  it("validates before it counts", async () => {
    const admin = await login(INC_ADMIN);
    expect((await req("POST", "/api/seats/members", admin, { email: "a@b.co", role: "jury", tier: "gold" })).status).toBe(400);
    expect((await req("POST", "/api/seats/members", admin, { email: "nope", role: "jury", tier: "standard" })).status).toBe(400);
    const superRole = await req("POST", "/api/seats/members", admin, { email: "a@b.co", role: "superuser", tier: "premium" });
    expect(superRole.status).toBe(400);
    expect(await superRole.json()).toMatchObject({ error: "invalid_role" });
  });
});

// ── The purchase ─────────────────────────────────────────────────────────────

describe("POST /api/seats/purchase", () => {
  it("records an intent, charges nothing, and raises the cap by exactly the quantity bought", async () => {
    const admin = await login(INC_ADMIN);
    const before = await view(admin);
    const seatsBefore = await purchasedSeats("incubator");

    const res = await req("POST", "/api/seats/purchase", admin, { quantities: { standard: 2 } });
    expect(res.status).toBe(200);
    const out = (await res.json()) as SeatPurchaseResult;

    // Recorded — not paid, not completed, in as many words.
    expect(out.completed).toBe(false);
    expect(out.paymentTaken).toBe(false);
    expect(out.intent.status).toBe("recorded");
    expect(out.intent.checkoutUrl).toBeNull();
    expect(out.message).toMatch(/nothing has been charged/);

    // ₹999 × 2 = ₹1,998, + 18 % GST (₹359.64) = ₹2,357.64 — through priceBreakdown.
    expect(out.order.money).toMatchObject({ subtotalMinor: 199_800, taxMinor: 35_964, totalMinor: 235_764, taxed: true });
    expect(out.seatsGranted).toEqual({ standard: 2, pro: 0, premium: 0 });

    // The cap moved by exactly two, on that tier and nowhere else.
    expect(tier(out.seats, "standard").capacity).toBe(tier(before, "standard").capacity + 2);
    expect(tier(out.seats, "pro").capacity).toBe(tier(before, "pro").capacity);
    expect(tier(out.seats, "premium").capacity).toBe(tier(before, "premium").capacity);
    expect(await purchasedSeats("incubator")).toBe(seatsBefore + 2);
    expect(out.seats.purchasedSeats).toBe(out.seats.capacity);

    const intent = await env.DB.prepare(
      "SELECT purpose, status, quantity, total_minor, plan_code FROM billing_payment_intents WHERE id = ?",
    )
      .bind(out.intent.id)
      .first<Record<string, unknown>>();
    expect(intent).toMatchObject({ purpose: "seat", status: "recorded", quantity: 2, total_minor: 235_764, plan_code: null });
    const grants = await env.DB.prepare("SELECT tier, quantity, status, reason FROM seat_grants WHERE intent_id = ?")
      .bind(out.intent.id)
      .all();
    expect(grants.results).toEqual([{ tier: "standard", quantity: 2, status: "granted", reason: "purchase" }]);

    // Nothing in this build can say "completed".
    const completed = await env.DB.prepare("SELECT COUNT(*) AS n FROM billing_payment_intents WHERE status = 'completed'").first<{ n: number }>();
    expect(completed!.n).toBe(0);

    const audit = await env.DB.prepare("SELECT category, summary FROM audit_log WHERE action = 'seat_intent_recorded'").first<{ category: string; summary: string }>();
    expect(audit?.category).toBe("billing");
    expect(audit?.summary).toMatch(/2 × Standard .* no payment taken/);
  });

  it("then admits members below the cap and refuses the one at it", async () => {
    const admin = await login(INC_ADMIN);
    // Standard is now 1 used of 3.
    for (const email of ["seat.one@example.com", "seat.two@example.com"]) {
      const res = await req("POST", "/api/seats/members", admin, { email, role: "jury", tier: "standard", title: "Juror" });
      expect(res.status, email).toBe(200);
      const body = (await res.json()) as { user: { id: string; tier: string; name: string }; seats: SeatsView };
      expect(body.user.tier).toBe("standard");
      expect((await userByEmail(email))?.plan_tier).toBe("standard");
    }
    const created = await userByEmail("seat.one@example.com");
    expect(created?.role).toBe("jury");
    // The name comes from the address, as the prototype's roster derives it.
    const named = await env.DB.prepare("SELECT name, title, must_change_password FROM users WHERE email = ?")
      .bind("seat.one@example.com")
      .first<{ name: string; title: string; must_change_password: number }>();
    expect(named).toMatchObject({ name: "Seat One", title: "Juror", must_change_password: 1 });

    const third = await req("POST", "/api/seats/members", admin, { email: "seat.three@example.com", role: "jury", tier: "standard" });
    expect(third.status).toBe(409);
    expect(await third.json()).toMatchObject({ error: "seat_limit_reached", capacity: 3, used: 3 });
    expect(await userByEmail("seat.three@example.com")).toBeNull();

    // The seat bar agrees.
    expect(tier(await view(admin), "standard")).toMatchObject({ capacity: 3, used: 3, available: 0 });
  });

  it("refuses an order the catalogue cannot price, an empty order and an out-of-range quantity", async () => {
    const admin = await login(INC_ADMIN);
    const cases: [unknown, string][] = [
      [{ premium: 1 }, "tier_not_purchasable"],
      [{}, "no_seats_selected"],
      [{ standard: 0 }, "no_seats_selected"],
      [{ standard: 21 }, "invalid_quantity"],
      [{ standard: 1.5 }, "invalid_quantity"],
      [{ gold: 1 }, "invalid_quantity"],
    ];
    const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM billing_payment_intents").first<{ n: number }>();
    for (const [quantities, error] of cases) {
      const res = await req("POST", "/api/seats/purchase", admin, { quantities });
      expect(res.status, JSON.stringify(quantities)).toBe(400);
      expect(await res.json()).toMatchObject({ error });
    }
    const after = await env.DB.prepare("SELECT COUNT(*) AS n FROM billing_payment_intents").first<{ n: number }>();
    expect(after!.n).toBe(before!.n);
  });

  it("takes no card: card-shaped fields are ignored, stored nowhere and echoed nowhere", async () => {
    const admin = await login(INC_ADMIN);
    const res = await req("POST", "/api/seats/purchase", admin, {
      quantities: { pro: 1 },
      cardNumber: "4111111111111111",
      cvv: "123",
      expiry: "12/30",
      cardholder: "Nisha Kapoor",
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toMatch(/4111|cvv|expiry|cardholder|cardNumber/i);

    for (const table of ["billing_payment_intents", "seat_grants"]) {
      const cols = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
      expect(cols.results.map((c) => c.name).join(",")).not.toMatch(/card|cvv|pan|expir/i);
    }
  });

  it("a non-INR order carries NO GST", async () => {
    await env.DB.prepare("UPDATE billing_subscriptions SET currency = 'USD' WHERE edition = 'vc'").run();
    try {
      const admin = await login(VC_ADMIN);
      const v = await view(admin);
      expect(tier(v, "pro").price).toMatchObject({ currency: "USD", amountMinor: 2_400 });
      const res = await req("POST", "/api/seats/purchase", admin, { quantities: { pro: 2 } });
      expect(res.status).toBe(200);
      const out = (await res.json()) as SeatPurchaseResult;
      expect(out.order.money).toMatchObject({ subtotalMinor: 4_800, taxMinor: 0, totalMinor: 4_800, taxed: false });
      expect(tier(out.seats, "pro").capacity).toBe(tier(v, "pro").capacity + 2);
    } finally {
      await env.DB.prepare("UPDATE billing_subscriptions SET currency = 'INR' WHERE edition = 'vc'").run();
    }
  });
});

// ── The per-member plan toggle ───────────────────────────────────────────────

describe("PUT /api/seats/members/:id/tier", () => {
  it("moves a member only into a free seat, freeing the one they held", async () => {
    const admin = await login(INC_ADMIN);
    const member = await userByEmail("seat.one@example.com");

    // Pro: 3 seeded + 1 bought in the card test above = 4 capacity, 3 used.
    const moved = await req("PUT", `/api/seats/members/${member!.id}/tier`, admin, { tier: "pro" });
    expect(moved.status).toBe(200);
    const v = ((await moved.json()) as { seats: SeatsView }).seats;
    expect(tier(v, "pro")).toMatchObject({ used: 4, available: 0 });
    expect(tier(v, "standard")).toMatchObject({ used: 2, available: 1 });
    expect((await userByEmail("seat.one@example.com"))?.plan_tier).toBe("pro");

    // Pro is now full, so a second move is refused and changes nothing.
    const other = await userByEmail("seat.two@example.com");
    const refused = await req("PUT", `/api/seats/members/${other!.id}/tier`, admin, { tier: "pro" });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: "seat_limit_reached", tier: "pro" });
    expect((await userByEmail("seat.two@example.com"))?.plan_tier).toBe("standard");
  });

  it("leaves the account owner's seat to the owner", async () => {
    const admin = await login(INC_ADMIN);
    const res = await req("PUT", "/api/seats/members/inc_superuser/tier", admin, { tier: "standard" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "immutable_superuser" });
    // A founder, a mentor or another edition's member is not a seat holder here.
    expect((await req("PUT", "/api/seats/members/inc_founder/tier", admin, { tier: "pro" })).status).toBe(404);
    expect((await req("PUT", "/api/seats/members/vc_analyst/tier", admin, { tier: "pro" })).status).toBe(404);
  });
});

// ── The super-user gate ──────────────────────────────────────────────────────

describe("the super-user nomination gate", () => {
  it("refuses to add members to a workspace with no live super user", async () => {
    const admin = await login(INC_ADMIN);
    await env.DB.prepare("UPDATE users SET active = 0 WHERE id = 'inc_superuser'").run();
    try {
      const res = await req("POST", "/api/seats/members", admin, { email: "gate@example.com", role: "jury", tier: "standard" });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: "superuser_required" });
      expect(await userByEmail("gate@example.com")).toBeNull();
    } finally {
      await env.DB.prepare("UPDATE users SET active = 1 WHERE id = 'inc_superuser'").run();
    }
  });
});

// ── A checkout still with a provider ─────────────────────────────────────────

describe("writeSeatGrants", () => {
  it("records a pending checkout's seats without raising capacity or the purchased total", async () => {
    const E = env as unknown as import("../../src/server/types").Env;
    const capBefore = await seatCapacity(E, "vc");
    const seatsBefore = await purchasedSeats("vc");
    const intent = `pi_pending_${crypto.randomUUID()}`;
    await env.DB.prepare(
      "INSERT INTO billing_payment_intents (id, edition, purpose, plan_name, quantity, currency, subtotal_minor, tax_minor, total_minor, gst_rate_pct, status) " +
        "VALUES (?, 'vc', 'seat', 'Seats', 3, 'INR', 0, 0, 0, 18, 'redirected')",
    )
      .bind(intent)
      .run();
    const order = {
      lines: [{ tier: "standard", name: "Standard", quantity: 3, unitMinor: 0, amountMinor: 0, period: "month" }],
      seats: 3,
    } as unknown as SeatOrder;
    const granted = await writeSeatGrants(E, { edition: "vc", order, intentId: intent, actorId: "vc_admin", status: "pending" });
    expect(granted).toEqual({ standard: 0, pro: 0, premium: 0 });
    expect(await seatCapacity(E, "vc")).toEqual(capBefore);
    expect(await purchasedSeats("vc")).toBe(seatsBefore);
    const row = await env.DB.prepare("SELECT status FROM seat_grants WHERE intent_id = ?").bind(intent).first<{ status: string }>();
    expect(row?.status).toBe("pending");
  });
});

// ── The other seat ───────────────────────────────────────────────────────────

describe("cohort seat capacity", () => {
  it("is exactly what it was before this file bought, added and moved seats", async () => {
    expect(await cohortSeats()).toEqual(cohortSeatsAtStart);
  });
});
