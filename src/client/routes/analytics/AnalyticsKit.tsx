// Shared presentational primitives for the Phase 7 report screens. All marks use
// the design tokens (amber accent for magnitude, signal hues for score bands, a
// green/red diverging pair for drift), thin rounded bars anchored to a baseline,
// recessive grid, and text in ink tokens — never the series color. Every chart is
// paired with a table/labels so identity is never colour-alone.
import { useEffect, useState, type ReactNode } from "react";
import { Card, Button, KpiTile, EmptyState } from "../../components";

/** Fetch-and-render lifecycle shared by every report screen. */
export function useReport<T>(fetcher: () => Promise<T>): {
  data: T | null;
  error: boolean;
  loading: boolean;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    setData(null);
    setError(false);
    fetcher()
      .then((d) => live && setData(d))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, []);
  return { data, error, loading: data === null && !error };
}

interface ReportShellProps {
  title: string;
  subtitle: string;
  context?: string;
  caption?: string;
  children: ReactNode;
}

/** Report page frame: title + subtitle, a context chip, an Export affordance, and
 *  a descriptor caption line — mirrors the prototype report header. */
export function ReportShell({ title, subtitle, context, caption, children }: ReportShellProps) {
  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-fg">{title}</h1>
          <p className="mt-0.5 max-w-2xl text-sm text-fg-muted">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {context && (
            <span className="rounded-full border border-line px-3 py-1 text-xs font-medium text-fg-muted">
              {context}
            </span>
          )}
          <Button variant="secondary" size="sm">Export PDF</Button>
        </div>
      </div>
      {caption && (
        <p className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-fg-muted">{caption}</p>
      )}
      {children}
    </div>
  );
}

/** Loading / error / empty guard. Renders `children(data)` only when loaded. */
export function ReportBody<T>({
  state,
  title,
  icon,
  isEmpty,
  emptyMessage,
  children,
}: {
  state: { data: T | null; error: boolean; loading: boolean };
  title: string;
  icon: string;
  isEmpty?: (d: T) => boolean;
  emptyMessage?: string;
  children: (d: T) => ReactNode;
}) {
  if (state.error) {
    return (
      <Card>
        <EmptyState icon="ShieldAlert" title={`Couldn't load ${title}`} description="Try reloading the page." />
      </Card>
    );
  }
  if (state.loading || !state.data) {
    return <p className="text-sm text-fg-muted">Loading…</p>;
  }
  if (isEmpty?.(state.data)) {
    return (
      <Card>
        <EmptyState icon={icon} title={`No ${title} yet`} description={emptyMessage ?? "Data will appear here once decks are evaluated."} />
      </Card>
    );
  }
  return <>{children(state.data)}</>;
}

/** KPI tile row (2–4 tiles). */
export function StatTiles({ stats }: { stats: Array<{ label: string; value: string | number; sublabel?: string }> }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {stats.map((s, i) => (
        <KpiTile key={s.label} label={s.label} value={s.value} sublabel={s.sublabel} active={i === 0} />
      ))}
    </div>
  );
}

const ACCENT = "var(--color-accent)";

/** Horizontal magnitude bars (single hue), each row labelled with its value. */
export function BarList({
  items,
  max,
  color = ACCENT,
  unit = "",
}: {
  items: Array<{ label: string; value: number; sub?: string; color?: string }>;
  max?: number;
  color?: string;
  unit?: string;
}) {
  const peak = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="flex flex-col gap-2.5">
      {items.map((i) => (
        <div key={i.label}>
          <div className="flex items-center justify-between text-xs">
            <span className="text-fg">{i.label}</span>
            <span className="font-mono text-fg-muted">
              {i.sub ?? `${i.value}${unit}`}
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.max(2, (i.value / peak) * 100)}%`, background: i.color ?? color }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Funnel bars — full-width stage bars scaled to the top count, with step %. */
export function FunnelBars({ rows, top }: { rows: Array<{ label: string; count: number; pctOfTop: number; stepConversion: number | null }>; top: number }) {
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-3">
          <div className="w-28 shrink-0 text-xs text-fg">{r.label}</div>
          <div className="relative h-7 flex-1 overflow-hidden rounded-md bg-surface-2">
            <div
              className="flex h-full items-center rounded-md px-2"
              style={{ width: `${Math.max(6, top === 0 ? 0 : (r.count / top) * 100)}%`, background: "var(--color-deepgreen)" }}
            >
              <span className="font-mono text-xs font-semibold text-white">{r.count}</span>
            </div>
          </div>
          <div className="w-24 shrink-0 text-right text-xs text-fg-muted">
            {r.pctOfTop}%{r.stepConversion !== null && <span className="ml-1 text-fg-muted/70">· {r.stepConversion}%</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

const POS = "var(--color-positive)";
const NEG = "var(--color-signal-flagged)";

/** Diverging drift bars centred on zero (positive = green, negative = red). */
export function DriftBars({ rows }: { rows: Array<{ name: string; drift: number }> }) {
  const peak = Math.max(0.1, ...rows.map((r) => Math.abs(r.drift)));
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => {
        const w = (Math.abs(r.drift) / peak) * 50;
        const positive = r.drift >= 0;
        return (
          <div key={r.name} className="flex items-center gap-3">
            <div className="w-32 shrink-0 truncate text-xs text-fg">{r.name}</div>
            <div className="relative flex h-4 flex-1 items-center">
              <div className="absolute left-1/2 top-0 h-full w-px bg-line" />
              <div
                className="absolute h-2.5 rounded-full"
                style={{
                  width: `${w}%`,
                  [positive ? "left" : "right"]: "50%",
                  background: positive ? POS : NEG,
                }}
              />
            </div>
            <div className="w-14 shrink-0 text-right font-mono text-xs" style={{ color: positive ? POS : NEG }}>
              {r.drift > 0 ? "+" : ""}
              {r.drift.toFixed(1)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Titled card wrapper for a chart / table section. */
export function Section({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <div className="u-label">{title}</div>
      <div className="mt-3">{children}</div>
    </Card>
  );
}

/** The AI-read narrative box shown at the foot of each report. */
export function Narrative({ children }: { children: ReactNode }) {
  return (
    <Card className="border-l-2 border-l-amber">
      <div className="u-label text-amber">AI read</div>
      <p className="mt-2 text-sm leading-relaxed text-fg">{children}</p>
    </Card>
  );
}

/** Minimal report table. `cols` are header labels; `rows` are cell arrays. */
export function Table({ cols, rows }: { cols: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] text-left text-sm">
        <thead>
          <tr className="text-fg-muted">
            {cols.map((c) => (
              <th key={c} className="px-3 py-2 text-xs font-medium uppercase tracking-wide">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line">
              {r.map((cell, j) => (
                <td key={j} className="px-3 py-2 text-fg">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
