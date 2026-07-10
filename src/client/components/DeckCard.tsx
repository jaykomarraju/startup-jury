import type { DeckView } from "../types";
import { SignalTag } from "./SignalTag";

function meta(deck: DeckView): string {
  return [deck.sector, deck.stage, deck.city].filter(Boolean).join(" · ");
}

/** Mono score chip (DM Mono per brand — amber value). */
export function ScoreChip({ value }: { value?: number }) {
  if (value === undefined) return <span className="text-fg-muted">—</span>;
  return (
    <span className="inline-flex min-w-[2.75rem] justify-center rounded-md bg-surface-2 px-2 py-0.5 font-mono text-sm font-medium text-fg ring-1 ring-line">
      {value.toFixed(1)}
    </span>
  );
}

interface DeckProps {
  deck: DeckView;
  onClick?: (deck: DeckView) => void;
}

/** Card presentation of a deck (grid layouts). */
export function DeckCard({ deck, onClick }: DeckProps) {
  return (
    <button
      type="button"
      onClick={() => onClick?.(deck)}
      className="flex w-full flex-col gap-3 rounded-xl border border-line bg-surface p-4 text-left transition-colors hover:border-amber/50"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-fg">{deck.name}</div>
          <div className="mt-0.5 text-xs text-fg-muted">{meta(deck)}</div>
        </div>
        {deck.signal && <SignalTag signal={deck.signal} />}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-fg-muted">{deck.founder ?? "—"}</span>
        <ScoreChip value={deck.aiScore} />
      </div>
    </button>
  );
}

/** Table-row presentation of a deck (list layouts). */
export function DeckRow({ deck, onClick }: DeckProps) {
  return (
    <tr
      onClick={() => onClick?.(deck)}
      className={`border-t border-line ${onClick ? "cursor-pointer hover:bg-surface-2" : ""}`}
    >
      <td className="px-4 py-3">
        <div className="font-medium text-fg">{deck.name}</div>
        <div className="mt-0.5 text-xs text-fg-muted">{meta(deck)}</div>
      </td>
      <td className="px-4 py-3 text-sm text-fg-muted">{deck.founder ?? "—"}</td>
      <td className="px-4 py-3 text-sm text-fg-muted">{deck.city ?? "—"}</td>
      <td className="px-4 py-3">
        <ScoreChip value={deck.aiScore} />
      </td>
      <td className="px-4 py-3">
        {deck.signal ? <SignalTag signal={deck.signal} /> : null}
      </td>
      <td className="px-4 py-3 text-sm text-fg-muted">{deck.status ?? "—"}</td>
    </tr>
  );
}
