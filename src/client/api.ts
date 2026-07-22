// Typed fetch helpers for the deck API. All requests are same-origin and carry
// the session cookie automatically.
import type { DeckView } from "./types";
import type { ExtractionSlide, ParamScoreView } from "./components";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`request failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export function listDecks(): Promise<{ decks: DeckView[] }> {
  return fetch("/api/decks").then((r) => json(r));
}

export interface DeckReport {
  deck: DeckView;
  extraction: ExtractionSlide[];
  scores: ParamScoreView[];
  weightedTotal?: number;
  verdict?: string;
}

export function getDeck(id: string): Promise<DeckReport> {
  return fetch(`/api/decks/${id}`).then((r) => json(r));
}

export interface SingleUploadResult {
  deckId: string;
  evaluated: boolean;
  result?: { weightedTotal: number; signal: string; status: string; gatePassed: boolean };
}

export function uploadSingle(form: FormData): Promise<SingleUploadResult> {
  return fetch("/api/decks/upload", { method: "POST", body: form }).then((r) => json(r));
}

export function uploadBulk(form: FormData): Promise<{ count: number; deckIds: string[] }> {
  return fetch("/api/decks/bulk", { method: "POST", body: form }).then((r) => json(r));
}
