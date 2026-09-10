import { test, expect, type Page } from "@playwright/test";

/**
 * W2-C — Admin console → Evaluation → **Clarification question bank** (`s-qb`),
 * and the clarification letter it feeds.
 *
 * The prototype's section promises the 68 BRD questions are "auto-triggered to
 * the startup when the AI detects weak, missing, or contradictory signal in a
 * given area … edit or add questions per area", but the repo's letter named the
 * weak AREA and stopped there (findings F0030, F0096). The journey that proves
 * the bank is really wired: an admin rewords one question in the accordion, and
 * that is the sentence the founder is asked.
 */

// These four share one mutable bank on one local D1: two of them add, reorder,
// delete and edit rows the others read counts and ordinals from. Under
// `fullyParallel` they would race each other for no benefit — there are four,
// and they are seconds each.
test.describe.configure({ mode: "serial" });

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

const ADMIN = "nisha.kapoor@demo.startupjury.ai"; // incubator admin

interface BankArea {
  parameterId: string;
  key: string;
  name: string;
  questions: { id: string; seq: number; text: string }[];
}

async function readBank(page: Page): Promise<BankArea[]> {
  const res = await page.request.get("/api/questions");
  expect(res.status()).toBe(200);
  return ((await res.json()) as { areas: BankArea[] }).areas;
}

/** Open one accordion, leaving an already-open one open. */
async function openArea(page: Page, key: string) {
  const head = page.getByTestId(`qb-head-${key}`);
  if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
  await expect(head).toHaveAttribute("aria-expanded", "true");
}

/** A deck the Query screen would offer, and one of its weak areas. */
async function weakDeck(page: Page): Promise<{ id: string; area: string }> {
  const res = await page.request.get("/api/decks");
  expect(res.status()).toBe(200);
  const { decks } = (await res.json()) as { decks: { id: string; weakAreas?: string[] }[] };
  const deck = decks.find((d) => (d.weakAreas ?? []).length > 0);
  expect(deck, "no seeded incubator deck has a weak AI area").toBeTruthy();
  return { id: deck!.id, area: deck!.weakAreas![0] };
}

test("the question bank is the prototype's thirteen accordions, 68 questions", async ({ page }) => {
  await login(page, ADMIN);
  await page.goto("/app/admin?section=qb");

  await expect(page.getByTestId("admin-section-title")).toHaveText("Question bank");
  await expect(
    page.getByRole("heading", { level: 2, name: "Clarification question bank" }),
  ).toBeVisible();
  await expect(
    page.getByText(/auto-triggered to the startup when the AI detects weak, missing, or/i),
  ).toBeVisible();

  const areas = await readBank(page);
  expect(areas).toHaveLength(13);

  // Every area's count chip, including the one that is eight rather than five.
  for (const area of areas) {
    await expect(page.getByTestId(`qb-count-${area.key}`)).toHaveText(
      `${area.questions.length} question${area.questions.length === 1 ? "" : "s"}`,
    );
  }
  await expect(page.getByTestId("qb-count-climate_impact")).toHaveText("8 questions");

  // Opens on the first accordion, closed elsewhere — the prototype's `.open`.
  await expect(page.getByTestId(`qb-head-${areas[0].key}`)).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(page.getByText(areas[0].questions[0].text)).toBeVisible();
  await expect(page.getByText(areas[1].questions[0].text)).toBeHidden();

  // Another accordion opens on click, with its Q1…Qn ordinals.
  await openArea(page, areas[1].key);
  await expect(page.getByText(areas[1].questions[0].text)).toBeVisible();
  const panel = page.getByTestId(`qb-area-${areas[1].key}`);
  await expect(panel.getByText(/^Q\d+$/)).toHaveText(areas[1].questions.map((_, i) => `Q${i + 1}`));
});

test("an admin edits a question and the founder is asked the edited wording", async ({ page }) => {
  await login(page, ADMIN);
  const deck = await weakDeck(page);
  const areas = await readBank(page);
  const area = areas.find((a) => a.name === deck.area);
  expect(area, `no bank area named ${deck.area}`).toBeTruthy();
  const original = area!.questions[0];
  const edited = `Which single metric proves ${deck.area} is working? (e2e)`;

  // Before: the letter asks the seeded question.
  const before = await page.request.get(`/api/questions/draft/${deck.id}`);
  expect(before.status()).toBe(200);
  expect(((await before.json()) as { message: string }).message).toContain(original.text);

  // Edit it in the accordion, exactly as an admin would.
  await page.goto("/app/admin?section=qb");
  await openArea(page, area!.key);
  const panel = page.getByTestId(`qb-area-${area!.key}`);
  await expect(panel.getByText(original.text)).toBeVisible();

  const label = `Edit question 1 of ${area!.name}`;
  await panel.getByRole("button", { name: label }).click();
  await panel.getByLabel(label).fill(edited);
  await panel.getByRole("button", { name: "Save" }).click();

  await expect(panel.getByText(edited)).toBeVisible();
  await expect(panel.getByText(original.text)).toBeHidden();

  // After: the generated query carries the edited wording, not the old one.
  const after = await page.request.get(`/api/questions/draft/${deck.id}`);
  const draft = (await after.json()) as {
    message: string;
    triggered: boolean;
    questions: { area: string; questions: string[] }[];
  };
  expect(draft.message).toContain(edited);
  expect(draft.message).not.toContain(original.text);
  expect(draft.message).toContain(`${area!.name} (weak signal)`);
  expect(draft.questions.find((q) => q.area === area!.name)!.questions[0]).toBe(edited);
  expect(draft.triggered).toBe(true);

  // Put it back so a re-run of the suite starts where it started.
  const restore = await page.request.put(`/api/questions/${original.id}`, {
    data: { text: original.text },
  });
  expect(restore.status()).toBe(200);
});

test("add, reorder and delete change the bank the letter draws from", async ({ page }) => {
  // Four sequential mutations, each a round trip and a re-render, on top of a
  // login and a console load. Comfortable on an idle machine and marginal
  // against the default 30s while the other parity worktrees are running their
  // own suites — the budget `e2e/parity.spec.ts:113` sets for the same reason.
  test.setTimeout(90_000);
  await login(page, ADMIN);
  await page.goto("/app/admin?section=qb");

  // "Business Risks" is nobody else's fixture in this suite.
  const areas = await readBank(page);
  const area = areas.find((a) => a.key === "business_risks")!;
  await openArea(page, area.key);
  const panel = page.getByTestId(`qb-area-${area.key}`);
  const added = "Which risk would you insure against first? (e2e)";

  // Add — appended, and the count chip follows.
  await panel.getByRole("button", { name: "Add question" }).click();
  await panel.getByLabel(`New question for ${area.name}`).fill(added);
  await panel.getByRole("button", { name: "Add" }).click();
  await expect(page.getByTestId(`qb-count-${area.key}`)).toHaveText(
    `${area.questions.length + 1} questions`,
  );
  await expect(panel.getByText(added)).toBeVisible();

  // Reorder — the new last question moves up one place, and the ordinals are
  // positional, so it becomes Q(n-1).
  const last = area.questions.length + 1;
  await panel.getByRole("button", { name: `Move question ${last} of ${area.name} up` }).click();
  await expect
    .poll(
      async () => (await readBank(page)).find((a) => a.key === area.key)!.questions[last - 2].text,
    )
    .toBe(added);

  // Delete — soft on the server, gone from the accordion.
  await panel.getByRole("button", { name: `Delete question ${last - 1} of ${area.name}` }).click();
  await expect(page.getByTestId(`qb-count-${area.key}`)).toHaveText(
    `${area.questions.length} questions`,
  );
  await expect(panel.getByText(added)).toBeHidden();

  // Back to the seeded order so the suite is re-runnable.
  const now = (await readBank(page)).find((a) => a.key === area.key)!;
  const restore = await page.request.put("/api/questions/reorder", {
    data: { parameterId: area.parameterId, ids: area.questions.map((q) => q.id) },
  });
  expect(restore.status()).toBe(200);
  expect(now.questions).toHaveLength(area.questions.length);
});

test("a non-admin reaches neither the section nor the bank", async ({ page }) => {
  await login(page, "rajesh.kumar@demo.startupjury.ai"); // jury
  const res = await page.request.get("/api/questions");
  expect(res.status()).toBe(403);
  await page.goto("/app/admin?section=qb");
  await expect(page.getByRole("dialog", { name: "Admin console" })).toBeHidden();
});
