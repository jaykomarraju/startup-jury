import { test, expect, type Page } from "@playwright/test";

// W9-E — the three VC call screens as the prototype draws them
// (`AISJ_VC_Superuser_V8` panel-introcalls / -partnercall / -alignmentcall, and
// `AISJ_VC_IC_member_V2`'s own Alignment call).
//
// READ-ONLY throughout: the suite runs fullyParallel over one local D1 and
// `vc.spec.ts` sponsors MedGrid out of Partner call at the same moment, so
// nothing here asserts MedGrid's live state. What it asserts about decided rows
// is PINNED to seeded decisions no spec can undo (0008: PayWise left partner
// call for another meeting; FreshCart passed at it) — under the agreed rule
// (§9) a later move elsewhere never rewrites a decided row's outcome.

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

/** Header text as authored (the CSS uppercases it). */
async function headers(page: Page) {
  return page.locator("table thead th").evaluateAll((ths) => ths.map((th) => th.textContent?.trim() ?? ""));
}

test("VC Intro calls: the prototype's columns, footer and legend, and the AI's questions in the pane", async ({ page }) => {
  await login(page, "sunita.rao.vc@demo.startupjury.ai"); // vc_associate
  await page.goto("/app/introcalls");

  // Gate on a populated row, never on the heading the loading branch renders too.
  const row = page.getByRole("row", { name: /WealthOS/ });
  await expect(row).toBeVisible();
  expect(await headers(page)).toEqual([
    "Startup",
    "AI score",
    "Analyst Score",
    "Avg. score",
    "Addl. Parameter scores",
    "Call scheduled",
    "Call date",
    "Call completed",
    "Schedule call",
    "Assign scheduler",
  ]);
  await expect(page.getByTestId("stage-footer-stat")).toHaveText(/^\d+ shortlisted startups? · \d+ scheduled · \d+ completed$/);
  await expect(page.getByTestId("stage-legend")).toHaveText(/Scheduled.*Completed.*Not scheduled/);
  await expect(page.getByRole("button", { name: "Filter" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export" })).toBeVisible();

  // PIN the pane to what the route answers for this call, not to the toggle's default.
  const listing = (await (await page.request.get("/api/calls?kind=intro")).json()) as {
    calls: { id: string; deckName: string }[];
  };
  const wealthos = listing.calls.find((c) => c.deckName === "WealthOS");
  expect(wealthos, "the seeded WealthOS intro call").toBeTruthy();
  const prompts = (await (await page.request.get(`/api/calls/${wealthos!.id}/prompts`)).json()) as {
    enabled: boolean;
    prompts: { question: string }[];
  };

  await row.getByRole("button", { name: "WealthOS", exact: true }).click();
  const pane = page.getByRole("complementary", { name: "WealthOS detail" });
  await expect(pane.getByRole("tab")).toHaveText(["Deck", "All scores"]);
  if (prompts.enabled) {
    await expect(pane.getByTestId("call-ai-questions")).toBeVisible();
    if (prompts.prompts.length > 0) await expect(pane.getByText(prompts.prompts[0]!.question)).toBeVisible();
  } else {
    await expect(pane.getByTestId("call-ai-questions")).toHaveCount(0);
  }
  // The seeded default is ON — a flipped seed should fail loudly, not take the other branch.
  expect(prompts.enabled).toBe(true);
});

test("VC Partner call: V8's columns, decided rows kept with their outcome, and NO AI questions", async ({ page }) => {
  const promptRequests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/prompts")) promptRequests.push(r.url());
  });
  await login(page, "ishaan.sethi@demo.startupjury.ai"); // vc_partner
  await page.goto("/app/partnercall");

  const paywise = page.getByRole("row", { name: /PayWise/ });
  await expect(paywise).toBeVisible();
  expect(await headers(page)).toEqual([
    "Startup",
    "AI score",
    "Partner",
    "Avg. score",
    "Addl. Parameter scores",
    "Call scheduled",
    "Call date",
    "Call completed",
    "Schedule call",
    "Sponsorship",
  ]);
  await expect(page.getByTestId("stage-legend")).toHaveText(/Sponsor to IC.*Need another meeting.*Pass/);
  await expect(page.getByTestId("stage-footer-stat")).toHaveText(
    /^\d+ deals? in partner review · \d+ calls? scheduled · \d+ sponsored to IC$/,
  );

  // Decided at this stage, kept, disabled, reading the decision — not where the deck is now.
  const paySelect = paywise.getByRole("combobox", { name: "Sponsorship for PayWise" });
  await expect(paySelect).toBeDisabled();
  await expect(paySelect).toHaveValue("another_meeting");
  const fresh = page.getByRole("combobox", { name: "Sponsorship for FreshCart" });
  await expect(fresh).toBeDisabled();
  await expect(fresh).toHaveValue("pass_at_call");
  await expect(paywise.getByRole("button", { name: "Schedule call" })).toHaveCount(0);

  // The name opens the evaluation report (`pcReport`), and this kind carries no questions.
  const report = page.waitForResponse((r) => /\/api\/decks\/[^/]+\/report/.test(r.url()));
  await paywise.getByRole("button", { name: "PayWise", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Evaluation report — PayWise" })).toBeVisible();
  await report; // settled before absence is asserted
  await expect(page.getByTestId("call-ai-questions")).toHaveCount(0);
  // The app shell has its own <aside>; the row pane is the one named "… detail".
  await expect(page.getByRole("complementary", { name: /detail$/ })).toHaveCount(0);
  expect(promptRequests).toEqual([]);
});

test("VC Alignment call: the partner's Outcome select, and the IC member's own ten columns", async ({ browser }) => {
  const partner = await browser.newPage();
  await login(partner, "ishaan.sethi@demo.startupjury.ai");
  await partner.goto("/app/alignmentcall");
  const gridzero = partner.getByRole("row", { name: /GridZero/ });
  await expect(gridzero).toBeVisible();
  expect(await headers(partner)).toEqual([
    "Startup",
    "AI score",
    "Partner",
    "Avg. score",
    "Addl. Parameter scores",
    "Call scheduled",
    "Call date",
    "Call completed",
    "Schedule call",
    "Outcome",
  ]);
  await expect(partner.getByTestId("stage-legend")).toHaveText(/Issue term sheet.*Renegotiate.*Hold/);
  await expect(gridzero.getByRole("combobox", { name: "Outcome for GridZero" })).toHaveValue("issue_term_sheet");
  await partner.close();

  const ic = await browser.newPage();
  await login(ic, "rajesh.kumar.vc@demo.startupjury.ai"); // vc_ic — on LearnLoop's alignment call
  await ic.goto("/app/alignmentcall");
  await expect(ic.getByRole("row", { name: /LearnLoop/ })).toBeVisible();
  expect(await headers(ic)).toEqual([
    "Startup",
    "AI score",
    "My score",
    "Avg. score",
    "Addl. Parameter scores",
    "Call scheduled",
    "Call date",
    "Call completed",
    "View Calendar",
    "Archive",
  ]);
  await expect(ic.getByTestId("stage-legend")).toHaveText(/Launch on Google Meet, Teams or Zoom.*Archive to remove from the queue/);
  await expect(ic.getByRole("combobox", { name: /^Outcome for / })).toHaveCount(0);
  await ic.close();
});
