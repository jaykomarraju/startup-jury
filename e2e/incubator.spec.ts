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

  // Aug-2026 issue 22 — four panels: decks → role → members → allocation.
  await page.getByRole("checkbox", { name: "Select FinStack" }).check();
  await page.getByRole("button", { name: /^Jury Member/ }).click();
  await page.getByRole("checkbox", { name: "Select Rajesh Kumar" }).check();

  // Panel 4 previews the allocation before anything is written.
  const summary = page.locator("li", { hasText: "FinStack" }).last();
  await expect(summary).toContainText("Rajesh Kumar");

  await page.getByRole("button", { name: /Confirm assignment/ }).click();
  await expect(page.getByText(/Assignment confirmed/)).toBeVisible();
  await expect(page.getByText("FinStack → Rajesh Kumar", { exact: false })).toBeVisible();
});

test("jury member scores an assigned deck and shortlists it", async ({ page }) => {
  await login(page, "rajesh.kumar@demo.startupjury.ai");
  // Jury reaches the scoring form via their "Assigned" nav item.
  await page.goto("/app/jassigned");

  await expect(page.getByRole("heading", { name: "Evaluate" })).toBeVisible();
  // Issue 19 — panel 1 lists the startups; Score opens the workbench.
  await page
    .locator("li", { hasText: "InsureFlow" })
    .getByRole("button", { name: "Score", exact: true })
    .click();

  // The evaluator workbench opens with the AI · My · Average tiles.
  await expect(page.getByRole("heading", { name: "InsureFlow" })).toBeVisible();
  await expect(page.getByText("My Score", { exact: true })).toBeVisible();
  await expect(page.getByText("Average", { exact: true })).toBeVisible();

  // The jury's role-scoped additional params render in their own section
  // (assistive, not folded into the core-13 composite).
  await expect(page.getByText("Additional parameters · your lens")).toBeVisible();
  await expect(page.getByText("Founder Resilience & Coachability").first()).toBeVisible();

  await page.getByRole("button", { name: "Shortlist" }).click();

  // Deck leaves the to-evaluate list once shortlisted.
  await expect(page.getByRole("button", { name: /InsureFlow/ })).toBeHidden();
});

test("staff query an incomplete deck; it records a sent query", async ({ page }) => {
  await login(page, "sunita.rao@demo.startupjury.ai");
  await page.goto("/app/query");

  // Aug-2026 issues 15–18 — two tabs; tick the startups, then send from the
  // Email query tab.
  await expect(page.getByRole("heading", { name: "Founder queries" })).toBeVisible();
  // PayRoute seeds at incomplete.
  await page.getByRole("checkbox", { name: "Select PayRoute" }).check();
  await page.getByRole("tab", { name: /Email query/ }).click();

  // The recipient and a generated message covering its areas are prefilled.
  await expect(page.getByText(/vikram@payroute\.in/)).toBeVisible();
  const body = page.getByRole("textbox", { name: "Body" });
  await expect(body).toContainText("PayRoute");
  await body.fill("Please share MRR, churn, and team size.");
  await page.getByRole("button", { name: "Send query" }).click();

  await expect(page.getByText(/Query sent to 1 founder/)).toBeVisible();

  // The drill-down records it against the startup.
  await page.getByRole("tab", { name: /Founder queries/ }).click();
  await page.getByRole("button", { name: "PayRoute" }).click();
  await expect(page.getByText(/Please share MRR/)).toBeVisible();
});
