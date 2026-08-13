/**
 * ROLE × CAPABILITY TEST HARNESS
 * ==============================
 *
 * Answers one question exhaustively: **what can each role actually do?** — and
 * whether the running app agrees with what the code declares.
 *
 * Run it:
 *   npm run roles                      # against a local dev server (default)
 *   ROLES_BASE=https://…workers.dev npm run roles   # against the deployed app
 *   npm run roles -- --static          # no server needed; sections A + B only
 *   npm run roles -- --markdown        # emit the report as markdown
 *
 * Three layers, deliberately independent of one another:
 *
 *   A. DECLARED MATRIX (pure). Computed from the real sources of truth —
 *      `shared/roles.ts`, `shared/nav.ts`, `pipeline/incubator.ts`,
 *      `pipeline/vc.ts`. Every role × every nav slug, and every role × every
 *      pipeline action across every stage, enumerated by calling the same
 *      `canSeeNav` / `performAction` the app calls. No network, no mutation.
 *
 *   B. INVARIANTS (pure). The rules the matrix must obey — the Jul-24 decisions
 *      in FINISH-PLAN §8 (PM is the incubator decision maker; the investment
 *      associate shortlists to partner and the partner sponsors to IC; MP
 *      discretion is superuser-only), founder isolation, superuser bypass,
 *      role-scoped parameter ownership, and who may schedule calls.
 *
 *   C. RUNTIME PROBE (HTTP). Logs in as all 13 seed users and probes real
 *      endpoints, recording whether the server allowed or refused each one.
 *      **Expectations here are written out by hand, not derived from §A** — a
 *      probe that reads its expectations from the code it is testing only
 *      proves self-consistency. Where an endpoint genuinely delegates to the
 *      nav manifest by design (the analytics reports use `canAccessNav`), that
 *      is labelled a CONTRACT check rather than an independent one.
 *
 * SAFETY — the probe never mutates anything. Read checks are plain GETs;
 * write checks target a **non-existent deck / program id** or send an empty
 * body, so `requireRole` (403) fires before the handler can do anything, and an
 * authorised role lands on 400/404 instead of performing the action. That means
 * it is safe to point at production: no credit is spent, no deck moves, no row
 * is written. Anything that returns 2xx from a write probe is reported as a
 * FINDING, because it should not have been possible.
 */

import {
  ROLES_BY_EDITION,
  ROLE_LABELS,
  ADDITIONAL_PARAM_OWNERS,
  CALL_SCHEDULER_ROLES,
  MAX_ADDITIONAL_PER_ROLE,
  canScheduleCalls,
  creatableStaffRoles,
  isAdditionalParamOwner,
  roleLabel,
  type Edition,
  type Role,
} from "../src/shared/roles";
import { NAV_BY_EDITION, canSeeNav, navForUser, type NavItem } from "../src/shared/nav";
import { getPipeline, performAction } from "../src/pipeline";

// ── CLI ──────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const STATIC_ONLY = argv.includes("--static");
const MARKDOWN = argv.includes("--markdown");
const BASE = (process.env.ROLES_BASE ?? "http://localhost:5173").replace(/\/$/, "");
const DEMO_PASSWORD = "demo1234";
const EDITIONS: Edition[] = ["incubator", "vc"];

const findings: string[] = [];
let checksRun = 0;
let checksFailed = 0;

function check(name: string, ok: boolean, detail = "") {
  checksRun++;
  if (!ok) {
    checksFailed++;
    findings.push(`${name}${detail ? ` — ${detail}` : ""}`);
  }
  return ok;
}

const out: string[] = [];
const say = (line = "") => out.push(line);
const h1 = (t: string) => say(MARKDOWN ? `\n# ${t}\n` : `\n${"═".repeat(78)}\n${t}\n${"═".repeat(78)}`);
const h2 = (t: string) => say(MARKDOWN ? `\n## ${t}\n` : `\n── ${t} ${"─".repeat(Math.max(0, 74 - t.length))}`);

/** Fixed-width matrix table: rows × role columns, ✓ / · cells. */
function matrix(rowLabel: string, rows: { label: string; cells: boolean[] }[], cols: string[]) {
  const labelWidth = Math.max(rowLabel.length, ...rows.map((r) => r.label.length));
  const colWidth = Math.max(4, ...cols.map((c) => c.length));
  const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - s.length));
  const centre = (s: string, n: number) => {
    const left = Math.floor((n - s.length) / 2);
    return " ".repeat(Math.max(0, left)) + s + " ".repeat(Math.max(0, n - s.length - left));
  };
  if (MARKDOWN) {
    say(`| ${pad(rowLabel, labelWidth)} | ${cols.join(" | ")} |`);
    say(`| ${"-".repeat(labelWidth)} | ${cols.map((c) => "-".repeat(c.length)).join(" | ")} |`);
    for (const r of rows) {
      say(`| ${pad(r.label, labelWidth)} | ${r.cells.map((c, i) => centre(c ? "✓" : "·", cols[i].length)).join(" | ")} |`);
    }
  } else {
    say(`  ${pad(rowLabel, labelWidth)}  ${cols.map((c) => centre(c, colWidth)).join("")}`);
    say(`  ${"-".repeat(labelWidth)}  ${cols.map(() => "-".repeat(colWidth)).join("")}`);
    for (const r of rows) {
      say(`  ${pad(r.label, labelWidth)}  ${r.cells.map((c) => centre(c ? "✓" : "·", colWidth)).join("")}`);
    }
  }
  say();
}

/** Short column headings so the matrices fit a terminal. */
const SHORT: Record<string, string> = {
  superuser: "SU",
  admin: "ADM",
  program_manager: "PM",
  program_associate: "PA",
  jury: "JURY",
  founder: "FNDR",
  partner: "PTNR",
  ic_member: "IC",
  associate: "ASSO",
  analyst: "ANLY",
};

// ═══════════════════════════════════════════════════════════════════════════
// A. DECLARED MATRIX
// ═══════════════════════════════════════════════════════════════════════════

/** Every pipeline action a role may perform anywhere in the edition's flow. */
function pipelineActionsFor(edition: Edition, role: Role): string[] {
  const pipe = getPipeline(edition);
  const actions = new Set<string>();
  for (const stage of pipe.stages) {
    for (const t of pipe.transitions) {
      if (t.from !== stage.id) continue;
      // Ask the engine, not the config — this is the predicate the API uses.
      if (performAction(edition, stage.id, t.action, role).ok) actions.add(t.action);
    }
  }
  return [...actions].sort();
}

function reportDeclaredMatrix() {
  h1("A. DECLARED CAPABILITY MATRIX");
  say("Computed from src/shared/{roles,nav}.ts and src/pipeline/* — the same");
  say("predicates the running app uses (canSeeNav, performAction).");

  for (const edition of EDITIONS) {
    const roles = ROLES_BY_EDITION[edition];
    const cols = roles.map((r) => SHORT[r] ?? r);

    h2(`${edition.toUpperCase()} — screen access (nav manifest)`);
    const navRows = NAV_BY_EDITION[edition].map((item: NavItem) => ({
      label: `${item.section}/${item.id}`,
      cells: roles.map((r) => canSeeNav(r, item)),
    }));
    matrix("screen", navRows, cols);
    say(
      `  totals: ${roles
        .map((r) => `${SHORT[r] ?? r}=${navForUser(edition, r).length}`)
        .join("  ")}   (of ${NAV_BY_EDITION[edition].length} screens)`,
    );

    h2(`${edition.toUpperCase()} — pipeline actions (state machine)`);
    const pipe = getPipeline(edition);
    const actionRows = pipe.transitions.map((t) => ({
      label: `${t.from} →${t.action}`,
      cells: roles.map((r) => performAction(edition, t.from, t.action, r).ok),
    }));
    matrix("stage → action", actionRows, cols);
    say(
      `  totals: ${roles
        .map((r) => `${SHORT[r] ?? r}=${pipelineActionsFor(edition, r).length}`)
        .join("  ")}   (of ${pipe.transitions.length} transitions)`,
    );

    h2(`${edition.toUpperCase()} — feature capabilities`);
    const features: { label: string; test: (r: Role) => boolean }[] = [
      { label: "schedule / cancel calls", test: (r) => canScheduleCalls(edition, r) },
      { label: `own ≤${MAX_ADDITIONAL_PER_ROLE} additional params`, test: (r) => isAdditionalParamOwner(edition, r) },
      { label: "creatable by an admin", test: (r) => creatableStaffRoles(edition).includes(r) },
    ];
    matrix(
      "capability",
      features.map((f) => ({ label: f.label, cells: roles.map(f.test) })),
      cols,
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// B. INVARIANTS
// ═══════════════════════════════════════════════════════════════════════════

function can(edition: Edition, role: Role, from: string, action: string): boolean {
  return performAction(edition, from, action, role).ok;
}

function reportInvariants() {
  h1("B. INVARIANTS");
  const before = checksFailed;

  // ── Structural ────────────────────────────────────────────────────────────
  for (const edition of EDITIONS) {
    const roles = ROLES_BY_EDITION[edition] as readonly string[];
    for (const item of NAV_BY_EDITION[edition]) {
      check(
        `[${edition}] nav "${item.id}" lists only roles that exist in the edition`,
        item.roles.every((r) => roles.includes(r)),
        item.roles.filter((r) => !roles.includes(r)).join(","),
      );
    }
    for (const t of getPipeline(edition).transitions) {
      check(
        `[${edition}] transition "${t.action}" lists only roles that exist in the edition`,
        t.roles.every((r) => roles.includes(r)),
        t.roles.filter((r) => !roles.includes(r)).join(","),
      );
    }
    for (const role of ROLES_BY_EDITION[edition]) {
      check(`[${edition}] role "${role}" has at least one screen`, navForUser(edition, role).length > 0);
    }
    check(
      `[${edition}] an admin may create every staff role except superuser and founder`,
      creatableStaffRoles(edition).length === ROLES_BY_EDITION[edition].length - (edition === "incubator" ? 2 : 1) &&
        !creatableStaffRoles(edition).includes("superuser") &&
        !creatableStaffRoles(edition).includes("founder"),
      creatableStaffRoles(edition).join(","),
    );
    check(
      `[${edition}] exactly 3 roles own additional parameters (13 + 3×3 = 22)`,
      ADDITIONAL_PARAM_OWNERS[edition].length === 3,
      ADDITIONAL_PARAM_OWNERS[edition].join(","),
    );
    check(
      `[${edition}] every call-scheduler role is a real role in the edition`,
      CALL_SCHEDULER_ROLES[edition].every((r) => roles.includes(r)),
    );
  }

  // ── Superuser bypass + founder isolation ──────────────────────────────────
  for (const edition of EDITIONS) {
    const portalOrExclusive = NAV_BY_EDITION[edition].filter((i) => i.portal || i.exclusive);
    check(
      `[${edition}] superuser sees every shared screen`,
      NAV_BY_EDITION[edition]
        .filter((i) => !i.portal && !i.exclusive)
        .every((i) => canSeeNav("superuser", i)),
    );
    check(
      `[${edition}] superuser is NOT given portal or role-exclusive screens`,
      portalOrExclusive.every((i) => !canSeeNav("superuser", i)),
      portalOrExclusive.filter((i) => canSeeNav("superuser", i)).map((i) => i.id).join(","),
    );
  }
  const founderScreens = navForUser("incubator", "founder");
  check(
    "[incubator] founder is confined to the founder portal",
    founderScreens.length > 0 && founderScreens.every((i) => i.portal === "founder"),
    founderScreens.filter((i) => !i.portal).map((i) => i.id).join(","),
  );
  check(
    "founder has no role in the VC edition at all",
    navForUser("vc", "founder" as Role).length === 0 &&
      getPipeline("vc").transitions.every((t) => !t.roles.includes("founder" as Role)),
  );
  check(
    "[incubator] the founder's only pipeline powers are submit / respond / complete signup",
    pipelineActionsFor("incubator", "founder").join(",") ===
      ["complete_signup", "founder_response", "submit_for_ai"].join(","),
    pipelineActionsFor("incubator", "founder").join(","),
  );

  // ── §8: incubator Program Manager is the DECISION MAKER ───────────────────
  for (const [from, action] of [
    ["ai_evaluated", "assign_jury"],
    ["jury_evaluation", "shortlist"],
    ["jury_evaluation", "reject"],
    ["shortlisted", "schedule_intro"],
  ] as const) {
    check(`§8 [incubator] program_manager may ${action}`, can("incubator", "program_manager", from, action));
  }
  check(
    "§8 [incubator] the program_associate is the executor, not the decision maker (no shortlist / reject)",
    !can("incubator", "program_associate", "jury_evaluation", "shortlist") &&
      !can("incubator", "program_associate", "jury_evaluation", "reject"),
  );
  check(
    "§8 [incubator] the associate still executes: assign jury, schedule the intro, send signup",
    can("incubator", "program_associate", "ai_evaluated", "assign_jury") &&
      can("incubator", "program_associate", "shortlisted", "schedule_intro") &&
      can("incubator", "program_associate", "intro", "send_signup"),
  );
  check(
    "§8 [incubator] the jury still does the shortlisting",
    can("incubator", "jury", "jury_evaluation", "shortlist"),
  );
  check(
    "[incubator] the jury cannot assign itself work or send a signup",
    !can("incubator", "jury", "ai_evaluated", "assign_jury") && !can("incubator", "jury", "intro", "send_signup"),
  );

  // ── §8: VC seniority ladder ───────────────────────────────────────────────
  check(
    "§8 [vc] the investment associate shortlists to partner; the analyst cannot",
    can("vc", "associate", "associate_review", "shortlist_to_partner") &&
      !can("vc", "analyst", "associate_review", "shortlist_to_partner"),
  );
  check(
    "§8 [vc] the partner sponsors to IC; the associate cannot",
    can("vc", "partner", "partner_call", "sponsor_to_ic") &&
      !can("vc", "associate", "partner_call", "sponsor_to_ic"),
  );
  check(
    "§8 [vc] the Managing Partner decides at discretion — invest / pass / return are superuser-only",
    (["invest", "pass", "return_to_partner"] as const).every(
      (action) =>
        can("vc", "superuser", "mp_decision", action) &&
        (ROLES_BY_EDITION.vc as readonly Role[])
          .filter((r) => r !== "superuser")
          .every((r) => !can("vc", r, "mp_decision", action)),
    ),
  );
  check(
    "§8 [vc] closing the IC vote is superuser-only",
    can("vc", "superuser", "ic_review", "close_ic_vote") &&
      (ROLES_BY_EDITION.vc as readonly Role[])
        .filter((r) => r !== "superuser")
        .every((r) => !can("vc", r, "ic_review", "close_ic_vote")),
  );
  check(
    "[vc] the analyst has no decision power beyond submitting scores",
    pipelineActionsFor("vc", "analyst").every((a) =>
      ["submit_for_ai", "ai_complete", "submit_core_scores"].includes(a),
    ),
    pipelineActionsFor("vc", "analyst").join(","),
  );
  check(
    "[vc] the IC member votes but moves nothing in the state machine",
    pipelineActionsFor("vc", "ic_member").length === 0,
    pipelineActionsFor("vc", "ic_member").join(","),
  );

  // ── Calls (§8: ICS scheduling) ────────────────────────────────────────────
  check(
    "§8 [incubator] the PM schedules the intro call, or delegates to the associate",
    canScheduleCalls("incubator", "program_manager") && canScheduleCalls("incubator", "program_associate"),
  );
  check(
    "§8 [vc] the investment associate and the partner schedule calls",
    canScheduleCalls("vc", "associate") && canScheduleCalls("vc", "partner"),
  );
  check(
    "evaluators are read-only on calls (jury, IC member, analyst, founder)",
    !canScheduleCalls("incubator", "jury") &&
      !canScheduleCalls("incubator", "founder") &&
      !canScheduleCalls("vc", "ic_member") &&
      !canScheduleCalls("vc", "analyst"),
  );

  // ── The mentor pseudo-role (Session 4: a user-type, not a role) ───────────
  const MENTOR = "mentor" as Role;
  check(
    'the "mentor" user-type carries no authority anywhere (no screens, no transitions)',
    navForUser("incubator", MENTOR).length === 0 &&
      pipelineActionsFor("incubator", MENTOR).length === 0 &&
      !canScheduleCalls("incubator", MENTOR),
  );

  say(`  ${checksRun} invariants evaluated, ${checksFailed - before} failed.`);
  if (checksFailed === before) say("  ✓ all invariants hold.");
}

// ═══════════════════════════════════════════════════════════════════════════
// C. RUNTIME PROBE
// ═══════════════════════════════════════════════════════════════════════════

interface SeedUser {
  email: string;
  edition: Edition;
  role: Role;
  note?: string;
}

/** The seeded demo accounts — one per role, plus the mentor user-type. */
const SEED_USERS: SeedUser[] = [
  { email: "priya.sharma@demo.startupjury.ai", edition: "incubator", role: "superuser" },
  { email: "nisha.kapoor@demo.startupjury.ai", edition: "incubator", role: "admin" },
  { email: "raj.kumar@demo.startupjury.ai", edition: "incubator", role: "program_manager" },
  { email: "sunita.rao@demo.startupjury.ai", edition: "incubator", role: "program_associate" },
  { email: "rajesh.kumar@demo.startupjury.ai", edition: "incubator", role: "jury" },
  { email: "meera.sharma@demo.startupjury.ai", edition: "incubator", role: "founder" },
  { email: "anil.mehta@demo.startupjury.ai", edition: "incubator", role: "mentor" as Role, note: "user-type, not a role" },
  { email: "aarav.khanna@demo.startupjury.ai", edition: "vc", role: "superuser" },
  { email: "nisha.kapoor.vc@demo.startupjury.ai", edition: "vc", role: "admin" },
  { email: "ishaan.sethi@demo.startupjury.ai", edition: "vc", role: "partner" },
  { email: "rajesh.kumar.vc@demo.startupjury.ai", edition: "vc", role: "ic_member" },
  { email: "sunita.rao.vc@demo.startupjury.ai", edition: "vc", role: "associate" },
  { email: "rhea.nair@demo.startupjury.ai", edition: "vc", role: "analyst" },
];

/** A non-existent id: `requireRole` (403) fires before the handler's 404. */
const GHOST_DECK = "deck_00000000-0000-0000-0000-000000000000";

type Kind = "read" | "write" | "contract";

interface Probe {
  id: string;
  label: string;
  kind: Kind;
  method: string;
  path: string;
  body?: unknown;
  editions?: Edition[];
  /** Roles expected to get past authZ. Superuser is implicit unless `strict`. */
  allow: readonly Role[];
  /** No superuser bypass (role-exclusive surfaces). */
  strict?: boolean;
}

const PROBES: Probe[] = [
  // ── Reads ─────────────────────────────────────────────────────────────────
  { id: "decks.list", label: "GET /api/decks", kind: "read", method: "GET", path: "/api/decks",
    allow: ["admin", "program_manager", "program_associate", "jury", "founder", "partner", "ic_member", "associate", "analyst"] },
  { id: "programs.list", label: "GET /api/programs", kind: "read", method: "GET", path: "/api/programs",
    allow: ["admin", "program_manager", "program_associate", "jury", "founder", "partner", "ic_member", "associate", "analyst"] },
  { id: "params.list", label: "GET /api/parameters", kind: "read", method: "GET", path: "/api/parameters",
    allow: ["admin", "program_manager", "program_associate", "jury", "founder", "partner", "ic_member", "associate", "analyst"] },
  { id: "config.read", label: "GET /api/config (org settings)", kind: "read", method: "GET", path: "/api/config",
    allow: ["admin"] },
  { id: "users.list", label: "GET /api/users (roster)", kind: "read", method: "GET", path: "/api/users",
    allow: ["admin"] },
  { id: "tickets.list", label: "GET /api/tickets", kind: "read", method: "GET", path: "/api/tickets",
    allow: ["admin"] },
  { id: "issues.list", label: "GET /api/issues (issue log)", kind: "read", method: "GET", path: "/api/issues",
    allow: ["admin", "program_manager", "program_associate", "jury", "partner", "ic_member", "associate", "analyst"] },
  { id: "calls.list", label: "GET /api/calls", kind: "read", method: "GET", path: "/api/calls",
    allow: ["admin", "program_manager", "program_associate", "jury", "founder", "partner", "ic_member", "associate", "analyst"] },
  { id: "calls.directory", label: "GET /api/calls/directory (participant picker)", kind: "read", method: "GET", path: "/api/calls/directory",
    allow: ["admin", "program_manager", "program_associate", "partner", "associate"] },
  { id: "jury.list", label: "GET /api/jury (jury roster)", kind: "read", method: "GET", path: "/api/jury",
    editions: ["incubator"], allow: ["admin", "program_manager", "program_associate"] },
  { id: "queries.list", label: "GET /api/queries (founder queries)", kind: "read", method: "GET", path: "/api/queries",
    allow: ["admin", "program_manager", "program_associate", "jury", "partner", "ic_member", "associate", "analyst"] },

  // ── Writes (probed with a ghost id / empty body — cannot mutate) ───────────
  { id: "users.create", label: "POST /api/users (create a user)", kind: "write", method: "POST", path: "/api/users", body: {},
    allow: ["admin"] },
  { id: "config.params", label: "PUT /api/config/parameters (edit the core 13)", kind: "write", method: "PUT", path: "/api/config/parameters", body: {},
    allow: ["admin"] },
  { id: "config.credits", label: "POST /api/config/credits/purchase", kind: "write", method: "POST", path: "/api/config/credits/purchase", body: { pack: "__invalid__" },
    allow: ["admin"] },
  { id: "programs.create", label: "POST /api/programs (create a program)", kind: "write", method: "POST", path: "/api/programs", body: {},
    allow: ["admin"] },
  { id: "programs.sector", label: "POST /api/programs/sectors", kind: "write", method: "POST", path: "/api/programs/sectors", body: {},
    allow: ["admin"] },
  { id: "cohorts.create", label: "POST /api/programs/:id/cohorts", kind: "write", method: "POST", path: "/api/programs/__ghost__/cohorts", body: {},
    allow: ["admin", "program_manager"] },
  { id: "calls.schedule", label: "POST /api/calls (schedule + ICS invite)", kind: "write", method: "POST", path: "/api/calls", body: {},
    allow: ["admin", "program_manager", "program_associate", "partner", "associate"] },
  { id: "issues.file", label: "POST /api/issues (file an issue)", kind: "write", method: "POST", path: "/api/issues", body: {},
    allow: ["admin", "program_manager", "program_associate", "jury", "partner", "ic_member", "associate", "analyst"] },
  { id: "issues.triage", label: "PATCH /api/issues/:id (triage)", kind: "write", method: "PATCH", path: "/api/issues/__ghost__", body: {},
    allow: ["admin"] },
  { id: "decks.rescore", label: "POST /api/decks/:id/rescore", kind: "write", method: "POST", path: `/api/decks/${GHOST_DECK}/rescore`, body: {},
    allow: ["admin", "program_manager", "program_associate", "jury", "partner", "associate", "analyst"] },
  { id: "decks.retryai", label: "POST /api/decks/:id/retry-ai (re-drive a stuck deck)", kind: "write", method: "POST", path: `/api/decks/${GHOST_DECK}/retry-ai`, body: {},
    allow: ["admin", "program_manager", "program_associate", "partner", "associate", "analyst"] },
  { id: "decks.version", label: "POST /api/decks/:id/version (re-upload)", kind: "write", method: "POST", path: `/api/decks/${GHOST_DECK}/version`, body: {},
    allow: ["admin", "program_manager", "program_associate", "founder", "associate", "analyst"] },
  { id: "decks.query", label: "POST /api/decks/:id/queries (ask the founder)", kind: "write", method: "POST", path: `/api/decks/${GHOST_DECK}/queries`, body: {},
    allow: ["admin", "program_manager", "program_associate", "associate", "analyst"] },
  { id: "ic.vote", label: "POST /api/decks/:id/ic-vote", kind: "write", method: "POST", path: `/api/decks/${GHOST_DECK}/ic-vote`, body: {},
    editions: ["vc"], allow: ["admin", "ic_member", "partner"] },

  // ── Contract: analytics delegate to the nav manifest by design ────────────
  ...analyticsProbes(),
];

/** Analytics endpoints are gated by `canAccessNav` — assert the server honours it. */
function analyticsProbes(): Probe[] {
  const slugs: { slug: string; edition: Edition }[] = [
    { slug: "cohort", edition: "incubator" },
    { slug: "evaluators", edition: "incubator" },
    { slug: "drift", edition: "incubator" },
    { slug: "funnel", edition: "incubator" },
    { slug: "capital", edition: "vc" },
    { slug: "portfolio", edition: "vc" },
    { slug: "scoring", edition: "vc" },
    { slug: "diligence", edition: "vc" },
    { slug: "decisions", edition: "vc" },
  ];
  // Map an endpoint to the nav slug that guards it.
  const navSlug: Record<string, string> = {
    cohort: "cohortsummary",
    evaluators: "evaluatorscores",
    drift: "scoredrift",
    funnel: "funnel",
    capital: "capital",
    portfolio: "portfolio",
    scoring: "scoring",
    diligence: "diligence",
    decisions: "decisions",
  };
  return slugs.map(({ slug, edition }) => {
    const item = NAV_BY_EDITION[edition].find((i) => i.id === navSlug[slug]);
    return {
      id: `analytics.${slug}`,
      label: `GET /api/analytics/${slug}`,
      kind: "contract" as Kind,
      method: "GET",
      path: `/api/analytics/${slug}`,
      editions: [edition],
      allow: (item?.roles ?? []) as readonly Role[],
      strict: item?.exclusive === true,
    };
  });
}

interface Session {
  user: SeedUser;
  cookie: string | null;
  loginError?: string;
}

async function login(email: string): Promise<Session["cookie"]> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: DEMO_PASSWORD }),
    redirect: "manual",
  });
  if (res.status !== 200) return null;
  const raw = res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""];
  for (const c of raw) {
    const m = c.match(/sj_session=([^;]+)/);
    if (m?.[1]) return m[1];
  }
  return null;
}

async function probeOne(session: Session, probe: Probe): Promise<number> {
  const res = await fetch(`${BASE}${probe.path}`, {
    method: probe.method,
    headers: {
      Cookie: `sj_session=${session.cookie}`,
      ...(probe.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: probe.body !== undefined ? JSON.stringify(probe.body) : undefined,
    redirect: "manual",
  });
  return res.status;
}

function expectedAllowed(probe: Probe, user: SeedUser): boolean {
  if (probe.editions && !probe.editions.includes(user.edition)) return false;
  if (!probe.strict && user.role === "superuser") return true;
  return (probe.allow as readonly string[]).includes(user.role);
}

async function reportRuntimeProbe() {
  h1("C. RUNTIME PROBE");
  say(`  target: ${BASE}`);

  const sessions: Session[] = [];
  for (const user of SEED_USERS) {
    const cookie = await login(user.email);
    sessions.push({ user, cookie, loginError: cookie ? undefined : "login failed" });
    check(`login as ${user.email} (${user.edition}/${user.role})`, cookie !== null);
  }
  const live = sessions.filter((s) => s.cookie);
  say(`  logged in: ${live.length}/${SEED_USERS.length} seed accounts`);
  say();
  say("  NB the MENT column is the `mentor` user-type (Session 4: a user-type, not a");
  say("  role — it appears in no authZ list and no nav manifest). Its expectation here");
  say("  is DENIED everywhere, which encodes the documented intent. Where the server");
  say("  allows it, that is drift between intent and implementation, not a test bug:");
  say("  those endpoints authorise on `requireAuth` alone, so they admit any");
  say("  authenticated principal including role values nobody enumerated.");

  for (const edition of EDITIONS) {
    const editionSessions = live.filter((s) => s.user.edition === edition);
    const applicable = PROBES.filter((p) => !p.editions || p.editions.includes(edition));
    const cols = editionSessions.map((s) => SHORT[s.user.role] ?? s.user.role.slice(0, 4).toUpperCase());

    h2(`${edition.toUpperCase()} — observed authorisation (✓ = allowed, · = 403)`);
    const rows: { label: string; cells: boolean[] }[] = [];
    for (const probe of applicable) {
      const cells: boolean[] = [];
      for (const session of editionSessions) {
        const status = await probeOne(session, probe);
        const allowed = status !== 403;
        cells.push(allowed);

        const expected = expectedAllowed(probe, session.user);
        const who = `${edition}/${session.user.role}`;
        check(
          `${probe.id} · ${who} → ${expected ? "allowed" : "403"}`,
          allowed === expected,
          `HTTP ${status} (expected ${expected ? "not 403" : "403"})`,
        );
        // A write probe must never actually succeed — it targets a ghost id or
        // sends an empty body, so a 2xx means it did something it should not.
        if (probe.kind === "write" && status >= 200 && status < 300) {
          check(`${probe.id} · ${who} → write probe must not succeed`, false, `HTTP ${status}`);
        }
      }
      rows.push({ label: `${probe.kind === "contract" ? "◇" : probe.kind === "write" ? "✎" : "◦"} ${probe.label}`, cells });
    }
    matrix("capability", rows, cols);
  }
  say("  ◦ read   ✎ write (ghost id / empty body — cannot mutate)   ◇ nav-manifest contract");
}

// ═══════════════════════════════════════════════════════════════════════════
// Report
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  h1("ai.STARTUPJURY — ROLE × CAPABILITY REPORT");
  say(
    `  ${EDITIONS.length} editions · ${EDITIONS.reduce((n, e) => n + ROLES_BY_EDITION[e].length, 0)} roles · ` +
      `${EDITIONS.reduce((n, e) => n + NAV_BY_EDITION[e].length, 0)} screens · ` +
      `${EDITIONS.reduce((n, e) => n + getPipeline(e).transitions.length, 0)} pipeline transitions`,
  );
  say(`  roles: ${EDITIONS.map((e) => `${e} = ${ROLES_BY_EDITION[e].map((r) => roleLabel(e, r)).join(", ")}`).join(" | ")}`);

  reportDeclaredMatrix();
  reportInvariants();
  if (!STATIC_ONLY) {
    try {
      await reportRuntimeProbe();
    } catch (err) {
      say(`\n  runtime probe unavailable at ${BASE} — ${(err as Error).message}`);
      say("  start a server (npm run dev) or pass --static.");
      checksFailed++;
      findings.push(`runtime probe could not reach ${BASE}`);
    }
  }

  h1("SUMMARY");
  say(`  ${checksRun} checks · ${checksRun - checksFailed} passed · ${checksFailed} failed`);
  if (findings.length) {
    say("\n  FINDINGS:");
    for (const f of findings) say(`   ✗ ${f}`);
  } else {
    say("  ✓ every role has exactly the capabilities the code declares.");
  }
  say();

  console.log(out.join("\n"));
  process.exit(checksFailed > 0 ? 1 : 0);
}

void main();

// Keep the unused-import linter honest about the label maps we expose above.
void ROLE_LABELS;
