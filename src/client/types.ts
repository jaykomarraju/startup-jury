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
  /** Free-text tags (Aug-2026 issue 2 — search & tag deck facility). */
  tags?: string[];
  /** Core evaluation areas the AI scored below the workspace's mediocre band. */
  weakAreas?: string[];
  /** Deck sections the extraction found absent (Traction, Team, Ask…). */
  missingSections?: string[];

  // ── Aug-2026 stage-screen columns (issues 25–31) ──────────────────────────
  /** Mean of the human evaluations submitted on this deck. */
  juryScore?: number;
  /** When the deck was last assigned to an evaluator. */
  assignedAt?: string;
  /** True once the current assignee has submitted their evaluation. */
  assigneeSubmitted?: boolean;
  /** The deck's live (non-cancelled) call, if one is scheduled. */
  callScheduledAt?: string;
  callStatus?: string;
  /** How the startup left the active pipeline (Archive screen). */
  exitFromLabel?: string;
  exitAction?: string;
  exitNote?: string;
  exitAt?: string;
  exitBy?: string;
  /** Sign-up / curation state (Sign up Pipeline + Onboard ready). */
  paymentStatus?: string;
  documentsStatus?: string;
  curationStage?: string;
  onboardingProgress?: number;
  onboardingLead?: string;
  /** ISO timestamp the deck was uploaded. */
  uploadedAt?: string;
  /** Transitions the current user may perform from this deck's stage. */
  actions?: DeckAction[];
}

/** A role-permitted transition surfaced as an action button. */
export interface DeckAction {
  action: string;
  label: string;
  to: string;
}
