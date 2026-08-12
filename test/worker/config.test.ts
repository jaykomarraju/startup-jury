import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";

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

function req(method: string, path: string, cookie: string, body?: unknown) {
  return SELF.fetch(`${BASE}${path}`, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const get = (p: string, c: string) => SELF.fetch(`${BASE}${p}`, { headers: { cookie: c } });

async function paramId(key: string, edition = "incubator"): Promise<string> {
  const row = await env.DB.prepare("SELECT id FROM parameters WHERE edition = ? AND key = ?")
    .bind(edition, key)
    .first<{ id: string }>();
  return row!.id;
}

describe("config authZ", () => {
  it("non-admin roles are forbidden from editing config", async () => {
    const pa = await login(PA);
    for (const [method, path, body] of [
      ["PUT", "/api/config/parameters", { params: [] }],
      ["PUT", "/api/config/thresholds", { best: 8, mediocre: 5 }],
      ["PUT", "/api/config/ai-prompt", { prompt: "x" }],
      ["PUT", "/api/config/plan", { plan: "pro" }],
      ["POST", "/api/config/credits", { credits: 10 }],
    ] as const) {
      const res = await req(method, path, pa, body);
      expect(res.status, `${method} ${path}`).toBe(403);
    }
    // Full settings read is admin-only too.
    expect((await get("/api/config", pa)).status).toBe(403);
  });

  it("any authed user reads the safe summary subset", async () => {
    const jury = await login(JURY);
    const res = await get("/api/config/summary", jury);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { thresholdBest: number; plan: string; coreParams: unknown[] };
    expect(body.thresholdBest).toBe(7);
    expect(body.plan).toBe("premium");
    expect(body.coreParams.length).toBeGreaterThan(0);
  });

  it("unauthenticated requests are rejected", async () => {
    expect((await get("/api/config/summary", "")).status).toBe(401);
  });
});

describe("thresholds + AI prompt", () => {
  it("admin persists thresholds and rejects an inverted band", async () => {
    const admin = await login(ADMIN);
    const ok = await req("PUT", "/api/config/thresholds", admin, { best: 8.2, mediocre: 6 });
    expect(ok.status).toBe(200);
    const s = (await (await get("/api/config/summary", admin)).json()) as { thresholdBest: number };
    expect(s.thresholdBest).toBe(8.2);

    const bad = await req("PUT", "/api/config/thresholds", admin, { best: 4, mediocre: 6 });
    expect(bad.status).toBe(400);
    // Equal bands would leave the Mediocre band empty/inverted — reject them too.
    const equal = await req("PUT", "/api/config/thresholds", admin, { best: 6, mediocre: 6 });
    expect(equal.status).toBe(400);
  });

  it("admin persists the AI system prompt (read back by the evaluator)", async () => {
    const admin = await login(ADMIN);
    const res = await req("PUT", "/api/config/ai-prompt", admin, { prompt: "  Weight climate impact heavily.  " });
    expect(res.status).toBe(200);
    const row = await env.DB.prepare("SELECT ai_system_prompt FROM org_settings WHERE edition = 'incubator'").first<{
      ai_system_prompt: string;
    }>();
    expect(row!.ai_system_prompt).toBe("Weight climate impact heavily.");
  });
});

describe("weight change re-scores stored totals", () => {
  it("recomputes deck ai_score + evaluation roll-ups against new weights", async () => {
    const admin = await login(ADMIN);
    const deckId = "cfg_rescore_deck";
    const tractionId = await paramId("traction_validation");

    // A deck whose only non-zero AI score is Traction (weight 10). Over the full
    // rubric weight (100) → 10*10/100 = 1.00.
    await env.DB.prepare(
      "INSERT INTO decks (id, edition, name, status, ai_score, signal, complete) VALUES (?, 'incubator', 'RescoreCo', 'ai_evaluated', 1.0, 'absent', 1)",
    )
      .bind(deckId)
      .run();
    await env.DB.prepare(
      "INSERT INTO scores (id, deck_id, evaluator_id, evaluator_kind, parameter_id, value) VALUES (?, ?, NULL, 'ai', ?, 10)",
    )
      .bind(`${deckId}_ai_0`, deckId, tractionId)
      .run();
    await env.DB.prepare(
      "INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, verdict) VALUES (?, ?, NULL, 1.0, 'below_gate')",
    )
      .bind(`${deckId}_ai_eval`, deckId)
      .run();

    // Bump Traction's weight 10 → 50. New denominator 140, numerator 500 → 3.57.
    const res = await req("PUT", "/api/config/parameters", admin, {
      params: [{ id: tractionId, weight: 50 }],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rescored: { decks: number } };
    expect(body.rescored.decks).toBeGreaterThanOrEqual(1);

    const deck = await env.DB.prepare("SELECT ai_score, signal FROM decks WHERE id = ?")
      .bind(deckId)
      .first<{ ai_score: number; signal: string }>();
    expect(deck!.ai_score).toBeCloseTo(3.57, 2);
    expect(deck!.signal).toBe("weak"); // 3.57 → weak band

    const evalRow = await env.DB.prepare(
      "SELECT weighted_total FROM evaluations WHERE deck_id = ? AND evaluator_id IS NULL",
    )
      .bind(deckId)
      .first<{ weighted_total: number }>();
    expect(evalRow!.weighted_total).toBeCloseTo(3.57, 2);
  });

  it("rejects an out-of-range weight and a non-core param id", async () => {
    const admin = await login(ADMIN);
    const tractionId = await paramId("traction_validation");
    expect((await req("PUT", "/api/config/parameters", admin, { params: [{ id: tractionId, weight: 500 }] })).status).toBe(400);
    expect((await req("PUT", "/api/config/parameters", admin, { params: [{ id: "nope", weight: 5 }] })).status).toBe(400);
  });
});

describe("plan tier gates parameter config", () => {
  it("Standard = no config · Pro = core 13 · Premium = additional too", async () => {
    const admin = await login(ADMIN);
    const tractionId = await paramId("traction_validation");
    const core = { params: [{ id: tractionId, weight: 10 }] };
    const add = { name: "Thesis fit", roleScope: "jury" };

    // Standard → neither core nor additional config allowed.
    expect((await req("PUT", "/api/config/plan", admin, { plan: "standard" })).status).toBe(200);
    let s = (await (await get("/api/config/summary", admin)).json()) as {
      coreConfigEnabled: boolean;
      additionalEnabled: boolean;
    };
    expect(s.coreConfigEnabled).toBe(false);
    expect(s.additionalEnabled).toBe(false);
    expect((await req("PUT", "/api/config/parameters", admin, core)).status).toBe(402);
    expect((await req("POST", "/api/config/additional-params", admin, add)).status).toBe(402);

    // Pro → core unlocked, additional still gated.
    expect((await req("PUT", "/api/config/plan", admin, { plan: "pro" })).status).toBe(200);
    s = (await (await get("/api/config/summary", admin)).json()) as {
      coreConfigEnabled: boolean;
      additionalEnabled: boolean;
    };
    expect(s.coreConfigEnabled).toBe(true);
    expect(s.additionalEnabled).toBe(false);
    expect((await req("PUT", "/api/config/parameters", admin, core)).status).toBe(200);
    expect((await req("POST", "/api/config/additional-params", admin, add)).status).toBe(402);

    // Premium → additional unlocked. Restore the seed plan for later tests.
    expect((await req("PUT", "/api/config/plan", admin, { plan: "premium" })).status).toBe(200);
    s = (await (await get("/api/config/summary", admin)).json()) as {
      coreConfigEnabled: boolean;
      additionalEnabled: boolean;
    };
    expect(s.additionalEnabled).toBe(true);
  });

  it("rejects an invalid plan value", async () => {
    const admin = await login(ADMIN);
    expect((await req("PUT", "/api/config/plan", admin, { plan: "enterprise" })).status).toBe(400);
  });
});

describe("role-scoped additional params (Premium)", () => {
  it("enforces ≤3 per role, validates the owner role, and edits rename/prompt", async () => {
    const admin = await login(ADMIN);
    expect((await req("PUT", "/api/config/plan", admin, { plan: "premium" })).status).toBe(200);

    // Seed gives jury exactly 3 additional params → a 4th is blocked.
    const juryParam = await env.DB.prepare(
      "SELECT id FROM parameters WHERE edition='incubator' AND active=1 AND informational=1 AND role_scope='jury' ORDER BY sort_order LIMIT 1",
    ).first<{ id: string }>();
    expect(
      (await req("POST", "/api/config/additional-params", admin, { name: "Extra", roleScope: "jury" })).status,
    ).toBe(409);

    // An invalid / non-owner role is rejected (founder never owns params).
    expect(
      (await req("POST", "/api/config/additional-params", admin, { name: "Bad", roleScope: "founder" })).status,
    ).toBe(400);

    // Free a slot → add succeeds (informational, role-scoped) → re-add blocked again.
    expect((await req("DELETE", `/api/config/additional-params/${juryParam!.id}`, admin)).status).toBe(200);
    const created = await req("POST", "/api/config/additional-params", admin, {
      name: "Jury lens",
      roleScope: "jury",
      prompt: "Assess X. Score 0-10.",
    });
    expect(created.status).toBe(200);
    const { param } = (await created.json()) as {
      param: { id: string; informational: boolean; roleScope: string; prompt?: string };
    };
    expect(param.informational).toBe(true);
    expect(param.roleScope).toBe("jury");
    expect(
      (await req("POST", "/api/config/additional-params", admin, { name: "One too many", roleScope: "jury" }))
        .status,
    ).toBe(409);

    // Rename + prompt edit persists AND bumps criteria_version (rescore trigger).
    const before = await env.DB.prepare(
      "SELECT criteria_version FROM org_settings WHERE edition='incubator'",
    ).first<{ criteria_version: number }>();
    const upd = await req("PUT", `/api/config/additional-params/${param.id}`, admin, {
      name: "Jury lens v2",
      prompt: "New prompt. Score 0-10.",
    });
    expect(upd.status).toBe(200);
    const after = await env.DB.prepare(
      "SELECT criteria_version FROM org_settings WHERE edition='incubator'",
    ).first<{ criteria_version: number }>();
    expect(after!.criteria_version).toBeGreaterThan(before!.criteria_version);
    const row = await env.DB.prepare("SELECT name, prompt FROM parameters WHERE id = ?")
      .bind(param.id)
      .first<{ name: string; prompt: string }>();
    expect(row!.name).toBe("Jury lens v2");
    expect(row!.prompt).toBe("New prompt. Score 0-10.");
  });
});

describe("admin-granted credits", () => {
  it("sets an absolute balance and rejects negatives", async () => {
    const admin = await login(ADMIN);
    const ok = await req("POST", "/api/config/credits", admin, { credits: 12 });
    expect(ok.status).toBe(200);
    const row = await env.DB.prepare("SELECT credits_balance FROM org_settings WHERE edition = 'incubator'").first<{
      credits_balance: number;
    }>();
    expect(row!.credits_balance).toBe(12);
    expect((await req("POST", "/api/config/credits", admin, { credits: -1 })).status).toBe(400);
  });
});
