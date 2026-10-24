// Phase 7 — Tickets (admin) + Contact (Admin / team) screens. Tickets surface
// support requests with billing routing; Contact sends messages to Admin or the
// team. Backed by /api/tickets and /api/messages.
//
// V3 item 15 adds the third Support screen, JURYbuddy. It lives in `./help/`
// rather than here because it carries 12.7 KB of ported FAQ copy plus its own
// matcher; it is re-exported so `App.tsx` keeps one import for the section.
//
// ── WAVE A · P3 · RAISE TO CLOSE (tracker row 13) ───────────────────────────
// Contact Admin is now where a ticket is RAISED, because that is what Contact Admin
// is in all eleven prototype files that have it, in both editions — "Raise a support
// ticket for any issue", with category, priority, subject and description, beside
// "My recent tickets" (`AISJ_IC_PM_V5.HTM` `#panel-contactadmin`). It used to post a
// free-text message to an inbox, so the only person who could ever see a ticket's
// status was the admin changing it. Tickets is where it is TRIAGED: the admin panel's
// stat tiles, filter chips, a status select per row and a detail pane whose "Mark
// resolved" now asks what was done (`AISJ_ICAdmin_V6.html` `#panel-support`).
//
// What the prototype has and these screens do not, each for a stated reason:
//   • the ID column ("TKT-1050") — ids here are UUIDs, and a sequential reference is
//     a column and a migration this lane has no slot for;
//   • the reply thread and the billing approval chain — a thread table and §10.8's
//     approval states are their own migrations;
//   • "Overdue" — there is no SLA for a ticket to be overdue against;
//   • "Attach a screenshot" — tickets have no upload path, and a file picker that
//     silently drops the file is a control that lies;
//   • the superuser's READ-ONLY view (`TICKETS_READONLY=true` in both superuser
//     files). The server lets a superuser triage (`requireRole`'s bypass), and hiding
//     the controls while the transition stays reachable is the bug this repo keeps
//     reproducing — so it is both or neither, and "neither" until someone decides
//     who triages in a workspace whose only staff member is its superuser.
//
// Every confirmation on both screens is built from the server's `notified`
// (`TicketNotice`), which names only the people whose in-app row was written. Tickets
// send no email (`routes/support.ts` says why), so no line here mentions one.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Card, Button, Badge, EmptyState, KpiTile } from "../components";
import { ApiError, listMessages, sendMessage, type ContactMessage } from "../api";
import type { TicketNotice } from "../../shared/notifications";

export { HelpPage } from "./help";

// ── The ticket calls ─────────────────────────────────────────────────────────
// Here rather than in `api.ts`, which is not this lane's file; `queryApi.ts` is the
// precedent. `api.ts`'s `setTicketStatus(id, "open" | "closed")` cannot name the
// middle step or carry a resolution, and its `Ticket` lacks every field the queue now
// draws. Both are left for the integrator to retire — `upload/CrmMethod.tsx` still
// raises through `createTicket`, which the server keeps accepting unchanged.

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body: Record<string, unknown> = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body);
  }
  return res.json();
}

function post<T>(path: string, body: unknown): Promise<T> {
  return fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => json<T>(r));
}

export type TicketStatus = "open" | "in_progress" | "closed";

/** One ticket, either queue — `toTicketView` in `routes/support.ts`. */
export interface TicketView {
  id: string;
  subject: string;
  body: string | null;
  status: string;
  billingRouted: boolean;
  /** The prototype's "Issue category". */
  area: string | null;
  priority: string | null;
  /** Set on close; kept through a reopen as the record of what was tried. */
  resolution: string | null;
  createdAt: string;
  updatedAt: string | null;
  creator: string;
  creatorRole: string | null;
  raisedByMe: boolean;
}

interface RaiseResult {
  ok: true;
  id: string;
  billingRouted: boolean;
  notified: TicketNotice;
}

interface MoveResult {
  ok: true;
  status: string;
  changed: boolean;
  notified: TicketNotice;
}

const fetchQueue = () => fetch("/api/tickets").then((r) => json<{ tickets: TicketView[] }>(r));
const fetchMine = () => fetch("/api/tickets/mine").then((r) => json<{ tickets: TicketView[] }>(r));
const raiseTicket = (input: { subject: string; body: string; area: string; priority: string }) =>
  post<RaiseResult>("/api/tickets", input);
const moveTicket = (id: string, status: TicketStatus, resolution?: string) =>
  post<MoveResult>(`/api/tickets/${encodeURIComponent(id)}/status`, { status, resolution });

// ── Vocabulary ───────────────────────────────────────────────────────────────

const STATUSES: readonly TicketStatus[] = ["open", "in_progress", "closed"];

/** `tkStatLabel`'s three words. The stored `closed` reads "Resolved". */
const STATUS_LABELS: Record<TicketStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  closed: "Resolved",
};

/** `stColor`: Open gold, In progress blue, Resolved green. */
const STATUS_TONE: Record<TicketStatus, "amber" | "info" | "positive"> = {
  open: "amber",
  in_progress: "info",
  closed: "positive",
};

function isStatus(value: string): value is TicketStatus {
  return STATUSES.some((s) => s === value);
}

/** `#ca-pri`, Medium preselected. The values are `support.ts`'s `TICKET_PRIORITIES`. */
const PRIORITIES = [
  ["low", "Low"],
  ["medium", "Medium"],
  ["high", "High"],
  ["urgent", "Urgent"],
] as const;

/** `priColor`: Urgent and High red, Medium gold, Low stone. */
const PRIORITY_TONE: Record<string, "danger" | "amber" | "neutral"> = {
  urgent: "danger",
  high: "danger",
  medium: "amber",
  low: "neutral",
};

function priorityLabel(p: string | null): string | null {
  return PRIORITIES.find(([value]) => value === p)?.[1] ?? null;
}

/** `#ca-cat`, verbatim and in the prototype's order. */
const CATEGORIES = [
  "Access & login",
  "Billing & subscription",
  "Deck upload / viewing",
  "AI scoring & evaluation",
  "Permissions & roles",
  "Intro call scheduling",
  "Bug / technical issue",
  "Feature request",
  "Other",
] as const;

function fmt(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

/** "18 Jun 2026" — the date on a "My recent tickets" card. */
function fmtLong(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/** Whole days since `iso` — the queue's "Age" column (`1d`, `2d`). */
function ageDays(iso: string): string {
  const days = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
  return Number.isNaN(days) ? "—" : days === 0 ? "today" : `${days}d`;
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  if (names.length > 3) return `${names.slice(0, 2).join(", ")} and ${names.length - 2} others`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The one sentence a screen may say about who was told.
 *
 * Built from `inApp`, which lists only people whose `notifications` row was written —
 * so it can say "notified in the app" and mean it, and it has nothing it could
 * mistake for an email. `nobody` is the caller's reason the list can be empty.
 */
export function noticeText(n: TicketNotice, nobody: string): string {
  if (n.failed) return "The in-app alert couldn't be recorded, so nobody has been told yet.";
  if (n.inApp.length === 0) return nobody;
  return `${joinNames(n.inApp)} ${n.inApp.length === 1 ? "was" : "were"} notified in the app.`;
}

interface Notice {
  tone: "ok" | "warn";
  text: string;
}

function NoticeLine({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  return (
    <p
      role="status"
      data-testid="ticket-notice"
      className={`rounded-lg border px-3 py-2 text-sm text-fg ${
        notice.tone === "ok" ? "border-green/30 bg-green-lt" : "border-signal-weak/40 bg-signal-weak/10"
      }`}
    >
      {notice.text}
    </p>
  );
}

function StatusBadge({ status }: { status: string }) {
  return isStatus(status) ? (
    <Badge tone={STATUS_TONE[status]}>{STATUS_LABELS[status]}</Badge>
  ) : (
    <Badge tone="neutral">{status}</Badge>
  );
}

function PriorityBadge({ priority }: { priority: string | null }) {
  const label = priorityLabel(priority);
  return label && priority ? <Badge tone={PRIORITY_TONE[priority] ?? "neutral"}>{label}</Badge> : <>—</>;
}

// ── Tickets (admin) ──────────────────────────────────────────────────────────

type Filter = "all" | TicketStatus;

/** Admin-only Tickets screen: the support queue, triaged from open to resolved. */
export function TicketsPage() {
  const [tickets, setTickets] = useState<TicketView[] | null>(null);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolution, setResolution] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const detailRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(
    () =>
      fetchQueue()
        .then((r) => {
          setTickets(r.tickets);
          setError(false);
        })
        .catch(() => setError(true)),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

  // On a phone the pane renders below the table, out of view of the row that opened it.
  useEffect(() => {
    if (openId) detailRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [openId, resolving]);

  const counts = useMemo(() => {
    const rows = tickets ?? [];
    const n = (s: TicketStatus) => rows.filter((t) => t.status === s).length;
    return { all: rows.length, open: n("open"), in_progress: n("in_progress"), closed: n("closed") };
  }, [tickets]);

  const rows = useMemo(
    () => (tickets ?? []).filter((t) => filter === "all" || t.status === filter),
    [tickets, filter],
  );
  const selected = tickets?.find((t) => t.id === openId) ?? null;

  function openTicket(id: string, resolve = false) {
    setOpenId(id);
    setResolving(resolve);
    setResolution("");
  }

  /** The tiles and chips are one filter; clicking the active one clears it. */
  function pick(f: Filter) {
    setFilter((cur) => (cur === f ? "all" : f));
  }

  async function move(t: TicketView, status: TicketStatus, text?: string) {
    setBusy(true);
    setNotice(null);
    try {
      const r = await moveTicket(t.id, status, text);
      setResolving(false);
      setResolution("");
      const nobody = t.raisedByMe
        ? "You raised it, so there was no one else to tell."
        : `Nobody was notified — ${t.creator} no longer has an active account here.`;
      setNotice({
        tone: r.notified.failed ? "warn" : "ok",
        text: r.changed
          ? `“${t.subject}” is now ${STATUS_LABELS[status]}. ${noticeText(r.notified, nobody)}`
          : `“${t.subject}” was already ${STATUS_LABELS[status]}.`,
      });
    } catch (err) {
      setNotice({
        tone: "warn",
        text:
          err instanceof ApiError && err.status === 409
            ? "Someone else changed this ticket first — showing its current status."
            : "Couldn't update that ticket. Try again.",
      });
    } finally {
      await load();
      setBusy(false);
    }
  }

  const tiles: [TicketStatus, string][] = [
    ["open", "Open"],
    ["in_progress", "In progress"],
    ["closed", "Resolved"],
  ];

  return (
    <div className="flex flex-col gap-5 p-5">
      <div>
        <h1 className="text-xl font-semibold text-fg">Support tickets</h1>
        <p className="mt-0.5 text-sm text-fg-muted">
          Incoming tickets from your team — set status, and resolve with a note the raiser will see.
        </p>
      </div>

      <NoticeLine notice={notice} />

      {error ? (
        <Card>
          <EmptyState icon="LifeBuoy" title="Couldn't load tickets" description="Try reloading the page." />
        </Card>
      ) : tickets === null ? (
        <p className="text-sm text-fg-muted">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2.5">
            {tiles.map(([s, label]) => (
              <KpiTile key={s} label={label} value={counts[s]} active={filter === s} onClick={() => pick(s)} />
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {(["all", ...STATUSES] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={filter === s}
                onClick={() => setFilter(s)}
                className={`rounded-full border px-3 py-1 text-xs ${
                  filter === s ? "border-accent bg-accent/15 text-fg" : "border-line text-fg-muted"
                }`}
              >
                {s === "all" ? "All" : STATUS_LABELS[s]} · {counts[s]}
              </button>
            ))}
          </div>

          <Card flush className="overflow-x-auto">
            {/* `tk-hide`: Category, Priority and Age drop below `sm`, so at 393px the row
                is the ticket, its status and Open — no sideways scroll on the phone. */}
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-fg-muted">
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Ticket</th>
                  <th className="hidden px-4 py-2.5 text-xs font-medium uppercase tracking-wide sm:table-cell">Category</th>
                  <th className="hidden px-4 py-2.5 text-xs font-medium uppercase tracking-wide sm:table-cell">Priority</th>
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Status</th>
                  <th className="hidden px-4 py-2.5 text-xs font-medium uppercase tracking-wide sm:table-cell">Age</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr className="border-t border-line">
                    <td colSpan={6} className="px-4 py-6 text-center text-sm text-fg-muted">
                      No tickets in this view.
                    </td>
                  </tr>
                ) : (
                  rows.map((t) => (
                    <tr
                      key={t.id}
                      data-testid={`ticket-row-${t.id}`}
                      className={`border-t border-line align-top ${t.id === openId ? "bg-surface-2" : ""}`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-fg">
                          {t.subject} {t.billingRouted && <Badge tone="amber">Billing</Badge>}
                        </div>
                        <div className="mt-0.5 text-xs text-fg-muted">
                          {t.creator}
                          {t.creatorRole ? ` · ${t.creatorRole}` : ""}
                        </div>
                      </td>
                      <td className="hidden px-4 py-3 text-fg-muted sm:table-cell">{t.area ?? "—"}</td>
                      <td className="hidden px-4 py-3 sm:table-cell">
                        <PriorityBadge priority={t.priority} />
                      </td>
                      <td className="px-4 py-3">
                        <select
                          className="sj-input h-8 w-[7.5rem] py-0 text-xs"
                          aria-label={`Status for ${t.subject}`}
                          value={t.status}
                          disabled={busy}
                          onChange={(e) => {
                            const next = e.target.value;
                            if (!isStatus(next) || next === t.status) return;
                            // Resolving needs the note, so the select opens the pane
                            // for it instead of posting a close the server would refuse.
                            if (next === "closed") openTicket(t.id, true);
                            else void move(t, next);
                          }}
                        >
                          {STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {STATUS_LABELS[s]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="hidden px-4 py-3 text-xs text-fg-muted sm:table-cell">{ageDays(t.createdAt)}</td>
                      <td className="px-4 py-3 text-right">
                        <Button size="sm" aria-label={`Open ${t.subject}`} onClick={() => openTicket(t.id)}>
                          Open
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </Card>

          {selected && (
            <div ref={detailRef}>
              <Card data-testid="ticket-detail">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-fg">{selected.subject}</h2>
                    <p className="mt-0.5 text-xs text-fg-muted">
                      {[
                        selected.creatorRole ? `${selected.creator} (${selected.creatorRole})` : selected.creator,
                        selected.area,
                        priorityLabel(selected.priority) && `${priorityLabel(selected.priority)} priority`,
                        `opened ${fmt(selected.createdAt)}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <StatusBadge status={selected.status} />
                </div>

                {selected.body && <p className="mt-3 whitespace-pre-wrap text-sm text-fg">{selected.body}</p>}

                {selected.resolution && (
                  <div className="mt-3 rounded-lg border border-line bg-surface-2 px-3 py-2">
                    <div className="u-label">{selected.status === "closed" ? "Resolution" : "Previously resolved"}</div>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-fg">{selected.resolution}</p>
                  </div>
                )}

                {resolving ? (
                  <div className="mt-3 flex flex-col gap-2">
                    <textarea
                      className="sj-input min-h-20"
                      aria-label="Resolution"
                      placeholder={`What was done — ${selected.creator} will see this.`}
                      value={resolution}
                      onChange={(e) => setResolution(e.target.value)}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="primary"
                        disabled={busy || !resolution.trim()}
                        onClick={() => move(selected, "closed", resolution.trim())}
                      >
                        Mark resolved
                      </Button>
                      <Button disabled={busy} onClick={() => setResolving(false)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selected.status === "open" && (
                      <Button variant="primary" disabled={busy} onClick={() => move(selected, "in_progress")}>
                        Mark in progress
                      </Button>
                    )}
                    {selected.status === "closed" ? (
                      // `tkReopen` puts it back to In progress, not Open: somebody is
                      // already on it, which is why it was reopened.
                      <Button disabled={busy} onClick={() => move(selected, "in_progress")}>
                        Re-open
                      </Button>
                    ) : (
                      <Button disabled={busy} onClick={() => setResolving(true)}>
                        Mark resolved…
                      </Button>
                    )}
                    <Button variant="ghost" aria-label="Close details" onClick={() => setOpenId(null)}>
                      Close
                    </Button>
                  </div>
                )}
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Contact Admin — raise a ticket ───────────────────────────────────────────

function ContactAdminPage() {
  const ids = useId();
  const [mine, setMine] = useState<TicketView[] | null>(null);
  const [mineError, setMineError] = useState(false);
  const [earlier, setEarlier] = useState<{ messages: ContactMessage[]; inbox: boolean } | null>(null);
  const [area, setArea] = useState<string>(CATEGORIES[0]);
  const [priority, setPriority] = useState("medium");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const load = useCallback(
    () =>
      fetchMine()
        .then((r) => {
          setMine(r.tickets);
          setMineError(false);
        })
        .catch(() => setMineError(true)),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

  // Messages written to Admin before this screen raised tickets. Nothing composes
  // them any more, but they are rows somebody wrote — an admin's inbox and a sender's
  // own sent list — and a screen change is not a reason to lose them.
  useEffect(() => {
    listMessages("admin")
      .then(setEarlier)
      .catch(() => setEarlier(null));
  }, []);

  function clear() {
    setSubject("");
    setBody("");
  }

  async function submit() {
    if (!subject.trim() || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const r = await raiseTicket({ subject: subject.trim(), body: body.trim(), area, priority });
      clear();
      setNotice({
        tone: r.notified.failed ? "warn" : "ok",
        text: `Ticket raised${r.billingRouted ? " and routed to billing" : ""}. ${noticeText(
          r.notified,
          "There is no other administrator in your workspace to notify.",
        )}`,
      });
      await load();
    } catch {
      setNotice({ tone: "warn", text: "Couldn't raise that ticket. Try again." });
    } finally {
      setBusy(false);
    }
  }

  const label = "flex flex-col gap-1 text-xs font-medium text-fg-muted";

  return (
    <div className="flex flex-col gap-5 p-5">
      <div>
        <h1 className="text-xl font-semibold text-fg">Contact Admin</h1>
        <p className="mt-0.5 text-sm text-fg-muted">Raise a support ticket for any issue</p>
      </div>

      <NoticeLine notice={notice} />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="u-label">Raise a ticket</h2>
          <div className="mt-3 flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className={label}>
                <label htmlFor={`${ids}-cat`}>Issue category</label>
                <select id={`${ids}-cat`} className="sj-input" value={area} onChange={(e) => setArea(e.target.value)}>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div className={label}>
                <label htmlFor={`${ids}-pri`}>Priority</label>
                <select
                  id={`${ids}-pri`}
                  className="sj-input"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                >
                  {PRIORITIES.map(([value, text]) => (
                    <option key={value} value={value}>
                      {text}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className={label}>
              <label htmlFor={`${ids}-subj`}>Subject</label>
              <input
                id={`${ids}-subj`}
                className="sj-input"
                placeholder="Brief summary of the issue"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
            <div className={label}>
              <label htmlFor={`${ids}-desc`}>Description</label>
              <textarea
                id={`${ids}-desc`}
                className="sj-input min-h-28"
                placeholder="Describe the issue, what you expected, and any steps to reproduce…"
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" disabled={busy || !subject.trim()} onClick={submit}>
                {busy ? "…" : "Raise ticket"}
              </Button>
              <Button disabled={busy} onClick={clear}>
                Clear
              </Button>
            </div>
          </div>
        </Card>

        <Card>
          <h2 className="u-label">My recent tickets</h2>
          {mineError ? (
            <p className="mt-3 text-sm text-signal-flagged">Couldn't load your tickets.</p>
          ) : mine === null ? (
            <p className="mt-3 text-sm text-fg-muted">Loading…</p>
          ) : mine.length === 0 ? (
            <p className="mt-3 text-sm text-fg-muted">No tickets yet.</p>
          ) : (
            <ul className="mt-3 flex flex-col divide-y divide-line">
              {mine.map((t) => (
                <li key={t.id} data-testid={`my-ticket-${t.id}`} className="py-3 first:pt-0">
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 text-sm font-medium text-fg">{t.subject}</span>
                    <StatusBadge status={t.status} />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
                    {t.area && <span>{t.area} ·</span>}
                    <PriorityBadge priority={t.priority} />
                    <span>· {fmtLong(t.createdAt)}</span>
                  </div>
                  {/* Only once it is resolved: a reopened ticket's old resolution is a
                      note for whoever is working it, not an answer for its raiser. */}
                  {t.status === "closed" && t.resolution && (
                    <p className="mt-1.5 whitespace-pre-wrap text-sm text-fg">
                      <span className="font-medium">Resolution: </span>
                      {t.resolution}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {earlier && earlier.messages.length > 0 && (
        <details className="rounded-xl border border-line bg-surface p-4" data-testid="earlier-messages">
          <summary className="cursor-pointer text-sm font-medium text-fg">
            {earlier.inbox ? "Messages sent to Admin" : "Your earlier messages to Admin"} · {earlier.messages.length}
          </summary>
          <p className="mt-2 text-xs text-fg-muted">Sent before Contact Admin raised tickets, and kept so none is lost.</p>
          <ul className="mt-2 flex flex-col divide-y divide-line">
            {earlier.messages.map((m) => (
              <li key={m.id} className="py-3">
                <div className="flex items-center justify-between text-xs text-fg-muted">
                  <span>{earlier.inbox ? m.sender : "You"}</span>
                  <span>{fmt(m.createdAt)}</span>
                </div>
                <p className="mt-1 text-sm text-fg">{m.body}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

// ── Contact team — the staff channel ─────────────────────────────────────────

function TeamChannelPage() {
  const [data, setData] = useState<{ messages: ContactMessage[]; inbox: boolean } | null>(null);
  const [error, setError] = useState(false);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => listMessages("team").then(setData).catch(() => setError(true)), []);
  useEffect(() => {
    setData(null);
    setError(false);
    load();
  }, [load]);

  async function submit() {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await sendMessage("team", body.trim());
      setBody("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 p-5">
      <div>
        <h1 className="text-xl font-semibold text-fg">Contact team</h1>
        <p className="mt-0.5 text-sm text-fg-muted">Send a note to the whole team.</p>
      </div>

      <Card>
        <div className="u-label">New message</div>
        <textarea
          className="sj-input mt-3 min-h-24"
          aria-label="Message"
          placeholder="Message the team…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="mt-2">
          <Button variant="primary" disabled={busy || !body.trim()} onClick={submit}>
            {busy ? "…" : "Send"}
          </Button>
        </div>
      </Card>

      <Card>
        <div className="u-label">{data?.inbox ? "Inbox" : "Sent"}</div>
        {error ? (
          <p className="mt-3 text-sm text-signal-flagged">Couldn't load messages.</p>
        ) : data === null ? (
          <p className="mt-3 text-sm text-fg-muted">Loading…</p>
        ) : data.messages.length === 0 ? (
          <p className="mt-3 text-sm text-fg-muted">No messages yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col divide-y divide-line">
            {data.messages.map((m) => (
              <li key={m.id} className="py-3">
                <div className="flex items-center justify-between text-xs text-fg-muted">
                  <span>{data.inbox ? m.sender : "You"}</span>
                  <span>{fmt(m.createdAt)}</span>
                </div>
                <p className="mt-1 text-sm text-fg">{m.body}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/**
 * Contact Admin / Contact team (the nav slug decides which). `App.tsx` routes both
 * slugs here, so the split is made on `navId` rather than in the router.
 */
export function ContactPage() {
  const { navId } = useParams();
  return navId === "contactteam" ? <TeamChannelPage /> : <ContactAdminPage />;
}
