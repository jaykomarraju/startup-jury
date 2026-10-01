import type { Edition, Role } from "../shared/roles";
import { scoped, type TenantScope } from "../shared/tenant";

export interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string | null;
  role: Role;
  edition: Edition;
  /** `organizations.id` — the customer this account belongs to (`0087`). */
  tenant_id: string;
  initials: string;
  active: number;
  /** Organizational alias title (Aug-2026 issue 1); NULL = use the role label. */
  title: string | null;
  /**
   * When this account first signed in (W3-B, `migrations/0041`). NULL means the
   * invite is still outstanding — `account_invite` went out and nobody has used
   * it — which is what makes "New team member accepted invite" producible.
   */
  invite_accepted_at: string | null;
}

/**
 * Every live account holding this address, across every customer.
 *
 * **This replaced `getUserByEmail`, and the plural is the whole change.**
 * `0001_init.sql:7` made `users.email` globally UNIQUE, so "the user with this
 * email" was a well-formed question and `.first()` was a correct answer. `0087`
 * turns that constraint into `UNIQUE (tenant_id, email)` — §7 Q4, "two customers
 * employing the same person is not an edge case; it is the second customer" — and
 * from then on an address identifies a PERSON, not an ACCOUNT. A `.first()` would
 * silently sign the caller into whichever row the query planner happened to return
 * first, which is a cross-tenant authentication bug that no test would notice
 * while there is one tenant.
 *
 * Ordered by `created_at` so the result is deterministic rather than
 * planner-dependent, which matters for the "which workspace?" message
 * `routes/auth.ts` builds from it.
 *
 * Soft-deleted rows are excluded here rather than at the call site: `0044`'s
 * lifecycle moves a deleted account's address to `deleted_email` to free the
 * unique index, so a row with `deleted_at` set holds a stale address and must
 * never be a login candidate.
 */
export async function getUsersByEmail(
  db: D1Database,
  email: string,
): Promise<UserRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM users WHERE email = ? AND deleted_at IS NULL ORDER BY created_at, id")
    .bind(email)
    .all<UserRow>();
  return results;
}

/**
 * @deprecated **Cross-tenant as written. T1-PEOPLE must replace this call.**
 *
 * The one surviving caller is `routes/users.ts:287`, where it answers "does this
 * address already exist?" before `POST /api/users` creates a colleague. Under
 * `0087`'s `UNIQUE (tenant_id, email)` that question is per workspace, and the
 * global form is wrong in BOTH directions: it refuses tenant B's admin the right
 * to add a person tenant A already employs, and its 409 discloses that the address
 * exists somewhere on the platform. Swap it for `getUserByEmailInScope(db, email,
 * scopeOf(c.var.user))`.
 *
 * It is left here, unchanged, rather than fixed in place because
 * `src/server/routes/users.ts` belongs to T1-PEOPLE and T0 does not edit another
 * session's files — see `plan_multitenancy.md` §11's ownership table, and §6 on why
 * `users.ts` in particular is the file a foundation session must not touch. The
 * behaviour is identical to today's while one tenant exists, so nothing regresses
 * by waiting; `test/worker/tenant-scope.test.ts` carries the matching PENDING row,
 * which fails the moment the fix lands and tells T1-PEOPLE to promote it.
 */
export async function getUserByEmail(
  db: D1Database,
  email: string,
): Promise<UserRow | null> {
  return db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first<UserRow>();
}

/**
 * The account holding this address inside ONE workspace.
 *
 * For the callers that already know the tenant — an invite flow, a password reset
 * inside an admin console — where the question really is about an account and
 * `UNIQUE (tenant_id, email)` makes the answer singular again.
 */
export async function getUserByEmailInScope(
  db: D1Database,
  email: string,
  scope: TenantScope,
): Promise<UserRow | null> {
  return db
    .prepare(
      "SELECT * FROM users WHERE tenant_id = ? AND edition = ? AND email = ? AND deleted_at IS NULL",
    )
    .bind(scope.tenantId, scope.edition, email)
    .first<UserRow>();
}

/**
 * By id, which is globally unique and therefore needs no scope to be CORRECT —
 * but a caller acting on the row still has to check that the row is theirs.
 * `sameWorkspace()` in `src/shared/tenant.ts` is that check, and §6 names the
 * route where forgetting it transfers another customer's ownership.
 */
export async function getUserById(
  db: D1Database,
  id: string,
): Promise<UserRow | null> {
  return db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>();
}

/** A row of `organizations` (`0083`) — the customer, as the platform knows them. */
export interface OrganizationRow {
  id: string;
  name: string;
  /** The login/hostname handle. Lower-case, digits and hyphens. */
  slug: string;
  status: "active" | "trial" | "suspended";
  created_at: string;
  updated_at: string | null;
}

/**
 * Resolve a customer by the handle a caller supplies at login.
 *
 * Matched case-insensitively because the slug is typed by a human into a login
 * form, and `0083`'s CHECK already guarantees the stored value is lower-case.
 */
export async function getOrganizationBySlug(
  db: D1Database,
  slug: string,
): Promise<OrganizationRow | null> {
  return db
    .prepare("SELECT * FROM organizations WHERE slug = lower(?)")
    .bind(slug.trim())
    .first<OrganizationRow>();
}

export async function getOrganizationById(
  db: D1Database,
  id: string,
): Promise<OrganizationRow | null> {
  return db.prepare("SELECT * FROM organizations WHERE id = ?").bind(id).first<OrganizationRow>();
}

/**
 * A row of `parameters`, the evaluation rubric's definition table. Server code
 * has been selecting subsets of this ad hoc; the shape is declared once here
 * now that W1-B's `0025` added the two columns the specs' `parameter_definitions`
 * sketch names — a scorer-facing `description`, and the admin console's
 * *Permit configuration* flag.
 */
export interface ParameterRow {
  id: string;
  tenant_id: string;
  edition: Edition;
  key: string;
  name: string;
  /** 0 for informational / role-scoped additional parameters. */
  weight: number;
  informational: number;
  /** The owning role for an additional parameter; NULL for the 13 core areas. */
  role_scope: string | null;
  /** Per-parameter AI extraction / guidance prompt. */
  prompt: string | null;
  /** Shown to the scorer beside the parameter (specs §6.2). */
  description: string | null;
  /** Admin console → Area weights → "Permit configuration". */
  config_permitted: number;
  sort_order: number;
  active: number;
}

/**
 * The rubric for ONE workspace.
 *
 * The signature takes a `TenantScope` rather than an `Edition` because a bare
 * `edition` is no longer enough to identify whose rubric this is, and because a
 * compile error at every call site is the point: this is one of the 211 predicates
 * §5c describes as left "correct but insufficient" by adding `tenant_id`
 * alongside `edition`. Changing the parameter TYPE converts "insufficient" into
 * "does not build", which is the only version a 51-file sweep cannot miss.
 */
export async function getParameters(
  db: D1Database,
  scope: TenantScope,
  { includeInactive = false } = {},
): Promise<ParameterRow[]> {
  const q = scoped(scope).on("p");
  if (!includeInactive) q.andRaw("p.active = 1");
  const sql = `SELECT p.* FROM parameters p ${q.whereClause()} ORDER BY p.sort_order`;
  const { results } = await db.prepare(sql).bind(...q.binds).all<ParameterRow>();
  return results;
}
