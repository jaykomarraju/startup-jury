import { useEffect, useState } from "react";
import { X, Lock, Sparkles } from "lucide-react";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { getDeckReport, type DeckReportMatrix, type ReportColumn, type ReportRow } from "../api";

/**
 * The consolidated evaluation report (Aug-2026 issues 20, 21, 23 and 24).
 *
 * • 20 — one COLUMN PER EVALUATOR. The AI column is always there; a new column
 *        appears each time the deck passes into another pair of hands, so the
 *        report widens as it moves down the pipeline.
 * • 21 — the hierarchy. Evaluators above the viewer are filtered out **on the
 *        server**; this only has to say how many were withheld, so a program
 *        associate can see that the report is not the whole picture without
 *        seeing the numbers.
 * • 23 — the "Core Parameters" tab: the weighted core areas.
 * • 24 — the "Addl. parameters" tab: each owning role's three parameters.
 */

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function scoreColor(v: number): string {
  if (v >= 8) return "var(--color-signal-strong)";
  if (v >= 5) return "var(--color-signal-moderate)";
  if (v >= 2) return "var(--color-signal-weak)";
  return "var(--color-signal-absent)";
}

type Tab = "core" | "additional";

function ColumnHead({ col }: { col: ReportColumn }) {
  return (
    <th className="min-w-[7.5rem] px-3 py-2 text-center align-bottom">
      <div className="flex flex-col items-center gap-1">
        <span
          className={`flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold ${
            col.kind === "ai" ? "bg-accent/20 text-accent" : "bg-surface-2 text-fg"
          }`}
        >
          {col.kind === "ai" ? <Sparkles className="h-3.5 w-3.5" /> : (col.initials ?? "?")}
        </span>
        <span className="text-xs font-medium text-fg">{col.kind === "ai" ? "AI" : col.name}</span>
        {col.kind === "human" && (
          <span className="text-[10px] leading-tight text-fg-muted">
            {col.title ?? col.roleLabel}
          </span>
        )}
        {col.total !== undefined && (
          <span
            className="font-mono text-xs font-semibold"
            style={{ color: scoreColor(col.total) }}
          >
            {fmt(col.total)}/10
          </span>
        )}
      </div>
    </th>
  );
}

function Matrix({ columns, rows, showWeight }: { columns: ReportColumn[]; rows: ReportRow[]; showWeight: boolean }) {
  if (rows.length === 0) {
    return <p className="px-4 py-6 text-sm text-fg-muted">No parameters in this section.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-line">
            <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-fg-muted">
              Parameter
            </th>
            {showWeight && (
              <th className="px-2 py-2 text-center text-xs font-medium uppercase tracking-wide text-fg-muted">
                Weight
              </th>
            )}
            {columns.map((c) => (
              <ColumnHead key={c.id} col={c} />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-line/60 last:border-0">
              <td className="px-4 py-2.5 text-sm text-fg">{row.name}</td>
              {showWeight && (
                <td className="px-2 py-2.5 text-center font-mono text-xs text-fg-muted">
                  {row.weight}%
                </td>
              )}
              {columns.map((c) => {
                const cell = row.cells[c.id];
                return (
                  <td key={c.id} className="px-3 py-2.5 text-center" title={cell?.comment ?? undefined}>
                    {cell ? (
                      <span
                        className="font-mono text-sm font-semibold"
                        style={{ color: scoreColor(cell.value) }}
                      >
                        {fmt(cell.value)}
                      </span>
                    ) : (
                      <span className="text-sm text-fg-muted">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function EvaluationReportModal({
  deckId,
  deckName,
  onClose,
  initialTab = "core",
}: {
  deckId: string;
  deckName: string;
  onClose: () => void;
  initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [data, setData] = useState<DeckReportMatrix | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    getDeckReport(deckId)
      .then((r) => live && setData(r))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [deckId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const columns = data?.columns ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Evaluation report — ${deckName}`}
    >
      <div className="absolute inset-0 bg-navy/50" onClick={onClose} aria-hidden="true" />
      <div className="relative flex max-h-[86vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-xl">
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <div className="u-label">Evaluation report</div>
            <h2 className="mt-0.5 text-lg font-semibold text-fg">{deckName}</h2>
            <p className="mt-0.5 text-xs text-fg-muted">
              One column per evaluator — the report widens as the deck passes hands.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex gap-1 border-b border-line px-4" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "core"}
            onClick={() => setTab("core")}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              tab === "core" ? "border-amber font-medium text-fg" : "border-transparent text-fg-muted hover:text-fg"
            }`}
          >
            Core Parameters
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "additional"}
            onClick={() => setTab("additional")}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              tab === "additional"
                ? "border-amber font-medium text-fg"
                : "border-transparent text-fg-muted hover:text-fg"
            }`}
          >
            Addl. parameters
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {failed && <p className="px-4 py-6 text-sm text-fg-muted">Couldn&rsquo;t load the report.</p>}
          {!failed && !data && <p className="px-4 py-6 text-sm text-fg-muted">Loading report…</p>}

          {data && (
            <>
              {data.hiddenEvaluators > 0 && (
                <div className="m-4 flex items-start gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-xs text-fg-muted">
                  <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    {data.hiddenEvaluators} evaluator
                    {data.hiddenEvaluators === 1 ? "" : "s"} above you in the evaluation hierarchy
                    {data.hiddenEvaluators === 1 ? " has" : " have"} also scored this deck. Their
                    scores are not shown at your level.
                  </span>
                </div>
              )}

              {tab === "core" ? (
                /* Issue 23 — the Core Parameters tab. */
                <Matrix columns={columns} rows={data.core} showWeight />
              ) : (
                /* Issue 24 — the Addl. parameters tab, grouped by owning role. */
                <div className="flex flex-col">
                  {data.additional.length === 0 && (
                    <p className="px-4 py-6 text-sm text-fg-muted">
                      No additional parameters are configured for this workspace.
                    </p>
                  )}
                  {data.additional.map((group) => (
                    <section key={group.role} className="border-b border-line last:border-0">
                      <div className="flex items-center gap-2 bg-surface-2 px-4 py-2">
                        <span className="u-label">{group.roleLabel}</span>
                        <Badge tone="neutral">{group.rows.length} parameters</Badge>
                      </div>
                      <Matrix columns={columns} rows={group.rows} showWeight={false} />
                    </section>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
          <span className="text-xs text-fg-muted">
            Hover a score to read the evaluator&rsquo;s remark. Additional parameters are configured
            under My Parameters.
          </span>
          <Button size="sm" variant="secondary" onClick={onClose}>
            Done
          </Button>
        </footer>
      </div>
    </div>
  );
}
