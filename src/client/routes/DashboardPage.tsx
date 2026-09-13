import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Building2, ChevronDown, Download, FileText, Search, Table, Users, X } from "lucide-react";
import { useAuth } from "../auth/useAuth";
import { usePermissions } from "../auth/usePermissions";
import {
  KpiTile,
  Button,
  Badge,
  EvaluationDrawer,
  EvaluationReportModal,
  EmptyState,
  PanelFrame,
  TagEditor,
  ToolbarButton,
  type ParamScoreView,
  type ExtractionSlide,
} from "../components";
import {
  AiHealthLine,
  IntakeStatusPill,
  NotCaptured,
  ParamSparkline,
  ScoreChip,
  ScoreNumber,
  StartupNameLink,
  StatusPill,
  coreParamScores,
  deckMeta,
  scoreBandColor,
  type PillTone,
} from "../components/DeckCard";
import type { DeckView } from "../types";
import { exportDecks } from "../exportCsv";
import {
  listDecks,
  getDeck,
  getDeckReport,
  getConfigSummary,
  listPrograms,
  listDeckTags,
  setDeckTags,
  listActivity,
  retryDeckAi,
  updateThresholds,
  type CohortView,
  type ProgramView,
  type DeckVersionView,
  type ActivityEvent,
} from "../api";
import { cohortRating, weightedTotal } from "../../shared/scoring";
import { deckStats, matchesStat, type DeckStat, type DeckStatKey } from "../../shared/deckStats";
import { navForUser } from "../../shared/nav";
import type { Edition } from "../../shared/roles";
import { useActiveContext } from "../activeContext";

/** SQLite's "YYYY-MM-DD HH:MM:SS" is UTC with no zone; ISO strings parse as-is. */
function parseTs(iso: string): number {
  return Date.parse(iso.endsWith("Z") || iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
}

/** "14 min ago" / "3 hr ago" / a date once it stops being today's news. */
function relativeTime(iso: string): string {
  const then = parseTs(iso);
  if (Number.isNaN(then)) return iso;
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(then).toLocaleDateString();
}

/** The prototype's table date: "2 Jun 2026". */
function shortDate(iso: string | undefined): string {
  if (!iso) return "—";
  const t = parseTs(iso);
  if (Number.isNaN(t)) return "—";
  return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// ── The table shapes ─────────────────────────────────────────────────────────
//
// SU `_scripts.js` `adRenderTable()` redraws the thead for the active stat box:
// Uploaded / Pending / Incomplete (its `adAiStats`) show founder details; AI
// Evaluated, Assigned and Shortlisted each have their own column set (F0192).
// The jury build replaces the screen with `mpRender()`'s two shapes (F0189 /
// F0194). Asserted verbatim in `test/client/allDecks.test.tsx` and snapshotted
// by `e2e/parity.spec.ts` — a renamed column fails both.

export const ALL_DECKS_COLUMNS = {
  details: ["Startup", "Founder name", "Email ID", "Phone number", "City", "Sector", "Status"],
  evaluated: ["Startup", "AI score", "Parameter scores"],
  assigned: [
    "Startup",
    "Status",
    "AI score",
    "Parameter scores",
    "Assigned to",
    "Assigned date",
    "Due date",
  ],
  shortlisted: ["Startup", "AI score", "Jury score", "Avg. score", "Addl. Parameter scores"],
  // The jury's "My Pipeline": every view but Submitted, then Submitted.
  juryOpen: ["Startup", "Status", "AI score", "Assigned by", "Assigned date", "Due date"],
  jurySubmitted: [
    "Startup",
    "AI Score",
    "My Score",
    "Av. Score",
    "Submitted to",
    "Submitted date",
    "By Due date",
  ],
  // VC keeps the shape it shipped with until `W9-A` takes the VC branch (its
  // prototype's column sets differ again — Diligence progress, Ask, Valuation…).
  vcDetails: ["Startup", "Founder name", "Email ID", "Phone", "City", "Sector", "Status"],
} as const;

type TableShape = keyof typeof ALL_DECKS_COLUMNS;

// ── The jury's "My Pipeline" ─────────────────────────────────────────────────

export type JuryStatKey = "assigned" | "evaluated" | "drafts" | "pending" | "submitted";
type ViewKey = DeckStatKey | JuryStatKey;

/** Stages in which a jury member's allocation is still being scored. */
const JURY_STAGES = ["assigned", "jury_evaluation"];

/**
 * Which of the jury screen's five disjoint buckets a deck allocated to the
 * viewer sits in (Jury `_scripts.js` `mpDecks[].stat`). Two are approximations
 * the data model forces — see plan §8:
 *   • **Drafts** has no backing state: every score save is a submission (F0195),
 *     so nothing lands there until an unsubmitted evaluation exists.
 *   • **Evaluated** ("Scoring complete") vs **Submitted** ("Sent for review") is
 *     read as: you have submitted and the deck is still in jury scoring, versus
 *     you have submitted and it has moved on.
 */
export function juryBucket(deck: DeckView): Exclude<JuryStatKey, "drafts"> {
  const stillScoring = JURY_STAGES.includes(deck.statusId ?? "");
  if (deck.assigneeSubmitted) return stillScoring ? "evaluated" : "submitted";
  return deck.statusId === "jury_evaluation" ? "pending" : "assigned";
}

const JURY_TILES: { key: JuryStatKey; label: string; sub: string; color: string }[] = [
  { key: "assigned", label: "Assigned", sub: "Allocated to you", color: "var(--blue)" },
  { key: "evaluated", label: "Evaluated", sub: "Scoring complete", color: "var(--olive)" },
  { key: "drafts", label: "Drafts", sub: "Not yet submitted", color: "var(--text-3)" },
  { key: "pending", label: "Pending Evaluation", sub: "Awaiting your score", color: "var(--amber)" },
  { key: "submitted", label: "Submitted", sub: "Sent for review", color: "var(--green)" },
];

/** A stat box: the incubator six share `DeckStat`; the jury five add two keys. */
type Tile = Omit<DeckStat, "key"> & { key: ViewKey };

function juryTiles(mine: DeckView[]): Tile[] {
  const total = mine.length;
  return JURY_TILES.map((t) => {
    const value = t.key === "drafts" ? 0 : mine.filter((d) => juryBucket(d) === t.key).length;
    return {
      key: t.key,
      label: t.label,
      value,
      sublabel: t.sub,
      progress: total === 0 ? 0 : Math.round((value / total) * 100),
      color: t.color,
    };
  });
}

/**
 * The incubator stat boxes with the prototype's copy and colours (F0323):
 * "+3 since yesterday" on Uploaded, "Missing slides" on Incomplete, and the
 * `panel-alldecks.html` bar colours — olive, amber, red, olive, blue, green.
 */
function incubatorTiles(stats: DeckStat[], decks: DeckView[]): DeckStat[] {
  const dayAgo = Date.now() - 86_400_000;
  const recent = decks.filter((d) => d.uploadedAt && parseTs(d.uploadedAt) >= dayAgo).length;
  const colors: Record<DeckStatKey, string> = {
    all: "var(--olive)",
    pending: "var(--amber)",
    incomplete: "var(--red)",
    evaluated: "var(--olive)",
    assigned: "var(--blue)",
    shortlisted: "var(--green)",
  };
  return stats.map((s) => ({
    ...s,
    color: colors[s.key],
    sublabel:
      s.key === "all" ? `+${recent} since yesterday` : s.key === "incomplete" ? "Missing slides" : s.sublabel,
  }));
}

/** The stage pill on the Assigned view (`.sp-n/.sp-p/.sp-d/.sp-i`). */
function stagePill(deck: DeckView): { label: string; tone: PillTone } {
  const s = deck.statusId ?? "";
  if (s === "incomplete") return { label: "Incomplete", tone: "red" };
  if (["uploaded", "pending_ai", "manual_review"].includes(s)) return { label: "Pending", tone: "amber" };
  if (["shortlisted", "intro", "signup", "onboard_ready"].includes(s)) return { label: "Shortlisted", tone: "green" };
  if (s === "ai_evaluated" || (s === "jury_evaluation" && deck.assigneeSubmitted)) {
    return { label: "Evaluated", tone: "green" };
  }
  if (JURY_STAGES.includes(s)) return { label: "Assigned", tone: "blue" };
  return { label: deck.status ?? s, tone: "grey" };
}

function juryPill(deck: DeckView): { label: string; tone: PillTone } {
  switch (juryBucket(deck)) {
    case "pending":
      return { label: "Pending", tone: "amber" };
    case "evaluated":
    case "submitted":
      return { label: "Evaluated", tone: "green" };
    default:
      return { label: "Assigned", tone: "blue" };
  }
}

// ── Toolbar dropdown (`.tbb` + `.cust-drop`) ─────────────────────────────────

interface MenuOption {
  value: string;
  label: string;
  hint?: string;
}

/**
 * The prototype's Program / Cohort control: an icon-labelled toolbar button with
 * a chevron whose label collapses back to "Program" / "Cohort" when All is
 * chosen, opening a menu with the current choice highlighted (F0321).
 */
function FilterMenu({
  icon,
  placeholder,
  label,
  listLabel,
  value,
  options,
  onChange,
}: {
  icon: ReactNode;
  placeholder: string;
  label: string;
  listLabel: string;
  value: string;
  options: MenuOption[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = value ? options.find((o) => o.value === value) : undefined;
  return (
    <div ref={ref} className="relative">
      <ToolbarButton
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="min-w-[120px] justify-between gap-[5px]"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="flex items-center gap-1">
          {icon} {current ? current.label : placeholder}
        </span>
        <ChevronDown className="h-2.5 w-2.5 opacity-60" aria-hidden="true" />
      </ToolbarButton>
      {open && (
        <div
          role="listbox"
          aria-label={listLabel}
          className="absolute right-0 top-[calc(100%+5px)] z-30 min-w-[170px] whitespace-nowrap rounded-lg border border-line bg-surface p-1 shadow-lg"
        >
          {options.map((o) => {
            const on = o.value === value;
            return (
              <button
                key={o.value || "all"}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={`block w-full rounded-[5px] px-2.5 py-1.5 text-left text-[11.5px] ${
                  on ? "bg-olive-lt font-medium text-olive-dk" : "text-fg-2 hover:bg-offwhite"
                }`}
              >
                {o.label}
                {o.hint && <span className="text-[9px] opacity-60"> · {o.hint}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * The cohort a programme is running now (the prototype's "Cohort 7 · Current"):
 * the one whose dates contain today; failing that the most recently started;
 * failing that — no dates at all — its last active cohort.
 */
function currentCohortIds(programs: ProgramView[]): Set<string> {
  const today = new Date().toISOString().slice(0, 10);
  const ids = new Set<string>();
  for (const p of programs) {
    const running = p.cohorts.find(
      (c) => c.startsOn && c.startsOn <= today && (!c.endsOn || c.endsOn >= today),
    );
    const latestStarted = p.cohorts
      .filter((c) => c.startsOn && c.startsOn <= today)
      .sort((a, b) => (b.startsOn ?? "").localeCompare(a.startsOn ?? ""))[0];
    const current = running ?? latestStarted ?? [...p.cohorts].reverse().find((c) => c.active);
    if (current) ids.add(current.id);
  }
  return ids;
}

// ── Parameter popover (`adShowParams` / `#as-pov`) ───────────────────────────

function ParamPopover({
  deck,
  scores,
  best,
  mediocre,
  onClose,
  onOpenReport,
}: {
  deck: DeckView;
  scores: ParamScoreView[] | null;
  best: number;
  mediocre: number;
  onClose: () => void;
  onOpenReport: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const list = scores ?? [];
  const total = list.length > 0 ? weightedTotal(list) : undefined;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`AI parameter scores — ${deck.name}`}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="max-h-[86vh] w-[520px] max-w-full overflow-auto rounded-[14px] bg-surface shadow-2xl">
        <div className="flex items-start gap-2.5 border-b border-line px-5 py-4">
          <div>
            <div className="text-base font-bold text-fg">{deck.name}</div>
            <div className="mt-0.5 text-[11px] text-fg-muted">
              {[deckMeta(deck), `AI scores across all ${list.length} parameters`].filter(Boolean).join(" · ")}
            </div>
          </div>
          <button type="button" className="ml-auto text-fg-muted" aria-label="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-3">
          {scores === null && <p className="py-2 text-xs text-fg-muted">Loading…</p>}
          {scores !== null && list.length === 0 && (
            <p className="py-2 text-xs text-fg-muted">No AI parameter scores for this deck yet.</p>
          )}
          {list.map((s) => (
            <div key={s.key ?? s.label} className="flex items-center gap-2.5 py-1.5">
              <div className="flex-1 text-[11.5px] text-fg">
                {s.label}
                <b className="block text-[9.5px] font-medium text-fg-muted">Weight {s.weight}%</b>
              </div>
              <div className="h-1.5 w-[120px] overflow-hidden rounded bg-surface-2">
                <div
                  className="h-full"
                  style={{ width: `${(s.value / 10) * 100}%`, background: scoreBandColor(s.value, best, mediocre) }}
                />
              </div>
              <div
                className="w-[34px] text-right font-mono text-xs font-semibold"
                style={{ color: scoreBandColor(s.value, best, mediocre) }}
              >
                {s.value.toFixed(1)}
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between border-t border-line px-5 py-3 text-xs text-fg-muted">
          <span>Weighted total</span>
          <b className="font-mono text-[15px]" style={{ color: total !== undefined ? scoreBandColor(total, best, mediocre) : undefined }}>
            {total !== undefined ? total.toFixed(1) : "–"} / 10
          </b>
        </div>
        <div className="px-5 pb-4">
          <button
            type="button"
            onClick={onOpenReport}
            className="flex w-full items-center justify-center gap-1.5 rounded-[9px] bg-gold-dk px-3 py-2.5 text-xs font-semibold text-white hover:opacity-90"
          >
            <FileText className="h-3.5 w-3.5" aria-hidden="true" /> Open full evaluation report
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * All decks (Workflows → All decks) — `panel-alldecks.html` and its renderers.
 *
 * Staff roles: the toolbar (Export · Program · Cohort, plus the issue-2 search
 * and tag filter), six stat boxes that re-shape the table, and a right rail of
 * Pipeline progress · Cohort rating thresholds · Activity log.
 *
 * Jury (incubator): the "My Pipeline" build — five first-person stat boxes, the
 * two `mpRender()` tables over the decks allocated to the viewer, and a rail
 * holding Pipeline progress only.
 *
 * Aug-2026 issue log (still in force):
 *   • 2 — search box + tag filter, with per-deck tagging in the report.
 *   • 3 — Export, Program and Cohort controls on the top row.
 *   • 4/5 — the fifth and sixth stat boxes are Assigned and Shortlisted.
 *   • 6 — the default table is Startup · Founder name · Email ID · Phone ·
 *         City · Sector · Status. No AI score column at this stage.
 *   • 7 — the right rail's Pipeline progress uses the stat-box titles.
 *   • 8 — an Activity log sits under Cohort rating thresholds.
 */
export function DashboardPage() {
  const { user } = useAuth();
  const can = usePermissions();
  const edition: Edition = user?.edition ?? "incubator";
  const isJury = edition === "incubator" && user?.role === "jury";
  const defaultView: ViewKey = isJury ? "assigned" : "all";
  const [ctx, setCtx] = useActiveContext(edition);
  const [decks, setDecks] = useState<DeckView[] | null>(null);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const [programs, setPrograms] = useState<ProgramView[] | null>(null);
  const [selected, setSelected] = useState<DeckView | null>(null);
  const [report, setReport] = useState<{
    scores: ParamScoreView[];
    extraction: ExtractionSlide[];
    verdict?: string;
    versions?: DeckVersionView[];
    weightedTotal?: number;
    aiScoreWithheld?: boolean;
  } | null>(null);
  // Cohort thresholds are org config (admin-editable); default to the spec bands
  // until the summary loads.
  const [thresholds, setThresholds] = useState({ best: 7.0, mediocre: 5.0 });
  // Only set once the admin types — never seeded from the mount fetch, so a
  // late summary response cannot overwrite an edit in progress.
  const [thresholdDraft, setThresholdDraft] = useState<{ best: string; mediocre: string } | null>(null);
  const [thresholdState, setThresholdState] = useState<{ busy: boolean; message?: string; error?: boolean }>({
    busy: false,
  });
  const [retrying, setRetrying] = useState<string | null>(null);

  // Issue 2 — search & tag.
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [allTags, setAllTags] = useState<string[]>([]);
  const [taggingBusy, setTaggingBusy] = useState(false);

  // Issue 4/5 — the stat boxes double as a table filter, as in the prototype.
  const [view, setView] = useState<ViewKey>(defaultView);

  // Issue 8 — the activity log.
  const [activity, setActivity] = useState<ActivityEvent[] | null>(null);

  // Row-level detail the list payload does not carry, fetched for the rows on
  // screen in the views that need it (§9 asks for it on the list instead).
  const [paramScores, setParamScores] = useState<Record<string, ParamScoreView[] | null>>({});
  const [myEvals, setMyEvals] = useState<Record<string, { total?: number; submittedAt?: string } | null>>({});
  const requested = useRef(new Set<string>());
  const [popover, setPopover] = useState<DeckView | null>(null);
  const [matrixFor, setMatrixFor] = useState<DeckView | null>(null);

  // Decks the AI pipeline gave up on (§9) — the credit was refunded and nothing
  // will pick them up again without an operator.
  const stuckDecks = useMemo(
    () => (isJury ? [] : (decks ?? []).filter((d) => d.aiState === "failed")),
    [decks, isJury],
  );

  const reload = useCallback(() => {
    return listDecks({
      programId: ctx.programId ?? undefined,
      cohortId: ctx.cohortId ?? undefined,
      q: debouncedSearch || undefined,
      tag: tagFilter || undefined,
    }).then((r) => r.decks);
  }, [ctx.programId, ctx.cohortId, debouncedSearch, tagFilter]);

  async function retry(deckId: string) {
    setRetrying(deckId);
    try {
      await retryDeckAi(deckId);
      setDecks(await reload());
      setLoadedAt(new Date().toISOString());
    } catch {
      // The row keeps its failed state; the reason is already on screen.
    } finally {
      setRetrying(null);
    }
  }

  /** Save a deck's tags, then refresh the row and the tag suggestions. */
  async function saveTags(deck: DeckView, tags: string[]) {
    setTaggingBusy(true);
    try {
      const res = await setDeckTags(deck.id, tags);
      setDecks((list) =>
        (list ?? []).map((d) => (d.id === deck.id ? { ...d, tags: res.tags } : d)),
      );
      setSelected((cur) => (cur && cur.id === deck.id ? { ...cur, tags: res.tags } : cur));
      const fresh = await listDeckTags().catch(() => ({ tags: allTags }));
      setAllTags(fresh.tags);
    } finally {
      setTaggingBusy(false);
    }
  }

  // Program/cohort hierarchy for the toolbar filter dropdowns.
  useEffect(() => {
    let live = true;
    listPrograms()
      .then((r) => live && setPrograms(r.programs))
      .catch(() => live && setPrograms([]));
    getConfigSummary()
      .then((c) => live && setThresholds({ best: c.thresholdBest, mediocre: c.thresholdMediocre }))
      .catch(() => {});
    listDeckTags()
      .then((r) => live && setAllTags(r.tags))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  // Debounce the search box so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  // "Updated 2 min ago" has to keep counting while the screen sits open.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  // Decks re-fetch whenever a filter changes.
  useEffect(() => {
    let live = true;
    setDecks(null);
    reload()
      .then((d) => {
        if (!live) return;
        setDecks(d);
        setLoadedAt(new Date().toISOString());
      })
      .catch(() => live && setDecks([]));
    return () => {
      live = false;
    };
  }, [reload]);

  // Activity log follows the program/cohort filter so it matches the table.
  useEffect(() => {
    if (isJury) return;
    let live = true;
    listActivity({
      limit: 10,
      programId: ctx.programId ?? undefined,
      cohortId: ctx.cohortId ?? undefined,
    })
      .then((r) => live && setActivity(r.events))
      .catch(() => live && setActivity([]));
    return () => {
      live = false;
    };
  }, [ctx.programId, ctx.cohortId, isJury]);

  useEffect(() => {
    if (!selected) {
      setReport(null);
      return;
    }
    let live = true;
    getDeck(selected.id)
      .then(
        (r) =>
          live &&
          setReport({
            scores: r.scores,
            extraction: r.extraction,
            verdict: r.verdict,
            weightedTotal: r.weightedTotal,
            versions: r.versions,
            aiScoreWithheld: r.aiScoreWithheld,
          }),
      )
      .catch(() => live && setReport({ scores: [], extraction: [] }));
    return () => {
      live = false;
    };
  }, [selected]);

  // The jury member's own allocation (F0193 asks the API to scope this; until it
  // does, the screen does).
  const mine = useMemo(
    () => (isJury && user ? (decks ?? []).filter((d) => d.assignedTo === user.id) : []),
    [decks, isJury, user],
  );
  const scope = isJury ? mine : (decks ?? []);

  const tiles = useMemo((): Tile[] => {
    if (isJury) return juryTiles(mine);
    const stats = deckStats(edition, decks ?? []);
    return edition === "incubator" ? incubatorTiles(stats, decks ?? []) : stats;
  }, [isJury, mine, edition, decks]);

  const rows = useMemo(() => {
    if (isJury) return view === "drafts" ? [] : mine.filter((d) => juryBucket(d) === view);
    return (decks ?? []).filter((d) => matchesStat(edition, d, view as DeckStatKey));
  }, [isJury, mine, decks, edition, view]);

  const shape: TableShape = isJury
    ? view === "submitted"
      ? "jurySubmitted"
      : "juryOpen"
    : edition !== "incubator"
      ? "vcDetails"
      : view === "evaluated"
        ? "evaluated"
        : view === "assigned"
          ? "assigned"
          : view === "shortlisted"
            ? "shortlisted"
            : "details";

  // Parameter breakdowns for the sparkline columns; the jury's own totals for
  // the Submitted view. Requested once per deck (StrictMode runs this twice).
  useEffect(() => {
    const wantParams = shape === "evaluated" || shape === "assigned";
    const wantMine = shape === "jurySubmitted";
    if (!wantParams && !wantMine) return;
    for (const d of rows) {
      const key = `${wantParams ? "p" : "m"}:${d.id}`;
      if (requested.current.has(key)) continue;
      requested.current.add(key);
      if (wantParams) {
        if (d.aiScore === undefined) continue;
        setParamScores((p) => ({ ...p, [d.id]: null }));
        getDeck(d.id)
          .then((r) => setParamScores((p) => ({ ...p, [d.id]: coreParamScores(r.scores) })))
          .catch(() => setParamScores((p) => ({ ...p, [d.id]: [] })));
      } else if (user) {
        setMyEvals((m) => ({ ...m, [d.id]: null }));
        getDeckReport(d.id)
          .then((r) => {
            const col = r.columns.find((c) => c.id === user.id);
            setMyEvals((m) => ({ ...m, [d.id]: { total: col?.total, submittedAt: col?.submittedAt } }));
          })
          .catch(() => setMyEvals((m) => ({ ...m, [d.id]: {} })));
      }
    }
  }, [shape, rows, user]);

  // Bucket evaluated decks by the admin-configured cohort thresholds so an edit
  // actually re-classifies the cohort (not just the rail's labels).
  const ratingCounts = useMemo(() => {
    const counts = { best: 0, mediocre: 0, poor: 0 };
    for (const d of decks ?? []) {
      if (d.aiScore === undefined) continue;
      counts[cohortRating(d.aiScore, thresholds.best, thresholds.mediocre)] += 1;
    }
    return counts;
  }, [decks, thresholds]);

  if (!user) return null;
  const isAdmin = user.role === "admin" || user.role === "superuser";
  const canEditThresholds = isAdmin && can("adminconsole");
  const activeProgram = programs?.find((p) => p.id === ctx.programId) ?? null;
  const allCohorts: (CohortView & { programName: string })[] = (programs ?? []).flatMap((p) =>
    p.cohorts.map((c) => ({ ...c, programName: p.name })),
  );
  const activeCohort = allCohorts.find((c) => c.id === ctx.cohortId) ?? null;
  const current = currentCohortIds(programs ?? []);
  const cohortChoices = activeProgram
    ? allCohorts.filter((c) => c.programId === activeProgram.id)
    : allCohorts;
  const showFirstRun = programs !== null && programs.length === 0 && isAdmin;
  const canTag = user.role !== "founder";
  const narrowed = debouncedSearch !== "" || tagFilter !== "" || !!ctx.programId || !!ctx.cohortId;
  const { best, mediocre } = thresholds;
  const colSpan = ALL_DECKS_COLUMNS[shape].length;
  const evaluateSlug = navForUser(edition, user.role, can).find(
    (i) => i.id === "evaluate" || i.id === "jassigned",
  )?.id;

  // F0238 — the title follows the stat box and the program / cohort choice.
  const statLabel = tiles.find((t) => t.key === view)?.label ?? "All decks";
  const context = [activeProgram?.name, activeCohort?.name].filter(Boolean);
  const title = `${view === defaultView ? "All decks" : statLabel}${
    context.length > 0 ? ` — ${context.join(", ")}` : ""
  }`;
  // F0239 — the FILTERED count and a freshness stamp.
  const noun = isJury ? "deck" : "submission";
  const subtitle =
    decks === null
      ? "Loading…"
      : `${rows.length} ${noun}${rows.length === 1 ? "" : "s"}${loadedAt ? ` · Updated ${relativeTime(loadedAt)}` : ""}`;

  function selectProgram(programId: string) {
    setCtx({ programId: programId || null, cohortId: null });
  }
  function selectCohort(cohortId: string) {
    // A cohort belongs to one programme, so choosing one with no programme
    // selected selects its programme too (F0240).
    const cohort = allCohorts.find((c) => c.id === cohortId);
    setCtx({ programId: cohort ? cohort.programId : ctx.programId, cohortId: cohortId || null });
  }
  function clearFilters() {
    setSearch("");
    setTagFilter("");
    setView(defaultView);
  }

  const draftBest = thresholdDraft?.best ?? best.toFixed(1);
  const draftMediocre = thresholdDraft?.mediocre ?? mediocre.toFixed(1);
  const bestNum = Number(draftBest);
  const mediocreNum = Number(draftMediocre);
  const draftValid =
    draftBest.trim() !== "" &&
    draftMediocre.trim() !== "" &&
    Number.isFinite(bestNum) &&
    Number.isFinite(mediocreNum) &&
    mediocreNum >= 0 &&
    bestNum <= 10 &&
    mediocreNum < bestNum;
  const mediocreRange = draftValid
    ? `${mediocreNum.toFixed(1)} – ${(bestNum - 0.1).toFixed(1)}`
    : `${mediocre.toFixed(1)} – ${(best - 0.1).toFixed(1)}`;

  async function applyThresholds() {
    if (!draftValid) return;
    setThresholdState({ busy: true });
    try {
      const res = await updateThresholds(bestNum, mediocreNum);
      setThresholds({ best: res.thresholdBest, mediocre: res.thresholdMediocre });
      setThresholdDraft(null);
      setThresholdState({ busy: false, message: "Applied to all evaluators" });
    } catch {
      setThresholdState({ busy: false, message: "Could not save the thresholds", error: true });
    }
  }

  const th = "px-2.5 py-[7px] text-[10px] font-semibold uppercase tracking-[0.05em] text-fg-muted";
  const td = "px-2.5 py-2 align-middle text-[11.5px]";
  const dim = `${td} text-[11px] text-fg-muted`;

  function startupCell(deck: DeckView, opts: { leaf?: boolean; stage?: boolean } = {}) {
    const meta = deckMeta(deck);
    return (
      <td className={td}>
        <StartupNameLink deck={deck} onOpen={setSelected} leaf={opts.leaf} />
        {meta && <div className="mt-px text-[10px] text-fg-muted">{meta}</div>}
        {opts.stage && (
          <div className="mt-px text-[10px] text-fg-muted">
            <span>{deck.status ?? "—"}</span>
            <AiHealthLine deck={deck} />
          </div>
        )}
        {deck.tags && deck.tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {deck.tags.map((t) => (
              <span
                key={t}
                className="rounded-full border border-line bg-surface-2 px-1.5 text-[10px] text-fg-muted"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </td>
    );
  }

  function captured(value: string | undefined) {
    return <td className={td}>{value ? value : <NotCaptured />}</td>;
  }

  function sparkCell(deck: DeckView) {
    const scores = paramScores[deck.id];
    return (
      <td className={td}>
        {deck.aiScore === undefined ? (
          <span className="text-fg-muted">—</span>
        ) : (
          <button
            type="button"
            title={`View AI scores for all ${scores?.length || 13} parameters`}
            aria-label={`Parameter scores — ${deck.name}`}
            onClick={() => setPopover(deck)}
            className="inline-flex cursor-pointer items-center"
          >
            {scores && scores.length > 0 ? (
              <ParamSparkline values={scores.map((s) => s.value)} best={best} mediocre={mediocre} />
            ) : (
              <span className="text-[10px] text-fg-muted">{scores === null ? "…" : "View"}</span>
            )}
          </button>
        )}
      </td>
    );
  }

  function renderRow(deck: DeckView) {
    switch (shape) {
      case "details":
      case "vcDetails":
        return (
          <>
            {startupCell(deck, { stage: true })}
            {captured(deck.founder)}
            {captured(deck.founderEmail)}
            {captured(deck.founderPhone)}
            {captured(deck.city)}
            <td className={td}>{deck.sector ?? "—"}</td>
            <td className={td}>
              <IntakeStatusPill deck={deck} />
            </td>
          </>
        );
      case "evaluated":
        return (
          <>
            {startupCell(deck)}
            <td className={td}>
              <ScoreChip value={deck.aiScore} />
            </td>
            {sparkCell(deck)}
          </>
        );
      case "assigned": {
        const pill = stagePill(deck);
        return (
          <>
            {startupCell(deck)}
            <td className={td}>
              <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
            </td>
            <td className={td}>
              <ScoreChip value={deck.aiScore} />
            </td>
            {sparkCell(deck)}
            <td className={`${td} text-[11px] ${deck.assignedToName ? "" : "text-fg-muted"}`}>
              {deck.assignedToName ?? "Unassigned"}
            </td>
            <td className={dim}>{shortDate(deck.assignedAt)}</td>
            {/* No evaluation due date exists in the data model yet (§9). */}
            <td className={dim}>—</td>
          </>
        );
      }
      case "shortlisted":
        return (
          <>
            {startupCell(deck)}
            <td className={td}>
              <ScoreNumber value={deck.aiScore} best={best} mediocre={mediocre} outOf={10} />
            </td>
            <td className={td}>
              <ScoreNumber value={deck.juryScore} best={best} mediocre={mediocre} />
            </td>
            <td className={td}>
              {/* The decision score — AI and jury blended at the org's split. */}
              <ScoreNumber value={deck.decisionScore} best={best} mediocre={mediocre} />
            </td>
            <td className={td}>
              <button
                type="button"
                title="View all parameter scores by every evaluator"
                onClick={() => setMatrixFor(deck)}
                className="inline-flex items-center gap-[5px] whitespace-nowrap rounded-[7px] border border-line bg-olive-lt px-2.5 py-[5px] text-[11px] font-semibold text-olive-dk"
              >
                <Table className="h-3 w-3" aria-hidden="true" /> View scores
              </button>
            </td>
          </>
        );
      case "juryOpen": {
        const pill = juryPill(deck);
        return (
          <>
            {startupCell(deck, { leaf: true })}
            <td className={td}>
              <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
            </td>
            <td className={td}>
              <ScoreNumber value={deck.aiScore} best={best} mediocre={mediocre} />
            </td>
            {/* Who assigned it and by when are not on the deck view yet (§9). */}
            <td className={dim}>—</td>
            <td className={dim}>{shortDate(deck.assignedAt)}</td>
            <td className={dim}>—</td>
          </>
        );
      }
      case "jurySubmitted": {
        const my = myEvals[deck.id];
        return (
          <>
            {startupCell(deck, { leaf: true })}
            <td className={td}>
              <ScoreNumber value={deck.aiScore} best={best} mediocre={mediocre} />
            </td>
            <td className={td}>
              <ScoreNumber value={my?.total} best={best} mediocre={mediocre} />
            </td>
            <td className={td}>
              <ScoreNumber value={deck.decisionScore} best={best} mediocre={mediocre} />
            </td>
            <td className={dim}>—</td>
            <td className={dim}>{shortDate(my?.submittedAt)}</td>
            <td className={dim}>—</td>
          </>
        );
      }
    }
  }

  const toolbar = (
    <>
      {/* Issue 3 / F0321 — Export first, then Program and Cohort. */}
      <ToolbarButton disabled={!decks || rows.length === 0} onClick={() => exportDecks(title, rows)}>
        <Download className="h-3 w-3" aria-hidden="true" />
        Export
      </ToolbarButton>
      <FilterMenu
        icon={<Building2 className="h-3 w-3" aria-hidden="true" />}
        placeholder="Program"
        label="Program filter"
        listLabel="Programs"
        value={ctx.programId ?? ""}
        options={[
          { value: "", label: "All Programs" },
          ...(programs ?? []).map((p) => ({ value: p.id, label: p.name })),
        ]}
        onChange={selectProgram}
      />
      <FilterMenu
        icon={<Users className="h-3 w-3" aria-hidden="true" />}
        placeholder="Cohort"
        label="Cohort filter"
        listLabel="Cohorts"
        value={ctx.cohortId ?? ""}
        options={[
          { value: "", label: "All Cohorts" },
          ...cohortChoices.map((c) => ({
            value: c.id,
            label: c.name,
            hint: [current.has(c.id) ? "Current" : "", activeProgram ? "" : c.programName]
              .filter(Boolean)
              .join(" · ") || undefined,
          })),
        ]}
        onChange={selectCohort}
      />
      {/* Issue 2 — search and tag, after the prototype's three controls. */}
      <label className="relative">
        <span className="sr-only">Search decks</span>
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-muted" />
        <input
          className="sj-input h-[27px] w-40 pl-7 text-[11px]"
          type="search"
          placeholder="Search startups…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <select
        className="sj-input h-[27px] w-24 text-[11px]"
        aria-label="Tag filter"
        value={tagFilter}
        onChange={(e) => setTagFilter(e.target.value)}
      >
        <option value="">All tags</option>
        {allTags.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
    </>
  );

  const progressRail = (
    <RailSection title="Pipeline progress">
      {isJury ? (
        <p className="text-[11px] text-fg-muted">
          {mine.length} deck{mine.length === 1 ? "" : "s"} across all stages
        </p>
      ) : (
        <p className="text-[11px] text-fg-muted">
          {tiles[0]?.value ?? 0} deck{tiles[0]?.value === 1 ? "" : "s"} uploaded · across{" "}
          {tiles.length - 1} stages
        </p>
      )}
      <div className="mt-3 flex flex-col gap-2.5">
        {(isJury ? tiles : tiles.filter((t) => t.key !== "all")).map((p) => {
          const max = Math.max(1, ...tiles.map((t) => t.value));
          // The jury rail's bar is relative to the largest bucket (`mpProgress`).
          const width = isJury ? Math.round((p.value / max) * 100) : p.progress;
          return (
            <div key={p.key}>
              <div className="flex items-center gap-1.5 text-[11px]">
                <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
                <span className="text-fg">{p.label}</span>
                <b className="ml-auto font-mono text-fg">{p.value}</b>
                <small className="w-8 text-right text-fg-muted">{p.progress}%</small>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full" style={{ width: `${width}%`, background: p.color }} />
              </div>
            </div>
          );
        })}
      </div>
    </RailSection>
  );

  const rail = isJury ? (
    progressRail
  ) : (
    <>
      {progressRail}

      <RailSection title="Cohort rating thresholds">
        <ul className="flex flex-col gap-1.5 text-[12px]">
          <li className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-fg">
              <span className="h-2 w-2 rounded-full bg-green" /> Best
            </span>
            <span className="flex items-center gap-2">
              {canEditThresholds ? (
                <span className="flex items-center gap-1 font-mono text-fg-muted">
                  ≥
                  <input
                    className="sj-input h-6 w-12 px-1 text-right font-mono text-[11px]"
                    aria-label="Best threshold"
                    inputMode="decimal"
                    value={draftBest}
                    onChange={(e) => {
                      setThresholdState({ busy: false });
                      setThresholdDraft({ best: e.target.value, mediocre: draftMediocre });
                    }}
                  />
                </span>
              ) : (
                <span className="font-mono text-fg-muted">≥ {best.toFixed(1)}</span>
              )}
              <span className="rounded bg-surface-2 px-1.5 font-mono text-xs text-fg">{ratingCounts.best}</span>
            </span>
          </li>
          <li className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-fg">
              <span className="h-2 w-2 rounded-full bg-warn" /> Mediocre
            </span>
            <span className="flex items-center gap-2">
              <span className="font-mono text-fg-muted">{mediocreRange}</span>
              <span className="rounded bg-surface-2 px-1.5 font-mono text-xs text-fg">{ratingCounts.mediocre}</span>
            </span>
          </li>
          <li className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-fg">
              <span className="h-2 w-2 rounded-full bg-red" /> Poor
            </span>
            <span className="flex items-center gap-2">
              {canEditThresholds ? (
                <span className="flex items-center gap-1 font-mono text-fg-muted">
                  &lt;
                  <input
                    className="sj-input h-6 w-12 px-1 text-right font-mono text-[11px]"
                    aria-label="Mediocre threshold"
                    inputMode="decimal"
                    value={draftMediocre}
                    onChange={(e) => {
                      setThresholdState({ busy: false });
                      setThresholdDraft({ best: draftBest, mediocre: e.target.value });
                    }}
                  />
                </span>
              ) : (
                <span className="font-mono text-fg-muted">&lt; {mediocre.toFixed(1)}</span>
              )}
              <span className="rounded bg-surface-2 px-1.5 font-mono text-xs text-fg">{ratingCounts.poor}</span>
            </span>
          </li>
        </ul>
        {canEditThresholds && (
          <>
            {/* F0237 — the control the prototype puts under the three bands. */}
            <Button
              size="sm"
              variant="secondary"
              className="mt-2 w-full"
              disabled={!thresholdDraft || !draftValid || thresholdState.busy}
              onClick={() => void applyThresholds()}
            >
              {thresholdState.busy ? "Saving…" : "Save & apply to all evaluators"}
            </Button>
            {thresholdDraft && !draftValid && (
              <p className="mt-1 text-[11px] text-signal-flagged">
                Use 0–10, with Poor below Best.
              </p>
            )}
            {thresholdState.message && (
              <p
                role="status"
                className={`mt-1 text-[11px] ${thresholdState.error ? "text-signal-flagged" : "text-fg-muted"}`}
              >
                {thresholdState.message}
              </p>
            )}
          </>
        )}
      </RailSection>

      {/* Issue 8 — Activity log, directly under Cohort rating thresholds. */}
      <RailSection title="Activity log">
        <div className="flex flex-col gap-3">
          {activity === null && <p className="text-xs text-fg-muted">Loading…</p>}
          {activity !== null && activity.length === 0 && (
            <p className="text-xs text-fg-muted">Nothing has happened here yet.</p>
          )}
          {(activity ?? []).map((e) => (
            <div key={e.id} className="flex gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
              <div className="min-w-0">
                <p className="text-xs text-fg">
                  <span className="font-medium">{e.actorName}</span>
                  {e.actorTitle ? <span className="text-fg-muted"> ({e.actorTitle})</span> : null}{" "}
                  moved <span className="font-medium">{e.deckName}</span> to {e.toLabel}
                </p>
                <p className="mt-0.5 text-[11px] text-fg-muted">{relativeTime(e.createdAt)}</p>
              </div>
            </div>
          ))}
        </div>
      </RailSection>
    </>
  );

  const workspaceEmpty = decks !== null && scope.length === 0 && !narrowed;

  return (
    <PanelFrame title={title} subtitle={subtitle} actions={toolbar} rail={rail}>
      {showFirstRun && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent/40 bg-accent/5 px-4 py-3">
          <div className="text-sm text-fg">
            <span className="font-medium">Finish setting up your workspace.</span>{" "}
            <span className="text-fg-muted">Add your sectors, programs and cohorts to organise decks.</span>
          </div>
          <Link to="/app/setup">
            <Button size="sm">Open Set up</Button>
          </Link>
        </div>
      )}

      {/* §9: stranded evaluations are otherwise invisible — every deck at
          Pending AI looks the same. Surface them with the real reason and the
          one-click re-drive. */}
      {stuckDecks.length > 0 && (
        <div className="mb-4 rounded-lg border border-signal-flagged/40 bg-signal-flagged/5 px-4 py-3">
          <div className="text-sm font-medium text-fg">
            {stuckDecks.length} deck{stuckDecks.length === 1 ? "" : "s"} could not be evaluated
          </div>
          <p className="mt-0.5 text-xs text-fg-muted">
            The credit for each has been returned. Fix the cause, then re-run the AI evaluation.
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {stuckDecks.map((deck) => (
              <li key={deck.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-fg">
                  {deck.name}
                  <span className="text-fg-muted"> · {deck.aiError ?? "AI evaluation failed"}</span>
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={retrying === deck.id}
                  onClick={() => retry(deck.id)}
                >
                  {retrying === deck.id ? "Queueing…" : "Re-run AI"}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div
        className={`grid grid-cols-2 gap-3 sm:grid-cols-3 ${isJury ? "xl:grid-cols-5" : "xl:grid-cols-6"}`}
      >
        {tiles.map((s) => (
          <KpiTile
            key={s.key}
            label={s.label}
            value={s.value}
            sublabel={s.sublabel}
            progress={s.key === "all" ? 100 : s.progress}
            barColor={s.color}
            active={view === s.key}
            onClick={() => setView(s.key)}
          />
        ))}
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface">
        {workspaceEmpty ? (
          <div className="p-6">
            <EmptyState
              icon={isJury ? "ClipboardCheck" : "Upload"}
              title={isJury ? "No decks have been assigned to you yet" : "No decks yet"}
              description={
                isJury
                  ? "Decks appear here as soon as they are allocated to you for evaluation."
                  : "Upload a pitch deck to run AI extraction and rubric scoring."
              }
            />
          </div>
        ) : (
          <table className="w-full min-w-[48rem] text-left" data-shape={shape}>
            <thead>
              <tr className="border-b border-line bg-offwhite">
                {ALL_DECKS_COLUMNS[shape].map((h) => (
                  <th key={h} className={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {decks === null ? (
                <tr>
                  <td colSpan={colSpan} className="px-3 py-6 text-center text-[12px] text-fg-muted">
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={colSpan} className="px-3 py-6 text-center text-[12px] text-fg-muted">
                    No decks in this view for the selected filters.
                    {(debouncedSearch || tagFilter || view !== defaultView) && (
                      <button
                        type="button"
                        className="ml-2 text-fg-muted underline underline-offset-2 hover:text-fg"
                        onClick={clearFilters}
                      >
                        Clear filters
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                rows.map((deck) => (
                  <tr key={deck.id} className="border-b border-line-soft last:border-b-0 hover:bg-offwhite">
                    {renderRow(deck)}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {selected && (
        <EvaluationDrawer
          open
          onClose={() => setSelected(null)}
          deck={selected}
          verdict={report?.verdict}
          scores={report?.scores ?? []}
          extraction={report?.extraction ?? []}
          versions={report?.versions ?? []}
          weightedTotal={report?.weightedTotal}
          aiScoreWithheld={report?.aiScoreWithheld}
          actions={
            evaluateSlug && JURY_STAGES.includes(selected.statusId ?? "") ? (
              <Link to={`/app/${evaluateSlug}`} className="tbb pr">
                Score in Evaluate
              </Link>
            ) : null
          }
          tagEditor={
            <div>
              <div className="u-label mb-2">Tags</div>
              <TagEditor
                tags={selected.tags ?? []}
                suggestions={allTags}
                busy={taggingBusy}
                onChange={canTag ? (tags) => saveTags(selected, tags) : undefined}
              />
            </div>
          }
          badges={
            selected.aiScore !== undefined ? (
              <Badge tone="neutral">AI {selected.aiScore.toFixed(1)}</Badge>
            ) : null
          }
        />
      )}

      {popover && (
        <ParamPopover
          deck={popover}
          scores={paramScores[popover.id] ?? null}
          best={best}
          mediocre={mediocre}
          onClose={() => setPopover(null)}
          onOpenReport={() => {
            setSelected(popover);
            setPopover(null);
          }}
        />
      )}

      {matrixFor && (
        <EvaluationReportModal
          deckId={matrixFor.id}
          deckName={matrixFor.name}
          onClose={() => setMatrixFor(null)}
        />
      )}
    </PanelFrame>
  );
}

/** `.rps` — one right-rail section with its `.rpt` title. */
function RailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-line-soft px-4 py-3.5 last:border-b-0">
      <div className="u-label mb-2">{title}</div>
      {children}
    </section>
  );
}
