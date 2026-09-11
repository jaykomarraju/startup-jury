/**
 * Audit log — the vocabulary shared by the writer (`src/server/audit/log.ts`),
 * the read route (`src/server/routes/audit.ts`) and the Admin console section
 * (`src/client/routes/admin/AuditLog.tsx`).
 *
 * Pure: no `Env`, no DB, no `fetch`. Same split, and the same reasoning, as
 * `src/shared/crm.ts` — the console must render a badge and format a timestamp
 * with the exact rules the server writes by, and both halves must agree on the
 * category set without the client importing from `src/server/`.
 *
 * The four categories and their two colours each are transcribed from the
 * prototype (`admin/s-al.html` rows + `admin/_style.css:125-129`). `pipeline`
 * and `security` are the widenings migration `0030` added so the deck-stage
 * trail (`pipeline_events`) can be read as one filtered view of the same store
 * rather than forked — they are not drawn in the prototype, so they take
 * neutral app tokens rather than invented brand colours.
 */

/**
 * The category set itself lives in `./types` beside the `audit_log` row shape
 * `0030` created — re-exported here so the console and the writer import one
 * vocabulary from one place, and a seventh category can never be added twice.
 */
export { AUDIT_CATEGORIES, type AuditCategory } from "./types";
import { AUDIT_CATEGORIES, type AuditCategory } from "./types";

/** The four the prototype draws, in the order its seeded rows introduce them. */
export const PROTOTYPE_AUDIT_CATEGORIES: readonly AuditCategory[] = [
  "config",
  "score",
  "team",
  "billing",
];

export interface AuditBadge {
  label: string;
  /** `.lb` background — `admin/_style.css:126-129`. */
  bg: string;
  /** `.lb` foreground. */
  fg: string;
}

/**
 * `.lb-c` / `.lb-s` / `.lb-t` / `.lb-b`, verbatim. `billing` is the one the
 * prototype itself expressed as tokens (`var(--olive-lt)` / `var(--green)`),
 * so it is the one that follows the app's theme; the other three are the
 * literal hexes the prototype hardcodes.
 */
export const AUDIT_BADGES: Record<AuditCategory, AuditBadge> = {
  config: { label: "Config", bg: "#FAEEDA", fg: "#633806" },
  score: { label: "Score", bg: "#E6F1FB", fg: "#0C447C" },
  team: { label: "Team", bg: "#E0F2EC", fg: "#085041" },
  billing: { label: "Billing", bg: "var(--color-olive-lt)", fg: "var(--color-green)" },
  pipeline: { label: "Pipeline", bg: "var(--color-surface-2)", fg: "var(--color-fg-muted)" },
  security: { label: "Security", bg: "#FEE2E2", fg: "#9A3412" },
};

export function isAuditCategory(value: unknown): value is AuditCategory {
  return typeof value === "string" && (AUDIT_CATEGORIES as readonly string[]).includes(value);
}

// ── Retention ────────────────────────────────────────────────────────────────

/**
 * The choices the retention control offers. `null` = keep everything, which is
 * the shipped default: an audit trail that silently deletes itself is worse
 * than a long one, so shortening it is always a deliberate act.
 *
 * The floor is 30 days. Below that the log stops being able to answer the
 * question it exists for ("who changed this, and when?") for anything but the
 * current month.
 */
export const AUDIT_RETENTION_CHOICES: readonly (number | null)[] = [null, 365, 180, 90, 30];
export const MIN_AUDIT_RETENTION_DAYS = 30;

export function retentionLabel(days: number | null): string {
  if (days === null) return "Keep everything";
  if (days === 365) return "1 year";
  if (days % 30 === 0) return `${days / 30} months`;
  return `${days} days`;
}

/** `null` and any of the offered windows are valid; anything else is not. */
export function isValidRetention(value: unknown): value is number | null {
  if (value === null) return true;
  return typeof value === "number" && Number.isInteger(value) && value >= MIN_AUDIT_RETENTION_DAYS;
}

// ── The row, as the API returns it ───────────────────────────────────────────

export interface AuditEventView {
  id: string;
  category: AuditCategory;
  /** Machine verb, e.g. `threshold_changed`. Not rendered; filterable. */
  action: string;
  /** The sentence the `.log-a` column renders. */
  summary: string;
  /** `.log-u` — "Nisha K.". "AI" when a machine did it. */
  actor: string;
  actorId: string | null;
  deckId: string | null;
  deckName: string | null;
  targetType: string | null;
  targetId: string | null;
  createdAt: string;
}

export interface AuditActorOption {
  id: string;
  label: string;
}

export interface AuditPage {
  events: AuditEventView[];
  /** Keyset cursor for the next page; `null` when this is the last one. */
  nextCursor: string | null;
  /** Distinct actors present in the store, for the actor filter. */
  actors: AuditActorOption[];
  retentionDays: number | null;
  /** Whether the caller may change retention (admin) — the section hides it otherwise. */
  canConfigure: boolean;
}

export interface AuditFilter {
  categories?: AuditCategory[];
  actorId?: string;
  deckId?: string;
  /** Inclusive ISO date (YYYY-MM-DD). */
  from?: string;
  to?: string;
  /** Free text over the rendered sentence. */
  q?: string;
  limit?: number;
  cursor?: string;
}

// ── Presentation ─────────────────────────────────────────────────────────────

/**
 * "Nisha Kapoor" → "Nisha K." — the `.log-u` form every prototype row uses,
 * and the form migration `0030` seeded its ten demo rows with.
 *
 * A single-word name is returned whole; an existing abbreviation is left alone.
 */
export function shortActorName(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim().replace(/\s+/g, " ");
  if (!trimmed) return "AI";
  const parts = trimmed.split(" ");
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  // Already "Nisha K." / "Nisha K" — do not re-abbreviate.
  if (last.replace(/\./g, "").length === 1) return `${parts[0]} ${last.replace(/\.$/, "")}.`;
  return `${parts[0]} ${last[0].toUpperCase()}.`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The `.log-t` column's relative-then-absolute rule, read off the prototype's
 * own seed: today is a clock time ("11:42 am"), yesterday is the word
 * "Yesterday", and anything older is a bare day + month ("3 Jun"). A date from
 * an earlier year carries the year too, which the prototype never had to show.
 *
 * `now` is injectable so the format is testable without freezing the clock.
 */
export function auditTimeLabel(iso: string, now: Date = new Date()): string {
  const at = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  if (Number.isNaN(at.getTime())) return iso;

  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);

  if (days === 0) {
    const h = at.getHours();
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    const mins = String(at.getMinutes()).padStart(2, "0");
    return `${hour12}:${mins} ${h < 12 ? "am" : "pm"}`;
  }
  if (days === 1) return "Yesterday";
  const stamp = `${at.getDate()} ${MONTHS[at.getMonth()]}`;
  return at.getFullYear() === now.getFullYear()
    ? stamp
    : `${stamp} ${String(at.getFullYear()).slice(2)}`;
}

/** `?category=config&category=team&from=…` — one place, so both halves agree. */
export function auditQueryString(filter: AuditFilter): string {
  const qs = new URLSearchParams();
  for (const c of filter.categories ?? []) qs.append("category", c);
  if (filter.actorId) qs.set("actorId", filter.actorId);
  if (filter.deckId) qs.set("deckId", filter.deckId);
  if (filter.from) qs.set("from", filter.from);
  if (filter.to) qs.set("to", filter.to);
  if (filter.q) qs.set("q", filter.q);
  if (filter.limit) qs.set("limit", String(filter.limit));
  if (filter.cursor) qs.set("cursor", filter.cursor);
  return qs.toString();
}
