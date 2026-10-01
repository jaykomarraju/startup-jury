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
// T1-PEOPLE — T0's one scope helper. Every signature below took an `Edition`;
// each now takes a `TenantScope`, which is the `getParameters` trick from
// `src/server/db.ts`: changing the parameter TYPE turns §5c's "correct but
// insufficient" into "does not build", and that is the only version a sweep
// across 51 files cannot miss.
import { insertScope, scoped, type TenantScope } from "../../shared/tenant";
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
export async function seatHolders(env: Env, scope: TenantScope): Promise<SeatHolderRow[]> {
  const q = scoped(scope)
    .on("u")
    .andRaw("u.deleted_at IS NULL")
    .andRaw("u.user_type = 'staff'")
    .andRaw("u.role NOT IN ('founder', 'mentor')");
  const res = await env.DB.prepare(
    "SELECT u.id, u.name, u.email, u.role, u.title, u.plan_tier, u.active, u.invite_accepted_at " +
      `FROM users u ${q.whereClause()} ` +
      "ORDER BY CASE u.role WHEN 'superuser' THEN 0 ELSE 1 END, u.name",
  )
    .bind(...q.binds)
    .all<SeatHolderRow>();
  return res.results ?? [];
}

/**
 * Per-tier capacity: the sum of GRANTED rows. A pending checkout counts for nothing.
 *
 * §11's second standing instruction applies here and nowhere else in this file:
 * **aggregates are the dangerous shape, not the lists.** A leaking member list
 * shows another customer's colleagues by name and somebody notices; a leaking
 * `SUM(quantity)` hands this workspace another customer's purchased seats as a
 * perfectly ordinary number, and the only thing anybody sees is that the Team
 * step stopped refusing at capacity. `test/worker/tenant-scope.test.ts`'s
 * `AGGREGATE_PROBES` carries "seat capacity must not sum across customers" for
 * exactly this statement, asserted by VALUE because there is no marker in a sum.
 */
export async function seatCapacity(env: Env, scope: TenantScope): Promise<TierCounts> {
  const q = scoped(scope).on("sg").andRaw("sg.status = 'granted'");
  const res = await env.DB.prepare(
    `SELECT sg.tier AS tier, COALESCE(SUM(sg.quantity), 0) AS n FROM seat_grants sg ${q.whereClause()} ` +
      "GROUP BY sg.tier",
  )
    .bind(...q.binds)
    .all<{ tier: SeatTier; n: number }>();
  const out = emptyCounts();
  for (const r of res.results ?? []) {
    if ((PLANS as readonly string[]).includes(r.tier)) out[r.tier] = Math.max(0, r.n);
  }
  return out;
}

export async function readSeatSummary(env: Env, scope: TenantScope): Promise<SeatSummary> {
  const [capacity, holders] = await Promise.all([seatCapacity(env, scope), seatHolders(env, scope)]);
  return seatSummary(capacity, countByTier(holders.map((h) => ({ tier: h.plan_tier }))));
}

/**
 * The capacity check a member creation makes. Null when a seat of `tier` is
 * free; otherwise the named refusal to return (409).
 */
export async function seatRefusalFor(
  env: Env,
  scope: TenantScope,
  tier: SeatTier,
): Promise<SeatRefusal | null> {
  return seatRefusal(await readSeatSummary(env, scope), tier);
}

/**
 * The PUBLISHED catalogue — the version W4-D's publish froze, never the draft
 * (`GET /api/pricing/published` reads the same row). Null while nothing has
 * ever been published, in which case no tier is purchasable.
 *
 * **NOT TENANT-SCOPED, AND IT MUST NOT BECOME SO.** `pricing_versions` is one of
 * §3's eight PLATFORM-GLOBAL tables: the price book is one catalogue for the whole
 * product, which `CREATE UNIQUE INDEX pricing_versions_one_published ON
 * pricing_versions (status) WHERE status = 'published'` already enforces at the
 * schema level, and `migrations/0033_price_configuration.sql:6-7` already says in
 * its own words. This is the one statement in this file that takes no scope, and a
 * sweep that "finishes the job" here fails both `0100`'s integrity assertion and
 * the registry case in `test/worker/tenant-scope.test.ts`.
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
export async function readSeatsView(
  env: Env,
  scope: TenantScope,
  viewerId: string,
): Promise<SeatsView> {
  const [capacity, holders, subscription, book] = await Promise.all([
    seatCapacity(env, scope),
    seatHolders(env, scope),
    readSubscription(env, scope),
    readPublishedBook(env),
  ]);
  const edition = scope.edition;
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
    scope: TenantScope;
    order: SeatOrder;
    intentId: string;
    actorId: string;
    status: "granted" | "pending";
  },
): Promise<TierCounts> {
  const granted = emptyCounts();
  // `insertScope` rather than two more literals in the column list: a seat grant
  // that names no tenant lands in `t_default` and reads as a successful purchase
  // (`seat_grants.tenant_id` carries `DEFAULT 't_default'`, because `0086` had no
  // other way to backfill a NOT NULL column). That is §5b's silent half — the
  // response is a 200 and the row is there — and the helper is what makes the
  // column impossible to name without supplying the value.
  const t = insertScope(args.scope);
  const statements = args.order.lines.map((line) => {
    if (args.status === "granted") granted[line.tier] += line.quantity;
    return env.DB.prepare(
      `INSERT INTO seat_grants (id, ${t.columns}, tier, quantity, reason, status, intent_id, actor_id, note) ` +
        `VALUES (?, ${t.placeholders}, ?, ?, 'purchase', ?, ?, ?, ?)`,
    ).bind(
      `sg_${crypto.randomUUID()}`,
      ...t.binds,
      line.tier,
      line.quantity,
      args.status,
      args.intentId,
      args.actorId,
      `${line.quantity} × ${PLAN_LABELS[line.tier]} seat`,
    );
  });
  if (args.status === "granted") {
    // A WORKSPACE with no subscription row yet gets one, carrying only the seats:
    // `readSubscription` reports such a workspace as a trialing free trial, and
    // buying seats does not change what plan it is on.
    //
    // ── ONE OF THE NINE `ON CONFLICT` SITES, AND THE ONLY ONE IN THIS SESSION ──
    // `0095` widened this table's PRIMARY KEY from `(edition)` to
    // `(tenant_id, edition)`, and SQLite requires a conflict target to match a
    // uniqueness constraint EXACTLY — so `ON CONFLICT (edition)` would now resolve
    // against `billing_subscriptions__pre_tenant_key`, the transitional UNIQUE
    // index `0095` left standing precisely so that the nine upserts across four T1
    // sessions kept working until each session widened its own. Resolving against
    // that index is wrong in a way worth naming: a second customer's grant would
    // find tenant A's row by `(edition)` alone and ADD ITS SEATS TO IT.
    //
    // Named against the widened PK instead, and MEASURED in D1 rather than inferred
    // from `0095`'s header — because the header is wrong about the OLD form in the
    // dangerous direction. A second customer's first seat purchase, widened target,
    // standing transitional index:
    //
    //   THREW:  UNIQUE constraint failed: billing_subscriptions.edition
    //   BEFORE: t_default | vc | 5
    //   AFTER : t_default | vc | 5      ← untouched
    //
    // Loud, and tenant A's row unchanged. That is the correct error for "integration
    // has not dropped the transitional index yet", and it is why the index must NOT
    // be dropped from this session — there is no migration slot here, and other
    // sessions' `ON CONFLICT` sites still resolve against their own.
    //
    // Note what the error names: the COLUMN (`billing_subscriptions.edition`), not
    // the index. Grepping logs for `__pre_tenant_key` will not find it.
    statements.push(
      env.DB.prepare(
        `INSERT INTO billing_subscriptions (${t.columns}, plan_label, seats, cycle_anchor, status) ` +
          `VALUES (${t.placeholders}, 'Free trial', ?, strftime('%Y', 'now') || '-01-01', 'trialing') ` +
          "ON CONFLICT (tenant_id, edition) DO UPDATE SET seats = seats + excluded.seats, " +
          "updated_at = datetime('now')",
      ).bind(...t.binds, args.order.seats),
    );
  }
  await env.DB.batch(statements);
  return granted;
}

/** One line of money for an audit sentence. */
export function moneyNote(money: TaxBreakdown): string {
  return money.taxed ? `incl. ${money.ratePct}% GST` : "no GST (non-INR billing)";
}
