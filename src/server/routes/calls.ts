// Session 7 — call scheduling with ICS invites.
//
// FINISH-PLAN §8 settled scheduling in one line: the app generates a **universal
// `.ics`** for intro / partner / alignment calls, the organizer picks the
// participants (team + founder, any email domain), and that is the whole
// feature — no availability polling, no reschedule negotiation. So this router
// is deliberately small: create a call, hand back a calendar file, optionally
// mail it, and let the people on the call read it back.
//
// AuthZ has three tiers:
//   • **Schedulers** (`CALL_SCHEDULER_ROLES` — incubator PM/associate, VC
//     partner/associate, plus admin/superuser) create, reschedule and cancel.
//   • **A delegated scheduler** (W9-E, `call_schedulers`, §8 Q102) has the same
//     rights on ONE deck's call of ONE kind, whatever their role. Only a
//     scheduler role may name one.
//   • **Everyone else** is read-only and sees ONLY the calls they are a
//     participant on. That is §8's "jury/IC members involved in a call can view
//     their calls", and it means the IC member's calendar view can't be turned
//     into a listing of every deal the firm is talking to. The one write they
//     have (W7-F §9, §8 Q103) is closing out — or reopening — a call they are ON:
//     `status` only, `completed` ⇄ `scheduled`, nothing else.

import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv, Env } from "../types";
import { denyMentor, requireAuth } from "../auth/middleware";
import {
  CALL_KIND_LABELS,
  CALL_KINDS_BY_EDITION,
  MENTOR_ROLE,
  canScheduleCalls,
  isCallKind,
  type CallKind,
  type Edition,
} from "../../shared/roles";
import { callDecision, outcomeForAction, recordedOutcome, CALL_DECISIONS } from "../../shared/callOutcomes";
import { buildIcs, icsFilename, ICS_CONTENT_TYPE, type IcsAttendee } from "../../shared/ics";
import { introCallPrompts } from "../config/callPrompts";
import { buildCallInviteEmail, emitNotification, sendEmail } from "../email/outbox";
import { getPipeline, performAction } from "../../pipeline";

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
  /**
   * True when the caller may set `completed` ⇄ `scheduled` — everyone who may
   * manage it, plus anyone who is ON the call (W7-F §9, §8 Q103).
   */
  canComplete: boolean;
}

function defaultTitle(deckName: string, kind: CallKind): string {
  return `${deckName} — ${CALL_KIND_LABELS[kind].toLowerCase()}`;
}

function toCallView(
  row: CallRow,
  participants: ParticipantRow[],
  canManage: boolean,
  canComplete: boolean = canManage,
): CallView {
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
    canComplete: canManage || canComplete,
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
 * "Is the caller on this call?" — their user id on a participant row, OR their
 * account email on one, so an invite typed by hand still counts. Binds the user
 * id twice. (Until W9-E the email half bound the user's ID — `SessionUser` has
 * no email — so it could never match; it now reads the account's email.)
 */
const ON_CALL_SQL =
  "EXISTS (SELECT 1 FROM call_participants p WHERE p.call_id = c.id " +
  "AND (p.user_id = ? OR lower(p.email) = (SELECT lower(email) FROM users WHERE id = ?)))";

/** "Was the caller delegated this deck's call of this kind?" Binds the user id once. */
const DELEGATE_SQL =
  "EXISTS (SELECT 1 FROM call_schedulers s WHERE s.deck_id = c.deck_id AND s.kind = c.kind AND s.user_id = ?)";

/**
 * Restrict the listing for a non-scheduler. A founder sees the calls on their own
 * decks; every other read-only role sees the calls they were invited to, and the
 * calls they were delegated to schedule.
 */
function visibilityClause(role: string, userId: string): { sql: string; binds: string[] } {
  if (role === "founder") return { sql: " AND d.uploaded_by = ?", binds: [userId] };
  return { sql: ` AND (${ON_CALL_SQL} OR ${DELEGATE_SQL})`, binds: [userId, userId, userId] };
}

/** Who the caller is to the calls router: a scheduler, and/or a delegate on some (deck, kind). */
interface CallerScope {
  scheduler: boolean;
  /** `${deckId}:${kind}` for every call this caller was delegated. */
  delegated: Set<string>;
}

async function callerScope(c: Context<AppEnv>): Promise<CallerScope> {
  const user = c.var.user;
  const rows = (
    await c.env.DB.prepare(
      "SELECT s.deck_id, s.kind FROM call_schedulers s JOIN decks d ON d.id = s.deck_id " +
        "WHERE s.user_id = ? AND d.edition = ?",
    )
      .bind(user.id, user.edition)
      .all<{ deck_id: string; kind: string }>()
  ).results;
  return {
    scheduler: canScheduleCalls(user.edition as Edition, user.role),
    delegated: new Set(rows.map((r) => `${r.deck_id}:${r.kind}`)),
  };
}

function mayManage(scope: CallerScope, deckId: string, kind: string): boolean {
  return scope.scheduler || scope.delegated.has(`${deckId}:${kind}`);
}

async function userEmail(env: Env, userId: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(userId).first<{ email: string }>();
  return row?.email?.toLowerCase() ?? null;
}

function isOnCall(callId: string, participants: ParticipantRow[], userId: string, email: string | null): boolean {
  return participants.some(
    (p) => p.call_id === callId && (p.user_id === userId || (email !== null && p.email.toLowerCase() === email)),
  );
}

/** A delegation as the screen draws it: "<user> · <role>". */
export interface CallSchedulerView {
  deckId: string;
  kind: CallKind;
  userId: string;
  userName: string;
  role: string;
  assignedAt: string;
}

/**
 * A deck this call's stage has DECIDED (F0627 — agreed with `W9-B`, §9): the
 * latest `pipeline_events` row leaving the stage set, for a deck not currently
 * back inside it. Read from the event, never inferred from where the deck is
 * now — a deal sponsored at partner call and passed at IC still reads "Sponsor
 * to IC" here.
 */
export interface DecidedCallView {
  deckId: string;
  action: string;
  outcome: string;
  toStage: string;
  decidedAt: string;
}

async function decidedDecks(env: Env, edition: Edition, kind: CallKind): Promise<DecidedCallView[]> {
  const decision = callDecision(edition, kind);
  if (!decision) return [];
  const marks = decision.stages.map(() => "?").join(", ");
  const rows = (
    await env.DB.prepare(
      "SELECT e.id, e.deck_id, e.action, e.to_stage, e.created_at FROM pipeline_events e " +
        "JOIN decks d ON d.id = e.deck_id " +
        `WHERE d.edition = ? AND e.from_stage IN (${marks}) AND e.to_stage NOT IN (${marks}) ` +
        `AND d.status NOT IN (${marks}) ORDER BY e.created_at DESC, e.id DESC`,
    )
      .bind(edition, ...decision.stages, ...decision.stages, ...decision.stages)
      .all<{ id: string; deck_id: string; action: string; to_stage: string; created_at: string }>()
  ).results;
  const transitions = getPipeline(edition).transitions;
  const seen = new Set<string>();
  const out: DecidedCallView[] = [];
  for (const r of rows) {
    if (seen.has(r.deck_id)) continue;
    seen.add(r.deck_id);
    out.push({
      deckId: r.deck_id,
      action: r.action,
      outcome:
        outcomeForAction(decision, r.action)?.label ??
        transitions.find((t) => t.action === r.action)?.label ??
        r.action,
      toStage: r.to_stage,
      decidedAt: r.created_at,
    });
  }
  return out;
}

/** The roles a stage's own transitions name — who may record an outcome there. */
function decidingRoles(edition: Edition, stages: readonly string[]): Set<string> {
  return new Set(
    getPipeline(edition)
      .transitions.filter((t) => stages.includes(t.from))
      .flatMap((t) => t.roles as readonly string[]),
  );
}

// ── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/calls?deckId=&kind=&mine=1 — the caller's visible calls.
 * Schedulers see the edition's calls; everyone else sees only their own.
 *
 * W9-E — alongside the calls, for the screen that asked for one `kind`:
 * `schedulers` (the Assign scheduler delegations), `decided` (decks the kind's
 * stage has decided, F0627), `outcomes` (recorded Renegotiate / Hold) and
 * `canDecide` (whether the caller may record one). A non-scheduler gets each
 * narrowed to the decks they can see a call on — or were delegated.
 */
calls.get("/", async (c) => {
  const user = c.var.user;
  const edition = user.edition as Edition;
  const scope = await callerScope(c);
  const scheduler = scope.scheduler;
  const deckId = c.req.query("deckId");
  const rawKind = c.req.query("kind");
  const kind = rawKind && isCallKind(rawKind) ? rawKind : null;
  const mineOnly = c.req.query("mine") === "1";

  let sql = `${CALL_SELECT} WHERE d.edition = ?`;
  const binds: (string | number)[] = [user.edition];
  if (deckId) {
    sql += " AND c.deck_id = ?";
    binds.push(deckId);
  }
  if (kind) {
    sql += " AND c.kind = ?";
    binds.push(kind);
  }
  if (!scheduler || mineOnly) {
    const clause = visibilityClause(user.role, user.id);
    sql += clause.sql;
    binds.push(...clause.binds);
  }
  sql += " ORDER BY c.scheduled_at IS NULL, c.scheduled_at ASC, c.created_at DESC";

  const rows = (await c.env.DB.prepare(sql).bind(...binds).all<CallRow>()).results;
  const participants = await loadParticipants(c.env, rows.map((r) => r.id));
  const email = await userEmail(c.env, user.id);

  let schedulerSql =
    "SELECT s.deck_id, s.kind, s.user_id, u.name AS user_name, u.role, s.assigned_at FROM call_schedulers s " +
    "JOIN decks d ON d.id = s.deck_id JOIN users u ON u.id = s.user_id WHERE d.edition = ?";
  const schedulerBinds: string[] = [user.edition];
  if (kind) {
    schedulerSql += " AND s.kind = ?";
    schedulerBinds.push(kind);
  }
  if (!scheduler) {
    schedulerSql += " AND s.user_id = ?";
    schedulerBinds.push(user.id);
  }
  const schedulers: CallSchedulerView[] = (
    await c.env.DB.prepare(schedulerSql)
      .bind(...schedulerBinds)
      .all<{ deck_id: string; kind: string; user_id: string; user_name: string; role: string; assigned_at: string }>()
  ).results.map((r) => ({
    deckId: r.deck_id,
    kind: r.kind as CallKind,
    userId: r.user_id,
    userName: r.user_name,
    role: r.role,
    assignedAt: r.assigned_at,
  }));

  // What a non-scheduler may learn about decisions: only decks they are on a
  // call for (or were delegated). A scheduler sees the stage.
  const visibleDecks = new Set([...rows.map((r) => r.deck_id), ...schedulers.map((s) => s.deckId)]);
  const narrow = <T extends { deckId: string }>(list: T[]) =>
    scheduler ? list : list.filter((x) => visibleDecks.has(x.deckId));

  const decision = kind ? callDecision(edition, kind) : undefined;
  const decided = kind ? narrow(await decidedDecks(c.env, edition, kind)) : [];
  const outcomes =
    kind && decision
      ? narrow(
          (
            await c.env.DB.prepare(
              "SELECT o.deck_id, o.outcome, o.set_at FROM call_outcomes o JOIN decks d ON d.id = o.deck_id " +
                `WHERE d.edition = ? AND o.kind = ? AND d.status IN (${decision.stages.map(() => "?").join(", ")})`,
            )
              .bind(edition, kind, ...decision.stages)
              .all<{ deck_id: string; outcome: string; set_at: string }>()
          ).results.map((r) => ({ deckId: r.deck_id, outcome: r.outcome, setAt: r.set_at })),
        )
      : [];

  return c.json({
    calls: rows.map((r) =>
      toCallView(
        r,
        participants,
        mayManage(scope, r.deck_id, r.kind),
        isOnCall(r.id, participants, user.id, email),
      ),
    ),
    canSchedule: scheduler,
    kinds: CALL_KINDS_BY_EDITION[edition],
    schedulers,
    decided,
    outcomes,
    canDecide: decision ? decidingRoles(edition, decision.stages).has(user.role) : false,
  });
});

/**
 * PUT /api/calls/scheduler — Intro calls' "Assign scheduler" (`ncAssign`, §8 Q102).
 *
 * Body: `{ deckId, kind, userId }`; `userId: null` clears it ("Change" re-opens the
 * picker; picking again replaces). Scheduler roles only — a delegate cannot pass
 * the delegation on. The assignee must be an active member of the edition who can
 * hold a pipeline role: never a founder, never a mentor (a directory record).
 */
calls.put("/scheduler", async (c) => {
  const user = c.var.user;
  const edition = user.edition as Edition;
  if (!canScheduleCalls(edition, user.role)) return c.json({ error: "forbidden" }, 403);

  const body = await readBody<{ deckId: string; kind: string; userId: string | null }>(c);
  const deckId = typeof body.deckId === "string" ? body.deckId : "";
  if (!deckId) return c.json({ error: "deck_required" }, 400);
  if (!isCallKind(body.kind) || !(CALL_KINDS_BY_EDITION[edition] as readonly string[]).includes(body.kind)) {
    return c.json({ error: "invalid_kind" }, 400);
  }
  const kind = body.kind;
  if (!("userId" in body) || (body.userId !== null && typeof body.userId !== "string")) {
    return c.json({ error: "user_required" }, 400);
  }
  const deck = await c.env.DB.prepare("SELECT id FROM decks WHERE id = ? AND edition = ?")
    .bind(deckId, edition)
    .first<{ id: string }>();
  if (!deck) return c.json({ error: "not_found" }, 404);

  if (body.userId === null) {
    await c.env.DB.prepare("DELETE FROM call_schedulers WHERE deck_id = ? AND kind = ?").bind(deckId, kind).run();
    return c.json({ ok: true, scheduler: null });
  }

  const assignee = await c.env.DB.prepare(
    "SELECT id, name, role FROM users WHERE id = ? AND edition = ? AND active = 1",
  )
    .bind(body.userId, edition)
    .first<{ id: string; name: string; role: string }>();
  if (!assignee) return c.json({ error: "invalid_user" }, 400);
  if (assignee.role === "founder" || assignee.role === MENTOR_ROLE) return c.json({ error: "invalid_user" }, 400);

  const ts = new Date().toISOString();
  await c.env.DB.prepare(
    "INSERT INTO call_schedulers (deck_id, kind, user_id, assigned_by, assigned_at) VALUES (?, ?, ?, ?, ?) " +
      "ON CONFLICT (deck_id, kind) DO UPDATE SET user_id = excluded.user_id, assigned_by = excluded.assigned_by, " +
      "assigned_at = excluded.assigned_at",
  )
    .bind(deckId, kind, assignee.id, user.id, ts)
    .run();
  const view: CallSchedulerView = {
    deckId,
    kind,
    userId: assignee.id,
    userName: assignee.name,
    role: assignee.role,
    assignedAt: ts,
  };
  return c.json({ ok: true, scheduler: view });
});

/**
 * PUT /api/calls/outcome — record an outcome that is NOT a transition
 * (Alignment call's Renegotiate / Hold, F0558). `outcome: null` clears it.
 *
 * An outcome that is a transition (Sponsor to IC, Issue term sheet…) is refused
 * here: it goes through `POST /api/decks/:id/transition`, which owns the move,
 * its side effects and the event row this router reads back.
 *
 * Gated like the stage's own transitions: only a role one of them names may
 * decide, and only while the deck is at that stage.
 */
calls.put("/outcome", async (c) => {
  const user = c.var.user;
  const edition = user.edition as Edition;
  const anyStages = Object.values(CALL_DECISIONS[edition]).flatMap((d) => d?.stages ?? []);
  if (!decidingRoles(edition, anyStages).has(user.role)) return c.json({ error: "forbidden" }, 403);

  const body = await readBody<{ deckId: string; kind: string; outcome: string | null }>(c);
  const deckId = typeof body.deckId === "string" ? body.deckId : "";
  if (!deckId) return c.json({ error: "deck_required" }, 400);
  const decision = isCallKind(body.kind) ? callDecision(edition, body.kind) : undefined;
  if (!decision || !isCallKind(body.kind)) return c.json({ error: "invalid_kind" }, 400);
  const kind = body.kind;
  if (body.outcome !== null && (typeof body.outcome !== "string" || !recordedOutcome(decision, body.outcome))) {
    return c.json({ error: "invalid_outcome" }, 400);
  }
  if (!decidingRoles(edition, decision.stages).has(user.role)) return c.json({ error: "forbidden" }, 403);

  const deck = await c.env.DB.prepare("SELECT id, status FROM decks WHERE id = ? AND edition = ?")
    .bind(deckId, edition)
    .first<{ id: string; status: string }>();
  if (!deck) return c.json({ error: "not_found" }, 404);
  if (!decision.stages.includes(deck.status)) return c.json({ error: "not_at_stage" }, 409);

  if (body.outcome === null) {
    await c.env.DB.prepare("DELETE FROM call_outcomes WHERE deck_id = ? AND kind = ?").bind(deckId, kind).run();
    return c.json({ ok: true, outcome: null });
  }
  const ts = new Date().toISOString();
  await c.env.DB.prepare(
    "INSERT INTO call_outcomes (deck_id, kind, outcome, set_by, set_at) VALUES (?, ?, ?, ?, ?) " +
      "ON CONFLICT (deck_id, kind) DO UPDATE SET outcome = excluded.outcome, set_by = excluded.set_by, set_at = excluded.set_at",
  )
    .bind(deckId, kind, body.outcome, user.id, ts)
    .run();
  return c.json({ ok: true, outcome: { deckId, outcome: body.outcome, setAt: ts } });
});

/**
 * GET /api/calls/directory — the edition's active internal users, so the
 * scheduler can tick participants instead of typing addresses.
 *
 * Deliberately NOT `GET /api/users` (admin-only, and it exposes the account
 * management surface): this is a name+email+role read, scoped to the edition,
 * available to exactly the roles that are allowed to schedule — and to anyone
 * delegated a call, who needs the same roster to book it. Founders are
 * excluded — the founder is invited by their deck's contact email, not picked
 * from a directory of other people's founders.
 */
calls.get("/directory", async (c) => {
  const user = c.var.user;
  const scope = await callerScope(c);
  if (!scope.scheduler && scope.delegated.size === 0) return c.json({ error: "forbidden" }, 403);
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
    const clause = visibilityClause(user.role, user.id);
    sql += clause.sql;
    binds.push(...clause.binds);
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
  const scope = await callerScope(c);
  // A delegate may book only the (deck, kind) they were given; checked below,
  // once the body names it. Nobody else gets as far as reading the body.
  if (!scope.scheduler && scope.delegated.size === 0) return c.json({ error: "forbidden" }, 403);

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
  if (!scope.scheduler && !(deckId && isCallKind(body.kind) && mayManage(scope, deckId, body.kind))) {
    return c.json({ error: "forbidden" }, 403);
  }
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
  // A draft with no slot yet is not a scheduled call — nothing to announce.
  if (row?.scheduled_at) await announceCall(c, row, false);
  return c.json({
    ok: true,
    advanced,
    invited: invited.sent,
    call: row ? toCallView(row, parts, true) : null,
  });
});

/** The one PATCH a participant may send: `{ status: "completed" | "scheduled" }`, nothing else. */
function isCompletionOnly(body: Record<string, unknown>): body is { status: "completed" | "scheduled" } {
  const keys = Object.keys(body);
  return keys.length === 1 && keys[0] === "status" && (body.status === "completed" || body.status === "scheduled");
}

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
  const scope = await callerScope(c);
  const id = c.req.param("id");
  const existing = await loadVisibleCall(c, id);
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

  if (!scope.scheduler && !(existing && mayManage(scope, existing.deck_id, existing.kind))) {
    // W7-F §9 / §8 Q103 — a participant closes out (or reopens) THEIR call. Any
    // other field, any other status, or a call they are not on is refused with
    // the same 403 a non-scheduler has always had, so it reveals nothing.
    if (!existing || user.role === "founder" || !isCompletionOnly(body as Record<string, unknown>)) {
      return c.json({ error: "forbidden" }, 403);
    }
    const onCall = isOnCall(existing.id, await loadParticipants(c.env, [existing.id]), user.id, await userEmail(c.env, user.id));
    if (!onCall) return c.json({ error: "forbidden" }, 403);
    if (existing.status !== "scheduled" && existing.status !== "completed") {
      return c.json({ error: "not_scheduled" }, 409);
    }
  }
  if (!existing) return c.json({ error: "not_found" }, 404);

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
  // Only a genuine move of the slot is a reschedule. Editing a title or
  // cancelling is neither of the two things the alert's label names.
  const moved = row?.scheduled_at && row.scheduled_at !== existing.scheduled_at;
  if (row && moved && row.status !== "cancelled") await announceCall(c, row, Boolean(existing.scheduled_at));
  const manage = mayManage(scope, existing.deck_id, existing.kind);
  return c.json({
    ok: true,
    invited: invited.sent,
    call: row ? toCallView(row, parts, manage, true) : null,
  });
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
 * GET /api/calls/:id/prompts — the AI's suggested questions for this call.
 *
 * Admin console → Scoring framework → "Intro call AI question prompts enabled"
 * (F0110). Derived from the deck's own AI evaluation: its weakest areas, the
 * slides the extraction found missing, and the intake details still absent.
 * With the toggle off the list is empty and `enabled` says why, so the call
 * screen can drop the block rather than render an unexplained blank.
 *
 * Visible to anyone who can see the call — the prompts are for whoever is on it.
 */
calls.get("/:id/prompts", async (c) => {
  const row = await loadVisibleCall(c, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json(await introCallPrompts(c.env, c.var.user.edition as Edition, row.deck_id));
});

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

/**
 * W3-B producer — "Intro call scheduled or rescheduled".
 *
 * Distinct from `dispatchInvite` above, which mails the PARTICIPANTS a calendar
 * file because a scheduler pressed Send invite. This is the account-holder
 * alert the Notifications section governs: the programme staff hear that a call
 * exists whether or not anyone chose to send invites, which is F0016's point —
 * `call_invite` was the one prototype event with any producing code, and it was
 * producing the wrong thing.
 *
 * Keyed on the call's `ics_sequence`, the same counter the .ics uses to make a
 * re-issue an UPDATE rather than a duplicate, so a reschedule alerts exactly
 * once and a repeated save of the same slot does not alert at all.
 */
async function announceCall(
  c: Context<AppEnv>,
  row: CallRow,
  rescheduled: boolean,
): Promise<void> {
  const kindLabel = CALL_KIND_LABELS[row.kind as CallKind] ?? row.kind;
  const verb = rescheduled ? "rescheduled" : "scheduled";
  await emitNotification(c.env, {
    event: "intro_call_scheduled",
    edition: row.edition as Edition,
    title: `${kindLabel} ${verb}: ${row.deck_name}`,
    body:
      `The ${kindLabel.toLowerCase()} for ${row.deck_name} is ${verb} for ` +
      `${formatWhen(row.scheduled_at)} (${row.duration_minutes} min).` +
      (row.location ? `\nWhere: ${row.location}` : ""),
    link: `/app/calls`,
    deckId: row.deck_id,
    // The organiser hears about their own call even if their role is not in the
    // event's audience — they are the one person certain to care.
    alsoNotify: [row.organizer_id],
    actorId: c.var.user.id,
    dedupeKey: `intro_call_scheduled:${row.id}:s${row.ics_sequence}`,
  });
}

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
  const scope = await callerScope(c);
  if (!scope.scheduler && scope.delegated.size === 0) return c.json({ error: "forbidden" }, 403);
  const row = await loadVisibleCall(c, c.req.param("id"));
  if (!scope.scheduler && !(row && mayManage(scope, row.deck_id, row.kind))) return c.json({ error: "forbidden" }, 403);
  if (!row) return c.json({ error: "not_found" }, 404);
  if (!row.scheduled_at) return c.json({ error: "not_scheduled" }, 409);
  const { sent } = await dispatchInvite(c, row.id);
  return c.json({ ok: true, invited: sent });
});

export { calls };
