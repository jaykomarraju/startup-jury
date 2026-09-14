import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeAll, afterEach } from "vitest";

/**
 * W8-A data patch (`docs/parity-requests/W8-A-report-data.patch`) — the three
 * report routes whose PAYLOAD had to change for the screens to say what the
 * prototype says, in a file `W8-A` did not own:
 *   /cohort     ranks on the final human score (F0797) and counts "In
 *               clarification" from unanswered founder queries (F0798);
 *   /my/decks   is the juror's ASSIGNED decks with a submitted / pending state,
 *               AI score (blind-scoring aware), sector and date (F0820–F0824);
 *   /my/scores  carries the sector line (F0870).
 * Fixtures are inserted here, with unique ids, so nothing depends on how many
 * decks the seed happens to hold.
 */

const BASE = "https://example.com";
const ADMIN = "nisha.kapoor@demo.startupjury.ai";
const JURY = "rajesh.kumar@demo.startupjury.ai";

async function login(email: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo1234" }),
  });
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

const get = (p: string, c: string) => SELF.fetch(`${BASE}${p}`, { headers: { cookie: c } });

async function userId(email: string): Promise<string> {
  return (await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>())!.id;
}

async function deck(id: string, name: string, status: string, ai: number | null, sector = "AgriTech"): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO decks (id, edition, name, status, r2_key, uploaded_by, founder, founder_email, founder_phone, city, sector, complete, ai_score) " +
      "VALUES (?, 'incubator', ?, ?, ?, 'inc_founder', 'Ada Founder', 'ada@w8a.example', '+91 98450 11111', 'Bengaluru', ?, 1, ?)",
  )
    .bind(id, name, status, `decks/${id}.pdf`, sector, ai)
    .run();
}

async function evaluation(deckId: string, evaluatorId: string, total: number): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, verdict, remarks, submitted_at) VALUES (?, ?, ?, ?, 'scored', NULL, '2026-06-09T10:00:00Z')",
  )
    .bind(`${deckId}_${evaluatorId}`, deckId, evaluatorId, total)
    .run();
}

async function assign(deckId: string, evaluatorId: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO deck_assignments (deck_id, evaluator_id, assigned_by, assigned_at, due_at) VALUES (?, ?, NULL, '2026-06-01T00:00:00Z', NULL)",
  )
    .bind(deckId, evaluatorId)
    .run();
}

let juryId = "";

beforeAll(async () => {
  juryId = await userId(JURY);
  const adminId = await userId(ADMIN);

  // A deck the AI scored low and two humans scored high: its final is 9.9.
  await deck("w8a_final", "W8A Final", "shortlisted", 5.0);
  await evaluation("w8a_final", juryId, 9.9);
  await evaluation("w8a_final", adminId, 9.9);

  // An intake-flagged deck with NO query, and a scored deck WITH an open query.
  await deck("w8a_intake", "W8A Intake", "manual_review", 6.0);
  await deck("w8a_query", "W8A Query", "ai_evaluated", 6.0);
  await env.DB.prepare(
    "INSERT INTO queries (id, deck_id, questions, email_status) VALUES ('w8a_q1', 'w8a_query', '[]', 'sent')",
  ).run();

  // Assigned to the juror, not yet scored — pending. And one that left the jury stage unscored.
  await deck("w8a_pending", "W8A Pending", "assigned", 7.3, "Insurtech");
  await assign("w8a_pending", juryId);
  await deck("w8a_gone", "W8A Gone", "rejected", 4.0);
  await assign("w8a_gone", juryId);
});

afterEach(async () => {
  await env.DB.prepare("UPDATE org_scoring_settings SET show_ai_score_to_jury = 1 WHERE edition = 'incubator'").run();
});

describe("GET /api/analytics/cohort (data patch)", () => {
  it("ranks on the final human score and counts open founder queries as In clarification", async () => {
    const res = await get("/api/analytics/cohort", await login(ADMIN));
    expect(res.status).toBe(200);
    const d = (await res.json()) as {
      inClarification: number;
      ranking: Array<{ id: string; score: number }>;
      window: { from: string; to: string } | null;
      finalScored: number;
    };
    expect(d.ranking[0]).toMatchObject({ id: "w8a_final", score: 9.9 });
    expect(d.finalScored).toBeGreaterThan(0);
    expect(d.window).not.toBeNull();

    const open = await env.DB.prepare(
      "SELECT COUNT(DISTINCT q.deck_id) AS n FROM queries q JOIN decks d ON d.id = q.deck_id " +
        "WHERE d.edition = 'incubator' AND q.email_status != 'answered'",
    ).first<{ n: number }>();
    expect(d.inClarification).toBe(open!.n);
  });

  it("is staff-only: the jury member is forbidden", async () => {
    expect((await get("/api/analytics/cohort", await login(JURY))).status).toBe(403);
  });
});

describe("GET /api/analytics/my/decks (data patch)", () => {
  interface Body {
    assigned: number;
    submitted: number;
    draft: number;
    pending: number;
    rows: Array<{ id: string; sector: string | null; ai: number | null; mine: number | null; state: string; submittedAt: string | null }>;
  }

  it("lists assigned decks with the juror's own state, sector, AI score and date", async () => {
    const res = await get("/api/analytics/my/decks", await login(JURY));
    expect(res.status).toBe(200);
    const d = (await res.json()) as Body;
    const pending = d.rows.find((r) => r.id === "w8a_pending")!;
    expect(pending).toMatchObject({ state: "pending", sector: "Insurtech", ai: 7.3, mine: null, submittedAt: null });
    const done = d.rows.find((r) => r.id === "w8a_final")!;
    expect(done).toMatchObject({ state: "submitted", mine: 9.9, submittedAt: "2026-06-09T10:00:00Z" });
    // Left the jury stage without the juror's score: not waiting on them.
    expect(d.rows.some((r) => r.id === "w8a_gone")).toBe(false);
    expect(d.pending).toBeGreaterThan(0);
    expect(d.draft).toBe(0);
    expect(d.assigned).toBe(d.submitted + d.draft + d.pending);
  });

  it("blind scoring withholds the AI score on a deck the juror has not scored, and only there", async () => {
    await env.DB.prepare("UPDATE org_scoring_settings SET show_ai_score_to_jury = 0 WHERE edition = 'incubator'").run();
    const d = (await (await get("/api/analytics/my/decks", await login(JURY))).json()) as Body;
    expect(d.rows.find((r) => r.id === "w8a_pending")!.ai).toBeNull();
    expect(d.rows.find((r) => r.id === "w8a_final")!.ai).toBe(5);
  });

  it("is exclusive to the jury member: admin is forbidden", async () => {
    expect((await get("/api/analytics/my/decks", await login(ADMIN))).status).toBe(403);
  });
});

describe("GET /api/analytics/my/scores (data patch)", () => {
  it("carries each deck's sector", async () => {
    const d = (await (await get("/api/analytics/my/scores", await login(JURY))).json()) as {
      rows: Array<{ id: string; sector: string | null }>;
    };
    expect(d.rows.find((r) => r.id === "w8a_final")!.sector).toBe("AgriTech");
  });

  it("is exclusive to the jury member: admin is forbidden", async () => {
    expect((await get("/api/analytics/my/scores", await login(ADMIN))).status).toBe(403);
  });
});
