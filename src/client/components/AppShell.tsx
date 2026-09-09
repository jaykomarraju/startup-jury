import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { X } from "lucide-react";
import { Topbar } from "./Topbar";
import { Sidebar } from "./Sidebar";
import { ToastProvider } from "./Toast";
import { useAuth } from "../auth/useAuth";
import { useTheme } from "../theme/useTheme";
import { roleLabel, editionLabel } from "../../shared/roles";

/**
 * Authenticated app layout — the prototype's fixed frame:
 * `body{overflow:hidden}` → `.view{height:100vh}` → `.an` (54px ribbon) over
 * `.ab{display:flex;overflow:hidden}` holding the 190px `.sb` rail and the
 * `.mn` content pane. Nothing page-scrolls; the rail and the pane each scroll
 * on their own axis, so the toolbar of a screen that has adopted
 * <PanelFrame> stays put over a long table.
 *
 * Three responsive tiers, as the prototype has (`_style.css:280-309`):
 * full rail → 52px icon rail under 900px → off-canvas drawer under 640px.
 *
 * Assumes an authenticated user (rendered under <RequireAuth>).
 *
 * The rail's count badges (`.bx`) are rendered by <Sidebar> from a `badges`
 * prop and are not wired to live data yet — see §9 of docs/plan_parity.md. The
 * obvious wiring (calling `listDecks()` + `listTickets()` from the shell) costs
 * two full list queries on every page load; measured against the e2e walk it
 * added ~30% to each navigation. It needs a cheap counts endpoint and a badge
 * key on NavItem, neither of which this session owns.
 */
export function AppShell() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Freeze the document behind the shell for as long as the shell is up. See
  // the `body[data-app-shell]` rule in index.css for why this is not a blanket
  // `body { overflow: hidden }`.
  useEffect(() => {
    document.body.dataset.appShell = "1";
    return () => {
      delete document.body.dataset.appShell;
    };
  }, []);

  if (!user) return null;

  return (
    <ToastProvider>
      <div className="flex h-screen flex-col overflow-hidden bg-bg">
        <Topbar
          userName={user.name}
          initials={user.initials}
          roleLabel={roleLabel(user.edition, user.role)}
          aliasTitle={user.title}
          editionLabel={editionLabel(user.edition)}
          theme={theme}
          onToggleTheme={toggleTheme}
          onLogout={logout}
          onMenu={() => setDrawerOpen(true)}
        />

        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Desktop rail — 190px, collapsing to a 52px icon rail under 900px. */}
          <aside className="sj-rail hidden w-[52px] min-w-[52px] shrink-0 overflow-y-auto overflow-x-hidden border-r border-line bg-sidebar sm:block min-[900px]:w-[190px] min-[900px]:min-w-[190px]">
            <Sidebar edition={user.edition} role={user.role} />
          </aside>

          {/* Mobile drawer */}
          {drawerOpen && (
            <div className="fixed inset-0 z-40 sm:hidden">
              <div
                className="absolute inset-0 bg-navy/40"
                onClick={() => setDrawerOpen(false)}
                aria-hidden="true"
              />
              <aside className="absolute left-0 top-0 flex h-full w-[260px] flex-col overflow-y-auto border-r border-line bg-sidebar">
                {/* `#sb-mobile-head` — the drawer's own titled header, so the
                    nav can be dismissed without hitting the backdrop. */}
                <div className="flex shrink-0 items-center justify-between border-b border-line-soft px-3.5 pb-2.5 pt-3.5">
                  <span className="text-ui font-semibold text-fg">Menu</span>
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(false)}
                    aria-label="Close menu"
                    className="rounded p-0.5 text-fg-muted hover:text-fg"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <Sidebar
                  edition={user.edition}
                  role={user.role}
                  onNavigate={() => setDrawerOpen(false)}
                />
              </aside>
            </div>
          )}

          {/* The content pane. `relative` is the frame <PanelFrame> pins itself
              to; screens that have not adopted it scroll this pane as before. */}
          <main className="relative min-h-0 min-w-0 flex-1 overflow-y-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
