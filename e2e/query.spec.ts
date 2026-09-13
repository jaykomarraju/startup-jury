import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// W7-C — the Query screen, end to end: an operator selects two flagged decks,
// composes, and sends. What the founders RECEIVE is read back from the local
// D1 outbox, because that — not the confirmation on screen — is where a
// confidentiality leak (F0215) or a missing link (F0217) would show.
//
// The two decks are created here rather than borrowed from the seed. The seeded
// Incomplete decks (PayRoute, NimbusHR) both lack only a phone number, so they
// cannot show that each founder gets THEIR areas; and querying NimbusHR would
// mint it a new resubmit token once the server change is placed, revoking the
// fixed demo link `resubmit.spec.ts` opens. Fresh rows mutate nothing shared.

const SAMPLE_DECK = readFileSync(
  fileURLToPath(new URL("../docs/demo-assets/gridbloom-sample-deck.pdf", import.meta.url)),
);

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

interface Flagged {
  deckId: string;
  name: string;
  email: string;
  /** The area this deck — and only this deck — is missing. */
  area: string;
}

/** A deck in Manual Review missing exactly one required detail. */
async function flaggedDeck(page: Page, label: string, missing: "founderPhone" | "city"): Promise<Flagged> {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const name = `Query ${label} ${stamp}`;
  const email = `e2e-query-${label.toLowerCase()}-${stamp}@example.test`;
  const upload = await page.request.post("/api/decks/upload", {
    multipart: {
      file: { name: `${label}.pdf`, mimeType: "application/pdf", buffer: SAMPLE_DECK },
      name,
      founder: `${label} Founder`,
      founderEmail: email,
      founderPhone: "+91 90000 12345",
      sector: "FinTech",
      city: "Pune",
    },
  });
  expect(upload.ok(), await upload.text()).toBeTruthy();
  const { deckId } = (await upload.json()) as { deckId: string };

  // Clear one required detail — PATCH re-derives `missing_fields`…
  const patch = await page.request.patch(`/api/decks/${deckId}`, { data: { [missing]: "" } });
  expect(patch.ok(), await patch.text()).toBeTruthy();
  // …and pull the deck into Manual Review, which the Query screen lists.
  const review = await page.request.post(`/api/decks/${deckId}/transition`, {
    data: { action: "send_to_review" },
  });
  expect(review.ok(), await review.text()).toBeTruthy();

  return { deckId, name, email, area: missing === "city" ? "City" : "Phone" };
}

interface OutboxRow {
  deck_id: string;
  kind: string;
  to_email: string;
  subject: string;
  body: string;
  status: string;
}

/** What the outbox recorded for these decks — the email as the founder gets it. */
function recordedQueryEmails(deckIds: string[]): OutboxRow[] {
  const ids = deckIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(", ");
  const out = execFileSync(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      "startup-jury-db",
      "--local",
      "--json",
      "--command",
      `SELECT deck_id, kind, to_email, subject, body, status FROM email_outbox WHERE kind = 'founder_query' AND deck_id IN (${ids})`,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return (JSON.parse(out) as { results: OutboxRow[] }[])[0].results;
}

const SUBJECT = "Two quick questions about your submission";

test.describe.serial("an operator emails two flagged founders", () => {
  let alpha: Flagged;
  let beta: Flagged;

  test("each founder's recorded email names only their own startup and areas", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, "sunita.rao@demo.startupjury.ai"); // incubator program associate
    alpha = await flaggedDeck(page, "Alpha", "founderPhone");
    beta = await flaggedDeck(page, "Beta", "city");

    await page.goto("/app/query");
    // Gate on a populated row, never the heading the loading branch renders too.
    await expect(page.getByRole("checkbox", { name: `Select ${alpha.name}` })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Founder queries" })).toBeVisible();

    // The prototype's exact column set.
    const headers = await page.locator("table thead th").allInnerTexts();
    expect(headers.map((h) => h.trim().toLowerCase())).toEqual([
      "",
      "startup",
      "founder",
      "phone",
      "email",
      "status",
      "parameters needing response",
    ]);

    const alphaRow = page.getByRole("row", { name: new RegExp(alpha.name) });
    await expect(alphaRow.getByText("Pending", { exact: true })).toBeVisible();
    await expect(alphaRow.getByText(alpha.area, { exact: true })).toBeVisible();

    await page.getByRole("checkbox", { name: `Select ${alpha.name}` }).check();
    await page.getByRole("checkbox", { name: `Select ${beta.name}` }).check();
    await expect(page.getByText("2 founders selected")).toBeVisible();
    await page.getByRole("button", { name: "Email query", exact: true }).click();

    await expect(page.getByRole("heading", { name: "Email query to founders" })).toBeVisible();
    await expect(page.getByText(alpha.email)).toBeVisible();
    await expect(page.getByText(beta.email)).toBeVisible();
    await page.getByRole("textbox", { name: "Subject" }).fill(SUBJECT);

    // Each founder's letter, as the card shows it.
    const body = page.getByRole("textbox", { name: "Body" });
    const letterFor = page.getByRole("combobox", { name: "Letter for" });
    await letterFor.selectOption(alpha.deckId);
    await expect(body).toHaveValue(new RegExp(`Thank you for submitting ${alpha.name}`));
    await expect(body).toHaveValue(new RegExp(`• ${alpha.area} \\(missing detail\\)`));
    const shownAlpha = await body.inputValue();
    await letterFor.selectOption(beta.deckId);
    await expect(body).toHaveValue(new RegExp(`Thank you for submitting ${beta.name}`));
    const shownBeta = await body.inputValue();
    expect(shownAlpha).not.toContain(beta.name);
    expect(shownBeta).not.toContain(alpha.name);

    await page.getByRole("button", { name: "Send query" }).click();
    // Local dev has no sending domain: the outbox records, and the screen says so.
    await expect(page.getByRole("button", { name: "Query recorded for 2 founders" })).toBeVisible();

    // The staff record of each query is the letter that founder was shown.
    for (const [deck, shown] of [
      [alpha, shownAlpha],
      [beta, shownBeta],
    ] as const) {
      const res = await page.request.get(`/api/decks/${deck.deckId}/queries`);
      const { queries } = (await res.json()) as { queries: { questions: string }[] };
      expect(queries).toHaveLength(1);
      expect(queries[0].questions).toBe(shown);
    }

    // And the recorded email: one per founder, to that founder, about that deck only.
    const rows = recordedQueryEmails([alpha.deckId, beta.deckId]);
    expect(rows).toHaveLength(2);
    for (const [mine, theirs] of [
      [alpha, beta],
      [beta, alpha],
    ] as const) {
      const mail = rows.find((r) => r.deck_id === mine.deckId)!;
      expect(mail.to_email).toBe(mine.email);
      expect(mail.status).toBe("recorded");
      expect(mail.body).toContain(mine.name);
      expect(mail.body).toContain(`• ${mine.area} (missing detail)`);
      expect(mail.body).not.toContain(theirs.name);
      expect(mail.body).not.toContain(`• ${theirs.area} (missing detail)`);
    }

    // Both rows stay on the list, now with a query on record.
    await page.getByRole("tab", { name: /Founder queries/ }).click();
    await expect(page.getByRole("checkbox", { name: `Select ${alpha.name}` })).toBeVisible();
  });

  test("the recorded email is the letter verbatim, under the operator's subject, with the response link", async () => {
    // EXPECTED TO FAIL until integration places §9's `W7-C` server change
    // (`docs/parity-requests/W7-C-query-email.patch`): today POST
    // /api/decks/:id/queries ignores `subject`, wraps the letter in its own
    // greeting (F0216), and mints no link (F0217). The patch deletes this
    // `test.fail()` in the same commit — Playwright reports an unexpected pass
    // otherwise, so the gap cannot quietly close without being recorded.
    test.fail();
    const rows = recordedQueryEmails([alpha.deckId, beta.deckId]);
    expect(rows).toHaveLength(2);
    for (const mail of rows) {
      expect(mail.subject).toBe(SUBJECT);
      expect(mail.body.startsWith("Dear Founder,")).toBe(true);
      expect(mail.body).not.toContain("[your secure response link]");
      expect(mail.body).toMatch(/→ https?:\/\/\S+\/resubmit\/[A-Za-z0-9_-]{20,}/);
    }
  });
});
