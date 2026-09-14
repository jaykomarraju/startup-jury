import { SELF, env } from "cloudflare:test";
import { describe, it, expect, afterEach } from "vitest";

/**
 * W9-D — the VC report data `W9-D-vc-report-data.patch` adds to five routes:
 * the funnel scoped to the caller's pipeline, the Scoring Summary honouring the
 * evaluation hierarchy (issue 21) and blind scoring (F0106), capital pacing and
 * the fund's name, the check-size mix, founder-clarification rows and the
 * evaluator-disagreement red flag.
 *
 * Storage is isolated per file; every write below is still undone.
 */

const BASE = "https://example.com";
const SUPERUSER = "aarav.khanna@demo.startupjury.ai";
const ADMIN = "nisha.kapoor.vc@demo.startupjury.ai";
const PARTNER = "ishaan.sethi@demo.startupjury.ai";
const ASSOCIATE = "sunita.rao.vc@demo.startupjury.ai";
const ANALYST = "rhea.nair@demo.startupjury.ai";
const INC_ADMIN = "nisha.kapoor@demo.startupjury.ai";

async function login(email: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo1234" }),
  });
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

async function get<T>(path: string, email: string): Promise<{ status: number; body: T }> {
  const res = await SELF.fetch(`${BASE}/api/analytics/${path}`, { headers: { cookie: await login(email) } });
  return { status: res.status, body: (await res.json()) as T };
}

async function setBlind(blind: boolean): Promise<void> {
  await env.DB.prepare("UPDATE org_scoring_settings SET show_ai_score_to_jury = ? WHERE edition = 'vc'")
    .bind(blind ? 0 : 1)
    .run();
}

afterEach(async () => {
  await setBlind(false);
  await env.DB.prepare("DELETE FROM evaluations WHERE id = 'eval_w9d_outlier'").run();
  await env.DB.prepare("DELETE FROM queries WHERE id LIKE 'qry_w9d_%'").run();
});

interface Funnel {
  top: number;
  scope: "all" | "mine";
}
interface Scoring {
  rows: Array<{ name: string; ai: number | null; evaluatorAvg: number | null; variance: number | null; lean: string; aiWithheld?: true }>;
  evaluators: number;
}

describe("GET /api/analytics/funnel — a deal-maker's own pipeline", () => {
  it("admin and superuser read every deal; partner and associate read theirs, and are told so", async () => {
    const admin = await get<Funnel>("funnel", ADMIN);
    const superuser = await get<Funnel>("funnel", SUPERUSER);
    const partner = await get<Funnel>("funnel", PARTNER);
    const associate = await get<Funnel>("funnel", ASSOCIATE);
    const { n } = (await env.DB.prepare("SELECT COUNT(*) AS n FROM decks WHERE edition = 'vc'").first<{ n: number }>())!;

    expect(admin.body).toMatchObject({ scope: "all", top: n });
    expect(superuser.body).toMatchObject({ scope: "all", top: n });
    expect(partner.body.scope).toBe("mine");
    expect(associate.body.scope).toBe("mine");
    expect(partner.body.top).toBeGreaterThan(0);
    expect(partner.body.top).toBeLessThan(n);
    expect(associate.body.top).toBeLessThan(n);
  });

  it("the incubator's funnel is untouched: every deck, scope all", async () => {
    const inc = await get<Funnel>("funnel", INC_ADMIN);
    const { n } = (await env.DB.prepare("SELECT COUNT(*) AS n FROM decks WHERE edition = 'incubator'").first<{ n: number }>())!;
    expect(inc.body).toMatchObject({ scope: "all", top: n });
  });
});

describe("GET /api/analytics/scoring — hierarchy and blind scoring", () => {
  it("issue 21: an analyst's averages hold only what an analyst may see", async () => {
    const admin = (await get<Scoring>("scoring", ADMIN)).body;
    const analyst = (await get<Scoring>("scoring", ANALYST)).body;
    const credit = (b: Scoring) => b.rows.find((r) => r.name === "CreditBridge")!;
    // Seeded: analyst 6.6 · associate 7.8 · partner 6.4.
    expect(credit(admin).evaluatorAvg).toBe(6.9);
    expect(credit(analyst).evaluatorAvg).toBe(6.6);
    expect(credit(analyst).variance).toBeNull(); // one visible score is not a spread
    expect(analyst.evaluators).toBeLessThan(admin.evaluators);
  });

  it("toggle ON (the default): nobody's AI score is withheld", async () => {
    const analyst = (await get<Scoring>("scoring", ANALYST)).body;
    expect(analyst.rows.some((r) => r.aiWithheld)).toBe(false);
  });

  it("toggle OFF: an evaluator loses the AI score on deals they have not scored — and only those", async () => {
    await setBlind(true);
    const analyst = (await get<Scoring>("scoring", ANALYST)).body;
    const quant = analyst.rows.find((r) => r.name === "QuantIQ")!; // AI 9.0, no analyst evaluation
    const credit = analyst.rows.find((r) => r.name === "CreditBridge")!; // the analyst scored it
    expect(quant).toMatchObject({ ai: null, aiWithheld: true });
    expect(credit.ai).not.toBeNull();
    expect(credit.aiWithheld).toBeUndefined();
  });

  it("toggle OFF: staff who oversee rather than score still read every AI score", async () => {
    await setBlind(true);
    const admin = (await get<Scoring>("scoring", ADMIN)).body;
    expect(admin.rows.some((r) => r.aiWithheld)).toBe(false);
    expect(admin.rows.find((r) => r.name === "QuantIQ")!.ai).toBe(9);
  });

  it("toggle OFF: the role gate still answers first — another edition's admin gets 403", async () => {
    await setBlind(true);
    expect((await get("scoring", INC_ADMIN)).status).toBe(403);
  });
});

describe("GET /api/analytics/capital and /portfolio — the fund and its mix", () => {
  it("capital names the one funded programme, paces by year, and leaves unmodelled figures null", async () => {
    const d = (
      await get<{
        deployed: number;
        fund: { label: string };
        reserves: null;
        paceVsPlan: null;
        deployedFollowOn: null;
        pacing: Array<{ year: number; actual: number; cumulative: number; planned: null; variance: null }>;
      }>("capital", ADMIN)
    ).body;
    expect(d.fund.label).toBe("Fund II");
    expect([d.reserves, d.paceVsPlan, d.deployedFollowOn]).toEqual([null, null, null]);
    expect(d.pacing.length).toBeGreaterThan(0);
    expect(d.pacing[d.pacing.length - 1].cumulative).toBe(d.deployed);
    expect(d.pacing.every((p) => p.planned === null && p.variance === null)).toBe(true);
  });

  it("portfolio carries the check-size mix over every funded company, and the deployed total", async () => {
    const d = (
      await get<{ companies: number; deployed: number; checkSizeMix: Array<{ label: string; count: number }>; followOnRate: null }>(
        "portfolio",
        ADMIN,
      )
    ).body;
    expect(d.checkSizeMix.map((b) => b.label)).toEqual(["< ₹3 Cr", "₹3–8 Cr", "₹8–20 Cr", "> ₹20 Cr"]);
    expect(d.checkSizeMix.reduce((n, b) => n + b.count, 0)).toBe(d.companies);
    expect(d.deployed).toBe(92); // 22+8+12+6+5+15+20+4, as analytics.test.ts pins for /capital
    expect(d.followOnRate).toBeNull();
  });
});

describe("GET /api/analytics/diligence — clarifications and flags", () => {
  interface Diligence {
    clarifications: number;
    redFlags: number;
    onTrack: number;
    inDiligence: number;
    flags: Array<{ company: string; flag: string }>;
    clarificationRows: Array<{ company: string; question: string; status: string }>;
    openItems: null;
    itemRows: unknown[];
  }

  it("lists founder clarifications on deals in diligence, answered and pending, and counts the pending", async () => {
    const before = (await get<Diligence>("diligence", ADMIN)).body;
    await env.DB.prepare(
      "INSERT INTO queries (id, deck_id, questions, email_status, created_at) VALUES " +
        "('qry_w9d_1', 'vc_deck_solarnest', 'Churn definition\nHow is a churned customer counted?', 'sent', '2026-09-01T09:00:00Z'), " +
        "('qry_w9d_2', 'vc_deck_dockflow', 'Unit economics', 'answered', '2026-09-02T09:00:00Z'), " +
        "('qry_w9d_3', 'vc_deck_quantiq', 'Not in diligence', 'sent', '2026-09-03T09:00:00Z')",
    ).run();
    const after = (await get<Diligence>("diligence", ADMIN)).body;
    expect(after.clarificationRows.slice(0, 2)).toEqual([
      { company: "DockFlow", question: "Unit economics", status: "Answered" },
      { company: "SolarNest", question: "Churn definition", status: "Pending" },
    ]);
    expect(after.clarificationRows.some((q) => q.question === "Not in diligence")).toBe(false);
    expect(after.clarifications).toBe(before.clarifications + 1);
    expect(after.openItems).toBeNull();
    expect(after.itemRows).toEqual([]);
  });

  it("raises 'High evaluator disagreement (σ …)' for a spread of 1 point or more", async () => {
    const { id } = (await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(SUPERUSER).first<{ id: string }>())!;
    await env.DB.prepare(
      "INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, submitted_at) VALUES ('eval_w9d_outlier', 'vc_deck_solarnest', ?, 3.0, '2026-09-01T09:00:00Z')",
    )
      .bind(id)
      .run();
    const d = (await get<Diligence>("diligence", ADMIN)).body;
    // SolarNest: 7.6 · 8.0 · 7.7 · 3.0 → σ 2.1.
    expect(d.flags).toContainEqual({ company: "SolarNest", flag: "High evaluator disagreement (σ 2.1)" });
    expect(d.redFlags).toBe(d.flags.length);
    expect(d.onTrack).toBe(d.inDiligence - new Set(d.flags.map((f) => f.company)).size);
  });
});
