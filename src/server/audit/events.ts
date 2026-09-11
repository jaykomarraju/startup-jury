/**
 * W3-C — the per-domain audit writers.
 *
 * `log.ts` is the store; this is the vocabulary. Every function here takes the
 * before and after a route already has in hand and writes the prototype's own
 * sentence, so a writer site in a file this session does not own stays a single
 * line:
 *
 *     await auditThresholds(c, before, after);
 *
 * The sentences are transcribed from `admin/s-al.html`'s ten seeded rows and
 * from the ten `0030` seeded in their image — "Shortlist threshold changed from
 * 6.5 to 7.0", "Area weight updated: Team & execution 10% → 12%, Business model
 * 12% → 10%", "Invited Nisha Kapoor (nisha@incubator.in) as Program associate ·
 * Standard plan". Where the prototype has no sentence for an event, the nearest
 * one in the same voice is used.
 *
 * **Categories.** The prototype draws four badges and `0030` widened them to
 * six. This module's split:
 *
 *   `config`   — anything that changes how decks are evaluated or how the
 *                workspace is set up, including CRM (the prototype's own first
 *                row, "Updated Salesforce filter rule…", is a Config row).
 *   `score`    — a human score that diverged from the AI's (`log.ts`).
 *   `team`     — the roster: invites, role changes, activation, titles.
 *   `billing`  — credit movements (`log.ts`, beside the ledger row).
 *   `security` — who may do what: the task-permission grid, and changes to the
 *                trail itself. A permission change is an authorisation event,
 *                not a roster event; filing it under `team` would bury the one
 *                class of change an auditor most needs to find.
 *   `pipeline` — deck stage transitions, read through from `pipeline_events`.
 */
import type { Context } from "hono";
import type { AppEnv } from "../types";
import type { Edition } from "../../shared/roles";
import { roleLabel } from "../../shared/roles";
import type { ScoringSettings } from "../../shared/scoring";
import { recordAudit, changedFragment, pct, type AuditEntry } from "./log";

/** The edition's evaluator role, for the sentences that name one (F0181). */
function evaluatorLabel(edition: Edition): string {
  return edition === "vc" ? roleLabel("vc", "ic_member") : roleLabel("incubator", "jury");
}

// ── Area weights ─────────────────────────────────────────────────────────────

export interface WeightBefore {
  id: string;
  name: string;
  weight: number;
}
export interface WeightUpdate {
  id: string;
  weight?: number;
  name?: string;
}

/**
 * "Area weight updated: Team & execution 10% → 12%, Business model 12% → 10%"
 * — one row for the whole submission, exactly as the prototype renders it. A
 * rename is reported in the same row, since the two arrive together.
 */
export async function auditWeightChange(
  c: Context<AppEnv>,
  before: WeightBefore[],
  updates: WeightUpdate[],
): Promise<void> {
  const byId = new Map(before.map((p) => [p.id, p]));
  const weights: string[] = [];
  const renames: string[] = [];
  for (const u of updates) {
    const p = byId.get(u.id);
    if (!p) continue;
    const weight = Number(u.weight);
    if (Number.isFinite(weight)) {
      const moved = changedFragment(p.name, p.weight, weight, pct);
      if (moved) weights.push(moved);
    }
    const name = typeof u.name === "string" ? u.name.trim() : "";
    if (name && name !== p.name) renames.push(`${p.name} renamed to ${name}`);
  }
  const parts: string[] = [];
  if (weights.length > 0) parts.push(`Area weight updated: ${weights.join(", ")}`);
  if (renames.length > 0) parts.push(`Area renamed: ${renames.join(", ")}`);
  if (parts.length === 0) return;

  await recordAudit(c, {
    category: "config",
    action: "area_weights_updated",
    summary: parts.join(". "),
    detail: { weights, renames },
    targetType: "parameter",
  });
}

// ── Scoring framework ────────────────────────────────────────────────────────

const SCALE_LABELS: Record<string, string> = { "0-10": "0–10", "1-5": "1–5", "1-100": "1–100" };
const FORMULA_LABELS: Record<string, string> = {
  weighted: "weighted average",
  average: "simple average",
  median: "median",
};

/**
 * One row per setting that actually moved. `s-al.html` gives two of these
 * verbatim — the shortlist threshold and the blind-evaluation toggle — and the
 * rest follow their shape.
 */
export async function auditScoringFramework(
  c: Context<AppEnv>,
  before: ScoringSettings,
  after: ScoringSettings,
): Promise<void> {
  const evaluators = evaluatorLabel(c.var.user.edition as Edition).toLowerCase();
  const entries: AuditEntry[] = [];
  const add = (action: string, summary: string | null, detail?: unknown) => {
    if (summary) entries.push({ category: "config", action, summary, detail, targetType: "org_scoring_settings" });
  };

  add(
    "threshold_changed",
    before.shortlistThreshold === after.shortlistThreshold
      ? null
      : `Shortlist threshold changed from ${before.shortlistThreshold} to ${after.shortlistThreshold}`,
    { from: before.shortlistThreshold, to: after.shortlistThreshold },
  );
  add(
    "blind_scoring_toggled",
    before.showAiScoreToJury === after.showAiScoreToJury
      ? null
      : `AI score visibility toggled ${after.showAiScoreToJury ? "ON" : "OFF"} for ${evaluators}` +
          (after.showAiScoreToJury ? "" : " — blind evaluation mode enabled"),
    { from: before.showAiScoreToJury, to: after.showAiScoreToJury },
  );
  add(
    "score_scale_changed",
    changedFragment(
      "Score scale changed:",
      before.scoreScale,
      after.scoreScale,
      (v) => SCALE_LABELS[v] ?? v,
    ),
  );
  add(
    "composite_formula_changed",
    changedFragment(
      "Composite formula changed:",
      before.compositeFormula,
      after.compositeFormula,
      (v) => FORMULA_LABELS[v] ?? v,
    ),
  );
  add(
    "ai_weight_changed",
    before.aiWeightPct === after.aiWeightPct
      ? null
      : `AI / human weighting changed from ${before.aiWeightPct}/${100 - before.aiWeightPct} to ${after.aiWeightPct}/${100 - after.aiWeightPct}`,
  );
  add(
    "override_delta_changed",
    changedFragment(
      "Override rationale threshold:",
      before.overrideRationaleDelta,
      after.overrideRationaleDelta,
      (v) => `${v} points`,
    ),
  );

  const toggles: [keyof ScoringSettings, string, string][] = [
    ["aiPreScoringEnabled", "ai_pre_scoring_toggled", "AI pre-scoring"],
    ["autoClarification", "auto_clarification_toggled", "Automatic clarification questions"],
    ["requireOverrideRationale", "override_rationale_toggled", "Mandatory override rationale"],
    ["jurySeesPeerScores", "peer_scores_toggled", `Peer score visibility for ${evaluators}`],
    ["showThreeScoreView", "three_score_view_toggled", "Three-score view"],
    ["showScoreDrift", "score_drift_toggled", "Score drift analysis"],
    ["includeAiEvidence", "ai_evidence_toggled", "AI evidence in reports"],
    ["introCallAiPrompts", "intro_call_prompts_toggled", "Intro-call AI question prompts"],
  ];
  for (const [key, action, label] of toggles) {
    const from = before[key] as boolean;
    const to = after[key] as boolean;
    if (from === to) continue;
    add(action, `${label} turned ${to ? "on" : "off"}`, { from, to });
  }

  await recordAudit(c, ...entries);
}

// ── Cohort rating thresholds ─────────────────────────────────────────────────

export async function auditThresholds(
  c: Context<AppEnv>,
  before: { best: number; mediocre: number },
  after: { best: number; mediocre: number },
): Promise<void> {
  const parts = [
    changedFragment("Best ≥", before.best, after.best),
    changedFragment("Mediocre ≥", before.mediocre, after.mediocre),
  ].filter(Boolean);
  if (parts.length === 0) return;
  await recordAudit(c, {
    category: "config",
    action: "cohort_thresholds_changed",
    summary: `Cohort rating thresholds changed: ${parts.join(", ")}`,
    detail: { before, after },
    targetType: "org_settings",
    targetId: c.var.user.edition,
  });
}

// ── The small config writes ──────────────────────────────────────────────────

/** One place for the config events whose sentence needs no diff machinery. */
export function auditConfig(
  c: Context<AppEnv>,
  action: string,
  summary: string,
  extra: Partial<AuditEntry> = {},
): Promise<void> {
  return recordAudit(c, { category: "config", action, summary, ...extra });
}

// ── Team ─────────────────────────────────────────────────────────────────────

const PLAN_LABELS: Record<string, string> = {
  standard: "Standard plan",
  pro: "Pro plan",
  premium: "Premium plan",
};

/**
 * "Invited Nisha Kapoor (nisha@incubator.in) as Program associate · Standard
 * plan" — the prototype's Team row, plan and all. The plan is read here rather
 * than passed in, so the call site stays one line.
 */
export async function auditUserInvited(
  c: Context<AppEnv>,
  user: { id: string; name: string; email: string; roleLabel: string },
): Promise<void> {
  const row = await c.env.DB.prepare("SELECT plan FROM org_settings WHERE edition = ?")
    .bind(c.var.user.edition)
    .first<{ plan: string }>();
  const plan = PLAN_LABELS[row?.plan ?? ""] ?? "Standard plan";
  await recordAudit(c, {
    category: "team",
    action: "user_invited",
    summary: `Invited ${user.name} (${user.email}) as ${user.roleLabel} · ${plan}`,
    detail: { userId: user.id, role: user.roleLabel },
    targetType: "user",
    targetId: user.id,
  });
}

export interface UserSnapshot {
  name: string;
  role: string;
  active: number;
  title: string | null;
}

/**
 * One row per thing that changed on a roster row — activation, role, name and
 * alias title are four different administrative acts and read as four
 * sentences, not one.
 */
export async function auditUserUpdated(
  c: Context<AppEnv>,
  userId: string,
  before: UserSnapshot,
  after: UserSnapshot,
): Promise<void> {
  const edition = c.var.user.edition as Edition;
  const label = (role: string) => roleLabel(edition, role as never) ?? role;
  const entries: AuditEntry[] = [];
  const push = (action: string, summary: string, detail?: unknown) =>
    entries.push({ category: "team", action, summary, detail, targetType: "user", targetId: userId });

  if (before.active !== after.active) {
    push(
      after.active === 1 ? "user_activated" : "user_deactivated",
      `${after.active === 1 ? "Activated" : "Deactivated"} ${after.name}`,
      { active: after.active === 1 },
    );
  }
  if (before.role !== after.role) {
    push("user_role_changed", `Changed ${after.name}'s role from ${label(before.role)} to ${label(after.role)}`, {
      from: before.role,
      to: after.role,
    });
  }
  if (before.name !== after.name) {
    push("user_renamed", `Renamed ${before.name} to ${after.name}`, { from: before.name, to: after.name });
  }
  if ((before.title ?? null) !== (after.title ?? null)) {
    push(
      "user_title_changed",
      after.title
        ? `Set ${after.name}'s alias title to "${after.title}"`
        : `Cleared ${after.name}'s alias title`,
      { from: before.title, to: after.title },
    );
  }
  await recordAudit(c, ...entries);
}

// ── Task permissions (security) ──────────────────────────────────────────────

export interface PermissionCell {
  role: string;
  taskId: string;
  granted: boolean;
}

/**
 * "Task permission changed: Program manager · Shortlist — allowed → denied".
 *
 * `security`, not `team` — see the module header. One row per cell, because one
 * cell is one authorisation decision and an auditor filters to the role or the
 * task, not to the click that changed several at once.
 */
export async function auditPermissionCells(
  c: Context<AppEnv>,
  cells: PermissionCell[],
  taskLabels: Map<string, string>,
): Promise<void> {
  const edition = c.var.user.edition as Edition;
  await recordAudit(
    c,
    ...cells.map((cell) => ({
      category: "security" as const,
      action: "permission_changed",
      summary:
        `Task permission changed: ${roleLabel(edition, cell.role as never) ?? cell.role} · ` +
        `${taskLabels.get(cell.taskId) ?? cell.taskId} — ${cell.granted ? "denied → allowed" : "allowed → denied"}`,
      detail: { role: cell.role, taskId: cell.taskId, granted: cell.granted },
      targetType: "permission",
      targetId: `${cell.role}:${cell.taskId}`,
    })),
  );
}
