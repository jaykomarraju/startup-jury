// Incubator analytics screens: Cohort summary, Evaluator scores, Score drift, and
// the shared Pipeline funnel (used by both editions). Data comes from
// /api/analytics/* (pure aggregation in src/shared/analytics.ts).
import { useAuth } from "../../auth/useAuth";
import { Badge } from "../../components";
import {
  getCohortSummary,
  getEvaluatorScores,
  getScoreDrift,
  getFunnel,
} from "../../api";
import {
  useReport,
  ReportShell,
  ReportBody,
  StatTiles,
  BarList,
  FunnelBars,
  DriftBars,
  Section,
  Narrative,
  Table,
} from "./AnalyticsKit";

const BAND_COLORS = [
  "var(--color-signal-strong)",
  "var(--color-signal-strong)",
  "var(--color-signal-moderate)",
  "var(--color-signal-weak)",
  "var(--color-signal-absent)",
];

const RECO_TONE: Record<string, "positive" | "amber" | "neutral"> = {
  Recommend: "positive",
  "Hold · clarify": "amber",
  Pass: "neutral",
};

// ── Cohort summary ────────────────────────────────────────────────────────────

export function CohortSummaryPage() {
  const state = useReport(getCohortSummary);
  return (
    <ReportShell
      title="Cohort summary"
      subtitle="Aggregate evaluation view across the cohort — scoring distribution, recommendations and sector mix."
      context="Current cohort"
      caption="Weighted AI scores across every uploaded deck · recommendations track pipeline stage · generated for review."
    >
      <ReportBody state={state} title="cohort data" icon="ChartBar" isEmpty={(d) => d.evaluated === 0}>
        {(d) => (
          <div className="flex flex-col gap-4">
            <StatTiles
              stats={[
                { label: "Decks evaluated", value: d.evaluated, sublabel: "AI-scored" },
                { label: "Avg score / 10", value: d.avgScore.toFixed(1), sublabel: "weighted mean" },
                { label: "Recommended", value: d.recommended, sublabel: "advanced past jury" },
                { label: "In clarification", value: d.inClarification, sublabel: "awaiting founder input" },
              ]}
            />
            <div className="grid gap-4 lg:grid-cols-2">
              <Section title="Score distribution">
                <BarList
                  items={d.distribution.map((b, i) => ({ label: b.label, value: b.count, color: BAND_COLORS[i] }))}
                />
              </Section>
              <Section title="Sector mix">
                <BarList items={d.sectorMix.map((s) => ({ label: s.label, value: s.count }))} />
              </Section>
            </div>
            <Section title="Top of cohort — weighted ranking">
              <Table
                cols={["Startup", "Sector · Stage", "Score", "Top driver", "Recommendation"]}
                rows={d.ranking.map((r) => [
                  <span className="font-medium">{r.name}</span>,
                  <span className="text-fg-muted">{[r.sector, r.stage].filter(Boolean).join(" · ") || "—"}</span>,
                  <span className="font-mono">{r.score.toFixed(1)}</span>,
                  r.topParam ?? "—",
                  <Badge tone={RECO_TONE[r.recommendation] ?? "neutral"}>{r.recommendation}</Badge>,
                ])}
              />
            </Section>
            <Narrative>
              {d.recommended} of {d.evaluated} evaluated decks are recommended (avg {d.avgScore.toFixed(1)}/10);{" "}
              {d.inClarification} are held pending founder responses and {d.screenedOut} were screened out. The
              distribution centres on the moderate band — clarification historically lifts held decks by ~1 band.
            </Narrative>
          </div>
        )}
      </ReportBody>
    </ReportShell>
  );
}

// ── Evaluator scores / calibration ────────────────────────────────────────────

export function EvaluatorScoresPage() {
  const state = useReport(getEvaluatorScores);
  return (
    <ReportShell
      title="Evaluator scores"
      subtitle="How each evaluator scores relative to the cohort — surfaces leniency, strictness and calibration gaps."
      context="Calibration"
      caption='"vs cohort" = the evaluator’s mean minus the deck-consensus mean over the decks they scored.'
    >
      <ReportBody state={state} title="evaluator data" icon="Users" isEmpty={(d) => d.evaluators.length === 0}>
        {(d) => (
          <div className="flex flex-col gap-4">
            <StatTiles
              stats={[
                { label: "Active evaluators", value: d.evaluators.length },
                { label: "Avg agreement", value: `${d.avgAgreement}%`, sublabel: "inter-rater" },
                { label: "Most lenient", value: d.mostLenient?.name ?? "—", sublabel: d.mostLenient ? `+${d.mostLenient.vsCohort.toFixed(1)} vs cohort` : undefined },
                { label: "Strictest", value: d.strictest?.name ?? "—", sublabel: d.strictest ? `${d.strictest.vsCohort.toFixed(1)} vs cohort` : undefined },
              ]}
            />
            <Section title="Evaluator calibration">
              <Table
                cols={["Evaluator", "Role", "Decks", "Avg given", "vs cohort", "Agreement"]}
                rows={d.evaluators.map((e) => [
                  <span className="font-medium">{e.name}</span>,
                  <span className="text-fg-muted capitalize">{e.role.replace(/_/g, " ")}</span>,
                  <span className="font-mono">{e.decksScored}</span>,
                  <span className="font-mono">{e.avgGiven.toFixed(1)}</span>,
                  <span className="font-mono" style={{ color: e.vsCohort >= 0 ? "var(--color-positive)" : "var(--color-signal-flagged)" }}>
                    {e.vsCohort > 0 ? "+" : ""}
                    {e.vsCohort.toFixed(1)}
                  </span>,
                  <span className="font-mono">{e.agreement}%</span>,
                ])}
              />
            </Section>
            <Narrative>
              Overall inter-rater agreement is {d.avgAgreement}%.{" "}
              {d.mostLenient && `${d.mostLenient.name} scores +${d.mostLenient.vsCohort.toFixed(1)} above consensus`}
              {d.strictest && `, ${d.strictest.name} runs ${d.strictest.vsCohort.toFixed(1)} below`} — worth a
              calibration check before the committee round.
            </Narrative>
          </div>
        )}
      </ReportBody>
    </ReportShell>
  );
}

// ── Score drift (AI vs human final) ───────────────────────────────────────────

export function ScoreDriftPage() {
  const state = useReport(getScoreDrift);
  return (
    <ReportShell
      title="Score drift"
      subtitle="How a deck moves from the AI pre-score to the final human review — and where the movement comes from."
      context="AI ↔ human"
      caption="Tracks each deck's AI pre-score against the mean human evaluation; net drift = human − AI."
    >
      <ReportBody state={state} title="drift data" icon="TrendingUp" isEmpty={(d) => d.rows.length === 0}>
        {(d) => (
          <div className="flex flex-col gap-4">
            <StatTiles
              stats={[
                { label: "Avg drift", value: `${d.avgDrift > 0 ? "+" : ""}${d.avgDrift.toFixed(1)}`, sublabel: "human vs AI" },
                { label: "Changed band", value: d.bandChanges, sublabel: "AI → human" },
                { label: "AI ↔ human agreement", value: `${d.agreement}%`, sublabel: "same signal band" },
                { label: "Revised down", value: d.revisedDown, sublabel: "human below AI" },
              ]}
            />
            <Section title="Net drift by deck">
              <DriftBars rows={d.rows.map((r) => ({ name: r.name, drift: r.drift }))} />
            </Section>
            <Section title="Score journey — AI to human">
              <Table
                cols={["Startup", "AI pre-score", "Final (human)", "Net drift"]}
                rows={d.rows.map((r) => [
                  <span className="font-medium">{r.name}</span>,
                  <span className="font-mono">{r.aiScore.toFixed(1)}</span>,
                  <span className="font-mono">{r.humanScore.toFixed(1)}</span>,
                  <span className="font-mono" style={{ color: r.drift >= 0 ? "var(--color-positive)" : "var(--color-signal-flagged)" }}>
                    {r.drift > 0 ? "▲ +" : r.drift < 0 ? "▼ " : ""}
                    {r.drift.toFixed(1)}
                  </span>,
                ])}
              />
            </Section>
            <Narrative>
              Average drift is {d.avgDrift > 0 ? "+" : ""}
              {d.avgDrift.toFixed(1)} — {d.revisedDown} deck{d.revisedDown === 1 ? "" : "s"} were revised downward.
              An {d.agreement}% AI-to-human band agreement suggests the pre-score is a reliable triage signal.
            </Narrative>
          </div>
        )}
      </ReportBody>
    </ReportShell>
  );
}

// ── Pipeline funnel (shared by both editions) ─────────────────────────────────

export function FunnelPage() {
  const { user } = useAuth();
  const state = useReport(getFunnel);
  const vc = user?.edition === "vc";
  return (
    <ReportShell
      title={vc ? "Pipeline Funnel" : "Pipeline funnel"}
      subtitle={vc ? "Stage-by-stage counts and conversion from Sourced to Closed." : "Conversion of decks through the pipeline — from upload to onboarded."}
      context="All time"
      caption="Cumulative counts of decks that reached each stage · step conversion vs the previous stage."
    >
      <ReportBody state={state} title="pipeline data" icon="Activity" isEmpty={(d) => d.top === 0}>
        {(d) => (
          <div className="flex flex-col gap-4">
            <StatTiles
              stats={[
                { label: vc ? "Deals sourced" : "Decks uploaded", value: d.top },
                { label: vc ? "Closed" : "Onboarded", value: d.bottom, sublabel: `${d.conversion}% of top` },
                { label: "Biggest drop-off", value: d.biggestDropLabel ?? "—", sublabel: d.biggestDropLabel ? `−${d.biggestDropPct}%` : undefined },
                { label: "Overall conversion", value: `${d.conversion}%` },
              ]}
            />
            <Section title={vc ? "Funnel — Sourced to Closed" : "Funnel — Uploaded to Onboarded"}>
              <FunnelBars rows={d.rows} top={d.top} />
            </Section>
            <Section title="Stage breakdown & conversion">
              <Table
                cols={["Stage", "Count", "% of top", "Step conversion"]}
                rows={d.rows.map((r) => [
                  r.label,
                  <span className="font-mono">{r.count}</span>,
                  <span className="font-mono">{r.pctOfTop}%</span>,
                  <span className="font-mono">{r.stepConversion === null ? "—" : `${r.stepConversion}%`}</span>,
                ])}
              />
            </Section>
          </div>
        )}
      </ReportBody>
    </ReportShell>
  );
}
