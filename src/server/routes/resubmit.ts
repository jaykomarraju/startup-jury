// PUBLIC founder resubmit route (Session 6) — deliberately NOT behind
// `requireAuth`. The tokenized link in the Incomplete-deck email is the entire
// credential: 192 bits of entropy, stored only as a SHA-256 hash, scoped to one
// deck, expiring and revocable (see `server/resubmit.ts`).
//
// Founders are external people who do not have accounts, so there is nothing to
// log in with. What keeps this safe is that the token grants exactly two
// capabilities on exactly one deck:
//
//   GET  — read back WHAT IS MISSING (missing intake columns + the deck sections
//          the extraction flagged absent). Deliberately no scores, no evaluator
//          names, no other deck: a leaked link must not become a data leak.
//   POST — upload a replacement PDF, which becomes a new deck version and is
//          re-scored, exactly as the authenticated re-upload does.
//
// Each POST spends an AI credit, so uses are capped per token — a leaked link
// cannot be turned into an unbounded bill.

import { Hono } from "hono";
import type { AppEnv } from "../types";
import type { Edition } from "../../shared/roles";
import { getStage } from "../../pipeline";
import { parseMissingFields } from "../../shared/intake";
import { scoped, type TenantScope } from "../../shared/tenant";
import {
  verifyResubmitToken,
  markTokenUsed,
  tokenScope,
  type ResubmitTokenRow,
  type TokenFailure,
} from "../resubmit";
import { addDeckVersion, isPdf, MAX_PDF_BYTES } from "../decks/versions";
// V4-SIZE — the founder-facing size is DERIVED from the limit that rejects,
// never typed. It read "24 MB" as a literal and was stale the moment the
// limit moved; the same drift the Upload screen was already protected from.
import { MAX_DECK_SIZE_LABEL } from "../../shared/uploadReview";

const resubmit = new Hono<AppEnv>();

/** How many times one link may be used. Each use costs an AI credit. */
const MAX_USES = 10;

const FAILURE_STATUS: Record<TokenFailure, 404 | 410> = {
  invalid_token: 404,
  token_expired: 410,
  token_revoked: 410,
};

const FAILURE_MESSAGE: Record<TokenFailure, string> = {
  invalid_token: "This link isn't valid. Please use the most recent email we sent you.",
  token_expired: "This link has expired. Ask the programme team to send you a new one.",
  token_revoked:
    "This link has been replaced by a newer one. Please use the most recent email we sent you.",
};

interface DeckRow {
  id: string;
  edition: Edition;
  name: string;
  sector: string | null;
  stage: string | null;
  city: string | null;
  status: string;
  complete: number;
  content_version: number | null;
  missing_fields: string | null;
  founder: string | null;
  uploaded_by: string | null;
}

/**
 * The deck this token opens — **inside the token's own workspace**.
 *
 * The scope is the one half of this route that is not about the founder. A
 * resubmit token is a bearer credential on tenant-owned data, so "which deck"
 * and "whose deck" have to be one question: a token whose `tenant_id` does not
 * match its deck's answers 404 here, exactly as a revoked or forged one does.
 * `mintResubmitToken` makes that mismatch unconstructible by deriving the
 * token's workspace from the deck; this is the other end of the same guard, and
 * it fails CLOSED — a mis-filed credential opens nothing rather than opening
 * another customer's record.
 */
async function loadDeck(
  env: AppEnv["Bindings"],
  deckId: string,
  scope: TenantScope,
): Promise<DeckRow | null> {
  const q = scoped(scope).on("d").and("d.id = ?", deckId);
  return env.DB.prepare(
    "SELECT d.id, d.edition, d.name, d.sector, d.stage, d.city, d.status, d.complete, " +
      `d.content_version, d.missing_fields, d.founder, d.uploaded_by FROM decks d ${q.whereClause()}`,
  )
    .bind(...q.binds)
    .first<DeckRow>();
}

/** The founder-visible view of a deck. Never includes scores or evaluator data. */
async function deckPayload(env: AppEnv["Bindings"], deck: DeckRow, token: ResubmitTokenRow) {
  const scope = tokenScope(token);
  // `deck_extractions` and `deck_versions` carry no workspace key — both are
  // §5b proxy tables owned by `decks` — so the predicate comes from
  // `TENANT_OWNER` rather than from the `deck_id` bind standing alone.
  const sq = scoped(scope);
  const sJoins = sq.viaParent("deck_extractions", "x");
  sq.and("x.deck_id = ?", deck.id).andRaw("x.missing = 1");
  const sections = (
    await env.DB.prepare(
      `SELECT x.label, x.heading, x.text FROM deck_extractions x ${sJoins} ${sq.whereClause()} ORDER BY x.sort_order`,
    )
      .bind(...sq.binds)
      .all<{ label: string; heading: string | null; text: string | null }>()
  ).results;

  const vq = scoped(scope);
  const vJoins = vq.viaParent("deck_versions", "v");
  vq.and("v.deck_id = ?", deck.id);
  const versions = (
    await env.DB.prepare(
      `SELECT v.version, v.file_name, v.note, v.created_at FROM deck_versions v ${vJoins} ${vq.whereClause()} ORDER BY v.version DESC`,
    )
      .bind(...vq.binds)
      .all<{ version: number; file_name: string | null; note: string | null; created_at: string }>()
  ).results;

  return {
    deck: {
      name: deck.name,
      founder: deck.founder,
      sector: deck.sector,
      stage: deck.stage,
      city: deck.city,
      status: deck.status,
      statusLabel: getStage(deck.edition, deck.status)?.label ?? deck.status,
      complete: deck.complete === 1,
      version: deck.content_version ?? 1,
    },
    missingFields: parseMissingFields(deck.missing_fields),
    missingSections: sections.map((s) => ({
      label: s.label,
      heading: s.heading ?? undefined,
      text: s.text ?? undefined,
    })),
    versions: versions.map((v) => ({
      version: v.version,
      fileName: v.file_name ?? undefined,
      note: v.note ?? undefined,
      createdAt: v.created_at,
    })),
    expiresAt: token.expires_at,
    usesLeft: Math.max(0, MAX_USES - token.use_count),
  };
}

/** GET /api/resubmit/:token — what the founder needs to fix, and the deck's history. */
resubmit.get("/:token", async (c) => {
  const check = await verifyResubmitToken(c.env, c.req.param("token"));
  if (!check.ok) {
    return c.json(
      { error: check.reason, message: FAILURE_MESSAGE[check.reason] },
      FAILURE_STATUS[check.reason],
    );
  }
  const deck = await loadDeck(c.env, check.token.deck_id, tokenScope(check.token));
  // The deck was deleted after the link went out (ON DELETE CASCADE normally
  // takes the token with it, so this is belt-and-braces).
  if (!deck) {
    return c.json({ error: "invalid_token", message: FAILURE_MESSAGE.invalid_token }, 404);
  }
  return c.json(await deckPayload(c.env, deck, check.token));
});

/**
 * POST /api/resubmit/:token — the founder uploads the corrected deck.
 *
 * Stored as a new version, `content_version` bumped (which is what makes the
 * re-score legitimate under the Session-1 rescore guard), then re-scored. The
 * deck returns to the evaluator automatically — nothing else is required of the
 * founder, and no separate Q&A artefact is produced (§8).
 */
resubmit.post("/:token", async (c) => {
  const check = await verifyResubmitToken(c.env, c.req.param("token"));
  if (!check.ok) {
    return c.json(
      { error: check.reason, message: FAILURE_MESSAGE[check.reason] },
      FAILURE_STATUS[check.reason],
    );
  }
  const token = check.token;
  if (token.use_count >= MAX_USES) {
    return c.json(
      {
        error: "too_many_resubmits",
        message:
          "This link has been used too many times. Please contact the programme team for a new one.",
      },
      429,
    );
  }

  const deck = await loadDeck(c.env, token.deck_id, tokenScope(token));
  if (!deck) {
    return c.json({ error: "invalid_token", message: FAILURE_MESSAGE.invalid_token }, 404);
  }

  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!isPdf(file)) {
    return c.json({ error: "pdf_required", message: "Please upload your deck as a PDF." }, 400);
  }
  if (file.size > MAX_PDF_BYTES) {
    return c.json(
      { error: "pdf_too_large", message: `That PDF is larger than ${MAX_DECK_SIZE_LABEL}.` },
      413,
    );
  }

  const added = await addDeckVersion(c.env, {
    deckId: deck.id,
    edition: deck.edition,
    contentVersion: deck.content_version,
    file,
    note: "Founder resubmission via secure link",
    // Attributed to no user account: the actor is an external founder holding a
    // link, not a platform login. The note above is what identifies the source.
    uploadedBy: null,
  });

  if (!added.ok) {
    return c.json(
      {
        error: "no_credits",
        message:
          "We couldn't re-score your deck right now. Your upload wasn't saved — please try again shortly.",
      },
      402,
    );
  }

  await markTokenUsed(c.env, token.id);

  // Re-read: the evaluation just rewrote status / complete / missing_fields.
  const updated = (await loadDeck(c.env, deck.id, tokenScope(token))) ?? deck;
  return c.json({
    ok: true,
    version: added.version,
    evaluated: added.evaluated,
    ...(await deckPayload(c.env, updated, { ...token, use_count: token.use_count + 1 })),
  });
});

export default resubmit;
