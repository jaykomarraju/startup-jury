import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import type { TicketNotice } from "../../src/shared/notifications";

/**
 * WAVE A · P3 — TICKETS, RAISE TO CLOSE (tracker row 13).
 *
 * "Tickets module from raise to close with status and notifications." Four claims,
 * one `describe` each, and each one is a claim a screen now makes to a person:
 *
 *   §A  a ticket goes raise → in progress → resolved, and a resolve says WHY;
 *   §B  every transition tells the right people — the triagers on a raise, the
 *       raiser on every move — and `notified` names exactly the rows written;
 *   §C  nothing claims an email was sent, because nothing was;
 *   §D  every alert lands in the workspace the ticket belongs to. Vacuous on a
 *       one-tenant database (`tenant-probe-vacuity`), so this file builds a second
 *       customer with its own admin and juror rather than asserting on `t_default`
 *       and hoping;
 *   §E  the founder and the mentor at this router's edge, each with its control.
 *
 * The TEAM CHANNEL refusals the same brief asked for are in `l5-hardening.test.ts`
 * §A, and were mutation-checked for this wave: reverting `support.ts` to the bare
 * `requireAuth` the brief described turns exactly the founder-read, mentor-read and
 * founder-write cases red. They are not repeated here, because a second copy would be
 * a second place for them to drift.
 */

const BASE = "https://example.com";

const ADMIN = "nisha.kapoor@demo.startupjury.ai"; //    inc_admin — a triager
const SUPERUSER = "priya.sharma@demo.startupjury.ai"; // inc_superuser — a triager by bypass
const JURY = "rajesh.kumar@demo.startupjury.ai"; //     inc_jury — staff, raises from Contact Admin
const FOUNDER = "meera.sharma@demo.startupjury.ai"; //  external, holds no ticket screen
const MENTOR = "anil.mehta@demo.startupjury.ai"; //     a directory record, no screens

/** The second customer. §D proves nothing without one. */
const OTHER = "t_p3_other";
const OTHER_ADMIN = "admin@p3other.test";
const OTHER_JURY = "jury@p3other.test";

async function login(email: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo1234" }),
  });
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
  // A failed login answers every later request 401, which several cases below would
  // read as a refusal. Fail here instead, where the cause is visible.
  expect(cookie, `${email} could not sign in`).toBeTruthy();
  return cookie;
}

const get = (path: string, cookie: string) => SELF.fetch(`${BASE}${path}`, { headers: { cookie } });

const post = (path: string, cookie: string, body: unknown) =>
  SELF.fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

interface TicketShape {
  id: string;
  subject: string;
  status: string;
  area: string | null;
  priority: string | null;
  resolution: string | null;
  creator: string;
  creatorRole: string | null;
  raisedByMe: boolean;
}

interface RaiseShape {
  ok: boolean;
  id: string;
  billingRouted: boolean;
  notified: TicketNotice;
}

interface MoveShape {
  ok: boolean;
  status: string;
  changed: boolean;
  ticket: TicketShape | null;
  notified: TicketNotice;
}

async function raise(cookie: string, body: Record<string, unknown>): Promise<RaiseShape> {
  const res = await post("/api/tickets", cookie, body);
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as RaiseShape;
}

async function move(cookie: string, id: string, body: Record<string, unknown>) {
  return post(`/api/tickets/${id}/status`, cookie, body);
}

interface AlertRow {
  tenant_id: string;
  edition: string;
  user_id: string;
  event_key: string;
  title: string;
  body: string | null;
  link: string | null;
}

/** Every alert about one ticket, found by the marker its subject carries. */
async function alertsFor(marker: string): Promise<AlertRow[]> {
  return (
    await env.DB.prepare(
      "SELECT tenant_id, edition, user_id, event_key, title, body, link FROM notifications " +
        "WHERE event_key LIKE 'ticket_%' AND body LIKE ? ORDER BY created_at, user_id",
    )
      .bind(`%${marker}%`)
      .all<AlertRow>()
  ).results;
}

async function userId(email: string, tenantId = "t_default"): Promise<{ id: string; name: string }> {
  const row = await env.DB.prepare("SELECT id, name FROM users WHERE email = ? AND tenant_id = ?")
    .bind(email, tenantId)
    .first<{ id: string; name: string }>();
  expect(row, `${email} is not seeded in ${tenantId}`).toBeTruthy();
  return row!;
}

/** Who the nav manifest gives the Tickets screen, as live rows of one workspace. */
async function triagers(tenantId: string): Promise<{ id: string; name: string }[]> {
  return (
    await env.DB.prepare(
      "SELECT id, name FROM users WHERE tenant_id = ? AND edition = 'incubator' AND active = 1 " +
        "AND role IN ('admin', 'superuser') ORDER BY id",
    )
      .bind(tenantId)
      .all<{ id: string; name: string }>()
  ).results;
}

async function outboxCount(): Promise<number> {
  return (await env.DB.prepare("SELECT count(*) n FROM email_outbox").first<{ n: number }>())!.n;
}

/** The outermost frame: isolated storage pops a per-describe `beforeAll`. */
beforeAll(async () => {
  await env.DB.prepare(
    "INSERT INTO organizations (id, name, slug, status) VALUES (?, 'P3 Other Accelerator', 'p3-other', 'active') " +
      "ON CONFLICT (id) DO NOTHING",
  )
    .bind(OTHER)
    .run();
  // The seeded password hash is reused so nothing here has to mint one.
  for (const [id, email, role, name] of [
    ["p3_other_admin", OTHER_ADMIN, "admin", "P3 Other Admin"],
    ["p3_other_jury", OTHER_JURY, "jury", "P3 Other Juror"],
  ] as const) {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO users (id, tenant_id, name, email, role, edition, initials, password_hash) " +
        "SELECT ?, ?, ?, ?, ?, 'incubator', 'PO', password_hash FROM users WHERE email = ?",
    )
      .bind(id, OTHER, name, email, role, ADMIN)
      .run();
  }
});

// ── §A · the lifecycle ───────────────────────────────────────────────────────

describe("P3 · a ticket goes raise → in progress → resolved", () => {
  it("walks the whole loop, and the raiser can follow it on their own list", async () => {
    const jury = await login(JURY);
    const admin = await login(ADMIN);

    const raised = await raise(jury, {
      subject: "P3-LOOP cannot see Cohort 6 decks",
      body: "The Jury Pipeline is empty for me.",
      area: "Permissions & roles",
      priority: "high",
    });
    expect(raised.ok).toBe(true);

    // The raiser's own list — Contact Admin's "My recent tickets".
    const mine = async () =>
      ((await (await get("/api/tickets/mine", jury)).json()) as { tickets: TicketShape[] }).tickets.find(
        (t) => t.id === raised.id,
      );
    expect(await mine()).toMatchObject({
      status: "open",
      area: "Permissions & roles",
      priority: "high",
      resolution: null,
      raisedByMe: true,
    });

    // The MIDDLE STEP. Before this wave `in_progress` was coerced to `open`.
    const progress = await move(admin, raised.id, { status: "in_progress" });
    expect(progress.status).toBe(200);
    const p = (await progress.json()) as MoveShape;
    expect(p).toMatchObject({ status: "in_progress", changed: true });
    expect(p.ticket?.status).toBe("in_progress");
    expect((await mine())?.status).toBe("in_progress");

    const done = await move(admin, raised.id, {
      status: "closed",
      resolution: "Added you to the Cohort 6 panel.",
    });
    expect(done.status).toBe(200);
    expect(await mine()).toMatchObject({ status: "closed", resolution: "Added you to the Cohort 6 panel." });

    // And the admin's queue agrees, with the role label the prototype's row shows.
    const queue = ((await (await get("/api/tickets", admin)).json()) as { tickets: TicketShape[] }).tickets;
    expect(queue.find((t) => t.id === raised.id)).toMatchObject({
      status: "closed",
      creator: "Rajesh Kumar",
      creatorRole: "Jury Member",
      raisedByMe: false,
    });
  });

  it("refuses a close with no resolution, and the refusal changes nothing", async () => {
    const admin = await login(ADMIN);
    const { id } = await raise(await login(JURY), { subject: "P3-NORES export is blank" });
    const before = await alertsFor("P3-NORES");

    for (const resolution of [undefined, "", "   "]) {
      const res = await move(admin, id, { status: "closed", resolution });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "resolution_required" });
    }
    const row = await env.DB.prepare("SELECT status, resolution FROM tickets WHERE id = ?")
      .bind(id)
      .first<{ status: string; resolution: string | null }>();
    expect(row).toEqual({ status: "open", resolution: null });
    expect(await alertsFor("P3-NORES"), "a refused close still alerted someone").toEqual(before);
  });

  it("refuses a status outside the workflow instead of reinterpreting it", async () => {
    // The old handler mapped anything that was not "closed" to "open" — so a typo,
    // or `in_progress` itself, silently reopened the ticket and answered 200.
    const admin = await login(ADMIN);
    const { id } = await raise(await login(JURY), { subject: "P3-BADSTATUS" });
    await move(admin, id, { status: "in_progress" });
    for (const status of ["resolved", "inprog", "", null]) {
      const res = await move(admin, id, { status });
      expect(res.status).toBe(400);
    }
    const row = await env.DB.prepare("SELECT status FROM tickets WHERE id = ?").bind(id).first<{ status: string }>();
    expect(row?.status, "a refused status still moved the ticket").toBe("in_progress");
  });

  it("a reopen keeps the old resolution, and the next close replaces it", async () => {
    const admin = await login(ADMIN);
    const { id } = await raise(await login(JURY), { subject: "P3-REOPEN login loop" });
    await move(admin, id, { status: "closed", resolution: "Cleared your session." });

    const reopened = (await (await move(admin, id, { status: "in_progress" })).json()) as MoveShape;
    // The only record of what was already tried, with no thread table to hold it.
    expect(reopened.ticket).toMatchObject({ status: "in_progress", resolution: "Cleared your session." });

    await move(admin, id, { status: "closed", resolution: "Reset your password." });
    const row = await env.DB.prepare("SELECT status, resolution FROM tickets WHERE id = ?")
      .bind(id)
      .first<{ status: string; resolution: string }>();
    expect(row).toEqual({ status: "closed", resolution: "Reset your password." });
  });

  it("only a triager moves a ticket — the raiser cannot resolve their own", async () => {
    const jury = await login(JURY);
    const { id } = await raise(jury, { subject: "P3-SELFCLOSE" });
    expect((await move(jury, id, { status: "closed", resolution: "Fixed it myself" })).status).toBe(403);
    expect((await get("/api/tickets", jury)).status).toBe(403);
    // NEGATIVE CONTROL — the superuser triages too, by the same bypass that gives it
    // the screen. Without this a blanket admin-only gate would also pass the above.
    const su = await login(SUPERUSER);
    expect((await move(su, id, { status: "in_progress" })).status).toBe(200);
  });

  it("keeps the Upload screen's raise working — it still posts subject, body and billing only", async () => {
    // `upload/CrmMethod.tsx` raises through `api.ts`'s `createTicket`, which this lane
    // does not own and which sends no category or priority.
    const admin = await login(ADMIN);
    const res = await post("/api/tickets", admin, {
      subject: "P3-CRM Customization request — Email triage inbox",
      body: "Raised from the Upload screen.",
      billing: false,
    });
    expect(res.status).toBe(200);
    const { id, billingRouted } = (await res.json()) as RaiseShape;
    expect(billingRouted).toBe(false);
    const row = await env.DB.prepare("SELECT status, area, severity, category FROM tickets WHERE id = ?")
      .bind(id)
      .first();
    // Medium is the prototype's preselected priority, and the default for a raise
    // that names none.
    expect(row).toEqual({ status: "open", area: null, severity: "medium", category: "support" });
  });

  it("routes a Billing & subscription ticket to billing by its category alone", async () => {
    const { billingRouted } = await raise(await login(JURY), {
      subject: "P3-BILLCAT question about our plan",
      area: "Billing & subscription",
    });
    expect(billingRouted).toBe(true);
  });
});

// ── §B · who is told ─────────────────────────────────────────────────────────

describe("P3 · each transition tells the right people", () => {
  it("a raise alerts every triager in the workspace, and nobody else", async () => {
    const jury = await userId(JURY);
    const raised = await raise(await login(JURY), { subject: "P3-RAISE deck viewer blank", priority: "urgent" });

    const rows = await alertsFor("P3-RAISE");
    const want = await triagers("t_default");
    expect(want.length, "no triager is seeded — this case proves nothing").toBeGreaterThan(0);
    expect(rows.map((r) => r.user_id).sort()).toEqual(want.map((u) => u.id).sort());
    expect(rows.every((r) => r.event_key === "ticket_raised" && r.link === "/app/support")).toBe(true);
    expect(rows[0].title).toBe("New ticket from Rajesh Kumar");
    expect(rows[0].body).toContain("Urgent priority");
    // The raiser is not told about their own action.
    expect(rows.some((r) => r.user_id === jury.id)).toBe(false);
    // `notified` names exactly the people whose rows exist — not the audience it meant.
    expect([...raised.notified.inApp].sort()).toEqual(want.map((u) => u.name).sort());
    expect(raised.notified.failed).toBe(false);
  });

  it("every move alerts the raiser, linked to the screen they can open", async () => {
    const jury = await userId(JURY);
    const admin = await login(ADMIN);
    const { id } = await raise(await login(JURY), { subject: "P3-MOVES scoring looks off" });
    const before = (await alertsFor("P3-MOVES")).length; // the triagers' raise alerts

    const steps: [Record<string, unknown>, string][] = [
      [{ status: "in_progress" }, "Your ticket is in progress"],
      [{ status: "closed", resolution: "Re-ran the AI evaluation." }, "Your ticket was resolved"],
      [{ status: "in_progress" }, "Your ticket was re-opened"],
      [{ status: "open" }, "Your ticket is back in the queue"],
    ];
    for (const [body, title] of steps) {
      const r = (await (await move(admin, id, body)).json()) as MoveShape;
      expect(r.notified).toEqual({ inApp: ["Rajesh Kumar"], failed: false });
      const latest = (await alertsFor("P3-MOVES")).filter((a) => a.event_key === "ticket_status_changed").at(-1);
      expect(latest).toMatchObject({
        user_id: jury.id,
        title,
        // A juror has no Tickets screen; Contact Admin's own list is where they look.
        link: "/app/contactadmin",
      });
    }
    // The resolution itself reaches the raiser, not just the word "resolved".
    const resolved = (await alertsFor("P3-MOVES")).find((a) => a.title === "Your ticket was resolved");
    expect(resolved?.body).toContain("Re-ran the AI evaluation.");
    expect((await alertsFor("P3-MOVES")).length).toBe(before + steps.length);
  });

  it("re-selecting the status a ticket already has writes nothing and tells nobody", async () => {
    const admin = await login(ADMIN);
    const { id } = await raise(await login(JURY), { subject: "P3-DOUBLE" });
    await move(admin, id, { status: "in_progress" });
    const before = await alertsFor("P3-DOUBLE");
    const again = (await (await move(admin, id, { status: "in_progress" })).json()) as MoveShape;
    expect(again).toMatchObject({ changed: false, notified: { inApp: [], failed: false } });
    expect(await alertsFor("P3-DOUBLE"), "a double-click alerted the raiser twice").toEqual(before);
  });

  it("an admin moving their OWN ticket is told nothing, and the screen is told why", async () => {
    const admin = await login(ADMIN);
    const { id } = await raise(admin, { subject: "P3-OWN" });
    const r = (await (await move(admin, id, { status: "in_progress" })).json()) as MoveShape;
    expect(r.notified.inApp).toEqual([]);
    expect(r.ticket?.raisedByMe).toBe(true);
    expect((await alertsFor("P3-OWN")).filter((a) => a.event_key === "ticket_status_changed")).toEqual([]);
  });
});

// ── §C · no email is claimed, because none is sent ───────────────────────────

describe("P3 · nothing claims an email was sent", () => {
  it("the whole loop writes no outbox row, and `notified` has no email field to misread", async () => {
    // `EmailKind` has no ticket member and is not this lane's file (`support.ts`'s
    // header). Were a ticket to borrow another kind, this count would move.
    const before = await outboxCount();
    const admin = await login(ADMIN);
    const raised = await raise(await login(JURY), { subject: "P3-NOMAIL" });
    const moved = (await (await move(admin, raised.id, { status: "closed", resolution: "Done." })).json()) as MoveShape;

    expect(await outboxCount(), "a ticket produced email").toBe(before);
    // The response describes the in-app channel and nothing else: a screen reading it
    // has no `sent`, `delivered` or `email` to show.
    expect(Object.keys(raised.notified).sort()).toEqual(["failed", "inApp"]);
    expect(Object.keys(moved.notified).sort()).toEqual(["failed", "inApp"]);
  });
});

// ── §D · every alert stays in its own workspace ──────────────────────────────

describe("P3 · alerts are filed in the ticket's own workspace", () => {
  it("a raise in t_default reaches none of the other customer's admins", async () => {
    const otherAdmin = await userId(OTHER_ADMIN, OTHER);
    await raise(await login(JURY), { subject: "P3-TENANT-A" });
    const rows = await alertsFor("P3-TENANT-A");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.tenant_id === "t_default" && r.edition === "incubator")).toBe(true);
    expect(rows.some((r) => r.user_id === otherAdmin.id)).toBe(false);
  });

  it("the OTHER customer's raise reaches only its own admin — the half that fails if the scope is defaulted", async () => {
    // This is the case a one-tenant database passes for free: had the alert fallen
    // back to `t_default`, Nisha Kapoor would be told about another customer's ticket
    // and that customer's admin would hear nothing.
    const otherAdmin = await userId(OTHER_ADMIN, OTHER);
    const raised = await raise(await login(OTHER_JURY), { subject: "P3-TENANT-B" });
    const rows = await alertsFor("P3-TENANT-B");
    expect(rows.map((r) => [r.user_id, r.tenant_id])).toEqual([[otherAdmin.id, OTHER]]);
    expect(raised.notified.inApp).toEqual(["P3 Other Admin"]);

    // And the raiser's alert on a move is filed there too.
    const moved = await move(await login(OTHER_ADMIN), raised.id, { status: "in_progress" });
    expect(moved.status).toBe(200);
    const statusRows = (await alertsFor("P3-TENANT-B")).filter((r) => r.event_key === "ticket_status_changed");
    expect(statusRows.map((r) => r.tenant_id)).toEqual([OTHER]);
  });

  it("an admin cannot move, or be told about, another customer's ticket", async () => {
    const raised = await raise(await login(OTHER_JURY), { subject: "P3-TENANT-C" });
    const ours = await login(ADMIN);
    const res = await move(ours, raised.id, { status: "closed", resolution: "Wrong workspace." });
    expect(res.status).toBe(404);
    const row = await env.DB.prepare("SELECT status FROM tickets WHERE id = ?").bind(raised.id).first<{ status: string }>();
    expect(row?.status).toBe("open");
    const queue = ((await (await get("/api/tickets", ours)).json()) as { tickets: TicketShape[] }).tickets;
    expect(queue.some((t) => t.id === raised.id)).toBe(false);
  });
});

// ── §E · the founder and the mentor at this router's edge ────────────────────

describe("P3 · founders and mentors at the ticket router", () => {
  it("a FOUNDER may raise and follow their own ticket, but never sees the queue", async () => {
    const founder = await login(FOUNDER);
    const raised = await raise(founder, { subject: "P3-FOUNDER resubmit link expired" });
    expect(raised.notified.inApp.length).toBeGreaterThan(0);
    expect((await get("/api/tickets", founder)).status).toBe(403);
    expect((await move(founder, raised.id, { status: "in_progress" })).status).toBe(403);

    const mine = ((await (await get("/api/tickets/mine", founder)).json()) as { tickets: TicketShape[] }).tickets;
    expect(mine.some((t) => t.id === raised.id)).toBe(true);
    // Their own and nothing else — no other raiser's ticket rides along.
    expect(mine.every((t) => t.raisedByMe)).toBe(true);

    // A founder holds neither the Tickets screen nor Contact Admin, so their alert
    // carries the whole answer and no link that would 403.
    await move(await login(ADMIN), raised.id, { status: "closed", resolution: "Sent a fresh link." });
    const alert = (await alertsFor("P3-FOUNDER")).find((a) => a.event_key === "ticket_status_changed");
    expect(alert).toMatchObject({ link: null });
    expect(alert?.body).toContain("Sent a fresh link.");
  });

  it("a MENTOR cannot raise, list or read a ticket, and rings no bell trying", async () => {
    const mentor = await login(MENTOR);
    const before = await env.DB.prepare("SELECT count(*) n FROM tickets").first<{ n: number }>();
    const res = await post("/api/tickets", mentor, { subject: "P3-MENTOR probe" });
    expect(res.status).toBe(403);
    expect((await get("/api/tickets/mine", mentor)).status).toBe(403);
    expect((await get("/api/tickets", mentor)).status).toBe(403);
    expect(await env.DB.prepare("SELECT count(*) n FROM tickets").first<{ n: number }>()).toEqual(before);
    expect(await alertsFor("P3-MENTOR")).toEqual([]);
  });

  it("NEGATIVE CONTROL — the lowest staff role still raises and reads its own", async () => {
    // Without this the mentor refusal above could be a blanket 403 on the router.
    const jury = await login(JURY);
    const { id } = await raise(jury, { subject: "P3-CONTROL" });
    const mine = ((await (await get("/api/tickets/mine", jury)).json()) as { tickets: TicketShape[] }).tickets;
    expect(mine.some((t) => t.id === id)).toBe(true);
  });
});
