import { test, expect, type Page } from "@playwright/test";

// W7-D — the Evaluate workbench, worked end to end by a juror, and the
// stage-aware evaluation report (incubator spec §8.4): the report opened from
// the jury's Assigned screen is NOT the report opened from Intro calls.
//
// One test per role (a second sign-in on the same page is redirected back to
// /app). Fixtures, verified against the seed rather than assumed:
//   • inc_deck_wealthosi — incubator "WealthOS", jury_evaluation, assigned to
//     inc_jury (0008). No other incubator spec opens it. Submitting keeps it at
//     jury_evaluation, so nothing another spec reads changes stage.
//   • inc_deck_greenroute — "GreenRoute", shortlisted, with the seeded intro
//     call the jury member is a participant on (calls.spec.ts reads it; this
//     spec only opens its report, which mutates nothing).

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

/** The role sections the open report carries, by accessible name. */
async function reportSections(page: Page, deck: string): Promise<string[]> {
  const report = page.getByRole("dialog", { name: `Evaluation report — ${deck}` });
  // Gate on a POPULATED element — the first role section — never "Loading report…".
  await expect(report.getByRole("region", { name: / parameters$/ }).first()).toBeVisible();
  const names: string[] = [];
  for (const region of await report.getByRole("region", { name: / parameters$/ }).all()) {
    names.push((await region.getAttribute("aria-label")) ?? "");
  }
  return names;
}

test("a juror works a deck end to end, and the Assigned report differs from the Intro calls report", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await login(page, "rajesh.kumar@demo.startupjury.ai"); // inc_jury
  await page.goto("/app/jassigned");

  // ── The toolbar and the columns, as the prototype draws them ───────────────
  await expect(page.getByRole("heading", { level: 1, name: "Evaluate" })).toBeVisible();
  await expect(page.getByText("Click a deck to open its evaluation report · set its status alongside")).toBeVisible();
  await expect(page.getByRole("button", { name: "Filter" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export" })).toBeVisible();

  const list = page.getByRole("list", { name: "Decks to evaluate" });
  const row = list.getByRole("listitem").filter({ hasText: "WealthOS" });
  await expect(row).toBeVisible();
  await expect(page.getByTestId("ev-decks-label")).toHaveText(/^\d+ decks? · click to open report$/);
  await expect(page.getByText("Click Review to see the full prompt")).toBeVisible();
  await expect(page.getByText("My additional parameters (Jury Member)")).toBeVisible();
  await expect(page.getByText("Core evaluation parameters")).toBeVisible();

  // ── Review a parameter: prompt, clarification questions, rubric anchors ────
  await page.getByRole("button", { name: "Review Traction & Validation" }).click();
  const detail = page.getByRole("article", { name: "Traction & Validation detail" });
  await expect(detail.getByText("AI clarification questions (asked when signals are weak)")).toBeVisible();
  await expect(detail.getByText("Rubric anchors")).toBeVisible();

  // ── Set its status alongside ───────────────────────────────────────────────
  const status = row.getByLabel("Status for WealthOS");
  await status.selectOption("hold");
  await expect(page.getByText("WealthOS → Hold")).toBeVisible();
  await expect(status).toHaveValue("hold");

  // ── Open it and score every parameter ──────────────────────────────────────
  await row.getByTitle("Open evaluation report").click();
  const workbench = page.getByRole("dialog", { name: "Evaluate WealthOS" });
  await expect(workbench.getByRole("heading", { name: "WealthOS" })).toBeVisible();
  const submit = workbench.getByRole("button", { name: "Submit my evaluation" });

  const inputs = workbench.getByLabel(/^My score for /);
  // Thirteen core areas and the jury's three additional parameters.
  await expect(inputs).toHaveCount(16);
  for (const input of await inputs.all()) {
    await input.fill("6");
  }
  // A score far from the AI's forces its remarks open; answer every one.
  for (const remark of await workbench.getByLabel(/^My remarks for /).all()) {
    await remark.fill("Checked against the deck and the founder's data room.");
  }
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(workbench.getByText("Submitted", { exact: true })).toBeVisible();

  // ── The report opened from the jury's Assigned screen ──────────────────────
  await workbench.getByRole("button", { name: /Evaluation report/ }).click();
  const assignedReport = page.getByRole("dialog", { name: "Evaluation report — WealthOS" });
  await expect(assignedReport.getByTestId("report-stage")).toHaveText("Assign stage");
  const fromAssigned = await reportSections(page, "WealthOS");
  expect(fromAssigned).toEqual(["Program Associate parameters", "Jury Member parameters"]);
  await expect(
    assignedReport.getByRole("region", { name: "Jury Member parameters" }).getByText(/yours to score/),
  ).toBeVisible();
  await assignedReport.getByRole("button", { name: "Done" }).click();
  await workbench.getByRole("button", { name: "Close" }).click();

  // ── The report opened from Intro calls ─────────────────────────────────────
  await page.goto("/app/introcalls");
  await expect(page.getByRole("heading", { name: "My Intro calls" })).toBeVisible();
  await page.getByRole("row", { name: /GreenRoute/ }).getByRole("button", { name: /View scores/ }).click();
  const introReport = page.getByRole("dialog", { name: "Evaluation report — GreenRoute" });
  await expect(introReport.getByTestId("report-stage")).toHaveText("Intro calls stage");
  const fromIntro = await reportSections(page, "GreenRoute");
  expect(fromIntro).toEqual([
    "Program Associate parameters",
    "Program Manager parameters",
    "Jury Member parameters",
  ]);

  // The two are different reports: Intro calls adds the Program Manager section.
  expect(fromIntro).not.toEqual(fromAssigned);
  expect(fromAssigned).not.toContain("Program Manager parameters");
});

test("a programme manager's Intro calls report shows the jury's section as completed, read-only", async ({
  page,
}) => {
  await login(page, "raj.kumar@demo.startupjury.ai"); // inc_pm
  await page.goto("/app/introcalls");
  await expect(page.getByRole("heading", { name: "Intro calls" })).toBeVisible();
  await page.getByRole("row", { name: /GreenRoute/ }).getByRole("button", { name: /View scores/ }).click();

  const report = page.getByRole("dialog", { name: "Evaluation report — GreenRoute" });
  await expect(report.getByTestId("report-stage")).toHaveText("Intro calls stage");
  expect(await reportSections(page, "GreenRoute")).toEqual([
    "Program Associate parameters",
    "Program Manager parameters",
    "Jury Member parameters",
  ]);
  const jury = report.getByRole("region", { name: "Jury Member parameters" });
  await expect(jury).toHaveAttribute("data-mode", "completed");
  await expect(jury.getByText(/completed by jury/)).toBeVisible();
  await expect(jury.getByText(/yours to score/)).toHaveCount(0);
  await expect(report.getByRole("region", { name: "Program Associate parameters" }).getByText(/read only/)).toBeVisible();
  await expect(report.getByRole("region", { name: "Program Manager parameters" }).getByText(/yours to score/)).toBeVisible();
});
