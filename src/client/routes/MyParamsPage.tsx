import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth/useAuth";
import { Card, Button, Badge, EmptyState } from "../components";
import {
  getConfigSummary,
  addAdditionalParam,
  updateAdditionalParam,
  deleteAdditionalParam,
  type ConfigSummary,
  type ConfigParam,
} from "../api";
import { PLAN_LABELS } from "../../shared/plans";
import {
  ADDITIONAL_PARAM_OWNERS,
  MAX_ADDITIONAL_PER_ROLE,
  roleLabel,
  type Edition,
} from "../../shared/roles";

/** "My Parameters" screen (nav slug `myparams`). The role-scoped ADDITIONAL
 *  evaluation parameters (up to 3 per owner role) that sit on top of the 13 core
 *  areas — each with a renameable label and a configurable AI prompt. They are
 *  assistive (AI scores them) but never fold into the core-13 composite.
 *  Plan-gated: hidden on Standard/Pro (Premium unlocks configuration); on Premium
 *  the list is visible to all roles but only admins/superusers can edit. */
export function MyParamsPage() {
  const { user } = useAuth();
  const edition: Edition = user?.edition ?? "incubator";
  const [cfg, setCfg] = useState<ConfigSummary | null>(null);
  const [loadError, setLoadError] = useState(false);

  const canEdit = user?.role === "admin" || user?.role === "superuser";

  const load = useCallback(
    () =>
      getConfigSummary()
        .then(setCfg)
        .catch(() => setLoadError(true)),
    [],
  );

  useEffect(() => {
    load();
  }, [load]);

  if (loadError) {
    return (
      <div className="p-5">
        <h1 className="mb-5 text-xl font-semibold text-fg">My Parameters</h1>
        <EmptyState icon="Sliders" title="Couldn't load parameters" description="Try reloading the page." />
      </div>
    );
  }
  if (!cfg) {
    return (
      <div className="p-5">
        <h1 className="text-xl font-semibold text-fg">My Parameters</h1>
        <p className="mt-2 text-sm text-fg-muted">Loading…</p>
      </div>
    );
  }

  const owners = ADDITIONAL_PARAM_OWNERS[edition];

  return (
    <div className="flex flex-col gap-5 p-5">
      <div>
        <h1 className="text-xl font-semibold text-fg">My Parameters</h1>
        <p className="mt-0.5 max-w-2xl text-sm text-fg-muted">
          Up to {MAX_ADDITIONAL_PER_ROLE} additional evaluation parameters per role on top of the{" "}
          {cfg.coreParams.length} core areas — a custom lens with its own AI prompt. The AI scores them assistively,
          but they don't change the composite score.
        </p>
      </div>

      {!cfg.additionalEnabled ? (
        <Card>
          <EmptyState
            icon="Lock"
            title="Additional parameters need a Premium plan"
            description={`The ${MAX_ADDITIONAL_PER_ROLE} additional parameters require the Premium plan. Your organisation is on the ${PLAN_LABELS[cfg.plan]} plan — upgrade in Configuration to unlock role-scoped custom parameters.`}
          />
        </Card>
      ) : (
        owners.map((role) => (
          <RoleGroup
            key={role}
            edition={edition}
            role={role}
            params={cfg.additionalParams.filter((p) => p.roleScope === role)}
            canEdit={canEdit}
            onChanged={load}
          />
        ))
      )}
    </div>
  );
}

// ── One owner role's up-to-3 additional params ───────────────────────────────

function RoleGroup({
  edition,
  role,
  params,
  canEdit,
  onChanged,
}: {
  edition: Edition;
  role: string;
  params: ConfigParam[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const full = params.length >= MAX_ADDITIONAL_PER_ROLE;
  return (
    <Card>
      <div className="flex items-center justify-between">
        <div className="u-label">{roleLabel(edition, role as never)}</div>
        <Badge tone={full ? "neutral" : "info"}>
          {params.length}/{MAX_ADDITIONAL_PER_ROLE}
        </Badge>
      </div>

      {params.length === 0 ? (
        <p className="mt-4 text-sm text-fg-muted">No additional parameters for this role yet.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-4">
          {params.map((p) => (
            <ParamRow key={p.id} param={p} canEdit={canEdit} onChanged={onChanged} />
          ))}
        </ul>
      )}

      {canEdit && !full && <AddParamForm role={role} onAdded={onChanged} />}
      {!canEdit && (
        <p className="mt-4 border-t border-line pt-4 text-xs text-fg-muted">
          Read-only — ask a Super User or Admin to configure these parameters.
        </p>
      )}
    </Card>
  );
}

// ── A single param: renameable label + configurable AI prompt ────────────────

function ParamRow({
  param,
  canEdit,
  onChanged,
}: {
  param: ConfigParam;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [name, setName] = useState(param.name);
  const [prompt, setPrompt] = useState(param.prompt ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = name.trim() !== param.name || (prompt.trim() || "") !== (param.prompt ?? "");

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await updateAdditionalParam(param.id, { name: name.trim(), prompt: prompt.trim() });
      setSaved(true);
      onChanged();
    } catch {
      setError("Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await deleteAdditionalParam(param.id);
      onChanged();
    } catch {
      setError("Couldn't remove. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!canEdit) {
    return (
      <li className="rounded-lg border border-line p-3">
        <div className="text-sm font-medium text-fg">{param.name}</div>
        {param.prompt && <p className="mt-1 text-xs italic text-fg-muted">{param.prompt}</p>}
        <Badge tone="neutral">Informational · assistive</Badge>
      </li>
    );
  }

  return (
    <li className="rounded-lg border border-line p-3">
      <div className="flex flex-col gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">Parameter label</span>
          <input
            className="sj-input h-9"
            aria-label={`Label for ${param.name}`}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
            }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">AI extraction prompt</span>
          <textarea
            className="sj-input min-h-[4rem] text-sm"
            aria-label={`AI prompt for ${param.name}`}
            placeholder="Assess {{startup_name}} for… Score 0–10."
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              setSaved(false);
            }}
          />
        </label>
        {error && <p className="text-sm text-signal-flagged">{error}</p>}
        <div className="flex items-center gap-2">
          <Button size="sm" variant="primary" disabled={busy || !dirty || !name.trim()} onClick={save}>
            {busy ? "…" : "Save"}
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={remove}>
            Remove
          </Button>
          {saved && <Badge tone="positive">Saved</Badge>}
        </div>
      </div>
    </li>
  );
}

// ── Add a new param to a role (respects the ≤3 cap) ──────────────────────────

function AddParamForm({ role, onAdded }: { role: string; onAdded: () => void }) {
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await addAdditionalParam(trimmed, role, prompt.trim() || undefined);
      setName("");
      setPrompt("");
      onAdded();
    } catch {
      setError("Couldn't add. You may already have 3 for this role.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
      {error && <p className="text-sm text-signal-flagged">{error}</p>}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">New parameter label</span>
          <input
            className="sj-input h-9"
            aria-label={`New parameter for ${role}`}
            placeholder="e.g. Thesis & mandate fit"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <Button variant="primary" disabled={busy || !name.trim()} onClick={add}>
          {busy ? "…" : "Add parameter"}
        </Button>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-fg-muted">AI extraction prompt (optional)</span>
        <input
          className="sj-input h-9 text-sm"
          aria-label={`AI prompt for new ${role} parameter`}
          placeholder="Assess {{startup_name}} for… Score 0–10."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </label>
    </div>
  );
}
