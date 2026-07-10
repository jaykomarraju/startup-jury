import { Menu, Moon, Sun, LogOut } from "lucide-react";
import { Logo } from "./Logo";
import type { Theme } from "../theme/ThemeProvider";

interface TopbarProps {
  userName: string;
  initials: string;
  roleLabel: string;
  editionLabel: string;
  theme: Theme;
  onToggleTheme: () => void;
  onLogout: () => void;
  /** Show the mobile menu button (opens the sidebar drawer). */
  onMenu?: () => void;
}

/** Dark military-green top bar: logo + user identity, role badge, theme, logout. */
export function Topbar({
  userName,
  initials,
  roleLabel,
  editionLabel,
  theme,
  onToggleTheme,
  onLogout,
  onMenu,
}: TopbarProps) {
  return (
    <header className="flex h-14 items-center justify-between gap-3 border-b border-topbar-line bg-topbar px-4 text-topbar-fg">
      <div className="flex items-center gap-3">
        {onMenu && (
          <button
            type="button"
            onClick={onMenu}
            aria-label="Open menu"
            className="rounded-lg p-1.5 hover:bg-white/10 md:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
        )}
        <Logo size={26} />
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          className="rounded-lg p-2 text-topbar-fg/80 hover:bg-white/10 hover:text-topbar-fg"
        >
          {theme === "dark" ? <Sun className="h-4.5 w-4.5" /> : <Moon className="h-4.5 w-4.5" />}
        </button>

        <div className="hidden text-right sm:block">
          <div className="text-sm font-medium leading-tight">{userName}</div>
          <div className="flex items-center justify-end gap-1.5 leading-tight">
            <span className="text-[11px] text-topbar-fg/70">{editionLabel}</span>
            <span className="inline-flex items-center rounded-full bg-amber px-1.5 py-px text-[10px] font-semibold text-navy">
              {roleLabel}
            </span>
          </div>
        </div>

        <span
          className="flex h-8 w-8 items-center justify-center rounded-full bg-amber text-xs font-semibold text-navy"
          aria-hidden="true"
        >
          {initials}
        </span>

        <button
          type="button"
          onClick={onLogout}
          aria-label="Log out"
          className="rounded-lg p-2 text-topbar-fg/80 hover:bg-white/10 hover:text-topbar-fg"
        >
          <LogOut className="h-4.5 w-4.5" />
        </button>
      </div>
    </header>
  );
}
