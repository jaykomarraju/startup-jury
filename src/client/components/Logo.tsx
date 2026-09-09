interface LogoProps {
  /** Show the "ai.STARTUPJURY" wordmark next to the radar mark. */
  wordmark?: boolean;
  /** Mark height in px (wordmark scales with it). */
  size?: number;
  /**
   * Strapline under the wordmark (prototype `.lt`, 6.5px uppercase). Omitted
   * everywhere but the ribbon, where the prototype always shows it.
   */
  tagline?: string;
  className?: string;
}

/**
 * Brand logo — an inline-SVG radar mark (gold pentagon on concentric rings) plus
 * the wordmark and, on the ribbon, its strapline. Strokes use `currentColor` so
 * the mark adapts to light/dark surfaces; the gold shape is fixed per the brand
 * guidelines. Gold is the logo's hue — the rest of the chrome is olive.
 */
export function Logo({ wordmark = true, size = 28, tagline, className }: LogoProps) {
  return (
    <span
      className={`inline-flex items-center gap-2.5 ${className ?? ""}`}
      aria-label="ai.STARTUPJURY"
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        fill="none"
        aria-hidden="true"
        className="shrink-0"
      >
        <circle cx="50" cy="50" r="46" stroke="currentColor" strokeWidth="2" opacity="0.85" />
        <circle cx="50" cy="50" r="30" stroke="currentColor" strokeWidth="2" opacity="0.55" />
        {Array.from({ length: 12 }).map((_, i) => {
          const a = (i * Math.PI) / 6;
          return (
            <line
              key={i}
              x1={50 + 30 * Math.cos(a)}
              y1={50 + 30 * Math.sin(a)}
              x2={50 + 46 * Math.cos(a)}
              y2={50 + 46 * Math.sin(a)}
              stroke="currentColor"
              strokeWidth="1.5"
              opacity="0.5"
            />
          );
        })}
        <path
          d="M50 22 L74 40 L65 70 L35 70 L26 40 Z"
          fill="var(--gold)"
        />
        <circle cx="50" cy="50" r="5" fill="currentColor" />
      </svg>
      {wordmark && (
        <span className="flex flex-col">
          {/* `.lw` — "ai" plain, the separator dot and the name in gold. The
              application had this inverted (a gold "ai." and a plain name). */}
          <span
            className="font-bold leading-none tracking-[0.03em]"
            style={{ fontSize: size * 0.42 }}
          >
            <span className="font-normal" style={{ fontSize: size * 0.34 }}>
              ai
            </span>
            <span className="mx-px font-black text-gold">·</span>
            <span className="text-gold">STARTUPJURY</span>
          </span>
          {tagline && (
            <span
              className="mt-px text-center uppercase leading-none tracking-[0.08em]"
              style={{ fontSize: Math.max(6.5, size * 0.2) }}
            >
              {tagline}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
