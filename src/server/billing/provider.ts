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
 *     completed payment.
 *   - `'completed'` is written in exactly one place, `billing/fulfilment.ts`,
 *     and only from a `PaymentConfirmation` — a provider-signed return, a
 *     provider-signed webhook, or the provider's own API — in the same
 *     transaction that grants the credits (P2). Nothing here writes it.
 *   - No vendor SDK and no credential is on the critical path. The imports here
 *     are this repo's own modules only; `billing/razorpay.ts` speaks Razorpay's
 *     REST API with `fetch` and Web Crypto.
 *
 * **T1-COMMERCE — an intent names the customer it is for.**
 * `PaymentIntentAttempt.tenantId` is required, not optional: the column's
 * backfill default would otherwise file one customer's purchase against another
 * and report a 200 doing it. `paymentConfigured` and `resolvePaymentClient` stay
 * tenant-blind and correctly so — they read Worker secrets, which are a property
 * of the DEPLOYMENT and not of any customer. Per-customer payment credentials
 * would be a platform-tier feature, not a scope predicate.
 */

import type { Env } from "../types";
import type { Edition } from "../../shared/roles";
import { insertScope } from "../../shared/tenant";
import type { PaymentIntentView, TaxBreakdown } from "../../shared/plans";
import { razorpayAdapter } from "./razorpay";

/** The providers an adapter could be written for. Naming them costs nothing. */
export type PaymentProvider = "razorpay" | "stripe" | "manual";

export type IntentPurpose = "credit_pack" | "subscription" | "enterprise" | "seat";

/** What a purchase attempt carries. Never an instrument, never a card. */
export interface PaymentIntentAttempt {
  /**
   * The CUSTOMER being charged — `organizations.id`, from `scopeOf(user).tenantId`.
   *
   * REQUIRED, and that is the whole point. `billing_payment_intents.tenant_id`
   * carries `DEFAULT 't_default'` (`0086:33`) because SQLite offers no other way
   * to backfill a NOT NULL column, so an attempt that simply omitted the tenant
   * would record a 200, write a row, and file the second customer's purchase
   * against the first — with nothing in the response to notice. A missing field
   * here does not compile instead.
   */
  tenantId: string;
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
  /**
   * P2 — the ABSOLUTE URL the provider sends the customer back to
   * (`GET /api/billing/return`). A provider needs an absolute one; the routes
   * build it from `APP_BASE_URL`. Optional only so the stub-era callers and
   * their tests keep compiling; with no provider it is never used.
   */
  returnUrl?: string;
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
 * P2 — a payment the PROVIDER says is complete, after its signature or its own
 * API has been checked. Nothing in this application constructs one from a
 * request a customer could have shaped: `verifyReturn` and `verifyWebhook` only
 * return one when an HMAC keyed with a secret the customer never sees holds, and
 * `lookup` asks the provider directly.
 */
export interface PaymentConfirmation {
  /** OUR intent id — the `reference` handed to `createCheckout`, signed back. */
  reference: string;
  /** The provider's id for the checkout (`plink_…`) — `provider_ref` on the intent. */
  providerRef: string;
  /** The provider's id for the money (`pay_…`) — the transaction reference on the invoice. */
  paymentId: string;
  /** What was actually paid, in minor units. */
  amountMinor: number;
  currency: string;
}

/** What a provider → server notification turned out to be. */
export type WebhookVerdict =
  | { kind: "paid"; confirmation: PaymentConfirmation }
  /** The checkout closed with nothing paid — it expired or was cancelled. */
  | { kind: "closed"; reference: string; providerRef: string }
  /** Authentic, and not an event this application acts on. */
  | { kind: "ignored"; event: string }
  /** Not signed by the provider, or no webhook secret is configured. */
  | { kind: "unverified" };

/**
 * The confirming half of a live provider. Separate from `PaymentClient` so the
 * test doubles that only start a checkout (`billing.test.ts`) need not grow
 * methods they do not exercise.
 */
export interface PaymentConfirmer {
  readonly provider: PaymentProvider;
  /** The customer's return from the hosted page, verified. Null unless it proves a completed payment. */
  verifyReturn(query: URLSearchParams): Promise<PaymentConfirmation | null>;
  /** A notification, verified against the RAW body — re-serialising it would break the signature. */
  verifyWebhook(rawBody: string, headers: Headers): Promise<WebhookVerdict>;
  /** Ask the provider directly, for a payment whose return and webhook never arrived. */
  lookup(providerRef: string): Promise<PaymentConfirmation | null>;
}

export type PaymentAdapter = PaymentClient & PaymentConfirmer;

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

/** `PAYMENTS_RAZORPAY_WEBHOOK_SECRET` — the key Razorpay signs its webhooks with. */
export function paymentWebhookSecretRef(provider: PaymentProvider): string {
  return `PAYMENTS_${provider.toUpperCase()}_WEBHOOK_SECRET`;
}

/**
 * Provider adapters, by provider.
 *
 * **P2 — Razorpay is registered.** It was empty by instruction while pricing
 * was open; the integrator confirmed on 2026-10-23 that the Razorpay keys
 * secured in September are still valid. (On 24-Sep the client had said "STRIPE,
 * not Razorpay" — `docs/plan_myaccount.md` §9 Q4. The integrator's confirmation
 * is the later word; Stripe would be one more entry here.)
 *
 * Registering an adapter turns NOTHING on by itself. `resolvePaymentClient`
 * builds one only when `PAYMENTS_RAZORPAY_KEY` is set on the deployment, which
 * no deployment has today, so every build keeps recording intents exactly as it
 * did until the integrator sets the secret. No key is in this repository.
 */
const ADAPTERS: Partial<
  Record<PaymentProvider, (credential: string, webhookSecret: string | undefined) => PaymentAdapter | null>
> = {
  razorpay: (credential, webhookSecret) => razorpayAdapter(credential, webhookSecret),
};

/**
 * The configured adapter, or `null` when this deployment has none — the payment
 * counterpart of `emailDeliveryConfigured` and `resolveCrmClient`.
 *
 * A secret that does not parse as a credential (Razorpay's is `key_id:key_secret`)
 * resolves to `null` rather than to an adapter that fails at checkout: the honest
 * `'recorded'` result beats a customer sent to a page that cannot take money.
 */
export function resolvePaymentAdapter(env: Env): PaymentAdapter | null {
  for (const provider of ["razorpay", "stripe", "manual"] as PaymentProvider[]) {
    const credential = secretFor(env, paymentCredentialRef(provider));
    if (!credential) continue;
    const adapter = ADAPTERS[provider]?.(credential, secretFor(env, paymentWebhookSecretRef(provider)));
    if (adapter) return adapter;
  }
  return null;
}

/** The checkout half, for the callers that only start one. */
export function resolvePaymentClient(env: Env): PaymentClient | null {
  return resolvePaymentAdapter(env);
}

/** True when a purchase could actually be taken — i.e. the Razorpay key is set. */
export function paymentConfigured(env: Env): boolean {
  return resolvePaymentClient(env) !== null;
}

/**
 * Where the provider sends the customer back: `GET /api/billing/return` on THIS
 * deployment. `APP_BASE_URL` first — it is the configured public origin and
 * cannot be steered by a `Host` header — and the request's own origin only
 * where it is unset (local development, tests).
 */
export function paymentReturnUrl(env: Env, requestUrl: string): string {
  const base = (env.APP_BASE_URL?.trim() || new URL(requestUrl).origin).replace(/\/+$/, "");
  return `${base}/api/billing/return`;
}

/** The shape of every intent id `recordPaymentIntent` mints. */
export const INTENT_ID = /^pi_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Record a purchase intent and, if this deployment has a provider, ask it for a
 * hosted checkout page.
 *
 * Never throws on a provider failure: the row is written with `status='failed'`
 * and the reason, so a misconfigured provider degrades to an auditable
 * no-purchase rather than a half-charged customer.
 *
 * What it does **not** do, in any branch: grant credits, mark a plan active, or
 * write `status='completed'`. A recorded or redirected intent is not a payment.
 * Crediting happens in `billing/fulfilment.ts`, when the provider confirms the
 * money — and with no provider configured, the honest state of every purchase
 * is "recorded".
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
        returnUrl: attempt.returnUrl ?? "/app/admin?section=bl",
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

  const t = insertScope({ tenantId: attempt.tenantId, edition: attempt.edition });
  await env.DB.prepare(
    `INSERT INTO billing_payment_intents (id, ${t.columns}, purpose, plan_code, plan_name, units, quantity, currency, ` +
      "subtotal_minor, tax_minor, total_minor, gst_rate_pct, gst_inclusive, provider, status, checkout_url, " +
      `provider_ref, error, actor_id, created_at, updated_at) ` +
      `VALUES (?, ${t.placeholders}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      ...t.binds,
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
