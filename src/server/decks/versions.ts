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
import { emitNotification } from "../email/outbox";
import { LOW_CREDIT_THRESHOLD } from "../../shared/notifications";
// W4-C — the ledger row behind every credit this application spends.
import { recordLedgerEntry } from "../billing/ledger";

/**
 * The largest deck PDF the application accepts. **50 MB** — the client's
 * 2026-09-20 answer ("For now, let's set it to 50MB. We will review after the
 * beta launch how it goes"), and what the prototype's dropzone has said all
 * along while we enforced 24.
 *
 * This number is no longer load-bearing for the AI, and that is the point.
 * It used to be `32 × 3/4`: the Messages endpoint caps a request body at 32 MB
 * and a base64 `document` block expands the PDF by 4/3, so 24 MB was the
 * largest deck that could be inlined — and raising it alone would have made
 * uploads succeed and evaluation fail. `src/server/ai/evaluate.ts` now weighs
 * each request and sends anything that does not fit via the Files API (500 MB
 * per file) instead, so this is a product limit rather than a transport one.
 * Keep it equal to `MAX_DECK_PDF_BYTES` in `src/shared/intake.ts`; a worker
 * test pins the two.
 */
export const MAX_PDF_BYTES = 50 * 1024 * 1024;

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

/** What a reservation should say about itself in the ledger. */
export interface CreditContext {
  /** The deck the spend is for, when it already exists (a re-upload does). */
  deckId?: string | null;
  /** Overrides the default movement sentence. */
  note?: string | null;
  actorId?: string | null;
}

/**
 * Atomically reserve `n` upload credits from an edition. The conditional UPDATE
 * only succeeds when the balance covers `n`, so concurrent uploads can't drive
 * it negative. Returns false when there aren't enough credits (→ 402, before any
 * R2 write). Admins top the balance up in Config.
 *
 * W4-C — and it writes the `credit_ledger` debit. This is the one place every
 * credit the application spends passes through, so it is the only place a debit
 * per spend can be guaranteed: **one row per successful reservation, none for a
 * refused one**, written after the conditional UPDATE has committed. The balance
 * stays the authority — it is what makes the spend atomic — and the row is the
 * append-only explanation of it, which is what the Credits & billing usage
 * history renders.
 *
 * The debit carries **no money**. §8 Q1, ruled 2026-09-11: there is no per-deck
 * price, so an evaluation's whole record is "one credit".
 */
export async function reserveCredits(
  env: Env,
  edition: Edition,
  n: number,
  ctx: CreditContext = {},
): Promise<boolean> {
  const res = await env.DB.prepare(
    "UPDATE org_settings SET credits_balance = credits_balance - ? WHERE edition = ? AND credits_balance >= ?",
  )
    .bind(n, edition, n)
    .run();
  if (res.meta.changes !== 1) return false;

  await recordLedgerEntry(env, edition, {
    delta: -n,
    reason: "deck_evaluated",
    deckId: ctx.deckId ?? null,
    note: ctx.note ?? (n === 1 ? "Pitchdeck evaluation" : `Pitchdeck evaluation — ${n} decks`),
    actorId: ctx.actorId ?? null,
  });

  // W3-B producer — "Credit balance low — under 10 credits". Every credit the
  // app ever spends passes through this conditional UPDATE, which makes it the
  // one place the balance can cross the threshold, and the reservation has
  // already committed by the time we read it back.
  //
  // It fires on the CROSSING, not on every spend below the line: alerting once
  // at 9 is a warning, alerting again at 8, 7 and 6 is noise that trains an
  // administrator to filter the mail. Topping up and dropping back under
  // crosses again and alerts again, which is the behaviour you want.
  await announceIfCreditsLow(env, edition, n);
  return true;
}

/** Read the post-reservation balance and alert if this spend took it under. */
async function announceIfCreditsLow(env: Env, edition: Edition, spent: number): Promise<void> {
  const row = await env.DB.prepare("SELECT credits_balance FROM org_settings WHERE edition = ?")
    .bind(edition)
    .first<{ credits_balance: number }>();
  if (!row) return;
  const after = row.credits_balance;
  if (after >= LOW_CREDIT_THRESHOLD || after + spent < LOW_CREDIT_THRESHOLD) return;
  await emitNotification(env, {
    event: "credits_low",
    edition,
    title: `Credit balance low — ${after} credit${after === 1 ? "" : "s"} left`,
    body:
      `The ${edition === "vc" ? "VC" : "incubator"} workspace has ${after} evaluation ` +
      `credit${after === 1 ? "" : "s"} remaining, below the ${LOW_CREDIT_THRESHOLD}-credit ` +
      "warning line. Top up in the Admin console before the next upload is refused.",
    link: "/app/admin",
  });
}

/**
 * Return `n` reserved credits — used to compensate when a store fails after the
 * reservation, so a transient R2/DB error never silently burns credits.
 *
 * W4-C — the compensating `refund` row. It REVERSES the debit rather than
 * erasing it: the ledger is append-only, so a spend that was undone reads as a
 * pair that nets to zero and the balance ends where it started. An accounting
 * trail that deletes its own mistakes is not one.
 */
export async function refundCredits(
  env: Env,
  edition: Edition,
  n: number,
  ctx: CreditContext = {},
): Promise<void> {
  if (n <= 0) return;
  await env.DB.prepare(
    "UPDATE org_settings SET credits_balance = credits_balance + ? WHERE edition = ?",
  )
    .bind(n, edition)
    .run();
  await recordLedgerEntry(env, edition, {
    delta: n,
    reason: "refund",
    deckId: ctx.deckId ?? null,
    note: ctx.note ?? (n === 1 ? "Evaluation credit refunded" : `${n} evaluation credits refunded`),
    actorId: ctx.actorId ?? null,
  });
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
  if (!(await reserveCredits(env, args.edition, 1, { deckId: args.deckId })))
    return { ok: false, error: "no_credits" };

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
    await refundCredits(env, args.edition, 1, { deckId: args.deckId });
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
