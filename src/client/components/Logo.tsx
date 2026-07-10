interface LogoProps {
  /** Show the "ai.STARTUPJURY" wordmark next to the radar mark. */
  wordmark?: boolean;
  /** Mark height in px (wordmark scales with it). */
  size?: number;
  className?: string;
}

/**
 * Brand logo — an inline-SVG radar mark (amber pentagon on concentric rings) plus
 * the wordmark. Strokes use `currentColor` so the mark adapts to light/dark
 * surfaces; the amber shape is fixed per brand guidelines.
 */
export function Logo({ wordmark = true, size = 28, className }: LogoProps) {
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
          fill="var(--color-amber)"
        />
        <circle cx="50" cy="50" r="5" fill="currentColor" />
      </svg>
      {wordmark && (
        <span
          className="font-semibold tracking-[0.02em] leading-none"
          style={{ fontSize: size * 0.62 }}
        >
          <span className="text-amber">ai.</span>
          <span>STARTUPJURY</span>
        </span>
      )}
    </span>
  );
}
