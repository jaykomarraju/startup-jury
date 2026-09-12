/**
 * W3-C — the org-wide audit trail: one writer every mutating route calls, and
 * one reader both the console section and the All-decks Activity card go
 * through.
 *
 * ## Why this exists
 *
 * `pipeline_events` is a DECK-STAGE trail. `deck_id` is `NOT NULL` and
 * `to_stage` is `NOT NULL`, so a threshold change, an invite or a credit
 * purchase is not merely unrecorded — it is structurally unstorable (F0013).
 * Migration `0030` created `audit_log` with a nullable `deck_id` and a
 * category; until this session nothing wrote to it.
 *
 * ## One store, two readers
 *
 * `0030`'s own header asks for the deck trail to be folded in "as one filtered
 * view … rather than forked". `listAudit()` therefore reads the **union** of
 * `audit_log` and `pipeline_events` rather than copying rows between them:
 *
 *   • the console section is `listAudit()` with whatever filter the admin set;
 *   • `GET /api/activity` — the All-decks Activity card — is the same call with
 *     `categories: ["pipeline"]` and `limit: 12`.
 *
 * Copying pipeline rows into `audit_log` would have been easier and would have
 * created exactly the second source of truth the section exists to remove: two
 * tables holding the same event, drifting the first time one is written without
 * the other.
 *
 * ## Writes never fail their caller
 *
 * `recordAudit` swallows its own errors. An audit row is a side effect of a
 * mutation that has already committed; 500-ing a successful threshold change
 * because the trail hiccuped would be the worse failure. The trade is that a
 * broken write is silent in production — which is why every writer in this
 * session is covered by a test that asserts the ROW, not the call.
 */
import type { Context } from "hono";
import type { AppEnv } from "../types";
import type { Edition } from "../../shared/roles";
import { getStage } from "../../pipeline";
import {
  type AuditCategory,
  type AuditEventView,
  shortActorName,
  isValidRetention,
} from "../../shared/audit";

// ── Writing ──────────────────────────────────────────────────────────────────

export interface AuditEntry {
  category: AuditCategory;
  /** Machine verb, e.g. `threshold_changed`. Stable; filterable; not rendered. */
  action: string;
  /** The sentence the `.log-a` column renders, in the prototype's own voice. */
  summary: string;
  /** Before/after, or anything a sentence cannot carry. Serialised as JSON. */
  detail?: unknown;
  deckId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
}

/**
 * `aud_<uuid>`. The dashes matter: `0030`'s ten demo rows are `aud_0001` …
 * `aud_0010`, so a hyphen is what tells a generated row from the seeded one at
 * a glance and in a WHERE clause. A hex-only suffix would collide with the
 * seed's `aud_0…` prefix about one time in sixteen.
 */
function auditId(): string {
  return `aud_${crypto.randomUUID()}`;
}

/**
 * Append one or more audit rows for the acting user. Variadic so a route that
 * changed three settings writes three rows in one batch and one call.
 *
 * Callers pass the Hono context, which is what keeps every writer site a
 * genuine one-liner in a file this session does not own:
 *
 *     await recordAudit(c, { category: "config", action: "threshold_changed", summary: … });
 */
export async function recordAudit(c: Context<AppEnv>, ...entries: AuditEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const user = c.var.user;
  try {
    await c.env.DB.batch(
      entries.map((e) =>
        c.env.DB.prepare(
          "INSERT INTO audit_log (id, edition, category, actor_id, actor_label, action, summary, detail_json, deck_id, target_type, target_id) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).bind(
          auditId(),
          user.edition,
          e.category,
          user.id,
          // Denormalised on purpose (`0030`): the trail must stay readable
          // after the user it names is deleted.
          shortActorName(user.name),
          e.action,
          e.summary,
          e.detail === undefined ? null : JSON.stringify(e.detail),
          e.deckId ?? null,
          e.targetType ?? null,
          e.targetId ?? null,
        ),
      ),
    );
  } catch (err) {
    // See the module header: a trail write never fails the mutation it records.
    console.error("audit write failed:", err);
  }
}

// ── Sentence helpers ─────────────────────────────────────────────────────────

/**
 * `"Team & execution 10% → 12%"` — the prototype's own before→after fragment
 * (`s-al.html`: "Area weight updated: Team & execution 10% → 12%, Business
 * model 12% → 10%"). Returns `null` when nothing moved, so a caller can
 * `.filter(Boolean)` a whole settings object down to what actually changed.
 */
export function changedFragment<T>(
  label: string,
  before: T,
  after: T,
  format: (v: T) => string = (v) => String(v),
): string | null {
  if (Object.is(before, after)) return null;
  return `${label} ${format(before)} → ${format(after)}`;
}

/** An on/off setting, in the prototype's voice ("toggled OFF for jury"). */
export function toggledFragment(label: string, before: boolean, after: boolean): string | null {
  if (before === after) return null;
  return `${label} toggled ${after ? "ON" : "OFF"}`;
}

export const pct = (n: number): string => `${Number(n.toFixed(2))}%`;

/** Minor units → "₹20,000". Only INR is seeded; others fall back to the code. */
export function money(amountMinor: number, currency: string): string {
  const major = amountMinor / 100;
  const formatted = major.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  return currency === "INR" ? `₹${formatted}` : `${formatted} ${currency}`;
}

// ── Credits: the ledger row and its audit row, together ──────────────────────

export interface CreditMovement {
  /** Signed: negative consumes, positive adds. Never 0 (`0032` CHECKs it). */
  delta: number;
  reason: "trial_grant" | "purchase" | "deck_evaluated" | "refund" | "adjustment" | "expiry";
  deckId?: string | null;
  amountMinor?: number | null;
  currency?: string | null;
  /** Provider transaction id / invoice number. §1.3: a reference, never a card. */
  reference?: string | null;
  note?: string | null;
  /** The audit sentence. `credit_ledger.note` carries the short form. */
  summary: string;
  action: string;
}

/**
 * Write a credit movement to `credit_ledger` **and** its Billing audit row.
 *
 * F0054: the Billing category had nothing to show because credits were a single
 * mutable integer with no history — `org_settings.credits_balance`, overwritten
 * in place. `0032` created the ledger; nothing wrote to it either. The two go
 * together because the prototype's Billing sentence ("Purchased 50-credit pack
 * · ₹20,000 · Transaction ID: RZP250603112244") is *made of* ledger columns:
 * without the ledger row there is no amount and no reference to put in it.
 *
 * The ledger row is NOT swallowed the way the audit row is — a balance that
 * moved with no ledger entry is a real accounting defect, not a lost log line.
 */
export async function recordCreditMovement(
  c: Context<AppEnv>,
  movement: CreditMovement,
): Promise<string> {
  const id = `cl_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  await c.env.DB.prepare(
    "INSERT INTO credit_ledger (id, edition, delta, reason, deck_id, amount_minor, currency, reference, note, actor_id) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      id,
      c.var.user.edition,
      movement.delta,
      movement.reason,
      movement.deckId ?? null,
      movement.amountMinor ?? null,
      movement.currency ?? null,
      movement.reference ?? null,
      movement.note ?? null,
      c.var.user.id,
    )
    .run();

  await recordAudit(c, {
    category: "billing",
    action: movement.action,
    summary: movement.summary,
    detail: { delta: movement.delta, reason: movement.reason, reference: movement.reference ?? null },
    deckId: movement.deckId ?? null,
    targetType: "credit_ledger",
    targetId: id,
  });
  return id;
}

/**
 * The INR price of a seeded credit pack, so a purchase can be recorded with the
 * money it cost. `null` when the catalogue has no pack of that size — the
 * movement is still recorded, just without an amount.
 */
export async function packPriceMinor(
  db: D1Database,
  units: number,
): Promise<{ amountMinor: number; currency: string; name: string } | null> {
  const row = await db
    .prepare(
      "SELECT a.amount_minor AS amount_minor, a.currency AS currency, p.name AS name " +
        "FROM price_plans p JOIN price_amounts a ON a.plan_id = p.id " +
        "WHERE p.plan_group = 'credit_pack' AND p.units = ? AND p.active = 1 AND a.currency = 'INR' LIMIT 1",
    )
    .bind(units)
    .first<{ amount_minor: number; currency: string; name: string }>();
  return row ? { amountMinor: row.amount_minor, currency: row.currency, name: row.name } : null;
}

// ── Score overrides ──────────────────────────────────────────────────────────

export interface SubmittedScore {
  parameterId: string;
  value: number;
  comment: string | null;
}

/**
 * F0052 — the Score category's source data.
 *
 * A human score that diverges from the AI's by more than the org's configured
 * delta is an OVERRIDE, and the prototype records it with both values and the
 * reason the evaluator gave:
 *
 *   Override: Traction score for GreenGrid Energy changed 6.2 → 8.1.
 *   Reason: "Pilot data confirmed but not captured by AI text extraction"
 *
 * No schema change is needed for this: the AI's per-parameter values are
 * already rows in `scores` with `evaluator_kind = 'ai'`, and W2-A's override
 * rationale is already `scores.comment`. What was missing is the record that
 * the divergence happened at all, which is this.
 *
 * Values are stored canonically 0–10 and are rendered here on the same scale
 * the evaluator typed on, via `toDisplay`.
 */
export async function recordScoreOverrides(
  c: Context<AppEnv>,
  args: {
    deckId: string;
    deckName: string;
    scores: SubmittedScore[];
    aiByParam: Map<string, number>;
    delta: number;
    toDisplay: (v: number) => number;
  },
): Promise<void> {
  const diverged = args.scores.filter((s) => {
    const ai = args.aiByParam.get(s.parameterId);
    return ai !== undefined && Math.abs(s.value - ai) > args.delta;
  });
  if (diverged.length === 0) return;

  const names = new Map(
    (
      await c.env.DB.prepare(
        `SELECT id, name FROM parameters WHERE id IN (${diverged.map(() => "?").join(", ")})`,
      )
        .bind(...diverged.map((s) => s.parameterId))
        .all<{ id: string; name: string }>()
    ).results.map((r) => [r.id, r.name]),
  );

  const round = (v: number) => Number(args.toDisplay(v).toFixed(1));
  await recordAudit(
    c,
    ...diverged.map((s) => {
      const ai = args.aiByParam.get(s.parameterId) as number;
      const area = names.get(s.parameterId) ?? s.parameterId;
      const reason = s.comment?.trim();
      return {
        category: "score" as const,
        action: "score_overridden",
        summary:
          `Override: ${area} score for ${args.deckName} changed ${round(ai)} → ${round(s.value)}.` +
          (reason ? ` Reason: "${reason}"` : ""),
        detail: { from: round(ai), to: round(s.value), reason: reason ?? null },
        deckId: args.deckId,
        targetType: "parameter",
        targetId: s.parameterId,
      };
    }),
  );
}

// ── Retention ────────────────────────────────────────────────────────────────

export async function loadAuditRetention(db: D1Database, edition: Edition): Promise<number | null> {
  const row = await db
    .prepare("SELECT audit_retention_days FROM org_settings WHERE edition = ?")
    .bind(edition)
    .first<{ audit_retention_days: number | null }>();
  return row?.audit_retention_days ?? null;
}

export async function setAuditRetention(
  db: D1Database,
  edition: Edition,
  days: number | null,
): Promise<void> {
  if (!isValidRetention(days)) throw new Error("invalid_retention");
  await db
    .prepare("UPDATE org_settings SET audit_retention_days = ? WHERE edition = ?")
    .bind(days, edition)
    .run();
}

/**
 * Delete audit rows older than the edition's retention window. A NULL window
 * ("keep everything", the default) deletes nothing.
 *
 * Only `audit_log` is pruned. `pipeline_events` is a deck's own decision
 * history — it is rendered on the deck screen, it is referenced by the
 * analytics, and deleting it would silently rewrite a deck's record rather than
 * expire an administrative log line.
 */
export async function purgeExpiredAudit(db: D1Database, edition: Edition): Promise<number> {
  const days = await loadAuditRetention(db, edition);
  if (days === null) return 0;
  const res = await db
    .prepare(
      "DELETE FROM audit_log WHERE edition = ? AND created_at < datetime('now', ? || ' days')",
    )
    .bind(edition, `-${days}`)
    .run();
  return res.meta?.changes ?? 0;
}

// ── Reading ──────────────────────────────────────────────────────────────────

export interface AuditQuery {
  edition: Edition;
  /** Empty / omitted = every category. */
  categories?: AuditCategory[];
  actorId?: string;
  deckId?: string;
  programId?: string;
  cohortId?: string;
  /** Inclusive `YYYY-MM-DD`. */
  from?: string;
  to?: string;
  /** Free text over the rendered sentence. */
  q?: string;
  limit?: number;
  /** Keyset cursor, `"<created_at>|<id>"`, from a previous page. */
  cursor?: string | null;
  /**
   * Founder isolation: restrict to decks this user uploaded, and drop every
   * row that has no deck. Mirrors `GET /api/activity`'s existing rule.
   */
  founderId?: string;
}

/** One row of the union, before it is turned into a view. */
export interface UnionRow {
  id: string;
  category: AuditCategory;
  actor_id: string | null;
  actor_label: string | null;
  actor_name: string | null;
  actor_title: string | null;
  action: string;
  summary: string | null;
  deck_id: string | null;
  deck_name: string | null;
  target_type: string | null;
  target_id: string | null;
  from_stage: string | null;
  to_stage: string | null;
  note: string | null;
  created_at: string;
}

/** The columns both branches of the union must produce, in this order. */
const AUDIT_BRANCH_COLUMNS =
  "id, category, actor_id, actor_label, actor_name, actor_title, action, summary, " +
  "deck_id, deck_name, target_type, target_id, from_stage, to_stage, note, created_at";

export interface AuditReadResult {
  rows: UnionRow[];
  nextCursor: string | null;
}

/** `"<created_at>|<id>"` → the two keyset bounds, or null if malformed. */
function parseCursor(cursor: string | null | undefined): { at: string; id: string } | null {
  if (!cursor) return null;
  const sep = cursor.indexOf("|");
  if (sep <= 0) return null;
  return { at: cursor.slice(0, sep), id: cursor.slice(sep + 1) };
}

/**
 * The union read. Both branches carry the same column list so the outer query
 * can order and page across them as one stream.
 *
 * Predicates are applied INSIDE each branch rather than outside, so the indexes
 * `0030` and `0042` created (`(edition, created_at)`, `(edition, category,
 * created_at)`, `(edition, actor_id, created_at)`) are still usable.
 */
export async function listAudit(db: D1Database, query: AuditQuery): Promise<AuditReadResult> {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const cursor = parseCursor(query.cursor);
  const cats = query.categories ?? [];
  const wantsAudit = cats.length === 0 || cats.some((k) => k !== "pipeline");
  const wantsPipeline = cats.length === 0 || cats.includes("pipeline");
  // A founder has no administrative events to see — every row they may read is
  // deck-scoped, and the only deck-scoped categories are pipeline and score.
  const branches: string[] = [];
  const params: unknown[] = [];

  /** Predicates shared by both branches, expressed against each one's aliases. */
  function common(alias: { created: string; id: string; deck: string; actor: string; summary: string }) {
    const where: string[] = [];
    if (cursor) {
      where.push(`(${alias.created} < ? OR (${alias.created} = ? AND ${alias.id} < ?))`);
      params.push(cursor.at, cursor.at, cursor.id);
    }
    if (query.actorId) {
      where.push(`${alias.actor} = ?`);
      params.push(query.actorId);
    }
    if (query.deckId) {
      where.push(`${alias.deck} = ?`);
      params.push(query.deckId);
    }
    if (query.from) {
      where.push(`${alias.created} >= ?`);
      params.push(`${query.from} 00:00:00`);
    }
    if (query.to) {
      where.push(`${alias.created} <= ?`);
      params.push(`${query.to} 23:59:59`);
    }
    if (query.q) {
      where.push(`${alias.summary} LIKE ?`);
      params.push(`%${query.q}%`);
    }
    return where;
  }

  if (wantsAudit && !query.founderId) {
    const where = ["a.edition = ?"];
    params.push(query.edition);
    const filtered = cats.filter((k) => k !== "pipeline");
    if (filtered.length > 0) {
      where.push(`a.category IN (${filtered.map(() => "?").join(", ")})`);
      params.push(...filtered);
    }
    if (query.programId) {
      where.push("d.program_id = ?");
      params.push(query.programId);
    }
    if (query.cohortId) {
      where.push("d.cohort_id = ?");
      params.push(query.cohortId);
    }
    where.push(
      ...common({
        created: "a.created_at",
        id: "a.id",
        deck: "a.deck_id",
        actor: "a.actor_id",
        summary: "a.summary",
      }),
    );
    branches.push(
      "SELECT a.id AS id, a.category AS category, a.actor_id AS actor_id, a.actor_label AS actor_label, " +
        "u.name AS actor_name, u.title AS actor_title, a.action AS action, a.summary AS summary, " +
        "a.deck_id AS deck_id, d.name AS deck_name, a.target_type AS target_type, a.target_id AS target_id, " +
        "NULL AS from_stage, NULL AS to_stage, NULL AS note, a.created_at AS created_at " +
        "FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id LEFT JOIN decks d ON d.id = a.deck_id " +
        `WHERE ${where.join(" AND ")}`,
    );
  }

  if (wantsPipeline) {
    const where = ["d.edition = ?"];
    params.push(query.edition);
    if (query.founderId) {
      where.push("d.uploaded_by = ?");
      params.push(query.founderId);
    }
    if (query.programId) {
      where.push("d.program_id = ?");
      params.push(query.programId);
    }
    if (query.cohortId) {
      where.push("d.cohort_id = ?");
      params.push(query.cohortId);
    }
    where.push(
      ...common({
        created: "e.created_at",
        id: "e.id",
        deck: "e.deck_id",
        actor: "e.actor_id",
        // A stage transition's sentence is composed at render time, so free-text
        // search matches the deck it happened to, which is what is searchable.
        summary: "d.name",
      }),
    );
    branches.push(
      "SELECT e.id AS id, 'pipeline' AS category, e.actor_id AS actor_id, NULL AS actor_label, " +
        "u.name AS actor_name, u.title AS actor_title, e.action AS action, NULL AS summary, " +
        "e.deck_id AS deck_id, d.name AS deck_name, 'deck' AS target_type, e.deck_id AS target_id, " +
        "e.from_stage AS from_stage, e.to_stage AS to_stage, e.note AS note, e.created_at AS created_at " +
        "FROM pipeline_events e JOIN decks d ON d.id = e.deck_id " +
        "LEFT JOIN users u ON u.id = e.actor_id " +
        `WHERE ${where.join(" AND ")}`,
    );
  }

  if (branches.length === 0) return { rows: [], nextCursor: null };

  // One extra row tells us whether there is a next page without a COUNT(*).
  params.push(limit + 1);
  const sql =
    branches.length === 1
      ? `${branches[0]} ORDER BY created_at DESC, id DESC LIMIT ?`
      : `SELECT ${AUDIT_BRANCH_COLUMNS} FROM (${branches.join(" UNION ALL ")}) ` +
        "ORDER BY created_at DESC, id DESC LIMIT ?";

  const rows = (await db.prepare(sql).bind(...params).all<UnionRow>()).results;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    rows: page,
    nextCursor: rows.length > limit && last ? `${last.created_at}|${last.id}` : null,
  };
}

/**
 * A stage transition has no stored sentence — it is three columns and a verb.
 * This composes the same sentence the Activity card has always rendered
 * ("moved GreenRoute to Shortlisted"), so a pipeline row reads like every other
 * row in the log.
 */
function pipelineSummary(edition: Edition, row: UnionRow): string {
  const to = row.to_stage ? (getStage(edition, row.to_stage)?.label ?? row.to_stage) : null;
  const deck = row.deck_name ?? "a deck";
  const head = to ? `Moved ${deck} to ${to}` : `${row.action} on ${deck}`;
  return row.note ? `${head} — ${row.note}` : head;
}

/** Union row → the view both the section and the API return. */
export function toAuditView(edition: Edition, row: UnionRow): AuditEventView {
  return {
    id: row.id,
    category: row.category,
    action: row.action,
    summary: row.summary ?? pipelineSummary(edition, row),
    // The denormalised label wins: it is what the row was written with, and it
    // survives the user being renamed or deleted.
    actor: row.actor_label ?? shortActorName(row.actor_name),
    actorId: row.actor_id,
    deckId: row.deck_id,
    deckName: row.deck_name,
    targetType: row.target_type,
    targetId: row.target_id,
    createdAt: row.created_at,
  };
}

/** The distinct actors present in the edition's trail, for the actor filter. */
export async function listAuditActors(
  db: D1Database,
  edition: Edition,
): Promise<{ id: string; label: string }[]> {
  const rows = (
    await db
      .prepare(
        "SELECT a.actor_id AS id, COALESCE(u.name, a.actor_label) AS label FROM audit_log a " +
          "LEFT JOIN users u ON u.id = a.actor_id WHERE a.edition = ? AND a.actor_id IS NOT NULL " +
          "UNION " +
          "SELECT e.actor_id AS id, u.name AS label FROM pipeline_events e " +
          "JOIN decks d ON d.id = e.deck_id LEFT JOIN users u ON u.id = e.actor_id " +
          "WHERE d.edition = ? AND e.actor_id IS NOT NULL",
      )
      .bind(edition, edition)
      .all<{ id: string; label: string | null }>()
  ).results;
  const seen = new Map<string, string>();
  for (const r of rows) if (!seen.has(r.id)) seen.set(r.id, r.label ?? r.id);
  return [...seen].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
}
