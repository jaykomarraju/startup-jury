/**
 * The org's **scoring framework** (`org_scoring_settings`, migration 0026) —
 * one read used by every path the admin console's `s-fw` toggles govern.
 *
 * W2-A owns this. It is a plain module rather than part of `routes/config.ts`
 * because the evaluation path, the deck reads and the jury submit all need the
 * settings and none of them should import a route file.
 *
 * A missing row falls back to `DEFAULT_SCORING_SETTINGS`, which is exactly the
 * migration's column defaults, so an edition that somehow has no row behaves
 * like the prototype rather than throwing halfway through an evaluation.
 */
import type { Edition } from "../../shared/roles";
import { DEFAULT_SCORING_SETTINGS, type ScoringSettings } from "../../shared/scoring";
import {
  COMPOSITE_FORMULAS,
  SCORE_SCALES,
  type CompositeFormula,
  type OrgScoringSettingsRow,
  type ScoreScale,
} from "../../shared/types";
import type { Env } from "../types";

const COLUMNS =
  "edition, ai_pre_scoring_enabled, auto_clarification, show_ai_score_to_jury, " +
  "require_override_rationale, override_rationale_delta, jury_sees_peer_scores, " +
  "score_scale, composite_formula, ai_weight_pct, shortlist_threshold, " +
  "show_three_score_view, show_score_drift, include_ai_evidence, intro_call_ai_prompts, " +
  "updated_at, updated_by";

function bool(v: number | null | undefined, fallback: boolean): boolean {
  return v === null || v === undefined ? fallback : v === 1;
}

function num(v: number | null | undefined, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function scale(v: string | null | undefined): ScoreScale {
  return (SCORE_SCALES as readonly string[]).includes(v ?? "")
    ? (v as ScoreScale)
    : DEFAULT_SCORING_SETTINGS.scoreScale;
}

function formula(v: string | null | undefined): CompositeFormula {
  return (COMPOSITE_FORMULAS as readonly string[]).includes(v ?? "")
    ? (v as CompositeFormula)
    : DEFAULT_SCORING_SETTINGS.compositeFormula;
}

/** Row → the camel-cased view the API and the client share. */
export function toScoringSettings(row: Partial<OrgScoringSettingsRow> | null): ScoringSettings {
  if (!row) return { ...DEFAULT_SCORING_SETTINGS };
  const d = DEFAULT_SCORING_SETTINGS;
  return {
    aiPreScoringEnabled: bool(row.ai_pre_scoring_enabled, d.aiPreScoringEnabled),
    autoClarification: bool(row.auto_clarification, d.autoClarification),
    showAiScoreToJury: bool(row.show_ai_score_to_jury, d.showAiScoreToJury),
    requireOverrideRationale: bool(row.require_override_rationale, d.requireOverrideRationale),
    overrideRationaleDelta: num(row.override_rationale_delta, d.overrideRationaleDelta),
    jurySeesPeerScores: bool(row.jury_sees_peer_scores, d.jurySeesPeerScores),
    scoreScale: scale(row.score_scale),
    compositeFormula: formula(row.composite_formula),
    aiWeightPct: num(row.ai_weight_pct, d.aiWeightPct),
    shortlistThreshold: num(row.shortlist_threshold, d.shortlistThreshold),
    showThreeScoreView: bool(row.show_three_score_view, d.showThreeScoreView),
    showScoreDrift: bool(row.show_score_drift, d.showScoreDrift),
    includeAiEvidence: bool(row.include_ai_evidence, d.includeAiEvidence),
    introCallAiPrompts: bool(row.intro_call_ai_prompts, d.introCallAiPrompts),
  };
}

/** Read one edition's scoring framework. Never throws; never returns null. */
export async function loadScoringSettings(
  db: D1Database,
  edition: Edition,
): Promise<ScoringSettings> {
  const row = await db
    .prepare(`SELECT ${COLUMNS} FROM org_scoring_settings WHERE edition = ?`)
    .bind(edition)
    .first<OrgScoringSettingsRow>();
  return toScoringSettings(row);
}

/** Convenience for the server paths that hold an `Env` rather than a `D1Database`. */
export function scoringSettingsFor(env: Env, edition: Edition): Promise<ScoringSettings> {
  return loadScoringSettings(env.DB, edition);
}
