/**
 * The payment-provider call, behind an interface, with a stub that **records
 * instead of charging** — the third of the plan's three vendor-dependent
 * surfaces (§1.3), built the way `src/server/email/outbox.ts` and
 * `src/server/crm/provider.ts` already are. The full admin UI, schema, API and
 * purchase flow ship; going live is a later configuration step, not a code
 * change.
 *
 * **§1.2 is absolute here, and it is why this file is shaped the way it is.**
 * The prototype draws a raw card number and CVV in-app (`#sus-buypay`). Card
 * data must never reach this application, so:
 *
 *   - There is **no PAN, CVV, expiry, cardholder or instrument field** in this
 *     module, in `billing_payment_intents`, in any request body this server
 *     accepts or in any response it returns. Not optional, not masked, not
 *     "for testing" — absent.
 *   - A purchase produces a **provider-hosted surface**: a redirect URL or an
 *     iframed element the provider serves and the customer types into. The only
 *     thing that comes back is a reference.
 *   - With no provider configured — which is every deployment today — the
 *     attempt lands in `billing_payment_intents` with `status='recorded'`, the
 *     exact `crm_sync_log` contract: audited, and **never** reported as a
 *     completed payment. `'completed'` is unreachable from this build, because
 *     `ADAPTERS` is empty and only a provider webhook could legitimately write
 *     it.
 *   - No vendor SDK and no credential is on the critical path. The imports here
 *     are this repo's own modules only.
 */

import type { Env } from "../types";
import type { Edition } from "../../shared/roles";
import type { PaymentIntentView, TaxBreakdown } from "../../shared/plans";

/** The providers an adapter could be written for. Naming them costs nothing. */
export type PaymentProvider = "razorpay" | "stripe" | "manual";

export type IntentPurpose = "credit_pack" | "subscription" | "enterprise" | "seat";

/** What a purchase attempt carries. Never an instrument, never a card. */
export interface PaymentIntentAttempt {
  edition: Edition;
  purpose: IntentPurpose;
  planCode: string | null;
  planName: string;
  /** Credits one unit of this plan grants, when it grants any. */
  units: number | null;
  quantity: number;
  currency: string;
  /** Already computed in integer minor units by `src/shared/plans.ts`. */
  money: TaxBreakdown;
  actorId: string | null;
}

/**
 * The subset of a provider a live deployment would implement: one call, which
 * hands back a page the PROVIDER hosts. There is deliberately no `charge`,
 * `capture` or `tokenize` method — a method that took a card number is a method
 * this application must not be able to call.
 */
export interface PaymentClient {
  readonly provider: PaymentProvider;
  createCheckout(req: {
    reference: string;
    amountMinor: number;
    currency: string;
    description: string;
    /** Where the provider returns the customer once it is done. */
    returnUrl: string;
  }): Promise<{ url: string; providerRef?: string }>;
}

/**
 * Credentials live in Worker secrets, named like `PAYMENTS_RAZORPAY_KEY`. The
 * pattern is fixed in code so a configured name can never reach for another
 * binding (the constraint W3-D's `CREDENTIAL_REF` added for the same reason);
 * `Env` is a shared file this session does not own, so the binding is read off
 * the environment by name rather than declared as a field.
 */
const CREDENTIAL_REF = /^PAYMENTS_[A-Z0-9_]{1,48}$/;

export function paymentCredentialRef(provider: PaymentProvider): string {
  return `PAYMENTS_${provider.toUpperCase()}_KEY`;
}

export function secretFor(env: Env, ref: string): string | undefined {
  if (!CREDENTIAL_REF.test(ref)) return undefined;
  const v = (env as unknown as Record<string, unknown>)[ref];
  return typeof v === "string" && v.trim() ? v : undefined;
}

/**
 * Provider adapters, by provider. **Empty by design** (§1.3): the vendor call is
 * a later configuration step. The table exists so that adding one is a single
 * entry and nothing else in the application moves.
 */
const ADAPTERS: Partial<Record<PaymentProvider, (credential: string) => PaymentClient>> = {};

/**
 * The configured client, or `null` when this deployment has none — the payment
 * counterpart of `emailDeliveryConfigured` and `resolveCrmClient`.
 *
 * Returns `null` unconditionally today. The credential lookup still runs, so a
 * deployment that sets the secret without an adapter gets the same honest
 * `'recorded'` result rather than a false "paid".
 */
export function resolvePaymentClient(env: Env): PaymentClient | null {
  for (const provider of ["razorpay", "stripe", "manual"] as PaymentProvider[]) {
    const credential = secretFor(env, paymentCredentialRef(provider));
    if (!credential) continue;
    // No adapter is registered (§1.3). When one is, it is constructed here — the
    // only line in the application that needs to change to go live.
    const client = ADAPTERS[provider]?.(credential);
    if (client) return client;
  }
  return null;
}

/** True when a purchase could actually be taken. False on every build today. */
export function paymentConfigured(env: Env): boolean {
  return resolvePaymentClient(env) !== null;
}

/**
 * Record a purchase intent and, if this deployment has a provider, ask it for a
 * hosted checkout page.
 *
 * Never throws on a provider failure: the row is written with `status='failed'`
 * and the reason, so a misconfigured provider degrades to an auditable
 * no-purchase rather than a half-charged customer.
 *
 * What it does **not** do, in any branch: grant credits, mark a plan active, or
 * write `status='completed'`. A recorded intent is not a payment. Crediting
 * happens when a provider confirms a payment, which is the webhook a live
 * deployment adds — and until then, the honest state of every purchase in this
 * application is "recorded".
 */
export async function recordPaymentIntent(
  env: Env,
  attempt: PaymentIntentAttempt,
  now: () => string = () => new Date().toISOString(),
  // The same seam `recordSyncAttempt` takes its client through, for the same
  // reason: `ADAPTERS` is empty by design, so the redirected and failed branches
  // are otherwise unreachable and untestable. Production passes nothing.
  client: PaymentClient | null = null,
): Promise<PaymentIntentView> {
  const id = `pi_${crypto.randomUUID()}`;
  const createdAt = now();
  const resolved = client ?? resolvePaymentClient(env);

  let status: PaymentIntentView["status"] = "recorded";
  let checkoutUrl: string | null = null;
  let providerRef: string | null = null;
  let error: string | null = null;

  if (resolved) {
    try {
      const res = await resolved.createCheckout({
        reference: id,
        amountMinor: attempt.money.totalMinor,
        currency: attempt.currency,
        description: attempt.planName,
        returnUrl: "/app/admin?section=bl",
      });
      checkoutUrl = res.url;
      providerRef = res.providerRef ?? null;
      // The customer has been SENT somewhere. Still not a payment.
      status = "redirected";
    } catch (err) {
      status = "failed";
      // The message only — a provider error can echo the request back.
      error = err instanceof Error ? `${err.name}: ${err.message}` : "checkout failed";
    }
  }

  await env.DB.prepare(
    "INSERT INTO billing_payment_intents (id, edition, purpose, plan_code, plan_name, units, quantity, currency, " +
      "subtotal_minor, tax_minor, total_minor, gst_rate_pct, gst_inclusive, provider, status, checkout_url, " +
      "provider_ref, error, actor_id, created_at, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      id,
      attempt.edition,
      attempt.purpose,
      attempt.planCode,
      attempt.planName,
      attempt.units,
      attempt.quantity,
      attempt.currency,
      attempt.money.subtotalMinor,
      attempt.money.taxMinor,
      attempt.money.totalMinor,
      attempt.money.ratePct,
      attempt.money.inclusive ? 1 : 0,
      resolved?.provider ?? "none",
      status,
      checkoutUrl,
      providerRef,
      error,
      attempt.actorId,
      createdAt,
      createdAt,
    )
    .run();

  return {
    id,
    purpose: attempt.purpose,
    planCode: attempt.planCode,
    planName: attempt.planName,
    units: attempt.units,
    quantity: attempt.quantity,
    currency: attempt.currency,
    subtotalMinor: attempt.money.subtotalMinor,
    taxMinor: attempt.money.taxMinor,
    totalMinor: attempt.money.totalMinor,
    ratePct: attempt.money.ratePct,
    status,
    checkoutUrl,
    createdAt,
  };
}
