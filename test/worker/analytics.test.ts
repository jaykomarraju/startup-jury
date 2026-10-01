import { SELF, env } from "cloudflare:test";
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
    // W8-A data patch — the payload is `myDecksSummary()`'s now: the juror's
    // assigned decks by state. "evaluated" (submitted evaluations) is `submitted`.
    const d = (await res.json()) as { submitted: number; rows: unknown[] };
    expect(d.submitted).toBeGreaterThan(0);

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

/**
 * T1-REPORTS — THE VC AGGREGATES, WHICH `tenant-scope.test.ts` CANNOT REACH.
 *
 * The isolation file's second customer is an INCUBATOR workspace: `zz_deck`,
 * `zz_admin` and every proxy fixture are `edition = 'incubator'`. The four VC
 * reports (`/capital`, `/portfolio`, `/diligence`, `/decisions`) answer 403
 * `wrong_edition` to an incubator principal, so none of its layers can see them —
 * and `/capital` holds the single worst number in `routes/analytics.ts`:
 *
 *     SELECT COALESCE(SUM(fund_size), 0), COALESCE(SUM(fund_allocated), 0)
 *     FROM programs WHERE edition = ?
 *
 * Two `SUM`s over another customer's FUND SIZE, rendered as this customer's
 * committed and allocated capital, with `deployedPct` and `dryPowder` computed
 * from them. §11: "a `COUNT(*)` or an `AVG(score)` that leaks returns a perfectly
 * ordinary-looking number". A fund that grew by someone else's ₹500 Cr does not
 * even look like a leak — it looks like a good quarter.
 *
 * These cases live here rather than in the isolation file because the fixture they
 * need is a VC workspace, and that is a larger change to a file six sessions are
 * editing in parallel. T1-ESIGN is adding a VC principal there for `/api/diligence`
 * (§2 B14); at integration these two cases should move across behind it.
 */
describe("analytics — tenant isolation on the VC aggregates (T1-REPORTS)", () => {
  const OTHER = "t_rival_fund";

  async function giveRivalAFund(): Promise<void> {
    await env.DB.prepare(
      "INSERT INTO organizations (id, name, slug, status) VALUES (?, 'Rival Fund', 'rival-fund', 'active') " +
        "ON CONFLICT (id) DO NOTHING",
    )
      .bind(OTHER)
      .run();
    // Same edition, active, with fund economics an order of magnitude above the
    // seed — so a leak is unmistakable rather than a rounding argument.
    await env.DB.prepare(
      "INSERT INTO programs (id, tenant_id, edition, name, active, fund_size, fund_allocated) " +
        "VALUES ('rival_fund_1', ?, 'vc', 'Rival Fund I', 1, 5000, 4000)",
    )
      .bind(OTHER)
      .run();
  }

  const clearRival = () =>
    env.DB.prepare("DELETE FROM programs WHERE tenant_id = ?").bind(OTHER).run();

  it("committed and allocated capital exclude another customer's fund", async () => {
    const c = await login(VC_ADMIN);
    interface Capital {
      committed: number;
      allocated: number;
      deployedPct: number;
      dryPowder: number;
      fund: { label: string };
    }
    const read = async () => {
      const res = await get("/api/analytics/capital", c);
      expect(res.status).toBe(200);
      return (await res.json()) as Capital;
    };

    const before = await read();
    await giveRivalAFund();
    try {
      // The control: the rows really are in the table and really would be summed.
      const unscoped = (
        await env.DB.prepare(
          "SELECT COALESCE(SUM(fund_size), 0) AS v FROM programs WHERE edition = 'vc' AND active = 1",
        ).first<{ v: number }>()
      )!.v;
      expect(
        unscoped,
        "the rival fund is not in `programs`, so this case proves nothing",
      ).toBeGreaterThanOrEqual(before.committed + 5000);

      const after = await read();
      expect(
        after.committed,
        `committed capital moved from ${before.committed} to ${after.committed} because ANOTHER ` +
          "customer raised a fund — and dryPowder and deployedPct are computed from it",
      ).toBe(before.committed);
      expect(after.allocated).toBe(before.allocated);
      expect(after.dryPowder).toBe(before.dryPowder);
      expect(after.deployedPct).toBe(before.deployedPct);
      // The chip names the one active programme with a committed size. Unscoped,
      // two customers each have one and the label falls back to "All funds" — the
      // leak shows up as a LABEL losing its name, which nobody reads as a leak.
      expect(after.fund.label).toBe(before.fund.label);
    } finally {
      await clearRival();
    }
  });

  it("the portfolio and decision reports exclude another customer's deals", async () => {
    const c = await login(VC_ADMIN);
    const read = async (path: string) => {
      const res = await get(`/api/analytics/${path}`, c);
      expect(res.status, `${path} answered ${res.status}`).toBe(200);
      return await res.text();
    };
    const before = { portfolio: await read("portfolio"), decisions: await read("decisions") };

    // A rival VC deal, a cheque against it, and a decision on it — `portfolio` and
    // `pipeline_events` are both scoped only through `decks`, so this is the
    // one-hop proxy shape §5b counts 43 unjoined reads of.
    await env.DB.prepare(
      "INSERT INTO organizations (id, name, slug, status) VALUES (?, 'Rival Fund', 'rival-fund', 'active') " +
        "ON CONFLICT (id) DO NOTHING",
    )
      .bind(OTHER)
      .run();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO decks (id, tenant_id, edition, name, status) VALUES ('rival_deck', ?, 'vc', 'RIVALCO', 'portfolio')",
      ).bind(OTHER),
      env.DB.prepare(
        "INSERT INTO portfolio (deck_id, capital_deployed, onboarded_at) VALUES ('rival_deck', 900, '2026-01-01')",
      ),
      env.DB.prepare(
        "INSERT INTO pipeline_events (id, deck_id, from_stage, to_stage, action, note) " +
          "VALUES ('rival_pe', 'rival_deck', 'ic_review', 'portfolio', 'invested', 'RIVALCO closed')",
      ),
    ]);

    try {
      const after = { portfolio: await read("portfolio"), decisions: await read("decisions") };
      // By NAME first — the readable failure — then by whole body, which also
      // catches the deployed total and the cheque-size mix moving.
      expect(after.portfolio).not.toContain("RIVALCO");
      expect(after.decisions).not.toContain("RIVALCO");
      expect(after.portfolio).toBe(before.portfolio);
      expect(after.decisions).toBe(before.decisions);
    } finally {
      await env.DB.prepare("DELETE FROM decks WHERE id = 'rival_deck'").run();
    }
  });
});
