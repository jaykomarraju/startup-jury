/**
 * The CRM provider call, behind an interface, with a stub that **records
 * instead of calling out** — the shape `src/server/email/outbox.ts` already
 * uses, applied to the second of the plan's three vendor-dependent surfaces
 * (§1.3). The full admin UI, schema, API and application flow ship; going live
 * is a later configuration step, not a code change.
 *
 * Concretely:
 *
 *   - `resolveCrmClient` returns a client only when the Worker is configured
 *     with one. Nothing configures one today, so it always returns `null` and
 *     every attempt lands in `crm_sync_log` with `status='recorded'` — audited,
 *     never claimed as sent. That is the exact `emailDeliveryConfigured`
 *     contract, and the reason `'recorded'` is not `'sent'`.
 *   - **No vendor SDK, no credential and no network call is on the critical
 *     path.** `import`s here are this repo's own modules only.
 *   - Credentials live in Worker secrets. `crm_connections.credential_ref`
 *     names the secret; the value is read through `secretFor` at call time and
 *     is never persisted, never returned by a GET and never logged — the stub
 *     records `payload`, which is built from deal/deck fields alone.
 */

import type { Env } from "../types";
import type { Edition } from "../../shared/roles";
import type { CrmOperation, CrmProvider, CrmSyncStatus } from "../../shared/crm";

/** What a sync attempt would carry. Never a credential. */
export interface CrmSyncAttempt {
  connectionId: string;
  edition: Edition;
  provider: CrmProvider;
  operation: CrmOperation;
  /** 'pull' for inbound deals, 'push' for outbound scores. */
  direction: "pull" | "push";
  /** The deck a write-back belongs to, when there is one. */
  deckId?: string | null;
  /** Rows the attempt covers — deals matched, or 1 for a single write-back. */
  recordCount?: number;
  /** The request body the provider would have received. Audited verbatim. */
  payload: Record<string, unknown>;
  /**
   * Set when a precondition said not to try (write-back disabled, monthly cap
   * reached). Recorded as `status='skipped'` with this as the reason.
   */
  skipReason?: string | null;
}

export interface CrmSyncRecord extends CrmSyncAttempt {
  id: string;
  status: CrmSyncStatus;
  createdAt: string;
  error: string | null;
}

/**
 * The subset of a provider a live deployment would implement — one method per
 * direction. A vendor adapter satisfies this; nothing in this repo does yet.
 */
export interface CrmClient {
  readonly provider: CrmProvider;
  /** Fetch deals matching the connection's filter rules. */
  pullDeals(req: {
    baseUrl: string | null;
    triggerField: string | null;
    triggerValue: string | null;
    limit: number;
  }): Promise<{ records: Array<Record<string, unknown>> }>;
  /** Write one deck's evaluation result into the mapped CRM fields. */
  writeBack(req: {
    baseUrl: string | null;
    externalId: string | null;
    fields: Record<string, unknown>;
  }): Promise<{ id?: string } | void>;
}

/**
 * Read a Worker secret by the name `crm_connections.credential_ref` holds.
 *
 * `Env` (`src/server/types.ts`) is a shared file this session does not own, so
 * the binding is read off the environment by name rather than declared as a
 * field. A live deployment adds `wrangler secret put CRM_SALESFORCE_TOKEN`; the
 * value never reaches D1, a response body or a log line.
 */
/**
 * A connection's `credential_ref` is chosen by an administrator, so it must not
 * be able to name an arbitrary Worker binding. Without this it could read
 * ANTHROPIC_API_KEY — or any other secret in `env` — and a future adapter would
 * carry it off the platform. Inert on the shipped build (the adapter table is
 * empty, so `resolveCrmClient` returns null and nothing calls this), which is
 * exactly why it is worth closing now rather than when an adapter lands.
 * Constrained at Wave 3 integration.
 */
const CREDENTIAL_REF = /^CRM_[A-Z0-9_]{1,48}$/;

export function isCredentialRef(ref: string | null | undefined): boolean {
  return typeof ref === "string" && CREDENTIAL_REF.test(ref);
}

export function secretFor(env: Env, ref: string | null | undefined): string | undefined {
  if (!isCredentialRef(ref)) return undefined;
  const v = (env as unknown as Record<string, unknown>)[ref as string];
  return typeof v === "string" && v.trim() ? v : undefined;
}

/**
 * The configured client for a connection, or `null` when this deployment has
 * none — the CRM counterpart of `emailDeliveryConfigured`.
 *
 * It returns `null` unconditionally today: no adapter is registered, because
 * registering one would put a vendor SDK on the critical path. The credential
 * lookup is still performed so a deployment that sets the secret without an
 * adapter gets the same honest `'recorded'` result rather than a false 'sent'.
 */
export function resolveCrmClient(
  env: Env,
  connection: { provider: CrmProvider; credentialRef: string | null },
): CrmClient | null {
  const credential = secretFor(env, connection.credentialRef);
  if (!credential) return null;
  // No adapter is registered (§1.3). When one is, it is constructed here — the
  // only line in the application that needs to change to go live.
  return ADAPTERS[connection.provider]?.(credential) ?? null;
}

/**
 * Provider adapters, by provider. Empty by design: §1.3 says the vendor call is
 * a later configuration step. The table exists so adding one is a single entry
 * and nothing else in the app moves.
 */
const ADAPTERS: Partial<Record<CrmProvider, (credential: string) => CrmClient>> = {};

/**
 * Record a sync attempt and, if this deployment has a client, perform it.
 *
 * Never throws on a provider failure: the row is written with `status='failed'`
 * and the reason, so a misconfigured CRM degrades to an auditable no-sync
 * rather than breaking the flow that triggered it (an evaluation, a cron pull).
 */
export async function recordSyncAttempt(
  env: Env,
  attempt: CrmSyncAttempt,
  connection: { credentialRef: string | null },
  now: () => string = () => new Date().toISOString(),
): Promise<CrmSyncRecord> {
  const id = `crmsync_${crypto.randomUUID()}`;
  const createdAt = now();

  let status: CrmSyncStatus = attempt.skipReason ? "skipped" : "recorded";
  let error: string | null = attempt.skipReason ?? null;
  let recordCount = attempt.recordCount ?? 0;

  if (!attempt.skipReason) {
    const client = resolveCrmClient(env, {
      provider: attempt.provider,
      credentialRef: connection.credentialRef,
    });
    if (client) {
      try {
        if (attempt.operation === "pull_deals") {
          const res = await client.pullDeals({
            baseUrl: (attempt.payload.baseUrl as string | null) ?? null,
            triggerField: (attempt.payload.triggerField as string | null) ?? null,
            triggerValue: (attempt.payload.triggerValue as string | null) ?? null,
            limit: (attempt.payload.limit as number) ?? 0,
          });
          recordCount = res.records.length;
        } else {
          await client.writeBack({
            baseUrl: (attempt.payload.baseUrl as string | null) ?? null,
            externalId: (attempt.payload.externalId as string | null) ?? null,
            fields: (attempt.payload.fields as Record<string, unknown>) ?? {},
          });
          recordCount = 1;
        }
        status = "sent";
        error = null;
      } catch (err) {
        status = "failed";
        // The message only — a provider error can echo the request, and the
        // request is the one place a credential could travel.
        error = err instanceof Error ? `${err.name}: ${err.message}` : "sync failed";
      }
    }
  }

  await env.DB.prepare(
    "INSERT INTO crm_sync_log (id, connection_id, edition, provider, direction, operation, status, deck_id, record_count, payload_json, error, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      id,
      attempt.connectionId,
      attempt.edition,
      attempt.provider,
      attempt.direction,
      attempt.operation,
      status,
      attempt.deckId ?? null,
      recordCount,
      JSON.stringify(attempt.payload),
      error,
      createdAt,
    )
    .run();

  // The connection's own telemetry — what the prototype's `.crm-sub` renders
  // ("Last sync: 4 Jun 2026 · 11:42 am · 3 deals pulled"). A skipped attempt is
  // not a sync and must not move the timestamp.
  if (status !== "skipped") {
    await env.DB.prepare(
      "UPDATE crm_connections SET last_sync_at = ?, last_sync_count = ?, last_error = ?, " +
        "status = CASE WHEN ? = 'failed' THEN 'error' ELSE status END, updated_at = ? WHERE id = ?",
    )
      .bind(createdAt, recordCount, error, status, createdAt, attempt.connectionId)
      .run();
  }

  return { ...attempt, id, status, createdAt, error, recordCount };
}
