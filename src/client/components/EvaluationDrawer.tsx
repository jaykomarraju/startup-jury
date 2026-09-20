import { Fragment, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ClipboardCheck, Clock, Info, X } from "lucide-react";
import type { DeckView } from "../types";
import type { ParamScoreView } from "./ScoreBars";
import { DeckPdfViewer } from "./DeckPdfViewer";
import { ResearchMenu } from "./ResearchMenu";
import { SignalTag } from "./SignalTag";
import { Badge } from "./Badge";
import { ScoreNumber, coreParamScores, deckMeta, scoreBandColor } from "./DeckCard";
import { INTAKE_FIELD_LABELS } from "../../shared/intake";
import { weightedTotal } from "../../shared/scoring";
import { AuthContext } from "../auth/AuthProvider";
import { getDeckReport, type DeckReportMatrix, type ReportGroup, type ReportRow } from "../api";

/** One entry of a deck's upload history (Session 5 — deck versioning). */
export interface DeckVersionSummary {
  id: string;
  version: number;
  fileName?: string;
  note?: string;
  uploadedByName?: string;
  createdAt: string;
}

export interface ExtractionSlide {
  label: string;
  heading?: string;
  text: string;
  missing?: boolean;
}

interface EvaluationDrawerProps {
  open: boolean;
  onClose: () => void;
  deck: DeckView;
  /** The AI's per-parameter breakdown (weight, value, rationale). */
  scores?: ParamScoreView[];
  extraction?: ExtractionSlide[];
  verdict?: string;
  /** Upload history — a re-upload appends a version (Session 5). */
  versions?: DeckVersionSummary[];
  /** Deck tag chips / editor (Aug-2026 issue 2), rendered under the header. */
  tagEditor?: ReactNode;
  /** Extra chips beside the signal + status badges (e.g. the AI score). */
  badges?: ReactNode;
  /** The AI composite, when the caller has it (else computed from `scores`). */
  weightedTotal?: number;
  /**
   * The deck-level narrative the prototype prints under "Overall AI remarks".
   * F0197 — the AI evaluation does not produce one yet, so no caller passes it
   * and the section shows its empty state.
   */
  overallRemarks?: string;
  /** The intro call's remarks, from a screen that has the call (CallsPage). */
  introRemarks?: string;
  /** Blind scoring withheld the AI breakdown for this viewer (F0106). */
  aiScoreWithheld?: boolean;
  /** Action-bar controls beside Close (e.g. a link to score the deck). */
  actions?: ReactNode;
}

/** The viewer's own column in the consolidated report, when they have scored. */
interface MyCell {
  value: number;
  comment?: string;
}

/** One row of the Parameter evaluation table — an AI score, or a placeholder. */
interface ParamRow {
  id: string;
  key?: string;
  label: string;
  weight: number;
  /** Absent before the AI has evaluated the deck (v3's `hideAi`). */
  value?: number;
  comment?: string;
}

/**
 * The deck report overlay — the prototype's `openReport()` (SU `_scripts.js`),
 * which is the SAME overlay every screen opens when you click a startup's name.
 *
 * Its order, which this follows: an action bar (**Evaluate — {name}** · Close);
 * a left **Pitch deck** pane with the **Research** menu; and a right evaluation
 * pane — eyebrow, name, meta, the **AI Score** / **My Score** tile pair,
 * **Overall AI remarks**, the **Parameter evaluation** table (Parameter ·
 * Weight · AI · My score · ⌄) whose rows expand to the AI remark and the
 * viewer's own, the **Weighted total** row, **My parameters evaluation**, and
 * **Intro call remarks**. Every section has an empty state, because on most
 * screens most of them are empty.
 *
 * It used to be a 448px read-only slide-over holding tags, the PDF, the verdict,
 * versions, score bars and extracted slides (F0196 / F0235). Those repo-only
 * pieces are kept — tags beside the header (Aug-2026 issue 2), extracted slides
 * and versions under the deck, intake alerts under the remarks.
 *
 * **Read-only by design here.** The prototype's action bar also carries *Save
 * draft* and *Submit my evaluation* with editable My-score inputs. Scoring has
 * one surface in this build — the Evaluate workbench (`EvalScorecard`), which
 * owns the override-rationale rule, the score scale and the submit — and there is
 * no draft state to save to (F0195). A caller that can score passes `actions`
 * linking there. See plan §8.
 */
export function EvaluationDrawer({
  open,
  onClose,
  deck,
  scores = [],
  extraction = [],
  verdict,
  versions = [],
  tagEditor,
  badges,
  weightedTotal: aiTotalProp,
  overallRemarks,
  introRemarks,
  aiScoreWithheld,
  actions,
}: EvaluationDrawerProps) {
  const viewerId = useContext(AuthContext)?.user?.id ?? null;
  const viewerRole = useContext(AuthContext)?.user?.role ?? null;
  const [report, setReport] = useState<DeckReportMatrix | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // The viewer's own scores and the role-scoped additional parameters come from
  // the consolidated report (one column per evaluator). A failure is not an
  // error state for the overlay — those sections simply stay empty.
  useEffect(() => {
    if (!open) return;
    let live = true;
    setReport(null);
    setExpanded(null);
    getDeckReport(deck.id)
      .then((r) => live && setReport(r))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [open, deck.id]);

  const mine = useMemo(() => {
    const byKey = new Map<string, MyCell>();
    // Wave 7 integration: `report` being truthy does NOT guarantee `core`.
    // `W7-D` made /api/decks/:id/report stage-aware, and a response that is not
    // the matrix — an error body, a stage that carries no core section — used to
    // reach `report.core.map` and white-screen the whole drawer. Guard the SHAPE,
    // not just the presence.
    if (!report?.core || !viewerId) return byKey;
    for (const row of report.core) {
      const cell = row.cells[viewerId];
      if (cell) byKey.set(row.key, cell);
    }
    return byKey;
  }, [report, viewerId]);

  if (!open) return null;

  const coreKeys = report?.core ? new Set(report.core.map((r) => r.key)) : null;
  const scored = coreParamScores(scores, coreKeys);
  const aiTotal = aiTotalProp ?? (scored.length > 0 ? weightedTotal(scored) : deck.aiScore);

  // Blind scoring (F0106) reaches here two ways — the caller's deck detail and
  // the report route, which enforces the same rule. Either is enough: a caller
  // that does not fetch the detail must not lose the explanation.
  const aiWithheld = aiScoreWithheld || report?.aiScoreWithheld === true;

  // V3 (item 1) — the "not evaluated yet" report. `openReport(..., {hideAi:…})`
  // still draws the whole report; only the AI's own numbers and remarks read as
  // absent, and each of them carries copy pointing at AI Evaluate. Blind scoring
  // empties the same cells for an unrelated reason and keeps its own wording, so
  // it wins where both would apply.
  const notAiEvaluated = aiTotal === undefined && scored.length === 0 && !aiWithheld;

  // The Parameter evaluation rows. Normally the AI's per-parameter breakdown;
  // before the AI has run, the core parameters themselves — the prototype draws
  // all 13 either way, so the table keeps its shape and the viewer can read what
  // is about to be scored instead of an empty panel.
  const paramRows: ParamRow[] =
    scored.length > 0
      ? scored.map((s) => ({
          id: s.key ?? s.label,
          key: s.key,
          label: s.label,
          weight: s.weight,
          value: s.value,
          comment: s.comment ?? undefined,
        }))
      : (report?.core ?? []).map((r) => ({ id: r.key, key: r.key, label: r.name, weight: r.weight }));

  const weightSum = paramRows.reduce((sum, s) => sum + s.weight, 0);
  const myRows = paramRows.flatMap((s) => {
    const cell = s.key ? mine.get(s.key) : undefined;
    return cell ? [{ weight: s.weight, value: cell.value }] : [];
  });
  const myTotal = myRows.length > 0 ? weightedTotal(myRows) : undefined;
  const myGroup = report?.additional?.find((g) => g.role === viewerRole);
  const additional = myGroup?.rows ?? [];
  const meta = deckMeta(deck);

  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label={`Evaluation report — ${deck.name}`}
    >
      <div
        className="absolute inset-0 bg-navy/40 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="absolute inset-0 flex flex-col overflow-hidden bg-surface shadow-xl sm:inset-3 sm:rounded-xl sm:border sm:border-line">
        {/* .jr-bar */}
        <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
          <span className="flex min-w-0 items-center gap-1.5 text-[13.5px] font-semibold text-fg">
            <ClipboardCheck className="h-4 w-4 shrink-0 text-olive" aria-hidden="true" />
            <span className="truncate">Evaluate — {deck.name}</span>
          </span>
          <span className="flex-1" />
          {actions}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="tbb"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" /> Close
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:overflow-hidden">
          {/* .jr-deck — the pitch deck and the Research menu */}
          <section className="flex min-h-0 flex-col gap-4 border-line bg-surface-2/40 p-4 lg:overflow-y-auto lg:border-r">
            {/* .jr-deck-h — `DeckPdfViewer` already draws the prototype's
                "Pitch deck · N slides" title with its icon, so this row carries
                only the Research menu. Adding a second title here broke
                `e2e/upload.spec.ts:143` on a strict-mode violation. Putting
                Research INSIDE that header, where the prototype has it, means
                editing DeckPdfViewer — not this session's file. See plan §3. */}
            <div className="flex items-center justify-end">
              <ResearchMenu deck={deck} />
            </div>
            <DeckPdfViewer deckId={deck.id} />

            {extraction.length > 0 && (
              <section>
                <h3 className="u-label mb-2">Extracted slides</h3>
                <ul className="flex flex-col gap-2">
                  {extraction.map((slide) => (
                    <li key={slide.label} className="rounded-lg border border-line bg-surface px-3 py-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-fg">{slide.label}</span>
                        {slide.missing && <Badge tone="danger">Missing</Badge>}
                      </div>
                      {slide.heading && (
                        <div className="mt-1 text-sm font-medium text-fg">{slide.heading}</div>
                      )}
                      <p className="mt-1 text-sm text-fg-muted">{slide.text}</p>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {versions.length > 0 && (
              <section>
                <h3 className="u-label mb-2">Deck versions · {versions.length}</h3>
                <ul className="flex flex-col gap-2">
                  {versions.map((v) => (
                    <li
                      key={v.id}
                      className="flex items-start justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge tone={v.version === versions[0].version ? "info" : "neutral"}>
                            v{v.version}
                          </Badge>
                          <span className="truncate text-sm text-fg">{v.fileName ?? "Pitch deck"}</span>
                        </div>
                        {v.note && <p className="mt-0.5 text-xs text-fg-muted">{v.note}</p>}
                      </div>
                      <span className="shrink-0 text-xs text-fg-muted">
                        {new Date(v.createdAt).toLocaleDateString()}
                        {v.uploadedByName ? ` · ${v.uploadedByName}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </section>

          {/* .jr-eval — the evaluation report */}
          <section className="min-h-0 p-5 lg:overflow-y-auto">
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-olive">
              ai·STARTUPJURY · Evaluation report
            </div>
            <h2 className="mt-1 text-lg font-semibold text-fg">{deck.name}</h2>
            {meta && <div className="mt-0.5 text-xs text-fg-muted">{meta}</div>}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {deck.signal && <SignalTag signal={deck.signal} />}
              {deck.status && <Badge tone="info">{deck.status}</Badge>}
              {badges}
            </div>
            {tagEditor && <div className="mt-3">{tagEditor}</div>}

            {/* .jr-tiles */}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-line bg-surface px-4 py-3">
                <div className="u-label">AI Score</div>
                <div
                  className="mt-1 font-mono text-[22px] font-semibold leading-none"
                  style={{ color: aiTotal !== undefined ? scoreBandColor(aiTotal) : undefined }}
                >
                  {aiTotal !== undefined ? aiTotal.toFixed(1) : "–"}
                  <span className="text-xs font-normal text-fg-muted">/10</span>
                </div>
                <div className="mt-1 text-[11px] text-fg-muted">
                  {aiWithheld
                    ? "Hidden until you submit your own evaluation"
                    : notAiEvaluated
                      ? "Run AI Evaluate to score"
                      : `Weighted across ${paramRows.length} parameter${paramRows.length === 1 ? "" : "s"}`}
                </div>
              </div>
              <div className="rounded-lg border border-olive-md bg-olive-lt px-4 py-3">
                <div className="u-label">My Score</div>
                <div
                  className="mt-1 font-mono text-[22px] font-semibold leading-none"
                  style={{ color: myTotal !== undefined ? scoreBandColor(myTotal) : undefined }}
                >
                  {myTotal !== undefined ? myTotal.toFixed(1) : "–"}
                  <span className="text-xs font-normal text-fg-muted">/10</span>
                </div>
                <div className="mt-1 text-[11px] text-fg-muted">
                  {myRows.length} of {paramRows.length} parameters scored
                </div>
              </div>
            </div>

            <ReportSection title="Overall AI remarks">
              {overallRemarks ? (
                <p className="text-[12.5px] leading-relaxed text-fg-2">{overallRemarks}</p>
              ) : notAiEvaluated ? (
                <EmptyNote icon="info">
                  Not evaluated yet. Click <b>AI Evaluate</b> on the Evaluate page to generate the AI
                  scores and remarks &mdash; they&rsquo;ll then appear here and on the Assign page.
                </EmptyNote>
              ) : (
                <EmptyNote icon="info">
                  The AI has not written an overall remark for this deck yet.
                </EmptyNote>
              )}
              {verdict && (
                <div className="mt-2 rounded-lg border border-line bg-surface-2 px-3 py-2">
                  <div className="u-label">Verdict</div>
                  <div className="mt-0.5 text-sm font-medium text-fg">{verdict}</div>
                </div>
              )}
              {deck.missingFields && deck.missingFields.length > 0 && (
                <div className="mt-2 text-sm text-signal-flagged">
                  Missing founder details:{" "}
                  {deck.missingFields.map((f) => INTAKE_FIELD_LABELS[f]).join(", ")}
                </div>
              )}
              {/* Soft intake alert (duplicate / returning company) — never a block. */}
              {deck.intakeFlag && deck.intakeNote && (
                <div className="mt-2 rounded-lg border border-line bg-surface-2 px-3 py-2">
                  <div className="u-label">
                    {deck.intakeFlag === "duplicate" ? "Possible duplicate" : "Returning company"}
                  </div>
                  <p className="mt-0.5 text-sm text-fg-muted">{deck.intakeNote}</p>
                </div>
              )}
            </ReportSection>

            <ReportSection
              title="Parameter evaluation"
              hint="tap any parameter to read the AI remark and add yours"
            >
              {paramRows.length === 0 ? (
                <EmptyNote icon="info">
                  {aiWithheld
                    ? "Blind scoring is on — the AI breakdown appears once you submit your own evaluation."
                    : "This deck has not been scored yet."}
                </EmptyNote>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-line">
                  <table className="w-full text-left text-[11.5px]">
                    <thead>
                      <tr className="bg-offwhite text-[10px] font-semibold uppercase tracking-[0.05em] text-fg-muted">
                        <th className="px-3 py-2">Parameter</th>
                        <th className="px-3 py-2 text-center">Weight</th>
                        <th className="px-3 py-2 text-center">AI</th>
                        <th className="px-3 py-2 text-center">My score</th>
                        <th className="w-8 px-2 py-2" aria-label="Expand" />
                      </tr>
                    </thead>
                    <tbody>
                      {paramRows.map((s, i) => {
                        const id = s.id;
                        const isOpen = expanded === id;
                        const my = s.key ? mine.get(s.key) : undefined;
                        return (
                          <Fragment key={id}>
                            <tr
                              className="cursor-pointer border-t border-line-soft hover:bg-offwhite"
                              onClick={() => setExpanded(isOpen ? null : id)}
                              aria-expanded={isOpen}
                            >
                              <td className="px-3 py-2 text-fg">
                                <span className="mr-2 inline-flex h-4 min-w-4 items-center justify-center rounded bg-surface-2 px-1 font-mono text-[9.5px] text-fg-muted">
                                  {i + 1}
                                </span>
                                {s.label}
                              </td>
                              <td className="px-3 py-2 text-center text-fg-muted">{s.weight}%</td>
                              <td className="px-3 py-2 text-center">
                                <ScoreNumber value={s.value} />
                              </td>
                              <td className="px-3 py-2 text-center">
                                <ScoreNumber value={my?.value} />
                              </td>
                              <td className="px-2 py-2 text-center text-fg-muted">
                                <ChevronDown
                                  className={`inline h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`}
                                  aria-hidden="true"
                                />
                              </td>
                            </tr>
                            {isOpen && (
                              <tr className="bg-offwhite">
                                <td colSpan={5} className="px-3 py-2.5">
                                  <div className="text-[11.5px]">
                                    <b className="text-fg">AI remark</b>
                                    <p className="mt-0.5 text-fg-2">
                                      {s.comment ||
                                        (notAiEvaluated
                                          ? "Not evaluated yet — run AI Evaluate to generate the AI remark."
                                          : "No AI remark was recorded for this parameter.")}
                                    </p>
                                  </div>
                                  <div className="mt-2 text-[11.5px]">
                                    <b className="text-fg">My remarks for this parameter</b>
                                    <p className="mt-0.5 text-fg-2">
                                      {my?.comment || "You have not added a remark for this parameter."}
                                    </p>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                      <tr className="border-t border-line bg-surface-2 font-semibold">
                        <td className="px-3 py-2 text-fg">Weighted total</td>
                        <td className="px-3 py-2 text-center text-fg-muted">{weightSum}%</td>
                        <td className="px-3 py-2 text-center">
                          <ScoreNumber value={aiTotal} />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <ScoreNumber value={myTotal} />
                        </td>
                        <td />
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </ReportSection>

            <ReportSection
              title="My parameters evaluation"
              hint={<AdditionalHint group={myGroup} />}
            >
              {additional.length === 0 ? (
                <EmptyNote icon="info">
                  These auto-fill from the role&apos;s parameters in <b>My Parameters</b> once you select a
                  role to assign this deck to.
                </EmptyNote>
              ) : (
                <AdditionalTable rows={additional} viewerId={viewerId} />
              )}
            </ReportSection>

            <ReportSection title="Intro call remarks" hint="your notes after attending the founder call">
              {introRemarks ? (
                <p className="whitespace-pre-line text-[12.5px] text-fg-2">{introRemarks}</p>
              ) : (
                <EmptyNote icon="clock">No intro call remarks yet.</EmptyNote>
              )}
            </ReportSection>
          </section>
        </div>
      </div>
    </div>
  );
}

function ReportSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mt-5">
      <h3 className="mb-2 text-[12px] font-semibold text-fg">
        {title}
        {hint && <small className="ml-1.5 text-[10.5px] font-normal text-fg-muted">{hint}</small>}
      </h3>
      {children}
    </section>
  );
}

/**
 * The small print beside "My parameters evaluation" — the prototype's three
 * `custBlock` headers, chosen by the section's mode:
 *   editable  → "{Role} · from My Parameters · auto-filled by assigned role"
 *   read only → "{Role} · read only"
 *   completed → "{Role} · completed by jury" + a Submitted badge
 * With no section configured it falls back to the prototype's bare header.
 */
function AdditionalHint({ group }: { group?: ReportGroup }) {
  if (!group) return <>role-specific additional parameters</>;
  if (group.mode === "completed") {
    return (
      <span className="inline-flex items-center gap-1.5">
        {group.roleLabel} · completed by jury
        <Badge tone="positive">Submitted</Badge>
      </span>
    );
  }
  if (group.mode === "read_only") return <>{group.roleLabel} · read only</>;
  return <>{group.roleLabel} · from My Parameters · auto-filled by assigned role</>;
}

function EmptyNote({ icon, children }: { icon: "info" | "clock"; children: ReactNode }) {
  const Icon = icon === "clock" ? Clock : Info;
  return (
    <div className="rounded-lg border border-dashed border-line bg-offwhite px-4 py-3 text-[12.5px] leading-normal text-fg-muted">
      <Icon className="mr-1.5 inline h-3.5 w-3.5 align-[-2px]" aria-hidden="true" />
      {children}
    </div>
  );
}

/**
 * The prototype's `custBlock` table — Parameter · Weight · My score · ⌄, each
 * row expanding to the viewer's own remark, and an "Average of my scores" total.
 *
 * The Weight cell reads "Informational" rather than a percentage: every
 * additional parameter is seeded `weight = 0` (migration 0013) because they do
 * not enter the composite, so "0%" would state the opposite of what it means.
 * The prototype's role parameters carry invented weights. See plan §3 item 1.
 */
function AdditionalTable({ rows, viewerId }: { rows: ReportRow[]; viewerId: string | null }) {
  const [open, setOpen] = useState<string | null>(null);
  const values = rows.flatMap((r) => {
    const v = viewerId ? r.cells[viewerId]?.value : undefined;
    return typeof v === "number" ? [v] : [];
  });
  const avg = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : undefined;
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-left text-[11.5px]">
        <thead>
          <tr className="bg-offwhite text-[10px] font-semibold uppercase tracking-[0.05em] text-fg-muted">
            <th className="px-3 py-2">Parameter</th>
            <th className="px-3 py-2 text-center">Weight</th>
            <th className="px-3 py-2 text-center">My score</th>
            <th className="w-8 px-2 py-2" aria-label="Expand" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const cell = viewerId ? r.cells[viewerId] : undefined;
            const isOpen = open === r.key;
            return (
              <Fragment key={r.key}>
                <tr
                  className="cursor-pointer border-t border-line-soft hover:bg-offwhite"
                  onClick={() => setOpen(isOpen ? null : r.key)}
                  aria-expanded={isOpen}
                >
                  <td className="px-3 py-2 text-fg">
                    <span className="mr-2 font-mono text-[9.5px] text-fg-muted">C{i + 1}</span>
                    {r.name}
                  </td>
                  <td className="px-3 py-2 text-center text-fg-muted">Informational</td>
                  <td className="px-3 py-2 text-center">
                    <ScoreNumber value={cell?.value} outOf={10} />
                  </td>
                  <td className="px-2 py-2 text-center text-fg-muted">
                    <ChevronDown
                      className={`inline h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`}
                      aria-hidden="true"
                    />
                  </td>
                </tr>
                {isOpen && (
                  <tr className="bg-offwhite">
                    <td colSpan={4} className="px-3 py-2.5">
                      <div className="text-[11.5px]">
                        <b className="text-fg">My remarks for this parameter</b>
                        <p className="mt-0.5 text-fg-2">
                          {cell?.comment || "You have not added a remark for this parameter."}
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          <tr className="border-t border-line bg-surface-2 font-semibold">
            <td className="px-3 py-2 text-fg">Average of my scores</td>
            <td className="px-3 py-2 text-center text-fg-muted">—</td>
            <td className="px-3 py-2 text-center">
              <ScoreNumber value={avg} outOf={10} />
            </td>
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}
