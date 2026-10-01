import { Hono } from "hono";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import type { AppEnv, Env, SessionUser } from "../types";
import { getUsersByEmail, getOrganizationById, getOrganizationBySlug, type UserRow } from "../db";
import { verifyPassword } from "../auth/password";
import {
  createSession,
  deleteSession,
  SESSION_COOKIE,
} from "../auth/session";
import { requireAuth } from "../auth/middleware";
import { loadPermissionOverrides } from "../auth/permissions";
import { scopeOf } from "../../shared/tenant";
import { emitNotification } from "../email/outbox";
import { grantedTasks } from "../../shared/permissions";
import { roleLabel } from "../../shared/roles";

const auth = new Hono<AppEnv>();

/** The task ids this principal holds — see the note on `GET /me` below. */
async function permissionsFor(db: D1Database, user: SessionUser): Promise<string[]> {
  // T1-CONFIG, one expression inside T0's file: `loadPermissionOverrides` now takes
  // the workspace rather than the edition, because `role_permissions` is the
  // authorisation matrix itself (§2 B10) and a gate must not read it from another
  // customer. `scopeOf(user)` is the same principal this function was already
  // answering for.
  return grantedTasks(
    user.edition,
    user.role,
    await loadPermissionOverrides(db, scopeOf(user), user.role),
  );
}

/**
 * ── WHY LOGIN CHANGED AT ALL ─────────────────────────────────────────────────
 *
 * §2 A7 is the one finding in the leak table that is not a leak: `users.email` was
 * globally `UNIQUE` (`0001_init.sql:7`) and there is no tenant selector at login,
 * so "two customers cannot both employ `alice@gmail.com`, and this blocks the
 * model outright." `0087` removes that constraint. The moment it does, an address
 * stops identifying an ACCOUNT and starts identifying a PERSON, and
 * `SELECT * FROM users WHERE email = ?` followed by `.first()` becomes a
 * cross-tenant authentication bug — it signs the caller into whichever row the
 * planner returned first.
 *
 * ── HOW THE WORKSPACE IS CHOSEN, IN ORDER ───────────────────────────────────
 *
 *   1. One candidate — the case today and for every single-workspace customer.
 *      Nothing changes: `{ email, password }` signs in exactly as before, which is
 *      what keeps 13 seeded logins, 72 e2e specs and the 526-case roles harness
 *      working without a line of change.
 *   2. A `tenant` was supplied (an `organizations.slug`) — candidates are narrowed
 *      to it BEFORE any password is checked, so supplying a slug can never widen
 *      the search.
 *   3. More than one candidate survives and the password matches more than one of
 *      them — the caller is one human with accounts at two customers and the same
 *      password at both. `409 tenant_required`, with the names of the workspaces
 *      the password actually opened.
 *
 * ── AND WHY THAT 409 IS NOT AN ENUMERATION ORACLE ───────────────────────────
 *
 * It is returned only AFTER a password has verified, and it lists only the
 * workspaces that THAT password opened. An attacker who can trigger it already
 * holds the credential. Every other failure — unknown address, wrong password,
 * suspended organisation, inactive account, no password set — returns the same
 * `401 invalid_credentials` the route has always returned, and the password is
 * verified against every candidate before any of them is rejected, so the response
 * does not vary with how many accounts an address has.
 *
 * A host-derived tenant (`acme.startupjury.ai`) is the shape a real deployment
 * wants and is deliberately NOT built here: §3 notes `billing/provider.ts:162`
 * hardcodes `returnUrl: "/app/admin?section=bl"` and is already wrong for a
 * customer-specific host, so hostnames are their own piece of work. When they
 * arrive they resolve a slug and feed step 2; nothing below changes.
 */
interface LoginCandidate {
  row: UserRow;
  org: { id: string; name: string; slug: string; status: string };
}

function toSessionUser(row: {
  id: string;
  name: string;
  initials: string;
  role: SessionUser["role"];
  edition: SessionUser["edition"];
  tenant_id: string;
  title?: string | null;
}): SessionUser {
  return {
    id: row.id,
    name: row.name,
    initials: row.initials,
    role: row.role,
    edition: row.edition,
    tenantId: row.tenant_id,
    ...(row.title ? { title: row.title } : {}),
  };
}

auth.post("/login", async (c) => {
  const body = await c.req
    .json<{ email?: string; password?: string; tenant?: string }>()
    .catch(() => null);
  if (!body?.email || !body?.password) {
    return c.json({ error: "email and password required" }, 400);
  }

  // Step 2 of the resolution order: a supplied slug NARROWS, so it is resolved
  // first and an unknown one fails as an ordinary bad credential rather than
  // telling the caller which customers exist.
  let wanted: string | null = null;
  if (body.tenant) {
    const org = await getOrganizationBySlug(c.env.DB, body.tenant);
    if (!org) return c.json({ error: "invalid_credentials" }, 401);
    wanted = org.id;
  }

  const rows = await getUsersByEmail(c.env.DB, body.email);
  const candidates: LoginCandidate[] = [];
  for (const row of rows) {
    if (wanted && row.tenant_id !== wanted) continue;
    if (!row.active || !row.password_hash) continue;
    const org = await getOrganizationById(c.env.DB, row.tenant_id);
    // A row whose tenant has no organisation cannot be signed in. `0100` asserts
    // this never happens, and if the assertion is ever wrong the answer is to
    // refuse the login, not to guess the customer.
    if (!org || org.status === "suspended") continue;
    candidates.push({ row, org });
  }

  // The password is checked against EVERY candidate before any decision, so the
  // response time and the response body do not vary with how many accounts the
  // address has.
  const opened: LoginCandidate[] = [];
  for (const candidate of candidates) {
    if (await verifyPassword(body.password, candidate.row.password_hash!)) opened.push(candidate);
  }
  if (opened.length === 0) return c.json({ error: "invalid_credentials" }, 401);
  if (opened.length > 1) {
    // One human, two customers, one password. Only reachable with a correct
    // credential, and it lists only what that credential opened.
    return c.json(
      {
        error: "tenant_required",
        tenants: opened.map(({ org }) => ({ slug: org.slug, name: org.name })),
      },
      409,
    );
  }
  const user = opened[0].row;

  // W3-B producer — "New team member accepted invite". An invite is *accepted*
  // the first time its credential is actually used, which is here and nowhere
  // else: `POST /api/users` sends the temporary password, and until now nothing
  // recorded whether anyone ever signed in with it (F0016; the column is the
  // one `W1-C` asked for in §9). `migrations/0041` backfills every account that
  // already exists, so this fires for new invitees only — never for the seeded
  // demo logins.
  if (user.invite_accepted_at === null) await recordInviteAccepted(c.env, user);

  const sessionUser = toSessionUser(user);
  const token = await createSession(c.env.SESSIONS, sessionUser);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: new URL(c.req.url).protocol === "https:",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return c.json({ user: { ...sessionUser, permissions: await permissionsFor(c.env.DB, sessionUser) } });
});

/**
 * Stamp the acceptance and alert the workspace's administrators. Non-fatal by
 * construction — `emitNotification` swallows its own failures, and the stamp is
 * written first so a login can never alert twice even if the emit is retried.
 */
async function recordInviteAccepted(env: Env, user: UserRow): Promise<void> {
  const at = new Date().toISOString();
  // `tenant_id` is in the predicate although `id` alone is unique. It costs
  // nothing, and it is the shape every one of the 211 widened predicates takes —
  // the one place a reader of this file will look for the example.
  const res = await env.DB.prepare(
    "UPDATE users SET invite_accepted_at = ? WHERE id = ? AND tenant_id = ? AND invite_accepted_at IS NULL",
  )
    .bind(at, user.id, user.tenant_id)
    .run();
  // Lost the race with a concurrent first login — the other one alerts.
  if (res.meta.changes !== 1) return;

  await emitNotification(env, {
    event: "invite_accepted",
    edition: user.edition,
    title: `${user.name} accepted their invite`,
    body:
      `${user.name} (${user.email}) signed in for the first time as ` +
      `${roleLabel(user.edition, user.role)}.`,
    link: "/app/admin",
    actorId: user.id,
    dedupeKey: `invite_accepted:${user.id}`,
  });
}

auth.post("/logout", async (c) => {
  await deleteSession(c.env.SESSIONS, getCookie(c, SESSION_COOKIE));
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

/** GET /api/auth/me — the signed-in principal.
 *
 *  The session value in KV is written once at login, so the alias title is
 *  re-read from D1 here: editing it under My account (or having an admin edit
 *  it) then shows up on the next load rather than after a re-login. */
auth.get("/me", requireAuth, async (c) => {
  const session = c.var.user;
  // W3-A — the granted task ids ride along here rather than in the KV session
  // value, which is written once at login and lives seven days. An
  // administrator's edit to the Task permissions grid therefore takes effect on
  // this user's next page load, not on their next sign-in.
  const permissions = await c.var.perms.granted();
  const row = await c.env.DB
    .prepare("SELECT title, name, initials, tenant_id FROM users WHERE id = ? AND tenant_id = ?")
    .bind(session.id, session.tenantId)
    .first<{ title: string | null; name: string; initials: string; tenant_id: string }>();
  // Scoped by `tenant_id` as well as `id` even though `id` is globally unique: it
  // costs nothing and it means a session whose tenant has drifted from the row —
  // the seven-day KV snapshot §6 notes has no invalidation path — reads nothing
  // rather than refreshing itself from another customer's row.
  if (!row) return c.json({ user: { ...session, permissions } });
  return c.json({
    user: {
      ...session,
      name: row.name,
      initials: row.initials,
      ...(row.title ? { title: row.title } : { title: undefined }),
      permissions,
    },
  });
});

export default auth;
