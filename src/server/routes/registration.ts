/**
 * THE THREE PUBLIC AUTH ROUTES: REGISTER, FORGOT PASSWORD, RESET PASSWORD
 * =======================================================================
 *
 * Mounted on `/api/auth` alongside `routes/auth.ts`, which keeps `login`, `logout`
 * and `me`. A separate file rather than three more handlers in that one because
 * these three are UNAUTHENTICATED and that is the property a reader needs to see
 * first: before this lane the resubmit loop was the only public POST in the product
 * (`src/server/routes/resubmit.ts`), and `plan_pilot_gcw.md` §6 calls a public POST
 * without a rate limiter "a free account-creation faucet from the conference wifi".
 * Every route here is behind `src/server/middleware/rateLimit.ts`, mounted in
 * `src/server/index.ts`.
 *
 * ── REGISTRATION JOINS AN ORGANISATION. IT NEVER CREATES ONE ────────────────
 *
 * `migrations/0106_registration.sql` §1 has the measurement: a public route that
 * creates an organisation also writes `account_profiles`, which is PK
 * `(tenant_id, edition)` (`0094:96`), so the second person through the wizard
 * overwrites the first one's commercial record including the V6 billing address
 * that decides the billing currency (`0104`). So the tenant is RESOLVED from the
 * email domain, server-side, and **never from the request body** — which is also
 * the invariant `scopeOf` exists to protect (`src/shared/tenant.ts`: "it takes the
 * principal, never a request parameter"). A registrant cannot name a workspace, an
 * edition or a role.
 *
 * ── WHAT A REGISTRANT GETS, AND WHY IT IS THE LOWEST ROLE ───────────────────
 *
 * `active = 0`, `approval_state = 'pending'`, `role = 'jury'`. §7 Q4 measured why
 * the role cannot be anything else by default: a self-registered **program
 * associate** reads every startup's name, sector, city, founder name, founder email
 * and AI score, because `decks.ts:558` narrows to own-decks for `jury` ALONE. An
 * administrator sets the real role when approving, which is the same shape §7 Q4
 * asks for — "role chosen by the GCW admin, never from the registrant".
 *
 * The domain allowlist alone would not be enough and §6 says which half carries the
 * weight: "with no email verification, a stranger typing `anyone@gcw.org` would
 * otherwise be inside". The approval gate is the load-bearing half; the domain gate
 * only keeps the queue to one company's own people.
 *
 * ── THE ONE RESPONSE THAT IS NOT WHAT IT LOOKS LIKE ─────────────────────────
 *
 * A duplicate address returns the SAME 202 as a fresh registration and creates
 * nothing. See `DUPLICATE_IS_NOT_AN_ORACLE` below — the decision is written out
 * there because it is the one place in this file where the obvious answer (409
 * `email_taken`) is the wrong one.
 */
import { Hono } from "hono";
import type { AppEnv, Env } from "../types";
import type { Edition } from "../../shared/roles";
import { hashPassword } from "../auth/password";
import { isEmail, isWorkEmail } from "../../shared/accountOrder";
import { shortActorName } from "../../shared/audit";
import type { AuditCategory } from "../../shared/audit";
import {
  insertScope,
  scopeOf,
  scoped,
  type TenantScope,
} from "../../shared/tenant";
// The resubmit loop's token generator and hash, reused verbatim. 192 bits of
// CSPRNG entropy, base64url, and only the SHA-256 hash is ever stored — see the
// header of `src/server/resubmit.ts` for why unsalted is correct here (the token IS
// the entropy, and the lookup has to be `WHERE token_hash = ?`).
import { newResubmitToken, hashToken } from "../resubmit";
import { sendEmail, emailDeliveryConfigured } from "../email/outbox";

const registration = new Hono<AppEnv>();

/**
 * The same minimum `PUT /api/users/me/password` enforces (`users.ts:518`), and the
 * same one the client's own spec prints — `docs/PARITY-BUILD-SPEC.md:149-166`:
 * "password (min. 8 characters)".
 *
 * Exported and defined here rather than imported because `MIN_PASSWORD` in
 * `routes/users.ts` is a module-private `const` and that file belongs to another
 * lane. Two definitions of one number is exactly the drift class this repo has been
 * bitten by (four low-credit thresholds; an AI gate threshold configured, saved and
 * ignored), so this is a stop-gap and not a design: the integration note at the foot
 * of this file asks for one shared constant and for `users.ts` to import it.
 */
export const MIN_PASSWORD = 8;

/** How long a password reset link lives. Minutes-to-an-hour work, not a month. */
export const PASSWORD_RESET_TTL_MINUTES = 60;

/**
 * `accountOrder.ts`'s own field cap, restated because that module keeps it private.
 * Same number, so a name the three-step UI accepts is a name this route accepts.
 */
const MAX_FIELD = 120;

/**
 * The client path the reset email links to, and the shape it carries the token in.
 *
 * **A QUERY PARAMETER, not a path segment**, which is the opposite of the founder
 * resubmit link (`/resubmit/:token`). The client's screen is registered as
 * `<Route path="/reset-password">` with no `:token` segment and reads
 * `useSearchParams().get("token")`, so `/reset-password/<token>` would fall through to
 * the SPA catch-all and the page would report "no token in the URL". The email link is
 * the ONE place the two halves of this feature meet and neither side can see the
 * other's code, so the shape is written down here rather than assumed.
 */
const RESET_PATH = "/reset-password";

function resetLink(env: Env, token: string): string {
  // `encodeURIComponent` is a no-op on `newResubmitToken`'s base64url alphabet
  // (`A-Za-z0-9-_`), and is applied anyway so this does not quietly break if the
  // generator's alphabet ever changes.
  return `${appBase(env)}${RESET_PATH}?token=${encodeURIComponent(token)}`;
}

// ── Small helpers ───────────────────────────────────────────────────────────

/**
 * Narrowing, not a cast. `organizations.default_edition` is TEXT and carries no
 * CHECK (`0106` §3 explains why `ALTER TABLE ADD COLUMN` cannot give it one that
 * means anything), so the value is validated where it is read.
 */
function isEdition(value: unknown): value is Edition {
  return value === "incubator" || value === "vc";
}

/**
 * Two-letter initials. Same rule as `users.ts:101 initialsFrom`, which is private
 * to that file; `users.initials` is NOT NULL so a public insert needs it. Kept
 * character-for-character identical so a self-registered account and an invited one
 * render the same avatar.
 */
function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase() || "?";
}

/** Trim to a stored value, or null. */
function optional(value: unknown): string | null {
  const s = typeof value === "string" ? value.trim() : "";
  return s === "" || s.length > MAX_FIELD ? null : s;
}

/** The domain half of an address, lower-case. Empty when there isn't one. */
function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1);
}

/** `APP_BASE_URL`, trailing slashes removed. Mirrors `resubmitLink`'s resolution. */
function appBase(env: Env): string {
  return (env.APP_BASE_URL || "https://startup-jury.jay-komarraju.workers.dev").replace(/\/+$/, "");
}

/**
 * An audit row with no authenticated actor.
 *
 * `recordAudit` (`audit/log.ts:112`) takes the Hono context and reads `c.var.user`,
 * which is right for the ~30 mutating routes that have a session and impossible
 * here: these three routes run before anybody is authenticated. The honest answers
 * were (a) skip the audit, (b) fake a principal by `c.set("user", …)`, or (c) write
 * the row. (a) loses the only record that a stranger tried to join a workspace,
 * which is the one thing an administrator will want to see after the live call. (b)
 * would put a forged session on the context for every later middleware to read, and
 * `c.var.user` means "the authenticated principal" everywhere else in this codebase.
 * So (c), with `recordAudit`'s own three properties preserved deliberately:
 *
 *   · `insertScope(scope)` supplies `tenant_id, edition` as one column list with its
 *     own binds, so the column cannot be named without the value. That is the
 *     mistake that filed every audit row in the product against `t_default` before
 *     T1-REPORTS, and a trail is the one table where a misfiled row is also a FALSE
 *     ACCUSATION.
 *   · The write NEVER fails its caller. An account has already been created when
 *     this runs; 500-ing a successful registration because the trail hiccuped would
 *     be the worse failure, and `audit/log.ts`'s header makes the same trade.
 *   · `actor_label` is denormalised so the row stays readable after the user it
 *     names is deleted (`0030`).
 *
 * `actorId` is the row that ACTED where there is one — a registrant is the actor of
 * their own sign-up — and NULL where there is not (a duplicate attempt was not made
 * by the person who already holds the address). `audit_log.actor_id` is nullable
 * (`0030:25`), so NULL is a representable "we do not know who", not a gap.
 */
async function recordPublicAudit(
  env: Env,
  scope: TenantScope,
  entry: {
    category: AuditCategory;
    action: string;
    summary: string;
    actorId: string | null;
    actorLabel: string;
    detail?: unknown;
    targetType?: string;
    targetId?: string;
  },
): Promise<void> {
  const t = insertScope(scope);
  try {
    await env.DB.prepare(
      `INSERT INTO audit_log (id, ${t.columns}, category, actor_id, actor_label, action, summary, detail_json, target_type, target_id) ` +
        `VALUES (?, ${t.placeholders}, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        `aud_${crypto.randomUUID()}`,
        ...t.binds,
        entry.category,
        entry.actorId,
        shortActorName(entry.actorLabel),
        entry.action,
        entry.summary,
        entry.detail === undefined ? null : JSON.stringify(entry.detail),
        entry.targetType ?? null,
        entry.targetId ?? null,
      )
      .run();
  } catch (err) {
    console.error("public audit write failed:", err);
  }
}

// ── POST /api/auth/register ─────────────────────────────────────────────────

interface RegisterBody {
  name?: unknown;
  email?: unknown;
  password?: unknown;
  /**
   * The alias title (`users.title`). The three-step sign-up UI calls this field
   * **Designation** and sends it under that name, so both spellings are read — the
   * client sends `{ email, password, firstName, lastName, name, designation? }` and
   * dropping its one optional field because of a key name would be a silent loss on
   * a form the registrant filled in. Any extra keys are ignored: `name` is the one
   * display string `users.name` holds, and the client composes it from its two parts
   * rather than leaving the server to guess at the order.
   */
  title?: unknown;
  designation?: unknown;
}

/** The organisation a domain resolves to. Its own read — `OrganizationRow` in
 *  `db.ts` predates `0106` and has neither new column, and `db.ts` is another
 *  lane's file. */
interface ClaimingOrg {
  id: string;
  name: string;
  status: string;
  default_edition: string;
}

/**
 * ── WHY A DUPLICATE ADDRESS GETS THE SAME 202 AS A FRESH SIGN-UP ────────────
 *
 * The obvious answer is `409 email_taken`, which is what `POST /api/users` returns
 * (`users.ts:341`) — and there it is right, because the caller is an authenticated
 * administrator of the workspace asking whether a seat is free. Here the caller is
 * anonymous, and a 409 would turn this route into a membership oracle for one named
 * company: "does `firstname.lastname@globalcarbonwarriors.com` work here?", answered
 * for anybody who can guess a name. §5's whole enumeration thread is about exactly
 * that, and `users.ts:324-336` already records the same reasoning for why the
 * *global* form of this check was removed.
 *
 * So the response does not vary. The same 202, the same body, and nothing written.
 * The wording is chosen to be TRUE in all three states it covers — just created,
 * already pending, already active — so it is not a lie told for safety:
 *
 *   "Thanks — we've passed this to your organisation's administrator. If you
 *    already have an account, sign in instead, or use Forgot password."
 *
 * The signal still reaches the person entitled to it. A `registration_duplicate`
 * audit row goes into the workspace's own trail, where the authenticated
 * administrator reading Admin → Audit can see it and the anonymous caller cannot.
 * That is the right asymmetry: the information is not suppressed, it is addressed.
 *
 * The cost, stated plainly: a colleague who registered twice is told "awaiting
 * approval" when they in fact already have a working account. The body's second
 * sentence is what covers that, and the alternative — telling an anonymous caller
 * which addresses are real — is worse.
 */
const DUPLICATE_IS_NOT_AN_ORACLE = {
  status: "pending_approval",
  message:
    "Thanks — we've passed this to your organisation's administrator. " +
    "If you already have an account, sign in instead, or use Forgot password.",
} as const;

registration.post("/register", async (c) => {
  const body = await c.req.json<RegisterBody>().catch(() => null);

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || name.length > MAX_FIELD) return c.json({ error: "name_required" }, 400);

  // EVERY write of an address is `.trim().toLowerCase()`. `users.email` is UNIQUE
  // per tenant after `0087` with **no COLLATE NOCASE**, and login compares with a
  // plain `=` on the raw body value — measured case-sensitive. An address stored
  // with a capital letter registers fine and then cannot sign in.
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!isEmail(email)) return c.json({ error: "invalid_email" }, 400);
  if (!isWorkEmail(email)) {
    // `accountOrder.ts:249-278`'s 16 free-mail domains, which is the client's own
    // stated rule ("Personal email addresses are not accepted") and therefore needs
    // no new decision here. Worth telling GCW: a colleague with a `@gmail.com`
    // address cannot self-register at all and must be invited by an administrator.
    return c.json(
      { error: "personal_email", message: "Personal email addresses are not accepted." },
      400,
    );
  }

  const password = typeof body?.password === "string" ? body.password : "";
  if (password.length < MIN_PASSWORD) return c.json({ error: "password_too_short" }, 400);

  // ── The tenant, resolved from the address and from nowhere else ───────────
  // `lower()` on both sides: `0106` stores the claim lower-case and asserts it, and
  // the comparison says so rather than relying on the assertion having run.
  const org = await c.env.DB.prepare(
    "SELECT id, name, status, default_edition FROM organizations WHERE lower(email_domain) = ?",
  )
    .bind(domainOf(email))
    .first<ClaimingOrg>();

  // FAIL CLOSED, in §6's own words: "ask your administrator for an invite".
  //
  // A SUSPENDED organisation gets this identical refusal rather than one of its own.
  // `0083:109` is explicit that suspended means "rows retained, sign-in refused" —
  // an offboarding state — and telling an anonymous caller that a named company's
  // account is suspended discloses a commercial fact to someone who has proved
  // nothing. 'trial' is an APPROVED state (`0083:107`) and registers normally.
  if (!org || org.status === "suspended") {
    return c.json(
      {
        error: "no_workspace_for_domain",
        message:
          "We don't have a workspace for that email domain yet. " +
          "Ask your administrator to send you an invite.",
      },
      403,
    );
  }

  if (!isEdition(org.default_edition)) {
    // A data defect, not a caller mistake, so it surfaces as a 500 rather than as a
    // refusal the registrant could act on. Guessing an edition here would put a
    // stranger in a workspace the organisation did not choose.
    console.error(
      `registration: organizations.default_edition is ${JSON.stringify(org.default_edition)} ` +
        `for ${org.id} — not a real edition, so no workspace can be resolved`,
    );
    return c.json({ error: "workspace_misconfigured" }, 500);
  }

  const scope = scopeOf({ tenantId: org.id, edition: org.default_edition });

  // ── Already taken? ────────────────────────────────────────────────────────
  // Scoped to the TENANT, not to the workspace. `0087`'s constraint is
  // `UNIQUE (tenant_id, email)` and does NOT include `edition`, so a collision can
  // come from the organisation's OTHER edition — and a workspace-scoped check would
  // miss it and then hit the index on the INSERT. `onTenantOnly` is the predicate
  // that matches the constraint.
  const taken = scoped(scope).onTenantOnly("u").and("u.email = ?", email);
  const existing = await c.env.DB.prepare(`SELECT u.id, u.name FROM users u ${taken.whereClause()}`)
    .bind(...taken.binds)
    .first<{ id: string; name: string }>();

  if (existing) {
    await recordPublicAudit(c.env, scope, {
      category: "security",
      action: "registration_duplicate",
      summary: `A sign-up was attempted for ${email}, which already has an account`,
      // Not the existing user: they did not do this. See `recordPublicAudit`.
      actorId: null,
      actorLabel: "Sign-up",
      targetType: "user",
      targetId: existing.id,
    });
    return c.json(DUPLICATE_IS_NOT_AN_ORACLE, 202);
  }

  const id = `usr_${crypto.randomUUID().slice(0, 8)}`;
  const t = insertScope(scope);
  try {
    await c.env.DB.prepare(
      `INSERT INTO users (id, ${t.columns}, name, email, password_hash, role, initials, active, user_type, title, approval_state, must_change_password) ` +
        // `role` is the literal 'jury' and `approval_state` the literal 'pending' —
        // neither is bound, because neither may ever come from a request. `active = 0`
        // is what refuses the login until an administrator approves.
        // `must_change_password = 0`: they chose this password themselves, so the
        // console's User access column must not call it "Temporary".
        `VALUES (?, ${t.placeholders}, ?, ?, ?, 'jury', ?, 0, 'staff', ?, 'pending', 0)`,
    )
      .bind(
        id,
        ...t.binds,
        name,
        email,
        await hashPassword(password),
        initialsFrom(name),
        optional(body?.title) ?? optional(body?.designation),
      )
      .run();
  } catch (err) {
    // The one expected failure is `UNIQUE (tenant_id, email)` losing a race with a
    // concurrent registration of the same address — the check above is not a lock.
    // Answer it exactly as the checked duplicate is answered, so the race does not
    // become the oracle the check avoided.
    const taken2 = scoped(scope).onTenantOnly("u").and("u.email = ?", email);
    const now = await c.env.DB.prepare(`SELECT u.id FROM users u ${taken2.whereClause()}`)
      .bind(...taken2.binds)
      .first<{ id: string }>();
    if (now) return c.json(DUPLICATE_IS_NOT_AN_ORACLE, 202);
    throw err;
  }

  await recordPublicAudit(c.env, scope, {
    category: "security",
    action: "registration_pending",
    summary: `${name} (${email}) signed up and is awaiting approval`,
    // The registrant IS the actor of their own sign-up, and the row now exists for
    // `audit_log.actor_id`'s foreign key to reference.
    actorId: id,
    actorLabel: name,
    detail: { domain: domainOf(email), role: "jury", approvalState: "pending" },
    targetType: "user",
    targetId: id,
  });

  // 202, not 201: the account exists but nothing has been granted yet, and there is
  // deliberately NO session — a `pending` principal must not hold a cookie.
  return c.json(DUPLICATE_IS_NOT_AN_ORACLE, 202);
});

// ── POST /api/auth/forgot-password ──────────────────────────────────────────

/**
 * Always 202, whatever happened.
 *
 * The response does not reveal whether the address exists, and the route does the
 * same amount of visible work either way. One address may hold accounts at two
 * customers after `0087` (§7 Q4: "two customers employing the same person is not an
 * edge case; it is the second customer"), so this mints one token per account and
 * sends one email per account — each link opens exactly one workspace. Nothing in
 * the response says how many there were.
 *
 * ── IT SHIPS BEHIND THE EXISTING EMAIL GATE, AND STILL WRITES THE TOKEN ─────
 *
 * `EMAIL_FROM` is `""` in `wrangler.jsonc`, so `emailDeliveryConfigured`
 * (`outbox.ts:257-259`) is false and `sendEmail` records every message with
 * `status='recorded'` and dispatches nothing. The token is minted and stored anyway:
 *
 *   · the moment the sending domain is onboarded this route starts working with no
 *     code change, which is the whole point of the gate;
 *   · the `email_outbox` row is a real audit record of the request;
 *   · and the operator-visible fallback is unchanged and already working —
 *     `POST /api/users/:id/reset-password` returns the temporary password in its
 *     response whenever the mail could not be delivered (`users.ts:750`), so an
 *     administrator can always get a colleague back in.
 *
 * What this route must never do is return the token or the link to the caller. That
 * would be an unauthenticated account-takeover endpoint, and no amount of "it is
 * only for the demo" makes it otherwise. `emailDeliveryConfigured` is read only to
 * SAY SO in the log, never to change the response.
 */
registration.post("/forgot-password", async (c) => {
  const body = await c.req.json<{ email?: unknown }>().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";

  const accepted = { status: "sent", message: "If that address has an account, a reset link is on its way." };
  if (!isEmail(email)) return c.json(accepted, 202);

  // Only accounts that could actually sign in. Resetting the password of a pending
  // or deactivated account achieves nothing — login refuses it either way — and
  // minting a live credential for an account somebody deliberately switched off is
  // the wrong direction to fail in.
  const { results } = await c.env.DB.prepare(
    "SELECT id, tenant_id, name, email, edition FROM users " +
      "WHERE email = ? AND deleted_at IS NULL AND active = 1 AND approval_state = 'approved'",
  )
    .bind(email)
    .all<{ id: string; tenant_id: string; name: string; email: string; edition: string }>();

  if (!emailDeliveryConfigured(c.env) && results.length > 0) {
    console.warn(
      `forgot-password: ${results.length} reset token(s) minted for an address, but EMAIL_FROM ` +
        "is unset so nothing was dispatched — the admin-mediated reset " +
        "(POST /api/users/:id/reset-password) is the working path until the sending domain is onboarded.",
    );
  }

  const nowMs = Date.now();
  for (const row of results) {
    if (!isEdition(row.edition)) {
      // `users.edition` carries a CHECK (`0087:326`), so this cannot happen — and if
      // it does, refusing to mint is better than guessing a workspace for a credential.
      console.error(`forgot-password: user ${row.id} has edition ${JSON.stringify(row.edition)}`);
      continue;
    }
    const scope = scopeOf({ tenantId: row.tenant_id, edition: row.edition });
    const token = newResubmitToken();
    const expiresAt = new Date(nowMs + PASSWORD_RESET_TTL_MINUTES * 60 * 1000).toISOString();

    // One batch, which D1 runs as a transaction: the supersede and the mint land
    // together or not at all. Minting a new link must retire the previous one — a
    // stale link in an older email is a second live key to the account — and
    // `used_at` is what this table uses to mean "no longer redeemable"
    // (`0106` §5 explains why it has no separate `revoked` column).
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND tenant_id = ? AND used_at IS NULL",
      ).bind(new Date(nowMs).toISOString(), row.id, scope.tenantId),
      c.env.DB.prepare(
        // `tenant_id` is bound explicitly and the column has NO default (`0106`), so
        // a forgotten bind here is a loud error rather than a credential filed
        // against the first customer.
        "INSERT INTO password_reset_tokens (id, tenant_id, user_id, token_hash, created_at, expires_at) " +
          "VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(
        `prt_${crypto.randomUUID()}`,
        scope.tenantId,
        row.id,
        // Only the hash. A database leak cannot be replayed as a working link.
        await hashToken(token),
        new Date(nowMs).toISOString(),
        expiresAt,
      ),
    ]);

    const link = resetLink(c.env, token);
    const text =
      `Hi ${row.name},\n\n` +
      "Someone asked to reset the password for your ai.STARTUPJURY account. " +
      "If that was you, open the link below and choose a new one:\n\n" +
      `  ${link}\n\n` +
      `This link works once and expires in ${PASSWORD_RESET_TTL_MINUTES} minutes.\n\n` +
      "If it wasn't you, you can ignore this email — nothing has changed.\n\n" +
      "— The ai.STARTUPJURY team";

    try {
      await sendEmail(c.env, {
        // ── A BORROWED KIND, AND THE REASON ─────────────────────────────────
        // `EmailKind` is a CLOSED UNION in `src/server/email/outbox.ts:76-84`, which
        // this lane does not own, so `password_reset` could not be added without
        // editing another lane's file — and a cast to get past the union is exactly
        // what the brief forbids. `account_invite` is the closest honest kind: it is
        // the one whose purpose is "here is how you get into your account", and the
        // ADMIN-mediated reset already reuses it for precisely this message
        // (`users.ts:733` → `deliverInvite` → `kind: "account_invite"`). So this
        // follows existing practice rather than inventing a worse one. The
        // integration note at the foot of this file asks for the real kind.
        kind: "account_invite",
        // Named, never defaulted. Without it `outbox.ts:216-231` falls back to
        // `t_default` and files one customer's reset request in another's workspace.
        scope,
        toEmail: row.email,
        toName: row.name,
        subject: "Reset your ai.STARTUPJURY password",
        body: text,
        // The outbox is a durable audit log and the link is a credential. Same rule
        // `deliverInvite` applies to a temporary password (`users.ts:172`).
        auditBody: text.replace(link, `${appBase(c.env)}${RESET_PATH}?token=[redacted]`),
      });
    } catch (err) {
      // `sendEmail` swallows delivery failures; only the outbox write can throw. The
      // token is already committed, so a failed audit must not turn a successful
      // request into a 500 — and the response is fixed anyway.
      console.error("forgot-password: reset email could not be recorded:", err);
    }

    await recordPublicAudit(c.env, scope, {
      category: "security",
      action: "password_reset_requested",
      summary: `A password reset link was requested for ${row.email}`,
      // The account holder may not be the requester — that is the whole point of
      // the "if it wasn't you" line in the email — so the actor is unknown.
      actorId: null,
      actorLabel: "Password reset",
      detail: { expiresAt },
      targetType: "user",
      targetId: row.id,
    });
  }

  return c.json(accepted, 202);
});

// ── POST /api/auth/reset-password ───────────────────────────────────────────

/**
 * Redeem a reset link. Single use, expiring, and scoped to the token's own
 * workspace.
 *
 * The lookup is by `token_hash` with NO tenant predicate, which matches the index:
 * `token_hash` is GLOBALLY unique (`0106`, following `0085`'s reasoning for
 * `resubmit_tokens` — scoping a bearer credential's hash per tenant would make a
 * stolen token valid in a second workspace). The workspace then comes out of the
 * STORED ROW, exactly as `resubmit.ts`'s `tokenScope` does for the founder link:
 * "the token is resolved server-side by hash and the caller cannot name a tenant."
 */
registration.post("/reset-password", async (c) => {
  const body = await c.req.json<{ token?: unknown; password?: unknown }>().catch(() => null);
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!token) return c.json({ error: "invalid_token" }, 400);
  if (password.length < MIN_PASSWORD) return c.json({ error: "password_too_short" }, 400);

  const row = await c.env.DB.prepare(
    "SELECT id, tenant_id, user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = ?",
  )
    .bind(await hashToken(token))
    .first<{ id: string; tenant_id: string; user_id: string; expires_at: string; used_at: string | null }>();

  if (!row) return c.json({ error: "invalid_token" }, 400);
  if (row.used_at !== null) return c.json({ error: "token_used" }, 400);
  if (Date.parse(row.expires_at) <= Date.now()) return c.json({ error: "token_expired" }, 400);

  // The user is loaded WITHIN the token's workspace, so a token that somehow named
  // the wrong tenant opens nothing rather than opening somebody else's account —
  // the same closed end `resubmit.ts` describes for the founder link.
  const target = await c.env.DB.prepare(
    "SELECT id, name, email, edition FROM users WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL",
  )
    .bind(row.user_id, row.tenant_id)
    .first<{ id: string; name: string; email: string; edition: string }>();
  if (!target || !isEdition(target.edition)) return c.json({ error: "invalid_token" }, 400);

  const scope = scopeOf({ tenantId: row.tenant_id, edition: target.edition });

  // ── CLAIM THE TOKEN BEFORE WRITING THE PASSWORD, NOT AFTER ───────────────
  // `WHERE used_at IS NULL` makes the stamp the lock: of two concurrent redemptions
  // exactly one reports `changes === 1`. Doing it in this order means the loser
  // cannot also set a password — if the password were written first, both callers
  // would set one and the last writer would silently win, which is an
  // account-takeover race rather than a tidiness problem.
  const claim = await c.env.DB.prepare(
    "UPDATE password_reset_tokens SET used_at = ? WHERE id = ? AND tenant_id = ? AND used_at IS NULL",
  )
    .bind(new Date().toISOString(), row.id, row.tenant_id)
    .run();
  if (claim.meta.changes !== 1) return c.json({ error: "token_used" }, 400);

  const write = scoped(scope).on("users").and("users.id = ?", target.id);
  await c.env.DB.prepare(
    // `must_change_password = 0`: the user just chose this one. The flag means "the
    // system issued this credential", and leaving it set would have the console's
    // User access section report "Temporary — not yet changed" forever
    // (`users.ts:511-516` records that this is what the column is for).
    `UPDATE users SET password_hash = ?, must_change_password = 0 ${write.whereClause()}`,
  )
    .bind(await hashPassword(password), ...write.binds)
    .run();

  await recordPublicAudit(c.env, scope, {
    category: "security",
    action: "password_reset_completed",
    summary: `${target.name} reset their password through a reset link`,
    // Here the actor IS known: redeeming the link proves possession of it.
    actorId: target.id,
    actorLabel: target.name,
    targetType: "user",
    targetId: target.id,
  });

  // No session is created. The user signs in with the password they just chose,
  // which is one more proof that the reset worked and keeps this route from being a
  // way to obtain a cookie.
  return c.json({ ok: true });
});

export default registration;

// ── INTEGRATION NOTES ───────────────────────────────────────────────────────
//
// Four things want a line in a file this lane does not own:
//
//   1. **`EmailKind` needs `"password_reset"`** — `src/server/email/outbox.ts:76-84`.
//      Until then the reset email is recorded as `account_invite`, which is what the
//      admin-mediated reset already does, so the outbox cannot distinguish the two.
//      One union member and one line in this file's `sendEmail` call.
//   2. **The reset link's shape is a two-lane contract.** The email built above points
//      at `/reset-password?token=…` because that is what the client screen reads
//      (`useSearchParams().get("token")` on a `<Route path="/reset-password">` with no
//      `:token` segment). If the client ever moves to a path segment, `RESET_PATH` and
//      `resetLink` above are the one place to change — and
//      `test/worker/registration.test.ts` asserts the emitted shape so the two cannot
//      drift silently.
//   3. **`MIN_PASSWORD` should live once.** `routes/users.ts:518` has a private copy
//      and this file has a second. Move it to `src/shared/` and have both import it.
//   4. **A pending registration should notify the administrators.**
//      `emitNotification` only takes a `NotificationEvent`, and that is a closed list
//      in `src/shared/notifications.ts` with no member for this. Until one exists the
//      `registration_pending` audit row is the only signal, so the approval screen
//      has to be somewhere an administrator looks.
