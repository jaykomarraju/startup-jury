import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import {
  KpiTile,
  Card,
  Button,
  DeckRow,
  EvaluationDrawer,
  EmptyState,
  type ParamScoreView,
  type ExtractionSlide,
} from "../components";
import type { DeckView } from "../types";
import { exportDecks } from "../exportCsv";
import { listDecks, getDeck, getConfigSummary, listPrograms, retryDeckAi, type ProgramView,
  type DeckVersionView,
} from "../api";
import { cohortRating } from "../../shared/scoring";
import { useActiveContext } from "../activeContext";

interface Kpi {
  label: string;
  value: number;
  sublabel: string;
  progress: number;
}

const PASS_STATUSES = new Set([
  "AI Evaluated",
  "Assigned",
  "Jury Evaluation",
  "Shortlisted",
  "Intro",
  "Signup",
  "Ready to Onboard",
  "Analyst Scoring",
  "Associate Review",
  "Partner Review",
  "Partner Call",
  "Investment DD",
  "IC Review",
  "Term Sheet",
  "Legal DD",
  "Onboard Ready",
]);

function pct(n: number, total: number): number {
  return total === 0 ? 0 : Math.round((n / total) * 100);
}

function computeKpis(decks: DeckView[]): Kpi[] {
  const total = decks.length;
  const evaluated = decks.filter((d) => d.aiScore !== undefined).length;
  const incomplete = decks.filter((d) => d.signal === "flagged" || d.status === "Incomplete").length;
  const pending = decks.filter(
    (d) => d.aiScore === undefined && d.status !== "Incomplete",
  ).length;
  const strong = decks.filter((d) => d.signal === "strong").length;
  const advanced = decks.filter(
    (d) => d.aiScore !== undefined && d.status !== undefined && PASS_STATUSES.has(d.status),
  ).length;
  return [
    { label: "Uploaded", value: total, sublabel: "All submissions", progress: 100 },
    { label: "Pending", value: pending, sublabel: "Awaiting evaluation", progress: pct(pending, total) },
    { label: "Incomplete", value: incomplete, sublabel: "Missing details", progress: pct(incomplete, total) },
    { label: "AI Evaluated", value: evaluated, sublabel: `${pct(evaluated, total)}% of uploaded`, progress: pct(evaluated, total) },
    { label: "Advanced", value: advanced, sublabel: "Passed AI gate", progress: pct(advanced, total) },
    { label: "Strong signal", value: strong, sublabel: "Score ≥ 8.0", progress: pct(strong, total) },
  ];
}

const SIGNAL_COLORS: Record<string, string> = {
  strong: "var(--color-signal-strong)",
  moderate: "var(--color-signal-moderate)",
  weak: "var(--color-signal-weak)",
  absent: "var(--color-signal-absent)",
  flagged: "var(--color-signal-flagged)",
};

export function DashboardPage() {
  const { user } = useAuth();
  const edition = user?.edition ?? "incubator";
  const [ctx, setCtx] = useActiveContext(edition);
  const [decks, setDecks] = useState<DeckView[] | null>(null);
  const [programs, setPrograms] = useState<ProgramView[] | null>(null);
  const [selected, setSelected] = useState<DeckView | null>(null);
  const [report, setReport] = useState<{
    scores: ParamScoreView[];
    extraction: ExtractionSlide[];
    verdict?: string;
    versions?: DeckVersionView[];
    weightedTotal?: number;
  } | null>(null);
  // Cohort thresholds are org config (admin-editable); default to the spec bands
  // until the summary loads.
  const [thresholds, setThresholds] = useState({ best: 7.0, mediocre: 5.0 });
  const [retrying, setRetrying] = useState<string | null>(null);

  // Decks the AI pipeline gave up on (§9) — the credit was refunded and nothing
  // will pick them up again without an operator.
  const stuckDecks = useMemo(() => (decks ?? []).filter((d) => d.aiState === "failed"), [decks]);

  async function retry(deckId: string) {
    setRetrying(deckId);
    try {
      await retryDeckAi(deckId);
      const r = await listDecks({
        programId: ctx.programId ?? undefined,
        cohortId: ctx.cohortId ?? undefined,
      });
      setDecks(r.decks);
    } catch {
      // The row keeps its failed state; the reason is already on screen.
    } finally {
      setRetrying(null);
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
    return () => {
      live = false;
    };
  }, []);

  // Decks re-fetch whenever the active program/cohort filter changes.
  useEffect(() => {
    let live = true;
    setDecks(null);
    listDecks({ programId: ctx.programId ?? undefined, cohortId: ctx.cohortId ?? undefined })
      .then((r) => live && setDecks(r.decks))
      .catch(() => live && setDecks([]));
    return () => {
      live = false;
    };
  }, [ctx.programId, ctx.cohortId]);

  useEffect(() => {
    if (!selected) {
      setReport(null);
      return;
    }
    let live = true;
    getDeck(selected.id)
      .then((r) => live && setReport({ scores: r.scores, extraction: r.extraction, verdict: r.verdict, weightedTotal: r.weightedTotal, versions: r.versions }))
      .catch(() => live && setReport({ scores: [], extraction: [] }));
    return () => {
      live = false;
    };
  }, [selected]);

  const kpis = useMemo(() => computeKpis(decks ?? []), [decks]);

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

  // Pipeline-progress rail: counts per distinct status present (top 5).
  const progress = useMemo(() => {
    const list = decks ?? [];
    const counts = new Map<string, { count: number; signal?: string }>();
    for (const d of list) {
      const key = d.status ?? "Unknown";
      const entry = counts.get(key) ?? { count: 0, signal: d.signal };
      entry.count += 1;
      counts.set(key, entry);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5)
      .map(([label, { count, signal }]) => ({
        label,
        count,
        pct: pct(count, list.length),
        color: SIGNAL_COLORS[signal ?? ""] ?? "var(--color-navy)",
      }));
  }, [decks]);

  if (!user) return null;
  const isAdmin = user.role === "admin" || user.role === "superuser";
  const activeProgram = programs?.find((p) => p.id === ctx.programId) ?? null;
  const cohortOptions = activeProgram?.cohorts ?? [];
  const showFirstRun = programs !== null && programs.length === 0 && isAdmin;

  function selectProgram(programId: string) {
    setCtx({ programId: programId || null, cohortId: null });
  }
  function selectCohort(cohortId: string) {
    setCtx({ programId: ctx.programId, cohortId: cohortId || null });
  }

  return (
    <div className="flex flex-col gap-5 p-5 lg:flex-row">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-fg">All decks</h1>
            <p className="mt-0.5 text-sm text-fg-muted">
              {decks === null ? "Loading…" : `${decks.length} submissions`}
              {activeProgram ? ` · ${activeProgram.name}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="sj-input h-9 w-40"
              aria-label="Program filter"
              value={ctx.programId ?? ""}
              onChange={(e) => selectProgram(e.target.value)}
            >
              <option value="">All Programs</option>
              {(programs ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select
              className="sj-input h-9 w-40 disabled:opacity-50"
              aria-label="Cohort filter"
              value={ctx.cohortId ?? ""}
              disabled={!activeProgram || cohortOptions.length === 0}
              onChange={(e) => selectCohort(e.target.value)}
            >
              <option value="">All Cohorts</option>
              {cohortOptions.map((ch) => (
                <option key={ch.id} value={ch.id}>
                  {ch.name}
                </option>
              ))}
            </select>
            <Button
              variant="secondary"
              size="sm"
              disabled={!decks || decks.length === 0}
              onClick={() => exportDecks(activeProgram?.name ?? "All decks", decks ?? [])}
            >
              Export
            </Button>
          </div>
        </div>

        {showFirstRun && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent/40 bg-accent/5 px-4 py-3">
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
          <div className="mt-4 rounded-lg border border-signal-flagged/40 bg-signal-flagged/5 px-4 py-3">
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

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {kpis.map((k, i) => (
            <KpiTile key={k.label} {...k} active={i === 0} />
          ))}
        </div>

        <Card flush className="mt-5 overflow-x-auto">
          {decks !== null && decks.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon="Upload"
                title="No decks yet"
                description="Upload a pitch deck to run AI extraction and rubric scoring."
              />
            </div>
          ) : (
            <table className="w-full min-w-[36rem] text-left">
              <thead>
                <tr className="text-fg-muted">
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Startup</th>
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">
                    {edition === "incubator" ? "Founder" : "Sector"}
                  </th>
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">City</th>
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">AI score</th>
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Signal</th>
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody>
                {(decks ?? []).map((deck) => (
                  <DeckRow
                    key={deck.id}
                    deck={deck}
                    secondary={edition === "incubator" ? "founder" : "sector"}
                    onClick={setSelected}
                  />
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <aside className="flex w-full shrink-0 flex-col gap-4 lg:w-72">
        <Card>
          <div className="u-label">Pipeline progress</div>
          <div className="mt-3 flex flex-col gap-2.5">
            {progress.length === 0 && <p className="text-xs text-fg-muted">No decks yet.</p>}
            {progress.map((p) => (
              <div key={p.label}>
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 text-fg">
                    <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
                    {p.label}
                  </span>
                  <span className="text-fg-muted">
                    {p.count} · {p.pct}%
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full" style={{ width: `${p.pct}%`, background: p.color }} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <div className="u-label">Cohort rating thresholds</div>
          <ul className="mt-3 flex flex-col gap-1.5 text-sm">
            <li className="flex items-center justify-between gap-2">
              <span className="text-fg">Best</span>
              <span className="flex items-center gap-2">
                <span className="font-mono text-fg-muted">≥ {thresholds.best.toFixed(1)}</span>
                <span className="rounded bg-surface-2 px-1.5 font-mono text-xs text-fg">{ratingCounts.best}</span>
              </span>
            </li>
            <li className="flex items-center justify-between gap-2">
              <span className="text-fg">Mediocre</span>
              <span className="flex items-center gap-2">
                <span className="font-mono text-fg-muted">{thresholds.mediocre.toFixed(1)} – {(thresholds.best - 0.1).toFixed(1)}</span>
                <span className="rounded bg-surface-2 px-1.5 font-mono text-xs text-fg">{ratingCounts.mediocre}</span>
              </span>
            </li>
            <li className="flex items-center justify-between gap-2">
              <span className="text-fg">Poor</span>
              <span className="flex items-center gap-2">
                <span className="font-mono text-fg-muted">&lt; {thresholds.mediocre.toFixed(1)}</span>
                <span className="rounded bg-surface-2 px-1.5 font-mono text-xs text-fg">{ratingCounts.poor}</span>
              </span>
            </li>
          </ul>
        </Card>
      </aside>

      {selected && (
        <EvaluationDrawer
          open
          onClose={() => setSelected(null)}
          deck={selected}
          verdict={report?.verdict}
          scores={report?.scores ?? []}
          extraction={report?.extraction ?? []}
          versions={report?.versions ?? []}
        />
      )}
    </div>
  );
}
