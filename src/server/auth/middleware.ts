import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import type { AppEnv } from "../types";
import type { Role } from "../../shared/roles";
import { isMentor } from "../../shared/roles";
import { getSession, SESSION_COOKIE } from "./session";
import { createPermissionContext } from "./permissions";

/**
 * Populates `c.var.user` from the session cookie, or returns 401 — and hangs the
 * request's permission resolver on `c.var.perms` (W3-A). The resolver is LAZY:
 * constructing it costs nothing, and `role_permissions` is read at most once,
 * only if some gate on this request actually asks.
 */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  const user = await getSession(c.env.SESSIONS, token);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  c.set("user", user);
  c.set("perms", createPermissionContext(c.env.DB, user));
  await next();
});

/**
 * Requires an authenticated user whose role is in `roles`. Must run after
 * requireAuth. superuser always passes (full access in both editions).
 */
export function requireRole(...roles: Role[]) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const user = c.var.user;
    if (!user) return c.json({ error: "unauthorized" }, 401);
    if (user.role !== "superuser" && !roles.includes(user.role)) {
      return c.json({ error: "forbidden" }, 403);
    }
    await next();
  });
}

/**
 * `requireRole(...roles)` **AND** the runtime permission `taskId` (W3-A).
 *
 * This is the shape §8 Q8 makes binding: the Admin console's Task permissions
 * grid is a GATE, not a grant. The role list is still the rule — it decides who
 * could ever pass — and the permission can only take that away. Which means:
 *
 *   • the seeded default reproduces today's matrix exactly, because a nav-backed
 *     task's grant is the union of the roles that reach its slugs and therefore
 *     a superset of any one route's role list;
 *   • ticking a cell ON never widens anything. Opening a route to a new role is
 *     still an edit here (and in `nav.ts`), by design;
 *   • the superuser keeps its role-list bypass but is NOT exempt from the grid —
 *     the seed grants it every task, so an administrator who deliberately closes
 *     a superuser cell gets what they asked for.
 *
 * The permission also expresses something a flat role list cannot: the same
 * route serving both editions with a different admitted set in each (`partner`
 * configures parameters in the VC edition, `program_manager` in the incubator).
 */
export function requireTask(taskId: string, ...roles: Role[]) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const user = c.var.user;
    if (!user) return c.json({ error: "unauthorized" }, 401);
    if (user.role !== "superuser" && !roles.includes(user.role)) {
      return c.json({ error: "forbidden" }, 403);
    }
    if (!(await c.var.perms.can(taskId))) return c.json({ error: "forbidden" }, 403);
    await next();
  });
}

/**
 * Refuses the `mentor` user-type. A mentor is a directory record, not a
 * pipeline actor: it holds no nav item and no transition, so `requireRole`
 * already turns it away everywhere a role list is named. This is the gate for
 * the surfaces that ask only for *some* authenticated user — without it a
 * signed-in mentor could read the whole deck pipeline. Must run after
 * requireAuth. There is no superuser bypass: `mentor` is never a superuser.
 */
export const denyMentor = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.var.user;
  if (!user) return c.json({ error: "unauthorized" }, 401);
  if (isMentor(user.role)) return c.json({ error: "forbidden" }, 403);
  await next();
});
