/**
 * "Areas requiring response" — what the founder is asked to fix (Aug-2026
 * issues 16 and 17).
 *
 * The Query screen shows this twice: as the "Parameters needing response"
 * column on the list, and as the drill-down a startup name opens. Both come
 * from real evaluation state, in the order the founder should act on it:
 *
 *   1. Required intake columns nobody supplied (founder, email, phone, city,
 *      sector) — the deck is Incomplete until they exist.
 *   2. Deck sections the extraction found absent (Traction, Team, Ask…).
 *   3. Core evaluation areas the AI scored below the workspace's "mediocre"
 *      threshold — weak signal the deck needs to answer.
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

/** The default clarification message for a set of decks (issue 16/18). */
export function buildQueryMessage(deckName: string, areas: ResponseArea[]): string {
  const lines = areas.map((a) => `• ${a.label} (${AREA_KIND_LABELS[a.kind].toLowerCase()})`);
  return [
    "Dear Founder,",
    "",
    `Thank you for submitting ${deckName}. As part of our evaluation, our review panel needs a few`,
    "clarifications on areas where the deck signalled incomplete or weak information:",
    "",
    ...(lines.length > 0 ? lines : ["• (no specific areas flagged — please review your submission)"]),
    "",
    "Please reply with an updated deck covering these areas, or respond to them directly in your",
    "founder portal.",
    "",
    "Warm regards,",
    "The Evaluation Team",
  ].join("\n");
}
