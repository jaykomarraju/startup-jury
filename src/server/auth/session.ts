import type { SessionUser } from "../types";

// Sessions are opaque tokens stored in KV with a TTL. The value is the
// resolved principal so requests don't hit D1 on every call.
const PREFIX = "session:";
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
