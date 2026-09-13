import { test, expect, type Page } from "@playwright/test";

// W8-A — one staff report and one jury report, each walked by a real role in a
// real browser, asserting the prototype's exact column headers and KPI/section
// labels. Read-only: nothing here mutates the seed, and every assertion is
// gated on a POPULATED element (a table header or a tile), never on a heading
// the loading branch could also render.

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

test("incubator admin: Evaluator scores renders the prototype's calibration report", async ({ page }) => {
  await login(page, "nisha.kapoor@demo.startupjury.ai"); // inc_admin
  await page.goto("/app/evaluatorscores");

  // `panel-evaluatorscores.html` thead, verbatim.
  await expect(page.locator("thead th")).toHaveText(["Evaluator", "Role", "Decks scored", "Avg given", "vs cohort", "Agreement"], {
    timeout: 30_000,
  });
  await expect(page.getByRole("heading", { level: 1, name: "Evaluator scores" })).toBeVisible();
  await expect(page.getByTestId("rep-kpi")).toHaveCount(5);
  for (const label of ["Active evaluators", "Avg inter-rater agreement", "Mean deviation from cohort", "Most lenient scorer", "Strictest scorer"]) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole("heading", { level: 2, name: "Evaluator calibration" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export PDF" })).toBeVisible();
});

test("incubator jury: My Scores renders the prototype's four tiles and columns", async ({ page }) => {
  await login(page, "rajesh.kumar@demo.startupjury.ai"); // inc_jury
  await page.goto("/app/repscores");

  // `repRenderScores` thead, verbatim.
  await expect(page.locator("thead th")).toHaveText(["Startup", "AI score", "My score", "Δ (my − AI)"], { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1, name: "My Scores" })).toBeVisible();
  await expect(page.getByTestId("sc-tile")).toHaveCount(4);
  for (const label of ["Avg my score", "Avg AI score", "Above AI", "Below AI"]) {
    await expect(page.getByTestId("sc-tile").filter({ hasText: label })).toHaveCount(1);
  }
  await expect(page.getByRole("heading", { level: 2, name: "My score vs AI score" })).toBeVisible();
  // The jury prototype's topbar carries no export.
  await expect(page.getByRole("button", { name: "Export PDF" })).toHaveCount(0);
});
