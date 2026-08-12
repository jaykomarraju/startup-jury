import { useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Sparkles, RefreshCw } from "lucide-react";
import { Button } from "./Button";
import { Badge } from "./Badge";
import { SignalTag } from "./SignalTag";
import { DeckPdfViewer } from "./DeckPdfViewer";
import { ResearchMenu } from "./ResearchMenu";
import { weightedTotal } from "../../shared/scoring";
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
  nav,
  onRescored,
  actions,
  busy,
  saved,
  onSave,
}: EvalScorecardProps) {
  const [rescoring, setRescoring] = useState(false);
  const [rescoreMsg, setRescoreMsg] = useState<{ tone: "info" | "success"; text: string } | null>(null);

  const myTotal = weightedTotal(params.map((p) => ({ weight: p.weight, value: values[p.key] ?? 0 })));
  const avgTotal = weightedTotal(
    params.map((p) => {
      const ai = aiScores.get(p.key)?.value;
      const my = values[p.key] ?? 0;
      return { weight: p.weight, value: ai != null ? (ai + my) / 2 : my };
    }),
  );
  const scoredCount = params.filter((p) => values[p.key] != null).length;
  const hasAi = aiScores.size > 0 || aiTotal != null;

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

      {/* AI · My · Average summary tiles */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-line bg-surface-2 px-3 py-2.5">
          <div className="u-label">AI Score</div>
          <div className="font-mono text-2xl font-bold" style={{ color: aiTotal != null ? scoreColor(aiTotal) : undefined }}>
            {aiTotal != null ? fmtScore(aiTotal) : "–"}
            <span className="text-sm font-normal text-fg-muted">/10</span>
          </div>
        </div>
        <div className="rounded-lg border border-accent/40 bg-accent/5 px-3 py-2.5">
          <div className="u-label">My Score</div>
          <div className="font-mono text-2xl font-bold text-accent">
            {fmtScore(myTotal)}
            <span className="text-sm font-normal text-fg-muted">/10</span>
          </div>
          <div className="text-[10px] text-fg-muted">
            {scoredCount} of {params.length} parameters scored
          </div>
        </div>
        <div className="rounded-lg border border-line bg-surface-2 px-3 py-2.5">
          <div className="u-label">Average</div>
          <div className="font-mono text-2xl font-bold text-fg">
            {hasAi ? fmtScore(avgTotal) : "–"}
            <span className="text-sm font-normal text-fg-muted">/10</span>
          </div>
          <div className="text-[10px] text-fg-muted">AI + jury, live</div>
        </div>
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
        <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-4 border-b border-line bg-surface-2 px-3 py-2">
          <span className="u-label">Parameter</span>
          <span className="u-label w-12 text-center">AI</span>
          <span className="u-label w-32 text-center">My</span>
          <span className="u-label w-14 text-center">Avg</span>
        </div>
        <div className="divide-y divide-line">
          {params.map((p) => {
            const ai = aiScores.get(p.key);
            const my = values[p.key] ?? 5;
            const avg = ai != null ? (ai.value + my) / 2 : null;
            return (
              <div key={p.key} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-4 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-sm text-fg">
                    {p.name}
                    <span className="text-[10px] text-fg-muted">·{p.weight}%</span>
                  </div>
                  {ai?.comment && (
                    <div className="mt-0.5 flex items-start gap-1 text-xs text-fg-muted">
                      <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-accent" aria-hidden="true" />
                      <span className="italic">{ai.comment}</span>
                    </div>
                  )}
                </div>
                <span
                  className="w-12 text-center font-mono text-sm font-semibold"
                  style={{ color: ai != null ? scoreColor(ai.value) : undefined }}
                >
                  {ai != null ? fmtScore(ai.value) : "–"}
                </span>
                <div className="flex w-32 items-center gap-2">
                  <input
                    type="range"
                    min={0}
                    max={10}
                    step={1}
                    value={my}
                    onChange={(e) => onChangeValue(p.key, Number(e.target.value))}
                    className="w-24 accent-[var(--color-accent)]"
                    aria-label={`My score for ${p.name}`}
                  />
                  <span className="w-5 text-right font-mono text-sm font-medium text-fg">{my}</span>
                </div>
                <span className="w-14 text-center font-mono text-sm font-medium text-fg">
                  {avg != null ? fmtScore(avg) : "–"}
                </span>
              </div>
            );
          })}
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
          <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-4 border-b border-line px-3 py-1.5">
            <span className="u-label">Parameter</span>
            <span className="u-label w-12 text-center">AI</span>
            <span className="u-label w-32 text-center">My</span>
            <span className="u-label w-14 text-center">Avg</span>
          </div>
          <div className="divide-y divide-line">
            {additionalParams.map((p) => {
              const ai = aiScores.get(p.key);
              const my = values[p.key] ?? 5;
              const avg = ai != null ? (ai.value + my) / 2 : null;
              return (
                <div key={p.key} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-4 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="text-sm text-fg">{p.name}</div>
                    {ai?.comment && (
                      <div className="mt-0.5 flex items-start gap-1 text-xs text-fg-muted">
                        <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-accent" aria-hidden="true" />
                        <span className="italic">{ai.comment}</span>
                      </div>
                    )}
                  </div>
                  <span
                    className="w-12 text-center font-mono text-sm font-semibold"
                    style={{ color: ai != null ? scoreColor(ai.value) : undefined }}
                  >
                    {ai != null ? fmtScore(ai.value) : "–"}
                  </span>
                  <div className="flex w-32 items-center gap-2">
                    <input
                      type="range"
                      min={0}
                      max={10}
                      step={1}
                      value={my}
                      onChange={(e) => onChangeValue(p.key, Number(e.target.value))}
                      className="w-24 accent-[var(--color-accent)]"
                      aria-label={`My score for ${p.name}`}
                    />
                    <span className="w-5 text-right font-mono text-sm font-medium text-fg">{my}</span>
                  </div>
                  <span className="w-14 text-center font-mono text-sm font-medium text-fg">
                    {avg != null ? fmtScore(avg) : "–"}
                  </span>
                </div>
              );
            })}
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
