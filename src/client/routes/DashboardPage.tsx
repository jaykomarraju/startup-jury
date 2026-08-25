import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import { useAuth } from "../auth/useAuth";
import {
  KpiTile,
  Card,
  Button,
  Badge,
  EvaluationDrawer,
  EmptyState,
  TagEditor,
  type ParamScoreView,
  type ExtractionSlide,
} from "../components";
import type { DeckView } from "../types";
import { exportDecks } from "../exportCsv";
import {
  listDecks,
  getDeck,
  getConfigSummary,
  listPrograms,
  listDeckTags,
  setDeckTags,
  listActivity,
  retryDeckAi,
  type ProgramView,
  type DeckVersionView,
  type ActivityEvent,
} from "../api";
import { cohortRating } from "../../shared/scoring";
import { deckStats, matchesStat, pipelineProgress, type DeckStatKey } from "../../shared/deckStats";
import { useActiveContext } from "../activeContext";

/** "14 min ago" / "3 hr ago" / a date once it stops being today's news. */
function relativeTime(iso: string): string {
  const then = Date.parse(iso.endsWith("Z") || iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
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
 * All decks (Workflows → All decks).
 *
 * Aug-2026 issue log:
 *   • 2 — search box + tag filter, with per-deck tagging in the report drawer.
 *   • 3 — Export, Program and Cohort controls on the top row.
 *   • 4/5 — the fifth and sixth stat boxes are Assigned and Shortlisted.
 *   • 6 — the table is Startup · Founder name · Email ID · Phone · City ·
 *         Sector · Status. No AI score column at this stage.
 *   • 7 — the right rail's Pipeline progress uses the stat-box titles.
 *   • 8 — an Activity log sits under Cohort rating thresholds.
 */
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

  // Issue 2 — search & tag.
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [allTags, setAllTags] = useState<string[]>([]);
  const [taggingBusy, setTaggingBusy] = useState(false);

  // Issue 4/5 — the stat boxes double as a table filter, as in the prototype.
  const [statFilter, setStatFilter] = useState<DeckStatKey>("all");

  // Issue 8 — the activity log.
  const [activity, setActivity] = useState<ActivityEvent[] | null>(null);

  // Decks the AI pipeline gave up on (§9) — the credit was refunded and nothing
  // will pick them up again without an operator.
  const stuckDecks = useMemo(() => (decks ?? []).filter((d) => d.aiState === "failed"), [decks]);

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

  // Decks re-fetch whenever a filter changes.
  useEffect(() => {
    let live = true;
    setDecks(null);
    reload()
      .then((d) => live && setDecks(d))
      .catch(() => live && setDecks([]));
    return () => {
      live = false;
    };
  }, [reload]);

  // Activity log follows the program/cohort filter so it matches the table.
  useEffect(() => {
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

  const stats = useMemo(() => deckStats(edition, decks ?? []), [edition, decks]);
  const progress = useMemo(() => pipelineProgress(stats), [stats]);
  const uploadedTotal = stats[0]?.value ?? 0;

  const rows = useMemo(
    () => (decks ?? []).filter((d) => matchesStat(edition, d, statFilter)),
    [decks, edition, statFilter],
  );

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
  const activeProgram = programs?.find((p) => p.id === ctx.programId) ?? null;
  const cohortOptions = activeProgram?.cohorts ?? [];
  const showFirstRun = programs !== null && programs.length === 0 && isAdmin;
  const canTag = user.role !== "founder";
  const filtering = debouncedSearch !== "" || tagFilter !== "" || statFilter !== "all";

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
          {/* Issue 3 — Export + Program + Cohort on the top row, alongside the
              issue-2 search and tag controls. */}
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative">
              <span className="sr-only">Search decks</span>
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />
              <input
                className="sj-input h-9 w-44 pl-8"
                type="search"
                placeholder="Search startups…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <select
              className="sj-input h-9 w-28"
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
            <select
              className="sj-input h-9 w-36"
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
              className="sj-input h-9 w-36 disabled:opacity-50"
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
              disabled={!decks || rows.length === 0}
              onClick={() => exportDecks(activeProgram?.name ?? "All decks", rows)}
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
          {stats.map((s) => (
            <KpiTile
              key={s.key}
              label={s.label}
              value={s.value}
              sublabel={s.sublabel}
              progress={s.progress}
              barColor={s.color}
              active={statFilter === s.key}
              onClick={() => setStatFilter(s.key)}
            />
          ))}
        </div>

        <Card flush className="mt-5 overflow-x-auto">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
            <div className="u-label">
              {stats.find((s) => s.key === statFilter)?.label ?? "Uploaded"} · {rows.length}
            </div>
            {filtering && (
              <button
                type="button"
                className="text-xs text-fg-muted underline-offset-2 hover:text-fg hover:underline"
                onClick={() => {
                  setSearch("");
                  setTagFilter("");
                  setStatFilter("all");
                }}
              >
                Clear filters
              </button>
            )}
          </div>
          {decks !== null && rows.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon="Upload"
                title={filtering ? "No decks match those filters" : "No decks yet"}
                description={
                  filtering
                    ? "Try a different search term, tag or stat box."
                    : "Upload a pitch deck to run AI extraction and rubric scoring."
                }
              />
            </div>
          ) : (
            <table className="w-full min-w-[56rem] text-left">
              <thead>
                <tr className="text-fg-muted">
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Startup</th>
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Founder name</th>
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Email ID</th>
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Phone</th>
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">City</th>
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Sector</th>
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((deck) => (
                  <tr
                    key={deck.id}
                    onClick={() => setSelected(deck)}
                    className="cursor-pointer border-t border-line hover:bg-surface-2"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-fg">{deck.name}</div>
                      <div className="mt-0.5 text-xs text-fg-muted">
                        {[deck.stage, deck.programName, deck.cohortName].filter(Boolean).join(" · ")}
                      </div>
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
                    <td className="px-4 py-3 text-sm text-fg-muted">{deck.founder ?? "—"}</td>
                    <td className="px-4 py-3 text-sm text-fg-muted">{deck.founderEmail ?? "—"}</td>
                    <td className="px-4 py-3 text-sm text-fg-muted">{deck.founderPhone ?? "—"}</td>
                    <td className="px-4 py-3 text-sm text-fg-muted">{deck.city ?? "—"}</td>
                    <td className="px-4 py-3 text-sm text-fg-muted">{deck.sector ?? "—"}</td>
                    <td className="px-4 py-3 text-sm text-fg-muted">
                      {deck.status ?? "—"}
                      {deck.aiState === "failed" ? (
                        <div className="mt-0.5 text-xs text-signal-flagged">
                          Failed{deck.aiError ? ` · ${deck.aiError}` : ""}
                        </div>
                      ) : deck.aiState === "retrying" ? (
                        <div className="mt-0.5 text-xs text-amber">Retrying</div>
                      ) : deck.aiState === "in_progress" ? (
                        <div className="mt-0.5 text-xs text-fg-muted">In progress</div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <aside className="flex w-full shrink-0 flex-col gap-4 lg:w-72">
        <Card>
          <div className="u-label">Pipeline progress</div>
          <p className="mt-1 text-xs text-fg-muted">
            {uploadedTotal} deck{uploadedTotal === 1 ? "" : "s"} uploaded · across {progress.length}{" "}
            stages
          </p>
          <div className="mt-3 flex flex-col gap-2.5">
            {progress.map((p) => (
              <div key={p.key}>
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 text-fg">
                    <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
                    {p.label}
                  </span>
                  <span className="text-fg-muted">
                    {p.value} · {p.progress}%
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${p.progress}%`, background: p.color }}
                  />
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

        {/* Issue 8 — Activity log, directly under Cohort rating thresholds. */}
        <Card>
          <div className="u-label">Activity log</div>
          <div className="mt-3 flex flex-col gap-3">
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
                    {e.actorTitle ? (
                      <span className="text-fg-muted"> ({e.actorTitle})</span>
                    ) : null}{" "}
                    moved <span className="font-medium">{e.deckName}</span> to {e.toLabel}
                  </p>
                  <p className="mt-0.5 text-[11px] text-fg-muted">{relativeTime(e.createdAt)}</p>
                </div>
              </div>
            ))}
          </div>
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
    </div>
  );
}
