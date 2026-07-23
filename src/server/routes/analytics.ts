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
import { canAccessNav } from "../../shared/nav";
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
  type CohortDeck,
  type EvaluationRow,
  type DriftInput,
  type ScoringInput,
  type PortfolioRow,
  type DecisionEvent,
} from "../../shared/analytics";

const analytics = new Hono<AppEnv>();
analytics.use("*", requireAuth);

/** Gate an endpoint to the roles that can see the matching nav slug. */
function guard(slug: string) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const u = c.var.user;
    if (!canAccessNav(u.edition, u.role, slug)) return c.json({ error: "forbidden" }, 403);
    await next();
  });
}

// VC fund size for capital pacing (₹ Cr committed) — a single-fund demo constant.
const FUND_COMMITTED = 300;

function num(v: string | number | null): number | null {
  if (v === null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Mean human evaluation total per deck (evaluator_id NOT NULL), grouped. */
async function humanEvalsByDeck(
  c: Context<AppEnv>,
  edition: Edition,
): Promise<Map<string, number[]>> {
  const rows = (
    await c.env.DB.prepare(
      "SELECT e.deck_id AS deck_id, e.weighted_total AS wt FROM evaluations e " +
        "JOIN decks d ON d.id = e.deck_id " +
        "WHERE d.edition = ? AND e.evaluator_id IS NOT NULL AND e.weighted_total IS NOT NULL",
    )
      .bind(edition)
      .all<{ deck_id: string; wt: number }>()
  ).results;
  const map = new Map<string, number[]>();
  for (const r of rows) (map.get(r.deck_id) ?? map.set(r.deck_id, []).get(r.deck_id)!).push(r.wt);
  return map;
}

// ── Pipeline funnel (both editions) ──────────────────────────────────────────

analytics.get("/funnel", guard("funnel"), async (c) => {
  const edition = c.var.user.edition;
  const rows = (
    await c.env.DB.prepare("SELECT status FROM decks WHERE edition = ?").bind(edition).all<{ status: string }>()
  ).results;
  return c.json(buildFunnel(edition, rows.map((r) => r.status)));
});

// ── Cohort summary (incubator) ───────────────────────────────────────────────

analytics.get("/cohort", guard("cohortsummary"), async (c) => {
  const edition = c.var.user.edition;
  const decks = (
    await c.env.DB.prepare(
      "SELECT id, name, sector, stage, status, ai_score FROM decks WHERE edition = ?",
    )
      .bind(edition)
      .all<{ id: string; name: string; sector: string | null; stage: string | null; status: string; ai_score: number | null }>()
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

  const input: CohortDeck[] = decks.map((d) => ({
    id: d.id,
    name: d.name,
    sector: d.sector,
    stage: d.stage,
    status: d.status,
    aiScore: d.ai_score,
    topParam: topParam.get(d.id)?.name ?? null,
  }));
  return c.json(cohortSummary(input));
});

// ── Evaluator scores / calibration (incubator) ───────────────────────────────

analytics.get("/evaluators", guard("evaluatorscores"), async (c) => {
  const edition = c.var.user.edition;
  const rows = (
    await c.env.DB.prepare(
      "SELECT e.evaluator_id AS eid, u.name AS name, u.role AS role, e.deck_id AS deck_id, e.weighted_total AS wt " +
        "FROM evaluations e JOIN decks d ON d.id = e.deck_id JOIN users u ON u.id = e.evaluator_id " +
        "WHERE d.edition = ? AND e.evaluator_id IS NOT NULL AND e.weighted_total IS NOT NULL",
    )
      .bind(edition)
      .all<{ eid: string; name: string; role: string; deck_id: string; wt: number }>()
  ).results;
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
  const edition = c.var.user.edition;
  const decks = (
    await c.env.DB.prepare("SELECT id, name, ai_score FROM decks WHERE edition = ?")
      .bind(edition)
      .all<{ id: string; name: string; ai_score: number | null }>()
  ).results;
  const humans = await humanEvalsByDeck(c, edition);
  const input: ScoringInput[] = decks.map((d) => ({
    deckId: d.id,
    name: d.name,
    aiScore: d.ai_score,
    humanScores: humans.get(d.id) ?? [],
  }));
  return c.json(scoringSummary(input));
});

// ── Capital deployment (VC) ──────────────────────────────────────────────────

async function loadPortfolio(c: Context<AppEnv>, edition: Edition): Promise<PortfolioRow[]> {
  const rows = (
    await c.env.DB.prepare(
      "SELECT pf.deck_id AS deck_id, d.name AS name, d.sector AS sector, d.stage AS stage, d.city AS city, " +
        "pf.capital_deployed AS capital FROM portfolio pf JOIN decks d ON d.id = pf.deck_id WHERE d.edition = ?",
    )
      .bind(edition)
      .all<{ deck_id: string; name: string; sector: string | null; stage: string | null; city: string | null; capital: string | null }>()
  ).results;
  return rows.map((r) => ({
    deckId: r.deck_id,
    name: r.name,
    sector: r.sector,
    stage: r.stage,
    city: r.city,
    capitalDeployed: num(r.capital),
  }));
}

analytics.get("/capital", guard("capital"), async (c) => {
  const rows = await loadPortfolio(c, c.var.user.edition);
  return c.json(capitalDeployment(rows, FUND_COMMITTED));
});

analytics.get("/portfolio", guard("portfolio"), async (c) => {
  const rows = await loadPortfolio(c, c.var.user.edition);
  return c.json(portfolioConstruction(rows));
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
  const redFlags = inDiligence.filter((d) => d.signal === "flagged" || d.signal === "weak");

  // Open founder clarifications = unanswered queries on VC decks in diligence.
  const openQ = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM queries q JOIN decks d ON d.id = q.deck_id " +
      "WHERE d.edition = ? AND q.email_status != 'answered'",
  )
    .bind(edition)
    .first<{ n: number }>();
  const clarifications = openQ?.n ?? 0;

  return c.json({
    inDiligence: inDiligence.length,
    redFlags: redFlags.length,
    clarifications,
    onTrack: inDiligence.length - redFlags.length,
    items: inDiligence.map((d) => ({
      company: d.name,
      stage: d.status,
      signal: d.signal,
      status: d.signal === "flagged" || d.signal === "weak" ? "Flagged" : "In progress",
    })),
    flags: redFlags.map((d) => ({ company: d.name, flag: d.signal === "flagged" ? "Missing / weak signal" : "Weak overall signal" })),
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
      "SELECT d.id AS id, d.name AS name, d.status AS status, d.ai_score AS ai, e.weighted_total AS mine " +
        "FROM evaluations e JOIN decks d ON d.id = e.deck_id " +
        "WHERE e.evaluator_id = ? AND e.weighted_total IS NOT NULL ORDER BY e.submitted_at DESC",
    )
      .bind(c.var.user.id)
      .all<{ id: string; name: string; status: string; ai: number | null; mine: number }>()
  ).results;
}

analytics.get("/my/decks", guard("repdecks"), async (c) => {
  const rows = await myEvals(c);
  const mine = rows.map((r) => r.mine);
  const shortlisted = rows.filter((r) => ["shortlisted", "intro", "signup", "onboard_ready"].includes(r.status)).length;
  const avg = mine.length ? Math.round((mine.reduce((a, b) => a + b, 0) / mine.length) * 10) / 10 : 0;
  return c.json({
    evaluated: rows.length,
    avgGiven: avg,
    shortlisted,
    pending: 0,
    decks: rows.map((r) => ({ id: r.id, name: r.name, status: r.status, score: Math.round(r.mine * 10) / 10 })),
  });
});

analytics.get("/my/scores", guard("repscores"), async (c) => {
  const rows = await myEvals(c);
  return c.json({
    rows: rows.map((r) => ({
      id: r.id,
      name: r.name,
      ai: r.ai === null ? null : Math.round(r.ai * 10) / 10,
      mine: Math.round(r.mine * 10) / 10,
    })),
  });
});

analytics.get("/my/drift", guard("repdrift"), async (c) => {
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
