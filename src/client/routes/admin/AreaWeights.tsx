import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ShieldCheck, ClipboardCheck, Gavel, Check } from "lucide-react";
import { Card } from "../../components";
import { useAuth } from "../../auth/useAuth";
import { getConfig, updateWeights, updateAdditionalParam, type ConfigParam } from "../../api";
import {
  REQUIRED_WEIGHT_TOTAL,
  weightBarWidth,
  weightTotal,
  weightTotalMessage,
} from "../../../shared/scoring";
import {
  ADDITIONAL_PARAM_OWNERS,
  MAX_ADDITIONAL_PER_ROLE,
  roleLabel,
  type Role,
} from "../../../shared/roles";
import { useAdminSave } from "./saveContext";
import { setConfigPermitted } from "./scoringApi";

/**
 * Admin console → Evaluation → **Area weights** (prototype `admin/s-wt.html`).
 *
 * The 13 core evaluation areas with their percentage weights, a live total the
 * prototype insists must equal 100 % (F0153 — it is now enforced on the server
 * too), the bar scale `admin/_scripts.js` draws (`min(v·3.3, 100) %`, F0154),
 * and — in the same section rather than on a separate screen (F0155) — the
 * role-scoped *Additional configurable parameters* cards, each with its
 * AI+ / AI++ / AI+++ tier badge (F0078), a `/ 10` score column, the
 * `Set total: max 30` footer and the per-parameter **Permit configuration**
 * control (F0077).
 *
 * Area names are editable here (F0079: the server has always accepted a rename
 * on `PUT /api/config/parameters`; no screen ever sent one).
 */

/** The payload adds two columns 0025 introduced that `ConfigParam` predates. */
type ParamView = ConfigParam & { description?: string; configPermitted?: boolean };

/** `admin/s-wt.html` — the mono, zero-padded index cell. */
function IndexCell({ n }: { n: number }) {
  return (
    <td className="py-2 pr-3 font-mono text-[10px] text-fg-muted">{String(n).padStart(2, "0")}</td>
  );
}

function Pill({ children, tone }: { children: ReactNode; tone: "core" | "tier" }) {
  return (
    <span
      className="ml-2 inline-block rounded px-1.5 py-[1px] align-middle text-[9.5px] font-semibold uppercase tracking-wide"
      style={
        tone === "core"
          ? { background: "var(--color-surface-2)", color: "var(--color-fg-muted)" }
          : { background: "rgba(232,160,32,0.16)", color: "var(--ac-gold-dk, #BA7517)" }
      }
    >
      {children}
    </span>
  );
}

/** The prototype's `permit-btn`, driven by `permitTog` in `admin/_scripts.js`. */
function PermitButton({
  permitted,
  busy,
  disabled,
  onToggle,
}: {
  permitted: boolean;
  busy: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={permitted}
      disabled={busy || disabled}
      onClick={onToggle}
      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60"
      style={
        permitted
          ? {
              borderColor: "var(--ac-olive, #4A6644)",
              background: "var(--ac-olive, #4A6644)",
              color: "#fff",
            }
          : { borderColor: "var(--color-line)", color: "var(--color-fg-muted)" }
      }
    >
      {permitted && <Check className="h-3 w-3" aria-hidden="true" />}
      {permitted ? "Permitted" : "Permit configuration"}
    </button>
  );
}

/** AI+ · AI++ · AI+++ in the owner order the section renders (F0078). */
const TIER_BADGES = ["AI+", "AI++", "AI+++"] as const;
const OWNER_ICONS = [ShieldCheck, ClipboardCheck, Gavel] as const;

export function AreaWeightsSection() {
  const { user } = useAuth();
  const edition = user?.edition ?? "incubator";
  const canEdit = user?.role === "admin" || user?.role === "superuser";

  const [core, setCore] = useState<ParamView[] | null>(null);
  const [additional, setAdditional] = useState<ParamView[]>([]);
  const [locked, setLocked] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const [weights, setWeights] = useState<Record<string, number>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [permitBusy, setPermitBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const cfg = await getConfig();
      const coreParams = cfg.coreParams as ParamView[];
      setCore(coreParams);
      setAdditional(cfg.additionalParams as ParamView[]);
      setLocked(!cfg.coreConfigEnabled);
      setWeights(Object.fromEntries(coreParams.map((p) => [p.id, p.weight])));
      setNames(
        Object.fromEntries([...coreParams, ...(cfg.additionalParams as ParamView[])].map((p) => [p.id, p.name])),
      );
      setDirty(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const total = useMemo(() => weightTotal(Object.values(weights)), [weights]);
  const footer = weightTotalMessage(total);
  const balanced = footer.ok;

  const save = useCallback(async () => {
    if (!core) return;
    setSaving(true);
    setSaveError(null);
    try {
      await updateWeights(
        core.map((p) => ({ id: p.id, weight: Number(weights[p.id]) || 0, name: names[p.id] })),
      );
      // Additional-parameter renames go through their own route (the weights
      // route only ever edits the weighted core areas).
      await Promise.all(
        additional
          .filter((p) => (names[p.id] ?? p.name) !== p.name)
          .map((p) => updateAdditionalParam(p.id, { name: names[p.id] })),
      );
      await load();
    } catch {
      setSaveError("Couldn't save. Every weight must be 0–100 and the total exactly 100 %.");
    } finally {
      setSaving(false);
    }
  }, [core, additional, weights, names, load]);

  useAdminSave(
    core && canEdit && !locked
      ? {
          dirty: dirty && balanced,
          saving,
          onSave: save,
          hint: !dirty ? "No unsaved changes" : footer.text,
        }
      : null,
  );

  async function togglePermit(p: ParamView) {
    setPermitBusy(p.id);
    setSaveError(null);
    const next = !p.configPermitted;
    try {
      await setConfigPermitted(p.id, next);
      setAdditional((rows) =>
        rows.map((r) => (r.id === p.id ? { ...r, configPermitted: next } : r)),
      );
    } catch {
      setSaveError("Couldn't change that permission. Try again.");
    } finally {
      setPermitBusy(null);
    }
  }

  if (loadError) {
    return (
      <Shell>
        <Card>
          <p className="text-[13px] text-fg-muted">
            Couldn&apos;t load the evaluation areas. Reload the console to try again.
          </p>
        </Card>
      </Shell>
    );
  }
  if (!core) {
    return (
      <Shell>
        <Card>
          <p className="text-[13px] text-fg-muted">Loading…</p>
        </Card>
      </Shell>
    );
  }

  const ro = !canEdit || locked;
  const owners = ADDITIONAL_PARAM_OWNERS[edition];

  return (
    <Shell areaCount={core.length}>
      {locked && (
        <p className="rounded-md border border-line bg-surface-2 px-3 py-2 text-[12px] text-fg-muted">
          Read-only — configuring the core evaluation areas requires the Pro or Premium plan.
        </p>
      )}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-left">
            <thead>
              <tr className="border-b border-line text-fg-muted">
                <th className="py-2 pr-3 text-[10px] font-medium uppercase tracking-wide">#</th>
                <th className="py-2 pr-3 text-[10px] font-medium uppercase tracking-wide">
                  Evaluation area
                </th>
                <th className="py-2 pr-3 text-[10px] font-medium uppercase tracking-wide">Type</th>
                <th className="py-2 pr-3 text-[10px] font-medium uppercase tracking-wide">
                  Weight %
                </th>
                <th className="py-2 text-[10px] font-medium uppercase tracking-wide">Visual</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {core.map((p, i) => (
                <tr key={p.id}>
                  <IndexCell n={i + 1} />
                  <td className="py-2 pr-3">
                    <input
                      className="sj-input w-full min-w-[11rem] text-[13px]"
                      type="text"
                      disabled={ro}
                      aria-label={`${p.name} name`}
                      value={names[p.id] ?? p.name}
                      onChange={(e) => {
                        setNames((n) => ({ ...n, [p.id]: e.target.value }));
                        setDirty(true);
                      }}
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <Pill tone="core">Core</Pill>
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      className="sj-input w-[4.5rem] font-mono text-[13px]"
                      type="number"
                      min={0}
                      max={100}
                      disabled={ro}
                      aria-label={`${names[p.id] ?? p.name} weight`}
                      value={weights[p.id] ?? 0}
                      onChange={(e) => {
                        setWeights((w) => ({ ...w, [p.id]: Number(e.target.value) }));
                        setDirty(true);
                      }}
                    />
                  </td>
                  <td className="py-2">
                    <div className="h-[7px] w-[70px] overflow-hidden rounded-full bg-surface-2">
                      <div
                        className="h-full rounded-full"
                        data-testid={`weight-bar-${p.key}`}
                        style={{
                          width: `${weightBarWidth(weights[p.id] ?? 0)}%`,
                          background: "var(--ac-olive, #4A6644)",
                        }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div
          className="mt-3 border-t border-line pt-2 text-[12px] font-medium"
          data-testid="weight-total"
          style={{ color: balanced ? "var(--color-green, #16A34A)" : "#791F1F" }}
        >
          {footer.text}
        </div>
        {!balanced && dirty && (
          <p className="mt-1 text-[11.5px] text-fg-muted">
            Save is disabled until the areas total {REQUIRED_WEIGHT_TOTAL} %.
          </p>
        )}
      </Card>

      {/* ── Additional configurable parameters ───────────────────────────── */}
      <div>
        <h3 className="text-[13.5px] font-semibold tracking-tight text-fg">
          Additional configurable parameters
        </h3>
        <p className="mt-0.5 max-w-3xl text-[12.5px] text-fg-muted">
          Each role — {owners.map((r) => roleLabel(edition, r)).join(", ")} — configures its own set
          of {MAX_ADDITIONAL_PER_ROLE} parameters, each scored 0–10 (set maximum{" "}
          <strong className="text-fg">{MAX_ADDITIONAL_PER_ROLE * 10}</strong>). Each role&apos;s
          additional score is surfaced as {TIER_BADGES.map((b, i) => (
            <span key={b}>
              {i > 0 ? ", " : ""}
              <strong className="text-fg">{b}</strong> ({roleLabel(edition, owners[i])})
            </span>
          ))}
          . Use <em>Permit configuration</em> to allow a role to edit a parameter.
        </p>
      </div>

      {owners.map((owner, oi) => {
        const rows = additional.filter((p) => p.roleScope === owner);
        const Icon = OWNER_ICONS[oi] ?? ShieldCheck;
        return (
          <Card key={owner}>
            <div className="mb-1 flex items-center gap-2 text-[13px] font-semibold text-fg">
              <Icon
                className="h-[15px] w-[15px]"
                style={{ color: "var(--ac-olive, #4A6644)" }}
                aria-hidden="true"
              />
              {roleLabel(edition, owner as Role)}
              <Pill tone="tier">{TIER_BADGES[oi] ?? "AI+"} score</Pill>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[30rem] text-left">
                <thead>
                  <tr className="border-b border-line text-fg-muted">
                    <th className="py-2 pr-3 text-[10px] font-medium uppercase tracking-wide">#</th>
                    <th className="py-2 pr-3 text-[10px] font-medium uppercase tracking-wide">
                      Custom parameter name
                    </th>
                    <th className="py-2 pr-3 text-[10px] font-medium uppercase tracking-wide">
                      Score
                    </th>
                    <th className="py-2 text-[10px] font-medium uppercase tracking-wide">
                      Permit configuration
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((p, i) => (
                    <tr key={p.id}>
                      <IndexCell n={i + 1} />
                      <td className="py-2 pr-3">
                        <input
                          className="sj-input w-full min-w-[11rem] text-[13px]"
                          type="text"
                          disabled={ro}
                          aria-label={`${p.name} name`}
                          value={names[p.id] ?? p.name}
                          onChange={(e) => {
                            setNames((n) => ({ ...n, [p.id]: e.target.value }));
                            setDirty(true);
                          }}
                        />
                        {p.description && (
                          <div className="mt-0.5 text-[11px] text-fg-muted">{p.description}</div>
                        )}
                      </td>
                      <td className="py-2 pr-3 font-mono text-[12px] text-fg-muted">/ 10</td>
                      <td className="py-2">
                        <PermitButton
                          permitted={p.configPermitted === true}
                          busy={permitBusy === p.id}
                          disabled={ro}
                          onToggle={() => togglePermit(p)}
                        />
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-3 text-[12.5px] text-fg-muted">
                        No parameters configured for this role yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="mt-3 pt-2 text-[12px] text-fg-muted">
              Set total: max <strong className="text-fg">{MAX_ADDITIONAL_PER_ROLE * 10}</strong> (
              {MAX_ADDITIONAL_PER_ROLE} × 10)
            </div>
          </Card>
        );
      })}

      {saveError && <p className="text-[12.5px] text-signal-flagged">{saveError}</p>}
    </Shell>
  );
}

function Shell({ children, areaCount = 13 }: { children: ReactNode; areaCount?: number }) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold tracking-tight text-fg">Area weights</h2>
        <p className="mt-0.5 max-w-3xl text-[13px] text-fg-muted">
          Set the percentage weight of each of the {areaCount} evaluation areas in the final
          composite score. Total must equal 100%.
        </p>
      </div>
      {children}
    </div>
  );
}
