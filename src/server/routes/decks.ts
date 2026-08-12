// Deck routes: list + detail (Review-decks + Evaluation-report data), single
// upload (R2 → direct AI evaluation), and bulk upload (R2 → Queue). Uploads are
// PDF-only; each deck's PDF lives at `decks/<id>.pdf` in the DECKS bucket.

import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../types";
import type { Edition, Role } from "../../shared/roles";
import { getStage, allowedTransitions } from "../../pipeline";
import { decisionScore } from "../../shared/scoring";
import { parseMissingFields, type IntakeMatch } from "../../shared/intake";
import { requireAuth, requireRole } from "../auth/middleware";
import { detectIntakeFlags, intakeFlagStatement } from "../intake";
import { evaluateDeck } from "../ai/evaluate";
import {
  classifyEvalError,
  clearEvalFailure,
  markEvalTerminal,
  recordEvalFailure,
  summariseError,
} from "../ai/health";
import {
  addDeckVersion,
  isPdf,
  versionKey,
  versionStatement,
  MAX_PDF_BYTES,
  reserveCredits as reserveEditionCredits,
  refundCredits as refundEditionCredits,
} from "../decks/versions";

const decks = new Hono<AppEnv>();
decks.use("*", requireAuth);

// The deck columns every view selects. Kept in one place because the list, the
// detail report and the version endpoints all need the Session-5 intake columns.
const DECK_COLUMNS =
  "d.id, d.name, d.sector, d.stage, d.city, d.founder, d.founder_email, d.founder_phone, " +
  "d.missing_fields, d.intake_flag, d.intake_flag_note, d.related_deck_id, d.content_version, " +
  "d.ai_score, d.signal, d.status, d.assigned_to, d.ai_error, d.ai_attempts, d.ai_failed_at";

// Joined columns: the assignee's name, the program's shortlist floor, and the mean
// of this deck's human evaluations (the other half of the decision score).
const DECK_JOINS =
  "LEFT JOIN users u ON u.id = d.assigned_to " +
  "LEFT JOIN programs pr ON pr.id = d.program_id";
const DECK_DERIVED =
  "u.name AS assigned_to_name, pr.shortlist_min AS shortlist_min, " +
  "(SELECT AVG(e.weighted_total) FROM evaluations e WHERE e.deck_id = d.id AND e.evaluator_id IS NOT NULL) AS human_avg";

interface DeckRow {
  id: string;
  name: string;
  sector: string | null;
  stage: string | null;
  city: string | null;
  founder: string | null;
  founder_email: string | null;
  founder_phone: string | null;
  missing_fields: string | null;
  intake_flag: string | null;
  intake_flag_note: string | null;
  related_deck_id: string | null;
  content_version: number | null;
  ai_score: number | null;
  signal: string | null;
  status: string;
  ai_error: string | null;
  ai_attempts: number | null;
  ai_failed_at: string | null;
  assigned_to?: string | null;
  assigned_to_name?: string | null;
  shortlist_min?: number | null;
  human_avg?: number | null;
}

export type AiState = "ok" | "in_progress" | "retrying" | "failed";

/** Where a deck actually is in the AI pipeline, as opposed to what it says. */
function aiStateOf(row: DeckRow): AiState {
  if (row.status !== "pending_ai") return "ok";
  if (row.ai_failed_at) return "failed";
  return row.ai_error ? "retrying" : "in_progress";
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
  const missingFields = parseMissingFields(row.missing_fields);
  // The number a shortlist decision is judged on — the composite form of the
  // workbench's AI · My · Average column (see shared/scoring.ts decisionScore).
  const decision = decisionScore(
    row.ai_score,
    typeof row.human_avg === "number" ? [row.human_avg] : [],
  );
  const shortlistMin = row.shortlist_min ?? null;
  return {
    id: row.id,
    name: row.name,
    sector: row.sector ?? undefined,
    stage: row.stage ?? undefined,
    city: row.city ?? undefined,
    founder: row.founder ?? undefined,
    founderEmail: row.founder_email ?? undefined,
    founderPhone: row.founder_phone ?? undefined,
    missingFields,
    intakeFlag: (row.intake_flag as "duplicate" | "returning" | null) ?? undefined,
    intakeNote: row.intake_flag_note ?? undefined,
    relatedDeckId: row.related_deck_id ?? undefined,
    contentVersion: row.content_version ?? 1,
    aiScore: row.ai_score ?? undefined,
    decisionScore: decision ?? undefined,
    shortlistMin: shortlistMin ?? undefined,
    // Pre-flagged for the UI so a juror sees the guardrail before clicking; the
    // server re-checks on the transition either way.
    shortlistBlocked: shortlistMin !== null && (decision === null || decision < shortlistMin),
    signal: (row.signal as string | null) ?? undefined,
    status: statusLabel(edition, row.status),
    statusId: row.status,
    // §9: "Pending AI" used to mean both "running" and "permanently stuck".
    // `aiState` is the difference, and `aiError` is the reason the old UI
    // hardcoded as "no AI key configured yet" regardless of what went wrong.
    aiState: aiStateOf(row),
    aiError: classifyEvalError(row.ai_error) ?? undefined,
    aiErrorDetail: row.ai_error ?? undefined,
    aiAttempts: row.ai_attempts ?? 0,
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
    `SELECT ${DECK_COLUMNS}, ${DECK_DERIVED} FROM decks d ${DECK_JOINS} WHERE ` +
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
    `SELECT ${DECK_COLUMNS}, d.uploaded_by, ${DECK_DERIVED} FROM decks d ${DECK_JOINS} ` +
      "WHERE d.id = ? AND d.edition = ?",
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
    versions: await loadVersions(c, id),
    weightedTotal: evaluation?.weighted_total ?? row.ai_score ?? undefined,
    verdict: evaluation?.verdict ? VERDICT_LABELS[evaluation.verdict] ?? evaluation.verdict : undefined,
  });
});

// ── Deck versioning (Session 5) ──────────────────────────────────────────────

interface VersionRow {
  id: string;
  version: number;
  file_name: string | null;
  size_bytes: number | null;
  note: string | null;
  created_at: string;
  uploaded_by_name: string | null;
}

async function loadVersions(c: Context<AppEnv>, deckId: string) {
  const rows = (
    await c.env.DB.prepare(
      "SELECT v.id, v.version, v.file_name, v.size_bytes, v.note, v.created_at, u.name AS uploaded_by_name " +
        "FROM deck_versions v LEFT JOIN users u ON u.id = v.uploaded_by " +
        "WHERE v.deck_id = ? ORDER BY v.version DESC",
    )
      .bind(deckId)
      .all<VersionRow>()
  ).results;
  return rows.map((v) => ({
    id: v.id,
    version: v.version,
    fileName: v.file_name ?? undefined,
    sizeBytes: v.size_bytes ?? undefined,
    note: v.note ?? undefined,
    uploadedByName: v.uploaded_by_name ?? undefined,
    createdAt: v.created_at,
  }));
}

/** GET /api/decks/:id/versions — the deck's upload history (newest first). */
decks.get("/:id/versions", async (c) => {
  const { id: userId, edition, role } = c.var.user;
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(
    "SELECT id, uploaded_by FROM decks WHERE id = ? AND edition = ?",
  )
    .bind(id, edition)
    .first<{ id: string; uploaded_by: string | null }>();
  if (!row) return c.json({ error: "not_found" }, 404);
  if (role === "founder" && row.uploaded_by !== userId) return c.json({ error: "not_found" }, 404);
  return c.json({ versions: await loadVersions(c, id) });
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
 * Roles that may re-drive a stranded evaluation. Narrower than `RESCORE_ROLES`:
 * a re-drive can RESERVE a credit (the terminal failure gave one back), so it
 * belongs to the roles that own intake and the credit budget — not to a juror
 * who just happens to notice a stuck deck.
 */
const RETRY_AI_ROLES = [
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
  founder?: string;
  founderEmail?: string;
  founderPhone?: string;
  programId?: string;
  cohortId?: string;
}

/** Read the deck metadata (and the Session-5 founder/contact columns) off an
 *  upload form. Blank strings collapse to undefined so they never overwrite an
 *  AI-extracted value with "". */
function metaFromForm(form: FormData | null): DeckMeta {
  const s = (k: string) => ((form?.get(k) as string) || "").trim() || undefined;
  return {
    name: s("name"),
    sector: s("sector"),
    stage: s("stage"),
    city: s("city"),
    founder: s("founder"),
    founderEmail: s("founderEmail"),
    founderPhone: s("founderPhone"),
    programId: s("programId"),
    cohortId: s("cohortId"),
  };
}

async function storeDeck(
  c: Context<AppEnv>,
  file: File,
  meta: DeckMeta,
): Promise<string> {
  const id = `deck_${crypto.randomUUID()}`;
  const key = versionKey(id, 1);
  await c.env.DECKS.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: "application/pdf" },
  });
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO decks (id, edition, name, sector, stage, city, founder, founder_email, founder_phone, " +
        "program_id, cohort_id, status, r2_key, uploaded_by, complete) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_ai', ?, ?, 1)",
    ).bind(
      id,
      c.var.user.edition,
      meta.name || file.name.replace(/\.pdf$/i, "") || "Untitled deck",
      meta.sector ?? null,
      meta.stage ?? null,
      meta.city ?? null,
      meta.founder ?? null,
      meta.founderEmail ?? null,
      meta.founderPhone ?? null,
      meta.programId ?? null,
      meta.cohortId ?? null,
      key,
      c.var.user.id,
    ),
    // Version 1 of the deck's upload history — a re-upload appends to this.
    versionStatement(c.env, {
      deckId: id,
      version: 1,
      key,
      file,
      note: "Initial upload",
      uploadedBy: c.var.user.id,
    }),
  ]);
  return id;
}

/**
 * Run the soft duplicate / returning-company check for a freshly stored deck and
 * record it. Deliberately runs BEFORE the AI call: every evaluation costs a
 * credit, so the point of the duplicate alert is to warn while it's still cheap
 * (§8). `evaluateDeck` re-runs it afterwards with the extracted founder details,
 * which is what catches duplicates in a bulk upload (filenames only up front).
 */
async function flagIntake(
  c: Context<AppEnv>,
  deckId: string,
  meta: DeckMeta,
  name: string,
): Promise<IntakeMatch[]> {
  const classification = await detectIntakeFlags(c.env, c.var.user.edition, {
    name,
    founder: meta.founder,
    founderEmail: meta.founderEmail,
    founderPhone: meta.founderPhone,
    city: meta.city,
    sector: meta.sector,
    fundingStage: meta.stage,
    cohortId: meta.cohortId,
    selfId: deckId,
  });
  if (classification.flag) {
    await intakeFlagStatement(c.env, deckId, classification).run();
  }
  return classification.matches;
}

// Credit accounting lives in `decks/versions.ts` (shared with the public founder
// resubmit route); these wrappers just bind it to the caller's edition.
const reserveCredits = (c: Context<AppEnv>, n: number) =>
  reserveEditionCredits(c.env, c.var.user.edition, n);
const refundCredits = (c: Context<AppEnv>, n: number) =>
  refundEditionCredits(c.env, c.var.user.edition, n);

/** POST /api/decks/upload — single deck → R2 → evaluate directly (synchronous). */
decks.post("/upload", async (c) => {
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!isPdf(file)) return c.json({ error: "pdf_required" }, 400);
  if (file.size > MAX_PDF_BYTES) return c.json({ error: "pdf_too_large" }, 413);

  // One upload = one credit; reserve before storing so an empty balance blocks.
  if (!(await reserveCredits(c, 1))) return c.json({ error: "no_credits" }, 402);

  const meta = metaFromForm(form);
  let id: string;
  try {
    id = await storeDeck(c, file, meta);
  } catch (err) {
    // Store failed after the credit was reserved — give it back, then surface.
    await refundCredits(c, 1);
    throw err;
  }

  // Soft duplicate / returning check while it's still cheap (before the AI run).
  const matches = await flagIntake(c, id, meta, meta.name || file.name.replace(/\.pdf$/i, ""));

  try {
    const result = await evaluateDeck(c.env, id);
    return c.json({
      deckId: id,
      evaluated: true,
      result,
      // The post-extraction re-check supersedes the pre-AI one when it found more.
      matches: result.intakeFlag ? undefined : matches,
    });
  } catch (err) {
    // A synchronous model/billing error must not strand the deck at pending_ai
    // with nothing re-driving it (§9). Record WHY, then hand it to the retrying
    // queue consumer so it still gets scored once the condition clears.
    console.error(`single-upload evaluation failed for ${id}; enqueueing retry:`, err);
    await recordEvalFailure(c.env, id, err);
    try {
      await c.env.EVAL_QUEUE.send({ deckId: id });
    } catch (qerr) {
      // Nothing can re-drive it now except the cron sweep, and the queue itself
      // is broken — so give up here, refund, and say so, rather than reporting a
      // "pending" that will never resolve.
      console.error(`failed to enqueue retry for ${id}:`, qerr);
      await markEvalTerminal(c.env, id, summariseError(err));
      return c.json(
        {
          deckId: id,
          evaluated: false,
          error: "evaluation_failed",
          reason: classifyEvalError(summariseError(err)),
          matches,
        },
        202,
      );
    }
    return c.json(
      {
        deckId: id,
        evaluated: false,
        error: "evaluation_pending",
        // The real cause, so the upload screen can stop guessing "no AI key".
        reason: classifyEvalError(summariseError(err)),
        matches,
      },
      202,
    );
  }
});

/**
 * POST /api/decks/:id/retry-ai — manual re-drive for a deck stuck (or failed) at
 * `pending_ai`. The §9 lever an operator reaches for once the underlying cause
 * (billing, a key, a rate limit) is fixed: it clears the failure state, resets
 * the attempt counter and re-enqueues.
 *
 * No credit is charged — the original upload already paid for this evaluation,
 * and if it was refunded on a terminal failure the re-drive re-reserves it.
 */
decks.post("/:id/retry-ai", requireRole(...RETRY_AI_ROLES), async (c) => {
  const user = c.var.user;
  const deck = await c.env.DB.prepare(
    "SELECT id, status, ai_credit_refunded FROM decks WHERE id = ? AND edition = ?",
  )
    .bind(c.req.param("id"), user.edition)
    .first<{ id: string; status: string; ai_credit_refunded: number }>();
  if (!deck) return c.json({ error: "not_found" }, 404);
  if (deck.status !== "pending_ai") return c.json({ error: "not_pending" }, 409);

  // A terminal failure gave the credit back; re-driving spends it again. If the
  // balance is empty the deck stays exactly as it was.
  if (deck.ai_credit_refunded === 1) {
    if (!(await reserveCredits(c, 1))) return c.json({ error: "no_credits" }, 402);
    await c.env.DB.prepare("UPDATE decks SET ai_credit_refunded = 0 WHERE id = ?").bind(deck.id).run();
  }

  await clearEvalFailure(c.env, deck.id);
  try {
    await c.env.EVAL_QUEUE.send({ deckId: deck.id });
  } catch (err) {
    await recordEvalFailure(c.env, deck.id, err);
    return c.json({ error: "enqueue_failed" }, 502);
  }
  return c.json({ ok: true, deckId: deck.id, queued: true });
});

/** One row of the bulk-upload report — accepted or rejected, per file. */
interface BulkRow {
  file: string;
  ok: boolean;
  deckId?: string;
  error?: "pdf_required" | "pdf_too_large" | "store_failed";
  /** Soft duplicate / returning alert raised at intake (never a rejection). */
  flag?: "duplicate" | "returning";
  note?: string;
}

/**
 * POST /api/decks/bulk — many decks → R2 → enqueue one eval job each.
 *
 * Per-file validation: a non-PDF or oversized file is **reported, not fatal** —
 * the valid decks still upload and the caller gets a per-row error to show
 * (§8 "surface per-row errors"). Credits are reserved for the accepted files
 * only, all-or-nothing, so a partial batch never uploads on a short balance.
 */
decks.post("/bulk", async (c) => {
  const form = await c.req.formData().catch(() => null);
  const entries = form?.getAll("files") ?? [];

  const rows: BulkRow[] = [];
  const accepted: File[] = [];
  for (const entry of entries) {
    const label = entry instanceof File ? entry.name : "unnamed";
    if (!isPdf(entry)) {
      rows.push({ file: label, ok: false, error: "pdf_required" });
    } else if (entry.size > MAX_PDF_BYTES) {
      rows.push({ file: label, ok: false, error: "pdf_too_large" });
    } else {
      accepted.push(entry);
    }
  }
  if (accepted.length === 0) {
    return c.json({ error: "pdf_required", count: 0, deckIds: [], results: rows }, 400);
  }

  if (!(await reserveCredits(c, accepted.length))) {
    return c.json({ error: "no_credits" }, 402);
  }

  const deckIds: string[] = [];
  try {
    for (const file of accepted) {
      const name = file.name.replace(/\.pdf$/i, "");
      const id = await storeDeck(c, file, { name });
      await c.env.EVAL_QUEUE.send({ deckId: id });
      deckIds.push(id);
      // Filename-only match up front (cost-driven); evaluateDeck re-checks with
      // the extracted founder details once the queue consumer scores the deck.
      const matches = await flagIntake(c, id, { name }, name);
      rows.push({
        file: file.name,
        ok: true,
        deckId: id,
        flag: matches[0]?.flag,
        note: matches[0]?.reason,
      });
    }
  } catch (err) {
    // Refund the credits reserved for files we didn't get to store/enqueue, so a
    // mid-batch failure only charges for the decks that actually landed.
    await refundCredits(c, accepted.length - deckIds.length);
    throw err;
  }
  return c.json({ count: deckIds.length, deckIds, results: rows });
});

// ── Deck re-upload (new version) ─────────────────────────────────────────────

// Who may replace a deck's PDF: the intake/evaluation staff, plus the founder who
// submitted it (the Session-6 resubmit loop lands the founder here via a
// tokenized link). Jury/IC evaluate, they don't re-submit decks.
const REUPLOAD_ROLES = [
  "founder",
  "program_associate",
  "program_manager",
  "admin",
  "analyst",
  "associate",
] as const;

/**
 * POST /api/decks/:id/version — re-upload a deck as a NEW version.
 *
 * The deck row is kept (so its pipeline history, queries and assignments survive);
 * the new PDF is stored beside the old one, appended to `deck_versions`, and
 * `content_version` is bumped — which is exactly the signal the AI rescore guard
 * (Session 1) waits for, so the deck is re-scored automatically. This is the
 * mechanism Session 6's incomplete-resubmit loop drives.
 */
decks.post("/:id/version", requireRole(...REUPLOAD_ROLES), async (c) => {
  const { id: userId, edition, role } = c.var.user;
  const id = c.req.param("id");

  const deck = await c.env.DB.prepare(
    "SELECT id, uploaded_by, content_version FROM decks WHERE id = ? AND edition = ?",
  )
    .bind(id, edition)
    .first<{ id: string; uploaded_by: string | null; content_version: number | null }>();
  if (!deck) return c.json({ error: "not_found" }, 404);
  // A founder may only replace their own submission.
  if (role === "founder" && deck.uploaded_by !== userId) return c.json({ error: "not_found" }, 404);

  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!isPdf(file)) return c.json({ error: "pdf_required" }, 400);
  if (file.size > MAX_PDF_BYTES) return c.json({ error: "pdf_too_large" }, 413);
  const note = ((form?.get("note") as string) || "").trim() || "Re-uploaded deck";

  // Shared with the public tokenized founder resubmit (`routes/resubmit.ts`), so
  // both paths spend credits, lay out R2 and bump content_version identically.
  const added = await addDeckVersion(c.env, {
    deckId: id,
    edition,
    contentVersion: deck.content_version,
    file,
    note,
    uploadedBy: userId,
  });
  if (!added.ok) return c.json({ error: "no_credits" }, 402);
  if (!added.evaluated) {
    return c.json(
      { ok: true, deckId: id, version: added.version, evaluated: false, error: "evaluation_pending" },
      202,
    );
  }
  return c.json({ ok: true, deckId: id, version: added.version, evaluated: true, result: added.result });
});

export default decks;
