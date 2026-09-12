/**
 * W4-C — Admin console → Organisation → **Credits & billing** (`admin/s-bl.html`).
 *
 * The prototype's section is three tiles, a usage-history list and three buttons
 * (Buy more credits · Download invoice · Upgrade plan). This router is that
 * section's whole read surface plus the three things those buttons need and the
 * prototype never wired: a purchase that records an intent, an invoice document,
 * and the billing cycle / GST settings the amounts are computed under.
 *
 * Two rules govern it.
 *
 * **§1.2 — card data never reaches this application.** No route here accepts a
 * card number, CVV, expiry or cardholder name, in any field, in any state. The
 * only thing `POST /purchase` takes is *what* is being bought; the instrument is
 * the provider's business, on a page the provider hosts
 * (`src/server/billing/provider.ts`).
 *
 * **§1.3 — interface-complete, provider-stubbed.** A purchase RECORDS its intent
 * in `billing_payment_intents` with `status='recorded'`, exactly as
 * `crm_sync_log` records a sync it did not perform and `email_outbox` records a
 * message it did not send. It grants no credits and activates no plan, and the
 * response says so in as many words. Reporting a recorded intent as a completed
 * payment is the one failure this whole module is shaped to prevent.
 *
 * Metering is untouched and stays where it is: `decks/versions.ts` reserves one
 * credit per evaluation under a conditional UPDATE, and now writes the ledger
 * row for it. Prices are READ from `src/shared/plans.ts`; W4-D writes the
 * catalogue (`/api/pricing`).
 */
import { Hono } from "hono";
import type { AppEnv } from "../types";
import type { Edition } from "../../shared/roles";
import { requireAuth, requireTask } from "../auth/middleware";
// The Billing audit category — the same one W3-C's `recordCreditMovement` writes.
import { changedFragment, recordAudit } from "../audit/log";
import { LOW_CREDIT_THRESHOLD } from "../../shared/notifications";
import {
  formatMinor,
  multiplyMinor,
  priceBreakdown,
  publishablePlans,
  type CreditsBillingView,
  type InvoiceView,
  type PlanGroup,
  type PublishedPlan,
  type TaxSettings,
} from "../../shared/plans";
import {
  issueMissingInvoices,
  listIntents,
  listInvoices,
  listLedger,
  loadInvoice,
  purchasedTotal,
  readBalance,
  readSubscription,
  readTaxSettings,
  usageTotals,
} from "../billing/ledger";
import { paymentConfigured, recordPaymentIntent, type IntentPurpose } from "../billing/provider";

const billing = new Hono<AppEnv>();
billing.use("*", requireAuth);
// The whole Admin console is admin + superuser, gated on the `adminconsole` task
// so that revoking that cell closes the screen AND its API in one place (§8 Q16).
//
// F0043 / F0158 record that the PROTOTYPE shows this section to all eleven roles,
// read-only. That is a nav change plus a read-only contract for two sections, and
// `src/shared/nav.ts` is a serialisation-hazard file this session does not own —
// left open in §8 rather than half-built here.
billing.use("*", requireTask("adminconsole", "admin"));

// ── The published catalogue ──────────────────────────────────────────────────

interface PlanRow {
  code: string;
  plan_group: PlanGroup;
  name: string;
  badge: string | null;
  tagline: string | null;
  features: string | null;
  units: number | null;
  period: string | null;
  amount_minor: number;
  currency: string;
}

/**
 * Active catalogue rows in one currency, stripped of the per-deck derivations
 * §8 Q1 retired (`publishablePlans`). A plan with no price in that currency is
 * omitted rather than converted here — FX is W4-D's screen.
 */
async function readCatalogue(
  c: { env: AppEnv["Bindings"] },
  currency: string,
): Promise<PublishedPlan[]> {
  const res = await c.env.DB.prepare(
    "SELECT p.code, p.plan_group, p.name, p.badge, p.tagline, p.features, p.units, p.period, " +
      "a.amount_minor, a.currency FROM price_plans p JOIN price_amounts a ON a.plan_id = p.id " +
      "WHERE p.active = 1 AND a.currency = ? ORDER BY p.sort_order ASC",
  )
    .bind(currency)
    .all<PlanRow>();
  const plans: PublishedPlan[] = (res.results ?? []).map((r) => ({
    code: r.code,
    group: r.plan_group,
    name: r.name,
    badge: r.badge,
    tagline: r.tagline,
    features: r.features,
    units: r.units,
    period: (r.period as PublishedPlan["period"]) ?? null,
    currency: r.currency,
    amountMinor: r.amount_minor,
  }));
  return publishablePlans(plans);
}

// ── GET / — everything the section renders ───────────────────────────────────

billing.get("/", async (c) => {
  const edition = c.var.user.edition;
  const now = new Date();

  // A paid purchase with no document is a gap a customer notices at audit time.
  // Idempotent, and a no-op on every request after the first.
  await issueMissingInvoices(c.env, edition);

  const subscription = await readSubscription(c.env, edition, now);
  const tax = await readTaxSettings(c.env);
  const usage = await usageTotals(c.env, edition, subscription.cycle, now);

  const view: CreditsBillingView = {
    edition,
    balance: await readBalance(c.env, edition),
    purchased: await purchasedTotal(c.env, edition),
    usedThisMonth: usage.usedThisMonth,
    usedThisCycle: usage.usedThisCycle,
    lowCreditThreshold: LOW_CREDIT_THRESHOLD,
    subscription,
    tax,
    ledger: await listLedger(c.env, edition, 50),
    invoices: await listInvoices(c.env, edition),
    plans: await readCatalogue(c, subscription.currency),
    intents: await listIntents(c.env, edition, 10),
    paymentConfigured: paymentConfigured(c.env),
  };
  return c.json(view);
});

// ── PUT /subscription — billing contact and cycle ────────────────────────────

const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z][Z][0-9A-Z]$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function readBody<T>(c: { req: { json: () => Promise<unknown> } }): Promise<Partial<T>> {
  return ((await c.req.json().catch(() => ({}))) ?? {}) as Partial<T>;
}

billing.put("/subscription", async (c) => {
  const edition: Edition = c.var.user.edition;
  const body = await readBody<{
    billingEmail: string | null;
    gstin: string | null;
    cycleAnchor: string;
    billingPeriod: "month" | "year";
  }>(c);

  const before = await readSubscription(c.env, edition);

  const billingEmail =
    body.billingEmail === undefined ? before.billingEmail : body.billingEmail || null;
  if (billingEmail !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billingEmail)) {
    return c.json({ error: "invalid_email" }, 400);
  }

  const gstin = body.gstin === undefined ? before.gstin : body.gstin || null;
  // A GSTIN that is not one would print on an invoice and make it unusable for
  // input tax credit, which is the whole point of the field.
  if (gstin !== null && !GSTIN.test(gstin.toUpperCase())) {
    return c.json({ error: "invalid_gstin" }, 400);
  }

  const cycleAnchor = body.cycleAnchor ?? before.cycleAnchor;
  if (!DATE.test(cycleAnchor) || Number.isNaN(Date.parse(cycleAnchor))) {
    return c.json({ error: "invalid_cycle_anchor" }, 400);
  }

  const billingPeriod = body.billingPeriod ?? before.cycle.period;
  if (billingPeriod !== "month" && billingPeriod !== "year") {
    return c.json({ error: "invalid_billing_period" }, 400);
  }

  await c.env.DB.prepare(
    "INSERT INTO billing_subscriptions (edition, plan_label, seats, billing_period, cycle_anchor, " +
      "billing_email, gstin, updated_at) VALUES (?, ?, 0, ?, ?, ?, ?, datetime('now')) " +
      "ON CONFLICT (edition) DO UPDATE SET billing_period = excluded.billing_period, " +
      "cycle_anchor = excluded.cycle_anchor, billing_email = excluded.billing_email, " +
      "gstin = excluded.gstin, updated_at = datetime('now')",
  )
    .bind(
      edition,
      before.planLabel,
      billingPeriod,
      cycleAnchor,
      billingEmail,
      gstin?.toUpperCase() ?? null,
    )
    .run();

  const after = await readSubscription(c.env, edition);
  const changes = [
    changedFragment("billing email", before.billingEmail, after.billingEmail, (v) => v ?? "none"),
    changedFragment("GSTIN", before.gstin, after.gstin, (v) => v ?? "none"),
    changedFragment("cycle anchor", before.cycleAnchor, after.cycleAnchor),
    changedFragment("billing period", before.cycle.period, after.cycle.period),
  ].filter((f): f is string => f !== null);
  if (changes.length > 0) {
    await recordAudit(c, {
      category: "billing",
      action: "billing_details_updated",
      summary: `Billing details updated — ${changes.join("; ")}`,
      detail: { changes },
      targetType: "billing_subscriptions",
      targetId: edition,
    });
  }
  return c.json({ ok: true, subscription: after });
});

// ── POST /purchase — records an intent; charges nothing ──────────────────────

const PURPOSE_OF_GROUP: Record<PlanGroup, IntentPurpose | null> = {
  credit_pack: "credit_pack",
  subscription: "subscription",
  enterprise: "enterprise",
  // The free trial is granted, not bought.
  free_trial: null,
};

billing.post("/purchase", async (c) => {
  const edition = c.var.user.edition;
  const body = await readBody<{ planCode: string; quantity: number }>(c);

  const planCode = typeof body.planCode === "string" ? body.planCode : "";
  if (!planCode) return c.json({ error: "plan_required" }, 400);

  const quantity = body.quantity === undefined ? 1 : Number(body.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
    return c.json({ error: "invalid_quantity" }, 400);
  }

  const subscription = await readSubscription(c.env, edition);
  const tax = await readTaxSettings(c.env);
  const plan = (await readCatalogue(c, subscription.currency)).find((p) => p.code === planCode);
  if (!plan) return c.json({ error: "unknown_plan" }, 404);

  const purpose = PURPOSE_OF_GROUP[plan.group];
  if (!purpose) return c.json({ error: "plan_not_purchasable" }, 400);

  const stated = multiplyMinor(plan.amountMinor, quantity);
  if (stated <= 0) return c.json({ error: "plan_not_purchasable" }, 400);
  const money = priceBreakdown(stated, tax, plan.currency);

  const intent = await recordPaymentIntent(c.env, {
    edition,
    purpose,
    planCode: plan.code,
    planName: plan.name,
    units: plan.units,
    quantity,
    currency: plan.currency,
    money,
    actorId: c.var.user.id,
  });

  await recordAudit(c, {
    category: "billing",
    action: "billing_intent_recorded",
    summary:
      `Purchase intent recorded — ${quantity} × ${plan.name} · ` +
      `${formatMinor(money.totalMinor, plan.currency)} incl. GST · no payment taken`,
    detail: {
      intentId: intent.id,
      planCode: plan.code,
      quantity,
      status: intent.status,
    },
    targetType: "billing_payment_intents",
    targetId: intent.id,
  });

  // The contract, spelled out in the payload so no client can misreport it: the
  // intent is RECORDED, no payment has been taken, and no credits were granted.
  return c.json({
    ok: true,
    intent,
    completed: false,
    creditsGranted: 0,
    checkout: intent.checkoutUrl
      ? { hosted: true, url: intent.checkoutUrl }
      : { hosted: false, url: null },
    message: intent.checkoutUrl
      ? "Continue on the payment provider's own page to complete this purchase."
      : "Purchase intent recorded. No payment provider is configured, so nothing has been " +
        "charged and no credits have been added — our team will follow up to complete it.",
  });
});

// ── Invoices ─────────────────────────────────────────────────────────────────

billing.get("/invoices/:id", async (c) => {
  const invoice = await loadInvoice(c.env, c.var.user.edition, c.req.param("id"));
  if (!invoice) return c.json({ error: "not_found" }, 404);
  return c.json(invoice);
});

const escapeHtml = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch,
  );

function invoiceDocument(
  invoice: InvoiceView,
  org: { name: string; gstin: string | null; email: string | null },
  tax: TaxSettings,
): string {
  const row = (label: string, value: string) =>
    `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`;
  const amount = (m: number) => formatMinor(m, invoice.currency);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${escapeHtml(invoice.number)}</title>
<style>
 body{font:13px/1.5 -apple-system,"Segoe UI",sans-serif;color:#1A1E2E;margin:40px;max-width:640px}
 h1{font-size:18px;margin:0 0 2px} .sub{color:#6B6355;font-size:12px;margin:0 0 24px}
 table{border-collapse:collapse;width:100%;margin-bottom:20px}
 th,td{text-align:left;padding:6px 0;border-bottom:1px solid #E8E3D9;vertical-align:top}
 th{font-weight:600;color:#6B6355;width:200px}
 .tot td,.tot th{border-bottom:none;font-weight:700;font-size:15px}
 .note{color:#6B6355;font-size:11.5px;border-top:1px solid #E8E3D9;padding-top:12px}
</style></head><body>
<h1>Tax invoice ${escapeHtml(invoice.number)}</h1>
<p class="sub">${escapeHtml(org.name)}${org.gstin ? ` · GSTIN ${escapeHtml(org.gstin)}` : ""}</p>
<table>
${row("Issued", invoice.issuedAt.slice(0, 10))}
${row("Billed to", org.email ?? "—")}
${invoice.registration ? row("Our GST registration", invoice.registration) : ""}
${row("Description", invoice.description)}
${invoice.units !== null ? row("Credits", String(invoice.units)) : ""}
${row("Subtotal", amount(invoice.subtotalMinor))}
${row(`GST (${invoice.ratePct}%)`, amount(invoice.taxMinor))}
<tr class="tot"><th>Total</th><td>${escapeHtml(amount(invoice.totalMinor))}</td></tr>
</table>
<p class="note">GST-compliant invoice · suitable for input tax credit.
${invoice.reference ? `Transaction ID: ${escapeHtml(invoice.reference)}.` : ""}
${tax.inclusive ? "Prices are inclusive of GST." : "GST added at checkout."}</p>
</body></html>`;
}

/**
 * The document behind "Download invoice". Printable HTML rather than a generated
 * PDF: a PDF writer is a dependency on the critical path for a page a browser
 * already prints, and §1.3's rule about vendors on this lane is the same rule.
 */
billing.get("/invoices/:id/document", async (c) => {
  const edition = c.var.user.edition;
  const invoice = await loadInvoice(c.env, edition, c.req.param("id"));
  if (!invoice) return c.json({ error: "not_found" }, 404);
  const subscription = await readSubscription(c.env, edition);
  const tax = await readTaxSettings(c.env);
  const org = await c.env.DB.prepare("SELECT branding_json FROM org_settings WHERE edition = ?")
    .bind(edition)
    .first<{ branding_json: string | null }>();
  let name = edition === "vc" ? "Investor workspace" : "Incubator workspace";
  try {
    const parsed = JSON.parse(org?.branding_json ?? "{}") as {
      orgName?: string;
    };
    if (parsed.orgName) name = parsed.orgName;
  } catch {
    // Branding is free-form JSON written by the Set up wizard; a malformed blob
    // must not stop an invoice being issued.
  }
  const html = invoiceDocument(
    invoice,
    { name, gstin: subscription.gstin, email: subscription.billingEmail },
    tax,
  );
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-disposition": `attachment; filename="${invoice.number}.html"`,
    },
  });
});

export default billing;
