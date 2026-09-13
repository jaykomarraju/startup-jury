import { test, expect, type Page } from "@playwright/test";

// W6-C — Set up → Team: a seat purchase raises the cap, and the roster then
// admits exactly one more member (F0111 / F1025 / F1031 / F1032).
//
// Runs in the VC workspace ON PURPOSE. `e2e/credits-billing.spec.ts` asserts the
// INCUBATOR workspace's "Enterprise · 5 seats", and a purchase here really does
// add a seat to `billing_subscriptions.seats` — so buying one in the incubator
// would break that spec whenever it ran second. Nothing asserts the VC count.
//
// A purchase is a ledger fact and is not undone; the member this spec adds IS
// removed again at the end, so the roster is left as it was found. Because
// `retries: 1` can run this body a second time over the same database, every
// number is read off the seat bar at the start rather than assumed from the seed.

const VC_ADMIN = "nisha.kapoor.vc@demo.startupjury.ai";

test.describe.configure({ mode: "serial" });

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

/** "Pro 3 / 4" → { used: 3, capacity: 4 }. */
async function proSeats(page: Page): Promise<{ used: number; capacity: number }> {
  const text = (await page.getByTestId("seat-tier-pro").innerText()).trim();
  const m = /Pro\s+(\d+)\s*\/\s*(\d+)/.exec(text);
  expect(m, `seat pill read "${text}"`).toBeTruthy();
  return { used: Number(m![1]), capacity: Number(m![2]) };
}

test("buying a Pro seat raises the cap and the roster admits one more Pro member", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, VC_ADMIN);
  await page.goto("/app/setup");

  // Org type → Configure → Select → Team, waiting on each step's own content.
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Sectors", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Select your active context")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  // Gate on the POPULATED seat bar, not the heading the loading state shares.
  const bar = page.getByTestId("seat-bar");
  await expect(bar).toContainText("seats left for nomination");
  await expect(page.getByRole("heading", { name: "Add team members" })).toBeVisible();
  const start = await proSeats(page);

  const email = `seat.e2e.${Date.now()}@example.com`;
  const emailBox = page.getByPlaceholder("colleague@company.com");
  // An Analyst: the add-member row defaults to the prototype's first role, Admin,
  // and an extra administrator is not something the specs around this one expect.
  const roleSelect = page.getByLabel("Role for the new member");
  const planSelect = page.getByLabel("Plan for the new member");

  // On a fresh seed Pro is full (3 / 3): the add is refused, by name, and nobody is created.
  if (start.used >= start.capacity) {
    await emailBox.fill(email);
    await roleSelect.selectOption("analyst");
    await planSelect.selectOption("pro");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText("No Pro seats left — buy a Pro seat below, then add this user.")).toBeVisible();
    await expect(page.getByTestId("seat-member").filter({ hasText: email })).toHaveCount(0);
  }

  // Buy exactly enough Pro seats that one is free — at least one.
  const buy = Math.max(1, start.used - start.capacity + 1);
  await page.getByRole("button", { name: "Buy a Pro seat" }).click();
  await expect(page.getByRole("heading", { name: "Buy additional seats" })).toBeVisible();
  await page.getByLabel("Pro seats").selectOption(String(buy));
  await expect(page.getByTestId("seat-buy-summary")).toContainText(`${buy} seat${buy === 1 ? "" : "s"} selected`);
  await page.getByRole("button", { name: /Continue to payment/ }).click();

  // The payment screen: a summary and a provider notice, and not a single input.
  await expect(page.getByTestId("seat-order")).toContainText(`Pro seat × ${buy}`);
  await expect(page.getByTestId("seat-pay").locator("input, textarea")).toHaveCount(0);
  await expect(page.getByText(/card number|cvv/i)).toHaveCount(0);
  await page.getByRole("button", { name: /Place order/ }).click();

  // The receipt: recorded, not paid.
  await expect(page.getByRole("heading", { name: "Seats added" })).toBeVisible();
  await expect(page.getByText("Recorded · not charged")).toBeVisible();
  await expect(page.getByText("Payment successful")).toHaveCount(0);
  await page.getByRole("button", { name: /Back to team/ }).click();

  // The cap rose by exactly what was bought.
  await expect(page.getByTestId("seat-tier-pro")).toHaveText(`Pro ${start.used} / ${start.capacity + buy}`);

  // And the roster now admits one more Pro member.
  await emailBox.fill(email);
  await roleSelect.selectOption("analyst");
  await planSelect.selectOption("pro");
  const created = page.waitForResponse((r) => r.url().endsWith("/api/seats/members") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const res = await created;
  expect(res.status()).toBe(200);
  const userId = ((await res.json()) as { user: { id: string } }).user.id;

  try {
    const card = page.getByTestId("seat-member").filter({ hasText: email });
    await expect(card).toBeVisible();
    await expect(card).toContainText("Pro");
    await expect(page.getByTestId("seat-tier-pro")).toHaveText(`Pro ${start.used + 1} / ${start.capacity + buy}`);

    // The new member appears in "View all members" with the Pro plan.
    await page.getByRole("tab", { name: /View all members/ }).click();
    const table = page.getByRole("table");
    await expect(table.getByRole("columnheader")).toHaveText(["Member", "Plan", "Role", "Status", "Programs accessible"]);
    await expect(table.getByLabel(`Plan for ${email}`)).toHaveValue("pro");
  } finally {
    // Leave the roster as it was found. Removal frees the seat; the purchase stays.
    const del = await page.request.delete(`/api/users/${userId}`);
    expect(del.status()).toBe(200);
  }
});
