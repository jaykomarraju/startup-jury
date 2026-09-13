import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Cpu, Calculator, Eye } from "lucide-react";
import { Card } from "../../components";
import { updateThresholds } from "../../api";
import {
  DEFAULT_SCORING_SETTINGS,
  SCORE_SCALE_BOUNDS,
  deltaFromDisplayScale,
  deltaToDisplayScale,
  formatPoints,
  fromDisplayScale,
  toDisplayScale,
  type ScoringSettings,
} from "../../../shared/scoring";
import {
  AI_WEIGHT_CHOICES,
  COMPOSITE_FORMULAS,
  SCORE_SCALES,
  type CompositeFormula,
  type ScoreScale,
} from "../../../shared/types";
import { useAdminSave } from "./saveContext";
import {
  getScoringFramework,
  invalidateScoringSettings,
  saveScoringFramework,
} from "./scoringApi";

/**
 * Admin console → Evaluation → **Scoring framework** (prototype `admin/s-fw.html`).
 *
 * Three cards: AI engine behaviour, Score composition (including the cohort
 * rating thresholds) and Score transparency & reports. Every control here is
 * honoured somewhere in the evaluation path — the AI pass itself, the
 * clarification trigger, what an evaluator is served before they score, what
 * the composite MEANS, and what the report carries. Nothing on this screen is
 * decoration.
 *
 * §1.2 — the prototype's fourth transparency toggle, "Mentor can adjust
 * composite after all jury complete", is deliberately absent: `mentor` is a
 * directory record with no pipeline authority (commit 8822db2), so the column
 * does not exist and must not be added.
 *
 * The section has no save control of its own (F0168): the console title bar's
 * single **Save changes** commits it, wired through `useAdminSave`.
 */

// ── The prototype's `.tog` pill ───────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  label,
  sub,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  sub?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line py-2.5 last:border-0">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-fg">{label}</div>
        {sub && <div className="mt-0.5 text-[11.5px] text-fg-muted">{sub}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="mt-0.5 inline-flex h-[18px] w-[34px] shrink-0 items-center rounded-full p-[2px] transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        style={{ background: checked ? "var(--ac-olive, #4A6644)" : "var(--color-line)" }}
      >
        <span
          className="h-[14px] w-[14px] rounded-full bg-white transition-transform"
          style={{ transform: checked ? "translateX(16px)" : "translateX(0)" }}
        />
      </button>
    </div>
  );
}

function CardTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="mb-1 flex items-center gap-2 text-[13px] font-semibold text-fg">
      <span style={{ color: "var(--ac-olive, #4A6644)" }}>{icon}</span>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11.5px] font-medium text-fg-muted">{label}</span>
      {children}
    </label>
  );
}

/** `admin/s-fw.html` — the 8×8 rounded colour chip beside a threshold label. */
function Swatch({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="mr-1.5 inline-block h-2 w-2 rounded-[2px] align-middle"
      style={{ background: color }}
    />
  );
}

const FORMULA_LABELS: Record<CompositeFormula, string> = {
  weighted_average: "Weighted average (default)",
  unweighted_average: "Unweighted average",
  median: "Median",
};

/** `admin/s-fw.html` — the four splits the "AI weight in composite" select offers. */
function aiWeightLabel(pct: number): string {
  return pct === 0 ? "0% (jury only)" : `${pct}% AI · ${100 - pct}% Jury`;
}

/** `updThr()` in the prototype: NaN → default, poor clamped to best, one decimal. */
function fmt1(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}

export function ScoringFrameworkSection() {
  const [settings, setSettings] = useState<ScoringSettings | null>(null);
  const [best, setBest] = useState(7);
  const [poor, setPoor] = useState(5);
  const [editable, setEditable] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [rescored, setRescored] = useState<number | null>(null);

  useEffect(() => {
    getScoringFramework()
      .then((r) => {
        setSettings(r.scoring);
        setBest(r.thresholdBest);
        setPoor(r.thresholdMediocre);
        setEditable(r.editable);
      })
      .catch(() => setLoadError(true));
  }, []);

  const patch = useCallback((p: Partial<ScoringSettings>) => {
    setSettings((s) => (s ? { ...s, ...p } : s));
    setDirty(true);
    setRescored(null);
  }, []);

  const save = useCallback(async () => {
    if (!settings) return;
    setSaving(true);
    setSaveError(null);
    try {
      // The prototype clamps Poor to Best live; the server refuses an inverted
      // pair outright, so clamp before sending rather than surfacing a 400.
      const safePoor = Math.min(poor, best);
      const [framework] = await Promise.all([
        saveScoringFramework(settings),
        updateThresholds(best, safePoor),
      ]);
      setPoor(safePoor);
      setRescored(framework.rescored.decks);
      invalidateScoringSettings();
      setDirty(false);
    } catch {
      setSaveError("Couldn't save the scoring framework. Check each value and try again.");
    } finally {
      setSaving(false);
    }
  }, [settings, best, poor]);

  useAdminSave(
    settings && editable
      ? { dirty, saving, onSave: save, hint: dirty ? undefined : "No unsaved changes" }
      : null,
  );

  const preview = useMemo(
    () => ({ best: fmt1(best), poorTop: fmt1(best - 0.1), poor: fmt1(Math.min(poor, best)) }),
    [best, poor],
  );

  if (loadError) {
    return (
      <SectionShell>
        <Card>
          <p className="text-[13px] text-fg-muted">
            Couldn&apos;t load the scoring framework. Reload the console to try again.
          </p>
        </Card>
      </SectionShell>
    );
  }
  if (!settings) {
    return (
      <SectionShell>
        <Card>
          <p className="text-[13px] text-fg-muted">Loading…</p>
        </Card>
      </SectionShell>
    );
  }

  const ro = !editable;

  return (
    <SectionShell>
      {ro && (
        <p className="rounded-md border border-line bg-surface-2 px-3 py-2 text-[12px] text-fg-muted">
          Read-only — only an administrator can change how scores are computed.
        </p>
      )}

      {/* ── Card 1 · AI engine behaviour ─────────────────────────────────── */}
      <Card>
        <CardTitle icon={<Cpu className="h-[15px] w-[15px]" />}>AI engine behaviour</CardTitle>
        <Toggle
          disabled={ro}
          checked={settings.aiPreScoringEnabled}
          onChange={(v) => patch({ aiPreScoringEnabled: v })}
          label="AI pre-scoring enabled"
          sub="AI reads and scores every deck before jury sees it"
        />
        <Toggle
          disabled={ro}
          checked={settings.autoClarification}
          onChange={(v) => patch({ autoClarification: v })}
          label="Auto-trigger clarification questions"
          sub="Send targeted questions to startup when AI detects weak signal"
        />
        <Toggle
          disabled={ro}
          checked={settings.showAiScoreToJury}
          onChange={(v) => patch({ showAiScoreToJury: v })}
          label="Show AI score to jury before they score"
          sub="Turn off for blind independent jury evaluation"
        />
        <Toggle
          disabled={ro}
          checked={settings.requireOverrideRationale}
          onChange={(v) => patch({ requireOverrideRationale: v })}
          label="Require override rationale"
          sub={`Jury must explain overrides greater than ${formatPoints(settings.overrideRationaleDelta, settings.scoreScale)} from AI score`}
        />
        {settings.requireOverrideRationale && (
          <div className="mt-2.5 max-w-[14rem]">
            <Field label="Override threshold (points)">
              {/* W7-D (§9): stored and enforced canonical 0–10, authored on the
                  org's own scale — a 1–5 admin types "1 point" and means one of
                  THEIR points. A delta is a distance: it converts by span. */}
              <input
                className="sj-input"
                type="number"
                min={0}
                max={deltaToDisplayScale(10, settings.scoreScale)}
                step={SCORE_SCALE_BOUNDS[settings.scoreScale].step}
                disabled={ro}
                value={deltaToDisplayScale(settings.overrideRationaleDelta, settings.scoreScale)}
                onChange={(e) =>
                  patch({
                    overrideRationaleDelta: deltaFromDisplayScale(Number(e.target.value), settings.scoreScale),
                  })
                }
              />
            </Field>
          </div>
        )}
        <div className="mt-2.5">
          <Toggle
            disabled={ro}
            checked={settings.jurySeesPeerScores}
            onChange={(v) => patch({ jurySeesPeerScores: v })}
            label="Jury can see each other's scores"
            sub="Turn off for fully independent scoring rounds"
          />
        </div>
      </Card>

      {/* ── Card 2 · Score composition ───────────────────────────────────── */}
      <Card>
        <CardTitle icon={<Calculator className="h-[15px] w-[15px]" />}>Score composition</CardTitle>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <Field label="Score scale">
            <select
              className="sj-input"
              disabled={ro}
              value={settings.scoreScale}
              onChange={(e) => patch({ scoreScale: e.target.value as ScoreScale })}
            >
              {SCORE_SCALES.map((s) => (
                <option key={s} value={s}>
                  {SCORE_SCALE_BOUNDS[s].label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Composite formula">
            <select
              className="sj-input"
              disabled={ro}
              value={settings.compositeFormula}
              onChange={(e) => patch({ compositeFormula: e.target.value as CompositeFormula })}
            >
              {COMPOSITE_FORMULAS.map((f) => (
                <option key={f} value={f}>
                  {FORMULA_LABELS[f]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="AI weight in composite">
            <select
              className="sj-input"
              disabled={ro}
              value={settings.aiWeightPct}
              onChange={(e) => patch({ aiWeightPct: Number(e.target.value) })}
            >
              {AI_WEIGHT_CHOICES.map((p) => (
                <option key={p} value={p}>
                  {aiWeightLabel(p)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Shortlist threshold">
            {/* W7-D (§9): a position on the scale — canonical 0–10 stored, the
                org's scale shown and typed. Identity on the default 0–10. */}
            <input
              className="sj-input"
              type="number"
              min={SCORE_SCALE_BOUNDS[settings.scoreScale].min}
              max={SCORE_SCALE_BOUNDS[settings.scoreScale].max}
              step={settings.scoreScale === "0-100" ? 1 : 0.1}
              disabled={ro}
              value={toDisplayScale(settings.shortlistThreshold, settings.scoreScale)}
              onChange={(e) =>
                patch({ shortlistThreshold: fromDisplayScale(Number(e.target.value), settings.scoreScale) })
              }
            />
          </Field>
        </div>
        <p className="mt-2 text-[11px] text-fg-muted">
          A programme with its own shortlist minimum overrides this; every other deck is held to
          the organisation&apos;s threshold. Changing the scale, formula or split re-scores every
          stored evaluation in this workspace.
        </p>

        <div className="my-3.5 border-t border-line" />

        <div className="text-[11.5px] font-medium text-fg-muted">Cohort rating thresholds</div>
        <p className="mb-2.5 mt-1 text-[12px] text-fg-muted">
          Define the rating bands evaluators see on the <strong className="text-fg">All Decks</strong>{" "}
          overview. <strong className="text-fg">Best</strong> is at or above the upper value,{" "}
          <strong className="text-fg">Poor</strong> is below the lower value, and{" "}
          <strong className="text-fg">Mediocre</strong> is the band in between.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={
              <>
                <Swatch color="var(--color-green, #16A34A)" />
                Best — at or above
              </>
            }
          >
            <input
              className="sj-input"
              type="number"
              min={0}
              max={10}
              step={0.1}
              disabled={ro}
              value={best}
              onChange={(e) => {
                const v = Number(e.target.value);
                setBest(Number.isFinite(v) ? v : 7);
                setDirty(true);
              }}
            />
          </Field>
          <Field
            label={
              <>
                <Swatch color="var(--color-red, #B42318)" />
                Poor — below
              </>
            }
          >
            <input
              className="sj-input"
              type="number"
              min={0}
              max={10}
              step={0.1}
              disabled={ro}
              value={poor}
              onChange={(e) => {
                const v = Number(e.target.value);
                // The prototype clamps live: Poor can never exceed Best.
                setPoor(Math.min(Number.isFinite(v) ? v : 5, best));
                setDirty(true);
              }}
            />
          </Field>
        </div>
        <div
          className="mt-2.5 flex flex-wrap gap-3.5 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[11.5px] text-fg"
          data-testid="threshold-preview"
        >
          <span>
            <Swatch color="var(--color-green, #16A34A)" />
            Best ≥ {preview.best}
          </span>
          <span>
            <Swatch color="var(--color-accent, #E8A020)" />
            Mediocre {preview.poor} – {preview.poorTop}
          </span>
          <span>
            <Swatch color="var(--color-red, #B42318)" />
            Poor &lt; {preview.poor}
          </span>
        </div>
      </Card>

      {/* ── Card 3 · Score transparency & reports ────────────────────────── */}
      <Card>
        <CardTitle icon={<Eye className="h-[15px] w-[15px]" />}>
          Score transparency &amp; reports
        </CardTitle>
        <Toggle
          disabled={ro}
          checked={settings.showThreeScoreView}
          onChange={(v) => patch({ showThreeScoreView: v })}
          label="Show 3-score view (AI · Mine · Average)"
        />
        <Toggle
          disabled={ro}
          checked={settings.showScoreDrift}
          onChange={(v) => patch({ showScoreDrift: v })}
          label="Show score drift analysis in reports"
        />
        <Toggle
          disabled={ro}
          checked={settings.includeAiEvidence}
          onChange={(v) => patch({ includeAiEvidence: v })}
          label="Include AI evidence quotes in reports"
          sub="Show which deck text drove each area's AI score"
        />
        <Toggle
          disabled={ro}
          checked={settings.introCallAiPrompts}
          onChange={(v) => patch({ introCallAiPrompts: v })}
          label="Intro call AI question prompts enabled"
          sub="AI generates tailored questions for jury to use during startup calls"
        />
      </Card>

      {saveError && <p className="text-[12.5px] text-signal-flagged">{saveError}</p>}
      {rescored !== null && (
        <p className="text-[12.5px] text-fg-muted" role="status">
          Saved{rescored > 0 ? ` — ${rescored} deck${rescored === 1 ? "" : "s"} re-scored.` : "."}
        </p>
      )}
    </SectionShell>
  );
}

function SectionShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold tracking-tight text-fg">Scoring framework</h2>
        <p className="mt-0.5 max-w-3xl text-[13px] text-fg-muted">
          Control how AI and jury scores are computed, displayed, and weighted across the platform.
        </p>
      </div>
      {children}
    </div>
  );
}

/** Exported for tests: the shipped defaults this section renders on a fresh org. */
export const SCORING_FRAMEWORK_DEFAULTS = DEFAULT_SCORING_SETTINGS;
