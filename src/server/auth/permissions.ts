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
 *
 * ── TENANCY (T1-CONFIG) ─────────────────────────────────────────────────────
 *
 * `role_permissions` is tenant-owned and `0091` rebuilt it with
 * `PRIMARY KEY (tenant_id, edition, role, task_id)`. Both loaders below therefore
 * take a `TenantScope`, STRICTLY — no `ConfigScopeArg` bridge, unlike
 * `src/server/config/**`. The reason is what these rows are: §2 B10 calls this
 * table "the authorisation matrix itself", and `createPermissionContext` feeds
 * `requireTask` on every gated request. A default-tenant fallback on a READ that
 * decides who may act would be a gate silently answering from another customer's
 * grid, and the fail-open above would make it look like an ordinary answer. The
 * one call site outside T1-CONFIG's paths — `routes/users.ts`'s
 * `wouldStrandTheConsole` — is updated in the same commit for that reason, and the
 * handoff says so.
 *
 * `plan_multitenancy.md` §11 and `0091`'s header both name this file's QUERIES as
 * the right place for the scope, and `src/shared/permissions.ts` as the wrong one:
 * `can(edition, role, taskId, overrides)` is a pure function whose `edition` picks
 * which matrix applies. It consumes what these two statements produce.
 */
import type { Role } from "../../shared/roles";
import type { RolePermissionRow } from "../../shared/types";
import {
  can as canPure,
  grantedTasks,
  overridesFromRows,
  type PermissionOverrides,
} from "../../shared/permissions";
import { scopeOf, scoped, type TenantScope } from "../../shared/tenant";
import type { SessionUser } from "../types";

/**
 * Every persisted override for one (workspace, role) — the read on the request
 * path of every gated route. `idx_role_permissions_lookup` was re-cut as
 * `(tenant_id, edition, role)` by `0091` for exactly this statement.
 */
export async function loadPermissionOverrides(
  db: D1Database,
  scope: TenantScope,
  role: Role | string,
): Promise<PermissionOverrides> {
  try {
    const q = scoped(scope).on("rp").and("rp.role = ?", role);
    const rows = (
      await db
        .prepare(
          `SELECT rp.edition, rp.role, rp.task_id, rp.granted FROM role_permissions rp ${q.whereClause()}`,
        )
        .bind(...q.binds)
        .all<Pick<RolePermissionRow, "edition" | "role" | "task_id" | "granted">>()
    ).results;
    return overridesFromRows(rows as RolePermissionRow[]);
  } catch {
    // No table yet, or D1 is unhappy — the shipped defaults stand. See above.
    return new Map();
  }
}

/**
 * The whole matrix for one workspace, for `GET /api/permissions` and for
 * `users.ts`'s "would removing this person strand the console?" check.
 *
 * `edition` stays in the SELECT list because `overridesFromRows` keys on it and
 * the pure `can()` needs it; it is also in the predicate, as half the workspace.
 */
export async function loadWorkspaceOverrides(
  db: D1Database,
  scope: TenantScope,
): Promise<PermissionOverrides> {
  try {
    const q = scoped(scope).on("rp");
    const rows = (
      await db
        .prepare(
          `SELECT rp.edition, rp.role, rp.task_id, rp.granted FROM role_permissions rp ${q.whereClause()}`,
        )
        .bind(...q.binds)
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
  const overrides = () => (pending ??= loadPermissionOverrides(db, scopeOf(user), user.role));
  return {
    async can(taskId) {
      return canPure(user.edition, user.role, taskId, await overrides());
    },
    async granted() {
      return grantedTasks(user.edition, user.role, await overrides());
    },
  };
}
