import { test, expect, type Page } from "@playwright/test";

/**
 * Admin console → Organisation → **Credits & billing** (W4-C, `admin/s-bl.html`).
 *
 * The journey the prototype depicts, walked end to end: an admin opens the
 * section, reads the three tiles and the usage history, downloads an invoice,
 * and starts a purchase.
 *
 * Plus the two things this section exists to get right, both pinned here so a
 * build that loses either fails loudly:
 *
 *   §1.2 — **there is no card field**, in any state of this screen. The purchase
 *   panel is opened before the assertion, so the check covers the state where a
 *   card field would be if anyone ever added one.
 *   §1.3 — **a purchase records an intent and reports no payment.** The screen
 *   says "Purchase intent recorded", "nothing has been charged" and "Credits
 *   added 0"; a build that starts claiming a completed payment fails here.
 *
 * §8 Q1 is pinned too: no per-deck rate is rendered anywhere on the section.
 *
 * The purchase test WRITES a `billing_payment_intents` row (it never mutates the
 * balance — that is the point), so this file runs serially like its neighbours.
 */

test.describe.configure({ mode: "serial" });

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

async function openBilling(page: Page) {
  await login(page, "nisha.kapoor@demo.startupjury.ai"); // incubator admin
  await page.goto("/app/admin?section=bl");
  await expect(page.getByTestId("admin-section-title")).toHaveText("Credits & billing");
  await expect(page.getByRole("heading", { level: 2, name: "Credits & billing" })).toBeVisible();
}

test("the three tiles and the usage history render from the ledger", async ({ page }) => {
  test.setTimeout(120_000);
  await openBilling(page);

  // `.bs-grid` — the prototype's three tiles, with their exact labels.
  await expect(page.getByText("Credits remaining", { exact: true })).toBeVisible();
  await expect(page.getByText("Used this month", { exact: true })).toBeVisible();
  await expect(page.getByText("Current plan", { exact: true })).toBeVisible();
  // Seeded: one 50-unit pack purchased.
  await expect(page.getByText("of 50 purchased")).toBeVisible();
  await expect(page.getByText("Enterprise · 5 seats")).toBeVisible();

  // Usage history — one line per movement, in the prototype's voice.
  await expect(page.getByText("Usage history", { exact: true })).toBeVisible();
  await expect(page.getByText(/pitchdeck evaluation/).first()).toBeVisible();
  await expect(page.getByText("Free trial — 3 deck evaluations")).toBeVisible();

  // The three buttons the prototype draws.
  for (const name of [/Buy more credits/, /Download invoice/, /Upgrade plan/]) {
    await expect(page.getByRole("button", { name })).toBeVisible();
  }
});

test("no per-deck rate is rendered anywhere (§8 Q1)", async ({ page }) => {
  test.setTimeout(120_000);
  await openBilling(page);
  await expect(page.getByText("Credits remaining", { exact: true })).toBeVisible();

  const text = (await page.locator("main").innerText()) || "";
  expect(text).not.toMatch(/₹999/);
  expect(text).not.toMatch(/₹2,997/);
  expect(text).not.toMatch(/\/deck/);
  expect(text).not.toMatch(/per deck/i);
});

test("the billing cycle, GST and an issued invoice are all on the page", async ({ page }) => {
  test.setTimeout(120_000);
  await openBilling(page);

  await expect(page.getByText("Billing cycle", { exact: true })).toBeVisible();
  await expect(page.getByText("1 Jan 2026 – 31 Dec 2026")).toBeVisible();
  await expect(page.getByText("18% · added at checkout")).toBeVisible();

  await expect(page.getByText("Invoices & receipts", { exact: true })).toBeVisible();
  await expect(page.getByText(/INV-2026-0001/)).toBeVisible();
  // ₹20,000 + 18 % GST, issued against the seeded pack purchase.
  await expect(page.getByText("₹23,600 incl. GST · 3 Jun 2026")).toBeVisible();
  const download = page.getByRole("link", { name: "Download" }).first();
  await expect(download).toHaveAttribute("href", /\/api\/billing\/invoices\/.+\/document$/);
});

test("a purchase records an intent, takes no payment, and asks for no card", async ({ page }) => {
  test.setTimeout(120_000);
  await openBilling(page);

  const tile = page.getByText("Credits remaining", { exact: true }).locator("..");
  const balanceBefore = await tile.innerText();

  await page.getByRole("button", { name: /Buy more credits/ }).click();
  await expect(page.getByText("Choose a credit pack", { exact: true })).toBeVisible();
  await expect(page.getByText("GST (18%)")).toBeVisible();
  await expect(page.getByText(/never entered into or stored/)).toBeVisible();

  // §1.2 — nothing on this screen, in this state, could take a card.
  const inputs = page.locator("input");
  for (let i = 0; i < (await inputs.count()); i += 1) {
    const input = inputs.nth(i);
    const signature = [
      await input.getAttribute("name"),
      await input.getAttribute("placeholder"),
      await input.getAttribute("autocomplete"),
      await input.getAttribute("inputmode"),
    ].join(" ");
    expect(signature).not.toMatch(/card|cvv|cvc|expiry|security code/i);
  }

  await page.getByRole("button", { name: /Continue to secure checkout/ }).click();

  // §1.3 — recorded, and said to be recorded.
  await expect(page.getByText("Purchase intent recorded", { exact: true })).toBeVisible();
  // Twice on the page once an intent exists: in the result, and in the footnote
  // under "Recent purchase requests".
  await expect(page.getByText(/nothing has been charged/).first()).toBeVisible();
  await expect(page.getByText("Payment complete")).toHaveCount(0);
  await expect(page.getByText("Credits added", { exact: true })).toBeVisible();

  // The balance did not move, because no payment was taken.
  expect(await tile.innerText()).toBe(balanceBefore);
});

test("a non-admin cannot reach the section at all", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "rajesh.kumar@demo.startupjury.ai"); // jury
  await page.goto("/app/admin?section=bl");
  await expect(page.getByRole("heading", { level: 2, name: "Credits & billing" })).toHaveCount(0);
});
