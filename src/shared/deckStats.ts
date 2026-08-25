/**
 * The six All-decks stat boxes and the pipeline-progress rail derived from them
 * (Aug-2026 issues 4, 5 and 7).
 *
 * Issue 4/5 renamed the last two boxes to **Assigned** and **Shortlisted**, and
 * issue 7 requires the right rail's "Pipeline progress" items to be *the same
 * titles as the stat boxes* — so both come from this one list. `Uploaded` is the
 * denominator, exactly as the prototype's `mpProgress()` treats `data-stat="all"`.
 */
import type { Edition } from "./roles";

export type DeckStatKey =
  | "all"
  | "pending"
  | "incomplete"
  | "evaluated"
  | "assigned"
  | "shortlisted";

/** The minimum a deck must expose to be counted. */
export interface StatDeck {
  aiScore?: number;
  statusId?: string;
  signal?: string;
  assignedTo?: string;
}

/** Stages that mean "this deck cleared the shortlist bar", per edition. */
const SHORTLISTED_STAGES: Record<Edition, readonly string[]> = {
  incubator: ["shortlisted", "intro", "signup", "onboard_ready"],
  vc: [
    "partner_review",
    "partner_call",
    "investment_dd",
    "ic_review",
    "mp_decision",
    "alignment_call",
    "term_sheet",
    "legal_dd",
    "onboard_ready",
  ],
};

/** Stages that mean "allocated to an evaluator and being worked". */
const ASSIGNED_STAGES: readonly string[] = [
  "assigned",
  "jury_evaluation",
  "analyst_scoring",
  "associate_review",
];

export function matchesStat(edition: Edition, deck: StatDeck, key: DeckStatKey): boolean {
  switch (key) {
    case "all":
      return true;
    case "pending":
      return deck.aiScore === undefined && deck.statusId !== "incomplete";
    case "incomplete":
      return deck.statusId === "incomplete" || deck.signal === "flagged";
    case "evaluated":
      return deck.aiScore !== undefined;
    case "assigned":
      // Either explicitly allocated to someone, or sitting in a scoring stage.
      return Boolean(deck.assignedTo) || ASSIGNED_STAGES.includes(deck.statusId ?? "");
    case "shortlisted":
      return SHORTLISTED_STAGES[edition].includes(deck.statusId ?? "");
  }
}

export interface DeckStat {
  key: DeckStatKey;
  label: string;
  value: number;
  sublabel: string;
  /** Percentage of the Uploaded total (0–100). */
  progress: number;
  /** CSS colour token for the bar + the pipeline-progress dot. */
  color: string;
}

function pct(n: number, total: number): number {
  return total === 0 ? 0 : Math.round((n / total) * 100);
}

const STAT_ORDER: {
  key: DeckStatKey;
  label: string;
  color: string;
  sub: (n: number, total: number) => string;
}[] = [
  { key: "all", label: "Uploaded", color: "var(--color-amber)", sub: () => "All submissions" },
  {
    key: "pending",
    label: "Pending",
    color: "var(--color-signal-moderate)",
    sub: () => "Awaiting evaluation",
  },
  {
    key: "incomplete",
    label: "Incomplete",
    color: "var(--color-signal-flagged)",
    sub: () => "Missing details",
  },
  {
    key: "evaluated",
    label: "AI Evaluated",
    color: "var(--color-signal-strong)",
    sub: (n, total) => `${pct(n, total)}% of uploaded`,
  },
  // Issue 4 — the fifth box is ASSIGNED.
  {
    key: "assigned",
    label: "Assigned",
    color: "var(--color-info)",
    sub: (n, total) => `${pct(n, total)}% of uploaded`,
  },
  // Issue 5 — the sixth box is SHORTLISTED.
  {
    key: "shortlisted",
    label: "Shortlisted",
    color: "var(--color-positive)",
    sub: (n, total) => `${pct(n, total)}% shortlist rate`,
  },
];

/** The six stat boxes, in the order the design puts them. */
export function deckStats(edition: Edition, decks: StatDeck[]): DeckStat[] {
  const total = decks.length;
  return STAT_ORDER.map((def) => {
    const value = decks.filter((d) => matchesStat(edition, d, def.key)).length;
    return {
      key: def.key,
      label: def.label,
      value,
      sublabel: def.sub(value, total),
      progress: def.key === "all" ? 100 : pct(value, total),
      color: def.color,
    };
  });
}

/**
 * The right rail's Pipeline progress (issue 7): the same titles as the stat
 * boxes, minus the "Uploaded" total which is the denominator.
 */
export function pipelineProgress(stats: DeckStat[]): DeckStat[] {
  return stats.filter((s) => s.key !== "all");
}
