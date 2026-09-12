import { test, expect, type Page } from "@playwright/test";

/**
 * Admin console → System → **Audit log** (W3-C, `admin/s-al.html`).
 *
 * The journey the prototype depicts, walked end to end: an admin changes
 * something, opens the Audit log, and finds a row that names who did it, what
 * changed and under which badge. That round trip is the whole feature — a log
 * nobody writes to is a table, not a feature — so it is what this spec asserts,
 * rather than the presence of a card.
 *
 * Also pinned here: the trail is **admin-only** (the `adminconsole` task, plan
 * §8 Q16), and the All-decks **Activity card still works**, because it is now a
 * filtered view over the same store rather than a second source of truth.
 *
 * This spec WRITES a cohort threshold and restores it — `e2e/parity.spec.ts`
 * walks the same database.
 */

// The threshold write below is shared state, and the project runs
// `fullyParallel` on two workers, so this file runs serially — the same reason
// `e2e/crm-sync.spec.ts` and `e2e/question-bank.spec.ts` do.
test.describe.configure({ mode: "serial" });

const ADMIN = "nisha.kapoor@demo.startupjury.ai"; // incubator admin
const JURY = "rajesh.kumar@demo.startupjury.ai";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

async function openAuditLog(page: Page) {
  await page.goto("/app/admin?section=al");
  await expect(page.getByTestId("admin-section-title")).toHaveText("Audit log");
  await expect(page.getByRole("heading", { level: 2, name: "Audit log" })).toBeVisible();
  await expect(page.getByTestId("al-row").first()).toBeVisible();
}

test("the section renders the prototype's row: time, actor, sentence, badge", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, ADMIN);
  await openAuditLog(page);

  await expect(page.getByText(/Full timestamped trail of all configuration changes/)).toBeVisible();

  // `0030` seeds the prototype's own ten rows — but this section is now written
  // to on nearly every mutation in the product, so by the time a full suite run
  // reaches here the seed is several pages down. Every assertion below therefore
  // reaches its row through a filter rather than assuming the first page.
  for (const category of ["config", "score", "team", "billing"]) {
    await page.getByTestId(`al-filter-${category}`).click();
    await expect(page.getByTestId(`al-badge-${category}`).first()).toBeVisible();
    await page.getByTestId(`al-filter-${category}`).click();
  }

  // Two of the prototype's sentences, verbatim from its seed.
  const search = page.getByTestId("al-search");
  await search.fill("Shortlist threshold changed from 6.5 to 7.0");
  await expect(page.getByText("Shortlist threshold changed from 6.5 to 7.0")).toBeVisible();
  await search.fill("Purchased 50-credit pack");
  await expect(page.getByText(/Purchased 50-credit pack · ₹20,000 · Transaction ID:/)).toBeVisible();
  await search.fill("");
  await expect(page.getByTestId("al-row").first()).toBeVisible();

  const first = page.getByTestId("al-row").first();
  // The `.log-t` column: a clock time, "Yesterday", or a date — never an ISO
  // timestamp and never "Invalid Date".
  await expect(first).toContainText(/(\d{1,2}:\d{2} (am|pm)|Yesterday|\d{1,2} [A-Z][a-z]{2})/);
  // The `.log-u` column: the prototype's "Nisha K." abbreviation.
  await expect(page.getByText("Nisha K.").first()).toBeVisible();
});

test("a config change made in the console appears in the trail", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, ADMIN);

  // The All-decks rail owns the cohort rating thresholds. Read what they are
  // first — `e2e/config.spec.ts` writes them too, so neither the before value
  // nor the restore value can be a literal here.
  const summary = await page.request.get("/api/config/summary");
  const { thresholdBest, thresholdMediocre } = (await summary.json()) as {
    thresholdBest: number;
    thresholdMediocre: number;
  };

  const res = await page.request.put("/api/config/thresholds", {
    data: { best: 7.4, mediocre: 5.2 },
  });
  expect(res.ok()).toBeTruthy();

  try {
    await openAuditLog(page);
    // Found by search rather than by position: other specs share this database
    // and a newer row can land between the write and the read.
    await page.getByTestId("al-search").fill("Cohort rating thresholds changed");
    const row = page.getByTestId("al-row").first();
    await expect(row).toContainText("Cohort rating thresholds changed");
    // Both new values, and the arrow that says a value moved — the prototype's
    // own before → after shape.
    await expect(row).toContainText("→ 7.4");
    await expect(row).toContainText("→ 5.2");
    await expect(row).toContainText("Nisha K.");
    await expect(row.getByTestId("al-badge-config")).toBeVisible();
  } finally {
    await page.request.put("/api/config/thresholds", {
      data: { best: thresholdBest, mediocre: thresholdMediocre },
    });
  }
});

test("the category badges filter the trail, and All puts it back", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, ADMIN);
  await openAuditLog(page);

  const rows = page.getByTestId("al-row");
  const before = await rows.count();

  await page.getByTestId("al-filter-billing").click();
  await expect(page.getByTestId("al-badge-billing").first()).toBeVisible();
  // The property, not a row count: nothing but Billing survives the filter.
  await expect(page.getByTestId("al-badge-config")).toHaveCount(0);
  await expect(page.getByTestId("al-badge-team")).toHaveCount(0);

  await page.getByTestId("al-filter-all").click();
  await expect(page.getByTestId("al-badge-config").first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThanOrEqual(before);
});

test("the trail is admin-only — a jury member reaches neither screen nor API", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, JURY);

  const res = await page.request.get("/api/audit");
  expect(res.status()).toBe(403);

  // And the console itself is closed to them, so there is no section to open.
  await page.goto("/app/admin?section=al");
  await expect(page.getByRole("heading", { level: 2, name: "Audit log" })).toHaveCount(0);
});

test("the All-decks Activity card still renders — one store, two views", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, ADMIN);
  // The All-decks screen; its nav id is `alldecks` (src/shared/nav.ts).
  await page.goto("/app/alldecks");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // Two asides on this screen — the nav rail and the dashboard's right rail.
  const rail = page.locator("aside").filter({ hasText: "Activity log" });
  await expect(rail.getByText("Activity log", { exact: true })).toBeVisible();
  // The rail's sentence shape is unchanged: "<actor> (<title>) moved <deck> to
  // <stage>". It now comes from `listAudit()`, filtered to `pipeline`.
  await expect(rail).toContainText(/moved .+ to /);
});
