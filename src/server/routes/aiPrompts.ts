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
import { insertScope, scopeOf, scoped, type TenantScope } from "../../shared/tenant";
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

/**
 * ── TENANCY, AND WHY `SELECT_PARAMS` IS NO LONGER A STRING TO PATCH ─────────
 *
 * `findParam` used to build its statement by `String.replace`-ing this constant's
 * `WHERE edition = ?` clause. That worked exactly as long as the predicate was one
 * token wide; a workspace key is two, and a predicate assembled by search and
 * replace is the shape that silently drops a half. Both readers now take the
 * builder's clause instead, so the column list and the predicate are separate
 * things and neither is edited by rewriting the other's text.
 */
const SELECT_PARAM_COLUMNS =
  "SELECT p.id, p.key, p.name, p.informational, p.role_scope, p.prompt, p.prompt_default, " +
  "p.sort_order FROM parameters p ";

async function loadParams(c: Context<AppEnv>, scope: TenantScope): Promise<PromptRow[]> {
  const q = scoped(scope).on("p").andRaw("p.active = 1 AND p.retired = 0");
  return (
    await c.env.DB.prepare(`${SELECT_PARAM_COLUMNS}${q.whereClause()} ORDER BY p.sort_order`)
      .bind(...q.binds)
      .all<PromptRow>()
  ).results;
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
  scope: TenantScope,
): Promise<SeatCapability> {
  // `0093` widened the key to `(tenant_id, edition, param_set, tier)`. The
  // fallback below is what makes an insufficient predicate dangerous rather than
  // merely wrong: a missing row means "as it has always behaved", so reading
  // ANOTHER customer's grid produces a plausible answer and no error — and the
  // answer decides whether this caller may configure the rubric at all.
  const cap = defaultSeatCapability();
  const q = scoped(scope).on("sc");
  const rows = (
    await c.env.DB.prepare(
      `SELECT sc.param_set, sc.tier, sc.allowed FROM seat_capabilities sc ${q.whereClause()}`,
    )
      .bind(...q.binds)
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
async function effectiveTier(c: Context<AppEnv>, scope: TenantScope): Promise<Plan> {
  const oq = scoped(scope).on("o");
  const org = await c.env.DB.prepare(`SELECT o.plan FROM org_settings o ${oq.whereClause()}`)
    .bind(...oq.binds)
    .first<{ plan: string }>();
  const uq = scoped(scope).on("u").and("u.id = ?", c.var.user.id);
  const member = await c.env.DB.prepare(`SELECT u.plan_tier FROM users u ${uq.whereClause()}`)
    .bind(...uq.binds)
    .first<{ plan_tier: string | null }>();
  const orgPlan: Plan = isPlan(org?.plan) ? org.plan : "standard";
  const seat: Plan = isPlan(member?.plan_tier) ? member.plan_tier : "standard";
  return PLANS[Math.min(PLANS.indexOf(seat), PLANS.indexOf(orgPlan))];
}

/** Whether the caller's seat may edit prompts in `set`, per the org's grid. */
async function mayConfigure(
  c: Context<AppEnv>,
  scope: TenantScope,
  set: ParamSet,
): Promise<{ allowed: boolean; tier: Plan }> {
  const tier = await effectiveTier(c, scope);
  const cap = await loadSeatCapability(c, scope);
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
  const { role } = c.var.user;
  const scope = scopeOf(c.var.user);
  if (role === "founder" || isMentor(role)) return c.json({ error: "forbidden" }, 403);
  const [params, capability, tier] = await Promise.all([
    loadParams(c, scope),
    loadSeatCapability(c, scope),
    effectiveTier(c, scope),
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
  const q = scoped(scopeOf(c.var.user))
    .on("p")
    .and("p.id = ?", id)
    .andRaw("p.active = 1 AND p.retired = 0");
  return c.env.DB.prepare(`${SELECT_PARAM_COLUMNS}${q.whereClause()}`)
    .bind(...q.binds)
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
  const scope = scopeOf(c.var.user);
  const pq = scoped(scope).on("parameters").and("id = ?", param.id);
  const oq = scoped(scope).on("org_settings");
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE parameters SET prompt = ? ${pq.whereClause()}`).bind(
      prompt,
      ...pq.binds,
    ),
    c.env.DB.prepare(
      `UPDATE org_settings SET criteria_version = criteria_version + 1 ${oq.whereClause()}`,
    ).bind(...oq.binds),
  ]);
  await auditConfig(c, action, summary, { targetType: "parameter", targetId: param.id });
}

/** PUT /api/ai-prompts/params/:id — the row editor's Save. */
aiPrompts.put("/params/:id", requireTask("adminconsole", "admin"), async (c) => {
  const param = await findParam(c, c.req.param("id"));
  if (!param) return c.json({ error: "not_found" }, 404);

  const set = setOf(param);
  const { allowed, tier } = await mayConfigure(c, scopeOf(c.var.user), set);
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
  const { allowed, tier } = await mayConfigure(c, scopeOf(c.var.user), set);
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
  const scope = scopeOf(c.var.user);
  const body = (await c.req.json().catch(() => ({}))) as { set?: unknown };
  if (!isParamSet(body.set)) return c.json({ error: "invalid_set", sets: PARAM_SETS }, 400);
  const set = body.set;

  const { allowed, tier } = await mayConfigure(c, scope, set);
  if (!allowed) return c.json({ error: "plan_required", set, tier }, 402);

  const params = (await loadParams(c, scope)).filter((p) => setOf(p) === set);
  const changed = params.filter((p) => (p.prompt ?? null) !== (p.prompt_default ?? null));
  if (changed.length > 0) {
    const oq = scoped(scope).on("org_settings");
    await c.env.DB.batch([
      ...changed.map((p) => {
        const pq = scoped(scope).on("parameters").and("id = ?", p.id);
        return c.env.DB.prepare(`UPDATE parameters SET prompt = ? ${pq.whereClause()}`).bind(
          p.prompt_default,
          ...pq.binds,
        );
      }),
      c.env.DB.prepare(
        `UPDATE org_settings SET criteria_version = criteria_version + 1 ${oq.whereClause()}`,
      ).bind(...oq.binds),
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
  const scope = scopeOf(c.var.user);
  const body = (await c.req.json().catch(() => ({}))) as {
    set?: unknown;
    tier?: unknown;
    allowed?: unknown;
  };
  if (!isParamSet(body.set)) return c.json({ error: "invalid_set", sets: PARAM_SETS }, 400);
  if (!isPlan(body.tier)) return c.json({ error: "invalid_tier", tiers: PLANS }, 400);
  if (typeof body.allowed !== "boolean") return c.json({ error: "invalid_allowed" }, 400);
  const { set, tier, allowed } = body;

  // ── ONE OF THE THREE `ON CONFLICT` SITES T1-CONFIG HOLDS ──────────────────
  //
  // `0093` widened the key to `(tenant_id, edition, param_set, tier)`, and a
  // conflict target must match a uniqueness constraint EXACTLY — so the old
  // three-column target resolved against the transitional unique index 0093 left
  // standing, and while it did, no second customer could own a grid cell at all.
  // Naming the widened key is what lets integration drop that index (0101-0108).
  //
  // `insertScope` rather than two hand-written binds, because this is a write to
  // the table that decides WHO MAY CONFIGURE: `tenant_id` carries
  // `DEFAULT 't_default'`, so a forgotten bind would not fail — it would hand the
  // first customer's grid a cell set by the second, with a 200 and nothing to see.
  const t = insertScope(scope);
  await c.env.DB.prepare(
    `INSERT INTO seat_capabilities (${t.columns}, param_set, tier, allowed) ` +
      `VALUES (${t.placeholders}, ?, ?, ?) ` +
      "ON CONFLICT (tenant_id, edition, param_set, tier) DO UPDATE SET allowed = excluded.allowed",
  )
    .bind(...t.binds, set, tier, allowed ? 1 : 0)
    .run();

  await auditConfig(
    c,
    "seat_capability_updated",
    `${tier} seats ${allowed ? "may now" : "may no longer"} configure the ` +
      `${set === "core" ? "core" : "additional"} parameters`,
  );
  return c.json({ ok: true, capability: await loadSeatCapability(c, scope) });
});

export default aiPrompts;
