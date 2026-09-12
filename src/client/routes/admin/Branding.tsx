import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { Card } from "../../components";
import { getConfigSummary, updateBranding } from "../../api";
import { useBranding } from "../../theme/useBranding";
import {
  BRAND_TOKENS,
  STATUS_TOKENS,
  DEFAULT_BRANDING,
  brandingPatch,
  logoUrlIsServable,
  mergeBranding,
  normaliseHex,
  readBranding,
  type BrandTokenSpec,
  type Branding,
} from "../../theme/branding";
import { useAdminSave } from "./saveContext";

/**
 * Admin console → System → **Branding** (`admin/s-br.html`).
 *
 * Three cards in an auto-fit grid, exactly as the prototype lays them out: the
 * logo and wordmark with its live preview, the ten brand tokens, and the four
 * status tokens with Reset to defaults and the explanatory note beneath them.
 *
 * The section is only half the work. Branding has round-tripped through
 * `PUT /api/config/branding` since Phase 6 and was then thrown away — nothing
 * read it back (plan §1.5). `src/client/theme/branding.ts` is the other half:
 * it writes the saved values onto `<html>` as inline custom properties, so a
 * change is visible everywhere the moment it is saved, without a reload. Editing
 * a swatch here applies it immediately; Save persists it.
 *
 * ── Why a re-read before every save ─────────────────────────────────────────
 * `PUT /api/config/branding` REPLACES `branding_json` wholesale
 * (`src/server/routes/config.ts:675`). That is the route's pinned contract —
 * `test/worker/branding.test.ts` asserts it deliberately — so a caller that
 * posts only its own fields destroys the Set up wizard's `orgName` / `orgType`,
 * and with them the account screen and the founder resubmit email. `ConfigPage`
 * was the first screen to hit this (plan §1.5, fixed by W1-A); this is the
 * second, and it merges the same way: read the current record, spread it, then
 * overwrite only the keys this section owns.
 */

// ── The prototype's picker row: swatch · label · token name · hex field ──────

function PickerRow({
  spec,
  value,
  onChange,
}: {
  spec: BrandTokenSpec;
  value: string;
  onChange: (hex: string) => void;
}) {
  // The hex field is free text while it is being typed — `brNorm` rejects
  // silently, so a half-typed "#4A6" must not snap back on every keystroke.
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  function commit(next: string) {
    const hex = normaliseHex(next);
    if (hex) onChange(hex);
    else setDraft(value); // silent rejection, the prototype's behaviour
  }

  const swatchId = `brsw-${spec.token}`;
  const hexId = `brhex-${spec.token}`;

  return (
    <div className="flex items-center gap-[11px] border-b border-line-soft py-[7px] last:border-b-0">
      <input
        type="color"
        id={swatchId}
        aria-label={spec.label}
        value={value}
        onChange={(e) => onChange(normaliseHex(e.target.value) ?? value)}
        className="h-[34px] w-[34px] shrink-0 cursor-pointer rounded-lg border border-line bg-white p-[2px]"
      />
      <div className="min-w-0 flex-1">
        <label htmlFor={swatchId} className="block text-[12px] font-semibold text-fg">
          {spec.label}
        </label>
        <div className="font-mono text-[9.5px] text-fg-muted">{spec.token}</div>
      </div>
      <input
        type="text"
        id={hexId}
        aria-label={`${spec.label} hex`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
        }}
        className="w-[88px] rounded-[7px] border border-line px-2 py-[7px] font-mono text-[11px] uppercase text-fg"
      />
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <>
      <label
        htmlFor={id}
        className="mb-[5px] mt-[11px] block text-[10px] font-bold uppercase tracking-[0.05em] text-fg-muted first:mt-0"
      >
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-line bg-surface px-[11px] py-[9px] text-[12.5px] text-fg"
      />
    </>
  );
}

// ── The section ──────────────────────────────────────────────────────────────

export function BrandingSection() {
  const { branding, loaded, setBranding } = useBranding();
  // The section edits a draft and publishes it to the provider on every change,
  // so the console repaints live; Save is what persists it.
  const [draft, setDraft] = useState<Branding>(branding);
  const [saved, setSaved] = useState<Branding>(branding);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Adopt the provider's value once it has READ THE SERVER, then stop — after
   * that this section is the one editing it.
   *
   * Both flags are REFS, not state, and that is the whole point. The read lands
   * a tick or two after the first paint, so an admin can already be typing when
   * it arrives; a state flag would be captured by the effect's closure at its
   * own commit, and the adoption would then run with a stale "nothing has been
   * typed yet" and wipe the field. A ref is read when the effect actually runs.
   *
   * Waiting on `loaded` matters for the same reason in the other direction: the
   * provider's first value is the shipped default, and adopting THAT would pin
   * the section to it and quietly discard the workspace's saved palette.
   */
  const adopted = useRef(false);
  const touched = useRef(false);

  useEffect(() => {
    if (!loaded || adopted.current || touched.current) return;
    adopted.current = true;
    setDraft(branding);
    setSaved(branding);
  }, [branding, loaded]);

  const dirty = useMemo(
    () => JSON.stringify(brandingPatch(draft)) !== JSON.stringify(brandingPatch(saved)),
    [draft, saved],
  );

  /** Edit the draft AND apply it, so every screen repaints as it is typed. */
  const edit = useCallback(
    (next: Branding) => {
      touched.current = true;
      setDraft(next);
      setBranding(brandingPatch(next));
    },
    [setBranding],
  );

  const setToken = useCallback(
    (token: string, hex: string) => edit({ ...draft, tokens: { ...draft.tokens, [token]: hex } }),
    [draft, edit],
  );

  const reset = useCallback(() => {
    // `brReset()` — every token back to the stylesheet's own value, the wordmark
    // and tagline back to the literal, the image URL cleared. Clearing `tokens`
    // rather than writing fourteen defaults is what makes the app fall back to
    // `index.css`, which is the only definition of "default" that stays true
    // when the palette there changes — and the only one that is theme-correct.
    edit({ ...DEFAULT_BRANDING });
  }, [edit]);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      // Re-read first: the route replaces wholesale — see the module note.
      const current = await getConfigSummary()
        .then((c) => c.branding)
        .catch(() => null);
      const body = mergeBranding(current, brandingPatch(draft));
      const res = await updateBranding(body);
      const applied = readBranding(res.branding ?? body);
      setSaved(applied);
      setDraft(applied);
      setBranding(res.branding ?? body);
    } catch {
      setError("Couldn't save branding. Try again.");
    } finally {
      setSaving(false);
    }
  }, [draft, setBranding]);

  useAdminSave({
    dirty,
    saving,
    onSave: save,
    hint: dirty ? undefined : "No branding changes to save",
  });

  const tokenValue = (spec: BrandTokenSpec) => draft.tokens[spec.token] ?? spec.fallback;
  const logoBlocked = draft.logoUrl.trim() !== "" && !logoUrlIsServable(draft.logoUrl);
  const previewAccent = tokenValue(BRAND_TOKENS[2]); // --gold
  const previewPrimary = tokenValue(BRAND_TOKENS[0]); // --olive

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold tracking-tight text-fg">Branding &amp; theme</h2>
        <p className="mt-0.5 max-w-3xl text-[13px] text-fg-muted">
          Edit the logo and brand palette here — changes apply across the entire admin console
          instantly.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red/40 bg-red-lt px-3 py-2 text-[12px] text-red"
        >
          {error}
        </div>
      )}

      <div className="grid max-w-[1000px] grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-3">
        {/* ── Logo & wordmark ── */}
        <Card>
          <Field
            id="br-f-a"
            label="Wordmark — part 1"
            value={draft.wordmarkPrefix}
            onChange={(v) => edit({ ...draft, wordmarkPrefix: v })}
          />
          <Field
            id="br-f-s"
            label="Wordmark — part 2"
            value={draft.wordmark}
            onChange={(v) => edit({ ...draft, wordmark: v })}
          />
          <Field
            id="br-f-tag"
            label="Tagline"
            value={draft.tagline}
            onChange={(v) => edit({ ...draft, tagline: v })}
          />
          <Field
            id="br-f-img"
            label="Logo image URL (optional)"
            value={draft.logoUrl}
            placeholder="https://…/logo.svg — blank uses the text mark"
            onChange={(v) => edit({ ...draft, logoUrl: v })}
          />
          {logoBlocked && (
            <p
              data-testid="br-logo-blocked"
              className="mt-1.5 flex items-start gap-1.5 text-[10.5px] leading-[1.5] text-warn"
            >
              <TriangleAlert className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
              <span>
                This app serves images from its own origin only
                (<span className="font-mono">img-src &apos;self&apos; data:</span>), so a logo hosted
                elsewhere is blocked by the browser and the text mark is shown instead. Use a path on
                this domain, or a <span className="font-mono">data:</span> URI.
              </span>
            </p>
          )}

          <div className="mb-1.5 mt-[14px] text-[9px] uppercase tracking-[0.05em] text-fg-muted">
            Live preview
          </div>
          <div
            data-testid="br-preview"
            className="rounded-[10px] px-4 py-[13px]"
            style={{ background: previewPrimary }}
          >
            <div className="flex items-center gap-[2px] tracking-[0.03em]">
              <span className="text-[11px] font-normal text-white">{draft.wordmarkPrefix}</span>
              <span className="mx-px text-[14px] font-black" style={{ color: previewAccent }}>
                ·
              </span>
              <span className="text-[13.5px] font-bold" style={{ color: previewAccent }}>
                {draft.wordmark}
              </span>
            </div>
            <div className="mt-px text-[6.5px] uppercase tracking-[0.08em] text-white">
              {draft.tagline}
            </div>
          </div>
        </Card>

        {/* ── Brand colours ── */}
        <Card>
          <div className="mb-[3px] text-[12px] font-semibold text-fg">Brand colours</div>
          <p className="mb-2.5 text-[13px] text-fg-muted">
            Primary, accent and neutral tokens — drive the sidebar, headings, buttons, surfaces and
            borders.
          </p>
          <div>
            {BRAND_TOKENS.map((spec) => (
              <PickerRow
                key={spec.token}
                spec={spec}
                value={tokenValue(spec)}
                onChange={(hex) => setToken(spec.token, hex)}
              />
            ))}
          </div>
        </Card>

        {/* ── Status colours ── */}
        <Card>
          <div className="mb-[3px] text-[12px] font-semibold text-fg">Status colours</div>
          <p className="mb-2.5 text-[13px] text-fg-muted">
            Semantic signals (success, danger, info, special). Usually left as-is.
          </p>
          <div>
            {STATUS_TOKENS.map((spec) => (
              <PickerRow
                key={spec.token}
                spec={spec}
                value={tokenValue(spec)}
                onChange={(hex) => setToken(spec.token, hex)}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={reset}
            className="mt-[14px] inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-[14px] py-2 text-[11.5px] font-semibold text-fg hover:border-olive hover:text-olive"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Reset to defaults
          </button>
          <p className="mt-3 rounded-lg bg-olive-lt px-3 py-2.5 text-[10.5px] leading-[1.55] text-fg-muted">
            Every screen reads from these tokens, so edits ripple through the whole console live. A
            few one-off status tints stay inline by design and aren&apos;t exposed here.
          </p>
        </Card>
      </div>
    </div>
  );
}
