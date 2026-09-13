import { test, expect, type Page } from "@playwright/test";
import { NAV_BY_EDITION, navForUser } from "../src/shared/nav";

// Session 8 — the coverage sweep.
//
// Sessions 1–7 each tested the screen they built, which left whole families of
// screens with no browser coverage at all: every `StagePage` slug in both
// editions, the founder portal, eight of the twelve analytics reports, the
// support queue, and the two dashboard banners. This file closes that.
//
// Everything here is READ-ONLY on shared state. The suite runs `fullyParallel`
// against one local D1, so a spec that mutates a seeded row races the others
// (the Session-5/6/7 notes record two real instances of exactly that). Mutations
// live in the per-feature specs, on decks nothing else touches.

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

const INC_SUPER = "priya.sharma@demo.startupjury.ai";
const INC_ADMIN = "nisha.kapoor@demo.startupjury.ai";
const INC_JURY = "rajesh.kumar@demo.startupjury.ai";
const INC_FOUNDER = "meera.sharma@demo.startupjury.ai";
const VC_SUPER = "aarav.khanna@demo.startupjury.ai";
const VC_ADMIN = "nisha.kapoor.vc@demo.startupjury.ai";
const VC_PARTNER = "ishaan.sethi@demo.startupjury.ai";

/** Nothing anywhere may still be a placeholder. */
async function expectRealScreen(page: Page) {
  await expect(page.getByText("coming soon")).toHaveCount(0);
  await expect(page.getByText("This screen is part of a later build phase")).toHaveCount(0);
  // A screen that failed its guard is also not a real screen.
  await expect(page.getByText("Not available for your role")).toHaveCount(0);
}

// ── The regression guard the finish track was actually aiming at ─────────────

// Each of these walks ~28 slugs sequentially in one test — roughly a second per
// navigation against the default 30s budget, so they pass on an idle machine and
// fail on a busy one, on `main` as much as on any branch. Raised at Wave 1
// integration at the request of W1-A and W1-B, who both hit it while three parity
// worktrees were running suites at once. `e2e/parity.spec.ts` carries the same
// allowance for the same reason.
test("every incubator nav slug renders a real screen, not a stub", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, INC_SUPER);
  // The superuser superset, minus the founder-portal items (a portal slug is
  // founder-only by design — `canSeeNav` gives it no superuser bypass).
  const slugs = navForUser("incubator", "superuser").map((i) => i.id);
  expect(slugs.length).toBeGreaterThan(20);

  for (const slug of slugs) {
    await page.goto(`/app/${slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectRealScreen(page);
  }
});

// Each of these walks ~28 slugs sequentially in one test — roughly a second per
// navigation against the default 30s budget, so they pass on an idle machine and
// fail on a busy one, on `main` as much as on any branch. Raised at Wave 1
// integration at the request of W1-A and W1-B, who both hit it while three parity
// worktrees were running suites at once. `e2e/parity.spec.ts` carries the same
// allowance for the same reason.
test("every VC nav slug renders a real screen, not a stub", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, VC_SUPER);
  const slugs = navForUser("vc", "superuser").map((i) => i.id);
  expect(slugs.length).toBeGreaterThan(20);

  for (const slug of slugs) {
    await page.goto(`/app/${slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectRealScreen(page);
  }
});

test("the nav manifests have no slug the router cannot resolve", async () => {
  // Cheap structural mirror of the two walks above: a slug added to the manifest
  // without a route lands on the fallthrough, which is the stub.
  for (const nav of [NAV_BY_EDITION.incubator, NAV_BY_EDITION.vc]) {
    for (const item of nav) {
      expect(item.id).toMatch(/^[a-z-]+$/);
    }
  }
});

// ── StagePage: twelve slugs across both editions, previously untested ────────

test("incubator stage screens list their decks and open the report drawer", async ({ page }) => {
  await login(page, INC_ADMIN);

  await page.goto("/app/jurypipeline");
  await expect(page.getByRole("heading", { name: "Jury Pipeline" })).toBeVisible();
  // GreenRoute is seeded 'shortlisted' and AgroFresh too, so the stage is live.
  await expect(page.getByRole("row", { name: /GreenRoute/ })).toBeVisible();

  // The startup name is a real button (it was a bare <td onClick> until S8).
  await page.getByRole("button", { name: "GreenRoute" }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  // Session 8 gave every scored deck a full 13-parameter AI breakdown, so the
  // drawer is no longer a headline score with nothing behind it.
  await expect(drawer.getByText("Traction & Validation")).toBeVisible();
});

test("incubator sign-up, onboarding and archive stages are all live", async ({ page }) => {
  await login(page, INC_ADMIN);

  // Aug-2026 issue 28 deleted the "For Sign up" screen; issue 26 added the
  // Program Manager's pipeline in its place in the Evaluation section.
  for (const [slug, heading, deck] of [
    ["pmpipeline", "Prog manager pipeline", /InsureFlow|GreenRoute|AgroFresh/],
    ["incuration", "Sign up Pipeline", /LedgerLite/],
    ["curation", "Onboard ready", /Medixir/],
    ["archive", "Archive", /SolarCircuit/],
  ] as const) {
    await page.goto(`/app/${slug}`);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await expectRealScreen(page);
    await expect(page.getByRole("row", { name: deck }).first()).toBeVisible();
  }
});

test("VC stage screens are live across the diligence path", async ({ page }) => {
  await login(page, VC_PARTNER);

  for (const [slug, deck] of [
    ["partnerpipeline", /AgriChain/],
    ["investmentdd", /SolarNest/],
    ["incuration", /FreshCart/],
    ["legaldd", /CyberVault/],
    ["curation", /QuantIQ/],
    ["archive", /PetPal/],
  ] as const) {
    await page.goto(`/app/${slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectRealScreen(page);
    await expect(page.getByRole("row", { name: deck }).first()).toBeVisible();
  }
});

// ── Founder portal: four screens, previously only asserted via the sidebar ───

test("a founder sees their own startup, queries and sign-up", async ({ page }) => {
  await login(page, INC_FOUNDER);

  await page.goto("/app/founder-home");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expectRealScreen(page);
  // Meera's two seeded decks — and nobody else's.
  await expect(page.getByText("NimbusHR")).toBeVisible();
  await expect(page.getByText("GreenRoute")).toHaveCount(0);

  await page.goto("/app/founder-queries");
  await expectRealScreen(page);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  await page.goto("/app/founder-signup");
  await expectRealScreen(page);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  await page.goto("/app/founder-upload");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expectRealScreen(page);
});

// ── Analytics: the eight reports no spec opened ──────────────────────────────

test("the incubator evaluator and drift reports render real aggregates", async ({ page }) => {
  await login(page, INC_ADMIN);

  await page.goto("/app/evaluatorscores");
  await expect(page.getByRole("heading", { name: "Evaluator scores" })).toBeVisible();
  await expectRealScreen(page);
  // 0008 seeds four incubator evaluators' scores.
  await expect(page.getByText("Rajesh Kumar").first()).toBeVisible();

  await page.goto("/app/scoredrift");
  await expect(page.getByRole("heading", { name: "Score drift" })).toBeVisible();
  await expectRealScreen(page);
});

test("the jury's three personal reports render", async ({ page }) => {
  await login(page, INC_JURY);
  for (const slug of ["repdecks", "repscores", "repdrift"]) {
    await page.goto(`/app/${slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectRealScreen(page);
  }
});

test("the VC portfolio, scoring and diligence reports render", async ({ page }) => {
  await login(page, VC_PARTNER);

  await page.goto("/app/portfolio");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expectRealScreen(page);
  // The 0008 portfolio: 8 funded companies against Fund II's ₹300 Cr.
  await expect(page.getByText(/8/).first()).toBeVisible();

  await page.goto("/app/scoring");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expectRealScreen(page);

  await page.goto("/app/diligence");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expectRealScreen(page);
});

// ── Support queue + the shared team channel ─────────────────────────────────

test("an admin sees the support ticket queue, separate from the issue log", async ({ page }) => {
  await login(page, INC_ADMIN);
  await page.goto("/app/support");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expectRealScreen(page);

  // The two queues share a table and are split by `tickets.category`; neither
  // may ever show the other's rows (worker-tested in both directions).
  await expect(page.getByText("Deck viewer shows a blank first slide")).toHaveCount(0);
});

test("the team channel is a shared broadcast, not the private admin inbox", async ({ page }) => {
  await login(page, INC_JURY);
  await page.goto("/app/contactteam");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expectRealScreen(page);
});

// ── Dashboard banners (both new in Session 7 / refreshed in Session 8) ───────

test("the dashboard surfaces a deck whose AI evaluation failed, with a re-run", async ({ page }) => {
  await login(page, INC_ADMIN);
  await page.goto("/app/alldecks");

  // PitchLoop is seeded failed (0020) so the §9 AI-health surface has something
  // to render. The banner must name the real reason, not the old hardcoded
  // "no AI key configured yet".
  const banner = page.getByText(/could not be evaluated/i);
  await expect(banner).toBeVisible();
  await expect(page.getByRole("button", { name: /Re-run AI/i }).first()).toBeVisible();
  // Deliberately NOT clicked: a re-run re-reserves a credit and re-queues.
});

test("the deck table shows the program a deck belongs to and exports it", async ({ page }) => {
  await login(page, INC_ADMIN);
  await page.goto("/app/alldecks");

  const exportBtn = page.getByRole("button", { name: "Export" });
  await expect(exportBtn).toBeEnabled();

  // The Export control had no handler at all until Session 8.
  const download = await Promise.all([
    page.waitForEvent("download"),
    exportBtn.click(),
  ]).then(([d]) => d);

  expect(download.suggestedFilename()).toMatch(/\.csv$/);
});

// ── Upload: the AI-extracted-details table, never asserted before ────────────

test("the upload screen explains the founder details the AI will extract", async ({ page }) => {
  await login(page, INC_ADMIN);
  await page.goto("/app/upload");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expectRealScreen(page);

  // The founder columns (Session 5) drive Complete vs Incomplete; W7-B folds
  // them under a disclosure, as the prototype's form has no room for them, and
  // Sector sits beside Cohort because it comes from the workspace.
  await page.getByRole("button", { name: /Required founder details/ }).click();
  for (const label of ["Founder", "Email", "Phone", "City", "Sector"]) {
    await expect(page.getByText(label, { exact: false }).first()).toBeVisible();
  }
});

// ── Set up wizard: the last two steps no spec had reached ────────────────────

test("the Set up wizard walks through Select and Team to the dashboard", async ({ page }) => {
  await login(page, INC_ADMIN);
  await page.goto("/app/setup");

  await expect(page.getByRole("heading", { name: "Set up your workspace" })).toBeVisible();

  // Walk Org type → Configure → Select → Team. Wait on each step's OWN content
  // between clicks: the stepper renders all four labels at all times, so
  // asserting on it would match instantly and let the next click race the
  // re-render (the Org-type step awaits a branding save before it advances).
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Sectors", { exact: true })).toBeVisible(); // Configure

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Select your active context")).toBeVisible(); // Select

  await page.getByRole("button", { name: "Continue" }).click();

  // Step 4 used to claim user management was "coming to the Admin console" —
  // it shipped in Session 4 — and then redirected there with an empty state.
  // W6-C replaced that redirect with the prototype's own team step (`#sus-team`,
  // F1032 / F1040 / F1057): this assertion named the empty state's heading,
  // which contradicted the prototype, so it now waits on the populated seat bar.
  await expect(page.getByTestId("seat-bar")).toContainText("seats left for nomination");
  await expect(page.getByRole("heading", { name: "Add team members" })).toBeVisible();
  await expect(page.getByText("Team management is coming")).toHaveCount(0);

  await page.getByRole("button", { name: /Confirm & go to dashboard/ }).click();
  await page.waitForURL("**/app/alldecks");
});

// ── My Parameters: the admin editing path (only the read-only view was tested) ─

test("an admin can edit an additional parameter's AI prompt", async ({ page }) => {
  // VC edition on purpose: the incubator config specs edit weights in parallel.
  //
  // W8-B (§8 Q116): configuring the role parameters now needs the MEMBER's seat
  // to be Premium as well as the workspace, and the seeded Client Admin holds a
  // Pro seat (0052) — so the account that can edit here is the Super User.
  await login(page, VC_SUPER);
  await page.goto("/app/myparams");

  await expect(page.getByRole("heading", { name: "My Parameters" })).toBeVisible();
  await expectRealScreen(page);

  // The three VC owner roles are the prototype's tabs, one role at a time, 3 params each.
  await expect(page.getByRole("tablist", { name: "Owning roles" }).getByRole("tab")).toHaveText([
    "Investment Associate",
    "Partner",
    "IC Member",
  ]);
  await expect(page.getByText("Investment Associate · 3 configurable parameters")).toBeVisible();

  // Premium workspace and Premium seat → the config controls are unlocked.
  await expect(page.getByText(/require the Premium plan/)).toHaveCount(0);
  await expect(page.getByLabel("AI prompt for Thesis fit")).toBeEnabled();
});

test("a Client Admin on a Pro seat sees the role parameters read-only, and is told why", async ({ page }) => {
  // The negative half of the test above (§8 Q116): same workspace, same screen,
  // a Pro seat. The parameters stay visible — greyed, not replaced (F0509).
  await login(page, VC_ADMIN);
  await page.goto("/app/myparams");
  await expectRealScreen(page);
  await expect(page.getByRole("note")).toContainText(
    "the 3 additional parameters require the Premium plan. Your current plan is Pro plan.",
  );
  await expect(page.getByLabel("AI prompt for Thesis fit")).toBeDisabled();
});
