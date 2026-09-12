import { test, expect, type Page } from "@playwright/test";

/**
 * My account → the purchase wizard (W6-B, prototype `#acct-overlay`).
 *
 * Both branches the prototype depicts, walked end to end to a receipt:
 *
 *   Individual   (incubator superuser) Account → Plan (credit packs) → Payment → Done, in INR
 *   Organization (vc admin)            Account → Org type → Org details → Plan → Payment → Done, in USD
 *
 * And the rules the screen exists to get right, pinned so a build that loses one
 * fails here:
 *   §1.2 — no card-shaped field on any screen of the flow, the payment screen
 *          included, with the Card method SELECTED.
 *   §1.3 — the receipt says "Order recorded" and "Recorded — not charged"; a build
 *          that starts claiming "Payment successful" fails.
 *   GST  — on the INR order, and none on the USD one.
 *   §8 Q1 — no per-deck figure anywhere in the flow.
 *
 * The prices asserted are the published seed's credit pack and enterprise rows.
 * `price-configuration.spec.ts` temporarily republishes the STANDARD subscription
 * only, so neither is touched by it. Each test saves its edition's account
 * profile and records one intent; it grants no credits, so nothing needs undoing,
 * and it re-runs cleanly over its own leftovers. Serial, one role per test.
 */

test.describe.configure({ mode: "serial" });

const PER_DECK = /per[- ]deck|\/\s*deck/i;
const CARD_SHAPED = /card|cvv|cvc|expir|security code|upi|iban|ifsc|account.?number/i;

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

async function expectNoCardField(page: Page) {
  const overlay = page.locator("#acct-overlay");
  const fields = overlay.locator("input, select, textarea");
  const n = await fields.count();
  for (let i = 0; i < n; i += 1) {
    const f = fields.nth(i);
    const signature = [
      await f.getAttribute("type"),
      await f.getAttribute("name"),
      await f.getAttribute("id"),
      await f.getAttribute("placeholder"),
      await f.getAttribute("autocomplete"),
      await f.getAttribute("aria-label"),
    ].join(" ");
    expect(signature).not.toMatch(CARD_SHAPED);
  }
  await expect(overlay.locator('input[type="password"]')).toHaveCount(0);
}

async function steps(page: Page): Promise<string[]> {
  return (await page.getByTestId("ac-steps").locator("[data-state]").allInnerTexts()).map((t) =>
    t.replace(/^\d+\s*/, "").trim(),
  );
}

test("an individual buys a credit pack through to a receipt (INR, with GST)", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "priya.sharma@demo.startupjury.ai"); // incubator superuser
  await page.goto("/app/account");

  const overlay = page.getByRole("dialog", { name: "My account" });
  await expect(overlay).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Create your account" })).toBeVisible();
  await expect(page.getByLabel("Work email")).toHaveValue("priya.sharma@demo.startupjury.ai");
  await page.getByTestId("ac-type-individual").click();
  expect(await steps(page)).toEqual(["Account", "Plan", "Payment"]);
  await expectNoCardField(page);

  await page.getByLabel("Designation (optional for individuals)").fill("Programme Director");
  await page.getByRole("button", { name: "Continue" }).click();

  // ── Plan: the published credit packs ──
  await expect(page.getByRole("heading", { level: 1, name: "Choose your plan" })).toBeVisible();
  await page.getByRole("tab", { name: "Pay-as-you-go credit packs" }).click();
  await expect(page.getByTestId("ac-plan-pack_10")).toContainText("10 credits");
  await expect(page.getByTestId("ac-plan-pack_10")).toContainText("₹5,000");
  await expect(page.getByTestId("ac-plan-pack_50")).toContainText("50 credits");
  await expect(page.getByTestId("ac-plan-pack_100")).toContainText("100 credits");
  expect(await overlay.innerText()).not.toMatch(PER_DECK);
  await page.getByTestId("ac-plan-pack_10").click();
  await page.getByRole("button", { name: "Continue" }).click();

  // ── Payment ──
  await expect(page.getByRole("heading", { level: 1, name: "Complete payment" })).toBeVisible();
  const summary = page.getByTestId("ac-order-summary");
  await expect(summary).toContainText("10-unit pack");
  await expect(page.getByTestId("ac-gst-line")).toContainText("GST (18%)");
  await expect(page.getByTestId("ac-gst-line")).toContainText("₹900");
  await expect(page.getByTestId("ac-total")).toHaveText("₹5,900");
  await page.getByTestId("ac-pm-card").click();
  await expect(page.getByTestId("ac-pm-card")).toHaveAttribute("aria-checked", "true");
  await expectNoCardField(page);
  await page.getByTestId("ac-pay").click();

  // ── Receipt ──
  await expect(page.getByRole("heading", { level: 1, name: "Order recorded" })).toBeVisible();
  expect(await steps(page)).toEqual(["Account", "Plan", "Done"]);
  await expect(page.getByTestId("ac-receipt-amount")).toContainText("₹5,900");
  await expect(page.getByTestId("ac-receipt-amount")).toContainText("(incl. GST)");
  await expect(page.getByTestId("ac-receipt-status")).toHaveText("Recorded — not charged");
  await expect(page.getByTestId("ac-receipt-ref")).toContainText("pi_");
  await expect(page.getByText("Payment successful")).toHaveCount(0);
  expect(await overlay.innerText()).not.toMatch(PER_DECK);

  const href = await page.getByTestId("ac-download-invoice").getAttribute("href");
  expect(href).toMatch(/^\/api\/account\/orders\/pi_[^/]+\/document$/);
  const doc = await page.request.get(href!);
  expect(doc.status()).toBe(200);
  const html = await doc.text();
  expect(html).toContain("Pro-forma invoice");
  expect(html).toContain("NOT A TAX INVOICE");
  expect(html).toContain("₹5,900");

  // X closes the overlay and returns to the app.
  await page.getByRole("button", { name: "Back to dashboard" }).click();
  await expect(overlay).toHaveCount(0);
});

test("an organisation buys an annual plan through to a receipt (USD, no GST)", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "nisha.kapoor.vc@demo.startupjury.ai"); // vc admin
  await page.goto("/app/account");

  await expect(page.getByRole("heading", { level: 1, name: "Create your account" })).toBeVisible();
  await page.getByTestId("ac-type-organization").click();
  expect(await steps(page)).toEqual(["Account", "Org type", "Org details", "Plan", "Payment", "Done"]);
  await page.getByRole("button", { name: "Continue" }).click();

  // ── Org type ──
  await expect(page.getByRole("heading", { level: 1, name: "What best describes your organisation?" })).toBeVisible();
  await page.getByTestId("ac-org-investor").click();
  await page.getByRole("button", { name: "Continue" }).click();

  // ── Org details — the eleven fields ──
  await expect(page.getByRole("heading", { level: 1, name: "Create your account" })).toBeVisible();
  await page.getByLabel("Organization name", { exact: true }).fill("Northstar Ventures");
  await page.getByLabel("Type of business").selectOption("VC Firm");
  await page.getByLabel("No. of employees").selectOption("11–50");
  await page.getByLabel("No. of associates").fill("8");
  await page.getByLabel("City", { exact: true }).fill("Bengaluru");
  await page.getByLabel("Country", { exact: true }).selectOption("India");
  await page.getByLabel("Contact person name").fill("Nisha Kapoor");
  await page.getByLabel("Designation", { exact: true }).fill("Managing Partner");
  await page.getByLabel("Organisation country code").selectOption("+91");
  await page.getByLabel("Phone number", { exact: true }).fill("98765 43210");
  await page.getByLabel("Email ID", { exact: true }).fill("deals@northstar.vc");
  await expectNoCardField(page);
  await page.getByRole("button", { name: "Create account" }).click();

  // ── Org plan, in USD ──
  await expect(page.getByRole("heading", { level: 1, name: "Choose your plan" })).toBeVisible();
  expect(await steps(page)).toEqual(["Account", "Org type", "Org details", "Plan", "Payment", "Done"]);
  await page.getByRole("radio", { name: /USD/ }).click();
  await expect(page.getByTestId("ac-plan-ent_100")).toContainText("$720");
  await page.getByTestId("ac-plan-ent_100").click();
  await page.getByRole("button", { name: "Continue" }).click();

  // ── Payment ──
  await expect(page.getByRole("heading", { level: 1, name: "Complete payment" })).toBeVisible();
  await expect(page.getByTestId("ac-order-summary")).toContainText("Organization · annual");
  await expect(page.getByTestId("ac-gst-line")).toHaveCount(0);
  await expect(page.getByTestId("ac-untaxed-line")).toContainText("Not included");
  await expect(page.getByTestId("ac-total")).toHaveText("$720");
  await page.getByTestId("ac-pm-netbanking").click();
  await expectNoCardField(page);
  await page.getByTestId("ac-pay").click();

  // ── Receipt ──
  await expect(page.getByRole("heading", { level: 1, name: "Order recorded" })).toBeVisible();
  await expect(page.getByTestId("ac-steps").locator('[data-state="done"]')).toHaveCount(6);
  await expect(page.getByTestId("ac-receipt")).toContainText("100 units / year · Organization");
  await expect(page.getByTestId("ac-receipt")).toContainText("Annual subscription · renews yearly");
  await expect(page.getByTestId("ac-receipt-amount")).toContainText("$720");
  await expect(page.getByTestId("ac-receipt-amount")).toContainText("(excl. local taxes)");
  await expect(page.getByTestId("ac-receipt-status")).toHaveText("Recorded — not charged");
  await expect(page.getByText("Payment successful")).toHaveCount(0);

  const href = await page.getByTestId("ac-download-invoice").getAttribute("href");
  const html = await (await page.request.get(href!)).text();
  expect(html).toContain("Northstar Ventures");
  expect(html).not.toContain("GST (");
});

test("a role that cannot buy never sees the wizard", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "rajesh.kumar@demo.startupjury.ai"); // incubator jury
  await page.goto("/app/account");
  await expect(page.getByRole("heading", { name: "My account" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "My account" })).toHaveCount(0);
  const res = await page.request.get("/api/account");
  expect(res.status()).toBe(403);
});
