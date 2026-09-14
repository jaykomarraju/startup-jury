import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";

/**
 * Wave 9 integration — issue 21 on the three incubator reports.
 *
 * `W9-D` closed "lower guys must not be able to view the evaluators' scores up
 * in the hierarchy" on `/scoring` (both editions) and left a §9 row saying the
 * same hole was open on `/cohort`, `/evaluators` and `/drift`, which are the
 * incubator's and so were not its files. The incubator ladder is
 * program_associate 1 · jury 2 · program_manager 3 · admin 99, so a programme
 * associate must see neither a juror's nor a PM's evaluation — not listed by
 * name on `/evaluators`, and not folded into a mean on `/cohort` or `/drift`.
 *
 * These tests read only; nothing is written, so nothing needs undoing.
 */

const BASE = "https://example.com";
const ADMIN = "nisha.kapoor@demo.startupjury.ai"; // incubator admin, rank 99
const PA = "sunita.rao@demo.startupjury.ai"; // program_associate, rank 1

async function login(email: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo1234" }),
  });
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

async function get<T>(path: string, email: string): Promise<{ status: number; body: T }> {
  const res = await SELF.fetch(`${BASE}/api/analytics/${path}`, { headers: { cookie: await login(email) } });
  return { status: res.status, body: (await res.json()) as T };
}

interface Evaluators {
  evaluators: Array<{ evaluatorId: string; name: string; role: string; decksScored: number }>;
  deckEvaluations: number;
}
interface Drift {
  rows: Array<{ deckId: string; name: string; aiScore: number; humanScore: number; drift: number }>;
}
interface Cohort {
  avgScore: number;
}

/** Who actually holds an evaluation on this seed, by role — the test's premise. */
async function evaluatorRoles(): Promise<Record<string, number>> {
  const rows = (
    await env.DB.prepare(
      "SELECT u.role AS role, COUNT(*) AS n FROM evaluations e " +
        "JOIN decks d ON d.id = e.deck_id JOIN users u ON u.id = e.evaluator_id " +
        "WHERE d.edition = 'incubator' AND e.evaluator_id IS NOT NULL AND e.weighted_total IS NOT NULL " +
        "GROUP BY u.role",
    ).all<{ role: string; n: number }>()
  ).results;
  return Object.fromEntries(rows.map((r) => [r.role, r.n]));
}

describe("issue 21 — the three incubator reports honour the evaluation hierarchy", () => {
  it("the seed actually contains evaluations above a programme associate", async () => {
    // Without this the three assertions below could pass vacuously.
    const byRole = await evaluatorRoles();
    const above = (byRole.jury ?? 0) + (byRole.program_manager ?? 0);
    expect(above).toBeGreaterThan(0);
  });

  it("/evaluators never names an evaluator ranked above the viewer", async () => {
    const admin = (await get<Evaluators>("evaluators", ADMIN)).body;
    const pa = (await get<Evaluators>("evaluators", PA)).body;

    expect(admin.evaluators.some((r) => r.role === "jury" || r.role === "program_manager")).toBe(true);
    expect(pa.evaluators.some((r) => r.role === "jury" || r.role === "program_manager")).toBe(false);
    expect(pa.evaluators.length).toBeLessThan(admin.evaluators.length);
  });

  it("/drift's human mean holds only the associate's own evaluation, not the jury's and PM's", async () => {
    const admin = (await get<Drift>("drift", ADMIN)).body;
    const pa = (await get<Drift>("drift", PA)).body;

    // Every seeded incubator deck carries a program_associate evaluation, so the
    // ROW SET is identical for both viewers — only the mean behind each row moves.
    // Asserting row counts here would pass with the filter removed, which is the
    // whole reason this test pins the number instead.
    const deck = "GreenGrid Energy"; // scored by admin, jury, PM and the associate
    const a = admin.rows.find((r) => r.name === deck)!;
    const p = pa.rows.find((r) => r.name === deck)!;
    expect(a).toBeDefined();
    expect(p).toBeDefined();

    // The associate's own evaluation, straight from the row the report read.
    const own = (
      await env.DB.prepare(
        "SELECT e.weighted_total AS wt FROM evaluations e JOIN decks d ON d.id = e.deck_id " +
          "JOIN users u ON u.id = e.evaluator_id " +
          "WHERE d.name = ? AND d.edition = 'incubator' AND u.role = 'program_associate'",
      )
        .bind(deck)
        .first<{ wt: number }>()
    )!.wt;

    expect(p.humanScore).toBe(Math.round(own * 10) / 10);
    expect(p.humanScore).not.toBe(a.humanScore); // the leak, were it open
    expect(p.drift).toBe(Math.round((own - p.aiScore) * 10) / 10);
  });

  it("/cohort's average score moves with what the viewer may see", async () => {
    const admin = (await get<Cohort>("cohort", ADMIN)).body;
    const pa = await get<Cohort>("cohort", PA);
    expect(pa.status).toBe(200);
    expect(pa.body.avgScore).not.toBe(admin.avgScore);
  });

  it("the role gate still answers first — a founder gets 403 on all three", async () => {
    const FOUNDER = "meera.sharma@demo.startupjury.ai";
    for (const path of ["cohort", "evaluators", "drift"]) {
      expect((await get(path, FOUNDER)).status).toBe(403);
    }
  });
});
