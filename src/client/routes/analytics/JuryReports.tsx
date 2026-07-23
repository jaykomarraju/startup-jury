// Jury-personal reports (exclusive to the logged-in jury member): My decks
// summary, My scores (vs AI baseline), My scores drift.
import { getMyDecks, getMyReportScores, getMyDrift } from "../../api";
import { Badge } from "../../components";
import {
  useReport,
  ReportShell,
  ReportBody,
  StatTiles,
  DriftBars,
  Section,
  Narrative,
  Table,
} from "./AnalyticsKit";

export function RepDecksPage() {
  const state = useReport(getMyDecks);
  return (
    <ReportShell
      title="My decks summary"
      subtitle="Your evaluation activity at a glance."
      context="Personal"
      caption="Decks you have scored and how they progressed through the pipeline."
    >
      <ReportBody state={state} title="evaluations" icon="ChartBar" isEmpty={(d) => d.evaluated === 0} emptyMessage="Score a deck to see your activity here.">
        {(d) => (
          <div className="flex flex-col gap-4">
            <StatTiles
              stats={[
                { label: "Decks evaluated", value: d.evaluated },
                { label: "Avg given", value: d.avgGiven.toFixed(1), sublabel: "your mean / 10" },
                { label: "Shortlisted", value: d.shortlisted, sublabel: "advanced" },
                { label: "Pending", value: d.pending, sublabel: "awaiting your score" },
              ]}
            />
            <Section title="Decks you scored">
              <Table
                cols={["Startup", "Your score", "Status"]}
                rows={d.decks.map((r) => [
                  <span className="font-medium">{r.name}</span>,
                  <span className="font-mono">{r.score.toFixed(1)}</span>,
                  <Badge tone="neutral">{r.status.replace(/_/g, " ")}</Badge>,
                ])}
              />
            </Section>
          </div>
        )}
      </ReportBody>
    </ReportShell>
  );
}

export function RepScoresPage() {
  const state = useReport(getMyReportScores);
  return (
    <ReportShell
      title="My Scores"
      subtitle="How you scored each deck vs the AI baseline."
      context="Personal"
      caption="Your submitted weighted score alongside the AI pre-score for each deck."
    >
      <ReportBody state={state} title="scores" icon="FileText" isEmpty={(d) => d.rows.length === 0} emptyMessage="Score a deck to compare against the AI baseline.">
        {(d) => (
          <Section title="Your scores vs AI">
            <Table
              cols={["Startup", "AI", "You", "Δ"]}
              rows={d.rows.map((r) => {
                const delta = r.ai === null ? null : r.mine - r.ai;
                return [
                  <span className="font-medium">{r.name}</span>,
                  <span className="font-mono">{r.ai === null ? "—" : r.ai.toFixed(1)}</span>,
                  <span className="font-mono">{r.mine.toFixed(1)}</span>,
                  <span className="font-mono" style={{ color: (delta ?? 0) >= 0 ? "var(--color-positive)" : "var(--color-signal-flagged)" }}>
                    {delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)}`}
                  </span>,
                ];
              })}
            />
          </Section>
        )}
      </ReportBody>
    </ReportShell>
  );
}

export function RepDriftPage() {
  const state = useReport(getMyDrift);
  return (
    <ReportShell
      title="My scores drift"
      subtitle="Where your scores run above or below the AI score."
      context="Personal"
      caption="Net drift = your score − the AI pre-score, per deck."
    >
      <ReportBody state={state} title="drift" icon="TrendingUp" isEmpty={(d) => d.rows.length === 0} emptyMessage="Score a deck to see your drift against the AI baseline.">
        {(d) => (
          <div className="flex flex-col gap-4">
            <StatTiles
              stats={[
                { label: "Avg drift", value: `${d.avgDrift > 0 ? "+" : ""}${d.avgDrift.toFixed(1)}`, sublabel: "you vs AI" },
                { label: "Above AI", value: d.rows.filter((r) => r.drift > 0).length },
                { label: "Below AI", value: d.revisedDown },
                { label: "Same band", value: `${d.agreement}%` },
              ]}
            />
            <Section title="Your drift by deck">
              <DriftBars rows={d.rows.map((r) => ({ name: r.name, drift: r.drift }))} />
            </Section>
            <Narrative>
              Your scores drift {d.avgDrift > 0 ? "+" : ""}
              {d.avgDrift.toFixed(1)} on average versus the AI pre-score, landing in the same signal band {d.agreement}%
              of the time.
            </Narrative>
          </div>
        )}
      </ReportBody>
    </ReportShell>
  );
}
