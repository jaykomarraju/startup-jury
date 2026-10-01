/**
 * **Intro call AI question prompts** — the last toggle of the admin console's
 * transparency card (`admin/s-fw.html`): *"AI generates tailored questions for
 * jury to use during startup calls"*, shipped ON.
 *
 * F0110: calls existed but carried no question set at all. The questions are
 * derived from the AI's own evaluation of that deck rather than from a second
 * model call — the weakest-scoring areas first, then the deck sections the
 * extraction found absent, then the intake details nobody supplied. That is
 * exactly what a juror should press on in an intro call, it costs nothing at
 * call time, and it cannot drift away from the scores the panel is looking at.
 *
 * With `intro_call_ai_prompts` off there are no prompts: the route says
 * `enabled: false` and returns an empty list.
 */
import { INTAKE_FIELD_LABELS, parseMissingFields } from "../../shared/intake";
import { isWeakSignal, WEAK_SIGNAL_MAX } from "../../shared/scoring";
import { scoped } from "../../shared/tenant";
import type { Env } from "../types";
import { scoringSettingsFor } from "./scoringSettings";
import { configScope, type ConfigScopeArg } from "./scope";

export interface CallPrompt {
  /** What the question is about — the area, section or detail. */
  topic: string;
  /** Why the AI raised it, so the juror knows what to listen for. */
  because: string;
  question: string;
}

export interface CallPromptResult {
  enabled: boolean;
  prompts: CallPrompt[];
}

/** How many to offer. A call agenda, not an interrogation. */
const MAX_PROMPTS = 6;

export async function introCallPrompts(
  env: Env,
  scope: ConfigScopeArg,
  deckId: string,
): Promise<CallPromptResult> {
  const resolved = configScope(scope);
  const settings = await scoringSettingsFor(env, resolved);
  if (!settings.introCallAiPrompts) return { enabled: false, prompts: [] };

  // The deck read was `WHERE id = ?` with no scope of ANY kind — not even
  // `edition` — so a juror holding a deck id read another workspace's deck name
  // and its missing-intake list straight out of this helper. `decks` carries
  // `tenant_id` (0084), so the predicate is the workspace, and the three reads
  // below inherit it: they are keyed off a `deck_id` this statement has now
  // established belongs to the caller.
  const dq = scoped(resolved).on("d").and("d.id = ?", deckId);
  const deck = await env.DB
    .prepare(`SELECT d.name, d.missing_fields FROM decks d ${dq.whereClause()}`)
    .bind(...dq.binds)
    .first<{ name: string | null; missing_fields: string | null }>();
  if (!deck) return { enabled: true, prompts: [] };

  const sq = scoped(resolved).on("p").and("s.deck_id = ?", deckId).andRaw(
    "s.evaluator_kind = 'ai' AND p.informational = 0",
  );
  const scored = (
    await env.DB.prepare(
      "SELECT p.name AS name, p.description AS description, s.value AS value, s.comment AS comment " +
        "FROM scores s JOIN parameters p ON p.id = s.parameter_id " +
        `${sq.whereClause()} ORDER BY s.value ASC, p.sort_order`,
    )
      .bind(...sq.binds)
      .all<{ name: string; description: string | null; value: number; comment: string | null }>()
  ).results;

  const missingSections = (
    await env.DB.prepare(
      "SELECT label FROM deck_extractions WHERE deck_id = ? AND missing = 1 ORDER BY sort_order",
    )
      .bind(deckId)
      .all<{ label: string }>()
  ).results.map((r) => r.label);

  const prompts: CallPrompt[] = [];

  for (const s of scored) {
    if (!isWeakSignal(s.value)) break; // sorted ascending — nothing weaker follows
    prompts.push({
      topic: s.name,
      because:
        s.comment?.trim() ||
        `The deck scored ${s.value.toFixed(1)} here, below the rubric's ${WEAK_SIGNAL_MAX}-point Moderate band.`,
      question: `${s.name} scored low. What evidence isn't in the deck that would change that read?`,
    });
  }

  for (const label of missingSections) {
    prompts.push({
      topic: label,
      because: "The deck has no slide covering this.",
      question: `The deck doesn't cover ${label.toLowerCase()}. Can you walk us through it?`,
    });
  }

  for (const field of parseMissingFields(deck.missing_fields)) {
    prompts.push({
      topic: INTAKE_FIELD_LABELS[field],
      because: "Missing from the submission.",
      question: `We still need the ${INTAKE_FIELD_LABELS[field].toLowerCase()} — can you confirm it on the call?`,
    });
  }

  return { enabled: true, prompts: prompts.slice(0, MAX_PROMPTS) };
}
