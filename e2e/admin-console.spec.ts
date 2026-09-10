import { test, expect, type Page } from "@playwright/test";
import {
  ADMIN_SECTION_GROUPS,
  adminSections,
  adminSectionsFor,
} from "../src/client/routes/admin/sections";
import type { Edition, Role } from "../src/shared/roles";

/**
 * The Admin console shell (W1-C). The prototype's console is a full-screen
 * sixteen-section overlay reached from the sidebar by `openAdmin()`; the repo
 * shipped a single flat user-CRUD page in its place. These walks assert the
 * three things that shape is made of — every section is reachable, no
 * non-admin role can reach the console at all, and the Sign-up group is
 * withheld even from a role that could otherwise get in.
 */

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

const ADMINS: { email: string; edition: Edition; role: Role }[] = [
  { email: "priya.sharma@demo.startupjury.ai", edition: "incubator", role: "superuser" },
  { email: "nisha.kapoor@demo.startupjury.ai", edition: "incubator", role: "admin" },
  { email: "aarav.khanna@demo.startupjury.ai", edition: "vc", role: "superuser" },
  { email: "nisha.kapoor.vc@demo.startupjury.ai", edition: "vc", role: "admin" },
];

/** Roles that reach the app but must never reach the console. */
const NON_ADMINS: { email: string; edition: Edition; role: Role }[] = [
  { email: "raj.kumar@demo.startupjury.ai", edition: "incubator", role: "program_manager" },
  { email: "sunita.rao@demo.startupjury.ai", edition: "incubator", role: "program_associate" },
  { email: "rajesh.kumar@demo.startupjury.ai", edition: "incubator", role: "jury" },
  { email: "ishaan.sethi@demo.startupjury.ai", edition: "vc", role: "partner" },
  { email: "rajesh.kumar.vc@demo.startupjury.ai", edition: "vc", role: "ic_member" },
  { email: "sunita.rao.vc@demo.startupjury.ai", edition: "vc", role: "associate" },
  { email: "rhea.nair@demo.startupjury.ai", edition: "vc", role: "analyst" },
];

for (const admin of ADMINS) {
  test(`${admin.edition}/${admin.role} walks all 16 admin console sections`, async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, admin.email);
    await page.goto("/app/admin");

    const console_ = page.getByRole("dialog", { name: "Admin console" });
    await expect(console_).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Admin console" })).toBeVisible();

    const rail = page.getByRole("navigation", { name: "Admin console sections" });
    for (const group of ADMIN_SECTION_GROUPS) {
      await expect(rail.getByText(group, { exact: true })).toBeVisible();
    }

    const sections = adminSections(admin.edition);
    expect(sections).toHaveLength(16);

    // Opens on Scoring framework, as the prototype's `.ni on` does.
    await expect(page.getByTestId("admin-section-title")).toHaveText("Scoring framework");

    for (const section of sections) {
      await rail.getByRole("button", { name: section.label, exact: false }).click();
      await expect(page.getByTestId("admin-section-title")).toHaveText(section.label);
      await expect(page).toHaveURL(new RegExp(`/app/admin\\?section=${section.id}$`));
      // Every section renders a body: either its heading (placeholder or the
      // built Team & roles roster) — never a blank pane.
      await expect(page.getByRole("heading", { level: 2, name: section.heading })).toBeVisible();
      // …and, while it still HAS a placeholder, names the session that will
      // fill it. W2-C: was `if (section.id !== "tm")`, which pinned Wave 1's
      // state and would break for every session in Waves 2–5 as each replaces
      // one placeholder. Read off the page rather than off the registry —
      // importing `registry.tsx` here drags the whole client component tree
      // (and pdfjs's `?url` import) into Playwright's Node transform.
      if ((await page.getByText("Not built yet").count()) > 0) {
        await expect(
          page.getByText(section.placeholder.owner, { exact: true }).first(),
        ).toBeVisible();
      }
    }

    // Team & roles still carries the user-CRUD roster it replaced — with the
    // same columns. `e2e/parity.spec.ts` used to pin this header set at
    // /app/admin; the console opens on Scoring framework now, so the pin lives
    // here (plan_parity.md §4: assert the exact header set).
    await rail.getByRole("button", { name: "Team & roles", exact: false }).click();
    await expect(page.getByRole("button", { name: "Add user" })).toBeVisible();
    // The roster table only exists once listUsers resolves; the Add-user card
    // below it does not wait, so reading headers straight away races the fetch.
    await expect(page.getByRole("columnheader", { name: "MEMBER" })).toBeVisible();
    const headers = await page.locator("table thead th").allInnerTexts();
    expect(headers.map((h) => h.replace(/\s+/g, " ").trim())).toEqual([
      "MEMBER",
      "ROLE",
      "ORGANIZATIONAL TITLE",
      "TYPE",
      "STATUS",
      "ACTION",
    ]);

    // The title bar carries the scope chip and the global save.
    await expect(page.getByTestId("admin-context-chip")).toBeVisible();
    await expect(page.getByRole("button", { name: /Save changes/ })).toBeVisible();

    // Escape closes the overlay and lands back in the app.
    await page.keyboard.press("Escape");
    await expect(console_).toBeHidden();
    await expect(page).not.toHaveURL(/\/app\/admin/);
  });

  test(`${admin.edition}/${admin.role} closes the console with the Close button`, async ({
    page,
  }) => {
    await login(page, admin.email);
    await page.goto("/app/admin");
    await expect(page.getByRole("dialog", { name: "Admin console" })).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("dialog", { name: "Admin console" })).toBeHidden();
    await expect(page).not.toHaveURL(/\/app\/admin/);
  });
}

// The fourth Sign-up section is the one place the two editions' consoles
// differ: `suseat` Seat capacity in the incubator, `sufund` Fund Deployment in
// the VC build (AISJ_VC_Superuser_V8 / AISJ_VC_Admin_V4, `secs[11]`).
const EDITION_SWAP: { edition: Edition; email: string; present: string; absent: string }[] = [
  {
    edition: "incubator",
    email: "priya.sharma@demo.startupjury.ai",
    present: "Seat capacity",
    absent: "Fund Deployment",
  },
  {
    edition: "vc",
    email: "aarav.khanna@demo.startupjury.ai",
    present: "Fund Deployment",
    absent: "Seat capacity",
  },
];

for (const swap of EDITION_SWAP) {
  test(`the ${swap.edition} console shows ${swap.present}, not ${swap.absent}`, async ({ page }) => {
    await login(page, swap.email);
    await page.goto("/app/admin");
    const rail = page.getByRole("navigation", { name: "Admin console sections" });
    await expect(rail.getByRole("button", { name: swap.present, exact: false })).toBeVisible();
    await expect(rail.getByRole("button", { name: swap.absent, exact: false })).toHaveCount(0);
  });
}

for (const person of NON_ADMINS) {
  test(`${person.edition}/${person.role} cannot reach the admin console at all`, async ({
    page,
  }) => {
    await login(page, person.email);

    // No sidebar entry.
    await expect(page.getByRole("link", { name: "Admin console" })).toHaveCount(0);

    // …and the route itself is refused, not merely hidden.
    await page.goto("/app/admin");
    await expect(page.getByText("Not available for your role")).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Admin console" })).toHaveCount(0);

    // The negative that matters most (§4): none of the Sign-up sections leak.
    for (const label of [
      "Required documents",
      "Agreements library",
      "Authorised signatories",
      "Seat capacity",
      "Fund Deployment",
    ]) {
      await expect(page.getByText(label, { exact: true })).toHaveCount(0);
    }

    // The registry withholds the whole Sign-up group from this role, so the
    // console cannot hand it over if reachability ever widens (F0038).
    const visible = adminSectionsFor(person.edition, person.role);
    expect(visible.map((s) => s.group)).not.toContain("Sign-up");
    expect(visible).toHaveLength(12);
  });
}

test("a deep link to a Sign-up section falls back for a role that cannot see it", async ({
  page,
}) => {
  await login(page, "raj.kumar@demo.startupjury.ai");
  await page.goto("/app/admin?section=sudocs");
  await expect(page.getByText("Not available for your role")).toBeVisible();
});

test("the section rail collapses to an off-canvas drawer below 760 px", async ({ page }) => {
  await login(page, "nisha.kapoor@demo.startupjury.ai");
  await page.goto("/app/admin");
  const rail = page.getByRole("navigation", { name: "Admin console sections" });
  await expect(rail).toBeInViewport();

  await page.setViewportSize({ width: 700, height: 900 });
  const menu = page.getByRole("button", { name: "Open admin console sections" });
  await expect(menu).toBeVisible();
  // Off-canvas: translated out of the viewport, and the context chip is hidden.
  await expect(rail).not.toBeInViewport();
  await expect(page.getByTestId("admin-context-chip")).toBeHidden();

  await menu.click();
  await expect(rail).toBeInViewport();
  await rail.getByRole("button", { name: /Audit log/ }).click();
  await expect(page.getByTestId("admin-section-title")).toHaveText("Audit log");
  await expect(rail).not.toBeInViewport();
});
