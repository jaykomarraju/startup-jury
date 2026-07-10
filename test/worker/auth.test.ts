import { SELF, env } from "cloudflare:test";
import { Hono } from "hono";
import { describe, it, expect } from "vitest";
import { requireAuth, requireRole } from "../../src/server/auth/middleware";
import type { AppEnv } from "../../src/server/types";

const BASE = "https://example.com";

async function login(email: string, password: string) {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const setCookie = res.headers.get("set-cookie");
  const cookie = setCookie ? setCookie.split(";")[0] : "";
  return { res, cookie };
}

describe("POST /api/auth/login", () => {
  it("logs in a seed user and sets a session cookie", async () => {
    const { res, cookie } = await login("priya.sharma@demo.startupjury.ai", "demo1234");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { id: string; role: string } };
    expect(body.user.id).toBe("inc_superuser");
    expect(body.user.role).toBe("superuser");
    expect(cookie).toMatch(/^sj_session=/);
  });

  it("rejects a wrong password without leaking the account", async () => {
    const { res } = await login("priya.sharma@demo.startupjury.ai", "wrong");
    expect(res.status).toBe(401);
  });

  it("rejects an unknown email with the same 401", async () => {
    const { res } = await login("nobody@demo.startupjury.ai", "demo1234");
    expect(res.status).toBe(401);
  });
});

describe("GET /api/auth/me", () => {
  it("401 without a session", async () => {
    const res = await SELF.fetch(`${BASE}/api/auth/me`);
    expect(res.status).toBe(401);
  });

  it("returns the current user with a valid session", async () => {
    const { cookie } = await login("rhea.nair@demo.startupjury.ai", "demo1234");
    const res = await SELF.fetch(`${BASE}/api/auth/me`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { id: string; edition: string } };
    expect(body.user.id).toBe("vc_analyst");
    expect(body.user.edition).toBe("vc");
  });
});

describe("requireRole middleware", () => {
  const testApp = new Hono<AppEnv>();
  testApp.get("/admin-only", requireAuth, requireRole("admin"), (c) =>
    c.json({ ok: true }),
  );

  async function callAdminOnly(cookie: string) {
    return testApp.request("/admin-only", { headers: { Cookie: cookie } }, env);
  }

  it("allows the matching role", async () => {
    const { cookie } = await login("nisha.kapoor@demo.startupjury.ai", "demo1234");
    expect((await callAdminOnly(cookie)).status).toBe(200);
  });

  it("allows superuser (full access)", async () => {
    const { cookie } = await login("priya.sharma@demo.startupjury.ai", "demo1234");
    expect((await callAdminOnly(cookie)).status).toBe(200);
  });

  it("forbids a non-matching role", async () => {
    const { cookie } = await login("rajesh.kumar@demo.startupjury.ai", "demo1234");
    expect((await callAdminOnly(cookie)).status).toBe(403);
  });

  it("401 without a session", async () => {
    expect((await callAdminOnly("")).status).toBe(401);
  });
});
