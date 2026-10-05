import { test, expect, type Page } from "@playwright/test";

// Phase 4 incubator happy paths against the seeded local D1:
// - FinStack seeds at ai_evaluated (assignable)
// - InsureFlow seeds at jury_evaluation, assigned to the jury member (shortlistable)

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

test("program associate assigns an AI-gated deck to a jury member", async ({ page }) => {
  await login(page, "sunita.rao@demo.startupjury.ai");
  await page.goto("/app/assign");

  await expect(page.getByRole("heading", { name: "Assign" })).toBeVisible();

  // Aug-2026 issue 22 — four panels: decks → role → members → allocation.
  // W7-E: the role rows read in the prototype's sentence case ("Jury member").
  await page.getByRole("checkbox", { name: "Select FinStack" }).check();
  await page.getByRole("button", { name: /^Jury member/ }).click();
  await page.getByRole("checkbox", { name: "Select Rajesh Kumar" }).check();

  // Panel 4 previews the allocation before anything is written. W7-E: it is now
  // the prototype's summary card (deck chips × member chips), not a pair list.
  const summary = page.getByTestId("assign-summary");
  await expect(summary).toContainText("FinStack");
  await expect(summary).toContainText("Rajesh Kumar");

  await page.getByRole("button", { name: /Confirm assignment/ }).click();
  await expect(page.getByText(/Assignment confirmed/)).toBeVisible();
  // W7-E: the confirmation is the results table — one row per deck × member.
  const row = page.getByRole("table", { name: "Assignment results" }).getByRole("row", { name: /FinStack/ });
  await expect(row).toContainText("Rajesh Kumar");
});

test("jury member scores an assigned deck — and does NOT get to shortlist it", async ({ page }) => {
  await login(page, "rajesh.kumar@demo.startupjury.ai");
  // Jury reaches the scoring form via their "Assigned" nav item.
  await page.goto("/app/jassigned");

  await expect(page.getByRole("heading", { name: "Assigned to me" })).toBeVisible();
  // R7-JURY — `panel-jassigned`'s table lists the startups now. Clicking the
  // name still opens the workbench, as the prototype's row does; there is
  // still no Score button (§4).
  await page
    .getByRole("row", { name: /InsureFlow/ })
    .getByRole("button", { name: "InsureFlow", exact: true })
    .click();

  // The evaluator workbench opens with the AI · My · Average tiles.
  await expect(page.getByRole("heading", { name: "InsureFlow" })).toBeVisible();
  await expect(page.getByText("My Score", { exact: true })).toBeVisible();
  await expect(page.getByText("Average", { exact: true })).toBeVisible();

  // The jury's role-scoped additional params render in their own section
  // (assistive, not folded into the core-13 composite).
  await expect(page.getByText("Additional parameters · your lens")).toBeVisible();
  // "Barriers of entry" is the jury's first parameter in the specs' §6.2
  // canonical set (migration 0025).
  await expect(page.getByText("Barriers of entry").first()).toBeVisible();

  // **No Shortlist, and no Reject.** The client, 2026-10-04: "Not required since
  // the below threshold levels are indicated automatically. It is the prerogative
  // of the Incubator to take a final call. Juror is always an external guy." The
  // juror scores — everything above this line still works — and the decision is
  // the incubator's.
  //
  // The buttons are gone AND the transitions are: `"jury"` is out of the role
  // list on both `jury_evaluation` transitions, so this is not a hidden control
  // over a live route, which is the failure mode this repo keeps reproducing.
  await expect(page.getByRole("button", { name: "Shortlist" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Reject" })).toBeHidden();

  // The juror can still SAVE their scores, which is the whole of their job here —
  // the guard on the guard, so this case cannot pass by the workbench failing to
  // render at all.
  await expect(page.getByRole("button", { name: /Submit|Save/ }).first()).toBeVisible();
});

/**
 * PARKED 2026-10-02, pending one answer from the client — NOT a regression, and
 * deliberately not deleted.
 *
 * His flow of that date: "if a deck is incomplete contact details firstly … send
 * to query or send to assign should be not active and also not show up in assign
 * or query screen". Shipped literally, `missing_fields` being the whole intake
 * checklist, so a deck missing ANY required field is off the Query screen and
 * `POST /send-to-query` answers 409 `contact_incomplete`.
 *
 * This spec encodes the opposite and older flow, which was built on purpose: the
 * Query screen's last column is "Parameters needing response", and the fixture
 * below STRIPS a required detail precisely so the letter can ask the founder for
 * it. Both cannot be true.
 *
 * The two readings agree on four of the six decks he was looking at and differ
 * on two — BiocharIND and NatureMark have a working email address and are
 * missing only a phone or a city, so we CAN reach them to ask. His stated reason
 * ("you cannot send any Email Query too if contact details are not available")
 * points at reachability; his literal words point at the whole checklist.
 *
 * One line decides it in `routes/decks.ts` — `contactComplete` against the
 * reachability predicate — so this stays `fixme` rather than being rewritten
 * toward an answer that may flip. See `docs/parity-requests/OCT2-LISTS.md` §3.
 */
test.fixme("staff query an incomplete deck; it records a sent query", async ({ page }) => {
  await login(page, "sunita.rao@demo.startupjury.ai");
  await page.goto("/app/query");

  // Aug-2026 issues 15–18 — two tabs; tick the startups, then send from the
  // Email query tab.
  await expect(page.getByRole("heading", { name: "Founder queries" })).toBeVisible();
  // PayRoute seeds at incomplete — but S2-SERVER's row 3 means that is no
  // longer enough to put it on this screen. Query membership is a RECORDED
  // action now: the client asked that routing happen only when an operator
  // clicks, because a deck with incomplete contact details cannot be emailed
  // for want of contact details. So send it first, then reload the list.
  const send = await page.request.post("/api/decks/inc_deck_payroute/send-to-query");
  expect(send.ok(), await send.text()).toBeTruthy();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Founder queries" })).toBeVisible();
  await page.getByRole("checkbox", { name: "Select PayRoute" }).check();
  await page.getByRole("tab", { name: /Email query/ }).click();

  // The recipient and a generated message covering its areas are prefilled.
  await expect(page.getByText(/vikram@payroute\.in/)).toBeVisible();
  const body = page.getByRole("textbox", { name: "Body" });
  await expect(body).toContainText("PayRoute");
  await body.fill("Please share MRR, churn, and team size.");
  await page.getByRole("button", { name: "Send query" }).click();

  // W7-C: "sent" only when the outbox delivers — local dev records (§1.4).
  await expect(page.getByRole("button", { name: "Query recorded for 1 founder" })).toBeVisible();

  // The drill-down records it against the startup.
  await page.getByRole("tab", { name: /Founder queries/ }).click();
  await page.getByRole("button", { name: "PayRoute" }).click();
  await expect(page.getByText(/Please share MRR/)).toBeVisible();
});
