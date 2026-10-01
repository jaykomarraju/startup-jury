import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";

const BASE = "https://example.com";
const INC_ADMIN = "nisha.kapoor@demo.startupjury.ai";
const INC_JURY = "rajesh.kumar@demo.startupjury.ai";

async function login(email: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo1234" }),
  });
  const setCookie = res.headers.get("set-cookie");
  return setCookie ? setCookie.split(";")[0] : "";
}

function req(method: string, path: string, cookie: string, body?: unknown) {
  return SELF.fetch(`${BASE}${path}`, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const get = (p: string, c: string) => SELF.fetch(`${BASE}${p}`, { headers: { cookie: c } });

describe("tickets", () => {
  it("any authed user raises a ticket; billing keyword auto-routes", async () => {
    const jury = await login(INC_JURY);
    const res = await req("POST", "/api/tickets", jury, { subject: "Credit balance wrong", body: "Please check." });
    expect(res.status).toBe(200);
    const d = (await res.json()) as { ok: boolean; billingRouted: boolean };
    expect(d.ok).toBe(true);
    expect(d.billingRouted).toBe(true); // "credit" keyword

    const plain = await req("POST", "/api/tickets", jury, { subject: "UI glitch", body: "button broken" });
    expect(((await plain.json()) as { billingRouted: boolean }).billingRouted).toBe(false);
  });

  it("rejects an empty subject", async () => {
    const jury = await login(INC_JURY);
    expect((await req("POST", "/api/tickets", jury, { subject: "   " })).status).toBe(400);
  });

  it("only admins list and triage tickets", async () => {
    const jury = await login(INC_JURY);
    expect((await get("/api/tickets", jury)).status).toBe(403);

    const admin = await login(INC_ADMIN);
    const list = await get("/api/tickets", admin);
    expect(list.status).toBe(200);
    const { tickets } = (await list.json()) as { tickets: Array<{ id: string; status: string }> };
    expect(tickets.length).toBeGreaterThan(0);

    // Close the first open ticket.
    const open = tickets.find((t) => t.status === "open")!;
    const closed = await req("POST", `/api/tickets/${open.id}/status`, admin, { status: "closed" });
    expect(((await closed.json()) as { status: string }).status).toBe("closed");
  });
});

describe("contact messages", () => {
  it("sends and lists own messages; admins get an inbox", async () => {
    const jury = await login(INC_JURY);
    const sent = await req("POST", "/api/messages", jury, { toScope: "admin", body: "Please reassign my deck." });
    expect(((await sent.json()) as { ok: boolean }).ok).toBe(true);

    // Sender sees their own message (not an inbox).
    const mine = (await (await get("/api/messages?scope=admin", jury)).json()) as {
      messages: unknown[];
      inbox: boolean;
    };
    expect(mine.messages.length).toBeGreaterThan(0);
    expect(mine.inbox).toBe(false);

    // Admin sees the inbox for the admin scope.
    const admin = await login(INC_ADMIN);
    const inbox = (await (await get("/api/messages?scope=admin", admin)).json()) as { inbox: boolean; messages: unknown[] };
    expect(inbox.inbox).toBe(true);
    expect(inbox.messages.length).toBeGreaterThan(0);
  });

  it("rejects an empty message body", async () => {
    const jury = await login(INC_JURY);
    expect((await req("POST", "/api/messages", jury, { toScope: "team", body: "" })).status).toBe(400);
  });
});

// ── Session 7 — internal issue log ───────────────────────────────────────────
// Same `tickets` table, split by `category`. These tests lock the split in both
// directions: the support queue must never show an issue, and vice versa.

const VC_ANALYST = "rhea.nair@demo.startupjury.ai";
const INC_FOUNDER = "meera.sharma@demo.startupjury.ai";

interface IssueShape {
  id: string;
  subject: string;
  status: string;
  severity: string | null;
  area: string | null;
  assigneeId: string | null;
  assignee: string | null;
  creator: string;
}

describe("issue log", () => {
  it("any internal role logs an issue; founders cannot", async () => {
    const jury = await login(INC_JURY);
    const res = await req("POST", "/api/issues", jury, {
      subject: "Deck viewer scrolls past the last slide",
      body: "Repro: open GreenRoute, press next twice at the end.",
      severity: "high",
      area: "Evaluate",
    });
    expect(res.status).toBe(200);
    const { issue } = (await res.json()) as { issue: IssueShape };
    expect(issue.severity).toBe("high");
    expect(issue.area).toBe("Evaluate");
    expect(issue.status).toBe("open");
    expect(issue.creator).not.toBe("—");

    const founder = await login(INC_FOUNDER);
    expect((await get("/api/issues", founder)).status).toBe(403);
    expect((await req("POST", "/api/issues", founder, { subject: "hi" })).status).toBe(403);
  });

  it("requires a subject and defaults an unknown severity to medium", async () => {
    const jury = await login(INC_JURY);
    expect((await req("POST", "/api/issues", jury, { subject: "   " })).status).toBe(400);
    const res = await req("POST", "/api/issues", jury, { subject: "No severity given", severity: "spicy" });
    expect(((await res.json()) as { issue: IssueShape }).issue.severity).toBe("medium");
  });

  it("is edition-scoped and never mixes with the support queue", async () => {
    const admin = await login(INC_ADMIN);
    const { issues } = (await (await get("/api/issues", admin)).json()) as { issues: IssueShape[] };
    // Seeded incubator issues only — the VC one must not appear.
    expect(issues.some((i) => i.id === "iss_seed_1")).toBe(true);
    expect(issues.some((i) => i.id === "iss_seed_3")).toBe(false);

    // The admin Tickets screen must not show issues…
    const { tickets: support } = (await (await get("/api/tickets", admin)).json()) as {
      tickets: { id: string }[];
    };
    expect(support.some((t) => t.id.startsWith("iss_"))).toBe(false);
    // …and the issue log must not show support tickets.
    expect(issues.some((i) => i.id.startsWith("tkt_"))).toBe(false);
  });

  it("filters by status", async () => {
    const admin = await login(INC_ADMIN);
    const { issues } = (await (await get("/api/issues?status=closed", admin)).json()) as {
      issues: IssueShape[];
    };
    expect(issues.every((i) => i.status === "closed")).toBe(true);
  });

  it("only an admin triages, and the patch is validated", async () => {
    const jury = await login(INC_JURY);
    expect((await req("PATCH", "/api/issues/iss_seed_2", jury, { status: "closed" })).status).toBe(403);

    const admin = await login(INC_ADMIN);
    expect((await req("PATCH", "/api/issues/iss_seed_2", admin, { status: "done" })).status).toBe(400);
    expect((await req("PATCH", "/api/issues/iss_seed_2", admin, { severity: "spicy" })).status).toBe(400);
    expect((await req("PATCH", "/api/issues/iss_seed_2", admin, {})).status).toBe(400);
    // An assignee from another edition would silently orphan the issue.
    expect(
      (await req("PATCH", "/api/issues/iss_seed_2", admin, { assigneeId: "vc_admin" })).status,
    ).toBe(400);
    expect((await req("PATCH", "/api/issues/iss_nope", admin, { status: "closed" })).status).toBe(404);
  });

  it("an admin assigns, resolves and closes", async () => {
    const admin = await login(INC_ADMIN);
    const res = await req("PATCH", "/api/issues/iss_seed_2", admin, {
      status: "in_progress",
      severity: "medium",
      assigneeId: "inc_pa",
      resolution: "Filter state now lives in the active-context store.",
    });
    expect(res.status).toBe(200);
    const { issue } = (await res.json()) as { issue: IssueShape & { resolution: string } };
    expect(issue.status).toBe("in_progress");
    expect(issue.assigneeId).toBe("inc_pa");
    expect(issue.assignee).toBeTruthy();
    expect(issue.resolution).toContain("active-context");

    const cleared = (await (
      await req("PATCH", "/api/issues/iss_seed_2", admin, { assigneeId: null, status: "closed" })
    ).json()) as { issue: IssueShape };
    expect(cleared.issue.assigneeId).toBeNull();
    expect(cleared.issue.status).toBe("closed");
  });

  it("a VC user sees only the VC log", async () => {
    const analyst = await login(VC_ANALYST);
    const { issues } = (await (await get("/api/issues", analyst)).json()) as { issues: IssueShape[] };
    expect(issues.some((i) => i.id === "iss_seed_3")).toBe(true);
    expect(issues.some((i) => i.id === "iss_seed_1")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T1-COMMERCE · TENANT ISOLATION
// ─────────────────────────────────────────────────────────────────────────────
//
// §2 B20 is blunt about this file's three routers: `/api/tickets`, `/api/issues`
// and `/api/messages` are "the exact surface the client's tenancy sentence is
// about. Today every ticket sits in one flat edition-keyed pool with no
// upstream." `support.ts:39-41`, `:89-91`, `:133` and `:273-281` were all
// `edition`-only.
//
// Four shapes are covered, because this file holds one of each and they fail
// differently:
//
//   · a LIST (`GET /api/tickets`)              — a leak shows another customer's words
//   · a WRITE (`POST /api/tickets`)            — a leak shows NOTHING; `tenant-scope.test.ts`
//                                                 measured this exact INSERT landing in
//                                                 `t_default` with a 200
//   · an UPDATE (`POST /:id/status`, `PATCH`)  — a leak MUTATES another customer's row
//                                                 and reports `changes === 1`
//   · a per-USER read (`GET /api/messages`)    — looked safe because `m.from_id = ?`
//                                                 already narrows it, which is not a
//                                                 tenant boundary
//
// The two-queue split is asserted alongside, because scoping touched every
// statement that carried it: a scope says WHOSE rows, `tickets.category` says
// WHICH queue, and both must still apply.

const SX = "t_sx_support";
const SX_MARK = "SXTENANT";
const SX_ADMIN = "sx.admin@sxtenant.test";
const SX_JURY = "sx.jury@sxtenant.test";

/** The outermost frame: isolated storage pops a per-describe `beforeAll`. */
beforeAll(async () => {
  await env.DB.prepare(
    "INSERT INTO organizations (id, name, slug, status) VALUES (?, ?, 'sx-support', 'active') " +
      "ON CONFLICT (id) DO NOTHING",
  )
    .bind(SX, `${SX_MARK} Labs`)
    .run();
  for (const [id, email, role, name] of [
    ["sx_admin", SX_ADMIN, "admin", `${SX_MARK} Admin`],
    ["sx_jury", SX_JURY, "jury", `${SX_MARK} Juror`],
  ] as const) {
    await env.DB.prepare(
      "INSERT INTO users (id, tenant_id, name, email, role, edition, initials, password_hash) " +
        "SELECT ?, ?, ?, ?, ?, 'incubator', 'SX', password_hash FROM users WHERE email = ?",
    )
      .bind(id, SX, name, email, role, INC_ADMIN)
      .run();
  }
  await env.DB.prepare(
    "INSERT INTO tickets (id, tenant_id, edition, subject, body, category, created_by) " +
      "VALUES ('sx_tkt', ?, 'incubator', ?, ?, 'support', 'sx_jury')",
  )
    .bind(SX, `${SX_MARK} cannot log in`, `${SX_MARK} details`)
    .run();
  await env.DB.prepare(
    "INSERT INTO tickets (id, tenant_id, edition, subject, category, severity, created_by) " +
      "VALUES ('sx_iss', ?, 'incubator', ?, 'issue', 'high', 'sx_jury')",
  )
    .bind(SX, `${SX_MARK} deck viewer crashes`)
    .run();
  await env.DB.prepare(
    "INSERT INTO messages (id, tenant_id, edition, from_id, to_scope, body) " +
      "VALUES ('sx_msg_a', ?, 'incubator', 'sx_jury', 'admin', ?)",
  )
    .bind(SX, `${SX_MARK} private note to admin`)
    .run();
  await env.DB.prepare(
    "INSERT INTO messages (id, tenant_id, edition, from_id, to_scope, body) " +
      "VALUES ('sx_msg_t', ?, 'incubator', 'sx_jury', 'team', ?)",
  )
    .bind(SX, `${SX_MARK} broadcast to the team`)
    .run();
});

describe("tenancy — tickets, issues and messages stay inside one customer", () => {
  it("the fixture really landed, so nothing below passes for the wrong reason", async () => {
    const t = await env.DB.prepare("SELECT count(*) n FROM tickets WHERE tenant_id = ?")
      .bind(SX)
      .first<{ n: number }>();
    const m = await env.DB.prepare("SELECT count(*) n FROM messages WHERE tenant_id = ?")
      .bind(SX)
      .first<{ n: number }>();
    expect(t!.n).toBe(2);
    expect(m!.n).toBe(2);
    expect(await login(SX_ADMIN), "tenant B's admin cannot sign in").toBeTruthy();
  });

  it("the Tickets screen shows each admin only their own customer's queue", async () => {
    const theirs = await (await get("/api/tickets", await login(SX_ADMIN))).json<{
      tickets: { id: string; creator: string }[];
    }>();
    expect(theirs.tickets.map((t) => t.id)).toEqual(["sx_tkt"]);
    // The creator's name comes through the LEFT JOIN to `users`, which is now
    // matched on the workspace too — so this also proves the join did not drop the
    // row it should resolve.
    expect(theirs.tickets[0].creator).toContain(SX_MARK);

    const ours = await (await get("/api/tickets", await login(INC_ADMIN))).text();
    expect(ours, "§2 B20 — tenant B's support queue crossed into tenant A").not.toContain(SX_MARK);
  });

  it("the issue log shows each customer only their own issues, filtered or not", async () => {
    const cookie = await login(SX_ADMIN);
    const all = await (await get("/api/issues", cookie)).json<{ issues: { id: string }[] }>();
    expect(all.issues.map((i) => i.id)).toEqual(["sx_iss"]);
    // The `?status=` filter is a fragment AND a bind added together now; an
    // unfiltered pass and a filtered one must both still carry the scope.
    const open = await (await get("/api/issues?status=open", cookie)).json<{ issues: { id: string }[] }>();
    expect(open.issues.map((i) => i.id)).toEqual(["sx_iss"]);
    const closed = await (await get("/api/issues?status=closed", cookie)).json<{ issues: unknown[] }>();
    expect(closed.issues).toHaveLength(0);

    const ours = await (await get("/api/issues", await login(INC_ADMIN))).text();
    expect(ours).not.toContain(SX_MARK);
  });

  it("the two queues still cannot see each other, scoped or not", async () => {
    // Scoping touched every statement that carried `category`, so the split is
    // re-asserted here rather than assumed: the support ticket must not appear in
    // the issue log, nor the issue in the Tickets screen, for EITHER customer.
    const cookie = await login(SX_ADMIN);
    const tickets = await (await get("/api/tickets", cookie)).text();
    const issues = await (await get("/api/issues", cookie)).text();
    expect(tickets).toContain("sx_tkt");
    expect(tickets).not.toContain("sx_iss");
    expect(issues).toContain("sx_iss");
    expect(issues).not.toContain("sx_tkt");
  });

  it("the admin inbox and the team channel are both scoped, and so is the per-user view", async () => {
    const admin = await login(SX_ADMIN);
    const inbox = await (await get("/api/messages?scope=admin", admin)).json<{
      messages: { id: string }[];
    }>();
    expect(inbox.messages.map((m) => m.id)).toEqual(["sx_msg_a"]);
    const team = await (await get("/api/messages?scope=team", admin)).json<{
      messages: { id: string }[];
    }>();
    expect(team.messages.map((m) => m.id)).toEqual(["sx_msg_t"]);

    // The per-USER arm. It LOOKED like a tenant boundary because `m.from_id = ?`
    // already narrows the rows, and that is exactly the reasoning the wave exists
    // to refuse: `from_id` happens to exclude another customer only while the id it
    // binds is the caller's own, which is a property of this caller and not of the
    // statement.
    const juror = await login(SX_JURY);
    const own = await (await get("/api/messages?scope=admin", juror)).json<{
      messages: { id: string }[];
      inbox: boolean;
    }>();
    expect(own.inbox).toBe(false);
    expect(own.messages.map((m) => m.id)).toEqual(["sx_msg_a"]);

    const ours = await (await get("/api/messages?scope=admin", await login(INC_ADMIN))).text();
    expect(ours, "§2 B20 — tenant B's private messages crossed into tenant A").not.toContain(SX_MARK);
    const oursTeam = await (await get("/api/messages?scope=team", await login(INC_ADMIN))).text();
    expect(oursTeam).not.toContain(SX_MARK);
  });
});

describe("tenancy — the writes, where a leak shows nothing at all", () => {
  it("POST /api/tickets files the ticket under the raising customer, not the first one", async () => {
    // MEASURED by `test/worker/tenant-scope.test.ts`'s layer 3 on 2026-09-30: this
    // INSERT named no tenant, so `tickets.tenant_id`'s `DEFAULT 't_default'`
    // (`0084:62`) took effect and a second customer's ticket was filed against the
    // FIRST — 200, a row, and nothing in the response to notice. That case asserted
    // the leak as a pending FACT; this is the other side of the same ratchet.
    const subject = `${SX_MARK} write probe`;
    const res = await req("POST", "/api/tickets", await login(SX_JURY), {
      subject,
      body: "raised as the second customer",
    });
    expect(res.status).toBe(200);
    const row = await env.DB.prepare("SELECT tenant_id, edition FROM tickets WHERE subject = ?")
      .bind(subject)
      .first<{ tenant_id: string; edition: string }>();
    expect(row, "the ticket was not written at all — this probe tests nothing").toBeTruthy();
    expect(row!.tenant_id).toBe(SX);
    expect(row!.tenant_id).not.toBe("t_default");
  });

  it("POST /api/issues and POST /api/messages do the same", async () => {
    const cookie = await login(SX_JURY);
    const issue = await req("POST", "/api/issues", cookie, {
      subject: `${SX_MARK} issue probe`,
      severity: "low",
    });
    expect(issue.status).toBe(200);
    const { issue: created } = (await issue.json()) as { issue: { id: string } };
    const iRow = await env.DB.prepare("SELECT tenant_id FROM tickets WHERE id = ?")
      .bind(created.id)
      .first<{ tenant_id: string }>();
    expect(iRow!.tenant_id).toBe(SX);

    const msg = await req("POST", "/api/messages", cookie, { toScope: "team", body: `${SX_MARK} hello` });
    expect(msg.status).toBe(200);
    const { id } = (await msg.json()) as { id: string };
    const mRow = await env.DB.prepare("SELECT tenant_id FROM messages WHERE id = ?")
      .bind(id)
      .first<{ tenant_id: string }>();
    expect(mRow!.tenant_id).toBe(SX);
  });

  it("an admin cannot close, triage or re-assign another customer's ticket", async () => {
    // The worst shape in this file. An UPDATE with an insufficient predicate does
    // not leak a row, it MUTATES one — and `res.meta.changes === 1` reports it as a
    // success, so the handler answers `{ ok: true }` while another customer's queue
    // changes under them.
    const ours = await login(INC_ADMIN);
    const close = await req("POST", "/api/tickets/sx_tkt/status", ours, { status: "closed" });
    expect(close.status).toBe(404);
    const triage = await req("PATCH", "/api/issues/sx_iss", ours, { status: "closed", severity: "low" });
    expect(triage.status).toBe(404);
    // Both SEEDED rows are exactly as they were. Restricted to the two ids rather
    // than to the tenant, because the write cases above legitimately added more of
    // tenant B's rows and isolated storage keeps them for the rest of this suite.
    const { results } = await env.DB.prepare(
      "SELECT id, status, severity FROM tickets WHERE id IN ('sx_tkt', 'sx_iss') ORDER BY id",
    ).all<{ id: string; status: string; severity: string | null }>();
    expect(results).toEqual([
      { id: "sx_iss", status: "open", severity: "high" },
      { id: "sx_tkt", status: "open", severity: null },
    ]);
    // And tenant B's own admin CAN, so the 404s above are the scope rather than a
    // broken route.
    const theirs = await login(SX_ADMIN);
    expect((await req("POST", "/api/tickets/sx_tkt/status", theirs, { status: "closed" })).status).toBe(200);
    expect((await req("PATCH", "/api/issues/sx_iss", theirs, { status: "closed" })).status).toBe(200);
  });

  it("an issue cannot be assigned to another customer's employee", async () => {
    // `invalid_assignee` already guarded the EDITION. Under tenancy that guard let
    // an administrator hand their own issue to another customer's staff member,
    // whose name then renders as `assignee` on the log — a one-field leak of
    // somebody else's roster through a write.
    // `inc_admin` must really be a tenant-A user, or a 400 below would mean only
    // "no such id" and this case would prove nothing. `0002_seed.sql:46`.
    const target = await env.DB.prepare("SELECT tenant_id, edition FROM users WHERE id = 'inc_admin'")
      .first<{ tenant_id: string; edition: string }>();
    expect(target, "inc_admin does not exist — this guard is untested").toEqual({
      tenant_id: "t_default",
      edition: "incubator",
    });
    const res = await req("PATCH", "/api/issues/sx_iss", await login(SX_ADMIN), {
      assigneeId: "inc_admin",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_assignee" });
    // Their own juror is accepted, so the guard is not simply refusing everything.
    const ok = await req("PATCH", "/api/issues/sx_iss", await login(SX_ADMIN), {
      assigneeId: "sx_jury",
    });
    expect(ok.status, await ok.text()).toBe(200);
  });
});
