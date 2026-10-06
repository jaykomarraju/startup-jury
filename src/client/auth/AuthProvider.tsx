import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Edition, Role } from "../../shared/roles";

/** Authenticated principal returned by /api/auth (mirrors server SessionUser). */
export interface AuthUser {
  id: string;
  name: string;
  initials: string;
  role: Role;
  edition: Edition;
  /**
   * Organizational ALIAS title (Aug-2026 issue 1). Shown in the top ribbon in
   * place of the platform role label; `role` still drives every permission.
   */
  title?: string;
  /**
   * The `role_permissions` task ids this principal holds (W3-A). Resolved
   * server-side on every `/api/auth/me`, so an administrator's edit to the Admin
   * console's Task permissions grid reaches the sidebar on the next page load.
   * Absent on a stale cached principal — `usePermissions()` treats that as
   * "un-gated", which is the shipped default and never more than it.
   */
  permissions?: string[];
  /**
   * `users.must_change_password` — true while the principal is still carrying a
   * credential somebody else chose (an admin's temporary password, or a reset).
   *
   * Optional because `GET /api/auth/me` does not return it yet; `auth.ts` is not
   * this lane's file. `/change-password` reads it to explain WHY it is asking,
   * and nothing anywhere gates on it, so a principal without the field behaves
   * exactly as it does today. Sign-in is NOT yet refused for a principal that
   * carries it — `users.ts:511-516` says so in its own words.
   */
  mustChangePassword?: boolean;
}

/** One workspace a correct credential opened (`server/routes/auth.ts:139-152`). */
export interface LoginTenant {
  slug: string;
  name: string;
}

/**
 * A refused sign-in, carrying enough for the screen to say something TRUE.
 *
 * Until now `login` threw `new Error(err.error ?? "login_failed")` and
 * `LoginPage.tsx:51-54` caught every one of them as "Invalid email or
 * password." — so a 500, a rate-limit and the `409 tenant_required` lockout all
 * told the user their password was wrong and sent them off to reset a password
 * that was never wrong. Measured, with a screenshot:
 * `docs/plan_pilot_gcw.md` §8 and §11 ("One product defect found in passing").
 *
 * `status` is **0** when the request never got a reply at all — offline, DNS,
 * aborted — which is the one failure the user can actually act on, and the one
 * an HTTP status cannot express.
 */
export class LoginFailure extends Error {
  readonly status: number;
  readonly code: string;
  /** Non-empty only for `tenant_required`: the workspaces to choose between. */
  readonly tenants: LoginTenant[];
  constructor(status: number, code: string, tenants: LoginTenant[] = []) {
    super(code);
    this.name = "LoginFailure";
    this.status = status;
    this.code = code;
    this.tenants = tenants;
  }
}

/** The `tenants` array off a 409, kept to the entries that are actually usable. */
function readTenants(value: unknown): LoginTenant[] {
  if (!Array.isArray(value)) return [];
  const out: LoginTenant[] = [];
  for (const entry of value) {
    if (entry && typeof entry === "object") {
      const row = entry as { slug?: unknown; name?: unknown };
      if (typeof row.slug === "string" && typeof row.name === "string") {
        out.push({ slug: row.slug, name: row.name });
      }
    }
  }
  return out;
}

export interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  /**
   * Sign in, optionally naming a workspace.
   *
   * `tenant` is an `organizations.slug` and is sent only when the user has
   * picked one from a `409 tenant_required` — the route has always accepted it
   * (`auth.ts:111-118`) and nothing ever sent it. Rejects with `LoginFailure`.
   */
  login: (email: string, password: string, tenant?: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  /** Patch the cached principal in place (e.g. after editing the alias title). */
  updateUser: (patch: Partial<AuthUser>) => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Resolve the current session on mount (cookie-based).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/me", { credentials: "same-origin" });
        if (!cancelled && res.ok) {
          const data = (await res.json()) as { user: AuthUser };
          setUser(data.user);
        }
      } catch {
        // Unauthenticated or offline — stay logged out.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string, tenant?: string) => {
    let res: Response;
    try {
      res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        // `tenant` only once the user has chosen one. `JSON.stringify` would
        // drop an `undefined` anyway; the spread makes the ordinary body
        // byte-identical to the one this route has always received.
        body: JSON.stringify({ email, password, ...(tenant ? { tenant } : {}) }),
      });
    } catch {
      // A thrown `fetch` is not a credential problem and must never read as
      // one — this is the offline case, and it is the user's to fix.
      throw new LoginFailure(0, "network_error");
    }
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as {
        error?: string;
        tenants?: unknown;
      };
      throw new LoginFailure(res.status, err.error ?? "login_failed", readTenants(err.tenants));
    }
    const data = (await res.json()) as { user: AuthUser };
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    }).catch(() => {});
    setUser(null);
  }, []);

  const updateUser = useCallback((patch: Partial<AuthUser>) => {
    setUser((current) => (current ? { ...current, ...patch } : current));
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, logout, updateUser }),
    [user, loading, login, logout, updateUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
