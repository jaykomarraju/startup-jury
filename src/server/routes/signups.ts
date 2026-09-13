/**
 * W6-A — `/api/signups`: the **three-tab sign-up workspace** (spec §8.3) and the
 * founder's side of it.
 *
 * What is NOT here, and why. The document set, its lifecycle, the seat
 * resolution, the agreement templates, the signatory pool, the signing-method
 * model and the countersign gate were all built by Wave 5
 * (`routes/signup-config.ts`, `esign/**`, `shared/signupConfig.ts`,
 * `shared/agreements.ts`). This router renders them into a workspace; it adds
 * no status column and no second rule. Every lifecycle move it makes is checked
 * by `canTransitionDocument`, every roll-up by `rollUpDocumentsStatus`, every
 * bulk count by `verifiableCount` — the ONE source.
 *
 * What IS here is the part neither Wave 5 router could serve:
 *
 *   • **The workspace's staff.** `/api/signup-config` is the Admin console's
 *     API (`requireTask("adminconsole", "admin")`), so a Program Manager or
 *     Associate running a sign-up gets a 403 from every one of its verbs. The
 *     workspace is `signuppipeline` — the Sign up Pipeline's own task — so
 *     Verify all, Complete and Allocate seat are served here for the roles that
 *     reach that screen, over the same rows, with the same rules (plan §8 Q65).
 *
 *   • **The founder's submission** — `awaiting → submitted` carrying
 *     `file_url`, the one lifecycle move `signup-config.ts` has no surface for.
 *     The founder is an authenticated `founder` user here (the portal is in the
 *     app, not a tokenized link), and reaches ONLY a sign-up on a deck they
 *     uploaded: anybody else's record is a 404, never a 200 and never a 403
 *     that would confirm it exists.
 *
 *   • **The assignment gate** (§8.3): "a Program Manager's sign-up workspace is
 *     read-only until a Super User/Admin assigns them". `signups.assigned_user_id`
 *     has been on the table since `0034` and read by nothing. Read-only means
 *     every WRITE verb refuses with 403 `read_only` — here, and on the esign
 *     workspace routes through `esignWorkspaceGate`, which `src/server/index.ts`
 *     mounts in front of `/api/esign/signups/:signupId/*`. A disabled button is
 *     the screen's courtesy; this is the rule.
 *
 *   • **Completion.** esign's countersign moves `signups.status` to
 *     `completed`, but nothing moved the DECK out of `signup`, and nothing
 *     resolved the seat for a record completed that way. `POST …/complete` does
 *     both, only after the countersign.
 *
 * A `signups` row is created by `0034`'s back-fill for decks that were already
 * in the funnel, and by nothing since: `send_signup` moves the deck and emails
 * the founder but opens no workspace. `ensureSignups` materialises the row (and
 * its inherited checklist) the first time a sign-up surface is read — the same
 * lazy shape `deck_onboarding` has had since `0022`, and idempotent on
 * `signups.deck_id UNIQUE`. §9 asks `send_signup` to open it eagerly.
 *
 * Incubator only. The VC edition's term-sheet workspace (F0660) is a different
 * record on a different screen; its roles do not hold `signuppipeline`.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import type { AppEnv } from "../types";
import type { Edition, Role } from "../../shared/roles";
import { requireAuth, requireRole, requireTask } from "../auth/middleware";
import { getSession, SESSION_COOKIE } from "../auth/session";
import { auditConfig } from "../audit/events";
import {
  canTransitionDocument,
  rollUpDocumentsStatus,
  verifiableCount,
  type DocumentStatus,
} from "../../shared/signupConfig";
import { applicableTemplate, listTemplates } from "../esign/store";

const signups = new Hono<AppEnv>();
signups.use("*", requireAuth);

/** The roles that reach the Sign up Pipeline (`nav.ts` `incuration`). */
const STAFF_ROLES = ["admin", "program_manager", "program_associate"] as Role[];

/** The prototype's read-only banner, verbatim (`AISJ_IC_PM_V5/_scripts.js:2058`). */
export const READ_ONLY_MESSAGE =
  "Read-only — a Super user or Admin hasn't assigned you to this sign-up yet. You can view, but not act.";

/** A founder's file: the documents the checklist asks for are PDFs, scans and forms. */
const DOCUMENT_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/msword": "doc",
};
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

// ═══════════════════════════════════════════════════════════════════════════
// Materialising the record
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Open a `signups` row for every deck of the edition sitting at `signup` that
 * has none, each inheriting the checklist that governs its programme / cohort —
 * mandatory items at `awaiting` (they are being asked for now), optional ones at
 * `not_requested`. That is `0034`'s back-fill and `resyncOpenSignups`'s rule,
 * applied to the decks that arrived after the back-fill ran.
 *
 * The checklist resolution (cohort → programme → edition default, and an own
 * list REPLACES the default) is `loadChecklist`'s in `signup-config.ts`, which
 * is not exported; it is restated here in three reads and §9 asks for it to be.
 */
async function ensureSignups(c: Context<AppEnv>, edition: Edition): Promise<void> {
  const { results: missing } = await c.env.DB.prepare(
    "SELECT d.id AS deck_id, d.program_id AS program_id, d.cohort_id AS cohort_id FROM decks d " +
      "WHERE d.edition = ? AND d.status = 'signup' " +
      "AND NOT EXISTS (SELECT 1 FROM signups s WHERE s.deck_id = d.id)",
  )
    .bind(edition)
    .all<{ deck_id: string; program_id: string | null; cohort_id: string | null }>();
  if (missing.length === 0) return;

  for (const deck of missing) {
    const signupId = `su_${deck.deck_id}`;
    const checklist = await checklistFor(c, edition, deck.program_id, deck.cohort_id);
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO signups (id, deck_id, status) VALUES (?, ?, 'initiated') ON CONFLICT (deck_id) DO NOTHING",
      ).bind(signupId, deck.deck_id),
      ...checklist.map((item) =>
        c.env.DB.prepare(
          "INSERT INTO signup_documents (id, signup_id, required_document_id, name, note, status, sort_order) " +
            "SELECT ?, s.id, ?, ?, ?, ?, ? FROM signups s WHERE s.deck_id = ? " +
            "AND NOT EXISTS (SELECT 1 FROM signup_documents x WHERE x.signup_id = s.id AND x.required_document_id = ?)",
        ).bind(
          `sd_${signupId}_${item.id}`,
          item.id,
          item.name,
          item.note,
          item.mandatory === 1 ? "awaiting" : "not_requested",
          item.sort_order,
          deck.deck_id,
          item.id,
        ),
      ),
    ]);
    const row = await c.env.DB.prepare("SELECT id FROM signups WHERE deck_id = ?")
      .bind(deck.deck_id)
      .first<{ id: string }>();
    if (row) await syncRollUp(c, row.id);
  }
}

interface ChecklistRow {
  id: string;
  name: string;
  note: string | null;
  mandatory: number;
  sort_order: number;
}

async function checklistFor(
  c: Context<AppEnv>,
  edition: Edition,
  programId: string | null,
  cohortId: string | null,
): Promise<ChecklistRow[]> {
  const read = (where: string, ...binds: unknown[]) =>
    c.env.DB.prepare(
      "SELECT id, name, note, mandatory, sort_order FROM required_documents " +
        `WHERE edition = ? AND active = 1 AND ${where} ORDER BY sort_order, rowid`,
    )
      .bind(edition, ...binds)
      .all<ChecklistRow>()
      .then((r) => r.results);
  if (programId && cohortId) {
    const own = await read("program_id = ? AND cohort_id = ?", programId, cohortId);
    if (own.length > 0) return own;
  }
  if (programId) {
    const own = await read("program_id = ? AND cohort_id IS NULL", programId);
    if (own.length > 0) return own;
  }
  return read("program_id IS NULL AND cohort_id IS NULL");
}

/**
 * Re-derive `deck_onboarding.documents_status` from the item rows — the column
 * the Sign up Pipeline reads, which stopped being hand-set in Wave 5. The same
 * upsert `signup-config.ts`'s `syncRollUp` performs, over the same pure
 * `rollUpDocumentsStatus`.
 */
async function syncRollUp(c: Context<AppEnv>, signupId: string): Promise<void> {
  const signup = await c.env.DB.prepare("SELECT deck_id FROM signups WHERE id = ?")
    .bind(signupId)
    .first<{ deck_id: string }>();
  if (!signup) return;
  const { results } = await c.env.DB.prepare(
    "SELECT sd.status AS status, sd.waived AS waived, rd.mandatory AS mandatory " +
      "FROM signup_documents sd LEFT JOIN required_documents rd ON rd.id = sd.required_document_id " +
      "WHERE sd.signup_id = ?",
  )
    .bind(signupId)
    .all<{ status: DocumentStatus; waived: number; mandatory: number | null }>();
  const status = rollUpDocumentsStatus(
    results.map((r) => ({ status: r.status, mandatory: r.mandatory === 1, waived: r.waived === 1 })),
  );
  await c.env.DB.prepare(
    "INSERT INTO deck_onboarding (deck_id, documents_status, updated_at, updated_by) " +
      "VALUES (?, ?, datetime('now'), ?) " +
      "ON CONFLICT (deck_id) DO UPDATE SET documents_status = excluded.documents_status, " +
      "updated_at = excluded.updated_at, updated_by = excluded.updated_by",
  )
    .bind(signup.deck_id, status, c.var.user.id)
    .run();
}

// ═══════════════════════════════════════════════════════════════════════════
// Resolving a record against the caller
// ═══════════════════════════════════════════════════════════════════════════

interface WorkspaceRow {
  id: string;
  deck_id: string;
  status: string;
  founder_signed_at: string | null;
  completed_at: string | null;
  seatless: number;
  seat_allocated_at: string | null;
  assigned_user_id: string | null;
  assigned_name: string | null;
  startup: string;
  edition: Edition;
  deck_status: string;
  uploaded_by: string | null;
  founder_email: string | null;
  program_id: string | null;
  cohort_id: string | null;
  program_name: string | null;
  cohort_name: string | null;
}

async function loadRow(c: Context<AppEnv>, signupId: string): Promise<WorkspaceRow | null> {
  return c.env.DB.prepare(
    "SELECT s.id, s.deck_id, s.status, s.founder_signed_at, s.completed_at, s.seatless, " +
      "s.seat_allocated_at, s.assigned_user_id, au.name AS assigned_name, " +
      "d.name AS startup, d.edition, d.status AS deck_status, d.uploaded_by, " +
      "COALESCE(d.founder_email, fu.email) AS founder_email, " +
      "d.program_id, d.cohort_id, p.name AS program_name, co.name AS cohort_name " +
      "FROM signups s JOIN decks d ON d.id = s.deck_id " +
      "LEFT JOIN users au ON au.id = s.assigned_user_id " +
      "LEFT JOIN users fu ON fu.id = d.uploaded_by " +
      "LEFT JOIN programs p ON p.id = d.program_id " +
      "LEFT JOIN cohorts co ON co.id = d.cohort_id " +
      "WHERE s.id = ?",
  )
    .bind(signupId)
    .first<WorkspaceRow>();
}

/**
 * `:signupId` against the caller. A record in another edition, or — for a
 * founder — on a deck somebody else uploaded, is a 404: the same answer a
 * ghost id gets, so a probe learns nothing about which ids exist.
 */
async function resolve(c: Context<AppEnv>): Promise<WorkspaceRow | Response> {
  const user = c.var.user;
  const row = await loadRow(c, c.req.param("signupId") ?? "");
  if (!row || row.edition !== user.edition) return c.json({ error: "not_found" }, 404);
  if (user.role === "founder" && row.uploaded_by !== user.id) {
    return c.json({ error: "not_found" }, 404);
  }
  return row;
}

/**
 * The §8.3 gate. Only the Program Manager is gated: the associate is the
 * sign-up's executor by default, and admin / superuser are the ones who assign.
 */
function isReadOnly(user: { id: string; role: Role }, assignedUserId: string | null): boolean {
  return user.role === "program_manager" && assignedUserId !== user.id;
}

function refuseReadOnly(c: Context<AppEnv>, row: WorkspaceRow): Response | null {
  return isReadOnly(c.var.user, row.assigned_user_id)
    ? c.json({ error: "read_only", message: READ_ONLY_MESSAGE }, 403)
    : null;
}

/** Staff-only routes refuse a founder BEFORE the lookup — a 403 about who they are. */
const staffOnly = requireTask("signuppipeline", ...STAFF_ROLES);

function incubatorOnly(c: Context<AppEnv>): Response | null {
  return c.var.user.edition === "incubator" ? null : c.json({ error: "wrong_edition" }, 403);
}

signups.use("*", async (c, next) => {
  const wrong = incubatorOnly(c);
  if (wrong) return wrong;
  await next();
});

/**
 * Mounted by `src/server/index.ts` in front of esign's workspace routes, which
 * this session may not edit (they are `W5-B`'s, complete and tested). Every
 * write verb on `/api/esign/signups/:signupId/*` — the method, the signatory,
 * Fill blanks, the founder's signature recorded by staff, the countersign — is
 * refused for a Program Manager who is not assigned to that record.
 *
 * It reads the session itself because it runs before esign's `requireAuth`,
 * and it steps aside for anything it cannot judge (no session, a ghost id,
 * another edition), so esign still answers those with its own 401 / 404 and
 * the roles harness's ghost-id probes keep describing esign's gate, not this.
 */
export const esignWorkspaceGate = createMiddleware<AppEnv>(async (c, next) => {
  if (c.req.method === "GET" || c.req.method === "HEAD") return next();
  const user = await getSession(c.env.SESSIONS, getCookie(c, SESSION_COOKIE));
  if (!user || user.role !== "program_manager") return next();
  const row = await c.env.DB.prepare(
    "SELECT s.assigned_user_id AS assigned_user_id, d.edition AS edition " +
      "FROM signups s JOIN decks d ON d.id = s.deck_id WHERE s.id = ?",
  )
    .bind(c.req.param("signupId") ?? "")
    .first<{ assigned_user_id: string | null; edition: Edition }>();
  if (!row || row.edition !== user.edition) return next();
  if (isReadOnly(user, row.assigned_user_id)) {
    return c.json({ error: "read_only", message: READ_ONLY_MESSAGE }, 403);
  }
  return next();
});

// ═══════════════════════════════════════════════════════════════════════════
// The views
// ═══════════════════════════════════════════════════════════════════════════

interface DocRow {
  id: string;
  name: string;
  note: string | null;
  status: DocumentStatus;
  waived: number;
  waived_reason: string | null;
  verified_at: string | null;
  file_url: string | null;
  mandatory: number | null;
}

const ALL_STATUSES: DocumentStatus[] = ["not_requested", "awaiting", "submitted", "verified"];

async function loadDocuments(c: Context<AppEnv>, signupId: string) {
  const { results } = await c.env.DB.prepare(
    "SELECT sd.id, sd.name, sd.note, sd.status, sd.waived, sd.waived_reason, sd.verified_at, " +
      "sd.file_url, rd.mandatory AS mandatory " +
      "FROM signup_documents sd LEFT JOIN required_documents rd ON rd.id = sd.required_document_id " +
      "WHERE sd.signup_id = ? ORDER BY sd.sort_order, sd.rowid",
  )
    .bind(signupId)
    .all<DocRow>();
  // `SignupDocumentView` (shared/signupConfig.ts), plus whether a file is held.
  const items = results.map((r) => ({
    id: r.id,
    name: r.name,
    note: r.note,
    status: r.status,
    mandatory: r.mandatory === 1,
    waived: r.waived === 1,
    waivedReason: r.waived_reason,
    verifiedAt: r.verified_at,
    next: r.waived === 1 ? [] : ALL_STATUSES.filter((to) => canTransitionDocument(r.status, to)),
    hasFile: r.file_url !== null,
  }));
  const plain = items.map((i) => ({ status: i.status, mandatory: i.mandatory, waived: i.waived }));
  return {
    documentsStatus: rollUpDocumentsStatus(plain),
    verifiable: verifiableCount(plain),
    items,
  };
}

/**
 * The template this record signs: the one its agreement was raised from, or —
 * before anyone raised one — the one the library says applies (esign's own
 * `applicableTemplate`, so the workspace names the same template Fill blanks
 * would pick).
 */
async function loadAgreementSummary(c: Context<AppEnv>, row: WorkspaceRow) {
  const raised = await c.env.DB.prepare(
    "SELECT t.name AS template_name, a.countersigned_at AS countersigned_at, u.name AS countersigned_by " +
      "FROM agreements a LEFT JOIN agreement_templates t ON t.id = a.template_id " +
      "LEFT JOIN users u ON u.id = a.countersigned_by " +
      "WHERE a.signup_id = ? ORDER BY a.rowid LIMIT 1",
  )
    .bind(row.id)
    .first<{ template_name: string | null; countersigned_at: string | null; countersigned_by: string | null }>();
  if (raised) {
    return {
      templateName: raised.template_name,
      countersignedAt: raised.countersigned_at,
      countersignedBy: raised.countersigned_by,
    };
  }
  const template = applicableTemplate(await listTemplates(c.env, row.edition), {
    programId: row.program_id,
    stage: "on_signup",
  });
  return { templateName: template?.name ?? null, countersignedAt: null, countersignedBy: null };
}

async function workspaceView(c: Context<AppEnv>, row: WorkspaceRow) {
  const user = c.var.user;
  const founder = user.role === "founder";
  const canAssign = user.role === "admin" || user.role === "superuser";
  const programManagers = canAssign
    ? (
        await c.env.DB.prepare(
          "SELECT id, name FROM users WHERE edition = ? AND role = 'program_manager' AND active = 1 ORDER BY name",
        )
          .bind(row.edition)
          .all<{ id: string; name: string }>()
      ).results
    : [];
  return {
    signupId: row.id,
    deckId: row.deck_id,
    startup: row.startup,
    programName: row.program_name,
    cohortName: row.cohort_name,
    status: row.status,
    deckStatus: row.deck_status,
    founderEmail: row.founder_email,
    founderSignedAt: row.founder_signed_at,
    completedAt: row.completed_at,
    agreement: await loadAgreementSummary(c, row),
    documents: await loadDocuments(c, row.id),
    seat: {
      seatless: row.seatless === 1,
      // The prototype's `seated = !!d.seat || sg === 'onboarded'`.
      seated: row.seat_allocated_at !== null || row.status === "onboarded",
      allocatedAt: row.seat_allocated_at,
    },
    // The founder sees their own sign-up, not how the team staffs it.
    assignment: founder ? null : { userId: row.assigned_user_id, name: row.assigned_name },
    readOnly: isReadOnly(user, row.assigned_user_id),
    readOnlyReason: isReadOnly(user, row.assigned_user_id) ? READ_ONLY_MESSAGE : null,
    canAssign,
    programManagers,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Reads
// ═══════════════════════════════════════════════════════════════════════════

/** GET /api/signups — one summary per open sign-up, for the pipeline rows. */
signups.get("/", staffOnly, async (c) => {
  const user = c.var.user;
  await ensureSignups(c, user.edition);
  const { results } = await c.env.DB.prepare(
    "SELECT s.id AS signup_id, s.deck_id, s.status, s.founder_signed_at, s.seatless, " +
      "s.seat_allocated_at, s.assigned_user_id, u.name AS assigned_name, d.name AS startup, d.status AS deck_status " +
      "FROM signups s JOIN decks d ON d.id = s.deck_id LEFT JOIN users u ON u.id = s.assigned_user_id " +
      "WHERE d.edition = ? AND d.status IN ('signup', 'onboard_ready') ORDER BY s.created_at DESC, s.id",
  )
    .bind(user.edition)
    .all<{
      signup_id: string;
      deck_id: string;
      status: string;
      founder_signed_at: string | null;
      seatless: number;
      seat_allocated_at: string | null;
      assigned_user_id: string | null;
      assigned_name: string | null;
      startup: string;
      deck_status: string;
    }>();
  const summaries = [];
  for (const r of results) {
    const docs = await loadDocuments(c, r.signup_id);
    summaries.push({
      signupId: r.signup_id,
      deckId: r.deck_id,
      startup: r.startup,
      status: r.status,
      deckStatus: r.deck_status,
      founderSigned: r.founder_signed_at !== null,
      documentsStatus: docs.documentsStatus,
      verifiable: docs.verifiable,
      seatless: r.seatless === 1,
      seated: r.seat_allocated_at !== null || r.status === "onboarded",
      assignedName: r.assigned_name,
      readOnly: isReadOnly(user, r.assigned_user_id),
    });
  }
  return c.json({ signups: summaries });
});

/** GET /api/signups/mine — the founder's own sign-ups, and only theirs. */
signups.get("/mine", requireRole("founder"), async (c) => {
  const user = c.var.user;
  await ensureSignups(c, user.edition);
  const { results } = await c.env.DB.prepare(
    "SELECT s.id FROM signups s JOIN decks d ON d.id = s.deck_id " +
      "WHERE d.edition = ? AND d.uploaded_by = ? ORDER BY s.created_at DESC, s.id",
  )
    .bind(user.edition, user.id)
    .all<{ id: string }>();
  const views = [];
  for (const { id } of results) {
    const row = await loadRow(c, id);
    if (row) views.push(await workspaceView(c, row));
  }
  return c.json({ signups: views });
});

/** GET /api/signups/:signupId — the workspace's whole state. */
signups.get("/:signupId", requireRole(...STAFF_ROLES, "founder"), async (c) => {
  if (c.var.user.role !== "founder" && !(await c.var.perms.can("signuppipeline"))) {
    return c.json({ error: "forbidden" }, 403);
  }
  const row = await resolve(c);
  if (row instanceof Response) return row;
  return c.json(await workspaceView(c, row));
});

/** GET /api/signups/:signupId/documents/:docId/file — the "View" button. */
signups.get("/:signupId/documents/:docId/file", requireRole(...STAFF_ROLES, "founder"), async (c) => {
  if (c.var.user.role !== "founder" && !(await c.var.perms.can("signuppipeline"))) {
    return c.json({ error: "forbidden" }, 403);
  }
  const row = await resolve(c);
  if (row instanceof Response) return row;
  const doc = await c.env.DB.prepare(
    "SELECT name, file_url FROM signup_documents WHERE id = ? AND signup_id = ?",
  )
    .bind(c.req.param("docId"), row.id)
    .first<{ name: string; file_url: string | null }>();
  if (!doc) return c.json({ error: "not_found" }, 404);
  if (!doc.file_url) return c.json({ error: "no_file" }, 404);
  const object = await c.env.DECKS.get(doc.file_url);
  if (!object) return c.json({ error: "no_file" }, 404);
  const headers = new Headers();
  headers.set("content-type", object.httpMetadata?.contentType ?? "application/octet-stream");
  headers.set("content-disposition", `inline; filename="${doc.file_url.split("/").pop() ?? "document"}"`);
  headers.set("cache-control", "private, max-age=300");
  return new Response(object.body, { headers });
});

// ═══════════════════════════════════════════════════════════════════════════
// The founder's verb
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/signups/:signupId/documents/:docId/file — the founder attaches a
 * file to one requested item: `awaiting → submitted`, with `file_url`.
 *
 * The lifecycle decides, not this handler: an item the team never requested
 * (`not_requested`) is a skip, and an item already submitted or verified has
 * no `submitted` move — both are `400 illegal_transition`, exactly the refusal
 * `PATCH /api/signup-config/…` gives staff. A waived item is out of the
 * lifecycle altogether.
 */
signups.post("/:signupId/documents/:docId/file", requireRole("founder"), async (c) => {
  const row = await resolve(c);
  if (row instanceof Response) return row;
  if (row.status !== "initiated" && row.status !== "progress") {
    return c.json({ error: "signup_closed" }, 409);
  }
  const doc = await c.env.DB.prepare(
    "SELECT id, name, status, waived FROM signup_documents WHERE id = ? AND signup_id = ?",
  )
    .bind(c.req.param("docId"), row.id)
    .first<{ id: string; name: string; status: DocumentStatus; waived: number }>();
  if (!doc) return c.json({ error: "not_found" }, 404);
  if (doc.waived === 1) return c.json({ error: "document_waived" }, 400);
  if (!canTransitionDocument(doc.status, "submitted")) {
    return c.json({ error: "illegal_transition", from: doc.status, to: "submitted" }, 400);
  }

  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return c.json({ error: "file_required" }, 400);
  const ext = DOCUMENT_TYPES[file.type];
  if (!ext) {
    return c.json({ error: "unsupported_type", message: "Attach a PDF, image or Word document." }, 400);
  }
  if (file.size > MAX_DOCUMENT_BYTES) return c.json({ error: "file_too_large" }, 413);

  const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 120) || `document.${ext}`;
  const key = `signups/${row.id}/${doc.id}/${safeName}`;
  await c.env.DECKS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  // Guarded on the status it was read at, so two racing uploads cannot both
  // count as the move.
  const moved = await c.env.DB.prepare(
    "UPDATE signup_documents SET status = 'submitted', file_url = ?, verified_by = NULL, verified_at = NULL " +
      "WHERE id = ? AND status = ?",
  )
    .bind(key, doc.id, doc.status)
    .run();
  if ((moved.meta?.changes ?? 0) === 0) {
    return c.json({ error: "illegal_transition", from: doc.status, to: "submitted" }, 409);
  }
  await auditConfig(c, "signup_document_status", `${doc.name} for ${row.startup}: ${doc.status} → submitted`, {
    targetType: "signup_documents",
    targetId: doc.id,
    deckId: row.deck_id,
    detail: { from: doc.status, to: "submitted", by: "founder" },
  });
  await syncRollUp(c, row.id);
  return c.json(await workspaceView(c, (await loadRow(c, row.id))!));
});

// ═══════════════════════════════════════════════════════════════════════════
// The staff verbs — each behind the §8.3 assignment gate
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/signups/:signupId/documents/verify-all — "Verify all". Advances
 * exactly the items that CAN advance (`submitted`, unwaived); an item still
 * `awaiting` is not verified by a bulk action, because that is the skip the
 * lifecycle refuses.
 */
signups.post("/:signupId/documents/verify-all", staffOnly, async (c) => {
  const row = await resolve(c);
  if (row instanceof Response) return row;
  const ro = refuseReadOnly(c, row);
  if (ro) return ro;

  const { results } = await c.env.DB.prepare(
    "SELECT id, status, waived FROM signup_documents WHERE signup_id = ?",
  )
    .bind(row.id)
    .all<{ id: string; status: DocumentStatus; waived: number }>();
  const movable = results.filter((r) => r.waived === 0 && canTransitionDocument(r.status, "verified"));
  if (movable.length > 0) {
    await c.env.DB.batch(
      movable.map((r) =>
        c.env.DB.prepare(
          "UPDATE signup_documents SET status = 'verified', verified_by = ?, verified_at = datetime('now') " +
            "WHERE id = ? AND status = 'submitted'",
        ).bind(c.var.user.id, r.id),
      ),
    );
    await auditConfig(
      c,
      "signup_documents_verified",
      `Verified all documents for ${row.startup}: ${movable.length} items`,
      { targetType: "signups", targetId: row.id, deckId: row.deck_id, detail: { moved: movable.length } },
    );
    await syncRollUp(c, row.id);
  }
  return c.json({ ok: true, moved: movable.length, view: await workspaceView(c, row) });
});

/**
 * POST /api/signups/:signupId/complete — the prototype's "Countersign &
 * complete", second half. esign's countersign has already moved the sign-up to
 * `completed`; this moves the DECK `signup → onboard_ready` (the transition the
 * founder's old "Complete sign-up" button used to fire unguarded) and resolves
 * the seat the way `s-suseat.html` describes: take a free cohort seat, or flag
 * the record seatless. Sign-up is never blocked by seats.
 */
signups.post("/:signupId/complete", staffOnly, async (c) => {
  const row = await resolve(c);
  if (row instanceof Response) return row;
  const ro = refuseReadOnly(c, row);
  if (ro) return ro;

  if (row.status === "initiated" || row.status === "progress") {
    return c.json(
      { error: "not_countersigned", message: "Countersign the agreement before completing sign-up." },
      409,
    );
  }
  if (row.deck_status !== "signup" && row.deck_status !== "onboard_ready") {
    return c.json({ error: "wrong_stage", status: row.deck_status }, 409);
  }
  const seatResolved = row.seat_allocated_at !== null || row.seatless === 1 || row.status === "onboarded";
  if (row.deck_status === "onboard_ready" && seatResolved) {
    return c.json({ error: "already_complete" }, 409);
  }

  const statements = [];
  let seated = row.seat_allocated_at !== null || row.status === "onboarded";
  let seatless = row.seatless === 1;
  if (!seatResolved) {
    const cohort = row.cohort_id
      ? await c.env.DB.prepare("SELECT id, seat_capacity, seats_filled FROM cohorts WHERE id = ?")
          .bind(row.cohort_id)
          .first<{ id: string; seat_capacity: number; seats_filled: number }>()
      : null;
    if (cohort && cohort.seats_filled < cohort.seat_capacity) {
      statements.push(
        c.env.DB.prepare(
          "UPDATE signups SET seatless = 0, seat_allocated_at = datetime('now') WHERE id = ?",
        ).bind(row.id),
        c.env.DB.prepare("UPDATE cohorts SET seats_filled = seats_filled + 1 WHERE id = ?").bind(cohort.id),
      );
      seated = true;
    } else {
      statements.push(
        c.env.DB.prepare("UPDATE signups SET seatless = 1, seat_allocated_at = NULL WHERE id = ?").bind(row.id),
      );
      seatless = true;
    }
  }
  if (row.deck_status === "signup") {
    const ts = new Date().toISOString();
    statements.push(
      c.env.DB.prepare("UPDATE decks SET status = 'onboard_ready', updated_at = ? WHERE id = ? AND status = 'signup'").bind(
        ts,
        row.deck_id,
      ),
      c.env.DB.prepare(
        "INSERT INTO pipeline_events (id, deck_id, actor_id, from_stage, to_stage, action, note, created_at) " +
          "VALUES (?, ?, ?, 'signup', 'onboard_ready', 'complete_signup', 'Sign-up complete — ready to onboard', ?)",
      ).bind(`${row.deck_id}_evt_${crypto.randomUUID()}`, row.deck_id, c.var.user.id, ts),
    );
  }
  await c.env.DB.batch(statements);
  await auditConfig(
    c,
    seatless ? "signup_completed_seatless" : "signup_completed_seated",
    seatless
      ? `${row.startup} completed sign-up with no cohort seat — flagged seatless`
      : `${row.startup} completed sign-up · seat allocated in ${row.cohort_name ?? "cohort"}`,
    { targetType: "signups", targetId: row.id, deckId: row.deck_id, detail: { seatless } },
  );
  const view = await workspaceView(c, (await loadRow(c, row.id))!);
  return c.json({ ok: true, deckStatus: "onboard_ready", seated, seatless, view });
});

/**
 * POST /api/signups/:signupId/seat — "Allocate seat" on the red Seatless card.
 * The same move as the console's `POST /api/signup-config/…/seat`, for the
 * pipeline's staff: clears the flag, provisions founder access (status
 * `onboarded`), and is allowed past capacity — the alternative is refusing to
 * seat a startup that has already signed.
 */
signups.post("/:signupId/seat", staffOnly, async (c) => {
  const row = await resolve(c);
  if (row instanceof Response) return row;
  const ro = refuseReadOnly(c, row);
  if (ro) return ro;
  if (row.seat_allocated_at !== null) return c.json({ error: "already_seated" }, 400);
  if (row.status !== "completed" && row.status !== "onboarded") {
    return c.json({ error: "not_completed", status: row.status }, 400);
  }
  if (!row.cohort_id) return c.json({ error: "no_cohort" }, 400);

  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE signups SET seatless = 0, seat_allocated_at = datetime('now'), status = 'onboarded' WHERE id = ?",
    ).bind(row.id),
    c.env.DB.prepare("UPDATE cohorts SET seats_filled = seats_filled + 1 WHERE id = ?").bind(row.cohort_id),
  ]);
  await auditConfig(c, "seat_allocated", `Seat allocated to ${row.startup} in ${row.cohort_name ?? "cohort"}`, {
    targetType: "signups",
    targetId: row.id,
    deckId: row.deck_id,
  });
  return c.json({ ok: true, view: await workspaceView(c, (await loadRow(c, row.id))!) });
});

/**
 * PUT /api/signups/:signupId/assignee — the Super User / Admin half of the
 * assignment gate. `{ userId }` names an active Program Manager of the edition;
 * `{ userId: null }` returns the workspace to read-only for every PM.
 */
signups.put("/:signupId/assignee", requireTask("signuppipeline", "admin"), async (c) => {
  const row = await resolve(c);
  if (row instanceof Response) return row;
  const body = (await c.req.json().catch(() => ({}))) as { userId?: unknown };
  let assignee: { id: string; name: string } | null = null;
  if (typeof body.userId === "string" && body.userId !== "") {
    assignee = await c.env.DB.prepare(
      "SELECT id, name FROM users WHERE id = ? AND edition = ? AND role = 'program_manager' AND active = 1",
    )
      .bind(body.userId, row.edition)
      .first<{ id: string; name: string }>();
    if (!assignee) return c.json({ error: "not_a_program_manager" }, 400);
  } else if (body.userId !== null) {
    return c.json({ error: "user_required" }, 400);
  }
  await c.env.DB.prepare("UPDATE signups SET assigned_user_id = ? WHERE id = ?")
    .bind(assignee?.id ?? null, row.id)
    .run();
  await auditConfig(
    c,
    "signup_pm_assigned",
    assignee
      ? `Program manager assigned to ${row.startup}'s sign-up: ${assignee.name}`
      : `Program manager unassigned from ${row.startup}'s sign-up`,
    { targetType: "signups", targetId: row.id, deckId: row.deck_id },
  );
  return c.json(await workspaceView(c, (await loadRow(c, row.id))!));
});

export default signups;
