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
 */

const ADMIN = "nisha.kapoor@demo.startupjury.ai";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

async function openPriceConfiguration(page: Page) {
  await page.goto("/app/admin?section=pc");
  await expect(page.getByTestId("admin-section-title")).toHaveText("Price configuration");
  await expect(page.getByRole("heading", { level: 2, name: "Price configuration" })).toBeVisible();
  // The editor's own fields, not the shell's — proof the section's fetch resolved.
  await expect(page.getByTestId("pc-gst-rate")).toBeVisible();
}

test("an admin edits a price, previews the draft, publishes it, and rolls it back", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await login(page, ADMIN);
  await openPriceConfiguration(page);

  const standard = page.getByTestId("pc-amount-standard-INR");
  const original = await standard.inputValue();
  // The preview prints grouped rupees ("₹20,000"); the input holds "20000".
  const livePrice = `₹${Number(original).toLocaleString("en-IN")}`;

  // ── Edit ──
  await standard.fill("1499");
  await expect(page.getByTestId("pc-publish")).toBeDisabled(); // unsaved

  // ── Preview: the draft moved, the live catalogue did not ──
  await page.getByTestId("pc-preview-toggle").click();
  await expect(page.getByTestId("pc-preview-draft-standard")).toContainText("₹1,499");
  await expect(page.getByTestId("pc-preview-live-standard")).toContainText(livePrice);
  await expect(page.getByTestId("pc-preview-dirty")).toBeVisible();

  // ── Save the draft ──
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByTestId("pc-notice")).toContainText("Draft saved");
  // Still not live.
  await expect(page.getByTestId("pc-preview-live-standard")).toContainText(livePrice);

  // …and it survives a reload, because it is stored, not local state.
  await page.reload();
  await openPriceConfiguration(page);
  await expect(page.getByTestId("pc-amount-standard-INR")).toHaveValue("1499");

  // ── Publish ──
  await page.getByTestId("pc-publish").click();
  await expect(page.getByTestId("pc-notice")).toContainText("It is live now.");
  await page.getByTestId("pc-preview-toggle").click();
  await expect(page.getByTestId("pc-preview-live-standard")).toContainText("₹1,499");

  // ── Revert, which is what makes a publish safe ──
  // The preview is still open from the publish step; toggling it again would
  // close it.
  await page.getByTestId("pc-rollback").click();
  await expect(page.getByTestId("pc-notice")).toContainText("is live again");
  await expect(page.getByTestId("pc-preview-live-standard")).toContainText(livePrice);

  // ── Leave the seed as it was found ──
  await page.getByTestId("pc-amount-standard-INR").fill(original);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByTestId("pc-notice")).toContainText("Draft saved");
  await expect(page.getByTestId("pc-publish")).toBeEnabled();
});

test("the catalogue shows no per-deck rate and no saving column", async ({ page }) => {
  await login(page, ADMIN);
  await openPriceConfiguration(page);

  // §8 Q1, ruled 2026-09-11. The prototype draws both columns in the pack and
  // enterprise tables; neither may exist here.
  const packs = page.getByRole("table").filter({ hasText: "50-unit pack" });
  await expect(packs.getByRole("columnheader")).toHaveText([
    "Pack",
    "🇮🇳 INR",
    "🇺🇸 USD",
    "🇬🇧 GBP",
    "🇪🇺 EUR",
    "Active",
  ]);
  await expect(page.getByText("Base rate")).toHaveCount(0);
  await expect(page.getByText(/per deck/i)).toHaveCount(0);
  await expect(page.getByText("Saving", { exact: true })).toHaveCount(0);

  // The prototype's seven currencies, four of them active.
  for (const code of ["INR", "USD", "GBP", "EUR", "AED", "SGD", "AUD"]) {
    await expect(page.getByTestId(`pc-currency-${code}`)).toBeVisible();
  }
  await expect(page.getByTestId("pc-currency-AED")).toHaveAttribute("aria-checked", "false");
  await expect(page.getByTestId("pc-currency-EUR")).toHaveAttribute("aria-checked", "true");
  // The GST rate is configuration, not a literal.
  await expect(page.getByTestId("pc-gst-rate")).toHaveValue("18");
});
