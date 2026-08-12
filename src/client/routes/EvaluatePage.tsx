import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, Button, ScoreChip, EmptyState } from "../components";
import { EvalScorecard, type AiParamScore } from "../components/EvalScorecard";
import { useAuth } from "../auth/useAuth";
import type { DeckView } from "../types";
import {
  listDecks,
  listParameters,
  getDeck,
  getMyScores,
  submitJuryScores,
  transitionDeck,
  type RubricParameter,
  type HumanScoreInput,
} from "../api";

/**
 * Evaluate screen (Evaluation → Evaluate). A jury member picks an assigned deck
 * and works it in the evaluator workbench: in-app deck viewer, per-parameter AI
 * breakdown, AI · My · Average columns (Average updates live), a Research button
 * to their own AI, deck X-of-N progress, and the AI rescore guard. Submitting on
 * an Assigned deck advances it into Jury Evaluation server-side; then Shortlist
 * or Reject.
 */
export function EvaluatePage() {
  const { user } = useAuth();
  const [decks, setDecks] = useState<DeckView[] | null>(null);
  const [params, setParams] = useState<RubricParameter[]>([]);
  const [selected, setSelected] = useState<DeckView | null>(null);
  const [values, setValues] = useState<Record<string, number>>({});
  const [aiScores, setAiScores] = useState<Map<string, AiParamScore>>(new Map());
  const [aiTotal, setAiTotal] = useState<number | undefined>(undefined);
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

  // Core areas form the weighted composite; the caller's own role-scoped
  // additional params are scored separately (assistive, own average).
  const coreParams = useMemo(() => params.filter((p) => !p.informational), [params]);
  const ownedAdditional = useMemo(
    () => params.filter((p) => p.informational && p.roleScope === user?.role),
    [params, user],
  );
  const allScored = useMemo(() => [...coreParams, ...ownedAdditional], [coreParams, ownedAdditional]);

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

  /** Load the AI breakdown + this juror's saved scores for a deck. */
  const loadDeckData = useCallback((deck: DeckView) => {
    getDeck(deck.id)
      .then((r) => {
        setAiScores(
          new Map(r.scores.filter((s) => s.key).map((s) => [s.key as string, { value: s.value, comment: s.comment }])),
        );
        setAiTotal(r.weightedTotal);
      })
      .catch(() => {
        setAiScores(new Map());
        setAiTotal(undefined);
      });
    getMyScores(deck.id)
      .then((r) => {
        if (r.scores.length > 0) {
          setValues((v) => ({ ...v, ...Object.fromEntries(r.scores.map((s) => [s.key, s.value])) }));
        }
      })
      .catch(() => {});
  }, []);

  function selectDeck(deck: DeckView) {
    setSelected(deck);
    setValues(Object.fromEntries(allScored.map((p) => [p.key, 5])));
    setAiScores(new Map());
    setAiTotal(undefined);
    setRemarks("");
    setSaved(false);
    setError(null);
    loadDeckData(deck);
  }

  const selectedIndex = selected ? rows.findIndex((d) => d.id === selected.id) : -1;

  async function submit() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const scores: HumanScoreInput[] = allScored.map((p) => ({ key: p.key, value: values[p.key] ?? 0 }));
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
        const scores: HumanScoreInput[] = allScored.map((p) => ({ key: p.key, value: values[p.key] ?? 0 }));
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
        <Card flush className="w-full shrink-0 overflow-hidden lg:w-64">
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
              description="Pick a deck from the list to open the evaluator workbench."
            />
          ) : (
            <EvalScorecard
              deck={selected}
              params={coreParams}
              additionalParams={ownedAdditional}
              values={values}
              onChangeValue={(key, value) => setValues((v) => ({ ...v, [key]: value }))}
              remarks={remarks}
              onChangeRemarks={setRemarks}
              aiScores={aiScores}
              aiTotal={aiTotal}
              nav={
                selectedIndex >= 0
                  ? {
                      index: selectedIndex,
                      total: rows.length,
                      onPrev: () => selectDeck(rows[(selectedIndex - 1 + rows.length) % rows.length]),
                      onNext: () => selectDeck(rows[(selectedIndex + 1) % rows.length]),
                    }
                  : undefined
              }
              onRescored={() => loadDeckData(selected)}
              busy={busy}
              saved={saved}
              onSave={submit}
              actions={
                <>
                  <Button variant="secondary" disabled={busy} onClick={() => decide("reject")}>
                    Reject
                  </Button>
                  <Button variant="primary" disabled={busy} onClick={() => decide("shortlist")}>
                    Shortlist
                  </Button>
                </>
              }
            />
          )}
        </Card>
      </div>
    </div>
  );
}
