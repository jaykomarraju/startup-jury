// Query screen (Evaluation → Query) — the prototype's `panel-query`.
//
// Aug-2026 issue log:
//   • 15 — two tabs on the top row: FOUNDER QUERIES and EMAIL QUERY.
//   • 16 — tab 1 is Startup · Founder · Phone · Email · Status · Parameters
//          needing response, with a checkbox per row (and select-all). Ticking
//          rows carries those founders to the Email query tab.
//   • 17 — clicking the STARTUP name opens what that founder is asked.
//   • 18 — tab 2 emails the selected startups via Send query.
//
// W7-C brought it to the prototype's three views (`panel-query.html`):
//   • #qview-list    — the `.qtbl`, its topbar Filter / Export, the dark bulk
//                      bar, every area chip, and the three-word status
//                      vocabulary. An answered query stays listed as Responded.
//   • #qview-email   — Recipients, Message, and "Link the founder receives".
//                      EACH founder gets a letter built from their own deck's
//                      areas (F0215), under the Subject typed here (F0216).
//   • #qview-founder — the founder clarification flow, as staff preview it:
//                      completion bar, flagged areas with the bank's questions,
//                      the "sufficient signal" roster and the submit checklist.
//
// Email is recorded, not necessarily sent (§1.4): the confirmation says "sent"
// only when the server reports the outbox actually delivered.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Bot,
  Check,
  CircleCheck,
  Circle,
  Clock,
  Download,
  ExternalLink,
  Eye,
  Filter,
  Flag,
  Leaf,
  ListChecks,
  Mail,
  Send,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { EmptyState, PageToolbar, ToolbarButton } from "../components";
import type { DeckView } from "../types";
import { listDecks, listQueries, listAllQueries, type QueryView } from "../api";
import { fetchDeckScores, fetchLetterDraft, recordQuery, type DeckScores, type QueryLetterDraft } from "../queryApi";
import { downloadCsv, toCsv } from "../exportCsv";
import {
  AREA_KIND_LABELS,
  QUERY_LIST_HEADERS,
  QUERY_STATUS_LABELS,
  SIGNAL_LABELS,
  areasNeedingResponse,
  clarificationFlow,
  composeFounderLetters,
  latestQuery,
  parseQueryTimestamp,
  queryDueAt,
  queryListCsvRow,
  queryStatusOf,
  type FlaggedArea,
  type QueryListStatus,
} from "../../shared/queries";

const DEFAULT_SUBJECT = "Clarification requested on your pitchdeck submission";

/** The prototype's `.q-stat` tints. */
const STATUS_PILL: Record<QueryListStatus, string> = {
  pending: "bg-warn-lt text-[#B45309] dark:text-warn",
  overdue: "bg-red-lt text-red",
  responded: "bg-green-lt text-green",
};

type View = "list" | "email" | "founder";
type StatusFilter = "all" | QueryListStatus;

const VIEW_HEAD: Record<View, { title: string; subtitle: string }> = {
  list: { title: "Founder queries", subtitle: "AI-flagged decks awaiting founder clarification" },
  email: { title: "Email query", subtitle: "Compose a clarification email to selected founders" },
  founder: { title: "Founder clarification flow", subtitle: "What the founder sees for this submission" },
};

/** One founder's letter. `edited` pins it against the bank draft arriving late. */
interface Letter {
  body: string;
  edited: boolean;
}

function plural(n: number, one: string, many = `${one}s`) {
  return n === 1 ? one : many;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The prototype's "4 Jun 2026" — spelled out, because en-GB now prints "Sept". */
function shortDate(value: string | Date): string {
  const d = typeof value === "string" ? parseQueryTimestamp(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function deckMeta(deck: DeckView): string {
  return [deck.sector, deck.stage, deck.city].filter(Boolean).join(" · ");
}

export function QueryPage() {
  const [decks, setDecks] = useState<DeckView[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [allQueries, setAllQueries] = useState<QueryView[]>([]);
  const [view, setView] = useState<View>("list");
  const [founderDeckId, setFounderDeckId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [subject, setSubject] = useState(DEFAULT_SUBJECT);
  const [letters, setLetters] = useState<Record<string, Letter>>({});
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ count: number; delivered: number } | null>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Each view opens at its top, as the prototype's separate scroll panes do.
  useEffect(() => {
    scrollRef.current?.scrollTo?.({ top: 0 });
  }, [view, founderDeckId]);

  useEffect(() => {
    if (!filterOpen) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !filterRef.current?.contains(e.target as Node)) {
        setFilterOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [filterOpen]);

  const load = useCallback(async () => {
    try {
      const [deckRes, queryRes] = await Promise.all([
        // V4-ROUTE — the server's enforced list, not the whole table filtered
        // here. `deckListRoute` has already partitioned Assign from Query, so
        // an evaluated deck marked incomplete arrives HERE and nowhere else.
        listDecks({ list: "query" }),
        // Staff-only listing; a role without it just loses the status history.
        listAllQueries().catch(() => ({ queries: [] as QueryView[] })),
      ]);
      setDecks(deckRes.decks);
      setAllQueries(queryRes.queries);
      setLoadError(false);
    } catch {
      setDecks([]);
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const byDeck = useMemo(() => {
    const map = new Map<string, QueryView[]>();
    for (const q of allQueries) {
      const list = map.get(q.deck_id);
      if (list) list.push(q);
      else map.set(q.deck_id, [q]);
    }
    return map;
  }, [allQueries]);

  // The response IS the list — `deckListRoute` ran on the server, over the same
  // deck view, so re-filtering here could only ever narrow the server's answer
  // behind its back. A worker test asserts the row set on the RESPONSE.
  const rows = useMemo(() => decks ?? [], [decks]);

  const statusOf = useCallback((id: string) => queryStatusOf(byDeck.get(id) ?? []), [byDeck]);

  const visibleRows = useMemo(
    () => (filter === "all" ? rows : rows.filter((d) => statusOf(d.id) === filter)),
    [rows, filter, statusOf],
  );

  const selected = useMemo(() => rows.filter((d) => selectedIds.includes(d.id)), [rows, selectedIds]);
  const preview = selected.find((d) => d.id === previewId) ?? selected[0];

  // Every selected founder gets their OWN letter: composed locally from that
  // deck's areas at once, then replaced by the bank's draft when it arrives —
  // unless the operator has already started editing it.
  useEffect(() => {
    const missing = selected.filter((d) => !letters[d.id]);
    if (missing.length === 0) return;
    const fallback = composeFounderLetters(missing);
    setLetters((prev) => {
      const next = { ...prev };
      for (const l of fallback) if (!next[l.deckId]) next[l.deckId] = { body: l.body, edited: false };
      return next;
    });
    for (const deck of missing) {
      fetchLetterDraft(deck.id)
        .then((draft) => {
          if (!draft.message) return;
          setLetters((prev) => {
            const current = prev[deck.id];
            if (current?.edited) return prev;
            return { ...prev, [deck.id]: { body: draft.message, edited: false } };
          });
        })
        .catch(() => {
          /* keep the locally composed letter */
        });
    }
  }, [selected, letters]);

  function toggle(id: string) {
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
    setResult(null);
  }

  function toggleAll() {
    const ids = visibleRows.map((d) => d.id);
    const all = ids.length > 0 && ids.every((id) => selectedIds.includes(id));
    setSelectedIds(all ? [] : ids);
    setResult(null);
  }

  function clearSelection() {
    setSelectedIds([]);
    setResult(null);
  }

  function openFounder(id: string) {
    setFounderDeckId(id);
    setView("founder");
  }

  function exportRows() {
    const csv = toCsv(
      [...QUERY_LIST_HEADERS],
      visibleRows.map((d) => queryListCsvRow(d, statusOf(d.id))),
    );
    downloadCsv(`founder-queries-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  /** Issue 18 — one query per selected founder, each carrying their own letter. */
  async function sendQuery() {
    const batch = selected.map((deck) => ({ deck, body: letters[deck.id]?.body ?? "" }));
    if (batch.length === 0 || !subject.trim() || batch.some((b) => !b.body.trim())) return;
    setBusy(true);
    setError(null);
    const done: string[] = [];
    let delivered = 0;
    try {
      for (const { deck, body } of batch) {
        const res = await recordQuery(deck.id, { subject: subject.trim(), body });
        done.push(deck.id);
        if (res.delivered === true) delivered += 1;
      }
    } catch {
      setError(
        done.length > 0
          ? `Recorded ${done.length} of ${batch.length} queries, then one failed. The rest are still selected — try again.`
          : "Couldn't record the query. Try again.",
      );
      // Never offer a second send to a founder who already has this letter;
      // the rest stay selected, and Send stays enabled for them.
      setSelectedIds((ids) => ids.filter((id) => !done.includes(id)));
    }
    if (done.length === batch.length) setResult({ count: done.length, delivered });
    if (done.length > 0) await load();
    setBusy(false);
  }

  const founderDeck = founderDeckId ? (decks ?? []).find((d) => d.id === founderDeckId) : undefined;
  const head = VIEW_HEAD[view === "founder" && !founderDeck ? "list" : view];
  const allVisibleSelected =
    visibleRows.length > 0 && visibleRows.every((d) => selectedIds.includes(d.id));
  const someVisibleSelected = visibleRows.some((d) => selectedIds.includes(d.id));

  return (
    <section className="sj-frame">
      <PageToolbar
        title={head.title}
        subtitle={head.subtitle}
        actions={
          <>
            <div className="relative" ref={filterRef}>
              <ToolbarButton
                aria-haspopup="menu"
                aria-expanded={filterOpen}
                onClick={() => setFilterOpen((o) => !o)}
              >
                <Filter className="h-3.5 w-3.5" />
                {filter === "all" ? "Filter" : `Filter · ${QUERY_STATUS_LABELS[filter]}`}
              </ToolbarButton>
              {filterOpen && (
                <div
                  role="menu"
                  aria-label="Filter by status"
                  className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-stone-dk bg-surface py-1 shadow-lg"
                >
                  {(["all", "pending", "overdue", "responded"] as StatusFilter[]).map((f) => (
                    <button
                      key={f}
                      type="button"
                      role="menuitemradio"
                      aria-checked={filter === f}
                      className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[12px] text-fg hover:bg-offwhite"
                      onClick={() => {
                        setFilter(f);
                        setFilterOpen(false);
                        setView("list");
                      }}
                    >
                      {f === "all" ? "All statuses" : QUERY_STATUS_LABELS[f]}
                      {filter === f && <Check className="h-3.5 w-3.5 text-olive-dk" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <ToolbarButton onClick={exportRows} disabled={visibleRows.length === 0}>
              <Download className="h-3.5 w-3.5" />
              Export
            </ToolbarButton>
          </>
        }
      />

      {/* Issue 15 — the two tabs. The flow view hides them, as `qShowTab('founder')` does. */}
      {view !== "founder" && (
        <div
          className="flex shrink-0 gap-[2px] border-b border-stone-dk bg-surface px-[18px]"
          role="tablist"
        >
          <TabButton active={view === "list"} onClick={() => setView("list")} icon={<ListChecks className="h-3.5 w-3.5" />}>
            Founder queries
          </TabButton>
          <TabButton active={view === "email"} onClick={() => setView("email")} icon={<Mail className="h-3.5 w-3.5" />}>
            Email query
            {selected.length > 0 && (
              <span className="rounded-lg bg-gold px-1.5 text-[9px] font-bold leading-[1.4] text-white">
                {selected.length}
              </span>
            )}
          </TabButton>
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto bg-offwhite px-6 py-5">
        {error && (
          <div className="mx-auto mb-3 max-w-[980px] rounded-lg border border-red/30 bg-red-lt px-4 py-2.5 text-[12px] text-red">
            {error}
          </div>
        )}

        {view === "founder" && founderDeck ? (
          <FounderFlow
            deck={founderDeck}
            onBack={() => setView("list")}
            onEmail={() => {
              setSelectedIds([founderDeck.id]);
              setResult(null);
              setView("email");
            }}
          />
        ) : view === "email" ? (
          <div className="mx-auto max-w-[720px]">
            <BackButton onClick={() => setView("list")} />
            <h2 className="mb-[3px] text-[15px] font-bold text-fg">Email query to founders</h2>
            <p className="mb-4 text-[12px] text-fg-muted">
              Send a clarification request by email to the founders selected in the list. Recipients
              reflect your current selection — go back to the list to add or remove founders.
            </p>

            <QCard title="Recipients" icon={<Users className="h-3.5 w-3.5" />}>
              <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-[7px] border border-stone-dk bg-surface p-2">
                {selected.length === 0 ? (
                  <span className="px-1 py-1.5 text-[11.5px] text-fg-muted">
                    No founders selected. Pick founders from the list to email them a query.
                  </span>
                ) : (
                  selected.map((d) => (
                    <span
                      key={d.id}
                      className="inline-flex items-center gap-1.5 rounded-[13px] bg-olive-lt px-[9px] py-1 text-[11px] font-semibold text-olive-dk"
                    >
                      {d.founder ?? d.name} · {d.founderEmail ?? "no email on file"}
                      <button
                        type="button"
                        aria-label={`Remove ${d.name}`}
                        className="opacity-60 hover:opacity-100"
                        onClick={() => toggle(d.id)}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))
                )}
              </div>
            </QCard>

            <QCard title="Message" icon={<Mail className="h-3.5 w-3.5" />}>
              <label className="mb-3 block">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-[.05em] text-fg-muted">
                  Subject
                </span>
                <input
                  className="sj-input w-full"
                  value={subject}
                  onChange={(e) => {
                    setSubject(e.target.value);
                    setResult(null);
                  }}
                />
              </label>

              {selected.length > 1 && preview && (
                <div className="mb-3">
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-bold uppercase tracking-[.05em] text-fg-muted">
                      Letter for
                    </span>
                    <select
                      className="sj-input w-full"
                      value={preview.id}
                      onChange={(e) => setPreviewId(e.target.value)}
                    >
                      {selected.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                          {d.founder ? ` — ${d.founder}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="mt-1 text-[11px] text-fg-muted">
                    Each founder receives their own letter listing only their startup&rsquo;s areas.
                    Founders never see another startup&rsquo;s query.
                  </p>
                </div>
              )}

              <label className="block">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-[.05em] text-fg-muted">
                  Body
                </span>
                <textarea
                  className="sj-input min-h-[150px] w-full font-sans"
                  value={preview ? (letters[preview.id]?.body ?? "") : ""}
                  disabled={!preview}
                  onChange={(e) => {
                    if (!preview) return;
                    const body = e.target.value;
                    setLetters((prev) => ({ ...prev, [preview.id]: { body, edited: true } }));
                    setResult(null);
                  }}
                />
              </label>
              {preview && letters[preview.id]?.edited && (
                <button
                  type="button"
                  className="mt-1 text-[11px] text-fg-muted underline-offset-2 hover:underline"
                  onClick={() =>
                    setLetters((prev) => {
                      const next = { ...prev };
                      delete next[preview.id];
                      return next;
                    })
                  }
                >
                  Reset to the generated message
                </button>
              )}

              <div className="mt-[14px] flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-[5px] text-[11px] text-fg-muted">
                  <ShieldCheck className="h-3.5 w-3.5 text-green" />
                  Founders also see these queries inside their portal
                </div>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-olive-dk px-[18px] py-[9px] text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:bg-stone-dk"
                  disabled={
                    busy ||
                    result !== null ||
                    selected.length === 0 ||
                    !subject.trim() ||
                    selected.some((d) => !letters[d.id]?.body.trim())
                  }
                  onClick={sendQuery}
                >
                  {result ? <Check className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
                  {busy
                    ? "Sending…"
                    : result
                      ? `Query ${result.delivered === result.count ? "sent to" : "recorded for"} ${result.count} ${plural(result.count, "founder")}`
                      : "Send query"}
                </button>
              </div>
              {result && result.delivered < result.count && (
                <p className="mt-2 text-[11px] text-fg-muted">
                  Email delivery isn&rsquo;t set up for this workspace yet, so{" "}
                  {result.delivered > 0
                    ? `${result.count - result.delivered} of these letters were`
                    : result.count === 1
                      ? "the letter was"
                      : "the letters were"}{" "}
                  recorded in the outbox and not emailed.
                </p>
              )}
            </QCard>

            <QCard title="Link the founder receives" icon={<Eye className="h-3.5 w-3.5" />}>
              <p className="mb-3 text-[11.5px] text-fg-muted">
                The email includes a secure link, personal to the startup. The founder opens it to see
                the flagged areas and respond online. Click below to preview what they are asked.
              </p>
              <button
                type="button"
                className="inline-flex items-center gap-[5px] rounded-[7px] bg-gold-dk px-4 py-2 text-[12px] font-semibold text-white disabled:opacity-50"
                disabled={!preview && rows.length === 0}
                onClick={() => openFounder((preview ?? rows[0]).id)}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Respond to your evaluation questions
              </button>
            </QCard>
          </div>
        ) : (
          <div className="mx-auto max-w-[980px]">
            {decks === null ? (
              <p className="py-10 text-center text-[12px] text-fg-muted">Loading…</p>
            ) : loadError ? (
              <EmptyState
                icon="MessageSquare"
                title="Couldn't load founder queries"
                description="Refresh the page to try again."
              />
            ) : rows.length === 0 ? (
              <EmptyState
                icon="MessageSquare"
                title="Nothing to query"
                description="Decks flagged for founder clarification appear here."
              />
            ) : (
              <>
                {selected.length > 0 && (
                  <div className="mb-3 flex items-center justify-between rounded-[9px] bg-olive-dk py-[9px] pl-[14px] pr-2 text-[12px] text-white">
                    <div className="flex items-center gap-2">
                      <span>
                        {selected.length} {plural(selected.length, "founder")} selected
                      </span>
                      <button
                        type="button"
                        className="px-1.5 text-[11px] text-white/70 hover:text-white"
                        onClick={clearSelection}
                      >
                        Clear selection
                      </button>
                    </div>
                    <button
                      type="button"
                      className="inline-flex items-center gap-[5px] rounded-[7px] bg-gold px-[13px] py-[7px] text-[11.5px] font-semibold text-navy hover:bg-gold-dk"
                      onClick={() => setView("email")}
                    >
                      <Mail className="h-3.5 w-3.5" />
                      Email query
                    </button>
                  </div>
                )}

                <div className="overflow-x-auto rounded-[10px] border border-stone-dk bg-surface">
                  <table className="w-full min-w-[56rem] border-collapse text-left">
                    <thead>
                      <tr>
                        <th className="w-[38px] border-b border-stone-dk bg-stone px-[14px] py-[10px] text-center">
                          <input
                            type="checkbox"
                            aria-label="Select all startups"
                            className="h-[15px] w-[15px] cursor-pointer accent-olive-dk"
                            checked={allVisibleSelected}
                            ref={(el) => {
                              if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected;
                            }}
                            onChange={toggleAll}
                          />
                        </th>
                        {QUERY_LIST_HEADERS.map((h) => (
                          <th
                            key={h}
                            className="whitespace-nowrap border-b border-stone-dk bg-stone px-[14px] py-[10px] text-[9.5px] font-bold uppercase tracking-[.05em] text-olive-dk"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.map((deck) => {
                        const status = statusOf(deck.id);
                        const history = byDeck.get(deck.id) ?? [];
                        const latest = latestQuery(history);
                        const areas = areasNeedingResponse(deck);
                        const isSelected = selectedIds.includes(deck.id);
                        return (
                          <tr
                            key={deck.id}
                            className={`border-b border-stone last:border-0 ${isSelected ? "bg-olive-lt" : "hover:bg-offwhite"}`}
                          >
                            <td className="px-[14px] py-[11px] text-center">
                              <input
                                type="checkbox"
                                aria-label={`Select ${deck.name}`}
                                className="h-[15px] w-[15px] cursor-pointer accent-olive-dk"
                                checked={isSelected}
                                onChange={() => toggle(deck.id)}
                              />
                            </td>
                            <td className="px-[14px] py-[11px] text-[12px]">
                              {/* Issue 17 — the startup name opens what its founder is asked. */}
                              <button
                                type="button"
                                className="inline-flex items-center gap-[5px] text-left font-semibold text-olive-dk hover:underline"
                                onClick={() => openFounder(deck.id)}
                              >
                                <Leaf className="h-[13px] w-[13px] shrink-0 text-gold" aria-hidden />
                                {deck.name}
                              </button>
                              <div className="mt-0.5 text-[10.5px] text-fg-muted">{deckMeta(deck) || deck.status}</div>
                            </td>
                            <td className="px-[14px] py-[11px] text-[12px] text-fg">{deck.founder ?? "—"}</td>
                            <td className="whitespace-nowrap px-[14px] py-[11px] text-[11.5px] text-fg-2">
                              {deck.founderPhone ?? "—"}
                            </td>
                            <td className="whitespace-nowrap px-[14px] py-[11px] text-[11.5px] text-fg-2">
                              {deck.founderEmail ?? "—"}
                            </td>
                            <td className="px-[14px] py-[11px]">
                              <span
                                className={`inline-block rounded-[11px] px-[9px] py-[3px] text-[9.5px] font-bold uppercase tracking-[.03em] ${STATUS_PILL[status]}`}
                                title={
                                  latest
                                    ? `Query raised ${shortDate(latest.created_at)}${latest.founder_response ? " · answered" : ` · due ${shortDate(queryDueAt(latest.created_at))}`}`
                                    : "Not emailed yet"
                                }
                              >
                                {QUERY_STATUS_LABELS[status]}
                              </span>
                            </td>
                            <td className="max-w-[300px] px-[14px] py-[11px]">
                              {areas.length > 0 ? (
                                areas.map((a) => (
                                  <span
                                    key={`${a.kind}-${a.label}`}
                                    title={AREA_KIND_LABELS[a.kind]}
                                    className={`my-[2px] mr-1 inline-block whitespace-nowrap rounded-[11px] px-2 py-[2px] text-[10px] leading-[1.4] ${
                                      status === "responded"
                                        ? "bg-[#EAF3E2] text-[#3A4E2E] dark:bg-olive-lt dark:text-olive"
                                        : "bg-[#FBEFD6] text-[#854F0B] dark:bg-gold-lt dark:text-gold-dk"
                                    }`}
                                  >
                                    {a.label}
                                  </span>
                                ))
                              ) : (
                                <span className="text-[10.5px] text-fg-muted">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {visibleRows.length === 0 && (
                        <tr>
                          <td colSpan={7} className="px-[14px] py-6 text-center text-[12px] text-fg-muted">
                            No {filter === "all" ? "" : `${QUERY_STATUS_LABELS[filter as QueryListStatus].toLowerCase()} `}
                            queries.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-[11px] text-[12px] transition-colors ${
        active
          ? "border-gold font-semibold text-olive-dk"
          : "border-transparent font-medium text-fg-muted hover:text-olive-dk"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="mb-[14px] inline-flex items-center gap-[5px] text-[11.5px] font-semibold text-olive-dk hover:text-gold"
      onClick={onClick}
    >
      <ArrowLeft className="h-3.5 w-3.5" /> Back to founder queries
    </button>
  );
}

function QCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-3 rounded-[10px] border border-stone-dk bg-surface p-4">
      <div className="mb-3 flex items-center gap-[5px] text-[10px] font-bold uppercase tracking-[.06em] text-olive-dk">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// #qview-founder — the founder clarification flow, previewed by staff
// ═══════════════════════════════════════════════════════════════════════════

interface FlowData {
  scores: DeckScores | null;
  draft: QueryLetterDraft | null;
  queries: QueryView[];
}

function FounderFlow({ deck, onBack, onEmail }: { deck: DeckView; onBack: () => void; onEmail: () => void }) {
  const [data, setData] = useState<FlowData | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    void Promise.allSettled([fetchDeckScores(deck.id), fetchLetterDraft(deck.id), listQueries(deck.id)]).then(
      ([scores, draft, queries]) => {
        if (cancelled) return;
        setData({
          scores: scores.status === "fulfilled" ? scores.value : null,
          draft: draft.status === "fulfilled" ? draft.value : null,
          queries: queries.status === "fulfilled" ? queries.value.queries : [],
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [deck.id]);

  if (!data) {
    return (
      <div className="mx-auto max-w-[780px]">
        <BackButton onClick={onBack} />
        <p className="py-10 text-center text-[12px] text-fg-muted">Loading…</p>
      </div>
    );
  }

  const flow = clarificationFlow({
    deck,
    scores: data.scores?.scores ?? [],
    questions: data.draft?.questions ?? [],
  });
  const latest = latestQuery(data.queries);
  const responded = Boolean(latest?.founder_response);
  const flaggedCount = flow.flagged.length;
  const withheld = data.scores?.aiScoreWithheld === true;
  const badge = !latest
    ? "Action required — no query sent yet"
    : responded
      ? `Responses received${latest.resolved_at ? ` ${shortDate(latest.resolved_at)}` : ""}`
      : `Action required — responses due by ${shortDate(queryDueAt(latest.created_at))}`;

  return (
    <div className="mx-auto max-w-[780px]">
      <BackButton onClick={onBack} />
      <h2 className="mb-[3px] text-[15px] font-bold text-fg">Founder clarification flow</h2>
      <p className="mb-4 text-[12px] text-fg-muted">
        This is what the founder sees when their pitchdeck is flagged as incomplete. The AI has identified
        areas with weak or absent signal and the questions to ask. The founder responds, and once every
        required area is addressed the deck goes back for evaluation.
      </p>

      <QueryRecordCard queries={data.queries} onEmail={onEmail} />

      <div className="overflow-hidden rounded-xl border border-stone-dk bg-offwhite">
        <div className="flex flex-wrap items-center justify-between gap-2 bg-olive-dk px-5 py-4">
          <div className="text-[13px] font-bold text-white">
            ai.<span className="text-gold">STARTUPJURY</span>
          </div>
          <div className="flex items-center gap-[5px] rounded-[20px] border border-white/10 bg-white/10 px-3 py-1 text-[11px] font-medium text-white/70">
            <Clock className="h-3 w-3" />
            {badge}
          </div>
        </div>

        <div className="p-5">
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-[9px] border border-stone-dk bg-surface p-[14px]">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-olive-lt text-olive">
              <Leaf className="h-[18px] w-[18px]" />
            </div>
            <div>
              <div className="text-[14px] font-bold text-fg">{deck.name}</div>
              <div className="mt-0.5 text-[11px] text-fg-muted">
                {[deckMeta(deck), deck.uploadedAt ? `Submitted ${shortDate(deck.uploadedAt)}` : ""]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
            <div className="ml-auto text-right">
              <div className="rounded-md border border-[#F09595] bg-[#FCEBEB] px-2.5 py-[3px] text-[10px] font-bold text-[#791F1F]">
                ⚑ Clarification required
              </div>
              <div className="mt-[3px] text-[10px] text-fg-muted">
                {flaggedCount === 0
                  ? "No areas need input"
                  : `${flaggedCount} ${plural(flaggedCount, "area")} ${flaggedCount === 1 ? "needs" : "need"} your input`}
              </div>
            </div>
          </div>

          {withheld ? (
            // W9-A — blind scoring withheld the AI area scores from this
            // evaluator (a VC analyst who has not scored the deal yet). The
            // completion figure is computed FROM those scores, so a "0%"
            // here would be invented; say why there is none instead.
            <div className="mb-4 rounded-[9px] bg-surface-2 px-[14px] py-3" data-testid="flow-withheld">
              <div className="mb-1 text-[11.5px] font-semibold text-fg">Deck completion</div>
              <div className="text-[10.5px] text-fg-muted">
                {flaggedCount} {plural(flaggedCount, "area")} {flaggedCount === 1 ? "requires" : "require"} a
                response below · the AI&rsquo;s area scores are withheld until you submit your own evaluation
                (blind scoring)
              </div>
            </div>
          ) : (
          <div className="mb-4 rounded-[9px] bg-surface-2 px-[14px] py-3">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11.5px] font-semibold text-fg">Deck completion</span>
              <span className="font-mono text-[11.5px] font-bold text-gold-dk">{flow.percent}% complete</span>
            </div>
            <div
              className="h-[7px] overflow-hidden rounded bg-stone-dk"
              role="progressbar"
              aria-label="Deck completion"
              aria-valuenow={flow.percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="h-full rounded bg-olive-dk" style={{ width: `${flow.percent}%` }} />
            </div>
            <div className="mt-[5px] text-[10.5px] text-fg-muted">
              {flow.total > 0
                ? `${flow.sufficient.length} of ${flow.total} evaluation areas have sufficient signal · ${flaggedCount} ${plural(flaggedCount, "area")} ${flaggedCount === 1 ? "requires" : "require"} your responses below · ${flow.strongCount} ${plural(flow.strongCount, "area")} ${flow.strongCount === 1 ? "is" : "are"} strong (no action needed)`
                : `${flaggedCount} ${plural(flaggedCount, "area")} ${flaggedCount === 1 ? "requires" : "require"} your responses below · AI area scores are not available for this deck yet`}
            </div>
          </div>
          )}

          <div className="mb-2 text-[11.5px] font-bold uppercase tracking-[.05em] text-fg">
            Areas requiring your input
          </div>
          {flow.flagged.length === 0 && (
            <p className="mb-3 text-[12px] text-fg-muted">
              Nothing outstanding — every required detail is captured and no area is below the
              workspace&rsquo;s threshold.
            </p>
          )}
          {flow.flagged.map((area) => (
            <FlaggedBlock key={`${area.kind}-${area.label}`} area={area} />
          ))}

          {flow.sufficient.length > 0 && (
            <>
              <div className="mb-2 mt-[14px] text-[11.5px] font-bold uppercase tracking-[.05em] text-fg">
                Areas with sufficient signal (no action needed)
              </div>
              {flow.sufficient.map((area) => (
                <div
                  key={area.label}
                  className="mb-2.5 flex items-center gap-2.5 overflow-hidden rounded-[9px] border-[1.5px] border-stone-dk bg-olive-lt px-[14px] py-3"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] bg-olive-lt text-olive">
                    <Check className="h-[15px] w-[15px]" />
                  </div>
                  <div className="flex-1">
                    <div className="text-[12.5px] font-semibold text-fg">{area.label}</div>
                    <div className="mt-px text-[10.5px] text-olive-dk">
                      {area.signal === "strong"
                        ? "Strong signal detected · No questions triggered"
                        : "Moderate signal · Sufficient for evaluation"}
                    </div>
                  </div>
                  <span className="rounded-[5px] bg-olive-lt px-2 py-0.5 text-[10px] font-bold text-[#2D6A2D] dark:text-olive">
                    {SIGNAL_LABELS[area.signal]}
                  </span>
                </div>
              ))}
            </>
          )}

          <div className="mt-4 rounded-[9px] border border-stone-dk bg-surface p-4">
            <div className="mb-2.5 text-[13px] font-semibold text-fg">Ready to submit your responses?</div>
            <ul className="mb-[14px] flex flex-col gap-1.5" aria-label="Submission checklist">
              {flow.flagged.map((area) => (
                <li
                  key={`${area.kind}-${area.label}`}
                  className={`flex items-center gap-2 text-[12px] ${responded ? "text-olive-dk" : "text-fg-muted"}`}
                >
                  {responded ? (
                    <CircleCheck className="h-3.5 w-3.5 shrink-0 text-olive" />
                  ) : (
                    <Circle className="h-3.5 w-3.5 shrink-0" />
                  )}
                  {checklistLine(area, responded)}
                </li>
              ))}
            </ul>
            <button
              type="button"
              disabled
              className="flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-[9px] bg-stone-dk p-[13px] text-[14px] font-bold text-white"
            >
              <Send className="h-4 w-4" />
              {responded ? "Responses submitted" : "Submit responses — complete all required answers first"}
            </button>
            <div className="mt-2 text-center text-[10.5px] text-fg-muted">
              Once submitted, the deck goes back into evaluation and its status is updated when the review
              completes.
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-stone-dk bg-offwhite px-5 py-[14px]">
          <div className="flex items-center gap-[5px] text-[10.5px] text-fg-muted">
            <ShieldCheck className="h-3 w-3 text-olive" />
            Your responses are confidential and shared only with the evaluation panel
          </div>
          <div className="text-[11px] text-gold-dk">Need help? Contact the programme team</div>
        </div>
      </div>
    </div>
  );
}

function checklistLine(area: FlaggedArea, responded: boolean): string {
  if (responded) return `${area.label} — answered in the founder's response`;
  if (area.kind === "section") return `${area.label} — add this section to an updated deck`;
  if (area.kind === "detail") return `${area.label} — provide the missing detail`;
  if (area.questions.length === 0) return `${area.label} — response needed`;
  return `${area.label} — 0 of ${area.questions.length} ${plural(area.questions.length, "question")} answered`;
}

function FlaggedBlock({ area }: { area: FlaggedArea }) {
  return (
    <div className="mb-2.5 overflow-hidden rounded-[9px] border-[1.5px] border-stone-dk">
      <div className="flex items-center gap-2.5 border-b border-gold/30 bg-[#FDF6EB] px-[14px] py-3 dark:bg-gold-lt">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] bg-[#FDF6EB] text-gold-dk dark:bg-gold-lt">
          <Flag className="h-[15px] w-[15px]" />
        </div>
        <div className="flex-1">
          <div className="text-[12.5px] font-semibold text-fg">{area.label}</div>
          <div className="mt-0.5 text-[10.5px] text-gold-dk">
            {area.kind === "parameter"
              ? `AI detected ${area.signal === "absent" ? "absent" : "weak"} signal${area.weight ? ` · Weight ${area.weight}%` : ""}`
              : AREA_KIND_LABELS[area.kind]}
          </div>
        </div>
        <span
          className={`rounded-[5px] px-2 py-0.5 text-[10px] font-bold ${
            area.signal === "absent" ? "bg-stone text-fg-2" : "bg-[#FCEBEB] text-[#791F1F]"
          }`}
        >
          {SIGNAL_LABELS[area.signal]}
        </span>
      </div>
      <div className="bg-surface p-[14px]">
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-[#7DCAA8] bg-olive-lt px-3 py-2.5 text-[11.5px] leading-normal text-olive-dk">
          <Bot className="mt-px h-3.5 w-3.5 shrink-0" />
          <div>
            <strong>What the AI found:</strong> {area.found}
          </div>
        </div>
        {area.questions.map((q, i) => (
          <div key={q} className="mb-3">
            <div className="mb-1.5 flex items-start gap-1.5 text-[12px] font-medium text-fg">
              <span className="mt-0.5 shrink-0 rounded bg-offwhite px-[5px] py-0.5 font-mono text-[9px] font-bold text-fg-muted">
                Q{i + 1}
              </span>
              {q}
            </div>
            <textarea
              readOnly
              aria-label={`${area.label} — question ${i + 1}`}
              placeholder="The founder types their answer here…"
              className="min-h-[72px] w-full resize-y rounded-[7px] border border-stone-dk bg-surface px-2.5 py-[9px] text-[12px] leading-normal"
            />
            <div className="mt-[3px] text-right text-[10px] text-fg-muted">0 / 500 characters</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Staff-only: what was actually asked, and the founder's answer (F0214). */
function QueryRecordCard({ queries, onEmail }: { queries: QueryView[]; onEmail: () => void }) {
  const ordered = [...queries].sort(
    (a, b) => parseQueryTimestamp(b.created_at).getTime() - parseQueryTimestamp(a.created_at).getTime(),
  );
  return (
    <QCard title={`Queries on record · ${queries.length}`} icon={<Mail className="h-3.5 w-3.5" />}>
      {ordered.length === 0 ? (
        <p className="text-[12px] text-fg-muted">No query has been sent to this founder yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {ordered.map((q) => {
            const status = queryStatusOf([q]);
            return (
              <li key={q.id} className="rounded-lg border border-stone-dk px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-fg-muted">Query raised {shortDate(q.created_at)}</span>
                  <span
                    className={`inline-block rounded-[11px] px-[9px] py-[3px] text-[9.5px] font-bold uppercase tracking-[.03em] ${STATUS_PILL[status]}`}
                  >
                    {QUERY_STATUS_LABELS[status]}
                  </span>
                </div>
                <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-[12px] text-fg">{q.questions}</p>
                {q.founder_response && (
                  <div className="mt-2 rounded-md bg-green-lt px-3 py-2">
                    <div className="text-[10px] font-bold uppercase tracking-[.05em] text-green">Founder response</div>
                    <p className="mt-0.5 whitespace-pre-wrap text-[12px] text-fg">{q.founder_response}</p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <button
        type="button"
        className="mt-3 inline-flex items-center gap-[5px] rounded-[7px] border border-stone-dk bg-surface px-3 py-1.5 text-[11.5px] font-semibold text-olive-dk hover:bg-offwhite"
        onClick={onEmail}
      >
        <Mail className="h-3.5 w-3.5" /> Email this founder
      </button>
    </QCard>
  );
}
