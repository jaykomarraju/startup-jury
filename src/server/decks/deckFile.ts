// F-FOUL — the deck-file precondition.
//
// Sep-2026 client feedback rows 8 ("eval reports and scores without decks —
// that's a Foul") and 12 ("startups without any decks, assigned to Jury").
//
// Neither is a defect in the creation path. `INSERT INTO decks` has exactly one
// call site — `storeDeck` (routes/decks.ts) — and it writes the R2 object BEFORE
// the row, binding `r2_key` to the key it just wrote; the only
// `UPDATE ... SET r2_key` (decks/versions.ts) likewise always sets a key it has
// just put. No API path produces a fileless deck.
//
// What was missing is the QUESTION. Nothing anywhere asked "does this deck have
// a file?" before handing it to an evaluator or recording a score against it, so
// a row that arrives fileless by some other route — our own demo seed, a future
// CRM import, a support-driven database edit, a restore from a partial backup —
// was assigned and scored without complaint. The AI path already refuses
// (`ai/evaluate.ts` throws on a missing key and again on a missing object); the
// human path did not, which is the worse half: an assignment is reversible, a
// submitted evaluation is a record.

/** How much of a deck's file actually exists. */
export type DeckFileState =
  /** `r2_key` is set and the object is there. */
  | "present"
  /** The row names no key — nothing was ever stored. */
  | "no_key"
  /** The row names a key with nothing behind it. */
  | "no_object";

/**
 * The pipeline actions that must not fire on a deck with no stored PDF.
 *
 * Keyed by ACTION rather than by route because `POST /decks/:id/transition` is a
 * generic dispatcher: a guard on the two purpose-built assign endpoints alone
 * would be bypassable by posting `{"action":"assign_jury"}` to it.
 *
 * The same precondition is applied to `POST /decks/:id/evaluate` directly. That
 * route's own `start_jury_eval` advance happens after the guard has run, so it
 * needs no entry here.
 */
export const DECK_FILE_ACTIONS = new Set<string>(["assign_jury"]);

/**
 * Column check plus `head()` — the full question, for one deck.
 *
 * Both halves are needed, and the second is the one that survives our own fix:
 * migration 0081 sets `r2_key` on the seeded decks, so a guard written as
 * `r2_key IS NOT NULL` would be satisfied by the very seed it was meant to
 * reject. A key with nothing behind it is WORSE than NULL — `GET
 * /api/decks/:id/file` already returns `no_pdf` for a dangling key, so the UI
 * looks identical while a column-only guard silently starts passing.
 */
export async function checkDeckFile(
  env: { DB: D1Database; DECKS: R2Bucket },
  deckId: string,
): Promise<DeckFileState> {
  const row = await env.DB.prepare("SELECT r2_key FROM decks WHERE id = ?")
    .bind(deckId)
    .first<{ r2_key: string | null }>();
  if (!row?.r2_key) return "no_key";
  return (await env.DECKS.head(row.r2_key)) ? "present" : "no_object";
}

/**
 * Column check only — the ids among `deckIds` whose row names no key.
 *
 * THE ASYMMETRY WITH `checkDeckFile` IS DELIBERATE; do not "tidy" it into one
 * function. The bulk assign path admits up to `MAX_DECKS` (100) decks in one
 * confirmation, and one R2 `head()` per row would turn a single refusal check
 * into a hundred sequential round trips on the happy path as well as the sad
 * one. A column check is cheap, catches the whole class the client reported, and
 * the decks it lets through are then guarded one at a time wherever a juror
 * actually opens or scores them. The single-deck paths — where the cost is one
 * call — pay for the stronger check.
 */
export async function decksWithoutFileKey(db: D1Database, deckIds: string[]): Promise<Set<string>> {
  if (deckIds.length === 0) return new Set();
  const rows = (
    await db
      .prepare(
        `SELECT id FROM decks WHERE r2_key IS NULL AND id IN (${deckIds.map(() => "?").join(", ")})`,
      )
      .bind(...deckIds)
      .all<{ id: string }>()
  ).results;
  return new Set(rows.map((r) => r.id));
}

/**
 * The refusal body for a single-deck path.
 *
 * `no_pdf` is reused rather than coined: the client already carries the code
 * (`api.ts`, `components/EvalScorecard.tsx`) and `ApiError` prefers `body.message`
 * over its own default, so the operator reads the sentence below without any
 * client change — the same arrangement `below_shortlist_minimum` uses.
 */
export function deckFileRefusal(
  state: Exclude<DeckFileState, "present">,
  deckName: string,
  verb: "assigned for evaluation" | "scored",
): { error: "no_pdf"; reason: DeckFileState; message: string } {
  return {
    error: "no_pdf",
    reason: state,
    message:
      state === "no_key"
        ? `${deckName} has no uploaded deck, so it cannot be ${verb}.`
        : `${deckName}'s deck file is missing from storage, so it cannot be ${verb}. Ask the founder to re-upload it.`,
  };
}
