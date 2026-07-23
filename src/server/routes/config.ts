// Phase 6 — Config, plans & credits. Admin-gated editors for the rubric (core
// parameter weights + additional/informational params), cohort thresholds, the
// AI system prompt, branding, plan tier, and admin-granted credits. A weight
// change re-scores the edition (see config/rescore.ts). A safe read subset is
// exposed to every authed user (dashboard thresholds rail + My Parameters view);
// the full settings (AI prompt, credits balance) are admin-only.

import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../types";
import type { Edition } from "../../shared/roles";
import { planAllowsAdditional, isPlan, type Plan } from "../../shared/plans";
import { requireAuth, requireRole } from "../auth/middleware";
import { rescoreEdition } from "../config/rescore";

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
  sort_order: number;
}

async function readBody<T>(c: Context<AppEnv>): Promise<Partial<T>> {
  return (await c.req.json().catch(() => ({}))) as Partial<T>;
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
      "SELECT id, key, name, weight, informational, role_scope, sort_order FROM parameters WHERE edition = ? AND active = 1 ORDER BY sort_order",
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
    additionalEnabled: planAllowsAdditional(s.plan),
    thresholdBest: s.threshold_best,
    thresholdMediocre: s.threshold_mediocre,
    branding: parseBranding(s.branding_json),
    coreParams: params.filter((p) => p.informational === 0).map(toParamView),
    additionalParams: params.filter((p) => p.informational === 1).map(toParamView),
  });
});

/** GET /api/config — the full settings (admin only): adds the AI system prompt
 *  and the credits balance to the summary payload. */
config.get("/", requireRole("admin"), async (c) => {
  const edition = c.var.user.edition;
  const s = await loadSettings(c, edition);
  if (!s) return c.json({ error: "not_found" }, 404);
  const params = await loadParams(c, edition);
  return c.json({
    plan: s.plan,
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
  const body = await readBody<{ params: WeightUpdate[] }>(c);
  const updates = Array.isArray(body.params) ? body.params : [];
  if (updates.length === 0) return c.json({ error: "no_params" }, 400);

  const existing = await loadParams(c, edition);
  const byId = new Map(existing.map((p) => [p.id, p]));

  const stmts: D1PreparedStatement[] = [];
  for (const u of updates) {
    const p = byId.get(u.id);
    // Only weighted (core) params are edited here; informational ones are
    // managed via the additional-params endpoints.
    if (!p || p.informational === 1) return c.json({ error: "invalid_param" }, 400);
    const weight = Number(u.weight);
    if (!Number.isFinite(weight) || weight < 0 || weight > 100) {
      return c.json({ error: "invalid_weight" }, 400);
    }
    const name = typeof u.name === "string" && u.name.trim() ? u.name.trim() : p.name;
    stmts.push(
      c.env.DB.prepare("UPDATE parameters SET weight = ?, name = ? WHERE id = ?").bind(weight, name, u.id),
    );
  }
  await c.env.DB.batch(stmts);

  const rescored = await rescoreEdition(c.env, edition);
  const params = await loadParams(c, edition);
  return c.json({
    ok: true,
    rescored,
    coreParams: params.filter((p) => p.informational === 0).map(toParamView),
  });
});

// ── Additional / informational parameters (plan-gated) ───────────────────────

/** POST /api/config/additional-params — add an informational parameter. Requires
 *  a Pro+ plan (the plan gate); weighted extras are still allowed via `weight`. */
config.post("/additional-params", requireRole("admin"), async (c) => {
  const edition = c.var.user.edition;
  const s = await loadSettings(c, edition);
  if (!s) return c.json({ error: "not_found" }, 404);
  if (!planAllowsAdditional(s.plan)) return c.json({ error: "plan_required" }, 402);

  const body = await readBody<{ name: string; weight?: number; informational?: boolean }>(c);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return c.json({ error: "name_required" }, 400);
  const informational = body.informational === false ? 0 : 1;
  const weight = informational === 1 ? 0 : Math.max(0, Math.min(100, Number(body.weight) || 0));

  const suffix = crypto.randomUUID().slice(0, 8);
  const id = `${edition}_add_${suffix}`;
  const key = `add_${suffix}`;
  const nextOrder = await c.env.DB.prepare(
    "SELECT COALESCE(MAX(sort_order), 100) + 1 AS n FROM parameters WHERE edition = ?",
  )
    .bind(edition)
    .first<{ n: number }>();
  await c.env.DB.prepare(
    "INSERT INTO parameters (id, edition, key, name, weight, informational, role_scope, sort_order, active) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 1)",
  )
    .bind(id, edition, key, name, weight, informational, nextOrder?.n ?? 101)
    .run();

  // A weighted extra changes the denominator — re-score to keep totals honest.
  if (informational === 0) await rescoreEdition(c.env, edition);
  return c.json({ ok: true, param: { id, key, name, weight, informational: informational === 1 } });
});

/** DELETE /api/config/additional-params/:id — retire an informational param
 *  (soft delete: active=0, so historical scores stay referenced). */
config.delete("/additional-params/:id", requireRole("admin"), async (c) => {
  const edition = c.var.user.edition;
  const id = c.req.param("id");
  const p = await c.env.DB.prepare(
    "SELECT informational FROM parameters WHERE id = ? AND edition = ? AND active = 1",
  )
    .bind(id, edition)
    .first<{ informational: number }>();
  if (!p) return c.json({ error: "not_found" }, 404);
  if (p.informational !== 1) return c.json({ error: "core_param" }, 400); // never delete a core area
  await c.env.DB.prepare("UPDATE parameters SET active = 0 WHERE id = ?").bind(id).run();
  await rescoreEdition(c.env, edition);
  return c.json({ ok: true });
});

// ── Cohort thresholds ────────────────────────────────────────────────────────

config.put("/thresholds", requireRole("admin"), async (c) => {
  const edition = c.var.user.edition;
  const body = await readBody<{ best: number; mediocre: number }>(c);
  const best = Number(body.best);
  const mediocre = Number(body.mediocre);
  if (![best, mediocre].every((n) => Number.isFinite(n) && n >= 0 && n <= 10)) {
    return c.json({ error: "invalid_threshold" }, 400);
  }
  if (best < mediocre) return c.json({ error: "best_below_mediocre" }, 400);
  await c.env.DB.prepare(
    "UPDATE org_settings SET threshold_best = ?, threshold_mediocre = ? WHERE edition = ?",
  )
    .bind(best, mediocre, edition)
    .run();
  return c.json({ ok: true, thresholdBest: best, thresholdMediocre: mediocre });
});

// ── AI system prompt ─────────────────────────────────────────────────────────

config.put("/ai-prompt", requireRole("admin"), async (c) => {
  const edition = c.var.user.edition;
  const body = await readBody<{ prompt: string }>(c);
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  await c.env.DB.prepare("UPDATE org_settings SET ai_system_prompt = ? WHERE edition = ?")
    .bind(prompt ? prompt : null, edition)
    .run();
  return c.json({ ok: true, aiSystemPrompt: prompt });
});

// ── Branding ─────────────────────────────────────────────────────────────────

config.put("/branding", requireRole("admin"), async (c) => {
  const edition = c.var.user.edition;
  const body = await readBody<{ branding: Record<string, unknown> }>(c);
  const branding = body.branding && typeof body.branding === "object" ? body.branding : {};
  await c.env.DB.prepare("UPDATE org_settings SET branding_json = ? WHERE edition = ?")
    .bind(JSON.stringify(branding), edition)
    .run();
  return c.json({ ok: true, branding });
});

// ── Plan tier ────────────────────────────────────────────────────────────────

config.put("/plan", requireRole("admin"), async (c) => {
  const edition = c.var.user.edition;
  const body = await readBody<{ plan: string }>(c);
  if (!isPlan(body.plan)) return c.json({ error: "invalid_plan" }, 400);
  await c.env.DB.prepare("UPDATE org_settings SET plan = ? WHERE edition = ?")
    .bind(body.plan, edition)
    .run();
  return c.json({ ok: true, plan: body.plan, additionalEnabled: planAllowsAdditional(body.plan) });
});

// ── Admin-granted credits ────────────────────────────────────────────────────

config.post("/credits", requireRole("admin"), async (c) => {
  const edition = c.var.user.edition;
  const body = await readBody<{ credits: number }>(c);
  const credits = Number(body.credits);
  if (!Number.isInteger(credits) || credits < 0) return c.json({ error: "invalid_credits" }, 400);
  await c.env.DB.prepare("UPDATE org_settings SET credits_balance = ? WHERE edition = ?")
    .bind(credits, edition)
    .run();
  return c.json({ ok: true, creditsBalance: credits });
});

export { config };
export default config;
