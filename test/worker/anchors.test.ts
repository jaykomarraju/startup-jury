import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";

const BASE = "https://example.com";

// Seed logins (migrations/0002_seed.sql).
const ADMIN = "nisha.kapoor@demo.startupjury.ai"; // admin
const PA = "sunita.rao@demo.startupjury.ai"; // program_associate (non-admin)

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

function put(path: string, cookie: string, body: unknown) {
  return SELF.fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

interface BandView {
  index: number;
  label: string;
  name: string;
  min: number;
  max: number;
  description: string | null;
}
interface ParamView {
  id: string;
  key: string;
  name: string;
  informational: boolean;
  roleScope?: string;
  prompt: string | null;
  bands: BandView[];
}

async function listAnchors(cookie: string): Promise<ParamView[]> {
  const res = await get("/api/anchors", cookie);
  expect(res.status).toBe(200);
  return ((await res.json()) as { parameters: ParamView[] }).parameters;
}

describe("GET /api/anchors", () => {
  it("returns all 22 parameters — 13 core + 9 role-scoped — each with five bands", async () => {
    const admin = await login(ADMIN);
    const params = await listAnchors(admin);
    expect(params).toHaveLength(22);
    expect(params.filter((p) => !p.informational)).toHaveLength(13);
    expect(params.filter((p) => p.informational)).toHaveLength(9);
    for (const p of params) {
      expect(p.bands.map((b) => b.index), p.key).toEqual([0, 1, 2, 3, 4]);
      expect(p.bands.map((b) => b.name)).toEqual([
        "Exceptional",
        "Strong",
        "Moderate",
        "Weak",
        "Insufficient",
      ]);
    }
  });

  it("carries the seeded anchor text for core areas and the per-area guidance prompt", async () => {
    const admin = await login(ADMIN);
    const params = await listAnchors(admin);
    const problem = params.find((p) => p.key === "problem_market_clarity")!;
    expect(problem.bands[0].description).toBe(
      "Mission-critical problem with regulatory or economic pressure.",
    );
    expect(problem.prompt).toContain("specific, clearly-articulated problem");
  });

  it("returns five EMPTY bands for a scaffolded role parameter, not none", async () => {
    const admin = await login(ADMIN);
    const params = await listAnchors(admin);
    const role = params.find((p) => p.informational)!;
    expect(role.bands).toHaveLength(5);
    expect(role.bands.every((b) => b.description === null)).toBe(true);
  });
});

describe("anchors authZ", () => {
  it("a non-admin cannot read or write anchors", async () => {
    const pa = await login(PA);
    expect((await get("/api/anchors", pa)).status).toBe(403);
    const id = (await env.DB.prepare(
      "SELECT id FROM parameters WHERE edition = 'incubator' AND key = 'problem_market_clarity'",
    ).first<{ id: string }>())!.id;
    const res = await put(`/api/anchors/${id}`, pa, { prompt: "sneak" });
    expect(res.status).toBe(403);
  });

  it("an unauthenticated request is rejected", async () => {
    expect((await get("/api/anchors", "")).status).toBe(401);
  });
});

describe("PUT /api/anchors/:parameterId", () => {
  it("saves prompt and band anchors, and they survive a round trip", async () => {
    const admin = await login(ADMIN);
    const before = await listAnchors(admin);
    const target = before.find((p) => p.key === "storytelling")!;

    const res = await put(`/api/anchors/${target.id}`, admin, {
      prompt: "Look for a narrative arc, not a feature list.",
      bands: [
        { index: 0, description: "Investor-ready narrative, zero filler." },
        { index: 4, description: "No story; slides are a data dump." },
      ],
    });
    expect(res.status).toBe(200);

    const after = await listAnchors(admin);
    const saved = after.find((p) => p.id === target.id)!;
    expect(saved.prompt).toBe("Look for a narrative arc, not a feature list.");
    expect(saved.bands[0].description).toBe("Investor-ready narrative, zero filler.");
    expect(saved.bands[4].description).toBe("No story; slides are a data dump.");
    // Bands not in the payload keep whatever 0027 seeded.
    expect(saved.bands[2].description).toBe(before.find((p) => p.id === target.id)!.bands[2].description);
  });

  it("writes an anchor onto a scaffolded role parameter", async () => {
    const admin = await login(ADMIN);
    const role = (await listAnchors(admin)).find((p) => p.informational)!;
    const res = await put(`/api/anchors/${role.id}`, admin, {
      bands: [{ index: 2, description: "Meets the bar with reservations." }],
    });
    expect(res.status).toBe(200);
    const saved = (await listAnchors(admin)).find((p) => p.id === role.id)!;
    expect(saved.bands[2].description).toBe("Meets the bar with reservations.");
    expect(saved.bands[1].description).toBeNull();
  });

  it("stores a blank anchor as NULL, so 'unwritten' stays distinguishable from ''", async () => {
    const admin = await login(ADMIN);
    const target = (await listAnchors(admin)).find((p) => p.key === "market_size")!;
    await put(`/api/anchors/${target.id}`, admin, {
      bands: [{ index: 3, description: "   " }],
    });
    const saved = (await listAnchors(admin)).find((p) => p.id === target.id)!;
    expect(saved.bands[3].description).toBeNull();
  });

  it("bumps criteria_version, so an anchor edit makes a re-score available (F0164)", async () => {
    const admin = await login(ADMIN);
    const readVersion = async () =>
      (await env.DB.prepare(
        "SELECT criteria_version FROM org_settings WHERE edition = 'incubator'",
      ).first<{ criteria_version: number }>())!.criteria_version;

    const target = (await listAnchors(admin)).find((p) => p.key === "team_execution")!;
    const before = await readVersion();
    await put(`/api/anchors/${target.id}`, admin, { prompt: "Founder–market fit above all." });
    expect(await readVersion()).toBe(before + 1);
  });

  it("rejects an unknown parameter and an out-of-range band", async () => {
    const admin = await login(ADMIN);
    expect((await put("/api/anchors/nope", admin, { prompt: "x" })).status).toBe(404);
    const target = (await listAnchors(admin)).find((p) => p.key === "traction_validation")!;
    const res = await put(`/api/anchors/${target.id}`, admin, {
      bands: [{ index: 7, description: "off the scale" }],
    });
    expect(res.status).toBe(400);
  });

  it("rejects an empty payload rather than silently bumping the version", async () => {
    const admin = await login(ADMIN);
    const target = (await listAnchors(admin)).find((p) => p.key === "business_model")!;
    expect((await put(`/api/anchors/${target.id}`, admin, {})).status).toBe(400);
  });
});

/**
 * The §1.5 reconciliation, end to end through the database.
 *
 * `decks.signal` persists what `signalTag()` returns, so the five-band scale
 * changed its vocabulary: `absent` → `insufficient`, plus a new top band
 * `exceptional`. Migration `0039` rewrote the stored rows. Anything that
 * matched the old strings had to move with it — the VC diligence report's
 * red-flag list is the one place that did, and a silent miss there would have
 * emptied the lowest band out of the report with nothing failing.
 */
describe("the five-band vocabulary reaches the database", () => {
  const VC_ADMIN = "nisha.kapoor.vc@demo.startupjury.ai";

  it("0039 left no deck on the retired `absent` label, and dropped the four-band table", async () => {
    const stale = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM decks WHERE signal = 'absent'",
    ).first<{ n: number }>();
    expect(stale!.n).toBe(0);

    const table = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'rubric_anchors'",
    ).first<{ name: string }>();
    expect(table).toBeNull();
  });

  it("every stored signal is a band key, `flagged`, or NULL", async () => {
    const rows = (
      await env.DB.prepare("SELECT DISTINCT signal FROM decks WHERE signal IS NOT NULL").all<{
        signal: string;
      }>()
    ).results;
    const allowed = new Set([
      "exceptional",
      "strong",
      "moderate",
      "weak",
      "insufficient",
      "flagged",
    ]);
    for (const r of rows) expect(allowed.has(r.signal), r.signal).toBe(true);
  });

  it("the diligence report still red-flags its lowest band under the new labels", async () => {
    await env.DB.prepare(
      "INSERT INTO decks (id, edition, name, status, ai_score, signal, complete) " +
        "VALUES ('w2b_low', 'vc', 'Lowband Labs', 'investment_dd', 1.0, 'insufficient', 1)",
    ).run();
    await env.DB.prepare(
      "INSERT INTO decks (id, edition, name, status, ai_score, signal, complete) " +
        "VALUES ('w2b_top', 'vc', 'Topband Labs', 'investment_dd', 9.5, 'exceptional', 1)",
    ).run();

    const admin = await login(VC_ADMIN);
    const res = await get("/api/analytics/diligence", admin);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      flags: Array<{ company: string; flag: string }>;
      items: Array<{ company: string; status: string }>;
    };

    expect(body.flags.find((f) => f.company === "Lowband Labs")?.flag).toBe("Insufficient signal");
    expect(body.flags.find((f) => f.company === "Topband Labs")).toBeUndefined();
    expect(body.items.find((i) => i.company === "Topband Labs")?.status).toBe("In progress");
  });
});
