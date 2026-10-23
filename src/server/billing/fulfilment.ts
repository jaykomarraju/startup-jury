/**
 * P2 (23-Oct tracker, row 12) — turning a CONFIRMED payment into credits.
 *
 * The brief's line: "a real payment either completes and grants credits or is
 * honestly refused — no third state where money is taken and nothing is
 * granted." This file is the "completes and grants" half, and the one place in
 * the application that writes `billing_payment_intents.status = 'completed'`.
 *
 * ── ONE TRANSACTION, FIVE WRITES ────────────────────────────────────────────
 * `grantCredits` (`ledger.ts`) runs, as a single D1 batch:
 *
 *   1. the `purchase` ledger row — guarded on "this intent is still
 *      `redirected`", so a second delivery of the same payment writes nothing;
 *   2. the balance, `+ units`, only if (1) was written;
 *   3. the intent → `completed`, only if (1) was written;
 *   4. the GST invoice, linked by `intent_id` — which is what lets
 *      `invoice.ts` (`paymentOf`) print it as a tax invoice rather than a
 *      pro-forma — only if (1) was written;
 *   5. the Billing audit row, only if (1) was written.
 *
 * So there is no instant at which money is recorded as received and credits are
 * not, or credits exist and the intent still says "awaiting payment". If the
 * batch fails, nothing is written, the webhook answers 500, and Razorpay
 * delivers again; the customer's return and `GET /api/account/orders/:id` retry
 * too (`lookup`). Every path is idempotent on the intent's status.
 *
 * ── WHAT IS REFUSED, AND WHY IT IS NOT A SILENT THIRD STATE ─────────────────
 * A confirmation whose amount, currency, provider or link does not match the
 * intent is NOT granted: granting the intent's credits for a different sum would
 * be guessing. It is recorded on the intent (`error`) and in the audit trail as
 * `payment_needs_review`, and reported to the caller. With `accept_partial:
 * false` on every link this application creates, Razorpay cannot produce one;
 * if it ever happens it is visible, not silent, and it needs a person.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────────────
 *   • **The balance ceiling.** `MAX_CREDIT_BALANCE` bounds an operator typing a
 *     number (`POST /api/config/credits`). A paid purchase has been charged; a
 *     ceiling here would be the third state. See `src/shared/plans.ts`.
 *   • **Plan activation.** A paid seat or enterprise plan grants its decks here;
 *     changing the workspace's tier and seats is `billing_subscriptions` plus
 *     `org_settings.plan`, and `billing_subscriptions.billing_period` cannot
 *     express a quarter. The receipt says credits, not "plan active".
 *   • **Refunds** made in Razorpay's dashboard do not reverse credits.
 *
 * ── THE ONE UNSCOPED READ ───────────────────────────────────────────────────
 * The intent is loaded by its primary key with no tenant predicate, because a
 * provider callback has no session to take a scope from. The tenant is then
 * read OFF THE ROW and every write carries it — the same shape as the founder
 * resubmit path. The key itself is only trusted after a provider signature (or
 * the provider's own API) has vouched for it.
 */
import type { Env } from "../types";
import type { Edition } from "../../shared/roles";
import { insertScope, type TenantScope } from "../../shared/tenant";
import { formatMinor } from "../../shared/plans";
import type { PaymentAdapter, PaymentConfirmation, PaymentProvider } from "./provider";
import { grantCredits, readTaxSettings } from "./ledger";

interface IntentRow {
  id: string;
  tenant_id: string;
  edition: Edition;
  purpose: string;
  plan_name: string;
  units: number | null;
  quantity: number;
  currency: string;
  subtotal_minor: number;
  tax_minor: number;
  total_minor: number;
  gst_rate_pct: number;
  provider: string;
  provider_ref: string | null;
  status: string;
  actor_id: string | null;
}

export type FulfilmentOutcome =
  /** Paid, and `credits` were added — balance and ledger together. */
  | { outcome: "granted"; intentId: string; scope: TenantScope; credits: number }
  /** Already completed by an earlier delivery. Nothing was written this time. */
  | { outcome: "already_completed"; intentId: string; scope: TenantScope }
  /** Not an intent of this deployment. Nothing to grant, nothing to retry. */
  | { outcome: "unknown_reference" }
  /** The money and the intent disagree. Recorded for a person; nothing granted. */
  | { outcome: "needs_review"; intentId: string; scope: TenantScope; reason: string };

async function loadIntent(env: Env, id: string): Promise<IntentRow | null> {
  return env.DB.prepare(
    "SELECT id, tenant_id, edition, purpose, plan_name, units, quantity, currency, subtotal_minor, " +
      "tax_minor, total_minor, gst_rate_pct, provider, provider_ref, status, actor_id " +
      "FROM billing_payment_intents WHERE id = ?",
  )
    .bind(id)
    .first<IntentRow>();
}

/** The provider's name as the audit trail's actor column prints it. */
const PROVIDER_LABEL: Record<PaymentProvider, string> = {
  razorpay: "Razorpay",
  stripe: "Stripe",
  manual: "Manual",
};

/** One Billing audit row with no session behind it — the provider is the actor. */
function auditStatement(
  env: Env,
  scope: TenantScope,
  provider: PaymentProvider,
  entry: { action: string; summary: string; detail: unknown; targetId: string },
  onlyIfLedgerRow: string | null,
): D1PreparedStatement {
  const t = insertScope(scope);
  return env.DB.prepare(
    `INSERT INTO audit_log (id, ${t.columns}, category, actor_id, actor_label, action, summary, detail_json, ` +
      "deck_id, target_type, target_id) " +
      `SELECT ?, ${t.placeholders}, 'billing', NULL, ?, ?, ?, ?, NULL, 'billing_payment_intents', ? ` +
      (onlyIfLedgerRow ? "WHERE EXISTS (SELECT 1 FROM credit_ledger WHERE id = ?)" : "WHERE 1 = 1"),
  ).bind(
    `aud_${crypto.randomUUID()}`,
    ...t.binds,
    PROVIDER_LABEL[provider],
    entry.action,
    entry.summary,
    JSON.stringify(entry.detail),
    entry.targetId,
    ...(onlyIfLedgerRow ? [onlyIfLedgerRow] : []),
  );
}

/** Why a confirmation cannot be granted against this intent, or null when it can. */
function mismatch(intent: IntentRow, provider: PaymentProvider, c: PaymentConfirmation): string | null {
  if (intent.provider !== provider) return `intent was opened with ${intent.provider}, confirmed by ${provider}`;
  if (intent.provider_ref !== c.providerRef) return `checkout ${c.providerRef} is not this intent's (${intent.provider_ref ?? "none"})`;
  if (intent.currency !== c.currency) return `paid in ${c.currency}, intent is in ${intent.currency}`;
  if (intent.total_minor !== c.amountMinor) {
    return `paid ${formatMinor(c.amountMinor, c.currency)}, intent total is ${formatMinor(intent.total_minor, intent.currency)}`;
  }
  if (intent.status !== "redirected") return `intent is ${intent.status}, not awaiting payment`;
  return null;
}

/**
 * Apply a provider-confirmed payment: grant, or say exactly why not. Safe to
 * call any number of times for the same payment.
 */
export async function fulfilPayment(
  env: Env,
  provider: PaymentProvider,
  confirmation: PaymentConfirmation,
): Promise<FulfilmentOutcome> {
  const intent = await loadIntent(env, confirmation.reference);
  if (!intent) return { outcome: "unknown_reference" };
  const scope: TenantScope = { tenantId: intent.tenant_id, edition: intent.edition };
  if (intent.status === "completed") return { outcome: "already_completed", intentId: intent.id, scope };

  const problem = mismatch(intent, provider, confirmation);
  if (problem) {
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE billing_payment_intents SET error = ?, updated_at = datetime('now') " +
          "WHERE id = ? AND tenant_id = ? AND edition = ? AND status <> 'completed'",
      ).bind(`payment_needs_review: ${problem}`, intent.id, scope.tenantId, scope.edition),
      auditStatement(
        env,
        scope,
        provider,
        {
          action: "payment_needs_review",
          summary: `Payment ${confirmation.paymentId} received but NOT applied — ${problem}. Needs review.`,
          detail: { ...confirmation, problem },
          targetId: intent.id,
        },
        null,
      ),
    ]);
    return { outcome: "needs_review", intentId: intent.id, scope, reason: problem };
  }

  const credits = Math.max(0, intent.units ?? 0);
  const description = intent.quantity > 1 ? `${intent.quantity} × ${intent.plan_name}` : intent.plan_name;
  const tax = await readTaxSettings(env);
  const t = insertScope(scope);
  const summary =
    `Payment received — ${description} · ${formatMinor(intent.total_minor, intent.currency)}` +
    `${intent.tax_minor > 0 ? " incl. GST" : ""} · ${credits} credit${credits === 1 ? "" : "s"} added · ` +
    `Transaction ID: ${confirmation.paymentId}`;

  if (credits === 0) {
    // A plan that grants no decks (a metered monthly subscription). Paid is still
    // paid: complete it, with no balance movement to explain. The audit row is
    // written only by the call whose UPDATE moved the status — a separate
    // statement because it is a trail, not money, and must not be written by a
    // second delivery that changed nothing.
    const res = await env.DB.prepare(
      "UPDATE billing_payment_intents SET status = 'completed', error = NULL, updated_at = datetime('now') " +
        "WHERE id = ? AND tenant_id = ? AND edition = ? AND status = 'redirected'",
    )
      .bind(intent.id, scope.tenantId, scope.edition)
      .run();
    if (res.meta.changes !== 1) return { outcome: "already_completed", intentId: intent.id, scope };
    await auditStatement(
      env,
      scope,
      provider,
      { action: "payment_completed", summary, detail: confirmation, targetId: intent.id },
      null,
    ).run();
    return { outcome: "granted", intentId: intent.id, scope, credits: 0 };
  }

  const result = await grantCredits(
    env,
    scope,
    {
      delta: credits,
      reason: "purchase",
      // The STATED price, ex-tax — what `0032`'s seeded purchase rows and
      // `issueMissingInvoices` both mean by a ledger amount.
      amountMinor: intent.subtotal_minor,
      currency: intent.currency,
      reference: confirmation.paymentId,
      note: description,
      actorId: intent.actor_id,
    },
    {
      guard: {
        sql:
          "EXISTS (SELECT 1 FROM billing_payment_intents p WHERE p.id = ? AND p.tenant_id = ? " +
          "AND p.edition = ? AND p.status = 'redirected')",
        binds: [intent.id, scope.tenantId, scope.edition],
      },
      also: (entryId) => [
        env.DB.prepare(
          "UPDATE billing_payment_intents SET status = 'completed', error = NULL, updated_at = datetime('now') " +
            "WHERE id = ? AND tenant_id = ? AND edition = ? AND status = 'redirected' " +
            "AND EXISTS (SELECT 1 FROM credit_ledger WHERE id = ?)",
        ).bind(intent.id, scope.tenantId, scope.edition, entryId),
        // The invoice, numbered in the same transaction so the sequence cannot be
        // claimed between the count and the insert by `issueMissingInvoices`. The
        // figures are the INTENT's — what was charged — not today's rate.
        // `inv_<ledger id>` is `issueMissingInvoices`' own id convention, and
        // `UNIQUE (ledger_id)` means that path will now find this row and skip it.
        env.DB.prepare(
          `INSERT INTO billing_invoices (id, ${t.columns}, number, kind, ledger_id, intent_id, description, units, ` +
            "currency, subtotal_minor, tax_minor, total_minor, gst_rate_pct, gst_registration, place_of_supply, " +
            "reference, issued_at) " +
            `SELECT ?, ${t.placeholders}, 'INV-' || strftime('%Y', 'now') || '-' || ` +
            "printf('%04d', (SELECT COUNT(*) FROM billing_invoices v WHERE v.tenant_id = ? AND v.edition = ?) + 1), " +
            "'invoice', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, datetime('now') " +
            "WHERE EXISTS (SELECT 1 FROM credit_ledger WHERE id = ?)",
        ).bind(
          `inv_${entryId}`,
          ...t.binds,
          scope.tenantId,
          scope.edition,
          entryId,
          intent.id,
          description,
          credits,
          intent.currency,
          intent.subtotal_minor,
          intent.tax_minor,
          intent.total_minor,
          intent.gst_rate_pct,
          // The SELLER's registration — V6-INVOICE's rule (`ledger.ts`,
          // `issueMissingInvoices`): never the customer's GSTIN.
          tax.registration,
          confirmation.paymentId,
          entryId,
        ),
        auditStatement(
          env,
          scope,
          provider,
          { action: "payment_completed", summary, detail: { ...confirmation, credits }, targetId: intent.id },
          entryId,
        ),
      ],
    },
  );

  if (!result.granted) {
    // The guard refused: between the read above and the batch, another delivery
    // completed it (D1 serialises the two). Report what the row now says.
    const now = await loadIntent(env, intent.id);
    return now?.status === "completed"
      ? { outcome: "already_completed", intentId: intent.id, scope }
      : { outcome: "needs_review", intentId: intent.id, scope, reason: `intent is ${now?.status ?? "missing"}` };
  }
  return { outcome: "granted", intentId: intent.id, scope, credits };
}

/**
 * The third road to a granted payment, for when the customer's return AND the
 * webhook both went missing — a closed tab, a webhook secret set late. Called
 * when the order is looked at; asks the provider directly and applies what it
 * says. A lookup that fails changes nothing and is retried the next time.
 *
 * Only for an intent this deployment opened with the configured provider and
 * that is still waiting — so it costs one provider call on exactly the orders
 * that need one, and none on every other read.
 */
export async function reconcileIntent(
  env: Env,
  adapter: PaymentAdapter | null,
  intentId: string,
): Promise<FulfilmentOutcome | null> {
  if (!adapter) return null;
  const intent = await loadIntent(env, intentId);
  if (!intent || intent.status !== "redirected" || intent.provider !== adapter.provider || !intent.provider_ref) {
    return null;
  }
  try {
    const confirmation = await adapter.lookup(intent.provider_ref);
    // Not paid yet (or the link is someone else's): nothing to apply.
    if (!confirmation || confirmation.reference !== intent.id) return null;
    return await fulfilPayment(env, adapter.provider, confirmation);
  } catch (err) {
    console.error("payment reconcile:", err);
    return null;
  }
}

/**
 * A checkout that closed with nothing paid (`payment_link.expired` /
 * `.cancelled`). The intent becomes `cancelled` — only if it is still waiting,
 * so a late "expired" can never undo a completed payment.
 */
export async function closeUnpaidIntent(
  env: Env,
  provider: PaymentProvider,
  reference: string,
  providerRef: string,
): Promise<boolean> {
  const intent = await loadIntent(env, reference);
  if (!intent || intent.provider !== provider || intent.provider_ref !== providerRef) return false;
  const scope: TenantScope = { tenantId: intent.tenant_id, edition: intent.edition };
  const res = await env.DB.prepare(
    "UPDATE billing_payment_intents SET status = 'cancelled', updated_at = datetime('now') " +
      "WHERE id = ? AND tenant_id = ? AND edition = ? AND status = 'redirected'",
  )
    .bind(intent.id, scope.tenantId, scope.edition)
    .run();
  if (res.meta.changes !== 1) return false;
  await auditStatement(
    env,
    scope,
    provider,
    {
      action: "payment_link_closed",
      summary: `Checkout closed unpaid — ${intent.plan_name}. Nothing was charged and nothing was granted.`,
      detail: { reference, providerRef },
      targetId: intent.id,
    },
    null,
  ).run();
  return true;
}
