// Query screen (Evaluation → Query) — de-stubbed for VC in Session 7 and
// upgraded to the prototype's shape for both editions.
//
// The `#panel-query` markup is byte-identical between the incubator and VC
// prototypes (only three CSS deltas), so this is one screen, not two. It renders
// the prototype's "Founder queries" table — Startup · Founder · Phone · Email ·
// Status · Parameters needing response — over the query loop that has existed
// server-side since Phase 4 (`GET/POST /api/decks/:id/queries`). Only the deck
// stages that can carry a query differ per edition.
//
// Deviation from the prototype: its "Email query" tab composes a mail with a
// hardcoded tokenized link and a fake send. Ours posts a real query, which sends
// a real email through the outbox — so the compose pane is the message, without
// the fabricated link (the tokenized founder link belongs to the Session-6
// resubmit loop, which is a different, automatic flow).

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, Button, Badge, EmptyState } from "../components";
import type { DeckView } from "../types";
import { useAuth } from "../auth/useAuth";
import { listDecks, listQueries, listAllQueries, createQuery, type QueryView } from "../api";
import { INTAKE_FIELD_LABELS } from "../../shared/intake";
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

/** Prototype's `qStatusLabel`, derived from the deck's real query history. */
export function queryStatusOf(queries: QueryView[], now = Date.now()): QueryStatus {
  if (queries.length === 0) return "not_asked";
  const latest = queries[0];
  if (latest.founder_response) return "responded";
  const age = now - new Date(latest.created_at).getTime();
  return age > OVERDUE_DAYS * 86_400_000 ? "overdue" : "pending";
}

export function QueryPage() {
  const { user } = useAuth();
  const [decks, setDecks] = useState<DeckView[] | null>(null);
  const [allQueries, setAllQueries] = useState<QueryView[]>([]);
  const [selected, setSelected] = useState<DeckView | null>(null);
  const [queries, setQueries] = useState<QueryView[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const loadQueries = useCallback((id: string) => {
    listQueries(id)
      .then((r) => setQueries(r.queries))
      .catch(() => setQueries([]));
  }, []);

  useEffect(() => {
    if (selected) loadQueries(selected.id);
    else setQueries([]);
  }, [selected, loadQueries]);

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

  async function submit() {
    if (!selected || !text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await createQuery(selected.id, text.trim());
      setText("");
      loadQueries(selected.id);
      await load();
    } catch {
      setError("Couldn't send the query. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 p-5">
      <div>
        <h1 className="text-xl font-semibold text-fg">Query</h1>
        <p className="mt-0.5 text-sm text-fg-muted">
          Founder queries — decks awaiting founder clarification. Ask for the missing detail; the
          founder responds and the deck re-enters intake.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-signal-flagged/40 bg-signal-flagged/10 px-4 py-2.5 text-sm text-signal-flagged">
          {error}
        </div>
      )}

      {decks !== null && rows.length === 0 ? (
        <EmptyState
          icon="MessageSquare"
          title="Nothing to query"
          description="Decks flagged for founder clarification appear here."
        />
      ) : (
        <Card flush>
          <div className="u-label border-b border-line px-4 py-3 text-fg-muted">
            Founder queries · {rows.length}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left">
              <thead>
                <tr className="u-label border-b border-line text-fg-muted">
                  <th className="px-4 py-2">Startup</th>
                  <th className="px-4 py-2">Founder</th>
                  <th className="px-4 py-2">Phone</th>
                  <th className="px-4 py-2">Email</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Parameters needing response</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((deck) => {
                  const status = queryStatusOf(byDeck.get(deck.id) ?? []);
                  return (
                    <tr
                      key={deck.id}
                      className={`border-b border-line/60 last:border-0 ${
                        selected?.id === deck.id ? "bg-accent/5" : ""
                      }`}
                    >
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          className="text-sm font-medium text-fg underline-offset-2 hover:underline"
                          onClick={() => setSelected(deck)}
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
                        {deck.missingFields?.length ? (
                          <div className="flex flex-wrap gap-1">
                            {deck.missingFields.map((f) => (
                              <span
                                key={f}
                                className="rounded-full border border-line px-2 py-0.5 text-xs text-fg-muted"
                              >
                                {INTAKE_FIELD_LABELS[f]}
                              </span>
                            ))}
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
      )}

      <Card className="min-w-0 flex-1">
        {!selected ? (
          <EmptyState
            icon="MessageSquare"
            title="Select a deck to query"
            description="Pick a startup above to send the founder a clarification request."
          />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="border-b border-line pb-3">
              <h2 className="text-lg font-semibold text-fg">{selected.name}</h2>
              <p className="text-xs text-fg-muted">
                {selected.founder ?? "Founder unknown"}
                {selected.founderEmail ? ` · ${selected.founderEmail}` : ""}
              </p>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-fg-muted">Questions for the founder</span>
              <textarea
                className="sj-input min-h-[5rem]"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="e.g. Please share current MRR, churn, and your team's full-time count."
              />
            </label>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-fg-muted">
                Sent by email to {selected.founderEmail ?? "the deck's registered contact"}.
              </span>
              <Button variant="primary" disabled={busy || !text.trim()} onClick={submit}>
                {busy ? "Sending…" : "Send query"}
              </Button>
            </div>

            <div>
              <h3 className="u-label mb-2">Sent queries</h3>
              {queries.length === 0 ? (
                <p className="text-sm text-fg-muted">No queries sent yet.</p>
              ) : (
                <ul className="flex flex-col gap-3">
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
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
