import { SIGNAL_STYLES, type DeckSignal } from "../theme/signals";

interface SignalTagProps {
  signal: DeckSignal;
  /** Show a leading dot instead of the full pill (compact rows). */
  dot?: boolean;
  className?: string;
}

/** Colored pill (or dot + label) for a deck's signal band. */
export function SignalTag({ signal, dot = false, className }: SignalTagProps) {
  const style = SIGNAL_STYLES[signal];
  if (dot) {
    return (
      <span className={`inline-flex items-center gap-1.5 text-xs ${className ?? ""}`}>
        <span
          className="h-2 w-2 rounded-full"
          style={{ background: style.color }}
          aria-hidden="true"
        />
        {style.label}
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${style.pill} ${className ?? ""}`}
    >
      {style.label}
    </span>
  );
}
