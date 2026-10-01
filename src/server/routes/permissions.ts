/**
 * GET / PUT `/api/permissions` — the Admin console's **Task permissions** grid
 * (`admin/s-tm.html`, card 4; F0018 / F0019 / F0903).
 *
 * Before W3-A, authorisation was entirely compile-time: changing who could do
 * what meant editing a role literal and redeploying. These two routes are the
 * runtime half — the grid the console renders, and the cell toggle it writes.
 *
 * GATE, NOT GRANT (§8 Q8): a cell can only ever REMOVE a capability the role
 * already has by its role list. `PUT` therefore never widens access on its own,
 * which is what makes it safe to expose as a checkbox.
 *
 * ── TENANCY (T1-CONFIG) ─────────────────────────────────────────────────────
 *
 * §2 B10: these two routes were scoped by `edition` alone, and `edition` has two
 * values — so the leak here is not a list showing the wrong rows, it is a WRITE
 * that re-gates another customer's entire admin console. `0091` rebuilt
 * `role_permissions` with `PRIMARY KEY (tenant_id, edition, role, task_id)` and
 * all three statements below now name the pair, including the upsert's conflict
 * target (one of the nine `ON CONFLICT` sites that were blocking integration).
 *
 * The boundary, because it is easy to get wrong: `src/shared/permissions.ts` is
 * NOT scoped. `can(edition, role, taskId, overrides)` is a pure function and its
 * `edition` is the product variant choosing which matrix applies. What is
 * tenant-owned is the `overrides` MAP it consumes, so the scope lives on the
 * queries that load and write those rows — here and in `auth/permissions.ts`.
 * §11: "A T1 session that 'fixes' `src/shared/` has misread the boundary."
 */
import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAuth, requireTask } from "../auth/middleware";
import { ROLE_LABELS, type Edition, type Role } from "../../shared/roles";
import { PERMISSION_ROLES, permissionTasksFor } from "../../shared/types";
import { can, isMatrixRole, isMatrixTask } from "../../shared/permissions";
import { insertScope, scopeOf, scoped } from "../../shared/tenant";
import { loadWorkspaceOverrides } from "../auth/permissions";
// W3-C — an authorisation change is the one event an audit trail most needs.
import { auditPermissionCells } from "../audit/events";

const permissions = new Hono<AppEnv>();
permissions.use("*", requireAuth);

/**
 * Reading and writing the grid are both console acts, so both carry the
 * console's own task. An administrator whose `adminconsole` cell has been
 * closed cannot read the grid that closed it — which is the point.
 */
const requireConsole = requireTask("adminconsole", "admin");

/** GET /api/permissions — tasks, roles and the resolved grid for the edition. */
permissions.get("/", requireConsole, async (c) => {
  const edition = c.var.user.edition as Edition;
  const overrides = await loadWorkspaceOverrides(c.env.DB, scopeOf(c.var.user));
  const tasks = permissionTasksFor(edition);
  const roles = PERMISSION_ROLES[edition];

  return c.json({
    edition,
    roles: roles.map((role) => ({ role, label: ROLE_LABELS[edition][role] ?? role })),
    tasks: tasks.map((t) => ({ id: t.id, label: t.label, group: t.group, note: t.note })),
    // grid[taskId][role] — resolved (override where one exists, else the seed).
    grid: Object.fromEntries(
      tasks.map((t) => [
        t.id,
        Object.fromEntries(roles.map((role) => [role, can(edition, role, t.id, overrides)])),
      ]),
    ),
  });
});

interface CellUpdate {
  role: string;
  taskId: string;
  granted: boolean;
}

/**
 * PUT /api/permissions — write one or more cells. Body `{ cells: [...] }`.
 *
 * Two refusals that are not about the matrix at all, both mirroring rules the
 * product already has elsewhere:
 *   • the `superuser` row is immutable, as the superuser USER row is in
 *     `users.ts` ("immutable_superuser") — it is the account's single owner and
 *     the harness's bypass invariant;
 *   • you may not close your OWN `adminconsole` cell, because the screen that
 *     would reopen it is the one you just locked.
 */
permissions.put("/", requireConsole, async (c) => {
  const { edition, id: actorId, role: actorRole } = c.var.user;
  const scope = scopeOf(c.var.user);
  const body = await c.req.json<{ cells?: CellUpdate[] }>().catch(() => null);
  const cells = Array.isArray(body?.cells) ? body.cells : [];
  if (cells.length === 0) return c.json({ error: "no_cells" }, 400);

  for (const cell of cells) {
    if (typeof cell?.role !== "string" || typeof cell?.taskId !== "string") {
      return c.json({ error: "invalid_cell" }, 400);
    }
    if (typeof cell.granted !== "boolean") return c.json({ error: "invalid_granted" }, 400);
    if (!isMatrixRole(edition, cell.role)) return c.json({ error: "invalid_role" }, 400);
    if (!isMatrixTask(edition, cell.taskId)) return c.json({ error: "invalid_task" }, 400);
    if (cell.role === "superuser") return c.json({ error: "immutable_superuser" }, 403);
    if (cell.role === actorRole && cell.taskId === "adminconsole" && !cell.granted) {
      return c.json({ error: "cannot_lock_yourself_out" }, 403);
    }
  }

  // Read the PRIOR state before writing it. The audit summary used to render
  // "denied → allowed" from the NEW value alone, so re-granting an already
  // granted cell recorded a flip that never happened — a fabricated before-state
  // in the one log that exists to be trusted about exactly this. Wave 3
  // integration.
  const beforeQ = scoped(scope)
    .on("rp")
    .and(
      `(${cells.map(() => "(rp.role = ? AND rp.task_id = ?)").join(" OR ")})`,
      ...cells.flatMap((cell) => [cell.role as Role, cell.taskId]),
    );
  const before = new Map<string, boolean>(
    (
      await c.env.DB.prepare(
        `SELECT rp.role, rp.task_id, rp.granted FROM role_permissions rp ${beforeQ.whereClause()}`,
      )
        .bind(...beforeQ.binds)
        .all<{ role: string; task_id: string; granted: number }>()
    ).results.map((r) => [`${r.role}:${r.task_id}`, r.granted === 1]),
  );

  // ── ONE OF THE THREE `ON CONFLICT` SITES T1-CONFIG HOLDS ──────────────────
  //
  // `0091` widened the primary key to `(tenant_id, edition, role, task_id)`.
  // SQLite requires a conflict target to match a uniqueness constraint EXACTLY,
  // so the old three-column target resolved against the transitional unique index
  // 0091 left standing — and while it stood, a second customer could not hold a
  // grant for the same (edition, role, task_id) at all. Naming the widened key is
  // what lets integration drop that index (0101-0108); the index itself is NOT
  // dropped here, which is that session's job.
  //
  // `insertScope`, not two hand-written binds, because this is the most dangerous
  // INSERT in the file: `tenant_id` carries `DEFAULT 't_default'`, so a forgotten
  // bind would not fail — it would write a permission cell into the FIRST
  // customer's authorisation matrix and answer 200.
  const t = insertScope(scope);
  await c.env.DB.batch(
    cells.map((cell) =>
      c.env.DB.prepare(
        `INSERT INTO role_permissions (${t.columns}, role, task_id, granted, updated_at, updated_by) ` +
          `VALUES (${t.placeholders}, ?, ?, ?, datetime('now'), ?) ` +
          "ON CONFLICT (tenant_id, edition, role, task_id) DO UPDATE SET " +
          "granted = excluded.granted, updated_at = excluded.updated_at, updated_by = excluded.updated_by",
      ).bind(...t.binds, cell.role as Role, cell.taskId, cell.granted ? 1 : 0, actorId),
    ),
  );

  await auditPermissionCells(
    c,
    cells,
    new Map(permissionTasksFor(edition).map((t) => [t.id, t.label])),
    before,
  );

  const overrides = await loadWorkspaceOverrides(c.env.DB, scope);
  return c.json({
    ok: true,
    updated: cells.length,
    cells: cells.map((cell) => ({
      role: cell.role,
      taskId: cell.taskId,
      granted: can(edition, cell.role, cell.taskId, overrides),
    })),
  });
});

export default permissions;
