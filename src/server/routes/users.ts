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
import type { AppEnv, Env } from "../types";
import type { Edition, Role } from "../../shared/roles";
import { creatableStaffRoles, roleLabel } from "../../shared/roles";
import { requireAuth, requireRole } from "../auth/middleware";
import { hashPassword } from "../auth/password";
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
}

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
    userType: r.user_type,
    initials: r.initials,
    active: r.active === 1,
  };
}

// ── Roster ───────────────────────────────────────────────────────────────────

/** GET /api/users — the edition's roster (Super User / Admin). */
users.get("/", requireRole("admin"), async (c) => {
  const edition = c.var.user.edition;
  const rows = (
    await c.env.DB.prepare(
      "SELECT id, name, email, role, initials, active, user_type, created_at FROM users WHERE edition = ? ORDER BY active DESC, name",
    )
      .bind(edition)
      .all<UserRosterRow>()
  ).results;
  return c.json({ users: rows.map((r) => toUserView(edition, r)) });
});

// ── Create ───────────────────────────────────────────────────────────────────

interface CreateUserBody {
  name: string;
  email: string;
  role: string;
  userType: string;
}

/** POST /api/users — create a team member or mentor (Super User / Admin).
 *  Body: { name, email, role, userType? }. The one-time temporary password is
 *  EMAILED to the new user; it is returned in the response only when the mail
 *  could not actually be delivered (see `deliverInvite`). */
users.post("/", requireRole("admin"), async (c) => {
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
  const password = tempPassword();
  const passwordHash = await hashPassword(password);

  await c.env.DB.prepare(
    "INSERT INTO users (id, name, email, password_hash, role, edition, initials, active, user_type) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)",
  )
    .bind(id, name, email, passwordHash, role, edition, initials, userType)
    .run();

  const invite = await deliverInvite(c.env, {
    edition,
    name,
    email,
    roleLabel: displayRole(edition, role, userType),
    tempPassword: password,
    invitedByName: c.var.user.name,
  });

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
    }),
  });
});

// ── Update (activate / deactivate / rename / re-role) ────────────────────────

interface UpdateUserBody {
  active: boolean;
  role: string;
  name: string;
}

/** PATCH /api/users/:id — update a user's active flag, name, or role (Super
 *  User / Admin, same edition). You cannot deactivate or re-role yourself, and a
 *  superuser row is immutable here (protects the account's single owner). */
users.patch("/:id", requireRole("admin"), async (c) => {
  const edition = c.var.user.edition;
  const id = c.req.param("id");
  const target = await c.env.DB.prepare(
    "SELECT id, name, email, role, initials, active, user_type, created_at FROM users WHERE id = ? AND edition = ?",
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

  await c.env.DB.prepare(
    "UPDATE users SET name = ?, role = ?, initials = ?, active = ? WHERE id = ? AND edition = ?",
  )
    .bind(name, role, initialsFrom(name), active, id, edition)
    .run();

  return c.json({
    ok: true,
    user: toUserView(edition, { ...target, name, role, initials: initialsFrom(name), active }),
  });
});

export { users };
export default users;
