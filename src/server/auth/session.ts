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

export async function getSession(
  kv: KVNamespace,
  token: string | undefined,
): Promise<SessionUser | null> {
  if (!token) return null;
  const raw = await kv.get(PREFIX + token);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionUser;
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
