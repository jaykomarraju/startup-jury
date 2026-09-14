import { useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Armchair, Download, FileBarChart, Lock, Signature, TriangleAlert } from "lucide-react";
import { AuthContext } from "../auth/AuthProvider";
import type { Role } from "../../shared/roles";
import {
  Card,
  Button,
  Badge,
  SignalTag,
  EvaluationDrawer,
  EvaluationReportModal,
  EmptyState,
  PageToolbar,
  ToolbarButton,
  type ParamScoreView,
  type ExtractionSlide,
} from "../components";
import type { DeckView, DeckAction } from "../types";
import { exportDecks } from "../exportCsv";
import {
  listDecks,
  getDeck,
  getDeckEvents,
  transitionDeck,
  ApiError,
  sendSignup,
  updateDeckOnboarding,
  type DeckVersionView,
  type PipelineEvent,
} from "../api";
import {
  SignupWorkspace,
  SIGNUP_STATUS_LABELS,
  listSignups,
  type SignupSummary,
  type WorkspaceTab,
} from "./SignupWorkspace";
import {
  AllScores,
  BandScore,
  builtinTab,
  DeckSlides,
  DetailPane,
  FilterMenu,
  legendFor,
  LegendPill,
  StageFooter,
  usePaneEvaluation,
  type FilterOption,
  type LegendItem,
  type PaneTab,
  type PaneTabId,
} from "./StageKit";
import {
  ARCHIVE_REASON_LABELS,
  ArchiveReasonCell,
  ChecklistTab,
  ClearedCell,
  CurationActionCell,
  DdStatusCell,
  DiligenceProgressCell,
  FlagsPill,
  InvestReadyStageCell,
  InvestReadyStatusCell,
  MpApprovalCell,
  OpenTabButton,
  ProgressBar,
  ScheduleCallCell,
  SignupRecordTab,
  StageChip,
  TermSheetDocCell,
  TermSheetStatusCell,
  TermSheetTab,
  archiveReason,
  checklistIcon,
  dealOf,
  investReadyOwner,
  loadDeals,
  signupIcon,
  type ArchiveReason,
} from "./VcDiligence";
import { investReadyStatus, isComplete, legendKeyOf, type DiligenceTrack } from "../../shared/diligence";

/** Columns a stage screen can show. The design gives each screen its own set
 *  (Aug-2026 issues 25–31), so they are named here and composed per config. */
export type StageColumn =
  | "startup"
  | "founder"
  | "sector"
  | "cohort"
  | "evaluators"
  | "ai"
  | "jury"
  | "avg"
  | "addl"
  | "assignedDate"
  | "callScheduled"
  | "callDate"
  | "callCompleted"
  | "signupStatus"
  | "paymentStatus"
  | "documentsStatus"
  | "curationStage"
  | "lead"
  | "progress"
  | "reason"
  | "stageReached"
  | "archivedOn"
  | "archivedBy"
  | "status"
  // W9-B — `jpRowAssoc`'s date and destination cells, and the Action column placed
  // explicitly (it is appended after the last column when `columns` omits it).
  | "submittedDate"
  | "submitTo"
  | "action";

/** One table row as a filter, footer or custom tab sees it. */
export interface StageRow {
  deck: DeckView;
  /** The sign-up record behind the row, on screens that load them. */
  signup?: SignupSummary;
  /** W9-B — on a `keepDecided` screen, the event by which this screen decided the deck. */
  decided?: PipelineEvent;
  /** W9-C — whatever the config's `extra` loader returned for this deck. */
  extra?: unknown;
}

/** W9-B — a row's Status pill (`key` is what the legend decodes) and its submission. */
export interface StageRowStatus {
  key: string;
  label: string;
  /** When the deck was submitted on — the Submitted date column. */
  submittedAt?: string;
  /** Where it was submitted to — the Submit to column. */
  submitTo?: string;
}

/**
 * W9-C — what a config-declared cell or tab may do to the screen around it:
 * refresh the rows after a write, open the row's slide-over on a tab or the
 * report on a tab, run one of the deck's transitions, and surface a failure in
 * the screen's own error strip.
 */
export interface StageContext {
  role?: Role;
  busy: boolean;
  reload: () => Promise<void>;
  openTab: (deck: DeckView, tab: string) => void;
  openReport: (deck: DeckView, tab: "core" | "additional") => void;
  runAction: (deck: DeckView, action: DeckAction) => Promise<void>;
  fail: (message: string) => void;
}

/**
 * W9-C — a column the renderer does not know by name: its header and its cell,
 * declared by the screen. The same `{ id, label, render }` shape a custom
 * `subTabs` entry has, for the same reason — a VC diligence column is a
 * declaration, not a new case in a shared switch.
 */
export interface StageCustomColumn {
  id: string;
  label: string;
  render: (row: StageRow, ctx: StageContext) => ReactNode;
}

/**
 * W7-F — the toolbar strip's right-hand actions (`.tbr`). The prototype gives
 * every stage screen `Filter` + `Export`; a screen declares which it has.
 */
export interface StageToolbar {
  /** `Filter` — a single-choice menu; each option narrows the table. */
  filters?: FilterOption<StageRow>[];
  /** `Export` — CSV of the rows currently shown. */
  export?: boolean;
}

/**
 * W7-F — one tab of the row's slide-over. The built-ins are the prototype's
 * `Deck`, `All scores` and `Sign-up` (`su-stabs` / `nc-stabs`); a screen with a
 * tab of its own (a DD checklist, a term-sheet record) passes `render`.
 */
export type StageSubTab =
  | PaneTabId
  | { id: string; label: string; render: (row: StageRow, ctx: StageContext) => ReactNode };

export interface StageConfig {
  title: string;
  subtitle: string;
  /** Raw stage ids this screen shows. */
  statuses: string[];
  /** Narrow `statuses` further (e.g. only the jury's rejections, not the AI gate's). */
  include?: (deck: DeckView) => boolean;
  /** Empty-state copy when no deck matches. */
  emptyTitle?: string;
  emptyDescription?: string;
  /** Second column label + field (legacy shorthand, still honoured). */
  secondary?: { label: string; field: "founder" | "sector" };
  /** Hide the Action column (read-only screens). */
  readOnly?: boolean;
  /** The exact columns, in order. Defaults to the pre-Aug-2026 layout. A
   *  `StageCustomColumn` draws its own header and cell (W9-C). */
  columns?: (StageColumn | StageCustomColumn)[];
  /** Per-screen header overrides ("Jury members & status" vs "Evaluators & status"). */
  labels?: Partial<Record<StageColumn, string>>;
  /** Minimum table width so wide layouts scroll rather than squash. */
  minWidth?: string;
  /** Optional inline fields captured for one action (e.g. term-sheet valuation /
   *  ownership on Issue term sheet), passed to the transition as extra body fields. */
  capture?: { action: string; fields: { name: "valuation" | "ownership"; label: string }[] };
  /** W7-F — Filter / Export. Omitted → the toolbar carries neither. */
  toolbar?: StageToolbar;
  /**
   * W7-F — the row slide-over's tabs. Declared → the startup name opens the
   * 382px pane beside the table on the first tab. Omitted → the name opens the
   * shared Evaluation drawer, as it always has.
   */
  subTabs?: StageSubTab[];
  /**
   * The colour legend, pinned in the footer beside `footer`'s sentence. An
   * entry with `statuses` also tints the matching Status / Sign-up status pill.
   */
  legend?: LegendItem[];
  /** W7-F — the footer's count sentence (`jpFoot` / `suFoot` / `cuFoot`), over every row in the stage. */
  footer?: (rows: StageRow[]) => string;
  /**
   * W6-A — rows open the §8.3 sign-up workspace (`openSuWork`): a "Sign-up"
   * action, the Documents column as a derived roll-up badge linking into it, and
   * the Sign-up status read from the sign-up record rather than the deck.
   */
  workspace?: boolean;
  /**
   * W9-B — decided rows stay on the screen with their outcome (F0627; the reading
   * agreed with `W9-E` in §9). A deck now in one of these stages is kept when its
   * latest pipeline event FROM `statuses` went to a stage OUTSIDE them. That event
   * is the row's `decided`, and a decided row offers no transitions (the deck's
   * actions belong to the stage it is in now). A deck back inside `statuses` is
   * active again. Omitted → the screen lists `statuses` only and reads no events.
   */
  keepDecided?: string[];
  /** W9-B — the Status pill's words and legend key. Omitted → the stage label, keyed by stage id. */
  rowStatus?: (row: StageRow) => StageRowStatus;
  /**
   * W9-B — the Action column as the prototype's one `Action ▾` select
   * (`jpActionSelect`): `View deck` (the one-tab Pitch deck pane) and then the
   * row's transitions, relabelled by `labels`. Omitted → a button per transition.
   */
  actionMenu?: { labels?: Record<string, string> };
  /**
   * W9-C — a per-deck record the screen reads beside the deck list (the VC
   * diligence record), loaded and refreshed with it and handed to every row as
   * `row.extra`. Omitted → nothing extra is fetched.
   */
  extra?: () => Promise<Record<string, unknown>>;
  /**
   * W9-C — the same slug drawn differently for one role (the IC member's
   * "Invest ready" on `curation`). Keys present override the base config for a
   * caller of that role. Omitted, or no entry for the role → the base config.
   */
  roleVariants?: Partial<Record<Role, Partial<Omit<StageConfig, "roleVariants">>>>;
}

/** The `actionMenu` option that opens the deck rather than running a transition. */
const VIEW_DECK = "__view_deck";

const columnId = (c: StageColumn | StageCustomColumn) => (typeof c === "string" ? c : c.id);

// Actions handled by dedicated screens rather than inline buttons here.
const EXCLUDED_ACTIONS = new Set(["assign_jury"]);

const COLUMN_LABELS: Record<StageColumn, string> = {
  startup: "Startup",
  founder: "Founder",
  sector: "Sector",
  cohort: "Cohort",
  evaluators: "Evaluators & status",
  ai: "AI score",
  jury: "Jury score",
  avg: "Avg. score",
  addl: "Addl. Parameter scores",
  assignedDate: "Assigned date",
  callScheduled: "Call scheduled",
  callDate: "Call date",
  callCompleted: "Call completed",
  signupStatus: "Sign-up status",
  paymentStatus: "Payment status",
  documentsStatus: "Documents status",
  curationStage: "Curation stage",
  lead: "Jury member lead",
  progress: "Progress",
  reason: "Reason",
  stageReached: "Stage reached",
  archivedOn: "Archived on",
  archivedBy: "Archived by",
  status: "Status",
  submittedDate: "Submitted date",
  submitTo: "Submit to",
  action: "Action",
};

const PAYMENT_OPTIONS = [
  { value: "pending", label: "Payment pending" },
  { value: "partial", label: "Partially paid" },
  { value: "paid", label: "Paid" },
  { value: "waived", label: "Waived" },
];

/** The Documents column's roll-up labels. The value is DERIVED from the
 *  sign-up's document set (`rollUpDocumentsStatus`) — never hand-set (§9). */
const DOCUMENT_OPTIONS = [
  { value: "pending", label: "Docs missing", tone: "danger" as const },
  { value: "partial", label: "Docs partial", tone: "amber" as const },
  { value: "complete", label: "All docs", tone: "positive" as const },
];

function fmtDate(iso?: string): string {
  if (!iso) return "—";
  const ms = Date.parse(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  if (Number.isNaN(ms)) return iso;
  // "3 Jun 2026" — the prototype's date, whatever the browser's locale.
  return new Date(ms).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Human label for the action that took a deck out of the active pipeline. */
function exitReason(deck: DeckView): string {
  if (deck.exitNote) return deck.exitNote;
  switch (deck.exitAction) {
    case "reject":
      return "Rejected after evaluation";
    case "reject_ai_gate":
      return "Below the AI gate";
    case "pass":
      return "Passed";
    case "archive":
      return "Archived";
    default:
      return deck.status ?? "—";
  }
}

/** The sign-up statuses after which the seat question is live (`suSignupBody`). */
const SEAT_STATUSES = ["completed", "onboarded", "archived"];

/** The row's sign-up status in the prototype's words (`suSignupLabel`), falling
 *  back to the deck's own stage before a sign-up record exists. */
function signupStatusLabel(deck: DeckView, signup?: SignupSummary): string {
  if (signup) return SIGNUP_STATUS_LABELS[signup.status] ?? signup.status;
  switch (deck.statusId) {
    case "shortlisted":
    case "intro":
      return "Shortlisted";
    case "rejected":
      return "Rejected";
    case "archived":
      return "Archived";
    case "onboard_ready":
      return "Onboarded";
    default:
      return deck.status ?? "—";
  }
}

/** The key a legend entry's `statuses` is matched against for a row. */
function signupStatusKey(deck: DeckView, signup?: SignupSummary): string | undefined {
  if (signup) return signup.status;
  return deck.statusId === "intro" ? "shortlisted" : deck.statusId;
}

function resolveTab(tab: StageSubTab): PaneTab {
  return typeof tab === "string" ? builtinTab(tab) : { id: tab.id, label: tab.label };
}

/**
 * Generic pipeline-stage screen: a deck table filtered to a set of stages with
 * inline role-gated transition buttons and the shared Evaluation drawer.
 *
 * Aug-2026 issues 25–31 made each screen's columns match its design, so the
 * table is now column-driven (`config.columns`) rather than one fixed layout,
 * and the sign-up / curation state on issues 29 and 30 is editable in place.
 *
 * W7-F put it in the prototype's frame (`.tb` toolbar strip, scrolling body,
 * pinned `.tb-foot`) and let a config declare the three things the stage panels
 * add on top of a table — `toolbar`, `subTabs` and `legend` + `footer` — so a
 * screen reaches parity by declaring them rather than by becoming bespoke.
 */
export function StagePage({ config: base }: { config: StageConfig }) {
  const role = useContext(AuthContext)?.user?.role;
  const config = useMemo<StageConfig>(() => {
    const variant = role ? base.roleVariants?.[role] : undefined;
    return variant ? { ...base, ...variant } : base;
  }, [base, role]);
  const [decks, setDecks] = useState<DeckView[] | null>(null);
  const [selected, setSelected] = useState<DeckView | null>(null);
  // Aug-2026 issues 23/24 — the report opens on the Core Parameters tab from a
  // score cell, and on the Addl. parameters tab from the "View scores" column.
  const [reportFor, setReportFor] = useState<{ deck: DeckView; tab: "core" | "additional" } | null>(
    null,
  );
  const [report, setReport] = useState<{
    scores: ParamScoreView[];
    extraction: ExtractionSlide[];
    verdict?: string;
    versions?: DeckVersionView[];
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Per-deck captured fields for the config's capture action (term-sheet details).
  const [captured, setCaptured] = useState<Record<string, { valuation?: string; ownership?: string }>>({});
  // W6-A — the sign-up records behind these rows, and the one open in the workspace.
  const [signups, setSignups] = useState<Record<string, SignupSummary>>({});
  const [workspace, setWorkspace] = useState<{ signupId: string; tab: WorkspaceTab } | null>(null);
  // W7-F — the toolbar filter and the row slide-over.
  const [filterId, setFilterId] = useState<string | null>(null);
  const [pane, setPane] = useState<{ deckId: string; tab: string } | null>(null);
  // W9-C — the config's per-deck record (`extra`).
  const [extras, setExtras] = useState<Record<string, unknown>>({});

  const secondary = config.secondary ?? { label: "Founder", field: "founder" as const };
  const columns: (StageColumn | StageCustomColumn)[] =
    config.columns ?? ["startup", secondary.field, "ai", "avg", "status"];
  const subTabs = config.subTabs ?? [];
  const wantsSignups =
    !!config.workspace ||
    columns.includes("signupStatus") ||
    columns.includes("documentsStatus") ||
    subTabs.includes("signup");

  // App renders one StagePage for every stage slug, so moving between two stage
  // screens keeps this instance: a filter or an open pane must not follow.
  useEffect(() => {
    setFilterId(null);
    setPane(null);
    setSelected(null);
  }, [config]);

  const loadSignups = useCallback(() => {
    if (!wantsSignups) return Promise.resolve();
    return listSignups()
      .then((r) => setSignups(Object.fromEntries(r.signups.map((s) => [s.deckId, s]))))
      .catch(() => setSignups({}));
  }, [wantsSignups]);

  const loadExtra = config.extra;
  const load = useCallback(() => {
    return Promise.all([
      listDecks()
        .then((r) => setDecks(r.decks))
        .catch(() => setDecks([])),
      loadSignups(),
      loadExtra ? loadExtra().then(setExtras, () => setExtras({})) : Promise.resolve(),
    ]).then(() => undefined);
  }, [loadSignups, loadExtra]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!selected) {
      setReport(null);
      return;
    }
    let live = true;
    getDeck(selected.id)
      .then((r) => live && setReport({ scores: r.scores, extraction: r.extraction, verdict: r.verdict, versions: r.versions }))
      .catch(() => live && setReport({ scores: [], extraction: [] }));
    return () => {
      live = false;
    };
  }, [selected]);

  // W9-B — the deciding event per candidate deck on a `keepDecided` screen,
  // tagged with the stage set it was read for so a neighbouring screen's
  // decisions never show while this one's are loading.
  const [decisions, setDecisions] = useState<{ stages: string; events: Record<string, PipelineEvent> }>({
    stages: "",
    events: {},
  });
  const stagesKey = config.statuses.join("|");
  const candidateKey = useMemo(
    () =>
      config.keepDecided
        ? (decks ?? [])
            .filter((d) => d.statusId && config.keepDecided!.includes(d.statusId) && !config.statuses.includes(d.statusId))
            .map((d) => d.id)
            .join(",")
        : "",
    [decks, config],
  );

  useEffect(() => {
    if (!candidateKey) return;
    let live = true;
    const inStage = (stage: string | null) => !!stage && config.statuses.includes(stage);
    Promise.all(
      candidateKey.split(",").map((id) =>
        getDeckEvents(id)
          // Newest first, so the first match is the latest decision.
          .then((r) => [id, r.events.find((e) => inStage(e.fromStage) && !inStage(e.toStage))] as const)
          .catch(() => [id, undefined] as const),
      ),
    ).then((pairs) => {
      if (!live) return;
      const events: Record<string, PipelineEvent> = {};
      for (const [id, event] of pairs) if (event) events[id] = event;
      setDecisions({ stages: stagesKey, events });
    });
    return () => {
      live = false;
    };
    // `config.statuses` is read through `stagesKey`, so a new config object with
    // the same stages does not refetch.
  }, [candidateKey, stagesKey]);

  /** Every row in the stage — what the footer counts. */
  const stageRows = useMemo<StageRow[]>(() => {
    const decided = candidateKey && decisions.stages === stagesKey ? decisions.events : {};
    return (decks ?? []).flatMap((deck): StageRow[] => {
      const id = deck.statusId;
      if (!id) return [];
      if (config.statuses.includes(id)) {
        return !config.include || config.include(deck)
          ? [{ deck, signup: signups[deck.id], extra: extras[deck.id] }]
          : [];
      }
      return config.keepDecided?.includes(id) && decided[deck.id]
        ? [{ deck, signup: signups[deck.id], extra: extras[deck.id], decided: decided[deck.id] }]
        : [];
    });
  }, [decks, signups, extras, config, candidateKey, decisions, stagesKey]);

  const activeFilter = config.toolbar?.filters?.find((f) => f.id === filterId);
  /** The rows on screen — what the table draws and Export writes. */
  const shown = useMemo(
    () => (activeFilter ? stageRows.filter(activeFilter.match) : stageRows),
    [stageRows, activeFilter],
  );
  const rows = useMemo(() => shown.map((r) => r.deck), [shown]);
  // W9-B — `actionMenu`'s View deck opens the Pitch deck pane on a screen that
  // declares no tabs; with tabs declared it opens those, on Deck if present.
  const paneTabs: StageSubTab[] = subTabs.length > 0 ? subTabs : ["deck"];

  const paneRow = pane ? stageRows.find((r) => r.deck.id === pane.deckId) : undefined;
  const paneEval = usePaneEvaluation(paneRow ? paneRow.deck.id : null);

  async function runAction(deck: DeckView, action: DeckAction) {
    setBusy(`${deck.id}:${action.action}`);
    setError(null);
    try {
      if (action.action === "send_signup") await sendSignup(deck.id);
      else {
        const extra = config.capture?.action === action.action ? captured[deck.id] : undefined;
        await transitionDeck(deck.id, action.action, undefined, extra);
      }
      await load();
    } catch (err) {
      // The per-program shortlist floor (Session 5) refuses with an evaluator-
      // facing message; anything else gets the generic retry copy.
      if (err instanceof ApiError && err.code === "below_shortlist_minimum") {
        setError(err.message);
        await load();
      } else {
        setError(`Couldn't ${action.label.toLowerCase()}. Try again.`);
      }
    } finally {
      setBusy(null);
    }
  }

  /** Issues 29/30 — record sign-up / curation state inline. */
  async function saveOnboarding(deck: DeckView, patch: Parameters<typeof updateDeckOnboarding>[1]) {
    setBusy(`${deck.id}:onboarding`);
    setError(null);
    try {
      const res = await updateDeckOnboarding(deck.id, patch);
      if (res.deck) {
        const next = res.deck;
        setDecks((list) => (list ?? []).map((d) => (d.id === next.id ? next : d)));
      }
    } catch {
      setError("Couldn't save that change. Try again.");
    } finally {
      setBusy(null);
    }
  }

  /** The seat card's Allocate seat (`suAllocSeat`) — `POST /api/signups/:id/seat`. */
  async function allocateSeat(signup: SignupSummary) {
    setBusy(`${signup.signupId}:seat`);
    setError(null);
    try {
      const res = await fetch(`/api/signups/${signup.signupId}/seat`, { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      await load();
    } catch {
      setError(`Couldn't allocate a seat to ${signup.startup}. Try again.`);
    } finally {
      setBusy(null);
    }
  }

  function openStartup(deck: DeckView) {
    if (subTabs.length > 0) setPane({ deckId: deck.id, tab: resolveTab(subTabs[0]).id });
    else setSelected(deck);
  }

  /** W9-C — what a declared cell or tab may do to the screen. */
  const ctx: StageContext = {
    role,
    busy: busy !== null,
    reload: load,
    openTab: (deck, tab) => setPane({ deckId: deck.id, tab }),
    openReport: (deck, tab) => setReportFor({ deck, tab }),
    runAction,
    fail: setError,
  };

  function header(col: StageColumn | StageCustomColumn): string {
    if (typeof col !== "string") return col.label;
    const c = col;
    if (config.labels?.[c]) return config.labels[c]!;
    return c === "founder" && config.secondary ? config.secondary.label : COLUMN_LABELS[c];
  }

  function cell(column: StageColumn | StageCustomColumn, row: StageRow): ReactNode {
    // W9-C — a column the renderer does not know by name draws itself.
    if (typeof column !== "string") return column.render(row, ctx);
    const deck = row.deck;
    switch (column) {
      case "startup":
        return (
          <>
            <button
              type="button"
              className="text-left font-medium text-fg hover:underline"
              aria-expanded={subTabs.length > 0 ? pane?.deckId === deck.id : undefined}
              onClick={() => openStartup(deck)}
            >
              {deck.name}
            </button>
            <div className="mt-0.5 text-xs text-fg-muted">
              {[deck.sector, deck.stage, deck.city].filter(Boolean).join(" · ")}
            </div>
          </>
        );
      case "founder":
        return <span className="text-sm text-fg-muted">{deck.founder ?? "—"}</span>;
      case "sector":
        return <span className="text-sm text-fg-muted">{deck.sector ?? "—"}</span>;
      case "cohort":
        return (
          <span className="text-sm text-fg-muted">
            {[deck.programName, deck.cohortName].filter(Boolean).join(" · ") || "—"}
          </span>
        );
      case "evaluators":
        return deck.assignedToName ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-fg">{deck.assignedToName}</span>
            <Badge tone={deck.assigneeSubmitted ? "positive" : "amber"}>
              {deck.assigneeSubmitted ? "Submitted" : "Pending"}
            </Badge>
          </div>
        ) : (
          <span className="text-sm text-fg-muted">Unassigned</span>
        );
      // Issue 23 — every score cell opens the report on its Core Parameters tab.
      // The colour is the prototype's band (`jpColor`): ≥8 green, ≥6 olive, else amber.
      case "ai":
        return (
          <button
            type="button"
            title="Open the core parameter report"
            className="underline-offset-2 hover:underline"
            onClick={() => setReportFor({ deck, tab: "core" })}
          >
            <BandScore value={deck.aiScore} suffix="/10" />
          </button>
        );
      case "jury":
        return (
          <button
            type="button"
            title="Open the core parameter report"
            className="underline-offset-2 hover:underline"
            onClick={() => setReportFor({ deck, tab: "core" })}
          >
            <BandScore value={deck.juryScore} />
          </button>
        );
      case "avg":
        return (
          <button
            type="button"
            title="Open the core parameter report"
            className="underline-offset-2 hover:underline"
            onClick={() => setReportFor({ deck, tab: "core" })}
          >
            <BandScore value={deck.decisionScore} />
          </button>
        );
      case "addl":
        // Issue 24 — the per-role additional-parameter matrix.
        return (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setReportFor({ deck, tab: "additional" })}
          >
            <FileBarChart className="mr-1 h-3.5 w-3.5" /> View scores
          </Button>
        );
      case "assignedDate":
        return <span className="text-sm text-fg-muted">{fmtDate(deck.assignedAt)}</span>;
      case "callScheduled":
        return (
          <Badge tone={deck.callScheduledAt ? "info" : "neutral"}>
            {deck.callScheduledAt ? "Scheduled" : "Not scheduled"}
          </Badge>
        );
      case "callDate":
        return <span className="text-sm text-fg-muted">{fmtDate(deck.callScheduledAt)}</span>;
      case "callCompleted":
        // `su-pill done` / `wait` / `no` — Completed, Not yet (scheduled), or a dash.
        return deck.callStatus === "completed" ? (
          <Badge tone="positive">Completed</Badge>
        ) : deck.callScheduledAt ? (
          <Badge tone="amber">Not yet</Badge>
        ) : (
          <span className="text-sm text-fg-muted">—</span>
        );
      case "signupStatus": {
        const signup = signups[deck.id];
        const key = signupStatusKey(deck, signup);
        return (
          <LegendPill item={legendFor(config.legend, key) ?? legendFor(SIGNUP_LIFECYCLE, key)}>
            {signupStatusLabel(deck, signup)}
          </LegendPill>
        );
      }
      case "paymentStatus":
        return config.readOnly ? (
          <span className="text-sm text-fg-muted">
            {PAYMENT_OPTIONS.find((o) => o.value === (deck.paymentStatus ?? "pending"))?.label}
          </span>
        ) : (
          <select
            className="sj-input h-8 py-0 text-xs"
            aria-label={`Payment status for ${deck.name}`}
            value={deck.paymentStatus ?? "pending"}
            disabled={busy !== null}
            onChange={(e) => saveOnboarding(deck, { paymentStatus: e.target.value })}
          >
            {PAYMENT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        );
      case "documentsStatus": {
        // Read-only: the roll-up is re-derived from the item rows on every
        // move, so a hand-set "All docs" over three awaiting items is no longer
        // possible. The badge opens the set it summarises.
        const signup = signups[deck.id];
        const option = documentsOption(deck, signup);
        return signup ? (
          <button
            type="button"
            title="Open the document set"
            aria-label={`Documents status for ${deck.name}: ${option.label}`}
            onClick={() => setWorkspace({ signupId: signup.signupId, tab: "docs" })}
          >
            <Badge tone={option.tone}>{option.label}</Badge>
          </button>
        ) : (
          <Badge tone={option.tone}>{option.label}</Badge>
        );
      }
      case "curationStage":
        return (
          <input
            className="sj-input h-8 w-36 py-0 text-xs"
            aria-label={`Curation stage for ${deck.name}`}
            defaultValue={deck.curationStage ?? ""}
            placeholder="e.g. Orientation"
            disabled={busy !== null}
            onBlur={(e) => {
              if (e.target.value !== (deck.curationStage ?? "")) {
                saveOnboarding(deck, { curationStage: e.target.value });
              }
            }}
          />
        );
      case "lead":
        return <span className="text-sm text-fg-muted">{deck.onboardingLead ?? "—"}</span>;
      case "progress": {
        const pct = deck.onboardingProgress ?? 0;
        return (
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
            </div>
            <input
              className="sj-input h-8 w-16 py-0 text-xs"
              type="number"
              min={0}
              max={100}
              aria-label={`Progress for ${deck.name}`}
              defaultValue={pct}
              disabled={busy !== null}
              onBlur={(e) => {
                const next = Number(e.target.value);
                if (Number.isFinite(next) && next !== pct) saveOnboarding(deck, { progress: next });
              }}
            />
          </div>
        );
      }
      case "reason":
        return <span className="text-sm text-fg-muted">{exitReason(deck)}</span>;
      case "stageReached":
        return <span className="text-sm text-fg-muted">{deck.exitFromLabel ?? "—"}</span>;
      case "archivedOn":
        return <span className="text-sm text-fg-muted">{fmtDate(deck.exitAt)}</span>;
      case "archivedBy":
        return <span className="text-sm text-fg-muted">{deck.exitBy ?? "—"}</span>;
      case "status": {
        const s = config.rowStatus?.(row);
        return s ? (
          <LegendPill item={legendFor(config.legend, s.key)}>{s.label}</LegendPill>
        ) : (
          <LegendPill item={legendFor(config.legend, deck.statusId)}>{deck.status ?? "—"}</LegendPill>
        );
      }
      case "submittedDate":
        return <span className="text-sm text-fg-muted">{fmtDate(config.rowStatus?.(row).submittedAt)}</span>;
      case "submitTo": {
        const to = config.rowStatus?.(row).submitTo;
        return to ? <span className="text-sm text-fg">{to}</span> : <span className="text-sm text-fg-muted">—</span>;
      }
      case "action":
        return actionCell(row);
    }
  }

  function actionCell(row: StageRow): ReactNode {
    const deck = row.deck;
    // The workspace replaces the unguarded "Complete signup" button:
    // a sign-up completes on the countersign, not on a click.
    // Any screen that reads the sign-up records (Prog manager pipeline
    // lists `signup` decks too) must not offer the bypass either.
    // A decided row offers nothing: its actions are the next stage's.
    const actions = row.decided
      ? []
      : (deck.actions ?? []).filter(
          (a) => !EXCLUDED_ACTIONS.has(a.action) && !(wantsSignups && a.action === "complete_signup"),
        );
    const signup = config.workspace ? signups[deck.id] : undefined;
    return (
      <>
        {config.capture && actions.some((a) => a.action === config.capture!.action) && (
          <div className="mb-2 flex justify-end gap-1.5">
            {config.capture.fields.map((f) => (
              <input
                key={f.name}
                className="sj-input h-8 w-24 py-0 text-xs"
                placeholder={f.label}
                aria-label={f.label}
                value={captured[deck.id]?.[f.name] ?? ""}
                onChange={(e) =>
                  setCaptured((cap) => ({
                    ...cap,
                    [deck.id]: { ...cap[deck.id], [f.name]: e.target.value },
                  }))
                }
              />
            ))}
          </div>
        )}
        {config.actionMenu ? (
          <div className="flex justify-end">
            <select
              className="sj-input h-8 w-auto py-0 text-xs"
              aria-label={`Action for ${deck.name}`}
              value=""
              disabled={busy !== null}
              onChange={(e) => {
                const value = e.target.value;
                if (value === VIEW_DECK) {
                  const tab = paneTabs.includes("deck") ? "deck" : resolveTab(paneTabs[0]).id;
                  setPane({ deckId: deck.id, tab });
                  return;
                }
                const action = actions.find((a) => a.action === value);
                if (action) void runAction(deck, action);
              }}
            >
              <option value="">{busy?.startsWith(`${deck.id}:`) ? "…" : "Action ▾"}</option>
              <option value={VIEW_DECK}>View deck</option>
              {actions.map((a) => (
                <option key={a.action} value={a.action}>
                  {config.actionMenu?.labels?.[a.action] ?? a.label}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="flex flex-wrap justify-end gap-2">
            {signup && (
              <Button
                size="sm"
                variant="secondary"
                title={signup.readOnly ? "Read-only — a Super user or Admin must assign you" : undefined}
                onClick={() => setWorkspace({ signupId: signup.signupId, tab: "agr" })}
              >
                {signup.readOnly ? <Lock className="mr-1 h-3.5 w-3.5" /> : <Signature className="mr-1 h-3.5 w-3.5" />}
                Sign-up
              </Button>
            )}
            {actions.length === 0 && !signup && <span className="text-xs text-fg-muted">—</span>}
            {actions.map((a) => (
              <Button
                key={a.action}
                size="sm"
                variant={a.to === "rejected" || a.to === "archived" ? "secondary" : "primary"}
                disabled={busy !== null}
                onClick={() => runAction(deck, a)}
              >
                {busy === `${deck.id}:${a.action}` ? "…" : a.label}
              </Button>
            ))}
          </div>
        )}
      </>
    );
  }

  function paneBody(row: StageRow, tab: string): ReactNode {
    const custom = subTabs.find((t): t is Exclude<StageSubTab, PaneTabId> => typeof t !== "string" && t.id === tab);
    if (custom) return custom.render(row, ctx);
    if (tab === "scores") return <AllScores deck={row.deck} scores={paneEval?.scores ?? null} />;
    if (tab === "signup") {
      return (
        <SignupPaneBody
          row={row}
          busy={busy !== null}
          onOpenWorkspace={(t) => row.signup && setWorkspace({ signupId: row.signup.signupId, tab: t })}
          onAllocate={() => row.signup && allocateSeat(row.signup)}
        />
      );
    }
    return <DeckSlides extraction={paneEval?.extraction ?? null} />;
  }

  const stat = config.footer?.(stageRows);
  const toolbar = config.toolbar;
  // The Action column sits where `columns` places it, else last; never on a read-only screen.
  const tableColumns: (StageColumn | StageCustomColumn)[] = config.readOnly
    ? columns.filter((c) => columnId(c) !== "action")
    : columns.some((c) => columnId(c) === "action")
      ? columns
      : [...columns, "action"];

  return (
    <section className="sj-frame">
      <PageToolbar
        title={config.title}
        subtitle={config.subtitle}
        actions={
          <>
            {!config.footer && <Badge tone="info">{rows.length}</Badge>}
            {toolbar?.filters && toolbar.filters.length > 0 && (
              <FilterMenu options={toolbar.filters} value={activeFilter ? filterId : null} onChange={setFilterId} />
            )}
            {toolbar?.export && (
              <ToolbarButton disabled={rows.length === 0} onClick={() => exportDecks(config.title, rows)}>
                <Download className="h-3 w-3" aria-hidden="true" />
                Export
              </ToolbarButton>
            )}
          </>
        }
      />

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
            {error && (
              <div className="rounded-lg border border-signal-flagged/40 bg-signal-flagged/10 px-4 py-2.5 text-sm text-signal-flagged">
                {error}
              </div>
            )}

            <Card flush className="overflow-x-auto">
              {decks !== null && rows.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    icon="Layers"
                    title={activeFilter ? "No startups match this filter" : (config.emptyTitle ?? "Nothing here yet")}
                    description={
                      activeFilter
                        ? `Nothing in ${config.title} is "${activeFilter.label}" right now.`
                        : (config.emptyDescription ?? "Decks appear here as they reach this stage.")
                    }
                  />
                </div>
              ) : (
                <table className="w-full text-left" style={{ minWidth: config.minWidth ?? "44rem" }}>
                  <thead>
                    <tr className="text-fg-muted">
                      {tableColumns.map((c) => (
                        <th
                          key={columnId(c)}
                          className={`px-4 py-2.5 text-xs font-medium uppercase tracking-wide ${columnId(c) === "action" ? "text-right" : ""}`}
                        >
                          {header(c)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((row) => (
                      <tr
                        key={row.deck.id}
                        className={`border-t border-line align-top ${pane?.deckId === row.deck.id ? "bg-surface-2" : ""}`}
                      >
                        {tableColumns.map((c) => (
                          <td key={columnId(c)} className="px-4 py-3">
                            {cell(c, row)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>
          <StageFooter stat={stat} legend={config.legend} />
        </div>

        {paneRow && pane && (
          <DetailPane
            title={paneRow.deck.name}
            meta={[paneRow.deck.sector, paneRow.deck.stage, paneRow.deck.city].filter(Boolean).join(" · ")}
            tabs={paneTabs.map(resolveTab)}
            active={pane.tab}
            onTab={(tab) => setPane({ deckId: paneRow.deck.id, tab })}
            onClose={() => setPane(null)}
            headerAction={
              <Button size="sm" variant="secondary" onClick={() => setSelected(paneRow.deck)}>
                Evaluation
              </Button>
            }
          >
            {paneBody(paneRow, pane.tab)}
          </DetailPane>
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
          badges={selected.signal ? <SignalTag signal={selected.signal} /> : null}
        />
      )}

      {workspace && (
        <SignupWorkspace
          signupId={workspace.signupId}
          initialTab={workspace.tab}
          onClose={() => setWorkspace(null)}
          onChanged={() => void load()}
        />
      )}

      {reportFor && (
        <EvaluationReportModal
          deckId={reportFor.deck.id}
          deckName={reportFor.deck.name}
          initialTab={reportFor.tab}
          onClose={() => setReportFor(null)}
        />
      )}
    </section>
  );
}

function documentsOption(deck: DeckView, signup?: SignupSummary) {
  const value = signup?.documentsStatus ?? deck.documentsStatus ?? "pending";
  return DOCUMENT_OPTIONS.find((o) => o.value === value) ?? DOCUMENT_OPTIONS[0];
}

/**
 * The slide-over's Sign-up tab (`cuTab('signup')` → `suSignupBody`): where the
 * record stands, the document roll-up, and — once sign-up has completed — the
 * seat card. The full three-tab workflow stays in the workspace it links to.
 */
export function SignupPaneBody({
  row,
  busy,
  onOpenWorkspace,
  onAllocate,
}: {
  row: StageRow;
  busy: boolean;
  onOpenWorkspace: (tab: WorkspaceTab) => void;
  onAllocate: () => void;
}) {
  const { deck, signup } = row;
  if (!signup) {
    return <p className="text-xs text-fg-muted">No sign-up has been started for {deck.name} yet.</p>;
  }
  const docs = documentsOption(deck, signup);
  return (
    <div className="flex flex-col gap-3" data-testid="pane-signup">
      <div className="text-[11px] text-fg-muted">
        Sign-up workflow — status:{" "}
        <b className="text-fg">{SIGNUP_STATUS_LABELS[signup.status] ?? signup.status}</b>
      </div>
      <div className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-xs">
        <span className="text-fg-muted">Documents</span>
        <button type="button" title="Open the document set" onClick={() => onOpenWorkspace("docs")}>
          <Badge tone={docs.tone}>{docs.label}</Badge>
        </button>
      </div>
      <div className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-xs">
        <span className="text-fg-muted">Founder signature</span>
        <span className="text-fg">{signup.founderSigned ? "Signed" : "Awaiting founder"}</span>
      </div>
      {SEAT_STATUSES.includes(signup.status) &&
        (signup.seated ? (
          <div
            data-testid="pane-seat-allocated"
            className="flex items-center gap-2 rounded-lg border border-green/30 bg-green-lt px-3 py-2.5 text-xs font-semibold text-green"
          >
            <Armchair className="h-4 w-4" aria-hidden="true" /> Seat allocated · founder access provisioned
          </div>
        ) : (
          <div
            data-testid="pane-seatless"
            className="flex items-center gap-2 rounded-lg border border-red/30 bg-red-lt px-3 py-2 text-xs"
          >
            <span className="flex flex-1 items-center gap-1.5 font-semibold text-red">
              <TriangleAlert className="h-4 w-4" aria-hidden="true" /> Seatless — no cohort seat allocated yet
            </span>
            <Button size="sm" variant="secondary" disabled={busy || signup.readOnly} onClick={onAllocate}>
              Allocate seat
            </Button>
          </div>
        ))}
      <Button size="sm" variant="secondary" onClick={() => onOpenWorkspace("agr")}>
        <Signature className="mr-1 h-3.5 w-3.5" /> Open sign-up workspace
      </Button>
    </div>
  );
}

/** W9-C — a declared column, in one line. */
function col(id: string, label: string, render: StageCustomColumn["render"]): StageCustomColumn {
  return { id, label, render };
}

// `panel-investmentdd` / `panel-legaldd` legend (`.nc-legend`), each entry the
// state of a checklist — the Filter menu speaks the same three words.
const DD_LEGEND: LegendItem[] = [
  { label: "Done", color: "var(--green)", statuses: ["done"] },
  { label: "In progress", color: "var(--gold-dk)", statuses: ["in_progress"] },
  { label: "Flagged", color: "var(--red)", statuses: ["flagged"] },
];
const DD_FILTERS = (track: DiligenceTrack): FilterOption<StageRow>[] =>
  legendFilters(DD_LEGEND, (r) => legendKeyOf(dealOf(r)?.[track]));

// `panel-incuration` legend — the term sheet's own status (`TS_OUTCOMES`).
const TS_LEGEND: LegendItem[] = [
  { label: "Signed", color: "var(--green)", statuses: ["signed"] },
  { label: "Issued", color: "#2D7DD2", statuses: ["issued"] },
  { label: "Drafted", color: "var(--gold-dk)", statuses: ["drafted"] },
  { label: "Declined", color: "var(--red)", statuses: ["declined"] },
];

// ── W9-B — the two VC pipelines (`jpRowAssoc` / `jpFoot`) ───────────────────

/** `.jp-tb-sub` — identical on both VC pipeline panels. */
const VC_PIPELINE_SUBTITLE =
  "Track every deck through jury evaluation — AI vs jury scoring, assignment and final decision";

const VC_PIPELINE_COLUMNS: StageColumn[] = [
  "startup",
  "ai",
  "jury",
  "avg",
  "addl",
  "submittedDate",
  "status",
  "action",
  "submitTo",
];

/** The VC stage order (`src/pipeline/vc.ts`) after the intake stages. */
const VC_STAGE_ORDER = [
  "analyst_scoring",
  "associate_review",
  "partner_review",
  "partner_call",
  "investment_dd",
  "ic_review",
  "mp_decision",
  "alignment_call",
  "term_sheet",
  "legal_dd",
  "onboard_ready",
];

/** Every stage a deck decided at `stage` can be in now — later stages, or archived. */
function vcStagesAfter(stage: string): string[] {
  return [...VC_STAGE_ORDER.slice(VC_STAGE_ORDER.indexOf(stage) + 1), "archived"];
}

// `.jp-legend` — the same four dots on both panels, each decoding a pill key.
const VC_PIPELINE_LEGEND: LegendItem[] = [
  { label: "Assigned", color: "var(--blue-dk)", statuses: ["assigned"] },
  { label: "Shortlisted", color: "var(--green)", statuses: ["shortlisted"] },
  { label: "Rejected", color: "var(--red)", statuses: ["rejected"] },
  { label: "Pending", color: "var(--gold-dk)", statuses: ["pending"] },
];

/** The role a decided deck was submitted to, by the stage the deciding event entered. */
const VC_SUBMIT_TO: Record<string, string> = {
  partner_review: "Partner",
  partner_call: "Partner call",
};

/**
 * `jpRowAssoc`'s pill: an active row by its stage, a decided row by its deciding
 * event. Submitted wears the Shortlisted colour, as the prototype's
 * `.jp-stat.shortlisted` does. A pass is Rejected, with no date and no destination.
 */
function vcPipelineStatus(active: Record<string, StageRowStatus>) {
  return (row: StageRow): StageRowStatus => {
    const event = row.decided;
    if (!event) return active[row.deck.statusId ?? ""] ?? { key: "pending", label: "Pending" };
    if (event.toStage === "archived") return { key: "rejected", label: "Rejected" };
    return {
      key: "shortlisted",
      label: "Submitted",
      submittedAt: event.createdAt,
      submitTo: VC_SUBMIT_TO[event.toStage] ?? event.toLabel,
    };
  };
}

// With the analyst → Assigned; awaiting the associate's decision → Pending.
const ASSOC_PIPELINE_STATUS = vcPipelineStatus({
  analyst_scoring: { key: "assigned", label: "Assigned" },
  associate_review: { key: "pending", label: "Pending" },
});
const PARTNER_PIPELINE_STATUS = vcPipelineStatus({
  partner_review: { key: "pending", label: "Pending" },
});

/** `jpFoot` — "N decks · N shortlisted · N rejected · N in progress". */
function vcPipelineFoot(status: (row: StageRow) => StageRowStatus) {
  return (rows: StageRow[]) => {
    const n = (...keys: string[]) => rows.filter((r) => keys.includes(status(r).key)).length;
    return (
      `${rows.length} ${rows.length === 1 ? "deck" : "decks"} · ${n("shortlisted")} shortlisted · ` +
      `${n("rejected")} rejected · ${n("assigned", "pending")} in progress`
    );
  };
}

/** Config for each VC stage nav slug rendered by StagePage. IC voting (`icpipeline`)
 *  and scoring (`evaluate`) are dedicated screens, not config-driven. */
// NB `partnercall` / `alignmentcall` (VC) and `introcalls` (incubator) moved to
// `CallsPage` in Session 7 — those screens now schedule calls and emit ICS
// invites on top of the stage list, so they are no longer plain stage screens.
export const VC_STAGE_CONFIG: Record<string, StageConfig> = {
  // `panel-jurypipeline` · `jpRowAssoc`: Startup · AI score · Analyst Score ·
  // Avg. score · Addl. Parameter scores · Submitted date · Status · Action ·
  // Submit to. No evaluator column ("no juror column") and no Sector column
  // (sector is the startup's sub-line).
  jurypipeline: {
    title: "Assoc. Pipeline",
    subtitle: VC_PIPELINE_SUBTITLE,
    statuses: ["analyst_scoring", "associate_review"],
    keepDecided: vcStagesAfter("associate_review"),
    rowStatus: ASSOC_PIPELINE_STATUS,
    columns: VC_PIPELINE_COLUMNS,
    labels: { jury: "Analyst Score" },
    minWidth: "72rem",
    toolbar: { filters: legendFilters(VC_PIPELINE_LEGEND, (r) => ASSOC_PIPELINE_STATUS(r).key), export: true },
    legend: VC_PIPELINE_LEGEND,
    footer: vcPipelineFoot(ASSOC_PIPELINE_STATUS),
    // `jpActionSelect('jp')` — View deck / Submit forward / Pass.
    actionMenu: { labels: { shortlist_to_partner: "Submit forward", not_shortlisted: "Pass" } },
    emptyTitle: "No decks in associate review",
    emptyDescription: "Decks land here after AI evaluation for core + additional scoring.",
  },
  // `panel-partnerpipeline` — the same panel with "Inv. Assoc." in the third
  // column (Superuser V8; the five role builds still say "Analyst Score", §8 Q133).
  partnerpipeline: {
    title: "Partner Pipeline",
    subtitle: VC_PIPELINE_SUBTITLE,
    statuses: ["partner_review"],
    keepDecided: vcStagesAfter("partner_review"),
    rowStatus: PARTNER_PIPELINE_STATUS,
    columns: VC_PIPELINE_COLUMNS,
    labels: { jury: "Inv. Assoc." },
    minWidth: "72rem",
    toolbar: { filters: legendFilters(VC_PIPELINE_LEGEND, (r) => PARTNER_PIPELINE_STATUS(r).key), export: true },
    legend: VC_PIPELINE_LEGEND,
    footer: vcPipelineFoot(PARTNER_PIPELINE_STATUS),
    // `jpActionSelect('pp')` — View deck / Move to Partner call / Pass.
    actionMenu: { labels: { advance_to_call: "Move to Partner call", not_shortlisted_partner: "Pass" } },
    emptyTitle: "No decks in partner review",
    emptyDescription: "Associate-shortlisted deals appear here for the partner.",
  },
  // ── W9-C · the diligence-to-close screens ─────────────────────────────────
  // `panel-investmentdd` (`ddRender`): Startup · Avg. score · Addl. parameters ·
  // Sector · Stage · MP approval · Status · Diligence progress · Flags · Lead ·
  // Checklist. No Action column — the deck's own move ("Approve for IC") is at
  // the foot of the Checklist tab, which "Open checklist" opens.
  investmentdd: {
    title: "Investment DD",
    subtitle:
      "Pre-IC investment diligence · market, team, customers, product, financials & competition · log findings before the deal reaches IC",
    statuses: ["investment_dd"],
    readOnly: true,
    columns: [
      "startup",
      "avg",
      "addl",
      "sector",
      col("stage", "Stage", ({ deck }) => <StageChip>{deck.stage}</StageChip>),
      col("mpApproval", "MP approval", (row, ctx) => <MpApprovalCell row={row} ctx={ctx} />),
      col("ddStatus", "Status", (row, ctx) => <DdStatusCell row={row} ctx={ctx} />),
      col("ddProgress", "Diligence progress", (row) => <DiligenceProgressCell row={row} />),
      col("flags", "Flags", (row) => <FlagsPill summary={dealOf(row)?.investment} />),
      col("ddLead", "Lead", (row) => <span className="text-sm text-fg-muted">{dealOf(row)?.investmentLead ?? "—"}</span>),
      col("checklist", "Checklist", (row, ctx) => (
        <OpenTabButton row={row} ctx={ctx} tab="checklist" icon={checklistIcon}>
          Open checklist
        </OpenTabButton>
      )),
    ],
    labels: { addl: "Addl. parameters" },
    minWidth: "82rem",
    extra: loadDeals,
    toolbar: { filters: DD_FILTERS("investment"), export: true },
    subTabs: [
      { id: "checklist", label: "Checklist", render: (row, ctx) => <ChecklistTab row={row} ctx={ctx} track="investment" /> },
      "deck",
      "scores",
    ],
    legend: DD_LEGEND,
    footer: (rows) => {
      const s = rows.map((r) => dealOf(r)?.investment);
      return `${plural(rows.length, "deal")} in diligence · ${s.filter(isComplete).length} complete · ${s.filter((x) => !!x?.flagged).length} with flags`;
    },
    emptyTitle: "Nothing in diligence",
    emptyDescription: "Sponsored deals appear here for pre-IC diligence and MP approval.",
  },
  // `panel-incuration` (`tsRender` via `clRow`): Startup · AI score · Partner ·
  // Avg. score · Addl. Parameter scores · Call scheduled · Call date · Call
  // completed · Schedule call · Term sheet status · Term sheet doc.
  incuration: {
    title: "Term sheet Pipeline",
    subtitle: "Deals with a term sheet in motion · track drafting, issue and signing",
    statuses: ["term_sheet"],
    readOnly: true,
    columns: [
      "startup",
      "ai",
      col("partner", "Partner", (row) => <span className="text-sm text-fg-muted">{dealOf(row)?.partnerName ?? "—"}</span>),
      "avg",
      "addl",
      "callScheduled",
      "callDate",
      "callCompleted",
      col("scheduleCall", "Schedule call", (row, ctx) => <ScheduleCallCell row={row} ctx={ctx} />),
      col("termSheetStatus", "Term sheet status", (row, ctx) => <TermSheetStatusCell row={row} ctx={ctx} />),
      col("termSheetDoc", "Term sheet doc", (row, ctx) => <TermSheetDocCell row={row} ctx={ctx} />),
    ],
    minWidth: "92rem",
    extra: loadDeals,
    toolbar: {
      filters: TS_LEGEND.map((l) => ({
        id: l.label,
        label: l.label,
        match: (r: StageRow) => l.statuses!.includes(dealOf(r)?.termSheet.status ?? ""),
      })),
      export: true,
    },
    subTabs: [
      { id: "term-sheet", label: "Term sheet", render: (row, ctx) => <TermSheetTab row={row} ctx={ctx} /> },
      "deck",
      "scores",
    ],
    legend: TS_LEGEND,
    // `tsRender`'s foot: "issued" counts every term sheet that has gone out, signed ones included.
    footer: (rows) => {
      const st = rows.map((r) => dealOf(r)?.termSheet.status);
      return `${plural(rows.length, "deal")} in term-sheet stage · ${st.filter((x) => x === "issued" || x === "signed").length} issued · ${st.filter((x) => x === "signed").length} signed`;
    },
    emptyTitle: "No term sheets in motion",
    emptyDescription: "Deals with an issued term sheet appear here.",
  },
  // `panel-legaldd` (`ldRender`): Startup · Avg. score · Addl. parameters ·
  // Sector · Stage · Legal DD progress · Flags · Lead · Sign up.
  legaldd: {
    title: "Legal DD",
    subtitle: "Post-signing confirmatory & legal diligence · clear all items before the round closes",
    statuses: ["legal_dd"],
    readOnly: true,
    columns: [
      "startup",
      "avg",
      "addl",
      "sector",
      col("stage", "Stage", ({ deck }) => <StageChip>{deck.stage}</StageChip>),
      col("legalProgress", "Legal DD progress", (row) => <ProgressBar summary={dealOf(row)?.legal} />),
      col("flags", "Flags", (row) => <FlagsPill summary={dealOf(row)?.legal} />),
      col("legalLead", "Lead", (row) => <span className="text-sm text-fg-muted">{dealOf(row)?.legalLead ?? "—"}</span>),
      col("signup", "Sign up", (row, ctx) => (
        <OpenTabButton row={row} ctx={ctx} tab="signup-record" icon={signupIcon}>
          Open sign up
        </OpenTabButton>
      )),
    ],
    labels: { addl: "Addl. parameters" },
    minWidth: "72rem",
    extra: loadDeals,
    toolbar: { filters: DD_FILTERS("legal"), export: true },
    subTabs: [
      { id: "legal-checklist", label: "Checklist", render: (row, ctx) => <ChecklistTab row={row} ctx={ctx} track="legal" /> },
      { id: "signup-record", label: "Sign up", render: (row, ctx) => <SignupRecordTab row={row} ctx={ctx} /> },
      "deck",
      "scores",
    ],
    legend: DD_LEGEND,
    footer: (rows) => {
      const s = rows.map((r) => dealOf(r)?.legal);
      return `${plural(rows.length, "deal")} in legal DD · ${s.filter(isComplete).length} cleared · ${s.filter((x) => !!x?.flagged).length} with flags`;
    },
    emptyTitle: "No deals in legal DD",
    emptyDescription: "Term-sheet deals move here for legal diligence.",
  },
  // `panel-curation` (`curRender`): Startup · Avg. score · Addl. parameters ·
  // Cohort · Curation stage · Jury member lead · Progress · Action. The IC
  // member's build redraws the same slug as "Invest ready" (F0563).
  curation: {
    title: "Onboard ready",
    subtitle:
      "Onboarded startups being actively curated through the cohort — mentorship, milestones and demo-day readiness",
    statuses: ["onboard_ready"],
    readOnly: true,
    columns: [
      "startup",
      "avg",
      "addl",
      "cohort",
      "curationStage",
      "lead",
      "progress",
      col("action", "Action", (row, ctx) => <CurationActionCell row={row} ctx={ctx} />),
    ],
    labels: { addl: "Addl. parameters" },
    minWidth: "72rem",
    toolbar: {
      filters: [
        { id: "started", label: "In curation", match: (r) => !!r.deck.curationStage },
        { id: "not-started", label: "Not started", match: (r) => !r.deck.curationStage },
      ],
      export: true,
    },
    footer: (rows) => `${plural(rows.length, "startup")} in active curation`,
    emptyTitle: "No companies onboarded yet",
    emptyDescription: "Deals that clear legal DD land here as portfolio companies.",
    roleVariants: {
      // `AISJ_VC_IC_member_V2` panel-curation: Startup · Cleared · Stage · Status · Ask · Owner.
      ic_member: {
        title: "Invest ready",
        subtitle: "Deals cleared by the IC — executing through term sheet and legal toward close",
        statuses: ["alignment_call", "term_sheet", "legal_dd", "onboard_ready"],
        columns: [
          "startup",
          col("cleared", "Cleared", (row) => <ClearedCell row={row} />),
          col("investStage", "Stage", (row) => <InvestReadyStageCell row={row} />),
          col("investStatus", "Status", (row) => <InvestReadyStatusCell row={row} />),
          col("ask", "Ask", (row) => <span className="text-[11px] text-fg">{dealOf(row)?.ask ?? "—"}</span>),
          col("owner", "Owner", (row) => <span className="text-[11px] text-fg-muted">{investReadyOwner(row) ?? "—"}</span>),
        ],
        minWidth: "56rem",
        extra: loadDeals,
        toolbar: {
          filters: (["On track", "Stalled", "Funded"] as const).map((label) => ({
            id: label,
            label,
            match: (r: StageRow) => investReadyStatus(r.deck.statusId, dealOf(r)?.lastActivityAt) === label,
          })),
          export: true,
        },
        footer: (rows) =>
          `${plural(rows.length, "deal")} cleared · ${rows.filter((r) => r.deck.statusId === "onboard_ready").length} funded`,
        emptyTitle: "No deals cleared by the IC yet",
        emptyDescription: "Deals the committee clears appear here as they execute toward close.",
      },
    },
  },
  // `panel-archive` (`arRender`): Startup · Reason · Stage reached · Archived on ·
  // Archived by · Action (Restore). Reason is the prototype's toned pill (F0589).
  archive: {
    title: "Archive",
    subtitle:
      "Startups removed from the active pipeline — rejected, withdrawn or graduated. Restore any of them back into the workflow.",
    statuses: ["archived"],
    columns: [
      "startup",
      col("reason", "Reason", (row) => <ArchiveReasonCell row={row} />),
      "stageReached",
      "archivedOn",
      "archivedBy",
    ],
    minWidth: "56rem",
    toolbar: {
      filters: (Object.keys(ARCHIVE_REASON_LABELS) as ArchiveReason[]).map((reason) => ({
        id: reason,
        label: ARCHIVE_REASON_LABELS[reason],
        match: (r: StageRow) => archiveReason(r.deck) === reason,
      })),
      export: true,
    },
    footer: (rows) => `${plural(rows.length, "archived startup")}`,
    emptyTitle: "Archive is empty",
    emptyDescription: "Passed and not-shortlisted deals are kept here for the record.",
  },
};

/** A filter per legend entry that decodes statuses — the Filter menu speaks the legend's words. */
function legendFilters(legend: LegendItem[], key: (row: StageRow) => string | undefined): FilterOption<StageRow>[] {
  return legend
    .filter((l) => l.statuses?.length)
    .map((l) => ({ id: l.label, label: l.label, match: (row) => l.statuses!.includes(key(row) ?? "") }));
}

const count = (rows: StageRow[], test: (row: StageRow) => boolean) => rows.filter(test).length;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// `panel-jurypipeline` legend (`.jp-legend`), each entry decoding its stage pill.
const JURY_LEGEND: LegendItem[] = [
  { label: "Assigned", color: "var(--blue-dk)", statuses: ["assigned"] },
  { label: "Shortlisted", color: "var(--green)", statuses: ["shortlisted"] },
  { label: "Rejected", color: "var(--red)", statuses: ["rejected"] },
  { label: "Pending", color: "var(--gold-dk)", statuses: ["jury_evaluation"] },
];

// `panel-forsignup` legend — the sign-up lifecycle (`suSignupLabel`), and the
// `.su-sustat` tints every Sign-up status pill wears, legend drawn or not.
const SIGNUP_LIFECYCLE: LegendItem[] = [
  { label: "Shortlisted", color: "var(--green)", statuses: ["shortlisted"] },
  { label: "Initiated", color: "var(--blue-dk)", statuses: ["initiated"] },
  { label: "In progress", color: "var(--gold-dk)", statuses: ["progress"] },
  { label: "Completed", color: "#047857", statuses: ["completed"] },
  { label: "Onboarded", color: "#6D28D9", statuses: ["onboarded", "onboard_ready"] },
  { label: "Rejected", color: "var(--red)", statuses: ["rejected"] },
];

const PM_LEGEND = SIGNUP_LIFECYCLE;

// `panel-incuration` legend — names the payment / document tints.
const SIGNUP_LEGEND: LegendItem[] = [
  { label: "Paid / All docs", color: "#047857" },
  { label: "Partial", color: "var(--gold-dk)" },
  { label: "Payment pending", color: "var(--blue-dk)" },
  { label: "Docs missing", color: "var(--red)" },
];

const docsOf = (row: StageRow) => row.signup?.documentsStatus ?? row.deck.documentsStatus ?? "pending";
const payOf = (row: StageRow) => row.deck.paymentStatus ?? "pending";

/** Config for each incubator stage nav slug rendered by StagePage. */
export const INCUBATOR_STAGE_CONFIG: Record<string, StageConfig> = {
  // Issue 25 — Startup · Jury members & status · AI · Jury · Avg · Addl.
  // Parameter scores · Assigned date · Status · Action. The startup name keeps
  // opening the Evaluation drawer: the prototype's name opens the report, and
  // its one-tab "Pitch deck" pane is only reachable from an Action menu.
  jurypipeline: {
    title: "Jury Pipeline",
    subtitle:
      "Track every deck through jury evaluation — AI vs jury scoring, assignment and final decision",
    statuses: ["assigned", "jury_evaluation", "shortlisted", "rejected"],
    columns: ["startup", "evaluators", "ai", "jury", "avg", "addl", "assignedDate", "status"],
    labels: { evaluators: "Jury members & status" },
    minWidth: "70rem",
    toolbar: { filters: legendFilters(JURY_LEGEND, (r) => r.deck.statusId), export: true },
    legend: JURY_LEGEND,
    // `jpFoot`
    footer: (rows) =>
      `${plural(rows.length, "deck")} · ${count(rows, (r) => r.deck.statusId === "shortlisted")} shortlisted · ` +
      `${count(rows, (r) => r.deck.statusId === "rejected")} rejected · ` +
      `${count(rows, (r) => r.deck.statusId === "assigned" || r.deck.statusId === "jury_evaluation")} in progress`,
    emptyTitle: "No decks in jury evaluation",
    emptyDescription: "Assigned decks appear here for Score / Shortlist / Reject.",
  },
  // Issue 26 — "as per image9", which is the prototype's `panel-forsignup`
  // retitled: shortlisted startups moving into onboarding, by sign-up status.
  // The PM's shortlist / reject decision is Jury Pipeline's Action (as it is in
  // the prototype), so this screen starts at Shortlisted (§8 Q-W7F-1).
  pmpipeline: {
    title: "Prog manager pipeline",
    subtitle: "Shortlisted startups moving into onboarding — track sign-up status and action each one",
    statuses: ["shortlisted", "intro", "signup", "onboard_ready", "rejected"],
    // Only the jury's rejections — a deck the AI gate turned away never reached this funnel.
    include: (d) => d.statusId !== "rejected" || d.exitAction === "reject",
    columns: ["startup", "ai", "jury", "avg", "addl", "callScheduled", "callDate", "callCompleted", "signupStatus"],
    minWidth: "76rem",
    toolbar: { filters: legendFilters(PM_LEGEND, (r) => signupStatusKey(r.deck, r.signup)), export: true },
    subTabs: ["deck", "scores"],
    legend: PM_LEGEND,
    // `suFoot`
    footer: (rows) => {
      const is = (...keys: string[]) => (r: StageRow) => keys.includes(signupStatusKey(r.deck, r.signup) ?? "");
      return (
        `${plural(rows.length, "startup")} · ${count(rows, is("completed"))} signed up · ` +
        `${count(rows, is("initiated", "progress"))} in onboarding · ${count(rows, is("shortlisted"))} awaiting · ` +
        `${count(rows, is("archived"))} archived`
      );
    },
    emptyTitle: "Nothing moving into onboarding",
    emptyDescription: "Startups the jury shortlists arrive here for the intro call and sign-up.",
  },
  // Issue 29 — adds Payment status and Documents status.
  incuration: {
    title: "Sign up Pipeline",
    subtitle: "Signed-up startups being curated for the cohort — track payment and document readiness",
    statuses: ["signup"],
    columns: [
      "startup",
      "ai",
      "jury",
      "avg",
      "addl",
      "callScheduled",
      "callDate",
      "callCompleted",
      "signupStatus",
      "paymentStatus",
      "documentsStatus",
    ],
    minWidth: "88rem",
    workspace: true,
    toolbar: {
      filters: [
        { id: "paid-all", label: "Paid / All docs", match: (r) => payOf(r) === "paid" && docsOf(r) === "complete" },
        { id: "partial", label: "Partial", match: (r) => payOf(r) === "partial" || docsOf(r) === "partial" },
        { id: "pay-pending", label: "Payment pending", match: (r) => payOf(r) === "pending" },
        { id: "docs-missing", label: "Docs missing", match: (r) => docsOf(r) === "pending" },
      ],
      export: true,
    },
    subTabs: ["deck", "scores", "signup"],
    legend: SIGNUP_LEGEND,
    // `cuFoot`
    footer: (rows) =>
      `${plural(rows.length, "startup")} in curation · ${count(rows, (r) => payOf(r) === "paid")} fully paid · ` +
      `${count(rows, (r) => docsOf(r) === "complete")} with all documents`,
    emptyTitle: "No sign-ups in progress",
    emptyDescription: "Startups sent a sign-up invite appear here until they complete it.",
  },
  // Issue 30 — Startup · Cohort · Curation stage · Jury member lead · Progress.
  curation: {
    title: "Onboard ready",
    subtitle:
      "Onboarded startups being actively curated through the cohort — mentorship, milestones and demo-day readiness",
    statuses: ["onboard_ready"],
    columns: ["startup", "cohort", "curationStage", "lead", "progress"],
    minWidth: "56rem",
    // The seat card (Seatless / Seat allocated) lives in the workspace.
    workspace: true,
    toolbar: {
      filters: [
        { id: "seatless", label: "Seatless", match: (r) => !!r.signup?.seatless },
        { id: "seated", label: "Seat allocated", match: (r) => !!r.signup?.seated },
      ],
      export: true,
    },
    footer: (rows) => `${plural(rows.length, "startup")} in active curation`,
    emptyTitle: "No startups onboarded yet",
    emptyDescription: "Startups that complete sign-up land here, ready to onboard.",
  },
  // Issue 31 — Startup · Reason · Stage reached · Archived on · Archived by,
  // with the Restore action back into the workflow.
  archive: {
    title: "Archive",
    subtitle:
      "Startups removed from the active pipeline — rejected, withdrawn or graduated. Restore any of them back into the workflow.",
    statuses: ["rejected", "archived"],
    columns: ["startup", "reason", "stageReached", "archivedOn", "archivedBy"],
    minWidth: "56rem",
    toolbar: {
      filters: [
        { id: "rejected", label: "Rejected", match: (r) => r.deck.statusId === "rejected" },
        { id: "archived", label: "Archived", match: (r) => r.deck.statusId === "archived" },
      ],
      export: true,
    },
    footer: (rows) => `${plural(rows.length, "archived startup")}`,
    emptyTitle: "Archive is empty",
    emptyDescription: "Rejected and archived decks are kept here for the record.",
  },
};
