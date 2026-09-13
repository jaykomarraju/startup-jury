import { test, expect, type Page } from "@playwright/test";

// W7-A — All decks and the deck report overlay, walked in a real browser.
//
// This file shares one dev-server D1 with specs that shortlist, assign and
// upload decks, so it asserts nothing another spec can move: header SETS (a
// function of the view, not the data), a stat box's own count against the rows
// it draws at that moment, and the report's section structure. One sign-in per
// test — `/login` bounces an authenticated session straight back to `/app`.

const INC_SUPER = "priya.sharma@demo.startupjury.ai";
const INC_JURY = "rajesh.kumar@demo.startupjury.ai";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

/** The decks table's header texts, as rendered (`.dth th` is uppercase). */
async function headers(page: Page): Promise<string[]> {
  const cells = await page.locator("table[data-shape] thead th").allInnerTexts();
  return cells.map((c) => c.replace(/\s+/g, " ").trim().toUpperCase());
}

/** A stat box by its label; its accessible name runs label, value, sub-label. */
function tile(page: Page, label: string) {
  return page.getByRole("button", { name: new RegExp(`^${label}\\s*\\d`) });
}

async function tileValue(page: Page, label: string): Promise<number> {
  return Number(await tile(page, label).locator("span").nth(1).innerText());
}

test("superuser: the table re-shapes per stat box, a filter narrows it, and the report opens", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await login(page, INC_SUPER);
  await page.goto("/app/alldecks");

  // Gate on a populated row, not the heading the loading state also renders.
  const firstName = page.locator("table[data-shape] tbody button[title='Open deck & evaluation report']").first();
  await expect(firstName).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("All decks");
  await expect.poll(() => headers(page)).toEqual([
    "STARTUP",
    "FOUNDER NAME",
    "EMAIL ID",
    "PHONE NUMBER",
    "CITY",
    "SECTOR",
    "STATUS",
  ]);
  await expect(page.getByText(/^\d+ submissions? · Updated /)).toBeVisible();
  // Toolbar order: Export, then Program, then Cohort.
  const toolbar = page.locator(".tbr").first();
  await expect(toolbar.getByRole("button").nth(0)).toHaveText(/Export/);
  await expect(toolbar.getByRole("button").nth(1)).toHaveAccessibleName("Program filter");
  await expect(toolbar.getByRole("button").nth(2)).toHaveAccessibleName("Cohort filter");

  // A stat box narrows the rows to exactly its own count, and re-shapes the table.
  const uploaded = await tileValue(page, "Uploaded");
  await tile(page, "Shortlisted").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Shortlisted");
  await expect.poll(() => headers(page)).toEqual(["STARTUP", "AI SCORE", "JURY SCORE", "AVG. SCORE", "ADDL. PARAMETER SCORES"]);
  const shortlisted = await tileValue(page, "Shortlisted");
  expect(shortlisted).toBeLessThan(uploaded);
  const rows = page.locator("table[data-shape] tbody tr");
  await expect(rows).toHaveCount(Math.max(shortlisted, 1)); // an empty view draws one message row

  await tile(page, "Assigned").click();
  await expect.poll(() => headers(page)).toEqual([
    "STARTUP",
    "STATUS",
    "AI SCORE",
    "PARAMETER SCORES",
    "ASSIGNED TO",
    "ASSIGNED DATE",
    "DUE DATE",
  ]);

  // The report overlay opens from the name, with the prototype's sections.
  await tile(page, "AI Evaluated").click();
  await expect.poll(() => headers(page)).toEqual(["STARTUP", "AI SCORE", "PARAMETER SCORES"]);
  const name = page.locator("table[data-shape] tbody button[title='Open deck & evaluation report']").first();
  const deckName = (await name.innerText()).trim();
  await name.click();
  const dialog = page.getByRole("dialog", { name: `Evaluation report — ${deckName}` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(`Evaluate — ${deckName}`)).toBeVisible();
  for (const tileLabel of ["AI Score", "My Score"]) {
    await expect(dialog.getByText(tileLabel, { exact: true })).toBeVisible();
  }
  // Section headings, in the prototype's order (some carry a <small> hint).
  const sections = dialog.getByRole("heading", { level: 3 });
  await expect(sections.filter({ hasText: /^Overall AI remarks/ })).toBeVisible();
  const titles = (await sections.allInnerTexts()).map((t) => t.split("\n")[0].trim());
  const wanted = ["Overall AI remarks", "Parameter evaluation", "My parameters evaluation", "Intro call remarks"];
  const at = wanted.map((w) => titles.findIndex((t) => t.startsWith(w)));
  expect(at.every((i) => i >= 0), `sections present: ${JSON.stringify(titles)}`).toBe(true);
  expect([...at].sort((a, b) => a - b)).toEqual(at);
  await expect(dialog.getByText("Pitch deck", { exact: true }).first()).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Research/ })).toBeVisible();
  // Every evaluated deck has the 13-parameter AI breakdown, and only those 13.
  const paramTable = dialog.locator("table").first();
  await expect(paramTable.getByText("Traction & Validation")).toBeVisible();
  await expect(paramTable.locator("tbody tr")).toHaveCount(14); // 13 parameters + weighted total
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
});

test("jury: My Pipeline shows five first-person stat boxes and the jury tables", async ({ page }) => {
  test.setTimeout(90_000);
  await login(page, INC_JURY);
  await page.goto("/app/alldecks");

  const labels = page.locator("button[aria-pressed] .u-label");
  await expect(labels).toHaveText(["Assigned", "Evaluated", "Drafts", "Pending Evaluation", "Submitted"], {
    timeout: 30_000,
  });
  await expect(page.locator("table[data-shape]")).toBeVisible();
  await expect.poll(() => headers(page)).toEqual(["STARTUP", "STATUS", "AI SCORE", "ASSIGNED BY", "ASSIGNED DATE", "DUE DATE"]);

  await tile(page, "Submitted").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Submitted");
  await expect.poll(() => headers(page)).toEqual([
    "STARTUP",
    "AI SCORE",
    "MY SCORE",
    "AV. SCORE",
    "SUBMITTED TO",
    "SUBMITTED DATE",
    "BY DUE DATE",
  ]);

  // The jury rail is Pipeline progress and nothing else.
  const rail = page.locator("aside").filter({ hasText: "Pipeline progress" });
  await expect(rail).toBeVisible();
  await expect(rail.getByText("Cohort rating thresholds")).toHaveCount(0);
  await expect(rail.getByText("Activity log")).toHaveCount(0);
});
