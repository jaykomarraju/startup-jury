// Phase 7 — Tickets & Contact. Support tickets (billing-routed) surface on the
// admin-only Tickets screen; contact messages (to Admin / to team) back the
// Collaborate nav for every role. Tables `tickets` + `messages` exist from 0001.
//
// V3 item 15 adds the **JURYbuddy help clips** router: one read-only route that
// streams an FAQ clip out of R2. The FAQ text itself is bundled client-side
// (`src/client/routes/help/faqs.ts`) — only the 5.86 MB of video is served.
//
// Session 7 adds the **internal issue log** on the same `tickets` table, split by
// `tickets.category` ('support' vs 'issue', migration 0018). One table, two
// queues: the support queue is customer-facing triage, the issue log is where
// the team records what it finds while testing. Both routers filter on the
// category, so neither can ever see the other's rows.

// ── T1-COMMERCE · tenancy ───────────────────────────────────────────────────
// §2 B20 calls `/api/tickets`, `/api/issues` and `/api/messages` "the exact
// surface the client's tenancy sentence is about. Today every ticket sits in one
// flat edition-keyed pool with no upstream." `tickets` and `messages` are two of
// the 28 tenant-owned tables, so every statement below binds the WORKSPACE —
// `(tenant_id, edition)` — through T0's one helper.
//
// The help-clip router at the bottom is deliberately NOT scoped: it streams
// product documentation out of R2, identical for every role, every edition and
// every customer. Its own header already says there is nothing per-user to check
// beyond holding a session, and that is a statement about tenancy too.
//
// The two-queue split stays exactly as it was. `tickets.category` separates the
// customer-facing support queue from the internal issue log, and that predicate is
// orthogonal to the tenant one: a scope says WHOSE rows, a category says WHICH
// queue, and both still apply to every statement.

// ── L5 · AND THE OTHER BOUNDARY, WHICH THE TENANCY PASS DID NOT TOUCH ────────
// A scope says whose rows; it does not say WHICH OF THAT CUSTOMER'S OWN PEOPLE may
// read them. `GET /api/messages?scope=team` was scoped correctly and still returned
// the staff channel to every session in the workspace, founders and mentors
// included. `canUseTeamChannel` below is that second predicate, and it is taken from
// the nav manifest rather than restated here. Nothing about the tenant arm changed.
//
// Re-measured 2026-10-23 for tracker row 13, because the brief for that row described
// this hole as still open (`:331` "is `messages.use("*", requireAuth)` and nothing
// more"). It is not: `79bfcd1` closed it on 2026-10-05. Mutating the two lines back to
// that shape turns exactly three cases in `test/worker/l5-hardening.test.ts` red — the
// founder's read, the mentor's read and the founder's write — and restoring them turns
// them green, so those cases are real controls and not ones that pass vacuously.
// They stay the one proof of this boundary; `test/worker/tickets.test.ts` proves the
// same two principals at the TICKET router's edge instead of copying them.

// ── WAVE A · P3 · TICKETS, RAISE TO CLOSE (tracker row 13) ──────────────────
// "Tickets module from raise to close with status and notifications." Raise and a
// binary open/closed toggle existed; three things did not:
//
//   1. THE MIDDLE STEP. `POST /:id/status` stored `body.status === "closed" ?
//      "closed" : "open"`, so `in_progress` — the issue log's middle step on this same
//      table and column since `0018` — was silently written as `open`. The workflow is
//      now the issue log's three values, and anything else is refused, not coerced.
//   2. A CLOSE THAT SAYS WHY. Closing requires a resolution and stores it in
//      `tickets.resolution`, which `0018` added and only the issue log ever wrote.
//   3. SOMEBODY BEING TOLD. A raise alerts the people who triage; every status change
//      alerts the person who raised it. See `notifyRaiser` / `notifyTriagers`.
//
// And the raise moved to where the prototype puts it. In all eleven prototype files
// that have the screen — five incubator, all six VC — Contact Admin is "Raise a support
// ticket for any issue": category, priority, subject, description, beside "My recent
// tickets" (`AISJ_IC_PM_V5.HTM`, `#panel-contactadmin`).
// The build had it as a free-text message to an inbox, so a jury member could raise a
// ticket only by typing `curl`, and the only person who could see a ticket's status
// was the admin closing it. `GET /mine` is the raiser's half of the loop.
//
// ── WHAT A TICKET DOES NOT SEND, AND WHY NO SCREEN CLAIMS IT DOES ───────────
// Ticket alerts are IN-APP ONLY. Email would need an `EmailKind`, and that union is
// in `email/outbox.ts:73-81`, which is not this lane's file — its brief placed it in
// `shared/notifications.ts`, which holds only the event list the `alert_*` members
// are derived from. Widening THAT list is not the honest route either: it is the
// prototype's ten-row toggle grid, and `AUDIENCE` (`outbox.ts:700`) is an exhaustive
// `Record` over it that would stop compiling. Borrowing an existing kind is the
// shortcut `registration.ts:539` records and this repo is removing. So the email half
// is reported as a one-line change to that union plus one `sendEmail` per recipient
// here, rather than faked.
//
// What that costs today is nothing anybody would receive: `EMAIL_FROM` is "", so
// every message the outbox takes is `status='recorded'` and dispatched to no one.
// In-app is the only channel that currently reaches a person, and the response's
// `notified` (`TicketNotice`) names only those whose `notifications` row was actually
// written. The screens say "notified in the app" — never "sent", never "emailed".
import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv, Env, SessionUser } from "../types";
import { denyMentor, requireAuth, requireRole } from "../auth/middleware";
import { canAccessNav } from "../../shared/nav";
import { ROLES_BY_EDITION, isMentor, roleLabel } from "../../shared/roles";
import type { TicketNotice, TicketNotificationEvent } from "../../shared/notifications";
import { scopeOf, scoped, insertScope, type ScopeBuilder, type TenantScope } from "../../shared/tenant";

/** Issue workflow states. `in_progress` is the "someone is on it" middle step. */
const ISSUE_STATUSES = ["open", "in_progress", "closed"] as const;
const ISSUE_SEVERITIES = ["low", "medium", "high", "critical"] as const;

async function readBody<T>(c: Context<AppEnv>): Promise<Partial<T>> {
  return (await c.req.json().catch(() => ({}))) as Partial<T>;
}

// ── Tickets ──────────────────────────────────────────────────────────────────

const tickets = new Hono<AppEnv>();
// `denyMentor` joins `requireAuth` for the reason it already sits on the two routers
// below (`issues`, `messages`): a mentor is a directory record, and no screen of
// theirs reaches this queue. It matters more than it did, because a raise now ALERTS
// every administrator — an unrefused mentor session could ring every admin's bell in
// the workspace from an account that has no screens at all.
tickets.use("*", requireAuth, denyMentor);

/**
 * The ticket workflow — the SAME three values as the issue log's, on the same table
 * and the same column, so a status string means one thing whichever queue holds the
 * row. The screens label `closed` "Resolved", which is the prototype's word
 * (`tkStatLabel`, `AISJ_ICAdmin_V6.html`); the stored value stays `closed` because
 * the seeded rows, the issue log and every existing reader already use it.
 */
const TICKET_STATUSES = ISSUE_STATUSES;
type TicketStatus = (typeof TICKET_STATUSES)[number];

function isTicketStatus(value: unknown): value is TicketStatus {
  return TICKET_STATUSES.some((s) => s === value);
}

/** The raise form's Priority select (`AISJ_IC_PM_V5.HTM` `#ca-pri`); Medium is preselected there. */
const TICKET_PRIORITIES = ["low", "medium", "high", "urgent"] as const;

// ── Category and priority, without a migration ──────────────────────────────
// The prototype's raise form asks for both, and its queue shows both as columns.
// `0018` already gave this table `area` and `severity` for the issue log, and the two
// queues never read each other's rows — every statement carries `t.category =
// 'support' | 'issue'` — so a support ticket keeps its category in `area` and its
// priority in `severity`. That is not a new convention: the demo seed already writes
// support tickets exactly this way, `area = 'Billing'`, `severity = 'low'`, and a
// resolution on the closed one (`0020_seed_demo_refresh.sql:707-711`) — it was the
// screens that never read them. Note the trap in the names: `tickets.category` is
// the QUEUE, not the prototype's "Issue category". The view calls the two fields
// `area` and `priority`, and `toTicketView` is the only place that knows both.

interface TicketRow {
  id: string;
  subject: string;
  body: string | null;
  status: string;
  billing_routed: number;
  area: string | null;
  severity: string | null;
  resolution: string | null;
  created_at: string;
  updated_at: string | null;
  created_by: string | null;
  creator: string | null;
  creator_role: string | null;
}

/**
 * The queue's FROM clause. The LEFT JOIN also matches the workspace: `u.name` is
 * rendered as the ticket's `creator`, so a `created_by` pointing at another
 * customer's user would print that person's name on this screen. Column-to-column,
 * no bind.
 */
const TICKET_SELECT =
  "SELECT t.id, t.subject, t.body, t.status, t.billing_routed, t.area, t.severity, t.resolution, " +
  "t.created_at, t.updated_at, t.created_by, u.name AS creator, u.role AS creator_role FROM tickets t " +
  "LEFT JOIN users u ON u.id = t.created_by AND u.tenant_id = t.tenant_id AND u.edition = t.edition ";

/** The workspace, and the support queue. Every ticket read starts here. */
const ticketScope = (c: Context<AppEnv>) =>
  scoped(scopeOf(c.var.user)).on("t").andRaw("t.category = 'support'");

function toTicketView(t: TicketRow, viewer: SessionUser) {
  const scope = scopeOf(viewer);
  // The role LABEL ("Program Manager"), because the prototype's row reads "Vikram
  // Nair · Program Manager". Found in the edition's own list rather than cast: a
  // `users.role` outside it (a mentor's historical ticket) has no label to show.
  const role = ROLES_BY_EDITION[scope.edition].find((r) => r === t.creator_role);
  return {
    id: t.id,
    subject: t.subject,
    body: t.body,
    status: t.status,
    billingRouted: t.billing_routed === 1,
    area: t.area,
    priority: t.severity,
    resolution: t.resolution,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    creator: t.creator ?? "—",
    creatorRole: role ? roleLabel(scope.edition, role) : null,
    // So a screen can say why nobody was told — "you raised it" — without the raw
    // `created_by` id leaving the server.
    raisedByMe: t.created_by === viewer.id,
  };
}

async function readTickets(c: Context<AppEnv>, mineOnly: boolean) {
  const q = ticketScope(c);
  if (mineOnly) q.and("t.created_by = ?", c.var.user.id);
  const rows = (
    await c.env.DB.prepare(`${TICKET_SELECT}${q.whereClause()} ORDER BY t.created_at DESC`)
      .bind(...q.binds)
      .all<TicketRow>()
  ).results;
  return rows.map((t) => toTicketView(t, c.var.user));
}

/** GET /api/tickets — every ticket in the workspace (admin-only Tickets screen). */
tickets.get("/", requireRole("admin"), async (c) => c.json({ tickets: await readTickets(c, false) }));

/**
 * GET /api/tickets/mine — the caller's own tickets: Contact Admin's "My recent
 * tickets". Any session the router admits, founders included, because every row it
 * can return is one the caller wrote. `created_by = ?` is the per-user predicate and
 * the scope is the workspace one; neither stands in for the other (the same
 * reasoning as the `admin` arm of `GET /api/messages` below).
 */
tickets.get("/mine", async (c) => c.json({ tickets: await readTickets(c, true) }));

/** POST /api/tickets — raise a support ticket (any authed user). */
tickets.post("/", async (c) => {
  const body = await readBody<{
    subject: string;
    body: string;
    billing: boolean;
    area: string;
    priority: string;
  }>(c);
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  if (!subject) return c.json({ error: "subject_required" }, 400);
  const text = typeof body.body === "string" ? body.body.trim() : "";
  const area = typeof body.area === "string" ? body.area.trim() : "";
  // An unknown priority defaults to Medium, as an unknown issue severity does, and
  // for the same reason: the field is advisory, and refusing a ticket over it would
  // lose the one thing the raiser came to say.
  const priority = TICKET_PRIORITIES.find((p) => p === body.priority) ?? "medium";
  // Route to billing when flagged, or when the text obviously concerns credits. The
  // category is part of the text now: "Billing & subscription" is a billing ticket
  // whatever its subject says.
  const billingRouted =
    body.billing === true ||
    /\b(billing|credit|invoice|payment|refund)\b/i.test(`${subject} ${text} ${area}`);
  const id = `tkt_${crypto.randomUUID()}`;
  // ISO, not the column's `datetime('now')` default: the seeded rows and the issue
  // log both write ISO, and `"2026-10-23 16:00:00"` is not a string every browser's
  // `Date` will parse — Safari returns Invalid Date for it, on the phone the demo
  // is driven from.
  const ts = new Date().toISOString();
  // ── THE SILENT HALF OF THE WAVE, AND THIS IS THE ROUTE THAT NAMES IT ──────
  // `test/worker/tenant-scope.test.ts`'s layer 3 measured this INSERT on
  // 2026-09-30: it named no tenant, so `tickets.tenant_id`'s `DEFAULT 't_default'`
  // (`0084:62`) took effect and a second customer's ticket was filed against the
  // FIRST customer — with a 200, a row, and nothing in the response to notice.
  // Unlike a missing read predicate, no negative control can see that; only the
  // write assertion can. `insertScope` is why the column cannot be forgotten.
  const t = insertScope(scopeOf(c.var.user));
  await c.env.DB.prepare(
    `INSERT INTO tickets (id, ${t.columns}, subject, body, status, created_by, billing_routed, category, ` +
      `area, severity, created_at, updated_at) VALUES (?, ${t.placeholders}, ?, ?, 'open', ?, ?, 'support', ?, ?, ?, ?)`,
  )
    .bind(id, ...t.binds, subject, text || null, c.var.user.id, billingRouted ? 1 : 0, area || null, priority, ts, ts)
    .run();
  const notified = await notifyTriagers(c, { id, subject, area, priority, billingRouted });
  return c.json({ ok: true, id, billingRouted, notified });
});

/**
 * POST /api/tickets/:id/status — move a ticket through the workflow (admin).
 * Body: `{ status: 'open' | 'in_progress' | 'closed', resolution? }`; a close
 * REQUIRES a resolution.
 *
 * A reopen keeps the old resolution rather than clearing it. With no thread table,
 * that text is the only record of what was already tried, and the screen shows it as
 * "Previously resolved" until the next close replaces it. `closed` therefore always
 * has a resolution; a non-closed status may carry the last one.
 */
tickets.post("/:id/status", requireRole("admin"), async (c) => {
  const body = await readBody<{ status: string; resolution: string }>(c);
  if (!isTicketStatus(body.status)) return c.json({ error: "invalid_status" }, 400);
  const status = body.status;
  const resolution = typeof body.resolution === "string" ? body.resolution.trim() : "";
  if (status === "closed" && !resolution) return c.json({ error: "resolution_required" }, 400);

  const id = c.req.param("id");
  const readQ = ticketScope(c).and("t.id = ?", id);
  const current = await c.env.DB.prepare(
    `SELECT t.status, t.subject, t.created_by FROM tickets t ${readQ.whereClause()}`,
  )
    .bind(...readQ.binds)
    .first<{ status: string; subject: string; created_by: string | null }>();
  if (!current) return c.json({ error: "not_found" }, 404);
  // Re-selecting the status a ticket already has is not a transition, so nothing is
  // written and nobody is told. Without this a double-click on "Mark in progress"
  // would alert the raiser twice about a change that happened once.
  if (current.status === status) {
    return c.json({ ok: true, status, changed: false, notified: { inApp: [], failed: false } });
  }

  const sets = ["status = ?", "updated_at = ?"];
  const binds: string[] = [status, new Date().toISOString()];
  if (status === "closed") {
    sets.push("resolution = ?");
    binds.push(resolution);
  }
  // An UPDATE is where an insufficient predicate stops being a read leak and
  // becomes a cross-tenant WRITE: `WHERE id = ? AND edition = ?` would have let an
  // administrator close another customer's ticket, and `meta.changes === 1` would
  // have reported it as a success.
  //
  // `tickets.status = ?` (the status just read) makes the write conditional on
  // nobody having moved the ticket in between. Two admins resolving the same ticket
  // would otherwise both "succeed", both overwrite the resolution, and alert the
  // raiser twice with two different answers. The second gets a 409 instead.
  const q = scoped(scopeOf(c.var.user))
    .on("tickets")
    .and("tickets.id = ?", id)
    .andRaw("tickets.category = 'support'")
    .and("tickets.status = ?", current.status);
  const res = await c.env.DB.prepare(`UPDATE tickets SET ${sets.join(", ")} ${q.whereClause()}`)
    .bind(...binds, ...q.binds)
    .run();
  if (res.meta.changes !== 1) return c.json({ error: "status_changed" }, 409);

  const notified = await notifyRaiser(c, {
    subject: current.subject,
    raisedBy: current.created_by,
    from: current.status,
    to: status,
    resolution,
  });
  const after = await c.env.DB.prepare(`${TICKET_SELECT}${readQ.whereClause()}`)
    .bind(...readQ.binds)
    .first<TicketRow>();
  return c.json({
    ok: true,
    status,
    changed: true,
    ticket: after ? toTicketView(after, c.var.user) : null,
    notified,
  });
});

// ── Who is told, and the one place it is written ────────────────────────────

interface Recipient {
  id: string;
  name: string;
  role: string;
}

interface TicketAlert {
  event: TicketNotificationEvent;
  title: string;
  body: string;
  link: string | null;
}

/**
 * Write one in-app alert per recipient, and report who actually got one.
 *
 * This is not `emitNotification` (`email/outbox.ts:853`) because that function's
 * `event` is a `NotificationEvent` and its audience an exhaustive `Record` over the
 * prototype's ten toggles — see the header of `TICKET_NOTIFICATION_EVENTS`. The row it
 * writes is the same shape `insertInAppNotification` writes, so the bell reads both
 * without knowing which produced it.
 *
 * Same two rules, too. The tenant comes from the caller's SCOPE and never from a
 * fallback: `emitNotification`'s once filed one customer's alert in another's
 * workspace when two call sites omitted it (`l5-hardening.test.ts` §C). And it never
 * throws — the ticket has already moved, and a status change that 500s after it
 * committed would invite the admin to press the button again. `failed` says so
 * instead, and the screen reports it.
 *
 * One batch, so it is all or none: `inApp` cannot name a person whose row was rolled
 * back.
 */
async function writeTicketAlerts(
  env: Env,
  scope: TenantScope,
  recipients: Recipient[],
  alert: TicketAlert,
): Promise<TicketNotice> {
  if (recipients.length === 0) return { inApp: [], failed: false };
  try {
    const t = insertScope(scope);
    const ts = new Date().toISOString();
    const insert = env.DB.prepare(
      `INSERT INTO notifications (id, ${t.columns}, user_id, event_key, title, body, link, created_at) ` +
        `VALUES (?, ${t.placeholders}, ?, ?, ?, ?, ?, ?)`,
    );
    const results = await env.DB.batch(
      recipients.map((u) =>
        insert.bind(`ntf_${crypto.randomUUID()}`, ...t.binds, u.id, alert.event, alert.title, alert.body, alert.link, ts),
      ),
    );
    return {
      inApp: recipients.filter((_, i) => results[i]?.meta.changes === 1).map((u) => u.name),
      failed: false,
    };
  } catch (err) {
    console.error(`ticket alert failed (${alert.event}):`, err);
    return { inApp: [], failed: true };
  }
}

/**
 * Live people in THIS workspace matching `predicate`, minus the actor and any
 * mentor. Nobody is told about their own action, and a mentor holds no screen an
 * alert could open (`denyMentor`).
 */
async function findRecipients(
  c: Context<AppEnv>,
  predicate: (q: ScopeBuilder) => void,
): Promise<Recipient[]> {
  const q = scoped(scopeOf(c.var.user)).on("u").andRaw("u.active = 1").and("u.id <> ?", c.var.user.id);
  predicate(q);
  const rows = (
    await c.env.DB.prepare(`SELECT u.id, u.name, u.role FROM users u ${q.whereClause()}`)
      .bind(...q.binds)
      .all<Recipient>()
  ).results;
  return rows.filter((u) => !isMentor(u.role));
}

/**
 * Raised → the people who TRIAGE: whoever the nav manifest gives the Tickets screen
 * (`support`). That is `admin`, plus `superuser` by bypass, in both editions — read
 * from `shared/nav.ts` rather than restated, the way `canUseTeamChannel` reads
 * `contactteam`, so opening the queue to another role later alerts them too without
 * a second list to forget.
 */
async function notifyTriagers(
  c: Context<AppEnv>,
  t: { id: string; subject: string; area: string; priority: string; billingRouted: boolean },
): Promise<TicketNotice> {
  const user = c.var.user;
  const scope = scopeOf(user);
  const triagers = ROLES_BY_EDITION[scope.edition].filter((r) => canAccessNav(scope.edition, r, "support"));
  // Never empty while `superuser` bypasses the nav, but an empty `IN ()` is a SQL
  // error rather than an empty set, so it is not left to that.
  if (triagers.length === 0) return { inApp: [], failed: false };
  try {
    const recipients = await findRecipients(c, (q) =>
      q.and(`u.role IN (${triagers.map(() => "?").join(", ")})`, ...triagers),
    );
    const detail = [`${t.priority[0].toUpperCase()}${t.priority.slice(1)} priority`, t.area].filter(Boolean).join(" · ");
    return await writeTicketAlerts(c.env, scope, recipients, {
      event: "ticket_raised",
      title: `New ticket from ${user.name}`,
      body: `${t.subject} — ${detail}${t.billingRouted ? " · routed to billing" : ""}`,
      link: "/app/support",
    });
  } catch (err) {
    console.error("ticket alert failed (ticket_raised):", err);
    return { inApp: [], failed: true };
  }
}

/** The copy for each transition. `from` matters: a reopen is not a fresh start. */
function transitionCopy(
  to: TicketStatus,
  from: string,
  actor: string,
  resolution: string,
): { title: string; detail: string } {
  if (to === "closed") return { title: "Your ticket was resolved", detail: resolution };
  if (from === "closed") return { title: "Your ticket was re-opened", detail: `${actor} re-opened it.` };
  if (to === "in_progress") return { title: "Your ticket is in progress", detail: `${actor} is looking into it.` };
  return { title: "Your ticket is back in the queue", detail: `${actor} moved it back to Open.` };
}

/**
 * Any status change → the person who RAISED it, linked to wherever they can see it:
 * the Tickets screen for a triager, Contact Admin's "My recent tickets" for anyone
 * else on staff, and nowhere for a founder (who holds neither screen, so the alert
 * carries the whole answer in its body rather than a link that 403s).
 */
async function notifyRaiser(
  c: Context<AppEnv>,
  t: { subject: string; raisedBy: string | null; from: string; to: TicketStatus; resolution: string },
): Promise<TicketNotice> {
  if (!t.raisedBy || t.raisedBy === c.var.user.id) return { inApp: [], failed: false };
  const raisedBy = t.raisedBy;
  const scope = scopeOf(c.var.user);
  try {
    const recipients = await findRecipients(c, (q) => q.and("u.id = ?", raisedBy));
    const role = ROLES_BY_EDITION[scope.edition].find((r) => r === recipients[0]?.role);
    const link = !role
      ? null
      : canAccessNav(scope.edition, role, "support")
        ? "/app/support"
        : canAccessNav(scope.edition, role, "contactadmin")
          ? "/app/contactadmin"
          : null;
    const copy = transitionCopy(t.to, t.from, c.var.user.name, t.resolution);
    return await writeTicketAlerts(c.env, scope, recipients, {
      event: "ticket_status_changed",
      title: copy.title,
      body: `${t.subject} — ${copy.detail}`,
      link,
    });
  } catch (err) {
    console.error("ticket alert failed (ticket_status_changed):", err);
    return { inApp: [], failed: true };
  }
}

// ── Internal issue log ───────────────────────────────────────────────────────
// The team's own tracker for what it finds while testing (FINISH-PLAN §4/S7):
// "an in-app admin issue tracker so the team logs testing issues in one place".
// Every internal role can log and read — a tester who can't file the issue files
// it in a chat message instead, which is the exact fragmentation this replaces.
// Triage (status / severity / owner / resolution) stays admin-only.

const issues = new Hono<AppEnv>();
// Internal-only: founders are turned away per-handler (they legitimately hold
// a session for the portal), and the mentor user-type at the router edge.
issues.use("*", requireAuth, denyMentor);

/** Founders are external; the issue log is an internal surface. */
function denyFounder(c: Context<AppEnv>): Response | null {
  return c.var.user.role === "founder" ? c.json({ error: "forbidden" }, 403) : null;
}

interface IssueRow {
  id: string;
  subject: string;
  body: string | null;
  status: string;
  severity: string | null;
  area: string | null;
  resolution: string | null;
  created_at: string;
  updated_at: string | null;
  creator: string | null;
  assignee: string | null;
  assignee_id: string | null;
}

/**
 * The issue log's FROM clause, with no WHERE.
 *
 * It used to end `WHERE t.edition = ? AND t.category = 'issue'`, and three call
 * sites appended their own ` AND …` and bound `edition` first by hand. That shape
 * is exactly what §11 warns a 211-site sweep gets wrong: the predicate and its
 * bind live in different expressions, so adding a second scope column means
 * remembering to add a second bind, in the right position, at every call site.
 * The builder owns both now, and `issueScope()` below is the one place the
 * workspace and the category are stated together.
 *
 * Both LEFT JOINs match the workspace too — `c.name` and `a.name` are rendered as
 * `creator` and `assignee`, so a drifted `created_by` or `assignee_id` would print
 * another customer's staff name in the log.
 */
const ISSUE_SELECT =
  "SELECT t.id, t.subject, t.body, t.status, t.severity, t.area, t.resolution, t.created_at, " +
  "t.updated_at, t.assignee_id, c.name AS creator, a.name AS assignee FROM tickets t " +
  "LEFT JOIN users c ON c.id = t.created_by AND c.tenant_id = t.tenant_id AND c.edition = t.edition " +
  "LEFT JOIN users a ON a.id = t.assignee_id AND a.tenant_id = t.tenant_id AND a.edition = t.edition ";

/** The workspace, and the queue. Every issue statement starts here. */
const issueScope = (c: Context<AppEnv>) =>
  scoped(scopeOf(c.var.user)).on("t").andRaw("t.category = 'issue'");

function toIssueView(t: IssueRow) {
  return {
    id: t.id,
    subject: t.subject,
    body: t.body,
    status: t.status,
    severity: t.severity,
    area: t.area,
    resolution: t.resolution,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    assigneeId: t.assignee_id,
    assignee: t.assignee,
    creator: t.creator ?? "—",
  };
}

/** GET /api/issues[?status=open|in_progress|closed] — the edition's issue log. */
issues.get("/", async (c) => {
  const denied = denyFounder(c);
  if (denied) return denied;
  const status = c.req.query("status");
  const q = issueScope(c);
  // The filter is a FRAGMENT AND ITS BIND, added together — which is the whole
  // reason this is a builder and not a string. The old form branched on `filtered`
  // twice, once for the SQL and once for the binds, and the two could drift.
  if ((ISSUE_STATUSES as readonly string[]).includes(status ?? "")) q.and("t.status = ?", status);
  const rows = (
    await c.env.DB.prepare(`${ISSUE_SELECT}${q.whereClause()} ORDER BY t.created_at DESC`)
      .bind(...q.binds)
      .all<IssueRow>()
  ).results;
  return c.json({ issues: rows.map(toIssueView) });
});

/** POST /api/issues — log an issue (any internal role). */
issues.post("/", async (c) => {
  const denied = denyFounder(c);
  if (denied) return denied;
  const body = await readBody<{ subject: string; body: string; severity: string; area: string }>(c);
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  if (!subject) return c.json({ error: "subject_required" }, 400);
  const severity = (ISSUE_SEVERITIES as readonly string[]).includes(body.severity ?? "")
    ? (body.severity as string)
    : "medium";
  const area = typeof body.area === "string" ? body.area.trim() : "";
  const text = typeof body.body === "string" ? body.body.trim() : "";
  const id = `iss_${crypto.randomUUID()}`;
  const ts = new Date().toISOString();
  const t = insertScope(scopeOf(c.var.user));
  await c.env.DB.prepare(
    `INSERT INTO tickets (id, ${t.columns}, subject, body, status, created_by, billing_routed, category, ` +
      `severity, area, created_at, updated_at) VALUES (?, ${t.placeholders}, ?, ?, 'open', ?, 0, 'issue', ?, ?, ?, ?)`,
  )
    .bind(id, ...t.binds, subject, text || null, c.var.user.id, severity, area || null, ts, ts)
    .run();
  const q = issueScope(c).and("t.id = ?", id);
  const row = await c.env.DB.prepare(`${ISSUE_SELECT}${q.whereClause()}`)
    .bind(...q.binds)
    .first<IssueRow>();
  return c.json({ ok: true, issue: row ? toIssueView(row) : null });
});

/** PATCH /api/issues/:id — triage an issue (admin/superuser). */
issues.patch("/:id", requireRole("admin"), async (c) => {
  const body = await readBody<{
    status: string;
    severity: string;
    area: string;
    assigneeId: string | null;
    resolution: string | null;
  }>(c);

  const sets: string[] = [];
  const binds: (string | null)[] = [];
  if (typeof body.status === "string") {
    if (!(ISSUE_STATUSES as readonly string[]).includes(body.status)) {
      return c.json({ error: "invalid_status" }, 400);
    }
    sets.push("status = ?");
    binds.push(body.status);
  }
  if (typeof body.severity === "string") {
    if (!(ISSUE_SEVERITIES as readonly string[]).includes(body.severity)) {
      return c.json({ error: "invalid_severity" }, 400);
    }
    sets.push("severity = ?");
    binds.push(body.severity);
  }
  if (typeof body.area === "string") {
    sets.push("area = ?");
    binds.push(body.area.trim() || null);
  }
  if ("assigneeId" in body) {
    // Assigning to someone outside the WORKSPACE would silently orphan the issue —
    // and under tenancy it is worse than orphaning: `edition` alone would have let
    // an administrator assign their own issue to another customer's employee, whose
    // name then renders as `assignee` on this log. The existing guard was already
    // the right shape; it just needed the other half of the key.
    if (body.assigneeId) {
      const ownerQ = scoped(scopeOf(c.var.user)).on("u").and("u.id = ?", body.assigneeId);
      const owner = await c.env.DB.prepare(`SELECT u.id FROM users u ${ownerQ.whereClause()}`)
        .bind(...ownerQ.binds)
        .first<{ id: string }>();
      if (!owner) return c.json({ error: "invalid_assignee" }, 400);
    }
    sets.push("assignee_id = ?");
    binds.push(body.assigneeId || null);
  }
  if ("resolution" in body) {
    sets.push("resolution = ?");
    binds.push(typeof body.resolution === "string" ? body.resolution.trim() || null : null);
  }
  if (sets.length === 0) return c.json({ error: "nothing_to_update" }, 400);

  sets.push("updated_at = ?");
  binds.push(new Date().toISOString());

  // Triage is a WRITE, so an insufficient predicate here closes, re-severs or
  // re-assigns another customer's issue and reports `changes === 1` doing it. The
  // `sets` binds come FIRST and the scope's second, which is the bind-order rule
  // `src/shared/tenant.ts` states: head binds, then `q.binds`.
  const q = scoped(scopeOf(c.var.user))
    .on("tickets")
    .and("tickets.id = ?", c.req.param("id"))
    .andRaw("tickets.category = 'issue'");
  const res = await c.env.DB.prepare(`UPDATE tickets SET ${sets.join(", ")} ${q.whereClause()}`)
    .bind(...binds, ...q.binds)
    .run();
  if (res.meta.changes !== 1) return c.json({ error: "not_found" }, 404);

  const readQ = issueScope(c).and("t.id = ?", c.req.param("id"));
  const row = await c.env.DB.prepare(`${ISSUE_SELECT}${readQ.whereClause()}`)
    .bind(...readQ.binds)
    .first<IssueRow>();
  return c.json({ ok: true, issue: row ? toIssueView(row) : null });
});

// ── Contact messages ─────────────────────────────────────────────────────────

const messages = new Hono<AppEnv>();
// `denyMentor` added alongside `requireAuth`, exactly as the issue log above does
// (`:151`). A mentor is a DIRECTORY record, not a pipeline actor
// (`shared/roles.ts:38-45`): it holds no nav item at all, so neither channel has a
// screen that reaches it. `/api/decks` and `/api/notifications` already refuse it
// the same way; this router was one of the surfaces that asked only for *some*
// authenticated session, which is the exact gap `denyMentor`'s own header describes.
messages.use("*", requireAuth, denyMentor);

/**
 * May this principal see the SHARED team channel?
 *
 * ── THE DEFECT THIS CLOSES ──────────────────────────────────────────────────
 * `messages.use("*", requireAuth)` was the whole of the authorisation on this
 * router, and `sharedView = channel === "team" || isAdmin` below then SKIPS the
 * per-user predicate for the team channel. So `?scope=team` returned every team
 * message in the workspace to every session that held a cookie. Measured
 * 2026-10-01: a **mentor** — whose `/api/decks` and `/api/notifications` are both
 * 403 — read the seeded team message verbatim.
 *
 * ── WHY THE FOUNDER IS THE CASE THAT MATTERS ────────────────────────────────
 * The mentor is the easier half and the smaller one. `founder` is the role the
 * pilot actually hands out to people outside the organisation — they upload a deck,
 * answer clarification queries and resubmit — and the team channel is where staff
 * discuss those same startups with each other. A founder reading it is a customer
 * reading the internal notes about their own application, which is not a
 * permissions bug the customer would report; it is one they would quote.
 *
 * ── WHY THE NAV MANIFEST IS THE RULE, NOT A LIST WRITTEN HERE ───────────────
 * `shared/nav.ts:229` and `:318` already state who has a "Contact team" screen:
 * every internal role in each edition, superuser by bypass, and NOT `founder` in
 * either. `routes/analytics.ts:89` is this codebase's own precedent for gating a
 * server route on the manifest rather than on a second hand-maintained role list
 * that can drift away from the first.
 *
 * And the client has not merely been drawing the sidebar from that line — it has
 * been GATING the route on it. `src/client/routes/guards.tsx:37` is
 * `canAccessNav(user.edition, user.role, navId, can)`, the identical call for the
 * identical slug, and its own doc comment says the quiet part: "(client-side — the
 * API enforces authZ independently)". For this one slug the API did not. A founder
 * who typed `/app/contactteam` already got "Not available for your role"; a founder
 * who typed `curl /api/messages?scope=team` got the channel. This line is the
 * independent enforcement that comment promises, written as the same expression so
 * the two cannot disagree later.
 *
 * `canAccessNav`'s optional permission lookup is deliberately NOT passed:
 * `contactteam` carries no `task` cell, so the lookup cannot change the answer, and
 * passing `c.var.perms.can` would add a `role_permissions` read to every message
 * fetch for a value that is always true. A `task` added to that nav item later is
 * the moment to pass it, and `canAccessNav` is where a reader will look.
 *
 * It also answers correctly for `mentor`, which is a `users.role` value outside
 * `Role` and therefore in no item's `roles` array — but `denyMentor` above is what
 * this router relies on for that, because "absent from every list" is a property of
 * the manifest and not a decision anybody wrote down.
 */
function canUseTeamChannel(user: SessionUser): boolean {
  return canAccessNav(user.edition, user.role, "contactteam");
}

/** GET /api/messages?scope=admin|team.
 *  - `team`: a shared channel for the WORKSPACE'S STAFF — every internal role sees
 *    every message. Founders and mentors are refused outright (see above).
 *  - `admin`: private to the admins — an admin/superuser sees the whole inbox,
 *    while other roles see only the messages they themselves sent to admin. This
 *    arm stays open to a founder: it is their support channel, and they see only
 *    what they sent. */
const MESSAGE_SELECT =
  "SELECT m.id, m.body, m.to_scope, m.created_at, u.name AS sender FROM messages m " +
  "LEFT JOIN users u ON u.id = m.from_id AND u.tenant_id = m.tenant_id AND u.edition = m.edition ";

messages.get("/", async (c) => {
  const user = c.var.user;
  // NAME COLLISION, deliberately resolved rather than left to the reader: this
  // route's own `scope` query parameter is the MESSAGE channel ('admin' | 'team'),
  // which has nothing to do with a tenant scope. The channel keeps the name it has
  // in the API and the client; the workspace is `workspace` here.
  const channel = c.req.query("scope") === "team" ? "team" : "admin";
  // Before `sharedView`, not after: the whole defect was that the broadcast arm
  // skipped the per-user predicate, so an unauthorised caller did not get a narrower
  // list — they got the widest one in the workspace.
  if (channel === "team" && !canUseTeamChannel(user)) return c.json({ error: "forbidden" }, 403);
  const workspace = scopeOf(user);
  const isAdmin = user.role === "admin" || user.role === "superuser";
  // `team` is a broadcast (all rows); `admin` is an inbox admins see in full but
  // other roles see only their own sent messages. Both arms are now scoped to the
  // workspace first — the per-user arm was never a tenant boundary, because
  // `m.from_id = ?` happens to exclude another customer's rows only as long as the
  // id it binds is the caller's own.
  const sharedView = channel === "team" || isAdmin;
  const q = scoped(workspace).on("m").and("m.to_scope = ?", channel);
  if (!sharedView) q.and("m.from_id = ?", user.id);
  const rows = (
    await c.env.DB.prepare(`${MESSAGE_SELECT}${q.whereClause()} ORDER BY m.created_at DESC`)
      .bind(...q.binds)
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
    // `inbox` = show sender names (a shared/admin view) vs "You" (own sent list).
    inbox: sharedView,
  });
});

/** POST /api/messages — send a contact message to Admin or the team. */
messages.post("/", async (c) => {
  const body = await readBody<{ toScope: string; body: string }>(c);
  const toScope = body.toScope === "team" ? "team" : "admin";
  // The WRITE half of the same gate. Refused rather than silently re-addressed to
  // `admin`: a founder whose note lands somewhere other than where they aimed it has
  // been lied to, and the row would then sit in a channel they cannot read back.
  // `admin` stays open to every role — that is the founder's support channel.
  if (toScope === "team" && !canUseTeamChannel(c.var.user)) {
    return c.json({ error: "forbidden" }, 403);
  }
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!text) return c.json({ error: "body_required" }, 400);
  const id = `msg_${crypto.randomUUID()}`;
  const t = insertScope(scopeOf(c.var.user));
  await c.env.DB.prepare(
    `INSERT INTO messages (id, ${t.columns}, from_id, to_scope, body) VALUES (?, ${t.placeholders}, ?, ?, ?)`,
  )
    .bind(id, ...t.binds, c.var.user.id, toScope, text)
    .run();
  return c.json({ ok: true, id });
});

// ── JURYbuddy help clips (V3 item 15) ────────────────────────────────────────
// The spec ships its 41 clips as base64 `data:` URIs inside an 8.2 MB HTML file.
// Bundling them would add 5.86 MB to every page load, so they live in R2 under
// `help/clips/<clipId>.mp4` and are streamed from here instead.
//
// AUTHENTICATED, NOT AUTHORISED: these are product documentation, identical for
// every role and every edition, so there is nothing per-user to check beyond
// holding a session. The `help` NAV item is narrower than this route — internal
// incubator roles only — so a founder holds a session that can reach the route
// but no screen that links to it. That asymmetry is deliberate and harmless: the
// route leaks nothing role-specific, and it does not have to move again if Help
// later opens to VC (§12 question (a)).

const help = new Hono<AppEnv>();
help.use("*", requireAuth);

/** `clipId`s are opaque keys from the bundled manifest; reject anything that
 *  could escape the `help/clips/` prefix before it reaches R2. */
const CLIP_ID = /^[a-z0-9_]{1,64}$/;

/** GET /api/help/clips/:clipId — stream one FAQ clip from R2.
 *
 *  404 covers all three "no video" cases — binding absent, object absent, bad id
 *  — because the client treats them identically: show the answer, hide the
 *  player. Range is honoured so `<video>` can seek; without it a seek re-fetches
 *  the whole object. */
help.get("/clips/:clipId", async (c) => {
  const clipId = c.req.param("clipId");
  if (!CLIP_ID.test(clipId)) return c.json({ error: "not_found" }, 404);
  const bucket = c.env.HELP_MEDIA;
  if (!bucket) return c.json({ error: "no_clip" }, 404);

  const range = c.req.header("range");
  // Only `bytes=<start>-[<end>]` — the single-range form `<video>` actually
  // sends. A suffix range (`bytes=-500`) or a multi-range falls through to the
  // full object, which is a correct (if unoptimised) response either way.
  const m = range ? /^bytes=(\d+)-(\d*)$/.exec(range.trim()) : null;
  const offset = m ? Number(m[1]) : undefined;
  const end = m && m[2] ? Number(m[2]) : undefined;
  // A backwards range (`bytes=10-5`) is unsatisfiable by inspection. One that
  // starts past the end of the object is too, but that needs `size`, so R2 is
  // left to reject it below — it THROWS rather than returning null, which would
  // otherwise surface as a 500.
  if (offset !== undefined && end !== undefined && end < offset) {
    return c.json({ error: "range_not_satisfiable" }, 416);
  }

  const key = `help/clips/${clipId}.mp4`;
  let object: R2ObjectBody | null;
  try {
    object = await bucket.get(key, {
      range:
        offset === undefined
          ? undefined
          : { offset, length: end === undefined ? undefined : end - offset + 1 },
    });
  } catch {
    // The only get that throws here is an unsatisfiable range; a missing object
    // returns null. Answer 416 with the real size so a client can retry.
    const meta = await bucket.head(key);
    if (!meta) return c.json({ error: "no_clip" }, 404);
    return c.json({ error: "range_not_satisfiable" }, 416, {
      "content-range": `bytes */${meta.size}`,
    });
  }
  if (!object) return c.json({ error: "no_clip" }, 404);

  const headers = new Headers();
  headers.set("content-type", "video/mp4");
  headers.set("accept-ranges", "bytes");
  headers.set("etag", object.httpEtag);
  // Immutable product media, but keep it private: it is behind a session, so a
  // shared cache must not hold it.
  headers.set("cache-control", "private, max-age=86400");

  // 206 ONLY when a range was actually requested. `object.range` is not the test
  // for that — R2 populates it on a full GET too (`{offset: 0, length: size}`),
  // so reading it turned every plain request into a 206. `offset` is the honest
  // signal: it is set only where the Range header parsed.
  if (offset !== undefined) {
    // Clamp to the object, because R2 already has. A `<video>` asks for a fixed
    // first chunk (`bytes=0-524287`) whatever the clip's real length, and R2
    // serves only the bytes that exist — so computing the headers from the
    // REQUESTED `end` promises a body longer than the one being written, and
    // the player treats the short read as a broken stream.
    const lastByte = end === undefined ? object.size - 1 : Math.min(end, object.size - 1);
    const length = lastByte - offset + 1;
    headers.set("content-length", String(length));
    headers.set("content-range", `bytes ${offset}-${lastByte}/${object.size}`);
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("content-length", String(object.size));
  return new Response(object.body, { headers });
});

export { tickets, messages, issues, help, ISSUE_STATUSES, ISSUE_SEVERITIES };
