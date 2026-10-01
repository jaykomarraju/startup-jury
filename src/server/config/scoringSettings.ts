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
import { DEFAULT_SCORING_SETTINGS, type ScoringSettings } from "../../shared/scoring";
import {
  COMPOSITE_FORMULAS,
  SCORE_SCALES,
  type CompositeFormula,
  type OrgScoringSettingsRow,
  type ScoreScale,
} from "../../shared/types";
import { scoped, type TenantScope } from "../../shared/tenant";
import type { Env } from "../types";


const COLUMNS =
  "edition, ai_pre_scoring_enabled, auto_clarification, show_ai_score_to_jury, " +
  "require_override_rationale, override_rationale_delta, jury_sees_peer_scores, " +
  // 0082 — `ai_gate_threshold` sits beside `shortlist_threshold` deliberately:
  // they are the two org-wide score POSITIONS, and the console's Scoring
  // framework section owns both. They gate different things, at different
  // moments, on different numbers — see 0082's header.
  "score_scale, composite_formula, ai_weight_pct, shortlist_threshold, ai_gate_threshold, " +
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
    aiGateThreshold: num(row.ai_gate_threshold, d.aiGateThreshold),
    showThreeScoreView: bool(row.show_three_score_view, d.showThreeScoreView),
    showScoreDrift: bool(row.show_score_drift, d.showScoreDrift),
    includeAiEvidence: bool(row.include_ai_evidence, d.includeAiEvidence),
    introCallAiPrompts: bool(row.intro_call_ai_prompts, d.introCallAiPrompts),
  };
}

/**
 * Read one WORKSPACE's scoring framework. Never throws; never returns null.
 *
 * `org_scoring_settings` was rebuilt by `0090` with `PRIMARY KEY (tenant_id,
 * edition)`, so a second customer has a row of its own and an `edition`-only
 * predicate returns the FIRST customer's framework — the AI pre-scoring switch,
 * the jury-visibility toggles and the shortlist floor, all read from somebody
 * else's workspace. The `COLUMNS` list keeps selecting `edition` because the
 * caller's row type carries it; the SCOPE is the pair.
 *
 * `scope` may still be a bare `Edition` from the sixteen foreign call sites
 * `config/scope.ts` enumerates. That resolves to the default tenant, which is
 * today's behaviour and is wrong for a second customer — see the ratchet there.
 */
export async function loadScoringSettings(
  db: D1Database,
  scope: TenantScope,
): Promise<ScoringSettings> {
  const q = scoped(scope).on("s");
  const row = await db
    .prepare(`SELECT ${COLUMNS} FROM org_scoring_settings s ${q.whereClause()}`)
    .bind(...q.binds)
    .first<OrgScoringSettingsRow>();
  return toScoringSettings(row);
}

/** Convenience for the server paths that hold an `Env` rather than a `D1Database`. */
export function scoringSettingsFor(env: Env, scope: TenantScope): Promise<ScoringSettings> {
  return loadScoringSettings(env.DB, scope);
}
