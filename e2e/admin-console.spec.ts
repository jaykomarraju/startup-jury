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
 * three things that shape is made of — every shipped section is reachable, no
 * non-admin role can reach the console at all, and the Sign-up group is
 * withheld from everybody.
 *
 * **ELEVEN of the prototype's sixteen ship** (S2-ADMIN, 30-Sep). `pc` Price
 * configuration was removed on 24-Sep, and the same day's feedback row 11 hid
 * the whole Sign-up group — four sections — until the next release. The screens
 * and their routes are untouched: `src/client/routes/admin/sections.ts`
 * `HIDDEN_ADMIN_GROUPS` is the one line that decides it, and the walks of those
 * four screens are skipped, not deleted, in `e2e/signup-config.spec.ts` and
 * `e2e/agreements.spec.ts`.
 */

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

/**
 * The placeholder check below was `section.id !== "tm"`, true only while Wave 1
 * was the whole registry — every Wave 2–5 session that lands a section breaks it.
 * All three Wave 2 sessions rewrote it independently: W2-A and W2-C branched on
 * what is on screen, W2-B kept a named `BUILT` set to append to. Wave 2
 * integration kept the screen-driven form — it needs no per-wave edit, so it
 * stops being a recurring merge conflict — and folded in W2-B's negative half,
 * which is the stronger assertion: a section that has been built must no longer
 * name an owner. **Nothing to add here when you land a section.**
 */

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
  test(`${admin.edition}/${admin.role} walks all 11 admin console sections`, async ({ page }) => {
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
    // Eleven since 24-Sep, in two steps. "Price configuration" left the customer
    // console at the client's instruction ("why would a user set their price"):
    // the catalogue is one document serving every customer, so it is the AISJ
    // Admin's, not the workspace's. Then feedback row 11 hid the Sign-up group,
    // four more — "we want to introduce this in the next release". 16 − 1 − 4.
    // Both are deliberate deviations from `AISJ_ICAdmin_V6`, whose own console
    // map still carries all sixteen; see `src/client/routes/admin/sections.ts`.
    expect(sections).toHaveLength(11);

    // Opens on Scoring framework, as the prototype's `.ni on` does.
    await expect(page.getByTestId("admin-section-title")).toHaveText("Scoring framework");

    for (const section of sections) {
      await rail.getByRole("button", { name: section.label, exact: false }).click();
      await expect(page.getByTestId("admin-section-title")).toHaveText(section.label);
      await expect(page).toHaveURL(new RegExp(`/app/admin\\?section=${section.id}$`));
      // Every section renders a body: either its heading (placeholder or the
      // built Team & roles roster) — never a blank pane.
      await expect(page.getByRole("heading", { level: 2, name: section.heading })).toBeVisible();
      // …and an UNBUILT one names the session that will fill it.
      //
      // All three sessions rewrote this; W2-A and W2-C branched on what is on
      // screen, W2-B kept a `BUILT` set each session appends to. Wave 2 integration keeps W2-A's screen-driven branch — it needs
      // no editing as Waves 2–5 land — and folds in W2-B's negative assertion, which
      // is the stronger half: a built section must not still be naming its owner.
      // (The registry cannot be imported here: it pulls the React component tree,
      // and `pdfjs-dist/...?url` is not resolvable outside vite.)
      if (!(await page.getByText("Not built yet").count())) {
        await expect(page.getByText(section.placeholder.owner, { exact: true })).toHaveCount(0);
      } else {
        await expect(
          page.getByText(section.placeholder.owner, { exact: true }).first(),
        ).toBeVisible();
      }
    }

    // Team & roles carries the roster, and `e2e/parity.spec.ts` used to pin this
    // header set at /app/admin; the console opens on Scoring framework now, so
    // the pin lives here (plan_parity.md §4: assert the exact header set).
    //
    // W4-A, flagged per plan §4: the previous set was the flat user-CRUD page's
    // (MEMBER · ROLE · ORGANIZATIONAL TITLE · TYPE · STATUS · ACTION) and three
    // findings say it is wrong — F0182 (the repo's extra Type column; the
    // prototype reads mentor as a role tag), F0066 (the missing plan pill) and
    // F0123 (the missing invite lifecycle). The set is re-captured, not relaxed:
    // it is still an exact equality, and the field is named per edition because
    // the VC prototype calls it Designation on both its add-member rows.
    await rail.getByRole("button", { name: "Team & roles", exact: false }).click();
    await expect(page.getByRole("button", { name: /Invite member/ })).toBeVisible();
    // The roster table only exists once listUsers resolves; the cards below it
    // do not wait, so reading headers straight away races the fetch.
    // Scoped to the roster, and EXACT: the section also renders the
    // task-permission grid, whose column headers are role pills — one of which
    // is "Jury Member", which an unscoped substring match on "MEMBER" also hits.
    const roster = page.getByTestId("member-roster");
    await expect(roster.getByRole("columnheader", { name: "Member", exact: true })).toBeVisible();
    const headers = await roster.locator("thead th").allInnerTexts();
    expect(headers.map((h) => h.replace(/\s+/g, " ").trim())).toEqual([
      "MEMBER",
      "ROLE",
      admin.edition === "vc" ? "DESIGNATION" : "ORGANIZATIONAL TITLE",
      "PLAN",
      "STATUS",
      "ACTIONS",
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

// REWRITTEN for row 11, not renumbered — this pair had no subject left.
//
// The fourth Sign-up section WAS the one place the two editions' consoles
// differ: `suseat` Seat capacity in the incubator, `sufund` Fund Deployment in
// the VC build (AISJ_VC_Superuser_V8 / AISJ_VC_Admin_V4, `secs[11]`). It sat in
// the group row 11 hides, so neither half is in either rail and the two
// editions now draw the SAME eleven sections. The swap itself is not gone, it is
// unshipped: `allAdminSections()` still resolves it per edition, asserted in
// `test/client/adminConsole.test.tsx`. What is worth a browser is that no
// edition leaks the other's half, and that the rails really are identical.
const EDITION_CONSOLES: { edition: Edition; email: string }[] = [
  { edition: "incubator", email: "priya.sharma@demo.startupjury.ai" },
  { edition: "vc", email: "aarav.khanna@demo.startupjury.ai" },
];

for (const each of EDITION_CONSOLES) {
  test(`the ${each.edition} console shows neither half of the edition swap`, async ({ page }) => {
    await login(page, each.email);
    await page.goto("/app/admin");
    const rail = page.getByRole("navigation", { name: "Admin console sections" });
    await expect(rail.getByRole("button", { name: "Scoring framework", exact: false })).toBeVisible();
    for (const label of ["Seat capacity", "Fund Deployment"]) {
      await expect(rail.getByRole("button", { name: label, exact: false })).toHaveCount(0);
    }
    // Count, not an exact label list: the Team & roles entry can carry the
    // pending-invite badge, whose digit lands inside the button's text.
    await expect(rail.getByRole("button")).toHaveCount(adminSections(each.edition).length);
    for (const section of adminSections(each.edition)) {
      await expect(rail.getByRole("button", { name: section.label, exact: false })).toBeVisible();
    }
  });
}

// The console opens for the admin and the superuser, and they are the two
// principals whose rail actually MOVED on 24-Sep — the Sign-up group was
// admin-only, so no other role had it to lose. The absence assertions further
// down run on a page where the console was REFUSED, which proves nothing about
// a rail; this is the one that does.
for (const admin of ADMINS) {
  test(`${admin.edition}/${admin.role} is not offered the hidden Sign-up group`, async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, admin.email);
    await page.goto("/app/admin");
    const rail = page.getByRole("navigation", { name: "Admin console sections" });
    await expect(rail).toBeVisible();

    // The group heading is gone too, not just its sections.
    await expect(rail.getByText("Sign-up", { exact: true })).toHaveCount(0);
    for (const label of [
      "Required documents",
      "Agreements library",
      "Authorised signatories",
      "Seat capacity",
      "Fund Deployment",
    ]) {
      await expect(rail.getByRole("button", { name: label, exact: false })).toHaveCount(0);
    }

    // And a bookmark from before 24-Sep lands on the default section rather than
    // a blank pane — these ids resolved for THIS principal until row 11. Same
    // guard `e2e/price-configuration.spec.ts` keeps over `?section=pc`.
    for (const id of ["sudocs", "suagr", "susign", admin.edition === "vc" ? "sufund" : "suseat"]) {
      await page.goto(`/app/admin?section=${id}`);
      await expect(page.getByTestId("admin-section-title")).toHaveText("Scoring framework");
    }
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
    // console cannot hand it over if reachability ever widens (F0038). That
    // restriction is now redundant — row 11 hides the group from everyone — and
    // is asserted anyway, because it has to still be there when the group
    // returns next release.
    const visible = adminSectionsFor(person.edition, person.role);
    expect(visible.map((s) => s.group)).not.toContain("Sign-up");
    // Eleven, and **row 11 DID NOT MOVE THIS NUMBER.** Read before changing it.
    //
    // It went 12 → 11 on 24-Sep when "Price configuration" left the console,
    // because `pc` was in the Organisation group, which this role DOES see. The
    // Sign-up group is the opposite case: this role never saw it (ADMIN_ONLY_
    // GROUPS), so hiding its four sections takes nothing away from a non-admin.
    // The ADMIN's count fell 15 → 11 and this one stayed put — they are equal
    // now by arithmetic, not by sharing a cause. A single-section removal from
    // any OTHER group would move both.
    expect(visible).toHaveLength(11);
  });
}

test("a deep link to a Sign-up section falls back for a role that cannot see it", async ({
  page,
}) => {
  // The route gate answers first for this role, so the section id never gets a
  // chance to resolve. The admin's version of this — where the id DOES reach
  // `resolveAdminSection` — is in the per-admin walk above.
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
