// Phase 7 — Analytics API. Read-only aggregate reports for the incubator (Cohort
// summary, Evaluator scores, Score drift, Pipeline funnel + jury-personal decks/
// scores/drift) and VC (Pipeline funnel, Capital deployment, Portfolio
// construction, Scoring summary, Diligence & risk, Decision history) editions.
//
// The route does the D1 queries; all number-crunching lives in the pure,
// unit-tested `src/shared/analytics.ts`. AuthZ is kept in lock-step with the nav
// manifest: each endpoint is gated by `canAccessNav(edition, role, <slug>)`, the
// same predicate that decides whether the sidebar item is visible (superuser
// bypass built in; jury-personal reports are exclusive, no bypass).

import { Hono } from "hono";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../types";
import type { Edition } from "../../shared/roles";
import { requireAuth } from "../auth/middleware";
import { loadScoringSettings } from "../config/scoringSettings";
import { loadScoreVisibility } from "../config/scoreVisibility";
import { canAccessNav, navItemById } from "../../shared/nav";
import { RUBRIC_BANDS } from "../../shared/types";
import { isAssignableEvaluator, type Role } from "../../shared/roles";
import { canSeeEvaluatorScoresIn } from "../../shared/scoreVisibility";
import { withholdsAiScore } from "../../shared/scoring";
import { ASSIGNEE_PAIRS_SQL } from "../decks/assignments";
import {
  buildFunnel,
  cohortSummary,
  evaluatorScores,
  scoreDrift,
  scoringSummary,
  capitalDeployment,
  portfolioConstruction,
  decisionHistory,
  decisionKind,
  myDecksSummary,
  fundLabel,
  pacingByYear,
  checkSizeMix,
  clarificationQuestion,
  stddev,
  HIGH_DISAGREEMENT_SIGMA,
  type CohortDeck,
  type MyDeckInput,
  type EvaluationRow,
  type DriftInput,
  type ScoringInput,
  type PortfolioRow,
  type DecisionEvent,
} from "../../shared/analytics";

const analytics = new Hono<AppEnv>();
analytics.use("*", requireAuth);

/**
 * Gate an endpoint to the roles that can see the matching nav slug.
 *
 * W3-A — the nav manifest is now permission-aware, so the delegation has to
 * carry the permission through: a report whose sidebar item has been switched
 * off must 403, not merely disappear from the sidebar. None of the report slugs
 * carries a `task` today, so this is behaviour-neutral until one does.
 */
function guard(slug: string) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const u = c.var.user;
    const task = navItemById(u.edition, slug)?.task;
    const granted = task ? await c.var.perms.can(task) : true;
    const can = (taskId: string) => (taskId === task ? granted : true);
    if (!canAccessNav(u.edition, u.role, slug, can)) return c.json({ error: "forbidden" }, 403);
    await next();
  });
}

// Fallback committed fund size (₹ Cr) used only when no VC program carries fund
// economics yet — real numbers come from the programs' fund fields (see /capital).
const FUND_COMMITTED = 300;

function num(v: string | number | null): number | null {
  if (v === null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Mean human evaluation total per deck (evaluator_id NOT NULL), grouped —
 * counting only evaluations THIS VIEWER may see.
 *
 * Wave 9 integration, from `W9-D`'s §9 row: issue 21 is "lower guys must not be
 * able to view the evaluators' scores up in the hierarchy". `W9-D` closed that
 * on `/scoring` for both editions and found the same hole open on the three
 * incubator reports that read this helper (`/cohort`, `/drift`) and on
 * `/evaluators` — a program associate (rank 1) read jury (2) and PM (3) scores
 * folded into every mean. Same predicate as the deck report and `/scoring`: your
 * own evaluation always counts, anyone else's only when the role rule allows it.
 *
 * V3 item 13: that rule is no longer the fixed ladder but the admin console's
 * configurable `Score visibility matrix`, read per request and applied to the
 * ROWS before any mean is taken — a filtered mean is the whole protection here,
 * because the row SET does not move (Wave 9 integration caught a vacuous test
 * that only ever compared row counts).
 */
async function humanEvalsByDeck(
  c: Context<AppEnv>,
  edition: Edition,
): Promise<Map<string, number[]>> {
  const { role, id: viewerId } = c.var.user;
  const visibility = await loadScoreVisibility(c.env.DB, edition);
  const rows = (
    await c.env.DB.prepare(
      "SELECT e.deck_id AS deck_id, e.evaluator_id AS eid, u.role AS role, e.weighted_total AS wt FROM evaluations e " +
        "JOIN decks d ON d.id = e.deck_id JOIN users u ON u.id = e.evaluator_id " +
        "WHERE d.edition = ? AND e.evaluator_id IS NOT NULL AND e.weighted_total IS NOT NULL",
    )
      .bind(edition)
      .all<{ deck_id: string; eid: string; role: string; wt: number }>()
  ).results.filter(
    (r) => r.eid === viewerId || canSeeEvaluatorScoresIn(visibility, edition, role, r.role as Role),
  );
  const map = new Map<string, number[]>();
  for (const r of rows) (map.get(r.deck_id) ?? map.set(r.deck_id, []).get(r.deck_id)!).push(r.wt);
  return map;
}

// ── Pipeline funnel (both editions) ──────────────────────────────────────────

/**
 * W9-D — the VC deal-maker roles read THEIR pipeline. `AISJ_VC_{Partner_V1,
 * IC_member_V2,Associate_V1,Analyst_V1}/panel-funnel.html` add "Limited to deals
 * in your pipeline." to the subtitle, and only the Super User and Admin builds
 * omit it (F0816, F0863). Those four roles are exactly the VC's assignable
 * evaluators. "Your pipeline" is every deal the caller uploaded, is assigned to,
 * scored, or moved: the union of the ways a person comes to own a deal here.
 */
const MY_DEALS_SQL =
  "SELECT id AS deck_id FROM decks WHERE uploaded_by = ?1 " +
  `UNION SELECT deck_id FROM (${ASSIGNEE_PAIRS_SQL}) WHERE evaluator_id = ?1 ` +
  "UNION SELECT deck_id FROM evaluations WHERE evaluator_id = ?1 " +
  "UNION SELECT deck_id FROM pipeline_events WHERE actor_id = ?1";

analytics.get("/funnel", guard("funnel"), async (c) => {
  const { edition, role, id } = c.var.user;
  const mine = edition === "vc" && isAssignableEvaluator(edition, role);
  const rows = (
    mine
      ? await c.env.DB.prepare(`SELECT status FROM decks WHERE edition = ?2 AND id IN (${MY_DEALS_SQL})`)
          .bind(id, edition)
          .all<{ status: string }>()
      : await c.env.DB.prepare("SELECT status FROM decks WHERE edition = ?").bind(edition).all<{ status: string }>()
  ).results;
  return c.json({ ...buildFunnel(edition, rows.map((r) => r.status)), scope: mine ? "mine" : "all" });
});

// ── Cohort summary (incubator) ───────────────────────────────────────────────

analytics.get("/cohort", guard("cohortsummary"), async (c) => {
  const edition = c.var.user.edition;
  const decks = (
    await c.env.DB.prepare(
      "SELECT id, name, sector, stage, status, ai_score, created_at FROM decks WHERE edition = ?",
    )
      .bind(edition)
      .all<{ id: string; name: string; sector: string | null; stage: string | null; status: string; ai_score: number | null; created_at: string | null }>()
  ).results;

  // Top AI-scored parameter per deck ("top driver") when per-parameter AI scores exist.
  const topRows = (
    await c.env.DB.prepare(
      "SELECT s.deck_id AS deck_id, p.name AS name, s.value AS value FROM scores s " +
        "JOIN parameters p ON p.id = s.parameter_id JOIN decks d ON d.id = s.deck_id " +
        "WHERE d.edition = ? AND s.evaluator_kind = 'ai'",
    )
      .bind(edition)
      .all<{ deck_id: string; name: string; value: number }>()
  ).results;
  const topParam = new Map<string, { name: string; value: number }>();
  for (const r of topRows) {
    const cur = topParam.get(r.deck_id);
    if (!cur || r.value > cur.value) topParam.set(r.deck_id, { name: r.name, value: r.value });
  }

  // W8-A (F0797) — the report ranks FINAL scores: the mean human evaluation,
  // falling back to the AI pre-score for a deck no human has scored.
  const humans = await humanEvalsByDeck(c, edition);
  // W8-A (F0798) — "In clarification — awaiting founder input" is the query
  // loop: decks with a founder query not yet answered (the same predicate the
  // VC diligence report counts), not the intake states.
  const openQueryDeckIds = new Set(
    (
      await c.env.DB.prepare(
        "SELECT DISTINCT q.deck_id AS deck_id FROM queries q JOIN decks d ON d.id = q.deck_id " +
          "WHERE d.edition = ? AND q.email_status != 'answered'",
      )
        .bind(edition)
        .all<{ deck_id: string }>()
    ).results.map((r) => r.deck_id),
  );

  const input: CohortDeck[] = decks.map((d) => {
    const hs = humans.get(d.id);
    return {
      id: d.id,
      name: d.name,
      sector: d.sector,
      stage: d.stage,
      status: d.status,
      aiScore: d.ai_score,
      topParam: topParam.get(d.id)?.name ?? null,
      finalScore: hs && hs.length ? hs.reduce((a, b) => a + b, 0) / hs.length : null,
      createdAt: d.created_at,
    };
  });
  return c.json(cohortSummary(input, { openQueryDeckIds }));
});

// ── Evaluator scores / calibration (incubator) ───────────────────────────────

analytics.get("/evaluators", guard("evaluatorscores"), async (c) => {
  // Issue 21 (§9, `W9-D`): this report lists every evaluator's average BY NAME,
  // so a viewer must not see one the matrix withholds. Same predicate as
  // `humanEvalsByDeck` and `/scoring` — V3 item 13's configurable matrix.
  const { edition, role, id: viewerId } = c.var.user;
  const visibility = await loadScoreVisibility(c.env.DB, edition);
  const rows = (
    await c.env.DB.prepare(
      "SELECT e.evaluator_id AS eid, u.name AS name, u.role AS role, e.deck_id AS deck_id, e.weighted_total AS wt " +
        "FROM evaluations e JOIN decks d ON d.id = e.deck_id JOIN users u ON u.id = e.evaluator_id " +
        "WHERE d.edition = ? AND e.evaluator_id IS NOT NULL AND e.weighted_total IS NOT NULL",
    )
      .bind(edition)
      .all<{ eid: string; name: string; role: string; deck_id: string; wt: number }>()
  ).results.filter(
    (r) => r.eid === viewerId || canSeeEvaluatorScoresIn(visibility, edition, role, r.role as Role),
  );
  const input: EvaluationRow[] = rows.map((r) => ({
    evaluatorId: r.eid,
    evaluatorName: r.name,
    role: r.role,
    deckId: r.deck_id,
    weightedTotal: r.wt,
  }));
  return c.json(evaluatorScores(input));
});

// ── Score drift: AI vs human final (incubator) ───────────────────────────────

analytics.get("/drift", guard("scoredrift"), async (c) => {
  const edition = c.var.user.edition;
  // Admin console → Scoring framework → "Show score drift analysis in reports".
  // Off means the report carries no drift analysis — enforced here, so turning
  // it off is not something a client can decline to honour.
  const scoring = await loadScoringSettings(c.env.DB, edition);
  if (!scoring.showScoreDrift) return c.json({ ...scoreDrift([]), disabled: true });
  const decks = (
    await c.env.DB.prepare(
      "SELECT id, name, ai_score FROM decks WHERE edition = ? AND ai_score IS NOT NULL",
    )
      .bind(edition)
      .all<{ id: string; name: string; ai_score: number }>()
  ).results;
  const humans = await humanEvalsByDeck(c, edition);
  const input: DriftInput[] = decks
    .filter((d) => humans.has(d.id))
    .map((d) => {
      const hs = humans.get(d.id)!;
      return { deckId: d.id, name: d.name, aiScore: d.ai_score, humanScore: hs.reduce((a, b) => a + b, 0) / hs.length };
    });
  return c.json(scoreDrift(input));
});

// ── Scoring summary (VC) ─────────────────────────────────────────────────────

analytics.get("/scoring", guard("scoring"), async (c) => {
  const { edition, role, id: viewerId } = c.var.user;
  const visibility = await loadScoreVisibility(c.env.DB, edition);
  const decks = (
    await c.env.DB.prepare("SELECT id, name, ai_score FROM decks WHERE edition = ?")
      .bind(edition)
      .all<{ id: string; name: string; ai_score: number | null }>()
  ).results;
  // W9-D — issue 21: "lower guys must not be able to view the evaluators' scores
  // up in the hierarchy". The deck report enforces it; this summary averaged
  // EVERY evaluator, so an analyst read partner and IC scores folded into the
  // mean. Only evaluations the viewer may see count — in the averages, the
  // variance and the "Evaluators" tile alike. V3 item 13 made which those are
  // configurable: `Visibility for VC`, the 5×5 in the admin console.
  const evals = (
    await c.env.DB.prepare(
      "SELECT e.deck_id AS deck_id, e.evaluator_id AS eid, u.role AS role, e.weighted_total AS wt FROM evaluations e " +
        "JOIN decks d ON d.id = e.deck_id JOIN users u ON u.id = e.evaluator_id " +
        "WHERE d.edition = ? AND e.evaluator_id IS NOT NULL AND e.weighted_total IS NOT NULL",
    )
      .bind(edition)
      .all<{ deck_id: string; eid: string; role: string; wt: number }>()
  ).results.filter(
    (e) => e.eid === viewerId || canSeeEvaluatorScoresIn(visibility, edition, role, e.role as Role),
  );
  const humans = new Map<string, number[]>();
  for (const e of evals) (humans.get(e.deck_id) ?? humans.set(e.deck_id, []).get(e.deck_id)!).push(e.wt);

  // W9-D — blind scoring (F0106) held on the deck read but not here: with "Show
  // AI score to jury before they score" off, an assignable evaluator read every
  // AI score on this report before scoring. Same predicate as `GET /api/decks/:id`.
  const scoring = await loadScoringSettings(c.env.DB, edition);
  const submitted = new Set(evals.filter((e) => e.eid === viewerId).map((e) => e.deck_id));
  const isEvaluator = isAssignableEvaluator(edition, role);

  const input: ScoringInput[] = decks.map((d) => ({
    deckId: d.id,
    name: d.name,
    aiScore: d.ai_score,
    humanScores: humans.get(d.id) ?? [],
    aiWithheld: withholdsAiScore(scoring, { isEvaluator, hasSubmitted: submitted.has(d.id) }),
  }));
  return c.json(scoringSummary(input, new Set(evals.map((e) => e.eid)).size));
});

// ── Capital deployment (VC) ──────────────────────────────────────────────────

async function loadPortfolio(c: Context<AppEnv>, edition: Edition): Promise<PortfolioRow[]> {
  const rows = (
    await c.env.DB.prepare(
      "SELECT pf.deck_id AS deck_id, d.name AS name, d.sector AS sector, d.stage AS stage, d.city AS city, " +
        "pf.capital_deployed AS capital, pf.onboarded_at AS onboarded_at FROM portfolio pf JOIN decks d ON d.id = pf.deck_id WHERE d.edition = ?",
    )
      .bind(edition)
      .all<{
        deck_id: string;
        name: string;
        sector: string | null;
        stage: string | null;
        city: string | null;
        capital: string | null;
        onboarded_at: string | null;
      }>()
  ).results;
  return rows.map((r) => ({
    deckId: r.deck_id,
    name: r.name,
    sector: r.sector,
    stage: r.stage,
    city: r.city,
    capitalDeployed: num(r.capital),
    onboardedAt: r.onboarded_at,
  }));
}

/** W9-D — the chip's fund name: the one active programme with a committed size, else "All funds". */
async function loadFundLabel(c: Context<AppEnv>, edition: Edition): Promise<string> {
  const programs = (
    await c.env.DB.prepare("SELECT name, fund_size FROM programs WHERE edition = ? AND active = 1")
      .bind(edition)
      .all<{ name: string; fund_size: number | null }>()
  ).results;
  return fundLabel(programs.map((p) => ({ name: p.name, fundSize: p.fund_size })));
}

/** Sum the edition's program-level fund economics (₹ Cr). Falls back to the
 *  single-fund constant only when no program has a committed size yet. */
async function loadFundTotals(
  c: Context<AppEnv>,
  edition: Edition,
): Promise<{ committed: number; allocated: number }> {
  const row = await c.env.DB.prepare(
    "SELECT COALESCE(SUM(fund_size), 0) AS committed, COALESCE(SUM(fund_allocated), 0) AS allocated " +
      "FROM programs WHERE edition = ? AND active = 1",
  )
    .bind(edition)
    .first<{ committed: number; allocated: number }>();
  const committed = row?.committed ?? 0;
  return {
    committed: committed > 0 ? committed : FUND_COMMITTED,
    allocated: row?.allocated ?? 0,
  };
}

analytics.get("/capital", guard("capital"), async (c) => {
  const edition = c.var.user.edition;
  const rows = await loadPortfolio(c, edition);
  const { committed, allocated } = await loadFundTotals(c, edition);
  return c.json({
    ...capitalDeployment(rows, committed, allocated),
    fund: { label: await loadFundLabel(c, edition) },
    // W9-D — `panel-capital.html` draws reserves, a deployment plan and a
    // follow-on split. No surface records any of the three (§8 Q152), so each is
    // an explicit null the screen renders as "—", never an invented number.
    reserves: null,
    paceVsPlan: null,
    deployedFollowOn: null,
    pacing: pacingByYear(rows, new Date()),
  });
});

analytics.get("/portfolio", guard("portfolio"), async (c) => {
  const edition = c.var.user.edition;
  const rows = await loadPortfolio(c, edition);
  const report = portfolioConstruction(rows);
  const deployed = rows.reduce((n, r) => n + (r.capitalDeployed !== null && r.capitalDeployed > 0 ? r.capitalDeployed : 0), 0);
  return c.json({
    ...report,
    fund: { label: await loadFundLabel(c, edition) },
    deployed: Math.round(deployed * 10) / 10,
    checkSizeMix: checkSizeMix(rows),
    // No position can be marked a follow-on cheque yet (§8 Q152).
    followOnRate: null,
  });
});

// ── Diligence & risk (VC) ────────────────────────────────────────────────────

const DILIGENCE_STAGES = ["investment_dd", "ic_review", "mp_decision", "legal_dd"];

analytics.get("/diligence", guard("diligence"), async (c) => {
  const edition = c.var.user.edition;
  const decks = (
    await c.env.DB.prepare(
      "SELECT id, name, status, signal FROM decks WHERE edition = ?",
    )
      .bind(edition)
      .all<{ id: string; name: string; status: string; signal: string | null }>()
  ).results;
  const inDiligence = decks.filter((d) => DILIGENCE_STAGES.includes(d.status));
  // Red flag = the two lowest signal bands. W2-B — `decks.signal` is now the
  // specs' five bands (`RUBRIC_BANDS`), so the lowest is `insufficient`, not
  // the retired `absent`; `0039` rewrote the stored rows. Reading the table
  // rather than naming the keys means the next scale change cannot silently
  // empty this list.
  const LOWEST_BANDS = RUBRIC_BANDS.slice(-2).map((b) => b.key as string);
  const isLowSignal = (s: string | null) => s !== null && LOWEST_BANDS.includes(s);

  // W9-D — `panel-diligence.html` flags a deal for more than its signal band:
  // "High evaluator disagreement (σ 1.4)" is the Scoring Summary's widest
  // spread, raised as a flag. That one is computable from the evaluations; the
  // panel's other kinds (an unverified reference, a founder departure, revenue
  // concentration) need a flag someone RAISES, which nothing records (§8 Q153).
  const placeholders = DILIGENCE_STAGES.map(() => "?").join(",");
  const evals = (
    await c.env.DB.prepare(
      "SELECT e.deck_id AS deck_id, e.weighted_total AS wt FROM evaluations e JOIN decks d ON d.id = e.deck_id " +
        `WHERE d.edition = ? AND d.status IN (${placeholders}) AND e.evaluator_id IS NOT NULL AND e.weighted_total IS NOT NULL`,
    )
      .bind(edition, ...DILIGENCE_STAGES)
      .all<{ deck_id: string; wt: number }>()
  ).results;
  const scoresByDeck = new Map<string, number[]>();
  for (const e of evals) (scoresByDeck.get(e.deck_id) ?? scoresByDeck.set(e.deck_id, []).get(e.deck_id)!).push(e.wt);

  const flags: Array<{ company: string; flag: string }> = [];
  for (const d of inDiligence) {
    if (isLowSignal(d.signal)) {
      flags.push({ company: d.name, flag: d.signal === "insufficient" ? "Insufficient signal" : "Weak overall signal" });
    }
    const scores = scoresByDeck.get(d.id) ?? [];
    const sigma = scores.length >= 2 ? Math.round(stddev(scores) * 10) / 10 : 0;
    if (sigma >= HIGH_DISAGREEMENT_SIGMA) {
      flags.push({ company: d.name, flag: `High evaluator disagreement (σ ${sigma.toFixed(1)})` });
    }
  }
  const flagged = new Set(flags.map((f) => f.company));

  // Founder clarifications on decks *in diligence* only: the unanswered count,
  // and (W9-D, F0814) the rows — newest first, answered ones included, as the
  // panel lists InsureFlow's "Answered" beside two "Pending".
  const clarificationRows = (
    await c.env.DB.prepare(
      "SELECT d.name AS company, q.questions AS questions, q.email_status AS status FROM queries q JOIN decks d ON d.id = q.deck_id " +
        `WHERE d.edition = ? AND d.status IN (${placeholders}) ORDER BY q.created_at DESC`,
    )
      .bind(edition, ...DILIGENCE_STAGES)
      .all<{ company: string; questions: string; status: string }>()
  ).results.map((q) => ({
    company: q.company,
    question: clarificationQuestion(q.questions),
    status: q.status === "answered" ? ("Answered" as const) : ("Pending" as const),
  }));
  const clarifications = clarificationRows.filter((q) => q.status === "Pending").length;

  return c.json({
    inDiligence: inDiligence.length,
    redFlags: flags.length,
    clarifications,
    onTrack: inDiligence.length - flagged.size,
    items: inDiligence.map((d) => ({
      company: d.name,
      stage: d.status,
      signal: d.signal,
      status: flagged.has(d.name) ? "Flagged" : "In progress",
    })),
    flags,
    // No item-level diligence checklist is modelled (§8 Q153).
    openItems: null,
    itemRows: [],
    clarificationRows,
  });
});

// ── Decision history (VC) ────────────────────────────────────────────────────

analytics.get("/decisions", guard("decisions"), async (c) => {
  const edition = c.var.user.edition;
  const rows = (
    await c.env.DB.prepare(
      "SELECT e.created_at AS created_at, d.name AS company, e.action AS action, e.note AS note, u.name AS actor " +
        "FROM pipeline_events e JOIN decks d ON d.id = e.deck_id LEFT JOIN users u ON u.id = e.actor_id " +
        "WHERE d.edition = ? ORDER BY e.created_at DESC",
    )
      .bind(edition)
      .all<{ created_at: string; company: string; action: string; note: string | null; actor: string | null }>()
  ).results;
  const events: DecisionEvent[] = rows
    .filter((r) => decisionKind(r.action) !== null)
    .map((r) => ({ createdAt: r.created_at, company: r.company, action: r.action, actorName: r.actor, note: r.note }));
  return c.json(decisionHistory(events));
});

// ── Jury-personal reports (incubator; exclusive to the jury member) ──────────

/** The caller's own human evaluations joined to their decks. */
async function myEvals(c: Context<AppEnv>) {
  return (
    await c.env.DB.prepare(
      "SELECT d.id AS id, d.name AS name, d.sector AS sector, d.status AS status, d.ai_score AS ai, e.weighted_total AS mine " +
        "FROM evaluations e JOIN decks d ON d.id = e.deck_id " +
        "WHERE e.evaluator_id = ? AND e.weighted_total IS NOT NULL ORDER BY e.submitted_at DESC",
    )
      .bind(c.var.user.id)
      .all<{ id: string; name: string; sector: string | null; status: string; ai: number | null; mine: number }>()
  ).results;
}

/** Stages in which an unscored assignment is still waiting on the juror. */
const AWAITING_JURY = ["assigned", "jury_evaluation"];

// W8-A (F0820–F0824) — `repRenderDecks` is built on the juror's ASSIGNED decks
// and whether THEY have finished scoring each, not on completed evaluations
// and the deck's pipeline stage. Every deck assigned to the caller (the join
// table and the legacy single assignee) plus every deck they have scored.
// There is no partial-save path, so "In draft" is always 0 until one exists.
analytics.get("/my/decks", guard("repdecks"), async (c) => {
  const { id: userId, edition, role } = c.var.user;
  const rows = (
    await c.env.DB.prepare(
      "SELECT d.id AS id, d.name AS name, d.sector AS sector, d.status AS status, d.ai_score AS ai, " +
        "e.weighted_total AS mine, e.submitted_at AS submitted_at " +
        `FROM (SELECT deck_id FROM (${ASSIGNEE_PAIRS_SQL}) WHERE evaluator_id = ? ` +
        "UNION SELECT deck_id FROM evaluations WHERE evaluator_id = ? AND weighted_total IS NOT NULL) mine " +
        "JOIN decks d ON d.id = mine.deck_id " +
        "LEFT JOIN evaluations e ON e.deck_id = d.id AND e.evaluator_id = ? AND e.weighted_total IS NOT NULL " +
        "WHERE d.edition = ? ORDER BY e.submitted_at IS NULL, e.submitted_at DESC, d.name",
    )
      .bind(userId, userId, userId, edition)
      .all<{ id: string; name: string; sector: string | null; status: string; ai: number | null; mine: number | null; submitted_at: string | null }>()
  ).results;
  // Blind scoring holds here exactly as on GET /api/decks: no AI score on a deck
  // the juror has not yet scored.
  const scoring = await loadScoringSettings(c.env.DB, edition);
  const isEvaluator = isAssignableEvaluator(edition, role);
  const input: MyDeckInput[] = rows
    .filter((r) => r.mine !== null || AWAITING_JURY.includes(r.status))
    .map((r) => {
      const submitted = r.mine !== null;
      return {
        id: r.id,
        name: r.name,
        sector: r.sector,
        ai: withholdsAiScore(scoring, { isEvaluator, hasSubmitted: submitted }) ? null : r.ai,
        mine: r.mine,
        state: submitted ? "submitted" : "pending",
        submittedAt: r.submitted_at,
      };
    });
  return c.json(myDecksSummary(input));
});

analytics.get("/my/scores", guard("repscores"), async (c) => {
  const rows = await myEvals(c);
  return c.json({
    rows: rows.map((r) => ({
      id: r.id,
      name: r.name,
      sector: r.sector,
      ai: r.ai === null ? null : Math.round(r.ai * 10) / 10,
      mine: Math.round(r.mine * 10) / 10,
    })),
  });
});

analytics.get("/my/drift", guard("repdrift"), async (c) => {
  // W8-A — the same toggle `/drift` honours: a juror's own drift report is
  // drift analysis in a report too (§9, Wave 2 integration).
  const scoring = await loadScoringSettings(c.env.DB, c.var.user.edition);
  if (!scoring.showScoreDrift) return c.json({ ...scoreDrift([]), disabled: true });
  const rows = await myEvals(c).then((rs) => rs.filter((r) => r.ai !== null));
  const input: DriftInput[] = rows.map((r) => ({
    deckId: r.id,
    name: r.name,
    aiScore: r.ai as number,
    humanScore: r.mine,
  }));
  return c.json(scoreDrift(input));
});

export { analytics };
export default analytics;
