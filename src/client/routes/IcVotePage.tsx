import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, Download, FileBarChart, Users, ClipboardCheck } from "lucide-react";
import {
  Card,
  Button,
  Badge,
  EmptyState,
  EvaluationReportModal,
  PageToolbar,
  ToolbarButton,
} from "../components";
import { useAuth } from "../auth/useAuth";
import type { DeckView, DeckAction } from "../types";
import {
  listDecks,
  listIcVotes,
  castIcVote,
  transitionDeck,
  IC_VOTE_LABELS,
  type DeckReportMatrix,
  type IcVotes,
  type IcVoteValue,
} from "../api";
import { exportDecks } from "../exportCsv";
import {
  AllScores,
  BandScore,
  DetailPane,
  FilterMenu,
  StageFooter,
  usePaneEvaluation,
  useReportMatrices,
  type LegendItem,
  type PaneTab,
} from "./StageKit";
import { ChecklistTab, DdBadge, StageChip, ToneSelect, loadDeals } from "./VcDiligence";
import type { StageContext, StageRow } from "./StagePage";
import type { DealView } from "../../shared/diligence";

const VOTE_OPTIONS: IcVoteValue[] = ["invest", "hold", "need_more_info", "pass"];

const VOTE_TONE: Record<IcVoteValue, "positive" | "amber" | "info" | "danger"> = {
  invest: "positive",
  hold: "amber",
  need_more_info: "info",
  pass: "danger",
};

/** `.icq-rec.go / .hold / .info / .no`. */
const SELECT_TONE: Record<IcVoteValue, "go" | "hold" | "info" | "no"> = {
  invest: "go",
  hold: "hold",
  need_more_info: "info",
  pass: "no",
};

/** `panel-icpipeline` legend (`.jp-legend`), each entry decoding a recommendation. */
export const IC_LEGEND: LegendItem[] = [
  { label: "Invest", color: "var(--green)", statuses: ["invest"] },
  { label: "Hold", color: "var(--gold-dk)", statuses: ["hold"] },
  { label: "Need more info", color: "#2D7DD2", statuses: ["need_more_info"] },
  { label: "Pass", color: "var(--red)", statuses: ["pass"] },
];

const SUBTITLE = "Decision Queue — Investment Committee review, scoring and final recommendation";

/** The roles `POST /api/decks/:id/ic-vote` admits (superuser always). */
const VOTERS = ["ic_member", "partner", "admin", "superuser"];

/**
 * `icAddlAvgAll` — the IC member's headline additional-parameter score: the mean
 * of every other role's additional-parameter scores on the deck (the IC
 * member's own lens excluded, as the prototype excludes it). Null when nobody
 * has scored one yet.
 */
export function addlMeanAcrossRoles(matrix: DeckReportMatrix | null | undefined, ownRole = "ic_member"): number | null {
  let sum = 0;
  let n = 0;
  for (const group of matrix?.additional ?? []) {
    if (group.role === ownRole) continue;
    for (const row of group.rows) {
      for (const cell of Object.values(row.cells)) {
        if (typeof cell?.value === "number" && Number.isFinite(cell.value)) {
          sum += cell.value;
          n += 1;
        }
      }
    }
  }
  return n ? sum / n : null;
}

const PANE_TABS: PaneTab[] = [
  { id: "committee", label: "Committee", icon: <Users className="h-3.5 w-3.5" aria-hidden="true" /> },
  { id: "checklist", label: "Checklist", icon: <ClipboardCheck className="h-3.5 w-3.5" aria-hidden="true" /> },
  { id: "scores", label: "All scores" },
];

/**
 * IC Pipeline (Due Diligence → IC Pipeline) — `panel-icpipeline` / `icqRender`.
 *
 * The committee's decision queue as the prototype draws it: one wide table of
 * decks in `ic_review` / `mp_decision` — Startup · Sector · Stage · AI score ·
 * Avg. score · Addl. parameters · DD · Ask · Valuation · Recommendation — with
 * the Filter / Export toolbar and the legend-and-count footer.
 *
 * The last column is the viewer's own IC vote (`ic_votes`, the same four words).
 * The IC member's build heads it "Status" and draws it read-only with a
 * per-row Archive (`AISJ_VC_IC_member_V2`), so that role gets that. Casting
 * with a rationale, the tally, every ballot and the Managing Partner's moves
 * live in the row's slide-over, which the startup name opens; the DD badge
 * opens the same slide-over on the diligence checklist.
 */
export function IcVotePage() {
  const { user } = useAuth();
  const role = user?.role;
  const [decks, setDecks] = useState<DeckView[] | null>(null);
  const [deals, setDeals] = useState<Record<string, DealView>>({});
  const [votes, setVotes] = useState<Record<string, IcVotes | null>>({});
  const [pane, setPane] = useState<{ deckId: string; tab: string } | null>(null);
  const [reportFor, setReportFor] = useState<{ deck: DeckView; tab: "core" | "additional" } | null>(null);
  const [filterId, setFilterId] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isMember = role === "ic_member";
  const canVote = !!role && VOTERS.includes(role);

  const loadVotes = useCallback((deckId: string) => {
    return listIcVotes(deckId)
      .then((v) => setVotes((all) => ({ ...all, [deckId]: v })))
      .catch(() => setVotes((all) => ({ ...all, [deckId]: null })));
  }, []);

  const load = useCallback(async () => {
    const [list, record] = await Promise.all([
      listDecks()
        .then((r) => r.decks)
        .catch(() => [] as DeckView[]),
      loadDeals(),
    ]);
    setDecks(list);
    setDeals(record);
    await Promise.all(
      list.filter((d) => d.statusId === "ic_review" || d.statusId === "mp_decision").map((d) => loadVotes(d.id)),
    );
  }, [loadVotes]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(
    () => (decks ?? []).filter((d) => d.statusId === "ic_review" || d.statusId === "mp_decision"),
    [decks],
  );

  /** What the last column shows: the viewer's own vote. */
  const shownVote = useCallback((deck: DeckView): IcVoteValue | null => votes[deck.id]?.myVote ?? null, [votes]);

  const filters = IC_LEGEND.map((l) => ({
    id: l.label,
    label: l.label,
    match: (d: DeckView) => l.statuses!.includes(shownVote(d) ?? ""),
  }));
  const activeFilter = filters.find((f) => f.id === filterId);
  const shown = activeFilter ? rows.filter(activeFilter.match) : rows;

  // F0599 — only the IC member's build draws the cross-role number, so only they pay for the reports.
  const matrices = useReportMatrices(
    rows.map((d) => d.id),
    isMember,
  );

  const paneDeck = pane ? rows.find((d) => d.id === pane.deckId) : undefined;
  const paneEval = usePaneEvaluation(paneDeck && pane?.tab === "scores" ? paneDeck.id : null);

  async function vote(deck: DeckView, v: IcVoteValue, rationale?: string) {
    setBusy(true);
    setError(null);
    try {
      await castIcVote(deck.id, v, rationale);
      if (rationale !== undefined) setComment("");
      await loadVotes(deck.id);
    } catch {
      setError("Couldn't record your vote. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function runAction(deck: DeckView, action: DeckAction) {
    setBusy(true);
    setError(null);
    try {
      await transitionDeck(deck.id, action.action);
      await load();
    } catch {
      setError(`Couldn't ${action.label.toLowerCase()}. Try again.`);
    } finally {
      setBusy(false);
    }
  }

  const ctx: StageContext = {
    role,
    busy,
    reload: load,
    openTab: (deck, tab) => setPane({ deckId: deck.id, tab }),
    openReport: (deck, tab) => setReportFor({ deck, tab }),
    runAction,
    fail: setError,
  };

  const headers = [
    "Startup",
    "Sector",
    "Stage",
    "AI score",
    "Avg. score",
    "Addl. parameters",
    "DD",
    "Ask",
    "Valuation",
    isMember ? "Status" : "Recommendation",
  ];
  const investCount = rows.filter((d) => shownVote(d) === "invest").length;
  const stat = `${rows.length} ${rows.length === 1 ? "startup" : "startups"} in the decision queue · ${investCount} marked Invest`;

  return (
    <section className="sj-frame">
      <PageToolbar
        title="IC Pipeline"
        subtitle={SUBTITLE}
        actions={
          <>
            <FilterMenu options={filters} value={activeFilter ? filterId : null} onChange={setFilterId} />
            <ToolbarButton disabled={shown.length === 0} onClick={() => exportDecks("IC Pipeline", shown)}>
              <Download className="h-3 w-3" aria-hidden="true" />
              Export
            </ToolbarButton>
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
              {decks !== null && shown.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    icon="Vote"
                    title={activeFilter ? "No startups match this filter" : "Nothing at IC"}
                    description={
                      activeFilter
                        ? `Nothing in the decision queue is "${activeFilter.label}" right now.`
                        : "Sponsored deals appear here for the committee."
                    }
                  />
                </div>
              ) : (
                <table className="w-full text-left" style={{ minWidth: "74rem" }}>
                  <thead>
                    <tr className="text-fg-muted">
                      {headers.map((h) => (
                        <th key={h} className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((deck) => {
                      const deal = deals[deck.id];
                      const mine = shownVote(deck);
                      const archive = (deck.actions ?? []).find((a) => a.to === "archived");
                      return (
                        <tr
                          key={deck.id}
                          className={`border-t border-line align-top ${pane?.deckId === deck.id ? "bg-surface-2" : ""}`}
                        >
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              className="text-left font-medium text-fg hover:underline"
                              aria-expanded={pane?.deckId === deck.id}
                              onClick={() => setPane({ deckId: deck.id, tab: "committee" })}
                            >
                              {deck.name}
                            </button>
                            <div className="mt-0.5 text-xs text-fg-muted">
                              {deck.statusId === "mp_decision" ? "MP decision" : "Awaiting votes"}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm text-fg-muted">{deck.sector ?? "—"}</td>
                          <td className="px-4 py-3">
                            <StageChip>{deck.stage}</StageChip>
                          </td>
                          <td className="px-4 py-3">
                            <button type="button" title="Open the core parameter report" onClick={() => setReportFor({ deck, tab: "core" })}>
                              <BandScore value={deck.aiScore} suffix="/10" />
                            </button>
                          </td>
                          <td className="px-4 py-3">
                            <button type="button" title="Open the core parameter report" onClick={() => setReportFor({ deck, tab: "core" })}>
                              <BandScore value={deck.decisionScore} />
                            </button>
                          </td>
                          <td className="px-4 py-3">
                            {isMember ? (
                              <div className="flex items-center gap-2 whitespace-nowrap">
                                <BandScore value={addlMeanAcrossRoles(matrices[deck.id]) ?? undefined} suffix="/10" />
                                <Button size="sm" variant="secondary" onClick={() => setReportFor({ deck, tab: "additional" })}>
                                  Details
                                </Button>
                              </div>
                            ) : (
                              <Button size="sm" variant="secondary" onClick={() => setReportFor({ deck, tab: "additional" })}>
                                <FileBarChart className="mr-1 h-3.5 w-3.5" /> View scores
                              </Button>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <DdBadge summary={deal?.investment} onOpen={() => setPane({ deckId: deck.id, tab: "checklist" })} />
                          </td>
                          <td className="px-4 py-3 font-mono text-sm font-semibold text-navy">{deal?.ask ?? "—"}</td>
                          <td className="px-4 py-3 font-mono text-sm font-semibold text-navy">{deal?.valuation ?? "—"}</td>
                          <td className="px-4 py-3">
                            {isMember ? (
                              <div className="flex items-center gap-2">
                                {mine ? (
                                  <Badge tone={VOTE_TONE[mine]}>{IC_VOTE_LABELS[mine]}</Badge>
                                ) : (
                                  <span className="text-xs text-fg-muted">Not set</span>
                                )}
                                {archive && (
                                  <Button size="sm" variant="secondary" disabled={busy} title="Archive this deck" onClick={() => runAction(deck, archive)}>
                                    <Archive className="mr-1 h-3 w-3" /> Archive
                                  </Button>
                                )}
                              </div>
                            ) : (
                              <ToneSelect
                                label={`Recommendation for ${deck.name}`}
                                value={mine}
                                tone={mine ? SELECT_TONE[mine] : "plain"}
                                placeholder="— recommend —"
                                options={VOTE_OPTIONS.map((v) => ({ value: v, label: IC_VOTE_LABELS[v] }))}
                                disabled={busy || !canVote || deck.statusId !== "ic_review"}
                                onChange={(v) => v && v !== mine && vote(deck, v)}
                              />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </Card>
          </div>
          <StageFooter stat={decks === null ? undefined : stat} legend={IC_LEGEND} />
        </div>

        {paneDeck && pane && (
          <DetailPane
            title={paneDeck.name}
            meta={[paneDeck.sector, paneDeck.stage, paneDeck.city].filter(Boolean).join(" · ")}
            tabs={PANE_TABS}
            active={pane.tab}
            onTab={(tab) => setPane({ deckId: paneDeck.id, tab })}
            onClose={() => setPane(null)}
          >
            {pane.tab === "checklist" ? (
              <ChecklistTab
                row={{ deck: paneDeck, extra: deals[paneDeck.id] } satisfies StageRow}
                ctx={ctx}
                track="investment"
              />
            ) : pane.tab === "scores" ? (
              <AllScores deck={paneDeck} scores={paneEval?.scores ?? null} />
            ) : (
              <CommitteeTab
                deck={paneDeck}
                votes={votes[paneDeck.id] ?? null}
                canVote={canVote}
                busy={busy}
                comment={comment}
                onComment={setComment}
                onVote={(v) => vote(paneDeck, v, comment.trim() || undefined)}
                onAction={(a) => runAction(paneDeck, a)}
              />
            )}
          </DetailPane>
        )}
      </div>

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

/** The slide-over's Committee tab — the tally, the viewer's vote with a rationale, the ballots, the MP's moves. */
function CommitteeTab({
  deck,
  votes,
  canVote,
  busy,
  comment,
  onComment,
  onVote,
  onAction,
}: {
  deck: DeckView;
  votes: IcVotes | null;
  canVote: boolean;
  busy: boolean;
  comment: string;
  onComment: (v: string) => void;
  onVote: (v: IcVoteValue) => void;
  onAction: (a: DeckAction) => void;
}) {
  return (
    <div className="flex flex-col gap-4" data-testid="pane-committee">
      {votes?.recommendation && (
        <div className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-xs">
          <span className="text-fg-muted">Committee lean</span>
          <span className="font-semibold text-accent">{IC_VOTE_LABELS[votes.recommendation]}</span>
        </div>
      )}

      <div>
        <div className="u-label mb-2">Vote tally · {votes?.total ?? 0} cast</div>
        <div className="grid grid-cols-2 gap-2">
          {VOTE_OPTIONS.map((v) => (
            <div key={v} className="rounded-lg border border-line px-3 py-2">
              <div className="font-mono text-xl font-bold text-fg">{votes?.tally[v] ?? 0}</div>
              <div className="text-xs text-fg-muted">{IC_VOTE_LABELS[v]}</div>
            </div>
          ))}
        </div>
      </div>

      {deck.statusId === "ic_review" && canVote && (
        <div>
          <div className="u-label mb-2">Your vote{votes?.myVote ? ` · ${IC_VOTE_LABELS[votes.myVote]}` : ""}</div>
          <div className="flex flex-wrap gap-2">
            {VOTE_OPTIONS.map((v) => (
              <Button
                key={v}
                size="sm"
                variant={votes?.myVote === v ? "primary" : "secondary"}
                disabled={busy}
                onClick={() => onVote(v)}
              >
                {IC_VOTE_LABELS[v]}
              </Button>
            ))}
          </div>
          <textarea
            className="sj-input mt-2 min-h-[3rem] text-sm"
            value={comment}
            onChange={(e) => onComment(e.target.value)}
            placeholder="Add a rationale (optional) — attached to your vote…"
          />
        </div>
      )}

      {votes && votes.votes.length > 0 && (
        <div>
          <div className="u-label mb-2">Ballots</div>
          <ul className="flex flex-col divide-y divide-line">
            {votes.votes.map((b) => (
              <li key={b.id} className="flex items-start justify-between gap-2 py-2">
                <div className="min-w-0">
                  <div className="text-sm text-fg">{b.memberName}</div>
                  {b.comment && <div className="mt-0.5 text-xs text-fg-muted">{b.comment}</div>}
                </div>
                <Badge tone={VOTE_TONE[b.vote]}>{IC_VOTE_LABELS[b.vote]}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(deck.actions ?? []).length > 0 && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3" data-testid="pane-stage-actions">
          {(deck.actions ?? []).map((a) => (
            <Button
              key={a.action}
              size="sm"
              variant={a.to === "archived" || a.to === "partner_review" ? "secondary" : "primary"}
              disabled={busy}
              onClick={() => onAction(a)}
            >
              {a.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
