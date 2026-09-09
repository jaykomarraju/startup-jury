interface KpiTileProps {
  label: string;
  value: string | number;
  sublabel?: string;
  /** Progress bar fill 0–100 (omit to hide the bar). */
  progress?: number;
  /** Bar color token (defaults to the olive primary). */
  barColor?: string;
  /** Highlight as the active/selected tile (olive outline). */
  active?: boolean;
  /** Makes the tile a button — used by All decks to filter the table. */
  onClick?: () => void;
}

/**
 * Metric tile (prototype `.sc`): a 9.5px uppercase label, a 21px value, a
 * sub-label and a 3px progress bar. The selected tile is outlined in OLIVE —
 * `panel-alldecks.html` uses `outline:2px solid var(--olive)` — and the bar
 * fills olive too (`.pbf{background:var(--olive)}`), not gold.
 */
export function KpiTile({
  label,
  value,
  sublabel,
  progress,
  barColor = "var(--olive)",
  active = false,
  onClick,
}: KpiTileProps) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      {...(onClick ? { type: "button" as const, onClick, "aria-pressed": active } : {})}
      className={`flex flex-col rounded-lg border border-line bg-surface px-[13px] py-[11px] text-left ${
        active ? "outline outline-2 -outline-offset-1 outline-olive" : ""
      } ${onClick ? "transition-colors hover:border-olive-md" : ""}`}
    >
      <span className="u-label">{label}</span>
      <span className="mt-[3px] font-mono text-metric font-semibold leading-none text-fg">
        {value}
      </span>
      {sublabel && <span className="mt-0.5 text-meta text-fg-muted">{sublabel}</span>}
      {progress !== undefined && (
        <div className="mt-1.5 h-[3px] w-full overflow-hidden rounded-sm bg-line-soft">
          <div
            className="h-full rounded-sm"
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
