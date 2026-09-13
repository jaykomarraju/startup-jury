import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Lock, Save, Target } from "lucide-react";
import { Card, Button, Badge, EmptyState, PanelFrame, ToolbarButton } from "../components";
import {
  getConfig,
  getConfigSummary,
  updateThresholds,
  updateAiPrompt,
  updateBranding,
  updatePlan,
  updateCredits,
  listPrograms,
  type FullConfig,
  type ConfigParam,
  type ProgramView,
} from "../api";
import { PLANS, PLAN_LABELS, PLAN_PRIVILEGES, planAllowsCore, type Plan } from "../../shared/plans";
import {
  REQUIRED_WEIGHT_TOTAL,
  SCORE_SCALE_BOUNDS,
  formatScore,
  fromDisplayScale,
  toDisplayScale,
  weightBarWidth,
  weightTotal,
  weightTotalMessage,
} from "../../shared/scoring";
import type { ScoreScale } from "../../shared/types";
import { useAuth } from "../auth/useAuth";
import { usePermissions } from "../auth/usePermissions";
import { useActiveContext } from "../activeContext";
import { editionLabel, type Edition } from "../../shared/roles";
import { scoringSettings } from "./admin/scoringApi";
import {
  getParameterConfig,
  saveCoreParams,
  type ParamView,
  type ParameterConfigView,
} from "./parametersApi";

/**
 * Core Parameters — Area weights (nav slug `coreparams`; prototype
 * `panel-coreparams.html`, renderers `cpRender` / `cpUpdWt` / `cpApplyPlan`, and
 * the VC Associate / Analyst builds' `cpApplyReadOnly`).
 *
 * The panel itself is the prototype's: the toolbar with Save changes and the
 * plan badge, "Area weights", the Applies-to card and the five-column table with
 * renameable area names, the Core chip, the ×3.3 bar and the remaining / over-by
 * footer. It renders from `GET /api/config/parameters`, which any workspace
 * member can read, so the read-only variant works for a role that may see the
 * screen without changing it (§8 Q119 — who SEES it is `nav.ts`, a §9 request).
 *
 * Below it, for the workspace's administrators only, the configuration the
 * application folds onto this screen — cohort thresholds, AI prompts (now with
 * each area's extraction prompt, §8 Q95), branding, and plan & credits. Those
 * need `GET /api/config` (console-gated) and are the prototype's Settings /
 * Branding / account surfaces, not this panel (F0519 / F0538, §9).
 */
export function ConfigPage() {
  const { user } = useAuth();
  const can = usePermissions();
  const edition: Edition = user?.edition ?? "incubator";
  const isConfigAdmin = user?.role === "admin" || user?.role === "superuser";
  const showAdminSections = isConfigAdmin && can("adminconsole");

  const [view, setView] = useState<ParameterConfigView | null>(null);
  const [viewError, setViewError] = useState(false);
  const [cfg, setCfg] = useState<FullConfig | null>(null);
  const [cfgError, setCfgError] = useState(false);
  const [scale, setScale] = useState<ScoreScale>("0-10");

  useEffect(() => {
    getParameterConfig()
      .then(setView)
      .catch(() => setViewError(true));
  }, []);

  useEffect(() => {
    if (!showAdminSections) return;
    getConfig()
      .then(setCfg)
      .catch(() => setCfgError(true));
  }, [showAdminSections]);

  // W7-D's 2(c) rule: thresholds are stored canonical 0–10 and shown on the
  // organisation's scale. Until the framework answers, 0–10 is the identity.
  useEffect(() => {
    scoringSettings()
      .then((s) => setScale(s.scoreScale))
      .catch(() => undefined);
  }, []);

  return view ? (
    <CoreParametersPanel edition={edition} view={view} onChange={setView}>
      {showAdminSections && (
        <AdminSections cfg={cfg} cfgError={cfgError} view={view} scale={scale} onCfg={setCfg} onView={setView} />
      )}
    </CoreParametersPanel>
  ) : (
    <PanelFrame title={CORE_TITLE} subtitle={CORE_SUBTITLE}>
      {viewError ? (
        <EmptyState icon="SlidersHorizontal" title="Couldn't load the core parameters" description="Try reloading the page." />
      ) : (
        <p className="text-sm text-fg-muted">Loading…</p>
      )}
      {showAdminSections && (
        <AdminSections cfg={cfg} cfgError={cfgError} view={null} scale={scale} onCfg={setCfg} onView={setView} />
      )}
    </PanelFrame>
  );
}

const CORE_TITLE = "Core Parameters — Area weights";
const CORE_SUBTITLE = "Configure the 13 core evaluation areas and their weights";

function SavedBadge({ show }: { show: boolean }) {
  return show ? <Badge tone="positive">Saved</Badge> : null;
}

/** `.cp-plan-badge.tier-*` — Premium gold, Pro olive, Standard stone. */
const PLAN_BADGE: Record<Plan, string> = {
  premium: "bg-gold-lt text-gold-dk",
  pro: "bg-olive-lt text-olive-dk",
  standard: "bg-stone text-fg-muted",
};

// ── The prototype's panel ────────────────────────────────────────────────────

function CoreParametersPanel({
  edition,
  view,
  onChange,
  children,
}: {
  edition: Edition;
  view: ParameterConfigView;
  onChange: (v: ParameterConfigView) => void;
  children?: React.ReactNode;
}) {
  const [names, setNames] = useState<Record<string, string>>(
    Object.fromEntries(view.coreParams.map((p) => [p.id, p.name])),
  );
  const [weights, setWeights] = useState<Record<string, number>>(
    Object.fromEntries(view.coreParams.map((p) => [p.id, p.weight])),
  );
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ decks: number; evaluations: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const total = useMemo(
    () => weightTotal(view.coreParams.map((p) => Number(weights[p.id]) || 0)),
    [view.coreParams, weights],
  );
  const footer = weightTotalMessage(total);
  const balanced = total === REQUIRED_WEIGHT_TOTAL;
  // `cpApplyReadOnly` — a role that may see the weights but not change them (§8 Q6(a)).
  const roleReadOnly = !view.coreEditor;
  // `cpApplyPlan` — the plan that governs this member cannot configure the core 13.
  const planLocked = !view.coreConfigEnabled;
  const locked = roleReadOnly || planLocked;
  const namesValid = view.coreParams.every((p) => (names[p.id] ?? "").trim());

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const res = await saveCoreParams(
        view.coreParams.map((p) => ({
          id: p.id,
          weight: Number(weights[p.id]) || 0,
          name: (names[p.id] ?? p.name).trim(),
        })),
      );
      onChange({ ...view, coreParams: res.coreParams });
      setSaved(res.rescored);
    } catch {
      setError("Couldn't save. Every area needs a name, each weight must be 0–100 and the total exactly 100%.");
    } finally {
      setBusy(false);
    }
  }

  const note = roleReadOnly
    ? `Read-only — Core Parameters are governed by the Super User. You can view the ${edition === "vc" ? "firm" : "organisation"}’s area weights but can’t change them.`
    : planLocked
      ? `Read-only — configuring core parameters requires the Pro or Premium plan. Your current plan is ${PLAN_LABELS[view.effectivePlan]} plan.`
      : null;

  return (
    <PanelFrame
      title={CORE_TITLE}
      subtitle={
        <>
          {CORE_SUBTITLE}{" "}
          <span
            data-testid="plan-badge"
            className={`ml-1 inline-block rounded-[10px] px-2 py-[2px] align-[1px] text-[10px] font-bold uppercase tracking-[0.04em] ${PLAN_BADGE[view.effectivePlan]}`}
          >
            {PLAN_LABELS[view.effectivePlan]} plan
          </span>
        </>
      }
      actions={
        roleReadOnly ? undefined : (
          <>
            {saved && (
              <Badge tone="positive">
                Saved · re-scored {saved.decks} decks, {saved.evaluations} evaluations
              </Badge>
            )}
            <ToolbarButton
              primary
              // W2-A / F0153 — the server refuses a rubric that does not total
              // 100 %, so the button must not offer a save that cannot succeed.
              disabled={busy || locked || !balanced || !namesValid}
              title={balanced ? undefined : footer.text}
              onClick={save}
            >
              <Save className="h-3 w-3" aria-hidden="true" />
              {busy ? "Saving…" : "Save changes"}
            </ToolbarButton>
          </>
        )
      }
    >
      <div className="flex max-w-4xl flex-col">
        <h2 className="mb-[3px] text-[18px] font-bold tracking-[-0.02em] text-fg">Area weights</h2>
        <p className="mb-5 text-[12.5px] text-fg-muted">
          Set the percentage weight of each of the {view.coreParams.length} evaluation areas in the final composite
          score. Evaluation area names are configurable. Total must equal 100%.
        </p>

        {note && (
          <p
            role="note"
            className="mb-3.5 flex items-center gap-[7px] rounded-[9px] border border-[#E8C77A] bg-[#FBF3E6] px-[13px] py-2.5 text-[11.5px] text-[#854F0B]"
          >
            <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{note}</span>
          </p>
        )}
        {error && <p className="mb-3 text-sm text-signal-flagged">{error}</p>}

        <AppliesToSection edition={edition} />

        <div className="mb-3 rounded-[10px] border border-line bg-surface p-4">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] border-collapse text-left">
              <thead>
                <tr>
                  {["#", "Evaluation area", "Type", "Weight %", "Visual"].map((h) => (
                    <th
                      key={h}
                      className="border-b-[1.5px] border-stone px-2 py-1.5 text-[9px] font-bold uppercase tracking-[0.07em] text-fg-muted"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {view.coreParams.map((p, i) => (
                  <tr key={p.id} className="border-b border-offwhite last:border-b-0 hover:bg-offwhite">
                    <td className="px-2 py-[7px] font-mono text-[10px] text-fg-muted">{String(i + 1).padStart(2, "0")}</td>
                    <td className="px-2 py-[7px]">
                      <input
                        className="w-full min-w-[170px] rounded-md border border-line bg-surface px-2 py-1.5 text-xs font-medium text-fg outline-none focus:border-gold-dk disabled:cursor-not-allowed disabled:opacity-70"
                        aria-label={`${p.name} name`}
                        disabled={locked}
                        value={names[p.id] ?? p.name}
                        onChange={(e) => {
                          setSaved(null);
                          setNames((n) => ({ ...n, [p.id]: e.target.value }));
                        }}
                      />
                    </td>
                    <td className="px-2 py-[7px]">
                      <span className="whitespace-nowrap rounded-[3px] bg-olive-lt px-1.5 py-px text-[9px] font-bold text-olive-dk">
                        Core
                      </span>
                    </td>
                    <td className="px-2 py-[7px]">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        disabled={locked}
                        className="w-[50px] rounded-[5px] border border-line bg-surface px-1.5 py-1 text-center font-mono text-xs text-fg outline-none focus:border-gold-dk disabled:cursor-not-allowed disabled:opacity-70"
                        aria-label={`${p.name} weight`}
                        value={weights[p.id] ?? 0}
                        onChange={(e) => {
                          setSaved(null);
                          setWeights((w) => ({ ...w, [p.id]: Number(e.target.value) }));
                        }}
                      />
                    </td>
                    <td className="px-2 py-[7px]">
                      <div className="inline-block h-[5px] w-[70px] overflow-hidden rounded-[3px] bg-stone align-middle">
                        <div
                          className="h-full rounded-[3px] bg-olive transition-[width]"
                          style={{ width: `${weightBarWidth(Number(weights[p.id]) || 0)}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* `#cp-wt-foot` — "Total: 100% ✓", "— N% remaining", "— over by N%". */}
          <div
            data-testid="core-weight-total"
            className="mt-1.5 rounded-md bg-offwhite px-2.5 py-2 text-right font-mono text-[11.5px] font-semibold text-fg"
          >
            Total: <span className={footer.ok ? "text-green" : "text-red"}>{total}%</span>
            {footer.text.slice(`Total: ${total}%`.length)}
          </div>
        </div>
      </div>
      {children}
    </PanelFrame>
  );
}

// ── Applies to (program / cohort scope) ──────────────────────────────────────

/** The prototype's "Applies to" card. The core weights are edition-wide (F0516 /
 *  F0518 — per-programme weight sets are not built); this sets the member's
 *  working programme & cohort view, shared with the decks toolbar. */
function AppliesToSection({ edition }: { edition: Edition }) {
  const [ctx, setCtx] = useActiveContext(edition);
  const [programs, setPrograms] = useState<ProgramView[]>([]);

  useEffect(() => {
    listPrograms()
      .then((r) => setPrograms(r.programs))
      .catch(() => setPrograms([]));
  }, []);

  const activeProgram = programs.find((p) => p.id === ctx.programId) ?? null;
  const cohortOptions = activeProgram?.cohorts ?? [];

  return (
    <div className="mb-3 rounded-[10px] border border-line bg-surface p-4">
      <div className="mb-3 flex items-center gap-[5px] text-[10px] font-bold uppercase tracking-[0.06em] text-olive-dk">
        <Target className="h-3.5 w-3.5" aria-hidden="true" /> Applies to
      </div>
      <div className="grid max-w-xl gap-2.5 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-[0.05em] text-fg-muted">Program</span>
          <select
            className="sj-input h-9"
            aria-label="Applies-to program"
            value={ctx.programId ?? ""}
            onChange={(e) => setCtx({ programId: e.target.value || null, cohortId: null })}
          >
            <option value="">All programs</option>
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-[0.05em] text-fg-muted">Cohort</span>
          <select
            className="sj-input h-9 disabled:opacity-50"
            aria-label="Applies-to cohort"
            value={ctx.cohortId ?? ""}
            disabled={!activeProgram || cohortOptions.length === 0}
            onChange={(e) => setCtx({ programId: ctx.programId, cohortId: e.target.value || null })}
          >
            <option value="">All cohorts</option>
            {cohortOptions.map((ch) => (
              <option key={ch.id} value={ch.id}>
                {ch.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="mt-2 max-w-xl text-[11.5px] text-fg-muted">
        The core weights apply across the whole {editionLabel(edition)} edition, not to one program or cohort; this sets
        your working program &amp; cohort view (shared with the decks toolbar).
      </p>
    </div>
  );
}

// ── The administrators' folded sections ──────────────────────────────────────

function AdminSections({
  cfg,
  cfgError,
  view,
  scale,
  onCfg,
  onView,
}: {
  cfg: FullConfig | null;
  cfgError: boolean;
  view: ParameterConfigView | null;
  scale: ScoreScale;
  onCfg: (c: FullConfig) => void;
  onView: (v: ParameterConfigView) => void;
}) {
  if (cfgError) {
    return (
      <EmptyState icon="SlidersHorizontal" title="Couldn't load configuration" description="Try reloading the page." />
    );
  }
  if (!cfg) return null;
  return (
    <div className="mt-5 flex max-w-4xl flex-col gap-5 border-t border-line pt-5">
      <ThresholdsSection cfg={cfg} scale={scale} />
      <AiPromptSection cfg={cfg} view={view} onView={onView} />
      <BrandingSection cfg={cfg} />
      <PlanCreditsSection cfg={cfg} onChange={onCfg} />
    </div>
  );
}

// ── Cohort thresholds ─────────────────────────────────────────────────────────

/**
 * W7-D's 2(c) rule (§9, `W8-B`): both thresholds are stored canonical 0–10 and
 * are POSITIONS on the scale, so they are shown and typed on the organisation's
 * scale through `toDisplayScale` / `fromDisplayScale` and labelled with
 * `formatScore`. On 0–10 every conversion is the identity.
 */
function ThresholdsSection({ cfg, scale }: { cfg: FullConfig; scale: ScoreScale }) {
  const bounds = SCORE_SCALE_BOUNDS[scale];
  // What the admin typed, ON `draft.scale`. Re-seeded when the scale arrives
  // (the framework read is async) unless the admin has already typed.
  const [stored, setStored] = useState({ best: cfg.thresholdBest, mediocre: cfg.thresholdMediocre });
  const [draft, setDraft] = useState(() => ({
    scale,
    dirty: false,
    best: toDisplayScale(cfg.thresholdBest, scale),
    mediocre: toDisplayScale(cfg.thresholdMediocre, scale),
  }));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft((d) => {
      if (d.scale === scale) return d;
      const best = d.dirty ? fromDisplayScale(d.best, d.scale) : stored.best;
      const mediocre = d.dirty ? fromDisplayScale(d.mediocre, d.scale) : stored.mediocre;
      return {
        scale,
        dirty: d.dirty,
        best: toDisplayScale(best, scale),
        mediocre: toDisplayScale(mediocre, scale),
      };
    });
  }, [scale, stored]);

  const bestCanonical = fromDisplayScale(Number(draft.best), draft.scale);
  const mediocreCanonical = fromDisplayScale(Number(draft.mediocre), draft.scale);
  // One display step below Best — the top of the Mediocre band as the org reads it.
  const unit = 10 ** -bounds.decimals;
  const mediocreTop = (toDisplayScale(bestCanonical, scale) - unit).toFixed(bounds.decimals);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await updateThresholds(bestCanonical, mediocreCanonical);
      setStored({ best: res.thresholdBest, mediocre: res.thresholdMediocre });
      setDraft((d) => ({ ...d, dirty: false }));
      setSaved(true);
    } catch {
      setError(`Couldn't save. Best must be ≥ Mediocre, both between ${bounds.min} and ${bounds.max}.`);
    } finally {
      setBusy(false);
    }
  }

  function edit(field: "best" | "mediocre", value: string) {
    setSaved(false);
    setDraft((d) => ({ ...d, dirty: true, [field]: Number(value) }));
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="u-label">Cohort rating thresholds</div>
          <p className="mt-1 text-sm text-fg-muted">
            Score bands that classify a deck as Best, Mediocre or Poor, on your {bounds.min}–{bounds.max} scale.
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
          <span className="text-xs font-medium text-fg-muted">Best ≥</span>
          <input
            type="number"
            min={bounds.min}
            max={bounds.max}
            step={unit}
            className="sj-input h-9 w-24"
            aria-label="Best threshold"
            value={draft.best}
            onChange={(e) => edit("best", e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">Mediocre ≥</span>
          <input
            type="number"
            min={bounds.min}
            max={bounds.max}
            step={unit}
            className="sj-input h-9 w-24"
            aria-label="Mediocre threshold"
            value={draft.mediocre}
            onChange={(e) => edit("mediocre", e.target.value)}
          />
        </label>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">Preview</span>
          <div className="flex items-center gap-2 pt-1.5 text-xs" data-testid="config-threshold-preview">
            <Badge tone="positive">Best ≥ {formatScore(bestCanonical, scale)}</Badge>
            <Badge tone="info">
              {formatScore(mediocreCanonical, scale)} – {mediocreTop}
            </Badge>
            <Badge tone="neutral">Poor &lt; {formatScore(mediocreCanonical, scale)}</Badge>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ── AI prompts ────────────────────────────────────────────────────────────────

function AiPromptSection({
  cfg,
  view,
  onView,
}: {
  cfg: FullConfig;
  view: ParameterConfigView | null;
  onView: (v: ParameterConfigView) => void;
}) {
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
      {view && view.coreEditor && view.coreParams.length > 0 && <AreaPrompts view={view} onView={onView} />}
    </Card>
  );
}

/**
 * Each core area's AI extraction prompt (§8 Q95 — core-prompt editing belongs to
 * Core Parameters), drawn as the prototype Settings panel's `.area-accordion`:
 * number, name, Core chip, Customised / Not set, and the extraction prompt box.
 * The signal-band text is the console's Rubric anchors; the clarification-trigger
 * box has no storage and is not drawn (§7 `W8-B`).
 */
function AreaPrompts({ view, onView }: { view: ParameterConfigView; onView: (v: ParameterConfigView) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="mt-5">
      <div className="u-label mb-2">Extraction prompts per evaluation area</div>
      {view.coreParams.map((p, i) => (
        <AreaPromptRow
          key={p.id}
          index={i + 1}
          param={p}
          view={view}
          open={open === p.id}
          onToggle={() => setOpen((o) => (o === p.id ? null : p.id))}
          onView={onView}
        />
      ))}
    </div>
  );
}

function AreaPromptRow({
  index,
  param,
  view,
  open,
  onToggle,
  onView,
}: {
  index: number;
  param: ParamView;
  view: ParameterConfigView;
  open: boolean;
  onToggle: () => void;
  onView: (v: ParameterConfigView) => void;
}) {
  const [prompt, setPrompt] = useState(param.prompt ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = !view.coreConfigEnabled;

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      // The route takes the whole rubric; the stored weights already total 100.
      const res = await saveCoreParams(
        view.coreParams.map((p) => ({
          id: p.id,
          weight: p.weight,
          ...(p.id === param.id ? { prompt: prompt.trim() } : {}),
        })),
      );
      onView({ ...view, coreParams: res.coreParams });
      setSaved(true);
    } catch {
      setError("Couldn't save the prompt. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-2 overflow-hidden rounded-[9px] border border-line">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={`flex w-full items-center gap-2.5 px-3.5 py-[11px] text-left ${open ? "border-b border-line bg-olive-lt" : "bg-offwhite"}`}
      >
        <span className="w-[22px] shrink-0 font-mono text-[10px] font-bold text-fg-muted">
          {String(index).padStart(2, "0")}
        </span>
        <span className="flex-1 text-[12.5px] font-semibold text-fg">{param.name}</span>
        <span className="rounded bg-olive-lt px-[7px] py-[2px] text-[9px] font-bold text-olive-dk">Core</span>
        <span
          className={`ml-auto rounded-[5px] px-2 py-[2px] text-[10px] font-semibold ${param.prompt ? "bg-[#FAEEDA] text-gold-dk" : "bg-offwhite text-fg-muted"}`}
        >
          {param.prompt ? "Customised" : "Not set"}
        </span>
        <ChevronDown className={`h-3.5 w-3.5 text-fg-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="bg-surface px-3.5 py-4">
          <div className="overflow-hidden rounded-[7px] border border-line">
            <div className="border-b border-line bg-offwhite px-2.5 py-[5px] text-[9px] font-bold uppercase tracking-[0.05em] text-fg-muted">
              System prompt for AI extraction
            </div>
            <textarea
              className="block min-h-[70px] w-full resize-y border-0 bg-surface p-2.5 text-[11.5px] text-fg outline-none disabled:opacity-60"
              aria-label={`Extraction prompt for ${param.name}`}
              disabled={locked}
              value={prompt}
              onChange={(e) => {
                setSaved(false);
                setPrompt(e.target.value);
              }}
            />
          </div>
          {error && <p className="mt-2 text-sm text-signal-flagged">{error}</p>}
          <div className="mt-2 flex items-center gap-2">
            <Button
              size="sm"
              variant="primary"
              disabled={busy || locked || prompt.trim() === (param.prompt ?? "")}
              onClick={save}
            >
              {busy ? "Saving…" : "Save prompts"}
            </Button>
            <SavedBadge show={saved} />
          </div>
        </div>
      )}
    </div>
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
      // PUT /api/config/branding REPLACES branding_json wholesale, so posting
      // only the three fields this card edits silently wiped `orgName` and
      // `orgType` — written by the Set up wizard and read back by the account
      // screen and the founder resubmit email. Re-read and merge, exactly as
      // SetupWizard.saveOrg() already does.
      const current = await getConfigSummary()
        .then((c) => c.branding)
        .catch(() => cfg.branding);
      await updateBranding({ ...current, wordmark, tagline, accent });
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
      onChange({
        ...cfg,
        plan,
        coreConfigEnabled: planAllowsCore(plan),
        additionalEnabled: p.additionalEnabled,
        creditsBalance: cr.creditsBalance,
      });
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
            Standard = no parameter config · Pro = configure the 13 core areas · Premium = core plus 3 additional
            params per role. Credits are consumed one per deck uploaded.
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
          <span className="max-w-[10rem] text-xs text-fg-muted">{PLAN_PRIVILEGES[plan]}</span>
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
