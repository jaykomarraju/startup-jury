import { SELF, env } from "cloudflare:test";
import { Hono } from "hono";
import { describe, it, expect, beforeEach } from "vitest";
import { requireAuth } from "../../src/server/auth/middleware";
import type { AppEnv } from "../../src/server/types";
import { DEFAULT_TENANT_ID } from "../../src/shared/tenant";

/**
 * `L1-SESSION` — the backdoor `requireAuth` left open for seven days.
 *
 * Until this change the middleware resolved the whole principal from the KV
 * session value and never read D1 (`auth/middleware.ts:15-22`), the session TTL
 * is seven days (`auth/session.ts`), and the only `deleteSession` calls pass the
 * caller's OWN cookie. Three escapes were measured on local wrangler dev, and
 * all three are reproduced below:
 *
 *   1. a DEACTIVATED user kept full access, although `POST /api/auth/login` had
 *      been refusing them the whole time;
 *   2. a program manager DEMOTED to jury kept `assign` authority, because
 *      `requireTask` tests `user.role` and `user` was the login snapshot;
 *   3. a SOFT-DELETED admin used their live session to call `POST /api/users`
 *      and create a new admin, HTTP 200.
 *
 * Nothing covered any of it: `users.test.ts:291` only ever asserted that a fresh
 * *login* is refused, which is a different statement about a different code path.
 *
 * ── TWO THINGS ABOUT THIS POOL, BOTH MEASURED HERE ──────────────────────────
 *
 * · Storage is NOT rolled back between `it`s in one file — an `ALTER TABLE` in
 *   one test was still visible in the next. So every fixture is built in
 *   `beforeEach` with a unique address, never in a `beforeAll` (which the repo
 *   has been bitten by before) and never shared across tests.
 * · `approval_state` is added by `migrations/0106`, which belongs to the
 *   registration lane and is not in this worktree. The LAST describe adds the
 *   column itself, tolerating the duplicate once `0106` lands, so it asserts the
 *   real gate in both worlds. Everything ABOVE that describe therefore runs
 *   against a database with NO `approval_state` column, which is what proves the
 *   pre-`0106` fallback in `loadPrincipal` keeps the product working. Order
 *   matters for that reason, and only that reason.
 */

const BASE = "https://example.com";

const INC_ADMIN = "nisha.kapoor@demo.startupjury.ai"; // incubator admin
const INC_SUPER = "priya.sharma@demo.startupjury.ai"; // incubator superuser

async function login(email: string, password = "demo1234"): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

function req(method: string, path: string, cookie: string, body?: unknown) {
  return SELF.fetch(`${BASE}${path}`, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const get = (path: string, cookie: string) =>
  SELF.fetch(`${BASE}${path}`, { headers: { cookie } });

interface Victim {
  id: string;
  email: string;
  /** The temporary credential the invite issued — kept so the password-change
   *  route can be driven, since nothing can read a hash back. */
  password: string;
  cookie: string;
}

/**
 * A real staff account with a real live session, created through the real route.
 *
 * `POST /api/users` hands back the temporary password only when the invite could
 * not be delivered, and in this pool `EMAIL_FROM` is unset so it never is — the
 * same thing `users.test.ts` relies on. Addresses are unique per call because
 * storage accumulates across tests in this file.
 */
async function recruit(adminCookie: string, role: string, label: string): Promise<Victim> {
  const email = `${label}.${crypto.randomUUID().slice(0, 8)}@newteam.io`;
  const res = await req("POST", "/api/users", adminCookie, {
    name: `Session Probe ${label}`,
    email,
    role,
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { tempPassword?: string; user: { id: string } };
  expect(typeof body.tempPassword).toBe("string");
  const cookie = await login(email, body.tempPassword!);
  expect(cookie).toMatch(/^sj_session=/);
  return { id: body.user.id, email, password: body.tempPassword!, cookie };
}

describe("requireAuth — the negative control", () => {
  it("a normal active user's session keeps working", async () => {
    const admin = await login(INC_ADMIN);
    // Three different gate shapes, so the added row read cannot have broken one
    // while leaving the others alone: requireAuth alone, requireTask, and a
    // route under /api/decks/* — the one prefix where index.ts:80 and index.ts:87
    // both register requireAuth, so it runs twice in a single request.
    expect((await get("/api/auth/me", admin)).status).toBe(200);
    expect((await get("/api/users", admin)).status).toBe(200);
    expect((await get("/api/jury", admin)).status).toBe(200);
    expect((await get("/api/decks", admin)).status).toBe(200);
  });

  it("a brand-new invitee can use the session their temporary password opened", async () => {
    const victim = await recruit(await login(INC_ADMIN), "program_manager", "control");
    expect((await get("/api/auth/me", victim.cookie)).status).toBe(200);
    expect((await get("/api/jury", victim.cookie)).status).toBe(200);
  });

  it("no cookie is still 401, and a forged one too", async () => {
    expect((await get("/api/auth/me", "")).status).toBe(401);
    expect((await get("/api/auth/me", "sj_session=not-a-real-token")).status).toBe(401);
  });
});

describe("requireAuth — deactivated mid-session (escape 1)", () => {
  let admin = "";
  let victim: Victim;

  beforeEach(async () => {
    admin = await login(INC_ADMIN);
    victim = await recruit(admin, "program_associate", "deactivated");
  });

  it("the live session stops working the moment the account is switched off", async () => {
    expect((await get("/api/auth/me", victim.cookie)).status).toBe(200);

    // Through the real route an administrator actually uses, not a direct UPDATE:
    // the point is that the ordinary console action now revokes, with nobody
    // having to remember to delete a session.
    const off = await req("PATCH", `/api/users/${victim.id}`, admin, { active: false });
    expect(off.status).toBe(200);

    expect((await get("/api/auth/me", victim.cookie)).status).toBe(401);
    expect((await get("/api/jury", victim.cookie)).status).toBe(401);
  });

  it("reactivating lets the SAME session back in — the row is the only authority", async () => {
    expect((await req("PATCH", `/api/users/${victim.id}`, admin, { active: false })).status).toBe(200);
    expect((await get("/api/auth/me", victim.cookie)).status).toBe(401);
    expect((await req("PATCH", `/api/users/${victim.id}`, admin, { active: true })).status).toBe(200);
    // Not a convenience: it is the proof that the 401 came from the row and not
    // from the cookie or the KV value having been destroyed behind our back.
    expect((await get("/api/auth/me", victim.cookie)).status).toBe(200);
  });
});

describe("requireAuth — demoted mid-session (escape 2)", () => {
  let admin = "";
  let victim: Victim;

  beforeEach(async () => {
    admin = await login(INC_ADMIN);
    victim = await recruit(admin, "program_manager", "demoted");
  });

  it("a program manager demoted to jury loses `assign` on the next request", async () => {
    // GET /jury is requireTask("assign", "program_associate", "program_manager",
    // "admin") (pipeline.ts:1467) — the authority the measured escape kept.
    expect((await get("/api/jury", victim.cookie)).status).toBe(200);

    const down = await req("PATCH", `/api/users/${victim.id}`, admin, { role: "jury" });
    expect(down.status).toBe(200);

    // 403, not 401: they are still a real, active, approved user. Only the
    // authority went, which is the whole point of refreshing `role` rather than
    // tearing the session down.
    expect((await get("/api/jury", victim.cookie)).status).toBe(403);
    expect((await get("/api/auth/me", victim.cookie)).status).toBe(200);
  });

  it("a promotion also lands at once, so the refresh is not one-directional", async () => {
    const jury = await recruit(admin, "jury", "promoted");
    expect((await get("/api/jury", jury.cookie)).status).toBe(403);
    expect(
      (await req("PATCH", `/api/users/${jury.id}`, admin, { role: "program_manager" })).status,
    ).toBe(200);
    expect((await get("/api/jury", jury.cookie)).status).toBe(200);
  });

  it("the refreshed role reaches the permission resolver, not only requireRole", async () => {
    // `createPermissionContext` closes over `user.role` (permissions.ts:116), so a
    // refresh that set `c.var.user` from the row but built `perms` from the KV
    // snapshot would leave the task grid answering for the OLD role — half the
    // hole, silently reinstated.
    //
    // This isolates that half. `GET /jury` admits program_manager AND
    // program_associate by role list, so closing `assign` for program_associate
    // only, and then moving the victim between those two roles, can change the
    // answer by way of the GRID and nothing else.
    expect((await get("/api/jury", victim.cookie)).status).toBe(200);

    const closed = await req("PUT", "/api/permissions", admin, {
      cells: [{ role: "program_associate", taskId: "assign", granted: false }],
    });
    expect(closed.status).toBe(200);
    // Control: the cell that closed is not theirs yet.
    expect((await get("/api/jury", victim.cookie)).status).toBe(200);

    const sideways = await req("PATCH", `/api/users/${victim.id}`, admin, {
      role: "program_associate",
    });
    expect(sideways.status).toBe(200);
    expect((await get("/api/jury", victim.cookie)).status).toBe(403);
  });
});

describe("requireAuth — soft-deleted mid-session (escape 3)", () => {
  it("a removed admin cannot mint a new admin with their live session", async () => {
    const superuser = await login(INC_SUPER);
    const victim = await recruit(superuser, "admin", "removed");

    // The exact shape of the measured defect, asserted in the working direction
    // first so the 401 below cannot be a route that never worked.
    expect((await get("/api/users", victim.cookie)).status).toBe(200);

    const removed = await req("DELETE", `/api/users/${victim.id}`, superuser);
    expect(removed.status).toBe(200);

    // The soft delete keeps the row and stamps deleted_at / active = 0 / renames
    // the email (users.ts:616), so a lookup BY ID still finds it — which is why
    // `requireAuth` has to test `deleted_at` itself rather than leaning on a
    // `deleted_at IS NULL` predicate that would make a removed admin
    // indistinguishable from a cross-tenant id.
    const backdoor = await req("POST", "/api/users", victim.cookie, {
      name: "Backdoor",
      email: `backdoor.${crypto.randomUUID().slice(0, 8)}@newteam.io`,
      role: "admin",
    });
    expect(backdoor.status).toBe(401);
    expect((await get("/api/users", victim.cookie)).status).toBe(401);

    // And nothing was created. Read the roster as somebody who is still allowed
    // to, rather than trusting the 401 alone.
    const roster = (await (await get("/api/users", superuser)).json()) as {
      users: { name: string }[];
    };
    expect(roster.users.some((u) => u.name === "Backdoor")).toBe(false);
  });
});

describe("requireAuth — mustChangePassword on the context", () => {
  // Mounted here rather than asserted through `/api/auth/me`, because the route
  // that will surface it belongs to another lane in this wave. This pins the
  // contract that lane consumes: the flag is on the context for every
  // authenticated request, at no extra query — `auth.ts:223-226` already reads
  // this row, and now so does the middleware.
  const probe = new Hono<AppEnv>();
  probe.get("/flag", requireAuth, (c) => c.json({ mustChangePassword: c.var.mustChangePassword }));

  async function flag(cookie: string): Promise<boolean> {
    const res = await probe.request("/flag", { headers: { Cookie: cookie } }, env);
    expect(res.status).toBe(200);
    return ((await res.json()) as { mustChangePassword: boolean }).mustChangePassword;
  }

  it("true for a temporary credential, false once it has been replaced", async () => {
    const admin = await login(INC_ADMIN);
    // `POST /api/users` issues the credential with must_change_password = 1.
    const victim = await recruit(admin, "jury", "mustchange");
    expect(await flag(victim.cookie)).toBe(true);

    // `PUT /api/users/me/password` clears it (users.ts:540) — the route that has
    // had no callers since it shipped. Driven through the API so the flag is
    // moved by the product and not by the test.
    const changed = await req("PUT", "/api/users/me/password", victim.cookie, {
      currentPassword: victim.password,
      newPassword: "a-real-password-9",
    });
    expect(changed.status).toBe(200);
    expect(await flag(victim.cookie)).toBe(false);
  });

  it("false for a seeded account that never owed one", async () => {
    expect(await flag(await login(INC_ADMIN))).toBe(false);
  });
});

describe("requireAuth — double-mounted, one answer", () => {
  // `/api/decks/*` really does carry this middleware twice (index.ts:80 and :87).
  // Before the row read a second run cost one KV read nobody noticed; now it
  // would cost a second D1 read for an answer already in hand, so `requireAuth`
  // returns early when `c.var.user` is set. This pins that the early return did
  // not break the chain, and that the second run does not resurrect a principal
  // the first run refused.
  const probe = new Hono<AppEnv>();
  probe.get("/twice", requireAuth, requireAuth, (c) => c.json({ role: c.var.user.role }));

  it("passes a live session through both and reports the refreshed role", async () => {
    const admin = await login(INC_ADMIN);
    const victim = await recruit(admin, "program_manager", "twice");
    expect((await req("PATCH", `/api/users/${victim.id}`, admin, { role: "jury" })).status).toBe(200);

    const res = await probe.request("/twice", { headers: { Cookie: victim.cookie } }, env);
    expect(res.status).toBe(200);
    expect((await res.json()) as { role: string }).toEqual({ role: "jury" });
  });

  it("refuses a removed session at the first run and never reaches the second", async () => {
    const superuser = await login(INC_SUPER);
    const victim = await recruit(superuser, "program_manager", "twice-gone");
    expect((await req("DELETE", `/api/users/${victim.id}`, superuser)).status).toBe(200);
    const res = await probe.request("/twice", { headers: { Cookie: victim.cookie } }, env);
    expect(res.status).toBe(401);
  });
});

describe("requireAuth — approval_state (migrations/0106)", () => {
  /**
   * The column this gate reads belongs to the registration lane's `0106` and is
   * not in this worktree, so the fixture adds it. Deliberately WITHOUT `0106`'s
   * `CHECK` constraint: the gate's job is to read the VALUE, the constraint is the
   * migration's job, and restating it here would only be a second place for the
   * two to disagree. Once `0106` is applied this `ALTER` fails with
   * `duplicate column name: approval_state` — measured in this pool — and the
   * real column, CHECK and all, is what the tests then run against.
   */
  beforeEach(async () => {
    try {
      await env.DB.exec(
        "ALTER TABLE users ADD COLUMN approval_state TEXT NOT NULL DEFAULT 'approved'",
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("duplicate column name: approval_state")) throw err;
    }
  });

  async function setApprovalState(id: string, state: string): Promise<void> {
    // Scoped by tenant as well as id, which costs nothing and is the shape every
    // write to `users` takes in this codebase after `0087`.
    const res = await env.DB.prepare(
      "UPDATE users SET approval_state = ? WHERE id = ? AND tenant_id = ?",
    )
      .bind(state, id, DEFAULT_TENANT_ID)
      .run();
    expect(res.meta.changes).toBe(1);
  }

  it("'approved' is let through — the default every existing account carries", async () => {
    const victim = await recruit(await login(INC_ADMIN), "jury", "approved");
    const row = await env.DB.prepare("SELECT approval_state FROM users WHERE id = ?")
      .bind(victim.id)
      .first<{ approval_state: string }>();
    expect(row?.approval_state).toBe("approved");
    expect((await get("/api/auth/me", victim.cookie)).status).toBe(200);
  });

  it("'pending' is refused even though a session exists", async () => {
    // A registrant should never have been able to open a session at all — login
    // refuses them with 403 pending_approval — so this is the backstop for the one
    // that was minted before the state changed, or by a route that forgot. It is
    // the same argument as reading the row in the first place.
    const victim = await recruit(await login(INC_ADMIN), "jury", "pending");
    expect((await get("/api/auth/me", victim.cookie)).status).toBe(200);
    await setApprovalState(victim.id, "pending");
    expect((await get("/api/auth/me", victim.cookie)).status).toBe(401);
  });

  it("'declined' is refused too", async () => {
    const victim = await recruit(await login(INC_ADMIN), "jury", "declined");
    await setApprovalState(victim.id, "declined");
    expect((await get("/api/auth/me", victim.cookie)).status).toBe(401);
  });

  it("approving a pending registrant lets their existing session straight in", async () => {
    const victim = await recruit(await login(INC_ADMIN), "jury", "approving");
    await setApprovalState(victim.id, "pending");
    expect((await get("/api/auth/me", victim.cookie)).status).toBe(401);
    await setApprovalState(victim.id, "approved");
    expect((await get("/api/auth/me", victim.cookie)).status).toBe(200);
  });
});
