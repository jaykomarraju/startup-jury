// S2-SETUP — the seat bar (`#su-seatbar`) and the **Buy additional seats**
// sub-flow (`#sus-buyseats` → `#sus-buypay` → `#sus-buysuccess`), lifted out of
// `routes/setup/TeamStep.tsx` unchanged so that two screens can host it.
//
// Why it moved. 21-Sep item 7 deletes the Set up wizard's step 4 for the
// incubator super user, and `TeamStep` was the sole importer of
// `purchaseSeats` — deleting the step would have removed the only path to
// buying a seat. §4 Q84 already named the destination: *"Moving 'Buy seats'
// into Team & roles would satisfy the prototype exactly"*. So the flow is here,
// the wizard's step 4 still renders it for the roles that keep that step, and
// Admin console → Team & roles renders it for the super user who no longer has
// one. One implementation, two hosts — not a copy.
//
// The seat here is the PURCHASED one: a per-member plan tier capped per tier
// (`src/shared/seats.ts`). It is not `cohorts.seat_capacity`.
//
// Two rules from the plan shape it, and both are carried over verbatim:
//   §1.2 — the prototype's payment screen draws a card number, expiry and CVV.
//          None of them exist here, in any state. Payment is a provider-hosted
//          page; with no provider configured (every build today) the order is
//          RECORDED and the receipt says so — it never says "Payment successful".
//   Prices — nothing here names an amount. Every figure is read from the
//          published catalogue by `GET /api/seats`, and tax is the server's
//          `priceBreakdown`, re-derived client-side by the same shared function.

import { useState } from "react";
import { ArrowLeft, ArrowRight, CircleCheck, Lock, Plus } from "lucide-react";
import { Button, Card } from "../../components";
import { ApiError } from "../../api";
import { PLANS, PLAN_LABELS, formatMinor } from "../../../shared/plans";
import {
  MAX_SEATS_PER_TIER,
  SEAT_TIERS_DESC,
  seatOrder,
  isSeatOrderError,
  type SeatOrder,
  type SeatPurchaseResult,
  type SeatQuantities,
  type SeatsView,
  type SeatTier,
} from "../../../shared/seats";
import { purchaseSeats } from "../../seatsApi";

const PERIOD_WORD: Record<string, string> = { month: "monthly", year: "annually", one_time: "once" };
const PERIOD_SHORT: Record<string, string> = { month: "month", year: "annual", one_time: "one-time" };

function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (typeof err.body.message === "string") return err.body.message;
    return err.message;
  }
  return "Something went wrong. Try again.";
}

function Money({ minor, currency }: { minor: number; currency: string }) {
  return <span className="font-mono text-fg">{formatMinor(minor, currency)}</span>;
}

/** `#su-seatbar` — totals, the per-tier pills and the "Buy a seat" row. */
export function SeatBar({ view, onBuy }: { view: SeatsView; onBuy: (t: SeatTier) => void }) {
  const byTier = Object.fromEntries(view.tiers.map((t) => [t.tier, t])) as Record<SeatTier, SeatsView["tiers"][number]>;
  return (
    <div className="my-[18px] rounded-xl border border-stone-dk px-4 py-3.5" data-testid="seat-bar">
      <div className="text-[13px] text-fg-2">
        <b className="font-mono text-fg">{view.used}</b> total user{view.used === 1 ? "" : "s"} ·{" "}
        <b className="font-mono text-fg">{view.left}</b> seat{view.left === 1 ? "" : "s"} left for nomination
        {view.over > 0 && (
          <span className="text-gold-dk">
            {" "}
            · {view.over} member{view.over === 1 ? "" : "s"} over your purchased seats
          </span>
        )}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-[18px]">
        {SEAT_TIERS_DESC.map((t) => (
          <span key={t} className="text-xs text-fg-muted" data-testid={`seat-tier-${t}`}>
            <b className="font-semibold text-fg">{PLAN_LABELS[t]}</b> {byTier[t].used} / {byTier[t].capacity}
          </span>
        ))}
      </div>
      <div className="mt-[13px] flex flex-wrap items-center gap-[9px]">
        <span className="text-xs text-fg-muted">Buy a seat:</span>
        {SEAT_TIERS_DESC.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onBuy(t)}
            aria-label={`Buy a ${PLAN_LABELS[t]} seat`}
            className="inline-flex items-center gap-[5px] rounded-lg border border-stone-dk bg-surface px-[13px] py-1.5 text-xs text-fg hover:border-gold hover:text-gold-dk"
          >
            <Plus className="h-3 w-3" /> {PLAN_LABELS[t]}
          </button>
        ))}
      </div>
    </div>
  );
}

function OrderLines({ order, totalLabel }: { order: SeatOrder; totalLabel: string }) {
  return (
    <div className="mb-4 mt-[18px] rounded-xl border border-stone-dk px-4 py-3.5" data-testid="seat-order">
      {order.lines.map((l) => (
        <div key={l.tier} className="flex justify-between py-[5px] text-[13px] text-fg-2">
          <span>
            {PLAN_LABELS[l.tier]} seat × {l.quantity}
          </span>
          <Money minor={l.amountMinor} currency={order.currency} />
        </div>
      ))}
      <div className="flex justify-between py-[5px] text-[13px] text-fg-2">
        <span>{order.money.taxed ? `GST (${order.money.ratePct}%)` : "GST"}</span>
        <span className="font-mono text-fg">
          {order.money.taxed ? formatMinor(order.money.taxMinor, order.currency) : `Not applied · ${order.currency} billing`}
        </span>
      </div>
      <div className="mt-[7px] flex justify-between border-t border-stone pb-[5px] pt-[11px] text-[15px] font-bold text-fg">
        <span>{totalLabel}</span>
        <Money minor={order.money.totalMinor} currency={order.currency} />
      </div>
    </div>
  );
}

/**
 * The three purchase screens. The host renders this INSTEAD of its own content
 * while it is open, exactly as step 4 did, and hides whatever chrome it owns
 * (the wizard hides its stepper, as `suBuyShow` does).
 *
 * `start` is the tier the seat bar was clicked for. A tier the published
 * catalogue does not sell has no price, so it opens the screen with nothing
 * chosen and Continue unavailable — which is the prototype's behaviour and is
 * pinned by a test.
 */
export function BuySeatsFlow({
  view,
  start,
  onSeats,
  onClose,
  backLabel,
}: {
  view: SeatsView;
  start: SeatTier | null;
  /** The purchase's fresh `SeatsView` — the host redraws its roster from it. */
  onSeats: (v: SeatsView) => void;
  onClose: () => void;
  /** The receipt's last button, named for wherever the host returns to. */
  backLabel: string;
}) {
  const byTier = Object.fromEntries(view.tiers.map((t) => [t.tier, t])) as Record<SeatTier, SeatsView["tiers"][number]>;
  const [screenState, setScreenState] = useState<"buyseats" | "buypay" | "buysuccess">("buyseats");
  const screen = screenState;
  /** `suBuyShow` scrolls to the top on every step; each screen is a full card. */
  function setScreen(next: "buyseats" | "buypay" | "buysuccess") {
    setScreenState(next);
    if (typeof document !== "undefined") document.documentElement.scrollTop = 0;
  }
  const [qty, setQty] = useState<Record<SeatTier, number>>(() => {
    const next: Record<SeatTier, number> = { standard: 0, pro: 0, premium: 0 };
    if (start && byTier[start]?.price) next[start] = 1;
    return next;
  });
  const [receipt, setReceipt] = useState<SeatPurchaseResult | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const prices = Object.fromEntries(view.tiers.map((t) => [t.tier, t.price])) as Parameters<typeof seatOrder>[1];
  const order = seatOrder(qty, prices, view.tax, view.currency);
  const quote: SeatOrder | null = isSeatOrderError(order) ? null : order;
  const selected = PLANS.reduce((n, t) => n + qty[t], 0);

  async function place() {
    if (!quote || busy) return;
    setBusy(true);
    setPayError(null);
    try {
      const quantities: SeatQuantities = {};
      for (const t of PLANS) if (qty[t] > 0) quantities[t] = qty[t];
      const res = await purchaseSeats(quantities);
      setReceipt(res);
      onSeats(res.seats);
      if (res.intent.status === "redirected" && res.intent.checkoutUrl) {
        // A provider-hosted page. The customer's card goes there, never here.
        window.location.assign(res.intent.checkoutUrl);
        return;
      }
      setScreen("buysuccess");
    } catch (err) {
      setPayError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  // ── Buy additional seats ───────────────────────────────────────────────────
  if (screen === "buyseats") {
    const periods = new Set(view.tiers.map((t) => t.price?.period).filter(Boolean));
    const billed = periods.size === 1 ? PERIOD_WORD[[...periods][0] as string] : null;
    return (
      <Card>
        <h2 className="text-[23px] font-bold leading-tight text-fg">Buy additional seats</h2>
        <p className="mt-1 text-[13.5px] text-fg-muted">
          Add seats to your account. Choose how many of each plan you need
          {billed ? ` — each seat is billed ${billed}.` : "."}
        </p>
        <div className="mt-5">
          {PLANS.map((t) => {
            const price = byTier[t].price;
            return (
              <div key={t} className="mb-[11px] flex items-center justify-between gap-3.5 rounded-xl border border-stone-dk px-4 py-3.5">
                <div>
                  <div className="text-sm font-bold text-fg">{PLAN_LABELS[t]}</div>
                  {price ? (
                    <div className="mt-0.5 text-[12.5px] font-semibold text-gold-dk">
                      {formatMinor(price.amountMinor, price.currency)}{" "}
                      <span className="font-normal text-fg-muted">
                        / seat{price.period ? ` · ${PERIOD_SHORT[price.period]}` : ""}
                      </span>
                    </div>
                  ) : (
                    <div className="mt-0.5 text-[12.5px] text-fg-muted">Not offered in the published price list</div>
                  )}
                </div>
                <label className="flex shrink-0 items-center gap-2 text-[11.5px] font-semibold text-fg-muted">
                  Seats
                  <select
                    aria-label={`${PLAN_LABELS[t]} seats`}
                    className="sj-input h-9 w-[90px] disabled:opacity-50"
                    value={qty[t]}
                    disabled={!price}
                    onChange={(e) => setQty((q) => ({ ...q, [t]: Number(e.target.value) }))}
                  >
                    {Array.from({ length: MAX_SEATS_PER_TIER + 1 }, (_, i) => (
                      <option key={i} value={i}>
                        {i}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            );
          })}
        </div>
        <div className="mt-1.5 flex items-center justify-between border-t border-stone pt-[15px] text-[13px] text-fg-2">
          <span data-testid="seat-buy-summary">
            {selected} seat{selected === 1 ? "" : "s"} selected ·{" "}
            {view.currency !== "INR" ? `no GST (${view.currency} billing)` : `incl. ${view.tax.ratePct}% GST`}
          </span>
          <b className="font-mono text-[19px] text-fg" data-testid="seat-buy-total">
            {formatMinor(quote?.money.totalMinor ?? 0, view.currency)}
          </b>
        </div>
        <div className="mt-[26px] flex items-center justify-between gap-3">
          <Button variant="secondary" onClick={onClose}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <Button onClick={() => setScreen("buypay")} disabled={!quote}>
            Continue to payment <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </Card>
    );
  }

  // ── Complete payment — a provider page, never a card form ──────────────────
  if (screen === "buypay" && quote) {
    const total = formatMinor(quote.money.totalMinor, quote.currency);
    return (
      <Card data-testid="seat-pay">
        <h2 className="text-[23px] font-bold leading-tight text-fg">Complete payment</h2>
        <p className="mt-1 text-[13.5px] text-fg-muted">Review your seat purchase and pay securely.</p>
        <OrderLines order={quote} totalLabel={`Total${quote.period ? ` · ${PERIOD_SHORT[quote.period]}` : ""}`} />
        <div className="flex items-start gap-2.5 rounded-xl border border-stone-dk bg-offwhite px-4 py-3 text-[12.5px] text-fg-2">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-olive-dk" />
          <div>
            <p>
              Payment is taken on the payment provider’s own secure page. Card details are never entered into, sent to
              or stored by this application.
            </p>
            {!view.paymentConfigured && (
              <p className="mt-1.5 text-fg-muted">
                No payment provider is connected to this workspace yet, so this order will be recorded and nothing will
                be charged. Our team follows up to invoice it.
              </p>
            )}
          </div>
        </div>
        {payError && (
          <p role="alert" className="mt-3 text-[12.5px] text-red">
            {payError}
          </p>
        )}
        <div className="mt-[26px] flex items-center justify-between gap-3">
          <Button variant="secondary" onClick={() => setScreen("buyseats")}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <Button onClick={place} disabled={busy}>
            <Lock className="h-4 w-4" /> {view.paymentConfigured ? `Pay ${total}` : `Place order ${total}`}
          </Button>
        </div>
      </Card>
    );
  }

  // ── The receipt — "recorded", never "paid" ─────────────────────────────────
  if (screen === "buysuccess" && receipt) {
    const r = receipt;
    const added = PLANS.reduce((n, t) => n + r.seatsGranted[t], 0);
    const total = formatMinor(r.order.money.totalMinor, r.order.currency);
    return (
      <Card className="text-center">
        <div className="mx-auto mb-3.5 mt-1.5 flex h-16 w-16 items-center justify-center rounded-full bg-green-lt text-green">
          <CircleCheck className="h-9 w-9" />
        </div>
        <h2 className="text-[23px] font-bold leading-tight text-fg">
          {r.intent.status === "failed" ? "Order not placed" : added > 0 ? "Seats added" : "Order recorded"}
        </h2>
        <p className="mt-1 text-[13.5px] text-fg-muted">
          {added > 0
            ? `${added} new seat${added === 1 ? "" : "s"} added to your account · ${total} recorded — no payment has been taken.`
            : r.message}
        </p>
        <div className="mx-auto mb-1 mt-4 max-w-[420px] rounded-[11px] bg-offwhite px-4 py-2 text-left">
          {r.order.lines.map((l) => (
            <div key={l.tier} className="flex justify-between py-[5px] text-[13px] text-fg-2">
              <span>
                {PLAN_LABELS[l.tier]} × {l.quantity}
              </span>
              <Money minor={l.amountMinor} currency={r.order.currency} />
            </div>
          ))}
          {r.order.money.taxed && (
            <div className="flex justify-between py-[5px] text-[13px] text-fg-2">
              <span>GST ({r.order.money.ratePct}%)</span>
              <Money minor={r.order.money.taxMinor} currency={r.order.currency} />
            </div>
          )}
          <div className="mt-[7px] flex justify-between border-t border-stone pb-[5px] pt-[11px] text-[15px] font-bold text-fg">
            <span>Recorded · not charged</span>
            <Money minor={r.order.money.totalMinor} currency={r.order.currency} />
          </div>
        </div>
        <p className="mx-auto mt-3 max-w-[420px] text-[12px] text-fg-muted">{r.message}</p>
        <p className="mt-1 font-mono text-[11px] text-fg-muted">Reference {r.intent.id}</p>
        <div className="mt-[26px] flex justify-end">
          <Button onClick={onClose}>
            {backLabel} <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </Card>
    );
  }

  // `buypay` with no quote is unreachable from the screen above (Continue is
  // disabled without one) but is drawn rather than rendering nothing, because
  // a blank card with no way out would be the worse failure.
  return (
    <Card>
      <p className="text-sm text-fg-muted">Nothing selected.</p>
      <div className="mt-[26px] flex justify-end">
        <Button onClick={onClose}>
          {backLabel} <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );
}
