import { test, expect } from "@playwright/test";

// Session 6 — the public founder resubmit loop.
//
// The seeded demo link (migration 0017) points at NimbusHR, the canonical
// Incomplete deck: real founder account, one missing intake column
// (founderPhone). Everything below runs with NO login — the token in the link is
// the entire credential, which is the point of the flow.
const DEMO_LINK = "/resubmit/aisj-demo-nimbushr-resubmit-2026";

test("the tokenized link opens the founder page with no login at all", async ({ page }) => {
  await page.goto(DEMO_LINK);

  await expect(page.getByRole("heading", { name: "NimbusHR" })).toBeVisible();
  await expect(page.getByText("Action required")).toBeVisible();
  // The missing intake column, rendered with its human label.
  await expect(page.getByText("Phone", { exact: true })).toBeVisible();
  // One action only — re-upload the deck. No Q&A form (§8).
  await expect(page.getByRole("button", { name: /upload & re-score/i })).toBeVisible();
  await expect(page.locator("textarea")).toHaveCount(0);
  // The founder must never see scores or evaluator data.
  await expect(page.getByText(/weighted/i)).toHaveCount(0);

  // It really is unauthenticated: no session cookie was ever set.
  const cookies = await page.context().cookies();
  expect(cookies.find((c) => c.name === "sj_session")).toBeUndefined();
});

test("a bad token shows a founder-facing explanation, not a login redirect", async ({ page }) => {
  await page.goto("/resubmit/definitely-not-a-real-token");

  await expect(page.getByText(/this link can.t be opened/i)).toBeVisible();
  await expect(page.getByText(/isn.t valid/i)).toBeVisible();
  // The SPA catch-all must not swallow the route and bounce to /login.
  await expect(page).toHaveURL(/\/resubmit\//);
});

test("the founder re-uploads a corrected deck and it is re-scored", async ({ page }) => {
  await page.goto(DEMO_LINK);
  await expect(page.getByRole("heading", { name: "NimbusHR" })).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles({
    name: "nimbushr-updated.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF"),
  });
  await expect(page.getByText("nimbushr-updated.pdf")).toBeVisible();

  await page.getByRole("button", { name: /upload & re-score/i }).click();

  // Local dev has no Anthropic key, so the re-score is deferred to the queue —
  // either confirmation proves the version landed and the loop closed.
  await expect(page.getByText(/version 2 received/i)).toBeVisible({ timeout: 30_000 });

  // The new version shows in the founder's own history.
  await expect(page.getByText("v2", { exact: true })).toBeVisible();
  await expect(page.getByText("nimbushr-updated.pdf")).toBeVisible();
});
