/**
 * Roles and editions shared by client and server. Both product editions run on
 * one platform; a user's `role` is scoped to one edition. Founders are external
 * actors (incubator side) who upload and respond to queries.
 */

export type Edition = "incubator" | "vc";

export const INCUBATOR_ROLES = [
  "superuser",
  "admin",
  "program_manager",
  "program_associate",
  "jury",
  "founder",
] as const;

export const VC_ROLES = [
  "superuser", // Managing Partner
  "admin",
  "partner",
  "ic_member",
  "associate",
  "analyst",
] as const;

export type IncubatorRole = (typeof INCUBATOR_ROLES)[number];
export type VcRole = (typeof VC_ROLES)[number];
export type Role = IncubatorRole | VcRole;

export const ROLES_BY_EDITION: Record<Edition, readonly Role[]> = {
  incubator: INCUBATOR_ROLES,
  vc: VC_ROLES,
};

/** Human-readable role labels (edition-aware where they differ). */
export const ROLE_LABELS: Record<Edition, Partial<Record<Role, string>>> = {
  incubator: {
    superuser: "Super User",
    admin: "Admin",
    program_manager: "Program Manager",
    program_associate: "Program Associate",
    jury: "Jury Member",
    founder: "Founder",
  },
  vc: {
    superuser: "Managing Partner",
    admin: "Admin",
    partner: "Partner",
    ic_member: "IC Member",
    associate: "Investment Associate",
    analyst: "Analyst",
  },
};

/**
 * Roles that own role-scoped ADDITIONAL evaluation parameters (up to 3 each) on
 * top of the 13 core areas → 13 + 3×3 = 22 params per edition. Reconciled from
 * the Jul-24 transcript (incubator) and the VC Superuser prototype's editable
 * role tabs (the Investment Associate — an analyst with configurable params — is
 * the owner, not the plain analyst).
 */
export const ADDITIONAL_PARAM_OWNERS: Record<Edition, readonly Role[]> = {
  incubator: ["program_associate", "program_manager", "jury"],
  vc: ["associate", "partner", "ic_member"],
};

/** Maximum additional parameters a single owner role may define. */
export const MAX_ADDITIONAL_PER_ROLE = 3;

export function isAdditionalParamOwner(edition: Edition, role: Role): boolean {
  return (ADDITIONAL_PARAM_OWNERS[edition] as readonly string[]).includes(role);
}

/**
 * Scheduled calls (Session 7). The three kinds are exactly the ones §8 named as
 * in scope for the ICS invite: intro, partner and alignment.
 */
export const CALL_KINDS = ["intro", "partner", "alignment"] as const;
export type CallKind = (typeof CALL_KINDS)[number];

export const CALL_KIND_LABELS: Record<CallKind, string> = {
  intro: "Intro call",
  partner: "Partner call",
  alignment: "Alignment call",
};

/** Which call kinds each edition actually runs. */
export const CALL_KINDS_BY_EDITION: Record<Edition, readonly CallKind[]> = {
  // The incubator flow has one founder-facing call: the post-shortlist intro.
  incubator: ["intro"],
  vc: ["intro", "partner", "alignment"],
};

/**
 * Roles that may schedule / reschedule / cancel a call and invite participants.
 *
 * Incubator (§8): the **program manager** is the decision maker who schedules
 * the intro call, or delegates it to the **program associate** (the frontline
 * executor). VC (§8): the **investment associate** schedules the intro call and
 * the **partner** owns the partner and alignment calls.
 *
 * Everyone else — jury, IC members, analysts — is read-only and sees only the
 * calls they are a participant on.
 */
export const CALL_SCHEDULER_ROLES: Record<Edition, readonly Role[]> = {
  incubator: ["superuser", "admin", "program_manager", "program_associate"],
  vc: ["superuser", "admin", "partner", "associate"],
};

export function canScheduleCalls(edition: Edition, role: Role): boolean {
  return (CALL_SCHEDULER_ROLES[edition] as readonly string[]).includes(role);
}

export function isCallKind(value: unknown): value is CallKind {
  return typeof value === "string" && (CALL_KINDS as readonly string[]).includes(value);
}

/**
 * Roles a deck may be ASSIGNED to for evaluation (Aug-2026 issue 22 — the Assign
 * screen's four panels: decks → role → members → confirm). These are exactly the
 * roles that carry their own additional parameters and score decks in the
 * workbench, so an assignment always lands on someone who can actually evaluate.
 */
export const ASSIGNABLE_EVALUATOR_ROLES: Record<Edition, readonly Role[]> = {
  incubator: ["jury", "program_manager", "program_associate"],
  vc: ["analyst", "associate", "partner", "ic_member"],
};

export function isAssignableEvaluator(edition: Edition, role: string): boolean {
  return (ASSIGNABLE_EVALUATOR_ROLES[edition] as readonly string[]).includes(role);
}

/**
 * Evaluation HIERARCHY rank (Aug-2026 issue 21).
 *
 * "The evaluators up the journey from Prog associate to jury to Prog manager can
 * view the scores given by the evaluators lower in the hierarchy, but lower guys
 * must not be able to view the evaluators' scores up in the hierarchy."
 *
 * A viewer sees the AI column plus every human evaluator whose rank is <= their
 * own. Admin / superuser oversee the whole workspace and see all of it. Roles
 * absent from the map (founder, mentor) have rank 0 and see only the AI column —
 * they never reach this surface anyway.
 *
 * The VC ladder is the same idea along its own pipeline: analyst scoring →
 * associate review → partner review → investment committee.
 */
export const EVALUATION_RANK: Record<Edition, Partial<Record<Role, number>>> = {
  incubator: {
    program_associate: 1,
    jury: 2,
    program_manager: 3,
    admin: 99,
    superuser: 99,
  },
  vc: {
    analyst: 1,
    associate: 2,
    partner: 3,
    ic_member: 4,
    admin: 99,
    superuser: 99,
  },
};

export function evaluationRank(edition: Edition, role: Role): number {
  return EVALUATION_RANK[edition][role] ?? 0;
}

/** May `viewer` see the scores an evaluator holding `target` submitted? */
export function canSeeEvaluatorScores(edition: Edition, viewer: Role, target: Role): boolean {
  if (viewer === target) return true;
  return evaluationRank(edition, viewer) >= evaluationRank(edition, target);
}

export const EDITION_LABELS: Record<Edition, string> = {
  incubator: "Incubator",
  vc: "Venture Capital",
};

export function editionLabel(edition: Edition): string {
  return EDITION_LABELS[edition];
}

export function isRoleInEdition(role: Role, edition: Edition): boolean {
  return (ROLES_BY_EDITION[edition] as readonly string[]).includes(role);
}

/**
 * Roles an admin/superuser may CREATE via user management (the Admin console).
 * Excludes `superuser` (one owner per account) and `founder` (founders are
 * external self-registrants, not staff created by an admin). Shared by the
 * `POST /api/users` validation and the client create-user dropdown so they agree.
 */
export function creatableStaffRoles(edition: Edition): Role[] {
  return ROLES_BY_EDITION[edition].filter((r) => r !== "superuser" && r !== "founder");
}

export function roleLabel(edition: Edition, role: Role): string {
  return ROLE_LABELS[edition][role] ?? role;
}
