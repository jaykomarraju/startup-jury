/**
 * Request-scoped permission resolution (W3-A).
 *
 * `src/shared/permissions.ts` holds the pure decision; this holds the I/O. One
 * principal's overrides are read from `role_permissions` **at most once per
 * request** and memoised on the Hono context, so a route that gates on three
 * tasks costs one query and a route that gates on none costs zero.
 *
 * DELIBERATELY NOT ON THE KV SESSION VALUE. The session is written once at login
 * and lives seven days; baking the matrix into it would mean an administrator's
 * edit did nothing until every affected user signed out and back in. "Carried on
 * the session" therefore means carried on the request's principal, resolved from
 * the table each request that asks.
 *
 * FAIL OPEN TO THE SHIPPED DEFAULT, never closed. If the table is empty (a
 * database migrated below `0029`) or the read throws, `can()` falls back to
 * `DEFAULT_ROLE_PERMISSIONS`, which is exactly today's behaviour. Failing closed
 * here would turn a transient D1 error into a whole-workspace lockout — and
 * because the matrix is a GATE, the fallback can never grant more than the
 * shipped product already does.
 */
import type { Edition, Role } from "../../shared/roles";
import type { RolePermissionRow } from "../../shared/types";
import {
  can as canPure,
  grantedTasks,
  overridesFromRows,
  type PermissionOverrides,
} from "../../shared/permissions";
import type { SessionUser } from "../types";

/** Every persisted override for one (edition, role). */
export async function loadPermissionOverrides(
  db: D1Database,
  edition: Edition,
  role: Role | string,
): Promise<PermissionOverrides> {
  try {
    const rows = (
      await db
        .prepare("SELECT edition, role, task_id, granted FROM role_permissions WHERE edition = ? AND role = ?")
        .bind(edition, role)
        .all<Pick<RolePermissionRow, "edition" | "role" | "task_id" | "granted">>()
    ).results;
    return overridesFromRows(rows as RolePermissionRow[]);
  } catch {
    // No table yet, or D1 is unhappy — the shipped defaults stand. See above.
    return new Map();
  }
}

/** The whole matrix, for `GET /api/permissions`. */
export async function loadEditionOverrides(
  db: D1Database,
  edition: Edition,
): Promise<PermissionOverrides> {
  try {
    const rows = (
      await db
        .prepare("SELECT edition, role, task_id, granted FROM role_permissions WHERE edition = ?")
        .bind(edition)
        .all<Pick<RolePermissionRow, "edition" | "role" | "task_id" | "granted">>()
    ).results;
    return overridesFromRows(rows as RolePermissionRow[]);
  } catch {
    return new Map();
  }
}

/** The memoised per-request resolver hung on `c.var.perms`. */
export interface PermissionContext {
  /** May this principal do `taskId`? ANDed with the caller's own rule. */
  can(taskId: string): Promise<boolean>;
  /** Every task id held, for the `/api/auth/me` payload. */
  granted(): Promise<string[]>;
}

export function createPermissionContext(db: D1Database, user: SessionUser): PermissionContext {
  let pending: Promise<PermissionOverrides> | null = null;
  const overrides = () => (pending ??= loadPermissionOverrides(db, user.edition, user.role));
  return {
    async can(taskId) {
      return canPure(user.edition, user.role, taskId, await overrides());
    },
    async granted() {
      return grantedTasks(user.edition, user.role, await overrides());
    },
  };
}
