/**
 * W3-B — Admin console → System → **Notifications** (`admin/s-nt.html`), the
 * topbar bell, and the delivery log beneath both.
 *
 * The prototype's section is ten toggles under a sub-line that scopes them to
 * one person — "…for your account" — so the preference surface here is
 * **per-user by default and admin-only for the workspace policy**:
 *
 *   • `GET /`, `PUT /preferences` — the SIGNED-IN user's own mask. Open to any
 *     authenticated non-mentor role, which is what the prototype's own scoping
 *     requires and what §8 Q16 leaves half-answered: the console that hosts the
 *     screen is admin-only today, so a jury member cannot yet reach a page that
 *     calls this. The API is the half this session can settle; the reachability
 *     half needs the client's answer, and is recorded in §8.
 *   • `?scope=workspace` + `PUT /preferences?scope=workspace` — the DEFAULT row
 *     (`user_id IS NULL`) every user inherits until they override it. Admin
 *     only, gated on the same `adminconsole` task as every other console
 *     surface, so revoking that cell closes the console and its API together.
 *
 * The bell reads `/bell` and writes `/read`; both are per-user by definition and
 * carry no gate beyond authentication.
 *
 * `/outbox` is F0144 — `email_outbox` has been the delivery audit since Phase 4
 * and no screen has ever read it, which is how "email is configured" and "email
 * is delivering" became indistinguishable. Admin only: it names every recipient
 * the workspace has mailed.
 *
 * Mounted at `/api/notifications` per the plan's §10 server-route ownership.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../types";
import type { Edition } from "../../shared/roles";
import { denyMentor, requireAuth, requireTask } from "../auth/middleware";
import { emailDeliveryConfigured } from "../email/outbox";
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_DEFAULTS,
  NOTIFICATION_EVENTS,
  isNotificationChannel,
  isNotificationEvent,
  notificationLabel,
  notificationSubLabel,
  type NotificationChannel,
  type NotificationEvent,
  type NotificationPreferenceView,
  type NotificationView,
  type OutboxEntryView,
} from "../../shared/notifications";

const notifications = new Hono<AppEnv>();
// A mentor is a directory record with no screens (`denyMentor`), so it is never
// a candidate for an alert and has no preferences to read.
notifications.use("*", requireAuth, denyMentor);

/** The gate every other console surface uses (W3-A). */
const requireConsole = requireTask("adminconsole", "admin");

// ── Preferences ──────────────────────────────────────────────────────────────

interface PrefRow {
  user_id: string | null;
  event_key: string;
  channel: string;
  enabled: number;
}

type Scope = "user" | "workspace";

function scopeOf(c: Context<AppEnv>): Scope {
  return c.req.query("scope") === "workspace" ? "workspace" : "user";
}

/**
 * The full ten-by-two grid for one scope, with every cell resolved.
 *
 * A user-scope read merges the two layers so the section renders what the
 * person would actually receive, and `source` says which layer each cell came
 * from — that is the difference between "I turned this off" and "the workspace
 * has it off", which a bare boolean cannot express.
 */
async function readGrid(
  c: Context<AppEnv>,
  scope: Scope,
): Promise<NotificationPreferenceView[]> {
  const { edition, id: userId } = c.var.user;
  const rows = (
    await c.env.DB.prepare(
      "SELECT user_id, event_key, channel, enabled FROM notification_preferences " +
        "WHERE edition = ? AND (user_id IS NULL OR user_id = ?)",
    )
      .bind(edition, userId)
      .all<PrefRow>()
  ).results;

  const defaults = new Map<string, boolean>();
  const mine = new Map<string, boolean>();
  for (const r of rows) {
    const key = `${r.event_key}:${r.channel}`;
    if (r.user_id === null) defaults.set(key, r.enabled === 1);
    else mine.set(key, r.enabled === 1);
  }

  const grid: NotificationPreferenceView[] = [];
  for (const event of NOTIFICATION_EVENTS) {
    for (const channel of NOTIFICATION_CHANNELS) {
      const key = `${event}:${channel}`;
      const fallback = defaults.get(key) ?? NOTIFICATION_DEFAULTS[event];
      if (scope === "workspace") {
        grid.push({ event, channel, enabled: fallback, source: "default" });
      } else {
        const own = mine.get(key);
        grid.push({
          event,
          channel,
          enabled: own ?? fallback,
          source: own === undefined ? "default" : "user",
        });
      }
    }
  }
  return grid;
}

/** The section's own copy, resolved for the caller's edition (F0181). */
function eventCatalogue(edition: Edition) {
  return NOTIFICATION_EVENTS.map((event) => ({
    event,
    label: notificationLabel(event, edition),
    sub: notificationSubLabel(event),
  }));
}

/**
 * GET /api/notifications — the section's whole payload.
 *
 * `delivery` is F0143: shipping toggles over a transport that is not delivering
 * would present a working feature that silently never arrives. With no verified
 * sending domain the section says so in as many words, and the outbox statuses
 * below back it up.
 */
/**
 * The section's whole state, for one scope.
 *
 * **Every** verb on this router answers with exactly this shape, not just the
 * GET. The client replaces its state wholesale from whichever call it last
 * made, so a write that answered `{ok, scope, preferences}` left `delivery` and
 * `events` undefined and crashed the next render — which is precisely what the
 * e2e walk caught, and what a partial write response will always cost.
 */
async function gridPayload(c: Context<AppEnv>, scope: Scope) {
  return {
    scope,
    edition: c.var.user.edition,
    events: eventCatalogue(c.var.user.edition),
    channels: NOTIFICATION_CHANNELS,
    preferences: await readGrid(c, scope),
    delivery: { configured: emailDeliveryConfigured(c.env) },
    canEditWorkspace: await c.var.perms.can("adminconsole"),
  };
}

notifications.get("/", async (c) => {
  const scope = scopeOf(c);
  if (scope === "workspace") {
    const gate = await guardWorkspace(c);
    if (gate) return gate;
  }
  return c.json(await gridPayload(c, scope));
});

/** Workspace-scope writes are an admin act; per-user ones are not. */
async function guardWorkspace(c: Context<AppEnv>): Promise<Response | null> {
  const user = c.var.user;
  if (user.role !== "admin" && user.role !== "superuser") {
    return c.json({ error: "forbidden" }, 403);
  }
  if (!(await c.var.perms.can("adminconsole"))) return c.json({ error: "forbidden" }, 403);
  return null;
}

interface PrefWrite {
  event: NotificationEvent;
  channel: NotificationChannel;
  enabled: boolean;
}

/**
 * PUT /api/notifications/preferences — write one or more cells.
 *
 * Partial by design: the section flips one toggle at a time and the bulk case
 * (the console's Save changes button) posts the cells that moved, never the
 * whole grid. An unknown event or channel is a 400 rather than a silent skip,
 * because a typo'd `event_key` would otherwise persist as a row that governs
 * nothing and reads as a working preference.
 */
notifications.put("/preferences", async (c) => {
  const scope = scopeOf(c);
  if (scope === "workspace") {
    const gate = await guardWorkspace(c);
    if (gate) return gate;
  }

  const body = (await c.req.json().catch(() => ({}))) as { preferences?: unknown };
  const raw = Array.isArray(body.preferences) ? body.preferences : [];
  if (raw.length === 0) return c.json({ error: "no_preferences" }, 400);

  const writes: PrefWrite[] = [];
  for (const item of raw) {
    const p = item as Partial<PrefWrite>;
    if (!isNotificationEvent(p.event)) return c.json({ error: "unknown_event" }, 400);
    if (!isNotificationChannel(p.channel)) return c.json({ error: "unknown_channel" }, 400);
    if (typeof p.enabled !== "boolean") return c.json({ error: "invalid_enabled" }, 400);
    writes.push({ event: p.event, channel: p.channel, enabled: p.enabled });
  }

  const { edition, id: userId } = c.var.user;
  const owner = scope === "workspace" ? null : userId;
  const ts = new Date().toISOString();

  // `0031` carries two PARTIAL unique indexes — one for the per-user row and one
  // for the workspace default — because SQLite treats every NULL as distinct and
  // a plain UNIQUE would let the default be inserted twice. A partial index
  // cannot back ON CONFLICT, so the upsert is an UPDATE that falls through to an
  // INSERT when it matched nothing.
  for (const w of writes) {
    const updated = await c.env.DB.prepare(
      "UPDATE notification_preferences SET enabled = ?, updated_at = ? " +
        `WHERE edition = ? AND event_key = ? AND channel = ? AND user_id IS ${owner ? "?" : "NULL"}`,
    )
      .bind(...[w.enabled ? 1 : 0, ts, edition, w.event, w.channel, ...(owner ? [owner] : [])])
      .run();
    if (updated.meta.changes === 0) {
      await c.env.DB.prepare(
        "INSERT INTO notification_preferences (id, edition, user_id, event_key, channel, enabled, updated_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
        .bind(
          `np_${crypto.randomUUID()}`,
          edition,
          owner,
          w.event,
          w.channel,
          w.enabled ? 1 : 0,
          ts,
        )
        .run();
    }
  }

  return c.json({ ok: true, ...(await gridPayload(c, scope)) });
});

/**
 * DELETE /api/notifications/preferences — drop the caller's own overrides and
 * fall back to the workspace policy. The section's "Reset to workspace
 * defaults"; never touches the default rows themselves.
 */
notifications.delete("/preferences", async (c) => {
  const { edition, id } = c.var.user;
  await c.env.DB.prepare(
    "DELETE FROM notification_preferences WHERE edition = ? AND user_id = ?",
  )
    .bind(edition, id)
    .run();
  return c.json({ ok: true, ...(await gridPayload(c, "user")) });
});

// ── The bell ─────────────────────────────────────────────────────────────────

interface NotificationRow {
  id: string;
  event_key: string;
  title: string;
  body: string | null;
  link: string | null;
  deck_id: string | null;
  read_at: string | null;
  created_at: string;
}

/** How many rows the popover holds. The bell is a recent list, not an archive. */
const BELL_LIMIT = 20;

function toView(r: NotificationRow): NotificationView {
  return {
    id: r.id,
    event: r.event_key as NotificationEvent,
    title: r.title,
    body: r.body,
    link: r.link,
    deckId: r.deck_id,
    readAt: r.read_at,
    createdAt: r.created_at,
  };
}

/** GET /api/notifications/bell — the caller's recent alerts + unread count. */
notifications.get("/bell", async (c) => {
  const rows = (
    await c.env.DB.prepare(
      "SELECT id, event_key, title, body, link, deck_id, read_at, created_at FROM notifications " +
        "WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
    )
      .bind(c.var.user.id, BELL_LIMIT)
      .all<NotificationRow>()
  ).results;

  // Counted over the whole table, not the page: a bell that says "3" while
  // holding twenty unread rows is worse than no count at all.
  const unread = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL",
  )
    .bind(c.var.user.id)
    .first<{ n: number }>();

  return c.json({ notifications: rows.map(toView), unread: unread?.n ?? 0 });
});

/**
 * POST /api/notifications/read — mark one notification read, or all of them.
 * Scoped to the caller's own rows in the WHERE clause, so an id belonging to
 * someone else matches nothing rather than 403-ing and confirming it exists.
 */
notifications.post("/read", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { id?: unknown };
  const ts = new Date().toISOString();
  if (typeof body.id === "string") {
    await c.env.DB.prepare(
      "UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL",
    )
      .bind(ts, body.id, c.var.user.id)
      .run();
  } else {
    await c.env.DB.prepare(
      "UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL",
    )
      .bind(ts, c.var.user.id)
      .run();
  }
  return c.json({ ok: true });
});

// ── The delivery log (F0144) ─────────────────────────────────────────────────

interface OutboxRow {
  id: string;
  kind: string;
  to_email: string;
  to_name: string | null;
  subject: string;
  status: string;
  error: string | null;
  created_at: string;
}

const OUTBOX_LIMIT = 50;

/** GET /api/notifications/outbox — what the app has actually mailed, and how it went. */
notifications.get("/outbox", requireConsole, async (c) => {
  const rows = (
    await c.env.DB.prepare(
      "SELECT id, kind, to_email, to_name, subject, status, error, created_at FROM email_outbox " +
        "ORDER BY created_at DESC LIMIT ?",
    )
      .bind(OUTBOX_LIMIT)
      .all<OutboxRow>()
  ).results;

  const entries: OutboxEntryView[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    toEmail: r.to_email,
    toName: r.to_name,
    subject: r.subject,
    status: r.status as OutboxEntryView["status"],
    error: r.error,
    createdAt: r.created_at,
  }));

  return c.json({ entries, delivery: { configured: emailDeliveryConfigured(c.env) } });
});

export default notifications;
