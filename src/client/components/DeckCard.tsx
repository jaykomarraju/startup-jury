import { AlertTriangle, BarChart3, Leaf } from "lucide-react";
import type { ReactNode } from "react";
import type { DeckView } from "../types";
import { SignalTag } from "./SignalTag";

function meta(deck: DeckView): string {
  return [deck.sector, deck.stage, deck.city].filter(Boolean).join(" · ");
}

/** "Sector · Stage · City" — the prototype's `.sm` sub-line under a startup name. */
export function deckMeta(deck: DeckView): string {
  return meta(deck);
}

/**
 * Prototype `.sch` — the AI-score chip every table uses: 11px/600 olive-dark on
 * olive-light, 5px radius. It was a neutral mono chip with a ring here.
 */
export function ScoreChip({ value }: { value?: number }) {
  if (value === undefined) return <span className="text-fg-muted">—</span>;
  return (
    <span className="inline-flex rounded-[5px] bg-olive-lt px-[7px] py-0.5 font-mono text-[11px] font-semibold text-olive-dk">
      {value.toFixed(1)}
    </span>
  );
}

/**
 * The prototype's three score bands as colours (`asScoreCol`, `jpColor`): at or
 * above the Best threshold green, at or above Mediocre amber, else red. The
 * bounds default to the shipped cohort thresholds; a screen that has loaded the
 * org's configured ones passes them.
 */
export function scoreBandColor(value: number, best = 7, mediocre = 5): string {
  if (value >= best) return "var(--green)";
  if (value >= mediocre) return "var(--amber)";
  return "var(--red)";
}

/**
 * The parameters that make up the composite. `GET /api/decks/:id` returns the
 * AI's scores for EVERY parameter, including the role-scoped additional ones,
 * which are informational (weight 0) and belong under "My parameters
 * evaluation", not in the 13-row breakdown. The consolidated report's `core`
 * keys are authoritative when a caller has them; otherwise weight decides.
 */
export function coreParamScores<T extends { key?: string; weight: number; value: number }>(
  scores: T[],
  coreKeys?: ReadonlySet<string> | null,
): T[] {
  return scores.filter(
    (s) => Number.isFinite(s.value) && (coreKeys && s.key ? coreKeys.has(s.key) : s.weight > 0),
  );
}

/** A coloured mono score (`.jp-num` / `.mp-sc`), or an em dash when absent. */
export function ScoreNumber({
  value,
  best,
  mediocre,
  outOf,
}: {
  value?: number | null;
  best?: number;
  mediocre?: number;
  /** Render the "/10" suffix (`<small>/10</small>`). */
  outOf?: number;
}) {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return <span className="font-mono text-fg-muted">—</span>;
  }
  return (
    <span
      className="font-mono text-[12px] font-semibold"
      style={{ color: scoreBandColor(value, best, mediocre) }}
    >
      {value.toFixed(1)}
      {outOf !== undefined && <small className="font-normal text-fg-muted">/{outOf}</small>}
    </span>
  );
}

export type PillTone = "blue" | "amber" | "green" | "red" | "grey";

const PILL_TONES: Record<PillTone, string> = {
  // `.sp-n` / `.sp-p` / `.sp-d` / `.sp-i`, plus the jury screen's grey Draft chip.
  blue: "bg-blue-lt text-blue",
  amber: "bg-warn-lt text-warn",
  green: "bg-green-lt text-green",
  red: "bg-red-lt text-red",
  grey: "bg-surface-2 text-fg-muted",
};

/** Prototype `.sp` — a rounded 10px/500 status pill. */
export function StatusPill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-[7px] py-0.5 text-[10px] font-medium ${PILL_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * Intake completeness — `.up-st-ok` **Complete** / `.up-st-inc` **Incomplete**
 * (10px/700 pills). On All decks this is what the Status column means: are the
 * five founder details captured (`deck.missingFields`), not the pipeline stage.
 */
export function IntakeStatusPill({ deck }: { deck: DeckView }) {
  const complete = !deck.missingFields || deck.missingFields.length === 0;
  return complete ? (
    <span className="inline-block rounded-full bg-green-lt px-[9px] py-[3px] text-[10px] font-bold text-green">
      Complete
    </span>
  ) : (
    <span className="inline-block rounded-full bg-red-lt px-[9px] py-[3px] text-[10px] font-bold text-red">
      Incomplete
    </span>
  );
}

/** `.up-miss` — an intake field the extraction did not find. */
export function NotCaptured() {
  return (
    <span className="inline-flex items-center gap-1 italic text-red">
      <AlertTriangle className="h-[11px] w-[11px]" aria-hidden="true" /> not captured
    </span>
  );
}

/**
 * The startup name as the prototype draws it (`nameCell`): an olive, dotted-
 * underline link titled "Open deck & evaluation report". Only the NAME opens the
 * report — the row itself is not the click target.
 */
export function StartupNameLink({
  deck,
  onOpen,
  leaf,
}: {
  deck: DeckView;
  onOpen: (deck: DeckView) => void;
  /** The jury pipeline's `.mp-sname` carries a leaf glyph before the name. */
  leaf?: boolean;
}) {
  return (
    <button
      type="button"
      title="Open deck & evaluation report"
      onClick={() => onOpen(deck)}
      className="inline-flex items-center gap-1 text-left font-medium text-olive underline decoration-dotted underline-offset-2 hover:text-olive-dk"
    >
      {leaf && <Leaf className="h-3 w-3" aria-hidden="true" />}
      {deck.name}
    </button>
  );
}

/**
 * `asSpark` — one bar per parameter, height by score and coloured by band. A
 * deck whose breakdown has not loaded (or does not exist) draws nothing rather
 * than invented bars.
 */
export function ParamSparkline({
  values,
  best,
  mediocre,
}: {
  values: number[];
  best?: number;
  mediocre?: number;
}) {
  return (
    <span className="inline-flex items-end gap-px" aria-hidden="true">
      {values.map((v, i) => (
        <span
          key={i}
          className="inline-block w-[3px] rounded-[1px]"
          title={v.toFixed(1)}
          style={{
            height: `${Math.max(3, Math.round((v / 10) * 22))}px`,
            background: scoreBandColor(v, best, mediocre),
          }}
        />
      ))}
      <BarChart3 className="ml-1 h-3 w-3 self-center text-fg-muted" />
    </span>
  );
}

interface DeckProps {
  deck: DeckView;
  onClick?: (deck: DeckView) => void;
}

/** Which deck field fills the row's second column (matches the table header). */
type SecondaryField = "founder" | "sector";

/** Card presentation of a deck (grid layouts). */
export function DeckCard({ deck, onClick }: DeckProps) {
  return (
    <button
      type="button"
      onClick={() => onClick?.(deck)}
      className="flex w-full flex-col gap-3 rounded-xl border border-line bg-surface p-4 text-left transition-colors hover:border-olive-md"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-fg">{deck.name}</div>
          <div className="mt-0.5 text-xs text-fg-muted">{meta(deck)}</div>
        </div>
        {deck.signal && <SignalTag signal={deck.signal} />}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-fg-muted">{deck.founder ?? "—"}</span>
        <ScoreChip value={deck.aiScore} />
      </div>
    </button>
  );
}

/** Table-row presentation of a deck (list layouts). */
export function DeckRow({
  deck,
  onClick,
  secondary = "founder",
}: DeckProps & { secondary?: SecondaryField }) {
  return (
    <tr
      onClick={() => onClick?.(deck)}
      className={`border-t border-line ${onClick ? "cursor-pointer hover:bg-surface-2" : ""}`}
    >
      <td className="px-4 py-3">
        <div className="font-medium text-fg">{deck.name}</div>
        <div className="mt-0.5 text-xs text-fg-muted">{meta(deck)}</div>
      </td>
      <td className="px-4 py-3 text-sm text-fg-muted">{deck[secondary] ?? "—"}</td>
      <td className="px-4 py-3 text-sm text-fg-muted">{deck.city ?? "—"}</td>
      <td className="px-4 py-3">
        <ScoreChip value={deck.aiScore} />
      </td>
      <td className="px-4 py-3">
        {deck.signal ? <SignalTag signal={deck.signal} /> : null}
      </td>
      <td className="px-4 py-3 text-sm text-fg-muted">
        {deck.status ?? "—"}
        <AiHealthLine deck={deck} />
      </td>
    </tr>
  );
}

/**
 * §9: a deck parked at Pending AI used to look identical whether it was
 * evaluating right now or permanently stranded. Say which.
 */
export function AiHealthLine({ deck }: { deck: DeckView }) {
  if (deck.aiState === "failed") {
    return (
      <div className="mt-0.5 flex items-center gap-1 text-xs text-signal-flagged">
        <AlertTriangle className="h-3 w-3" /> Failed{deck.aiError ? ` · ${deck.aiError}` : ""}
      </div>
    );
  }
  if (deck.aiState === "retrying") {
    return (
      <div className="mt-0.5 text-xs text-amber">
        Retrying{deck.aiError ? ` · ${deck.aiError}` : ""}
      </div>
    );
  }
  if (deck.aiState === "in_progress") {
    return <div className="mt-0.5 text-xs text-fg-muted">In progress</div>;
  }
  return null;
}
