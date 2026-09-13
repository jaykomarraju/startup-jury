/**
 * W6-C — the **purchased seat**: how many staff members an organisation may
 * have, per plan tier, and what buying more of them costs.
 *
 * ── Two things in this product are called "seat". This is the second. ────────
 *   • `cohorts.seat_capacity` / `seats_filled` (`0036`, W5-A) are places for
 *     STARTUPS in a batch. Nothing here reads, writes or names them.
 *   • A purchased seat is a per-USER entitlement. `billing_subscriptions.seats`
 *     (`0046`, W4-C) records how many were bought and the Credits & billing tile
 *     prints it; `seat_grants` (`0052`) breaks that total down by tier; and
 *     `users.plan_tier` (`0052`) says which tier's seat each member holds.
 *
 * The prototype (`#sus-team`, `renderSeats`, `suAddMember`) caps each tier
 * separately — "No Pro seats left — buy a Pro seat below, then add this user" —
 * so capacity is per tier here too. A pooled count would let a Standard seat,
 * the cheapest one, be bought and then handed to a Premium member.
 *
 * Everything in this file is pure: the Worker, the wizard and the unit tests
 * share it, so the number the seat bar prints and the number the server
 * enforces cannot drift apart.
 *
 * ── Prices ────────────────────────────────────────────────────────────────────
 * No seat price is written in this file or anywhere else in this lane. A seat
 * of tier `pro` costs whatever the PUBLISHED catalogue (`pricing_versions`,
 * W4-D) states for its `subscription` plan coded `pro` — the group the catalogue
 * itself badges "Monthly subscription · Per seat". A tier the catalogue does not
 * price is not purchasable, and says so, rather than falling back to the
 * prototype's ₹3,600 / ₹4,800 / ₹6,000. Tax is `priceBreakdown` from
 * `src/shared/plans.ts` and nothing else (§8 Q55).
 */

import {
  PLANS,
  PLAN_LABELS,
  multiplyMinor,
  priceBreakdown,
  type BillingPeriod,
  type Plan,
  type TaxBreakdown,
  type TaxSettings,
} from "./plans";
import type { PriceBook } from "./priceBook";

/** A seat's tier is a plan tier — one vocabulary, not two. */
export type SeatTier = Plan;

/** Highest first: the order the prototype's seat bar and buy buttons use. */
export const SEAT_TIERS_DESC: readonly SeatTier[] = [...PLANS].reverse();

export function isSeatTier(v: unknown): v is SeatTier {
  return typeof v === "string" && (PLANS as readonly string[]).includes(v);
}

/** The prototype's quantity selects run 0 – 20 per tier (`renderBuy`). */
export const MAX_SEATS_PER_TIER = 20;

// ── Capacity ─────────────────────────────────────────────────────────────────

export type TierCounts = Record<SeatTier, number>;

export function emptyCounts(): TierCounts {
  return { standard: 0, pro: 0, premium: 0 };
}

/** How many members hold a seat of each tier. */
export function countByTier(members: readonly { tier: SeatTier }[]): TierCounts {
  const out = emptyCounts();
  for (const m of members) out[m.tier] += 1;
  return out;
}

export interface TierSeats {
  tier: SeatTier;
  capacity: number;
  used: number;
  /** Seats of this tier still free. Never negative. */
  available: number;
  /**
   * Members holding this tier beyond its capacity — a workspace that had more
   * members than seats before enforcement existed. Reported, never hidden, and
   * never silently "fixed" by granting seats nobody bought.
   */
  over: number;
}

export interface SeatSummary {
  tiers: Record<SeatTier, TierSeats>;
  capacity: number;
  used: number;
  /**
   * The prototype's "seats left for nomination": the seats a new member could
   * still be added into. The prototype computes total capacity − total users,
   * which is the same number until a tier is OVER — then it hides a free seat in
   * another tier behind the overflow ("0 left" beside "Pro 3 / 4"). This is the
   * sum of each tier's own free seats, which is what the Add button honours.
   */
  left: number;
  over: number;
}

export function seatSummary(capacity: TierCounts, used: TierCounts): SeatSummary {
  const tiers = {} as Record<SeatTier, TierSeats>;
  let cap = 0;
  let u = 0;
  let over = 0;
  let left = 0;
  for (const tier of PLANS) {
    const c = Math.max(0, Math.trunc(capacity[tier] ?? 0));
    const n = Math.max(0, Math.trunc(used[tier] ?? 0));
    tiers[tier] = { tier, capacity: c, used: n, available: Math.max(0, c - n), over: Math.max(0, n - c) };
    cap += c;
    u += n;
    over += Math.max(0, n - c);
    left += Math.max(0, c - n);
  }
  return { tiers, capacity: cap, used: u, left, over };
}

/** The named refusal a creation at capacity gets. */
export interface SeatRefusal {
  error: "seat_limit_reached";
  tier: SeatTier;
  capacity: number;
  used: number;
  message: string;
}

/**
 * Null when one more member may take a seat of `tier`; otherwise the refusal.
 *
 * The rule is "refused, not reconciled later": a member is only ever created
 * into a seat that exists. The message is the prototype's own hint.
 */
export function seatRefusal(summary: SeatSummary, tier: SeatTier): SeatRefusal | null {
  const t = summary.tiers[tier];
  if (t.available > 0) return null;
  const label = PLAN_LABELS[tier];
  return {
    error: "seat_limit_reached",
    tier,
    capacity: t.capacity,
    used: t.used,
    message: `No ${label} seats left — buy a ${label} seat below, then add this user.`,
  };
}

/**
 * Moving a member from `from` to `to` frees a `from` seat and needs a free `to`
 * seat. Moving to the tier they already hold always succeeds.
 */
export function tierMoveRefusal(
  summary: SeatSummary,
  from: SeatTier,
  to: SeatTier,
): SeatRefusal | null {
  if (from === to) return null;
  return seatRefusal(summary, to);
}

/** Who holds a purchased seat: live staff. Founders and mentors never do. */
export function holdsSeat(u: { role: string; userType: string; deleted: boolean }): boolean {
  return !u.deleted && u.userType === "staff" && u.role !== "founder" && u.role !== "mentor";
}

// ── Prices, from the published catalogue ─────────────────────────────────────

export interface SeatPrice {
  tier: SeatTier;
  /** The catalogue plan the price is read from. */
  code: string;
  name: string;
  currency: string;
  /** Stated price per seat, per `period`, in minor units. */
  amountMinor: number;
  period: BillingPeriod | null;
}

/**
 * One price per tier from a published book, in `currency`, or null where the
 * catalogue does not sell that tier as a seat (no active `subscription` plan
 * with that code, or no amount in that currency).
 */
export function seatPricesFromBook(
  book: Pick<PriceBook, "plans"> | null,
  currency: string,
): Record<SeatTier, SeatPrice | null> {
  const out: Record<SeatTier, SeatPrice | null> = { standard: null, pro: null, premium: null };
  if (!book) return out;
  for (const tier of PLANS) {
    const plan = book.plans.find((p) => p.group === "subscription" && p.code === tier && p.active);
    const amount = plan?.amounts?.[currency];
    if (!plan || typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) continue;
    out[tier] = {
      tier,
      code: plan.code,
      name: plan.name,
      currency,
      amountMinor: amount,
      period: plan.period,
    };
  }
  return out;
}

/** The published book's tax block, in the shape `priceBreakdown` takes. */
export function taxSettingsFromBook(book: Pick<PriceBook, "tax"> | null): TaxSettings {
  return {
    ratePct: book?.tax.gstRatePct ?? 0,
    registration: book?.tax.gstRegistration ?? null,
    inclusive: book?.tax.pricesIncludeGst ?? false,
    internationalNotice: book?.tax.showInternationalTaxNotice ?? false,
  };
}

// ── An order ─────────────────────────────────────────────────────────────────

export type SeatQuantities = Partial<Record<SeatTier, number>>;

export interface SeatOrderLine {
  tier: SeatTier;
  name: string;
  quantity: number;
  unitMinor: number;
  /** `unitMinor × quantity`, as stated (tax per `money.inclusive`). */
  amountMinor: number;
  period: BillingPeriod | null;
}

export interface SeatOrder {
  lines: SeatOrderLine[];
  seats: number;
  currency: string;
  /** Sum of the stated line amounts. */
  statedMinor: number;
  /** Subtotal · GST · total, from `priceBreakdown` — the only tax rule there is. */
  money: TaxBreakdown;
  /** The period every line shares, or null when they differ. */
  period: BillingPeriod | null;
}

export type SeatOrderError =
  | { error: "invalid_quantity"; tier: string }
  | { error: "no_seats_selected" }
  | { error: "tier_not_purchasable"; tier: SeatTier };

/**
 * Price an order. Tax is computed ONCE, on the order's stated total, the way the
 * prototype's `buyTotals` does — not per line, so the GST line an invoice would
 * print is the GST on what was charged.
 */
export function seatOrder(
  quantities: unknown,
  prices: Record<SeatTier, SeatPrice | null>,
  tax: TaxSettings,
  currency: string,
): SeatOrder | SeatOrderError {
  const q = (quantities ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(q)) {
    if (!isSeatTier(key)) return { error: "invalid_quantity", tier: key };
  }
  const lines: SeatOrderLine[] = [];
  for (const tier of SEAT_TIERS_DESC) {
    const raw = q[tier];
    if (raw === undefined || raw === null) continue;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > MAX_SEATS_PER_TIER) {
      return { error: "invalid_quantity", tier };
    }
    if (n === 0) continue;
    const price = prices[tier];
    if (!price || price.currency !== currency) return { error: "tier_not_purchasable", tier };
    lines.push({
      tier,
      name: price.name,
      quantity: n,
      unitMinor: price.amountMinor,
      amountMinor: multiplyMinor(price.amountMinor, n),
      period: price.period,
    });
  }
  if (lines.length === 0) return { error: "no_seats_selected" };
  const statedMinor = lines.reduce((s, l) => s + l.amountMinor, 0);
  const periods = new Set(lines.map((l) => l.period));
  return {
    lines,
    seats: lines.reduce((s, l) => s + l.quantity, 0),
    currency,
    statedMinor,
    money: priceBreakdown(statedMinor, tax, currency),
    period: periods.size === 1 ? lines[0].period : null,
  };
}

export function isSeatOrderError(o: SeatOrder | SeatOrderError): o is SeatOrderError {
  return "error" in o;
}

/** "2 × Pro, 1 × Standard" — the intent's plan name and the audit sentence. */
export function describeSeatOrder(order: Pick<SeatOrder, "lines">): string {
  return order.lines.map((l) => `${l.quantity} × ${PLAN_LABELS[l.tier]}`).join(", ");
}

// ── The team step's payload ──────────────────────────────────────────────────

export interface SeatMemberView {
  id: string;
  name: string;
  email: string;
  role: string;
  roleLabel: string;
  /** The organisational title — the VC add-member row's "Designation". */
  title: string | null;
  tier: SeatTier;
  active: boolean;
  invitePending: boolean;
  isSuperuser: boolean;
  /** The signed-in user — the prototype's "You — account owner" card. */
  isViewer: boolean;
}

export interface SeatTierView extends TierSeats {
  label: string;
  price: SeatPrice | null;
}

export interface SeatsView {
  edition: string;
  tiers: SeatTierView[];
  capacity: number;
  used: number;
  left: number;
  over: number;
  /** `billing_subscriptions.seats` — what the Credits & billing tile prints. */
  purchasedSeats: number;
  members: SeatMemberView[];
  superuser: SeatMemberView | null;
  /** Roles the add-member row may offer: `creatableStaffRoles`, labelled. */
  roles: { value: string; label: string }[];
  currency: string;
  tax: TaxSettings;
  catalogue: { version: number; publishedAt: string } | null;
  /** §1.3: false on every build today. */
  paymentConfigured: boolean;
}

/** The response `POST /api/seats/purchase` returns. */
export interface SeatPurchaseResult {
  ok: true;
  /** Always false in this build: a recorded intent is not a payment. */
  completed: false;
  paymentTaken: false;
  intent: {
    id: string;
    status: "recorded" | "redirected" | "completed" | "failed" | "cancelled";
    checkoutUrl: string | null;
  };
  order: SeatOrder;
  /** Seats added to capacity by this order, per tier. Zero while a checkout is pending. */
  seatsGranted: TierCounts;
  seats: SeatsView;
  message: string;
}

// ── Small presentation helpers the prototype defines ─────────────────────────

/** `nameFromEmail`: "meera.sharma@firm.com" → "Meera Sharma". */
export function nameFromEmail(email: string): string {
  const local = String(email).split("@")[0] ?? "";
  const name = local
    .split(/[._-]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return name || email;
}

/** `initials`: two letters from the local part of an address. */
export function initialsFromEmail(email: string): string {
  const local = String(email).split("@")[0] ?? "";
  const parts = local.split(/[._-]/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return local.slice(0, 2).toUpperCase();
}
