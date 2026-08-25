import { useCallback, useEffect, useMemo, useState } from "react";
import { X, Sparkles, FileBarChart } from "lucide-react";
import { Card, Button, Badge, ScoreChip, EmptyState, EvaluationReportModal } from "../components";
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
  ApiError,
  type RubricParameter,
  type RubricAnchor,
  type HumanScoreInput,
} from "../api";

/**
 * Evaluate screen (Evaluation → Evaluate).
 *
 * Aug-2026 issue 19 — three panels: (1) the startups with their overview
 * details, (2) the evaluation parameters, (3) the detail of whichever parameter
 * is clicked in panel 2. Scoring itself opens the evaluator workbench from
 * panel 1 (in-app deck viewer, per-parameter AI breakdown, AI · My · Average,
 * Research, deck X-of-N and the rescore guard — all Session 1), and the
 * consolidated report (issue 20/21) opens from the Report button.
 */
export function EvaluatePage() {
  const { user } = useAuth();
  const [decks, setDecks] = useState<DeckView[] | null>(null);
  const [params, setParams] = useState<RubricParameter[]>([]);
  const [anchors, setAnchors] = useState<RubricAnchor[]>([]);
  const [selected, setSelected] = useState<DeckView | null>(null);
  const [activeParam, setActiveParam] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, number>>({});
  const [aiScores, setAiScores] = useState<Map<string, AiParamScore>>(new Map());
  const [aiTotal, setAiTotal] = useState<number | undefined>(undefined);
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  /** The deck open in the scoring workbench overlay. */
  const [scoring, setScoring] = useState<DeckView | null>(null);
  /** The deck whose consolidated report modal is open. */
  const [reportFor, setReportFor] = useState<DeckView | null>(null);

  const load = useCallback(() => {
    return listDecks()
      .then((r) => setDecks(r.decks))
      .catch(() => setDecks([]));
  }, []);

  useEffect(() => {
    load();
    listParameters()
      .then((r) => {
        setParams(r.parameters);
        setAnchors(r.anchors ?? []);
      })
      .catch(() => setParams([]));
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

  const selectedIndex = scoring ? rows.findIndex((d) => d.id === scoring.id) : -1;

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
      setScoring(null);
      await load();
    } catch (err) {
      // The per-program shortlist floor refuses with a message written for the
      // evaluator ("below the program's shortlist minimum…") — show it verbatim.
      if (err instanceof ApiError && err.code === "below_shortlist_minimum") {
        setError(err.message);
        await load();
      } else {
        setError(`Couldn't ${action}. Make sure scores are submitted.`);
      }
    } finally {
      setBusy(false);
    }
  }

  const activeParamDef = params.find((p) => p.key === activeParam) ?? null;

  return (
    <div className="flex h-full flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-fg">Evaluate</h1>
          <p className="mt-0.5 text-sm text-fg-muted">
            Pick a startup, review the evaluation parameters, then score it in the workbench.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-signal-flagged/40 bg-signal-flagged/10 px-4 py-2.5 text-sm text-signal-flagged">
          {error}
        </div>
      )}

      {/* Issue 19 — three panels. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[19rem_20rem_1fr]">
        {/* PANEL 1 — startups with overview details */}
        <Card flush className="flex min-h-0 flex-col overflow-hidden">
          <div className="u-label border-b border-line px-4 py-3">
            Startups · {rows.length}
          </div>
          {decks !== null && rows.length === 0 ? (
            <div className="p-4">
              <EmptyState icon="ClipboardCheck" title="Nothing to evaluate" description="Assigned decks appear here." />
            </div>
          ) : (
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {rows.map((deck) => (
                <li key={deck.id}>
                  <div
                    className={`border-b border-line px-4 py-3 transition-colors ${
                      selected?.id === deck.id ? "bg-accent/5" : ""
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => selectDeck(deck)}
                      className="flex w-full items-start justify-between gap-2 text-left"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-fg">{deck.name}</div>
                        <div className="truncate text-xs text-fg-muted">
                          {[deck.sector, deck.stage, deck.city].filter(Boolean).join(" · ")}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <ScoreChip value={deck.aiScore} />
                          {deck.missingFields && deck.missingFields.length > 0 && (
                            <Badge tone="danger">{deck.missingFields.length} flags</Badge>
                          )}
                          {deck.status && <Badge tone="neutral">{deck.status}</Badge>}
                        </div>
                      </div>
                    </button>
                    <div className="mt-2 flex gap-1.5">
                      <Button size="sm" variant="primary" onClick={() => { selectDeck(deck); setScoring(deck); }}>
                        Score
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setReportFor(deck)}>
                        <FileBarChart className="mr-1 h-3.5 w-3.5" /> Report
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* PANEL 2 — evaluation parameters */}
        <Card flush className="flex min-h-0 flex-col overflow-hidden">
          <div className="border-b border-line px-4 py-3">
            <div className="u-label">Evaluation parameters</div>
            <p className="text-xs text-fg-muted">Click Review to see the full prompt</p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {ownedAdditional.length > 0 && (
              <>
                <div className="flex items-center gap-1.5 bg-surface-2 px-4 py-1.5 text-[11px] font-medium text-fg-muted">
                  My additional parameters
                </div>
                {ownedAdditional.map((p, i) => (
                  <ParamRow
                    key={p.key}
                    badge={`C${i + 1}`}
                    param={p}
                    active={activeParam === p.key}
                    onSelect={() => setActiveParam(p.key)}
                  />
                ))}
              </>
            )}
            <div className="flex items-center gap-1.5 bg-surface-2 px-4 py-1.5 text-[11px] font-medium text-fg-muted">
              Core evaluation parameters
            </div>
            {coreParams.map((p, i) => (
              <ParamRow
                key={p.key}
                badge={String(i + 1)}
                param={p}
                active={activeParam === p.key}
                onSelect={() => setActiveParam(p.key)}
              />
            ))}
          </div>
        </Card>

        {/* PANEL 3 — the clicked parameter */}
        <Card className="min-h-0 overflow-y-auto">
          {!activeParamDef ? (
            <EmptyState
              icon="SlidersHorizontal"
              title="Pick a parameter"
              description="Click Review on any parameter to see its evaluation prompt, rubric anchors and weight — plus how the AI scored the selected startup on it."
            />
          ) : (
            <ParamDetail
              param={activeParamDef}
              anchors={anchors}
              deck={selected}
              ai={aiScores.get(activeParamDef.key)}
            />
          )}
        </Card>
      </div>

      {/* Scoring workbench — the full Session-1 evaluator surface. */}
      {scoring && selected && scoring.id === selected.id && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4">
          <div className="absolute inset-0 bg-navy/50" onClick={() => setScoring(null)} aria-hidden="true" />
          <div
            className="relative my-4 w-full max-w-4xl rounded-xl border border-line bg-surface p-5 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-label={`Score ${selected.name}`}
          >
            <button
              type="button"
              onClick={() => setScoring(null)}
              aria-label="Close"
              className="absolute right-3 top-3 rounded-lg p-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
            >
              <X className="h-5 w-5" />
            </button>
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
                      onPrev: () => {
                        const next = rows[(selectedIndex - 1 + rows.length) % rows.length];
                        selectDeck(next);
                        setScoring(next);
                      },
                      onNext: () => {
                        const next = rows[(selectedIndex + 1) % rows.length];
                        selectDeck(next);
                        setScoring(next);
                      },
                    }
                  : undefined
              }
              onRescored={() => loadDeckData(selected)}
              busy={busy}
              saved={saved}
              onSave={submit}
              actions={
                <>
                  {selected.shortlistMin !== undefined && (
                    <span
                      className={`self-center text-xs ${selected.shortlistBlocked ? "text-signal-flagged" : "text-fg-muted"}`}
                    >
                      Shortlist minimum {selected.shortlistMin.toFixed(1)}
                      {selected.decisionScore !== undefined
                        ? ` · this deck ${selected.decisionScore.toFixed(2)}`
                        : " · not scored yet"}
                    </span>
                  )}
                  <Button variant="secondary" disabled={busy} onClick={() => decide("reject")}>
                    Reject
                  </Button>
                  <Button variant="primary" disabled={busy} onClick={() => decide("shortlist")}>
                    Shortlist
                  </Button>
                </>
              }
            />
          </div>
        </div>
      )}

      {reportFor && (
        <EvaluationReportModal
          deckId={reportFor.id}
          deckName={reportFor.name}
          onClose={() => setReportFor(null)}
        />
      )}
    </div>
  );
}

function ParamRow({
  param,
  badge,
  active,
  onSelect,
}: {
  param: RubricParameter;
  badge: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-2.5 border-b border-line px-4 py-2.5 text-left transition-colors hover:bg-surface-2 ${
        active ? "bg-accent/5" : ""
      }`}
    >
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold ${
          param.informational ? "bg-info/15 text-info" : "bg-surface-2 text-fg-muted"
        }`}
        style={param.informational ? { background: "color-mix(in srgb, var(--color-info) 15%, transparent)", color: "var(--color-info)" } : undefined}
      >
        {badge}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-fg">{param.name}</span>
      {!param.informational && (
        <span className="shrink-0 font-mono text-[11px] text-fg-muted">{param.weight}%</span>
      )}
      <span className="shrink-0 rounded-md border border-line px-2 py-0.5 text-[11px] text-fg-muted">
        Review
      </span>
    </button>
  );
}

function ParamDetail({
  param,
  anchors,
  deck,
  ai,
}: {
  param: RubricParameter;
  anchors: RubricAnchor[];
  deck: DeckView | null;
  ai?: AiParamScore;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 border-b border-line pb-3">
        <h2 className="text-lg font-semibold text-fg">{param.name}</h2>
        {param.informational ? (
          <Badge tone="info">Additional · not weighted</Badge>
        ) : (
          <Badge tone="neutral">Weight {param.weight}%</Badge>
        )}
      </div>

      <section>
        <h3 className="u-label mb-1.5">Evaluation prompt</h3>
        <p className="rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-sm text-fg">
          {param.prompt ?? `Score ${param.name} from 0 to 10 against the rubric anchors below.`}
        </p>
      </section>

      {anchors.length > 0 && (
        <section>
          <h3 className="u-label mb-1.5">Rubric anchors</h3>
          <ul className="flex flex-col gap-1.5">
            {anchors.map((a) => (
              <li key={a.band} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2">
                <span className="w-16 shrink-0 font-mono text-xs text-fg-muted">
                  {a.min}–{a.max}
                </span>
                <span className="text-sm text-fg">{a.label}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="u-label mb-1.5">
          {deck ? `How the AI scored ${deck.name}` : "AI score"}
        </h3>
        {!deck ? (
          <p className="text-sm text-fg-muted">Select a startup in the first panel.</p>
        ) : ai ? (
          <div className="rounded-lg border border-line px-3 py-2.5">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-accent" />
              <span className="font-mono text-xl font-semibold text-fg">
                {Number.isInteger(ai.value) ? ai.value : ai.value.toFixed(1)}
                <span className="text-sm font-normal text-fg-muted">/10</span>
              </span>
            </div>
            {ai.comment && <p className="mt-1.5 text-sm italic text-fg-muted">{ai.comment}</p>}
          </div>
        ) : (
          <p className="text-sm text-fg-muted">
            No AI score for this parameter yet — the deck may still be pending evaluation.
          </p>
        )}
      </section>
    </div>
  );
}
