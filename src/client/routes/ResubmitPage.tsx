// PUBLIC founder page — `/resubmit/:token`, outside `/app` and outside
// RequireAuth. This is where the Incomplete-deck email lands the founder.
//
// Per §8 there is no question-and-answer form: the founder sees the feedback
// sections, updates those sections **in the deck**, and re-uploads it. The app
// re-scores automatically and returns it to the evaluator. So the whole page is
// one list ("what's missing") plus one control ("upload the corrected deck").
//
// Layout follows the prototype's founder portal (`AISJ_*` `#fp-*` / `#qview-
// founder`): the dark branded bar, an "Action required" badge, an "Areas
// requiring your input" list, and a confirmation state — adapted from its
// per-question textareas to the re-upload the meeting settled on.

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, FileText, Loader2, ShieldCheck, Upload } from "lucide-react";
import { Badge, Button, Card, Logo } from "../components";
import { ApiError, getResubmit, postResubmit, type ResubmitView } from "../api";
import { INTAKE_FIELD_LABELS } from "../../shared/intake";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

/** The dark branded shell every state of this page renders inside. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center gap-6 bg-topbar px-4 py-10">
      <Logo size={40} className="text-white" />
      {children}
      <p className="flex items-center gap-1.5 text-xs text-white/60">
        <ShieldCheck className="h-3.5 w-3.5" />
        This link is private to your submission — please don&rsquo;t forward it.
      </p>
    </div>
  );
}

export default function ResubmitPage() {
  const { token = "" } = useParams();
  const [view, setView] = useState<ResubmitView | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ name: string; size: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"uploading" | "scoring" | null>(null);
  const [done, setDone] = useState<{ version: number; evaluated: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setView(await getResubmit(token));
    } catch (err) {
      // The server writes a founder-facing `message` for every link failure
      // (invalid / expired / superseded) — surface it verbatim.
      setLinkError(
        err instanceof ApiError
          ? err.message
          : "We couldn't open this link. Please try again in a moment.",
      );
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return setError("Choose your updated deck (PDF) first.");
    setError(null);
    setBusy(true);
    // The request stores to R2 then re-scores with Claude in one call, so show
    // an "uploading" beat before the longer "scoring" one (matches UploadPage).
    setPhase("uploading");
    const toScoring = setTimeout(() => setPhase("scoring"), 1200);
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await postResubmit(token, form);
      setView(res);
      setDone({ version: res.version, evaluated: res.evaluated });
      setPicked(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "The upload failed. Please try again.",
      );
    } finally {
      clearTimeout(toScoring);
      setBusy(false);
      setPhase(null);
    }
  }

  if (linkError) {
    return (
      <Shell>
        <Card className="w-full max-w-lg p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-signal-flagged" />
            <div>
              <h1 className="text-lg font-semibold text-fg">This link can&rsquo;t be opened</h1>
              <p className="mt-1.5 text-sm text-fg-muted">{linkError}</p>
            </div>
          </div>
        </Card>
      </Shell>
    );
  }

  if (!view) {
    return (
      <Shell>
        <Card className="w-full max-w-lg p-6">
          <div className="flex items-center gap-2 text-sm text-fg-muted">
            <Loader2 className="h-4 w-4 animate-spin text-accent" />
            Opening your submission…
          </div>
        </Card>
      </Shell>
    );
  }

  const { deck, missingFields, missingSections, versions } = view;
  const nothingLeft = deck.complete && missingFields.length === 0 && missingSections.length === 0;

  return (
    <Shell>
      <Card className="w-full max-w-lg p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="u-label">Your submission</div>
            <h1 className="mt-0.5 truncate text-lg font-semibold text-fg">{deck.name}</h1>
            <p className="mt-0.5 text-sm text-fg-muted">
              {[deck.sector, deck.stage, deck.city].filter(Boolean).join(" · ") || "Pitch deck"}
              {` · v${deck.version}`}
            </p>
          </div>
          <Badge tone={nothingLeft ? "positive" : "amber"}>
            {nothingLeft ? "Complete" : "Action required"}
          </Badge>
        </div>

        {done && (
          <div
            role="status"
            className="mt-5 flex items-start gap-2 rounded-lg border border-positive/40 bg-positive/10 px-4 py-3 text-sm text-positive"
          >
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <strong className="font-medium">Version {done.version} received.</strong>{" "}
              {done.evaluated
                ? nothingLeft
                  ? "We re-scored it and it's back with the evaluation panel. Nothing else is needed from you."
                  : "We re-scored it — a few things below are still missing, so you can upload again."
                : "We'll re-score it shortly and put it back in front of the evaluation panel."}
            </span>
          </div>
        )}

        {nothingLeft ? (
          <p className="mt-5 text-sm text-fg-muted">
            Everything we need is in place. Your deck is with the evaluation panel — you don&rsquo;t
            need to do anything else.
          </p>
        ) : (
          <>
            <p className="mt-5 text-sm text-fg-muted">
              Our review couldn&rsquo;t find everything it needs, so your deck hasn&rsquo;t gone to
              the evaluation panel yet. Update the items below <strong>in your deck</strong> and
              upload the new version — we&rsquo;ll re-score it automatically.
            </p>

            {missingFields.length > 0 && (
              <section className="mt-5">
                <h2 className="u-label mb-2">Contact details we couldn&rsquo;t find</h2>
                <ul className="flex flex-wrap gap-2">
                  {missingFields.map((f) => (
                    <li
                      key={f}
                      className="inline-flex items-center gap-1 rounded-full bg-signal-flagged/15 px-2.5 py-1 text-xs font-medium text-signal-flagged"
                    >
                      <AlertTriangle className="h-3 w-3" />
                      {INTAKE_FIELD_LABELS[f]}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-fg-muted">
                  Add these to your deck (a contact slide is fine) so we can capture them.
                </p>
              </section>
            )}

            {missingSections.length > 0 && (
              <section className="mt-5">
                <h2 className="u-label mb-2">Sections requiring your input</h2>
                <ul className="flex flex-col gap-2">
                  {missingSections.map((s) => (
                    <li key={s.label} className="rounded-lg border border-line px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-fg">{s.label}</span>
                        <Badge tone="danger">Missing</Badge>
                      </div>
                      {s.text && <p className="mt-1 text-xs text-fg-muted">{s.text}</p>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        <form onSubmit={submit} className="mt-6 flex flex-col gap-3">
          <h2 className="u-label">Upload your updated deck</h2>
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-line px-4 py-8 text-center hover:bg-surface-2">
            {picked ? (
              <>
                <FileText className="h-5 w-5 text-accent" />
                <span className="text-sm font-medium text-fg">{picked.name}</span>
                <span className="text-xs text-fg-muted">
                  {formatBytes(picked.size)} · click to change
                </span>
              </>
            ) : (
              <>
                <Upload className="h-5 w-5 text-fg-muted" />
                <span className="text-sm text-fg">Choose your updated deck (PDF)</span>
              </>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf"
              className="sr-only"
              onChange={(e) => {
                setDone(null);
                const f = e.target.files?.[0];
                setPicked(f ? { name: f.name, size: f.size } : null);
              }}
            />
          </label>

          {error && (
            <p role="alert" className="text-sm text-signal-flagged">
              {error}
            </p>
          )}

          <Button type="submit" variant="primary" disabled={busy} className="w-full">
            {busy ? "Working…" : "Upload & re-score"}
          </Button>

          {busy && (
            <div className="rounded-lg border border-line bg-surface-2 px-4 py-3">
              <div className="flex items-center gap-2 text-sm text-fg">
                <Loader2 className="h-4 w-4 animate-spin text-accent" />
                <span>
                  {phase === "scoring"
                    ? "Reading your slides & re-scoring… (~10–20s)"
                    : "Uploading your deck…"}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface">
                <div
                  className="h-full animate-pulse rounded-full bg-accent transition-[width] duration-700"
                  style={{ width: phase === "scoring" ? "85%" : "35%" }}
                />
              </div>
            </div>
          )}

          <p className="text-xs text-fg-muted">
            PDF only, up to 24 MB. Your previous versions are kept — nothing is overwritten. This
            link works until {formatDate(view.expiresAt)}.
          </p>
        </form>

        {versions.length > 0 && (
          <section className="mt-6 border-t border-line pt-5">
            <h2 className="u-label mb-2">What you&rsquo;ve sent us</h2>
            <ul className="flex flex-col gap-1.5">
              {versions.map((v) => (
                <li key={v.version} className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <Badge tone={v.version === versions[0].version ? "info" : "neutral"}>
                      v{v.version}
                    </Badge>
                    <span className="truncate text-fg">{v.fileName ?? "Pitch deck"}</span>
                  </span>
                  <span className="shrink-0 text-xs text-fg-muted">{formatDate(v.createdAt)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </Card>
    </Shell>
  );
}
