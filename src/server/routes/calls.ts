// Session 7 — call scheduling with ICS invites.
//
// FINISH-PLAN §8 settled scheduling in one line: the app generates a **universal
// `.ics`** for intro / partner / alignment calls, the organizer picks the
// participants (team + founder, any email domain), and that is the whole
// feature — no availability polling, no reschedule negotiation. So this router
// is deliberately small: create a call, hand back a calendar file, optionally
// mail it, and let the people on the call read it back.
//
// AuthZ has two tiers:
//   • **Schedulers** (`CALL_SCHEDULER_ROLES` — incubator PM/associate, VC
//     partner/associate, plus admin/superuser) create, reschedule and cancel.
//   • **Everyone else** is read-only and sees ONLY the calls they are a
//     participant on. That is §8's "jury/IC members involved in a call can view
//     their calls", and it means the IC member's calendar view can't be turned
//     into a listing of every deal the firm is talking to.

import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv, Env } from "../types";
import { denyMentor, requireAuth } from "../auth/middleware";
import {
  CALL_KIND_LABELS,
  CALL_KINDS_BY_EDITION,
  canScheduleCalls,
  isCallKind,
  type CallKind,
  type Edition,
} from "../../shared/roles";
import { buildIcs, icsFilename, ICS_CONTENT_TYPE, type IcsAttendee } from "../../shared/ics";
import { buildCallInviteEmail, sendEmail } from "../email/outbox";
import { performAction } from "../../pipeline";

const calls = new Hono<AppEnv>();
calls.use("*", requireAuth, denyMentor);

async function readBody<T>(c: Context<AppEnv>): Promise<Partial<T>> {
  return (await c.req.json().catch(() => ({}))) as Partial<T>;
}

// ── Rows & views ─────────────────────────────────────────────────────────────

interface CallRow {
  id: string;
  deck_id: string;
  deck_name: string;
  deck_status: string;
  edition: string;
  kind: string;
  scheduled_at: string | null;
  duration_minutes: number;
  title: string | null;
  location: string | null;
  remarks: string | null;
  ics_uid: string | null;
  ics_sequence: number;
  status: string;
  organizer_id: string | null;
  organizer_name: string | null;
  organizer_email: string | null;
  created_at: string;
  updated_at: string | null;
}

interface ParticipantRow {
  id: string;
  call_id: string;
  user_id: string | null;
  email: string;
  name: string | null;
  kind: string;
}

const CALL_SELECT =
  "SELECT c.id, c.deck_id, d.name AS deck_name, d.status AS deck_status, d.edition, c.kind, " +
  "c.scheduled_at, c.duration_minutes, c.title, c.location, c.remarks, c.ics_uid, c.ics_sequence, " +
  "c.status, c.organizer_id, u.name AS organizer_name, u.email AS organizer_email, " +
  "c.created_at, c.updated_at FROM calls c JOIN decks d ON d.id = c.deck_id " +
  "LEFT JOIN users u ON u.id = c.organizer_id";

export interface CallParticipantView {
  id: string;
  userId: string | null;
  email: string;
  name: string | null;
  kind: string;
}

export interface CallView {
  id: string;
  deckId: string;
  deckName: string;
  deckStatus: string;
  kind: CallKind;
  kindLabel: string;
  title: string;
  scheduledAt: string | null;
  durationMinutes: number;
  location: string | null;
  notes: string | null;
  status: string;
  organizerId: string | null;
  organizerName: string | null;
  createdAt: string;
  updatedAt: string | null;
  participants: CallParticipantView[];
  /** True when the caller may reschedule/cancel/invite on this call. */
  canManage: boolean;
}

function defaultTitle(deckName: string, kind: CallKind): string {
  return `${deckName} — ${CALL_KIND_LABELS[kind].toLowerCase()}`;
}

function toCallView(row: CallRow, participants: ParticipantRow[], canManage: boolean): CallView {
  const kind = row.kind as CallKind;
  return {
    id: row.id,
    deckId: row.deck_id,
    deckName: row.deck_name,
    deckStatus: row.deck_status,
    kind,
    kindLabel: CALL_KIND_LABELS[kind] ?? row.kind,
    title: row.title ?? defaultTitle(row.deck_name, kind),
    scheduledAt: row.scheduled_at,
    durationMinutes: row.duration_minutes,
    location: row.location,
    notes: row.remarks,
    status: row.status,
    organizerId: row.organizer_id,
    organizerName: row.organizer_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    participants: participants
      .filter((p) => p.call_id === row.id)
      .map((p) => ({ id: p.id, userId: p.user_id, email: p.email, name: p.name, kind: p.kind })),
    canManage,
  };
}

async function loadParticipants(env: Env, callIds: string[]): Promise<ParticipantRow[]> {
  if (callIds.length === 0) return [];
  const placeholders = callIds.map(() => "?").join(", ");
  return (
    await env.DB.prepare(
      `SELECT id, call_id, user_id, email, name, kind FROM call_participants ` +
        `WHERE call_id IN (${placeholders}) ORDER BY CASE kind WHEN 'organizer' THEN 0 WHEN 'team' THEN 1 ELSE 2 END, name`,
    )
      .bind(...callIds)
      .all<ParticipantRow>()
  ).results;
}

// ── Validation ───────────────────────────────────────────────────────────────

const MAX_PARTICIPANTS = 40; // the send_email binding caps recipients at 50.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

interface ParticipantInput {
  email?: unknown;
  name?: unknown;
  userId?: unknown;
  kind?: unknown;
}

interface NormalisedParticipant {
  email: string;
  name: string | null;
  userId: string | null;
  kind: "organizer" | "team" | "founder";
}

/**
 * Participants are accepted at **any** email domain (§8: "Outlook, Gmail, etc.")
 * — the founder is the point of the invite and will never have a platform login.
 * A `userId` is optional metadata that lets the read-only "my calls" view work.
 */
function normaliseParticipants(raw: unknown): NormalisedParticipant[] | { error: string } {
  if (!Array.isArray(raw)) return [];
  if (raw.length > MAX_PARTICIPANTS) return { error: "too_many_participants" };
  const out: NormalisedParticipant[] = [];
  const seen = new Set<string>();
  for (const item of raw as ParticipantInput[]) {
    const email = typeof item?.email === "string" ? item.email.trim().toLowerCase() : "";
    if (!email) continue;
    if (!EMAIL_RE.test(email)) return { error: "invalid_participant_email" };
    if (seen.has(email)) continue;
    seen.add(email);
    const kind = item?.kind === "founder" ? "founder" : item?.kind === "organizer" ? "organizer" : "team";
    out.push({
      email,
      name: typeof item?.name === "string" && item.name.trim() ? item.name.trim() : null,
      userId: typeof item?.userId === "string" && item.userId ? item.userId : null,
      kind,
    });
  }
  return out;
}

function parseWhen(value: unknown): string | { error: string } | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return { error: "invalid_scheduled_at" };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { error: "invalid_scheduled_at" };
  return date.toISOString();
}

function parseDuration(value: unknown, fallback: number): number | { error: string } {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 5 || n > 8 * 60) return { error: "invalid_duration" };
  return Math.round(n);
}

// ── Visibility ───────────────────────────────────────────────────────────────

/**
 * Restrict the listing for a non-scheduler. A founder sees the calls on their own
 * decks; every other read-only role sees the calls they were invited to (matched
 * on their user id OR their account email, so an invite typed by hand still
 * shows up on their screen).
 */
function visibilityClause(role: string): { sql: string; binds: string[] } | null {
  if (role === "founder") return { sql: " AND d.uploaded_by = ?", binds: [] };
  return {
    sql:
      " AND EXISTS (SELECT 1 FROM call_participants p WHERE p.call_id = c.id " +
      "AND (p.user_id = ? OR lower(p.email) = lower(?)))",
    binds: [],
  };
}

// ── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/calls?deckId=&kind=&mine=1 — the caller's visible calls.
 * Schedulers see the edition's calls; everyone else sees only their own.
 */
calls.get("/", async (c) => {
  const user = c.var.user;
  const scheduler = canScheduleCalls(user.edition as Edition, user.role);
  const deckId = c.req.query("deckId");
  const kind = c.req.query("kind");
  const mineOnly = c.req.query("mine") === "1";

  let sql = `${CALL_SELECT} WHERE d.edition = ?`;
  const binds: (string | number)[] = [user.edition];
  if (deckId) {
    sql += " AND c.deck_id = ?";
    binds.push(deckId);
  }
  if (kind && isCallKind(kind)) {
    sql += " AND c.kind = ?";
    binds.push(kind);
  }
  if (!scheduler || mineOnly) {
    const clause = visibilityClause(user.role);
    if (clause) {
      sql += clause.sql;
      if (user.role === "founder") binds.push(user.id);
      else binds.push(user.id, c.var.user.id);
    }
  }
  sql += " ORDER BY c.scheduled_at IS NULL, c.scheduled_at ASC, c.created_at DESC";

  const rows = (await c.env.DB.prepare(sql).bind(...binds).all<CallRow>()).results;
  const participants = await loadParticipants(c.env, rows.map((r) => r.id));
  return c.json({
    calls: rows.map((r) => toCallView(r, participants, scheduler)),
    canSchedule: scheduler,
    kinds: CALL_KINDS_BY_EDITION[user.edition as Edition],
  });
});

/**
 * GET /api/calls/directory — the edition's active internal users, so the
 * scheduler can tick participants instead of typing addresses.
 *
 * Deliberately NOT `GET /api/users` (admin-only, and it exposes the account
 * management surface): this is a name+email+role read, scoped to the edition,
 * available to exactly the roles that are allowed to schedule. Founders are
 * excluded — the founder is invited by their deck's contact email, not picked
 * from a directory of other people's founders.
 */
calls.get("/directory", async (c) => {
  const user = c.var.user;
  if (!canScheduleCalls(user.edition as Edition, user.role)) return c.json({ error: "forbidden" }, 403);
  const rows = (
    await c.env.DB.prepare(
      "SELECT id, name, email, role FROM users WHERE edition = ? AND active = 1 AND role != 'founder' ORDER BY name",
    )
      .bind(user.edition)
      .all<{ id: string; name: string; email: string; role: string }>()
  ).results;
  return c.json({ people: rows });
});

/** Load one call, edition-scoped, with the caller's visibility applied. */
async function loadVisibleCall(c: Context<AppEnv>, id: string): Promise<CallRow | null> {
  const user = c.var.user;
  const scheduler = canScheduleCalls(user.edition as Edition, user.role);
  let sql = `${CALL_SELECT} WHERE c.id = ? AND d.edition = ?`;
  const binds: string[] = [id, user.edition];
  if (!scheduler) {
    const clause = visibilityClause(user.role);
    if (clause) {
      sql += clause.sql;
      if (user.role === "founder") binds.push(user.id);
      else binds.push(user.id, user.id);
    }
  }
  return c.env.DB.prepare(sql).bind(...binds).first<CallRow>();
}

/**
 * POST /api/calls — schedule a call.
 *
 * Body: `{ deckId, kind, scheduledAt, durationMinutes?, title?, location?,
 *          notes?, participants: [{email, name?, userId?, kind?}], sendInvite? }`
 *
 * When an incubator intro call is scheduled on a deck the jury shortlisted, the
 * matching pipeline transition (`schedule_intro`) is applied in the same request
 * — §8 has the PM *deciding and scheduling* as one act, so the screen shouldn't
 * make them click twice. It is best-effort: if the caller isn't allowed to move
 * the deck, the call is still created and `advanced` comes back false.
 */
calls.post("/", async (c) => {
  const user = c.var.user;
  const edition = user.edition as Edition;
  if (!canScheduleCalls(edition, user.role)) return c.json({ error: "forbidden" }, 403);

  const body = await readBody<{
    deckId: string;
    kind: string;
    scheduledAt: string | null;
    durationMinutes: number;
    title: string;
    location: string;
    notes: string;
    participants: unknown;
    sendInvite: boolean;
  }>(c);

  const deckId = typeof body.deckId === "string" ? body.deckId : "";
  if (!deckId) return c.json({ error: "deck_required" }, 400);
  if (!isCallKind(body.kind)) return c.json({ error: "invalid_kind" }, 400);
  const kind = body.kind;
  if (!(CALL_KINDS_BY_EDITION[edition] as readonly string[]).includes(kind)) {
    return c.json({ error: "kind_not_in_edition" }, 400);
  }

  const deck = await c.env.DB.prepare("SELECT id, name, status FROM decks WHERE id = ? AND edition = ?")
    .bind(deckId, edition)
    .first<{ id: string; name: string; status: string }>();
  if (!deck) return c.json({ error: "not_found" }, 404);

  const when = parseWhen(body.scheduledAt);
  if (when && typeof when !== "string") return c.json({ error: when.error }, 400);
  const duration = parseDuration(body.durationMinutes, 30);
  if (typeof duration !== "number") return c.json({ error: duration.error }, 400);
  const participants = normaliseParticipants(body.participants);
  if (!Array.isArray(participants)) return c.json({ error: participants.error }, 400);

  const id = `call_${crypto.randomUUID()}`;
  const ts = new Date().toISOString();
  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : defaultTitle(deck.name, kind);
  const location = typeof body.location === "string" && body.location.trim() ? body.location.trim() : null;
  const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;

  // The organizer is always on their own invite (calendar clients expect it).
  const withOrganizer = participants.some((p) => p.userId === user.id)
    ? participants
    : [
        {
          email: (await organizerEmail(c.env, user.id)) ?? `${user.id}@startup-jury.invalid`,
          name: user.name,
          userId: user.id,
          kind: "organizer" as const,
        },
        ...participants,
      ];

  const stmts = [
    c.env.DB.prepare(
      "INSERT INTO calls (id, deck_id, kind, scheduled_at, duration_minutes, title, location, remarks, " +
        "ics_uid, ics_sequence, status, organizer_id, created_by, created_at, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)",
    ).bind(
      id,
      deckId,
      kind,
      when ?? null,
      duration,
      title,
      location,
      notes,
      `${id}@startup-jury`,
      when ? "scheduled" : "draft",
      user.id,
      user.id,
      ts,
      ts,
    ),
    ...withOrganizer.map((p) =>
      c.env.DB.prepare(
        "INSERT INTO call_participants (id, call_id, user_id, email, name, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).bind(`cpt_${crypto.randomUUID()}`, id, p.userId, p.email, p.name, p.kind, ts),
    ),
  ];

  // Scheduling the intro call IS the incubator's post-shortlist decision.
  let advanced = false;
  if (edition === "incubator" && kind === "intro") {
    const move = performAction(edition, deck.status, "schedule_intro", user.role);
    if (move.ok) {
      advanced = true;
      stmts.push(
        c.env.DB.prepare("UPDATE decks SET status = ?, updated_at = ? WHERE id = ?").bind(move.to, ts, deckId),
        c.env.DB.prepare(
          "INSERT INTO pipeline_events (id, deck_id, actor_id, from_stage, to_stage, action, note, created_at) " +
            "VALUES (?, ?, ?, ?, ?, 'schedule_intro', ?, ?)",
        ).bind(
          `evt_${crypto.randomUUID()}`,
          deckId,
          user.id,
          deck.status,
          move.to,
          `Intro call scheduled${when ? ` for ${when}` : ""}`,
          ts,
        ),
      );
    }
  }

  await c.env.DB.batch(stmts);

  const invited = body.sendInvite === true ? await dispatchInvite(c, id) : { sent: 0 };
  const row = await loadVisibleCall(c, id);
  const parts = await loadParticipants(c.env, [id]);
  return c.json({
    ok: true,
    advanced,
    invited: invited.sent,
    call: row ? toCallView(row, parts, true) : null,
  });
});

async function organizerEmail(env: Env, userId: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT email FROM users WHERE id = ?")
    .bind(userId)
    .first<{ email: string }>();
  return row?.email ?? null;
}

/**
 * PATCH /api/calls/:id — reschedule, edit or cancel.
 * Any change bumps `ics_sequence` so a re-issued invite UPDATES the attendee's
 * existing calendar entry (same UID, higher SEQUENCE) instead of duplicating it.
 */
calls.patch("/:id", async (c) => {
  const user = c.var.user;
  const edition = user.edition as Edition;
  if (!canScheduleCalls(edition, user.role)) return c.json({ error: "forbidden" }, 403);

  const id = c.req.param("id");
  const existing = await loadVisibleCall(c, id);
  if (!existing) return c.json({ error: "not_found" }, 404);

  const body = await readBody<{
    scheduledAt: string | null;
    durationMinutes: number;
    title: string;
    location: string;
    notes: string;
    status: string;
    participants: unknown;
    sendInvite: boolean;
  }>(c);

  const sets: string[] = [];
  const binds: (string | number | null)[] = [];

  if ("scheduledAt" in body) {
    const when = parseWhen(body.scheduledAt);
    if (when && typeof when !== "string") return c.json({ error: when.error }, 400);
    sets.push("scheduled_at = ?", "status = ?");
    binds.push(when ?? null, when ? "scheduled" : "draft");
  }
  if ("durationMinutes" in body) {
    const duration = parseDuration(body.durationMinutes, existing.duration_minutes);
    if (typeof duration !== "number") return c.json({ error: duration.error }, 400);
    sets.push("duration_minutes = ?");
    binds.push(duration);
  }
  if (typeof body.title === "string") {
    sets.push("title = ?");
    binds.push(body.title.trim() || defaultTitle(existing.deck_name, existing.kind as CallKind));
  }
  if (typeof body.location === "string") {
    sets.push("location = ?");
    binds.push(body.location.trim() || null);
  }
  if (typeof body.notes === "string") {
    sets.push("remarks = ?");
    binds.push(body.notes.trim() || null);
  }
  // Aug-2026 issue 27 — the Intro calls screen has a "Call completed" column, so
  // a scheduler can close a call out (and reopen one closed by mistake).
  if (body.status === "cancelled" || body.status === "completed") {
    sets.push("status = ?");
    binds.push(body.status);
  } else if (body.status === "scheduled" && existing.scheduled_at) {
    sets.push("status = ?");
    binds.push("scheduled");
  }

  const replaceParticipants = "participants" in body;
  let participants: NormalisedParticipant[] = [];
  if (replaceParticipants) {
    const parsed = normaliseParticipants(body.participants);
    if (!Array.isArray(parsed)) return c.json({ error: parsed.error }, 400);
    participants = parsed;
  }

  if (sets.length === 0 && !replaceParticipants) return c.json({ error: "nothing_to_update" }, 400);

  const ts = new Date().toISOString();
  const stmts = [];
  if (sets.length > 0) {
    stmts.push(
      c.env.DB.prepare(
        `UPDATE calls SET ${sets.join(", ")}, ics_sequence = ics_sequence + 1, updated_at = ? WHERE id = ?`,
      ).bind(...binds, ts, id),
    );
  } else {
    stmts.push(
      c.env.DB.prepare("UPDATE calls SET ics_sequence = ics_sequence + 1, updated_at = ? WHERE id = ?").bind(ts, id),
    );
  }
  if (replaceParticipants) {
    stmts.push(c.env.DB.prepare("DELETE FROM call_participants WHERE call_id = ?").bind(id));
    for (const p of participants) {
      stmts.push(
        c.env.DB.prepare(
          "INSERT INTO call_participants (id, call_id, user_id, email, name, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ).bind(`cpt_${crypto.randomUUID()}`, id, p.userId, p.email, p.name, p.kind, ts),
      );
    }
  }
  await c.env.DB.batch(stmts);

  const invited = body.sendInvite === true ? await dispatchInvite(c, id) : { sent: 0 };
  const row = await loadVisibleCall(c, id);
  const parts = await loadParticipants(c.env, [id]);
  return c.json({ ok: true, invited: invited.sent, call: row ? toCallView(row, parts, true) : null });
});

// ── ICS generation ───────────────────────────────────────────────────────────

function icsFor(row: CallRow, participants: ParticipantRow[], fallbackFrom: string): string {
  const kind = row.kind as CallKind;
  const attendees: IcsAttendee[] = participants.map((p) => ({
    email: p.email,
    name: p.name,
    role: p.kind === "founder" ? "REQ-PARTICIPANT" : "REQ-PARTICIPANT",
  }));
  return buildIcs({
    uid: row.ics_uid ?? `${row.id}@startup-jury`,
    // A draft with no date still produces a valid file — anchored at its
    // creation time — so the organizer can sanity-check the invite before
    // committing to a slot.
    start: row.scheduled_at ?? row.created_at,
    durationMinutes: row.duration_minutes,
    summary: row.title ?? defaultTitle(row.deck_name, kind),
    description: row.remarks,
    location: row.location,
    organizer: {
      email: row.organizer_email ?? fallbackFrom,
      name: row.organizer_name,
    },
    attendees,
    sequence: row.ics_sequence,
    status: row.status === "cancelled" ? "CANCELLED" : "CONFIRMED",
    method: row.status === "cancelled" ? "CANCEL" : "REQUEST",
    stamp: row.updated_at ?? row.created_at,
    alarmMinutesBefore: 15,
  });
}

const FALLBACK_ORGANIZER = "no-reply@startup-jury.invalid";

/**
 * GET /api/calls/:id/ics — download the invite. Available to anyone who can see
 * the call, so an invited jury/IC member can add it to their own calendar
 * without waiting on (or needing) the email path.
 */
calls.get("/:id/ics", async (c) => {
  const row = await loadVisibleCall(c, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  const parts = await loadParticipants(c.env, [row.id]);
  const body = icsFor(row, parts, c.env.EMAIL_FROM?.trim() || FALLBACK_ORGANIZER);
  return new Response(body, {
    headers: {
      "content-type": ICS_CONTENT_TYPE,
      "content-disposition": `attachment; filename="${icsFilename(row.title ?? row.deck_name)}"`,
      "cache-control": "no-store",
    },
  });
});

/** Compose + send one invite per participant, with the .ics attached. */
async function dispatchInvite(c: Context<AppEnv>, callId: string): Promise<{ sent: number }> {
  const row = await c.env.DB.prepare(`${CALL_SELECT} WHERE c.id = ?`).bind(callId).first<CallRow>();
  if (!row) return { sent: 0 };
  const parts = await loadParticipants(c.env, [callId]);
  if (parts.length === 0) return { sent: 0 };

  const ics = icsFor(row, parts, c.env.EMAIL_FROM?.trim() || FALLBACK_ORGANIZER);
  const kind = row.kind as CallKind;
  const cancelled = row.status === "cancelled";
  const { subject, body, html } = buildCallInviteEmail({
    deckName: row.deck_name,
    callTitle: row.title ?? defaultTitle(row.deck_name, kind),
    kindLabel: CALL_KIND_LABELS[kind] ?? row.kind,
    whenLabel: formatWhen(row.scheduled_at),
    durationMinutes: row.duration_minutes,
    location: row.location,
    organizerName: row.organizer_name,
    participantNames: parts.map((p) => p.name ?? p.email),
    notes: row.remarks,
    cancelled,
  });

  const attachments = [
    {
      content: ics,
      filename: icsFilename(row.title ?? row.deck_name),
      type: ICS_CONTENT_TYPE,
      disposition: "attachment" as const,
    },
  ];

  let sent = 0;
  for (const p of parts) {
    // One message per participant, keyed on the call + its sequence, so a double
    // click on "Send invite" doesn't spam anyone but a genuine reschedule does
    // re-send (the sequence bumped).
    await sendEmail(c.env, {
      kind: "call_invite",
      toEmail: p.email,
      toName: p.name,
      subject,
      body,
      html,
      deckId: row.deck_id,
      dedupeKey: `call:${callId}:s${row.ics_sequence}:${p.email}`,
      attachments,
    });
    sent += 1;
  }
  return { sent };
}

/** Human-readable UTC label for the email body. */
export function formatWhen(iso: string | null): string {
  if (!iso) return "To be confirmed";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "To be confirmed";
  return `${new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(date)} UTC`;
}

/** POST /api/calls/:id/invite — (re)send the invite to every participant. */
calls.post("/:id/invite", async (c) => {
  const user = c.var.user;
  if (!canScheduleCalls(user.edition as Edition, user.role)) return c.json({ error: "forbidden" }, 403);
  const row = await loadVisibleCall(c, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  if (!row.scheduled_at) return c.json({ error: "not_scheduled" }, 409);
  const { sent } = await dispatchInvite(c, row.id);
  return c.json({ ok: true, invited: sent });
});

export { calls };
