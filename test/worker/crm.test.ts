import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type { CrmConnectionView } from "../../src/shared/crm";

/**
 * W3-D — Admin console → CRM sync (`/api/crm`).
 *
 * Four things this suite exists to hold:
 *
 *  1. **A GET never returns a credential.** The connect body carries one; no
 *     response body on this router may contain it, in any field, ever.
 *  2. **The provider call is stubbed and records** (§1.3) — a sync writes a
 *     `crm_sync_log` row with `status='recorded'` and performs nothing.
 *  3. Field-mapping validation: unknown fields and duplicates are refused.
 *  4. AuthZ: a non-admin gets 403 on every verb.
 */

const BASE = "https://example.com";

// Seed logins (migrations/0002_seed.sql).
const ADMIN = "nisha.kapoor@demo.startupjury.ai"; // admin
const PA = "sunita.rao@demo.startupjury.ai"; // program_associate (non-admin)

/** The value posted as a credential. It must never come back out. */
const SECRET = "sk-live-supersecret-9c4f2a";

async function login(email: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo1234" }),
  });
  const setCookie = res.headers.get("set-cookie");
  return setCookie ? setCookie.split(";")[0] : "";
}

const get = (p: string, c: string) => SELF.fetch(`${BASE}${p}`, { headers: { cookie: c } });

function send(method: string, path: string, cookie: string, body?: unknown) {
  return SELF.fetch(`${BASE}${path}`, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

const put = (p: string, c: string, b?: unknown) => send("PUT", p, c, b);
const post = (p: string, c: string, b?: unknown) => send("POST", p, c, b);

async function connections(cookie: string): Promise<CrmConnectionView[]> {
  const res = await get("/api/crm", cookie);
  expect(res.status).toBe(200);
  return ((await res.json()) as { connections: CrmConnectionView[] }).connections;
}

const find = (rows: CrmConnectionView[], provider: string) =>
  rows.find((c) => c.provider === provider)!;

describe("GET /api/crm", () => {
  it("lists all four providers in the prototype's order, connected or not", async () => {
    const admin = await login(ADMIN);
    const rows = await connections(admin);
    expect(rows.map((c) => c.provider)).toEqual([
      "salesforce",
      "hubspot",
      "pipedrive",
      "custom",
    ]);
    expect(rows.map((c) => c.label)).toEqual([
      "Salesforce",
      "HubSpot",
      "Pipedrive",
      "Custom API",
    ]);
  });

  it("carries the seeded Salesforce filter rules and renders the prototype's summary line", async () => {
    const admin = await login(ADMIN);
    const sf = find(await connections(admin), "salesforce");
    expect(sf.status).toBe("live");
    expect(sf.triggerField).toBe("Stage");
    expect(sf.triggerValue).toBe("Submitted for evaluation");
    expect(sf.monthlyDeckCap).toBe(50);
    expect(sf.scoreWritebackField).toBe("AI_Score__c");
    expect(sf.autoApproveWithinCap).toBe(true);
    expect(sf.writeBackScores).toBe(true);
    expect(sf.summary).toBe("Last sync: 4 Jun 2026 · 11:42 am · 3 deals pulled");
  });

  it("shows a never-connected provider as Inactive with the prototype's blurb", async () => {
    const admin = await login(ADMIN);
    const rows = await connections(admin);
    expect(find(rows, "hubspot").status).toBe("inactive");
    expect(find(rows, "hubspot").summary).toBe("Not connected");
    expect(find(rows, "custom").summary).toBe("Connect any CRM via webhook or REST API");
  });
});

describe("credentials are write-only", () => {
  it("never returns the posted credential from any endpoint, and never stores it", async () => {
    const admin = await login(ADMIN);

    const connected = await post("/api/crm/hubspot/connect", admin, { credential: SECRET });
    expect(connected.status).toBe(200);
    // Even the connect response — the one that received it — must not echo it.
    expect(await connected.clone().text()).not.toContain(SECRET);

    for (const path of ["/api/crm", "/api/crm/hubspot/log"]) {
      const body = await (await get(path, admin)).text();
      expect(body, path).not.toContain(SECRET);
    }
    const synced = await post("/api/crm/hubspot/sync", admin);
    expect(await synced.text()).not.toContain(SECRET);

    // And it is not in the database either — the column holds a masked tail and
    // the name of a Worker secret, never the value.
    const row = await env.DB.prepare(
      "SELECT credential_ref, credential_hint FROM crm_connections WHERE edition = 'incubator' AND provider = 'hubspot'",
    ).first<{ credential_ref: string; credential_hint: string }>();
    expect(row?.credential_ref).toBe("CRM_HUBSPOT_TOKEN");
    expect(row?.credential_hint).toBe("••••9c4f2a".slice(0, 4) + SECRET.slice(-4));
    expect(row?.credential_hint).not.toContain(SECRET);

    const dump = JSON.stringify(
      (await env.DB.prepare("SELECT * FROM crm_connections").all()).results,
    );
    expect(dump).not.toContain(SECRET);
  });

  it("reports credential presence as a masked hint plus the secret's name", async () => {
    const admin = await login(ADMIN);
    await post("/api/crm/pipedrive/connect", admin, { credential: SECRET });
    const row = find(await connections(admin), "pipedrive");
    expect(row.credential.configured).toBe(true);
    expect(row.credential.hint).toBe(`••••${SECRET.slice(-4)}`);
    expect(row.credential.ref).toBe("CRM_PIPEDRIVE_TOKEN");
    expect(JSON.stringify(row)).not.toContain(SECRET);
  });
});

describe("connect / disconnect", () => {
  it("brings a provider live and back to inactive, keeping its rules", async () => {
    const admin = await login(ADMIN);

    await put("/api/crm/hubspot", admin, {
      triggerField: "Deal Stage",
      triggerValue: "Ready",
      monthlyDeckCap: 12,
    });
    await post("/api/crm/hubspot/connect", admin, {
      credential: SECRET,
      baseUrl: "acme.hubspot.com",
    });

    let hs = find(await connections(admin), "hubspot");
    expect(hs.status).toBe("live");
    expect(hs.baseUrl).toBe("acme.hubspot.com");
    expect(hs.connectedAt).not.toBeNull();

    const off = await post("/api/crm/hubspot/disconnect", admin);
    expect(off.status).toBe(200);
    hs = find(await connections(admin), "hubspot");
    expect(hs.status).toBe("inactive");
    // The credential reference is gone — a reconnect must supply the key again.
    expect(hs.credential.configured).toBe(false);
    expect(hs.credential.hint).toBeNull();
    // …but the configuration an admin built is not thrown away.
    expect(hs.triggerField).toBe("Deal Stage");
    expect(hs.monthlyDeckCap).toBe(12);
  });

  it("refuses a connect with no credential, and a custom connect with no webhook path", async () => {
    const admin = await login(ADMIN);
    // Tests in this file share one database, so start from a known state: a
    // provider an earlier test connected already carries a credential ref.
    await post("/api/crm/pipedrive/disconnect", admin);
    await post("/api/crm/custom/disconnect", admin);

    const noKey = await post("/api/crm/pipedrive/connect", admin, {});
    expect(noKey.status).toBe(400);
    expect(((await noKey.json()) as { error: string }).error).toBe("credential_required");

    const noHook = await post("/api/crm/custom/connect", admin, {});
    expect(noHook.status).toBe(400);
    expect(((await noHook.json()) as { error: string }).error).toBe("webhook_path_required");

    const hooked = await post("/api/crm/custom/connect", admin, { webhookPath: "/hooks/acme" });
    expect(hooked.status).toBe(200);
    expect(find(await connections(admin), "custom").status).toBe("live");
  });

  it("400s an unknown provider", async () => {
    const admin = await login(ADMIN);
    expect((await post("/api/crm/zoho/connect", admin, { credential: "x" })).status).toBe(400);
    expect((await get("/api/crm/zoho/log", admin)).status).toBe(400);
  });
});

describe("PUT /api/crm/:provider — settings, rules and mapping validation", () => {
  it("saves direction, schedule, rules and mappings together", async () => {
    const admin = await login(ADMIN);
    const res = await put("/api/crm/salesforce", admin, {
      syncDirection: "both",
      syncSchedule: "daily",
      triggerField: "Stage",
      triggerValue: "Qualified",
      monthlyDeckCap: 25,
      scoreWritebackField: "Jury_Score__c",
      autoApproveWithinCap: false,
      writeBackScores: true,
      mappings: [
        { crmField: "Account.Name", appField: "companyName", direction: "inbound" },
        { crmField: "Contact.Email", appField: "founderEmail", direction: "inbound" },
        { crmField: "Jury_Score__c", appField: "compositeScore", direction: "outbound" },
      ],
    });
    expect(res.status).toBe(200);

    const sf = find(await connections(admin), "salesforce");
    expect(sf.syncDirection).toBe("both");
    expect(sf.syncSchedule).toBe("daily");
    expect(sf.triggerValue).toBe("Qualified");
    expect(sf.monthlyDeckCap).toBe(25);
    expect(sf.autoApproveWithinCap).toBe(false);
    expect(sf.mappings).toHaveLength(3);
    expect(sf.mappings[2]).toEqual({
      crmField: "Jury_Score__c",
      appField: "compositeScore",
      direction: "outbound",
    });
  });

  it("refuses an app field the product does not have", async () => {
    const admin = await login(ADMIN);
    const res = await put("/api/crm/salesforce", admin, {
      mappings: [{ crmField: "Account.Name", appField: "unicornScore", direction: "inbound" }],
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; reason: string; index: number };
    expect(body.error).toBe("invalid_mappings");
    expect(body.reason).toBe("unknown_app_field");
    expect(body.index).toBe(0);
  });

  it("refuses the same app field mapped twice — the mapping would be ambiguous", async () => {
    const admin = await login(ADMIN);
    const res = await put("/api/crm/salesforce", admin, {
      mappings: [
        { crmField: "Contact.Email", appField: "founderEmail", direction: "inbound" },
        { crmField: "Lead.Email", appField: "founderEmail", direction: "inbound" },
      ],
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { reason: string }).reason).toBe("duplicate_app_field");
  });

  it("refuses an outbound field used inbound, a bad CRM field name, and a bad direction", async () => {
    const admin = await login(ADMIN);
    const wrongWay = await put("/api/crm/salesforce", admin, {
      mappings: [{ crmField: "AI_Score__c", appField: "aiScore", direction: "inbound" }],
    });
    expect(((await wrongWay.json()) as { reason: string }).reason).toBe("unknown_app_field");

    const badField = await put("/api/crm/salesforce", admin, {
      mappings: [{ crmField: "Name'; DROP TABLE", appField: "companyName", direction: "inbound" }],
    });
    expect(((await badField.json()) as { reason: string }).reason).toBe("invalid_crm_field");

    const badDir = await put("/api/crm/salesforce", admin, {
      mappings: [{ crmField: "Account.Name", appField: "companyName", direction: "sideways" }],
    });
    expect(((await badDir.json()) as { reason: string }).reason).toBe("invalid_direction");
  });

  it("rejects a mapping set that is not a list, and leaves the stored set alone", async () => {
    const admin = await login(ADMIN);
    const before = find(await connections(admin), "salesforce").mappings.length;
    const res = await put("/api/crm/salesforce", admin, { mappings: "Account.Name" });
    expect(res.status).toBe(400);
    expect(find(await connections(admin), "salesforce").mappings).toHaveLength(before);
  });

  it("refuses settings that would silently do nothing", async () => {
    const admin = await login(ADMIN);
    expect((await put("/api/crm/salesforce", admin, { monthlyDeckCap: -5 })).status).toBe(400);
    expect((await put("/api/crm/salesforce", admin, { monthlyDeckCap: 2.5 })).status).toBe(400);
    expect((await put("/api/crm/salesforce", admin, { syncDirection: "sideways" })).status).toBe(400);
    expect((await put("/api/crm/salesforce", admin, { syncSchedule: "fortnightly" })).status).toBe(400);

    // A trigger value with nothing to match it on.
    const noField = await put("/api/crm/hubspot", admin, {
      triggerField: "",
      triggerValue: "Ready",
    });
    expect(noField.status).toBe(400);
    expect(((await noField.json()) as { error: string }).error).toBe("trigger_field_required");

    // Write-back on with no target field.
    const noTarget = await put("/api/crm/hubspot", admin, {
      writeBackScores: true,
      scoreWritebackField: "",
    });
    expect(noTarget.status).toBe(400);
    expect(((await noTarget.json()) as { error: string }).error).toBe("writeback_field_required");
  });

  it("clears the monthly cap when it is sent as null", async () => {
    const admin = await login(ADMIN);
    await put("/api/crm/salesforce", admin, { monthlyDeckCap: null });
    expect(find(await connections(admin), "salesforce").monthlyDeckCap).toBeNull();
  });
});

describe("the provider stub records instead of syncing (§1.3)", () => {
  it("records a sync attempt with the request it WOULD have made, and sends nothing", async () => {
    const admin = await login(ADMIN);
    await put("/api/crm/salesforce", admin, {
      triggerField: "Stage",
      triggerValue: "Submitted for evaluation",
      monthlyDeckCap: null,
    });
    const before = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM crm_sync_log WHERE connection_id = 'crm_inc_salesforce'",
    ).first<{ n: number }>();

    const res = await post("/api/crm/salesforce/sync", admin);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      attempt: { status: string; operation: string; payload: Record<string, unknown> };
      cap: { limit: number; usedThisMonth: number };
    };

    // 'recorded', never 'sent': nothing left the Worker.
    expect(body.attempt.status).toBe("recorded");
    expect(body.attempt.operation).toBe("pull_deals");
    expect(body.attempt.payload.triggerField).toBe("Stage");

    const after = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM crm_sync_log WHERE connection_id = 'crm_inc_salesforce'",
    ).first<{ n: number }>();
    expect(after!.n).toBe(before!.n + 1);

    const row = await env.DB.prepare(
      "SELECT status, operation, payload_json FROM crm_sync_log WHERE connection_id = 'crm_inc_salesforce' ORDER BY created_at DESC, rowid DESC LIMIT 1",
    ).first<{ status: string; operation: string; payload_json: string }>();
    expect(row?.status).toBe("recorded");
    expect(JSON.parse(row!.payload_json)).toMatchObject({
      triggerField: "Stage",
      triggerValue: "Submitted for evaluation",
    });

    // No status anywhere in the table claims a delivery this build cannot make.
    const sent = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM crm_sync_log WHERE status = 'sent'",
    ).first<{ n: number }>();
    expect(sent!.n).toBe(0);
  });

  it("surfaces the attempt in the sync log with its recorded payload", async () => {
    const admin = await login(ADMIN);
    await post("/api/crm/salesforce/sync", admin);
    const res = await get("/api/crm/salesforce/log", admin);
    expect(res.status).toBe(200);
    const { entries } = (await res.json()) as {
      entries: Array<{ status: string; operation: string; payload: Record<string, unknown> }>;
    };
    expect(entries[0].status).toBe("recorded");
    expect(entries[0].payload).toHaveProperty("triggerField");
  });

  it("skips rather than syncs when the connection is not live", async () => {
    const admin = await login(ADMIN);
    await post("/api/crm/hubspot/disconnect", admin);
    const before = find(await connections(admin), "hubspot").lastSyncAt;

    const res = await post("/api/crm/hubspot/sync", admin);
    const body = (await res.json()) as { attempt: { status: string; error: string } };
    expect(body.attempt.status).toBe("skipped");
    expect(body.attempt.error).toMatch(/not live/i);

    // A skipped attempt is not a sync — it must not move the summary line, and
    // it must not flip the connection into 'error'.
    const after = find(await connections(admin), "hubspot");
    expect(after.lastSyncAt).toBe(before);
    expect(after.status).toBe("inactive");
  });

  it("stops pulling once the monthly deck cap is reached — the only spend guard", async () => {
    const admin = await login(ADMIN);
    await put("/api/crm/salesforce", admin, { monthlyDeckCap: 1 });

    // The 0037/0043 seed already logged 3 pulled deals, but in June 2026; the
    // cap counts this calendar month, so start from a known row of our own.
    const now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO crm_sync_log (id, connection_id, edition, provider, direction, operation, status, record_count, created_at) " +
        "VALUES ('crmlog_cap_probe', 'crm_inc_salesforce', 'incubator', 'salesforce', 'pull', 'pull_deals', 'recorded', 1, ?)",
    )
      .bind(now)
      .run();

    const res = await post("/api/crm/salesforce/sync", admin);
    const body = (await res.json()) as { attempt: { status: string; error: string } };
    expect(body.attempt.status).toBe("skipped");
    expect(body.attempt.error).toMatch(/cap reached/i);
  });
});

describe("authZ", () => {
  it("403s a non-admin on every verb", async () => {
    const pa = await login(PA);
    expect((await get("/api/crm", pa)).status).toBe(403);
    expect((await get("/api/crm/salesforce/log", pa)).status).toBe(403);
    expect((await put("/api/crm/salesforce", pa, { syncSchedule: "daily" })).status).toBe(403);
    expect((await post("/api/crm/salesforce/connect", pa, { credential: SECRET })).status).toBe(403);
    expect((await post("/api/crm/salesforce/disconnect", pa)).status).toBe(403);
    expect((await post("/api/crm/salesforce/sync", pa)).status).toBe(403);
  });

  it("a forbidden write changes nothing", async () => {
    const admin = await login(ADMIN);
    const pa = await login(PA);
    const before = find(await connections(admin), "salesforce");
    await put("/api/crm/salesforce", pa, { syncSchedule: "weekly", monthlyDeckCap: 999 });
    const after = find(await connections(admin), "salesforce");
    expect(after.syncSchedule).toBe(before.syncSchedule);
    expect(after.monthlyDeckCap).toBe(before.monthlyDeckCap);
  });

  it("401s when signed out", async () => {
    expect((await SELF.fetch(`${BASE}/api/crm`)).status).toBe(401);
  });
});

describe("edition isolation", () => {
  it("an incubator admin never sees or writes the VC rows", async () => {
    const admin = await login(ADMIN);
    await put("/api/crm/salesforce", admin, { syncSchedule: "weekly" });
    const vc = await env.DB.prepare(
      "SELECT sync_schedule FROM crm_connections WHERE id = 'crm_vc_salesforce'",
    ).first<{ sync_schedule: string }>();
    expect(vc?.sync_schedule).toBe("hourly");
  });
});
