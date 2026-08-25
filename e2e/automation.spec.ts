import { test, expect, type Page } from "@playwright/test";

// Session 5 — Automation, end-to-end against the seeded local D1:
//   • the per-program shortlist floor (set in Set up, surfaced on the workbench)
//   • upload validation — the required founder/contact columns on the form
//   • bulk upload's "AI extracts the details" intake copy
//
// The floor's *block* is asserted exhaustively in test/worker/automation.test.ts
// rather than here: raising a seeded program's floor would race the parallel
// incubator/config specs that shortlist against those same programs.

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

test("admin sets a per-program shortlist minimum in the Set up wizard", async ({ page }) => {
  await login(page, "nisha.kapoor@demo.startupjury.ai"); // inc_admin
  await page.goto("/app/setup");
  await page.getByRole("button", { name: "Continue" }).click();

  // A fresh program of our own, so we never move a seeded program's floor under
  // the specs running in parallel.
  const name = `Floor QA ${Date.now()}`;
  await page.getByLabel("Program name").fill(name);
  await page.getByLabel("Shortlist minimum (0–10)").fill("9.4");
  await page.getByRole("button", { name: "Add program" }).click();

  const row = page.locator("li").filter({ hasText: name });
  await expect(row).toBeVisible();
  await expect(row.getByText("Shortlist min 9.4")).toBeVisible();

  // The floor is editable in place afterwards (the admin's escape hatch when it
  // is holding a deck back).
  const field = row.getByLabel(`Shortlist minimum for ${name}`);
  await expect(field).toHaveValue("9.4");
  await field.fill("6.5");
  await row.getByRole("button", { name: "Save" }).click();
  await expect(page.locator("li").filter({ hasText: name }).getByText("Shortlist min 6.5")).toBeVisible();
});

test("the evaluator workbench shows the program's shortlist minimum", async ({ page }) => {
  await login(page, "rajesh.kumar@demo.startupjury.ai"); // inc jury
  await page.goto("/app/jassigned");
  await expect(page.getByRole("heading", { name: "Evaluate" })).toBeVisible();

  // TaxPilot sits in Climate Cohort, whose seeded floor is 5.5 (migration 0016).
  // Aug-2026 issue 19 — the workbench opens from panel 1's Score button.
  await page
    .locator("li", { hasText: "TaxPilot" })
    .getByRole("button", { name: "Score", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "TaxPilot" })).toBeVisible();
  await expect(page.getByText(/Shortlist minimum 5\.5 · this deck \d\.\d\d/)).toBeVisible();
});

test("upload collects the required founder details and explains the Incomplete rule", async ({ page }) => {
  await login(page, "sunita.rao@demo.startupjury.ai"); // inc_pa
  await page.goto("/app/upload");

  await expect(page.getByRole("heading", { name: "Upload pitch decks" })).toBeVisible();
  await expect(page.getByText("Required founder details")).toBeVisible();

  // All five required intake columns are on the form.
  for (const label of ["Founder name *", "Founder email *", "Phone *", "City *", "Sector *"]) {
    await expect(page.getByLabel(label)).toBeVisible();
  }

  // With the form empty, the page says the AI will look for them and what
  // happens when it can't find them.
  await expect(page.getByText(/The AI will look for founder name/)).toBeVisible();
  await expect(page.getByText(/marks the deck Incomplete/)).toBeVisible();

  // Filling a column removes it from the "AI will look for" list.
  await page.getByLabel("Founder name *").fill("Meera Sharma");
  await expect(page.getByText(/The AI will look for founder email/)).toBeVisible();

  // Bulk mode has no per-deck form — the AI extracts every detail.
  await page.getByRole("button", { name: /Bulk upload/ }).click();
  await expect(page.getByText(/No per-deck form on a bulk upload/)).toBeVisible();
});
