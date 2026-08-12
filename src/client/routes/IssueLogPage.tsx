// Session 7 — the internal issue log. One place the team records what it finds
// while testing, instead of scattering it across chat threads and email.
//
// The prototypes have no issue-tracker screen (only the customer-facing Support
// tickets panel), so the layout borrows that panel's shape deliberately: stat
// tiles that double as filters, a chip row, and a table with ID / Ticket /
// Category / Priority / Status / Age. Everyone internal can file; triage
// (status, severity, owner) is admin-only and enforced on the server too.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bug } from "lucide-react";
import { Button, Card, Badge, EmptyState } from "../components";
import { useAuth } from "../auth/useAuth";
import {
  listIssues,
  createIssue,
  updateIssue,
  listUsers,
  type IssueView,
  type UserView,
} from "../api";

const SEVERITIES = ["low", "medium", "high", "critical"] as const;
const STATUSES = ["open", "in_progress", "closed"] as const;

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  closed: "Closed",
};

const SEVERITY_TONE: Record<string, "danger" | "amber" | "info" | "neutral"> = {
  critical: "danger",
  high: "danger",
  medium: "amber",
  low: "neutral",
};

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

/** Whole days since `iso` — the Support panel's "Age" column. */
function ageDays(iso: string): string {
  const days = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
  return days === 0 ? "today" : `${days}d`;
}

export function IssueLogPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "superuser";

  const [issues, setIssues] = useState<IssueView[] | null>(null);
  const [team, setTeam] = useState<UserView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | (typeof STATUSES)[number]>("all");
  const [busy, setBusy] = useState(false);

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [severity, setSeverity] = useState<string>("medium");
  const [area, setArea] = useState("");

  const load = useCallback(async () => {
    try {
      setIssues((await listIssues()).issues);
      setError(null);
    } catch {
      setError("Couldn't load the issue log.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The assignee dropdown needs the roster, which is admin-gated — a non-admin
  // simply doesn't get the control.
  useEffect(() => {
    if (!isAdmin) return;
    listUsers()
      .then((r) => setTeam(r.users))
      .catch(() => setTeam([]));
  }, [isAdmin]);

  const counts = useMemo(() => {
    const rows = issues ?? [];
    return {
      all: rows.length,
      open: rows.filter((i) => i.status === "open").length,
      in_progress: rows.filter((i) => i.status === "in_progress").length,
      closed: rows.filter((i) => i.status === "closed").length,
    };
  }, [issues]);

  const rows = useMemo(
    () => (issues ?? []).filter((i) => filter === "all" || i.status === filter),
    [issues, filter],
  );

  async function submit() {
    if (!subject.trim() || busy) return;
    setBusy(true);
    try {
      await createIssue({ subject: subject.trim(), body: body.trim(), severity, area: area.trim() });
      setSubject("");
      setBody("");
      setArea("");
      setSeverity("medium");
      await load();
    } catch {
      setError("Couldn't log that issue. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, change: Parameters<typeof updateIssue>[1]) {
    setBusy(true);
    try {
      await updateIssue(id, change);
      await load();
    } catch {
      setError("Couldn't update that issue.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-5">
      <h1 className="text-xl font-semibold text-fg">Issue log</h1>
      <p className="mb-5 mt-1 text-sm text-fg-muted">
        The team's internal tracker — log anything you hit while testing so it lands in one place.
        {isAdmin ? " As an admin you can also triage, assign and close." : " An admin triages from here."}
      </p>

      {error ? (
        <div className="mb-4 rounded-lg border border-signal-weak/40 bg-signal-weak/10 px-3 py-2 text-sm text-fg">
          {error}
        </div>
      ) : null}

      <Card className="mb-5">
        <h2 className="mb-3 text-sm font-semibold text-fg">Log an issue</h2>
        <div className="flex flex-col gap-3">
          <input
            className="sj-input"
            placeholder="Brief summary of the issue"
            aria-label="Issue summary"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
          <textarea
            className="sj-input min-h-[5rem]"
            placeholder="What did you expect, what happened, and how do we reproduce it?"
            aria-label="Issue detail"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-fg-muted">
              Severity
              <select
                className="sj-input h-8 w-32 py-0 text-xs"
                aria-label="Severity"
                value={severity}
                onChange={(e) => setSeverity(e.target.value)}
              >
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {s[0].toUpperCase() + s.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <input
              className="sj-input h-8 w-48 py-0 text-xs"
              placeholder="Screen / area (e.g. Upload)"
              aria-label="Area"
              value={area}
              onChange={(e) => setArea(e.target.value)}
            />
            <Button size="sm" onClick={submit} disabled={!subject.trim() || busy}>
              Log issue
            </Button>
          </div>
        </div>
      </Card>

      <div className="mb-3 flex flex-wrap gap-2">
        {(["all", ...STATUSES] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter(s)}
            className={`rounded-full border px-3 py-1 text-xs ${
              filter === s ? "border-accent bg-accent/15 text-fg" : "border-line text-fg-muted"
            }`}
          >
            {s === "all" ? "All" : STATUS_LABELS[s]} · {counts[s]}
          </button>
        ))}
      </div>

      {issues === null ? (
        <p className="text-sm text-fg-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon="Bug"
          title="No issues in this view"
          description="Nothing logged yet for this filter — log the first one above."
        />
      ) : (
        <Card flush>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left">
              <thead>
                <tr className="u-label border-b border-line text-fg-muted">
                  <th className="px-4 py-2">Issue</th>
                  <th className="px-4 py-2">Area</th>
                  <th className="px-4 py-2">Severity</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Owner</th>
                  <th className="px-4 py-2">Raised</th>
                  <th className="px-4 py-2">Age</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((issue) => (
                  <tr key={issue.id} className="border-b border-line/60 align-top last:border-0">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 text-sm font-medium text-fg">
                        <Bug className="h-3.5 w-3.5 text-fg-muted" />
                        {issue.subject}
                      </div>
                      {issue.body ? (
                        <div className="mt-1 max-w-xl text-xs text-fg-muted">{issue.body}</div>
                      ) : null}
                      <div className="mt-1 text-xs text-fg-muted">by {issue.creator}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-fg-muted">{issue.area ?? "—"}</td>
                    <td className="px-4 py-3">
                      {issue.severity ? (
                        <Badge tone={SEVERITY_TONE[issue.severity] ?? "neutral"}>
                          {issue.severity[0].toUpperCase() + issue.severity.slice(1)}
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isAdmin ? (
                        <select
                          className="sj-input h-8 w-32 py-0 text-xs"
                          aria-label={`Status for ${issue.subject}`}
                          value={issue.status}
                          disabled={busy}
                          onChange={(e) => patch(issue.id, { status: e.target.value })}
                        >
                          {STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {STATUS_LABELS[s]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Badge tone={issue.status === "closed" ? "positive" : "info"}>
                          {STATUS_LABELS[issue.status] ?? issue.status}
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isAdmin ? (
                        <select
                          className="sj-input h-8 w-40 py-0 text-xs"
                          aria-label={`Owner for ${issue.subject}`}
                          value={issue.assigneeId ?? ""}
                          disabled={busy}
                          onChange={(e) => patch(issue.id, { assigneeId: e.target.value || null })}
                        >
                          <option value="">— unassigned —</option>
                          {team.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-sm text-fg-muted">{issue.assignee ?? "—"}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-fg-muted">{fmt(issue.createdAt)}</td>
                    <td className="px-4 py-3 text-sm text-fg-muted">{ageDays(issue.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
