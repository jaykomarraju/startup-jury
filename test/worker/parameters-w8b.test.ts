import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { fromDisplayScale, toDisplayScale } from "../../src/shared/scoring";

/**
 * W8-B — Core Parameters and My Parameters, at the route level:
 *
 *   1. `GET /api/config/parameters` — what the signed-in member may configure;
 *   2. the member's own seat gates parameter configuration (§9 `W6-C`, §8 Q116),
 *      with the workspace plan as the ceiling;
 *   3. the role parameters' new fields — scorer-facing description and the
 *      on/off switch (0060) — and the core areas' extraction prompt (§8 Q95);
 *   4. a renamed parameter reaches the stage-aware evaluation report;
 *   5. the cohort thresholds stay canonical whatever scale the org reads them on.
 *
 * Storage is isolated per FILE, not per test: every test that changes a seat, a
 * plan or a parameter puts it back.
 */

const BASE = "https://example.com";
const SUPER = "priya.sharma@demo.startupjury.ai"; // incubator superuser · Premium seat
const ADMIN = "nisha.kapoor@demo.startupjury.ai"; // incubator admin · Pro seat
const PM = "raj.kumar@demo.startupjury.ai"; // program_manager · Pro seat
const JURY = "rajesh.kumar@demo.startupjury.ai"; // jury · Standard seat
const FOUNDER = "meera.sharma@demo.startupjury.ai";
const DECK = "inc_deck_greenroute";

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
const send = (method: string, p: string, c: string, body?: unknown) =>
  SELF.fetch(`${BASE}${p}`, {
    method,
    headers: { cookie: c, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

interface View {
  plan: string;
  memberTier: string;
  effectivePlan: string;
  coreConfigEnabled: boolean;
  additionalEnabled: boolean;
  coreEditor: boolean;
  additionalEditor: boolean;
  coreParams: { id: string; name: string; weight: number; prompt?: string }[];
  additionalParams: {
    id: string;
    name: string;
    roleScope: string;
    description?: string;
    enabled: boolean;
    editable: boolean;
  }[];
}

async function view(cookie: string): Promise<View> {
  const res = await get("/api/config/parameters", cookie);
  expect(res.status).toBe(200);
  return (await res.json()) as View;
}

async function setSeat(email: string, tier: string) {
  await env.DB.prepare("UPDATE users SET plan_tier = ? WHERE email = ?").bind(tier, email).run();
}

async function setOrgPlan(plan: string) {
  await env.DB.prepare("UPDATE org_settings SET plan = ? WHERE edition = 'incubator'").bind(plan).run();
}

async function roleParam(role: string, n = 0) {
  return (
    await env.DB.prepare(
      "SELECT id, name, description FROM parameters WHERE edition = 'incubator' AND informational = 1 AND role_scope = ? AND retired = 0 ORDER BY sort_order",
    )
      .bind(role)
      .all<{ id: string; name: string; description: string | null }>()
  ).results[n];
}

async function coreRubric() {
  return (
    await env.DB.prepare(
      "SELECT id, name, weight, prompt FROM parameters WHERE edition = 'incubator' AND informational = 0 AND active = 1 ORDER BY sort_order",
    ).all<{ id: string; name: string; weight: number; prompt: string | null }>()
  ).results;
}

interface Report {
  core: { key: string; name: string }[];
  additional: { role: string; mode: string; rows: { key: string; name: string }[] }[];
}

async function report(cookie: string, stage: string): Promise<Report> {
  const res = await get(`/api/decks/${DECK}/report?stage=${stage}`, cookie);
  expect(res.status).toBe(200);
  return (await res.json()) as Report;
}

// ── 1 · the configuration view ───────────────────────────────────────────────

describe("GET /api/config/parameters", () => {
  it("answers per member: the seat, the workspace plan and the plan that results", async () => {
    const su = await view(await login(SUPER));
    expect(su).toMatchObject({
      plan: "premium",
      memberTier: "premium",
      effectivePlan: "premium",
      coreConfigEnabled: true,
      additionalEnabled: true,
      coreEditor: true,
      additionalEditor: true,
    });
    expect(su.coreParams).toHaveLength(13);
    expect(su.additionalParams).toHaveLength(9);
    expect(su.additionalParams.every((p) => p.editable && p.enabled)).toBe(true);

    // A Pro seat in a Premium workspace configures the core 13 and nothing more.
    const admin = await view(await login(ADMIN));
    expect(admin).toMatchObject({
      memberTier: "pro",
      effectivePlan: "pro",
      coreConfigEnabled: true,
      additionalEnabled: false,
      coreEditor: true,
    });
    expect(admin.additionalParams.some((p) => p.editable)).toBe(false);

    // A juror reads it all and may change none of it.
    const jury = await view(await login(JURY));
    expect(jury).toMatchObject({ memberTier: "standard", coreEditor: false, additionalEditor: false });
    expect(jury.additionalParams.some((p) => p.editable)).toBe(false);
  });

  it("carries each role parameter's scorer-facing description (spec §6.2)", async () => {
    const su = await view(await login(SUPER));
    const trl = su.additionalParams.find((p) => p.name === "TRL stage")!;
    expect(trl.roleScope).toBe("program_manager");
    expect(trl.description).toMatch(/Technology Readiness Level/);
  });

  it("refuses a founder and an anonymous caller", async () => {
    expect((await get("/api/config/parameters", await login(FOUNDER))).status).toBe(403);
    expect((await get("/api/config/parameters", "")).status).toBe(401);
  });
});

// ── 2 · the member's own seat (§9 `W6-C`) ────────────────────────────────────

describe("the member's seat gates parameter configuration", () => {
  it("a Standard member in a Premium workspace is refused the core 13 — and a Pro seat is allowed", async () => {
    const rubric = { params: (await coreRubric()).map((p) => ({ id: p.id, weight: p.weight })) };
    await setSeat(ADMIN, "standard");
    try {
      const admin = await login(ADMIN);
      expect((await view(admin)).coreConfigEnabled).toBe(false);
      const refused = await send("PUT", "/api/config/parameters", admin, rubric);
      expect(refused.status).toBe(402);
      expect(await refused.json()).toMatchObject({ error: "plan_required", scope: "member" });
    } finally {
      await setSeat(ADMIN, "pro");
    }
    expect((await send("PUT", "/api/config/parameters", await login(ADMIN), rubric)).status).toBe(200);
  });

  it("the role parameters need a Premium seat: Premium allowed, Pro refused, even for an editor role", async () => {
    const trl = await roleParam("program_manager");
    const su = await login(SUPER);
    expect((await send("PUT", `/api/config/additional-params/${trl.id}`, su, { name: trl.name })).status).toBe(200);

    // The PM holds `configparams` (spec §10) but a Pro seat.
    const pm = await login(PM);
    const refused = await send("PUT", `/api/config/additional-params/${trl.id}`, pm, { name: "Nope" });
    expect(refused.status).toBe(402);
    expect((await send("POST", "/api/config/additional-params", pm, { name: "X", roleScope: "jury" })).status).toBe(402);
    expect((await send("DELETE", `/api/config/additional-params/${trl.id}`, pm)).status).toBe(402);

    await setSeat(PM, "premium");
    try {
      expect(
        (await send("PUT", `/api/config/additional-params/${trl.id}`, await login(PM), { name: trl.name })).status,
      ).toBe(200);
    } finally {
      await setSeat(PM, "pro");
    }
  });

  it("the workspace plan is the ceiling: a Premium seat in a Pro workspace cannot configure role parameters", async () => {
    const trl = await roleParam("program_manager");
    await setOrgPlan("pro");
    try {
      const su = await login(SUPER);
      const v = await view(su);
      expect(v).toMatchObject({ plan: "pro", memberTier: "premium", effectivePlan: "pro", additionalEnabled: false });
      expect((await send("PUT", `/api/config/additional-params/${trl.id}`, su, { name: "X" })).status).toBe(402);
    } finally {
      await setOrgPlan("premium");
    }
  });

  it("authorisation is decided before the plan: a Standard juror on a parameter they were not granted gets 403", async () => {
    const barriers = await env.DB.prepare(
      "SELECT id FROM parameters WHERE edition = 'incubator' AND role_scope = 'jury' AND config_permitted = 0 AND retired = 0 LIMIT 1",
    ).first<{ id: string }>();
    expect((await send("PUT", `/api/config/additional-params/${barriers!.id}`, await login(JURY), { name: "X" })).status).toBe(403);
  });
});

// ── 3 · description, the on/off switch, the core prompt ─────────────────────

describe("role parameter fields", () => {
  it("persists the scoring description, and an empty string clears it", async () => {
    const p = await roleParam("jury", 1);
    const su = await login(SUPER);
    const res = await send("PUT", `/api/config/additional-params/${p.id}`, su, { description: "Judge it as a juror." });
    expect(res.status).toBe(200);
    expect((await res.json()) as { param: { description?: string } }).toMatchObject({
      param: { description: "Judge it as a juror." },
    });
    expect((await roleParam("jury", 1)).description).toBe("Judge it as a juror.");

    expect((await send("PUT", `/api/config/additional-params/${p.id}`, su, { description: "" })).status).toBe(200);
    expect((await roleParam("jury", 1)).description).toBeNull();

    await send("PUT", `/api/config/additional-params/${p.id}`, su, { description: p.description });
  });

  it("switching a parameter off takes it out of scoring but keeps it — and its slot — until switched back on", async () => {
    const p = await roleParam("program_associate", 2);
    const su = await login(SUPER);

    const off = await send("PUT", `/api/config/additional-params/${p.id}`, su, { enabled: false });
    expect(off.status).toBe(200);
    expect((await off.json()) as { param: { enabled: boolean } }).toMatchObject({ param: { enabled: false } });

    // Still on My Parameters, marked off, fields intact…
    const v = await view(su);
    expect(v.additionalParams.find((x) => x.id === p.id)).toMatchObject({ enabled: false, name: p.name });
    // …gone from everything that scores or reports…
    const summary = (await (await get("/api/config/summary", su)).json()) as { additionalParams: { id: string }[] };
    expect(summary.additionalParams.some((x) => x.id === p.id)).toBe(false);
    const assign = await report(su, "assign");
    const pa = assign.additional.find((g) => g.role === "program_associate")!;
    expect(pa.rows.map((r) => r.name)).not.toContain(p.name);
    // …and still holding one of the role's three slots.
    expect((await send("POST", "/api/config/additional-params", su, { name: "Fourth", roleScope: "program_associate" })).status).toBe(409);

    expect((await send("PUT", `/api/config/additional-params/${p.id}`, su, { enabled: true })).status).toBe(200);
    const back = await report(su, "assign");
    expect(back.additional.find((g) => g.role === "program_associate")!.rows.map((r) => r.name)).toContain(p.name);
  });

  it("rejects a non-boolean enabled", async () => {
    const p = await roleParam("program_associate");
    expect((await send("PUT", `/api/config/additional-params/${p.id}`, await login(SUPER), { enabled: "no" })).status).toBe(400);
  });

  it("Remove retires a parameter for good: it leaves the configuration view and frees its slot", async () => {
    const su = await login(SUPER);
    const created = await send("POST", "/api/config/additional-params", su, {
      name: "Temporary lens",
      roleScope: "jury",
      description: "Only for this test.",
    });
    // The jury already has three.
    expect(created.status).toBe(409);

    const victim = await roleParam("jury", 2);
    expect((await send("DELETE", `/api/config/additional-params/${victim.id}`, su)).status).toBe(200);
    expect((await view(su)).additionalParams.some((x) => x.id === victim.id)).toBe(false);
    // A retired parameter cannot be switched back on.
    expect((await send("PUT", `/api/config/additional-params/${victim.id}`, su, { enabled: true })).status).toBe(404);

    const added = await send("POST", "/api/config/additional-params", su, {
      name: "Temporary lens",
      roleScope: "jury",
      description: "Only for this test.",
    });
    expect(added.status).toBe(200);
    const { param } = (await added.json()) as { param: { id: string; description?: string; enabled: boolean } };
    expect(param).toMatchObject({ description: "Only for this test.", enabled: true });

    // Put the seed back: retire the test row, restore the original.
    await send("DELETE", `/api/config/additional-params/${param.id}`, su);
    await env.DB.prepare("UPDATE parameters SET active = 1, retired = 0 WHERE id = ?").bind(victim.id).run();
  });

  it("a core area's extraction prompt is written through PUT /parameters (§8 Q95), and an empty string clears it", async () => {
    const before = await coreRubric();
    const admin = await login(ADMIN);
    const withPrompt = before.map((p, i) => ({ id: p.id, weight: p.weight, ...(i === 0 ? { prompt: "Look for X." } : {}) }));
    expect((await send("PUT", "/api/config/parameters", admin, { params: withPrompt })).status).toBe(200);
    const after = await coreRubric();
    expect(after[0].prompt).toBe("Look for X.");
    // Untouched areas keep their prompt.
    expect(after[1].prompt).toBe(before[1].prompt);

    const cleared = before.map((p, i) => ({ id: p.id, weight: p.weight, ...(i === 0 ? { prompt: "" } : {}) }));
    expect((await send("PUT", "/api/config/parameters", admin, { params: cleared })).status).toBe(200);
    expect((await coreRubric())[0].prompt).toBeNull();

    await env.DB.prepare("UPDATE parameters SET prompt = ? WHERE id = ?").bind(before[0].prompt, before[0].id).run();
  });
});

// ── 4 · a rename reaches the stage-aware report ──────────────────────────────

describe("a renamed parameter flows into the evaluation report", () => {
  it("a role parameter renamed on My Parameters is what the stage's section carries", async () => {
    const su = await login(SUPER);
    const pmParam = await roleParam("program_manager", 1);
    const juryParam = await roleParam("jury", 1);
    try {
      expect(
        (await send("PUT", `/api/config/additional-params/${pmParam.id}`, su, { name: "PMF (renamed)" })).status,
      ).toBe(200);
      expect(
        (await send("PUT", `/api/config/additional-params/${juryParam.id}`, su, { name: "Scale (renamed)" })).status,
      ).toBe(200);

      // Assign carries PA + PM — the renamed PM parameter, and no jury section.
      const pm = await login(PM);
      const assign = await report(pm, "assign");
      const pmSection = assign.additional.find((g) => g.role === "program_manager")!;
      expect(pmSection.rows.map((r) => r.name)).toContain("PMF (renamed)");
      expect(pmSection.rows.map((r) => r.name)).not.toContain(pmParam.name);
      expect(assign.additional.some((g) => g.role === "jury")).toBe(false);

      // Intro calls carries the jury section, read-only "completed" — with the rename.
      const intro = await report(pm, "intro");
      const jurySection = intro.additional.find((g) => g.role === "jury")!;
      expect(jurySection.mode).toBe("completed");
      expect(jurySection.rows.map((r) => r.name)).toContain("Scale (renamed)");
    } finally {
      await send("PUT", `/api/config/additional-params/${pmParam.id}`, su, { name: pmParam.name });
      await send("PUT", `/api/config/additional-params/${juryParam.id}`, su, { name: juryParam.name });
    }
  });

  it("a core area renamed on Core Parameters is the report's core row", async () => {
    const before = await coreRubric();
    const admin = await login(ADMIN);
    const renamed = before.map((p, i) => ({ id: p.id, weight: p.weight, name: i === 0 ? "Problem clarity (renamed)" : p.name }));
    try {
      expect((await send("PUT", "/api/config/parameters", admin, { params: renamed })).status).toBe(200);
      const r = await report(await login(PM), "assign");
      expect(r.core.map((row) => row.name)).toContain("Problem clarity (renamed)");
      expect(r.core.map((row) => row.name)).not.toContain(before[0].name);
    } finally {
      await send("PUT", "/api/config/parameters", admin, {
        params: before.map((p) => ({ id: p.id, weight: p.weight, name: p.name })),
      });
    }
  });
});

// ── 5 · thresholds stay canonical ────────────────────────────────────────────

describe("cohort thresholds round-trip canonical (W7-D's 2(c) rule)", () => {
  it("what a 1–5 organisation types as 3.8 is stored as 7.0, and reads back as 3.8", async () => {
    await env.DB.prepare("UPDATE org_scoring_settings SET score_scale = '1-5' WHERE edition = 'incubator'").run();
    const admin = await login(ADMIN);
    try {
      // ConfigPage converts at the boundary; the route stores what it is given.
      const best = fromDisplayScale(3.8, "1-5");
      const mediocre = fromDisplayScale(3, "1-5");
      expect([best, mediocre]).toEqual([7, 5]);
      const res = await send("PUT", "/api/config/thresholds", admin, { best, mediocre });
      expect(res.status).toBe(200);

      const cfg = (await (await get("/api/config", admin)).json()) as { thresholdBest: number; thresholdMediocre: number };
      expect([cfg.thresholdBest, cfg.thresholdMediocre]).toEqual([7, 5]);
      expect(toDisplayScale(cfg.thresholdBest, "1-5")).toBe(3.8);
      // Identity on 0–10: nothing an existing assertion reads has moved.
      expect(toDisplayScale(cfg.thresholdBest, "0-10")).toBe(7);
    } finally {
      await env.DB.prepare("UPDATE org_scoring_settings SET score_scale = '0-10' WHERE edition = 'incubator'").run();
    }
  });
});
