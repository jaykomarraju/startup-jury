import { test, expect, type Page } from "@playwright/test";

/**
 * S2-SETUP — 21-Sep item 7: *"Delete step 1 (Org type) and step 4 (the
 * team/superuser step) from the Set up wizard; only the programme setup
 * remains."*
 *
 * R3-SETUP — item 6 of the four-role extension widens that to the two roles the
 * client's row names beside the super user: the incubator **admin** and
 * **program manager**. All three walk the same two steps, so the first test is
 * a table over the three seeded principals — and it is worth three walks rather
 * than one, because they arrive by three different routes: the super user
 * through `canSeeNav`'s bypass, the admin as a `full` seat that would otherwise
 * start at Org type, and the programme manager as a `cohorts` seat whose list
 * `stepsFor` had ALREADY sliced (the double-apply hazard, live for the first
 * time).
 *
 * The negative controls are now the program associate — whose three-step
 * read-only wizard item 6 deliberately leaves alone (plan §2 ʰ) and which the
 * third test pins here rather than leaving to `e2e/roles.spec.ts`, which only
 * asserts the banner — and the whole VC edition, walked at four steps by
 * `e2e/seats.spec.ts` as the VC admin. `programs` and `automation` moved with
 * this change; they are the admin's Configure step and no longer click past an
 * Org type step that is not there. `e2e/coverage.spec.ts` walks all four as the
 * incubator admin and is NOT this session's file — its one-line fix is
 * `docs/parity-requests/R3-coverage-setup-walk.patch`.
 *
 * The last test is the other half of the item. `setup/TeamStep.tsx` was the
 * sole importer of `purchaseSeats`, so deleting step 4 removes the only path to
 * buying a seat; §4 Q84's own answer is Team & roles, and this walks it there
 * through the surface rather than trusting the component test. It runs for the
 * admin as well as the super user now — the admin is a `full` seat and loses
 * exactly the same two controls (plan §2 ʷ).
 */

const INC_SUPER = "priya.sharma@demo.startupjury.ai";
const INC_ADMIN = "nisha.kapoor@demo.startupjury.ai";
const INC_PM = "raj.kumar@demo.startupjury.ai";
const INC_PA = "sunita.rao@demo.startupjury.ai";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

for (const [label, email] of [
  ["super user", INC_SUPER],
  ["admin", INC_ADMIN],
  ["program manager", INC_PM],
] as const) {
  test(`the ${label}'s Set up is the programme setup alone, and Select finishes it`, async ({
    page,
  }) => {
    await login(page, email);
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

    // Step 4 is gone from the journey, not merely skipped past — in either of the
    // two shapes it has ever had.
    await expect(page.getByRole("heading", { name: "Nominate your super user" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Add team members" })).toHaveCount(0);
  });
}

/**
 * The negative control, and the one role in the incubator that still has both
 * the step item 6 deletes and the step item 7 did. A `readonly` seat was ALWAYS
 * shown three steps by `stepsFor`'s `slice(1)`; item 6 narrows a `cohorts` seat
 * through the same function, so if either narrowing were ever re-expressed as a
 * second slice this principal would lose Configure — and with it the only screen
 * that tells them their seat is view-only.
 */
test("a program associate still walks three steps, Configure first, banner and all", async ({
  page,
}) => {
  await login(page, INC_PA);
  await page.goto("/app/setup");
  await expect(page.getByText("Sectors", { exact: true })).toBeVisible();

  await expect(page.locator("ol li")).toHaveCount(3);
  await expect(page.locator("ol")).toHaveText(/1\s*Configure\s*2\s*Select\s*3\s*Team/);
  await expect(page.getByText("Read-only — Standard seat", { exact: false })).toBeVisible();
  await expect(page.getByText("What best describes your organisation?")).toHaveCount(0);

  // And their step 4 is still there — the read-only half of `TeamStep`, which is
  // now the only route into that file in the incubator edition.
  await page.getByRole("button", { name: /Continue/ }).click();
  await expect(page.getByText("Select your active context")).toBeVisible();
  await page.getByRole("button", { name: /Continue/ }).click();
  await expect(page.getByRole("heading", { name: "Add team members" })).toBeVisible();
  await expect(page.getByText(/buying seats is done by your Super User or an Admin/)).toBeVisible();
});

for (const [label, email] of [
  ["super user", INC_SUPER],
  ["admin", INC_ADMIN],
] as const) {
  test(`Buy additional seats survives the deletion for the ${label}, in Team & roles`, async ({
    page,
  }) => {
    await login(page, email);
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
}
