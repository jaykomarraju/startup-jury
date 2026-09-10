import { test, expect, type Page } from "@playwright/test";

/**
 * Admin console → Evaluation → **Rubric anchors** (W2-B).
 *
 * The journey the prototype depicts, walked end to end: an admin picks an
 * evaluation area, sees its AI guidance prompt and five band anchors, edits one,
 * saves it, and finds it still there on a fresh load. Plus the two things the
 * screen exists to prove — the picker carries 22 areas (13 core + 9 role, plan
 * §8 Q10, not the prototype's stale P1/P2/P3 trio), and a role parameter that
 * `0027` scaffolded with NULL text offers five empty boxes rather than nothing.
 *
 * This spec WRITES an anchor, so it restores the value it found afterwards —
 * `e2e/parity.spec.ts` walks the same database.
 */

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

async function openAnchors(page: Page) {
  await login(page, "nisha.kapoor@demo.startupjury.ai"); // incubator admin
  await page.goto("/app/admin?section=rb");
  await expect(page.getByTestId("admin-section-title")).toHaveText("Rubric anchors");
}

test("the picker offers 22 evaluation areas in two groups", async ({ page }) => {
  test.setTimeout(120_000);
  await openAnchors(page);

  const picker = page.getByLabel("Evaluation area");
  await expect(picker.locator("option")).toHaveCount(22);
  await expect(picker.locator("optgroup")).toHaveCount(2);
  await expect(picker.locator('optgroup[label="Core evaluation areas"] option')).toHaveCount(13);
  await expect(
    picker.locator('optgroup[label="Additional configurable parameters"] option'),
  ).toHaveCount(9);

  // The scale is stated and fixed — the BRD's five bands, not four.
  const scale = page.getByLabel("Scale");
  await expect(scale).toBeDisabled();
  await expect(scale).toHaveText("BRD 5-band (0–2 · 3–4 · 5–6 · 7–8 · 9–10)");
});

test("a core area shows its seeded anchors across all five bands", async ({ page }) => {
  test.setTimeout(120_000);
  await openAnchors(page);

  for (const band of ["9–10", "7–8", "5–6", "3–4", "0–2"]) {
    await expect(page.getByText(`${band} · band anchor`).first()).toBeVisible();
  }
  await expect(
    page.getByLabel("9–10 band anchor — Problem & Market Clarity", { exact: true }),
  ).toHaveValue(
    "Mission-critical problem with regulatory or economic pressure.",
  );
  await expect(
    page.getByLabel("AI guidance prompt — Problem & Market Clarity", { exact: true }),
  ).toContainText(
    "specific, clearly-articulated problem",
  );
});

test("a scaffolded role parameter offers five empty bands, not an empty pane", async ({ page }) => {
  test.setTimeout(120_000);
  await openAnchors(page);

  // The first role-scoped option — `0027` scaffolded these with NULL text.
  const picker = page.getByLabel("Evaluation area");
  const roleValue = await picker
    .locator('optgroup[label="Additional configurable parameters"] option')
    .first()
    .getAttribute("value");
  await picker.selectOption(roleValue!);

  // The picker's own editor shows five bands, all empty — the point of the test.
  const label = (await picker.locator(`option[value="${roleValue}"]`).textContent())!;
  const name = label.split(" — ").pop()!.trim();
  for (const band of ["9–10", "7–8", "5–6", "3–4", "0–2"]) {
    await expect(page.getByLabel(`${band} band anchor — ${name}`, { exact: true })).toHaveValue("");
  }
  // The PROMPT is not scaffolded — `0027` wrote one for all 22 parameters. It
  // is the band anchors that ship empty, which is the whole point: the editor
  // must offer somewhere to write them.
  await expect(page.getByLabel(`AI guidance prompt — ${name}`, { exact: true })).not.toHaveValue("");

  // …and all nine role parameters get their own cards below: 9 × (1 prompt + 5 bands).
  await expect(page.getByRole("region", { name: "Configurable parameter anchors" })).toBeVisible();
  await expect(page.locator('textarea[aria-label$="(configurable)"]')).toHaveCount(54);
});

test("an admin edits an anchor and it survives a reload", async ({ page }) => {
  test.setTimeout(120_000);
  await openAnchors(page);

  // The value `0027` seeds for Storytelling's top band. Restoring to a LITERAL
  // rather than to whatever was read at the start of the test is what keeps the
  // spec re-runnable: a run that dies mid-way still leaves the next one a known
  // starting point, and the restore always has something to change back.
  const SEEDED = "Memorable, persuasive, jury-ready.";
  // Unique per run, so the edit is always a real change however the previous
  // run left the row — a `fill()` with the value already stored leaves the form
  // clean and Save correctly disabled.
  const EDITED = `Investor-ready narrative — every slide earns its place (${Date.now()}).`;
  const area = "13 · Storytelling & Deck Quality";
  const anchor = () =>
    page.getByLabel("9–10 band anchor — Storytelling & Deck Quality", { exact: true });

  await page.getByLabel("Evaluation area").selectOption({ label: area });
  await anchor().fill(EDITED);
  const save = page.getByRole("button", { name: "Save anchors" }).first();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByText(/Rubric anchors saved for/)).toBeVisible();

  await page.reload();
  await page.getByLabel("Evaluation area").selectOption({ label: area });
  await expect(anchor()).toHaveValue(EDITED);

  // Put the seeded value back — `e2e/parity.spec.ts` walks this same database.
  await anchor().fill(SEEDED);
  await page.getByRole("button", { name: "Save anchors" }).first().click();
  await expect(anchor()).toHaveValue(SEEDED);
});

test("Revert throws away an unsaved edit", async ({ page }) => {
  test.setTimeout(120_000);
  await openAnchors(page);

  const box = page.getByLabel("0–2 band anchor — Problem & Market Clarity", { exact: true });
  const original = await box.inputValue();
  await box.fill("scratch");
  await page.getByRole("button", { name: "Revert" }).click();
  await expect(box).toHaveValue(original);
});

test("a non-admin cannot reach the anchors API", async ({ page }) => {
  await login(page, "rajesh.kumar@demo.startupjury.ai"); // jury
  const res = await page.request.get("/api/anchors");
  expect(res.status()).toBe(403);
});
