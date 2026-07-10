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

/** Presentation for each signal — labels and token-based Tailwind classes. */
export const SIGNAL_STYLES: Record<DeckSignal, SignalStyle> = {
  strong: {
    label: "Strong",
    pill: "bg-signal-strong/12 text-signal-strong ring-1 ring-signal-strong/25",
    color: "var(--color-signal-strong)",
  },
  moderate: {
    label: "Moderate",
    pill: "bg-signal-moderate/12 text-signal-moderate ring-1 ring-signal-moderate/30",
    color: "var(--color-signal-moderate)",
  },
  weak: {
    label: "Weak",
    pill: "bg-signal-weak/12 text-signal-weak ring-1 ring-signal-weak/25",
    color: "var(--color-signal-weak)",
  },
  absent: {
    label: "Absent",
    pill: "bg-signal-absent/12 text-signal-absent ring-1 ring-signal-absent/25",
    color: "var(--color-signal-absent)",
  },
  flagged: {
    label: "Flagged",
    pill: "bg-signal-flagged/12 text-signal-flagged ring-1 ring-signal-flagged/25",
    color: "var(--color-signal-flagged)",
  },
};
