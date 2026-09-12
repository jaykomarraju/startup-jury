/**
 * The applier — the half of the Branding section that makes any of it true.
 *
 * Branding has round-tripped through `PUT /api/config/branding` since Phase 6
 * and was then thrown away: nothing read `branding_json` back and `Logo.tsx`
 * hardcoded the wordmark (plan §1.5). This module writes the saved values onto
 * `<html>` as inline CSS custom properties, exactly as the prototype does
 * (`admin/_scripts.js:69` — `document.documentElement.style.setProperty(t, h)`).
 *
 * ── The token names are W1-A's, not new ones ────────────────────────────────
 * Every token in `src/shared/branding.ts` is already declared in
 * `src/client/index.css`. An inline declaration outranks every selector in the
 * stylesheet, so a branded value wins without the stylesheet being touched —
 * which matters, because `index.css` is a §2.2 serialisation-hazard file this
 * session may not edit, and because `npm run parity:tokens` diffs that file
 * against the prototype palette and must not move.
 *
 * ── Dark mode ───────────────────────────────────────────────────────────────
 * `index.css` declares every token twice: a light `:root` block and a
 * `:root[data-theme="dark"]` block that darkens the tints and lifts the
 * mid-hues. An inline property beats BOTH, so applying all fourteen in dark
 * mode would paint a light background and light borders onto the dark theme and
 * break it.
 *
 * So each token declares whether it survives the dark theme (`darkSafe`). The
 * rule is not a judgement call — it reads straight off `index.css`: a token the
 * dark block does not override has one value in both themes, and branding it is
 * therefore theme-neutral. That is exactly the five identity hues
 * (`--gold`, `--navy`, `--red`, `--blue`, `--purple`). The other nine are
 * surfaces, borders and text ramps that the dark block re-derives, so a branded
 * value applies in light and is withheld in dark, where the theme's own value
 * stands. An organisation that rebrands its accent keeps that accent in dark
 * mode; one that rebrands its page background does not get a white page at
 * night. Recorded as plan §8 Q41 — deriving branded dark surfaces (rather than
 * withholding them) needs a designer, not a guess.
 */
import { ALL_BRAND_TOKENS } from "../../shared/branding";

export * from "../../shared/branding";

/**
 * Write the branded tokens onto `<html>` as inline custom properties, and
 * REMOVE the ones that are not branded so the stylesheet's own value comes
 * back — which is what makes "Reset to defaults" a real reset rather than a
 * second set of hardcoded hexes.
 *
 * Idempotent, so it can be called on every load, on every save and on every
 * theme flip.
 */
export function applyBranding(
  tokens: Record<string, string>,
  theme: "light" | "dark",
  root: HTMLElement = document.documentElement,
): void {
  for (const spec of ALL_BRAND_TOKENS) {
    const value = tokens[spec.token];
    if (value && (theme === "light" || spec.darkSafe)) root.style.setProperty(spec.token, value);
    else root.style.removeProperty(spec.token);
  }
}

/**
 * True when this logo URL will actually load. The application's CSP is
 * `img-src 'self' data:` (`src/server/security.ts:59`), so a hot-linked
 * `https://cdn.example/logo.svg` is blocked by the browser with no visible
 * error — the section says so next to the field rather than letting an admin
 * save a logo that silently never appears. Recorded as plan §8 Q42.
 */
export function logoUrlIsServable(url: string): boolean {
  const v = url.trim();
  if (v === "") return true;
  if (v.startsWith("data:image/")) return true;
  if (v.startsWith("/")) return true;
  if (typeof window === "undefined") return false;
  try {
    return new URL(v, window.location.origin).origin === window.location.origin;
  } catch {
    return false;
  }
}
