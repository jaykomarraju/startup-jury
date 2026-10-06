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
import { asScope, recordLedgerEntry } from "../billing/ledger";
// T1-DECKS — T0's scope helper. `billing/ledger.ts`'s header hands this file the one
// arm of `recordLedgerEntry` that still accepts a bare `Edition`, because the public
// founder resubmit reaches the credit path with no session at all. The answer is
// `TENANT_OWNER`'s one-hop path: the tenant comes off the DECK ROW.
import { scoped, type TenantScope } from "../../shared/tenant";

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

/**
 * The bytes a PDF actually begins with — `%PDF`.
 *
 * ── WHY THE FILE NAME WAS NEVER ENOUGH ──────────────────────────────────────
 * `isPdf` below was the whole of the gate and it read the NAME: anything called
 * `*.pdf`, or anything the browser labelled `application/pdf`, was a deck. Measured
 * 2026-10-01 on `POST /api/decks/upload` with a renamed text file and again with a
 * 0-byte file — both accepted, and each one costs the customer four things in this
 * order: the credit is reserved before the model is ever reached
 * (`routes/decks.ts:2393`), the object is written to R2, four model calls are spent
 * on something that is not a document, and the R2 object is then unreachable
 * because nothing on the failure path owns it. The same gate sits on the PUBLIC,
 * unauthenticated founder resubmit (`routes/resubmit.ts:207`), so an
 * unauthenticated caller holding a live link could burn a customer's credits four
 * model calls at a time.
 *
 * ── WHY FOUR BYTES AND NOT FIVE ─────────────────────────────────────────────
 * ISO 32000-1 §7.5.2 writes the header as `%PDF-1.n`, so `%PDF-` — five bytes — is
 * the stricter prefix and is the one libmagic matches. It is deliberately NOT what
 * this constant holds, and the reason is measured rather than aesthetic:
 * `grep -rn "37, 80, 68, 70" test/worker/` returns **27 lines in 20 files** — 19
 * suites plus `apply-migrations.ts`, the pool's own setup file, which seeds every
 * seeded deck's R2 object with exactly those four bytes and labels them `"%PDF"` in
 * a comment, as does `deck-file-guard.test.ts:36`. Four bytes, no version byte.
 * Requiring the fifth would redden a fifth of the worker suite in one change, in
 * files this lane does not own and on the eve of a live call — and it would buy no
 * discrimination that matters: nothing a person uploads begins `%PDF` and is not a
 * PDF. Adding the `-` is a one-byte edit per fixture; it is recorded as a follow-up
 * in the lane report rather than smuggled in here. Every e2e upload already sends
 * real `%PDF-1.4` content, so only the worker fixtures are in the way.
 */
const PDF_SIGNATURE = Uint8Array.of(0x25, 0x50, 0x44, 0x46); // "%PDF"

/**
 * The CHEAP half of the gate, and the only half that can be a type predicate: a
 * `File`, non-empty, named or typed as a PDF. Stays synchronous so the four call
 * sites that already narrow `FormDataEntryValue` with it keep doing so unchanged.
 *
 * `file.size > 0` is new and belongs here rather than in `isPdfContent` below for a
 * reason: a 0-byte upload is the one bad input that cannot be told from a good one
 * by reading bytes, because there are none to read. Refusing it synchronously closes
 * it at every existing call site — the single upload, the bulk loop, the
 * authenticated re-upload and the public resubmit — without any of them changing a
 * line. 0 bytes is never a document, and a browser produces one from a directory
 * drag or a file that moved mid-upload.
 */
export function isPdf(file: unknown): file is File {
  return (
    file instanceof File &&
    file.size > 0 &&
    (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))
  );
}

/**
 * The EXPENSIVE half: does this file begin like a PDF?
 *
 * Separate from `isPdf` because reading even four bytes off a `Blob` is async, and a
 * `file is File` type predicate cannot be. So this is the one line each call site
 * has to add — see `addDeckVersion` below, which does it for both re-upload paths,
 * and the lane report for the two in `routes/decks.ts` that this lane does not own.
 *
 * Reads a four-byte SLICE, not the body: `file.slice(0, 4).arrayBuffer()` pulls four
 * bytes however large the deck is, and leaves the file re-readable — `addDeckVersion`
 * calls `args.file.arrayBuffer()` afterwards to store it, and a 50 MB deck must not
 * be buffered twice. Verified against workerd, not assumed, because a `File` that
 * had been backed by a consumable stream would have made the second read empty and
 * stored a 0-byte object in R2: `test/worker/l5-hardening.test.ts` asserts the full
 * body still comes back after this check has run.
 */
export async function isPdfContent(file: File): Promise<boolean> {
  if (file.size < PDF_SIGNATURE.length) return false;
  const head = new Uint8Array(await file.slice(0, PDF_SIGNATURE.length).arrayBuffer());
  return PDF_SIGNATURE.every((byte, i) => head[i] === byte);
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
  scope: TenantScope | Edition,
  n: number,
  ctx: CreditContext = {},
): Promise<boolean> {
  // ── WHY THIS ONE IS WORSE THAN A LEAK ───────────────────────────────────────
  // `org_settings` was keyed on `edition` alone and its PK is now
  // `(tenant_id, edition)`, so with a second customer this UPDATE matched TWO rows.
  // It would not merely have read another customer's balance — it would have
  // DEBITED it, and then `res.meta.changes !== 1` would have been true (changes
  // === 2), so the function would have returned false and refused the upload as
  // "no credits" **after taking the credit from both customers**. §2 B24-30 names
  // the refund half of this ("credit refunds charged to an edition, not a
  // customer"); the reservation half breaks the gate as well as the books.
  const sc = asScope(scope);
  const q = scoped(sc).on("org_settings").and("org_settings.credits_balance >= ?", n);
  const res = await env.DB.prepare(
    `UPDATE org_settings SET credits_balance = credits_balance - ? ${q.whereClause()}`,
  )
    // `n` is the SET bind and comes earlier in the statement than the builder's.
    .bind(n, ...q.binds)
    .run();
  if (res.meta.changes !== 1) return false;

  await recordLedgerEntry(env, sc, {
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
  await announceIfCreditsLow(env, sc, n);
  return true;
}

/** Read the post-reservation balance and alert if this spend took it under. */
async function announceIfCreditsLow(env: Env, scope: TenantScope, spent: number): Promise<void> {
  const { edition } = scope;
  const q = scoped(scope).on("org_settings");
  const row = await env.DB.prepare(`SELECT credits_balance FROM org_settings ${q.whereClause()}`)
    .bind(...q.binds)
    .first<{ credits_balance: number }>();
  if (!row) return;
  const after = row.credits_balance;
  if (after >= LOW_CREDIT_THRESHOLD || after + spent < LOW_CREDIT_THRESHOLD) return;
  await emitNotification(env, {
    event: "credits_low",
    // ── THE LEAK THIS CLOSES, AND WHY IT WAS INVISIBLE ────────────────────────
    // This function already HELD the whole scope and passed only its edition half.
    // `emitNotification` resolves the workspace through `resolveTenant`
    // (`email/outbox.ts:216-231`), whose three arms are, in order: the caller's
    // `scope`, the tenant of the named `deckId`, then `DEFAULT_TENANT_ID` with a
    // warning. A low-credit alert names no deck, so this call site fell through to
    // the third arm — and that is not a missing email, it is a misdirected one:
    // a second customer's low-balance alert was written into and MAILED FROM the
    // first customer's workspace, to the first customer's admins, while the
    // customer whose balance had actually dropped was told nothing and found out
    // when their next upload returned 402. The `t_default` fallback was observed
    // firing in the dev log, which is the only trace it leaves.
    //
    // `edition` stays as well as `scope`: `NotificationInput` keeps both because
    // `AUDIENCE` is dimensioned on the edition as a PRODUCT VARIANT, and the two
    // must agree. They do here — `edition` is destructured from this same scope.
    scope,
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
  scope: TenantScope | Edition,
  n: number,
  ctx: CreditContext = {},
): Promise<void> {
  if (n <= 0) return;
  // The credit goes back to the customer it was taken from. Unscoped, this
  // CREDITED every customer in the edition — §2 B24-30's "tenant A's failed
  // evaluation refunds a balance tenant B draws on", which is a transfer of value
  // between customers written as a single UPDATE.
  const sc = asScope(scope);
  const q = scoped(sc).on("org_settings");
  await env.DB.prepare(`UPDATE org_settings SET credits_balance = credits_balance + ? ${q.whereClause()}`)
    .bind(n, ...q.binds)
    .run();
  await recordLedgerEntry(env, sc, {
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
  /**
   * The caller's edition. **No longer the scope** — `addDeckVersion` reads the
   * workspace off the DECK ROW, because its other caller is the PUBLIC tokenized
   * founder resubmit (`routes/resubmit.ts`), which has no session and therefore no
   * tenant to pass. The field stays, and keeps its name, as the CROSS-CHECK: a
   * caller that thinks it is re-versioning an incubator deck and reaches a VC one
   * is a routing bug, and it now says so instead of proceeding.
   */
  edition: Edition;
  /** Current `decks.content_version`; the new version is this + 1. */
  contentVersion: number | null;
  file: File;
  note: string;
  /** `users.id` of the uploader, or null for an anonymous tokenized resubmit. */
  uploadedBy: string | null;
}

/**
 * `error` gained `"pdf_required"` beside `"no_credits"`, and the two existing
 * callers need ONE LINE each to tell them apart.
 *
 * Both of them (`routes/decks.ts:2632`, `routes/resubmit.ts:228`) currently read
 * `if (!added.ok) return c.json({ error: "no_credits" }, 402)` with the code
 * hard-coded, so they still compile and a refused file reports "no credits" —
 * wrong, and on the GCW pilot actively misleading, because "no credits" is the one
 * thing that account is being set up not to say. Each already has a `pdf_required`
 * 400 branch directly above for `isPdf`, so the change is to reuse that code:
 *
 *   if (!added.ok) {
 *     return added.error === "pdf_required"
 *       ? c.json({ error: "pdf_required" }, 400)
 *       : c.json({ error: "no_credits" }, 402);
 *   }
 *
 * The union is widened here rather than the check being left to the call sites
 * because this function is where the credit is reserved. A validation that lives in
 * the caller is a validation each new caller can forget, and the §9 queue consumer
 * is a caller this file will gain.
 */
export type AddVersionResult =
  | { ok: true; version: number; evaluated: true; result: EvaluationResult }
  | { ok: true; version: number; evaluated: false }
  | { ok: false; error: "no_credits" | "pdf_required" };

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
  // ── FIRST, BEFORE ANYTHING IS SPENT OR WRITTEN ──────────────────────────────
  // Four bytes read off the front of the file, ahead of the owner lookup, the credit
  // reservation and the R2 put. The order is the point: `reserveCredits` below
  // commits a `credit_ledger` debit, and a refund only ever reverses it — the ledger
  // is append-only on purpose — so a deck refused AFTER the reservation leaves a
  // matched debit/refund pair in the customer's usage history for a file that was
  // never a deck. Refused here, nothing happened at all.
  if (!(await isPdfContent(args.file))) return { ok: false, error: "pdf_required" };

  // ── THE TENANT COMES OFF THE DECK, NOT OFF THE CALLER ───────────────────────
  // `TENANT_OWNER`'s one-hop path, read directly because this is the owner table
  // itself. Unscoped on purpose: both callers have already resolved this deck — the
  // authenticated one through `oneDeck()` in `routes/decks.ts`, the public one
  // through a single-use `resubmit_tokens` row — and the public one has no session
  // whose scope could be compared against anything.
  const owner = await env.DB.prepare("SELECT tenant_id, edition FROM decks WHERE id = ?")
    .bind(args.deckId)
    .first<{ tenant_id: string; edition: Edition }>();
  if (!owner) throw new Error(`deck not found: ${args.deckId}`);
  if (owner.edition !== args.edition) {
    // Loud, not silent. The alternative is spending a credit from one workspace on
    // a deck in another, which is the §2 B24-30 shape with the sign reversed.
    throw new Error(
      `deck ${args.deckId} is in edition ${owner.edition}, not ${args.edition}`,
    );
  }
  const scope: TenantScope = { tenantId: owner.tenant_id, edition: owner.edition };

  // Re-scoring the new version costs a credit, same as any other AI run.
  if (!(await reserveCredits(env, scope, 1, { deckId: args.deckId })))
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
    await refundCredits(env, scope, 1, { deckId: args.deckId });
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
