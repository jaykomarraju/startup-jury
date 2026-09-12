import { test, expect, type Page } from "@playwright/test";

/**
 * Admin console → Sign-up → **Agreements library** and **Authorised
 * signatories** (W5-B, `admin/s-suagr.html` · `admin/s-susign.html`).
 *
 * The journey the prototype depicts, walked end to end: an admin sees the
 * template library with its lifecycle badges, adds a template, uploads its
 * source file, marks a merge field, maps it to a stage and a programme, and
 * finds all of it still there after a reload. Then grants a signatory and sees
 * it appear in the sign-up countersign picker.
 *
 * This spec WRITES agreement templates and signatory grants, so it runs
 * serially and restores what it found — `e2e/parity.spec.ts` walks the same
 * database. `e2e/crm-sync.spec.ts` and `e2e/branding.spec.ts` are the shape.
 */

test.describe.configure({ mode: "serial" });

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

/**
 * `NAV` is the budget for "the SPA has finished navigating", not for an
 * assertion about behaviour — §8 Q28: a box running several worktrees' suites
 * at once blows Playwright's 5 s default on `page.goto` alone, and that reads
 * as a broken screen. Semantic assertions below keep the default so a real
 * failure still fails fast.
 */
const NAV = { timeout: 30_000 };

async function openSection(page: Page, section: string, title: string) {
  await page.goto(`/app/admin?section=${section}`);
  await expect(page.getByTestId("admin-section-title")).toHaveText(title, NAV);
  await expect(page.getByRole("heading", { level: 2, name: title })).toBeVisible(NAV);
}

async function openLibrary(page: Page) {
  await login(page, "nisha.kapoor@demo.startupjury.ai"); // incubator admin
  await openSection(page, "suagr", "Agreements library");
}

/** The list row for one template. */
function row(page: Page, name: string) {
  return page.locator("li").filter({ hasText: name }).first();
}

test("the seeded library renders with its lifecycle badges and summary lines", async ({ page }) => {
  test.setTimeout(120_000);
  await openLibrary(page);

  await expect(page.getByText(/Retired templates stay for audit/)).toBeVisible();

  const incub = row(page, "Incubation Agreement");
  await expect(incub.getByText("Active")).toBeVisible();
  await expect(incub).toContainText(
    "incubation-agreement-v3.docx · v3 · 5 merge fields · Fintech Accelerator",
  );

  // An unmapped draft says so.
  await expect(row(page, "Mentorship MOU").getByText("Draft")).toBeVisible();
  await expect(row(page, "Mentorship MOU")).toContainText("2 merge fields · unmapped");

  // Retired offers Restore, not Retire.
  const nda = row(page, "Mutual NDA");
  await expect(nda.getByText("Retired")).toBeVisible();
  await expect(nda.getByRole("button", { name: "Restore" })).toBeVisible();
  await expect(nda.getByRole("button", { name: "Retire" })).toHaveCount(0);
});

test("an admin uploads a template, maps it to a stage and a programme, and it survives a reload", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await openLibrary(page);

  // ── Add ────────────────────────────────────────────────────────────────────
  await page.getByRole("button", { name: "Add template" }).click();
  await expect(page.getByText("Editing: New agreement")).toBeVisible(NAV);
  await expect(page.getByText("Draft template created")).toBeVisible(NAV);

  await page.getByLabel("Template name").fill("E2E Incubation Addendum");

  // ── Upload the source file ─────────────────────────────────────────────────
  await expect(page.getByText(/No source file uploaded yet/)).toBeVisible();
  await page.getByLabel("Template source file").setInputFiles({
    name: "e2e-addendum-v1.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 e2e addendum {{startup}}"),
  });
  await expect(page.getByText("Source file uploaded: e2e-addendum-v1.pdf")).toBeVisible(NAV);
  await expect(page.getByText("Uploaded source · v1")).toBeVisible();

  // ── Merge fields, stage and programme ──────────────────────────────────────
  await page.getByLabel("Field key 1").fill("startup");
  await page.getByLabel("Field label 1").fill("Startup legal name");
  await page.getByLabel("Sample value 1").fill("LedgerLite Pvt Ltd");
  await page.getByRole("button", { name: "Add field" }).click();
  await page.getByLabel("Field key 2").fill("addendum_date");
  await page.getByLabel("Field label 2").fill("Addendum date");

  await page.getByLabel("Stage").selectOption("post_signup");
  await page.getByRole("switch", { name: "SaaS Accelerator" }).click();
  await page.getByLabel("Status").selectOption("active");

  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText('Template "E2E Incubation Addendum" saved.')).toBeVisible(NAV);

  // ── The mapping survives a reload ──────────────────────────────────────────
  await page.reload();
  await expect(page.getByTestId("admin-section-title")).toHaveText("Agreements library", NAV);
  const created = row(page, "E2E Incubation Addendum");
  await expect(created).toContainText(
    "e2e-addendum-v1.pdf · v1 · 2 merge fields · SaaS Accelerator",
  );
  await expect(created.getByText("Active")).toBeVisible();

  await created.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByLabel("Stage")).toHaveValue("post_signup");
  await expect(page.getByLabel("Field key 2")).toHaveValue("addendum_date");
  await expect(page.getByRole("switch", { name: "SaaS Accelerator" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(page.getByRole("switch", { name: "Climate Cohort" })).toHaveAttribute(
    "aria-checked",
    "false",
  );

  // ── New version drops it back to Draft ─────────────────────────────────────
  await created.getByRole("button", { name: "New version" }).click();
  await expect(page.getByText(/New draft version created/)).toBeVisible();
  await expect(row(page, "E2E Incubation Addendum")).toContainText("v2");
  await expect(row(page, "E2E Incubation Addendum").getByText("Draft")).toBeVisible();

  // ── Restore: delete the draft this spec created ────────────────────────────
  // It is a draft that raised no agreement, which is the only thing delete
  // accepts — so the library is left exactly as it was found.
  await row(page, "E2E Incubation Addendum")
    .getByRole("button", { name: "Delete E2E Incubation Addendum" })
    .click();
  await expect(page.getByText(/Unused draft "E2E Incubation Addendum" deleted/)).toBeVisible(NAV);
  // Scoped to the LIST: the success note names the template too, so a
  // page-wide count can never reach zero while that note is on screen.
  await expect(row(page, "E2E Incubation Addendum")).toHaveCount(0);
});

test("the merge-field editor refuses a duplicate key before it reaches the server", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openLibrary(page);
  await row(page, "Incubation Agreement").getByRole("button", { name: "Edit" }).click();
  await expect(page.getByLabel("Field key 1")).toHaveValue("startup");

  // Point the second field at the first field's key.
  await page.getByLabel("Field key 2").fill("startup");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("alert")).toContainText("used by two merge fields");

  // Nothing was written: a reload still shows the seeded five fields.
  await page.reload();
  await expect(page.getByTestId("admin-section-title")).toHaveText("Agreements library", NAV);
  await row(page, "Incubation Agreement").getByRole("button", { name: "Edit" }).click();
  await expect(page.getByLabel("Field key 2")).toHaveValue("founder");
  await expect(row(page, "Incubation Agreement")).toContainText("5 merge fields");
});

test("a granted signatory appears in the sign-up countersign picker", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "nisha.kapoor@demo.startupjury.ai");
  await openSection(page, "susign", "Authorised signatories");

  await expect(page.getByText(/Only those enabled here appear in the sign-up countersign picker/)).toBeVisible();

  const picker = page
    .locator("div.rounded-xl")
    .filter({ hasText: "The sign-up countersign picker" })
    .first();

  // Seeded: Super User and Program Manager on, Jury Member off.
  await expect(page.getByRole("switch", { name: "Super User" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(page.getByRole("switch", { name: "Jury Member" })).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await expect(picker.getByText("Super User (any)")).toBeVisible();
  await expect(picker.getByText("Jury Member (any)")).toHaveCount(0);

  // Grant it, and the picker gains it.
  await page.getByRole("switch", { name: "Jury Member" }).click();
  await expect(picker.getByText("Jury Member (any)")).toBeVisible();
  await expect(page.getByText(/the workspace still reads the saved set/)).toBeVisible();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Authorised signatories saved.")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("switch", { name: "Jury Member" })).toHaveAttribute(
    "aria-checked",
    "true",
    NAV,
  );

  // Restore — parity.spec.ts walks this same database.
  await page.getByRole("switch", { name: "Jury Member" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Authorised signatories saved.")).toBeVisible();
  await expect(page.getByRole("switch", { name: "Jury Member" })).toHaveAttribute(
    "aria-checked",
    "false",
  );
});

test("a named individual can be granted from the roster behind Add individual", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "nisha.kapoor@demo.startupjury.ai");
  await openSection(page, "susign", "Authorised signatories");

  // Granted individuals are listed; the rest are behind the button.
  await expect(page.getByRole("switch", { name: "Priya Sharma" })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Sunita Rao" })).toHaveCount(0);
  await page.getByRole("button", { name: "Add individual" }).click();
  await expect(page.getByRole("switch", { name: "Sunita Rao" })).toHaveAttribute(
    "aria-checked",
    "false",
  );
  // No write — the list is revealed, not changed.
  await expect(page.getByRole("button", { name: "Show granted only" })).toBeVisible();
});

test("a non-admin is refused both halves of the esign API", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "sunita.rao@demo.startupjury.ai"); // program_associate
  expect((await page.request.get("/api/esign/templates")).status()).toBe(403);
  expect((await page.request.get("/api/esign/signatories")).status()).toBe(403);
  // But the sign-up workspace's own routes ARE theirs — they run sign-up.
  expect(
    (await page.request.get("/api/esign/signups/su_inc_deck_meera_signup/method")).status(),
  ).toBe(200);
});

test("a jury member reaches neither the console sections nor the sign-up workspace", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await login(page, "rajesh.kumar@demo.startupjury.ai"); // jury
  expect((await page.request.get("/api/esign/templates")).status()).toBe(403);
  expect(
    (await page.request.get("/api/esign/signups/su_inc_deck_meera_signup/method")).status(),
  ).toBe(403);
});
