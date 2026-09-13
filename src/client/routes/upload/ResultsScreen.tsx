import { Link } from "react-router-dom";
import { INTAKE_DETAIL_FIELDS, INTAKE_RESULTS_LABELS } from "../../../shared/intake";
import { INTAKE_STATUS_LABELS, intakeStatusOf, resultsSummary, type IntakeStatus } from "../../../shared/uploadReview";
import type { StagedDeck } from "./types";

/**
 * "Uploaded decks — AI-extracted details" (`#up-results`, F0296 / F0303 / F0304
 * / F0345): one row per uploaded deck, the seven prototype columns, a red
 * "not captured" cell for every detail the AI could not find, and the
 * Complete / Incomplete pill — plus the honest third state a real asynchronous
 * upload has, "Awaiting AI", while the deck is still being read.
 */
export const RESULTS_COLUMNS = ["Deck", ...INTAKE_DETAIL_FIELDS.map((f) => INTAKE_RESULTS_LABELS[f]), "Status"];

const PILL: Record<IntakeStatus, string> = {
  complete: "bg-[#EAF3E2] text-[#3A4E2E]",
  incomplete: "bg-[#F8D7D7] text-[#B42318]",
  awaiting: "bg-stone text-fg-muted",
};

export function ResultsScreen({
  uploaded,
  workspaceSector,
  onBack,
}: {
  uploaded: StagedDeck[];
  /** The sector the batch was recorded under, for the note. */
  workspaceSector: string | null;
  onBack: () => void;
}) {
  const statuses = uploaded.map((d) => (d.deck ? intakeStatusOf(d.deck) : "awaiting"));
  return (
    <section className="sj-frame" data-testid="up-results">
      <div className="tb">
        <div className="min-w-0">
          <h1 className="tbt">Uploaded decks — AI-extracted details</h1>
          <div className="tbs">
            The AI scanned each deck and recorded the founder&rsquo;s details. Any deck missing a detail is automatically
            marked Incomplete.
          </div>
        </div>
        <div className="tbr">
          <button type="button" className="tbb" onClick={onBack}>
            ← Back to review
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-[22px] py-[18px]">
        <div
          className="mb-3.5 rounded-lg border border-[#E1E8DA] bg-[#F4F6F1] px-[13px] py-[11px] text-[12px] leading-[1.5] text-fg-muted"
          data-testid="up-results-summary"
        >
          {uploaded.length === 0 ? "No decks uploaded yet." : resultsSummary(statuses)}
        </div>
        <div className="overflow-x-auto rounded-[10px] border border-stone-dk">
          <table className="w-full min-w-[780px] border-collapse text-[12px]">
            <thead>
              <tr>
                {RESULTS_COLUMNS.map((h) => (
                  <th
                    key={h}
                    className="border-b-[1.5px] border-stone-dk bg-[#FAFAF7] px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-[0.04em] text-fg-muted"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {uploaded.map((d, i) => {
                const status = statuses[i];
                const deck = d.deck;
                const values: Record<string, string | undefined> = {
                  founder: deck?.founder,
                  founderEmail: deck?.founderEmail,
                  founderPhone: deck?.founderPhone,
                  city: deck?.city,
                  sector: deck?.sector ?? d.context.sector,
                };
                return (
                  <tr key={d.key} className="border-b border-stone last:border-b-0">
                    <td className="whitespace-nowrap px-3 py-[11px] font-semibold text-navy">{deck?.name ?? d.name}</td>
                    {INTAKE_DETAIL_FIELDS.map((f) => {
                      const v = values[f];
                      if (v) {
                        return (
                          <td key={f} className="whitespace-nowrap px-3 py-[11px] text-navy">
                            {v}
                          </td>
                        );
                      }
                      // Sector is never "not captured": it is the workspace's, not the deck's.
                      if (f === "sector" || status === "awaiting") {
                        return (
                          <td key={f} className="whitespace-nowrap px-3 py-[11px] text-fg-muted">
                            —
                          </td>
                        );
                      }
                      return (
                        <td key={f} className="whitespace-nowrap px-3 py-[11px] italic text-[#B42318]" data-testid="up-miss">
                          ⚠ not captured
                        </td>
                      );
                    })}
                    <td className="whitespace-nowrap px-3 py-[11px]">
                      <span className={`inline-block rounded-[20px] px-[9px] py-[3px] text-[10px] font-bold ${PILL[status]}`}>
                        {INTAKE_STATUS_LABELS[status]}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-3.5 flex gap-[7px] text-[11px] leading-[1.5] text-fg-muted">
          <span aria-hidden="true" className="text-[#4A6644]">ⓘ</span>
          <span>
            Sector is taken from your workspace setup context (<b>{workspaceSector ?? "none set"}</b>) — not scanned from
            the deck. Founder name, email, phone and city are extracted from each deck on upload; any field the AI cannot
            capture is flagged and the deck is marked Incomplete until completed.
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3.5 border-t-2 border-olive bg-surface px-[18px] py-[11px]">
        <div className="text-[12px] text-fg-2">
          Review the captured details. Incomplete decks need the missing information before they can be evaluated.
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onBack}
            className="rounded-[7px] border border-stone-dk bg-surface px-4 py-2 text-[12px] text-fg-2 hover:bg-offwhite"
          >
            Back
          </button>
          <Link
            to="/app/alldecks"
            className="flex items-center gap-[7px] rounded-[7px] bg-olive px-[22px] py-[9px] text-[12.5px] font-semibold text-white hover:bg-olive-dk"
          >
            ✓ Done
          </Link>
        </div>
      </div>
    </section>
  );
}
