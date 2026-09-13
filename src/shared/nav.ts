/**
 * Role-based navigation manifest — the single source of truth for which sidebar
 * items each role sees. Derived from the two Superuser mockups (feature supersets)
 * trimmed per the role×stage permission matrix and the pipeline role-gating in
 * `src/pipeline/*`. Superuser sees the full edition set (mirrors the superuser
 * bypass in `requireRole`); other internal roles are trimmed; founders get an
 * isolated portal.
 *
 * `id` doubles as the route slug (`/app/:id`) and mirrors the mockups' panel ids.
 *
 * ── The runtime gate (W3-A) ────────────────────────────────────────────────
 * `roles` is the DEFAULT reachability — what the shipped product gives a role
 * before any administrator touches anything. `task` names the cell in the Admin
 * console's Task permissions grid (`role_permissions`, migration 0029) that can
 * take it away again. Every reader may pass a `PermissionLookup`; omit it and
 * the manifest behaves exactly as it always has, which is why every pure caller
 * (the parity harness, `test/unit/nav.test.ts`, the role matrix's declared
 * section) keeps working untouched.
 *
 * GATE, NOT GRANT (plan §8 Q8): a task can only REMOVE an item, never add one.
 * Opening a screen to a new role is therefore still an edit here — one entry in
 * `roles` — plus the matching cell in `DEFAULT_ROLE_PERMISSIONS`. The seed for a
 * nav-backed task is the union of the roles that reach its slugs, so the gate is
 * a no-op on the default seed by construction.
 */
import type { Edition, Role } from "./roles";
import type { PermissionLookup } from "./permissions";

export type NavSection =
  | "Workflows"
  | "Evaluation"
  | "Due Diligence"
  | "Reports"
  | "Settings"
  | "Collaborate"
  | "Support";

export interface NavItem {
  id: string;
  label: string;
  /** lucide-react icon name (resolved to a component in the Sidebar). */
  icon: string;
  section: NavSection;
  /** Non-superuser roles that see this item. Superuser always sees all (non-portal). */
  roles: Role[];
  /**
   * The `role_permissions` task that GATES this item (see the header). Omitted
   * where the prototype's grid names no task for the screen — `alldecks`,
   * `myparams`, `account`, the reports, Collaborate and Support have no cell,
   * so nothing can switch them off.
   */
  task?: string;
  /** Per-role label overrides (e.g. jury sees "My Pipeline" for All decks). */
  labelOverrides?: Partial<Record<Role, string>>;
  /** Portal items are shown ONLY to the listed roles (no superuser bypass). */
  portal?: "founder";
  /** Role-exclusive item: only listed roles see it, no superuser bypass
      (e.g. a jury member's personalized "My scores" reports). */
  exclusive?: boolean;
}

// ── Incubator ────────────────────────────────────────────────────────────────
const INCUBATOR_NAV: NavItem[] = [
  // Workflows
  {
    id: "alldecks",
    label: "All decks",
    icon: "Layers",
    section: "Workflows",
    roles: ["admin", "program_manager", "program_associate", "jury"],
    labelOverrides: { jury: "My Pipeline" },
  },
  // Evaluation
  { id: "upload", label: "Upload", icon: "Upload", section: "Evaluation", roles: ["admin", "program_manager", "program_associate"], task: "upload" },
  { id: "query", label: "Query", icon: "MessageSquare", section: "Evaluation", roles: ["admin", "program_manager", "program_associate"], task: "query" },
  { id: "evaluate", label: "Evaluate", icon: "ClipboardCheck", section: "Evaluation", roles: ["admin", "program_manager", "program_associate"], task: "evaluate" },
  { id: "assign", label: "Assign", icon: "UserPlus", section: "Evaluation", roles: ["admin", "program_manager", "program_associate"], task: "assign" },
  { id: "jassigned", label: "Assigned", icon: "UserCheck", section: "Evaluation", roles: ["jury"], task: "evaluate", exclusive: true },
  {
    // PM (decision maker) oversees jury shortlist/reject decisions here; jury sees
    // their own evaluated decks.
    id: "jurypipeline",
    label: "Jury Pipeline",
    icon: "Gavel",
    section: "Evaluation",
    roles: ["admin", "program_manager", "jury"],
    task: "jurypipeline",
    labelOverrides: { jury: "Evaluated" },
  },
  {
    // Aug-2026 issue 26 — the Program Manager's own decision surface, added
    // directly after Jury Pipeline. The jury scores; the PM (the decision maker
    // per §8) signs off here and sends the deck on to the intro call.
    id: "pmpipeline",
    label: "Prog manager pipeline",
    icon: "ClipboardList",
    section: "Evaluation",
    roles: ["admin", "program_manager"],
    task: "shortlistsignup",
  },
  {
    // The intro-call decision surface: shortlist routes to the PM, who schedules
    // (or delegates to the associate). Jury sees the calls they're on.
    id: "introcalls",
    label: "Intro calls",
    icon: "Phone",
    section: "Evaluation",
    roles: ["admin", "program_manager", "program_associate", "jury"],
    task: "introcall",
    labelOverrides: { jury: "My Intro calls" },
  },
  // §8 Q5 / F0919 / F0926 (settled by W3-A) — the PM prototype's Workflows list
  // carries both, and §1.4 makes the Program Manager the decision maker for the
  // programmes they lead; withholding the two post-intro-call stages left them
  // unable to see their own programme past the intro call. The ASSOCIATE stays
  // the executor — `send_signup` is still requireTask("signuppipeline",
  // "program_associate", "admin") and `performAction` still gates every
  // transition — so the PM gains oversight, not the associate's job.
  { id: "incuration", label: "Sign up Pipeline", icon: "GitBranch", section: "Evaluation", roles: ["admin", "program_manager", "program_associate"], task: "signuppipeline" },
  { id: "curation", label: "Onboard ready", icon: "CircleCheck", section: "Evaluation", roles: ["admin", "program_manager", "program_associate"], task: "onboard" },
  {
    id: "archive",
    label: "Archive",
    icon: "Archive",
    section: "Evaluation",
    roles: ["admin", "program_manager", "program_associate", "jury"],
    task: "archive",
    labelOverrides: { jury: "My Archive" },
  },
  // Reports
  { id: "cohortsummary", label: "Cohort summary", icon: "ChartBar", section: "Reports", roles: ["admin", "program_manager", "program_associate"] },
  { id: "evaluatorscores", label: "Evaluator scores", icon: "Users", section: "Reports", roles: ["admin", "program_manager", "program_associate"] },
  { id: "scoredrift", label: "Score drift", icon: "TrendingUp", section: "Reports", roles: ["admin", "program_manager", "program_associate"] },
  { id: "funnel", label: "Pipeline funnel", icon: "Activity", section: "Reports", roles: ["admin", "program_manager", "program_associate"] },
  { id: "repdecks", label: "My decks summary", icon: "ChartBar", section: "Reports", roles: ["jury"], exclusive: true },
  { id: "repscores", label: "My Scores", icon: "FileText", section: "Reports", roles: ["jury"], exclusive: true },
  { id: "repdrift", label: "My scores drift", icon: "TrendingUp", section: "Reports", roles: ["jury"], exclusive: true },
  // Settings
  { id: "coreparams", label: "Core Parameters", icon: "SlidersHorizontal", section: "Settings", roles: ["admin"] },
  { id: "myparams", label: "My Parameters", icon: "Sliders", section: "Settings", roles: ["admin", "program_manager", "program_associate", "jury"] },
  // PM manages cohorts for programs they lead; PA sees Set up read-only (Standard seat).
  { id: "setup", label: "Set up", icon: "Wrench", section: "Settings", roles: ["admin", "program_manager", "program_associate"] },
  { id: "account", label: "My account", icon: "UserCog", section: "Settings", roles: ["admin", "program_manager", "program_associate", "jury"] },
  { id: "admin", label: "Admin console", icon: "Building2", section: "Settings", roles: ["admin"], task: "adminconsole" },
  { id: "billing", label: "Buy credits", icon: "CreditCard", section: "Settings", roles: ["admin"], task: "upgrade" },
  // Collaborate
  { id: "contactadmin", label: "Contact Admin", icon: "Mail", section: "Collaborate", roles: ["admin", "program_manager", "program_associate", "jury"] },
  { id: "contactteam", label: "Contact team", icon: "MessagesSquare", section: "Collaborate", roles: ["admin", "program_manager", "program_associate", "jury"] },
  // Support
  { id: "support", label: "Tickets", icon: "LifeBuoy", section: "Support", roles: ["admin"] },
  // The team's internal testing/bug log (Session 7). Every internal role can
  // file; triage is admin-only on the server.
  { id: "issues", label: "Issue log", icon: "Bug", section: "Support", roles: ["admin", "program_manager", "program_associate", "jury"] },
  // Founder portal (isolated)
  { id: "founder-home", label: "My Startup", icon: "LayoutDashboard", section: "Workflows", roles: ["founder"], portal: "founder" },
  { id: "founder-upload", label: "Upload Deck", icon: "Upload", section: "Workflows", roles: ["founder"], portal: "founder" },
  { id: "founder-queries", label: "Queries", icon: "MessageSquare", section: "Workflows", roles: ["founder"], portal: "founder" },
  { id: "founder-signup", label: "Sign up", icon: "CircleCheck", section: "Workflows", roles: ["founder"], portal: "founder" },
];

// ── VC ───────────────────────────────────────────────────────────────────────
const VC_NAV: NavItem[] = [
  // Workflows
  { id: "alldecks", label: "All decks", icon: "Layers", section: "Workflows", roles: ["admin", "partner", "ic_member", "associate", "analyst"] },
  // Evaluation
  { id: "upload", label: "Upload", icon: "Upload", section: "Evaluation", roles: ["admin", "partner", "associate", "analyst"], task: "upload" },
  { id: "query", label: "Query", icon: "MessageSquare", section: "Evaluation", roles: ["admin", "associate", "analyst"], task: "query" },
  { id: "evaluate", label: "Evaluate", icon: "ClipboardCheck", section: "Evaluation", roles: ["admin", "partner", "ic_member", "associate", "analyst"], task: "evaluate" },
  { id: "assign", label: "Submit", icon: "Send", section: "Evaluation", roles: ["admin", "associate", "analyst"], task: "assign" },
  { id: "jurypipeline", label: "Assoc. Pipeline", icon: "GitBranch", section: "Evaluation", roles: ["admin", "associate"], task: "assocpipeline" },
  {
    // §8: the **investment associate** schedules the VC intro call; the partner
    // may add one. Analysts and IC members are read-only — the screen shows them
    // only the calls they are a participant on.
    id: "introcalls",
    label: "Intro calls",
    icon: "Phone",
    section: "Evaluation",
    roles: ["admin", "partner", "associate", "analyst", "ic_member"],
    task: "introcall",
    labelOverrides: { analyst: "My Intro calls", ic_member: "My Intro calls" },
  },
  { id: "partnerpipeline", label: "Partner Pipeline", icon: "Users", section: "Evaluation", roles: ["admin", "partner", "ic_member"], task: "partnerpipeline" },
  { id: "partnercall", label: "Partner call", icon: "PhoneCall", section: "Evaluation", roles: ["admin", "partner"] },
  // Due Diligence
  { id: "investmentdd", label: "Investment DD", icon: "FileCheck", section: "Due Diligence", roles: ["admin", "partner", "ic_member"], task: "openchecklist" },
  // F0917 (settled by W3-A) — an internal contradiction, not a prototype wish:
  // `IcVotePage.canVote` and `POST /api/decks/:id/ic-vote` have both admitted the
  // partner since Phase 1 (the roles harness asserts it), while the nav refused
  // them the screen the vote is cast on. The nav was the wrong half.
  { id: "icpipeline", label: "IC Pipeline", icon: "Vote", section: "Due Diligence", roles: ["admin", "partner", "ic_member"], task: "icpipeline" },
  { id: "alignmentcall", label: "Alignment call", icon: "Handshake", section: "Due Diligence", roles: ["admin", "partner", "ic_member"] },
  { id: "incuration", label: "Term sheet Pipeline", icon: "FileText", section: "Due Diligence", roles: ["admin", "partner"], task: "signup" },
  { id: "legaldd", label: "Legal DD", icon: "Scale", section: "Due Diligence", roles: ["admin", "partner"], task: "openchecklist" },
  {
    id: "curation",
    label: "Onboard ready",
    icon: "CircleCheck",
    section: "Due Diligence",
    roles: ["admin", "partner", "ic_member"],
    task: "onboard",
    labelOverrides: { ic_member: "Invest ready" },
  },
  { id: "archive", label: "Archive", icon: "Archive", section: "Due Diligence", roles: ["admin", "partner", "ic_member", "associate", "analyst"], task: "archive" },
  // Reports
  { id: "funnel", label: "Pipeline Funnel", icon: "Activity", section: "Reports", roles: ["admin", "partner", "associate"] },
  { id: "capital", label: "Capital Deployment & Pacing", icon: "Landmark", section: "Reports", roles: ["admin", "partner", "ic_member", "associate"] },
  { id: "portfolio", label: "Portfolio Construction", icon: "PieChart", section: "Reports", roles: ["admin", "partner", "ic_member", "associate"] },
  { id: "scoring", label: "Scoring Summary", icon: "ChartBar", section: "Reports", roles: ["admin", "partner", "ic_member", "associate", "analyst"] },
  { id: "diligence", label: "Diligence & Risk Status", icon: "ShieldAlert", section: "Reports", roles: ["admin", "partner", "ic_member", "associate"] },
  { id: "decisions", label: "Decision History", icon: "History", section: "Reports", roles: ["admin", "partner", "ic_member", "associate"] },
  // Settings
  { id: "coreparams", label: "Core Parameters", icon: "SlidersHorizontal", section: "Settings", roles: ["admin"] },
  { id: "myparams", label: "My Parameters", icon: "Sliders", section: "Settings", roles: ["admin", "partner", "ic_member", "associate", "analyst"] },
  { id: "setup", label: "Set up", icon: "Wrench", section: "Settings", roles: ["admin"] },
  { id: "account", label: "My account", icon: "UserCog", section: "Settings", roles: ["admin", "partner", "ic_member", "associate", "analyst"] },
  { id: "admin", label: "Admin console", icon: "Building2", section: "Settings", roles: ["admin"], task: "adminconsole" },
  { id: "billing", label: "Buy credits", icon: "CreditCard", section: "Settings", roles: ["admin"], task: "upgrade" },
  // Collaborate
  { id: "contactadmin", label: "Contact Admin", icon: "Mail", section: "Collaborate", roles: ["admin", "partner", "ic_member", "associate", "analyst"] },
  { id: "contactteam", label: "Contact team", icon: "MessagesSquare", section: "Collaborate", roles: ["admin", "partner", "ic_member", "associate", "analyst"] },
  // Support
  { id: "support", label: "Tickets", icon: "LifeBuoy", section: "Support", roles: ["admin"] },
  { id: "issues", label: "Issue log", icon: "Bug", section: "Support", roles: ["admin", "partner", "ic_member", "associate", "analyst"] },
];

const NAV_BY_EDITION: Record<Edition, NavItem[]> = {
  incubator: INCUBATOR_NAV,
  vc: VC_NAV,
};

/** Fixed section order used to group the sidebar. */
export const NAV_SECTIONS: NavSection[] = [
  "Workflows",
  "Evaluation",
  "Due Diligence",
  "Reports",
  "Settings",
  "Collaborate",
  "Support",
];

/**
 * Whether a role may see a nav item (superuser bypass for non-portal items).
 *
 * `can` is the runtime permission lookup (`src/shared/permissions.ts`). Omit it
 * and this is the pure, shipped-default manifest it has always been; pass it and
 * the item's `task` cell may take the item away. GATE, NOT GRANT — the check is
 * ANDed onto the role rule, never substituted for it.
 */
export function canSeeNav(role: Role, item: NavItem, can?: PermissionLookup): boolean {
  if (item.portal === "founder") return role === "founder";
  const byRole = item.exclusive
    ? item.roles.includes(role) // no superuser bypass
    : role === "superuser" || item.roles.includes(role);
  if (!byRole) return false;
  if (item.task && can && !can(item.task)) return false;
  return true;
}

/** The label a given role sees for an item (applies per-role overrides). */
export function navLabel(role: Role, item: NavItem): string {
  return item.labelOverrides?.[role] ?? item.label;
}

/** All nav items visible to a (edition, role), in manifest order. */
export function navForUser(edition: Edition, role: Role, can?: PermissionLookup): NavItem[] {
  return NAV_BY_EDITION[edition].filter((item) => canSeeNav(role, item, can));
}

/** Resolve a nav item by id within an edition (for route guards). */
export function navItemById(edition: Edition, id: string): NavItem | undefined {
  return NAV_BY_EDITION[edition].find((item) => item.id === id);
}

/** Whether a (edition, role) may access the route slug `id` (route guard). */
export function canAccessNav(edition: Edition, role: Role, id: string, can?: PermissionLookup): boolean {
  const item = navItemById(edition, id);
  return item ? canSeeNav(role, item, can) : false;
}

/** The landing slug for a role (first visible nav item). */
export function landingNavId(edition: Edition, role: Role, can?: PermissionLookup): string {
  return navForUser(edition, role, can)[0]?.id ?? "alldecks";
}

export { NAV_BY_EDITION };
