/**
 * Guards on the migration directory itself, run inside the Worker so the whole
 * set is available as the `TEST_MIGRATIONS` binding — name plus split
 * statements — with no filesystem access.
 *
 * `migrations/` is owned by W1-B for the whole parity programme, and the one
 * merge conflict that is genuinely painful is two sessions claiming the same
 * number. These tests make that visible at `npm test` rather than at merge, and
 * they hold the block to the two properties the session promised: it applies
 * cleanly to a fresh D1, and re-applying it changes nothing.
 */
import { applyD1Migrations, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { TENANT_KEYED_TABLES, PLATFORM_GLOBAL_TABLES } from "../../src/shared/tenant";

/** The block this session added; everything in it must stay together. */
const FIRST = 25;
const LAST = 37;
const BLOCK_SIZE = LAST - FIRST + 1;

/**
 * The highest number the wave in flight has allotted, from the plan's §10
 * ownership table. Wave 2 was 0038–0040; Wave 3 was 0040–0043; Wave 4 was
 * 0044–0047 (W4-A 0044, W4-B 0045, W4-C 0046, W4-D 0047); Wave 5 was
 * 0048–0049 (W5-A 0048, W5-B 0049); **Wave 6 is 0050–0053** (Wx-PWD 0050,
 * W6-A 0051, W6-C 0052, and W6-B 0053 — unallotted, declared in §9); **Wave 7 is
 * 0054–0059**, one per session in letter order (W7-C 0056 — placed at Wave 9
 * integration with its §9 patch, not on its own branch; W7-D 0057, W7-E 0058;
 * the other three needed none); **Wave 8 is 0059–0060** (W8-A 0059, W8-B 0060); **Wave 9 is
 * 0061–0065** in letter order (W9-C 0063, W9-E 0065; A, B and D needed none);
 * **the V3 superuser wave is 0066–0074**, one per session in the order
 * `docs/plan_v3_superuser.md` §7 lists them (V3-NAV 0066 … V3-PT 0073,
 * V3-FLOW 0074) — a session that needs no migration leaves its number unused,
 * and only 0071 / 0072 / 0073 were taken (0074 was allotted to V3-FLOW and
 * never used, so the V4 wave re-allots it); **the V4 follow-up wave is
 * 0074-0076** (V4-WEIGHT 0074, V4-ROUTE 0075, V4-SIZE 0076). Each wave raises
 * this line to the WAVE's ceiling, not to any one session's number, and every
 * parallel session in the wave hits it — expect a one-line merge conflict here
 * and take the HIGHEST value.
 *
 * ── 2026-09-30 · ONE raise for THREE waves, allotted in advance ──────────────
 *
 * Three bodies of work are now planned at once, and the old practice — each
 * wave raising this line as it starts — would have produced three separate
 * one-line conflicts hitting every parallel session in each wave. Worse, `0076`
 * was DOUBLE-CLAIMED: by R8-AW/SF (`plan_roles_incubator.md:122,172`,
 * conditional, not started) and by My Account's S-CAT
 * (`plan_myaccount.md:188`). S-CAT's claim is withdrawn here and the whole
 * table is written down instead, so a session reads its slot rather than
 * inferring one:
 *
 *   0076        R8-AW/SF `score_visibility` (conditional)
 *   0077–0078   My Account S-CAT
 *   0079        trial_requests           (platform stage 2)
 *   0080        tickets.scope            (platform stage 3)
 *   0081        F-FOUL  — r2_key on the seeded decks
 *   0082        S2-SERVER — org_scoring_settings.ai_gate_threshold
 *   0083–0108   tenancy T0 block (26 slots)
 *   0109–0110   declared headroom
 *
 * T0-SCHEMA used 0083–0100 of its 26 and left 0101–0108 as the T1 wave's working
 * headroom — eight slots the seven parallel sessions and their integration step
 * draw from, including the one that drops the transitional unique indexes
 * `0091`–`0095` and `0099` left standing. The ceiling is NOT raised again here: it
 * was set to 110 for three waves at once, in advance, precisely so a foundation
 * session would not produce a one-line conflict in seven branches.
 *
 *   0083        organizations + the t_default backfill
 *   0084–0086   ADD COLUMN tenant_id on 17 tables + the two outbox tables
 *   0087        rebuild users (alone, by instruction)
 *   0088        prove 0087 applied whole
 *   0089–0098   the other ten rebuilds, one table per migration
 *   0099        the index pass — 21 re-cuts plus the tenant-blind dedupe unique
 *   0100        the standing integrity assertion
 *
 * `0082 < 0083` deliberately: the AI-gate column must land BEFORE tenancy
 * rebuilds `org_scoring_settings`.
 *
 * Contiguity is NOT asserted above `LAST` (see `:66-71`) — only uniqueness and
 * `max <= ALLOTMENT_CEILING` — and the directory already has gaps after 0044,
 * 0049, 0053, 0058, 0060, 0063 and 0065. A wave needs unique slots under the
 * ceiling, nothing more.
 */
const ALLOTMENT_CEILING = 110;

const MIGRATIONS = env.TEST_MIGRATIONS;

function numberOf(name: string): number {
  const m = /^(\d{4})_/.exec(name);
  expect(m, `${name} is not numbered NNNN_name.sql`).toBeTruthy();
  return Number(m![1]);
}

const inBlock = MIGRATIONS.filter((m) => {
  const n = numberOf(m.name);
  return n >= FIRST && n <= LAST;
});

describe("migration numbering", () => {
  it("is unique and strictly ascending from 0001", () => {
    const numbers = MIGRATIONS.map((m) => numberOf(m.name)).sort((a, b) => a - b);
    expect(new Set(numbers).size, "duplicate migration number").toBe(numbers.length);
    expect(numbers[0]).toBe(1);
    // W2-B — this asserted strict CONTIGUITY over the WHOLE directory
    // (`numbers[i] === i + 1`), which held while one session owned
    // `migrations/`. From Wave 2 the plan allots each parallel session its own
    // number (§2.2), so a worktree that uses its allotment legitimately leaves
    // a hole where its siblings' will land: this branch has 0039 and no 0038 /
    // 0040. Contiguity is therefore asserted up to the end of the W1-B block
    // and no further — a hole BELOW 0037 is still a lost migration and still
    // fails. Uniqueness, asserted above, is what the allotment really protects.
    const settled = numbers.filter((n) => n <= LAST);
    expect(settled).toEqual(settled.map((_, i) => i + 1));
    // Nothing may be numbered beyond the wave's allotment ceiling either.
    expect(Math.max(...numbers)).toBeLessThanOrEqual(ALLOTMENT_CEILING);
  });

  it("keeps the W1-B block contiguous and directly above the pre-existing tree", () => {
    expect(inBlock).toHaveLength(BLOCK_SIZE);
    expect(inBlock.map((m) => numberOf(m.name)).sort((a, b) => a - b)).toEqual(
      Array.from({ length: BLOCK_SIZE }, (_, i) => FIRST + i),
    );
    const below = MIGRATIONS.map((m) => numberOf(m.name)).filter((n) => n < FIRST);
    expect(Math.max(...below)).toBe(FIRST - 1);
  });
});

describe("migration idempotence", () => {
  const statements = (m: { queries: string[] }) => m.queries;

  it("guards every CREATE TABLE / CREATE INDEX in the block", () => {
    for (const m of inBlock) {
      for (const q of statements(m)) {
        const create = /^\s*CREATE\s+(UNIQUE\s+)?(TABLE|INDEX)\s+(\S+)/i.exec(q);
        if (!create) continue;
        expect(create[3].toUpperCase(), `${m.name}: ${create[0].trim()}`).toBe("IF");
      }
    }
  });

  it("guards every INSERT in the block with ON CONFLICT, NOT EXISTS or OR IGNORE", () => {
    let inserts = 0;
    for (const m of inBlock) {
      for (const q of statements(m)) {
        if (!/^\s*INSERT\s+(OR\s+\w+\s+)?INTO/i.test(q)) continue;
        inserts++;
        expect(
          /ON CONFLICT|NOT EXISTS|INSERT\s+OR\s+(IGNORE|REPLACE)/i.test(q),
          `${m.name}: an INSERT is not re-executable — ${q.trim().slice(0, 100)}…`,
        ).toBe(true);
      }
    }
    expect(inserts).toBeGreaterThan(10);
  });

  it("adds columns only with ALTER TABLE ADD COLUMN, which D1's ledger runs once", () => {
    const alters: string[] = [];
    for (const m of inBlock) {
      for (const q of statements(m)) {
        if (/^\s*ALTER TABLE/i.test(q)) alters.push(`${m.name}: ${q.trim()}`);
      }
    }
    // `parameters` gains two columns (0025) and `cohorts` two (0036). Anything
    // else here is a schema change nobody has reviewed for a re-run.
    expect(alters).toHaveLength(4);
    expect(alters.every((a) => /ADD COLUMN/i.test(a))).toBe(true);
  });

  it("re-applying the whole set to an already-migrated D1 changes nothing", async () => {
    const fingerprint = async () => {
      const row = await env.DB.prepare(
        "SELECT (SELECT COUNT(*) FROM role_permissions) rp, (SELECT COUNT(*) FROM question_bank) qb, " +
          "(SELECT COUNT(*) FROM parameter_rubric_bands) rb, (SELECT COUNT(*) FROM notification_preferences) np, " +
          "(SELECT COUNT(*) FROM price_amounts) pa, (SELECT COUNT(*) FROM signup_documents) sd, " +
          "(SELECT COUNT(*) FROM credit_ledger) cl, (SELECT COUNT(*) FROM audit_log) al, " +
          "(SELECT COUNT(*) FROM sqlite_master WHERE type = 'table') tables",
      ).first<Record<string, number>>();
      return row!;
    };
    const before = await fingerprint();
    await applyD1Migrations(env.DB, MIGRATIONS);
    expect(await fingerprint()).toEqual(before);
  });
});

/**
 * ── THE DETECTOR §5f SAYS HAD TO EXIST BEFORE THE FIRST REBUILD ──────────────
 *
 * `grep -rn "foreign_key_check\|integrity_check" src test e2e scripts package.json`
 * returned ZERO before the tenancy block. This file asserted numbering,
 * contiguity, `IF NOT EXISTS` guards, re-executable inserts and idempotent
 * re-apply — and never once asserted referential integrity. §5f: "The detector has
 * to be written before the first rebuild lands. Treat that test as the first
 * deliverable of Stage 4, not as a follow-up."
 *
 * The migrations carry their own assertions (`0088` for the `users` rebuild,
 * `0100` for all 30 tenant keys), but neither can run a PRAGMA: D1 refuses the
 * table-valued form — `pragma_foreign_key_list(...)` in a SELECT answers
 * `SQLITE_AUTH` — so no SQL statement inside a migration can ask the question
 * these tests ask. That is why this half lives here.
 */
describe("referential integrity after the tenancy block", () => {
  it("PRAGMA foreign_key_check is clean across the whole database", async () => {
    // The one assertion that would have caught the rename trap. `ALTER TABLE users
    // RENAME TO users_old` rewrites 35 child tables' DDL to point at a table about
    // to be dropped, reports success, and surfaces nothing until a much later
    // INSERT behaves as though the constraint were gone. 0087 routes around it;
    // this is the net under it.
    const { results } = await env.DB.prepare("PRAGMA foreign_key_check").all();
    expect(results, `orphaned rows: ${JSON.stringify(results.slice(0, 5))}`).toEqual([]);
  });

  it("no table's DDL references a renamed or stashed copy of another", async () => {
    // The rebuilds use `<table>__pre_tenant` stashes and `<table>__fk_stash`
    // detach copies. Every one is dropped inside the migration that made it; a
    // leftover means a rebuild stopped half way, and a REFERENCE to one means the
    // rename trap fired.
    const row = await env.DB.prepare(
      "SELECT group_concat(name) AS names FROM sqlite_master " +
        "WHERE name LIKE '%__pre_tenant' OR name LIKE '%__fk_stash' OR name LIKE '%_old' OR name LIKE '%_new'",
    ).first<{ names: string | null }>();
    expect(row!.names, "a rebuild left a stash table behind").toBeNull();

    const refs = await env.DB.prepare(
      "SELECT group_concat(name) AS names FROM sqlite_master WHERE type = 'table' " +
        "AND (sql LIKE '%__pre_tenant%' OR sql LIKE '%__fk_stash%' OR sql LIKE '%users_old%')",
    ).first<{ names: string | null }>();
    expect(refs!.names, "a child table's foreign key points at a stash copy").toBeNull();
  });

  it("every one of the 30 tenant-keyed tables carries the column, and the 8 global ones do not", async () => {
    // A census rather than a spot check: a table that silently misses its column
    // fails here, at `npm test`, rather than at the first cross-tenant read. The
    // lists come from `src/shared/tenant.ts`, so they cannot drift from the helper
    // the seven T1 sessions bind against.
    for (const table of TENANT_KEYED_TABLES) {
      const row = await env.DB.prepare(
        "SELECT count(*) n FROM pragma_table_info(?) WHERE name = 'tenant_id'",
      )
        .bind(table)
        .first<{ n: number }>();
      expect(row!.n, `${table} is tenant-keyed but has no tenant_id column`).toBe(1);
    }
    for (const table of PLATFORM_GLOBAL_TABLES) {
      const row = await env.DB.prepare(
        "SELECT count(*) n FROM pragma_table_info(?) WHERE name = 'tenant_id'",
      )
        .bind(table)
        .first<{ n: number }>();
      expect(row!.n, `${table} is platform-global — see plan_multitenancy.md §3`).toBe(0);
    }
  });

  it("no row in any tenant-keyed table names a tenant that does not exist", async () => {
    // The foreign key §5d measured cannot be DECLARED: `ALTER TABLE … ADD COLUMN …
    // NOT NULL DEFAULT 't_default' REFERENCES organizations(id)` is refused, and the
    // nullable-then-rebuild alternative turns 11 rebuilds into 30. `0100` asserts
    // this on every apply of the chain; this asserts it on every `npm test`, which
    // is the one that catches a bad write between applies.
    for (const table of TENANT_KEYED_TABLES) {
      const row = await env.DB.prepare(
        `SELECT count(*) n FROM ${table} x LEFT JOIN organizations o ON o.id = x.tenant_id WHERE o.id IS NULL`,
      ).first<{ n: number }>();
      expect(row!.n, `${table} holds rows whose tenant_id has no organizations row`).toBe(0);
    }
  });

  it("every assertion the migration chain wrote came back 'ok'", async () => {
    // `_tenancy_assert`'s CHECK admits only 'ok', so a failing verdict could never
    // have committed. Reading the rows back proves the assertions RAN — a chain that
    // skipped 0088 or 0100 would leave the table short rather than wrong.
    const { results } = await env.DB.prepare(
      "SELECT id, verdict FROM _tenancy_assert ORDER BY id",
    ).all<{ id: string; verdict: string }>();
    const ids = results.map((r) => r.id);
    for (const required of [
      "users.fk_actions_fully_restored",
      "agreement_templates.fk_actions_fully_restored",
      "crm_connections.fk_actions_fully_restored",
      "0088.no_child_points_at_a_renamed_users",
      "0088.users_unique_is_per_tenant",
      "0088.all_41_user_edges_resolve",
      "0100.all_30_tables_resolve_their_tenant",
      "0100.pricing_tables_stay_global",
      "0100.rebuild_detachments_still_restored",
    ]) {
      expect(ids, `${required} did not run`).toContain(required);
    }
    for (const row of results) expect(row.verdict, row.id).toBe("ok");
  });

  it("users.email is unique PER TENANT and no longer globally", async () => {
    // §2 A7, the one finding in the leak table that "blocks the model outright".
    // Asserted behaviourally rather than by reading the DDL, because the DDL is what
    // 0088 already checks and a constraint is only real if it behaves.
    const hash = await env.DB.prepare("SELECT password_hash FROM users LIMIT 1").first<{
      password_hash: string;
    }>();
    await env.DB.prepare(
      "INSERT INTO organizations (id, name, slug) VALUES ('t_fk_probe', 'FK probe', 'fk-probe') " +
        "ON CONFLICT (id) DO NOTHING",
    ).run();
    const insert = (id: string, tenant: string) =>
      env.DB.prepare(
        "INSERT INTO users (id, tenant_id, name, email, role, edition, initials, password_hash) " +
          "VALUES (?, ?, 'FK Probe', 'fk.probe@example.test', 'admin', 'incubator', 'FP', ?)",
      )
        .bind(id, tenant, hash!.password_hash)
        .run();

    await insert("fkp_a", "t_default");
    // The same address, a different customer: this is the whole point of 0087.
    await insert("fkp_b", "t_fk_probe");
    // The same address, the SAME customer: still refused.
    await expect(insert("fkp_c", "t_default")).rejects.toThrow(/UNIQUE constraint failed/);

    await env.DB.prepare("DELETE FROM users WHERE id IN ('fkp_a', 'fkp_b')").run();
    await env.DB.prepare("DELETE FROM organizations WHERE id = 't_fk_probe'").run();
  });
});
