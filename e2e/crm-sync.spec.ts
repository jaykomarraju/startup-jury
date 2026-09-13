import { test, expect, type Page } from "@playwright/test";

/**
 * Admin console → Organisation → **CRM sync** (W3-D, `admin/s-crm.html`).
 *
 * The journey the prototype depicts, walked end to end: an admin sees four
 * provider rows with live status, configures Salesforce's filter rules and
 * field mapping, saves, and finds it all still there on a fresh load; then
 * connects and disconnects a second provider.
 *
 * Plus the thing §1.3 makes this section unusual for: **Sync now records and
 * does not send.** The screen says so, and this spec pins the wording — a build
 * that starts claiming a delivery it cannot make fails here.
 *
 * This spec WRITES connection settings, so it restores what it found —
 * `e2e/parity.spec.ts` walks the same database.
 */

// Every test below writes to the same `crm_connections` rows, and the project
// runs `fullyParallel` on two workers — so this file runs serially, as
// `e2e/question-bank.spec.ts` does for the same reason.
test.describe.configure({ mode: "serial" });

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

async function openCrm(page: Page) {
  await login(page, "nisha.kapoor@demo.startupjury.ai"); // incubator admin
  await page.goto("/app/admin?section=crm");
  await expect(page.getByTestId("admin-section-title")).toHaveText("CRM sync");
  await expect(page.getByRole("heading", { level: 2, name: "CRM sync" })).toBeVisible();
}

/** The connector row for one provider. */
function row(page: Page, label: string) {
  return page.locator("li").filter({ hasText: label }).first();
}

async function configure(page: Page, label: string) {
  await row(page, label).getByRole("button", { name: /^(Configure|Connect)$/ }).click();
}

test("the four prototype providers render with their status and summary", async ({ page }) => {
  test.setTimeout(120_000);
  await openCrm(page);

  for (const label of ["Salesforce", "HubSpot", "Pipedrive", "Custom API"]) {
    await expect(row(page, label)).toBeVisible();
  }
  await expect(row(page, "Salesforce").getByText("Live")).toBeVisible();
  await expect(row(page, "Salesforce")).toContainText("3 deals pulled");
  await expect(row(page, "HubSpot").getByText("Inactive")).toBeVisible();
  await expect(row(page, "HubSpot")).toContainText("Not connected");
  await expect(row(page, "Custom API")).toContainText("Connect any CRM via webhook or REST API");

  // A live connection offers Disconnect; an inactive one does not.
  await expect(row(page, "Salesforce").getByRole("button", { name: "Disconnect" })).toBeVisible();
  await expect(row(page, "HubSpot").getByRole("button", { name: "Disconnect" })).toHaveCount(0);
});

test("an admin edits Salesforce's filter rules and mapping, saves, and it survives a reload", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openCrm(page);
  await configure(page, "Salesforce");

  // The prototype's filter-rules card, seeded.
  await expect(page.getByLabel("Trigger field")).toHaveValue("Stage");
  await expect(page.getByLabel("Trigger value")).toHaveValue("Submitted for evaluation");
  await expect(page.getByLabel("Monthly deck cap")).toHaveValue("50");
  await expect(page.getByLabel("Score write-back field")).toHaveValue("AI_Score__c");

  const original = await page.getByLabel("Trigger value").inputValue();
  await page.getByLabel("Trigger value").fill("Qualified for evaluation");
  await page.getByLabel("Monthly deck cap").fill("35");
  await page.getByLabel("Sync schedule").selectOption("daily");
  await page.getByRole("button", { name: "Save changes" }).click();

  await page.reload();
  await configure(page, "Salesforce");
  await expect(page.getByLabel("Trigger value")).toHaveValue("Qualified for evaluation");
  await expect(page.getByLabel("Monthly deck cap")).toHaveValue("35");
  await expect(page.getByLabel("Sync schedule")).toHaveValue("daily");

  // Restore — parity.spec.ts walks this same database.
  await page.getByLabel("Trigger value").fill(original);
  await page.getByLabel("Monthly deck cap").fill("50");
  await page.getByLabel("Sync schedule").selectOption("hourly");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("CRM settings saved.")).toBeVisible();
});

test("the mapping editor refuses an ambiguous set before it reaches the server", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openCrm(page);
  await configure(page, "Salesforce");

  await expect(page.getByLabel("CRM field 1")).toHaveValue("Account.Name");
  // Point a second row at the field the first already fills.
  await page.getByLabel("Maps to 2").selectOption("companyName");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("alert")).toContainText("mapped twice");

  // Nothing was written: a reload still shows the stored mapping.
  await page.reload();
  await configure(page, "Salesforce");
  await expect(page.getByLabel("Maps to 1")).toHaveValue("companyName");
  // `0043` seeds seven Salesforce mappings; row 2 is Contact.Name → founder.
  await expect(page.getByLabel("Maps to 2")).toHaveValue("founder");
});

test("Sync now records the attempt and says nothing was sent (§1.3)", async ({ page }) => {
  test.setTimeout(120_000);
  await openCrm(page);
  await configure(page, "Salesforce");

  await expect(page.getByText(/never reported as\s+sent/i)).toBeVisible();
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect(page.getByText(/no provider is configured, so nothing was sent/i)).toBeVisible();

  // The attempt appears in the log — scoped to that card, because "Pull deals"
  // is also the prefix of a sync-direction <option>.
  const log = page
    .locator("div.rounded-xl")
    .filter({ hasText: "Recent sync attempts" })
    .first();
  await expect(log.getByText("Pull deals", { exact: true }).first()).toBeVisible();
  await expect(log.getByText(/Recorded ·/).first()).toBeVisible();
});

test("connect and disconnect a provider, keeping its configuration", async ({ page }) => {
  test.setTimeout(120_000);
  await openCrm(page);
  await configure(page, "Pipedrive");

  // Disconnected: a write-only credential box, no Sync now.
  const key = page.getByLabel("API key or token");
  await expect(key).toHaveAttribute("type", "password");
  await expect(page.getByRole("button", { name: "Sync now" })).toHaveCount(0);

  await page.getByLabel("Trigger field").fill("Deal stage");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("CRM settings saved.")).toBeVisible();

  await key.fill("sk-e2e-pipedrive-token-1234");
  await page.locator("div.rounded-xl", { has: key }).getByRole("button", { name: "Connect" }).click();

  await expect(row(page, "Pipedrive").getByText("Live")).toBeVisible();
  // The credential is gone from the page the moment it is posted, and what
  // comes back is a masked tail plus the Worker secret's name.
  await expect(page.getByText("CRM_PIPEDRIVE_TOKEN")).toBeVisible();
  await expect(page.getByText("••••1234")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("sk-e2e-pipedrive-token-1234");

  await row(page, "Pipedrive").getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByText(/filter rules and field mappings are kept/i)).toBeVisible();
  await expect(row(page, "Pipedrive").getByText("Inactive")).toBeVisible();

  // Kept, as promised.
  await configure(page, "Pipedrive");
  await expect(page.getByLabel("Trigger field")).toHaveValue("Deal stage");
  await page.getByLabel("Trigger field").fill("");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("CRM settings saved.")).toBeVisible();
});

test("the Upload screen sends an admin to the CRM section instead of raising a ticket", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await login(page, "nisha.kapoor@demo.startupjury.ai");
  await page.goto("/app/upload");

  // W7-B: CRM is the wizard's third method (`#up-um-crm`); for an admin each
  // provider tile opens the section where the connection is really configured.
  await page.getByRole("radio", { name: /Upload from CRM/ }).click();
  const grid = page.getByTestId("up-crm-grid");
  await expect(grid.getByRole("link")).toHaveCount(4);
  await expect(grid.getByRole("button", { name: "Request this" })).toHaveCount(0);

  await grid.getByRole("link", { name: "Salesforce" }).click();
  await expect(page.getByTestId("admin-section-title")).toHaveText("CRM sync");
});

test("a non-admin is refused the CRM API", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "sunita.rao@demo.startupjury.ai"); // program_associate
  const res = await page.request.get("/api/crm");
  expect(res.status()).toBe(403);
});
