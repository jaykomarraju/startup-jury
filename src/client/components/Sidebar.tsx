import { NavLink } from "react-router-dom";
import type { Edition, Role } from "../../shared/roles";
import { navForUser, navLabel, NAV_SECTIONS, type NavItem } from "../../shared/nav";
import { NavIcon } from "./icons";

interface SidebarProps {
  edition: Edition;
  role: Role;
  /** Called after a nav item is clicked (e.g. to close the mobile drawer). */
  onNavigate?: () => void;
}

/** Role-derived sidebar: sections in fixed order, active item highlighted. */
export function Sidebar({ edition, role, onNavigate }: SidebarProps) {
  const items = navForUser(edition, role);
  const bySection = new Map<string, NavItem[]>();
  for (const item of items) {
    const list = bySection.get(item.section) ?? [];
    list.push(item);
    bySection.set(item.section, list);
  }

  return (
    <nav aria-label="Primary" className="flex flex-col gap-5 px-3 py-4">
      {NAV_SECTIONS.filter((s) => bySection.has(s)).map((section) => (
        <div key={section}>
          <div className="u-label px-2 pb-1.5">{section}</div>
          <ul className="flex flex-col gap-0.5">
            {bySection.get(section)!.map((item) => (
              <li key={item.id}>
                <NavLink
                  to={`/app/${item.id}`}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    `group flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors ${
                      isActive
                        ? "bg-sidebar-active font-medium text-fg ring-1 ring-amber/25"
                        : "text-fg-muted hover:bg-surface-2 hover:text-fg"
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span
                        aria-hidden="true"
                        className={`-ml-2 h-5 w-0.5 rounded-full ${isActive ? "bg-amber" : "bg-transparent"}`}
                      />
                      <NavIcon
                        name={item.icon}
                        className={`h-4 w-4 shrink-0 ${isActive ? "text-amber" : ""}`}
                      />
                      <span className="truncate">{navLabel(role, item)}</span>
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
