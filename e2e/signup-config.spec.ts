import { test, expect, type Page } from "@playwright/test";

/**
 * Admin console → Sign-up (W5-A): **Required documents**, **Seat capacity**
 * (incubator) and **Fund Deployment** (VC).
 *
 * The journey the prototypes depict, walked end to end:
 *
 *   `s-sudocs` — an admin sees the five-item checklist, turns an item
 *   mandatory, saves, and finds it still mandatory on a fresh load; then walks
 *   one document up the lifecycle and is refused the skip.
 *
 *   `s-suseat` — the three seeded cohorts with their utilisation bars, an
 *   over-capacity edit that WARNS rather than blocks, and a save that sticks.
 *
 *   `s-sufund` — the fund table with its third figure, and the ±0.5 Cr
 *   reconciliation warning appearing as a figure is mistyped.
 *
 * Both halves WRITE, so each test restores what it found — `e2e/parity.spec.ts`
 * walks the same database. Serial for the same reason `crm-sync.spec.ts` is:
 * every test here touches the same rows and the project runs `fullyParallel`.
 */
test.describe.configure({ mode: "serial" });

/**
 * ── THE INCUBATOR WALKS ARE BACK 23-Oct-2026 · tracker row 10 ───────────────
 *
 * Feedback row 11 hid the Admin console's whole **Sign-up group** on 24-Sep and
 * these walks were skipped one test at a time on 30-Sep, because `openSection`
 * reaches each section through `/app/admin?section=…` and a hidden id resolves
 * to Scoring framework. Row 10 of the 23-Oct tracker asked for the group back,
 * so the incubator's five walks — `sudocs` ×3 and `suseat` ×2 — run again,
 * unchanged: they were the proof, before un-hiding, that the screens still work.
 *
 * **The VC walk of `sufund` stays skipped.** The group is back in the incubator
 * rail only: the VC edition is out of scope (client, 2026-10-01) and keeps the
 * rail it has (`HIDDEN_ADMIN_GROUPS` in `src/client/routes/admin/sections.ts`
 * is now per edition), so `?section=sufund` still resolves to Scoring framework
 * for the VC admin.
 *
 * The API pair at the foot of the file stays live in both editions — it is the
 * only browser proof that the VC's `/api/signup-config/fund` still serves with
 * its section hidden, and the only one that the `wrong_edition` refusal names
 * the section it refuses.
 */

const INC_ADMIN = "nisha.kapoor@demo.startupjury.ai";
const VC_ADMIN = "nisha.kapoor.vc@demo.startupjury.ai";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

async function openSection(page: Page, email: string, section: string, title: string) {
  await login(page, email);
  await page.goto(`/app/admin?section=${section}`);
  await expect(page.getByTestId("admin-section-title")).toHaveText(title);
  await expect(page.getByRole("heading", { level: 2, name: title })).toBeVisible();
}

const save = (page: Page) => page.getByRole("button", { name: /Save changes/ });

// ── Required documents ───────────────────────────────────────────────────────

test("the checklist renders the prototype's five items with their mandatory toggles", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openSection(page, INC_ADMIN, "sudocs", "Required documents");

  await expect(page.getByText("Mandatory when ON")).toBeVisible();
  for (const [name, mandatory] of [
    ["Certificate of incorporation", "true"],
    ["Founder ID proof", "true"],
    ["Cap table", "true"],
    ["Bank account details", "false"],
    ["GST / tax registration", "false"],
  ] as const) {
    await expect(page.getByRole("switch", { name: `${name} mandatory` })).toHaveAttribute(
      "aria-checked",
      mandatory,
    );
  }
  // The scope card's two selects, and the per-sign-up footer note.
  await expect(page.getByLabel("Program")).toBeVisible();
  await expect(page.getByLabel("Applies to")).toBeVisible();
  await expect(page.getByText(/this list is the per-program default/)).toBeVisible();
});

test("turning an item mandatory saves and survives a reload", async ({ page }) => {
  test.setTimeout(120_000);
  await openSection(page, INC_ADMIN, "sudocs", "Required documents");
  const toggle = page.getByRole("switch", { name: "GST / tax registration mandatory" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");

  // "New sign-ups only" leaves the open sign-ups alone, which keeps this spec
  // from mutating the document sets the lifecycle test below reads.
  await page.getByLabel("Applies to").selectOption("new");
  await expect(save(page)).toBeDisabled();
  await toggle.click();
  await expect(save(page)).toBeEnabled();
  await save(page).click();
  await expect(page.getByText(/Checklist saved/)).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole("switch", { name: "GST / tax registration mandatory" }),
  ).toHaveAttribute("aria-checked", "true");

  // Restore.
  await page.getByLabel("Applies to").selectOption("new");
  await page.getByRole("switch", { name: "GST / tax registration mandatory" }).click();
  await save(page).click();
  await expect(page.getByText(/Checklist saved/)).toBeVisible();
});

test("a document walks the lifecycle one step at a time, and the skip is refused", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openSection(page, INC_ADMIN, "sudocs", "Required documents");

  const set = page.getByTestId("signup-set-su_inc_deck_medixir");
  await expect(set).toBeVisible();

  // Which row to walk is chosen by its badge, but the row is then PINNED BY
  // NAME. `verified` is terminal by design, so this walk cannot restore what it
  // moves and a second pass over the same database would find a named item
  // already finished — hence the dynamic choice. But a locator defined by the
  // badge is a locator defined by the very thing each click changes: the first
  // `Request` flips `not_requested` to `awaiting`, the filter stops matching,
  // and the row silently becomes a different row. The name never changes.
  //
  // 0034's back-fill leaves exactly the OPTIONAL items at `not_requested`, so
  // those are the candidates.
  const OPTIONAL = ["Bank account details", "GST / tax registration"];
  let name: string | null = null;
  for (const candidate of OPTIONAL) {
    const row = set.locator("li").filter({ hasText: candidate }).first();
    if ((await row.getByTestId("doc-badge-not_requested").count()) > 0) {
      name = candidate;
      break;
    }
  }
  test.skip(name === null, "every optional document on this sign-up has already been requested");
  const item = set.locator("li").filter({ hasText: name! }).first();

  // not_requested offers Request and nothing else — no skip is on offer.
  await expect(item.getByRole("button")).toHaveText(["Request"]);

  await item.getByRole("button", { name: "Request" }).click();
  await expect(item.getByTestId("doc-badge-awaiting")).toHaveText("Awaiting");
  await expect(item.getByRole("button")).toHaveText(["Stand down", "Mark submitted"]);

  await item.getByRole("button", { name: "Mark submitted" }).click();
  await expect(item.getByTestId("doc-badge-submitted")).toHaveText("Submitted");
  // Still no Verify-by-skip anywhere earlier: the only two moves offered here
  // are the send-back and the verify.
  await expect(item.getByRole("button")).toHaveText(["Send back", "Verify"]);

  await item.getByRole("button", { name: "Verify" }).click();
  await expect(item.getByTestId("doc-badge-verified")).toHaveText("Verified");
  // Verified is terminal: the row offers no further move at all.
  await expect(item.getByRole("button")).toHaveCount(0);
});

// ── Seat capacity ───────────────────────────────────────────────────────────

test("seat capacity draws the seeded cohorts, and over capacity warns without blocking", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openSection(page, INC_ADMIN, "suseat", "Seat capacity");

  await expect(page.getByRole("columnheader")).toHaveText([
    "Program / cohort",
    "Seat capacity",
    "Seats filled",
    "Utilisation",
    "",
  ]);
  await expect(page.getByText(/Sign-up is never blocked by seats/)).toBeVisible();
  await expect(page.getByTestId("seat-note")).toContainText(
    "Startups that complete sign-up without a seat are flagged seatless",
  );

  // 0036's seed: Climate Cohort · Cohort 6 is 20 / 18.
  await expect(page.getByTestId("seat-util-coh_0001-pct")).toHaveText("90%");
  const filled = page.getByLabel("Climate Cohort · Cohort 6 seats filled");
  await filled.fill("23");
  await expect(page.getByTestId("seat-note")).toContainText(
    "Over capacity: Climate Cohort · Cohort 6 (23/20). Sign-up still proceeds",
  );

  await expect(save(page)).toBeEnabled();
  await save(page).click();
  await expect(page.getByText(/Seat settings saved/)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Climate Cohort · Cohort 6 seats filled")).toHaveValue("23");

  // Restore the seeded 18.
  await page.getByLabel("Climate Cohort · Cohort 6 seats filled").fill("18");
  await save(page).click();
  await expect(page.getByText(/Seat settings saved/)).toBeVisible();
});

test("the seatless queue reports an all-clear on the seeded workspace", async ({ page }) => {
  test.setTimeout(120_000);
  await openSection(page, INC_ADMIN, "suseat", "Seat capacity");
  await expect(page.getByTestId("seatless-note")).toHaveText(
    "Every completed sign-up holds a cohort seat.",
  );
});

// ── Fund Deployment ─────────────────────────────────────────────────────────
//
// STILL SKIPPED after 23-Oct: `sufund` is the VC build's section, and the VC
// rail keeps the Sign-up group hidden (the edition is out of scope — see the
// header). Un-skip with `vc: []` in `HIDDEN_ADMIN_GROUPS`, not before.

test.skip("fund deployment draws the third figure and reconciles, then warns when it does not", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openSection(page, VC_ADMIN, "sufund", "Fund Deployment");

  await expect(page.getByRole("columnheader")).toHaveText([
    "Program / fund",
    "Allotted (₹ Cr)",
    "Deployed (₹ Cr)",
    "Unutilised (₹ Cr)",
    "Utilisation",
    "",
  ]);
  await expect(page.getByLabel("Fund II allotted")).toHaveValue("210");
  await expect(page.getByLabel("Fund II deployed")).toHaveValue("92");
  await expect(page.getByLabel("Fund II unutilised")).toHaveValue("118");
  await expect(page.getByTestId("fund-recon")).toHaveText(
    "Deployed + unutilised reconciles with allotted for every program.",
  );

  // Mistype the third figure: the section's only validation speaks up.
  await page.getByLabel("Fund II unutilised").fill("130");
  await expect(page.getByTestId("fund-recon")).toContainText(
    "Deployed + unutilised doesn't match allotted for: Fund II (+12 Cr). Adjust so they reconcile.",
  );

  // …and it is advisory, not a gate — the save goes through.
  await save(page).click();
  await expect(page.getByText(/Fund deployment saved/)).toBeVisible();
  await expect(page.getByTestId("fund-recon")).toContainText("doesn't match allotted");

  // Restore the reconciling seed.
  await page.getByLabel("Fund II unutilised").fill("118");
  await save(page).click();
  await expect(page.getByTestId("fund-recon")).toHaveText(
    "Deployed + unutilised reconciles with allotted for every program.",
  );
});

// ── REWRITTEN for row 11; re-titled 23-Oct when the incubator walks came back ─
//
// It used to walk each edition's fourth Sign-up section — `suseat` Seat capacity
// in the incubator, `sufund` Fund Deployment in the VC build — to prove the
// console resolves that one entry per edition. Hiding the group left that check
// no subject on screen; the swap itself still lives in `allAdminSections()` and
// is asserted in `test/client/adminConsole.test.tsx`.
//
// What replaced it: the SECTIONS were hidden, the ROUTES were not. Since 23-Oct
// that is still true of the VC build, whose group stays hidden, and this pair is
// the only browser proof that its `/fund` still serves. In the incubator the
// walks above now reach the same routes through the screens; the pair keeps the
// `wrong_edition` refusal pinned for both. Per edition, because the config is
// edition-resolved on the server too.
//
// One test per edition, NOT one test that signs in twice: a second `login()` on
// an already-authenticated page navigates to /login, gets redirected straight
// back into /app, and waits forever for an email field that never renders.
const EDITIONS = [
  { edition: "incubator", email: INC_ADMIN, own: "seats", other: "fund", otherSection: "sufund" },
  { edition: "vc", email: VC_ADMIN, own: "fund", other: "seats", otherSection: "suseat" },
] as const;

for (const e of EDITIONS) {
  test(`the ${e.edition} sign-up config API serves /${e.own} and refuses /${e.other}`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await login(page, e.email);

    // The checklist both editions share.
    const docs = await page.request.get("/api/signup-config/documents");
    expect(docs.status(), await docs.text()).toBe(200);
    expect(((await docs.json()) as { items: unknown[] }).items.length).toBeGreaterThan(0);

    // …and the edition's own half of the fourth section.
    const own = await page.request.get(`/api/signup-config/${e.own}`);
    expect(own.status(), await own.text()).toBe(200);

    // The other edition's half is still refused 403 `wrong_edition` and still
    // names the SECTION it is refusing — `requireIncubator` / `requireVc`,
    // `src/server/routes/signup-config.ts:795-807`. That reason string is now
    // the only place the phrase "not in the rail" is load-bearing for a section
    // that is not in ANY rail, so it is worth pinning rather than loosening.
    const other = await page.request.get(`/api/signup-config/${e.other}`);
    expect(other.status()).toBe(403);
    expect(await other.json()).toEqual({ error: "wrong_edition", section: e.otherSection });
  });
}
