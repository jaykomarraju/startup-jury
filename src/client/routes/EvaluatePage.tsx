import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Download, Filter, Hand, ListChecks, Settings, UserCheck, X } from "lucide-react";
import { EvaluationReportModal, PanelFrame, ToolbarButton } from "../components";
import { EvalScorecard, type AiParamScore } from "../components/EvalScorecard";
import { useToast } from "../components/Toast";
import { useAuth } from "../auth/useAuth";
import { usePermissions } from "../auth/usePermissions";
import type { DeckView } from "../types";
import {
  listDecks,
  listParameters,
  listRecommendations,
  getDeck,
  getMyScores,
  setRecommendation,
  submitJuryScores,
  transitionDeck,
  ApiError,
  type EvaluateRecommendation,
  type RubricParameter,
  type RubricAnchor,
  type HumanScoreInput,
} from "../api";
import {
  DEFAULT_SCORING_SETTINGS,
  formatScore,
  toDisplayScale,
  type ScoringSettings,
} from "../../shared/scoring";
import { RUBRIC_BANDS } from "../../shared/types";
import { canAccessNav } from "../../shared/nav";
import { roleLabel } from "../../shared/roles";
import { exportDecks } from "../exportCsv";
import { scoringSettings } from "./admin/scoringApi";

/**
 * Evaluate (Evaluation → Evaluate; the jury's "Assigned").
 *
 * `AISJ_IC_SuserV15` `panel-evaluate` + its renderers (`renderEvDecks`,
 * `renderEvParams`, `evShowAddl`, `evOpenParam`), rebuilt by W7-D:
 *
 *   toolbar  — "Evaluate" · "Click a deck to open its evaluation report · set its
 *              status alongside" · Filter · Export
 *   column 1 — "N decks · click to open report": name, sector · stage · city,
 *              the AI / flags / Evaluated badges, and a status select
 *              (Shortlist · Hold · Need more info · Reject · Evaluated)
 *   column 2 — EVALUATION PARAMETERS: the caller's own additional parameters
 *              (C1–C3, View) above the core areas (1–13, weight, Review)
 *   column 3 — the parameter detail: evaluation prompt, AI clarification
 *              questions, rubric anchors, Configure; or, before anything is
 *              clicked, the caller's additional parameters at a glance
 *
 * Clicking a deck opens the evaluator workbench — the application's "evaluation
 * report" in the prototype's sense, where the evaluator scores — and the
 * consolidated, stage-aware report (spec §8.4) opens from inside it.
 *
 * The status select is the evaluator's RECOMMENDATION (0057), not a stage move;
 * see that migration's header for why.
 */

const STATUS_OPTIONS: { value: EvaluateRecommendation; label: string }[] = [
  { value: "shortlist", label: "Shortlist" },
  { value: "hold", label: "Hold" },
  { value: "need_more_info", label: "Need more info" },
  { value: "reject", label: "Reject" },
  { value: "evaluated", label: "Evaluated" },
];
const STATUS_LABEL = Object.fromEntries(STATUS_OPTIONS.map((o) => [o.value, o.label])) as Record<
  EvaluateRecommendation,
  string
>;

/** `.icq-rec.go / .hold / .no / .info` — the select takes its option's tint. */
function statusTone(v: EvaluateRecommendation): string {
  if (v === "shortlist") return "bg-green-lt text-green";
  if (v === "hold") return "bg-warn-lt text-warn";
  if (v === "reject") return "bg-red-lt text-red";
  return "bg-blue-lt text-blue";
}

/** The rubric band's tint, per `.ev-band-exc / -str / -mod / -wk / -ins`. */
const BAND_TONE: Record<string, string> = {
  exceptional: "bg-green-lt text-green",
  strong: "bg-green-lt/60 text-green",
  moderate: "bg-warn-lt text-warn",
  weak: "bg-red-lt text-red",
  insufficient: "bg-surface-2 text-fg-muted",
};

type Detail = { kind: "additional"; index: number } | { kind: "core"; key: string } | null;

export function EvaluatePage() {
  const { user } = useAuth();
  const can = usePermissions();
  const { showToast } = useToast();
  const [decks, setDecks] = useState<DeckView[] | null>(null);
  const [params, setParams] = useState<RubricParameter[]>([]);
  const [anchors, setAnchors] = useState<RubricAnchor[]>([]);
  const [recs, setRecs] = useState<Record<string, EvaluateRecommendation>>({});
  const [evaluated, setEvaluated] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<Detail>(null);
  const [showFilter, setShowFilter] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<EvaluateRecommendation | "all">("all");
  const [flaggedOnly, setFlaggedOnly] = useState(false);

  /** The deck open in the scoring workbench. */
  const [selected, setSelected] = useState<DeckView | null>(null);
  const [values, setValues] = useState<Record<string, number>>({});
  const [aiScores, setAiScores] = useState<Map<string, AiParamScore>>(new Map());
  const [aiTotal, setAiTotal] = useState<number | undefined>(undefined);
  /** Set when blind scoring withheld the AI breakdown server-side (F0106). */
  const [aiWithheld, setAiWithheld] = useState(false);
  /** Per-parameter remarks — the override rationale (F0107) is the same field. */
  const [comments, setComments] = useState<Record<string, string>>({});
  /** The org's scoring framework — the 3-score view, the scale, the rules. */
  const [scoringCfg, setScoringCfg] = useState<ScoringSettings>(DEFAULT_SCORING_SETTINGS);
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  /** The deck whose consolidated report is open. */
  const [reportFor, setReportFor] = useState<DeckView | null>(null);
  /**
   * Which workbench load a response belongs to. StrictMode runs the mount
   * effect twice and a deck can be switched mid-flight; a response for an
   * earlier load must never land on the current draft.
   */
  const loadToken = useRef(0);
  /**
   * Recommendations chosen on THIS screen since it mounted. The list fetch is
   * a mount effect (run twice under StrictMode) and can land after the first
   * choice; what the evaluator just picked must win over what the server said
   * a moment before they picked it.
   */
  const chosen = useRef<Record<string, EvaluateRecommendation>>({});

  const load = useCallback(() => {
    return listDecks()
      .then((r) => setDecks(r.decks))
      .catch(() => setDecks([]));
  }, []);

  const loadRecommendations = useCallback(() => {
    return listRecommendations()
      .then((r) => {
        setRecs({ ...r.recommendations, ...chosen.current });
        setEvaluated(new Set(r.evaluated));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    // Cached per session — the workbench must honour the admin console's
    // Scoring framework, not a hard-coded copy of its defaults.
    scoringSettings()
      .then(setScoringCfg)
      .catch(() => setScoringCfg(DEFAULT_SCORING_SETTINGS));
  }, []);

  useEffect(() => {
    load();
    loadRecommendations();
    listParameters()
      .then((r) => {
        setParams(r.parameters);
        setAnchors(r.anchors ?? []);
      })
      .catch(() => setParams([]));
  }, [load, loadRecommendations]);

  // Core areas form the weighted composite; the caller's own role-scoped
  // additional params are scored separately (assistive, own average).
  const coreParams = useMemo(() => params.filter((p) => !p.informational), [params]);
  const ownedAdditional = useMemo(
    () => params.filter((p) => p.informational && p.roleScope === user?.role),
    [params, user],
  );
  const allScored = useMemo(() => [...coreParams, ...ownedAdditional], [coreParams, ownedAdditional]);

  const statusOf = useCallback(
    (deck: DeckView): EvaluateRecommendation =>
      recs[deck.id] ?? (evaluated.has(deck.id) ? "evaluated" : "need_more_info"),
    [recs, evaluated],
  );

  const queue = useMemo(
    () =>
      (decks ?? []).filter((d) => {
        const inStage = d.statusId === "assigned" || d.statusId === "jury_evaluation";
        // A jury member only scores decks assigned to them (server enforces this
        // too); staff (PM/admin) may score any in-stage deck.
        return inStage && (user?.role !== "jury" || d.assignedTo === user.id);
      }),
    [decks, user],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return queue.filter((d) => {
      if (q && ![d.name, d.sector, d.city].some((v) => v?.toLowerCase().includes(q))) return false;
      if (statusFilter !== "all" && statusOf(d) !== statusFilter) return false;
      if (flaggedOnly && !(d.missingFields && d.missingFields.length > 0)) return false;
      return true;
    });
  }, [queue, query, statusFilter, flaggedOnly, statusOf]);

  /** Load the AI breakdown + this evaluator's saved scores for a deck. */
  const loadDeckData = useCallback((deck: DeckView) => {
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
        setAiWithheld(false);
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
  }, []);

  function openDeck(deck: DeckView) {
    setSelected(deck);
    // Nothing is pre-scored: an untouched parameter is "–", never a silent 5.
    setValues({});
    setAiScores(new Map());
    setAiTotal(undefined);
    setAiWithheld(false);
    setComments({});
    setRemarks("");
    setSaved(false);
    setError(null);
    loadDeckData(deck);
  }

  function closeDeck() {
    loadToken.current++;
    setSelected(null);
  }

  const selectedIndex = selected ? rows.findIndex((d) => d.id === selected.id) : -1;

  /**
   * The submit payload. Values travel on the org's configured **score scale**
   * (the server converts back to the canonical 0–10 it stores), and each score
   * carries its remark so the override rule can be enforced server-side.
   */
  const buildScores = useCallback(
    (): HumanScoreInput[] =>
      allScored.map((p) => ({
        key: p.key,
        value: toDisplayScale(values[p.key] ?? 0, scoringCfg.scoreScale),
        comment: comments[p.key]?.trim() || undefined,
      })),
    [allScored, values, comments, scoringCfg],
  );

  const everyParamScored = allScored.every((p) => values[p.key] != null);

  /** The server refuses a submit whose big overrides carry no rationale. */
  function reportScoreError(err: unknown, fallback: string) {
    if (err instanceof ApiError && err.code === "rationale_required") {
      setError(err.message);
      return;
    }
    setError(fallback);
  }

  async function submit() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await submitJuryScores(selected.id, buildScores(), remarks || undefined);
      setSaved(true);
      await Promise.all([load(), loadRecommendations()]);
    } catch (err) {
      reportScoreError(err, "Couldn't submit your evaluation. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function decide(action: "shortlist" | "reject") {
    if (!selected) return;
    setError(null);
    // A deck still at Assigned has no evaluation yet. Deciding on it used to
    // submit thirteen default 5s on the evaluator's behalf; now it asks for the
    // real scores first (spec §8.1).
    if (selected.statusId === "assigned" && !everyParamScored) {
      setError(`Score all ${allScored.length} parameters before you ${action} this deck.`);
      return;
    }
    setBusy(true);
    try {
      if (selected.statusId === "assigned") {
        await submitJuryScores(selected.id, buildScores(), remarks || undefined);
      }
      await transitionDeck(selected.id, action);
      closeDeck();
      await Promise.all([load(), loadRecommendations()]);
    } catch (err) {
      // The shortlist floor refuses with a message written for the evaluator
      // ("below the program's shortlist minimum…") — show it verbatim.
      if (
        err instanceof ApiError &&
        (err.code === "below_shortlist_minimum" || err.code === "rationale_required")
      ) {
        setError(err.message);
        await load();
      } else {
        setError(`Couldn't ${action}. Make sure scores are submitted.`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(deck: DeckView, next: EvaluateRecommendation) {
    const before = recs[deck.id];
    chosen.current = { ...chosen.current, [deck.id]: next };
    setRecs((r) => ({ ...r, [deck.id]: next }));
    try {
      await setRecommendation(deck.id, next);
      showToast(`${deck.name} → ${STATUS_LABEL[next]}`, "success");
    } catch {
      const rest = { ...chosen.current };
      delete rest[deck.id];
      chosen.current = rest;
      setRecs((r) => {
        const copy = { ...r };
        if (before) copy[deck.id] = before;
        else delete copy[deck.id];
        return copy;
      });
      showToast(`Couldn't update ${deck.name}`, "error");
    }
  }

  const roleName = user ? roleLabel(user.edition, user.role) : "";
  const canConfigureCore = user ? canAccessNav(user.edition, user.role, "coreparams", can) : false;
  const canConfigureMine = user ? canAccessNav(user.edition, user.role, "myparams", can) : false;
  const detailParam =
    detail?.kind === "core" ? (coreParams.find((p) => p.key === detail.key) ?? null) : null;
  const detailNumber = detailParam ? coreParams.indexOf(detailParam) + 1 : 0;
  // Before anything is clicked the prototype opens on the caller's own
  // additional parameters (`evShowAddl(0)`), where they have any.
  const showAdditional =
    (detail?.kind === "additional" || detail === null) && ownedAdditional.length > 0;
  const activeAdditional = detail?.kind === "additional" ? detail.index : 0;
  const scale = scoringCfg.scoreScale;

  return (
    <PanelFrame
      flush
      title="Evaluate"
      subtitle="Click a deck to open its evaluation report · set its status alongside"
      actions={
        <>
          <ToolbarButton
            onClick={() => setShowFilter((v) => !v)}
            aria-expanded={showFilter}
            aria-controls="ev-filter"
          >
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
          <div
            id="ev-filter"
            className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2"
          >
            <input
              className="sj-input h-8 w-56 text-xs"
              placeholder="Search startup, sector or city"
              aria-label="Search decks"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              className="sj-input h-8 w-44 text-xs"
              aria-label="Filter by status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as EvaluateRecommendation | "all")}
            >
              <option value="all">All statuses</option>
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-xs text-fg-2">
              <input type="checkbox" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} />
              Flagged only
            </label>
          </div>
        )}

        {error && !selected && (
          <div className="border-b border-signal-flagged/40 bg-signal-flagged/10 px-4 py-2.5 text-sm text-signal-flagged">
            {error}
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
          {/* COLUMN 1 — the decks */}
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
                  {queue.length === 0
                    ? "Nothing to evaluate yet — assigned decks appear here."
                    : "No decks match this filter."}
                </p>
              </div>
            ) : (
              <ul className="min-h-0 flex-1 overflow-y-auto" aria-label="Decks to evaluate">
                {rows.map((deck) => {
                  const status = statusOf(deck);
                  const flags = deck.missingFields?.length ?? 0;
                  const active = selected?.id === deck.id;
                  return (
                    <li
                      key={deck.id}
                      className={`flex items-start gap-2 border-b border-l-[3px] border-b-line px-[13px] py-2.5 transition-colors hover:bg-surface-2 ${
                        active ? "border-l-olive bg-olive-lt" : "border-l-transparent"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => openDeck(deck)}
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
                              AI {formatScore(deck.aiScore, scale)}
                            </span>
                          )}
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
                      </button>
                      <select
                        aria-label={`Status for ${deck.name}`}
                        value={status}
                        onChange={(e) => changeStatus(deck, e.target.value as EvaluateRecommendation)}
                        className={`max-w-[118px] shrink-0 self-center rounded-lg border-0 px-1.5 py-1 text-[10.5px] font-bold ${statusTone(status)}`}
                      >
                        {STATUS_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* COLUMN 2 — evaluation parameters */}
          <section
            className="flex min-h-0 flex-col border-line bg-surface lg:w-[250px] lg:min-w-[250px] lg:border-r"
            aria-label="Evaluation parameters"
          >
            <div className="border-b border-line px-[13px] py-2.5">
              <div className="text-[9px] font-semibold uppercase tracking-[0.07em] text-fg-muted">
                Evaluation parameters
              </div>
              <div className="text-[10px] text-fg-muted">Click Review to see the full prompt</div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto py-1">
              {ownedAdditional.length > 0 && (
                <>
                  <div className="flex items-center gap-1.5 px-[13px] pb-1 pt-2 text-[9px] font-bold uppercase tracking-[0.07em] text-blue">
                    <UserCheck className="h-3 w-3" aria-hidden="true" />
                    My additional parameters ({roleName})
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

          {/* COLUMN 3 — the parameter detail */}
          <section className="min-h-0 flex-1 overflow-y-auto bg-offwhite" aria-label="Parameter detail">
            <div className="px-[18px] py-4">
              {detailParam ? (
                <CoreDetail
                  param={detailParam}
                  number={detailNumber}
                  anchors={anchors}
                  canConfigure={canConfigureCore}
                />
              ) : showAdditional ? (
                <AdditionalGlance
                  params={ownedAdditional}
                  active={activeAdditional}
                  roleName={roleName}
                  canConfigure={canConfigureMine}
                />
              ) : (
                <div className="flex min-h-[300px] flex-col items-center justify-center gap-2.5 p-10 text-center text-fg-muted">
                  <Hand className="h-9 w-9 opacity-25" aria-hidden="true" />
                  <p className="text-xs leading-relaxed">
                    Click <strong>Review</strong> on any parameter to see its evaluation prompt, scoring
                    rubric, and weight — and configure if needed.
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      {/* The evaluator workbench — where a deck is scored. */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4">
          <div className="absolute inset-0 bg-navy/50" onClick={closeDeck} aria-hidden="true" />
          <div
            className="relative my-4 w-full max-w-4xl rounded-xl border border-line bg-surface p-5 pt-11 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-label={`Evaluate ${selected.name}`}
          >
            <button
              type="button"
              onClick={closeDeck}
              aria-label="Close"
              className="absolute right-3 top-3 rounded-lg p-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
            >
              <X className="h-5 w-5" />
            </button>
            {error && (
              <div className="mb-3 rounded-lg border border-signal-flagged/40 bg-signal-flagged/10 px-4 py-2.5 text-sm text-signal-flagged">
                {error}
              </div>
            )}
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
              scoring={scoringCfg}
              aiWithheld={aiWithheld}
              comments={comments}
              onChangeComment={(key, value) => setComments((cs) => ({ ...cs, [key]: value }))}
              nav={
                selectedIndex >= 0
                  ? {
                      index: selectedIndex,
                      total: rows.length,
                      onPrev: () => openDeck(rows[(selectedIndex - 1 + rows.length) % rows.length]),
                      onNext: () => openDeck(rows[(selectedIndex + 1) % rows.length]),
                    }
                  : undefined
              }
              onRescored={() => loadDeckData(selected)}
              onOpenReport={() => setReportFor(selected)}
              busy={busy}
              saved={saved}
              onSave={submit}
              actions={
                <>
                  {selected.shortlistMin !== undefined && (
                    <span
                      className={`self-center text-xs ${selected.shortlistBlocked ? "text-signal-flagged" : "text-fg-muted"}`}
                    >
                      Shortlist minimum {onScale(selected.shortlistMin, scale, 1)}
                      {selected.decisionScore !== undefined
                        ? ` · this deck ${onScale(selected.decisionScore, scale, 2)}`
                        : " · not scored yet"}
                    </span>
                  )}
                  <button
                    type="button"
                    className="tbb"
                    disabled={busy}
                    onClick={() => decide("reject")}
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    className="tbb pr"
                    disabled={busy}
                    onClick={() => decide("shortlist")}
                  >
                    Shortlist
                  </button>
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
          initialTab="additional"
          onClose={() => setReportFor(null)}
        />
      )}
    </PanelFrame>
  );
}

/**
 * A canonical 0–10 value on the org's scale. On 0–10 it keeps the fixed
 * decimals this line has always printed (the shortlist e2e pins "5.5" and
 * "d.dd"); elsewhere it is the scale's own formatting (W7-D, §9).
 */
function onScale(value: number, scale: ScoringSettings["scoreScale"], decimals: number): string {
  return scale === "0-10" ? value.toFixed(decimals) : formatScore(value, scale);
}

function ParamRow({
  badge,
  name,
  weight,
  additional,
  active,
  action,
  onSelect,
}: {
  badge: string;
  name: string;
  weight?: string;
  additional?: boolean;
  active: boolean;
  action: "Review" | "View";
  onSelect: () => void;
}) {
  return (
    <div
      className={`flex w-full items-center gap-[7px] border-l-[2.5px] px-[13px] py-[7px] transition-colors hover:bg-surface-2 ${
        active ? "border-l-olive bg-olive-lt" : "border-l-transparent"
      }`}
    >
      <span
        className={`flex h-[19px] min-w-[19px] shrink-0 items-center justify-center rounded-full px-0.5 text-[8.5px] font-bold ${
          additional ? "bg-blue-lt text-blue" : active ? "bg-olive text-white" : "bg-surface-2 text-fg-muted"
        }`}
      >
        {badge}
      </span>
      <span className={`min-w-0 flex-1 text-[11px] leading-tight ${active ? "font-medium text-olive-dk" : "text-fg-2"}`}>
        {name}
      </span>
      {weight && <span className="min-w-[26px] shrink-0 text-right text-[9px] text-fg-muted">{weight}</span>}
      <button
        type="button"
        onClick={onSelect}
        aria-label={`${action} ${name}`}
        className={`shrink-0 rounded-[5px] border px-[7px] py-0.5 text-[10px] ${
          active ? "border-olive bg-olive text-white" : "border-line bg-surface text-fg-2 hover:border-olive hover:bg-olive hover:text-white"
        }`}
      >
        {action}
      </button>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-1.5 mt-0.5 text-[9px] font-semibold uppercase tracking-[0.07em] text-fg-muted">
      {children}
    </h3>
  );
}

function CoreDetail({
  param,
  number,
  anchors,
  canConfigure,
}: {
  param: RubricParameter;
  number: number;
  anchors: RubricAnchor[];
  canConfigure: boolean;
}) {
  // W2-B's per-parameter anchor text where this area has it (§9, F0102); the
  // shared five-band scale where it does not.
  const rubric =
    param.bands && param.bands.length > 0
      ? param.bands.map((b) => ({
          label: b.label,
          key: RUBRIC_BANDS[b.index]?.key ?? "insufficient",
          text: b.description ?? b.name,
        }))
      : anchors.map((a) => {
          const band = RUBRIC_BANDS.find((b) => b.key === a.band);
          return { label: band?.label ?? `${a.min}–${a.max}`, key: a.band, text: a.label };
        });
  const questions = param.questions ?? [];

  return (
    <article className="mb-2.5 rounded-[9px] border border-line bg-surface px-4 py-3.5" aria-label={`${param.name} detail`}>
      <div className="mb-2.5 flex items-center gap-2.5 border-b border-line pb-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-olive text-xs font-bold text-white">
          {number}
        </span>
        <h2 className="flex-1 text-[15px] font-semibold text-fg">{param.name}</h2>
        <span className="text-[11px] text-fg-muted">
          Weight: <strong>{param.weight}%</strong>
        </span>
      </div>

      <SectionLabel>Evaluation prompt</SectionLabel>
      <p className="mb-2.5 rounded-[7px] border border-line bg-offwhite px-[13px] py-[11px] text-xs leading-relaxed text-fg-2">
        {param.prompt ?? `Score ${param.name} against the rubric anchors below.`}
      </p>

      <SectionLabel>AI clarification questions (asked when signals are weak)</SectionLabel>
      {questions.length > 0 ? (
        <ul className="mb-2.5 flex flex-col gap-[5px]">
          {questions.map((q) => (
            <li key={q} className="flex items-start gap-[7px] text-[11.5px] leading-normal text-fg-2">
              <span className="font-bold text-olive" aria-hidden="true">
                •
              </span>
              {q}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-2.5 text-[11.5px] text-fg-muted">No clarification questions for this area yet.</p>
      )}

      <SectionLabel>Rubric anchors</SectionLabel>
      <div className="mb-3 overflow-hidden rounded-lg border border-line bg-surface">
        {rubric.map((r) => (
          <div key={r.label} className="flex items-stretch border-b border-line last:border-b-0">
            <div
              className={`flex w-[76px] min-w-[76px] shrink-0 items-center justify-center px-2 py-2 text-center text-[9.5px] font-semibold ${
                BAND_TONE[r.key] ?? BAND_TONE.insufficient
              }`}
            >
              {r.label}
            </div>
            <div className="flex-1 px-3 py-2 text-[11px] leading-normal text-fg-2">{r.text}</div>
          </div>
        ))}
      </div>

      {canConfigure && (
        <Link
          to="/app/coreparams"
          className="flex w-full items-center justify-center gap-[5px] rounded-[7px] border border-line bg-surface py-[9px] text-xs text-fg-2 hover:bg-offwhite"
        >
          <Settings className="h-3 w-3" aria-hidden="true" /> Configure
        </Link>
      )}
    </article>
  );
}

function AdditionalGlance({
  params,
  active,
  roleName,
  canConfigure,
}: {
  params: RubricParameter[];
  active: number;
  roleName: string;
  canConfigure: boolean;
}) {
  return (
    <article className="mb-2.5 rounded-[9px] border border-line bg-surface px-4 py-3.5" aria-label="My additional parameters">
      <div className="mb-2.5 flex items-center gap-2.5 border-b border-line pb-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue text-white">
          <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        <h2 className="text-[15px] font-semibold text-fg">My additional parameters</h2>
        <span className="text-[11px] text-fg-muted">{roleName}</span>
      </div>
      <SectionLabel>Your three additional parameters at a glance</SectionLabel>
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
          {(p.description ?? p.prompt) && (
            <p className="mt-1 text-[11.5px] leading-normal text-fg-2">{p.description ?? p.prompt}</p>
          )}
        </div>
      ))}
      <div className="mt-2.5">
        <SectionLabel>How these are used</SectionLabel>
      </div>
      <p className="mb-3 rounded-[7px] border border-line bg-offwhite px-[13px] py-[11px] text-xs leading-relaxed text-fg-2">
        Scored per deck inside the evaluation report — alongside the Program Manager, Program
        Associate and Jury Member additional parameters.
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
