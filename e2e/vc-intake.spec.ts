import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// W9-A — the VC deck-intake quartet, walked one VC role per test on the VC seed:
// All decks (the deal funnel; the IC member's "Awaiting my vote"), Upload (per
// uploader role, and an analyst's stage → upload → flag → Send to Query),
// Query (the seeded flagged deal), Evaluate (the checklist and the batch bar;
// the IC member's ballot variant) and Submit's own title.
//
// Nothing here asserts a count another spec can move: `vc.spec` casts an IC
// vote on CreditBridge and sponsors MedGrid to IC while this file runs. What
// mutates uses decks this file creates.

const SAMPLE_DECK = fileURLToPath(new URL("../docs/demo-assets/gridbloom-sample-deck.pdf", import.meta.url));
const NOT_AVAILABLE = "Not available for your role";

const VC = {
  superuser: "aarav.khanna@demo.startupjury.ai",
  admin: "nisha.kapoor.vc@demo.startupjury.ai",
  partner: "ishaan.sethi@demo.startupjury.ai",
  ic_member: "rajesh.kumar.vc@demo.startupjury.ai",
  associate: "sunita.rao.vc@demo.startupjury.ai",
  analyst: "rhea.nair@demo.startupjury.ai",
};

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/app/);
}

async function headers(page: Page): Promise<string[]> {
  const table = page.locator("table[data-shape]");
  await expect(table.locator("tbody tr").first()).toBeVisible();
  return (await table.locator("thead th").allTextContents()).map((t) => t.trim());
}

function tile(page: Page, label: string) {
  return page.getByRole("button", { name: new RegExp(`^${label}\\s*\\d`) });
}

/** Every in-app link the screen body offers (the sidebar is `nav.spec`'s). */
async function bodyLinks(page: Page): Promise<string[]> {
  return page.locator("main a[href^='/app/']").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
}

// ── All decks ────────────────────────────────────────────────────────────────

test("VC All decks is the deal funnel — each box its own table (F0433 / F0437)", async ({ page }) => {
  await login(page, VC.partner);
  await page.goto("/app/alldecks");
  await expect(page.getByRole("button", { name: "QuantIQ" })).toBeVisible({ timeout: 30_000 });
  const labels = await page.locator("button[aria-pressed] .u-label").allTextContents();
  expect(labels).toEqual(["Uploaded", "Incomplete", "AI Evaluated", "In Diligence", "IC ready", "Onboard ready"]);
  expect(await headers(page)).toEqual(["Startup", "Sector", "City", "AI score", "Stage", "Submitted"]);
  // Deal stages, not cohort stages.
  await expect(page.getByRole("row", { name: /QuantIQ/ }).getByText("Onboard ready")).toBeVisible();
  await expect(page.getByRole("row", { name: /Northbeam Robotics/ }).getByText("Incomplete")).toBeVisible();

  const sets: [string, string[]][] = [
    ["Incomplete", ["Startup", "Founder name", "Email ID", "Phone number", "City", "Status"]],
    ["AI Evaluated", ["Startup", "AI score", "Parameter scores"]],
    ["In Diligence", ["Startup", "Sector", "AI score", "Diligence progress", "Flags", "Lead"]],
    ["IC ready", ["Startup", "AI score", "Avg. score", "Ask", "Valuation", "Recommendation"]],
    ["Onboard ready", ["Startup", "AI score", "Term sheet", "Legal DD", "Onboarding"]],
  ];
  for (const [label, want] of sets) {
    await tile(page, label).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(label);
    expect(await headers(page), label).toEqual(want);
  }
  // Onboard-ready deals are onboarded — the legal DD is cleared.
  await expect(page.getByRole("row", { name: /QuantIQ/ }).getByText("Cleared")).toBeVisible();
});

test("the IC member's All decks is Awaiting my vote (F0434)", async ({ page }) => {
  await login(page, VC.ic_member);
  await page.goto("/app/alldecks");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Awaiting my vote", { timeout: 30_000 });
  const labels = await page.locator("button[aria-pressed] .u-label").allTextContents();
  expect(labels).toEqual(["At IC", "Awaiting my vote", "Evaluated by me", "On agenda", "Investment pipeline", "Funded"]);
  await expect(page.getByText(/\d+ deals? at IC · Updated/)).toBeVisible();

  await tile(page, "At IC").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("At IC");
  expect(await headers(page)).toEqual(["Startup", "Sector", "AI score", "Stage in IC", "My status"]);
  // Funded deals are in the member's pool; deals short of the committee are not.
  await expect(page.getByRole("row", { name: /QuantIQ/ }).getByText("Funded")).toBeVisible();
  await expect(page.getByRole("button", { name: "Northbeam Robotics" })).toHaveCount(0);

  await tile(page, "Funded").click();
  expect(await headers(page)).toEqual(["Startup", "Final check", "Round", "Close date", "Ownership"]);
});

// ── Upload ───────────────────────────────────────────────────────────────────

// Buy credits is the `billing` nav item: admin by role, the Super User by the
// nav's superuser bypass. The prototype agrees — present in the Super User and
// Admin builds, deleted at panel-upload.html:165 in the other four.
const UPLOADERS: { role: keyof typeof VC; buys: boolean }[] = [
  { role: "superuser", buys: true },
  { role: "admin", buys: true },
  { role: "partner", buys: false },
  { role: "associate", buys: false },
  { role: "analyst", buys: false },
];

for (const { role, buys } of UPLOADERS) {
  test(`VC ${role} — Upload renders the wizard with the balance, and ${buys ? "a" : "no"} Buy credits`, async ({ page }) => {
    await login(page, VC[role]);
    await page.goto("/app/upload");
    await expect(page.getByRole("heading", { name: "Upload your first pitchdecks" })).toBeVisible({ timeout: 30_000 });
    const bar = page.getByTestId("up-credits-bar");
    await expect(bar.getByText(/^Credits balance — \d+ remaining$/)).toBeVisible();
    await expect(bar.getByRole("link", { name: "Buy credits" })).toHaveCount(buys ? 1 : 0);
    // The sidebar's own "Buy credits" item is nav.spec's; the screen body offers one or none.
    await expect(page.locator("main").getByText("Buy credits")).toHaveCount(buys ? 1 : 0);
    await expect(page.locator("body")).not.toContainText("₹");

    // No link the screen body offers may land on "Not available for your role".
    const links = [...new Set(await bodyLinks(page))];
    for (const href of links) {
      await page.goto(href);
      await expect(page.locator("h1").first()).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(NOT_AVAILABLE), `${href} is not available to a VC ${role}`).toHaveCount(0);
    }
  });
}

test("the IC member has no Upload", async ({ page }) => {
  await login(page, VC.ic_member);
  await page.goto("/app/upload");
  await expect(page.getByRole("heading", { name: NOT_AVAILABLE })).toBeVisible({ timeout: 30_000 });
});

test("a VC analyst stages two decks, uploads one, flags a VC parameter and sends it to Query", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, VC.analyst);

  // The VC rubric the flag panel offers is the edition's own — read it off the API.
  const areas = await page.evaluate(async () => {
    const r = (await (await fetch("/api/parameters")).json()) as {
      parameters: { name: string; informational?: boolean }[];
    };
    return r.parameters.filter((p) => !p.informational).map((p) => p.name);
  });
  expect(areas).toHaveLength(13);
  const area = "Business Risks";
  expect(areas).toContain(area);

  await page.goto("/app/upload");
  await expect(page.getByRole("heading", { name: "Upload your first pitchdecks" })).toBeVisible({ timeout: 30_000 });
  const stamp = Date.now();
  const keep = `W9A Keep ${stamp}`;
  const skip = `W9A Skip ${stamp}`;
  const pdf = readFileSync(SAMPLE_DECK);
  await page.getByRole("radio", { name: /Bulk upload/ }).click();
  await page.getByLabel("Choose a ZIP or several pitch decks").setInputFiles([
    { name: `${keep}.pdf`, mimeType: "application/pdf", buffer: pdf },
    { name: `${skip}.pdf`, mimeType: "application/pdf", buffer: pdf },
  ]);
  await expect(page.getByTestId("up-cost-bar")).toHaveText(/Cost for this batch\s*2 credits/, { timeout: 20_000 });
  await page.getByRole("button", { name: "Go to dashboard →" }).click();

  await expect(page.getByRole("heading", { name: "Review uploaded decks" })).toBeVisible();
  await expect(page.getByTestId("up-deck-row")).toHaveCount(2);
  const row = page.getByTestId("up-deck-row").filter({ hasText: keep });
  await expect(row.getByText("14 slides")).toBeVisible({ timeout: 20_000 });
  await row.getByRole("checkbox", { name: `Select ${keep}` }).check();
  await expect(page.getByTestId("up-cost-preview")).toContainText("Cost 1 credit");
  await page.getByRole("button", { name: "Upload selected decks" }).click();
  await expect(page.getByRole("button", { name: "View uploaded details →" })).toBeVisible({ timeout: 30_000 });

  // Only the ticked deck reached the fund.
  const ids = await page.evaluate(
    async (names) => {
      const { decks } = (await (await fetch("/api/decks")).json()) as { decks: { id: string; name: string }[] };
      return names.map((n) => decks.find((d) => d.name === n)?.id ?? null);
    },
    [keep, skip],
  );
  expect(ids[0]).not.toBeNull();
  expect(ids[1]).toBeNull();

  await page.getByRole("button", { name: "View uploaded details →" }).click();
  await page.getByRole("button", { name: "← Back to review" }).click();
  await row.click();
  await row.getByRole("button", { name: "Mark incomplete" }).click();
  const panel = page.getByTestId("up-flag-panel");
  await panel.getByRole("checkbox", { name: `Flag ${area}` }).check();
  await panel.getByRole("group", { name: `${area} signal` }).getByRole("button", { name: "Weak signal" }).click();
  await panel.getByRole("button", { name: "Send to Query" }).click();
  await expect(panel.getByText("✓ Sent to Query")).toBeVisible({ timeout: 20_000 });

  const queries = await page.evaluate(
    async (id) => (await (await fetch(`/api/decks/${id}/queries`)).json()) as { queries: { questions: string }[] },
    ids[0],
  );
  expect(queries.queries).toHaveLength(1);
  expect(queries.queries[0].questions).toContain(`• ${area} (weak signal)`);

  // The VC Query list holds it — a deal being re-scored with a query on record.
  await panel.getByRole("link", { name: "View in Query →" }).click();
  await page.waitForURL(/\/app\/query$/);
  await expect(page.getByRole("checkbox", { name: `Select ${keep}` })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(NOT_AVAILABLE)).toHaveCount(0);
});

// ── Query ────────────────────────────────────────────────────────────────────

test("VC Query lists the seeded flagged deal and previews its founder flow", async ({ page }) => {
  await login(page, VC.associate);
  await page.goto("/app/query");
  const row = page.getByRole("row", { name: /Northbeam Robotics/ });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row.getByText(/^(Pending|Overdue|Responded)$/)).toBeVisible();
  // A deal past screening is never on it.
  await expect(page.getByRole("row", { name: /QuantIQ/ })).toHaveCount(0);

  await row.getByRole("button", { name: "Northbeam Robotics" }).click();
  await expect(page.getByRole("heading", { name: "Founder clarification flow" })).toBeVisible();
  await expect(page.getByText("Areas requiring your input")).toBeVisible();
});

// ── Evaluate ─────────────────────────────────────────────────────────────────

test("VC Evaluate — the checklist, the parameters, and Evaluate selected decks (F0435 / F0436)", async ({ page }) => {
  await login(page, VC.associate);
  await page.goto("/app/evaluate");
  const list = page.getByRole("list", { name: "Decks to evaluate" });
  await expect(list.getByRole("button", { name: "WealthOS" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Select decks · review parameters · click Evaluate to begin")).toBeVisible();
  await expect(page.getByText("13 Evaluation parameters")).toBeVisible();

  await page.getByRole("button", { name: "Review Traction & Validation" }).click();
  const card = page.getByRole("article", { name: "Traction & Validation detail" });
  await expect(card.getByText("AI clarification questions (asked when signals are weak)")).toBeVisible();
  await expect(card.getByText("Rubric anchors")).toBeVisible();

  const go = page.getByRole("button", { name: /Evaluate selected decks/ });
  await expect(go).toBeDisabled();
  await page.getByRole("checkbox", { name: "Select WealthOS" }).click();
  await page.getByRole("checkbox", { name: "Select AgriChain" }).click();
  await expect(page.getByTestId("ev-sel-label")).toHaveText("2 decks selected");
  await go.click();
  const dialog = page.getByRole("dialog", { name: /^Evaluate / });
  await expect(dialog.getByText(/Deck 1 of 2/)).toBeVisible();
  // Nothing pre-scored, so nothing can be submitted untouched (F0454).
  await expect(dialog.getByLabel("My score for Traction & Validation")).toHaveValue("");
  await expect(dialog.getByRole("button", { name: "Submit my evaluation" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);
});

test("the IC member's Evaluate lists the deals at IC with a ballot alongside (F0441)", async ({ page }) => {
  await login(page, VC.ic_member);
  await page.goto("/app/evaluate");
  await expect(page.getByText("Click a deck to open its evaluation report · set its status alongside")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("My additional parameters (IC)")).toBeVisible();
  await expect(page.getByRole("button", { name: /Evaluate selected decks/ })).toHaveCount(0);
  const list = page.getByRole("list", { name: "Deals at IC" });
  await expect(list.getByLabel(/^My vote on /).first()).toBeVisible();
  await expect(list.getByText("WealthOS")).toHaveCount(0);
});

test("VC Submit carries its own title", async ({ page }) => {
  await login(page, VC.analyst);
  await page.goto("/app/assign");
  await expect(page.getByRole("heading", { level: 1, name: "Submit" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Select evaluated decks · choose role · pick one or more jury members · confirm")).toBeVisible();
});
