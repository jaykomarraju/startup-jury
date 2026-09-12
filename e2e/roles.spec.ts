import { test, expect, type Page } from "@playwright/test";

// Session 4 — Roles & permissions: user management (Admin console), the PM
// decision surfaces, Buy credits, My account, and the associate's read-only
// Set up seat.

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

const INC_ADMIN = "nisha.kapoor@demo.startupjury.ai";
const INC_PM = "raj.kumar@demo.startupjury.ai";
const INC_PA = "sunita.rao@demo.startupjury.ai";
const INC_JURY = "rajesh.kumar@demo.startupjury.ai";

test("admin creates a user in the Admin console and gets a temp password", async ({ page }) => {
  await login(page, INC_ADMIN);
  // W1-C: the Admin console is now the prototype's sixteen-section overlay and
  // opens on Scoring framework. The user roster is its Team & roles section.
  await page.goto("/app/admin?section=tm");
  await expect(page.getByRole("heading", { name: "Admin console" })).toBeVisible();
  await expect(page.getByTestId("admin-section-title")).toHaveText("Team & roles");

  // W4-A, flagged per plan §4 — the ROUTE to the form changed, not what this
  // test asserts. F0067 reports the always-open create card as the wrong shape:
  // the prototype puts an "Invite member" button in the roster card's header
  // and opens the form from it, and the submit reads "Send invite". Every
  // assertion below is unchanged.
  await page.getByRole("button", { name: /Invite member/ }).click();

  // A unique email so repeat runs against a warm dev server don't collide.
  const email = `e2e.juror.${Date.now()}@newteam.io`;
  await page.getByLabel("Full name").fill("E2E Juror");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Role").selectOption("jury");
  await page.getByRole("button", { name: "Send invite" }).click();

  // The one-time temporary password callout appears...
  await expect(page.getByText("temporary password", { exact: false })).toBeVisible();
  // ...and the new user joins the roster. Scoped to the ROSTER table: the
  // section also renders the task-permission grid, so a bare `table` locator is
  // no longer unique.
  await expect(page.getByTestId("member-roster").getByText(email)).toBeVisible();
});

test("admin can add a mentor as a user-type", async ({ page }) => {
  await login(page, INC_ADMIN);
  await page.goto("/app/admin?section=tm");
  const email = `e2e.mentor.${Date.now()}@advisors.io`;
  // See the note above: the form opens from the card header now.
  await page.getByRole("button", { name: /Invite member/ }).click();
  await page.getByLabel("Full name").fill("E2E Mentor");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("User type").selectOption("mentor");
  // The advisor note explains a mentor has no pipeline access.
  await expect(page.getByText("no evaluation or pipeline access", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Send invite" }).click();
  // The new mentor's own row shows the email and is labelled "Mentor" (both the
  // role label and the type tag read "Mentor" for a mentor user-type).
  const row = page.locator("tr").filter({ hasText: email });
  await expect(row).toBeVisible();
  await expect(row.getByText("Mentor", { exact: true }).first()).toBeVisible();
});

test("program manager reaches the intro-call decision screen", async ({ page }) => {
  await login(page, INC_PM);
  await page.goto("/app/introcalls");
  // PM now has the decision surface (was associate/jury only before Session 4).
  await expect(page.getByRole("heading", { name: "Intro calls" })).toBeVisible();
  await expect(page.getByText("Not available for your role")).toHaveCount(0);
});

test("admin buys a credit pack (simulated top-up)", async ({ page }) => {
  await login(page, INC_ADMIN);
  await page.goto("/app/billing");
  await expect(page.getByRole("heading", { name: "Buy credits" })).toBeVisible();
  await expect(page.getByText("Demo mode", { exact: false })).toBeVisible();

  // Buy the first Pro pack (20 credits).
  await page.getByRole("button", { name: "Buy credits" }).first().click();
  await expect(page.getByText("Added 20 credits")).toBeVisible();
});

test("a team member sees their own account and can sign out", async ({ page }) => {
  await login(page, INC_JURY);
  await page.goto("/app/account");
  await expect(page.getByRole("heading", { name: "My account" })).toBeVisible();
  // The profile row (a <dd>) shows the signed-in member's name.
  await expect(page.locator("dd").filter({ hasText: "Rajesh Kumar" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
});

test("program associate sees Set up read-only (Standard seat)", async ({ page }) => {
  await login(page, INC_PA);
  await page.goto("/app/setup");
  await expect(page.getByText("Read-only — Standard seat", { exact: false })).toBeVisible();
  // The mutation controls are hidden for a Standard seat.
  await expect(page.getByRole("button", { name: "Add program" })).toHaveCount(0);
});
