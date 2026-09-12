import { Menu, Moon, Sun, LogOut } from "lucide-react";
import { Logo } from "./Logo";
import { NotificationBell } from "./NotificationBell";
import type { Theme } from "../theme/ThemeProvider";

interface TopbarProps {
  userName: string;
  initials: string;
  roleLabel: string;
  /**
   * Organizational ALIAS title (Aug-2026 issue 1). When set it takes the ribbon's
   * badge and the platform role is shown quietly beside it, so the underlying
   * role stays visible to the person while the org's own title leads.
   */
  aliasTitle?: string;
  editionLabel: string;
  theme: Theme;
  onToggleTheme: () => void;
  onLogout: () => void;
  /** Show the mobile menu button (opens the sidebar drawer). */
  onMenu?: () => void;
}

/**
 * The brand ribbon (prototype `.an`): 54px, olive-dark, borderless, with the
 * logo and tagline on the left and the identity block, role pill and avatar on
 * the right. It stays olive in dark mode — the prototype's dark block overrides
 * every other token but deliberately not `--olive-dk`, so the ribbon never
 * becomes an unbranded near-black bar.
 */
export function Topbar({
  userName,
  initials,
  roleLabel,
  aliasTitle,
  editionLabel,
  theme,
  onToggleTheme,
  onLogout,
  onMenu,
}: TopbarProps) {
  return (
    <header className="flex h-[54px] shrink-0 items-center justify-between gap-3 bg-topbar pl-4 pr-4 text-topbar-fg">
      <div className="flex min-w-0 items-center gap-2.5">
        {onMenu && (
          <button
            type="button"
            onClick={onMenu}
            aria-label="Open menu"
            className="rounded-lg p-1.5 hover:bg-white/10 sm:hidden"
          >
            <Menu className="h-4.5 w-4.5" />
          </button>
        )}
        <Logo size={32} tagline="Venture Intelligence First" />
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          className="rounded-md p-1.5 text-topbar-fg/65 hover:bg-white/10 hover:text-topbar-fg"
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>

        <div className="hidden text-right leading-[1.2] sm:block">
          <div className="text-ui font-semibold">{userName}</div>
          <div className="flex items-center justify-end gap-1.5">
            <span className="text-meta text-topbar-fg/60">{editionLabel}</span>
            {aliasTitle ? (
              <>
                <RolePill title={`Platform role: ${roleLabel}`}>{aliasTitle}</RolePill>
                {/* Only worth repeating when the org calls the role something
                    else — otherwise the ribbon would say the same thing twice. */}
                {aliasTitle !== roleLabel && (
                  <span className="text-meta text-topbar-fg/50">{roleLabel}</span>
                )}
              </>
            ) : (
              <RolePill>{roleLabel}</RolePill>
            )}
          </div>
        </div>

        {/* `.nb` — the prototype's bell, in its own position in the cluster
            (after the identity block, before the avatar). W3-B owns the
            component; this is the mount point and nothing else. */}
        <NotificationBell />

        {/* `.nav-av` — 27px, purple. Gold is the logo's, not the avatar's. */}
        <span
          className="flex h-[27px] w-[27px] items-center justify-center rounded-full bg-purple text-meta font-semibold text-white"
          aria-hidden="true"
        >
          {initials}
        </span>

        <button
          type="button"
          onClick={onLogout}
          aria-label="Log out"
          className="rounded-md p-1.5 text-topbar-fg/65 hover:bg-white/10 hover:text-topbar-fg"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}

/**
 * `.nrp.r-adm` — a translucent tinted pill on the ribbon, not a solid gold chip.
 *
 * The prototype's identity block is name + role pill only; this one still
 * carries the edition beside it, because `e2e/nav.spec.ts:42` asserts the
 * edition label is visible for all eleven role walks. Dropping it is F0373 and
 * belongs to whichever session owns that assertion — see §9.
 */
function RolePill({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="mt-0.5 inline-flex items-center rounded-full bg-white/15 px-2 py-px text-meta font-medium text-white/90"
    >
      {children}
    </span>
  );
}
