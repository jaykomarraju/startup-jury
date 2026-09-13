/**
 * W7-E — the Assign screen's arithmetic and copy (`AISJ_IC_SuserV15/_scripts.js`
 * renderAsDecks / renderAsRoles / renderAsUsers / renderAs4 / updateAsState).
 *
 * Kept free of Env so the server's bulk assignment and the client's summary card
 * compute the same cross product, the same deadline and the same load band, and
 * so all of it unit-tests at the node tier.
 */
import type { Edition, Role } from "./roles";
import { ROLE_LABELS } from "./roles";

/** "Deadline — 7 days from assignment date" (renderAs4) and "· deadline 7 days" (asShowResults). */
export const ASSIGNMENT_DEADLINE_DAYS = 7;

/** ISO due date for an assignment written at `assignedAt`. */
export function dueAtFrom(assignedAt: string, days = ASSIGNMENT_DEADLINE_DAYS): string {
  const t = new Date(assignedAt).getTime();
  return new Date(t + days * 86_400_000).toISOString();
}

/**
 * Panel 3's load-bar denominator when a user has no `evaluation_capacity` of
 * their own. The prototype's seed gives Program managers 10, Program associates
 * 8–12 and Jury members 6; the VC roles take the nearest incubator equivalent.
 * §8 records that these defaults are a reading, not a spec value.
 */
export const DEFAULT_EVALUATION_CAPACITY: Partial<Record<Role, number>> = {
  program_manager: 10,
  program_associate: 12,
  jury: 6,
  partner: 10,
  associate: 12,
  analyst: 12,
  ic_member: 6,
};

export function capacityFor(role: string, own?: number | null): number {
  if (typeof own === "number" && own > 0) return own;
  return DEFAULT_EVALUATION_CAPACITY[role as Role] ?? 10;
}

export type LoadBand = "high" | "mid" | "low";

/** renderAsUsers: red ≥ 80 %, amber ≥ 50 %, green below. */
export function loadBand(load: number, cap: number): LoadBand {
  const pct = cap > 0 ? Math.round((load / cap) * 100) : 100;
  if (pct >= 80) return "high";
  if (pct >= 50) return "mid";
  return "low";
}

/** Fill width of the load bar, clamped to the track. */
export function loadPercent(load: number, cap: number): number {
  if (cap <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((load / cap) * 100)));
}

/** asConfirm: every selected deck × every selected member. */
export function crossProduct<D, M>(decks: readonly D[], members: readonly M[]): { deck: D; member: M }[] {
  const out: { deck: D; member: M }[] = [];
  for (const deck of decks) for (const member of members) out.push({ deck, member });
  return out;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** updateAsState — the bottom bar's four sentences, verbatim. */
export function assignBottomSummary(nDecks: number, nMembers: number): string {
  if (nDecks > 0 && nMembers > 0) {
    return `${plural(nDecks, "deck")} → ${plural(nMembers, "jury member")} · click Confirm to assign.`;
  }
  if (nDecks > 0) return `${plural(nDecks, "deck")} selected — now pick one or more jury members.`;
  if (nMembers > 0) return `${plural(nMembers, "jury member")} selected — now select decks.`;
  return "Select decks and jury members to enable assignment.";
}

/** renderAs4's Scope row: "2 decks × 3 jury members = 6 evaluations". */
export function assignScope(nDecks: number, nMembers: number): string {
  return `${plural(nDecks, "deck")} × ${plural(nMembers, "jury member")} = ${plural(nDecks * nMembers, "evaluation")}`;
}

/** asShowResults' subtitle. */
export function assignResultsSubtitle(nDecks: number, nMembers: number): string {
  return (
    `${plural(nDecks, "deck")} assigned to ${plural(nMembers, "evaluator")} · ` +
    `evaluation report sent along · deadline ${ASSIGNMENT_DEADLINE_DAYS} days`
  );
}

/**
 * Column 2's order and copy. The prototype leads with Program manager (F0334);
 * the server keeps `ASSIGNABLE_EVALUATOR_ROLES`' order, which a worker test pins,
 * so the screen sorts for display.
 */
export const ASSIGN_ROLE_ORDER: Record<Edition, readonly Role[]> = {
  incubator: ["program_manager", "program_associate", "jury"],
  vc: ["partner", "associate", "analyst", "ic_member"],
};

/** renderAsUsers' sub-line: `role.desc + ' · N available'` (F0333). */
export const ASSIGN_ROLE_DESCRIPTIONS: Partial<Record<Role, string>> = {
  program_manager: "Programme oversight & decision",
  program_associate: "Screening, diligence & reports",
  jury: "Domain expert evaluators",
  partner: "Investment decision & oversight",
  associate: "Screening, diligence & reports",
  analyst: "Research & first-pass scoring",
  ic_member: "Investment committee evaluators",
};

export function sortAssignableRoles<T extends { role: string }>(edition: Edition, groups: readonly T[]): T[] {
  const order = ASSIGN_ROLE_ORDER[edition] as readonly string[];
  const rank = (r: string) => {
    const i = order.indexOf(r);
    return i < 0 ? order.length : i;
  };
  return [...groups].sort((a, b) => rank(a.role) - rank(b.role));
}

/**
 * The prototype writes role names in sentence case — "Program manager",
 * "Jury member" — where the app's label table is title case.
 */
export function assignRoleName(edition: Edition, role: string): string {
  const label = ROLE_LABELS[edition][role as Role] ?? role;
  const [first, ...rest] = label.split(" ");
  return [first, ...rest.map((w) => (/^[A-Z][a-z]/.test(w) ? w.toLowerCase() : w))].join(" ");
}

/** Column 3's heading: `role.name + 's'`. */
export function assignRoleHeading(edition: Edition, role: string): string {
  return `${assignRoleName(edition, role)}s`;
}

/** Column 3's sub-line. */
export function assignRoleSubline(role: string, available: number): string {
  const desc = ASSIGN_ROLE_DESCRIPTIONS[role as Role];
  return desc ? `${desc} · ${available} available` : `${available} available`;
}
