import { test, expect } from "@playwright/test";

test("unauthenticated root redirects to the branded login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByLabel("ai.STARTUPJURY")).toBeVisible();
});

test("API health reports ok", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBeTruthy();
  expect((await res.json()).status).toBe("ok");
});
