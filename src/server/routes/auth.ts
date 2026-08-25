import { Hono } from "hono";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import type { AppEnv, SessionUser } from "../types";
import { getUserByEmail } from "../db";
import { verifyPassword } from "../auth/password";
import {
  createSession,
  deleteSession,
  SESSION_COOKIE,
} from "../auth/session";
import { requireAuth } from "../auth/middleware";

const auth = new Hono<AppEnv>();

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

  const sessionUser = toSessionUser(user);
  const token = await createSession(c.env.SESSIONS, sessionUser);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: new URL(c.req.url).protocol === "https:",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return c.json({ user: sessionUser });
});

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
  const row = await c.env.DB.prepare("SELECT title, name, initials FROM users WHERE id = ?")
    .bind(session.id)
    .first<{ title: string | null; name: string; initials: string }>();
  if (!row) return c.json({ user: session });
  return c.json({
    user: {
      ...session,
      name: row.name,
      initials: row.initials,
      ...(row.title ? { title: row.title } : { title: undefined }),
    },
  });
});

export default auth;
