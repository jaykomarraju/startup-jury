import { useEffect, useState } from "react";
import {
  DEFAULT_SCORING_SETTINGS,
  composite,
  formatScore,
  signalTag,
  toDisplayScale,
  type ParameterScore,
  type ScoringSettings,
} from "../../shared/scoring";
import type { CompositeFormula } from "../../shared/types";
import { SIGNAL_STYLES } from "../theme/signals";
import { scoringSettings } from "../routes/admin/scoringApi";

export interface ParamScoreView extends ParameterScore {
  label: string;
  /** Rubric parameter key (present on live API scores; used for joins). */
  key?: string;
  /** AI (or evaluator) one-line rationale, shown on hover as the breakdown. */
  comment?: string | null;
}

/**
 * The colour of a canonical 0–10 score — its rubric band's colour.
 *
 * W7-D (§9, Wave 2 integration): `EvalScorecard` and `EvaluationReport` each
 * carried a private copy of the RETIRED four-band cut-points (≥8 / ≥5 / ≥2), so
 * a 7.0 was painted Moderate beside a pill that said Strong. This is the one
 * copy, and it holds no cut-points of its own: `signalTag` reads `RUBRIC_BANDS`.
 */
export function scoreColor(value: number): string {
  return SIGNAL_STYLES[signalTag(value)].color;
}

/** The label a composite goes by, per the org's formula — never "weighted" for a median. */
export const COMPOSITE_LABELS: Record<CompositeFormula, string> = {
  weighted_average: "Weighted total",
  unweighted_average: "Average",
  median: "Median",
};

type ScaleSettings = Pick<ScoringSettings, "compositeFormula" | "scoreScale">;

/**
 * The org's composite formula and score scale, for a component that was not
 * handed them. Reads the per-session cache the workbench already fills, and
 * renders the shipped defaults until (or unless) it answers.
 */
function useScaleSettings(given: ScaleSettings | undefined): ScaleSettings {
  const [loaded, setLoaded] = useState<ScaleSettings | null>(null);
  useEffect(() => {
    if (given) return;
    let live = true;
    // Deferred so a synchronous throw (no `fetch` at all) lands in the catch.
    Promise.resolve()
      .then(scoringSettings)
      .then((s) => live && setLoaded(s))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [given]);
  return given ?? loaded ?? DEFAULT_SCORING_SETTINGS;
}

/** A single parameter bar, coloured by its rubric band, labelled on the org's scale. */
export function ScoreBar({
  label,
  value,
  weight,
  comment,
  scale = "0-10",
}: ParamScoreView & { scale?: ScoringSettings["scoreScale"] }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className="w-40 shrink-0 truncate text-xs text-fg-muted"
        title={comment ? `${label} — ${comment}` : label}
      >
        {label}
      </span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full"
          style={{ width: `${(value / 10) * 100}%`, background: scoreColor(value) }}
        />
      </div>
      <span className="w-9 shrink-0 text-right font-mono text-xs font-medium text-fg">
        {scale === "0-10" ? value.toFixed(1) : formatScore(value, scale)}
      </span>
      {weight !== undefined && (
        <span className="w-8 shrink-0 text-right text-[10px] text-fg-muted">×{weight}</span>
      )}
    </div>
  );
}

interface ScoreBarsProps {
  scores: ParamScoreView[];
  /** Override the computed composite (canonical 0–10; else derived from scores). */
  total?: number;
  showTotal?: boolean;
  /**
   * The org's composite formula and score scale. Omitted, the component reads
   * them itself — a caller that forgets must not get a weighted average under
   * a median org's label (W7-D, §9).
   */
  scoring?: ScaleSettings;
}

/** Per-parameter score bars with the composite readout (DM Mono). */
export function ScoreBars({ scores, total, showTotal = true, scoring }: ScoreBarsProps) {
  const { compositeFormula, scoreScale } = useScaleSettings(scoring);
  const canonical = total ?? composite(scores, compositeFormula);
  const shown = toDisplayScale(canonical, scoreScale);
  return (
    <div className="flex flex-col gap-2.5">
      {/* `key` is destructured out on purpose: a score carries the PARAMETER
          key (Session 1, so the client can join scores to the rubric), and
          spreading it into JSX makes React read it as the reconciliation key
          and warn. The React key is the parameter key where we have one. */}
      {scores.map(({ key, ...bar }) => (
        <ScoreBar key={key ?? bar.label} {...bar} scale={scoreScale} />
      ))}
      {showTotal && (
        <div className="mt-1 flex items-center justify-between border-t border-line pt-2.5">
          <span className="u-label">{COMPOSITE_LABELS[compositeFormula]}</span>
          <span className="font-mono text-lg font-semibold text-amber">
            {shown.toFixed(scoreScale === "0-100" ? 0 : 2)}
          </span>
        </div>
      )}
    </div>
  );
}
