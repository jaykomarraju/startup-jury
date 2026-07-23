// Stubbed transactional email. Real outbound delivery (Cloudflare Email Sending)
// is Phase 7+; for now every message is persisted to `email_outbox` with
// status='sent' so the founder-query loop and signup invites are fully testable
// and auditable. Swap `sendEmail` for a Cloudflare Email binding call later —
// callers and the recorded shape stay the same.

import type { Env } from "../types";

export type EmailKind = "founder_query" | "signup_invite";

export interface OutboundEmail {
  kind: EmailKind;
  toEmail: string;
  toName?: string | null;
  subject: string;
  body: string;
  deckId?: string | null;
  queryId?: string | null;
}

export interface SentEmail extends OutboundEmail {
  id: string;
  status: "sent";
  createdAt: string;
}

/** "Send" an email by recording it in the outbox. Returns the persisted row. */
export async function sendEmail(
  env: Env,
  email: OutboundEmail,
  now: () => string = () => new Date().toISOString(),
): Promise<SentEmail> {
  const id = `mail_${crypto.randomUUID()}`;
  const createdAt = now();
  await env.DB.prepare(
    "INSERT INTO email_outbox (id, deck_id, query_id, kind, to_email, to_name, subject, body, status, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'sent', ?)",
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
      createdAt,
    )
    .run();
  return { ...email, id, status: "sent", createdAt };
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
