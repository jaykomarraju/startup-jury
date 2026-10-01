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
// T1-PEOPLE — T0's one scope helper. Named `tenantScopeOf` here because this file
// already has a `scopeOf`, which answers an unrelated question (user vs workspace
// PREFERENCE layer) and predates the wave by months. Two different scopes, one of
// which is a customer and one of which is a row's audience: renaming either would
// be worse than qualifying the import.
import { insertScope, scopeOf as tenantScopeOf, scoped } from "../../shared/tenant";
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
  const { id: userId } = c.var.user;
  // The `user_id IS NULL` row is the WORKSPACE DEFAULT, keyed by
  // `(edition, event_key, channel)` and nothing else — so unscoped, this read
  // merged another customer's notification policy into this person's resolved
  // grid, and `canEditWorkspace` below let an admin write it back. The per-user
  // half was already safe (`users.id` is globally unique); the default row is the
  // one that needed the tenant, and `0099` re-cut both partial uniques to match.
  const q = scoped(tenantScopeOf(c.var.user))
    .on("np")
    .and("(np.user_id IS NULL OR np.user_id = ?)", userId);
  const rows = (
    await c.env.DB.prepare(
      `SELECT np.user_id, np.event_key, np.channel, np.enabled FROM notification_preferences np ${q.whereClause()}`,
    )
      .bind(...q.binds)
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

  const { id: userId } = c.var.user;
  const tenantScope = tenantScopeOf(c.var.user);
  const owner = scope === "workspace" ? null : userId;
  const ts = new Date().toISOString();

  // `0031` carries two PARTIAL unique indexes — one for the per-user row and one
  // for the workspace default — because SQLite treats every NULL as distinct and
  // a plain UNIQUE would let the default be inserted twice. A partial index
  // cannot back ON CONFLICT, so the upsert is an UPDATE that falls through to an
  // INSERT when it matched nothing.
  // The UPDATE's predicate is what decides whether this is an update or an insert,
  // so an unscoped one would have found ANOTHER customer's row, changed it, and
  // reported `changes: 1` — a write that lands in the wrong workspace and never
  // reaches the INSERT arm, which is the silent shape §5b warns about with the
  // 200-and-a-row response.
  const t = insertScope(tenantScope);
  for (const w of writes) {
    const q = scoped(tenantScope)
      .on("notification_preferences")
      .and("notification_preferences.event_key = ?", w.event)
      .and("notification_preferences.channel = ?", w.channel);
    if (owner) q.and("notification_preferences.user_id = ?", owner);
    else q.andRaw("notification_preferences.user_id IS NULL");
    const updated = await c.env.DB.prepare(
      `UPDATE notification_preferences SET enabled = ?, updated_at = ? ${q.whereClause()}`,
    )
      .bind(w.enabled ? 1 : 0, ts, ...q.binds)
      .run();
    if (updated.meta.changes === 0) {
      await c.env.DB.prepare(
        `INSERT INTO notification_preferences (id, ${t.columns}, user_id, event_key, channel, enabled, updated_at) ` +
          `VALUES (?, ${t.placeholders}, ?, ?, ?, ?, ?)`,
      )
        .bind(
          `np_${crypto.randomUUID()}`,
          ...t.binds,
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
  const q = scoped(tenantScopeOf(c.var.user))
    .on("notification_preferences")
    .and("notification_preferences.user_id = ?", c.var.user.id);
  await c.env.DB.prepare(`DELETE FROM notification_preferences ${q.whereClause()}`)
    .bind(...q.binds)
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

/**
 * GET /api/notifications/bell — the caller's recent alerts + unread count.
 *
 * `tenant-scope.test.ts` records this route as `unprobed` rather than leaking, and
 * the reason it gives is right: it is scoped per USER, so a tenant-A principal
 * could not see a tenant-B row even with no tenant predicate at all. The scope is
 * added anyway, and both halves of it, because `notifications` is one of the 30
 * tenant-keyed tables and "the predicate it already had happens to be sufficient"
 * is an argument that has to be re-made by every reader. The leak §2 B22 names on
 * this surface is the OUTBOUND one, in `email/outbox.ts`.
 */
notifications.get("/bell", async (c) => {
  const q = scoped(tenantScopeOf(c.var.user)).on("n").and("n.user_id = ?", c.var.user.id);
  const rows = (
    await c.env.DB.prepare(
      "SELECT n.id, n.event_key, n.title, n.body, n.link, n.deck_id, n.read_at, n.created_at " +
        `FROM notifications n ${q.whereClause()} ORDER BY n.created_at DESC LIMIT ?`,
    )
      // The builder owns the WHERE clause and its binds; `LIMIT` is a TAIL bind and
      // goes after them, which is the one bind-order rule `src/shared/tenant.ts`
      // states.
      .bind(...q.binds, BELL_LIMIT)
      .all<NotificationRow>()
  ).results;

  // Counted over the whole table, not the page: a bell that says "3" while
  // holding twenty unread rows is worse than no count at all.
  const u = scoped(tenantScopeOf(c.var.user))
    .on("n")
    .and("n.user_id = ?", c.var.user.id)
    .andRaw("n.read_at IS NULL");
  const unread = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM notifications n ${u.whereClause()}`,
  )
    .bind(...u.binds)
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
  const q = scoped(tenantScopeOf(c.var.user))
    .on("notifications")
    .and("notifications.user_id = ?", c.var.user.id)
    .andRaw("notifications.read_at IS NULL");
  // An id belonging to someone else matches nothing rather than 403-ing and
  // confirming it exists — the same reasoning the route already applied to a
  // sibling user, now applied to another customer as well.
  if (typeof body.id === "string") q.and("notifications.id = ?", body.id);
  await c.env.DB.prepare(`UPDATE notifications SET read_at = ? ${q.whereClause()}`)
    .bind(ts, ...q.binds)
    .run();
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
  const scope = tenantScopeOf(c.var.user);
  // ── THE TENANT HALF IS NOW DIRECT; THE EDITION HALF IS STILL BY PROXY ──────
  // `email_outbox` has a `tenant_id` COLUMN as of `0086`, which is the plan
  // correction §5b forced: it classifies this table as "scoped by proxy", but
  // `deck_id` and `query_id` are both nullable, so there is no join that scopes
  // it. `onTenantOnly` because the column arrived without an `edition` companion —
  // the table predates the two-edition split and adding one needs a migration plus
  // a stamp at every `sendEmail` call site, which this session has no slot for.
  //
  // So the edition half keeps the COALESCE this route already had, and it still
  // fails CLOSED: mail to a non-user with no deck drops out of the log rather than
  // crossing. What the tenant predicate adds is the half that matters — the
  // COALESCE alone would have shown one customer's admin every other customer's
  // recipient addresses and subject lines in the same edition.
  //
  // AND THE `users` JOIN ITSELF CHANGED MEANING. It was `ON u.email = o.to_email`,
  // which was single-valued only because `users.email` was globally UNIQUE.
  // `0087` made it `UNIQUE (tenant_id, email)`, so an address held by two customers
  // now matches two rows and would DUPLICATE every outbox entry addressed to that
  // person — and the duplicate would carry the other customer's edition, defeating
  // the COALESCE. `AND u.tenant_id = o.tenant_id` is what makes the join
  // single-valued again, and it costs no bind.
  const q = scoped(scope)
    .onTenantOnly("o")
    .and("COALESCE(d.edition, u.edition) = ?", scope.edition);
  const rows = (
    await c.env.DB.prepare(
      "SELECT o.id AS id, o.kind AS kind, o.to_email AS to_email, o.to_name AS to_name, " +
        "o.subject AS subject, o.status AS status, o.error AS error, o.created_at AS created_at " +
        "FROM email_outbox o " +
        "LEFT JOIN decks d ON d.id = o.deck_id AND d.tenant_id = o.tenant_id " +
        "LEFT JOIN users u ON u.email = o.to_email AND u.tenant_id = o.tenant_id " +
        `${q.whereClause()} ` +
        "ORDER BY o.created_at DESC LIMIT ?",
    )
      .bind(...q.binds, OUTBOX_LIMIT)
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
