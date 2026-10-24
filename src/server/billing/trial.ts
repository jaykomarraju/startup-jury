/**
 * P2 (23-Oct tracker, row 9 — "Client signing up for 3 decks free") — the free
 * trial, as a real grant.
 *
 * ── WHAT WAS THERE ──────────────────────────────────────────────────────────
 * "Take a 3-deck free trial" opened `#acs-trial`, whose "Use a trial deck"
 * button decremented a counter in the browser (`AccountOverlay.tsx`, `trialUsed`)
 * and wrote nothing. A new customer was promised three free evaluations, and the
 * upload gate (`reserveCredits`, a conditional UPDATE on `credits_balance`) then
 * refused their first deck with 402 — the balance had never moved.
 *
 * ── WHAT IT IS NOW ──────────────────────────────────────────────────────────
 * `takeFreeTrial` adds `book.trial.decks` credits — the PUBLISHED catalogue's
 * figure, the one Price configuration edits and the plan screens print — with a
 * `trial_grant` row in `credit_ledger`, in one transaction (`grantCredits`).
 * Taking it is an explicit action on the trial screen, not a side effect of
 * opening it: a customer who only looks at the trial must not have spent it.
 *
 * ONCE PER WORKSPACE, enforced inside that transaction by the guard "no
 * `trial_grant` row exists for this `(tenant_id, edition)`" — not by a SELECT
 * before it, which two taps on a phone would race. A workspace that already has
 * one keeps it: the demo workspace's seeded `cl_inc_0001` / `cl_vc_0001` (`0032`)
 * are trials taken in May, and they count.
 *
 * Rejected, and why:
 *   • A partial unique index on `credit_ledger (tenant_id, edition) WHERE reason
 *     = 'trial_grant'`. It is the stronger guarantee, but it is a migration, this
 *     lane owns none, and `0101`'s header records what a partial index does to an
 *     `ON CONFLICT` that names the wrong target. The in-transaction guard gives
 *     the same answer under D1's single writer. Recorded as a follow-up.
 *   • Granting on sign-up. Registration (`routes/registration.ts`) is not this
 *     lane's file, and a workspace's first user is not necessarily its buyer.
 *   • Expiry. `book.trial.expiryDays` is 0 ("never") in every published book; a
 *     non-zero value has no job to enforce it, so the grant does not pretend to.
 */
import type { Env } from "../types";
import { scoped, type TenantScope } from "../../shared/tenant";
import type { FreeTrialStatus } from "../../shared/plans";
import { grantCredits } from "./ledger";

/** What the workspace's ledger says about its trial. */
export async function readTrialStatus(
  env: Env,
  scope: TenantScope,
  decks: number,
): Promise<FreeTrialStatus> {
  const q = scoped(scope).on("l").andRaw("l.reason = 'trial_grant'");
  const grant = await env.DB.prepare(
    "SELECT MIN(l.created_at) AS granted_at, COALESCE(SUM(l.delta), 0) AS granted " +
      `FROM credit_ledger l ${q.whereClause()}`,
  )
    .bind(...q.binds)
    .first<{ granted_at: string | null; granted: number }>();

  const grantedAt = grant?.granted_at ?? null;
  const granted = Math.max(0, grant?.granted ?? 0);
  let used = 0;
  if (grantedAt) {
    // OLDEST CREDITS FIRST (see `FreeTrialStatus.used`). Evaluations net of their
    // refunds — `refund` is the +1 `refundCredits` writes when an evaluation fails,
    // so a failed upload does not burn a trial deck — minus every credit GRANTED
    // before the trial, which those evaluations spend first.
    //
    // Measured against the two real shapes rather than a new workspace alone: GCW
    // (`t_gcw`) holds 2500 credits from `0108`'s adjustment and no trial, so if it
    // takes one, its first evaluation must not read as a used trial deck. Counting
    // "debits since the grant" did exactly that. Negative adjustments are left
    // out of the "granted before" side: an operator lowering a balance removed
    // credits, it did not spend the trial's.
    const spentQ = scoped(scope).on("l").andRaw("l.reason IN ('deck_evaluated', 'refund')");
    const spent = await env.DB.prepare(
      `SELECT COALESCE(SUM(l.delta), 0) AS n FROM credit_ledger l ${spentQ.whereClause()}`,
    )
      .bind(...spentQ.binds)
      .first<{ n: number }>();
    const earlierQ = scoped(scope)
      .on("l")
      .andRaw("l.delta > 0")
      .andRaw("l.reason NOT IN ('trial_grant', 'refund')")
      .and("l.created_at < ?", grantedAt);
    const earlier = await env.DB.prepare(
      `SELECT COALESCE(SUM(l.delta), 0) AS n FROM credit_ledger l ${earlierQ.whereClause()}`,
    )
      .bind(...earlierQ.binds)
      .first<{ n: number }>();
    const consumed = Math.max(0, -(spent?.n ?? 0));
    used = Math.min(granted, Math.max(0, consumed - (earlier?.n ?? 0)));
  }
  return { decks: Math.max(0, decks), taken: grantedAt !== null, grantedAt, granted, used };
}

export type TakeTrialResult =
  | { ok: true; granted: number; entryId: string }
  | { ok: false; error: "trial_not_offered" | "trial_already_taken" };

/**
 * Grant the free trial to this workspace, or say why not. Never grants twice.
 */
export async function takeFreeTrial(
  env: Env,
  scope: TenantScope,
  decks: number,
  actorId: string | null,
): Promise<TakeTrialResult> {
  if (!Number.isInteger(decks) || decks <= 0) return { ok: false, error: "trial_not_offered" };
  const result = await grantCredits(
    env,
    scope,
    {
      delta: decks,
      reason: "trial_grant",
      // The seeded rows' own words (`0032`), so the usage history reads the same
      // for a trial taken in May and one taken today.
      note: `Free trial — ${decks} deck evaluation${decks === 1 ? "" : "s"}`,
      actorId,
    },
    {
      guard: {
        sql:
          "NOT EXISTS (SELECT 1 FROM credit_ledger x WHERE x.tenant_id = ? AND x.edition = ? " +
          "AND x.reason = 'trial_grant')",
        binds: [scope.tenantId, scope.edition],
      },
    },
  );
  if (!result.granted) return { ok: false, error: "trial_already_taken" };
  return { ok: true, granted: decks, entryId: result.entryId };
}
