// Jury-personal reports (exclusive to the logged-in jury member): My decks
// summary, My scores (vs AI baseline), My scores drift.
//
// W8-A — drawn from `AISJ_IC_Jury_V4/_scripts.js` `repRenderDecks`,
// `repRenderScores` and `repRenderDrift`: their `card()` tiles in order, their
// `.rep-h` headings, their table headers, and `stChip` / `rcol`'s colours. The
// arithmetic lives in `src/shared/analytics.ts` (`myDecksSummary`,
// `myScoresSummary`, `scoreDrift`).
import { getMyDecks, getMyReportScores, getMyDrift } from "../../api";
import {
  myDecksSummary,
  myScoresSummary,
  type MyDeckState,
  type MyDecksReport,
} from "../../../shared/analytics";
import {
  useReport,
  ReportGate,
  JuryReportFrame,
  ScTiles,
  ScTile,
  RepH,
  RepTbl,
  RepNum,
  StartupName,
  StatusBars,
  AxisDriftBars,
  scoreColor,
  fmtSigned,
  TONE_COLOR,
} from "./AnalyticsKit";

/** `stChip(s)` — tint + ink per evaluation state. */
const CHIP: Record<MyDeckState, { bg: string; fg: string }> = {
  submitted: { bg: "var(--green-lt)", fg: "var(--green)" },
  draft: { bg: "var(--stone)", fg: "var(--text-2)" },
  pending: { bg: "var(--gold-lt)", fg: "var(--gold-dk)" },
};

/** `repRenderDecks`' breakdown `defs` colours. */
const BAR: Record<MyDeckState, string> = {
  submitted: "var(--green)",
  draft: "var(--text-3)",
  pending: "var(--amber)",
};

const LABEL: Record<MyDeckState, string> = { submitted: "Submitted", draft: "In draft", pending: "Pending" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "9 Jun 2026" — the Submitted column's date. */
export function fmtDay(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * `GET /api/analytics/my/decks` returns `myDecksSummary()`'s shape once the §9
 * data patch (`docs/parity-requests/W8-A-report-data.patch`) is applied. Until
 * then it returns the pre-W8-A payload — only the decks the juror has already
 * SUBMITTED, with no AI score, sector or date — which this reads as exactly
 * that, so nothing is invented. Delete the legacy branch with the patch.
 */
export function toMyDecksReport(payload: unknown): MyDecksReport {
  const p = payload as Partial<MyDecksReport> & {
    decks?: Array<{ id: string; name: string; score: number }>;
  };
  if (Array.isArray(p.rows) && Array.isArray(p.breakdown)) return p as MyDecksReport;
  return myDecksSummary(
    (p.decks ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      sector: null,
      ai: null,
      mine: r.score,
      state: "submitted" as const,
      submittedAt: null,
    })),
  );
}

const one = (v: number | null) => (v === null ? "—" : v.toFixed(1));

export function RepDecksPage() {
  const state = useReport(() => getMyDecks().then(toMyDecksReport));
  return (
    <JuryReportFrame title="My decks summary" subtitle="Your evaluation activity at a glance">
      <ReportGate
        state={state}
        icon="ChartBar"
        emptyTitle="No decks assigned to you yet"
        emptyMessage="Decks assigned to you appear here with where your scoring stands."
        isEmpty={(d) => d.assigned === 0}
      >
        {(d) => (
          <>
            <ScTiles>
              <ScTile label="Assigned" value={d.assigned} sub="decks to you" />
              <ScTile label="Submitted" value={d.submitted} sub="sent for review" color="var(--green)" />
              <ScTile label="In draft" value={d.draft} sub="in progress" />
              <ScTile label="Pending" value={d.pending} sub="awaiting score" color="var(--amber)" />
              <ScTile label="Avg my score" value={one(d.avgMine)} sub="out of 10" color="var(--olive)" />
              <ScTile label="Avg AI score" value={one(d.avgAi)} sub="out of 10" />
            </ScTiles>
            <RepH>Status breakdown</RepH>
            <StatusBars rows={d.breakdown.map((b) => ({ label: LABEL[b.state], count: b.count, pct: b.pct, color: BAR[b.state] }))} />
            <RepH>Deck activity</RepH>
            <RepTbl
              cols={["Startup", "Status", "My score", "AI score", "Submitted"]}
              center={[2, 3, 4]}
              rows={d.rows.map((r) => [
                <StartupName name={r.name} sector={r.sector} />,
                <span
                  className="inline-block rounded-full px-[9px] py-0.5 text-[10.5px] font-semibold"
                  style={{ background: CHIP[r.state].bg, color: CHIP[r.state].fg }}
                  data-state={r.state}
                >
                  {LABEL[r.state]}
                </span>,
                <RepNum color={r.mine === null ? undefined : scoreColor(r.mine)}>{one(r.mine)}</RepNum>,
                <RepNum color={r.ai === null ? undefined : scoreColor(r.ai)}>{one(r.ai)}</RepNum>,
                <span className="text-[10.5px] text-fg-muted">{fmtDay(r.submittedAt)}</span>,
              ])}
            />
          </>
        )}
      </ReportGate>
    </JuryReportFrame>
  );
}

export function RepScoresPage() {
  const state = useReport(() => getMyReportScores().then((d) => myScoresSummary(d.rows)));
  return (
    <JuryReportFrame title="My Scores" subtitle="How you scored each deck vs the AI baseline">
      <ReportGate
        state={state}
        icon="FileText"
        emptyTitle="No scores yet"
        emptyMessage="Score a deck to compare your score against the AI baseline."
        isEmpty={(d) => d.rows.length === 0}
      >
        {(d) => (
          <>
            <ScTiles>
              <ScTile label="Avg my score" value={one(d.avgMine)} sub="out of 10" color="var(--olive)" />
              <ScTile label="Avg AI score" value={one(d.avgAi)} sub="out of 10" />
              <ScTile label="Above AI" value={d.above} sub="decks scored higher" color="var(--green)" />
              <ScTile label="Below AI" value={d.below} sub="decks scored lower" color="var(--red)" />
            </ScTiles>
            <RepH>My score vs AI score</RepH>
            <RepTbl
              cols={["Startup", "AI score", "My score", "Δ (my − AI)"]}
              center={[1, 2, 3]}
              rows={d.rows.map((r) => [
                <StartupName name={r.name} sector={r.sector} />,
                <RepNum color={r.ai === null ? undefined : scoreColor(r.ai)}>{one(r.ai)}</RepNum>,
                <RepNum color={scoreColor(r.mine)}>{r.mine.toFixed(1)}</RepNum>,
                r.delta === null ? (
                  <RepNum>—</RepNum>
                ) : (
                  <RepNum color={TONE_COLOR[r.delta > 0 ? "up" : r.delta < 0 ? "down" : "flat"]}>{fmtSigned(r.delta)}</RepNum>
                ),
              ])}
            />
          </>
        )}
      </ReportGate>
    </JuryReportFrame>
  );
}

export function RepDriftPage() {
  const state = useReport(getMyDrift);
  return (
    <JuryReportFrame title="My scores drift" subtitle="Where your scores run above or below the AI score">
      <ReportGate
        state={state}
        icon="TrendingUp"
        emptyTitle="No drift yet"
        emptyMessage="Score a deck to see where your scores run against the AI baseline."
        isEmpty={(d) => d.rows.length === 0}
        isDisabled={(d) => d.disabled === true}
        disabledTitle="Score drift analysis is turned off"
        disabledMessage="Your admin has turned off score drift analysis in reports."
      >
        {(d) => (
          <>
            <ScTiles>
              <ScTile
                label="Avg drift"
                value={fmtSigned(d.meanDrift, 2)}
                sub="my − AI"
                color={d.meanDrift > 0 ? "var(--green)" : d.meanDrift < 0 ? "var(--red)" : undefined}
              />
              <ScTile label="Tendency" value={<span className="text-[16px]">{d.tendency}</span>} sub="vs AI baseline" />
              <ScTile label="Decks" value={d.rows.length} sub="compared" />
            </ScTiles>
            <RepH>Per-deck drift (my score − AI score)</RepH>
            <p className="mt-1.5 text-[11.5px] text-fg-muted">Bars right of centre = you scored higher than the AI; left = lower.</p>
            <AxisDriftBars rows={d.rows.map((r) => ({ name: r.name, drift: r.drift }))} />
          </>
        )}
      </ReportGate>
    </JuryReportFrame>
  );
}
