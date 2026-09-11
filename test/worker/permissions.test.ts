/**
 * W3-A — `GET`/`PUT /api/permissions` and the runtime gate they drive.
 *
 * The console's Task permissions grid (F0018 / F0019 / F0903) is the first
 * authorisation surface in this product that an administrator can change without
 * a redeploy, so the tests that matter are the ones about BLAST RADIUS:
 * unticking one cell must remove exactly one capability, from exactly one role,
 * and every newly gated route must 403 for the role that lost it.
 *
 * NB worker-test storage is isolated per FILE but shared across the `it`s in it,
 * so every test that writes a cell puts it back.
 */
import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { permissionTasksFor, PERMISSION_ROLES } from "../../src/shared/types";

const BASE = "https://example.com";

const INC_SUPER = "priya.sharma@demo.startupjury.ai";
const INC_ADMIN = "nisha.kapoor@demo.startupjury.ai";
const INC_PM = "raj.kumar@demo.startupjury.ai";
const INC_PA = "sunita.rao@demo.startupjury.ai";
const INC_JURY = "rajesh.kumar@demo.startupjury.ai";
const INC_FOUNDER = "meera.sharma@demo.startupjury.ai";
const VC_ADMIN = "nisha.kapoor.vc@demo.startupjury.ai";
const VC_PARTNER = "ishaan.sethi@demo.startupjury.ai";

async function login(email: string, password = "demo1234"): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
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

/** Write one cell directly, bypassing the route (used to set up a 403 path). */
async function setCell(edition: string, role: string, taskId: string, granted: boolean) {
  await env.DB.prepare(
    "INSERT INTO role_permissions (edition, role, task_id, granted) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT (edition, role, task_id) DO UPDATE SET granted = excluded.granted",
  )
    .bind(edition, role, taskId, granted ? 1 : 0)
    .run();
}

interface Grid {
  edition: string;
  roles: { role: string; label: string }[];
  tasks: { id: string; label: string; group: string }[];
  grid: Record<string, Record<string, boolean>>;
}

// ── GET ─────────────────────────────────────────────────────────────────────

describe("GET /api/permissions", () => {
  it("returns the whole grid for the caller's edition", async () => {
    const cookie = await login(INC_ADMIN);
    const res = await get("/api/permissions", cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Grid;

    expect(body.edition).toBe("incubator");
    expect(body.roles.map((r) => r.role)).toEqual([...PERMISSION_ROLES.incubator]);
    expect(body.roles.find((r) => r.role === "program_manager")?.label).toBe("Program Manager");
    expect(body.tasks).toHaveLength(permissionTasksFor("incubator").length);
    // The prototype's own row labels, not our slugs.
    expect(body.tasks.find((t) => t.id === "outofofficedelegation")?.label).toBe("Out of office delegation");
    expect(body.tasks.find((t) => t.id === "addmembers")?.label).toBe("Permit to add team members");
    expect(body.tasks.find((t) => t.id === "adminconsole")?.label).toBe("Access to admin console");
  });

  it("resolves cells from the seed, superuser included", async () => {
    const cookie = await login(INC_ADMIN);
    const { grid } = (await (await get("/api/permissions", cookie)).json()) as Grid;
    expect(grid.adminconsole.admin).toBe(true);
    expect(grid.adminconsole.jury).toBe(false);
    expect(grid.evaluate.jury).toBe(true);
    // §8 Q5 / F0919 — the PM reaches the two post-intro-call stages (0040).
    expect(grid.signuppipeline.program_manager).toBe(true);
    expect(grid.onboard.program_manager).toBe(true);
    // Every task is granted to the superuser.
    for (const task of permissionTasksFor("incubator")) {
      expect(grid[task.id].superuser, task.id).toBe(true);
    }
  });

  it("is scoped to the caller's edition", async () => {
    const { grid, tasks } = (await (await get("/api/permissions", await login(VC_ADMIN))).json()) as Grid;
    expect(tasks.map((t) => t.id)).toContain("icpipeline");
    expect(tasks.map((t) => t.id)).not.toContain("signuppipeline");
    // F0917 — the partner votes, so the partner reaches IC Pipeline (0040).
    expect(grid.icpipeline.partner).toBe(true);
  });

  it("403s every role without the console, and 401s an anonymous caller", async () => {
    for (const email of [INC_PM, INC_PA, INC_JURY, INC_FOUNDER]) {
      const res = await get("/api/permissions", await login(email));
      expect(res.status, email).toBe(403);
    }
    expect((await SELF.fetch(`${BASE}/api/permissions`)).status).toBe(401);
  });
});

// ── PUT ─────────────────────────────────────────────────────────────────────

describe("PUT /api/permissions", () => {
  it("writes a cell, records the actor, and reports the resolved value", async () => {
    const cookie = await login(INC_ADMIN);
    const res = await req("PUT", "/api/permissions", cookie, {
      cells: [{ role: "program_manager", taskId: "remind", granted: false }],
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toMatchObject({
      ok: true,
      updated: 1,
      cells: [{ role: "program_manager", taskId: "remind", granted: false }],
    });

    const row = await env.DB.prepare(
      "SELECT granted, updated_by FROM role_permissions WHERE edition = 'incubator' AND role = 'program_manager' AND task_id = 'remind'",
    ).first<{ granted: number; updated_by: string | null }>();
    expect(row?.granted).toBe(0);
    expect(row?.updated_by).toBeTruthy();

    await setCell("incubator", "program_manager", "remind", true);
  });

  it("validates the body", async () => {
    const cookie = await login(INC_ADMIN);
    const cases: [unknown, string][] = [
      [{}, "no_cells"],
      [{ cells: [] }, "no_cells"],
      [{ cells: [{ role: "jury" }] }, "invalid_cell"],
      [{ cells: [{ role: "jury", taskId: "upload", granted: "yes" }] }, "invalid_granted"],
      [{ cells: [{ role: "not_a_role", taskId: "upload", granted: true }] }, "invalid_role"],
      [{ cells: [{ role: "partner", taskId: "upload", granted: true }] }, "invalid_role"], // wrong edition
      [{ cells: [{ role: "jury", taskId: "not_a_task", granted: true }] }, "invalid_task"],
      [{ cells: [{ role: "jury", taskId: "icpipeline", granted: true }] }, "invalid_task"], // VC-only
    ];
    for (const [body, error] of cases) {
      const res = await req("PUT", "/api/permissions", cookie, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect((await res.json()) as { error: string }).toEqual({ error });
    }
  });

  it("refuses to edit the superuser row (the account's single owner)", async () => {
    const res = await req("PUT", "/api/permissions", await login(INC_ADMIN), {
      cells: [{ role: "superuser", taskId: "adminconsole", granted: false }],
    });
    expect(res.status).toBe(403);
    expect((await res.json()) as { error: string }).toEqual({ error: "immutable_superuser" });
  });

  it("refuses to close the caller's own console door", async () => {
    const res = await req("PUT", "/api/permissions", await login(INC_ADMIN), {
      cells: [{ role: "admin", taskId: "adminconsole", granted: false }],
    });
    expect(res.status).toBe(403);
    expect((await res.json()) as { error: string }).toEqual({ error: "cannot_lock_yourself_out" });
    // …but a superuser may close the ADMIN's door, since it is not their own.
    const su = await req("PUT", "/api/permissions", await login(INC_SUPER), {
      cells: [{ role: "admin", taskId: "adminconsole", granted: false }],
    });
    expect(su.status).toBe(200);
    await setCell("incubator", "admin", "adminconsole", true);
  });

  it("403s a role without the console", async () => {
    for (const email of [INC_PM, INC_JURY]) {
      const res = await req("PUT", "/api/permissions", await login(email), {
        cells: [{ role: "jury", taskId: "upload", granted: true }],
      });
      expect(res.status, email).toBe(403);
    }
  });

  it("writes several cells in one call", async () => {
    const cookie = await login(INC_ADMIN);
    const res = await req("PUT", "/api/permissions", cookie, {
      cells: [
        { role: "jury", taskId: "archive", granted: false },
        { role: "program_associate", taskId: "archive", granted: false },
      ],
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { updated: number }).updated).toBe(2);
    await setCell("incubator", "jury", "archive", true);
    await setCell("incubator", "program_associate", "archive", true);
  });
});

// ── The gate itself ─────────────────────────────────────────────────────────

describe("flipping one cell changes exactly one capability", () => {
  it("takes the nav item off /api/auth/me and 403s the route, for that role only", async () => {
    const adminCookie = await login(INC_ADMIN);
    const paCookie = await login(INC_PA);

    // Baseline: the associate holds `signuppipeline` and can act on it.
    const before = (await (await get("/api/auth/me", paCookie)).json()) as { user: { permissions: string[] } };
    expect(before.user.permissions).toContain("signuppipeline");
    expect((await req("POST", "/api/decks/deck_ghost/send-signup", paCookie, {})).status).not.toBe(403);

    await req("PUT", "/api/permissions", adminCookie, {
      cells: [{ role: "program_associate", taskId: "signuppipeline", granted: false }],
    });

    const after = (await (await get("/api/auth/me", paCookie)).json()) as { user: { permissions: string[] } };
    expect(after.user.permissions).not.toContain("signuppipeline");
    // Exactly one task moved — nothing else in the associate's set changed.
    expect(before.user.permissions.filter((t) => !after.user.permissions.includes(t))).toEqual(["signuppipeline"]);
    expect(after.user.permissions.filter((t) => !before.user.permissions.includes(t))).toEqual([]);

    // The route the cell gates now refuses…
    expect((await req("POST", "/api/decks/deck_ghost/send-signup", paCookie, {})).status).toBe(403);
    // …while a neighbouring capability of the SAME role is untouched…
    expect((await req("POST", "/api/decks/deck_ghost/queries", paCookie, { questions: "x" })).status).not.toBe(403);
    // …and another role that holds the same task keeps it.
    const adminMe = (await (await get("/api/auth/me", adminCookie)).json()) as { user: { permissions: string[] } };
    expect(adminMe.user.permissions).toContain("signuppipeline");
    expect((await req("POST", "/api/decks/deck_ghost/send-signup", adminCookie, {})).status).not.toBe(403);

    await setCell("incubator", "program_associate", "signuppipeline", true);
  });

  it("cannot GRANT a route the role list withholds — gate, not grant (§8 Q8)", async () => {
    const adminCookie = await login(INC_ADMIN);
    const juryCookie = await login(INC_JURY);
    // `jury` is not on POST /api/decks/:id/queries' role list. Ticking `query`
    // on for the jury must change nothing at all.
    expect((await req("POST", "/api/decks/deck_ghost/queries", juryCookie, { questions: "x" })).status).toBe(403);
    await req("PUT", "/api/permissions", adminCookie, {
      cells: [{ role: "jury", taskId: "query", granted: true }],
    });
    expect((await req("POST", "/api/decks/deck_ghost/queries", juryCookie, { questions: "x" })).status).toBe(403);
    await setCell("incubator", "jury", "query", false);
  });
});

// ── A 403 path for every newly gated route ──────────────────────────────────

describe("every newly gated route has a 403 path", () => {
  /** [label, task, method, path, body] — all admin-reachable today. */
  const GATED: [string, string, string, string, unknown?][] = [
    ["GET /api/config", "adminconsole", "GET", "/api/config"],
    ["GET /api/users", "adminconsole", "GET", "/api/users"],
    ["PATCH /api/users/:id", "adminconsole", "PATCH", "/api/users/user_ghost", {}],
    ["GET /api/anchors", "adminconsole", "GET", "/api/anchors"],
    ["PUT /api/config/thresholds", "adminconsole", "PUT", "/api/config/thresholds", {}],
    ["PUT /api/config/branding", "adminconsole", "PUT", "/api/config/branding", {}],
    ["PUT /api/config/ai-prompt", "adminconsole", "PUT", "/api/config/ai-prompt", {}],
    ["PUT /api/config/scoring-framework", "adminconsole", "PUT", "/api/config/scoring-framework", {}],
    ["GET /api/permissions", "adminconsole", "GET", "/api/permissions"],
    ["POST /api/users", "addmembers", "POST", "/api/users", {}],
    ["PUT /api/config/plan", "upgrade", "PUT", "/api/config/plan", {}],
    ["POST /api/config/credits", "upgrade", "POST", "/api/config/credits", {}],
    ["POST /api/config/credits/purchase", "upgrade", "POST", "/api/config/credits/purchase", { pack: "x" }],
    ["POST /api/config/additional-params", "configparams", "POST", "/api/config/additional-params", {}],
    ["DELETE /api/config/additional-params/:id", "configparams", "DELETE", "/api/config/additional-params/x"],
    ["PUT /api/config/additional-params/:id/permit", "configparams", "PUT", "/api/config/additional-params/x/permit", {}],
    ["POST /api/decks/:id/assign", "assign", "POST", "/api/decks/deck_ghost/assign", {}],
    ["GET /api/jury", "assign", "GET", "/api/jury"],
    ["POST /api/decks/:id/evaluate", "evaluate", "POST", "/api/decks/deck_ghost/evaluate", {}],
    ["POST /api/decks/:id/rescore", "evaluate", "POST", "/api/decks/deck_ghost/rescore", {}],
    ["PATCH /api/decks/:id", "upload", "PATCH", "/api/decks/deck_ghost", {}],
    ["POST /api/decks/:id/retry-ai", "upload", "POST", "/api/decks/deck_ghost/retry-ai", {}],
    ["POST /api/decks/:id/version", "upload", "POST", "/api/decks/deck_ghost/version", {}],
    ["PUT /api/decks/:id/onboarding", "onboard", "PUT", "/api/decks/deck_ghost/onboarding", {}],
    ["POST /api/decks/:id/queries", "query", "POST", "/api/decks/deck_ghost/queries", { questions: "x" }],
    ["GET /api/questions (bank)", "adminconsole", "GET", "/api/questions"],
    ["GET /api/questions/draft/:deckId", "query", "GET", "/api/questions/draft/deck_ghost"],
  ];

  it.each(GATED)("%s → 403 once its `%s` cell is unticked", async (_label, task, method, path, body) => {
    const cookie = await login(INC_ADMIN);
    expect((await req(method, path, cookie, body)).status).not.toBe(403);
    await setCell("incubator", "admin", task, false);
    try {
      expect((await req(method, path, cookie, body)).status).toBe(403);
    } finally {
      await setCell("incubator", "admin", task, true);
    }
    expect((await req(method, path, cookie, body)).status).not.toBe(403);
  });

  it("gates ACTIVATE and DEACTIVATE separately on PATCH /api/users/:id", async () => {
    const cookie = await login(INC_ADMIN);
    const created = await req("POST", "/api/users", cookie, {
      name: "Perm Probe",
      email: "perm.probe@demo.startupjury.ai",
      role: "jury",
      password: "demo1234",
    });
    expect(created.status).toBe(200);
    const { user } = (await created.json()) as { user: { id: string } };

    await setCell("incubator", "admin", "deactivateuser", false);
    // Deactivating is refused…
    expect((await req("PATCH", `/api/users/${user.id}`, cookie, { active: false })).status).toBe(403);
    // …while a rename, which flips no active flag, still goes through.
    expect((await req("PATCH", `/api/users/${user.id}`, cookie, { name: "Renamed Probe" })).status).toBe(200);
    await setCell("incubator", "admin", "deactivateuser", true);

    expect((await req("PATCH", `/api/users/${user.id}`, cookie, { active: false })).status).toBe(200);
    await setCell("incubator", "admin", "activateuser", false);
    expect((await req("PATCH", `/api/users/${user.id}`, cookie, { active: true })).status).toBe(403);
    await setCell("incubator", "admin", "activateuser", true);
    expect((await req("PATCH", `/api/users/${user.id}`, cookie, { active: true })).status).toBe(200);
  });

  it("lets `configparams` grant a non-admin the additional-parameter edit (spec §10)", async () => {
    // §8 Q6 / F0080 — the VC partner is a default editor now (0040).
    const partner = (await (await get("/api/auth/me", await login(VC_PARTNER))).json()) as {
      user: { permissions: string[] };
    };
    expect(partner.user.permissions).toContain("configparams");
    // …and the incubator PM likewise.
    const pm = (await (await get("/api/auth/me", await login(INC_PM))).json()) as { user: { permissions: string[] } };
    expect(pm.user.permissions).toContain("configparams");
    // A jury member is not, and the console is where that would be changed.
    const jury = (await (await get("/api/auth/me", await login(INC_JURY))).json()) as {
      user: { permissions: string[] };
    };
    expect(jury.user.permissions).not.toContain("configparams");
  });
});
