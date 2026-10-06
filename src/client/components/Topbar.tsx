import { useEffect, useState } from "react";
import { Menu, Moon, Sun, LogOut } from "lucide-react";
import { Logo } from "./Logo";
import { NotificationBell } from "./NotificationBell";
import { useCoarsePointer } from "./PanelFrame";
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
            /* `p-2.5` under `sm` — 18px glyph in a 38px box. The drawer is the
               ONLY navigation a phone has (`.sj-rail` is `hidden sm:block`), so
               this is the first tap of every screen change on the call. */
            className="rounded-lg p-2.5 hover:bg-white/10 sm:hidden"
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
          className="rounded-md p-1.5 text-topbar-fg/65 hover:bg-white/10 hover:text-topbar-fg max-sm:p-2.5"
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

        <LogoutButton onLogout={onLogout} />
      </div>
    </header>
  );
}

/**
 * Log out — one click with a mouse, two taps with a thumb.
 *
 * MEASURED at 393x659: a 28x28 button whose left edge is 6px from the 27px
 * avatar, with no confirmation behind it. A mis-aimed thumb on stage ends the
 * session and the presenter signs in again in front of the room — the single
 * most expensive accidental tap in the product, which is why this one control
 * was called out (docs/plan_pilot_gcw.md §11, "tell the presenter").
 *
 * Under a finger the first tap ARMS and shows the word, and the second tap in
 * the next four seconds goes through; `(pointer: coarse)` is the gate, so a
 * laptop is byte-for-byte the behaviour it has today — one click, no arming,
 * no extra DOM. The 44px tap target, however, applies at both: it is
 * `max-sm:` padding, so the ribbon is unchanged at 640px and above, which the
 * geometry run at 1280/1440/1920 confirms.
 *
 * The armed state is carried by the `aria-label` and not by `aria-pressed`,
 * for two reasons. This is not a toggle — `aria-pressed` would announce it as
 * one, and it put a second `aria-pressed` button in the ribbon, which collided
 * with the stat tiles in this lane's own measurement harness on the first run.
 * And the visible "Sure?" is not announced at all while `aria-label` overrides
 * the content, so the label is the only place the state can be said out loud.
 * "Log out" stays the prefix, so a name match of either kind still finds it.
 */
function LogoutButton({ onLogout }: { onLogout: () => void }) {
  const coarse = useCoarsePointer();
  const [armed, setArmed] = useState(false);

  // Disarm on its own. An armed button left armed is a trap of its own kind:
  // the presenter taps something else, comes back minutes later, and one tap
  // signs them out.
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  return (
    <button
      type="button"
      onClick={() => {
        if (coarse && !armed) {
          setArmed(true);
          return;
        }
        onLogout();
      }}
      aria-label={armed ? "Log out — tap again to confirm" : "Log out"}
      title={armed ? "Tap again to log out" : "Log out"}
      className={`flex items-center gap-1 rounded-md p-1.5 hover:bg-white/10 hover:text-topbar-fg max-sm:p-2.5 ${
        armed ? "bg-white/20 text-topbar-fg" : "text-topbar-fg/65"
      }`}
    >
      <LogOut className="h-4 w-4" />
      {armed && <span className="text-meta font-semibold">Sure?</span>}
    </button>
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
