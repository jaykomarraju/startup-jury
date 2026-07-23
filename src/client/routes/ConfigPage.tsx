import { useEffect, useMemo, useState } from "react";
import { Card, Button, Badge, EmptyState } from "../components";
import {
  getConfig,
  updateWeights,
  updateThresholds,
  updateAiPrompt,
  updateBranding,
  updatePlan,
  updateCredits,
  type FullConfig,
  type ConfigParam,
} from "../api";
import { PLANS, PLAN_LABELS, type Plan } from "../../shared/plans";

/** Admin "Core Parameters" configuration screen (nav slug `coreparams`). Folds
 *  the prototype's Core Parameters / Settings (AI prompt) / Branding / Plans
 *  panels into one admin config surface: area weights (re-scores on save),
 *  cohort thresholds, the AI system prompt, branding, and plan tier + credits. */
export function ConfigPage() {
  const [cfg, setCfg] = useState<FullConfig | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    getConfig()
      .then(setCfg)
      .catch(() => setLoadError(true));
  }, []);

  if (loadError) {
    return (
      <div className="p-5">
        <h1 className="mb-5 text-xl font-semibold text-fg">Configuration</h1>
        <EmptyState icon="SlidersHorizontal" title="Couldn't load configuration" description="Try reloading the page." />
      </div>
    );
  }
  if (!cfg) {
    return (
      <div className="p-5">
        <h1 className="text-xl font-semibold text-fg">Configuration</h1>
        <p className="mt-2 text-sm text-fg-muted">Loading…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 p-5">
      <div>
        <h1 className="text-xl font-semibold text-fg">Configuration</h1>
        <p className="mt-0.5 max-w-2xl text-sm text-fg-muted">
          Core Parameters, cohort thresholds, the AI prompt, branding, and plan &amp; credits — changes persist and
          re-score the pipeline.
        </p>
      </div>
      <WeightsSection cfg={cfg} onChange={setCfg} />
      <ThresholdsSection cfg={cfg} />
      <AiPromptSection cfg={cfg} />
      <BrandingSection cfg={cfg} />
      <PlanCreditsSection cfg={cfg} onChange={setCfg} />
    </div>
  );
}

function SavedBadge({ show }: { show: boolean }) {
  return show ? <Badge tone="positive">Saved</Badge> : null;
}

// ── Core parameter weights ───────────────────────────────────────────────────

function WeightsSection({ cfg, onChange }: { cfg: FullConfig; onChange: (c: FullConfig) => void }) {
  const [weights, setWeights] = useState<Record<string, number>>(
    Object.fromEntries(cfg.coreParams.map((p) => [p.id, p.weight])),
  );
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = useMemo(() => Object.values(weights).reduce((s, w) => s + (Number(w) || 0), 0), [weights]);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const params = cfg.coreParams.map((p) => ({ id: p.id, weight: Number(weights[p.id]) || 0 }));
      const res = await updateWeights(params);
      onChange({ ...cfg, coreParams: res.coreParams });
      setSaved(true);
    } catch {
      setError("Couldn't save weights. Check each is between 0 and 100.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="u-label">Core Parameters — Area weights</div>
          <p className="mt-1 max-w-xl text-sm text-fg-muted">
            Set the percentage weight of each of the {cfg.coreParams.length} evaluation areas in the final composite
            score. Total should equal 100%.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <SavedBadge show={saved} />
          <Button size="sm" variant="primary" disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-signal-flagged">{error}</p>}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[32rem] text-left">
          <thead>
            <tr className="text-fg-muted">
              <th className="py-2 pr-3 text-xs font-medium uppercase tracking-wide">#</th>
              <th className="py-2 pr-3 text-xs font-medium uppercase tracking-wide">Evaluation area</th>
              <th className="py-2 pr-3 text-xs font-medium uppercase tracking-wide">Weight %</th>
              <th className="py-2 text-xs font-medium uppercase tracking-wide">Visual</th>
            </tr>
          </thead>
          <tbody>
            {cfg.coreParams.map((p, i) => (
              <tr key={p.id} className="border-t border-line">
                <td className="py-2.5 pr-3 font-mono text-xs text-fg-muted">{i + 1}</td>
                <td className="py-2.5 pr-3 text-sm text-fg">{p.name}</td>
                <td className="py-2.5 pr-3">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    className="sj-input h-8 w-20 py-0 text-sm"
                    aria-label={`${p.name} weight`}
                    value={weights[p.id] ?? 0}
                    onChange={(e) => setWeights((w) => ({ ...w, [p.id]: Number(e.target.value) }))}
                  />
                </td>
                <td className="py-2.5">
                  <div className="h-2 w-40 max-w-full overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${Math.min(100, Number(weights[p.id]) || 0)}%` }}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line">
              <td />
              <td className="py-2.5 pr-3 text-sm font-medium text-fg">Total</td>
              <td className="py-2.5 pr-3">
                <span className={`font-mono text-sm font-semibold ${total === 100 ? "text-positive" : "text-fg"}`}>
                  {total}%
                </span>
              </td>
              <td className="py-2.5 text-xs text-fg-muted">{total === 100 ? "Balanced" : "Should total 100%"}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}

// ── Cohort thresholds ─────────────────────────────────────────────────────────

function ThresholdsSection({ cfg }: { cfg: FullConfig }) {
  const [best, setBest] = useState(cfg.thresholdBest);
  const [mediocre, setMediocre] = useState(cfg.thresholdMediocre);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await updateThresholds(Number(best), Number(mediocre));
      setSaved(true);
    } catch {
      setError("Couldn't save. Best must be ≥ Mediocre, both between 0 and 10.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="u-label">Cohort rating thresholds</div>
          <p className="mt-1 text-sm text-fg-muted">Score bands that classify a deck as Best, Mediocre or Poor.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <SavedBadge show={saved} />
          <Button size="sm" variant="primary" disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
      {error && <p className="mt-3 text-sm text-signal-flagged">{error}</p>}
      <div className="mt-4 flex flex-wrap gap-6">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">Best ≥</span>
          <input
            type="number"
            min={0}
            max={10}
            step={0.1}
            className="sj-input h-9 w-24"
            aria-label="Best threshold"
            value={best}
            onChange={(e) => setBest(Number(e.target.value))}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">Mediocre ≥</span>
          <input
            type="number"
            min={0}
            max={10}
            step={0.1}
            className="sj-input h-9 w-24"
            aria-label="Mediocre threshold"
            value={mediocre}
            onChange={(e) => setMediocre(Number(e.target.value))}
          />
        </label>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">Preview</span>
          <div className="flex items-center gap-2 pt-1.5 text-xs">
            <Badge tone="positive">Best ≥ {best}</Badge>
            <Badge tone="info">
              {mediocre} – {(Number(best) - 0.1).toFixed(1)}
            </Badge>
            <Badge tone="neutral">Poor &lt; {mediocre}</Badge>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ── AI system prompt ──────────────────────────────────────────────────────────

function AiPromptSection({ cfg }: { cfg: FullConfig }) {
  const [prompt, setPrompt] = useState(cfg.aiSystemPrompt);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await updateAiPrompt(prompt);
      setSaved(true);
    } catch {
      setError("Couldn't save the prompt. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="u-label">AI prompt customisation</div>
          <p className="mt-1 max-w-xl text-sm text-fg-muted">
            Extra guidance appended to the AI evaluator's system prompt — tune how it reads decks and scores the rubric
            for your organisation.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <SavedBadge show={saved} />
          <Button size="sm" variant="primary" disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
      {error && <p className="mt-3 text-sm text-signal-flagged">{error}</p>}
      <textarea
        className="sj-input mt-4 min-h-[8rem] w-full font-mono text-xs"
        aria-label="AI system prompt"
        placeholder="e.g. Weight climate impact heavily; be skeptical of unaudited traction claims…"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />
    </Card>
  );
}

// ── Branding ──────────────────────────────────────────────────────────────────

function brandingField(branding: Record<string, unknown>, key: string, fallback: string): string {
  const v = branding[key];
  return typeof v === "string" ? v : fallback;
}

function BrandingSection({ cfg }: { cfg: FullConfig }) {
  const [wordmark, setWordmark] = useState(brandingField(cfg.branding, "wordmark", "STARTUPJURY"));
  const [tagline, setTagline] = useState(brandingField(cfg.branding, "tagline", "Venture Intelligence First"));
  const [accent, setAccent] = useState(brandingField(cfg.branding, "accent", "#E8A020"));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await updateBranding({ wordmark, tagline, accent });
      setSaved(true);
    } catch {
      setError("Couldn't save branding. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="u-label">Branding &amp; theme</div>
          <p className="mt-1 text-sm text-fg-muted">The header wordmark, tagline and accent colour.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <SavedBadge show={saved} />
          <Button size="sm" variant="primary" disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
      {error && <p className="mt-3 text-sm text-signal-flagged">{error}</p>}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">Wordmark</span>
          <input className="sj-input h-9" aria-label="Wordmark" value={wordmark} onChange={(e) => setWordmark(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">Tagline</span>
          <input className="sj-input h-9" aria-label="Tagline" value={tagline} onChange={(e) => setTagline(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">Accent colour</span>
          <input
            type="color"
            className="h-9 w-16 rounded border border-line bg-surface"
            aria-label="Accent colour"
            value={accent}
            onChange={(e) => setAccent(e.target.value)}
          />
        </label>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">Live preview</span>
          <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
            <span className="text-lg font-bold" style={{ color: accent }}>
              ai
            </span>
            <span className="text-sm font-semibold tracking-tight text-fg">{wordmark}</span>
            <span className="text-xs text-fg-muted">· {tagline}</span>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ── Plan tier + credits ───────────────────────────────────────────────────────

function PlanCreditsSection({ cfg, onChange }: { cfg: FullConfig; onChange: (c: FullConfig) => void }) {
  const [plan, setPlan] = useState<Plan>(cfg.plan);
  const [credits, setCredits] = useState(cfg.creditsBalance);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const p = await updatePlan(plan);
      const cr = await updateCredits(Math.max(0, Math.floor(Number(credits) || 0)));
      onChange({ ...cfg, plan, additionalEnabled: p.additionalEnabled, creditsBalance: cr.creditsBalance });
      setCredits(cr.creditsBalance);
      setSaved(true);
    } catch {
      setError("Couldn't save plan or credits. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="u-label">Plan &amp; credits</div>
          <p className="mt-1 text-sm text-fg-muted">
            The plan tier gates the additional evaluation parameters. Credits are consumed one per deck uploaded.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <SavedBadge show={saved} />
          <Button size="sm" variant="primary" disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
      {error && <p className="mt-3 text-sm text-signal-flagged">{error}</p>}
      <div className="mt-4 flex flex-wrap gap-6">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">Plan tier</span>
          <select
            className="sj-input h-9 w-40"
            aria-label="Plan tier"
            value={plan}
            onChange={(e) => setPlan(e.target.value as Plan)}
          >
            {PLANS.map((p) => (
              <option key={p} value={p}>
                {PLAN_LABELS[p]}
              </option>
            ))}
          </select>
          <span className="text-xs text-fg-muted">
            {plan === "standard" ? "Core params only" : "Additional params unlocked"}
          </span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">Credits balance</span>
          <input
            type="number"
            min={0}
            className="sj-input h-9 w-32"
            aria-label="Credits balance"
            value={credits}
            onChange={(e) => setCredits(Number(e.target.value))}
          />
          <span className="text-xs text-fg-muted">Admin-granted upload credits.</span>
        </label>
      </div>
    </Card>
  );
}

export type { ConfigParam };
