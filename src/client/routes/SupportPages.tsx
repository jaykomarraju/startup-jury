// Phase 7 — Tickets (admin) + Contact (Admin / team) screens. Tickets surface
// support requests with billing routing; Contact sends messages to Admin or the
// team. Backed by /api/tickets and /api/messages.
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Card, Button, Badge, EmptyState } from "../components";
import {
  listTickets,
  createTicket,
  setTicketStatus,
  listMessages,
  sendMessage,
  type Ticket,
  type ContactMessage,
} from "../api";

function fmt(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

/** Admin-only Tickets screen: raise + triage support tickets. */
export function TicketsPage() {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [error, setError] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [billing, setBilling] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => listTickets().then((r) => setTickets(r.tickets)).catch(() => setError(true)), []);
  useEffect(() => {
    load();
  }, [load]);

  async function submit() {
    if (!subject.trim()) return;
    setBusy(true);
    try {
      await createTicket(subject.trim(), body.trim(), billing);
      setSubject("");
      setBody("");
      setBilling(false);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function toggle(t: Ticket) {
    setBusy(true);
    try {
      await setTicketStatus(t.id, t.status === "open" ? "closed" : "open");
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 p-5">
      <div>
        <h1 className="text-xl font-semibold text-fg">Tickets</h1>
        <p className="mt-0.5 text-sm text-fg-muted">Support requests, with billing / credit issues routed to billing.</p>
      </div>

      <Card>
        <div className="u-label">Raise a ticket</div>
        <div className="mt-3 flex flex-col gap-2">
          <input className="sj-input" aria-label="Subject" placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <textarea className="sj-input min-h-20" aria-label="Details" placeholder="Describe the issue…" value={body} onChange={(e) => setBody(e.target.value)} />
          <label className="flex items-center gap-2 text-sm text-fg">
            <input type="checkbox" checked={billing} onChange={(e) => setBilling(e.target.checked)} />
            Billing / credits related
          </label>
          <div>
            <Button variant="primary" disabled={busy || !subject.trim()} onClick={submit}>
              {busy ? "…" : "Submit ticket"}
            </Button>
          </div>
        </div>
      </Card>

      {error ? (
        <Card>
          <EmptyState icon="LifeBuoy" title="Couldn't load tickets" description="Try reloading the page." />
        </Card>
      ) : tickets === null ? (
        <p className="text-sm text-fg-muted">Loading…</p>
      ) : tickets.length === 0 ? (
        <Card>
          <EmptyState icon="LifeBuoy" title="No tickets yet" description="Support requests will appear here." />
        </Card>
      ) : (
        <Card flush className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead>
              <tr className="text-fg-muted">
                <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Subject</th>
                <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">From</th>
                <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Routing</th>
                <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Status</th>
                <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Raised</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id} className="border-t border-line">
                  <td className="px-4 py-3">
                    <div className="font-medium text-fg">{t.subject}</div>
                    {t.body && <div className="mt-0.5 max-w-md text-xs text-fg-muted">{t.body}</div>}
                  </td>
                  <td className="px-4 py-3 text-fg-muted">{t.creator}</td>
                  <td className="px-4 py-3">
                    {t.billingRouted ? <Badge tone="amber">Billing</Badge> : <Badge tone="neutral">General</Badge>}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={t.status === "open" ? "info" : "positive"}>{t.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-fg-muted">{fmt(t.createdAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => toggle(t)}>
                      {t.status === "open" ? "Close" : "Reopen"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

/** Contact Admin / Contact team screen (nav slug decides the scope). */
export function ContactPage() {
  const { navId } = useParams();
  const scope: "admin" | "team" = navId === "contactteam" ? "team" : "admin";
  const title = scope === "team" ? "Contact team" : "Contact Admin";

  const [data, setData] = useState<{ messages: ContactMessage[]; inbox: boolean } | null>(null);
  const [error, setError] = useState(false);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => listMessages(scope).then(setData).catch(() => setError(true)), [scope]);
  useEffect(() => {
    setData(null);
    setError(false);
    load();
  }, [load]);

  async function submit() {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await sendMessage(scope, body.trim());
      setBody("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 p-5">
      <div>
        <h1 className="text-xl font-semibold text-fg">{title}</h1>
        <p className="mt-0.5 text-sm text-fg-muted">
          {scope === "team" ? "Send a note to the whole team." : "Send a message to your workspace administrators."}
        </p>
      </div>

      <Card>
        <div className="u-label">New message</div>
        <textarea
          className="sj-input mt-3 min-h-24"
          aria-label="Message"
          placeholder={scope === "team" ? "Message the team…" : "Message the admins…"}
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
