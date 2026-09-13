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
// location presets, and (W7-F, F0617) the Google Calendar and Outlook composer
// links are offered ALONGSIDE the invite for an organizer who prefers them.
//
// W7-F — the frame, toolbar, footer legend, slide-over and the jury's own
// column set are declared per screen in `CallsConfig`, exactly as `StageConfig`
// declares them for the stage screens, so the VC call screens (`W9-E`) opt in
// rather than inherit the incubator's shape.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { CalendarPlus, CalendarDays, Download, Sparkles, X, BarChart3, Archive, Table2 } from "lucide-react";
import {
  Button,
  Card,
  Badge,
  EmptyState,
  EvaluationDrawer,
  EvaluationReportModal,
  PageToolbar,
  ToolbarButton,
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
  type DeckReportMatrix,
} from "../api";
import type { DeckView, DeckAction } from "../types";
import { CALL_KIND_LABELS, ROLE_LABELS, type CallKind, type Role } from "../../shared/roles";
import { navItemById, navLabel } from "../../shared/nav";
import { icsFilename } from "../../shared/ics";
import { exportDecks } from "../exportCsv";
import type { ExtractionSlide, ParamScoreView } from "../components";
import {
  AllScores,
  BandScore,
  builtinTab,
  DeckSlides,
  DetailPane,
  FilterMenu,
  Sparkline,
  StageFooter,
  scoreColor,
  useReportMatrices,
  usePaneEvaluation,
  type FilterOption,
  type LegendItem,
  type PaneTabId,
} from "./StageKit";

export interface CallsConfig {
  title: string;
  subtitle: string;
  /** The one call kind this screen schedules. */
  kind: CallKind;
  /** Deck stages that appear in the table. */
  statuses: string[];
  emptyTitle: string;
  emptyDescription: string;
  /**
   * Inline fields captured alongside one action and sent as extra body fields
   * (the alignment call's term-sheet valuation/ownership). Carried over from
   * `StagePage` so moving these screens onto the scheduler loses nothing.
   */
  capture?: { action: string; fields: { name: "valuation" | "ownership"; label: string }[] };

  // ── W7-F — each of these draws nothing when omitted ────────────────────────
  /** `.tbr` — the primary Schedule button (its label), Filter and Export. */
  toolbar?: { schedule?: string; filter?: boolean; export?: boolean };
  /** `.nc-foot` — the three-dot legend and `N <footerNoun>s · N scheduled · N completed`. */
  footer?: { noun: string };
  /** The row slide-over's tabs; declared → the startup name opens it. */
  subTabs?: PaneTabId[];
  /** The AI's suggested questions (`GET /api/calls/:id/prompts`) at the top of the pane. */
  aiQuestions?: boolean;
  /** One score per evaluator in the Jury score cell (`pipelineScoreCells`), from the report. */
  juryStack?: boolean;
  /** Non-schedulers get the Jury prototype's "My intro calls" columns (`AISJ_IC_Jury_V4`). */
  participantColumns?: "jury";
}

const LOCATION_PRESETS = [
  { label: "Google Meet", value: "Google Meet" },
  { label: "Zoom", value: "Zoom" },
  { label: "Microsoft Teams", value: "Microsoft Teams" },
];

const DURATIONS = [15, 30, 45, 60, 90];

/** The viewer's own zone, named on every time this screen prints (F0619). */
const ZONE = (() => {
  try {
    return (
      new Intl.DateTimeFormat("en-GB", { timeZoneName: "short" })
        .formatToParts(new Date())
        .find((p) => p.type === "timeZoneName")?.value ?? ""
    );
  } catch {
    return "";
  }
})();
const ZONE_ID = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "";
  }
})();

function validDate(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "19 Jun 2026" — the prototype's Call date. */
function fmtDate(iso: string | null): string {
  const d = validDate(iso);
  return d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
}

/** "3:00 PM IST" — the Jury prototype's Call time, with the zone it is in. */
function fmtTime(iso: string | null): string {
  const d = validDate(iso);
  if (!d) return "—";
  const t = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  return ZONE ? `${t} ${ZONE}` : t;
}

/** ISO → the `value` a datetime-local input wants (local time, no timezone). */
function toLocalInput(iso: string | null): string {
  const d = validDate(iso);
  if (!d) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/** A stable avatar tint per person (`.nccall-uav`). */
const AVATAR_TINTS = ["var(--olive)", "var(--blue-dk)", "var(--gold-dk)", "#6D28D9", "#047857", "var(--red)"];
function tint(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length]!;
}

/** Where a row's call stands — the legend's three words. */
type CallState = "completed" | "scheduled" | "not_scheduled";
function callState(call: CallView | undefined): CallState {
  if (call?.status === "completed") return "completed";
  if (call?.scheduledAt && call.status !== "cancelled") return "scheduled";
  return "not_scheduled";
}

// `panel-introcalls` `.nc-legend`.
const CALL_LEGEND: LegendItem[] = [
  { label: "Scheduled", color: "var(--blue-dk)" },
  { label: "Completed", color: "var(--green)" },
  { label: "Not scheduled", color: "var(--stone-dk)" },
];

interface CallRow {
  deck: DeckView;
  call?: CallView;
}

const CALL_FILTERS: FilterOption<CallRow>[] = [
  { id: "scheduled", label: "Scheduled", match: (r) => callState(r.call) === "scheduled" },
  { id: "completed", label: "Completed", match: (r) => callState(r.call) === "completed" },
  { id: "not_scheduled", label: "Not scheduled", match: (r) => callState(r.call) === "not_scheduled" },
];

/** Google Calendar's composer, attendees prefilled (`ncCallOpen('meet')`). */
export function googleCalendarUrl(input: { title: string; start: Date; minutes: number; emails: string[]; details?: string }) {
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const end = new Date(input.start.getTime() + input.minutes * 60_000);
  const qs = new URLSearchParams({ action: "TEMPLATE", text: input.title, dates: `${stamp(input.start)}/${stamp(end)}` });
  if (input.details) qs.set("details", input.details);
  let url = `https://calendar.google.com/calendar/render?${qs.toString()}`;
  for (const email of input.emails) url += `&add=${encodeURIComponent(email)}`;
  return url;
}

/** Outlook's compose deeplink — the prototype's Teams route (`ncCallOpen('teams')`). */
export function outlookComposeUrl(input: { title: string; start: Date; minutes: number; emails: string[]; details?: string }) {
  const end = new Date(input.start.getTime() + input.minutes * 60_000);
  const qs = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: input.title,
    startdt: input.start.toISOString(),
    enddt: end.toISOString(),
    to: input.emails.join(","),
  });
  if (input.details) qs.set("body", input.details);
  return `https://outlook.office.com/calendar/0/deeplink/compose?${qs.toString()}`;
}

interface DraftParticipant {
  email: string;
  name: string | null;
  userId: string | null;
  kind: "organizer" | "team" | "founder";
}

interface Prompts {
  enabled: boolean;
  prompts: { topic: string; because: string; question: string }[];
}

/** `GET /api/calls/:id/prompts` for the call behind the open pane. */
function useCallPrompts(callId: string | null, enabled: boolean): Prompts | null {
  const [data, setData] = useState<{ id: string; body: Prompts } | null>(null);
  useEffect(() => {
    if (!enabled || !callId) return;
    let live = true;
    fetch(`/api/calls/${callId}/prompts`)
      .then((r) => (r.ok ? (r.json() as Promise<Prompts>) : { enabled: false, prompts: [] }))
      .then((body) => live && setData({ id: callId, body }))
      .catch(() => live && setData({ id: callId, body: { enabled: false, prompts: [] } }));
    return () => {
      live = false;
    };
  }, [callId, enabled]);
  return data && data.id === callId ? data.body : null;
}

/**
 * The AI's questions for the call (admin console → Scoring framework → "Intro
 * call AI question prompts enabled"). With the toggle off the route answers
 * `enabled:false` and this renders NOTHING — no heading over a blank.
 */
export function CallQuestions({ prompts }: { prompts: Prompts | null }) {
  if (!prompts || !prompts.enabled) return null;
  return (
    <section className="mb-4 rounded-lg border border-line bg-surface-2 p-3" data-testid="call-ai-questions">
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-fg">
        <Sparkles className="h-3.5 w-3.5 text-olive" aria-hidden="true" /> Suggested questions for this call
      </h3>
      {prompts.prompts.length === 0 ? (
        <p className="text-xs text-fg-muted">The evaluation raised nothing that needs probing on the call.</p>
      ) : (
        <ol className="flex flex-col gap-2.5">
          {prompts.prompts.map((p, i) => (
            <li key={`${p.topic}-${i}`} className="text-xs" data-testid="call-ai-question">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">{p.topic}</div>
              <p className="mt-0.5 font-medium text-fg">{p.question}</p>
              <p className="mt-0.5 text-fg-muted">{p.because}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** `ncCalOpen` — "View calendar": the three providers, and the invite file. */
function CalendarPopover({ call }: { call: CallView }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  const meeting = call.location && /^https?:\/\//.test(call.location) ? call.location : null;
  const providers = [
    { label: "Google Meet", href: meeting?.includes("meet.google") ? meeting : "https://calendar.google.com/calendar/r" },
    { label: "Microsoft Teams", href: meeting?.includes("teams.") ? meeting : "https://teams.microsoft.com/v2/" },
    { label: "Zoom", href: meeting?.includes("zoom.") ? meeting : "https://zoom.us/meeting" },
  ];
  return (
    <div className="relative flex items-center gap-1.5" ref={ref}>
      <Button size="sm" variant="secondary" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <CalendarDays className="mr-1 h-3.5 w-3.5" /> View
      </Button>
      <a
        className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg"
        href={callIcsUrl(call.id)}
        download={icsFilename(call.title)}
      >
        <Download className="h-3.5 w-3.5" /> .ics
      </a>
      {open && (
        <div role="menu" aria-label="View calendar" className="absolute right-0 top-full z-30 mt-1 w-48 rounded-lg border border-line bg-surface p-1 shadow-lg">
          <div className="px-2.5 py-1.5 text-[10px] text-fg-muted">Log in to view the schedule</div>
          {providers.map((p) => (
            <a
              key={p.label}
              role="menuitem"
              href={p.href}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-md px-2.5 py-1.5 text-xs text-fg hover:bg-surface-2"
              onClick={() => setOpen(false)}
            >
              {p.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

const TH = "px-4 py-2.5 text-xs font-medium uppercase tracking-wide";

export function CallsPage({ config }: { config: CallsConfig }) {
  const { user } = useAuth();
  const { navId } = useParams();
  // Read-only participants see the nav's per-role label ("My Intro calls"), so
  // the page heading matches the sidebar item they clicked.
  const navItem = user && navId ? navItemById(user.edition, navId) : undefined;
  const heading = user && navItem ? navLabel(user.role, navItem) : config.title;
  /** F0649 — one call is "an intro call", however the screen is titled. */
  const noun = CALL_KIND_LABELS[config.kind].toLowerCase();
  const Noun = CALL_KIND_LABELS[config.kind];
  const [decks, setDecks] = useState<DeckView[] | null>(null);
  const [calls, setCalls] = useState<CallView[]>([]);
  const [canSchedule, setCanSchedule] = useState(false);
  const [directory, setDirectory] = useState<DirectoryPerson[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [captured, setCaptured] = useState<Record<string, { valuation?: string; ownership?: string }>>({});
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const [filterId, setFilterId] = useState<string | null>(null);
  const [pane, setPane] = useState<{ deckId: string; tab: string } | null>(null);

  // Report drawer (same behaviour as the stage screens).
  const [selected, setSelected] = useState<DeckView | null>(null);
  // Aug-2026 issue 27 — the "Addl. Parameter scores" column opens the
  // consolidated report on its additional-parameters tab; score cells open it
  // on the core tab.
  const [reportFor, setReportFor] = useState<{ deck: DeckView; tab: "core" | "additional" } | null>(null);
  const [report, setReport] = useState<{
    scores: ParamScoreView[];
    extraction: ExtractionSlide[];
    verdict?: string;
    versions?: DeckVersionView[];
  } | null>(null);

  // Modal state. `open` with no deck is the toolbar's Schedule intro call.
  const [modal, setModal] = useState<{ deck: DeckView | null; existing: CallView | null } | null>(null);
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

  // One CallsPage instance serves every call slug: nothing follows a navigation.
  useEffect(() => {
    setFilterId(null);
    setPane(null);
    setModal(null);
  }, [config]);

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

  const stageRows = useMemo<CallRow[]>(() => {
    const list = decks ?? [];
    const inStage = list.filter((d) => d.statusId && config.statuses.includes(d.statusId));
    // Read-only participants (jury, IC members, analysts) see only the decks
    // they're actually on a call for — not the whole stage.
    const mine = new Set(calls.map((c) => c.deckId));
    return inStage
      .filter((d) => canSchedule || mine.has(d.id))
      .map((deck) => ({ deck, call: callsByDeck.get(deck.id) }));
  }, [decks, calls, canSchedule, config.statuses, callsByDeck]);

  const activeFilter = config.toolbar?.filter ? CALL_FILTERS.find((f) => f.id === filterId) : undefined;
  const shown = useMemo(
    () => (activeFilter ? stageRows.filter(activeFilter.match) : stageRows),
    [stageRows, activeFilter],
  );
  const rows = useMemo(() => shown.map((r) => r.deck), [shown]);

  const juryLayout = config.participantColumns === "jury" && !canSchedule;
  const matrices = useReportMatrices(
    rows.map((d) => d.id),
    !!config.juryStack,
  );

  const paneRow = pane ? stageRows.find((r) => r.deck.id === pane.deckId) : undefined;
  const paneEval = usePaneEvaluation(paneRow ? paneRow.deck.id : null);
  const prompts = useCallPrompts(paneRow?.call?.id ?? null, !!config.aiQuestions);

  const scheduledCount = stageRows.filter((r) => callState(r.call) !== "not_scheduled").length;
  const completedCount = stageRows.filter((r) => callState(r.call) === "completed").length;

  function openModal(deck: DeckView | null, existing?: CallView) {
    setModal({ deck, existing: existing ?? null });
    // "Intro call — GreenRoute" (`ncCallOpenModal`); the toolbar's generic title before a startup is picked.
    setTitle(existing?.title ?? `${Noun} — ${deck ? deck.name : "ai.STARTUPJURY"}`);
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
      setFounderEmail(deck?.founderEmail ?? "");
      setExtras([]);
    }
  }

  /** The toolbar modal picks its startup inside the dialog. */
  function pickModalDeck(deckId: string) {
    const deck = stageRows.find((r) => r.deck.id === deckId)?.deck ?? null;
    const existing = deck ? callsByDeck.get(deck.id) : undefined;
    if (existing) {
      openModal(deck, existing);
      return;
    }
    setModal({ deck, existing: null });
    if (deck) {
      setTitle((t) => (t === `${Noun} — ai.STARTUPJURY` || !t ? `${Noun} — ${deck.name}` : t));
      setFounderEmail((f) => f || deck.founderEmail || "");
    }
  }

  const closeModal = useCallback(() => setModal(null), []);

  // Escape closes the scheduling modal, matching the deck viewer's lightbox.
  // Listening on the document rather than the dialog element means it works
  // before the user has focused anything inside.
  useEffect(() => {
    if (!modal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [modal, closeModal]);

  const modalDeck = modal?.deck ?? null;
  const editing = modal?.existing ?? null;

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

  /** Issue 27 — close a call out, reopen one closed by mistake, or cancel one (F0620). */
  async function setCallStatus(call: CallView, status: "completed" | "scheduled" | "cancelled") {
    setBusy(call.id);
    setNotice(null);
    setConfirmCancel(null);
    try {
      await updateCall(call.id, { status });
      await load();
      setNotice(
        status === "completed"
          ? `${call.deckName}'s ${noun} marked completed.`
          : status === "cancelled"
            ? `${call.deckName}'s ${noun} cancelled.`
            : `${call.deckName}'s ${noun} reopened.`,
      );
    } catch {
      setError(
        status === "completed"
          ? "Couldn't mark the call completed. Try again."
          : status === "cancelled"
            ? "Couldn't cancel the call. Try again."
            : "Couldn't reopen the call. Try again.",
      );
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
          // Rescheduling a cancelled call brings it back.
          ...(editing.status === "cancelled" && scheduledAt ? { status: "scheduled" as const } : {}),
        });
        setNotice(
          `Updated ${modalDeck.name}'s ${noun}${res.invited ? ` · invite re-sent to ${res.invited}` : ""}.`,
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

  function openStartup(deck: DeckView) {
    if (config.subTabs?.length) setPane({ deckId: deck.id, tab: config.subTabs[0]! });
    else setSelected(deck);
  }

  const selectedCount = Object.values(picked).filter(Boolean).length + (founderEmail.trim() ? 1 : 0) + extras.length;

  // ── Cells ─────────────────────────────────────────────────────────────────

  function startupCell(deck: DeckView) {
    return (
      <>
        <button
          type="button"
          className="text-left text-sm font-medium text-fg underline-offset-2 hover:underline"
          aria-expanded={config.subTabs?.length ? pane?.deckId === deck.id : undefined}
          onClick={() => openStartup(deck)}
        >
          {deck.name}
        </button>
        {/* F0644 — "Climatetech · Pre-seed · Hyderabad". */}
        <div className="text-xs text-fg-muted">
          {[deck.sector, deck.stage, deck.city].filter(Boolean).join(" · ") || deck.founder || "—"}
        </div>
      </>
    );
  }

  /** F0609/F0616 — the AI score is the way into its parameter breakdown. */
  function aiCell(deck: DeckView) {
    return (
      <button
        type="button"
        title="Full parameter breakdown"
        aria-label={`AI score for ${deck.name}: ${deck.aiScore?.toFixed(1) ?? "not scored"}`}
        className="underline-offset-2 hover:underline"
        onClick={() => setReportFor({ deck, tab: "core" })}
      >
        <BandScore value={deck.aiScore} suffix="/10" />
      </button>
    );
  }

  /** F0572/F0615/F0643 — one score per evaluator, a dim dash for anyone not yet submitted. */
  function juryCell(deck: DeckView) {
    const matrix = matrices[deck.id];
    const humans = matrix ? matrix.columns.filter((c) => c.kind === "human") : [];
    const entries: { key: string; name: string; score?: number }[] = humans.map((c) => ({
      key: c.id,
      name: c.name,
      score: c.submittedAt && c.total !== undefined ? c.total : undefined,
    }));
    if (deck.assignedToName && !deck.assigneeSubmitted && !humans.some((c) => c.id === deck.assignedTo)) {
      entries.push({ key: `pending-${deck.assignedTo ?? deck.assignedToName}`, name: deck.assignedToName });
    }
    if (!config.juryStack || entries.length === 0) {
      return (
        <button
          type="button"
          title="View all evaluator parameter scores"
          className="underline-offset-2 hover:underline"
          onClick={() => setReportFor({ deck, tab: "core" })}
        >
          <BandScore value={deck.juryScore} />
        </button>
      );
    }
    return (
      <div className="flex flex-col gap-0.5" data-testid="jury-score-stack">
        {entries.map((e) =>
          e.score !== undefined ? (
            <button
              key={e.key}
              type="button"
              title={`${e.name} — view all evaluator parameter scores`}
              className="text-left underline-offset-2 hover:underline"
              onClick={() => setReportFor({ deck, tab: "core" })}
            >
              <BandScore value={e.score} />
            </button>
          ) : (
            <span key={e.key} title={`${e.name} — not submitted`} className="font-mono text-sm text-fg-muted/60">
              —
            </span>
          ),
        )}
      </div>
    );
  }

  /** The Call scheduled cell: the Schedule button until there is a call, then its pill (F0646). */
  function scheduledCell(deck: DeckView, call?: CallView) {
    const state = callState(call);
    if (call?.status === "cancelled") {
      return (
        <div className="flex flex-col items-start gap-1">
          <Badge tone="danger">Cancelled</Badge>
          {canSchedule && (
            <Button size="sm" variant="secondary" onClick={() => openModal(deck, call)}>
              <CalendarPlus className="mr-1 h-3.5 w-3.5" /> Schedule
            </Button>
          )}
        </div>
      );
    }
    if (state !== "not_scheduled") return <Badge tone="info">Scheduled</Badge>;
    return canSchedule ? (
      <Button size="sm" variant="secondary" onClick={() => openModal(deck, call)}>
        <CalendarPlus className="mr-1 h-3.5 w-3.5" /> Schedule
      </Button>
    ) : (
      <Badge tone="neutral">Not scheduled</Badge>
    );
  }

  /** `.nc-pill done` / `wait` / `no`, with the completion verbs for whoever may manage the call. */
  function completedCell(call?: CallView) {
    const state = callState(call);
    const manage = !!call && (call.canManage || canSchedule);
    if (state === "completed") {
      return (
        <div className="flex flex-col items-start gap-1">
          <Badge tone="positive">Completed</Badge>
          {manage && (
            <button
              type="button"
              className="text-[11px] text-fg-muted underline-offset-2 hover:text-fg hover:underline"
              disabled={busy === call!.id}
              onClick={() => setCallStatus(call!, "scheduled")}
            >
              Reopen
            </button>
          )}
        </div>
      );
    }
    if (state === "scheduled") {
      return manage ? (
        <Button variant="secondary" size="sm" disabled={busy === call!.id} onClick={() => setCallStatus(call!, "completed")}>
          Mark completed
        </Button>
      ) : (
        <Badge tone="amber">Not yet</Badge>
      );
    }
    return <span className="text-sm text-fg-muted">—</span>;
  }

  /** Call date, and — for a scheduler — what can be done to the call from its row. */
  function dateCell(deck: DeckView, call?: CallView) {
    const live = !!call?.scheduledAt && call.status !== "cancelled";
    return (
      <div className="flex flex-col gap-1">
        <span className="text-sm text-fg-muted">{fmtDate(call?.scheduledAt ?? null)}</span>
        {!juryLayout && live && <span className="text-[11px] text-fg-muted">{fmtTime(call!.scheduledAt)}</span>}
        {!juryLayout && call && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
            <a
              className="inline-flex items-center gap-0.5 text-fg-muted hover:text-fg"
              href={callIcsUrl(call.id)}
              // A valueless `download` makes the browser name the
              // file from the URL path ("ics"); name it explicitly.
              download={icsFilename(call.title)}
            >
              <Download className="h-3 w-3" /> .ics
            </a>
            {canSchedule && live && (
              <>
                <button type="button" className="text-fg-muted hover:text-fg" onClick={() => openModal(deck, call)}>
                  Reschedule
                </button>
                <button
                  type="button"
                  className="text-fg-muted hover:text-fg"
                  disabled={busy === call.id}
                  onClick={() => invite(call)}
                >
                  Email invite
                </button>
                {call.status !== "completed" &&
                  (confirmCancel === call.id ? (
                    <button
                      type="button"
                      className="font-semibold text-red"
                      disabled={busy === call.id}
                      onClick={() => setCallStatus(call, "cancelled")}
                    >
                      Confirm cancel
                    </button>
                  ) : (
                    <button type="button" className="text-fg-muted hover:text-red" onClick={() => setConfirmCancel(call.id)}>
                      Cancel call
                    </button>
                  ))}
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  /** The stage's own transitions (Send signup, Issue term sheet…) and any captured fields. */
  function actionCell(deck: DeckView) {
    const actions = deck.actions ?? [];
    if (actions.length === 0) return <span className="text-xs text-fg-muted">—</span>;
    return (
      <div className="flex flex-wrap items-center justify-end gap-1.5">
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
    );
  }

  /** `jaAddlCell` — the viewer role's additional parameters, as chips. */
  function myAddlCell(deck: DeckView, matrix: DeckReportMatrix | null | undefined) {
    const group = matrix?.additional.find((g) => g.role === user?.role);
    const mine = (group?.rows ?? [])
      .map((r) => ({ name: r.name, value: user ? r.cells[user.id]?.value : undefined }))
      .slice(0, 3);
    return (
      <button
        type="button"
        title="See each role's three additional parameters & scores"
        className="flex flex-wrap items-center gap-1"
        onClick={() => setReportFor({ deck, tab: "additional" })}
      >
        {mine.length > 0 ? (
          mine.map((m) => (
            <span
              key={m.name}
              title={m.name}
              className="rounded-md bg-olive-lt px-1.5 py-0.5 font-mono text-[11px] font-semibold"
              style={{ color: m.value !== undefined ? scoreColor(m.value) : undefined }}
            >
              {m.value !== undefined ? m.value.toFixed(1) : "—"}
            </span>
          ))
        ) : (
          <span className="inline-flex items-center gap-1 rounded-md border border-line bg-olive-lt px-2 py-1 text-[11px] font-semibold text-olive-dk">
            <Table2 className="h-3 w-3" /> View scores
          </span>
        )}
      </button>
    );
  }

  // ── Column sets ───────────────────────────────────────────────────────────

  type Col = { header: string; className?: string; render: (row: CallRow) => ReactNode };

  const schedulerColumns: Col[] = [
    { header: "Startup", render: (r) => startupCell(r.deck) },
    { header: "AI score", render: (r) => aiCell(r.deck) },
    { header: "Jury score", render: (r) => juryCell(r.deck) },
    // F0647 — one decimal, banded.
    {
      header: "Avg. score",
      render: (r) => (
        <button
          type="button"
          title="View all evaluator parameter scores"
          className="underline-offset-2 hover:underline"
          onClick={() => setReportFor({ deck: r.deck, tab: "core" })}
        >
          <BandScore value={r.deck.decisionScore} />
        </button>
      ),
    },
    {
      header: "Addl. Parameter scores",
      render: (r) => (
        <Button variant="secondary" size="sm" onClick={() => setReportFor({ deck: r.deck, tab: "additional" })}>
          <BarChart3 className="mr-1 h-3.5 w-3.5" /> View scores
        </Button>
      ),
    },
    { header: "Call scheduled", render: (r) => scheduledCell(r.deck, r.call) },
    { header: "Call date", render: (r) => dateCell(r.deck, r.call) },
    { header: "Call completed", render: (r) => completedCell(r.call) },
    {
      header: "Scheduler",
      render: (r) => (
        <div className="text-xs text-fg-muted">
          {r.call?.organizerName ?? (canSchedule ? "You, on scheduling" : "—")}
          {r.call?.participants.length ? (
            <div className="mt-0.5">
              {r.call.participants.length} participant
              {r.call.participants.length === 1 ? "" : "s"}
            </div>
          ) : null}
        </div>
      ),
    },
    { header: "Action", className: "text-right", render: (r) => actionCell(r.deck) },
  ];

  // `AISJ_IC_Jury_V4` `panel-introcalls` — the jury's own thirteen columns (F0610).
  const juryColumns: Col[] = [
    { header: "Startup", render: (r) => startupCell(r.deck) },
    { header: "AI score", render: (r) => aiCell(r.deck) },
    {
      header: "Parameters score",
      render: (r) => {
        const values = (matrices[r.deck.id]?.core ?? [])
          .map((row) => row.cells.ai?.value)
          .filter((v): v is number => typeof v === "number");
        return (
          <button
            type="button"
            title="AI parameter scores"
            aria-label={`AI parameter scores for ${r.deck.name}`}
            onClick={() => setReportFor({ deck: r.deck, tab: "core" })}
          >
            <Sparkline values={values} />
          </button>
        );
      },
    },
    { header: "Addl. Parameters Score", render: (r) => myAddlCell(r.deck, matrices[r.deck.id]) },
    {
      header: "My score",
      render: (r) => {
        const me = matrices[r.deck.id]?.columns.find((c) => c.kind === "human" && c.id === user?.id);
        return <BandScore value={me?.submittedAt ? me.total : undefined} />;
      },
    },
    { header: "Av. Score", render: (r) => <BandScore value={r.deck.decisionScore} /> },
    { header: "Call scheduled", render: (r) => scheduledCell(r.deck, r.call) },
    { header: "Call date", render: (r) => <span className="text-sm text-fg-muted">{fmtDate(r.call?.scheduledAt ?? null)}</span> },
    {
      header: "Call time",
      render: (r) => (
        <span className="text-sm text-fg-muted">
          {r.call?.status === "cancelled" ? "—" : fmtTime(r.call?.scheduledAt ?? null)}
        </span>
      ),
    },
    { header: "Call completed", render: (r) => completedCell(r.call) },
    { header: "Scheduled by", render: (r) => <span className="text-xs text-fg-muted">{r.call?.organizerName ?? "—"}</span> },
    { header: "View calendar", render: (r) => (r.call ? <CalendarPopover call={r.call} /> : <span className="text-sm text-fg-muted">—</span>) },
    {
      header: "Archive",
      render: (r) => {
        // `ncArchive` — enabled only once the call is completed. It lights up
        // when the pipeline offers the move; today no incubator transition
        // leaves `intro` for Archive (§9, `src/pipeline/incubator.ts`).
        const archive = (r.deck.actions ?? []).find((a) => a.to === "archived");
        const done = callState(r.call) === "completed";
        return (
          <Button
            size="sm"
            variant="secondary"
            disabled={!done || !archive || busy !== null}
            title={
              !done
                ? "Available once the call is completed"
                : archive
                  ? `Archive ${r.deck.name}`
                  : "Archiving from an intro call is not enabled for this programme yet"
            }
            onClick={() => archive && runAction(r.deck, archive)}
          >
            <Archive className="mr-1 h-3.5 w-3.5" /> Archive
          </Button>
        );
      },
    },
  ];

  const columns = juryLayout ? juryColumns : schedulerColumns;

  // ── Participant picker (F0581–F0583) ──────────────────────────────────────

  const roleGroups = useMemo(() => {
    const labels = user ? ROLE_LABELS[user.edition] : {};
    const groups = new Map<string, DirectoryPerson[]>();
    for (const person of directory) {
      const list = groups.get(person.role) ?? [];
      list.push(person);
      groups.set(person.role, list);
    }
    return [...groups.entries()].map(([role, people]) => ({
      role,
      label: labels[role as Role] ?? role,
      people,
    }));
  }, [directory, user]);

  const pickedPeople = directory.filter((p) => picked[p.id]);
  const draftStart = validDate(when || null);
  const composer = draftStart
    ? {
        title,
        start: draftStart,
        minutes: duration,
        emails: draftParticipants().map((p) => p.email),
        details: [location, notes].filter(Boolean).join("\n"),
      }
    : null;
  const unscheduled = stageRows.filter((r) => callState(r.call) === "not_scheduled" && r.call?.status !== "cancelled");

  return (
    <section className="sj-frame">
      <PageToolbar
        title={heading}
        subtitle={config.subtitle}
        actions={
          <>
            {!config.footer && <Badge tone="info">{rows.length}</Badge>}
            {config.toolbar?.schedule && canSchedule && (
              <ToolbarButton primary onClick={() => openModal(null)}>
                <CalendarPlus className="h-3 w-3" aria-hidden="true" />
                {config.toolbar.schedule}
              </ToolbarButton>
            )}
            {config.toolbar?.filter && (
              <FilterMenu options={CALL_FILTERS} value={activeFilter ? filterId : null} onChange={setFilterId} />
            )}
            {config.toolbar?.export && (
              <ToolbarButton disabled={rows.length === 0} onClick={() => exportDecks(config.title, rows)}>
                <Download className="h-3 w-3" aria-hidden="true" />
                Export
              </ToolbarButton>
            )}
          </>
        }
      />

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
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
              activeFilter ? (
                <EmptyState
                  icon="Phone"
                  title="No startups match this filter"
                  description={`Nothing in ${heading} is "${activeFilter.label}" right now.`}
                />
              ) : (
                <EmptyState icon="Phone" title={config.emptyTitle} description={config.emptyDescription} />
              )
            ) : (
              <Card flush>
                <div className="overflow-x-auto">
                  <table className={`w-full text-left ${juryLayout ? "min-w-[1380px]" : "min-w-[1240px]"}`}>
                    <thead>
                      <tr className="border-b border-line text-fg-muted">
                        {columns.map((c) => (
                          <th key={c.header} className={`${TH} ${c.className ?? ""}`}>
                            {c.header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((row) => (
                        <tr
                          key={row.deck.id}
                          className={`border-b border-line/60 align-top last:border-0 ${
                            pane?.deckId === row.deck.id ? "bg-surface-2" : ""
                          }`}
                        >
                          {columns.map((c) => (
                            <td key={c.header} className="px-4 py-3">
                              {c.render(row)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!config.footer && (
                  <div className="border-t border-line px-4 py-2 text-xs text-fg-muted">
                    {rows.length} startup{rows.length === 1 ? "" : "s"} · {scheduledCount} scheduled ·{" "}
                    {rows.length - scheduledCount} not scheduled
                  </div>
                )}
              </Card>
            )}
          </div>
          {config.footer && (
            // F0618/F0642/F0648 — `N shortlisted startups · N scheduled · N completed`.
            <StageFooter
              stat={`${stageRows.length} ${config.footer.noun}${stageRows.length === 1 ? "" : "s"} · ${scheduledCount} scheduled · ${completedCount} completed`}
              legend={CALL_LEGEND}
            />
          )}
        </div>

        {paneRow && pane && config.subTabs && (
          <DetailPane
            title={paneRow.deck.name}
            meta={[paneRow.deck.sector, paneRow.deck.stage, paneRow.deck.city].filter(Boolean).join(" · ")}
            tabs={config.subTabs.map(builtinTab)}
            active={pane.tab}
            onTab={(tab) => setPane({ deckId: paneRow.deck.id, tab })}
            onClose={() => setPane(null)}
            headerAction={
              <Button size="sm" variant="secondary" onClick={() => setSelected(paneRow.deck)}>
                Evaluation
              </Button>
            }
          >
            <CallQuestions prompts={prompts} />
            {pane.tab === "scores" ? (
              <AllScores deck={paneRow.deck} scores={paneEval?.scores ?? null} />
            ) : (
              <DeckSlides extraction={paneEval?.extraction ?? null} />
            )}
          </DetailPane>
        )}
      </div>

      {modal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-4 backdrop-blur-[1px]"
          role="dialog"
          aria-modal="true"
          aria-label={`${editing ? "Reschedule" : "Schedule"} ${noun}${modalDeck ? ` for ${modalDeck.name}` : ""}`}
        >
          <Card className="max-h-[88vh] w-full max-w-xl overflow-y-auto">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-fg">
                  {editing ? "Reschedule" : "Schedule"} {noun}
                </h2>
                <p className="mt-0.5 text-xs text-fg-muted">
                  {modalDeck
                    ? `For ${modalDeck.name} · select participants from any role`
                    : "Select participants from any role, then choose a platform"}
                  . Everyone gets a standard .ics invite that works in Outlook, Gmail and Apple Calendar.
                </p>
              </div>
              <button type="button" aria-label="Close" onClick={closeModal} className="text-fg-muted hover:text-fg">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex flex-col gap-3">
              {!editing && (
                <label className="flex flex-col gap-1 text-xs text-fg-muted">
                  Startup
                  <select
                    className="sj-input"
                    aria-label="Startup"
                    value={modalDeck?.id ?? ""}
                    onChange={(e) => pickModalDeck(e.target.value)}
                    disabled={!!modalDeck && unscheduled.every((r) => r.deck.id !== modalDeck.id)}
                  >
                    <option value="">Choose a startup…</option>
                    {(modalDeck && unscheduled.every((r) => r.deck.id !== modalDeck.id)
                      ? [{ deck: modalDeck }]
                      : unscheduled
                    ).map((r) => (
                      <option key={r.deck.id} value={r.deck.id}>
                        {r.deck.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label className="flex flex-col gap-1 text-xs text-fg-muted">
                Meeting title
                <input className="sj-input" value={title} onChange={(e) => setTitle(e.target.value)} />
              </label>

              <div className="flex flex-wrap gap-3">
                <label className="flex flex-1 flex-col gap-1 text-xs text-fg-muted">
                  Date &amp; time{ZONE_ID ? ` (${ZONE_ID})` : ""}
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
                <div className="max-h-56 overflow-y-auto rounded-lg border border-line" data-testid="participant-roles">
                  {directory.length === 0 ? (
                    <p className="p-2 text-xs text-fg-muted">No team directory available.</p>
                  ) : (
                    roleGroups.map((g) => (
                      <div key={g.role} role="group" aria-label={g.label}>
                        <div className="sticky top-0 bg-surface-2 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
                          {g.label}
                        </div>
                        {g.people.map((p) => (
                          <label key={p.id} className="flex items-center gap-2 px-2.5 py-1.5 text-sm text-fg hover:bg-surface-2">
                            <span
                              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                              style={{ background: tint(p.id) }}
                              aria-hidden="true"
                            >
                              {initials(p.name)}
                            </span>
                            <span className="min-w-0 flex-1">
                              {p.name}
                              <span className="ml-1 text-xs text-fg-muted">· {g.label} · {p.email}</span>
                            </span>
                            <input
                              type="checkbox"
                              aria-label={`Invite ${p.name}`}
                              checked={!!picked[p.id]}
                              onChange={(e) => setPicked((prev) => ({ ...prev, [p.id]: e.target.checked }))}
                            />
                          </label>
                        ))}
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div>
                <div className="u-label mb-1 text-fg-muted">Selected</div>
                <div className="flex min-h-7 flex-wrap gap-1.5" data-testid="participant-selected">
                  {pickedPeople.length === 0 ? (
                    <span className="text-xs text-fg-muted">Nobody from the team yet.</span>
                  ) : (
                    pickedPeople.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        aria-label={`Remove ${p.name}`}
                        className="inline-flex items-center gap-1 rounded-full bg-olive-lt py-0.5 pl-0.5 pr-2 text-xs font-medium text-olive-dk"
                        onClick={() => setPicked((prev) => ({ ...prev, [p.id]: false }))}
                      >
                        <span
                          className="flex h-4 w-4 items-center justify-center rounded-full text-[7.5px] font-semibold text-white"
                          style={{ background: tint(p.id) }}
                          aria-hidden="true"
                        >
                          {initials(p.name)}
                        </span>
                        {p.name}
                        <X className="h-3 w-3" aria-hidden="true" />
                      </button>
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

              {composer && (
                // F0617 — the prototype's calendar composers, alongside the invite rather than instead of it.
                <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                  Or open in your calendar with everyone selected:
                  <a className="text-olive-dk underline" href={googleCalendarUrl(composer)} target="_blank" rel="noopener noreferrer">
                    Google Calendar
                  </a>
                  <a className="text-olive-dk underline" href={outlookComposeUrl(composer)} target="_blank" rel="noopener noreferrer">
                    Outlook / Teams
                  </a>
                </div>
              )}

              <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
                <span className="text-xs text-fg-muted">
                  {selectedCount} participant{selectedCount === 1 ? "" : "s"} selected
                </span>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={closeModal}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={save} disabled={!modalDeck || selectedCount === 0 || busy === "save"}>
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
          deckId={reportFor.deck.id}
          deckName={reportFor.deck.name}
          initialTab={reportFor.tab}
          onClose={() => setReportFor(null)}
        />
      ) : null}
    </section>
  );
}

/** Screen configs — one per call-bearing nav slug, per edition. */
export const INCUBATOR_CALLS_CONFIG: Record<string, CallsConfig> = {
  introcalls: {
    title: "Intro calls",
    // `panel-introcalls` line 5, in both the scheduler and the Jury builds (F0645/F0649).
    subtitle: "All shortlisted startups · click a name to view the deck · click the AI score for the full parameter breakdown",
    kind: "intro",
    statuses: ["shortlisted", "intro"],
    emptyTitle: "No intro calls yet",
    emptyDescription: "Decks appear here once the jury shortlists them.",
    toolbar: { schedule: "Schedule intro call", filter: true, export: true },
    footer: { noun: "shortlisted startup" },
    subTabs: ["deck", "scores"],
    aiQuestions: true,
    juryStack: true,
    participantColumns: "jury",
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
