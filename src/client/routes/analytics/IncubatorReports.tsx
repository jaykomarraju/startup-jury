// Incubator analytics screens: Cohort summary, Evaluator scores, Score drift, and
// the shared Pipeline funnel (used by both editions). Data comes from
// /api/analytics/* (pure aggregation in src/shared/analytics.ts).
//
// W8-A — the four incubator reports are drawn from `AISJ_IC_SuserV15`'s static
// panels (`panel-cohortsummary / evaluatorscores / scoredrift / funnel.html`):
// every KPI tile, card, column header and reading note uses that markup's own
// words. Copy that would state something the data cannot show (the panels'
// "▲ 0.3 vs last batch", "over-claimed on impact", the "Sample report" tag) is
// either computed or left out — see §7 of docs/plan_parity.md.
import { ChartColumn, Funnel, LayoutGrid, ListOrdered, Route, SlidersHorizontal, Trophy, Users } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import {
  getCohortSummary,
  getEvaluatorScores,
  getScoreDrift,
  getFunnel,
} from "../../api";
import type { Role } from "../../../shared/roles";
import type { CohortSummary } from "../../../shared/analytics";
import { roleLabel } from "../../../shared/roles";
import {
  useReport,
  ReportGate,
  StaffReportFrame,
  ReportMeta,
  RepKpis,
  RepKpi,
  RepCard,
  RepTwoCol,
  RepBars,
  RepTable,
  RepScore,
  RepSigned,
  RepPill,
  RepNote,
  FunnelChart,
  type ReportTone,
} from "./AnalyticsKit";

/** A signed figure the way the staff panels print it: "+0.8", "−0.6" (a true minus), "0.0". */
export function fmtDelta(n: number): string {
  if (n > 0) return `+${n.toFixed(1)}`;
  if (n < 0) return `−${Math.abs(n).toFixed(1)}`;
  return n.toFixed(1);
}

const RECO_PILL = { Recommend: "go", "Hold · clarify": "hold", Pass: "no" } as const;

/** "Arjun Verma" → "Arjun V." — the prototype's lenient/strictest tile values. */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length < 2 ? name : `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

/** The Evaluator calibration table's role words (`panel-evaluatorscores.html`). */
const INCUBATOR_ROLE_WORDS: Partial<Record<Role, string>> = {
  superuser: "Super user",
  admin: "Admin / analyst",
  program_manager: "Program manager",
  program_associate: "Program associate",
  jury: "Jury member",
};

/**
 * `vs cohort` colour. `.rep-flat` marks a figure too small to call lenient or
 * strict (Vikram Nair's −0.1). The rule is symmetric — |v| < 0.2 is flat — which
 * the finding asks for; the prototype's own seed happens to colour +0.1 green,
 * which no symmetric rule can reproduce (§8 Q107).
 */
export function vsCohortTone(v: number): ReportTone {
  if (Math.abs(v) < 0.2) return "flat";
  return v > 0 ? "up" : "down";
}

const SCOPE = "All cohorts";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "12 Apr – 9 May 2026", the panel's evaluation window (the year repeats only when it differs). */
export function fmtWindow(from: string, to: string): string {
  const a = new Date(from);
  const b = new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return "";
  const day = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  return `${day(a)}${sameYear ? "" : ` ${a.getUTCFullYear()}`} – ${day(b)} ${b.getUTCFullYear()}`;
}

// ── Cohort summary ────────────────────────────────────────────────────────────

/** The reading note, built only from what the report computed. */
function cohortRead(d: CohortSummary, modal: CohortSummary["distribution"][number]): string {
  const [range, ...name] = modal.label.split(" ");
  const sector = d.sectorMix[0] ? `, with the largest concentration in ${d.sectorMix[0].label}` : "";
  const held = `${d.inClarification} ${d.inClarification === 1 ? "deck is" : "decks are"}`;
  const out = `${d.screenedOut} ${d.screenedOut === 1 ? "was" : "were"}`;
  return (
    `Scoring skews toward the ${name.join(" ").toLowerCase()} band (${range})${sector}. ` +
    `${d.recommended} of ${d.evaluated} evaluated decks are recommended for IC; ${held} held pending founder responses and ${out} screened out.`
  );
}

export function CohortSummaryPage() {
  const state = useReport(getCohortSummary);
  return (
    <StaffReportFrame
      title="Cohort summary"
      subtitle="Aggregate evaluation view across an entire cohort — scoring distribution, recommendations and sector mix."
      scope={SCOPE}
    >
      <ReportGate
        state={state}
        icon="ChartBar"
        emptyTitle="No decks evaluated yet"
        emptyMessage="The cohort summary fills in once decks in this workspace have been scored."
        isEmpty={(d) => d.evaluated === 0}
      >
        {(d) => {
          const modal = [...d.distribution].sort((a, b) => b.count - a.count)[0];
          const window = d.window ? fmtWindow(d.window.from, d.window.to) : "";
          return (
            <>
              <ReportMeta
                parts={[SCOPE, `${d.total} decks`, window && `evaluation window ${window}`, "generated for IC review"]}
              />
              <RepKpis>
                <RepKpi value={d.evaluated} label="Decks evaluated" />
                <RepKpi value={d.avgScore.toFixed(1)} label="Avg weighted score / 10" />
                <RepKpi value={d.recommended} label="Recommended for IC" delta={`${d.recommendedPct}% of cohort`} tone="good" />
                <RepKpi value={d.inClarification} label="In clarification" delta="awaiting founder input" tone="warn" />
                <RepKpi value={d.screenedOut} label="Screened out" />
              </RepKpis>
              <RepTwoCol>
                <RepCard title="Score distribution" icon={ChartColumn}>
                  <RepBars rows={d.distribution.map((b) => ({ label: b.label, magnitude: b.count, value: String(b.count) }))} />
                </RepCard>
                <RepCard title="Sector mix" icon={LayoutGrid}>
                  <RepBars rows={d.sectorMix.map((s) => ({ label: s.label, magnitude: s.count, value: String(s.count) }))} />
                </RepCard>
              </RepTwoCol>
              <RepCard title="Top of cohort — weighted ranking" icon={Trophy}>
                <RepTable
                  cols={["Startup", "Sector · Stage", "Score", "Top driver", "Recommendation"]}
                  rows={d.ranking.map((r) => [
                    r.name,
                    [r.sector, r.stage].filter(Boolean).join(" · ") || "—",
                    <RepScore>{r.score.toFixed(1)}</RepScore>,
                    r.topParam ?? "—",
                    <RepPill kind={RECO_PILL[r.recommendation]}>{r.recommendation}</RepPill>,
                  ])}
                />
              </RepCard>
              <RepNote lead="AI read of the cohort:">{cohortRead(d, modal)}</RepNote>
            </>
          );
        }}
      </ReportGate>
    </StaffReportFrame>
  );
}

// ── Evaluator scores / calibration ────────────────────────────────────────────

export function EvaluatorScoresPage() {
  const { user } = useAuth();
  const state = useReport(getEvaluatorScores);
  const roleWord = (role: string) =>
    INCUBATOR_ROLE_WORDS[role as Role] ?? (user ? roleLabel(user.edition, role as Role) : role.replace(/_/g, " "));
  return (
    <StaffReportFrame
      title="Evaluator scores"
      subtitle="How each evaluator scores relative to the cohort — surfaces leniency, strictness and calibration gaps."
      scope={SCOPE}
    >
      <ReportGate
        state={state}
        icon="Users"
        emptyTitle="No evaluator scores yet"
        emptyMessage="Calibration appears once evaluators have submitted scores."
        isEmpty={(d) => d.evaluators.length === 0}
      >
        {(d) => {
          const healthy = d.avgAgreement >= 80;
          const len = d.mostLenient;
          const str = d.strictest;
          return (
            <>
              <ReportMeta
                parts={[
                  `${d.evaluators.length} active evaluators`,
                  `${d.totalEvaluations} deck-evaluations`,
                  `"vs cohort" = evaluator's mean minus the cohort mean for the decks they scored`,
                ]}
              />
              <RepKpis>
                <RepKpi value={d.evaluators.length} label="Active evaluators" />
                <RepKpi
                  value={`${d.avgAgreement}%`}
                  label="Avg inter-rater agreement"
                  delta={healthy ? "healthy calibration" : "calibration review advised"}
                  tone={healthy ? "good" : "warn"}
                />
                <RepKpi value={`±${d.meanDeviation.toFixed(1)}`} label="Mean deviation from cohort" />
                <RepKpi
                  value={len ? shortName(len.name) : "—"}
                  label="Most lenient scorer"
                  delta={len ? `${fmtDelta(len.vsCohort)} vs cohort` : undefined}
                  tone={len ? vsCohortTone(len.vsCohort) : "flat"}
                />
                <RepKpi
                  value={str ? shortName(str.name) : "—"}
                  label="Strictest scorer"
                  delta={str ? `${fmtDelta(str.vsCohort)} vs cohort` : undefined}
                  tone={str ? vsCohortTone(str.vsCohort) : "flat"}
                />
              </RepKpis>
              <RepCard title="Evaluator calibration" icon={Users}>
                <RepTable
                  cols={["Evaluator", "Role", "Decks scored", "Avg given", "vs cohort", "Agreement"]}
                  rows={d.evaluators.map((e) => [
                    e.name,
                    roleWord(e.role),
                    e.decksScored,
                    <RepScore>{e.avgGiven.toFixed(1)}</RepScore>,
                    <RepSigned tone={vsCohortTone(e.vsCohort)}>{fmtDelta(e.vsCohort)}</RepSigned>,
                    `${e.agreement}%`,
                  ])}
                />
              </RepCard>
              <RepNote lead="Calibration flag:">
                {[
                  len && len.vsCohort > 0
                    ? `${len.name} scores ${fmtDelta(len.vsCohort)} above the cohort with ${len.agreement}% agreement — worth a calibration review before IC.`
                    : null,
                  str && str !== len && str.vsCohort < 0 ? `${str.name} runs consistently strict (${fmtDelta(str.vsCohort)}).` : null,
                  `Overall agreement of ${d.avgAgreement}% is ${healthy ? "within" : "below"} a healthy range.`,
                ]
                  .filter(Boolean)
                  .join(" ")}
              </RepNote>
            </>
          );
        }}
      </ReportGate>
    </StaffReportFrame>
  );
}

// ── Score drift (AI vs human final) ───────────────────────────────────────────

/** "Show score drift analysis in reports" — the Scoring framework toggle's own words. */
export const DRIFT_DISABLED_TITLE = "Score drift analysis is turned off";

export function ScoreDriftPage() {
  const state = useReport(getScoreDrift);
  return (
    <StaffReportFrame
      title="Score drift"
      subtitle="How a deck's score moves from the AI pre-score through clarification and human review — and where the movement comes from."
      scope={SCOPE}
    >
      <ReportGate
        state={state}
        icon="TrendingUp"
        emptyTitle="No score drift yet"
        emptyMessage="Drift appears once a deck has both an AI pre-score and a submitted human evaluation."
        isEmpty={(d) => d.rows.length === 0}
        isDisabled={(d) => d.disabled === true}
        disabledTitle={DRIFT_DISABLED_TITLE}
        disabledMessage="Turn on “Show score drift analysis in reports” in Admin console → Scoring framework to see this report."
      >
        {(d) => {
          const a = d.attribution;
          const cause = (label: string, v: number | null) => ({
            label,
            magnitude: v ?? 0,
            value: v === null ? "—" : fmtDelta(v),
            color: v !== null && v < 0 ? "var(--red)" : undefined,
          });
          const upward = d.rows.filter((r) => r.drift > 0).length;
          return (
            <>
              <ReportMeta parts={[`Tracks AI pre-score → post-clarification → final juror score across ${d.rows.length} decks`]} />
              <RepKpis>
                <RepKpi
                  value={fmtDelta(d.avgDrift)}
                  label="Avg drift after clarification"
                  delta={d.avgDrift > 0 ? "scores rise once gaps are filled" : d.avgDrift < 0 ? "scores fall after review" : undefined}
                  tone={d.avgDrift > 0 ? "up" : "down"}
                />
                <RepKpi value={d.bandChanges} label="Decks that changed band" delta={`${d.bandChangePct}% of cohort`} tone="flat" />
                <RepKpi value={`${d.agreement}%`} label="AI ↔ final agreement" />
                <RepKpi
                  value={d.revisedDown}
                  label="Decks revised downward"
                  delta={d.revisedDown > 0 ? "final below the AI pre-score" : undefined}
                  tone="down"
                />
              </RepKpis>
              <RepCard title="Score journey — AI to final" icon={Route}>
                <RepTable
                  cols={["Startup", "AI pre-score", "After clarification", "Final (juror)", "Net drift"]}
                  rows={d.rows.map((r) => [
                    r.name,
                    <RepScore>{r.aiScore.toFixed(1)}</RepScore>,
                    <RepScore>{r.clarifiedScore === null ? "—" : r.clarifiedScore.toFixed(1)}</RepScore>,
                    <RepScore>{r.humanScore.toFixed(1)}</RepScore>,
                    <RepSigned tone={r.drift > 0 ? "up" : r.drift < 0 ? "down" : "flat"}>
                      {r.drift > 0 ? "▲ " : r.drift < 0 ? "▼ " : ""}
                      {fmtDelta(r.drift)}
                    </RepSigned>,
                  ])}
                />
              </RepCard>
              <RepCard title="Where the drift comes from" icon={SlidersHorizontal}>
                <RepBars
                  rows={[
                    cause("Clarification responses", a.clarification),
                    cause("Juror override & remark", a.juror),
                    cause("Re-evaluation pass", a.reevaluation),
                  ]}
                />
              </RepCard>
              <RepNote lead="Reading the drift:">
                {`${upward} ${upward === 1 ? "deck" : "decks"} moved up and ${d.revisedDown} moved down between the AI pre-score and the final score. ` +
                  `A ${d.agreement}% AI-to-final agreement ` +
                  (d.agreement >= 80
                    ? "suggests the pre-score is a reliable triage signal."
                    : "suggests the pre-score needs human review before it is relied on.")}
              </RepNote>
            </>
          );
        }}
      </ReportGate>
    </StaffReportFrame>
  );
}

// ── Pipeline funnel (shared by both editions) ─────────────────────────────────

/** `panel-funnel.html`'s six stage hues, top to bottom. */
export const FUNNEL_COLORS = ["var(--olive-dk)", "var(--olive)", "var(--blue)", "var(--gold-dk)", "var(--amber)", "var(--green)"];

/**
 * The incubator funnel. `App.tsx` routed `funnel` here for BOTH editions until
 * `W9-D` built the VC funnel as `VcFunnelPage` in `VcReports.tsx`; the VC branch
 * and its `VcFunnel` were deleted at Wave 9 integration, per `W9-D`'s §9 row.
 */
export function FunnelPage() {
  return <IncubatorFunnel />;
}

function IncubatorFunnel() {
  const state = useReport(getFunnel);
  return (
    <StaffReportFrame
      title="Pipeline funnel"
      subtitle="Conversion of decks through the pipeline — from upload to onboarded."
      scope={SCOPE}
    >
      <ReportGate
        state={state}
        icon="Activity"
        emptyTitle="No decks uploaded yet"
        emptyMessage="The funnel fills in as decks are uploaded and move through the pipeline."
        isEmpty={(d) => d.top === 0}
      >
        {(d) => (
          <>
            <ReportMeta
              parts={[SCOPE, `${d.top} decks uploaded`, `${d.bottom} onboarded (${d.conversion}%)`, "generated for IC review"]}
            />
            <RepKpis>
              <RepKpi value={d.top} label="Decks uploaded" />
              <RepKpi value={d.bottom} label="Onboarded" delta={`${d.conversion}% of uploaded`} tone="good" />
              <RepKpi
                value={d.biggestStepDrop ? `−${d.biggestStepDrop.pct}%` : "—"}
                label="Biggest drop-off"
                delta={d.biggestStepDrop?.label}
                tone="down"
              />
              <RepKpi value={d.introToOnboard === null ? "—" : `${d.introToOnboard}%`} label="Intro → Onboard rate" />
            </RepKpis>
            <RepCard title="Pipeline funnel" icon={Funnel}>
              <FunnelChart rows={d.rows} colors={FUNNEL_COLORS} />
            </RepCard>
            <RepCard title="Stage breakdown" icon={ListOrdered}>
              <RepTable
                cols={["Stage", "Count", "% of uploaded", "Step conversion"]}
                rows={d.rows.map((r) => [
                  r.label,
                  <RepScore>{r.count}</RepScore>,
                  `${r.pctOfTop}%`,
                  r.stepConversion === null ? <span className="text-[10.5px] text-fg-muted">—</span> : `${r.stepConversion}%`,
                ])}
              />
            </RepCard>
          </>
        )}
      </ReportGate>
    </StaffReportFrame>
  );
}

