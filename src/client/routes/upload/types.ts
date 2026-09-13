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
  markedIncomplete: boolean;

  deckId?: string;
  uploadError?: string;
  intakeFlag?: "duplicate" | "returning";
  intakeNote?: string;
  /** Why the inline evaluation did not finish ("queued and will retry · …"). */
  evalNote?: string;
  deck?: DeckView;
  flags: Record<string, FlagSignal>;
  sentToQuery: boolean;
}
