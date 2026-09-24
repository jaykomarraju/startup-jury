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

  // ── The columns, as the JURY's prototype draws them ────────────────────────
  //
  // R7-JURY — `panel-jassigned`, the six-column allocation table. It replaced
  // the v15 three-panel launcher this test used to walk, so the steps that
  // belonged to that launcher are gone with it: the parameter browser
  // (columns 2 and 3, "Review Traction & Validation") and the per-row
  // recommendation select ("Status for WealthOS"). Neither is on the jury
  // prototype's screen — it declares no toolbar, no Status and no Action — and
  // neither has another home for a juror. Both are recorded as an open question
  // in `docs/parity-requests/R7-JURY.md`; if the client wants the
  // recommendation back, this is the test that should grow it again.
  //
  // What this test is actually about is untouched: a juror scores a deck and
  // the report they open differs by the stage they opened it from.
  await expect(page.getByRole("heading", { level: 1, name: "Assigned to me" })).toBeVisible();
  await expect(
    page.getByText("Decks allocated to you for evaluation · click a startup name to open the deck and score it"),
  ).toBeVisible();

  const row = page.getByRole("row", { name: /WealthOS/ });
  await expect(row).toBeVisible();
  await expect(page.getByTestId("ja-foot")).toHaveText(/^\d+ decks? assigned to you$/);
  // `jaRender`'s six `<th>`, in order.
  await expect(page.getByRole("table").getByRole("columnheader")).toHaveText([
    "Startup",
    "AI Score",
    "Parameter scores",
    "Assigned date",
    "Due date",
    "Assigned by",
  ]);

  // ── Open it and score every parameter ──────────────────────────────────────
  await row.getByRole("button", { name: "WealthOS", exact: true }).click();
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
  // The Addl. Parameters Score cell, by its stable name rather than by whatever
  // it happens to be showing. It used to be clicked as /View scores/, which is
  // only the cell's EMPTY state: this juror has their own three chips on
  // GreenRoute, so once the report matrix lands the fallback is gone and the
  // click can never resolve. Measured alone on a drained box, that timed out
  // after 120s and passed on retry only by beating the fetch. See `MyAddlCell`.
  await page
    .getByRole("row", { name: /GreenRoute/ })
    .getByRole("button", { name: "Additional parameter scores for GreenRoute" })
    .click();
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
  // NOT the same cell as the juror's above, and deliberately left alone. The
  // staff column set draws "Addl. Parameter scores" as a plain, permanent
  // `View scores` button (`CallsPage`'s `columns`), never as the viewer's own
  // chips — `MyAddlCell` is on the JURY's thirteen-column variant only. So this
  // locator has no state to race and is correct as it stands.
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
