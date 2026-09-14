import { test, expect, type Page } from "@playwright/test";

// W9-C — the VC diligence-to-close screens against the seeded local D1
// (migrations/0006 decks, 0063 diligence records):
//   SolarNest   investment_dd — a checklist mid-way, one item flagged
//   CreditBridge ic_review    — diligence complete, ask ₹1.5 Cr
//   FreshCart   term_sheet    — term sheet Issued, Term Sheet template attached
//
// One sign-in per test. Items are located by their NAME (the select's label),
// never by the status the click changes.

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

const PARTNER = "ishaan.sethi@demo.startupjury.ai";
const IC = "rajesh.kumar.vc@demo.startupjury.ai";

test("partner opens a DD row's checklist tab and moves one item — and it stays moved", async ({ page }) => {
  await login(page, PARTNER);
  await page.goto("/app/investmentdd");
  await expect(page.getByRole("heading", { name: "Investment DD" })).toBeVisible();

  const row = page.getByRole("row", { name: /SolarNest/ });
  await expect(row).toBeVisible();
  await expect(page.getByTestId("stage-footer-stat")).toContainText("in diligence");
  await row.getByRole("button", { name: /Open checklist/ }).click();

  const pane = page.getByRole("complementary", { name: "SolarNest detail" });
  await expect(pane.getByTestId("pane-checklist-investment")).toBeVisible();
  await expect(pane.getByTestId("dd-item")).toHaveCount(6);

  // Whatever state an earlier run left it in, move it to a different one.
  const status = pane.getByLabel("Status for Competitive positioning");
  const next = (await status.inputValue()) === "in_progress" ? "done" : "in_progress";
  const saved = page.waitForResponse((r) => r.url().includes("/checklist/investment/") && r.request().method() === "PATCH");
  await status.selectOption(next);
  expect((await saved).status()).toBe(200);

  // A fresh load reads it back from the server, not from the tab's own state.
  await page.reload();
  await page.getByRole("row", { name: /SolarNest/ }).getByRole("button", { name: /Open checklist/ }).click();
  await expect(
    page.getByRole("complementary", { name: "SolarNest detail" }).getByLabel("Status for Competitive positioning"),
  ).toHaveValue(next);
});

test("IC member sees the decision queue with DD, Ask and a read-only Status, and Invest ready", async ({ page }) => {
  await login(page, IC);
  await page.goto("/app/icpipeline");
  await expect(page.getByRole("heading", { name: "IC Pipeline" })).toBeVisible();

  const row = page.getByRole("row", { name: /CreditBridge/ });
  await expect(row.getByText("₹1.5 Cr")).toBeVisible();
  await expect(page.locator("thead th").last()).toHaveText(/status/i);
  await row.getByRole("button", { name: "6/6" }).click();
  await expect(
    page.getByRole("complementary", { name: "CreditBridge detail" }).getByTestId("pane-checklist-investment"),
  ).toBeVisible();

  await page.goto("/app/curation");
  await expect(page.getByRole("heading", { name: "Invest ready" })).toBeVisible();
  await expect(page.getByRole("row", { name: /FreshCart/ }).getByText("Term sheet")).toBeVisible();
});
