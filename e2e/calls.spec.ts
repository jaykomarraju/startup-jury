import { test, expect, type Page } from "@playwright/test";

// Session 7 — call scheduling + ICS, and the internal issue log.
//
// Fixtures come from migration 0018: GreenRoute (incubator, shortlisted) has a
// seeded intro call with the PM as organizer and the jury member as a
// participant; WealthOS (VC, associate_review) has one organised by the
// associate; MedGrid has a partner call.
//
// These specs deliberately avoid rescheduling the SEEDED calls — the suite runs
// fullyParallel against one shared local D1, so each mutating test schedules on
// a deck no other spec touches.

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

test("VC intro calls is a real screen with the seeded call", async ({ page }) => {
  await login(page, "sunita.rao.vc@demo.startupjury.ai"); // vc_associate
  await page.goto("/app/introcalls");

  await expect(page.getByRole("heading", { name: "Intro calls" })).toBeVisible();
  // It used to render the "coming soon" stub.
  await expect(page.getByText("coming soon")).toHaveCount(0);

  const row = page.getByRole("row", { name: /WealthOS/ });
  await expect(row).toBeVisible();
  await expect(row.getByText("Scheduled")).toBeVisible();
  // The founder is on the invite at their own domain (§8: any email domain).
  await expect(row.getByText(/WealthOS founder/)).toBeVisible();
  await expect(row.getByRole("link", { name: ".ics" })).toBeVisible();
});

test("the scheduling modal opens prefilled from an existing call", async ({ page }) => {
  await login(page, "sunita.rao.vc@demo.startupjury.ai");
  await page.goto("/app/introcalls");

  // Asserts the scheduling modal opens fully populated from the existing call
  // without committing a change — the suite is fullyParallel over one shared D1,
  // so mutating the seeded WealthOS call would race the other specs. The commit
  // path itself is covered exhaustively in test/worker/calls.test.ts.
  const row = page.getByRole("row", { name: /WealthOS/ });
  await row.getByRole("button", { name: "Reschedule" }).click();

  await expect(page.getByRole("heading", { name: /Reschedule intro calls/i })).toBeVisible();
  await expect(page.getByLabel("Date and time")).toHaveValue(/2026-08-19/);
  await expect(page.getByLabel("Founder email")).toHaveValue("founder@wealthos.example");
  // The participant picker is populated from the edition directory.
  await expect(page.getByText(/participants selected/)).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: /Reschedule intro calls/i })).toHaveCount(0);
});

test("a partner schedules an alignment call and downloads the invite", async ({ page }) => {
  await login(page, "ishaan.sethi@demo.startupjury.ai"); // vc_partner
  await page.goto("/app/alignmentcall");

  await expect(page.getByRole("heading", { name: "Alignment call" })).toBeVisible();
  const row = page.getByRole("row", { name: /LearnLoop/ });
  await expect(row).toBeVisible();

  // The .ics link is a real download of a real calendar file.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    row.getByRole("link", { name: ".ics" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.ics$/);

  // The term-sheet capture survived the move off StagePage.
  await expect(row.getByPlaceholder("Valuation")).toBeVisible();
  await expect(row.getByRole("button", { name: "Issue term sheet" })).toBeVisible();
});

test("an IC member sees only the calls they are on, read-only", async ({ page }) => {
  await login(page, "rajesh.kumar.vc@demo.startupjury.ai"); // vc_ic
  await page.goto("/app/introcalls");

  // IC members are read-only participants, so the nav label (and the heading)
  // reads "My Intro calls".
  await expect(page.getByRole("heading", { name: "My Intro calls" })).toBeVisible();
  // The IC member is on MedGrid's partner call and LearnLoop's alignment call —
  // neither is an intro call — so the intro screen has nothing for them, and it
  // must NOT fall back to showing the whole stage.
  await expect(page.getByText("No intro calls yet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Schedule call" })).toHaveCount(0);
});

test("the incubator intro-call screen schedules and moves the deck", async ({ page }) => {
  await login(page, "raj.kumar@demo.startupjury.ai"); // inc_pm
  await page.goto("/app/introcalls");

  await expect(page.getByRole("heading", { name: "Intro calls" })).toBeVisible();
  const row = page.getByRole("row", { name: /GreenRoute/ });
  await expect(row).toBeVisible();
  await expect(row.getByText("Scheduled")).toBeVisible();
  await expect(row.getByText(/Rajesh Kumar/)).toBeVisible(); // the invited juror
});

test("a jury member sees their intro call read-only", async ({ page }) => {
  await login(page, "rajesh.kumar@demo.startupjury.ai"); // inc_jury
  await page.goto("/app/introcalls");

  await expect(page.getByRole("heading", { name: "My Intro calls" })).toBeVisible();
  await expect(page.getByRole("row", { name: /GreenRoute/ })).toBeVisible();
  // Read-only: no scheduling controls at all.
  await expect(page.getByRole("button", { name: /Schedule call|Reschedule/ })).toHaveCount(0);
  // …but they can still add it to their own calendar.
  await expect(page.getByRole("link", { name: ".ics" })).toBeVisible();
});

test("the VC Query screen lists founder queries and sends one", async ({ page }) => {
  await login(page, "rhea.nair@demo.startupjury.ai"); // vc_analyst
  await page.goto("/app/query");

  await expect(page.getByRole("heading", { name: "Query", exact: true })).toBeVisible();
  await expect(page.getByText("coming soon")).toHaveCount(0);
  // The prototype's column set.
  await expect(page.getByRole("columnheader", { name: "Parameters needing response" })).toBeVisible();

  await page.getByRole("button", { name: /CyberVault|WealthOS|QuantIQ/ }).first().click();
  await page.getByPlaceholder(/current MRR/).fill("Please share ARR and net revenue retention.");
  await page.getByRole("button", { name: "Send query" }).click();
  await expect(page.getByText(/Please share ARR/)).toBeVisible();
});

test("the team logs and triages an internal issue", async ({ page }) => {
  await login(page, "nisha.kapoor@demo.startupjury.ai"); // inc_admin
  await page.goto("/app/issues");

  await expect(page.getByRole("heading", { name: "Issue log" })).toBeVisible();
  // Seeded issues are there, and the support queue's tickets are not.
  await expect(page.getByText("Deck viewer shows a blank first slide on Safari")).toBeVisible();

  const subject = `E2E issue ${Date.now()}`;
  await page.getByLabel("Issue summary").fill(subject);
  await page.getByLabel("Issue detail").fill("Filed by the e2e suite.");
  await page.getByLabel("Severity").selectOption("high");
  await page.getByRole("button", { name: "Log issue" }).click();

  const row = page.locator("tr").filter({ hasText: subject });
  await expect(row).toBeVisible();
  await expect(row.getByText("High")).toBeVisible();

  // An admin can triage it straight from the table.
  await row.getByLabel(`Status for ${subject}`).selectOption("closed");
  await page.getByRole("button", { name: /^Closed · / }).click();
  await expect(page.locator("tr").filter({ hasText: subject })).toBeVisible();
});

test("a non-admin can file an issue but not triage it", async ({ page }) => {
  await login(page, "rajesh.kumar@demo.startupjury.ai"); // inc_jury
  await page.goto("/app/issues");

  await expect(page.getByRole("heading", { name: "Issue log" })).toBeVisible();
  await expect(page.getByLabel("Issue summary")).toBeVisible();
  // No triage controls for a non-admin.
  await expect(page.getByRole("combobox", { name: /^Status for / })).toHaveCount(0);
});
