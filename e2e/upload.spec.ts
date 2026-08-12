import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { enforceWorkerCsp, watchCspViolations } from "./csp-enforce";

// Phase 3 UI acceptance: an uploaded PDF flows R2 → a deck row that appears in
// All decks. Without ANTHROPIC_API_KEY the single-upload evaluation defers, so
// the deck lands at "Pending AI" — which is exactly what we assert here.
//
// The file is the REAL sample deck, not a stub buffer, because this spec is
// also the only place the in-app pitch-deck viewer renders actual slides: the
// R2 object is written before the AI call, so a Pending-AI deck still has a
// readable PDF behind it. That makes this the browser-level proof of the CSP's
// two load-bearing directives — `img-src data:` (pdf.js renders each page to a
// canvas and stores it as a data: URL) and `worker-src blob:` — which the
// header assertions in csp.spec.ts cannot demonstrate on their own.

const SAMPLE_DECK = fileURLToPath(
  new URL("../docs/demo-assets/gridbloom-sample-deck.pdf", import.meta.url),
);

async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.getByPlaceholder("••••••••").fill("demo1234");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/app/);
}

test("upload a pitch deck, see it in All decks, and view its slides", async ({ page, request }) => {
  const violations = watchCspViolations(page);
  await enforceWorkerCsp(page, request);

  await login(page, "sunita.rao@demo.startupjury.ai"); // incubator program associate
  await page.goto("/app/upload");

  const name = `E2E Deck ${Date.now()}`;
  await page.getByPlaceholder("e.g. GreenGrid").fill(name);
  await page.locator('input[type="file"]').setInputFiles(SAMPLE_DECK);
  await page.getByRole("button", { name: /upload & evaluate/i }).click();

  // Deferred-evaluation confirmation, then jump to the decks table. Session 7
  // replaced the old blanket "no AI key configured yet" copy with the real
  // cause plus whether anything will retry (§9).
  await expect(page.getByText(/AI evaluation is queued and will retry/i)).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(/AI key missing or rejected/i)).toBeVisible();
  await page.getByRole("button", { name: /view all decks/i }).click();
  await page.waitForURL(/\/app\/alldecks/);

  const row = page.getByRole("row", { name: new RegExp(name) });
  await expect(row).toBeVisible();
  await expect(row.getByText("Pending AI")).toBeVisible();

  // The report drawer renders DeckPdfViewer against the R2 object just stored.
  await row.click();
  await expect(page.getByText("Pitch deck")).toBeVisible();
  const strip = page.getByLabel("Deck slides");
  await expect(strip).toBeVisible({ timeout: 20_000 });

  // pdf.js got its worker AND the rendered page survived img-src. A blocked
  // data: URL leaves the <img> in the DOM but with no intrinsic width, so
  // assert the browser actually decoded it rather than merely that it exists.
  // `exact` matters: the sample deck has 14 slides, so "Slide 1" would also
  // match "Slide 10".."Slide 14".
  const slide = strip.getByRole("img", { name: "Slide 1", exact: true });
  await expect(slide).toBeVisible();
  await expect
    .poll(() => slide.evaluate((el) => (el as unknown as { naturalWidth: number }).naturalWidth), {
      timeout: 10_000,
    })
    .toBeGreaterThan(0);
  expect(await slide.getAttribute("src")).toMatch(/^data:image\/png/);

  expect(violations, `CSP violations:\n${violations.join("\n")}`).toEqual([]);
});
