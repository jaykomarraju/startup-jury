/**
 * JURYbuddy content model + matcher (V3 item 15).
 *
 * The content is a VERBATIM port of `Help_JURYbuddy.HTM`, so these tests exist to
 * catch a port that drifts: a dropped entry, a clip id that no longer resolves,
 * a reorder that silently changes what "POPULAR RIGHT NOW" shows.
 */
import { describe, it, expect } from "vitest";
import {
  HELP_CLIPS,
  HELP_FAQS,
  HELP_POPULAR_COUNT,
  helpSections,
} from "../../src/client/routes/help/faqs";
import { closestMatch, scoreMatch, topMatches } from "../../src/client/routes/help/search";

describe("help content model", () => {
  it("carries the spec's 41 entries and 41 clips, paired both ways", () => {
    expect(HELP_FAQS).toHaveLength(41);
    expect(Object.keys(HELP_CLIPS)).toHaveLength(41);
    // Every answer's clip resolves…
    for (const faq of HELP_FAQS) {
      expect(HELP_CLIPS[faq.clipId], `clip for ${faq.id}`).toBeDefined();
    }
    // …and no clip is stranded with no answer pointing at it.
    const referenced = new Set(HELP_FAQS.map((f) => f.clipId));
    expect(Object.keys(HELP_CLIPS).filter((k) => !referenced.has(k))).toEqual([]);
  });

  it("has unique ids, and every id is servable as an R2 key", () => {
    expect(new Set(HELP_FAQS.map((f) => f.id)).size).toBe(HELP_FAQS.length);
    // `CLIP_ID` in src/server/routes/support.ts is the gate these must pass.
    for (const clipId of Object.keys(HELP_CLIPS)) {
      expect(clipId, clipId).toMatch(/^[a-z0-9_]{1,64}$/);
    }
  });

  it("carries no empty copy and no markup — answers render as TEXT", () => {
    for (const faq of HELP_FAQS) {
      expect(faq.question.trim(), faq.id).not.toBe("");
      expect(faq.answer.trim(), faq.id).not.toBe("");
      // The spec injected answers with innerHTML; this port renders them as
      // React children. A tag appearing here would show up literally, which is
      // the tell that the source changed shape.
      expect(faq.question + faq.answer, faq.id).not.toMatch(/<[a-zA-Z/!]/);
    }
  });

  it("groups into the spec's eight sections, in first-appearance order", () => {
    expect(helpSections()).toEqual([
      "What Is This Platform?",
      "Signing Up",
      "Choosing a Plan",
      "The Evaluation Workflow",
      "First Login & Navigation",
      "Team & Collaboration",
      "Billing & Credits",
      "Getting Unstuck",
    ]);
    // Every entry lands in one of them — the browse-all view shows nothing else.
    const known = new Set(helpSections());
    for (const faq of HELP_FAQS) expect(known.has(faq.section), faq.id).toBe(true);
  });

  it("pins what 'POPULAR RIGHT NOW' shows — array order is load-bearing", () => {
    expect(HELP_FAQS.slice(0, HELP_POPULAR_COUNT).map((f) => f.id)).toEqual([
      "what-does-it-do",
      "who-is-it-for",
      "evaluation-work-standard",
      "customize-core-13-pro",
    ]);
  });

  it("gives every clip a plausible duration", () => {
    for (const [id, clip] of Object.entries(HELP_CLIPS)) {
      expect(clip.title.trim(), id).not.toBe("");
      expect(clip.durationSec, id).toBeGreaterThan(0);
      expect(clip.durationSec, id).toBeLessThan(600);
    }
  });
});

describe("help search", () => {
  const faqs = HELP_FAQS;

  it("weights a question hit double an answer-only hit", () => {
    const faq = {
      id: "x",
      section: "s",
      question: "How do I upload a pitch deck?",
      answer: "From the Upload screen. Bulk works too.",
      clipId: "c",
    };
    // "upload" is in both, so the question branch wins: 2/2 = 1.
    expect(scoreMatch("upload", faq)).toBe(1);
    // "bulk" is answer-only: 1/2.
    expect(scoreMatch("bulk", faq)).toBe(0.5);
    // One of each over two words: (2 + 1) / 4.
    expect(scoreMatch("upload bulk", faq)).toBe(0.75);
  });

  it("scores nothing for an empty query or for words of 1-2 characters", () => {
    const faq = faqs[0];
    expect(scoreMatch("", faq)).toBe(0);
    expect(scoreMatch("   ", faq)).toBe(0);
    // A real limitation of the spec's matcher, reproduced on purpose: "AI" is
    // two characters, so it is dropped and the query matches nothing at all.
    expect(scoreMatch("ai", faq)).toBe(0);
    expect(topMatches("ai", faqs)).toEqual([]);
  });

  it("returns best-first matches, capped at the limit", () => {
    const hits = topMatches("upload a deck", faqs);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThanOrEqual(6);
    // Sorted descending, and nothing that scored zero got through.
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i].score).toBeLessThanOrEqual(hits[i - 1].score);
      expect(hits[i].score).toBeGreaterThan(0);
    }
    expect(topMatches("upload", faqs, 2)).toHaveLength(2);
  });

  it("answers real questions a user would type", () => {
    const cases: [string, string][] = [
      ["how do I raise a support ticket", "raise-ticket"],
      ["invite someone to my team", "invite-team-member"],
      ["free trial", "free-trial"],
      ["override an AI score", "override-ai-score"],
      ["where do I see my credits", "credits-left"],
    ];
    for (const [query, expected] of cases) {
      expect(topMatches(query, faqs)[0]?.faq.id, query).toBe(expected);
    }
  });

  /**
   * MEASURED, and a real weakness of the spec's algorithm rather than a bug in
   * the port. The score is `hits / (words * 2)`, so a two-word query has only
   * five possible values and ties are the norm: "13 core parameters" puts FOUR
   * entries at 1.000 and the one actually titled "the 13 core parameters" comes
   * THIRD, because a tie falls back to array position. §12 records the remedy
   * (tie-break on question length, or the embeddings swap the spec itself
   * recommends); it is not applied here because it would change what the
   * client's demo returns.
   */
  it("ties at the top score, and resolves them by array order, not relevance", () => {
    const hits = topMatches("13 core parameters", faqs);
    expect(hits.slice(0, 4).map((m) => m.score)).toEqual([1, 1, 1, 1]);
    expect(hits.map((m) => m.faq.id).slice(0, 4)).toEqual([
      "customize-core-13-pro",
      "additional-params-premium",
      "core-13-parameters",
      "additional-vs-core",
    ]);
    // "13" is two characters, so the digits contribute nothing to the ranking.
    expect(topMatches("13 core parameters", faqs).map((m) => m.faq.id)).toEqual(
      topMatches("core parameters", faqs).map((m) => m.faq.id),
    );
  });

  it("returns no matches for a query that overlaps nothing", () => {
    expect(topMatches("zzzqqq nothingmatches", faqs)).toEqual([]);
  });

  it("still offers a closest entry at score zero — the spec's consolation pick", () => {
    // Every entry ties at 0, so the sort is a no-op and the first entry wins.
    // The copy above it hedges ("Here's what might help instead"), and the
    // no-match footer is what actually carries the reader onward.
    expect(closestMatch("zzzqqq nothingmatches", faqs)?.id).toBe(HELP_FAQS[0].id);
    // With a partial overlap it picks the genuinely closest entry instead.
    expect(closestMatch("credits", faqs)?.id).toBe("credits-left");
    expect(closestMatch("anything", [])).toBeUndefined();
  });
});
