import { test, expect, type Page } from "@playwright/test";

/**
 * W2-A — the Scoring framework and Area weights console sections, and the one
 * thing about them that is easiest to fake: **blind scoring**.
 *
 * The blind-scoring walk deliberately asserts the **API response**, not the
 * DOM. A screen that hides the AI score with a CSS rule looks identical to one
 * that never receives it; only the payload tells them apart, and only the
 * payload matters — a juror can open devtools.
 */

const ADMIN = "nisha.kapoor@demo.startupjury.ai"; // incubator admin
const JURY = "rajesh.kumar@demo.startupjury.ai"; // incubator jury
const SUPER = "priya.sharma@demo.startupjury.ai"; // incubator superuser
const PM = "raj.kumar@demo.startupjury.ai"; // incubator program manager — no console

/**
 * Sign in, dropping any existing session first: the blind-scoring walk has to
 * be the admin and then the juror in one context, and `/login` bounces a
 * signed-in visitor straight back into the app.
 */
async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

/**
 * Flip the framework through its own route rather than the console UI.
 *
 * `org_scoring_settings` is org-wide and Playwright runs `fullyParallel`
 * against one local D1 (see plan §8 Q17), so any window in which blind scoring
 * is on is a window another spec's evaluator could see it in. Driving the API
 * makes that window sub-second instead of a page load; the console's own UI is
 * walked by the two tests below, which mutate nothing.
 */
async function setFramework(page: Page, patch: Record<string, unknown>) {
  const current = await page.request.get("/api/config/scoring");
  const { scoring } = (await current.json()) as { scoring: Record<string, unknown> };
  const res = await page.request.put("/api/config/scoring-framework", {
    data: { ...scoring, ...patch },
  });
  expect(res.ok()).toBe(true);
}

test("blind scoring withholds the AI score from the API, not just the screen", async ({ page }) => {
  // Four sign-ins and six API round-trips; the default 30 s budget is tight on
  // a machine running other parity worktrees.
  test.setTimeout(90_000);
  // A deck the jury member is assigned to, with a full AI breakdown, and which
  // they have NOT scored — verified against the seed, not assumed.
  const deckId = "inc_deck_edulift";

  await login(page, ADMIN);
  const adminContext = page.request;

  // Baseline: with the toggle on (the seeded default) the juror is served the
  // AI breakdown, so the assertion below is about the toggle and nothing else.
  await login(page, JURY);
  const before = (await (await page.request.get(`/api/decks/${deckId}`)).json()) as {
    scores: unknown[];
    aiScoreWithheld?: boolean;
  };
  expect(before.aiScoreWithheld).toBeUndefined();
  expect(before.scores.length).toBeGreaterThan(0);

  await login(page, ADMIN);
  await setFramework(page, { showAiScoreToJury: false });
  try {
    await login(page, JURY);
    const blind = await page.request.get(`/api/decks/${deckId}`);
    expect(blind.ok()).toBe(true);
    const body = (await blind.json()) as {
      scores: unknown[];
      weightedTotal?: number;
      verdict?: string;
      aiScoreWithheld?: boolean;
      deck: { aiScore?: number; signal?: string };
    };
    // Nothing about the AI's opinion crosses the wire — not the per-parameter
    // scores, not the composite, not the verdict, not even the signal band.
    expect(body.aiScoreWithheld).toBe(true);
    expect(body.scores).toEqual([]);
    expect(body.weightedTotal).toBeUndefined();
    expect(body.verdict).toBeUndefined();
    expect(body.deck.aiScore).toBeUndefined();
    expect(body.deck.signal).toBeUndefined();
  } finally {
    await login(page, ADMIN);
    await setFramework(page, { showAiScoreToJury: true });
  }

  // Restored: the same juror is served the AI breakdown again.
  await login(page, JURY);
  const after = (await (await page.request.get(`/api/decks/${deckId}`)).json()) as {
    scores: unknown[];
    aiScoreWithheld?: boolean;
  };
  expect(after.aiScoreWithheld).toBeUndefined();
  expect(after.scores.length).toBeGreaterThan(0);
  expect(typeof adminContext.get).toBe("function");
});

test("the Scoring framework section carries the prototype's controls, minus the mentor toggle", async ({
  page,
}) => {
  await login(page, ADMIN);
  await page.goto("/app/admin?section=fw");

  await expect(page.getByRole("heading", { level: 2, name: "Scoring framework" })).toBeVisible();
  for (const card of ["AI engine behaviour", "Score composition", "Score transparency & reports"]) {
    await expect(page.getByText(card, { exact: true })).toBeVisible();
  }
  for (const toggle of [
    "AI pre-scoring enabled",
    "Auto-trigger clarification questions",
    "Show AI score to jury before they score",
    "Require override rationale",
    "Jury can see each other's scores",
    "Show 3-score view (AI · Mine · Average)",
    "Show score drift analysis in reports",
    "Include AI evidence quotes in reports",
    "Intro call AI question prompts enabled",
  ]) {
    await expect(page.getByRole("switch", { name: toggle })).toBeVisible();
  }
  // §1.2 — mentors hold no pipeline authority, so the prototype's fourth
  // transparency toggle is deliberately absent.
  await expect(page.getByText(/Mentor can adjust composite/i)).toHaveCount(0);

  // The cohort bands live in the same card and preview live, one decimal each
  // (F0166). Derived from the inputs rather than pinned to the seeded 7.0/5.0:
  // `e2e/config.spec.ts` edits the same two values and the suite shares one
  // local D1 (plan §8 Q17).
  const best = Number(await page.getByLabel(/Best — at or above/).inputValue());
  const poor = Number(await page.getByLabel(/Poor — below/).inputValue());
  const preview = page.getByTestId("threshold-preview");
  await expect(preview).toContainText(`Best ≥ ${best.toFixed(1)}`);
  await expect(preview).toContainText(`Mediocre ${poor.toFixed(1)} – ${(best - 0.1).toFixed(1)}`);
  await expect(preview).toContainText(`Poor < ${poor.toFixed(1)}`);
});

test("the AI weight control shows what it changes, on real decks, without saving", async ({
  page,
}) => {
  // V4-WEIGHT (items 3/4). The client asked for every split but 50:50 to be
  // hidden because "nothing was changing when I changed from 40:60 or 50:50 or
  // any other option, I saw no difference." The control was wired the whole
  // time — `test/worker/ai-weight-effect.test.ts` measures it moving
  // `decisionScore` — but its effect was never on this screen. This is the
  // end-to-end proof that it is now: the server's real decks, blended through
  // `decisionScore`, redrawn as the select moves. Read-only: nothing is saved.
  await login(page, ADMIN);
  await page.goto("/app/admin?section=fw");

  const select = page.getByLabel("AI weight in composite");
  // All four splits stay. Hiding them is explicitly withdrawn, and this is the
  // tripwire in the real browser rather than in a mocked render.
  await expect(select.locator("option")).toHaveCount(4);

  // Gate on the POPULATED strip — its heading only exists once the framework
  // read has landed, so this cannot pass against a loading shell.
  const strip = page.getByTestId("ai-weight-preview");
  await expect(strip).toContainText("What this split produces —");
  const rows = strip.getByTestId("ai-weight-preview-row");
  await expect(rows.first()).toBeVisible();
  const before = await rows.first().innerText();

  // Move to a split this workspace is NOT on. Read the current value rather
  // than assuming 40: `e2e/config.spec.ts` writes the same section and the
  // suite shares one local D1 (plan §8 Q17).
  const current = await select.inputValue();
  const other = ["50", "30", "0", "40"].find((v) => v !== current)!;
  await select.selectOption(other);

  await expect(strip).toContainText("What this split changes —");
  await expect(strip).toContainText("→");
  // The numbers actually moved: the strip is not a static caption that merely
  // renamed itself. A row now carries both the old blend and the new one.
  await expect(rows.first()).not.toHaveText(before);

  // Put the select back so nothing is left dirty for a sibling spec.
  await select.selectOption(current);
  await expect(strip).toContainText("What this split produces —");
});

test("Area weights polices the 100 % total and delegates per parameter", async ({ page }) => {
  await login(page, ADMIN);
  await page.goto("/app/admin?section=wt");

  await expect(page.getByRole("heading", { level: 2, name: "Area weights" })).toBeVisible();
  await expect(page.getByTestId("weight-total")).toHaveText("Total: 100% ✓");

  // The prototype's exact five columns.
  for (const header of ["#", "Evaluation area", "Type", "Weight %", "Visual"]) {
    await expect(page.getByRole("columnheader", { name: header }).first()).toBeVisible();
  }

  // Knock the total off 100 and the console's Save is refused. Read the current
  // weight rather than assuming one: `e2e/config.spec.ts` edits the same rubric
  // and the whole suite shares one local D1 (plan §8 Q17).
  const first = page.getByLabel(/ weight$/).first();
  const was = Number(await first.inputValue());
  await first.fill(String(was - 4));
  await expect(page.getByTestId("weight-total")).toHaveText("Total: 96% — 4% remaining");
  await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await first.fill(String(was + 4));
  await expect(page.getByTestId("weight-total")).toHaveText("Total: 104% — over by 4%");
  await first.fill(String(was));
  await expect(page.getByTestId("weight-total")).toHaveText("Total: 100% ✓");

  // The role cards sit in the same section, with their tier badges (F0155/F0078).
  await expect(page.getByText("Additional configurable parameters")).toBeVisible();
  for (const badge of ["AI+ score", "AI++ score", "AI+++ score"]) {
    await expect(page.getByText(badge, { exact: true })).toBeVisible();
  }
  // Seeded: parameter 1 of each owning role is permitted.
  await expect(page.getByRole("button", { name: "Permitted" })).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Permit configuration" })).toHaveCount(6);
});

// ── V3 item 13 · the score visibility matrices ───────────────────────────────

/**
 * The two `Score visibility matrix` cards the v3 superuser prototype adds to
 * `s-fw` — and the role boundary around them.
 *
 * **P0-2** (`docs/plan_roles_incubator.md` §5): the cards were drawn for the
 * superuser alone while `PUT /api/config/scoring-framework` accepted the grid
 * from any console admin, so an admin could move a permission system through an
 * API whose console did not show it to them. Decided Q-U (a) — widen, because
 * the admin already administers the strictly more powerful Task permissions
 * grid through the same task — and the rule now lives ONCE, on the server, as
 * `canEditVisibility`; the console renders on the `visibilityEditable` flag it
 * ships. Both roles are walked below, in the real browser.
 *
 * Read-only: the suite runs `fullyParallel` against one local D1, and this
 * matrix governs what every other spec's evaluator can see, so saving a cell
 * here would leak into their runs (plan §8 Q17). The save path is covered by
 * `test/worker/score-visibility-v3.test.ts` and, for the gate itself,
 * `test/worker/score-visibility-gate.test.ts` — both against the payload. The
 * one refusal asserted here is safe precisely because it writes nothing.
 */
test("the superuser's Scoring framework carries both visibility matrices", async ({ page }) => {
  await login(page, SUPER);
  await page.goto("/app/admin?section=fw");

  await expect(page.getByText("Visibility for Incubator")).toBeVisible();
  await expect(page.getByText("Visibility for VC")).toBeVisible();
  await expect(page.getByText("Viewer (row) → can see scores of (column)")).toHaveCount(2);

  // The prototype's shipped state: the Super User row on, the Jury row off —
  // "jury members cannot see each other (blind evaluation) until turned on here".
  await expect(
    page.getByRole("switch", { name: "Super User can see Jury Member scores" }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(
    page.getByRole("switch", { name: "Jury Member can see Jury Member scores" }),
  ).toHaveAttribute("aria-checked", "false");

  // The investor 5×5 uses the prototype's own role names, not this repo's.
  await expect(
    page.getByRole("switch", { name: "Managing Partner can see Analyst scores" }),
  ).toBeVisible();
});

test("P0-2 — the incubator admin sees the grid they could already change", async ({ page }) => {
  await login(page, ADMIN);
  await page.goto("/app/admin?section=fw");

  await expect(page.getByRole("heading", { level: 2, name: "Scoring framework" })).toBeVisible();
  await expect(page.getByText("Visibility for Incubator")).toBeVisible();
  await expect(page.getByText("Visibility for VC")).toBeVisible();
  await expect(
    page.getByRole("switch", { name: "Program Associate can see Program Mgr scores" }),
  ).toBeEnabled();

  // Q-U (b) is NOT taken this wave — `admin` is a row and column of neither
  // matrix, and adding it moves migration 0072's persisted shape. The screen
  // says so, because an unexplained hole in a permission grid is how "a role is
  // missing" gets filed.
  await expect(page.getByText(/Your own role, Admin, is not a row or column here/)).toBeVisible();

  // The admin's console keeps the toggle the v3 superuser screen supersedes —
  // this session widened who sees the matrices, nothing else about the section.
  await expect(page.getByRole("switch", { name: "Jury can see each other's scores" })).toBeVisible();
});

test("P0-2 — the console and the route agree, measured on the same session", async ({ page }) => {
  // The pairing, end to end: what the browser is told and what the API does
  // have to be the same answer, or the screen is lying about what it can do.
  // Asserted in BOTH directions and without writing a cell — the admin's row is
  // proven by the flag the console renders on, the PM's by a refusal that
  // stores nothing (the exhaustive per-role table, including the admin's
  // successful write, is the worker test).
  await login(page, ADMIN);
  const adminView = (await (await page.request.get("/api/config/scoring")).json()) as {
    visibilityEditable?: boolean;
  };
  expect(adminView.visibilityEditable).toBe(true);

  await login(page, PM);
  const pmView = (await (await page.request.get("/api/config/scoring")).json()) as {
    scoring: Record<string, unknown>;
    visibilityEditable?: boolean;
  };
  expect(pmView.visibilityEditable).toBe(false);

  const refused = await page.request.put("/api/config/scoring-framework", {
    data: {
      ...pmView.scoring,
      visibility: { incubator: { program_associate: { program_manager: true } } },
    },
  });
  expect(refused.status()).toBe(403);

  // …and there is no console for them to have attempted it from: the PM's
  // refusal is the same answer at both ends, which is the property P0-2 broke.
  await page.goto("/app/admin?section=fw");
  await expect(page.getByText("Not available for your role")).toBeVisible();
  await expect(page.getByText("Visibility for Incubator")).toHaveCount(0);
});
