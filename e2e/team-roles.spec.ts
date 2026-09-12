import { test, expect, type Page, request as playwrightRequest } from "@playwright/test";

/**
 * W4-A — the Admin console's **Team & roles** grid, driven through the screen.
 *
 * `e2e/permissions.spec.ts` already walks this journey through the API: unticking
 * a cell removes exactly one capability from exactly one role. This walks the
 * same journey through the SURFACE an administrator actually uses — the grid
 * W3-A's engine was built for — because a screen that looks right and writes
 * nothing is the specific failure mode the parity programme exists to catch.
 *
 * Every test restores the cell it moved. `e2e:serve` seeds the local D1 once, so
 * a permission left switched off follows the suite into every later spec (§2.3).
 */

const ADMIN = "nisha.kapoor@demo.startupjury.ai";
const SUPERUSER = "priya.sharma@demo.startupjury.ai";
// The JURY's Archive cell, deliberately not the `program_associate · signuppipeline`
// cell `e2e/permissions.spec.ts` moves: the two files run on different workers
// under `fullyParallel`, so sharing a cell would mean one spec's restore landing
// inside the other's assertions — a cross-FILE version of the collision that made
// that spec serialise internally.
const JURY = "rajesh.kumar@demo.startupjury.ai";
const VC_ADMIN = "nisha.kapoor.vc@demo.startupjury.ai";
const PASSWORD = "demo1234";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

async function openTeamRoles(page: Page, email: string) {
  await login(page, email);
  await page.goto("/app/admin?section=tm");
  await expect(page.getByTestId("admin-section-title")).toHaveText("Team & roles");
  await expect(page.getByTestId("permission-grid")).toBeVisible();
}

/** Put a cell back over the API, outside the browser session. */
async function setCell(baseURL: string, role: string, taskId: string, granted: boolean) {
  const api = await playwrightRequest.newContext({ baseURL });
  const auth = await api.post("/api/auth/login", { data: { email: ADMIN, password: PASSWORD } });
  expect(auth.ok()).toBeTruthy();
  const res = await api.put("/api/permissions", { data: { cells: [{ role, taskId, granted }] } });
  expect(res.ok(), `restore ${role}/${taskId}=${granted}`).toBeTruthy();
  await api.dispose();
}

test.describe("the grid gates the product at runtime", () => {
  // This describe moves a permission cell and puts it back, and the project runs
  // `fullyParallel` on two workers — a sibling's restore landing inside these
  // assertions is exactly what made `e2e/permissions.spec.ts` serialise.
  test.describe.configure({ mode: "serial" });

  test.afterEach(async ({ baseURL }) => {
    await setCell(baseURL!, "jury", "archive", true);
  });

  test("unticking a cell in the grid removes the nav item and 403s the route", async ({
    page,
    context,
    baseURL,
  }) => {
    // Two browser sessions, four navigations and two reloads: well past the 30 s
    // default, and the walk is the point of the spec rather than its speed.
    test.setTimeout(120_000);
    // 1. The jury holds Archive today (its label is overridden to "My Archive").
    const juryPage = await context.browser()!.newPage();
    await login(juryPage, JURY);
    const nav = juryPage.locator('nav[aria-label="Primary"] a');
    await expect(nav.filter({ hasText: "My Archive" })).toHaveCount(1);
    await juryPage.goto("/app/archive");
    await expect(
      juryPage.getByRole("heading", { name: "Not available for your role" }),
    ).toHaveCount(0);

    // 2. An administrator unticks exactly one cell, on the screen.
    await openTeamRoles(page, ADMIN);
    const cell = page.getByRole("switch", { name: "Archive · Jury Member" });
    await expect(cell).toHaveAttribute("aria-checked", "true");
    await cell.click();
    await expect(cell).toHaveAttribute("aria-checked", "false");
    // It survives a reload, so the click really wrote through and the screen is
    // reading the resolved grid rather than the shipped seed.
    await page.reload();
    await expect(page.getByRole("switch", { name: "Archive · Jury Member" })).toHaveAttribute(
      "aria-checked",
      "false",
    );

    // 3. The role lost exactly that capability: the nav item is gone…
    await juryPage.reload();
    await expect(nav.filter({ hasText: "My Archive" })).toHaveCount(0);
    // …a neighbouring capability of the same role is untouched…
    await expect(nav.filter({ hasText: "Assigned" })).toHaveCount(1);
    // …and the URL is refused, not merely hidden.
    await juryPage.goto("/app/archive");
    await expect(
      juryPage.getByRole("heading", { name: "Not available for your role" }),
    ).toBeVisible();

    // 4. …and no OTHER role lost it: the admin still holds the same task.
    await expect(
      page.getByRole("switch", { name: "Archive · Admin" }),
    ).toHaveAttribute("aria-checked", "true");

    // 5. Ticking it back on the screen restores it.
    await page.getByRole("switch", { name: "Archive · Jury Member" }).click();
    await juryPage.reload();
    await expect(nav.filter({ hasText: "My Archive" })).toHaveCount(1);
    await juryPage.close();

    expect(baseURL).toBeTruthy();
  });
});

test.describe("the grid renders the prototype's shape", () => {
  test("21 × 5 in the incubator workspace, in three groups", async ({ page }) => {
    await openTeamRoles(page, ADMIN);
    const grid = page.getByTestId("permission-grid");
    await expect(grid.getByRole("switch")).toHaveCount(21 * 5);
    await expect(grid.locator("thead th")).toHaveCount(6);
    for (const group of ["General tasks", "Evaluations", "User management"]) {
      await expect(grid.getByText(group, { exact: true })).toBeVisible();
    }
    await expect(page.getByText("Roles & access — Incubator / Accelerator")).toBeVisible();
  });

  test("24 × 6 in the investor workspace", async ({ page }) => {
    await openTeamRoles(page, VC_ADMIN);
    const grid = page.getByTestId("permission-grid");
    await expect(grid.getByRole("switch")).toHaveCount(24 * 6);
    await expect(grid.locator("thead th")).toHaveCount(7);
    // VC-only rows are present and incubator-only rows are not.
    await expect(grid.getByRole("rowheader", { name: "IC pipeline" })).toBeVisible();
    await expect(grid.getByRole("rowheader", { name: "MP approval" })).toBeVisible();
    await expect(grid.getByRole("rowheader", { name: "Sign up pipeline" })).toHaveCount(0);
    await expect(page.getByText("Roles & access — Investor")).toBeVisible();
  });

  test("does not offer the two writes the API refuses", async ({ page, context }) => {
    test.setTimeout(120_000);
    await openTeamRoles(page, ADMIN);
    // The account owner's whole column is read-only (`immutable_superuser`).
    const ownerCells = page.getByRole("switch", { name: /· Super User$/ });
    await expect(ownerCells).toHaveCount(21);
    for (const cell of await ownerCells.all()) await expect(cell).toBeDisabled();
    // And you cannot close your own console door (`cannot_lock_yourself_out`).
    await expect(
      page.getByRole("switch", { name: "Access to admin console · Admin" }),
    ).toBeDisabled();

    // The superuser sees the mirror image: the owner column is still fixed, but
    // the ADMIN's console cell is not their own, so it is theirs to close.
    // A second page, not a second login on this one — `/login` redirects an
    // already-signed-in browser straight back into the app.
    const suPage = await context.browser()!.newPage();
    try {
      await openTeamRoles(suPage, SUPERUSER);
      await expect(
        suPage.getByRole("switch", { name: "Access to admin console · Super User" }),
      ).toBeDisabled();
      await expect(
        suPage.getByRole("switch", { name: "Access to admin console · Admin" }),
      ).toBeEnabled();
    } finally {
      await suPage.close();
    }
  });
});

test.describe("the roster's invite lifecycle", () => {
  test("a new member is pending until first sign-in, and Cancel removes them", async ({ page }) => {
    await openTeamRoles(page, ADMIN);

    const email = `e2e.pending.${Date.now()}@newteam.io`;
    await page.getByRole("button", { name: /Invite member/ }).click();
    await page.getByPlaceholder("Priya Sharma").fill("E2E Pending");
    await page.getByPlaceholder("colleague@company.com").fill(email);
    await page.getByRole("button", { name: "Send invite" }).click();

    // The row lands pending, in red, with Resend / Cancel and no Edit.
    const row = page.getByRole("row").filter({ hasText: email });
    await expect(row).toHaveAttribute("data-pending", "true");
    await expect(row.getByText("Invite pending")).toBeVisible();
    await expect(row.getByRole("button", { name: "Resend" })).toBeVisible();
    await expect(row.getByRole("button", { name: "Edit" })).toHaveCount(0);
    // The count is of ACTIVE members, so a pending invite does not raise it.
    await expect(page.getByText(/Active members \(\d+\)/)).toBeVisible();

    // Cancel removes the invite, and the roster no longer carries it.
    await row.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("row").filter({ hasText: email })).toHaveCount(0);
  });
});

test.describe("User access is reset-only (§1.2 / F0021)", () => {
  test("shows a password state, never a password, and resets one", async ({ page, baseURL }) => {
    // A THROWAWAY target, never a seeded login: rotating a seeded account's
    // password here would break every later spec that signs in as them.
    const email = `e2e.reset.${Date.now()}@newteam.io`;
    const api = await playwrightRequest.newContext({ baseURL: baseURL! });
    await api.post("/api/auth/login", { data: { email: ADMIN, password: PASSWORD } });
    const made = await api.post("/api/users", {
      data: { name: "E2E Reset Target", email, role: "jury" },
    });
    expect(made.ok()).toBeTruthy();
    const { user } = (await made.json()) as { user: { id: string } };

    try {
      await login(page, ADMIN);
      await page.goto("/app/admin?section=uc");
      await expect(page.getByTestId("admin-section-title")).toHaveText("User access");

      await expect(page.getByRole("columnheader", { name: "PASSWORD" })).toBeVisible();
      // No reveal control, and no masked value for one to unmask.
      await expect(page.getByRole("button", { name: /reveal/i })).toHaveCount(0);
      await expect(page.getByText("••••••••")).toHaveCount(0);
      // Your own row and the account owner's are not resettable from here.
      await expect(page.getByText("Your account")).toBeVisible();
      await expect(page.getByText("Account owner")).toBeVisible();
      // A credential nobody has used yet says exactly that.
      const target = page.getByRole("row").filter({ hasText: email });
      await expect(target.getByText("Awaiting first sign-in")).toBeVisible();

      // Resetting issues a one-time credential. No sending domain is configured
      // in the dev environment, so it is shown for the admin to relay.
      await target.getByRole("button", { name: /Reset password/ }).click();
      await expect(page.getByText(/Password reset for E2E Reset Target/)).toBeVisible();
      await expect(page.locator("code")).toHaveText(/^aisj-/);
    } finally {
      await api.delete(`/api/users/${user.id}`);
      await api.dispose();
    }
  });
});
