// Session 2 — Program & Cohort hierarchy API. Sector → Program → Cohort is the
// umbrella over everything an edition does. Reads (list) are available to any
// authed user so the toolbar filter dropdowns, the "Applies to" selector and the
// Set up wizard can populate. Sector/program CRUD is admin/superuser-gated
// (org-admins create programs); cohort CRUD is admin/superuser OR the owning
// Program Manager (Session 4 — owner-scoped via programs.owner_id). VC programs
// carry fund economics (size / allocated / deployed) that feed Capital Deployment.
//
// TENANCY (T1-FLOW). `sectors` and `programs` are tenant-OWNED (`0085`);
// `cohorts` has no key of its own and is scoped through its programme, the path
// `TENANT_OWNER` names. Fund size and allocation are on `programs`, which is why
// §2 B24 lists this router by name: an unscoped read here is one customer
// reading another's fund. Every predicate below is built by `scoped()` so the
// fragment and its binds cannot drift apart across a 44-mention sweep.

import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../types";
import { denyMentor, requireAuth, requireRole } from "../auth/middleware";
import { insertScope, scopeOf, scoped, type TenantScope } from "../../shared/tenant";
import { NEW_PROGRAMME_AI_WEIGHT_PCT } from "../../shared/scoring";

const programs = new Hono<AppEnv>();
programs.use("*", requireAuth, denyMentor);

interface SectorRow {
  id: string;
  name: string;
  active: number;
  sort_order: number;
}
interface ProgramRow {
  id: string;
  sector: string | null;
  name: string;
  description: string | null;
  fund_size: number | null;
  fund_allocated: number | null;
  capital_deployed: number | null;
  shortlist_min: number | null;
  owner_id: string | null;
  active: number;
  sort_order: number;
}
interface CohortRow {
  id: string;
  program_id: string;
  name: string;
  starts_on: string | null;
  ends_on: string | null;
  active: number;
  sort_order: number;
}

async function readBody<T>(c: Context<AppEnv>): Promise<Partial<T>> {
  return (await c.req.json().catch(() => ({}))) as Partial<T>;
}

/** Validate an optional fund amount (₹ Cr). Absent/blank → null; a finite value
 *  ≥ 0 → that number; anything else → invalid. */
function validFund(v: unknown): { ok: true; value: number | null } | { ok: false } {
  if (v === undefined || v === null || v === "") return { ok: true, value: null };
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return { ok: false };
  return { ok: true, value: n };
}

/**
 * Validate the program's **shortlist floor** (Session 5) — the minimum decision
 * score a deck must reach before a juror may shortlist it. Absent/blank → null
 * (no floor); otherwise a rubric score in 0–10.
 */
function validShortlistMin(v: unknown): { ok: true; value: number | null } | { ok: false } {
  if (v === undefined || v === null || v === "") return { ok: true, value: null };
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 10) return { ok: false };
  return { ok: true, value: Math.round(n * 100) / 100 };
}

function toSectorView(s: SectorRow) {
  return { id: s.id, name: s.name, active: s.active === 1 };
}
function toCohortView(ch: CohortRow) {
  return {
    id: ch.id,
    programId: ch.program_id,
    name: ch.name,
    startsOn: ch.starts_on ?? undefined,
    endsOn: ch.ends_on ?? undefined,
    active: ch.active === 1,
  };
}
function toProgramView(p: ProgramRow, cohorts: CohortRow[]) {
  return {
    id: p.id,
    sector: p.sector ?? undefined,
    name: p.name,
    description: p.description ?? undefined,
    fundSize: p.fund_size ?? undefined,
    fundAllocated: p.fund_allocated ?? undefined,
    capitalDeployed: p.capital_deployed ?? undefined,
    shortlistMin: p.shortlist_min ?? undefined,
    ownerId: p.owner_id ?? undefined,
    active: p.active === 1,
    cohorts: cohorts.filter((ch) => ch.program_id === p.id).map(toCohortView),
  };
}

function isAdmin(c: Context<AppEnv>): boolean {
  return c.var.user.role === "admin" || c.var.user.role === "superuser";
}

/** A caller may manage a program's cohorts if they're admin/superuser, OR the
 *  program_manager who LEADS that program (owner-scoped, per the Jul-24 demo).
 *  Sector/program CRUD stays admin-only (org-admins create programs). */
function canManageCohorts(c: Context<AppEnv>, ownerId: string | null): boolean {
  if (isAdmin(c)) return true;
  return c.var.user.role === "program_manager" && ownerId !== null && ownerId === c.var.user.id;
}

// ── Read: the whole hierarchy for the caller's workspace ────────────────────

/** GET /api/programs — sectors + programs (with nested cohorts) for the caller's
 *  workspace. Any authed user (drives filters / Applies-to / the Set up wizard).
 *  `?all=1` (admin only) includes inactive rows for the management view. */
programs.get("/", async (c) => {
  const scope = scopeOf(c.var.user);
  const includeInactive = isAdmin(c) && c.req.query("all") === "1";

  const sq = scoped(scope).on("s");
  if (!includeInactive) sq.andRaw("s.active = 1");
  const sectors = (
    await c.env.DB.prepare(
      `SELECT s.id, s.name, s.active, s.sort_order FROM sectors s ${sq.whereClause()} ORDER BY s.sort_order, s.name`,
    )
      .bind(...sq.binds)
      .all<SectorRow>()
  ).results;

  const pq = scoped(scope).on("p");
  if (!includeInactive) pq.andRaw("p.active = 1");
  const progRows = (
    await c.env.DB.prepare(
      `SELECT p.id, p.sector, p.name, p.description, p.fund_size, p.fund_allocated, p.capital_deployed, ` +
        `p.shortlist_min, p.owner_id, p.active, p.sort_order ` +
        `FROM programs p ${pq.whereClause()} ORDER BY p.sort_order, p.name`,
    )
      .bind(...pq.binds)
      .all<ProgramRow>()
  ).results;

  // `cohorts` has no workspace key: `TENANT_OWNER` scopes it through its
  // programme, which is the same JOIN this read already had — now carrying the
  // customer as well as the edition.
  const cq = scoped(scope);
  const cJoins = cq.viaParent("cohorts", "c");
  if (!includeInactive) cq.andRaw("c.active = 1");
  const cohortRows = (
    await c.env.DB.prepare(
      `SELECT c.id, c.program_id, c.name, c.starts_on, c.ends_on, c.active, c.sort_order ` +
        `FROM cohorts c ${cJoins} ${cq.whereClause()} ORDER BY c.sort_order, c.name`,
    )
      .bind(...cq.binds)
      .all<CohortRow>()
  ).results;

  return c.json({
    sectors: sectors.map(toSectorView),
    programs: progRows.map((p) => toProgramView(p, cohortRows)),
  });
});

// ── Sectors ──────────────────────────────────────────────────────────────────

programs.post("/sectors", requireRole("admin"), async (c) => {
  const scope = scopeOf(c.var.user);
  const body = await readBody<{ name: string }>(c);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return c.json({ error: "name_required" }, 400);
  const id = `sec_${crypto.randomUUID().slice(0, 8)}`;
  const nq = scoped(scope).on("s");
  const next = await c.env.DB.prepare(
    `SELECT COALESCE(MAX(s.sort_order), 0) + 1 AS n FROM sectors s ${nq.whereClause()}`,
  )
    .bind(...nq.binds)
    .first<{ n: number }>();
  const t = insertScope(scope);
  await c.env.DB.prepare(
    `INSERT INTO sectors (id, ${t.columns}, name, active, sort_order) VALUES (?, ${t.placeholders}, ?, 1, ?)`,
  )
    .bind(id, ...t.binds, name, next?.n ?? 1)
    .run();
  return c.json({ ok: true, sector: { id, name, active: true } });
});

programs.delete("/sectors/:id", requireRole("admin"), async (c) => {
  const id = c.req.param("id");
  // `UPDATE … WHERE id = ?` with the workspace appended: the id arrives from the
  // browser, so this is one of the predicates §2 B24 counts. Without the tenant
  // half it retires another customer's sector and answers `{ ok: true }`.
  const q = scoped(scopeOf(c.var.user)).on("sectors").and("id = ?", id);
  const res = await c.env.DB.prepare(
    `UPDATE sectors SET active = 0 ${q.whereClause()}`,
  )
    .bind(...q.binds)
    .run();
  if (res.meta.changes === 0) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

// ── Programs ─────────────────────────────────────────────────────────────────

programs.post("/", requireRole("admin"), async (c) => {
  const scope = scopeOf(c.var.user);
  const body = await readBody<{
    name: string;
    sector: string;
    description: string;
    fundSize: unknown;
    fundAllocated: unknown;
    capitalDeployed: unknown;
    shortlistMin: unknown;
  }>(c);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return c.json({ error: "name_required" }, 400);
  const sector = typeof body.sector === "string" && body.sector.trim() ? body.sector.trim() : null;
  const description =
    typeof body.description === "string" && body.description.trim() ? body.description.trim() : null;

  const fs = validFund(body.fundSize);
  const fa = validFund(body.fundAllocated);
  const cd = validFund(body.capitalDeployed);
  if (!fs.ok || !fa.ok || !cd.ok) return c.json({ error: "invalid_fund" }, 400);
  const sm = validShortlistMin(body.shortlistMin);
  if (!sm.ok) return c.json({ error: "invalid_shortlist_min" }, 400);

  const id = `prog_${crypto.randomUUID().slice(0, 8)}`;
  const nq = scoped(scope).on("p");
  const next = await c.env.DB.prepare(
    `SELECT COALESCE(MAX(p.sort_order), 0) + 1 AS n FROM programs p ${nq.whereClause()}`,
  )
    .bind(...nq.binds)
    .first<{ n: number }>();
  // V4-WEIGHT (0074) — a programme created from here is stamped with the
  // client's 50:50 split; every programme that predates the column keeps
  // NULL and goes on following the organisation's. "previous cohorts will
  // remain same. only the new program or cohorts would take effect."
  const t = insertScope(scope);
  await c.env.DB.prepare(
    `INSERT INTO programs (id, ${t.columns}, sector, name, description, fund_size, fund_allocated, capital_deployed, shortlist_min, ai_weight_pct, active, sort_order) ` +
      `VALUES (?, ${t.placeholders}, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
  )
    .bind(
      id,
      ...t.binds,
      sector,
      name,
      description,
      fs.value,
      fa.value,
      cd.value,
      sm.value,
      NEW_PROGRAMME_AI_WEIGHT_PCT,
      next?.n ?? 1,
    )
    .run();

  return c.json({
    ok: true,
    program: {
      id,
      name,
      sector: sector ?? undefined,
      description: description ?? undefined,
      fundSize: fs.value ?? undefined,
      fundAllocated: fa.value ?? undefined,
      capitalDeployed: cd.value ?? undefined,
      shortlistMin: sm.value ?? undefined,
      active: true,
      cohorts: [],
    },
  });
});

programs.put("/:id", requireRole("admin"), async (c) => {
  const scope = scopeOf(c.var.user);
  const id = c.req.param("id");
  const loadQ = scoped(scope).on("p").and("p.id = ?", id);
  const existing = await c.env.DB.prepare(
    `SELECT p.id, p.sector, p.name, p.description, p.fund_size, p.fund_allocated, p.capital_deployed, ` +
      `p.shortlist_min, p.owner_id, p.active, p.sort_order FROM programs p ${loadQ.whereClause()}`,
  )
    .bind(...loadQ.binds)
    .first<ProgramRow>();
  if (!existing) return c.json({ error: "not_found" }, 404);

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  const name =
    typeof body.name === "string" && body.name.trim() ? body.name.trim() : existing.name;
  const sector =
    "sector" in body
      ? typeof body.sector === "string" && body.sector.trim()
        ? body.sector.trim()
        : null
      : existing.sector;
  const description =
    "description" in body
      ? typeof body.description === "string" && body.description.trim()
        ? body.description.trim()
        : null
      : existing.description;

  // Fund fields: only overwrite when the key is present in the body.
  function resolveFund(key: string, current: number | null): number | null | "err" {
    if (!(key in body)) return current;
    const v = validFund(body[key]);
    return v.ok ? v.value : "err";
  }
  const fundSize = resolveFund("fundSize", existing.fund_size);
  const fundAllocated = resolveFund("fundAllocated", existing.fund_allocated);
  const capitalDeployed = resolveFund("capitalDeployed", existing.capital_deployed);
  if (fundSize === "err" || fundAllocated === "err" || capitalDeployed === "err") {
    return c.json({ error: "invalid_fund" }, 400);
  }
  // The shortlist floor follows the same present-key-only semantics as the fund
  // fields: omit it to keep the current floor, send null/"" to clear it.
  let shortlistMin = existing.shortlist_min;
  if ("shortlistMin" in body) {
    const sm = validShortlistMin(body.shortlistMin);
    if (!sm.ok) return c.json({ error: "invalid_shortlist_min" }, 400);
    shortlistMin = sm.value;
  }
  const active = typeof body.active === "boolean" ? (body.active ? 1 : 0) : existing.active;

  const saveQ = scoped(scope).on("programs").and("id = ?", id);
  await c.env.DB.prepare(
    `UPDATE programs SET sector = ?, name = ?, description = ?, fund_size = ?, fund_allocated = ?, ` +
      `capital_deployed = ?, shortlist_min = ?, active = ? ${saveQ.whereClause()}`,
  )
    .bind(
      sector,
      name,
      description,
      fundSize,
      fundAllocated,
      capitalDeployed,
      shortlistMin,
      active,
      ...saveQ.binds,
    )
    .run();

  return c.json({
    ok: true,
    program: {
      id,
      name,
      sector: sector ?? undefined,
      description: description ?? undefined,
      fundSize: (fundSize as number | null) ?? undefined,
      fundAllocated: (fundAllocated as number | null) ?? undefined,
      capitalDeployed: (capitalDeployed as number | null) ?? undefined,
      shortlistMin: shortlistMin ?? undefined,
      active: active === 1,
    },
  });
});

programs.delete("/:id", requireRole("admin"), async (c) => {
  const id = c.req.param("id");
  const q = scoped(scopeOf(c.var.user)).on("programs").and("id = ?", id);
  const res = await c.env.DB.prepare(`UPDATE programs SET active = 0 ${q.whereClause()}`)
    .bind(...q.binds)
    .run();
  if (res.meta.changes === 0) return c.json({ error: "not_found" }, 404);
  // Retire the program's cohorts with it (soft delete keeps history referenced).
  // `program_id` alone is the right predicate here and needs no tenant half: the
  // programme it names was just proved to be this workspace's by the UPDATE
  // above, and a cohort belongs to exactly one programme.
  await c.env.DB.prepare("UPDATE cohorts SET active = 0 WHERE program_id = ?").bind(id).run();
  return c.json({ ok: true });
});

// ── Cohorts ──────────────────────────────────────────────────────────────────

programs.post("/:id/cohorts", requireRole("program_manager", "admin"), async (c) => {
  const scope = scopeOf(c.var.user);
  const programId = c.req.param("id");
  // The program must exist in the caller's WORKSPACE, not merely in their
  // edition. Everything below keys off `program_id`, so this is the one check
  // that stops a cohort being opened under another customer's programme.
  const pq = scoped(scope).on("p").and("p.id = ?", programId);
  const prog = await c.env.DB.prepare(
    `SELECT p.id, p.owner_id FROM programs p ${pq.whereClause()}`,
  )
    .bind(...pq.binds)
    .first<{ id: string; owner_id: string | null }>();
  if (!prog) return c.json({ error: "not_found" }, 404);
  // A program_manager may only manage cohorts for programs they lead.
  if (!canManageCohorts(c, prog.owner_id)) return c.json({ error: "forbidden" }, 403);

  const body = await readBody<{ name: string; startsOn: string; endsOn: string }>(c);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return c.json({ error: "name_required" }, 400);
  const startsOn = typeof body.startsOn === "string" && body.startsOn.trim() ? body.startsOn.trim() : null;
  const endsOn = typeof body.endsOn === "string" && body.endsOn.trim() ? body.endsOn.trim() : null;

  const id = `coh_${crypto.randomUUID().slice(0, 8)}`;
  const next = await c.env.DB.prepare(
    "SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM cohorts WHERE program_id = ?",
  )
    .bind(programId)
    .first<{ n: number }>();
  // V4-WEIGHT (0074) — a NEW cohort takes the new split even under an old
  // programme, which is the other half of his sentence ("the new program
  // OR cohorts"). The programme's existing cohorts are untouched.
  await c.env.DB.prepare(
    "INSERT INTO cohorts (id, program_id, name, starts_on, ends_on, ai_weight_pct, active, sort_order) " +
      "VALUES (?, ?, ?, ?, ?, ?, 1, ?)",
  )
    .bind(id, programId, name, startsOn, endsOn, NEW_PROGRAMME_AI_WEIGHT_PCT, next?.n ?? 1)
    .run();
  return c.json({
    ok: true,
    cohort: { id, programId, name, startsOn: startsOn ?? undefined, endsOn: endsOn ?? undefined, active: true },
  });
});

/**
 * Confirm a cohort belongs to a program in the caller's WORKSPACE. Carries the
 * owning program's owner_id so cohort mutations can be owner-scoped.
 *
 * The join comes from `viaParent` rather than being written here, which is why
 * `owner0_programs` appears in the SELECT: the helper names each hop's alias
 * `owner<n>_<parent>` so the path to the owner is answered once in
 * `TENANT_OWNER` and not re-derived at thirty-three call sites.
 */
async function loadCohort(c: Context<AppEnv>, cohortId: string, scope: TenantScope) {
  const q = scoped(scope);
  const joins = q.viaParent("cohorts", "ch");
  q.and("ch.id = ?", cohortId);
  return c.env.DB.prepare(
    `SELECT ch.id, ch.program_id, ch.name, ch.starts_on, ch.ends_on, ch.active, ch.sort_order, ` +
      `owner0_programs.owner_id AS owner_id FROM cohorts ch ${joins} ${q.whereClause()}`,
  )
    .bind(...q.binds)
    .first<CohortRow & { owner_id: string | null }>();
}

programs.put("/cohorts/:cohortId", requireRole("program_manager", "admin"), async (c) => {
  const scope = scopeOf(c.var.user);
  const cohortId = c.req.param("cohortId");
  const existing = await loadCohort(c, cohortId, scope);
  if (!existing) return c.json({ error: "not_found" }, 404);
  if (!canManageCohorts(c, existing.owner_id)) return c.json({ error: "forbidden" }, 403);

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const name =
    typeof body.name === "string" && body.name.trim() ? body.name.trim() : existing.name;
  const startsOn =
    "startsOn" in body
      ? typeof body.startsOn === "string" && body.startsOn.trim()
        ? body.startsOn.trim()
        : null
      : existing.starts_on;
  const endsOn =
    "endsOn" in body
      ? typeof body.endsOn === "string" && body.endsOn.trim()
        ? body.endsOn.trim()
        : null
      : existing.ends_on;
  const active = typeof body.active === "boolean" ? (body.active ? 1 : 0) : existing.active;

  await c.env.DB.prepare(
    "UPDATE cohorts SET name = ?, starts_on = ?, ends_on = ?, active = ? WHERE id = ?",
  )
    .bind(name, startsOn, endsOn, active, cohortId)
    .run();
  return c.json({
    ok: true,
    cohort: {
      id: cohortId,
      programId: existing.program_id,
      name,
      startsOn: startsOn ?? undefined,
      endsOn: endsOn ?? undefined,
      active: active === 1,
    },
  });
});

programs.delete("/cohorts/:cohortId", requireRole("program_manager", "admin"), async (c) => {
  const scope = scopeOf(c.var.user);
  const cohortId = c.req.param("cohortId");
  const existing = await loadCohort(c, cohortId, scope);
  if (!existing) return c.json({ error: "not_found" }, 404);
  if (!canManageCohorts(c, existing.owner_id)) return c.json({ error: "forbidden" }, 403);
  await c.env.DB.prepare("UPDATE cohorts SET active = 0 WHERE id = ?").bind(cohortId).run();
  return c.json({ ok: true });
});

export { programs };
export default programs;
