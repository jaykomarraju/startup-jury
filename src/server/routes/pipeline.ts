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
import { weightedTotal, signalTag } from "../../shared/scoring";
import { getStage, performAction, transitionByAction } from "../../pipeline";
import { requireAuth, requireRole } from "../auth/middleware";
import { sendEmail, buildQueryEmail, buildSignupEmail } from "../email/outbox";

const pipeline = new Hono<AppEnv>();
// Scope auth to this router's own prefixes (not "*"): mounted at /api, a "*"
// middleware would 401 every unmatched /api path and mask the app's JSON 404.
pipeline.use("/decks/*", requireAuth);
pipeline.use("/queries/*", requireAuth);
pipeline.use("/jury", requireAuth);
pipeline.use("/parameters", requireAuth);

interface DeckRow {
  id: string;
  edition: Edition;
  name: string;
  status: string;
  founder: string | null;
  assigned_to: string | null;
  uploaded_by: string | null;
}

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
    "SELECT id, edition, name, status, founder, assigned_to, uploaded_by FROM decks WHERE id = ? AND edition = ?",
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

interface TransitionBody {
  action: string;
  note: string;
  /** Term-sheet details captured when issuing a term sheet (VC). */
  valuation?: string;
  ownership?: string;
  /** Capital deployed captured on onboard (VC portfolio). */
  capitalDeployed?: string;
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
    // Onboard → a portfolio position (capital deployed).
    case "complete_legal_dd":
      return [
        db
          .prepare(
            "INSERT INTO portfolio (id, deck_id, capital_deployed, onboarded_at) VALUES (?, ?, ?, ?)",
          )
          .bind(rid("pf"), deckId, body.capitalDeployed ?? null, ts),
      ];
    default:
      return [];
  }
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
  // assign_jury's pipeline roles are associate/admin/superuser — keep the coarse
  // gate in lock-step so a program_manager isn't admitted only to hit an inner 403.
  requireRole("program_associate", "admin"),
  async (c) => {
    const user = c.var.user;
    const deck = await loadDeck(c, c.req.param("id"));
    if (!deck) return c.json({ error: "not_found" }, 404);

    const body = await readBody<{ assigneeId: string }>(c);
    const assigneeId = typeof body.assigneeId === "string" ? body.assigneeId : "";
    const assignee = await c.env.DB.prepare(
      "SELECT id, name FROM users WHERE id = ? AND edition = ? AND role = 'jury' AND active = 1",
    )
      .bind(assigneeId, deck.edition)
      .first<{ id: string; name: string }>();
    if (!assignee) return c.json({ error: "invalid_assignee" }, 400);

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
  requireRole("jury", "program_manager", "admin", "analyst", "associate", "partner"),
  async (c) => {
    const user = c.var.user;
    const deck = await loadDeck(c, c.req.param("id"));
    if (!deck) return c.json({ error: "not_found" }, 404);
    // A jury member may only score the decks assigned to them (staff — PM/admin —
    // may score any). Keeps AI-vs-jury drift analytics attributable.
    if (user.role === "jury" && deck.assigned_to !== user.id) {
      return c.json({ error: "not_assigned" }, 403);
    }

    const body = await readBody<{ scores: ScoreInput[]; remarks: string }>(c);
    const rawScores = Array.isArray(body.scores) ? body.scores : [];

    const params = (
      await c.env.DB.prepare(
        "SELECT id, key, weight FROM parameters WHERE edition = ? AND active = 1",
      )
        .bind(deck.edition)
        .all<{ id: string; key: string; weight: number }>()
    ).results;
    const byKey = new Map(params.map((p) => [p.key, p]));

    const clean: Array<{ parameterId: string; weight: number; value: number; comment: string | null }> = [];
    const seen = new Set<string>();
    for (const s of rawScores) {
      const p = byKey.get(s.key);
      if (!p || seen.has(s.key)) continue;
      seen.add(s.key);
      const value = Math.max(0, Math.min(10, Number.isFinite(s.value) ? s.value : 0));
      clean.push({ parameterId: p.id, weight: p.weight, value, comment: s.comment ?? null });
    }
    if (clean.length === 0) return c.json({ error: "no_scores" }, 400);

    // Weighted total over the FULL rubric weight — a parameter the jury didn't
    // score counts 0, matching the AI path's gate semantics.
    const valueById = new Map(clean.map((s) => [s.parameterId, s.value]));
    const total = weightedTotal(
      params.map((p) => ({ weight: p.weight, value: valueById.get(p.id) ?? 0 })),
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

/** POST /decks/:id/queries — raise a founder query + send the (stubbed) email. */
pipeline.post(
  "/decks/:id/queries",
  requireRole("program_associate", "program_manager", "admin"),
  async (c) => {
    const user = c.var.user;
    const deck = await loadDeck(c, c.req.param("id"));
    if (!deck) return c.json({ error: "not_found" }, 404);

    const body = await readBody<{ questions: string }>(c);
    const questions = typeof body.questions === "string" ? body.questions.trim() : "";
    if (!questions) return c.json({ error: "questions_required" }, 400);

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
    const { subject, body: emailBody } = buildQueryEmail({
      deckName: deck.name,
      founderName: deck.founder ?? uploader?.name ?? null,
      questions,
    });
    await sendEmail(c.env, {
      kind: "founder_query",
      toEmail: uploader?.email ?? "founder@portal.local",
      toName: deck.founder ?? uploader?.name ?? null,
      subject,
      body: emailBody,
      deckId: deck.id,
      queryId,
    });

    return c.json({ ok: true, queryId, emailStatus: "sent" });
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
  return c.json({ ok: true, status });
});

// ── Signup invite (For Sign up screen) ────────────────────────────────────────

/** POST /decks/:id/send-signup — advance to Signup + send the (stubbed) invite. */
pipeline.post(
  "/decks/:id/send-signup",
  requireRole("program_associate", "admin"),
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
  requireRole("ic_member", "partner", "admin"),
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

/** GET /decks/:id/ic-votes — every IC member's vote + the aggregated tally. */
pipeline.get("/decks/:id/ic-votes", async (c) => {
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

/** GET /jury — assignable jury members in the caller's edition (Assign screen). */
pipeline.get("/jury", requireRole("program_associate", "program_manager", "admin"), async (c) => {
  const rows = (
    await c.env.DB.prepare(
      "SELECT id, name, initials FROM users WHERE edition = ? AND role = 'jury' AND active = 1 ORDER BY name",
    )
      .bind(c.var.user.edition)
      .all<{ id: string; name: string; initials: string }>()
  ).results;
  return c.json({ jury: rows });
});

/** GET /parameters — the caller edition's rubric parameters (scoring form). */
pipeline.get("/parameters", async (c) => {
  const rows = (
    await c.env.DB.prepare(
      "SELECT key, name, weight FROM parameters WHERE edition = ? AND active = 1 ORDER BY sort_order",
    )
      .bind(c.var.user.edition)
      .all<{ key: string; name: string; weight: number }>()
  ).results;
  return c.json({ parameters: rows });
});

export { pipeline };
export default pipeline;
