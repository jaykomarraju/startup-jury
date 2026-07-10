import { useParams } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { EmptyState } from "../components";
import { navItemById, navLabel } from "../../shared/nav";

/**
 * Placeholder for nav destinations whose full screens ship in later phases.
 * The route is already guarded by RequireNav, so we only render the empty state.
 */
export function StubPage() {
  const { user } = useAuth();
  const { navId } = useParams();
  if (!user || !navId) return null;

  const item = navItemById(user.edition, navId);
  const title = item ? navLabel(user.role, item) : navId;

  return (
    <div className="p-5">
      <h1 className="mb-5 text-xl font-semibold text-fg">{title}</h1>
      <EmptyState
        icon={item?.icon}
        title={`${title} — coming soon`}
        description="This screen is part of a later build phase. The design system, navigation, and role access are wired; the full workflow lands in an upcoming phase."
      />
    </div>
  );
}
