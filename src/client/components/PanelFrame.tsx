import { useEffect, useState, type ReactNode } from "react";
import { Link, type LinkProps } from "react-router-dom";

/**
 * The prototype's surface toolbar (`.tb`, `_style.css:60-68`) and the fixed
 * panel frame it heads.
 *
 * Every prototype screen is a fixed frame: a white bordered toolbar strip
 * pinned to the top holding the title, subtitle and actions; the data region
 * scrolling between it and an optional pinned footer carrying the row count and
 * the colour legend; and, on the screens that use one, a 278px right rail
 * scrolling on its own axis (`.rp`). This application instead put a 20px `<h1>`
 * on the page background and let the whole page scroll, so the toolbar and the
 * legend scrolled away from a long table.
 *
 * `<PageToolbar>` is the strip on its own — usable by a screen that is not
 * ready to adopt the whole frame. `<PanelFrame>` is the frame.
 */

/**
 * Is the pointer driving this session a FINGER?
 *
 * Two chrome behaviours fork on this — the deck lightbox's tap-to-dismiss
 * (`DeckPdfViewer.tsx`) and the ribbon's two-tap Log out (`Topbar.tsx`) — and
 * both fork on the POINTER, not on a width, because what they are about is
 * stray clicks. A mouse produces them (a slipped drag, a double-click's second
 * half); a finger does not — there is no pointer travelling between targets, so
 * every tap is aimed. `(pointer: coarse)` is the same capability gate
 * `@media (hover: hover)` uses for the two `.tbb` hover rules in index.css.
 *
 * It lives in this file because this is the module the chrome primitives
 * already share (`<PageToolbar>`, `<ToolbarButton>`, `<ToolbarLink>`), and a
 * new file for ten lines would be a file no other lane in this wave could see.
 * `matchMedia?.` is optional because jsdom test trees stub it per suite and
 * some do not define it at all; the hook then answers `false`, which is the
 * desktop behaviour and the right default.
 */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.("(pointer: coarse)");
    if (!mq) return;
    const sync = () => setCoarse(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return coarse;
}

interface PageToolbarProps {
  /** `.tbt` — 13.5px/600. */
  title: ReactNode;
  /** `.tbs` — 10.5px muted. */
  subtitle?: ReactNode;
  /** `.tbr` — right-aligned action group (use `<ToolbarButton>`). */
  actions?: ReactNode;
  className?: string;
}

export function PageToolbar({ title, subtitle, actions, className }: PageToolbarProps) {
  return (
    <div className={`tb ${className ?? ""}`}>
      <div className="min-w-0">
        <h1 className="tbt truncate">{title}</h1>
        {subtitle !== undefined && subtitle !== null && <div className="tbs">{subtitle}</div>}
      </div>
      {actions && <div className="tbr">{actions}</div>}
    </div>
  );
}

interface ToolbarButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** `.tbb.pr` — the olive primary action. */
  primary?: boolean;
  children: ReactNode;
}

/** `.tbb` — an 11px toolbar action. Primary is olive, not gold. */
export function ToolbarButton({ primary, className, children, ...rest }: ToolbarButtonProps) {
  return (
    <button type="button" className={`tbb ${primary ? "pr" : ""} ${className ?? ""}`} {...rest}>
      {children}
    </button>
  );
}

interface ToolbarLinkProps extends LinkProps {
  /** `.tbb.pr` — the olive primary action. */
  primary?: boolean;
}

/**
 * `.tbb` as a NAVIGATION — visually the same 11px toolbar action, but a real
 * anchor, so ⌘-click, middle-click and "copy link" all behave. Added for the
 * shell's "Move to Dashboard" control (S2-CHROME, feedback row 10); it lives
 * here so that when a later parity pass moves that control down into each
 * screen's own `.tbr` strip, the strip already has the right primitive.
 */
export function ToolbarLink({ primary, className, children, ...rest }: ToolbarLinkProps) {
  return (
    <Link className={`tbb ${primary ? "pr" : ""} ${className ?? ""}`} {...rest}>
      {children}
    </Link>
  );
}

interface PanelFrameProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** `.su-foot` — pinned under the scrolling body (row count + legend). */
  footer?: ReactNode;
  /** `.rp` — the 278px right rail, scrolling independently of the body. */
  rail?: ReactNode;
  /** Drop the body's default padding for an edge-to-edge table. */
  flush?: boolean;
  children: ReactNode;
}

/**
 * A screen wrapped in this fills the shell's content pane and scrolls only its
 * own body — the toolbar and footer stay put. Screens that have not adopted it
 * keep scrolling `<main>` exactly as before, so adoption is per-screen.
 */
export function PanelFrame({
  title,
  subtitle,
  actions,
  footer,
  rail,
  flush,
  children,
}: PanelFrameProps) {
  return (
    <section className="sj-frame">
      <PageToolbar title={title} subtitle={subtitle} actions={actions} />
      {/* ── Where the rail goes on a phone ────────────────────────────────────
          Under `lg` this row was a two-column flex whose second column was
          `hidden`, so the rail's content did not exist on screen at all below
          1024px. MEASURED on the Dashboard at 393x659: Pipeline progress, the
          Cohort rating thresholds (including the two editable threshold inputs
          and "Save & apply to all evaluators") and the Activity log were all in
          the DOM with `display: none` — three panels and an editing surface,
          silently unreachable on the demo device.

          So the row becomes a COLUMN below `lg` and the rail falls to the end
          of it, under the body. One instance, moved by CSS, not a second copy:
          rendering `{rail}` twice behind breakpoint classes would put two
          "Best threshold" inputs in the accessibility tree at every width, and
          every `getByLabel` in the suite would go ambiguous.

          The scroll container moves with it. At `lg` the row is
          `overflow-hidden` and the body and rail each scroll on their own axis,
          which is the prototype's frame and is unchanged. Below `lg` the row
          itself scrolls, because a body with its own `overflow-y` would scroll
          the rail off the bottom of a region that never reaches it. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <div className={`min-w-0 flex-1 lg:overflow-y-auto ${flush ? "" : "p-4"}`}>{children}</div>
        {rail && (
          <aside className="shrink-0 border-t border-line bg-surface lg:w-[278px] lg:min-w-[278px] lg:overflow-y-auto lg:border-l lg:border-t-0">
            {rail}
          </aside>
        )}
      </div>
      {footer && <div className="tb-foot">{footer}</div>}
    </section>
  );
}
