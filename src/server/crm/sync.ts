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
import type { Edition } from "../../shared/roles";
import { loadConnection, type ConnectionRow } from "./store";
import { recordSyncAttempt, type CrmSyncRecord } from "./provider";
import type { CrmProvider } from "../../shared/crm";

/** Deals pulled this calendar month, against which the cap is measured. */
export async function pulledThisMonth(
  env: Env,
  connectionId: string,
  now: Date = new Date(),
): Promise<number> {
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const row = await env.DB.prepare(
    "SELECT COALESCE(SUM(record_count), 0) AS n FROM crm_sync_log " +
      "WHERE connection_id = ? AND operation = 'pull_deals' AND status IN ('recorded', 'sent') " +
      "AND substr(created_at, 1, 7) = ?",
  )
    .bind(connectionId, month)
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
  row: ConnectionRow,
  now: Date = new Date(),
): Promise<PullOutcome> {
  const used = await pulledThisMonth(env, row.id, now);
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
    {
      connectionId: row.id,
      edition: row.edition as Edition,
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
 * evaluation completes; a no-op — recorded as `'skipped'` — unless the edition
 * has a live connection with write-back enabled and a target field configured.
 *
 * Returns `null` when the edition has no live write-back connection at all, so
 * the caller can ignore CRM entirely in the common case.
 */
export async function writeBackDeckScore(
  env: Env,
  args: {
    edition: Edition;
    deckId: string;
    externalId?: string | null;
    fields: Record<string, unknown>;
  },
): Promise<CrmSyncRecord | null> {
  const row = await env.DB.prepare(
    "SELECT id, edition, provider, status, base_url, score_writeback_field, write_back_scores, credential_ref " +
      "FROM crm_connections WHERE edition = ? AND status = 'live' AND write_back_scores = 1 LIMIT 1",
  )
    .bind(args.edition)
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
    {
      connectionId: row.id,
      edition: args.edition,
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
  edition: Edition,
  provider: CrmProvider,
): Promise<ConnectionRow | null> {
  return loadConnection(env, edition, provider);
}
