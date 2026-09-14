/**
 * W9-C — `/api/diligence`: the VC edition's diligence-to-close record
 * (migration 0063, rules in `src/shared/diligence.ts`).
 *
 * The screens it serves — Investment DD, IC Pipeline, Term sheet Pipeline,
 * Legal DD and the IC member's Invest ready — all read ONE list (`GET /`), one
 * `DealView` per deal, and write through five narrow verbs, each behind the
 * permission task that screen already carries:
 *
 *   PATCH /:deckId/checklist/:track/:itemId   `openchecklist`  one item's fields
 *   PUT   /:deckId/mp-approval                `mpapproval`     Approved / Not approved
 *   PUT   /:deckId/deal                       `openchecklist`  row status, leads, ask, pre-money
 *   PUT   /:deckId/term-sheet                 `signup`         Drafted / Issued / Signed / Declined
 *   POST  /:deckId/term-sheet/attach          `signup`         a template from the Agreements library
 *
 * Why not `signup_documents` (plan §8 Q141). That table is the §8.3 DOCUMENT
 * lifecycle — not_requested → awaiting → submitted → verified — keyed by a
 * `signups` row, which a pre-IC deal does not have and should not be given. The
 * prototype's checklists are a diligence work log: a status, an owner, a rating
 * and a finding per item. Neither router over `signup_documents` has a verb for
 * that, and bending the document state machine to carry "Flagged / Concern"
 * would break the one rule W5-A made it for.
 *
 * VC only: the incubator has no diligence stages and is refused with
 * `wrong_edition`, the shape `signup-config.ts` uses for its edition-scoped
 * sections.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../types";
import type { Role } from "../../shared/roles";
import { requireAuth, requireTask } from "../auth/middleware";
import { auditConfig } from "../audit/events";
import {
  INVESTMENT_TRACK_STAGES,
  LEGAL_TRACK_STAGES,
  MAX_DD_FINDING,
  MAX_DD_LABEL,
  MAX_DD_OWNER,
  MAX_DEAL_FIGURE,
  RENAMEABLE_TRACKS,
  TERM_SHEET_STAGES,
  TRACK_ITEMS,
  deriveMpApproval,
  deriveRowStatus,
  isDdItemStatus,
  isDdRating,
  isDdRowStatus,
  isMpApproval,
  isTermSheetStatus,
  isTrack,
  summarise,
  termSheetVersion,
  trackOpenAt,
  type DdItemStatus,
  type DdItemView,
  type DdRating,
  type DdRowStatus,
  type DdSummary,
  type DealView,
  type DiligenceTrack,
  type MpApproval,
  type TermSheetStatus,
} from "../../shared/diligence";

const diligence = new Hono<AppEnv>();
diligence.use("*", requireAuth);
diligence.use("*", async (c, next) => {
  if (c.var.user.edition !== "vc") return c.json({ error: "wrong_edition" }, 403);
  await next();
});

/** Every stage a `DealView` is served for — the union of what the five screens list. */
const DEAL_STAGES: readonly string[] = INVESTMENT_TRACK_STAGES;

/** The staff who reach at least one of the five screens (`nav.ts` Due Diligence). */
const DEAL_READERS: Role[] = ["admin", "partner", "ic_member"];
const DEAL_READ_TASKS = ["openchecklist", "icpipeline", "signup", "onboard"];

async function readBody<T>(c: Context<AppEnv>): Promise<Partial<T>> {
  return (await c.req.json().catch(() => ({}))) as Partial<T>;
}

/**
 * An optional free-text field: `undefined` means "not in this request", `null`
 * means "clear it", a string is the new value. Too long is `false` — refused.
 */
function optionalText(raw: unknown, max: number): string | null | undefined | false {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "string") return false;
  const text = raw.trim().replace(/\s+/g, " ");
  if (!text) return null;
  return text.length > max ? false : text;
}

/** Findings keep their line breaks; only the ends are trimmed. */
function optionalProse(raw: unknown, max: number): string | null | undefined | false {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "string") return false;
  const text = raw.trim();
  if (!text) return null;
  return text.length > max ? false : text;
}

interface DeckRow {
  id: string;
  name: string;
  status: string;
}

async function loadDeck(c: Context<AppEnv>): Promise<DeckRow | null> {
  return c.env.DB.prepare("SELECT id, name, status FROM decks WHERE id = ? AND edition = 'vc'")
    .bind(c.req.param("deckId") ?? "")
    .first<DeckRow>();
}

// ═══════════════════════════════════════════════════════════════════════════
// Materialising the checklists
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Give every deal at a stage that carries a track the prototype's items for it,
 * at `not_started`. Idempotent on `UNIQUE (deck_id, track, sort_order)`: a slot
 * that already exists — renamed, moved, anything — is never touched.
 */
async function ensureItems(c: Context<AppEnv>, deckIds?: string[]): Promise<void> {
  const tracks: [DiligenceTrack, readonly string[]][] = [
    ["investment", INVESTMENT_TRACK_STAGES],
    ["legal", LEGAL_TRACK_STAGES],
  ];
  const stmts: D1PreparedStatement[] = [];
  for (const [track, stages] of tracks) {
    const scope = deckIds ? ` AND d.id IN (${deckIds.map(() => "?").join(", ")})` : "";
    const { results } = await c.env.DB.prepare(
      `SELECT d.id FROM decks d WHERE d.edition = 'vc' AND d.status IN (${stages.map(() => "?").join(", ")})${scope} ` +
        "AND (SELECT COUNT(*) FROM dd_items i WHERE i.deck_id = d.id AND i.track = ?) < ?",
    )
      .bind(...stages, ...(deckIds ?? []), track, TRACK_ITEMS[track].length)
      .all<{ id: string }>();
    for (const { id } of results) {
      TRACK_ITEMS[track].forEach((label, i) => {
        stmts.push(
          c.env.DB.prepare(
            "INSERT OR IGNORE INTO dd_items (id, deck_id, track, sort_order, label) VALUES (?, ?, ?, ?, ?)",
          ).bind(`ddi_${id}_${track}_${i + 1}`, id, track, i + 1, label),
        );
      });
    }
  }
  if (stmts.length > 0) await c.env.DB.batch(stmts);
}

// ═══════════════════════════════════════════════════════════════════════════
// Views
// ═══════════════════════════════════════════════════════════════════════════

interface ItemRow {
  id: string;
  deck_id: string;
  track: DiligenceTrack;
  sort_order: number;
  label: string;
  status: DdItemStatus;
  owner: string | null;
  rating: DdRating | null;
  finding: string | null;
  updated_at: string | null;
}

function toItemView(r: ItemRow): DdItemView {
  return {
    id: r.id,
    track: r.track,
    sortOrder: r.sort_order,
    label: r.label,
    defaultLabel: TRACK_ITEMS[r.track][r.sort_order - 1] ?? r.label,
    status: r.status,
    owner: r.owner,
    rating: r.rating,
    finding: r.finding,
    updatedAt: r.updated_at,
  };
}

interface DealRow {
  id: string;
  status: string;
  ask: string | null;
  valuation: string | null;
  mp_approval: MpApproval | null;
  dd_status: DdRowStatus | null;
  investment_lead: string | null;
  legal_lead: string | null;
  term_sheet_status: TermSheetStatus | null;
  term_sheet_file: string | null;
  template_name: string | null;
  template_version: string | null;
  partner_name: string | null;
  cleared_at: string | null;
  last_activity_at: string | null;
}

const DEAL_SELECT =
  "SELECT d.id, d.status, v.ask, v.valuation, v.mp_approval, v.dd_status, v.investment_lead, v.legal_lead, " +
  "v.term_sheet_status, v.term_sheet_file, t.name AS template_name, t.version AS template_version, " +
  // The deal's partner: whoever sponsored it to IC, else whoever issued its term sheet.
  "(SELECT u.name FROM pipeline_events pe JOIN users u ON u.id = pe.actor_id WHERE pe.deck_id = d.id " +
  "AND pe.action IN ('sponsor_to_ic', 'issue_term_sheet') ORDER BY CASE pe.action WHEN 'sponsor_to_ic' THEN 0 ELSE 1 END, " +
  "pe.created_at DESC, pe.rowid DESC LIMIT 1) AS partner_name, " +
  "(SELECT pe.created_at FROM pipeline_events pe WHERE pe.deck_id = d.id AND pe.action = 'invest' " +
  "ORDER BY pe.created_at DESC, pe.rowid DESC LIMIT 1) AS cleared_at, " +
  "COALESCE((SELECT MAX(pe.created_at) FROM pipeline_events pe WHERE pe.deck_id = d.id), d.updated_at, d.created_at) AS last_activity_at " +
  "FROM decks d LEFT JOIN vc_deals v ON v.deck_id = d.id " +
  "LEFT JOIN agreement_templates t ON t.id = v.term_sheet_template_id ";

async function loadSummaries(c: Context<AppEnv>, deckIds: string[]): Promise<Map<string, Record<DiligenceTrack, DdSummary>>> {
  const out = new Map<string, Record<DiligenceTrack, DdSummary>>();
  if (deckIds.length === 0) return out;
  const { results } = await c.env.DB.prepare(
    `SELECT deck_id, track, status FROM dd_items WHERE deck_id IN (${deckIds.map(() => "?").join(", ")})`,
  )
    .bind(...deckIds)
    .all<{ deck_id: string; track: DiligenceTrack; status: DdItemStatus }>();
  const grouped = new Map<string, Record<DiligenceTrack, { status: DdItemStatus }[]>>();
  for (const r of results) {
    const g = grouped.get(r.deck_id) ?? { investment: [], legal: [] };
    g[r.track].push({ status: r.status });
    grouped.set(r.deck_id, g);
  }
  for (const [id, g] of grouped) out.set(id, { investment: summarise(g.investment), legal: summarise(g.legal) });
  return out;
}

function toDealView(r: DealRow, s: Record<DiligenceTrack, DdSummary> | undefined): DealView {
  const investment = trackOpenAt("investment", r.status) ? (s?.investment ?? summarise([])) : null;
  const legal = trackOpenAt("legal", r.status) ? (s?.legal ?? summarise([])) : null;
  return {
    deckId: r.id,
    stage: r.status,
    investment,
    legal,
    mpApproval: deriveMpApproval(r.mp_approval, investment),
    mpApprovalSet: r.mp_approval !== null,
    ddStatus: deriveRowStatus(r.dd_status, investment),
    investmentLead: r.investment_lead,
    legalLead: r.legal_lead,
    ask: r.ask,
    valuation: r.valuation,
    partnerName: r.partner_name,
    clearedAt: r.cleared_at,
    lastActivityAt: r.last_activity_at,
    termSheet: {
      status: r.term_sheet_status,
      doc: r.term_sheet_file
        ? {
            fileName: r.term_sheet_file,
            templateName: r.template_name,
            templateVersion: r.template_version,
            version: termSheetVersion(r.term_sheet_status),
          }
        : null,
    },
  };
}

async function dealView(c: Context<AppEnv>, deckId: string): Promise<DealView | null> {
  const row = await c.env.DB.prepare(`${DEAL_SELECT} WHERE d.id = ? AND d.edition = 'vc'`).bind(deckId).first<DealRow>();
  if (!row) return null;
  return toDealView(row, (await loadSummaries(c, [deckId])).get(deckId));
}

async function upsertDeal(c: Context<AppEnv>, deckId: string, fields: Record<string, string | null>): Promise<void> {
  const cols = Object.keys(fields);
  if (cols.length === 0) return;
  const ts = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO vc_deals (deck_id, ${cols.join(", ")}, updated_at, updated_by) VALUES (?, ${cols.map(() => "?").join(", ")}, ?, ?) ` +
      `ON CONFLICT (deck_id) DO UPDATE SET ${cols.map((k) => `${k} = excluded.${k}`).join(", ")}, ` +
      "updated_at = excluded.updated_at, updated_by = excluded.updated_by",
  )
    .bind(deckId, ...cols.map((k) => fields[k]), ts, c.var.user.id)
    .run();
}

// ═══════════════════════════════════════════════════════════════════════════
// Reads
// ═══════════════════════════════════════════════════════════════════════════

/** GET /api/diligence — one `DealView` per deal from Investment DD to close. */
diligence.get("/", async (c) => {
  const user = c.var.user;
  if (user.role !== "superuser" && !DEAL_READERS.includes(user.role)) return c.json({ error: "forbidden" }, 403);
  let allowed = false;
  for (const task of DEAL_READ_TASKS) if (!allowed && (await c.var.perms.can(task))) allowed = true;
  if (!allowed) return c.json({ error: "forbidden" }, 403);

  await ensureItems(c);
  const { results } = await c.env.DB.prepare(
    `${DEAL_SELECT} WHERE d.edition = 'vc' AND d.status IN (${DEAL_STAGES.map(() => "?").join(", ")}) ORDER BY d.name, d.id`,
  )
    .bind(...DEAL_STAGES)
    .all<DealRow>();
  const summaries = await loadSummaries(c, results.map((r) => r.id));
  return c.json({ deals: results.map((r) => toDealView(r, summaries.get(r.id))) });
});

const checklistTask = requireTask("openchecklist", "admin", "partner", "ic_member");

/** GET /api/diligence/:deckId/checklist/:track — the items behind `ddOpen` / `ldOpen`. */
diligence.get("/:deckId/checklist/:track", checklistTask, async (c) => {
  const track = c.req.param("track");
  if (!isTrack(track)) return c.json({ error: "unknown_track" }, 404);
  const deck = await loadDeck(c);
  if (!deck) return c.json({ error: "not_found" }, 404);
  if (!trackOpenAt(track, deck.status)) return c.json({ error: "track_not_open", stage: deck.status }, 409);

  await ensureItems(c, [deck.id]);
  const { results } = await c.env.DB.prepare(
    "SELECT id, deck_id, track, sort_order, label, status, owner, rating, finding, updated_at " +
      "FROM dd_items WHERE deck_id = ? AND track = ? ORDER BY sort_order",
  )
    .bind(deck.id, track)
    .all<ItemRow>();
  const items = results.map(toItemView);
  return c.json({
    deckId: deck.id,
    startup: deck.name,
    track,
    items,
    summary: summarise(items),
    renameable: RENAMEABLE_TRACKS.includes(track),
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Writes
// ═══════════════════════════════════════════════════════════════════════════

/**
 * PATCH /api/diligence/:deckId/checklist/:track/:itemId — `ddSet` / `ldSet`.
 * Any subset of `{status, owner, rating, finding, label}`; a field that is
 * present and invalid refuses the whole request, and nothing is written.
 */
diligence.patch("/:deckId/checklist/:track/:itemId", checklistTask, async (c) => {
  const track = c.req.param("track");
  if (!isTrack(track)) return c.json({ error: "unknown_track" }, 404);
  const deck = await loadDeck(c);
  if (!deck) return c.json({ error: "not_found" }, 404);
  if (!trackOpenAt(track, deck.status)) return c.json({ error: "track_not_open", stage: deck.status }, 409);
  const item = await c.env.DB.prepare(
    "SELECT id, deck_id, track, sort_order, label, status, owner, rating, finding, updated_at " +
      "FROM dd_items WHERE id = ? AND deck_id = ? AND track = ?",
  )
    .bind(c.req.param("itemId"), deck.id, track)
    .first<ItemRow>();
  if (!item) return c.json({ error: "not_found" }, 404);

  const body = await readBody<{ status: unknown; owner: unknown; rating: unknown; finding: unknown; label: unknown }>(c);
  const set: Record<string, string | null> = {};

  if (body.status !== undefined) {
    if (!isDdItemStatus(body.status)) return c.json({ error: "invalid_status" }, 400);
    set.status = body.status;
  }
  if (body.rating !== undefined) {
    if (body.rating !== null && !isDdRating(body.rating)) return c.json({ error: "invalid_rating" }, 400);
    set.rating = body.rating as DdRating | null;
  }
  const owner = optionalText(body.owner, MAX_DD_OWNER);
  if (owner === false) return c.json({ error: "invalid_owner" }, 400);
  if (owner !== undefined) set.owner = owner;
  const finding = optionalProse(body.finding, MAX_DD_FINDING);
  if (finding === false) return c.json({ error: "invalid_finding" }, 400);
  if (finding !== undefined) set.finding = finding;
  if (body.label !== undefined) {
    if (!RENAMEABLE_TRACKS.includes(track)) return c.json({ error: "label_fixed" }, 400);
    // Clearing a label restores the prototype's own name for the slot (its placeholder).
    const label = optionalText(body.label, MAX_DD_LABEL);
    if (label === false) return c.json({ error: "invalid_label" }, 400);
    set.label = label ?? TRACK_ITEMS[track][item.sort_order - 1] ?? item.label;
  }
  const cols = Object.keys(set);
  if (cols.length === 0) return c.json({ error: "nothing_to_update" }, 400);

  const ts = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE dd_items SET ${cols.map((k) => `${k} = ?`).join(", ")}, updated_at = ?, updated_by = ? WHERE id = ?`,
  )
    .bind(...cols.map((k) => set[k]), ts, c.var.user.id, item.id)
    .run();
  if (set.status !== undefined && set.status !== item.status) {
    await auditConfig(c, "dd_item_status", `${deck.name} · ${item.label}: ${item.status} → ${set.status}`, {
      targetType: "dd_items",
      targetId: item.id,
      deckId: deck.id,
      detail: { track, from: item.status, to: set.status },
    });
  }

  const fresh = await c.env.DB.prepare(
    "SELECT id, deck_id, track, sort_order, label, status, owner, rating, finding, updated_at FROM dd_items WHERE id = ?",
  )
    .bind(item.id)
    .first<ItemRow>();
  return c.json({ item: toItemView(fresh!), deal: await dealView(c, deck.id) });
});

/** PUT /api/diligence/:deckId/mp-approval — `ddSetMP`. A record, not a stage move (§8 Q142). */
diligence.put("/:deckId/mp-approval", requireTask("mpapproval", "partner"), async (c) => {
  const deck = await loadDeck(c);
  if (!deck) return c.json({ error: "not_found" }, 404);
  if (deck.status !== "investment_dd") return c.json({ error: "not_in_investment_dd", stage: deck.status }, 409);
  const body = await readBody<{ value: unknown }>(c);
  if (!isMpApproval(body.value)) return c.json({ error: "invalid_value" }, 400);
  await upsertDeal(c, deck.id, { mp_approval: body.value });
  await auditConfig(c, "dd_mp_approval", `${deck.name} · MP approval: ${body.value}`, {
    targetType: "vc_deals",
    targetId: deck.id,
    deckId: deck.id,
  });
  return c.json({ deal: await dealView(c, deck.id) });
});

/** PUT /api/diligence/:deckId/deal — `ddSetRowStatus`, the two leads, the ask and pre-money. */
diligence.put("/:deckId/deal", checklistTask, async (c) => {
  const deck = await loadDeck(c);
  if (!deck) return c.json({ error: "not_found" }, 404);
  if (!DEAL_STAGES.includes(deck.status)) return c.json({ error: "not_in_diligence", stage: deck.status }, 409);
  const body = await readBody<{
    ddStatus: unknown;
    investmentLead: unknown;
    legalLead: unknown;
    ask: unknown;
    valuation: unknown;
  }>(c);
  const set: Record<string, string | null> = {};
  if (body.ddStatus !== undefined) {
    if (body.ddStatus !== null && !isDdRowStatus(body.ddStatus)) return c.json({ error: "invalid_dd_status" }, 400);
    set.dd_status = body.ddStatus as DdRowStatus | null;
  }
  const fields: [keyof typeof body, string, number][] = [
    ["investmentLead", "investment_lead", MAX_DD_OWNER],
    ["legalLead", "legal_lead", MAX_DD_OWNER],
    ["ask", "ask", MAX_DEAL_FIGURE],
    ["valuation", "valuation", MAX_DEAL_FIGURE],
  ];
  for (const [key, col, max] of fields) {
    const v = optionalText(body[key], max);
    if (v === false) return c.json({ error: `invalid_${col}` }, 400);
    if (v !== undefined) set[col] = v;
  }
  if (Object.keys(set).length === 0) return c.json({ error: "nothing_to_update" }, 400);
  await upsertDeal(c, deck.id, set);
  return c.json({ deal: await dealView(c, deck.id) });
});

const termSheetTask = requireTask("signup", "admin", "partner");

/** PUT /api/diligence/:deckId/term-sheet — `tsSetOutcome`. */
diligence.put("/:deckId/term-sheet", termSheetTask, async (c) => {
  const deck = await loadDeck(c);
  if (!deck) return c.json({ error: "not_found" }, 404);
  if (!(TERM_SHEET_STAGES as readonly string[]).includes(deck.status)) {
    return c.json({ error: "no_term_sheet", stage: deck.status }, 409);
  }
  const body = await readBody<{ status: unknown }>(c);
  if (body.status !== null && !isTermSheetStatus(body.status)) return c.json({ error: "invalid_status" }, 400);
  await upsertDeal(c, deck.id, { term_sheet_status: (body.status as TermSheetStatus | null) ?? null });
  await auditConfig(c, "term_sheet_status", `${deck.name} · term sheet: ${body.status ?? "cleared"}`, {
    targetType: "vc_deals",
    targetId: deck.id,
    deckId: deck.id,
  });
  return c.json({ deal: await dealView(c, deck.id) });
});

/** GET /api/diligence/templates — `TS_AGR_TEMPLATES`: the VC Agreements library, retired last. */
diligence.get("/templates", termSheetTask, async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, name, file_name, version, status FROM agreement_templates WHERE edition = 'vc' " +
      "ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, name",
  ).all<{ id: string; name: string; file_name: string | null; version: string; status: string }>();
  return c.json({
    templates: results.map((t) => ({
      id: t.id,
      name: t.name,
      fileName: t.file_name,
      version: t.version,
      status: t.status,
      pickable: t.status !== "retired",
    })),
  });
});

/**
 * POST /api/diligence/:deckId/term-sheet/attach — `tsTplPick`. "Retired
 * templates can't be picked" is the rule, not the list's courtesy.
 */
diligence.post("/:deckId/term-sheet/attach", termSheetTask, async (c) => {
  const deck = await loadDeck(c);
  if (!deck) return c.json({ error: "not_found" }, 404);
  if (!(TERM_SHEET_STAGES as readonly string[]).includes(deck.status)) {
    return c.json({ error: "no_term_sheet", stage: deck.status }, 409);
  }
  const body = await readBody<{ templateId: unknown }>(c);
  const template =
    typeof body.templateId === "string"
      ? await c.env.DB.prepare(
          "SELECT id, name, file_name, version, status FROM agreement_templates WHERE id = ? AND edition = 'vc'",
        )
          .bind(body.templateId)
          .first<{ id: string; name: string; file_name: string | null; version: string; status: string }>()
      : null;
  if (!template) return c.json({ error: "template_not_found" }, 404);
  if (template.status === "retired") return c.json({ error: "template_retired" }, 400);

  const file = `${deck.name}_${template.file_name ?? `${template.name}-${template.version}`}`;
  // Attaching a document to a term sheet nobody has marked yet puts it at Drafted.
  const current = await c.env.DB.prepare("SELECT term_sheet_status FROM vc_deals WHERE deck_id = ?")
    .bind(deck.id)
    .first<{ term_sheet_status: TermSheetStatus | null }>();
  await upsertDeal(c, deck.id, {
    term_sheet_template_id: template.id,
    term_sheet_file: file,
    term_sheet_status: current?.term_sheet_status ?? "drafted",
  });
  await auditConfig(c, "term_sheet_attached", `${template.name} attached to ${deck.name}`, {
    targetType: "vc_deals",
    targetId: deck.id,
    deckId: deck.id,
    detail: { templateId: template.id },
  });
  return c.json({ deal: await dealView(c, deck.id) });
});

export default diligence;
