import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";

const BASE = "https://example.com";

// Seed logins (migrations/0002_seed.sql).
const INC_ADMIN = "nisha.kapoor@demo.startupjury.ai"; // incubator admin
const INC_PA = "sunita.rao@demo.startupjury.ai"; // program_associate (non-admin)
const INC_JURY = "rajesh.kumar@demo.startupjury.ai"; // jury (non-admin)
const VC_ADMIN = "nisha.kapoor.vc@demo.startupjury.ai"; // vc admin

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

interface ProgramView {
  id: string;
  name: string;
  sector?: string;
  fundSize?: number;
  fundAllocated?: number;
  active: boolean;
  cohorts: { id: string; name: string; startsOn?: string }[];
}
interface ListResp {
  sectors: { id: string; name: string }[];
  programs: ProgramView[];
}

async function listPrograms(cookie: string): Promise<ListResp> {
  return (await get("/api/programs", cookie)).json() as Promise<ListResp>;
}

// ── Backfill + read shape (before any mutations) ─────────────────────────────

describe("programs — backfill & list", () => {
  it("backfills the free-text program/cohort columns into the hierarchy", async () => {
    const inc = await login(INC_ADMIN);
    const list = await listPrograms(inc);
    const names = list.programs.map((p) => p.name);
    // Incubator programs from the seed decks are backfilled.
    expect(names).toContain("Fintech Accelerator");
    expect(names).toContain("Climate Cohort");
    // Sectors were seeded for the edition.
    expect(list.sectors.map((s) => s.name)).toContain("FinTech");
    // Climate Cohort → Cohort 6 backfilled as a nested cohort with dates.
    const climate = list.programs.find((p) => p.name === "Climate Cohort")!;
    expect(climate.cohorts.some((ch) => ch.name === "Cohort 6")).toBe(true);
  });

  it("VC programs carry fund economics and are edition-scoped", async () => {
    const vc = await login(VC_ADMIN);
    const list = await listPrograms(vc);
    const names = list.programs.map((p) => p.name);
    expect(names).toContain("Fund II");
    expect(names).toContain("Deep Tech Fund");
    // Incubator programs never leak into the VC list.
    expect(names).not.toContain("Fintech Accelerator");
    const fundII = list.programs.find((p) => p.name === "Fund II")!;
    expect(fundII.fundSize).toBe(300);
    expect(fundII.fundAllocated).toBe(210);
  });

  it("VC program fund fields feed the Capital Deployment report", async () => {
    const vc = await login(VC_ADMIN);
    const d = (await (await get("/api/analytics/capital", vc)).json()) as {
      committed: number;
      allocated: number;
      deployed: number;
    };
    expect(d.committed).toBe(300); // SUM(fund_size) over active VC programs
    expect(d.allocated).toBe(210); // SUM(fund_allocated)
    expect(d.deployed).toBe(92); // still the sum of portfolio positions
  });
});

// ── AuthZ ─────────────────────────────────────────────────────────────────────

describe("programs — authZ", () => {
  it("any authed user may read the hierarchy, but only admins mutate", async () => {
    const pa = await login(INC_PA);
    expect((await get("/api/programs", pa)).status).toBe(200);
    for (const [method, path, body] of [
      ["POST", "/api/programs", { name: "X" }],
      ["POST", "/api/programs/sectors", { name: "X" }],
      ["POST", "/api/programs/some_id/cohorts", { name: "X" }],
      ["PUT", "/api/programs/some_id", { name: "X" }],
      ["DELETE", "/api/programs/some_id", undefined],
    ] as const) {
      expect((await req(method, path, pa, body)).status, `${method} ${path}`).toBe(403);
    }
    // A jury member is likewise read-only.
    const jury = await login(INC_JURY);
    expect((await req("POST", "/api/programs", jury, { name: "Y" })).status).toBe(403);
    // Unauthenticated is 401.
    expect((await req("POST", "/api/programs", "", { name: "Z" })).status).toBe(401);
  });
});

// ── CRUD (mutations accumulate in this file's isolated D1) ────────────────────

describe("programs — CRUD", () => {
  it("creates a sector, a program and a cohort, then lists them nested", async () => {
    const inc = await login(INC_ADMIN);

    const sec = await req("POST", "/api/programs/sectors", inc, { name: "SpaceTech" });
    expect(sec.status).toBe(200);

    const prog = await req("POST", "/api/programs", inc, {
      name: "Orbital Cohort",
      sector: "SpaceTech",
      description: "Space & frontier hardware.",
    });
    expect(prog.status).toBe(200);
    const created = ((await prog.json()) as { program: ProgramView }).program;
    expect(created.id).toBeTruthy();

    const coh = await req("POST", `/api/programs/${created.id}/cohorts`, inc, {
      name: "Batch Alpha",
      startsOn: "2026-02-01",
    });
    expect(coh.status).toBe(200);

    const list = await listPrograms(inc);
    const orbital = list.programs.find((p) => p.name === "Orbital Cohort")!;
    expect(orbital.sector).toBe("SpaceTech");
    expect(orbital.cohorts.some((c) => c.name === "Batch Alpha")).toBe(true);
    expect(list.sectors.map((s) => s.name)).toContain("SpaceTech");
  });

  it("validates inputs (name required, non-negative fund amounts)", async () => {
    const inc = await login(INC_ADMIN);
    expect((await req("POST", "/api/programs", inc, { name: "  " })).status).toBe(400);
    expect((await req("POST", "/api/programs/sectors", inc, {})).status).toBe(400);
    const vc = await login(VC_ADMIN);
    expect((await req("POST", "/api/programs", vc, { name: "Bad Fund", fundSize: -5 })).status).toBe(400);
  });

  it("updates a program's fund fields, then soft-deletes it (excluded after)", async () => {
    const vc = await login(VC_ADMIN);
    const create = await req("POST", "/api/programs", vc, { name: "Fund III", fundSize: 100 });
    const id = ((await create.json()) as { program: ProgramView }).program.id;

    const upd = await req("PUT", `/api/programs/${id}`, vc, { fundAllocated: 40, description: "New vintage" });
    expect(upd.status).toBe(200);
    const updated = ((await upd.json()) as { program: ProgramView }).program;
    expect(updated.fundSize).toBe(100); // untouched key kept
    expect(updated.fundAllocated).toBe(40);

    // Soft-delete removes it from the active list (and from capital sums).
    expect((await req("DELETE", `/api/programs/${id}`, vc)).status).toBe(200);
    const list = await listPrograms(vc);
    expect(list.programs.some((p) => p.id === id)).toBe(false);
  });

  it("cross-edition mutations are rejected (incubator admin → VC program)", async () => {
    const inc = await login(INC_ADMIN);
    const vcProgId = (
      await env.DB.prepare("SELECT id FROM programs WHERE edition = 'vc' AND name = 'Deep Tech Fund'").first<{
        id: string;
      }>()
    )!.id;
    expect((await req("PUT", `/api/programs/${vcProgId}`, inc, { name: "Hijack" })).status).toBe(404);
    expect((await req("POST", `/api/programs/${vcProgId}/cohorts`, inc, { name: "X" })).status).toBe(404);
    expect((await req("DELETE", `/api/programs/${vcProgId}`, inc)).status).toBe(404);
  });
});

// ── Decks list filtering ──────────────────────────────────────────────────────

describe("decks — program/cohort filter", () => {
  it("filters the decks list by program_id", async () => {
    const vc = await login(VC_ADMIN);
    const list = await listPrograms(vc);
    const fundII = list.programs.find((p) => p.name === "Fund II")!;

    const all = (await (await get("/api/decks", vc)).json()) as { decks: unknown[] };
    const filtered = (await (
      await get(`/api/decks?programId=${fundII.id}`, vc)
    ).json()) as { decks: unknown[] };

    expect(filtered.decks.length).toBeGreaterThan(0);
    expect(filtered.decks.length).toBeLessThan(all.decks.length); // Deep Tech Fund decks excluded

    // A program with no decks filters to an empty list.
    const empty = await req("POST", "/api/programs", vc, { name: "Empty Fund" });
    const emptyId = ((await empty.json()) as { program: ProgramView }).program.id;
    const none = (await (await get(`/api/decks?programId=${emptyId}`, vc)).json()) as { decks: unknown[] };
    expect(none.decks.length).toBe(0);
  });
});
