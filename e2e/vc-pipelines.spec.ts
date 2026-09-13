import { test, expect, type Page } from "@playwright/test";

/**
 * W9-B — the VC Assoc. Pipeline and Partner Pipeline (`panel-jurypipeline` /
 * `panel-partnerpipeline`), walked through the real deck list and the real
 * `/api/decks/:id/events` reads:
 *
 *   associate  Assoc. Pipeline — WealthOS is active (Pending, Submit forward /
 *              Pass); PetPal, which the associate passed in the seed
 *              (`0008`, `not_shortlisted`), STAYS on the screen as Rejected
 *              with no transitions (F0627). The Filter narrows by the legend's
 *              words, and View deck opens the one-tab Pitch deck pane.
 *   partner    Partner Pipeline — the prototype's nine headers with Inv. Assoc.,
 *              and the Move to Partner call wording on AgriChain.
 *
 * Read-only throughout: the suite is fullyParallel over one local D1, and the
 * two decks asserted on (WealthOS, PetPal, AgriChain) are not moved by any spec.
 */

const NAV = { timeout: 30_000 };
const ASSOCIATE = "sunita.rao.vc@demo.startupjury.ai";
const PARTNER = "ishaan.sethi@demo.startupjury.ai";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**", NAV);
}

const HEADERS = (third: string) => [
  "STARTUP",
  "AI SCORE",
  third,
  "AVG. SCORE",
  "ADDL. PARAMETER SCORES",
  "SUBMITTED DATE",
  "STATUS",
  "ACTION",
  "SUBMIT TO",
];

test("the associate's pipeline keeps a passed deck with its outcome, beside the active ones", async ({ page }) => {
  await login(page, ASSOCIATE);
  await page.goto("/app/jurypipeline");

  // PetPal is a DECIDED row: it only appears once its events have been read.
  const petpal = page.getByRole("row", { name: /PetPal/ });
  await expect(petpal).toBeVisible(NAV);
  await expect(petpal.getByText("Rejected", { exact: true })).toBeVisible();
  const petpalAction = petpal.getByRole("combobox", { name: "Action for PetPal" });
  await expect(petpalAction.locator("option")).toHaveText(["Action ▾", "View deck"]);

  const table = page.getByRole("table");
  expect((await table.locator("thead th").allInnerTexts()).map((h) => h.trim())).toEqual(HEADERS("ANALYST SCORE"));
  await expect(page.getByText("Track every deck through jury evaluation — AI vs jury scoring, assignment and final decision")).toBeVisible();

  const wealthos = page.getByRole("row", { name: /WealthOS/ });
  await expect(wealthos.getByText("Pending", { exact: true })).toBeVisible();
  const wealthosAction = wealthos.getByRole("combobox", { name: "Action for WealthOS" });
  await expect(wealthosAction.locator("option")).toHaveText(["Action ▾", "View deck", "Submit forward", "Pass"]);

  const footer = page.getByTestId("stage-footer");
  await expect(footer.getByTestId("stage-footer-stat")).toHaveText(/^\d+ decks? · \d+ shortlisted · [1-9]\d* rejected · [1-9]\d* in progress$/);
  await expect(footer.getByTestId("stage-legend")).toHaveText(/Assigned\s*Shortlisted\s*Rejected\s*Pending/);

  // The Filter speaks the legend's words.
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Rejected" }).click();
  await expect(page.getByRole("button", { name: "Filter · Rejected" })).toBeVisible();
  await expect(petpal).toBeVisible();
  await expect(wealthos).toHaveCount(0);
  await page.getByRole("button", { name: "Filter · Rejected" }).click();
  await page.getByRole("menuitemradio", { name: "All" }).click();

  // View deck — the prototype's `jp-side`, beside the table, not a dialog.
  await wealthosAction.selectOption({ label: "View deck" });
  const pane = page.getByRole("complementary", { name: "WealthOS detail" });
  await expect(pane).toBeVisible();
  await expect(pane.getByText("Pitch deck")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("the partner's pipeline draws Inv. Assoc. and the partner's own verbs", async ({ page }) => {
  await login(page, PARTNER);
  await page.goto("/app/partnerpipeline");

  const agrichain = page.getByRole("row", { name: /AgriChain/ });
  await expect(agrichain).toBeVisible(NAV);
  expect((await page.getByRole("table").locator("thead th").allInnerTexts()).map((h) => h.trim())).toEqual(
    HEADERS("INV. ASSOC."),
  );
  await expect(agrichain.getByText("Pending", { exact: true })).toBeVisible();
  await expect(agrichain.getByRole("combobox", { name: "Action for AgriChain" }).locator("option")).toHaveText([
    "Action ▾",
    "View deck",
    "Move to Partner call",
    "Pass",
  ]);
  await expect(page.getByTestId("stage-footer-stat")).toHaveText(/^\d+ decks? · \d+ shortlisted · \d+ rejected · [1-9]\d* in progress$/);
});
