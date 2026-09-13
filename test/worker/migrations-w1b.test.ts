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

/**
 * The highest number the wave in flight has allotted, from the plan's §10
 * ownership table. Wave 2 was 0038–0040; Wave 3 was 0040–0043; Wave 4 was
 * 0044–0047 (W4-A 0044, W4-B 0045, W4-C 0046, W4-D 0047); Wave 5 was
 * 0048–0049 (W5-A 0048, W5-B 0049); **Wave 6 is 0050–0053** (Wx-PWD 0050,
 * W6-A 0051, W6-C 0052, and W6-B 0053 — unallotted, declared in §9); **Wave 7 is
 * 0054–0059**, one per session in letter order (W7-D 0057, W7-E 0058; the other
 * four needed none); **Wave 8 is 0059–0060** (W8-A 0059, W8-B 0060); **Wave 9 is 0061–0065** (W9-E 0065). Each wave
 * raises this line, and every parallel session in the wave hits it — expect a
 * one-line merge conflict here and take the highest value.
 */
const ALLOTMENT_CEILING = 65;

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
