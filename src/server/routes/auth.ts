import { Hono } from "hono";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import type { AppEnv, Env, SessionUser } from "../types";
import { getUserByEmail, type UserRow } from "../db";
import { verifyPassword } from "../auth/password";
import {
  createSession,
  deleteSession,
  SESSION_COOKIE,
} from "../auth/session";
import { requireAuth } from "../auth/middleware";
import { loadPermissionOverrides } from "../auth/permissions";
import { emitNotification } from "../email/outbox";
import { grantedTasks } from "../../shared/permissions";
import { roleLabel } from "../../shared/roles";

const auth = new Hono<AppEnv>();

/** The task ids this principal holds — see the note on `GET /me` below. */
async function permissionsFor(db: D1Database, user: SessionUser): Promise<string[]> {
  return grantedTasks(user.edition, user.role, await loadPermissionOverrides(db, user.edition, user.role));
}

function toSessionUser(row: {
  id: string;
  name: string;
  initials: string;
  role: SessionUser["role"];
  edition: SessionUser["edition"];
  title?: string | null;
}): SessionUser {
  return {
    id: row.id,
    name: row.name,
    initials: row.initials,
    role: row.role,
    edition: row.edition,
    ...(row.title ? { title: row.title } : {}),
  };
}

auth.post("/login", async (c) => {
  const body = await c.req.json<{ email?: string; password?: string }>().catch(() => null);
  if (!body?.email || !body?.password) {
    return c.json({ error: "email and password required" }, 400);
  }
  const user = await getUserByEmail(c.env.DB, body.email);
  // Uniform failure to avoid leaking which emails exist.
  if (!user || !user.active || !user.password_hash) {
    return c.json({ error: "invalid_credentials" }, 401);
  }
  const ok = await verifyPassword(body.password, user.password_hash);
  if (!ok) return c.json({ error: "invalid_credentials" }, 401);

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
  const res = await env.DB.prepare(
    "UPDATE users SET invite_accepted_at = ? WHERE id = ? AND invite_accepted_at IS NULL",
  )
    .bind(at, user.id)
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
  const row = await c.env.DB.prepare("SELECT title, name, initials FROM users WHERE id = ?")
    .bind(session.id)
    .first<{ title: string | null; name: string; initials: string }>();
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
