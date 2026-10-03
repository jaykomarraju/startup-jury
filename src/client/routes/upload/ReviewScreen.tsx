import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { DeckPdfViewer } from "../../components";
import {
  FLAG_SIGNAL_LABELS,
  STAGED_ISSUE_LABELS,
  creditsLabel,
  formatBytes,
  uploadDeckStatus,
  type BatchCostPreview,
  type FlagSignal,
  type UploadStatusContext,
  type UploadStatusTone,
} from "../../../shared/uploadReview";
import { StagedSlides } from "./stagedPdf";
import type { StagedDeck } from "./types";

/**
 * "Review uploaded decks" (`#up-review`, F0191 / F0221 / F0222 / F0305 / F0316).
 *
 * The confirm-before-spend step. Staged decks live only in the browser: the
 * operator ticks the ones to upload, previews each, and sees what the batch
 * will consume before "Upload selected decks" — the ONLY control here that
 * reaches the upload routes, which reserve the credits where they always have.
 * Nothing on this screen spends.
 *
 * Once a deck is uploaded it stays on the list and follows the AI. A deck the
 * AI brings back Incomplete opens "Parameters needing response": flag the areas
 * the founder must clarify, tag each Weak signal / Absent, and Send to Query
 * raises the founder query.
 *
 * S2-UPLOAD (feedback row 2) DELETED the per-row "Mark incomplete" button —
 * "not required since we have automated this part". It set a browser-only
 * `markedIncomplete` flag that reached no route; with it gone the field is
 * deleted from `StagedDeck` outright rather than left permanently false, and
 * with it the three things it alone drove: the "Marked incomplete" filter, the
 * `N marked incomplete (excluded)` footer count, and the row's Incomplete
 * badge. It was never the server's `flag_incomplete` transition (manual_review
 * -> incomplete, `src/pipeline/incubator.ts:59`), which is untouched and still
 * fires automatically when a query is raised (`routes/pipeline.ts:788`).
 */

export type ReviewFilter = "all" | "ready" | "uploaded";

const FILTER_LABELS: Record<ReviewFilter, string> = {
  all: "All decks",
  ready: "Ready to upload",
  uploaded: "Uploaded",
};

/**
 * A staged deck the upload button may send. The staged issues still hold a deck
 * back; the operator no longer can, which is row 2's point — a deck they would
 * have marked incomplete is now one they simply leave unticked.
 */
export function isUploadable(d: StagedDeck): boolean {
  return !d.deckId && !!d.file && d.issues.length === 0;
}

/**
 * An uploaded deck whose parameters may be flagged for the founder. Since row 2
 * this fires only for a deck the AI ITSELF landed at `incomplete` — the
 * automation the client is invoking — and for no deck the operator declared.
 *
 * WHICH incomplete is the screening spec's, not this screen's: `flaggable` is
 * the deck axis, because asking a founder to clarify evaluation parameters is
 * the answer to "the AI could not read your deck" and not to "we are missing
 * your phone number", which is an Edit. See `UploadDeckStatus.flaggable`.
 */
export function isFlaggable(d: StagedDeck, ctx: UploadStatusContext): boolean {
  if (!d.deckId || !d.deck) return false;
  return uploadDeckStatus(d.deck, ctx).flaggable;
}

function matchesFilter(d: StagedDeck, f: ReviewFilter): boolean {
  if (f === "ready") return isUploadable(d);
  if (f === "uploaded") return !!d.deckId;
  return true;
}

export interface ReviewScreenProps {
  staged: StagedDeck[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  onToggle: (key: string) => void;
  onToggleAll: () => void;
  onBack: () => void;
  onUpload: () => void;
  busy: boolean;
  /**
   * How far the running batch has got, in decks whose request has settled —
   * null when nothing is in flight. It exists because a bulk batch is several
   * bounded requests now (`chunkBulk`): "Uploading…" on its own cannot tell an
   * operator whether anything is moving, which is the whole of issue 3.
   */
  progress: { done: number; total: number } | null;
  preview: BatchCostPreview;
  error: ReactNode;
  canBuy: boolean;
  /** Core evaluation areas (`GET /api/parameters`) — the flag panel's rows. */
  parameters: string[];
  canQuery: boolean;
  onFlag: (key: string, area: string) => void;
  onSignal: (key: string, area: string, signal: FlagSignal) => void;
  onSend: (key: string) => void;
  sending: string | null;
  sendError: string | null;
  /** The editable AI-extracted details for an uploaded deck (issue 12). */
  renderDetails: (deck: StagedDeck) => ReactNode;
  /** The gate and the edition every status word on this screen is read under. */
  statusCtx: UploadStatusContext;
  /**
   * Issues 2 and 12 — a fully successful batch leaves for the Dashboard, so the
   * only way to be standing here afterwards is a batch that partly failed. The
   * operator stays so the failures stay visible, and the way ON becomes the
   * Dashboard rather than the upload step they already finished with.
   */
  showDashboard: boolean;
}

export function ReviewScreen(props: ReviewScreenProps) {
  const { staged, activeKey, preview } = props;
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const rows = staged.filter((d) => matchesFilter(d, filter));
  const selectable = staged.filter(isUploadable);
  const allChecked = selectable.length > 0 && selectable.every((d) => d.checked);
  const selected = selectable.filter((d) => d.checked).length;
  const active = staged.find((d) => d.key === activeKey) ?? null;

  return (
    <section className="sj-frame" data-testid="up-review">
      <div className="tb">
        <div className="min-w-0">
          <h1 className="tbt">Review uploaded decks</h1>
          <div className="tbs">Select decks to confirm upload · preview each · then click Upload</div>
        </div>
        <div className="tbr relative">
          <button type="button" className="tbb" onClick={props.onBack}>
            ← Back to upload
          </button>
          <button
            type="button"
            className="tbb"
            aria-haspopup="menu"
            aria-expanded={filterOpen}
            onClick={() => setFilterOpen((v) => !v)}
          >
            Filter{filter !== "all" ? ` · ${FILTER_LABELS[filter]}` : ""}
          </button>
          {filterOpen && (
            <div role="menu" className="absolute right-0 top-full z-10 mt-1 w-44 rounded-lg border border-stone-dk bg-surface py-1 shadow-md">
              {(Object.keys(FILTER_LABELS) as ReviewFilter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  role="menuitemradio"
                  aria-checked={filter === f}
                  className={`block w-full px-3 py-1.5 text-left text-[11.5px] hover:bg-offwhite ${filter === f ? "font-semibold text-olive-dk" : "text-fg-2"}`}
                  onClick={() => {
                    setFilter(f);
                    setFilterOpen(false);
                  }}
                >
                  {FILTER_LABELS[f]}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* COL A — the checklist */}
        <div className="flex w-[340px] min-w-[340px] flex-col overflow-hidden border-r border-stone-dk bg-surface">
          <div className="flex shrink-0 items-center gap-2.5 border-b border-stone px-[13px] py-2.5">
            <div className="flex-1 text-[9px] font-semibold uppercase tracking-[0.07em] text-fg-muted">
              {staged.length} deck{staged.length === 1 ? "" : "s"} staged
            </div>
            <label className="flex cursor-pointer items-center gap-[5px] text-[10.5px] text-fg-muted">
              <Check checked={allChecked} disabled={selectable.length === 0} onChange={props.onToggleAll} label="Select all" />
              Select all
            </label>
          </div>
          <ul className="flex-1 overflow-y-auto" aria-label="Staged decks">
            {staged.length === 0 ? (
              <li className="px-4 py-8 text-center text-[11.5px] leading-[1.6] text-fg-muted" data-testid="up-review-empty">
                No decks staged yet. Go back to upload and drop a pitchdeck — it waits here for your approval before
                any credit is used.
              </li>
            ) : (
              rows.map((d) => <DeckRow key={d.key} deck={d} active={d.key === activeKey} {...props} />)
            )}
          </ul>
          <div className="flex shrink-0 items-center justify-between border-t border-stone-dk bg-olive-lt px-[13px] py-2 text-[11px] font-medium text-olive-dk">
            <span data-testid="up-sel-label">
              {selected} deck{selected === 1 ? "" : "s"} selected
            </span>
            <span className="text-[10px] text-fg-muted">✓ check to confirm</span>
          </div>
        </div>

        {/* COL B — the preview */}
        <div className="flex-1 overflow-y-auto bg-offwhite">
          <div className="px-[18px] py-4">
            {active ? (
              <Preview deck={active} {...props} />
            ) : (
              <div className="flex min-h-[280px] flex-col items-center justify-center gap-2.5 p-10 text-center text-fg-muted">
                <p className="text-[12px] leading-[1.7]">
                  Click any deck on the left to preview its contents before confirming upload.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* The bottom bar — the cost preview and the approval. */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3.5 border-t-2 border-olive bg-surface px-[18px] py-[11px]">
        <div className="text-[12px] text-fg-2" data-testid="up-bottom-summary">
          {selected === 0 ? (
            <>
              Select decks to confirm, then click <strong className="text-olive-dk">Upload</strong>.
            </>
          ) : (
            <>
              <strong className="text-olive-dk">
                {selected} deck{selected === 1 ? "" : "s"}
              </strong>{" "}
              ready to upload ·{" "}
              <span data-testid="up-cost-preview">
                Cost <strong className="text-olive-dk">{creditsLabel(preview.credits)}</strong>
                {preview.balance !== null && (
                  <>
                    {" "}
                    · balance {preview.balance} → {preview.balanceAfter}
                  </>
                )}
              </span>
            </>
          )}
          {preview.shortfall > 0 && (
            <div className="mt-0.5 text-signal-flagged" role="alert">
              Not enough credits — this batch needs {creditsLabel(preview.credits)} and {preview.balance} remain.{" "}
              {props.canBuy ? (
                <Link to="/app/billing" className="font-medium underline">
                  Buy credits
                </Link>
              ) : (
                "Ask an administrator to add credits, or select fewer decks."
              )}
            </div>
          )}
          {props.error && <div className="mt-0.5 text-signal-flagged">{props.error}</div>}
        </div>
        <div className="flex gap-2">
          {/* Cancel is the way out BEFORE a batch; once one has run and left
              failures behind, the way out is the Dashboard and "Cancel" would
              name the wrong thing for the decks that did upload. */}
          {!props.showDashboard && (
            <Link to="/app/alldecks" className={BTN_SECONDARY}>
              Cancel
            </Link>
          )}
          <button
            type="button"
            onClick={props.onUpload}
            disabled={selected === 0 || props.busy || preview.shortfall > 0}
            // Demoted to a retry once the Dashboard is the primary: the failed
            // decks stay ticked, so this is still how they are tried again.
            className={props.showDashboard ? BTN_SECONDARY : BTN_PRIMARY}
          >
            {props.busy
              ? props.progress
                ? `Uploading ${props.progress.done} of ${props.progress.total}…`
                : "Uploading…"
              : "Upload selected decks"}
          </button>
          {props.showDashboard && (
            <Link to="/app/alldecks" className={BTN_PRIMARY}>
              Go to dashboard →
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}

function Check({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onClick={(e) => e.stopPropagation()}
      onChange={onChange}
      className="h-[15px] w-[15px] shrink-0 cursor-pointer accent-[var(--olive)] disabled:cursor-not-allowed disabled:opacity-40"
    />
  );
}

const BADGE = "rounded-[20px] px-1.5 py-px text-[9.5px]";

const BTN_PRIMARY =
  "flex items-center gap-[7px] rounded-[7px] bg-olive px-[22px] py-[9px] text-[12.5px] font-semibold text-white hover:bg-olive-dk disabled:pointer-events-none disabled:opacity-40";
const BTN_SECONDARY =
  "flex items-center gap-[7px] rounded-[7px] border border-stone-dk bg-surface px-4 py-2 text-[12px] text-fg-2 hover:bg-offwhite disabled:pointer-events-none disabled:opacity-40";

/** The row badge's colours, by the tone `uploadDeckStatus` gives the word. */
const BADGE_TONES: Record<UploadStatusTone, string> = {
  good: "bg-green-lt text-green",
  warn: "bg-warn-lt text-warn",
  muted: "bg-stone text-fg-muted",
};

function DeckRow({
  deck: d,
  active,
  onSelect,
  onToggle,
  statusCtx,
}: { deck: StagedDeck; active: boolean } & ReviewScreenProps) {
  const status = d.deck ? uploadDeckStatus(d.deck, statusCtx) : null;
  const flagged = Object.keys(d.flags).length;
  // The word is NOT lower-cased any more: "Incomplete contact details" is the
  // client's own string, and lower-casing turned "Awaiting AI evaluation" into
  // "awaiting ai evaluation".
  // In flight comes FIRST: while a request is out this deck has no verdict and
  // no failure, and "not yet analysed" reads as though nothing is happening.
  const meta = d.uploading
    ? `${d.fileName} · uploading…`
    : d.deckId
      ? `${d.fileName} · ${status ? status.label : "uploaded"}`
      : d.uploadError
        ? `${d.fileName} · not uploaded`
        : `${d.fileName} · not yet analysed`;
  return (
    <li
      data-testid="up-deck-row"
      aria-selected={active}
      onClick={() => onSelect(d.key)}
      className={`flex cursor-pointer items-center gap-[9px] border-b border-l-[3px] border-b-stone px-[13px] py-2.5 transition-colors hover:bg-offwhite ${
        active ? "border-l-olive bg-olive-lt" : "border-l-transparent"
      }`}
    >
      <Check
        checked={d.deckId ? true : d.checked}
        disabled={!isUploadable(d)}
        onChange={() => onToggle(d.key)}
        label={`Select ${d.name}`}
      />
      <div className="min-w-0 flex-1">
        <div className="mb-px truncate text-[12px] font-medium text-fg">{d.name}</div>
        <div className="mb-[3px] truncate text-[10.5px] text-fg-muted">{meta}</div>
        <div className="flex flex-wrap gap-1">
          <span className={`${BADGE} bg-stone text-fg-muted`}>{formatBytes(d.size)}</span>
          {d.uploading && (
            <span className={`${BADGE} bg-blue-lt font-medium text-blue-dk`} data-testid="up-row-uploading">
              Uploading…
            </span>
          )}
          {d.slides !== null && <span className={`${BADGE} bg-blue-lt text-blue-dk`}>{d.slides} slides</span>}
          {(d.issues.length > 0 || d.intakeFlag || d.uploadError) && (
            <span className={`${BADGE} bg-warn-lt font-medium text-warn`}>⚠ Review</span>
          )}
          {/* The words were HARDCODED here rather than read from the map, which
              is why issue 5 survived a vocabulary change in one place. There is
              one badge now, and it says whatever the status says. A deck still
              with the AI has no verdict to badge — the meta line above already
              says so. */}
          {status && !status.awaiting && (
            <span className={`${BADGE} font-medium ${BADGE_TONES[status.tone]}`} data-testid="up-row-status">
              {status.label}
              {flagged ? ` · ${flagged} area${flagged === 1 ? "" : "s"}` : ""}
            </span>
          )}
          {d.sentToQuery && <span className={`${BADGE} bg-green-lt font-medium text-green`}>Sent to Query</span>}
        </div>
      </div>
    </li>
  );
}

function Preview({ deck: d, ...props }: { deck: StagedDeck } & ReviewScreenProps) {
  const status = d.deck ? uploadDeckStatus(d.deck, props.statusCtx) : null;
  const statusText = d.deckId ? (status ? status.label : "Uploaded") : d.issues.length ? "Refused" : "Ready";
  const warn = d.issues.length
    ? `Review suggested — ${d.issues.map((i) => STAGED_ISSUE_LABELS[i]).join("; ")}.`
    : d.uploadError
      ? `Review suggested — ${d.uploadError}`
      : d.intakeFlag && d.intakeNote
        ? `Review suggested — ${d.intakeFlag === "duplicate" ? "Possible duplicate" : "Returning company"}: ${d.intakeNote}`
        : null;
  /**
   * The note below the banner explaining why there is no flag panel yet. It was
   * gated on `markedIncomplete && !deckId` — the operator having declared an
   * intent they can no longer declare. Re-gated on the signals that survive:
   * the same three the row's "⚠ Review" badge reads. It answers the question a
   * warned, not-yet-uploaded deck raises, and stays silent on a clean one
   * rather than captioning every staged row.
   */
  const queryNeedsUpload = !d.deckId && (d.issues.length > 0 || !!d.intakeFlag || !!d.uploadError);

  return (
    <div data-testid="up-preview">
      <div className="mb-2.5 rounded-[9px] border border-stone-dk bg-surface px-4 py-3.5">
        <div className="mb-2 text-[8.5px] font-semibold uppercase tracking-[0.08em] text-fg-muted">File details</div>
        <div className="text-[14px] font-semibold text-fg">{d.name}</div>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <Meta label="File size" value={formatBytes(d.size)} />
          <Meta label="Slides" value={d.slides === null ? "—" : String(d.slides)} />
          <Meta label="Status" value={statusText} tone={status?.tone === "warn" || d.issues.length ? "amber" : "green"} />
        </div>
      </div>

      {warn && (
        <div className="mb-2.5 flex items-start gap-[7px] rounded-[7px] border border-[#FCD34D] bg-warn-lt px-3 py-[9px] text-[11.5px] text-[#78350F]">
          <span aria-hidden="true" className="text-warn">⚠</span>
          <div>
            <strong>{warn.split(" — ")[0]}</strong> — {warn.split(" — ").slice(1).join(" — ")}
          </div>
        </div>
      )}

      {d.deckId && aiNote(d) && (
        <p className="mb-2.5 rounded-[7px] border border-stone-dk bg-surface px-3 py-2 text-[11.5px] text-fg-2">{aiNote(d)}</p>
      )}

      {/* `sentToQuery` keeps the panel — and so its "✓ Sent to Query" — on
          screen after the send. Raising a query latches the deck into the
          client's `Incomplete, Queried` sink, which is no longer flaggable, so
          without this the operator's own confirmation would vanish under the
          next AI poll. */}
      {(isFlaggable(d, props.statusCtx) || d.sentToQuery) && props.canQuery && <FlagPanel deck={d} {...props} />}
      {queryNeedsUpload && props.canQuery && (
        <p className="mb-2.5 text-[11px] text-fg-muted">
          Parameters are flagged, and the founder queried, once a deck is uploaded — a query needs the deck on file.
        </p>
      )}

      {d.deckId && props.renderDetails(d)}

      {d.deckId ? (
        <DeckPdfViewer deckId={d.deckId} />
      ) : d.file && d.issues.length === 0 ? (
        <StagedSlides file={d.file} />
      ) : null}
    </div>
  );
}

/** Why an uploaded deck has not been read yet — the single upload's own answer,
 *  else what the queue recorded on the deck (a bulk deck has no inline answer). */
function aiNote(d: StagedDeck): string | null {
  if (d.deck && d.deck.statusId !== "pending_ai") return null;
  if (d.evalNote) return d.evalNote;
  if (d.deck?.aiError && (d.deck.aiState === "retrying" || d.deck.aiState === "failed")) {
    return d.deck.aiState === "failed"
      ? `Uploaded, but the AI evaluation could not be completed · ${d.deck.aiError}. You can re-run it from All decks.`
      : `Uploaded — the AI evaluation is retrying automatically · ${d.deck.aiError}.`;
  }
  return null;
}

function Meta({ label, value, tone }: { label: string; value: string; tone?: "green" | "amber" }) {
  return (
    <div className="min-w-[80px] flex-1 rounded-md border border-stone-dk bg-offwhite px-2.5 py-[7px]">
      <div className="mb-0.5 text-[8.5px] uppercase tracking-[0.05em] text-fg-muted">{label}</div>
      <div
        className={`font-bold ${tone ? "text-[11px]" : "text-[13px] text-fg"} ${tone === "green" ? "text-green" : tone === "amber" ? "text-warn" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}

/** `.up-flag-panel` — Parameters needing response → Send to Query. */
function FlagPanel({
  deck: d,
  parameters,
  onFlag,
  onSignal,
  onSend,
  sending,
  sendError,
}: { deck: StagedDeck } & ReviewScreenProps) {
  const count = Object.keys(d.flags).length;
  return (
    <div className="mb-2.5 rounded-[10px] border border-stone-dk bg-surface p-3.5" data-testid="up-flag-panel">
      <div className="mb-0.5 text-[12.5px] font-bold text-navy">Parameters needing response</div>
      <div className="mb-2.5 text-[10.5px] leading-[1.45] text-fg-muted">
        Check the areas the founder must clarify and tag the signal observed. These use the same areas and signals as
        the founder clarification form.
      </div>
      {parameters.length === 0 ? (
        <p className="text-[11px] text-fg-muted">Loading the evaluation areas…</p>
      ) : (
        <ul>
          {parameters.map((area, i) => {
            const sig = d.flags[area];
            const on = sig !== undefined;
            return (
              <li key={area} className={`flex items-center gap-[9px] py-[7px] ${i === 0 ? "" : "border-t border-[#F0EEE8]"}`}>
                <input
                  type="checkbox"
                  aria-label={`Flag ${area}`}
                  checked={on}
                  onChange={() => onFlag(d.key, area)}
                  className="h-[17px] w-[17px] shrink-0 cursor-pointer accent-[var(--gold-dk)]"
                />
                <span className={`flex-1 text-[11.5px] ${on ? "text-navy" : "text-fg-muted"}`}>{area}</span>
                <span className="flex gap-[5px]" role="group" aria-label={`${area} signal`}>
                  {(["weak", "absent"] as FlagSignal[]).map((s) => (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={on && sig === s}
                      onClick={() => onSignal(d.key, area, s)}
                      className={`whitespace-nowrap rounded-[20px] border px-[9px] py-[3px] text-[10px] font-semibold ${
                        on && sig === s
                          ? s === "weak"
                            ? "border-[#E8C77A] bg-[#FBEFD6] text-[#854F0B]"
                            : "border-[#E9B0B0] bg-[#F8D7D7] text-[#B42318]"
                          : "border-[#DCD7CC] bg-surface text-[#9A9488]"
                      }`}
                    >
                      {FLAG_SIGNAL_LABELS[s]}
                    </button>
                  ))}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-[11px] text-[10px] text-fg-muted">
        {count} parameter{count === 1 ? "" : "s"} flagged{count ? " · these appear on the founder clarification form" : ""}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2.5">
        {d.sentToQuery ? (
          <>
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#EAF3E2] px-4 py-[9px] text-[12px] font-semibold text-[#3A4E2E]">
              ✓ Sent to Query
            </span>
            <Link to="/app/query" className="text-[11px] text-gold-dk underline">
              View in Query →
            </Link>
          </>
        ) : count > 0 ? (
          <button
            type="button"
            disabled={sending === d.key}
            onClick={() => onSend(d.key)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gold-dk px-4 py-[9px] text-[12px] font-semibold text-white hover:bg-[#956010] disabled:opacity-60"
          >
            {sending === d.key ? "Sending…" : "Send to Query"}
          </button>
        ) : (
          <span className="text-[10.5px] text-fg-muted">Flag at least one parameter to send a query.</span>
        )}
        {sendError && sending === null && <span className="text-[11px] text-signal-flagged">{sendError}</span>}
      </div>
    </div>
  );
}
