// W7-E — who is assigned to evaluate a deck.
//
// The prototype's Assign screen gives every selected deck to every selected
// member (`asConfirm`), so a deck can carry several evaluators. `deck_assignments`
// (migration 0058) is one row per (deck, evaluator); `decks.assigned_to` stays the
// FIRST assignee so the readers that predate this keep their meaning.
//
// Every "is this person assigned?" question reads the UNION of the two, never the
// join table alone: seeds and tests that set `decks.assigned_to` directly — and
// any row written before 0058's backfill — must keep counting.

import { dueAtFrom } from "../../shared/assignment";
import { delegatedAssigneePairsSql } from "../../shared/outOfOffice";

/**
 * The two pairs that exist because somebody was ASSIGNED: the join table, and the
 * legacy `decks.assigned_to` the note above explains.
 */
const BASE_ASSIGNEE_PAIRS_SQL =
  "SELECT deck_id, evaluator_id FROM deck_assignments " +
  "UNION SELECT id AS deck_id, assigned_to AS evaluator_id FROM decks WHERE assigned_to IS NOT NULL";

/**
 * The (deck_id, evaluator_id) pairs that may score a deck — assignment OR active
 * out-of-office cover.
 *
 * Delegation belongs HERE and nowhere else. Seven call sites embed these pairs
 * (`routes/decks.ts:570`, `routes/pipeline.ts:529` and `:1430`,
 * `routes/assignments.ts:111`, `routes/analytics.ts:175` and `:637`,
 * `scheduled.ts:118`), and they are the gates that decide both whether a deck
 * appears in an evaluator's list at all and whether they may score it. Adding a
 * second predicate at each one would be seven answers to "is this person allowed
 * to score this deck?", which is how this repo got four low-credit thresholds.
 *
 * `delegatedAssigneePairsSql` takes the BASE pairs rather than reading this
 * constant, so cover is exactly one hop: delegating to someone who is themselves
 * out does not chain, which is what "cover" means and what keeps the SQL finite.
 */
export const ASSIGNEE_PAIRS_SQL =
  `${BASE_ASSIGNEE_PAIRS_SQL} UNION ${delegatedAssigneePairsSql(BASE_ASSIGNEE_PAIRS_SQL)}`;

/** May `userId` score `deckId` as one of its assigned evaluators? */
export async function isAssignedEvaluator(db: D1Database, deckId: string, userId: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 AS n FROM (${ASSIGNEE_PAIRS_SQL}) WHERE deck_id = ? AND evaluator_id = ?`)
    .bind(deckId, userId)
    .first<{ n: number }>();
  return Boolean(row);
}

/** Every evaluator assigned to a deck. */
export async function assigneeIdsOf(db: D1Database, deckId: string): Promise<string[]> {
  return (
    await db
      .prepare(`SELECT DISTINCT evaluator_id FROM (${ASSIGNEE_PAIRS_SQL}) WHERE deck_id = ?`)
      .bind(deckId)
      .all<{ evaluator_id: string }>()
  ).results.map((r) => r.evaluator_id);
}

export interface AssignmentWrite {
  deckId: string;
  evaluatorId: string;
  assignedBy: string;
  assignedAt: string;
  dueAt?: string;
  note?: string | null;
}

/**
 * Upsert one assignment. Assigning the same evaluator again restarts the clock —
 * a re-assignment is a fresh request with a fresh deadline — and keeps an earlier
 * instruction unless a new one was written.
 */
export function upsertAssignment(db: D1Database, a: AssignmentWrite): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO deck_assignments (deck_id, evaluator_id, assigned_by, assigned_at, due_at, note) VALUES (?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT (deck_id, evaluator_id) DO UPDATE SET assigned_by = excluded.assigned_by, " +
        "assigned_at = excluded.assigned_at, due_at = excluded.due_at, " +
        "note = COALESCE(excluded.note, deck_assignments.note)",
    )
    .bind(
      a.deckId,
      a.evaluatorId,
      a.assignedBy,
      a.assignedAt,
      a.dueAt ?? dueAtFrom(a.assignedAt),
      a.note?.trim() ? a.note.trim() : null,
    );
}

/**
 * A deck entering Assigned from the AI gate starts a new panel. Rows left from an
 * earlier pass (a startup restored to the AI gate) must not keep their holders
 * able to score, nor keep "all evaluations complete" waiting on them.
 */
export function clearAssignments(db: D1Database, deckId: string): D1PreparedStatement {
  return db.prepare("DELETE FROM deck_assignments WHERE deck_id = ?").bind(deckId);
}
