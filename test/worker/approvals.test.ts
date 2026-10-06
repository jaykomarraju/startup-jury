/**
 * L4, GCW pilot wave — the approval queue, out of office with delegation, and the
 * account surface's own read.
 *
 * Three things are pinned here, and each one is pinned because getting it wrong
 * costs the live call on which GCW's administrator configures their workspace:
 *
 *   1. **The queue decides, in the right workspace.** `?approval=pending`,
 *      `POST /:id/approve` and `POST /:id/decline` are tenant-scoped, and an
 *      applicant belonging to another customer is a 404 to this one — "an approval
 *      that matched another customer's row would be the worst bug in this wave".
 *      The negative control is a registrant in a second tenant that this tenant's
 *      administrator must neither see nor be able to decide.
 *   2. **Who may cover for whom.** The delegate is validated by SELECT, not by
 *      trust: another edition, another tenant, a mentor, a deactivated member, a
 *      pending applicant and yourself are each refused, each for its own reason.
 *   3. **What "pending" means.** The coverage list drops a deck the absentee has
 *      already evaluated AND one the DELEGATE has already evaluated — the second
 *      is the one that is easy to get wrong, because the evaluation is stored
 *      against whoever submitted it, so testing only the absentee's id would leave
 *      every covered deck on the delegate's list forever.
 *
 * ── `approval_state` IS LANE L2's COLUMN ────────────────────────────────────
 *
 * `migrations/0106` belongs to the registration lane. This file needs the column
 * to assert anything at all, so it adds it ITSELF when it is absent — see the
 * bridge below, which is a no-op once L2 has landed. The bridge was measured both
 * ways: with `0106` present (inert) and with it absent (it fires and this file is
 * green either way).
 *
 * NB worker-test storage is isolated per FILE and shared across the `it`s in it,
 * so every test below uses its own ids and addresses.
 */
import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { hashPassword } from "../../src/server/auth/password";
import { MAX_OOO_DAYS } from "../../src/shared/outOfOffice";

const BASE = "https://example.com";

const INC_ADMIN = "nisha.kapoor@demo.startupjury.ai"; // incubator admin
const INC_SUPER = "priya.sharma@demo.startupjury.ai"; // incubator superuser
const INC_JURY = "rajesh.kumar@demo.startupjury.ai"; // jury (non-admin)
const INC_PM = "raj.kumar@demo.startupjury.ai"; // program_manager
const VC_ADMIN = "nisha.kapoor.vc@demo.startupjury.ai"; // vc admin — same tenant, other edition

/**
 * **THE BRIDGE TO LANE L2, AND WHY IT GUARDS ITSELF.**
 *
 * `users.approval_state` is specified by the wave brief and created by L2's
 * `migrations/0106`. In an isolated worktree that migration does not exist, so
 * this adds the column with the brief's exact shape — and checks first, so that
 * after integration the real migration owns it and this does nothing.
 *
 * It runs at module scope rather than in a `beforeAll` inside a `describe`,
 * because isolated storage rolls THOSE back: a `describe`-scoped write is undone
 * before the first `it` runs, and the only symptom is a 401 or a missing column
 * much later. `test/worker/apply-migrations.ts` writes at module scope for the
 * same reason.
 */
const approvalColumn = await env.DB.prepare(
  "SELECT count(*) AS n FROM pragma_table_info('users') WHERE name = 'approval_state'",
).first<{ n: number }>();
if ((approvalColumn?.n ?? 0) === 0) {
  await env.DB.exec(
    "ALTER TABLE users ADD COLUMN approval_state TEXT NOT NULL DEFAULT 'approved' CHECK (approval_state IN ('pending', 'approved', 'declined'))",
  );
}

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

interface RosterRow {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  approvalState?: string;
  invitePending?: boolean;
  inviteSentAt?: string;
  selfRegistered?: boolean;
  mustChangePassword?: boolean;
  outOfOffice?: { from: string; to: string; delegateId: string | null; active: boolean } | null;
}

async function roster(cookie: string, query = ""): Promise<RosterRow[]> {
  const res = await get(`/api/users${query}`, cookie);
  expect(res.status, `GET /api/users${query}`).toBe(200);
  return ((await res.json()) as { users: RosterRow[] }).users;
}

interface MyAccount {
  mustChangePassword: boolean;
  minPasswordLength: number;
  maxOutOfOfficeDays: number;
  outOfOffice: { from: string; to: string; delegateId: string | null; active: boolean } | null;
  delegates: { id: string; name: string; roleLabel: string }[];
  coveringFor: {
    userId: string;
    name: string;
    until: string;
    assignments: { deckId: string; deckName: string; dueAt: string | null }[];
  }[];
}

async function myAccount(cookie: string): Promise<MyAccount> {
  const res = await get("/api/users/me/account", cookie);
  expect(res.status, "GET /api/users/me/account").toBe(200);
  return (await res.json()) as MyAccount;
}

/**
 * A self-registration, written the way lane L2's `POST /api/auth/register` writes
 * one: `active = 0`, `approval_state = 'pending'`, `role = 'jury'`, no invite
 * (`invite_sent_at` NULL) and a password the PERSON chose, which is why
 * `must_change_password` stays 0.
 *
 * Inserted directly because that route does not exist in this worktree. The shape
 * is the brief's, so what is asserted below is what L2 will produce.
 */
async function registrant(args: {
  id: string;
  name: string;
  email: string;
  password: string;
  tenantId?: string;
  edition?: string;
}): Promise<string> {
  await env.DB.prepare(
    "INSERT INTO users (id, tenant_id, edition, name, email, password_hash, role, initials, " +
      "active, user_type, approval_state) VALUES (?, ?, ?, ?, ?, ?, 'jury', 'ZZ', 0, 'staff', 'pending')",
  )
    .bind(
      args.id,
      args.tenantId ?? "t_default",
      args.edition ?? "incubator",
      args.name,
      args.email,
      await hashPassword(args.password),
    )
    .run();
  return args.id;
}

/** Audit rows written against one user, newest first. */
async function auditFor(targetId: string): Promise<{ action: string; summary: string; category: string }[]> {
  return (
    await env.DB.prepare(
      "SELECT action, summary, category FROM audit_log WHERE target_id = ? ORDER BY created_at DESC",
    )
      .bind(targetId)
      .all<{ action: string; summary: string; category: string }>()
  ).results;
}

/** Today / today ± n, in the `YYYY-MM-DD` the API takes. */
function day(offset: number): string {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
}

// ── 1. The queue ─────────────────────────────────────────────────────────────

describe("the approval queue — reads", () => {
  it("lists a pending registration, and keeps it OUT of the roster", async () => {
    const admin = await login(INC_ADMIN);
    const id = await registrant({
      id: "zz_reg_list",
      name: "Asha Verma",
      email: "asha.verma@globalcarbonwarriors.com",
      password: "her-own-password",
    });

    const queue = await roster(admin, "?approval=pending");
    const mine = queue.find((u) => u.id === id);
    expect(mine, "the registration is not in the pending queue").toBeTruthy();
    expect(mine!.email).toBe("asha.verma@globalcarbonwarriors.com");
    expect(mine!.name).toBe("Asha Verma");
    expect(mine!.approvalState).toBe("pending");
    expect(mine!.active).toBe(false);
    // No invite was ever sent, which is what tells a self-registrant from an
    // invitee on every screen that renders a roster row.
    expect(mine!.inviteSentAt).toBeUndefined();

    // And the roster — Active members, User access, the seat screens — does not
    // contain them. An applicant with a Resend button beside their name would
    // overwrite the password they chose at registration.
    const members = await roster(admin);
    expect(members.map((u) => u.id)).not.toContain(id);
  });

  it("is refused to a non-admin and to an anonymous caller", async () => {
    expect((await get("/api/users?approval=pending", await login(INC_JURY))).status).toBe(403);
    expect((await SELF.fetch(`${BASE}/api/users?approval=pending`)).status).toBe(401);
  });

  it("refuses an approval state it does not recognise rather than returning everybody", async () => {
    const admin = await login(INC_ADMIN);
    const res = await get("/api/users?approval=everyone", admin);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_approval_state");
  });
});

describe("the approval queue — approve", () => {
  it("admits the registrant with the role the ADMINISTRATOR chose, and they can then sign in", async () => {
    const admin = await login(INC_ADMIN);
    const password = "chosen-at-registration";
    const id = await registrant({
      id: "zz_reg_approve",
      name: "Dev Patel",
      email: "dev.patel@globalcarbonwarriors.com",
      password,
    });

    // The registrant cannot sign in while they wait: `active = 0`.
    expect(await login("dev.patel@globalcarbonwarriors.com", password)).toBe("");

    const res = await req("POST", `/api/users/${id}/approve`, admin, {
      role: "program_manager",
      title: "Head of Climate",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: RosterRow & { title?: string } };
    expect(body.user.role).toBe("program_manager");
    expect(body.user.active).toBe(true);
    expect(body.user.approvalState).toBe("approved");
    expect(body.user.title).toBe("Head of Climate");

    // The row moved from the queue to the roster, in both directions.
    expect((await roster(admin, "?approval=pending")).map((u) => u.id)).not.toContain(id);
    expect((await roster(admin)).map((u) => u.id)).toContain(id);

    // The whole point: the password they chose still works, and nothing marked it
    // temporary — `must_change_password` is for credentials the SYSTEM issued.
    const cookie = await login("dev.patel@globalcarbonwarriors.com", password);
    expect(cookie).not.toBe("");
    expect((await get("/api/auth/me", cookie)).status).toBe(200);
    expect((await myAccount(cookie)).mustChangePassword).toBe(false);

    const trail = await auditFor(id);
    expect(trail.map((r) => r.action)).toContain("registration_approved");
    const row = trail.find((r) => r.action === "registration_approved")!;
    expect(row.category).toBe("security");
    expect(row.summary).toContain("Program Manager");
  });

  it("marks the admitted person `selfRegistered`, and REFUSES a resend that would take their password away", async () => {
    const admin = await login(INC_ADMIN);
    const password = "the-one-i-chose";
    const id = await registrant({
      id: "zz_reg_noresend",
      name: "Self Signup",
      email: "self.signup@globalcarbonwarriors.com",
      password,
    });
    expect((await req("POST", `/api/users/${id}/approve`, admin, { role: "jury" })).status).toBe(200);

    // They have never signed in, so `invitePending` is true of them — and means
    // something completely different from an invitee waiting on a credential.
    const row = (await roster(admin)).find((u) => u.id === id)!;
    expect(row.invitePending).toBe(true);
    expect(row.selfRegistered).toBe(true);
    expect(row.inviteSentAt).toBeUndefined();

    // The screen hides Resend for that row; this is the enforcement, because a
    // client-side-only gate is this repo's recurring bug class. A resend would
    // issue a temporary password OVER the one they chose and lock them out.
    const res = await req("POST", `/api/users/${id}/resend-invite`, admin);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("no_invite_to_resend");
    expect(await login("self.signup@globalcarbonwarriors.com", password)).not.toBe("");

    // An INVITED member is unaffected: their resend still works, which is what
    // makes the refusal above a distinction rather than a regression.
    const invited = (await (
      await req("POST", "/api/users", admin, {
        name: "Invited Member",
        email: "invited.l4@globalcarbonwarriors.com",
        role: "jury",
      })
    ).json()) as { user: { id: string } };
    expect((await roster(admin)).find((u) => u.id === invited.user.id)!.selfRegistered).toBe(false);
    expect((await req("POST", `/api/users/${invited.user.id}/resend-invite`, admin)).status).toBe(200);
  });

  it("refuses a role it may not grant, and leaves the registration pending", async () => {
    const admin = await login(INC_ADMIN);
    const id = await registrant({
      id: "zz_reg_badrole",
      name: "Nina Rao",
      email: "nina.rao@globalcarbonwarriors.com",
      password: "her-own-password",
    });

    for (const role of ["superuser", "founder", "mentor", "", "wizard"]) {
      const res = await req("POST", `/api/users/${id}/approve`, admin, { role });
      expect(res.status, `role=${role}`).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe("invalid_role");
    }

    const stillWaiting = await roster(admin, "?approval=pending");
    expect(stillWaiting.find((u) => u.id === id)?.approvalState).toBe("pending");
  });

  it("refuses a second decision on the same row (409), rather than re-roling a serving colleague", async () => {
    const admin = await login(INC_ADMIN);
    const id = await registrant({
      id: "zz_reg_twice",
      name: "Omar Shah",
      email: "omar.shah@globalcarbonwarriors.com",
      password: "her-own-password",
    });
    expect((await req("POST", `/api/users/${id}/approve`, admin, { role: "jury" })).status).toBe(200);

    const again = await req("POST", `/api/users/${id}/approve`, admin, { role: "admin" });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: string }).error).toBe("not_pending");
    // And `decline` cannot undo an approval either — that is `PATCH`/`DELETE`'s job.
    expect((await req("POST", `/api/users/${id}/decline`, admin)).status).toBe(409);

    // The role from the FIRST decision stands.
    expect((await roster(admin)).find((u) => u.id === id)?.role).toBe("jury");
  });
});

describe("the approval queue — decline", () => {
  it("keeps the row, marks it declined, and keeps it out of the roster", async () => {
    const admin = await login(INC_ADMIN);
    const id = await registrant({
      id: "zz_reg_decline",
      name: "Imposter Person",
      email: "imposter@globalcarbonwarriors.com",
      password: "their-own-password",
    });

    const res = await req("POST", `/api/users/${id}/decline`, admin);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { user: RosterRow }).user.approvalState).toBe("declined");

    expect((await roster(admin)).map((u) => u.id)).not.toContain(id);
    expect((await roster(admin, "?approval=pending")).map((u) => u.id)).not.toContain(id);
    // "Left for the record" has to mean readable, or it means deleted.
    expect((await roster(admin, "?approval=declined")).map((u) => u.id)).toContain(id);

    // Declined and inactive, so `POST /api/auth/login` refuses them today without
    // needing to know this column exists.
    const row = await env.DB.prepare("SELECT active, approval_state FROM users WHERE id = ?")
      .bind(id)
      .first<{ active: number; approval_state: string }>();
    expect(row).toEqual({ active: 0, approval_state: "declined" });
    expect(await login("imposter@globalcarbonwarriors.com", "their-own-password")).toBe("");

    const trail = await auditFor(id);
    expect(trail.map((r) => r.action)).toContain("registration_declined");
  });
});

describe("the approval queue — the workspace boundary", () => {
  it("another customer's registration is invisible and undecidable (404), and is left untouched", async () => {
    // A second customer. `users.tenant_id` carries no declarable foreign key
    // (`0087`'s header says why), but the organisation row is written anyway so
    // this fixture is the shape the integrity assertions expect.
    await env.DB.prepare(
      "INSERT OR IGNORE INTO organizations (id, name, slug, status) VALUES ('t_zz4', 'ZZ Ventures', 'zz-ventures-l4', 'active')",
    ).run();
    const id = await registrant({
      id: "zz_reg_othertenant",
      name: "Other Customer Applicant",
      email: "applicant@zzventures.test",
      password: "their-own-password",
      tenantId: "t_zz4",
    });

    const admin = await login(INC_ADMIN);
    expect((await roster(admin, "?approval=pending")).map((u) => u.id)).not.toContain(id);

    for (const verb of ["approve", "decline"]) {
      const res = await req("POST", `/api/users/${id}/${verb}`, admin, { role: "jury" });
      expect(res.status, verb).toBe(404);
      expect(((await res.json()) as { error: string }).error).toBe("not_found");
    }

    // Not merely refused — unchanged. A 404 that had already written the row would
    // be the same bug with a tidier response.
    const row = await env.DB.prepare(
      "SELECT active, approval_state, role FROM users WHERE id = ?",
    )
      .bind(id)
      .first<{ active: number; approval_state: string; role: string }>();
    expect(row).toEqual({ active: 0, approval_state: "pending", role: "jury" });
  });

  it("the other EDITION of the same customer is a different workspace too", async () => {
    const id = await registrant({
      id: "zz_reg_vcside",
      name: "VC Side Applicant",
      email: "applicant.vc@globalcarbonwarriors.com",
      password: "their-own-password",
      edition: "vc",
    });
    const incAdmin = await login(INC_ADMIN);
    expect((await roster(incAdmin, "?approval=pending")).map((u) => u.id)).not.toContain(id);
    expect((await req("POST", `/api/users/${id}/approve`, incAdmin, { role: "jury" })).status).toBe(404);

    // And the VC administrator, whose workspace it is, can see and decide it.
    const vcAdmin = await login(VC_ADMIN);
    expect((await roster(vcAdmin, "?approval=pending")).map((u) => u.id)).toContain(id);
    expect((await req("POST", `/api/users/${id}/approve`, vcAdmin, { role: "analyst" })).status).toBe(200);
  });
});

// ── 2. My account ────────────────────────────────────────────────────────────

describe("GET /api/users/me/account", () => {
  it("is open to a non-admin and refused to nobody-at-all", async () => {
    expect((await SELF.fetch(`${BASE}/api/users/me/account`)).status).toBe(401);
    // A jury member cannot read the roster (403) and must still reach their own
    // credential state and their own absence.
    const jury = await login(INC_JURY);
    expect((await get("/api/users", jury)).status).toBe(403);
    expect((await get("/api/users/me/account", jury)).status).toBe(200);
  });

  it("serves the two shared constants rather than letting the client restate them", async () => {
    const account = await myAccount(await login(INC_JURY));
    // `MIN_PASSWORD` in `routes/users.ts` — the one place the number 8 lives.
    expect(account.minPasswordLength).toBe(8);
    expect(account.maxOutOfOfficeDays).toBe(MAX_OOO_DAYS);
  });

  it("offers as delegates only active, approved, non-mentor members of this workspace", async () => {
    const admin = await login(INC_ADMIN);
    const me = await login(INC_PM);

    // A mentor, a pending applicant and a deactivated member, all in this
    // workspace, none of them eligible to hold somebody's evaluations.
    const mentor = (await (
      await req("POST", "/api/users", admin, {
        name: "Advisor Person",
        email: "advisor.l4@advisors.test",
        userType: "mentor",
      })
    ).json()) as { user: { id: string } };
    const parked = (await (
      await req("POST", "/api/users", admin, {
        name: "Parked Person",
        email: "parked.l4@globalcarbonwarriors.com",
        role: "jury",
      })
    ).json()) as { user: { id: string } };
    expect((await req("PATCH", `/api/users/${parked.user.id}`, admin, { active: false })).status).toBe(200);
    const waiting = await registrant({
      id: "zz_reg_notadelegate",
      name: "Waiting Person",
      email: "waiting.l4@globalcarbonwarriors.com",
      password: "their-own-password",
    });

    const ids = (await myAccount(me)).delegates.map((d) => d.id);
    expect(ids, "a mentor cannot hold evaluations — /api/decks is 403 for them").not.toContain(
      mentor.user.id,
    );
    expect(ids, "a deactivated member cannot cover").not.toContain(parked.user.id);
    expect(ids, "an applicant is not a colleague yet").not.toContain(waiting);
    expect(ids, "you cannot delegate to yourself").not.toContain("inc_pm");
    expect(ids, "the founder is an external actor").not.toContain("inc_founder");
    // Somebody real is on the list, or the four refusals above prove nothing.
    expect(ids).toContain("inc_jury");
  });
});

// ── 3. Out of office ─────────────────────────────────────────────────────────

describe("out of office — the window", () => {
  it("is set, read back with `active` resolved, shown on the roster row, and cleared", async () => {
    const admin = await login(INC_ADMIN);
    const jury = await login(INC_JURY);

    const set = await req("PUT", "/api/users/me/out-of-office", jury, {
      from: day(-1),
      to: day(5),
      delegateId: "inc_pm",
    });
    expect(set.status).toBe(200);
    expect(((await set.json()) as { outOfOffice: { active: boolean } }).outOfOffice.active).toBe(true);

    const mine = await myAccount(jury);
    expect(mine.outOfOffice).toEqual({
      from: day(-1),
      to: day(5),
      delegateId: "inc_pm",
      active: true,
    });

    // Team & roles draws "out until …" straight off the roster row.
    const row = (await roster(admin)).find((u) => u.id === "inc_jury")!;
    expect(row.outOfOffice?.active).toBe(true);
    expect(row.outOfOffice?.delegateId).toBe("inc_pm");

    expect((await req("DELETE", "/api/users/me/out-of-office", jury)).status).toBe(200);
    expect((await myAccount(jury)).outOfOffice).toBeNull();
    expect((await roster(admin)).find((u) => u.id === "inc_jury")?.outOfOffice ?? null).toBeNull();
  });

  it("a window that has not started yet is stored but is not active", async () => {
    const pm = await login(INC_PM);
    await req("PUT", "/api/users/me/out-of-office", pm, {
      from: day(20),
      to: day(25),
      delegateId: "inc_jury",
    });
    const mine = await myAccount(pm);
    expect(mine.outOfOffice?.active).toBe(false);
    // And nobody is covering yet — a window set for next month must not hand work
    // over today.
    expect((await myAccount(await login(INC_JURY))).coveringFor).toEqual([]);
    await req("DELETE", "/api/users/me/out-of-office", pm);
  });

  it("refuses a backwards window, an impossible date and an absurd span", async () => {
    const jury = await login(INC_JURY);
    const cases: [unknown, unknown, string][] = [
      [day(5), day(1), "window_backwards"],
      ["2026-02-30", "2026-03-02", "invalid_date"],
      ["not-a-date", day(1), "invalid_date"],
      [day(0), undefined, "invalid_date"],
      // The typo the bound exists for: 2226 instead of 2026.
      [day(0), "2226-10-12", "window_too_long"],
    ];
    for (const [from, to, want] of cases) {
      const res = await req("PUT", "/api/users/me/out-of-office", jury, { from, to });
      expect(res.status, `${String(from)} → ${String(to)}`).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe(want);
    }
    expect((await myAccount(jury)).outOfOffice).toBeNull();
  });
});

describe("out of office — who may be a delegate", () => {
  it("refuses yourself, another edition, another customer, a mentor and a deactivated member", async () => {
    const admin = await login(INC_ADMIN);
    const jury = await login(INC_JURY);

    const mentor = (await (
      await req("POST", "/api/users", admin, {
        name: "Mentor Delegate",
        email: "mentor.delegate.l4@advisors.test",
        userType: "mentor",
      })
    ).json()) as { user: { id: string } };
    const gone = (await (
      await req("POST", "/api/users", admin, {
        name: "Leaver Person",
        email: "leaver.l4@globalcarbonwarriors.com",
        role: "jury",
      })
    ).json()) as { user: { id: string } };
    expect((await req("PATCH", `/api/users/${gone.user.id}`, admin, { active: false })).status).toBe(200);

    await env.DB.prepare(
      "INSERT OR IGNORE INTO organizations (id, name, slug, status) VALUES ('t_zz4b', 'ZZ Two', 'zz-two-l4', 'active')",
    ).run();
    await env.DB.prepare(
      "INSERT INTO users (id, tenant_id, edition, name, email, password_hash, role, initials, active) " +
        "VALUES ('zz_other_tenant_user', 't_zz4b', 'incubator', 'Other Customer Staff', 'staff@zztwo.test', NULL, 'program_manager', 'OS', 1)",
    ).run();

    for (const delegateId of [
      "inc_jury", // yourself
      "vc_partner", // same customer, other edition — a different workspace
      "zz_other_tenant_user", // another customer entirely
      mentor.user.id, // a directory record with no pipeline access
      gone.user.id, // deactivated
      "inc_founder", // external actor
      "no_such_user",
    ]) {
      const res = await req("PUT", "/api/users/me/out-of-office", jury, {
        from: day(0),
        to: day(3),
        delegateId,
      });
      expect(res.status, delegateId).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe("invalid_delegate");
    }

    // Nothing was written by any of the seven refusals.
    expect((await myAccount(jury)).outOfOffice).toBeNull();
  });

  it("the schema refuses self-delegation too, not only the route", async () => {
    // `0107`'s CHECK. Belt and braces on purpose: a future script or a direct SQL
    // fix-up that set this column would otherwise create a pair that appears twice
    // in the delegated-assignee UNION.
    await expect(
      env.DB.prepare("UPDATE users SET out_of_office_delegate = id WHERE id = 'inc_jury'").run(),
    ).rejects.toThrow();
  });
});

describe("out of office — what the delegate actually receives", () => {
  it("lists the absentee's PENDING decks only, and drops one either of them has evaluated", async () => {
    const away = await login(INC_JURY);

    // Three decks for the absent jury member: one outstanding, one they have
    // already evaluated, one the DELEGATE has already evaluated.
    const decks: [string, string][] = [
      ["zz_l4_open", "Still To Score"],
      ["zz_l4_done_by_away", "Scored By Them"],
      ["zz_l4_done_by_cover", "Scored By Cover"],
    ];
    for (const [id, name] of decks) {
      await env.DB.prepare(
        "INSERT INTO decks (id, tenant_id, edition, name, status, uploaded_by) " +
          "VALUES (?, 't_default', 'incubator', ?, 'jury_evaluation', 'inc_pa')",
      )
        .bind(id, name)
        .run();
      await env.DB.prepare(
        "INSERT INTO deck_assignments (deck_id, evaluator_id, assigned_by, assigned_at, due_at) " +
          "VALUES (?, 'inc_jury', 'inc_pa', '2026-10-01T09:00:00Z', ?)",
      )
        .bind(id, `${day(2)}T09:00:00Z`)
        .run();
    }
    await env.DB.prepare(
      "INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, verdict, submitted_at) " +
        "VALUES ('zz_l4_ev_away', 'zz_l4_done_by_away', 'inc_jury', 7.1, 'scored', '2026-10-02T09:00:00Z')",
    ).run();
    await env.DB.prepare(
      "INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, verdict, submitted_at) " +
        "VALUES ('zz_l4_ev_cover', 'zz_l4_done_by_cover', 'inc_pm', 7.4, 'scored', '2026-10-02T09:00:00Z')",
    ).run();

    expect(
      (
        await req("PUT", "/api/users/me/out-of-office", away, {
          from: day(0),
          to: day(4),
          delegateId: "inc_pm",
        })
      ).status,
    ).toBe(200);

    const cover = await myAccount(await login(INC_PM));
    expect(cover.coveringFor.length).toBe(1);
    const person = cover.coveringFor[0];
    expect(person.userId).toBe("inc_jury");
    expect(person.name).toBe("Rajesh Kumar");
    expect(person.until).toBe(day(4));

    const names = person.assignments.map((a) => a.deckName);
    expect(names).toContain("Still To Score");
    expect(names, "a deck the absentee already evaluated is not pending").not.toContain(
      "Scored By Them",
    );
    expect(
      names,
      "a deck the DELEGATE already evaluated is not pending either — the evaluation is stored against whoever submitted it",
    ).not.toContain("Scored By Cover");
    // The deadline the delegate is working to is the absentee's own.
    expect(person.assignments.find((a) => a.deckName === "Still To Score")!.dueAt).toBe(
      `${day(2)}T09:00:00Z`,
    );
  });

  it("nobody else sees the cover, and clearing the window ends it", async () => {
    const away = await login(INC_SUPER);
    await env.DB.prepare(
      "INSERT INTO decks (id, tenant_id, edition, name, status, uploaded_by) " +
        "VALUES ('zz_l4_super_deck', 't_default', 'incubator', 'Owner Deck', 'jury_evaluation', 'inc_pa')",
    ).run();
    await env.DB.prepare(
      "INSERT INTO deck_assignments (deck_id, evaluator_id, assigned_by, assigned_at) " +
        "VALUES ('zz_l4_super_deck', 'inc_superuser', 'inc_pa', '2026-10-01T09:00:00Z')",
    ).run();
    await req("PUT", "/api/users/me/out-of-office", away, {
      from: day(0),
      to: day(2),
      delegateId: "inc_jury",
    });

    const named = await myAccount(await login(INC_JURY));
    expect(named.coveringFor.map((p) => p.userId)).toContain("inc_superuser");
    // The programme associate was not named and must see nothing.
    const notNamed = await myAccount(await login("sunita.rao@demo.startupjury.ai"));
    expect(notNamed.coveringFor.map((p) => p.userId)).not.toContain("inc_superuser");

    await req("DELETE", "/api/users/me/out-of-office", away);
    const after = await myAccount(await login(INC_JURY));
    expect(after.coveringFor.map((p) => p.userId)).not.toContain("inc_superuser");
  });

  it("another customer's absence never reaches this customer's delegate", async () => {
    // The aggregate-shaped risk from the other side: an absentee in tenant B whose
    // delegate id happens to name a tenant A user. The read is scoped on the
    // ABSENTEE's row, so the pairing resolves to nothing.
    await env.DB.prepare(
      "INSERT OR IGNORE INTO organizations (id, name, slug, status) VALUES ('t_zz4c', 'ZZ Three', 'zz-three-l4', 'active')",
    ).run();
    await env.DB.prepare(
      "INSERT INTO users (id, tenant_id, edition, name, email, password_hash, role, initials, active, out_of_office_from, out_of_office_to, out_of_office_delegate) " +
        "VALUES ('zz_away_other_tenant', 't_zz4c', 'incubator', 'Other Away', 'away@zzthree.test', NULL, 'jury', 'OA', 1, ?, ?, 'inc_pm')",
    )
      .bind(day(-1), day(3))
      .run();
    await env.DB.prepare(
      "INSERT INTO decks (id, tenant_id, edition, name, status, uploaded_by) " +
        "VALUES ('zz_l4_other_deck', 't_zz4c', 'incubator', 'Other Customer Deck', 'jury_evaluation', NULL)",
    ).run();
    await env.DB.prepare(
      "INSERT INTO deck_assignments (deck_id, evaluator_id, assigned_at) " +
        "VALUES ('zz_l4_other_deck', 'zz_away_other_tenant', '2026-10-01T09:00:00Z')",
    ).run();

    const cover = await myAccount(await login(INC_PM));
    expect(cover.coveringFor.map((p) => p.userId)).not.toContain("zz_away_other_tenant");
    for (const person of cover.coveringFor) {
      expect(person.assignments.map((a) => a.deckName)).not.toContain("Other Customer Deck");
    }
  });
});

// ── 4. The credential loop the change-password screen closes ──────────────────

describe("the temporary-credential loop, end to end", () => {
  it("an admin reset sets mustChangePassword; the user's own change clears it", async () => {
    const admin = await login(INC_ADMIN);
    const created = (await (
      await req("POST", "/api/users", admin, {
        name: "Fresh Member",
        email: "fresh.member.l4@globalcarbonwarriors.com",
        role: "jury",
      })
    ).json()) as { user: { id: string }; tempPassword: string };

    // An invited member signs in on a system-issued credential, and My account
    // says so — which is what the soft force on that screen reads.
    const theirs = await login("fresh.member.l4@globalcarbonwarriors.com", created.tempPassword);
    expect(theirs).not.toBe("");
    expect((await myAccount(theirs)).mustChangePassword).toBe(true);

    const changed = await req("PUT", "/api/users/me/password", theirs, {
      currentPassword: created.tempPassword,
      newPassword: "a-password-of-my-own",
    });
    expect(changed.status).toBe(200);
    expect((await myAccount(theirs)).mustChangePassword).toBe(false);

    // And the console's User access section now reports the truth about them.
    const row = (await roster(admin)).find((u) => u.id === created.user.id)!;
    expect(row.mustChangePassword).toBe(false);
    expect(await login("fresh.member.l4@globalcarbonwarriors.com", "a-password-of-my-own")).not.toBe("");
  });
});

// ── 5. The migration ─────────────────────────────────────────────────────────

describe("migrations/0107", () => {
  it("added the three columns and recorded its own verdicts as 'ok'", async () => {
    const cols = await env.DB.prepare(
      "SELECT count(*) AS n FROM pragma_table_info('users') WHERE name IN " +
        "('out_of_office_from', 'out_of_office_to', 'out_of_office_delegate')",
    ).first<{ n: number }>();
    expect(cols!.n).toBe(3);

    const { results } = await env.DB.prepare(
      "SELECT id, verdict FROM _tenancy_assert WHERE id LIKE '0107.%' ORDER BY id",
    ).all<{ id: string; verdict: string }>();
    expect(results.map((r) => r.id)).toEqual([
      "0107.no_self_or_cross_workspace_delegate",
      "0107.out_of_office_columns_exist",
    ]);
    for (const row of results) expect(row.verdict, row.id).toBe("ok");
  });

  it("indexes the delegate column partially, so a roster of NULLs is not indexed", async () => {
    const row = await env.DB.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_users_ooo_delegate'",
    ).first<{ sql: string }>();
    expect(row, "idx_users_ooo_delegate was not created").toBeTruthy();
    expect(row!.sql).toContain("WHERE out_of_office_delegate IS NOT NULL");
  });
});
