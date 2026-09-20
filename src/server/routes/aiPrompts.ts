/**
 * V3-AW — **AI prompts per evaluation area** (item 11) and **Seat
 * configurability** (item 12), both from section `s-wt` of the v3 superuser
 * prototype's base64 admin console.
 *
 * Its own router rather than an append to `src/server/routes/config.ts`
 * because nine V3 sessions land in parallel and `config.ts` is the file three
 * of them would otherwise all edit. Folding it back in is a later tidy-up, not
 * a behaviour change (§9) — the same reasoning `scoringApi.ts` records.
 *
 * ## Why a write route at all, when `parameters.prompt` already has two
 *
 * `PUT /api/config/parameters` accepts a core prompt and `PUT /api/anchors/:id`
 * accepts any parameter's. Both are fine writers; neither can RESTORE, because
 * until migration 0071 nothing held the shipped text. So what is genuinely new
 * here is the default: `prompt_default` is written once by the migration and
 * never by a route, which is what makes `Restore default` and the two
 * `Restore all …` buttons mean something. A single small router owning the
 * prompt's whole lifecycle — read it, write it, put it back — is easier to
 * reason about than three half-writers.
 *
 * ## The seat gate is enforced HERE, not by hiding a button
 *
 * The grid says which seat TIER may configure which parameter set. A Standard
 * seat has never been able to open Area weights, but "cannot see the button"
 * is not a permission, and the console is reachable by URL. Every write below
 * therefore re-derives the caller's effective tier from the database and
 * answers `402 plan_required` — the code the rest of the config surface
 * already uses for this — before it looks at the body. `test/worker/aiPrompts.test.ts`
 * asserts the 402 on the WRITE, and asserts it flips when the grid is flipped.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../types";
import type { Edition } from "../../shared/roles";
import { isMentor } from "../../shared/roles";
import { PLANS, isPlan, planAllowsAdditional, planAllowsCore, type Plan } from "../../shared/plans";
import {
  PARAM_SETS,
  defaultSeatCapability,
  isParamSet,
  type ParamSet,
  type SeatCapability,
} from "../../shared/aiPrompts";
import { requireAuth, requireTask } from "../auth/middleware";
import { auditConfig } from "../audit/events";

const aiPrompts = new Hono<AppEnv>();
aiPrompts.use("*", requireAuth);

interface PromptRow {
  id: string;
  key: string;
  name: string;
  informational: number;
  role_scope: string | null;
  prompt: string | null;
  prompt_default: string | null;
  sort_order: number;
}

export interface PromptView {
  id: string;
  key: string;
  name: string;
  /** False for one of the 13 weighted core areas. */
  informational: boolean;
  roleScope: string | null;
  /** The live text the AI is given. Null when the area has no guidance. */
  prompt: string | null;
  /** The shipped text `Restore default` puts back. Null when none was seeded. */
  promptDefault: string | null;
  /** Nothing to restore: the live text already equals the shipped one. */
  isDefault: boolean;
}

function toView(p: PromptRow): PromptView {
  return {
    id: p.id,
    key: p.key,
    name: p.name,
    informational: p.informational === 1,
    roleScope: p.role_scope,
    prompt: p.prompt,
    promptDefault: p.prompt_default,
    isDefault: (p.prompt ?? null) === (p.prompt_default ?? null),
  };
}

const SELECT_PARAMS =
  "SELECT id, key, name, informational, role_scope, prompt, prompt_default, sort_order " +
  "FROM parameters WHERE edition = ? AND active = 1 AND retired = 0 ORDER BY sort_order";

async function loadParams(c: Context<AppEnv>, edition: Edition): Promise<PromptRow[]> {
  return (await c.env.DB.prepare(SELECT_PARAMS).bind(edition).all<PromptRow>()).results;
}

// ── The seat-configurability grid ────────────────────────────────────────────

/**
 * The org's grid, falling back to the shipped defaults for any cell 0071 did
 * not seed. The fallback matters on a database migrated out of order or
 * restored from a partial dump: a missing row must mean "as it has always
 * behaved", never "nobody may configure anything".
 */
export async function loadSeatCapability(
  c: Context<AppEnv>,
  edition: Edition,
): Promise<SeatCapability> {
  const cap = defaultSeatCapability();
  const rows = (
    await c.env.DB.prepare(
      "SELECT param_set, tier, allowed FROM seat_capabilities WHERE edition = ?",
    )
      .bind(edition)
      .all<{ param_set: string; tier: string; allowed: number }>()
  ).results;
  for (const r of rows) {
    if (isParamSet(r.param_set) && isPlan(r.tier)) cap[r.param_set][r.tier] = r.allowed === 1;
  }
  return cap;
}

/**
 * The caller's effective tier: the lower of their own seat and the org's plan,
 * exactly as `memberPlan` in `config.ts` computes it. Duplicated rather than
 * exported across the two routers because `config.ts` belongs to three V3
 * sessions this wave and a new export from it is a merge conflict for all of
 * them; §9 records the fold-back.
 */
async function effectiveTier(c: Context<AppEnv>, edition: Edition): Promise<Plan> {
  const org = await c.env.DB.prepare("SELECT plan FROM org_settings WHERE edition = ?")
    .bind(edition)
    .first<{ plan: string }>();
  const member = await c.env.DB.prepare("SELECT plan_tier FROM users WHERE id = ?")
    .bind(c.var.user.id)
    .first<{ plan_tier: string | null }>();
  const orgPlan: Plan = isPlan(org?.plan) ? org.plan : "standard";
  const seat: Plan = isPlan(member?.plan_tier) ? member.plan_tier : "standard";
  return PLANS[Math.min(PLANS.indexOf(seat), PLANS.indexOf(orgPlan))];
}

/** Whether the caller's seat may edit prompts in `set`, per the org's grid. */
async function mayConfigure(
  c: Context<AppEnv>,
  edition: Edition,
  set: ParamSet,
): Promise<{ allowed: boolean; tier: Plan }> {
  const tier = await effectiveTier(c, edition);
  const cap = await loadSeatCapability(c, edition);
  const allowed =
    set === "core" ? planAllowsCore(tier, cap.core) : planAllowsAdditional(tier, cap.addl);
  return { allowed, tier };
}

/** Core areas are the weighted 13; everything informational is `addl`. */
function setOf(p: PromptRow): ParamSet {
  return p.informational === 1 ? "addl" : "core";
}

// ── Reads ────────────────────────────────────────────────────────────────────

/**
 * GET /api/ai-prompts — every parameter's live and shipped prompt, plus the grid
 * and what this caller may do with it.
 *
 * Readable by any authenticated staff member (not a founder, not a mentor) for
 * the same reason `GET /api/config/parameters` is: a juror who cannot edit a
 * prompt may still need to read what the AI was asked. Editing is gated below.
 */
aiPrompts.get("/", async (c) => {
  const { edition, role } = c.var.user;
  if (role === "founder" || isMentor(role)) return c.json({ error: "forbidden" }, 403);
  const [params, capability, tier] = await Promise.all([
    loadParams(c, edition),
    loadSeatCapability(c, edition),
    effectiveTier(c, edition),
  ]);
  return c.json({
    params: params.map(toView),
    capability,
    /** The caller's own effective seat tier — what the 402s below are about. */
    tier,
    coreEditable: planAllowsCore(tier, capability.core),
    additionalEditable: planAllowsAdditional(tier, capability.addl),
  });
});

// ── Writes ───────────────────────────────────────────────────────────────────

async function findParam(c: Context<AppEnv>, id: string): Promise<PromptRow | null> {
  return c.env.DB.prepare(
    SELECT_PARAMS.replace("WHERE edition = ?", "WHERE edition = ? AND id = ?").replace(
      " ORDER BY sort_order",
      "",
    ),
  )
    .bind(c.var.user.edition, id)
    .first<PromptRow>();
}

/**
 * A stored prompt. Trimmed, and an empty string becomes NULL — a blank prompt
 * means "no guidance", which `evaluate.ts` falls back from, not an empty
 * `Guidance:` line in the rubric it sends the model.
 */
function normalise(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

/**
 * Persist `prompt` and bump `criteria_version`, because the prompt is part of
 * what a score was produced against: every other writer of the rubric
 * (`PUT /api/config/parameters`, `PUT /api/anchors/:id`) bumps it, and a
 * prompt edit that did not would leave decks looking freshly scored against a
 * rubric they never saw.
 */
async function writePrompt(
  c: Context<AppEnv>,
  param: PromptRow,
  prompt: string | null,
  summary: string,
  action: string,
): Promise<void> {
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE parameters SET prompt = ? WHERE id = ?").bind(prompt, param.id),
    c.env.DB.prepare(
      "UPDATE org_settings SET criteria_version = criteria_version + 1 WHERE edition = ?",
    ).bind(c.var.user.edition),
  ]);
  await auditConfig(c, action, summary, { targetType: "parameter", targetId: param.id });
}

/** PUT /api/ai-prompts/params/:id — the row editor's Save. */
aiPrompts.put("/params/:id", requireTask("adminconsole", "admin"), async (c) => {
  const param = await findParam(c, c.req.param("id"));
  if (!param) return c.json({ error: "not_found" }, 404);

  const set = setOf(param);
  const { allowed, tier } = await mayConfigure(c, c.var.user.edition, set);
  if (!allowed) return c.json({ error: "plan_required", set, tier }, 402);

  const body = (await c.req.json().catch(() => ({}))) as { prompt?: unknown };
  const prompt = normalise(body.prompt);
  if (prompt === param.prompt) return c.json({ ok: true, param: toView(param) });

  await writePrompt(
    c,
    param,
    prompt,
    `AI guidance prompt updated for ${param.name}`,
    "ai_prompt_updated",
  );
  return c.json({ ok: true, param: toView({ ...param, prompt }) });
});

/** POST /api/ai-prompts/params/:id/restore — the row editor's `Restore default`. */
aiPrompts.post("/params/:id/restore", requireTask("adminconsole", "admin"), async (c) => {
  const param = await findParam(c, c.req.param("id"));
  if (!param) return c.json({ error: "not_found" }, 404);

  const set = setOf(param);
  const { allowed, tier } = await mayConfigure(c, c.var.user.edition, set);
  if (!allowed) return c.json({ error: "plan_required", set, tier }, 402);

  const restored = param.prompt_default;
  if (restored === param.prompt) return c.json({ ok: true, param: toView(param) });

  await writePrompt(
    c,
    param,
    restored,
    `AI guidance prompt restored to the shipped default for ${param.name}`,
    "ai_prompt_restored",
  );
  return c.json({ ok: true, param: toView({ ...param, prompt: restored }) });
});

/**
 * POST /api/ai-prompts/restore-all — `Restore all core AI prompts` and
 * `Restore all additional-parameter prompts`.
 *
 * One `set` per call, because the prototype has one button per set and because
 * the two are separately gated: a Pro seat may restore the core prompts and
 * must not be able to restore the additional ones in the same request.
 */
aiPrompts.post("/restore-all", requireTask("adminconsole", "admin"), async (c) => {
  const edition = c.var.user.edition;
  const body = (await c.req.json().catch(() => ({}))) as { set?: unknown };
  if (!isParamSet(body.set)) return c.json({ error: "invalid_set", sets: PARAM_SETS }, 400);
  const set = body.set;

  const { allowed, tier } = await mayConfigure(c, edition, set);
  if (!allowed) return c.json({ error: "plan_required", set, tier }, 402);

  const params = (await loadParams(c, edition)).filter((p) => setOf(p) === set);
  const changed = params.filter((p) => (p.prompt ?? null) !== (p.prompt_default ?? null));
  if (changed.length > 0) {
    await c.env.DB.batch([
      ...changed.map((p) =>
        c.env.DB.prepare("UPDATE parameters SET prompt = ? WHERE id = ?").bind(
          p.prompt_default,
          p.id,
        ),
      ),
      c.env.DB.prepare(
        "UPDATE org_settings SET criteria_version = criteria_version + 1 WHERE edition = ?",
      ).bind(edition),
    ]);
    await auditConfig(
      c,
      "ai_prompts_restored",
      `${changed.length} ${set === "core" ? "core" : "additional-parameter"} AI prompt` +
        `${changed.length === 1 ? "" : "s"} restored to the shipped defaults`,
      { targetType: "parameter" },
    );
  }
  return c.json({
    ok: true,
    set,
    restored: changed.length,
    params: params.map((p) => toView({ ...p, prompt: p.prompt_default })),
  });
});

/**
 * PUT /api/ai-prompts/capability — one cell of the Seat-configurability grid.
 *
 * Admin + superuser only, and deliberately NOT gated on the grid itself: the
 * grid is what decides who may configure, so gating it on its own value is how
 * an org locks itself out of its own settings.
 */
aiPrompts.put("/capability", requireTask("adminconsole", "admin"), async (c) => {
  const edition = c.var.user.edition;
  const body = (await c.req.json().catch(() => ({}))) as {
    set?: unknown;
    tier?: unknown;
    allowed?: unknown;
  };
  if (!isParamSet(body.set)) return c.json({ error: "invalid_set", sets: PARAM_SETS }, 400);
  if (!isPlan(body.tier)) return c.json({ error: "invalid_tier", tiers: PLANS }, 400);
  if (typeof body.allowed !== "boolean") return c.json({ error: "invalid_allowed" }, 400);
  const { set, tier, allowed } = body;

  await c.env.DB.prepare(
    "INSERT INTO seat_capabilities (edition, param_set, tier, allowed) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT (edition, param_set, tier) DO UPDATE SET allowed = excluded.allowed",
  )
    .bind(edition, set, tier, allowed ? 1 : 0)
    .run();

  await auditConfig(
    c,
    "seat_capability_updated",
    `${tier} seats ${allowed ? "may now" : "may no longer"} configure the ` +
      `${set === "core" ? "core" : "additional"} parameters`,
  );
  return c.json({ ok: true, capability: await loadSeatCapability(c, edition) });
});

export default aiPrompts;
