/**
 * THE RUNTIME PERMISSION ENGINE (W3-A)
 * ====================================
 *
 * `role_permissions` (migration `0029`, seeded from the prototype's Admin
 * console → Team & roles grid) stops being inert here: this module is the pure
 * core that answers **may this (edition, role) do this task?** at runtime.
 *
 * ── GATE, NOT GRANT (plan §8 Q8, and it is binding) ────────────────────────
 * A permission can only ever REMOVE a capability. `granted = 0` takes one away;
 * `granted = 1` leaves the application's finer rules — pipeline transition role
 * lists, stage gating, `requireRole`'s role list — exactly as they were. Every
 * call site therefore ANDs `can(...)` with the rule that was already there:
 *
 *     requireTask("assign", "program_manager", "program_associate", "admin")
 *       ≡ requireRole(...those roles) AND can(edition, role, "assign")
 *
 * That is what lets the DEFAULT seed reproduce today's matrix to the cell —
 * `npm run roles` stays green — while making every cell worth toggling. It also
 * means the AND can never *widen* access: the seed for a nav-backed task is the
 * union of the roles that reach its slugs, so it is a superset of any one
 * slug's role list by construction.
 *
 * ── WHO THE MATRIX COVERS ──────────────────────────────────────────────────
 * `PERMISSION_ROLES` (5 incubator roles, 6 investor) and nobody else:
 *   • `founder` is an EXTERNAL actor whose isolation is a security invariant
 *     (`scripts/role-matrix.ts` §B), not an administrator's toggle. The matrix
 *     is not a gate on founders at all — `can()` returns true and the founder's
 *     access stays entirely decided by the rule the permission is ANDed with.
 *   • `mentor` is a directory record with no pipeline authority (§1.2, commit
 *     `8822db2`). It gains nothing here, ever: `can()` is false for it
 *     unconditionally, and `denyMentor` is untouched.
 *
 * ── RESOLUTION ORDER ───────────────────────────────────────────────────────
 *   1. mentor                       → false (never)
 *   2. role outside this edition's matrix (founder) → true (not gated)
 *   3. task outside this edition's matrix           → true (not a gate here;
 *      `signuppipeline` is incubator-only, `icpipeline` investor-only, and a
 *      shared route must not 403 in the edition that has no such cell)
 *   4. a persisted `role_permissions` row           → `granted === 1`
 *   5. otherwise                                    → `DEFAULT_ROLE_PERMISSIONS`
 *
 * Step 5 is what makes the table an OVERRIDE layer rather than the whole truth:
 * an empty (or unreachable) table yields exactly today's behaviour instead of
 * locking everyone out. `src/server/auth/permissions.ts` relies on it.
 */
import { isMentor, type Edition, type Role } from "./roles";
import { DEFAULT_ROLE_PERMISSIONS, PERMISSION_ROLES, type RolePermissionRow } from "./types";

/** `(taskId) => allowed`. The shape every call site ANDs with its own rule. */
export type PermissionLookup = (taskId: string) => boolean;

/**
 * Persisted overrides, sparse: only rows that exist in `role_permissions`.
 * Keyed across all three columns so one map can serve a whole workspace (the
 * `GET /api/permissions` payload, a test fixture) as well as one principal.
 */
export type PermissionOverrides = ReadonlyMap<string, boolean>;

export function overrideKey(edition: Edition, role: Role | string, taskId: string): string {
  return `${edition}/${role}/${taskId}`;
}

export function overridesFromRows(rows: readonly RolePermissionRow[]): PermissionOverrides {
  const out = new Map<string, boolean>();
  for (const r of rows) out.set(overrideKey(r.edition, r.role, r.task_id), r.granted === 1);
  return out;
}

/** Is this role one the task matrix covers at all? (founder / mentor are not.) */
export function isMatrixRole(edition: Edition, role: Role | string): boolean {
  return (PERMISSION_ROLES[edition] as readonly string[]).includes(role);
}

/** Is this task a cell in this edition's grid? */
export function isMatrixTask(edition: Edition, taskId: string): boolean {
  return Object.prototype.hasOwnProperty.call(DEFAULT_ROLE_PERMISSIONS[edition], taskId);
}

/** The seeded default for one cell, ignoring any persisted override. */
export function defaultGrant(edition: Edition, role: Role | string, taskId: string): boolean {
  const roles = DEFAULT_ROLE_PERMISSIONS[edition][taskId] as readonly string[] | undefined;
  return roles ? roles.includes(role) : false;
}

/**
 * **The** question. See the resolution order above; `overrides` is whatever the
 * caller has loaded from `role_permissions` (omit it for the shipped default).
 */
export function can(
  edition: Edition,
  role: Role | string,
  taskId: string,
  overrides?: PermissionOverrides,
): boolean {
  if (isMentor(role)) return false;
  if (!isMatrixRole(edition, role)) return true;
  if (!isMatrixTask(edition, taskId)) return true;
  const override = overrides?.get(overrideKey(edition, role, taskId));
  if (override !== undefined) return override;
  return defaultGrant(edition, role, taskId);
}

/** Every task id this (edition, role) holds — the set shipped to the client. */
export function grantedTasks(
  edition: Edition,
  role: Role | string,
  overrides?: PermissionOverrides,
): string[] {
  if (!isMatrixRole(edition, role)) return [];
  return Object.keys(DEFAULT_ROLE_PERMISSIONS[edition]).filter((taskId) =>
    can(edition, role, taskId, overrides),
  );
}

/** Bind `can` to one principal — the form `nav.ts` and the guards consume. */
export function permissionLookup(
  edition: Edition,
  role: Role | string,
  overrides?: PermissionOverrides,
): PermissionLookup {
  return (taskId) => can(edition, role, taskId, overrides);
}

/**
 * The client's lookup, rebuilt from the flat task-id list `/api/auth/me` sends.
 * Steps 1–3 of the resolution order have to survive the round trip: a founder
 * carries an empty list and must still not be gated by it, and a task absent
 * from the edition's grid is not a gate for anyone.
 */
export function lookupFromGranted(
  edition: Edition,
  role: Role | string,
  granted: readonly string[] | undefined,
): PermissionLookup {
  if (isMentor(role)) return () => false;
  if (!isMatrixRole(edition, role)) return () => true;
  const set = new Set(granted ?? []);
  return (taskId) => (isMatrixTask(edition, taskId) ? set.has(taskId) : true);
}
