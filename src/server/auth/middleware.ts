import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import type { AppEnv } from "../types";
import type { Role } from "../../shared/roles";
import { getSession, SESSION_COOKIE } from "./session";

/** Populates `c.var.user` from the session cookie, or returns 401. */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  const user = await getSession(c.env.SESSIONS, token);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  c.set("user", user);
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
