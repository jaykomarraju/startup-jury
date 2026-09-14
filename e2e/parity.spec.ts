import { test, expect, type Page } from "@playwright/test";
import { navForUser, navLabel } from "../src/shared/nav";
import type { Edition, Role } from "../src/shared/roles";
import { appendFileSync } from "node:fs";

/**
 * The parity walk — one pass per role over every screen that role can reach,
 * recording two things the prototypes specify exactly and that regressions
 * quietly eat: the page **title** and each table's **header set**.
 *
 * plan_parity.md §4: *"Column and copy parity is testable — test it. When a
 * prototype table specifies columns, assert the exact header set. This is what
 * stops the same finding reopening."* This file is where that assertion lives
 * for the whole application, so a session that fixes one screen's columns
 * cannot silently change another's.
 *
 * ── The expectation table is a SNAPSHOT, not a target ────────────────────────
 * `EXPECTED` below was captured from the application as it stood at the end of
 * Wave 0. It is not yet the prototype's answer — the columns are frequently
 * wrong, and closing that is the screen sessions' work (Waves 7–9). What this
 * file guarantees today is that no screen's title or columns move by ACCIDENT.
 *
 * A session that deliberately changes a screen re-captures its rows:
 *
 *     PARITY_CAPTURE=1 npx playwright test e2e/parity.spec.ts
 *     # writes ${TMPDIR}/sj-parity-capture.jsonl — one JSON record per screen
 *
 * …and pastes the changed rows in, UNIONED with what is already there, in the
 * same commit as the change. Union, because a capture only sees the header sets
 * that had rows to draw at that moment. A diff on this file is then a precise,
 * reviewable statement of which columns moved.
 *
 * Read-only throughout: the suite runs `fullyParallel` against one local D1, so
 * this walk never mutates anything.
 */

interface SeedUser {
  email: string;
  edition: Edition;
  role: Role;
}

/** The Phase 1 seed users, one per (edition, role). Password `demo1234`. */
const USERS: SeedUser[] = [
  { email: "priya.sharma@demo.startupjury.ai", edition: "incubator", role: "superuser" },
  { email: "nisha.kapoor@demo.startupjury.ai", edition: "incubator", role: "admin" },
  { email: "raj.kumar@demo.startupjury.ai", edition: "incubator", role: "program_manager" },
  { email: "sunita.rao@demo.startupjury.ai", edition: "incubator", role: "program_associate" },
  { email: "rajesh.kumar@demo.startupjury.ai", edition: "incubator", role: "jury" },
  { email: "meera.sharma@demo.startupjury.ai", edition: "incubator", role: "founder" },
  { email: "aarav.khanna@demo.startupjury.ai", edition: "vc", role: "superuser" },
  { email: "nisha.kapoor.vc@demo.startupjury.ai", edition: "vc", role: "admin" },
  { email: "ishaan.sethi@demo.startupjury.ai", edition: "vc", role: "partner" },
  { email: "rajesh.kumar.vc@demo.startupjury.ai", edition: "vc", role: "ic_member" },
  { email: "sunita.rao.vc@demo.startupjury.ai", edition: "vc", role: "associate" },
  { email: "rhea.nair@demo.startupjury.ai", edition: "vc", role: "analyst" },
];

interface Screen {
  /** The `<h1>` the screen renders. */
  title: string;
  /**
   * Every header set this screen is known to render, deduped — NOT a per-visit
   * table list. Several screens (`partnercall`, `icpipeline`, `jassigned`) drop
   * the whole table when their query comes back empty, and the suite runs
   * `fullyParallel` against one local D1 that other specs are mutating, so
   * whether a given table is on screen during this walk is not knowable in
   * advance. What IS fixed is the columns, if it renders at all.
   */
  tables: string[][];
}

const CAPTURE = process.env.PARITY_CAPTURE === "1";
const CAPTURE_FILE = `${process.env.TMPDIR ?? "/tmp"}/sj-parity-capture.jsonl`;

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

/** Visit one screen and read back its title and table headers. */
async function observe(page: Page, slug: string): Promise<Screen> {
  await page.goto(`/app/${slug}`);
  const h1 = page.locator("h1").first();
  // 30 s, not the 5 s default. `test.setTimeout(180_000)` below governs the WALK;
  // it cannot reach an individual assertion's budget, so under load a single slow
  // navigation failed a test that still had minutes left — which is what took down
  // vc/superuser and vc/admin during Wave 2 integration while five review agents
  // were saturating the machine. The walk is read-only, so waiting longer here
  // costs nothing when the page is quick.
  await expect(h1).toBeVisible({ timeout: 30_000 });
  // Tables render after their fetch resolves; the h1 does not wait for it, so
  // reading straight after it would snapshot a half-drawn screen. Two gates:
  // `networkidle` for the fetch, then the app's own shared "Loading…" marker for
  // the render that follows it.
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Loading…")).toHaveCount(0);
  const title = (await h1.innerText()).trim();
  const tables: string[][] = [];
  for (const table of await page.locator("table").all()) {
    const headers = await table.locator("thead th").allInnerTexts();
    tables.push(headers.map((h) => h.replace(/\s+/g, " ").trim()));
  }
  return { title, tables };
}

for (const user of USERS) {
  test(`${user.edition}/${user.role} — every screen keeps its title and columns`, async ({
    page,
  }) => {
    // A superuser walks 30 screens, each gated on `networkidle` (500 ms of quiet
    // at minimum). The default 30 s test timeout is roughly where that lands, so
    // the walk fails intermittently without this. Set here rather than in
    // playwright.config.ts, which this session does not own.
    test.setTimeout(180_000);
    await login(page, user.email);
    const items = navForUser(user.edition, user.role);
    expect(items.length).toBeGreaterThan(0);

    for (const item of items) {
      const key = `${user.edition}/${user.role}/${item.id}`;
      const seen = await observe(page, item.id);

      if (CAPTURE) {
        appendFileSync(CAPTURE_FILE, `${JSON.stringify({ key, ...seen })}\n`);
        continue;
      }

      const want = EXPECTED[key];
      expect(want, `${key} is not in EXPECTED — re-capture with PARITY_CAPTURE=1`).toBeDefined();
      // A screen that failed its route guard is not a screen. Catch it here
      // rather than letting "Not available for your role" pass as a title.
      expect(seen.title, `${key} title`).not.toBe("Not available for your role");
      expect(seen.title, `${key} title`).toBe(want.title);
      // Every table on screen must have a header set this screen is known to
      // render. Add a column, drop one, rename one, reorder them — all fail.
      // How MANY tables render is left alone: that follows the data (see the
      // `Screen.tables` note), and pinning it would make this walk flake.
      for (const headers of seen.tables) {
        expect(want.tables, `${key} table headers`).toContainEqual(headers);
      }
      // Sanity: the sidebar label and the route agree that this item exists.
      expect(navLabel(user.role, item).length).toBeGreaterThan(0);
    }
  });
}

/**
 * Captured at the close of Wave 0, on `main` @ 437e78b plus this session's
 * harness: 243 screens across the 12 seed roles. Two captures were merged —
 * one against a freshly migrated seed, one against a database the mutating specs
 * had already worked over — so the empty-state and populated header sets are
 * both here. Within a single database state, two independent captures were
 * byte-identical, so a diff here means a real change, not flake.
 *
 * The three `partnercall` rows are the reason `tables` is a union: that screen
 * renders no table at all once its queue empties.
 */
const EXPECTED: Record<string, Screen> = {
  // ── incubator/superuser · 25 screens ──
  "incubator/superuser/alldecks": {
    title: "All decks",
    tables: [["STARTUP", "FOUNDER NAME", "EMAIL ID", "PHONE NUMBER", "CITY", "SECTOR", "STATUS"]],
  },
  "incubator/superuser/upload": { title: "Upload your first pitchdecks", tables: [] },
  "incubator/superuser/query": {
    title: "Founder queries",
    tables: [["", "STARTUP", "FOUNDER", "PHONE", "EMAIL", "STATUS", "PARAMETERS NEEDING RESPONSE"]],
  },
  "incubator/superuser/evaluate": { title: "Evaluate", tables: [] },
  "incubator/superuser/assign": { title: "Assign", tables: [] },
  "incubator/superuser/jurypipeline": {
    title: "Jury Pipeline",
    tables: [["STARTUP", "JURY MEMBERS & STATUS", "AI SCORE", "JURY SCORE", "AVG. SCORE", "ADDL. PARAMETER SCORES", "ASSIGNED DATE", "STATUS", "ACTION"]],
  },
  "incubator/superuser/pmpipeline": {
    title: "Prog manager pipeline",
    tables: [["STARTUP", "AI SCORE", "JURY SCORE", "AVG. SCORE", "ADDL. PARAMETER SCORES", "CALL SCHEDULED", "CALL DATE", "CALL COMPLETED", "SIGN-UP STATUS", "ACTION"]],
  },
  "incubator/superuser/introcalls": {
    title: "Intro calls",
    tables: [["STARTUP", "AI SCORE", "JURY SCORE", "AVG. SCORE", "ADDL. PARAMETER SCORES", "CALL SCHEDULED", "CALL DATE", "CALL COMPLETED", "SCHEDULER", "ACTION"]],
  },
  "incubator/superuser/incuration": {
    title: "Sign up Pipeline",
    tables: [["STARTUP", "AI SCORE", "JURY SCORE", "AVG. SCORE", "ADDL. PARAMETER SCORES", "CALL SCHEDULED", "CALL DATE", "CALL COMPLETED", "SIGN-UP STATUS", "PAYMENT STATUS", "DOCUMENTS STATUS", "ACTION"]],
  },
  "incubator/superuser/curation": {
    title: "Onboard ready",
    tables: [["STARTUP", "COHORT", "CURATION STAGE", "JURY MEMBER LEAD", "PROGRESS", "ACTION"]],
  },
  "incubator/superuser/archive": {
    title: "Archive",
    tables: [["STARTUP", "REASON", "STAGE REACHED", "ARCHIVED ON", "ARCHIVED BY", "ACTION"]],
  },
  "incubator/superuser/cohortsummary": {
    title: "Cohort summary",
    tables: [["STARTUP", "SECTOR · STAGE", "SCORE", "TOP DRIVER", "RECOMMENDATION"]],
  },
  "incubator/superuser/evaluatorscores": {
    title: "Evaluator scores",
    tables: [["EVALUATOR", "ROLE", "DECKS SCORED", "AVG GIVEN", "VS COHORT", "AGREEMENT"]],
  },
  "incubator/superuser/scoredrift": {
    title: "Score drift",
    tables: [["STARTUP", "AI PRE-SCORE", "AFTER CLARIFICATION", "FINAL (JUROR)", "NET DRIFT"]],
  },
  "incubator/superuser/funnel": {
    title: "Pipeline funnel",
    tables: [["STAGE", "COUNT", "% OF UPLOADED", "STEP CONVERSION"]],
  },
  "incubator/superuser/coreparams": {
    title: "Core Parameters — Area weights",
    tables: [["#", "EVALUATION AREA", "TYPE", "WEIGHT %", "VISUAL"]],
  },
  "incubator/superuser/myparams": { title: "My Parameters — Role configuration", tables: [] },
  "incubator/superuser/setup": { title: "Set up your workspace", tables: [] },
  "incubator/superuser/account": { title: "Create your account", tables: [] },
  "incubator/superuser/admin": {
    title: "Admin console",
    tables: [["MEMBER", "ROLE", "ORGANIZATIONAL TITLE", "TYPE", "STATUS", "ACTION"]],
  },
  "incubator/superuser/billing": { title: "Choose your plan", tables: [] },
  "incubator/superuser/contactadmin": { title: "Contact Admin", tables: [] },
  "incubator/superuser/contactteam": { title: "Contact team", tables: [] },
  "incubator/superuser/support": {
    title: "Tickets",
    tables: [["SUBJECT", "FROM", "ROUTING", "STATUS", "RAISED", ""]],
  },
  "incubator/superuser/issues": {
    title: "Issue log",
    tables: [["ISSUE", "AREA", "SEVERITY", "STATUS", "OWNER", "RAISED", "AGE"]],
  },

  // ── incubator/admin · 25 screens ──
  "incubator/admin/alldecks": {
    title: "All decks",
    tables: [["STARTUP", "FOUNDER NAME", "EMAIL ID", "PHONE NUMBER", "CITY", "SECTOR", "STATUS"]],
  },
  "incubator/admin/upload": { title: "Upload your first pitchdecks", tables: [] },
  "incubator/admin/query": {
    title: "Founder queries",
    tables: [["", "STARTUP", "FOUNDER", "PHONE", "EMAIL", "STATUS", "PARAMETERS NEEDING RESPONSE"]],
  },
  "incubator/admin/evaluate": { title: "Evaluate", tables: [] },
  "incubator/admin/assign": { title: "Assign", tables: [] },
  "incubator/admin/jurypipeline": {
    title: "Jury Pipeline",
    tables: [["STARTUP", "JURY MEMBERS & STATUS", "AI SCORE", "JURY SCORE", "AVG. SCORE", "ADDL. PARAMETER SCORES", "ASSIGNED DATE", "STATUS", "ACTION"]],
  },
  "incubator/admin/pmpipeline": {
    title: "Prog manager pipeline",
    tables: [["STARTUP", "AI SCORE", "JURY SCORE", "AVG. SCORE", "ADDL. PARAMETER SCORES", "CALL SCHEDULED", "CALL DATE", "CALL COMPLETED", "SIGN-UP STATUS", "ACTION"]],
  },
  "incubator/admin/introcalls": {
    title: "Intro calls",
    tables: [["STARTUP", "AI SCORE", "JURY SCORE", "AVG. SCORE", "ADDL. PARAMETER SCORES", "CALL SCHEDULED", "CALL DATE", "CALL COMPLETED", "SCHEDULER", "ACTION"]],
  },
  "incubator/admin/incuration": {
    title: "Sign up Pipeline",
    tables: [["STARTUP", "AI SCORE", "JURY SCORE", "AVG. SCORE", "ADDL. PARAMETER SCORES", "CALL SCHEDULED", "CALL DATE", "CALL COMPLETED", "SIGN-UP STATUS", "PAYMENT STATUS", "DOCUMENTS STATUS", "ACTION"]],
  },
  "incubator/admin/curation": {
    title: "Onboard ready",
    tables: [["STARTUP", "COHORT", "CURATION STAGE", "JURY MEMBER LEAD", "PROGRESS", "ACTION"]],
  },
  "incubator/admin/archive": {
    title: "Archive",
    tables: [["STARTUP", "REASON", "STAGE REACHED", "ARCHIVED ON", "ARCHIVED BY", "ACTION"]],
  },
  "incubator/admin/cohortsummary": {
    title: "Cohort summary",
    tables: [["STARTUP", "SECTOR · STAGE", "SCORE", "TOP DRIVER", "RECOMMENDATION"]],
  },
  "incubator/admin/evaluatorscores": {
    title: "Evaluator scores",
    tables: [["EVALUATOR", "ROLE", "DECKS SCORED", "AVG GIVEN", "VS COHORT", "AGREEMENT"]],
  },
  "incubator/admin/scoredrift": {
    title: "Score drift",
    tables: [["STARTUP", "AI PRE-SCORE", "AFTER CLARIFICATION", "FINAL (JUROR)", "NET DRIFT"]],
  },
  "incubator/admin/funnel": { title: "Pipeline funnel", tables: [["STAGE", "COUNT", "% OF UPLOADED", "STEP CONVERSION"]] },
  "incubator/admin/coreparams": {
    title: "Core Parameters — Area weights",
    tables: [["#", "EVALUATION AREA", "TYPE", "WEIGHT %", "VISUAL"]],
  },
  "incubator/admin/myparams": { title: "My Parameters — Role configuration", tables: [] },
  "incubator/admin/setup": { title: "Set up your workspace", tables: [] },
  "incubator/admin/account": { title: "Create your account", tables: [] },
  "incubator/admin/admin": {
    title: "Admin console",
    tables: [["MEMBER", "ROLE", "ORGANIZATIONAL TITLE", "TYPE", "STATUS", "ACTION"]],
  },
  "incubator/admin/billing": { title: "Choose your plan", tables: [] },
  "incubator/admin/contactadmin": { title: "Contact Admin", tables: [] },
  "incubator/admin/contactteam": { title: "Contact team", tables: [] },
  "incubator/admin/support": { title: "Tickets", tables: [["SUBJECT", "FROM", "ROUTING", "STATUS", "RAISED", ""]] },
  "incubator/admin/issues": {
    title: "Issue log",
    tables: [["ISSUE", "AREA", "SEVERITY", "STATUS", "OWNER", "RAISED", "AGE"]],
  },

  // ── incubator/program_manager · 19 screens ──
  "incubator/program_manager/alldecks": {
    title: "All decks",
    tables: [["STARTUP", "FOUNDER NAME", "EMAIL ID", "PHONE NUMBER", "CITY", "SECTOR", "STATUS"]],
  },
  "incubator/program_manager/upload": { title: "Upload your first pitchdecks", tables: [] },
  "incubator/program_manager/query": {
    title: "Founder queries",
    tables: [["", "STARTUP", "FOUNDER", "PHONE", "EMAIL", "STATUS", "PARAMETERS NEEDING RESPONSE"]],
  },
  "incubator/program_manager/evaluate": { title: "Evaluate", tables: [] },
  "incubator/program_manager/assign": { title: "Assign", tables: [] },
  "incubator/program_manager/jurypipeline": {
    title: "Jury Pipeline",
    tables: [["STARTUP", "JURY MEMBERS & STATUS", "AI SCORE", "JURY SCORE", "AVG. SCORE", "ADDL. PARAMETER SCORES", "ASSIGNED DATE", "STATUS", "ACTION"]],
  },
  "incubator/program_manager/pmpipeline": {
    title: "Prog manager pipeline",
    tables: [["STARTUP", "AI SCORE", "JURY SCORE", "AVG. SCORE", "ADDL. PARAMETER SCORES", "CALL SCHEDULED", "CALL DATE", "CALL COMPLETED", "SIGN-UP STATUS", "ACTION"]],
  },
  "incubator/program_manager/introcalls": {
    title: "Intro calls",
    tables: [["STARTUP", "AI SCORE", "JURY SCORE", "AVG. SCORE", "ADDL. PARAMETER SCORES", "CALL SCHEDULED", "CALL DATE", "CALL COMPLETED", "SCHEDULER", "ACTION"]],
  },
  "incubator/program_manager/incuration": {
    title: "Sign up Pipeline",
    tables: [["STARTUP", "AI SCORE", "JURY SCORE", "AVG. SCORE", "ADDL. PARAMETER SCORES", "CALL SCHEDULED", "CALL DATE", "CALL COMPLETED", "SIGN-UP STATUS", "PAYMENT STATUS", "DOCUMENTS STATUS", "ACTION"]],
  },
  "incubator/program_manager/curation": {
    title: "Onboard ready",
    tables: [["STARTUP", "COHORT", "CURATION STAGE", "JURY MEMBER LEAD", "PROGRESS", "ACTION"]],
  },
  "incubator/program_manager/archive": {
    title: "Archive",
    tables: [["STARTUP", "REASON", "STAGE REACHED", "ARCHIVED ON", "ARCHIVED BY", "ACTION"]],
  },
  "incubator/program_manager/cohortsummary": {
    title: "Cohort summary",
    tables: [["STARTUP", "SECTOR · STAGE", "SCORE", "TOP DRIVER", "RECOMMENDATION"]],
  },
  "incubator/program_manager/evaluatorscores": {
    title: "Evaluator scores",
    tables: [["EVALUATOR", "ROLE", "DECKS SCORED", "AVG GIVEN", "VS COHORT", "AGREEMENT"]],
  },
  "incubator/program_manager/scoredrift": {
    title: "Score drift",
    tables: [["STARTUP", "AI PRE-SCORE", "AFTER CLARIFICATION", "FINAL (JUROR)", "NET DRIFT"]],
  },
  "incubator/program_manager/funnel": {
    title: "Pipeline funnel",
    tables: [["STAGE", "COUNT", "% OF UPLOADED", "STEP CONVERSION"]],
  },
  "incubator/program_manager/myparams": { title: "My Parameters — Role configuration", tables: [] },
  "incubator/program_manager/setup": { title: "Set up your workspace", tables: [] },
  "incubator/program_manager/account": { title: "My account", tables: [] },
  "incubator/program_manager/contactadmin": { title: "Contact Admin", tables: [] },
  "incubator/program_manager/contactteam": { title: "Contact team", tables: [] },
  "incubator/program_manager/issues": {
    title: "Issue log",
    tables: [["ISSUE", "AREA", "SEVERITY", "STATUS", "OWNER", "RAISED", "AGE"]],
  },

  // ── incubator/program_associate · 19 screens ──
  "incubator/program_associate/alldecks": {
    title: "All decks",
    tables: [["STARTUP", "FOUNDER NAME", "EMAIL ID", "PHONE NUMBER", "CITY", "SECTOR", "STATUS"]],
  },
  "incubator/program_associate/upload": { title: "Upload your first pitchdecks", tables: [] },
  "incubator/program_associate/query": {
    title: "Founder queries",
    tables: [["", "STARTUP", "FOUNDER", "PHONE", "EMAIL", "STATUS", "PARAMETERS NEEDING RESPONSE"]],
  },
  "incubator/program_associate/evaluate": { title: "Evaluate", tables: [] },
  "incubator/program_associate/assign": { title: "Assign", tables: [] },
  "incubator/program_associate/introcalls": {
    title: "Intro calls",
    tables: [["STARTUP", "AI SCORE", "JURY SCORE", "AVG. SCORE", "ADDL. PARAMETER SCORES", "CALL SCHEDULED", "CALL DATE", "CALL COMPLETED", "SCHEDULER", "ACTION"]],
  },
  "incubator/program_associate/incuration": {
    title: "Sign up Pipeline",
    tables: [["STARTUP", "AI SCORE", "JURY SCORE", "AVG. SCORE", "ADDL. PARAMETER SCORES", "CALL SCHEDULED", "CALL DATE", "CALL COMPLETED", "SIGN-UP STATUS", "PAYMENT STATUS", "DOCUMENTS STATUS", "ACTION"]],
  },
  "incubator/program_associate/curation": {
    title: "Onboard ready",
    tables: [["STARTUP", "COHORT", "CURATION STAGE", "JURY MEMBER LEAD", "PROGRESS", "ACTION"]],
  },
  "incubator/program_associate/archive": {
    title: "Archive",
    tables: [["STARTUP", "REASON", "STAGE REACHED", "ARCHIVED ON", "ARCHIVED BY", "ACTION"]],
  },
  "incubator/program_associate/cohortsummary": {
    title: "Cohort summary",
    tables: [["STARTUP", "SECTOR · STAGE", "SCORE", "TOP DRIVER", "RECOMMENDATION"]],
  },
  "incubator/program_associate/evaluatorscores": {
    title: "Evaluator scores",
    tables: [["EVALUATOR", "ROLE", "DECKS SCORED", "AVG GIVEN", "VS COHORT", "AGREEMENT"]],
  },
  "incubator/program_associate/scoredrift": {
    title: "Score drift",
    tables: [["STARTUP", "AI PRE-SCORE", "AFTER CLARIFICATION", "FINAL (JUROR)", "NET DRIFT"]],
  },
  "incubator/program_associate/funnel": {
    title: "Pipeline funnel",
    tables: [["STAGE", "COUNT", "% OF UPLOADED", "STEP CONVERSION"]],
  },
  "incubator/program_associate/myparams": { title: "My Parameters — Role configuration", tables: [] },
  "incubator/program_associate/setup": { title: "Set up your workspace", tables: [] },
  "incubator/program_associate/account": { title: "My account", tables: [] },
  "incubator/program_associate/contactadmin": { title: "Contact Admin", tables: [] },
  "incubator/program_associate/contactteam": { title: "Contact team", tables: [] },
  "incubator/program_associate/issues": {
    title: "Issue log",
    tables: [["ISSUE", "AREA", "SEVERITY", "STATUS", "OWNER", "RAISED", "AGE"]],
  },

  // ── incubator/jury · 13 screens ──
  "incubator/jury/alldecks": {
    title: "All decks",
    // W7-A — the jury build's "My Pipeline" (`mpRender()`), not the staff table.
    tables: [["STARTUP", "STATUS", "AI SCORE", "ASSIGNED BY", "ASSIGNED DATE", "DUE DATE"]],
  },
  "incubator/jury/jassigned": { title: "Evaluate", tables: [] },
  "incubator/jury/jurypipeline": {
    title: "Jury Pipeline",
    tables: [["STARTUP", "JURY MEMBERS & STATUS", "AI SCORE", "JURY SCORE", "AVG. SCORE", "ADDL. PARAMETER SCORES", "ASSIGNED DATE", "STATUS", "ACTION"]],
  },
  "incubator/jury/introcalls": {
    title: "My Intro calls",
    tables: [["STARTUP", "AI SCORE", "PARAMETERS SCORE", "ADDL. PARAMETERS SCORE", "MY SCORE", "AV. SCORE", "CALL SCHEDULED", "CALL DATE", "CALL TIME", "CALL COMPLETED", "SCHEDULED BY", "VIEW CALENDAR", "ARCHIVE"]],
  },
  "incubator/jury/archive": {
    title: "Archive",
    tables: [["STARTUP", "REASON", "STAGE REACHED", "ARCHIVED ON", "ARCHIVED BY", "ACTION"]],
  },
  "incubator/jury/repdecks": { title: "My decks summary", tables: [["STARTUP", "STATUS", "MY SCORE", "AI SCORE", "SUBMITTED"]] },
  "incubator/jury/repscores": { title: "My Scores", tables: [["STARTUP", "AI SCORE", "MY SCORE", "Δ (MY − AI)"]] },
  "incubator/jury/repdrift": { title: "My scores drift", tables: [] },
  "incubator/jury/myparams": { title: "My Parameters — Role configuration", tables: [] },
  "incubator/jury/account": { title: "My account", tables: [] },
  "incubator/jury/contactadmin": { title: "Contact Admin", tables: [] },
  "incubator/jury/contactteam": { title: "Contact team", tables: [] },
  "incubator/jury/issues": {
    title: "Issue log",
    tables: [["ISSUE", "AREA", "SEVERITY", "STATUS", "OWNER", "RAISED", "AGE"]],
  },

  // ── incubator/founder · 4 screens ──
  "incubator/founder/founder-home": { title: "My Startup", tables: [] },
  "incubator/founder/founder-upload": { title: "Upload pitch decks", tables: [] },
  "incubator/founder/founder-queries": { title: "Queries", tables: [] },
  "incubator/founder/founder-signup": { title: "Sign up", tables: [] },

  // ── vc/superuser · 32 screens ──
  "vc/superuser/alldecks": {
    title: "All decks",
    tables: [["STARTUP", "FOUNDER NAME", "EMAIL ID", "PHONE", "CITY", "SECTOR", "STATUS"]],
  },
  "vc/superuser/upload": { title: "Upload your first pitchdecks", tables: [] },
  "vc/superuser/query": {
    title: "Founder queries",
    tables: [["", "STARTUP", "FOUNDER", "PHONE", "EMAIL", "STATUS", "PARAMETERS NEEDING RESPONSE"]],
  },
  "vc/superuser/evaluate": { title: "Evaluate", tables: [] },
  "vc/superuser/assign": { title: "Evaluate", tables: [] },
  "vc/superuser/jurypipeline": {
    title: "Assoc. Pipeline",
    tables: [["STARTUP", "EVALUATORS & STATUS", "AI SCORE", "JURY SCORE", "AVG. SCORE", "ADDL. PARAMETER SCORES", "ASSIGNED DATE", "STATUS", "ACTION"]],
  },
  "vc/superuser/introcalls": {
    title: "Intro calls",
    tables: [["STARTUP", "AI SCORE", "ANALYST SCORE", "AVG. SCORE", "ADDL. PARAMETER SCORES", "CALL SCHEDULED", "CALL DATE", "CALL COMPLETED", "SCHEDULE CALL", "ASSIGN SCHEDULER"]],
  },
  "vc/superuser/partnerpipeline": {
    title: "Partner Pipeline",
    tables: [["STARTUP", "SECTOR", "AI SCORE", "JURY SCORE", "AVG. SCORE", "ADDL. PARAMETER SCORES", "STATUS", "ACTION"]],
  },
  "vc/superuser/partnercall": {
    title: "Partner call",
    tables: [["STARTUP", "AI SCORE", "PARTNER", "AVG. SCORE", "ADDL. PARAMETER SCORES", "CALL SCHEDULED", "CALL DATE", "CALL COMPLETED", "SCHEDULE CALL", "SPONSORSHIP"]],
  },
  "vc/superuser/investmentdd": {
    title: "Investment DD",
    tables: [["STARTUP", "SECTOR", "AI SCORE", "AVG. SCORE", "ADDL. PARAMETER SCORES", "STATUS", "ACTION"]],
  },
  "vc/superuser/icpipeline": { title: "IC Pipeline", tables: [] },
  "vc/superuser/alignmentcall": {
    title: "Alignment call",
    tables: [["STARTUP", "AI SCORE", "PARTNER", "AVG. SCORE", "ADDL. PARAMETER SCORES", "CALL SCHEDULED", "CALL DATE", "CALL COMPLETED", "SCHEDULE CALL", "OUTCOME"]],
  },
  "vc/superuser/incuration": {
    title: "Term sheet Pipeline",
    tables: [["STARTUP", "SECTOR", "AI SCORE", "AVG. SCORE", "STATUS", "ACTION"]],
  },
  "vc/superuser/legaldd": {
    title: "Legal DD",
    tables: [["STARTUP", "SECTOR", "AI SCORE", "AVG. SCORE", "STATUS", "ACTION"]],
  },
  "vc/superuser/curation": {
    title: "Onboard ready",
    tables: [["STARTUP", "COHORT", "CURATION STAGE", "JURY MEMBER LEAD", "PROGRESS", "STATUS"]],
  },
  "vc/superuser/archive": {
    title: "Archive",
    tables: [["STARTUP", "REASON", "STAGE REACHED", "ARCHIVED ON", "ARCHIVED BY", "ACTION"]],
  },
  "vc/superuser/funnel": { title: "Pipeline Funnel", tables: [["STAGE", "COUNT", "% OF TOP", "STEP CONVERSION"]] },
  "vc/superuser/capital": { title: "Capital Deployment & Pacing", tables: [] },
  "vc/superuser/portfolio": { title: "Portfolio Construction", tables: [] },
  "vc/superuser/scoring": {
    title: "Scoring Summary",
    tables: [["STARTUP", "AI", "EVALUATOR AVG", "VARIANCE", "SPREAD", "LEAN"]],
  },
  "vc/superuser/diligence": { title: "Diligence & Risk Status", tables: [["COMPANY", "STAGE", "SIGNAL", "STATUS"]] },
  "vc/superuser/decisions": { title: "Decision History", tables: [["DATE", "COMPANY", "DECISION", "LEAD", "NOTE"]] },
  "vc/superuser/coreparams": {
    title: "Core Parameters — Area weights",
    tables: [["#", "EVALUATION AREA", "TYPE", "WEIGHT %", "VISUAL"]],
  },
  "vc/superuser/myparams": { title: "My Parameters — Role configuration", tables: [] },
  "vc/superuser/setup": { title: "Set up your workspace", tables: [] },
  "vc/superuser/account": { title: "Create your account", tables: [] },
  "vc/superuser/admin": {
    title: "Admin console",
    tables: [["MEMBER", "ROLE", "ORGANIZATIONAL TITLE", "TYPE", "STATUS", "ACTION"]],
  },
  "vc/superuser/billing": { title: "Choose your plan", tables: [] },
  "vc/superuser/contactadmin": { title: "Contact Admin", tables: [] },
  "vc/superuser/contactteam": { title: "Contact team", tables: [] },
  "vc/superuser/support": { title: "Tickets", tables: [["SUBJECT", "FROM", "ROUTING", "STATUS", "RAISED", ""]] },
  "vc/superuser/issues": {
    title: "Issue log",
    tables: [["ISSUE", "AREA", "SEVERITY", "STATUS", "OWNER", "RAISED", "AGE"]],
  },

  // ── vc/admin · 32 screens ──
  "vc/admin/alldecks": {
    title: "All decks",
    tables: [["STARTUP", "FOUNDER NAME", "EMAIL ID", "PHONE", "CITY", "SECTOR", "STATUS"]],
  },
  "vc/admin/upload": { title: "Upload your first pitchdecks", tables: [] },
  "vc/admin/query": {
    title: "Founder queries",
    tables: [["", "STARTUP", "FOUNDER", "PHONE", "EMAIL", "STATUS", "PARAMETERS NEEDING RESPONSE"]],
  },
  "vc/admin/evaluate": { title: "Evaluate", tables: [] },
  "vc/admin/assign": { title: "Evaluate", tables: [] },
  "vc/admin/jurypipeline": {
    title: "Assoc. Pipeline",
    tables: [["STARTUP", "EVALUATORS & STATUS", "AI SCORE", "JURY SCORE", "AVG. SCORE", "ADDL. PARAMETER SCORES", "ASSIGNED DATE", "STATUS", "ACTION"]],
  },
  "vc/admin/introcalls": {
    title: "Intro calls",
    tables: [["STARTUP", "AI SCORE", "ANALYST SCORE", "AVG. SCORE", "ADDL. PARAMETER SCORES", "CALL SCHEDULED", "CALL DATE", "CALL COMPLETED", "SCHEDULE CALL", "ASSIGN SCHEDULER"]],
  },
  "vc/admin/partnerpipeline": {
    title: "Partner Pipeline",
    tables: [["STARTUP", "SECTOR", "AI SCORE", "JURY SCORE", "AVG. SCORE", "ADDL. PARAMETER SCORES", "STATUS", "ACTION"]],
  },
  "vc/admin/partnercall": {
    title: "Partner call",
    tables: [["STARTUP", "AI SCORE", "PARTNER", "AVG. SCORE", "ADDL. PARAMETER SCORES", "CALL SCHEDULED", "CALL DATE", "CALL COMPLETED", "SCHEDULE CALL", "SPONSORSHIP"]],
  },
  "vc/admin/investmentdd": {
    title: "Investment DD",
    tables: [["STARTUP", "SECTOR", "AI SCORE", "AVG. SCORE", "ADDL. PARAMETER SCORES", "STATUS", "ACTION"]],
  },
  "vc/admin/icpipeline": { title: "IC Pipeline", tables: [] },
  "vc/admin/alignmentcall": {
    title: "Alignment call",
    tables: [["STARTUP", "AI SCORE", "PARTNER", "AVG. SCORE", "ADDL. PARAMETER SCORES", "CALL SCHEDULED", "CALL DATE", "CALL COMPLETED", "SCHEDULE CALL", "OUTCOME"]],
  },
  "vc/admin/incuration": {
    title: "Term sheet Pipeline",
    tables: [["STARTUP", "SECTOR", "AI SCORE", "AVG. SCORE", "STATUS", "ACTION"]],
  },
  "vc/admin/legaldd": {
    title: "Legal DD",
    tables: [["STARTUP", "SECTOR", "AI SCORE", "AVG. SCORE", "STATUS", "ACTION"]],
  },
  "vc/admin/curation": {
    title: "Onboard ready",
    tables: [["STARTUP", "COHORT", "CURATION STAGE", "JURY MEMBER LEAD", "PROGRESS", "STATUS"]],
  },
  "vc/admin/archive": {
    title: "Archive",
    tables: [["STARTUP", "REASON", "STAGE REACHED", "ARCHIVED ON", "ARCHIVED BY", "ACTION"]],
  },
  "vc/admin/funnel": { title: "Pipeline Funnel", tables: [["STAGE", "COUNT", "% OF TOP", "STEP CONVERSION"]] },
  "vc/admin/capital": { title: "Capital Deployment & Pacing", tables: [] },
  "vc/admin/portfolio": { title: "Portfolio Construction", tables: [] },
  "vc/admin/scoring": {
    title: "Scoring Summary",
    tables: [["STARTUP", "AI", "EVALUATOR AVG", "VARIANCE", "SPREAD", "LEAN"]],
  },
  "vc/admin/diligence": { title: "Diligence & Risk Status", tables: [["COMPANY", "STAGE", "SIGNAL", "STATUS"]] },
  "vc/admin/decisions": { title: "Decision History", tables: [["DATE", "COMPANY", "DECISION", "LEAD", "NOTE"]] },
  "vc/admin/coreparams": {
    title: "Core Parameters — Area weights",
    tables: [["#", "EVALUATION AREA", "TYPE", "WEIGHT %", "VISUAL"]],
  },
  "vc/admin/myparams": { title: "My Parameters — Role configuration", tables: [] },
  "vc/admin/setup": { title: "Set up your workspace", tables: [] },
  "vc/admin/account": { title: "Create your account", tables: [] },
  "vc/admin/admin": {
    title: "Admin console",
    tables: [["MEMBER", "ROLE", "ORGANIZATIONAL TITLE", "TYPE", "STATUS", "ACTION"]],
  },
  "vc/admin/billing": { title: "Choose your plan", tables: [] },
  "vc/admin/contactadmin": { title: "Contact Admin", tables: [] },
  "vc/admin/contactteam": { title: "Contact team", tables: [] },
  "vc/admin/support": { title: "Tickets", tables: [["SUBJECT", "FROM", "ROUTING", "STATUS", "RAISED", ""]] },
  "vc/admin/issues": {
    title: "Issue log",
    tables: [["ISSUE", "AREA", "SEVERITY", "STATUS", "OWNER", "RAISED", "AGE"]],
  },

  // ── vc/partner · 23 screens ──
  "vc/partner/alldecks": {
    title: "All decks",
    tables: [["STARTUP", "FOUNDER NAME", "EMAIL ID", "PHONE", "CITY", "SECTOR", "STATUS"]],
  },
  "vc/partner/upload": { title: "Upload your first pitchdecks", tables: [] },
  "vc/partner/evaluate": { title: "Evaluate", tables: [] },
  "vc/partner/introcalls": {
    title: "Intro calls",
    tables: [["STARTUP", "AI SCORE", "ANALYST SCORE", "AVG. SCORE", "ADDL. PARAMETER SCORES", "CALL SCHEDULED", "CALL DATE", "CALL COMPLETED", "SCHEDULE CALL", "ASSIGN SCHEDULER"]],
  },
  "vc/partner/partnerpipeline": {
    title: "Partner Pipeline",
    tables: [["STARTUP", "SECTOR", "AI SCORE", "JURY SCORE", "AVG. SCORE", "ADDL. PARAMETER SCORES", "STATUS", "ACTION"]],
  },
  "vc/partner/partnercall": {
    title: "Partner call",
    tables: [["STARTUP", "AI SCORE", "PARTNER", "AVG. SCORE", "ADDL. PARAMETER SCORES", "CALL SCHEDULED", "CALL DATE", "CALL COMPLETED", "SCHEDULE CALL", "SPONSORSHIP"]],
  },
  "vc/partner/investmentdd": {
    title: "Investment DD",
    tables: [["STARTUP", "SECTOR", "AI SCORE", "AVG. SCORE", "ADDL. PARAMETER SCORES", "STATUS", "ACTION"]],
  },
  "vc/partner/icpipeline": { title: "IC Pipeline", tables: [] },
  "vc/partner/alignmentcall": {
    title: "Alignment call",
    tables: [["STARTUP", "AI SCORE", "PARTNER", "AVG. SCORE", "ADDL. PARAMETER SCORES", "CALL SCHEDULED", "CALL DATE", "CALL COMPLETED", "SCHEDULE CALL", "OUTCOME"]],
  },
  "vc/partner/incuration": {
    title: "Term sheet Pipeline",
    tables: [["STARTUP", "SECTOR", "AI SCORE", "AVG. SCORE", "STATUS", "ACTION"]],
  },
  "vc/partner/legaldd": {
    title: "Legal DD",
    tables: [["STARTUP", "SECTOR", "AI SCORE", "AVG. SCORE", "STATUS", "ACTION"]],
  },
  "vc/partner/curation": {
    title: "Onboard ready",
    tables: [["STARTUP", "COHORT", "CURATION STAGE", "JURY MEMBER LEAD", "PROGRESS", "STATUS"]],
  },
  "vc/partner/archive": {
    title: "Archive",
    tables: [["STARTUP", "REASON", "STAGE REACHED", "ARCHIVED ON", "ARCHIVED BY", "ACTION"]],
  },
  "vc/partner/funnel": { title: "Pipeline Funnel", tables: [["STAGE", "COUNT", "% OF TOP", "STEP CONVERSION"]] },
  "vc/partner/capital": { title: "Capital Deployment & Pacing", tables: [] },
  "vc/partner/portfolio": { title: "Portfolio Construction", tables: [] },
  "vc/partner/scoring": {
    title: "Scoring Summary",
    tables: [["STARTUP", "AI", "EVALUATOR AVG", "VARIANCE", "SPREAD", "LEAN"]],
  },
  "vc/partner/diligence": { title: "Diligence & Risk Status", tables: [["COMPANY", "STAGE", "SIGNAL", "STATUS"]] },
  "vc/partner/decisions": { title: "Decision History", tables: [["DATE", "COMPANY", "DECISION", "LEAD", "NOTE"]] },
  "vc/partner/myparams": { title: "My Parameters — Role configuration", tables: [] },
  "vc/partner/account": { title: "My account", tables: [] },
  "vc/partner/contactadmin": { title: "Contact Admin", tables: [] },
  "vc/partner/contactteam": { title: "Contact team", tables: [] },
  "vc/partner/issues": {
    title: "Issue log",
    tables: [["ISSUE", "AREA", "SEVERITY", "STATUS", "OWNER", "RAISED", "AGE"]],
  },

  // ── vc/ic_member · 19 screens ──
  "vc/ic_member/alldecks": {
    title: "All decks",
    tables: [["STARTUP", "FOUNDER NAME", "EMAIL ID", "PHONE", "CITY", "SECTOR", "STATUS"]],
  },
  "vc/ic_member/evaluate": { title: "Evaluate", tables: [] },
  "vc/ic_member/introcalls": { title: "My Intro calls", tables: [] },
  "vc/ic_member/partnerpipeline": {
    title: "Partner Pipeline",
    tables: [["STARTUP", "SECTOR", "AI SCORE", "JURY SCORE", "AVG. SCORE", "ADDL. PARAMETER SCORES", "STATUS", "ACTION"]],
  },
  "vc/ic_member/investmentdd": {
    title: "Investment DD",
    tables: [["STARTUP", "SECTOR", "AI SCORE", "AVG. SCORE", "ADDL. PARAMETER SCORES", "STATUS", "ACTION"]],
  },
  "vc/ic_member/icpipeline": { title: "IC Pipeline", tables: [] },
  "vc/ic_member/alignmentcall": {
    title: "Alignment call",
    tables: [["STARTUP", "AI SCORE", "MY SCORE", "AVG. SCORE", "ADDL. PARAMETER SCORES", "CALL SCHEDULED", "CALL DATE", "CALL COMPLETED", "VIEW CALENDAR", "ARCHIVE"]],
  },
  "vc/ic_member/curation": {
    title: "Onboard ready",
    tables: [["STARTUP", "COHORT", "CURATION STAGE", "JURY MEMBER LEAD", "PROGRESS", "STATUS"]],
  },
  "vc/ic_member/archive": {
    title: "Archive",
    tables: [["STARTUP", "REASON", "STAGE REACHED", "ARCHIVED ON", "ARCHIVED BY", "ACTION"]],
  },
  "vc/ic_member/capital": { title: "Capital Deployment & Pacing", tables: [] },
  "vc/ic_member/portfolio": { title: "Portfolio Construction", tables: [] },
  "vc/ic_member/scoring": {
    title: "Scoring Summary",
    tables: [["STARTUP", "AI", "EVALUATOR AVG", "VARIANCE", "SPREAD", "LEAN"]],
  },
  "vc/ic_member/diligence": { title: "Diligence & Risk Status", tables: [["COMPANY", "STAGE", "SIGNAL", "STATUS"]] },
  "vc/ic_member/decisions": { title: "Decision History", tables: [["DATE", "COMPANY", "DECISION", "LEAD", "NOTE"]] },
  "vc/ic_member/myparams": { title: "My Parameters — Role configuration", tables: [] },
  "vc/ic_member/account": { title: "My account", tables: [] },
  "vc/ic_member/contactadmin": { title: "Contact Admin", tables: [] },
  "vc/ic_member/contactteam": { title: "Contact team", tables: [] },
  "vc/ic_member/issues": {
    title: "Issue log",
    tables: [["ISSUE", "AREA", "SEVERITY", "STATUS", "OWNER", "RAISED", "AGE"]],
  },

  // ── vc/associate · 19 screens ──
  "vc/associate/alldecks": {
    title: "All decks",
    tables: [["STARTUP", "FOUNDER NAME", "EMAIL ID", "PHONE", "CITY", "SECTOR", "STATUS"]],
  },
  "vc/associate/upload": { title: "Upload your first pitchdecks", tables: [] },
  "vc/associate/query": {
    title: "Founder queries",
    tables: [["", "STARTUP", "FOUNDER", "PHONE", "EMAIL", "STATUS", "PARAMETERS NEEDING RESPONSE"]],
  },
  "vc/associate/evaluate": { title: "Evaluate", tables: [] },
  "vc/associate/assign": { title: "Evaluate", tables: [] },
  "vc/associate/jurypipeline": {
    title: "Assoc. Pipeline",
    tables: [["STARTUP", "EVALUATORS & STATUS", "AI SCORE", "JURY SCORE", "AVG. SCORE", "ADDL. PARAMETER SCORES", "ASSIGNED DATE", "STATUS", "ACTION"]],
  },
  "vc/associate/introcalls": {
    title: "Intro calls",
    tables: [["STARTUP", "AI SCORE", "ANALYST SCORE", "AVG. SCORE", "ADDL. PARAMETER SCORES", "CALL SCHEDULED", "CALL DATE", "CALL COMPLETED", "SCHEDULE CALL", "ASSIGN SCHEDULER"]],
  },
  "vc/associate/archive": {
    title: "Archive",
    tables: [["STARTUP", "REASON", "STAGE REACHED", "ARCHIVED ON", "ARCHIVED BY", "ACTION"]],
  },
  "vc/associate/funnel": { title: "Pipeline Funnel", tables: [["STAGE", "COUNT", "% OF TOP", "STEP CONVERSION"]] },
  "vc/associate/capital": { title: "Capital Deployment & Pacing", tables: [] },
  "vc/associate/portfolio": { title: "Portfolio Construction", tables: [] },
  "vc/associate/scoring": {
    title: "Scoring Summary",
    tables: [["STARTUP", "AI", "EVALUATOR AVG", "VARIANCE", "SPREAD", "LEAN"]],
  },
  "vc/associate/diligence": { title: "Diligence & Risk Status", tables: [["COMPANY", "STAGE", "SIGNAL", "STATUS"]] },
  "vc/associate/decisions": { title: "Decision History", tables: [["DATE", "COMPANY", "DECISION", "LEAD", "NOTE"]] },
  "vc/associate/myparams": { title: "My Parameters — Role configuration", tables: [] },
  "vc/associate/account": { title: "My account", tables: [] },
  "vc/associate/contactadmin": { title: "Contact Admin", tables: [] },
  "vc/associate/contactteam": { title: "Contact team", tables: [] },
  "vc/associate/issues": {
    title: "Issue log",
    tables: [["ISSUE", "AREA", "SEVERITY", "STATUS", "OWNER", "RAISED", "AGE"]],
  },

  // ── vc/analyst · 13 screens ──
  "vc/analyst/alldecks": {
    title: "All decks",
    tables: [["STARTUP", "FOUNDER NAME", "EMAIL ID", "PHONE", "CITY", "SECTOR", "STATUS"]],
  },
  "vc/analyst/upload": { title: "Upload your first pitchdecks", tables: [] },
  "vc/analyst/query": {
    title: "Founder queries",
    tables: [["", "STARTUP", "FOUNDER", "PHONE", "EMAIL", "STATUS", "PARAMETERS NEEDING RESPONSE"]],
  },
  "vc/analyst/evaluate": { title: "Evaluate", tables: [] },
  "vc/analyst/assign": { title: "Evaluate", tables: [] },
  "vc/analyst/introcalls": {
    title: "My Intro calls",
    tables: [["STARTUP", "AI SCORE", "ANALYST SCORE", "AVG. SCORE", "ADDL. PARAMETER SCORES", "CALL SCHEDULED", "CALL DATE", "CALL COMPLETED", "SCHEDULE CALL", "ASSIGN SCHEDULER"]],
  },
  "vc/analyst/archive": {
    title: "Archive",
    tables: [["STARTUP", "REASON", "STAGE REACHED", "ARCHIVED ON", "ARCHIVED BY", "ACTION"]],
  },
  "vc/analyst/scoring": {
    title: "Scoring Summary",
    tables: [["STARTUP", "AI", "EVALUATOR AVG", "VARIANCE", "SPREAD", "LEAN"]],
  },
  "vc/analyst/myparams": { title: "My Parameters — Role configuration", tables: [] },
  "vc/analyst/account": { title: "My account", tables: [] },
  "vc/analyst/contactadmin": { title: "Contact Admin", tables: [] },
  "vc/analyst/contactteam": { title: "Contact team", tables: [] },
  "vc/analyst/issues": {
    title: "Issue log",
    tables: [["ISSUE", "AREA", "SEVERITY", "STATUS", "OWNER", "RAISED", "AGE"]],
  },
};
