import { useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Sparkles, RefreshCw } from "lucide-react";
import { Button } from "./Button";
import { Badge } from "./Badge";
import { SignalTag } from "./SignalTag";
import { DeckPdfViewer } from "./DeckPdfViewer";
import { ResearchMenu } from "./ResearchMenu";
import {
  DEFAULT_SCORING_SETTINGS,
  SCORE_SCALE_BOUNDS,
  blendScore,
  composite,
  formatScore,
  fromDisplayScale,
  overrideNeedsRationale,
  snapToScale,
  type ScoringSettings,
} from "../../shared/scoring";
import { rescoreDeck } from "../api";
import type { DeckView } from "../types";
import type { RubricParameter } from "../api";

/** The AI's per-parameter score + rationale, keyed by parameter key. */
export interface AiParamScore {
  value: number;
  comment?: string | null;
}

interface EvalScorecardProps {
  deck: DeckView;
  params: RubricParameter[];
  /** The caller's own role-scoped additional params (assistive; own average,
   *  NOT folded into the core-13 composite). Empty when the caller owns none. */
  additionalParams?: RubricParameter[];
  /** The juror's live 0–10 values, keyed by parameter key. */
  values: Record<string, number>;
  onChangeValue: (key: string, value: number) => void;
  remarks: string;
  onChangeRemarks: (v: string) => void;
  /** AI per-parameter breakdown (empty until the deck has been AI-evaluated). */
  aiScores: Map<string, AiParamScore>;
  /** AI weighted total (from the stored evaluation). */
  aiTotal?: number;
  /**
   * The org's scoring framework (admin console → Scoring framework). Governs
   * the 3-score view, the scale the sliders run on, and whether a score far
   * from the AI's needs a written rationale. Defaults to the shipped values so
   * a caller that has not loaded it behaves exactly as the prototype ships.
   */
  scoring?: ScoringSettings;
  /**
   * True when the server WITHHELD the AI breakdown because blind scoring is on
   * and this evaluator has not submitted yet — so the workbench says why rather
   * than showing an unexplained row of dashes.
   */
  aiWithheld?: boolean;
  /** Per-parameter rationale, keyed by parameter key (F0107). */
  comments?: Record<string, string>;
  onChangeComment?: (key: string, value: string) => void;
  /** Position in the assigned queue, for the "Deck X of N" affordance. */
  nav?: { index: number; total: number; onPrev: () => void; onNext: () => void };
  /** Called after a successful re-score so the page can reload. */
  onRescored?: () => void;
  /** Edition-specific decision buttons (Shortlist/Reject, or VC advance actions). */
  actions?: ReactNode;
  busy?: boolean;
  saved?: boolean;
  onSave: () => void;
}

/** Format a 0–10 score compactly: whole numbers plain, else one decimal. */
function fmtScore(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Colour a score by its rubric band (matches the signal hues). */
function scoreColor(v: number): string {
  if (v >= 8) return "var(--color-signal-strong)";
  if (v >= 5) return "var(--color-signal-moderate)";
  if (v >= 2) return "var(--color-signal-weak)";
  return "var(--color-signal-absent)";
}

const RESCORE_MESSAGES: Record<string, string> = {
  already_scored:
    "Already scored — nothing has changed since the last AI evaluation, so it won’t be re-scored.",
  no_pdf: "No stored PDF to re-score.",
  evaluation_failed: "The AI re-score didn’t complete. Try again shortly.",
  forbidden: "You don’t have permission to re-score this deck.",
  error: "Couldn’t re-score. Try again.",
};

/** Column headers — the AI and Avg columns vanish with the 3-score view. */
function ScoreHeader({ threeScore }: { threeScore: boolean }) {
  return (
    <div
      className={`grid items-center gap-x-4 border-b border-line bg-surface-2 px-3 py-2 ${
        threeScore ? "grid-cols-[1fr_auto_auto_auto]" : "grid-cols-[1fr_auto]"
      }`}
    >
      <span className="u-label">Parameter</span>
      {threeScore && <span className="u-label w-12 text-center">AI</span>}
      <span className="u-label w-32 text-center">My</span>
      {threeScore && <span className="u-label w-14 text-center">Avg</span>}
    </div>
  );
}

/**
 * One scoreable parameter.
 *
 * The slider runs on the org's configured **score scale** (F0167 / F0104): a
 * 1–5 workspace drags between 1 and 5 in half-steps, while the value this
 * component reports is always canonical 0–10, which is what every threshold,
 * band and stored score is expressed in.
 *
 * When "Require override rationale" is on and this score sits further than the
 * configured delta from the AI's, a rationale box appears and the server will
 * refuse the submit until it is filled (F0107) — the field the prototype's copy
 * implies but which had no counterpart anywhere in the build.
 */
function ScoreRow({
  param,
  ai,
  value,
  onChangeValue,
  comment,
  onChangeComment,
  scoring,
  threeScore,
  showWeight,
}: {
  param: RubricParameter;
  ai?: AiParamScore;
  value: number;
  onChangeValue: (key: string, value: number) => void;
  comment: string;
  onChangeComment?: (key: string, value: string) => void;
  scoring: ScoringSettings;
  threeScore: boolean;
  showWeight?: boolean;
}) {
  const bounds = SCORE_SCALE_BOUNDS[scoring.scoreScale];
  const shown = snapToScale(value, scoring.scoreScale);
  const avg = ai != null ? blendScore(ai.value, value, scoring.aiWeightPct) : null;
  const needsRationale =
    onChangeComment != null &&
    !comment.trim() &&
    overrideNeedsRationale(value, ai?.value, scoring);

  return (
    <div className="px-3 py-2.5">
      <div
        className={`grid items-center gap-x-4 ${
          threeScore ? "grid-cols-[1fr_auto_auto_auto]" : "grid-cols-[1fr_auto]"
        }`}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm text-fg">
            {param.name}
            {showWeight && <span className="text-[10px] text-fg-muted">·{param.weight}%</span>}
          </div>
          {threeScore && ai?.comment && (
            <div className="mt-0.5 flex items-start gap-1 text-xs text-fg-muted">
              <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-accent" aria-hidden="true" />
              <span className="italic">{ai.comment}</span>
            </div>
          )}
        </div>
        {threeScore && (
          <span
            className="w-12 text-center font-mono text-sm font-semibold"
            style={{ color: ai != null ? scoreColor(ai.value) : undefined }}
          >
            {ai != null ? formatScore(ai.value, scoring.scoreScale) : "–"}
          </span>
        )}
        <div className="flex w-32 items-center gap-2">
          <input
            type="range"
            min={bounds.min}
            max={bounds.max}
            step={bounds.step}
            value={shown}
            onChange={(e) =>
              onChangeValue(param.key, fromDisplayScale(Number(e.target.value), scoring.scoreScale))
            }
            className="w-24 accent-[var(--color-accent)]"
            aria-label={`My score for ${param.name}`}
          />
          <span className="w-7 text-right font-mono text-sm font-medium text-fg">
            {fmtScore(shown)}
          </span>
        </div>
        {threeScore && (
          <span className="w-14 text-center font-mono text-sm font-medium text-fg">
            {avg != null ? formatScore(avg, scoring.scoreScale) : "–"}
          </span>
        )}
      </div>
      {onChangeComment && (comment.trim() || needsRationale) && (
        <label className="mt-2 flex flex-col gap-1">
          <span className="text-[11px] font-medium text-fg-muted">
            {needsRationale ? (
              <span className="text-signal-flagged">
                Rationale required — your score is more than {scoring.overrideRationaleDelta} points
                from the AI&apos;s.
              </span>
            ) : (
              "Rationale"
            )}
          </span>
          <textarea
            className="sj-input min-h-[2.75rem] text-[12.5px]"
            value={comment}
            aria-label={`Rationale for ${param.name}`}
            onChange={(e) => onChangeComment(param.key, e.target.value)}
            placeholder="Why does your score differ from the AI's?"
          />
        </label>
      )}
    </div>
  );
}

/**
 * The shared evaluator workbench: in-app PDF viewer, per-parameter AI breakdown,
 * AI · My · Average columns (the Average updates live as the juror scores), the
 * Research button, deck X-of-N progress, and the AI rescore guard. Both the
 * incubator and VC evaluate screens render this with edition-specific actions.
 */
export function EvalScorecard({
  deck,
  params,
  additionalParams = [],
  values,
  onChangeValue,
  remarks,
  onChangeRemarks,
  aiScores,
  aiTotal,
  scoring = DEFAULT_SCORING_SETTINGS,
  aiWithheld,
  comments = {},
  onChangeComment,
  nav,
  onRescored,
  actions,
  busy,
  saved,
  onSave,
}: EvalScorecardProps) {
  const [rescoring, setRescoring] = useState(false);
  const [rescoreMsg, setRescoreMsg] = useState<{ tone: "info" | "success"; text: string } | null>(null);

  // Composites use the org's configured formula and AI/jury split, so the
  // numbers on this screen are the numbers the server will compute and the
  // shortlist floor will judge — not a second, hard-coded arithmetic.
  const myTotal = composite(
    params.map((p) => ({ weight: p.weight, value: values[p.key] ?? 0 })),
    scoring.compositeFormula,
  );
  const avgTotal = composite(
    params.map((p) => {
      const ai = aiScores.get(p.key)?.value;
      const my = values[p.key] ?? 0;
      return { weight: p.weight, value: ai != null ? blendScore(ai, my, scoring.aiWeightPct) : my };
    }),
    scoring.compositeFormula,
  );
  const scoredCount = params.filter((p) => values[p.key] != null).length;
  const hasAi = aiScores.size > 0 || aiTotal != null;
  // "Show 3-score view (AI · Mine · Average)". Off, the workbench shows the
  // evaluator their own score only.
  const threeScore = scoring.showThreeScoreView;
  const bounds = SCORE_SCALE_BOUNDS[scoring.scoreScale];
  const denom = `/${bounds.max}`;

  async function handleRescore() {
    setRescoring(true);
    setRescoreMsg(null);
    try {
      const outcome = await rescoreDeck(deck.id);
      if (outcome.ok) {
        setRescoreMsg({ tone: "success", text: "Re-scored — the AI breakdown has been refreshed." });
        onRescored?.();
      } else {
        setRescoreMsg({ tone: "info", text: RESCORE_MESSAGES[outcome.reason] ?? RESCORE_MESSAGES.error });
      }
    } finally {
      setRescoring(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Title row: deck identity + queue position + Research */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-fg">{deck.name}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
            {[deck.sector, deck.stage, deck.city].filter(Boolean).join(" · ")}
            {deck.signal && <SignalTag signal={deck.signal} />}
            {deck.status && <Badge tone="info">{deck.status}</Badge>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {nav && nav.total > 1 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={nav.onPrev}
                aria-label="Previous deck"
                className="rounded-md border border-line p-1 text-fg-muted hover:bg-surface-2"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="whitespace-nowrap font-mono text-xs text-fg-muted">
                Deck {nav.index + 1} of {nav.total}
              </span>
              <button
                type="button"
                onClick={nav.onNext}
                aria-label="Next deck"
                className="rounded-md border border-line p-1 text-fg-muted hover:bg-surface-2"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
          <ResearchMenu deck={{ name: deck.name, sector: deck.sector, stage: deck.stage, city: deck.city }} />
        </div>
      </div>

      {/* Blind scoring: the server withheld the AI breakdown, so say so. */}
      {aiWithheld && (
        <div
          className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-fg-muted"
          role="status"
        >
          <span className="font-medium text-fg">Blind scoring is on.</span> The AI&apos;s score for
          this deck is withheld until you submit your own — score it independently, then re-open it
          to compare.
        </div>
      )}

      {/* AI · My · Average summary tiles */}
      <div className={threeScore ? "grid grid-cols-3 gap-3" : "grid grid-cols-1 gap-3"}>
        {threeScore && (
          <div className="rounded-lg border border-line bg-surface-2 px-3 py-2.5">
            <div className="u-label">AI Score</div>
            <div
              className="font-mono text-2xl font-bold"
              style={{ color: aiTotal != null ? scoreColor(aiTotal) : undefined }}
            >
              {aiTotal != null ? formatScore(aiTotal, scoring.scoreScale) : "–"}
              <span className="text-sm font-normal text-fg-muted">{denom}</span>
            </div>
          </div>
        )}
        <div className="rounded-lg border border-accent/40 bg-accent/5 px-3 py-2.5">
          <div className="u-label">My Score</div>
          <div className="font-mono text-2xl font-bold text-accent">
            {formatScore(myTotal, scoring.scoreScale)}
            <span className="text-sm font-normal text-fg-muted">{denom}</span>
          </div>
          <div className="text-[10px] text-fg-muted">
            {scoredCount} of {params.length} parameters scored
          </div>
        </div>
        {threeScore && (
          <div className="rounded-lg border border-line bg-surface-2 px-3 py-2.5">
            <div className="u-label">Average</div>
            <div className="font-mono text-2xl font-bold text-fg">
              {hasAi ? formatScore(avgTotal, scoring.scoreScale) : "–"}
              <span className="text-sm font-normal text-fg-muted">{denom}</span>
            </div>
            <div className="text-[10px] text-fg-muted">
              {scoring.aiWeightPct}% AI · {100 - scoring.aiWeightPct}% jury, live
            </div>
          </div>
        )}
      </div>

      {/* In-app deck viewer */}
      <DeckPdfViewer deckId={deck.id} />

      {/* AI rescore guard */}
      {hasAi && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" disabled={rescoring} onClick={handleRescore}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${rescoring ? "animate-spin" : ""}`} />
            {rescoring ? "Re-scoring…" : "Re-run AI score"}
          </Button>
          {rescoreMsg && (
            <span
              className={`text-xs ${rescoreMsg.tone === "success" ? "text-signal-strong" : "text-fg-muted"}`}
              role="status"
            >
              {rescoreMsg.text}
            </span>
          )}
        </div>
      )}

      {/* AI · My · Average parameter table */}
      <div className="overflow-hidden rounded-lg border border-line">
        <ScoreHeader threeScore={threeScore} />
        <div className="divide-y divide-line">
          {params.map((p) => (
            <ScoreRow
              key={p.key}
              param={p}
              showWeight
              ai={aiScores.get(p.key)}
              value={values[p.key] ?? 5}
              onChangeValue={onChangeValue}
              comment={comments[p.key] ?? ""}
              onChangeComment={onChangeComment}
              scoring={scoring}
              threeScore={threeScore}
            />
          ))}
        </div>
      </div>

      {/* Role-scoped additional parameters — assistive, own average, NOT folded
          into the core-13 composite above. */}
      {additionalParams.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-dashed border-line">
          <div className="flex items-center justify-between border-b border-line bg-surface-2 px-3 py-2">
            <span className="u-label">Additional parameters · your lens</span>
            <span className="text-[10px] text-fg-muted">Assistive — not in the composite</span>
          </div>
          <ScoreHeader threeScore={threeScore} />
          <div className="divide-y divide-line">
            {additionalParams.map((p) => (
              <ScoreRow
                key={p.key}
                param={p}
                ai={aiScores.get(p.key)}
                value={values[p.key] ?? 5}
                onChangeValue={onChangeValue}
                comment={comments[p.key] ?? ""}
                onChangeComment={onChangeComment}
                scoring={scoring}
                threeScore={threeScore}
              />
            ))}
          </div>
        </div>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-fg-muted">Remarks (optional)</span>
        <textarea
          className="sj-input min-h-[4rem]"
          value={remarks}
          onChange={(e) => onChangeRemarks(e.target.value)}
          placeholder="Notes for the panel…"
        />
      </label>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="secondary" disabled={busy} onClick={onSave}>
            {busy ? "Saving…" : "Save scores"}
          </Button>
          {saved && <Badge tone="positive">Saved</Badge>}
        </div>
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </div>
    </div>
  );
}
