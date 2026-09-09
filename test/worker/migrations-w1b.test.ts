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

/** The block this session added; everything in it must stay together. */
const FIRST = 25;
const LAST = 37;
const BLOCK_SIZE = LAST - FIRST + 1;

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
  it("is unique and contiguous from 0001", () => {
    const numbers = MIGRATIONS.map((m) => numberOf(m.name)).sort((a, b) => a - b);
    expect(new Set(numbers).size, "duplicate migration number").toBe(numbers.length);
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
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
