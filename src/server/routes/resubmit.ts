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
import {
  verifyResubmitToken,
  markTokenUsed,
  type ResubmitTokenRow,
  type TokenFailure,
} from "../resubmit";
import { addDeckVersion, isPdf, MAX_PDF_BYTES } from "../decks/versions";

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

async function loadDeck(env: AppEnv["Bindings"], deckId: string): Promise<DeckRow | null> {
  return env.DB.prepare(
    "SELECT id, edition, name, sector, stage, city, status, complete, content_version, " +
      "missing_fields, founder, uploaded_by FROM decks WHERE id = ?",
  )
    .bind(deckId)
    .first<DeckRow>();
}

/** The founder-visible view of a deck. Never includes scores or evaluator data. */
async function deckPayload(env: AppEnv["Bindings"], deck: DeckRow, token: ResubmitTokenRow) {
  const sections = (
    await env.DB.prepare(
      "SELECT label, heading, text FROM deck_extractions WHERE deck_id = ? AND missing = 1 ORDER BY sort_order",
    )
      .bind(deck.id)
      .all<{ label: string; heading: string | null; text: string | null }>()
  ).results;

  const versions = (
    await env.DB.prepare(
      "SELECT version, file_name, note, created_at FROM deck_versions WHERE deck_id = ? ORDER BY version DESC",
    )
      .bind(deck.id)
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
  const deck = await loadDeck(c.env, check.token.deck_id);
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

  const deck = await loadDeck(c.env, token.deck_id);
  if (!deck) {
    return c.json({ error: "invalid_token", message: FAILURE_MESSAGE.invalid_token }, 404);
  }

  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!isPdf(file)) {
    return c.json({ error: "pdf_required", message: "Please upload your deck as a PDF." }, 400);
  }
  if (file.size > MAX_PDF_BYTES) {
    return c.json({ error: "pdf_too_large", message: "That PDF is larger than 24 MB." }, 413);
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
  const updated = (await loadDeck(c.env, deck.id)) ?? deck;
  return c.json({
    ok: true,
    version: added.version,
    evaluated: added.evaluated,
    ...(await deckPayload(c.env, updated, { ...token, use_count: token.use_count + 1 })),
  });
});

export default resubmit;
