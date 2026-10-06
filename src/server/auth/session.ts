import type { SessionUser } from "../types";

// Sessions are opaque tokens stored in KV with a TTL. The value is the principal
// as it stood AT LOGIN.
//
// It used to be the whole answer — "the resolved principal so requests don't hit
// D1 on every call" is what this comment said, and it was true and it was the
// bug. `requireAuth` now re-reads `role`, `active`, `deleted_at`,
// `must_change_password` and `approval_state` from `users` on every request
// (`middleware.ts`, with the three measured escapes that forced it), so what is
// kept here is only the part that cannot change under a live session: `id`,
// `tenantId`, `edition`, and the display fields. `role` is still written because
// login and `/me` return it, but it is ADVISORY — the row wins.
const PREFIX = "session:";
// Seven days. Tolerable now in a way it was not before: the authority-bearing
// fields are re-read per request, so the TTL bounds how long a stale *display*
// name or a stale tenant mapping can live, not how long a removed admin keeps
// administering. Shortening it would only add re-logins.
const TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export const SESSION_COOKIE = "sj_session";

export async function createSession(
  kv: KVNamespace,
  user: SessionUser,
): Promise<string> {
  const token = crypto.randomUUID();
  await kv.put(PREFIX + token, JSON.stringify(user), {
    expirationTtl: TTL_SECONDS,
  });
  return token;
}

/**
 * Resolve a session token, or null.
 *
 * ── WHY A SESSION WITHOUT A `tenantId` IS REFUSED ───────────────────────────
 *
 * The value here is a snapshot written once at login and held for seven days, and
 * §6's closing note records that there is **no invalidation path** for it: "sessions
 * snapshot `role` and `edition` into KV for 7 days and will snapshot `tenant_id`
 * the same way, with no invalidation path when a principal's tenant changes."
 *
 * That sentence is now only half true, and the surviving half is the half this guard
 * is about. `requireAuth` re-reads `role`, `active` and `deleted_at` per request, so
 * a demotion, a deactivation and a removal all take effect at once. `tenant_id` is
 * the one that still has no invalidation path — nothing in the tree writes it, so a
 * drifted session simply reads no row and takes the same 401. Which leaves the case
 * below: a session that never had the field at all.
 *
 * So on the deploy that ships tenancy, every live session is a value written before
 * `tenantId` existed. There are two ways to treat one:
 *
 *   · default it to `t_default` — nobody is logged out, and a principal who in fact
 *     belongs to another customer is silently scoped to the first one. That is the
 *     exact failure this wave exists to prevent, arriving through the one code path
 *     that runs before every other check.
 *   · refuse it — the cookie is ignored, `requireAuth` answers 401, the client
 *     sends the caller to the sign-in screen, and the next login writes a complete
 *     principal.
 *
 * It refuses. The cost is that everyone signs in again once, which is the ordinary
 * cost of a session-format change; the alternative is a cross-tenant read that no
 * test can see because, on the day of the deploy, there is still only one tenant
 * for it to be wrong about.
 *
 * The same guard covers a hand-written or truncated KV value, and it is deliberately
 * a positive check on the field rather than a version number: a version number has
 * to be remembered and this cannot be forgotten.
 */
export async function getSession(
  kv: KVNamespace,
  token: string | undefined,
): Promise<SessionUser | null> {
  if (!token) return null;
  const raw = await kv.get(PREFIX + token);
  if (!raw) return null;
  try {
    const user = JSON.parse(raw) as Partial<SessionUser>;
    if (typeof user.tenantId !== "string" || user.tenantId === "") return null;
    return user as SessionUser;
  } catch {
    return null;
  }
}

export async function deleteSession(
  kv: KVNamespace,
  token: string | undefined,
): Promise<void> {
  if (token) await kv.delete(PREFIX + token);
}
