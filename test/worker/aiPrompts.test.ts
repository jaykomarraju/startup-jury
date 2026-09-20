/**
 * V3-AW — `/api/ai-prompts`: the AI prompt behind each evaluation area (item 11)
 * and the Seat-configurability grid that decides who may edit one (item 12).
 *
 * The grid is a PERMISSION, so the assertions below are on the RESPONSE, never
 * on whether a button rendered: a seat tier that may not configure a set gets
 * 402 on the WRITE. Each gate is also run in reverse — flip the cell, repeat
 * the identical request, watch it turn 200 — so a test cannot pass by the gate
 * never having been reached.
 *
 * Seat tiers come from `0052`: superuser = Premium, admin = Pro, everyone else
 * Standard; the org plan is Premium (`0002`). So the incubator ADMIN is the
 * natural Pro subject — core yes, additional no — with no fixture to build.
 */
import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { PROTOTYPE_CORE_PROMPTS, DEFAULT_SEAT_CAPABILITY } from "../../src/shared/aiPrompts";

const BASE = "https://example.com";

const SUPERUSER = "priya.sharma@demo.startupjury.ai"; // premium seat
const ADMIN = "nisha.kapoor@demo.startupjury.ai"; // pro seat
const JURY = "rajesh.kumar@demo.startupjury.ai"; // standard seat, non-admin
const FOUNDER = "meera.sharma@demo.startupjury.ai";
const VC_SUPERUSER = "aarav.khanna@demo.startupjury.ai";

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

interface PromptView {
  id: string;
  key: string;
  name: string;
  informational: boolean;
  prompt: string | null;
  promptDefault: string | null;
  isDefault: boolean;
}

interface PromptsBody {
  params: PromptView[];
  capability: { core: Record<string, boolean>; addl: Record<string, boolean> };
  tier: string;
  coreEditable: boolean;
  additionalEditable: boolean;
}

async function view(cookie: string): Promise<PromptsBody> {
  const res = await get("/api/ai-prompts", cookie);
  expect(res.status).toBe(200);
  return (await res.json()) as PromptsBody;
}

async function paramId(key: string, edition = "incubator"): Promise<string> {
  const row = await env.DB.prepare("SELECT id FROM parameters WHERE edition = ? AND key = ?")
    .bind(edition, key)
    .first<{ id: string }>();
  return row!.id;
}

/**
 * An additional parameter's id, taken from the payload rather than a literal
 * key: `0025` renamed every one of them, so a hard-coded key is a test that
 * breaks on a rename it is not about.
 */
async function additionalIds(cookie: string, n = 1): Promise<string[]> {
  const ids = (await view(cookie)).params.filter((p) => p.informational).map((p) => p.id);
  expect(ids.length).toBeGreaterThanOrEqual(n);
  return ids.slice(0, n);
}

/**
 * D1 state is NOT isolated between tests in this pool — a write in one test is
 * visible to the next (probed, not assumed: two tests in one file, the second
 * reads the first's `UPDATE`). Every test below flips the grid or edits a
 * prompt, so without this each one would inherit whatever its predecessor left
 * and the gate assertions would pass or fail by ORDER rather than by rule.
 *
 * It resets only what a route can write: the six grid cells, and `prompt`. It
 * never touches `prompt_default`, which nothing but migration 0071 writes —
 * so the migration assertions below stay real rather than being handed their
 * own expectation by this hook.
 */
beforeEach(async () => {
  for (const set of ["core", "addl"] as const) {
    for (const tier of ["standard", "pro", "premium"] as const) {
      await env.DB.prepare(
        "UPDATE seat_capabilities SET allowed = ? WHERE param_set = ? AND tier = ?",
      )
        .bind(DEFAULT_SEAT_CAPABILITY[set][tier] ? 1 : 0, set, tier)
        .run();
    }
  }
  await env.DB.prepare("UPDATE parameters SET prompt = prompt_default").run();
});

describe("migration 0071 · the shipped default", () => {
  it("gives all 22 incubator parameters a shipped default to restore to", async () => {
    const su = await login(SUPERUSER);
    const { params } = await view(su);
    expect(params).toHaveLength(22);
    expect(params.filter((p) => !p.informational)).toHaveLength(13);
    expect(params.filter((p) => p.informational)).toHaveLength(9);
    for (const p of params) {
      expect(p.promptDefault, `${p.key} has no shipped default`).not.toBeNull();
    }
  });

  it("takes that default from the prompt the org already evaluates against", async () => {
    // `prompt_default` is written by 0071 and by nothing else — no route
    // touches it and the reset hook above does not either — so this is the
    // migration's own output, read back.
    const row = await env.DB.prepare(
      "SELECT prompt_default d FROM parameters WHERE id = 'inc_market_size'",
    ).first<{ d: string }>();
    expect(row!.d).toBe(
      "Look for credible TAM/SAM/SOM built bottom-up and a reachable beachhead. " +
        "Flag top-down-only sizing or inflated numbers.",
    );
  });

  it("leaves the live prompts as 0027 wrote them — this release changes no score", async () => {
    // The guard against a future edit quietly adopting the prototype's
    // placeholder copy: what the AI is asked is 0027's extraction guidance, in
    // BOTH editions, exactly as before this session.
    const rows = (
      await env.DB.prepare(
        "SELECT edition, prompt_default d FROM parameters WHERE informational = 0 AND active = 1",
      ).all<{ edition: string; d: string | null }>()
    ).results;
    expect(rows).toHaveLength(26);
    expect(rows.every((r) => r.d !== null)).toBe(true);
    // None of the 26 carries the prototype's placeholder copy.
    const proto = new Set(Object.values(PROTOTYPE_CORE_PROMPTS));
    expect(rows.some((r) => proto.has(r.d!))).toBe(false);
  });

  it("records all 13 of the prototype's own prompts verbatim, unapplied (§4 Q62)", () => {
    // Recorded so the client's answer to Q62 is a one-line switch rather than a
    // second decode. The shared boilerplate tail is what makes them read as
    // placeholder copy, so it is asserted too.
    const keys = Object.keys(PROTOTYPE_CORE_PROMPTS);
    expect(keys).toHaveLength(13);
    const tail =
      "Evaluate against the rubric anchors below. If signals are weak, missing, or " +
      "contradictory, this area is flagged as missing and pointed out to the founder in " +
      "the follow-up email (the founder then responds with an updated deck).";
    expect(keys.every((k) => PROTOTYPE_CORE_PROMPTS[k].endsWith(tail))).toBe(true);
    expect(PROTOTYPE_CORE_PROMPTS["business_risks"]).toBe(`What can kill this? ${tail}`);
  });
});

describe("GET /api/ai-prompts · who may read", () => {
  it("a jury member reads the prompts they are scored against", async () => {
    const body = await view(await login(JURY));
    expect(body.params).toHaveLength(22);
    expect(body.tier).toBe("standard");
    // Reading is not editing: a Standard seat configures nothing by default.
    expect(body.coreEditable).toBe(false);
    expect(body.additionalEditable).toBe(false);
  });

  it("a founder cannot", async () => {
    expect((await get("/api/ai-prompts", await login(FOUNDER))).status).toBe(403);
  });

  it("an unauthenticated request cannot", async () => {
    expect((await get("/api/ai-prompts", "")).status).toBe(401);
  });

  it("reports the default grid, which is the ladder the app has always used", async () => {
    const body = await view(await login(SUPERUSER));
    expect(body.capability).toEqual(DEFAULT_SEAT_CAPABILITY);
    expect(body.tier).toBe("premium");
    expect(body.coreEditable).toBe(true);
    expect(body.additionalEditable).toBe(true);
  });
});

describe("writing a prompt", () => {
  it("a superuser saves and the text is what the AI is then given", async () => {
    const su = await login(SUPERUSER);
    const id = await paramId("problem_market_clarity");
    const res = await req("PUT", `/api/ai-prompts/params/${id}`, su, {
      prompt: "  Look for a named buyer with a budget.  ",
    });
    expect(res.status).toBe(200);
    const row = await env.DB.prepare("SELECT prompt FROM parameters WHERE id = ?")
      .bind(id)
      .first<{ prompt: string }>();
    expect(row!.prompt).toBe("Look for a named buyer with a budget.");
    expect((await view(su)).params.find((p) => p.id === id)!.isDefault).toBe(false);
  });

  it("bumps criteria_version, so the rescore guard sees the rubric change", async () => {
    const su = await login(SUPERUSER);
    const before = await env.DB.prepare(
      "SELECT criteria_version v FROM org_settings WHERE edition = 'incubator'",
    ).first<{ v: number }>();
    await req("PUT", `/api/ai-prompts/params/${await paramId("market_size")}`, su, { prompt: "x" });
    const after = await env.DB.prepare(
      "SELECT criteria_version v FROM org_settings WHERE edition = 'incubator'",
    ).first<{ v: number }>();
    expect(after!.v).toBe(before!.v + 1);
  });

  it("stores a blank prompt as no guidance rather than an empty Guidance line", async () => {
    const su = await login(SUPERUSER);
    const id = await paramId("storytelling");
    expect((await req("PUT", `/api/ai-prompts/params/${id}`, su, { prompt: "   " })).status).toBe(200);
    const row = await env.DB.prepare("SELECT prompt FROM parameters WHERE id = ?")
      .bind(id)
      .first<{ prompt: string | null }>();
    expect(row!.prompt).toBeNull();
  });

  it("a non-admin role is forbidden outright", async () => {
    const jury = await login(JURY);
    const id = await paramId("problem_market_clarity");
    expect((await req("PUT", `/api/ai-prompts/params/${id}`, jury, { prompt: "x" })).status).toBe(403);
    expect((await req("POST", `/api/ai-prompts/params/${id}/restore`, jury)).status).toBe(403);
    expect((await req("POST", "/api/ai-prompts/restore-all", jury, { set: "core" })).status).toBe(403);
    expect(
      (await req("PUT", "/api/ai-prompts/capability", jury, { set: "core", tier: "pro", allowed: false }))
        .status,
    ).toBe(403);
  });

  it("an unknown parameter is 404, not a silent no-op", async () => {
    const su = await login(SUPERUSER);
    expect((await req("PUT", "/api/ai-prompts/params/nope", su, { prompt: "x" })).status).toBe(404);
  });

  it("does not reach across editions", async () => {
    const su = await login(SUPERUSER); // incubator
    const vcId = await paramId("problem_market_clarity", "vc");
    expect((await req("PUT", `/api/ai-prompts/params/${vcId}`, su, { prompt: "x" })).status).toBe(404);
  });
});

describe("the seat gate · 402 on the WRITE, not a hidden button", () => {
  it("a Pro seat may configure the core set and NOT the additional one", async () => {
    const admin = await login(ADMIN); // pro seat, premium org → effective pro
    const body = await view(admin);
    expect(body.tier).toBe("pro");
    expect(body.coreEditable).toBe(true);
    expect(body.additionalEditable).toBe(false);

    const coreId = await paramId("team_execution");
    const [addlId] = await additionalIds(admin);

    expect((await req("PUT", `/api/ai-prompts/params/${coreId}`, admin, { prompt: "ok" })).status).toBe(
      200,
    );

    const denied = await req("PUT", `/api/ai-prompts/params/${addlId}`, admin, { prompt: "nope" });
    expect(denied.status).toBe(402);
    expect(await denied.json()).toMatchObject({ error: "plan_required", set: "addl", tier: "pro" });
    // …and the row did not move.
    const row = await env.DB.prepare("SELECT prompt, prompt_default FROM parameters WHERE id = ?")
      .bind(addlId)
      .first<{ prompt: string; prompt_default: string }>();
    expect(row!.prompt).toBe(row!.prompt_default);
  });

  it("flipping addl/pro ON turns that same 402 into a 200 — the negative control", async () => {
    const admin = await login(ADMIN);
    const [addlId] = await additionalIds(admin);
    expect((await req("PUT", `/api/ai-prompts/params/${addlId}`, admin, { prompt: "a" })).status).toBe(
      402,
    );

    const su = await login(SUPERUSER);
    expect(
      (await req("PUT", "/api/ai-prompts/capability", su, {
        set: "addl",
        tier: "pro",
        allowed: true,
      })).status,
    ).toBe(200);

    expect((await view(admin)).additionalEditable).toBe(true);
    expect((await req("PUT", `/api/ai-prompts/params/${addlId}`, admin, { prompt: "a" })).status).toBe(
      200,
    );
  });

  it("flipping core/pro OFF closes the write the same seat just made", async () => {
    const admin = await login(ADMIN);
    const coreId = await paramId("team_execution");
    expect((await req("PUT", `/api/ai-prompts/params/${coreId}`, admin, { prompt: "a" })).status).toBe(
      200,
    );

    const su = await login(SUPERUSER);
    await req("PUT", "/api/ai-prompts/capability", su, { set: "core", tier: "pro", allowed: false });

    const denied = await req("PUT", `/api/ai-prompts/params/${coreId}`, admin, { prompt: "b" });
    expect(denied.status).toBe(402);
    expect((await view(admin)).coreEditable).toBe(false);
    // The superuser's own Premium seat is untouched by a Pro-row flip.
    expect((await req("PUT", `/api/ai-prompts/params/${coreId}`, su, { prompt: "b" })).status).toBe(200);
  });

  it("gates restore-all per set, not per request", async () => {
    const admin = await login(ADMIN);
    expect((await req("POST", "/api/ai-prompts/restore-all", admin, { set: "core" })).status).toBe(200);
    expect((await req("POST", "/api/ai-prompts/restore-all", admin, { set: "addl" })).status).toBe(402);
  });

  it("rejects a set or tier it does not recognise", async () => {
    const su = await login(SUPERUSER);
    expect((await req("POST", "/api/ai-prompts/restore-all", su, { set: "everything" })).status).toBe(
      400,
    );
    expect(
      (await req("PUT", "/api/ai-prompts/capability", su, { set: "core", tier: "gold", allowed: true }))
        .status,
    ).toBe(400);
    expect(
      (await req("PUT", "/api/ai-prompts/capability", su, { set: "core", tier: "pro", allowed: "yes" }))
        .status,
    ).toBe(400);
  });

  it("is per-edition: an incubator flip leaves VC on the defaults", async () => {
    const su = await login(SUPERUSER);
    await req("PUT", "/api/ai-prompts/capability", su, { set: "addl", tier: "pro", allowed: true });
    const vc = await view(await login(VC_SUPERUSER));
    expect(vc.capability).toEqual(DEFAULT_SEAT_CAPABILITY);
  });
});

describe("restore", () => {
  it("puts one prompt back and reports it as default again", async () => {
    const su = await login(SUPERUSER);
    const id = await paramId("business_model");
    await req("PUT", `/api/ai-prompts/params/${id}`, su, { prompt: "drifted" });
    expect((await view(su)).params.find((p) => p.id === id)!.isDefault).toBe(false);

    expect((await req("POST", `/api/ai-prompts/params/${id}/restore`, su)).status).toBe(200);
    const p = (await view(su)).params.find((x) => x.id === id)!;
    expect(p.prompt).toBe(p.promptDefault);
    expect(p.isDefault).toBe(true);
  });

  it("restores all 13 core prompts and leaves the additional ones alone", async () => {
    const su = await login(SUPERUSER);
    await req("PUT", `/api/ai-prompts/params/${await paramId("market_size")}`, su, { prompt: "a" });
    await req("PUT", `/api/ai-prompts/params/${await paramId("gtm_strategy")}`, su, { prompt: "b" });
    const [addlId] = await additionalIds(su);
    await req("PUT", `/api/ai-prompts/params/${addlId}`, su, { prompt: "kept" });

    const res = await req("POST", "/api/ai-prompts/restore-all", su, { set: "core" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ set: "core", restored: 2 });

    const after = await view(su);
    expect(after.params.filter((p) => !p.informational).every((p) => p.isDefault)).toBe(true);
    expect(after.params.find((p) => p.id === addlId)!.prompt).toBe("kept");
  });

  it("restores all additional prompts across every owner role", async () => {
    const su = await login(SUPERUSER);
    const ids = await additionalIds(su, 3);
    for (const id of ids) await req("PUT", `/api/ai-prompts/params/${id}`, su, { prompt: "drift" });

    const res = await req("POST", "/api/ai-prompts/restore-all", su, { set: "addl" });
    expect(await res.json()).toMatchObject({ set: "addl", restored: 3 });
    const after = await view(su);
    expect(after.params.filter((p) => p.informational).every((p) => p.isDefault)).toBe(true);
  });

  it("restoring nothing is a no-op, not a version bump", async () => {
    const su = await login(SUPERUSER);
    const before = await env.DB.prepare(
      "SELECT criteria_version v FROM org_settings WHERE edition = 'incubator'",
    ).first<{ v: number }>();
    const res = await req("POST", "/api/ai-prompts/restore-all", su, { set: "core" });
    expect(await res.json()).toMatchObject({ restored: 0 });
    const after = await env.DB.prepare(
      "SELECT criteria_version v FROM org_settings WHERE edition = 'incubator'",
    ).first<{ v: number }>();
    expect(after!.v).toBe(before!.v);
  });
});

describe("the grid governs the rest of the config surface too", () => {
  it("closing core/pro closes PUT /api/config/parameters for that seat", async () => {
    const admin = await login(ADMIN);
    const params = (
      (await (await get("/api/config", admin)).json()) as {
        coreParams: { id: string; weight: number }[];
      }
    ).coreParams.map((p) => ({ id: p.id, weight: p.weight }));

    expect((await req("PUT", "/api/config/parameters", admin, { params })).status).toBe(200);

    const su = await login(SUPERUSER);
    await req("PUT", "/api/ai-prompts/capability", su, { set: "core", tier: "pro", allowed: false });

    const denied = await req("PUT", "/api/config/parameters", admin, { params });
    expect(denied.status).toBe(402);
  });

  it("opening addl/pro opens POST /api/config/additional-params for that seat", async () => {
    const admin = await login(ADMIN);
    const body = { name: "Late addition", roleScope: "program_manager" };
    // Three per role is the cap, so a create is expected to be refused for a
    // FULL role — assert the PLAN gate specifically, before the cap is reached.
    const denied = await req("POST", "/api/config/additional-params", admin, body);
    expect(denied.status).toBe(402);
    expect(await denied.json()).toMatchObject({ error: "plan_required" });

    const su = await login(SUPERUSER);
    await req("PUT", "/api/ai-prompts/capability", su, { set: "addl", tier: "pro", allowed: true });
    const allowed = await req("POST", "/api/config/additional-params", admin, body);
    // Past the plan gate now: whatever it answers, it is no longer 402.
    expect(allowed.status).not.toBe(402);
  });
});
