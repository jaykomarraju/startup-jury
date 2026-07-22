import { useEffect, useMemo, useState } from "react";
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
import { listDecks, getDeck } from "../api";

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
  const [decks, setDecks] = useState<DeckView[] | null>(null);
  const [selected, setSelected] = useState<DeckView | null>(null);
  const [report, setReport] = useState<{
    scores: ParamScoreView[];
    extraction: ExtractionSlide[];
    verdict?: string;
    weightedTotal?: number;
  } | null>(null);

  useEffect(() => {
    let live = true;
    listDecks()
      .then((r) => live && setDecks(r.decks))
      .catch(() => live && setDecks([]));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!selected) {
      setReport(null);
      return;
    }
    let live = true;
    getDeck(selected.id)
      .then((r) => live && setReport({ scores: r.scores, extraction: r.extraction, verdict: r.verdict, weightedTotal: r.weightedTotal }))
      .catch(() => live && setReport({ scores: [], extraction: [] }));
    return () => {
      live = false;
    };
  }, [selected]);

  const kpis = useMemo(() => computeKpis(decks ?? []), [decks]);

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
  const edition = user.edition;

  return (
    <div className="flex flex-col gap-5 p-5 lg:flex-row">
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-fg">All decks</h1>
            <p className="mt-0.5 text-sm text-fg-muted">
              {decks === null ? "Loading…" : `${decks.length} submissions`}
            </p>
          </div>
          <Button variant="secondary" size="sm">Export</Button>
        </div>

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
            <li className="flex justify-between"><span className="text-fg">Best</span><span className="font-mono text-fg-muted">≥ 7.0</span></li>
            <li className="flex justify-between"><span className="text-fg">Mediocre</span><span className="font-mono text-fg-muted">5.0 – 6.9</span></li>
            <li className="flex justify-between"><span className="text-fg">Poor</span><span className="font-mono text-fg-muted">&lt; 5.0</span></li>
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
        />
      )}
    </div>
  );
}
