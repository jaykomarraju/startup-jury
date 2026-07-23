// Phase 7 — Cron reminder job. Selects evaluators who have decks assigned to them
// still awaiting a score (incubator `assigned` stage) and sends each a single
// stubbed reminder via the email outbox. Wired to a Cron Trigger in wrangler.jsonc
// (see `scheduled` in src/server/index.ts). Real delivery swaps `sendEmail` for a
// Cloudflare Email binding — the selection logic stays the same.

import type { Env } from "./types";
import { sendEmail, buildReminderEmail } from "./email/outbox";

/** One assigned-but-unscored deck row (assignee + deck). */
export interface PendingAssignment {
  evaluatorId: string;
  evaluatorName: string;
  evaluatorEmail: string;
  deckId: string;
  deckName: string;
}

export interface EvaluatorReminder {
  evaluatorId: string;
  evaluatorName: string;
  evaluatorEmail: string;
  deckNames: string[];
}

/**
 * Group pending assignments into one reminder per evaluator. Pure — the cron
 * handler queries the rows and hands them here, so the fan-out is unit-testable.
 */
export function selectReminders(rows: PendingAssignment[]): EvaluatorReminder[] {
  const byEval = new Map<string, EvaluatorReminder>();
  for (const r of rows) {
    const cur = byEval.get(r.evaluatorId);
    if (cur) cur.deckNames.push(r.deckName);
    else
      byEval.set(r.evaluatorId, {
        evaluatorId: r.evaluatorId,
        evaluatorName: r.evaluatorName,
        evaluatorEmail: r.evaluatorEmail,
        deckNames: [r.deckName],
      });
  }
  return [...byEval.values()];
}

/**
 * Run the reminder sweep: find decks parked at `assigned` with an assignee, group
 * per evaluator, and send one reminder each. Returns the reminders sent (for
 * tests / observability).
 */
export async function runReminders(env: Env): Promise<EvaluatorReminder[]> {
  const rows = (
    await env.DB.prepare(
      "SELECT d.id AS deck_id, d.name AS deck_name, u.id AS eid, u.name AS ename, u.email AS eemail " +
        "FROM decks d JOIN users u ON u.id = d.assigned_to " +
        "WHERE d.status = 'assigned' AND d.assigned_to IS NOT NULL AND u.active = 1",
    ).all<{ deck_id: string; deck_name: string; eid: string; ename: string; eemail: string }>()
  ).results;

  const pending: PendingAssignment[] = rows.map((r) => ({
    evaluatorId: r.eid,
    evaluatorName: r.ename,
    evaluatorEmail: r.eemail,
    deckId: r.deck_id,
    deckName: r.deck_name,
  }));

  const reminders = selectReminders(pending);
  for (const rem of reminders) {
    const { subject, body } = buildReminderEmail({ evaluatorName: rem.evaluatorName, deckNames: rem.deckNames });
    await sendEmail(env, {
      kind: "evaluator_reminder",
      toEmail: rem.evaluatorEmail,
      toName: rem.evaluatorName,
      subject,
      body,
    });
  }
  return reminders;
}
