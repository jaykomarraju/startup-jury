import { useState } from "react";
import { Link } from "react-router-dom";
import { Card, Button } from "../../components";
import { ApiError, uploadSingle, type SingleUploadResult } from "../../api";
import { INTAKE_FIELD_LABELS } from "../../../shared/intake";
import { MAX_DECK_SIZE_LABEL } from "../../../shared/uploadReview";
import { Dropzone, STAGES } from "./Wizard";

/**
 * The founder's own Upload (`founder-upload`, F0302).
 *
 * The prototype gives founders no Upload screen at all — their flow is the
 * Founder portal — so this route must not borrow the staff screen's surfaces:
 * no workspace credits (the server withholds the balance from founders anyway),
 * no Buy credits, no CRM or email-triage tickets, no review list. What is left
 * is the one thing a founder does here: submit their deck with their details.
 */
export function FounderUpload() {
  const [file, setFile] = useState<File | null>(null);
  const [values, setValues] = useState({ name: "", stage: "", founder: "", founderEmail: "", founderPhone: "", city: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SingleUploadResult | null>(null);

  const set = (k: keyof typeof values, v: string) => setValues((s) => ({ ...s, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return setError("Choose your pitch deck (PDF).");
    setError(null);
    setBusy(true);
    setResult(null);
    try {
      const form = new FormData();
      form.set("file", file);
      for (const [k, v] of Object.entries(values)) if (v.trim()) form.set(k, v.trim());
      setResult(await uploadSingle(form));
    } catch (err) {
      const code = err instanceof ApiError ? err.code : undefined;
      setError(
        code === "pdf_too_large"
          ? `That file is larger than ${MAX_DECK_SIZE_LABEL}.`
          : code === "pdf_required"
            ? "Decks must be PDF files."
            : "Upload failed. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-[560px] flex-col gap-4 p-5">
      <div>
        <h1 className="text-xl font-semibold text-fg">Upload pitch decks</h1>
        <p className="mt-0.5 text-sm text-fg-muted">Submit your pitch deck for evaluation. PDF only.</p>
      </div>
      <Card>
        <form className="flex flex-col gap-3" onSubmit={submit}>
          <Dropzone
            accept="application/pdf"
            label="Choose your pitch deck"
            onFiles={(f) => setFile(f[0] ?? null)}
            title={file ? <strong className="font-medium text-navy">{file.name}</strong> : "Drag & drop your pitchdeck here"}
            hint={file ? "Click to change" : `PDF · Max ${MAX_DECK_SIZE_LABEL}`}
          />
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">
              Startup name
              <input className="sj-input" value={values.name} onChange={(e) => set("name", e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">
              Stage
              <select className="sj-input" value={values.stage} onChange={(e) => set("stage", e.target.value)}>
                <option value="">Not sure</option>
                {STAGES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            {(["founder", "founderEmail", "founderPhone", "city"] as const).map((k) => (
              <label key={k} className="flex flex-col gap-1 text-xs font-medium text-fg-muted">
                {INTAKE_FIELD_LABELS[k]}
                <input className="sj-input" value={values[k]} onChange={(e) => set(k, e.target.value)} />
              </label>
            ))}
          </div>
          {error && <p className="text-sm text-signal-flagged">{error}</p>}
          <div className="flex justify-end">
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Uploading…" : "Upload"}
            </Button>
          </div>
        </form>
        {result && (
          <div role="status" className="mt-3 rounded-lg border border-line bg-surface-2 px-4 py-3 text-sm text-fg">
            {result.evaluated
              ? "Your deck was uploaded and evaluated."
              : "Your deck was uploaded — the evaluation will follow shortly."}{" "}
            <Link to="/app/founder-home" className="text-olive-dk underline">
              Back to My Startup
            </Link>
          </div>
        )}
      </Card>
    </div>
  );
}
