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
