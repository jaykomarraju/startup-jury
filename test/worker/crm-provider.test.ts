import { env } from "cloudflare:test";
import { describe, it, expect, vi } from "vitest";
import { recordSyncAttempt, resolveCrmClient, secretFor } from "../../src/server/crm/provider";
import { writeBackDeckScore, capHeadroom, pulledThisMonth } from "../../src/server/crm/sync";
import type { Env } from "../../src/server/types";

/**
 * W3-D — the provider interface and its recording stub (§1.3), tested directly.
 *
 * The contract, in one line: **an attempt is recorded, not performed.** The
 * suite proves the three halves of that — nothing is dispatched, the row that
 * lands says `'recorded'` rather than `'sent'`, and a configured-but-adapterless
 * deployment still records rather than claiming a delivery it cannot make.
 *
 * This file lives under the WORKER tsconfig, not test/unit: the module imports
 * `Env`, which needs @cloudflare/workers-types. Storage is isolated per FILE,
 * not per test, so every fixture uses its own connection row.
 */

const E = () => env as unknown as Env;

/**
 * `crm_connections` is UNIQUE (edition, provider) and `0037` seeds all eight
 * pairs, so a fixture UPDATES one of those rows rather than inserting a ninth.
 * Each test below owns a different pair, and the row's log is cleared with it.
 */
async function seedConnection(
  id: string,
  patch: {
    status?: string;
    trigger_field?: string;
    trigger_value?: string;
    monthly_deck_cap?: number | null;
    score_writeback_field?: string | null;
    write_back_scores?: number;
    credential_ref?: string | null;
  } = {},
) {
  await env.DB.prepare(
    "UPDATE crm_connections SET status = ?, trigger_field = ?, trigger_value = ?, " +
      "monthly_deck_cap = ?, score_writeback_field = ?, write_back_scores = ?, credential_ref = ?, " +
      "last_sync_at = NULL, last_sync_count = NULL, last_error = NULL WHERE id = ?",
  )
    .bind(
      patch.status ?? "live",
      patch.trigger_field ?? "Stage",
      patch.trigger_value ?? "Ready",
      patch.monthly_deck_cap ?? null,
      patch.score_writeback_field === undefined ? "AI_Score__c" : patch.score_writeback_field,
      patch.write_back_scores ?? 1,
      patch.credential_ref ?? null,
      id,
    )
    .run();
  await env.DB.prepare("DELETE FROM crm_sync_log WHERE connection_id = ?").bind(id).run();
  return id;
}

async function logRows(connectionId: string) {
  return (
    await env.DB.prepare(
      "SELECT status, operation, record_count, payload_json, error FROM crm_sync_log WHERE connection_id = ? ORDER BY rowid",
    )
      .bind(connectionId)
      .all<{
        status: string;
        operation: string;
        record_count: number;
        payload_json: string;
        error: string | null;
      }>()
  ).results;
}

describe("resolveCrmClient", () => {
  it("returns null with no credential — nothing is configured, so nothing can be called", () => {
    expect(resolveCrmClient(E(), { provider: "salesforce", credentialRef: null })).toBeNull();
    expect(resolveCrmClient(E(), { provider: "salesforce", credentialRef: "CRM_X" })).toBeNull();
  });

  it("still returns null when the secret IS set — no adapter is registered (§1.3)", () => {
    const withSecret = { ...E(), CRM_SALESFORCE_TOKEN: "sk-live-abc" } as unknown as Env;
    expect(secretFor(withSecret, "CRM_SALESFORCE_TOKEN")).toBe("sk-live-abc");
    // The credential resolves, but there is no vendor adapter on the critical
    // path — so the deployment records honestly instead of reporting 'sent'.
    expect(
      resolveCrmClient(withSecret, {
        provider: "salesforce",
        credentialRef: "CRM_SALESFORCE_TOKEN",
      }),
    ).toBeNull();
  });

  it("reads no secret for a blank or missing reference", () => {
    expect(secretFor(E(), null)).toBeUndefined();
    expect(secretFor(E(), "NOT_A_BINDING")).toBeUndefined();
    expect(secretFor({ ...E(), BLANK: "   " } as unknown as Env, "BLANK")).toBeUndefined();
  });
});

describe("recordSyncAttempt", () => {
  it("writes a 'recorded' row carrying the request, and performs no network call", async () => {
    const id = await seedConnection("crm_vc_hubspot");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const record = await recordSyncAttempt(
      E(),
      {
        connectionId: id,
        edition: "vc",
        provider: "hubspot",
        operation: "pull_deals",
        direction: "pull",
        recordCount: 0,
        payload: { triggerField: "Stage", triggerValue: "Ready", limit: 25 },
      },
      { credentialRef: null },
    );

    expect(record.status).toBe("recorded");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();

    const rows = await logRows(id);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("recorded");
    expect(JSON.parse(rows[0].payload_json)).toEqual({
      triggerField: "Stage",
      triggerValue: "Ready",
      limit: 25,
    });
  });

  it("moves the connection's telemetry so the summary line reflects the attempt", async () => {
    const id = await seedConnection("crm_vc_pipedrive");
    await recordSyncAttempt(
      E(),
      {
        connectionId: id,
        edition: "vc",
        provider: "pipedrive",
        operation: "pull_deals",
        direction: "pull",
        recordCount: 4,
        payload: {},
      },
      { credentialRef: null },
    );
    const row = await env.DB.prepare(
      "SELECT last_sync_at, last_sync_count FROM crm_connections WHERE id = ?",
    )
      .bind(id)
      .first<{ last_sync_at: string; last_sync_count: number }>();
    expect(row?.last_sync_at).toBeTruthy();
    expect(row?.last_sync_count).toBe(4);
  });

  it("records a precondition failure as 'skipped' and leaves the telemetry alone", async () => {
    const id = await seedConnection("crm_vc_custom");
    const record = await recordSyncAttempt(
      E(),
      {
        connectionId: id,
        edition: "vc",
        provider: "custom",
        operation: "write_back_score",
        direction: "push",
        payload: {},
        skipReason: "Write-back is switched off.",
      },
      { credentialRef: null },
    );
    expect(record.status).toBe("skipped");
    expect(record.error).toBe("Write-back is switched off.");

    const row = await env.DB.prepare(
      "SELECT last_sync_at FROM crm_connections WHERE id = ?",
    )
      .bind(id)
      .first<{ last_sync_at: string | null }>();
    expect(row?.last_sync_at).toBeNull();
  });
});

describe("writeBackDeckScore (F0180)", () => {
  it("records what it would have pushed to the configured CRM field", async () => {
    // Point the edition's live write-back connection at a row we control.
    await env.DB.prepare("UPDATE crm_connections SET status = 'inactive' WHERE edition = 'incubator'").run();
    const id = await seedConnection("crm_inc_hubspot", { status: "live", write_back_scores: 1 });

    const record = await writeBackDeckScore(E(), {
      edition: "incubator",
      deckId: "deck_1",
      externalId: "0061x00000ABC",
      fields: { aiScore: 8.2, signal: "Strong" },
    });

    expect(record?.status).toBe("recorded");
    expect(record?.operation).toBe("write_back_score");
    const rows = await logRows(id);
    expect(rows[0].operation).toBe("write_back_score");
    expect(JSON.parse(rows[0].payload_json)).toMatchObject({
      field: "AI_Score__c",
      externalId: "0061x00000ABC",
      fields: { aiScore: 8.2, signal: "Strong" },
    });
  });

  it("skips when the connection has no write-back field configured", async () => {
    await env.DB.prepare("UPDATE crm_connections SET status = 'inactive' WHERE edition = 'incubator'").run();
    const id = await seedConnection("crm_inc_pipedrive", {
      status: "live",
      write_back_scores: 1,
      score_writeback_field: null,
    });
    const record = await writeBackDeckScore(E(), {
      edition: "incubator",
      deckId: "deck_2",
      fields: { aiScore: 5 },
    });
    expect(record?.status).toBe("skipped");
    expect(record?.error).toMatch(/no score write-back field/i);
    expect((await logRows(id))[0].status).toBe("skipped");
  });

  it("returns null — and writes nothing — when the edition has no live write-back connection", async () => {
    await env.DB.prepare("UPDATE crm_connections SET write_back_scores = 0 WHERE edition = 'incubator'").run();
    const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM crm_sync_log").first<{ n: number }>();
    expect(await writeBackDeckScore(E(), { edition: "incubator", deckId: "d", fields: {} })).toBeNull();
    const after = await env.DB.prepare("SELECT COUNT(*) AS n FROM crm_sync_log").first<{ n: number }>();
    expect(after!.n).toBe(before!.n);
  });
});

describe("the monthly cap", () => {
  it("treats a null cap as uncapped and never reports negative headroom", () => {
    expect(capHeadroom(null, 900)).toBeNull();
    expect(capHeadroom(50, 3)).toBe(47);
    expect(capHeadroom(50, 50)).toBe(0);
    expect(capHeadroom(50, 80)).toBe(0);
  });

  it("counts only this calendar month's recorded and sent pulls", async () => {
    const id = await seedConnection("crm_inc_custom");
    const now = new Date("2026-09-15T10:00:00Z");
    const rows: Array<[string, string, string, number]> = [
      ["crmtest_cap_a", "pull_deals", "2026-09-01T09:00:00Z", 2],
      ["crmtest_cap_b", "pull_deals", "2026-09-20T09:00:00Z", 3],
      ["crmtest_cap_c", "pull_deals", "2026-08-31T09:00:00Z", 9], // last month
      ["crmtest_cap_d", "write_back_score", "2026-09-02T09:00:00Z", 7], // not a pull
    ];
    for (const [rowId, op, at, n] of rows) {
      await env.DB.prepare(
        "INSERT INTO crm_sync_log (id, connection_id, edition, provider, direction, operation, status, record_count, created_at) " +
          "VALUES (?, ?, 'incubator', 'custom', 'pull', ?, 'recorded', ?, ?)",
      )
        .bind(rowId, id, op, n, at)
        .run();
    }
    // A skipped attempt pulled nothing and must not count against the cap.
    await env.DB.prepare(
      "INSERT INTO crm_sync_log (id, connection_id, edition, provider, direction, operation, status, record_count, created_at) " +
        "VALUES ('crmtest_cap_e', ?, 'incubator', 'custom', 'pull', 'pull_deals', 'skipped', 4, '2026-09-03T09:00:00Z')",
    )
      .bind(id)
      .run();

    expect(await pulledThisMonth(E(), id, now)).toBe(5);
  });
});
