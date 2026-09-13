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

  // W8-B (F0515 / F0519) — the screen carries the prototype's panel title now,
  // not the application's old "Configuration" heading.
  await expect(page.getByRole("heading", { name: "Core Parameters — Area weights" })).toBeVisible();

  // Edit two area weights and save — "Save changes" is unique to the weights
  // section, which then shows a Saved badge.
  //
  // W2-A / F0153 — the rubric must still total 100 % ("Total must equal 100%"
  // in the prototype's own footer), which the server now enforces and the Save
  // button now respects, so moving one weight up means moving another down.
  // The behaviour under test — an admin edits a weight and it persists — is
  // unchanged; only the payload had to become a legal one.
  const weightInputs = page.getByLabel(/ weight$/);
  await weightInputs.first().fill("9");
  await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await weightInputs.last().fill("3");
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

test("a jury member sees My Parameters read-only with role-scoped additional params", async ({ page }) => {
  // Jury member sees My Parameters read-only; with the seed on Premium the
  // role-scoped additional params (grouped by owner role) are visible.
  await login(page, "rajesh.kumar@demo.startupjury.ai"); // inc_jury
  await page.goto("/app/myparams");
  await expect(page.getByRole("heading", { name: "My Parameters" })).toBeVisible();
  // One seeded jury-owned additional param label is visible — the specs' §6.2
  // canonical name (migration 0025).
  await expect(page.getByText("Barriers of entry").first()).toBeVisible();
  await expect(page.getByText(/Read-only/).first()).toBeVisible();
});
