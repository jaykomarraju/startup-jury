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
import { BarChart3, Filter, Presentation, Signature, Table2, X } from "lucide-react";
import { ToolbarButton, type ParamScoreView, type ExtractionSlide } from "../components";
import { getDeck, getDeckReport, getMyAssignments, type DeckReportMatrix, type MyAssignment } from "../api";
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

// ── Per-evaluator scores ────────────────────────────────────────────────────

/**
 * The evaluation report matrix for each row on screen (`GET /api/decks/:id/report`).
 *
 * The deck list carries one averaged jury score; the prototype's score cells
 * show one number PER evaluator (`pipelineScoreCells`) and the jury's own
 * columns read their score and their additional parameters. The report is the
 * one read that already carries that, hierarchy-filtered for the viewer, so a
 * screen that needs it asks for its rows' reports rather than the server
 * growing a second shape. Only screens that opt in pay for it.
 */
export function useReportMatrices(deckIds: string[], enabled: boolean) {
  const [matrices, setMatrices] = useState<Record<string, DeckReportMatrix | null>>({});
  const key = enabled ? deckIds.join(",") : "";
  useEffect(() => {
    if (!key) return;
    let live = true;
    const wanted = key.split(",");
    Promise.all(
      wanted.map((id) =>
        getDeckReport(id)
          .then((m) => [id, m] as const)
          .catch(() => [id, null] as const),
      ),
    ).then((pairs) => {
      if (live) setMatrices((prev) => ({ ...prev, ...Object.fromEntries(pairs) }));
    });
    return () => {
      live = false;
    };
  }, [key]);
  return matrices;
}

/** `jaSparkCell` — the AI's per-parameter scores as a row of tiny bars. */
export function Sparkline({ values }: { values: number[] }) {
  if (values.length === 0) return <span className="font-mono text-sm text-fg-muted">—</span>;
  return (
    <span className="inline-flex h-5 items-end gap-px" aria-hidden="true">
      {values.map((v, i) => (
        <span
          key={i}
          className="w-[3px] rounded-sm"
          style={{ height: `${Math.max(10, (v / 10) * 100)}%`, background: scoreColor(v) }}
        />
      ))}
    </span>
  );
}

// ── R7-JURY · the cells the jury's own panels share ─────────────────────────
//
// `AISJ_IC_Jury_V4` draws the same four cells on three of its screens —
// `panel-jassigned` ("Parameter scores"), `panel-jurypipeline` ("Parameters
// score", "Addl. Parameters Score", "My score") and `panel-introcalls`. They
// were built once already, inside `CallsPage`, for the thirteen-column intro
// calls table; `jaSparkCell` and `jaAddlCell` are `window`-scoped in the
// prototype for exactly this reason. They live here now so `StagePage`,
// `CallsPage` and `EvaluatePage` draw the juror's numbers from ONE
// implementation rather than three.

/** `jaSparkCell` — the AI's core parameter values for one deck, rubric order. */
export function aiParamValues(matrix: DeckReportMatrix | null | undefined): number[] {
  return (matrix?.core ?? [])
    .map((row) => row.cells.ai?.value)
    .filter((v): v is number => typeof v === "number");
}

/** `jaSparkCell` — the clickable sparkline, opening the report's Core Parameters tab. */
export function ParamSparkCell({
  deck,
  matrix,
  onOpen,
}: {
  deck: DeckView;
  matrix: DeckReportMatrix | null | undefined;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      title="View AI parameter scores"
      aria-label={`AI parameter scores for ${deck.name}`}
      className="inline-flex items-center gap-1"
      onClick={onOpen}
    >
      <Sparkline values={aiParamValues(matrix)} />
      <BarChart3 className="h-3 w-3 text-fg-muted" aria-hidden="true" />
    </button>
  );
}

/**
 * `jaAddlCell` — the viewer's own three additional parameters as chips
 * (`CUSTOM_PARAMS`: Barriers of entry · Scalability · Industry growth), opening
 * the report's Addl. parameters tab. Lifted verbatim from `CallsPage`, which
 * now calls this.
 *
 * The button carries a STABLE `aria-label`, and that is load-bearing rather
 * than decoration. What it draws changes as the report lands — the "View
 * scores" fallback before, the viewer's chips after, and the chips' own text
 * once they arrive — so without a fixed name the only way to click this cell is
 * to name one of those states and race the fetch. `evaluate-stage-report` did
 * exactly that (`getByRole("button", { name: /View scores/ })`) and flaked for
 * it: measured alone on a drained box, the first attempt timed out after 120s
 * because the chips had legitimately replaced the fallback, and the retry
 * passed only by clicking inside the pre-fetch window. Name the cell, not its
 * current contents.
 */
export function MyAddlCell({
  deckName,
  viewerId,
  viewerRole,
  matrix,
  onOpen,
}: {
  deckName: string;
  viewerId?: string;
  viewerRole?: string;
  matrix: DeckReportMatrix | null | undefined;
  onOpen: () => void;
}) {
  const group = matrix?.additional?.find((g) => g.role === viewerRole);
  const mine = (group?.rows ?? [])
    .map((r) => ({ name: r.name, value: viewerId ? r.cells[viewerId]?.value : undefined }))
    .slice(0, 3);
  return (
    <button
      type="button"
      title="See each role's three additional parameters & scores"
      aria-label={`Additional parameter scores for ${deckName}`}
      className="flex flex-wrap items-center gap-1"
      onClick={onOpen}
    >
      {mine.length > 0 ? (
        mine.map((m) => (
          <span
            key={m.name}
            title={m.name}
            className="rounded-md bg-olive-lt px-1.5 py-0.5 font-mono text-[11px] font-semibold"
            style={{ color: m.value !== undefined ? scoreColor(m.value) : undefined }}
          >
            {m.value !== undefined ? m.value.toFixed(1) : "—"}
          </span>
        ))
      ) : (
        <span className="inline-flex items-center gap-1 rounded-md border border-line bg-olive-lt px-2 py-1 text-[11px] font-semibold text-olive-dk">
          <Table2 className="h-3 w-3" aria-hidden="true" /> View scores
        </span>
      )}
    </button>
  );
}

/**
 * The viewer's own evaluation of a deck, from the report matrix.
 *
 * `submittedAt` is the gate on the score, not the presence of the column: an
 * evaluator who holds the deck but has not scored it has a column with no
 * total, and the prototype's `My score` is blank until they submit.
 */
export function myEvaluation(
  matrix: DeckReportMatrix | null | undefined,
  viewerId?: string,
): { total?: number; submittedAt?: string } | undefined {
  // `columns?.` rather than `columns.` — a report that arrived without the key
  // (a truncated payload, an older stage layout) must leave the cell blank, not
  // throw inside a table cell and blank the whole screen.
  const me = matrix?.columns?.find((c) => c.kind === "human" && c.id === viewerId);
  if (!me) return undefined;
  return { total: me.submittedAt ? me.total : undefined, submittedAt: me.submittedAt };
}

/**
 * `jpDelta` — the Evaluated table's `+/- Days`: the submission measured against
 * the deadline. Negative reads "-3d early", zero "On time", positive "+4d
 * late", and a row with no due date or no submission has no delta at all.
 *
 * The two timestamps are whole days apart in intent (`dueAtFrom` adds days), so
 * the comparison is made on calendar days rather than on the raw millisecond
 * difference — a submission at 09:00 on the due date is "On time", not "-1d
 * early".
 */
export function dayDelta(dueAt?: string | null, submittedAt?: string | null): number | null {
  if (!dueAt || !submittedAt) return null;
  const due = Date.parse(dueAt);
  const sub = Date.parse(submittedAt);
  if (Number.isNaN(due) || Number.isNaN(sub)) return null;
  const day = 86_400_000;
  return Math.round(sub / day) - Math.round(due / day);
}

/** `jpDelta`'s chip — green early or on time, red late, a dash for neither. */
export function DeltaChip({ delta }: { delta: number | null }) {
  if (delta === null) return <span className="text-sm text-fg-muted">—</span>;
  const late = delta > 0;
  return (
    <span
      className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold"
      style={{
        background: late ? "var(--red-lt)" : "var(--green-lt)",
        color: late ? "var(--red)" : "var(--green)",
      }}
    >
      {delta === 0 ? "On time" : late ? `+${delta}d late` : `${delta}d early`}
    </span>
  );
}

/**
 * The caller's own `deck_assignments` rows, keyed by deck id
 * (`GET /api/assignments/mine`). Read by the jury screens that draw a Due date,
 * an Assigned by or a `+/- Days`.
 *
 * `null` until the first response, and an empty map if it fails. The two are
 * deliberately NOT distinguished on screen — a cell with no assignment reads
 * "—" either way — so the `catch` is here to stop a failed side read becoming
 * an unhandled rejection, not to drive a different rendering. Do not add an
 * error state to it without giving the screens something to draw for one.
 */
export function useMyAssignments(enabled: boolean): Record<string, MyAssignment> | null {
  const [rows, setRows] = useState<Record<string, MyAssignment> | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    getMyAssignments()
      .then((r) => {
        if (live) setRows(Object.fromEntries(r.assignments.map((a) => [a.deckId, a])));
      })
      .catch(() => {
        if (live) setRows({});
      });
    return () => {
      live = false;
    };
  }, [enabled]);
  return rows;
}
