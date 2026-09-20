// Phase 4 — incubator (and shared) workflow API: role-gated stage transitions,
// jury assignment, human jury scoring (mirrors the AI path), the founder query
// loop with a stubbed email outbox, and the pipeline-events audit feed.
//
// Transition authZ is enforced by `performAction` (per-transition role lists,
// superuser bypass built into the pipeline config); coarse endpoint gates use
// `requireRole` where an action is role-shaped rather than stage-shaped.

import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../types";
import type { Edition } from "../../shared/roles";
import {
  ASSIGNABLE_EVALUATOR_ROLES,
  isAssignableEvaluator,
  roleLabel,
} from "../../shared/roles";
import {
  composite,
  signalTag,
  decisionScore,
  deltaToDisplayScale,
  formatPoints,
  formatScore,
  fromDisplayScale,
  toDisplayScale,
  overrideNeedsRationale,
  shortlistFloor,
  aiWeightFor,
} from "../../shared/scoring";
import { RUBRIC_BANDS } from "../../shared/types";
import { loadScoringSettings } from "../config/scoringSettings";
import { getStage, performAction, transitionByAction } from "../../pipeline";
import { denyMentor, requireAuth, requireRole, requireTask } from "../auth/middleware";
import {
  sendEmail,
  buildQueryEmail,
  buildSignupEmail,
  emitNotification,
} from "../email/outbox";
import { evaluatorNoun } from "../../shared/notifications";
import { mintResubmitToken, resubmitLink } from "../resubmit";
// W3-C — the audit store. `listAudit` is what makes the Activity card below
// and the console's Audit log section ONE store rather than two; F0052 is
// the score-override half.
import { listAudit, recordScoreOverrides, toAuditView } from "../audit/log";
// W7-E — a deck may carry several evaluators (migration 0058).
import {
  ASSIGNEE_PAIRS_SQL,
  assigneeIdsOf,
  clearAssignments,
  isAssignedEvaluator,
  upsertAssignment,
} from "../decks/assignments";
import { capacityFor } from "../../shared/assignment";

const pipeline = new Hono<AppEnv>();
// Scope auth to this router's own prefixes (not "*"): mounted at /api, a "*"
// middleware would 401 every unmatched /api path and mask the app's JSON 404.
// `denyMentor` rides along with `requireAuth`: every prefix below is a pipeline
// surface, and the mentor user-type is a directory record with no part in it.
pipeline.use("/decks/*", requireAuth, denyMentor);
pipeline.use("/queries/*", requireAuth, denyMentor);
// The bare "/queries" listing is NOT matched by "/queries/*" — it needs its own.
pipeline.use("/queries", requireAuth, denyMentor);
pipeline.use("/jury", requireAuth, denyMentor);
pipeline.use("/parameters", requireAuth, denyMentor);
// Aug-2026: the workspace activity log (issue 8) and the assignable-evaluator
// roster (issue 22) are authed like every other pipeline route.
pipeline.use("/activity", requireAuth, denyMentor);
pipeline.use("/evaluators", requireAuth, denyMentor);
// W7-D — the Evaluate screen's per-deck recommendations (0057).
pipeline.use("/recommendations", requireAuth, denyMentor);

interface DeckRow {
  id: string;
  edition: Edition;
  name: string;
  status: string;
  founder: string | null;
  founder_email: string | null;
  assigned_to: string | null;
  uploaded_by: string | null;
  /** Bumped by `addDeckVersion`; keys the per-version notification dedupe. */
  content_version: number | null;
}

// VC human-scoring stages (analyst core scores, then associate + partner review).
const VC_SCORING_STAGES = ["analyst_scoring", "associate_review", "partner_review"];

/** Parse a JSON body, tolerating malformed/empty payloads as an empty object. */
async function readBody<T>(c: Context<AppEnv>): Promise<Partial<T>> {
  return (await c.req.json().catch(() => ({}))) as Partial<T>;
}

/**
 * Load a deck scoped to the caller's edition. Founders are additionally scoped to
 * their own submissions (non-owned → null, i.e. 404) so the portal can never read
 * another startup's deck, queries, or audit trail.
 */
async function loadDeck(c: Context<AppEnv>, id: string): Promise<DeckRow | null> {
  const user = c.var.user;
  const row = await c.env.DB.prepare(
    "SELECT id, edition, name, status, founder, founder_email, assigned_to, uploaded_by, content_version " +
      "FROM decks WHERE id = ? AND edition = ?",
  )
    .bind(id, user.edition)
    .first<DeckRow>();
  if (!row) return null;
  if (user.role === "founder" && row.uploaded_by !== user.id) return null;
  return row;
}

function eventId(deckId: string): string {
  return `${deckId}_evt_${crypto.randomUUID()}`;
}

/**
 * W3-B — has every evaluator this deck was going to draw now scored it?
 *
 * The prototype's fourth alert ("All jury complete") assumes a panel; the two
 * editions express one differently, so the question is asked differently:
 *
 *   • **incubator** — a deck is assigned to one OR MORE evaluators
 *     (`deck_assignments`, W7-E; `decks.assigned_to` is the first of them).
 *     The panel is complete when every one of them has an `evaluations` row.
 *   • **VC** — there is no assignee. The deal is scored as it walks
 *     analyst → associate → partner, so the panel is complete when all three of
 *     those roles have scored it.
 *
 * Both read `evaluations`, which `POST /decks/:id/evaluate` writes one row of
 * per evaluator and replaces on a re-submit, so the count never double-counts.
 */
async function allEvaluatorsHaveScored(
  c: Context<AppEnv>,
  deck: DeckRow,
): Promise<boolean> {
  if (deck.edition === "incubator") {
    const assignees = await assigneeIdsOf(c.env.DB, deck.id);
    if (assignees.length === 0) return false;
    const scored = new Set(
      (
        await c.env.DB.prepare("SELECT evaluator_id FROM evaluations WHERE deck_id = ? AND evaluator_id IS NOT NULL")
          .bind(deck.id)
          .all<{ evaluator_id: string }>()
      ).results.map((r) => r.evaluator_id),
    );
    return assignees.every((id) => scored.has(id));
  }
  const scored = (
    await c.env.DB.prepare(
      "SELECT DISTINCT u.role AS role FROM evaluations e JOIN users u ON u.id = e.evaluator_id WHERE e.deck_id = ?",
    )
      .bind(deck.id)
      .all<{ role: string }>()
  ).results.map((r) => r.role);
  return ["analyst", "associate", "partner"].every((r) => scored.includes(r));
}

interface TransitionBody {
  action: string;
  note: string;
  /** Term-sheet details captured when issuing a term sheet (VC alignment call). */
  valuation?: string;
  ownership?: string;
}

/**
 * Domain-table writes that accompany a VC pipeline transition, keyed by action.
 * The prototype's per-stage dropdowns just advance the deck; we record the
 * corresponding call / investment-DD / term-sheet / legal-DD / portfolio row as a
 * side effect so the audit and downstream analytics (Phase 7) have real data.
 */
function transitionSideEffects(
  env: AppEnv["Bindings"],
  deckId: string,
  userId: string,
  action: string,
  body: Partial<TransitionBody>,
  ts: string,
): D1PreparedStatement[] {
  const db = env.DB;
  const rid = (p: string) => `${p}_${crypto.randomUUID()}`;
  switch (action) {
    // Partner call outcomes log a partner-kind call.
    case "sponsor_to_ic":
    case "another_meeting":
    case "pass_at_call":
      return [
        db
          .prepare(
            "INSERT INTO calls (id, deck_id, kind, remarks, created_by, created_at) VALUES (?, ?, 'partner', ?, ?, ?)",
          )
          .bind(rid("call"), deckId, body.note ?? null, userId, ts),
      ];
    // MP approves the deal for IC → an approved investment-DD record.
    case "mp_approve_dd":
      return [
        db
          .prepare(
            "INSERT INTO investment_dd (id, deck_id, notes, mp_approved, created_at) VALUES (?, ?, ?, 1, ?)",
          )
          .bind(rid("idd"), deckId, body.note ?? null, ts),
      ];
    // Issuing the term sheet closes the alignment call and records the term sheet.
    case "issue_term_sheet":
      return [
        db
          .prepare(
            "INSERT INTO calls (id, deck_id, kind, remarks, created_by, created_at) VALUES (?, ?, 'alignment', ?, ?, ?)",
          )
          .bind(rid("call"), deckId, body.note ?? null, userId, ts),
        db
          .prepare(
            "INSERT INTO term_sheets (id, deck_id, valuation, ownership, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .bind(rid("ts"), deckId, body.valuation ?? null, body.ownership ?? null, body.note ?? null, ts),
      ];
    case "start_legal_dd":
      return [
        db
          .prepare("INSERT INTO legal_dd (id, deck_id, notes, created_at) VALUES (?, ?, ?, ?)")
          .bind(rid("ldd"), deckId, body.note ?? null, ts),
      ];
    // Onboard → a portfolio position. Capital-deployed is entered later in the
    // Capital Deployment analytics (Phase 7); the position is created here.
    case "complete_legal_dd":
      return [
        db
          .prepare("INSERT INTO portfolio (id, deck_id, onboarded_at) VALUES (?, ?, ?)")
          .bind(rid("pf"), deckId, ts),
      ];
    default:
      return [];
  }
}

// ── Per-program shortlist floor (Session 5) ───────────────────────────────────

/**
 * The actions that put a deck on the shortlist. The incubator's `shortlist`
 * (jury_evaluation → shortlisted) and the VC's `shortlist_to_partner`
 * (associate_review → partner_review) are the two moments a human decides a deck
 * moves forward on merit, which is what the per-program floor guards.
 */
const SHORTLIST_ACTIONS = new Set(["shortlist", "shortlist_to_partner"]);

interface ShortlistGuard {
  blocked: boolean;
  score: number | null;
  minimum: number;
  /** Whose floor this is — the programme's own, or the organisation's. */
  source: "program" | "org";
  programName: string | null;
  message: string;
}

/**
 * Check a deck against its program's minimum score before it can be shortlisted.
 *
 * Per the Jul-24 demo (§8): an admin sets a **minimum score per program** and the
 * system **prevents** anyone shortlisting a deck below it. The jury still does the
 * shortlisting — this is a uniform guardrail, not auto-shortlist, so it applies to
 * every role (the escape hatch is an admin lowering the program's floor, which is
 * an auditable config change rather than a silent per-deck override).
 *
 * The deck is judged on its **decision score** — the composite form of the
 * workbench's AI · My · Average column — so the number the floor rejects is the
 * number the evaluator was looking at. A deck with no score at all can't clear a
 * floor, so it's blocked too.
 *
 * Returns null when the deck has no program, or the program has no floor set.
 */
async function checkShortlistFloor(
  c: Context<AppEnv>,
  deckId: string,
  edition: Edition,
): Promise<ShortlistGuard | null> {
  // LEFT JOIN, not JOIN: a deck with no programme still faces the org-wide
  // shortlist threshold (F0187), which the programme floor merely overrides.
  const row = await c.env.DB.prepare(
    "SELECT d.ai_score AS ai_score, p.name AS program_name, p.shortlist_min AS shortlist_min, " +
      // V4-WEIGHT (0074) — the same two columns `routes/decks.ts` reads, for the
      // same reason: the transition must blend at the split the hint blended at.
      "p.ai_weight_pct AS program_ai_weight_pct, co.ai_weight_pct AS cohort_ai_weight_pct, " +
      "(SELECT AVG(e.weighted_total) FROM evaluations e WHERE e.deck_id = d.id AND e.evaluator_id IS NOT NULL) AS human_avg " +
      "FROM decks d LEFT JOIN programs p ON p.id = d.program_id " +
      "LEFT JOIN cohorts co ON co.id = d.cohort_id WHERE d.id = ?",
  )
    .bind(deckId)
    .first<{
      ai_score: number | null;
      program_name: string | null;
      shortlist_min: number | null;
      program_ai_weight_pct: number | null;
      cohort_ai_weight_pct: number | null;
      human_avg: number | null;
    }>();
  if (!row) return null;

  // F0187 — the prototype puts a single org-wide "Shortlist threshold" on the
  // Scoring framework; the build only had the per-programme floor, reachable
  // from a different screen. The programme's own value still wins where one is
  // set; otherwise every deck is held to the organisation's.
  const scoring = await loadScoringSettings(c.env.DB, edition);
  const { minimum, source } = shortlistFloor(row.shortlist_min, scoring.shortlistThreshold);

  const score = decisionScore(
    row.ai_score,
    typeof row.human_avg === "number" ? [row.human_avg] : [],
    aiWeightFor(row.cohort_ai_weight_pct, row.program_ai_weight_pct, scoring.aiWeightPct).pct,
  );
  // An unscored deck can never clear a floor a PROGRAMME deliberately set —
  // that is the shipped guardrail's contract. The org-wide threshold is a bar a
  // score is measured against; it has nothing to say about a deck that has no
  // score yet, and applying it there would stop every unscored deck in a fresh
  // workspace from being shortlisted at all. See §8 — a client that wants the
  // stricter reading flips this one condition.
  const blocked = score === null ? source === "program" : score < minimum;
  const who = source === "program" && row.program_name ? row.program_name : "This workspace";
  // W7-D (§9): the comparison above is canonical 0–10 and stays so — `minimum`
  // and `score` go back on the wire canonical too. The SENTENCE is read by an
  // evaluator looking at the org's display scale, so it speaks that scale: a
  // 1–5 workspace is told "at least 3.8", not a 7.0 it has never seen. On the
  // default 0–10 scale these strings are byte-identical to what they were.
  const scale = scoring.scoreScale;
  const onScale = (v: number, decimals: number) =>
    scale === "0-10" ? v.toFixed(decimals) : formatScore(v, scale);
  const message =
    score === null
      ? `This deck has no score yet. ${who} requires at least ${onScale(minimum, 1)} to shortlist.`
      : source === "program"
        ? `Below the program's shortlist minimum — ${who} requires at least ${onScale(minimum, 1)}, this deck scores ${onScale(score, 2)}.`
        : `Below the organisation's shortlist threshold — at least ${onScale(minimum, 1)} is required, this deck scores ${onScale(score, 2)}.`;
  return { blocked, score, minimum, source, programName: row.program_name, message };
}

// ── Stage transitions ─────────────────────────────────────────────────────────

/** POST /decks/:id/transition — apply a role-gated pipeline action. */
pipeline.post("/decks/:id/transition", async (c) => {
  const user = c.var.user;
  const deck = await loadDeck(c, c.req.param("id"));
  if (!deck) return c.json({ error: "not_found" }, 404);

  const body = await readBody<TransitionBody>(c);
  const action = typeof body.action === "string" ? body.action : "";
  const result = performAction(deck.edition, deck.status, action, user.role);
  if (!result.ok) {
    const code = result.error === "forbidden" ? 403 : 409;
    return c.json({ error: result.error }, code);
  }

  // The action is permitted — now apply the shortlist floor: the programme's
  // own where it has one, otherwise the org-wide Scoring-framework threshold.
  if (SHORTLIST_ACTIONS.has(action)) {
    const guard = await checkShortlistFloor(c, deck.id, deck.edition);
    if (guard?.blocked) {
      return c.json(
        {
          error: "below_shortlist_minimum",
          message: guard.message,
          score: guard.score,
          minimum: guard.minimum,
          minimumSource: guard.source,
          programName: guard.programName,
        },
        409,
      );
    }
  }
  const to = result.to!;
  const ts = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE decks SET status = ?, updated_at = ? WHERE id = ?").bind(to, ts, deck.id),
    c.env.DB.prepare(
      "INSERT INTO pipeline_events (id, deck_id, actor_id, from_stage, to_stage, action, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(eventId(deck.id), deck.id, user.id, deck.status, to, action, body.note ?? null, ts),
    ...transitionSideEffects(c.env, deck.id, user.id, action, body, ts),
  ]);
  return c.json({ ok: true, status: to, label: getStage(deck.edition, to)?.label ?? to });
});

// ── Assign jury ───────────────────────────────────────────────────────────────

/** POST /decks/:id/assign — set the jury assignee and advance to Assigned. */
pipeline.post(
  "/decks/:id/assign",
  // assign_jury's pipeline roles are PM/associate/admin/superuser (the PM is the
  // decision maker; the associate the executor) — keep the coarse gate in lock-step
  // with the pipeline config so the admitted roles match the inner performAction.
  requireTask("assign", "program_manager", "program_associate", "admin"),
  async (c) => {
    const user = c.var.user;
    const deck = await loadDeck(c, c.req.param("id"));
    if (!deck) return c.json({ error: "not_found" }, 404);

    const body = await readBody<{ assigneeId: string }>(c);
    const assigneeId = typeof body.assigneeId === "string" ? body.assigneeId : "";
    // Aug-2026 issue 22 — the Assign screen picks a ROLE and then members of it,
    // so the assignee may be any evaluator role for the edition, not just jury.
    const assignee = await c.env.DB.prepare(
      "SELECT id, name, role FROM users WHERE id = ? AND edition = ? AND active = 1",
    )
      .bind(assigneeId, deck.edition)
      .first<{ id: string; name: string; role: string }>();
    if (!assignee || !isAssignableEvaluator(deck.edition as Edition, assignee.role)) {
      return c.json({ error: "invalid_assignee" }, 400);
    }

    const result = performAction(deck.edition, deck.status, "assign_jury", user.role);
    if (!result.ok) {
      const code = result.error === "forbidden" ? 403 : 409;
      return c.json({ error: result.error }, code);
    }
    const to = result.to!;
    const ts = new Date().toISOString();
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE decks SET status = ?, assigned_to = ?, updated_at = ? WHERE id = ?").bind(
        to,
        assignee.id,
        ts,
        deck.id,
      ),
      c.env.DB.prepare(
        "INSERT INTO pipeline_events (id, deck_id, actor_id, from_stage, to_stage, action, note, created_at) VALUES (?, ?, ?, ?, ?, 'assign_jury', ?, ?)",
      ).bind(eventId(deck.id), deck.id, user.id, deck.status, to, `Assigned to ${assignee.name}`, ts),
      // W7-E — the join table is the authority on who may score; a single-member
      // assignment is the one-row case of the Assign screen's cross product.
      clearAssignments(c.env.DB, deck.id),
      upsertAssignment(c.env.DB, { deckId: deck.id, evaluatorId: assignee.id, assignedBy: user.id, assignedAt: ts }),
    ]);
    return c.json({ ok: true, status: to, assignedTo: assignee.id, assignedToName: assignee.name });
  },
);

// ── Human jury scoring (mirrors the AI path) ──────────────────────────────────

interface ScoreInput {
  key: string;
  value: number;
  comment?: string | null;
}

/** POST /decks/:id/evaluate — record this evaluator's per-parameter scores.
 *  Incubator: jury/staff. VC: analyst/associate/partner core+additional scoring. */
pipeline.post(
  "/decks/:id/evaluate",
  requireTask(
    "evaluate",
    "jury",
    "program_manager",
    "program_associate",
    "admin",
    "analyst",
    "associate",
    "partner",
    "ic_member",
  ),
  async (c) => {
    const user = c.var.user;
    const deck = await loadDeck(c, c.req.param("id"));
    if (!deck) return c.json({ error: "not_found" }, 404);
    // A jury member may only score the decks assigned to them (staff — PM/admin —
    // may score any). Keeps AI-vs-jury drift analytics attributable. W7-E: "assigned
    // to them" means ANY of the deck's evaluators, not only the first.
    if (user.role === "jury" && !(await isAssignedEvaluator(c.env.DB, deck.id, user.id))) {
      return c.json({ error: "not_assigned" }, 403);
    }
    // VC evaluators score only while the deal is in a scoring stage — not after it
    // has advanced to a partner call / diligence / IC or been archived.
    if (deck.edition === "vc" && !VC_SCORING_STAGES.includes(deck.status)) {
      return c.json({ error: "not_in_scoring_stage" }, 409);
    }

    const body = await readBody<{ scores: ScoreInput[]; remarks: string }>(c);
    const rawScores = Array.isArray(body.scores) ? body.scores : [];

    // The org's scoring framework governs three things here: the scale the
    // submitted numbers are ON, the formula the roll-up uses, and whether an
    // override far from the AI needs a written rationale.
    const scoring = await loadScoringSettings(c.env.DB, deck.edition);

    const params = (
      await c.env.DB.prepare(
        "SELECT id, key, weight, informational, role_scope FROM parameters WHERE edition = ? AND active = 1",
      )
        .bind(deck.edition)
        .all<{ id: string; key: string; weight: number; informational: number; role_scope: string | null }>()
    ).results;
    const byKey = new Map(params.map((p) => [p.key, p]));

    // The AI's per-parameter values, for the override-rationale rule below.
    const aiByParam = new Map(
      (
        await c.env.DB.prepare(
          "SELECT parameter_id, value FROM scores WHERE deck_id = ? AND evaluator_kind = 'ai'",
        )
          .bind(deck.id)
          .all<{ parameter_id: string; value: number }>()
      ).results.map((r) => [r.parameter_id, r.value]),
    );

    const clean: Array<{ parameterId: string; weight: number; value: number; comment: string | null }> = [];
    const seen = new Set<string>();
    for (const s of rawScores) {
      const p = byKey.get(s.key);
      if (!p || seen.has(s.key)) continue;
      // Additional (informational) params are owned by one role — only that role
      // may score them. Silently skip another role's additional params (the form
      // only presents the caller's own), never reject the whole submission.
      if (p.informational === 1 && p.role_scope !== user.role) continue;
      seen.add(s.key);
      // Scores arrive on the org's configured display scale and are stored
      // canonically 0–10 (see shared/scoring.ts). On the default 0–10 scale
      // this is the identity, so nothing moves for an org that never changed it.
      const raw = Number.isFinite(s.value) ? s.value : 0;
      const value = fromDisplayScale(raw, scoring.scoreScale);
      clean.push({ parameterId: p.id, weight: p.weight, value, comment: s.comment ?? null });
    }
    if (clean.length === 0) return c.json({ error: "no_scores" }, 400);

    // ── Require override rationale (F0107) ────────────────────────────────────
    // Admin console → Scoring framework → "Jury must explain overrides greater
    // than N points from AI score". Enforced server-side: the client renders the
    // rationale field, but the rule lives here so it cannot be skipped by
    // posting directly. Reports every offending parameter at once rather than
    // making the evaluator re-submit for each.
    const needRationale = clean
      .filter((s) => !s.comment?.trim())
      .filter((s) => overrideNeedsRationale(s.value, aiByParam.get(s.parameterId), scoring))
      .map((s) => params.find((p) => p.id === s.parameterId)?.key ?? s.parameterId);
    if (needRationale.length > 0) {
      // W7-D (§9): enforced canonically (above), explained on the org's scale.
      // `delta` stays canonical for API consumers; `deltaDisplay` is the number
      // the evaluator's own inputs are on — 0.8 on a 1–5 workspace, not 2.
      return c.json(
        {
          error: "rationale_required",
          parameters: needRationale,
          delta: scoring.overrideRationaleDelta,
          deltaDisplay: deltaToDisplayScale(scoring.overrideRationaleDelta, scoring.scoreScale),
          message: `Explain any score more than ${formatPoints(scoring.overrideRationaleDelta, scoring.scoreScale)} from the AI's.`,
        },
        400,
      );
    }

    // Composite over the FULL rubric — a parameter the jury didn't score counts
    // 0, matching the AI path's gate semantics — using the org's own formula.
    const valueById = new Map(clean.map((s) => [s.parameterId, s.value]));
    const total = composite(
      params.map((p) => ({ weight: p.weight, value: valueById.get(p.id) ?? 0 })),
      scoring.compositeFormula,
    );
    const ts = new Date().toISOString();

    const stmts: D1PreparedStatement[] = [
      // Idempotent re-submit: replace this evaluator's prior human rows.
      c.env.DB.prepare(
        "DELETE FROM scores WHERE deck_id = ? AND evaluator_id = ? AND evaluator_kind = 'human'",
      ).bind(deck.id, user.id),
      c.env.DB.prepare("DELETE FROM evaluations WHERE deck_id = ? AND evaluator_id = ?").bind(deck.id, user.id),
    ];
    clean.forEach((s, i) => {
      stmts.push(
        c.env.DB.prepare(
          "INSERT INTO scores (id, deck_id, evaluator_id, evaluator_kind, parameter_id, value, comment, created_at) VALUES (?, ?, ?, 'human', ?, ?, ?, ?)",
        ).bind(`${deck.id}_h_${user.id}_${i}`, deck.id, user.id, s.parameterId, s.value, s.comment, ts),
      );
    });
    stmts.push(
      c.env.DB.prepare(
        "INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, verdict, remarks, submitted_at) VALUES (?, ?, ?, ?, 'scored', ?, ?)",
      ).bind(`${deck.id}_h_${user.id}_eval`, deck.id, user.id, total, body.remarks ?? null, ts),
    );

    // Opening scoring on an Assigned deck advances it into Jury Evaluation.
    let status = deck.status;
    if (deck.status === "assigned") {
      const adv = performAction(deck.edition, deck.status, "start_jury_eval", user.role);
      if (adv.ok) {
        status = adv.to!;
        stmts.push(
          c.env.DB.prepare("UPDATE decks SET status = ?, updated_at = ? WHERE id = ?").bind(status, ts, deck.id),
          c.env.DB.prepare(
            "INSERT INTO pipeline_events (id, deck_id, actor_id, from_stage, to_stage, action, note, created_at) VALUES (?, ?, ?, ?, ?, 'start_jury_eval', ?, ?)",
          ).bind(eventId(deck.id), deck.id, user.id, deck.status, status, `Jury score ${total.toFixed(2)}`, ts),
        );
      }
    }

    await c.env.DB.batch(stmts);
    // F0052 — a human value more than `delta` from the AI's is an override, and
    // the prototype's Score rows carry both numbers and the stated reason.
    await recordScoreOverrides(c, {
      deckId: deck.id,
      deckName: deck.name,
      scores: clean,
      aiByParam,
      delta: scoring.overrideRationaleDelta,
      toDisplay: (v) => toDisplayScale(v, scoring.scoreScale),
    });

    // ── W3-B producers — rows 3 and 4 of the Notifications section ───────────
    // Both fire here because this is the only route that writes an
    // `evaluations` row, and both are keyed so the idempotent re-submit above
    // (which DELETEs and re-INSERTs this evaluator's rows) re-scores without
    // re-alerting.
    await emitNotification(c.env, {
      event: "evaluator_scores_submitted",
      edition: deck.edition,
      title: `${evaluatorNoun(deck.edition)} submitted scores: ${deck.name}`,
      body:
        `${user.name} submitted scores for ${deck.name}.\n\n` +
        `Weighted total ${total.toFixed(2)} · ${signalTag(total)}.`,
      link: `/app/decks/${deck.id}`,
      deckId: deck.id,
      actorId: user.id,
      // Keyed by VERSION as well, mirroring `ai_scoring_complete` in
        // evaluate.ts. Without it the key is durable for the life of the deck:
        // human evaluation rows survive a resubmit, so once an evaluator had
        // scored a deck once, every later submission — including a fresh score on
        // a resubmitted v2 — alerted nobody, and "all evaluations complete" fired
        // exactly once per deck no matter how many versions the panel worked
        // through. The PM is the whole audience for both. Wave 3 integration.
        dedupeKey: `evaluator_scores_submitted:${deck.id}:${user.id}:v${deck.content_version ?? 1}`,
    });

    if (await allEvaluatorsHaveScored(c, deck)) {
      await emitNotification(c.env, {
        event: "all_evaluations_complete",
        edition: deck.edition,
        title: `All evaluations complete: ${deck.name}`,
        body:
          `Every evaluator assigned to ${deck.name} has submitted their scores. ` +
          "It is ready for review.",
        link: `/app/decks/${deck.id}`,
        deckId: deck.id,
        actorId: user.id,
        dedupeKey: `all_evaluations_complete:${deck.id}:v${deck.content_version ?? 1}`,
      });
    }
    return c.json({ ok: true, weightedTotal: total, signal: signalTag(total), status });
  },
);

// ── Founder query loop ────────────────────────────────────────────────────────

interface QueryRow {
  id: string;
  deck_id: string;
  questions: string;
  email_status: string;
  founder_response: string | null;
  created_at: string;
  resolved_at: string | null;
}

/** GET /decks/:id/queries — every clarification query for a deck. */
pipeline.get("/decks/:id/queries", async (c) => {
  const deck = await loadDeck(c, c.req.param("id"));
  if (!deck) return c.json({ error: "not_found" }, 404);
  const rows = (
    await c.env.DB.prepare(
      "SELECT id, deck_id, questions, email_status, founder_response, created_at, resolved_at FROM queries WHERE deck_id = ? ORDER BY created_at DESC",
    )
      .bind(deck.id)
      .all<QueryRow>()
  ).results;
  return c.json({ queries: rows });
});

/**
 * GET /queries — every founder query in the edition (the Query screen's table
 * needs per-deck status without N+1 fetches). Staff-only: the rows carry the
 * clarification questions asked about other startups.
 */
pipeline.get(
  "/queries",
  requireRole(
    "program_associate",
    "program_manager",
    "admin",
    "analyst",
    "associate",
    "partner",
    "jury",
    "ic_member",
  ),
  async (c) => {
    const rows = (
      await c.env.DB.prepare(
        "SELECT q.id, q.deck_id, q.questions, q.email_status, q.founder_response, q.created_at, q.resolved_at " +
          "FROM queries q JOIN decks d ON d.id = q.deck_id WHERE d.edition = ? ORDER BY q.created_at DESC",
      )
        .bind(c.var.user.edition)
        .all()
    ).results;
    return c.json({ queries: rows });
  },
);

/** Longest subject the Query screen may set — a subject line, not a paragraph. */
const MAX_QUERY_SUBJECT = 200;

/**
 * POST /decks/:id/queries — raise a founder query and email it.
 *
 * Session 7 opened this to the VC roles that own the Query screen (`analyst`,
 * `associate` — see `VC_NAV`). The VC edition raises exactly the same
 * clarification loop against the same table; only the roles differ.
 *
 * W7-C (F0216 / F0217): `questions` is the letter the compose card showed and
 * `subject` the Subject the operator typed. With a subject, the email IS that
 * letter under that subject — no second greeting, no server-minted subject.
 * Every query email carries a freshly minted resubmit link, substituted for
 * the letter's `[your secure response link]` placeholder; the stored query keeps
 * the placeholder, so no raw token is ever persisted outside the outbox.
 * `delivered` reports what the outbox actually did, so the screen can say
 * "recorded" rather than "sent" while no sending domain is configured.
 */
pipeline.post(
  "/decks/:id/queries",
  requireTask("query", "program_associate", "program_manager", "admin", "analyst", "associate", "partner"),
  async (c) => {
    const user = c.var.user;
    const deck = await loadDeck(c, c.req.param("id"));
    if (!deck) return c.json({ error: "not_found" }, 404);

    const body = await readBody<{ questions: string; subject?: string }>(c);
    const questions = typeof body.questions === "string" ? body.questions.trim() : "";
    if (!questions) return c.json({ error: "questions_required" }, 400);
    const subject = typeof body.subject === "string" ? body.subject.trim() : "";
    // A line break in a subject is a header injection, not a typo.
    if (/[\r\n]/.test(subject) || subject.length > MAX_QUERY_SUBJECT) {
      return c.json({ error: "invalid_subject" }, 400);
    }

    const ts = new Date().toISOString();
    const queryId = `qry_${crypto.randomUUID()}`;
    const stmts: D1PreparedStatement[] = [
      c.env.DB.prepare(
        "INSERT INTO queries (id, deck_id, questions, email_status, created_at) VALUES (?, ?, ?, 'sent', ?)",
      ).bind(queryId, deck.id, questions, ts),
    ];
    // Raising a query on a deck still in manual review marks it Incomplete
    // (Manual Review → Incomplete → Query founder in the flow diagram).
    if (deck.status === "manual_review") {
      const flagged = performAction(deck.edition, deck.status, "flag_incomplete", user.role);
      if (flagged.ok) {
        stmts.push(
          c.env.DB.prepare("UPDATE decks SET status = ?, updated_at = ? WHERE id = ?").bind(flagged.to!, ts, deck.id),
          c.env.DB.prepare(
            "INSERT INTO pipeline_events (id, deck_id, actor_id, from_stage, to_stage, action, note, created_at) VALUES (?, ?, ?, ?, ?, 'flag_incomplete', 'Query raised', ?)",
          ).bind(eventId(deck.id), deck.id, user.id, deck.status, flagged.to!, ts),
        );
      }
    }
    await c.env.DB.batch(stmts);

    // Deliver via the stubbed outbox. Prefer the deck's uploader email; fall
    // back to a portal placeholder so the loop is always exercisable.
    const uploader = deck.uploaded_by
      ? await c.env.DB.prepare("SELECT email, name FROM users WHERE id = ?")
          .bind(deck.uploaded_by)
          .first<{ email: string; name: string }>()
      : null;
    // Prefer the founder's own address (captured at intake in Session 5) over
    // the uploader's — a staff bulk upload would otherwise mail the analyst.
    const toEmail = deck.founder_email ?? uploader?.email ?? "founder@portal.local";
    const { token } = await mintResubmitToken(c.env, { deckId: deck.id, edition: deck.edition, toEmail });
    const email = buildQueryEmail({
      deckName: deck.name,
      founderName: deck.founder ?? uploader?.name ?? null,
      questions,
      subject,
      link: resubmitLink(c.env, token),
    });
    const sent = await sendEmail(c.env, {
      kind: "founder_query",
      toEmail,
      toName: deck.founder ?? uploader?.name ?? null,
      subject: email.subject,
      body: email.body,
      deckId: deck.id,
      queryId,
    });

    return c.json({ ok: true, queryId, emailStatus: sent.status, delivered: sent.status === "sent" });
  },
);

/** POST /queries/:id/respond — founder answers; deck re-enters intake. */
pipeline.post("/queries/:id/respond", async (c) => {
  const user = c.var.user;
  const query = await c.env.DB.prepare(
    "SELECT id, deck_id, questions, email_status, founder_response, created_at, resolved_at FROM queries WHERE id = ?",
  )
    .bind(c.req.param("id"))
    .first<QueryRow>();
  if (!query) return c.json({ error: "not_found" }, 404);
  const deck = await loadDeck(c, query.deck_id);
  if (!deck) return c.json({ error: "not_found" }, 404);

  // Who may record a founder response mirrors the founder_response transition
  // roles: the founder (loadDeck already guarantees ownership) or staff relaying
  // on their behalf (associate/admin/superuser).
  const canRespond =
    user.role === "founder" ||
    ["program_associate", "admin", "superuser"].includes(user.role);
  if (!canRespond) return c.json({ error: "forbidden" }, 403);

  const body = await readBody<{ response: string }>(c);
  const response = typeof body.response === "string" ? body.response.trim() : "";
  if (!response) return c.json({ error: "response_required" }, 400);

  const ts = new Date().toISOString();
  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare(
      "UPDATE queries SET founder_response = ?, email_status = 'answered', resolved_at = ? WHERE id = ?",
    ).bind(response, ts, query.id),
  ];
  // Move the deck back to Uploaded so it can be re-submitted for AI (only when
  // it's actually waiting on the founder).
  let status = deck.status;
  if (transitionByAction(deck.edition, deck.status, "founder_response")) {
    const moved = performAction(deck.edition, deck.status, "founder_response", user.role);
    if (moved.ok) {
      status = moved.to!;
      stmts.push(
        c.env.DB.prepare("UPDATE decks SET status = ?, complete = 1, updated_at = ? WHERE id = ?").bind(status, ts, deck.id),
        c.env.DB.prepare(
          "INSERT INTO pipeline_events (id, deck_id, actor_id, from_stage, to_stage, action, note, created_at) VALUES (?, ?, ?, ?, ?, 'founder_response', 'Founder responded', ?)",
        ).bind(eventId(deck.id), deck.id, user.id, deck.status, status, ts),
      );
    }
  }
  await c.env.DB.batch(stmts);

  // W3-B producer — "Startup responded to clarification questions". Default OFF
  // in the prototype's mask, which is why this one is easy to believe is dead:
  // the producer exists and the toggle starts down. Keyed on the query, so a
  // staff member relaying a corrected answer does not alert the room twice.
  await emitNotification(c.env, {
    event: "founder_responded",
    edition: deck.edition,
    title: `Startup responded: ${deck.name}`,
    body:
      `${deck.founder ?? "The founder"} answered the clarification questions on ${deck.name}.\n\n` +
      `${response}`,
    link: `/app/decks/${deck.id}`,
    deckId: deck.id,
    actorId: user.id,
    dedupeKey: `founder_responded:${query.id}`,
  });

  return c.json({ ok: true, status });
});

// ── Signup invite (For Sign up screen) ────────────────────────────────────────

/** POST /decks/:id/send-signup — advance to Signup + send the (stubbed) invite. */
pipeline.post(
  "/decks/:id/send-signup",
  requireTask("signuppipeline", "program_associate", "admin"),
  async (c) => {
    const user = c.var.user;
    const deck = await loadDeck(c, c.req.param("id"));
    if (!deck) return c.json({ error: "not_found" }, 404);

    const result = performAction(deck.edition, deck.status, "send_signup", user.role);
    if (!result.ok) {
      const code = result.error === "forbidden" ? 403 : 409;
      return c.json({ error: result.error }, code);
    }
    const to = result.to!;
    const ts = new Date().toISOString();
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE decks SET status = ?, updated_at = ? WHERE id = ?").bind(to, ts, deck.id),
      c.env.DB.prepare(
        "INSERT INTO pipeline_events (id, deck_id, actor_id, from_stage, to_stage, action, note, created_at) VALUES (?, ?, ?, ?, ?, 'send_signup', 'Sign-up invite sent', ?)",
      ).bind(eventId(deck.id), deck.id, user.id, deck.status, to, ts),
    ]);

    const uploader = deck.uploaded_by
      ? await c.env.DB.prepare("SELECT email, name FROM users WHERE id = ?")
          .bind(deck.uploaded_by)
          .first<{ email: string; name: string }>()
      : null;
    const { subject, body: emailBody } = buildSignupEmail({
      deckName: deck.name,
      founderName: deck.founder ?? uploader?.name ?? null,
    });
    await sendEmail(c.env, {
      kind: "signup_invite",
      toEmail: uploader?.email ?? "founder@portal.local",
      toName: deck.founder ?? uploader?.name ?? null,
      subject,
      body: emailBody,
      deckId: deck.id,
    });
    return c.json({ ok: true, status: to });
  },
);

// ── Incubator Evaluate: per-deck recommendations (W7-D, 0057) ────────────────
//
// The status select beside each deck on the Evaluate screen —
// `AISJ_IC_SuserV15` `EV_STATUS_OPTS`. It records the evaluator's
// RECOMMENDATION and moves nothing: Shortlist and Reject as decisions remain
// the workbench's buttons and `performAction`'s transitions. See 0057's header.

const RECOMMENDATIONS = ["shortlist", "hold", "need_more_info", "reject", "evaluated"] as const;
type Recommendation = (typeof RECOMMENDATIONS)[number];

/** The incubator roles that work the Evaluate screen (nav `evaluate` / `jassigned`). */
const RECOMMENDING_ROLES = ["jury", "program_manager", "program_associate", "admin"] as const;

/**
 * GET /recommendations — the caller's own recommendation per deck, and the
 * decks they have already submitted scores for (the screen's "Evaluated"
 * badge), in one round trip rather than one per row.
 */
pipeline.get("/recommendations", requireTask("evaluate", ...RECOMMENDING_ROLES), async (c) => {
  const user = c.var.user;
  const [recs, evaluated] = await Promise.all([
    c.env.DB.prepare(
      "SELECT r.deck_id, r.status FROM evaluation_recommendations r JOIN decks d ON d.id = r.deck_id " +
        "WHERE r.user_id = ? AND d.edition = ?",
    )
      .bind(user.id, user.edition)
      .all<{ deck_id: string; status: Recommendation }>(),
    c.env.DB.prepare(
      "SELECT DISTINCT e.deck_id FROM evaluations e JOIN decks d ON d.id = e.deck_id " +
        "WHERE e.evaluator_id = ? AND d.edition = ?",
    )
      .bind(user.id, user.edition)
      .all<{ deck_id: string }>(),
  ]);
  return c.json({
    recommendations: Object.fromEntries(recs.results.map((r) => [r.deck_id, r.status])),
    evaluated: evaluated.results.map((r) => r.deck_id),
  });
});

/** PUT /decks/:id/recommendation — set (or replace) the caller's recommendation. */
pipeline.put(
  "/decks/:id/recommendation",
  requireTask("evaluate", ...RECOMMENDING_ROLES),
  async (c) => {
    const user = c.var.user;
    const deck = await loadDeck(c, c.req.param("id"));
    if (!deck) return c.json({ error: "not_found" }, 404);
    if (deck.edition !== "incubator") return c.json({ error: "not_incubator" }, 400);
    // The same rule scoring applies: a jury member works only the decks
    // assigned to them. Staff may recommend on any deck in the edition.
    if (user.role === "jury" && deck.assigned_to !== user.id) {
      return c.json({ error: "not_assigned" }, 403);
    }
    const body = await readBody<{ status: string }>(c);
    const status = body.status as Recommendation;
    if (!RECOMMENDATIONS.includes(status)) return c.json({ error: "invalid_status" }, 400);

    const ts = new Date().toISOString();
    await c.env.DB.prepare(
      "INSERT INTO evaluation_recommendations (deck_id, user_id, status, updated_at) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT (deck_id, user_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at",
    )
      .bind(deck.id, user.id, status, ts)
      .run();
    return c.json({ ok: true, deckId: deck.id, status });
  },
);

// ── VC: Investment Committee voting ───────────────────────────────────────────

const IC_VOTES = ["invest", "hold", "need_more_info", "pass"] as const;
type IcVoteValue = (typeof IC_VOTES)[number];

interface IcVoteRow {
  id: string;
  member_id: string;
  member_name: string | null;
  vote: IcVoteValue;
  comment: string | null;
  created_at: string;
}

/** Empty per-option tally. */
function emptyTally(): Record<IcVoteValue, number> {
  return { invest: 0, hold: 0, need_more_info: 0, pass: 0 };
}

/**
 * POST /decks/:id/ic-vote — record (or replace) this IC member's vote on a deck
 * in IC review. One vote per member per deck; re-voting overwrites the prior one.
 */
pipeline.post(
  "/decks/:id/ic-vote",
  requireTask("icpipeline", "ic_member", "partner", "admin"),
  async (c) => {
    const user = c.var.user;
    const deck = await loadDeck(c, c.req.param("id"));
    if (!deck) return c.json({ error: "not_found" }, 404);
    if (deck.edition !== "vc") return c.json({ error: "not_vc" }, 400);
    if (deck.status !== "ic_review") return c.json({ error: "not_in_ic_review" }, 409);

    const body = await readBody<{ vote: string; comment: string }>(c);
    const vote = body.vote as IcVoteValue;
    if (!IC_VOTES.includes(vote)) return c.json({ error: "invalid_vote" }, 400);

    const ts = new Date().toISOString();
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM ic_votes WHERE deck_id = ? AND member_id = ?").bind(deck.id, user.id),
      c.env.DB.prepare(
        "INSERT INTO ic_votes (id, deck_id, member_id, vote, comment, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(`icv_${crypto.randomUUID()}`, deck.id, user.id, vote, body.comment ?? null, ts),
    ]);
    return c.json({ ok: true, vote });
  },
);

/** GET /decks/:id/ic-votes — every IC member's vote + the aggregated tally.
 *  Committee-only: individual ballots are confidential to the committee (+ MP). */
pipeline.get("/decks/:id/ic-votes", requireTask("icpipeline", "ic_member", "partner", "admin"), async (c) => {
  const deck = await loadDeck(c, c.req.param("id"));
  if (!deck) return c.json({ error: "not_found" }, 404);
  const rows = (
    await c.env.DB.prepare(
      "SELECT v.id, v.member_id, v.vote, v.comment, v.created_at, u.name AS member_name " +
        "FROM ic_votes v LEFT JOIN users u ON u.id = v.member_id WHERE v.deck_id = ? ORDER BY v.created_at",
    )
      .bind(deck.id)
      .all<IcVoteRow>()
  ).results;

  const tally = emptyTally();
  for (const r of rows) tally[r.vote] += 1;
  const total = rows.length;
  // Recommendation = the plurality option (invest breaks ties upward); null when
  // no votes are in yet.
  let recommendation: IcVoteValue | null = null;
  if (total > 0) {
    recommendation = IC_VOTES.reduce((best, v) => (tally[v] > tally[best] ? v : best), IC_VOTES[0]);
  }
  const myVote = rows.find((r) => r.member_id === c.var.user.id)?.vote ?? null;

  return c.json({
    votes: rows.map((r) => ({
      id: r.id,
      memberId: r.member_id,
      memberName: r.member_name ?? "IC member",
      vote: r.vote,
      comment: r.comment,
      createdAt: r.created_at,
    })),
    tally,
    total,
    recommendation,
    myVote,
  });
});

// ── Audit + lookups ───────────────────────────────────────────────────────────

/** GET /decks/:id/events — the pipeline-events audit trail (Activity Log). */
pipeline.get("/decks/:id/events", async (c) => {
  const deck = await loadDeck(c, c.req.param("id"));
  if (!deck) return c.json({ error: "not_found" }, 404);
  const rows = (
    await c.env.DB.prepare(
      "SELECT e.id, e.from_stage, e.to_stage, e.action, e.note, e.created_at, u.name AS actor_name " +
        "FROM pipeline_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.deck_id = ? ORDER BY e.created_at DESC",
    )
      .bind(deck.id)
      .all<{
        id: string;
        from_stage: string | null;
        to_stage: string;
        action: string;
        note: string | null;
        created_at: string;
        actor_name: string | null;
      }>()
  ).results;
  const events = rows.map((r) => ({
    id: r.id,
    fromStage: r.from_stage,
    fromLabel: r.from_stage ? getStage(deck.edition, r.from_stage)?.label ?? r.from_stage : null,
    toStage: r.to_stage,
    toLabel: getStage(deck.edition, r.to_stage)?.label ?? r.to_stage,
    action: r.action,
    note: r.note,
    actorName: r.actor_name ?? "AI",
    createdAt: r.created_at,
  }));
  return c.json({ events });
});

/** GET /decks/:id/my-scores — the caller's own human scores (prefills the form so
 *  reopening a scored deck shows the saved values, not defaults). */
pipeline.get("/decks/:id/my-scores", async (c) => {
  const deck = await loadDeck(c, c.req.param("id"));
  if (!deck) return c.json({ error: "not_found" }, 404);
  const rows = (
    await c.env.DB.prepare(
      // W2-A — the per-parameter comment comes back too: it is the override
      // rationale (F0107), and re-opening a scored deck must show what was
      // written or the next submit will be refused for a missing one.
      "SELECT p.key AS key, s.value AS value, s.comment AS comment FROM scores s JOIN parameters p ON p.id = s.parameter_id " +
        "WHERE s.deck_id = ? AND s.evaluator_kind = 'human' AND s.evaluator_id = ? ORDER BY p.sort_order",
    )
      .bind(deck.id, c.var.user.id)
      .all<{ key: string; value: number; comment: string | null }>()
  ).results;
  return c.json({
    scores: rows.map((r) => ({ key: r.key, value: r.value, comment: r.comment ?? undefined })),
  });
});

/**
 * GET /activity — the workspace ACTIVITY LOG (Aug-2026 issue 8).
 *
 * The All-decks right rail shows this under the cohort rating thresholds: the
 * most recent stage transitions across the edition, optionally narrowed to the
 * program / cohort the toolbar filter is on.
 *
 * **W3-C — this is now a FILTERED VIEW, not a second source of truth.** It goes
 * through `listAudit()` — the same reader the console's Audit log section uses —
 * with `categories: ["pipeline"]`, so the card and the section can never
 * disagree about what happened. The response shape, the 12-row default, the
 * 1–50 clamp and the founder isolation are all unchanged; only the query moved.
 */
pipeline.get("/activity", async (c) => {
  const { id: userId, edition, role } = c.var.user;
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 12) || 12, 1), 50);

  const { rows } = await listAudit(c.env.DB, {
    edition,
    categories: ["pipeline"],
    programId: c.req.query("programId") || undefined,
    cohortId: c.req.query("cohortId") || undefined,
    // Founders only ever see their own submissions' history.
    founderId: role === "founder" ? userId : undefined,
    limit,
  });

  return c.json({
    events: rows.map((r) => ({
      ...toAuditView(edition, r),
      // The card renders the transition itself, so the two stage labels stay on
      // the wire beside the composed sentence every other reader uses.
      deckId: r.deck_id,
      deckName: r.deck_name,
      toStage: r.to_stage,
      toLabel: r.to_stage ? (getStage(edition, r.to_stage)?.label ?? r.to_stage) : null,
      fromLabel: r.from_stage ? (getStage(edition, r.from_stage)?.label ?? r.from_stage) : null,
      note: r.note,
      actorName: r.actor_name ?? "AI",
      actorTitle: r.actor_title ?? undefined,
      createdAt: r.created_at,
    })),
  });
});

/**
 * GET /evaluators — assignable evaluators grouped by role (Assign screen, panel
 * 2 + 3). Each member carries their current open workload so the assigner can
 * balance, and their alias title (issue 1) where one is set.
 *
 * W7-E / F0258 — and the load bar's denominator: `capacity` is the user's own
 * `evaluation_capacity`, else the role default. `openDecks` counts every deck the
 * member is ANY evaluator on, not only the ones they are first on.
 */
pipeline.get(
  "/evaluators",
  requireRole("program_associate", "program_manager", "admin", "associate", "analyst", "partner"),
  async (c) => {
    const edition = c.var.user.edition as Edition;
    const assignable = ASSIGNABLE_EVALUATOR_ROLES[edition];
    const placeholders = assignable.map(() => "?").join(", ");
    const rows = (
      await c.env.DB.prepare(
        "SELECT u.id, u.name, u.initials, u.role, u.title, u.evaluation_capacity, " +
          `(SELECT COUNT(DISTINCT d.id) FROM decks d JOIN (${ASSIGNEE_PAIRS_SQL}) ap ON ap.deck_id = d.id ` +
          "WHERE ap.evaluator_id = u.id AND d.status IN ('assigned', 'jury_evaluation', 'analyst_scoring', 'associate_review', 'partner_review')) AS open_decks " +
          `FROM users u WHERE u.edition = ? AND u.active = 1 AND u.role IN (${placeholders}) ORDER BY u.name`,
      )
        .bind(edition, ...assignable)
        .all<{
          id: string;
          name: string;
          initials: string;
          role: string;
          title: string | null;
          evaluation_capacity: number | null;
          open_decks: number;
        }>()
    ).results;

    const groups = assignable.map((role) => ({
      role,
      roleLabel: roleLabel(edition, role),
      members: rows
        .filter((r) => r.role === role)
        .map((r) => ({
          id: r.id,
          name: r.name,
          initials: r.initials,
          role: r.role,
          title: r.title ?? undefined,
          openDecks: r.open_decks ?? 0,
          capacity: capacityFor(r.role, r.evaluation_capacity),
        })),
    }));
    return c.json({ groups });
  },
);

/** GET /jury — assignable jury members in the caller's edition (Assign screen). */
pipeline.get("/jury", requireTask("assign", "program_associate", "program_manager", "admin"), async (c) => {
  const rows = (
    await c.env.DB.prepare(
      "SELECT id, name, initials FROM users WHERE edition = ? AND role = 'jury' AND active = 1 ORDER BY name",
    )
      .bind(c.var.user.edition)
      .all<{ id: string; name: string; initials: string }>()
  ).results;
  return c.json({ jury: rows });
});

/** GET /parameters — the caller edition's rubric parameters (scoring form).
 *  Returns the informational flag + role_scope so the client can render the
 *  core areas in the weighted composite and the caller's own role-scoped
 *  additional params in a separate section. */
pipeline.get("/parameters", async (c) => {
  const edition = c.var.user.edition;
  const paramRows = (
    await c.env.DB.prepare(
      "SELECT id, key, name, weight, informational, role_scope, prompt, description FROM parameters WHERE edition = ? AND active = 1 ORDER BY sort_order",
    )
      .bind(edition)
      .all<{
        id: string;
        key: string;
        name: string;
        weight: number;
        informational: number;
        role_scope: string | null;
        prompt: string | null;
        description: string | null;
      }>()
  ).results;
  // W2-B — the rubric bands the parameter detail panel shows.
  //
  // `anchors` is the shared five-band SCALE (specs §7), replacing the global
  // four-band `rubric_anchors` table this used to read; that table is dropped
  // in `0039`. The scale is a constant now, so no query is needed for it.
  const anchors = RUBRIC_BANDS.map((b) => ({
    band: b.key,
    min: b.min,
    max: b.max,
    label: b.name,
  }));
  // Per-parameter anchor TEXT (`parameter_rubric_bands`, 0027) — what "9–10"
  // actually means for THIS area. `bands` is additive, so the existing client
  // keeps working; EvaluatePage still renders the generic scale until Wave 7
  // adopts it (F0102, recorded in §9).
  const bandRows = (
    await c.env.DB.prepare(
      "SELECT b.parameter_id, b.band_index, b.band_label, b.band_name, b.description " +
        "FROM parameter_rubric_bands b JOIN parameters p ON p.id = b.parameter_id " +
        "WHERE p.edition = ? AND p.active = 1 ORDER BY b.band_index",
    )
      .bind(edition)
      .all<{
        parameter_id: string;
        band_index: number;
        band_label: string;
        band_name: string;
        description: string | null;
      }>()
  ).results;
  // W7-D — the parameter detail panel's "AI clarification questions (asked when
  // signals are weak)" (`AISJ_IC_SuserV15` `evOpenParam`, F0442). The bank is
  // `question_bank` (0028); only active questions, in the area's Q order.
  const questionRows = (
    await c.env.DB.prepare(
      "SELECT q.parameter_id, q.text FROM question_bank q JOIN parameters p ON p.id = q.parameter_id " +
        "WHERE p.edition = ? AND p.active = 1 AND q.active = 1 ORDER BY q.seq",
    )
      .bind(edition)
      .all<{ parameter_id: string; text: string }>()
  ).results;
  const parameters = paramRows.map((p) => ({
    key: p.key,
    name: p.name,
    weight: p.weight,
    informational: p.informational === 1,
    roleScope: p.role_scope ?? undefined,
    questions: questionRows.filter((q) => q.parameter_id === p.id).map((q) => q.text),
    // Aug-2026 issue 19 — the Evaluate screen's third panel shows the evaluation
    // prompt for whichever parameter is clicked in the second panel.
    prompt: p.prompt ?? undefined,
    // W7-D — the scorer-facing description (0025, spec §6.2) the prototype's
    // "My additional parameters at a glance" card shows under each name.
    description: p.description ?? undefined,
    bands: bandRows
      .filter((b) => b.parameter_id === p.id)
      .map((b) => ({
        index: b.band_index,
        label: b.band_label,
        name: b.band_name,
        description: b.description,
      })),
  }));
  return c.json({ parameters, anchors });
});

export { pipeline };
export default pipeline;
