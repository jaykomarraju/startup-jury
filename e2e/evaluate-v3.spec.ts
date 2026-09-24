import { test, expect, type Page } from "@playwright/test";

/**
 * V3 item 10 — the v3 Evaluate toolbar, against the seeded local D1. Read-only:
 * nothing here clicks AI Evaluate, because a real re-score spends a credit and
 * this suite runs fullyParallel over one database. What the button DOES is
 * covered in test/client/evaluateV3.test.tsx, including for a program associate.
 *
 * R2-UPEVAL widened the surface to the incubator ADMIN and PROGRAM ASSOCIATE
 * (plan_roles_incubator §2 row `11 · V3-UP`), so there are now three positive
 * roles here and two negatives, and the pairing is still the point:
 *
 *   • the PROGRAM MANAGER is withheld on an open client question (Q-P — their
 *     own prototype draws a bottom action bar where v3 draws a toolbar button),
 *     so they must still see the v15 sub-line and column-1 label.
 *   • the JURY is withheld outright, and their negative is the load-bearing one:
 *     `/app/jassigned` is served by the SAME component, so a juror wrongly
 *     admitted would find the screen they score on rebuilt. Asserting v15 at
 *     `/app/evaluate` alone would not catch that, so the last test signs in as a
 *     juror and checks their own route.
 */

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

/** Settled, not merely mounted: the list arrived, or it arrived empty. */
async function decksSettled(page: Page) {
  await expect(
    page.getByRole("list", { name: "Decks to evaluate" }).or(page.getByText("Nothing to evaluate yet")),
  ).toBeVisible({ timeout: 20_000 });
}

test("the incubator superuser's Evaluate carries the v3 AI Evaluate toolbar", async ({ page }) => {
  await login(page, "priya.sharma@demo.startupjury.ai"); // incubator superuser
  await page.goto("/app/evaluate");
  await expect(page.getByRole("heading", { name: "Evaluate" })).toBeVisible();
  await decksSettled(page);

  await expect(page.getByRole("button", { name: "AI Evaluate" })).toBeVisible();
  await expect(
    page.getByText(
      "Select decks and click AI Evaluate · evaluated decks move to the Assign screen. Click a deck to open its report.",
    ),
  ).toBeVisible();
  await expect(page.getByLabel("Select all decks")).toBeVisible();
  await expect(page.getByTestId("ev-col1-count")).toHaveText("0 selected");

  // v15's copy is gone for this role, on both surfaces.
  await expect(page.getByText("Click a deck to open its evaluation report · set its status alongside")).toHaveCount(0);
  await expect(page.getByTestId("ev-decks-label")).toHaveCount(0);
});

// R2-UPEVAL — the two roles the client's row extended it to. One test each: a
// second sign-in on the same page is redirected back to /app.
for (const [label, email] of [
  ["admin", "nisha.kapoor@demo.startupjury.ai"],
  ["program associate", "sunita.rao@demo.startupjury.ai"],
] as const) {
  test(`the incubator ${label}'s Evaluate carries the v3 AI Evaluate toolbar too`, async ({ page }) => {
    await login(page, email);
    await page.goto("/app/evaluate");
    await expect(page.getByRole("heading", { name: "Evaluate" })).toBeVisible();
    await decksSettled(page);

    await expect(page.getByRole("button", { name: "AI Evaluate" })).toBeVisible();
    await expect(
      page.getByText(
        "Select decks and click AI Evaluate · evaluated decks move to the Assign screen. Click a deck to open its report.",
      ),
    ).toBeVisible();
    await expect(page.getByLabel("Select all decks")).toBeVisible();
    await expect(page.getByTestId("ev-col1-count")).toHaveText("0 selected");

    await expect(page.getByText("Click a deck to open its evaluation report · set its status alongside")).toHaveCount(0);
    await expect(page.getByTestId("ev-decks-label")).toHaveCount(0);
  });
}

test("a program manager — pending Q-P — still sees the v15 Evaluate", async ({ page }) => {
  await login(page, "raj.kumar@demo.startupjury.ai"); // incubator program manager
  await page.goto("/app/evaluate");
  await expect(page.getByRole("heading", { name: "Evaluate" })).toBeVisible();
  await decksSettled(page);

  await expect(page.getByText("Click a deck to open its evaluation report · set its status alongside")).toBeVisible();
  await expect(page.getByTestId("ev-decks-label")).toContainText("click to open report");

  await expect(page.getByRole("button", { name: "AI Evaluate" })).toHaveCount(0);
  await expect(page.getByLabel("Select all decks")).toHaveCount(0);
  await expect(page.getByTestId("ev-col1-count")).toHaveCount(0);
});

test("a juror's own Assigned screen is their prototype's table — and never V3's", async ({ page }) => {
  await login(page, "rajesh.kumar@demo.startupjury.ai"); // incubator jury
  await page.goto("/app/jassigned");
  // R7-JURY rebuilt this screen from `panel-jassigned`, so the v15 shape is no
  // longer what it draws. The boundary this test exists for is unchanged and is
  // what it still asserts: whatever `jassigned` draws, it is never V3-UP's.
  await expect(page.getByRole("heading", { name: "Assigned to me" })).toBeVisible();
  // Not `decksSettled` — that waits on the v15 list, which this screen no
  // longer draws. The table (or its empty state) is the settled signal here.
  await expect(page.getByRole("table").or(page.getByText("Nothing to evaluate yet"))).toBeVisible({
    timeout: 20_000,
  });

  await expect(
    page.getByText("Decks allocated to you for evaluation · click a startup name to open the deck and score it"),
  ).toBeVisible();
  await expect(page.getByTestId("ja-foot")).toContainText("assigned to you");

  await expect(page.getByRole("button", { name: "AI Evaluate" })).toHaveCount(0);
  await expect(page.getByLabel("Select all decks")).toHaveCount(0);
  await expect(page.getByTestId("ev-col1-count")).toHaveCount(0);
  // No per-row checkbox either — that is v3's, and it is not a juror's control.
  await expect(page.getByRole("table").getByRole("checkbox")).toHaveCount(0);
});
