import { test, expect, type Browser, type Page } from "@playwright/test";

// Wave A · P3 — tracker row 13, "Tickets module from raise to close with status and
// notifications", walked end to end by the two people it is between: a juror who
// raises from Contact Admin, and an admin who triages from Tickets. Every subject is
// unique per run because the suite is `fullyParallel` against one local D1.
//
// The worker suite (`test/worker/tickets.test.ts`) owns the rules — who is told,
// which workspace, what is refused. This file owns the claim a person actually sees:
// the juror learns, on their own screen and in their bell, that it was resolved and
// how — and nothing on either screen says an email went anywhere.

const JURY = "rajesh.kumar@demo.startupjury.ai";
const ADMIN = "nisha.kapoor@demo.startupjury.ai";

async function signedIn(browser: Browser, email: string, viewport?: { width: number; height: number }): Promise<Page> {
  const context = await browser.newContext(viewport ? { viewport } : {});
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
  return page;
}

test("a juror's ticket goes raise → in progress → resolved, and the juror is told each time", async ({ browser }) => {
  const subject = `P3 e2e cannot see Cohort 6 ${Date.now()}`;

  // ── Raise ──
  const jury = await signedIn(browser, JURY);
  await jury.goto("/app/contactadmin");
  await jury.getByLabel("Issue category").selectOption("Permissions & roles");
  await jury.getByLabel("Priority").selectOption("high");
  await jury.getByLabel("Subject").fill(subject);
  await jury.getByLabel("Description").fill("The Jury Pipeline is empty for me.");
  await jury.getByRole("button", { name: "Raise ticket" }).click();
  await expect(jury.getByTestId("ticket-notice")).toContainText("notified in the app");
  await expect(jury.getByTestId("ticket-notice")).not.toContainText(/e-?mail|\bsent\b/i);
  const mine = jury.locator('[data-testid^="my-ticket-"]').filter({ hasText: subject });
  await expect(mine).toContainText("Open");

  // ── In progress ──
  const admin = await signedIn(browser, ADMIN);
  await admin.goto("/app/support");
  await expect(admin.getByRole("heading", { level: 1, name: "Support tickets" })).toBeVisible();
  await admin.getByLabel(`Status for ${subject}`).selectOption("in_progress");
  await expect(admin.getByTestId("ticket-notice")).toContainText("Rajesh Kumar was notified in the app.");

  // ── Resolved, with the answer ──
  await admin.getByRole("button", { name: `Open ${subject}` }).click();
  const pane = admin.getByTestId("ticket-detail");
  await pane.getByRole("button", { name: "Mark resolved…" }).click();
  await pane.getByLabel("Resolution").fill("Added you to the Cohort 6 panel.");
  await pane.getByRole("button", { name: "Mark resolved", exact: true }).click();
  await expect(admin.getByTestId("ticket-notice")).toContainText("is now Resolved. Rajesh Kumar was notified in the app.");
  await expect(admin.getByTestId("ticket-notice")).not.toContainText(/e-?mail|\bsent\b/i);

  // ── The juror sees it, on their own list and in their bell ──
  await jury.reload();
  await expect(mine).toContainText("Resolved");
  await expect(mine).toContainText("Resolution: Added you to the Cohort 6 panel.");
  await jury.getByTestId("notification-bell").click();
  const centre = jury.getByTestId("notification-centre");
  await expect(centre.getByText("Your ticket was resolved").first()).toBeVisible();
  await expect(centre.getByText(`${subject} — Added you to the Cohort 6 panel.`)).toBeVisible();
});

test("both ticket screens fit a 393px phone without sideways scroll", async ({ browser }) => {
  const phone = { width: 393, height: 852 };
  for (const [email, slug, heading] of [
    [JURY, "contactadmin", "Contact Admin"],
    [ADMIN, "support", "Support tickets"],
  ] as const) {
    const page = await signedIn(browser, email, phone);
    await page.goto(`/app/${slug}`);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.getByText("Loading…")).toHaveCount(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${slug} scrolls sideways at 393px`).toBeLessThanOrEqual(0);
  }
});
