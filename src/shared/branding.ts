/**
 * The branding vocabulary — the token table, the hex rules, and how a stored
 * `branding_json` record is read and written.
 *
 * Shared because three things need it: the console section that edits it, the
 * applier that paints it (`src/client/theme/branding.ts`), and the worker tests
 * that walk the save. Nothing here touches the DOM, so it compiles under
 * `tsconfig.worker.json` too; the applier itself stays client-side.
 *
 * Admin console → System → **Branding** (`admin/s-br.html`) lets an admin edit
 * ten brand tokens, four status tokens, a two-part wordmark, a tagline and a
 * logo image. Until now all of that round-tripped through
 * `PUT /api/config/branding` and was then thrown away: nothing read
 * `branding_json` back and `Logo.tsx` hardcoded the wordmark (plan §1.5). This
 * module is the half that makes the section true.
 *
 * ── The token names are W1-A's, not new ones ────────────────────────────────
 * Every token below is already declared in `src/client/index.css`. The applier
 * writes the SAME names as inline custom properties on `<html>`, exactly as the
 * prototype does (`admin/_scripts.js:69` —
 * `document.documentElement.style.setProperty(t, h)`). An inline declaration
 * outranks every selector in the stylesheet, so a branded value wins without
 * the stylesheet being touched — which matters, because `index.css` is a §2.2
 * serialisation-hazard file this session may not edit, and because
 * `npm run parity:tokens` diffs that file against the prototype palette and
 * must not move.
 *
 * ── Dark mode ───────────────────────────────────────────────────────────────
 * Each token declares whether a branded value survives the dark theme
 * (`darkSafe`). The rule reads straight off `index.css` and is explained where
 * it is enforced, in `src/client/theme/branding.ts`.
 */

export interface BrandTokenSpec {
  /** The CSS custom property, verbatim — the name `index.css` declares. */
  token: string;
  /** The prototype's row label (`admin/_scripts.js:46-63`). */
  label: string;
  /** `index.css`'s own light-theme value: what "reset to defaults" means. */
  fallback: string;
  /**
   * True when `index.css`'s dark block does NOT override this token, so a
   * branded value is correct in both themes. See the module note.
   */
  darkSafe: boolean;
}

/** The ten brand tokens, in the prototype's order. */
export const BRAND_TOKENS: readonly BrandTokenSpec[] = [
  { token: "--olive", label: "Primary (sidebar / brand)", fallback: "#6B8454", darkSafe: false },
  { token: "--olive-lt", label: "Primary light", fallback: "#EBF0E4", darkSafe: false },
  { token: "--gold", label: "Accent", fallback: "#E8A020", darkSafe: true },
  { token: "--gold-dk", label: "Accent dark", fallback: "#B87A10", darkSafe: false },
  { token: "--gold-lt", label: "Accent light", fallback: "#FDF3E0", darkSafe: false },
  { token: "--navy", label: "Text / headings", fallback: "#1A1E2E", darkSafe: true },
  { token: "--text-3", label: "Text muted", fallback: "#9A9488", darkSafe: false },
  { token: "--bg", label: "Background", fallback: "#F7F6F2", darkSafe: false },
  { token: "--stone", label: "Soft border", fallback: "#ECEAE4", darkSafe: false },
  { token: "--stone-dk", label: "Border", fallback: "#D4D0C8", darkSafe: false },
] as const;

/** The four status tokens. "Usually left as-is", says the prototype. */
export const STATUS_TOKENS: readonly BrandTokenSpec[] = [
  { token: "--green", label: "Success", fallback: "#16A34A", darkSafe: false },
  { token: "--red", label: "Danger", fallback: "#DC2626", darkSafe: true },
  { token: "--blue", label: "Info", fallback: "#2563EB", darkSafe: true },
  { token: "--purple", label: "Special", fallback: "#7C3AED", darkSafe: true },
] as const;

export const ALL_BRAND_TOKENS: readonly BrandTokenSpec[] = [...BRAND_TOKENS, ...STATUS_TOKENS];

const TOKEN_BY_NAME = new Map(ALL_BRAND_TOKENS.map((t) => [t.token, t]));

/** The text half of the mark, at the values every prototype ships. */
export const BRAND_TEXT_DEFAULTS = {
  /** `#br-f-a` / `#brand-a` — "ai". */
  wordmarkPrefix: "ai",
  /** `#br-f-s` / `#brand-s` — "STARTUPJURY". Persisted under the pre-existing
   *  `wordmark` key, which already meant the second half (`ConfigPage` defaults
   *  it to "STARTUPJURY"), so the two screens stay compatible. */
  wordmark: "STARTUPJURY",
  /** `#br-f-tag` / `#brand-tag`. */
  tagline: "Venture Intelligence First",
  /** `#br-f-img` — blank uses the text mark. */
  logoUrl: "",
} as const;

/** Branding as the application consumes it: text, plus the tokens actually set. */
export interface Branding {
  wordmarkPrefix: string;
  wordmark: string;
  tagline: string;
  logoUrl: string;
  /** Only the tokens an admin has actually changed; the rest fall through to CSS. */
  tokens: Record<string, string>;
}

export const DEFAULT_BRANDING: Branding = { ...BRAND_TEXT_DEFAULTS, tokens: {} };

/**
 * `brNorm()` (`admin/_scripts.js:68`) — accept `#RGB` / `#RRGGBB` with or
 * without the `#`, reject everything else silently. Returned uppercase, which
 * is how the prototype's hex field displays it.
 */
export function normaliseHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  const withHash = v.startsWith("#") ? v : `#${v}`;
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(withHash) ? withHash.toUpperCase() : null;
}

function str(raw: Record<string, unknown>, key: string, fallback: string): string {
  const v = raw[key];
  return typeof v === "string" ? v : fallback;
}

/**
 * Read `branding_json` into the shape the applier and the section both want.
 *
 * Two compatibility rules, because `ConfigPage`'s older branding card writes
 * the same object and must keep working:
 *
 *   • `wordmark` is the SECOND half of the mark (it always was), and
 *     `wordmarkPrefix` is the first — so a record written before this session
 *     keeps its name and gains the default "ai".
 *   • `accent` — `ConfigPage`'s single colour — seeds `--gold` when the token
 *     map does not carry one. `tokens` wins where both are present, so the two
 *     screens cannot disagree about which value is live.
 *
 * Anything that is not a valid hex is dropped rather than written to the DOM.
 */
export function readBranding(raw: Record<string, unknown> | null | undefined): Branding {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_BRANDING };

  const tokens: Record<string, string> = {};
  const accent = normaliseHex(raw.accent);
  if (accent) tokens["--gold"] = accent;

  const stored = raw.tokens;
  if (stored && typeof stored === "object") {
    for (const [token, value] of Object.entries(stored as Record<string, unknown>)) {
      if (!TOKEN_BY_NAME.has(token)) continue; // never write a name we do not own
      const hex = normaliseHex(value);
      if (hex) tokens[token] = hex;
    }
  }

  return {
    wordmarkPrefix: str(raw, "wordmarkPrefix", BRAND_TEXT_DEFAULTS.wordmarkPrefix),
    wordmark: str(raw, "wordmark", BRAND_TEXT_DEFAULTS.wordmark),
    tagline: str(raw, "tagline", BRAND_TEXT_DEFAULTS.tagline),
    logoUrl: str(raw, "logoUrl", BRAND_TEXT_DEFAULTS.logoUrl).trim(),
    tokens,
  };
}

/**
 * The keys the Branding section writes. `PUT /api/config/branding` REPLACES
 * `branding_json` wholesale (plan §1.5), so this is spread over the CURRENT
 * record — never posted alone — or the Set up wizard's `orgName` / `orgType`
 * go with it and take the account screen and the founder resubmit email too.
 *
 * `accent` is mirrored out of `--gold` so `ConfigPage`'s older card, which
 * reads that key, shows the same colour this section shows.
 */
export function brandingPatch(b: Branding): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    wordmarkPrefix: b.wordmarkPrefix,
    wordmark: b.wordmark,
    tagline: b.tagline,
    logoUrl: b.logoUrl,
    tokens: { ...b.tokens },
  };
  if (b.tokens["--gold"]) patch.accent = b.tokens["--gold"];
  return patch;
}

/** `{...current, ...patch}` — the merge the replace-semantics route forces. */
export function mergeBranding(
  current: Record<string, unknown> | null | undefined,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return { ...(current ?? {}), ...patch };
}
