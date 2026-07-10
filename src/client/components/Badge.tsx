import type { ReactNode } from "react";

type Tone = "neutral" | "amber" | "positive" | "danger" | "info";

const TONES: Record<Tone, string> = {
  neutral: "bg-surface-2 text-fg-muted ring-1 ring-line",
  amber: "bg-amber/12 text-amber ring-1 ring-amber/30",
  positive: "bg-positive/12 text-positive ring-1 ring-positive/25",
  danger: "bg-signal-flagged/12 text-signal-flagged ring-1 ring-signal-flagged/25",
  info: "bg-navy/8 text-navy ring-1 ring-navy/15 dark:bg-white/10 dark:text-white dark:ring-white/20",
};

interface BadgeProps {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}

/** Small pill for statuses, counts, and role/edition labels. */
export function Badge({ children, tone = "neutral", className }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone]} ${className ?? ""}`}
    >
      {children}
    </span>
  );
}
