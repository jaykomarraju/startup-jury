import { test, expect, type Page } from "@playwright/test";

/**
 * V3 item 10 — the reshared superuser prototype's Evaluate toolbar, against the
 * seeded local D1. Read-only: nothing here clicks AI Evaluate, because a real
 * re-score spends a credit and this suite runs fullyParallel over one database.
 *
 * The pairing is the point. Only the superuser prototype was reshared, so the
 * second test is the negative control: a program manager must still see the
 * v15 sub-line and the v15 column-1 label, with no trace of the new surface.
 */

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

/** Settled, not merely mounted: the list arrived, or it arrived empty. */
async function decksSettled(page: Page) {
  await expect(
    page.getByRole("list", { name: "Decks to evaluate" }).or(page.getByText("Nothing to evaluate yet")),
  ).toBeVisible({ timeout: 20_000 });
}

test("the incubator superuser's Evaluate carries the v3 AI Evaluate toolbar", async ({ page }) => {
  await login(page, "priya.sharma@demo.startupjury.ai"); // incubator superuser
  await page.goto("/app/evaluate");
  await expect(page.getByRole("heading", { name: "Evaluate" })).toBeVisible();
  await decksSettled(page);

  await expect(page.getByRole("button", { name: "AI Evaluate" })).toBeVisible();
  await expect(
    page.getByText(
      "Select decks and click AI Evaluate · evaluated decks move to the Assign screen. Click a deck to open its report.",
    ),
  ).toBeVisible();
  await expect(page.getByLabel("Select all decks")).toBeVisible();
  await expect(page.getByTestId("ev-col1-count")).toHaveText("0 selected");

  // v15's copy is gone for this role, on both surfaces.
  await expect(page.getByText("Click a deck to open its evaluation report · set its status alongside")).toHaveCount(0);
  await expect(page.getByTestId("ev-decks-label")).toHaveCount(0);
});

test("a program manager — not rescoped — still sees the v15 Evaluate", async ({ page }) => {
  await login(page, "raj.kumar@demo.startupjury.ai"); // incubator program manager
  await page.goto("/app/evaluate");
  await expect(page.getByRole("heading", { name: "Evaluate" })).toBeVisible();
  await decksSettled(page);

  await expect(page.getByText("Click a deck to open its evaluation report · set its status alongside")).toBeVisible();
  await expect(page.getByTestId("ev-decks-label")).toContainText("click to open report");

  await expect(page.getByRole("button", { name: "AI Evaluate" })).toHaveCount(0);
  await expect(page.getByLabel("Select all decks")).toHaveCount(0);
  await expect(page.getByTestId("ev-col1-count")).toHaveCount(0);
});
