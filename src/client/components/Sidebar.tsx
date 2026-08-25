import { useCallback, useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import type { Edition, Role } from "../../shared/roles";
import { navForUser, navLabel, NAV_SECTIONS, type NavItem } from "../../shared/nav";
import { NavIcon } from "./icons";

interface SidebarProps {
  edition: Edition;
  role: Role;
  /** Called after a nav item is clicked (e.g. to close the mobile drawer). */
  onNavigate?: () => void;
}

const COLLAPSE_KEY = "sj.sidebar.collapsed";

/** Sections the user has collapsed, remembered across visits. */
function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : []);
  } catch {
    return new Set();
  }
}

/**
 * Role-derived sidebar: sections in fixed order, active item highlighted.
 *
 * Aug-2026 issue 10 — the Settings items (Set up, My account, Admin console)
 * exist for every role that should have them, but the Evaluation section is long
 * enough on a Super User's sidebar to push them below the fold. Sections are now
 * COLLAPSIBLE (as in the prototype), and the choice is remembered, so the lower
 * sections are reachable without hunting for the scrollbar.
 */
export function Sidebar({ edition, role, onNavigate }: SidebarProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set<string>());

  useEffect(() => {
    setCollapsed(loadCollapsed());
  }, []);

  const toggle = useCallback((section: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next]));
      } catch {
        // A private-mode storage refusal must not break the nav.
      }
      return next;
    });
  }, []);

  const items = navForUser(edition, role);
  const bySection = new Map<string, NavItem[]>();
  for (const item of items) {
    const list = bySection.get(item.section) ?? [];
    list.push(item);
    bySection.set(item.section, list);
  }

  return (
    <nav aria-label="Primary" className="flex flex-col gap-4 px-3 py-4">
      {NAV_SECTIONS.filter((s) => bySection.has(s)).map((section) => {
        const isCollapsed = collapsed.has(section);
        return (
          <div key={section}>
            <button
              type="button"
              onClick={() => toggle(section)}
              aria-expanded={!isCollapsed}
              className="flex w-full items-center justify-between rounded px-2 pb-1.5 text-left hover:text-fg"
            >
              <span className="u-label">{section}</span>
              <ChevronDown
                className={`h-3.5 w-3.5 text-fg-muted transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
                aria-hidden="true"
              />
            </button>
            {!isCollapsed && (
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
            )}
          </div>
        );
      })}
    </nav>
  );
}
