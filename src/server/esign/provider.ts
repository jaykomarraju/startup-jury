/**
 * The e-signature provider call, behind an interface, with a stub that **records
 * instead of calling out** — the shape `src/server/email/outbox.ts` established
 * and `src/server/crm/provider.ts` copied, applied to the third and last of the
 * plan's vendor-dependent surfaces (§1.3). The full admin UI, schema, API and
 * application flow ship; going live is a later configuration step, not a code
 * change.
 *
 * Concretely:
 *
 *   - `resolveESignClient` returns a client only when the Worker is configured
 *     with one. Nothing configures one today, so it always returns `null` and
 *     every attempt lands in `esign_outbox` with `status='recorded'` — audited,
 *     never claimed as sent. That is the exact `emailDeliveryConfigured`
 *     contract, and the reason `'recorded'` is not `'sent'`.
 *   - **No vendor SDK, no credential and no network call is on the critical
 *     path.** The imports here are this repo's own modules only. SignDesk,
 *     DocuSign, Adobe, Zoho and eMudhra appear as *strings in a union*, nowhere
 *     else.
 *   - Credentials live in Worker secrets. `ESIGN_CREDENTIAL_REF` constrains
 *     which binding may be read, so a provider name coming off a request can
 *     never be turned into a path to `ANTHROPIC_API_KEY`. `src/server/crm/
 *     provider.ts` explains why that containment is worth having while the
 *     adapter table is still empty.
 *   - The signature act itself is NOT gated on a provider. A recorded attempt
 *     still moves the record: the founder's signature locks the method and the
 *     countersignature completes the agreement, because the sign-up flow has to
 *     be walkable end to end on a build with no vendor configured. What a
 *     provider adds is the legal artefact, not the state machine.
 */

import type { Env } from "../types";
import {
  ESIGN_PROVIDER_LABELS,
  type ESignProvider,
  type SignatureType,
} from "../../shared/agreements";

/** What an e-signature call would carry. Never a credential. */
export interface ESignAttempt {
  kind: "envelope_create" | "founder_signature" | "countersign" | "void";
  signupId: string | null;
  agreementId: string | null;
  provider: ESignProvider;
  sigType: SignatureType;
  /** The signer email addresses the envelope would be addressed to. */
  recipients: string[];
  /** The document the envelope would carry, by name. */
  documentName: string | null;
  /** Send at most one envelope per key, ever. */
  dedupeKey?: string | null;
}

export type ESignStatus = "sent" | "failed" | "recorded";

export interface ESignRecord extends ESignAttempt {
  id: string;
  status: ESignStatus;
  providerReference: string | null;
  error: string | null;
  createdAt: string;
  /** True when `dedupeKey` matched an existing row and nothing was sent. */
  deduped?: boolean;
}

/**
 * The subset of a provider a live deployment would implement. Four verbs, one
 * per `ESignAttempt.kind` that leaves the Worker — `founder_signature` and
 * `countersign` are recorded acts rather than calls, and reach the provider
 * only as a status read.
 *
 * A vendor adapter satisfies this; nothing in this repo does yet.
 */
export interface ESignClient {
  readonly provider: ESignProvider;
  /** Put a document out for signature and return the envelope reference. */
  createEnvelope(req: {
    documentName: string | null;
    recipients: string[];
    sigType: SignatureType;
  }): Promise<{ reference: string }>;
  /** Read an envelope's current state back. */
  fetchStatus(reference: string): Promise<{ completed: boolean; signedAt: string | null }>;
  /** Withdraw an envelope that is no longer wanted. */
  voidEnvelope(reference: string, reason: string): Promise<void>;
}

/**
 * Which Worker secret a provider's key may be read from. An administrator
 * chooses a provider, so the binding name is derived from a closed union rather
 * than from anything a request supplies — but the regex is kept as the same
 * belt-and-braces check `crm/provider.ts` carries, because a future adapter
 * table is exactly where a looser lookup would get added by accident.
 */
const ESIGN_CREDENTIAL_REF = /^ESIGN_[A-Z0-9_]{1,48}$/;

export function credentialRefFor(provider: ESignProvider): string {
  return `ESIGN_${provider.toUpperCase()}_TOKEN`;
}

export function isCredentialRef(ref: string | null | undefined): boolean {
  return typeof ref === "string" && ESIGN_CREDENTIAL_REF.test(ref);
}

/**
 * Read a Worker secret by name. `Env` (`src/server/types.ts`) is a shared file
 * this session does not own (§2.2), so the binding is read off the environment
 * by name rather than declared as a field — the same accommodation
 * `crm/provider.ts` makes. A live deployment adds
 * `wrangler secret put ESIGN_DOCUSIGN_TOKEN`; the value never reaches D1, a
 * response body or a log line.
 */
export function secretFor(env: Env, ref: string | null | undefined): string | undefined {
  if (!isCredentialRef(ref)) return undefined;
  const v = (env as unknown as Record<string, unknown>)[ref as string];
  return typeof v === "string" && v.trim() ? v : undefined;
}

/**
 * Provider adapters, by provider. Empty by design: §1.3 says the vendor call is
 * a later configuration step. The table exists so that adding one is a single
 * entry and nothing else in the application moves.
 */
const ADAPTERS: Partial<Record<ESignProvider, (credential: string) => ESignClient>> = {};

/**
 * The configured client for a provider, or `null` when this deployment has none
 * — the e-signature counterpart of `emailDeliveryConfigured`.
 *
 * It returns `null` unconditionally today. The credential lookup is still
 * performed so that a deployment which sets the secret without an adapter gets
 * the same honest `'recorded'` result rather than a false 'sent'.
 */
export function resolveESignClient(env: Env, provider: ESignProvider): ESignClient | null {
  const credential = secretFor(env, credentialRefFor(provider));
  if (!credential) return null;
  // No adapter is registered (§1.3). When one is, it is constructed here — the
  // only line in the application that needs to change to go live.
  return ADAPTERS[provider]?.(credential) ?? null;
}

/** Whether a real envelope could be raised. The UI says so in as many words. */
export function esignDeliveryConfigured(env: Env, provider: ESignProvider): boolean {
  return resolveESignClient(env, provider) !== null;
}

interface OutboxRow {
  id: string;
  status: string;
  provider_reference: string | null;
  error: string | null;
  created_at: string;
}

async function findByDedupeKey(env: Env, key: string): Promise<OutboxRow | null> {
  return env.DB.prepare(
    "SELECT id, status, provider_reference, error, created_at FROM esign_outbox WHERE dedupe_key = ?",
  )
    .bind(key)
    .first<OutboxRow>();
}

function hydrate(attempt: ESignAttempt, row: OutboxRow): ESignRecord {
  return {
    ...attempt,
    id: row.id,
    status: row.status as ESignStatus,
    providerReference: row.provider_reference,
    error: row.error,
    createdAt: row.created_at,
    deduped: true,
  };
}

/**
 * Record an e-signature attempt and, if this deployment has a client, perform
 * it.
 *
 * Never throws on a provider failure: the row is written with `status='failed'`
 * and the reason, so a misconfigured provider degrades to an auditable no-send
 * rather than breaking the sign-up the founder is in the middle of.
 *
 * `client` is the same test seam `recordSyncAttempt` takes and for the same
 * reason: `ADAPTERS` is empty by design, so `'sent'` and `'failed'` are
 * otherwise unreachable and could not be tested at their real call site.
 * Production passes nothing and resolves the client exactly as before.
 */
export async function recordESignAttempt(
  env: Env,
  attempt: ESignAttempt,
  now: () => string = () => new Date().toISOString(),
  client: ESignClient | null = null,
): Promise<ESignRecord> {
  if (attempt.dedupeKey) {
    const existing = await findByDedupeKey(env, attempt.dedupeKey);
    if (existing) return hydrate(attempt, existing);
  }

  const id = `esign_${crypto.randomUUID()}`;
  const createdAt = now();

  let status: ESignStatus = "recorded";
  let providerReference: string | null = null;
  let error: string | null = null;

  const resolved = client ?? resolveESignClient(env, attempt.provider);
  if (resolved) {
    try {
      if (attempt.kind === "envelope_create") {
        const res = await resolved.createEnvelope({
          documentName: attempt.documentName,
          recipients: attempt.recipients,
          sigType: attempt.sigType,
        });
        providerReference = res.reference;
      }
      status = "sent";
    } catch (err) {
      status = "failed";
      // The message only — a provider error can echo the request, and the
      // request is the one place a credential could travel.
      error = err instanceof Error ? `${err.name}: ${err.message}` : "e-signature call failed";
    }
  } else {
    // The stub's reference. Recognisable as one on sight, so nobody mistakes a
    // recorded attempt for a provider envelope while reading the audit.
    providerReference = `stub:${attempt.provider.toLowerCase()}:${id.slice(6, 14)}`;
  }

  try {
    await env.DB.prepare(
      "INSERT INTO esign_outbox (id, signup_id, agreement_id, kind, provider, sig_type, " +
        "recipients_json, document_name, status, provider_reference, error, dedupe_key, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        id,
        attempt.signupId,
        attempt.agreementId,
        attempt.kind,
        attempt.provider,
        attempt.sigType,
        JSON.stringify(attempt.recipients),
        attempt.documentName,
        status,
        providerReference,
        error,
        attempt.dedupeKey ?? null,
        createdAt,
      )
      .run();
  } catch (err) {
    // The only expected failure is the dedupe UNIQUE index losing a race with a
    // concurrent run. Return the row that won rather than surfacing a 500.
    if (attempt.dedupeKey) {
      const existing = await findByDedupeKey(env, attempt.dedupeKey);
      if (existing) return hydrate(attempt, existing);
    }
    throw err;
  }

  return { ...attempt, id, status, providerReference, error, createdAt };
}

/**
 * The sentence the UI prints under a recorded attempt. Here rather than in the
 * component so the server's honesty and the screen's wording cannot drift: this
 * is the one place either says what did or did not happen.
 */
export function describeAttempt(record: {
  status: ESignStatus;
  provider: ESignProvider;
}): string {
  const label = ESIGN_PROVIDER_LABELS[record.provider];
  switch (record.status) {
    case "sent":
      return `Sent to ${label} for signature.`;
    case "failed":
      return `${label} refused the request. The attempt is recorded.`;
    case "recorded":
      return `Recorded — no e-signature provider is configured, so nothing was sent to ${label}.`;
  }
}
