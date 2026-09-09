import type { ReactNode } from "react";

type Tone = "neutral" | "amber" | "positive" | "danger" | "info";

/**
 * The prototype's status pills (`.sp-n/.sp-p/.sp-d/.sp-i`) are a flat tint plus
 * the solid hue — `background:var(--green-lt);color:var(--green)` — not an
 * alpha wash of one colour, so each tone here maps onto its own tint token.
 */
const TONES: Record<Tone, string> = {
  neutral: "bg-surface-2 text-fg-muted ring-1 ring-line",
  amber: "bg-warn-lt text-warn ring-1 ring-warn/20",
  positive: "bg-green-lt text-green ring-1 ring-green/20",
  danger: "bg-red-lt text-red ring-1 ring-red/20",
  info: "bg-blue-lt text-blue ring-1 ring-blue/20",
};

interface BadgeProps {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}

/** `.sp` — a 10px status pill for statuses, counts and role labels. */
export function Badge({ children, tone = "neutral", className }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-[7px] py-px text-meta font-medium ${TONES[tone]} ${className ?? ""}`}
    >
      {children}
    </span>
  );
}
