import { useEffect } from "react";
import { BarChart3, FileText, X } from "lucide-react";
import { paramScoreColour, weightedParamTotal } from "../../shared/assignment";

/**
 * The 13-bar "Parameter scores" sparkline and the per-parameter AI breakdown it
 * opens (`AISJ_IC_SuserV15/_scripts.js` asSpark / asShowParams, `#as-pov` in
 * `_style.css:529-547`). W7-E built it for Assign's deck rows (F0212 / F0263);
 * All decks draws the same pair (`adShowParams`, F0234), so it lives here rather
 * than inside the screen.
 */
export function ParamSparkline({
  values,
  onOpen,
  deckName,
}: {
  values: readonly number[];
  onOpen?: () => void;
  deckName: string;
}) {
  const bars = (
    <span className="inline-flex h-[22px] items-end gap-px" aria-hidden="true">
      {values.map((v, i) => (
        <span
          key={i}
          className="w-[3px] rounded-[1px]"
          style={{ height: `${Math.max(3, Math.round((v / 10) * 22))}px`, background: paramScoreColour(v) }}
        />
      ))}
    </span>
  );
  if (!onOpen) return bars;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      title="View AI parameter scores"
      aria-label={`View AI parameter scores for ${deckName}`}
      className="inline-flex items-center gap-1 rounded px-0.5 text-fg-muted hover:bg-offwhite hover:text-fg"
    >
      {bars}
      <BarChart3 className="h-3 w-3" aria-hidden="true" />
    </button>
  );
}

export interface ParamScoreRow {
  name: string;
  weight: number;
  value: number;
}

/** `#as-pov` — one row per parameter with its weight, a banded bar and the value. */
export function ParamScoresModal({
  deckName,
  meta,
  rows,
  onClose,
  onOpenReport,
}: {
  deckName: string;
  meta?: string;
  rows: readonly ParamScoreRow[];
  onClose: () => void;
  onOpenReport: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const total = weightedParamTotal(rows);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy/45 p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`${deckName} — per-parameter AI scores`}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="max-h-[86vh] w-[520px] max-w-full overflow-auto rounded-[14px] bg-surface shadow-[0_24px_70px_rgba(0,0,0,.3)]">
        <div className="flex items-start gap-2.5 border-b border-stone-dk px-5 py-[18px]">
          <div>
            <div className="text-base font-bold text-navy">{deckName}</div>
            <div className="mt-0.5 text-[11px] text-fg-muted">
              {meta ? `${meta} · ` : ""}per-parameter AI scores
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="ml-auto text-fg-muted hover:text-fg">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-3">
          {rows.map((r) => {
            const col = paramScoreColour(r.value);
            return (
              <div key={r.name} className="flex items-center gap-2.5 py-1.5" data-testid="param-row">
                <div className="flex-1 text-[11.5px] text-navy">
                  {r.name}
                  <b className="block text-[9.5px] font-medium text-fg-muted">Weight {r.weight}</b>
                </div>
                <div className="h-1.5 w-[120px] overflow-hidden rounded bg-[#ECEAE4]">
                  <div className="h-full" style={{ width: `${(r.value / 10) * 100}%`, background: col }} />
                </div>
                <div className="w-[34px] text-right font-mono text-xs font-semibold" style={{ color: col }}>
                  {r.value.toFixed(1)}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-between border-t border-stone-dk px-5 py-3 text-xs text-fg-muted">
          <span>Weighted total</span>
          <b className="font-mono text-[15px]" style={{ color: paramScoreColour(total) }}>
            {total.toFixed(1)} / 10
          </b>
        </div>
        <div className="px-5 pb-[18px]">
          <button
            type="button"
            onClick={onOpenReport}
            className="flex w-full items-center justify-center gap-1.5 rounded-[9px] bg-gold-dk p-2.5 text-xs font-semibold text-white hover:bg-[#956010]"
          >
            <FileText className="h-3.5 w-3.5" /> Open full evaluation report
          </button>
        </div>
      </div>
    </div>
  );
}
