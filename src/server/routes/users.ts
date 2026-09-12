// Session 4 — User management (the Admin console's "Team & roles" surface).
//
// Super User / Admin (and, by the requireRole superuser bypass, the Managing
// Partner) create and manage the org's users: jurors, staff and MENTORS. Every
// endpoint is edition-scoped to the caller — you manage your own workspace only.
//
// Mentor is a USER-TYPE, not an authorization role (see migrations/0015): a
// mentor row carries user_type='mentor' + role='mentor' (no pipeline/nav power).
// Ordinary team members are user_type='staff' with a real edition role.
//
// New users get a generated TEMPORARY PASSWORD. Session 8 makes that an actual
// EMAIL (`buildAccountInviteEmail`) rather than a value the admin copies off the
// screen — but only when the Worker can genuinely deliver mail. See
// `deliverInvite` below: if the sending domain isn't onboarded, emailing the
// credential would silently strand the new account, so the response still
// carries the password and the console tells the admin to relay it. Setting
// `vars.EMAIL_FROM` flips the whole thing over with no further code change.

import { Hono } from "hono";
import type { Context } from "hono";
import { getCookie, deleteCookie } from "hono/cookie";
import type { AppEnv, Env } from "../types";
import type { Edition, Role } from "../../shared/roles";
import { creatableStaffRoles, roleLabel } from "../../shared/roles";
import { PERMISSION_ROLES } from "../../shared/types";
import { can } from "../../shared/permissions";
import { loadEditionOverrides } from "../auth/permissions";
import { requireAuth, requireTask } from "../auth/middleware";
// Ownership transfer ends the outgoing owner's session rather than leaving a
// superuser token valid for another seven days — see the route.
import { deleteSession, SESSION_COOKIE } from "../auth/session";
// W3-C — F0053. Invites, deactivations and role changes left no reviewable
// record outside `email_outbox`, which has no read route and no screen.
import { auditUserInvited, auditUserUpdated } from "../audit/events";
// W4-A — the three verbs below have no writer in `audit/events.ts` (W3-C's
// file, which this session does not own), so they call the generic store
// directly. Same table, same shape, same sentence voice.
import { recordAudit } from "../audit/log";
import { hashPassword, verifyPassword } from "../auth/password";
import { getUserByEmail } from "../db";
import {
  buildAccountInviteEmail,
  emailDeliveryConfigured,
  sendEmail,
  type SentEmail,
} from "../email/outbox";
import { orgName } from "../resubmit";

const users = new Hono<AppEnv>();
users.use("*", requireAuth);

interface UserRosterRow {
  id: string;
  name: string;
  email: string;
  role: string;
  initials: string;
  active: number;
  user_type: string;
  created_at: string;
  title?: string | null;
  // W4-A (0044 / 0041) — the invite lifecycle and the credential state the
  // console's Team & roles and User access sections render.
  invite_sent_at?: string | null;
  invite_accepted_at?: string | null;
  must_change_password?: number | null;
}

/** Every column the roster and the two console sections read. One place, so a
 *  new column cannot be added to one query and forgotten in the other three. */
const ROSTER_COLUMNS =
  "id, name, email, role, initials, active, user_type, created_at, title, " +
  "invite_sent_at, invite_accepted_at, must_change_password";

async function readBody<T>(c: Context<AppEnv>): Promise<Partial<T>> {
  return (await c.req.json().catch(() => ({}))) as Partial<T>;
}

/** Two-letter initials from a display name (first + last word). */
function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase() || "?";
}

/** A short, readable temporary password (not shown anywhere else). */
function tempPassword(): string {
  // e.g. "aisj-3f9a2c" — easy to relay, replaced by the user on first login.
  return `aisj-${crypto.randomUUID().replace(/-/g, "").slice(0, 6)}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Sign-in URL for the invite. Mirrors `resubmitLink`'s base resolution. */
function loginUrl(env: Env): string {
  const base = (env.APP_BASE_URL || "https://startup-jury.jay-komarraju.workers.dev").replace(
    /\/+$/,
    "",
  );
  return `${base}/login`;
}

/**
 * Email the new account its temporary password, and report whether the credential
 * actually left the building.
 *
 * `delivered` is driven by the outbox's real `status`, not merely by
 * configuration: an accepted send ('sent') is the only case where it is safe to
 * withhold the password from the admin. A 'recorded' (no domain onboarded) or
 * 'failed' send keeps the old relay-it-yourself behaviour, so a new user can
 * never be locked out by a transport problem. A send is attempted whenever
 * delivery is configured — the audit row is written either way.
 */
async function deliverInvite(
  env: Env,
  args: {
    edition: Edition;
    name: string;
    email: string;
    roleLabel: string;
    tempPassword: string;
    invitedByName: string;
  },
): Promise<{ delivered: boolean; status: SentEmail["status"] | "skipped" }> {
  if (!emailDeliveryConfigured(env)) return { delivered: false, status: "skipped" };

  const invite = buildAccountInviteEmail({
    name: args.name,
    roleLabel: args.roleLabel,
    tempPassword: args.tempPassword,
    loginUrl: loginUrl(env),
    orgName: await orgName(env, args.edition),
    invitedByName: args.invitedByName,
  });

  try {
    const sent = await sendEmail(env, {
      kind: "account_invite",
      toEmail: args.email,
      toName: args.name,
      subject: invite.subject,
      body: invite.body,
      html: invite.html,
      // The outbox is durable; the temporary password must not be in it.
      auditBody: invite.body.replace(args.tempPassword, "[redacted]"),
    });
    return { delivered: sent.status === "sent", status: sent.status };
  } catch (err) {
    // sendEmail swallows delivery errors; only an outbox write can throw. The
    // user row is already committed, so degrade to relay-it-yourself rather
    // than 500-ing a creation that succeeded.
    console.error("account invite could not be recorded:", err);
    return { delivered: false, status: "failed" };
  }
}

/** Whether an admin/superuser may CREATE this role for their edition (excludes
 *  superuser + founder — see shared `creatableStaffRoles`). */
function isCreatableStaffRole(edition: Edition, role: string): role is Role {
  return (creatableStaffRoles(edition) as readonly string[]).includes(role);
}

function displayRole(edition: Edition, role: string, userType: string): string {
  if (userType === "mentor") return "Mentor";
  return roleLabel(edition, role as Role);
}

function toUserView(edition: Edition, r: UserRosterRow) {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    role: r.role,
    roleLabel: displayRole(edition, r.role, r.user_type),
    // Aug-2026 issue 1 — the organizational alias the ribbon shows in place of
    // the platform role. Empty means "no alias, use roleLabel".
    title: r.title ?? undefined,
    userType: r.user_type,
    initials: r.initials,
    active: r.active === 1,
    // W4-A — F0064. An invite is PENDING until its credential is first used;
    // `0041` stamps `invite_accepted_at` on that first successful sign-in, so
    // the roster derives the state rather than storing a second copy of it.
    invitePending: (r.invite_accepted_at ?? null) === null,
    inviteSentAt: r.invite_sent_at ?? undefined,
    inviteAcceptedAt: r.invite_accepted_at ?? undefined,
    // W4-A — F0075. True while the credential in play is one the SYSTEM issued
    // (create / resend / admin reset) and the user has not replaced it.
    mustChangePassword: (r.must_change_password ?? 0) === 1,
  };
}

/** Alias titles are free text but must not be a paragraph. */
const MAX_TITLE = 60;

function normaliseTitle(value: unknown): string | null | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().replace(/\s+/g, " ").slice(0, MAX_TITLE);
  return trimmed === "" ? null : trimmed;
}

// ── Roster ───────────────────────────────────────────────────────────────────

/**
 * GET /api/users — the edition's LIVE roster (Super User / Admin).
 *
 * `deleted_at IS NULL` is the whole of what "removed" means here: the row stays
 * for the decks, evaluations and audit rows that reference it (0044), and every
 * read of the roster, the User access section and the rail's pending badge goes
 * through this one route, so there is a single place that decides it.
 */
users.get("/", requireTask("adminconsole", "admin"), async (c) => {
  const edition = c.var.user.edition;
  const rows = (
    await c.env.DB.prepare(
      `SELECT ${ROSTER_COLUMNS} FROM users WHERE edition = ? AND deleted_at IS NULL ORDER BY active DESC, name`,
    )
      .bind(edition)
      .all<UserRosterRow>()
  ).results;
  return c.json({ users: rows.map((r) => toUserView(edition, r)) });
});

// ── My own profile (alias title) ─────────────────────────────────────────────

/**
 * PATCH /api/users/me — set (or clear) your own organizational ALIAS TITLE.
 *
 * Aug-2026 issue 1: "the user role should have provision to add alias title.
 * Our default role remains same in the background but their organizational role
 * would be visible." Deliberately open to every authenticated role including
 * founders — it changes a display string on your own row and nothing else. The
 * platform `role` is NOT settable here.
 */
users.patch("/me", async (c) => {
  const body = await readBody<{ title: string }>(c);
  const title = normaliseTitle(body.title);
  if (title === undefined) return c.json({ error: "title_required" }, 400);

  await c.env.DB.prepare("UPDATE users SET title = ? WHERE id = ?")
    .bind(title, c.var.user.id)
    .run();

  return c.json({ ok: true, title: title ?? undefined });
});

// ── Create ───────────────────────────────────────────────────────────────────

interface CreateUserBody {
  name: string;
  email: string;
  role: string;
  userType: string;
  title: string;
}

/** POST /api/users — create a team member or mentor (Super User / Admin).
 *  Body: { name, email, role, userType? }. The one-time temporary password is
 *  EMAILED to the new user; it is returned in the response only when the mail
 *  could not actually be delivered (see `deliverInvite`). */
users.post("/", requireTask("addmembers", "admin"), async (c) => {
  const edition = c.var.user.edition;
  const body = await readBody<CreateUserBody>(c);

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return c.json({ error: "name_required" }, 400);

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email)) return c.json({ error: "invalid_email" }, 400);

  const userType = body.userType === "mentor" ? "mentor" : "staff";

  // Mentors are a directory user-type with no pipeline authority → role forced
  // to the non-privileged 'mentor' value. Staff must get a real, creatable role.
  let role: string;
  if (userType === "mentor") {
    role = "mentor";
  } else {
    const submitted = typeof body.role === "string" ? body.role : "";
    if (!isCreatableStaffRole(edition, submitted)) return c.json({ error: "invalid_role" }, 400);
    role = submitted;
  }

  // Unique email (the UNIQUE constraint would otherwise throw a raw D1 error).
  const existing = await getUserByEmail(c.env.DB, email);
  if (existing) return c.json({ error: "email_taken" }, 409);

  const id = `usr_${crypto.randomUUID().slice(0, 8)}`;
  const initials = initialsFrom(name);
  const title = normaliseTitle(body.title) ?? null;
  const password = tempPassword();
  const passwordHash = await hashPassword(password);

  // W4-A (0044) — `invite_sent_at` is what Resend updates and the roster reports;
  // `must_change_password` marks the credential as one the system issued, which
  // is what User access reads. `invite_accepted_at` stays NULL until the new
  // account signs in for the first time (0041 / `POST /api/auth/login`), and
  // that NULL is the roster's "Invite pending".
  await c.env.DB.prepare(
    "INSERT INTO users (id, name, email, password_hash, role, edition, initials, active, user_type, title, invite_sent_at, must_change_password) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, datetime('now'), 1)",
  )
    .bind(id, name, email, passwordHash, role, edition, initials, userType, title)
    .run();

  const invite = await deliverInvite(c.env, {
    edition,
    name,
    email,
    roleLabel: displayRole(edition, role, userType),
    tempPassword: password,
    invitedByName: c.var.user.name,
  });

  await auditUserInvited(c, { id, name, email, roleLabel: displayRole(edition, role, userType) });

  return c.json({
    ok: true,
    // Withheld once the invite is genuinely on its way — the credential then
    // lives only in the recipient's inbox.
    ...(invite.delivered ? {} : { tempPassword: password }),
    invite,
    user: toUserView(edition, {
      id,
      name,
      email,
      role,
      initials,
      active: 1,
      user_type: userType,
      created_at: "",
      title,
      invite_sent_at: new Date().toISOString(),
      invite_accepted_at: null,
      must_change_password: 1,
    }),
  });
});

// ── Update (activate / deactivate / rename / re-role) ────────────────────────

interface UpdateUserBody {
  active: boolean;
  role: string;
  name: string;
  title: string;
}

/** PATCH /api/users/:id — update a user's active flag, name, or role (Super
 *  User / Admin, same edition). You cannot deactivate or re-role yourself, and a
 *  superuser row is immutable here (protects the account's single owner). */
users.patch("/:id", requireTask("adminconsole", "admin"), async (c) => {
  const edition = c.var.user.edition;
  const id = c.req.param("id");
  const target = await c.env.DB.prepare(
    `SELECT ${ROSTER_COLUMNS} FROM users WHERE id = ? AND edition = ? AND deleted_at IS NULL`,
  )
    .bind(id, edition)
    .first<UserRosterRow>();
  if (!target) return c.json({ error: "not_found" }, 404);
  if (target.role === "superuser") return c.json({ error: "immutable_superuser" }, 403);
  if (id === c.var.user.id) return c.json({ error: "cannot_edit_self" }, 403);

  const body = await readBody<UpdateUserBody>(c);

  let name = target.name;
  if (typeof body.name === "string" && body.name.trim()) name = body.name.trim();

  let role = target.role;
  // Re-roling only applies to staff; a mentor stays a mentor here.
  if (typeof body.role === "string" && target.user_type !== "mentor") {
    if (!isCreatableStaffRole(edition, body.role)) return c.json({ error: "invalid_role" }, 400);
    role = body.role;
  }

  const active = typeof body.active === "boolean" ? (body.active ? 1 : 0) : target.active;

  // W3-A — *Activate user* / *Deactivate user* are two separate cells in the
  // console's Task permissions grid, and this is the only route that performs
  // either. Checked per DIRECTION, not per route: an administrator can be left
  // able to deactivate a leaver without being able to switch them back on.
  // Seeded to admin + superuser (+ PM / partner-associate), so this refuses
  // nobody until someone unticks a cell.
  if (active !== target.active) {
    const task = active === 1 ? "activateuser" : "deactivateuser";
    if (!(await c.var.perms.can(task))) return c.json({ error: "forbidden" }, 403);
  }

  // undefined = field absent, keep what's there; null = explicitly cleared.
  const titleUpdate = normaliseTitle(body.title);
  const title = titleUpdate === undefined ? (target.title ?? null) : titleUpdate;

  await c.env.DB.prepare(
    "UPDATE users SET name = ?, role = ?, initials = ?, active = ?, title = ? WHERE id = ? AND edition = ?",
  )
    .bind(name, role, initialsFrom(name), active, title, id, edition)
    .run();

  await auditUserUpdated(
    c,
    id,
    { name: target.name, role: target.role, active: target.active, title: target.title ?? null },
    { name, role, active, title },
  );

  return c.json({
    ok: true,
    user: toUserView(edition, {
      ...target,
      name,
      role,
      initials: initialsFrom(name),
      active,
      title,
    }),
  });
});

// ── Self-service password change (F0075) ─────────────────────────────────────

/**
 * PUT /api/users/me/password — change your OWN password.
 *
 * F0075: the console has promised since Phase 1 that a new user "will set their
 * own password on first sign-in", and the prototype's reset dialog says the same
 * ("they're prompted to change it on next login"). Neither was true — there was
 * no change-password route anywhere in the application, so a temporary
 * credential stayed valid forever and its owner could never replace it. This is
 * the verb that makes the sentence true.
 *
 * Open to every authenticated principal, mentors and founders included: it
 * changes your own credential and nothing else. The current password is
 * verified, so a stolen session cannot silently take over the account.
 *
 * NOT YET FORCED at sign-in. `must_change_password` is written here and by the
 * three routes that ISSUE a credential, and the console's User access section
 * reports it truthfully — but `POST /api/auth/login` does not yet refuse a
 * principal that carries it, because `auth.ts` is not this session's file. That
 * is a cross-session request (plan §9), and the UI copy stops short of claiming
 * the enforcement exists.
 */
const MIN_PASSWORD = 8;

users.put("/me/password", async (c) => {
  const body = await readBody<{ currentPassword: string; newPassword: string }>(c);
  const current = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const next = typeof body.newPassword === "string" ? body.newPassword : "";
  if (next.length < MIN_PASSWORD) return c.json({ error: "password_too_short" }, 400);
  if (next === current) return c.json({ error: "password_unchanged" }, 400);

  const row = await c.env.DB.prepare("SELECT password_hash FROM users WHERE id = ?")
    .bind(c.var.user.id)
    .first<{ password_hash: string | null }>();
  if (!row?.password_hash) return c.json({ error: "not_found" }, 404);
  if (!(await verifyPassword(current, row.password_hash))) {
    return c.json({ error: "invalid_credentials" }, 403);
  }

  await c.env.DB.prepare(
    "UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?",
  )
    .bind(await hashPassword(next), c.var.user.id)
    .run();

  // A credential change is an authorisation event, not a roster edit — the same
  // category the permission grid writes to (W3-C's `security`).
  await recordAudit(c, {
    category: "security",
    action: "password_changed",
    summary: `${c.var.user.name} changed their own password`,
    targetType: "user",
    targetId: c.var.user.id,
  });

  return c.json({ ok: true });
});

// ── Delete, reset and resend (F0064 / F0065 / F0124) ─────────────────────────

/** The target of a per-user verb, or the refusal that stops it. */
async function loadTarget(
  c: Context<AppEnv>,
  id: string,
): Promise<UserRosterRow | null> {
  return c.env.DB.prepare(
    `SELECT ${ROSTER_COLUMNS} FROM users WHERE id = ? AND edition = ? AND deleted_at IS NULL`,
  )
    .bind(id, c.var.user.edition)
    .first<UserRosterRow>();
}

/**
 * DELETE /api/users/:id — remove a member (F0065), or cancel a pending invite.
 *
 * Gated on the grid's own `deleteuser` cell — the row §8 Q27 named as this
 * session's to give a verb to. `requireTask` is `requireRole(...) AND can(task)`
 * (§8 Q8), so the cell can close this route for a role but never open it for one
 * the role list withholds.
 *
 * SOFT, and deliberately so. `users.id` is a foreign key on decks, evaluations,
 * calls, notifications and the audit trail; a hard DELETE either fails or leaves
 * rows naming a person who no longer exists. The row is stamped `deleted_at`,
 * cleared of `active` (so `POST /api/auth/login` refuses it — an inactive user
 * cannot sign in), and its address is moved to `deleted_email` so the seat is
 * genuinely released and the same person can be re-invited.
 *
 * Three refusals, and none of them is decorative:
 *   • `immutable_superuser` — the account's single owner, exactly as `PATCH`
 *     already refuses it. Removing the owner would leave the workspace with no
 *     transferable ownership, and there is no nomination flow yet (F0062).
 *   • `cannot_delete_self` — you would be deleting the session you are using.
 *   • `last_admin` — the workspace must not be left with nobody who can open the
 *     console. Counted over the roster AFTER the removal, from the roles that
 *     actually hold `adminconsole`, so it follows the grid rather than a literal.
 */
users.delete("/:id", requireTask("deleteuser", "admin"), async (c) => {
  const edition = c.var.user.edition;
  const id = c.req.param("id");
  const target = await loadTarget(c, id);
  if (!target) return c.json({ error: "not_found" }, 404);
  if (target.role === "superuser") return c.json({ error: "immutable_superuser" }, 403);
  if (id === c.var.user.id) return c.json({ error: "cannot_delete_self" }, 403);

  if (await wouldStrandTheConsole(c, target)) return c.json({ error: "last_admin" }, 409);

  await c.env.DB.prepare(
    "UPDATE users SET deleted_at = datetime('now'), active = 0, deleted_email = email, " +
      "email = 'deleted:' || id WHERE id = ? AND edition = ?",
  )
    .bind(id, edition)
    .run();

  await recordAudit(c, {
    category: "team",
    // Cancelling an invite nobody has accepted is a different event from removing
    // a colleague, and the trail should not blur the two.
    action: target.invite_accepted_at ? "user_deleted" : "invite_cancelled",
    summary: target.invite_accepted_at
      ? `Removed ${target.name} (${target.email}) from the workspace`
      : `Cancelled the invite to ${target.name} (${target.email})`,
    detail: { role: target.role, email: target.email, userType: target.user_type },
    targetType: "user",
    targetId: id,
  });

  return c.json({ ok: true, id, cancelledInvite: target.invite_accepted_at === null });
});

/**
 * Would removing (or deactivating) this user leave nobody able to open the
 * console? The console is the `adminconsole` task, so the set of roles that can
 * still reach it is read from the live grid rather than hard-coded — close the
 * `admin` cell and `admin` stops counting here too, which is the correct answer
 * rather than an accident.
 */
async function wouldStrandTheConsole(
  c: Context<AppEnv>,
  target: UserRosterRow,
): Promise<boolean> {
  const edition = c.var.user.edition;
  const overrides = await loadEditionOverrides(c.env.DB, edition);
  const keyholders = PERMISSION_ROLES[edition].filter((role) =>
    can(edition, role, "adminconsole", overrides),
  );
  if (!keyholders.includes(target.role as Role)) return false;

  const placeholders = keyholders.map(() => "?").join(", ");
  const row = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM users WHERE edition = ? AND deleted_at IS NULL AND active = 1 ` +
      `AND id <> ? AND role IN (${placeholders})`,
  )
    .bind(edition, target.id, ...keyholders)
    .first<{ n: number }>();
  return (row?.n ?? 0) === 0;
}

/**
 * POST /api/users/:id/reset-password — issue a fresh temporary credential.
 *
 * §1.2 of the parity plan forbids building the prototype's User access screen as
 * drawn: it lists every user's stored password behind a reveal control, which
 * would require storing reversible credentials and showing the Super User's to a
 * jury member. Passwords are PBKDF2-hashed and stay that way, so this is the
 * whole of what the screen can do — RESET, never reveal.
 *
 * The new credential follows exactly the rule `POST /api/users` already
 * established: it is emailed, and it comes back in the response ONLY when the
 * mail could not be delivered (no sending domain onboarded yet), for the
 * administrator to relay. Nothing here can read an existing password.
 *
 * An `admin` may not reset the SUPERUSER's credential — that is an escalation
 * path, not an administrative convenience: it would let an administrator take
 * over the account owner's session. A superuser may.
 */
users.post("/:id/reset-password", requireTask("adminconsole", "admin"), async (c) => {
  const edition = c.var.user.edition;
  const id = c.req.param("id");
  const target = await loadTarget(c, id);
  if (!target) return c.json({ error: "not_found" }, 404);
  if (target.role === "superuser" && c.var.user.role !== "superuser") {
    return c.json({ error: "immutable_superuser" }, 403);
  }
  // Your own password is yours to change, not to have reset out from under you.
  if (id === c.var.user.id) return c.json({ error: "cannot_reset_self" }, 403);

  const password = tempPassword();
  await c.env.DB.prepare(
    "UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ? AND edition = ?",
  )
    .bind(await hashPassword(password), id, edition)
    .run();

  const invite = await deliverInvite(c.env, {
    edition,
    name: target.name,
    email: target.email,
    roleLabel: displayRole(edition, target.role, target.user_type),
    tempPassword: password,
    invitedByName: c.var.user.name,
  });

  await recordAudit(c, {
    category: "security",
    action: "password_reset",
    summary: `Reset ${target.name}'s password (${target.email})`,
    detail: { delivered: invite.delivered, status: invite.status },
    targetType: "user",
    targetId: id,
  });

  return c.json({
    ok: true,
    ...(invite.delivered ? {} : { tempPassword: password }),
    invite,
  });
});

/**
 * POST /api/users/:id/resend-invite — send a pending invite again (F0064).
 *
 * "Pending" is `invite_accepted_at IS NULL` (0041): the credential has never
 * been used. Resending ISSUES A NEW ONE rather than re-mailing the old — the
 * first password may well be why the invite stalled, and nothing in the system
 * can read it back anyway. A member who has already signed in is not pending,
 * and the refusal says so rather than quietly resetting a live account; that is
 * what `reset-password` is for.
 *
 * Gated on `addmembers` — the same cell as creating the member in the first
 * place, because a resend is the tail of that one act.
 */
users.post("/:id/resend-invite", requireTask("addmembers", "admin"), async (c) => {
  const edition = c.var.user.edition;
  const id = c.req.param("id");
  const target = await loadTarget(c, id);
  if (!target) return c.json({ error: "not_found" }, 404);
  if (target.invite_accepted_at) return c.json({ error: "invite_already_accepted" }, 409);

  const password = tempPassword();
  await c.env.DB.prepare(
    "UPDATE users SET password_hash = ?, must_change_password = 1, invite_sent_at = datetime('now') " +
      "WHERE id = ? AND edition = ?",
  )
    .bind(await hashPassword(password), id, edition)
    .run();

  const invite = await deliverInvite(c.env, {
    edition,
    name: target.name,
    email: target.email,
    roleLabel: displayRole(edition, target.role, target.user_type),
    tempPassword: password,
    invitedByName: c.var.user.name,
  });

  await recordAudit(c, {
    category: "team",
    action: "invite_resent",
    summary: `Resent the invite to ${target.name} (${target.email})`,
    detail: { delivered: invite.delivered, status: invite.status },
    targetType: "user",
    targetId: id,
  });

  return c.json({
    ok: true,
    ...(invite.delivered ? {} : { tempPassword: password }),
    invite,
  });
});

// ── Ownership transfer (F0062) ───────────────────────────────────────────────

/**
 * POST /api/users/:id/transfer-ownership — hand the account owner's seat over.
 *
 * F0062: account ownership was permanently whatever `0002_seed.sql` created.
 * `creatableStaffRoles` excludes `superuser`, `PATCH /:id` refuses any superuser
 * row outright, and no other route ever writes `role = 'superuser'` — so if the
 * seeded owner left the organisation, the account had no owner and no path to
 * appoint one. The prototype treats naming exactly one Super User as a required,
 * changeable step (`#su-superbox` → `suSetSuper`), and `s-tm`'s own card-4 copy
 * ("the account owner … is fixed and can't be overridden **here**") points at a
 * flow that lives somewhere else.
 *
 * SUPERUSER ONLY, and it stays outside the permission grid: `requireTask` with an
 * empty role list is `role === "superuser"` AND the console's own cell, so an
 * owner whose `adminconsole` has been closed cannot use it either. There is no
 * `transferownership` task because the prototype's matrix has no such row, and
 * inventing one would put the account's single owner behind a checkbox an
 * administrator could tick.
 *
 * ATOMIC, because a half-applied transfer is either two owners or none: both
 * UPDATEs go in one `batch`. The invariant it preserves is exactly one
 * `superuser` per edition.
 *
 * AND IT ENDS THE OUTGOING OWNER'S SESSION. Sessions are KV values written at
 * login and good for seven days (`auth/session.ts`), so a demoted owner would
 * otherwise keep every superuser bypass until they happened to sign out. The
 * incoming owner's session, if they have one, is stale in the safe direction —
 * they stay an `admin` until they sign in again.
 */
users.post("/:id/transfer-ownership", requireTask("adminconsole"), async (c) => {
  const { edition, id: actorId } = c.var.user;
  const id = c.req.param("id");
  const target = await loadTarget(c, id);
  if (!target) return c.json({ error: "not_found" }, 404);
  if (id === actorId) return c.json({ error: "already_owner" }, 400);
  // A mentor is a directory record with no pipeline authority (§1.2) and a
  // never-signed-in invitee is an address, not a person yet. Neither can hold an
  // account, and an inactive row would leave the workspace ownerless in practice.
  if (target.user_type === "mentor") return c.json({ error: "invalid_role" }, 400);
  if (target.active !== 1) return c.json({ error: "inactive_user" }, 409);
  if (target.invite_accepted_at === null) return c.json({ error: "invite_pending" }, 409);

  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET role = 'superuser' WHERE id = ? AND edition = ?").bind(
      id,
      edition,
    ),
    c.env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ? AND edition = ?").bind(
      actorId,
      edition,
    ),
  ]);

  await recordAudit(c, {
    category: "security",
    action: "ownership_transferred",
    summary: `Transferred account ownership to ${target.name} (${target.email})`,
    detail: { from: actorId, to: id },
    targetType: "user",
    targetId: id,
  });

  // Written LAST: the transfer is committed and audited before the caller loses
  // the session that performed it, so a failure here cannot strand a half-done
  // change behind a signed-out administrator.
  await deleteSession(c.env.SESSIONS, getCookie(c, SESSION_COOKIE));
  deleteCookie(c, SESSION_COOKIE, { path: "/" });

  return c.json({ ok: true, owner: { id, name: target.name, email: target.email }, signedOut: true });
});

export { users };
export default users;
