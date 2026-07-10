import type { DeckSignal } from "./theme/signals";

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
  /** Weighted AI score 0–10 (undefined until evaluated). */
  aiScore?: number;
  signal?: DeckSignal;
  /** Pipeline status label (e.g. "AI Evaluated", "Shortlisted"). */
  status?: string;
}
