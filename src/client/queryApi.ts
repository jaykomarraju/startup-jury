// The Query screen's calls (W7-C).
//
// Kept out of `api.ts` (not this session's file) for two reasons the screen
// cannot work around:
//   • `createQuery(id, questions)` posts the body alone, so the Subject the
//     operator typed never left the browser (F0216). `recordQuery` sends the
//     letter and its subject as separate fields.
//   • `api.ts`'s `QueryDraft` declares `questions` / `areas` in a shape the
//     draft route has never returned. `QueryLetterDraft` is what
//     `GET /api/questions/draft/:deckId` actually answers.

import { ApiError } from "./api";
import type { AreaQuestions, ResponseArea, ScoredArea } from "../shared/queries";
import type { DeckView } from "./types";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new ApiError(res.status, body);
  }
  return res.json() as Promise<T>;
}

export interface QueryLetterDraft {
  deckId: string;
  deckName: string;
  message: string;
  areas: ResponseArea[];
  questions: AreaQuestions[];
  autoClarification: boolean;
  triggered: boolean;
}

/** The bank-composed letter for one deck (`W2-C`'s producer). */
export function fetchLetterDraft(deckId: string): Promise<QueryLetterDraft> {
  return fetch(`/api/questions/draft/${encodeURIComponent(deckId)}`).then((r) => json(r));
}

export interface RecordedQuery {
  ok: true;
  queryId: string;
  /**
   * True only when the outbox reports the message actually left the Worker.
   * Absent — as it is from a server that does not report delivery — is read as
   * "recorded", never as "sent".
   */
  delivered?: boolean;
  emailStatus?: string;
}

/** Raise one founder query: the letter exactly as composed, under its own subject. */
export function recordQuery(deckId: string, letter: { subject: string; body: string }) {
  return fetch(`/api/decks/${encodeURIComponent(deckId)}/queries`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ questions: letter.body, subject: letter.subject }),
  }).then((r) => json<RecordedQuery>(r));
}

export interface DeckScores {
  deck: DeckView;
  scores: (ScoredArea & { key: string })[];
  aiScoreWithheld?: boolean;
}

/** The deck's AI area scores — the flow view's weights, signals and "what the AI found". */
export function fetchDeckScores(deckId: string): Promise<DeckScores> {
  return fetch(`/api/decks/${encodeURIComponent(deckId)}`).then((r) => json(r));
}
