// Shared presentational primitives for the report screens. Colours are index.css
// tokens; every chart is paired with a table or labels, so identity is never
// colour-alone. The Phase 7 generation (ReportShell, ReportBody, StatTiles,
// BarList, FunnelBars, Section, Narrative, DriftBars, Table) was deleted at Wave 9
// integration once `W9-D` took the last screen that used it — the VC funnel — off
// `IncubatorReports.tsx`. Build against the `.rep-*` / `.sc` families below; they
// are the prototype's own vocabulary, and a second generation is how this codebase
// grows two implementations of one thing.
import { useEffect, useState, type ReactNode } from "react";
import { Calendar, Download, type LucideIcon } from "lucide-react";
import { EmptyState, PanelFrame, ToolbarButton } from "../../components";
import { rubricBand } from "../../../shared/types";

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

// ═══════════════════════════════════════════════════════════════════════════
// W8-A — the prototype's report vocabulary, as its own components.
//
// Above this line only `useReport` remains, shared with `VcReports.tsx` (W9-D's).
// Two families here, because the prototypes have two:
//   · staff reports — `AISJ_IC_SuserV15/_style.css:1546-1579` `.rep-*`
//     (value-first KPI tiles, `.rep-card`, `.rep-bar-row`, `.rep-table`);
//   · jury reports — `AISJ_IC_Jury_V4/_rest.html:1439-1463` + `_style.css:64-68`
//     (`.sc` label-first tiles, `.rep-h`, `.rep-tbl`, `.rep-prow`, `.rep-axis`).
// Colours are index.css tokens; the primary is olive.
// ═══════════════════════════════════════════════════════════════════════════

export type ReportTone = "up" | "down" | "flat" | "good" | "warn" | "olive";

/** `.rep-up` / `.rep-dn` / `.rep-flat` and the inline delta colours the panels use. */
export const TONE_COLOR: Record<ReportTone, string> = {
  up: "var(--green)",
  down: "var(--red)",
  flat: "var(--text-3)",
  good: "var(--green)",
  warn: "var(--gold-dk)",
  olive: "var(--olive)",
};

export type ReportState<T> = { data: T | null; error: boolean; loading: boolean };

/**
 * Loading / error / disabled / empty guard for the W8-A reports. "Turned off"
 * and "no data" are different states and render differently — the drift
 * reports used to show the same "No drift data yet" for both.
 */
export function ReportGate<T>({
  state,
  icon,
  emptyTitle,
  emptyMessage,
  isEmpty,
  isDisabled,
  disabledTitle,
  disabledMessage,
  children,
}: {
  state: ReportState<T>;
  icon: string;
  emptyTitle: string;
  emptyMessage: string;
  isEmpty: (d: T) => boolean;
  isDisabled?: (d: T) => boolean;
  disabledTitle?: string;
  disabledMessage?: string;
  children: (d: T) => ReactNode;
}) {
  if (state.error) {
    return <EmptyState icon="ShieldAlert" title="Couldn't load this report" description="Try reloading the page." />;
  }
  if (state.loading || !state.data) return <p className="text-sm text-fg-muted">Loading…</p>;
  if (isDisabled?.(state.data)) {
    return (
      <div data-report-state="disabled">
        <EmptyState icon="Lock" title={disabledTitle ?? "This report is turned off"} description={disabledMessage} />
      </div>
    );
  }
  if (isEmpty(state.data)) {
    return (
      <div data-report-state="empty">
        <EmptyState icon={icon} title={emptyTitle} description={emptyMessage} />
      </div>
    );
  }
  return <>{children(state.data)}</>;
}

/** Staff report frame: the prototype's `.su-tb` toolbar over `.rep-scroll > .rep-wrap` (max 1080px). */
export function StaffReportFrame({
  title,
  subtitle,
  scope = "All cohorts",
  scopeTitle = "Reports cover every cohort in this workspace",
  children,
}: {
  title: string;
  subtitle: string;
  /** The `ti-calendar` scope chip. There is no cohort picker yet (F0800, §9), so it states the scope rather than pretending to change it. */
  scope?: string;
  /** W9-D — the chip's hover text. The default is the incubator's; a VC report states what ITS chip covers (a fund, a slate). */
  scopeTitle?: string;
  children: ReactNode;
}) {
  return (
    <PanelFrame
      title={title}
      subtitle={subtitle}
      flush
      actions={
        <>
          <span className="tbb cursor-default" title={scopeTitle}>
            <Calendar className="h-3.5 w-3.5" aria-hidden />
            {scope}
          </span>
          <ToolbarButton onClick={() => window.print()}>
            <Download className="h-3.5 w-3.5" aria-hidden />
            Export PDF
          </ToolbarButton>
        </>
      }
    >
      <div className="max-w-[1080px] px-[26px] py-[22px]">{children}</div>
    </PanelFrame>
  );
}

/** `.rep-meta` — the run descriptor, parts joined by the prototype's spaced dot. */
export function ReportMeta({ parts }: { parts: Array<string | null | false | undefined> }) {
  return (
    <p className="mb-[18px] text-[12px] text-fg-muted" data-testid="report-meta">
      {parts.filter(Boolean).join(" · ")}
    </p>
  );
}

/** `.rep-kpis` — auto-fit, 155px minimum, so five tiles share one row. */
export function RepKpis({ children }: { children: ReactNode }) {
  return <div className="mb-[22px] grid grid-cols-[repeat(auto-fit,minmax(155px,1fr))] gap-3">{children}</div>;
}

/** `.rep-kpi` — VALUE first (24px DM Mono), then the label, then an optional coloured delta. */
export function RepKpi({
  value,
  label,
  delta,
  tone = "flat",
}: {
  value: ReactNode;
  label: string;
  delta?: string;
  tone?: ReportTone;
}) {
  return (
    <div className="rounded-xl border border-stone-dk bg-surface px-[15px] py-[14px]" data-testid="rep-kpi">
      <div className="font-mono text-[24px] font-bold leading-[1.1] text-fg">{value}</div>
      <div className="mt-1 text-[11.5px] leading-[1.35] text-fg-muted">{label}</div>
      {delta && (
        <div className="mt-1.5 text-[11px] font-semibold" style={{ color: TONE_COLOR[tone] }}>
          {delta}
        </div>
      )}
    </div>
  );
}

/** `.rep-card` with its `.rep-card-h` olive-icon heading. */
export function RepCard({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: ReactNode }) {
  return (
    <section className="mb-[18px] rounded-[13px] border border-stone-dk bg-surface px-[18px] py-[17px]">
      <h2 className="mb-[15px] flex items-center gap-[7px] text-[13.5px] font-bold text-fg">
        <Icon className="h-4 w-4 text-olive" aria-hidden />
        {title}
      </h2>
      {children}
    </section>
  );
}

/** `.rep-2col` — two cards side by side, stacking under 820px. */
export function RepTwoCol({ children }: { children: ReactNode }) {
  return <div className="grid gap-[18px] min-[820px]:grid-cols-2">{children}</div>;
}

/**
 * `.rep-bar-row` — one line per row: label | 11px track | right-aligned mono
 * value. Widths are relative to the largest magnitude, as the panels draw them.
 */
export function RepBars({
  rows,
  max,
  valueWidth,
}: {
  rows: Array<{ label: string; magnitude: number; value: string; color?: string }>;
  /**
   * W9-D — the magnitude a FULL track stands for. Omitted, widths are relative
   * to the largest row (the incubator panels). The VC panels draw some bars
   * against a fixed whole instead: a mix against 100 %, capital against the fund.
   */
  max?: number;
  /** W9-D — the value column's width in px (default 40, `.rep-bar-row`'s). "₹140 Cr" does not fit in 40. */
  valueWidth?: number;
}) {
  const peak = max ?? Math.max(0, ...rows.map((r) => Math.abs(r.magnitude)));
  return (
    <div className="flex flex-col gap-[11px]" data-testid="rep-bars">
      {rows.map((r) => (
        <div
          key={r.label}
          className="grid grid-cols-[130px_1fr_40px] items-center gap-[11px] text-[12px] text-fg-2"
          style={valueWidth === undefined ? undefined : { gridTemplateColumns: `130px 1fr ${valueWidth}px` }}
          data-testid="rep-bar-row"
        >
          <span>{r.label}</span>
          <div className="h-[11px] overflow-hidden rounded-md bg-offwhite">
            <div
              className="h-full rounded-md"
              style={{
                width: `${peak === 0 ? 0 : Math.min(100, Math.round((Math.abs(r.magnitude) / peak) * 100))}%`,
                background: r.color ?? "var(--olive)",
              }}
            />
          </div>
          <span className="text-right font-mono font-semibold text-fg">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

/** `.rep-table` — 10.5px uppercase headers; `.nm` first column in ink. */
export function RepTable({
  cols,
  rows,
  nameCol = 0,
}: {
  cols: string[];
  rows: ReactNode[][];
  /** W9-D — which column is `.nm`. The Decision log leads with the date and names the company second. */
  nameCol?: number;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12.5px]">
        <thead>
          <tr>
            {cols.map((c) => (
              <th
                key={c}
                className="border-b border-stone-dk px-2.5 py-2 text-left text-[10.5px] font-bold uppercase tracking-[.04em] text-fg-muted"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-stone last:border-b-0">
              {r.map((cell, j) => (
                <td key={j} className={`px-2.5 py-2.5 ${j === nameCol ? "font-semibold text-fg" : "text-fg-2"}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** `.rep-score` — a DM Mono 700 score in ink. */
export function RepScore({ children }: { children: ReactNode }) {
  return <span className="font-mono font-bold text-fg">{children}</span>;
}

/** `.rep-up` / `.rep-dn` / `.rep-flat` — a signed mono figure. */
export function RepSigned({ tone, children }: { tone: ReportTone; children: ReactNode }) {
  return (
    <span className="font-mono font-semibold" style={{ color: TONE_COLOR[tone] }} data-tone={tone}>
      {children}
    </span>
  );
}

/** `.rep-pill.go / .hold / .no`. */
export function RepPill({ kind, children }: { kind: "go" | "hold" | "no"; children: ReactNode }) {
  const style = {
    go: "bg-green-lt text-green",
    hold: "bg-gold-lt text-gold-dk",
    no: "bg-red-lt text-red",
  }[kind];
  return (
    <span className={`inline-block rounded-full px-[9px] py-0.5 text-[10.5px] font-semibold ${style}`} data-pill={kind}>
      {children}
    </span>
  );
}

/** `.rep-note` — the offwhite reading note with a bold lead-in. */
export function RepNote({
  lead,
  icon: Icon,
  children,
}: {
  /** The incubator panels open every note with a bold lead; the VC panels do not. */
  lead?: string;
  /** W9-D — the VC panels' leading glyph: `ti-info-circle` for a reading, `ti-alert-triangle` for a warning. */
  icon?: LucideIcon;
  children: ReactNode;
}) {
  return (
    <p className="mt-1 rounded-[10px] bg-offwhite px-[15px] py-[13px] text-[12px] leading-[1.6] text-fg-2">
      {Icon && <Icon className="mr-1.5 inline h-3.5 w-3.5 align-[-2px]" aria-hidden />}
      {lead !== undefined && (
        <>
          <strong>{lead}</strong>{" "}
        </>
      )}
      {children}
    </p>
  );
}

/**
 * `panel-funnel.html` `.fn-wrap` — centred stage bars, each its own hue, the
 * count inside in DM Mono 17px, and a right rail of "% of uploaded" over the
 * red step loss.
 */
export function FunnelChart({
  rows,
  colors,
}: {
  rows: Array<{ label: string; count: number; pctOfTop: number; stepDrop: number | null }>;
  colors: string[];
}) {
  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-[9px] py-2" data-testid="funnel-chart">
      {rows.map((r, i) => (
        <div key={r.label} className="flex items-center gap-3.5" data-testid="funnel-row">
          <div className="w-[124px] shrink-0 text-right text-[12.5px] font-semibold text-fg">{r.label}</div>
          <div className="flex flex-1 justify-center">
            <div
              className="flex h-11 min-w-12 items-center justify-center rounded-[9px] font-mono text-[17px] font-bold text-white"
              style={{ width: `${r.pctOfTop}%`, background: colors[i % colors.length] }}
            >
              {r.count}
            </div>
          </div>
          <div className="w-[104px] shrink-0 text-[12.5px] font-bold text-fg-2">
            {r.pctOfTop}%
            {r.stepDrop !== null && (
              <small className="mt-px block text-[10px] font-semibold text-red">▼ {r.stepDrop}%</small>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Jury reports ───────────────────────────────────────────────────────────

/** Jury report frame: `.pnl-topbar` (title + subtitle, no actions — the jury prototype has no export) over `.pnl-scroll`. */
export function JuryReportFrame({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <PanelFrame title={title} subtitle={subtitle}>
      <div className="pb-[34px]">{children}</div>
    </PanelFrame>
  );
}

/** `.sr` with `repRenderDecks`' SRGRID: `repeat(auto-fit,minmax(150px,1fr))`. */
export function ScTiles({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-[9px]">{children}</div>;
}

/** `card(label,val,sub,col)` — `.sc`: uppercase label, 21px value in its meaning's colour, sub-label. */
export function ScTile({ label, value, sub, color }: { label: string; value: ReactNode; sub: string; color?: string }) {
  return (
    <div className="rounded-lg border border-stone-dk bg-surface px-[13px] py-[11px]" data-testid="sc-tile">
      <div className="mb-[3px] text-[9.5px] font-medium uppercase tracking-[.05em] text-fg-muted">{label}</div>
      <div className="text-[21px] font-semibold leading-none text-fg" style={color ? { color } : undefined}>
        {value}
      </div>
      <div className="mt-0.5 text-[10px] text-fg-muted">{sub}</div>
    </div>
  );
}

/** `.rep-h` — 13px uppercase olive-dk section heading over a 2px stone rule. */
export function RepH({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-3 mt-6 border-b-2 border-stone pb-1.5 text-[13px] font-bold uppercase tracking-[.05em] text-olive-dk">
      {children}
    </h2>
  );
}

/** `.rep-tbl` — the jury table: offwhite header strip, bordered, `.c` columns centred. */
export function RepTbl({ cols, center = [], rows }: { cols: string[]; center?: number[]; rows: ReactNode[][] }) {
  const align = (j: number) => (center.includes(j) ? "text-center" : "text-left");
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse overflow-hidden rounded-lg border border-stone-dk bg-surface text-[12.5px]">
        <thead>
          <tr>
            {cols.map((c, j) => (
              <th
                key={c}
                className={`border-b border-stone-dk bg-offwhite px-2.5 py-2 text-[10px] font-medium uppercase tracking-[.05em] text-fg-muted ${align(j)}`}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-stone last:border-b-0">
              {r.map((cell, j) => (
                <td key={j} className={`px-2.5 py-2 ${align(j)}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** `sname(d)` — bold name over the `.rep-ssec` sector line. */
export function StartupName({ name, sector }: { name: string; sector: string | null }) {
  return (
    <>
      <div className="font-semibold text-fg">{name}</div>
      {sector && <div className="text-[10.5px] text-fg-muted">{sector}</div>}
    </>
  );
}

/**
 * `rcol(v)` — the score colour. The jury prototype hand-codes its own cut-points
 * (≥8 / ≥6 / ≥5); W8-A reads the ONE band table instead, so a score's colour
 * here always agrees with its band everywhere else: 9–10 green, 7–8 olive,
 * 5–6 amber, below red (§8 Q106).
 */
export function scoreColor(v: number): string {
  const i = rubricBand(v).index;
  return i === 0 ? "var(--green)" : i === 1 ? "var(--olive)" : i === 2 ? "var(--amber)" : "var(--red)";
}

/** `.rep-num` — a DM Mono 600 figure, optionally coloured. */
export function RepNum({ color, children }: { color?: string; children: ReactNode }) {
  return (
    <span className="font-mono font-semibold" style={color ? { color } : undefined}>
      {children}
    </span>
  );
}

/** `.rep-prow` — "Status breakdown": dot, label, count, % and a track filled relative to the largest state. */
export function StatusBars({
  rows,
}: {
  rows: Array<{ label: string; count: number; pct: number; color: string }>;
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div data-testid="status-bars">
      {rows.map((r) => (
        <div key={r.label} className="mb-3" data-testid="status-bar">
          <div className="mb-[5px] flex items-center gap-[7px] text-[11.5px] text-fg-2">
            <span className="h-[9px] w-[9px] shrink-0 rounded-[3px]" style={{ background: r.color }} />
            {r.label}
            <b className="ml-auto font-mono text-fg">{r.count}</b>
            <small className="ml-1.5 font-mono text-fg-muted">{r.pct}%</small>
          </div>
          <div className="h-[9px] overflow-hidden rounded-[5px] bg-stone">
            <div
              className="h-full rounded-[5px]"
              style={{ width: `${Math.round((r.count / max) * 100)}%`, background: r.color }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Signed one-decimal delta with the prototype's colour rule: green above zero, red below, grey AT zero. */
export function signedTone(v: number): ReportTone {
  return v > 0 ? "up" : v < 0 ? "down" : "flat";
}

export function fmtSigned(v: number, dp = 1): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(dp)}`;
}

/** `.rep-drift-row` — name | a 22px axis track with a centre line and the bar either side | signed value. */
export function AxisDriftBars({ rows }: { rows: Array<{ name: string; drift: number }> }) {
  const maxAbs = Math.max(0, ...rows.map((r) => Math.abs(r.drift))) || 1;
  return (
    <div className="mt-3" data-testid="axis-drift">
      {rows.map((r) => {
        const color = TONE_COLOR[signedTone(r.drift)];
        const w = (Math.abs(r.drift) / maxAbs) * 50;
        return (
          <div key={r.name} className="mb-[9px] flex items-center gap-2.5 text-[12px]" data-testid="axis-drift-row">
            <div className="w-[130px] shrink-0 truncate font-semibold text-fg" title={r.name}>
              {r.name}
            </div>
            <div className="relative h-[22px] flex-1 rounded-md border border-stone bg-offwhite">
              <div className="absolute bottom-0 left-1/2 top-0 w-px bg-stone-dk" />
              <div
                className="absolute bottom-1 top-1 rounded-[3px]"
                style={{ [r.drift >= 0 ? "left" : "right"]: "50%", width: `${w}%`, background: color }}
              />
            </div>
            <div className="w-[50px] shrink-0 text-right font-mono font-semibold" style={{ color }}>
              {fmtSigned(r.drift)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

