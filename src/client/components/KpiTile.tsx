interface KpiTileProps {
  label: string;
  value: string | number;
  sublabel?: string;
  /** Progress bar fill 0–100 (omit to hide the bar). */
  progress?: number;
  /** Bar color token (defaults to amber accent). */
  barColor?: string;
  /** Highlight as the active/selected tile (amber ring). */
  active?: boolean;
  /** Makes the tile a button — used by All decks to filter the table. */
  onClick?: () => void;
}

/** Metric tile: uppercase label, bold value, sub-label, thin progress bar. */
export function KpiTile({
  label,
  value,
  sublabel,
  progress,
  barColor = "var(--color-amber)",
  active = false,
  onClick,
}: KpiTileProps) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      {...(onClick ? { type: "button" as const, onClick, "aria-pressed": active } : {})}
      className={`flex flex-col rounded-xl border bg-surface px-4 py-3.5 text-left ${
        active ? "border-amber ring-1 ring-amber/40" : "border-line"
      } ${onClick ? "transition-colors hover:border-amber/60" : ""}`}
    >
      <span className="u-label">{label}</span>
      <span className="mt-1 font-mono text-2xl font-semibold leading-none text-fg">
        {value}
      </span>
      {sublabel && <span className="mt-1.5 text-xs text-fg-muted">{sublabel}</span>}
      {progress !== undefined && (
        <div className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.max(0, Math.min(100, progress))}%`,
              background: barColor,
            }}
          />
        </div>
      )}
    </Tag>
  );
}
