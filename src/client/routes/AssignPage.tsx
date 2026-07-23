import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, Button, Badge, ScoreChip, SignalTag, EmptyState } from "../components";
import type { DeckView } from "../types";
import { listDecks, listJury, assignDeck, type JuryMember } from "../api";

/**
 * Assign screen (Evaluation → Assign). Program associates pick a jury member for
 * each AI-gated deck; assigning advances the deck ai_evaluated → Assigned.
 * Already-assigned decks stay listed with their assignee for reassignment.
 */
export function AssignPage() {
  const [decks, setDecks] = useState<DeckView[] | null>(null);
  const [jury, setJury] = useState<JuryMember[]>([]);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    return listDecks()
      .then((r) => setDecks(r.decks))
      .catch(() => setDecks([]));
  }, []);

  useEffect(() => {
    load();
    listJury().then((r) => setJury(r.jury)).catch(() => setJury([]));
  }, [load]);

  const rows = useMemo(
    () => (decks ?? []).filter((d) => d.statusId === "ai_evaluated" || d.statusId === "assigned"),
    [decks],
  );

  async function assign(deck: DeckView) {
    const assigneeId = pick[deck.id] ?? jury[0]?.id;
    if (!assigneeId) return setError("No jury members available to assign.");
    setBusy(deck.id);
    setError(null);
    try {
      await assignDeck(deck.id, assigneeId);
      await load();
    } catch {
      setError("Assignment failed. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-5 p-5">
      <div>
        <h1 className="text-xl font-semibold text-fg">Assign</h1>
        <p className="mt-0.5 text-sm text-fg-muted">
          Allocate AI-gated decks to a jury member for evaluation.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-signal-flagged/40 bg-signal-flagged/10 px-4 py-2.5 text-sm text-signal-flagged">
          {error}
        </div>
      )}

      <Card flush className="overflow-x-auto">
        {decks !== null && rows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon="UserPlus"
              title="Nothing to assign"
              description="Decks that pass the AI gate appear here to allocate to a jury member."
            />
          </div>
        ) : (
          <table className="w-full min-w-[44rem] text-left">
            <thead>
              <tr className="text-fg-muted">
                <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Startup</th>
                <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">AI score</th>
                <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Signal</th>
                <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Jury member</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium uppercase tracking-wide">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((deck) => (
                <tr key={deck.id} className="border-t border-line">
                  <td className="px-4 py-3">
                    <div className="font-medium text-fg">{deck.name}</div>
                    <div className="mt-0.5 text-xs text-fg-muted">
                      {[deck.sector, deck.stage, deck.city].filter(Boolean).join(" · ")}
                    </div>
                  </td>
                  <td className="px-4 py-3"><ScoreChip value={deck.aiScore} /></td>
                  <td className="px-4 py-3">{deck.signal ? <SignalTag signal={deck.signal} /> : null}</td>
                  <td className="px-4 py-3">
                    {deck.statusId === "assigned" && deck.assignedToName ? (
                      <Badge tone="positive">{deck.assignedToName}</Badge>
                    ) : (
                      <select
                        className="sj-input h-8 py-0 text-sm"
                        value={pick[deck.id] ?? ""}
                        onChange={(e) => setPick((p) => ({ ...p, [deck.id]: e.target.value }))}
                      >
                        <option value="">Choose jury…</option>
                        {jury.map((j) => (
                          <option key={j.id} value={j.id}>{j.name}</option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end">
                      {deck.statusId === "assigned" ? (
                        <span className="text-xs text-fg-muted">Assigned</span>
                      ) : (
                        <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => assign(deck)}>
                          {busy === deck.id ? "…" : "Assign"}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
