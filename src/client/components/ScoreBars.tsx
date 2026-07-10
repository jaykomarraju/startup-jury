import { signalTag, weightedTotal, type ParameterScore } from "../../shared/scoring";
import { SIGNAL_STYLES } from "../theme/signals";

export interface ParamScoreView extends ParameterScore {
  label: string;
}

/** A single 0–10 parameter bar, colored by its rubric band. */
export function ScoreBar({ label, value, weight }: ParamScoreView) {
  const band = signalTag(value);
  return (
    <div className="flex items-center gap-3">
      <span className="w-40 shrink-0 truncate text-xs text-fg-muted" title={label}>
        {label}
      </span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full"
          style={{ width: `${(value / 10) * 100}%`, background: SIGNAL_STYLES[band].color }}
        />
      </div>
      <span className="w-9 shrink-0 text-right font-mono text-xs font-medium text-fg">
        {value.toFixed(1)}
      </span>
      {weight !== undefined && (
        <span className="w-8 shrink-0 text-right text-[10px] text-fg-muted">×{weight}</span>
      )}
    </div>
  );
}

interface ScoreBarsProps {
  scores: ParamScoreView[];
  /** Override the computed weighted total (else derived from scores). */
  total?: number;
  showTotal?: boolean;
}

/** Per-parameter score bars with a weighted-total readout (DM Mono). */
export function ScoreBars({ scores, total, showTotal = true }: ScoreBarsProps) {
  const weighted = total ?? weightedTotal(scores);
  return (
    <div className="flex flex-col gap-2.5">
      {scores.map((s) => (
        <ScoreBar key={s.label} {...s} />
      ))}
      {showTotal && (
        <div className="mt-1 flex items-center justify-between border-t border-line pt-2.5">
          <span className="u-label">Weighted total</span>
          <span className="font-mono text-lg font-semibold text-amber">
            {weighted.toFixed(2)}
          </span>
        </div>
      )}
    </div>
  );
}
