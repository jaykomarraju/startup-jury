import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { reserveCredits } from "../../src/server/decks/versions";
import { grantCredits, ledgerSum, readBalance } from "../../src/server/billing/ledger";
import type { FreeTrialStatus } from "../../src/shared/plans";
import type { TenantScope } from "../../src/shared/tenant";
import type { Env } from "../../src/server/types";

/**
 * P2 (23-Oct tracker, row 9) — "Client signing up for 3 decks free".
 *
 * Before P2 the trial was a counter in the browser: "Use a trial deck" counted
 * down and nothing reached the server, so a new customer's first upload was 402.
 * What this file holds:
 *
 *   1. A NEW workspace takes the trial and the balance AND the ledger both move
 *      by exactly the published `trial.decks` — and the upload gate then lets a
 *      deck through.
 *   2. Once per workspace — a second tap, and two taps at once, grant once.
 *   3. A workspace that already has a trial (the demo's seeded May rows) is not
 *      granted another.
 *   4. One customer's trial is not another's (negative control on the scope).
 *   5. Only a buyer may take it (negative control on the role).
 *   6. `used` counts trial decks by the stated convention, including the shape
 *      GCW is in — credits held BEFORE the trial are spent first.
 *   7. The balance and the ledger never disagree, for any workspace.
 *
 * ── WHY THIS FILE HAS ITS OWN CUSTOMERS ─────────────────────────────────────
 * The trial is once per workspace and the demo workspace already took its own
 * in `0032`, so it cannot be the "new customer". Each case below that needs a
 * fresh trial gets a fresh tenant, created in a FILE-level `beforeAll` — one
 * inside a `describe` is rolled back when that suite ends (project note).
 */

const BASE = "https://example.com";
const DEMO_ADMIN = "nisha.kapoor@demo.startupjury.ai";
const DEMO_JURY = "rajesh.kumar@demo.startupjury.ai";

const E = () => env as unknown as Env;

/** [tenant id, slug, admin email, user id] — each a brand-new customer. */
const FRESH = {
  a: ["t_p2_trial_a", "p2-trial-a", "admin@p2-trial-a.test", "p2_trial_a_admin"],
  b: ["t_p2_trial_b", "p2-trial-b", "admin@p2-trial-b.test", "p2_trial_b_admin"],
  race: ["t_p2_trial_race", "p2-trial-race", "admin@p2-trial-race.test", "p2_trial_race_admin"],
  held: ["t_p2_trial_held", "p2-trial-held", "admin@p2-trial-held.test", "p2_trial_held_admin"],
} as const;

const scopeOf = (tenant: string): TenantScope => ({ tenantId: tenant, edition: "incubator" });

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

interface TrialResponse {
  ok?: true;
  error?: string;
  granted?: number;
  trial: FreeTrialStatus;
  balance: number;
}

async function trialRows(tenant: string) {
  const res = await env.DB.prepare(
    "SELECT id, delta, reason, note, actor_id FROM credit_ledger " +
      "WHERE tenant_id = ? AND edition = 'incubator' AND reason = 'trial_grant'",
  )
    .bind(tenant)
    .all<{ id: string; delta: number; reason: string; note: string | null; actor_id: string | null }>();
  return res.results ?? [];
}

/** The column the upload gate reads, straight off the table — not through the route. */
async function storedBalance(tenant: string): Promise<number | null> {
  const row = await env.DB.prepare(
    "SELECT credits_balance FROM org_settings WHERE tenant_id = ? AND edition = 'incubator'",
  )
    .bind(tenant)
    .first<{ credits_balance: number }>();
  return row?.credits_balance ?? null;
}

/** Every workspace that holds a balance or a movement, and what each says. */
async function everyWorkspace(): Promise<{ tenant: string; edition: string; balance: number; ledger: number }[]> {
  const res = await env.DB.prepare(
    "SELECT w.tenant_id AS tenant, w.edition AS edition, " +
      "COALESCE((SELECT o.credits_balance FROM org_settings o WHERE o.tenant_id = w.tenant_id AND o.edition = w.edition), 0) AS balance, " +
      "COALESCE((SELECT SUM(l.delta) FROM credit_ledger l WHERE l.tenant_id = w.tenant_id AND l.edition = w.edition), 0) AS ledger " +
      "FROM (SELECT tenant_id, edition FROM org_settings UNION SELECT tenant_id, edition FROM credit_ledger) w " +
      "ORDER BY w.tenant_id, w.edition",
  ).all<{ tenant: string; edition: string; balance: number; ledger: number }>();
  return res.results ?? [];
}

beforeAll(async () => {
  for (const [tenant, slug, email, id] of Object.values(FRESH)) {
    await env.DB.prepare(
      "INSERT INTO organizations (id, name, slug, status) VALUES (?, ?, ?, 'active') ON CONFLICT (id) DO NOTHING",
    )
      .bind(tenant, `${slug} Accelerator`, slug)
      .run();
    // The password hash is copied off a seeded user, so `demo1234` signs in.
    await env.DB.prepare(
      "INSERT INTO users (id, tenant_id, name, email, role, edition, initials, password_hash) " +
        "SELECT ?, ?, ?, ?, 'admin', 'incubator', 'PT', password_hash FROM users WHERE email = ?",
    )
      .bind(id, tenant, `${slug} Admin`, email, DEMO_ADMIN)
      .run();
  }
});

describe("the fixture, so nothing below passes for the wrong reason", () => {
  it("gives every fresh customer a sign-in, no balance row and no ledger", async () => {
    for (const [tenant, , email] of Object.values(FRESH)) {
      expect(await login(email), email).toBeTruthy();
      // NO `org_settings` row: the shape every customer after the first is in,
      // and the one where a bare UPDATE would have moved nothing.
      expect(await storedBalance(tenant), tenant).toBeNull();
      expect(await trialRows(tenant), tenant).toEqual([]);
    }
  });

  it("publishes a 3-deck trial, which is the figure the client asked for", async () => {
    const row = await env.DB.prepare(
      "SELECT document FROM pricing_versions WHERE status = 'published'",
    ).first<{ document: string }>();
    expect((JSON.parse(row!.document) as { trial: { decks: number } }).trial.decks).toBe(3);
  });
});

describe("POST /api/account/trial — a new workspace takes the trial", () => {
  const [tenant, , email, userId] = FRESH.a;

  it("reports an untaken trial and a zero balance before anything is granted", async () => {
    const body = await (await req("GET", "/api/account", await login(email))).json<{
      trial: FreeTrialStatus;
      balance: number;
    }>();
    expect(body.trial).toEqual({ decks: 3, taken: false, grantedAt: null, granted: 0, used: 0 });
    expect(body.balance).toBe(0);
    // And the upload gate agrees: no credit, no deck.
    expect(await reserveCredits(E(), scopeOf(tenant), 1)).toBe(false);
  });

  it("moves the balance AND the ledger by exactly 3, in the same workspace", async () => {
    const res = await req("POST", "/api/account/trial", await login(email));
    expect(res.status).toBe(200);
    const body = await res.json<TrialResponse>();
    expect(body.ok).toBe(true);
    expect(body.granted).toBe(3);
    expect(body.balance).toBe(3);
    expect(body.trial).toMatchObject({ decks: 3, taken: true, granted: 3, used: 0 });
    expect(body.trial.grantedAt).toMatch(/^\d{4}-\d{2}-\d{2}/);

    // The table, not the response: the column the upload gate reads.
    expect(await storedBalance(tenant)).toBe(3);
    const rows = await trialRows(tenant);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      delta: 3,
      reason: "trial_grant",
      note: "Free trial — 3 deck evaluations",
      actor_id: userId,
    });
    expect(await ledgerSum(E(), scopeOf(tenant))).toBe(3);
  });

  it("is audited in the Billing category", async () => {
    const row = await env.DB.prepare(
      "SELECT summary FROM audit_log WHERE action = 'trial_granted' AND tenant_id = ? ORDER BY rowid DESC LIMIT 1",
    )
      .bind(tenant)
      .first<{ summary: string }>();
    expect(row?.summary).toBe("Free trial taken — 3 credits added (balance 3)");
  });

  it("lets the next deck through the upload gate, and counts it as a trial deck", async () => {
    expect(await reserveCredits(E(), scopeOf(tenant), 1)).toBe(true);
    const body = await (await req("GET", "/api/account", await login(email))).json<{
      trial: FreeTrialStatus;
      balance: number;
    }>();
    expect(body.trial.used).toBe(1);
    expect(body.balance).toBe(2);
    expect(await ledgerSum(E(), scopeOf(tenant))).toBe(2);
  });

  it("refuses a second trial, says so with the trial it already has, and moves nothing", async () => {
    const res = await req("POST", "/api/account/trial", await login(email));
    expect(res.status).toBe(409);
    const body = await res.json<TrialResponse>();
    expect(body.error).toBe("trial_already_taken");
    expect(body.trial).toMatchObject({ taken: true, granted: 3, used: 1 });
    expect(body.balance).toBe(2);
    expect(await storedBalance(tenant)).toBe(2);
    expect(await trialRows(tenant)).toHaveLength(1);
  });
});

describe("once per workspace, under a race", () => {
  const [tenant, , email] = FRESH.race;

  it("grants exactly once when two requests arrive together", async () => {
    // The double tap on a phone. The guard is evaluated INSIDE the transaction
    // that writes the grant, so the second request sees the first's row.
    const cookie = await login(email);
    const [r1, r2] = await Promise.all([
      req("POST", "/api/account/trial", cookie),
      req("POST", "/api/account/trial", cookie),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    expect(await storedBalance(tenant)).toBe(3);
    expect(await trialRows(tenant)).toHaveLength(1);
  });

  it("grants exactly once when the primitive itself is called twice at once", async () => {
    // The same property one layer down, without HTTP in the way: a guard that
    // refuses must write NEITHER the row NOR the balance.
    const guard = {
      sql:
        "NOT EXISTS (SELECT 1 FROM credit_ledger x WHERE x.tenant_id = ? AND x.edition = ? " +
        "AND x.reason = 'trial_grant')",
      binds: [tenant, "incubator"],
    };
    const before = await storedBalance(tenant);
    const results = await Promise.all([
      grantCredits(E(), scopeOf(tenant), { delta: 3, reason: "trial_grant" }, { guard }),
      grantCredits(E(), scopeOf(tenant), { delta: 3, reason: "trial_grant" }, { guard }),
    ]);
    expect(results.map((r) => r.granted)).toEqual([false, false]);
    expect(await storedBalance(tenant)).toBe(before);
    expect(await trialRows(tenant)).toHaveLength(1);
  });
});

describe("a workspace that already had its trial", () => {
  it("does not grant the demo workspace a second one — its May trial (0032) counts", async () => {
    const cookie = await login(DEMO_ADMIN);
    const before = await readBalance(E(), scopeOf("t_default"));
    const res = await req("POST", "/api/account/trial", cookie);
    expect(res.status).toBe(409);
    expect((await res.json<TrialResponse>()).error).toBe("trial_already_taken");
    expect(await readBalance(E(), scopeOf("t_default"))).toBe(before);
    expect(await trialRows("t_default")).toHaveLength(1);
  });
});

describe("scope — one customer's trial is not another's", () => {
  it("leaves tenant B untaken after tenant A took theirs, and B can still take its own", async () => {
    const [tenantB, , emailB] = FRESH.b;
    const status = await (await req("GET", "/api/account", await login(emailB))).json<{
      trial: FreeTrialStatus;
    }>();
    // Negative control: if the guard or the read were unscoped, A's row above
    // would make B "taken" — this is the assertion that would fail.
    expect(status.trial.taken).toBe(false);
    const res = await req("POST", "/api/account/trial", await login(emailB));
    expect(res.status).toBe(200);
    expect(await storedBalance(tenantB)).toBe(3);
    // And A is exactly where its own describe left it.
    expect(await storedBalance(FRESH.a[0])).toBe(2);
  });
});

describe("only a buyer may take it", () => {
  it("refuses the jury — the router's `upgrade` gate — and grants nothing", async () => {
    const before = await readBalance(E(), scopeOf("t_default"));
    const res = await req("POST", "/api/account/trial", await login(DEMO_JURY));
    expect(res.status).toBe(403);
    expect(await readBalance(E(), scopeOf("t_default"))).toBe(before);
  });
});

describe("`used` — oldest credits first", () => {
  it("does not count an evaluation against the trial while older credits remain (GCW's shape)", async () => {
    const [tenant, , email] = FRESH.held;
    // GCW holds credits from `0108`'s adjustment and has never taken a trial. Give
    // this customer the same shape: an operator grant of 5, through the same
    // primitive, and backdated so it is unambiguously OLDER than the trial.
    const held = await grantCredits(E(), scopeOf(tenant), {
      delta: 5,
      reason: "adjustment",
      note: "Administrator adjustment",
    });
    await env.DB.prepare("UPDATE credit_ledger SET created_at = '2026-01-01 00:00:00' WHERE id = ?")
      .bind(held.entryId)
      .run();

    const cookie = await login(email);
    expect((await req("POST", "/api/account/trial", cookie)).status).toBe(200);
    expect(await storedBalance(tenant)).toBe(8);

    expect(await reserveCredits(E(), scopeOf(tenant), 1)).toBe(true);
    let status = (await (await req("GET", "/api/account", cookie)).json<{ trial: FreeTrialStatus }>()).trial;
    // Counting "debits since the grant" would say 1 here — the rejected rule.
    expect(status.used).toBe(0);

    // Spend past the five that were there first: the sixth evaluation is a trial deck.
    expect(await reserveCredits(E(), scopeOf(tenant), 5)).toBe(true);
    status = (await (await req("GET", "/api/account", cookie)).json<{ trial: FreeTrialStatus }>()).trial;
    expect(status.used).toBe(1);
    expect(await storedBalance(tenant)).toBe(2);
  });
});

// ── The invariant, last, over everything this file did ──────────────────────

describe("SUM(credit_ledger.delta) = credits_balance, for EVERY workspace", () => {
  it("holds for each workspace in the database after the trials above", async () => {
    const rows = await everyWorkspace();
    // Not vacuous: the four fresh customers and the demo's two editions at least.
    expect(rows.length).toBeGreaterThanOrEqual(6);
    for (const [tenant] of Object.values(FRESH)) {
      expect(rows.some((r) => r.tenant === tenant), tenant).toBe(true);
    }
    const drift = rows.filter((r) => r.balance !== r.ledger);
    expect(drift, "a balance moved with no movement behind it").toEqual([]);
  });
});
