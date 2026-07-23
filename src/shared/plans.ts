/**
 * Plan tiers shared by client and server. The tier gates whether a role may
 * configure the additional / informational evaluation parameters on top of the
 * 13 core weighted areas (Standard = core only; Pro/Premium unlock the extras).
 */
export type Plan = "standard" | "pro" | "premium";

export const PLANS: readonly Plan[] = ["standard", "pro", "premium"];

export const PLAN_LABELS: Record<Plan, string> = {
  standard: "Standard",
  pro: "Pro",
  premium: "Premium",
};

const PLAN_RANK: Record<Plan, number> = { standard: 0, pro: 1, premium: 2 };

/** Additional / informational parameters require Pro or above. */
export function planAllowsAdditional(plan: Plan): boolean {
  return PLAN_RANK[plan] >= PLAN_RANK.pro;
}

export function isPlan(v: unknown): v is Plan {
  return typeof v === "string" && (PLANS as readonly string[]).includes(v);
}
