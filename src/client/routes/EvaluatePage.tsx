import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, Button, Badge, ScoreChip, SignalTag, EmptyState } from "../components";
import { useAuth } from "../auth/useAuth";
import type { DeckView } from "../types";
import {
  listDecks,
  listParameters,
  submitJuryScores,
  transitionDeck,
  type RubricParameter,
  type HumanScoreInput,
} from "../api";
import { weightedTotal } from "../../shared/scoring";

/**
 * Evaluate screen (Evaluation → Evaluate). A jury member picks an assigned deck,
 * scores each rubric parameter 0–10 (mirrors the AI path — same weighted total),
 * submits, then Shortlists or Rejects. Submitting on an Assigned deck advances it
 * into Jury Evaluation server-side.
 */
export function EvaluatePage() {
  const { user } = useAuth();
  const [decks, setDecks] = useState<DeckView[] | null>(null);
  const [params, setParams] = useState<RubricParameter[]>([]);
  const [selected, setSelected] = useState<DeckView | null>(null);
  const [values, setValues] = useState<Record<string, number>>({});
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(() => {
    return listDecks()
      .then((r) => setDecks(r.decks))
      .catch(() => setDecks([]));
  }, []);

  useEffect(() => {
    load();
    listParameters().then((r) => setParams(r.parameters)).catch(() => setParams([]));
  }, [load]);

  const rows = useMemo(
    () =>
      (decks ?? []).filter((d) => {
        const inStage = d.statusId === "assigned" || d.statusId === "jury_evaluation";
        // A jury member only scores decks assigned to them (server enforces this
        // too); staff (PM/admin) may score any in-stage deck.
        return inStage && (user?.role !== "jury" || d.assignedTo === user.id);
      }),
    [decks, user],
  );

  function selectDeck(deck: DeckView) {
    setSelected(deck);
    setValues(Object.fromEntries(params.map((p) => [p.key, 5])));
    setRemarks("");
    setSaved(false);
    setError(null);
  }

  const total = useMemo(
    () => weightedTotal(params.map((p) => ({ weight: p.weight, value: values[p.key] ?? 0 }))),
    [params, values],
  );

  async function submit() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const scores: HumanScoreInput[] = params.map((p) => ({ key: p.key, value: values[p.key] ?? 0 }));
      await submitJuryScores(selected.id, scores, remarks || undefined);
      setSaved(true);
      await load();
    } catch {
      setError("Couldn't save scores. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function decide(action: "shortlist" | "reject") {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      // Ensure the deck is in jury_evaluation (records scores + advances) first.
      if (selected.statusId === "assigned") {
        const scores: HumanScoreInput[] = params.map((p) => ({ key: p.key, value: values[p.key] ?? 0 }));
        await submitJuryScores(selected.id, scores, remarks || undefined);
      }
      await transitionDeck(selected.id, action);
      setSelected(null);
      await load();
    } catch {
      setError(`Couldn't ${action}. Make sure scores are submitted.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 p-5">
      <div>
        <h1 className="text-xl font-semibold text-fg">Evaluate</h1>
        <p className="mt-0.5 text-sm text-fg-muted">
          Score each rubric parameter, then Shortlist or Reject. Your scores feed AI-vs-jury drift analytics.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-signal-flagged/40 bg-signal-flagged/10 px-4 py-2.5 text-sm text-signal-flagged">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-5 lg:flex-row">
        <Card flush className="w-full shrink-0 overflow-hidden lg:w-72">
          <div className="u-label border-b border-line px-4 py-3">To evaluate · {rows.length}</div>
          {decks !== null && rows.length === 0 ? (
            <div className="p-4">
              <EmptyState icon="ClipboardCheck" title="Nothing to evaluate" description="Assigned decks appear here." />
            </div>
          ) : (
            <ul className="max-h-[28rem] overflow-y-auto">
              {rows.map((deck) => (
                <li key={deck.id}>
                  <button
                    type="button"
                    onClick={() => selectDeck(deck)}
                    className={`flex w-full items-center justify-between gap-2 border-b border-line px-4 py-3 text-left transition-colors hover:bg-surface-2 ${selected?.id === deck.id ? "bg-accent/5" : ""}`}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-fg">{deck.name}</div>
                      <div className="truncate text-xs text-fg-muted">
                        {[deck.sector, deck.stage].filter(Boolean).join(" · ")}
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
              icon="ClipboardCheck"
              title="Select a deck to score"
              description="Pick a deck from the list to open the rubric scoring form."
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
                  </div>
                </div>
                <div className="text-right">
                  <div className="u-label">Your weighted total</div>
                  <div className="font-mono text-2xl font-bold text-accent">{total.toFixed(2)}</div>
                </div>
              </div>

              <div className="flex flex-col divide-y divide-line">
                {params.map((p) => (
                  <div key={p.key} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-fg">{p.name}</div>
                      <div className="text-xs text-fg-muted">Weight {p.weight}</div>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={10}
                      step={1}
                      value={values[p.key] ?? 5}
                      onChange={(e) => setValues((v) => ({ ...v, [p.key]: Number(e.target.value) }))}
                      className="w-32 accent-[var(--color-accent)]"
                      aria-label={p.name}
                    />
                    <span className="w-8 text-right font-mono text-sm font-medium text-fg">
                      {values[p.key] ?? 5}
                    </span>
                  </div>
                ))}
              </div>

              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-fg-muted">Remarks (optional)</span>
                <textarea
                  className="sj-input min-h-[4rem]"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Notes for the panel…"
                />
              </label>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Button variant="secondary" disabled={busy} onClick={submit}>
                    {busy ? "Saving…" : "Save scores"}
                  </Button>
                  {saved && <Badge tone="positive">Saved</Badge>}
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" disabled={busy} onClick={() => decide("reject")}>Reject</Button>
                  <Button variant="primary" disabled={busy} onClick={() => decide("shortlist")}>Shortlist</Button>
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
