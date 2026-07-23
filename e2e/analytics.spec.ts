import { test, expect, type Page } from "@playwright/test";

// Phase 7 — analytics report screens render real aggregates for one incubator
// and one VC role, plus tickets/contact submit.

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

test("incubator admin sees the cohort summary and pipeline funnel", async ({ page }) => {
  await login(page, "nisha.kapoor@demo.startupjury.ai"); // inc_admin

  await page.goto("/app/cohortsummary");
  await expect(page.getByRole("heading", { name: "Cohort summary" })).toBeVisible();
  await expect(page.getByText("Decks evaluated")).toBeVisible();
  await expect(page.getByText("Score distribution")).toBeVisible();

  await page.goto("/app/funnel");
  await expect(page.getByRole("heading", { name: "Pipeline funnel" })).toBeVisible();
  await expect(page.getByText("Stage breakdown & conversion")).toBeVisible();
});

test("VC admin sees capital deployment and decision history", async ({ page }) => {
  await login(page, "nisha.kapoor.vc@demo.startupjury.ai"); // vc_admin

  await page.goto("/app/capital");
  await expect(page.getByRole("heading", { name: "Capital Deployment & Pacing" })).toBeVisible();
  await expect(page.getByText("Deployed vs. committed")).toBeVisible();

  await page.goto("/app/decisions");
  await expect(page.getByRole("heading", { name: "Decision History" })).toBeVisible();
  await expect(page.getByText("Decision log")).toBeVisible();
});

test("a jury member raises a support ticket and contacts admin", async ({ page }) => {
  await login(page, "rajesh.kumar@demo.startupjury.ai"); // inc_jury

  await page.goto("/app/contactadmin");
  await expect(page.getByRole("heading", { name: "Contact Admin" })).toBeVisible();
  await page.getByLabel("Message").fill("Please reassign the TaxPilot deck.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Please reassign the TaxPilot deck.")).toBeVisible();
});
