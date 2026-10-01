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
import { parseMissingFields } from "../../shared/intake";
import { scopeOf, scoped, type TenantScope } from "../../shared/tenant";
import { requireAuth, requireTask } from "../auth/middleware";
// W3-C — the bank is scoring configuration: an edit changes what a founder
// is asked, so it belongs in the Config trail.
import { auditConfig } from "../audit/events";
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
const requireAdmin = requireTask("adminconsole", "admin");

/**
 * Reading a draft is for whoever can raise the query it drafts, which is the
 * role list on `POST /api/decks/:id/queries` (`routes/pipeline.ts`). Both
 * editions raise the same loop; only the roles differ.
 */
const requireQuerier = requireTask(
  "query",
  "program_associate",
  "program_manager",
  "admin",
  "analyst",
  "associate",
  "partner",
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
  scope: TenantScope,
): Promise<{ areas: AreaRow[]; byArea: Map<string, BankRow[]> }> {
  // `question_bank` carries no tenant column — it is keyed to `parameters.id` and
  // owned through it (§5b's proxy bucket, `TENANT_OWNER`). So the scope goes on
  // `parameters` in BOTH halves, and the second half is the one that matters:
  // adding `tenant_id` to `parameters` does nothing for a statement that reads
  // `question_bank` and names only `p.edition`. §2 B24 is this route family.
  const aq = scoped(scope).on("p").andRaw("p.active = 1 AND p.informational = 0");
  const bq = scoped(scope).on("p").andRaw("q.active = 1");
  const [areas, rows] = await Promise.all([
    c.env.DB.prepare(
      "SELECT p.id, p.key, p.name, p.sort_order FROM parameters p " +
        `${aq.whereClause()} ORDER BY p.sort_order`,
    )
      .bind(...aq.binds)
      .all<AreaRow>(),
    c.env.DB.prepare(
      "SELECT q.id, q.parameter_id, q.seq, q.text, q.active FROM question_bank q " +
        "JOIN parameters p ON p.id = q.parameter_id " +
        `${bq.whereClause()} ORDER BY q.seq, q.rowid`,
    )
      .bind(...bq.binds)
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

/**
 * The question, if it exists and belongs to the caller's WORKSPACE.
 *
 * This is the gate for every write below — `PUT /:id`, `DELETE /:id` and the
 * reorder all take their row id from here and then write `WHERE id = ?`. So the
 * predicate on this one statement is what stands between a console admin and
 * another customer's clarification bank, which is why the writes are safe without
 * a predicate of their own and why this one is not optional.
 */
async function loadQuestion(c: Context<AppEnv>, id: string): Promise<BankRow | null> {
  const q = scoped(scopeOf(c.var.user)).on("p").and("q.id = ?", id);
  return c.env.DB.prepare(
    "SELECT q.id, q.parameter_id, q.seq, q.text, q.active FROM question_bank q " +
      `JOIN parameters p ON p.id = q.parameter_id ${q.whereClause()}`,
  )
    .bind(...q.binds)
    .first<BankRow>();
}

/** The area, if it exists, is scored, and belongs to the caller's workspace. */
async function loadArea(c: Context<AppEnv>, parameterId: string): Promise<AreaRow | null> {
  const q = scoped(scopeOf(c.var.user))
    .on("p")
    .and("p.id = ?", parameterId)
    .andRaw("p.active = 1 AND p.informational = 0");
  return c.env.DB.prepare(
    `SELECT p.id, p.key, p.name, p.sort_order FROM parameters p ${q.whereClause()}`,
  )
    .bind(...q.binds)
    .first<AreaRow>();
}

// ═══════════════════════════════════════════════════════════════════════════
// The bank
// ═══════════════════════════════════════════════════════════════════════════

/** GET /api/questions — the thirteen accordions and their questions. */
questions.get("/", requireAdmin, async (c) => {
  const { edition } = c.var.user;
  const { areas, byArea } = await loadBank(c, scopeOf(c.var.user));
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
  //
  // `WHERE parameter_id = ?` with no tenant predicate, deliberately: `area.id`
  // came from `loadArea`, which is scoped, and `question_bank` has no tenant
  // column of its own — it is owned through `parameters`. An aggregate over a
  // validated parent id is the one shape §11's warning does not apply to, because
  // the owner was named one frame up rather than nowhere. The same reasoning
  // covers the reorder read and all three `UPDATE … WHERE id = ?` writes below:
  // every id reaching them passed `loadArea` or `loadQuestion` first.
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
  await auditConfig(c, "bank_question_added", `Clarification question added to ${area.name}`, {
    targetType: "question_bank",
    targetId: id,
    detail: { text },
  });
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
  await auditConfig(c, "bank_reordered", `Clarification questions reordered for ${area.name}`, {
    targetType: "question_bank",
    targetId: area.id,
  });
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
  await auditConfig(c, "bank_question_edited", `Clarification question Q${row.seq} reworded`, {
    targetType: "question_bank",
    targetId: row.id,
    detail: { from: row.text, to: text },
  });
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
  await auditConfig(c, "bank_question_removed", `Clarification question Q${row.seq} removed`, {
    targetType: "question_bank",
    targetId: row.id,
    detail: { text: row.text },
  });
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
  const scope = scopeOf(c.var.user);
  // Three correlated sub-selects hang off this one predicate, and two of them
  // reach tenant-owned data through `d.id` alone: `scores` and `deck_extractions`
  // are both deck-owned with no scope of their own (§5b's proxy bucket). The
  // `org_settings` sub-select is the one that needed its own predicate — it
  // correlated on `o.edition = d.edition`, which is a column with two values, so
  // it read whichever customer's threshold the edition matched first and then
  // decided which of THIS deck's areas count as weak. It correlates on the deck's
  // tenant now, and the deck's tenant is this caller's because of the outer scope.
  const dq = scoped(scope).on("d").and("d.id = ?", c.req.param("deckId"));
  const deck = await c.env.DB.prepare(
    "SELECT d.id, d.name, d.missing_fields, " +
      "(SELECT GROUP_CONCAT(s.parameter_id, '||') FROM scores s JOIN parameters p ON p.id = s.parameter_id " +
      "  WHERE s.deck_id = d.id AND s.evaluator_kind = 'ai' AND p.informational = 0 " +
      "    AND s.value < (SELECT o.threshold_mediocre FROM org_settings o " +
      "                    WHERE o.tenant_id = d.tenant_id AND o.edition = d.edition)) AS weak_area_ids, " +
      "(SELECT GROUP_CONCAT(e.label, '||') FROM deck_extractions e WHERE e.deck_id = d.id AND e.missing = 1) AS missing_sections " +
      `FROM decks d ${dq.whereClause()}`,
  )
    .bind(...dq.binds)
    .first<DraftDeckRow>();
  if (!deck) return c.json({ error: "not_found" }, 404);

  const { areas, byArea } = await loadBank(c, scope);
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

  const sq = scoped(scope).on("oss");
  const settings = await c.env.DB.prepare(
    `SELECT oss.auto_clarification FROM org_scoring_settings oss ${sq.whereClause()}`,
  )
    .bind(...sq.binds)
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
