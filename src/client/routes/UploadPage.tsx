import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Upload as UploadIcon, FileCheck } from "lucide-react";
import { Card, Button, SignalTag } from "../components";
import { uploadSingle, uploadBulk, type SingleUploadResult } from "../api";
import type { DeckSignal } from "../theme/signals";

type Method = "single" | "bulk";

const STAGES = ["Pre-seed", "Seed", "Series A", "Series B+"];

/**
 * Upload screen (Evaluation → Upload). Single upload evaluates the PDF directly
 * against Claude and shows the AI verdict inline; bulk upload stores each PDF and
 * enqueues a per-deck evaluation job.
 */
export function UploadPage() {
  const navigate = useNavigate();
  const [method, setMethod] = useState<Method>("single");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [single, setSingle] = useState<SingleUploadResult | null>(null);
  const [bulk, setBulk] = useState<{ count: number } | null>(null);

  const singleFile = useRef<HTMLInputElement>(null);
  const bulkFiles = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [stage, setStage] = useState(STAGES[1]);
  const [sector, setSector] = useState("");
  const [city, setCity] = useState("");

  async function submitSingle(e: React.FormEvent) {
    e.preventDefault();
    const file = singleFile.current?.files?.[0];
    if (!file) return setError("Choose a PDF pitch deck.");
    setError(null);
    setBusy(true);
    setSingle(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("name", name || file.name.replace(/\.pdf$/i, ""));
      form.set("stage", stage);
      form.set("sector", sector);
      form.set("city", city);
      setSingle(await uploadSingle(form));
    } catch {
      setError("Upload failed. Try again.");
    } finally {
      setBusy(false);
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
      setBulk({ count: res.count });
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
              <UploadIcon className="h-5 w-5 text-fg-muted" />
              <span className="text-sm text-fg">Choose a pitch deck (PDF)</span>
              <input ref={singleFile} type="file" accept="application/pdf" className="sr-only" onChange={() => setSingle(null)} />
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
              <Field label="Sector">
                <input className="sj-input" value={sector} onChange={(e) => setSector(e.target.value)} placeholder="e.g. FinTech" />
              </Field>
              <Field label="City">
                <input className="sj-input" value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Bengaluru" />
              </Field>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button type="submit" disabled={busy}>{busy ? "Evaluating…" : "Upload & evaluate"}</Button>
            </div>
          </form>

          {single && (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-2 px-4 py-3">
              {single.evaluated && single.result ? (
                <div className="flex items-center gap-2 text-sm text-fg">
                  <FileCheck className="h-4 w-4 text-positive" />
                  Evaluated — weighted total{" "}
                  <span className="font-mono font-semibold">{single.result.weightedTotal.toFixed(2)}</span>
                  <SignalTag signal={single.result.signal as DeckSignal} />
                </div>
              ) : (
                <div className="text-sm text-fg-muted">
                  Uploaded — evaluation is pending (no AI key configured yet).
                </div>
              )}
              <Button variant="secondary" size="sm" onClick={() => navigate("/app/alldecks")}>
                View all decks
              </Button>
            </div>
          )}
        </Card>
      ) : (
        <Card>
          <form className="flex flex-col gap-4" onSubmit={submitBulk}>
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-line px-4 py-8 text-center hover:bg-surface-2">
              <UploadIcon className="h-5 w-5 text-fg-muted" />
              <span className="text-sm text-fg">Choose multiple pitch decks (PDF)</span>
              <input ref={bulkFiles} type="file" accept="application/pdf" multiple className="sr-only" onChange={() => setBulk(null)} />
            </label>
            <div className="flex items-center justify-end">
              <Button type="submit" disabled={busy}>{busy ? "Uploading…" : "Upload & queue"}</Button>
            </div>
          </form>

          {bulk && (
            <div className="mt-4 flex items-center justify-between rounded-lg border border-line bg-surface-2 px-4 py-3">
              <span className="text-sm text-fg">
                {bulk.count} deck{bulk.count === 1 ? "" : "s"} queued for AI evaluation.
              </span>
              <Button variant="secondary" size="sm" onClick={() => navigate("/app/alldecks")}>
                View all decks
              </Button>
            </div>
          )}
        </Card>
      )}
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
