/**
 * "Areas requiring response" — what the founder is asked to fix (Aug-2026
 * issues 16 and 17) — and the clarification letter that asks for it.
 *
 * The Query screen shows the areas twice: as the "Parameters needing response"
 * column on the list, and as the drill-down a startup name opens. Both come
 * from real evaluation state, in the order the founder should act on it:
 *
 *   1. Required intake columns nobody supplied (founder, email, phone, city,
 *      sector) — the deck is Incomplete until they exist.
 *   2. Deck sections the extraction found absent (Traction, Team, Ask…).
 *   3. Core evaluation areas the AI scored below the workspace's "mediocre"
 *      threshold — weak signal the deck needs to answer.
 *
 * ── W2-C · the clarification question bank ────────────────────────────────
 * Until now the letter listed area LABELS and nothing more: the founder was
 * told *which* area was thin but never asked the BRD's actual question
 * (findings F0030, F0096). The admin console's Clarification question bank
 * (`admin/s-qb.html`) holds 68 curated questions keyed to `parameters.id` —
 * five per area, eight for Climate Impact & Integrity — and its sub-title
 * promises they are "auto-triggered to the startup when the AI detects weak,
 * missing, or contradictory signal in a given area".
 *
 * `selectClarificationQuestions` is that selection, and `buildQueryMessage`
 * composes them into the letter. Both are pure: the caller supplies the bank
 * (the server reads it from D1, `src/server/routes/questions.ts`), so this
 * module stays usable from the worker and the client alike. Passing no bank
 * reproduces the pre-W2-C letter exactly, which is what the Query screen still
 * does until `W7-C` adopts the bank (§9).
 */
import { INTAKE_FIELD_LABELS, type IntakeField } from "./intake";

export type AreaKind = "detail" | "section" | "parameter";

export interface ResponseArea {
  kind: AreaKind;
  label: string;
}

export interface AreaSource {
  missingFields?: IntakeField[];
  missingSections?: string[];
  weakAreas?: string[];
}

export const AREA_KIND_LABELS: Record<AreaKind, string> = {
  detail: "Missing detail",
  section: "Missing slide",
  parameter: "Weak signal",
};

export function areasNeedingResponse(deck: AreaSource): ResponseArea[] {
  const areas: ResponseArea[] = [];
  const seen = new Set<string>();
  const push = (kind: AreaKind, label: string) => {
    const key = `${kind}:${label.toLowerCase()}`;
    if (!label || seen.has(key)) return;
    seen.add(key);
    areas.push({ kind, label });
  };
  for (const f of deck.missingFields ?? []) push("detail", INTAKE_FIELD_LABELS[f]);
  for (const s of deck.missingSections ?? []) push("section", s);
  for (const p of deck.weakAreas ?? []) push("parameter", p);
  return areas;
}

// ═══════════════════════════════════════════════════════════════════════════
// The question bank
// ═══════════════════════════════════════════════════════════════════════════

/**
 * One evaluation area's slice of the bank, as the caller loaded it.
 *
 * `questions` is already filtered to `active = 1` and ordered by `seq` — the
 * store is the only thing that knows those columns, and keeping the ordering
 * in SQL is what makes "reorder writes `seq`" observable end to end. A bank
 * row that was soft-deleted must NOT appear here even though it is still
 * readable on a query already sent.
 */
export interface BankArea {
  /** `parameters.id` — edition-scoped, which is how the bank is keyed. */
  parameterId: string;
  /** The area's display name; matches the `weakAreas` labels on a deck. */
  name: string;
  /** Active question text, in `seq` order. */
  questions: string[];
}

/** An area and the questions the founder is being asked about it. */
export interface AreaQuestions {
  area: string;
  questions: string[];
}

/** Area names compare on case and surrounding space only — never on wording. */
function areaKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * The bank questions a clarification should carry.
 *
 * Only **weak-signal** areas draw from the bank: a missing intake detail or an
 * absent slide is a request for a fact, not a question about an area, and the
 * bank has nothing keyed to either. Areas keep the order
 * `areasNeedingResponse` put them in, and an area with no active questions
 * left is dropped rather than emitted empty.
 */
export function selectClarificationQuestions(
  areas: ResponseArea[],
  bank: BankArea[],
): AreaQuestions[] {
  const byName = new Map<string, BankArea>();
  for (const a of bank) byName.set(areaKey(a.name), a);

  const out: AreaQuestions[] = [];
  const seen = new Set<string>();
  for (const area of areas) {
    if (area.kind !== "parameter") continue;
    const key = areaKey(area.label);
    if (seen.has(key)) continue;
    const entry = byName.get(key);
    if (!entry || entry.questions.length === 0) continue;
    seen.add(key);
    out.push({ area: entry.name, questions: [...entry.questions] });
  }
  return out;
}

/**
 * Does the **automatic** clarification fire for this deck?
 *
 * `org_scoring_settings.auto_clarification` is the Scoring framework's
 * "Auto-trigger clarification questions — Send targeted questions to startup
 * when AI detects weak signal" toggle (`admin/s-fw.html`, ON by default;
 * `W2-A` owns its UI). It governs the *automatic* send only — an evaluator who
 * opens the Query screen and composes a letter by hand is not the AI detecting
 * anything, so the draft is still produced with the toggle off. With no area
 * flagged there is nothing to ask and nothing fires.
 */
export function shouldAutoClarify(opts: {
  autoClarification: boolean;
  areas: ResponseArea[];
}): boolean {
  return opts.autoClarification && opts.areas.length > 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// The letter
// ═══════════════════════════════════════════════════════════════════════════

export interface QueryMessageOptions {
  /**
   * The bank to draw from. Omitted (or empty) the letter is the pre-W2-C one:
   * a bullet list of area labels and nothing else.
   */
  bank?: BankArea[];
}

/** The default clarification message for a set of decks (issue 16/18). */
export function buildQueryMessage(
  deckName: string,
  areas: ResponseArea[],
  options: QueryMessageOptions = {},
): string {
  const asked = selectClarificationQuestions(areas, options.bank ?? []);
  const askedNames = new Set(asked.map((a) => areaKey(a.area)));

  // Areas the bank could not answer for still list as bullets — that is every
  // missing detail and slide, plus any weak area whose questions were all
  // deleted. An area the bank DID answer for gets its own block below instead
  // of being named twice.
  const bullets = areas
    .filter((a) => !(a.kind === "parameter" && askedNames.has(areaKey(a.label))))
    .map((a) => `• ${a.label} (${AREA_KIND_LABELS[a.kind].toLowerCase()})`);

  const blocks: string[] = [];
  for (const { area, questions } of asked) {
    blocks.push("", `${area} (${AREA_KIND_LABELS.parameter.toLowerCase()})`);
    questions.forEach((q, i) => blocks.push(`  ${i + 1}. ${q}`));
  }

  const nothingFlagged = bullets.length === 0 && blocks.length === 0;

  return [
    "Dear Founder,",
    "",
    `Thank you for submitting ${deckName}. As part of our evaluation, our review panel needs a few`,
    "clarifications on areas where the deck signalled incomplete or weak information:",
    "",
    ...(nothingFlagged
      ? ["• (no specific areas flagged — please review your submission)"]
      : bullets),
    ...blocks,
    "",
    "Please reply with an updated deck covering these areas, or respond to them directly in your",
    "founder portal.",
    "",
    "Warm regards,",
    "The Evaluation Team",
  ].join("\n");
}
