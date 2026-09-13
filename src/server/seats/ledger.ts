/**
 * W6-C — the purchased-seat ledger: reads, the capacity check, and the one
 * write a seat purchase makes.
 *
 * Exported so the check can be called from wherever a member is created.
 * `POST /api/users` is `W4-A`'s route and does not call it yet — §9 carries the
 * one-line request. Until it does, the Set up wizard's own add-member route
 * (`src/server/routes/seats.ts`) is the path that enforces capacity.
 *
 * Nothing here touches `cohorts.seat_capacity` — that is the other seat.
 */
import type { Env } from "../types";
import { creatableStaffRoles, roleLabel, type Edition, type Role } from "../../shared/roles";
import type { PublishedPriceBook, PriceBook } from "../../shared/priceBook";
import {
  PLAN_LABELS,
  PLANS,
  type TaxBreakdown,
} from "../../shared/plans";
import {
  countByTier,
  emptyCounts,
  seatPricesFromBook,
  seatRefusal,
  seatSummary,
  taxSettingsFromBook,
  type SeatMemberView,
  type SeatOrder,
  type SeatRefusal,
  type SeatSummary,
  type SeatTier,
  type SeatsView,
  type TierCounts,
} from "../../shared/seats";
import { readSubscription } from "../billing/ledger";
import { paymentConfigured } from "../billing/provider";

interface SeatHolderRow {
  id: string;
  name: string;
  email: string;
  role: string;
  title: string | null;
  plan_tier: SeatTier;
  active: number;
  invite_accepted_at: string | null;
}

/**
 * The live members who hold a seat: staff, not removed, not founders or mentors.
 * A DEACTIVATED member still holds theirs — reactivating them is one PATCH that
 * checks nothing, so a seat freed by deactivation could be sold twice. Removal
 * (`DELETE /api/users/:id`) is what frees a seat.
 */
export async function seatHolders(env: Env, edition: Edition): Promise<SeatHolderRow[]> {
  const res = await env.DB.prepare(
    "SELECT id, name, email, role, title, plan_tier, active, invite_accepted_at FROM users " +
      "WHERE edition = ? AND deleted_at IS NULL AND user_type = 'staff' " +
      "AND role NOT IN ('founder', 'mentor') ORDER BY CASE role WHEN 'superuser' THEN 0 ELSE 1 END, name",
  )
    .bind(edition)
    .all<SeatHolderRow>();
  return res.results ?? [];
}

/** Per-tier capacity: the sum of GRANTED rows. A pending checkout counts for nothing. */
export async function seatCapacity(env: Env, edition: Edition): Promise<TierCounts> {
  const res = await env.DB.prepare(
    "SELECT tier, COALESCE(SUM(quantity), 0) AS n FROM seat_grants " +
      "WHERE edition = ? AND status = 'granted' GROUP BY tier",
  )
    .bind(edition)
    .all<{ tier: SeatTier; n: number }>();
  const out = emptyCounts();
  for (const r of res.results ?? []) {
    if ((PLANS as readonly string[]).includes(r.tier)) out[r.tier] = Math.max(0, r.n);
  }
  return out;
}

export async function readSeatSummary(env: Env, edition: Edition): Promise<SeatSummary> {
  const [capacity, holders] = await Promise.all([seatCapacity(env, edition), seatHolders(env, edition)]);
  return seatSummary(capacity, countByTier(holders.map((h) => ({ tier: h.plan_tier }))));
}

/**
 * The capacity check a member creation makes. Null when a seat of `tier` is
 * free; otherwise the named refusal to return (409).
 */
export async function seatRefusalFor(
  env: Env,
  edition: Edition,
  tier: SeatTier,
): Promise<SeatRefusal | null> {
  return seatRefusal(await readSeatSummary(env, edition), tier);
}

/**
 * The PUBLISHED catalogue — the version W4-D's publish froze, never the draft
 * (`GET /api/pricing/published` reads the same row). Null while nothing has
 * ever been published, in which case no tier is purchasable.
 */
export async function readPublishedBook(env: Env): Promise<PublishedPriceBook | null> {
  const row = await env.DB.prepare(
    "SELECT version, document, published_at FROM pricing_versions WHERE status = 'published'",
  ).first<{ version: number; document: string; published_at: string }>();
  if (!row) return null;
  const book = JSON.parse(row.document) as PriceBook;
  return { ...book, version: row.version, publishedAt: row.published_at };
}

function toMemberView(edition: Edition, viewerId: string, r: SeatHolderRow): SeatMemberView {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    role: r.role,
    roleLabel: roleLabel(edition, r.role as Role),
    title: r.title ?? null,
    tier: r.plan_tier,
    active: r.active === 1,
    invitePending: r.invite_accepted_at === null,
    isSuperuser: r.role === "superuser",
    isViewer: r.id === viewerId,
  };
}

/** Everything the team step and the buy-seats screens render. */
export async function readSeatsView(env: Env, edition: Edition, viewerId: string): Promise<SeatsView> {
  const [capacity, holders, subscription, book] = await Promise.all([
    seatCapacity(env, edition),
    seatHolders(env, edition),
    readSubscription(env, edition),
    readPublishedBook(env),
  ]);
  const summary = seatSummary(capacity, countByTier(holders.map((h) => ({ tier: h.plan_tier }))));
  const currency = subscription.currency;
  const prices = seatPricesFromBook(book, currency);
  const members = holders.map((h) => toMemberView(edition, viewerId, h));
  return {
    edition,
    tiers: PLANS.map((tier) => ({ ...summary.tiers[tier], label: PLAN_LABELS[tier], price: prices[tier] })),
    capacity: summary.capacity,
    used: summary.used,
    left: summary.left,
    over: summary.over,
    purchasedSeats: subscription.seats,
    members,
    superuser: members.find((m) => m.isSuperuser) ?? null,
    roles: creatableStaffRoles(edition).map((r) => ({ value: r, label: roleLabel(edition, r) })),
    currency,
    tax: taxSettingsFromBook(book),
    catalogue: book ? { version: book.version, publishedAt: book.publishedAt } : null,
    paymentConfigured: paymentConfigured(env),
  };
}

/**
 * Write the seats an order bought, in ONE batch: a grant row per tier, linked
 * to the intent that recorded the order, and the same total added to
 * `billing_subscriptions.seats` — the column the Credits & billing tile prints.
 *
 * `status` is `granted` when the order was recorded with no provider (the
 * account is invoiced and followed up — §8 Q65), `pending` when the customer has
 * been sent to a provider's checkout that has not confirmed anything. Only
 * granted rows raise capacity or the purchased total.
 */
export async function writeSeatGrants(
  env: Env,
  args: {
    edition: Edition;
    order: SeatOrder;
    intentId: string;
    actorId: string;
    status: "granted" | "pending";
  },
): Promise<TierCounts> {
  const granted = emptyCounts();
  const statements = args.order.lines.map((line) => {
    if (args.status === "granted") granted[line.tier] += line.quantity;
    return env.DB.prepare(
      "INSERT INTO seat_grants (id, edition, tier, quantity, reason, status, intent_id, actor_id, note) " +
        "VALUES (?, ?, ?, ?, 'purchase', ?, ?, ?, ?)",
    ).bind(
      `sg_${crypto.randomUUID()}`,
      args.edition,
      line.tier,
      line.quantity,
      args.status,
      args.intentId,
      args.actorId,
      `${line.quantity} × ${PLAN_LABELS[line.tier]} seat`,
    );
  });
  if (args.status === "granted") {
    // An edition with no subscription row yet gets one, carrying only the seats:
    // `readSubscription` reports such a workspace as a trialing free trial, and
    // buying seats does not change what plan it is on.
    statements.push(
      env.DB.prepare(
        "INSERT INTO billing_subscriptions (edition, plan_label, seats, cycle_anchor, status) " +
          "VALUES (?, 'Free trial', ?, strftime('%Y', 'now') || '-01-01', 'trialing') " +
          "ON CONFLICT (edition) DO UPDATE SET seats = seats + excluded.seats, updated_at = datetime('now')",
      ).bind(args.edition, args.order.seats),
    );
  }
  await env.DB.batch(statements);
  return granted;
}

/** One line of money for an audit sentence. */
export function moneyNote(money: TaxBreakdown): string {
  return money.taxed ? `incl. ${money.ratePct}% GST` : "no GST (non-INR billing)";
}
