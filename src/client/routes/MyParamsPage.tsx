import { useCallback, useEffect, useMemo, useState } from "react";
import { Briefcase, Eye, Info, Lock, Save, ShieldCheck, UserCheck, UserPlus, Users, X } from "lucide-react";
import { useAuth } from "../auth/useAuth";
import { Badge, EmptyState, PanelFrame, ToolbarButton } from "../components";
import { PLAN_LABELS } from "../../shared/plans";
import {
  ADDITIONAL_PARAM_OWNERS,
  MAX_ADDITIONAL_PER_ROLE,
  roleLabel,
  type Edition,
  type Role,
} from "../../shared/roles";
import {
  addRoleParam,
  getParameterConfig,
  removeRoleParam,
  saveRoleParam,
  type ParameterConfigView,
  type RoleParamPatch,
  type RoleParamView,
} from "./parametersApi";

/**
 * My Parameters — Role configuration (nav slug `myparams`; prototype
 * `AISJ_IC_SuserV15` / `AISJ_VC_Superuser_V8` `panel-myparams.html`).
 *
 * The role-scoped ADDITIONAL parameters: three per owning role, on top of the 13
 * core areas. One role at a time behind the prototype's tab strip, each
 * parameter with its label, scoring weight, the description the scorer reads
 * while scoring, its AI extraction prompt and an on/off switch.
 *
 * Who may change what is the server's answer (`GET /api/config/parameters`),
 * never recomputed here: the `configparams` editor set (§8 Q6), an admin's
 * per-parameter *Permit configuration* grant (F0077), and the plan — the lower
 * of the member's own seat and the workspace plan (§8 Q116). Everything renders
 * for everyone who reaches the screen; what cannot be changed is disabled, with
 * the prototype's read-only note saying why (F0509 / F0528).
 */

/** The prototype's tab order (`.role-tabs`), which is not `ADDITIONAL_PARAM_OWNERS`' order. */
const TAB_ORDER: Record<Edition, readonly Role[]> = {
  incubator: ["program_manager", "program_associate", "jury"],
  vc: ["associate", "partner", "ic_member"],
};

/** The prototype's tab icons (`ti-users` / `ti-user-plus` / `ti-user-check` / `ti-briefcase`). */
const TAB_ICON: Partial<Record<Role, typeof Users>> = {
  program_manager: Users,
  program_associate: UserPlus,
  jury: UserCheck,
  associate: Briefcase,
  partner: Users,
  ic_member: UserCheck,
};

/**
 * The tabs a viewer sees. Every build draws all three owning roles except the
 * incubator Jury build (`AISJ_IC_Jury_V4`), which draws the juror's own tab alone.
 * The VC Analyst build relabels the first tab "Analyst"; spec §6.2 names three
 * scoring roles and the analyst is not one of them (§8 Q3), so it is not
 * reproduced — the analyst sees the Investment Associate's set, as every other
 * VC build does.
 */
export function myParamsTabs(edition: Edition, viewer: Role): Role[] {
  if (edition === "incubator" && viewer === "jury") return ["jury"];
  const owners = ADDITIONAL_PARAM_OWNERS[edition] as readonly Role[];
  return TAB_ORDER[edition].filter((r) => owners.includes(r));
}

/** `.mp-perm-d` — the default editor set per spec §10 (both editions). */
const PERMISSION_COPY: Record<Edition, string> = {
  incubator:
    "Super Users, Program Managers and Client Admins can edit by default. Other roles are read-only here unless granted the “Configure 3 additional parameters” permission in Admin → Team & roles.",
  vc: "Super Users, Partners and Client Admins can edit by default. Other roles are read-only here unless granted the “Configure 3 additional parameters” permission in Admin → Team & roles.",
};

interface Draft {
  name: string;
  description: string;
  prompt: string;
  enabled: boolean;
}

interface DraftEntry {
  base: Draft;
  current: Draft;
}

function draftOf(p: RoleParamView): Draft {
  return { name: p.name, description: p.description ?? "", prompt: p.prompt ?? "", enabled: p.enabled };
}

function sameDraft(a: Draft, b: Draft): boolean {
  return (
    a.name.trim() === b.name.trim() &&
    a.description.trim() === b.description.trim() &&
    a.prompt.trim() === b.prompt.trim() &&
    a.enabled === b.enabled
  );
}

/**
 * Fold a fresh server read into the drafts. A draft the member has edited
 * survives — the mount fetch runs twice under StrictMode and a reload follows
 * every save, and neither may overwrite typing that has not been saved.
 */
function mergeDrafts(prev: Record<string, DraftEntry>, params: RoleParamView[]): Record<string, DraftEntry> {
  const next: Record<string, DraftEntry> = {};
  for (const p of params) {
    const server = draftOf(p);
    const old = prev[p.id];
    const edited = old && !sameDraft(old.current, old.base) && !sameDraft(old.current, server);
    next[p.id] = { base: server, current: edited ? old.current : server };
  }
  return next;
}

/** Only the fields that changed, trimmed the way the server stores them. */
function patchOf(entry: DraftEntry): RoleParamPatch {
  const { base, current } = entry;
  const patch: RoleParamPatch = {};
  if (current.name.trim() !== base.name.trim()) patch.name = current.name.trim();
  if (current.description.trim() !== base.description.trim()) patch.description = current.description.trim();
  if (current.prompt.trim() !== base.prompt.trim()) patch.prompt = current.prompt.trim();
  if (current.enabled !== base.enabled) patch.enabled = current.enabled;
  return patch;
}

export function MyParamsPage() {
  const { user } = useAuth();
  const edition: Edition = user?.edition ?? "incubator";
  const viewer: Role = user?.role ?? "jury";
  const tabs = useMemo(() => myParamsTabs(edition, viewer), [edition, viewer]);

  const [view, setView] = useState<ParameterConfigView | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, DraftEntry>>({});
  const [tab, setTab] = useState<Role>(tabs[0]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Role | null>(null);

  const load = useCallback(
    () =>
      getParameterConfig()
        .then((v) => {
          setView(v);
          setDrafts((prev) => mergeDrafts(prev, v.additionalParams));
        })
        .catch(() => setLoadError(true)),
    [],
  );

  useEffect(() => {
    load();
  }, [load]);

  const title = "My Parameters — Role configuration";
  const subtitle = `Define up to ${MAX_ADDITIONAL_PER_ROLE} custom evaluation parameters per role`;

  if (loadError || !view) {
    return (
      <PanelFrame title={title} subtitle={subtitle}>
        {loadError ? (
          <EmptyState icon="Sliders" title="Couldn't load parameters" description="Try reloading the page." />
        ) : (
          <p className="text-sm text-fg-muted">Loading…</p>
        )}
      </PanelFrame>
    );
  }

  const params = view.additionalParams;
  const byRole = (role: Role) => params.filter((p) => p.roleScope === role);
  const editableAny = params.some((p) => p.editable) || (view.additionalEditor && view.additionalEnabled);
  const dirtyIds = (ids: string[]) =>
    ids.filter((id) => {
      const entry = drafts[id];
      return entry && !sameDraft(entry.current, entry.base);
    });

  async function saveIds(ids: string[]) {
    const targets = dirtyIds(ids).filter((id) => params.find((p) => p.id === id)?.editable);
    if (targets.length === 0) return;
    if (targets.some((id) => !drafts[id].current.name.trim())) {
      setError("Every parameter needs a label.");
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      for (const id of targets) await saveRoleParam(id, patchOf(drafts[id]));
      await load();
      setSaved(true);
    } catch {
      setError("Couldn't save. Try again.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  function edit(id: string, patch: Partial<Draft>) {
    setSaved(false);
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], current: { ...prev[id].current, ...patch } } }));
  }

  const note = readOnlyNote(view, editableAny);
  const active = tabs.includes(tab) ? tab : tabs[0];

  return (
    <PanelFrame
      title={title}
      subtitle={subtitle}
      actions={
        <>
          {saved && <Badge tone="positive">Saved</Badge>}
          <ToolbarButton
            primary
            disabled={busy || !editableAny || dirtyIds(params.map((p) => p.id)).length === 0}
            onClick={() => saveIds(params.map((p) => p.id))}
          >
            <Save className="h-3 w-3" aria-hidden="true" />
            {busy ? "Saving…" : "Save all"}
          </ToolbarButton>
        </>
      }
    >
      <div className="max-w-4xl">
        <h2 className="mb-[3px] text-[18px] font-bold tracking-[-0.02em] text-fg">Role configurable parameters</h2>
        <p className="mb-5 text-[12.5px] text-fg-muted">
          Each role can add up to {MAX_ADDITIONAL_PER_ROLE} custom evaluation parameters on top of the{" "}
          {view.coreParams.length} standard areas. These parameters are personal to that role&apos;s evaluation lens and
          appear in their scoring view and in reports attributed to them. Premium plan required per user to activate.
        </p>

        <div className="mb-3.5 flex items-start gap-2 rounded-lg border border-olive-md bg-olive-lt px-3 py-2.5 text-[11.5px] leading-normal text-olive-dk">
          <Info className="mt-px h-3.5 w-3.5 shrink-0 text-olive" aria-hidden="true" />
          <div>
            <strong>How this works:</strong> Each role defines their 3 parameters with a label, a description visible to
            them during scoring, and an AI extraction prompt. The AI pre-populates a suggested score for their custom
            parameters just as it does for the 13 standard areas. The user can override. These scores feed into
            role-specific reports but are clearly labelled as custom parameters.
          </div>
        </div>

        <section
          aria-label="Permission to configure additional parameters"
          className={`mb-3.5 flex flex-wrap items-center justify-between gap-3.5 rounded-[10px] border px-3.5 py-3 ${
            editableAny ? "border-line bg-surface" : "border-[#E8C77A] bg-[#FBF3E6]"
          }`}
        >
          <div className="flex items-start gap-2.5">
            <ShieldCheck
              className={`mt-px h-[18px] w-[18px] shrink-0 ${editableAny ? "text-olive" : "text-gold-dk"}`}
              aria-hidden="true"
            />
            <div>
              <div className="text-[12.5px] font-bold text-fg">Permission to configure additional parameters</div>
              <div className="mt-px max-w-[540px] text-[10.5px] leading-[1.45] text-fg-muted">
                {PERMISSION_COPY[edition]}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[10.5px] font-semibold text-fg-muted">
            <span>Your access</span>
            <Badge tone={editableAny ? "positive" : "neutral"}>{editableAny ? "Can edit" : "Read-only"}</Badge>
          </div>
        </section>

        {note && (
          <p
            role="note"
            className="mb-3.5 flex items-center gap-[7px] rounded-[9px] border border-[#E8C77A] bg-[#FBF3E6] px-[13px] py-2.5 text-[11.5px] text-[#854F0B]"
          >
            <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{note}</span>
          </p>
        )}

        <div role="tablist" aria-label="Owning roles" className="mb-4 flex flex-wrap gap-1">
          {tabs.map((role) => {
            const Icon = TAB_ICON[role] ?? Users;
            const on = role === active;
            return (
              <button
                key={role}
                type="button"
                role="tab"
                aria-selected={on}
                id={`mp-tab-${role}`}
                aria-controls={`mp-panel-${role}`}
                onClick={() => setTab(role)}
                className={`inline-flex items-center gap-1.5 rounded-[7px] border-[1.5px] px-3.5 py-[7px] text-xs transition-colors ${
                  on
                    ? "border-gold-dk bg-[#FDF6EB] font-semibold text-gold-dk"
                    : "border-line bg-surface font-medium text-fg-muted hover:border-gold-dk hover:text-gold-dk"
                }`}
              >
                <Icon className="h-[13px] w-[13px]" aria-hidden="true" />
                {roleLabel(edition, role)}
              </button>
            );
          })}
        </div>

        <RolePanel
          key={active}
          edition={edition}
          role={active}
          params={byRole(active)}
          drafts={drafts}
          view={view}
          busy={busy}
          dirty={dirtyIds(byRole(active).map((p) => p.id)).length > 0}
          onEdit={edit}
          onSave={() => saveIds(byRole(active).map((p) => p.id))}
          onPreview={() => setPreview(active)}
          onChanged={load}
          onError={setError}
        />
        {error && <p className="mt-2 text-sm text-signal-flagged">{error}</p>}
      </div>

      {preview && (
        <PreviewDialog
          edition={edition}
          role={preview}
          entries={byRole(preview).map((p) => drafts[p.id]?.current ?? draftOf(p))}
          onClose={() => setPreview(null)}
        />
      )}
    </PanelFrame>
  );
}

/** `#mp-ro-note` — why the controls are disabled, most fundamental reason first. */
function readOnlyNote(view: ParameterConfigView, editableAny: boolean): string | null {
  if (editableAny) return null;
  if (!view.additionalEnabled) {
    return `Read-only — the ${MAX_ADDITIONAL_PER_ROLE} additional parameters require the Premium plan. Your current plan is ${PLAN_LABELS[view.effectivePlan]} plan.`;
  }
  return "Read-only — your role doesn’t have permission to configure additional parameters. Ask a Super User or Admin to grant it in Admin → Team & roles.";
}

// ── One owning role's card ───────────────────────────────────────────────────

function RolePanel({
  edition,
  role,
  params,
  drafts,
  view,
  busy,
  dirty,
  onEdit,
  onSave,
  onPreview,
  onChanged,
  onError,
}: {
  edition: Edition;
  role: Role;
  params: RoleParamView[];
  drafts: Record<string, DraftEntry>;
  view: ParameterConfigView;
  busy: boolean;
  dirty: boolean;
  onEdit: (id: string, patch: Partial<Draft>) => void;
  onSave: () => void;
  onPreview: () => void;
  onChanged: () => Promise<void>;
  onError: (msg: string | null) => void;
}) {
  const Icon = TAB_ICON[role] ?? Users;
  const label = roleLabel(edition, role);
  const canManage = view.additionalEditor && view.additionalEnabled;
  const editable = params.some((p) => p.editable);

  return (
    <div
      role="tabpanel"
      id={`mp-panel-${role}`}
      aria-labelledby={`mp-tab-${role}`}
      className="mb-3 rounded-[10px] border border-line bg-surface p-4"
    >
      <div className="mb-3 flex items-center gap-[5px] text-[10px] font-bold uppercase tracking-[0.06em] text-olive-dk">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {label} · {MAX_ADDITIONAL_PER_ROLE} configurable parameters
      </div>

      {params.length === 0 && <p className="mb-3 text-sm text-fg-muted">No parameters for this role yet.</p>}

      {params.map((p, i) => (
        <ParamBlock
          key={p.id}
          index={i + 1}
          param={p}
          draft={drafts[p.id]?.current ?? draftOf(p)}
          saved={drafts[p.id]?.base ?? draftOf(p)}
          canRemove={canManage && p.editable}
          busy={busy}
          onEdit={(patch) => onEdit(p.id, patch)}
          onRemove={async () => {
            onError(null);
            try {
              await removeRoleParam(p.id);
            } catch {
              onError("Couldn't remove. Try again.");
            }
            await onChanged();
          }}
        />
      ))}

      {canManage && params.length < MAX_ADDITIONAL_PER_ROLE && (
        <AddParamForm role={role} label={label} onAdded={onChanged} />
      )}

      <div className="mt-1.5 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !editable || !dirty}
          onClick={onSave}
          className="inline-flex items-center gap-[5px] rounded-[7px] bg-gold-dk px-4 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" aria-hidden="true" />
          Save all parameters
        </button>
        <button
          type="button"
          onClick={onPreview}
          className="inline-flex items-center gap-[5px] rounded-[7px] border border-line bg-surface px-3.5 py-2 text-xs text-fg-muted hover:border-gold-dk hover:text-gold-dk"
        >
          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
          Preview in scoring view
        </button>
      </div>
    </div>
  );
}

// ── One parameter: `.param-block` ────────────────────────────────────────────

const FIELD_LABEL = "mb-1 block text-[10px] font-bold uppercase tracking-[0.05em] text-fg-muted";

function ParamBlock({
  index,
  param,
  draft,
  saved,
  canRemove,
  busy,
  onEdit,
  onRemove,
}: {
  index: number;
  param: RoleParamView;
  draft: Draft;
  saved: Draft;
  canRemove: boolean;
  busy: boolean;
  onEdit: (patch: Partial<Draft>) => void;
  onRemove: () => void;
}) {
  const ro = !param.editable;
  const name = saved.name;
  return (
    <div
      data-testid="param-block"
      className={`mb-2.5 rounded-[9px] border-[1.5px] p-3.5 ${
        draft.enabled ? "border-gold-dk bg-[#FDF6EB]" : "border-line bg-surface"
      }`}
    >
      <div className="mb-2.5 flex items-center">
        <span className="mr-1.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#FAEEDA] text-[10px] font-bold text-gold-dk">
          {index}
        </span>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-fg">{draft.name || name}</div>
          {draft.description && <div className="truncate text-[10.5px] text-fg-muted">{draft.description}</div>}
        </div>
        <div className="ml-auto flex items-center gap-2 pl-3">
          {canRemove && (
            <button
              type="button"
              disabled={busy}
              onClick={onRemove}
              className="text-[11px] text-fg-muted hover:text-signal-flagged disabled:opacity-50"
            >
              Remove
            </button>
          )}
          <button
            type="button"
            role="switch"
            aria-checked={draft.enabled}
            aria-label={`${name} enabled`}
            disabled={ro}
            onClick={() => onEdit({ enabled: !draft.enabled })}
            className="relative h-[18px] w-8 shrink-0 rounded-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-45"
            style={{ background: draft.enabled ? "var(--olive-dk)" : "var(--stone-dk)" }}
          >
            <span
              className="absolute top-[2px] h-3.5 w-3.5 rounded-full bg-surface shadow transition-[left]"
              style={{ left: draft.enabled ? 16 : 2 }}
            />
          </button>
        </div>
      </div>

      <div className="mb-2.5 grid gap-2.5 sm:grid-cols-2">
        <label>
          <span className={FIELD_LABEL}>Parameter label</span>
          <input
            className="sj-input h-9 w-full disabled:opacity-60"
            aria-label={`Label for ${name}`}
            disabled={ro}
            value={draft.name}
            onChange={(e) => onEdit({ name: e.target.value })}
          />
        </label>
        <label>
          <span className={FIELD_LABEL}>Scoring weight in their composite</span>
          {/* §8 Q21 — weighting a role parameter is a client decision about what a
              composite means, not built: the options are drawn, only Informational
              can be chosen, and the reason is on the control. */}
          <select
            className="sj-input h-9 w-full disabled:opacity-60"
            aria-label={`Scoring weight for ${name}`}
            disabled={ro}
            value="informational"
            title="Role parameters are informational: scored and reported, not weighted into the composite."
            onChange={() => undefined}
          >
            <option value="informational">Informational (not weighted)</option>
            <option value="5" disabled>
              5% additional weight
            </option>
            <option value="10" disabled>
              10% additional weight
            </option>
          </select>
        </label>
      </div>

      <label className="mb-2.5 block">
        <span className={FIELD_LABEL}>Description shown to user during scoring</span>
        <textarea
          className="sj-input min-h-12 w-full text-xs disabled:opacity-60"
          aria-label={`Scoring description for ${name}`}
          disabled={ro}
          value={draft.description}
          onChange={(e) => onEdit({ description: e.target.value })}
        />
      </label>

      <div>
        <span className={FIELD_LABEL}>AI extraction prompt for this parameter</span>
        <div className="overflow-hidden rounded-[7px] border border-line">
          <div className="flex items-center justify-between border-b border-line bg-offwhite px-2.5 py-[5px] text-[9px] font-bold uppercase tracking-[0.05em] text-fg-muted">
            AI prompt
            {/* Reset discards the unsaved edit — the last saved prompt comes back.
                No seeded default is stored to reset to (plan §8 Q118). */}
            <button
              type="button"
              disabled={ro || draft.prompt === saved.prompt}
              onClick={() => onEdit({ prompt: saved.prompt })}
              className="font-normal normal-case tracking-normal text-gold-dk hover:underline disabled:cursor-default disabled:no-underline disabled:opacity-60"
            >
              Reset
            </button>
          </div>
          <textarea
            className="block min-h-[70px] w-full resize-y border-0 bg-surface p-2.5 text-[11.5px] text-fg outline-none disabled:opacity-60"
            aria-label={`AI prompt for ${name}`}
            placeholder="Assess {{startup_name}} for… Score 0–10."
            disabled={ro}
            value={draft.prompt}
            onChange={(e) => onEdit({ prompt: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}

// ── Fill an empty slot (≤ 3 per role) ────────────────────────────────────────

function AddParamForm({ role, label, onAdded }: { role: Role; label: string; onAdded: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await addRoleParam({ name: trimmed, roleScope: role });
      setName("");
      await onAdded();
    } catch {
      setError(`Couldn't add. ${label} may already have ${MAX_ADDITIONAL_PER_ROLE}.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-2.5 flex flex-col gap-2 rounded-[9px] border-[1.5px] border-dashed border-line p-3.5 sm:flex-row sm:items-end">
      <label className="min-w-0 flex-1">
        <span className={FIELD_LABEL}>New parameter label</span>
        <input
          className="sj-input h-9 w-full"
          aria-label={`New parameter for ${label}`}
          placeholder="e.g. Thesis fit"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <button
        type="button"
        disabled={busy || !name.trim()}
        onClick={add}
        className="inline-flex h-9 items-center rounded-[7px] border border-line bg-surface px-3.5 text-xs text-fg-2 hover:border-gold-dk hover:text-gold-dk disabled:opacity-50"
      >
        {busy ? "Adding…" : "Add parameter"}
      </button>
      {error && <p className="text-sm text-signal-flagged">{error}</p>}
    </div>
  );
}

// ── "Preview in scoring view" ────────────────────────────────────────────────

/**
 * What the evaluator's workbench shows for this role's parameters — the
 * Evaluate screen's "at a glance" card (`EvaluatePage`) — drawn from the DRAFT,
 * so an unsaved label or description can be checked before it is saved.
 */
function PreviewDialog({
  edition,
  role,
  entries,
  onClose,
}: {
  edition: Edition;
  role: Role;
  entries: Draft[];
  onClose: () => void;
}) {
  const shown = entries.filter((d) => d.enabled);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Preview in scoring view"
        className="w-full max-w-md rounded-xl border border-line bg-surface p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 className="text-[15px] font-semibold text-fg">My additional parameters</h2>
          <span className="text-[11px] text-fg-muted">{roleLabel(edition, role)}</span>
          <button type="button" aria-label="Close preview" onClick={onClose} className="ml-auto text-fg-muted">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.06em] text-fg-muted">
          Your three additional parameters at a glance
        </div>
        {shown.length === 0 && <p className="text-sm text-fg-muted">Every parameter for this role is switched off.</p>}
        {shown.map((d, i) => (
          <div key={`${d.name}-${i}`} className="mb-2 rounded-lg border border-line bg-surface px-3 py-2.5">
            <div className="flex items-center gap-[7px] text-[12.5px] font-semibold text-fg">
              <span className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-blue-lt text-[9.5px] font-bold text-blue">
                C{i + 1}
              </span>
              {d.name}
            </div>
            {(d.description || d.prompt) && (
              <p className="mt-1 text-[11.5px] leading-normal text-fg-2">{d.description || d.prompt}</p>
            )}
          </div>
        ))}
        {entries.length > shown.length && (
          <p className="mt-2 text-[11px] text-fg-muted">
            {entries.length - shown.length} switched off — not shown to the evaluator and not scored.
          </p>
        )}
      </div>
    </div>
  );
}
