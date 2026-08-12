// Deck re-upload: store a new version, re-point the deck at it, re-score.
//
// Extracted from `routes/decks.ts` in Session 6 so the authenticated re-upload
// (`POST /api/decks/:id/version`) and the PUBLIC tokenized founder resubmit
// (`POST /api/resubmit/:token`) run exactly the same path — same credit
// accounting, same R2 layout, same rescore-guard bump. The two callers differ
// only in how the actor is authorised, never in what happens to the deck.
//
// Everything here takes `Env` rather than a Hono context, because the public
// caller has no `c.var.user`.

import type { Env } from "../types";
import type { Edition } from "../../shared/roles";
import { evaluateDeck, type EvaluationResult } from "../ai/evaluate";
import { recordEvalFailure } from "../ai/health";

// Anthropic caps a Messages request at 32 MB; the PDF is base64-encoded (~1.33×)
// into one request, so keep the raw deck comfortably under that.
export const MAX_PDF_BYTES = 24 * 1024 * 1024;

export function isPdf(file: unknown): file is File {
  return (
    file instanceof File &&
    (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))
  );
}

/** R2 key for a deck version. v1 keeps the historical `decks/<id>.pdf` path so
 *  every pre-Session-5 deck's stored object still resolves. */
export function versionKey(deckId: string, version: number): string {
  return version <= 1 ? `decks/${deckId}.pdf` : `decks/${deckId}_v${version}.pdf`;
}

/**
 * Atomically reserve `n` upload credits from an edition. The conditional UPDATE
 * only succeeds when the balance covers `n`, so concurrent uploads can't drive
 * it negative. Returns false when there aren't enough credits (→ 402, before any
 * R2 write). Admins top the balance up in Config.
 */
export async function reserveCredits(env: Env, edition: Edition, n: number): Promise<boolean> {
  const res = await env.DB.prepare(
    "UPDATE org_settings SET credits_balance = credits_balance - ? WHERE edition = ? AND credits_balance >= ?",
  )
    .bind(n, edition, n)
    .run();
  return res.meta.changes === 1;
}

/** Return `n` reserved credits — used to compensate when a store fails after the
 *  reservation, so a transient R2/DB error never silently burns credits. */
export async function refundCredits(env: Env, edition: Edition, n: number): Promise<void> {
  if (n <= 0) return;
  await env.DB.prepare(
    "UPDATE org_settings SET credits_balance = credits_balance + ? WHERE edition = ?",
  )
    .bind(n, edition)
    .run();
}

/** The `deck_versions` INSERT, as a statement so callers can batch it with theirs. */
export function versionStatement(
  env: Env,
  args: {
    deckId: string;
    version: number;
    key: string;
    file: File;
    note: string;
    uploadedBy: string | null;
    createdAt?: string;
  },
): D1PreparedStatement {
  return env.DB.prepare(
    "INSERT INTO deck_versions (id, deck_id, version, r2_key, file_name, size_bytes, uploaded_by, note, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(
    `${args.deckId}_v${args.version}`,
    args.deckId,
    args.version,
    args.key,
    args.file.name,
    args.file.size,
    args.uploadedBy,
    args.note,
    args.createdAt ?? new Date().toISOString(),
  );
}

export interface AddVersionArgs {
  deckId: string;
  edition: Edition;
  /** Current `decks.content_version`; the new version is this + 1. */
  contentVersion: number | null;
  file: File;
  note: string;
  /** `users.id` of the uploader, or null for an anonymous tokenized resubmit. */
  uploadedBy: string | null;
}

export type AddVersionResult =
  | { ok: true; version: number; evaluated: true; result: EvaluationResult }
  | { ok: true; version: number; evaluated: false }
  | { ok: false; error: "no_credits" };

/**
 * Store `file` as the deck's next version and re-score it.
 *
 * The new object is written **beside** the old one (history is never
 * overwritten), `decks.r2_key` follows the latest version, and `content_version`
 * is bumped — which is precisely the signal the Session-1 rescore guard waits
 * on, so the re-score below is always a legitimate one.
 *
 * Returns `evaluated: false` when the model call failed; the deck is handed to
 * the retrying queue consumer instead of being stranded unscored (§9).
 */
export async function addDeckVersion(env: Env, args: AddVersionArgs): Promise<AddVersionResult> {
  // Re-scoring the new version costs a credit, same as any other AI run.
  if (!(await reserveCredits(env, args.edition, 1))) return { ok: false, error: "no_credits" };

  const version = (args.contentVersion ?? 1) + 1;
  const key = versionKey(args.deckId, version);
  const ts = new Date().toISOString();

  try {
    await env.DECKS.put(key, await args.file.arrayBuffer(), {
      httpMetadata: { contentType: "application/pdf" },
    });
    await env.DB.batch([
      versionStatement(env, {
        deckId: args.deckId,
        version,
        key,
        file: args.file,
        note: args.note,
        uploadedBy: args.uploadedBy,
        createdAt: ts,
      }),
      env.DB.prepare(
        "UPDATE decks SET r2_key = ?, content_version = ?, updated_at = ? WHERE id = ?",
      ).bind(key, version, ts, args.deckId),
    ]);
  } catch (err) {
    await refundCredits(env, args.edition, 1);
    throw err;
  }

  try {
    return { ok: true, version, evaluated: true, result: await evaluateDeck(env, args.deckId) };
  } catch (err) {
    console.error(`re-upload evaluation failed for ${args.deckId}; enqueueing retry:`, err);
    // Record the reason (§9) so the deck stops looking like it is merely slow.
    await recordEvalFailure(env, args.deckId, err);
    try {
      await env.EVAL_QUEUE.send({ deckId: args.deckId });
    } catch (qerr) {
      console.error(`failed to enqueue retry for ${args.deckId}:`, qerr);
    }
    return { ok: true, version, evaluated: false };
  }
}
