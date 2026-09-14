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
  // W8-A — the prototype's card is "Stage breakdown" (`panel-funnel.html`); the
  // old "Stage breakdown & conversion" was this application's wording, and it
  // survives only on the VC funnel.
  await expect(page.getByRole("heading", { name: "Stage breakdown", exact: true })).toBeVisible();
});

test("VC admin sees capital deployment and decision history", async ({ page }) => {
  await login(page, "nisha.kapoor.vc@demo.startupjury.ai"); // vc_admin

  await page.goto("/app/capital");
  await expect(page.getByRole("heading", { name: "Capital Deployment & Pacing" })).toBeVisible();
  // W9-D — the prototype's card is "Deployed vs. dry powder" (`panel-capital.html`);
  // "Deployed vs. allocated vs. committed" was this application's wording.
  await expect(page.getByRole("heading", { name: "Deployed vs. dry powder" })).toBeVisible();

  await page.goto("/app/decisions");
  await expect(page.getByRole("heading", { name: "Decision History" })).toBeVisible();
  // `exact` matters: the shell's caption also contains the words "decision log",
  // so a substring match resolves to two elements as soon as the report has rows
  // (which it does once any VC spec has recorded a decision). That ambiguity is
  // what made this assertion flake in earlier sessions.
  await expect(page.getByText("Decision log", { exact: true })).toBeVisible();
});

test("a jury member raises a support ticket and contacts admin", async ({ page }) => {
  await login(page, "rajesh.kumar@demo.startupjury.ai"); // inc_jury

  await page.goto("/app/contactadmin");
  await expect(page.getByRole("heading", { name: "Contact Admin" })).toBeVisible();
  await page.getByLabel("Message").fill("Please reassign the TaxPilot deck.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Please reassign the TaxPilot deck.")).toBeVisible();
});
