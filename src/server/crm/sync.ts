/**
 * The two application flows a CRM connection drives, both of which end in
 * `recordSyncAttempt` — so both are audited and neither performs a call while
 * no provider is configured (§1.3).
 *
 *   `runPull`            — the inbound flow the prototype's filter-rule card
 *                          configures: match deals on trigger field/value, up
 *                          to the **monthly deck cap**, which is the only spend
 *                          guard on auto-pulled decks (F0179).
 *   `writeBackDeckScore` — the outbound flow (F0180): after an evaluation
 *                          completes, push the composite into the configured
 *                          CRM field.
 *
 * Both refuse rather than pretend: a disconnected provider, a disabled toggle
 * or a reached cap produces a `'skipped'` row naming the reason, never a
 * `'sent'` one.
 */

import type { Env } from "../types";
import { scoped, type TenantScope } from "../../shared/tenant";
import { loadConnection, type ConnectionRow } from "./store";
import { recordSyncAttempt, type CrmSyncRecord } from "./provider";
import type { CrmProvider } from "../../shared/crm";

/**
 * Deals pulled this calendar month, against which the cap is measured.
 *
 * §11's aggregate warning with money attached: this `SUM` is the ONLY spend
 * guard on auto-pulled decks (F0179), and a leak here is a number nobody can
 * see is wrong. Unscoped, one customer's pulls eat another customer's cap — the
 * same shape §2 B24 names for credit refunds, where "tenant A's failed
 * evaluation refunds a balance tenant B draws on". `crm_sync_log` carries
 * `tenant_id` directly, so this is a `.on()` and not a join.
 */
export async function pulledThisMonth(
  env: Env,
  scope: TenantScope,
  connectionId: string,
  now: Date = new Date(),
): Promise<number> {
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const q = scoped(scope)
    .on("l")
    .and("l.connection_id = ?", connectionId)
    .andRaw("l.operation = 'pull_deals' AND l.status IN ('recorded', 'sent')")
    .and("substr(l.created_at, 1, 7) = ?", month);
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(l.record_count), 0) AS n FROM crm_sync_log l ${q.whereClause()}`,
  )
    .bind(...q.binds)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * Headroom left under the monthly cap. `null` cap means uncapped — the
 * prototype's field is optional and an empty one must not read as zero.
 */
export function capHeadroom(cap: number | null, used: number): number | null {
  if (cap === null) return null;
  return Math.max(0, cap - used);
}

export interface PullOutcome {
  record: CrmSyncRecord;
  /** How many the cap allowed this run. */
  limit: number;
  used: number;
}

/**
 * Attempt an inbound pull. Records what it WOULD have asked the provider for —
 * the trigger filter and the row limit the cap permits — and, with no provider
 * configured, pulls nothing.
 */
export async function runPull(
  env: Env,
  scope: TenantScope,
  row: ConnectionRow,
  now: Date = new Date(),
): Promise<PullOutcome> {
  const used = await pulledThisMonth(env, scope, row.id, now);
  const headroom = capHeadroom(row.monthly_deck_cap, used);
  const limit = headroom ?? DEFAULT_PULL_LIMIT;

  const skipReason =
    row.status !== "live"
      ? "Connection is not live — connect the provider first."
      : headroom === 0
        ? `Monthly deck cap reached (${row.monthly_deck_cap} this month).`
        : null;

  const record = await recordSyncAttempt(
    env,
    scope,
    {
      connectionId: row.id,
      provider: row.provider as CrmProvider,
      operation: "pull_deals",
      direction: "pull",
      recordCount: 0,
      payload: {
        baseUrl: row.base_url,
        triggerField: row.trigger_field,
        triggerValue: row.trigger_value,
        limit,
        autoApproveWithinCap: row.auto_approve_within_cap === 1,
      },
      skipReason,
    },
    { credentialRef: row.credential_ref },
  );

  return { record, limit, used };
}

/** Rows a single pull asks for when the connection sets no monthly cap. */
export const DEFAULT_PULL_LIMIT = 50;

/**
 * Push one deck's evaluation result back to the CRM (F0180). Called after an
 * evaluation completes; a no-op — recorded as `'skipped'` — unless the
 * workspace has a live connection with write-back enabled and a target field
 * configured.
 *
 * Returns `null` when the workspace has no live write-back connection at all,
 * so the caller can ignore CRM entirely in the common case.
 */
export async function writeBackDeckScore(
  env: Env,
  scope: TenantScope,
  args: {
    deckId: string;
    externalId?: string | null;
    fields: Record<string, unknown>;
  },
): Promise<CrmSyncRecord | null> {
  // **The outbound one.** `LIMIT 1` over a predicate that named only the
  // edition picked whichever live write-back connection the table happened to
  // hold — so one customer's evaluation score would have been pushed into
  // ANOTHER customer's CRM, with no row in any response to notice it by. The
  // same shape §2 B22 calls "a leak that leaves the building".
  const q = scoped(scope)
    .on("c")
    .andRaw("c.status = 'live' AND c.write_back_scores = 1");
  const row = await env.DB.prepare(
    "SELECT c.id, c.edition, c.provider, c.status, c.base_url, c.score_writeback_field, " +
      `c.write_back_scores, c.credential_ref FROM crm_connections c ${q.whereClause()} LIMIT 1`,
  )
    .bind(...q.binds)
    .first<{
      id: string;
      edition: string;
      provider: string;
      status: string;
      base_url: string | null;
      score_writeback_field: string | null;
      write_back_scores: number;
      credential_ref: string | null;
    }>();
  if (!row) return null;

  const skipReason = row.score_writeback_field
    ? null
    : "No score write-back field configured for this connection.";

  return recordSyncAttempt(
    env,
    scope,
    {
      connectionId: row.id,
      provider: row.provider as CrmProvider,
      operation: "write_back_score",
      direction: "push",
      deckId: args.deckId,
      recordCount: 1,
      payload: {
        baseUrl: row.base_url,
        externalId: args.externalId ?? null,
        field: row.score_writeback_field,
        fields: args.fields,
      },
      skipReason,
    },
    { credentialRef: row.credential_ref },
  );
}

/** Load a connection row for a manual action, or `null` if the provider is unknown. */
export async function connectionFor(
  env: Env,
  scope: TenantScope,
  provider: CrmProvider,
): Promise<ConnectionRow | null> {
  return loadConnection(env, scope, provider);
}
