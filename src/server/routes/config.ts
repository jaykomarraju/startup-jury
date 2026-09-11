// Phase 6 — Config, plans & credits. Admin-gated editors for the rubric (core
// parameter weights + additional/informational params), cohort thresholds, the
// AI system prompt, branding, plan tier, and admin-granted credits. A weight
// change re-scores the edition (see config/rescore.ts). A safe read subset is
// exposed to every authed user (dashboard thresholds rail + My Parameters view);
// the full settings (AI prompt, credits balance) are admin-only.

import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../types";
import type { Edition, Role } from "../../shared/roles";
import {
  ADDITIONAL_PARAM_OWNERS,
  MAX_ADDITIONAL_PER_ROLE,
  isAdditionalParamOwner,
} from "../../shared/roles";
import { planAllowsAdditional, planAllowsCore, isPlan, type Plan } from "../../shared/plans";
import {
  REQUIRED_WEIGHT_TOTAL,
  weightTotal,
  weightTotalMessage,
  type ScoringSettings,
} from "../../shared/scoring";
import { AI_WEIGHT_CHOICES, COMPOSITE_FORMULAS, SCORE_SCALES } from "../../shared/types";
import { requireAuth, requireRole, requireTask } from "../auth/middleware";
import { rescoreEdition } from "../config/rescore";
import { loadScoringSettings } from "../config/scoringSettings";

const config = new Hono<AppEnv>();
config.use("*", requireAuth);

interface SettingsRow {
  plan: Plan;
  credits_balance: number;
  branding_json: string;
  ai_system_prompt: string | null;
  threshold_best: number;
  threshold_mediocre: number;
}

interface ParamRow {
  id: string;
  key: string;
  name: string;
  weight: number;
  informational: number;
  role_scope: string | null;
  prompt: string | null;
  /** Shown to the scorer beside the parameter (specs §6.2, migration 0025). */
  description: string | null;
  /** Admin console → Area weights → "Permit configuration" (migration 0025). */
  config_permitted: number;
  sort_order: number;
}

async function readBody<T>(c: Context<AppEnv>): Promise<Partial<T>> {
  return (await c.req.json().catch(() => ({}))) as Partial<T>;
}

/**
 * Bump the edition's criteria version. Any change to what the AI scores against —
 * core weights, the AI prompt, or the additional-parameter set — invalidates the
 * previous AI run, so a re-score becomes allowed (see routes/decks.ts /rescore).
 */
function bumpCriteriaVersion(c: Context<AppEnv>, edition: Edition): D1PreparedStatement {
  return c.env.DB.prepare(
    "UPDATE org_settings SET criteria_version = criteria_version + 1 WHERE edition = ?",
  ).bind(edition);
}

function loadSettings(c: Context<AppEnv>, edition: Edition): Promise<SettingsRow | null> {
  return c.env.DB.prepare(
    "SELECT plan, credits_balance, branding_json, ai_system_prompt, threshold_best, threshold_mediocre FROM org_settings WHERE edition = ?",
  )
    .bind(edition)
    .first<SettingsRow>();
}

async function loadParams(c: Context<AppEnv>, edition: Edition): Promise<ParamRow[]> {
  return (
    await c.env.DB.prepare(
      "SELECT id, key, name, weight, informational, role_scope, prompt, description, config_permitted, sort_order " +
        "FROM parameters WHERE edition = ? AND active = 1 ORDER BY sort_order",
    )
      .bind(edition)
      .all<ParamRow>()
  ).results;
}

function toParamView(p: ParamRow) {
  return {
    id: p.id,
    key: p.key,
    name: p.name,
    weight: p.weight,
    informational: p.informational === 1,
    roleScope: p.role_scope ?? undefined,
    prompt: p.prompt ?? undefined,
    description: p.description ?? undefined,
    // Area weights → "Permit configuration": the owning role may edit this one
    // parameter even though config is otherwise admin-only.
    configPermitted: p.config_permitted === 1,
  };
}

function parseBranding(json: string): Record<string, unknown> {
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// ── Reads ──────────────────────────────────────────────────────────────────

/** GET /api/config/summary — the safe read subset (any authed user):
 *  thresholds + plan + branding + the rubric parameters (drives the dashboard
 *  thresholds rail and the read-only My Parameters view). No secrets. */
config.get("/summary", async (c) => {
  const edition = c.var.user.edition;
  const s = await loadSettings(c, edition);
  if (!s) return c.json({ error: "not_found" }, 404);
  const params = await loadParams(c, edition);
  return c.json({
    plan: s.plan,
    coreConfigEnabled: planAllowsCore(s.plan),
    additionalEnabled: planAllowsAdditional(s.plan),
    thresholdBest: s.threshold_best,
    thresholdMediocre: s.threshold_mediocre,
    branding: parseBranding(s.branding_json),
    // Aug-2026 issue 11 — the Upload screen shows the credit balance on top for
    // everyone who can upload, not just admins (who also get it from GET /config
    // along with the AI prompt). Founders never see the org's balance.
    ...(c.var.user.role === "founder" ? {} : { creditsBalance: s.credits_balance }),
    coreParams: params.filter((p) => p.informational === 0).map(toParamView),
    additionalParams: params.filter((p) => p.informational === 1).map(toParamView),
  });
});

/** GET /api/config — the full settings (admin only): adds the AI system prompt
 *  and the credits balance to the summary payload. */
config.get("/", requireTask("adminconsole", "admin"), async (c) => {
  const edition = c.var.user.edition;
  const s = await loadSettings(c, edition);
  if (!s) return c.json({ error: "not_found" }, 404);
  const params = await loadParams(c, edition);
  return c.json({
    plan: s.plan,
    coreConfigEnabled: planAllowsCore(s.plan),
    additionalEnabled: planAllowsAdditional(s.plan),
    creditsBalance: s.credits_balance,
    aiSystemPrompt: s.ai_system_prompt ?? "",
    thresholdBest: s.threshold_best,
    thresholdMediocre: s.threshold_mediocre,
    branding: parseBranding(s.branding_json),
    coreParams: params.filter((p) => p.informational === 0).map(toParamView),
    additionalParams: params.filter((p) => p.informational === 1).map(toParamView),
  });
});

// ── Rubric: core weights (re-scores) ─────────────────────────────────────────

interface WeightUpdate {
  id: string;
  weight: number;
  name?: string;
}

/** PUT /api/config/parameters — update core parameter weights (and optional
 *  renames), then re-score the whole edition. */
config.put("/parameters", requireRole("admin"), async (c) => {
  const edition = c.var.user.edition;
  const settings = await loadSettings(c, edition);
  if (!settings) return c.json({ error: "not_found" }, 404);
  // Configuring the core 13 weights requires Pro or above (Standard = no config).
  if (!planAllowsCore(settings.plan)) return c.json({ error: "plan_required" }, 402);

  const body = await readBody<{ params: WeightUpdate[] }>(c);
  const updates = Array.isArray(body.params) ? body.params : [];
  if (updates.length === 0) return c.json({ error: "no_params" }, 400);

  const existing = await loadParams(c, edition);
  const byId = new Map(existing.map((p) => [p.id, p]));

  const stmts: D1PreparedStatement[] = [];
  const nextWeights = new Map(
    existing.filter((p) => p.informational === 0).map((p) => [p.id, p.weight]),
  );
  for (const u of updates) {
    const p = byId.get(u.id);
    // Only weighted (core) params are edited here; informational ones are
    // managed via the additional-params endpoints.
    if (!p || p.informational === 1) return c.json({ error: "invalid_param" }, 400);
    const weight = Number(u.weight);
    if (!Number.isFinite(weight) || weight < 0 || weight > 100) {
      return c.json({ error: "invalid_weight" }, 400);
    }
    nextWeights.set(u.id, weight);
    const name = typeof u.name === "string" && u.name.trim() ? u.name.trim() : p.name;
    stmts.push(
      c.env.DB.prepare("UPDATE parameters SET weight = ?, name = ? WHERE id = ?").bind(weight, name, u.id),
    );
  }

  // F0153 — the prototype's Area weights footer says "Total must equal 100%",
  // and until now nothing enforced it at either layer: an admin could persist
  // 87 % or 140 % and every composite silently renormalised over whatever
  // denominator resulted. The check runs over the RESULTING full core set, not
  // just the submitted subset, so a partial update cannot sneak past it.
  const total = weightTotal([...nextWeights.values()]);
  if (Math.abs(total - REQUIRED_WEIGHT_TOTAL) > 1e-9) {
    return c.json(
      { error: "invalid_total", total, message: weightTotalMessage(total).text },
      400,
    );
  }

  stmts.push(bumpCriteriaVersion(c, edition));
  await c.env.DB.batch(stmts);

  const rescored = await rescoreEdition(c.env, edition);
  const params = await loadParams(c, edition);
  return c.json({
    ok: true,
    rescored,
    coreParams: params.filter((p) => p.informational === 0).map(toParamView),
  });
});

// ── Additional / role-scoped parameters (Premium-gated) ──────────────────────
//
// Additional params are always informational (weight 0 → never in the core-13
// composite, which stays = 100%). Each is owned by one role (up to 3 per role)
// and carries a configurable AI prompt. Editing any of them (add/rename/prompt/
// delete) bumps criteria_version so the AI rescore guard treats it as a change.

/** Guard: additional-param configuration requires a Premium plan. */
async function requirePremium(c: Context<AppEnv>, edition: Edition): Promise<SettingsRow | null> {
  const s = await loadSettings(c, edition);
  if (!s) return null;
  return planAllowsAdditional(s.plan) ? s : null;
}

/** Validate a submitted owner role for the edition. */
function validOwner(edition: Edition, role: unknown): Role | null {
  return typeof role === "string" && (ADDITIONAL_PARAM_OWNERS[edition] as readonly string[]).includes(role)
    ? (role as Role)
    : null;
}

/** POST /api/config/additional-params — add a role-scoped additional param
 *  (Premium only). Body: { name, roleScope, prompt? }. Enforces ≤3 per role. */
config.post("/additional-params", requireTask("configparams", "admin"), async (c) => {
  const edition = c.var.user.edition;
  const s = await loadSettings(c, edition);
  if (!s) return c.json({ error: "not_found" }, 404);
  if (!planAllowsAdditional(s.plan)) return c.json({ error: "plan_required" }, 402);

  const body = await readBody<{ name: string; roleScope: string; prompt?: string }>(c);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return c.json({ error: "name_required" }, 400);
  const roleScope = validOwner(edition, body.roleScope);
  if (!roleScope) return c.json({ error: "invalid_role" }, 400);
  const prompt = typeof body.prompt === "string" && body.prompt.trim() ? body.prompt.trim() : null;

  // Up to 3 additional params per owning role.
  const count = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM parameters WHERE edition = ? AND active = 1 AND informational = 1 AND role_scope = ?",
  )
    .bind(edition, roleScope)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_ADDITIONAL_PER_ROLE) return c.json({ error: "role_full" }, 409);

  const suffix = crypto.randomUUID().slice(0, 8);
  const id = `${edition}_add_${suffix}`;
  const key = `add_${suffix}`;
  const nextOrder = await c.env.DB.prepare(
    "SELECT COALESCE(MAX(sort_order), 100) + 1 AS n FROM parameters WHERE edition = ?",
  )
    .bind(edition)
    .first<{ n: number }>();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO parameters (id, edition, key, name, weight, informational, role_scope, prompt, sort_order, active) VALUES (?, ?, ?, ?, 0, 1, ?, ?, ?, 1)",
    ).bind(id, edition, key, name, roleScope, prompt, nextOrder?.n ?? 101),
    // Adding a parameter changes the scoring criteria set → allow a re-score.
    bumpCriteriaVersion(c, edition),
  ]);

  return c.json({
    ok: true,
    param: { id, key, name, weight: 0, informational: true, roleScope, prompt: prompt ?? undefined },
  });
});

/**
 * Admin / superuser — the roles that may configure anything.
 *
 * W3-A: this is no longer the whole answer. It is the floor that survives even
 * an empty permissions table; the *editor set* is now the `configparams` cell
 * (see the route below).
 */
function isConfigAdmin(role: Role): boolean {
  return role === "admin" || role === "superuser";
}

/**
 * PUT /api/config/additional-params/:id — rename an additional param and/or
 * edit its configurable AI prompt (Premium only). Bumps criteria_version so an
 * admin prompt change is a valid AI re-score reason.
 *
 * F0077 — *Permit configuration*. Admins and superusers may always edit. The
 * **owning role** may edit one of its own parameters when an admin has flipped
 * `config_permitted` for that row in Area weights; that per-parameter grant is
 * the whole point of the control, and it is enforced here rather than in the
 * client. The route's blanket `requireRole("admin")` is gone, so the guards are
 * explicit: a founder, or a role that does not own this parameter, gets 403.
 *
 * §8 Q6 / F0063 / F0080 / F0071 — **settled by W3-A.** The editor set is the
 * `configparams` cell ("Configure 3 additional parameters"), which both written
 * specs §10 seed to Super Users, Client Admins and the Program Manager
 * (incubator) / Partner (VC); §1.1 ranks that spec above the live console,
 * which grants it to the Super User alone (F0150 — one cell to reverse). Any
 * other role still needs the per-parameter `config_permitted` grant, exactly as
 * the spec's "read-only unless granted" sentence describes.
 *
 * The core-13 area weights are NOT this task: `PUT /api/config/parameters` is
 * still admin-only, which is what keeps the roles harness's `config.params`
 * probe where it was.
 */
config.put("/additional-params/:id", async (c) => {
  const { edition, role } = c.var.user;
  // Only a `configparams` holder or one of the roles that can OWN an additional
  // parameter can possibly pass; everyone else (founder, mentor, …) is out
  // before the plan or the row is read.
  const mayConfigure = await c.var.perms.can("configparams");
  if (!mayConfigure && !isAdditionalParamOwner(edition, role)) {
    return c.json({ error: "forbidden" }, 403);
  }
  const s = await requirePremium(c, edition);
  if (!s) return c.json({ error: "plan_required" }, 402);
  const id = c.req.param("id");
  const p = await c.env.DB.prepare(
    "SELECT informational, name, prompt, role_scope, config_permitted FROM parameters WHERE id = ? AND edition = ? AND active = 1",
  )
    .bind(id, edition)
    .first<{
      informational: number;
      name: string;
      prompt: string | null;
      role_scope: string | null;
      config_permitted: number;
    }>();
  if (!p) return c.json({ error: "not_found" }, 404);
  if (p.informational !== 1) return c.json({ error: "core_param" }, 400);

  const permitted = p.config_permitted === 1 && p.role_scope === role;
  if (!mayConfigure && !permitted) return c.json({ error: "forbidden" }, 403);

  const body = await readBody<{ name?: string; prompt?: string | null }>(c);
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : p.name;
  // prompt: an empty string clears it (falls back to the default), undefined keeps it.
  let prompt = p.prompt;
  if (body.prompt !== undefined) {
    prompt = typeof body.prompt === "string" && body.prompt.trim() ? body.prompt.trim() : null;
  }

  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE parameters SET name = ?, prompt = ? WHERE id = ?").bind(name, prompt, id),
    bumpCriteriaVersion(c, edition),
  ]);
  return c.json({ ok: true, param: { id, name, prompt: prompt ?? undefined } });
});

/** DELETE /api/config/additional-params/:id — retire an additional param
 *  (Premium only; soft delete active=0, so historical scores stay referenced). */
config.delete("/additional-params/:id", requireTask("configparams", "admin"), async (c) => {
  const edition = c.var.user.edition;
  const s = await requirePremium(c, edition);
  if (!s) return c.json({ error: "plan_required" }, 402);
  const id = c.req.param("id");
  const p = await c.env.DB.prepare(
    "SELECT informational FROM parameters WHERE id = ? AND edition = ? AND active = 1",
  )
    .bind(id, edition)
    .first<{ informational: number }>();
  if (!p) return c.json({ error: "not_found" }, 404);
  if (p.informational !== 1) return c.json({ error: "core_param" }, 400); // never delete a core area
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE parameters SET active = 0 WHERE id = ?").bind(id),
    bumpCriteriaVersion(c, edition),
  ]);
  return c.json({ ok: true });
});

/**
 * PUT /api/config/additional-params/:id/permit — the *Permit configuration*
 * pill on Area weights (`admin/s-wt.html`, `permitTog` in `admin/_scripts.js`).
 *
 * Granting the delegation is itself an admin act, so this stays admin-only even
 * though the grant it writes lets a non-admin edit. Body: `{ permitted: bool }`.
 */
config.put("/additional-params/:id/permit", requireTask("configparams", "admin"), async (c) => {
  const edition = c.var.user.edition;
  const id = c.req.param("id");
  const body = await readBody<{ permitted: boolean }>(c);
  if (typeof body.permitted !== "boolean") return c.json({ error: "invalid_permitted" }, 400);
  const p = await c.env.DB.prepare(
    "SELECT informational FROM parameters WHERE id = ? AND edition = ? AND active = 1",
  )
    .bind(id, edition)
    .first<{ informational: number }>();
  if (!p) return c.json({ error: "not_found" }, 404);
  // Only the role-scoped additional parameters carry the delegation — the core
  // 13 are the org's rubric and are never delegated to one role.
  if (p.informational !== 1) return c.json({ error: "core_param" }, 400);
  await c.env.DB.prepare("UPDATE parameters SET config_permitted = ? WHERE id = ?")
    .bind(body.permitted ? 1 : 0, id)
    .run();
  return c.json({ ok: true, id, permitted: body.permitted });
});

// ── Scoring framework (admin console → Evaluation → Scoring framework) ───────
//
// The thirteen controls of `admin/s-fw.html`, stored on `org_scoring_settings`
// (0026). Reading them is not a secret — every honouring path in the client
// (the three-score view, the workbench's input scale) needs them — so the read
// is open to any authed non-founder. Writing is admin-only.

/** The composition controls: changing one invalidates every stored AI run. */
function compositionChanged(before: ScoringSettings, after: ScoringSettings): boolean {
  return (
    before.scoreScale !== after.scoreScale ||
    before.compositeFormula !== after.compositeFormula ||
    before.aiWeightPct !== after.aiWeightPct
  );
}

/** GET /api/config/scoring — the org's scoring framework (any authed staff). */
config.get("/scoring", async (c) => {
  const { edition, role } = c.var.user;
  // A founder never scores and never reads a report; the framework tells them
  // nothing they should know about how their deck is judged internally.
  if (role === "founder") return c.json({ error: "forbidden" }, 403);
  const settings = await loadScoringSettings(c.env.DB, edition);
  const s = await loadSettings(c, edition);
  return c.json({
    scoring: settings,
    // The two cohort-rating thresholds live on org_settings and are rendered in
    // the same card (0026's header explains why they stay there).
    thresholdBest: s?.threshold_best ?? 7,
    thresholdMediocre: s?.threshold_mediocre ?? 5,
    editable: isConfigAdmin(role),
  });
});

interface ScoringFrameworkBody {
  aiPreScoringEnabled: boolean;
  autoClarification: boolean;
  showAiScoreToJury: boolean;
  requireOverrideRationale: boolean;
  overrideRationaleDelta: number;
  jurySeesPeerScores: boolean;
  scoreScale: string;
  compositeFormula: string;
  aiWeightPct: number;
  shortlistThreshold: number;
  showThreeScoreView: boolean;
  showScoreDrift: boolean;
  includeAiEvidence: boolean;
  introCallAiPrompts: boolean;
}

/**
 * PUT /api/config/scoring-framework — save the whole section in one write,
 * which is the prototype's model: `s-fw` carries no save control of its own and
 * the console's title bar has a single **Save changes** (F0168).
 *
 * A change to the score scale, the composite formula or the AI/jury split
 * changes what every stored composite MEANS, so it bumps `criteria_version`
 * (unblocking re-score) and re-computes the edition's stored totals — the same
 * contract a weight edit already has.
 */
config.put("/scoring-framework", requireTask("adminconsole", "admin"), async (c) => {
  const { edition, id: userId } = c.var.user;
  const before = await loadScoringSettings(c.env.DB, edition);
  const body = await readBody<ScoringFrameworkBody>(c);

  const flag = (v: unknown, fallback: boolean): boolean =>
    typeof v === "boolean" ? v : fallback;

  const delta = Number(body.overrideRationaleDelta ?? before.overrideRationaleDelta);
  if (!Number.isFinite(delta) || delta < 0 || delta > 10) {
    return c.json({ error: "invalid_delta" }, 400);
  }
  const shortlistThreshold = Number(body.shortlistThreshold ?? before.shortlistThreshold);
  if (!Number.isFinite(shortlistThreshold) || shortlistThreshold < 0 || shortlistThreshold > 10) {
    return c.json({ error: "invalid_shortlist_threshold" }, 400);
  }
  const scoreScale = body.scoreScale ?? before.scoreScale;
  if (!(SCORE_SCALES as readonly string[]).includes(scoreScale)) {
    return c.json({ error: "invalid_score_scale" }, 400);
  }
  const compositeFormula = body.compositeFormula ?? before.compositeFormula;
  if (!(COMPOSITE_FORMULAS as readonly string[]).includes(compositeFormula)) {
    return c.json({ error: "invalid_composite_formula" }, 400);
  }
  const aiWeightPct = Number(body.aiWeightPct ?? before.aiWeightPct);
  // The prototype's select offers exactly four splits; anything else would make
  // the saved value unrepresentable in the UI that has to render it back.
  if (!(AI_WEIGHT_CHOICES as readonly number[]).includes(aiWeightPct)) {
    return c.json({ error: "invalid_ai_weight" }, 400);
  }

  const after: ScoringSettings = {
    aiPreScoringEnabled: flag(body.aiPreScoringEnabled, before.aiPreScoringEnabled),
    autoClarification: flag(body.autoClarification, before.autoClarification),
    showAiScoreToJury: flag(body.showAiScoreToJury, before.showAiScoreToJury),
    requireOverrideRationale: flag(body.requireOverrideRationale, before.requireOverrideRationale),
    overrideRationaleDelta: delta,
    jurySeesPeerScores: flag(body.jurySeesPeerScores, before.jurySeesPeerScores),
    scoreScale: scoreScale as ScoringSettings["scoreScale"],
    compositeFormula: compositeFormula as ScoringSettings["compositeFormula"],
    aiWeightPct,
    shortlistThreshold,
    showThreeScoreView: flag(body.showThreeScoreView, before.showThreeScoreView),
    showScoreDrift: flag(body.showScoreDrift, before.showScoreDrift),
    includeAiEvidence: flag(body.includeAiEvidence, before.includeAiEvidence),
    introCallAiPrompts: flag(body.introCallAiPrompts, before.introCallAiPrompts),
  };

  const recompute = compositionChanged(before, after);
  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare(
      "UPDATE org_scoring_settings SET ai_pre_scoring_enabled = ?, auto_clarification = ?, " +
        "show_ai_score_to_jury = ?, require_override_rationale = ?, override_rationale_delta = ?, " +
        "jury_sees_peer_scores = ?, score_scale = ?, composite_formula = ?, ai_weight_pct = ?, " +
        "shortlist_threshold = ?, show_three_score_view = ?, show_score_drift = ?, " +
        "include_ai_evidence = ?, intro_call_ai_prompts = ?, updated_at = datetime('now'), " +
        "updated_by = ? WHERE edition = ?",
    ).bind(
      after.aiPreScoringEnabled ? 1 : 0,
      after.autoClarification ? 1 : 0,
      after.showAiScoreToJury ? 1 : 0,
      after.requireOverrideRationale ? 1 : 0,
      after.overrideRationaleDelta,
      after.jurySeesPeerScores ? 1 : 0,
      after.scoreScale,
      after.compositeFormula,
      after.aiWeightPct,
      after.shortlistThreshold,
      after.showThreeScoreView ? 1 : 0,
      after.showScoreDrift ? 1 : 0,
      after.includeAiEvidence ? 1 : 0,
      after.introCallAiPrompts ? 1 : 0,
      userId,
      edition,
    ),
  ];
  if (recompute) stmts.push(bumpCriteriaVersion(c, edition));
  await c.env.DB.batch(stmts);

  const rescored = recompute ? await rescoreEdition(c.env, edition) : { decks: 0, evaluations: 0 };
  return c.json({ ok: true, scoring: after, rescored });
});

// ── Cohort thresholds ────────────────────────────────────────────────────────

config.put("/thresholds", requireTask("adminconsole", "admin"), async (c) => {
  const edition = c.var.user.edition;
  const body = await readBody<{ best: number; mediocre: number }>(c);
  const best = Number(body.best);
  const mediocre = Number(body.mediocre);
  if (![best, mediocre].every((n) => Number.isFinite(n) && n >= 0 && n <= 10)) {
    return c.json({ error: "invalid_threshold" }, 400);
  }
  if (best <= mediocre) return c.json({ error: "best_below_mediocre" }, 400);
  await c.env.DB.prepare(
    "UPDATE org_settings SET threshold_best = ?, threshold_mediocre = ? WHERE edition = ?",
  )
    .bind(best, mediocre, edition)
    .run();
  return c.json({ ok: true, thresholdBest: best, thresholdMediocre: mediocre });
});

// ── AI system prompt ─────────────────────────────────────────────────────────

config.put("/ai-prompt", requireTask("adminconsole", "admin"), async (c) => {
  const edition = c.var.user.edition;
  const body = await readBody<{ prompt: string }>(c);
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE org_settings SET ai_system_prompt = ? WHERE edition = ?").bind(
      prompt ? prompt : null,
      edition,
    ),
    // The prompt is part of the scoring criteria → allow a re-score.
    bumpCriteriaVersion(c, edition),
  ]);
  return c.json({ ok: true, aiSystemPrompt: prompt });
});

// ── Branding ─────────────────────────────────────────────────────────────────

config.put("/branding", requireTask("adminconsole", "admin"), async (c) => {
  const edition = c.var.user.edition;
  const body = await readBody<{ branding: Record<string, unknown> }>(c);
  const branding = body.branding && typeof body.branding === "object" ? body.branding : {};
  await c.env.DB.prepare("UPDATE org_settings SET branding_json = ? WHERE edition = ?")
    .bind(JSON.stringify(branding), edition)
    .run();
  return c.json({ ok: true, branding });
});

// ── Plan tier ────────────────────────────────────────────────────────────────

config.put("/plan", requireTask("upgrade", "admin"), async (c) => {
  const edition = c.var.user.edition;
  const body = await readBody<{ plan: string }>(c);
  if (!isPlan(body.plan)) return c.json({ error: "invalid_plan" }, 400);
  await c.env.DB.prepare("UPDATE org_settings SET plan = ? WHERE edition = ?")
    .bind(body.plan, edition)
    .run();
  return c.json({ ok: true, plan: body.plan, additionalEnabled: planAllowsAdditional(body.plan) });
});

// ── Admin-granted credits ────────────────────────────────────────────────────

config.post("/credits", requireTask("upgrade", "admin"), async (c) => {
  const edition = c.var.user.edition;
  const body = await readBody<{ credits: number }>(c);
  const credits = Number(body.credits);
  if (!Number.isInteger(credits) || credits < 0) return c.json({ error: "invalid_credits" }, 400);
  await c.env.DB.prepare("UPDATE org_settings SET credits_balance = ? WHERE edition = ?")
    .bind(credits, edition)
    .run();
  return c.json({ ok: true, creditsBalance: credits });
});

// ── Buy credits (self-serve top-up) ───────────────────────────────────────────
//
// The "Buy credits" screen mirrors the prototype's pay-as-you-go packs (Pro /
// Premium, 20–50 credits). This is a DEMO TOP-UP: it ADDS the pack's credits to
// the balance and records NO payment details. There is no real payment
// integration — collecting card / UPI / bank credentials is deliberately out of
// scope. The client labels it clearly as a simulated purchase.
config.post("/credits/purchase", requireTask("upgrade", "admin"), async (c) => {
  const edition = c.var.user.edition;
  const body = await readBody<{ credits: number }>(c);
  const credits = Number(body.credits);
  // A pack adds 1..1000 credits (1000 = the largest enterprise pack).
  if (!Number.isInteger(credits) || credits < 1 || credits > 1000) {
    return c.json({ error: "invalid_pack" }, 400);
  }
  // Atomic increment so a concurrent upload/reserve can't clobber the top-up.
  await c.env.DB.prepare(
    "UPDATE org_settings SET credits_balance = credits_balance + ? WHERE edition = ?",
  )
    .bind(credits, edition)
    .run();
  const row = await c.env.DB.prepare(
    "SELECT credits_balance FROM org_settings WHERE edition = ?",
  )
    .bind(edition)
    .first<{ credits_balance: number }>();
  return c.json({ ok: true, purchased: credits, creditsBalance: row?.credits_balance ?? 0 });
});

export { config };
export default config;
