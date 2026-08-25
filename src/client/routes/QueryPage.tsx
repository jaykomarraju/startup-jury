// Query screen (Evaluation → Query).
//
// Aug-2026 issue log:
//   • 15 — two tabs on the top row: FOUNDER QUERIES and EMAIL QUERY.
//   • 16 — tab 1 is Startup · Founder · Phone · Email · Status · Parameters
//          needing response, with a checkbox per row (and select-all). Ticking
//          any row opens the Email query tab with those founders as recipients
//          and a message that lists their areas requiring response, plus the
//          link to the portion of the response form that is theirs.
//   • 17 — clicking the STARTUP name opens its "Areas requiring response".
//   • 18 — tab 2 emails the selected startups via Send query.
//
// The compose pane posts a real query per selected deck, which sends a real
// email through the outbox — so what is on screen is what the founder receives.

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Mail, ListChecks, X } from "lucide-react";
import { Card, Button, Badge, EmptyState } from "../components";
import type { DeckView } from "../types";
import { useAuth } from "../auth/useAuth";
import { listDecks, listQueries, listAllQueries, createQuery, type QueryView } from "../api";
import {
  areasNeedingResponse,
  buildQueryMessage,
  AREA_KIND_LABELS,
  type ResponseArea,
} from "../../shared/queries";
import type { Edition } from "../../shared/roles";

/** Deck stages whose decks can still be sent a founder clarification. */
const QUERYABLE_STATUSES: Record<Edition, string[]> = {
  // Incubator: the AI flagged it Incomplete, or it's parked in manual review.
  incubator: ["incomplete", "manual_review"],
  // VC has no manual-review stage; a query is raised while the deal is being
  // scored, or after the AI marked the submission incomplete.
  vc: ["incomplete", "analyst_scoring", "associate_review"],
};

/** A query with no answer is Overdue once it's older than this. */
const OVERDUE_DAYS = 5;

type QueryStatus = "not_asked" | "pending" | "overdue" | "responded";

const STATUS_LABELS: Record<QueryStatus, string> = {
  not_asked: "Not asked",
  pending: "Pending",
  overdue: "Overdue",
  responded: "Responded",
};

const STATUS_TONE: Record<QueryStatus, "neutral" | "amber" | "danger" | "positive"> = {
  not_asked: "neutral",
  pending: "amber",
  overdue: "danger",
  responded: "positive",
};

const AREA_TONE: Record<ResponseArea["kind"], string> = {
  detail: "border-signal-flagged/40 text-signal-flagged",
  section: "border-amber/50 text-amber",
  parameter: "border-line text-fg-muted",
};

const DEFAULT_SUBJECT = "Clarification requested on your pitchdeck submission";

/** Prototype's `qStatusLabel`, derived from the deck's real query history. */
export function queryStatusOf(queries: QueryView[], now = Date.now()): QueryStatus {
  if (queries.length === 0) return "not_asked";
  const latest = queries[0];
  if (latest.founder_response) return "responded";
  const age = now - new Date(latest.created_at).getTime();
  return age > OVERDUE_DAYS * 86_400_000 ? "overdue" : "pending";
}

type Tab = "list" | "email";

export function QueryPage() {
  const { user } = useAuth();
  const [decks, setDecks] = useState<DeckView[] | null>(null);
  const [allQueries, setAllQueries] = useState<QueryView[]>([]);
  const [tab, setTab] = useState<Tab>("list");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  /** The startup whose "Areas requiring response" drill-down is open (issue 17). */
  const [drilldown, setDrilldown] = useState<DeckView | null>(null);
  const [drilldownQueries, setDrilldownQueries] = useState<QueryView[]>([]);
  const [subject, setSubject] = useState(DEFAULT_SUBJECT);
  const [body, setBody] = useState("");
  const [bodyEdited, setBodyEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentCount, setSentCount] = useState<number | null>(null);

  const load = useCallback(async () => {
    const [deckRes, queryRes] = await Promise.all([
      listDecks().catch(() => ({ decks: [] as DeckView[] })),
      // Staff-only listing; a role without it just loses the status column.
      listAllQueries().catch(() => ({ queries: [] as QueryView[] })),
    ]);
    setDecks(deckRes.decks);
    setAllQueries(queryRes.queries);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!drilldown) {
      setDrilldownQueries([]);
      return;
    }
    listQueries(drilldown.id)
      .then((r) => setDrilldownQueries(r.queries))
      .catch(() => setDrilldownQueries([]));
  }, [drilldown]);

  const byDeck = useMemo(() => {
    const map = new Map<string, QueryView[]>();
    for (const q of allQueries) {
      const list = map.get(q.deck_id);
      if (list) list.push(q);
      else map.set(q.deck_id, [q]);
    }
    return map;
  }, [allQueries]);

  const rows = useMemo(() => {
    const statuses = QUERYABLE_STATUSES[(user?.edition as Edition) ?? "incubator"];
    return (decks ?? []).filter((d) => d.statusId && statuses.includes(d.statusId));
  }, [decks, user?.edition]);

  const selected = useMemo(
    () => rows.filter((d) => selectedIds.includes(d.id)),
    [rows, selectedIds],
  );

  // The default message follows the selection until the user edits it.
  useEffect(() => {
    if (bodyEdited) return;
    if (selected.length === 0) {
      setBody("");
      return;
    }
    if (selected.length === 1) {
      setBody(buildQueryMessage(selected[0].name, areasNeedingResponse(selected[0])));
      return;
    }
    const shared = selected.flatMap((d) => areasNeedingResponse(d));
    setBody(buildQueryMessage("your pitch deck", shared));
  }, [selected, bodyEdited]);

  function toggle(id: string) {
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
    setSentCount(null);
  }

  function toggleAll() {
    setSelectedIds((ids) => (ids.length === rows.length ? [] : rows.map((d) => d.id)));
    setSentCount(null);
  }

  /** Issue 18 — one real query per selected deck, each of which emails the founder. */
  async function sendQuery() {
    if (selected.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      let sent = 0;
      for (const deck of selected) {
        const message = [subject, "", body].join("\n");
        await createQuery(deck.id, message);
        sent += 1;
      }
      setSentCount(sent);
      setSelectedIds([]);
      setBodyEdited(false);
      await load();
    } catch {
      setError("Couldn't send the query. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const allSelected = rows.length > 0 && selectedIds.length === rows.length;

  return (
    <div className="flex flex-col gap-5 p-5">
      <div>
        <h1 className="text-xl font-semibold text-fg">
          {tab === "email" ? "Email query" : "Founder queries"}
        </h1>
        <p className="mt-0.5 max-w-3xl text-sm text-fg-muted">
          {tab === "email"
            ? "Compose a clarification email to the founders you selected. They also see these queries inside their portal."
            : "AI-flagged decks awaiting founder clarification. Tick the startups you want to query, or click a startup to see the areas requiring its response."}
        </p>
      </div>

      {/* Issue 15 — the two tabs on the top row. */}
      <div className="flex gap-1 border-b border-line" role="tablist">
        <TabButton active={tab === "list"} onClick={() => setTab("list")} icon={<ListChecks className="h-4 w-4" />}>
          Founder queries
        </TabButton>
        <TabButton active={tab === "email"} onClick={() => setTab("email")} icon={<Mail className="h-4 w-4" />}>
          Email query
          {selectedIds.length > 0 && (
            <span className="ml-1.5 rounded-full bg-accent px-1.5 text-[10px] font-semibold text-navy">
              {selectedIds.length}
            </span>
          )}
        </TabButton>
      </div>

      {error && (
        <div className="rounded-lg border border-signal-flagged/40 bg-signal-flagged/10 px-4 py-2.5 text-sm text-signal-flagged">
          {error}
        </div>
      )}

      {tab === "list" ? (
        drilldown ? (
          <AreasPanel
            deck={drilldown}
            queries={drilldownQueries}
            onBack={() => setDrilldown(null)}
            onQuery={() => {
              setSelectedIds([drilldown.id]);
              setDrilldown(null);
              setTab("email");
            }}
          />
        ) : decks !== null && rows.length === 0 ? (
          <EmptyState
            icon="MessageSquare"
            title="Nothing to query"
            description="Decks flagged for founder clarification appear here."
          />
        ) : (
          <>
            {selectedIds.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent/40 bg-accent/5 px-4 py-2.5">
                <span className="text-sm text-fg">
                  {selectedIds.length} founder{selectedIds.length === 1 ? "" : "s"} selected ·{" "}
                  <button
                    type="button"
                    className="text-fg-muted underline-offset-2 hover:underline"
                    onClick={() => setSelectedIds([])}
                  >
                    Clear selection
                  </button>
                </span>
                <Button size="sm" onClick={() => setTab("email")}>
                  Email query
                </Button>
              </div>
            )}

            <Card flush>
              <div className="u-label border-b border-line px-4 py-3">
                Founder queries · {rows.length}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[60rem] text-left">
                  <thead>
                    <tr className="border-b border-line text-fg-muted">
                      <th className="w-10 px-4 py-2.5">
                        <input
                          type="checkbox"
                          aria-label="Select all startups"
                          checked={allSelected}
                          onChange={toggleAll}
                        />
                      </th>
                      <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Startup</th>
                      <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Founder</th>
                      <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Phone</th>
                      <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Email</th>
                      <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Status</th>
                      <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">
                        Parameters needing response
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((deck) => {
                      const status = queryStatusOf(byDeck.get(deck.id) ?? []);
                      const areas = areasNeedingResponse(deck);
                      return (
                        <tr
                          key={deck.id}
                          className={`border-b border-line/60 last:border-0 ${
                            selectedIds.includes(deck.id) ? "bg-accent/5" : ""
                          }`}
                        >
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              aria-label={`Select ${deck.name}`}
                              checked={selectedIds.includes(deck.id)}
                              onChange={() => toggle(deck.id)}
                            />
                          </td>
                          <td className="px-4 py-3">
                            {/* Issue 17 — the startup name opens its areas. */}
                            <button
                              type="button"
                              className="text-sm font-medium text-fg underline-offset-2 hover:underline"
                              onClick={() => setDrilldown(deck)}
                            >
                              {deck.name}
                            </button>
                            <div className="text-xs text-fg-muted">
                              {[deck.sector, deck.stage, deck.city].filter(Boolean).join(" · ") || deck.status}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm text-fg-muted">{deck.founder ?? "—"}</td>
                          <td className="px-4 py-3 text-sm text-fg-muted">{deck.founderPhone ?? "—"}</td>
                          <td className="px-4 py-3 text-sm text-fg-muted">{deck.founderEmail ?? "—"}</td>
                          <td className="px-4 py-3">
                            <Badge tone={STATUS_TONE[status]}>{STATUS_LABELS[status]}</Badge>
                          </td>
                          <td className="px-4 py-3">
                            {areas.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {areas.slice(0, 4).map((a) => (
                                  <span
                                    key={`${a.kind}-${a.label}`}
                                    className={`rounded-full border px-2 py-0.5 text-xs ${AREA_TONE[a.kind]}`}
                                    title={AREA_KIND_LABELS[a.kind]}
                                  >
                                    {a.label}
                                  </span>
                                ))}
                                {areas.length > 4 && (
                                  <span className="text-xs text-fg-muted">+{areas.length - 4} more</span>
                                )}
                              </div>
                            ) : (
                              <span className="text-sm text-fg-muted">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )
      ) : (
        /* Issue 18 — the Email query tab. */
        <div className="flex flex-col gap-4">
          <button
            type="button"
            className="flex w-fit items-center gap-1.5 text-sm text-fg-muted hover:text-fg"
            onClick={() => setTab("list")}
          >
            <ArrowLeft className="h-4 w-4" /> Back to founder queries
          </button>

          {sentCount !== null && (
            <div className="rounded-lg border border-positive/40 bg-positive/10 px-4 py-2.5 text-sm text-fg">
              Query sent to {sentCount} founder{sentCount === 1 ? "" : "s"}. They can respond by
              email or in their founder portal.
            </div>
          )}

          <Card>
            <div className="u-label">Recipients</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {selected.length === 0 ? (
                <p className="text-sm text-fg-muted">
                  No founders selected. Pick founders on the Founder queries tab to email them a query.
                </p>
              ) : (
                selected.map((d) => (
                  <span
                    key={d.id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-1 text-xs text-fg"
                  >
                    {d.founder ?? d.name}
                    <span className="text-fg-muted">· {d.founderEmail ?? "no email on file"}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${d.name}`}
                      className="text-fg-muted hover:text-signal-flagged"
                      onClick={() => toggle(d.id)}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))
              )}
            </div>
          </Card>

          <Card>
            <div className="u-label">Message</div>
            <label className="mt-3 flex flex-col gap-1">
              <span className="text-xs font-medium text-fg-muted">Subject</span>
              <input
                className="sj-input"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </label>
            <label className="mt-3 flex flex-col gap-1">
              <span className="text-xs font-medium text-fg-muted">Body</span>
              <textarea
                className="sj-input min-h-[13rem] font-sans"
                value={body}
                onChange={(e) => {
                  setBody(e.target.value);
                  setBodyEdited(true);
                }}
              />
            </label>
            <p className="mt-2 text-xs text-fg-muted">
              Each founder receives their own copy listing only their areas requiring response, plus
              a link to their portal where they can answer or re-upload a corrected deck. Founders
              never see another startup&rsquo;s query.
            </p>
            <div className="mt-3 flex items-center justify-end gap-2">
              {bodyEdited && (
                <button
                  type="button"
                  className="text-xs text-fg-muted underline-offset-2 hover:underline"
                  onClick={() => setBodyEdited(false)}
                >
                  Reset to the generated message
                </button>
              )}
              <Button
                variant="primary"
                disabled={busy || selected.length === 0 || !body.trim()}
                onClick={sendQuery}
              >
                {busy ? "Sending…" : "Send query"}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors ${
        active
          ? "border-amber font-medium text-fg"
          : "border-transparent text-fg-muted hover:text-fg"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

/** Issue 17 — the drill-down a startup name opens. */
function AreasPanel({
  deck,
  queries,
  onBack,
  onQuery,
}: {
  deck: DeckView;
  queries: QueryView[];
  onBack: () => void;
  onQuery: () => void;
}) {
  const areas = areasNeedingResponse(deck);
  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        className="flex w-fit items-center gap-1.5 text-sm text-fg-muted hover:text-fg"
        onClick={onBack}
      >
        <ArrowLeft className="h-4 w-4" /> Back to founder queries
      </button>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-3">
          <div>
            <h2 className="text-lg font-semibold text-fg">{deck.name}</h2>
            <p className="text-xs text-fg-muted">
              {[deck.sector, deck.stage, deck.city].filter(Boolean).join(" · ")}
              {deck.founder ? ` · ${deck.founder}` : ""}
              {deck.founderEmail ? ` · ${deck.founderEmail}` : ""}
            </p>
          </div>
          <Button size="sm" onClick={onQuery}>
            Email this founder
          </Button>
        </div>

        <h3 className="u-label mt-4">Areas requiring response · {areas.length}</h3>
        {areas.length === 0 ? (
          <p className="mt-2 text-sm text-fg-muted">
            Nothing outstanding — every required detail is captured and no area is below the
            workspace&rsquo;s threshold.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {areas.map((a) => (
              <li
                key={`${a.kind}-${a.label}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2.5"
              >
                <span className="text-sm text-fg">{a.label}</span>
                <span className={`rounded-full border px-2 py-0.5 text-xs ${AREA_TONE[a.kind]}`}>
                  {AREA_KIND_LABELS[a.kind]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h3 className="u-label">Queries already sent · {queries.length}</h3>
        {queries.length === 0 ? (
          <p className="mt-2 text-sm text-fg-muted">No queries sent yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {queries.map((q) => (
              <li key={q.id} className="rounded-lg border border-line px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-fg">Query</span>
                  <Badge tone={q.founder_response ? "positive" : "amber"}>
                    {q.founder_response ? "Answered" : q.email_status}
                  </Badge>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-fg">{q.questions}</p>
                {q.founder_response && (
                  <div className="mt-2 rounded-md bg-surface-2 px-3 py-2">
                    <div className="u-label">Founder response</div>
                    <p className="mt-0.5 whitespace-pre-wrap text-sm text-fg-muted">
                      {q.founder_response}
                    </p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
