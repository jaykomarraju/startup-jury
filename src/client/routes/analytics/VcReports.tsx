// VC analytics screens: Capital Deployment & Pacing, Portfolio Construction,
// Scoring Summary, Diligence & Risk, Decision History. (Pipeline funnel is the
// shared FunnelPage in IncubatorReports.tsx.)
import { Badge } from "../../components";
import {
  getCapital,
  getPortfolio,
  getScoringSummary,
  getDiligence,
  getDecisions,
} from "../../api";
import {
  useReport,
  ReportShell,
  ReportBody,
  StatTiles,
  BarList,
  Section,
  Narrative,
  Table,
} from "./AnalyticsKit";

const CR = (n: number) => `₹${n} Cr`;

// ── Capital Deployment & Pacing ───────────────────────────────────────────────

export function CapitalPage() {
  const state = useReport(getCapital);
  return (
    <ReportShell
      title="Capital Deployment & Pacing"
      subtitle="Deployed vs. dry powder against the committed fund size."
      context="Fund II"
      caption="Capital deployed is summed from onboarded portfolio positions against the committed fund size."
    >
      <ReportBody state={state} title="portfolio capital" icon="Landmark" isEmpty={(d) => d.companies === 0}>
        {(d) => (
          <div className="flex flex-col gap-4">
            <StatTiles
              stats={[
                { label: "Deployed", value: CR(d.deployed), sublabel: `${d.deployedPct}% of fund` },
                { label: "Dry powder", value: CR(d.dryPowder), sublabel: `of ${CR(d.committed)} committed` },
                { label: "Companies funded", value: d.companies },
                { label: "Median check", value: CR(d.medianCheck) },
              ]}
            />
            <Section title="Deployed vs. committed">
              <BarList
                max={d.committed}
                items={[
                  { label: "Deployed", value: d.deployed, sub: CR(d.deployed), color: "var(--color-deepgreen)" },
                  { label: "Dry powder", value: d.dryPowder, sub: CR(d.dryPowder), color: "var(--color-signal-absent)" },
                ]}
              />
            </Section>
            <Section title="Capital by company">
              <BarList items={d.byCompany.map((c) => ({ label: c.name, value: c.amount, sub: CR(c.amount) }))} />
            </Section>
            <Narrative>
              {CR(d.deployed)} deployed across {d.companies} companies ({d.deployedPct}% of the {CR(d.committed)} fund),
              leaving {CR(d.dryPowder)} of dry powder for follow-ons and new checks.
            </Narrative>
          </div>
        )}
      </ReportBody>
    </ReportShell>
  );
}

// ── Portfolio Construction ────────────────────────────────────────────────────

export function PortfolioPage() {
  const state = useReport(getPortfolio);
  return (
    <ReportShell
      title="Portfolio Construction"
      subtitle="Sector, stage, and geography mix across the funded portfolio."
      context="Active companies"
      caption="Mix is computed across onboarded portfolio companies with deployed capital."
    >
      <ReportBody state={state} title="portfolio data" icon="PieChart" isEmpty={(d) => d.companies === 0}>
        {(d) => (
          <div className="flex flex-col gap-4">
            <StatTiles
              stats={[
                { label: "Active companies", value: d.companies },
                { label: "Median check", value: CR(d.medianCheck) },
                { label: "Sectors", value: d.sectors },
                { label: "Top sector", value: d.sectorMix[0]?.label ?? "—", sublabel: d.sectorMix[0] ? `${d.sectorMix[0].pct}%` : undefined },
              ]}
            />
            <div className="grid gap-4 lg:grid-cols-3">
              <Section title="Sector mix">
                <BarList items={d.sectorMix.map((s) => ({ label: s.label, value: s.pct, sub: `${s.pct}%` }))} max={100} />
              </Section>
              <Section title="Stage mix">
                <BarList items={d.stageMix.map((s) => ({ label: s.label, value: s.pct, sub: `${s.pct}%` }))} max={100} />
              </Section>
              <Section title="Geography">
                <BarList items={d.geoMix.map((s) => ({ label: s.label, value: s.pct, sub: `${s.pct}%` }))} max={100} />
              </Section>
            </div>
            <Narrative>
              {d.companies} active companies across {d.sectors} sectors, led by {d.sectorMix[0]?.label ?? "—"} at{" "}
              {d.sectorMix[0]?.pct ?? 0}%. Median check size is {CR(d.medianCheck)}.
            </Narrative>
          </div>
        )}
      </ReportBody>
    </ReportShell>
  );
}

// ── Scoring Summary ───────────────────────────────────────────────────────────

const LEAN_TONE: Record<string, "positive" | "amber" | "neutral" | "info"> = {
  Invest: "positive",
  Hold: "amber",
  "Need info": "info",
  Pass: "neutral",
};

export function ScoringPage() {
  const state = useReport(getScoringSummary);
  return (
    <ReportShell
      title="Scoring Summary"
      subtitle="Aggregated deal scores with evaluator variance."
      context="Current slate"
      caption="AI score vs the mean human evaluation per deal; variance is the standard deviation across scorers."
    >
      <ReportBody state={state} title="scoring data" icon="ChartBar" isEmpty={(d) => d.rows.length === 0}>
        {(d) => (
          <div className="flex flex-col gap-4">
            <StatTiles
              stats={[
                { label: "Avg deal score", value: d.avgScore.toFixed(1), sublabel: "evaluator mean" },
                { label: "Deals scored", value: d.dealsScored },
                { label: "Evaluators", value: d.evaluators },
                { label: "Avg variance", value: d.avgVariance.toFixed(1), sublabel: "σ across scorers" },
              ]}
            />
            <Section title="Aggregated scores & evaluator variance">
              <Table
                cols={["Startup", "AI", "Evaluator avg", "Variance", "Spread", "Lean"]}
                rows={d.rows.map((r) => [
                  <span className="font-medium">{r.name}</span>,
                  <span className="font-mono">{r.ai === null ? "—" : r.ai.toFixed(1)}</span>,
                  <span className="font-mono">{r.evaluatorAvg === null ? "—" : r.evaluatorAvg.toFixed(1)}</span>,
                  <span className="font-mono">{r.variance === null ? "pending" : r.variance.toFixed(1)}</span>,
                  <span className="font-mono text-fg-muted">
                    {r.spreadLow === null ? "—" : `${r.spreadLow.toFixed(1)}–${r.spreadHigh?.toFixed(1)}`}
                  </span>,
                  <Badge tone={LEAN_TONE[r.lean] ?? "neutral"}>{r.lean}</Badge>,
                ])}
              />
            </Section>
            <Narrative>
              {d.dealsScored} deals scored by up to {d.evaluators} evaluators, averaging {d.avgScore.toFixed(1)}/10 with
              a mean variance of {d.avgVariance.toFixed(1)}. Widest-disagreement deals warrant a calibration discussion
              before the IC vote.
            </Narrative>
          </div>
        )}
      </ReportBody>
    </ReportShell>
  );
}

// ── Diligence & Risk ──────────────────────────────────────────────────────────

export function DiligencePage() {
  const state = useReport(getDiligence);
  return (
    <ReportShell
      title="Diligence & Risk Status"
      subtitle="Open items, red flags, and founder clarifications across active diligence."
      context="Active diligence"
      caption="Companies currently in diligence stages, flagged by weak/absent signal, with open founder clarifications."
    >
      <ReportBody state={state} title="diligence data" icon="ShieldAlert" isEmpty={(d) => d.inDiligence === 0}>
        {(d) => (
          <div className="flex flex-col gap-4">
            <StatTiles
              stats={[
                { label: "In diligence", value: d.inDiligence, sublabel: "companies" },
                { label: "Red flags", value: d.redFlags, sublabel: "needs IC attention" },
                { label: "Clarifications", value: d.clarifications, sublabel: "awaiting response" },
                { label: "On track", value: d.onTrack, sublabel: "no blockers" },
              ]}
            />
            <Section title="Companies in diligence">
              <Table
                cols={["Company", "Stage", "Signal", "Status"]}
                rows={d.items.map((i) => [
                  <span className="font-medium">{i.company}</span>,
                  <span className="text-fg-muted capitalize">{i.stage.replace(/_/g, " ")}</span>,
                  <span className="capitalize">{i.signal ?? "—"}</span>,
                  <Badge tone={i.status === "Flagged" ? "danger" : "neutral"}>{i.status}</Badge>,
                ])}
              />
            </Section>
            {d.flags.length > 0 && (
              <Section title="Red flags">
                <Table
                  cols={["Company", "Flag"]}
                  rows={d.flags.map((f) => [<span className="font-medium">{f.company}</span>, f.flag])}
                />
              </Section>
            )}
            <Narrative>
              {d.inDiligence} companies in diligence, {d.redFlags} carrying a red flag and {d.clarifications} awaiting
              founder clarification. {d.onTrack} are progressing with no blockers.
            </Narrative>
          </div>
        )}
      </ReportBody>
    </ReportShell>
  );
}

// ── Decision History ──────────────────────────────────────────────────────────

const DECISION_TONE: Record<string, "positive" | "neutral" | "amber"> = {
  Invest: "positive",
  Pass: "neutral",
  Revisit: "amber",
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function DecisionsPage() {
  const state = useReport(getDecisions);
  return (
    <ReportShell
      title="Decision History"
      subtitle="Log of past Invest / Pass / Revisit outcomes."
      context="All time"
      caption="Complete IC / partner decision log, drawn from the pipeline event audit trail."
    >
      <ReportBody state={state} title="decision data" icon="History" isEmpty={(d) => d.total === 0}>
        {(d) => (
          <div className="flex flex-col gap-4">
            <StatTiles
              stats={[
                { label: "Total decisions", value: d.total },
                { label: "Invest", value: d.invest, sublabel: d.total ? `${Math.round((d.invest / d.total) * 100)}%` : undefined },
                { label: "Pass", value: d.pass, sublabel: d.total ? `${Math.round((d.pass / d.total) * 100)}%` : undefined },
                { label: "Revisit", value: d.revisit, sublabel: d.total ? `${Math.round((d.revisit / d.total) * 100)}%` : undefined },
              ]}
            />
            <Section title="Decision log">
              <Table
                cols={["Date", "Company", "Decision", "Lead", "Note"]}
                rows={d.rows.map((r) => [
                  <span className="text-fg-muted">{fmtDate(r.date)}</span>,
                  <span className="font-medium">{r.company}</span>,
                  <Badge tone={DECISION_TONE[r.decision] ?? "neutral"}>{r.decision}</Badge>,
                  r.lead,
                  <span className="text-fg-muted">{r.note ?? "—"}</span>,
                ])}
              />
            </Section>
          </div>
        )}
      </ReportBody>
    </ReportShell>
  );
}
