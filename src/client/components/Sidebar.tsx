import { useCallback, useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import type { Edition, Role } from "../../shared/roles";
import { navForUser, navLabel, NAV_SECTIONS, type NavItem } from "../../shared/nav";
import { NavIcon } from "./icons";

/** A `.bx` count pill on a nav item. Tones mirror the prototype's badge family. */
export interface NavBadge {
  count: number;
  tone?: "blue" | "green" | "amber" | "red";
}

interface SidebarProps {
  edition: Edition;
  role: Role;
  /** Called after a nav item is clicked (e.g. to close the mobile drawer). */
  onNavigate?: () => void;
  /**
   * Counts to hang off nav items, keyed by nav id. The prototype ships two:
   * `All decks` carries a blue deck count in every one of the eleven role files,
   * and `Tickets` carries a live open-ticket count (`_scripts.js:3783`).
   */
  badges?: Readonly<Record<string, NavBadge>>;
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
 * True in the prototype's 52px icon-rail tier and below (`@media (max-width:900px)`).
 * That block ends with `.sb .sgrp.collapsed>.sgrp-body{display:block}` — with the
 * section headers gone there is no way to expand a group, so every group is
 * force-open and all the icons stay reachable.
 */
function useIconRail(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.("(max-width: 899px)");
    if (!mq) return;
    const sync = () => setOn(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return on;
}

const BADGE_TONE: Record<NonNullable<NavBadge["tone"]>, string> = {
  blue: "bx-b",
  green: "bx-g",
  amber: "bx-a",
  red: "bx-r",
};

/**
 * Role-derived sidebar: 190px rail, 11.5px items, 9px section labels — the
 * prototype's `.sb`/`.si`/`.sbl` density, not a roomy web nav. The active item
 * is olive (`.si.on`: olive-lt ground, olive-dk text, a 2.5px olive left rule),
 * which is the prototype's primary hue; gold is reserved for the logo.
 *
 * Aug-2026 issue 10 — the Settings items (Set up, My account, Admin console)
 * exist for every role that should have them, but the Evaluation section is long
 * enough on a Super User's sidebar to push them below the fold. Sections are
 * COLLAPSIBLE (as in the prototype), and the choice is remembered.
 *
 * The prototype force-expands the ancestors of the active item after every
 * navigation (`_scripts.js:222-229`), so a collapsed section can never hide
 * where the user currently is; this does the same.
 */
export function Sidebar({ edition, role, onNavigate, badges }: SidebarProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set<string>());
  const { pathname } = useLocation();
  const iconRail = useIconRail();

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

  // Which section holds the screen we are on.
  const activeId = /^\/app\/([^/]+)/.exec(pathname)?.[1];
  const activeSection = items.find((i) => i.id === activeId)?.section;

  const sections = NAV_SECTIONS.filter((s) => bySection.has(s));

  // `_scripts.js:222-229` — after every navigation the prototype walks up from
  // the newly-active item and un-collapses each ancestor group, so a section the
  // user collapsed can never hide where they now are. Done on route change only
  // (not on every render), so collapsing the section you are IN still works.
  useEffect(() => {
    if (!activeSection) return;
    setCollapsed((current) => {
      if (!current.has(activeSection)) return current;
      const next = new Set(current);
      next.delete(activeSection);
      return next;
    });
    // The stored preference is deliberately left alone: this is a visibility
    // rescue for the current visit, not the user changing their mind.
  }, [pathname, activeSection]);

  return (
    <nav aria-label="Primary" className="flex flex-col py-2.5 text-item">
      {sections.map((section, index) => {
        const isCollapsed = collapsed.has(section) && !iconRail;
        // `.sdiv` — a hairline between groups; `.sf` — Settings sits in its own
        // ruled block, which is what sets it apart in the prototype.
        const ruled = index > 0 ? "border-t border-line-soft" : "";
        const isSettings = section === "Settings";
        return (
          <div
            key={section}
            data-section={section}
            className={`px-3 ${ruled} ${isSettings ? "py-2.5" : "py-1.5"}`}
          >
            <button
              type="button"
              onClick={() => toggle(section)}
              aria-expanded={!isCollapsed}
              className="group flex w-full items-center justify-between gap-1 px-3 pb-1 text-left"
            >
              <span className="text-label font-medium uppercase tracking-[0.07em] text-fg-muted transition-colors group-hover:text-fg-2">
                {section}
              </span>
              <ChevronDown
                className={`h-3 w-3 text-fg-muted opacity-55 transition-transform group-hover:opacity-85 ${isCollapsed ? "-rotate-90" : ""}`}
                aria-hidden="true"
              />
            </button>
            {!isCollapsed && (
              <ul className="flex flex-col">
                {bySection.get(section)!.map((item) => {
                  const badge = badges?.[item.id];
                  return (
                    <li key={item.id}>
                      <NavLink
                        to={`/app/${item.id}`}
                        onClick={onNavigate}
                        className={({ isActive }) =>
                          `group flex items-center gap-[7px] border-l-[2.5px] py-1.5 pl-[9px] pr-3 transition-colors ${
                            isActive
                              ? "border-l-olive bg-sidebar-active font-medium text-olive-dk"
                              : "border-l-transparent text-fg-2 hover:bg-offwhite"
                          }`
                        }
                      >
                        {({ isActive }) => (
                          <>
                            <NavIcon
                              name={item.icon}
                              className={`h-[13px] w-[13px] shrink-0 ${isActive ? "opacity-100" : "opacity-70"}`}
                            />
                            <span className="truncate">{navLabel(role, item)}</span>
                            {badge && badge.count > 0 && (
                              <span className={`bx ${BADGE_TONE[badge.tone ?? "blue"]}`}>
                                {badge.count}
                              </span>
                            )}
                          </>
                        )}
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}
