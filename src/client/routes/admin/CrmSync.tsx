import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Database, Filter, Plug, RefreshCw, Trash2, Plus, ArrowLeftRight } from "lucide-react";
import { Card, Button } from "../../components";
import { useAdminSave } from "./saveContext";
import {
  CRM_DIRECTIONS,
  CRM_DIRECTION_LABELS,
  CRM_SCHEDULES,
  CRM_SCHEDULE_LABELS,
  type CrmConnectionView,
  type CrmDirection,
  type CrmFieldMapping,
  type CrmMappingDirection,
  type CrmProvider,
  type CrmSchedule,
  type CrmSyncLogView,
  APP_FIELDS,
  APP_FIELD_LABELS,
  validateMappings,
  describeMappingError,
} from "../../../shared/crm";

/**
 * Admin console → Organisation → **CRM sync** (`admin/s-crm.html`).
 *
 * The prototype's four `.crm-item` rows with their `.cs-live` / `.cs-off` pills
 * and Connect · Configure · Disconnect, plus the "<Provider> filter rules" card
 * — trigger field, trigger value, monthly deck cap, score write-back field and
 * the two toggles — and the two controls a working integration needs that the
 * prototype does not draw: **field mapping**, and **sync direction + schedule**.
 *
 * §1.3 — the section is interface-complete and provider-stubbed. "Sync now"
 * records what the provider call WOULD have carried, in `crm_sync_log`, exactly
 * as `email_outbox` records an unsent message; it is reported as *Recorded*,
 * never as sent, and the Recent sync attempts list says so in as many words.
 *
 * **The credential box is write-only.** It posts once and is cleared; what
 * comes back from the server is a masked hint, never a value, so this component
 * has no state that could re-display a secret.
 */

// ── The prototype's `.cs` pill ───────────────────────────────────────────────

const STATUS_PILLS: Record<string, { label: string; fg: string; bg: string }> = {
  live: { label: "Live", fg: "#166534", bg: "#DCFCE7" },
  inactive: { label: "Inactive", fg: "var(--color-fg-muted)", bg: "var(--color-surface-2)" },
  error: { label: "Error", fg: "#9A3412", bg: "#FEE2E2" },
};

function StatusPill({ status }: { status: string }) {
  const pill = STATUS_PILLS[status] ?? STATUS_PILLS.inactive;
  return (
    <span
      className="shrink-0 rounded-full px-2 py-[2px] text-[11px] font-medium"
      style={{ color: pill.fg, background: pill.bg }}
    >
      {pill.label}
    </span>
  );
}

/** The prototype's per-provider `.crm-icon` tint. */
const PROVIDER_TINTS: Record<CrmProvider, { bg: string; fg: string }> = {
  salesforce: { bg: "#E6F1FB", fg: "#2563EB" },
  hubspot: { bg: "var(--color-gold-lt, #FBF3E2)", fg: "var(--color-gold-dk, #8A6512)" },
  pipedrive: { bg: "var(--color-surface-2)", fg: "var(--color-fg-muted)" },
  custom: { bg: "var(--color-surface-2)", fg: "var(--color-fg-muted)" },
};

function CardTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-fg">
      <span style={{ color: "var(--ac-olive, #4A6644)" }}>{icon}</span>
      {children}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  sub,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  sub?: string;
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
        onClick={() => onChange(!checked)}
        className="mt-0.5 inline-flex h-[18px] w-[34px] shrink-0 items-center rounded-full p-[2px] transition-colors"
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

const inputClass =
  "h-8 w-full rounded-[7px] border border-line bg-surface px-2 text-item text-fg placeholder:text-fg-muted";

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="u-label">{label}</span>
      {children}
      {hint && <span className="text-[11.5px] text-fg-muted">{hint}</span>}
    </label>
  );
}

// ── Draft state ──────────────────────────────────────────────────────────────

/** Everything the Configure pane can change for one provider. */
interface Draft {
  baseUrl: string;
  webhookPath: string;
  syncDirection: CrmDirection;
  syncSchedule: CrmSchedule;
  triggerField: string;
  triggerValue: string;
  monthlyDeckCap: string;
  scoreWritebackField: string;
  autoApproveWithinCap: boolean;
  writeBackScores: boolean;
  mappings: CrmFieldMapping[];
}

function draftOf(conn: CrmConnectionView): Draft {
  return {
    baseUrl: conn.baseUrl ?? "",
    webhookPath: conn.webhookPath ?? "",
    syncDirection: conn.syncDirection,
    syncSchedule: conn.syncSchedule,
    triggerField: conn.triggerField ?? "",
    triggerValue: conn.triggerValue ?? "",
    monthlyDeckCap: conn.monthlyDeckCap === null ? "" : String(conn.monthlyDeckCap),
    scoreWritebackField: conn.scoreWritebackField ?? "",
    autoApproveWithinCap: conn.autoApproveWithinCap,
    writeBackScores: conn.writeBackScores,
    mappings: conn.mappings.map((m) => ({ ...m })),
  };
}

function sameDraft(a: Draft, b: Draft): boolean {
  return (
    a.baseUrl === b.baseUrl &&
    a.webhookPath === b.webhookPath &&
    a.syncDirection === b.syncDirection &&
    a.syncSchedule === b.syncSchedule &&
    a.triggerField === b.triggerField &&
    a.triggerValue === b.triggerValue &&
    a.monthlyDeckCap === b.monthlyDeckCap &&
    a.scoreWritebackField === b.scoreWritebackField &&
    a.autoApproveWithinCap === b.autoApproveWithinCap &&
    a.writeBackScores === b.writeBackScores &&
    a.mappings.length === b.mappings.length &&
    a.mappings.every(
      (m, i) =>
        m.crmField === b.mappings[i].crmField &&
        m.appField === b.mappings[i].appField &&
        m.direction === b.mappings[i].direction,
    )
  );
}

// The section fetches directly rather than through `src/client/api.ts`: that
// file is shared by every wave and this session owns none of it (§2.2). A later
// consolidation can lift these into it — recorded in the plan's §9.
async function fetchConnections(): Promise<CrmConnectionView[]> {
  const r = await fetch("/api/crm");
  if (!r.ok) throw new Error(`crm: ${r.status}`);
  return ((await r.json()) as { connections: CrmConnectionView[] }).connections;
}

async function post(path: string, body?: unknown): Promise<unknown> {
  const r = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const payload = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error(String(payload.message ?? payload.error ?? `crm: ${r.status}`));
  return payload;
}

// ── The mapping editor ───────────────────────────────────────────────────────

function MappingEditor({
  mappings,
  onChange,
}: {
  mappings: CrmFieldMapping[];
  onChange: (next: CrmFieldMapping[]) => void;
}) {
  const set = (i: number, patch: Partial<CrmFieldMapping>) =>
    onChange(mappings.map((m, x) => (x === i ? { ...m, ...patch } : m)));

  return (
    <Card>
      <CardTitle icon={<ArrowLeftRight className="h-3.5 w-3.5" />}>Field mapping</CardTitle>
      <p className="mb-2 text-[11.5px] text-fg-muted">
        Which CRM field fills which field here. <strong>Inbound</strong> is read when a deal is
        pulled; <strong>outbound</strong> is written back after an evaluation completes.
      </p>

      {mappings.length === 0 ? (
        <p className="py-2 text-[13px] text-fg-muted">
          No fields mapped yet — a pulled deal would arrive with no founder details.
        </p>
      ) : (
        <table className="w-full text-item">
          <thead>
            <tr className="border-b border-line text-left">
              <th className="u-label py-1.5 font-normal">CRM field</th>
              <th className="u-label py-1.5 font-normal">Maps to</th>
              <th className="u-label py-1.5 font-normal">Direction</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {mappings.map((m, i) => (
              <tr key={i} className="border-b border-line last:border-0">
                <td className="py-1.5 pr-2">
                  <input
                    className={inputClass}
                    aria-label={`CRM field ${i + 1}`}
                    value={m.crmField}
                    placeholder="Account.Name"
                    onChange={(e) => set(i, { crmField: e.target.value })}
                  />
                </td>
                <td className="py-1.5 pr-2">
                  <select
                    className={inputClass}
                    aria-label={`Maps to ${i + 1}`}
                    value={m.appField}
                    onChange={(e) => set(i, { appField: e.target.value })}
                  >
                    {APP_FIELDS[m.direction].map((f) => (
                      <option key={f} value={f}>
                        {APP_FIELD_LABELS[f] ?? f}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-1.5 pr-2">
                  <select
                    className={inputClass}
                    aria-label={`Direction ${i + 1}`}
                    value={m.direction}
                    onChange={(e) => {
                      const direction = e.target.value as CrmMappingDirection;
                      // The app-field list is direction-specific, so a switch
                      // must land on a field that exists in the new list.
                      const appField = APP_FIELDS[direction].includes(m.appField)
                        ? m.appField
                        : APP_FIELDS[direction][0];
                      set(i, { direction, appField });
                    }}
                  >
                    <option value="inbound">Inbound</option>
                    <option value="outbound">Outbound</option>
                  </select>
                </td>
                <td className="py-1.5">
                  <button
                    type="button"
                    aria-label={`Remove mapping ${i + 1}`}
                    className="text-fg-muted hover:text-signal-flagged"
                    onClick={() => onChange(mappings.filter((_, x) => x !== i))}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="mt-2">
        <Button
          size="sm"
          onClick={() =>
            onChange([
              ...mappings,
              { crmField: "", appField: firstUnused(mappings), direction: "inbound" },
            ])
          }
        >
          <Plus className="h-3.5 w-3.5" />
          Add mapping
        </Button>
      </div>
    </Card>
  );
}

/** Default a new row to an inbound field not already taken, so it saves as-is. */
function firstUnused(mappings: CrmFieldMapping[]): string {
  const taken = new Set(mappings.filter((m) => m.direction === "inbound").map((m) => m.appField));
  return APP_FIELDS.inbound.find((f) => !taken.has(f)) ?? APP_FIELDS.inbound[0];
}

// ── The section ──────────────────────────────────────────────────────────────

export function CrmSyncSection() {
  const [connections, setConnections] = useState<CrmConnectionView[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState<CrmProvider | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<CrmProvider, Draft>>>({});
  const [credential, setCredential] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [log, setLog] = useState<CrmSyncLogView[] | null>(null);

  const load = useCallback(async (resetProviders?: CrmProvider[]) => {
    try {
      const rows = await fetchConnections();
      setConnections(rows);
      // Never blanket-overwrite drafts: a refresh can land mid-edit (and
      // StrictMode double-invokes the mount effect). Seed only what has no
      // draft, or what we have just saved.
      setDrafts((prev) => {
        const next = { ...prev };
        for (const c of rows) {
          if (!(c.provider in next) || resetProviders?.includes(c.provider)) {
            next[c.provider] = draftOf(c);
          }
        }
        return next;
      });
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const current = useMemo(
    () => connections?.find((c) => c.provider === selected) ?? null,
    [connections, selected],
  );
  const draft = selected ? drafts[selected] : undefined;

  const dirty = useMemo(() => {
    if (!current || !draft) return false;
    return !sameDraft(draft, draftOf(current));
  }, [current, draft]);

  const setDraft = useCallback(
    (patch: Partial<Draft>) => {
      if (!selected) return;
      setDrafts((d) => {
        const base = d[selected];
        return base ? { ...d, [selected]: { ...base, ...patch } } : d;
      });
      setNote(null);
      setError(null);
    },
    [selected],
  );

  const save = useCallback(async () => {
    if (!selected || !draft) return;
    const check = validateMappings(draft.mappings);
    if (!check.ok) {
      setError(describeMappingError(check));
      return;
    }
    setBusy("save");
    setError(null);
    setNote(null);
    try {
      const r = await fetch(`/api/crm/${selected}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseUrl: draft.baseUrl,
          webhookPath: draft.webhookPath,
          syncDirection: draft.syncDirection,
          syncSchedule: draft.syncSchedule,
          triggerField: draft.triggerField,
          triggerValue: draft.triggerValue,
          monthlyDeckCap: draft.monthlyDeckCap.trim() === "" ? null : Number(draft.monthlyDeckCap),
          scoreWritebackField: draft.scoreWritebackField,
          autoApproveWithinCap: draft.autoApproveWithinCap,
          writeBackScores: draft.writeBackScores,
          mappings: check.mappings,
        }),
      });
      const payload = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      if (!r.ok) throw new Error(String(payload.message ?? payload.error ?? `crm: ${r.status}`));
      await load([selected]);
      setNote("CRM settings saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the CRM settings.");
    } finally {
      setBusy(null);
    }
  }, [selected, draft, load]);

  useAdminSave({
    dirty,
    saving: busy === "save",
    hint: selected ? "No CRM changes to save" : "Choose a provider to configure",
    onSave: save,
  });

  const connect = useCallback(
    async (provider: CrmProvider) => {
      setBusy(`connect:${provider}`);
      setError(null);
      setNote(null);
      try {
        const d = drafts[provider];
        await post(`/api/crm/${provider}/connect`, {
          credential: credential.trim() || undefined,
          baseUrl: d?.baseUrl,
          webhookPath: d?.webhookPath,
        });
        // The credential is write-only: drop it the moment it is posted, so it
        // never sits in component state and can never be re-rendered.
        setCredential("");
        await load([provider]);
        setNote("Connected. The provider call is stubbed — syncs are recorded, not performed.");
      } catch (e) {
        setError(e instanceof Error ? mapConnectError(e.message) : "Couldn't connect.");
      } finally {
        setBusy(null);
      }
    },
    [credential, drafts, load],
  );

  const disconnect = useCallback(
    async (provider: CrmProvider) => {
      setBusy(`disconnect:${provider}`);
      setError(null);
      setNote(null);
      try {
        await post(`/api/crm/${provider}/disconnect`);
        await load([provider]);
        setLog(null);
        setNote("Disconnected. Filter rules and field mappings are kept.");
      } catch {
        setError("Couldn't disconnect.");
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  const syncNow = useCallback(
    async (provider: CrmProvider) => {
      setBusy(`sync:${provider}`);
      setError(null);
      setNote(null);
      try {
        const res = (await post(`/api/crm/${provider}/sync`)) as {
          attempt: { status: string; error: string | null };
        };
        await load();
        await refreshLog(provider);
        setNote(
          res.attempt.status === "skipped"
            ? `Sync skipped — ${res.attempt.error}`
            : "Sync attempt recorded. No provider is configured, so nothing was sent.",
        );
      } catch {
        setError("Couldn't record the sync attempt.");
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  const refreshLog = useCallback(async (provider: CrmProvider) => {
    try {
      const r = await fetch(`/api/crm/${provider}/log`);
      if (!r.ok) throw new Error(String(r.status));
      setLog(((await r.json()) as { entries: CrmSyncLogView[] }).entries);
    } catch {
      setLog([]);
    }
  }, []);

  useEffect(() => {
    if (selected) void refreshLog(selected);
    else setLog(null);
  }, [selected, refreshLog]);

  const heading = (
    <div>
      <h2 className="text-base font-semibold tracking-tight text-fg">CRM sync</h2>
      <p className="mt-0.5 max-w-3xl text-[13px] text-fg-muted">
        Connect your CRM to automatically pull pitchdecks when deals match your configured filter
        rules.
      </p>
    </div>
  );

  if (loadError) {
    return (
      <div className="flex flex-col gap-3">
        {heading}
        <Card>
          <p className="text-[13px] text-fg-muted">
            Couldn&rsquo;t load your CRM connections.{" "}
            <button className="text-olive underline" onClick={() => void load()}>
              Retry
            </button>
          </p>
        </Card>
      </div>
    );
  }

  if (!connections) {
    return (
      <div className="flex flex-col gap-3">
        {heading}
        <Card>
          <p className="text-[13px] text-fg-muted">Loading CRM connections&hellip;</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {heading}

      {/* The prototype's provider list — four rows, always all four. */}
      <Card className="p-3">
        <ul>
          {connections.map((conn) => {
            const tint = PROVIDER_TINTS[conn.provider];
            const connected = conn.status !== "inactive";
            return (
              <li
                key={conn.provider}
                className="flex flex-wrap items-center gap-3 border-b border-line py-2.5 last:border-0"
              >
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                  style={{ background: tint.bg }}
                >
                  {conn.provider === "custom" ? (
                    <Plug className="h-4 w-4" style={{ color: tint.fg }} />
                  ) : (
                    <Database className="h-4 w-4" style={{ color: tint.fg }} />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-fg">{conn.label}</div>
                  <div className="text-[11.5px] text-fg-muted">{conn.summary}</div>
                </div>
                <StatusPill status={conn.status} />
                <Button
                  size="sm"
                  onClick={() => {
                    setSelected(conn.provider);
                    setNote(null);
                    setError(null);
                  }}
                >
                  {connected || conn.provider === "custom" ? "Configure" : "Connect"}
                </Button>
                {connected && (
                  <Button
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => void disconnect(conn.provider)}
                  >
                    {busy === `disconnect:${conn.provider}` ? "Disconnecting…" : "Disconnect"}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      {error && (
        <p className="text-[13px] text-signal-flagged" role="alert">
          {error}
        </p>
      )}
      {note && <p className="text-[13px] text-positive">{note}</p>}

      {!current || !draft ? (
        <Card>
          <p className="text-[13px] text-fg-muted">
            Choose a provider above to set its connection, filter rules and field mapping.
          </p>
        </Card>
      ) : (
        <>
          {/* Connection settings — the disconnected state leads with the credential. */}
          <Card>
            <CardTitle icon={<Plug className="h-3.5 w-3.5" />}>
              {current.label} connection
            </CardTitle>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Instance base URL" hint="Where your CRM lives, e.g. acme.my.salesforce.com">
                <input
                  className={inputClass}
                  aria-label="Instance base URL"
                  value={draft.baseUrl}
                  placeholder="acme.my.salesforce.com"
                  onChange={(e) => setDraft({ baseUrl: e.target.value })}
                />
              </Field>
              <Field
                label={current.provider === "custom" ? "Webhook path" : "Webhook path (optional)"}
                hint="Where this workspace receives deal notifications."
              >
                <input
                  className={inputClass}
                  aria-label="Webhook path"
                  value={draft.webhookPath}
                  placeholder="/hooks/crm/acme"
                  onChange={(e) => setDraft({ webhookPath: e.target.value })}
                />
              </Field>
            </div>

            <div className="mt-3 border-t border-line pt-3">
              {current.status === "inactive" ? (
                <div className="flex flex-wrap items-end gap-3">
                  <div className="min-w-[240px] flex-1">
                    <Field
                      label="API key or token"
                      hint="Stored as a Worker secret, never in the database. It is never shown again."
                    >
                      <input
                        className={inputClass}
                        type="password"
                        aria-label="API key or token"
                        autoComplete="off"
                        value={credential}
                        placeholder={
                          current.provider === "custom"
                            ? "Optional for a webhook-only connection"
                            : "Paste the key from your CRM"
                        }
                        onChange={(e) => setCredential(e.target.value)}
                      />
                    </Field>
                  </div>
                  <Button
                    variant="primary"
                    disabled={busy !== null}
                    onClick={() => void connect(current.provider)}
                  >
                    {busy === `connect:${current.provider}` ? "Connecting…" : "Connect"}
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  {/* A Custom API row can be connected by webhook alone, with no
                      key at all — "Credential configured in —" would be a lie. */}
                  <p className="text-[12px] text-fg-muted">
                    {current.credential.configured ? (
                      <>
                        Credential {current.credential.hint ?? "configured"} in{" "}
                        <code className="rounded bg-surface-2 px-1 py-[1px]">
                          {current.credential.ref}
                        </code>
                        {current.credential.setAt
                          ? ` · set ${current.credential.setAt.slice(0, 10)}`
                          : ""}
                        . The stored value is never shown or returned.
                      </>
                    ) : (
                      "Connected by webhook — no credential is stored for this connection."
                    )}
                  </p>
                  <Button
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => void syncNow(current.provider)}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    {busy === `sync:${current.provider}` ? "Recording…" : "Sync now"}
                  </Button>
                </div>
              )}
            </div>
          </Card>

          {/* Sync direction and schedule. */}
          <Card>
            <CardTitle icon={<RefreshCw className="h-3.5 w-3.5" />}>Sync direction &amp; schedule</CardTitle>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Sync direction">
                <select
                  className={inputClass}
                  aria-label="Sync direction"
                  value={draft.syncDirection}
                  onChange={(e) => setDraft({ syncDirection: e.target.value as CrmDirection })}
                >
                  {CRM_DIRECTIONS.map((d) => (
                    <option key={d} value={d}>
                      {CRM_DIRECTION_LABELS[d]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Sync schedule">
                <select
                  className={inputClass}
                  aria-label="Sync schedule"
                  value={draft.syncSchedule}
                  onChange={(e) => setDraft({ syncSchedule: e.target.value as CrmSchedule })}
                >
                  {CRM_SCHEDULES.map((s) => (
                    <option key={s} value={s}>
                      {CRM_SCHEDULE_LABELS[s]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </Card>

          {/* The prototype's filter-rules card, field for field. */}
          <Card>
            <CardTitle icon={<Filter className="h-3.5 w-3.5" />}>
              {current.label} filter rules
            </CardTitle>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Trigger field">
                <input
                  className={inputClass}
                  aria-label="Trigger field"
                  value={draft.triggerField}
                  placeholder="Stage"
                  onChange={(e) => setDraft({ triggerField: e.target.value })}
                />
              </Field>
              <Field label="Trigger value">
                <input
                  className={inputClass}
                  aria-label="Trigger value"
                  value={draft.triggerValue}
                  placeholder="Submitted for evaluation"
                  onChange={(e) => setDraft({ triggerValue: e.target.value })}
                />
              </Field>
              <Field label="Monthly deck cap" hint="Leave blank for no cap.">
                <input
                  className={inputClass}
                  type="number"
                  min={0}
                  aria-label="Monthly deck cap"
                  value={draft.monthlyDeckCap}
                  placeholder="50"
                  onChange={(e) => setDraft({ monthlyDeckCap: e.target.value })}
                />
              </Field>
              <Field label="Score write-back field">
                <input
                  className={inputClass}
                  aria-label="Score write-back field"
                  value={draft.scoreWritebackField}
                  placeholder="AI_Score__c"
                  onChange={(e) => setDraft({ scoreWritebackField: e.target.value })}
                />
              </Field>
            </div>
            <div className="mt-2">
              <Toggle
                label="Auto-approve if within monthly cap"
                sub="No manual approval needed if submission count is below the monthly limit"
                checked={draft.autoApproveWithinCap}
                onChange={(v) => setDraft({ autoApproveWithinCap: v })}
              />
              <Toggle
                label="Write AI scores and signals back to CRM"
                sub="After evaluation completes, sync scores to the configured CRM field"
                checked={draft.writeBackScores}
                onChange={(v) => setDraft({ writeBackScores: v })}
              />
            </div>
          </Card>

          <MappingEditor
            mappings={draft.mappings}
            onChange={(mappings) => setDraft({ mappings })}
          />

          <Card>
            <CardTitle icon={<RefreshCw className="h-3.5 w-3.5" />}>Recent sync attempts</CardTitle>
            <p className="mb-2 text-[11.5px] text-fg-muted">
              No CRM provider is configured on this deployment, so an attempt is{" "}
              <strong>recorded</strong> with the request it would have made — never reported as
              sent. Connecting a provider is a configuration step, not a code change.
            </p>
            {log === null ? (
              <p className="text-[13px] text-fg-muted">Loading&hellip;</p>
            ) : log.length === 0 ? (
              <p className="text-[13px] text-fg-muted">No sync attempts yet.</p>
            ) : (
              <ul className="flex flex-col">
                {log.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex flex-wrap items-center gap-2 border-b border-line py-2 text-[12px] last:border-0"
                  >
                    <span className="font-mono text-fg-muted">{entry.createdAt.slice(0, 16)}</span>
                    <span className="font-medium text-fg">
                      {entry.operation === "pull_deals" ? "Pull deals" : "Write back score"}
                    </span>
                    <StatusPill status={entry.status === "recorded" ? "live" : "inactive"} />
                    <span className="text-fg-muted">
                      {entry.status === "recorded"
                        ? `Recorded · ${entry.recordCount} record${entry.recordCount === 1 ? "" : "s"}`
                        : entry.status === "skipped"
                          ? `Skipped — ${entry.error}`
                          : entry.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

/** Server error codes the Connect form can provoke, in the operator's words. */
function mapConnectError(code: string): string {
  if (code === "credential_required") return "Paste the API key or token to connect.";
  if (code === "webhook_path_required") return "A custom connection needs a webhook path.";
  return "Couldn't connect.";
}
