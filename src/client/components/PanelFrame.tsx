import type { ReactNode } from "react";

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
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className={`min-w-0 flex-1 overflow-y-auto ${flush ? "" : "p-4"}`}>{children}</div>
        {rail && (
          <aside className="hidden w-[278px] min-w-[278px] shrink-0 overflow-y-auto border-l border-line bg-surface lg:block">
            {rail}
          </aside>
        )}
      </div>
      {footer && <div className="tb-foot">{footer}</div>}
    </section>
  );
}
