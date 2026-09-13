// W7-E — the Assign screen's two verbs (`AISJ_IC_SuserV15/panel-assign.html`).
//
//   GET  /api/assignments/board   what column 1 draws on each deck row beyond the
//                                 deck listing: the 13-bar parameter sparkline and
//                                 its breakdown (F0212 / F0263), the AI+ / AI++ /
//                                 AI+++ role scores out of 30 (F0265 / F0269), and
//                                 who already evaluates it.
//   POST /api/assignments         Confirm assignment: every selected deck × every
//                                 selected member (F0190), all-or-nothing (F0211),
//                                 with a deadline (F0210), the optional
//                                 instructions (F0257) and the email (F0256).
//
// `POST /api/decks/:id/assign` (pipeline.ts) stays: it is the one-deck, one-member
// case, used by nothing on this screen any more but by tests and scripts.

import { Hono } from "hono";
import type { AppEnv } from "../types";
import type { Edition, Role } from "../../shared/roles";
import { ADDITIONAL_PARAM_OWNERS, isAssignableEvaluator, roleLabel } from "../../shared/roles";
import { withholdsAiScore } from "../../shared/scoring";
import { dueAtFrom } from "../../shared/assignment";
import { performAction, transitionByAction } from "../../pipeline";
import { denyMentor, requireAuth, requireRole, requireTask } from "../auth/middleware";
import { loadScoringSettings } from "../config/scoringSettings";
import { buildAssignmentEmail, sendEmail } from "../email/outbox";
import { ASSIGNEE_PAIRS_SQL, clearAssignments, upsertAssignment } from "../decks/assignments";

export const assignments = new Hono<AppEnv>();
assignments.use("*", requireAuth, denyMentor);

/** The stages column 1 lists as selectable: fresh from the AI gate, or already out with evaluators. */
const ASSIGNABLE_STAGES = ["ai_evaluated", "assigned"];

/** Bounds on one confirmation — generous for a cohort, small enough to fit one D1 batch. */
const MAX_DECKS = 100;
const MAX_MEMBERS = 25;
const MAX_NOTE = 2000;

function placeholders(n: number): string {
  return Array.from({ length: n }, () => "?").join(", ");
}

function strings(input: unknown, max: number): string[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.filter((v): v is string => typeof v === "string" && v.length > 0))].slice(0, max);
}

export interface BoardDeck {
  /** The AI's 13 core values in rubric order; empty while withheld or unscored. */
  core: { key: string; value: number }[];
  /** Sum of the AI's values on each owner role's additional parameters (out of 30), or null. */
  additional: Partial<Record<Role, number | null>>;
  /** True when blind scoring hides the AI's numbers from this viewer. */
  withheld: boolean;
  assignees: { id: string; name: string; role: string; dueAt: string | null; submitted: boolean }[];
}

assignments.get(
  "/board",
  requireRole("program_manager", "program_associate", "admin"),
  async (c) => {
    const { id: viewerId, edition, role } = c.var.user;
    const db = c.env.DB;
    const decks = (
      await db
        .prepare(`SELECT id FROM decks WHERE edition = ? AND status IN (${placeholders(ASSIGNABLE_STAGES.length)})`)
        .bind(edition, ...ASSIGNABLE_STAGES)
        .all<{ id: string }>()
    ).results.map((r) => r.id);
    if (decks.length === 0) return c.json({ decks: {} });

    const scores = (
      await db
        .prepare(
          "SELECT s.deck_id, p.key, p.informational, p.role_scope, s.value FROM scores s " +
            "JOIN parameters p ON p.id = s.parameter_id JOIN decks d ON d.id = s.deck_id " +
            `WHERE s.evaluator_kind = 'ai' AND p.active = 1 AND d.edition = ? AND d.status IN (${placeholders(ASSIGNABLE_STAGES.length)}) ` +
            "ORDER BY p.sort_order",
        )
        .bind(edition, ...ASSIGNABLE_STAGES)
        .all<{ deck_id: string; key: string; informational: number; role_scope: string | null; value: number }>()
    ).results;

    const assignees = (
      await db
        .prepare(
          "SELECT ap.deck_id, u.id, u.name, u.role, da.due_at, " +
            "EXISTS (SELECT 1 FROM evaluations e WHERE e.deck_id = ap.deck_id AND e.evaluator_id = u.id) AS submitted " +
            `FROM (${ASSIGNEE_PAIRS_SQL}) ap JOIN users u ON u.id = ap.evaluator_id ` +
            "JOIN decks d ON d.id = ap.deck_id " +
            "LEFT JOIN deck_assignments da ON da.deck_id = ap.deck_id AND da.evaluator_id = ap.evaluator_id " +
            `WHERE d.edition = ? AND d.status IN (${placeholders(ASSIGNABLE_STAGES.length)}) ORDER BY u.name`,
        )
        .bind(edition, ...ASSIGNABLE_STAGES)
        .all<{ deck_id: string; id: string; name: string; role: string; due_at: string | null; submitted: number }>()
    ).results;

    // Blind scoring holds here exactly as it does on GET /api/decks: an evaluator
    // who has not submitted for a deck does not see the AI's numbers for it.
    const scoring = await loadScoringSettings(db, edition);
    const isEvaluator = isAssignableEvaluator(edition, role);
    const submittedByViewer = new Set(
      (
        await db
          .prepare("SELECT deck_id FROM evaluations WHERE evaluator_id = ?")
          .bind(viewerId)
          .all<{ deck_id: string }>()
      ).results.map((r) => r.deck_id),
    );

    const owners = ADDITIONAL_PARAM_OWNERS[edition as Edition];
    const board: Record<string, BoardDeck> = {};
    for (const id of decks) {
      const withheld = withholdsAiScore(scoring, { isEvaluator, hasSubmitted: submittedByViewer.has(id) });
      const mine = withheld ? [] : scores.filter((s) => s.deck_id === id);
      const additional: Partial<Record<Role, number | null>> = {};
      for (const owner of owners) {
        const vals = mine.filter((s) => s.informational === 1 && s.role_scope === owner).map((s) => s.value);
        additional[owner] = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) * 10) / 10 : null;
      }
      board[id] = {
        core: mine.filter((s) => s.informational === 0).map((s) => ({ key: s.key, value: s.value })),
        additional,
        withheld,
        assignees: assignees
          .filter((a) => a.deck_id === id)
          .map((a) => ({ id: a.id, name: a.name, role: a.role, dueAt: a.due_at, submitted: a.submitted === 1 })),
      };
    }
    return c.json({ decks: board });
  },
);

interface AssignBody {
  deckIds: unknown;
  assigneeIds: unknown;
  note: unknown;
  notify: unknown;
}

assignments.post(
  "/",
  // Same gate as `POST /decks/:id/assign`, in lock-step with assign_jury's roles.
  requireTask("assign", "program_manager", "program_associate", "admin"),
  async (c) => {
    const user = c.var.user;
    const edition = user.edition as Edition;
    const db = c.env.DB;
    const body = ((await c.req.json().catch(() => ({}))) ?? {}) as Partial<AssignBody>;

    const deckIds = strings(body.deckIds, MAX_DECKS);
    const assigneeIds = strings(body.assigneeIds, MAX_MEMBERS);
    const note = typeof body.note === "string" ? body.note.trim().slice(0, MAX_NOTE) : "";
    const notify = body.notify !== false;
    if (deckIds.length === 0) return c.json({ error: "no_decks", message: "Select at least one deck." }, 400);
    if (assigneeIds.length === 0) {
      return c.json({ error: "no_assignees", message: "Pick one or more jury members." }, 400);
    }

    // ── Validate EVERYTHING before writing anything (F0211) ────────────────────
    const decks = (
      await db
        .prepare(`SELECT id, name, status, assigned_to FROM decks WHERE edition = ? AND id IN (${placeholders(deckIds.length)})`)
        .bind(edition, ...deckIds)
        .all<{ id: string; name: string; status: string; assigned_to: string | null }>()
    ).results;
    const missing = deckIds.filter((id) => !decks.some((d) => d.id === id));
    if (missing.length) return c.json({ error: "not_found", deckIds: missing }, 404);

    const members = (
      await db
        .prepare(
          `SELECT id, name, initials, role, email FROM users WHERE edition = ? AND active = 1 AND id IN (${placeholders(assigneeIds.length)})`,
        )
        .bind(edition, ...assigneeIds)
        .all<{ id: string; name: string; initials: string; role: string; email: string | null }>()
    ).results;
    const invalid = assigneeIds.filter((id) => {
      const m = members.find((u) => u.id === id);
      return !m || !isAssignableEvaluator(edition, m.role);
    });
    if (invalid.length) return c.json({ error: "invalid_assignee", assigneeIds: invalid }, 400);
    // Keep the assigner's selection order: the first member becomes the first assignee.
    const ordered = assigneeIds.map((id) => members.find((m) => m.id === id)!);

    const refused: { id: string; name: string; status: string }[] = [];
    let forbidden = false;
    for (const d of decks) {
      if (d.status === "assigned") {
        // Adding evaluators to a deck already out for evaluation — the prototype
        // keeps assigned decks selectable (`renderAsDecks`, TaxPilot). Whoever may
        // assign from the AI gate may add to the panel.
        const t = transitionByAction(edition, "ai_evaluated", "assign_jury");
        if (!t || !t.roles.includes(user.role)) forbidden = true;
        continue;
      }
      const r = performAction(edition, d.status, "assign_jury", user.role);
      if (r.ok) continue;
      if (r.error === "forbidden") forbidden = true;
      else refused.push({ id: d.id, name: d.name, status: d.status });
    }
    if (forbidden) return c.json({ error: "forbidden" }, 403);
    if (refused.length) {
      return c.json(
        {
          error: "not_assignable",
          decks: refused,
          message: `${refused.map((d) => d.name).join(", ")} cannot be assigned from ${refused.length === 1 ? "its" : "their"} current stage.`,
        },
        409,
      );
    }

    // ── One batch: every deck × every member ─────────────────────────────────
    const ts = new Date().toISOString();
    const dueAt = dueAtFrom(ts);
    const names = ordered.map((m) => m.name).join(", ");
    const stmts: D1PreparedStatement[] = [];
    // Keep the caller's deck order in the response, matching the summary card.
    const orderedDecks = deckIds.map((id) => decks.find((d) => d.id === id)!);
    for (const d of orderedDecks) {
      const fresh = d.status !== "assigned";
      if (fresh) {
        stmts.push(
          db
            .prepare("UPDATE decks SET status = 'assigned', assigned_to = ?, updated_at = ? WHERE id = ?")
            .bind(ordered[0].id, ts, d.id),
          clearAssignments(db, d.id),
        );
      } else {
        stmts.push(db.prepare("UPDATE decks SET updated_at = ? WHERE id = ?").bind(ts, d.id));
      }
      stmts.push(
        db
          .prepare(
            "INSERT INTO pipeline_events (id, deck_id, actor_id, from_stage, to_stage, action, note, created_at) VALUES (?, ?, ?, ?, 'assigned', 'assign_jury', ?, ?)",
          )
          .bind(
            `${d.id}_evt_${crypto.randomUUID()}`,
            d.id,
            user.id,
            d.status,
            fresh ? `Assigned to ${names}` : `Evaluators added: ${names}`,
            ts,
          ),
      );
      for (const m of ordered) {
        stmts.push(upsertAssignment(db, { deckId: d.id, evaluatorId: m.id, assignedBy: user.id, assignedAt: ts, dueAt, note }));
      }
    }
    await db.batch(stmts);

    // ── "Notify N jury members by email" (F0256) ─────────────────────────────
    // After the batch commits, one message per member. `sendEmail` records rather
    // than sends while the domain is not onboarded, and never throws on delivery.
    const notifiedIds: string[] = [];
    if (notify) {
      const batchKey = crypto.randomUUID();
      const dueLabel = new Date(dueAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
      for (const m of ordered) {
        if (!m.email) continue;
        const { subject, body: text } = buildAssignmentEmail({
          evaluatorName: m.name,
          assignedByName: user.name,
          deckNames: orderedDecks.map((d) => d.name),
          dueLabel,
          note,
        });
        try {
          await sendEmail(c.env, {
            kind: "evaluator_assignment",
            toEmail: m.email,
            toName: m.name,
            subject,
            body: text,
            deckId: orderedDecks.length === 1 ? orderedDecks[0].id : null,
            dedupeKey: `evaluator_assignment:${batchKey}:${m.id}`,
          });
          notifiedIds.push(m.id);
        } catch (err) {
          console.error("assignment email failed", err);
        }
      }
      if (notifiedIds.length > 0) {
        await db
          .prepare(
            `UPDATE deck_assignments SET notified = 1 WHERE assigned_at = ? AND deck_id IN (${placeholders(deckIds.length)}) ` +
              `AND evaluator_id IN (${placeholders(notifiedIds.length)})`,
          )
          .bind(ts, ...deckIds, ...notifiedIds)
          .run();
      }
    }

    return c.json({
      ok: true,
      assignedAt: ts,
      dueAt,
      evaluations: orderedDecks.length * ordered.length,
      notified: notifiedIds.length,
      rows: orderedDecks.flatMap((d) =>
        ordered.map((m) => ({
          deckId: d.id,
          deckName: d.name,
          evaluatorId: m.id,
          evaluatorName: m.name,
          initials: m.initials,
          role: m.role,
          roleLabel: roleLabel(edition, m.role as Role),
        })),
      ),
    });
  },
);
