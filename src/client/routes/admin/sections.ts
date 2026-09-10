/**
 * The Admin console's section registry — the shape of the console itself.
 *
 * The prototype's console is a separate ~170 KB document base64-encoded into
 * `var ADMIN_B64` and opened by `openAdmin()`, which is why no panel-id survey
 * ever found it. Its structure lives in two lines of `admin/_scripts.js`:
 *
 *   var secs = ['fw','wt','rb','qb','tm','crm','bl','pc',
 *               'sudocs','suagr','susign','suseat','nt','al','uc','br'];
 *   var lbls = { fw:'Scoring framework', … };
 *
 * — sixteen sections in four labelled groups (Evaluation · Organisation ·
 * Sign-up · System). The VC build (`AISJ_VC_Superuser_V8`, `AISJ_VC_Admin_V4`)
 * is identical except that the fourth Sign-up section is `sufund`
 * "Fund Deployment" in place of the incubator's `suseat` "Seat capacity", so
 * the registry is resolved per edition.
 *
 * Wave 1 builds the shell; each section's body lands in Waves 2–5. Every
 * section therefore carries a `placeholder` that NAMES what will fill it and
 * which session owns it — the slot those sessions land in.
 */
import type { Edition, Role } from "../../../shared/roles";

export type AdminSectionGroup = "Evaluation" | "Organisation" | "Sign-up" | "System";

/** Fixed rail order, top to bottom (prototype `_ADMIN-CONSOLE.html` sidebar). */
export const ADMIN_SECTION_GROUPS: AdminSectionGroup[] = [
  "Evaluation",
  "Organisation",
  "Sign-up",
  "System",
];

export interface AdminSection {
  /** Prototype section id — also the `?section=` query value. */
  id: string;
  /** Rail + title-bar label (prototype `lbls`). */
  label: string;
  group: AdminSectionGroup;
  /** lucide-react icon name, resolved in AdminConsole.tsx. */
  icon: string;
  /** The section body's own heading (prototype `.sec-title`). */
  heading: string;
  /** The section body's explanatory line (prototype `.sec-sub`). */
  subtitle: string;
  /** What lands here, and who lands it. Rendered by the placeholder. */
  placeholder: {
    /** The session that replaces this placeholder (plan_parity.md §6). */
    owner: string;
    /** The concrete things that section will contain. */
    contents: string[];
  };
}

/**
 * Sections in the Sign-up group configure org-wide commercial and legal
 * settings (required documents, agreement templates, signatories, seats /
 * fund deployment). They stay admin + superuser only even if console
 * reachability widens — F0038 proposes opening `nt` and `al` to every internal
 * role, and this list is what keeps that from carrying the Sign-up group with
 * it.
 */
const ADMIN_ONLY_GROUPS: AdminSectionGroup[] = ["Sign-up"];

/** Roles that may open the console at all (superuser is the implicit bypass). */
export function canOpenAdminConsole(role: Role): boolean {
  return role === "admin" || role === "superuser";
}

/** Whether a role may see a given group in the rail. */
export function canSeeAdminGroup(role: Role, group: AdminSectionGroup): boolean {
  if (ADMIN_ONLY_GROUPS.includes(group)) return canOpenAdminConsole(role);
  return true;
}

const EVALUATION: AdminSection[] = [
  {
    id: "fw",
    label: "Scoring framework",
    group: "Evaluation",
    icon: "SlidersHorizontal",
    heading: "Scoring framework",
    subtitle:
      "Control how AI and jury scores are computed, displayed, and weighted across the platform.",
    placeholder: {
      owner: "W2-A",
      contents: [
        "Five AI-engine toggles — pre-scoring, auto-clarification, show AI score before scoring, override rationale, jury peer visibility",
        "Five transparency and report toggles",
        "Score scale, composite formula and the AI / jury weight split",
        "Organisation-wide shortlist threshold",
      ],
    },
  },
  {
    id: "wt",
    label: "Area weights",
    group: "Evaluation",
    icon: "ChartBar",
    heading: "Area weights",
    subtitle:
      "Set the percentage weight of each of the 13 evaluation areas in the final composite score. Total must equal 100%.",
    placeholder: {
      owner: "W2-A",
      contents: [
        "Per-area weight bars with a live 100 % total",
        "Permit-configuration control per role",
      ],
    },
  },
  {
    id: "rb",
    label: "Rubric anchors",
    group: "Evaluation",
    icon: "ListChecks",
    heading: "Rubric anchors",
    subtitle:
      "For each area or parameter, write an AI guidance prompt (what the AI should look for) and define what each score band means on the five-band scale (0–2 · 3–4 · 5–6 · 7–8 · 9–10).",
    placeholder: {
      owner: "W2-B",
      contents: [
        "22 areas (13 core + 9 role) × 5 band anchors, editable, 65 pre-seeded",
        "A per-area AI guidance prompt, with save and revert",
      ],
    },
  },
  {
    id: "qb",
    label: "Question bank",
    group: "Evaluation",
    icon: "CircleHelp",
    heading: "Clarification question bank",
    subtitle:
      "These questions are auto-triggered to the startup when the AI detects weak, missing, or contradictory signal in a given area. Edit or add questions per area.",
    placeholder: {
      owner: "W2-C",
      contents: [
        "68 curated clarification questions across 13 areas, as a per-area accordion",
        "Add, edit, delete and reorder, wired into clarification generation",
      ],
    },
  },
];

const ORGANISATION: AdminSection[] = [
  {
    id: "tm",
    label: "Team & roles",
    group: "Organisation",
    icon: "Users",
    heading: "Team & roles",
    subtitle:
      "Choose your workspace type, then manage users and roles for that organisation. Pending invites shown in red.",
    placeholder: {
      owner: "W4-A",
      contents: [
        "Workspace-type switch — Incubator / Accelerator vs Investor",
        "Member roster with the full invite lifecycle (pending, resend, cancel)",
        "The task-permission matrix — 21 × 5 incubator, 24 × 6 VC",
        "Super User nomination and ownership transfer",
      ],
    },
  },
  {
    id: "crm",
    label: "CRM sync",
    group: "Organisation",
    icon: "RefreshCw",
    heading: "CRM sync",
    subtitle:
      "Connect your CRM to automatically pull pitchdecks when deals match your configured filter rules.",
    placeholder: {
      owner: "W3-D",
      contents: [
        "Provider selection and connection settings",
        "Field mapping, sync direction and schedule",
        "A provider-stubbed connector that records rather than calls out",
      ],
    },
  },
  {
    id: "bl",
    label: "Credits & billing",
    group: "Organisation",
    icon: "Coins",
    heading: "Credits & billing",
    subtitle: "Monitor your credit balance, usage history, and manage your plan and invoices.",
    placeholder: {
      owner: "W4-C",
      contents: [
        "Current-plan tile, usage history and the credit ledger",
        "Billing cycle, GST handling and invoice / receipt generation",
      ],
    },
  },
  {
    id: "pc",
    label: "Price configuration",
    group: "Organisation",
    icon: "IndianRupee",
    heading: "Price configuration",
    subtitle:
      "The price book behind every plan, pack and enterprise SKU — per-deck rates, currencies and tax.",
    placeholder: {
      owner: "W4-D",
      contents: [
        "~50 editable price fields and 14 toggles",
        "Seven currencies with editable FX and the 18 % GST rate",
        "Plan, pack and enterprise catalogues, with preview and publish",
      ],
    },
  },
];

const SIGNUP_COMMON: AdminSection[] = [
  {
    id: "sudocs",
    label: "Required documents",
    group: "Sign-up",
    icon: "FileCheck",
    heading: "Required documents",
    subtitle:
      "Set the documents a shortlisted startup must submit during sign-up. Configured per program / cohort — each toggle marks an item mandatory. Every new sign-up inherits this checklist.",
    placeholder: {
      owner: "W5-A",
      contents: [
        "Per-programme document checklist over not requested → awaiting → submitted → verified",
        "Bulk verify",
      ],
    },
  },
  {
    id: "suagr",
    label: "Agreements library",
    group: "Sign-up",
    icon: "FileText",
    heading: "Agreements library",
    subtitle:
      "Manage the agreement templates used in sign-up — upload the source file, mark its merge fields, map it to programs and stages, and define the signing workflow. Retired templates stay for audit but can't be picked for new sign-ups.",
    placeholder: {
      owner: "W5-B",
      contents: [
        "Agreement templates with a merge-field editor",
        "Stage and programme mapping, and a signing-workflow builder",
      ],
    },
  },
  {
    id: "susign",
    label: "Authorised signatories",
    group: "Sign-up",
    icon: "Signature",
    heading: "Authorised signatories",
    subtitle:
      "Who may countersign agreements on the organisation's behalf. Grant by role, by named individual, or both. Only those enabled here appear in the sign-up countersign picker.",
    placeholder: {
      owner: "W5-B",
      contents: [
        "Signatories by role or named individual",
        "Countersign gated until one is assigned; signing method locked once the founder signs",
      ],
    },
  },
];

const SEAT_CAPACITY: AdminSection = {
  id: "suseat",
  label: "Seat capacity",
  group: "Sign-up",
  icon: "Armchair",
  heading: "Seat capacity",
  subtitle:
    "Set each program / cohort's seat count and how many are filled. Sign-up is never blocked by seats — startups that complete without one are flagged seatless so the team can allocate a seat and founder access from the pipeline.",
  placeholder: {
    owner: "W5-A",
    contents: [
      "Seats per programme / cohort with filled count and utilisation",
      "The seatless flag when a sign-up completes without a seat",
    ],
  },
};

const FUND_DEPLOYMENT: AdminSection = {
  id: "sufund",
  label: "Fund Deployment",
  group: "Sign-up",
  icon: "PieChart",
  heading: "Fund Deployment",
  subtitle:
    "Record, program-wise, how much of each fund is allotted, deployed, and still unutilised. These figures feed the Capital Deployment & Pacing report.",
  placeholder: {
    owner: "W5-A",
    contents: [
      "Per-programme fund allotted, deployed and unutilised",
      "The figures that feed the Capital Deployment & Pacing report",
    ],
  },
};

const SYSTEM: AdminSection[] = [
  {
    id: "nt",
    label: "Notifications",
    group: "System",
    icon: "Bell",
    heading: "Notifications",
    subtitle: "Control which platform events trigger email and in-app alerts for your account.",
    placeholder: {
      owner: "W3-B",
      contents: [
        "Preferences over event × channel × recipient",
        "Producers for the nine of ten events that have none, and the in-app notification centre",
      ],
    },
  },
  {
    id: "al",
    label: "Audit log",
    group: "System",
    icon: "History",
    heading: "Audit log",
    subtitle:
      "Full timestamped trail of all configuration changes, score overrides, team actions, and billing events.",
    placeholder: {
      owner: "W3-C",
      contents: [
        "An org-wide trail with category badges, filters and retention",
        "Writes on config, scoring, team and billing events, not only deck transitions",
      ],
    },
  },
  {
    id: "uc",
    label: "User access",
    group: "System",
    icon: "Key",
    // The prototype titles this "User access & passwords" and lists every
    // user's stored password behind a Reveal control. plan_parity.md §1.2
    // forbids reproducing that: passwords are PBKDF2-hashed and stay that way.
    // The section is reset-only, and its copy says so.
    heading: "User access",
    subtitle:
      "Every user's sign-in identity across this account. Passwords are never displayed — reset a user to issue a one-time temporary credential, which they must change at next sign-in.",
    placeholder: {
      owner: "W4-A",
      contents: [
        "Per-user sign-in identity and last-access state",
        "Reset only — issue a temporary credential and force a change at next sign-in",
        "Activate, deactivate and delete, with the self-demotion guard",
      ],
    },
  },
  {
    id: "br",
    label: "Branding",
    group: "System",
    icon: "Palette",
    heading: "Branding & theme",
    subtitle:
      "Edit the logo and brand palette here — changes apply across the entire admin console instantly.",
    placeholder: {
      owner: "W4-B",
      contents: [
        "10 brand tokens plus 4 status colours, logo image, two-part wordmark and tagline",
        "Applied live by writing CSS custom properties, with reset to defaults",
      ],
    },
  },
];

/** Every section of the console for an edition, in rail order. */
export function adminSections(edition: Edition): AdminSection[] {
  return [
    ...EVALUATION,
    ...ORGANISATION,
    ...SIGNUP_COMMON,
    edition === "vc" ? FUND_DEPLOYMENT : SEAT_CAPACITY,
    ...SYSTEM,
  ];
}

/** The sections a (edition, role) may see, in rail order. */
export function adminSectionsFor(edition: Edition, role: Role): AdminSection[] {
  return adminSections(edition).filter((s) => canSeeAdminGroup(role, s.group));
}

/** Rail groups that have at least one section this role may see, in order. */
export function adminGroupsFor(edition: Edition, role: Role): AdminSectionGroup[] {
  const visible = adminSectionsFor(edition, role);
  return ADMIN_SECTION_GROUPS.filter((g) => visible.some((s) => s.group === g));
}

/** The section the console opens on — the prototype's `.ni on` is `n-fw`. */
export const DEFAULT_ADMIN_SECTION = "fw";

/**
 * Resolve a `?section=` value to a section this role may open, falling back to
 * the default. A hidden or unknown id must not render a blank console.
 */
export function resolveAdminSection(
  edition: Edition,
  role: Role,
  requested: string | null,
): AdminSection {
  const visible = adminSectionsFor(edition, role);
  return (
    visible.find((s) => s.id === requested) ??
    visible.find((s) => s.id === DEFAULT_ADMIN_SECTION) ??
    visible[0]
  );
}

/**
 * The Team & roles rail badge — the prototype's red `.nb` pill, which counts
 * members whose invite has not been accepted (`tmMembers[].pending`).
 *
 * The repo has no invite-acceptance state yet: `users` carries `active` only,
 * and the invite lifecycle (pending / resend / cancel) is W4-A's. Until the
 * API reports it the count is 0 and no badge renders — the read is written
 * defensively so W4-A only has to add the field.
 */
export interface InviteState {
  id: string;
  /** Not on `UserView` yet — W4-A adds it with the invite lifecycle. */
  invitePending?: boolean;
}

export function pendingInviteCount(users: readonly InviteState[]): number {
  return users.filter((u) => u.invitePending === true).length;
}
