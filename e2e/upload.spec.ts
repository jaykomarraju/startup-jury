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
//
// R2-UPEVAL — the walkthrough's principal, the incubator program associate, is
// now one of V3-UP's roles (plan_roles_incubator §2 row `11 · V3-UP`), so the
// wizard's forward button reads "Evaluate & Go to Dashboard →" for them and the
// results card offers "Send to Evaluate". Both are asserted in place rather than
// in a separate test, because the point is that the FLOW did not change with the
// label: the same walk still reaches review, upload, the results table and Query.
// The admin's own V3 label and the program manager's unchanged one are pinned in
// test/client/upload.test.tsx; here the browser proves the PA's new link is not a
// 403, via the "every link leads somewhere they may go" sweep.

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

test("a PA uploads a deck, reviews it, reaches Query — and is never shown a control they cannot use", async ({
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
  // R2-UPEVAL: V3-UP reached the program associate, so the forward button reads
  // "Evaluate & Go to Dashboard →" for them now. The flow behind it is unchanged
  // — this test proves that by walking the same steps under the new label.
  await page.getByRole("button", { name: "Evaluate & Go to Dashboard →" }).click();

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

  // V3-UP's other half for this role: `Send to Evaluate` on the results card.
  // Collect the card's links INTO the sweep below — that is what turns "the link
  // is drawn" into "the link leads somewhere a PA may actually go".
  await expect(page.getByRole("link", { name: "Send to Evaluate →" })).toBeVisible();
  for (const href of await bodyLinks(page)) links.add(href);
  expect([...links]).toContain("/app/evaluate");

  // 4 · back to review — and the browser-level proof of feedback row 2.
  //
  // S2-UPLOAD deleted the per-row "Mark incomplete" button ("not required since
  // we have automated this part"). This walk used to CLICK it to open
  // "Parameters needing response", and that is the only reason the panel opened
  // here: `isFlaggable` now fires solely for a deck the AI itself landed at
  // `incomplete`, and this dev server has no ANTHROPIC_API_KEY, so no deck of
  // this spec's ever leaves `pending_ai`. The panel is therefore UNREACHABLE in
  // this environment by design, not by regression — asserted below so a future
  // session does not read its absence as a bug.
  //
  // The flag → Send to Query → real query seam moved to
  // test/client/upload.test.tsx ("raises the founder query end to end"), which
  // can hand the screen an AI verdict that this server cannot produce;
  // `POST /api/decks/:id/queries` itself is covered in test/worker/pipeline.test.ts
  // (both the incubator and the VC arm) and the letter's wording in
  // test/unit/uploadReview.test.ts. What only a browser can still prove — that
  // /app/query is a screen this PA may actually open — is kept, by walking
  // there directly instead of through the panel's "View in Query →".
  await page.getByRole("button", { name: "← Back to review" }).click();
  await row.click();
  await expect(page.getByText(/AI evaluation is queued and will retry/i)).toBeVisible();
  await expect(page.getByText(/AI key missing or rejected/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /Mark incomplete/i })).toHaveCount(0);
  await expect(page.getByTestId("up-flag-panel")).toHaveCount(0);
  for (const href of await bodyLinks(page)) links.add(href);

  await page.goto("/app/query");
  await expect(page.locator("h1").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(NOT_AVAILABLE)).toHaveCount(0);
  links.add("/app/query");

  // Every link the Upload screens offered this PA leads somewhere they may go.
  for (const href of links) {
    await page.goto(href);
    await expect(page.locator("h1").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(NOT_AVAILABLE), `${href} is not available to a PA`).toHaveCount(0);
  }

  // 5 · the deck is on the Dashboard, not yet AI-evaluated, with readable slides.
  //
  // Wave R (R1-DASH) widened the V3 Dashboard to the program associate, so this
  // walk reads the Dashboard's status VOCABULARY rather than the pre-V3 screen's
  // "Pending AI". Asserting a word that is not in the vocabulary did not just
  // fail — it resolved to the Actions menu's own disabled `<option>`, which is
  // `hidden` inside a closed select, so the failure read as a visibility bug
  // rather than a vocabulary change. Target the status cell by its testid so the
  // row's other text can never stand in for it.
  //
  // S2-DASH (2026-09-30) replaces the vocabulary with the client's 24-Sep
  // thirteen statuses. "Not AI Evaluated" is the word his row 6 DELETES, and C3
  // is the answer: it is a populated stat box as well as a word, so the box stays
  // and its rows read "Awaiting AI evaluation" (`SCREENING_STATUS_LABELS`).
  await page.goto("/app/alldecks");
  const deckRow = page.getByRole("row", { name: new RegExp(name) });
  await expect(deckRow).toBeVisible();
  await expect(deckRow.getByTestId("v3-status")).toHaveText("Awaiting AI evaluation");

  // The report drawer renders DeckPdfViewer against the R2 object just stored.
  // W7-A (F0325): the startup NAME is the report link, not the whole row.
  // Wave 7 integration: W7-A wrote this against its own `row`; W7-B rewrote the
  // same test around `deckRow`. Both intents kept — W7-B's structure, W7-A's
  // target.
  await deckRow.getByRole("button", { name }).click();
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

test("an admin's Buy credits lands on the seat screen", async ({ page }) => {
  await login(page, "nisha.kapoor@demo.startupjury.ai"); // incubator admin
  await page.goto("/app/upload");
  const buy = page.getByTestId("up-credits-bar").getByRole("link", { name: "Buy credits" });
  await expect(buy).toBeVisible();
  await buy.click();
  await page.waitForURL(/\/app\/billing/);
  await expect(page.getByRole("heading", { name: "Choose your seat" })).toBeVisible({ timeout: 30_000 });
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
  await page.getByRole("button", { name: "Evaluate & Go to Dashboard →" }).click(); // V3-UP label
  await expect(page.getByText("2 decks staged")).toBeVisible();
  await expect(page.getByTestId("up-deck-row")).toHaveCount(2);
  await expect(page.getByTestId("up-deck-row").first()).toContainText("14 slides", { timeout: 20_000 });
  await page.getByRole("checkbox", { name: "Select all" }).check();
  await expect(page.getByTestId("up-cost-preview")).toContainText("Cost 2 credits");
  expect(uploads).toEqual([]);
});

// V4-SIZE — the client's 2026-09-20 answer: "For now, let's set it to 50MB."
//
// The assertion is deliberately a SWEEP rather than one locator. The size the
// user reads lived in four places and two of them were literal strings that had
// already drifted from the limit the server enforces; a test that checks one
// hint cannot see that. So: find every size this screen states, in both upload
// modes, and require all of them to be 50 MB.
test("the upload screen states 50 MB wherever it states a size, in both modes", async ({ page }) => {
  await login(page, "sunita.rao@demo.startupjury.ai");
  await page.goto("/app/upload");
  await expect(page.getByRole("heading", { name: "Upload your first pitchdecks" })).toBeVisible();

  const sizesOnScreen = async (): Promise<string[]> => {
    const text = (await page.locator("main").innerText()) || "";
    return [...text.matchAll(/(\d+(?:\.\d+)?)\s*MB/g)].map((m) => m[0].replace(/\s+/g, " "));
  };

  const single = await sizesOnScreen();
  expect(single.length).toBeGreaterThan(0); // the single-upload dropzone hint
  expect(new Set(single)).toEqual(new Set(["50 MB"]));

  await page.getByRole("radio", { name: /Bulk upload/ }).click();
  const bulk = await sizesOnScreen();
  expect(bulk.length).toBeGreaterThan(0); // "...Max 50 MB each"
  expect(new Set(bulk)).toEqual(new Set(["50 MB"]));
});
