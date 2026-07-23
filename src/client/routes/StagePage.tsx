import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Card,
  Button,
  Badge,
  SignalTag,
  ScoreChip,
  EvaluationDrawer,
  EmptyState,
  type ParamScoreView,
  type ExtractionSlide,
} from "../components";
import type { DeckView, DeckAction } from "../types";
import {
  listDecks,
  getDeck,
  transitionDeck,
  sendSignup,
} from "../api";

export interface StageConfig {
  title: string;
  subtitle: string;
  /** Raw stage ids this screen shows. */
  statuses: string[];
  /** Empty-state copy when no deck matches. */
  emptyTitle?: string;
  emptyDescription?: string;
  /** Second column label + field. */
  secondary?: { label: string; field: "founder" | "sector" };
  /** Hide the Action column (read-only screens like Archive). */
  readOnly?: boolean;
}

// Actions handled by dedicated screens rather than inline buttons here.
const EXCLUDED_ACTIONS = new Set(["assign_jury"]);

/**
 * Generic pipeline-stage screen: a deck table filtered to a set of stages with
 * inline role-gated transition buttons and the shared Evaluation drawer. Powers
 * the incubator Jury Pipeline / Intro calls / For Sign up / Sign up Pipeline /
 * Onboard ready / Archive nav slugs (config-driven).
 */
export function StagePage({ config }: { config: StageConfig }) {
  const [decks, setDecks] = useState<DeckView[] | null>(null);
  const [selected, setSelected] = useState<DeckView | null>(null);
  const [report, setReport] = useState<{
    scores: ParamScoreView[];
    extraction: ExtractionSlide[];
    verdict?: string;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      .then((r) => live && setReport({ scores: r.scores, extraction: r.extraction, verdict: r.verdict }))
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
      else await transitionDeck(deck.id, action.action);
      await load();
    } catch {
      setError(`Couldn't ${action.label.toLowerCase()}. Try again.`);
    } finally {
      setBusy(null);
    }
  }

  const secondary = config.secondary ?? { label: "Founder", field: "founder" as const };

  return (
    <div className="flex flex-col gap-5 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-fg">{config.title}</h1>
          <p className="mt-0.5 max-w-2xl text-sm text-fg-muted">{config.subtitle}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone="info">{rows.length}</Badge>
          <Button variant="secondary" size="sm">Export</Button>
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
          <table className="w-full min-w-[40rem] text-left">
            <thead>
              <tr className="text-fg-muted">
                <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Startup</th>
                <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">{secondary.label}</th>
                <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">AI score</th>
                <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Signal</th>
                <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Status</th>
                {!config.readOnly && (
                  <th className="px-4 py-2.5 text-right text-xs font-medium uppercase tracking-wide">Action</th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((deck) => {
                const actions = (deck.actions ?? []).filter((a) => !EXCLUDED_ACTIONS.has(a.action));
                return (
                  <tr key={deck.id} className="border-t border-line">
                    <td className="cursor-pointer px-4 py-3" onClick={() => setSelected(deck)}>
                      <div className="font-medium text-fg hover:underline">{deck.name}</div>
                      <div className="mt-0.5 text-xs text-fg-muted">
                        {[deck.sector, deck.stage, deck.city].filter(Boolean).join(" · ")}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-fg-muted">{deck[secondary.field] ?? "—"}</td>
                    <td className="px-4 py-3"><ScoreChip value={deck.aiScore} /></td>
                    <td className="px-4 py-3">{deck.signal ? <SignalTag signal={deck.signal} /> : null}</td>
                    <td className="px-4 py-3 text-sm text-fg-muted">{deck.status ?? "—"}</td>
                    {!config.readOnly && (
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
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

/** Config for each incubator stage nav slug rendered by StagePage. */
export const INCUBATOR_STAGE_CONFIG: Record<string, StageConfig> = {
  jurypipeline: {
    title: "Jury Pipeline",
    subtitle:
      "Track every deck through jury evaluation — AI vs jury scoring, assignment and final decision.",
    statuses: ["assigned", "jury_evaluation", "shortlisted", "rejected"],
    emptyTitle: "No decks in jury evaluation",
    emptyDescription: "Assigned decks appear here for Score / Shortlist / Reject.",
  },
  introcalls: {
    title: "Intro calls",
    subtitle:
      "All shortlisted startups · click a name to view the deck, click the AI score for the full parameter breakdown.",
    statuses: ["shortlisted", "intro"],
    emptyTitle: "No intro calls yet",
    emptyDescription: "Shortlisted startups move here to schedule an intro call.",
  },
  forsignup: {
    title: "For Sign up",
    subtitle: "Shortlisted startups moving into onboarding — track sign-up status and action each one.",
    statuses: ["intro", "signup"],
    emptyTitle: "Nothing awaiting sign-up",
    emptyDescription: "Decks with a scheduled intro call appear here to send the sign-up invite.",
  },
  incuration: {
    title: "Sign up Pipeline",
    subtitle: "Signed-up startups being curated for the cohort — track payment and document readiness.",
    statuses: ["signup"],
    emptyTitle: "No sign-ups in progress",
    emptyDescription: "Startups sent a sign-up invite appear here until they complete it.",
  },
  curation: {
    title: "Onboard ready",
    subtitle:
      "Onboarded startups being actively curated through the cohort — mentorship, milestones and demo-day readiness.",
    statuses: ["onboard_ready"],
    emptyTitle: "No startups onboarded yet",
    emptyDescription: "Startups that complete sign-up land here, ready to onboard.",
  },
  archive: {
    title: "Archive",
    subtitle:
      "Startups removed from the active pipeline — rejected, withdrawn or graduated.",
    statuses: ["rejected", "archived"],
    readOnly: true,
    emptyTitle: "Archive is empty",
    emptyDescription: "Rejected and archived decks are kept here for the record.",
  },
};
