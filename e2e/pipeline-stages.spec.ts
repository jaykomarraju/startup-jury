import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

/**
 * W7-F — the incubator pipeline stage screens, one role per test:
 *
 *   admin      Sign up Pipeline's slide-over and its three tabs, the toolbar
 *              Filter, the pinned legend; Prog manager pipeline's column set;
 *              and the NEGATIVE — Onboard ready declares no tabs, so its
 *              startup name still opens the Evaluation drawer.
 *   PM         Intro calls to `panel-introcalls`, and the AI questions in the
 *              seeded GreenRoute call's pane.
 *   jury       "My Intro calls" in the Jury build's thirteen columns.
 *   superuser  a sign-up that completes with NO cohort seat is found through
 *              Onboard ready's Seatless filter and allocated one, on screen.
 *
 * Everything but the last test only READS: the suite is fullyParallel over one
 * local D1. The seat walk uses a deck it uploads itself, and keeps the moment a
 * seatless record exists to seconds — `signup-config.spec.ts` asserts the
 * console's seatless queue is empty, so the record is completed only after this
 * page is already on the screen, and seated straight away.
 */

/** §8 Q28 — the budget for "the SPA has navigated", not for behaviour. */
const NAV = { timeout: 30_000 };

const SUPERUSER = "priya.sharma@demo.startupjury.ai";
const ADMIN = "nisha.kapoor@demo.startupjury.ai";
const PM = "raj.kumar@demo.startupjury.ai";
const JURY = "rajesh.kumar@demo.startupjury.ai";
const FOUNDER = "meera.sharma@demo.startupjury.ai";
const SAMPLE_DECK = fileURLToPath(new URL("../docs/demo-assets/gridbloom-sample-deck.pdf", import.meta.url));

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**", NAV);
}

async function api(baseURL: string, email: string): Promise<APIRequestContext> {
  const ctx = await playwrightRequest.newContext({ baseURL });
  const res = await ctx.post("/api/auth/login", { data: { email, password: "demo1234" } });
  expect(res.status()).toBe(200);
  return ctx;
}

async function headers(page: Page): Promise<string[]> {
  return (await page.getByRole("table").first().getByRole("columnheader").allInnerTexts()).map((h) =>
    h.trim().toLowerCase(),
  );
}

// ═══════════════════════════════════════════════════════════════════════════

test("admin — Sign up Pipeline's slide-over tabs, toolbar and legend; Onboard ready declares none", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, ADMIN);

  await page.goto("/app/incuration");
  // LedgerLite is the seeded sign-up (`coverage.spec.ts` relies on it staying there).
  const row = page.getByRole("row", { name: /LedgerLite/ });
  await expect(row).toBeVisible(NAV);
  expect(await headers(page)).toEqual([
    "startup",
    "ai score",
    "jury score",
    "avg. score",
    "addl. parameter scores",
    "call scheduled",
    "call date",
    "call completed",
    "sign-up status",
    "payment status",
    "documents status",
    "action",
  ]);
  await expect(page.getByTestId("stage-legend")).toContainText("Paid / All docs");
  await expect(page.getByTestId("stage-footer-stat")).toHaveText(/^\d+ startups? in curation · \d+ fully paid · \d+ with all documents$/);
  await expect(page.getByRole("button", { name: "Filter" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export" })).toBeVisible();

  // The slide-over: beside the table, three tabs, Deck first.
  await row.getByRole("button", { name: "LedgerLite", exact: true }).click();
  const pane = page.getByRole("complementary", { name: "LedgerLite detail" });
  await expect(pane).toBeVisible();
  await expect(pane.getByRole("tab")).toHaveText(["Deck", "All scores", "Sign-up"]);
  await expect(pane.getByRole("tab", { name: "Deck" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row).toBeVisible();

  await pane.getByRole("tab", { name: "All scores" }).click();
  await expect(pane.getByText("AI composite")).toBeVisible();
  await pane.getByRole("tab", { name: "Sign-up" }).click();
  await expect(pane.getByTestId("pane-signup")).toContainText("Sign-up workflow — status:");
  await pane.getByRole("button", { name: "Close" }).click();
  await expect(pane).toHaveCount(0);

  // Prog manager pipeline — `panel-forsignup`'s columns under the prototype's casing.
  await page.goto("/app/pmpipeline");
  await expect(page.getByRole("heading", { level: 1, name: "Prog manager pipeline" })).toBeVisible(NAV);
  await expect(page.getByRole("row").nth(1)).toBeVisible(NAV);
  expect(await headers(page)).toEqual([
    "startup",
    "ai score",
    "jury score",
    "avg. score",
    "addl. parameter scores",
    "call scheduled",
    "call date",
    "call completed",
    "sign-up status",
    "action",
  ]);

  // Onboard ready declares no sub-tabs: the name opens the drawer, and no tab strip appears.
  await page.goto("/app/curation");
  const medixir = page.getByRole("row", { name: /Medixir/ });
  await expect(medixir).toBeVisible(NAV);
  await expect(page.getByTestId("stage-legend")).toHaveCount(0);
  await medixir.getByRole("button", { name: "Medixir", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByTestId("stage-pane")).toHaveCount(0);
  await expect(page.getByRole("tab")).toHaveCount(0);
});

test("PM — Intro calls carries the prototype's toolbar and footer, and the call's AI questions", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, PM);
  await page.goto("/app/introcalls");

  const row = page.getByRole("row", { name: /GreenRoute/ });
  await expect(row).toBeVisible(NAV);
  await expect(
    page.getByText("All shortlisted startups · click a name to view the deck · click the AI score for the full parameter breakdown"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Schedule intro call" })).toBeVisible();
  await expect(page.getByTestId("stage-footer-stat")).toHaveText(/^\d+ shortlisted startups? · \d+ scheduled · \d+ completed$/);
  await expect(page.getByTestId("stage-legend")).toHaveText(/Scheduled.*Completed.*Not scheduled/);
  expect(await headers(page)).toEqual([
    "startup",
    "ai score",
    "jury score",
    "avg. score",
    "addl. parameter scores",
    "call scheduled",
    "call date",
    "call completed",
    // V3 item 14 — the prototype's own ninth column, which `ncAssign` fills.
    "assign scheduler",
    "action",
  ]);

  // PIN what the pane must show to what the route says, rather than to the
  // shipped default of the admin toggle.
  const calls = (await (await page.request.get("/api/calls?kind=intro")).json()) as {
    calls: { id: string; deckName: string }[];
  };
  const greenroute = calls.calls.find((c) => c.deckName === "GreenRoute");
  expect(greenroute, "the seeded GreenRoute intro call").toBeTruthy();
  const prompts = (await (await page.request.get(`/api/calls/${greenroute!.id}/prompts`)).json()) as {
    enabled: boolean;
    prompts: { question: string }[];
  };

  await row.getByRole("button", { name: "GreenRoute", exact: true }).click();
  const pane = page.getByRole("complementary", { name: "GreenRoute detail" });
  await expect(pane.getByRole("tab")).toHaveText(["Deck", "All scores"]);
  if (prompts.enabled) {
    await expect(pane.getByTestId("call-ai-questions")).toBeVisible();
    if (prompts.prompts.length > 0) {
      await expect(pane.getByText(prompts.prompts[0]!.question)).toBeVisible();
    }
  } else {
    await expect(pane.getByTestId("call-ai-questions")).toHaveCount(0);
  }
  // Seeded default is ON — say so, so a flipped seed is a visible failure rather than a silent branch.
  expect(prompts.enabled).toBe(true);
});

test("jury — My Intro calls draws the Jury build's thirteen columns", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, JURY);
  await page.goto("/app/introcalls");

  await expect(page.getByRole("row", { name: /GreenRoute/ })).toBeVisible(NAV);
  expect(await headers(page)).toEqual([
    "startup",
    "ai score",
    "parameters score",
    "addl. parameters score",
    "my score",
    "av. score",
    "call scheduled",
    "call date",
    "call time",
    "call completed",
    "scheduled by",
    "view calendar",
    "archive",
  ]);
  await expect(page.getByRole("button", { name: "Schedule intro call" })).toHaveCount(0);
});

// ── Seatless → allocated ────────────────────────────────────────────────────

const STARTUP = `E2E Seatless ${Date.now().toString(36)}`;
let deckId = "";
let signupId = "";
let cohort: { cohortId: string; programId: string; name: string; capacity: number; filled: number } | null = null;

interface SeatRow {
  cohortId: string;
  programId: string;
  name: string;
  capacity: number;
  filled: number;
}

test.describe("superuser — a seatless sign-up is allocated a seat", () => {
  test.beforeAll(async ({ baseURL }) => {
    test.setTimeout(180_000);
    // A cohort already AT capacity, and not one another spec pins: Climate
    // Cohort 6 is `signup-config.spec.ts`'s and Fintech Accelerator Cohort 5 is
    // `signup-workspace.spec.ts`'s (it needs free seats).
    const admin = await api(baseURL!, ADMIN);
    const seats = (await (await admin.get("/api/signup-config/seats")).json()) as { rows: SeatRow[] };
    const full = seats.rows.find(
      (r) => r.capacity > 0 && r.filled >= r.capacity && !["coh_0001", "coh_0002"].includes(r.cohortId),
    );
    expect(full, `a full cohort in ${JSON.stringify(seats.rows)}`).toBeTruthy();
    cohort = { ...full! };
    await admin.dispose();

    const founder = await api(baseURL!, FOUNDER);
    const upload = await founder.post("/api/decks/upload", {
      multipart: {
        file: { name: "e2e-seatless.pdf", mimeType: "application/pdf", buffer: (await import("node:fs")).readFileSync(SAMPLE_DECK) },
        name: STARTUP,
        founderEmail: FOUNDER,
        programId: cohort.programId,
        cohortId: cohort.cohortId,
      },
    });
    expect(upload.status(), await upload.text()).toBeLessThan(300);
    deckId = ((await upload.json()) as { deckId: string }).deckId;

    const su = await api(baseURL!, SUPERUSER);
    const status = async () =>
      ((await (await su.get(`/api/decks/${deckId}`)).json()) as { deck: { statusId: string } }).deck.statusId;
    if ((await status()) === "pending_ai") {
      expect((await su.post(`/api/decks/${deckId}/transition`, { data: { action: "send_to_review" } })).status()).toBe(200);
    }
    if ((await status()) === "manual_review") {
      expect((await su.post(`/api/decks/${deckId}/transition`, { data: { action: "approve_review" } })).status()).toBe(200);
    }
    expect((await su.post(`/api/decks/${deckId}/assign`, { data: { assigneeId: "inc_jury" } })).status()).toBe(200);
    for (const action of ["start_jury_eval", "shortlist", "schedule_intro"]) {
      const res = await su.post(`/api/decks/${deckId}/transition`, { data: { action } });
      expect(res.status(), `${action}: ${await res.text()}`).toBe(200);
    }
    const sent = await su.post(`/api/decks/${deckId}/send-signup`);
    expect(sent.status(), await sent.text()).toBe(200);
    const list = (await (await su.get("/api/signups")).json()) as { signups: { signupId: string; deckId: string }[] };
    signupId = list.signups.find((s) => s.deckId === deckId)!.signupId;

    // The agreement, over the API: nothing here is what this spec is about.
    const signatory = await su.put(`/api/esign/signups/${signupId}/signatory`, { data: { role: "superuser" } });
    expect(signatory.status(), await signatory.text()).toBe(200);
    const signed = await founder.post(`/api/esign/signups/${signupId}/founder-signature`);
    expect(signed.status(), await signed.text()).toBe(200);
    const counter = await su.post(`/api/esign/signups/${signupId}/countersign`);
    expect(counter.status(), await counter.text()).toBe(200);
    await founder.dispose();
    await su.dispose();
  });

  test("Onboard ready → Seatless filter → Sign-up → Allocate seat", async ({ page, baseURL }) => {
    test.setTimeout(180_000);
    await login(page, SUPERUSER);
    await page.goto("/app/curation");
    await expect(page.getByRole("heading", { level: 1, name: "Onboard ready" })).toBeVisible(NAV);

    // Only now does the record complete — with no free seat, so it is seatless.
    const complete = await page.request.post(`/api/signups/${signupId}/complete`);
    expect(complete.status(), await complete.text()).toBe(200);
    expect(((await complete.json()) as { seatless: boolean }).seatless).toBe(true);
    // Make room, so the allocation that follows does not leave the cohort over
    // capacity (the console's seat note would say so). Raising capacity never
    // clears the flag — only Allocate seat does.
    const admin = await api(baseURL!, ADMIN);
    const bump = await admin.put("/api/signup-config/seats", {
      data: { rows: [{ cohortId: cohort!.cohortId, capacity: cohort!.filled + 1, filled: cohort!.filled }] },
    });
    expect(bump.status(), await bump.text()).toBe(200);

    await page.reload();
    const row = page.getByRole("row", { name: new RegExp(STARTUP) });
    await page.getByRole("button", { name: "Filter" }).click();
    await page.getByRole("menuitemradio", { name: "Seatless" }).click();
    await expect(page.getByRole("button", { name: "Filter · Seatless" })).toBeVisible();
    await expect(row).toBeVisible(NAV);

    await row.getByRole("button", { name: "Sign-up" }).click();
    const dialog = page.getByRole("dialog", { name: "Sign-up workflow" });
    await expect(dialog.getByTestId("seatless")).toHaveText(/Seatless — no cohort seat allocated yet/, NAV);
    await dialog.getByRole("button", { name: "Allocate seat" }).click();
    await expect(dialog.getByTestId("seat-allocated")).toHaveText("Seat allocated · founder access provisioned", NAV);
    await expect(dialog.getByTestId("seatless")).toHaveCount(0);

    // The queue the console reads no longer holds it.
    const after = (await (await admin.get("/api/signup-config/seats")).json()) as {
      seatless: { signupId: string }[];
      rows: SeatRow[];
    };
    expect(after.seatless.map((s) => s.signupId)).not.toContain(signupId);
    expect(after.rows.find((r) => r.cohortId === cohort!.cohortId)!.filled).toBe(cohort!.filled + 1);

    // And the Seatless filter no longer finds it once the dialog closes.
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(row).toHaveCount(0);
    await admin.dispose();
  });

  test.afterAll(async ({ baseURL }) => {
    if (!cohort) return;
    // Restore the cohort's seeded figures; the startup keeps its seat record.
    const admin = await api(baseURL!, ADMIN);
    await admin.put("/api/signup-config/seats", {
      data: { rows: [{ cohortId: cohort.cohortId, capacity: cohort.capacity, filled: cohort.filled }] },
    });
    await admin.dispose();
  });
});
