import { test, expect, type Page } from "@playwright/test";

/**
 * JURYbuddy — Support → Help, end to end (V3 item 15).
 *
 * The client test covers the view machine; this covers what only a real browser
 * and a real Worker can show: the sidebar entry reaches a real screen (not the
 * stub), the FAQ text is served from the bundle with no video in it, and the
 * clip route's 404 — the state the app ships in until the clips are uploaded to
 * R2 — leaves the answer readable rather than breaking the screen.
 *
 * ONE SIGN-IN PER TEST, per the runbook.
 */

const SUPERUSER = "priya.sharma@demo.startupjury.ai";
const JURY = "rajesh.kumar@demo.startupjury.ai";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

test("the sidebar's Help entry opens a real screen, not the stub", async ({ page }) => {
  await login(page, SUPERUSER);
  await page.getByRole("link", { name: "Help" }).click();
  await expect(page).toHaveURL(/\/app\/help$/);
  await expect(page.getByRole("heading", { name: "Help", level: 1 })).toBeVisible();
  // The tells that a nav id has no route wired to it.
  await expect(page.getByText("coming soon")).toHaveCount(0);
  await expect(page.getByText("Not available for your role")).toHaveCount(0);
  // Gate on the POPULATED list, not the heading the frame always draws.
  await expect(page.getByTestId("help-popular").getByRole("button")).toHaveCount(4);
});

test("searching narrows to an answer, and the answer carries its text", async ({ page }) => {
  await login(page, SUPERUSER);
  await page.goto("/app/help");
  await page.getByLabel("Search the FAQs").fill("free trial");
  const results = page.getByTestId("help-results");
  await expect(results.getByRole("button").first()).toContainText(
    "Is there a free trial, or do I have to pay first?",
  );
  await results.getByRole("button").first().click();
  await expect(
    page.getByRole("heading", { name: "Is there a free trial, or do I have to pay first?" }),
  ).toBeVisible();
  await expect(page.getByText(/try 3 free credits/)).toBeVisible();
});

test("a missing clip leaves the answer readable", async ({ page }) => {
  await login(page, SUPERUSER);
  await page.goto("/app/help");
  await page.getByTestId("help-popular").getByRole("button").first().click();
  await page.getByRole("button", { name: /^Watch \(/ }).click();
  // The bucket is empty until the clips are uploaded, so the route 404s and the
  // player retires itself. If the clips ARE uploaded this passes the other way,
  // with a <video> on screen — so assert the invariant both states share: the
  // answer text is still there and nothing reads as an error.
  await expect(page.getByRole("heading", { level: 2 })).toBeVisible();
  const gone = page.getByText(/isn't available yet/);
  const playing = page.getByTestId("help-clip");
  await expect(async () => {
    expect((await gone.count()) + (await playing.count())).toBeGreaterThan(0);
  }).toPass({ timeout: 10_000 });
});

test("the clip route needs a session and 404s for an unknown clip", async ({ page, request }) => {
  // No cookie on this context's API client yet — the route must refuse it.
  expect((await request.get("/api/help/clips/faq_clip_1")).status()).toBe(401);

  await login(page, JURY);
  const res = await page.request.get("/api/help/clips/faq_clip_1");
  expect(res.status()).toBe(404);
  expect(await res.json()).toEqual({ error: "no_clip" });
});

test("a jury member reaches Help too — it is not an admin screen", async ({ page }) => {
  await login(page, JURY);
  await expect(page.getByRole("link", { name: "Help" })).toBeVisible();
  await page.goto("/app/help");
  await expect(page.getByRole("heading", { name: "Help", level: 1 })).toBeVisible();
  await expect(page.getByTestId("help-popular").getByRole("button")).toHaveCount(4);
});
