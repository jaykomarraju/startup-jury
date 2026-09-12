import { useBranding } from "../theme/useBranding";
import { logoUrlIsServable } from "../theme/branding";

interface LogoProps {
  /** Show the wordmark next to the radar mark. */
  wordmark?: boolean;
  /** Mark height in px (wordmark scales with it). */
  size?: number;
  /**
   * Strapline under the wordmark (prototype `.lt`, 6.5px uppercase). Omitted
   * everywhere but the ribbon, where the prototype always shows it.
   *
   * The value passed is the FALLBACK: a workspace that has branded its tagline
   * shows its own. Passing the prop is what turns the strapline on, which is
   * what keeps `Topbar` — a file this session does not own — unchanged.
   */
  tagline?: string;
  className?: string;
}

/**
 * Brand logo — an inline-SVG radar mark (gold pentagon on concentric rings) plus
 * the wordmark and, on the ribbon, its strapline. Strokes use `currentColor` so
 * the mark adapts to light/dark surfaces; the gold shape is fixed per the brand
 * guidelines. Gold is the logo's hue — the rest of the chrome is olive.
 *
 * ── What an admin controls (W4-B) ───────────────────────────────────────────
 * The wordmark used to be the literal `ai · STARTUPJURY`, so a white-label
 * client could rebrand neither half of its own product name (findings F0014,
 * F0138, F0141). Both halves, the strapline and an optional logo image now come
 * from the workspace's saved branding, and fall back to the shipped literal
 * when nothing is saved or the read fails.
 *
 * A branded logo image replaces the mark AND the wordmark, exactly as the
 * prototype does (`brLogoImg`, `admin/_scripts.js:74`) — and only when the URL
 * is one the app's `img-src 'self' data:` policy will actually load, so a
 * hot-linked logo degrades to the text mark instead of to a broken image.
 */
export function Logo({ wordmark = true, size = 28, tagline, className }: LogoProps) {
  const { branding } = useBranding();
  const prefix = branding.wordmarkPrefix;
  const name = branding.wordmark;
  const strapline = tagline === undefined ? undefined : branding.tagline || tagline;
  // The accessible name is the product's WRITTEN name — "ai.STARTUPJURY", the
  // form the outbox uses as a sender name — not the mark's typographic middle
  // dot. It brands with the wordmark, so a rebranded workspace announces itself.
  const label = [prefix, name].filter(Boolean).join(".") || "Logo";
  const image = branding.logoUrl && logoUrlIsServable(branding.logoUrl) ? branding.logoUrl : "";

  if (image) {
    return (
      <span className={`inline-flex items-center ${className ?? ""}`}>
        <img
          src={image}
          alt={label}
          data-testid="brand-logo-image"
          className="block rounded-md"
          style={{ maxHeight: size + 2 }}
        />
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-2.5 ${className ?? ""}`}
      aria-label={label}
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
          {/* `.lw` — part 1 plain, the separator dot and part 2 in gold. The
              application had this inverted (a gold "ai." and a plain name). */}
          <span
            className="font-bold leading-none tracking-[0.03em]"
            style={{ fontSize: size * 0.42 }}
          >
            <span
              className="font-normal"
              data-testid="brand-wordmark-prefix"
              style={{ fontSize: size * 0.34 }}
            >
              {prefix}
            </span>
            <span className="mx-px font-black text-gold">·</span>
            <span className="text-gold" data-testid="brand-wordmark-name">
              {name}
            </span>
          </span>
          {strapline && (
            <span
              data-testid="brand-tagline"
              className="mt-px text-center uppercase leading-none tracking-[0.08em]"
              style={{ fontSize: Math.max(6.5, size * 0.2) }}
            >
              {strapline}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
