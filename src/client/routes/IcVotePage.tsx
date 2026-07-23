import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, Button, Badge, ScoreChip, SignalTag, EmptyState } from "../components";
import { useAuth } from "../auth/useAuth";
import type { DeckView, DeckAction } from "../types";
import {
  listDecks,
  listIcVotes,
  castIcVote,
  transitionDeck,
  IC_VOTE_LABELS,
  type IcVotes,
  type IcVoteValue,
} from "../api";

const VOTE_OPTIONS: IcVoteValue[] = ["invest", "hold", "need_more_info", "pass"];

const VOTE_TONE: Record<IcVoteValue, "positive" | "amber" | "info" | "danger"> = {
  invest: "positive",
  hold: "amber",
  need_more_info: "info",
  pass: "danger",
};

/**
 * IC Pipeline (Due Diligence → IC Pipeline). The Investment Committee's decision
 * queue: decks in `ic_review` collect one vote per member (Invest / Hold / Need
 * more info / Pass) with a live aggregated tally; the Managing Partner closes the
 * vote and then renders the final decision (Invest / Pass / Return to partner) on
 * decks that reach `mp_decision`.
 */
export function IcVotePage() {
  const { user } = useAuth();
  const [decks, setDecks] = useState<DeckView[] | null>(null);
  const [selected, setSelected] = useState<DeckView | null>(null);
  const [votes, setVotes] = useState<IcVotes | null>(null);
  const [comment, setComment] = useState("");
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

  const rows = useMemo(
    () => (decks ?? []).filter((d) => d.statusId === "ic_review" || d.statusId === "mp_decision"),
    [decks],
  );

  const loadVotes = useCallback((deckId: string) => {
    return listIcVotes(deckId)
      .then(setVotes)
      .catch(() => setVotes(null));
  }, []);

  // Load this deal's ballots + tally whenever the selection changes (keyed on id so
  // a background deck-list refresh doesn't re-fetch or re-render needlessly).
  const selectedId = selected?.id ?? null;
  useEffect(() => {
    if (!selectedId) {
      setVotes(null);
      setComment("");
      return;
    }
    loadVotes(selectedId);
  }, [selectedId, loadVotes]);

  async function vote(v: IcVoteValue) {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await castIcVote(selected.id, v, comment.trim() || undefined);
      setComment("");
      await loadVotes(selected.id);
    } catch {
      setError("Couldn't record your vote. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function runAction(action: DeckAction) {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await transitionDeck(selected.id, action.action);
      const next = await listDecks().then((r) => r.decks);
      setDecks(next);
      // Follow the deck to its next IC stage, or clear if it left the queue.
      setSelected(next.find((d) => d.id === selected.id && (d.statusId === "ic_review" || d.statusId === "mp_decision")) ?? null);
    } catch {
      setError(`Couldn't ${action.label.toLowerCase()}. Try again.`);
    } finally {
      setBusy(false);
    }
  }

  const canVote = user?.role === "ic_member" || user?.role === "partner" || user?.role === "superuser";

  return (
    <div className="flex flex-col gap-5 p-5">
      <div>
        <h1 className="text-xl font-semibold text-fg">IC Pipeline</h1>
        <p className="mt-0.5 text-sm text-fg-muted">
          Decision Queue — Investment Committee review, per-member voting and the Managing Partner's final call.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-signal-flagged/40 bg-signal-flagged/10 px-4 py-2.5 text-sm text-signal-flagged">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-5 lg:flex-row">
        <Card flush className="w-full shrink-0 overflow-hidden lg:w-72">
          <div className="u-label border-b border-line px-4 py-3">In committee · {rows.length}</div>
          {decks !== null && rows.length === 0 ? (
            <div className="p-4">
              <EmptyState icon="Vote" title="Nothing at IC" description="Sponsored deals appear here for the committee." />
            </div>
          ) : (
            <ul className="max-h-[32rem] overflow-y-auto">
              {rows.map((deck) => (
                <li key={deck.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(deck)}
                    className={`flex w-full items-center justify-between gap-2 border-b border-line px-4 py-3 text-left transition-colors hover:bg-surface-2 ${selected?.id === deck.id ? "bg-accent/5" : ""}`}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-fg">{deck.name}</div>
                      <div className="truncate text-xs text-fg-muted">
                        {deck.statusId === "mp_decision" ? "MP decision" : "Awaiting votes"}
                      </div>
                    </div>
                    <ScoreChip value={deck.aiScore} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="min-w-0 flex-1">
          {!selected ? (
            <EmptyState
              icon="Vote"
              title="Select a deal to review"
              description="Pick a deal from the committee queue to cast your vote or record the MP decision."
            />
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-start justify-between gap-3 border-b border-line pb-3">
                <div>
                  <h2 className="text-lg font-semibold text-fg">{selected.name}</h2>
                  <div className="mt-1 flex items-center gap-2">
                    {selected.signal && <SignalTag signal={selected.signal} />}
                    <span className="text-xs text-fg-muted">AI score</span>
                    <ScoreChip value={selected.aiScore} />
                    <Badge tone="info">{selected.status}</Badge>
                  </div>
                </div>
                {votes && votes.recommendation && (
                  <div className="text-right">
                    <div className="u-label">Committee lean</div>
                    <div className="font-semibold text-accent">{IC_VOTE_LABELS[votes.recommendation]}</div>
                  </div>
                )}
              </div>

              {/* Aggregated tally across all IC members. */}
              <div>
                <div className="u-label mb-2">Vote tally · {votes?.total ?? 0} cast</div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {VOTE_OPTIONS.map((v) => (
                    <div key={v} className="rounded-lg border border-line px-3 py-2">
                      <div className="font-mono text-xl font-bold text-fg">{votes?.tally[v] ?? 0}</div>
                      <div className="text-xs text-fg-muted">{IC_VOTE_LABELS[v]}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Per-member vote (ic_review only). */}
              {selected.statusId === "ic_review" && canVote && (
                <div>
                  <div className="u-label mb-2">Your vote{votes?.myVote ? ` · ${IC_VOTE_LABELS[votes.myVote]}` : ""}</div>
                  <div className="flex flex-wrap gap-2">
                    {VOTE_OPTIONS.map((v) => (
                      <Button
                        key={v}
                        size="sm"
                        variant={votes?.myVote === v ? "primary" : "secondary"}
                        disabled={busy}
                        onClick={() => vote(v)}
                      >
                        {IC_VOTE_LABELS[v]}
                      </Button>
                    ))}
                  </div>
                  <textarea
                    className="sj-input mt-2 min-h-[3rem] text-sm"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Add a rationale (optional) — attached to your vote…"
                  />
                </div>
              )}

              {/* Cast votes, most recent first. */}
              {votes && votes.votes.length > 0 && (
                <div>
                  <div className="u-label mb-2">Ballots</div>
                  <ul className="flex flex-col divide-y divide-line">
                    {votes.votes.map((b) => (
                      <li key={b.id} className="flex items-start justify-between gap-2 py-2">
                        <div className="min-w-0">
                          <div className="text-sm text-fg">{b.memberName}</div>
                          {b.comment && <div className="mt-0.5 text-xs text-fg-muted">{b.comment}</div>}
                        </div>
                        <Badge tone={VOTE_TONE[b.vote]}>{IC_VOTE_LABELS[b.vote]}</Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Stage transitions: close IC vote (MP), then the final decision. */}
              {(selected.actions ?? []).length > 0 && (
                <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3">
                  {(selected.actions ?? []).map((a) => (
                    <Button
                      key={a.action}
                      size="sm"
                      variant={a.to === "archived" || a.to === "partner_review" ? "secondary" : "primary"}
                      disabled={busy}
                      onClick={() => runAction(a)}
                    >
                      {a.label}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
