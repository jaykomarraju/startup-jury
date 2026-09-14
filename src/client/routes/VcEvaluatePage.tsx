import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ClipboardCheck, Download, Filter, Hand, Leaf, ListChecks, Settings, UserCheck, X } from "lucide-react";
import { Card, Button, ScoreChip, EmptyState, EvaluationReportModal, PanelFrame, ToolbarButton } from "../components";
import { EvalScorecard, type AiParamScore } from "../components/EvalScorecard";
import { useToast } from "../components/Toast";
import { useAuth } from "../auth/useAuth";
import { usePermissions } from "../auth/usePermissions";
import type { DeckView, DeckAction } from "../types";
import {
  listDecks,
  listParameters,
  listIcVotes,
  castIcVote,
  getDeck,
  getMyScores,
  submitJuryScores,
  transitionDeck,
  ApiError,
  IC_VOTE_LABELS,
  type IcVoteValue,
  type RubricParameter,
  type RubricAnchor,
  type HumanScoreInput,
} from "../api";
import { DEFAULT_SCORING_SETTINGS, formatScore, toDisplayScale, type ScoringSettings } from "../../shared/scoring";
import { canAccessNav } from "../../shared/nav";
import { exportDecks } from "../exportCsv";
import { scoringSettings } from "./admin/scoringApi";
import { CoreDetail, ParamRow } from "./EvaluatePage";

/**
 * The VC stages a deal is scored in — analyst core scores, then associate and
 * partner review. `POST /decks/:id/evaluate` refuses every other stage.
 */
export const VC_SCORING_STAGES = ["analyst_scoring", "associate_review", "partner_review"];

/** Submit's prototype copy (`AISJ_VC_Superuser_V8` panel-assign `.as-tb-title` / `.as-tb-sub`). */
export const SUBMIT_SUBTITLE = "Select evaluated decks · choose role · pick one or more jury members · confirm";

/**
 * VC Evaluate (`evaluate`) and VC Submit (`assign`) — `App.tsx` routes both
 * slugs here, so the page reads which one it is from the route.
 *
 *  • **Evaluate**, for the Super User, Admin, Partner, Associate and Analyst —
 *    `AISJ_VC_Superuser_V8` panel-evaluate (md5-identical in those five builds):
 *    a deck checklist, the 13 evaluation parameters, the parameter detail, and
 *    the "Evaluate selected decks" bar (F0435 / F0436 / F0451 / F0452).
 *  • **Evaluate**, for the IC member — `AISJ_VC_IC_member_V2` panel-evaluate:
 *    the deals at IC, each with its committee ballot alongside, and the
 *    member's own three parameters above the core list (F0441).
 *  • **Submit** — the scoring workbench over the deals being scored. `W9-B`
 *    owns the Submit screen's parity (§9); this page gives it its own title.
 */
export function VcEvaluatePage() {
  const { navId } = useParams();
  const { user } = useAuth();
  if (navId === "assign") return <SubmitScreen />;
  if (user?.role === "ic_member") return <IcEvaluateScreen />;
  return <EvaluateScreen />;
}

// ═══════════════════════════════════════════════════════════════════════════
// Shared loading
// ═══════════════════════════════════════════════════════════════════════════

/** The decks, the rubric and the org's scoring framework every VC view needs. */
function useEvaluateData() {
  const { user } = useAuth();
  const [decks, setDecks] = useState<DeckView[] | null>(null);
  const [params, setParams] = useState<RubricParameter[]>([]);
  const [anchors, setAnchors] = useState<RubricAnchor[]>([]);
  const [scoringCfg, setScoringCfg] = useState<ScoringSettings>(DEFAULT_SCORING_SETTINGS);

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
    scoringSettings()
      .then(setScoringCfg)
      .catch(() => setScoringCfg(DEFAULT_SCORING_SETTINGS));
  }, [load]);

  // Core areas form the weighted composite; the caller's own role-scoped
  // additional params (associate / partner / IC member) score separately.
  const coreParams = useMemo(() => params.filter((p) => !p.informational), [params]);
  const ownedAdditional = useMemo(
    () => params.filter((p) => p.informational && p.roleScope === user?.role),
    [params, user],
  );
  return { decks, load, coreParams, ownedAdditional, anchors, scoringCfg };
}

// ═══════════════════════════════════════════════════════════════════════════
// The scoring workbench (one deck)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * One deal in the evaluator workbench. Mounted with `key={deck.id}`, so every
 * deal starts from nothing: no parameter is pre-scored — an untouched one reads
 * "–" and submit stays locked until all are scored (F0454; the shared
 * scorecard owns the gate) — and a saved-score response that lands after the
 * evaluator's first keystroke never overwrites it.
 */
function VcWorkbench({
  deck,
  queue,
  coreParams,
  ownedAdditional,
  scoringCfg,
  onOpen,
  onChanged,
  onAdvanced,
}: {
  deck: DeckView;
  queue: DeckView[];
  coreParams: RubricParameter[];
  ownedAdditional: RubricParameter[];
  scoringCfg: ScoringSettings;
  onOpen: (deck: DeckView) => void;
  onChanged: () => Promise<unknown>;
  onAdvanced: () => void;
}) {
  const [values, setValues] = useState<Record<string, number>>({});
  const [aiScores, setAiScores] = useState<Map<string, AiParamScore>>(new Map());
  const [aiTotal, setAiTotal] = useState<number | undefined>(undefined);
  const [aiWithheld, setAiWithheld] = useState(false);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const loadToken = useRef(0);

  const allScored = useMemo(() => [...coreParams, ...ownedAdditional], [coreParams, ownedAdditional]);

  const loadDeckData = useCallback(() => {
    const token = ++loadToken.current;
    const current = () => token === loadToken.current;
    getDeck(deck.id)
      .then((r) => {
        if (!current()) return;
        setAiScores(
          new Map(r.scores.filter((s) => s.key).map((s) => [s.key as string, { value: s.value, comment: s.comment }])),
        );
        setAiTotal(r.weightedTotal);
        setAiWithheld(r.aiScoreWithheld === true);
      })
      .catch(() => {
        if (!current()) return;
        setAiScores(new Map());
        setAiTotal(undefined);
      });
    getMyScores(deck.id)
      .then((r) => {
        if (!current() || r.scores.length === 0) return;
        // What the evaluator has already typed wins over what was saved.
        setValues((v) => ({ ...Object.fromEntries(r.scores.map((s) => [s.key, s.value])), ...v }));
        setComments((cs) => ({
          ...Object.fromEntries(r.scores.filter((s) => s.comment).map((s) => [s.key, s.comment!])),
          ...cs,
        }));
      })
      .catch(() => {});
  }, [deck.id]);

  useEffect(() => {
    loadDeckData();
    return () => {
      loadToken.current++;
    };
  }, [loadDeckData]);

  const index = queue.findIndex((d) => d.id === deck.id);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      // Values travel on the org's score scale; each carries its remark so the
      // override-rationale rule can be enforced server-side.
      const scores: HumanScoreInput[] = allScored.map((p) => ({
        key: p.key,
        value: toDisplayScale(values[p.key] ?? 0, scoringCfg.scoreScale),
        comment: comments[p.key]?.trim() || undefined,
      }));
      await submitJuryScores(deck.id, scores, remarks || undefined);
      setSaved(true);
      await onChanged();
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "rationale_required"
          ? err.message
          : "Couldn't save scores. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function advance(action: DeckAction) {
    setBusy(true);
    setError(null);
    try {
      await transitionDeck(deck.id, action.action);
      onAdvanced();
      await onChanged();
    } catch {
      setError(`Couldn't ${action.label.toLowerCase()}. Try again.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error && (
        <div className="mb-3 rounded-lg border border-signal-flagged/40 bg-signal-flagged/10 px-4 py-2.5 text-sm text-signal-flagged">
          {error}
        </div>
      )}
      <EvalScorecard
        deck={deck}
        params={coreParams}
        additionalParams={ownedAdditional}
        values={values}
        onChangeValue={(key, value) => setValues((v) => ({ ...v, [key]: value }))}
        remarks={remarks}
        onChangeRemarks={setRemarks}
        aiScores={aiScores}
        aiTotal={aiTotal}
        scoring={scoringCfg}
        aiWithheld={aiWithheld}
        comments={comments}
        onChangeComment={(key, value) => setComments((cs) => ({ ...cs, [key]: value }))}
        nav={
          index >= 0
            ? {
                index,
                total: queue.length,
                onPrev: () => onOpen(queue[(index - 1 + queue.length) % queue.length]),
                onNext: () => onOpen(queue[(index + 1) % queue.length]),
              }
            : undefined
        }
        onRescored={loadDeckData}
        onOpenReport={() => setReportOpen(true)}
        busy={busy}
        saved={saved}
        onSave={submit}
        actions={(deck.actions ?? []).map((a) => (
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
      {reportOpen && (
        <EvaluationReportModal deckId={deck.id} deckName={deck.name} onClose={() => setReportOpen(false)} />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Submit (`assign`)
// ═══════════════════════════════════════════════════════════════════════════

function SubmitScreen() {
  const { decks, load, coreParams, ownedAdditional, scoringCfg } = useEvaluateData();
  const [selected, setSelected] = useState<DeckView | null>(null);

  const rows = useMemo(
    () => (decks ?? []).filter((d) => d.statusId && VC_SCORING_STAGES.includes(d.statusId)),
    [decks],
  );

  return (
    <div className="flex flex-col gap-5 p-5">
      <div>
        {/* F0594 (W9-B's finding, taken here) — the Submit nav item's own title. */}
        <h1 className="text-xl font-semibold text-fg">Submit</h1>
        <p className="mt-0.5 text-sm text-fg-muted">{SUBMIT_SUBTITLE}</p>
      </div>

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
                    onClick={() => setSelected(deck)}
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
            <VcWorkbench
              key={selected.id}
              deck={selected}
              queue={rows}
              coreParams={coreParams}
              ownedAdditional={ownedAdditional}
              scoringCfg={scoringCfg}
              onOpen={setSelected}
              onChanged={load}
              onAdvanced={() => setSelected(null)}
            />
          )}
        </Card>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Evaluate — Super User, Admin, Partner, Associate, Analyst
// ═══════════════════════════════════════════════════════════════════════════

/** `.ev-chk` — the prototype's square tick box, as an accessible checkbox. */
function TickBox({ checked, label, onToggle }: { checked: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={`flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[4px] border-[1.5px] text-[9px] font-bold ${
        checked ? "border-olive bg-olive text-white" : "border-stone-dk bg-surface text-transparent"
      }`}
    >
      ✓
    </button>
  );
}

function DeckFilter({
  query,
  onQuery,
  flaggedOnly,
  onFlagged,
}: {
  query: string;
  onQuery: (v: string) => void;
  flaggedOnly: boolean;
  onFlagged: (v: boolean) => void;
}) {
  return (
    <div id="ev-filter" className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2">
      <input
        className="sj-input h-8 w-56 text-xs"
        placeholder="Search startup, sector or city"
        aria-label="Search decks"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
      />
      <label className="flex items-center gap-1.5 text-xs text-fg-2">
        <input type="checkbox" checked={flaggedOnly} onChange={(e) => onFlagged(e.target.checked)} />
        Flagged only
      </label>
    </div>
  );
}

function matchesFilter(deck: DeckView, query: string, flaggedOnly: boolean): boolean {
  const q = query.trim().toLowerCase();
  if (q && ![deck.name, deck.sector, deck.city].some((v) => v?.toLowerCase().includes(q))) return false;
  if (flaggedOnly && !(deck.missingFields && deck.missingFields.length > 0)) return false;
  return true;
}

function EvaluateScreen() {
  const { user } = useAuth();
  const can = usePermissions();
  const navigate = useNavigate();
  const { decks, load, coreParams, ownedAdditional, anchors, scoringCfg } = useEvaluateData();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [showFilter, setShowFilter] = useState(false);
  const [query, setQuery] = useState("");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  /** The workbench: the deal open in it, and the queue its Deck X of N walks. */
  const [open, setOpen] = useState<{ deck: DeckView; queue: DeckView[] } | null>(null);
  /** Decks this evaluator has submitted scores for (the "Evaluated" badge). */
  const [evaluated, setEvaluated] = useState<Set<string>>(new Set());

  const pool = useMemo(
    () => (decks ?? []).filter((d) => d.statusId && VC_SCORING_STAGES.includes(d.statusId)),
    [decks],
  );
  const rows = useMemo(() => pool.filter((d) => matchesFilter(d, query, flaggedOnly)), [pool, query, flaggedOnly]);

  // "Evaluated" = this evaluator has saved scores on the deal. One read per
  // deal in the pool (the VC edition has no batched endpoint — §9).
  useEffect(() => {
    let live = true;
    for (const d of pool) {
      getMyScores(d.id)
        .then((r) => {
          if (live && r.scores.length > 0) setEvaluated((s) => new Set(s).add(d.id));
        })
        .catch(() => {});
    }
    return () => {
      live = false;
    };
  }, [pool]);

  const selectedRows = rows.filter((d) => checked.has(d.id));
  const n = selectedRows.length;
  const allChecked = rows.length > 0 && rows.every((d) => checked.has(d.id));

  function toggle(id: string) {
    setChecked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setChecked(allChecked ? new Set() : new Set(rows.map((d) => d.id)));
  }

  function openDeck(deck: DeckView) {
    // A deal opened from the checklist walks the selection it belongs to.
    const queue = checked.has(deck.id) && n > 0 ? selectedRows : rows;
    setOpen({ deck, queue });
  }

  const detailParam = detailKey ? (coreParams.find((p) => p.key === detailKey) ?? null) : null;
  const canConfigureCore = user ? canAccessNav(user.edition, user.role, "coreparams", can) : false;
  return (
    <PanelFrame
      flush
      title="Evaluate"
      subtitle="Select decks · review parameters · click Evaluate to begin"
      actions={
        <>
          <ToolbarButton onClick={() => setShowFilter((v) => !v)} aria-expanded={showFilter} aria-controls="ev-filter">
            <Filter className="h-3 w-3" aria-hidden="true" />
            Filter
          </ToolbarButton>
          <ToolbarButton onClick={() => exportDecks("Evaluate", rows)} disabled={rows.length === 0}>
            <Download className="h-3 w-3" aria-hidden="true" />
            Export
          </ToolbarButton>
        </>
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        {showFilter && (
          <DeckFilter query={query} onQuery={setQuery} flaggedOnly={flaggedOnly} onFlagged={setFlaggedOnly} />
        )}

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
          {/* COLUMN 1 — the deck checklist */}
          <section
            className="flex min-h-0 flex-col border-line bg-surface lg:w-[260px] lg:min-w-[260px] lg:border-r"
            aria-label="Decks"
          >
            <div className="flex items-center gap-2 border-b border-line px-[13px] py-2.5">
              <div className="flex-1 text-[9px] font-semibold uppercase tracking-[0.07em] text-fg-muted" data-testid="ev-decks-label">
                {rows.length} {rows.length === 1 ? "deck" : "decks"}
              </div>
              <label className="flex cursor-pointer items-center gap-[5px] text-[10.5px] text-fg-muted">
                <TickBox checked={allChecked} label="Select all" onToggle={toggleAll} />
                Select all
              </label>
            </div>
            {decks !== null && rows.length === 0 ? (
              <div className="flex flex-1 flex-col items-center gap-2 px-6 py-10 text-center text-fg-muted">
                <ListChecks className="h-9 w-9 opacity-25" aria-hidden="true" />
                <p className="text-xs leading-relaxed">
                  {pool.length === 0
                    ? "Nothing to evaluate yet — deals appear here once the AI has scored them."
                    : "No decks match this filter."}
                </p>
              </div>
            ) : (
              <ul className="min-h-0 flex-1 overflow-y-auto" aria-label="Decks to evaluate">
                {rows.map((deck) => {
                  const flags = deck.missingFields?.length ?? 0;
                  const sel = highlighted === deck.id;
                  return (
                    <li
                      key={deck.id}
                      onClick={() => setHighlighted(deck.id)}
                      className={`flex cursor-pointer items-start gap-[9px] border-b border-l-[3px] border-b-line px-[13px] py-2.5 transition-colors hover:bg-offwhite ${
                        sel ? "border-l-olive bg-olive-lt" : "border-l-transparent"
                      }`}
                    >
                      <TickBox checked={checked.has(deck.id)} label={`Select ${deck.name}`} onToggle={() => toggle(deck.id)} />
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          title="Open evaluation report"
                          onClick={(e) => {
                            e.stopPropagation();
                            openDeck(deck);
                          }}
                          className="mb-0.5 inline-flex max-w-full items-center gap-1 truncate text-left text-xs font-medium text-fg hover:text-olive-dk"
                        >
                          <Leaf className="h-3 w-3 shrink-0 text-olive" aria-hidden="true" />
                          {deck.name}
                        </button>
                        <div className="mb-1 truncate text-[10.5px] text-fg-muted">
                          {[deck.sector, deck.stage, deck.city].filter(Boolean).join(" · ")}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {flags > 0 && (
                            <span className="rounded-full bg-warn-lt px-1.5 py-px text-[9.5px] font-medium text-warn">
                              {flags} {flags === 1 ? "flag" : "flags"}
                            </span>
                          )}
                          {evaluated.has(deck.id) && (
                            <span className="rounded-full bg-green-lt px-1.5 py-px text-[9.5px] font-medium text-green">
                              Evaluated
                            </span>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="flex items-center justify-between border-t border-line bg-olive-lt px-[13px] py-2 text-[11px] font-medium text-olive-dk">
              <span data-testid="ev-sel-label">
                {n} {n === 1 ? "deck" : "decks"} selected
              </span>
              <span className="text-[10px] font-normal text-fg-muted">✓ check to queue</span>
            </div>
          </section>

          {/* COLUMN 2 — the evaluation parameters */}
          <section
            className="flex min-h-0 flex-col border-line bg-surface lg:w-[250px] lg:min-w-[250px] lg:border-r"
            aria-label="Evaluation parameters"
          >
            <div className="border-b border-line px-[13px] py-2.5">
              <div className="text-[9px] font-semibold uppercase tracking-[0.07em] text-fg-muted">
                {coreParams.length} Evaluation parameters
              </div>
              <div className="text-[10px] text-fg-muted">Click Review to see the full prompt</div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto py-1">
              {coreParams.map((p, i) => (
                <ParamRow
                  key={p.key}
                  badge={String(i + 1)}
                  name={p.name}
                  weight={`${p.weight}%`}
                  active={detailKey === p.key}
                  action="Review"
                  onSelect={() => setDetailKey(p.key)}
                />
              ))}
            </div>
          </section>

          {/* COLUMN 3 — the parameter detail */}
          <section className="min-h-0 flex-1 overflow-y-auto bg-offwhite" aria-label="Parameter detail">
            <div className="px-[18px] py-4">
              {detailParam ? (
                <CoreDetail
                  param={detailParam}
                  number={coreParams.indexOf(detailParam) + 1}
                  anchors={anchors}
                  canConfigure={canConfigureCore}
                />
              ) : (
                <div className="flex min-h-[300px] flex-col items-center justify-center gap-2.5 p-10 text-center text-fg-muted">
                  <Hand className="h-9 w-9 opacity-25" aria-hidden="true" />
                  <p className="text-xs leading-relaxed">
                    Click <strong>Review</strong> on any parameter to see its evaluation prompt, scoring rubric, and
                    weight — and configure if needed.
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* The bottom action bar (`.ev-bottom`). */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3.5 border-t-2 border-olive bg-surface px-[18px] py-[11px]">
          <p className="text-xs text-fg-2" data-testid="ev-bottom-summary">
            {n === 0 ? (
              <>
                Select decks from column 1, then click <strong className="text-olive-dk">Evaluate selected decks</strong> to
                begin.
              </>
            ) : (
              <>
                <strong className="text-olive-dk">
                  {n} {n === 1 ? "deck" : "decks"}
                </strong>{" "}
                queued for evaluation across all {coreParams.length} parameters.
              </>
            )}
          </p>
          <div className="flex items-center gap-2">
            <button type="button" className="tbb" onClick={() => navigate("/app/alldecks")}>
              Cancel
            </button>
            <button
              type="button"
              disabled={n === 0}
              onClick={() => n > 0 && setOpen({ deck: selectedRows[0], queue: selectedRows })}
              className="flex items-center gap-[7px] rounded-[7px] bg-olive px-[22px] py-[9px] text-[12.5px] font-semibold text-white hover:bg-olive-dk disabled:pointer-events-none disabled:opacity-40"
            >
              <ClipboardCheck className="h-3.5 w-3.5" aria-hidden="true" /> Evaluate selected decks
            </button>
          </div>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4">
          <div className="absolute inset-0 bg-navy/50" onClick={() => setOpen(null)} aria-hidden="true" />
          <div
            className="relative my-4 w-full max-w-4xl rounded-xl border border-line bg-surface p-5 pt-11 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-label={`Evaluate ${open.deck.name}`}
          >
            <button
              type="button"
              onClick={() => setOpen(null)}
              aria-label="Close"
              className="absolute right-3 top-3 rounded-lg p-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
            >
              <X className="h-5 w-5" />
            </button>
            <VcWorkbench
              key={open.deck.id}
              deck={open.deck}
              queue={open.queue}
              coreParams={coreParams}
              ownedAdditional={ownedAdditional}
              scoringCfg={scoringCfg}
              onOpen={(deck) => setOpen((o) => (o ? { ...o, deck } : o))}
              onChanged={async () => {
                await load();
                setEvaluated((s) => new Set(s).add(open.deck.id));
              }}
              onAdvanced={() => setOpen(null)}
            />
          </div>
        </div>
      )}
    </PanelFrame>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Evaluate — the IC member
// ═══════════════════════════════════════════════════════════════════════════

const VOTE_OPTIONS: IcVoteValue[] = ["invest", "hold", "need_more_info", "pass"];

/** `.icq-rec.go / .hold / .info / .no` — the select takes its ballot's tint. */
function voteTone(v: IcVoteValue | null | undefined): string {
  if (v === "invest") return "bg-green-lt text-green";
  if (v === "hold") return "bg-warn-lt text-warn";
  if (v === "pass") return "bg-red-lt text-red";
  if (v === "need_more_info") return "bg-blue-lt text-blue";
  return "bg-surface-2 text-fg-muted";
}

/** The IC member's own three parameters (`evShowAddl`). */
function IcAdditionalGlance({ params, active, canConfigure }: { params: RubricParameter[]; active: number; canConfigure: boolean }) {
  return (
    <article className="mb-2.5 rounded-[9px] border border-line bg-surface px-4 py-3.5" aria-label="My additional parameters">
      <div className="mb-2.5 flex items-center gap-2.5 border-b border-line pb-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue text-white">
          <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        <h2 className="text-[15px] font-semibold text-fg">My additional parameters</h2>
        <span className="text-[11px] text-fg-muted">IC member</span>
      </div>
      <h3 className="mb-1.5 mt-0.5 text-[9px] font-semibold uppercase tracking-[0.07em] text-fg-muted">
        Your three additional parameters at a glance
      </h3>
      {params.map((p, i) => (
        <div
          key={p.key}
          className={`mb-2 rounded-lg border bg-surface px-3 py-2.5 ${i === active ? "border-blue shadow-[inset_0_0_0_1px_var(--blue)]" : "border-line"}`}
        >
          <div className="flex items-center gap-[7px] text-[12.5px] font-semibold text-fg">
            <span className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-blue-lt text-[9.5px] font-bold text-blue">
              C{i + 1}
            </span>
            {p.name}
          </div>
          <p className="mt-1 text-[11.5px] leading-normal text-fg-2">
            {p.description ?? p.prompt ?? "Your additional evaluation lens for this deal."}
          </p>
        </div>
      ))}
      <h3 className="mb-1.5 mt-2.5 text-[9px] font-semibold uppercase tracking-[0.07em] text-fg-muted">How these are used</h3>
      <p className="mb-3 rounded-[7px] border border-line bg-offwhite px-[13px] py-[11px] text-xs leading-relaxed text-fg-2">
        Scored per deck inside the evaluation report — alongside the Analyst, Investment Associate and Partner
        additional parameters.
      </p>
      {canConfigure && (
        <Link
          to="/app/myparams"
          className="flex w-full items-center justify-center gap-[5px] rounded-[7px] border border-line bg-surface py-[9px] text-xs text-fg-2 hover:bg-offwhite"
        >
          <Settings className="h-3 w-3" aria-hidden="true" /> Configure
        </Link>
      )}
    </article>
  );
}

function IcEvaluateScreen() {
  const { user } = useAuth();
  const can = usePermissions();
  const { showToast } = useToast();
  const { decks, coreParams, ownedAdditional, anchors, scoringCfg } = useEvaluateData();
  /** This member's ballot per deal: a vote, `null` for none, absent until read. */
  const [ballots, setBallots] = useState<Record<string, IcVoteValue | null>>({});
  const chosen = useRef<Record<string, IcVoteValue>>({});
  const [detail, setDetail] = useState<{ kind: "additional"; index: number } | { kind: "core"; key: string } | null>(null);
  const [reportFor, setReportFor] = useState<DeckView | null>(null);
  const [showFilter, setShowFilter] = useState(false);
  const [query, setQuery] = useState("");
  const [flaggedOnly, setFlaggedOnly] = useState(false);

  // The deals before the committee — the only ones a ballot can be cast on.
  const pool = useMemo(() => (decks ?? []).filter((d) => d.statusId === "ic_review"), [decks]);
  const rows = useMemo(() => pool.filter((d) => matchesFilter(d, query, flaggedOnly)), [pool, query, flaggedOnly]);

  useEffect(() => {
    let live = true;
    for (const d of pool) {
      listIcVotes(d.id)
        .then((r) => {
          // A ballot cast on this screen since it mounted wins over the read.
          if (live) setBallots((b) => ({ ...b, [d.id]: chosen.current[d.id] ?? r.myVote }));
        })
        .catch(() => {});
    }
    return () => {
      live = false;
    };
  }, [pool]);

  async function vote(deck: DeckView, next: IcVoteValue) {
    const before = ballots[deck.id];
    chosen.current = { ...chosen.current, [deck.id]: next };
    setBallots((b) => ({ ...b, [deck.id]: next }));
    try {
      await castIcVote(deck.id, next);
      showToast(`${deck.name} → ${IC_VOTE_LABELS[next]}`, "success");
    } catch {
      const rest = { ...chosen.current };
      delete rest[deck.id];
      chosen.current = rest;
      setBallots((b) => ({ ...b, [deck.id]: before ?? null }));
      showToast(`Couldn't record your vote on ${deck.name}`, "error");
    }
  }

  const canConfigureCore = user ? canAccessNav(user.edition, user.role, "coreparams", can) : false;
  const canConfigureMine = user ? canAccessNav(user.edition, user.role, "myparams", can) : false;
  const detailParam = detail?.kind === "core" ? (coreParams.find((p) => p.key === detail.key) ?? null) : null;
  const showAdditional = (detail?.kind === "additional" || detail === null) && ownedAdditional.length > 0;
  const activeAdditional = detail?.kind === "additional" ? detail.index : 0;

  return (
    <PanelFrame
      flush
      title="Evaluate"
      subtitle="Click a deck to open its evaluation report · set its status alongside"
      actions={
        <>
          <ToolbarButton onClick={() => setShowFilter((v) => !v)} aria-expanded={showFilter} aria-controls="ev-filter">
            <Filter className="h-3 w-3" aria-hidden="true" />
            Filter
          </ToolbarButton>
          <ToolbarButton onClick={() => exportDecks("Evaluate", rows)} disabled={rows.length === 0}>
            <Download className="h-3 w-3" aria-hidden="true" />
            Export
          </ToolbarButton>
        </>
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        {showFilter && (
          <DeckFilter query={query} onQuery={setQuery} flaggedOnly={flaggedOnly} onFlagged={setFlaggedOnly} />
        )}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
          <section
            className="flex min-h-0 flex-col border-line bg-surface lg:w-[260px] lg:min-w-[260px] lg:border-r"
            aria-label="Decks"
          >
            <div className="border-b border-line px-[13px] py-2.5">
              <div className="text-[9px] font-semibold uppercase tracking-[0.07em] text-fg-muted" data-testid="ev-decks-label">
                {rows.length} {rows.length === 1 ? "deck" : "decks"} · click to open report
              </div>
            </div>
            {decks !== null && rows.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-fg-muted">
                <ListChecks className="h-9 w-9 opacity-25" aria-hidden="true" />
                <p className="text-xs leading-relaxed">
                  {pool.length === 0
                    ? "Nothing before the committee yet — deals appear here once they reach IC review."
                    : "No decks match this filter."}
                </p>
              </div>
            ) : (
              <ul className="min-h-0 flex-1 overflow-y-auto" aria-label="Deals at IC">
                {rows.map((deck) => {
                  const flags = deck.missingFields?.length ?? 0;
                  const ballot = ballots[deck.id];
                  return (
                    <li
                      key={deck.id}
                      className="flex items-start gap-2 border-b border-l-[3px] border-b-line border-l-transparent px-[13px] py-2.5 hover:bg-surface-2"
                    >
                      <button
                        type="button"
                        onClick={() => setReportFor(deck)}
                        title="Open evaluation report"
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="truncate text-xs font-medium text-fg">{deck.name}</div>
                        <div className="mb-1 truncate text-[10.5px] text-fg-muted">
                          {[deck.sector, deck.stage, deck.city].filter(Boolean).join(" · ")}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {deck.aiScore !== undefined && (
                            <span className="rounded-full bg-blue-lt px-1.5 py-px text-[9.5px] font-semibold text-blue">
                              AI {formatScore(deck.aiScore, scoringCfg.scoreScale)}
                            </span>
                          )}
                          {flags > 0 && (
                            <span className="rounded-full bg-warn-lt px-1.5 py-px text-[9.5px] font-medium text-warn">
                              {flags} {flags === 1 ? "flag" : "flags"}
                            </span>
                          )}
                        </div>
                      </button>
                      <select
                        aria-label={`My vote on ${deck.name}`}
                        value={ballot ?? ""}
                        disabled={ballot === undefined}
                        onChange={(e) => e.target.value && vote(deck, e.target.value as IcVoteValue)}
                        className={`max-w-[118px] shrink-0 self-center rounded-lg border-0 px-1.5 py-1 text-[10.5px] font-bold ${voteTone(ballot)}`}
                      >
                        {/* No ballot is shown as none — never as a vote the member did not cast (§8). */}
                        {!ballot && (
                          <option value="" disabled>
                            {ballot === undefined ? "…" : "Not voted"}
                          </option>
                        )}
                        {VOTE_OPTIONS.map((v) => (
                          <option key={v} value={v}>
                            {IC_VOTE_LABELS[v]}
                          </option>
                        ))}
                      </select>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section
            className="flex min-h-0 flex-col border-line bg-surface lg:w-[250px] lg:min-w-[250px] lg:border-r"
            aria-label="Evaluation parameters"
          >
            <div className="border-b border-line px-[13px] py-2.5">
              <div className="text-[9px] font-semibold uppercase tracking-[0.07em] text-fg-muted">Evaluation parameters</div>
              <div className="text-[10px] text-fg-muted">Click Review to see the full prompt</div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto py-1">
              {ownedAdditional.length > 0 && (
                <>
                  <div className="flex items-center gap-1.5 px-[13px] pb-1 pt-2 text-[9px] font-bold uppercase tracking-[0.07em] text-blue">
                    <UserCheck className="h-3 w-3" aria-hidden="true" />
                    My additional parameters (IC)
                  </div>
                  {ownedAdditional.map((p, i) => (
                    <ParamRow
                      key={p.key}
                      badge={`C${i + 1}`}
                      additional
                      name={p.name}
                      active={showAdditional && activeAdditional === i}
                      action="View"
                      onSelect={() => setDetail({ kind: "additional", index: i })}
                    />
                  ))}
                </>
              )}
              <div
                className={`flex items-center gap-1.5 px-[13px] pb-1 pt-2 text-[9px] font-bold uppercase tracking-[0.07em] text-fg-muted ${
                  ownedAdditional.length > 0 ? "mt-1.5 border-t border-line" : ""
                }`}
              >
                <ListChecks className="h-3 w-3" aria-hidden="true" />
                Core evaluation parameters
              </div>
              {coreParams.map((p, i) => (
                <ParamRow
                  key={p.key}
                  badge={String(i + 1)}
                  name={p.name}
                  weight={`${p.weight}%`}
                  active={detail?.kind === "core" && detail.key === p.key}
                  action="Review"
                  onSelect={() => setDetail({ kind: "core", key: p.key })}
                />
              ))}
            </div>
          </section>

          <section className="min-h-0 flex-1 overflow-y-auto bg-offwhite" aria-label="Parameter detail">
            <div className="px-[18px] py-4">
              {detailParam ? (
                <CoreDetail
                  param={detailParam}
                  number={coreParams.indexOf(detailParam) + 1}
                  anchors={anchors}
                  canConfigure={canConfigureCore}
                />
              ) : showAdditional ? (
                <IcAdditionalGlance params={ownedAdditional} active={activeAdditional} canConfigure={canConfigureMine} />
              ) : (
                <div className="flex min-h-[300px] flex-col items-center justify-center gap-2.5 p-10 text-center text-fg-muted">
                  <Hand className="h-9 w-9 opacity-25" aria-hidden="true" />
                  <p className="text-xs leading-relaxed">
                    Click <strong>Review</strong> on any parameter to see its evaluation prompt, scoring rubric, and
                    weight — and configure if needed.
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      {reportFor && (
        <EvaluationReportModal
          deckId={reportFor.id}
          deckName={reportFor.name}
          initialTab="additional"
          onClose={() => setReportFor(null)}
        />
      )}
    </PanelFrame>
  );
}
