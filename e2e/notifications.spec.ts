import { test, expect, type Page } from "@playwright/test";

/**
 * W3-B — Admin console → System → **Notifications** (`admin/s-nt.html`) and the
 * ribbon's notification bell.
 *
 * The journey the prototype depicts, walked end to end: an admin opens the
 * section, finds the ten events with the prototype's own 8-on/2-off mask,
 * switches one off, and finds it still off on a fresh load. Then the half the
 * prototype draws but leaves inert — the `.nb` bell — is shown to be reachable
 * for a non-admin role too, because the in-app channel is per person and not an
 * administrator's privilege.
 *
 * This spec WRITES preferences, so it restores what it found —
 * `e2e/parity.spec.ts` walks the same database.
 */

// Every test writes the same `notification_preferences` rows and the project
// runs `fullyParallel` on two workers, so this file runs serially — the same
// reason `e2e/crm-sync.spec.ts` and `e2e/question-bank.spec.ts` do.
test.describe.configure({ mode: "serial" });

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

const INC_ADMIN = "nisha.kapoor@demo.startupjury.ai";
const VC_ADMIN = "nisha.kapoor.vc@demo.startupjury.ai";
const INC_JURY = "rajesh.kumar@demo.startupjury.ai";

/**
 * The ten `.nr-lbl`s as rendered, in DOM order.
 *
 * `allInnerTexts()` does NOT auto-wait — it returns `[]` when the grid has not
 * resolved yet, which is a silent empty-array comparison rather than a useful
 * failure. Gate on the LAST row before reading, so the list is whole.
 */
async function labels(page: Page): Promise<string[]> {
  await page.getByTestId("nt-label-monthly_usage_summary").waitFor({ state: "visible" });
  const rendered = await page.locator('[data-testid^="nt-label-"]').allInnerTexts();
  return rendered.map((t) => t.trim());
}

async function openNotifications(page: Page, email = INC_ADMIN) {
  await login(page, email);
  await page.goto("/app/admin?section=nt");
  await expect(page.getByTestId("admin-section-title")).toHaveText("Notifications");
  await expect(page.getByRole("heading", { level: 2, name: "Notifications" })).toBeVisible();
}

/** The prototype's ten `.nr-lbl`s, in its own order. */
const LABELS = [
  "New pitchdeck submitted",
  "AI scoring complete",
  "Jury member submitted scores",
  "All jury complete — ready for review",
  "Startup responded to clarification questions",
  "Intro call scheduled or rescheduled",
  "Credit balance low — under 10 credits",
  "CRM sync error or failure",
  "New team member accepted invite",
  "Monthly usage summary report",
];

test("the section draws the prototype's ten events, in order, with its default mask", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openNotifications(page);

  expect(await labels(page)).toEqual(LABELS);

  // Eight on, two off — exactly the prototype's `.tog on` / `.tog` split.
  await expect(page.getByTestId("nt-tog-deck_submitted-email")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(page.getByTestId("nt-tog-founder_responded-email")).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await expect(page.getByTestId("nt-tog-invite_accepted-email")).toHaveAttribute(
    "aria-checked",
    "false",
  );

  // The sub-line names two channels, so there are two columns.
  await expect(page.getByTestId("nt-tog-deck_submitted-in_app")).toBeVisible();

  // F0143 — with no verified sending domain the section says so rather than
  // presenting toggles over a transport that is not delivering.
  await expect(page.getByTestId("nt-delivery-warning")).toContainText("Recorded");
});

test("the VC edition names the IC member instead of the jury, and nothing else moves", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openNotifications(page, VC_ADMIN);
  expect(await labels(page)).toEqual(
    LABELS.map((l) => (l === "Jury member submitted scores" ? "IC member submitted scores" : l)),
  );
});

test("a toggle persists across a reload, and resets back to the workspace default", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openNotifications(page);

  const toggle = page.getByTestId("nt-tog-ai_scoring_complete-email");
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(
    page.getByTestId("nt-row-ai_scoring_complete").getByText("Your override"),
  ).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("nt-tog-ai_scoring_complete-email")).toHaveAttribute(
    "aria-checked",
    "false",
  );

  // Restore: the reset control drops this user's overrides only.
  await page.getByRole("button", { name: "Reset to workspace defaults" }).click();
  await expect(page.getByTestId("nt-tog-ai_scoring_complete-email")).toHaveAttribute(
    "aria-checked",
    "true",
  );
});

test("the delivery log reads the outbox back (F0144)", async ({ page }) => {
  test.setTimeout(120_000);
  await openNotifications(page);
  await expect(page.getByText("Recent delivery")).toBeVisible();
  await expect(page.getByTestId("nt-outbox")).toBeVisible();
  // Rendered, not authored: the header row is `uppercase`, and what the
  // reviewer sees is what this pins (plan §4 — assert the exact header set).
  const headers = await page
    .locator('[data-testid="nt-outbox"] >> xpath=../thead/tr/th')
    .allInnerTexts();
  expect(headers.map((h) => h.trim())).toEqual([
    "EVENT",
    "RECIPIENT",
    "SUBJECT",
    "STATUS",
    "SENT",
  ]);
});

test("a non-admin reaches their own mask on My account (§8 Q16(c))", async ({ page }) => {
  test.setTimeout(120_000);
  // A jury member cannot open the Admin console at all — and `s-nt` scopes its
  // toggles to one person, so this is where the other nine roles switch off
  // their own mail.
  await login(page, INC_JURY);
  await page.goto("/app/account");
  await expect(page.getByRole("heading", { level: 2, name: "Notifications" })).toBeVisible();

  const toggle = page.getByTestId("nt-tog-deck_submitted-email");
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  // The workspace policy is not theirs to set, so the scope switch is absent.
  await expect(page.getByTestId("nt-scope-workspace")).toHaveCount(0);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await page.reload();
  await expect(page.getByTestId("nt-tog-deck_submitted-email")).toHaveAttribute(
    "aria-checked",
    "false",
  );

  // Restore, so `e2e/parity.spec.ts` walks the state it expects.
  await page.getByRole("button", { name: "Reset to workspace defaults" }).click();
  await expect(page.getByTestId("nt-tog-deck_submitted-email")).toHaveAttribute(
    "aria-checked",
    "true",
  );
});

test("the bell is in the ribbon for every role, admin or not", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, INC_JURY);
  const bell = page.getByTestId("notification-bell");
  await expect(bell).toBeVisible();

  await bell.click();
  const centre = page.getByTestId("notification-centre");
  await expect(centre).toBeVisible();
  // Empty or populated, it must say something — never a blank popover.
  await expect(centre).toContainText(/Notifications/);

  // Escape closes it, as the prototype's profile menu does.
  await page.keyboard.press("Escape");
  await expect(centre).toBeHidden();
});
