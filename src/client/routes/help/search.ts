/**
 * JURYbuddy search — a straight port of the spec's `scoreMatch` / `topMatches`
 * (`Help_JURYbuddy.HTM`), kept separate so it is testable without a DOM.
 *
 * Keyword overlap, weighted so a hit in the QUESTION counts double a hit buried
 * in the answer body, then normalised to 0…1 by the best possible score. Words
 * of 1–2 characters are dropped, which is why "AI" and "DD" match nothing —
 * a real limitation of the spec's algorithm, reproduced rather than silently
 * improved so the built screen behaves as the client's demo does.
 *
 * The spec's own comment says to swap this for embeddings "before scaling past a
 * few dozen FAQs". At 41 entries it is at that edge; see §12 for the note.
 */
import type { HelpFaq } from "./faqs";

export interface HelpMatch {
  faq: HelpFaq;
  score: number;
}

/** 0 when nothing overlaps, up to 1 when every query word hits a question. */
export function scoreMatch(query: string, faq: HelpFaq): number {
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  const words = q.split(/\s+/).filter((w) => w.length > 2);
  if (words.length === 0) return 0;
  const question = faq.question.toLowerCase();
  const answer = faq.answer.toLowerCase();
  let score = 0;
  for (const w of words) {
    if (question.includes(w)) score += 2;
    else if (answer.includes(w)) score += 1;
  }
  return score / (words.length * 2);
}

/** Scoring matches only, best first. Empty when the query hits nothing. */
export function topMatches(query: string, faqs: readonly HelpFaq[], limit = 6): HelpMatch[] {
  return faqs
    .map((faq) => ({ faq, score: scoreMatch(query, faq) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * The spec's no-match consolation pick: the highest-scoring entry EVEN WHEN ITS
 * SCORE IS ZERO. With a zero-score query every entry ties, so the sort is a
 * no-op and this returns the first entry in array order — which is what the
 * demo does. Kept deliberately: the copy above it reads "Here's what might help
 * instead", not "this is your answer".
 */
export function closestMatch(query: string, faqs: readonly HelpFaq[]): HelpFaq | undefined {
  if (faqs.length === 0) return undefined;
  return faqs
    .map((faq) => ({ faq, score: scoreMatch(query, faq) }))
    .sort((a, b) => b.score - a.score)[0].faq;
}
