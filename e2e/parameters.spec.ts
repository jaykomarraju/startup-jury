import { test, expect, type Page } from "@playwright/test";

// W8-B — My Parameters, end to end: a workspace administrator renames one of the
// jury's parameters and rewrites the description the juror reads while scoring,
// and the juror sees both on the Evaluate screen's "at a glance" card.
//
// Mutates a seeded row, so it restores it in `finally`. "Scalability" on the
// incubator side is asserted by no other spec (config.spec and incubator.spec
// read "Barriers of entry").

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

// The incubator Super User. §8 Q116: configuring the role parameters needs a
// Premium SEAT as well as a Premium workspace, and the seeded Client Admin holds
// a Pro seat (0052) — the Super User is the administrator who can do this.
const SUPER = "priya.sharma@demo.startupjury.ai";
const JURY = "rajesh.kumar@demo.startupjury.ai";

const RENAMED = "Scalability (W8-B)";
const DESCRIPTION = "W8-B e2e — judge whether revenue can grow faster than cost.";

interface RoleParam {
  id: string;
  name: string;
  roleScope: string;
  description?: string;
}

test("an administrator renames a jury parameter and edits its scoring description; the juror sees both", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  await login(page, SUPER);

  const before = (await (await page.request.get("/api/config/parameters")).json()) as {
    additionalParams: RoleParam[];
  };
  const original = before.additionalParams.find((p) => p.roleScope === "jury" && p.name === "Scalability")!;
  expect(original).toBeTruthy();

  try {
    await page.goto("/app/myparams");
    await expect(page.getByRole("heading", { level: 1, name: "My Parameters — Role configuration" })).toBeVisible();
    const tabs = page.getByRole("tablist", { name: "Owning roles" }).getByRole("tab");
    await expect(tabs).toHaveText(["Program Manager", "Program Associate", "Jury Member"]);

    await page.getByRole("tab", { name: "Jury Member" }).click();
    const panel = page.getByRole("tabpanel");
    await expect(panel.getByText("Jury Member · 3 configurable parameters")).toBeVisible();

    await panel.getByLabel("Label for Scalability", { exact: true }).fill(RENAMED);
    await panel.getByLabel("Scoring description for Scalability", { exact: true }).fill(DESCRIPTION);
    await panel.getByRole("button", { name: "Save all parameters" }).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();

    // Persisted, not just drawn: a fresh load carries both.
    await page.reload();
    await page.getByRole("tab", { name: "Jury Member" }).click();
    await expect(page.getByLabel(`Label for ${RENAMED}`, { exact: true })).toHaveValue(RENAMED);
    await expect(page.getByLabel(`Scoring description for ${RENAMED}`, { exact: true })).toHaveValue(DESCRIPTION);

    // The juror, in a context of their own (a second sign-in on this page would
    // be redirected to /app), sees the rename.
    //
    // R7-JURY — this used to read the "at a glance" panel on `/app/jassigned`,
    // which was column 3 of the v15 Evaluate screen. That screen is now the
    // jury prototype's six-column allocation table and carries no such panel.
    // The juror's own My Parameters screen draws the identical panel and IS in
    // their nav, so the assertions move there unchanged — and the second half
    // below is the stronger claim anyway: the rename reaches the surface the
    // juror actually scores on.
    const jurorContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
    try {
      const juror = await jurorContext.newPage();
      await login(juror, JURY);

      await juror.goto("/app/myparams");
      await juror.getByRole("button", { name: "Preview in scoring view" }).click();
      const glance = juror.getByRole("dialog", { name: "Preview in scoring view" });
      await expect(glance.getByText("Your three additional parameters at a glance")).toBeVisible();
      await expect(glance.getByText(RENAMED)).toBeVisible();
      await expect(glance.getByText(DESCRIPTION)).toBeVisible();
      await expect(glance.getByText("Scalability", { exact: true })).toHaveCount(0);
      await glance.getByRole("button", { name: "Close preview" }).click();

      // …and in the scorecard itself, opened from the Assigned table.
      await juror.goto("/app/jassigned");
      await juror.getByTitle("Open the deck and score it").first().click();
      const workbench = juror.getByRole("dialog", { name: /^Evaluate / });
      await expect(workbench.getByText("Additional parameters · your lens")).toBeVisible();
      await expect(workbench.getByText(RENAMED)).toBeVisible();
      await expect(workbench.getByText("Scalability", { exact: true })).toHaveCount(0);
    } finally {
      await jurorContext.close();
    }
  } finally {
    const restored = await page.request.put(`/api/config/additional-params/${original.id}`, {
      data: { name: original.name, description: original.description ?? "" },
    });
    expect(restored.ok()).toBe(true);
  }
});
