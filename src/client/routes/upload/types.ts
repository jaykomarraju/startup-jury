import type { DeckView } from "../../types";
import type { FlagSignal, StagedIssue } from "../../../shared/uploadReview";

export type UploadMethod = "single" | "bulk" | "crm";

/** Where a batch's decks belong — applied to every deck (F0223). */
export interface IntakeContextDraft {
  programId?: string;
  cohortId?: string;
  sector?: string;
}

/** The single-upload form's per-deck details. Blank = "let the AI read it". */
export interface SingleDetails {
  name: string;
  stage: string;
  founder: string;
  founderEmail: string;
  founderPhone: string;
  city: string;
}

/**
 * A deck on the "Review uploaded decks" list. It is staged in the browser —
 * nothing is stored and no credit is consumed — until the operator ticks it and
 * clicks "Upload selected decks"; after that `deckId` is set and `deck` follows
 * the AI as it reads the deck.
 *
 * `markedIncomplete` was removed by S2-UPLOAD with the "Mark incomplete" button
 * it existed for (feedback row 2). It had exactly one writer and no reader
 * outside this screen, so it is deleted rather than pinned to false; the deck's
 * real Incomplete verdict comes from the AI, through `uploadDeckStatus(deck)`,
 * which since issue 5 says which of the two things was incomplete.
 */
export interface StagedDeck {
  key: string;
  /** Startup name as typed, else the provisional one from the file name. */
  name: string;
  fileName: string;
  size: number;
  /** Null only for a ZIP entry too large to have been inflated. */
  file: File | null;
  source: "single" | "bulk";
  details?: SingleDetails;
  context: IntakeContextDraft;
  /** Page count, once pdf.js has read the file (null until then / unreadable). */
  slides: number | null;
  issues: StagedIssue[];
  checked: boolean;

  deckId?: string;
  /**
   * This deck is in the request that is in flight right now. A bulk batch is
   * several bounded requests since issue 3, so "the batch is busy" is no longer
   * the same statement as "this deck is being sent" — the operator who waited
   * forty minutes had no way to tell which of their ten decks had moved.
   */
  uploading?: boolean;
  uploadError?: string;
  intakeFlag?: "duplicate" | "returning";
  intakeNote?: string;
  /** Why the inline evaluation did not finish ("queued and will retry · …"). */
  evalNote?: string;
  deck?: DeckView;
  flags: Record<string, FlagSignal>;
  sentToQuery: boolean;
}
