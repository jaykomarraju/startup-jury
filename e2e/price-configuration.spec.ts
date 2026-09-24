import { test, expect, type Page } from "@playwright/test";

/**
 * W4-D — Admin console → Price configuration, walked end to end.
 *
 * The journey the prototype depicts: an administrator changes a price, saves it
 * as a draft, sees the preview disagree with what is live, publishes, and the
 * published catalogue moves. Plus the two things that must hold across a
 * reload — the draft survives, and §8 Q1's per-deck columns are nowhere.
 *
 * This spec MUTATES the price catalogue, so it restores the price it changed
 * before it finishes: the suite runs `fullyParallel` against one local D1, and
 * a spec that leaves the seed changed fails on its second pass (§2.3).
 *
 * ── REWRITTEN 24-Sep-2026, and what moved ───────────────────────────────────
 * The catalogue is one document serving every customer
 * (`migrations/0033_price_configuration.sql:6-7`), and until 24-Sep any customer
 * ADMIN could edit and publish it — verified in production. The client:
 * *"this has to be in AISJ Admin control, NOT the client admin."* It is now
 * gated on `PLATFORM_OWNER_EMAILS`, which ships EMPTY so a deployment that
 * forgets it fails closed.
 *
 * So the journey above is no longer an admin's to walk, and this spec asserts
 * what the product now does. **The editor's own behaviour did not lose its
 * coverage, it moved**: `test/worker/pricing.test.ts` (21 assertions) walks
 * draft → publish → rollback against the real routes, and
 * `test/client/priceConfiguration.test.tsx` (22) covers the screen. Both
 * configure an owner; e2e cannot, because `.dev.vars` is gitignored and there
 * is no seeded user who is one. When the real AISJ Admin principal arrives with
 * multi-tenancy (`docs/plan_multitenancy.md`), the walk comes back here with
 * that principal signing in.
 */

const ADMIN = "nisha.kapoor@demo.startupjury.ai";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

test("the price catalogue is not the customer admin's to edit", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, ADMIN);
  await page.goto("/app/admin?section=pc");

  // The section still resolves — this is an authorisation answer, not a 404.
  await expect(page.getByTestId("admin-section-title")).toHaveText("Price configuration");

  // …and it says so in words an operator can act on. "Could not be loaded"
  // would read as a bug and send somebody hunting for one.
  await expect(page.getByText(/managed by ai\.STARTUPJURY/i)).toBeVisible({ timeout: 30_000 });

  // The editor itself is absent: no GST field, no publish control.
  await expect(page.getByTestId("pc-gst-rate")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Publish/ })).toHaveCount(0);
});

test("the admin can still SEE prices everywhere they are quoted", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, ADMIN);
  // The gate is on editing the catalogue, not on reading it. If this regresses,
  // Buy credits and My Account go dark — which is a far worse outcome than the
  // defect being fixed, so it is pinned here rather than assumed.
  const res = await page.request.get("/api/pricing/published");
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { plans?: unknown[] };
  expect(Array.isArray(body.plans) ? body.plans.length : 0).toBeGreaterThan(0);
});
