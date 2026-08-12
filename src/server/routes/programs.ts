// Session 2 — Program & Cohort hierarchy API. Sector → Program → Cohort is the
// umbrella over everything an edition does. Reads (list) are available to any
// authed user so the toolbar filter dropdowns, the "Applies to" selector and the
// Set up wizard can populate. Sector/program CRUD is admin/superuser-gated
// (org-admins create programs); cohort CRUD is admin/superuser OR the owning
// Program Manager (Session 4 — owner-scoped via programs.owner_id). VC programs
// carry fund economics (size / allocated / deployed) that feed Capital Deployment.

import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../types";
import type { Edition } from "../../shared/roles";
import { requireAuth, requireRole } from "../auth/middleware";

const programs = new Hono<AppEnv>();
programs.use("*", requireAuth);

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

// ── Read: the whole hierarchy for the caller's edition ───────────────────────

/** GET /api/programs — sectors + programs (with nested cohorts) for the caller's
 *  edition. Any authed user (drives filters / Applies-to / the Set up wizard).
 *  `?all=1` (admin only) includes inactive rows for the management view. */
programs.get("/", async (c) => {
  const edition = c.var.user.edition;
  const includeInactive = isAdmin(c) && c.req.query("all") === "1";
  const activeClause = includeInactive ? "" : " AND active = 1";

  const sectors = (
    await c.env.DB.prepare(
      `SELECT id, name, active, sort_order FROM sectors WHERE edition = ?${activeClause} ORDER BY sort_order, name`,
    )
      .bind(edition)
      .all<SectorRow>()
  ).results;

  const progRows = (
    await c.env.DB.prepare(
      `SELECT id, sector, name, description, fund_size, fund_allocated, capital_deployed, shortlist_min, owner_id, active, sort_order ` +
        `FROM programs WHERE edition = ?${activeClause} ORDER BY sort_order, name`,
    )
      .bind(edition)
      .all<ProgramRow>()
  ).results;

  // Cohorts scoped to this edition's programs (join keeps it edition-safe).
  const cohortClause = includeInactive ? "" : " AND c.active = 1";
  const cohortRows = (
    await c.env.DB.prepare(
      `SELECT c.id, c.program_id, c.name, c.starts_on, c.ends_on, c.active, c.sort_order ` +
        `FROM cohorts c JOIN programs p ON p.id = c.program_id ` +
        `WHERE p.edition = ?${cohortClause} ORDER BY c.sort_order, c.name`,
    )
      .bind(edition)
      .all<CohortRow>()
  ).results;

  return c.json({
    sectors: sectors.map(toSectorView),
    programs: progRows.map((p) => toProgramView(p, cohortRows)),
  });
});

// ── Sectors ──────────────────────────────────────────────────────────────────

programs.post("/sectors", requireRole("admin"), async (c) => {
  const edition = c.var.user.edition;
  const body = await readBody<{ name: string }>(c);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return c.json({ error: "name_required" }, 400);
  const id = `sec_${crypto.randomUUID().slice(0, 8)}`;
  const next = await c.env.DB.prepare(
    "SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM sectors WHERE edition = ?",
  )
    .bind(edition)
    .first<{ n: number }>();
  await c.env.DB.prepare(
    "INSERT INTO sectors (id, edition, name, active, sort_order) VALUES (?, ?, ?, 1, ?)",
  )
    .bind(id, edition, name, next?.n ?? 1)
    .run();
  return c.json({ ok: true, sector: { id, name, active: true } });
});

programs.delete("/sectors/:id", requireRole("admin"), async (c) => {
  const edition = c.var.user.edition;
  const id = c.req.param("id");
  const res = await c.env.DB.prepare(
    "UPDATE sectors SET active = 0 WHERE id = ? AND edition = ?",
  )
    .bind(id, edition)
    .run();
  if (res.meta.changes === 0) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

// ── Programs ─────────────────────────────────────────────────────────────────

programs.post("/", requireRole("admin"), async (c) => {
  const edition = c.var.user.edition;
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
  const next = await c.env.DB.prepare(
    "SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM programs WHERE edition = ?",
  )
    .bind(edition)
    .first<{ n: number }>();
  await c.env.DB.prepare(
    "INSERT INTO programs (id, edition, sector, name, description, fund_size, fund_allocated, capital_deployed, shortlist_min, active, sort_order) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)",
  )
    .bind(id, edition, sector, name, description, fs.value, fa.value, cd.value, sm.value, next?.n ?? 1)
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
  const edition = c.var.user.edition;
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare(
    "SELECT id, sector, name, description, fund_size, fund_allocated, capital_deployed, shortlist_min, owner_id, active, sort_order FROM programs WHERE id = ? AND edition = ?",
  )
    .bind(id, edition)
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

  await c.env.DB.prepare(
    "UPDATE programs SET sector = ?, name = ?, description = ?, fund_size = ?, fund_allocated = ?, capital_deployed = ?, shortlist_min = ?, active = ? WHERE id = ? AND edition = ?",
  )
    .bind(sector, name, description, fundSize, fundAllocated, capitalDeployed, shortlistMin, active, id, edition)
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
  const edition = c.var.user.edition;
  const id = c.req.param("id");
  const res = await c.env.DB.prepare(
    "UPDATE programs SET active = 0 WHERE id = ? AND edition = ?",
  )
    .bind(id, edition)
    .run();
  if (res.meta.changes === 0) return c.json({ error: "not_found" }, 404);
  // Retire the program's cohorts with it (soft delete keeps history referenced).
  await c.env.DB.prepare("UPDATE cohorts SET active = 0 WHERE program_id = ?").bind(id).run();
  return c.json({ ok: true });
});

// ── Cohorts ──────────────────────────────────────────────────────────────────

programs.post("/:id/cohorts", requireRole("program_manager", "admin"), async (c) => {
  const edition = c.var.user.edition;
  const programId = c.req.param("id");
  // The program must exist in the caller's edition.
  const prog = await c.env.DB.prepare(
    "SELECT id, owner_id FROM programs WHERE id = ? AND edition = ?",
  )
    .bind(programId, edition)
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
  await c.env.DB.prepare(
    "INSERT INTO cohorts (id, program_id, name, starts_on, ends_on, active, sort_order) VALUES (?, ?, ?, ?, ?, 1, ?)",
  )
    .bind(id, programId, name, startsOn, endsOn, next?.n ?? 1)
    .run();
  return c.json({
    ok: true,
    cohort: { id, programId, name, startsOn: startsOn ?? undefined, endsOn: endsOn ?? undefined, active: true },
  });
});

/** Confirm a cohort belongs to a program in the caller's edition. Carries the
 *  owning program's owner_id so cohort mutations can be owner-scoped. */
async function loadCohort(c: Context<AppEnv>, cohortId: string, edition: Edition) {
  return c.env.DB.prepare(
    "SELECT c.id, c.program_id, c.name, c.starts_on, c.ends_on, c.active, c.sort_order, p.owner_id AS owner_id " +
      "FROM cohorts c JOIN programs p ON p.id = c.program_id WHERE c.id = ? AND p.edition = ?",
  )
    .bind(cohortId, edition)
    .first<CohortRow & { owner_id: string | null }>();
}

programs.put("/cohorts/:cohortId", requireRole("program_manager", "admin"), async (c) => {
  const edition = c.var.user.edition;
  const cohortId = c.req.param("cohortId");
  const existing = await loadCohort(c, cohortId, edition);
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
  const edition = c.var.user.edition;
  const cohortId = c.req.param("cohortId");
  const existing = await loadCohort(c, cohortId, edition);
  if (!existing) return c.json({ error: "not_found" }, 404);
  if (!canManageCohorts(c, existing.owner_id)) return c.json({ error: "forbidden" }, 403);
  await c.env.DB.prepare("UPDATE cohorts SET active = 0 WHERE id = ?").bind(cohortId).run();
  return c.json({ ok: true });
});

export { programs };
export default programs;
