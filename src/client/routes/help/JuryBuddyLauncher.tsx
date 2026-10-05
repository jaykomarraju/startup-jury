import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { canAccessNav } from "../../../shared/nav";
import { BareBody, HelpPage } from "./HelpPage";

/**
 * JURYbuddy's floating launcher — `#jb-launcher` + `#jb-panel` from
 * `Help_JURYbuddy.HTM`, which is the form the spec actually ships.
 *
 * S5-HELP built the panel as the `help` SCREEN and deliberately left this out,
 * on two grounds recorded in `docs/plan_v3_superuser.md`: that a fixed button on
 * every route would change how every other role's screens render, and that it
 * would "sit on top of the bottom-right controls the e2e suite clicks". The
 * first is true and is why this is gated below. **The second was checked and is
 * not so** — the only fixed elements in the app are bottom-CENTRE (`Toast.tsx`
 * at `inset-x-0 bottom-6`, and `setup/TeamStep.tsx` at `left-1/2
 * -translate-x-1/2`), and both sit at a higher z-index than this, so a toast
 * still covers the launcher rather than the other way round.
 *
 * ── The spec's geometry, kept; the spec's palette, not ───────────────────────
 * The client asked for the design to match in OUR colours. So the measurements
 * are the spec's — launcher 60px at `right:28 bottom:28`, panel 360px wide and
 * 520px tall at `bottom:100`, z-index 1000/999 — and the fills are ours.
 *
 * ── Why those numbers are now `sm:` ─────────────────────────────────────────
 * The spec is a 1440px console; it has no phone tier, and the numbers above
 * were measured there. Applied unconditionally they put an opaque 60px disc
 * 28px in from the corner of a 390px viewport, i.e. inside the content column,
 * not beside it: measured on production at iPhone 13 width it covers the deck
 * table's header row on `/app/alldecks` and the credit badge on the "Single
 * upload" row. So the spec's geometry moves behind `sm:` (≥640px — the same
 * tier at which the shell stops using the off-canvas drawer) and the phone tier
 * gets its own: a 44px disc — the smallest target that stays comfortably
 * tappable — in the 16px gutter the shell already reserves on every screen.
 * That shrinks the footprint from an 88×88 corner box to 60×60 and pulls it out
 * of the padding box. It does NOT make the overlap impossible: a floating
 * helper over a region that scrolls under it can only be fully cleared by
 * giving that region bottom padding, which lives in `PanelFrame` / `index.css`.
 *
 * The panel follows the launcher: on a phone it spans the two gutters instead
 * of claiming a fixed 360px (which leaves 2px of slack at 390px and clips
 * outright at the 360px widths below it) and caps its height against the
 * viewport rather than at a flat 520px.
 *
 * ── Who sees it ─────────────────────────────────────────────────────────────
 * Exactly whoever reaches the `help` nav item, via `canAccessNav`, which carries
 * the superuser bypass. That is deliberately the SAME predicate as the sidebar
 * entry rather than a second one: a launcher visible to someone whose sidebar
 * has no Help is a role-boundary bug of the kind this repo keeps producing, and
 * a founder in the portal must never see it.
 */
export function JuryBuddyLauncher() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape closes, as the spec's own handler does. Bound only while open so the
  // key stays free for every other screen's overlays.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!user) return null;
  if (!canAccessNav(user.edition, user.role, "help", () => true)) return null;

  return (
    <>
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="JURYbuddy FAQ search"
          data-testid="jb-panel"
          // `#jb-panel{right:28px; bottom:100px; width:360px; max-height:520px}`
          // from `sm:` up; gutter-to-gutter and viewport-capped below it.
          className="fixed bottom-[72px] left-4 right-4 z-[999] flex max-h-[70vh] flex-col overflow-hidden rounded-[14px] border border-line bg-surface shadow-2xl sm:bottom-[100px] sm:left-auto sm:right-7 sm:max-h-[520px] sm:w-[360px]"
        >
          <div className="flex shrink-0 items-center justify-between bg-fg px-4 py-3.5">
            <span className="text-sm font-bold text-accent">ai.STARTUPJURY</span>
            <span className="text-[11px] text-surface-2">FAQ search</span>
          </div>
          {/* `.jb-body{overflow-y:auto; flex:1}` — the panel scrolls, the page does not. */}
          <div className="flex-1 overflow-y-auto p-4">
            <BareBody.Provider value={true}>
              <HelpPage />
            </BareBody.Provider>
          </div>
        </div>
      )}
      <button
        type="button"
        aria-label={open ? "Close FAQ search" : "Open FAQ search"}
        aria-expanded={open}
        data-testid="jb-launcher"
        onClick={() => setOpen((v) => !v)}
        // `#jb-launcher{right:28px; bottom:28px; width:60px; height:60px;
        //  border-radius:50%; z-index:1000}` from `sm:` up — the tier the spec
        //  was measured on; 44px in the 16px gutter below it. `.jb-open` swaps
        //  the fill at both sizes.
        className={`fixed bottom-4 right-4 z-[1000] flex h-11 w-11 items-center justify-center rounded-full shadow-xl transition-colors sm:bottom-7 sm:right-7 sm:h-[60px] sm:w-[60px] ${
          open ? "bg-accent text-fg" : "bg-fg text-accent hover:opacity-90"
        }`}
      >
        {open ? (
          <X className="h-[18px] w-[18px] sm:h-[22px] sm:w-[22px]" />
        ) : (
          <Search className="h-[18px] w-[18px] sm:h-[22px] sm:w-[22px]" />
        )}
      </button>
    </>
  );
}
