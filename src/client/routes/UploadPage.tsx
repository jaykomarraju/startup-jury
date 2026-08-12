import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Upload as UploadIcon,
  FileCheck,
  Loader2,
  FileText,
  AlertTriangle,
  History,
  Copy,
} from "lucide-react";
import { Card, Button, SignalTag } from "../components";
import {
  uploadSingle,
  uploadBulk,
  listPrograms,
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
 * Upload screen (Evaluation → Upload). Single upload evaluates the PDF directly
 * against Claude and shows the AI verdict inline; bulk upload stores each PDF and
 * enqueues a per-deck evaluation job.
 *
 * Session 5 adds the intake guardrails: the required founder/contact columns
 * (founder, email, phone, city, sector) are surfaced and validated — the AI reads
 * them off the deck and anything still missing marks it **Incomplete** — plus soft
 * duplicate / returning-company alerts and per-row errors on a bulk upload.
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

  const singleFile = useRef<HTMLInputElement>(null);
  const bulkFiles = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [stage, setStage] = useState(STAGES[1]);
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
      form.set("name", name || file.name.replace(/\.pdf$/i, ""));
      form.set("stage", stage);
      form.set("sector", sector);
      form.set("city", city);
      form.set("founder", founder);
      form.set("founderEmail", founderEmail);
      form.set("founderPhone", founderPhone);
      if (programId) form.set("programId", programId);
      if (cohortId) form.set("cohortId", cohortId);
      setSingle(await uploadSingle(form));
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
      setBulk(await uploadBulk(form));
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

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setMethod("single")}
          className={`flex-1 rounded-lg border px-4 py-3 text-left transition ${method === "single" ? "border-accent bg-accent/5" : "border-line hover:bg-surface-2"}`}
        >
          <div className="text-sm font-medium text-fg">Single upload</div>
          <div className="text-xs text-fg-muted">One deck · evaluated immediately</div>
        </button>
        <button
          type="button"
          onClick={() => setMethod("bulk")}
          className={`flex-1 rounded-lg border px-4 py-3 text-left transition ${method === "bulk" ? "border-accent bg-accent/5" : "border-line hover:bg-surface-2"}`}
        >
          <div className="text-sm font-medium text-fg">Bulk upload</div>
          <div className="text-xs text-fg-muted">Many decks · queued for evaluation</div>
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
            <div className="grid grid-cols-2 gap-3">
              <Field label="Startup name">
                <input className="sj-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. GreenGrid" />
              </Field>
              <Field label="Stage">
                <select className="sj-input" value={stage} onChange={(e) => setStage(e.target.value)}>
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

            <div className="flex items-center justify-end gap-2">
              <Button type="submit" disabled={busy}>{busy ? "Evaluating…" : "Upload & evaluate"}</Button>
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
                <ExtractedDetails
                  deckName={name || picked?.name || "Deck"}
                  details={single.result.details}
                  missing={single.result.missingFields ?? []}
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
              No per-deck form on a bulk upload — the AI reads each founder&rsquo;s name, email, phone
              and city off the deck. Any deck missing a detail is marked Incomplete.
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
            <div className="flex items-center justify-end">
              <Button type="submit" disabled={busy}>{busy ? "Uploading…" : "Upload & queue"}</Button>
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
    </div>
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

/** The prototype's "Uploaded decks — AI-extracted details" table, for one deck. */
function ExtractedDetails({
  deckName,
  details,
  missing,
}: {
  deckName: string;
  details?: {
    founder?: string | null;
    founderEmail?: string | null;
    founderPhone?: string | null;
    city?: string | null;
    sector?: string | null;
  };
  missing: IntakeField[];
}) {
  const missingSet = new Set(missing);
  const complete = missing.length === 0;
  return (
    <div className="rounded-lg border border-line">
      <div className="border-b border-line px-4 py-2.5">
        <div className="text-sm font-medium text-fg">Uploaded deck — AI-extracted details</div>
        <div className="text-xs text-fg-muted">
          The AI scanned the deck and recorded the founder&rsquo;s details. A deck missing a
          detail is automatically marked Incomplete.
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-fg-muted">
              {DETAIL_COLUMNS.map((f) => (
                <th key={f} className="px-4 py-2 text-xs font-medium">{INTAKE_FIELD_LABELS[f]}</th>
              ))}
              <th className="px-4 py-2 text-xs font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-line">
              {DETAIL_COLUMNS.map((f) => {
                const value = details?.[f] ?? null;
                return (
                  <td key={f} className="px-4 py-2.5">
                    {missingSet.has(f) || !value ? (
                      <span className="inline-flex items-center gap-1 italic text-signal-flagged">
                        <AlertTriangle className="h-3.5 w-3.5" /> not captured
                      </span>
                    ) : (
                      <span className="text-fg">{value}</span>
                    )}
                  </td>
                );
              })}
              <td className="px-4 py-2.5">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    complete
                      ? "bg-positive/15 text-positive"
                      : "bg-signal-flagged/15 text-signal-flagged"
                  }`}
                >
                  {complete ? "Complete" : "Incomplete"}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="border-t border-line px-4 py-2 text-xs text-fg-muted">
        {complete
          ? `All details captured for ${deckName}.`
          : `${deckName} is marked Incomplete — missing ${missing
              .map((f) => INTAKE_FIELD_LABELS[f].toLowerCase())
              .join(", ")}. The founder is asked for the missing sections.`}
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
