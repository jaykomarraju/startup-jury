import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { X, Lock, Sparkles, CheckCircle2, PencilLine } from "lucide-react";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { scoreColor } from "./ScoreBars";
import {
  getDeckReport,
  type DeckReportMatrix,
  type ReportColumn,
  type ReportGroup,
  type ReportRow,
} from "../api";
import { formatScore, scaleMax } from "../../shared/scoring";
import type { ScoreScale } from "../../shared/types";
import {
  REPORT_STAGE_LABELS,
  reportStageForScreen,
  type ReportSectionMode,
  type ReportStage,
} from "../../shared/reportStage";

/**
 * The consolidated evaluation report (Aug-2026 issues 20, 21, 23 and 24), made
 * stage-aware by W7-D (incubator spec §8.4).
 *
 * • 20 — one COLUMN PER EVALUATOR. The AI column is always there; a new column
 *        appears each time the deck passes into another pair of hands, so the
 *        report widens as it moves down the pipeline.
 * • 21 — the hierarchy. Evaluators above the viewer are filtered out **on the
 *        server**; this only has to say how many were withheld, so a program
 *        associate can see that the report is not the whole picture without
 *        seeing the numbers.
 * • 23 — the "Core Parameters" tab: the weighted core areas.
 * • 24 — the "Addl. parameters" tab: the role sections.
 * • §8.4 — WHICH role sections that tab carries depends on the screen the
 *        report was opened from: Assign → Program associate + Program manager;
 *        Intro calls → PA + PM + Jury (the jury's read-only, "completed");
 *        anywhere else → the viewer's own role. The screen is read from the
 *        route, exactly as the prototype reads it from the visible panel — a
 *        caller never has to remember to pass it. `stage` overrides that.
 *
 * Every number is stored canonical 0–10 and printed on the org's scale, and
 * coloured by its rubric band (`scoreColor`, derived from `RUBRIC_BANDS`).
 */

type Tab = "core" | "additional";

function ColumnHead({ col, scale }: { col: ReportColumn; scale: ScoreScale }) {
  return (
    <th className="min-w-[7.5rem] px-3 py-2 text-center align-bottom">
      <div className="flex flex-col items-center gap-1">
        <span
          className={`flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold ${
            col.kind === "ai" ? "bg-olive-lt text-olive-dk" : "bg-surface-2 text-fg-2"
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
            {formatScore(col.total, scale)}/{scaleMax(scale)}
          </span>
        )}
      </div>
    </th>
  );
}

function Matrix({
  columns,
  rows,
  showWeight,
  scale,
}: {
  columns: ReportColumn[];
  rows: ReportRow[];
  showWeight: boolean;
  scale: ScoreScale;
}) {
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
              <ColumnHead key={c.id} col={c} scale={scale} />
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
                        {formatScore(cell.value, scale)}
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

/** The small print beside a section title — the prototype's `<small>` copy, per mode. */
function SectionMode({ mode, submitted }: { mode: ReportSectionMode; submitted: boolean }) {
  if (mode === "completed") {
    return (
      <span className="flex items-center gap-1.5 text-[11px] text-fg-muted">
        3 additional parameters · completed by jury
        {submitted && (
          <Badge tone="positive">
            <CheckCircle2 className="mr-1 inline h-3 w-3" />
            Submitted
          </Badge>
        )}
      </span>
    );
  }
  if (mode === "read_only") {
    return (
      <span className="flex items-center gap-1 text-[11px] text-fg-muted">
        <Lock className="h-3 w-3" aria-hidden="true" />3 additional parameters · read only
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[11px] text-olive-dk">
      <PencilLine className="h-3 w-3" aria-hidden="true" />3 additional parameters · yours to score
    </span>
  );
}

function RoleSection({
  group,
  columns,
  scale,
}: {
  group: ReportGroup;
  columns: ReportColumn[];
  scale: ScoreScale;
}) {
  const mode = group.mode ?? "read_only";
  const submitted = group.rows.some((r) => Object.keys(r.cells).some((id) => id !== "ai"));
  return (
    <section
      className="border-b border-line last:border-0"
      aria-label={`${group.roleLabel} parameters`}
      data-mode={mode}
    >
      <div className="flex flex-wrap items-center gap-2 bg-surface-2 px-4 py-2">
        <span className="u-label">{group.roleLabel} parameters</span>
        <SectionMode mode={mode} submitted={submitted} />
      </div>
      <Matrix columns={columns} rows={group.rows} showWeight={false} scale={scale} />
    </section>
  );
}

export function EvaluationReportModal({
  deckId,
  deckName,
  onClose,
  initialTab = "core",
  stage,
}: {
  deckId: string;
  deckName: string;
  onClose: () => void;
  initialTab?: Tab;
  /** The stage to lay the report out for. Omitted, it is the screen it opens on. */
  stage?: ReportStage;
}) {
  const { navId } = useParams();
  const effectiveStage = stage ?? reportStageForScreen(navId);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [data, setData] = useState<DeckReportMatrix | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    getDeckReport(deckId, effectiveStage)
      .then((r) => live && setData(r))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [deckId, effectiveStage]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const columns = data?.columns ?? [];
  const scale: ScoreScale = data?.scoring?.scoreScale ?? "0-10";
  const shownStage = data?.stage ?? effectiveStage;

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
            <div className="flex items-center gap-2">
              <span className="u-label">Evaluation report</span>
              {data?.stageAware !== false && (
                <span
                  className="inline-flex items-center rounded-full bg-surface-2 px-[7px] py-px text-meta font-medium text-fg-muted ring-1 ring-line"
                  data-testid="report-stage"
                >
                  {REPORT_STAGE_LABELS[shownStage]} stage
                </span>
              )}
            </div>
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
              tab === "core" ? "border-olive font-medium text-olive-dk" : "border-transparent text-fg-muted hover:text-fg-2"
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
                ? "border-olive font-medium text-olive-dk"
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
              {data.aiScoreWithheld && (
                <div
                  className="m-4 flex items-start gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-xs text-fg-muted"
                  data-testid="report-ai-withheld"
                >
                  <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    Blind scoring is on — the AI column appears once you submit your own evaluation
                    for this deck.
                  </span>
                </div>
              )}

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
                <Matrix columns={columns} rows={data.core} showWeight scale={scale} />
              ) : (
                /* Issue 24 + §8.4 — the role sections this stage carries. */
                <div className="flex flex-col">
                  {data.additional.length === 0 && (
                    <p className="px-4 py-6 text-sm text-fg-muted">
                      No additional parameters are configured for this workspace.
                    </p>
                  )}
                  {data.additional.map((group) => (
                    <RoleSection key={group.role} group={group} columns={columns} scale={scale} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
          <span className="text-xs text-fg-muted">
            Hover a score to read the evaluator&rsquo;s remark. Your own parameters are scored in the
            evaluation workbench; additional parameters are configured under My Parameters.
          </span>
          <Button size="sm" variant="secondary" onClick={onClose}>
            Done
          </Button>
        </footer>
      </div>
    </div>
  );
}
