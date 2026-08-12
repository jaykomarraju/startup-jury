import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

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
