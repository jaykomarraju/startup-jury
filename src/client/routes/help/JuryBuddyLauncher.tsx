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
          className="fixed bottom-[100px] right-7 z-[999] flex max-h-[520px] w-[360px] flex-col overflow-hidden rounded-[14px] border border-line bg-surface shadow-2xl"
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
        //  border-radius:50%; z-index:1000}` — and `.jb-open` swaps the fill.
        className={`fixed bottom-7 right-7 z-[1000] flex h-[60px] w-[60px] items-center justify-center rounded-full shadow-xl transition-colors ${
          open ? "bg-accent text-fg" : "bg-fg text-accent hover:opacity-90"
        }`}
      >
        {open ? <X className="h-[22px] w-[22px]" /> : <Search className="h-[22px] w-[22px]" />}
      </button>
    </>
  );
}
