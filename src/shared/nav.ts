/**
 * Role-based navigation manifest — the single source of truth for which sidebar
 * items each role sees. Derived from the two Superuser mockups (feature supersets)
 * trimmed per the role×stage permission matrix and the pipeline role-gating in
 * `src/pipeline/*`. Superuser sees the full edition set (mirrors the superuser
 * bypass in `requireRole`); other internal roles are trimmed; founders get an
 * isolated portal.
 *
 * `id` doubles as the route slug (`/app/:id`) and mirrors the mockups' panel ids.
 */
import type { Edition, Role } from "./roles";

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
  /** Per-role label overrides (e.g. jury sees "My Pipeline" for All decks). */
  labelOverrides?: Partial<Record<Role, string>>;
  /** Portal items are shown ONLY to the listed roles (no superuser bypass). */
  portal?: "founder";
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
  { id: "upload", label: "Upload", icon: "Upload", section: "Evaluation", roles: ["admin", "program_manager", "program_associate"] },
  { id: "query", label: "Query", icon: "MessageSquare", section: "Evaluation", roles: ["admin", "program_manager", "program_associate"] },
  { id: "evaluate", label: "Evaluate", icon: "ClipboardCheck", section: "Evaluation", roles: ["admin", "program_manager", "program_associate"] },
  { id: "assign", label: "Assign", icon: "UserPlus", section: "Evaluation", roles: ["admin", "program_manager", "program_associate"] },
  { id: "jassigned", label: "Assigned", icon: "UserCheck", section: "Evaluation", roles: ["jury"] },
  {
    id: "jurypipeline",
    label: "Jury Pipeline",
    icon: "Gavel",
    section: "Evaluation",
    roles: ["admin", "jury"],
    labelOverrides: { jury: "Evaluated" },
  },
  {
    id: "introcalls",
    label: "Intro calls",
    icon: "Phone",
    section: "Evaluation",
    roles: ["admin", "program_associate", "jury"],
    labelOverrides: { jury: "My Intro calls" },
  },
  { id: "forsignup", label: "For Sign up", icon: "Send", section: "Evaluation", roles: ["admin", "program_associate"] },
  { id: "incuration", label: "Sign up Pipeline", icon: "GitBranch", section: "Evaluation", roles: ["admin", "program_associate"] },
  { id: "curation", label: "Onboard ready", icon: "CircleCheck", section: "Evaluation", roles: ["admin", "program_associate"] },
  {
    id: "archive",
    label: "Archive",
    icon: "Archive",
    section: "Evaluation",
    roles: ["admin", "program_manager", "program_associate", "jury"],
    labelOverrides: { jury: "My Archive" },
  },
  // Reports
  { id: "cohortsummary", label: "Cohort summary", icon: "ChartBar", section: "Reports", roles: ["admin", "program_manager", "program_associate"] },
  { id: "evaluatorscores", label: "Evaluator scores", icon: "Users", section: "Reports", roles: ["admin", "program_manager", "program_associate"] },
  { id: "scoredrift", label: "Score drift", icon: "TrendingUp", section: "Reports", roles: ["admin", "program_manager", "program_associate"] },
  { id: "funnel", label: "Pipeline funnel", icon: "Activity", section: "Reports", roles: ["admin", "program_manager", "program_associate"] },
  { id: "repdecks", label: "My decks summary", icon: "ChartBar", section: "Reports", roles: ["jury"] },
  { id: "repscores", label: "My scores", icon: "FileText", section: "Reports", roles: ["jury"] },
  { id: "repdrift", label: "My scores drift", icon: "TrendingUp", section: "Reports", roles: ["jury"] },
  // Settings
  { id: "coreparams", label: "Core Parameters", icon: "SlidersHorizontal", section: "Settings", roles: ["admin"] },
  { id: "myparams", label: "My Parameters", icon: "Sliders", section: "Settings", roles: ["admin", "program_manager", "program_associate", "jury"] },
  // Collaborate
  { id: "contactadmin", label: "Contact Admin", icon: "Mail", section: "Collaborate", roles: ["admin", "program_manager", "program_associate", "jury"] },
  { id: "contactteam", label: "Contact team", icon: "MessagesSquare", section: "Collaborate", roles: ["admin", "program_manager", "program_associate", "jury"] },
  // Support
  { id: "support", label: "Tickets", icon: "LifeBuoy", section: "Support", roles: ["admin"] },
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
  { id: "upload", label: "Upload", icon: "Upload", section: "Evaluation", roles: ["admin", "partner", "associate", "analyst"] },
  { id: "query", label: "Query", icon: "MessageSquare", section: "Evaluation", roles: ["admin", "associate", "analyst"] },
  { id: "evaluate", label: "Evaluate", icon: "ClipboardCheck", section: "Evaluation", roles: ["admin", "partner", "ic_member", "associate", "analyst"] },
  { id: "assign", label: "Submit", icon: "Send", section: "Evaluation", roles: ["admin", "associate", "analyst"] },
  { id: "jurypipeline", label: "Assoc. Pipeline", icon: "GitBranch", section: "Evaluation", roles: ["admin", "associate"] },
  { id: "introcalls", label: "Intro calls", icon: "Phone", section: "Evaluation", roles: ["admin", "partner"] },
  { id: "partnerpipeline", label: "Partner Pipeline", icon: "Users", section: "Evaluation", roles: ["admin", "partner", "ic_member"] },
  { id: "partnercall", label: "Partner call", icon: "PhoneCall", section: "Evaluation", roles: ["admin", "partner"] },
  // Due Diligence
  { id: "investmentdd", label: "Investment DD", icon: "FileCheck", section: "Due Diligence", roles: ["admin", "partner", "ic_member"] },
  { id: "icpipeline", label: "IC Pipeline", icon: "Vote", section: "Due Diligence", roles: ["admin", "ic_member"] },
  { id: "alignmentcall", label: "Alignment call", icon: "Handshake", section: "Due Diligence", roles: ["admin", "partner", "ic_member"] },
  { id: "incuration", label: "Term sheet Pipeline", icon: "FileText", section: "Due Diligence", roles: ["admin", "partner"] },
  { id: "legaldd", label: "Legal DD", icon: "Scale", section: "Due Diligence", roles: ["admin", "partner"] },
  {
    id: "curation",
    label: "Onboard ready",
    icon: "CircleCheck",
    section: "Due Diligence",
    roles: ["admin", "partner", "ic_member"],
    labelOverrides: { ic_member: "Invest ready" },
  },
  { id: "archive", label: "Archive", icon: "Archive", section: "Due Diligence", roles: ["admin", "partner", "ic_member", "associate", "analyst"] },
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
  // Collaborate
  { id: "contactadmin", label: "Contact Admin", icon: "Mail", section: "Collaborate", roles: ["admin", "partner", "ic_member", "associate", "analyst"] },
  { id: "contactteam", label: "Contact team", icon: "MessagesSquare", section: "Collaborate", roles: ["admin", "partner", "ic_member", "associate", "analyst"] },
  // Support
  { id: "support", label: "Tickets", icon: "LifeBuoy", section: "Support", roles: ["admin"] },
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

/** Whether a role may see a nav item (superuser bypass for non-portal items). */
export function canSeeNav(role: Role, item: NavItem): boolean {
  if (item.portal === "founder") return role === "founder";
  if (role === "superuser") return true;
  return item.roles.includes(role);
}

/** The label a given role sees for an item (applies per-role overrides). */
export function navLabel(role: Role, item: NavItem): string {
  return item.labelOverrides?.[role] ?? item.label;
}

/** All nav items visible to a (edition, role), in manifest order. */
export function navForUser(edition: Edition, role: Role): NavItem[] {
  return NAV_BY_EDITION[edition].filter((item) => canSeeNav(role, item));
}

/** Resolve a nav item by id within an edition (for route guards). */
export function navItemById(edition: Edition, id: string): NavItem | undefined {
  return NAV_BY_EDITION[edition].find((item) => item.id === id);
}

/** Whether a (edition, role) may access the route slug `id` (route guard). */
export function canAccessNav(edition: Edition, role: Role, id: string): boolean {
  const item = navItemById(edition, id);
  return item ? canSeeNav(role, item) : false;
}

/** The landing slug for a role (first visible nav item). */
export function landingNavId(edition: Edition, role: Role): string {
  return navForUser(edition, role)[0]?.id ?? "alldecks";
}

export { NAV_BY_EDITION };
