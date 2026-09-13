// W7-F — the pieces every pipeline stage screen shares with the call screens.
//
// The prototype draws its stage panels (`panel-jurypipeline`, `-forsignup`,
// `-incuration`, `-curation`, `-archive`, `-introcalls`) from one shape: the
// `.tb` toolbar strip with Filter and Export, the table, a pinned footer with a
// count sentence on the left and a colour legend on the right, and — on the
// screens that have one — a 382px slide-over that PUSHES the table narrower
// (`.su-side.open{width:382px}`) with Deck / All scores / Sign-up tabs.
//
// `StagePage` composes these from its config and `CallsPage` from its own, so
// both screens read as the same family and a later screen (Wave 9's VC stages)
// declares what it needs instead of re-deriving the markup.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { BarChart3, Filter, Presentation, Signature, X } from "lucide-react";
import { ToolbarButton, type ParamScoreView, type ExtractionSlide } from "../components";
import { getDeck } from "../api";
import type { DeckView } from "../types";

/** `jpColor` / `ncColor` / `suColor` — ≥8 green, ≥6 olive, else amber. */
export function scoreColor(v: number): string {
  return v >= 8 ? "var(--green)" : v >= 6 ? "var(--olive)" : "var(--amber)";
}

/** A number coloured by its score band, one decimal (`.jp-num`). */
export function BandScore({ value, suffix }: { value?: number; suffix?: string }) {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return <span className="font-mono text-sm text-fg-muted">—</span>;
  }
  return (
    <span className="font-mono text-sm font-semibold" style={{ color: scoreColor(value) }} data-band-score="">
      {value.toFixed(1)}
      {suffix && <small className="ml-px text-[10px] font-normal text-fg-muted">{suffix}</small>}
    </span>
  );
}

// ── Legend ──────────────────────────────────────────────────────────────────

export interface LegendItem {
  label: string;
  /** A CSS colour — prefer the prototype's own tokens (`var(--blue-dk)`). */
  color: string;
  /**
   * The status keys this entry decodes. When present, a status pill whose key
   * is listed is drawn in this colour, so the legend and the row badges can
   * never disagree (F0618). Omit for a legend that only names cell tints.
   */
  statuses?: string[];
}

/** The legend entry that decodes `key`, if any. */
export function legendFor(legend: LegendItem[] | undefined, key: string | undefined): LegendItem | undefined {
  if (!legend || !key) return undefined;
  return legend.find((l) => l.statuses?.includes(key));
}

/** A status pill tinted by its legend colour (`.jp-stat` / `.su-sustat`). */
export function LegendPill({ item, children }: { item?: LegendItem; children: ReactNode }) {
  if (!item) return <span className="text-sm text-fg-muted">{children}</span>;
  return (
    <span
      className="inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ color: item.color, background: `color-mix(in srgb, ${item.color} 13%, transparent)` }}
    >
      {children}
    </span>
  );
}

// ── Toolbar filter ──────────────────────────────────────────────────────────

export interface FilterOption<T> {
  id: string;
  label: string;
  match: (row: T) => boolean;
}

/**
 * The toolbar's `Filter` (`.tbb` with `ti-filter`). The prototype's button is
 * inert; this one opens a single-choice menu over the screen's own status
 * vocabulary — the same words its legend uses — and labels itself with the
 * active choice so a narrowed table is never mistaken for the whole stage.
 */
export function FilterMenu<T>({
  options,
  value,
  onChange,
}: {
  options: FilterOption<T>[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = options.find((o) => o.id === value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = (id: string | null) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <ToolbarButton aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Filter className="h-3 w-3" aria-hidden="true" />
        {active ? `Filter · ${active.label}` : "Filter"}
      </ToolbarButton>
      {open && (
        <div
          role="menu"
          aria-label="Filter rows"
          className="absolute right-0 top-full z-30 mt-1 min-w-44 rounded-lg border border-line bg-surface p-1 shadow-lg"
        >
          {[{ id: null as string | null, label: "All" }, ...options].map((o) => (
            <button
              key={o.id ?? "all"}
              type="button"
              role="menuitemradio"
              aria-checked={value === o.id}
              className={`block w-full rounded-md px-2.5 py-1.5 text-left text-xs hover:bg-surface-2 ${
                value === o.id ? "font-semibold text-fg" : "text-fg-muted"
              }`}
              onClick={() => choose(o.id)}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Footer ──────────────────────────────────────────────────────────────────

/** `.jp-foot` / `.su-foot` / `.nc-foot` — the count sentence and the legend. */
export function StageFooter({ stat, legend }: { stat?: string; legend?: LegendItem[] }) {
  if (!stat && !legend?.length) return null;
  return (
    <div className="tb-foot" data-testid="stage-footer">
      <span data-testid="stage-footer-stat">{stat}</span>
      {legend && legend.length > 0 && (
        <div className="flex flex-wrap items-center gap-3.5" data-testid="stage-legend">
          {legend.map((l) => (
            <span key={l.label} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: l.color }} aria-hidden="true" />
              {l.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Detail pane ─────────────────────────────────────────────────────────────

/** The built-in slide-over tabs. */
export type PaneTabId = "deck" | "scores" | "signup";

export const PANE_TAB_LABELS: Record<PaneTabId, string> = {
  deck: "Deck",
  scores: "All scores",
  signup: "Sign-up",
};

const PANE_TAB_ICONS: Record<PaneTabId, ReactNode> = {
  deck: <Presentation className="h-3.5 w-3.5" aria-hidden="true" />,
  scores: <BarChart3 className="h-3.5 w-3.5" aria-hidden="true" />,
  signup: <Signature className="h-3.5 w-3.5" aria-hidden="true" />,
};

export interface PaneTab {
  id: string;
  label: string;
  icon?: ReactNode;
}

/** Resolve a built-in tab id to its label and icon. */
export function builtinTab(id: PaneTabId): PaneTab {
  return { id, label: PANE_TAB_LABELS[id], icon: PANE_TAB_ICONS[id] };
}

/**
 * The 382px slide-over (`.su-side` / `.nc-side`). It is a sibling of the table
 * rather than an overlay, so opening it narrows the table instead of covering
 * it (F0632). With one tab it draws the tab's name as a label, as
 * `panel-jurypipeline`'s single "Pitch deck" pane does; with more, a tab strip.
 */
export function DetailPane({
  title,
  meta,
  tabs,
  active,
  onTab,
  onClose,
  headerAction,
  children,
}: {
  title: string;
  meta?: string;
  tabs: PaneTab[];
  active: string;
  onTab: (id: string) => void;
  onClose: () => void;
  headerAction?: ReactNode;
  children: ReactNode;
}) {
  return (
    <aside
      aria-label={`${title} detail`}
      data-testid="stage-pane"
      className="flex w-[382px] min-w-[382px] shrink-0 flex-col overflow-hidden border-l border-line bg-surface max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:z-40 max-md:w-[88%] max-md:min-w-0 max-md:shadow-xl"
    >
      <div className="flex items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-fg">{title}</div>
          {meta && <div className="mt-0.5 truncate text-[11px] text-fg-muted">{meta}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {headerAction}
          <button type="button" aria-label="Close" className="text-fg-muted hover:text-fg" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      {tabs.length > 1 ? (
        <div role="tablist" aria-label={`${title} detail`} className="flex border-b border-line px-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active === t.id}
              className={`-mb-px flex items-center gap-1 border-b-2 px-3 py-2 text-xs font-medium ${
                active === t.id ? "border-olive text-fg" : "border-transparent text-fg-muted hover:text-fg"
              }`}
              onClick={() => onTab(t.id)}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      ) : (
        tabs[0] && (
          <div className="flex items-center gap-1 border-b border-line px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
            {tabs[0].icon}
            {tabs[0].id === "deck" ? "Pitch deck" : tabs[0].label}
          </div>
        )
      )}
      <div role={tabs.length > 1 ? "tabpanel" : undefined} className="min-h-0 flex-1 overflow-y-auto p-4">
        {children}
      </div>
    </aside>
  );
}

/** The AI evaluation behind a pane — loaded once per opened deck. */
export function usePaneEvaluation(deckId: string | null) {
  const [data, setData] = useState<{ deckId: string; scores: ParamScoreView[]; extraction: ExtractionSlide[] } | null>(
    null,
  );
  useEffect(() => {
    if (!deckId) return;
    let live = true;
    getDeck(deckId)
      .then((r) => live && setData({ deckId, scores: r.scores, extraction: r.extraction }))
      .catch(() => live && setData({ deckId, scores: [], extraction: [] }));
    return () => {
      live = false;
    };
  }, [deckId]);
  // Never show the previous deck's evaluation under the next deck's name.
  return data && data.deckId === deckId ? data : null;
}

/** Deck tab — the slides the extraction read (`.su-slide`). */
export function DeckSlides({ extraction }: { extraction: ExtractionSlide[] | null }) {
  if (extraction === null) return <p className="text-xs text-fg-muted">Loading…</p>;
  if (extraction.length === 0) {
    return <p className="text-xs text-fg-muted">No slides were extracted from this deck yet.</p>;
  }
  return (
    <div className="flex flex-col gap-2.5" data-testid="pane-deck">
      {extraction.map((s, i) => (
        <div key={`${s.label}-${i}`} className="rounded-lg border border-line p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">{s.label}</div>
          {s.heading && <div className="mt-0.5 text-sm font-semibold text-fg">{s.heading}</div>}
          <p className={`mt-1 text-xs ${s.missing ? "italic text-fg-muted" : "text-fg"}`}>{s.text}</p>
        </div>
      ))}
    </div>
  );
}

/** All scores tab — two big numbers, then one weighted bar per parameter. */
export function AllScores({ deck, scores }: { deck: DeckView; scores: ParamScoreView[] | null }) {
  // Weights are stored on whatever scale the rubric uses; the prototype prints
  // each as its share of the whole ("Weight 12%").
  const totalWeight = (scores ?? []).reduce((sum, s) => sum + (s.weight > 0 ? s.weight : 0), 0);
  return (
    <div className="flex flex-col gap-3" data-testid="pane-scores">
      <div className="grid grid-cols-2 gap-3 rounded-lg bg-surface-2 p-3">
        <div>
          <div className="font-mono text-2xl font-semibold text-fg">{deck.aiScore?.toFixed(1) ?? "—"}</div>
          <div className="text-[10px] uppercase tracking-wide text-fg-muted">AI composite</div>
        </div>
        <div>
          <div className="font-mono text-2xl font-semibold" style={{ color: "var(--gold-dk)" }}>
            {deck.juryScore?.toFixed(1) ?? "—"}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-fg-muted">Jury avg.</div>
        </div>
      </div>
      {scores === null ? (
        <p className="text-xs text-fg-muted">Loading…</p>
      ) : scores.length === 0 ? (
        <p className="text-xs text-fg-muted">No parameter scores yet.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {scores.map((s, i) => (
            <li key={s.key ?? s.label} className="grid grid-cols-[1.25rem_1fr_4.5rem_2rem] items-center gap-2">
              <span className="font-mono text-[10px] text-fg-muted">{i + 1}</span>
              <span className="min-w-0 text-xs text-fg">
                <span className="block truncate">{s.label}</span>
                <b className="block text-[10px] font-medium text-fg-muted">Weight {totalWeight > 0 ? Math.round((Math.max(s.weight, 0) / totalWeight) * 100) : 0}%</b>
              </span>
              <span className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${(s.value / 10) * 100}%`, background: scoreColor(s.value) }}
                />
              </span>
              <span className="text-right font-mono text-xs font-semibold" style={{ color: scoreColor(s.value) }}>
                {s.value.toFixed(1)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
