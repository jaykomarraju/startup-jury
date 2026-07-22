import { test, expect } from "@playwright/test";

// Phase 3 UI acceptance: an uploaded PDF flows R2 → a deck row that appears in
// All decks. Without ANTHROPIC_API_KEY the single-upload evaluation defers, so
// the deck lands at "Pending AI" — which is exactly what we assert here.

async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.getByPlaceholder("••••••••").fill("demo1234");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/app/);
}

test("upload a pitch deck and see it in All decks", async ({ page }) => {
  await login(page, "sunita.rao@demo.startupjury.ai"); // incubator program associate
  await page.goto("/app/upload");

  const name = `E2E Deck ${Date.now()}`;
  await page.getByPlaceholder("e.g. GreenGrid").fill(name);
  await page.locator('input[type="file"]').setInputFiles({
    name: "e2e-deck.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF"),
  });
  await page.getByRole("button", { name: /upload & evaluate/i }).click();

  // Deferred-evaluation confirmation, then jump to the decks table.
  await expect(page.getByText(/evaluation is pending/i)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /view all decks/i }).click();
  await page.waitForURL(/\/app\/alldecks/);

  const row = page.getByRole("row", { name: new RegExp(name) });
  await expect(row).toBeVisible();
  await expect(row.getByText("Pending AI")).toBeVisible();
});
