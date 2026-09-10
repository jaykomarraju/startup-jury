/**
 * W2-C — the Clarification question bank (`admin/s-qb.html`) and the
 * clarification letter it feeds.
 *
 * The prototype's section is thirteen accordions holding 68 curated questions
 * — five per evaluation area, eight for Climate Impact & Integrity — under the
 * promise that they are "auto-triggered to the startup when the AI detects
 * weak, missing, or contradictory signal in a given area. Replicated from the
 * BRD; edit or add questions per area." `migrations/0028_question_bank.sql`
 * holds them, keyed to `parameters.id` so the two editions can diverge the
 * moment one is edited.
 *
 * Two things live here:
 *
 *   • **the bank's CRUD** — read, add, edit, soft-delete and reorder, admin
 *     only. `seq` is what the accordion's Q1…Qn ordinals render, so reorder
 *     rewrites it densely from 1. Delete is `active = 0` rather than a row
 *     removal: a query already sent quotes its questions verbatim, and a
 *     founder reading it back months later must still see what was asked.
 *
 *   • **the producer** — `GET /draft/:deckId`, which composes the founder's
 *     clarification letter from the bank instead of from bare area labels
 *     (findings F0030, F0096). It honours
 *     `org_scoring_settings.auto_clarification` for the AUTOMATIC decision
 *     only; see `shouldAutoClarify` in `src/shared/queries.ts`.
 *
 * Mounted at `/api/questions` (plan §10, Wave 2 server-route ownership) — this
 * wave's `config.ts` belongs to `W2-A`.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../types";
import type { Edition } from "../../shared/roles";
import { parseMissingFields } from "../../shared/intake";
import { requireAuth, requireRole } from "../auth/middleware";
import {
  areasNeedingResponse,
  buildQueryMessage,
  selectClarificationQuestions,
  shouldAutoClarify,
  type BankArea,
} from "../../shared/queries";

const questions = new Hono<AppEnv>();
questions.use("*", requireAuth);

/** Editing the bank is a rubric change — the same gate `config.ts` uses. */
const requireAdmin = requireRole("admin");

/**
 * Reading a draft is for whoever can raise the query it drafts, which is the
 * role list on `POST /api/decks/:id/queries` (`routes/pipeline.ts`). Both
 * editions raise the same loop; only the roles differ.
 */
const requireQuerier = requireRole(
  "program_associate",
  "program_manager",
  "admin",
  "analyst",
  "associate",
);

/** Longest question the accordion will store. The prototype's longest is 84. */
const MAX_QUESTION_LENGTH = 400;

interface BankRow {
  id: string;
  parameter_id: string;
  seq: number;
  text: string;
  active: number;
}

interface AreaRow {
  id: string;
  key: string;
  name: string;
  sort_order: number;
}

async function readBody<T>(c: Context<AppEnv>): Promise<Partial<T>> {
  return (await c.req.json().catch(() => ({}))) as Partial<T>;
}

function cleanText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim().replace(/\s+/g, " ");
  if (!text || text.length > MAX_QUESTION_LENGTH) return null;
  return text;
}

/**
 * The bank as the accordion renders it: every core evaluation area of the
 * edition in `sort_order`, each with its ACTIVE questions in `seq` order.
 *
 * Informational parameters are excluded — that is the nine role-scoped
 * additional params (`0013` marks them all `informational = 1`), leaving the
 * prototype's thirteen accordions. `weak_areas` on a deck is derived with the
 * same filter in `routes/decks.ts`, so both sides of the clarification loop
 * see the same set of areas.
 */
async function loadBank(
  c: Context<AppEnv>,
  edition: Edition,
): Promise<{ areas: AreaRow[]; byArea: Map<string, BankRow[]> }> {
  const [areas, rows] = await Promise.all([
    c.env.DB.prepare(
      "SELECT id, key, name, sort_order FROM parameters " +
        "WHERE edition = ? AND active = 1 AND informational = 0 ORDER BY sort_order",
    )
      .bind(edition)
      .all<AreaRow>(),
    c.env.DB.prepare(
      "SELECT q.id, q.parameter_id, q.seq, q.text, q.active FROM question_bank q " +
        "JOIN parameters p ON p.id = q.parameter_id " +
        "WHERE p.edition = ? AND q.active = 1 ORDER BY q.seq, q.rowid",
    )
      .bind(edition)
      .all<BankRow>(),
  ]);

  const byArea = new Map<string, BankRow[]>();
  for (const row of rows.results) {
    const list = byArea.get(row.parameter_id);
    if (list) list.push(row);
    else byArea.set(row.parameter_id, [row]);
  }
  return { areas: areas.results, byArea };
}

function toBankAreas(areas: AreaRow[], byArea: Map<string, BankRow[]>): BankArea[] {
  return areas.map((a) => ({
    parameterId: a.id,
    name: a.name,
    questions: (byArea.get(a.id) ?? []).map((q) => q.text),
  }));
}

/** The question, if it exists and belongs to the caller's edition. */
async function loadQuestion(c: Context<AppEnv>, id: string): Promise<BankRow | null> {
  return c.env.DB.prepare(
    "SELECT q.id, q.parameter_id, q.seq, q.text, q.active FROM question_bank q " +
      "JOIN parameters p ON p.id = q.parameter_id WHERE q.id = ? AND p.edition = ?",
  )
    .bind(id, c.var.user.edition)
    .first<BankRow>();
}

/** The area, if it exists, is scored, and belongs to the caller's edition. */
async function loadArea(c: Context<AppEnv>, parameterId: string): Promise<AreaRow | null> {
  return c.env.DB.prepare(
    "SELECT id, key, name, sort_order FROM parameters " +
      "WHERE id = ? AND edition = ? AND active = 1 AND informational = 0",
  )
    .bind(parameterId, c.var.user.edition)
    .first<AreaRow>();
}

// ═══════════════════════════════════════════════════════════════════════════
// The bank
// ═══════════════════════════════════════════════════════════════════════════

/** GET /api/questions — the thirteen accordions and their questions. */
questions.get("/", requireAdmin, async (c) => {
  const edition = c.var.user.edition;
  const { areas, byArea } = await loadBank(c, edition);
  return c.json({
    edition,
    areas: areas.map((a) => ({
      parameterId: a.id,
      key: a.key,
      name: a.name,
      questions: (byArea.get(a.id) ?? []).map((q) => ({
        id: q.id,
        seq: q.seq,
        text: q.text,
      })),
    })),
  });
});

/** POST /api/questions — add one question to the end of an area. */
questions.post("/", requireAdmin, async (c) => {
  const body = await readBody<{ parameterId: string; text: string }>(c);
  const area = typeof body.parameterId === "string" ? await loadArea(c, body.parameterId) : null;
  if (!area) return c.json({ error: "unknown_area" }, 400);
  const text = cleanText(body.text);
  if (!text) return c.json({ error: "text_required" }, 400);

  // Appends after every row of the area, active or not, so a soft-deleted
  // question's ordinal is never handed to a new one.
  const max = await c.env.DB.prepare(
    "SELECT COALESCE(MAX(seq), 0) AS n FROM question_bank WHERE parameter_id = ?",
  )
    .bind(area.id)
    .first<{ n: number }>();
  const id = `qb_${crypto.randomUUID()}`;
  const seq = (max?.n ?? 0) + 1;
  await c.env.DB.prepare(
    "INSERT INTO question_bank (id, parameter_id, seq, text, active) VALUES (?, ?, ?, ?, 1)",
  )
    .bind(id, area.id, seq, text)
    .run();
  return c.json({ question: { id, parameterId: area.id, seq, text } }, 201);
});

/**
 * PUT /api/questions/reorder — rewrite one area's Q1…Qn order.
 *
 * The body carries the area's active questions in their new order; `seq` is
 * rewritten densely from 1, which is what the accordion's ordinals render.
 * Every active question of the area must appear exactly once — a partial list
 * would silently leave rows sharing a `seq`.
 */
questions.put("/reorder", requireAdmin, async (c) => {
  const body = await readBody<{ parameterId: string; ids: string[] }>(c);
  const area = typeof body.parameterId === "string" ? await loadArea(c, body.parameterId) : null;
  if (!area) return c.json({ error: "unknown_area" }, 400);
  const ids = Array.isArray(body.ids) ? body.ids.filter((i) => typeof i === "string") : [];

  const current = (
    await c.env.DB.prepare(
      "SELECT id, parameter_id, seq, text, active FROM question_bank " +
        "WHERE parameter_id = ? AND active = 1 ORDER BY seq, rowid",
    )
      .bind(area.id)
      .all<BankRow>()
  ).results;

  const expected = new Set(current.map((q) => q.id));
  const given = new Set(ids);
  if (ids.length !== expected.size || given.size !== ids.length) {
    return c.json({ error: "incomplete_order" }, 400);
  }
  for (const id of ids) if (!expected.has(id)) return c.json({ error: "incomplete_order" }, 400);

  await c.env.DB.batch(
    ids.map((id, i) =>
      c.env.DB.prepare("UPDATE question_bank SET seq = ? WHERE id = ?").bind(i + 1, id),
    ),
  );
  return c.json({ ok: true, parameterId: area.id, ids });
});

/** PUT /api/questions/:id — reword one question. */
questions.put("/:id", requireAdmin, async (c) => {
  const row = await loadQuestion(c, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  const body = await readBody<{ text: string }>(c);
  const text = cleanText(body.text);
  if (!text) return c.json({ error: "text_required" }, 400);
  await c.env.DB.prepare("UPDATE question_bank SET text = ? WHERE id = ?").bind(text, row.id).run();
  return c.json({
    question: { id: row.id, parameterId: row.parameter_id, seq: row.seq, text },
  });
});

/**
 * DELETE /api/questions/:id — retire one question.
 *
 * Soft (`active = 0`): the row stays so a query already sent still reads back
 * exactly as the founder received it.
 */
questions.delete("/:id", requireAdmin, async (c) => {
  const row = await loadQuestion(c, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  await c.env.DB.prepare("UPDATE question_bank SET active = 0 WHERE id = ?").bind(row.id).run();
  return c.json({ ok: true, id: row.id, active: false });
});

// ═══════════════════════════════════════════════════════════════════════════
// The producer
// ═══════════════════════════════════════════════════════════════════════════

interface DraftDeckRow {
  id: string;
  name: string;
  missing_fields: string | null;
  weak_area_ids: string | null;
  missing_sections: string | null;
}

/**
 * GET /api/questions/draft/:deckId — the clarification letter for one deck.
 *
 * Weak areas are derived exactly as `routes/decks.ts` derives the Query
 * screen's "Parameters needing response" — AI scores below the edition's
 * `threshold_mediocre` — so the draft and the screen can never disagree about
 * what is weak. Finding **F0042** argues that threshold is the wrong scale
 * (it is the All-Decks cohort band, not the rubric's Weak band) and it is
 * right, but the five-band scale it depends on is `W2-B`'s and is not merged;
 * changing the derivation here alone would make the two disagree. Recorded in
 * §8 rather than guessed at.
 *
 * The one thing this adds is `parameter_id`, which the deck view does not
 * carry: the bank is keyed to it.
 */
questions.get("/draft/:deckId", requireQuerier, async (c) => {
  const user = c.var.user;
  const deck = await c.env.DB.prepare(
    "SELECT d.id, d.name, d.missing_fields, " +
      "(SELECT GROUP_CONCAT(s.parameter_id, '||') FROM scores s JOIN parameters p ON p.id = s.parameter_id " +
      "  WHERE s.deck_id = d.id AND s.evaluator_kind = 'ai' AND p.informational = 0 " +
      "    AND s.value < (SELECT o.threshold_mediocre FROM org_settings o WHERE o.edition = d.edition)) AS weak_area_ids, " +
      "(SELECT GROUP_CONCAT(e.label, '||') FROM deck_extractions e WHERE e.deck_id = d.id AND e.missing = 1) AS missing_sections " +
      "FROM decks d WHERE d.id = ? AND d.edition = ?",
  )
    .bind(c.req.param("deckId"), user.edition)
    .first<DraftDeckRow>();
  if (!deck) return c.json({ error: "not_found" }, 404);

  const { areas, byArea } = await loadBank(c, user.edition);
  const nameById = new Map(areas.map((a) => [a.id, a.name]));
  const weakAreas: string[] = [];
  for (const id of (deck.weak_area_ids ?? "").split("||")) {
    const name = nameById.get(id.trim());
    if (name && !weakAreas.includes(name)) weakAreas.push(name);
  }
  const missingSections = (deck.missing_sections ?? "")
    .split("||")
    .map((s) => s.trim())
    .filter(Boolean);

  const responseAreas = areasNeedingResponse({
    missingFields: parseMissingFields(deck.missing_fields),
    missingSections,
    weakAreas,
  });

  const settings = await c.env.DB.prepare(
    "SELECT auto_clarification FROM org_scoring_settings WHERE edition = ?",
  )
    .bind(user.edition)
    .first<{ auto_clarification: number }>();
  // The table is seeded for both editions in 0026; a missing row means the
  // migration has not run, in which case the prototype's default (ON) applies.
  const autoClarification = (settings?.auto_clarification ?? 1) === 1;

  const bank = toBankAreas(areas, byArea);
  return c.json({
    deckId: deck.id,
    deckName: deck.name,
    autoClarification,
    /** Would the AI raise this letter on its own? (`s-fw` auto-trigger.) */
    triggered: shouldAutoClarify({ autoClarification, areas: responseAreas }),
    areas: responseAreas,
    questions: selectClarificationQuestions(responseAreas, bank),
    message: buildQueryMessage(deck.name, responseAreas, { bank }),
  });
});

export default questions;
