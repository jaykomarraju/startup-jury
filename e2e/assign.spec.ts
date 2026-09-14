import { test, expect, type Page } from "@playwright/test";

// W7-E — Assign (`AISJ_IC_SuserV15/panel-assign.html`) and the intro call's AI
// questions.
//
// Shared-D1 discipline (plan §9, Wave 6 integration): two workers run specs
// against one database, so this file uses a deck NO other spec touches —
// GreenGrid Energy, seeded `ai_evaluated` — and pins what it asserts from its
// own actions rather than inheriting a seeded value. `e2e/incubator.spec.ts`
// assigns FinStack; nothing here reads FinStack.

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

const PA = "sunita.rao@demo.startupjury.ai";

test("program associate assigns one deck to two members across roles and sees it come back assigned", async ({ page }) => {
  await login(page, PA);
  await page.goto("/app/assign");

  // Gate on a populated deck row, not the heading the loading branch also renders.
  const deckBox = page.getByRole("checkbox", { name: "Select GreenGrid Energy" });
  await expect(deckBox).toBeVisible();
  await expect(page.getByRole("heading", { name: "Assign" })).toBeVisible();
  for (const control of [/^Incomplete/, /^Filter/, "Export"]) {
    await expect(page.getByRole("button", { name: control })).toBeVisible();
  }
  // The prototype's role order, re-sorted from the server's.
  await expect(page.getByRole("list", { name: "Roles" }).getByRole("button")).toHaveText([
    /^Program manager/,
    /^Program associate/,
    /^Jury member/,
  ]);

  await deckBox.check();
  await page.getByRole("button", { name: /^Jury member/ }).click();
  await page.getByRole("checkbox", { name: "Select Rajesh Kumar" }).check();
  // Switching role keeps the juror (F0260) — the summary shows both.
  await page.getByRole("button", { name: /^Program manager/ }).click();
  await page.getByRole("checkbox", { name: "Select Raj Kumar" }).check();

  const summary = page.getByTestId("assign-summary");
  await expect(summary).toContainText("GreenGrid Energy");
  await expect(summary).toContainText("Rajesh Kumar");
  await expect(summary).toContainText("Raj Kumar");
  await expect(page.getByTestId("assign-scope")).toHaveAccessibleName("1 deck × 2 jury members = 2 evaluations");
  await expect(page.getByTestId("assign-bottom-summary")).toHaveText(
    "1 deck → 2 jury members · click Confirm to assign.",
  );
  await page.getByLabel("Instructions to evaluators (optional)").fill("Focus on the grid-interconnect slide.");

  await page.getByRole("button", { name: /Confirm assignment/ }).click();

  const results = page.getByRole("table", { name: "Assignment results" });
  await expect(results).toBeVisible();
  await expect(results.getByRole("columnheader")).toHaveText([
    "Assigned deck",
    "Role assigned to",
    "Name assigned to",
    "Evaluation report",
  ]);
  await expect(results.getByRole("row", { name: /GreenGrid Energy.*Rajesh Kumar/ })).toBeVisible();
  await expect(results.getByRole("row", { name: /GreenGrid Energy.*Raj Kumar/ })).toBeVisible();
  await expect(page.getByText("1 deck assigned to 2 evaluators · evaluation report sent along · deadline 7 days")).toBeVisible();

  // The round trip: the server holds BOTH evaluators with the note and a deadline…
  const board = (await (await page.request.get("/api/assignments/board")).json()) as {
    decks: Record<string, { assignees: { id: string; dueAt: string | null }[] }>;
  };
  const assignees = board.decks.inc_deck_greengrid.assignees;
  expect(assignees.map((a) => a.id).sort()).toEqual(["inc_jury", "inc_pm"]);
  expect(assignees.every((a) => a.dueAt)).toBe(true);

  // …and back on the assign view the deck now carries the Assigned badge.
  await page.getByRole("button", { name: /Assign more/ }).click();
  const row = page.getByTestId("assign-deck-row").filter({ hasText: "GreenGrid Energy" });
  await expect(row.getByText("Assigned", { exact: true })).toBeVisible();
});
