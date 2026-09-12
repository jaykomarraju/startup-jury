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
 */
import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAuth, requireTask } from "../auth/middleware";
import { ROLE_LABELS, type Edition, type Role } from "../../shared/roles";
import { PERMISSION_ROLES, permissionTasksFor } from "../../shared/types";
import { can, isMatrixRole, isMatrixTask } from "../../shared/permissions";
import { loadEditionOverrides } from "../auth/permissions";
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
  const overrides = await loadEditionOverrides(c.env.DB, edition);
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
  const before = new Map<string, boolean>(
    (
      await c.env.DB.prepare(
        `SELECT role, task_id, granted FROM role_permissions WHERE edition = ? AND (${cells
          .map(() => "(role = ? AND task_id = ?)")
          .join(" OR ")})`,
      )
        .bind(edition, ...cells.flatMap((cell) => [cell.role as Role, cell.taskId]))
        .all<{ role: string; task_id: string; granted: number }>()
    ).results.map((r) => [`${r.role}:${r.task_id}`, r.granted === 1]),
  );

  await c.env.DB.batch(
    cells.map((cell) =>
      c.env.DB.prepare(
        "INSERT INTO role_permissions (edition, role, task_id, granted, updated_at, updated_by) " +
          "VALUES (?, ?, ?, ?, datetime('now'), ?) " +
          "ON CONFLICT (edition, role, task_id) DO UPDATE SET " +
          "granted = excluded.granted, updated_at = excluded.updated_at, updated_by = excluded.updated_by",
      ).bind(edition, cell.role as Role, cell.taskId, cell.granted ? 1 : 0, actorId),
    ),
  );

  await auditPermissionCells(
    c,
    cells,
    new Map(permissionTasksFor(edition).map((t) => [t.id, t.label])),
    before,
  );

  const overrides = await loadEditionOverrides(c.env.DB, edition);
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
