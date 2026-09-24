import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Building2, ChevronDown, Clock, Download, FileText, Search, Table, Users, X } from "lucide-react";
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
import type { DeckView, DeckAction } from "../types";
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
  getDeckEvents,
  listIcVotes,
  transitionDeck,
  updateDeckDetails,
  IC_VOTE_LABELS,
  type CohortView,
  type ProgramView,
  type DeckVersionView,
  type ActivityEvent,
  type IcVotes,
  type IcVoteValue,
  type PipelineEvent,
} from "../api";
import { cohortRating, weightedTotal } from "../../shared/scoring";
import {
  deckStats,
  icMemberStats,
  isArchivedDeck,
  latestTimestamp,
  matchesIcStat,
  matchesStat,
  matchesV3Stat,
  pipelineProgress,
  v3DeckStats,
  v3StatusKey,
  V3_STATUS_LABELS,
  vcFunnelLabel,
  vcReached,
  type DeckStat,
  type IcStatKey,
  type MyBallot,
  type StatKey,
  type V3StatKey,
  type V3StatusKey,
} from "../../shared/deckStats";
// V3-DASH — the Shortlisted table's Sign-up status column reads the REAL
// sign-up record, the same source the Sign up Pipeline screen reads.
import { SIGNUP_STATUS_LABELS, listSignups, type SignupSummary } from "./SignupWorkspace";
import { canAccessNav, reachableNav } from "../../shared/nav";
// S1-DASH items 4 and 5 — the row menu's Send to Assign / Send to Query are
// guarded by the SAME predicate the server partitions the two lists with. There
// is no second predicate here and there must never be one: a button that offers
// a destination the list will not hold is the defect, not the cure.
//
// (V4-ROUTE used `isDeckComplete` here for the `v3-incomplete-mark` tag, which
// existed because "the Status word cannot show the mark". Item 3 gave the
// Status word the vocabulary to show it — `v3StatusKey` — so the tag is gone
// and the word carries it.)
import { ASSIGNABLE_STAGES, deckListRoute } from "../../shared/queries";
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

/**
 * V3-DASH — the Status column's words. Three come verbatim from
 * `adRenderTable`'s `stMap`: `{aieval:['up-st-ok','AI Evaluated'],
 * noteval:['up-st-amber','Not AI Evaluated'], incomplete:['up-st-inc',
 * 'Incomplete deck']}`.
 *
 * S1-DASH item 3 adds the fourth — **Incomplete contact details** — which the
 * client asked for on 2026-09-21 and the prototype does not have. Both
 * incomplete words are red, as `up-st-inc` is; they are two causes of the same
 * red state, not two severities, and the row's own contact cells already say
 * which fields are blank.
 *
 * The tone map only; the WORD is `v3StatusKey`'s, which is shared with the
 * tests and needs no DOM.
 */
const V3_STATUS_TONES: Record<V3StatusKey, PillTone> = {
  aieval: "green",
  noteval: "amber",
  incompleteDeck: "red",
  incompleteContact: "red",
};

/**
 * The tooltip under an incomplete Status word: what an operator can DO about
 * it. `deckListRoute` has already sent both of these rows to the Query list, so
 * the hint is the routing fact, not a guess.
 */
const V3_STATUS_HINTS: Partial<Record<V3StatusKey, string>> = {
  incompleteDeck:
    "The AI could not read or score this deck — it is on Query, not Assign. Re-evaluating it after a re-upload is what clears this.",
  incompleteContact:
    "Required founder details are missing — this deck is on Query, not Assign. Filling them in here (Actions ▾ · Edit) clears it.",
};

/**
 * V3-DASH — the Shortlisted shape's Sign-up status cell. Read-only, and in the
 * repo's own vocabulary rather than the prototype's: `adSetSignup` writes
 * `In progress / Completed / Delayed / Dropped` to an in-memory field that
 * resets on reload, and neither "Delayed" nor "Dropped" has any backing state
 * here. Making the cell writable would also reintroduce the sign-up bypass
 * `StagePage.actionCell` deliberately removed — "a sign-up completes on the
 * countersign, not on a click". Recorded as Q33.
 */
function signupCellLabel(deck: DeckView, signup: SignupSummary | undefined): string {
  if (signup) return SIGNUP_STATUS_LABELS[signup.status] ?? signup.status;
  if (deck.statusId === "onboard_ready") return "Onboarded";
  if (deck.statusId === "signup") return "Sign-up initiated";
  return "Not started";
}

/**
 * V3-DASH — the instant the Dashboard sorts a row on. `lastActivityAt` is
 * computed server-side (last pipeline event / last edit / upload); the two
 * fallbacks keep a row that predates the field, or one a test hands over
 * without it, in a defined position instead of at the top.
 */
function activityAt(deck: { lastActivityAt?: string; uploadedAt?: string }): number {
  const iso = latestTimestamp(deck.lastActivityAt, deck.uploadedAt);
  if (!iso) return Number.NEGATIVE_INFINITY;
  const t = parseTs(iso);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
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
  // W9-A — `AISJ_VC_Superuser_V8` `adRenderTable()`, one set per stat box (the
  // Admin, Partner, Associate and Analyst builds are md5-identical) — F0433.
  vcUploaded: ["Startup", "Sector", "City", "AI score", "Stage", "Submitted"],
  vcIncomplete: ["Startup", "Founder name", "Email ID", "Phone number", "City", "Status"],
  vcEvaluated: ["Startup", "AI score", "Parameter scores"],
  vcDiligence: ["Startup", "Sector", "AI score", "Diligence progress", "Flags", "Lead"],
  vcIcReady: ["Startup", "AI score", "Avg. score", "Ask", "Valuation", "Recommendation"],
  vcOnboard: ["Startup", "AI score", "Term sheet", "Legal DD", "Onboarding"],
  // W9-A — the IC member's "Awaiting my vote" build (`AISJ_VC_IC_member_V2`
  // `adRenderTable()`) — F0434.
  icAtIc: ["Startup", "Sector", "AI score", "Stage in IC", "My status"],
  icMyVote: ["Startup", "Sector", "AI score", "IC avg", "Ask", "My vote"],
  icMyEval: ["Startup", "AI score", "My score", "My recommendation", "IC outcome"],
  icAgenda: ["#", "Startup", "Sector", "AI score", "Sponsor", "Ask"],
  icPipeline: ["Startup", "Cleared", "Stage", "Status", "Ask", "Owner"],
  icFunded: ["Startup", "Final check", "Round", "Close date", "Ownership"],
  // V3-DASH — `AISJ_SuperuserV3` `adRenderTable()` collapses the superuser's
  // four shapes into two. Copied verbatim from the two `thead` strings; the
  // default set is shared by every box but Shortlisted, which has its own.
  // Sector, Assigned to / date, Due date, Jury score and the parameter-score
  // sparkline are all gone from this screen.
  v3Default: ["Startup name", "Founder", "Phone", "Email", "City", "AI score", "Status", "Actions"],
  v3Shortlisted: ["Startup name", "AI score", "Avg. score", "Signup status", "Actions"],
} as const;

type TableShape = keyof typeof ALL_DECKS_COLUMNS;

/** The VC staff table for each stat box. */
const VC_SHAPES: Record<string, TableShape> = {
  uploaded: "vcUploaded",
  vcIncomplete: "vcIncomplete",
  aiEvaluated: "vcEvaluated",
  inDiligence: "vcDiligence",
  icReady: "vcIcReady",
  onboardReady: "vcOnboard",
};

/** The IC member's table for each stat box. */
const IC_SHAPES: Record<IcStatKey, TableShape> = {
  atIc: "icAtIc",
  myvote: "icMyVote",
  myeval: "icMyEval",
  agenda: "icAgenda",
  pipeline: "icPipeline",
  funded: "icFunded",
};

/** Shapes whose cells read the deck's pipeline events (a sponsor, a clearing date). */
const EVENT_SHAPES: readonly TableShape[] = ["vcDiligence", "icAgenda", "icPipeline", "icFunded"];

// ── The VC cells ─────────────────────────────────────────────────────────────

/** `.ad-chip.go / .hold / .no / .info` */
type ChipTone = "go" | "hold" | "no" | "info" | "none";

const CHIP_TONES: Record<ChipTone, string> = {
  go: "bg-olive-lt text-olive-dk",
  hold: "bg-warn-lt text-warn",
  no: "bg-red-lt text-red",
  info: "bg-blue-lt text-blue",
  none: "bg-surface-2 text-fg-muted",
};

function AdChip({ tone, children, title }: { tone: ChipTone; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-block whitespace-nowrap rounded-[11px] px-2 py-0.5 text-[10.5px] font-semibold ${CHIP_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/** The Uploaded view's Stage pill, in the VC funnel's own words (`.sp-n/.sp-p/.sp-d/.sp-i`). */
export function vcStagePill(deck: DeckView): { label: string; tone: PillTone } {
  const { label, key } = vcFunnelLabel(deck.statusId);
  const tone: PillTone =
    key === "vcIncomplete"
      ? "red"
      : key === "onboardReady"
        ? "green"
        : key === "inDiligence"
          ? "amber"
          : key === "aiEvaluated" || key === "icReady"
            ? "blue"
            : "grey";
  return { label, tone };
}

/** Term sheet · Legal DD · Onboarding, as far as the deal's stage establishes them. */
export function vcOnboardChips(deck: DeckView): {
  termSheet: [string, ChipTone];
  legal: [string, ChipTone];
  onboarding: [string, ChipTone];
} {
  const s = deck.statusId ?? "";
  // Legal DD only starts once the term sheet is executed (`start_legal_dd`).
  const termSheet: [string, ChipTone] = vcReached(s, "legal_dd")
    ? ["Signed", "go"]
    : s === "term_sheet"
      ? ["Issued", "info"]
      : ["Not issued", "none"];
  const legal: [string, ChipTone] =
    s === "onboard_ready" ? ["Cleared", "go"] : s === "legal_dd" ? ["In progress", "hold"] : ["Not started", "none"];
  const onboarding: [string, ChipTone] =
    s === "onboard_ready"
      ? [deck.curationStage ?? "Ready to onboard", "go"]
      : s === "legal_dd"
        ? ["Docs pending", "hold"]
        : s === "term_sheet"
          ? ["Awaiting signature", "info"]
          : ["Not started", "none"];
  return { termSheet, legal, onboarding };
}

/** The IC member's "Stage in IC" and "My status" cells (`adRenderTable`'s At IC branch). */
export function icStageCells(
  deck: DeckView,
  myVote: IcVoteValue | null | undefined,
): { stage: [string, ChipTone]; mine: [string, ChipTone] } {
  const s = deck.statusId ?? "";
  if (s === "onboard_ready") return { stage: ["Funded", "go"], mine: ["Invested", "go"] };
  if (["alignment_call", "term_sheet", "legal_dd"].includes(s)) {
    return { stage: [deck.status ?? s, "info"], mine: ["Cleared", "go"] };
  }
  if (myVote) return { stage: [s === "ic_review" ? "Voted" : "Vote closed", "go"], mine: [IC_VOTE_LABELS[myVote], "go"] };
  if (s === "ic_review") return { stage: ["Awaiting vote", "hold"], mine: ["Vote pending", "no"] };
  return { stage: ["Vote closed", "info"], mine: ["Did not vote", "none"] };
}

/** The IC outcome a member's ballot led to (`myeval`'s last column). */
export function icOutcome(deck: DeckView): [string, ChipTone] {
  const s = deck.statusId ?? "";
  if (s === "onboard_ready") return ["Funded", "go"];
  if (["alignment_call", "term_sheet", "legal_dd"].includes(s)) return ["Cleared", "go"];
  if (s === "archived") return ["Passed", "no"];
  return ["Recorded", "info"];
}

const VOTE_TONE: Record<IcVoteValue, ChipTone> = { invest: "go", hold: "hold", need_more_info: "info", pass: "no" };

/** The partner who sponsored a deal to IC — the deal's lead and owner. */
function sponsorOf(events: PipelineEvent[] | undefined): string | undefined {
  return events?.find((e) => e.action === "sponsor_to_ic")?.actorName;
}

function eventAt(events: PipelineEvent[] | undefined, action: string): string | undefined {
  return events?.find((e) => e.action === action)?.createdAt;
}

// ── The jury's "My Pipeline" ─────────────────────────────────────────────────

export type JuryStatKey = "assigned" | "evaluated" | "drafts" | "pending" | "submitted";
type ViewKey = StatKey | JuryStatKey | IcStatKey | V3StatKey;

/** Stages in which a jury member's allocation is still being scored. */
const JURY_STAGES = ["assigned", "jury_evaluation"];

/** The VC stages a deal is scored in (`POST /decks/:id/evaluate` refuses the rest). */
const VC_SCORING_STAGES = ["analyst_scoring", "associate_review", "partner_review"];

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

/** A stat box: the staff six share `DeckStat`; the jury five and the IC member's six add keys. */
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
 * Incubator STAFF (superuser · admin · program manager · program associate):
 * since R1-DASH this is `AISJ_SuperuserV3`'s **Dashboard** — the V3 seven tiles,
 * two table shapes, the four Status words and the row Actions menu. The toolbar
 * (Export · Program · Cohort, plus the issue-2 search and tag filter) and the
 * right rail (Pipeline progress · Cohort rating thresholds · Activity log) are
 * common to both builds and are unchanged.
 *
 * ── The orphaned screen (plan §4) ─────────────────────────────────────────
 * The admin, PM and PA were the whole live audience for the v15 incubator build
 * — the superuser left at V3-DASH, and the jury has its own tiles and shapes —
 * so `STAT_ORDER.incubator`,
 * `matchesStat("incubator", …)` and the four shapes they drive (`details`,
 * `evaluated`, `assigned`, `shortlisted`) are now unreachable in production.
 * VC does NOT inherit them: VC staff have their own `VC_SHAPES`. The code is
 * LEFT here deliberately — deleting it inside a restyle would make this change
 * unreviewable, and Q-A is not yet answered in writing, so the wave must stay
 * revertible by one line. Removal is a Wave R+1 cleanup.
 *
 * Jury (incubator): the "My Pipeline" build — five first-person stat boxes, the
 * two `mpRender()` tables over the decks allocated to the viewer, and a rail
 * holding Pipeline progress only.
 *
 * VC staff (W9-A): `AISJ_VC_Superuser_V8`'s deal funnel — Uploaded · Incomplete
 * · AI Evaluated · In Diligence · IC ready · Onboard ready — each box its own
 * table (F0433). VC IC member: `AISJ_VC_IC_member_V2`'s "Awaiting my vote"
 * build — six first-person boxes over the deals that reached the committee,
 * counted off the member's own ballots (F0434). Deal figures no deck carries
 * (ask, valuation, ownership, final cheque — F0447) render "—".
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
  // W9-A (F0434) — the IC member's All decks is "Awaiting my vote".
  const isIc = edition === "vc" && user?.role === "ic_member";
  const isVcStaff = edition === "vc" && !isIc;
  // V3 — `AISJ_SuperuserV3` reshaped this screen into a Dashboard. R1-DASH
  // widens it from the superuser to the three other incubator STAFF roles, on
  // the client's written instruction (plan_roles_incubator §2 items 1/2/3/4a/5,
  // §6 Q-A). It is a deliberate deviation from their own three prototypes,
  // which were not reshared and still draw the v15 six tiles.
  //
  // ── ONE predicate, six items ────────────────────────────────────────────
  // Items 2 (the four Status words), 3 (Send to Assign / Send to Query), 4a
  // (Archive as a tag) and 5 ("Contact Details Edited") have no gate of their
  // own: `v3StatusKey`/`matchesV3Stat`/`v3DeckStats` and `deckListRoute` are
  // pure and role-free, the server already serves `aiComplete`, `queried`,
  // `lastActivityAt` and `contactEditedAt` to every role, and `EDIT_DECK_ROLES`
  // already contains all three roles. So this line ships all six.
  //
  // ── JURY IS NOT ON THIS LIST, and it is NOT merely dead code ────────────
  // The plan (§5 item 1, footnote ᵃ) says adding `"jury"` here would change
  // nothing, because `isJury` is tested first at all three decision sites. That
  // is true of those three — `tiles`, `rows` and `shape` — and it is NOT true of
  // the screen. MEASURED, by adding `"jury"` and running the suite: the juror's
  // H1 becomes "Dashboard" and their sub-line becomes "Recent activity · 1 deck
  // · Updated just now", because `homeTitle` and the `v3Lead` prefix below read
  // `isV3Dash` with no `isJury` guard in front of them. Two jury tests fail.
  //
  // So the instruction stands, and for a stronger reason than the one given:
  // it would half-convert their screen — V3 chrome over `mpRender()`'s tables.
  // They should not get the whole thing either. Their five-tile, two-shape
  // screen is built verbatim from their own prototype's `mpRender()`, so V3
  // would DELETE a screen that already matches; the row Actions menu especially,
  // since the jury holds no Dashboard-row pipeline transitions at all.
  const isV3Dash =
    edition === "incubator" &&
    (user?.role === "superuser" ||
      user?.role === "admin" ||
      user?.role === "program_manager" ||
      user?.role === "program_associate");
  // S1-DASH item 4 — Send to Assign is guarded navigation, so the row menu
  // needs the router. (`assign` and `query` are `["admin","program_manager",
  // "program_associate"]` plus the superuser bypass — exactly the four roles
  // above — so the destination is still always reachable; `canAccessNav`
  // decides the sidebar, not this.)
  const navigate = useNavigate();
  const defaultView: ViewKey = isJury ? "assigned" : isIc ? "myvote" : edition === "vc" ? "uploaded" : "all";
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
  // VC: each deal's committee ballots (the IC member's own vote; the staff IC
  // ready view's recommendation) and its pipeline events (sponsor, clearing).
  // `null` while loading, `false` when the read failed.
  const [icVotes, setIcVotes] = useState<Record<string, IcVotes | null | false>>({});
  const [events, setEvents] = useState<Record<string, PipelineEvent[] | null>>({});
  const requested = useRef(new Set<string>());
  // V3-DASH — the Shortlisted shape's Sign-up status column, and the inline
  // contact edit the default shape's `Edit` action opens.
  const [signups, setSignups] = useState<Record<string, SignupSummary>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Record<string, string>>({});
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  // V3-DASH — an open inline edit belongs to one row in one view. Leaving it
  // set across a stat-box change strands it: the Shortlisted shape has no
  // editable columns, so the row would draw a bare Save over nothing.
  useEffect(() => {
    setEditing(null);
    setRowError(null);
  }, [view]);
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

  /** This IC member's ballot per deal: a vote, `null` for none, `undefined` until read. */
  const ballots = useMemo(() => {
    const out: Record<string, MyBallot> = {};
    for (const [id, v] of Object.entries(icVotes)) out[id] = v ? v.myVote : undefined;
    return out;
  }, [icVotes]);

  // The IC member's pool: every deal that has reached the committee.
  const atIc = useMemo(
    () => (isIc ? (decks ?? []).filter((d) => matchesIcStat(d, "atIc", undefined)) : []),
    [decks, isIc],
  );
  const scope = isJury ? mine : isIc ? atIc : (decks ?? []);

  const tiles = useMemo((): Tile[] => {
    if (isJury) return juryTiles(mine);
    if (isIc) return icMemberStats(atIc, ballots);
    if (isV3Dash) return v3DeckStats(decks ?? []);
    return deckStats(edition, decks ?? []);
  }, [isJury, isIc, isV3Dash, mine, atIc, ballots, edition, decks]);

  const rows = useMemo(() => {
    if (isJury) return view === "drafts" ? [] : mine.filter((d) => juryBucket(d) === view);
    if (isIc) return atIc.filter((d) => matchesIcStat(d, view as IcStatKey, ballots[d.id]));
    if (isV3Dash) {
      // `list.sort(function(a,b){ return (b.act||0)-(a.act||0); })` — recent
      // activity first, which is what the "· 2h ago" clock on each row names.
      // A deck with no activity at all sorts last rather than first.
      return (decks ?? [])
        .filter((d) => matchesV3Stat(d, view as V3StatKey))
        .slice()
        .sort((a, b) => activityAt(b) - activityAt(a));
    }
    return (decks ?? []).filter((d) => matchesStat(edition, d, view as StatKey));
  }, [isJury, isIc, isV3Dash, mine, atIc, ballots, decks, edition, view]);

  const shape: TableShape = isJury
    ? view === "submitted"
      ? "jurySubmitted"
      : "juryOpen"
    : isIc
      ? IC_SHAPES[view as IcStatKey]
      : isVcStaff
        ? VC_SHAPES[view] ?? "vcUploaded"
        : isV3Dash
          ? view === "shortlisted"
            ? "v3Shortlisted"
            : "v3Default"
          : view === "evaluated"
          ? "evaluated"
          : view === "assigned"
            ? "assigned"
            : view === "shortlisted"
              ? "shortlisted"
              : "details";

  // May this viewer read a deal's committee ballots (`GET /decks/:id/ic-votes`)?
  const canReadIcVotes = user ? canAccessNav(edition, user.role, "icpipeline", can) : false;

  // The IC member's boxes count off their own ballots, so every deal in the pool
  // needs its votes read — not only the rows on screen.
  useEffect(() => {
    if (!isIc || !canReadIcVotes) return;
    for (const d of atIc) {
      const key = `v:${d.id}`;
      if (requested.current.has(key)) continue;
      requested.current.add(key);
      setIcVotes((v) => ({ ...v, [d.id]: null }));
      listIcVotes(d.id)
        .then((r) => setIcVotes((v) => ({ ...v, [d.id]: r })))
        .catch(() => setIcVotes((v) => ({ ...v, [d.id]: false })));
    }
  }, [isIc, canReadIcVotes, atIc]);

  // V3-DASH — the Shortlisted shape's Sign-up status column. One request, and
  // only once that shape is on screen.
  useEffect(() => {
    if (shape !== "v3Shortlisted" || requested.current.has("signups")) return;
    requested.current.add("signups");
    listSignups()
      .then((r) => setSignups(Object.fromEntries(r.signups.map((x) => [x.deckId, x]))))
      .catch(() => setSignups({}));
  }, [shape]);

  // Parameter breakdowns for the sparkline columns; the jury's and the IC
  // member's own totals; the IC ready view's recommendations; the events a
  // sponsor or clearing date is read from. Requested once per deck (StrictMode
  // runs this twice).
  useEffect(() => {
    const wantParams = shape === "evaluated" || shape === "assigned" || shape === "vcEvaluated";
    const wantMine = shape === "jurySubmitted" || shape === "icMyEval";
    const wantVotes = shape === "vcIcReady" && canReadIcVotes;
    const wantEvents = EVENT_SHAPES.includes(shape);
    for (const d of rows) {
      if (wantVotes && !requested.current.has(`v:${d.id}`)) {
        requested.current.add(`v:${d.id}`);
        setIcVotes((v) => ({ ...v, [d.id]: null }));
        listIcVotes(d.id)
          .then((r) => setIcVotes((v) => ({ ...v, [d.id]: r })))
          .catch(() => setIcVotes((v) => ({ ...v, [d.id]: false })));
      }
      if (wantEvents && !requested.current.has(`e:${d.id}`)) {
        requested.current.add(`e:${d.id}`);
        setEvents((e) => ({ ...e, [d.id]: null }));
        getDeckEvents(d.id)
          .then((r) => setEvents((e) => ({ ...e, [d.id]: r.events })))
          .catch(() => setEvents((e) => ({ ...e, [d.id]: [] })));
      }
      if (!wantParams && !wantMine) continue;
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
  }, [shape, rows, user, canReadIcVotes]);

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
  // V3 integration — `navForUser` is THE SIDEBAR since V3-NAV, and V3 item 10
  // takes `evaluate` out of the incubator superuser's sidebar while leaving the
  // ROUTE live. Resolving this link through the sidebar therefore dropped the
  // superuser's "Score in Evaluate" (V3-NAV filed it against itself as a P0).
  // Reachability is what a link needs.
  const evaluateSlug = reachableNav(edition, user.role, can).find(
    (i) => i.id === "evaluate" || i.id === "jassigned",
  )?.id;

  // F0238 — the title follows the stat box and the program / cohort choice.
  const statLabel = tiles.find((t) => t.key === view)?.label ?? "All decks";
  const context = [activeProgram?.name, activeCohort?.name].filter(Boolean);
  // The IC member's `updateTitle()` names every box, its first one "At IC".
  // V3 renames the superuser's screen outright — `updateTitle()` there reads
  // `var title = (activeStat !== 'all') ? statPart : 'Dashboard';`.
  const homeTitle = isV3Dash ? "Dashboard" : "All decks";
  const baseTitle = isIc ? (view === "atIc" ? "At IC" : statLabel) : view === defaultView ? homeTitle : statLabel;
  const title = `${baseTitle}${context.length > 0 ? ` — ${context.join(", ")}` : ""}`;
  // F0239 — the FILTERED count and a freshness stamp ("N deals at IC" for the IC member).
  const noun = isJury ? "deck" : isIc ? "deal" : isV3Dash ? "deck" : "submission";
  // V3's `adRenderTable` leads the sub-line with the filter context, or
  // "Recent activity" when there is none — and "Shortlisted" on that shape.
  const v3Lead = shape === "v3Shortlisted" ? "Shortlisted" : context.length > 0 ? context.join(" · ") : "Recent activity";
  const subtitle =
    decks === null
      ? "Loading…"
      : `${isV3Dash ? `${v3Lead} · ` : ""}${rows.length} ${noun}${rows.length === 1 ? "" : "s"}${
          isIc ? " at IC" : ""
        }${loadedAt ? ` · Updated ${relativeTime(loadedAt)}` : ""}`;

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

  function chipCell([label, tone]: [string, ChipTone], title?: string) {
    return (
      <td className={td}>
        <AdChip tone={tone} title={title}>
          {label}
        </AdChip>
      </td>
    );
  }

  /** A deal figure no deck carries yet (ask, valuation, ownership — F0447). */
  const notRecorded = (
    <td className={dim} title="Not recorded for this deal yet">
      —
    </td>
  );

  function whoCell(name: string | undefined, loading: boolean) {
    return <td className={dim}>{loading ? "…" : (name ?? "—")}</td>;
  }

  // ── V3-DASH row machinery ──────────────────────────────────────────────
  //
  // `adAction(i,val)` offers four options — Send to Assign · Send to Query ·
  // Edit · Archive — against in-memory data with no pipeline behind it. Here
  // the stage machine decides: `deck.actions` is the set of transitions THIS
  // role may perform from THIS deck's stage, computed by the server and
  // re-checked on the way back in, so the menu can never offer a move the
  // server would refuse (our `archive`, for one, is reachable only from
  // Rejected). `Edit` is the prototype's inline contact edit and is on the
  // default shape only — the Shortlisted shape's select omits it. Q32.

  /**
   * Two transitions a generic row menu must NOT offer — the same two
   * `StagePage` withholds, for the same reasons:
   *
   *  • **`assign_jury`** has a dedicated screen because it needs an EVALUATOR.
   *    `POST /decks/:id/transition` would happily move the deck to Assigned
   *    with `assigned_to` still NULL; `POST /decks/:id/assign` is the route
   *    that sets one. Nothing is lost by withholding it: our Assign screen
   *    already lists every deck at `ai_evaluated`, so the prototype's "Send to
   *    Assign" — which pushes a row onto an in-memory list — has no work to do
   *    here. (Q32.)
   *  • **`complete_signup`** is the sign-up bypass: "a sign-up completes on the
   *    countersign, not on a click". Same reason the Shortlisted shape's
   *    Sign-up status cell is read-only (Q33).
   */
  const V3_EXCLUDED_ACTIONS = new Set(["assign_jury", "complete_signup"]);

  async function runRowAction(deck: DeckView, action: DeckAction) {
    setRowBusy(deck.id);
    setRowError(null);
    try {
      await transitionDeck(deck.id, action.action);
      setDecks(await reload());
      setLoadedAt(new Date().toISOString());
    } catch {
      setRowError(`Couldn't ${action.label.toLowerCase()} ${deck.name}. Try again.`);
    } finally {
      setRowBusy(null);
    }
  }

  async function saveRowEdit(deck: DeckView) {
    setRowBusy(deck.id);
    setRowError(null);
    try {
      await updateDeckDetails(deck.id, {
        founder: editDraft.founder ?? deck.founder ?? "",
        founderPhone: editDraft.founderPhone ?? deck.founderPhone ?? "",
        founderEmail: editDraft.founderEmail ?? deck.founderEmail ?? "",
        city: editDraft.city ?? deck.city ?? "",
      });
      setEditing(null);
      setDecks(await reload());
      setLoadedAt(new Date().toISOString());
    } catch {
      setRowError(`Couldn't save ${deck.name}. Try again.`);
    } finally {
      setRowBusy(null);
    }
  }

  const V3_EDIT_FIELDS = [
    { name: "founder", label: "Founder", read: (d: DeckView) => d.founder },
    { name: "founderPhone", label: "Phone", read: (d: DeckView) => d.founderPhone },
    { name: "founderEmail", label: "Email", read: (d: DeckView) => d.founderEmail },
    { name: "city", label: "City", read: (d: DeckView) => d.city },
  ] as const;

  // ── S1-DASH items 2, 4, 5 — the prototype's four options, guarded ────────
  //
  // `adAction(i,val)` offers Send to Assign · Send to Query · Edit · Archive
  // against in-memory data. Two of the four do not survive contact with the
  // server, which is why item 2 is a change of KIND rather than a relabel
  // (plan §12.3):
  //
  //   · `archive` is `rejected -> archived` only (src/pipeline/incubator.ts),
  //     so a one-click Archive from `ai_evaluated` is a 403;
  //   · "Send to Query" is not a transition at all — the prototype's version
  //     sets `d.queried=true` and toasts "Query email sent", and here that
  //     means actually emailing a founder a letter nobody composed.
  //
  // Both are BLOCKED on a client answer and render disabled with the reason.
  // The transitions the server does permit stay in the menu underneath: built
  // literally, item 2 would delete Reject (below AI gate), Shortlist and
  // Schedule intro call from the screen, which nobody asked for.

  /**
   * Item 4 — may this row be sent to Assign, and if not, why not?
   *
   * The predicate is `deckListRoute`, the same function `GET /api/decks?list=`
   * partitions the two screens with. **Not a second one**: a menu that offers
   * Assign for a deck the Assign list will not hold is precisely the defect.
   *
   * Send to Assign is guarded NAVIGATION, not a transition. The prototype's own
   * `addToAssign` pushes the row onto `asDecks` with `assigned:false` — it puts
   * the deck on the Assign LIST, it does not pick an evaluator — and our Assign
   * roster already lists every deck the partition routes there. So the click
   * carries the selection to `/app/assign`; `assign_jury` stays withheld for
   * the reason below (Q32).
   */
  function v3SendToAssign(deck: DeckView): { ok: boolean; reason: string } {
    const route = deckListRoute(deck, edition, { queried: deck.queried ?? false });
    if (route === "assign") return { ok: true, reason: "" };
    // In the evaluated population but marked incomplete — the Status word in
    // this very row already says which of the two causes it is, so reuse it
    // rather than inventing a second wording for the same fact.
    if (ASSIGNABLE_STAGES[edition].includes(deck.statusId ?? "")) {
      return { ok: false, reason: V3_STATUS_LABELS[v3StatusKey(deck)].toLowerCase() };
    }
    return { ok: false, reason: `not available at ${deck.status ?? "this stage"}` };
  }

  /**
   * Item 5 — the same guard, the other way round, plus the block.
   *
   * The guard is live and testable today: a row the partition does not route to
   * Query cannot be sent there. The ACTION behind it is what waits on the
   * client — one click here would email the founder (§12). Until that is
   * answered the option names the Query screen, which is where a clarification
   * letter is actually composed and reviewed before it is sent.
   */
  /**
   * Item 5 — may this row be sent to Query, and if not, why not?
   *
   * The mirror of `v3SendToAssign`, and guarded NAVIGATION for the same reason:
   * the client's own row reads "should GO TO QUERY screen WHEN Send to Query is
   * clicked", exactly as the Assign row reads "GO TO ASSIGN screen". It is not
   * the prototype's `d.queried = true` + "Query email sent" toast, which here
   * would mean emailing a founder a letter nobody composed. The letter is
   * composed on the Query screen, which has read `state.deckIds` since this
   * wave — so the click carries the selection and the operator sends from
   * there. Shipped disabled at first on a question this sentence had already
   * answered; corrected 2026-09-23.
   */
  function v3SendToQuery(deck: DeckView): { ok: boolean; reason: string } {
    const route = deckListRoute(deck, edition, { queried: deck.queried ?? false });
    // The GUARD, and it is real: a row the partition does not route to Query
    // cannot be sent there whatever the menu offers. Same function the server
    // partitions `GET /api/decks?list=` with, never a second predicate.
    if (route === "query") return { ok: true, reason: "" };
    // "Already queried" only where that is the OPERATIVE cause — i.e. the row
    // would route to Query but for the flag. A deck that is off the list
    // because it is assigned, and happens to have been queried weeks ago, is
    // not kept off it BY the query, and saying so would name the wrong reason.
    if (deck.queried === true && deckListRoute(deck, edition, { queried: false }) === "query") {
      return { ok: false, reason: "already queried" };
    }
    return { ok: false, reason: "not on the Query list" };
  }

  /** `<select class="ad-act"><option value="">Actions ▾</option>…` */
  function v3ActionCell(deck: DeckView, withEdit: boolean) {
    if (editing === deck.id) {
      return (
        <td className={td}>
          <Button size="sm" disabled={rowBusy === deck.id} onClick={() => void saveRowEdit(deck)}>
            {rowBusy === deck.id ? "Saving…" : "Save"}
          </Button>
        </td>
      );
    }
    // `archive` is drawn by the prototype's own option below, so it is not also
    // listed here — when the server permits it (from Rejected) that option is
    // the real transition, and when it does not the option says why.
    const actions = (deck.actions ?? []).filter(
      (a) => !V3_EXCLUDED_ACTIONS.has(a.action) && a.action !== "archive",
    );
    const toAssign = v3SendToAssign(deck);
    const toQuery = v3SendToQuery(deck);
    const archive = (deck.actions ?? []).find((a) => a.action === "archive");
    return (
      <td className={td}>
        <select
          className="sj-input h-[27px] w-auto py-0 text-[11px]"
          aria-label={`Actions for ${deck.name}`}
          value=""
          disabled={rowBusy !== null}
          onChange={(e) => {
            // The select is controlled at "", so it snaps back on its own.
            const value = e.target.value;
            if (!value) return;
            if (value === "__edit") {
              setEditing(deck.id);
              setEditDraft({
                founder: deck.founder ?? "",
                founderPhone: deck.founderPhone ?? "",
                founderEmail: deck.founderEmail ?? "",
                city: deck.city ?? "",
              });
              return;
            }
            if (value === "__assign") {
              // Guarded navigation. The guard is also on the option itself, so
              // this branch is unreachable from the UI — it is here because a
              // disabled option is a presentation fact and the rule is not.
              if (toAssign.ok) navigate("/app/assign", { state: { deckIds: [deck.id] } });
              return;
            }
            if (value === "__query") {
              // The same shape, the other arm of the partition. `QueryPage`
              // resolves the handed id against `?list=query` before ticking
              // anything, so this carries a suggestion, not an instruction.
              if (toQuery.ok) navigate("/app/query", { state: { deckIds: [deck.id] } });
              return;
            }
            const action = actions.find((a) => a.action === value) ?? (value === "archive" ? archive : undefined);
            if (action) void runRowAction(deck, action);
          }}
        >
          <option value="">Actions ▾</option>
          <option value="__assign" disabled={!toAssign.ok}>
            {toAssign.ok ? "Send to Assign" : `Send to Assign — ${toAssign.reason}`}
          </option>
          <option value="__query" disabled={!toQuery.ok}>
            {toQuery.ok ? "Send to Query" : `Send to Query — ${toQuery.reason}`}
          </option>
          {actions.map((a) => (
            <option key={a.action} value={a.action}>
              {a.label}
            </option>
          ))}
          {withEdit && <option value="__edit">Edit</option>}
          <option value="archive" disabled={!archive}>
            {archive ? archive.label : "Archive — only from Rejected"}
          </option>
        </select>
      </td>
    );
  }

  /** The name cell plus the prototype's `recLbl()` — "· 2h ago". */
  function v3NameCell(deck: DeckView) {
    const meta = deckMeta(deck);
    const clock = deck.lastActivityAt ? relativeTime(deck.lastActivityAt) : null;
    return (
      <td className={td}>
        <StartupNameLink deck={deck} onOpen={setSelected} />
        <div className="mt-px text-[10px] text-fg-muted">
          {meta}
          {clock && (
            <span>
              {meta ? " · " : ""}
              <Clock className="inline h-2.5 w-2.5 -translate-y-px" aria-hidden="true" /> {clock}
            </span>
          )}
        </div>
        {/* Aug-2026 issue 2's tag chips stay: item 19 names exactly what the
            collapse drops (Sector, Assigned to / date, Due date, Jury score,
            the sparkline) and tags are not on that list. */}
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

  function renderRow(deck: DeckView, index: number) {
    const evs = events[deck.id] ?? undefined;
    const evLoading = events[deck.id] === null;
    const votes = icVotes[deck.id];
    const myVote = votes ? votes.myVote : undefined;
    switch (shape) {
      // ── VC staff ──
      case "vcUploaded": {
        const pill = vcStagePill(deck);
        return (
          <>
            {startupCell(deck)}
            <td className={td}>{deck.sector ?? "—"}</td>
            <td className={dim}>{deck.city ?? "—"}</td>
            <td className={td}>
              <ScoreChip value={deck.aiScore} />
            </td>
            <td className={td}>
              <span title={deck.status}>
                <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
              </span>
            </td>
            <td className={dim}>{shortDate(deck.uploadedAt)}</td>
          </>
        );
      }
      case "vcIncomplete":
        return (
          <>
            {startupCell(deck, { stage: true })}
            {captured(deck.founder)}
            {captured(deck.founderEmail)}
            {captured(deck.founderPhone)}
            {captured(deck.city)}
            <td className={td}>
              <IntakeStatusPill deck={deck} />
            </td>
          </>
        );
      case "vcEvaluated":
        return (
          <>
            {startupCell(deck)}
            <td className={td}>
              <ScoreChip value={deck.aiScore} />
            </td>
            {sparkCell(deck)}
          </>
        );
      case "vcDiligence": {
        // Investment DD is approved once the deal moves on to IC; while it is
        // open nothing records per-item progress yet (W9-C's checklist, §9).
        const approved = vcReached(deck.statusId, "ic_review");
        return (
          <>
            {startupCell(deck)}
            <td className={td}>{deck.sector ?? "—"}</td>
            <td className={td}>
              <ScoreChip value={deck.aiScore} />
            </td>
            <td className={td}>
              {approved ? (
                <div className="flex items-center gap-2" title="Investment DD approved for IC">
                  <div className="h-2 min-w-[80px] flex-1 overflow-hidden rounded-[5px] bg-offwhite">
                    <div className="h-full w-full bg-olive" />
                  </div>
                  <span className="font-mono text-[11px] font-semibold text-navy">100%</span>
                </div>
              ) : (
                <span className="text-[11px] text-fg-muted" title="Per-item diligence progress is not recorded yet">
                  In progress
                </span>
              )}
            </td>
            <td className={dim} title="Diligence flags are not recorded yet">
              —
            </td>
            {whoCell(sponsorOf(evs), evLoading)}
          </>
        );
      }
      case "vcIcReady": {
        const rec = votes ? votes.recommendation : null;
        return (
          <>
            {startupCell(deck)}
            <td className={td}>
              <ScoreChip value={deck.aiScore} />
            </td>
            <td className={td}>
              <ScoreChip value={deck.decisionScore} />
            </td>
            {notRecorded}
            {notRecorded}
            {!canReadIcVotes ? (
              <td className={dim} title="Committee ballots are confidential to the committee">
                —
              </td>
            ) : votes === null ? (
              <td className={dim}>…</td>
            ) : rec ? (
              chipCell([IC_VOTE_LABELS[rec], VOTE_TONE[rec]], `${votes ? votes.total : 0} IC vote(s)`)
            ) : (
              chipCell(["No votes yet", "none"])
            )}
          </>
        );
      }
      case "vcOnboard": {
        const chips = vcOnboardChips(deck);
        return (
          <>
            {startupCell(deck)}
            <td className={td}>
              <ScoreChip value={deck.aiScore} />
            </td>
            {chipCell(chips.termSheet)}
            {chipCell(chips.legal)}
            {chipCell(chips.onboarding)}
          </>
        );
      }
      // ── VC IC member ──
      case "icAtIc": {
        const cells = icStageCells(deck, myVote);
        return (
          <>
            {startupCell(deck)}
            <td className={td}>{deck.sector ?? "—"}</td>
            <td className={td}>
              <ScoreChip value={deck.aiScore} />
            </td>
            {chipCell(cells.stage)}
            {votes === null ? <td className={dim}>…</td> : chipCell(cells.mine)}
          </>
        );
      }
      case "icMyVote":
        return (
          <>
            {startupCell(deck)}
            <td className={td}>{deck.sector ?? "—"}</td>
            <td className={td}>
              <ScoreChip value={deck.aiScore} />
            </td>
            <td className={td}>
              {/* The human composite the committee is weighing (§8). */}
              <ScoreChip value={deck.juryScore} />
            </td>
            {notRecorded}
            {chipCell(["Vote pending", "hold"])}
          </>
        );
      case "icMyEval": {
        const my = myEvals[deck.id];
        return (
          <>
            {startupCell(deck)}
            <td className={td}>
              <ScoreChip value={deck.aiScore} />
            </td>
            <td className={td}>
              <ScoreChip value={my?.total} />
            </td>
            {myVote ? chipCell([IC_VOTE_LABELS[myVote], VOTE_TONE[myVote]]) : <td className={dim}>—</td>}
            {chipCell(icOutcome(deck))}
          </>
        );
      }
      case "icAgenda":
        return (
          <>
            <td className={`${dim} font-mono`}>{index + 1}</td>
            {startupCell(deck)}
            <td className={td}>{deck.sector ?? "—"}</td>
            <td className={td}>
              <ScoreChip value={deck.aiScore} />
            </td>
            {whoCell(sponsorOf(evs), evLoading)}
            {notRecorded}
          </>
        );
      case "icPipeline":
        return (
          <>
            {startupCell(deck)}
            <td className={dim}>{evLoading ? "…" : shortDate(eventAt(evs, "invest"))}</td>
            {chipCell([deck.status ?? deck.statusId ?? "—", deck.statusId === "legal_dd" ? "hold" : "info"])}
            <td className={dim} title="Nothing records a stalled deal yet">
              —
            </td>
            {notRecorded}
            {whoCell(sponsorOf(evs), evLoading)}
          </>
        );
      case "icFunded":
        return (
          <>
            {startupCell(deck)}
            {notRecorded}
            {deck.stage ? chipCell([deck.stage, "info"]) : <td className={dim}>—</td>}
            <td className={dim}>{evLoading ? "…" : shortDate(eventAt(evs, "complete_legal_dd"))}</td>
            {notRecorded}
          </>
        );
      // ── Incubator · V3 superuser Dashboard ──
      case "v3Default": {
        // S1-DASH item 3 — one word, four possible values, derived from
        // (ai_complete, missing_fields). The red "Incomplete details" chip this
        // replaced existed only because the three-word vocabulary could not say
        // "contact details"; it can now, so the chip is gone rather than
        // doubled up beside it.
        const status = v3StatusKey(deck);
        const hint = V3_STATUS_HINTS[status];
        const isEditing = editing === deck.id;
        const cell = (f: (typeof V3_EDIT_FIELDS)[number]) => {
          const value = f.read(deck);
          return isEditing ? (
            <td key={f.name} className={td}>
              <input
                className="sj-input h-[27px] w-full py-0 text-[11px]"
                aria-label={`${f.label} — ${deck.name}`}
                value={editDraft[f.name] ?? ""}
                onChange={(e) => setEditDraft((dr) => ({ ...dr, [f.name]: e.target.value }))}
              />
            </td>
          ) : (
            <td key={f.name} className={td}>
              {value ? value : <NotCaptured />}
            </td>
          );
        };
        return (
          <>
            {v3NameCell(deck)}
            {V3_EDIT_FIELDS.map(cell)}
            <td className={td}>
              <ScoreChip value={deck.aiScore} />
            </td>
            <td className={td}>
              <span data-testid="v3-status" title={hint}>
                <StatusPill tone={V3_STATUS_TONES[status]}>{V3_STATUS_LABELS[status]}</StatusPill>
              </span>
              {/* ── Item 6 · the post-action statuses ───────────────────────
                  Measured rather than rebuilt: Queried and Archived already
                  shipped, **Assigned did not** — a deck sent to Assign and
                  given an evaluator reads "AI Evaluated" and nothing else,
                  because `assigned` is one of POST_AI_STAGES. Same predicate
                  as the Assigned tile, so chip and count cannot disagree. */}
              {matchesV3Stat(deck, "assigned") && (
                <span className="ml-1.5 inline-block rounded-full bg-blue-lt px-[7px] py-px text-[9px] font-bold text-blue-dk">
                  Assigned
                </span>
              )}
              {deck.queried && (
                <span className="ml-1.5 inline-block rounded-full bg-blue-lt px-[7px] py-px text-[9px] font-bold text-blue-dk">
                  Queried
                </span>
              )}
              {/* The fourth post-action word. It had no source until the PATCH
                  handler began recording an `edit_contact` event — the row
                  simply never said an edit had happened. */}
              {deck.contactEditedAt && (
                <span className="ml-1.5 inline-block rounded-full bg-blue-lt px-[7px] py-px text-[9px] font-bold text-blue-dk">
                  Contact Details Edited
                </span>
              )}
              {isArchivedDeck(deck) && (
                <span className="ml-1.5 inline-block rounded-full bg-surface-2 px-[7px] py-px text-[9px] font-bold text-fg-muted">
                  Archived
                </span>
              )}
            </td>
            {v3ActionCell(deck, true)}
          </>
        );
      }
      case "v3Shortlisted":
        return (
          <>
            {v3NameCell(deck)}
            <td className={td}>
              <ScoreChip value={deck.aiScore} />
            </td>
            <td className={td}>
              <ScoreNumber value={deck.decisionScore} best={best} mediocre={mediocre} />
            </td>
            <td className={dim}>{signupCellLabel(deck, signups[deck.id])}</td>
            {/* The prototype's Shortlisted select omits `Edit`. */}
            {v3ActionCell(deck, false)}
          </>
        );
      // ── Incubator ──
      case "details":
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
        {/* Every box but the first ("Uploaded" / "At IC"), which is the denominator. */}
        {(isJury ? tiles : pipelineProgress(tiles)).map((p) => {
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
        className={`grid grid-cols-2 gap-3 sm:grid-cols-3 ${
          isJury ? "xl:grid-cols-5" : tiles.length === 7 ? "xl:grid-cols-7" : "xl:grid-cols-6"
        }`}
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

      {rowError && (
        <p role="status" className="mt-3 text-[11px] text-signal-flagged">
          {rowError}
        </p>
      )}

      <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface">
        {workspaceEmpty ? (
          <div className="p-6">
            <EmptyState
              icon={isJury ? "ClipboardCheck" : isIc ? "Vote" : "Upload"}
              title={
                isJury
                  ? "No decks have been assigned to you yet"
                  : isIc
                    ? "No deals have reached the committee yet"
                    : "No decks yet"
              }
              description={
                isJury
                  ? "Decks appear here as soon as they are allocated to you for evaluation."
                  : isIc
                    ? "Deals appear here once a partner sponsors them and diligence is approved for IC."
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
                rows.map((deck, i) => (
                  <tr key={deck.id} className="border-b border-line-soft last:border-b-0 hover:bg-offwhite">
                    {renderRow(deck, i)}
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
            evaluateSlug &&
            (edition === "vc" ? VC_SCORING_STAGES : JURY_STAGES).includes(selected.statusId ?? "") &&
            !isIc ? (
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
