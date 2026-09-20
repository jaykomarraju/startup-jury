import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  CircleCheck,
  Download,
  FileText,
  Filter,
  Leaf,
  Mail,
  Send,
  UserCheck,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { EvaluationReportModal, PageToolbar, ToolbarButton } from "../components";
import { ParamScoresModal, ParamSparkline, type ParamScoreRow } from "../components/ParamSparkline";
import type { DeckView } from "../types";
import {
  ApiError,
  confirmAssignments,
  getAssignBoard,
  listDecks,
  listEvaluators,
  listParameters,
  type AssignBoardDeck,
  type AssignmentResult,
  type EvaluatorGroup,
  type EvaluatorMember,
  type RubricParameter,
} from "../api";
import { exportDecks } from "../exportCsv";
// V4-ROUTE — the drawer keeps only the rows that came out of Assign's own
// population; `manual_review` and the query-history tail are Query's alone.
import { ASSIGNABLE_STAGES } from "../../shared/queries";
import { useAuth } from "../auth/useAuth";
import { ADDITIONAL_PARAM_OWNERS, ROLE_LABELS, type Edition } from "../../shared/roles";
import {
  ASSIGNMENT_DEADLINE_DAYS,
  assignBottomSummary,
  assignResultsSubtitle,
  assignRoleHeading,
  assignRoleName,
  assignRoleSubline,
  assignScope,
  loadBand,
  loadPercent,
  missingInfoText,
  sortAssignableRoles,
} from "../../shared/assignment";

/**
 * Assign (Evaluation → Assign) — `AISJ_IC_SuserV15/panel-assign.html` and its
 * renderers in `_scripts.js` (renderAsDecks · renderAsRoles · renderAsUsers ·
 * renderAs4 · updateAsState · asShowResults · asShowIncomplete).
 *
 * Three views in one fixed frame, exactly as the panel swaps them:
 *   • assign      — four edge-to-edge columns (evaluated decks 240px · role 200px ·
 *                   members 240px · the summary on off-white) under the toolbar,
 *                   over the olive-ruled bottom bar;
 *   • results     — "Assignment confirmed": one row per deck × member;
 *   • incomplete  — the decks that routed to Query instead, with Send to Query.
 *
 * V4-ROUTE — both lists come from the SERVER, `GET /api/decks?list=assign` and
 * `?list=query`, so the client no longer decides who is assignable. Column 1 is
 * the decks marked complete; the drawer is the ones from the same population
 * that are not. See `deckListRoute` in src/shared/queries.ts.
 *
 * W7-E rebuilt it from the round-robin allocation it shipped with (one deck, one
 * evaluator) to the prototype's cross product: every selected deck goes to every
 * selected member, and members may be mixed across roles.
 */

type View = "assign" | "results" | "incomplete";

/** Column 2's icon tiles (renderAsRoles): amber users · green user-plus · blue user-check. */
const ROLE_TILES: Record<string, { icon: typeof Users; tile: string }> = {
  program_manager: { icon: Users, tile: "bg-warn-lt text-warn" },
  partner: { icon: Users, tile: "bg-warn-lt text-warn" },
  program_associate: { icon: UserPlus, tile: "bg-green-lt text-green" },
  associate: { icon: UserPlus, tile: "bg-green-lt text-green" },
  analyst: { icon: UserPlus, tile: "bg-green-lt text-green" },
  jury: { icon: UserCheck, tile: "bg-blue-lt text-blue" },
  ic_member: { icon: UserCheck, tile: "bg-blue-lt text-blue" },
};

const AVATAR_COLOURS = ["bg-blue", "bg-purple", "bg-green", "bg-warn", "bg-red", "bg-olive"];

function avatarColour(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLOURS[h % AVATAR_COLOURS.length];
}

const LOAD_COLOURS = {
  high: { fill: "bg-red", text: "text-red" },
  mid: { fill: "bg-warn", text: "text-warn" },
  low: { fill: "bg-green", text: "text-green" },
} as const;

/** AI+ · AI++ · AI+++ by owner role, in `ADDITIONAL_PARAM_OWNERS` order (§8 Q10). */
const TIERS = ["AI+", "AI++", "AI+++"] as const;

function deckMeta(d: DeckView): string {
  return [d.sector, d.stage].filter(Boolean).join(" · ");
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** `.as-chk` — the square 14px tick box. A button, so the row's own click stays the toggle. */
function TickBox({
  checked,
  label,
  disabled,
  onToggle,
}: {
  checked: boolean;
  label: string;
  disabled?: boolean;
  onToggle?: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onToggle?.();
      }}
      className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border-[1.5px] text-[9px] font-bold ${
        checked ? "border-olive bg-olive text-white" : "border-stone-dk bg-surface text-transparent"
      } ${disabled ? "cursor-not-allowed opacity-35" : "cursor-pointer"}`}
    >
      {checked ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : null}
    </button>
  );
}

function ColumnLabel({ children }: { children: ReactNode }) {
  return <div className="flex-1 text-[9px] font-semibold uppercase tracking-[.07em] text-fg-muted">{children}</div>;
}

/** `.as-bottom` — the olive-ruled action bar pinned under every view. */
function BottomBar({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-3.5 border-t-2 border-olive bg-surface px-[18px] py-[11px]">
      <div className="text-xs text-fg-2" data-testid="assign-bottom-summary">
        {summary}
      </div>
      <div className="flex gap-2">{children}</div>
    </div>
  );
}

const primaryBtn =
  "flex items-center gap-[7px] rounded-[7px] bg-olive px-[22px] py-[9px] text-[12.5px] font-semibold text-white transition-opacity hover:bg-olive-dk disabled:pointer-events-none disabled:opacity-40";

export function AssignPage() {
  const { user } = useAuth();
  const edition: Edition = user?.edition ?? "incubator";
  const navigate = useNavigate();

  const [decks, setDecks] = useState<DeckView[] | null>(null);
  /** `?list=query` — the decks this screen hands over rather than assigns.
   *  `null` while it is still in flight, so the empty state cannot flash
   *  between the two responses arriving. */
  const [routedToQuery, setRoutedToQuery] = useState<DeckView[] | null>(null);
  const [board, setBoard] = useState<Record<string, AssignBoardDeck>>({});
  const [params, setParams] = useState<RubricParameter[]>([]);
  const [groups, setGroups] = useState<EvaluatorGroup[] | null>(null);

  const [view, setView] = useState<View>("assign");
  const [deckIds, setDeckIds] = useState<string[]>([]);
  const [role, setRole] = useState<string | null>(null);
  // Keyed by member id across every role, so switching role keeps earlier picks (F0260).
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AssignmentResult | null>(null);

  const [filterOpen, setFilterOpen] = useState(false);
  const [sector, setSector] = useState("");
  const [stage, setStage] = useState("");
  const [assignedFilter, setAssignedFilter] = useState<"" | "unassigned" | "assigned">("");

  /** Per-row AI badge view: -1 base, else the AI+ tier index (the `.ai-dd` select). */
  const [aiView, setAiView] = useState<Record<string, number>>({});
  const [paramsFor, setParamsFor] = useState<DeckView | null>(null);
  const [reportFor, setReportFor] = useState<{ id: string; name: string } | null>(null);

  const load = useCallback(() => {
    let live = true;
    // The roster and the hand-over list are two server-enforced lists, not one
    // response sliced two ways: whatever put a deck at its stage, the partition
    // has already been applied by the time either arrives.
    listDecks({ list: "assign" })
      .then((r) => live && setDecks(r.decks))
      .catch(() => live && setDecks([]));
    listDecks({ list: "query" })
      .then((r) => live && setRoutedToQuery(r.decks))
      .catch(() => live && setRoutedToQuery([]));
    getAssignBoard()
      .then((r) => live && setBoard(r.decks))
      .catch(() => live && setBoard({}));
    listEvaluators()
      .then((r) => live && setGroups(r.groups.filter((g) => g.members.length > 0)))
      .catch(() => live && setGroups([]));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => load(), [load]);

  useEffect(() => {
    let live = true;
    listParameters()
      .then((r) => live && setParams(r.parameters))
      .catch(() => live && setParams([]));
    return () => {
      live = false;
    };
  }, []);

  // ── Column 1 ─────────────────────────────────────────────────────────────
  // `?list=assign` IS the roster — the server has already dropped the decks
  // marked incomplete, so there is no second predicate to keep in step here.
  const assignable = useMemo(() => decks ?? [], [decks]);
  // The drawer: the decks the partition sent to Query out of the population
  // this screen draws from — the flagged stage as before, and now also an
  // evaluated deck whose required intake detail went missing (measured (b)/(c),
  // plan §4.1). `manual_review` and the answered-query tail are not this
  // screen's business and stay off it.
  const incomplete = useMemo(
    () =>
      (routedToQuery ?? []).filter(
        (d) => d.statusId === "incomplete" || ASSIGNABLE_STAGES[edition].includes(d.statusId ?? ""),
      ),
    [routedToQuery, edition],
  );

  const sectors = useMemo(
    () => [...new Set(assignable.map((d) => d.sector).filter((s): s is string => Boolean(s)))].sort(),
    [assignable],
  );
  const stages = useMemo(
    () => [...new Set(assignable.map((d) => d.stage).filter((s): s is string => Boolean(s)))].sort(),
    [assignable],
  );
  const activeFilters = [sector, stage, assignedFilter].filter(Boolean).length;

  const visible = useMemo(
    () =>
      assignable.filter(
        (d) =>
          (!sector || d.sector === sector) &&
          (!stage || d.stage === stage) &&
          (!assignedFilter || (assignedFilter === "assigned") === (d.statusId === "assigned")),
      ),
    [assignable, sector, stage, assignedFilter],
  );
  const visibleIncomplete = useMemo(
    () => incomplete.filter((d) => (!sector || d.sector === sector) && (!stage || d.stage === stage)),
    [incomplete, sector, stage],
  );

  // A deck the filter hides is not part of what Confirm writes.
  const selectedDecks = useMemo(() => visible.filter((d) => deckIds.includes(d.id)), [visible, deckIds]);
  const allChecked = visible.length > 0 && visible.every((d) => deckIds.includes(d.id));

  // ── Columns 2 & 3 ────────────────────────────────────────────────────────
  const roles = useMemo(() => sortAssignableRoles(edition, groups ?? []), [edition, groups]);
  const activeGroup = roles.find((g) => g.role === role) ?? null;
  const memberIndex = useMemo(() => {
    const map = new Map<string, EvaluatorMember>();
    for (const g of groups ?? []) for (const m of g.members) map.set(m.id, m);
    return map;
  }, [groups]);
  const selectedMembers = useMemo(
    () => memberIds.map((id) => memberIndex.get(id)).filter((m): m is EvaluatorMember => Boolean(m)),
    [memberIds, memberIndex],
  );

  const nDecks = selectedDecks.length;
  const nMembers = selectedMembers.length;
  const ready = nDecks > 0 && nMembers > 0;

  function toggleDeck(id: string) {
    setError(null);
    setDeckIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  function toggleAll() {
    setError(null);
    setDeckIds(allChecked ? [] : visible.map((d) => d.id));
  }

  function toggleMember(id: string) {
    setError(null);
    setMemberIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  async function confirm() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await confirmAssignments({
        deckIds: selectedDecks.map((d) => d.id),
        assigneeIds: selectedMembers.map((m) => m.id),
        note: note.trim() || undefined,
        notify,
      });
      setResult(res);
      setDeckIds([]);
      setMemberIds([]);
      setNote("");
      setView("results");
      load();
    } catch (err) {
      // The server validates every deck and member before writing any of them, so
      // a refusal means NOTHING was assigned — say which deck, not "try again".
      setError(
        err instanceof ApiError && err.body.message
          ? `Nothing was assigned. ${String(err.body.message)}`
          : "Nothing was assigned — the assignment could not be saved. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  // ── The per-parameter breakdown (#as-pov) ────────────────────────────────
  const coreParams = useMemo(() => params.filter((p) => !p.informational), [params]);
  function paramRowsFor(deck: DeckView): ParamScoreRow[] {
    const values = new Map((board[deck.id]?.core ?? []).map((s) => [s.key, s.value]));
    return coreParams
      .filter((p) => values.has(p.key))
      .map((p) => ({ name: p.name, weight: p.weight, value: values.get(p.key)! }));
  }

  const owners = ADDITIONAL_PARAM_OWNERS[edition];

  function aiBadge(deck: DeckView) {
    const entry = board[deck.id];
    const tier = aiView[deck.id] ?? -1;
    if (tier >= 0) {
      const v = entry?.additional[owners[tier]];
      return (
        <>
          {TIERS[tier]} {typeof v === "number" ? Math.round(v) : "—"}
          <small className="font-medium opacity-65">/30</small>
        </>
      );
    }
    return <>AI {typeof deck.aiScore === "number" ? deck.aiScore.toFixed(1) : "—"}</>;
  }

  // ════════════════════════════════════════════════════════════════════════
  if (view === "results" && result) {
    const nResDecks = new Set(result.rows.map((r) => r.deckId)).size;
    const nResMembers = new Set(result.rows.map((r) => r.evaluatorId)).size;
    const byId = new Map((decks ?? []).map((d) => [d.id, d]));
    return (
      <section className="sj-frame">
        <PageToolbar
          title="Assignment confirmed"
          subtitle={assignResultsSubtitle(nResDecks, nResMembers)}
          actions={
            <ToolbarButton onClick={() => setView("assign")}>
              <ArrowLeft className="h-3 w-3" /> Assign more
            </ToolbarButton>
          }
        />
        <div className="min-h-0 flex-1 overflow-y-auto px-[22px] py-[18px]">
          <div className="overflow-x-auto rounded-[10px] border border-stone-dk bg-surface">
            <table className="w-full min-w-[780px] border-collapse text-xs" aria-label="Assignment results">
              <thead>
                <tr>
                  {["Assigned deck", "Role assigned to", "Name assigned to", "Evaluation report"].map((h) => (
                    <th
                      key={h}
                      className="border-b-[1.5px] border-stone-dk bg-[#FAFAF7] px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-[.04em] text-fg-muted"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r) => {
                  const d = byId.get(r.deckId);
                  return (
                    <tr key={`${r.deckId}-${r.evaluatorId}`} className="border-b border-stone last:border-b-0">
                      <td className="whitespace-nowrap px-3 py-[11px] text-navy">
                        <div className="flex items-center font-bold">
                          <Leaf className="mr-1.5 h-3 w-3 text-gold" aria-hidden="true" />
                          {r.deckName}
                        </div>
                        {d && deckMeta(d) && <div className="text-[10.5px] text-fg-muted">{deckMeta(d)}</div>}
                      </td>
                      <td className="px-3 py-[11px]">
                        <span className="rounded-full bg-blue-lt px-[5px] py-px text-[9px] font-medium text-blue">
                          {assignRoleName(edition, r.role)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-[11px] text-navy">
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className={`inline-flex h-[18px] w-[18px] items-center justify-center rounded-full text-[8px] font-bold text-white ${avatarColour(r.evaluatorId)}`}
                          >
                            {r.initials}
                          </span>
                          {r.evaluatorName}
                        </span>
                      </td>
                      <td className="px-3 py-[11px]">
                        <ToolbarButton onClick={() => setReportFor({ id: r.deckId, name: r.deckName })}>
                          <FileText className="h-3 w-3" /> View evaluation report
                        </ToolbarButton>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <BottomBar
          summary={
            <span className="inline-flex items-center gap-1 font-semibold text-green">
              <CircleCheck className="h-3.5 w-3.5" /> {plural(result.rows.length, "evaluation")} dispatched with the
              report.
            </span>
          }
        >
          <Link to="/app/alldecks" className={primaryBtn}>
            <Check className="h-3.5 w-3.5" /> Done
          </Link>
        </BottomBar>
        {reportFor && (
          <EvaluationReportModal deckId={reportFor.id} deckName={reportFor.name} onClose={() => setReportFor(null)} />
        )}
      </section>
    );
  }

  if (view === "incomplete") {
    return (
      <section className="sj-frame">
        <PageToolbar
          title="Incomplete decks"
          subtitle="Marked incomplete — routed to Query, not assignable"
          actions={
            <ToolbarButton onClick={() => setView("assign")}>
              <ArrowLeft className="h-3 w-3" /> Back to assign
            </ToolbarButton>
          }
        />
        <div className="min-h-0 flex-1 overflow-y-auto px-[22px] py-[18px]">
          <div className="overflow-x-auto rounded-[10px] border border-stone-dk bg-surface">
            <table className="w-full min-w-[780px] border-collapse text-xs" aria-label="Incomplete decks">
              <thead>
                <tr>
                  {["Deck", "Missing information", "Status", "AI score"].map((h) => (
                    <th
                      key={h}
                      className="border-b-[1.5px] border-stone-dk bg-[#FAFAF7] px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-[.04em] text-fg-muted"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {incomplete.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-5 text-center text-fg-muted">
                      No incomplete decks — every evaluated deck is marked complete.
                    </td>
                  </tr>
                ) : (
                  incomplete.map((d) => (
                    <tr key={d.id} className="border-b border-stone last:border-b-0">
                      <td className="whitespace-nowrap px-3 py-[11px] text-navy">
                        <div className="flex items-center font-bold">
                          <Leaf className="mr-1.5 h-3 w-3 text-gold" aria-hidden="true" />
                          {d.name}
                        </div>
                        {deckMeta(d) && <div className="text-[10.5px] text-fg-muted">{deckMeta(d)}</div>}
                      </td>
                      <td className="px-3 py-[11px] text-[11.5px] text-fg-2">{missingInfoText(d)}</td>
                      <td className="px-3 py-[11px]">
                        <IncompletePill />
                      </td>
                      {/* V4-ROUTE — a deck can now be here WITH a score: it was
                          evaluated and then lost a required intake detail. */}
                      <td className="px-3 py-[11px] text-[11px] text-fg-muted">
                        {d.aiScore === undefined ? "No AI score" : d.aiScore.toFixed(1)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        <BottomBar summary={`${plural(incomplete.length, "incomplete deck")} — missing information the founder has to supply.`}>
          {incomplete.length > 0 && (
            <button
              type="button"
              className={primaryBtn}
              // The Query screen is where a founder is actually written to; these
              // decks already sit in its list, so hand it the selection to open on.
              onClick={() => navigate("/app/query", { state: { deckIds: incomplete.map((d) => d.id) } })}
            >
              <Send className="h-3.5 w-3.5" /> Send to Query
            </button>
          )}
        </BottomBar>
      </section>
    );
  }

  // ═══ The assign view ════════════════════════════════════════════════════
  return (
    <section className="sj-frame">
      <PageToolbar
        title="Assign"
        subtitle="Select evaluated decks · choose role · pick one or more jury members · confirm"
        actions={
          <>
            <ToolbarButton onClick={() => setView("incomplete")}>
              <AlertTriangle className="h-3 w-3" /> Incomplete{" "}
              <span className="font-bold" data-testid="assign-incomplete-count">
                {incomplete.length}
              </span>
            </ToolbarButton>
            <div className="relative">
              <ToolbarButton aria-expanded={filterOpen} onClick={() => setFilterOpen((o) => !o)}>
                <Filter className="h-3 w-3" />
                Filter{activeFilters > 0 ? ` · ${activeFilters}` : ""}
              </ToolbarButton>
              {filterOpen && (
                <div
                  role="group"
                  aria-label="Filter evaluated decks"
                  className="absolute right-0 top-full z-30 mt-1 flex w-56 flex-col gap-2 rounded-lg border border-stone-dk bg-surface p-3 shadow-lg"
                >
                  <FilterSelect label="Sector" value={sector} onChange={setSector} options={sectors} all="All sectors" />
                  <FilterSelect label="Stage" value={stage} onChange={setStage} options={stages} all="All stages" />
                  <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-[.06em] text-fg-muted">
                    Assignment
                    <select
                      className="rounded-md border border-stone-dk bg-surface px-2 py-1 text-xs font-normal normal-case tracking-normal text-fg"
                      value={assignedFilter}
                      onChange={(e) => setAssignedFilter(e.target.value as typeof assignedFilter)}
                    >
                      <option value="">All decks</option>
                      <option value="unassigned">Not yet assigned</option>
                      <option value="assigned">Already assigned</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    className="self-end text-[11px] text-fg-muted underline-offset-2 hover:underline disabled:opacity-40"
                    disabled={activeFilters === 0}
                    onClick={() => {
                      setSector("");
                      setStage("");
                      setAssignedFilter("");
                    }}
                  >
                    Clear filters
                  </button>
                </div>
              )}
            </div>
            <ToolbarButton onClick={() => exportDecks("assign", visible)} disabled={visible.length === 0}>
              <Download className="h-3 w-3" />
              Export
            </ToolbarButton>
          </>
        }
      />

      <div className="flex min-h-0 flex-1 overflow-x-auto">
        {/* COL 1 — evaluated decks (.as-col1, 240px) */}
        <div className="flex w-[240px] min-w-[240px] flex-col overflow-hidden border-r border-stone-dk bg-surface">
          <div className="flex shrink-0 items-center gap-2 border-b border-stone px-[13px] py-[9px]">
            <ColumnLabel>Evaluated decks</ColumnLabel>
            <span className="flex items-center gap-[5px] text-[10px] text-fg-muted">
              <TickBox checked={allChecked} label="Select all decks" disabled={visible.length === 0} onToggle={toggleAll} />
              All
            </span>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto" aria-label="Evaluated decks">
            {decks === null || routedToQuery === null ? null : visible.length === 0 && visibleIncomplete.length === 0 ? (
              <li className="px-[13px] py-6 text-center text-[11px] leading-relaxed text-fg-muted" data-testid="assign-decks-empty">
                {assignable.length === 0
                  ? "No evaluated decks yet — decks that pass the AI gate appear here."
                  : "No decks match the filter."}
              </li>
            ) : (
              <>
                {visible.map((d) => {
                  const checked = deckIds.includes(d.id);
                  const assigned = d.statusId === "assigned";
                  const entry = board[d.id];
                  const values = paramRowsFor(d).map((r) => r.value);
                  return (
                    <li
                      key={d.id}
                      data-testid="assign-deck-row"
                      onClick={() => toggleDeck(d.id)}
                      className={`flex cursor-pointer items-center gap-2 border-b border-l-[3px] border-b-stone px-[13px] py-[9px] transition-colors ${
                        checked
                          ? "border-l-olive bg-olive-lt"
                          : assigned
                            ? "border-l-green hover:bg-offwhite"
                            : "border-l-transparent hover:bg-offwhite"
                      }`}
                    >
                      <TickBox checked={checked} label={`Select ${d.name}`} onToggle={() => toggleDeck(d.id)} />
                      <div className="min-w-0 flex-1">
                        <div className="mb-px text-xs font-medium text-fg">
                          <button
                            type="button"
                            title="Open deck & evaluation report"
                            onClick={(e) => {
                              e.stopPropagation();
                              setReportFor({ id: d.id, name: d.name });
                            }}
                            className="inline-flex items-center gap-1 text-left hover:text-gold-dk hover:underline"
                          >
                            <Leaf className="h-3 w-3" aria-hidden="true" />
                            {d.name}
                          </button>
                        </div>
                        {deckMeta(d) && <div className="mb-[3px] text-[10px] text-fg-muted">{deckMeta(d)}</div>}
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="rounded-full bg-blue-lt px-[5px] py-px text-[9px] font-semibold text-blue-dk">
                            {aiBadge(d)}
                          </span>
                          <select
                            aria-label={`AI score view for ${d.name}`}
                            title="View each role additional score"
                            className="max-w-[140px] cursor-pointer rounded-[5px] border border-stone-dk bg-surface px-1 py-px text-[9px] text-fg-muted"
                            value={aiView[d.id] ?? -1}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setAiView((v) => ({ ...v, [d.id]: Number(e.target.value) }))}
                          >
                            <option value={-1}>AI base</option>
                            {owners.map((o, i) => (
                              <option key={o} value={i}>
                                {TIERS[i]} · {ROLE_LABELS[edition][o]}
                              </option>
                            ))}
                          </select>
                          <span className="rounded-[5px] bg-[#EFE7D6] px-[7px] py-0.5 text-[9.5px] font-bold text-[#854F0B]">
                            AI+ {typeof entry?.additional[owners[0]] === "number" ? Math.round(entry.additional[owners[0]]!) : "—"}
                            <small className="font-medium opacity-65">/30</small>
                          </span>
                          {values.length > 0 && (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="text-[9px] font-semibold uppercase tracking-[.06em] text-fg-muted">
                                Parameter scores
                              </span>
                              <ParamSparkline values={values} deckName={d.name} onOpen={() => setParamsFor(d)} />
                            </span>
                          )}
                          <span className="rounded-full bg-green-lt px-[5px] py-px text-[9px] font-medium text-green">
                            Evaluated
                          </span>
                          {assigned && (
                            <span className="rounded-full bg-olive-lt px-[5px] py-px text-[9px] font-medium text-olive-dk">
                              Assigned
                            </span>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
                {visibleIncomplete.map((d) => (
                  <li
                    key={d.id}
                    data-testid="assign-incomplete-row"
                    title="Marked incomplete — routed to Query; not assignable until the founder supplies the missing information"
                    className="flex cursor-default items-center gap-2 border-b border-l-[3px] border-b-stone border-l-transparent px-[13px] py-[9px] opacity-[.72]"
                  >
                    <TickBox checked={false} label={`Select ${d.name}`} disabled />
                    <div className="min-w-0 flex-1">
                      <div className="mb-px inline-flex items-center gap-1 text-xs font-medium text-fg-2">
                        <Leaf className="h-3 w-3" aria-hidden="true" />
                        {d.name}
                      </div>
                      {deckMeta(d) && <div className="mb-[3px] text-[10px] text-fg-muted">{deckMeta(d)}</div>}
                      <div className="flex flex-wrap items-center gap-1">
                        <IncompletePill />
                        <span className="text-[10.5px] text-fg-muted">{missingInfoText(d)}</span>
                      </div>
                    </div>
                  </li>
                ))}
              </>
            )}
          </ul>
          <div className="flex shrink-0 items-center justify-between border-t border-stone-dk bg-olive-lt px-[13px] py-[7px] text-[11px] font-medium text-olive-dk">
            <span data-testid="assign-selected-count">{plural(nDecks, "deck")} selected</span>
            <span className="text-[10px] text-fg-muted">✓ check to assign</span>
          </div>
        </div>

        {/* COL 2 — role (.as-col2, 200px) */}
        <div className="flex w-[200px] min-w-[200px] flex-col overflow-hidden border-r border-stone-dk bg-surface">
          <div className="flex shrink-0 items-center border-b border-stone px-[13px] py-[9px]">
            <ColumnLabel>Role</ColumnLabel>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto py-1.5" aria-label="Roles">
            {groups !== null && roles.length === 0 && (
              <li className="px-3.5 py-4 text-[11px] text-fg-muted">No evaluator roles are staffed yet.</li>
            )}
            {roles.map((g) => {
              const tile = ROLE_TILES[g.role] ?? ROLE_TILES.jury;
              const Icon = tile.icon;
              const active = role === g.role;
              return (
                <li key={g.role}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => setRole(g.role)}
                    className={`flex w-full items-center gap-[9px] border-l-[3px] px-3.5 py-[9px] text-left transition-colors ${
                      active ? "border-l-olive bg-olive-lt" : "border-l-transparent hover:bg-offwhite"
                    }`}
                  >
                    <span className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[7px] ${tile.tile}`}>
                      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-xs leading-tight ${active ? "font-semibold text-olive-dk" : "font-medium text-fg-2"}`}>
                        {assignRoleName(edition, g.role)}
                      </span>
                      <span className={`mt-px block text-[9px] ${active ? "text-olive" : "text-fg-muted"}`}>
                        {plural(g.members.length, "user")}
                      </span>
                    </span>
                    <ChevronRight className={`h-3 w-3 ${active ? "text-olive" : "text-fg-muted"}`} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {/* COL 3 — members (.as-col3, 240px) */}
        <div className="flex w-[240px] min-w-[240px] flex-col overflow-hidden border-r border-stone-dk bg-surface">
          <div className="shrink-0 border-b border-stone px-[13px] py-[9px]">
            <div className="mb-px text-[11px] font-semibold text-fg" data-testid="assign-col3-title">
              {activeGroup ? assignRoleHeading(edition, activeGroup.role) : "Users"}
            </div>
            <div className="text-[10px] text-fg-muted">
              {activeGroup
                ? assignRoleSubline(activeGroup.role, activeGroup.members.length)
                : "Select a role, then tick one or more members"}
            </div>
          </div>
          {!activeGroup ? (
            <div
              className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-fg-muted"
              data-testid="assign-col3-empty"
            >
              <Users className="h-7 w-7 opacity-25" aria-hidden="true" />
              <p className="text-[11px] leading-relaxed">Choose a role from column 2 to see available users.</p>
            </div>
          ) : (
            <ul className="min-h-0 flex-1 overflow-y-auto py-1.5" aria-label={assignRoleHeading(edition, activeGroup.role)}>
              {activeGroup.members.map((m) => {
                const chosen = memberIds.includes(m.id);
                const band = LOAD_COLOURS[loadBand(m.openDecks, m.capacity)];
                return (
                  <li key={m.id}>
                    <div
                      role="checkbox"
                      aria-checked={chosen}
                      aria-label={`Select ${m.name}`}
                      tabIndex={0}
                      onClick={() => toggleMember(m.id)}
                      onKeyDown={(e) => {
                        if (e.key === " " || e.key === "Enter") {
                          e.preventDefault();
                          toggleMember(m.id);
                        }
                      }}
                      className={`flex cursor-pointer items-center gap-[9px] border-b border-l-[3px] border-b-stone px-[13px] py-[9px] transition-colors ${
                        chosen ? "border-l-olive bg-olive-lt" : "border-l-transparent hover:bg-offwhite"
                      }`}
                    >
                      <span
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${avatarColour(m.id)}`}
                      >
                        {m.initials}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-xs font-medium leading-tight ${chosen ? "text-olive-dk" : "text-fg"}`}>
                          {m.name}
                        </span>
                        <span className="mt-px block truncate text-[10px] text-fg-muted">
                          {m.title ?? assignRoleName(edition, m.role)}
                        </span>
                        <span className="mt-[3px] flex items-center gap-1" title={`${m.openDecks} open of ${m.capacity}`}>
                          <span className="h-[3px] flex-1 overflow-hidden rounded-sm bg-stone">
                            <span
                              className={`block h-full rounded-sm ${band.fill}`}
                              style={{ width: `${loadPercent(m.openDecks, m.capacity)}%` }}
                            />
                          </span>
                          <span className={`min-w-8 text-right text-[9px] ${band.text}`} data-testid="assign-load-label">
                            {m.openDecks}/{m.capacity}
                          </span>
                        </span>
                      </span>
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-[1.5px] ${
                          chosen ? "border-olive bg-olive text-white" : "border-stone-dk text-transparent"
                        }`}
                        aria-hidden="true"
                      >
                        <Check className="h-2.5 w-2.5" strokeWidth={3} />
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* COL 4 — the summary (.as-col4, off-white) */}
        <div className="flex min-w-[320px] flex-1 flex-col overflow-hidden bg-offwhite">
          <div className="min-h-0 flex-1 overflow-y-auto px-[18px] py-4">
            {error && (
              <div role="alert" className="mb-3 rounded-lg border border-red/30 bg-red-lt px-3.5 py-2.5 text-xs text-red">
                {error}
              </div>
            )}
            {!ready ? (
              <div
                className="flex h-full flex-col items-center justify-center gap-2.5 p-10 text-center text-fg-muted"
                data-testid="assign-summary-empty"
              >
                <UserPlus className="h-10 w-10 opacity-20" aria-hidden="true" />
                <p className="text-xs leading-relaxed">
                  {nDecks === 0
                    ? "Select at least one deck from column 1."
                    : "Pick one or more jury members from column 3 — you can mix roles."}
                </p>
              </div>
            ) : (
              <>
                <div className="mb-3 rounded-[10px] border border-stone-dk bg-surface px-4 py-3.5" data-testid="assign-summary">
                  <div className="mb-3 flex items-center gap-2.5 border-b border-stone pb-2.5">
                    <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg bg-olive-lt text-olive-dk">
                      <Users className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div>
                      <div className="text-[13px] font-semibold text-fg">Assignment summary</div>
                      <div className="mt-0.5 text-[10.5px] text-fg-muted">Review before confirming</div>
                    </div>
                  </div>
                  <SummaryRow label="Decks">
                    <div className="flex flex-wrap gap-[5px]">
                      {selectedDecks.map((d) => (
                        <span key={d.id} className="rounded-full bg-blue-lt px-[9px] py-[3px] text-[11px] font-medium text-blue-dk">
                          {d.name}
                        </span>
                      ))}
                    </div>
                  </SummaryRow>
                  <SummaryRow label="Jury members">
                    <div className="flex flex-wrap gap-[5px]">
                      {selectedMembers.map((m) => (
                        <span
                          key={m.id}
                          className="inline-flex items-center gap-[5px] rounded-full bg-olive-lt py-[3px] pl-1 pr-2 text-[11px] font-medium text-olive-dk"
                        >
                          <span
                            className={`inline-flex h-[18px] w-[18px] items-center justify-center rounded-full text-[8px] font-bold text-white ${avatarColour(m.id)}`}
                          >
                            {m.initials}
                          </span>
                          {m.name}
                          <span className="text-[9px] font-semibold uppercase tracking-[.03em] text-fg-muted">
                            {assignRoleName(edition, m.role)}
                          </span>
                          <button
                            type="button"
                            aria-label={`Remove ${m.name}`}
                            onClick={() => toggleMember(m.id)}
                            className="ml-px opacity-55 hover:opacity-100"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  </SummaryRow>
                  <SummaryRow label="Scope">
                    <ScopeText nDecks={nDecks} nMembers={nMembers} />
                  </SummaryRow>
                  <SummaryRow label="Deadline">
                    <strong className="text-fg">{ASSIGNMENT_DEADLINE_DAYS} days</strong> from assignment date
                  </SummaryRow>
                </div>
                <div className="mt-2.5 rounded-lg border border-stone-dk bg-offwhite px-3.5 py-3">
                  <label
                    htmlFor="assign-instructions"
                    className="mb-1.5 block text-[9px] font-semibold uppercase tracking-[.07em] text-fg-muted"
                  >
                    Instructions to evaluators (optional)
                  </label>
                  <textarea
                    id="assign-instructions"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="e.g. Focus on traction and team slide. Flag any ARR inconsistencies."
                    className="min-h-[70px] w-full resize-none rounded-md border border-stone-dk bg-surface px-2.5 py-2 text-[11.5px] leading-normal text-fg focus:border-olive focus:outline-none"
                  />
                  <div className="mt-2 flex items-center justify-between border-t border-stone pt-2.5">
                    <span className="inline-flex items-center text-xs text-fg-2">
                      <Mail className="mr-1 h-3 w-3" aria-hidden="true" />
                      Notify {plural(nMembers, "jury member")} by email
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={notify}
                      aria-label="Notify by email"
                      title="Toggle notification"
                      onClick={() => setNotify((n) => !n)}
                      className={`relative h-[19px] w-[34px] shrink-0 rounded-full transition-colors ${notify ? "bg-olive" : "bg-stone-dk"}`}
                    >
                      <span
                        className={`absolute top-[3px] h-[13px] w-[13px] rounded-full bg-surface transition-[left] ${notify ? "left-[17px]" : "left-[3px]"}`}
                      />
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <BottomBar
        summary={
          ready ? (
            <>
              <strong className="text-olive-dk">{plural(nDecks, "deck")}</strong> →{" "}
              <strong className="text-olive-dk">{plural(nMembers, "jury member")}</strong> · click Confirm to assign.
            </>
          ) : (
            assignBottomSummary(nDecks, nMembers)
          )
        }
      >
        <Link
          to="/app/alldecks"
          className="rounded-[7px] border border-stone-dk bg-surface px-4 py-2 text-xs text-fg-2 hover:bg-offwhite"
        >
          Cancel
        </Link>
        <button type="button" className={primaryBtn} disabled={!ready || busy} onClick={confirm}>
          <UserCheck className="h-3.5 w-3.5" />
          {busy ? "Assigning…" : "Confirm assignment"}
        </button>
      </BottomBar>

      {paramsFor && (
        <ParamScoresModal
          deckName={paramsFor.name}
          meta={deckMeta(paramsFor)}
          rows={paramRowsFor(paramsFor)}
          onClose={() => setParamsFor(null)}
          onOpenReport={() => {
            setReportFor({ id: paramsFor.id, name: paramsFor.name });
            setParamsFor(null);
          }}
        />
      )}
      {reportFor && (
        <EvaluationReportModal deckId={reportFor.id} deckName={reportFor.name} onClose={() => setReportFor(null)} />
      )}
    </section>
  );
}

function IncompletePill() {
  return (
    <span className="inline-flex items-center rounded-full bg-red-lt px-[5px] py-px text-[9px] font-medium text-red">
      <AlertTriangle className="mr-[3px] h-2.5 w-2.5" aria-hidden="true" />
      Incomplete
    </span>
  );
}

function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 border-b border-stone py-2 last:border-b-0 last:pb-0">
      <div className="mt-0.5 w-20 shrink-0 text-[10px] font-semibold uppercase tracking-[.06em] text-fg-muted">{label}</div>
      <div className="flex-1 text-xs leading-normal text-fg-2">{children}</div>
    </div>
  );
}

/** "<b>2</b> decks × <b>3</b> jury members = <b>6</b> evaluations" — the words from `assignScope`. */
function ScopeText({ nDecks, nMembers }: { nDecks: number; nMembers: number }) {
  const text = assignScope(nDecks, nMembers);
  return (
    <span data-testid="assign-scope" aria-label={text}>
      <strong className="text-fg">{nDecks}</strong> deck{nDecks === 1 ? "" : "s"} ×{" "}
      <strong className="text-fg">{nMembers}</strong> jury member{nMembers === 1 ? "" : "s"} ={" "}
      <strong className="text-fg">{nDecks * nMembers}</strong> evaluation{nDecks * nMembers === 1 ? "" : "s"}
    </span>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  all,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  all: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-[.06em] text-fg-muted">
      {label}
      <select
        className="rounded-md border border-stone-dk bg-surface px-2 py-1 text-xs font-normal normal-case tracking-normal text-fg"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{all}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
