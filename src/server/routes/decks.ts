// Deck routes: list + detail (Review-decks + Evaluation-report data), single
// upload (R2 → direct AI evaluation), and bulk upload (R2 → Queue). Uploads are
// PDF-only; each deck's PDF lives at `decks/<id>.pdf` in the DECKS bucket.

import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../types";
import type { Edition, Role } from "../../shared/roles";
import { canSeeEvaluatorScores, evaluationRank, roleLabel } from "../../shared/roles";
import { getStage, allowedTransitions } from "../../pipeline";
import { decisionScore } from "../../shared/scoring";
import { missingIntakeFields, parseMissingFields, type IntakeMatch } from "../../shared/intake";
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
  "d.ai_score, d.signal, d.status, d.assigned_to, d.ai_error, d.ai_attempts, d.ai_failed_at, " +
  "d.tags, d.created_at";

// Joined columns: the assignee's name, the program's shortlist floor, and the mean
// of this deck's human evaluations (the other half of the decision score).
const DECK_JOINS =
  "LEFT JOIN users u ON u.id = d.assigned_to " +
  "LEFT JOIN programs pr ON pr.id = d.program_id " +
  "LEFT JOIN cohorts co ON co.id = d.cohort_id " +
  // Aug-2026 issues 29/30 — sign-up + curation state for the pipeline screens.
  "LEFT JOIN deck_onboarding ob ON ob.deck_id = d.id " +
  "LEFT JOIN users lead ON lead.id = ob.lead_user_id";
const DECK_DERIVED =
  "u.name AS assigned_to_name, pr.shortlist_min AS shortlist_min, " +
  "pr.name AS program_name, co.name AS cohort_name, " +
  "(SELECT AVG(e.weighted_total) FROM evaluations e WHERE e.deck_id = d.id AND e.evaluator_id IS NOT NULL) AS human_avg, " +
  // Aug-2026 issues 16/17 — the Query screen's "Parameters needing response" /
  // "Areas requiring response". Core areas the AI scored below the workspace's
  // own "mediocre" threshold, plus the deck sections the extraction found
  // absent. No extra binds: the threshold is read from org_settings inline.
  "(SELECT GROUP_CONCAT(p.name, '||') FROM scores s JOIN parameters p ON p.id = s.parameter_id " +
  "  WHERE s.deck_id = d.id AND s.evaluator_kind = 'ai' AND p.informational = 0 " +
  "    AND s.value < (SELECT o.threshold_mediocre FROM org_settings o WHERE o.edition = d.edition)) AS weak_areas, " +
  "(SELECT GROUP_CONCAT(e.label, '||') FROM deck_extractions e WHERE e.deck_id = d.id AND e.missing = 1) AS missing_sections, " +
  // Aug-2026 issue 25 — the Jury Pipeline's "Assigned date" and whether the
  // assignee has actually submitted their evaluation yet.
  "(SELECT MAX(pe.created_at) FROM pipeline_events pe WHERE pe.deck_id = d.id AND pe.action = 'assign_jury') AS assigned_at, " +
  "(SELECT COUNT(*) FROM evaluations ev WHERE ev.deck_id = d.id AND ev.evaluator_id IS NOT NULL AND ev.evaluator_id = d.assigned_to) AS assignee_submitted, " +
  // Issue 27/29 — the intro call's schedule + status.
  "(SELECT ca.scheduled_at FROM calls ca WHERE ca.deck_id = d.id AND ca.status != 'cancelled' ORDER BY ca.scheduled_at DESC LIMIT 1) AS call_at, " +
  "(SELECT ca.status FROM calls ca WHERE ca.deck_id = d.id AND ca.status != 'cancelled' ORDER BY ca.scheduled_at DESC LIMIT 1) AS call_status, " +
  // Issue 31 — how, when and by whom the startup left the active pipeline.
  "(SELECT pe.from_stage FROM pipeline_events pe WHERE pe.deck_id = d.id AND pe.to_stage IN ('rejected', 'archived') ORDER BY pe.created_at DESC, pe.rowid DESC LIMIT 1) AS exit_from, " +
  "(SELECT pe.action FROM pipeline_events pe WHERE pe.deck_id = d.id AND pe.to_stage IN ('rejected', 'archived') ORDER BY pe.created_at DESC, pe.rowid DESC LIMIT 1) AS exit_action, " +
  "(SELECT pe.note FROM pipeline_events pe WHERE pe.deck_id = d.id AND pe.to_stage IN ('rejected', 'archived') ORDER BY pe.created_at DESC, pe.rowid DESC LIMIT 1) AS exit_note, " +
  "(SELECT pe.created_at FROM pipeline_events pe WHERE pe.deck_id = d.id AND pe.to_stage IN ('rejected', 'archived') ORDER BY pe.created_at DESC, pe.rowid DESC LIMIT 1) AS exit_at, " +
  "(SELECT au.name FROM pipeline_events pe LEFT JOIN users au ON au.id = pe.actor_id WHERE pe.deck_id = d.id AND pe.to_stage IN ('rejected', 'archived') ORDER BY pe.created_at DESC, pe.rowid DESC LIMIT 1) AS exit_by, " +
  // Issues 29/30 — the onboarding row (may be absent = everything pending).
  "ob.payment_status AS payment_status, ob.documents_status AS documents_status, " +
  "ob.curation_stage AS curation_stage, ob.progress AS onboarding_progress, lead.name AS onboarding_lead";

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
  tags?: string | null;
  created_at?: string | null;
  assigned_to?: string | null;
  assigned_to_name?: string | null;
  program_name?: string | null;
  cohort_name?: string | null;
  shortlist_min?: number | null;
  human_avg?: number | null;
  weak_areas?: string | null;
  missing_sections?: string | null;
  assigned_at?: string | null;
  assignee_submitted?: number | null;
  call_at?: string | null;
  call_status?: string | null;
  exit_from?: string | null;
  exit_action?: string | null;
  exit_note?: string | null;
  exit_at?: string | null;
  exit_by?: string | null;
  payment_status?: string | null;
  documents_status?: string | null;
  curation_stage?: string | null;
  onboarding_progress?: number | null;
  onboarding_lead?: string | null;
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

/** Split a GROUP_CONCAT('||') column into a list, de-duped and in order. */
function splitList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split("||")) {
    const t = part.trim();
    if (t) seen.add(t);
  }
  return [...seen];
}

/** At most this many tags per deck, each at most this long. */
const MAX_TAGS = 12;
const MAX_TAG_LENGTH = 24;

/** `decks.tags` is a JSON array of strings; anything else reads as no tags. */
export function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t): t is string => typeof t === "string");
  } catch {
    return [];
  }
}

/** Normalise a submitted tag list: trimmed, lowercased, de-duped, bounded. */
export function normaliseTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const tag = raw.trim().replace(/\s+/g, " ").toLowerCase().slice(0, MAX_TAG_LENGTH);
    if (!tag || out.includes(tag)) continue;
    out.push(tag);
    if (out.length === MAX_TAGS) break;
  }
  return out;
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
    tags: parseTags(row.tags),
    weakAreas: splitList(row.weak_areas),
    missingSections: splitList(row.missing_sections),
    // Aug-2026 stage-screen columns (issues 25–31).
    juryScore: typeof row.human_avg === "number" ? row.human_avg : undefined,
    assignedAt: row.assigned_at ?? undefined,
    assigneeSubmitted: (row.assignee_submitted ?? 0) > 0,
    callScheduledAt: row.call_at ?? undefined,
    callStatus: row.call_status ?? undefined,
    exitFromLabel: row.exit_from ? statusLabel(edition, row.exit_from) : undefined,
    exitAction: row.exit_action ?? undefined,
    exitNote: row.exit_note ?? undefined,
    exitAt: row.exit_at ?? undefined,
    exitBy: row.exit_by ?? undefined,
    paymentStatus: row.payment_status ?? undefined,
    documentsStatus: row.documents_status ?? undefined,
    curationStage: row.curation_stage ?? undefined,
    onboardingProgress: row.onboarding_progress ?? undefined,
    onboardingLead: row.onboarding_lead ?? undefined,
    uploadedAt: row.created_at ?? undefined,
    assignedTo: row.assigned_to ?? undefined,
    assignedToName: row.assigned_to_name ?? undefined,
    programName: row.program_name ?? undefined,
    cohortName: row.cohort_name ?? undefined,
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
  // Aug-2026 issue 2 — deck search & tags. `q` matches the startup, founder,
  // sector or city; `tag` narrows to one tag.
  const q = (c.req.query("q") ?? "").trim();
  const tag = (c.req.query("tag") ?? "").trim().toLowerCase();

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
  if (q) {
    // LIKE with escaped wildcards — the term is user input, not a pattern. One
    // bound value per column: SQLite's numbered placeholders can't be mixed with
    // the positional `?`s the other clauses use.
    const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    const cols = ["d.name", "d.founder", "d.sector", "d.city", "d.founder_email"];
    clauses.push(`(${cols.map((col) => `${col} LIKE ? ESCAPE '\\'`).join(" OR ")})`);
    cols.forEach(() => params.push(like));
  }
  if (tag) {
    // Tags are stored as a lowercase JSON array, so a quoted substring match is
    // exact per element without needing json_each.
    clauses.push("d.tags LIKE ?");
    params.push(`%"${tag.replace(/[%_\\]/g, "")}"%`);
  }

  const sql =
    `SELECT ${DECK_COLUMNS}, ${DECK_DERIVED} FROM decks d ${DECK_JOINS} WHERE ` +
    clauses.join(" AND ") +
    " ORDER BY d.created_at DESC";
  const rows = (await c.env.DB.prepare(sql).bind(...params).all<DeckRow>()).results;
  return c.json({ decks: rows.map((r) => toDeckView(edition, r, role)) });
});

// ── Tags (Aug-2026 issue 2 — search & tag deck facility) ─────────────────────

/** Roles that may re-tag a deck: everyone on the internal team, not founders. */
function canTag(role: Role): boolean {
  return role !== "founder";
}

/** GET /api/decks/tags — every tag in use in the caller's edition, sorted. */
decks.get("/tags", async (c) => {
  const { edition } = c.var.user;
  const rows = (
    await c.env.DB.prepare(
      "SELECT tags FROM decks WHERE edition = ? AND tags IS NOT NULL AND tags != ''",
    )
      .bind(edition)
      .all<{ tags: string | null }>()
  ).results;
  const seen = new Set<string>();
  for (const r of rows) for (const t of parseTags(r.tags)) seen.add(t);
  return c.json({ tags: [...seen].sort() });
});

/** PUT /api/decks/:id/tags — replace a deck's tag list. Body: { tags: string[] }. */
decks.put("/:id/tags", async (c) => {
  const { edition, role } = c.var.user;
  if (!canTag(role)) return c.json({ error: "forbidden" }, 403);
  const id = c.req.param("id");
  const exists = await c.env.DB.prepare("SELECT id FROM decks WHERE id = ? AND edition = ?")
    .bind(id, edition)
    .first<{ id: string }>();
  if (!exists) return c.json({ error: "not_found" }, 404);

  const body = (await c.req.json().catch(() => ({}))) as { tags?: unknown };
  const tags = normaliseTags(body.tags);
  await c.env.DB.prepare("UPDATE decks SET tags = ? WHERE id = ? AND edition = ?")
    .bind(tags.length > 0 ? JSON.stringify(tags) : null, id, edition)
    .run();
  return c.json({ ok: true, tags });
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

// ── Sign-up / curation state (Aug-2026 issues 29 & 30) ───────────────────────

const PAYMENT_STATUSES = ["pending", "partial", "paid", "waived"];
const DOCUMENT_STATUSES = ["pending", "partial", "complete"];

/** Who may record sign-up / curation progress. */
const ONBOARDING_ROLES = ["program_associate", "program_manager", "admin", "partner"] as const;

/**
 * PUT /api/decks/:id/onboarding — record payment / documents / curation state.
 *
 * Issue 29 wants Payment status and Documents status on the Sign up Pipeline;
 * issue 30 wants Curation stage, a jury-member lead and Progress on Onboard
 * ready. One row per deck, created on first write.
 */
decks.put("/:id/onboarding", requireRole(...ONBOARDING_ROLES), async (c) => {
  const { edition, id: actorId } = c.var.user;
  const id = c.req.param("id");
  const deck = await c.env.DB.prepare("SELECT id FROM decks WHERE id = ? AND edition = ?")
    .bind(id, edition)
    .first<{ id: string }>();
  if (!deck) return c.json({ error: "not_found" }, 404);

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const existing = await c.env.DB.prepare(
    "SELECT payment_status, documents_status, curation_stage, progress, lead_user_id, notes " +
      "FROM deck_onboarding WHERE deck_id = ?",
  )
    .bind(id)
    .first<{
      payment_status: string;
      documents_status: string;
      curation_stage: string | null;
      progress: number;
      lead_user_id: string | null;
      notes: string | null;
    }>();

  const pick = (value: unknown, allowed: string[], fallback: string) =>
    typeof value === "string" && allowed.includes(value) ? value : fallback;
  const text = (value: unknown, fallback: string | null) =>
    typeof value === "string" ? (value.trim() || null) : fallback;

  const payment = pick(body.paymentStatus, PAYMENT_STATUSES, existing?.payment_status ?? "pending");
  const documents = pick(
    body.documentsStatus,
    DOCUMENT_STATUSES,
    existing?.documents_status ?? "pending",
  );
  const stage = text(body.curationStage, existing?.curation_stage ?? null);
  const notes = text(body.notes, existing?.notes ?? null);
  const rawProgress = Number(body.progress);
  const progress = Number.isFinite(rawProgress)
    ? Math.max(0, Math.min(100, Math.round(rawProgress)))
    : (existing?.progress ?? 0);

  let leadId = existing?.lead_user_id ?? null;
  if (typeof body.leadUserId === "string") {
    const candidate = body.leadUserId.trim();
    if (candidate === "") {
      leadId = null;
    } else {
      const lead = await c.env.DB.prepare(
        "SELECT id FROM users WHERE id = ? AND edition = ? AND active = 1",
      )
        .bind(candidate, edition)
        .first<{ id: string }>();
      if (!lead) return c.json({ error: "invalid_lead" }, 400);
      leadId = lead.id;
    }
  }

  await c.env.DB.prepare(
    "INSERT INTO deck_onboarding (deck_id, payment_status, documents_status, curation_stage, progress, lead_user_id, notes, updated_at, updated_by) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(deck_id) DO UPDATE SET payment_status = excluded.payment_status, " +
      "documents_status = excluded.documents_status, curation_stage = excluded.curation_stage, " +
      "progress = excluded.progress, lead_user_id = excluded.lead_user_id, notes = excluded.notes, " +
      "updated_at = excluded.updated_at, updated_by = excluded.updated_by",
  )
    .bind(id, payment, documents, stage, progress, leadId, notes, new Date().toISOString(), actorId)
    .run();

  const updated = await c.env.DB.prepare(
    `SELECT ${DECK_COLUMNS}, ${DECK_DERIVED} FROM decks d ${DECK_JOINS} WHERE d.id = ? AND d.edition = ?`,
  )
    .bind(id, edition)
    .first<DeckRow>();
  return c.json({ ok: true, deck: updated ? toDeckView(edition, updated, c.var.user.role) : null });
});

// ── Manual override of the auto-recognised details (Aug-2026 issue 12) ───────

/** Who may correct a deck's recognised details: the intake/evaluation staff. */
const EDIT_DECK_ROLES = [
  "program_associate",
  "program_manager",
  "admin",
  "analyst",
  "associate",
  "partner",
] as const;

/**
 * PATCH /api/decks/:id — override what the AI recognised.
 *
 * Issue 12: "startup name, stage, sector, cohort must be automatically
 * recognized with manual over-ride facility". The recognition happens in
 * `ai/evaluate.ts`; this is the override. Only the fields present in the body
 * are touched, and writing a name clears `name_auto` so a later re-score can't
 * quietly undo the correction.
 */
decks.patch("/:id", requireRole(...EDIT_DECK_ROLES), async (c) => {
  const { edition } = c.var.user;
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare("SELECT id FROM decks WHERE id = ? AND edition = ?")
    .bind(id, edition)
    .first<{ id: string }>();
  if (!existing) return c.json({ error: "not_found" }, 404);

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const text = (v: unknown): string | null | undefined => {
    if (typeof v !== "string") return undefined;
    const t = v.trim();
    return t === "" ? null : t;
  };

  const sets: string[] = [];
  const binds: unknown[] = [];
  const columns: Record<string, string> = {
    name: "name",
    stage: "stage",
    sector: "sector",
    city: "city",
    founder: "founder",
    founderEmail: "founder_email",
    founderPhone: "founder_phone",
    programId: "program_id",
    cohortId: "cohort_id",
  };
  for (const [field, column] of Object.entries(columns)) {
    const value = text(body[field]);
    if (value === undefined) continue;
    // A startup name is the one field that must never be blanked out.
    if (field === "name" && value === null) continue;
    sets.push(`${column} = ?`);
    binds.push(value);
    if (field === "name") sets.push("name_auto = 0");
  }
  if (sets.length === 0) return c.json({ error: "nothing_to_update" }, 400);

  sets.push("updated_at = ?");
  binds.push(new Date().toISOString(), id, edition);
  await c.env.DB.prepare(`UPDATE decks SET ${sets.join(", ")} WHERE id = ? AND edition = ?`)
    .bind(...binds)
    .run();

  // Re-derive what is still missing so the deck's Incomplete state follows the
  // correction instead of going stale.
  const row = await c.env.DB.prepare(
    "SELECT founder, founder_email, founder_phone, city, sector FROM decks WHERE id = ?",
  )
    .bind(id)
    .first<{
      founder: string | null;
      founder_email: string | null;
      founder_phone: string | null;
      city: string | null;
      sector: string | null;
    }>();
  if (row) {
    const missing = missingIntakeFields({
      founder: row.founder,
      founderEmail: row.founder_email,
      founderPhone: row.founder_phone,
      city: row.city,
      sector: row.sector,
    });
    await c.env.DB.prepare("UPDATE decks SET missing_fields = ? WHERE id = ?")
      .bind(missing.length > 0 ? missing.join(",") : null, id)
      .run();
  }

  const updated = await c.env.DB.prepare(
    `SELECT ${DECK_COLUMNS}, ${DECK_DERIVED} FROM decks d ${DECK_JOINS} WHERE d.id = ? AND d.edition = ?`,
  )
    .bind(id, edition)
    .first<DeckRow>();
  return c.json({ ok: true, deck: updated ? toDeckView(edition, updated, c.var.user.role) : null });
});

// ── Consolidated evaluation report (Aug-2026 issues 20/21/23/24) ─────────────
//
// One report per deck with a COLUMN PER EVALUATOR, so the table grows as the
// deck passes hands (AI → program associate → jury → program manager). Core
// areas and role-scoped additional parameters are returned separately so the
// screen can render the "Core Parameters" and "Addl. parameters" tabs.
//
// Issue 21 — the hierarchy: a viewer only ever receives the columns of
// evaluators at or below their own rank (`canSeeEvaluatorScores`). The
// filtering happens HERE, on the server: a lower-ranked evaluator's browser
// never receives a higher-ranked evaluator's numbers at all.

interface ReportScoreRow {
  parameter_id: string;
  evaluator_id: string | null;
  evaluator_kind: string;
  value: number;
  comment: string | null;
  evaluator_name: string | null;
  evaluator_role: string | null;
  evaluator_title: string | null;
  evaluator_initials: string | null;
}

interface ReportParamRow {
  id: string;
  key: string;
  name: string;
  weight: number;
  informational: number;
  role_scope: string | null;
}

/** GET /api/decks/:id/report — the evaluation report, hierarchy-filtered. */
decks.get("/:id/report", async (c) => {
  const { id: viewerId, edition, role } = c.var.user;
  if (role === "founder") return c.json({ error: "forbidden" }, 403);
  const id = c.req.param("id");

  const deckRow = await c.env.DB.prepare(
    `SELECT ${DECK_COLUMNS}, ${DECK_DERIVED} FROM decks d ${DECK_JOINS} WHERE d.id = ? AND d.edition = ?`,
  )
    .bind(id, edition)
    .first<DeckRow>();
  if (!deckRow) return c.json({ error: "not_found" }, 404);

  const params = (
    await c.env.DB.prepare(
      "SELECT id, key, name, weight, informational, role_scope FROM parameters " +
        "WHERE edition = ? AND active = 1 ORDER BY sort_order",
    )
      .bind(edition)
      .all<ReportParamRow>()
  ).results;

  const scoreRows = (
    await c.env.DB.prepare(
      "SELECT s.parameter_id, s.evaluator_id, s.evaluator_kind, s.value, s.comment, " +
        "u.name AS evaluator_name, u.role AS evaluator_role, u.title AS evaluator_title, " +
        "u.initials AS evaluator_initials " +
        "FROM scores s LEFT JOIN users u ON u.id = s.evaluator_id WHERE s.deck_id = ?",
    )
      .bind(id)
      .all<ReportScoreRow>()
  ).results;

  // Evaluators are sourced from BOTH the roll-up and the per-parameter scores: an
  // evaluator who has submitted a total but whose per-parameter detail predates
  // this report still earns a column (issue 20 — the report widens as the deck
  // passes hands), it just has empty cells.
  const evaluationRows = (
    await c.env.DB.prepare(
      "SELECT e.evaluator_id, e.weighted_total, e.remarks, e.submitted_at, " +
        "u.name AS evaluator_name, u.role AS evaluator_role, u.title AS evaluator_title, " +
        "u.initials AS evaluator_initials " +
        "FROM evaluations e LEFT JOIN users u ON u.id = e.evaluator_id WHERE e.deck_id = ?",
    )
      .bind(id)
      .all<{
        evaluator_id: string | null;
        weighted_total: number | null;
        remarks: string | null;
        submitted_at: string | null;
        evaluator_name: string | null;
        evaluator_role: string | null;
        evaluator_title: string | null;
        evaluator_initials: string | null;
      }>()
  ).results;

  // ── Columns ────────────────────────────────────────────────────────────────
  interface Column {
    id: string;
    kind: "ai" | "human";
    name: string;
    role?: string;
    roleLabel?: string;
    title?: string;
    initials?: string;
    rank: number;
    total?: number;
    remarks?: string;
    submittedAt?: string;
  }

  const columns: Column[] = [{ id: "ai", kind: "ai", name: "AI", rank: 0 }];
  const seenEvaluators = new Map<string, Column>();
  let hidden = 0;

  const addEvaluator = (person: {
    evaluator_id: string | null;
    evaluator_name: string | null;
    evaluator_role: string | null;
    evaluator_title: string | null;
    evaluator_initials: string | null;
  }) => {
    if (!person.evaluator_id || seenEvaluators.has(person.evaluator_id)) return;
    const evaluatorRole = (person.evaluator_role ?? "") as Role;
    // Issue 21 — your own column is always visible; anyone above you is not.
    const visible =
      person.evaluator_id === viewerId || canSeeEvaluatorScores(edition, role, evaluatorRole);
    if (!visible) {
      hidden += 1;
      seenEvaluators.set(person.evaluator_id, {
        id: person.evaluator_id,
        kind: "human",
        name: "",
        rank: -1,
      });
      return;
    }
    seenEvaluators.set(person.evaluator_id, {
      id: person.evaluator_id,
      kind: "human",
      name: person.evaluator_name ?? "Evaluator",
      role: evaluatorRole,
      roleLabel: roleLabel(edition, evaluatorRole),
      title: person.evaluator_title ?? undefined,
      initials: person.evaluator_initials ?? undefined,
      rank: evaluationRank(edition, evaluatorRole),
    });
  };

  for (const r of evaluationRows) addEvaluator(r);
  for (const r of scoreRows) {
    if (r.evaluator_kind !== "human") continue;
    addEvaluator(r);
  }

  const visibleEvaluators = [...seenEvaluators.values()]
    .filter((col) => col.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));

  const totals = new Map<string, { total?: number; remarks?: string; submittedAt?: string }>();
  for (const e of evaluationRows) {
    totals.set(e.evaluator_id ?? "ai", {
      total: e.weighted_total ?? undefined,
      remarks: e.remarks ?? undefined,
      submittedAt: e.submitted_at ?? undefined,
    });
  }
  for (const col of [columns[0], ...visibleEvaluators]) {
    const t = totals.get(col.id);
    if (t) Object.assign(col, t);
  }
  columns.push(...visibleEvaluators);
  const visibleIds = new Set(columns.map((col) => col.id));

  // ── Cells ──────────────────────────────────────────────────────────────────
  const byParam = new Map<string, Record<string, { value: number; comment?: string }>>();
  for (const r of scoreRows) {
    const colId = r.evaluator_kind === "ai" ? "ai" : r.evaluator_id;
    if (!colId || !visibleIds.has(colId)) continue;
    const cells = byParam.get(r.parameter_id) ?? {};
    cells[colId] = { value: r.value, comment: r.comment ?? undefined };
    byParam.set(r.parameter_id, cells);
  }

  const toRow = (p: ReportParamRow) => ({
    key: p.key,
    name: p.name,
    weight: p.weight,
    roleScope: p.role_scope ?? undefined,
    cells: byParam.get(p.id) ?? {},
  });

  const core = params.filter((p) => p.informational === 0).map(toRow);

  // Additional parameters grouped by the role that owns them (issue 24).
  const groups = new Map<string, { role: string; roleLabel: string; rows: ReturnType<typeof toRow>[] }>();
  for (const p of params) {
    if (p.informational === 0 || !p.role_scope) continue;
    const key = p.role_scope;
    const group =
      groups.get(key) ??
      { role: key, roleLabel: roleLabel(edition, key as Role), rows: [] };
    group.rows.push(toRow(p));
    groups.set(key, group);
  }

  return c.json({
    deck: toDeckView(edition, deckRow, role),
    columns,
    core,
    additional: [...groups.values()],
    // How many evaluators exist above the viewer in the hierarchy. The screen
    // says so plainly rather than pretending nobody has scored.
    hiddenEvaluators: hidden,
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
      "INSERT INTO decks (id, edition, name, name_auto, sector, stage, city, founder, founder_email, founder_phone, " +
        "program_id, cohort_id, status, r2_key, uploaded_by, complete) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_ai', ?, ?, 1)",
    ).bind(
      id,
      c.var.user.edition,
      meta.name || file.name.replace(/\.pdf$/i, "") || "Untitled deck",
      // Aug-2026 issue 12 — a name derived from the file name is PROVISIONAL:
      // the AI extraction replaces it with the startup's real name. A name the
      // uploader typed is authoritative and never overwritten.
      meta.name ? 0 : 1,
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
      // No meta on a bulk upload — the file name is only a PROVISIONAL label
      // (storeDeck marks it name_auto), replaced by the startup name the AI
      // reads off the deck (issue 12).
      const id = await storeDeck(c, file, {});
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
