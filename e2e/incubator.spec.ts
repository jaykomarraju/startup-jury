import { test, expect, type Page } from "@playwright/test";

// Phase 4 incubator happy paths against the seeded local D1:
// - FinStack seeds at ai_evaluated (assignable)
// - InsureFlow seeds at jury_evaluation, assigned to the jury member (shortlistable)

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

test("program associate assigns an AI-gated deck to a jury member", async ({ page }) => {
  await login(page, "sunita.rao@demo.startupjury.ai");
  await page.goto("/app/assign");

  await expect(page.getByRole("heading", { name: "Assign" })).toBeVisible();
  const row = page.getByRole("row", { name: /FinStack/ });
  await expect(row).toBeVisible();

  // Pick a jury member and assign.
  await row.locator("select").selectOption({ label: "Rajesh Kumar" });
  await row.getByRole("button", { name: "Assign" }).click();

  // The row flips to the assignee badge + a Reassign button.
  await expect(row.getByRole("button", { name: "Reassign" })).toBeVisible();
  await expect(row.getByText("Rajesh Kumar")).toBeVisible();
});

test("jury member scores an assigned deck and shortlists it", async ({ page }) => {
  await login(page, "rajesh.kumar@demo.startupjury.ai");
  // Jury reaches the scoring form via their "Assigned" nav item.
  await page.goto("/app/jassigned");

  await expect(page.getByRole("heading", { name: "Evaluate" })).toBeVisible();
  await page.getByRole("button", { name: /InsureFlow/ }).click();

  // Scoring form opens with the rubric parameters + a live weighted total.
  await expect(page.getByRole("heading", { name: "InsureFlow" })).toBeVisible();
  await expect(page.getByText("Your weighted total")).toBeVisible();

  await page.getByRole("button", { name: "Shortlist" }).click();

  // Deck leaves the to-evaluate list once shortlisted.
  await expect(page.getByRole("button", { name: /InsureFlow/ })).toBeHidden();
});

test("staff query an incomplete deck; it records a sent query", async ({ page }) => {
  await login(page, "sunita.rao@demo.startupjury.ai");
  await page.goto("/app/query");

  await expect(page.getByRole("heading", { name: "Query", exact: true })).toBeVisible();
  // PayRoute seeds at incomplete.
  await page.getByRole("button", { name: /PayRoute/ }).click();
  await page.getByPlaceholder(/current MRR/).fill("Please share MRR, churn, and team size.");
  await page.getByRole("button", { name: "Send query" }).click();

  await expect(page.getByText("Sent queries")).toBeVisible();
  await expect(page.getByText(/Please share MRR/)).toBeVisible();
});
