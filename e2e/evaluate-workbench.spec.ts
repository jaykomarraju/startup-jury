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
  await expect(page.getByRole("heading", { name: "Evaluate" })).toBeVisible();

  await page.getByRole("button", { name: /TaxPilot/ }).click();
  await expect(page.getByRole("heading", { name: "TaxPilot" })).toBeVisible();

  // AI · My · Average summary tiles.
  await expect(page.getByText("AI Score", { exact: true })).toBeVisible();
  await expect(page.getByText("My Score", { exact: true })).toBeVisible();
  await expect(page.getByText("Average", { exact: true })).toBeVisible();

  // Per-parameter AI breakdown (score rationale) is visible on the scorecard.
  await expect(page.getByText("No climate or sustainability angle presented.")).toBeVisible();

  // In-app deck viewer (graceful "no PDF" for the seed fixture).
  await expect(page.getByText("Pitch deck")).toBeVisible();
  await expect(page.getByText("No PDF stored for this deck")).toBeVisible();

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

  await page.getByRole("button", { name: /Re-run AI score/ }).click();
  await expect(page.getByText(/Already scored/)).toBeVisible();
});
