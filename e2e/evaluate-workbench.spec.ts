import { test, expect, type Page } from "@playwright/test";

// Session 1 — Evaluator Workbench, end-to-end against the seeded local D1.
// Seed fixtures with a full AI breakdown + a matching AI evaluation (0010):
//   • inc_deck_taxpilot  — assigned to the incubator jury member
//   • vc_deck_wealthos    — VC associate_review stage

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

test("incubator juror works a deck in the evaluator workbench", async ({ page }) => {
  await login(page, "rajesh.kumar@demo.startupjury.ai"); // inc jury
  await page.goto("/app/jassigned");
  await expect(page.getByRole("heading", { name: "Assigned to me" })).toBeVisible();

  // R7-JURY — `jassigned` is the jury prototype's `panel-jassigned` allocation
  // table now, not the v15 three-panel launcher. Clicking the startup NAME
  // still opens the workbench (`jrOpen(i)`), so only the locator moves: the
  // table row's name button, exact, because the row's Parameter scores cell is
  // also labelled "…for TaxPilot".
  await page.getByRole("row", { name: /TaxPilot/ }).getByRole("button", { name: "TaxPilot", exact: true }).click();
  const workbench = page.getByRole("dialog", { name: /Evaluate TaxPilot/ });
  await expect(workbench.getByRole("heading", { name: "TaxPilot" })).toBeVisible();

  // AI · My · Average summary tiles. Scoped to the dialog: the allocation
  // table behind it has an "AI Score" column header of its own now.
  await expect(workbench.getByText("AI Score", { exact: true })).toBeVisible();
  await expect(workbench.getByText("My Score", { exact: true })).toBeVisible();
  await expect(workbench.getByText("Average", { exact: true })).toBeVisible();

  // Per-parameter AI breakdown (score rationale) is visible on the scorecard.
  await expect(page.getByText("No climate or sustainability angle presented.")).toBeVisible();

  // In-app deck viewer. This asserted the graceful "no PDF" path until F-FOUL:
  // every seeded deck was fileless, so the workbench's own empty state was the
  // only thing this fixture could show. `0081_seed_deck_files.sql` plus
  // `npm run seed:deck-assets` (wired into `e2e:serve`) give the 30 seeded decks
  // that carry evaluation data a real PDF, so TaxPilot now has one — which is
  // the point, since a juror was previously able to score a deck nobody could
  // open. The empty state itself is still covered, against the fixtures that
  // keep it: `inc_deck_pitchloop` and the three `incomplete` decks.
  //
  // "Open PDF" rather than a rendered slide: it is present in both the `ready`
  // and `error` viewer states, so this does not turn a pdf.js rendering hiccup
  // in CI into a failure about deck files.
  await expect(page.getByText("Pitch deck")).toBeVisible();
  await expect(page.getByText("No PDF stored for this deck")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Open PDF/ })).toBeVisible();

  // Deck X-of-N queue progress.
  await expect(page.getByText(/Deck \d+ of \d+/)).toBeVisible();

  // Research opens the juror's own external AIs.
  await page.getByRole("button", { name: /Research/ }).click();
  await expect(page.getByRole("menuitem", { name: "ChatGPT" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Perplexity" })).toBeVisible();
  await page.keyboard.press("Escape");

  // The rescore-guard control is present. (The block/allow outcome depends on the
  // edition's criteria_version, which the parallel config e2e mutates, so the
  // deterministic block assertion lives in the VC flow + the worker/client tests.)
  await expect(page.getByRole("button", { name: /Re-run AI score/ })).toBeEnabled();
});

test("VC evaluator sees the workbench and the rescore guard", async ({ page }) => {
  await login(page, "rhea.nair@demo.startupjury.ai"); // vc analyst
  await page.goto("/app/evaluate");
  await expect(page.getByRole("heading", { name: "Evaluate" })).toBeVisible();

  await page.getByRole("button", { name: /WealthOS/ }).click();
  await expect(page.getByRole("heading", { name: "WealthOS" })).toBeVisible();

  await expect(page.getByText("AI Score", { exact: true })).toBeVisible();
  await expect(page.getByText("My Score", { exact: true })).toBeVisible();
  await expect(page.getByText("Average", { exact: true })).toBeVisible();
  // AI breakdown rationale from the seed.
  await expect(page.getByText("Repeat fintech operators with regulatory experience.")).toBeVisible();

  // W2-A / plan §9 — the guard used to answer "Already scored" for every seeded
  // deck, because `0025` rewrote all eighteen AI prompts and never bumped
  // `org_settings.criteria_version`, so a rubric that HAD changed still read as
  // current. Migration `0038` bumps it, and the guard lets the request past its
  // version check.
  //
  // It then used to stop on the seeded deck's MISSING PDF — and this step
  // asserted that message. `0081` (F-FOUL) ended that: the 30 seeded decks
  // carrying evaluation data now have real files, because a deck with scores
  // and no deck is the "Foul" the client reported. WealthOS is one of them, so
  // the honest answer here is no longer "No stored PDF".
  //
  // The refusal itself did not lose coverage — it moved to where a fileless
  // deck still exists: `test/worker/deck-file-guard.test.ts:99,117` and
  // `test/worker/deck-scope.test.ts:300` all assert `no_pdf`. What this step
  // proves now is the part it was always really about: the request gets PAST
  // the version check rather than being turned away by a stale comparison.
  await page.getByRole("button", { name: /Re-run AI score/ }).click();
  await expect(page.getByText("No stored PDF to re-score.")).toHaveCount(0);
  await expect(
    page.getByText(/Already scored — nothing has changed/),
    "the stale-version refusal must not come back",
  ).toHaveCount(0);
  await expect(page.getByText(/Already scored/)).toHaveCount(0);
});
