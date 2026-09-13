import { test, expect, type Page } from "@playwright/test";

// W9-D — two VC roles, two reports each, in a real browser: the prototype's
// exact column headers (`AISJ_VC_Superuser_V8/panel-*.html`, copied, never read
// from the screen), its KPI labels and card headings. Read-only: nothing here
// mutates the seed. Every assertion is gated on a POPULATED element — a table
// header or a tile — never on a heading the loading branch could also render.
// One sign-in per test.

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

const kpiLabels = (page: Page) => page.getByTestId("rep-kpi").locator("> div:nth-child(2)");

test("VC partner: Pipeline Funnel and Scoring Summary render the prototype's report format", async ({ page }) => {
  await login(page, "ishaan.sethi@demo.startupjury.ai"); // vc_partner

  await page.goto("/app/funnel");
  await expect(page.locator("thead th")).toHaveText(["Stage", "Count", "% of sourced", "Step conversion"], { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1, name: "Pipeline Funnel" })).toBeVisible();
  await expect(kpiLabels(page)).toHaveText(["Deals sourced", "Closed", "Biggest drop-off", "Term sheet → Close"]);
  await expect(page.getByRole("heading", { level: 2, name: "Funnel — Sourced to Closed" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Stage breakdown & conversion" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export PDF" })).toBeVisible();

  await page.goto("/app/scoring");
  await expect(page.locator("thead th")).toHaveText(["Startup", "AI", "Evaluator avg", "Variance", "Spread", "Lean"], {
    timeout: 30_000,
  });
  await expect(page.getByRole("heading", { level: 1, name: "Scoring Summary" })).toBeVisible();
  await expect(kpiLabels(page)).toHaveText(["Avg. deal score", "Deals scored", "Evaluators", "Avg. variance"]);
  await expect(page.getByRole("heading", { level: 2, name: "Highest-variance deals" })).toBeVisible();
});

test("VC IC member: Capital Deployment & Pacing and Diligence & Risk Status render the prototype's report format", async ({
  page,
}) => {
  await login(page, "rajesh.kumar.vc@demo.startupjury.ai"); // vc_ic_member

  await page.goto("/app/capital");
  await expect(page.locator("thead th")).toHaveText(["Period", "Planned", "Actual", "Cumulative", "Variance"], {
    timeout: 30_000,
  });
  await expect(page.getByRole("heading", { level: 1, name: "Capital Deployment & Pacing" })).toBeVisible();
  await expect(kpiLabels(page)).toHaveText(["Deployed", "Dry powder", "Reserves earmarked", "Pace vs. plan"]);
  const bars = page.getByRole("heading", { level: 2, name: "Deployed vs. dry powder" }).locator("xpath=..");
  await expect(bars.getByTestId("rep-bar-row").locator("> span:first-child")).toHaveText([
    "Deployed (new)",
    "Deployed (follow-on)",
    "Reserves (held)",
    "Uncommitted",
  ]);

  await page.goto("/app/diligence");
  const tables = page.locator("table");
  await expect(tables.first().locator("thead th")).toHaveText(["Item", "Company", "Owner", "Status"], { timeout: 30_000 });
  await expect(tables.nth(1).locator("thead th")).toHaveText(["Company", "Flag"]);
  await expect(tables.nth(2).locator("thead th")).toHaveText(["Company", "Question", "Status"]);
  await expect(page.getByRole("heading", { level: 1, name: "Diligence & Risk Status" })).toBeVisible();
  await expect(kpiLabels(page)).toHaveText(["Open items", "Red flags", "Founder clarifications", "On track"]);
});
