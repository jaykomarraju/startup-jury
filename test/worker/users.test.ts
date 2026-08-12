import { SELF, env } from "cloudflare:test";
import { describe, it, expect, vi } from "vitest";
import type { EmailSender } from "../../src/server/email/outbox";

// User management (Session 4) — POST/GET/PATCH /api/users, superuser/admin-gated,
// edition-scoped. Mentor is a user-type. NB: worker-test storage is isolated
// per-file (writes accumulate across `it`s), so every test uses a unique email.

const BASE = "https://example.com";

const INC_ADMIN = "nisha.kapoor@demo.startupjury.ai"; // incubator admin
const INC_SUPER = "priya.sharma@demo.startupjury.ai"; // incubator superuser
const INC_PA = "sunita.rao@demo.startupjury.ai"; // program_associate (non-admin)
const INC_JURY = "rajesh.kumar@demo.startupjury.ai"; // jury (non-admin)
const VC_ADMIN = "nisha.kapoor.vc@demo.startupjury.ai"; // vc admin

async function login(email: string, password = "demo1234"): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
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

interface UserView {
  id: string;
  name: string;
  email: string;
  role: string;
  roleLabel: string;
  userType: string;
  active: boolean;
}

async function roster(cookie: string): Promise<UserView[]> {
  const r = await get("/api/users", cookie);
  return ((await r.json()) as { users: UserView[] }).users;
}

describe("user management — roster reads", () => {
  it("an admin lists their edition's roster (incl. the seeded mentor)", async () => {
    const admin = await login(INC_ADMIN);
    const users = await roster(admin);
    const emails = users.map((u) => u.email);
    expect(emails).toContain("raj.kumar@demo.startupjury.ai"); // inc_pm
    expect(emails).toContain("anil.mehta@demo.startupjury.ai"); // seeded mentor
    // Edition-scoped — no VC users leak into the incubator roster.
    expect(emails.some((e) => e.endsWith(".vc@demo.startupjury.ai"))).toBe(false);
    // The mentor carries the mentor user-type + a "Mentor" display label.
    const mentor = users.find((u) => u.email === "anil.mehta@demo.startupjury.ai")!;
    expect(mentor.userType).toBe("mentor");
    expect(mentor.roleLabel).toBe("Mentor");
  });

  it("a non-admin (jury / associate) cannot read the roster (403)", async () => {
    expect((await get("/api/users", await login(INC_JURY))).status).toBe(403);
    expect((await get("/api/users", await login(INC_PA))).status).toBe(403);
  });

  it("an anonymous request is unauthorized (401)", async () => {
    expect((await SELF.fetch(`${BASE}/api/users`)).status).toBe(401);
  });
});

describe("user management — create", () => {
  it("an admin creates a staff jury member who can then log in", async () => {
    const admin = await login(INC_ADMIN);
    const res = await req("POST", "/api/users", admin, {
      name: "Kavya Reddy",
      email: "kavya.reddy@newteam.io",
      role: "jury",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; tempPassword: string; user: UserView };
    expect(body.user.role).toBe("jury");
    expect(body.user.roleLabel).toBe("Jury Member");
    expect(body.user.active).toBe(true);
    expect(typeof body.tempPassword).toBe("string");
    expect(body.tempPassword.length).toBeGreaterThan(4);

    // The new user shows up in the roster and can authenticate with the temp password.
    const users = await roster(admin);
    expect(users.map((u) => u.email)).toContain("kavya.reddy@newteam.io");
    const cookie = await login("kavya.reddy@newteam.io", body.tempPassword);
    expect(cookie).not.toBe("");
    const me = await get("/api/auth/me", cookie);
    expect(me.status).toBe(200);
  });

  it("an admin creates a MENTOR (user-type, no pipeline role)", async () => {
    const admin = await login(INC_ADMIN);
    const res = await req("POST", "/api/users", admin, {
      name: "Deepa Iyer",
      email: "deepa.iyer@advisors.io",
      userType: "mentor",
      role: "jury", // ignored for a mentor
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: UserView };
    expect(body.user.userType).toBe("mentor");
    expect(body.user.role).toBe("mentor");
    expect(body.user.roleLabel).toBe("Mentor");
  });

  it("rejects a duplicate email (409), superuser/founder roles (400) and bad emails (400)", async () => {
    const admin = await login(INC_ADMIN);
    // Duplicate of a seeded user.
    const dup = await req("POST", "/api/users", admin, {
      name: "Clone", email: "raj.kumar@demo.startupjury.ai", role: "jury",
    });
    expect(dup.status).toBe(409);
    // superuser is not creatable (one per account).
    const su = await req("POST", "/api/users", admin, {
      name: "X", email: "x1@newteam.io", role: "superuser",
    });
    expect(su.status).toBe(400);
    // founder is external, not creatable here.
    const founder = await req("POST", "/api/users", admin, {
      name: "X", email: "x2@newteam.io", role: "founder",
    });
    expect(founder.status).toBe(400);
    // A VC role is invalid for an incubator admin.
    const cross = await req("POST", "/api/users", admin, {
      name: "X", email: "x3@newteam.io", role: "partner",
    });
    expect(cross.status).toBe(400);
    // Malformed email.
    const bad = await req("POST", "/api/users", admin, {
      name: "X", email: "not-an-email", role: "jury",
    });
    expect(bad.status).toBe(400);
  });

  it("a non-admin cannot create users (403)", async () => {
    const pa = await login(INC_PA);
    const res = await req("POST", "/api/users", pa, {
      name: "X", email: "x4@newteam.io", role: "jury",
    });
    expect(res.status).toBe(403);
  });

  it("a VC admin creates VC roles but not incubator ones", async () => {
    const vc = await login(VC_ADMIN);
    const ok = await req("POST", "/api/users", vc, {
      name: "Nikhil Rao", email: "nikhil.rao@vcfirm.io", role: "analyst",
    });
    expect(ok.status).toBe(200);
    const bad = await req("POST", "/api/users", vc, {
      name: "X", email: "x5@vcfirm.io", role: "program_manager",
    });
    expect(bad.status).toBe(400);
  });
});

describe("user management — the invite email carries the temp password (Session 8)", () => {
  // The Worker under SELF.fetch reads the same `env` object the test holds, so a
  // stub `send_email` binding can be installed for a single test and removed
  // again. Everything else in this file runs with delivery UNconfigured, which
  // is also production's state until the sending domain is onboarded.

  it("without a sending domain the password is returned for the admin to relay", async () => {
    const admin = await login(INC_ADMIN);
    const res = await req("POST", "/api/users", admin, {
      name: "Relay Case",
      email: "relay.case@newteam.io",
      role: "jury",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      tempPassword?: string;
      invite: { delivered: boolean; status: string };
    };
    expect(body.invite).toEqual({ delivered: false, status: "skipped" });
    // The credential must still reach the admin — otherwise the new account is
    // unreachable, which is exactly why Session 6 deferred this change.
    expect(typeof body.tempPassword).toBe("string");
    const cookie = await login("relay.case@newteam.io", body.tempPassword!);
    expect(cookie).not.toBe("");

    // Nothing was recorded either: no send was attempted at all.
    const audited = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM email_outbox WHERE kind = 'account_invite' AND to_email = ?",
    )
      .bind("relay.case@newteam.io")
      .first<{ n: number }>();
    expect(audited?.n).toBe(0);
  });

  it("with delivery configured the password is emailed and withheld from the response", async () => {
    const sent: Parameters<EmailSender["send"]>[0][] = [];
    const stub: EmailSender = {
      send: vi.fn(async (m) => {
        sent.push(m);
        return { messageId: "msg_invite_1" };
      }),
    };
    const original = { EMAIL: env.EMAIL, EMAIL_FROM: env.EMAIL_FROM };
    Object.assign(env, { EMAIL: stub, EMAIL_FROM: "no-reply@example.test" });

    try {
      const admin = await login(INC_ADMIN);
      const res = await req("POST", "/api/users", admin, {
        name: "Mailed Juror",
        email: "mailed.juror@newteam.io",
        role: "jury",
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        tempPassword?: string;
        invite: { delivered: boolean; status: string };
      };

      expect(body.invite).toEqual({ delivered: true, status: "sent" });
      // The whole point: the credential is no longer in the API response.
      expect(body.tempPassword).toBeUndefined();

      expect(sent).toHaveLength(1);
      const mail = sent[0];
      expect(mail.to).toBe("mailed.juror@newteam.io");
      expect(mail.subject).toContain("ai.STARTUPJURY");
      expect(mail.text).toContain("Hi Mailed Juror,");
      expect(mail.text).toContain("/login");
      // Names the inviting admin and the role they were given.
      expect(mail.text).toContain("Nisha Kapoor");
      expect(mail.text).toContain("Jury Member");

      // The password only exists in the message — recover it and prove it works.
      const match = /Temporary password: (\S+)/.exec(mail.text ?? "");
      expect(match).not.toBeNull();
      const cookie = await login("mailed.juror@newteam.io", match![1]);
      expect(cookie).not.toBe("");

      // …and the durable audit log must NOT contain the credential.
      const row = await env.DB.prepare(
        "SELECT body, status FROM email_outbox WHERE kind = 'account_invite' AND to_email = ?",
      )
        .bind("mailed.juror@newteam.io")
        .first<{ body: string; status: string }>();
      expect(row?.status).toBe("sent");
      expect(row?.body).not.toContain(match![1]);
      expect(row?.body).toContain("[redacted]");
    } finally {
      Object.assign(env, original);
    }
  });

  it("a delivery failure falls back to relaying the password", async () => {
    const stub: EmailSender = {
      send: vi.fn(async () => {
        throw new Error("550 sender not verified");
      }),
    };
    const original = { EMAIL: env.EMAIL, EMAIL_FROM: env.EMAIL_FROM };
    Object.assign(env, { EMAIL: stub, EMAIL_FROM: "no-reply@example.test" });

    try {
      const admin = await login(INC_ADMIN);
      const res = await req("POST", "/api/users", admin, {
        name: "Bounced Invite",
        email: "bounced.invite@newteam.io",
        role: "jury",
      });
      const body = (await res.json()) as {
        tempPassword?: string;
        invite: { delivered: boolean; status: string };
      };
      // The user WAS created — a mail problem must not roll that back — and the
      // admin keeps a way to get them in.
      expect(res.status).toBe(200);
      expect(body.invite).toEqual({ delivered: false, status: "failed" });
      expect(typeof body.tempPassword).toBe("string");
      expect(await login("bounced.invite@newteam.io", body.tempPassword!)).not.toBe("");
    } finally {
      Object.assign(env, original);
    }
  });
});

describe("user management — update (activate / deactivate)", () => {
  it("an admin deactivates then reactivates a user; a deactivated user cannot log in", async () => {
    const admin = await login(INC_ADMIN);
    const created = (await (
      await req("POST", "/api/users", admin, {
        name: "Temp Staff", email: "temp.staff@newteam.io", role: "program_associate",
      })
    ).json()) as { tempPassword: string; user: UserView };

    // Deactivate.
    const off = await req("PATCH", `/api/users/${created.user.id}`, admin, { active: false });
    expect(off.status).toBe(200);
    expect(((await off.json()) as { user: UserView }).user.active).toBe(false);
    // A deactivated user is refused at login (uniform 401).
    const denied = await SELF.fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "temp.staff@newteam.io", password: created.tempPassword }),
    });
    expect(denied.status).toBe(401);

    // Reactivate.
    const on = await req("PATCH", `/api/users/${created.user.id}`, admin, { active: true });
    expect(((await on.json()) as { user: UserView }).user.active).toBe(true);
  });

  it("an admin cannot deactivate themselves or a superuser", async () => {
    const admin = await login(INC_ADMIN);
    const self = await req("PATCH", "/api/users/inc_admin", admin, { active: false });
    expect(self.status).toBe(403);
    const su = await req("PATCH", "/api/users/inc_superuser", admin, { active: false });
    expect(su.status).toBe(403);
  });

  it("a superuser may also manage users (requireRole bypass)", async () => {
    const su = await login(INC_SUPER);
    const res = await req("POST", "/api/users", su, {
      name: "SU Made", email: "su.made@newteam.io", role: "jury",
    });
    expect(res.status).toBe(200);
  });
});
