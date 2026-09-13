/**
 * W6-C — `/api/seats`: the Set up wizard's **Team** step and its **Buy
 * additional seats** sub-flow (`#sus-team`, `#sus-buyseats`, `#sus-buypay`,
 * `#sus-buysuccess`).
 *
 * The seat here is the PURCHASED one — a per-user entitlement, capped per plan
 * tier (`src/shared/seats.ts`). `cohorts.seat_capacity` is the other seat and is
 * not read or written by anything in this file.
 *
 * Four routes, one gate. Every route is `requireTask("addmembers", "admin")`:
 * the same cell `POST /api/users` checks, because each of them either creates a
 * member, changes which seat a member holds, sells a seat, or reads the roster
 * those three act on. Revoking the cell closes all four with it.
 *
 *   GET  /                    the team step's payload (`SeatsView`)
 *   POST /members             add a member INTO a seat — refused at capacity
 *   PUT  /members/:id/tier    move a member to another tier's seat
 *   POST /purchase            record a seat order; charges nothing
 *
 * ── §1.2 and §1.3 ────────────────────────────────────────────────────────────
 * The prototype's `#sus-buypay` draws a card number, expiry and CVV. None of
 * them exist here: `POST /purchase` accepts a quantity per tier and nothing
 * else, and the payment is `recordPaymentIntent` (W4-C) — a provider-hosted
 * page when a provider exists, and a RECORDED intent when none does, which is
 * every build today. The response says `completed: false` and
 * `paymentTaken: false` in as many words.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../types";
import { requireAuth, requireTask } from "../auth/middleware";
import { recordAudit } from "../audit/log";
import { creatableStaffRoles } from "../../shared/roles";
import { PLAN_LABELS, formatMinor } from "../../shared/plans";
import {
  describeSeatOrder,
  isSeatOrderError,
  isSeatTier,
  nameFromEmail,
  seatOrder,
  seatPricesFromBook,
  seatRefusal,
  taxSettingsFromBook,
  tierMoveRefusal,
  type SeatPurchaseResult,
} from "../../shared/seats";
import { readSubscription } from "../billing/ledger";
import { recordPaymentIntent } from "../billing/provider";
import users from "./users";
import {
  moneyNote,
  readPublishedBook,
  readSeatSummary,
  readSeatsView,
  seatHolders,
  writeSeatGrants,
} from "../seats/ledger";

const seats = new Hono<AppEnv>();
seats.use("*", requireAuth, requireTask("addmembers", "admin"));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function readBody(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  const body = (await c.req.json().catch(() => ({}))) as unknown;
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

// ── GET / ────────────────────────────────────────────────────────────────────

seats.get("/", async (c) => {
  const { edition, id } = c.var.user;
  return c.json(await readSeatsView(c.env, edition, id));
});

// ── POST /members — a member is only ever created into a seat that exists ────

seats.post("/members", async (c) => {
  const { edition, id: viewerId } = c.var.user;
  const body = await readBody(c);

  const tier = body.tier;
  if (!isSeatTier(tier)) return c.json({ error: "invalid_tier" }, 400);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email)) return c.json({ error: "invalid_email" }, 400);
  const role = typeof body.role === "string" ? body.role : "";
  if (!(creatableStaffRoles(edition) as readonly string[]).includes(role)) {
    return c.json({ error: "invalid_role" }, 400);
  }

  const holders = await seatHolders(c.env, edition);
  // `#su-superbox`: "Nominate a super user above to start adding team members."
  // Every workspace this application creates has exactly one, and W4-A's
  // transfer-ownership keeps it that way — so this refusal guards an invariant
  // rather than a step, and it is enforced here rather than only drawn.
  if (!holders.some((h) => h.role === "superuser" && h.active === 1)) {
    return c.json(
      { error: "superuser_required", message: "Nominate a super user to start adding team members." },
      409,
    );
  }

  const summary = await readSeatSummary(c.env, edition);
  const refusal = seatRefusal(summary, tier);
  if (refusal) return c.json(refusal, 409);

  // Creation itself is W4-A's route, reused whole — its validation, its invite
  // email, its audit row and its temporary-credential rules — rather than
  // re-implemented beside it. The capacity check above is what this route adds.
  const forwarded = await users.request(
    "/",
    {
      method: "POST",
      headers: { cookie: c.req.header("cookie") ?? "", "content-type": "application/json" },
      body: JSON.stringify({
        name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : nameFromEmail(email),
        email,
        role,
        userType: "staff",
        title: typeof body.title === "string" ? body.title : undefined,
      }),
    },
    c.env,
  );
  const created = (await forwarded.json().catch(() => ({}))) as Record<string, unknown> & {
    user?: { id: string };
  };
  if (!forwarded.ok || !created.user?.id) {
    return c.json(created, forwarded.status as 400 | 403 | 409 | 500);
  }

  await c.env.DB.prepare("UPDATE users SET plan_tier = ? WHERE id = ? AND edition = ?")
    .bind(tier, created.user.id, edition)
    .run();
  await recordAudit(c, {
    category: "team",
    action: "seat_assigned",
    summary: `Assigned a ${PLAN_LABELS[tier]} seat to ${email}`,
    detail: { tier },
    targetType: "user",
    targetId: created.user.id,
  });

  return c.json({
    ...created,
    user: { ...created.user, tier },
    seats: await readSeatsView(c.env, edition, viewerId),
  });
});

// ── PUT /members/:id/tier — the per-member plan toggle ───────────────────────

seats.put("/members/:id/tier", async (c) => {
  const { edition, id: viewerId, role: viewerRole } = c.var.user;
  const body = await readBody(c);
  const tier = body.tier;
  if (!isSeatTier(tier)) return c.json({ error: "invalid_tier" }, 400);

  const holders = await seatHolders(c.env, edition);
  const target = holders.find((h) => h.id === c.req.param("id"));
  if (!target) return c.json({ error: "not_found" }, 404);
  // The account owner's row is immutable to everyone but its owner — the rule
  // `PATCH /api/users/:id` already applies to it (`immutable_superuser`).
  if (target.role === "superuser" && !(viewerRole === "superuser" && target.id === viewerId)) {
    return c.json({ error: "immutable_superuser" }, 403);
  }

  const refusal = tierMoveRefusal(await readSeatSummary(c.env, edition), target.plan_tier, tier);
  if (refusal) return c.json(refusal, 409);

  if (target.plan_tier !== tier) {
    await c.env.DB.prepare("UPDATE users SET plan_tier = ? WHERE id = ? AND edition = ?")
      .bind(tier, target.id, edition)
      .run();
    await recordAudit(c, {
      category: "team",
      action: "seat_tier_changed",
      summary: `Moved ${target.email} from a ${PLAN_LABELS[target.plan_tier]} seat to a ${PLAN_LABELS[tier]} seat`,
      detail: { from: target.plan_tier, to: tier },
      targetType: "user",
      targetId: target.id,
    });
  }
  return c.json({ ok: true, seats: await readSeatsView(c.env, edition, viewerId) });
});

// ── POST /purchase — records an order; takes no card and charges nothing ─────

seats.post("/purchase", async (c) => {
  const { edition, id: viewerId } = c.var.user;
  const body = await readBody(c);

  const [subscription, book] = await Promise.all([readSubscription(c.env, edition), readPublishedBook(c.env)]);
  const currency = subscription.currency;
  const order = seatOrder(body.quantities, seatPricesFromBook(book, currency), taxSettingsFromBook(book), currency);
  if (isSeatOrderError(order)) return c.json(order, 400);

  const intent = await recordPaymentIntent(c.env, {
    edition,
    purpose: "seat",
    // One order may span tiers, so it names no single catalogue plan.
    planCode: null,
    planName: `Seats · ${describeSeatOrder(order)}`,
    units: null,
    quantity: order.seats,
    currency,
    money: order.money,
    actorId: viewerId,
  });

  // A RECORDED order is provisioned now and invoiced by follow-up; a checkout
  // that is still with a provider provisions nothing until the provider
  // confirms; a failed one provisions nothing at all. See §8 Q65.
  const granted =
    intent.status === "recorded"
      ? await writeSeatGrants(c.env, { edition, order, intentId: intent.id, actorId: viewerId, status: "granted" })
      : intent.status === "redirected"
        ? await writeSeatGrants(c.env, { edition, order, intentId: intent.id, actorId: viewerId, status: "pending" })
        : { standard: 0, pro: 0, premium: 0 };

  await recordAudit(c, {
    category: "billing",
    action: "seat_intent_recorded",
    summary:
      `Seat order recorded — ${describeSeatOrder(order)} · ` +
      `${formatMinor(order.money.totalMinor, currency)} ${moneyNote(order.money)} · no payment taken`,
    detail: { intentId: intent.id, status: intent.status, lines: order.lines, granted },
    targetType: "billing_payment_intents",
    targetId: intent.id,
  });

  const result: SeatPurchaseResult = {
    ok: true,
    completed: false,
    paymentTaken: false,
    intent: { id: intent.id, status: intent.status, checkoutUrl: intent.checkoutUrl },
    order,
    seatsGranted: granted,
    seats: await readSeatsView(c.env, edition, viewerId),
    message:
      intent.status === "redirected"
        ? "Continue on the payment provider's own page to complete this purchase. Your seats are added once it confirms."
        : intent.status === "failed"
          ? "The payment provider could not start a checkout, so nothing was charged and no seats were added."
          : "Seat order recorded and your seats are ready to assign. No payment provider is configured, so " +
            "nothing has been charged — our team will follow up to invoice it.",
  };
  return c.json(result);
});

export { seats };
export default seats;
