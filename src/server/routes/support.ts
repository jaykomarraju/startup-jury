// Phase 7 — Tickets & Contact. Support tickets (billing-routed) surface on the
// admin-only Tickets screen; contact messages (to Admin / to team) back the
// Collaborate nav for every role. Tables `tickets` + `messages` exist from 0001.

import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../types";
import { requireAuth, requireRole } from "../auth/middleware";

async function readBody<T>(c: Context<AppEnv>): Promise<Partial<T>> {
  return (await c.req.json().catch(() => ({}))) as Partial<T>;
}

// ── Tickets ──────────────────────────────────────────────────────────────────

const tickets = new Hono<AppEnv>();
tickets.use("*", requireAuth);

/** GET /api/tickets — every ticket in the edition (admin-only Tickets screen). */
tickets.get("/", requireRole("admin"), async (c) => {
  const rows = (
    await c.env.DB.prepare(
      "SELECT t.id, t.subject, t.body, t.status, t.billing_routed, t.created_at, u.name AS creator " +
        "FROM tickets t LEFT JOIN users u ON u.id = t.created_by WHERE t.edition = ? ORDER BY t.created_at DESC",
    )
      .bind(c.var.user.edition)
      .all<{
        id: string;
        subject: string;
        body: string | null;
        status: string;
        billing_routed: number;
        created_at: string;
        creator: string | null;
      }>()
  ).results;
  return c.json({
    tickets: rows.map((t) => ({
      id: t.id,
      subject: t.subject,
      body: t.body,
      status: t.status,
      billingRouted: t.billing_routed === 1,
      createdAt: t.created_at,
      creator: t.creator ?? "—",
    })),
  });
});

/** POST /api/tickets — raise a support ticket (any authed user). */
tickets.post("/", async (c) => {
  const body = await readBody<{ subject: string; body: string; billing: boolean }>(c);
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  if (!subject) return c.json({ error: "subject_required" }, 400);
  const text = typeof body.body === "string" ? body.body.trim() : "";
  // Route to billing when flagged, or when the text obviously concerns credits.
  const billingRouted =
    body.billing === true || /\b(billing|credit|invoice|payment|refund)\b/i.test(`${subject} ${text}`);
  const id = `tkt_${crypto.randomUUID()}`;
  await c.env.DB.prepare(
    "INSERT INTO tickets (id, edition, subject, body, status, created_by, billing_routed) VALUES (?, ?, ?, ?, 'open', ?, ?)",
  )
    .bind(id, c.var.user.edition, subject, text || null, c.var.user.id, billingRouted ? 1 : 0)
    .run();
  return c.json({ ok: true, id, billingRouted });
});

/** POST /api/tickets/:id/status — open/close a ticket (admin). */
tickets.post("/:id/status", requireRole("admin"), async (c) => {
  const body = await readBody<{ status: string }>(c);
  const status = body.status === "closed" ? "closed" : "open";
  const res = await c.env.DB.prepare(
    "UPDATE tickets SET status = ? WHERE id = ? AND edition = ?",
  )
    .bind(status, c.req.param("id"), c.var.user.edition)
    .run();
  if (res.meta.changes !== 1) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true, status });
});

// ── Contact messages ─────────────────────────────────────────────────────────

const messages = new Hono<AppEnv>();
messages.use("*", requireAuth);

/** GET /api/messages?scope=admin|team — the caller's sent messages in that scope;
 *  admins additionally see every message addressed to 'admin'. */
messages.get("/", async (c) => {
  const user = c.var.user;
  const scope = c.req.query("scope") === "team" ? "team" : "admin";
  const isAdmin = user.role === "admin" || user.role === "superuser";
  // Admin inbox for the 'admin' scope: all messages; otherwise the caller's own.
  const rows =
    isAdmin && scope === "admin"
      ? (
          await c.env.DB.prepare(
            "SELECT m.id, m.body, m.to_scope, m.created_at, u.name AS sender FROM messages m " +
              "LEFT JOIN users u ON u.id = m.from_id WHERE m.edition = ? AND m.to_scope = ? ORDER BY m.created_at DESC",
          )
            .bind(user.edition, scope)
            .all<{ id: string; body: string; to_scope: string; created_at: string; sender: string | null }>()
        ).results
      : (
          await c.env.DB.prepare(
            "SELECT m.id, m.body, m.to_scope, m.created_at, u.name AS sender FROM messages m " +
              "LEFT JOIN users u ON u.id = m.from_id WHERE m.edition = ? AND m.to_scope = ? AND m.from_id = ? ORDER BY m.created_at DESC",
          )
            .bind(user.edition, scope, user.id)
            .all<{ id: string; body: string; to_scope: string; created_at: string; sender: string | null }>()
        ).results;
  return c.json({
    messages: rows.map((m) => ({
      id: m.id,
      body: m.body,
      toScope: m.to_scope,
      createdAt: m.created_at,
      sender: m.sender ?? "—",
    })),
    inbox: isAdmin && scope === "admin",
  });
});

/** POST /api/messages — send a contact message to Admin or the team. */
messages.post("/", async (c) => {
  const body = await readBody<{ toScope: string; body: string }>(c);
  const toScope = body.toScope === "team" ? "team" : "admin";
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!text) return c.json({ error: "body_required" }, 400);
  const id = `msg_${crypto.randomUUID()}`;
  await c.env.DB.prepare(
    "INSERT INTO messages (id, edition, from_id, to_scope, body) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(id, c.var.user.edition, c.var.user.id, toScope, text)
    .run();
  return c.json({ ok: true, id });
});

export { tickets, messages };
