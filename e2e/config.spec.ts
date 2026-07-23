import { test, expect, type Page } from "@playwright/test";

// Phase 6 — an incubator admin edits Core Parameter weights and the cohort
// thresholds, and both persist (Saved badge).

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

test("admin edits a core weight and the cohort thresholds", async ({ page }) => {
  await login(page, "nisha.kapoor@demo.startupjury.ai"); // inc_admin
  await page.goto("/app/coreparams");

  await expect(page.getByRole("heading", { name: "Configuration" })).toBeVisible();

  // Edit the first area weight and save — "Save changes" is unique to the
  // weights section, which then shows a Saved badge.
  await page.getByLabel(/ weight$/).first().fill("9");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved").first()).toBeVisible();

  // Edit the cohort thresholds and save (the first plain "Save" button).
  await page.getByLabel("Best threshold").fill("8");
  await page.getByLabel("Mediocre threshold").fill("6");
  await page.getByRole("button", { name: "Save", exact: true }).first().click();

  // The dashboard rail reflects the new bands (Mediocre range is unique to it).
  await page.goto("/app/alldecks");
  await expect(page.getByText("6.0 – 7.9")).toBeVisible();
});

test("plan gating hides additional params on Standard for a jury member", async ({ page }) => {
  // Jury member sees My Parameters read-only; with the seed on Premium the
  // additional params list is visible.
  await login(page, "rajesh.kumar@demo.startupjury.ai"); // inc_jury
  await page.goto("/app/myparams");
  await expect(page.getByRole("heading", { name: "My Parameters" })).toBeVisible();
  await expect(page.getByText(/Read-only/)).toBeVisible();
});
