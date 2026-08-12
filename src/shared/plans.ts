/**
 * Plan tiers shared by client and server. The tier gates how much of the
 * evaluation rubric a role may configure (per the prototype's PLAN_META):
 *   • Standard — no parameter configuration at all.
 *   • Pro      — configure the 13 core weighted areas (weights + names).
 *   • Premium  — everything in Pro PLUS the 3 role-scoped additional params.
 */
export type Plan = "standard" | "pro" | "premium";

export const PLANS: readonly Plan[] = ["standard", "pro", "premium"];

export const PLAN_LABELS: Record<Plan, string> = {
  standard: "Standard",
  pro: "Pro",
  premium: "Premium",
};

/** One-line privilege summary per tier (matches the prototype's PLAN_PRIV). */
export const PLAN_PRIVILEGES: Record<Plan, string> = {
  standard: "Cannot configure evaluation parameters.",
  pro: "Can configure the 13 core parameters.",
  premium: "Can configure all 13 core parameters plus 3 additional parameters.",
};

const PLAN_RANK: Record<Plan, number> = { standard: 0, pro: 1, premium: 2 };

/** Configuring the 13 core weighted areas requires Pro or above. */
export function planAllowsCore(plan: Plan): boolean {
  return PLAN_RANK[plan] >= PLAN_RANK.pro;
}

/** The role-scoped additional / informational parameters require Premium. */
export function planAllowsAdditional(plan: Plan): boolean {
  return PLAN_RANK[plan] >= PLAN_RANK.premium;
}

export function isPlan(v: unknown): v is Plan {
  return typeof v === "string" && (PLANS as readonly string[]).includes(v);
}
