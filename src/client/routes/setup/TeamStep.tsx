// W6-C — Set up step 4, **Team** (`#sus-team`), and the **Buy additional
// seats** sub-flow it opens (`#sus-buyseats` → `#sus-buypay` → `#sus-buysuccess`).
//
// The seat on this screen is the PURCHASED one: a per-member plan tier, capped
// per tier (`src/shared/seats.ts`). It is not `cohorts.seat_capacity`.
//
// Two rules from the plan shape it:
//   §1.2 — the prototype's payment screen draws a card number, expiry and CVV.
//          None of them exist here, in any state. Payment is a provider-hosted
//          page; with no provider configured (every build today) the order is
//          RECORDED and the receipt says so — it never says "Payment successful".
//   Prices — nothing here names an amount. Every figure is read from the
//          published catalogue by `GET /api/seats`, and tax is the server's
//          `priceBreakdown`, re-derived client-side by the same shared function.

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpCircle,
  CircleCheck,
  Info,
  Lock,
  Mail,
  Plus,
  Shield,
  ShieldCheck,
  Sparkles,
  User,
  UserPlus,
  Users,
} from "lucide-react";
import { Button, Card, EmptyState } from "../../components";
import { ApiError, updateUser, type ProgramView } from "../../api";
import type { AuthUser } from "../../auth/AuthProvider";
import { PLANS, PLAN_LABELS, PLAN_PRIVILEGES, formatMinor } from "../../../shared/plans";
import {
  MAX_SEATS_PER_TIER,
  SEAT_TIERS_DESC,
  initialsFromEmail,
  isSeatOrderError,
  seatOrder,
  type SeatMemberView,
  type SeatOrder,
  type SeatPurchaseResult,
  type SeatQuantities,
  type SeatsView,
  type SeatTier,
} from "../../../shared/seats";
import { addSeatMember, getSeats, purchaseSeats, setMemberTier } from "../../seatsApi";

/** How much of the wizard a role may edit — `SetupWizard`'s own notion. */
export type WizardSeat = "full" | "cohorts" | "readonly";

type Screen = "team" | "buyseats" | "buypay" | "buysuccess";

const PERIOD_WORD: Record<string, string> = { month: "monthly", year: "annually", one_time: "once" };
const PERIOD_SHORT: Record<string, string> = { month: "month", year: "annual", one_time: "one-time" };

function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (typeof err.body.message === "string") return err.body.message;
    if (err.code === "email_taken") return "That address already belongs to a member of this workspace.";
    if (err.code === "invalid_email") return "Enter a valid work email.";
    return err.message;
  }
  return "Something went wrong. Try again.";
}

function Avatar({ email }: { email: string }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-olive-lt text-xs font-semibold text-olive-dk">
      {initialsFromEmail(email)}
    </span>
  );
}

function TierBadge({ tier }: { tier: SeatTier }) {
  const tone =
    tier === "premium" ? "bg-olive-lt text-olive-dk" : tier === "pro" ? "bg-gold-lt text-gold-dk" : "bg-stone text-fg-2";
  return (
    <span className={`whitespace-nowrap rounded-full px-[11px] py-[3px] text-[11px] font-semibold ${tone}`}>
      {PLAN_LABELS[tier]}
    </span>
  );
}

/** `.su-plantog` — one button per tier, the member's own tier lit. */
function PlanToggle({
  value,
  onChange,
  disabled,
  label,
}: {
  value: SeatTier;
  onChange: (t: SeatTier) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="mt-1.5 inline-flex overflow-hidden rounded-[9px] border border-stone-dk">
      {PLANS.map((t) => (
        <button
          key={t}
          type="button"
          disabled={disabled}
          aria-pressed={value === t}
          onClick={() => value !== t && onChange(t)}
          className={`px-[22px] py-2 text-[12.5px] disabled:cursor-not-allowed ${
            value === t ? "bg-gold-lt font-semibold text-gold-dk" : "bg-surface text-fg-2"
          }`}
        >
          {PLAN_LABELS[t]}
        </button>
      ))}
    </div>
  );
}

function Money({ minor, currency }: { minor: number; currency: string }) {
  return <span className="font-mono text-fg">{formatMinor(minor, currency)}</span>;
}

export function TeamStep({
  user,
  edition,
  seat,
  programs,
  onFinish,
  onFlowChange,
}: {
  user: AuthUser;
  edition: "incubator" | "vc";
  seat: WizardSeat;
  programs: ProgramView[];
  onFinish: () => void;
  /** True while the buy-seats sub-flow is open — the wizard hides its stepper, as `suBuyShow` does. */
  onFlowChange?: (buying: boolean) => void;
}) {
  const manages = seat === "full";
  const [view, setView] = useState<SeatsView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [screen, setScreenState] = useState<Screen>("team");
  const [plan, setPlan] = useState<"enterprise" | "individual">("enterprise");
  const [tab, setTab] = useState<"add" | "all">("add");

  // The add-member draft. The mount fetch only ever FILLS an empty role — never
  // overwrites what someone has already typed or picked (StrictMode runs the
  // effect twice, and the second response can land after the first keystroke).
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [tier, setTier] = useState<SeatTier>("standard");
  const [designation, setDesignation] = useState("");
  const [hint, setHint] = useState<{ text: string; warn: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<{ title: string; body: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [qty, setQty] = useState<Record<SeatTier, number>>({ standard: 0, pro: 0, premium: 0 });
  const [receipt, setReceipt] = useState<SeatPurchaseResult | null>(null);
  const [payError, setPayError] = useState<string | null>(null);

  function setScreen(s: Screen) {
    setScreenState(s);
    onFlowChange?.(s !== "team");
    if (typeof document !== "undefined") document.documentElement.scrollTop = 0;
  }

  function accept(v: SeatsView) {
    setView(v);
    setRole((r) => r || v.roles[0]?.value || "");
  }

  useEffect(() => {
    if (!manages) return;
    let live = true;
    getSeats()
      .then((v) => live && accept(v))
      .catch((err) => live && setLoadError(errorText(err)));
    return () => {
      live = false;
    };
  }, [manages]);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  function showToast(title: string, body: string) {
    setToast({ title, body });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4200);
  }

  // ── A role that does not manage the team ──────────────────────────────────
  if (!manages) {
    return (
      <Card>
        <h2 className="text-[23px] font-bold leading-tight text-fg">Add team members</h2>
        <p className="mt-1 text-[13.5px] text-fg-muted">
          Invite colleagues and assign their role and plan. Each user's plan is independent — Pro unlocks their
          configurable parameters.
        </p>
        <div className="mt-[18px] flex items-center gap-3 rounded-[13px] border border-stone-dk bg-offwhite px-4 py-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-olive-lt text-xs font-semibold text-olive-dk">
            {user.initials}
          </span>
          <div className="min-w-0 flex-1">
            <b className="block text-[13.5px] text-fg">{user.name}</b>
            <span className="text-[11.5px] text-fg-muted">You</span>
          </div>
        </div>
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-gold bg-gold-lt px-4 py-3 text-[13px] text-gold-dk">
          <Shield className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Adding team members, assigning their plans and buying seats is done by your Super User or an Admin. Ask
            them to add the colleagues you work with.
          </p>
        </div>
        <TeamFooter onFinish={onFinish} />
      </Card>
    );
  }

  if (loadError) {
    return (
      <Card>
        <EmptyState icon="Users" title="Your team could not be loaded" description={loadError} />
        <TeamFooter onFinish={onFinish} />
      </Card>
    );
  }
  if (!view) {
    return (
      <Card>
        <p className="text-sm text-fg-muted" role="status">
          Loading your team…
        </p>
      </Card>
    );
  }

  const byTier = Object.fromEntries(view.tiers.map((t) => [t.tier, t])) as Record<SeatTier, SeatsView["tiers"][number]>;
  const prices = Object.fromEntries(view.tiers.map((t) => [t.tier, t.price])) as Parameters<typeof seatOrder>[1];
  const viewer = view.members.find((m) => m.isViewer) ?? null;
  const superuser = view.superuser;
  const others = view.members.filter((m) => !m.isViewer && !m.isSuperuser);
  const order = seatOrder(qty, prices, view.tax, view.currency);
  const quote: SeatOrder | null = isSeatOrderError(order) ? null : order;
  const selected = PLANS.reduce((n, t) => n + qty[t], 0);

  async function changeTier(member: SeatMemberView, next: SeatTier) {
    setHint(null);
    try {
      const res = await setMemberTier(member.id, next);
      accept(res.seats);
      setExpanded((e) => ({ ...e, [member.id]: true }));
    } catch (err) {
      setHint({ text: errorText(err), warn: true });
    }
  }

  async function add() {
    if (!superuser || busy) return;
    const address = email.trim();
    if (!address) return;
    setBusy(true);
    setHint(null);
    try {
      const res = await addSeatMember({
        email: address,
        role,
        tier,
        title: edition === "vc" && designation.trim() ? designation.trim() : undefined,
      });
      accept(res.seats);
      setEmail("");
      setDesignation("");
      if (res.invite.delivered) {
        showToast(
          `Invitation sent to ${address}`,
          "They’ll receive an email to log in with this address as their username and set up their password.",
        );
      } else {
        // The invite could not actually be emailed (no sending domain yet), so
        // saying "sent" would be false — and the credential must reach them.
        showToast(`Account created for ${address}`, "Email delivery isn’t set up yet — share their temporary password.");
        if (res.tempPassword) {
          setHint({
            text: `Share this temporary password with ${address}: ${res.tempPassword} — they’ll set their own on first sign-in.`,
            warn: false,
          });
        }
      }
    } catch (err) {
      setHint({ text: errorText(err), warn: true });
    } finally {
      setBusy(false);
    }
  }

  function openBuy(t?: SeatTier) {
    const next: Record<SeatTier, number> = { standard: 0, pro: 0, premium: 0 };
    if (t && byTier[t].price) next[t] = 1;
    setQty(next);
    setReceipt(null);
    setPayError(null);
    setScreen("buyseats");
  }

  async function place() {
    if (!quote || busy) return;
    setBusy(true);
    setPayError(null);
    try {
      const quantities: SeatQuantities = {};
      for (const t of PLANS) if (qty[t] > 0) quantities[t] = qty[t];
      const res = await purchaseSeats(quantities);
      setReceipt(res);
      accept(res.seats);
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
          <Button variant="secondary" onClick={() => setScreen("team")}>
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
          <Button onClick={() => setScreen("team")}>
            Back to team <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </Card>
    );
  }

  // ── The team step ──────────────────────────────────────────────────────────
  const noSuper = !superuser;
  return (
    <Card>
      <h2 className="text-[23px] font-bold leading-tight text-fg">Add team members</h2>
      <p className="mt-1 text-[13.5px] text-fg-muted">
        {plan === "enterprise"
          ? "Invite colleagues and assign their role and plan. Each user's plan is independent — Pro unlocks their configurable parameters."
          : "Individual plans are single-seat. Upgrade to Enterprise to invite colleagues, assign roles, and share cohorts."}
      </p>
      <div className="mt-5 flex max-w-[430px] gap-1.5 rounded-[11px] border border-stone-dk bg-stone p-[5px]" role="group" aria-label="Plan type">
        {(["individual", "enterprise"] as const).map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={plan === p}
            onClick={() => setPlan(p)}
            className={`flex-1 rounded-lg p-[11px] text-[13px] ${
              plan === p ? "bg-surface font-semibold text-fg shadow-sm" : "text-fg-muted"
            }`}
          >
            {p === "individual" ? "Individual plan" : "Enterprise plan"}
          </button>
        ))}
      </div>

      {plan === "individual" ? (
        <div>
          <div className="mt-[18px] rounded-[13px] border border-gold bg-gold-lt p-[22px]">
            <h3 className="flex items-center gap-2 text-base font-semibold text-gold-dk">
              <User className="h-4 w-4" /> Individual plan · single seat
            </h3>
            <p className="mt-2 max-w-[560px] text-[13px] leading-relaxed text-fg-2">
              Individual plans include one seat — yours. Inviting colleagues, assigning roles, and sharing cohorts are
              Enterprise features. Upgrade anytime to build out your team.
            </p>
            <Link
              to="/app/account"
              className="mt-[15px] inline-flex items-center gap-2 rounded-[10px] bg-gold-dk px-[22px] py-3 text-sm font-semibold text-white hover:bg-gold"
            >
              <ArrowUpCircle className="h-4 w-4" /> Upgrade to Enterprise
            </Link>
          </div>
          <div className="mt-4 flex items-center gap-3 rounded-xl border border-stone-dk bg-offwhite px-4 py-[15px]">
            <Avatar email={viewer?.email ?? ""} />
            <div className="min-w-0 flex-1">
              <b className="block text-[13.5px] text-fg">{viewer?.email}</b>
              <span className="text-[11.5px] text-fg-muted">{viewer?.roleLabel} · you</span>
            </div>
            <span className="rounded-full bg-stone px-[11px] py-[3px] text-[11px] font-semibold text-fg-2">Owner</span>
          </div>
        </div>
      ) : (
        <div>
          <div className="mb-5 mt-1 flex gap-1 border-b border-stone-dk" role="tablist">
            {(
              [
                ["add", "Add members", UserPlus],
                ["all", "View all members", Users],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`-mb-px flex items-center gap-[7px] border-b-2 px-4 py-[11px] text-[13.5px] font-medium ${
                  tab === id ? "border-olive text-olive-dk" : "border-transparent text-fg-muted hover:text-fg-2"
                }`}
              >
                <Icon className="h-4 w-4" /> {label}
              </button>
            ))}
          </div>

          {tab === "add" ? (
            <div>
              {viewer && (
                <div className="mt-[18px] rounded-[13px] border border-stone-dk bg-offwhite px-[17px] py-4">
                  <div className="mb-[15px] flex items-center gap-3">
                    <Avatar email={viewer.email} />
                    <div className="min-w-0 flex-1">
                      <b className="block text-[13.5px] text-fg">{viewer.email}</b>
                      <span className="text-[11.5px] text-fg-muted">You — account owner</span>
                    </div>
                  </div>
                  <div className="grid items-end gap-4 sm:grid-cols-[1fr_auto]">
                    <label className="flex flex-col">
                      <span className="mb-[7px] text-xs font-semibold text-fg">Your role</span>
                      <select
                        className="sj-input h-10 disabled:opacity-70"
                        disabled
                        value={viewer.role}
                        title="Roles are changed in Admin console → Team & roles"
                      >
                        <option value={viewer.role}>{viewer.roleLabel}</option>
                      </select>
                    </label>
                    <div>
                      <span className="block text-xs font-semibold text-fg">Your plan</span>
                      <PlanToggle label="Your plan" value={viewer.tier} onChange={(t) => changeTier(viewer, t)} />
                    </div>
                  </div>
                </div>
              )}

              <SuperBox superuser={superuser} viewer={viewer} />
              <SeatBar view={view} onBuy={openBuy} />

              <div className="my-5 h-px bg-stone" />

              <div
                className={`mt-[18px] grid items-end gap-[11px] ${
                  edition === "vc" ? "sm:grid-cols-[1fr_150px_140px_130px_auto]" : "sm:grid-cols-[1fr_168px_150px_auto]"
                }`}
              >
                <label className="flex flex-col">
                  <span className="mb-[7px] text-xs font-semibold text-fg">Work email</span>
                  <input
                    className="sj-input h-10"
                    placeholder="colleague@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && add()}
                  />
                </label>
                <label className="flex flex-col">
                  <span className="mb-[7px] text-xs font-semibold text-fg">Role</span>
                  <select
                    aria-label="Role for the new member"
                    className="sj-input h-10"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                  >
                    {view.roles.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </label>
                {edition === "vc" && (
                  <label className="flex flex-col">
                    <span className="mb-[7px] text-xs font-semibold text-fg">Designation</span>
                    <input
                      className="sj-input h-10"
                      placeholder="e.g. Partner"
                      value={designation}
                      onChange={(e) => setDesignation(e.target.value)}
                    />
                  </label>
                )}
                <label className="flex flex-col">
                  <span className="mb-[7px] text-xs font-semibold text-fg">Plan</span>
                  <select
                    aria-label="Plan for the new member"
                    className="sj-input h-10"
                    value={tier}
                    onChange={(e) => setTier(e.target.value as SeatTier)}
                  >
                    {PLANS.map((t) => (
                      <option key={t} value={t}>
                        {PLAN_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </label>
                <Button variant="secondary" onClick={add} disabled={noSuper || busy} className="h-10">
                  <Plus className="h-4 w-4" /> Add
                </Button>
              </div>
              <p
                className={`mt-[9px] min-h-[1px] text-xs ${noSuper || hint?.warn ? "text-gold-dk" : "text-fg-muted"}`}
                role={hint?.warn || noSuper ? "alert" : undefined}
              >
                {noSuper ? "Nominate a super user above to start adding team members." : hint?.text}
              </p>

              <div className="mt-2">
                {others.map((m) => {
                  const open = expanded[m.id] ?? false;
                  return (
                    <div key={m.id} className="mb-3 rounded-xl border border-stone-dk px-4 py-[15px]" data-testid="seat-member">
                      <button
                        type="button"
                        className="flex w-full items-center gap-3 text-left"
                        aria-expanded={open}
                        onClick={() => setExpanded((e) => ({ ...e, [m.id]: !open }))}
                      >
                        <Avatar email={m.email} />
                        <span className="min-w-0 flex-1">
                          <b className="block truncate text-[13.5px] text-fg">{m.email}</b>
                          <span className="text-[11.5px] text-fg-muted">
                            {edition === "vc" && m.title ? `${m.title} · ${m.roleLabel}` : m.roleLabel}
                          </span>
                        </span>
                        <TierBadge tier={m.tier} />
                      </button>
                      {open && (
                        <div className="mt-3.5 border-t border-stone pt-3.5">
                          <div className="text-xs font-semibold text-fg">Plan</div>
                          <PlanToggle label={`Plan for ${m.email}`} value={m.tier} onChange={(t) => changeTier(m, t)} />
                          {m.tier !== "standard" && (
                            <div className="mt-[13px] flex gap-2 rounded-[9px] bg-offwhite px-3.5 py-[11px] text-xs leading-relaxed text-fg-2">
                              <Sparkles className="mt-px h-4 w-4 shrink-0 text-gold-dk" />
                              <span>
                                {PLAN_LABELS[m.tier]} — {PLAN_PRIVILEGES[m.tier]}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <AllMembers
              view={view}
              programs={programs}
              onTier={changeTier}
              onChanged={async () => accept(await getSeats())}
              onError={(t) => setHint({ text: t, warn: true })}
            />
          )}
        </div>
      )}

      {tab === "all" && hint?.warn && (
        <p role="alert" className="mt-3 text-xs text-gold-dk">
          {hint.text}
        </p>
      )}

      <TeamFooter onFinish={onFinish} />

      {toast && (
        <div
          role="status"
          className="fixed bottom-7 left-1/2 z-[4000] flex max-w-[440px] -translate-x-1/2 items-start gap-[11px] rounded-[11px] bg-ink px-[18px] py-[13px] text-[13px] text-white shadow-2xl"
        >
          <Mail className="mt-px h-5 w-5 shrink-0 text-green" />
          <div className="text-left">
            <b className="mb-0.5 block">{toast.title}</b>
            <span className="text-[11.5px] leading-normal opacity-80">{toast.body}</span>
          </div>
        </div>
      )}
    </Card>
  );
}

function TeamFooter({ onFinish }: { onFinish: () => void }) {
  return (
    <div className="mt-[26px] flex items-center justify-between gap-3">
      <Button variant="secondary" onClick={onFinish}>
        Skip for now
      </Button>
      <Button onClick={onFinish}>
        Confirm &amp; go to dashboard <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

/** `#su-superbox` — its three states. */
function SuperBox({ superuser, viewer }: { superuser: SeatMemberView | null; viewer: SeatMemberView | null }) {
  if (superuser && viewer?.isSuperuser) {
    return (
      <div className="mt-4 flex items-center gap-[11px] rounded-xl border border-green bg-green-lt px-4 py-3.5 text-[13px] text-green" data-testid="superbox">
        <ShieldCheck className="h-5 w-5 shrink-0" />
        <div>
          <b className="block">You are the super user</b>
          <span className="text-[11.5px] opacity-85">Only one super user is allowed per account.</span>
        </div>
      </div>
    );
  }
  if (superuser) {
    return (
      <div className="mt-4 flex items-center gap-[11px] rounded-xl border border-green bg-green-lt px-4 py-3.5 text-[13px] text-green" data-testid="superbox">
        <ShieldCheck className="h-5 w-5 shrink-0" />
        <div>
          <b className="block">Super user — {superuser.email}</b>
          <span className="text-[11.5px] opacity-85">
            {PLAN_LABELS[superuser.tier]} seat · only one super user per account.
          </span>
        </div>
      </div>
    );
  }
  // Unreachable while W4-A's single-owner invariant holds — every workspace is
  // created with one and ownership can only be TRANSFERRED — but drawn, because
  // the gate below is enforced server-side (`superuser_required`) either way.
  return (
    <div className="mt-4 rounded-xl border border-gold bg-gold-lt px-4 py-3.5 text-[13px]" data-testid="superbox">
      <div className="flex items-center gap-2 text-[13.5px] font-bold text-gold-dk">
        <Shield className="h-4 w-4" /> Nominate a super user{" "}
        <span className="ml-0.5 rounded-full bg-gold px-[9px] py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-white">
          required
        </span>
      </div>
      <p className="mt-[9px] text-[11.5px] text-gold-dk opacity-85">
        A super user has full platform access. You haven’t taken this role yourself, so nominating one is required. Only
        one super user is allowed per account — ask your platform administrator to appoint one.
      </p>
    </div>
  );
}

/** `#su-seatbar` — totals, the per-tier pills and the "Buy a seat" row. */
function SeatBar({ view, onBuy }: { view: SeatsView; onBuy: (t: SeatTier) => void }) {
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

/** `#su-tab-all` — Member · Plan · Role · Status · Programs accessible. */
function AllMembers({
  view,
  programs,
  onTier,
  onChanged,
  onError,
}: {
  view: SeatsView;
  programs: ProgramView[];
  onTier: (m: SeatMemberView, t: SeatTier) => void;
  onChanged: () => Promise<void>;
  onError: (text: string) => void;
}) {
  const [pending, setPending] = useState<string | null>(null);

  async function patch(m: SeatMemberView, body: { role?: string; active?: boolean }) {
    setPending(m.id);
    try {
      await updateUser(m.id, body);
      await onChanged();
    } catch (err) {
      onError(errorText(err));
    } finally {
      setPending(null);
    }
  }

  // Owner first, then the super user, then everyone else — `teamRoster()`.
  const roster = [
    ...view.members.filter((m) => m.isViewer),
    ...view.members.filter((m) => m.isSuperuser && !m.isViewer),
    ...view.members.filter((m) => !m.isViewer && !m.isSuperuser),
  ];

  return (
    <div>
      <div className="mb-3 text-[12.5px] font-semibold text-fg-2">
        {roster.length} team member{roster.length === 1 ? "" : "s"}
      </div>
      <div className="overflow-x-auto rounded-xl border border-stone-dk">
        <table className="w-full min-w-[740px] border-collapse">
          <thead>
            <tr>
              {["Member", "Plan", "Role", "Status", "Programs accessible"].map((h) => (
                <th
                  key={h}
                  className="whitespace-nowrap border-b border-stone-dk bg-offwhite px-3.5 py-[11px] text-left text-[10.5px] font-semibold uppercase tracking-wide text-fg-muted"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {roster.map((m) => {
              const tag = m.isViewer ? "You · account owner" : m.isSuperuser ? "Super user" : "";
              const fixed = m.isViewer || m.isSuperuser;
              return (
                <tr key={m.id} className="border-b border-stone last:border-b-0">
                  <td className="px-3.5 py-3 align-middle">
                    <div className="flex items-center gap-2.5">
                      <Avatar email={m.email} />
                      <div className="min-w-0">
                        <b className="block text-[13.5px] text-fg">{m.name}</b>
                        <span className="text-[11.5px] text-fg-muted">
                          {m.email}
                          {tag ? ` · ${tag}` : ""}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="px-3.5 py-3 align-middle">
                    <select
                      aria-label={`Plan for ${m.email}`}
                      className="sj-input h-8 min-w-[122px] text-[13px]"
                      value={m.tier}
                      onChange={(e) => onTier(m, e.target.value as SeatTier)}
                    >
                      {PLANS.map((t) => (
                        <option key={t} value={t}>
                          {PLAN_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3.5 py-3 align-middle">
                    {fixed ? (
                      <span className="whitespace-nowrap rounded-full bg-olive-lt px-[11px] py-[3px] text-[11px] font-semibold text-olive-dk">
                        {m.roleLabel}
                      </span>
                    ) : (
                      <select
                        aria-label={`Role for ${m.email}`}
                        className="sj-input h-8 min-w-[122px] text-[13px]"
                        value={m.role}
                        disabled={pending === m.id}
                        onChange={(e) => patch(m, { role: e.target.value })}
                      >
                        {view.roles.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="px-3.5 py-3 align-middle">
                    <button
                      type="button"
                      disabled={fixed || pending === m.id}
                      onClick={() => patch(m, { active: !m.active })}
                      aria-label={`${m.active ? "Deactivate" : "Activate"} ${m.email}`}
                      className={`inline-flex items-center gap-[7px] whitespace-nowrap rounded-full border px-[13px] py-1.5 text-[12.5px] font-semibold disabled:cursor-default ${
                        m.active ? "border-green/30 bg-green-lt text-green" : "border-stone-dk bg-stone text-fg-muted"
                      }`}
                    >
                      <span className={`h-[7px] w-[7px] rounded-full ${m.active ? "bg-green" : "bg-fg-muted"}`} />
                      {m.active ? "Active" : "Inactive"}
                    </button>
                  </td>
                  <td className="px-3.5 py-3 align-middle">
                    <div className="flex max-w-[300px] flex-wrap gap-1.5">
                      {programs.map((p) => (
                        <span
                          key={p.id}
                          title="Every member can open every program in this workspace"
                          className="inline-flex items-center gap-[5px] rounded-lg border border-olive-md bg-olive-lt px-2.5 py-1.5 text-xs font-semibold text-olive-dk"
                        >
                          ✓ {p.name}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-3.5 flex items-start gap-[9px] text-xs leading-normal text-fg-muted">
        <Info className="mt-px h-4 w-4 shrink-0 text-olive" />
        <span>
          Change any member's plan, role or active status — updates apply immediately. Every member can open every
          program in this workspace.
        </span>
      </div>
    </div>
  );
}
