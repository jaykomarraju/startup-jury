import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Upload as UploadIcon,
  FileCheck,
  Loader2,
  FileText,
  AlertTriangle,
  History,
  Copy,
  Coins,
  Sparkles,
  Plug,
} from "lucide-react";
import { Card, Button, SignalTag } from "../components";
import {
  uploadSingle,
  uploadBulk,
  listPrograms,
  getConfigSummary,
  updateDeckDetails,
  createTicket,
  type SingleUploadResult,
  type BulkUploadResult,
  type BulkUploadRow,
  type IntakeMatchView,
  type ProgramView,
} from "../api";
import { useAuth } from "../auth/useAuth";
import { useActiveContext } from "../activeContext";
import {
  INTAKE_FIELD_LABELS,
  missingIntakeFields,
  type IntakeField,
} from "../../shared/intake";
import type { DeckSignal } from "../theme/signals";

type Method = "single" | "bulk";
/** null = idle; drives the staged progress panel during a single upload. */
type Phase = "uploading" | "scoring";

/** "" means "let the AI read it off the deck" (Aug-2026 issue 12). */
const STAGES = ["Pre-seed", "Seed", "Series A", "Series B+"];

/** The columns the AI reads off the deck, in the order the results table shows
 *  them (mirrors the prototype's "Uploaded decks — AI-extracted details"). */
const DETAIL_COLUMNS: IntakeField[] = [
  "founder",
  "founderEmail",
  "founderPhone",
  "city",
  "sector",
];

/** Human-readable file size, e.g. "2.4 MB". */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const BULK_ERRORS: Record<NonNullable<BulkUploadRow["error"]>, string> = {
  pdf_required: "Not a PDF — decks must be PDF files",
  pdf_too_large: "Too large — the 24 MB limit was exceeded",
  store_failed: "Upload failed — try this file again",
};

/**
 * Upload screen (Evaluation → Upload).
 *
 * Aug-2026 issue log:
 *   • 11 — the credits balance and a Buy-credits link sit on top.
 *   • 12 — startup name, stage, sector and cohort are auto-recognised, with a
 *          manual override panel once the deck has been read.
 *   • 13 — CRM / email-triage intake is offered, and raises a customization
 *          ticket rather than pretending to be built.
 *   • 14 — the submit button is "Upload", not "Upload & evaluate".
 */
export function UploadPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const edition = user?.edition ?? "incubator";
  const [ctx, setCtx] = useActiveContext(edition);
  const [method, setMethod] = useState<Method>("single");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [single, setSingle] = useState<SingleUploadResult | null>(null);
  const [bulk, setBulk] = useState<BulkUploadResult | null>(null);
  const [credits, setCredits] = useState<number | null>(null);

  const singleFile = useRef<HTMLInputElement>(null);
  const bulkFiles = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [stage, setStage] = useState("");
  const [sector, setSector] = useState("");
  const [city, setCity] = useState("");
  const [founder, setFounder] = useState("");
  const [founderEmail, setFounderEmail] = useState("");
  const [founderPhone, setFounderPhone] = useState("");
  // Program/cohort tagging — defaults to the active context, editable per upload.
  const [programs, setPrograms] = useState<ProgramView[]>([]);
  const [programId, setProgramId] = useState<string>(ctx.programId ?? "");
  const [cohortId, setCohortId] = useState<string>(ctx.cohortId ?? "");

  useEffect(() => {
    listPrograms()
      .then((r) => setPrograms(r.programs))
      .catch(() => setPrograms([]));
    getConfigSummary()
      .then((c) => setCredits(c.creditsBalance ?? null))
      .catch(() => {});
  }, []);

  const activeProgram = programs.find((p) => p.id === programId) ?? null;
  const cohortOptions = activeProgram?.cohorts ?? [];

  // What the form itself is still missing. The AI fills the gaps from the deck,
  // so this is a heads-up ("the AI will need to find these"), never a blocker.
  const formGaps = missingIntakeFields({ founder, founderEmail, founderPhone, city, sector });

  function onProgramChange(next: string) {
    setProgramId(next);
    setCohortId("");
    setCtx({ programId: next || null, cohortId: null });
  }
  function onCohortChange(next: string) {
    setCohortId(next);
    setCtx({ programId: programId || null, cohortId: next || null });
  }
  // Selected-file readouts so the user always sees what they picked.
  const [picked, setPicked] = useState<{ name: string; size: number } | null>(null);
  const [bulkPicked, setBulkPicked] = useState<{ name: string; size: number }[]>([]);

  async function submitSingle(e: React.FormEvent) {
    e.preventDefault();
    const file = singleFile.current?.files?.[0];
    if (!file) return setError("Choose a PDF pitch deck.");
    setError(null);
    setBusy(true);
    setSingle(null);
    // Staged status: the request stores to R2 then scores with Claude in one
    // synchronous call, so surface an "uploading" beat before the longer "scoring".
    setPhase("uploading");
    const toScoring = setTimeout(() => setPhase("scoring"), 1200);
    try {
      const form = new FormData();
      form.set("file", file);
      // Issue 12 — anything left blank is recognised from the deck by the AI.
      if (name) form.set("name", name);
      if (stage) form.set("stage", stage);
      form.set("sector", sector);
      form.set("city", city);
      form.set("founder", founder);
      form.set("founderEmail", founderEmail);
      form.set("founderPhone", founderPhone);
      if (programId) form.set("programId", programId);
      if (cohortId) form.set("cohortId", cohortId);
      const res = await uploadSingle(form);
      setSingle(res);
      // One credit was just spent — keep the header honest without a reload.
      setCredits((c) => (c === null ? c : Math.max(0, c - 1)));
    } catch {
      setError("Upload failed. Try again.");
    } finally {
      clearTimeout(toScoring);
      setBusy(false);
      setPhase(null);
    }
  }

  async function submitBulk(e: React.FormEvent) {
    e.preventDefault();
    const files = bulkFiles.current?.files;
    if (!files || files.length === 0) return setError("Choose one or more PDFs.");
    setError(null);
    setBusy(true);
    setBulk(null);
    try {
      const form = new FormData();
      for (const f of Array.from(files)) form.append("files", f);
      const res = await uploadBulk(form);
      setBulk(res);
      setCredits((c) => (c === null ? c : Math.max(0, c - (res.count ?? 0))));
    } catch {
      setError("Bulk upload failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 p-5">
      <div>
        <h1 className="text-xl font-semibold text-fg">Upload pitch decks</h1>
        <p className="mt-0.5 text-sm text-fg-muted">
          Each deck is scanned and scored by AI against your rubric. PDF only.
        </p>
      </div>

      {/* Issue 11 — credits balance and the option to buy, on top. */}
      <CreditsBar credits={credits} />

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setMethod("single")}
          className={`flex-1 rounded-lg border px-4 py-3 text-left transition ${method === "single" ? "border-accent bg-accent/5" : "border-line hover:bg-surface-2"}`}
        >
          <div className="text-sm font-medium text-fg">Single upload</div>
          <div className="text-xs text-fg-muted">One deck · 1 credit</div>
        </button>
        <button
          type="button"
          onClick={() => setMethod("bulk")}
          className={`flex-1 rounded-lg border px-4 py-3 text-left transition ${method === "bulk" ? "border-accent bg-accent/5" : "border-line hover:bg-surface-2"}`}
        >
          <div className="text-sm font-medium text-fg">Bulk upload</div>
          <div className="text-xs text-fg-muted">Many decks · N credits</div>
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-signal-flagged/40 bg-signal-flagged/10 px-4 py-2.5 text-sm text-signal-flagged">
          {error}
        </div>
      )}

      {method === "single" ? (
        <Card>
          <form className="flex flex-col gap-4" onSubmit={submitSingle}>
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-line px-4 py-8 text-center hover:bg-surface-2">
              {picked ? (
                <>
                  <FileText className="h-5 w-5 text-accent" />
                  <span className="text-sm font-medium text-fg">{picked.name}</span>
                  <span className="text-xs text-fg-muted">{formatBytes(picked.size)} · click to change</span>
                </>
              ) : (
                <>
                  <UploadIcon className="h-5 w-5 text-fg-muted" />
                  <span className="text-sm text-fg">Choose a pitch deck (PDF)</span>
                </>
              )}
              <input
                ref={singleFile}
                type="file"
                accept="application/pdf"
                className="sr-only"
                onChange={(e) => {
                  setSingle(null);
                  const f = e.target.files?.[0];
                  setPicked(f ? { name: f.name, size: f.size } : null);
                }}
              />
            </label>

            {/* Issue 12 — everything below is auto-recognised from the deck.
                Anything typed here overrides what the AI reads. */}
            <div className="flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/5 px-3 py-2 text-xs text-fg">
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-accent" />
              <span>
                <span className="font-medium">Auto-recognised.</span> Leave these blank and the AI
                reads the startup name, stage, sector and founder details off the deck. Anything you
                type wins, and you can correct every field after the scan.
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Startup name">
                <input className="sj-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Auto-detect from deck" />
              </Field>
              <Field label="Stage">
                <select className="sj-input" value={stage} onChange={(e) => setStage(e.target.value)}>
                  <option value="">Auto-detect from deck</option>
                  {STAGES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Program">
                <select className="sj-input" value={programId} onChange={(e) => onProgramChange(e.target.value)}>
                  <option value="">No program</option>
                  {programs.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Cohort">
                <select
                  className="sj-input disabled:opacity-50"
                  value={cohortId}
                  disabled={!activeProgram || cohortOptions.length === 0}
                  onChange={(e) => onCohortChange(e.target.value)}
                >
                  <option value="">No cohort</option>
                  {cohortOptions.map((ch) => (
                    <option key={ch.id} value={ch.id}>{ch.name}</option>
                  ))}
                </select>
              </Field>
            </div>
            <p className="-mt-1 text-xs text-fg-muted">
              Cohort comes from your workspace context, not the deck — it is pre-selected from the
              program and cohort you are working in.
            </p>

            {/* Required founder/contact detail. The AI reads these off the deck —
                anything you fill here wins, anything neither has marks the deck
                Incomplete so the founder can be asked for it. */}
            <div className="rounded-lg border border-line bg-surface-2/60 p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="u-label">Required founder details</span>
                <span className="text-xs text-fg-muted">
                  Extracted from the deck — fill anything it may not state
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Field label={`${INTAKE_FIELD_LABELS.founder} *`}>
                  <input className="sj-input" value={founder} onChange={(e) => setFounder(e.target.value)} placeholder="e.g. Meera Sharma" />
                </Field>
                <Field label={`${INTAKE_FIELD_LABELS.founderEmail} *`}>
                  <input className="sj-input" type="email" value={founderEmail} onChange={(e) => setFounderEmail(e.target.value)} placeholder="founder@startup.com" />
                </Field>
                <Field label={`${INTAKE_FIELD_LABELS.founderPhone} *`}>
                  <input className="sj-input" value={founderPhone} onChange={(e) => setFounderPhone(e.target.value)} placeholder="+91 98450 12345" />
                </Field>
                <Field label={`${INTAKE_FIELD_LABELS.city} *`}>
                  <input className="sj-input" value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Bengaluru" />
                </Field>
                <Field label={`${INTAKE_FIELD_LABELS.sector} *`}>
                  <input className="sj-input" value={sector} onChange={(e) => setSector(e.target.value)} placeholder="e.g. FinTech" />
                </Field>
              </div>
              {formGaps.length > 0 && (
                <p className="mt-2 text-xs text-fg-muted">
                  The AI will look for {formGaps.map((f) => INTAKE_FIELD_LABELS[f].toLowerCase()).join(", ")} in
                  the deck. Any detail it can&rsquo;t capture marks the deck Incomplete.
                </p>
              )}
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-fg-muted">Cost for this deck · 1 credit</span>
              {/* Issue 14 — the button is just "Upload". */}
              <Button type="submit" disabled={busy}>{busy ? "Uploading…" : "Upload"}</Button>
            </div>
          </form>

          {busy && (
            <div className="mt-4 rounded-lg border border-line bg-surface-2 px-4 py-3">
              <div className="flex items-center gap-2 text-sm text-fg">
                <Loader2 className="h-4 w-4 animate-spin text-accent" />
                <span>
                  {phase === "scoring"
                    ? "Reading slides & scoring with Claude… (~10–20s)"
                    : "Uploading deck…"}
                </span>
                {picked && <span className="truncate text-fg-muted">· {picked.name}</span>}
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface">
                <div
                  className="h-full animate-pulse rounded-full bg-accent transition-[width] duration-700"
                  style={{ width: phase === "scoring" ? "85%" : "35%" }}
                />
              </div>
            </div>
          )}

          {single && !busy && (
            <div className="mt-4 flex flex-col gap-3">
              <IntakeAlert
                flag={single.result?.intakeFlag ?? single.matches?.[0]?.flag ?? null}
                note={single.result?.intakeNote ?? single.matches?.[0]?.reason ?? null}
              />

              {single.evaluated && single.result ? (
                <RecognisedDetails
                  deckId={single.deckId}
                  recognized={single.result.recognized}
                  details={single.result.details}
                  missing={single.result.missingFields ?? []}
                  programs={programs}
                  programId={programId}
                  cohortId={cohortId}
                />
              ) : null}

              <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-2 px-4 py-3">
                {single.evaluated && single.result ? (
                  <div className="flex items-center gap-2 text-sm text-fg">
                    <FileCheck className="h-4 w-4 text-positive" />
                    Evaluated — weighted total{" "}
                    <span className="font-mono font-semibold">{single.result.weightedTotal.toFixed(2)}</span>
                    <SignalTag signal={single.result.signal as DeckSignal} />
                  </div>
                ) : (
                  // §9: this line used to claim "no AI key configured yet" for
                  // every failure — billing, rate limits, a missing PDF. The
                  // server now returns the real cause and whether anything is
                  // still going to retry it.
                  <div className="flex items-start gap-2 text-sm text-fg-muted">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-signal-weak" />
                    <span>
                      {single.error === "evaluation_failed"
                        ? "Uploaded, but the AI evaluation could not be started"
                        : "Uploaded — the AI evaluation is queued and will retry automatically"}
                      {single.reason ? <> · {single.reason}</> : null}.{" "}
                      <span className="opacity-70">
                        You can re-run it from All decks once the cause is cleared.
                      </span>
                    </span>
                  </div>
                )}
                <Button variant="secondary" size="sm" onClick={() => navigate("/app/alldecks")}>
                  View all decks
                </Button>
              </div>
            </div>
          )}
        </Card>
      ) : (
        <Card>
          <form className="flex flex-col gap-4" onSubmit={submitBulk}>
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-line px-4 py-8 text-center hover:bg-surface-2">
              {bulkPicked.length > 0 ? (
                <>
                  <FileText className="h-5 w-5 text-accent" />
                  <span className="text-sm font-medium text-fg">
                    {bulkPicked.length} deck{bulkPicked.length === 1 ? "" : "s"} selected · click to change
                  </span>
                </>
              ) : (
                <>
                  <UploadIcon className="h-5 w-5 text-fg-muted" />
                  <span className="text-sm text-fg">Choose multiple pitch decks (PDF)</span>
                </>
              )}
              <input
                ref={bulkFiles}
                type="file"
                accept="application/pdf"
                multiple
                className="sr-only"
                onChange={(e) => {
                  setBulk(null);
                  setBulkPicked(Array.from(e.target.files ?? []).map((f) => ({ name: f.name, size: f.size })));
                }}
              />
            </label>
            <p className="text-xs text-fg-muted">
              No per-deck form on a bulk upload — the AI reads each startup&rsquo;s name and the
              founder&rsquo;s name, email, phone and city off the deck. Any deck missing a detail is
              marked Incomplete.
            </p>
            {bulkPicked.length > 0 && (
              <ul className="flex flex-col gap-1 text-xs text-fg-muted">
                {bulkPicked.map((f) => (
                  <li key={f.name} className="flex items-center justify-between gap-2 truncate">
                    <span className="truncate">{f.name}</span>
                    <span className="shrink-0">{formatBytes(f.size)}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-fg-muted">
                Cost · {bulkPicked.length || "N"} credit{bulkPicked.length === 1 ? "" : "s"}
              </span>
              <Button type="submit" disabled={busy}>{busy ? "Uploading…" : "Upload"}</Button>
            </div>
          </form>

          {busy && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-4 py-3 text-sm text-fg">
              <Loader2 className="h-4 w-4 animate-spin text-accent" />
              Uploading {bulkPicked.length || ""} deck{bulkPicked.length === 1 ? "" : "s"} & queuing for AI evaluation…
            </div>
          )}

          {bulk && !busy && (
            <div className="mt-4 flex flex-col gap-3">
              <BulkResults rows={bulk.results ?? []} count={bulk.count} />
              <div className="flex items-center justify-end">
                <Button variant="secondary" size="sm" onClick={() => navigate("/app/alldecks")}>
                  View all decks
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Issue 13 — other bulk intake routes are named here, and each raises a
          customization request as a ticket rather than pretending to be built. */}
      <OtherIntakeOptions />
    </div>
  );
}

/** Issue 11 — the credits balance strip that sits above the upload methods. */
function CreditsBar({ credits }: { credits: number | null }) {
  const low = credits !== null && credits <= 5;
  return (
    <div
      className={`flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 ${
        low ? "border-signal-flagged/40 bg-signal-flagged/5" : "border-accent/40 bg-accent/5"
      }`}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15">
        <Coins className="h-4 w-4 text-accent" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-fg">
          Credits balance —{" "}
          {credits === null ? "unavailable" : `${credits} remaining`}
        </div>
        <p className="text-xs text-fg-muted">
          Each deck evaluated uses one credit. Credits are deducted when the AI runs.
        </p>
      </div>
      <Link to="/app/billing">
        <Button size="sm" variant={low ? "primary" : "secondary"}>
          Buy credits
        </Button>
      </Link>
    </div>
  );
}

/** Issue 13 — CRM / email-triage intake, raised as a customization ticket. */
function OtherIntakeOptions() {
  const [busy, setBusy] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const options = [
    {
      id: "crm",
      title: "Pull decks from your CRM",
      body: "Auto-sync deals from Salesforce, HubSpot, Pipedrive or your own API when they match your filter rules.",
    },
    {
      id: "email",
      title: "Email triage inbox",
      body: "Forward founder emails to a dedicated address; attachments are triaged into the pipeline automatically.",
    },
  ];

  async function request(option: { id: string; title: string; body: string }) {
    setBusy(option.id);
    setFailed(false);
    try {
      await createTicket(
        `Customization request — ${option.title}`,
        `${option.body}\n\nRaised from the Upload screen. Please scope this integration for our workspace.`,
        false,
      );
      setSent(option.id);
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <div className="flex items-center gap-2">
        <Plug className="h-4 w-4 text-fg-muted" />
        <div className="u-label">Other ways to bring in decks</div>
      </div>
      <p className="mt-1 text-sm text-fg-muted">
        These intake routes are built per workspace. Requesting one raises a customization ticket
        with our team — it is not switched on automatically.
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {options.map((o) => (
          <li
            key={o.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line px-3 py-2.5"
          >
            <div className="min-w-0">
              <div className="text-sm font-medium text-fg">{o.title}</div>
              <p className="text-xs text-fg-muted">{o.body}</p>
            </div>
            {sent === o.id ? (
              <span className="shrink-0 text-xs font-medium text-positive">
                Request raised — we&rsquo;ll be in touch
              </span>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy !== null}
                onClick={() => request(o)}
              >
                {busy === o.id ? "Raising…" : "Request this"}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {failed && (
        <p className="mt-2 text-xs text-signal-flagged">
          Couldn&rsquo;t raise the request. Try again, or file it from Support → Tickets.
        </p>
      )}
    </Card>
  );
}

/** Soft duplicate / returning-company alert. Advisory only — the deck uploaded. */
export function IntakeAlert({
  flag,
  note,
}: {
  flag: IntakeMatchView["flag"] | null;
  note: string | null;
}) {
  if (!flag || !note) return null;
  const duplicate = flag === "duplicate";
  const Icon = duplicate ? Copy : History;
  return (
    <div
      role="status"
      className={`flex items-start gap-2 rounded-lg border px-4 py-2.5 text-sm ${
        duplicate
          ? "border-signal-flagged/40 bg-signal-flagged/10 text-signal-flagged"
          : "border-accent/40 bg-accent/10 text-fg"
      }`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        <strong className="font-medium">
          {duplicate ? "Possible duplicate" : "Returning company"}
        </strong>{" "}
        — {note} This is an alert, not a block: the deck was uploaded and scored.
      </span>
    </div>
  );
}

/**
 * Issue 12 — what the AI recognised, every field editable.
 *
 * The prototype's read-only "Uploaded decks — AI-extracted details" table, with
 * the manual override the issue asks for: correcting a value writes it straight
 * back to the deck and re-derives whether it is still Incomplete.
 */
function RecognisedDetails({
  deckId,
  recognized,
  details,
  missing,
  programs,
  programId,
  cohortId,
}: {
  deckId: string;
  recognized?: { name: string; stage: string | null };
  details?: {
    founder?: string | null;
    founderEmail?: string | null;
    founderPhone?: string | null;
    city?: string | null;
    sector?: string | null;
  };
  missing: IntakeField[];
  programs: ProgramView[];
  programId: string;
  cohortId: string;
}) {
  const [values, setValues] = useState<Record<string, string>>({
    name: recognized?.name ?? "",
    stage: recognized?.stage ?? "",
    founder: details?.founder ?? "",
    founderEmail: details?.founderEmail ?? "",
    founderPhone: details?.founderPhone ?? "",
    city: details?.city ?? "",
    sector: details?.sector ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const missingSet = new Set(missing);
  const program = programs.find((p) => p.id === programId);
  const cohort = program?.cohorts.find((ch) => ch.id === cohortId);

  function set(field: string, value: string) {
    setValues((v) => ({ ...v, [field]: value }));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setSaveError(false);
    try {
      await updateDeckDetails(deckId, values);
      setSaved(true);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  const fields: { key: keyof typeof values; label: string; type?: string }[] = [
    { key: "name", label: "Startup name" },
    { key: "stage", label: "Stage" },
    ...DETAIL_COLUMNS.map((f) => ({ key: f as keyof typeof values, label: INTAKE_FIELD_LABELS[f] })),
  ];

  return (
    <div className="rounded-lg border border-line">
      <div className="border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-1.5 text-sm font-medium text-fg">
          <Sparkles className="h-3.5 w-3.5 text-accent" />
          Auto-recognised details
        </div>
        <div className="text-xs text-fg-muted">
          The AI read these off the deck. Correct anything it got wrong — your edit wins and is
          saved to the deck. A detail nobody supplies marks the deck Incomplete.
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3">
        {fields.map((f) => (
          <label key={f.key} className="flex flex-col gap-1">
            <span className="text-xs font-medium text-fg-muted">
              {f.label}
              {missingSet.has(f.key as IntakeField) && !values[f.key] && (
                <span className="ml-1 text-signal-flagged">· not captured</span>
              )}
            </span>
            <input
              className="sj-input h-9 text-sm"
              type={f.type ?? "text"}
              value={values[f.key]}
              placeholder="Not captured"
              onChange={(e) => set(f.key as string, e.target.value)}
            />
          </label>
        ))}
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">Program · Cohort</span>
          <span className="flex h-9 items-center text-sm text-fg-muted">
            {[program?.name, cohort?.name].filter(Boolean).join(" · ") || "Not assigned"}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5">
        <span className="text-xs text-fg-muted">
          {saved
            ? "Corrections saved to the deck."
            : saveError
              ? "Couldn't save the corrections. Try again."
              : "Overriding a value replaces what the AI recognised."}
        </span>
        <Button size="sm" variant="secondary" disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save corrections"}
        </Button>
      </div>
    </div>
  );
}

/** Per-file bulk report: what uploaded, what was rejected and why. */
function BulkResults({ rows, count }: { rows: BulkUploadRow[]; count: number }) {
  const rejected = rows.filter((r) => !r.ok);
  const flagged = rows.filter((r) => r.ok && r.flag);
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-line bg-surface-2 px-4 py-3 text-sm text-fg">
        {count} deck{count === 1 ? "" : "s"} queued for AI evaluation.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-line">
      <div className="border-b border-line px-4 py-2.5 text-sm text-fg">
        {count} deck{count === 1 ? "" : "s"} queued for AI evaluation
        {rejected.length > 0 && (
          <span className="text-signal-flagged">
            {" "}· {rejected.length} file{rejected.length === 1 ? "" : "s"} rejected
          </span>
        )}
        {flagged.length > 0 && (
          <span className="text-fg-muted">
            {" "}· {flagged.length} flagged for review
          </span>
        )}
      </div>
      <ul className="flex flex-col">
        {rows.map((r) => (
          <li
            key={`${r.file}-${r.deckId ?? r.error}`}
            className="flex items-start justify-between gap-3 border-b border-line px-4 py-2 text-sm last:border-b-0"
          >
            <span className="truncate text-fg">{r.file}</span>
            {r.ok ? (
              <span className="shrink-0 text-right text-xs">
                <span className="text-positive">Queued</span>
                {r.flag && (
                  <span className="block max-w-xs text-signal-flagged">
                    {r.flag === "duplicate" ? "Possible duplicate" : "Returning company"}
                    {r.note ? ` — ${r.note}` : ""}
                  </span>
                )}
              </span>
            ) : (
              <span className="shrink-0 text-xs text-signal-flagged">
                {BULK_ERRORS[r.error ?? "store_failed"]}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      {children}
    </label>
  );
}
