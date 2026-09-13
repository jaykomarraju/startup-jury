import { SELF, env } from "cloudflare:test";
import { describe, it, expect, afterEach } from "vitest";

/**
 * W8-A — the two report routes this session touched: `GET /api/analytics/drift`
 * and `GET /api/analytics/my/drift`. Both honour the Scoring framework's "Show
 * score drift analysis in reports" toggle (§9, Wave 2 integration: `/my/drift`
 * used to ignore it), both return the SAME disabled payload when it is off, and
 * each is still gated to its own roles.
 *
 * Storage is isolated per file, so the toggle written here cannot leak into
 * `scoring-framework.test.ts`; each test still restores it.
 */

const BASE = "https://example.com";
const ADMIN = "nisha.kapoor@demo.startupjury.ai"; // incubator admin
const JURY = "rajesh.kumar@demo.startupjury.ai"; // incubator jury
const FOUNDER = "meera.sharma@demo.startupjury.ai"; // incubator founder

async function login(email: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo1234" }),
  });
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

const get = (p: string, c: string) => SELF.fetch(`${BASE}${p}`, { headers: { cookie: c } });

async function setDrift(on: boolean): Promise<void> {
  await env.DB.prepare("UPDATE org_scoring_settings SET show_score_drift = ? WHERE edition = 'incubator'")
    .bind(on ? 1 : 0)
    .run();
}

interface DriftBody {
  rows: Array<{ name: string; aiScore: number; clarifiedScore: number | null; humanScore: number; drift: number }>;
  disabled?: boolean;
  meanDrift: number;
  tendency: string;
  attribution: { clarification: number | null; juror: number | null; reevaluation: number | null };
}

afterEach(() => setDrift(true));

describe("GET /api/analytics/my/drift — show_score_drift", () => {
  it("off → the disabled payload, with no rows", async () => {
    await setDrift(false);
    const res = await get("/api/analytics/my/drift", await login(JURY));
    expect(res.status).toBe(200);
    const body = (await res.json()) as DriftBody;
    expect(body.disabled).toBe(true);
    expect(body.rows).toEqual([]);
  });

  it("on → the juror's own drift, with the jury report's fields", async () => {
    await setDrift(true);
    const res = await get("/api/analytics/my/drift", await login(JURY));
    expect(res.status).toBe(200);
    const body = (await res.json()) as DriftBody;
    expect(body.disabled).toBeUndefined();
    expect(body.rows.length).toBeGreaterThan(0);
    expect(["Lenient", "Strict", "Aligned"]).toContain(body.tendency);
    expect(typeof body.meanDrift).toBe("number");
    for (const r of body.rows) expect(Math.abs(r.drift - (r.humanScore - r.aiScore))).toBeLessThanOrEqual(0.11);
  });

  it("is exclusive to the jury member: admin and founder are forbidden", async () => {
    expect((await get("/api/analytics/my/drift", await login(ADMIN))).status).toBe(403);
    expect((await get("/api/analytics/my/drift", await login(FOUNDER))).status).toBe(403);
  });

  it("the toggle is checked after the role gate — a forbidden role still gets 403 when it is off", async () => {
    await setDrift(false);
    expect((await get("/api/analytics/my/drift", await login(ADMIN))).status).toBe(403);
  });
});

describe("GET /api/analytics/drift — show_score_drift", () => {
  it("off → the same disabled payload shape as /my/drift", async () => {
    await setDrift(false);
    const staff = (await (await get("/api/analytics/drift", await login(ADMIN))).json()) as DriftBody;
    const jury = (await (await get("/api/analytics/my/drift", await login(JURY))).json()) as DriftBody;
    expect(staff.disabled).toBe(true);
    expect(Object.keys(staff).sort()).toEqual(Object.keys(jury).sort());
  });

  it("on → rows carry the After clarification slot (null: nothing records it yet) and the attribution card", async () => {
    await setDrift(true);
    const body = (await (await get("/api/analytics/drift", await login(ADMIN))).json()) as DriftBody;
    expect(body.rows.length).toBeGreaterThan(0);
    expect(body.rows.every((r) => r.clarifiedScore === null)).toBe(true);
    expect(body.attribution.clarification).toBeNull();
    expect(body.attribution.reevaluation).toBeNull();
    expect(typeof body.attribution.juror).toBe("number");
  });

  it("is staff-only: the jury member and the founder are forbidden", async () => {
    expect((await get("/api/analytics/drift", await login(JURY))).status).toBe(403);
    expect((await get("/api/analytics/drift", await login(FOUNDER))).status).toBe(403);
  });
});
