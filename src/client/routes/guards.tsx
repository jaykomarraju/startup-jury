import { Navigate, useParams } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "../auth/useAuth";
import { usePermissions } from "../auth/usePermissions";
import { canAccessNav, landingNavId } from "../../shared/nav";
import { EmptyState } from "../components";

/** Full-screen loader while the session resolves. */
function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg text-fg-muted">
      <span className="text-sm">Loading…</span>
    </div>
  );
}

/** Gate that requires an authenticated user; redirects to /login otherwise. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/**
 * Gate for a nav-slug route (`/app/:navId`). Mirrors the server-side
 * `requireTask`: a user may only open a slug their role can see AND whose task
 * permission they hold; unknown/forbidden slugs render a 403 empty state
 * (client-side — the API enforces authZ independently).
 */
export function RequireNav({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const can = usePermissions();
  const { navId } = useParams();
  if (!user) return <Navigate to="/login" replace />;
  if (!navId) return <Navigate to={`/app/${landingNavId(user.edition, user.role, can)}`} replace />;
  if (!canAccessNav(user.edition, user.role, navId, can)) {
    return (
      <EmptyState
        icon="ShieldAlert"
        title="Not available for your role"
        description="You don't have access to this section. Use the sidebar to navigate to a permitted area."
      />
    );
  }
  return <>{children}</>;
}
