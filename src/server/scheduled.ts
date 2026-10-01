// Phase 7 — Cron reminder job. Selects evaluators who have decks assigned to them
// still awaiting a score (incubator `assigned` stage) and sends each a single
// stubbed reminder via the email outbox. Wired to a Cron Trigger in wrangler.jsonc
// (see `scheduled` in src/server/index.ts). Real delivery swaps `sendEmail` for a
// Cloudflare Email binding — the selection logic stays the same.

import type { Env } from "./types";
import type { Edition } from "../shared/roles";
import { scoped, type TenantScope } from "../shared/tenant";
import { sendEmail, buildReminderEmail, emitNotification } from "./email/outbox";
import { sweepStuckEvaluations, type SweepResult } from "./ai/health";
import { ASSIGNEE_PAIRS_SQL } from "./decks/assignments";
// The client's open item — the five-working-day rule already lives here, and
// this sweep reuses it rather than restating "5 days" in SQL.
import { queryDueAt, QUERY_RESPONSE_WORKING_DAYS } from "../shared/queries";

/**
 * EVERY WORKSPACE THE CRON HAS TO RUN FOR.
 *
 * The note above `runNoResponseSweep` is addressed to this session and it is
 * right: this file runs from a Cron Trigger, so there is NO SESSION and therefore
 * no principal to take a scope from. Every other site in the wave derives its
 * scope from `c.var.user`; here the tenant has to be ENUMERATED, and that is the
 * one structural difference between this file and the other five.
 *
 * `trial` counts as live — a customer on a trial still gets their reminders and
 * their digest. `suspended` does not: `routes/auth.ts` already refuses a
 * suspended organisation's sign-in, and continuing to mail a workspace nobody can
 * open would be worse than silence.
 *
 * The cross product with the two editions is what replaces the old top-level
 * `for (const edition of [...])`. It is deliberately built in ONE place, because
 * the note's own warning is that a tenant loop around every edition loop is safer
 * at one site than at two.
 */
async function liveWorkspaces(env: Env): Promise<TenantScope[]> {
  const { results } = await env.DB.prepare(
    "SELECT id FROM organizations WHERE status IN ('active', 'trial') ORDER BY id",
  ).all<{ id: string }>();
  const out: TenantScope[] = [];
  for (const row of results) {
    for (const edition of ["incubator", "vc"] as const) {
      out.push({ tenantId: row.id, edition });
    }
  }
  return out;
}

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
  const out: EvaluatorReminder[] = [];
  // One pass per workspace. The signature is unchanged because `src/server/index.ts`
  // calls it and is not this session's file; the tenant dimension is internal.
  for (const scope of await liveWorkspaces(env)) {
    out.push(...(await remindersFor(env, scope)));
  }
  return out;
}

/** The reminder sweep for ONE workspace. */
async function remindersFor(env: Env, scope: TenantScope): Promise<EvaluatorReminder[]> {
  // This statement carried NO scope of any kind — not even `edition` — so it swept
  // every deck on the platform and emailed every assignee it found. Under one
  // customer that is merely wrong across editions; under two it mails one
  // customer's jurors about another customer's startups by name.
  //
  // `u.tenant_id = d.tenant_id` rather than a second bind: the evaluator must belong
  // to the SAME workspace as the deck they are being reminded about. An
  // `u.tenant_id = ?` would also be true of a deck in the other edition of the same
  // customer, which is not what an assignment means.
  const q = scoped(scope).on("d").andRaw("d.status = 'assigned'").andRaw("u.active = 1");
  const rows = (
    await env.DB.prepare(
      "SELECT d.id AS deck_id, d.name AS deck_name, u.id AS eid, u.name AS ename, u.email AS eemail " +
        `FROM decks d JOIN (${ASSIGNEE_PAIRS_SQL}) ap ON ap.deck_id = d.id ` +
        "JOIN users u ON u.id = ap.evaluator_id AND u.tenant_id = d.tenant_id " +
        q.whereClause(),
    )
      .bind(...q.binds)
      .all<{ deck_id: string; deck_name: string; eid: string; ename: string; eemail: string }>()
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
      scope,
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

// ── The client's open item · "queried, and the founder never responded" ──────
//
// His §7: decks that were Queried and whose founder never answers get archived
// with the reason "no response". A twelfth status, a time-based rule, and no
// interval stated — so it takes the interval the product already uses for
// "overdue", `QUERY_RESPONSE_WORKING_DAYS` (five working days, F0341), which is
// the same rule `queryStatusOf` applies on the Query screen. One number, one
// definition of late.
//
// ── This is the ONE exemption from his row 7 latch ──────────────────────────
// Row 7 says no button is active once Send to Query has fired, and
// `Incomplete, Queried` is reached BY Send to Query. His open item then requires
// archiving exactly those decks. The two cannot both hold literally. The latch
// binds the OPERATOR UI — S2-DASH re-arms exactly one action, "Archive (no
// response)", on a deck past the window — and this sweep, which is not an
// operator, is exempt outright. Stated here and again where the latch is
// described (`screeningStatus` / `isQueryUnanswered`, `shared/deckStats.ts`).
//
// ── T1-PEOPLE, tenancy wave: THE NOTE THE SCREENING WAVE LEFT HERE, ANSWERED ─
// It said this file runs from a Cron Trigger, so there is NO SESSION and therefore
// no tenant, and that this is "the single genuine leak site in the whole body of
// work" — every other site derives its scope from a `decks` subquery and inherits
// it for free. It asked for the tenant loop to nest at exactly ONE site.
//
// It does, and the site is `liveWorkspaces` at the top of this file: the enumerated
// cross product of live organisations and the two editions, which REPLACED the old
// top-level `for (const edition of ["incubator","vc"])` rather than nesting inside
// it. There is still exactly one loop and `runMonthlyUsageSummary` still holds it.
// This function keeps taking one workspace and running no loop of its own, which is
// what the note asked for, and what makes the isolation assertion the note
// describes possible: it returns what it archived, so a sweep run for tenant A can
// be shown to have moved nothing belonging to tenant B. A per-table invariant would
// NOT catch a regression here — `decks` is already on that list and would stay
// green while this statement selected across tenants.

/** One deck the sweep archived, for tests and observability. */
export interface NoResponseArchive {
  deckId: string;
  deckName: string;
  /** The unanswered query's timestamp — the thing that made it late. */
  queriedAt: string;
}

/** Stages a deck may be archived FROM by the sweep. */
const SWEEPABLE_STAGES = ["incomplete", "manual_review", "uploaded", "pending_ai", "ai_evaluated"];

/**
 * Archive one edition's queried-but-unanswered decks.
 *
 * Takes a single edition and runs no loop: see the T1-PEOPLE note above. Called
 * from inside the existing daily per-edition pass.
 *
 * **What it will not touch.** A deck that already left the pipeline (`archived`
 * or `rejected`) is not archived again; a deck whose founder DID answer is not
 * late however old the letter is; and a deck that has moved past screening is
 * out of `SWEEPABLE_STAGES`, because a query raised long ago must not archive a
 * startup that is now being evaluated. The rule is about an unanswered
 * clarification, not about age.
 *
 * The archive REASON needs no schema: `exit_note` already reads
 * `pipeline_events.note` (`routes/decks.ts`), so "no response" is the note on
 * an ordinary `archive` event, and the Dashboard's Archived box surfaces it
 * through the sort it already has.
 */
export async function runNoResponseSweep(
  env: Env,
  scope: TenantScope,
  now: Date = new Date(),
): Promise<NoResponseArchive[]> {
  // The latest query per deck, with its answer — the same two facts
  // `routes/decks.ts` derives onto the deck view, asked here of the table
  // directly because the sweep holds no deck views.
  // `queries` is scoped BY PROXY through `decks` (`TENANT_OWNER`), and here the
  // proxy is already structural: the correlated subquery is keyed on `d.id`, so
  // scoping the deck scopes the query. That is the shape §5b calls safe *because*
  // the check happened one frame up — which is also why it breaks together, and why
  // the predicate below is on `d` and not somewhere more convenient.
  const w = scoped(scope).on("d");
  const rows = (
    await env.DB.prepare(
      "SELECT d.id AS deck_id, d.name AS deck_name, d.status AS stage, " +
        "  q.created_at AS queried_at, q.questions AS questions, q.founder_response AS response " +
        "FROM decks d JOIN queries q ON q.id = (" +
        "  SELECT qq.id FROM queries qq WHERE qq.deck_id = d.id " +
        "  ORDER BY qq.created_at DESC, qq.rowid DESC LIMIT 1" +
        `) ${w.whereClause()}`,
    )
      .bind(...w.binds)
      .all<{
        deck_id: string;
        deck_name: string;
        stage: string | null;
        queried_at: string;
        questions: string;
        response: string | null;
      }>()
  ).results;

  const due = rows.filter(
    (r) =>
      !r.response &&
      // A QUESTION MUST ACTUALLY HAVE BEEN ASKED. "Send to Query" records the
      // send as a PENDING query with no questions yet
      // (`POST /api/decks/:id/send-to-query`, the prototype's own
      // `upSendToQuery` behaviour), and the operator composes afterwards. A deck
      // sitting on the list because staff never followed through has had no
      // chance to respond, and archiving it as "no response" would blame the
      // founder for our own inaction. Empty is not unanswered.
      r.questions.trim() !== "" &&
      SWEEPABLE_STAGES.includes(r.stage ?? "") &&
      now.getTime() > queryDueAt(r.queried_at).getTime(),
  );
  if (due.length === 0) return [];

  const ts = now.toISOString();
  const stmts: D1PreparedStatement[] = [];
  for (const r of due) {
    // The ids came from the scoped SELECT above, and the UPDATE says so anyway —
    // this is the statement that ARCHIVES a startup, and "the id can only have come
    // from the scoped read" is not a property the batch itself carries.
    const u = scoped(scope).on("decks").and("decks.id = ?", r.deck_id);
    stmts.push(
      env.DB
        .prepare(`UPDATE decks SET status = 'archived', updated_at = ? ${u.whereClause()}`)
        .bind(ts, ...u.binds),
    );
    // A real transition, unlike the `send_to_assign` marker: the deck DID move,
    // so `from_stage !== to_stage` and the `exit_*` columns are meant to see it.
    // The note is what makes the row say why.
    stmts.push(
      env.DB.prepare(
        "INSERT INTO pipeline_events (id, deck_id, actor_id, from_stage, to_stage, action, note, created_at) " +
          "VALUES (?, ?, NULL, ?, 'archived', 'archive', 'no response', ?)",
      ).bind(`${r.deck_id}_evt_${crypto.randomUUID()}`, r.deck_id, r.stage, ts),
    );
  }
  await env.DB.batch(stmts);

  if (due.length > 0) {
    console.log(
      `no-response sweep (${scope.tenantId}/${scope.edition}): archived ${due.length} ` +
        `deck(s) unanswered after ` +
        `${QUERY_RESPONSE_WORKING_DAYS} working days`,
    );
  }
  return due.map((r) => ({ deckId: r.deck_id, deckName: r.deck_name, queriedAt: r.queried_at }));
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
  /** The customer this digest counts. `organizations.id`. */
  tenantId: string;
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

/**
 * Count the month's activity for one WORKSPACE. Pure SQL, no side effects.
 *
 * ── EVERY NUMBER IN HERE IS §11's DANGEROUS SHAPE ───────────────────────────
 * "Aggregates are the dangerous shape, not the lists. A list that leaks shows
 * another customer's startup names and somebody notices. A `COUNT(*)` or an
 * `AVG(score)` that leaks returns a perfectly ordinary-looking number." This
 * function is four such numbers, and they are then EMAILED to administrators as a
 * report — so an unscoped count is not merely visible, it is asserted to the
 * customer in writing and filed in `email_outbox` as the evidence that it was.
 *
 * `evaluations` is the proxy case: §5b counted it 24 `FROM` sites and only 7 with
 * a `JOIN`, and this is one of the 7. The scope goes on `decks`, which is the
 * owner `TENANT_OWNER` names — adding `tenant_id` to `decks` does nothing for a
 * query that reads `evaluations` without joining it.
 */
export async function usageSummary(
  env: Env,
  scope: TenantScope,
  month: string,
): Promise<UsageSummary> {
  const dq = scoped(scope).on("d").and("substr(d.created_at, 1, 7) = ?", month);
  const decks = await env.DB.prepare(
    "SELECT COUNT(*) AS submitted, SUM(CASE WHEN d.ai_score IS NOT NULL THEN 1 ELSE 0 END) AS scored " +
      `FROM decks d ${dq.whereClause()}`,
  )
    .bind(...dq.binds)
    .first<{ submitted: number; scored: number | null }>();

  const eq = scoped(scope)
    .on("d")
    .and("substr(e.submitted_at, 1, 7) = ?", month)
    .andRaw("e.evaluator_id IS NOT NULL");
  const evals = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM evaluations e JOIN decks d ON d.id = e.deck_id ${eq.whereClause()}`,
  )
    .bind(...eq.binds)
    .first<{ n: number }>();

  const oq = scoped(scope).on("o");
  const org = await env.DB.prepare(
    `SELECT o.credits_balance FROM org_settings o ${oq.whereClause()}`,
  )
    .bind(...oq.binds)
    .first<{ credits_balance: number }>();

  return {
    edition: scope.edition,
    tenantId: scope.tenantId,
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
 * Send each WORKSPACE's digest for the month just ended. Safe to call every day —
 * see the header. Returns the summaries it produced (for tests / observability).
 */
export async function runMonthlyUsageSummary(
  env: Env,
  now: Date = new Date(),
): Promise<UsageSummary[]> {
  const month = previousMonth(now);
  const out: UsageSummary[] = [];
  // THE ONE LOOP IN THIS FILE, and it stays the one — it is now over WORKSPACES
  // rather than editions (`liveWorkspaces`), which is the tenant dimension nesting
  // at the single site the screening wave's note asked for rather than becoming two
  // nested loops. The no-response sweep still rides here for the same reason it
  // always did.
  //
  // The cadence is right for both jobs even though the function is named for
  // one: `index.ts` calls this DAILY off the "0 8 * * *" cron, and only the
  // digest's own dedupe key makes it monthly. A five-working-day rule wants a
  // daily check. The name is now narrower than the body, and it stays that way
  // in this session only because `src/server/index.ts` — which calls it — is
  // not this session's file; the rename is a one-line ask in the handoff note.
  for (const scope of await liveWorkspaces(env)) {
    const summary = await usageSummary(env, scope, month);
    out.push(summary);
    await runNoResponseSweep(env, scope, now);
    await emitNotification(env, {
      event: "monthly_usage_summary",
      edition: scope.edition,
      scope,
      title: `Monthly usage summary — ${month}`,
      body: buildUsageSummaryBody(summary),
      link: "/app/admin",
      // ── §2 A8, THE DEDUPE KEY ─────────────────────────────────────────────
      // This was `monthly_usage_summary:${edition}:${month}` — the one key in the
      // codebase that is not derived from a globally unique id, which is why §2
      // singles it out and `0099`'s header hands the call-site half to this
      // session. The tenant goes FIRST so the key sorts and reads as a workspace's
      // digest rather than an edition's.
      //
      // MEASURED CORRECTION TO §2 A8, worth stating because it changes what the
      // risk is rather than whether to fix it. A8 says tenant B's digest is
      // "silently swallowed as a duplicate of tenant A's". It would not have been:
      // `emitNotification` appends `:${user.id}` to every per-recipient key
      // (`email/outbox.ts`), and `users.id` is globally unique, so the two
      // customers' keys already differed. What WAS true, and is worse, is that the
      // fan-out choosing those recipients carried no tenant at all (§2 B22) — so
      // each workspace's pass mailed EVERY customer's administrators, and each copy
      // reported numbers summed across all of them. Not a lost digest: a wrong one,
      // sent to the wrong people. Both halves are closed — the audience by the
      // scoped fan-out, the key here — and `test/worker/scheduled.test.ts` asserts
      // the key is distinct per tenant so a future producer cannot reintroduce it.
      dedupeKey: `monthly_usage_summary:${scope.tenantId}:${scope.edition}:${month}`,
    });
  }
  return out;
}
