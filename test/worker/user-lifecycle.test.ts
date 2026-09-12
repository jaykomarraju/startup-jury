/**
 * W4-A — the user verbs the Admin console's Team & roles and User access
 * sections need, and the guards that keep each of them from being a foot-gun.
 *
 * §8 Q27 listed the task rows that had a cell in the permission grid and no verb
 * behind them. Three were this session's: *Activate user* and *Deactivate user*
 * (already a route, gated per DIRECTION, untested from the direction that
 * matters) and *Delete user*, which had no route at all. Plus the two credential
 * routes the reset-only User access section rests on.
 *
 * NB worker-test storage is isolated per FILE and shared across the `it`s in it,
 * so anything that closes a permission cell or deactivates a seeded row puts it
 * back.
 */
import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";

const BASE = "https://example.com";

const INC_SUPER = "priya.sharma@demo.startupjury.ai";
const INC_ADMIN = "nisha.kapoor@demo.startupjury.ai";
const INC_PM = "raj.kumar@demo.startupjury.ai";
const INC_PA = "sunita.rao@demo.startupjury.ai";
const INC_JURY = "rajesh.kumar@demo.startupjury.ai";

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
  active: boolean;
  invitePending?: boolean;
  inviteSentAt?: string;
  mustChangePassword?: boolean;
}

async function roster(cookie: string): Promise<UserView[]> {
  return ((await (await get("/api/users", cookie)).json()) as { users: UserView[] }).users;
}

/** Create a member and hand back the row plus its temporary credential. */
async function invite(
  cookie: string,
  name: string,
  email: string,
  role = "jury",
): Promise<{ user: UserView; tempPassword: string }> {
  const res = await req("POST", "/api/users", cookie, { name, email, role });
  expect(res.status, `invite ${email}`).toBe(200);
  return (await res.json()) as { user: UserView; tempPassword: string };
}

/** Write one permission cell directly, to set up a gated refusal. */
async function setCell(role: string, taskId: string, granted: boolean) {
  await env.DB.prepare(
    "INSERT INTO role_permissions (edition, role, task_id, granted) VALUES ('incubator', ?, ?, ?) " +
      "ON CONFLICT (edition, role, task_id) DO UPDATE SET granted = excluded.granted",
  )
    .bind(role, taskId, granted ? 1 : 0)
    .run();
}

// ── The roster now reports the invite lifecycle ──────────────────────────────

describe("the roster reports invite state (F0064)", () => {
  it("a new member is pending until the credential is first used", async () => {
    const admin = await login(INC_ADMIN);
    const { user, tempPassword } = await invite(admin, "Pending Pat", "pending.pat@newteam.io");

    let row = (await roster(admin)).find((u) => u.id === user.id)!;
    expect(row.invitePending).toBe(true);
    expect(row.mustChangePassword).toBe(true);
    expect(row.inviteSentAt).toBeTruthy();

    // The first successful sign-in is what accepts it (0041 / auth.ts).
    expect(await login("pending.pat@newteam.io", tempPassword)).not.toBe("");

    row = (await roster(admin)).find((u) => u.id === user.id)!;
    expect(row.invitePending).toBe(false);

    // A seeded account that has signed in for years is not pending either.
    expect((await roster(admin)).find((u) => u.id === "inc_pm")!.invitePending).toBe(false);
  });
});

// ── Activate / Deactivate — gated per direction ──────────────────────────────

describe("activate + deactivate are separate permissions (§8 Q27)", () => {
  it("closing `deactivateuser` blocks switching a member off but not back on", async () => {
    const admin = await login(INC_ADMIN);
    const { user } = await invite(admin, "Toggle Tara", "toggle.tara@newteam.io");

    await setCell("admin", "deactivateuser", false);
    const off = await req("PATCH", `/api/users/${user.id}`, admin, { active: false });
    expect(off.status).toBe(403);

    // The other direction is a different cell and is untouched. Switch the user
    // off with the cell open, then prove `activateuser` still works with
    // `deactivateuser` closed.
    await setCell("admin", "deactivateuser", true);
    expect((await req("PATCH", `/api/users/${user.id}`, admin, { active: false })).status).toBe(200);
    await setCell("admin", "deactivateuser", false);
    expect((await req("PATCH", `/api/users/${user.id}`, admin, { active: true })).status).toBe(200);

    await setCell("admin", "deactivateuser", true);
  });

  it("closing `activateuser` blocks switching a member back on", async () => {
    const admin = await login(INC_ADMIN);
    const { user } = await invite(admin, "Off Omar", "off.omar@newteam.io");
    expect((await req("PATCH", `/api/users/${user.id}`, admin, { active: false })).status).toBe(200);

    await setCell("admin", "activateuser", false);
    expect((await req("PATCH", `/api/users/${user.id}`, admin, { active: true })).status).toBe(403);
    await setCell("admin", "activateuser", true);
    expect((await req("PATCH", `/api/users/${user.id}`, admin, { active: true })).status).toBe(200);
  });
});

// ── Delete ──────────────────────────────────────────────────────────────────

describe("DELETE /api/users/:id (F0065)", () => {
  it("removes a member from the roster and from sign-in, and frees the address", async () => {
    const admin = await login(INC_ADMIN);
    const { user, tempPassword } = await invite(admin, "Leaver Leela", "leaver@newteam.io");
    expect(await login("leaver@newteam.io", tempPassword)).not.toBe("");

    const res = await req("DELETE", `/api/users/${user.id}`, admin);
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toMatchObject({ ok: true, id: user.id });

    // Gone from the roster…
    expect((await roster(admin)).map((u) => u.id)).not.toContain(user.id);
    // …and refused at sign-in, because the soft delete also clears `active`.
    const denied = await SELF.fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "leaver@newteam.io", password: tempPassword }),
    });
    expect(denied.status).toBe(401);

    // The row survives for the decks / audit rows that name it…
    const kept = await env.DB.prepare(
      "SELECT deleted_at, deleted_email, active FROM users WHERE id = ?",
    )
      .bind(user.id)
      .first<{ deleted_at: string | null; deleted_email: string | null; active: number }>();
    expect(kept?.deleted_at).toBeTruthy();
    expect(kept?.deleted_email).toBe("leaver@newteam.io");
    expect(kept?.active).toBe(0);

    // …and the seat is genuinely released: the same address can be re-invited.
    const again = await req("POST", "/api/users", admin, {
      name: "Leaver Leela", email: "leaver@newteam.io", role: "jury",
    });
    expect(again.status).toBe(200);
  });

  it("cancelling a pending invite is reported as a cancellation, not a removal", async () => {
    const admin = await login(INC_ADMIN);
    const { user } = await invite(admin, "Never Signed In", "never.in@newteam.io");
    const res = await req("DELETE", `/api/users/${user.id}`, admin);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { cancelledInvite: boolean }).cancelledInvite).toBe(true);

    // Both rows land inside the same second, so this asks WHICH actions were
    // written rather than which is newest.
    const trail = (
      await env.DB.prepare("SELECT action FROM audit_log WHERE target_id = ?")
        .bind(user.id)
        .all<{ action: string }>()
    ).results.map((r) => r.action);
    expect(trail).toContain("invite_cancelled");
    expect(trail).not.toContain("user_deleted");
  });

  it("refuses a role the task list withholds (403), an anonymous caller (401) and a stranger (404)", async () => {
    for (const email of [INC_PA, INC_JURY, INC_PM]) {
      const res = await req("DELETE", "/api/users/inc_jury", await login(email));
      expect(res.status, email).toBe(403);
    }
    expect((await SELF.fetch(`${BASE}/api/users/inc_jury`, { method: "DELETE" })).status).toBe(401);
    // Edition-scoped: a VC row is simply not there for an incubator admin.
    expect((await req("DELETE", "/api/users/vc_analyst", await login(INC_ADMIN))).status).toBe(404);
  });

  it("refuses the account owner and the caller's own row", async () => {
    const admin = await login(INC_ADMIN);
    const su = await req("DELETE", "/api/users/inc_superuser", admin);
    expect(su.status).toBe(403);
    expect((await su.json()) as { error: string }).toEqual({ error: "immutable_superuser" });

    const self = await req("DELETE", "/api/users/inc_admin", admin);
    expect(self.status).toBe(403);
    expect((await self.json()) as { error: string }).toEqual({ error: "cannot_delete_self" });
  });

  it("refuses to remove the last person who can open the console", async () => {
    // Sign in FIRST: the session survives the row being switched off below, and
    // it is the only principal left that could make this call.
    const su = await login(INC_SUPER);
    await env.DB.prepare("UPDATE users SET active = 0 WHERE id = 'inc_superuser'").run();
    try {
      const res = await req("DELETE", "/api/users/inc_admin", su);
      expect(res.status).toBe(409);
      expect((await res.json()) as { error: string }).toEqual({ error: "last_admin" });
    } finally {
      await env.DB.prepare("UPDATE users SET active = 1 WHERE id = 'inc_superuser'").run();
    }

    // With the owner active again there is a second keyholder, so the same call
    // is allowed — the guard is about the count, not about the admin role.
    const after = await req("DELETE", "/api/users/inc_admin", await login(INC_SUPER));
    expect(after.status).toBe(200);
    // Put the seeded admin back for the rest of the file.
    await env.DB.prepare(
      "UPDATE users SET deleted_at = NULL, active = 1, email = deleted_email, deleted_email = NULL WHERE id = 'inc_admin'",
    ).run();
  });

  it("is gated on the grid's own `deleteuser` cell (gate, not grant)", async () => {
    const admin = await login(INC_ADMIN);
    const { user } = await invite(admin, "Gated Gita", "gated.gita@newteam.io");

    await setCell("admin", "deleteuser", false);
    expect((await req("DELETE", `/api/users/${user.id}`, admin)).status).toBe(403);

    // Ticking it back restores exactly that capability.
    await setCell("admin", "deleteuser", true);
    expect((await req("DELETE", `/api/users/${user.id}`, admin)).status).toBe(200);

    // …and ticking it ON for a role the route's list withholds grants nothing.
    await setCell("jury", "deleteuser", true);
    expect((await req("DELETE", "/api/users/inc_pa", await login(INC_JURY))).status).toBe(403);
    await setCell("jury", "deleteuser", false);
  });
});

// ── Reset password ──────────────────────────────────────────────────────────

describe("POST /api/users/:id/reset-password (F0124, reset-only per §1.2)", () => {
  it("issues a fresh credential, invalidates the old one, and never reveals a stored one", async () => {
    const admin = await login(INC_ADMIN);
    const { user, tempPassword } = await invite(admin, "Locked Out", "locked.out@newteam.io");
    // They sign in once, so the account is no longer pending.
    expect(await login("locked.out@newteam.io", tempPassword)).not.toBe("");

    const res = await req("POST", `/api/users/${user.id}/reset-password`, admin);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tempPassword?: string; invite: { status: string } };
    // No sending domain in the test env, so the credential comes back to relay.
    expect(body.invite.status).toBe("skipped");
    expect(typeof body.tempPassword).toBe("string");
    expect(body.tempPassword).not.toBe(tempPassword);

    // The new one works and the old one does not.
    expect(await login("locked.out@newteam.io", body.tempPassword!)).not.toBe("");
    const old = await SELF.fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "locked.out@newteam.io", password: tempPassword }),
    });
    expect(old.status).toBe(401);

    // The roster reports the credential as system-issued again.
    expect((await roster(admin)).find((u) => u.id === user.id)!.mustChangePassword).toBe(true);
  });

  it("an admin may not reset the account owner's password, or their own", async () => {
    const admin = await login(INC_ADMIN);
    const owner = await req("POST", "/api/users/inc_superuser/reset-password", admin);
    expect(owner.status).toBe(403);
    expect((await owner.json()) as { error: string }).toEqual({ error: "immutable_superuser" });

    const self = await req("POST", "/api/users/inc_admin/reset-password", admin);
    expect(self.status).toBe(403);
    expect((await self.json()) as { error: string }).toEqual({ error: "cannot_reset_self" });

    // The owner may reset anyone else. Deliberately NOT a seeded login: rotating
    // a seeded account's password here would break every later `login()` in the
    // file, which is exactly how this test first went red.
    const su = await login(INC_SUPER);
    const { user } = await invite(su, "Owner Reset", "owner.reset@newteam.io");
    expect((await req("POST", `/api/users/${user.id}/reset-password`, su)).status).toBe(200);
  });

  it("403s a role without the console", async () => {
    for (const email of [INC_PM, INC_PA, INC_JURY]) {
      const res = await req("POST", "/api/users/inc_jury/reset-password", await login(email));
      expect(res.status, email).toBe(403);
    }
  });
});

// ── Resend invite ───────────────────────────────────────────────────────────

describe("POST /api/users/:id/resend-invite (F0064)", () => {
  it("issues a new credential and moves the sent stamp", async () => {
    const admin = await login(INC_ADMIN);
    const { user, tempPassword } = await invite(admin, "Resend Ravi", "resend.ravi@newteam.io");
    const sentFirst = (await roster(admin)).find((u) => u.id === user.id)!.inviteSentAt;

    await env.DB.prepare("UPDATE users SET invite_sent_at = '2020-01-01 00:00:00' WHERE id = ?")
      .bind(user.id)
      .run();

    const res = await req("POST", `/api/users/${user.id}/resend-invite`, admin);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tempPassword?: string };
    expect(body.tempPassword).toBeTruthy();
    expect(body.tempPassword).not.toBe(tempPassword);

    const after = (await roster(admin)).find((u) => u.id === user.id)!;
    expect(after.inviteSentAt).not.toBe("2020-01-01 00:00:00");
    expect(sentFirst).toBeTruthy();
    // The superseded credential no longer works; the new one does.
    const old = await SELF.fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "resend.ravi@newteam.io", password: tempPassword }),
    });
    expect(old.status).toBe(401);
    expect(await login("resend.ravi@newteam.io", body.tempPassword!)).not.toBe("");
  });

  it("refuses a member who has already signed in — that is a reset, not a resend", async () => {
    const admin = await login(INC_ADMIN);
    const res = await req("POST", "/api/users/inc_pa/resend-invite", admin);
    expect(res.status).toBe(409);
    expect((await res.json()) as { error: string }).toEqual({ error: "invite_already_accepted" });
  });

  it("403s a role without `addmembers`", async () => {
    const res = await req("POST", "/api/users/inc_jury/resend-invite", await login(INC_PM));
    expect(res.status).toBe(403);
  });
});

// ── Self-service password change (F0075) ────────────────────────────────────

describe("PUT /api/users/me/password (F0075)", () => {
  it("lets a user replace the credential the system issued", async () => {
    const admin = await login(INC_ADMIN);
    const { user, tempPassword } = await invite(admin, "Change Chetan", "change.chetan@newteam.io");
    const cookie = await login("change.chetan@newteam.io", tempPassword);

    const res = await req("PUT", "/api/users/me/password", cookie, {
      currentPassword: tempPassword,
      newPassword: "a-much-better-secret",
    });
    expect(res.status).toBe(200);

    // The old credential is dead, the new one works…
    const old = await SELF.fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "change.chetan@newteam.io", password: tempPassword }),
    });
    expect(old.status).toBe(401);
    expect(await login("change.chetan@newteam.io", "a-much-better-secret")).not.toBe("");

    // …and User access stops calling it a temporary one.
    expect((await roster(admin)).find((u) => u.id === user.id)!.mustChangePassword).toBe(false);
  });

  it("verifies the current password and refuses a weak or unchanged one", async () => {
    const admin = await login(INC_ADMIN);
    const { tempPassword } = await invite(admin, "Guard Gopal", "guard.gopal@newteam.io");
    const cookie = await login("guard.gopal@newteam.io", tempPassword);

    const wrong = await req("PUT", "/api/users/me/password", cookie, {
      currentPassword: "not-it", newPassword: "a-much-better-secret",
    });
    expect(wrong.status).toBe(403);

    const short = await req("PUT", "/api/users/me/password", cookie, {
      currentPassword: tempPassword, newPassword: "short",
    });
    expect(short.status).toBe(400);
    expect((await short.json()) as { error: string }).toEqual({ error: "password_too_short" });

    const same = await req("PUT", "/api/users/me/password", cookie, {
      currentPassword: tempPassword, newPassword: tempPassword,
    });
    expect(same.status).toBe(400);

    // The original still works — none of the refusals wrote anything.
    expect(await login("guard.gopal@newteam.io", tempPassword)).not.toBe("");
  });

  it("401s an anonymous caller", async () => {
    const res = await SELF.fetch(`${BASE}/api/users/me/password`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: "x", newPassword: "yyyyyyyy" }),
    });
    expect(res.status).toBe(401);
  });
});

// ── Ownership transfer (F0062) ──────────────────────────────────────────────
//
// LAST in the file on purpose: a successful transfer rewrites `inc_superuser`
// and its target, and worker-test storage is shared across the `it`s in a file.
// Every test here puts both rows back.

describe("POST /api/users/:id/transfer-ownership (F0062)", () => {
  async function restoreSeedOwner(promotedId: string) {
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET role = 'superuser' WHERE id = 'inc_superuser'"),
      env.DB.prepare("UPDATE users SET role = 'jury' WHERE id = ?").bind(promotedId),
    ]);
  }

  it("promotes the new owner, demotes the old one, and ends the old one's session", async () => {
    const admin = await login(INC_ADMIN);
    const { user, tempPassword } = await invite(admin, "Next Owner", "next.owner@newteam.io");
    // Only someone who has actually signed in can take the account on.
    expect(await login("next.owner@newteam.io", tempPassword)).not.toBe("");

    const su = await login(INC_SUPER);
    const res = await req("POST", `/api/users/${user.id}/transfer-ownership`, su);
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toMatchObject({ ok: true, signedOut: true });

    const rows = (
      await env.DB.prepare("SELECT id, role FROM users WHERE id IN (?, 'inc_superuser')")
        .bind(user.id)
        .all<{ id: string; role: string }>()
    ).results;
    expect(rows.find((r) => r.id === user.id)?.role).toBe("superuser");
    expect(rows.find((r) => r.id === "inc_superuser")?.role).toBe("admin");
    // Exactly one owner per edition — the invariant the batch exists to keep.
    const owners = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM users WHERE edition = 'incubator' AND role = 'superuser' AND deleted_at IS NULL",
    ).first<{ n: number }>();
    expect(owners?.n).toBe(1);

    // The outgoing owner's KV session is gone, so their superuser bypass does
    // not outlive the transfer by up to seven days.
    expect((await get("/api/users", su)).status).toBe(401);

    await restoreSeedOwner(user.id);
  });

  it("is the owner's alone — an admin cannot hand the account on", async () => {
    const res = await req("POST", "/api/users/inc_pa/transfer-ownership", await login(INC_ADMIN));
    expect(res.status).toBe(403);
    expect(
      (await env.DB.prepare("SELECT role FROM users WHERE id = 'inc_pa'").first<{ role: string }>())
        ?.role,
    ).toBe("program_associate");
  });

  it("refuses yourself, a pending invitee, a deactivated member and a mentor", async () => {
    const admin = await login(INC_ADMIN);
    const su = await login(INC_SUPER);

    const self = await req("POST", "/api/users/inc_superuser/transfer-ownership", su);
    expect(self.status).toBe(400);
    expect((await self.json()) as { error: string }).toEqual({ error: "already_owner" });

    const { user: pending } = await invite(admin, "Not In Yet", "not.in.yet@newteam.io");
    const p = await req("POST", `/api/users/${pending.id}/transfer-ownership`, su);
    expect(p.status).toBe(409);
    expect((await p.json()) as { error: string }).toEqual({ error: "invite_pending" });

    const { user: off, tempPassword } = await invite(admin, "Switched Off", "switched.off@newteam.io");
    await login("switched.off@newteam.io", tempPassword);
    expect((await req("PATCH", `/api/users/${off.id}`, admin, { active: false })).status).toBe(200);
    const o = await req("POST", `/api/users/${off.id}/transfer-ownership`, su);
    expect(o.status).toBe(409);
    expect((await o.json()) as { error: string }).toEqual({ error: "inactive_user" });

    const made = await req("POST", "/api/users", admin, {
      name: "Advisor Only", email: "advisor.only@newteam.io", userType: "mentor",
    });
    const { user: mentor } = (await made.json()) as { user: UserView };
    const m = await req("POST", `/api/users/${mentor.id}/transfer-ownership`, su);
    expect(m.status).toBe(400);

    // A VC row is not there for an incubator owner.
    expect((await req("POST", "/api/users/vc_partner/transfer-ownership", su)).status).toBe(404);

    // Nothing above moved the seat.
    const owner = await env.DB.prepare(
      "SELECT role FROM users WHERE id = 'inc_superuser'",
    ).first<{ role: string }>();
    expect(owner?.role).toBe("superuser");
  });
});
