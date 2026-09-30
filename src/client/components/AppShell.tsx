import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { JuryBuddyLauncher } from "../routes/help/JuryBuddyLauncher";
import { X } from "lucide-react";
import { Topbar } from "./Topbar";
import { Sidebar } from "./Sidebar";
import { NavIcon } from "./icons";
import { ToolbarLink } from "./PanelFrame";
import { ToastProvider } from "./Toast";
import { useAuth } from "../auth/useAuth";
import { usePermissions } from "../auth/usePermissions";
import { useTheme } from "../theme/useTheme";
import { roleLabel, editionLabel, type Edition, type Role } from "../../shared/roles";
import { canAccessNav, navIcon, navItemById, navLabel } from "../../shared/nav";

/**
 * The nav slug the client calls "the Dashboard". His own gloss on feedback row
 * 10 is *"Move to Dashboard (meaning the Uploaded screen)"*, and the uploaded
 * status screen is `alldecks` — see docs/plan_screening.md §2 C9.
 */
const DASHBOARD_NAV_ID = "alldecks";

/**
 * FEEDBACK ROW 10 (24-Sep) — "Move to Dashboard", on every sidebar screen.
 *
 * His justification is *"useful if a deck is moved to a wrong screen by
 * mistake"*, and that half of the ask has nothing to act on: screens here are
 * FILTERS, not locations. `matchesV3Stat(deck,"all")` is unconditionally true
 * (`src/shared/deckStats.ts:584-586`), Assign/Query membership is derived per
 * read, and no deck is ever removed from the uploaded screen — so there is no
 * "which screen is this deck on" to reset. The only thing that CAN be wrong is
 * the STAGE, and `restore` ("Restore", rejected|archived -> ai_evaluated,
 * `src/pipeline/incubator.ts:168-179`) already fixes that from the Dashboard row
 * menu. So this ships as what it literally says: a way back to the Dashboard
 * from wherever you are. His one universal — *"Move to Dashboard unaffected by
 * any status"* — is satisfied for free, because this control reads no deck.
 *
 * WHERE IT LIVES, and the cost of that choice. The prototype would put this
 * inside each screen's own `.tbr` toolbar strip, and `<PanelFrame>` already
 * takes an `actions` node — but only six route files have adopted PanelFrame;
 * QueryPage, AssignPage, ReviewScreen and the rest still hand-roll their
 * toolbar, and those files belong to other sessions. So it is ONE insertion in
 * the shell, above the content pane, which buys "on every screen" at the price
 * of a band above the screen's own toolbar rather than a button inside it. That
 * is a deliberate choice, not an oversight: a later parity pass that wants the
 * per-screen version can move it into each `.tbr` with <ToolbarLink>, which is
 * exported from PanelFrame.tsx for exactly that.
 *
 * Two rules the band follows:
 *  · It names the destination as THAT ROLE sees it — `navLabel` — so "Move to
 *    Dashboard" for the superuser, admin, PM and PA, "Move to My Pipeline" for
 *    the jury, "Move to All decks" in the VC edition. The alternative (his
 *    literal string for everyone) would promise a screen name that role's
 *    sidebar does not have. Whether the jury and VC sidebars should instead be
 *    RENAMED "Dashboard" is §8 Q16, and is not shipped: those two labels are
 *    prototype-sourced (`AISJ_IC_Jury_V4` says "My Pipeline", all six VC files
 *    say "All decks"), so renaming them is seven new `parity:nav` label rows
 *    whose waivers live in a file this session does not own.
 *  · It is hidden ON the Dashboard, where it would be a link to here. Nothing
 *    else suppresses it: no status, no stage, no screen.
 */
export function MoveToDashboardBar({ edition, role }: { edition: Edition; role: Role }) {
  const { pathname } = useLocation();
  const can = usePermissions();
  const item = navItemById(edition, DASHBOARD_NAV_ID);
  const here = /^\/app\/([^/]+)/.exec(pathname)?.[1];
  // `here === undefined` is `/app` itself, which only ever redirects.
  if (!item || here === undefined || here === DASHBOARD_NAV_ID) return null;
  // Reachability, not sidebar listing: a founder cannot reach `alldecks` at all,
  // and their portal must not offer a link into the staff register.
  if (!canAccessNav(edition, role, DASHBOARD_NAV_ID, can)) return null;
  return (
    <div className="flex shrink-0 items-center border-b border-line bg-surface px-4 py-1.5">
      <ToolbarLink to={`/app/${DASHBOARD_NAV_ID}`}>
        <NavIcon name={navIcon(role, item)} className="h-3.5 w-3.5" />
        Move to {navLabel(role, item)}
      </ToolbarLink>
    </div>
  );
}

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
      {/* `data-app-shell-frame` is the handle the Admin console overlay uses to
          mark this frame `inert` while it is open — see AdminConsole.tsx. Placed at
          Wave 1 integration; the console is portalled to <body>, so it is NOT a
          descendant of this div and is unaffected by the attribute. */}
      <div data-app-shell-frame className="flex h-screen flex-col overflow-hidden bg-bg">
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

          {/* The content side: the "Move to Dashboard" band (row 10) over the
              content pane. The band is OUTSIDE <main> deliberately — `.sj-frame`
              is `position:absolute; inset:0` within the pane, so anything drawn
              inside <main> alongside a PanelFrame screen would be covered by it. */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <MoveToDashboardBar edition={user.edition} role={user.role} />
            {/* The content pane. `relative` is the frame <PanelFrame> pins itself
                to; screens that have not adopted it scroll this pane as before. */}
            <main className="relative min-h-0 min-w-0 flex-1 overflow-y-auto">
              <Outlet />
            </main>
          </div>
        </div>
        {/* JURYbuddy's floating launcher — the form `Help_JURYbuddy.HTM` ships.
            Mounted at the shell, not per route, because the spec fixes it to the
            viewport; it gates itself to whoever reaches the `help` nav item. */}
        <JuryBuddyLauncher />
      </div>
    </ToastProvider>
  );
}
