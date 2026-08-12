import type { DeckSignal } from "./theme/signals";
import type { IntakeField, IntakeFlag } from "../shared/intake";

/**
 * Client-side view model for a deck row/card. This is a presentational shape used
 * by shared components; the live API model arrives in Phase 3.
 */
export interface DeckView {
  id: string;
  name: string;
  sector?: string;
  stage?: string;
  city?: string;
  founder?: string;
  email?: string;
  /** Required intake detail (Session 5 — upload validation). */
  founderEmail?: string;
  founderPhone?: string;
  /** Required columns still missing — a non-empty list means Incomplete. */
  missingFields?: IntakeField[];
  /** Soft duplicate / returning-company alert raised at intake. */
  intakeFlag?: IntakeFlag;
  intakeNote?: string;
  /** The earlier deck this one matched, if any. */
  relatedDeckId?: string;
  /** Deck version counter — bumps on every re-upload. */
  contentVersion?: number;
  /** Weighted AI score 0–10 (undefined until evaluated). */
  aiScore?: number;
  /** AI + jury composite average — the number the shortlist floor is judged on. */
  decisionScore?: number;
  /** The program's minimum shortlist score, when one is configured. */
  shortlistMin?: number;
  /** True when the deck sits below its program's shortlist floor. */
  shortlistBlocked?: boolean;
  signal?: DeckSignal;
  /** Pipeline status label (e.g. "AI Evaluated", "Shortlisted"). */
  status?: string;
  /** Raw pipeline stage id (e.g. "shortlisted") for filtering/gating. */
  statusId?: string;
  /**
   * Session 7 (§9). `status` alone can't tell a deck that is being evaluated
   * right now from one permanently stranded at Pending AI:
   *   in_progress — queued/running · retrying — a failed attempt, more to come
   *   failed      — given up on (the credit was refunded) · ok — not pending
   */
  aiState?: "ok" | "in_progress" | "retrying" | "failed";
  /** Operator-facing cause, e.g. "AI provider billing — out of credits". */
  aiError?: string;
  /** The raw provider message behind `aiError`. */
  aiErrorDetail?: string;
  aiAttempts?: number;
  assignedTo?: string;
  assignedToName?: string;
  /** The program / cohort this deck sits under (Session 2 hierarchy). */
  programName?: string;
  cohortName?: string;
  /** Transitions the current user may perform from this deck's stage. */
  actions?: DeckAction[];
}

/** A role-permitted transition surfaced as an action button. */
export interface DeckAction {
  action: string;
  label: string;
  to: string;
}
