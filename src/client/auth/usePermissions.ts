import { useContext, useMemo } from "react";
import { AuthContext } from "./AuthProvider";
import { lookupFromGranted, type PermissionLookup } from "../../shared/permissions";

/**
 * The signed-in principal's permission lookup (W3-A) — the client half of
 * `can(edition, role, task)`, rebuilt from the task-id list `/api/auth/me`
 * sends. Pass it to `navForUser` / `canAccessNav` so the sidebar and the route
 * guard agree with the server about what this user may reach.
 *
 * The server enforces independently; this only decides what is DRAWN. Outside an
 * `<AuthProvider>`, or before the principal resolves, it gates NOTHING — the
 * shipped default and never more than it, so a presentational render of the
 * sidebar (`test/client/components.test.tsx`) still shows the manifest while a
 * real session still gets the real answer from the route guard and the API.
 */
export function usePermissions(): PermissionLookup {
  const user = useContext(AuthContext)?.user ?? null;
  return useMemo(
    () => (user ? lookupFromGranted(user.edition, user.role, user.permissions) : () => true),
    [user],
  );
}
