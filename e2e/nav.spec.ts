import { test, expect, type Page } from "@playwright/test";
import { navForUser, navLabel } from "../src/shared/nav";
import { roleLabel, editionLabel, type Edition, type Role } from "../src/shared/roles";

interface SeedUser {
  email: string;
  edition: Edition;
  role: Role;
}

// Every Phase 1 seed user (password demo1234). The permission matrix is asserted
// by comparing the rendered sidebar to navForUser(edition, role).
const USERS: SeedUser[] = [
  { email: "priya.sharma@demo.startupjury.ai", edition: "incubator", role: "superuser" },
  { email: "nisha.kapoor@demo.startupjury.ai", edition: "incubator", role: "admin" },
  { email: "raj.kumar@demo.startupjury.ai", edition: "incubator", role: "program_manager" },
  { email: "sunita.rao@demo.startupjury.ai", edition: "incubator", role: "program_associate" },
  { email: "rajesh.kumar@demo.startupjury.ai", edition: "incubator", role: "jury" },
  { email: "meera.sharma@demo.startupjury.ai", edition: "incubator", role: "founder" },
  { email: "aarav.khanna@demo.startupjury.ai", edition: "vc", role: "superuser" },
  { email: "nisha.kapoor.vc@demo.startupjury.ai", edition: "vc", role: "admin" },
  { email: "ishaan.sethi@demo.startupjury.ai", edition: "vc", role: "partner" },
  { email: "rajesh.kumar.vc@demo.startupjury.ai", edition: "vc", role: "ic_member" },
  { email: "sunita.rao.vc@demo.startupjury.ai", edition: "vc", role: "associate" },
  { email: "rhea.nair@demo.startupjury.ai", edition: "vc", role: "analyst" },
];

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

for (const user of USERS) {
  test(`${user.edition}/${user.role} sees only its permitted nav`, async ({ page }) => {
    await login(page, user.email);

    // Topbar identity reflects role + edition.
    await expect(page.getByText(roleLabel(user.edition, user.role), { exact: true })).toBeVisible();
    await expect(page.getByText(editionLabel(user.edition), { exact: true })).toBeVisible();

    // Sidebar nav matches navForUser exactly (labels + order).
    const expected = navForUser(user.edition, user.role).map((item) =>
      navLabel(user.role, item),
    );
    const rendered = await page
      .locator('nav[aria-label="Primary"] a')
      .allInnerTexts();
    expect(rendered.map((t) => t.trim())).toEqual(expected);
  });
}

test("a forbidden deep-link is guarded (VC analyst → legaldd)", async ({ page }) => {
  await login(page, "rhea.nair@demo.startupjury.ai");
  await page.goto("/app/legaldd");
  await expect(
    page.getByRole("heading", { name: "Not available for your role" }),
  ).toBeVisible();
});

test("founder is isolated to the founder portal (no All decks)", async ({ page }) => {
  await login(page, "meera.sharma@demo.startupjury.ai");
  const rendered = await page.locator('nav[aria-label="Primary"] a').allInnerTexts();
  expect(rendered.map((t) => t.trim())).toContain("My Startup");
  expect(rendered.join("|")).not.toContain("All decks");
  await page.goto("/app/alldecks");
  await expect(
    page.getByRole("heading", { name: "Not available for your role" }),
  ).toBeVisible();
});
