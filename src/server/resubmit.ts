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
//   • **Scoped to one WORKSPACE** (T1-FLOW). `resubmit_tokens` is tenant-OWNED
//     (`0085`), and a bearer credential that resolves across customers is not a
//     leak — it is a door. Both ends are closed here: the token INHERITS its
//     `(tenant_id, edition)` from the deck it is minted for, in the INSERT
//     itself, so it can never be filed against the wrong customer; and the
//     redeem path loads the deck WITHIN the token's workspace, so a token that
//     somehow named the wrong one opens nothing (404) rather than opening
//     somebody else's deck. `token_hash` stays GLOBALLY unique on purpose —
//     `0085`'s header: scoping the hash per tenant would make a stolen token
//     valid in a second workspace.

import type { Env } from "./types";
import type { Edition } from "../shared/roles";
import { scopeOf, scoped, type TenantScope } from "../shared/tenant";
import { parseMissingFields, type IntakeField } from "../shared/intake";
import { sendEmail, buildIncompleteEmail } from "./email/outbox";

/** How long a founder has to act on a resubmit link. */
export const RESUBMIT_TOKEN_TTL_DAYS = 30;

const TTL_MS = RESUBMIT_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

export interface ResubmitTokenRow {
  id: string;
  /** `organizations.id` — the customer whose deck this link opens (`0085`). */
  tenant_id: string;
  deck_id: string;
  edition: Edition;
  to_email: string | null;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  use_count: number;
  revoked: number;
}

/**
 * The workspace a verified token authorises, and the ONLY scope the public
 * resubmit route has.
 *
 * `scopeOf` normally takes the logged-in principal, because §2's one piece of
 * good news is that no workspace predicate in the product takes its key from
 * the browser. The founder has no session — the token IS the credential — so
 * the scope comes from the stored row rather than from the URL. That is the
 * same rule, not an exception to it: the token is resolved server-side by hash
 * and the caller cannot name a tenant.
 */
export function tokenScope(token: ResubmitTokenRow): TenantScope {
  return scopeOf({ tenantId: token.tenant_id, edition: token.edition });
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
 *
 * **The workspace is DERIVED, not supplied.** `tenant_id` and `edition` are
 * read out of `decks` by the INSERT itself rather than bound by the caller, for
 * the reason `src/shared/tenant.ts` gives for `insertScope`: `0085` added
 * `tenant_id TEXT NOT NULL DEFAULT 't_default'`, so a forgotten bind does not
 * fail — it files the token against the first customer, with a 200 and a row
 * and nothing in the response to notice. A credential cannot be allowed to
 * land in the wrong workspace that quietly, and the deck is the only authority
 * on whose it is: `resubmit_tokens.deck_id` is a NOT NULL reference to it, and
 * `TENANT_OWNER` names `decks` as the owner of everything downstream of it.
 *
 * `args.edition` therefore stops being the source of the value and becomes a
 * CROSS-CHECK: it is matched in the `WHERE`, so a caller that names the wrong
 * edition for the deck inserts nothing and gets a throw instead of a token
 * pointing at a deck in another product variant.
 *
 * The revoke stays keyed on `deck_id` alone, deliberately. It supersedes every
 * live token for the deck whatever workspace the row claims, which is strictly
 * safer than scoping it: a token mis-filed before this change is still revoked
 * by the next mint rather than left alive by a predicate that no longer matches
 * it.
 */
export async function mintResubmitToken(
  env: Env,
  args: { deckId: string; edition: Edition | string; toEmail?: string | null; now?: () => string },
): Promise<{ id: string; token: string; expiresAt: string }> {
  const nowIso = (args.now ?? (() => new Date().toISOString()))();
  const expiresAt = new Date(Date.parse(nowIso) + TTL_MS).toISOString();
  const token = newResubmitToken();
  const id = `rst_${crypto.randomUUID()}`;

  // Checked BEFORE the batch, not after it. The INSERT below writes no row for a
  // deck that is not there, and a throw on its `changes === 0` would be just as
  // correct a refusal — but the batch's first statement revokes the deck's live
  // tokens, and that revoke would already have committed. A mint that fails must
  // not take the deck's working link with it.
  const owner = await env.DB.prepare("SELECT 1 AS ok FROM decks WHERE id = ? AND edition = ?")
    .bind(args.deckId, args.edition)
    .first<{ ok: number }>();
  if (!owner) {
    throw new Error(
      `resubmit: no deck ${JSON.stringify(args.deckId)} in edition ` +
        `${JSON.stringify(String(args.edition))} — no workspace to mint a token for`,
    );
  }

  await env.DB.batch([
    env.DB.prepare("UPDATE resubmit_tokens SET revoked = 1 WHERE deck_id = ? AND revoked = 0").bind(
      args.deckId,
    ),
    env.DB.prepare(
      "INSERT INTO resubmit_tokens (id, tenant_id, deck_id, edition, token_hash, to_email, created_at, expires_at) " +
        "SELECT ?, d.tenant_id, d.id, d.edition, ?, ?, ?, ? FROM decks d WHERE d.id = ? AND d.edition = ?",
    ).bind(id, await hashToken(token), args.toEmail ?? null, nowIso, expiresAt, args.deckId, args.edition),
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
  // Looked up by hash with no workspace predicate, which is correct: the hash is
  // globally unique (`0085` keeps it so on purpose) and the caller has no
  // session to scope by. The scope the row CARRIES is then what every read this
  // token authorises is bound to — see `tokenScope` and `loadDeck` in
  // `routes/resubmit.ts`.
  const row = await env.DB.prepare(
    "SELECT id, tenant_id, deck_id, edition, to_email, created_at, expires_at, used_at, use_count, revoked " +
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

/**
 * The deck sections the extraction flagged absent (Traction, Team, Ask…).
 *
 * `deck_extractions` has no workspace key of its own — it is one of §5b's 33
 * proxy-scoped tables — so the predicate comes from `TENANT_OWNER`'s path to
 * `decks` rather than from the `deck_id` bind alone. The bind is not wrong:
 * every caller gets its deck id from a scoped read one frame up. It is the
 * shape §5b names as where this will silently fail, and the two reads this
 * module makes of it are cheap to put beyond that argument.
 */
export async function missingSections(
  env: Env,
  deckId: string,
  scope: TenantScope,
): Promise<string[]> {
  const q = scoped(scope);
  const joins = q.viaParent("deck_extractions", "x");
  q.and("x.deck_id = ?", deckId).andRaw("x.missing = 1");
  const rows = await env.DB.prepare(
    `SELECT x.label FROM deck_extractions x ${joins} ${q.whereClause()} ORDER BY x.sort_order`,
  )
    .bind(...q.binds)
    .all<{ label: string }>();
  return rows.results.map((r) => r.label);
}

/**
 * @deprecated **Cross-tenant as written. T1-PEOPLE must replace this call.**
 *
 * `org_settings` is tenant-OWNED and `0089` re-keyed it `(tenant_id, edition)`,
 * so "the org settings for this edition" is no longer a singular question: with
 * a second customer this returns whichever row the planner reached first, and
 * the branding in a founder-facing email could be another customer's.
 *
 * The one surviving caller is `routes/users.ts:134`, which belongs to T1-PEOPLE.
 * This session does not edit another session's file — `src/server/db.ts`'s
 * `getUserByEmail` is left standing for exactly the same reason — and the
 * behaviour is identical to today's while one tenant exists, so nothing
 * regresses by waiting. Swap it for `orgNameInScope(env, scopeOf(c.var.user))`.
 */
export async function orgName(env: Env, edition: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT branding_json FROM org_settings WHERE edition = ?")
    .bind(edition)
    .first<{ branding_json: string }>();
  return parseOrgName(row?.branding_json ?? null);
}

/** The workspace's configured display name from `org_settings.branding_json`. */
export async function orgNameInScope(env: Env, scope: TenantScope): Promise<string | null> {
  const q = scoped(scope).on("o");
  const row = await env.DB.prepare(`SELECT o.branding_json FROM org_settings o ${q.whereClause()}`)
    .bind(...q.binds)
    .first<{ branding_json: string }>();
  return parseOrgName(row?.branding_json ?? null);
}

function parseOrgName(brandingJson: string | null): string | null {
  if (!brandingJson) return null;
  try {
    const branding = JSON.parse(brandingJson) as { orgName?: unknown };
    return typeof branding.orgName === "string" && branding.orgName.trim()
      ? branding.orgName.trim()
      : null;
  } catch {
    return null;
  }
}

/**
 * The workspace a deck belongs to, for the paths that hold a deck id and no
 * session: the queue consumer behind `evaluateDeck`, and the public resubmit
 * route. `src/shared/tenant.ts`'s `TenantPrincipal` exists for precisely this —
 * "any row carrying the two columns" builds a scope.
 */
export async function deckScope(env: Env, deckId: string): Promise<TenantScope | null> {
  const row = await env.DB.prepare("SELECT tenant_id, edition FROM decks WHERE id = ?")
    .bind(deckId)
    .first<{ tenant_id: string; edition: Edition }>();
  return row ? scopeOf({ tenantId: row.tenant_id, edition: row.edition }) : null;
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

  // Tenant-safe without a predicate because the KEY is id-derived: a deck id is
  // globally unique, so two customers cannot collide on it. §2 A8's swallowed
  // digest is the other shape — `monthly_usage_summary:${edition}:${month}`,
  // which names no id and is T1-PEOPLE's (`scheduled.ts`).
  const already = await env.DB.prepare("SELECT id FROM email_outbox WHERE dedupe_key = ?")
    .bind(dedupeKey)
    .first<{ id: string }>();
  if (already) return { sent: false, reason: "already_notified" };

  const scope = await deckScope(env, notice.deckId);

  let toEmail = notice.founderEmail?.trim() || null;
  let toName = notice.founderName?.trim() || null;
  if (!toEmail && notice.uploadedBy && scope) {
    // The fallback recipient is the account that uploaded the deck, and it is
    // bound to the deck's workspace: `users.id` is globally unique, so an
    // unscoped read here would address a stranger's mailbox if an id ever
    // crossed. There is no legitimate case where the uploader is outside it.
    const q = scoped(scope).on("u").and("u.id = ?", notice.uploadedBy);
    const uploader = await env.DB.prepare(`SELECT u.name, u.email FROM users u ${q.whereClause()}`)
      .bind(...q.binds)
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
    missingSections: scope ? await missingSections(env, notice.deckId, scope) : [],
    link: resubmitLink(env, token),
    orgName: scope ? await orgNameInScope(env, scope) : null,
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
