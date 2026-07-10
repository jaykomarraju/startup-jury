import { useState } from "react";
import { Outlet } from "react-router-dom";
import { Topbar } from "./Topbar";
import { Sidebar } from "./Sidebar";
import { useAuth } from "../auth/useAuth";
import { useTheme } from "../theme/useTheme";
import { roleLabel, editionLabel } from "../../shared/roles";

/**
 * Authenticated app layout: dark top bar + role-derived sidebar + routed content.
 * Assumes an authenticated user (rendered under <RequireAuth>).
 */
export function AppShell() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (!user) return null;

  return (
    <div className="flex h-screen flex-col bg-bg">
      <Topbar
        userName={user.name}
        initials={user.initials}
        roleLabel={roleLabel(user.edition, user.role)}
        editionLabel={editionLabel(user.edition)}
        theme={theme}
        onToggleTheme={toggleTheme}
        onLogout={logout}
        onMenu={() => setDrawerOpen(true)}
      />

      <div className="flex min-h-0 flex-1">
        {/* Desktop sidebar */}
        <aside className="hidden w-60 shrink-0 overflow-y-auto border-r border-line bg-sidebar md:block">
          <Sidebar edition={user.edition} role={user.role} />
        </aside>

        {/* Mobile drawer */}
        {drawerOpen && (
          <div className="fixed inset-0 z-40 md:hidden">
            <div
              className="absolute inset-0 bg-navy/40"
              onClick={() => setDrawerOpen(false)}
              aria-hidden="true"
            />
            <aside className="absolute left-0 top-0 h-full w-64 overflow-y-auto border-r border-line bg-sidebar">
              <Sidebar
                edition={user.edition}
                role={user.role}
                onNavigate={() => setDrawerOpen(false)}
              />
            </aside>
          </div>
        )}

        <main className="min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
