import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, Button, ScoreChip, EmptyState } from "../components";
import { EvalScorecard, type AiParamScore } from "../components/EvalScorecard";
import type { DeckView, DeckAction } from "../types";
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

// Human-scoring stages on the VC side: analyst core scores, then associate and
// partner core + additional review before their shortlist decisions.
const SCORING_STAGES = ["analyst_scoring", "associate_review", "partner_review"];

/**
 * VC Evaluate / Submit screen. An analyst, associate or partner works a deal in
 * the evaluator workbench (in-app deck viewer, per-parameter AI breakdown,
 * AI · My · Average, Research, deck X-of-N, rescore guard), scores each rubric
 * parameter 0–10 (mirrors the AI path), saves, then advances the deal with its
 * stage's role-gated actions.
 */
export function VcEvaluatePage() {
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

  const rows = useMemo(
    () => (decks ?? []).filter((d) => d.statusId && SCORING_STAGES.includes(d.statusId)),
    [decks],
  );

  /** Load the AI breakdown + this evaluator's saved scores for a deal. */
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
    // Default every slider to 5, then overlay any scores this evaluator already
    // saved so reopening shows real values (not defaults).
    setValues(Object.fromEntries(params.map((p) => [p.key, 5])));
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

  async function advance(action: DeckAction) {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await transitionDeck(selected.id, action.action);
      setSelected(null);
      await load();
    } catch {
      setError(`Couldn't ${action.label.toLowerCase()}. Try again.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 p-5">
      <div>
        <h1 className="text-xl font-semibold text-fg">Evaluate</h1>
        <p className="mt-0.5 text-sm text-fg-muted">
          Score each rubric parameter, then submit or shortlist the deal. Your scores feed AI-vs-human drift analytics.
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
              <EmptyState icon="ClipboardCheck" title="Nothing to evaluate" description="Deals to score appear here." />
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
              title="Select a deal to score"
              description="Pick a deal from the list to open the evaluator workbench."
            />
          ) : (
            <EvalScorecard
              deck={selected}
              params={params}
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
              actions={(selected.actions ?? []).map((a) => (
                <Button
                  key={a.action}
                  variant={a.to === "archived" ? "secondary" : "primary"}
                  disabled={busy}
                  onClick={() => advance(a)}
                >
                  {a.label}
                </Button>
              ))}
            />
          )}
        </Card>
      </div>
    </div>
  );
}
