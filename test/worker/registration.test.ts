/**
 * LANE L2 — self-service registration, the four login failure modes, password
 * reset, and the rate limiter.
 *
 * ── WHY THE FIXTURES ARE EXPLICIT AND SELF-CLEANING ─────────────────────────
 *
 * Two measured properties of this pool shape every test below:
 *
 *   1. **D1 is not as isolated as the setup file implies.** Writes made by one case
 *      have been observed by the next in this repo, which once looked like an
 *      authorisation bug across four tests. So every case here uses a UNIQUE address,
 *      and every case that writes a `users` or `password_reset_tokens` row removes it
 *      again rather than trusting a rollback.
 *   2. **A `beforeAll` inside a `describe` IS rolled back.** So there is no shared
 *      fixture: each case creates what it needs.
 *
 * ── AND WHY THE RATE LIMITER NEEDS A RESET HOOK ─────────────────────────────
 *
 * `middleware/rateLimit.ts` keeps an in-isolate `Map` as its burst layer, and a `Map`
 * is not storage — nothing rolls it back. One case that deliberately drives a 429
 * would otherwise 429 every later case in the same file. `__resetLocalRateLimitState`
 * exists for this and nothing in `src/` calls it.
 */
import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { TENANT_KEYED_TABLES } from "../../src/shared/tenant";
import { hashToken } from "../../src/server/resubmit";
import { hashPassword } from "../../src/server/auth/password";
import {
  __resetLocalRateLimitState,
  AUTH_RATE_LIMITS,
  LOGIN_FAILURES_PER_WINDOW,
} from "../../src/server/middleware/rateLimit";

const BASE = "https://example.com";
/**
 * The domain this suite registers against, and it is deliberately NOT a real
 * customer's.
 *
 * These cases were first written against `globalcarbonwarriors.com`, because `0106`
 * put that domain on `t_default`. `0109` takes it back off — the pilot customer got
 * their own organisation once `SELECT uploaded_by` showed `t_default`'s 23 decks were
 * all QA uploads — and six cases here went red, which is the suite correctly
 * reporting that it had been depending on a specific customer's provisioning.
 *
 * A registration test needs A domain claimed by AN organisation. It does not need a
 * real one, and borrowing one couples the suite to a commercial decision that can
 * change on any given afternoon. `.example` is reserved by RFC 2606 and can never be
 * registered, so this cannot collide with anybody.
 */
const TEST_DOMAIN = "testworkspace.example";
const DEMO_ADMIN = "priya.sharma@demo.startupjury.ai";
const DEMO_PASSWORD = "demo1234";

beforeEach(async () => {
  // See the header. Also means each case's IP bucket starts empty at the burst
  // layer, so one case cannot spend another's budget.
  __resetLocalRateLimitState();
  // The suite's own fixture: `t_default` claims the test domain so registration has
  // a workspace to resolve to. Written here rather than relied upon from a migration,
  // so the cases below hold whatever a migration later decides about real customers.
  await env.DB.prepare("UPDATE organizations SET email_domain = ? WHERE id = 't_default'")
    .bind(TEST_DOMAIN)
    .run();
});

async function post(path: string, body: unknown): Promise<Response> {
  return SELF.fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function register(email: string, over: Record<string, unknown> = {}): Promise<Response> {
  return post("/api/auth/register", {
    name: "Asha Verma",
    email,
    password: "correct horse battery",
    ...over,
  });
}

interface UserShape {
  id: string;
  tenant_id: string;
  edition: string;
  name: string;
  email: string;
  role: string;
  initials: string;
  active: number;
  user_type: string;
  title: string | null;
  approval_state: string;
  must_change_password: number;
  password_hash: string | null;
}

function userRow(email: string): Promise<UserShape | null> {
  return env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first<UserShape>();
}

/** Remove everything a case created for one address, children first. */
async function purge(email: string): Promise<void> {
  await env.DB.prepare(
    "DELETE FROM password_reset_tokens WHERE user_id IN (SELECT id FROM users WHERE email = ?)",
  )
    .bind(email)
    .run();
  await env.DB.prepare(
    "DELETE FROM audit_log WHERE target_id IN (SELECT id FROM users WHERE email = ?)",
  )
    .bind(email)
    .run();
  await env.DB.prepare("DELETE FROM users WHERE email = ?").bind(email).run();
}

/** An approved, active, self-registered-shaped account with a known password. */
async function seedAccount(
  email: string,
  over: { active?: number; approvalState?: string; mustChange?: number; password?: string } = {},
): Promise<string> {
  const id = `usr_t${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare(
    "INSERT INTO users (id, tenant_id, edition, name, email, password_hash, role, initials, active, user_type, approval_state, must_change_password) " +
      "VALUES (?, 't_default', 'incubator', 'Test Person', ?, ?, 'jury', 'TP', ?, 'staff', ?, ?)",
  )
    .bind(
      id,
      email,
      await hashPassword(over.password ?? DEMO_PASSWORD),
      over.active ?? 1,
      over.approvalState ?? "approved",
      over.mustChange ?? 0,
    )
    .run();
  return id;
}

async function login(email: string, password: string, tenant?: string): Promise<Response> {
  return post("/api/auth/login", { email, password, ...(tenant ? { tenant } : {}) });
}

// ─────────────────────────────────────────────────────────────────────────────

describe("0106 · the migration", () => {
  it("gives organizations the two columns registration resolves a tenant from", async () => {
    // `0106` added the columns AND briefly renamed `t_default` to the pilot customer.
    // `0109` undoes the rename — the customer has their own organisation, provisioned
    // by `scripts/provision-gcw.sql`, because `t_default`'s 23 decks turned out to be
    // QA uploads rather than theirs. What `0106` contributes that outlives that is the
    // SCHEMA, so that is what this asserts.
    //
    // Read with no `email_domain` binding on purpose: the value is this suite's
    // fixture (see `beforeEach`), and asserting it here would only re-read what the
    // setup just wrote.
    const row = await env.DB.prepare(
      "SELECT name, slug, default_edition, status FROM organizations WHERE id = 't_default'",
    ).first<{ name: string; slug: string; default_edition: string; status: string }>();
    expect(row!.name).toBe("ai.STARTUPJURY Demo Workspace");
    expect(row!.slug).toBe("default");
    expect(row!.default_edition).toBe("incubator");
    expect(row!.status).toBe("active");

    // And the columns exist to be resolved from, which is the part registration needs.
    const cols = await env.DB.prepare(
      "SELECT count(*) AS n FROM pragma_table_info('organizations') WHERE name IN ('email_domain','default_edition')",
    ).first<{ n: number }>();
    expect(cols!.n).toBe(2);
  });

  it("leaves every account that predates it signing in — nothing is pending", async () => {
    // The whole no-behaviour-change claim of `0106` §4. A seeded account silently
    // flipped to 'pending' would be an account that stopped being able to sign in,
    // and 13 seeded logins, 72 e2e specs and the roles harness all depend on it not
    // having happened.
    const row = await env.DB.prepare(
      "SELECT count(*) n FROM users WHERE approval_state <> 'approved'",
    ).first<{ n: number }>();
    expect(row!.n).toBe(0);
  });

  it("refuses two organisations claiming one email domain", async () => {
    await env.DB.prepare(
      "INSERT INTO organizations (id, name, slug, status, email_domain) VALUES ('t_dupe', 'Dupe', 'dupe', 'active', ?)",
    )
      .bind(TEST_DOMAIN)
      .run()
      .then(
        () => {
          throw new Error("the partial unique index did not refuse a duplicate email_domain");
        },
        (err: unknown) => {
          expect(String(err)).toMatch(/UNIQUE/i);
        },
      );
    // …and two organisations with NO claim are fine, which is what makes the index
    // partial rather than plain.
    await env.DB.prepare(
      "INSERT INTO organizations (id, name, slug, status) VALUES ('t_noclaim1', 'A', 'a-noclaim', 'active')",
    ).run();
    await env.DB.prepare(
      "INSERT INTO organizations (id, name, slug, status) VALUES ('t_noclaim2', 'B', 'b-noclaim', 'active')",
    ).run();
    await env.DB.prepare("DELETE FROM organizations WHERE id IN ('t_noclaim1', 't_noclaim2')").run();
  });

  it("refuses an approval_state outside the vocabulary", async () => {
    const email = `check-${crypto.randomUUID()}@${TEST_DOMAIN}`;
    await expect(seedAccount(email, { approvalState: "maybe" })).rejects.toThrow(/CHECK/i);
    await purge(email);
  });

  it("registers password_reset_tokens as a tenant-keyed table and wrote its assertions", async () => {
    expect([...TENANT_KEYED_TABLES]).toContain("password_reset_tokens");
    const col = await env.DB.prepare(
      "SELECT count(*) n FROM pragma_table_info('password_reset_tokens') WHERE name = 'tenant_id'",
    ).first<{ n: number }>();
    expect(col!.n).toBe(1);
    // Tenant-ONLY by design (`0106` §5): the token authorises a person, and
    // `user_id` already reaches the row that carries the edition.
    const edition = await env.DB.prepare(
      "SELECT count(*) n FROM pragma_table_info('password_reset_tokens') WHERE name = 'edition'",
    ).first<{ n: number }>();
    expect(edition!.n).toBe(0);

    // The verdicts prove the assertions RAN. `_tenancy_assert`'s CHECK admits only
    // 'ok', so a failing one could never have committed — a skipped file leaves the
    // table SHORT rather than wrong, which is what this reads.
    const { results } = await env.DB.prepare(
      "SELECT id, verdict FROM _tenancy_assert WHERE id LIKE '0106.%' ORDER BY id",
    ).all<{ id: string; verdict: string }>();
    expect(results.map((r) => r.id)).toEqual([
      "0106.gcw_claims_its_domain",
      "0106.no_existing_account_was_left_pending",
      "0106.one_organisation_per_email_domain",
      "0106.password_reset_tokens_resolve_their_tenant",
    ]);
    expect(results.every((r) => r.verdict === "ok")).toBe(true);
  });
});

describe("two routers on /api/auth", () => {
  it("serves the new public routes and the old ones side by side", async () => {
    // Hono allows two routers on one prefix; this is the measurement rather than the
    // belief. All four must answer with something other than the JSON 404 that
    // `index.ts`'s `app.all("/api/*")` returns for an unmatched API path.
    const signUp = await register(`coexist-${crypto.randomUUID()}@nope.invalid`);
    expect(signUp.status).toBe(403); // reached the handler: no workspace claims it

    const forgot = await post("/api/auth/forgot-password", { email: "nobody@nope.invalid" });
    expect(forgot.status).toBe(202);

    const reset = await post("/api/auth/reset-password", { token: "x", password: "12345678" });
    expect(reset.status).toBe(400);
    expect(await reset.json()).toEqual({ error: "invalid_token" });

    const signIn = await login(DEMO_ADMIN, DEMO_PASSWORD);
    expect(signIn.status).toBe(200);

    const me = await SELF.fetch(`${BASE}/api/auth/me`);
    expect(me.status).toBe(401);

    const unknown = await post("/api/auth/no-such-route", {});
    expect(unknown.status).toBe(404);
  });
});

describe("POST /api/auth/register", () => {
  it("creates a pending jury account in the domain's workspace", async () => {
    const email = `happy-${crypto.randomUUID()}@${TEST_DOMAIN}`;
    const res = await register(email, { name: "  Asha Verma  ", title: "Climate Analyst" });
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ status: "pending_approval" });

    const row = await userRow(email);
    expect(row).toBeTruthy();
    // The three literals the route never binds, because none of them may come from
    // a request body.
    expect(row!.role).toBe("jury");
    expect(row!.approval_state).toBe("pending");
    expect(row!.active).toBe(0);
    // Resolved from the domain, never from the body.
    expect(row!.tenant_id).toBe("t_default");
    expect(row!.edition).toBe("incubator");
    // They chose this password, so it is not "Temporary".
    expect(row!.must_change_password).toBe(0);
    expect(row!.password_hash).toMatch(/^pbkdf2\$100000\$/);
    expect(row!.name).toBe("Asha Verma");
    expect(row!.initials).toBe("AV");
    expect(row!.user_type).toBe("staff");
    expect(row!.title).toBe("Climate Analyst");

    // No session: a pending principal must not hold a cookie.
    expect(res.headers.get("set-cookie")).toBeNull();

    const audit = await env.DB.prepare(
      "SELECT tenant_id, edition, category, action, actor_id FROM audit_log WHERE target_id = ?",
    )
      .bind(row!.id)
      .first<{ tenant_id: string; edition: string; category: string; action: string; actor_id: string | null }>();
    expect(audit).toMatchObject({
      tenant_id: "t_default",
      edition: "incubator",
      category: "security",
      action: "registration_pending",
    });
    // The registrant is the actor of their own sign-up.
    expect(audit!.actor_id).toBe(row!.id);

    await purge(email);
  });

  it("accepts the body the sign-up screen actually sends, including `designation`", async () => {
    // The client posts `{ email, password, firstName, lastName, name, designation? }`.
    // `title` is this route's own name for the field and `designation` is the screen's;
    // reading only one of them would silently drop a field the registrant filled in.
    const email = `shape-${crypto.randomUUID()}@${TEST_DOMAIN}`;
    const res = await post("/api/auth/register", {
      email,
      password: "correct horse battery",
      firstName: "Asha",
      lastName: "Verma",
      name: "Asha Verma",
      designation: "Programme Lead",
    });
    expect(res.status).toBe(202);
    const row = await userRow(email);
    expect(row!.name).toBe("Asha Verma");
    expect(row!.title).toBe("Programme Lead");
    await purge(email);
  });

  it("stores the address lower-case, because login compares case-sensitively", async () => {
    // `users.email` is UNIQUE per tenant with no COLLATE NOCASE and login is a plain
    // `=`. An address stored with a capital letter registers and then cannot sign in.
    const id = crypto.randomUUID();
    const typed = `Mixed.Case-${id}@${TEST_DOMAIN.toUpperCase()}`;
    const stored = `mixed.case-${id}@${TEST_DOMAIN}`;
    expect(await register(typed)).toMatchObject({ status: 202 });
    expect(await userRow(stored)).toBeTruthy();
    await purge(stored);
  });

  it("fails closed when no organisation claims the domain", async () => {
    const res = await register(`stranger-${crypto.randomUUID()}@someone-elses-company.test`);
    expect(res.status).toBe(403);
    const body = await res.json<{ error: string; message: string }>();
    expect(body.error).toBe("no_workspace_for_domain");
    expect(body.message).toMatch(/invite/i);
  });

  it("refuses a personal email address", async () => {
    // `accountOrder.ts:249-278`'s 16 free-mail domains — the client's own rule. Worth
    // telling GCW: a colleague on gmail must be INVITED, not self-registered.
    const res = await register(`someone-${crypto.randomUUID()}@gmail.com`);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "personal_email" });
  });

  it("refuses a short password and a missing name", async () => {
    const email = `short-${crypto.randomUUID()}@${TEST_DOMAIN}`;
    expect((await register(email, { password: "1234567" })).status).toBe(400);
    expect(await userRow(email)).toBeNull();

    const email2 = `noname-${crypto.randomUUID()}@${TEST_DOMAIN}`;
    expect((await register(email2, { name: "   " })).status).toBe(400);
    expect(await userRow(email2)).toBeNull();
  });

  it("answers a duplicate address exactly as it answers a fresh one, and writes nothing", async () => {
    // The anti-enumeration decision, asserted as INDISTINGUISHABILITY rather than as
    // a status code: a 409 here would answer "does firstname.lastname@<company> work
    // at <company>?" for anybody who can guess a name.
    const email = `dupe-${crypto.randomUUID()}@${TEST_DOMAIN}`;
    const first = await register(email);
    const second = await register(email, { name: "Someone Else", password: "another password" });

    expect(second.status).toBe(first.status);
    expect(await second.json()).toEqual(await first.json());

    const count = await env.DB.prepare("SELECT count(*) n FROM users WHERE email = ?")
      .bind(email)
      .first<{ n: number }>();
    expect(count!.n).toBe(1);
    // The name from the second attempt must not have overwritten the first.
    expect((await userRow(email))!.name).toBe("Asha Verma");

    // The signal goes to the workspace's own trail, where an authenticated
    // administrator can see it and the anonymous caller cannot.
    const dup = await env.DB.prepare(
      "SELECT count(*) n FROM audit_log WHERE action = 'registration_duplicate' AND target_id = ?",
    )
      .bind((await userRow(email))!.id)
      .first<{ n: number }>();
    expect(dup!.n).toBe(1);

    await purge(email);
  });

  it("refuses a suspended organisation with the same refusal as an unclaimed domain", async () => {
    // `0083:109` — suspended is "rows retained, sign-in refused". Telling an
    // anonymous caller that a named company's account is suspended discloses a
    // commercial fact to somebody who has proved nothing.
    await env.DB.prepare("UPDATE organizations SET status = 'suspended' WHERE id = 't_default'").run();
    try {
      const email = `suspended-${crypto.randomUUID()}@${TEST_DOMAIN}`;
      const res = await register(email);
      expect(res.status).toBe(403);
      expect(await res.json<{ error: string }>()).toMatchObject({ error: "no_workspace_for_domain" });
      expect(await userRow(email)).toBeNull();
    } finally {
      await env.DB.prepare("UPDATE organizations SET status = 'active' WHERE id = 't_default'").run();
    }
  });
});

describe("POST /api/auth/login · the four failure modes", () => {
  it("refuses a pending registrant with 403 pending_approval, not a credential error", async () => {
    // The live-call failure this exists for: told "your password is wrong", a
    // registrant retypes their password instead of ringing their administrator.
    const email = `pending-${crypto.randomUUID()}@${TEST_DOMAIN}`;
    await register(email, { password: "a good long password" });

    const res = await login(email, "a good long password");
    expect(res.status).toBe(403);
    const body = await res.json<{ error: string; message: string }>();
    expect(body.error).toBe("pending_approval");
    expect(body.message).toMatch(/approve/i);
    expect(res.headers.get("set-cookie")).toBeNull();

    // And a WRONG password on the same pending account is still an ordinary 401 —
    // the specific refusal is only given to somebody who proved the credential.
    const wrong = await login(email, "not the password");
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({ error: "invalid_credentials" });

    await purge(email);
  });

  it("signs the same account in the moment an administrator approves it", async () => {
    const email = `approved-${crypto.randomUUID()}@${TEST_DOMAIN}`;
    await register(email, { password: "a good long password" });
    await env.DB.prepare(
      "UPDATE users SET active = 1, approval_state = 'approved', role = 'program_manager' WHERE email = ?",
    )
      .bind(email)
      .run();

    const res = await login(email, "a good long password");
    expect(res.status).toBe(200);
    const body = await res.json<{ user: { role: string; tenantId: string; mustChangePassword: boolean } }>();
    expect(body.user.role).toBe("program_manager");
    expect(body.user.tenantId).toBe("t_default");
    // They chose their own password at sign-up, so nothing is owed.
    expect(body.user.mustChangePassword).toBe(false);
    expect(res.headers.get("set-cookie")).toMatch(/sj_session=/);

    await purge(email);
  });

  it("refuses a deactivated and a declined account with 403 account_disabled", async () => {
    const off = `off-${crypto.randomUUID()}@${TEST_DOMAIN}`;
    await seedAccount(off, { active: 0 });
    const res = await login(off, DEMO_PASSWORD);
    expect(res.status).toBe(403);
    expect(await res.json<{ error: string }>()).toMatchObject({ error: "account_disabled" });
    await purge(off);

    const no = `declined-${crypto.randomUUID()}@${TEST_DOMAIN}`;
    await seedAccount(no, { approvalState: "declined" });
    const res2 = await login(no, DEMO_PASSWORD);
    expect(res2.status).toBe(403);
    expect(await res2.json<{ error: string }>()).toMatchObject({ error: "account_disabled" });
    await purge(no);
  });

  it("refuses a live account whose organisation was suspended, as disabled not as a typo", async () => {
    const email = `orgoff-${crypto.randomUUID()}@${TEST_DOMAIN}`;
    await seedAccount(email);
    await env.DB.prepare("UPDATE organizations SET status = 'suspended' WHERE id = 't_default'").run();
    try {
      const res = await login(email, DEMO_PASSWORD);
      expect(res.status).toBe(403);
      expect(await res.json<{ error: string }>()).toMatchObject({ error: "account_disabled" });
      expect(res.headers.get("set-cookie")).toBeNull();
    } finally {
      await env.DB.prepare("UPDATE organizations SET status = 'active' WHERE id = 't_default'").run();
      await purge(email);
    }
  });

  it("keeps an unknown address and a wrong password byte-identical", async () => {
    // Anything that separates these two is an enumeration oracle. Asserted on the
    // whole response, not just the status.
    const unknown = await login(`nobody-${crypto.randomUUID()}@${TEST_DOMAIN}`, DEMO_PASSWORD);
    const wrong = await login(DEMO_ADMIN, "definitely not the password");
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(await unknown.text()).toBe(await wrong.text());
  });

  it("surfaces must_change_password on login and on /me", async () => {
    // §5.2: the flag is written by three routes and was enforced and reported by
    // none, so the console read "Temporary — not yet changed" for every row forever.
    const email = `temp-${crypto.randomUUID()}@${TEST_DOMAIN}`;
    await seedAccount(email, { mustChange: 1 });

    const res = await login(email, DEMO_PASSWORD);
    expect(res.status).toBe(200);
    expect((await res.json<{ user: { mustChangePassword: boolean } }>()).user.mustChangePassword).toBe(true);

    const cookie = res.headers.get("set-cookie")!.split(";")[0];
    const me = await SELF.fetch(`${BASE}/api/auth/me`, { headers: { Cookie: cookie } });
    expect((await me.json<{ user: { mustChangePassword: boolean } }>()).user.mustChangePassword).toBe(true);

    // And it goes false on the next read once the flag is cleared — the reason it is
    // read per request rather than snapshotted into the seven-day KV session.
    await env.DB.prepare("UPDATE users SET must_change_password = 0 WHERE email = ?").bind(email).run();
    const again = await SELF.fetch(`${BASE}/api/auth/me`, { headers: { Cookie: cookie } });
    expect((await again.json<{ user: { mustChangePassword: boolean } }>()).user.mustChangePassword).toBe(false);

    await purge(email);
  });

  it("still signs in the seeded superuser, and still takes a tenant slug", async () => {
    // The regression guard: 13 seeded logins, 72 e2e specs and 526 roles cases all
    // come through here, and the slug moved in `0106`.
    const plain = await login(DEMO_ADMIN, DEMO_PASSWORD);
    expect(plain.status).toBe(200);
    // `default`, not `global-carbon-warriors`: `0106` renamed the slug and `0109`
    // gave it back when the pilot customer moved to their own organisation. The slug
    // is the handle a caller supplies to disambiguate a login, so it is behaviour.
    const named = await login(DEMO_ADMIN, DEMO_PASSWORD, "default");
    expect(named.status).toBe(200);
    const wrongSlug = await login(DEMO_ADMIN, DEMO_PASSWORD, "no-such-customer");
    expect(wrongSlug.status).toBe(401);
  });

  it("signs in an address typed with capitals", async () => {
    const res = await login(DEMO_ADMIN.toUpperCase(), DEMO_PASSWORD);
    expect(res.status).toBe(200);
  });
});

describe("password reset", () => {
  it("always answers 202, whether or not the address exists", async () => {
    const real = await post("/api/auth/forgot-password", { email: DEMO_ADMIN });
    const fake = await post("/api/auth/forgot-password", { email: `ghost-${crypto.randomUUID()}@${TEST_DOMAIN}` });
    const nonsense = await post("/api/auth/forgot-password", { email: "not an address" });
    expect(real.status).toBe(202);
    expect(fake.status).toBe(202);
    expect(nonsense.status).toBe(202);
    // Indistinguishable bodies, and no token or link in any of them.
    const text = await real.text();
    expect(text).toBe(await fake.text());
    expect(text).not.toMatch(/token|reset-password\//i);
  });

  it("mints a stored, hashed, expiring token for a live account and none for a pending one", async () => {
    const live = `reset-${crypto.randomUUID()}@${TEST_DOMAIN}`;
    const liveId = await seedAccount(live);
    await post("/api/auth/forgot-password", { email: live });

    const row = await env.DB.prepare(
      "SELECT tenant_id, token_hash, expires_at, used_at FROM password_reset_tokens WHERE user_id = ?",
    )
      .bind(liveId)
      .first<{ tenant_id: string; token_hash: string; expires_at: string; used_at: string | null }>();
    expect(row).toBeTruthy();
    expect(row!.tenant_id).toBe("t_default");
    // SHA-256 hex, never the raw token.
    expect(row!.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.used_at).toBeNull();
    expect(Date.parse(row!.expires_at)).toBeGreaterThan(Date.now());
    // An hour, not a month: `resubmit_tokens` lives 30 days because a founder may be
    // slow; a password reset is minutes-to-an-hour work.
    expect(Date.parse(row!.expires_at)).toBeLessThan(Date.now() + 2 * 60 * 60 * 1000);
    await purge(live);

    // A pending registrant gets nothing: login refuses them either way, so a live
    // credential would only be a credential for an account that cannot be used.
    const pending = `pendingreset-${crypto.randomUUID()}@${TEST_DOMAIN}`;
    await register(pending, { password: "a good long password" });
    await post("/api/auth/forgot-password", { email: pending });
    const none = await env.DB.prepare(
      "SELECT count(*) n FROM password_reset_tokens WHERE user_id = (SELECT id FROM users WHERE email = ?)",
    )
      .bind(pending)
      .first<{ n: number }>();
    expect(none!.n).toBe(0);
    await purge(pending);
  });

  it("emails a link the client screen can actually read, with the token redacted in the outbox", async () => {
    // The ONE place the server and the client meet on this feature, and neither side
    // can see the other's code: the screen is `<Route path="/reset-password">` with no
    // `:token` segment and reads `useSearchParams().get("token")`, so a path-segment
    // link would land on the SPA catch-all and report "no token in the URL".
    //
    // Delivery is gated off (`EMAIL_FROM` is `""`), so the assertion is on the OUTBOX
    // row — which is also the thing an operator would look at on the day.
    const email = `link-${crypto.randomUUID()}@${TEST_DOMAIN}`;
    const id = await seedAccount(email);
    await post("/api/auth/forgot-password", { email });

    const mail = await env.DB.prepare(
      "SELECT tenant_id, kind, to_email, status, body FROM email_outbox WHERE to_email = ? ORDER BY created_at DESC",
    )
      .bind(email)
      .first<{ tenant_id: string; kind: string; to_email: string; status: string; body: string }>();
    expect(mail).toBeTruthy();
    // Named scope, never the `t_default` fallback: without it one customer's reset
    // request is filed in and mailed from another's workspace.
    expect(mail!.tenant_id).toBe("t_default");
    // The borrowed kind, until `EmailKind` gains `password_reset`.
    expect(mail!.kind).toBe("account_invite");
    // No sending domain onboarded, so audited only — never reported as sent.
    expect(mail!.status).toBe("recorded");
    expect(mail!.body).toContain("/reset-password?token=[redacted]");
    // The outbox is durable and the link is a credential: the raw token must not be
    // in it, and the stored hash must not match anything in the body either.
    const stored = await env.DB.prepare(
      "SELECT token_hash FROM password_reset_tokens WHERE user_id = ?",
    )
      .bind(id)
      .first<{ token_hash: string }>();
    expect(mail!.body).not.toContain(stored!.token_hash);
    expect(mail!.body).not.toMatch(/token=[A-Za-z0-9_-]{20,}/);

    await env.DB.prepare("DELETE FROM email_outbox WHERE to_email = ?").bind(email).run();
    await purge(email);
  });

  it("supersedes an earlier live link when a new one is minted", async () => {
    const email = `super-${crypto.randomUUID()}@${TEST_DOMAIN}`;
    const id = await seedAccount(email);
    await post("/api/auth/forgot-password", { email });
    await post("/api/auth/forgot-password", { email });
    const { results } = await env.DB.prepare(
      "SELECT used_at FROM password_reset_tokens WHERE user_id = ? ORDER BY created_at, id",
    )
      .bind(id)
      .all<{ used_at: string | null }>();
    expect(results).toHaveLength(2);
    // Exactly one is still redeemable. A stale link in an older email is a second
    // live key to the account.
    expect(results.filter((r) => r.used_at === null)).toHaveLength(1);
    await purge(email);
  });

  it("redeems a token once, sets the new password, and refuses the second use", async () => {
    // The raw token is never returned by any route and only its hash is stored, so
    // the row is planted here with a hash this test computed — which is also the
    // proof that `hashToken` is what the route looks a token up by.
    const email = `redeem-${crypto.randomUUID()}@${TEST_DOMAIN}`;
    const id = await seedAccount(email, { mustChange: 1 });
    const token = `raw-${crypto.randomUUID()}`;
    await env.DB.prepare(
      "INSERT INTO password_reset_tokens (id, tenant_id, user_id, token_hash, expires_at) VALUES (?, 't_default', ?, ?, ?)",
    )
      .bind(`prt_${crypto.randomUUID()}`, id, await hashToken(token), new Date(Date.now() + 600_000).toISOString())
      .run();

    const res = await post("/api/auth/reset-password", { token, password: "a brand new password" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    // No cookie: the reset is not a way to obtain a session.
    expect(res.headers.get("set-cookie")).toBeNull();

    // The new password works and the old one does not.
    expect((await login(email, "a brand new password")).status).toBe(200);
    expect((await login(email, DEMO_PASSWORD)).status).toBe(401);
    // And the credential is no longer "system-issued".
    expect((await userRow(email))!.must_change_password).toBe(0);

    const used = await post("/api/auth/reset-password", { token, password: "a third password" });
    expect(used.status).toBe(400);
    expect(await used.json()).toEqual({ error: "token_used" });
    expect((await login(email, "a brand new password")).status).toBe(200);

    const audit = await env.DB.prepare(
      "SELECT count(*) n FROM audit_log WHERE action = 'password_reset_completed' AND target_id = ?",
    )
      .bind(id)
      .first<{ n: number }>();
    expect(audit!.n).toBe(1);

    await purge(email);
  });

  it("refuses an expired token, an unknown token and a short password", async () => {
    const email = `expired-${crypto.randomUUID()}@${TEST_DOMAIN}`;
    const id = await seedAccount(email);
    const token = `stale-${crypto.randomUUID()}`;
    await env.DB.prepare(
      "INSERT INTO password_reset_tokens (id, tenant_id, user_id, token_hash, expires_at) VALUES (?, 't_default', ?, ?, ?)",
    )
      .bind(`prt_${crypto.randomUUID()}`, id, await hashToken(token), new Date(Date.now() - 1000).toISOString())
      .run();

    const expired = await post("/api/auth/reset-password", { token, password: "a good long password" });
    expect(expired.status).toBe(400);
    expect(await expired.json()).toEqual({ error: "token_expired" });
    // And an expired link did not change the password.
    expect((await login(email, DEMO_PASSWORD)).status).toBe(200);

    const unknown = await post("/api/auth/reset-password", {
      token: `never-issued-${crypto.randomUUID()}`,
      password: "a good long password",
    });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({ error: "invalid_token" });

    const short = await post("/api/auth/reset-password", { token, password: "1234567" });
    expect(short.status).toBe(400);
    expect(await short.json()).toEqual({ error: "password_too_short" });

    await purge(email);
  });
});

describe("the rate limiter", () => {
  it("429s a registration flood against one address, with Retry-After", async () => {
    const email = `flood-${crypto.randomUUID()}@${TEST_DOMAIN}`;
    const allowed = AUTH_RATE_LIMITS.register.email!;
    for (let i = 0; i < allowed; i++) {
      // Each of these is a duplicate after the first, which is a 202 either way — so
      // what is being measured is the LIMIT and not the duplicate handling.
      expect((await register(email)).status).toBe(202);
    }
    const blocked = await register(email);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toMatch(/^\d+$/);
    expect(await blocked.json<{ error: string }>()).toMatchObject({ error: "rate_limited" });

    // Only ONE account was created, by the first call.
    const count = await env.DB.prepare("SELECT count(*) n FROM users WHERE email = ?")
      .bind(email)
      .first<{ n: number }>();
    expect(count!.n).toBe(1);

    await purge(email);
    __resetLocalRateLimitState();
  });

  it("locks an address out after a run of wrong passwords", async () => {
    // §5.3 measured 40 wrong-password logins answered 401 forty times in 292 ms. This
    // is the brake on that.
    const email = `guess-${crypto.randomUUID()}@${TEST_DOMAIN}`;
    await seedAccount(email);

    for (let i = 0; i < LOGIN_FAILURES_PER_WINDOW; i++) {
      expect((await login(email, `wrong ${i}`)).status).toBe(401);
    }
    const locked = await login(email, "wrong again");
    expect(locked.status).toBe(429);
    expect(locked.headers.get("Retry-After")).toMatch(/^\d+$/);
    // Even the CORRECT password is refused while the lock holds — otherwise the
    // limiter would be a free oracle for which guess was right.
    expect((await login(email, DEMO_PASSWORD)).status).toBe(429);

    await purge(email);
    __resetLocalRateLimitState();
  });

  it("clears the budget on a successful sign-in, so a real user cannot lock themselves out", async () => {
    // This is what keeps the e2e suite and the 526-case roles harness green: both
    // sign in as the same seeded accounts over and over, and a limiter that counted
    // SUCCESSES would redden them and then be raised until it did nothing.
    //
    // A FRESH address, deliberately. Measured while writing this: the KV counter is
    // NOT rolled back between assertions inside one test, and
    // `__resetLocalRateLimitState` clears only the in-isolate layer — so reusing the
    // locked-out address above would have been reading a stale KV bucket and calling
    // it a cleared one. That is the shape of a vacuous test, in the other direction.
    const email = `clears-${crypto.randomUUID()}@${TEST_DOMAIN}`;
    await seedAccount(email);

    // Spend most of the budget, then succeed.
    for (let i = 0; i < LOGIN_FAILURES_PER_WINDOW - 1; i++) {
      expect((await login(email, `wrong ${i}`)).status).toBe(401);
    }
    expect((await login(email, DEMO_PASSWORD)).status).toBe(200);

    // The full budget is available again — a tenth failure would have 429'd without
    // the clear, and here the whole run is 401.
    for (let i = 0; i < LOGIN_FAILURES_PER_WINDOW; i++) {
      expect((await login(email, `wrong again ${i}`)).status).toBe(401);
    }

    await purge(email);
    __resetLocalRateLimitState();
  });

  it("does not limit /me or /logout", async () => {
    // A limiter in front of an ordinary page load is the quickest way to make
    // somebody turn the whole thing off.
    for (let i = 0; i < 40; i++) {
      expect((await SELF.fetch(`${BASE}/api/auth/me`)).status).toBe(401);
    }
    for (let i = 0; i < 40; i++) {
      expect((await post("/api/auth/logout", {})).status).toBe(200);
    }
  });
});
