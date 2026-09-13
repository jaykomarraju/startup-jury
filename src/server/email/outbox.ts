// Transactional email. Delivery goes through **Cloudflare Email Sending** (the
// `send_email` binding, `EMAIL` on Env) when the Worker is configured with one;
// `email_outbox` stays the audit log of every message the app produced.
//
// Session 6 replaced the Phase-4 stub. The recorded shape is unchanged, so every
// existing caller is untouched — only `status` grew:
//
//   'sent'     — Cloudflare Email Sending accepted the message
//   'failed'   — a send was attempted and threw (the reason lands in `error`)
//   'recorded' — no binding / no from-address configured, so the message was
//                audited only. This is the pre-Session-6 behaviour and is what
//                local dev + the test suite exercise (Miniflare has no email
//                emulator). It is deliberately NOT reported as 'sent': the
//                outbox must never claim a delivery that never happened.
//
// `dedupeKey` makes a notification idempotent. `evaluateDeck` can legitimately
// re-run over unchanged deck content (a queue retry, a manual re-score), and the
// founder must not be emailed again for it — but a NEW deck version that is
// still incomplete must send. Keying on the deck's content version gives exactly
// that. The UNIQUE index on `email_outbox.dedupe_key` closes the concurrent-run
// race that a plain read-then-write check would leave open.

import type { Env } from "../types";
import type { Edition, Role } from "../../shared/roles";
import { isMentor } from "../../shared/roles";
import { describeMissingFields, type IntakeField } from "../../shared/intake";
import {
  NOTIFICATION_DEFAULTS,
  type NotificationChannel,
  type NotificationEvent,
} from "../../shared/notifications";

/**
 * The six transactional kinds, plus one `alert_<event>` kind per prototype
 * notification event (W3-B). The alert kinds are what make "this producer
 * exists" a testable claim: the assertion is one `email_outbox` row of exactly
 * this kind when the toggle is on and none when it is off, rather than a count
 * of undifferentiated mail.
 */
export type EmailKind =
  | "founder_query"
  | "signup_invite"
  | "evaluator_reminder"
  | "evaluator_assignment"
  | "incomplete_resubmit"
  | "call_invite"
  | "account_invite"
  | `alert_${NotificationEvent}`;

export type EmailStatus = "sent" | "failed" | "recorded";

/**
 * A file sent with the message. Session 7 needs exactly one shape — the
 * `text/calendar` invite — and the Workers binding takes a raw string for text
 * attachments (NOT base64; that's the REST API's convention), so `content` is
 * the .ics document verbatim.
 */
export interface EmailAttachment {
  content: string;
  filename: string;
  type: string;
  disposition?: "attachment" | "inline";
}

export interface OutboundEmail {
  kind: EmailKind;
  toEmail: string;
  toName?: string | null;
  subject: string;
  body: string;
  /** Optional HTML alternative. The plain-text `body` is always sent too. */
  html?: string | null;
  deckId?: string | null;
  queryId?: string | null;
  /** Send at most one message per key, ever. See the module header. */
  dedupeKey?: string | null;
  /** Files to attach. Audited by count only — the outbox stores no payloads. */
  attachments?: EmailAttachment[];
  /**
   * What to persist in `email_outbox.body` instead of `body`. Set this when the
   * message carries a secret (the account invite's temporary password): the
   * outbox is a durable audit log, and a credential does not belong in it. The
   * recipient still receives the real `body`.
   */
  auditBody?: string;
}

export interface SentEmail extends OutboundEmail {
  id: string;
  status: EmailStatus;
  createdAt: string;
  /** Provider message id, when the send was accepted. */
  providerId?: string | null;
  /** Why the send failed, when `status === 'failed'`. */
  error?: string | null;
  /** True when `dedupeKey` matched an existing row and nothing was sent. */
  deduped?: boolean;
}

/** The subset of the Cloudflare Email Sending binding this app uses. */
export interface EmailSender {
  send(message: {
    to: string | string[];
    from: { email: string; name?: string };
    replyTo?: string;
    subject: string;
    text?: string;
    html?: string;
    attachments?: EmailAttachment[];
  }): Promise<{ messageId?: string } | void>;
}

interface OutboxRow {
  id: string;
  status: string;
  created_at: string;
  provider_id: string | null;
  error: string | null;
}

/** Look up a previously recorded message by its dedupe key. */
async function findByDedupeKey(env: Env, key: string): Promise<OutboxRow | null> {
  return env.DB.prepare(
    "SELECT id, status, created_at, provider_id, error FROM email_outbox WHERE dedupe_key = ?",
  )
    .bind(key)
    .first<OutboxRow>();
}

function hydrate(email: OutboundEmail, row: OutboxRow): SentEmail {
  return {
    ...email,
    id: row.id,
    status: row.status as EmailStatus,
    createdAt: row.created_at,
    providerId: row.provider_id,
    error: row.error,
    deduped: true,
  };
}

/**
 * Whether this Worker can actually dispatch mail — the `send_email` binding is
 * present AND a verified From address is configured. When false every
 * `sendEmail` call is audited with status='recorded' and nothing leaves the
 * Worker.
 *
 * Callers use this to decide whether email is a *safe* sole channel for
 * something. `POST /api/users` is the one place it matters: it must not hand a
 * new account's only credential to a transport that isn't delivering. A caller
 * that just wants best-effort notification should ignore this and send.
 */
export function emailDeliveryConfigured(env: Env): boolean {
  return Boolean(env.EMAIL && env.EMAIL_FROM?.trim());
}

/**
 * Deliver an email and record it in the outbox. Never throws on a delivery
 * failure — the message is persisted with `status='failed'` and the reason, so a
 * misconfigured sending domain degrades to an auditable no-send rather than
 * breaking the flow that triggered it (an AI evaluation, a pipeline action).
 */
export async function sendEmail(
  env: Env,
  email: OutboundEmail,
  now: () => string = () => new Date().toISOString(),
): Promise<SentEmail> {
  // Idempotency: a keyed message is sent at most once.
  if (email.dedupeKey) {
    const existing = await findByDedupeKey(env, email.dedupeKey);
    if (existing) return hydrate(email, existing);
  }

  const id = `mail_${crypto.randomUUID()}`;
  const createdAt = now();

  let status: EmailStatus = "recorded";
  let providerId: string | null = null;
  let error: string | null = null;

  const from = env.EMAIL_FROM?.trim();
  if (env.EMAIL && from) {
    try {
      const res = await env.EMAIL.send({
        to: email.toEmail,
        from: { email: from, name: env.EMAIL_FROM_NAME?.trim() || "ai.STARTUPJURY" },
        ...(env.EMAIL_REPLY_TO?.trim() ? { replyTo: env.EMAIL_REPLY_TO.trim() } : {}),
        subject: email.subject,
        text: email.body,
        ...(email.html ? { html: email.html } : {}),
        ...(email.attachments?.length ? { attachments: email.attachments } : {}),
      });
      status = "sent";
      providerId = (res && typeof res === "object" && res.messageId) || null;
    } catch (err) {
      // A bad recipient or an un-onboarded sending domain must not take down the
      // caller. Record why, and let the outbox be the operator's signal.
      status = "failed";
      error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      console.error(`email send failed (${email.kind} → ${email.toEmail}):`, err);
    }
  }

  try {
    await env.DB.prepare(
      "INSERT INTO email_outbox (id, deck_id, query_id, kind, to_email, to_name, subject, body, status, created_at, error, provider_id, dedupe_key) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        id,
        email.deckId ?? null,
        email.queryId ?? null,
        email.kind,
        email.toEmail,
        email.toName ?? null,
        email.subject,
        // Never the raw body when the caller flagged it as secret-bearing.
        email.auditBody ?? email.body,
        status,
        createdAt,
        error,
        providerId,
        email.dedupeKey ?? null,
      )
      .run();
  } catch (err) {
    // The only expected failure is the dedupe UNIQUE index losing a race with a
    // concurrent run. Return the row that won rather than surfacing a 500.
    if (email.dedupeKey) {
      const existing = await findByDedupeKey(env, email.dedupeKey);
      if (existing) return hydrate(email, existing);
    }
    throw err;
  }

  return { ...email, id, status, createdAt, providerId, error };
}

/** Compose the founder-clarification email for a query. Pure (testable). */
export function buildQueryEmail(args: {
  deckName: string;
  founderName?: string | null;
  questions: string;
}): { subject: string; body: string } {
  const greeting = args.founderName ? `Hi ${args.founderName},` : "Hi,";
  return {
    subject: `Action needed: a few questions about ${args.deckName}`,
    body:
      `${greeting}\n\nThanks for submitting ${args.deckName} to the programme. ` +
      "Before we can complete the review, our team needs a little more detail:\n\n" +
      `${args.questions}\n\n` +
      "Please reply through your founder portal and we'll pick the review back up.\n\n" +
      "— The ai.STARTUPJURY team",
  };
}

/** Compose the evaluator reminder listing a member's pending assigned decks. */
export function buildReminderEmail(args: {
  evaluatorName: string;
  deckNames: string[];
}): { subject: string; body: string } {
  const n = args.deckNames.length;
  const list = args.deckNames.map((d) => `  • ${d}`).join("\n");
  return {
    subject: `Reminder: ${n} deck${n === 1 ? "" : "s"} awaiting your evaluation`,
    body:
      `Hi ${args.evaluatorName},\n\n` +
      `You have ${n} deck${n === 1 ? "" : "s"} assigned and awaiting your score:\n\n` +
      `${list}\n\n` +
      "Please open your pipeline in ai.STARTUPJURY to complete the evaluation.\n\n" +
      "— The ai.STARTUPJURY team",
  };
}

/**
 * W7-E / F0256 — Assign → "Notify N jury members by email". One message per
 * evaluator per confirmation, listing every deck they were given, the deadline,
 * and the assigner's "Instructions to evaluators" when one was written.
 */
export function buildAssignmentEmail(args: {
  evaluatorName: string;
  assignedByName?: string | null;
  deckNames: string[];
  /** Pre-formatted deadline, e.g. "19 Sep 2026". */
  dueLabel: string;
  note?: string | null;
}): { subject: string; body: string } {
  const n = args.deckNames.length;
  const list = args.deckNames.map((d) => `  • ${d}`).join("\n");
  const by = args.assignedByName ? ` by ${args.assignedByName}` : "";
  const note = args.note?.trim() ? `Instructions from the assigner:\n${args.note.trim()}\n\n` : "";
  return {
    subject: `${n} deck${n === 1 ? "" : "s"} assigned to you for evaluation`,
    body:
      `Hi ${args.evaluatorName},\n\n` +
      `You have been assigned ${n} deck${n === 1 ? "" : "s"}${by} for evaluation, due ${args.dueLabel}:\n\n` +
      `${list}\n\n` +
      note +
      "The evaluation report is attached to each deck in ai.STARTUPJURY — open your pipeline to score it.\n\n" +
      "— The ai.STARTUPJURY team",
  };
}

/** Compose the sign-up invite email once a deck is shortlisted for onboarding. */
export function buildSignupEmail(args: {
  deckName: string;
  founderName?: string | null;
}): { subject: string; body: string } {
  const greeting = args.founderName ? `Congratulations ${args.founderName}!` : "Congratulations!";
  return {
    subject: `You're invited to sign up — ${args.deckName}`,
    body:
      `${greeting}\n\n${args.deckName} has been shortlisted. ` +
      "Complete your sign-up in the founder portal to move into onboarding.\n\n" +
      "— The ai.STARTUPJURY team",
  };
}

/**
 * Compose a call invitation. The `.ics` attachment is the actual scheduling
 * artifact (FINISH-PLAN §8: a universal invite every calendar client accepts);
 * the body is the human-readable version for clients that don't auto-import it.
 * Pure (testable).
 */
export function buildCallInviteEmail(args: {
  deckName: string;
  callTitle: string;
  kindLabel: string;
  /** Pre-formatted, timezone-labelled start (the caller owns the locale). */
  whenLabel: string;
  durationMinutes: number;
  location?: string | null;
  organizerName?: string | null;
  participantNames: string[];
  notes?: string | null;
  cancelled?: boolean;
}): { subject: string; body: string; html: string } {
  const verb = args.cancelled ? "Cancelled" : "Invitation";
  const subject = `${verb}: ${args.callTitle}`;
  const attendees = args.participantNames.filter(Boolean).join(", ");
  const lines = [
    `When: ${args.whenLabel} (${args.durationMinutes} min)`,
    args.location ? `Where: ${args.location}` : "",
    args.organizerName ? `Organiser: ${args.organizerName}` : "",
    attendees ? `Participants: ${attendees}` : "",
  ].filter(Boolean);

  const lead = args.cancelled
    ? `The ${args.kindLabel.toLowerCase()} for ${args.deckName} has been cancelled.`
    : `You're invited to the ${args.kindLabel.toLowerCase()} for ${args.deckName}.`;

  const body =
    `Hi,\n\n${lead}\n\n` +
    `${lines.map((l) => `  • ${l}`).join("\n")}\n\n` +
    (args.notes ? `Notes: ${args.notes}\n\n` : "") +
    (args.cancelled
      ? "The attached calendar file removes it from your calendar.\n\n"
      : "The attached calendar file (.ics) adds it to your calendar — it works with " +
        "Outlook, Google Calendar, Apple Calendar and anything else that reads " +
        "standard invitations.\n\n") +
    "— The ai.STARTUPJURY team";

  const html =
    `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1c2321;">` +
    `<p>Hi,</p>` +
    `<p>${esc(lead)}</p>` +
    `<ul style="padding-left:20px;">${lines.map((l) => `<li style="margin:4px 0;">${esc(l)}</li>`).join("")}</ul>` +
    (args.notes ? `<p><strong>Notes:</strong> ${esc(args.notes)}</p>` : "") +
    `<p style="font-size:13px;color:#6b7671;">${
      args.cancelled
        ? "The attached calendar file removes it from your calendar."
        : "The attached calendar file (.ics) adds it to your calendar."
    }</p>` +
    `<p style="font-size:13px;color:#6b7671;">— The ai.STARTUPJURY team</p>` +
    `</div>`;

  return { subject, body, html };
}

/** Minimal HTML escaping for the values interpolated into the HTML alternative. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Compose the Incomplete-deck notice: what is missing, and the tokenized link
 * that opens the founder's resubmit page. Pure (testable).
 *
 * Per §8 there is no question-and-answer form — the founder updates the named
 * sections **in the deck** and re-uploads it, so the email lists sections, not
 * questions, and the single call to action is the link.
 */
export function buildIncompleteEmail(args: {
  deckName: string;
  founderName?: string | null;
  /** Required intake columns still absent (`decks.missing_fields`). */
  missingFields: IntakeField[];
  /** Deck sections the extraction flagged as absent (Traction, Team, Ask…). */
  missingSections: string[];
  link: string;
  orgName?: string | null;
}): { subject: string; body: string; html: string } {
  const greeting = args.founderName ? `Hi ${args.founderName},` : "Hi,";
  const org = args.orgName?.trim() || "the programme";
  const detailLine =
    args.missingFields.length > 0
      ? `Contact details we could not find: ${describeMissingFields(args.missingFields)}.`
      : "";
  const sectionLine =
    args.missingSections.length > 0
      ? `Deck sections that look absent: ${args.missingSections.join(", ")}.`
      : "";
  const lines = [detailLine, sectionLine].filter(Boolean);

  const body =
    `${greeting}\n\n` +
    `Thanks for submitting ${args.deckName} to ${org}. Our review flagged it as ` +
    "**Incomplete** — a few things we need are missing, so it can't go to the " +
    "evaluation panel yet.\n\n" +
    (lines.length > 0 ? `${lines.map((l) => `  • ${l}`).join("\n")}\n\n` : "") +
    "Open the secure link below to see exactly what's missing, update those " +
    "sections in your deck, and upload the new version. We'll re-score it " +
    "automatically and put it back in front of the evaluators — you don't need " +
    "to send anything else.\n\n" +
    `${args.link}\n\n` +
    "The link is personal to this submission, so please don't forward it.\n\n" +
    "— The ai.STARTUPJURY team";

  const bullets = lines.map((l) => `<li style="margin:4px 0;">${esc(l)}</li>`).join("");
  const html =
    `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1c2321;">` +
    `<p>${esc(greeting)}</p>` +
    `<p>Thanks for submitting <strong>${esc(args.deckName)}</strong> to ${esc(org)}. ` +
    `Our review flagged it as <strong>Incomplete</strong> — a few things we need are missing, ` +
    `so it can't go to the evaluation panel yet.</p>` +
    (bullets ? `<ul style="padding-left:20px;">${bullets}</ul>` : "") +
    `<p>Open the secure link below to see exactly what's missing, update those sections in your ` +
    `deck, and upload the new version. We'll re-score it automatically and put it back in front of ` +
    `the evaluators — you don't need to send anything else.</p>` +
    `<p><a href="${esc(args.link)}" style="display:inline-block;background:#e8a020;color:#12211c;` +
    `text-decoration:none;font-weight:600;padding:10px 18px;border-radius:8px;">Update &amp; re-upload your deck</a></p>` +
    `<p style="font-size:13px;color:#6b7671;">The link is personal to this submission, so please don't forward it.<br>` +
    `If the button doesn't work, paste this into your browser:<br>${esc(args.link)}</p>` +
    `<p style="font-size:13px;color:#6b7671;">— The ai.STARTUPJURY team</p>` +
    `</div>`;

  return { subject: `Action needed: ${args.deckName} is incomplete`, body, html };
}

/**
 * Compose the new-account invite carrying the one-time temporary password
 * (Session 4's leftover, delivered in Session 8). Pure (testable).
 *
 * The credential is in the body rather than behind a link on purpose: the app
 * has no password-reset transport, so a link-only invite would need a second
 * token type for a flow the temp password already covers. The password is
 * short-lived by convention — the recipient replaces it on first sign-in.
 */
export function buildAccountInviteEmail(args: {
  name: string;
  roleLabel: string;
  tempPassword: string;
  loginUrl: string;
  orgName?: string | null;
  invitedByName?: string | null;
}): { subject: string; body: string; html: string } {
  const org = args.orgName?.trim() || "ai.STARTUPJURY";
  const invitedBy = args.invitedByName?.trim();
  const intro = invitedBy
    ? `${invitedBy} has added you to ${org} on ai.STARTUPJURY as ${indefinite(args.roleLabel)}.`
    : `You've been added to ${org} on ai.STARTUPJURY as ${indefinite(args.roleLabel)}.`;

  const body =
    `Hi ${args.name},\n\n${intro}\n\n` +
    "Sign in with these details and choose your own password straight away:\n\n" +
    `  • Sign in: ${args.loginUrl}\n` +
    `  • Temporary password: ${args.tempPassword}\n\n` +
    "This password is temporary and personal to your account — please don't share it.\n\n" +
    "— The ai.STARTUPJURY team";

  const html =
    `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1c2321;">` +
    `<p>Hi ${esc(args.name)},</p>` +
    `<p>${esc(intro)}</p>` +
    `<p>Sign in with these details and choose your own password straight away:</p>` +
    `<p style="margin:14px 0;"><a href="${esc(args.loginUrl)}" style="display:inline-block;background:#e8a020;` +
    `color:#12211c;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:8px;">Sign in</a></p>` +
    `<p>Temporary password: <code style="background:#f1f3f2;padding:3px 7px;border-radius:5px;font-size:14px;">` +
    `${esc(args.tempPassword)}</code></p>` +
    `<p style="font-size:13px;color:#6b7671;">This password is temporary and personal to your account — ` +
    `please don't share it.<br>If the button doesn't work, paste this into your browser:<br>` +
    `${esc(args.loginUrl)}</p>` +
    `<p style="font-size:13px;color:#6b7671;">— The ai.STARTUPJURY team</p>` +
    `</div>`;

  return { subject: `You've been added to ${org} on ai.STARTUPJURY`, body, html };
}

/** "a Jury Member" / "an Admin" — English article for a role label. */
function indefinite(label: string): string {
  return `${/^[aeiou]/i.test(label) ? "an" : "a"} ${label}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// W3-B — the notification emitter.
//
// Everything above this line is a message the app composes for ONE named
// recipient, at one call site, unconditionally. The Admin console's
// Notifications section governs something different: ten *platform events*,
// each of which fans out to whoever in the workspace asked to hear about it,
// on either or both of two channels.
//
// `emitNotification` is that fan-out, and it is the whole of it — a producer is
// one call at the point in the pipeline where the thing actually happens. It:
//
//   1. resolves the event's AUDIENCE (below) to live users of the edition,
//      minus the actor, plus any extra recipient the caller names;
//   2. resolves each recipient's preference per channel — their own row wins,
//      else the workspace default row, else the prototype's seeded default;
//   3. records an email through `sendEmail` (so `EMAIL_FROM` gating, the outbox
//      audit and dedupe all still apply, unchanged) and/or an in-app row.
//
// It never throws. A producer sits inside a pipeline action that has already
// committed — an alert that cannot be recorded must not fail the upload, the
// evaluation or the score submission that triggered it.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Who hears about each event, per edition.
 *
 * The prototype ships the section in all eleven role consoles and scopes it
 * "for your account", which says a person controls their own mail — it does not
 * say every person is a candidate for every event. These lists are that missing
 * half: pipeline events reach the people who work the pipeline, decisions reach
 * the decision makers, and the four operational events (credits, CRM, invites,
 * usage) reach the people who administer the workspace. §8 Q16 asks whether the
 * console itself should widen to every internal role; that question changes who
 * can *edit* a preference, not who is a candidate for an alert.
 */
const AUDIENCE: Record<NotificationEvent, Record<Edition, readonly Role[]>> = {
  // Intake and AI: whoever works the front of the pipeline.
  deck_submitted: {
    incubator: ["program_manager", "program_associate", "admin", "superuser"],
    vc: ["analyst", "associate", "partner", "admin", "superuser"],
  },
  ai_scoring_complete: {
    incubator: ["program_manager", "program_associate", "admin", "superuser"],
    vc: ["analyst", "associate", "partner", "admin", "superuser"],
  },
  // Scoring and completion: the decision makers (§1.4 — the PM decides in the
  // incubator; the partner carries the deal in the VC).
  evaluator_scores_submitted: {
    incubator: ["program_manager", "admin", "superuser"],
    vc: ["partner", "admin", "superuser"],
  },
  all_evaluations_complete: {
    incubator: ["program_manager", "admin", "superuser"],
    vc: ["partner", "admin", "superuser"],
  },
  // The founder loop and scheduling are run by the programme staff.
  founder_responded: {
    incubator: ["program_manager", "program_associate", "admin", "superuser"],
    vc: ["analyst", "associate", "partner", "admin", "superuser"],
  },
  intro_call_scheduled: {
    incubator: ["program_manager", "program_associate", "admin", "superuser"],
    vc: ["analyst", "associate", "partner", "admin", "superuser"],
  },
  // Operational: the workspace's administrators, in both editions.
  credits_low: { incubator: ["admin", "superuser"], vc: ["admin", "superuser"] },
  crm_sync_failed: { incubator: ["admin", "superuser"], vc: ["admin", "superuser"] },
  invite_accepted: { incubator: ["admin", "superuser"], vc: ["admin", "superuser"] },
  monthly_usage_summary: { incubator: ["admin", "superuser"], vc: ["admin", "superuser"] },
};

/** The roles an event is broadcast to. Exported so the section can explain itself. */
export function notificationAudience(event: NotificationEvent, edition: Edition): readonly Role[] {
  return AUDIENCE[event][edition];
}

interface PrefRow {
  user_id: string | null;
  channel: string;
  enabled: number;
}

/**
 * Resolve `(recipient, channel)` → on/off for one event, in one query.
 *
 * Precedence is the one `0031` designed for: a row with the recipient's
 * `user_id` overrides the workspace default row (`user_id IS NULL`), which
 * overrides the prototype's seeded mask. So an admin can set a policy and a
 * person can still opt out of it.
 */
export async function resolveNotificationPreferences(
  env: Env,
  edition: Edition,
  event: NotificationEvent,
  userIds: string[],
): Promise<(userId: string, channel: NotificationChannel) => boolean> {
  const fallback = NOTIFICATION_DEFAULTS[event];
  if (userIds.length === 0) return () => fallback;

  const placeholders = userIds.map(() => "?").join(", ");
  const rows = (
    await env.DB.prepare(
      "SELECT user_id, channel, enabled FROM notification_preferences " +
        `WHERE edition = ? AND event_key = ? AND (user_id IS NULL OR user_id IN (${placeholders}))`,
    )
      .bind(edition, event, ...userIds)
      .all<PrefRow>()
  ).results;

  const defaults = new Map<string, boolean>();
  const perUser = new Map<string, boolean>();
  for (const r of rows) {
    if (r.user_id === null) defaults.set(r.channel, r.enabled === 1);
    else perUser.set(`${r.user_id}:${r.channel}`, r.enabled === 1);
  }

  return (userId, channel) =>
    perUser.get(`${userId}:${channel}`) ?? defaults.get(channel) ?? fallback;
}

export interface NotificationInput {
  event: NotificationEvent;
  edition: Edition;
  /** The alert's one line — the in-app title and the email subject. */
  title: string;
  /** The email body and the bell's second line. Defaults to `title`. */
  body?: string | null;
  /** In-app deep link, e.g. `/app/decks/<id>`. */
  link?: string | null;
  deckId?: string | null;
  /** Recipients outside the audience — the call organiser, the deck's uploader. */
  alsoNotify?: ReadonlyArray<string | null | undefined>;
  /** Nobody is told about their own action. */
  actorId?: string | null;
  /** At most one alert per recipient per key, ever. */
  dedupeKey?: string | null;
}

export interface EmitResult {
  event: NotificationEvent;
  /** Users the event resolved to, before preferences. */
  recipients: number;
  /** Outbox rows written (a deduped one does not count). */
  emails: number;
  /** `notifications` rows written. */
  inApp: number;
}

interface RecipientRow {
  id: string;
  name: string;
  email: string;
  role: string;
}

/**
 * Fire one platform event. Returns what it actually produced, which is what the
 * worker tests assert on.
 *
 * Two things this deliberately does NOT do. It does not consult
 * `emailDeliveryConfigured`: with no verified sending domain the message is
 * still recorded in `email_outbox` with `status='recorded'` and dispatched to
 * nobody, which is the correct, auditable behaviour and must stay true (§1.4).
 * And it does not batch the in-app inserts with the caller's own statements —
 * the alert is always written after the caller's transaction has committed, so
 * a bell entry can never describe a state the database does not hold.
 */
export async function emitNotification(
  env: Env,
  input: NotificationInput,
  now: () => string = () => new Date().toISOString(),
): Promise<EmitResult> {
  const result: EmitResult = { event: input.event, recipients: 0, emails: 0, inApp: 0 };
  try {
    const roles = AUDIENCE[input.event][input.edition];
    const extra = [...new Set((input.alsoNotify ?? []).filter((id): id is string => Boolean(id)))];

    const rolePlaceholders = roles.map(() => "?").join(", ");
    const extraPlaceholders = extra.map(() => "?").join(", ");
    const where =
      extra.length > 0
        ? `(role IN (${rolePlaceholders}) OR id IN (${extraPlaceholders}))`
        : `role IN (${rolePlaceholders})`;

    const recipients = (
      await env.DB.prepare(
        `SELECT id, name, email, role FROM users WHERE edition = ? AND active = 1 AND ${where}`,
      )
        .bind(input.edition, ...roles, ...extra)
        .all<RecipientRow>()
    ).results
      // A named extra recipient could be anyone; a mentor holds no screens and
      // must not be mailed about a pipeline it cannot see (`denyMentor`).
      .filter((u) => !isMentor(u.role) && u.id !== input.actorId);

    result.recipients = recipients.length;
    if (recipients.length === 0) return result;

    const enabled = await resolveNotificationPreferences(
      env,
      input.edition,
      input.event,
      recipients.map((u) => u.id),
    );
    const body = input.body?.trim() || input.title;

    for (const user of recipients) {
      if (enabled(user.id, "email")) {
        const sent = await sendEmail(
          env,
          {
            kind: `alert_${input.event}`,
            toEmail: user.email,
            toName: user.name,
            subject: input.title,
            body,
            deckId: input.deckId ?? null,
            dedupeKey: input.dedupeKey ? `${input.dedupeKey}:${user.id}` : null,
          },
          now,
        );
        if (!sent.deduped) result.emails += 1;
      }
      if (enabled(user.id, "in_app")) {
        result.inApp += await insertInAppNotification(env, input, user.id, body, now);
      }
    }
  } catch (err) {
    // An alert is never worth failing the action that produced it.
    console.error(`notification emit failed (${input.event}):`, err);
  }
  return result;
}

/** One `notifications` row. Returns 1 when written, 0 when the dedupe key won. */
async function insertInAppNotification(
  env: Env,
  input: NotificationInput,
  userId: string,
  body: string,
  now: () => string,
): Promise<number> {
  const res = await env.DB.prepare(
    "INSERT OR IGNORE INTO notifications (id, edition, user_id, event_key, title, body, link, deck_id, created_at, dedupe_key) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      `ntf_${crypto.randomUUID()}`,
      input.edition,
      userId,
      input.event,
      input.title,
      body,
      input.link ?? null,
      input.deckId ?? null,
      now(),
      input.dedupeKey ? `${input.dedupeKey}:${userId}` : null,
    )
    .run();
  return res.meta.changes === 1 ? 1 : 0;
}
