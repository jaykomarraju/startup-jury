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
  isMentor,
} from "../../shared/roles";
import { PLANS, planAllowsAdditional, planAllowsCore, isPlan, type Plan } from "../../shared/plans";
import {
  REQUIRED_WEIGHT_TOTAL,
  weightTotal,
  weightTotalMessage,
  type ScoringSettings,
} from "../../shared/scoring";
import {
  AI_WEIGHT_CHOICES,
  COMPOSITE_FORMULAS,
  DEFAULT_ROLE_PERMISSIONS,
  SCORE_SCALES,
} from "../../shared/types";
import { requireAuth, requireRole, requireTask } from "../auth/middleware";
import { scopeOf, scoped, insertScope, type TenantScope } from "../../shared/tenant";
import { inEdition } from "../config/scope";
import { rescoreEdition } from "../config/rescore";
import { loadScoringSettings } from "../config/scoringSettings";
import { loadScoreVisibility } from "../config/scoreVisibility";
import {
  VISIBILITY_EDITIONS,
  VISIBILITY_ROLES,
  type VisibilityMatrix,
} from "../../shared/scoreVisibility";
// V3-AW · item 12 — the Seat-configurability grid. The ladder `planAllowsCore`
// / `planAllowsAdditional` hard-code is now the grid's DEFAULT, so every gate
// below reads the org's row before it answers. An org that never opens the
// grid gets byte-identical answers (`test/worker/aiPrompts.test.ts`).
import { loadSeatCapability } from "./aiPrompts";
// W3-C — the audit trail. Every mutation below records what changed; the
// writer swallows its own errors so a trail failure never fails a save.
import { money, packPriceMinor, recordCreditMovement } from "../audit/log";
import {
  auditConfig,
  auditScoreVisibility,
  auditScoringFramework,
  auditThresholds,
  auditWeightChange,
  type VisibilityChange,
} from "../audit/events";

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
 * ── WHAT THE TENANCY WAVE CHANGED IN THIS FILE ──────────────────────────────
 *
 * Every helper below took an `Edition`; each now takes a `TenantScope` — the
 * `(tenant_id, edition)` pair `scopeOf(c.var.user)` builds. `edition` survives
 * because it is also the PRODUCT VARIANT (`plan_multitenancy.md` §5c): four sites
 * branch on it to decide which features exist, and `canEditVisibility` below
 * refuses a VC console outright. What changed is that it is no longer the ONLY
 * key, which is what `/api/config/*` being §2's B9 was about: rubric, weights, AI
 * prompts, credit balance and credit purchase, scoped by a column with two values.
 *
 * `org_settings`, `org_scoring_settings`, `parameters` and `score_visibility` are
 * all tenant-keyed (0084/0085, rebuilt in 0089/0090/0092), so every predicate
 * here is `.on(alias)` and every `UPDATE` carries the pair too — not because the
 * scoped load above it is insufficient, but because a write that names the owner
 * cannot be made wrong by a later edit to the read that fed it.
 */

/**
 * Bump the workspace's criteria version. Any change to what the AI scores
 * against — core weights, the AI prompt, or the additional-parameter set —
 * invalidates the previous AI run, so a re-score becomes allowed (see
 * routes/decks.ts /rescore).
 */
function bumpCriteriaVersion(c: Context<AppEnv>, scope: TenantScope): D1PreparedStatement {
  const q = scoped(scope).on("org_settings");
  return c.env.DB.prepare(
    `UPDATE org_settings SET criteria_version = criteria_version + 1 ${q.whereClause()}`,
  ).bind(...q.binds);
}

function loadSettings(c: Context<AppEnv>, scope: TenantScope): Promise<SettingsRow | null> {
  const q = scoped(scope).on("o");
  return c.env.DB.prepare(
    "SELECT o.plan, o.credits_balance, o.branding_json, o.ai_system_prompt, o.threshold_best, " +
      `o.threshold_mediocre FROM org_settings o ${q.whereClause()}`,
  )
    .bind(...q.binds)
    .first<SettingsRow>();
}

async function loadParams(c: Context<AppEnv>, scope: TenantScope): Promise<ParamRow[]> {
  const q = scoped(scope).on("p").andRaw("p.active = 1");
  return (
    await c.env.DB.prepare(
      "SELECT p.id, p.key, p.name, p.weight, p.informational, p.role_scope, p.prompt, p.description, " +
        `p.config_permitted, p.sort_order FROM parameters p ${q.whereClause()} ORDER BY p.sort_order`,
    )
      .bind(...q.binds)
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

/**
 * ── THE AI SCREENING GATE ON THE SUMMARY (2026-10-01, tester issues 7 and 8) ──
 *
 * `org_scoring_settings.ai_gate_threshold` is written by the console's Scoring
 * framework section and was then read by nobody: the summary did not carry it,
 * `ConfigSummary` did not declare it, and `DashboardPage` reached for it through
 * a widening cast that nothing could satisfy — so every screening verdict on the
 * Dashboard was taken against a hardcoded 5.0. It looked right only because
 * production happens to hold 5, which is the migration's own default.
 *
 * **Read through `loadScoringSettings`, not through a column added to
 * `loadSettings`.** The gate lives on `org_scoring_settings`; `loadSettings`
 * reads `org_settings`. Reaching it from here would mean either a second table
 * in that query or a second place that knows the column's name and its default —
 * and a duplicate threshold reader is the exact fault this number already has a
 * history of (`0082`'s header; `routes/decks.ts:95-100`). One reader, one
 * default, one extra D1 read on a route that already makes three.
 */
function loadGate(c: Context<AppEnv>, scope: TenantScope): Promise<number> {
  return loadScoringSettings(c.env.DB, scope).then((s) => s.aiGateThreshold);
}

/** GET /api/config/summary — the safe read subset (any authed user):
 *  thresholds + the AI screening gate + plan + branding + the rubric parameters
 *  (drives the dashboard thresholds rail, the screening statuses and the
 *  read-only My Parameters view). No secrets. */
config.get("/summary", async (c) => {
  const scope = scopeOf(c.var.user);
  const s = await loadSettings(c, scope);
  if (!s) return c.json({ error: "not_found" }, 404);
  const params = await loadParams(c, scope);
  const cap = await loadSeatCapability(c, scope);
  return c.json({
    plan: s.plan,
    coreConfigEnabled: planAllowsCore(s.plan, cap.core),
    additionalEnabled: planAllowsAdditional(s.plan, cap.addl),
    thresholdBest: s.threshold_best,
    thresholdMediocre: s.threshold_mediocre,
    // The SCREENING gate — not the cohort bands above it and not
    // `shortlist_threshold`. Three numbers on one 0–10 scale; see `loadGate`.
    aiGateThreshold: await loadGate(c, scope),
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
  const scope = scopeOf(c.var.user);
  const s = await loadSettings(c, scope);
  if (!s) return c.json({ error: "not_found" }, 404);
  const params = await loadParams(c, scope);
  const cap = await loadSeatCapability(c, scope);
  return c.json({
    plan: s.plan,
    coreConfigEnabled: planAllowsCore(s.plan, cap.core),
    additionalEnabled: planAllowsAdditional(s.plan, cap.addl),
    creditsBalance: s.credits_balance,
    aiSystemPrompt: s.ai_system_prompt ?? "",
    thresholdBest: s.threshold_best,
    thresholdMediocre: s.threshold_mediocre,
    // `FullConfig extends ConfigSummary`, so the gate is served here too or the
    // type promises the admin console a number it never receives.
    aiGateThreshold: await loadGate(c, scope),
    branding: parseBranding(s.branding_json),
    coreParams: params.filter((p) => p.informational === 0).map(toParamView),
    additionalParams: params.filter((p) => p.informational === 1).map(toParamView),
  });
});

// ── The member's own plan (W8-B · §9 `W6-C`, §8 Q79 / Q116) ──────────────────
//
// `users.plan_tier` (0052) is the tier of the seat a member holds. Until W8-B it
// gated nothing: every parameter route asked `org_settings.plan` alone, so a
// Standard juror in a Premium workspace could configure what Premium allows.
//
// The rule (§8 Q116): the plan that governs what a member may configure is the
// LOWER of their own seat's tier and the workspace plan, and it means what
// `plans.ts` says a tier means — Pro configures the 13 core areas, Premium adds
// the role parameters. That is the meaning Set up already shows on each member
// card (`PLAN_PRIVILEGES`), the one the per-tier seat prices are sold against,
// and the prototype's own `PLAN_META[CURRENT_PLAN]` check. The workspace plan is
// the ceiling: a Premium seat cannot configure beyond a Standard workspace.
//
// Roles are unchanged. This only ever REMOVES access a role already had.

/** The plan that governs what the signed-in member may configure. */
async function memberPlan(
  c: Context<AppEnv>,
  orgPlan: Plan,
): Promise<{ memberTier: Plan; effective: Plan }> {
  // `users` is tenant-keyed (0087, rebuilt for `UNIQUE (tenant_id, email)`). The
  // id is the CALLER's own, so the pair cannot disagree with it — but a read of
  // `users` that names only an id is the shape §2 B6 is about, and a statement
  // that says whose roster it is reading costs one predicate.
  const uq = scoped(scopeOf(c.var.user)).on("u").and("u.id = ?", c.var.user.id);
  const row = await c.env.DB.prepare(`SELECT u.plan_tier FROM users u ${uq.whereClause()}`)
    .bind(...uq.binds)
    .first<{ plan_tier: string | null }>();
  const memberTier: Plan = isPlan(row?.plan_tier) ? row.plan_tier : "standard";
  // `PLANS` is ordered Standard → Pro → Premium; the lower of the two governs.
  const effective = PLANS[Math.min(PLANS.indexOf(memberTier), PLANS.indexOf(orgPlan))];
  return { memberTier, effective };
}

/**
 * The editor set for the role-scoped parameters, as a role floor ANDed with the
 * `configparams` cell (§8 Q6 / Q8 — see `PUT /additional-params/:id`).
 */
async function mayConfigureAdditional(c: Context<AppEnv>): Promise<boolean> {
  const { edition, role } = c.var.user;
  const configEditors = DEFAULT_ROLE_PERMISSIONS[edition].configparams ?? [];
  return (
    (isConfigAdmin(role) || configEditors.includes(role)) && (await c.var.perms.can("configparams"))
  );
}

interface EditableParamRow extends ParamRow {
  active: number;
}

/**
 * GET /api/config/parameters — the parameter-configuration view for the
 * signed-in member: both My Parameters and Core Parameters render from it.
 *
 * Unlike `/summary` it answers "what may *I* change": the org plan, the member's
 * own tier, the plan that results, and per role parameter whether this member
 * may edit it. It also lists a role parameter that has been SWITCHED OFF
 * (0060 — `active = 0`, `retired = 0`), which every other read of `parameters`
 * deliberately omits, so the toggle can be switched back on.
 *
 * Any authenticated member of the workspace; not a founder, not a mentor.
 */
config.get("/parameters", async (c) => {
  const { role } = c.var.user;
  const scope = scopeOf(c.var.user);
  if (role === "founder" || isMentor(role)) return c.json({ error: "forbidden" }, 403);
  const s = await loadSettings(c, scope);
  if (!s) return c.json({ error: "not_found" }, 404);
  const { memberTier, effective } = await memberPlan(c, s.plan);
  const cap = await loadSeatCapability(c, scope);
  const coreConfigEnabled = planAllowsCore(effective, cap.core);
  const additionalEnabled = planAllowsAdditional(effective, cap.addl);
  const additionalEditor = await mayConfigureAdditional(c);

  const rq = scoped(scope).on("p").andRaw("p.retired = 0");
  const rows = (
    await c.env.DB.prepare(
      "SELECT p.id, p.key, p.name, p.weight, p.informational, p.role_scope, p.prompt, p.description, " +
        `p.config_permitted, p.sort_order, p.active FROM parameters p ${rq.whereClause()} ORDER BY p.sort_order`,
    )
      .bind(...rq.binds)
      .all<EditableParamRow>()
  ).results;

  return c.json({
    plan: s.plan,
    memberTier,
    effectivePlan: effective,
    coreConfigEnabled,
    additionalEnabled,
    /** §8 Q6(a): the core 13 stay admin + superuser. */
    coreEditor: isConfigAdmin(role),
    /** The `configparams` editor set, before the plan is applied. */
    additionalEditor,
    coreParams: rows.filter((p) => p.informational === 0 && p.active === 1).map(toParamView),
    additionalParams: rows
      .filter((p) => p.informational === 1)
      .map((p) => ({
        ...toParamView(p),
        enabled: p.active === 1,
        editable:
          additionalEnabled &&
          (additionalEditor || (p.config_permitted === 1 && p.role_scope === role)),
      })),
  });
});

// ── Rubric: core weights (re-scores) ─────────────────────────────────────────

interface WeightUpdate {
  id: string;
  weight: number;
  name?: string;
  /**
   * The area's AI extraction prompt (§8 Q95 — core-prompt editing belongs to
   * Core Parameters). An empty string clears it; absent leaves it alone.
   */
  prompt?: string | null;
}

/** PUT /api/config/parameters — update core parameter weights (and optional
 *  renames and extraction prompts), then re-score the whole edition. */
config.put("/parameters", requireRole("admin"), async (c) => {
  const scope = scopeOf(c.var.user);
  const settings = await loadSettings(c, scope);
  if (!settings) return c.json({ error: "not_found" }, 404);
  // Configuring the core 13 weights requires Pro or above (Standard = no config).
  const cap = await loadSeatCapability(c, scope);
  if (!planAllowsCore(settings.plan, cap.core)) return c.json({ error: "plan_required" }, 402);
  // …and so does the member's own seat (§9 `W6-C`, §8 Q116).
  const { effective } = await memberPlan(c, settings.plan);
  if (!planAllowsCore(effective, cap.core)) {
    return c.json({ error: "plan_required", scope: "member" }, 402);
  }

  const body = await readBody<{ params: WeightUpdate[] }>(c);
  const updates = Array.isArray(body.params) ? body.params : [];
  if (updates.length === 0) return c.json({ error: "no_params" }, 400);

  const existing = await loadParams(c, scope);
  const byId = new Map(existing.map((p) => [p.id, p]));

  const stmts: D1PreparedStatement[] = [];
  const promptChanges: string[] = [];
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
    let prompt = p.prompt;
    if (u.prompt !== undefined) {
      prompt = typeof u.prompt === "string" && u.prompt.trim() ? u.prompt.trim() : null;
      if (prompt !== p.prompt) promptChanges.push(name);
    }
    // `u.id` was validated against `existing`, which `loadParams` read scoped —
    // but §2 B9 names this exact statement ("parameter writes at :350 … are
    // `WHERE id = ?` after an edition-scoped load"), so the write names the owner
    // too. A predicate here cannot be invalidated by a later change to the read.
    const wq = scoped(scope).on("parameters").and("id = ?", u.id);
    stmts.push(
      c.env.DB.prepare(
        `UPDATE parameters SET weight = ?, name = ?, prompt = ? ${wq.whereClause()}`,
      ).bind(weight, name, prompt, ...wq.binds),
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

  stmts.push(bumpCriteriaVersion(c, scope));
  await c.env.DB.batch(stmts);
  await auditWeightChange(c, existing, updates);
  if (promptChanges.length > 0) {
    await auditConfig(c, "core_prompt_updated", `AI extraction prompt updated for ${promptChanges.join(", ")}`, {
      targetType: "parameter",
    });
  }

  const rescored = await rescoreEdition(c.env, scope);
  const params = await loadParams(c, scope);
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
async function requirePremium(c: Context<AppEnv>, scope: TenantScope): Promise<SettingsRow | null> {
  const s = await loadSettings(c, scope);
  if (!s) return null;
  const cap = await loadSeatCapability(c, scope);
  return planAllowsAdditional(s.plan, cap.addl) ? s : null;
}

/** Validate a submitted owner role for the edition. */
function validOwner(edition: Edition, role: unknown): Role | null {
  return typeof role === "string" && (ADDITIONAL_PARAM_OWNERS[edition] as readonly string[]).includes(role)
    ? (role as Role)
    : null;
}

/** Guard: the member's own seat must allow the role parameters too (§8 Q116). */
async function memberAllowsAdditional(c: Context<AppEnv>, s: SettingsRow): Promise<boolean> {
  const cap = await loadSeatCapability(c, scopeOf(c.var.user));
  return planAllowsAdditional((await memberPlan(c, s.plan)).effective, cap.addl);
}

/** A description / prompt body field: an empty string clears it, absent keeps it. */
function optionalText(value: unknown, current: string | null): string | null {
  if (value === undefined) return current;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** POST /api/config/additional-params — add a role-scoped additional param
 *  (Premium only). Body: { name, roleScope, prompt?, description? }. Enforces ≤3
 *  per role — a switched-off parameter still holds its slot (0060). */
// Wave 3 integration. The role list must match the `configparams` seed that
// migration 0040 widened to spec §10's editor set (superuser, admin,
// program_manager / partner) — W3-A widened the SEED and the client, which shows
// Add / Remove from `can("configparams")`, but left these three routes on an
// admin-only list. A Program Manager therefore saw controls that 403'd. The task
// is still ANDed on, so revoking the cell still closes them.
config.post("/additional-params", requireTask("configparams", "admin", "program_manager", "partner"), async (c) => {
  const { edition } = c.var.user;
  const scope = scopeOf(c.var.user);
  const s = await loadSettings(c, scope);
  if (!s) return c.json({ error: "not_found" }, 404);
  const cap = await loadSeatCapability(c, scope);
  if (!planAllowsAdditional(s.plan, cap.addl)) return c.json({ error: "plan_required" }, 402);
  if (!(await memberAllowsAdditional(c, s))) return c.json({ error: "plan_required", scope: "member" }, 402);

  const body = await readBody<{ name: string; roleScope: string; prompt?: string; description?: string }>(c);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return c.json({ error: "name_required" }, 400);
  const roleScope = validOwner(edition, body.roleScope);
  if (!roleScope) return c.json({ error: "invalid_role" }, 400);
  const prompt = optionalText(body.prompt, null);
  const description = optionalText(body.description, null);

  // Up to 3 additional params per owning role. A switched-off one keeps its
  // slot (it still has its label, description and prompt); a removed one does not.
  // The ≤3-per-role cap is a COUNT, which §11's second standing instruction
  // names as the dangerous shape: unscoped it counted every customer's role
  // parameters and refused this customer's fourth because another had three.
  const cq = scoped(scope)
    .on("p")
    .and("p.role_scope = ?", roleScope)
    .andRaw("p.retired = 0 AND p.informational = 1");
  const count = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM parameters p ${cq.whereClause()}`)
    .bind(...cq.binds)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_ADDITIONAL_PER_ROLE) return c.json({ error: "role_full" }, 409);

  const suffix = crypto.randomUUID().slice(0, 8);
  const id = `${edition}_add_${suffix}`;
  const key = `add_${suffix}`;
  const oq = scoped(scope).on("p");
  const nextOrder = await c.env.DB.prepare(
    `SELECT COALESCE(MAX(p.sort_order), 100) + 1 AS n FROM parameters p ${oq.whereClause()}`,
  )
    .bind(...oq.binds)
    .first<{ n: number }>();
  // The write side, where the failure is silent: `parameters.tenant_id` carries
  // `DEFAULT 't_default'` (0085 — SQLite offers no other way to backfill a NOT
  // NULL column), so a forgotten bind here would file a second customer's rubric
  // row against the first with a 200 and nothing to notice. `insertScope` is what
  // stops the column being nameable without its value.
  const t = insertScope(scope);
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO parameters (id, ${t.columns}, key, name, weight, informational, role_scope, prompt, description, sort_order, active) ` +
        `VALUES (?, ${t.placeholders}, ?, ?, 0, 1, ?, ?, ?, ?, 1)`,
    ).bind(id, ...t.binds, key, name, roleScope, prompt, description, nextOrder?.n ?? 101),
    // Adding a parameter changes the scoring criteria set → allow a re-score.
    bumpCriteriaVersion(c, scope),
  ]);

  await auditConfig(c, "additional_param_added", `Additional parameter "${name}" added for ${roleScope}`, {
    targetType: "parameter",
    targetId: id,
  });

  return c.json({
    ok: true,
    param: {
      id,
      key,
      name,
      weight: 0,
      informational: true,
      roleScope,
      prompt: prompt ?? undefined,
      description: description ?? undefined,
      enabled: true,
    },
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
  // The permission is a GATE, not a grant (plan §8 Q8): AND it onto the role
  // floor rather than replacing the floor with it.
  //
  // Wave 3 integration. This read `await c.var.perms.can("configparams")` alone,
  // and `can()` returns TRUE for any role outside the matrix
  // (shared/permissions.ts — the rule that keeps a founder on their own upload
  // route). `founder` is deliberately absent from PERMISSION_ROLES, so a founder
  // passed a check that 403'd them on main, and ticking one console checkbox
  // would have handed a jury member edit rights the role list never gave. The
  // floor is the same default editor set migration 0040 seeds — spec §10's, per
  // §8 Q6 — so the widening to program_manager / partner is preserved.
  const scope = scopeOf(c.var.user);
  const mayConfigure = await mayConfigureAdditional(c);
  if (!mayConfigure && !isAdditionalParamOwner(edition, role)) {
    return c.json({ error: "forbidden" }, 403);
  }
  const s = await requirePremium(c, scope);
  if (!s) return c.json({ error: "plan_required" }, 402);
  const id = c.req.param("id");
  // `retired = 0`, not `active = 1`: a switched-off parameter (0060) is still
  // editable, and switching it back on is an edit.
  const pq = scoped(scope).on("p").and("p.id = ?", id).andRaw("p.retired = 0");
  const p = await c.env.DB.prepare(
    "SELECT p.informational, p.name, p.prompt, p.description, p.role_scope, p.config_permitted, " +
      `p.active FROM parameters p ${pq.whereClause()}`,
  )
    .bind(...pq.binds)
    .first<{
      informational: number;
      name: string;
      prompt: string | null;
      description: string | null;
      role_scope: string | null;
      config_permitted: number;
      active: number;
    }>();
  if (!p) return c.json({ error: "not_found" }, 404);
  if (p.informational !== 1) return c.json({ error: "core_param" }, 400);

  const permitted = p.config_permitted === 1 && p.role_scope === role;
  if (!mayConfigure && !permitted) return c.json({ error: "forbidden" }, 403);
  // Authorised by role — now the member's own seat (§9 `W6-C`, §8 Q116). After
  // the 403s on purpose: who may edit is decided before what their plan allows.
  if (!(await memberAllowsAdditional(c, s))) return c.json({ error: "plan_required", scope: "member" }, 402);

  const body = await readBody<{
    name?: string;
    prompt?: string | null;
    description?: string | null;
    enabled?: boolean;
  }>(c);
  if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
    return c.json({ error: "invalid_enabled" }, 400);
  }
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : p.name;
  // prompt / description: an empty string clears it, undefined keeps it.
  const prompt = optionalText(body.prompt, p.prompt);
  const description = optionalText(body.description, p.description);
  const active = body.enabled === undefined ? p.active : body.enabled ? 1 : 0;

  const wq = scoped(scope).on("parameters").and("id = ?", id);
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE parameters SET name = ?, prompt = ?, description = ?, active = ? ${wq.whereClause()}`,
      ).bind(name, prompt, description, active, ...wq.binds),
      bumpCriteriaVersion(c, scope),
    ]);
  } catch {
    // `idx_parameters_edition_key_active` (0038) is partial on `active = 1`, so
    // switching a parameter back on can only fail if another live row took its
    // key meanwhile. Added parameters get random keys; this is the guard, not a path.
    return c.json({ error: "key_in_use" }, 409);
  }

  const changes: string[] = [];
  if (name !== p.name) changes.push(`renamed: ${p.name} → ${name}`);
  if (description !== p.description) changes.push("scoring description updated");
  if (prompt !== p.prompt) changes.push("AI extraction prompt updated");
  if (active !== p.active) changes.push(active === 1 ? "switched on" : "switched off");
  await auditConfig(
    c,
    "additional_param_updated",
    `Additional parameter ${name} ${changes.length > 0 ? changes.join("; ") : "saved unchanged"}`,
    {
      targetType: "parameter",
      targetId: id,
      detail: { name: { from: p.name, to: name }, enabled: { from: p.active === 1, to: active === 1 } },
    },
  );
  return c.json({
    ok: true,
    param: {
      id,
      name,
      prompt: prompt ?? undefined,
      description: description ?? undefined,
      enabled: active === 1,
    },
  });
});

/** DELETE /api/config/additional-params/:id — remove an additional param
 *  (Premium only). A soft delete — `active = 0, retired = 1` (0060) — so
 *  historical scores stay referenced and the row never comes back as a toggle. */
config.delete("/additional-params/:id", requireTask("configparams", "admin", "program_manager", "partner"), async (c) => {
  const workspace = scopeOf(c.var.user);
  const s = await requirePremium(c, workspace);
  if (!s) return c.json({ error: "plan_required" }, 402);
  if (!(await memberAllowsAdditional(c, s))) return c.json({ error: "plan_required", scope: "member" }, 402);
  const id = c.req.param("id");
  const pq = scoped(workspace).on("p").and("p.id = ?", id).andRaw("p.retired = 0");
  const p = await c.env.DB.prepare(
    `SELECT p.informational, p.name FROM parameters p ${pq.whereClause()}`,
  )
    .bind(...pq.binds)
    .first<{ informational: number; name: string }>();
  if (!p) return c.json({ error: "not_found" }, 404);
  if (p.informational !== 1) return c.json({ error: "core_param" }, 400); // never delete a core area
  const dq = scoped(workspace).on("parameters").and("id = ?", id);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE parameters SET active = 0, retired = 1 ${dq.whereClause()}`).bind(
      ...dq.binds,
    ),
    bumpCriteriaVersion(c, workspace),
  ]);
  await auditConfig(c, "additional_param_removed", `Additional parameter "${p.name}" removed`, {
    targetType: "parameter",
    targetId: id,
  });
  return c.json({ ok: true });
});

/**
 * PUT /api/config/additional-params/:id/permit — the *Permit configuration*
 * pill on Area weights (`admin/s-wt.html`, `permitTog` in `admin/_scripts.js`).
 *
 * Granting the delegation is itself an admin act, so this stays admin-only even
 * though the grant it writes lets a non-admin edit. Body: `{ permitted: bool }`.
 */
config.put("/additional-params/:id/permit", requireTask("configparams", "admin", "program_manager", "partner"), async (c) => {
  const scope = scopeOf(c.var.user);
  const id = c.req.param("id");
  const body = await readBody<{ permitted: boolean }>(c);
  if (typeof body.permitted !== "boolean") return c.json({ error: "invalid_permitted" }, 400);
  const pq = scoped(scope).on("p").and("p.id = ?", id).andRaw("p.active = 1");
  const p = await c.env.DB.prepare(
    `SELECT p.informational, p.name, p.role_scope FROM parameters p ${pq.whereClause()}`,
  )
    .bind(...pq.binds)
    .first<{ informational: number; name: string; role_scope: string | null }>();
  if (!p) return c.json({ error: "not_found" }, 404);
  // Only the role-scoped additional parameters carry the delegation — the core
  // 13 are the org's rubric and are never delegated to one role.
  if (p.informational !== 1) return c.json({ error: "core_param" }, 400);
  const wq = scoped(scope).on("parameters").and("id = ?", id);
  await c.env.DB.prepare(`UPDATE parameters SET config_permitted = ? ${wq.whereClause()}`)
    .bind(body.permitted ? 1 : 0, ...wq.binds)
    .run();
  await auditConfig(
    c,
    "config_permission_changed",
    `Configuration of "${p.name}" ${body.permitted ? "permitted for" : "withdrawn from"} ${p.role_scope ?? "its owning role"}`,
    { targetType: "parameter", targetId: id, detail: { permitted: body.permitted } },
  );
  return c.json({ ok: true, id, permitted: body.permitted });
});

// ── Scoring framework (admin console → Evaluation → Scoring framework) ───────
//
// The thirteen controls of `admin/s-fw.html`, stored on `org_scoring_settings`
// (0026). Reading them is not a secret — every honouring path in the client
// (the three-score view, the workbench's input scale) needs them — so the read
// is open to any authed non-founder. Writing is admin-only.

/**
 * The composition controls: changing one invalidates every stored AI run.
 *
 * **`aiWeightPct` is deliberately NOT one of them (V4-WEIGHT).** It used to be,
 * and that was wrong in a way that cost the client a bug report. `rescoreEdition`
 * reads `compositeFormula` and the parameter weights — it has zero references to
 * `ai_weight_pct`, because the split is applied when a score is READ, not when
 * it is stored. So a split-only save re-computed every stored total to exactly
 * the value it already had, and in doing so ran
 * `UPDATE decks SET ai_score = ?, signal = ?, updated_at = ?` over the entire
 * edition: it told the operator "N decks re-scored", bumped every deck's
 * `updated_at` — which the V3 Dashboard sorts by — and moved not one number.
 * That is a re-weight retro-touching a cohort, which the client ruled out:
 * *"previous cohorts will remain same"*.
 *
 * The scale and the formula stay: both genuinely change what is stored.
 */
function compositionChanged(before: ScoringSettings, after: ScoringSettings): boolean {
  return (
    before.scoreScale !== after.scoreScale || before.compositeFormula !== after.compositeFormula
  );
}

/**
 * The decks the **AI weight** control's before/after preview is drawn from
 * (V4-WEIGHT, item 3/4).
 *
 * The client's report was that changing the split showed him nothing. It was
 * never inert — the blend is applied at read time and `decisionScore` does move
 * — but the number it moves is not on the screen where the control lives, and
 * on real data the whole 0 %→50 % sweep is worth ~0.02–0.07. So the console
 * shows the movement itself, on real decks, as the select changes.
 *
 * Only decks whose split actually COMES from the organisation are eligible: a
 * deck in a programme or cohort that carries its own `ai_weight_pct` (0074) is
 * not moved by this control at all, and showing it here would be a lie. The
 * ones with the widest AI-vs-jury gap come first, because they are the decks
 * the setting moves MOST — the honest ceiling of the effect, not a flattering
 * sample. The raw halves go to the client, which blends them through the same
 * `decisionScore` every other screen uses.
 */
interface WeightPreviewRow {
  id: string;
  name: string;
  ai_score: number | null;
  human_avg: number | null;
}

const WEIGHT_PREVIEW_LIMIT = 5;

async function loadWeightPreview(db: D1Database, scope: TenantScope) {
  // Both halves read `decks`, which §2 B1 calls the highest-value data on the
  // platform, and the preview returns deck NAME plus raw `ai_score` plus the peer
  // `human_avg` — so an insufficient predicate here shows another customer's
  // startups and their scores on an admin's own Scoring framework screen. `decks`
  // carries `tenant_id` (0084). The `evaluations` sub-select stays keyed on
  // `e.deck_id = d.id`, which is the proxy path `TENANT_OWNER` names.
  const previewQ = scoped(scope)
    .on("d")
    .andRaw("d.ai_score IS NOT NULL AND pr.ai_weight_pct IS NULL AND co.ai_weight_pct IS NULL");
  const pinnedQ = scoped(scope)
    .on("d")
    .andRaw("COALESCE(co.ai_weight_pct, pr.ai_weight_pct) IS NOT NULL");
  const [rows, pinned] = await Promise.all([
    db
      .prepare(
        "SELECT id, name, ai_score, human_avg FROM (" +
          "SELECT d.id AS id, d.name AS name, d.ai_score AS ai_score, " +
          "(SELECT AVG(e.weighted_total) FROM evaluations e " +
          " WHERE e.deck_id = d.id AND e.evaluator_id IS NOT NULL) AS human_avg " +
          "FROM decks d " +
          "LEFT JOIN programs pr ON pr.id = d.program_id " +
          "LEFT JOIN cohorts  co ON co.id = d.cohort_id " +
          `${previewQ.whereClause()}` +
          ") WHERE human_avg IS NOT NULL " +
          "ORDER BY ABS(ai_score - human_avg) DESC, name LIMIT ?",
      )
      .bind(...previewQ.binds, WEIGHT_PREVIEW_LIMIT)
      .all<WeightPreviewRow>(),
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM decks d " +
          "LEFT JOIN programs pr ON pr.id = d.program_id " +
          "LEFT JOIN cohorts  co ON co.id = d.cohort_id " +
          `${pinnedQ.whereClause()}`,
      )
      .bind(...pinnedQ.binds)
      .first<{ n: number }>(),
  ]);
  return {
    decks: rows.results.map((r) => ({
      id: r.id,
      name: r.name,
      aiScore: r.ai_score,
      humanAverage: r.human_avg,
    })),
    // Decks this control cannot move, because their programme or cohort carries
    // its own split. The console says so rather than leaving them unexplained.
    pinnedDecks: pinned?.n ?? 0,
  };
}

/**
 * May the signed-in member change the **score-visibility matrix**?
 *
 * P0-2 (`docs/plan_roles_incubator.md` §5). The console drew the two grids for
 * the incubator superuser only (`admin/ScoringFramework.tsx`) while this route
 * accepted them from any console admin, in either edition — so an admin could
 * grant a program associate sight of program-manager scores through an API
 * whose console does not show them the grid, and a VC admin could move a matrix
 * no VC console draws at all. That is the repo's recurring role-boundary defect
 * in its WRITE form: the gate and the screen disagreeing about who may act.
 *
 * Decided Q-U (a) — **the admin keeps the capability and gains the grid**, not
 * the other way round. The role list below was written `"admin"` deliberately,
 * and the same role already administers the strictly more powerful Task
 * permissions grid through the same `requireTask("adminconsole", "admin")`
 * (`routes/permissions.ts`); taking a narrower permission system away from the
 * role that holds the wider one would be an inconsistency, not a hardening.
 * Q-U (b) is untouched: `admin` is a row/column in NEITHER matrix, which moves
 * migration 0072's persisted shape and belongs to Wave R+1 (§5 item 8 — Wave R
 * takes no migration). The console says so on the screen.
 *
 * The EDITION half stays exactly as the prototype set it — only
 * `AISJ_SuperuserV3` draws the cards, so only an incubator console may write
 * them. Both matrices are writable from there, because that one screen carries
 * both cards; the question is therefore about the VIEWER's edition, never the
 * cell's.
 *
 * This predicate is the only one. `GET /scoring` ships its answer as
 * `visibilityEditable` and the console renders the grids on that flag alone, so
 * the screen cannot drift from the route again — there is one rule and the
 * server owns it. It mirrors the PUT's gate exactly, permission cell included:
 * an administrator whose `adminconsole` cell has been closed is not shown a
 * grid their save would be refused for.
 */
async function canEditVisibility(c: Context<AppEnv>): Promise<boolean> {
  const { role, edition } = c.var.user;
  if (edition !== "incubator" || !isConfigAdmin(role)) return false;
  return await c.var.perms.can("adminconsole");
}

/** GET /api/config/scoring — the org's scoring framework (any authed staff). */
config.get("/scoring", async (c) => {
  const { role } = c.var.user;
  const scope = scopeOf(c.var.user);
  // A founder never scores and never reads a report; the framework tells them
  // nothing they should know about how their deck is judged internally.
  if (role === "founder") return c.json({ error: "forbidden" }, 403);
  const settings = await loadScoringSettings(c.env.DB, scope);
  const s = await loadSettings(c, scope);
  // V3 item 13 — both matrices, because the v3 superuser console's `s-fw`
  // draws `Visibility for Incubator` AND `Visibility for VC` side by side
  // regardless of which edition the viewer is in. They are RESOLVED, so the
  // console renders the state the report route actually enforces. Reading them
  // is safe for any staff role: a matrix says who may see whom, never a score.
  // V4 integration — the weight preview is ADMIN-ONLY, and the reason is a leak
  // it shipped with. It carries deck name + raw `ai_score` + the peer
  // `human_avg` for the five widest-gap decks, and this route is open to every
  // authed non-founder. Measured before the gate: a juror with BOTH toggles off
  // (`show_ai_score_to_jury = 0`, `jury_sees_peer_scores = 0`) read GreenRoute's
  // aiScore 7.2 and humanAverage 8.1 here, while `GET /api/decks`,
  // `GET /api/decks/:id` and the report route all correctly withheld them.
  // That is the two exact quantities those toggles exist to hide, and the
  // fourth instance of this class in the programme (grep plan_parity for
  // `issue 21`). The standard is decks.ts: withholding on one route only "does
  // not make scoring independent".
  //
  // Gating it costs nothing: the strip previews a control only an admin can
  // change (`editable: isConfigAdmin(role)` below), so nobody else has a use
  // for it.
  const canPreview = isConfigAdmin(role);
  // Both matrices, scoped by the viewer's TENANT and the matrix's own EDITION —
  // never by the viewer's edition, because this one screen draws both cards. The
  // edition here is the product variant picking which role list applies
  // (`VISIBILITY_ROLES`); the customer is `scope.tenantId`. `inEdition` is where
  // that judgement is written down.
  const [incubator, vc, weightPreview, visibilityEditable] = await Promise.all([
    loadScoreVisibility(c.env.DB, inEdition(scope, "incubator")),
    loadScoreVisibility(c.env.DB, inEdition(scope, "vc")),
    canPreview ? loadWeightPreview(c.env.DB, scope) : Promise.resolve(null),
    canEditVisibility(c),
  ]);
  return c.json({
    scoring: settings,
    visibility: { incubator, vc },
    // V4-WEIGHT — real decks for the AI-weight control's before/after strip.
    weightPreview,
    // The two cohort-rating thresholds live on org_settings and are rendered in
    // the same card (0026's header explains why they stay there).
    thresholdBest: s?.threshold_best ?? 7,
    thresholdMediocre: s?.threshold_mediocre ?? 5,
    editable: isConfigAdmin(role),
    // P0-2 — who may move the two `Score visibility matrix` cards, decided by
    // the server that enforces it. The console draws the grids on this and
    // nothing else, so "the API accepts it" and "the console shows it" are the
    // same sentence rather than two that drifted apart.
    visibilityEditable,
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
  /** 0082 — the AI screening gate. See the validation below for why it is separate. */
  aiGateThreshold: number;
  showThreeScoreView: boolean;
  showScoreDrift: boolean;
  includeAiEvidence: boolean;
  introCallAiPrompts: boolean;
  /** V3 item 13 — the two `Score visibility matrix` cards, saved with the rest. */
  visibility?: Partial<Record<Edition, VisibilityMatrix>>;
}

/**
 * The matrix cells this save changes, as `score_visibility` upserts.
 *
 * Only pairs the edition's own matrix DRAWS are written — a cell naming a role
 * outside `VISIBILITY_ROLES` (say `admin`, which neither matrix has) is dropped
 * rather than stored, so a crafted body can never grant visibility through a
 * row the console cannot show and an admin cannot therefore revoke.
 */
function visibilityWrites(
  c: Context<AppEnv>,
  scope: TenantScope,
  userId: string,
  submitted: ScoringFrameworkBody["visibility"],
): D1PreparedStatement[] {
  const out: D1PreparedStatement[] = [];
  if (!submitted || typeof submitted !== "object") return out;
  for (const edition of VISIBILITY_EDITIONS) {
    const matrix = submitted[edition];
    if (!matrix || typeof matrix !== "object") continue;
    const roles = VISIBILITY_ROLES[edition];
    for (const viewer of roles) {
      const row = matrix[viewer];
      if (!row || typeof row !== "object") continue;
      for (const target of roles) {
        const cell = row[target];
        if (typeof cell !== "boolean") continue;
        // ── ONE OF THE THREE `ON CONFLICT` SITES T1-CONFIG HOLDS ─────────────
        //
        // `0092` widened the primary key to `(tenant_id, edition, viewer_role,
        // target_role)`. SQLite requires a conflict target to match a uniqueness
        // constraint EXACTLY, so the old `ON CONFLICT (edition, viewer_role,
        // target_role)` resolved against the transitional unique index 0092 left
        // standing — and while it resolved there, a second customer's cell for the
        // same triple could not exist at all. Naming the widened key is what lets
        // integration drop that index (0101-0108).
        //
        // The EDITION bind is the loop's, not the caller's: this screen writes both
        // matrices. `insertScope` is not used here for the same reason — the pair
        // is `(scope.tenantId, edition)`, built per cell.
        out.push(
          c.env.DB.prepare(
            "INSERT INTO score_visibility (tenant_id, edition, viewer_role, target_role, visible, updated_at, updated_by) " +
              "VALUES (?, ?, ?, ?, ?, datetime('now'), ?) " +
              "ON CONFLICT (tenant_id, edition, viewer_role, target_role) DO UPDATE SET " +
              "visible = excluded.visible, updated_at = excluded.updated_at, updated_by = excluded.updated_by",
          ).bind(scope.tenantId, edition, viewer, target, cell ? 1 : 0, userId),
        );
      }
    }
  }
  return out;
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
  const { id: userId } = c.var.user;
  const scope = scopeOf(c.var.user);
  const before = await loadScoringSettings(c.env.DB, scope);
  const body = await readBody<ScoringFrameworkBody>(c);

  // P0-2 — the matrix half of this save carries its own gate, checked FIRST so
  // an unauthorised grid write is refused before anything is validated, let
  // alone written. The test is what the body would actually STORE, not whether
  // it carries a `visibility` key: the console posts `visibility: {}` on every
  // save it makes, and a body whose only cells name roles the matrix does not
  // draw (`admin`, `founder`) still writes nothing and is still dropped
  // silently — exactly as before — rather than turned into a 403 nobody caused.
  const visibilityStmts = visibilityWrites(c, scope, userId, body.visibility);
  if (visibilityStmts.length > 0 && !(await canEditVisibility(c))) {
    return c.json({ error: "forbidden" }, 403);
  }

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
  // 0082 — the AI SCREENING gate, validated separately from the shortlist floor
  // above it and refused with its own error code. They are two numbers on one
  // 0–10 scale that answer different questions ("does this deck stay in the
  // funnel?" vs "does this deck clear the bar?"), and a shared code would send
  // an admin who mistyped one to look at the other. The range mirrors the
  // column's own CHECK, so the route and the database agree.
  const aiGateThreshold = Number(body.aiGateThreshold ?? before.aiGateThreshold);
  if (!Number.isFinite(aiGateThreshold) || aiGateThreshold < 0 || aiGateThreshold > 10) {
    return c.json({ error: "invalid_ai_gate_threshold" }, 400);
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
    aiGateThreshold,
    showThreeScoreView: flag(body.showThreeScoreView, before.showThreeScoreView),
    showScoreDrift: flag(body.showScoreDrift, before.showScoreDrift),
    includeAiEvidence: flag(body.includeAiEvidence, before.includeAiEvidence),
    introCallAiPrompts: flag(body.introCallAiPrompts, before.introCallAiPrompts),
  };

  // V3 item 13 — read the matrices BEFORE the write so the audit log can name
  // the cells that actually moved rather than the ones that were submitted.
  const visibilityBefore = {
    incubator: await loadScoreVisibility(c.env.DB, inEdition(scope, "incubator")),
    vc: await loadScoreVisibility(c.env.DB, inEdition(scope, "vc")),
  };

  const recompute = compositionChanged(before, after);
  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare(
      "UPDATE org_scoring_settings SET ai_pre_scoring_enabled = ?, auto_clarification = ?, " +
        "show_ai_score_to_jury = ?, require_override_rationale = ?, override_rationale_delta = ?, " +
        "jury_sees_peer_scores = ?, score_scale = ?, composite_formula = ?, ai_weight_pct = ?, " +
        "shortlist_threshold = ?, ai_gate_threshold = ?, show_three_score_view = ?, show_score_drift = ?, " +
        "include_ai_evidence = ?, intro_call_ai_prompts = ?, updated_at = datetime('now'), " +
        `updated_by = ? ${scoped(scope).on("org_scoring_settings").whereClause()}`,
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
      after.aiGateThreshold,
      after.showThreeScoreView ? 1 : 0,
      after.showScoreDrift ? 1 : 0,
      after.includeAiEvidence ? 1 : 0,
      after.introCallAiPrompts ? 1 : 0,
      userId,
      scope.tenantId,
      scope.edition,
    ),
  ];
  if (recompute) stmts.push(bumpCriteriaVersion(c, scope));
  // V3 item 13 — the matrices ride the section's single Save (F0168): `s-fw`
  // has no save control of its own, so they commit in the SAME batch as the
  // toggles above them. Built above, where the gate that admits them is.
  stmts.push(...visibilityStmts);
  await c.env.DB.batch(stmts);

  await auditScoringFramework(c, before, after);

  const [incubator, vc] = await Promise.all([
    loadScoreVisibility(c.env.DB, inEdition(scope, "incubator")),
    loadScoreVisibility(c.env.DB, inEdition(scope, "vc")),
  ]);
  const visibilityAfter = { incubator, vc };
  const moved: VisibilityChange[] = [];
  for (const ed of VISIBILITY_EDITIONS) {
    for (const viewer of VISIBILITY_ROLES[ed]) {
      for (const target of VISIBILITY_ROLES[ed]) {
        const from = visibilityBefore[ed][viewer]?.[target] === true;
        const to = visibilityAfter[ed][viewer]?.[target] === true;
        if (from !== to) moved.push({ edition: ed, viewer, target, from, to });
      }
    }
  }
  await auditScoreVisibility(c, moved);

  const rescored = recompute ? await rescoreEdition(c.env, scope) : { decks: 0, evaluations: 0 };
  return c.json({ ok: true, scoring: after, visibility: { incubator, vc }, rescored });
});

// ── Cohort thresholds ────────────────────────────────────────────────────────

config.put("/thresholds", requireTask("adminconsole", "admin"), async (c) => {
  const scope = scopeOf(c.var.user);
  const body = await readBody<{ best: number; mediocre: number }>(c);
  const best = Number(body.best);
  const mediocre = Number(body.mediocre);
  if (![best, mediocre].every((n) => Number.isFinite(n) && n >= 0 && n <= 10)) {
    return c.json({ error: "invalid_threshold" }, 400);
  }
  if (best <= mediocre) return c.json({ error: "best_below_mediocre" }, 400);
  const previous = await loadSettings(c, scope);
  const q = scoped(scope).on("org_settings");
  await c.env.DB.prepare(
    `UPDATE org_settings SET threshold_best = ?, threshold_mediocre = ? ${q.whereClause()}`,
  )
    .bind(best, mediocre, ...q.binds)
    .run();
  await auditThresholds(
    c,
    { best: previous?.threshold_best ?? best, mediocre: previous?.threshold_mediocre ?? mediocre },
    { best, mediocre },
  );
  return c.json({ ok: true, thresholdBest: best, thresholdMediocre: mediocre });
});

// ── AI system prompt ─────────────────────────────────────────────────────────

config.put("/ai-prompt", requireTask("adminconsole", "admin"), async (c) => {
  const { edition } = c.var.user;
  const scope = scopeOf(c.var.user);
  const body = await readBody<{ prompt: string }>(c);
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const q = scoped(scope).on("org_settings");
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE org_settings SET ai_system_prompt = ? ${q.whereClause()}`).bind(
      prompt ? prompt : null,
      ...q.binds,
    ),
    // The prompt is part of the scoring criteria → allow a re-score.
    bumpCriteriaVersion(c, scope),
  ]);
  await auditConfig(
    c,
    "ai_prompt_updated",
    prompt ? "AI system prompt updated" : "AI system prompt cleared — the built-in default applies",
    { targetType: "org_settings", targetId: edition },
  );
  return c.json({ ok: true, aiSystemPrompt: prompt });
});

// ── Branding ─────────────────────────────────────────────────────────────────

config.put("/branding", requireTask("adminconsole", "admin"), async (c) => {
  const { edition } = c.var.user;
  const q = scoped(scopeOf(c.var.user)).on("org_settings");
  const body = await readBody<{ branding: Record<string, unknown> }>(c);
  const branding = body.branding && typeof body.branding === "object" ? body.branding : {};
  await c.env.DB.prepare(`UPDATE org_settings SET branding_json = ? ${q.whereClause()}`)
    .bind(JSON.stringify(branding), ...q.binds)
    .run();
  await auditConfig(c, "branding_updated", `Branding updated: ${Object.keys(branding).join(", ") || "cleared"}`, {
    targetType: "org_settings",
    targetId: edition,
    detail: branding,
  });
  return c.json({ ok: true, branding });
});

// ── Plan tier ────────────────────────────────────────────────────────────────

config.put("/plan", requireTask("upgrade", "admin"), async (c) => {
  const { edition } = c.var.user;
  const scope = scopeOf(c.var.user);
  const body = await readBody<{ plan: string }>(c);
  if (!isPlan(body.plan)) return c.json({ error: "invalid_plan" }, 400);
  const current = await loadSettings(c, scope);
  const q = scoped(scope).on("org_settings");
  await c.env.DB.prepare(`UPDATE org_settings SET plan = ? ${q.whereClause()}`)
    .bind(body.plan, ...q.binds)
    .run();
  if (current && current.plan !== body.plan) {
    await auditConfig(c, "plan_changed", `Plan changed from ${current.plan} to ${body.plan}`, {
      targetType: "org_settings",
      targetId: edition,
      detail: { from: current.plan, to: body.plan },
    });
  }
  const cap = await loadSeatCapability(c, scope);
  return c.json({
    ok: true,
    plan: body.plan,
    additionalEnabled: planAllowsAdditional(body.plan, cap.addl),
  });
});

// ── Admin-granted credits ────────────────────────────────────────────────────

config.post("/credits", requireTask("upgrade", "admin"), async (c) => {
  const scope = scopeOf(c.var.user);
  const body = await readBody<{ credits: number }>(c);
  const credits = Number(body.credits);
  if (!Number.isInteger(credits) || credits < 0) return c.json({ error: "invalid_credits" }, 400);
  const settings = await loadSettings(c, scope);
  const q = scoped(scope).on("org_settings");
  await c.env.DB.prepare(`UPDATE org_settings SET credits_balance = ? ${q.whereClause()}`)
    .bind(credits, ...q.binds)
    .run();
  // F0054 — the balance is a mutable integer; the ledger is what explains it.
  // An admin SET is recorded as the signed movement it actually performed.
  const delta = credits - (settings?.credits_balance ?? 0);
  if (delta !== 0) {
    await recordCreditMovement(c, {
      delta,
      reason: "adjustment",
      note: "Administrator adjustment",
      action: "credits_adjusted",
      summary: `Credit balance set to ${credits} by an administrator (${delta > 0 ? "+" : ""}${delta})`,
    });
  }
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
  const scope = scopeOf(c.var.user);
  const body = await readBody<{ credits: number }>(c);
  const credits = Number(body.credits);
  // A pack adds 1..1000 credits (1000 = the largest enterprise pack).
  if (!Number.isInteger(credits) || credits < 1 || credits > 1000) {
    return c.json({ error: "invalid_pack" }, 400);
  }
  // Atomic increment so a concurrent upload/reserve can't clobber the top-up.
  // §2 B9 lists "credit balance and credit purchase" among what `/api/config/*`
  // crosses, and this is the write half: unscoped, one customer's top-up credited
  // whichever `org_settings` row the edition matched first.
  const uq = scoped(scope).on("org_settings");
  await c.env.DB.prepare(
    `UPDATE org_settings SET credits_balance = credits_balance + ? ${uq.whereClause()}`,
  )
    .bind(credits, ...uq.binds)
    .run();
  const rq = scoped(scope).on("o");
  const row = await c.env.DB.prepare(
    `SELECT o.credits_balance FROM org_settings o ${rq.whereClause()}`,
  )
    .bind(...rq.binds)
    .first<{ credits_balance: number }>();
  // F0054 — "Purchased 50-credit pack · ₹20,000 · Transaction ID: RZP…" is made
  // of ledger columns, so the ledger row and the Billing audit row are written
  // together. The price comes from the master catalogue (0033); a pack size the
  // catalogue does not carry is still recorded, just without an amount.
  const pack = await packPriceMinor(c.env.DB, credits);
  const reference = `SIM${Date.now().toString(36).toUpperCase()}`;
  await recordCreditMovement(c, {
    delta: credits,
    reason: "purchase",
    amountMinor: pack?.amountMinor ?? null,
    currency: pack ? pack.currency : null,
    reference,
    note: pack?.name ?? `${credits}-unit pack`,
    action: "credits_purchased",
    summary:
      `Purchased ${pack?.name ?? `${credits}-credit pack`}` +
      (pack ? ` · ${money(pack.amountMinor, pack.currency)}` : "") +
      ` · Transaction ID: ${reference}`,
  });
  return c.json({ ok: true, purchased: credits, creditsBalance: row?.credits_balance ?? 0 });
});

export { config };
export default config;
