import { useEffect } from "react";
import { X } from "lucide-react";
import type { DeckView } from "../types";
import { ScoreBars, type ParamScoreView } from "./ScoreBars";
import { SignalTag } from "./SignalTag";
import { Badge } from "./Badge";

export interface ExtractionSlide {
  label: string;
  heading?: string;
  text: string;
  missing?: boolean;
}

interface EvaluationDrawerProps {
  open: boolean;
  onClose: () => void;
  deck: DeckView;
  scores?: ParamScoreView[];
  extraction?: ExtractionSlide[];
  verdict?: string;
}

/**
 * "Evaluation report" right-side slide-over: extraction slides, per-parameter
 * scores, and verdict. Phase 2 renders provided/placeholder content; live data
 * (extraction + AI scores) arrives in Phase 3.
 */
export function EvaluationDrawer({
  open,
  onClose,
  deck,
  scores = [],
  extraction = [],
  verdict,
}: EvaluationDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`Evaluation report — ${deck.name}`}>
      <div
        className="absolute inset-0 bg-navy/40 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-line bg-surface shadow-xl">
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <div className="u-label">Evaluation report</div>
            <h2 className="mt-0.5 text-lg font-semibold text-fg">{deck.name}</h2>
            <div className="mt-1 flex items-center gap-2">
              {deck.signal && <SignalTag signal={deck.signal} />}
              {deck.status && <Badge tone="info">{deck.status}</Badge>}
            </div>
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

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {verdict && (
            <div className="mb-5 rounded-lg border border-line bg-surface-2 px-4 py-3">
              <div className="u-label">Verdict</div>
              <div className="mt-1 text-sm font-medium text-fg">{verdict}</div>
            </div>
          )}

          {scores.length > 0 && (
            <section className="mb-6">
              <h3 className="u-label mb-3">Parameter scores</h3>
              <ScoreBars scores={scores} />
            </section>
          )}

          {extraction.length > 0 && (
            <section>
              <h3 className="u-label mb-3">Extracted slides</h3>
              <ul className="flex flex-col gap-3">
                {extraction.map((slide) => (
                  <li key={slide.label} className="rounded-lg border border-line px-3 py-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-fg">{slide.label}</span>
                      {slide.missing && <Badge tone="danger">Missing</Badge>}
                    </div>
                    {slide.heading && (
                      <div className="mt-1 text-sm font-medium text-fg">{slide.heading}</div>
                    )}
                    <p className="mt-1 text-sm text-fg-muted">{slide.text}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </aside>
    </div>
  );
}
