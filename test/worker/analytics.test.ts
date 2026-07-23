import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

const BASE = "https://example.com";

// Seed logins (0002_seed.sql).
const INC_ADMIN = "nisha.kapoor@demo.startupjury.ai";
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
  return setCookie ? setCookie.split(";")[0] : "";
}

const get = (p: string, c: string) => SELF.fetch(`${BASE}${p}`, { headers: { cookie: c } });

describe("analytics — incubator reports", () => {
  it("cohort summary returns real aggregates from seeded decks", async () => {
    const c = await login(INC_ADMIN);
    const res = await get("/api/analytics/cohort", c);
    expect(res.status).toBe(200);
    const d = (await res.json()) as {
      evaluated: number;
      avgScore: number;
      recommended: number;
      distribution: Array<{ count: number }>;
      ranking: Array<{ name: string }>;
    };
    expect(d.evaluated).toBeGreaterThan(5);
    expect(d.avgScore).toBeGreaterThan(0);
    expect(d.recommended).toBeGreaterThan(0);
    expect(d.ranking.length).toBeGreaterThan(0);
    expect(d.distribution.reduce((n, b) => n + b.count, 0)).toBe(d.evaluated);
  });

  it("evaluator calibration surfaces the four seeded evaluators with lenient/strict", async () => {
    const c = await login(INC_ADMIN);
    const d = (await (await get("/api/analytics/evaluators", c)).json()) as {
      evaluators: Array<{ name: string; vsCohort: number }>;
      mostLenient: { vsCohort: number } | null;
      strictest: { vsCohort: number } | null;
    };
    expect(d.evaluators.length).toBe(4);
    expect(d.mostLenient!.vsCohort).toBeGreaterThanOrEqual(d.strictest!.vsCohort);
  });

  it("score drift compares AI vs human final per deck", async () => {
    const c = await login(INC_ADMIN);
    const d = (await (await get("/api/analytics/drift", c)).json()) as {
      rows: Array<{ name: string; aiScore: number; humanScore: number; drift: number }>;
      agreement: number;
    };
    expect(d.rows.length).toBeGreaterThan(3);
    // Each drift equals humanScore − aiScore (within rounding).
    for (const r of d.rows) expect(Math.abs(r.drift - (r.humanScore - r.aiScore))).toBeLessThanOrEqual(0.11);
  });

  it("funnel top counts all decks and is monotonic", async () => {
    const c = await login(INC_ADMIN);
    const d = (await (await get("/api/analytics/funnel", c)).json()) as {
      rows: Array<{ count: number }>;
      top: number;
    };
    expect(d.top).toBeGreaterThan(0);
    const counts = d.rows.map((r) => r.count);
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]);
  });

  it("founders are forbidden from reports", async () => {
    const c = await login(INC_FOUNDER);
    expect((await get("/api/analytics/cohort", c)).status).toBe(403);
    expect((await get("/api/analytics/funnel", c)).status).toBe(403);
  });
});

describe("analytics — jury-personal reports (exclusive)", () => {
  it("jury sees their own evaluations; admin is not bypassed", async () => {
    const jury = await login(INC_JURY);
    const res = await get("/api/analytics/my/decks", jury);
    expect(res.status).toBe(200);
    const d = (await res.json()) as { evaluated: number; decks: unknown[] };
    expect(d.evaluated).toBeGreaterThan(0);

    // repdecks is exclusive to jury — an admin (no superuser bypass) is forbidden.
    const admin = await login(INC_ADMIN);
    expect((await get("/api/analytics/my/decks", admin)).status).toBe(403);
  });
});

describe("analytics — VC reports", () => {
  it("capital deployment sums the funded portfolio", async () => {
    const c = await login(VC_ADMIN);
    const d = (await (await get("/api/analytics/capital", c)).json()) as {
      committed: number;
      deployed: number;
      dryPowder: number;
      companies: number;
    };
    expect(d.committed).toBe(300);
    expect(d.companies).toBe(8); // 7 seeded + QuantIQ
    expect(d.deployed).toBe(92); // 22+8+12+6+5+15+20+4
    expect(d.dryPowder).toBe(208);
  });

  it("portfolio construction mixes sectors/stages/geo", async () => {
    const c = await login(VC_ADMIN);
    const d = (await (await get("/api/analytics/portfolio", c)).json()) as {
      companies: number;
      sectorMix: Array<{ label: string; pct: number }>;
    };
    expect(d.companies).toBe(8);
    expect(d.sectorMix[0].label).toBe("Fintech"); // 3 fintech is the plurality
  });

  it("scoring summary aggregates AI vs evaluator variance", async () => {
    const c = await login(VC_ADMIN);
    const d = (await (await get("/api/analytics/scoring", c)).json()) as {
      rows: Array<{ name: string; variance: number | null }>;
      dealsScored: number;
    };
    expect(d.dealsScored).toBeGreaterThan(0);
    const cb = d.rows.find((r) => r.name === "CreditBridge");
    expect(cb?.variance).not.toBeNull();
  });

  it("decision history tallies Invest/Pass/Revisit", async () => {
    const c = await login(VC_ADMIN);
    const d = (await (await get("/api/analytics/decisions", c)).json()) as {
      total: number;
      invest: number;
      pass: number;
      revisit: number;
    };
    expect(d.total).toBe(8);
    expect(d.invest).toBe(5);
    expect(d.pass).toBe(2);
    expect(d.revisit).toBe(1);
  });

  it("diligence status counts companies in diligence", async () => {
    const c = await login(VC_ADMIN);
    const res = await get("/api/analytics/diligence", c);
    expect(res.status).toBe(200);
    const d = (await res.json()) as { inDiligence: number; items: unknown[] };
    expect(d.inDiligence).toBeGreaterThan(0);
  });

  it("per-role authZ: analyst may see scoring but not capital", async () => {
    const c = await login(VC_ANALYST);
    expect((await get("/api/analytics/scoring", c)).status).toBe(200);
    expect((await get("/api/analytics/capital", c)).status).toBe(403);
  });

  it("cross-edition slug is forbidden (incubator admin → VC capital)", async () => {
    const c = await login(INC_ADMIN);
    expect((await get("/api/analytics/capital", c)).status).toBe(403);
  });

  it("unauthenticated requests are rejected", async () => {
    expect((await get("/api/analytics/funnel", "")).status).toBe(401);
  });
});
