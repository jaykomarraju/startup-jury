import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, Button, EmptyState } from "../../components";
import { toCsv, downloadCsv, csvFilename } from "../../exportCsv";
import {
  AUDIT_BADGES,
  AUDIT_RETENTION_CHOICES,
  PROTOTYPE_AUDIT_CATEGORIES,
  AUDIT_CATEGORIES,
  auditQueryString,
  auditTimeLabel,
  retentionLabel,
  type AuditCategory,
  type AuditEventView,
  type AuditPage,
} from "../../../shared/audit";

/**
 * Admin console → System → **Audit log** (prototype `admin/s-al.html`).
 *
 * ## What the prototype draws, and what it does not
 *
 * The prototype is one card of ten `.log-row`s — a four-column row (time ·
 * actor · sentence · category badge) with no filter bar, no search, no export
 * and no retention control. That row is reproduced here to the pixel: the same
 * 76 px mono time column, the same 72 px semibold actor column, the same four
 * badge colours from `admin/_style.css:126-129`, and the same
 * relative-then-absolute time rule its seed implies ("11:42 am" … "Yesterday" …
 * "3 Jun").
 *
 * The chrome around it is the session's own addition, and plan §6 asks for it
 * in as many words ("category badges, filters and retention"). The reasoning,
 * and the conflict with F0136 — which reads the same prototype as putting only
 * the unbounded list in scope — are recorded in plan §8. Two things keep the
 * addition honest:
 *
 *   • the filter is the **badges themselves**, made clickable, so no new control
 *     family enters a console that has none; and
 *   • everything else (actor, dates, search, retention, export) is one quiet
 *     11 px line, above and below a card that is otherwise unchanged.
 *
 * The prototype's ten rows span three days and mix clock times with absolute
 * dates, so it is explicitly a historical trail, not a recent-activity peek —
 * which is F0059's point: without paging, filters and a date range this section
 * could never reach the "3 Jun" rows the prototype itself shows.
 */

const PAGE_SIZE = 50;

/** `.lb` — the prototype's category badge, at its own size and weight. */
function CategoryBadge({ category }: { category: AuditCategory }) {
  const badge = AUDIT_BADGES[category];
  return (
    <span
      data-testid={`al-badge-${category}`}
      className="mt-px shrink-0 rounded px-1.5 py-[2px] text-[9px] font-bold"
      style={{ background: badge.bg, color: badge.fg }}
    >
      {badge.label}
    </span>
  );
}

/**
 * The filter row. Categories the prototype draws come first, in its own order;
 * `pipeline` and `security` follow, because they are the two `0030` added and
 * an admin looking for "the four badges" should find them where the prototype
 * put them.
 */
const FILTER_ORDER: AuditCategory[] = [
  ...PROTOTYPE_AUDIT_CATEGORIES,
  ...AUDIT_CATEGORIES.filter((k) => !PROTOTYPE_AUDIT_CATEGORIES.includes(k)),
];

function CategoryFilter({
  selected,
  onToggle,
  onClear,
}: {
  selected: AuditCategory[];
  onToggle: (category: AuditCategory) => void;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by category">
      <button
        type="button"
        data-testid="al-filter-all"
        aria-pressed={selected.length === 0}
        onClick={onClear}
        className={`rounded px-2 py-[3px] text-[10px] font-bold uppercase tracking-wide transition-opacity ${
          selected.length === 0
            ? "bg-surface-2 text-fg"
            : "text-fg-muted opacity-70 hover:opacity-100"
        }`}
      >
        All
      </button>
      {FILTER_ORDER.map((category) => {
        const badge = AUDIT_BADGES[category];
        const on = selected.includes(category);
        return (
          <button
            key={category}
            type="button"
            data-testid={`al-filter-${category}`}
            aria-pressed={on}
            onClick={() => onToggle(category)}
            className={`rounded px-2 py-[3px] text-[10px] font-bold transition-opacity ${
              on ? "" : "opacity-45 hover:opacity-80"
            }`}
            style={{ background: badge.bg, color: badge.fg }}
          >
            {badge.label}
          </button>
        );
      })}
    </div>
  );
}

/** One `.log-row`. Wraps on narrow widths exactly as `_style.css:166-168` does. */
function LogRow({ event, now }: { event: AuditEventView; now: Date }) {
  return (
    <div
      data-testid="al-row"
      data-category={event.category}
      className="flex flex-wrap items-start gap-x-[9px] gap-y-0.5 border-b border-line-soft py-2 text-[11.5px] last:border-b-0 sm:flex-nowrap"
    >
      <span className="mt-px w-auto shrink-0 font-mono text-[10.5px] text-fg-muted sm:w-[76px]">
        {auditTimeLabel(event.createdAt, now)}
      </span>
      <span className="w-auto shrink-0 font-semibold text-navy sm:w-[72px]">{event.actor}</span>
      <span className="flex-1 leading-[1.45] text-fg-muted">{event.summary}</span>
      <CategoryBadge category={event.category} />
    </div>
  );
}

const AUDIT_CSV_HEADERS = ["When", "Actor", "Category", "Action", "Event", "Deck"];

export function AuditLogSection() {
  const [page, setPage] = useState<AuditPage | null>(null);
  const [events, setEvents] = useState<AuditEventView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);

  const [categories, setCategories] = useState<AuditCategory[]>([]);
  const [actorId, setActorId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");

  // One clock for the whole render pass, so two rows a millisecond apart can
  // never disagree about whether "today" has rolled over.
  const now = useMemo(() => new Date(), [events]);

  const load = useCallback(
    async (next: string | null) => {
      setBusy(true);
      try {
        const qs = auditQueryString({
          categories,
          actorId: actorId || undefined,
          from: from || undefined,
          to: to || undefined,
          q: q.trim() || undefined,
          limit: PAGE_SIZE,
          cursor: next ?? undefined,
        });
        const res = await fetch(`/api/audit${qs ? `?${qs}` : ""}`);
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as AuditPage;
        setPage(body);
        // A cursor appends; a filter change replaces.
        setEvents((cur) => (next ? [...cur, ...body.events] : body.events));
        setCursor(body.nextCursor);
        setLoadError(false);
      } catch {
        setLoadError(true);
      } finally {
        setBusy(false);
      }
    },
    [categories, actorId, from, to, q],
  );

  // Re-reads whenever a filter changes, always from the first page.
  useEffect(() => {
    load(null);
  }, [load]);

  const toggleCategory = useCallback((category: AuditCategory) => {
    setCategories((cur) =>
      cur.includes(category) ? cur.filter((k) => k !== category) : [...cur, category],
    );
  }, []);

  async function saveRetention(value: string) {
    const days = value === "" ? null : Number(value);
    setBusy(true);
    try {
      const res = await fetch("/api/audit/retention", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ retentionDays: days }),
      });
      if (!res.ok) throw new Error(String(res.status));
      await load(null);
    } catch {
      setLoadError(true);
      setBusy(false);
    }
  }

  /**
   * Client-side, like every other Export in this application
   * (`src/client/exportCsv.ts`): the rows are already loaded, so there is no
   * reason to round-trip, and no new endpoint means no new authZ surface —
   * whatever the caller can see is exactly what they can export.
   */
  function exportShown() {
    downloadCsv(
      csvFilename("audit-log"),
      toCsv(
        AUDIT_CSV_HEADERS,
        events.map((e) => [
          e.createdAt,
          e.actor,
          AUDIT_BADGES[e.category].label,
          e.action,
          e.summary,
          e.deckName ?? "",
        ]),
      ),
    );
  }

  const filtered = categories.length > 0 || actorId || from || to || q.trim();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold tracking-tight text-fg">Audit log</h2>
        <p className="mt-0.5 max-w-3xl text-[13px] text-fg-muted">
          Full timestamped trail of all configuration changes, score overrides, team actions, and
          billing events.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <CategoryFilter
          selected={categories}
          onToggle={toggleCategory}
          onClear={() => setCategories([])}
        />
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-fg-muted">
          <label className="sr-only" htmlFor="al-actor">
            Actor
          </label>
          <select
            id="al-actor"
            data-testid="al-actor"
            value={actorId}
            onChange={(e) => setActorId(e.target.value)}
            className="rounded-md border border-line bg-surface px-2 py-1 text-[11px] text-fg"
          >
            <option value="">Anyone</option>
            {(page?.actors ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="al-from">
            From
          </label>
          <input
            id="al-from"
            data-testid="al-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-md border border-line bg-surface px-2 py-1 text-[11px] text-fg"
          />
          <span aria-hidden>–</span>
          <label className="sr-only" htmlFor="al-to">
            To
          </label>
          <input
            id="al-to"
            data-testid="al-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-md border border-line bg-surface px-2 py-1 text-[11px] text-fg"
          />
          <label className="sr-only" htmlFor="al-search">
            Search the trail
          </label>
          <input
            id="al-search"
            data-testid="al-search"
            type="search"
            placeholder="Search…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-36 rounded-md border border-line bg-surface px-2 py-1 text-[11px] text-fg"
          />
        </div>
      </div>

      {loadError && (
        <p role="alert" className="text-[13px] text-signal-flagged">
          Couldn&apos;t load the audit log. Try reloading the console.
        </p>
      )}

      {page === null && !loadError ? (
        <Card>
          <p className="text-sm text-fg-muted">Loading the audit log…</p>
        </Card>
      ) : events.length === 0 ? (
        <Card>
          <EmptyState
            icon="History"
            title={filtered ? "Nothing matches those filters" : "Nothing has been recorded yet"}
            description={
              filtered
                ? "Widen the date range, or clear the category filter."
                : "Configuration changes, score overrides, team actions and billing events appear here as they happen."
            }
          />
        </Card>
      ) : (
        <Card className="p-3" data-testid="al-card">
          {events.map((e) => (
            <LogRow key={e.id} event={e} now={now} />
          ))}
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] text-fg-muted">
        <span data-testid="al-count">
          {events.length} event{events.length === 1 ? "" : "s"}
          {cursor ? " shown" : ""}
        </span>
        <div className="flex items-center gap-3">
          {cursor && (
            <Button variant="ghost" disabled={busy} onClick={() => load(cursor)} data-testid="al-more">
              {busy ? "Loading…" : "Load more"}
            </Button>
          )}
          <button
            type="button"
            data-testid="al-export"
            onClick={exportShown}
            disabled={events.length === 0}
            className="underline underline-offset-2 disabled:opacity-50"
          >
            Export shown
          </button>
          {page?.canConfigure && (
            <span className="flex items-center gap-1.5">
              <label htmlFor="al-retention">Retention</label>
              <select
                id="al-retention"
                data-testid="al-retention"
                value={page.retentionDays ?? ""}
                disabled={busy}
                onChange={(e) => saveRetention(e.target.value)}
                className="rounded-md border border-line bg-surface px-2 py-1 text-[11px] text-fg"
              >
                {AUDIT_RETENTION_CHOICES.map((days) => (
                  <option key={String(days)} value={days ?? ""}>
                    {retentionLabel(days)}
                  </option>
                ))}
              </select>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
