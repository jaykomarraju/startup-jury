import { Hono } from "hono";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import type { AppEnv, Env, SessionUser } from "../types";
import { getUsersByEmail, getOrganizationById, getOrganizationBySlug, type UserRow } from "../db";
import { hashPassword, verifyPassword } from "../auth/password";
import {
  createSession,
  deleteSession,
  SESSION_COOKIE,
} from "../auth/session";
import { requireAuth } from "../auth/middleware";
import { loadPermissionOverrides } from "../auth/permissions";
import { scopeOf } from "../../shared/tenant";
import { emitNotification } from "../email/outbox";
import {
  clearLoginFailures,
  loginLockedOut,
  recordLoginFailure,
} from "../middleware/rateLimit";
import { grantedTasks } from "../../shared/permissions";
import { roleLabel } from "../../shared/roles";

const auth = new Hono<AppEnv>();

/** The task ids this principal holds — see the note on `GET /me` below. */
async function permissionsFor(db: D1Database, user: SessionUser): Promise<string[]> {
  // T1-CONFIG, one expression inside T0's file: `loadPermissionOverrides` now takes
  // the workspace rather than the edition, because `role_permissions` is the
  // authorisation matrix itself (§2 B10) and a gate must not read it from another
  // customer. `scopeOf(user)` is the same principal this function was already
  // answering for.
  return grantedTasks(
    user.edition,
    user.role,
    await loadPermissionOverrides(db, scopeOf(user), user.role),
  );
}

/**
 * ── WHY LOGIN CHANGED AT ALL ─────────────────────────────────────────────────
 *
 * §2 A7 is the one finding in the leak table that is not a leak: `users.email` was
 * globally `UNIQUE` (`0001_init.sql:7`) and there is no tenant selector at login,
 * so "two customers cannot both employ `alice@gmail.com`, and this blocks the
 * model outright." `0087` removes that constraint. The moment it does, an address
 * stops identifying an ACCOUNT and starts identifying a PERSON, and
 * `SELECT * FROM users WHERE email = ?` followed by `.first()` becomes a
 * cross-tenant authentication bug — it signs the caller into whichever row the
 * planner returned first.
 *
 * ── HOW THE WORKSPACE IS CHOSEN, IN ORDER ───────────────────────────────────
 *
 *   1. One candidate — the case today and for every single-workspace customer.
 *      Nothing changes: `{ email, password }` signs in exactly as before, which is
 *      what keeps 13 seeded logins, 72 e2e specs and the 526-case roles harness
 *      working without a line of change.
 *   2. A `tenant` was supplied (an `organizations.slug`) — candidates are narrowed
 *      to it BEFORE any password is checked, so supplying a slug can never widen
 *      the search.
 *   3. More than one candidate survives and the password matches more than one of
 *      them — the caller is one human with accounts at two customers and the same
 *      password at both. `409 tenant_required`, with the names of the workspaces
 *      the password actually opened.
 *
 * ── AND WHY THAT 409 IS NOT AN ENUMERATION ORACLE ───────────────────────────
 *
 * It is returned only AFTER a password has verified, and it lists only the
 * workspaces that THAT password opened. An attacker who can trigger it already
 * holds the credential.
 *
 * A host-derived tenant (`acme.startupjury.ai`) is the shape a real deployment
 * wants and is deliberately NOT built here: §3 notes `billing/provider.ts:162`
 * hardcodes `returnUrl: "/app/admin?section=bl"` and is already wrong for a
 * customer-specific host, so hostnames are their own piece of work. When they
 * arrive they resolve a slug and feed step 2; nothing below changes.
 *
 * ── THE FOUR FAILURE MODES, AND WHY ONE 401 WAS NOT ENOUGH ──────────────────
 *
 * This route used to answer every refusal with `401 invalid_credentials` — unknown
 * address, wrong password, suspended organisation, inactive account, no password
 * set, all one code. That is correct for the first two and actively harmful for the
 * rest, because the pilot customer's workspace now creates accounts that are
 * deliberately not yet allowed in: a self-registered colleague lands
 * `active = 0, approval_state = 'pending'` (`routes/registration.ts`). Told "your
 * password is wrong" on a conference call, that person retypes their password
 * instead of ringing their administrator, and the demo stalls on a screen that is
 * working exactly as designed.
 *
 * So there are four, and the split is drawn at the password check:
 *
 *   · `401 invalid_credentials` — unknown address OR wrong password. These two stay
 *     INDISTINGUISHABLE from each other, deliberately and permanently: anything that
 *     separates them is an account-enumeration oracle. Also every case where no
 *     candidate verified at all.
 *   · `403 pending_approval` — the password was RIGHT and the account has never been
 *     approved. Only reachable with a correct credential, so it discloses nothing an
 *     attacker did not already have.
 *   · `403 account_disabled` — the password was RIGHT and the account is deactivated,
 *     declined, or belongs to a suspended organisation. `0083:109` defines suspended
 *     as "rows retained, sign-in refused", which is this, not a bad credential.
 *   · `409 tenant_required` — unchanged. See above.
 *
 * A 500 stays a 500. Nothing below catches a database error and reports it as a
 * credential failure, which is the other half of the same rule: a user told their
 * password is wrong when the database is down will change their password.
 *
 * ── THE TIMING ORACLE, MEASURED AT 1 ms VERSUS 8 ms ─────────────────────────
 *
 * §5.3: "login also leaks address existence by timing (1 ms unknown vs 8 ms known,
 * because `verifyPassword` is never called for an unknown address)". An 8x
 * difference is trivially measurable over a network and it turns the carefully
 * identical 401 above into an oracle anyway. `equaliseVerifyCost` below runs one
 * real PBKDF2 against a throwaway hash when the candidate list is empty, so the
 * unknown-address path pays the same cost as the known one.
 *
 * ── AND WHY THERE IS A FAILURE COUNTER HERE AND NOT JUST A MIDDLEWARE ───────
 *
 * `src/server/middleware/rateLimit.ts` limits this route by IP, generously, because
 * a conference room is one NAT address. The per-ADDRESS limit has to live inside the
 * handler because it counts FAILURES and a success clears it — a middleware cannot
 * know the outcome, and counting successful logins per address would redden the e2e
 * suite and the 526-case roles harness, both of which sign in as the same seeded
 * accounts over and over. That module's header has the numbers.
 */
interface LoginCandidate {
  row: UserRow;
  org: { id: string; name: string; slug: string; status: string };
}

/** Why a correct password still did not open an account. */
type LoginRefusal = "pending_approval" | "account_disabled";

/**
 * The two `users` columns login now needs that `UserRow` does not carry.
 *
 * `getUsersByEmail` does `SELECT *` so the values are already in flight, but its
 * declared row type (`db.ts:4-23`) has neither `approval_state` (new in `0106`) nor
 * `must_change_password`, and `src/server/db.ts` belongs to another lane. Widening
 * the shared type is the right fix and is in this lane's report; until then this is
 * one extra scoped read per OPENED candidate — which is one read on a successful
 * login and zero on a failed one, because it runs only after a password verified.
 */
interface AccountFlags {
  approval_state: string;
  must_change_password: number;
}

async function accountFlags(db: D1Database, user: UserRow): Promise<AccountFlags | null> {
  return db
    .prepare(
      "SELECT approval_state, must_change_password FROM users WHERE id = ? AND tenant_id = ?",
    )
    .bind(user.id, user.tenant_id)
    .first<AccountFlags>();
}

/**
 * A throwaway PBKDF2 hash, built once per isolate, used only to spend the same CPU
 * on an unknown address that a known one costs.
 *
 * It is a hash of a random UUID that is discarded immediately, so there is no
 * plaintext for it anywhere and it can never open an account — it is not a
 * credential, it is a workload. A hardcoded constant would have been one PBKDF2
 * cheaper on the first call; generating it means no hash literal sits in the source
 * looking like a secret. The first unknown-address request in a fresh isolate
 * therefore costs two derivations instead of one, which makes that path SLOWER than
 * the known path rather than faster — the harmless direction.
 */
let decoyHash: string | null = null;

async function equaliseVerifyCost(password: string): Promise<void> {
  decoyHash ??= await hashPassword(crypto.randomUUID());
  await verifyPassword(password, decoyHash);
}

function toSessionUser(row: {
  id: string;
  name: string;
  initials: string;
  role: SessionUser["role"];
  edition: SessionUser["edition"];
  tenant_id: string;
  title?: string | null;
}): SessionUser {
  return {
    id: row.id,
    name: row.name,
    initials: row.initials,
    role: row.role,
    edition: row.edition,
    tenantId: row.tenant_id,
    ...(row.title ? { title: row.title } : {}),
  };
}

auth.post("/login", async (c) => {
  const body = await c.req
    .json<{ email?: string; password?: string; tenant?: string }>()
    .catch(() => null);
  if (!body?.email || !body?.password) {
    return c.json({ error: "email and password required" }, 400);
  }

  // Normalised the same way every WRITE of an address is normalised. `users.email`
  // is UNIQUE per tenant after `0087` with no `COLLATE NOCASE`, and this lookup is a
  // plain `=` — measured case-sensitive. Before this, an account whose address was
  // stored lower-case (which is all of them: `POST /api/users` lower-cases at
  // `users.ts:308`, and so does `routes/registration.ts`) could not be signed into by
  // someone who typed their own address with a capital letter. Verified against the
  // seed first: no migration writes a mixed-case address, so nothing regresses.
  const email = body.email.trim().toLowerCase();

  // The per-address brake. Checked BEFORE any password is verified, so a
  // locked-out address does not even spend the PBKDF2 — see the module header on
  // why this lives here and not in the middleware.
  const lock = await loginLockedOut(c.env, email);
  if (lock.locked) {
    return c.json({ error: "rate_limited", retryAfter: lock.retryAfter }, 429, {
      "Retry-After": String(lock.retryAfter),
    });
  }

  // Step 2 of the resolution order: a supplied slug NARROWS, so it is resolved
  // first and an unknown one fails as an ordinary bad credential rather than
  // telling the caller which customers exist.
  let wanted: string | null = null;
  if (body.tenant) {
    const org = await getOrganizationBySlug(c.env.DB, body.tenant);
    if (!org) {
      await recordLoginFailure(c.env, email);
      return c.json({ error: "invalid_credentials" }, 401);
    }
    wanted = org.id;
  }

  const rows = await getUsersByEmail(c.env.DB, email);
  const candidates: LoginCandidate[] = [];
  for (const row of rows) {
    if (wanted && row.tenant_id !== wanted) continue;
    // `active` and the organisation's status are NO LONGER filters here. They were,
    // and that is what made a deactivated account and a suspended customer
    // indistinguishable from a typo. They are now decided AFTER the password check
    // below, which is the only place a specific refusal can be given without
    // becoming an oracle. A row with no password hash stays out: nothing can verify
    // against it, and leaving it in would only make the loop below do less work for
    // some addresses than others.
    if (!row.password_hash) continue;
    const org = await getOrganizationById(c.env.DB, row.tenant_id);
    // A row whose tenant has no organisation cannot be signed in. `0100` asserts
    // this never happens, and if the assertion is ever wrong the answer is to
    // refuse the login, not to guess the customer.
    if (!org) continue;
    candidates.push({ row, org });
  }

  // The password is checked against EVERY candidate before any decision, so the
  // response time and the response body do not vary with how many accounts the
  // address has — and when there are NO candidates it is checked against a decoy,
  // so an unknown address costs what a known one costs. See `equaliseVerifyCost`.
  if (candidates.length === 0) await equaliseVerifyCost(body.password);
  const opened: LoginCandidate[] = [];
  for (const candidate of candidates) {
    if (await verifyPassword(body.password, candidate.row.password_hash!)) opened.push(candidate);
  }
  if (opened.length === 0) {
    await recordLoginFailure(c.env, email);
    return c.json({ error: "invalid_credentials" }, 401);
  }

  // The password is right. From here the refusals may be specific.
  //
  // The two reads below happen only on this path, so a failed login does no extra
  // work. The loop is bounded by the number of workspaces ONE address holds — one
  // today, and the `409` below is the case where it is two.
  const eligible: LoginCandidate[] = [];
  const refusals: LoginRefusal[] = [];
  let mustChangePassword = false;
  for (const candidate of opened) {
    const flags = await accountFlags(c.env.DB, candidate.row);
    // The row verified a password a moment ago, so a missing flags row means the
    // account disappeared mid-request. Refuse rather than assume.
    if (!flags) {
      refusals.push("account_disabled");
      continue;
    }
    if (flags.approval_state === "pending") {
      refusals.push("pending_approval");
      continue;
    }
    if (candidate.org.status === "suspended" || !candidate.row.active || flags.approval_state === "declined") {
      refusals.push("account_disabled");
      continue;
    }
    eligible.push(candidate);
    if (flags.must_change_password === 1) mustChangePassword = true;
  }

  if (eligible.length === 0) {
    // `pending_approval` wins when both appear, because it is the one the caller can
    // do something about: it names the person they need to ask. A 403 is NOT counted
    // as a login failure — the credential was correct, and the failure counter exists
    // to stop password guessing, not to lock out a colleague waiting for approval.
    const refusal = refusals.includes("pending_approval") ? "pending_approval" : "account_disabled";
    return c.json(
      {
        error: refusal,
        message:
          refusal === "pending_approval"
            ? "Your account is waiting for an administrator to approve it."
            : "This account is not active. Ask your administrator to re-enable it.",
      },
      403,
    );
  }
  if (eligible.length > 1) {
    // One human, two customers, one password. Only reachable with a correct
    // credential, and it lists only the workspaces that credential can actually
    // open — a pending or suspended one is excluded above, so naming it here would
    // offer a workspace the next request would refuse.
    return c.json(
      {
        error: "tenant_required",
        tenants: eligible.map(({ org }) => ({ slug: org.slug, name: org.name })),
      },
      409,
    );
  }
  const user = eligible[0].row;

  // A correct password opened an account, so this address is not under attack.
  await clearLoginFailures(c.env, email);

  // W3-B producer — "New team member accepted invite". An invite is *accepted*
  // the first time its credential is actually used, which is here and nowhere
  // else: `POST /api/users` sends the temporary password, and until now nothing
  // recorded whether anyone ever signed in with it (F0016; the column is the
  // one `W1-C` asked for in §9). `migrations/0041` backfills every account that
  // already exists, so this fires for new invitees only — never for the seeded
  // demo logins.
  if (user.invite_accepted_at === null) await recordInviteAccepted(c.env, user);

  const sessionUser = toSessionUser(user);
  const token = await createSession(c.env.SESSIONS, sessionUser);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: new URL(c.req.url).protocol === "https:",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return c.json({
    user: {
      ...sessionUser,
      permissions: await permissionsFor(c.env.DB, sessionUser),
      // §5.2: `must_change_password` is written by three routes and enforced by
      // none, so the console's User access column reads "Temporary — not yet
      // changed" for every row forever. This is the half of that fix the server
      // owes the client — the flag reaches the browser, which can now send a
      // first-login password change to `PUT /api/users/me/password` (a route that
      // is real, scoped, tested and had ZERO callers). Carried on the RESPONSE and
      // not in the KV session value, for the same reason `permissions` is: the
      // session is written once and lives seven days, so a flag snapshotted into it
      // would stay true after the user changed their password.
      mustChangePassword,
    },
  });
});

/**
 * Stamp the acceptance and alert the workspace's administrators. Non-fatal by
 * construction — `emitNotification` swallows its own failures, and the stamp is
 * written first so a login can never alert twice even if the emit is retried.
 */
async function recordInviteAccepted(env: Env, user: UserRow): Promise<void> {
  const at = new Date().toISOString();
  // `tenant_id` is in the predicate although `id` alone is unique. It costs
  // nothing, and it is the shape every one of the 211 widened predicates takes —
  // the one place a reader of this file will look for the example.
  const res = await env.DB.prepare(
    "UPDATE users SET invite_accepted_at = ? WHERE id = ? AND tenant_id = ? AND invite_accepted_at IS NULL",
  )
    .bind(at, user.id, user.tenant_id)
    .run();
  // Lost the race with a concurrent first login — the other one alerts.
  if (res.meta.changes !== 1) return;

  await emitNotification(env, {
    event: "invite_accepted",
    // ── §5.7, ONE OF TWO LEAKS THAT LEAVE THE BUILDING ──────────────────────
    // This emitter passed `edition` and no `scope`, and it names no `deckId`, so it
    // was one of exactly two of the ten producers that fall all the way through
    // `outbox.ts:216-231`'s resolution order to `DEFAULT_TENANT_ID`. The effect,
    // observed firing live in the dev log: a second customer's new employee — name
    // and email address, both in the body below — written into and mailed FROM the
    // FIRST customer's workspace. Not a screen somebody has to open; mail, already
    // sent, to the wrong company's administrators.
    //
    // The account that just signed in is the only correct answer. Built from the
    // ROW's two columns rather than from a `SessionUser`, which is what
    // `TenantPrincipal` exists for — `src/shared/tenant.ts`: "any row carrying the
    // two columns ... lets a cron job or a queue consumer build a scope from the row
    // it is processing". `edition` stays as its own field because
    // `NotificationInput` still takes it.
    scope: scopeOf({ tenantId: user.tenant_id, edition: user.edition }),
    edition: user.edition,
    title: `${user.name} accepted their invite`,
    body:
      `${user.name} (${user.email}) signed in for the first time as ` +
      `${roleLabel(user.edition, user.role)}.`,
    link: "/app/admin",
    actorId: user.id,
    dedupeKey: `invite_accepted:${user.id}`,
  });
}

auth.post("/logout", async (c) => {
  await deleteSession(c.env.SESSIONS, getCookie(c, SESSION_COOKIE));
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

/** GET /api/auth/me — the signed-in principal.
 *
 *  The session value in KV is written once at login, so the alias title is
 *  re-read from D1 here: editing it under My account (or having an admin edit
 *  it) then shows up on the next load rather than after a re-login. */
auth.get("/me", requireAuth, async (c) => {
  const session = c.var.user;
  // W3-A — the granted task ids ride along here rather than in the KV session
  // value, which is written once at login and lives seven days. An
  // administrator's edit to the Task permissions grid therefore takes effect on
  // this user's next page load, not on their next sign-in.
  const permissions = await c.var.perms.granted();
  // `must_change_password` rides along on this read, which already existed — §5.2
  // calls the whole fix "nearly free, because `auth.ts` already does a per-request
  // read of that row", and this is that. The client needs it on every load and not
  // only at login: the sign-in response is gone by the time a reload happens, and
  // the KV session value is a seven-day snapshot that would still say `true` after
  // the password had been changed.
  const row = await c.env.DB
    .prepare(
      "SELECT title, name, initials, tenant_id, must_change_password FROM users WHERE id = ? AND tenant_id = ?",
    )
    .bind(session.id, session.tenantId)
    .first<{
      title: string | null;
      name: string;
      initials: string;
      tenant_id: string;
      must_change_password: number;
    }>();
  // Scoped by `tenant_id` as well as `id` even though `id` is globally unique: it
  // costs nothing and it means a session whose tenant has drifted from the row —
  // the seven-day KV snapshot §6 notes has no invalidation path — reads nothing
  // rather than refreshing itself from another customer's row.
  //
  // When the row is unreadable `mustChangePassword` is reported FALSE rather than
  // omitted: a client that forces a password change on a truthy flag must not be put
  // into that loop by a failed read, and the session is about to be refused by
  // something else anyway.
  if (!row) return c.json({ user: { ...session, permissions, mustChangePassword: false } });
  return c.json({
    user: {
      ...session,
      name: row.name,
      initials: row.initials,
      ...(row.title ? { title: row.title } : { title: undefined }),
      permissions,
      mustChangePassword: row.must_change_password === 1,
    },
  });
});

export default auth;
