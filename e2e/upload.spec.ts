import { test, expect, type Page } from "@playwright/test";
import { deflateRawSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { enforceWorkerCsp, watchCspViolations } from "./csp-enforce";

// W7-B — Upload: the wizard → "Review uploaded decks" → "Uploaded decks —
// AI-extracted details", walked the way the prototype draws it.
//
// Without ANTHROPIC_API_KEY the evaluation defers, so an uploaded deck stays at
// "Pending AI" — which is what the drawer half of the first test asserts.
//
// The file is the REAL sample deck, not a stub buffer, because this spec is
// also the only place the in-app pitch-deck viewer renders actual slides: the
// R2 object is written before the AI call, so a Pending-AI deck still has a
// readable PDF behind it. That makes this the browser-level proof of the CSP's
// two load-bearing directives — `img-src data:` (pdf.js renders each page to a
// canvas and stores it as a data: URL) and `worker-src blob:` — which the
// header assertions in csp.spec.ts cannot demonstrate on their own.
//
// Nothing here asserts a credit balance: other specs top it up and spend it.

const SAMPLE_DECK = fileURLToPath(new URL("../docs/demo-assets/gridbloom-sample-deck.pdf", import.meta.url));
const NOT_AVAILABLE = "Not available for your role";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.getByPlaceholder("••••••••").fill("demo1234");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/app/);
}

/** Every in-app link the screen body offers (the sidebar is `nav.spec`'s). */
async function bodyLinks(page: Page): Promise<string[]> {
  return page.locator("main a[href^='/app/']").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
}

test("a PA uploads a deck, reviews it, sends it to Query — and is never shown a control they cannot use", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const violations = watchCspViolations(page);
  await enforceWorkerCsp(page, request);

  await login(page, "sunita.rao@demo.startupjury.ai"); // incubator program associate
  await page.goto("/app/upload");
  await expect(page.getByRole("heading", { name: "Upload your first pitchdecks" })).toBeVisible();
  const bar = page.getByTestId("up-credits-bar");
  await expect(bar.getByText(/^Credits balance — \d+ remaining$/)).toBeVisible();
  // F0226 — a PA sees the balance and neither button (both need billing rights).
  await expect(bar.getByRole("link")).toHaveCount(0);
  await expect(page.getByText("Buy credits")).toHaveCount(0);
  const links = new Set(await bodyLinks(page));

  // 1 · the wizard stages the deck; nothing is stored yet.
  const name = `E2E Deck ${Date.now()}`;
  await page.getByLabel("Choose a pitch deck").setInputFiles(SAMPLE_DECK);
  await page.getByLabel("Startup name").fill(name);
  await expect(page.getByTestId("up-cost-bar")).toHaveText(/Cost for this deck\s*1 credit/);
  await page.getByRole("button", { name: "Go to dashboard →" }).click();

  // 2 · Review uploaded decks — tick, see the cost in credits, approve.
  await expect(page.getByRole("heading", { name: "Review uploaded decks" })).toBeVisible();
  const row = page.getByTestId("up-deck-row").filter({ hasText: name });
  await expect(row.getByText("14 slides")).toBeVisible({ timeout: 20_000 });
  for (const href of await bodyLinks(page)) links.add(href);
  await row.getByRole("checkbox", { name: `Select ${name}` }).check();
  await expect(page.getByTestId("up-cost-preview")).toContainText("Cost 1 credit");
  await expect(page.locator("body")).not.toContainText("₹");
  await page.getByRole("button", { name: "Upload selected decks" }).click();

  // The prototype returns to the wizard and reveals "View uploaded details".
  await expect(page.getByRole("button", { name: "View uploaded details →" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "View uploaded details →" }).click();

  // 3 · the AI-extracted details table, exact header set.
  await expect(page.getByRole("heading", { name: "Uploaded decks — AI-extracted details" })).toBeVisible();
  const table = page.getByTestId("up-results").locator("table");
  expect(await table.locator("thead th").allTextContents()).toEqual([
    "Deck",
    "Founder name",
    "Email ID",
    "Phone number",
    "City",
    "Sector",
    "Status",
  ]);
  await expect(table.getByRole("row", { name: new RegExp(name) })).toContainText("Awaiting AI");

  // 4 · back to review: flag a parameter and send the founder query.
  await page.getByRole("button", { name: "← Back to review" }).click();
  await row.click();
  await expect(page.getByText(/AI evaluation is queued and will retry/i)).toBeVisible();
  await expect(page.getByText(/AI key missing or rejected/i)).toBeVisible();
  await row.getByRole("button", { name: "Mark incomplete" }).click();
  const panel = page.getByTestId("up-flag-panel");
  await expect(panel.getByText("Parameters needing response")).toBeVisible();
  await panel.getByRole("checkbox", { name: "Flag Traction & Validation" }).check();
  await panel.getByRole("group", { name: "Traction & Validation signal" }).getByRole("button", { name: "Absent" }).click();
  await panel.getByRole("button", { name: "Send to Query" }).click();
  await expect(panel.getByText("✓ Sent to Query")).toBeVisible();
  for (const href of await bodyLinks(page)) links.add(href);

  // The query really exists, and says what was flagged.
  const deckId = await page.evaluate(async (deckName) => {
    const r = await fetch("/api/decks");
    const { decks } = (await r.json()) as { decks: { id: string; name: string }[] };
    return decks.find((d) => d.name === deckName)?.id ?? null;
  }, name);
  expect(deckId).not.toBeNull();
  const queries = await page.evaluate(
    async (id) => (await (await fetch(`/api/decks/${id}/queries`)).json()) as { queries: { questions: string }[] },
    deckId,
  );
  expect(queries.queries).toHaveLength(1);
  expect(queries.queries[0].questions).toContain("• Traction & Validation (absent)");

  await panel.getByRole("link", { name: "View in Query →" }).click();
  await page.waitForURL(/\/app\/query$/);
  await expect(page.getByText(NOT_AVAILABLE)).toHaveCount(0);

  // Every link the Upload screens offered this PA leads somewhere they may go.
  for (const href of links) {
    await page.goto(href);
    await expect(page.locator("h1").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(NOT_AVAILABLE), `${href} is not available to a PA`).toHaveCount(0);
  }

  // 5 · the deck is in All decks, Pending AI, with readable slides.
  await page.goto("/app/alldecks");
  const deckRow = page.getByRole("row", { name: new RegExp(name) });
  await expect(deckRow).toBeVisible();
  await expect(deckRow.getByText("Pending AI")).toBeVisible();

  // The report drawer renders DeckPdfViewer against the R2 object just stored.
  await deckRow.click();
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

test("an admin's Buy credits lands on Choose your plan", async ({ page }) => {
  await login(page, "nisha.kapoor@demo.startupjury.ai"); // incubator admin
  await page.goto("/app/upload");
  const buy = page.getByTestId("up-credits-bar").getByRole("link", { name: "Buy credits" });
  await expect(buy).toBeVisible();
  await buy.click();
  await page.waitForURL(/\/app\/billing/);
  await expect(page.getByRole("heading", { name: "Choose your plan" })).toBeVisible({ timeout: 30_000 });
});

/** A ZIP with two deflated copies of the sample deck and one file that is not a deck. */
function sampleZip(): Buffer {
  const pdf = readFileSync(SAMPLE_DECK);
  const entries = [
    { name: "batch/FinStack.pdf", data: pdf },
    { name: "batch/WealthOS.pdf", data: pdf },
    { name: "batch/readme.txt", data: Buffer.from("not a deck") },
  ];
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const body = deflateRawSync(e.data);
    const name = Buffer.from(e.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

test("a ZIP of decks is expanded in the browser into the review list, costed in credits, and nothing is uploaded", async ({
  page,
}) => {
  await login(page, "sunita.rao@demo.startupjury.ai");
  await page.goto("/app/upload");
  await page.getByRole("radio", { name: /Bulk upload/ }).click();
  await page
    .getByLabel("Choose a ZIP or several pitch decks")
    .setInputFiles({ name: "batch.zip", mimeType: "application/zip", buffer: sampleZip() });
  await expect(page.getByText("2 decks ready to review")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("up-bulk-notes")).toContainText("1 file(s) that are not PDFs were left out");
  await expect(page.getByTestId("up-cost-bar")).toHaveText(/Cost for this batch\s*2 credits/);

  const uploads: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/api/decks/")) uploads.push(r.url());
  });
  await page.getByRole("button", { name: "Go to dashboard →" }).click();
  await expect(page.getByText("2 decks staged")).toBeVisible();
  await expect(page.getByTestId("up-deck-row")).toHaveCount(2);
  await expect(page.getByTestId("up-deck-row").first()).toContainText("14 slides", { timeout: 20_000 });
  await page.getByRole("checkbox", { name: "Select all" }).check();
  await expect(page.getByTestId("up-cost-preview")).toContainText("Cost 2 credits");
  expect(uploads).toEqual([]);
});
