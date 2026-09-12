import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { CalendarClock, Coins, FileText, Receipt, ShoppingCart } from "lucide-react";
import { Card, Button } from "../../components";
import { useAdminSave } from "./saveContext";
import {
  LEDGER_REASON_LABELS,
  formatMinor,
  multiplyMinor,
  priceBreakdown,
  type CreditsBillingView,
  type InvoiceView,
  type LedgerEntryView,
  type PaymentIntentView,
  type PublishedPlan,
  type TaxSettings,
} from "../../../shared/plans";

/**
 * Admin console → Organisation → **Credits & billing** (`admin/s-bl.html`).
 *
 * The prototype's section is a `.bs-grid` of three tiles (Credits remaining ·
 * Used this month · Current plan), a "Usage history" card of `.u-row` lines, and
 * three buttons — Buy more credits · Download invoice · Upgrade plan — none of
 * which is wired to anything. This is that section with the three actions made
 * real, plus the billing cycle and GST the amounts are computed under.
 *
 * **Two things are deliberately NOT what the prototype draws.**
 *
 * §1.2 — a purchase never asks for a card. There is no PAN, CVV, expiry or
 * cardholder field in this component, in any state, and nothing it posts could
 * carry one. Checkout is a page the PROVIDER hosts; with none configured the
 * purchase records an intent and says, in as many words, that nothing has been
 * charged and no credits have been added (§1.3).
 *
 * §8 Q1, ruled 2026-09-11 — there is no per-deck price. The prototype's usage
 * lines read "1 credit · ₹999 · 4 Jun 2026" and its tile "₹2,997 consumed";
 * both are derived from a per-deck rate the client has retired, so the rate is
 * gone from the rows, from the tile, and from the catalogue this screen renders.
 * A deck still costs exactly one credit — that is usage accounting, not a price.
 */

// ── The prototype's `.bs` tile ───────────────────────────────────────────────

function StatTile({
  label,
  value,
  sub,
  tone,
  small,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "good" | "warn";
  small?: boolean;
}) {
  // `.bs-val.g{color:var(--green)}` / `.bs-val.a{color:#854F0B}`.
  const color =
    tone === "good" ? "var(--color-green)" : tone === "warn" ? "#854F0B" : "var(--color-navy)";
  return (
    <div className="rounded-lg bg-bg px-[13px] py-[11px]">
      <div className="text-label font-bold uppercase tracking-[0.06em] text-fg-muted">{label}</div>
      <div
        className={`font-mono font-bold leading-[1.2] tracking-[-0.02em] ${small ? "text-[16px]" : "text-[22px]"}`}
        style={{ color }}
      >
        {value}
      </div>
      <div className="mt-[1px] text-[10px] text-fg-muted">{sub}</div>
    </div>
  );
}

function CardTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-fg">
      <span style={{ color: "var(--ac-olive, #4A6644)" }}>{icon}</span>
      {children}
    </div>
  );
}

/** The prototype's `.u-row`: a sentence left, a mono meta string right. */
function UsageRow({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-bg py-[7px] text-[12px] last:border-b-0">
      <span className="min-w-0 truncate text-fg-2">{left}</span>
      <span className="shrink-0 font-mono text-[11px] text-fg-muted">{right}</span>
    </div>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "4 Jun 2026" — the prototype's date format. */
export function shortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

const LONG_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function monthLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  return m ? `${LONG_MONTHS[Number(m[2]) - 1]} ${m[1]}` : iso;
}

/** The credits column of a ledger row: "+50 credits" / "1 credit". */
function creditsText(delta: number): string {
  const n = Math.abs(delta);
  const unit = n === 1 ? "credit" : "credits";
  return delta > 0 ? `+${n} ${unit}` : `${n} ${unit}`;
}

/** The right-hand meta of a usage row. Money only where money moved (§8 Q1). */
function ledgerMeta(entry: LedgerEntryView): string {
  const parts = [creditsText(entry.delta)];
  if (entry.amountMinor !== null && entry.currency) {
    parts.push(formatMinor(entry.amountMinor, entry.currency));
  }
  parts.push(shortDate(entry.createdAt));
  return parts.join(" · ");
}

// ── The purchase panel ───────────────────────────────────────────────────────

interface PurchaseResult {
  intent: PaymentIntentView;
  completed: boolean;
  creditsGranted: number;
  checkout: { hosted: boolean; url: string | null };
  message: string;
}

function PlanOption({
  plan,
  tax,
  quantity,
  selected,
  onSelect,
}: {
  plan: PublishedPlan;
  tax: TaxSettings;
  quantity: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const money = priceBreakdown(multiplyMinor(plan.amountMinor, quantity), tax, plan.currency);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex w-full items-start justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
        selected ? "border-olive bg-olive-lt" : "border-line bg-surface hover:bg-surface-2"
      }`}
    >
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="text-[12.5px] font-semibold text-fg">{plan.name}</span>
          {plan.badge && (
            <span className="rounded-full bg-gold-lt px-2 py-[1px] text-[10px] font-semibold text-gold-dk">
              {plan.badge}
            </span>
          )}
        </span>
        {plan.units !== null && (
          <span className="mt-[2px] block text-[11px] text-fg-muted">
            {plan.units} credit{plan.units === 1 ? "" : "s"}
            {plan.period === "year" ? " · annual" : plan.period === "month" ? " · monthly" : ""}
          </span>
        )}
        {plan.features && (
          <span className="mt-[2px] block text-[11px] text-fg-muted">{plan.features}</span>
        )}
      </span>
      <span className="shrink-0 text-right">
        <span className="block font-mono text-[13px] font-semibold text-fg">
          {formatMinor(money.totalMinor, plan.currency)}
        </span>
        <span className="block text-[10px] text-fg-muted">incl. {money.ratePct}% GST</span>
      </span>
    </button>
  );
}

function GstBreakdown({
  plan,
  tax,
  quantity,
}: {
  plan: PublishedPlan;
  tax: TaxSettings;
  quantity: number;
}) {
  const money = priceBreakdown(multiplyMinor(plan.amountMinor, quantity), tax, plan.currency);
  const line = (label: string, value: string, strong?: boolean) => (
    <div
      className={`flex items-center justify-between py-[3px] text-[11.5px] ${strong ? "border-t border-line pt-[6px] font-semibold text-fg" : "text-fg-2"}`}
    >
      <span>{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
  return (
    <div className="rounded-lg bg-bg px-3 py-2">
      {line("Subtotal", formatMinor(money.subtotalMinor, plan.currency))}
      {money.taxed && line(`GST (${money.ratePct}%)`, formatMinor(money.taxMinor, plan.currency))}
      {line("Total", formatMinor(money.totalMinor, plan.currency), true)}
      <p className="mt-1.5 text-[10.5px] text-fg-muted">
        GST-compliant invoice provided · suitable for input tax credit.
        {tax.registration ? ` GST registration: ${tax.registration}.` : ""}
      </p>
      {tax.internationalNotice && plan.currency !== "INR" && (
        <p className="mt-1 text-[10.5px] text-fg-muted">
          Excludes local taxes — customers are responsible for local VAT/GST.
        </p>
      )}
    </div>
  );
}

// ── The section ──────────────────────────────────────────────────────────────

interface Draft {
  billingEmail: string;
  gstin: string;
  cycleAnchor: string;
  billingPeriod: "month" | "year";
}

function draftOf(view: CreditsBillingView): Draft {
  return {
    billingEmail: view.subscription.billingEmail ?? "",
    gstin: view.subscription.gstin ?? "",
    cycleAnchor: view.subscription.cycleAnchor,
    billingPeriod: view.subscription.cycle.period,
  };
}

const SAVE_ERRORS: Record<string, string> = {
  invalid_email: "That billing email doesn't look like an email address.",
  invalid_gstin: "That GSTIN isn't valid — 15 characters, e.g. 29ABCDE1234F1Z5.",
  invalid_cycle_anchor: "Choose a billing cycle start date.",
  invalid_billing_period: "Choose a monthly or annual billing period.",
};

type Panel = "credits" | "plan" | null;

export function CreditsBillingSection() {
  const [view, setView] = useState<CreditsBillingView | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PurchaseResult | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async (resetDraft?: boolean) => {
    try {
      const r = await fetch("/api/billing", { credentials: "include" });
      if (!r.ok) throw new Error(`billing: ${r.status}`);
      const payload = (await r.json()) as CreditsBillingView;
      setView(payload);
      // Never blanket-overwrite the draft: a refresh can land mid-edit, and
      // StrictMode double-invokes the mount effect.
      setDraft((prev) => (prev === null || resetDraft ? draftOf(payload) : prev));
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(() => {
    if (!view || !draft) return false;
    const base = draftOf(view);
    return (
      base.billingEmail !== draft.billingEmail ||
      base.gstin !== draft.gstin ||
      base.cycleAnchor !== draft.cycleAnchor ||
      base.billingPeriod !== draft.billingPeriod
    );
  }, [view, draft]);

  const save = useCallback(async () => {
    if (!draft) return;
    setBusy("save");
    setError(null);
    setNote(null);
    try {
      const r = await fetch("/api/billing/subscription", {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          billingEmail: draft.billingEmail.trim() || null,
          gstin: draft.gstin.trim().toUpperCase() || null,
          cycleAnchor: draft.cycleAnchor,
          billingPeriod: draft.billingPeriod,
        }),
      });
      const payload = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(payload.error ?? "save_failed");
      await load(true);
      setNote("Billing details saved.");
    } catch (e) {
      const key = e instanceof Error ? e.message : "";
      setError(SAVE_ERRORS[key] ?? "Couldn't save the billing details.");
    } finally {
      setBusy(null);
    }
  }, [draft, load]);

  useAdminSave({
    dirty,
    saving: busy === "save",
    hint: "No billing changes to save",
    onSave: save,
  });

  const openPanel = useCallback((which: Exclude<Panel, null>, plans: PublishedPlan[]) => {
    setPanel(which);
    setResult(null);
    setError(null);
    setNote(null);
    setQuantity(1);
    setChosen(plans[0]?.code ?? null);
  }, []);

  const purchase = useCallback(
    async (planCode: string) => {
      setBusy("purchase");
      setError(null);
      setNote(null);
      try {
        const r = await fetch("/api/billing/purchase", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ planCode, quantity }),
        });
        const payload = (await r.json().catch(() => ({}))) as PurchaseResult & {
          error?: string;
        };
        if (!r.ok) throw new Error(payload.error ?? "purchase_failed");
        setResult(payload);
        await load();
      } catch (e) {
        setError(
          e instanceof Error && e.message === "unknown_plan"
            ? "That plan is no longer in the price list."
            : "Couldn't record the purchase.",
        );
      } finally {
        setBusy(null);
      }
    },
    [quantity, load],
  );

  const heading = (
    <div>
      <h2 className="text-base font-semibold tracking-tight text-fg">Credits &amp; billing</h2>
      <p className="mt-0.5 max-w-3xl text-[13px] text-fg-muted">
        Monitor your credit balance, usage history, and manage your plan and invoices.
      </p>
    </div>
  );

  if (loadError) {
    return (
      <div className="flex flex-col gap-3">
        {heading}
        <Card>
          <p className="text-[13px] text-fg-muted">
            Couldn&rsquo;t load your credits and billing.{" "}
            <button className="text-olive underline" onClick={() => void load()}>
              Retry
            </button>
          </p>
        </Card>
      </div>
    );
  }

  if (!view || !draft) {
    return (
      <div className="flex flex-col gap-3">
        {heading}
        <Card>
          <p className="text-[13px] text-fg-muted">Loading credits and billing&hellip;</p>
        </Card>
      </div>
    );
  }

  const { subscription, tax } = view;
  const packs = view.plans.filter((p) => p.group === "credit_pack");
  const planUpgrades = view.plans.filter(
    (p) => p.group === "subscription" || p.group === "enterprise",
  );
  const panelPlans = panel === "credits" ? packs : planUpgrades;
  const selected = panelPlans.find((p) => p.code === chosen) ?? panelPlans[0] ?? null;
  const latestInvoice: InvoiceView | undefined = view.invoices[0];
  const low = view.balance < view.lowCreditThreshold;

  return (
    <div className="flex flex-col gap-3">
      {heading}

      {/* `.bs-grid` — three tiles. */}
      <div className="grid grid-cols-1 gap-[9px] sm:grid-cols-2 lg:grid-cols-3">
        <StatTile
          label="Credits remaining"
          value={String(view.balance)}
          sub={`of ${view.purchased} purchased`}
          tone={low ? "warn" : "good"}
        />
        <StatTile
          label="Used this month"
          value={String(view.usedThisMonth)}
          sub={`in ${monthLabel(new Date().toISOString())}`}
          tone="warn"
        />
        <StatTile
          label="Current plan"
          value={subscription.planLabel}
          sub={
            [
              subscription.tierLabel,
              subscription.seats > 0
                ? `${subscription.seats} seat${subscription.seats === 1 ? "" : "s"}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ") || "No seats allocated"
          }
          small
        />
      </div>

      {low && (
        <p className="rounded-lg bg-warn-lt px-3 py-2 text-[11.5px] text-warn">
          Balance is below the {view.lowCreditThreshold}-credit warning line. Top up before the next
          upload is refused.
        </p>
      )}

      {/* "Usage history" — the ledger. */}
      <Card>
        <CardTitle icon={<Receipt className="h-[13px] w-[13px]" />}>Usage history</CardTitle>
        {view.ledger.length === 0 ? (
          <p className="py-6 text-center text-[12px] text-fg-muted">
            No credit movements yet. Every evaluation, purchase and refund appears here.
          </p>
        ) : (
          <div>
            {view.ledger.map((entry) => (
              <UsageRow
                key={entry.id}
                left={
                  <>
                    {entry.description}
                    {entry.reason !== "deck_evaluated" && (
                      <span className="ml-1.5 text-[10.5px] text-fg-muted">
                        ({LEDGER_REASON_LABELS[entry.reason]})
                      </span>
                    )}
                  </>
                }
                right={ledgerMeta(entry)}
              />
            ))}
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="primary" onClick={() => openPanel("credits", packs)}>
            <ShoppingCart className="h-3 w-3" />
            Buy more credits
          </Button>
          <Button
            size="sm"
            disabled={!latestInvoice}
            title={latestInvoice ? undefined : "No invoice has been issued yet"}
            onClick={() => {
              if (latestInvoice) {
                window.open(`/api/billing/invoices/${latestInvoice.id}/document`, "_blank");
              }
            }}
          >
            <FileText className="h-3 w-3" />
            Download invoice
          </Button>
          <Button size="sm" onClick={() => openPanel("plan", planUpgrades)}>
            <Coins className="h-3 w-3" />
            Upgrade plan
          </Button>
        </div>
      </Card>

      {/* Buy credits / Upgrade plan. No card field, ever (§1.2). */}
      {panel !== null && (
        <Card>
          <CardTitle icon={<ShoppingCart className="h-[13px] w-[13px]" />}>
            {/* Named distinctly from the button that opens it: two controls with
                the same words is ambiguous to a screen reader and to a test. */}
            {panel === "credits" ? "Choose a credit pack" : "Choose a plan"}
          </CardTitle>
          {panelPlans.length === 0 ? (
            <p className="text-[12px] text-fg-muted">
              No {panel === "credits" ? "credit packs" : "plans"} are published yet. Publish the
              price list in Price configuration first.
            </p>
          ) : result ? (
            <div className="flex flex-col gap-2">
              {/* A recorded intent, reported as exactly that. */}
              <div className="rounded-lg bg-bg px-3 py-2.5">
                <p className="text-[12.5px] font-semibold text-fg">
                  {result.completed ? "Payment complete" : "Purchase intent recorded"}
                </p>
                <p className="mt-1 text-[11.5px] text-fg-2">{result.message}</p>
                <div className="mt-2 grid gap-[3px] text-[11.5px] text-fg-2">
                  <div className="flex justify-between">
                    <span>Plan</span>
                    <span className="font-mono">
                      {result.intent.quantity} × {result.intent.planName}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Amount</span>
                    <span className="font-mono">
                      {formatMinor(result.intent.totalMinor, result.intent.currency)} (incl. GST)
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Status</span>
                    <span className="font-mono">{result.intent.status}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Credits added</span>
                    <span className="font-mono">{result.creditsGranted}</span>
                  </div>
                </div>
              </div>
              {result.checkout.hosted && result.checkout.url && (
                <a
                  className="text-[11.5px] text-olive underline"
                  href={result.checkout.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  Continue to the payment provider
                </a>
              )}
              <div>
                <Button size="sm" onClick={() => setPanel(null)}>
                  Close
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-1.5">
                {panelPlans.map((plan) => (
                  <PlanOption
                    key={plan.code}
                    plan={plan}
                    tax={tax}
                    quantity={quantity}
                    selected={selected?.code === plan.code}
                    onSelect={() => setChosen(plan.code)}
                  />
                ))}
              </div>
              {panel === "credits" && (
                <label className="flex items-center gap-2 text-[11.5px] text-fg-2">
                  Quantity
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={quantity}
                    onChange={(e) =>
                      setQuantity(Math.max(1, Math.min(100, Number(e.target.value) || 1)))
                    }
                    className="w-16 rounded-md border border-line bg-surface px-2 py-1 font-mono text-[11.5px] text-fg"
                  />
                </label>
              )}
              {selected && <GstBreakdown plan={selected} tax={tax} quantity={quantity} />}
              <p className="text-[10.5px] text-fg-muted">
                Payment is completed on our provider&rsquo;s own secure page — card details are
                never entered into or stored by ai.STARTUPJURY.
                {!view.paymentConfigured &&
                  " No provider is connected yet, so this records your request and our team follows up."}
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!selected || busy === "purchase"}
                  onClick={() => selected && void purchase(selected.code)}
                >
                  {busy === "purchase" ? "Recording…" : "Continue to secure checkout"}
                </Button>
                <Button size="sm" onClick={() => setPanel(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Billing cycle + GST + the billing contact. */}
      <Card>
        <CardTitle icon={<CalendarClock className="h-[13px] w-[13px]" />}>Billing cycle</CardTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-[3px] text-[11.5px] text-fg-2">
            <div className="flex justify-between gap-3">
              <span>Current cycle</span>
              <span className="font-mono text-fg">
                {shortDate(subscription.cycle.start)} – {shortDate(subscription.cycle.end)}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span>Renews</span>
              <span className="font-mono text-fg">{shortDate(subscription.cycle.renewsOn)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span>Used this cycle</span>
              <span className="font-mono text-fg">
                {view.usedThisCycle} credit{view.usedThisCycle === 1 ? "" : "s"}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span>GST</span>
              <span className="font-mono text-fg">
                {tax.ratePct}% · {tax.inclusive ? "inclusive" : "added at checkout"}
              </span>
            </div>
            {tax.registration && (
              <div className="flex justify-between gap-3">
                <span>Our GST registration</span>
                <span className="font-mono text-fg">{tax.registration}</span>
              </div>
            )}
          </div>
          <div className="grid gap-2">
            <label className="grid gap-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-fg-muted">
              Billing email
              <input
                value={draft.billingEmail}
                onChange={(e) => setDraft({ ...draft, billingEmail: e.target.value })}
                placeholder="accounts@example.com"
                className="rounded-md border border-line bg-surface px-2 py-1.5 text-[12px] font-normal normal-case tracking-normal text-fg"
              />
            </label>
            <label className="grid gap-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-fg-muted">
              Your GSTIN
              <input
                value={draft.gstin}
                onChange={(e) => setDraft({ ...draft, gstin: e.target.value })}
                placeholder="29ABCDE1234F1Z5"
                className="rounded-md border border-line bg-surface px-2 py-1.5 font-mono text-[12px] font-normal normal-case tracking-normal text-fg"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-fg-muted">
                Cycle starts
                <input
                  type="date"
                  value={draft.cycleAnchor}
                  onChange={(e) => setDraft({ ...draft, cycleAnchor: e.target.value })}
                  className="rounded-md border border-line bg-surface px-2 py-1.5 text-[12px] font-normal normal-case tracking-normal text-fg"
                />
              </label>
              <label className="grid gap-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-fg-muted">
                Period
                <select
                  value={draft.billingPeriod}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      billingPeriod: e.target.value as "month" | "year",
                    })
                  }
                  className="rounded-md border border-line bg-surface px-2 py-1.5 text-[12px] font-normal normal-case tracking-normal text-fg"
                >
                  <option value="month">Monthly</option>
                  <option value="year">Annual</option>
                </select>
              </label>
            </div>
          </div>
        </div>
      </Card>

      {/* Invoices and receipts. */}
      <Card>
        <CardTitle icon={<FileText className="h-[13px] w-[13px]" />}>
          Invoices &amp; receipts
        </CardTitle>
        {view.invoices.length === 0 ? (
          <p className="py-6 text-center text-[12px] text-fg-muted">
            No invoices yet. One is issued for every completed purchase.
          </p>
        ) : (
          <div>
            {view.invoices.map((invoice) => (
              <UsageRow
                key={invoice.id}
                left={
                  <>
                    {invoice.number} — {invoice.description}
                    <a
                      className="ml-2 text-[11px] text-olive underline"
                      href={`/api/billing/invoices/${invoice.id}/document`}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Download
                    </a>
                  </>
                }
                right={`${formatMinor(invoice.totalMinor, invoice.currency)} incl. GST · ${shortDate(invoice.issuedAt)}`}
              />
            ))}
          </div>
        )}
        <p className="mt-2 text-[10.5px] text-fg-muted">
          GST-compliant invoice · suitable for input tax credit.
        </p>
      </Card>

      {/* Recorded purchase intents — audited, never charged (§1.3). */}
      {view.intents.length > 0 && (
        <Card>
          <CardTitle icon={<ShoppingCart className="h-[13px] w-[13px]" />}>
            Recent purchase requests
          </CardTitle>
          <div>
            {view.intents.map((intent) => (
              <UsageRow
                key={intent.id}
                left={
                  <>
                    {intent.quantity} × {intent.planName}
                    <span className="ml-1.5 text-[10.5px] text-fg-muted">
                      ({intent.status === "recorded" ? "recorded · not charged" : intent.status})
                    </span>
                  </>
                }
                right={`${formatMinor(intent.totalMinor, intent.currency)} · ${shortDate(intent.createdAt)}`}
              />
            ))}
          </div>
          <p className="mt-2 text-[10.5px] text-fg-muted">
            A recorded request is not a payment: nothing has been charged and no credits have been
            added.
          </p>
        </Card>
      )}

      {error && <p className="text-[11.5px] text-red">{error}</p>}
      {note && <p className="text-[11.5px] text-green">{note}</p>}
    </div>
  );
}
