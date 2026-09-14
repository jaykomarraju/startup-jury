// VC analytics screens: Pipeline Funnel, Capital Deployment & Pacing, Portfolio
// Construction, Scoring Summary, Diligence & Risk Status, Decision History.
//
// W9-D — all six are drawn from `AISJ_VC_Superuser_V8`'s static panels
// (`panel-{funnel,capital,portfolio,scoring,diligence,decisions}.html`; the VC
// builds have no JS renderer for them). Every KPI label, card heading, bar
// series and column header uses that markup's own words, through the `.rep-*`
// kit `W8-A` built for the incubator's staff reports. The five role builds carry
// the same six panels byte-for-byte except the funnel's subtitle, which gains
// "Limited to deals in your pipeline." for every role that is not admin.
//
// Copy follows §8 Q108: structure and labels verbatim, claims only where the
// data computes them. A figure this application holds no model for (reserves,
// a deployment plan, a follow-on cheque, a thesis target, a diligence checklist
// item) renders "—" in its own slot rather than a number nobody entered (§8
// Q151–Q153); the fields the §9 data patch adds are optional below, so each
// screen reads both the pre-patch and the patched payload honestly.
import { useEffect, useState } from "react";
import {
  ArrowLeftRight,
  Banknote,
  Building2,
  ChartBar,
  ChartNoAxesColumnIncreasing,
  ChartPie,
  Flag,
  Funnel,
  Gauge,
  History,
  IndianRupee,
  Info,
  ListChecks,
  ListOrdered,
  MapPin,
  MessageSquare,
  ShieldCheck,
} from "lucide-react";
import {
  getFunnel,
  getCapital,
  getPortfolio,
  getScoringSummary,
  getDiligence,
  getDecisions,
  type FunnelReport,
  type CapitalReport,
  type PortfolioReport,
  type ScoringSummary,
  type DiligenceReport,
  type DecisionReport,
} from "../../api";
import { getStage } from "../../../pipeline";
import { HIGH_DISAGREEMENT_SIGMA, MODERATE_DISAGREEMENT_SIGMA } from "../../../shared/analytics";
import { formatDelta, formatScore } from "../../../shared/scoring";
import { RUBRIC_BANDS, type ScoreScale } from "../../../shared/types";
import { scoringSettings } from "../admin/scoringApi";
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
  type ReportTone,
} from "./AnalyticsKit";

// ── Payload additions (§9 `W9-D-vc-report-data.patch`) ───────────────────────

/** A fund scope: the one programme's name when exactly one carries a fund size, otherwise "All funds". */
export interface FundScope {
  label: string;
}

export type VcFunnelPayload = FunnelReport & {
  /** "mine" when the route limited the counts to the caller's own deals (partner, IC member, associate, analyst). */
  scope?: "all" | "mine";
};

export interface PacingRow {
  year: number;
  /** The current calendar year is still running — the panel's "2026 (YTD)". */
  ytd: boolean;
  planned: number | null;
  actual: number;
  cumulative: number;
  /** Actual against planned, %; null while no deployment plan is recorded. */
  variance: number | null;
}

export type VcCapitalPayload = CapitalReport & {
  fund?: FundScope;
  /** Held back for follow-on cheques. No model records it yet (§8 Q152). */
  reserves?: number | null;
  /** Deployed against the plan to date, %. No model records a plan yet (§8 Q152). */
  paceVsPlan?: number | null;
  /** The follow-on share of `deployed`. A position cannot be marked follow-on yet (§8 Q152). */
  deployedFollowOn?: number | null;
  pacing?: PacingRow[];
};

export type VcPortfolioPayload = PortfolioReport & {
  fund?: FundScope;
  deployed?: number;
  /** `< ₹3 Cr` · `₹3–8 Cr` · `₹8–20 Cr` · `> ₹20 Cr`, in that order. */
  checkSizeMix?: Array<{ label: string; count: number; pct: number }>;
  followOnRate?: number | null;
};

export type VcScoringPayload = Omit<ScoringSummary, "rows"> & {
  rows: Array<ScoringSummary["rows"][number] & { aiWithheld?: boolean }>;
};

export type VcDiligencePayload = DiligenceReport & {
  /** Open checklist items. No item-level diligence model exists yet (§8 Q153). */
  openItems?: number | null;
  itemRows?: Array<{ item: string; company: string; owner: string; status: "In progress" | "Done" | "Blocked" }>;
  clarificationRows?: Array<{ company: string; question: string; status: "Answered" | "Pending" }>;
};

// ── Formatting ───────────────────────────────────────────────────────────────

/** "₹182 Cr", "₹11.5 Cr" — the panels print whole crores plain. */
export function fmtCr(n: number): string {
  const r = Math.round(n * 10) / 10;
  return `₹${Number.isInteger(r) ? r : r.toFixed(1)} Cr`;
}

/**
 * A share the way `panel-funnel.html` prints one: whole percent from 10 up, one
 * decimal below it — 30%, 8.8%, 4.4%, 2.5%, 1.9%.
 */
export function fmtShare(n: number, of: number): string {
  if (of <= 0) return "0%";
  const v = (n / of) * 100;
  if (v >= 10 || Number.isInteger(v)) return `${Math.round(v)}%`;
  const one = Math.round(v * 10) / 10;
  return `${Number.isInteger(one) ? one : one.toFixed(1)}%`;
}

/** A canonical 0–10 score on the org's scale; on 0–10 the panels always show one decimal ("8.0"). */
export function fmtScore(v: number, scale: ScoreScale): string {
  return scale === "0-10" ? v.toFixed(1) : formatScore(v, scale);
}

/** A standard deviation is a DISTANCE between scores — it scales by the span, with no offset. */
export function fmtSigma(v: number, scale: ScoreScale): string {
  return scale === "0-10" ? v.toFixed(1) : formatDelta(v, scale);
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The org's display scale; renders 0–10 until (or unless) the scoring framework answers. */
function useScoreScale(): ScoreScale {
  const [scale, setScale] = useState<ScoreScale>("0-10");
  useEffect(() => {
    let live = true;
    // Deferred so a synchronous throw (no `fetch` at all) lands in the catch.
    Promise.resolve()
      .then(scoringSettings)
      .then((s) => live && setScale(s.scoreScale))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return scale;
}

/** An in-card line for a card whose rows are empty — never a bare header strip. */
function CardEmpty({ children }: { children: string }) {
  return <p className="px-2.5 pt-2 text-[12px] text-fg-muted">{children}</p>;
}

const Sub = ({ children }: { children: string }) => <span className="text-[10.5px] text-fg-muted">{children}</span>;

const ALL_FUNDS = "All funds";

// ── Pipeline Funnel ──────────────────────────────────────────────────────────

export const VC_FUNNEL_SUBTITLE = "Stage-by-stage counts and conversion rates from Sourced to Closed.";
export const VC_FUNNEL_LIMITED = "Limited to deals in your pipeline.";

/**
 * `panel-funnel.html`'s stage hues. The panel draws six stages; this pipeline
 * has seven (Partner call is a real gate, §8 Q154), which takes `--olive-md`,
 * the step between Screened's olive and IC review's blue.
 */
export const VC_FUNNEL_COLORS: Record<string, string> = {
  Sourced: "var(--olive-dk)",
  Screened: "var(--olive)",
  "Partner call": "var(--olive-md)",
  Diligence: "var(--gold-dk)",
  "IC review": "var(--blue)",
  "Term sheet": "var(--amber)",
  Closed: "var(--green)",
};

/**
 * The VC Pipeline Funnel. `W8-A` left it in `IncubatorReports.tsx` as the
 * pre-rebuild screen, with a §9 row offering two paths; this is the first —
 * moved here and routed from `App.tsx` — so `FunnelPage` keeps rendering the
 * incubator's funnel and nothing in `W8-A`'s file had to change.
 */
export function VcFunnelPage() {
  const state = useReport<VcFunnelPayload>(getFunnel);
  const mine = state.data?.scope === "mine";
  return (
    <StaffReportFrame
      title="Pipeline Funnel"
      subtitle={mine ? `${VC_FUNNEL_SUBTITLE} ${VC_FUNNEL_LIMITED}` : VC_FUNNEL_SUBTITLE}
      scope="All time"
      scopeTitle={mine ? "Counts cover the deals in your pipeline, since the first upload" : "Counts cover every deal, since the first upload"}
    >
      <ReportGate
        state={state}
        icon="Activity"
        emptyTitle={mine ? "No deals in your pipeline yet" : "No deals sourced yet"}
        emptyMessage="The funnel fills in as decks are uploaded and move through the pipeline."
        isEmpty={(d) => d.top === 0}
      >
        {(d) => {
          const last = d.rows[d.rows.length - 1];
          return (
            <>
              <ReportMeta
                parts={[
                  d.scope === "mine" ? "Your pipeline" : "All deals",
                  "all time",
                  `${d.top} sourced`,
                  `${d.bottom} closed (${fmtShare(d.bottom, d.top)})`,
                  "generated for IC review",
                ]}
              />
              <RepKpis>
                <RepKpi value={d.top} label="Deals sourced" />
                <RepKpi value={d.bottom} label="Closed" delta={`${fmtShare(d.bottom, d.top)} of sourced`} tone="good" />
                <RepKpi
                  value={d.biggestStepDrop ? `−${d.biggestStepDrop.pct}%` : "—"}
                  label="Biggest drop-off"
                  delta={d.biggestStepDrop?.label}
                  tone="down"
                />
                <RepKpi value={last?.stepConversion == null ? "—" : `${last.stepConversion}%`} label="Term sheet → Close" />
              </RepKpis>
              <RepCard title="Funnel — Sourced to Closed" icon={Funnel}>
                <RepBars
                  max={d.top}
                  rows={d.rows.map((r) => ({
                    label: r.label,
                    magnitude: r.count,
                    value: String(r.count),
                    color: VC_FUNNEL_COLORS[r.label],
                  }))}
                />
              </RepCard>
              <RepCard title="Stage breakdown & conversion" icon={ListOrdered}>
                <RepTable
                  cols={["Stage", "Count", "% of sourced", "Step conversion"]}
                  rows={d.rows.map((r) => [
                    r.label,
                    <RepScore>{r.count}</RepScore>,
                    fmtShare(r.count, d.top),
                    r.stepConversion === null ? <Sub>—</Sub> : `${r.stepConversion}%`,
                  ])}
                />
              </RepCard>
            </>
          );
        }}
      </ReportGate>
    </StaffReportFrame>
  );
}

// ── Capital Deployment & Pacing ──────────────────────────────────────────────

export function CapitalPage() {
  const state = useReport<VcCapitalPayload>(getCapital);
  const d0 = state.data;
  return (
    <StaffReportFrame
      title="Capital Deployment & Pacing"
      subtitle="Deployed vs. dry powder, reserves, pace against plan."
      scope={d0 ? `${d0.fund?.label ?? ALL_FUNDS} · ${fmtCr(d0.committed)}` : ALL_FUNDS}
      scopeTitle="The committed size of the active fund programmes this report sums"
    >
      <ReportGate
        state={state}
        icon="Landmark"
        emptyTitle="No capital deployed yet"
        emptyMessage="This report fills in once a portfolio company is onboarded with the capital deployed into it."
        isEmpty={(d) => d.companies === 0}
      >
        {(d) => {
          const reserves = d.reserves ?? null;
          const followOn = d.deployedFollowOn ?? null;
          const pace = d.paceVsPlan ?? null;
          const pacing = d.pacing ?? [];
          const dash = { magnitude: 0, value: "—" };
          return (
            <>
              <ReportMeta
                parts={[
                  d.fund?.label ?? ALL_FUNDS,
                  `${plural(d.companies, "company", "companies")} funded`,
                  `${fmtCr(d.committed)} committed`,
                ]}
              />
              <RepKpis>
                <RepKpi value={fmtCr(d.deployed)} label="Deployed" delta={`${d.deployedPct}% of fund`} tone="good" />
                <RepKpi value={fmtCr(d.dryPowder)} label="Dry powder" />
                <RepKpi
                  value={reserves === null ? "—" : fmtCr(reserves)}
                  label="Reserves earmarked"
                  delta={reserves === null ? "no reserve recorded" : "for follow-ons"}
                />
                <RepKpi
                  value={pace === null ? "—" : `${pace > 0 ? "+" : pace < 0 ? "−" : ""}${Math.abs(pace)}%`}
                  label="Pace vs. plan"
                  delta={pace === null ? "no deployment plan recorded" : pace > 0 ? "ahead of plan" : pace < 0 ? "behind plan" : "on plan"}
                  tone={pace === null ? "flat" : pace > 0 ? "up" : pace < 0 ? "down" : "flat"}
                />
              </RepKpis>
              <RepCard title="Deployed vs. dry powder" icon={Banknote}>
                <RepBars
                  max={d.committed}
                  valueWidth={64}
                  rows={[
                    {
                      label: "Deployed (new)",
                      magnitude: d.deployed - (followOn ?? 0),
                      value: fmtCr(d.deployed - (followOn ?? 0)),
                      color: "var(--olive-dk)",
                    },
                    {
                      label: "Deployed (follow-on)",
                      ...(followOn === null ? dash : { magnitude: followOn, value: fmtCr(followOn) }),
                      color: "var(--olive)",
                    },
                    {
                      label: "Reserves (held)",
                      ...(reserves === null ? dash : { magnitude: reserves, value: fmtCr(reserves) }),
                      color: "var(--gold-dk)",
                    },
                    {
                      label: "Uncommitted",
                      magnitude: Math.max(0, d.dryPowder - (reserves ?? 0)),
                      value: fmtCr(Math.max(0, d.dryPowder - (reserves ?? 0))),
                      color: "var(--stone-dk)",
                    },
                  ]}
                />
              </RepCard>
              <RepCard title="Pacing against plan" icon={Gauge}>
                <RepTable
                  cols={["Period", "Planned", "Actual", "Cumulative", "Variance"]}
                  rows={pacing.map((p) => [
                    `${p.year}${p.ytd ? " (YTD)" : ""}`,
                    p.planned === null ? "—" : fmtCr(p.planned),
                    <RepScore>{fmtCr(p.actual)}</RepScore>,
                    fmtCr(p.cumulative),
                    p.variance === null ? (
                      <RepSigned tone="flat">—</RepSigned>
                    ) : (
                      <RepSigned tone={p.variance > 0 ? "up" : p.variance < 0 ? "down" : "flat"}>
                        {`${p.variance > 0 ? "+" : p.variance < 0 ? "−" : ""}${Math.abs(p.variance)}%`}
                      </RepSigned>
                    ),
                  ])}
                />
                {pacing.length === 0 && <CardEmpty>No deployments recorded by period yet.</CardEmpty>}
                <RepNote icon={Info}>
                  {`${fmtCr(d.deployed)} is deployed across ${plural(d.companies, "company", "companies")} — ${d.deployedPct}% of the ${fmtCr(d.committed)} committed. `}
                  {pace === null || reserves === null
                    ? "No deployment plan or follow-on reserve is recorded for this fund, so pace against plan and reserve cover cannot be computed."
                    : `Deployment is ${Math.abs(pace)}% ${pace >= 0 ? "ahead of" : "behind"} plan, with ${fmtCr(reserves)} held in reserve.`}
                </RepNote>
              </RepCard>
              <RepCard title="Capital by company" icon={Building2}>
                <RepBars
                  valueWidth={64}
                  rows={d.byCompany.map((c) => ({ label: c.name, magnitude: c.amount, value: fmtCr(c.amount) }))}
                />
              </RepCard>
            </>
          );
        }}
      </ReportGate>
    </StaffReportFrame>
  );
}

// ── Portfolio Construction ───────────────────────────────────────────────────

/** `panel-portfolio.html`'s check-size buckets, in its order. */
export const CHECK_SIZE_LABELS = ["< ₹3 Cr", "₹3–8 Cr", "₹8–20 Cr", "> ₹20 Cr"];

/** The panel's sector table has five rows: the four largest sectors and "Other". */
export function sectorRows(mix: PortfolioReport["sectorMix"], companies: number): Array<{ label: string; pct: number }> {
  if (mix.length <= 5) return mix.map((s) => ({ label: s.label, pct: s.pct }));
  const rest = mix.slice(4).reduce((n, s) => n + s.count, 0);
  return [
    ...mix.slice(0, 4).map((s) => ({ label: s.label, pct: s.pct })),
    { label: "Other", pct: companies === 0 ? 0 : Math.round((rest / companies) * 100) },
  ];
}

export function PortfolioPage() {
  const state = useReport<VcPortfolioPayload>(getPortfolio);
  const d0 = state.data;
  return (
    <StaffReportFrame
      title="Portfolio Construction"
      subtitle="Sector, stage, geography, and check-size mix vs. thesis."
      scope={d0 ? `${d0.fund?.label ?? ALL_FUNDS} · ${plural(d0.companies, "company", "companies")}` : ALL_FUNDS}
      scopeTitle="The funded companies across the active fund programmes"
    >
      <ReportGate
        state={state}
        icon="PieChart"
        emptyTitle="No portfolio companies yet"
        emptyMessage="The mix fills in once a company is onboarded with capital deployed into it."
        isEmpty={(d) => d.companies === 0}
      >
        {(d) => {
          const mixBars = (rows: Array<{ label: string; pct: number }>) =>
            rows.map((s) => ({ label: s.label, magnitude: s.pct, value: `${s.pct}%` }));
          const checks = d.checkSizeMix;
          return (
            <>
              <ReportMeta
                parts={[
                  `${d.companies} active ${d.companies === 1 ? "company" : "companies"}`,
                  d.deployed !== undefined && `${fmtCr(d.deployed)} deployed`,
                ]}
              />
              <RepKpis>
                <RepKpi value={d.companies} label="Active companies" />
                <RepKpi value={fmtCr(d.medianCheck)} label="Median check" />
                <RepKpi value={d.sectors} label="Sectors" />
                <RepKpi value={d.followOnRate == null ? "—" : `${d.followOnRate}%`} label="Follow-on rate" />
              </RepKpis>
              <RepTwoCol>
                <RepCard title="Sector mix vs. thesis" icon={ChartPie}>
                  <RepTable
                    cols={["Sector", "Actual", "Target", "Drift"]}
                    rows={sectorRows(d.sectorMix, d.companies).map((s) => [
                      s.label,
                      <RepScore>{s.pct}%</RepScore>,
                      "—",
                      <RepSigned tone="flat">—</RepSigned>,
                    ])}
                  />
                </RepCard>
                <RepCard title="Stage mix" icon={ChartNoAxesColumnIncreasing}>
                  <RepBars max={100} rows={mixBars(d.stageMix)} />
                </RepCard>
              </RepTwoCol>
              <RepTwoCol>
                <RepCard title="Geography" icon={MapPin}>
                  <RepBars max={100} rows={mixBars(d.geoMix)} />
                </RepCard>
                <RepCard title="Check-size mix" icon={IndianRupee}>
                  <RepBars
                    max={100}
                    rows={CHECK_SIZE_LABELS.map((label, i) => {
                      const b = checks?.[i];
                      return b ? { label, magnitude: b.pct, value: `${b.pct}%` } : { label, magnitude: 0, value: "—" };
                    })}
                  />
                </RepCard>
              </RepTwoCol>
              <RepNote icon={Info}>
                {`${d.sectorMix[0] ? `${d.sectorMix[0].label} is the largest exposure at ${d.sectorMix[0].pct}% of ${plural(d.companies, "company", "companies")}. ` : ""}` +
                  "No fund thesis targets are recorded, so sector drift against the thesis cannot be measured."}
              </RepNote>
            </>
          );
        }}
      </ReportGate>
    </StaffReportFrame>
  );
}

// ── Scoring Summary ──────────────────────────────────────────────────────────

const LEAN_PILL = { Invest: "go", Hold: "hold", "Need info": "hold", Pass: "no" } as const;

/**
 * `panel-scoring.html` "Highest-variance deals": red at σ 1.4, gold at 0.9 and
 * 0.6, olive at 0.3. A standard deviation is not a score, so there is no rubric
 * band to read; these two steps are the narrowest rule that reproduces the
 * panel (§8 Q155), and the red step is the σ `/diligence` raises a red flag at.
 * Canonical 0–10 units, whatever the display scale.
 */
export function varianceColor(sigma: number): string {
  return sigma >= HIGH_DISAGREEMENT_SIGMA ? "var(--red)" : sigma >= MODERATE_DISAGREEMENT_SIGMA ? "var(--gold-dk)" : "var(--olive)";
}

export const HIGHEST_VARIANCE_ROWS = 4;

export function ScoringPage() {
  const state = useReport<VcScoringPayload>(getScoringSummary);
  const scale = useScoreScale();
  return (
    <StaffReportFrame
      title="Scoring Summary"
      subtitle="Aggregated deal scores with evaluator variance."
      scope="All scored deals"
      scopeTitle="Every deal with an AI or evaluator score"
    >
      <ReportGate
        state={state}
        icon="ChartBar"
        emptyTitle="No deals scored yet"
        emptyMessage="Scores appear once the AI or an evaluator has scored a deal."
        isEmpty={(d) => d.rows.length === 0}
      >
        {(d) => {
          const ranked = d.rows
            .filter((r): r is typeof r & { variance: number } => r.variance !== null)
            .sort((a, b) => b.variance - a.variance)
            .slice(0, HIGHEST_VARIANCE_ROWS);
          const top = ranked[0];
          // The panel draws 1.4 at 93 %: the track is the peak rounded UP to the next half-point.
          const track = top ? Math.max(0.5, Math.ceil(top.variance * 2) / 2) : 1;
          const withheld = d.rows.filter((r) => r.aiWithheld).length;
          return (
            <>
              <ReportMeta
                parts={[
                  `${plural(d.rows.length, "deal", "deals")} on the report`,
                  `${d.dealsScored} scored by AI + evaluators`,
                  `${plural(d.evaluators, "evaluator", "evaluators")}`,
                ]}
              />
              <RepKpis>
                <RepKpi value={d.dealsScored === 0 ? "—" : fmtScore(d.avgScore, scale)} label="Avg. deal score" />
                <RepKpi value={d.dealsScored} label="Deals scored" />
                <RepKpi value={d.evaluators} label="Evaluators" />
                <RepKpi value={fmtSigma(d.avgVariance, scale)} label="Avg. variance" delta="std. dev across scorers" />
              </RepKpis>
              <RepCard title="Aggregated scores & evaluator variance" icon={ChartBar}>
                <RepTable
                  cols={["Startup", "AI", "Evaluator avg", "Variance", "Spread", "Lean"]}
                  rows={d.rows.map((r) => [
                    r.name,
                    r.aiWithheld ? <Sub>hidden</Sub> : <RepScore>{r.ai === null ? "—" : fmtScore(r.ai, scale)}</RepScore>,
                    <RepScore>{r.evaluatorAvg === null ? "—" : fmtScore(r.evaluatorAvg, scale)}</RepScore>,
                    r.variance === null ? <Sub>pending</Sub> : fmtSigma(r.variance, scale),
                    r.spreadLow === null || r.spreadHigh === null ? (
                      <Sub>—</Sub>
                    ) : (
                      <Sub>{`${fmtScore(r.spreadLow, scale)}–${fmtScore(r.spreadHigh, scale)}`}</Sub>
                    ),
                    <RepPill kind={LEAN_PILL[r.lean]}>{r.lean}</RepPill>,
                  ])}
                />
                {withheld > 0 && (
                  <RepNote icon={ShieldCheck}>
                    {`The AI score is hidden on ${plural(withheld, "deal", "deals")} you have not scored yet — blind scoring is on. It appears once you submit your evaluation.`}
                  </RepNote>
                )}
              </RepCard>
              <RepCard title="Highest-variance deals" icon={ArrowLeftRight}>
                {ranked.length === 0 ? (
                  <CardEmpty>Variance appears once a deal has two or more evaluator scores.</CardEmpty>
                ) : (
                  <>
                    <RepBars
                      max={track}
                      rows={ranked.map((r) => ({
                        label: r.name,
                        magnitude: r.variance,
                        value: fmtSigma(r.variance, scale),
                        color: varianceColor(r.variance),
                      }))}
                    />
                    <div className="mt-[15px]">
                      <RepNote icon={Info}>
                        {`${top.name} shows the widest evaluator disagreement (σ ${fmtSigma(top.variance, scale)}) — recommend a calibration discussion before the IC vote.`}
                      </RepNote>
                    </div>
                  </>
                )}
              </RepCard>
            </>
          );
        }}
      </ReportGate>
    </StaffReportFrame>
  );
}

// ── Diligence & Risk Status ──────────────────────────────────────────────────

const ITEM_PILL = { "In progress": "hold", Done: "go", Blocked: "no" } as const;
const CLARIFICATION_PILL = { Answered: "go", Pending: "hold" } as const;

/** A stored signal key ("strong") as its band's name ("Strong") — the one band table, never a second. */
export function signalName(key: string | null): string {
  return RUBRIC_BANDS.find((b) => b.key === key)?.name ?? "—";
}

export function DiligencePage() {
  const state = useReport<VcDiligencePayload>(getDiligence);
  return (
    <StaffReportFrame
      title="Diligence & Risk Status"
      subtitle="Open items, red flags, and founder clarifications."
      scope="Active diligence"
      scopeTitle="Deals in Investment DD, IC review, the MP decision or Legal DD"
    >
      <ReportGate
        state={state}
        icon="ShieldAlert"
        emptyTitle="No deals in diligence"
        emptyMessage="This report fills in when a deal reaches Investment DD, IC review or Legal DD."
        isEmpty={(d) => d.inDiligence === 0}
      >
        {(d) => {
          const items = d.itemRows ?? [];
          const clarifications = d.clarificationRows ?? [];
          return (
            <>
              <ReportMeta parts={[`${plural(d.inDiligence, "company", "companies")} in diligence`, "status as of today"]} />
              <RepKpis>
                <RepKpi value={d.openItems == null ? "—" : d.openItems} label="Open items" />
                <RepKpi
                  value={d.redFlags}
                  label="Red flags"
                  delta={d.redFlags > 0 ? "needs IC attention" : undefined}
                  tone="down"
                />
                <RepKpi value={d.clarifications} label="Founder clarifications" delta="awaiting response" />
                <RepKpi value={d.onTrack} label="On track" delta="no blockers" tone="good" />
              </RepKpis>
              <RepCard title="Open diligence items" icon={ListChecks}>
                <RepTable
                  cols={["Item", "Company", "Owner", "Status"]}
                  rows={items.map((i) => [i.item, i.company, i.owner, <RepPill kind={ITEM_PILL[i.status]}>{i.status}</RepPill>])}
                />
                {items.length === 0 && <CardEmpty>No diligence checklist items are recorded yet.</CardEmpty>}
              </RepCard>
              <RepTwoCol>
                <RepCard title="Red flags" icon={Flag}>
                  <RepTable cols={["Company", "Flag"]} rows={d.flags.map((f) => [f.company, f.flag])} />
                  {d.flags.length === 0 && <CardEmpty>No red flags on deals in diligence.</CardEmpty>}
                </RepCard>
                <RepCard title="Founder clarifications" icon={MessageSquare}>
                  <RepTable
                    cols={["Company", "Question", "Status"]}
                    rows={clarifications.map((q) => [
                      q.company,
                      q.question,
                      <RepPill kind={CLARIFICATION_PILL[q.status]}>{q.status}</RepPill>,
                    ])}
                  />
                  {clarifications.length === 0 && <CardEmpty>No founder clarifications on deals in diligence.</CardEmpty>}
                </RepCard>
              </RepTwoCol>
              <RepCard title="Companies in diligence" icon={Building2}>
                <RepTable
                  cols={["Company", "Stage", "Signal", "Status"]}
                  rows={d.items.map((i) => [
                    i.company,
                    getStage("vc", i.stage)?.label ?? i.stage,
                    signalName(i.signal),
                    <RepPill kind={i.status === "Flagged" ? "no" : "hold"}>{i.status}</RepPill>,
                  ])}
                />
              </RepCard>
            </>
          );
        }}
      </ReportGate>
    </StaffReportFrame>
  );
}

// ── Decision History ─────────────────────────────────────────────────────────

const DECISION_PILL = { Invest: "go", Pass: "no", Revisit: "hold" } as const;
const DECISION_TONE: Record<string, ReportTone> = { Invest: "good", Pass: "down", Revisit: "warn" };

/** "12 Jun 2026" — the panel's date, no leading zero. */
export function fmtDecisionDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function DecisionsPage() {
  const state = useReport<DecisionReport>(getDecisions);
  return (
    <StaffReportFrame
      title="Decision History"
      subtitle="Log of past Invest / Pass / Revisit outcomes."
      scope="All time"
      scopeTitle="Every Invest, Pass and Revisit outcome recorded in the pipeline"
    >
      <ReportGate
        state={state}
        icon="History"
        emptyTitle="No decisions recorded yet"
        emptyMessage="Invest, Pass and Revisit outcomes appear here as deals are decided."
        isEmpty={(d) => d.total === 0}
      >
        {(d) => {
          const share = (n: number) => `${Math.round((n / d.total) * 100)}%`;
          const dates = d.rows.map((r) => r.date).sort();
          const span =
            dates.length > 1 && fmtDecisionDate(dates[0]) !== fmtDecisionDate(dates[dates.length - 1])
              ? `${fmtDecisionDate(dates[0])} – ${fmtDecisionDate(dates[dates.length - 1])}`
              : dates[0] && fmtDecisionDate(dates[0]);
          return (
            <>
              <ReportMeta parts={["Complete IC decision log", span]} />
              <RepKpis>
                <RepKpi value={d.total} label="Total decisions" />
                {(["Invest", "Pass", "Revisit"] as const).map((k) => {
                  const n = k === "Invest" ? d.invest : k === "Pass" ? d.pass : d.revisit;
                  return <RepKpi key={k} value={n} label={k} delta={share(n)} tone={DECISION_TONE[k]} />;
                })}
              </RepKpis>
              <RepCard title="Decision log" icon={History}>
                <RepTable
                  nameCol={1}
                  cols={["Date", "Company", "Decision", "IC lead", "Note"]}
                  rows={d.rows.map((r) => [
                    fmtDecisionDate(r.date),
                    r.company,
                    <RepPill kind={DECISION_PILL[r.decision]}>{r.decision}</RepPill>,
                    r.lead,
                    <Sub>{r.note ?? "—"}</Sub>,
                  ])}
                />
              </RepCard>
            </>
          );
        }}
      </ReportGate>
    </StaffReportFrame>
  );
}
