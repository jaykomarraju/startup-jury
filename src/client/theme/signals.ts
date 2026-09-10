import type { SignalTag } from "../../shared/scoring";

/** Deck-level signal: the rubric band plus a "flagged" state (missing slides). */
export type DeckSignal = SignalTag | "flagged";

interface SignalStyle {
  label: string;
  /** Tailwind classes for a pill (bg tint + text + ring), theme-aware. */
  pill: string;
  /** Solid color token name for bars/dots. */
  color: string;
}

/**
 * Presentation for each signal — labels and token-based Tailwind classes.
 *
 * W2-B widened `SignalTag` from four bands to the specs' five (§1.5), so this
 * map gained `exceptional` and renamed `absent` → `insufficient`. The CSS
 * tokens did NOT change: `src/client/index.css` is a §2.2 serialisation-hazard
 * file this session does not own, so `exceptional` borrows `--signal-strong`
 * and `insufficient` keeps `--signal-absent`. That leaves 9–10 and 7–8 the same
 * colour — the prototype paints them differently (`RUBRICS[].c`: `var(--green)`
 * vs `#3F7A3F`). Whoever settles §8 Q13's ramp adds `--signal-exceptional` and
 * re-points the two lines below; see the §9 request.
 */
export const SIGNAL_STYLES: Record<DeckSignal, SignalStyle> = {
  exceptional: {
    label: "Exceptional",
    pill: "bg-signal-strong/12 text-signal-strong ring-1 ring-signal-strong/25",
    color: "var(--signal-strong)",
  },
  strong: {
    label: "Strong",
    pill: "bg-signal-strong/12 text-signal-strong ring-1 ring-signal-strong/25",
    color: "var(--signal-strong)",
  },
  moderate: {
    label: "Moderate",
    pill: "bg-signal-moderate/12 text-signal-moderate ring-1 ring-signal-moderate/30",
    color: "var(--signal-moderate)",
  },
  weak: {
    label: "Weak",
    pill: "bg-signal-weak/12 text-signal-weak ring-1 ring-signal-weak/25",
    color: "var(--signal-weak)",
  },
  insufficient: {
    label: "Insufficient",
    pill: "bg-signal-absent/12 text-signal-absent ring-1 ring-signal-absent/25",
    color: "var(--signal-absent)",
  },
  flagged: {
    label: "Flagged",
    pill: "bg-signal-flagged/12 text-signal-flagged ring-1 ring-signal-flagged/25",
    color: "var(--signal-flagged)",
  },
};
