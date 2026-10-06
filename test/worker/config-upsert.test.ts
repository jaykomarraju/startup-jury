import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { hashPassword } from "../../src/server/auth/password";

/**
 * THE CONFIG WRITES THAT RETURNED 200 AND PERSISTED NOTHING
 * ========================================================
 *
 * `plan_pilot_gcw.md` §7 item 8: seven statements in `src/server/routes/config.ts`
 * were bare `UPDATE … WHERE tenant_id = ? AND edition = ?` with no upsert and no
 * `changes` check, and four of them echoed the request back as the response. On a
 * workspace whose `org_settings` / `org_scoring_settings` row does not exist they
 * matched zero rows, the screen said "Saved", and the reload showed the old value.
 *
 * MEASURED on production's `(t_default, incubator)`: `POST /api/config/credits`
 * returned `{"creditsBalance":50}` and wrote a `+50 credit_ledger` row while
 * `org_settings` had no row at all — the books and the gate disagreed permanently,
 * with nothing logged, and the next upload was 402.
 *
 * ── WHY THIS FILE EXISTS AND `config.test.ts` DID NOT CATCH IT ───────────────
 *
 * Every existing case runs as the SEEDED admin against `(t_default, incubator)`,
 * whose two rows `0002_seed.sql:11` and `0026:52` created. A bare `UPDATE` is
 * correct there, so the suite was green and stayed green. **The assertion whose
 * absence let this ship is "a save against a workspace with NO row".** So this file
 * stands up a second customer with an administrator and no settings rows at all,
 * and drives the seven routes through HTTP exactly as the console does.
 *
 * ── THE NEGATIVE CONTROL, WHICH IS NOT OPTIONAL HERE ────────────────────────
 *
 * `migrations/0101`'s header measured that a conflict target naming the WRONG
 * uniqueness constraint does not fail — it resolves to the other tenant's row and
 * overwrites it, 200 and no error. An upsert sweep is exactly the change that can
 * reintroduce that, so every case below also asserts that `(t_default, incubator)`
 * — which holds the seeded values the rest of the suite depends on — is untouched.
 * A test that only checked tenant B's row would pass against code that had just
 * destroyed tenant A's.
 */

const BASE = "https://example.com";

/** The second customer. No `org_settings`, no `org_scoring_settings`, by design. */
const TENANT_B = "t_l6cfg";
const TENANT_B_SLUG = "l6-config-probe";
const ADMIN_B = "l6admin@l6configprobe.test";
const ADMIN_B_ID = "l6_admin";
const PASSWORD = "l6-probe-pw";

/** The seeded workspace every other suite in this directory depends on. */
const TENANT_A = "t_default";

async function login(email: string, password: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  expect(res.status, `login ${email}`).toBe(200);
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

function req(method: string, path: string, cookie: string, body?: unknown) {
  return SELF.fetch(`${BASE}${path}`, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const get = (path: string, cookie: string) => SELF.fetch(`${BASE}${path}`, { headers: { cookie } });

interface SettingsRow {
  plan: string;
  credits_balance: number;
  branding_json: string;
  ai_system_prompt: string | null;
  threshold_best: number;
  threshold_mediocre: number;
  criteria_version: number;
}

function settingsRow(tenant: string): Promise<SettingsRow | null> {
  return env.DB.prepare(
    "SELECT plan, credits_balance, branding_json, ai_system_prompt, threshold_best, " +
      "threshold_mediocre, criteria_version FROM org_settings WHERE tenant_id = ? AND edition = 'incubator'",
  )
    .bind(tenant)
    .first<SettingsRow>();
}

function scoringRow(tenant: string) {
  return env.DB.prepare(
    "SELECT auto_clarification, shortlist_threshold, ai_gate_threshold, ai_weight_pct, score_scale, " +
      "updated_by FROM org_scoring_settings WHERE tenant_id = ? AND edition = 'incubator'",
  )
    .bind(tenant)
    .first<{
      auto_clarification: number;
      shortlist_threshold: number;
      ai_gate_threshold: number;
      ai_weight_pct: number;
      score_scale: string;
      updated_by: string | null;
    }>();
}

/** `sum(delta)` over the ledger — the number the balance column is supposed to equal. */
async function ledgerSum(tenant: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT coalesce(sum(delta), 0) AS total FROM credit_ledger WHERE tenant_id = ? AND edition = 'incubator'",
  )
    .bind(tenant)
    .first<{ total: number }>();
  return row!.total;
}

async function auditActions(tenant: string, action: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT count(*) AS n FROM audit_log WHERE tenant_id = ? AND edition = 'incubator' AND action = ?",
  )
    .bind(tenant, action)
    .first<{ n: number }>();
  return row!.n;
}

let adminB = "";
/** Tenant A's rows as the migrations left them, captured before anything is written. */
let tenantABefore: SettingsRow | null = null;

beforeAll(async () => {
  tenantABefore = await settingsRow(TENANT_A);

  await env.DB.prepare(
    "INSERT INTO organizations (id, name, slug, status) VALUES (?, 'L6 Config Probe', ?, 'active') " +
      "ON CONFLICT (id) DO NOTHING",
  )
    .bind(TENANT_B, TENANT_B_SLUG)
    .run();

  // `hashPassword` rather than a copied seed hash: `auth/password.ts` fixes the
  // format at `pbkdf2$100000$<saltB64>$<hashB64>`, and copying `demo1234`'s hash
  // would make this account's password a different string than the one the test
  // signs in with — a failure that reads as an authorisation bug.
  //
  // `invite_accepted_at` is stamped so the login does not take `auth.ts:161`'s
  // first-sign-in branch, which emits a notification. That path is correct and
  // harmless here (`outbox.ts:903` returns early on zero recipients), but it is not
  // what this file is measuring and a row it wrote would be noise in the audit
  // counts below.
  //
  // `role_permissions` and `seat_capabilities` are deliberately left EMPTY:
  // `plan_pilot_gcw.md` §8 measured that 249 of 249 permission cells agree with the
  // code defaults, so an administrator with no rows at all is authorised exactly as
  // the seeded one is. That is also the state a freshly provisioned customer is in.
  await env.DB.prepare(
    "INSERT INTO users (id, tenant_id, name, email, password_hash, role, edition, initials, " +
      "active, user_type, invite_accepted_at) " +
      "VALUES (?, ?, 'L6 Admin', ?, ?, 'admin', 'incubator', 'LA', 1, 'staff', datetime('now'))",
  )
    .bind(ADMIN_B_ID, TENANT_B, ADMIN_B, await hashPassword(PASSWORD))
    .run();

  adminB = await login(ADMIN_B, PASSWORD);
});

describe("the conflict target these upserts name", () => {
  it("is the composite primary key, and it is the ONLY uniqueness constraint on either table", async () => {
    // `0101`'s header: a conflict target must match a uniqueness constraint
    // EXACTLY, and the `WHERE` of a PARTIAL index is part of that constraint. Name
    // the wrong one and the upsert silently resolves against another tenant's row.
    // So `ON CONFLICT (tenant_id, edition)` is only correct while this holds, and
    // this is the case that fails if a later migration adds a partial unique index
    // to either table — the trap this repo has already been bitten by twice.
    for (const table of ["org_settings", "org_scoring_settings"]) {
      const indexes = (
        await env.DB.prepare(`SELECT name, "unique", origin, partial FROM pragma_index_list('${table}')`).all<{
          name: string;
          unique: number;
          origin: string;
          partial: number;
        }>()
      ).results;
      const uniques = indexes.filter((i) => i.unique === 1);
      expect(uniques, `${table}: expected exactly one uniqueness constraint`).toHaveLength(1);
      expect(uniques[0].origin, `${table}: the unique constraint must be the PRIMARY KEY`).toBe("pk");
      expect(uniques[0].partial, `${table}: a PARTIAL unique index changes the conflict target`).toBe(0);

      const pk = (
        await env.DB.prepare(`SELECT name FROM pragma_table_info('${table}') WHERE pk > 0 ORDER BY pk`).all<{
          name: string;
        }>()
      ).results.map((r) => r.name);
      expect(pk, `${table}: the primary key must be (tenant_id, edition)`).toEqual([
        "tenant_id",
        "edition",
      ]);
    }
  });

  it("neither table carries a `__pre_tenant_key` index for 0101 to have dropped", async () => {
    // These two were rebuilt by 0089/0090 at a time when NO upsert named them, so
    // unlike the five tables of 0091-0095 they never held a transitional key. The
    // route comment says so; this is the assertion behind it.
    const rows = (
      await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE '%__pre_tenant_key'",
      ).all<{ name: string }>()
    ).results.map((r) => r.name);
    expect(rows).not.toContain("org_settings__pre_tenant_key");
    expect(rows).not.toContain("org_scoring_settings__pre_tenant_key");
  });

  it("`SETTINGS_DEFAULTS` matches what the schema actually creates an absent row at", async () => {
    // The route uses those defaults as the "before" of a first save's audit
    // sentence. If a later migration changes a `DEFAULT`, every first-save audit row
    // becomes quietly wrong — so the values are asserted against the database rather
    // than against the constant's own comment. The probe row is inserted with the
    // key alone and read back.
    await env.DB.prepare(
      "INSERT INTO org_settings (tenant_id, edition) VALUES ('t_l6defaults', 'incubator')",
    ).run();
    const row = await settingsRow("t_l6defaults");
    expect(row).toMatchObject({
      plan: "standard",
      credits_balance: 0,
      branding_json: "{}",
      ai_system_prompt: null,
      threshold_best: 7,
      threshold_mediocre: 5,
      criteria_version: 1,
    });
    await env.DB.prepare("DELETE FROM org_settings WHERE tenant_id = 't_l6defaults'").run();
  });
});

describe("a workspace with no settings row — the seven saves", () => {
  it("starts with neither row, which is the state the whole file measures", async () => {
    // Vacuity guard. If a later fixture provisions this tenant's settings, every
    // case below would pass against the old bare-`UPDATE` code.
    expect(await settingsRow(TENANT_B), "org_settings must be absent").toBeNull();
    expect(await scoringRow(TENANT_B), "org_scoring_settings must be absent").toBeNull();
    // And the read routes agree: nothing to read yet.
    expect((await get("/api/config/summary", adminB)).status).toBe(404);
  });

  it("1 · PUT /scoring-framework creates the row and the re-read returns the saved values", async () => {
    const res = await req("PUT", "/api/config/scoring-framework", adminB, {
      autoClarification: true,
      shortlistThreshold: 6.5,
      aiGateThreshold: 4.5,
      // One of `AI_WEIGHT_CHOICES` (40, 30, 50, 0) and NOT the column's default 40,
      // so a stored value that happened to equal the default could not pass this.
      aiWeightPct: 30,
      scoreScale: "1-5",
      visibility: {},
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      scoring: { shortlistThreshold: number; aiGateThreshold: number; aiWeightPct: number; scoreScale: string };
    };
    // The response is the READ-BACK. Before this lane it was the object the route
    // had just computed from the request, which is why a save that stored nothing
    // was indistinguishable from one that stored everything.
    expect(body.scoring).toMatchObject({
      shortlistThreshold: 6.5,
      aiGateThreshold: 4.5,
      aiWeightPct: 30,
      scoreScale: "1-5",
    });

    const row = await scoringRow(TENANT_B);
    expect(row, "the save must have CREATED the row").not.toBeNull();
    expect(row).toMatchObject({
      auto_clarification: 1,
      shortlist_threshold: 6.5,
      ai_gate_threshold: 4.5,
      ai_weight_pct: 30,
      score_scale: "1-5",
      updated_by: ADMIN_B_ID,
    });

    // `ai_gate_threshold` is the one the Dashboard reads for its screening verdicts,
    // so assert it survives the HTTP round trip and not just the column.
    // `/api/config/summary` needs `org_settings`, which this route does not write —
    // except through `bumpCriteriaVersion`, which a score-scale change triggers.
    const stored = await settingsRow(TENANT_B);
    expect(stored, "a composition change bumps criteria_version, which must create the row too").not.toBeNull();
    expect(stored!.criteria_version).toBe(2);
  });

  it("2 · PUT /thresholds creates the row, re-reads, and audits the first save", async () => {
    const before = await auditActions(TENANT_B, "cohort_thresholds_changed");
    const res = await req("PUT", "/api/config/thresholds", adminB, { best: 8.4, mediocre: 5.5 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ thresholdBest: 8.4, thresholdMediocre: 5.5 });

    const row = await settingsRow(TENANT_B);
    expect(row).toMatchObject({ threshold_best: 8.4, threshold_mediocre: 5.5 });
    // The re-read the console does on reload — the step that used to show the old
    // value after a "Saved" badge.
    const summary = (await (await get("/api/config/summary", adminB)).json()) as {
      thresholdBest: number;
      thresholdMediocre: number;
    };
    expect(summary).toMatchObject({ thresholdBest: 8.4, thresholdMediocre: 5.5 });

    // With `?? best` as the "before", `auditThresholds` compared the submitted
    // value against itself and returned early: the first save on a workspace was
    // neither stored nor logged. `SETTINGS_DEFAULTS` is what makes this count move.
    expect(await auditActions(TENANT_B, "cohort_thresholds_changed")).toBe(before + 1);
  });

  it("3 · PUT /ai-prompt persists the prompt and bumps criteria_version", async () => {
    const versionBefore = (await settingsRow(TENANT_B))!.criteria_version;
    const res = await req("PUT", "/api/config/ai-prompt", adminB, {
      prompt: "  Weight carbon integrity heavily.  ",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ aiSystemPrompt: "Weight carbon integrity heavily." });

    const row = await settingsRow(TENANT_B);
    expect(row!.ai_system_prompt).toBe("Weight carbon integrity heavily.");
    // The prompt is part of the scoring criteria, so the batch's second statement
    // has to land as well — it is the eighth upsert, and the one §7 did not list.
    expect(row!.criteria_version).toBe(versionBefore + 1);

    // Clearing it stores NULL and the response says "", from the column.
    const cleared = await req("PUT", "/api/config/ai-prompt", adminB, { prompt: "   " });
    expect(await cleared.json()).toMatchObject({ aiSystemPrompt: "" });
    expect((await settingsRow(TENANT_B))!.ai_system_prompt).toBeNull();
  });

  it("4 · PUT /branding persists and returns the stored branding, not the request", async () => {
    const res = await req("PUT", "/api/config/branding", adminB, {
      branding: { wordmark: "Global Carbon Warriors", accent: "#3f5e2a" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      branding: { wordmark: "Global Carbon Warriors", accent: "#3f5e2a" },
    });
    const row = await settingsRow(TENANT_B);
    expect(JSON.parse(row!.branding_json)).toEqual({
      wordmark: "Global Carbon Warriors",
      accent: "#3f5e2a",
    });
  });

  it("5 · PUT /plan persists the tier and audits the move off the default", async () => {
    const before = await auditActions(TENANT_B, "plan_changed");
    const res = await req("PUT", "/api/config/plan", adminB, { plan: "premium" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ plan: "premium", additionalEnabled: true });
    expect((await settingsRow(TENANT_B))!.plan).toBe("premium");
    // `if (current && …)` recorded nothing for a workspace with no row. The first
    // save IS a change — from `standard`, which is what the upsert creates it at.
    expect(await auditActions(TENANT_B, "plan_changed")).toBe(before + 1);
  });

  it("6 · POST /credits persists the balance AND the ledger agrees with it", async () => {
    // This is the case whose absence cost the most: the measured production failure
    // was a `+50` ledger row behind a column that did not exist.
    const res = await req("POST", "/api/config/credits", adminB, { credits: 50 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ creditsBalance: 50 });

    const row = await settingsRow(TENANT_B);
    expect(row!.credits_balance).toBe(50);
    // THE INVARIANT. `sum(delta)` over the ledger IS the balance's explanation, and
    // this workspace's ledger started empty, so the two must be equal to the credit.
    expect(await ledgerSum(TENANT_B)).toBe(50);

    const ledger = await env.DB.prepare(
      "SELECT delta, reason FROM credit_ledger WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1",
    )
      .bind(TENANT_B)
      .first<{ delta: number; reason: string }>();
    expect(ledger).toMatchObject({ delta: 50, reason: "adjustment" });

    // A SET to a lower number is a negative movement, and the two still agree.
    await req("POST", "/api/config/credits", adminB, { credits: 30 });
    expect((await settingsRow(TENANT_B))!.credits_balance).toBe(30);
    expect(await ledgerSum(TENANT_B)).toBe(30);

    // A no-op SET writes no ledger row — the console posts the current balance on
    // every "Plan & credits" save, so this fires on an ordinary plan change.
    const sumBefore = await ledgerSum(TENANT_B);
    const rows = await env.DB.prepare(
      "SELECT count(*) AS n FROM credit_ledger WHERE tenant_id = ?",
    )
      .bind(TENANT_B)
      .first<{ n: number }>();
    await req("POST", "/api/config/credits", adminB, { credits: 30 });
    expect(await ledgerSum(TENANT_B)).toBe(sumBefore);
    const rowsAfter = await env.DB.prepare(
      "SELECT count(*) AS n FROM credit_ledger WHERE tenant_id = ?",
    )
      .bind(TENANT_B)
      .first<{ n: number }>();
    expect(rowsAfter!.n).toBe(rows!.n);
  });

  it("7 · POST /credits/purchase accumulates onto the stored balance", async () => {
    const before = (await settingsRow(TENANT_B))!.credits_balance;
    const sumBefore = await ledgerSum(TENANT_B);
    const res = await req("POST", "/api/config/credits/purchase", adminB, { credits: 20 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ purchased: 20, creditsBalance: before + 20 });
    expect((await settingsRow(TENANT_B))!.credits_balance).toBe(before + 20);
    expect(await ledgerSum(TENANT_B)).toBe(sumBefore + 20);
  });

  it("the whole sequence left tenant A's seeded row exactly as the migrations wrote it", async () => {
    // THE NEGATIVE CONTROL. `0101` measured that a conflict target naming the wrong
    // uniqueness constraint resolves to the OTHER tenant's row and overwrites it,
    // 200 and no error. Seven upserts have just run as tenant B; tenant A's row has
    // to be byte-identical to what it was before `beforeAll`.
    expect(await settingsRow(TENANT_A)).toEqual(tenantABefore);
  });
});

describe("POST /credits has an upper bound", () => {
  /**
   * `config.ts`'s old `:1310` rejected only non-integers and negatives, and this is
   * the route the console's **Plan & credits** Save actually calls
   * (`ConfigPage.tsx:834`) — the capped `/credits/purchase` has zero callers in the
   * client. Each credit is one deck's worth of real Anthropic calls billed to the
   * operator, and the input has no `max` attribute, so a pasted figure or an extra
   * zero was an unbounded bill.
   *
   * The bound is NOT an `isPlatformOwner` gate on purpose: `PLATFORM_OWNER_EMAILS`
   * is `""` in production and that check fails CLOSED, which would lock the
   * operator out of the only working top-up path on the morning of a demo.
   */
  it("refuses a balance above the ceiling, leaves the balance alone, and audits the attempt", async () => {
    const before = (await settingsRow(TENANT_B))!.credits_balance;
    const sumBefore = await ledgerSum(TENANT_B);
    const refusalsBefore = await auditActions(TENANT_B, "credits_grant_refused");

    const res = await req("POST", "/api/config/credits", adminB, { credits: 500_000 });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "credits_above_max", max: 5000 });

    expect((await settingsRow(TENANT_B))!.credits_balance).toBe(before);
    expect(await ledgerSum(TENANT_B)).toBe(sumBefore);
    // 400s record nothing anywhere else in this file. An attempt to mint six figures
    // of model spend is the one refusal worth being able to find afterwards.
    expect(await auditActions(TENANT_B, "credits_grant_refused")).toBe(refusalsBefore + 1);
  });

  it("accepts the ceiling itself, and still rejects a negative with the old code", async () => {
    expect((await req("POST", "/api/config/credits", adminB, { credits: 5000 })).status).toBe(200);
    expect((await settingsRow(TENANT_B))!.credits_balance).toBe(5000);

    // Two refusals that mean opposite things to whoever has to fix them keep
    // distinct codes: "that is not a number" vs "that number is too large".
    const bad = await req("POST", "/api/config/credits", adminB, { credits: -1 });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: "invalid_credits" });
  });

  it("a pack above `MAX_CREDIT_PACK` is still refused as an invalid pack", async () => {
    // The named constant replaced a literal 1000; the boundary must not have moved.
    expect((await req("POST", "/api/config/credits/purchase", adminB, { credits: 1000 })).status).toBe(200);
    expect((await req("POST", "/api/config/credits/purchase", adminB, { credits: 1001 })).status).toBe(400);
    // And the asymmetry is pinned rather than left ambiguous: the previous case set
    // the balance to the 5000 ceiling, so this purchase has just carried it to 6000.
    // `MAX_CREDIT_BALANCE` bounds the SET — the route the console calls, with no
    // `max` on its input — not the accumulated balance. See `MAX_CREDIT_PACK`'s
    // comment for why that is the deliberate shape.
    expect((await settingsRow(TENANT_B))!.credits_balance).toBe(6000);
  });
});
