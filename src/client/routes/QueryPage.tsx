import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, Button, Badge, EmptyState } from "../components";
import type { DeckView } from "../types";
import { listDecks, listQueries, createQuery, type QueryView } from "../api";

/**
 * Query screen (Evaluation → Query). Staff raise founder clarification requests on
 * decks flagged Incomplete (or still in Manual Review — raising a query there marks
 * them Incomplete). Sent queries + founder responses are listed inline. Delivery
 * uses the stubbed email outbox; the founder answers from their portal.
 */
export function QueryPage() {
  const [decks, setDecks] = useState<DeckView[] | null>(null);
  const [selected, setSelected] = useState<DeckView | null>(null);
  const [queries, setQueries] = useState<QueryView[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    return listDecks()
      .then((r) => setDecks(r.decks))
      .catch(() => setDecks([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loadQueries = useCallback((id: string) => {
    listQueries(id).then((r) => setQueries(r.queries)).catch(() => setQueries([]));
  }, []);

  useEffect(() => {
    if (selected) loadQueries(selected.id);
    else setQueries([]);
  }, [selected, loadQueries]);

  const rows = useMemo(
    () => (decks ?? []).filter((d) => d.statusId === "incomplete" || d.statusId === "manual_review"),
    [decks],
  );

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
          Ask founders for the missing details on incomplete decks. They respond from their portal and the deck re-enters intake.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-signal-flagged/40 bg-signal-flagged/10 px-4 py-2.5 text-sm text-signal-flagged">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-5 lg:flex-row">
        <Card flush className="w-full shrink-0 overflow-hidden lg:w-72">
          <div className="u-label border-b border-line px-4 py-3">Incomplete · {rows.length}</div>
          {decks !== null && rows.length === 0 ? (
            <div className="p-4">
              <EmptyState icon="MessageSquare" title="Nothing to query" description="Incomplete decks appear here." />
            </div>
          ) : (
            <ul className="max-h-[28rem] overflow-y-auto">
              {rows.map((deck) => (
                <li key={deck.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(deck)}
                    className={`flex w-full items-center justify-between gap-2 border-b border-line px-4 py-3 text-left transition-colors hover:bg-surface-2 ${selected?.id === deck.id ? "bg-accent/5" : ""}`}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-fg">{deck.name}</div>
                      <div className="truncate text-xs text-fg-muted">{deck.founder ?? "Founder unknown"}</div>
                    </div>
                    <Badge tone="danger">{deck.status}</Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="min-w-0 flex-1">
          {!selected ? (
            <EmptyState
              icon="MessageSquare"
              title="Select a deck to query"
              description="Pick an incomplete deck to send the founder a clarification request."
            />
          ) : (
            <div className="flex flex-col gap-4">
              <div className="border-b border-line pb-3">
                <h2 className="text-lg font-semibold text-fg">{selected.name}</h2>
                <p className="text-xs text-fg-muted">{selected.founder ?? "Founder unknown"}</p>
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
              <div className="flex justify-end">
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
                            <p className="mt-0.5 whitespace-pre-wrap text-sm text-fg-muted">{q.founder_response}</p>
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
    </div>
  );
}
