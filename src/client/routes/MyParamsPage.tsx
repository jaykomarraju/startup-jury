import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth/useAuth";
import { Card, Button, Badge, EmptyState } from "../components";
import {
  getConfigSummary,
  addAdditionalParam,
  deleteAdditionalParam,
  type ConfigSummary,
  type ConfigParam,
} from "../api";
import { PLAN_LABELS } from "../../shared/plans";

/** "My Parameters" screen (nav slug `myparams`). Shows the additional /
 *  informational evaluation parameters that sit on top of the 13 core areas.
 *  Plan-gated: hidden on Standard (upgrade prompt); on Pro/Premium the list is
 *  visible to everyone but only admins/superusers can add or retire them. */
export function MyParamsPage() {
  const { user } = useAuth();
  const [cfg, setCfg] = useState<ConfigSummary | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canEdit = user?.role === "admin" || user?.role === "superuser";

  const load = useCallback(() => {
    return getConfigSummary()
      .then(setCfg)
      .catch(() => setLoadError(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await addAdditionalParam(trimmed);
      setName("");
      await load();
    } catch {
      setError("Couldn't add the parameter. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(param: ConfigParam) {
    setBusy(true);
    setError(null);
    try {
      await deleteAdditionalParam(param.id);
      await load();
    } catch {
      setError("Couldn't remove the parameter. Try again.");
    } finally {
      setBusy(false);
    }
  }

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

  return (
    <div className="flex flex-col gap-5 p-5">
      <div>
        <h1 className="text-xl font-semibold text-fg">My Parameters</h1>
        <p className="mt-0.5 max-w-2xl text-sm text-fg-muted">
          Additional evaluation parameters on top of the {cfg.coreParams.length} core areas — a custom lens for your
          org's scoring. Informational parameters don't change the composite score.
        </p>
      </div>

      {!cfg.additionalEnabled ? (
        <Card>
          <EmptyState
            icon="Lock"
            title={`Additional parameters need a Pro plan`}
            description={`Your organisation is on the ${PLAN_LABELS[cfg.plan]} plan. Upgrade to Pro or Premium in Configuration to unlock custom evaluation parameters.`}
          />
        </Card>
      ) : (
        <Card>
          <div className="flex items-center justify-between">
            <div className="u-label">Additional parameters</div>
            <Badge tone="info">{cfg.additionalParams.length}</Badge>
          </div>

          {error && <p className="mt-3 text-sm text-signal-flagged">{error}</p>}

          {cfg.additionalParams.length === 0 ? (
            <p className="mt-4 text-sm text-fg-muted">No additional parameters yet.</p>
          ) : (
            <ul className="mt-4 flex flex-col divide-y divide-line">
              {cfg.additionalParams.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-fg">{p.name}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-fg-muted">
                      <Badge tone="neutral">{p.informational ? "Informational" : `Weight ${p.weight}`}</Badge>
                      {p.roleScope && <span>· {p.roleScope}</span>}
                    </div>
                  </div>
                  {canEdit && (
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => remove(p)}>
                      Remove
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {canEdit ? (
            <div className="mt-4 flex items-end gap-2 border-t border-line pt-4">
              <label className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-xs font-medium text-fg-muted">New parameter label</span>
                <input
                  className="sj-input h-9"
                  aria-label="New parameter label"
                  placeholder="e.g. Thesis & mandate fit"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && add()}
                />
              </label>
              <Button variant="primary" disabled={busy || !name.trim()} onClick={add}>
                {busy ? "…" : "Add parameter"}
              </Button>
            </div>
          ) : (
            <p className="mt-4 border-t border-line pt-4 text-xs text-fg-muted">
              Read-only — ask a Super User or Admin to configure additional parameters.
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
