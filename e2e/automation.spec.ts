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
  // R3-SETUP · item 6 — the admin's wizard opens on Configure; the Org-type step
  // this used to click past is deleted for them. Gate on the step's OWN content
  // before typing, never on the heading, which every step shares.
  await expect(page.getByLabel("Program name")).toBeVisible();

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
  await expect(page.getByRole("heading", { name: "Assigned to me" })).toBeVisible();

  // TaxPilot sits in Climate Cohort, whose seeded floor is 5.5 (migration 0016).
  // R7-JURY — the workbench now opens from the `panel-jassigned` table row's
  // startup name rather than from the v15 deck list (§4 is unchanged: there is
  // still no Score button).
  await page.getByRole("row", { name: /TaxPilot/ }).getByRole("button", { name: "TaxPilot", exact: true }).click();
  await expect(page.getByRole("heading", { name: "TaxPilot" })).toBeVisible();
  await expect(page.getByText(/Shortlist minimum 5\.5 · this deck \d\.\d\d/)).toBeVisible();
});

test("upload collects the required founder details and explains the Incomplete rule", async ({ page }) => {
  await login(page, "sunita.rao@demo.startupjury.ai"); // inc_pa
  await page.goto("/app/upload");

  // W7-B: the prototype's heading, and the founder columns folded under a
  // disclosure. Sector is no longer one of them — it is a select beside Cohort,
  // taken from the workspace, and never marks a deck Incomplete (F0227).
  await expect(page.getByRole("heading", { name: "Upload your first pitchdecks" })).toBeVisible();
  await page.getByRole("button", { name: /Required founder details/ }).click();

  // All four extracted intake columns are on the form.
  for (const label of ["Founder name *", "Founder email *", "Phone *", "City *"]) {
    await expect(page.getByLabel(label)).toBeVisible();
  }
  await expect(page.getByLabel("Sector *")).toHaveCount(0);
  await expect(page.getByLabel("Sector", { exact: true })).toBeVisible();

  // With the form empty, the page says the AI will look for them and what
  // happens when it can't find them.
  await expect(page.getByText(/The AI will look for founder name/)).toBeVisible();
  await expect(page.getByText(/marks the deck Incomplete/)).toBeVisible();

  // Filling a column removes it from the "AI will look for" list.
  await page.getByLabel("Founder name *").fill("Meera Sharma");
  await expect(page.getByText(/The AI will look for founder email/)).toBeVisible();

  // Bulk mode has no per-deck form — the AI extracts every detail.
  await page.getByRole("radio", { name: /Bulk upload/ }).click();
  await expect(page.getByText(/No per-deck form on a bulk upload/)).toBeVisible();
});
