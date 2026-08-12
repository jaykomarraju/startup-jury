import { test, expect, type Page } from "@playwright/test";

// Session 2 — the Set up wizard creates a program in the hierarchy, and the
// dashboard's Program/Cohort toolbar filters feed the decks list.

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

test("admin adds a program via the Set up wizard; it appears in the toolbar filter", async ({ page }) => {
  await login(page, "nisha.kapoor@demo.startupjury.ai"); // inc_admin
  await page.goto("/app/setup");

  await expect(page.getByRole("heading", { name: "Set up your workspace" })).toBeVisible();

  // Step 1 (Org type) → Continue advances to Configure.
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 2 (Configure): add a program.
  await expect(page.getByText("The umbrella over everything")).toBeVisible();
  await page.getByLabel("Program name").fill("Wizard QA Program");
  await page.getByRole("button", { name: "Add program" }).click();

  // It shows up in the programs list (scoped to the list item, not the cohort
  // editor's program <option> of the same name).
  await expect(page.locator("li").filter({ hasText: "Wizard QA Program" })).toBeVisible();

  // And it's now selectable in the dashboard's Program filter dropdown.
  await page.goto("/app/alldecks");
  await expect(page.getByLabel("Program filter")).toContainText("Wizard QA Program");
});

test("dashboard Program filter scopes the decks list to a program", async ({ page }) => {
  await login(page, "nisha.kapoor@demo.startupjury.ai"); // inc_admin
  await page.goto("/app/alldecks");

  const programFilter = page.getByLabel("Program filter");
  await expect(programFilter).toBeVisible();
  await expect(programFilter).toContainText("Climate Cohort");

  // Selecting a seeded program updates the header context line.
  await programFilter.selectOption({ label: "Climate Cohort" });
  await expect(page.getByText(/· Climate Cohort/)).toBeVisible();
});
