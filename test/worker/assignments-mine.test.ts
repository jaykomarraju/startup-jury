import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";

/**
 * R7-JURY — `GET /api/assignments/mine`.
 *
 * The jury prototype asks three columns for facts `DeckView` does not carry:
 * `panel-jassigned`'s **Due date** and **Assigned by**, and
 * `panel-jurypipeline`'s **Due date**, which its `+/- Days` column is measured
 * against. All three live on `deck_assignments`, one row per (deck, evaluator).
 * Until this route the only reader of that table was
 * `GET /api/assignments/board`, which is `requireRole("program_manager",
 * "program_associate", "admin")` — a juror cannot reach it.
 *
 * The route therefore has to do two things at once, and both are asserted here:
 * give a juror their OWN deadlines, and widen R6-SCOPE by nothing. The second
 * is the one that matters. `deck_assignments` is a whole-edition table; a route
 * over it that forgot to bind the caller would hand every juror the full
 * allocation map — who is scoring what, for every evaluator in the programme —
 * which is exactly the class of leak R6-SCOPE closed on `GET /api/decks`.
 *
 * Negative control: drop `WHERE da.evaluator_id = ?` from the query in
 * `src/server/routes/assignments.ts` and "sees NOT ONE row belonging to another
 * evaluator" fails. Replace the `LEFT JOIN users` with the raw `assigned_by`
 * and "names the person who assigned it" fails.
 *
 * Fixtures are prefixed `am_` and every set assertion is taken over that prefix:
 * worker D1 state persists across tests in this project, so a bare count would
 * be answering about the seed as much as about the route.
 */

const BASE = "https://example.com";
const JURY = "rajesh.kumar@demo.startupjury.ai"; // incubator jury — the caller
const PM = "raj.kumar@demo.startupjury.ai"; // the assigner, and a staff control
const FOUNDER = "meera.sharma@demo.startupjury.ai";

/** The two decks allotted to `inc_jury`, and the one allotted to someone else. */
const MINE = ["am_due", "am_nodue"] as const;
const THEIRS = "am_other";

async function login(email: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo1234" }),
  });
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

interface Assignment {
  deckId: string;
  assignedAt: string;
  dueAt: string | null;
  assignedByName: string | null;
}

async function mine(cookie: string): Promise<{ status: number; rows: Assignment[] }> {
  const res = await SELF.fetch(`${BASE}/api/assignments/mine`, { headers: { cookie } });
  if (res.status !== 200) return { status: res.status, rows: [] };
  const body = (await res.json()) as { assignments: Assignment[] };
  return { status: res.status, rows: body.assignments };
}

/** Only the `am_` fixtures, sorted — never whatever else the seed left behind. */
const fixturesOf = (rows: Assignment[]) => rows.filter((r) => r.deckId.startsWith("am_"));

async function seedDeck(id: string) {
  await env.DB.prepare(
    "INSERT INTO decks (id, edition, name, sector, city, status, ai_score, founder, founder_email, founder_phone, " +
      "r2_key, uploaded_by, assigned_to, complete) " +
      "VALUES (?, 'incubator', ?, 'Fintech', 'Pune', 'jury_evaluation', 7.4, ?, ?, '+91 90000 00000', ?, 'inc_pa', NULL, 1)",
  )
    .bind(id, `Mine ${id}`, `Founder ${id}`, `${id}@mine.example`, `decks/${id}.pdf`)
    .run();
}

async function seedAssignment(deckId: string, evaluatorId: string, dueAt: string | null, assignedBy: string | null) {
  await env.DB.prepare(
    "INSERT OR REPLACE INTO deck_assignments (deck_id, evaluator_id, assigned_by, assigned_at, due_at) " +
      "VALUES (?, ?, ?, '2026-06-01T09:00:00.000Z', ?)",
  )
    .bind(deckId, evaluatorId, assignedBy, dueAt)
    .run();
}

describe("GET /api/assignments/mine — a juror's own deadlines, and nobody else's", () => {
  let jury = "";
  let pm = "";
  let founder = "";

  beforeAll(async () => {
    jury = await login(JURY);
    pm = await login(PM);
    founder = await login(FOUNDER);

    for (const id of [...MINE, THEIRS]) await seedDeck(id);
    // Two of mine: one with a deadline and an assigner, one with neither.
    await seedAssignment("am_due", "inc_jury", "2026-06-08T09:00:00.000Z", "inc_pm");
    await seedAssignment("am_nodue", "inc_jury", null, null);
    // …and one that is emphatically not mine.
    await seedAssignment(THEIRS, "inc_pm", "2026-06-08T09:00:00.000Z", "inc_admin");
  });

  it("returns the caller's own allotment", async () => {
    const { status, rows } = await mine(jury);
    expect(status).toBe(200);
    expect(
      fixturesOf(rows)
        .map((r) => r.deckId)
        .sort(),
    ).toEqual([...MINE].sort());
  });

  // ── The negative control ──────────────────────────────────────────────────
  it("sees NOT ONE row belonging to another evaluator", async () => {
    const { rows } = await mine(jury);
    expect(rows.map((r) => r.deckId)).not.toContain(THEIRS);
    // Stated the other way too, so a future union branch cannot slip past by
    // returning the row under a different id: nothing in the response may be
    // an allotment this juror does not hold.
    const held = await env.DB.prepare("SELECT deck_id FROM deck_assignments WHERE evaluator_id = 'inc_jury'").all<{
      deck_id: string;
    }>();
    const allowed = new Set(held.results.map((r) => r.deck_id));
    expect(rows.filter((r) => !allowed.has(r.deckId))).toEqual([]);
  });

  it("carries the deadline and names the person who assigned it", async () => {
    const { rows } = await mine(jury);
    const row = rows.find((r) => r.deckId === "am_due");
    expect(row).toBeDefined();
    expect(row?.dueAt).toBe("2026-06-08T09:00:00.000Z");
    expect(row?.assignedAt).toBe("2026-06-01T09:00:00.000Z");
    // The join to `users.name`, not the raw `assigned_by` id.
    expect(row?.assignedByName).toBe("Raj Kumar");
  });

  it("a row with no deadline and no assigner comes back as nulls, not as missing", async () => {
    const { rows } = await mine(jury);
    const row = rows.find((r) => r.deckId === "am_nodue");
    // The screen draws a dash for each; it must still get the row, because the
    // row is what tells it the deck is allotted at all.
    expect(row).toBeDefined();
    expect(row?.dueAt).toBeNull();
    expect(row?.assignedByName).toBeNull();
  });

  it("carries no founder contact detail — the route is deadlines, not decks", async () => {
    const { rows } = await mine(jury);
    const text = JSON.stringify(rows);
    expect(text).not.toContain("@mine.example");
    expect(text).not.toContain("+91 90000 00000");
    expect(text).not.toContain("Founder am_due");
  });

  it("every other role gets its own allotment by the same rule, not the whole table", async () => {
    const { status, rows } = await mine(pm);
    expect(status).toBe(200);
    // The PM holds `am_other` and neither of the juror's two.
    expect(
      fixturesOf(rows)
        .map((r) => r.deckId)
        .sort(),
    ).toEqual([THEIRS]);
  });

  it("is behind auth", async () => {
    const res = await SELF.fetch(`${BASE}/api/assignments/mine`);
    expect(res.status).toBe(401);
  });

  it("a founder holds no allotment, and gets an empty list rather than an error", async () => {
    const { status, rows } = await mine(founder);
    expect(status).toBe(200);
    expect(fixturesOf(rows)).toEqual([]);
  });
});
