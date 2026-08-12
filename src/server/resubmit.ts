// Session 6 — the founder resubmit loop.
//
// When a deck lands `status='incomplete'` the founder is emailed a TOKENIZED
// LINK. That link is the only credential: it opens a public page listing what is
// missing and lets them upload a corrected deck, which is stored as a new
// version and re-scored automatically (§8: "they update those sections in the
// deck and re-upload" — no separate question-and-answer form).
//
// Security shape:
//   • 192 bits of CSPRNG entropy per token, base64url — unguessable.
//   • Only a SHA-256 hash is stored, so a database leak can't be replayed as a
//     working link. Unsalted on purpose: the token IS high-entropy, and the
//     lookup has to be `WHERE token_hash = ?` (a salted PBKDF2 hash, as used for
//     passwords, can't be looked up).
//   • Scoped to one deck, expiring, revocable, and superseded — minting a new
//     token revokes the deck's earlier ones so a stale email stops working.

import type { Env } from "./types";
import type { Edition } from "../shared/roles";
import { parseMissingFields, type IntakeField } from "../shared/intake";
import { sendEmail, buildIncompleteEmail } from "./email/outbox";

/** How long a founder has to act on a resubmit link. */
export const RESUBMIT_TOKEN_TTL_DAYS = 30;

const TTL_MS = RESUBMIT_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

export interface ResubmitTokenRow {
  id: string;
  deck_id: string;
  edition: string;
  to_email: string | null;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  use_count: number;
  revoked: number;
}

export type TokenFailure = "invalid_token" | "token_expired" | "token_revoked";

export type TokenCheck =
  | { ok: true; token: ResubmitTokenRow }
  | { ok: false; reason: TokenFailure };

/** URL-safe base64 of `bytes`, no padding. */
function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A fresh 192-bit link token. */
export function newResubmitToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(24)));
}

/** SHA-256 of a token, hex — what actually goes in the database. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The public URL a founder opens. `APP_BASE_URL` falls back to the live Worker. */
export function resubmitLink(env: Env, token: string): string {
  const base = (env.APP_BASE_URL || "https://startup-jury.jay-komarraju.workers.dev").replace(
    /\/+$/,
    "",
  );
  return `${base}/resubmit/${token}`;
}

/**
 * Issue a resubmit link for a deck, revoking any earlier live token for it so a
 * superseded email can no longer be used. Returns the RAW token — it is never
 * recoverable afterwards, only verifiable.
 */
export async function mintResubmitToken(
  env: Env,
  args: { deckId: string; edition: Edition | string; toEmail?: string | null; now?: () => string },
): Promise<{ id: string; token: string; expiresAt: string }> {
  const nowIso = (args.now ?? (() => new Date().toISOString()))();
  const expiresAt = new Date(Date.parse(nowIso) + TTL_MS).toISOString();
  const token = newResubmitToken();
  const id = `rst_${crypto.randomUUID()}`;

  await env.DB.batch([
    env.DB.prepare("UPDATE resubmit_tokens SET revoked = 1 WHERE deck_id = ? AND revoked = 0").bind(
      args.deckId,
    ),
    env.DB.prepare(
      "INSERT INTO resubmit_tokens (id, deck_id, edition, token_hash, to_email, created_at, expires_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(id, args.deckId, args.edition, await hashToken(token), args.toEmail ?? null, nowIso, expiresAt),
  ]);

  return { id, token, expiresAt };
}

/** Resolve a raw token to its row, or say precisely why it is unusable. */
export async function verifyResubmitToken(
  env: Env,
  token: string | undefined | null,
  now: () => string = () => new Date().toISOString(),
): Promise<TokenCheck> {
  if (!token) return { ok: false, reason: "invalid_token" };
  const row = await env.DB.prepare(
    "SELECT id, deck_id, edition, to_email, created_at, expires_at, used_at, use_count, revoked " +
      "FROM resubmit_tokens WHERE token_hash = ?",
  )
    .bind(await hashToken(token))
    .first<ResubmitTokenRow>();
  if (!row) return { ok: false, reason: "invalid_token" };
  if (row.revoked) return { ok: false, reason: "token_revoked" };
  if (Date.parse(row.expires_at) <= Date.parse(now())) return { ok: false, reason: "token_expired" };
  return { ok: true, token: row };
}

/** Record a successful re-upload against the link (the link stays usable). */
export async function markTokenUsed(
  env: Env,
  tokenId: string,
  now: () => string = () => new Date().toISOString(),
): Promise<void> {
  await env.DB.prepare(
    "UPDATE resubmit_tokens SET used_at = ?, use_count = use_count + 1 WHERE id = ?",
  )
    .bind(now(), tokenId)
    .run();
}

/** The deck sections the extraction flagged absent (Traction, Team, Ask…). */
export async function missingSections(env: Env, deckId: string): Promise<string[]> {
  const rows = await env.DB.prepare(
    "SELECT label FROM deck_extractions WHERE deck_id = ? AND missing = 1 ORDER BY sort_order",
  )
    .bind(deckId)
    .all<{ label: string }>();
  return rows.results.map((r) => r.label);
}

/** The org's configured display name from `org_settings.branding_json`, if set. */
export async function orgName(env: Env, edition: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT branding_json FROM org_settings WHERE edition = ?")
    .bind(edition)
    .first<{ branding_json: string }>();
  if (!row) return null;
  try {
    const branding = JSON.parse(row.branding_json) as { orgName?: unknown };
    return typeof branding.orgName === "string" && branding.orgName.trim()
      ? branding.orgName.trim()
      : null;
  } catch {
    return null;
  }
}

export interface IncompleteNotice {
  deckId: string;
  deckName: string;
  edition: Edition | string;
  /** `decks.content_version` — makes the notification idempotent per deck content. */
  contentVersion: number;
  founderName?: string | null;
  founderEmail?: string | null;
  /** Fallback recipient: the account that uploaded the deck. */
  uploadedBy?: string | null;
  missingFields: IntakeField[];
}

export type NotifyOutcome =
  | { sent: true; emailId: string; status: string; deduped: boolean }
  | { sent: false; reason: "already_notified" | "no_recipient" };

/**
 * Email the founder that their deck is Incomplete, with a tokenized link to the
 * resubmit page. Idempotent per deck **content version**: a queue retry or a
 * manual re-score of unchanged content sends nothing, while a new version that
 * is still incomplete sends again with a fresh list.
 *
 * The recipient is `decks.founder_email` (the whole point of the Session-5
 * intake merge), falling back to the uploader's account email — which is what
 * covers the case where the founder's address is ITSELF one of the missing
 * fields, and the case of a staff bulk upload.
 */
export async function notifyIncompleteDeck(
  env: Env,
  notice: IncompleteNotice,
  now: () => string = () => new Date().toISOString(),
): Promise<NotifyOutcome> {
  const dedupeKey = `incomplete:${notice.deckId}:v${notice.contentVersion}`;

  const already = await env.DB.prepare("SELECT id FROM email_outbox WHERE dedupe_key = ?")
    .bind(dedupeKey)
    .first<{ id: string }>();
  if (already) return { sent: false, reason: "already_notified" };

  let toEmail = notice.founderEmail?.trim() || null;
  let toName = notice.founderName?.trim() || null;
  if (!toEmail && notice.uploadedBy) {
    const uploader = await env.DB.prepare("SELECT name, email FROM users WHERE id = ?")
      .bind(notice.uploadedBy)
      .first<{ name: string; email: string }>();
    if (uploader) {
      toEmail = uploader.email;
      toName = toName ?? uploader.name;
    }
  }
  if (!toEmail) return { sent: false, reason: "no_recipient" };

  const { token } = await mintResubmitToken(env, {
    deckId: notice.deckId,
    edition: notice.edition,
    toEmail,
    now,
  });

  const { subject, body, html } = buildIncompleteEmail({
    deckName: notice.deckName,
    founderName: toName,
    missingFields: notice.missingFields,
    missingSections: await missingSections(env, notice.deckId),
    link: resubmitLink(env, token),
    orgName: await orgName(env, String(notice.edition)),
  });

  const sent = await sendEmail(
    env,
    {
      kind: "incomplete_resubmit",
      toEmail,
      toName,
      subject,
      body,
      html,
      deckId: notice.deckId,
      dedupeKey,
    },
    now,
  );

  return { sent: true, emailId: sent.id, status: sent.status, deduped: sent.deduped === true };
}

/** Parse the stored CSV back into field keys (re-export for route convenience). */
export { parseMissingFields };
