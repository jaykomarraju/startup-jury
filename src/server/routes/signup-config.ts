/**
 * W5-A — Admin console → Sign-up: **Required documents**, **Seat capacity**
 * (incubator) and **Fund Deployment** (VC). Mounted at `/api/signup-config`.
 *
 * Three sections, one router, because they share one scope — the programme /
 * cohort the sign-up funnel is configured for — and because `s-suseat.html` and
 * `s-sufund.html` are literally the same slot in the two editions' consoles.
 *
 * What lives here:
 *
 *   • **the checklist** (`required_documents`) — the per-programme default every
 *     new sign-up inherits (F0009, F0033). Saved as a set, with the prototype's
 *     "Applies to" choice deciding whether sign-ups already open are re-synced.
 *
 *   • **the lifecycle** (`signup_documents`) — `not_requested → awaiting →
 *     submitted → verified`, plus the bulk verify (F0050, F0090). The legal
 *     moves are a closed table in `src/shared/signupConfig.ts`; an illegal one
 *     is a **400, never a silent write**. Every change re-derives
 *     `deck_onboarding.documents_status`, so the Sign up Pipeline's one-column
 *     view keeps agreeing with the item rows that are now the truth.
 *
 *   • **seats** (`cohorts.seat_capacity` / `seats_filled`, migration `0036`) —
 *     capacity, filled count and utilisation per programme / cohort (F0010,
 *     F0034), and the `seatless` flag on a sign-up that completes without one
 *     (F0011). **Sign-up is never blocked by seats**: a completion with no free
 *     seat is flagged, not refused, and allocating past capacity is allowed and
 *     warned about. `s-suseat.html` and `0036`'s header both say so.
 *
 *   • **fund deployment** (`programs.fund_allocated` / `capital_deployed` /
 *     `fund_unutilised`) — the VC edition's third figure and the ±0.5 Cr
 *     reconciliation (F0047 in part, F0048, F0049, F0121).
 *
 * Seat CAPACITY here is the COHORT's — how many startups a batch can take
 * (plan §8 Q50). The purchased user-seat entitlement is
 * `billing_subscriptions.seats` and belongs to Credits & billing; nothing in
 * this file reads it.
 *
 * AuthZ: the whole router is the Admin console's own task, `requireTask(
 * "adminconsole", "admin")`, so revoking that one cell closes the console and
 * its API together (§8 Q16). The two edition-specific sections additionally
 * refuse the other edition with a 403 — the section is not in that console's
 * rail, so serving it would be a capability the UI never offers.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../types";
import type { Edition } from "../../shared/roles";
import { requireAuth, requireTask } from "../auth/middleware";
import { auditConfig } from "../audit/events";
import {
  canTransitionDocument,
  fundReconcileDelta,
  fundReconcileNote,
  fundReconciles,
  fundUtilisation,
  isDocumentApplyTo,
  isDocumentStatus,
  rollUpDocumentsStatus,
  seatNote,
  seatRowState,
  seatlessNote,
  seatsRemaining,
  verifiableCount,
  type DocumentApplyTo,
  type DocumentItem,
  type DocumentStatus,
  type FundRow,
  type FundRowView,
  type RequiredDocumentView,
  type SeatRowView,
  type SignupDocumentSetView,
  type SignupDocumentView,
} from "../../shared/signupConfig";

const signupConfig = new Hono<AppEnv>();
signupConfig.use("*", requireAuth);
signupConfig.use("*", requireTask("adminconsole", "admin"));

/** Longest document name the checklist card will store. */
const MAX_NAME_LENGTH = 120;
const MAX_NOTE_LENGTH = 120;
/** A waive reason is mandatory (`0034` enforces it in SQL too) and bounded. */
const MAX_REASON_LENGTH = 400;
/** ₹ Cr. Above this a figure is a typo, not a fund. Matches `validFund`. */
const MAX_FUND_CR = 1_000_000;
/** A cohort cannot seat more startups than this; above it, a fat finger. */
const MAX_SEATS = 100_000;

async function readBody<T>(c: Context<AppEnv>): Promise<Partial<T>> {
  return (await c.req.json().catch(() => ({}))) as Partial<T>;
}

function cleanText(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim().replace(/\s+/g, " ");
  if (!text || text.length > max) return null;
  return text;
}

/** An optional sub-label: absent, empty and whitespace all mean "no note". */
function cleanNote(raw: unknown): string | null | "err" {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") return "err";
  const text = raw.trim().replace(/\s+/g, " ");
  if (!text) return null;
  return text.length > MAX_NOTE_LENGTH ? "err" : text;
}

/** A whole, non-negative seat count. */
function validSeats(raw: unknown): { ok: boolean; value: number } {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return { ok: false, value: 0 };
  if (!Number.isInteger(raw) || raw < 0 || raw > MAX_SEATS) return { ok: false, value: 0 };
  return { ok: true, value: raw };
}

/** A ₹ Cr figure, or null to clear it. `0` is a figure; `null` is "not set". */
function validCr(raw: unknown): { ok: boolean; value: number | null } {
  if (raw === null || raw === undefined || raw === "") return { ok: true, value: null };
  if (typeof raw !== "number" || !Number.isFinite(raw)) return { ok: false, value: null };
  if (raw < 0 || raw > MAX_FUND_CR) return { ok: false, value: null };
  // ₹ Cr are authored to one decimal; keep two so the ±0.5 tolerance is exact.
  return { ok: true, value: Math.round(raw * 100) / 100 };
}

// ═══════════════════════════════════════════════════════════════════════════
// Required documents — the configured checklist
// ═══════════════════════════════════════════════════════════════════════════

interface RequiredRow {
  id: string;
  edition: Edition;
  program_id: string | null;
  cohort_id: string | null;
  name: string;
  note: string | null;
  mandatory: number;
  active: number;
  sort_order: number;
}

function toRequiredView(r: RequiredRow): RequiredDocumentView {
  return {
    id: r.id,
    name: r.name,
    note: r.note,
    mandatory: r.mandatory === 1,
    active: r.active === 1,
    programId: r.program_id,
    cohortId: r.cohort_id,
    sortOrder: r.sort_order,
  };
}

/**
 * The checklist in force for one scope.
 *
 * `required_documents` stores an edition-wide default (`program_id IS NULL`)
 * and optional per-programme overrides (`0034`). A programme that has authored
 * its own list **replaces** the default rather than adding to it: the prototype
 * shows one list of toggles per selected programme, not a default list with
 * additions, and an override that could only ever add items could not turn one
 * off — which is the single thing the toggles exist to do.
 */
async function loadChecklist(
  c: Context<AppEnv>,
  programId: string | null,
  cohortId: string | null,
): Promise<{ rows: RequiredRow[]; inherited: boolean }> {
  const edition = c.var.user.edition;
  if (cohortId) {
    const own = await scopedRows(c, edition, programId, cohortId);
    if (own.length > 0) return { rows: own, inherited: false };
  }
  if (programId) {
    const own = await scopedRows(c, edition, programId, null);
    if (own.length > 0) return { rows: own, inherited: false };
  }
  const defaults = await scopedRows(c, edition, null, null);
  return { rows: defaults, inherited: programId !== null || cohortId !== null };
}

function scopedRows(
  c: Context<AppEnv>,
  edition: Edition,
  programId: string | null,
  cohortId: string | null,
): Promise<RequiredRow[]> {
  const where =
    programId === null
      ? "program_id IS NULL AND cohort_id IS NULL"
      : cohortId === null
        ? "program_id = ? AND cohort_id IS NULL"
        : "program_id = ? AND cohort_id = ?";
  const binds: unknown[] = [edition];
  if (programId !== null) binds.push(programId);
  if (programId !== null && cohortId !== null) binds.push(cohortId);
  return c.env.DB.prepare(
    `SELECT id, edition, program_id, cohort_id, name, note, mandatory, active, sort_order ` +
      `FROM required_documents WHERE edition = ? AND ${where} ORDER BY sort_order, rowid`,
  )
    .bind(...binds)
    .all<RequiredRow>()
    .then((r) => r.results);
}

/** The programme must exist in the caller's edition; a cohort, under it. */
async function resolveScope(
  c: Context<AppEnv>,
  programId: unknown,
  cohortId: unknown,
): Promise<{ programId: string | null; cohortId: string | null } | null> {
  const edition = c.var.user.edition;
  const pid = typeof programId === "string" && programId ? programId : null;
  const cid = typeof cohortId === "string" && cohortId ? cohortId : null;
  if (cid !== null && pid === null) return null;
  if (pid === null) return { programId: null, cohortId: null };

  const prog = await c.env.DB.prepare("SELECT id FROM programs WHERE id = ? AND edition = ?")
    .bind(pid, edition)
    .first<{ id: string }>();
  if (!prog) return null;
  if (cid === null) return { programId: pid, cohortId: null };

  const coh = await c.env.DB.prepare("SELECT id FROM cohorts WHERE id = ? AND program_id = ?")
    .bind(cid, pid)
    .first<{ id: string }>();
  return coh ? { programId: pid, cohortId: cid } : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Required documents — the per-sign-up sets
// ═══════════════════════════════════════════════════════════════════════════

interface SignupDocRow {
  id: string;
  signup_id: string;
  deck_id: string;
  startup: string;
  program_name: string | null;
  cohort_name: string | null;
  signup_status: string;
  doc_id: string;
  name: string;
  note: string | null;
  status: DocumentStatus;
  waived: number;
  waived_reason: string | null;
  verified_at: string | null;
  mandatory: number | null;
  sort_order: number;
}

/**
 * Every open sign-up's document set, newest first, optionally narrowed to the
 * selected scope. `mandatory` is read through the checklist row the item
 * inherited; an ad-hoc item (`required_document_id IS NULL`) has no checklist
 * row and is treated as optional — the team added it, so nothing org-wide
 * should hold the roll-up on it.
 */
async function loadSignupSets(
  c: Context<AppEnv>,
  programId: string | null,
  cohortId: string | null,
): Promise<SignupDocumentSetView[]> {
  const binds: unknown[] = [c.var.user.edition];
  let scope = "";
  if (programId !== null) {
    scope += " AND d.program_id = ?";
    binds.push(programId);
  }
  if (cohortId !== null) {
    scope += " AND d.cohort_id = ?";
    binds.push(cohortId);
  }
  const { results } = await c.env.DB.prepare(
    "SELECT s.id AS signup_id, s.deck_id AS deck_id, s.status AS signup_status, " +
      "d.name AS startup, p.name AS program_name, co.name AS cohort_name, " +
      "sd.id AS doc_id, sd.name AS name, sd.note AS note, sd.status AS status, " +
      "sd.waived AS waived, sd.waived_reason AS waived_reason, sd.verified_at AS verified_at, " +
      "rd.mandatory AS mandatory, sd.sort_order AS sort_order " +
      "FROM signups s " +
      "JOIN decks d ON d.id = s.deck_id " +
      "LEFT JOIN programs p ON p.id = d.program_id " +
      "LEFT JOIN cohorts co ON co.id = d.cohort_id " +
      "JOIN signup_documents sd ON sd.signup_id = s.id " +
      "LEFT JOIN required_documents rd ON rd.id = sd.required_document_id " +
      `WHERE d.edition = ?${scope} ` +
      "ORDER BY s.created_at DESC, s.id, sd.sort_order, sd.rowid",
  )
    .bind(...binds)
    .all<SignupDocRow>();

  const sets = new Map<string, SignupDocumentSetView>();
  for (const r of results) {
    let set = sets.get(r.signup_id);
    if (!set) {
      set = {
        signupId: r.signup_id,
        deckId: r.deck_id,
        startup: r.startup,
        programName: r.program_name,
        cohortName: r.cohort_name,
        signupStatus: r.signup_status,
        documentsStatus: "pending",
        verifiable: 0,
        items: [],
      };
      sets.set(r.signup_id, set);
    }
    set.items.push(toDocumentView(r));
  }
  for (const set of sets.values()) {
    const items = set.items.map(toDocumentItem);
    set.documentsStatus = rollUpDocumentsStatus(items);
    set.verifiable = verifiableCount(items);
  }
  return [...sets.values()];
}

function toDocumentView(r: SignupDocRow): SignupDocumentView {
  return {
    id: r.doc_id,
    name: r.name,
    note: r.note,
    status: r.status,
    mandatory: r.mandatory === 1,
    waived: r.waived === 1,
    waivedReason: r.waived_reason,
    verifiedAt: r.verified_at,
    // A waived item is out of the lifecycle: nothing is expected of it.
    next: r.waived === 1 ? [] : nextStatuses(r.status),
  };
}

function nextStatuses(from: DocumentStatus): DocumentStatus[] {
  const all: DocumentStatus[] = ["not_requested", "awaiting", "submitted", "verified"];
  return all.filter((to) => canTransitionDocument(from, to));
}

function toDocumentItem(v: SignupDocumentView): DocumentItem {
  return { status: v.status, mandatory: v.mandatory, waived: v.waived };
}

/**
 * Re-derive `deck_onboarding.documents_status` from the item rows (F0050). The
 * roll-up column stays, so the Sign up Pipeline keeps rendering; it stops being
 * hand-set. The onboarding row is created lazily by `0022`'s own design, so
 * this upserts rather than assuming one exists.
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
    results.map((r) => ({
      status: r.status,
      mandatory: r.mandatory === 1,
      waived: r.waived === 1,
    })),
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
// GET /api/signup-config/documents — the section's whole payload
// ═══════════════════════════════════════════════════════════════════════════

signupConfig.get("/documents", async (c) => {
  const scope = await resolveScope(c, c.req.query("programId"), c.req.query("cohortId"));
  if (!scope) return c.json({ error: "unknown_scope" }, 400);
  const { rows, inherited } = await loadChecklist(c, scope.programId, scope.cohortId);
  return c.json({
    edition: c.var.user.edition,
    scope,
    /** True = this programme has no list of its own and shows the default. */
    inherited,
    items: rows.filter((r) => r.active === 1).map(toRequiredView),
    retired: rows.filter((r) => r.active === 0).map(toRequiredView),
    signups: await loadSignupSets(c, scope.programId, scope.cohortId),
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PUT /api/signup-config/documents — save the checklist
// ═══════════════════════════════════════════════════════════════════════════

interface ChecklistItemInput {
  id?: string;
  name: string;
  note?: string | null;
  mandatory?: boolean;
}

/**
 * The console's Save changes for this section: the checklist arrives as the
 * WHOLE list for the scope, in display order.
 *
 *   • an item with an `id` in the scope is updated in place;
 *   • an item without one is inserted;
 *   • an item of the scope that is absent from the body is **retired**
 *     (`active = 0`), never deleted — a sign-up that already inherited it holds
 *     a `required_document_id` pointing at it, and its mandatory flag is what
 *     the roll-up reads.
 *
 * `applyTo` is the prototype's second select. `"new"` leaves sign-ups already
 * open exactly as they are; `"all"` re-syncs them — adding items they never
 * inherited and dropping ones still at `not_requested`. A document already
 * requested from a founder is never removed by a config edit: that would
 * silently withdraw an ask the founder can see.
 */
signupConfig.put("/documents", async (c) => {
  const body = await readBody<{
    programId: string | null;
    cohortId: string | null;
    applyTo: DocumentApplyTo;
    items: ChecklistItemInput[];
  }>(c);

  const scope = await resolveScope(c, body.programId, body.cohortId);
  if (!scope) return c.json({ error: "unknown_scope" }, 400);
  const applyTo: DocumentApplyTo = isDocumentApplyTo(body.applyTo) ? body.applyTo : "new";
  if (!Array.isArray(body.items)) return c.json({ error: "items_required" }, 400);
  if (body.items.length === 0) return c.json({ error: "checklist_empty" }, 400);

  const existing = await scopedRows(c, c.var.user.edition, scope.programId, scope.cohortId);
  const byId = new Map(existing.map((r) => [r.id, r]));

  // Validate the whole list before writing any of it.
  const parsed: { id: string | null; name: string; note: string | null; mandatory: boolean }[] = [];
  const seen = new Set<string>();
  for (const raw of body.items) {
    const name = cleanText(raw?.name, MAX_NAME_LENGTH);
    if (!name) return c.json({ error: "name_required" }, 400);
    const key = name.toLowerCase();
    if (seen.has(key)) return c.json({ error: "duplicate_document" }, 400);
    seen.add(key);
    const note = cleanNote(raw?.note);
    if (note === "err") return c.json({ error: "invalid_note" }, 400);
    const id = typeof raw?.id === "string" && raw.id ? raw.id : null;
    if (id !== null && !byId.has(id)) return c.json({ error: "unknown_document" }, 400);
    parsed.push({ id, name, note, mandatory: raw?.mandatory !== false });
  }

  const kept = new Set(parsed.map((p) => p.id).filter((id): id is string => id !== null));
  const statements = [];
  parsed.forEach((item, i) => {
    if (item.id) {
      statements.push(
        c.env.DB.prepare(
          "UPDATE required_documents SET name = ?, note = ?, mandatory = ?, active = 1, sort_order = ? WHERE id = ?",
        ).bind(item.name, item.note, item.mandatory ? 1 : 0, i + 1, item.id),
      );
    } else {
      statements.push(
        c.env.DB.prepare(
          "INSERT INTO required_documents (id, edition, program_id, cohort_id, name, note, mandatory, active, sort_order) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)",
        ).bind(
          `rd_${crypto.randomUUID().slice(0, 12)}`,
          c.var.user.edition,
          scope.programId,
          scope.cohortId,
          item.name,
          item.note,
          item.mandatory ? 1 : 0,
          i + 1,
        ),
      );
    }
  });
  for (const row of existing) {
    if (!kept.has(row.id)) {
      statements.push(
        c.env.DB.prepare("UPDATE required_documents SET active = 0 WHERE id = ?").bind(row.id),
      );
    }
  }
  await c.env.DB.batch(statements);

  let resynced = 0;
  if (applyTo === "all") resynced = await resyncOpenSignups(c, scope);

  const mandatory = parsed.filter((p) => p.mandatory).length;
  await auditConfig(
    c,
    "required_documents_saved",
    `Required documents updated: ${parsed.length} items, ${mandatory} mandatory` +
      (applyTo === "all" ? ` · re-synced ${resynced} open sign-ups` : ""),
    { targetType: "required_documents", targetId: scope.cohortId ?? scope.programId ?? "default" },
  );

  const { rows, inherited } = await loadChecklist(c, scope.programId, scope.cohortId);
  return c.json({
    ok: true,
    scope,
    inherited,
    applyTo,
    resynced,
    items: rows.filter((r) => r.active === 1).map(toRequiredView),
    signups: await loadSignupSets(c, scope.programId, scope.cohortId),
  });
});

/**
 * Push the saved checklist onto the sign-ups already open in this scope.
 *
 * Additive for anything the founder has been asked for, subtractive only for
 * items still at `not_requested` — those were never requested, so dropping one
 * withdraws nothing. A mandatory new item lands at `awaiting` (it is being
 * asked for now); an optional one lands at `not_requested`, matching `0034`'s
 * own back-fill.
 *
 * Each sign-up is resynced against the checklist that governs IT, resolved from
 * its own deck's programme and cohort — **not** against the list just saved.
 * Saving the edition default with "All startups" must not push default items
 * onto a sign-up in a programme that has authored its own list; that programme
 * turned those items off on purpose.
 */
async function resyncOpenSignups(
  c: Context<AppEnv>,
  scope: { programId: string | null; cohortId: string | null },
): Promise<number> {
  const binds: unknown[] = [c.var.user.edition];
  let where = "";
  if (scope.programId !== null) {
    where += " AND d.program_id = ?";
    binds.push(scope.programId);
  }
  if (scope.cohortId !== null) {
    where += " AND d.cohort_id = ?";
    binds.push(scope.cohortId);
  }
  const { results: signups } = await c.env.DB.prepare(
    "SELECT s.id AS id, d.program_id AS program_id, d.cohort_id AS cohort_id " +
      "FROM signups s JOIN decks d ON d.id = s.deck_id " +
      `WHERE d.edition = ? AND s.status IN ('initiated', 'progress')${where}`,
  )
    .bind(...binds)
    .all<{ id: string; program_id: string | null; cohort_id: string | null }>();
  if (signups.length === 0) return 0;

  // One resolution per distinct scope rather than per sign-up — a cohort's
  // whole intake shares a checklist.
  const byScope = new Map<string, RequiredRow[]>();
  async function checklistFor(programId: string | null, cohortId: string | null) {
    const key = `${programId ?? ""}/${cohortId ?? ""}`;
    let live = byScope.get(key);
    if (!live) {
      const { rows } = await loadChecklist(c, programId, cohortId);
      live = rows.filter((r) => r.active === 1);
      byScope.set(key, live);
    }
    return live;
  }

  const statements = [];
  for (const signup of signups) {
    const live = await checklistFor(signup.program_id, signup.cohort_id);
    const liveIds = new Set(live.map((r) => r.id));
    const { results: held } = await c.env.DB.prepare(
      "SELECT id, required_document_id, status FROM signup_documents WHERE signup_id = ?",
    )
      .bind(signup.id)
      .all<{ id: string; required_document_id: string | null; status: DocumentStatus }>();
    const heldIds = new Set(held.map((h) => h.required_document_id).filter(Boolean));

    for (const item of live) {
      if (heldIds.has(item.id)) continue;
      statements.push(
        c.env.DB.prepare(
          "INSERT INTO signup_documents (id, signup_id, required_document_id, name, note, status, sort_order) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
        ).bind(
          `sd_${crypto.randomUUID().slice(0, 12)}`,
          signup.id,
          item.id,
          item.name,
          item.note,
          item.mandatory === 1 ? "awaiting" : "not_requested",
          item.sort_order,
        ),
      );
    }
    for (const h of held) {
      if (h.required_document_id === null) continue; // ad hoc — the team's own
      if (liveIds.has(h.required_document_id)) continue;
      if (h.status !== "not_requested") continue; // already asked for; keep it
      statements.push(
        c.env.DB.prepare("DELETE FROM signup_documents WHERE id = ?").bind(h.id),
      );
    }
  }
  if (statements.length > 0) await c.env.DB.batch(statements);
  for (const signup of signups) await syncRollUp(c, signup.id);
  return signups.length;
}

// ═══════════════════════════════════════════════════════════════════════════
// The lifecycle
// ═══════════════════════════════════════════════════════════════════════════

interface DocRow {
  id: string;
  signup_id: string;
  name: string;
  status: DocumentStatus;
  waived: number;
  deck_name: string;
}

async function loadDoc(c: Context<AppEnv>, signupId: string, docId: string): Promise<DocRow | null> {
  return c.env.DB.prepare(
    "SELECT sd.id AS id, sd.signup_id AS signup_id, sd.name AS name, sd.status AS status, " +
      "sd.waived AS waived, d.name AS deck_name " +
      "FROM signup_documents sd JOIN signups s ON s.id = sd.signup_id " +
      "JOIN decks d ON d.id = s.deck_id " +
      "WHERE sd.id = ? AND sd.signup_id = ? AND d.edition = ?",
  )
    .bind(docId, signupId, c.var.user.edition)
    .first<DocRow>();
}

/**
 * PATCH /api/signup-config/signups/:signupId/documents/:docId — move ONE item.
 *
 * The only write in this file that refuses on a state machine: an illegal
 * transition is a `400 illegal_transition` naming both ends, never a silent
 * write that leaves the record claiming a document was verified without ever
 * having been submitted.
 */
signupConfig.patch("/signups/:signupId/documents/:docId", async (c) => {
  const doc = await loadDoc(c, c.req.param("signupId"), c.req.param("docId"));
  if (!doc) return c.json({ error: "not_found" }, 404);
  const body = await readBody<{ status: DocumentStatus; waived: boolean; waivedReason: string }>(c);

  // ── Waive / un-waive ──────────────────────────────────────────────────────
  if (typeof body.waived === "boolean" && body.status === undefined) {
    if (body.waived) {
      const reason = cleanText(body.waivedReason, MAX_REASON_LENGTH);
      if (!reason) return c.json({ error: "reason_required" }, 400);
      await c.env.DB.prepare(
        "UPDATE signup_documents SET waived = 1, waived_reason = ? WHERE id = ?",
      )
        .bind(reason, doc.id)
        .run();
      await auditConfig(c, "signup_document_waived", `${doc.name} waived for ${doc.deck_name}`, {
        targetType: "signup_documents",
        targetId: doc.id,
        detail: { reason },
      });
    } else {
      await c.env.DB.prepare(
        "UPDATE signup_documents SET waived = 0, waived_reason = NULL WHERE id = ?",
      )
        .bind(doc.id)
        .run();
      await auditConfig(c, "signup_document_unwaived", `${doc.name} waiver lifted for ${doc.deck_name}`, {
        targetType: "signup_documents",
        targetId: doc.id,
      });
    }
    await syncRollUp(c, doc.signup_id);
    return c.json({ ok: true, document: await reloadDoc(c, doc.signup_id, doc.id) });
  }

  // ── Transition ────────────────────────────────────────────────────────────
  if (!isDocumentStatus(body.status)) return c.json({ error: "unknown_status" }, 400);
  if (doc.waived === 1) return c.json({ error: "document_waived" }, 400);
  if (!canTransitionDocument(doc.status, body.status)) {
    return c.json(
      { error: "illegal_transition", from: doc.status, to: body.status },
      400,
    );
  }
  await applyTransition(c, doc.id, body.status);
  await auditConfig(
    c,
    "signup_document_status",
    `${doc.name} for ${doc.deck_name}: ${doc.status} → ${body.status}`,
    { targetType: "signup_documents", targetId: doc.id, detail: { from: doc.status, to: body.status } },
  );
  await syncRollUp(c, doc.signup_id);
  return c.json({ ok: true, document: await reloadDoc(c, doc.signup_id, doc.id) });
});

/**
 * `verified_at` / `verified_by` are set on the way in and cleared on the way
 * out, which is what `0034`'s `CHECK (status <> 'verified' OR verified_at IS NOT
 * NULL)` insists on. Only `submitted → verified` sets them, and `verified` is
 * terminal, so the clearing branch exists for the moves that leave the earlier
 * states — it never un-verifies anything.
 */
function applyTransition(c: Context<AppEnv>, docId: string, to: DocumentStatus): Promise<unknown> {
  if (to === "verified") {
    return c.env.DB.prepare(
      "UPDATE signup_documents SET status = 'verified', verified_by = ?, verified_at = datetime('now') WHERE id = ?",
    )
      .bind(c.var.user.id, docId)
      .run();
  }
  return c.env.DB.prepare(
    "UPDATE signup_documents SET status = ?, verified_by = NULL, verified_at = NULL WHERE id = ?",
  )
    .bind(to, docId)
    .run();
}

async function reloadDoc(
  c: Context<AppEnv>,
  signupId: string,
  docId: string,
): Promise<SignupDocumentView | null> {
  const row = await c.env.DB.prepare(
    "SELECT sd.id AS doc_id, sd.signup_id AS signup_id, sd.name AS name, sd.note AS note, " +
      "sd.status AS status, sd.waived AS waived, sd.waived_reason AS waived_reason, " +
      "sd.verified_at AS verified_at, rd.mandatory AS mandatory, sd.sort_order AS sort_order " +
      "FROM signup_documents sd LEFT JOIN required_documents rd ON rd.id = sd.required_document_id " +
      "WHERE sd.id = ? AND sd.signup_id = ?",
  )
    .bind(docId, signupId)
    .first<SignupDocRow>();
  return row ? toDocumentView(row) : null;
}

/**
 * POST /api/signup-config/signups/:signupId/documents/verify-all — the spec's
 * **"Verify all" bulk action** (§8.3, both editions).
 *
 * It advances exactly the items that CAN advance — every `submitted`, unwaived
 * item — and reports what it moved and what it could not. An item still
 * `awaiting` is not verified by a bulk action: that would be the skip the state
 * machine exists to refuse, applied wholesale. With nothing to move, `moved`
 * is 0 and nothing is written; the section disables the button in that state.
 */
signupConfig.post("/signups/:signupId/documents/verify-all", async (c) => {
  const signupId = c.req.param("signupId");
  const signup = await c.env.DB.prepare(
    "SELECT s.id AS id, d.name AS deck_name FROM signups s JOIN decks d ON d.id = s.deck_id " +
      "WHERE s.id = ? AND d.edition = ?",
  )
    .bind(signupId, c.var.user.edition)
    .first<{ id: string; deck_name: string }>();
  if (!signup) return c.json({ error: "not_found" }, 404);

  const { results } = await c.env.DB.prepare(
    "SELECT id, status, waived FROM signup_documents WHERE signup_id = ? ORDER BY sort_order, rowid",
  )
    .bind(signupId)
    .all<{ id: string; status: DocumentStatus; waived: number }>();

  const movable = results.filter(
    (r) => r.waived === 0 && canTransitionDocument(r.status, "verified"),
  );
  const blocked = results.filter(
    (r) => r.waived === 0 && r.status !== "verified" && !canTransitionDocument(r.status, "verified"),
  ).length;

  if (movable.length > 0) {
    await c.env.DB.batch(
      movable.map((r) =>
        c.env.DB.prepare(
          "UPDATE signup_documents SET status = 'verified', verified_by = ?, verified_at = datetime('now') WHERE id = ?",
        ).bind(c.var.user.id, r.id),
      ),
    );
    await auditConfig(
      c,
      "signup_documents_verified",
      `Verified all documents for ${signup.deck_name}: ${movable.length} items`,
      { targetType: "signups", targetId: signupId, detail: { moved: movable.length, blocked } },
    );
    await syncRollUp(c, signupId);
  }
  return c.json({ ok: true, moved: movable.length, blocked });
});

// ═══════════════════════════════════════════════════════════════════════════
// Seat capacity (incubator)
// ═══════════════════════════════════════════════════════════════════════════

/** `s-suseat` is not in the VC rail — serving it would be a phantom capability. */
function requireIncubator(c: Context<AppEnv>): Response | null {
  return c.var.user.edition === "incubator"
    ? null
    : c.json({ error: "wrong_edition", section: "suseat" }, 403);
}

function requireVc(c: Context<AppEnv>): Response | null {
  return c.var.user.edition === "vc"
    ? null
    : c.json({ error: "wrong_edition", section: "sufund" }, 403);
}

interface SeatRowDb {
  cohort_id: string;
  cohort_name: string;
  program_id: string;
  program_name: string;
  seat_capacity: number;
  seats_filled: number;
}

/**
 * Every active cohort of the edition, whether or not it has a seat count —
 * because every cohort HAS a capacity, and a table that listed only the
 * configured ones would hide the cohort an admin most needs to configure. The
 * row label is the prototype's "Accelerator · Cohort 8": programme, then batch.
 */
async function loadSeatRows(c: Context<AppEnv>): Promise<SeatRowView[]> {
  const { results } = await c.env.DB.prepare(
    "SELECT c.id AS cohort_id, c.name AS cohort_name, p.id AS program_id, p.name AS program_name, " +
      "c.seat_capacity AS seat_capacity, c.seats_filled AS seats_filled " +
      "FROM cohorts c JOIN programs p ON p.id = c.program_id " +
      "WHERE p.edition = ? AND c.active = 1 AND p.active = 1 " +
      "ORDER BY p.sort_order, p.name, c.sort_order, c.name",
  )
    .bind(c.var.user.edition)
    .all<SeatRowDb>();
  return results.map((r) => {
    const row = {
      name: `${r.program_name} · ${r.cohort_name}`,
      capacity: r.seat_capacity,
      filled: r.seats_filled,
    };
    const { pct, over } = seatRowState(row);
    return {
      ...row,
      cohortId: r.cohort_id,
      programId: r.program_id,
      programName: r.program_name,
      cohortName: r.cohort_name,
      utilisation: pct,
      over,
      remaining: seatsRemaining(row),
    };
  });
}

/** The sign-ups the seatless callout counts, with enough to allocate from. */
async function loadSeatless(c: Context<AppEnv>) {
  const { results } = await c.env.DB.prepare(
    "SELECT s.id AS signup_id, d.name AS startup, s.status AS status, " +
      "co.id AS cohort_id, co.name AS cohort_name, p.name AS program_name " +
      "FROM signups s JOIN decks d ON d.id = s.deck_id " +
      "LEFT JOIN cohorts co ON co.id = d.cohort_id " +
      "LEFT JOIN programs p ON p.id = d.program_id " +
      "WHERE d.edition = ? AND s.seatless = 1 AND s.seat_allocated_at IS NULL " +
      "ORDER BY s.completed_at DESC, s.id",
  )
    .bind(c.var.user.edition)
    .all<{
      signup_id: string;
      startup: string;
      status: string;
      cohort_id: string | null;
      cohort_name: string | null;
      program_name: string | null;
    }>();
  return results.map((r) => ({
    signupId: r.signup_id,
    startup: r.startup,
    status: r.status,
    cohortId: r.cohort_id,
    cohortName: r.cohort_name,
    programName: r.program_name,
  }));
}

signupConfig.get("/seats", async (c) => {
  const wrong = requireIncubator(c);
  if (wrong) return wrong;
  const rows = await loadSeatRows(c);
  const seatless = await loadSeatless(c);
  return c.json({
    rows,
    note: seatNote(rows),
    seatless,
    seatlessNote: seatlessNote(seatless.length),
  });
});

/**
 * PUT /api/signup-config/seats — save the table.
 *
 * `filled` is writable because the prototype makes it writable: an incubator
 * that has been running cohorts off-platform has a real filled count that no
 * allocation history in this database can reconstruct. Once allocation happens
 * here, `POST …/seat` maintains it. Over-capacity is **accepted** and reported,
 * never refused — §1.2's lesson in the other direction: the prototype is right
 * that seats do not gate sign-up.
 */
signupConfig.put("/seats", async (c) => {
  const wrong = requireIncubator(c);
  if (wrong) return wrong;
  const body = await readBody<{
    rows: { cohortId: string; capacity: number; filled: number }[];
  }>(c);
  if (!Array.isArray(body.rows)) return c.json({ error: "rows_required" }, 400);

  const known = new Map((await loadSeatRows(c)).map((r) => [r.cohortId, r]));
  const parsed: { cohortId: string; capacity: number; filled: number; name: string }[] = [];
  for (const raw of body.rows) {
    const row = typeof raw?.cohortId === "string" ? known.get(raw.cohortId) : undefined;
    if (!row) return c.json({ error: "unknown_cohort" }, 400);
    const cap = validSeats(raw.capacity);
    const filled = validSeats(raw.filled);
    if (!cap.ok || !filled.ok) return c.json({ error: "invalid_seats" }, 400);
    parsed.push({ cohortId: row.cohortId, capacity: cap.value, filled: filled.value, name: row.name });
  }

  const changed = parsed.filter((p) => {
    const before = known.get(p.cohortId)!;
    return before.capacity !== p.capacity || before.filled !== p.filled;
  });
  if (changed.length > 0) {
    await c.env.DB.batch(
      changed.map((p) =>
        c.env.DB.prepare("UPDATE cohorts SET seat_capacity = ?, seats_filled = ? WHERE id = ?").bind(
          p.capacity,
          p.filled,
          p.cohortId,
        ),
      ),
    );
    await auditConfig(
      c,
      "seat_capacity_saved",
      `Seat capacity updated: ${changed
        .map((p) => `${p.name} ${p.filled}/${p.capacity}`)
        .join(", ")}`,
      { targetType: "cohorts", targetId: changed.map((p) => p.cohortId).join(",") },
    );
    // A capacity edit can free or exhaust seats, so the flag is re-derived
    // against the numbers that now hold rather than the ones that did.
    await reconcileSeatless(c);
  }

  const rows = await loadSeatRows(c);
  const seatless = await loadSeatless(c);
  return c.json({
    ok: true,
    saved: changed.length,
    rows,
    note: seatNote(rows),
    seatless,
    seatlessNote: seatlessNote(seatless.length),
  });
});

/**
 * `0036`'s rule, applied to today's numbers: a sign-up past the finish line
 * with no seat of its own is seatless while its cohort has none free. A deck
 * with no cohort at all is seatless too — there is no batch to seat it in,
 * which is precisely the case the pipeline needs flagged.
 *
 * **It only ever RAISES the flag.** Clearing it is `POST …/seat`'s job and
 * nothing else's. Narrowing a cohort can strand a startup that had a seat
 * coming, so the flag must follow; widening one does NOT un-strand anybody,
 * because a seat is not allocated until somebody allocates it — the prototype's
 * action provisions founder access, which must never happen as a side effect of
 * an admin typing a bigger number. Lowering the flag here instead would leave
 * the record neither flagged nor seated: gone from the allocation queue while
 * holding no seat, which is the invisibility F0011 exists to end.
 */
async function reconcileSeatless(c: Context<AppEnv>): Promise<void> {
  await c.env.DB.prepare(
    "UPDATE signups SET seatless = 1 " +
      "WHERE seat_allocated_at IS NULL " +
      "  AND status IN ('completed', 'onboarded') " +
      "  AND deck_id IN (SELECT id FROM decks WHERE edition = ?) " +
      "  AND NOT EXISTS (" +
      "    SELECT 1 FROM decks d JOIN cohorts co ON co.id = d.cohort_id " +
      "    WHERE d.id = signups.deck_id AND co.seats_filled < co.seat_capacity" +
      "  )",
  )
    .bind(c.var.user.edition)
    .run();
}

/**
 * POST /api/signup-config/signups/:signupId/complete — finish sign-up, and
 * resolve the seat.
 *
 * This is the transition the `seatless` flag hangs off. `s-suseat.html`:
 * *"Sign-up is never blocked by seats — startups that complete without one are
 * flagged seatless so the team can allocate a seat and founder access from the
 * pipeline."* So completing NEVER fails for want of a seat; it takes a free
 * one if the cohort has it, and raises the flag if it does not.
 *
 * The status move itself is guarded: only `progress → completed` is legal here
 * (`0034`'s funnel), and anything else is a 400 rather than a silent write.
 */
signupConfig.post("/signups/:signupId/complete", async (c) => {
  const wrong = requireIncubator(c);
  if (wrong) return wrong;
  const signupId = c.req.param("signupId");
  const row = await c.env.DB.prepare(
    "SELECT s.id AS id, s.status AS status, s.seat_allocated_at AS seat_allocated_at, " +
      "d.name AS startup, d.cohort_id AS cohort_id " +
      "FROM signups s JOIN decks d ON d.id = s.deck_id WHERE s.id = ? AND d.edition = ?",
  )
    .bind(signupId, c.var.user.edition)
    .first<{
      id: string;
      status: string;
      seat_allocated_at: string | null;
      startup: string;
      cohort_id: string | null;
    }>();
  if (!row) return c.json({ error: "not_found" }, 404);
  if (row.status !== "progress") {
    return c.json({ error: "illegal_transition", from: row.status, to: "completed" }, 400);
  }

  const cohort = row.cohort_id
    ? await c.env.DB.prepare("SELECT id, name, seat_capacity, seats_filled FROM cohorts WHERE id = ?")
        .bind(row.cohort_id)
        .first<{ id: string; name: string; seat_capacity: number; seats_filled: number }>()
    : null;
  const free = cohort !== null && cohort.seats_filled < cohort.seat_capacity;

  // Two statements rather than one bound flag, so `seat_allocated_at` is
  // written by SQLite's own clock like every other timestamp in the schema.
  const statements = free
    ? [
        c.env.DB.prepare(
          "UPDATE signups SET status = 'completed', completed_at = datetime('now'), " +
            "seatless = 0, seat_allocated_at = datetime('now') WHERE id = ?",
        ).bind(row.id),
        c.env.DB.prepare("UPDATE cohorts SET seats_filled = seats_filled + 1 WHERE id = ?").bind(
          cohort!.id,
        ),
      ]
    : [
        c.env.DB.prepare(
          "UPDATE signups SET status = 'completed', completed_at = datetime('now'), " +
            "seatless = 1, seat_allocated_at = NULL WHERE id = ?",
        ).bind(row.id),
      ];
  await c.env.DB.batch(statements);

  await auditConfig(
    c,
    free ? "signup_completed_seated" : "signup_completed_seatless",
    free
      ? `${row.startup} completed sign-up · seat allocated in ${cohort!.name}`
      : `${row.startup} completed sign-up with no cohort seat — flagged seatless`,
    { targetType: "signups", targetId: row.id, detail: { seatless: !free } },
  );
  return c.json({ ok: true, status: "completed", seatless: !free, seated: free });
});

/**
 * POST /api/signup-config/signups/:signupId/seat — the pipeline's **Allocate
 * seat** (`suAllocSeat`), which clears the flag and, in the prototype, moves
 * the record to onboarded with founder access provisioned.
 *
 * Allocating past capacity is allowed: the alternative is refusing to seat a
 * startup that has already signed, which is the block `s-suseat.html` rules
 * out. The over-capacity row is what `seatNote` then reports.
 */
signupConfig.post("/signups/:signupId/seat", async (c) => {
  const wrong = requireIncubator(c);
  if (wrong) return wrong;
  const signupId = c.req.param("signupId");
  const row = await c.env.DB.prepare(
    "SELECT s.id AS id, s.status AS status, s.seat_allocated_at AS seat_allocated_at, " +
      "d.name AS startup, d.cohort_id AS cohort_id " +
      "FROM signups s JOIN decks d ON d.id = s.deck_id WHERE s.id = ? AND d.edition = ?",
  )
    .bind(signupId, c.var.user.edition)
    .first<{
      id: string;
      status: string;
      seat_allocated_at: string | null;
      startup: string;
      cohort_id: string | null;
    }>();
  if (!row) return c.json({ error: "not_found" }, 404);
  if (row.seat_allocated_at !== null) return c.json({ error: "already_seated" }, 400);
  // A seat is a place in a cohort that has finished signing up for it.
  if (row.status !== "completed" && row.status !== "onboarded") {
    return c.json({ error: "not_completed", status: row.status }, 400);
  }
  if (!row.cohort_id) return c.json({ error: "no_cohort" }, 400);

  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE signups SET seatless = 0, seat_allocated_at = datetime('now'), status = 'onboarded' WHERE id = ?",
    ).bind(row.id),
    c.env.DB.prepare("UPDATE cohorts SET seats_filled = seats_filled + 1 WHERE id = ?").bind(
      row.cohort_id,
    ),
  ]);
  const cohort = await c.env.DB.prepare(
    "SELECT name, seat_capacity, seats_filled FROM cohorts WHERE id = ?",
  )
    .bind(row.cohort_id)
    .first<{ name: string; seat_capacity: number; seats_filled: number }>();
  const over = cohort !== null && cohort.seats_filled > cohort.seat_capacity;

  await auditConfig(
    c,
    "seat_allocated",
    `Seat allocated to ${row.startup} in ${cohort?.name ?? "cohort"}` +
      (over ? ` · now over capacity (${cohort!.seats_filled}/${cohort!.seat_capacity})` : ""),
    { targetType: "signups", targetId: row.id, detail: { over } },
  );
  return c.json({ ok: true, seated: true, over, status: "onboarded" });
});

// ═══════════════════════════════════════════════════════════════════════════
// Fund Deployment (VC)
// ═══════════════════════════════════════════════════════════════════════════

interface FundRowDb {
  id: string;
  name: string;
  fund_size: number | null;
  fund_allocated: number | null;
  capital_deployed: number | null;
  fund_unutilised: number | null;
}

function toFundView(r: FundRowDb): FundRowView {
  const row: FundRow = {
    name: r.name,
    allotted: r.fund_allocated,
    deployed: r.capital_deployed,
    unutilised: r.fund_unutilised,
  };
  return {
    ...row,
    programId: r.id,
    utilisation: fundUtilisation(row),
    reconcileDelta: fundReconcileDelta(row),
    reconciles: fundReconciles(row),
  };
}

async function loadFundRows(c: Context<AppEnv>): Promise<FundRowView[]> {
  const { results } = await c.env.DB.prepare(
    "SELECT id, name, fund_size, fund_allocated, capital_deployed, fund_unutilised " +
      "FROM programs WHERE edition = 'vc' AND active = 1 ORDER BY sort_order, name",
  ).all<FundRowDb>();
  return results.map(toFundView);
}

signupConfig.get("/fund", async (c) => {
  const wrong = requireVc(c);
  if (wrong) return wrong;
  const rows = await loadFundRows(c);
  return c.json({ rows, recon: fundReconcileNote(rows), totals: fundTotals(rows) });
});

/** The figures the Capital Deployment & Pacing report reads, summed once here. */
function fundTotals(rows: FundRowView[]) {
  const sum = (pick: (r: FundRowView) => number | null) =>
    rows.reduce((n, r) => n + (pick(r) ?? 0), 0);
  const allotted = sum((r) => r.allotted);
  const deployed = sum((r) => r.deployed);
  return {
    allotted: Math.round(allotted * 100) / 100,
    deployed: Math.round(deployed * 100) / 100,
    unutilised: Math.round(sum((r) => r.unutilised) * 100) / 100,
    utilisation: fundUtilisation({ allotted, deployed }),
  };
}

/**
 * PUT /api/signup-config/fund — save the deployment table.
 *
 * The reconciliation is **advisory**, exactly as `fdRecon` is: the section
 * warns, the save succeeds, and the offending rows come back named in `recon`.
 * Refusing the save would strand an admin who has one true figure and one they
 * are still chasing — and the report needs the true one now.
 *
 * A row with `allotted: null` is cleared rather than zeroed. That is the
 * prototype's Remove, translated: a programme is not deleted by editing a
 * deployment table, its figures are withdrawn, and it drops out of the report
 * the way 0012 leaves Deep Tech Fund out.
 */
signupConfig.put("/fund", async (c) => {
  const wrong = requireVc(c);
  if (wrong) return wrong;
  const body = await readBody<{
    rows: { programId: string; allotted: unknown; deployed: unknown; unutilised: unknown }[];
  }>(c);
  if (!Array.isArray(body.rows)) return c.json({ error: "rows_required" }, 400);

  const known = new Map((await loadFundRows(c)).map((r) => [r.programId, r]));
  const parsed: {
    programId: string;
    name: string;
    allotted: number | null;
    deployed: number | null;
    unutilised: number | null;
  }[] = [];
  for (const raw of body.rows) {
    const row = typeof raw?.programId === "string" ? known.get(raw.programId) : undefined;
    if (!row) return c.json({ error: "unknown_program" }, 400);
    const allotted = validCr(raw.allotted);
    const deployed = validCr(raw.deployed);
    const unutilised = validCr(raw.unutilised);
    if (!allotted.ok || !deployed.ok || !unutilised.ok) {
      return c.json({ error: "invalid_fund" }, 400);
    }
    parsed.push({
      programId: row.programId,
      name: row.name,
      allotted: allotted.value,
      deployed: deployed.value,
      unutilised: unutilised.value,
    });
  }

  const changed = parsed.filter((p) => {
    const b = known.get(p.programId)!;
    return b.allotted !== p.allotted || b.deployed !== p.deployed || b.unutilised !== p.unutilised;
  });
  if (changed.length > 0) {
    await c.env.DB.batch(
      changed.map((p) =>
        c.env.DB.prepare(
          "UPDATE programs SET fund_allocated = ?, capital_deployed = ?, fund_unutilised = ? " +
            "WHERE id = ? AND edition = 'vc'",
        ).bind(p.allotted, p.deployed, p.unutilised, p.programId),
      ),
    );
    await auditConfig(
      c,
      "fund_deployment_saved",
      `Fund deployment updated: ${changed
        .map((p) => `${p.name} ${p.deployed ?? 0}/${p.allotted ?? 0} Cr deployed`)
        .join(", ")}`,
      { targetType: "programs", targetId: changed.map((p) => p.programId).join(",") },
    );
  }

  const rows = await loadFundRows(c);
  return c.json({
    ok: true,
    saved: changed.length,
    rows,
    recon: fundReconcileNote(rows),
    totals: fundTotals(rows),
  });
});

export default signupConfig;
