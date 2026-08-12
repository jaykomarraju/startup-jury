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
import { describeMissingFields, type IntakeField } from "../../shared/intake";

export type EmailKind =
  | "founder_query"
  | "signup_invite"
  | "evaluator_reminder"
  | "incomplete_resubmit";

export type EmailStatus = "sent" | "failed" | "recorded";

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
        email.body,
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
