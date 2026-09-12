import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Bell, Mail, TriangleAlert } from "lucide-react";
import { Card, Button, EmptyState } from "../../components";
import { useAdminSave } from "./saveContext";
import {
  CHANNEL_LABELS,
  NOTIFICATION_CHANNELS,
  type NotificationChannel,
  type NotificationEvent,
  type NotificationPreferenceView,
  type OutboxEntryView,
} from "../../../shared/notifications";

/**
 * Admin console → System → **Notifications** (`admin/s-nt.html`).
 *
 * The prototype is one "Email alerts" card of ten `.nr` rows, each with a
 * single `.tog` — eight on, two off. Two things are built here that it draws
 * but does not carry, and both come from the section's own sub-line:
 *
 *   • **The second channel.** "…trigger email *and in-app* alerts" names two,
 *     and the prototype's bell is inert with no dropdown markup (F0058), so the
 *     grid is ten events × two channels with the email column seeded exactly as
 *     the prototype draws it.
 *   • **The second scope.** "…for your account" says a preference belongs to a
 *     person, not a workspace (F0060 — the audit's own correction to F0015's
 *     org-level framing). An admin still needs a policy, so the section has two
 *     scopes: **My alerts**, which is what every user gets, and **Workspace
 *     defaults**, the row each person inherits until they override it. The
 *     `source` chip on each row says which of the two a cell is currently
 *     following.
 *
 * Below the grid, two things the prototype implies and the app has never shown:
 * whether email can actually be delivered at all (F0143 — with no verified
 * sending domain every alert is audited and dispatched to nobody), and the
 * delivery log itself (F0144 — `email_outbox` has existed since Phase 4 with no
 * screen to read it).
 *
 * Every toggle saves on click, so the console's global Save changes button only
 * lights up while a save is in flight.
 */

// ── The API. `src/client/api.ts` belongs to another session, so this section's
// four calls live with the only screen that makes them (plan §2.2).

interface EventCopy {
  event: NotificationEvent;
  label: string;
  sub: string | null;
}

interface PrefsPayload {
  scope: "user" | "workspace";
  events: EventCopy[];
  preferences: NotificationPreferenceView[];
  delivery: { configured: boolean };
  canEditWorkspace: boolean;
}

async function callNotifications<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/notifications${path}`, {
    ...init,
    headers: init?.body ? { "content-type": "application/json" } : undefined,
  });
  if (!res.ok) throw new Error(`notifications request failed: ${res.status}`);
  return (await res.json()) as T;
}

type Scope = "user" | "workspace";

const api = {
  load: (scope: Scope) =>
    callNotifications<PrefsPayload>(scope === "workspace" ? "?scope=workspace" : ""),
  save: (scope: Scope, preferences: Array<{ event: string; channel: string; enabled: boolean }>) =>
    callNotifications<PrefsPayload>(
      `/preferences${scope === "workspace" ? "?scope=workspace" : ""}`,
      { method: "PUT", body: JSON.stringify({ preferences }) },
    ),
  reset: () => callNotifications<PrefsPayload>("/preferences", { method: "DELETE" }),
  outbox: () =>
    callNotifications<{ entries: OutboxEntryView[]; delivery: { configured: boolean } }>("/outbox"),
};

// ── The prototype's `.tog` pill, at the size `s-nt.html` draws it ────────────

function Toggle({
  checked,
  onChange,
  label,
  disabled,
  testId,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-testid={testId}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="inline-flex h-[18px] w-[32px] shrink-0 items-center rounded-full p-[2px] transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      style={{ background: checked ? "var(--ac-olive, #4A6644)" : "var(--color-line)" }}
    >
      <span
        className="h-[14px] w-[14px] rounded-full bg-white transition-transform"
        style={{ transform: checked ? "translateX(14px)" : "translateX(0)" }}
      />
    </button>
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

const STATUS_PILLS: Record<string, { label: string; fg: string; bg: string }> = {
  sent: { label: "Sent", fg: "#166534", bg: "#DCFCE7" },
  recorded: { label: "Recorded", fg: "var(--color-fg-muted)", bg: "var(--color-surface-2)" },
  failed: { label: "Failed", fg: "#9A3412", bg: "#FEE2E2" },
};

function StatusPill({ status }: { status: string }) {
  const pill = STATUS_PILLS[status] ?? STATUS_PILLS.recorded;
  return (
    <span
      className="rounded-full px-2 py-[2px] text-[11px] font-medium"
      style={{ color: pill.fg, background: pill.bg }}
    >
      {pill.label}
    </span>
  );
}

/** `2026-09-10T08:13:00.000Z` → `10 Sep 2026 · 08:13`. */
function formatStamp(iso: string): string {
  const d = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(d)} · ${new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(d)}`;
}

/**
 * The toggle grid on its own, so the two places a person can reach their own
 * preferences render the same control.
 *
 * §8 Q16(c) is why this is a separate export. The console is admin-only and
 * `W1-C`'s note forbids a read-only variant, but `s-nt` scopes its toggles to
 * one person — so a jury member must be able to switch off their own mail
 * somewhere. W3-A's answer to Q16 names the place: "a per-account preference
 * surface (My account), **not** a widened console." `AccountPage` mounts this
 * with `lockToUserScope`, which hides the workspace tab even from an admin who
 * happens to be looking at their own profile.
 */
export function NotificationPreferences({
  lockToUserScope = false,
}: {
  lockToUserScope?: boolean;
}) {
  const [scope, setScope] = useState<Scope>("user");
  const [data, setData] = useState<PrefsPayload | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (next: Scope) =>
      api
        .load(next)
        .then((payload) => {
          setData(payload);
          setLoadError(false);
        })
        .catch(() => setLoadError(true)),
    [],
  );

  useEffect(() => {
    load(scope);
  }, [load, scope]);

  const cells = useMemo(() => {
    const map = new Map<string, NotificationPreferenceView>();
    for (const p of data?.preferences ?? []) map.set(`${p.event}:${p.channel}`, p);
    return map;
  }, [data]);

  async function flip(event: NotificationEvent, channel: NotificationChannel, next: boolean) {
    setBusy(true);
    setError(null);
    // Optimistic: a toggle that waits for a round trip reads as a dead control.
    setData((cur) =>
      cur
        ? {
            ...cur,
            preferences: cur.preferences.map((p) =>
              p.event === event && p.channel === channel
                ? { ...p, enabled: next, source: cur.scope === "user" ? "user" : "default" }
                : p,
            ),
          }
        : cur,
    );
    try {
      const payload = await api.save(scope, [{ event, channel, enabled: next }]);
      setData(payload);
    } catch {
      setError("Couldn't save that preference. Try again.");
      await load(scope);
    } finally {
      setBusy(false);
    }
  }

  async function resetMine() {
    setBusy(true);
    setError(null);
    try {
      setData(await api.reset());
    } catch {
      setError("Couldn't reset your preferences. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const overrides = (data?.preferences ?? []).filter((p) => p.source === "user").length;

  const showScopeSwitch = Boolean(data?.canEditWorkspace) && !lockToUserScope;

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="text-[13px] text-signal-flagged">
          {error}
        </p>
      )}

      {data && !data.delivery.configured && (
        <Card className="flex items-start gap-2.5 p-3">
          <TriangleAlert className="mt-[1px] h-4 w-4 shrink-0" style={{ color: "#B45309" }} />
          <p className="text-[12.5px] text-fg-muted" data-testid="nt-delivery-warning">
            <span className="font-medium text-fg">Email delivery is not configured yet.</span> No
            verified sending domain is set, so every message below is written to the delivery log
            with the status <em>Recorded</em> and dispatched to nobody. In-app alerts are
            unaffected — the bell works today.
          </p>
        </Card>
      )}

      {/* Scope switch. The workspace tab is the admin's policy over everyone. */}
      {showScopeSwitch && (
        <div className="flex items-center gap-1.5" role="tablist" aria-label="Preference scope">
          {(
            [
              ["user", "My alerts"],
              ["workspace", "Workspace defaults"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={scope === value}
              data-testid={`nt-scope-${value}`}
              onClick={() => setScope(value)}
              className={`rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${
                scope === value
                  ? "bg-olive-lt text-olive-dk"
                  : "bg-surface-2 text-fg-muted hover:text-fg"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {loadError ? (
        <Card>
          <EmptyState
            icon="Bell"
            title="Couldn't load your notification preferences"
            description="Try reloading the console."
          />
        </Card>
      ) : !data ? (
        <Card>
          <p className="text-sm text-fg-muted">Loading notification preferences…</p>
        </Card>
      ) : (
        <Card className="p-3">
          <CardTitle icon={<Mail className="h-[15px] w-[15px]" />}>
            {scope === "workspace" ? "Workspace default alerts" : "Email and in-app alerts"}
          </CardTitle>
          <p className="mb-2 text-[11.5px] text-fg-muted">
            {scope === "workspace"
              ? "What every user in this workspace receives until they change it for themselves."
              : "Your own mask. A row you have never touched follows the workspace default."}
          </p>

          {/* Channel header — the prototype has one column; this has two. */}
          <div className="flex items-center justify-end gap-6 border-b border-line pb-1.5 pr-[2px]">
            {NOTIFICATION_CHANNELS.map((channel) => (
              <span
                key={channel}
                className="w-[46px] text-right text-[10.5px] font-semibold uppercase tracking-[.06em] text-fg-muted"
              >
                {CHANNEL_LABELS[channel]}
              </span>
            ))}
          </div>

          {data.events.map(({ event, label, sub }) => (
            <div
              key={event}
              data-testid={`nt-row-${event}`}
              className="flex items-center justify-between gap-4 border-b border-line py-2.5 last:border-0"
            >
              <div className="min-w-0">
                <div data-testid={`nt-label-${event}`} className="text-[12px] font-medium text-fg">
                  {label}
                </div>
                {sub && <div className="mt-[1px] text-[10.5px] text-fg-muted">{sub}</div>}
                {scope === "user" && cells.get(`${event}:email`)?.source === "user" && (
                  <div className="mt-[3px] text-[10px] font-medium uppercase tracking-[.05em] text-olive-dk">
                    Your override
                  </div>
                )}
              </div>
              <div className="flex items-center gap-6">
                {NOTIFICATION_CHANNELS.map((channel) => {
                  const cell = cells.get(`${event}:${channel}`);
                  return (
                    <span key={channel} className="flex w-[46px] justify-end">
                      <Toggle
                        checked={cell?.enabled ?? false}
                        disabled={busy}
                        onChange={(next) => flip(event, channel, next)}
                        label={`${label} — ${CHANNEL_LABELS[channel]}`}
                        testId={`nt-tog-${event}-${channel}`}
                      />
                    </span>
                  );
                })}
              </div>
            </div>
          ))}

          {scope === "user" && overrides > 0 && (
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="text-[11.5px] text-fg-muted">
                {overrides} of your {data.preferences.length} settings override the workspace
                default.
              </span>
              <Button variant="secondary" onClick={resetMine} disabled={busy}>
                Reset to workspace defaults
              </Button>
            </div>
          )}
        </Card>
      )}

    </div>
  );
}

/**
 * The console section: the heading pair `SectionPlaceholder` establishes, the
 * grid above, and the delivery audit the prototype implies but the app has
 * never shown.
 */
export function NotificationsSection() {
  const [outbox, setOutbox] = useState<OutboxEntryView[] | null>(null);

  // Admin-only and secondary to the toggles, so it is fetched separately and
  // its absence never blocks the grid.
  useEffect(() => {
    api
      .outbox()
      .then((r) => setOutbox(r.entries))
      .catch(() => setOutbox([]));
  }, []);

  // Every toggle saves on click, so the console's global Save button has
  // nothing of its own to commit — and says why rather than sitting enabled
  // over a no-op.
  useAdminSave({
    dirty: false,
    hint: "Notification preferences save as you change them.",
    onSave: () => {},
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold tracking-tight text-fg">Notifications</h2>
        <p className="mt-0.5 max-w-3xl text-[13px] text-fg-muted">
          Control which platform events trigger email and in-app alerts for your account.
        </p>
      </div>

      <NotificationPreferences />

      {/* F0144 — the delivery audit, finally readable. */}
      <Card className="p-3">
        <CardTitle icon={<Bell className="h-[15px] w-[15px]" />}>Recent delivery</CardTitle>
        <p className="mb-2 text-[11.5px] text-fg-muted">
          Every message the platform produced, with what actually happened to it.{" "}
          <em>Recorded</em> means audited but not dispatched.
        </p>
        {outbox === null ? (
          <p className="text-[12.5px] text-fg-muted">Loading the delivery log…</p>
        ) : outbox.length === 0 ? (
          <p className="text-[12.5px] text-fg-muted" data-testid="nt-outbox-empty">
            Nothing has been sent yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[12px]">
              <thead>
                <tr className="border-b border-line text-[10.5px] uppercase tracking-[.06em] text-fg-muted">
                  <th className="py-1.5 pr-3 font-semibold">Event</th>
                  <th className="py-1.5 pr-3 font-semibold">Recipient</th>
                  <th className="py-1.5 pr-3 font-semibold">Subject</th>
                  <th className="py-1.5 pr-3 font-semibold">Status</th>
                  <th className="py-1.5 font-semibold">Sent</th>
                </tr>
              </thead>
              <tbody data-testid="nt-outbox">
                {outbox.map((row) => (
                  <tr key={row.id} className="border-b border-line last:border-0">
                    <td className="py-1.5 pr-3 font-mono text-[11px] text-fg-muted">{row.kind}</td>
                    <td className="py-1.5 pr-3 text-fg">{row.toName ?? row.toEmail}</td>
                    <td className="py-1.5 pr-3 text-fg-muted">{row.subject}</td>
                    <td className="py-1.5 pr-3">
                      <StatusPill status={row.status} />
                      {row.error && (
                        <span className="ml-1.5 text-[11px] text-signal-flagged">{row.error}</span>
                      )}
                    </td>
                    <td className="py-1.5 whitespace-nowrap text-fg-muted">
                      {formatStamp(row.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
