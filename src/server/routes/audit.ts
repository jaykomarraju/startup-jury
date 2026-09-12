/**
 * `GET` / `PUT /api/audit` — Admin console → System → **Audit log**
 * (`admin/s-al.html`; F0012, F0059, F0136).
 *
 * The section the prototype draws is a historical trail: its ten seeded rows
 * span three days and mix clock times, "Yesterday" and absolute dates. The only
 * audit surface this product had was `GET /api/activity`, a 12-row rail hard-
 * capped at 50 with no pagination, no date range and no filters — so a section
 * built on it could never page back to the rows the prototype shows (F0059).
 *
 * This route is the read half of `src/server/audit/log.ts`: keyset pagination
 * over the union of `audit_log` and `pipeline_events`, filtered by category,
 * actor, deck, date range and free text.
 *
 * **AuthZ.** Reading the trail is a console act, so it carries the console's own
 * task — the same `requireTask("adminconsole", "admin")` that `permissions.ts`
 * and `crm.ts` use. §8 Q16 settled this: closing an administrator's
 * `adminconsole` cell closes the console *and everything behind it*, in one
 * place. The Activity card's wider audience keeps reading through
 * `GET /api/activity`, which has its own (deliberately looser) gate and its own
 * founder isolation; both go through `listAudit()`, so they are one store.
 */
import { Hono } from "hono";
import type { AppEnv } from "../types";
import type { Edition } from "../../shared/roles";
import { requireAuth, requireTask } from "../auth/middleware";
import {
  isAuditCategory,
  isValidRetention,
  retentionLabel,
  type AuditCategory,
} from "../../shared/audit";
import {
  listAudit,
  recordAudit,
  listAuditActors,
  loadAuditRetention,
  purgeExpiredAudit,
  setAuditRetention,
  toAuditView,
} from "../audit/log";

const audit = new Hono<AppEnv>();
audit.use("*", requireAuth);
audit.use("*", requireTask("adminconsole", "admin"));

/** `YYYY-MM-DD`, or nothing. A malformed date is dropped, never 400s a read. */
function isoDate(value: string | undefined): string | undefined {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

/**
 * GET /api/audit — one page of the trail, plus the two things the section's
 * chrome needs (the actor list and the retention window).
 *
 * Query: `category` (repeatable), `actorId`, `deckId`, `from`, `to`, `q`,
 * `limit` (1–200, default 50), `cursor`.
 */
audit.get("/", async (c) => {
  const edition = c.var.user.edition as Edition;
  const categories = c.req
    .queries("category")
    ?.filter(isAuditCategory) as AuditCategory[] | undefined;

  const page = await listAudit(c.env.DB, {
    edition,
    categories,
    actorId: c.req.query("actorId") || undefined,
    deckId: c.req.query("deckId") || undefined,
    from: isoDate(c.req.query("from")),
    to: isoDate(c.req.query("to")),
    q: c.req.query("q")?.trim() || undefined,
    limit: Number(c.req.query("limit") ?? 50) || 50,
    cursor: c.req.query("cursor") || null,
  });

  const [actors, retentionDays] = await Promise.all([
    listAuditActors(c.env.DB, edition),
    loadAuditRetention(c.env.DB, edition),
  ]);

  return c.json({
    events: page.rows.map((r) => toAuditView(edition, r)),
    nextCursor: page.nextCursor,
    actors,
    retentionDays,
    // Reading and configuring are the same gate today; the flag exists so the
    // section can hide the control rather than offer a 403 if that ever splits.
    canConfigure: true,
  });
});

/**
 * PUT /api/audit/retention — set the window, and apply it.
 *
 * Setting a retention policy that does not delete anything is a label, not a
 * policy, so the write purges in the same request and reports how many rows it
 * removed. `null` (keep everything) purges nothing. Only `audit_log` is pruned
 * — see `purgeExpiredAudit`.
 */
audit.put("/retention", async (c) => {
  const edition = c.var.user.edition as Edition;
  const body = await c.req.json<{ retentionDays?: number | null }>().catch(() => null);
  const days = body?.retentionDays ?? null;
  if (!isValidRetention(days)) return c.json({ error: "invalid_retention" }, 400);

  const before = await loadAuditRetention(c.env.DB, edition);
  await setAuditRetention(c.env.DB, edition, days);
  // Shortening the window is itself an administrative act — and the one act a
  // trail must never lose, since it is the act that loses other rows. Recorded
  // before the purge runs, and `security` rather than `config` because the
  // subject is the trail itself.
  await recordAudit(c, {
    category: "security",
    action: "audit_retention_changed",
    summary: `Audit log retention changed from ${retentionLabel(before)} to ${retentionLabel(days)}`,
    detail: { from: before, to: days },
    targetType: "org_settings",
    targetId: edition,
  });
  const purged = await purgeExpiredAudit(c.env.DB, edition);
  return c.json({ ok: true, retentionDays: days, purged });
});

export { audit };
export default audit;
