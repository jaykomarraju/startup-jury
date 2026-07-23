// Deck routes: list + detail (Review-decks + Evaluation-report data), single
// upload (R2 → direct AI evaluation), and bulk upload (R2 → Queue). Uploads are
// PDF-only; each deck's PDF lives at `decks/<id>.pdf` in the DECKS bucket.

import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../types";
import type { Edition, Role } from "../../shared/roles";
import { getStage, allowedTransitions } from "../../pipeline";
import { requireAuth } from "../auth/middleware";
import { evaluateDeck } from "../ai/evaluate";

const decks = new Hono<AppEnv>();
decks.use("*", requireAuth);

interface DeckRow {
  id: string;
  name: string;
  sector: string | null;
  stage: string | null;
  city: string | null;
  founder: string | null;
  ai_score: number | null;
  signal: string | null;
  status: string;
  assigned_to?: string | null;
  assigned_to_name?: string | null;
}

function statusLabel(edition: Edition, status: string): string {
  return getStage(edition, status)?.label ?? status;
}

/** Transitions the current role may perform from a deck's stage (action buttons). */
function actionsFor(edition: Edition, status: string, role: Role) {
  return allowedTransitions(edition, status, role).map((t) => ({
    action: t.action,
    label: t.label,
    to: t.to,
  }));
}

function toDeckView(edition: Edition, row: DeckRow, role: Role) {
  return {
    id: row.id,
    name: row.name,
    sector: row.sector ?? undefined,
    stage: row.stage ?? undefined,
    city: row.city ?? undefined,
    founder: row.founder ?? undefined,
    aiScore: row.ai_score ?? undefined,
    signal: (row.signal as string | null) ?? undefined,
    status: statusLabel(edition, row.status),
    statusId: row.status,
    assignedTo: row.assigned_to ?? undefined,
    assignedToName: row.assigned_to_name ?? undefined,
    actions: actionsFor(edition, row.status, role),
  };
}

/** GET /api/decks — decks in the caller's edition (Review-decks table).
 *  Founders are isolated to their own submissions (portal scope). */
decks.get("/", async (c) => {
  const { id, edition, role } = c.var.user;
  const base =
    "SELECT d.id, d.name, d.sector, d.stage, d.city, d.founder, d.ai_score, d.signal, d.status, " +
    "d.assigned_to, u.name AS assigned_to_name " +
    "FROM decks d LEFT JOIN users u ON u.id = d.assigned_to WHERE d.edition = ?";
  const stmt =
    role === "founder"
      ? c.env.DB.prepare(`${base} AND d.uploaded_by = ? ORDER BY d.created_at DESC`).bind(edition, id)
      : c.env.DB.prepare(`${base} ORDER BY d.created_at DESC`).bind(edition);
  const rows = (await stmt.all<DeckRow>()).results;
  return c.json({ decks: rows.map((r) => toDeckView(edition, r, role)) });
});

const VERDICT_LABELS: Record<string, string> = {
  advanced: "Advanced — AI gate passed",
  below_gate: "Rejected — below AI gate",
  incomplete: "Incomplete — needs founder details",
};

/** GET /api/decks/:id — extraction + per-parameter AI scores (report drawer). */
decks.get("/:id", async (c) => {
  const { id: userId, edition, role } = c.var.user;
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(
    "SELECT d.id, d.name, d.sector, d.stage, d.city, d.founder, d.ai_score, d.signal, d.status, " +
      "d.assigned_to, d.uploaded_by, u.name AS assigned_to_name " +
      "FROM decks d LEFT JOIN users u ON u.id = d.assigned_to WHERE d.id = ? AND d.edition = ?",
  )
    .bind(id, edition)
    .first<DeckRow & { uploaded_by: string | null }>();
  if (!row) return c.json({ error: "not_found" }, 404);
  // Founders may only open their own submissions.
  if (role === "founder" && row.uploaded_by !== userId) return c.json({ error: "not_found" }, 404);

  const extraction = (
    await c.env.DB.prepare(
      "SELECT label, heading, text, missing FROM deck_extractions WHERE deck_id = ? ORDER BY sort_order",
    )
      .bind(id)
      .all<{ label: string; heading: string | null; text: string | null; missing: number }>()
  ).results.map((e) => ({
    label: e.label,
    heading: e.heading ?? undefined,
    text: e.text ?? "",
    missing: e.missing === 1,
  }));

  const scores = (
    await c.env.DB.prepare(
      "SELECT p.name AS label, p.weight AS weight, s.value AS value, s.comment AS comment " +
        "FROM scores s JOIN parameters p ON p.id = s.parameter_id " +
        "WHERE s.deck_id = ? AND s.evaluator_kind = 'ai' ORDER BY p.sort_order",
    )
      .bind(id)
      .all<{ label: string; weight: number; value: number; comment: string | null }>()
  ).results;

  const evaluation = await c.env.DB.prepare(
    "SELECT weighted_total, verdict FROM evaluations WHERE deck_id = ? AND evaluator_id IS NULL",
  )
    .bind(id)
    .first<{ weighted_total: number | null; verdict: string | null }>();

  return c.json({
    deck: toDeckView(edition, row, role),
    extraction,
    scores,
    weightedTotal: evaluation?.weighted_total ?? row.ai_score ?? undefined,
    verdict: evaluation?.verdict ? VERDICT_LABELS[evaluation.verdict] ?? evaluation.verdict : undefined,
  });
});

interface DeckMeta {
  name?: string;
  sector?: string;
  stage?: string;
  city?: string;
  program?: string;
  cohort?: string;
}

async function storeDeck(
  c: Context<AppEnv>,
  file: File,
  meta: DeckMeta,
): Promise<string> {
  const id = `deck_${crypto.randomUUID()}`;
  const key = `decks/${id}.pdf`;
  await c.env.DECKS.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: "application/pdf" },
  });
  await c.env.DB.prepare(
    "INSERT INTO decks (id, edition, name, sector, stage, city, program, cohort, status, r2_key, uploaded_by, complete) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_ai', ?, ?, 1)",
  )
    .bind(
      id,
      c.var.user.edition,
      meta.name || file.name.replace(/\.pdf$/i, "") || "Untitled deck",
      meta.sector ?? null,
      meta.stage ?? null,
      meta.city ?? null,
      meta.program ?? null,
      meta.cohort ?? null,
      key,
      c.var.user.id,
    )
    .run();
  return id;
}

// Anthropic caps a Messages request at 32 MB; the PDF is base64-encoded (~1.33×)
// into one request, so keep the raw deck comfortably under that.
const MAX_PDF_BYTES = 24 * 1024 * 1024;

function isPdf(file: unknown): file is File {
  return (
    file instanceof File &&
    (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))
  );
}

/** POST /api/decks/upload — single deck → R2 → evaluate directly (synchronous). */
decks.post("/upload", async (c) => {
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!isPdf(file)) return c.json({ error: "pdf_required" }, 400);
  if (file.size > MAX_PDF_BYTES) return c.json({ error: "pdf_too_large" }, 413);

  const meta: DeckMeta = {
    name: (form?.get("name") as string) || undefined,
    sector: (form?.get("sector") as string) || undefined,
    stage: (form?.get("stage") as string) || undefined,
    city: (form?.get("city") as string) || undefined,
    program: (form?.get("program") as string) || undefined,
    cohort: (form?.get("cohort") as string) || undefined,
  };
  const id = await storeDeck(c, file, meta);

  try {
    const result = await evaluateDeck(c.env, id);
    return c.json({ deckId: id, evaluated: true, result });
  } catch (err) {
    console.error(`single-upload evaluation failed for ${id}:`, err);
    return c.json({ deckId: id, evaluated: false, error: "evaluation_pending" }, 202);
  }
});

/** POST /api/decks/bulk — many decks → R2 → enqueue one eval job each. */
decks.post("/bulk", async (c) => {
  const form = await c.req.formData().catch(() => null);
  const files = (form?.getAll("files") ?? []).filter(isPdf);
  if (files.length === 0) return c.json({ error: "pdf_required" }, 400);
  if (files.some((f) => f.size > MAX_PDF_BYTES)) return c.json({ error: "pdf_too_large" }, 413);

  const deckIds: string[] = [];
  for (const file of files) {
    const id = await storeDeck(c, file, { name: file.name.replace(/\.pdf$/i, "") });
    await c.env.EVAL_QUEUE.send({ deckId: id });
    deckIds.push(id);
  }
  return c.json({ count: deckIds.length, deckIds });
});

export default decks;
