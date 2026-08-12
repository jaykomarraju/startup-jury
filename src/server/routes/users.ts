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
// New users get a generated TEMPORARY PASSWORD (returned once to the admin, who
// relays it) — mirrors the prototype's "issue a temporary password" model. Real
// email invites arrive with Cloudflare Email in Session 6.

import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../types";
import type { Edition, Role } from "../../shared/roles";
import { creatableStaffRoles, roleLabel } from "../../shared/roles";
import { requireAuth, requireRole } from "../auth/middleware";
import { hashPassword } from "../auth/password";
import { getUserByEmail } from "../db";

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
 *  Body: { name, email, role, userType? }. Returns the created user + a
 *  one-time temporary password for the admin to relay. */
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

  return c.json({
    ok: true,
    tempPassword: password,
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
