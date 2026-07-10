import { test, expect } from "@playwright/test";

test("home renders and reports a healthy API", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "ai.STARTUPJURY" }),
  ).toBeVisible();
  await expect(page.getByTestId("health")).toHaveText("API health: ok", {
    timeout: 15_000,
  });
});
