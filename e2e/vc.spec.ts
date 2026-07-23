import { test, expect, type Page } from "@playwright/test";

// Phase 5 VC happy paths against the seeded local D1 (migrations/0006):
// - MedGrid seeds at partner_call (partner sponsors it to IC)
// - CreditBridge seeds at ic_review with two prior ballots (IC member adds a vote)

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

test("partner sponsors a deal from the partner call into IC", async ({ page }) => {
  await login(page, "ishaan.sethi@demo.startupjury.ai"); // vc_partner
  await page.goto("/app/partnercall");

  await expect(page.getByRole("heading", { name: "Partner call" })).toBeVisible();
  const row = page.getByRole("row", { name: /MedGrid/ });
  await expect(row).toBeVisible();

  // Sponsoring advances the deck to investment DD, so it leaves the partner-call list.
  await row.getByRole("button", { name: "Sponsor to IC" }).click();
  await expect(page.getByRole("row", { name: /MedGrid/ })).toBeHidden();
});

test("IC member casts a vote in the committee queue", async ({ page }) => {
  await login(page, "rajesh.kumar.vc@demo.startupjury.ai"); // vc_ic
  await page.goto("/app/icpipeline");

  await expect(page.getByRole("heading", { name: "IC Pipeline" })).toBeVisible();

  // Open CreditBridge (seeded at ic_review) and cast an Invest vote.
  await page.getByRole("button", { name: /CreditBridge/ }).click();
  await expect(page.getByRole("heading", { name: "CreditBridge" })).toBeVisible();
  await page.getByRole("button", { name: "Invest", exact: true }).click();

  // The member's own vote is reflected back in the "Your vote" summary.
  await expect(page.getByText(/Your vote · Invest/)).toBeVisible();
});
