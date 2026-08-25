// Session 7 — the call screens: Intro calls (both editions), Partner call and
// Alignment call (VC). These were `StubPage` on the VC side and a plain stage
// list on the incubator side; they are now the real scheduling surface.
//
// Layout follows the prototypes' `#panel-introcalls` / `#panel-partnercall` /
// `#panel-alignmentcall` tables — Startup · AI score · Avg. score · Call
// scheduled · Call date · Schedule call — plus the stage's own decision buttons
// (Sponsor to IC, Issue term sheet…) which the prototype renders as an outcome
// select in the last column.
//
// ONE deliberate deviation from the prototype, per FINISH-PLAN §8: the
// prototype's "Schedule call" modal ends in a Google/Zoom/Teams **deep link**
// that opens the organizer's own calendar composer. §8 settled on a universal
// **`.ics`** instead, so the modal captures a real date, duration, location and
// participant list, and the app emits the invite. The three providers survive as
// location presets, which is the part of that UI that carried information.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { CalendarPlus, CalendarCheck, Download, Mail, X, BarChart3 } from "lucide-react";
import {
  Button,
  Card,
  Badge,
  EmptyState,
  ScoreChip,
  EvaluationDrawer,
  EvaluationReportModal,
} from "../components";
import { useAuth } from "../auth/useAuth";
import {
  listDecks,
  getDeck,
  listDeckVersions,
  listCalls,
  listCallDirectory,
  scheduleCall,
  updateCall,
  sendCallInvite,
  transitionDeck,
  sendSignup,
  callIcsUrl,
  ApiError,
  type CallView,
  type DirectoryPerson,
  type DeckVersionView,
} from "../api";
import type { DeckView, DeckAction } from "../types";
import type { CallKind } from "../../shared/roles";
import { navItemById, navLabel } from "../../shared/nav";
import { icsFilename } from "../../shared/ics";
import type { ExtractionSlide, ParamScoreView } from "../components";

export interface CallsConfig {
  title: string;
  subtitle: string;
  /** The one call kind this screen schedules. */
  kind: CallKind;
  /** Deck stages that appear in the table. */
  statuses: string[];
  /** Column header for the human-score column (Jury vs Analyst per edition). */
  emptyTitle: string;
  emptyDescription: string;
  /**
   * Inline fields captured alongside one action and sent as extra body fields
   * (the alignment call's term-sheet valuation/ownership). Carried over from
   * `StagePage` so moving these screens onto the scheduler loses nothing.
   */
  capture?: { action: string; fields: { name: "valuation" | "ownership"; label: string }[] };
}

const LOCATION_PRESETS = [
  { label: "Google Meet", value: "Google Meet" },
  { label: "Zoom", value: "Zoom" },
  { label: "Microsoft Teams", value: "Microsoft Teams" },
];

const DURATIONS = [15, 30, 45, 60, 90];

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** ISO → the `value` a datetime-local input wants (local time, no timezone). */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface DraftParticipant {
  email: string;
  name: string | null;
  userId: string | null;
  kind: "organizer" | "team" | "founder";
}

export function CallsPage({ config }: { config: CallsConfig }) {
  const { user } = useAuth();
  const { navId } = useParams();
  // Read-only participants see the nav's per-role label ("My Intro calls"), so
  // the page heading matches the sidebar item they clicked.
  const navItem = user && navId ? navItemById(user.edition, navId) : undefined;
  const heading = user && navItem ? navLabel(user.role, navItem) : config.title;
  const [decks, setDecks] = useState<DeckView[] | null>(null);
  const [calls, setCalls] = useState<CallView[]>([]);
  const [canSchedule, setCanSchedule] = useState(false);
  const [directory, setDirectory] = useState<DirectoryPerson[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [captured, setCaptured] = useState<Record<string, { valuation?: string; ownership?: string }>>({});

  // Report drawer (same behaviour as the stage screens).
  const [selected, setSelected] = useState<DeckView | null>(null);
  // Aug-2026 issue 27 — the "Addl. Parameter scores" column opens the
  // consolidated report on its additional-parameters tab.
  const [reportFor, setReportFor] = useState<DeckView | null>(null);
  const [report, setReport] = useState<{
    scores: ParamScoreView[];
    extraction: ExtractionSlide[];
    verdict?: string;
    versions?: DeckVersionView[];
  } | null>(null);

  // Modal state.
  const [modalDeck, setModalDeck] = useState<DeckView | null>(null);
  const [editing, setEditing] = useState<CallView | null>(null);
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [duration, setDuration] = useState(30);
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [founderEmail, setFounderEmail] = useState("");
  const [extraEmail, setExtraEmail] = useState("");
  const [extras, setExtras] = useState<string[]>([]);
  const [sendInvite, setSendInvite] = useState(true);

  const load = useCallback(async () => {
    try {
      const [deckRes, callRes] = await Promise.all([listDecks(), listCalls({ kind: config.kind })]);
      setDecks(deckRes.decks);
      setCalls(callRes.calls);
      setCanSchedule(callRes.canSchedule);
      setError(null);
    } catch {
      setError("Couldn't load calls.");
      setDecks([]);
    }
  }, [config.kind]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!canSchedule) return;
    listCallDirectory()
      .then((r) => setDirectory(r.people))
      .catch(() => setDirectory([]));
  }, [canSchedule]);

  useEffect(() => {
    if (!selected) {
      setReport(null);
      return;
    }
    let live = true;
    void (async () => {
      const detail = await getDeck(selected.id).catch(() => null);
      const versions = await listDeckVersions(selected.id).catch(() => ({ versions: [] }));
      if (!live || !detail) return;
      setReport({
        scores: detail.scores,
        extraction: detail.extraction,
        verdict: detail.verdict,
        versions: versions.versions,
      });
    })();
    return () => {
      live = false;
    };
  }, [selected]);

  const callsByDeck = useMemo(() => {
    const map = new Map<string, CallView>();
    // Newest scheduled call per deck wins the row's summary cells.
    for (const call of calls) if (!map.has(call.deckId)) map.set(call.deckId, call);
    return map;
  }, [calls]);

  const rows = useMemo(() => {
    const list = decks ?? [];
    const inStage = list.filter((d) => d.statusId && config.statuses.includes(d.statusId));
    if (canSchedule) return inStage;
    // Read-only participants (jury, IC members, analysts) see only the decks
    // they're actually on a call for — not the whole stage.
    const mine = new Set(calls.map((c) => c.deckId));
    return inStage.filter((d) => mine.has(d.id));
  }, [decks, calls, canSchedule, config.statuses]);

  const scheduledCount = rows.filter((d) => callsByDeck.get(d.id)?.scheduledAt).length;

  function openModal(deck: DeckView, existing?: CallView) {
    setModalDeck(deck);
    setEditing(existing ?? null);
    setTitle(existing?.title ?? `${deck.name} — ${config.title.toLowerCase()}`);
    setWhen(toLocalInput(existing?.scheduledAt ?? null));
    setDuration(existing?.durationMinutes ?? 30);
    setLocation(existing?.location ?? "");
    setNotes(existing?.notes ?? "");
    setSendInvite(true);
    setExtraEmail("");
    if (existing) {
      const byUser: Record<string, boolean> = {};
      const founder = existing.participants.find((p) => p.kind === "founder");
      const extra: string[] = [];
      for (const p of existing.participants) {
        if (p.userId) byUser[p.userId] = true;
        else if (p.kind !== "founder") extra.push(p.email);
      }
      setPicked(byUser);
      setFounderEmail(founder?.email ?? "");
      setExtras(extra);
    } else {
      setPicked(user ? { [user.id]: true } : {});
      setFounderEmail(deck.founderEmail ?? "");
      setExtras([]);
    }
  }

  const closeModal = useCallback(() => {
    setModalDeck(null);
    setEditing(null);
  }, []);

  // Escape closes the scheduling modal, matching the deck viewer's lightbox.
  // Listening on the document rather than the dialog element means it works
  // before the user has focused anything inside.
  useEffect(() => {
    if (!modalDeck) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [modalDeck, closeModal]);

  function draftParticipants(): DraftParticipant[] {
    const out: DraftParticipant[] = [];
    for (const person of directory) {
      if (!picked[person.id]) continue;
      out.push({
        email: person.email,
        name: person.name,
        userId: person.id,
        kind: person.id === user?.id ? "organizer" : "team",
      });
    }
    if (founderEmail.trim()) {
      out.push({
        email: founderEmail.trim(),
        name: modalDeck?.founder ?? null,
        userId: null,
        kind: "founder",
      });
    }
    for (const email of extras) out.push({ email, name: null, userId: null, kind: "team" });
    return out;
  }

  /** Issue 27 — close a call out from the "Call completed" column. */
  async function markCompleted(call: CallView) {
    setBusy(call.id);
    setNotice(null);
    try {
      await updateCall(call.id, { status: "completed" });
      await load();
      setNotice(`${call.deckName}'s ${config.title.toLowerCase()} marked completed.`);
    } catch {
      setError("Couldn't mark the call completed. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!modalDeck || busy) return;
    setBusy("save");
    setNotice(null);
    try {
      const participants = draftParticipants();
      // `datetime-local` gives local wall-clock; `new Date(...)` interprets it in
      // the browser's zone and `.toISOString()` normalises it to UTC, which is
      // what the ICS builder emits.
      const scheduledAt = when ? new Date(when).toISOString() : null;
      if (editing) {
        const res = await updateCall(editing.id, {
          scheduledAt,
          durationMinutes: duration,
          title,
          location,
          notes,
          participants,
          sendInvite: sendInvite && !!scheduledAt,
        });
        setNotice(
          `Updated ${modalDeck.name}'s ${config.title.toLowerCase()}${res.invited ? ` · invite re-sent to ${res.invited}` : ""}.`,
        );
      } else {
        const res = await scheduleCall({
          deckId: modalDeck.id,
          kind: config.kind,
          scheduledAt,
          durationMinutes: duration,
          title,
          location,
          notes,
          participants,
          sendInvite: sendInvite && !!scheduledAt,
        });
        setNotice(
          `Scheduled ${modalDeck.name}${res.invited ? ` · invite sent to ${res.invited} participant${res.invited === 1 ? "" : "s"}` : ""}${
            res.advanced ? " · deck moved to Intro" : ""
          }.`,
        );
      }
      closeModal();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save that call.");
    } finally {
      setBusy(null);
    }
  }

  async function invite(call: CallView) {
    setBusy(call.id);
    try {
      const res = await sendCallInvite(call.id);
      setNotice(`Invite sent to ${res.invited} participant${res.invited === 1 ? "" : "s"}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't send the invite.");
    } finally {
      setBusy(null);
    }
  }

  async function runAction(deck: DeckView, action: DeckAction) {
    setBusy(`${deck.id}:${action.action}`);
    setError(null);
    try {
      if (action.action === "send_signup") await sendSignup(deck.id);
      else {
        const extra = config.capture?.action === action.action ? captured[deck.id] : undefined;
        await transitionDeck(deck.id, action.action, undefined, extra);
      }
      await load();
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "below_shortlist_minimum"
          ? err.message
          : `Couldn't ${action.label.toLowerCase()}. Try again.`,
      );
    } finally {
      setBusy(null);
    }
  }

  const selectedCount = Object.values(picked).filter(Boolean).length + (founderEmail.trim() ? 1 : 0) + extras.length;

  return (
    <div className="flex flex-col gap-5 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-fg">{heading}</h1>
          <p className="mt-1 text-sm text-fg-muted">{config.subtitle}</p>
        </div>
        <Badge tone="info">{rows.length}</Badge>
      </div>

      {error ? (
        <div className="rounded-lg border border-signal-weak/40 bg-signal-weak/10 px-3 py-2 text-sm text-fg">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-lg border border-positive/40 bg-positive/10 px-3 py-2 text-sm text-fg">
          {notice}
        </div>
      ) : null}

      {decks === null ? (
        <p className="text-sm text-fg-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState icon="Phone" title={config.emptyTitle} description={config.emptyDescription} />
      ) : (
        <Card flush>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1240px] text-left">
              <thead>
                <tr className="border-b border-line text-fg-muted">
                  {/* Aug-2026 issue 27 — the design's column set. */}
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Startup</th>
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">AI score</th>
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Jury score</th>
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Avg. score</th>
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">
                    Addl. Parameter scores
                  </th>
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Call scheduled</th>
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Call date</th>
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Call completed</th>
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Scheduler</th>
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((deck) => {
                  const call = callsByDeck.get(deck.id);
                  const actions = deck.actions ?? [];
                  return (
                    <tr key={deck.id} className="border-b border-line/60 last:border-0">
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          className="text-sm font-medium text-fg underline-offset-2 hover:underline"
                          onClick={() => setSelected(deck)}
                        >
                          {deck.name}
                        </button>
                        <div className="text-xs text-fg-muted">{deck.sector ?? deck.founder ?? "—"}</div>
                      </td>
                      <td className="px-4 py-3">
                        <ScoreChip value={deck.aiScore} />
                      </td>
                      <td className="px-4 py-3 font-mono text-sm text-fg">
                        {deck.juryScore !== undefined ? deck.juryScore.toFixed(1) : "—"}
                      </td>
                      <td className="px-4 py-3 font-mono text-sm text-fg">
                        {deck.decisionScore !== undefined ? deck.decisionScore.toFixed(2) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <Button variant="secondary" size="sm" onClick={() => setReportFor(deck)}>
                          <BarChart3 className="mr-1 h-3.5 w-3.5" /> View scores
                        </Button>
                      </td>
                      <td className="px-4 py-3">
                        {call?.status === "cancelled" ? (
                          <Badge tone="danger">Cancelled</Badge>
                        ) : call?.scheduledAt ? (
                          <Badge tone="positive">Scheduled</Badge>
                        ) : (
                          <Badge tone="neutral">Not scheduled</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-fg-muted">{fmtDateTime(call?.scheduledAt ?? null)}</td>
                      <td className="px-4 py-3">
                        {call?.status === "completed" ? (
                          <Badge tone="positive">Completed</Badge>
                        ) : call && canSchedule && call.scheduledAt ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy === call.id}
                            onClick={() => markCompleted(call)}
                          >
                            Mark completed
                          </Button>
                        ) : (
                          <span className="text-sm text-fg-muted">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-fg-muted">
                        {call?.organizerName ?? (canSchedule ? "You, on scheduling" : "—")}
                        {call?.participants.length ? (
                          <div className="mt-0.5">
                            {call.participants.length} participant
                            {call.participants.length === 1 ? "" : "s"}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          {call ? (
                            <a
                              className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs text-fg-muted hover:text-fg"
                              href={callIcsUrl(call.id)}
                              // A valueless `download` makes the browser name the
                              // file from the URL path ("ics"); name it explicitly.
                              download={icsFilename(call.title)}
                            >
                              <Download className="h-3.5 w-3.5" /> .ics
                            </a>
                          ) : null}
                          {call && canSchedule && call.scheduledAt ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={busy === call.id}
                              onClick={() => invite(call)}
                            >
                              <Mail className="mr-1 h-3.5 w-3.5" /> Email invite
                            </Button>
                          ) : null}
                          {canSchedule ? (
                            <Button variant="secondary" size="sm" onClick={() => openModal(deck, call)}>
                              {call ? (
                                <>
                                  <CalendarCheck className="mr-1 h-3.5 w-3.5" /> Reschedule
                                </>
                              ) : (
                                <>
                                  <CalendarPlus className="mr-1 h-3.5 w-3.5" /> Schedule call
                                </>
                              )}
                            </Button>
                          ) : null}
                          {config.capture && actions.some((a) => a.action === config.capture!.action)
                            ? config.capture.fields.map((f) => (
                                <input
                                  key={f.name}
                                  className="sj-input h-8 w-24 py-0 text-xs"
                                  placeholder={f.label}
                                  aria-label={f.label}
                                  value={captured[deck.id]?.[f.name] ?? ""}
                                  onChange={(e) =>
                                    setCaptured((cap) => ({
                                      ...cap,
                                      [deck.id]: { ...cap[deck.id], [f.name]: e.target.value },
                                    }))
                                  }
                                />
                              ))
                            : null}
                          {actions.map((a) => (
                            <Button
                              key={a.action}
                              size="sm"
                              variant={a.to === "rejected" || a.to === "archived" ? "secondary" : "primary"}
                              disabled={busy === `${deck.id}:${a.action}`}
                              onClick={() => runAction(deck, a)}
                            >
                              {a.label}
                            </Button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="border-t border-line px-4 py-2 text-xs text-fg-muted">
            {rows.length} startup{rows.length === 1 ? "" : "s"} · {scheduledCount} scheduled ·{" "}
            {rows.length - scheduledCount} not scheduled
          </div>
        </Card>
      )}

      {modalDeck ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-4 backdrop-blur-[1px]"
          role="dialog"
          aria-modal="true"
          aria-label={`${editing ? "Reschedule" : "Schedule"} ${config.title.toLowerCase()} for ${modalDeck.name}`}
        >
          <Card className="max-h-[88vh] w-full max-w-xl overflow-y-auto">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-fg">
                  {editing ? "Reschedule" : "Schedule"} {config.title.toLowerCase()}
                </h2>
                <p className="mt-0.5 text-xs text-fg-muted">
                  For {modalDeck.name} · pick participants across roles, then a date. Everyone gets a
                  standard .ics invite that works in Outlook, Gmail and Apple Calendar.
                </p>
              </div>
              <button type="button" aria-label="Close" onClick={closeModal} className="text-fg-muted hover:text-fg">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-xs text-fg-muted">
                Meeting title
                <input className="sj-input" value={title} onChange={(e) => setTitle(e.target.value)} />
              </label>

              <div className="flex flex-wrap gap-3">
                <label className="flex flex-1 flex-col gap-1 text-xs text-fg-muted">
                  Date &amp; time
                  <input
                    className="sj-input"
                    type="datetime-local"
                    aria-label="Date and time"
                    value={when}
                    onChange={(e) => setWhen(e.target.value)}
                  />
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-fg-muted">
                  Duration
                  <select
                    className="sj-input"
                    aria-label="Duration"
                    value={duration}
                    onChange={(e) => setDuration(Number(e.target.value))}
                  >
                    {DURATIONS.map((d) => (
                      <option key={d} value={d}>
                        {d} min
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="flex flex-col gap-1 text-xs text-fg-muted">
                Where
                <input
                  className="sj-input"
                  placeholder="Meeting link or room"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                />
              </label>
              <div className="flex flex-wrap gap-1.5">
                {LOCATION_PRESETS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    aria-label={`Set location to ${p.label}`}
                    className="rounded-full border border-line px-2.5 py-1 text-xs text-fg-muted hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber"
                    onClick={() => setLocation(p.value)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <div>
                <div className="u-label mb-1 text-fg-muted">Participants (select across roles)</div>
                <div className="max-h-40 overflow-y-auto rounded-lg border border-line p-2">
                  {directory.length === 0 ? (
                    <p className="text-xs text-fg-muted">No team directory available.</p>
                  ) : (
                    directory.map((p) => (
                      <label key={p.id} className="flex items-center gap-2 py-1 text-sm text-fg">
                        <input
                          type="checkbox"
                          checked={!!picked[p.id]}
                          onChange={(e) => setPicked((prev) => ({ ...prev, [p.id]: e.target.checked }))}
                        />
                        {p.name}
                        <span className="text-xs text-fg-muted">· {p.email}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>

              <label className="flex flex-col gap-1 text-xs text-fg-muted">
                Founder email (any domain)
                <input
                  className="sj-input"
                  placeholder="founder@company.com"
                  aria-label="Founder email"
                  value={founderEmail}
                  onChange={(e) => setFounderEmail(e.target.value)}
                />
              </label>

              <div className="flex flex-col gap-1 text-xs text-fg-muted">
                Additional guests
                <div className="flex gap-2">
                  <input
                    className="sj-input"
                    placeholder="advisor@example.com"
                    aria-label="Additional guest email"
                    value={extraEmail}
                    onChange={(e) => setExtraEmail(e.target.value)}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      const email = extraEmail.trim();
                      if (!email) return;
                      setExtras((prev) => (prev.includes(email) ? prev : [...prev, email]));
                      setExtraEmail("");
                    }}
                  >
                    Add
                  </Button>
                </div>
                {extras.length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {extras.map((email) => (
                      <button
                        key={email}
                        type="button"
                        aria-label={`Remove guest ${email}`}
                        className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs text-fg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber"
                        onClick={() => setExtras((prev) => prev.filter((e) => e !== email))}
                      >
                        {email} <X className="h-3 w-3" aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <label className="flex items-center gap-2 text-sm text-fg">
                <input type="checkbox" checked={sendInvite} onChange={(e) => setSendInvite(e.target.checked)} />
                Email the .ics invite to everyone now
              </label>

              <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
                <span className="text-xs text-fg-muted">
                  {selectedCount} participant{selectedCount === 1 ? "" : "s"} selected
                </span>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={closeModal}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={save} disabled={selectedCount === 0 || busy === "save"}>
                    {editing ? "Save changes" : "Schedule call"}
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        </div>
      ) : null}

      {selected ? (
        <EvaluationDrawer
          open
          onClose={() => setSelected(null)}
          deck={selected}
          verdict={report?.verdict}
          scores={report?.scores ?? []}
          extraction={report?.extraction ?? []}
          versions={report?.versions ?? []}
        />
      ) : null}

      {reportFor ? (
        <EvaluationReportModal
          deckId={reportFor.id}
          deckName={reportFor.name}
          initialTab="additional"
          onClose={() => setReportFor(null)}
        />
      ) : null}
    </div>
  );
}

/** Screen configs — one per call-bearing nav slug, per edition. */
export const INCUBATOR_CALLS_CONFIG: Record<string, CallsConfig> = {
  introcalls: {
    title: "Intro calls",
    subtitle:
      "Shortlisted startups · the programme manager decides and schedules the intro call, or delegates it to the associate",
    kind: "intro",
    statuses: ["shortlisted", "intro"],
    emptyTitle: "No intro calls yet",
    emptyDescription: "Decks appear here once the jury shortlists them.",
  },
};

export const VC_CALLS_CONFIG: Record<string, CallsConfig> = {
  introcalls: {
    title: "Intro calls",
    subtitle: "Founder intro calls run by the investment associate before a deal goes to the partner",
    kind: "intro",
    statuses: ["associate_review", "partner_review"],
    emptyTitle: "No intro calls yet",
    emptyDescription: "Deals reach this screen once the analyst submits their core scores.",
  },
  partnercall: {
    title: "Partner call",
    subtitle:
      "Partner conviction call with the founder · log the call and decide whether to sponsor the deal into IC",
    kind: "partner",
    statuses: ["partner_call"],
    emptyTitle: "No deals at partner call",
    emptyDescription: "Deals arrive here when a partner advances them from partner review.",
  },
  alignmentcall: {
    title: "Alignment call",
    subtitle:
      "Post-IC term alignment with the founder · confirm valuation and key terms, then issue the term sheet",
    kind: "alignment",
    statuses: ["alignment_call"],
    emptyTitle: "No alignment calls",
    emptyDescription: "Deals arrive here after the Managing Partner decides to invest.",
    capture: {
      action: "issue_term_sheet",
      fields: [
        { name: "valuation", label: "Valuation" },
        { name: "ownership", label: "Ownership %" },
      ],
    },
  },
};
