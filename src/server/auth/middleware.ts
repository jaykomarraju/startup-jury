import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import type { AppEnv, SessionUser } from "../types";
import type { Role } from "../../shared/roles";
import { INCUBATOR_ROLES, MENTOR_ROLE, VC_ROLES, isMentor } from "../../shared/roles";
import { getSession, SESSION_COOKIE } from "./session";
import { createPermissionContext } from "./permissions";

declare module "hono" {
  interface ContextVariableMap {
    /**
     * Does this principal still owe us a real password? Read off the same row
     * `requireAuth` already loads, so it costs nothing extra, and set on EVERY
     * authenticated request. `must_change_password` is written by three routes in
     * `users.ts` and enforced by none — `users.ts:511-516` says so in its own
     * words — and the route that will put it on the wire is `GET /api/auth/me`,
     * which already does its own read of this same row (`routes/auth.ts:223-226`)
     * and belongs to another lane. This is the handover: the value is here, so
     * that route needs no second query and this one needs no second caller.
     *
     * Augmenting Hono's `ContextVariableMap` rather than `AppEnv["Variables"]`
     * deliberately: `AppEnv` lives in `src/server/types.ts`, which this change
     * does not own, and the augmentation is type-identical at the call site —
     * `Context.var` is `Readonly<ContextVariableMap & E["Variables"]>`
     * (hono 4.12.28, `dist/types/context.d.ts:374`).
     */
    mustChangePassword: boolean;
  }
}

/**
 * Every value `users.role` is allowed to hold, which is `Role` **plus
 * `'mentor'`**: `shared/roles.ts:36-43` records that a mentor is a user-type
 * deliberately absent from `Role` and yet "is still what a mentor row persists
 * as (`users.role = 'mentor'`) and therefore what a signed-in mentor carries on
 * their session". `migrations/0015_roles_users.sql:29` is the row. Omitting it
 * here would 401 every mentor on their next request, which is why the list is
 * built from the two role unions AND the mentor constant rather than from
 * `ROLES_BY_EDITION`.
 */
const PERSISTED_ROLES: readonly string[] = [...INCUBATOR_ROLES, ...VC_ROLES, MENTOR_ROLE];

/**
 * A user-defined guard, not a cast: it narrows to exactly the type
 * `routes/auth.ts`'s `toSessionUser` already puts on `SessionUser.role` for the
 * same column — including the documented `'mentor'` lie above.
 */
function isPersistedRole(value: string): value is SessionUser["role"] {
  return PERSISTED_ROLES.includes(value);
}

/** The authority-bearing columns of `users`, re-read on every request. */
interface PrincipalRow {
  role: string;
  active: number;
  deleted_at: string | null;
  must_change_password: number;
  /** `null` once the fallback below has fired — see `loadPrincipal`. */
  approval_state: string | null;
}

const PRINCIPAL_SQL =
  "SELECT role, active, deleted_at, must_change_password, approval_state " +
  "FROM users WHERE id = ? AND tenant_id = ?";

/** The same statement without `approval_state`, for a database below `0106`. */
const PRINCIPAL_SQL_PRE_0106 =
  "SELECT role, active, deleted_at, must_change_password FROM users WHERE id = ? AND tenant_id = ?";

/**
 * MEASURED, in this pool, by selecting the column against a database that does
 * not have it: `D1_ERROR: no such column: approval_state at offset 13:
 * SQLITE_ERROR`. Matched on the substring and nothing wider, so any OTHER D1
 * failure still propagates and surfaces as a 500 — a gate that decides authority
 * must not degrade quietly for a reason nobody named.
 */
const APPROVAL_STATE_ABSENT = "no such column: approval_state";

/**
 * The principal as the database has it now, or `null` if there is no such row in
 * this workspace.
 *
 * `approval_state` is added by `migrations/0106`. This reads it, and falls back
 * ONCE to the pre-`0106` statement when the column is absent, because the
 * alternative is that deploying this code ahead of its migration 500s every
 * authenticated request — the one failure mode that takes the whole product down
 * rather than one screen. Deliberately NOT memoised in module scope: a cached
 * "column is missing" would outlive the migration that added it and keep a
 * `pending` registrant signed in for the life of the isolate, and this is the
 * read that decides authority. MEASURED cost of the fallback path: 0.390 ms per
 * read against 0.150 ms for the column-present path (200/100 iterations, local
 * miniflare D1), and it is paid only while the column is missing. Delete the
 * fallback once every environment is at `0106` or above.
 */
async function loadPrincipal(
  db: D1Database,
  id: string,
  tenantId: string,
): Promise<PrincipalRow | null> {
  try {
    return await db.prepare(PRINCIPAL_SQL).bind(id, tenantId).first<PrincipalRow>();
  } catch (err) {
    if (!(err instanceof Error) || !err.message.includes(APPROVAL_STATE_ABSENT)) throw err;
    const row = await db
      .prepare(PRINCIPAL_SQL_PRE_0106)
      .bind(id, tenantId)
      .first<Omit<PrincipalRow, "approval_state">>();
    return row === null ? null : { ...row, approval_state: null };
  }
}

/**
 * Populates `c.var.user` from the session cookie **and the user's current row**,
 * or returns 401 — and hangs the request's permission resolver on `c.var.perms`
 * (W3-A). The resolver is LAZY: constructing it costs nothing, and
 * `role_permissions` is read at most once, only if some gate on this request
 * actually asks.
 *
 * ── WHY THIS READS D1 (the backdoor it closes) ──────────────────────────────
 *
 * Until now this middleware resolved the WHOLE principal from the KV session and
 * never touched D1, the session TTL is seven days (`session.ts:6`), and the only
 * `deleteSession` calls pass the caller's own cookie. So a session was a bearer
 * token for whatever the account was at login. MEASURED on local wrangler dev,
 * all three:
 *
 *   · a SOFT-DELETED admin's live session called `POST /api/users` and created a
 *     new admin, HTTP 200;
 *   · a DEACTIVATED user kept full access, although `POST /api/auth/login` had
 *     been refusing them the whole time;
 *   · a program manager DEMOTED to jury kept `assign` authority, because
 *     `requireTask` tests `user.role` and `user` was the login snapshot.
 *
 * `test/worker/users.test.ts:291` only ever asserted that a fresh *login* is
 * refused, which is why none of it was caught.
 *
 * WHY A ROW READ AND NOT AN EPOCH IN KV. An epoch (bump a counter on the user,
 * compare it against the session) is one cheap read instead of one cheap read —
 * but it has to be REMEMBERED at every site that changes authority:
 * `PATCH /api/users/:id` (role + active, `users.ts:470`), `DELETE /api/users/:id`
 * (`users.ts:616`) and both arms of `POST /api/users/:id/transfer-ownership`
 * (`users.ts:867-869`). That last one is this codebase's own proof that it gets
 * forgotten: it ends the outgoing owner's session by hand precisely because
 * nothing else would have, and it is the ONLY site that remembered. A read
 * inside the middleware cannot be forgotten by a route that does not know it
 * exists — including the registration and approval routes this wave is adding.
 *
 * WHAT IT COSTS. One indexed `users` lookup by primary key. MEASURED in the
 * worker pool: 0.150 ms per read, against 1.60 ms for a whole authenticated
 * `GET /api/notifications` round trip — about a 9% addition locally. Against
 * remote D1 it is a real network hop, but it is the same hop `GET /api/auth/me`
 * already pays on every page load for the same row (`routes/auth.ts:223-226`),
 * so the shape of the cost is already in production and accepted.
 *
 * `edition` and `tenant_id` are NOT refreshed, and that is a finding rather than
 * an omission: `grep -n "UPDATE users SET" src/server/` shows that no route in
 * the tree mutates either column, so there is nothing for them to drift towards.
 * A session whose `tenant_id` has drifted some other way reads no row here and
 * gets the same 401, which is the safe direction.
 *
 * THE 401 BODY IS DELIBERATELY UNIFORM. A removed, deactivated or unapproved
 * principal gets the byte-identical `{"error":"unauthorized"}` a missing cookie
 * gets, so no client branch changes and nothing is disclosed to a stolen
 * session. The user learns which of the three it was from `POST /api/auth/login`,
 * which distinguishes `pending_approval` from `account_disabled` — the one place
 * that has a person in front of it.
 */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  // IDEMPOTENT, because it genuinely runs twice on some requests:
  // `app.route("/api/decks", decks)` (`index.ts:80`) and `app.route("/api", pipeline)`
  // (`index.ts:87`) both register this middleware at `/api/decks/*` — see
  // `decks.ts:80` and `pipeline.ts:75`. Before this change a second run cost one
  // KV read nobody noticed; now it would cost a second D1 read for an answer we
  // already have. The falsy test is the same one `requireRole` below uses.
  if (c.var.user) return next();

  const token = getCookie(c, SESSION_COOKIE);
  const snapshot = await getSession(c.env.SESSIONS, token);
  if (!snapshot) return c.json({ error: "unauthorized" }, 401);

  const row = await loadPrincipal(c.env.DB, snapshot.id, snapshot.tenantId);
  // Removed, deactivated, or gone from this workspace. The soft delete keeps the
  // row and stamps `deleted_at` / `active = 0` / renames the email
  // (`users.ts:616`), so a lookup BY ID still finds it — which is exactly why the
  // `deleted_at` test has to be here and not left to a `deleted_at IS NULL`
  // predicate that would have made a removed admin indistinguishable from a
  // cross-tenant id.
  if (!row) return c.json({ error: "unauthorized" }, 401);
  if (row.deleted_at !== null) return c.json({ error: "unauthorized" }, 401);
  if (row.active !== 1) return c.json({ error: "unauthorized" }, 401);
  // `approval_state` is `'approved'` by default for every account that predates
  // `0106`, and `null` only when the column is not there yet — both mean approved.
  // Anything else (`'pending'`, `'declined'`) is a registrant an administrator has
  // not let in, and must not hold a working session even if one was minted.
  if (row.approval_state !== null && row.approval_state !== "approved") {
    return c.json({ error: "unauthorized" }, 401);
  }
  // An unrecognisable role is a corrupt principal, not a role we should guess at:
  // `requireRole` would compare it against a list it cannot be in anyway, and
  // `can()` would fall through to a default matrix for a role that does not exist.
  if (!isPersistedRole(row.role)) return c.json({ error: "unauthorized" }, 401);

  // The row wins over the snapshot for `role`, so a demotion takes effect on the
  // very next request. `createPermissionContext` closes over `user.role`
  // (`permissions.ts:116`), so it MUST be built from the refreshed principal —
  // building it from `snapshot` would leave the task grid answering for the old
  // role and reinstate half the hole this change closes.
  const user: SessionUser = { ...snapshot, role: row.role };
  c.set("user", user);
  c.set("mustChangePassword", row.must_change_password === 1);
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
