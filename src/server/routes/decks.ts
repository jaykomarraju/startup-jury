// Deck routes: list + detail (Review-decks + Evaluation-report data), single
// upload (R2 → direct AI evaluation), and bulk upload (R2 → Queue). Uploads are
// PDF-only; each deck's PDF lives at `decks/<id>.pdf` in the DECKS bucket.

import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../types";
import type { Edition, Role } from "../../shared/roles";
import { getStage, allowedTransitions } from "../../pipeline";
import { requireAuth, requireRole } from "../auth/middleware";
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

/** GET /api/decks — decks in the caller's edition (Review-decks table),
 *  optionally filtered by `programId` / `cohortId` (toolbar filter dropdowns).
 *  Founders are isolated to their own submissions (portal scope). */
decks.get("/", async (c) => {
  const { id, edition, role } = c.var.user;
  const programId = c.req.query("programId");
  const cohortId = c.req.query("cohortId");

  const clauses = ["d.edition = ?"];
  const params: unknown[] = [edition];
  if (role === "founder") {
    clauses.push("d.uploaded_by = ?");
    params.push(id);
  }
  if (programId) {
    clauses.push("d.program_id = ?");
    params.push(programId);
  }
  if (cohortId) {
    clauses.push("d.cohort_id = ?");
    params.push(cohortId);
  }

  const sql =
    "SELECT d.id, d.name, d.sector, d.stage, d.city, d.founder, d.ai_score, d.signal, d.status, " +
    "d.assigned_to, u.name AS assigned_to_name " +
    "FROM decks d LEFT JOIN users u ON u.id = d.assigned_to WHERE " +
    clauses.join(" AND ") +
    " ORDER BY d.created_at DESC";
  const rows = (await c.env.DB.prepare(sql).bind(...params).all<DeckRow>()).results;
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
      "SELECT p.key AS key, p.name AS label, p.weight AS weight, s.value AS value, s.comment AS comment " +
        "FROM scores s JOIN parameters p ON p.id = s.parameter_id " +
        "WHERE s.deck_id = ? AND s.evaluator_kind = 'ai' ORDER BY p.sort_order",
    )
      .bind(id)
      .all<{ key: string; label: string; weight: number; value: number; comment: string | null }>()
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

/** GET /api/decks/:id/file — stream the deck's PDF from R2 (in-app viewer).
 *  Edition-scoped like the report; founders may only stream their own uploads. */
decks.get("/:id/file", async (c) => {
  const { id: userId, edition, role } = c.var.user;
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(
    "SELECT r2_key, uploaded_by FROM decks WHERE id = ? AND edition = ?",
  )
    .bind(id, edition)
    .first<{ r2_key: string | null; uploaded_by: string | null }>();
  if (!row) return c.json({ error: "not_found" }, 404);
  if (role === "founder" && row.uploaded_by !== userId) return c.json({ error: "not_found" }, 404);
  // No stored PDF yet (seed decks / still pending) — the viewer shows its
  // graceful "not stored" state on a 404.
  if (!row.r2_key) return c.json({ error: "no_pdf" }, 404);

  const object = await c.env.DECKS.get(row.r2_key);
  if (!object) return c.json({ error: "no_pdf" }, 404);

  const headers = new Headers();
  headers.set("content-type", "application/pdf");
  headers.set("content-disposition", `inline; filename="deck-${id}.pdf"`);
  headers.set("cache-control", "private, max-age=300");
  headers.set("etag", object.httpEtag);
  headers.set("content-length", String(object.size));
  return new Response(object.body, { headers });
});

// Team roles that may trigger an AI re-score. Founders are excluded; the guard
// blocks a needless re-run regardless of who asks.
const RESCORE_ROLES = [
  "jury",
  "program_associate",
  "program_manager",
  "admin",
  "analyst",
  "associate",
  "partner",
] as const;

/**
 * POST /api/decks/:id/rescore — re-run the AI evaluation, but only when it would
 * produce something new. The AI is nondeterministic, so we refuse to re-score a
 * deck whose CONTENT and scoring CRITERIA are both unchanged since the last AI
 * run (→ 409 already_scored). A criteria change (admin edits weights / prompt /
 * additional params → org_settings.criteria_version bumps) or a content change
 * (a new PDF version → decks.content_version bumps) unblocks it.
 */
decks.post("/:id/rescore", requireRole(...RESCORE_ROLES), async (c) => {
  const { edition } = c.var.user;
  const id = c.req.param("id");
  const deck = await c.env.DB.prepare(
    "SELECT id, r2_key, content_version FROM decks WHERE id = ? AND edition = ?",
  )
    .bind(id, edition)
    .first<{ id: string; r2_key: string | null; content_version: number | null }>();
  if (!deck) return c.json({ error: "not_found" }, 404);

  const priorEval = await c.env.DB.prepare(
    "SELECT scored_criteria_version, scored_content_version FROM evaluations WHERE deck_id = ? AND evaluator_id IS NULL",
  )
    .bind(id)
    .first<{ scored_criteria_version: number | null; scored_content_version: number | null }>();
  const org = await c.env.DB.prepare("SELECT criteria_version FROM org_settings WHERE edition = ?")
    .bind(edition)
    .first<{ criteria_version: number | null }>();
  const currentCriteria = org?.criteria_version ?? 1;
  const currentContent = deck.content_version ?? 1;

  // Guard first, on metadata alone (no R2 read): an existing AI evaluation whose
  // criteria + content versions still match is blocked — nothing changed.
  if (
    priorEval &&
    priorEval.scored_criteria_version === currentCriteria &&
    priorEval.scored_content_version === currentContent
  ) {
    return c.json({ error: "already_scored" }, 409);
  }

  // Something changed (or it was never scored) → we must actually re-run, which
  // needs a stored PDF.
  if (!deck.r2_key) return c.json({ error: "no_pdf" }, 409);

  try {
    const result = await evaluateDeck(c.env, id);
    return c.json({ ok: true, rescored: true, result });
  } catch (err) {
    console.error(`rescore failed for ${id}:`, err);
    return c.json({ error: "evaluation_failed" }, 502);
  }
});

interface DeckMeta {
  name?: string;
  sector?: string;
  stage?: string;
  city?: string;
  programId?: string;
  cohortId?: string;
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
    "INSERT INTO decks (id, edition, name, sector, stage, city, program_id, cohort_id, status, r2_key, uploaded_by, complete) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_ai', ?, ?, 1)",
  )
    .bind(
      id,
      c.var.user.edition,
      meta.name || file.name.replace(/\.pdf$/i, "") || "Untitled deck",
      meta.sector ?? null,
      meta.stage ?? null,
      meta.city ?? null,
      meta.programId ?? null,
      meta.cohortId ?? null,
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

/**
 * Atomically reserve `n` upload credits from the caller's edition. The
 * conditional UPDATE only succeeds when the balance covers `n`, so concurrent
 * uploads can't drive it negative. Returns false when there aren't enough
 * credits (→ 402, before any R2 write). Admins top the balance up in Config.
 */
async function reserveCredits(c: Context<AppEnv>, n: number): Promise<boolean> {
  const res = await c.env.DB.prepare(
    "UPDATE org_settings SET credits_balance = credits_balance - ? WHERE edition = ? AND credits_balance >= ?",
  )
    .bind(n, c.var.user.edition, n)
    .run();
  return res.meta.changes === 1;
}

/** Return `n` reserved credits — used to compensate when a store fails after the
 *  reservation, so a transient R2/DB error never silently burns credits. */
async function refundCredits(c: Context<AppEnv>, n: number): Promise<void> {
  if (n <= 0) return;
  await c.env.DB.prepare("UPDATE org_settings SET credits_balance = credits_balance + ? WHERE edition = ?")
    .bind(n, c.var.user.edition)
    .run();
}

/** POST /api/decks/upload — single deck → R2 → evaluate directly (synchronous). */
decks.post("/upload", async (c) => {
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!isPdf(file)) return c.json({ error: "pdf_required" }, 400);
  if (file.size > MAX_PDF_BYTES) return c.json({ error: "pdf_too_large" }, 413);

  // One upload = one credit; reserve before storing so an empty balance blocks.
  if (!(await reserveCredits(c, 1))) return c.json({ error: "no_credits" }, 402);

  const meta: DeckMeta = {
    name: (form?.get("name") as string) || undefined,
    sector: (form?.get("sector") as string) || undefined,
    stage: (form?.get("stage") as string) || undefined,
    city: (form?.get("city") as string) || undefined,
    programId: (form?.get("programId") as string) || undefined,
    cohortId: (form?.get("cohortId") as string) || undefined,
  };
  let id: string;
  try {
    id = await storeDeck(c, file, meta);
  } catch (err) {
    // Store failed after the credit was reserved — give it back, then surface.
    await refundCredits(c, 1);
    throw err;
  }

  try {
    const result = await evaluateDeck(c.env, id);
    return c.json({ deckId: id, evaluated: true, result });
  } catch (err) {
    // A synchronous model/billing error must not strand the deck at pending_ai
    // with nothing re-driving it (§9). Hand it to the retrying queue consumer so
    // it still gets scored once the condition clears, then report pending.
    console.error(`single-upload evaluation failed for ${id}; enqueueing retry:`, err);
    try {
      await c.env.EVAL_QUEUE.send({ deckId: id });
    } catch (qerr) {
      console.error(`failed to enqueue retry for ${id}:`, qerr);
    }
    return c.json({ deckId: id, evaluated: false, error: "evaluation_pending" }, 202);
  }
});

/** POST /api/decks/bulk — many decks → R2 → enqueue one eval job each. */
decks.post("/bulk", async (c) => {
  const form = await c.req.formData().catch(() => null);
  const files = (form?.getAll("files") ?? []).filter(isPdf);
  if (files.length === 0) return c.json({ error: "pdf_required" }, 400);
  if (files.some((f) => f.size > MAX_PDF_BYTES)) return c.json({ error: "pdf_too_large" }, 413);

  // Reserve one credit per file up front — all-or-nothing, so a partial batch
  // never uploads on an insufficient balance.
  if (!(await reserveCredits(c, files.length))) return c.json({ error: "no_credits" }, 402);

  const deckIds: string[] = [];
  try {
    for (const file of files) {
      const id = await storeDeck(c, file, { name: file.name.replace(/\.pdf$/i, "") });
      await c.env.EVAL_QUEUE.send({ deckId: id });
      deckIds.push(id);
    }
  } catch (err) {
    // Refund the credits reserved for files we didn't get to store/enqueue, so a
    // mid-batch failure only charges for the decks that actually landed.
    await refundCredits(c, files.length - deckIds.length);
    throw err;
  }
  return c.json({ count: deckIds.length, deckIds });
});

export default decks;
