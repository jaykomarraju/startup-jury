import { test, expect, type Page } from "@playwright/test";

/**
 * Admin console → System → **Branding** (W4-B, `admin/s-br.html`).
 *
 * The journey the prototype depicts, and the defect plan §1.5 names: branding
 * has round-tripped through the API since Phase 6 and was then thrown away.
 * So the assertions here are not "the field kept its value" — they are that the
 * **top bar** shows the new wordmark, that the **computed** `--gold` on `<html>`
 * is the colour that was picked, and that both survive a full reload.
 *
 * This spec brands the **VC** workspace, not the incubator one. Branding is per
 * edition, `e2e/parity.spec.ts` walks the same database, and the incubator
 * wordmark is the one other specs read. It restores the defaults at the end
 * regardless — and runs serially, since every test writes the same row.
 */

test.describe.configure({ mode: "serial" });

const VC_ADMIN = "nisha.kapoor.vc@demo.startupjury.ai";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

async function openBranding(page: Page) {
  await page.goto("/app/admin?section=br");
  await expect(page.getByTestId("admin-section-title")).toHaveText("Branding");
  await expect(page.getByRole("heading", { level: 2, name: "Branding & theme" })).toBeVisible();
  // The section adopts the server's value a tick after the first paint.
  await expect(page.getByLabel("Wordmark — part 2")).toBeEnabled();
}

async function saveChanges(page: Page) {
  const save = page.getByRole("button", { name: "Save changes" });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(save).toBeDisabled(); // back to clean
}

/** What `<html>` actually resolves the token to — not what was stored. */
function computedToken(page: Page, token: string) {
  return page.evaluate(
    (t) => getComputedStyle(document.documentElement).getPropertyValue(t).trim(),
    token,
  );
}

test.afterAll(async ({ browser }) => {
  // Leave the workspace as it was found, whatever happened above — including
  // when the last test already restored it, in which case Save stays disabled
  // and there is nothing to do.
  const page = await browser.newPage();
  await login(page, VC_ADMIN);
  await openBranding(page);
  await page.getByRole("button", { name: "Reset to defaults" }).click();
  const save = page.getByRole("button", { name: "Save changes" });
  if (await save.isEnabled()) await saveChanges(page);
  await page.close();
});

test("the section renders all fourteen tokens, both wordmark halves and the preview", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await login(page, VC_ADMIN);
  await openBranding(page);

  await expect(page.getByLabel("Wordmark — part 1")).toHaveValue("ai");
  await expect(page.getByLabel("Wordmark — part 2")).toHaveValue("STARTUPJURY");
  await expect(page.getByLabel("Tagline")).toHaveValue("Venture Intelligence First");
  await expect(page.getByLabel("Logo image URL (optional)")).toHaveValue("");
  await expect(page.getByTestId("br-preview")).toBeVisible();

  for (const token of [
    "--olive",
    "--olive-lt",
    "--gold",
    "--gold-dk",
    "--gold-lt",
    "--navy",
    "--text-3",
    "--bg",
    "--stone",
    "--stone-dk",
    "--green",
    "--red",
    "--blue",
    "--purple",
  ]) {
    await expect(page.getByText(token, { exact: true })).toBeVisible();
  }
});

test("a branded wordmark and accent survive a reload and reach the top bar", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, VC_ADMIN);
  await openBranding(page);

  await page.getByLabel("Wordmark — part 1").fill("the");
  await page.getByLabel("Wordmark — part 2").fill("T-HUB JURY");
  await page.getByLabel("Tagline").fill("Backed by data");
  await page.getByLabel("Accent hex").fill("#C2185B");
  await page.getByLabel("Accent hex").blur();

  // Applied live, before any save — the prototype's "instantly".
  expect(await computedToken(page, "--gold")).toBe("#C2185B");

  await saveChanges(page);

  // A full reload: the applier has to read it back from the server.
  await page.goto("/app");
  await expect(page.getByLabel("the.T-HUB JURY")).toBeVisible();
  await expect(page.getByTestId("brand-wordmark-prefix")).toHaveText("the");
  await expect(page.getByTestId("brand-wordmark-name")).toHaveText("T-HUB JURY");
  await expect(page.getByTestId("brand-tagline")).toHaveText("Backed by data");
  expect(await computedToken(page, "--gold")).toBe("#C2185B");
});

test("reset to defaults puts the shipped literal back, and it survives a reload", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await login(page, VC_ADMIN);
  await openBranding(page);
  await expect(page.getByLabel("Wordmark — part 2")).toHaveValue("T-HUB JURY");

  await page.getByRole("button", { name: "Reset to defaults" }).click();
  await saveChanges(page);

  await page.goto("/app");
  await expect(page.getByLabel("ai.STARTUPJURY")).toBeVisible();
  // The override is REMOVED, not overwritten with a second hardcoded hex — so
  // what comes back is `index.css`'s own `--gold`, whatever that is today.
  expect((await computedToken(page, "--gold")).toLowerCase()).toBe("#e8a020");
});

test("branding is admin-only, and a non-admin still sees the workspace's mark", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "rhea.nair@demo.startupjury.ai"); // VC analyst
  await page.goto("/app/admin?section=br");
  await expect(page.getByRole("heading", { level: 2, name: "Branding & theme" })).toHaveCount(0);
  await expect(page.getByLabel("ai.STARTUPJURY")).toBeVisible();
});
