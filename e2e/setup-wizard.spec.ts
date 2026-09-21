import { test, expect, type Page } from "@playwright/test";

/**
 * S2-SETUP — 21-Sep item 7: *"Delete step 1 (Org type) and step 4 (the
 * team/superuser step) from the Set up wizard; only the programme setup
 * remains."*
 *
 * Gated to the incubator SUPER USER (§13: every other role renders exactly as
 * it does today, and the VC edition was not rescoped), and no spec walked the
 * wizard as that principal before this one — `programs` and `automation` walk
 * it as the incubator admin, `seats` as the VC admin, `roles` as the program
 * associate. Those four are this change's negative control and are untouched:
 * they still click through four steps and must still pass.
 *
 * The second test is the other half of the item. `setup/TeamStep.tsx` was the
 * sole importer of `purchaseSeats`, so deleting step 4 removed the only path to
 * buying a seat; §4 Q84's own answer is Team & roles, and this walks it there
 * through the surface rather than trusting the component test.
 */

const INC_SUPER = "priya.sharma@demo.startupjury.ai";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

test("the super user's Set up is the programme setup alone, and Select finishes it", async ({
  page,
}) => {
  await login(page, INC_SUPER);
  await page.goto("/app/setup");
  await expect(page.getByRole("heading", { name: "Set up your workspace" })).toBeVisible();

  // Gate on the STEP'S OWN content, never on the stepper or the heading: both
  // render identically on every step, so either would match instantly and let
  // the next click race the re-render.
  await expect(page.getByText("Sectors", { exact: true })).toBeVisible();

  // Two steps, and it OPENS on Configure — not "Org type hidden but still first".
  await expect(page.locator("ol li")).toHaveCount(2);
  await expect(page.locator("ol")).toHaveText(/1\s*Configure\s*2\s*Select/);

  // Both deleted steps, asserted absent.
  await expect(page.getByText("What best describes your organisation?")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Back$/ })).toHaveCount(0);

  await page.getByRole("button", { name: /Continue/ }).click();
  await expect(page.getByText("Select your active context")).toBeVisible();

  // Select is the last step: its forward button finishes the wizard.
  await expect(page.getByRole("button", { name: /^Continue/ })).toHaveCount(0);
  await page.getByRole("button", { name: /Confirm & go to dashboard/ }).click();
  await page.waitForURL("**/app/alldecks");

  // Step 4 is gone from the journey, not merely skipped past.
  await expect(page.getByRole("heading", { name: "Nominate your super user" })).toHaveCount(0);
});

test("Buy additional seats survives the deletion, in Team & roles", async ({ page }) => {
  await login(page, INC_SUPER);
  await page.goto("/app/admin?section=tm");
  await expect(page.getByTestId("admin-section-title")).toHaveText("Team & roles");

  // The POPULATED bar, not the card's heading — the card renders nothing until
  // `GET /api/seats` lands, and a heading would match before the numbers do.
  const bar = page.getByTestId("seat-bar");
  await expect(bar).toContainText("seats left for nomination");

  await bar.getByRole("button", { name: "Buy a Pro seat" }).click();
  await expect(page.getByRole("heading", { name: "Buy additional seats" })).toBeVisible();
  await expect(page.getByLabel("Pro seats")).toHaveValue("1");
  // The flow replaces the card it was opened from, not the whole section.
  await expect(page.getByTestId("seat-bar")).toHaveCount(0);

  // As far as the payment screen, which still draws no card field anywhere
  // (plan §1.2) — but NOT through Place order: a purchase is a ledger fact that
  // is never undone, and `e2e/credits-billing.spec.ts` asserts this workspace's
  // "Enterprise · 5 seats". `e2e/seats.spec.ts` buys, in the VC workspace, for
  // exactly that reason.
  await page.getByRole("button", { name: /Continue to payment/ }).click();
  await expect(page.getByTestId("seat-order")).toContainText("Pro seat × 1");
  await expect(page.getByTestId("seat-pay").locator("input, textarea")).toHaveCount(0);
  await expect(page.getByText(/card number|cvv/i)).toHaveCount(0);

  // And it comes back to the card it was opened from. The SEAT BAR is the
  // signal, not the permission grid — the grid is on screen throughout, so
  // asserting it would pass without the flow ever having closed.
  await page.getByRole("button", { name: /^Back$/ }).click();
  await expect(page.getByRole("heading", { name: "Buy additional seats" })).toBeVisible();
  await page.getByRole("button", { name: /^Back$/ }).click();
  await expect(page.getByTestId("seat-bar")).toContainText("seats left for nomination");
  await expect(page.getByRole("heading", { name: "Buy additional seats" })).toHaveCount(0);
});
