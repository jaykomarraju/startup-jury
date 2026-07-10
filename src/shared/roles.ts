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

export function roleLabel(edition: Edition, role: Role): string {
  return ROLE_LABELS[edition][role] ?? role;
}
