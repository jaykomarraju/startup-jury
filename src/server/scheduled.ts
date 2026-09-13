// Phase 7 — Cron reminder job. Selects evaluators who have decks assigned to them
// still awaiting a score (incubator `assigned` stage) and sends each a single
// stubbed reminder via the email outbox. Wired to a Cron Trigger in wrangler.jsonc
// (see `scheduled` in src/server/index.ts). Real delivery swaps `sendEmail` for a
// Cloudflare Email binding — the selection logic stays the same.

import type { Env } from "./types";
import type { Edition } from "../shared/roles";
import { sendEmail, buildReminderEmail, emitNotification } from "./email/outbox";
import { sweepStuckEvaluations, type SweepResult } from "./ai/health";
import { ASSIGNEE_PAIRS_SQL } from "./decks/assignments";

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
 *
 * W7-E — "an assignee" is every evaluator on the deck (`deck_assignments`), not
 * only the first, so the second and third juror are reminded too.
 */
export async function runReminders(env: Env): Promise<EvaluatorReminder[]> {
  const rows = (
    await env.DB.prepare(
      "SELECT d.id AS deck_id, d.name AS deck_name, u.id AS eid, u.name AS ename, u.email AS eemail " +
        `FROM decks d JOIN (${ASSIGNEE_PAIRS_SQL}) ap ON ap.deck_id = d.id JOIN users u ON u.id = ap.evaluator_id ` +
        "WHERE d.status = 'assigned' AND u.active = 1",
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

/**
 * Session 7 — the `pending_ai` re-drive sweep (FINISH-PLAN §9), on its own,
 * more frequent cron. Thin wrapper so `index.ts` stays declarative and the
 * sweep's own logic lives with the rest of the AI-health code.
 */
export async function runStuckSweep(env: Env): Promise<SweepResult> {
  const result = await sweepStuckEvaluations(env);
  if (result.requeued.length || result.failed.length) {
    console.log(
      `pending_ai sweep: re-queued ${result.requeued.length}, failed ${result.failed.length}, ` +
        `refunded ${result.refunded} credit(s)`,
    );
  }
  return result;
}

/**
 * W3-B producer — "Monthly usage summary report", the tenth of the prototype's
 * ten events and the only one with no moment in the application to hang on.
 *
 * It rides the EXISTING daily cron rather than adding a third schedule, and is
 * made monthly by its dedupe key alone: `emitNotification` keys each recipient's
 * message on the reporting month, and `email_outbox.dedupe_key` carries a UNIQUE
 * index, so the first daily run of a month sends the digest and the other thirty
 * are no-ops. That is one mechanism doing two jobs — idempotence and schedule —
 * and it is the same one that makes a queue retry safe everywhere else.
 *
 * The report covers the month that just ENDED, which is what makes it a report
 * rather than a partial count.
 */
export interface UsageSummary {
  edition: Edition;
  /** The month reported on, `YYYY-MM`. */
  month: string;
  decksSubmitted: number;
  decksAiScored: number;
  evaluationsSubmitted: number;
  creditsRemaining: number;
}

/** The calendar month before `now`, as `YYYY-MM`. */
export function previousMonth(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Count the month's activity for one edition. Pure SQL, no side effects. */
export async function usageSummary(
  env: Env,
  edition: Edition,
  month: string,
): Promise<UsageSummary> {
  const decks = await env.DB.prepare(
    "SELECT COUNT(*) AS submitted, SUM(CASE WHEN ai_score IS NOT NULL THEN 1 ELSE 0 END) AS scored " +
      "FROM decks WHERE edition = ? AND substr(created_at, 1, 7) = ?",
  )
    .bind(edition, month)
    .first<{ submitted: number; scored: number | null }>();

  const evals = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM evaluations e JOIN decks d ON d.id = e.deck_id " +
      "WHERE d.edition = ? AND substr(e.submitted_at, 1, 7) = ? AND e.evaluator_id IS NOT NULL",
  )
    .bind(edition, month)
    .first<{ n: number }>();

  const org = await env.DB.prepare("SELECT credits_balance FROM org_settings WHERE edition = ?")
    .bind(edition)
    .first<{ credits_balance: number }>();

  return {
    edition,
    month,
    decksSubmitted: decks?.submitted ?? 0,
    decksAiScored: decks?.scored ?? 0,
    evaluationsSubmitted: evals?.n ?? 0,
    creditsRemaining: org?.credits_balance ?? 0,
  };
}

/** The digest's body. Pure, so the copy is unit-testable without a database. */
export function buildUsageSummaryBody(s: UsageSummary): string {
  return (
    `Usage for ${s.month}:\n\n` +
    `  • Pitchdecks submitted: ${s.decksSubmitted}\n` +
    `  • Decks AI pre-scored: ${s.decksAiScored}\n` +
    `  • Evaluations submitted: ${s.evaluationsSubmitted}\n` +
    `  • Evaluation credits remaining: ${s.creditsRemaining}\n\n` +
    "Open the Admin console for the full breakdown."
  );
}

/**
 * Send each edition's digest for the month just ended. Safe to call every day —
 * see the header. Returns the summaries it produced (for tests / observability).
 */
export async function runMonthlyUsageSummary(
  env: Env,
  now: Date = new Date(),
): Promise<UsageSummary[]> {
  const month = previousMonth(now);
  const out: UsageSummary[] = [];
  for (const edition of ["incubator", "vc"] as const) {
    const summary = await usageSummary(env, edition, month);
    out.push(summary);
    await emitNotification(env, {
      event: "monthly_usage_summary",
      edition,
      title: `Monthly usage summary — ${month}`,
      body: buildUsageSummaryBody(summary),
      link: "/app/admin",
      dedupeKey: `monthly_usage_summary:${edition}:${month}`,
    });
  }
  return out;
}
