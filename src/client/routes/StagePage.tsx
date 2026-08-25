import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { FileBarChart } from "lucide-react";
import {
  Card,
  Button,
  Badge,
  SignalTag,
  ScoreChip,
  EvaluationDrawer,
  EvaluationReportModal,
  EmptyState,
  type ParamScoreView,
  type ExtractionSlide,
} from "../components";
import type { DeckView, DeckAction } from "../types";
import { exportDecks } from "../exportCsv";
import {
  listDecks,
  getDeck,
  transitionDeck,
  ApiError,
  sendSignup,
  updateDeckOnboarding,
  type DeckVersionView,
} from "../api";

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
  | "status";

export interface StageConfig {
  title: string;
  subtitle: string;
  /** Raw stage ids this screen shows. */
  statuses: string[];
  /** Empty-state copy when no deck matches. */
  emptyTitle?: string;
  emptyDescription?: string;
  /** Second column label + field (legacy shorthand, still honoured). */
  secondary?: { label: string; field: "founder" | "sector" };
  /** Hide the Action column (read-only screens). */
  readOnly?: boolean;
  /** The exact columns, in order. Defaults to the pre-Aug-2026 layout. */
  columns?: StageColumn[];
  /** Minimum table width so wide layouts scroll rather than squash. */
  minWidth?: string;
  /** Optional inline fields captured for one action (e.g. term-sheet valuation /
   *  ownership on Issue term sheet), passed to the transition as extra body fields. */
  capture?: { action: string; fields: { name: "valuation" | "ownership"; label: string }[] };
  /** Show the legend beneath the table. */
  legend?: { label: string; color: string }[];
}

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
};

const PAYMENT_OPTIONS = [
  { value: "pending", label: "Payment pending" },
  { value: "partial", label: "Partially paid" },
  { value: "paid", label: "Paid" },
  { value: "waived", label: "Waived" },
];

const DOCUMENT_OPTIONS = [
  { value: "pending", label: "Docs missing" },
  { value: "partial", label: "Docs partial" },
  { value: "complete", label: "All docs" },
];

function fmtDate(iso?: string): string {
  if (!iso) return "—";
  const ms = Date.parse(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  if (Number.isNaN(ms)) return iso;
  return new Date(ms).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtScore(n?: number): string {
  return n === undefined ? "—" : n.toFixed(1);
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

/**
 * Generic pipeline-stage screen: a deck table filtered to a set of stages with
 * inline role-gated transition buttons and the shared Evaluation drawer.
 *
 * Aug-2026 issues 25–31 made each screen's columns match its design, so the
 * table is now column-driven (`config.columns`) rather than one fixed layout,
 * and the sign-up / curation state on issues 29 and 30 is editable in place.
 */
export function StagePage({ config }: { config: StageConfig }) {
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

  const load = useCallback(() => {
    return listDecks()
      .then((r) => setDecks(r.decks))
      .catch(() => setDecks([]));
  }, []);

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

  const rows = useMemo(
    () => (decks ?? []).filter((d) => d.statusId && config.statuses.includes(d.statusId)),
    [decks, config.statuses],
  );

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

  const secondary = config.secondary ?? { label: "Founder", field: "founder" as const };
  const columns: StageColumn[] =
    config.columns ?? ["startup", secondary.field, "ai", "avg", "status"];

  function cell(column: StageColumn, deck: DeckView): ReactNode {
    switch (column) {
      case "startup":
        return (
          <>
            <button
              type="button"
              className="text-left font-medium text-fg hover:underline"
              onClick={() => setSelected(deck)}
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
      case "ai":
        return (
          <button
            type="button"
            title="Open the core parameter report"
            onClick={() => setReportFor({ deck, tab: "core" })}
          >
            <ScoreChip value={deck.aiScore} />
          </button>
        );
      case "jury":
        return (
          <button
            type="button"
            title="Open the core parameter report"
            className="font-mono text-sm text-fg underline-offset-2 hover:underline"
            onClick={() => setReportFor({ deck, tab: "core" })}
          >
            {fmtScore(deck.juryScore)}
          </button>
        );
      case "avg":
        return (
          <button
            type="button"
            title="Open the core parameter report"
            className="font-mono text-sm font-medium text-fg underline-offset-2 hover:underline"
            onClick={() => setReportFor({ deck, tab: "core" })}
          >
            {fmtScore(deck.decisionScore)}
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
          <Badge tone={deck.callScheduledAt ? "positive" : "neutral"}>
            {deck.callScheduledAt ? "Scheduled" : "Not scheduled"}
          </Badge>
        );
      case "callDate":
        return <span className="text-sm text-fg-muted">{fmtDate(deck.callScheduledAt)}</span>;
      case "callCompleted":
        return (
          <Badge tone={deck.callStatus === "completed" ? "positive" : "neutral"}>
            {deck.callStatus === "completed" ? "Completed" : "—"}
          </Badge>
        );
      case "signupStatus":
        return <span className="text-sm text-fg-muted">{deck.status ?? "—"}</span>;
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
      case "documentsStatus":
        return config.readOnly ? (
          <span className="text-sm text-fg-muted">
            {DOCUMENT_OPTIONS.find((o) => o.value === (deck.documentsStatus ?? "pending"))?.label}
          </span>
        ) : (
          <select
            className="sj-input h-8 py-0 text-xs"
            aria-label={`Documents status for ${deck.name}`}
            value={deck.documentsStatus ?? "pending"}
            disabled={busy !== null}
            onChange={(e) => saveOnboarding(deck, { documentsStatus: e.target.value })}
          >
            {DOCUMENT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        );
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
      case "status":
        return <span className="text-sm text-fg-muted">{deck.status ?? "—"}</span>;
    }
  }

  return (
    <div className="flex flex-col gap-5 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-fg">{config.title}</h1>
          <p className="mt-0.5 max-w-2xl text-sm text-fg-muted">{config.subtitle}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone="info">{rows.length}</Badge>
          <Button
            variant="secondary"
            size="sm"
            disabled={rows.length === 0}
            onClick={() => exportDecks(config.title, rows)}
          >
            Export
          </Button>
        </div>
      </div>

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
              title={config.emptyTitle ?? "Nothing here yet"}
              description={config.emptyDescription ?? "Decks appear here as they reach this stage."}
            />
          </div>
        ) : (
          <table className="w-full text-left" style={{ minWidth: config.minWidth ?? "44rem" }}>
            <thead>
              <tr className="text-fg-muted">
                {columns.map((c) => (
                  <th key={c} className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">
                    {c === "founder" && config.secondary
                      ? config.secondary.label
                      : COLUMN_LABELS[c]}
                  </th>
                ))}
                {!config.readOnly && (
                  <th className="px-4 py-2.5 text-right text-xs font-medium uppercase tracking-wide">Action</th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((deck) => {
                const actions = (deck.actions ?? []).filter((a) => !EXCLUDED_ACTIONS.has(a.action));
                return (
                  <tr key={deck.id} className="border-t border-line align-top">
                    {columns.map((c) => (
                      <td key={c} className="px-4 py-3">
                        {cell(c, deck)}
                      </td>
                    ))}
                    {!config.readOnly && (
                      <td className="px-4 py-3">
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
                        <div className="flex flex-wrap justify-end gap-2">
                          {actions.length === 0 && <span className="text-xs text-fg-muted">—</span>}
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
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {config.legend && rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-4 text-xs text-fg-muted">
          {config.legend.map((l) => (
            <span key={l.label} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: l.color }} />
              {l.label}
            </span>
          ))}
        </div>
      )}

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

      {reportFor && (
        <EvaluationReportModal
          deckId={reportFor.deck.id}
          deckName={reportFor.deck.name}
          initialTab={reportFor.tab}
          onClose={() => setReportFor(null)}
        />
      )}
    </div>
  );
}

const VC_SECTOR = { label: "Sector", field: "sector" as const };

/** Config for each VC stage nav slug rendered by StagePage. IC voting (`icpipeline`)
 *  and scoring (`evaluate`) are dedicated screens, not config-driven. */
// NB `partnercall` / `alignmentcall` (VC) and `introcalls` (incubator) moved to
// `CallsPage` in Session 7 — those screens now schedule calls and emit ICS
// invites on top of the stage list, so they are no longer plain stage screens.
export const VC_STAGE_CONFIG: Record<string, StageConfig> = {
  jurypipeline: {
    title: "Assoc. Pipeline",
    subtitle: "Track every deck through analyst + associate scoring — shortlist to partner or archive.",
    statuses: ["analyst_scoring", "associate_review"],
    secondary: VC_SECTOR,
    columns: ["startup", "evaluators", "ai", "jury", "avg", "addl", "assignedDate", "status"],
    minWidth: "68rem",
    emptyTitle: "No decks in associate review",
    emptyDescription: "Decks land here after AI evaluation for core + additional scoring.",
  },
  partnerpipeline: {
    title: "Partner Pipeline",
    subtitle: "Shortlisted deals under partner review — advance to a partner call or archive.",
    statuses: ["partner_review"],
    secondary: VC_SECTOR,
    columns: ["startup", "sector", "ai", "jury", "avg", "addl", "status"],
    minWidth: "60rem",
    emptyTitle: "No decks in partner review",
    emptyDescription: "Associate-shortlisted deals appear here for the partner.",
  },
  investmentdd: {
    title: "Investment DD",
    subtitle: "Pre-IC investment diligence · Managing Partner approval before the deal reaches IC.",
    statuses: ["investment_dd"],
    secondary: VC_SECTOR,
    columns: ["startup", "sector", "ai", "avg", "addl", "status"],
    minWidth: "56rem",
    emptyTitle: "Nothing in diligence",
    emptyDescription: "Sponsored deals appear here for pre-IC diligence and MP approval.",
  },
  incuration: {
    title: "Term sheet Pipeline",
    subtitle: "Deals with a term sheet in motion · track drafting, issue and signing, then start legal DD.",
    statuses: ["term_sheet"],
    secondary: VC_SECTOR,
    columns: ["startup", "sector", "ai", "avg", "status"],
    emptyTitle: "No term sheets in motion",
    emptyDescription: "Deals with an issued term sheet appear here.",
  },
  legaldd: {
    title: "Legal DD",
    subtitle: "Post-signing confirmatory & legal diligence · clear all items before the round closes.",
    statuses: ["legal_dd"],
    secondary: VC_SECTOR,
    columns: ["startup", "sector", "ai", "avg", "status"],
    emptyTitle: "No deals in legal DD",
    emptyDescription: "Term-sheet deals move here for legal diligence.",
  },
  curation: {
    title: "Onboard ready",
    subtitle: "Funded companies joining the portfolio — cleared legal DD and ready to onboard.",
    statuses: ["onboard_ready"],
    secondary: VC_SECTOR,
    readOnly: true,
    columns: ["startup", "cohort", "curationStage", "lead", "progress", "status"],
    minWidth: "56rem",
    emptyTitle: "No companies onboarded yet",
    emptyDescription: "Deals that clear legal DD land here as portfolio companies.",
  },
  archive: {
    title: "Archive",
    subtitle: "Deals removed from the active pipeline — passed or not shortlisted. Restore any of them back into the pipeline.",
    statuses: ["archived"],
    secondary: VC_SECTOR,
    columns: ["startup", "reason", "stageReached", "archivedOn", "archivedBy"],
    minWidth: "56rem",
    emptyTitle: "Archive is empty",
    emptyDescription: "Passed and not-shortlisted deals are kept here for the record.",
  },
};

/** Config for each incubator stage nav slug rendered by StagePage. */
export const INCUBATOR_STAGE_CONFIG: Record<string, StageConfig> = {
  // Issue 25 — Startup · Jury members & status · AI · Jury · Avg · Addl.
  // Parameter scores · Assigned date · Status · Action.
  jurypipeline: {
    title: "Jury Pipeline",
    subtitle:
      "Track every deck through jury evaluation — AI vs jury scoring, assignment and final decision.",
    statuses: ["assigned", "jury_evaluation", "shortlisted", "rejected"],
    columns: ["startup", "evaluators", "ai", "jury", "avg", "addl", "assignedDate", "status"],
    minWidth: "70rem",
    legend: [
      { label: "Assigned", color: "var(--color-info)" },
      { label: "Shortlisted", color: "var(--color-positive)" },
      { label: "Rejected", color: "var(--color-signal-flagged)" },
      { label: "Pending", color: "var(--color-signal-moderate)" },
    ],
    emptyTitle: "No decks in jury evaluation",
    emptyDescription: "Assigned decks appear here for Score / Shortlist / Reject.",
  },
  // Issue 26 — the Program Manager's own decision surface, after Jury Pipeline.
  pmpipeline: {
    title: "Prog Manager Pipeline",
    subtitle:
      "The Program Manager's decision queue — jury-scored decks awaiting sign-off, and shortlisted startups waiting on an intro call.",
    statuses: ["jury_evaluation", "shortlisted", "rejected"],
    columns: ["startup", "evaluators", "ai", "jury", "avg", "addl", "callScheduled", "status"],
    minWidth: "70rem",
    legend: [
      { label: "Awaiting PM decision", color: "var(--color-signal-moderate)" },
      { label: "Shortlisted", color: "var(--color-positive)" },
      { label: "Rejected", color: "var(--color-signal-flagged)" },
    ],
    emptyTitle: "Nothing awaiting a decision",
    emptyDescription:
      "Decks the jury has scored arrive here for the Program Manager to shortlist, reject or send to an intro call.",
  },
  // Issue 29 — adds Payment status and Documents status.
  incuration: {
    title: "Sign up Pipeline",
    subtitle: "Signed-up startups being curated for the cohort — track payment and document readiness.",
    statuses: ["signup"],
    columns: [
      "startup",
      "ai",
      "jury",
      "avg",
      "addl",
      "callScheduled",
      "callDate",
      "signupStatus",
      "paymentStatus",
      "documentsStatus",
    ],
    minWidth: "82rem",
    legend: [
      { label: "Paid / All docs", color: "var(--color-positive)" },
      { label: "Partial", color: "var(--color-signal-moderate)" },
      { label: "Payment pending", color: "var(--color-info)" },
      { label: "Docs missing", color: "var(--color-signal-flagged)" },
    ],
    emptyTitle: "No sign-ups in progress",
    emptyDescription: "Startups sent a sign-up invite appear here until they complete it.",
  },
  // Issue 30 — Startup · Cohort · Curation stage · Jury member lead · Progress.
  curation: {
    title: "Onboard ready",
    subtitle:
      "Onboarded startups being actively curated through the cohort — mentorship, milestones and demo-day readiness.",
    statuses: ["onboard_ready"],
    columns: ["startup", "cohort", "curationStage", "lead", "progress"],
    minWidth: "56rem",
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
    emptyTitle: "Archive is empty",
    emptyDescription: "Rejected and archived decks are kept here for the record.",
  },
};
