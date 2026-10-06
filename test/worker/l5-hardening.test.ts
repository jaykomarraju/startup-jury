import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { addDeckVersion, isPdf, isPdfContent, reserveCredits } from "../../src/server/decks/versions";
import { recordSyncAttempt } from "../../src/server/crm/provider";
import type { Env } from "../../src/server/types";
import { DEFAULT_TENANT_ID, type TenantScope } from "../../src/shared/tenant";

/**
 * LANE L5 — THREE MEASURED DEFECTS, EACH ONE SMALL AND EACH ONE REAL.
 *
 * The fourth (migration `0105`, the two `authorised_signatories` indexes `0101`
 * missed) belongs in `test/worker/tenant-scope.test.ts`, because its absence there is
 * the reason it survived: that file is the one place this repo asserts isolation, and
 * a defect it cannot see is a defect nobody looks for twice. The three here have no
 * such home, so they get one.
 *
 *   1. §A  `GET /api/messages?scope=team` returned the STAFF channel to every session
 *          that held a cookie — founders and mentors included.
 *   2. §B  the upload gate read the file NAME, so a renamed text file and a 0-byte
 *          file both reserved a credit, wrote an R2 object and spent four model calls.
 *   3. §C  two notification producers held a `TenantScope` and passed only its
 *          `edition`, so a second customer's alert was filed in the first's workspace.
 *
 * They are tested together because they are one patch, and because §B and §C share a
 * second customer's workspace to be wrong about. Three of these cases would pass
 * vacuously against a one-tenant database (`tenant-probe-vacuity`), so §C builds its
 * own tenant rather than asserting on `t_default` and hoping.
 */

const BASE = "https://example.com";

// Seeded incubator principals, by what each one is here to prove.
const ADMIN = "nisha.kapoor@demo.startupjury.ai"; //  staff — the positive control
const JURY = "rajesh.kumar@demo.startupjury.ai"; //   staff — the LOWEST internal role
const PA = "sunita.rao@demo.startupjury.ai"; //       staff — uploads decks
const FOUNDER = "meera.sharma@demo.startupjury.ai"; // EXTERNAL — the case that matters
const MENTOR = "anil.mehta@demo.startupjury.ai"; //   a directory record, no screens

/** The seeded team message (`0008_seed_analytics.sql:132`) — what must not escape. */
const TEAM_MESSAGE = "Cohort 6 intro calls are scheduled for next week";

/** A SECOND customer, built by this file. §C is vacuous without one. */
const OTHER = "t_l5_other";
const OTHER_ADMIN_ID = "l5_other_admin";
const OTHER_ADMIN_EMAIL = "admin@l5other.test";
const OTHER_SCOPE: TenantScope = { tenantId: OTHER, edition: "incubator" };
const A_SCOPE: TenantScope = { tenantId: DEFAULT_TENANT_ID, edition: "incubator" };

const E = () => env as unknown as Env;

async function login(email: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo1234" }),
  });
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

const get = (path: string, cookie: string) => SELF.fetch(`${BASE}${path}`, { headers: { cookie } });

const post = (path: string, cookie: string, body: unknown) =>
  SELF.fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

// ── §A · the team channel ────────────────────────────────────────────────────

describe("L5 · the team channel is staff-only", () => {
  /**
   * The defect, measured 2026-10-01: `messages.use("*", requireAuth)` was the whole
   * of the authorisation, and `sharedView = channel === "team" || isAdmin` then SKIPS
   * the per-user predicate for the team channel — so the widest list in the workspace
   * was the one an unauthorised caller got. A **mentor**, whose `/api/decks` and
   * `/api/notifications` are both 403, read the seeded team message verbatim.
   */
  it("a FOUNDER cannot read it, and does not get the message in a 200 either", async () => {
    // The founder leads because the founder is the external party the pilot hands
    // accounts to. The team channel is where staff discuss the founder's own
    // application; `shared/nav.ts:228-229` has excluded `founder` from both Collaborate
    // items in both editions all along, and only the client was reading that line.
    const cookie = await login(FOUNDER);
    expect(cookie, "the seeded founder could not sign in — this case proves nothing").toBeTruthy();

    const res = await get("/api/messages?scope=team", cookie);
    expect(res.status).toBe(403);
    // Belt and braces, and not redundant: a route that answered 200 with an empty
    // list would also satisfy the line above if it were only checking the body, and
    // one that answered 403 with the rows still serialised would satisfy a status-only
    // check. Assert both, because this is the shape the leak had.
    expect(await res.text()).not.toContain(TEAM_MESSAGE);
  });

  it("a MENTOR cannot read EITHER channel — it holds no Collaborate screen at all", async () => {
    // `denyMentor`, not the channel gate: a mentor is a directory record with no nav
    // item, so the admin arm is no more theirs than the team arm. This is the
    // measurement from the defect report, now refused.
    const cookie = await login(MENTOR);
    expect(cookie).toBeTruthy();
    const team = await get("/api/messages?scope=team", cookie);
    expect(team.status).toBe(403);
    expect(await team.text()).not.toContain(TEAM_MESSAGE);
    expect((await get("/api/messages?scope=admin", cookie)).status).toBe(403);
    expect((await post("/api/messages", cookie, { toScope: "admin", body: "hi" })).status).toBe(403);
  });

  it("a founder cannot WRITE to it either, and the refusal leaves no row", async () => {
    // Refused rather than silently re-addressed to `admin`: a note that lands
    // somewhere other than where it was aimed has lied to its sender, and the row
    // would then sit in a channel they cannot read back.
    const cookie = await login(FOUNDER);
    const before = await teamMessageCount();
    const res = await post("/api/messages", cookie, { toScope: "team", body: "L5 founder probe" });
    expect(res.status).toBe(403);
    expect(await teamMessageCount(), "the refused POST still wrote a row").toBe(before);
  });

  it("NEGATIVE CONTROL — the lowest internal role still has the whole channel", async () => {
    // Without this the §A fixes could be a blanket 403 and the suite would not notice.
    // `jury` is deliberately the control rather than `admin`: an admin passes through
    // `isAdmin` as well, so it cannot tell a staff-role gate from an admin-only one.
    const cookie = await login(JURY);
    const res = await get("/api/messages?scope=team", cookie);
    expect(res.status).toBe(200);
    const d = (await res.json()) as { messages: { body: string }[]; inbox: boolean };
    expect(d.inbox, "a staff reader of the team channel sees sender names").toBe(true);
    expect(d.messages.some((m) => m.body.includes(TEAM_MESSAGE))).toBe(true);

    const sent = await post("/api/messages", cookie, { toScope: "team", body: "L5 staff probe" });
    expect(sent.status).toBe(200);
  });

  it("NEGATIVE CONTROL — the founder's own support channel is untouched", async () => {
    // The `admin` arm must stay open to a founder: it is how they reach the
    // organisation at all, and they see only what they themselves sent. Closing it
    // would be a worse regression than the leak, and a quieter one.
    const cookie = await login(FOUNDER);
    const sent = await post("/api/messages", cookie, {
      toScope: "admin",
      body: "L5 founder support probe",
    });
    expect(sent.status).toBe(200);

    const res = await get("/api/messages?scope=admin", cookie);
    expect(res.status).toBe(200);
    const d = (await res.json()) as { messages: { body: string }[]; inbox: boolean };
    expect(d.messages.some((m) => m.body === "L5 founder support probe")).toBe(true);
    // Their own sent list, not the admins' inbox — the per-user predicate still runs.
    expect(d.inbox).toBe(false);
    expect(d.messages.some((m) => m.body.includes(TEAM_MESSAGE))).toBe(false);
  });

  it("NEGATIVE CONTROL — an admin still reads the inbox, so no arm was widened", async () => {
    const cookie = await login(ADMIN);
    const inbox = await get("/api/messages?scope=admin", cookie);
    expect(inbox.status).toBe(200);
    expect(((await inbox.json()) as { inbox: boolean }).inbox).toBe(true);
    expect((await get("/api/messages?scope=team", cookie)).status).toBe(200);
  });
});

async function teamMessageCount(): Promise<number> {
  return (
    await env.DB.prepare("SELECT count(*) n FROM messages WHERE to_scope = 'team'").first<{
      n: number;
    }>()
  )!.n;
}

// ── §B · the upload gate ─────────────────────────────────────────────────────

/** `%PDF-1.4` and a little body — what a browser actually sends. */
const realPdf = (name = "deck.pdf") =>
  new File([new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF")], name, {
    type: "application/pdf",
  });

describe("L5 · an upload must BE a PDF, not merely be called one", () => {
  it("isPdf refuses a 0-byte file, which is the half that needs no await", async () => {
    // 0 bytes is the one bad input that cannot be told from a good one by reading
    // bytes, so it is refused synchronously — which closes it at all four existing
    // call sites (single upload, bulk loop, authenticated re-upload, public resubmit)
    // without any of them changing a line.
    expect(isPdf(new File([], "empty.pdf", { type: "application/pdf" }))).toBe(false);
    expect(isPdf(new File([], "empty.pdf"))).toBe(false);
    expect(isPdf(realPdf())).toBe(true);
    // And the name/type rule it already had is unchanged.
    expect(isPdf(new File([new Uint8Array([1])], "notes.txt", { type: "text/plain" }))).toBe(false);
    expect(isPdf("deck.pdf")).toBe(false);
  });

  it("isPdfContent refuses a renamed file, however convincing its name and type", async () => {
    const renamed = new File([new TextEncoder().encode("Dear investor, our runway is…")], "deck.pdf", {
      type: "application/pdf",
    });
    // `isPdf` is satisfied — this is exactly the file that used to reach the model.
    expect(isPdf(renamed)).toBe(true);
    expect(await isPdfContent(renamed)).toBe(false);

    expect(await isPdfContent(realPdf())).toBe(true);
    // Shorter than the signature: the length guard, not a byte comparison against
    // `undefined`.
    expect(await isPdfContent(new File([new Uint8Array([37, 80])], "two.pdf"))).toBe(false);
    expect(await isPdfContent(new File([], "none.pdf"))).toBe(false);
    // A near miss, which is the case a `startsWith` on decoded text could get wrong.
    expect(await isPdfContent(new File([new TextEncoder().encode("%PDG-1.4")], "x.pdf"))).toBe(false);
  });

  it("reading the signature leaves the file whole — a 50 MB deck is not buffered twice", async () => {
    // The trap this pins: if a `File` off `formData()` were backed by a CONSUMABLE
    // stream, the four-byte slice would eat the head and `addDeckVersion`'s
    // `args.file.arrayBuffer()` would store a truncated — or empty — object in R2,
    // with no error anywhere. Verified rather than assumed, because the failure is
    // silent and lands in the customer's bucket.
    const file = realPdf();
    expect(await isPdfContent(file)).toBe(true);
    const whole = new TextDecoder().decode(await file.arrayBuffer());
    expect(whole.startsWith("%PDF-1.4")).toBe(true);
    expect(whole).toContain("%%EOF");
    expect(whole.length).toBe(file.size);
  });

  it("a 0-byte deck is refused by the route BEFORE a credit moves", async () => {
    const cookie = await login(PA);
    const before = await creditsOf(A_SCOPE);
    const ledger = await ledgerCount(DEFAULT_TENANT_ID);

    const form = new FormData();
    form.set("file", new File([], "empty.pdf", { type: "application/pdf" }));
    const res = await SELF.fetch(`${BASE}/api/decks/upload`, {
      method: "POST",
      headers: { cookie },
      body: form,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "pdf_required" });

    // The point of the whole defect: the ORDER. `routes/decks.ts:2393` reserves the
    // credit before the model is reached, and `reserveCredits` commits an append-only
    // `credit_ledger` debit that a refund can only ever reverse — so a deck refused
    // after the reservation leaves a matched pair in the usage history for a file
    // that was never a deck.
    expect(await creditsOf(A_SCOPE), "a 0-byte upload still cost a credit").toBe(before);
    expect(await ledgerCount(DEFAULT_TENANT_ID), "a 0-byte upload still wrote a ledger row").toBe(
      ledger,
    );
  });

  it("addDeckVersion refuses a renamed file with pdf_required, and spends nothing", async () => {
    // Both re-upload paths go through here — the authenticated
    // `POST /api/decks/:id/version` and the PUBLIC, unauthenticated tokenized founder
    // resubmit (`routes/resubmit.ts:207`). An unauthenticated caller holding a live
    // link could otherwise burn a customer's credits four model calls at a time.
    const deckId = "inc_deck_finstack";
    const before = await creditsOf(A_SCOPE);
    const versions = await versionCount(deckId);

    const result = await addDeckVersion(E(), {
      deckId,
      edition: "incubator",
      contentVersion: 1,
      file: new File([new TextEncoder().encode("this is not a deck")], "v2.pdf", {
        type: "application/pdf",
      }),
      note: "L5 probe",
      uploadedBy: null,
    });

    expect(result).toEqual({ ok: false, error: "pdf_required" });
    expect(await creditsOf(A_SCOPE), "the refused re-upload still cost a credit").toBe(before);
    expect(await versionCount(deckId), "the refused re-upload still wrote a version row").toBe(
      versions,
    );
    // Nothing reached R2 either, which is the object that could never be deleted.
    expect(await env.DECKS.head("decks/inc_deck_finstack_v2.pdf")).toBeNull();
  });
});

async function creditsOf(scope: TenantScope): Promise<number | null> {
  return (
    (
      await env.DB.prepare(
        "SELECT credits_balance FROM org_settings WHERE tenant_id = ? AND edition = ?",
      )
        .bind(scope.tenantId, scope.edition)
        .first<{ credits_balance: number }>()
    )?.credits_balance ?? null
  );
}

async function ledgerCount(tenantId: string): Promise<number> {
  return (
    await env.DB.prepare("SELECT count(*) n FROM credit_ledger WHERE tenant_id = ?")
      .bind(tenantId)
      .first<{ n: number }>()
  )!.n;
}

async function versionCount(deckId: string): Promise<number> {
  return (
    await env.DB.prepare("SELECT count(*) n FROM deck_versions WHERE deck_id = ?")
      .bind(deckId)
      .first<{ n: number }>()
  )!.n;
}

// ── §C · the two notification producers that dropped the tenant ──────────────

/**
 * Both call sites HELD a `TenantScope` and passed only its `edition` half.
 * `emitNotification` then resolves the workspace through `resolveTenant`
 * (`email/outbox.ts:216-231`): the caller's `scope`, then the tenant of a named
 * `deckId`, then `DEFAULT_TENANT_ID` with a `console.warn`. Neither of these two names
 * a deck, so both fell through to the default — which is not a missing alert but a
 * misdirected one: the SECOND customer's event was written into and mailed from the
 * FIRST customer's workspace, to the first customer's admins, while the customer it
 * actually happened to was told nothing.
 *
 * `t_default` is both the wrong answer and the answer a one-tenant database gives for
 * free, so these two cases are meaningless without a second workspace that has its
 * own admin to receive the alert. That is what `beforeAll` builds.
 */
beforeAll(async () => {
  await env.DB.prepare(
    "INSERT INTO organizations (id, name, slug, status) VALUES (?, 'L5 Other Accelerator', 'l5-other', 'active') " +
      "ON CONFLICT (id) DO NOTHING",
  )
    .bind(OTHER)
    .run();

  // Their own admin, who is `credits_low`'s and `crm_sync_failed`'s audience
  // (`email/outbox.ts:730`) and who heard nothing while the alert went next door.
  // The seeded password hash is reused so nothing here has to mint one.
  await env.DB.prepare(
    "INSERT INTO users (id, tenant_id, name, email, role, edition, initials, password_hash) " +
      "SELECT ?, ?, 'L5 Other Admin', ?, 'admin', 'incubator', 'LA', password_hash FROM users WHERE email = ?",
  )
    .bind(OTHER_ADMIN_ID, OTHER, OTHER_ADMIN_EMAIL, ADMIN)
    .run();

  // 10 credits — exactly `LOW_CREDIT_THRESHOLD`, so reserving ONE crosses the line.
  // The alert fires on the crossing, not on every spend below it.
  await env.DB.prepare(
    "INSERT INTO org_settings (tenant_id, edition, credits_balance) VALUES (?, 'incubator', 10)",
  )
    .bind(OTHER)
    .run();

  // Their CRM connection. `crm_connections` is `UNIQUE (tenant_id, edition, provider)`
  // after `0098`, and connection ids are deterministic (`crm_<edition>_<provider>`),
  // so this id is distinct only by the tenant prefix.
  await env.DB.prepare(
    "INSERT INTO crm_connections (id, tenant_id, edition, provider, status, base_url) " +
      "VALUES ('l5_other_hubspot', ?, 'incubator', 'hubspot', 'live', 'https://l5other.example.com')",
  )
    .bind(OTHER)
    .run();
});

async function alertsFiledUnder(event: string, tenantId: string): Promise<number> {
  return (
    await env.DB.prepare(
      "SELECT count(*) n FROM notifications WHERE event_key = ? AND tenant_id = ?",
    )
      .bind(event, tenantId)
      .first<{ n: number }>()
  )!.n;
}

async function mailedTo(email: string): Promise<number> {
  return (
    await env.DB.prepare("SELECT count(*) n FROM email_outbox WHERE to_email = ?")
      .bind(email)
      .first<{ n: number }>()
  )!.n;
}

describe("L5 · a second customer's alert is filed against that customer", () => {
  it("credits_low reaches the workspace whose balance actually dropped", async () => {
    const strayBefore = await alertsFiledUnder("credits_low", DEFAULT_TENANT_ID);
    const mineBefore = await alertsFiledUnder("credits_low", OTHER);
    // A DELTA rather than an absolute zero: this file's §A and §B run first and
    // nothing in them mails the first customer's admin today, but an absolute
    // assertion would turn any future producer added above into a failure here.
    const strayMailBefore = await mailedTo(ADMIN);

    // 10 → 9. `announceIfCreditsLow` reads the post-reservation balance and alerts on
    // the crossing, so this is the one spend that produces the event.
    const ok = await reserveCredits(E(), OTHER_SCOPE, 1, { note: "L5 scope probe" });
    expect(ok, "the reservation was refused, so no alert could have been produced").toBe(true);
    expect(await creditsOf(OTHER_SCOPE)).toBe(9);

    expect(
      await alertsFiledUnder("credits_low", OTHER),
      "the second customer's own admin was told nothing about their own balance",
    ).toBe(mineBefore + 1);
    expect(
      await alertsFiledUnder("credits_low", DEFAULT_TENANT_ID),
      "the second customer's low-credit alert was filed in the FIRST customer's workspace — " +
        "`scope` is missing at the emitNotification call in decks/versions.ts",
    ).toBe(strayBefore);

    // The mail, not just the bell. This is the half that leaves the building: the
    // first customer's admin must not be told to top up a balance they do not own.
    expect(await mailedTo(OTHER_ADMIN_EMAIL)).toBeGreaterThan(0);
    expect(
      await mailedTo(ADMIN),
      "the first customer's admin was mailed about a balance they do not own",
    ).toBe(strayMailBefore);
  });

  it("crm_sync_failed reaches the workspace whose integration actually broke", async () => {
    const strayBefore = await alertsFiledUnder("crm_sync_failed", DEFAULT_TENANT_ID);
    const mineBefore = await alertsFiledUnder("crm_sync_failed", OTHER);

    // `ADAPTERS` is empty by design (§1.3), so `status='failed'` is only reachable
    // through the injected client seam — the same seam `notifications.test.ts:386`
    // uses for this producer. A pull names no deck, which is why `resolveTenant`'s
    // second arm could not save this call site.
    const record = await recordSyncAttempt(
      E(),
      OTHER_SCOPE,
      {
        connectionId: "l5_other_hubspot",
        provider: "hubspot",
        operation: "pull_deals",
        direction: "pull",
        recordCount: 0,
        payload: { limit: 10 },
      },
      { credentialRef: null },
      undefined,
      {
        provider: "hubspot",
        pullDeals: async () => {
          throw new Error("upstream 503");
        },
        writeBack: async () => undefined,
      },
    );
    expect(record.status, "the adapter did not fail, so no alert was produced").toBe("failed");

    expect(
      await alertsFiledUnder("crm_sync_failed", OTHER),
      "the customer whose CRM stopped syncing was not told",
    ).toBe(mineBefore + 1);
    expect(
      await alertsFiledUnder("crm_sync_failed", DEFAULT_TENANT_ID),
      "the alert was filed in the FIRST customer's workspace — `scope` is missing at the " +
        "emitNotification call in crm/provider.ts, and its admins were told a connection " +
        "they do not own had broken",
    ).toBe(strayBefore);

    // And the sync log row itself is still theirs, which `insertScope` already did —
    // asserted so a change to one does not quietly move the other.
    const logRow = await env.DB.prepare(
      "SELECT tenant_id FROM crm_sync_log WHERE id = ?",
    )
      .bind(record.id)
      .first<{ tenant_id: string }>();
    expect(logRow?.tenant_id).toBe(OTHER);
  });
});
