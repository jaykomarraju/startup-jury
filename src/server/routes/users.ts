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
// ── T1-PEOPLE, tenancy wave ─────────────────────────────────────────────────
// "Edition-scoped to the caller" above is now WORKSPACE-scoped: every statement
// in this file binds `(tenant_id, edition)` through `scoped(scopeOf(c.var.user))`,
// and the global `getUserByEmail` — "does this address exist anywhere on the
// platform?", which T0 deprecated and deliberately left at the one call site in
// this file rather than editing another session's file — is gone.
//
// §6 names this file as the one a foundation session must not touch, and both
// reasons live here. `transfer-ownership` writes `role = 'superuser'` onto a row
// found by id and demotes the actor in the same batch. And `users` is the one
// table whose UNIQUE constraint changed SHAPE (`0087`: `UNIQUE (email)` →
// `UNIQUE (tenant_id, email)`), so `email_taken` stopped being a question about
// the platform and became one about a workspace.
//
// New users get a generated TEMPORARY PASSWORD. Session 8 makes that an actual
// EMAIL (`buildAccountInviteEmail`) rather than a value the admin copies off the
// screen — but only when the Worker can genuinely deliver mail. See
// `deliverInvite` below: if the sending domain isn't onboarded, emailing the
// credential would silently strand the new account, so the response still
// carries the password and the console tells the admin to relay it. Setting
// `vars.EMAIL_FROM` flips the whole thing over with no further code change.
//
// ── L4, GCW pilot wave ──────────────────────────────────────────────────────
// Three things join this file, all of them for the live call on which GCW's own
// administrator configures their workspace:
//
//   · **the approval queue.** Lane L2's registration lands a stranger as
//     `active = 0, approval_state = 'pending', role = 'jury'`. `?approval=pending`
//     lists them, `POST /:id/approve` admits one with the role the ADMINISTRATOR
//     chooses, `POST /:id/decline` refuses one and keeps the row. The default
//     roster EXCLUDES pending rows — see `GET /` for why that is a correctness
//     matter and not tidiness.
//   · **`GET /me/account`**, the one read the account surface needs about the
//     caller's own row: the credential state the client's cached principal
//     cannot carry, and the out-of-office window.
//   · **out of office with delegation** (`migrations/0107`), whose whole
//     authorisation story is one UNION arm in `src/shared/outOfOffice.ts`.
//
// **`approval_state` is lane L2's column** (`migrations/0106`). It is read by
// `ROSTER_COLUMNS` below, so this file does not work without it: applying L4
// without L2 makes every admin-console roster read a 500. Said again at the
// column list, because that is where someone will be looking.

import { Hono } from "hono";
import type { Context } from "hono";
import { getCookie, deleteCookie } from "hono/cookie";
import type { AppEnv, Env } from "../types";
import type { Edition, Role } from "../../shared/roles";
import { creatableStaffRoles, isMentor, roleLabel } from "../../shared/roles";
import { PERMISSION_ROLES } from "../../shared/types";
import { can } from "../../shared/permissions";
import { loadWorkspaceOverrides } from "../auth/permissions";
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
// `getUserByEmailInScope`, NOT the deprecated global `getUserByEmail`. The create
// route says why the difference is not tidiness.
import { getUserByEmailInScope } from "../db";
// T0-SCHEMA's one scope helper, used by all seven T1 sessions and written by none
// of them. `scopeOf` takes the PRINCIPAL and nothing else — `scopeOf(c.req.query())`
// would not compile — which is what keeps §2's one piece of good news true here
// too: not one of the 211 existing predicates takes its workspace key from the
// browser, and none of the ones below does either.
import { insertScope, scopeOf, scoped, type TenantScope } from "../../shared/tenant";
import {
  buildAccountInviteEmail,
  emailDeliveryConfigured,
  sendEmail,
  type SentEmail,
} from "../email/outbox";
import { orgNameInScope } from "../resubmit";
// L4 — out of office. The validators and the "is this person out today?"
// comparison are shared with the client so the badge the console draws and the
// rows a delegate receives agree on the same day.
import {
  isOutOn,
  todayIso,
  validateWindow,
  MAX_OOO_DAYS,
  type OutOfOfficeWindow,
} from "../../shared/outOfOffice";
// The one definition of "who may score this deck" — `decks.assigned_to` UNION
// `deck_assignments`, and (once integration lands the arm `outOfOffice.ts`
// supplies) a live delegate. IMPORTED, never restated: the coverage read below
// must mean exactly what the scoring gate means.
import { ASSIGNEE_PAIRS_SQL } from "../decks/assignments";

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
  // L4 — the registration gate (0106, lane L2) and the absence (0107, here).
  approval_state?: string | null;
  out_of_office_from?: string | null;
  out_of_office_to?: string | null;
  out_of_office_delegate?: string | null;
}

/** Every column the roster and the two console sections read. One place, so a
 *  new column cannot be added to one query and forgotten in the other three.
 *
 *  `approval_state` is **lane L2's column** (`migrations/0106`). This list is
 *  the hard dependency between the two lanes: without that migration every
 *  statement below is `no such column: approval_state` and the whole admin
 *  console 500s. The three `out_of_office_*` columns are `migrations/0107`,
 *  which ships in this patch. */
const ROSTER_COLUMNS =
  "id, name, email, role, initials, active, user_type, created_at, title, " +
  "invite_sent_at, invite_accepted_at, must_change_password, approval_state, " +
  "out_of_office_from, out_of_office_to, out_of_office_delegate";

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
    scope: TenantScope;
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
    orgName: await orgNameInScope(env, args.scope),
    invitedByName: args.invitedByName,
  });

  try {
    const sent = await sendEmail(env, {
      kind: "account_invite",
      // The invite's audit row belongs to the workspace that issued it, not to
      // whichever tenant `email_outbox.tenant_id`'s `DEFAULT 't_default'` would
      // have supplied. See `email/outbox.ts`'s `scope` field.
      scope: args.scope,
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

/** The three columns as the one object every reader of an absence takes, or null
 *  when the person is not out. A half-set window (a `from` with no `to`) is NOT
 *  an absence: `0107` leaves all three nullable, so "partly filled in" has to
 *  resolve to something, and the only safe answer is "not out" — the other one
 *  would hand somebody's decks away on the strength of half a form. */
function toOutOfOffice(r: UserRosterRow): (OutOfOfficeWindow & { active: boolean }) | null {
  const from = r.out_of_office_from ?? null;
  const to = r.out_of_office_to ?? null;
  if (!from || !to) return null;
  return {
    from,
    to,
    delegateId: r.out_of_office_delegate ?? null,
    active: isOutOn({ from, to }, todayIso()),
  };
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
    // L4 — 'pending' | 'approved' | 'declined' (0106). Surfaced on every roster
    // row and not only on the queue, so a screen can tell an applicant from a
    // deactivated colleague without a second request.
    approvalState: r.approval_state ?? "approved",
    // L4 — this person was never invited: no credential was ever issued TO them
    // and they have never signed in, which is the shape of an approved
    // SELF-REGISTRANT. They already hold a password of their own, chosen on the
    // registration form, so `invitePending` is true of them and means something
    // completely different — "has not signed in yet" rather than "has not
    // collected a credential we issued". Every screen that offers **Resend** on a
    // pending row has to tell the two apart, because a resend would REPLACE the
    // password they chose. Derived here rather than asked of two fields at each
    // call site; `POST /:id/resend-invite` refuses the same case server-side,
    // because a screen is a gate and never the enforcement.
    selfRegistered: (r.invite_sent_at ?? null) === null && (r.invite_accepted_at ?? null) === null,
    // L4 — the absence, with `active` already resolved against today so no
    // reader has to re-derive it from two date strings.
    outOfOffice: toOutOfOffice(r),
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
 * GET /api/users?approval=pending — the registrations waiting for a decision.
 *
 * `deleted_at IS NULL` is the whole of what "removed" means here: the row stays
 * for the decks, evaluations and audit rows that reference it (0044), and every
 * read of the roster, the User access section and the rail's pending badge goes
 * through this one route, so there is a single place that decides it.
 *
 * ── L4: WHY THE QUEUE IS A FILTER ON THIS ROUTE AND NOT ITS OWN ─────────────
 *
 * The brief leaves the choice open. A `GET /api/users/pending` would have had to
 * restate the workspace predicate, the `deleted_at` rule and the whole of
 * `toUserView` — four copies of the sentence "what a user looks like to a
 * screen", which `ROSTER_COLUMNS`'s own comment exists to prevent. One route, one
 * predicate, one view mapper; the parameter chooses which side of the approval
 * gate is being read.
 *
 * ── AND WHY THE DEFAULT ROSTER NOW EXCLUDES PENDING ROWS ────────────────────
 *
 * This is a correctness matter, not presentation. A registrant lands
 * `active = 0, approval_state = 'pending'` with `invite_accepted_at` NULL, so
 * before this filter they appeared in Team & roles as an ordinary pending-invite
 * row — carrying **Resend** (which would overwrite the password they chose at
 * registration) and **Activate** (which would switch them on while leaving
 * `approval_state = 'pending'`, the exact half-approved state `POST /:id/approve`
 * exists to make impossible). An applicant is not a member yet, and the roster is
 * the list of members. `declined` rows stay out of the default roster for the
 * same reason and remain readable with `?approval=declined`, which is what "left
 * for the record" has to mean to be worth anything.
 *
 * An unrecognised `approval` value is a 400 rather than a silent full roster: a
 * typo in a query string must not quietly return a superset of what was asked
 * for.
 */
const APPROVAL_STATES = ["pending", "approved", "declined"] as const;

users.get("/", requireTask("adminconsole", "admin"), async (c) => {
  const edition = c.var.user.edition;
  const approval = c.req.query("approval");
  if (approval !== undefined && !(APPROVAL_STATES as readonly string[]).includes(approval)) {
    return c.json({ error: "invalid_approval_state" }, 400);
  }

  // §2 B6, and the measurement the whole wave exists for: a second accelerator
  // added to a local copy — brand-new account, zero decks — signed in and read 8
  // staff rows belonging to the first, with names, addresses, roles and invite
  // state, because `edition` has two values and every customer shares one of them.
  const q = scoped(scopeOf(c.var.user)).on("u").andRaw("u.deleted_at IS NULL");
  if (approval === undefined) q.and("u.approval_state = ?", "approved");
  else q.and("u.approval_state = ?", approval);

  // A queue is read oldest-first — the person who has been waiting longest is the
  // one the administrator should act on — while the roster keeps the ordering
  // every existing screen was built against.
  const order =
    approval === undefined ? "ORDER BY u.active DESC, u.name" : "ORDER BY u.created_at, u.name";
  const rows = (
    await c.env.DB.prepare(`SELECT ${ROSTER_COLUMNS} FROM users u ${q.whereClause()} ${order}`)
      .bind(...q.binds)
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

  // `c.var.user.id` is the caller's own session id and `users.id` is globally
  // unique, so the scope adds nothing to CORRECTNESS here. It is added anyway, and
  // uniformly across this file, because the alternative is a reader deciding per
  // statement whether an `id`-only predicate happens to be one of the safe ones —
  // and `transfer-ownership` below is what that judgement costs when it is wrong.
  const q = scoped(scopeOf(c.var.user)).on("users").and("users.id = ?", c.var.user.id);
  await c.env.DB.prepare(`UPDATE users SET title = ? ${q.whereClause()}`)
    .bind(title, ...q.binds)
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
  const scope = scopeOf(c.var.user);
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

  // ── THE CALL SITE T0 LEFT HERE DELIBERATELY ──────────────────────────────
  // This was `getUserByEmail(c.env.DB, email)` — the GLOBAL lookup, which asks
  // whether the address exists anywhere on the platform. `0001_init.sql:7` made
  // `users.email` globally `UNIQUE`, so that was the same question as "is this
  // address free here?" and the 409 it produced was right. `0087` made the
  // constraint `UNIQUE (tenant_id, email)`, and from that moment the global form
  // is wrong in BOTH directions:
  //
  //   · it REFUSES tenant B's admin the right to add a colleague tenant A already
  //     employs — §7 Q4's "two customers employing the same person is not an edge
  //     case; it is the second customer" — so the 409 blocks a legitimate invite;
  //   · and the 409 itself DISCLOSES that the address is in use somewhere on the
  //     platform, which is a membership oracle an administrator should not have.
  //
  // The scoped form asks the question the UNIQUE constraint now enforces, so the
  // check and the index agree again. T0 wrote `getUserByEmailInScope` and left the
  // call site rather than edit this file (`db.ts:59-76`; §11's ownership table).
  const existing = await getUserByEmailInScope(c.env.DB, email, scope);
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
  // ── THE ONE PLACE A `users` ROW IS CREATED, AND THE WORST SILENT WRITE ────
  // `0087`'s header names this INSERT by line number. It first shipped `tenant_id
  // TEXT NOT NULL` with no default so that forgetting the tenant would FAIL rather
  // than quietly create tenant B's colleague inside tenant A — "the single worst
  // silent write in the schema, because that account then signs in and sees
  // everything". Measured, the loud column reddened 109 tests, all of them because
  // of this statement, in a file T0 does not own. So the column took
  // `DEFAULT 't_default'` and the loudness was deferred to here.
  //
  // `insertScope` is what discharges it: the column list and the binds come from
  // one call, so the column cannot be named without the value. Integration may now
  // drop the default — `0087`'s rebuild recipe is proven and reusable — and the
  // handoff asks for exactly that.
  const t = insertScope(scope);
  await c.env.DB.prepare(
    `INSERT INTO users (id, ${t.columns}, name, email, password_hash, role, initials, active, user_type, title, invite_sent_at, must_change_password) ` +
      `VALUES (?, ${t.placeholders}, ?, ?, ?, ?, ?, 1, ?, ?, datetime('now'), 1)`,
  )
    .bind(id, ...t.binds, name, email, passwordHash, role, initials, userType, title)
    .run();

  const invite = await deliverInvite(c.env, {
    scope,
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
      // L4 — an administrator typing somebody's address into Invite member IS the
      // approval; there is nothing left to decide. The column's own default says
      // the same thing, and this literal has to agree with the row that was just
      // written or the response would show a member the roster then hides.
      approval_state: "approved",
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
  const scope = scopeOf(c.var.user);
  const id = c.req.param("id");
  // Scoped, so another customer's member is a 404 — the route never confirms that
  // the id names somebody, which is what an unscoped `WHERE id = ?` would do before
  // it went on to re-role them.
  const load = scoped(scope).on("u").and("u.id = ?", id).andRaw("u.deleted_at IS NULL");
  const target = await c.env.DB.prepare(
    `SELECT ${ROSTER_COLUMNS} FROM users u ${load.whereClause()}`,
  )
    .bind(...load.binds)
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

  const q = scoped(scope).on("users").and("users.id = ?", id);
  await c.env.DB.prepare(
    `UPDATE users SET name = ?, role = ?, initials = ?, active = ?, title = ? ${q.whereClause()}`,
  )
    .bind(name, role, initialsFrom(name), active, title, ...q.binds)
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

// ── The approval queue (L4, GCW pilot) ───────────────────────────────────────

/**
 * The registration this administrator is deciding on, or the refusal.
 *
 * Both verbs need the same four checks and getting one of them wrong on one of
 * the two routes is the whole risk, so they are written once. `loadTarget` is not
 * reused: it refuses nothing about approval state, and both verbs must refuse a
 * row that is not actually waiting — otherwise `approve` becomes an unaudited
 * second way to re-role a serving colleague, which is what `PATCH /:id`'s
 * `immutable_superuser` / `cannot_edit_self` guards exist to prevent.
 */
async function loadPendingRegistration(
  c: Context<AppEnv>,
  id: string,
): Promise<{ row: UserRosterRow } | { error: string; status: 404 | 409 }> {
  // Scoped, so another customer's applicant is a 404 and the route never confirms
  // that the id names anybody. The lane brief calls an approval that matched
  // another customer's row the worst bug in this wave, and this is the one place
  // either verb reaches a row.
  const q = scoped(scopeOf(c.var.user)).on("u").and("u.id = ?", id).andRaw("u.deleted_at IS NULL");
  const row = await c.env.DB.prepare(`SELECT ${ROSTER_COLUMNS} FROM users u ${q.whereClause()}`)
    .bind(...q.binds)
    .first<UserRosterRow>();
  if (!row) return { error: "not_found", status: 404 };
  if ((row.approval_state ?? "approved") !== "pending") {
    // 409, not 403: the request is permitted, the row is simply in the wrong
    // state — most often because a colleague decided it first on a shared screen.
    return { error: "not_pending", status: 409 };
  }
  return { row };
}

/**
 * POST /api/users/:id/approve — admit a self-registered person, with the role the
 * ADMINISTRATOR chooses.
 *
 * Body: `{ role, title? }`. Lane L2 lands every registrant as `jury` — the lowest
 * role that can sign in and still see a sensible screen — and never takes the role
 * from the request body. This is where the real role is decided, by a person, and
 * `isCreatableStaffRole` is the same validator `POST /api/users` uses, so
 * `superuser` and `founder` are refused here exactly as they are there. §7 Q4 of
 * the pilot plan is the reason that matters: a self-registered **program
 * associate** reads every startup's name, sector, city, founder name, founder
 * email and AI score, because `decks.ts:558` scopes to own-decks for `jury` alone.
 *
 * Gated on `addmembers`, not `adminconsole`: approving a registration admits a
 * person to the workspace and picks their authority, which is the same act as
 * `POST /api/users` and `POST /:id/resend-invite`, both of which are on that cell.
 * An organisation that closes `addmembers` for `admin` closes this with it, which
 * is the answer it asked for.
 *
 * `must_change_password` is deliberately NOT set. A registrant chose their own
 * password at registration; marking it "temporary — not yet changed" would be
 * false, and would make User access tell the administrator to reset a credential
 * that is already the user's own.
 */
users.post("/:id/approve", requireTask("addmembers", "admin"), async (c) => {
  const edition = c.var.user.edition;
  const scope = scopeOf(c.var.user);
  const id = c.req.param("id");
  const loaded = await loadPendingRegistration(c, id);
  if ("error" in loaded) return c.json({ error: loaded.error }, loaded.status);
  const target = loaded.row;

  const body = await readBody<{ role: string; title: string }>(c);
  const submitted = typeof body.role === "string" ? body.role : "";
  if (!isCreatableStaffRole(edition, submitted)) return c.json({ error: "invalid_role" }, 400);
  const title = normaliseTitle(body.title) ?? target.title ?? null;

  // `user_type = 'staff'` is written although L2 already lands it: a mentor is a
  // directory record with no pipeline authority, so "approved into a real role"
  // and "mentor" are states that must never coexist, and the one statement that
  // grants the role is the right place to say so. `must_change_password` is
  // untouched for the reason in this route's header.
  const q = scoped(scope).on("users").and("users.id = ?", id);
  await c.env.DB.prepare(
    "UPDATE users SET approval_state = 'approved', active = 1, role = ?, user_type = 'staff', " +
      `title = ? ${q.whereClause()}`,
  )
    .bind(submitted, title, ...q.binds)
    .run();

  // `security`, not `team`: this row is the record of who let a stranger into the
  // workspace and with what authority. It belongs beside `password_reset` and
  // `ownership_transferred`, which is where someone reviewing an incident looks.
  await recordAudit(c, {
    category: "security",
    action: "registration_approved",
    // `submitted` is a `Role` here, narrowed by `isCreatableStaffRole`'s type
    // guard above — no cast, which is also what makes the refusal load-bearing.
    summary: `Approved ${target.name}'s registration (${target.email}) as ${roleLabel(edition, submitted)}`,
    detail: { email: target.email, role: submitted, title },
    targetType: "user",
    targetId: id,
  });

  return c.json({
    ok: true,
    user: toUserView(edition, {
      ...target,
      role: submitted,
      user_type: "staff",
      active: 1,
      title,
      approval_state: "approved",
    }),
  });
});

/**
 * POST /api/users/:id/decline — refuse a registration, and KEEP THE ROW.
 *
 * The brief is explicit that the row stays "for the record rather than deleting
 * it", and the consequence has to be stated rather than discovered on a call:
 * `users.email` is `UNIQUE (tenant_id, email)` since `0087`, so a declined row
 * **holds that address** and the same person cannot register again. That is the
 * right default — a declined applicant retrying the same form is exactly what the
 * decline was for — and the release valve already exists and is audited:
 * `DELETE /api/users/:id` renames the address to `deleted:<id>` and frees the
 * seat, which is how a decline made in error is undone.
 *
 * `active = 0` is written alongside the state even though a pending row is already
 * inactive, because a declined row must be inactive whatever route or script set
 * the state before it, and `POST /api/auth/login` refuses an inactive user today
 * without needing to know this column exists.
 */
users.post("/:id/decline", requireTask("addmembers", "admin"), async (c) => {
  const edition = c.var.user.edition;
  const scope = scopeOf(c.var.user);
  const id = c.req.param("id");
  const loaded = await loadPendingRegistration(c, id);
  if ("error" in loaded) return c.json({ error: loaded.error }, loaded.status);
  const target = loaded.row;

  const q = scoped(scope).on("users").and("users.id = ?", id);
  await c.env.DB.prepare(
    `UPDATE users SET approval_state = 'declined', active = 0 ${q.whereClause()}`,
  )
    .bind(...q.binds)
    .run();

  await recordAudit(c, {
    category: "security",
    action: "registration_declined",
    summary: `Declined ${target.name}'s registration (${target.email})`,
    detail: { email: target.email, requestedAt: target.created_at },
    targetType: "user",
    targetId: id,
  });

  return c.json({
    ok: true,
    user: toUserView(edition, { ...target, active: 0, approval_state: "declined" }),
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

  const self = scoped(scopeOf(c.var.user)).on("u").and("u.id = ?", c.var.user.id);
  const row = await c.env.DB.prepare(
    `SELECT u.password_hash FROM users u ${self.whereClause()}`,
  )
    .bind(...self.binds)
    .first<{ password_hash: string | null }>();
  if (!row?.password_hash) return c.json({ error: "not_found" }, 404);
  if (!(await verifyPassword(current, row.password_hash))) {
    return c.json({ error: "invalid_credentials" }, 403);
  }

  const write = scoped(scopeOf(c.var.user)).on("users").and("users.id = ?", c.var.user.id);
  await c.env.DB.prepare(
    `UPDATE users SET password_hash = ?, must_change_password = 0 ${write.whereClause()}`,
  )
    .bind(await hashPassword(next), ...write.binds)
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

// ── My account: the credential state, the absence, and the cover (L4) ────────

/** One pending evaluation a delegate is holding for somebody. */
interface CoveredAssignment {
  deckId: string;
  deckName: string;
  dueAt: string | null;
}

/** One person whose work this caller is covering, and what is left of it. */
interface CoveredFor {
  userId: string;
  name: string;
  until: string;
  assignments: CoveredAssignment[];
}

/**
 * Who is currently delegating to `delegateId`, and which of their evaluation
 * assignments are still outstanding.
 *
 * ── WHAT "PENDING" MEANS, AND THE BUG THE SECOND HALF FIXES ─────────────────
 *
 * An assignment is pending when no evaluation exists for that (deck, evaluator)
 * pair — the same `EXISTS (SELECT 1 FROM evaluations …)` test
 * `GET /api/assignments/board` uses for its `submitted` flag (`assignments.ts:111`).
 * But the pair that disappears when the DELEGATE does the work is
 * `(deck, delegate)`, not `(deck, absentee)`: an evaluation is stored against
 * whoever submitted it. Testing only the absentee would leave every covered deck
 * on the delegate's list forever, including the ones they had just finished. So
 * the `NOT EXISTS` covers BOTH ids.
 *
 * ── SCOPE ───────────────────────────────────────────────────────────────────
 *
 * Three predicates, all of them necessary and each for a different reason: the
 * absentee's row and the deck are both scoped with `.on(...)`, and `deleg`'s join
 * carries the absentee's own `(tenant_id, edition)` so a delegate id that somehow
 * names another customer's user resolves to nothing. `ASSIGNEE_PAIRS_SQL` is a
 * UNION over two tables with no workspace key of their own, which is exactly the
 * shape §11 of the tenancy plan says the silent failures live in.
 */
async function coverageFor(
  c: Context<AppEnv>,
  delegateId: string,
): Promise<CoveredFor[]> {
  // `away` and `pair`, not `absent` and `ap`: the delegation arm this reads
  // through once integration lands it uses `absent`/`deleg`/`ap` INSIDE its own
  // subquery, and two levels of the same alias is a thing a reader should not have
  // to resolve to be sure which row a predicate names.
  const q = scoped(scopeOf(c.var.user))
    .on("away")
    .on("d")
    .and("away.out_of_office_delegate = ?", delegateId)
    .andRaw("away.deleted_at IS NULL")
    // `isOutOn`'s SQL twin. `date('now')` rather than a bound value so this reads
    // the same clock the delegation UNION arm in `shared/outOfOffice.ts` reads —
    // two answers to "is Priya out today?" is the one thing worth avoiding here.
    .andRaw("away.out_of_office_from IS NOT NULL AND away.out_of_office_to IS NOT NULL")
    .andRaw("date('now') BETWEEN away.out_of_office_from AND away.out_of_office_to")
    .and(
      "NOT EXISTS (SELECT 1 FROM evaluations e WHERE e.deck_id = pair.deck_id " +
        "AND e.evaluator_id IN (away.id, ?))",
      delegateId,
    );

  const rows = (
    await c.env.DB.prepare(
      "SELECT away.id AS absent_id, away.name AS absent_name, " +
        "away.out_of_office_to AS until, pair.deck_id, d.name AS deck_name, da.due_at " +
        `FROM (${ASSIGNEE_PAIRS_SQL}) pair ` +
        "JOIN users away ON away.id = pair.evaluator_id " +
        "JOIN decks d ON d.id = pair.deck_id " +
        "LEFT JOIN deck_assignments da ON da.deck_id = pair.deck_id AND da.evaluator_id = away.id " +
        `${q.whereClause()} ORDER BY away.name, da.due_at IS NULL, da.due_at, d.name`,
    )
      .bind(...q.binds)
      .all<{
        absent_id: string;
        absent_name: string;
        until: string;
        deck_id: string;
        deck_name: string;
        due_at: string | null;
      }>()
  ).results;

  const byPerson = new Map<string, CoveredFor>();
  for (const r of rows) {
    const entry = byPerson.get(r.absent_id) ?? {
      userId: r.absent_id,
      name: r.absent_name,
      until: r.until,
      assignments: [],
    };
    entry.assignments.push({ deckId: r.deck_id, deckName: r.deck_name, dueAt: r.due_at });
    byPerson.set(r.absent_id, entry);
  }
  return [...byPerson.values()];
}

/**
 * GET /api/users/me/account — everything the account surface needs about the
 * caller's OWN row, in one request.
 *
 * ── WHY A ROUTE AND NOT `/api/auth/me` ──────────────────────────────────────
 *
 * The client caches the principal in `AuthProvider`'s `AuthUser`, which carries
 * id, name, initials, role, edition, title and permissions — and is written once
 * per page load. Neither the credential state nor an absence belongs on a cached
 * principal: both change from this screen, and a cached copy would still say
 * "temporary password" after the user had just replaced it. `auth.ts` is lane
 * L1/L2's file in any case, so the account surface reads its own facts here.
 *
 * `mustChangePassword` is the same column `/api/auth/me` will carry once lane L2
 * lands it (`must_change_password`, 0044) — one source of truth, two readers, not
 * two answers. `minPasswordLength` is served rather than restated in the client so
 * `MIN_PASSWORD` stays the only place the number 8 appears.
 *
 * Open to every authenticated principal, mentors and founders included: it is
 * your own row and nothing else, exactly like `PATCH /me` and
 * `PUT /me/password`.
 */
users.get("/me/account", async (c) => {
  const self = scoped(scopeOf(c.var.user)).on("u").and("u.id = ?", c.var.user.id);
  const row = await c.env.DB.prepare(`SELECT ${ROSTER_COLUMNS} FROM users u ${self.whereClause()}`)
    .bind(...self.binds)
    .first<UserRosterRow>();
  if (!row) return c.json({ error: "not_found" }, 404);

  const outOfOffice = toOutOfOffice(row);

  // Who this person may hand their work to. Four exclusions, each measurable:
  // themselves (the schema refuses it too — `0107`'s CHECK), anyone not
  // `approved` (an applicant is not a colleague), the inactive, and MENTORS —
  // a mentor is a directory record whose `/api/decks` is 403 (`denyMentor`), so
  // delegating evaluations to one would surface decks to a user-type that cannot
  // open them. Founders are external and never hold assignments; they are refused
  // by the same `user_type <> 'mentor'` plus the role list below.
  //
  // AND WHO MAY READ THE LIST, which is a different question from who may be on
  // it. The four exclusions below shape the CANDIDATES; this one gates the
  // CALLER. `/api/users/me/account` is mounted under the router's bare
  // `requireAuth` (`:108`) with no `requireTask` — correct, because every
  // principal needs their own `mustChangePassword` for the change-password
  // screen — but `delegates` is a roster of the workspace's staff with names and
  // role labels, and a FOUNDER is an external party with an account. Handing one
  // an enumerable list of the accelerator's team is the same class of leak as the
  // team channel (`routes/support.ts`), arriving through a route that exists for
  // an unrelated reason. A founder or a mentor never holds an assignment and so
  // never delegates one: they get their own account record and an empty list.
  const mayDelegate = !isMentor(c.var.user.role) && c.var.user.role !== "founder";
  const dq = scoped(scopeOf(c.var.user))
    .on("u")
    .andRaw("u.deleted_at IS NULL")
    .andRaw("u.active = 1")
    .and("u.approval_state = ?", "approved")
    .and("u.user_type <> ?", "mentor")
    .and("u.role NOT IN (?, ?)", "mentor", "founder")
    .and("u.id <> ?", c.var.user.id);
  const delegates = mayDelegate
    ? (
        await c.env.DB.prepare(
          `SELECT u.id, u.name, u.role, u.user_type FROM users u ${dq.whereClause()} ORDER BY u.name`,
        )
          .bind(...dq.binds)
          .all<{ id: string; name: string; role: string; user_type: string }>()
      ).results
    : [];

  return c.json({
    mustChangePassword: (row.must_change_password ?? 0) === 1,
    minPasswordLength: MIN_PASSWORD,
    outOfOffice,
    maxOutOfOfficeDays: MAX_OOO_DAYS,
    delegates: delegates.map((d) => ({
      id: d.id,
      name: d.name,
      roleLabel: displayRole(c.var.user.edition, d.role, d.user_type),
    })),
    coveringFor: await coverageFor(c, c.var.user.id),
  });
});

/**
 * PUT /api/users/me/out-of-office — set your own absence and name a delegate.
 *
 * Body: `{ from, to, delegateId? }`, dates `YYYY-MM-DD`, inclusive. `delegateId`
 * absent or null means "out, with nobody covering", which is a real thing a person
 * wants to record and is the state the console's indicator reads on its own.
 *
 * ── WHY THIS IS NOT GATED ON THE `outofofficedelegation` PERMISSION CELL ────
 *
 * The prototype's Task permissions grid has an **Out of office delegation** row
 * and `src/shared/types.ts` marks it `source: "none"` — "no verb in the product
 * yet". This is the verb, so the obvious move is to gate it on that cell and
 * delete the marker. Measured first, and it is the wrong move:
 * `0029_role_permissions.sql:150-151` seeds the cell **0 for `jury` and for
 * `program_associate`** in every workspace that has ever run that migration,
 * production included. Those are the roles that hold evaluation assignments —
 * `ASSIGNABLE_EVALUATOR_ROLES.incubator` is `["jury", "program_manager",
 * "program_associate"]` — so gating here would refuse the feature to precisely the
 * people it exists for, on a live call, with "forbidden" as the only explanation.
 *
 * So the verb is open to the caller's own row, like `PATCH /me` and
 * `PUT /me/password`, and the grid row stays marked "not enforced yet", which
 * remains true. Making the cell real is a one-line migration (grant it to `jury`
 * and `program_associate`) plus a `requireTask` here, in that order, and it is in
 * the lane report rather than half-done.
 */
users.put("/me/out-of-office", async (c) => {
  const body = await readBody<{ from: string; to: string; delegateId: string | null }>(c);
  const from = typeof body.from === "string" ? body.from.trim() : "";
  const to = typeof body.to === "string" ? body.to.trim() : "";
  // One validator, shared with the client (`shared/outOfOffice.ts`), so the form
  // and the route refuse the same windows for the same reasons — including
  // `2026-02-30`, which a regex alone accepts.
  const refusal = validateWindow(from, to);
  if (refusal) return c.json({ error: refusal, maxDays: MAX_OOO_DAYS }, 400);

  const submittedDelegate = typeof body.delegateId === "string" ? body.delegateId.trim() : "";
  let delegateId: string | null = null;
  if (submittedDelegate) {
    if (submittedDelegate === c.var.user.id) return c.json({ error: "invalid_delegate" }, 400);
    // The authorisation check of this whole feature, and it is expressed as a
    // SELECT: whatever id the browser sends, it only becomes a delegate if it
    // names an active, approved, non-mentor member of the CALLER'S OWN workspace.
    // `scoped(scopeOf(...))` is what makes "same workspace" unforgeable — the key
    // comes from the session and never from the body.
    const vq = scoped(scopeOf(c.var.user))
      .on("u")
      .and("u.id = ?", submittedDelegate)
      .andRaw("u.deleted_at IS NULL")
      .andRaw("u.active = 1")
      .and("u.approval_state = ?", "approved")
      .and("u.user_type <> ?", "mentor")
      .and("u.role NOT IN (?, ?)", "mentor", "founder");
    const ok = await c.env.DB.prepare(`SELECT u.id FROM users u ${vq.whereClause()}`)
      .bind(...vq.binds)
      .first<{ id: string }>();
    if (!ok) return c.json({ error: "invalid_delegate" }, 400);
    delegateId = ok.id;
  }

  const q = scoped(scopeOf(c.var.user)).on("users").and("users.id = ?", c.var.user.id);
  await c.env.DB.prepare(
    "UPDATE users SET out_of_office_from = ?, out_of_office_to = ?, out_of_office_delegate = ? " +
      q.whereClause(),
  )
    .bind(from, to, delegateId, ...q.binds)
    .run();

  await recordAudit(c, {
    category: "team",
    action: "out_of_office_set",
    summary: delegateId
      ? `${c.var.user.name} is out of office ${from} to ${to}, delegating to another member`
      : `${c.var.user.name} is out of office ${from} to ${to}`,
    detail: { from, to, delegateId },
    targetType: "user",
    targetId: c.var.user.id,
  });

  return c.json({
    ok: true,
    outOfOffice: { from, to, delegateId, active: isOutOn({ from, to }, todayIso()) },
  });
});

/** DELETE /api/users/me/out-of-office — you are back. Clears all three columns
 *  together: a window with no delegate and a delegate with no window are both
 *  states `toOutOfOffice` would have to interpret, and the fewer of those exist
 *  the better. */
users.delete("/me/out-of-office", async (c) => {
  const q = scoped(scopeOf(c.var.user)).on("users").and("users.id = ?", c.var.user.id);
  await c.env.DB.prepare(
    "UPDATE users SET out_of_office_from = NULL, out_of_office_to = NULL, " +
      `out_of_office_delegate = NULL ${q.whereClause()}`,
  )
    .bind(...q.binds)
    .run();

  await recordAudit(c, {
    category: "team",
    action: "out_of_office_cleared",
    summary: `${c.var.user.name} is no longer out of office`,
    targetType: "user",
    targetId: c.var.user.id,
  });

  return c.json({ ok: true, outOfOffice: null });
});

// ── Delete, reset and resend (F0064 / F0065 / F0124) ─────────────────────────

/** The target of a per-user verb, or the refusal that stops it. */
async function loadTarget(
  c: Context<AppEnv>,
  id: string,
): Promise<UserRosterRow | null> {
  // The one loader behind `DELETE`, `reset-password`, `resend-invite` and
  // `transfer-ownership`. §6 calls the last of those the most dangerous route in
  // the codebase once tenancy exists; making this function the only way any of the
  // four reaches a row is what means the scope is applied once rather than four
  // times, and cannot be present in three of them.
  const q = scoped(scopeOf(c.var.user)).on("u").and("u.id = ?", id).andRaw("u.deleted_at IS NULL");
  return c.env.DB.prepare(`SELECT ${ROSTER_COLUMNS} FROM users u ${q.whereClause()}`)
    .bind(...q.binds)
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
  const scope = scopeOf(c.var.user);
  const id = c.req.param("id");
  const target = await loadTarget(c, id);
  if (!target) return c.json({ error: "not_found" }, 404);
  if (target.role === "superuser") return c.json({ error: "immutable_superuser" }, 403);
  if (id === c.var.user.id) return c.json({ error: "cannot_delete_self" }, 403);

  if (await wouldStrandTheConsole(c, target)) return c.json({ error: "last_admin" }, 409);

  // `email = 'deleted:' || id` is what frees the address for a re-invite, and under
  // `0087` it frees it per workspace: `UNIQUE (tenant_id, email)` is what the rename
  // steps out of the way of, so the same person can be re-invited here without
  // touching a namesake at another customer.
  const q = scoped(scope).on("users").and("users.id = ?", id);
  await c.env.DB.prepare(
    "UPDATE users SET deleted_at = datetime('now'), active = 0, deleted_email = email, " +
      `email = 'deleted:' || id ${q.whereClause()}`,
  )
    .bind(...q.binds)
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
  // CROSS-SESSION, resolved at integration. This answer has two halves and they
  // were widened by different sessions: the ROLE LIST comes from the
  // `role_permissions` grid, and the COUNT below comes from `users`.
  //
  // T1-PEOPLE widened the count and recorded that the grid was still shared,
  // because the loader lived in a file it did not own. T1-CONFIG then widened the
  // loader — strictly, with no default-tenant fallback, since it fails open to
  // `DEFAULT_ROLE_PERMISSIONS` and a bridged scope would be one customer's gate
  // answering from another's grid. It lives in `src/server/auth/permissions.ts`,
  // NOT `routes/permissions.ts` as the plan says. The rename from
  // `loadEditionOverrides` is deliberate: a stale call now fails to compile
  // instead of quietly changing meaning.
  const overrides = await loadWorkspaceOverrides(c.env.DB, scopeOf(c.var.user));
  const keyholders = PERMISSION_ROLES[edition].filter((role) =>
    can(edition, role, "adminconsole", overrides),
  );
  if (!keyholders.includes(target.role as Role)) return false;

  // An AGGREGATE, which §11 names as the dangerous shape: a leaking COUNT here does
  // not show anybody another customer's staff, it silently answers "no, removing
  // this administrator is fine" because somebody at another customer still holds
  // the console. The workspace is then left with nobody who can open it, and the
  // refusal that exists to prevent exactly that never fires.
  const q = scoped(scopeOf(c.var.user))
    .on("u")
    .andRaw("u.deleted_at IS NULL")
    .andRaw("u.active = 1")
    .and("u.id <> ?", target.id)
    // The fragment and ITS binds in one call, which is the whole point of the
    // builder: a role list and its placeholders cannot drift apart, and a
    // hand-assembled `bind(...q.binds, ...keyholders)` is exactly the mistake a
    // 211-site sweep makes.
    .and(`u.role IN (${keyholders.map(() => "?").join(", ")})`, ...keyholders);
  const row = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM users u ${q.whereClause()}`,
  )
    .bind(...q.binds)
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
  const scope = scopeOf(c.var.user);
  const { edition } = scope;
  const id = c.req.param("id");
  const target = await loadTarget(c, id);
  if (!target) return c.json({ error: "not_found" }, 404);
  if (target.role === "superuser" && c.var.user.role !== "superuser") {
    return c.json({ error: "immutable_superuser" }, 403);
  }
  // Your own password is yours to change, not to have reset out from under you.
  if (id === c.var.user.id) return c.json({ error: "cannot_reset_self" }, 403);

  const password = tempPassword();
  // §6's point about this route, now that `users` is tenant-keyed: an `id`-only
  // UPDATE here would overwrite the credential of whichever customer's row matched.
  // `loadTarget` already refused an out-of-workspace id, and the write says so too.
  const q = scoped(scope).on("users").and("users.id = ?", id);
  await c.env.DB.prepare(
    `UPDATE users SET password_hash = ?, must_change_password = 1 ${q.whereClause()}`,
  )
    .bind(await hashPassword(password), ...q.binds)
    .run();

  const invite = await deliverInvite(c.env, {
    scope,
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
  const scope = scopeOf(c.var.user);
  const { edition } = scope;
  const id = c.req.param("id");
  const target = await loadTarget(c, id);
  if (!target) return c.json({ error: "not_found" }, 404);
  if (target.invite_accepted_at) return c.json({ error: "invite_already_accepted" }, 409);
  // L4 — there was no invite. An approved SELF-REGISTRANT has both invite columns
  // NULL: nothing was ever sent to them, because they chose their own password on
  // the registration form. Resending would quietly replace that password with a
  // generated one and lock them out of an account they can already use — the
  // opposite of what the button reads as. The screen hides the control
  // (`selfRegistered` on the roster row), and this is the enforcement, because
  // this repo's recurring bug class is a verb gated client-side only.
  if (!target.invite_sent_at) return c.json({ error: "no_invite_to_resend" }, 409);

  const password = tempPassword();
  const q = scoped(scope).on("users").and("users.id = ?", id);
  await c.env.DB.prepare(
    "UPDATE users SET password_hash = ?, must_change_password = 1, invite_sent_at = datetime('now') " +
      q.whereClause(),
  )
    .bind(await hashPassword(password), ...q.binds)
    .run();

  const invite = await deliverInvite(c.env, {
    scope,
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
 * `superuser` per **(tenant, edition)** — `0087`'s header names this route and
 * this sentence as T1-PEOPLE's, and §6 calls it the most dangerous route in the
 * codebase once tenancy exists. Both UPDATEs were `WHERE id = ? AND edition = ?`;
 * with `tenant_id` on the table but absent from those clauses, the batch would
 * promote a target and demote the actor in WHICHEVER CUSTOMER'S ROW MATCHED. It
 * is an authorisation check expressed as an absence, which is why the predicate
 * has to carry it rather than a guard above it.
 *
 * AND IT ENDS THE OUTGOING OWNER'S SESSION. Sessions are KV values written at
 * login and good for seven days (`auth/session.ts`), so a demoted owner would
 * otherwise keep every superuser bypass until they happened to sign out. The
 * incoming owner's session, if they have one, is stale in the safe direction —
 * they stay an `admin` until they sign in again.
 */
users.post("/:id/transfer-ownership", requireTask("adminconsole"), async (c) => {
  const { id: actorId } = c.var.user;
  const scope = scopeOf(c.var.user);
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

  const promote = scoped(scope).on("users").and("users.id = ?", id);
  const demote = scoped(scope).on("users").and("users.id = ?", actorId);
  await c.env.DB.batch([
    c.env.DB
      .prepare(`UPDATE users SET role = 'superuser' ${promote.whereClause()}`)
      .bind(...promote.binds),
    c.env.DB.prepare(`UPDATE users SET role = 'admin' ${demote.whereClause()}`).bind(...demote.binds),
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
