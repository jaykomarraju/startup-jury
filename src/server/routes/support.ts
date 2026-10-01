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
import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../types";
import { denyMentor, requireAuth, requireRole } from "../auth/middleware";
import { scopeOf, scoped, insertScope } from "../../shared/tenant";

/** Issue workflow states. `in_progress` is the "someone is on it" middle step. */
const ISSUE_STATUSES = ["open", "in_progress", "closed"] as const;
const ISSUE_SEVERITIES = ["low", "medium", "high", "critical"] as const;

async function readBody<T>(c: Context<AppEnv>): Promise<Partial<T>> {
  return (await c.req.json().catch(() => ({}))) as Partial<T>;
}

// ── Tickets ──────────────────────────────────────────────────────────────────

const tickets = new Hono<AppEnv>();
tickets.use("*", requireAuth);

/** GET /api/tickets — every ticket in the workspace (admin-only Tickets screen). */
tickets.get("/", requireRole("admin"), async (c) => {
  // The LEFT JOIN also matches the workspace: `u.name` is rendered as the
  // ticket's `creator`, so a `created_by` pointing at another customer's user
  // would print that person's name on this screen. Column-to-column, no bind.
  const q = scoped(scopeOf(c.var.user)).on("t").andRaw("t.category = 'support'");
  const rows = (
    await c.env.DB.prepare(
      "SELECT t.id, t.subject, t.body, t.status, t.billing_routed, t.created_at, u.name AS creator " +
        "FROM tickets t LEFT JOIN users u " +
        "ON u.id = t.created_by AND u.tenant_id = t.tenant_id AND u.edition = t.edition " +
        `${q.whereClause()} ORDER BY t.created_at DESC`,
    )
      .bind(...q.binds)
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
  // ── THE SILENT HALF OF THE WAVE, AND THIS IS THE ROUTE THAT NAMES IT ──────
  // `test/worker/tenant-scope.test.ts`'s layer 3 measured this INSERT on
  // 2026-09-30: it named no tenant, so `tickets.tenant_id`'s `DEFAULT 't_default'`
  // (`0084:62`) took effect and a second customer's ticket was filed against the
  // FIRST customer — with a 200, a row, and nothing in the response to notice.
  // Unlike a missing read predicate, no negative control can see that; only the
  // write assertion can. `insertScope` is why the column cannot be forgotten.
  const t = insertScope(scopeOf(c.var.user));
  await c.env.DB.prepare(
    `INSERT INTO tickets (id, ${t.columns}, subject, body, status, created_by, billing_routed, category) ` +
      `VALUES (?, ${t.placeholders}, ?, ?, 'open', ?, ?, 'support')`,
  )
    .bind(id, ...t.binds, subject, text || null, c.var.user.id, billingRouted ? 1 : 0)
    .run();
  return c.json({ ok: true, id, billingRouted });
});

/** POST /api/tickets/:id/status — open/close a ticket (admin). */
tickets.post("/:id/status", requireRole("admin"), async (c) => {
  const body = await readBody<{ status: string }>(c);
  const status = body.status === "closed" ? "closed" : "open";
  // An UPDATE is where an insufficient predicate stops being a read leak and
  // becomes a cross-tenant WRITE: `WHERE id = ? AND edition = ?` would have let an
  // administrator close another customer's ticket, and `meta.changes === 1` would
  // have reported it as a success.
  const q = scoped(scopeOf(c.var.user))
    .on("tickets")
    .and("tickets.id = ?", c.req.param("id"))
    .andRaw("tickets.category = 'support'");
  const res = await c.env.DB.prepare(`UPDATE tickets SET status = ? ${q.whereClause()}`)
    .bind(status, ...q.binds)
    .run();
  if (res.meta.changes !== 1) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true, status });
});

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
messages.use("*", requireAuth);

/** GET /api/messages?scope=admin|team.
 *  - `team`: a shared team channel — everyone in the edition sees every message.
 *  - `admin`: private to the admins — an admin/superuser sees the whole inbox,
 *    while other roles see only the messages they themselves sent to admin. */
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
