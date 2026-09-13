import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

/**
 * W6-A — the **three-tab sign-up workspace**, walked end to end (spec §8.3).
 * The session's headline deliverable, ONE ROLE AT A TIME, one test per role:
 *
 *   admin    configures the programme's checklist, and finds the template mapped
 *   associate sends sign-up, sets the signing method, assigns the countersignatory
 *   PM       opens the workspace unassigned — read-only, and the API agrees
 *   admin    assigns the PM
 *   founder  attaches every requested document and signs
 *   PM       sees the method LOCKED, verifies, countersigns → the deck is onboarded
 *
 * **A fresh deck per run.** The loop cannot be restored — a verified document
 * and a countersigned agreement are terminal by design (§8 Q56) — and
 * `coverage.spec.ts` expects the seeded LedgerLite to stay in Sign up Pipeline
 * while `signup-config.spec.ts` expects the seatless queue empty. So the fixture
 * uploads a new deck as the founder into Fintech Accelerator · Cohort 5 (free
 * seats: it ends SEATED, never seatless) and walks it to the intro call over
 * the API; everything the loop is about happens on screen.
 *
 * The admin's checklist edit is scoped to Fintech Accelerator and saved "New
 * sign-ups only", and restored to the default's shape at the end — nothing
 * else in the suite reads that programme's checklist, and the edition default
 * that `signup-config.spec.ts` asserts is never touched. The template is
 * ASSERTED rather than edited: `agreements.spec.ts` asserts the same library
 * row in the other worker.
 */

test.describe.configure({ mode: "serial" });

/** §8 Q28 — the budget for "the SPA has navigated", not for behaviour. */
const NAV = { timeout: 30_000 };

const ADMIN = "nisha.kapoor@demo.startupjury.ai";
const SUPERUSER = "priya.sharma@demo.startupjury.ai";
const PM = "raj.kumar@demo.startupjury.ai";
const PA = "sunita.rao@demo.startupjury.ai";
const FOUNDER = "meera.sharma@demo.startupjury.ai";

const PROGRAM = { id: "prog_incubator_0002", name: "Fintech Accelerator", cohort: "coh_0002" };
const SAMPLE_DECK = fileURLToPath(new URL("../docs/demo-assets/gridbloom-sample-deck.pdf", import.meta.url));
const REQUIRED = ["Certificate of incorporation", "Founder ID proof", "Cap table", "Bank account details"];

const STARTUP = `E2E Signup ${Date.now().toString(36)}`;
let deckId = "";
let signupId = "";

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

/** The pipeline row, pinned by the startup's NAME — never by a badge a click changes. */
function pipelineRow(page: Page) {
  return page.getByRole("row", { name: new RegExp(STARTUP) });
}

async function openWorkspace(page: Page, slug = "incuration") {
  await page.goto(`/app/${slug}`);
  await expect(pipelineRow(page)).toBeVisible(NAV);
  await pipelineRow(page).getByRole("button", { name: "Sign-up" }).click();
  const dialog = page.getByRole("dialog", { name: "Sign-up workflow" });
  await expect(dialog.getByTestId("workspace-startup")).toHaveText(STARTUP, NAV);
  return dialog;
}

test.beforeAll(async ({ baseURL }) => {
  test.setTimeout(180_000);
  // The founder submits a deck into the programme…
  const founder = await api(baseURL!, FOUNDER);
  const upload = await founder.post("/api/decks/upload", {
    multipart: {
      file: { name: "e2e-signup.pdf", mimeType: "application/pdf", buffer: (await import("node:fs")).readFileSync(SAMPLE_DECK) },
      name: STARTUP,
      // Named explicitly: esign's founder-signature records the signer by
      // `decks.founder_email` alone, and with it NULL the signature row fails
      // its CHECK after the record is already marked signed (a 500 on a
      // half-written sign). W5-B's file — filed in plan §9.
      founderEmail: FOUNDER,
      programId: PROGRAM.id,
      cohortId: PROGRAM.cohort,
    },
  });
  expect(upload.status(), await upload.text()).toBeLessThan(300);
  deckId = ((await upload.json()) as { deckId: string }).deckId;
  await founder.dispose();

  // …and the pipeline walks it to the intro call. None of this is the loop.
  const su = await api(baseURL!, SUPERUSER);
  const status = async () =>
    (((await (await su.get(`/api/decks/${deckId}`)).json()) as { deck: { statusId: string } }).deck.statusId);
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
  expect(await status()).toBe("intro");
  await su.dispose();
});

test("admin — the programme's checklist asks for four documents, and its template is mapped", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, ADMIN);
  await page.goto("/app/admin?section=sudocs");
  await expect(page.getByTestId("admin-section-title")).toHaveText("Required documents", NAV);

  // The configuration itself goes through the section's own API, not its Save
  // button. A programme that has no list of its own shows the default's items
  // WITH the default's ids, and `RequiredDocuments.tsx` sends those ids back, so
  // the server rightly refuses them as another scope's rows (`unknown_document`)
  // — "Saving here creates its own" cannot succeed from the screen today. That
  // is W5-A's file; it is filed in plan §9 with its one-line fix. What the admin
  // then SEES is asserted on screen.
  const current = (await (await page.request.get(`/api/signup-config/documents?programId=${PROGRAM.id}`)).json()) as {
    inherited: boolean;
    items: { id: string; name: string; note: string | null; mandatory: boolean }[];
  };
  const saved = await page.request.put("/api/signup-config/documents", {
    data: {
      programId: PROGRAM.id,
      cohortId: null,
      applyTo: "new",
      items: current.items.map((i) => ({
        id: current.inherited ? undefined : i.id,
        name: i.name,
        note: i.note,
        mandatory: i.name === "Bank account details" ? true : i.mandatory,
      })),
    },
  });
  expect(saved.status(), await saved.text()).toBe(200);

  const loaded = page.waitForResponse((r) => r.url().includes(`programId=${PROGRAM.id}`) && r.ok());
  await page.getByLabel("Program").selectOption({ label: PROGRAM.name });
  await loaded;
  await expect(page.getByTestId("checklist-inherited")).toHaveCount(0);
  for (const name of REQUIRED) {
    await expect(page.getByRole("switch", { name: `${name} mandatory` })).toHaveAttribute("aria-checked", "true");
  }
  await expect(page.getByRole("switch", { name: "GST / tax registration mandatory" })).toHaveAttribute(
    "aria-checked",
    "false",
  );

  await page.goto("/app/admin?section=suagr");
  await expect(page.getByTestId("admin-section-title")).toHaveText("Agreements library", NAV);
  const incub = page.locator("li").filter({ hasText: "Incubation Agreement" }).first();
  await expect(incub.getByText("Active")).toBeVisible(NAV);
  await expect(incub).toContainText(PROGRAM.name);
});

test("associate — sends sign-up, sets the method while it is editable, assigns the countersignatory", async ({ page }) => {
  test.setTimeout(150_000);
  await login(page, PA);
  expect((await page.request.post(`/api/decks/${deckId}/send-signup`)).status()).toBe(200);

  const dialog = await openWorkspace(page);
  const summaries = (await (await page.request.get("/api/signups")).json()) as {
    signups: { signupId: string; deckId: string }[];
  };
  signupId = summaries.signups.find((s) => s.deckId === deckId)!.signupId;

  // Documents: the programme's checklist, inherited — Bank is now required.
  await dialog.getByRole("tab", { name: "Documents" }).click();
  const docs = dialog.getByTestId("signup-docs-staff");
  for (const name of REQUIRED) {
    await expect(docs.locator("li").filter({ hasText: name }).getByTestId("doc-badge-awaiting")).toBeVisible();
  }
  await expect(docs.locator("li").filter({ hasText: "GST / tax registration" }).getByTestId("doc-badge-not_requested")).toBeVisible();
  await expect(dialog.getByText(/Waiting for the founder to attach documents/)).toBeVisible();

  // Agreement: the mapped template, the editable method, the picker.
  await dialog.getByRole("tab", { name: "Agreement" }).click();
  await expect(dialog.getByTestId("stage-Initiate")).toContainText("Link emailed · Incubation Agreement");
  await expect(dialog.getByTestId("method-editable")).toBeVisible();
  await dialog.getByLabel("eSign provider").selectOption("DocuSign");
  await expect(dialog.getByLabel("eSign provider")).toHaveValue("DocuSign");
  await dialog.getByLabel("Authorised signatory").selectOption({ label: "Program Manager (any)" });
  await expect(dialog.getByLabel("Authorised signatory")).toHaveValue("role:program_manager");

  // The associate is not that signatory, and the founder has not signed: the
  // verify stage is still pending, so no countersign is offered anywhere.
  await expect(dialog.getByRole("button", { name: /Countersign/ })).toHaveCount(0);
});

test("PM, unassigned — the workspace is read-only, and the API refuses the write", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, PM);
  const dialog = await openWorkspace(page);
  await expect(dialog.getByTestId("workspace-read-only")).toContainText(
    "Read-only — a Super user or Admin hasn't assigned you to this sign-up yet. You can view, but not act.",
  );
  await expect(dialog.getByLabel("eSign provider")).toBeDisabled();
  // Not a disabled button: the verb itself is refused.
  const refused = await page.request.put(`/api/esign/signups/${signupId}/signatory`, { data: { role: "superuser" } });
  expect(refused.status()).toBe(403);
  expect(((await refused.json()) as { error: string }).error).toBe("read_only");
  expect((await page.request.post(`/api/signups/${signupId}/documents/verify-all`)).status()).toBe(403);
});

test("admin — assigns the Program Manager to this sign-up", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, ADMIN);
  const dialog = await openWorkspace(page);
  await dialog.getByLabel("Assigned program manager").selectOption({ label: "Raj Kumar" });
  await expect(dialog.getByLabel("Assigned program manager")).toHaveValue("inc_pm");
});

test("founder — attaches every requested document and signs", async ({ page }) => {
  test.setTimeout(150_000);
  await login(page, FOUNDER);
  await page.goto("/app/founder-signup");
  const card = page.getByTestId(`founder-signup-${signupId}`);
  await expect(card).toBeVisible(NAV);
  await expect(card.getByTestId("founder-method")).toContainText("Sign with DocuSign");
  await expect(card.getByTestId("founder-method")).toContainText("Alternatives your team enabled: in-app signature, print & upload");

  const rows = card.getByTestId("signup-docs-founder");
  // The optional item the team never requested has nothing to attach.
  await expect(rows.getByLabel("Attach GST / tax registration")).toHaveCount(0);
  for (const name of REQUIRED) {
    await rows.getByLabel(`Attach ${name}`).setInputFiles(SAMPLE_DECK);
    await expect(rows.locator("li").filter({ hasText: name }).getByText("Attached")).toBeVisible();
  }

  await card.getByLabel("Type your full name to sign").fill("Meera Sharma");
  await card.getByRole("button", { name: "Sign with DocuSign" }).click();
  await expect(card.getByText("Signed by the founder — submitted to the team.")).toBeVisible();
  await expect(card.getByText(/The team will countersign/)).toBeVisible();
});

test("PM, assigned — the method is locked, documents verify, countersign onboards the deck", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, PM);
  const dialog = await openWorkspace(page);
  await expect(dialog.getByTestId("workspace-read-only")).toHaveCount(0);

  // The founder signed: the method card has collapsed to its locked line.
  const locked = dialog.getByTestId("method-locked");
  await expect(locked).toContainText("DocuSign · Standard e-signature · fallback: in-app, print/scan");
  await expect(locked).toContainText("Signing method locked — founder has signed");
  await expect(dialog.getByLabel("eSign provider")).toHaveCount(0);

  // The shared set, as staff see it now: four Submitted.
  await dialog.getByRole("tab", { name: "Documents" }).click();
  const docs = dialog.getByTestId("signup-docs-staff");
  for (const name of REQUIRED) {
    await expect(docs.locator("li").filter({ hasText: name }).getByTestId("doc-badge-submitted")).toBeVisible();
  }
  await dialog.getByRole("button", { name: "Verify all documents" }).click();
  await expect(dialog.getByText("All required documents verified.")).toBeVisible();
  for (const name of REQUIRED) {
    await expect(docs.locator("li").filter({ hasText: name }).getByTestId("doc-badge-verified")).toBeVisible();
  }

  // The PM holds the assigned role grant, so the gate offers the button.
  await dialog.getByRole("tab", { name: "Agreement" }).click();
  await expect(dialog.getByTestId("stage-Verify & countersign")).toContainText("Founder signed ✓ via DocuSign");
  await dialog.getByRole("button", { name: "Countersign & complete" }).click();
  await expect(dialog.getByTestId("workspace-status")).toHaveText("Sign-up completed");
  await expect(dialog.getByText("Countersigned by Raj Kumar")).toBeVisible();
  await expect(dialog.getByTestId("seat-allocated")).toHaveText("Seat allocated · founder access provisioned");

  // …and the deck has left sign-up for onboarding.
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.goto("/app/incuration");
  await expect(page.getByRole("heading", { name: "Sign up Pipeline" })).toBeVisible(NAV);
  await expect(pipelineRow(page)).toHaveCount(0);
  await page.goto("/app/curation");
  await expect(pipelineRow(page)).toBeVisible(NAV);
});

test.afterAll(async ({ baseURL }) => {
  // Restore the programme checklist to the default's shape (Bank optional).
  // Its seat stays taken: the startup did sign up.
  const admin = await api(baseURL!, ADMIN);
  const body = (await (await admin.get(`/api/signup-config/documents?programId=${PROGRAM.id}`)).json()) as {
    inherited: boolean;
    items: { id: string; name: string; note: string | null; mandatory: boolean }[];
  };
  if (!body.inherited) {
    await admin.put("/api/signup-config/documents", {
      data: {
        programId: PROGRAM.id,
        cohortId: null,
        applyTo: "new",
        items: body.items.map((i) => ({ ...i, mandatory: i.name === "Bank account details" ? false : i.mandatory })),
      },
    });
  }
  await admin.dispose();
});
