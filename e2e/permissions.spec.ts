import { test, expect, type Page, request as playwrightRequest } from "@playwright/test";

/**
 * W3-A — the runtime permission engine, end to end.
 *
 * The journey the Admin console's Task permissions grid depicts: an
 * administrator unticks one cell, and the role that lost it stops seeing the
 * sidebar item AND can no longer open the route by URL. Before this session the
 * only way to do that was a code change and a redeploy.
 *
 * The spec puts every cell back in `afterEach` — `e2e:serve` seeds the local D1
 * once, and a permission left switched off would follow the suite into every
 * later spec (§2.3 on re-running against a mutated seed).
 */

const ADMIN = "nisha.kapoor@demo.startupjury.ai";
const PA = "sunita.rao@demo.startupjury.ai";
const PASSWORD = "demo1234";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

/** Toggle a cell over the API as an administrator, outside the browser session. */
async function setCell(baseURL: string, role: string, taskId: string, granted: boolean) {
  const api = await playwrightRequest.newContext({ baseURL });
  const login = await api.post("/api/auth/login", { data: { email: ADMIN, password: PASSWORD } });
  expect(login.ok()).toBeTruthy();
  const res = await api.put("/api/permissions", { data: { cells: [{ role, taskId, granted }] } });
  expect(res.ok(), `PUT /api/permissions ${role}/${taskId}=${granted}`).toBeTruthy();
  await api.dispose();
}

test.describe("task permissions gate the product at runtime", () => {
  test.afterEach(async ({ baseURL }) => {
    await setCell(baseURL!, "program_associate", "signuppipeline", true);
  });

  test("unticking a cell removes the sidebar item and 403s the route", async ({ page, baseURL }) => {
    await login(page, PA);
    const nav = page.locator('nav[aria-label="Primary"] a');

    // The associate owns Sign up Pipeline today.
    await expect(nav.filter({ hasText: "Sign up Pipeline" })).toHaveCount(1);
    await page.goto("/app/incuration");
    await expect(page.getByRole("heading", { name: "Not available for your role" })).toHaveCount(0);

    await setCell(baseURL!, "program_associate", "signuppipeline", false);

    // A reload re-resolves the principal (`GET /api/auth/me`) — no re-login.
    await page.reload();
    await expect(nav.filter({ hasText: "Sign up Pipeline" })).toHaveCount(0);
    // The neighbouring item the same role holds is untouched.
    await expect(nav.filter({ hasText: "Onboard ready" })).toHaveCount(1);

    // And the URL is refused, not merely hidden.
    await page.goto("/app/incuration");
    await expect(page.getByRole("heading", { name: "Not available for your role" })).toBeVisible();
  });

  test("the same cell leaves every other role alone", async ({ page, baseURL }) => {
    await setCell(baseURL!, "program_associate", "signuppipeline", false);
    await login(page, ADMIN);
    await expect(page.locator('nav[aria-label="Primary"] a').filter({ hasText: "Sign up Pipeline" })).toHaveCount(1);
    await page.goto("/app/incuration");
    await expect(page.getByRole("heading", { name: "Not available for your role" })).toHaveCount(0);
  });
});

test.describe("§8 Q5 — the Program Manager reaches the post-intro-call stages", () => {
  test("PM opens Sign up Pipeline and Onboard ready", async ({ page }) => {
    await login(page, "raj.kumar@demo.startupjury.ai");
    const nav = page.locator('nav[aria-label="Primary"] a');
    await expect(nav.filter({ hasText: "Sign up Pipeline" })).toHaveCount(1);
    await expect(nav.filter({ hasText: "Onboard ready" })).toHaveCount(1);
    for (const slug of ["incuration", "curation"]) {
      await page.goto(`/app/${slug}`);
      await expect(page.getByRole("heading", { name: "Not available for your role" })).toHaveCount(0);
    }
  });
});

test.describe("F0917 — the VC partner reaches the screen they already vote on", () => {
  test("partner opens IC Pipeline", async ({ page }) => {
    await login(page, "ishaan.sethi@demo.startupjury.ai");
    await expect(page.locator('nav[aria-label="Primary"] a').filter({ hasText: "IC Pipeline" })).toHaveCount(1);
    await page.goto("/app/icpipeline");
    await expect(page.getByRole("heading", { name: "Not available for your role" })).toHaveCount(0);
  });
});
