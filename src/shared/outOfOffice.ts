/**
 * OUT OF OFFICE, WITH DELEGATION — one definition of "who is out, until when,
 * and who holds their evaluation work while they are".
 *
 * ── WHY A FILE IN `src/shared/` HOLDS A SQL FRAGMENT ────────────────────────
 *
 * `shared/tenant.ts`'s header states the boundary, and this file keeps it: no
 * file here issues a query, and this one does not either. It builds a SQL
 * FRAGMENT plus the pure predicates the client needs to render the same fact,
 * exactly as `ScopeBuilder` does.
 *
 * The fragment is here rather than beside `ASSIGNEE_PAIRS_SQL` for one reason,
 * stated plainly: `src/server/decks/assignments.ts` is not this lane's file.
 * `delegatedAssigneePairsSql()` is written to be the UNION arm that file adds in
 * three lines (the function's own comment is the patch), so "is this person
 * allowed to score this deck?" keeps ONE answer rather than a second one bolted
 * onto each of the six call sites that embed those pairs — `routes/decks.ts:570`,
 * `routes/pipeline.ts:529` and `:1430`, `routes/assignments.ts:111`,
 * `routes/analytics.ts:175` and `:637`, and `scheduled.ts:118`.
 *
 * ── WHAT A WINDOW IS, AND WHAT IT DELIBERATELY IS NOT ───────────────────────
 *
 * Two dates and one delegate. No recurrence, no half-days, no approval chain and
 * no calendar — the lane brief forbids all four, and every one of them would add
 * a second place that answers "is this person out today?".
 *
 * Dates are `YYYY-MM-DD` and the window is INCLUSIVE of both ends, because that
 * is what a person means by "out from Monday to Friday". ISO dates compare
 * lexicographically, so `date('now') BETWEEN from AND to` is the whole test in
 * SQL and `isOutOn()` is the whole test in TypeScript — the same comparison, not
 * two implementations of it.
 *
 * Both are UTC. A per-user timezone is the kind of second source of truth this
 * repo has been bitten by (four low-credit thresholds; an AI gate threshold that
 * was configured, saved and then ignored), and the cost of getting it wrong is
 * that a delegate's cover starts or ends a few hours early.
 */

/** `YYYY-MM-DD`. The only shape a window endpoint is stored or accepted in. */
export const OOO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The longest window that can be set in one go.
 *
 * A bound exists to catch the typo, not to express a policy: `2206-10-12` for
 * `2026-10-12` passes every other check and would hand a delegate somebody's
 * evaluations for a hundred and eighty years. 180 days is more than two
 * incubator cohort cycles, so it refuses nothing a real absence needs.
 */
export const MAX_OOO_DAYS = 180;

/** A stored (or submitted) absence. `delegateId` is null for "out, nobody covering". */
export interface OutOfOfficeWindow {
  readonly from: string;
  readonly to: string;
  readonly delegateId: string | null;
}

/**
 * Why a submitted window was refused. These are the `error` codes the route
 * returns and the client turns into a sentence, so the two cannot drift.
 */
export type OutOfOfficeRefusal = "invalid_date" | "window_backwards" | "window_too_long";

const MS_PER_DAY = 86_400_000;

/** Today in the same shape and the same clock SQLite's `date('now')` uses. */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * The epoch-millisecond value of an ISO date, or null when the string is not a
 * real one. `new Date("2026-02-30T00:00:00Z")` does not throw and does not
 * produce February 30th, so the round-trip is the check — a regex alone accepts
 * every impossible date in the calendar.
 */
function parseIsoDate(value: string): number | null {
  if (!OOO_DATE_RE.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10) === value ? ms : null;
}

/** Inclusive span in days: a one-day absence is 1, not 0. */
export function windowDays(from: string, to: string): number | null {
  const a = parseIsoDate(from);
  const b = parseIsoDate(to);
  if (a === null || b === null) return null;
  return Math.round((b - a) / MS_PER_DAY) + 1;
}

/** The refusal, or null when the pair is a window the product will store. */
export function validateWindow(from: unknown, to: unknown): OutOfOfficeRefusal | null {
  if (typeof from !== "string" || typeof to !== "string") return "invalid_date";
  const days = windowDays(from, to);
  if (days === null) return "invalid_date";
  if (days < 1) return "window_backwards";
  if (days > MAX_OOO_DAYS) return "window_too_long";
  return null;
}

/**
 * Is this absence live on `dayIso`? The TypeScript half of the SQL comparison
 * below, so the badge the console draws and the rows the delegate receives agree
 * on the same day.
 */
export function isOutOn(window: Pick<OutOfOfficeWindow, "from" | "to"> | null, dayIso: string): boolean {
  if (!window) return false;
  return window.from <= dayIso && dayIso <= window.to;
}

/**
 * The predicate "the row aliased `alias` is a person who is out TODAY and has
 * named somebody to cover". Bind-free on purpose: it is interpolated into
 * statements that already carry binds in a fixed order, and an extra `?` here
 * would silently shift every one of them (`shared/tenant.ts`'s "bind order, the
 * one rule").
 */
export function currentlyOutSql(alias: string): string {
  return (
    `${alias}.out_of_office_delegate IS NOT NULL ` +
    `AND ${alias}.out_of_office_from IS NOT NULL AND ${alias}.out_of_office_to IS NOT NULL ` +
    `AND date('now') BETWEEN ${alias}.out_of_office_from AND ${alias}.out_of_office_to`
  );
}

/**
 * **THE ONE LINE `src/server/decks/assignments.ts` NEEDS AT INTEGRATION.**
 *
 * The delegate must not merely SEE the work they are covering; they must be able
 * to open it and submit it. Every one of those gates reads `ASSIGNEE_PAIRS_SQL`
 * — `routes/decks.ts:570` decides whether a jury member's deck list contains the
 * deck at all, and `routes/pipeline.ts:529` decides whether they may score it —
 * so delegation belongs in that one definition and nowhere else. That file is
 * another lane's, so the arm is written here and the edit is:
 *
 * ```ts
 * import { delegatedAssigneePairsSql } from "../../shared/outOfOffice";
 *
 * const BASE_ASSIGNEE_PAIRS_SQL =
 *   "SELECT deck_id, evaluator_id FROM deck_assignments " +
 *   "UNION SELECT id AS deck_id, assigned_to AS evaluator_id FROM decks WHERE assigned_to IS NOT NULL";
 *
 * export const ASSIGNEE_PAIRS_SQL =
 *   `${BASE_ASSIGNEE_PAIRS_SQL} UNION ${delegatedAssigneePairsSql(BASE_ASSIGNEE_PAIRS_SQL)}`;
 * ```
 *
 * Three properties worth the words:
 *
 *   • **The delegate is re-checked, not trusted.** The write-side validation in
 *     `routes/users.ts` already refuses a delegate outside the workspace, but a
 *     column can be left behind by a later deactivation or soft delete. So the
 *     arm joins the delegate's own row and requires `active = 1`,
 *     `deleted_at IS NULL` and the SAME `(tenant_id, edition)` as the absentee.
 *     A cross-workspace id sitting in the column grants nothing.
 *   • **It is bind-free**, for the reason `currentlyOutSql` gives.
 *   • **It does not UNION itself.** The arm takes the base pairs as its input
 *     rather than reading `ASSIGNEE_PAIRS_SQL`, so delegating to someone who is
 *     themselves out does not nest: the chain is exactly one hop deep, which is
 *     what "cover" means and what keeps the SQL finite.
 */
export function delegatedAssigneePairsSql(basePairsSql: string): string {
  return (
    "SELECT ap.deck_id AS deck_id, absent.out_of_office_delegate AS evaluator_id " +
    `FROM (${basePairsSql}) ap ` +
    "JOIN users absent ON absent.id = ap.evaluator_id " +
    "JOIN users deleg ON deleg.id = absent.out_of_office_delegate " +
    "  AND deleg.tenant_id = absent.tenant_id AND deleg.edition = absent.edition " +
    `WHERE ${currentlyOutSql("absent")} ` +
    "  AND absent.deleted_at IS NULL " +
    "  AND deleg.deleted_at IS NULL AND deleg.active = 1"
  );
}
