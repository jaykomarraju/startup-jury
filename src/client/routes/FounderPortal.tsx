import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, Button, Badge, SignalTag, ScoreChip, EmptyState } from "../components";
import type { DeckView } from "../types";
import {
  listDecks,
  listQueries,
  respondQuery,
  transitionDeck,
  type QueryView,
} from "../api";

function useFounderDecks() {
  const [decks, setDecks] = useState<DeckView[] | null>(null);
  const load = useCallback(
    () => listDecks().then((r) => setDecks(r.decks)).catch(() => setDecks([])),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);
  return { decks, reload: load };
}

/** founder-home — the founder's own submissions and where each one stands. */
export function FounderHomePage() {
  const navigate = useNavigate();
  const { decks } = useFounderDecks();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-fg">My Startup</h1>
          <p className="mt-0.5 text-sm text-fg-muted">Track your submission through the programme pipeline.</p>
        </div>
        <Button variant="primary" size="sm" onClick={() => navigate("/app/founder-upload")}>
          Upload deck
        </Button>
      </div>

      {decks !== null && decks.length === 0 ? (
        <Card>
          <EmptyState
            icon="Upload"
            title="No submissions yet"
            description="Upload your pitch deck to get an AI evaluation and enter the programme pipeline."
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {(decks ?? []).map((deck) => (
            <Card key={deck.id}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-semibold text-fg">{deck.name}</div>
                  <div className="mt-0.5 text-xs text-fg-muted">
                    {[deck.sector, deck.stage, deck.city].filter(Boolean).join(" · ") || "—"}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {deck.signal && <SignalTag signal={deck.signal} />}
                  <ScoreChip value={deck.aiScore} />
                  <Badge tone="info">{deck.status}</Badge>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/** founder-queries — answer clarification requests; answering re-submits the deck. */
export function FounderQueriesPage() {
  const { decks, reload } = useFounderDecks();
  const [queriesByDeck, setQueriesByDeck] = useState<Record<string, QueryView[]>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadQueries = useCallback((deckList: DeckView[]) => {
    Promise.all(deckList.map((d) => listQueries(d.id).then((r) => [d.id, r.queries] as const))).then(
      (pairs) => setQueriesByDeck(Object.fromEntries(pairs)),
    );
  }, []);

  useEffect(() => {
    if (decks) loadQueries(decks);
  }, [decks, loadQueries]);

  async function answer(query: QueryView) {
    const response = (drafts[query.id] ?? "").trim();
    if (!response) return;
    setBusy(query.id);
    setError(null);
    try {
      await respondQuery(query.id, response);
      setDrafts((d) => ({ ...d, [query.id]: "" }));
      await reload();
      if (decks) loadQueries(decks);
    } catch {
      setError("Couldn't send your response. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const open = (decks ?? []).flatMap((d) =>
    (queriesByDeck[d.id] ?? []).map((q) => ({ deck: d, query: q })),
  );
  const pending = open.filter((o) => !o.query.founder_response);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 p-5">
      <div>
        <h1 className="text-xl font-semibold text-fg">Queries</h1>
        <p className="mt-0.5 text-sm text-fg-muted">
          The review team needs a few details. Answer below to send your deck back for evaluation.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-signal-flagged/40 bg-signal-flagged/10 px-4 py-2.5 text-sm text-signal-flagged">
          {error}
        </div>
      )}

      {open.length === 0 ? (
        <Card>
          <EmptyState icon="MessageSquare" title="No queries" description="You're all caught up — nothing needs a response." />
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {open.map(({ deck, query }) => (
            <Card key={query.id}>
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-fg">{deck.name}</div>
                <Badge tone={query.founder_response ? "positive" : "amber"}>
                  {query.founder_response ? "Answered" : "Awaiting your response"}
                </Badge>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-fg">{query.questions}</p>
              {query.founder_response ? (
                <div className="mt-2 rounded-md bg-surface-2 px-3 py-2">
                  <div className="u-label">Your response</div>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm text-fg-muted">{query.founder_response}</p>
                </div>
              ) : (
                <div className="mt-3 flex flex-col gap-2">
                  <textarea
                    className="sj-input min-h-[4rem]"
                    value={drafts[query.id] ?? ""}
                    onChange={(e) => setDrafts((d) => ({ ...d, [query.id]: e.target.value }))}
                    placeholder="Type your response…"
                  />
                  <div className="flex justify-end">
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={busy !== null || !(drafts[query.id] ?? "").trim()}
                      onClick={() => answer(query)}
                    >
                      {busy === query.id ? "Sending…" : "Send response"}
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {pending.length === 0 && open.length > 0 && (
        <p className="text-center text-xs text-fg-muted">All queries answered.</p>
      )}
    </div>
  );
}

/** founder-signup — complete sign-up on decks invited into onboarding. */
export function FounderSignupPage() {
  const { decks, reload } = useFounderDecks();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ready = (decks ?? []).filter((d) => d.statusId === "signup");
  const done = (decks ?? []).filter((d) => d.statusId === "onboard_ready");

  async function complete(deck: DeckView) {
    setBusy(deck.id);
    setError(null);
    try {
      await transitionDeck(deck.id, "complete_signup");
      await reload();
    } catch {
      setError("Couldn't complete sign-up. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 p-5">
      <div>
        <h1 className="text-xl font-semibold text-fg">Sign up</h1>
        <p className="mt-0.5 text-sm text-fg-muted">
          You've been shortlisted. Complete sign-up to move into onboarding.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-signal-flagged/40 bg-signal-flagged/10 px-4 py-2.5 text-sm text-signal-flagged">
          {error}
        </div>
      )}

      {ready.length === 0 && done.length === 0 ? (
        <Card>
          <EmptyState
            icon="CircleCheck"
            title="Nothing to sign up for yet"
            description="Once your deck is shortlisted and sent for sign-up, it appears here."
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {ready.map((deck) => (
            <Card key={deck.id}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-semibold text-fg">{deck.name}</div>
                  <div className="text-xs text-fg-muted">Invited to sign up</div>
                </div>
                <Button variant="primary" size="sm" disabled={busy !== null} onClick={() => complete(deck)}>
                  {busy === deck.id ? "…" : "Complete sign-up"}
                </Button>
              </div>
            </Card>
          ))}
          {done.map((deck) => (
            <Card key={deck.id}>
              <div className="flex items-center justify-between gap-3">
                <div className="font-semibold text-fg">{deck.name}</div>
                <Badge tone="positive">Ready to onboard</Badge>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
