import { SELF, env } from "cloudflare:test";
import { describe, it, expect, afterEach } from "vitest";

/**
 * V3-REP — `GET /api/decks/:id/report`, item 1.
 *
 * Two things this route has to keep doing for the v3 report to be drawable:
 *
 *  1. **The role gate.** Every role that evaluates gets the report; a founder
 *     never does. The overlay is opened from seven screens, so this is the only
 *     place the answer can be enforced.
 *  2. **`core` is the PARAMETER SET, not the score set.** v3 adds `opts.hideAi`
 *     — the report a deck gets before the AI has run — and it still draws all
 *     thirteen rows, with the AI cells empty. That is only possible because the
 *     route lists every active core parameter whether or not anyone scored it.
 *     A route that started returning only scored parameters would empty the
 *     table and no screen test would notice.
 *
 * The stage mechanism itself (`?stage=`, `reportLayout`) is W7-D's and is
 * pinned by `evaluate-w7d.test.ts`; V3 leaves it alone pending Q1 (plan §4).
 */

const BASE = "https://example.com";
const SUPER = "priya.sharma@demo.startupjury.ai";
const PM = "raj.kumar@demo.startupjury.ai";
const PA = "sunita.rao@demo.startupjury.ai";
const JURY = "rajesh.kumar@demo.startupjury.ai";
const ADMIN = "nisha.kapoor@demo.startupjury.ai";
const FOUNDER = "meera.sharma@demo.startupjury.ai";

/** A deck the AI has evaluated, and one it has not. */
const EVALUATED = "inc_deck_greenroute";
const UNEVALUATED = "inc_deck_meera_incomplete";

const cookies = new Map<string, string>();
async function login(email: string): Promise<string> {
  const hit = cookies.get(email);
  if (hit) return hit;
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo1234" }),
  });
  expect(res.status, `login ${email}`).toBe(200);
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
  cookies.set(email, cookie);
  return cookie;
}

const get = async (path: string, email: string) =>
  SELF.fetch(`${BASE}${path}`, { headers: { cookie: await login(email) } });

interface Report {
  core: { key: string; name: string; weight: number; cells: Record<string, { value: number }> }[];
  columns: { id: string; kind: string }[];
}

async function report(deckId: string, email: string): Promise<Report> {
  const res = await get(`/api/decks/${deckId}/report`, email);
  expect(res.status, `${email} → ${deckId}`).toBe(200);
  return (await res.json()) as Report;
}

describe("GET /api/decks/:id/report — who may open the evaluation report", () => {
  it.each([
    ["superuser", SUPER],
    ["admin", ADMIN],
    ["program manager", PM],
    ["program associate", PA],
    ["jury member", JURY],
  ])("%s gets the report", async (_label, email) => {
    expect((await get(`/api/decks/${EVALUATED}/report`, email)).status).toBe(200);
  });

  it("a founder is refused — 403, not an empty report", async () => {
    const res = await get(`/api/decks/${EVALUATED}/report`, FOUNDER);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });

  it("a deck outside the caller's edition is 404, not someone else's report", async () => {
    // A VC deck id, asked for on an incubator session.
    expect((await get("/api/decks/vc_deck_finstack/report", SUPER)).status).toBe(404);
    expect((await get("/api/decks/nope/report", SUPER)).status).toBe(404);
  });
});

describe("core carries every parameter, scored or not — v3's hideAi report", () => {
  it("an un-evaluated deck still returns the full core set, with no AI cells", async () => {
    const r = await report(UNEVALUATED, SUPER);
    expect(r.core.length).toBeGreaterThan(0);
    // Every row is a real parameter — name and weight — and none has an AI score.
    for (const row of r.core) {
      expect(row.name, `${row.key} has a name`).toBeTruthy();
      expect(typeof row.weight).toBe("number");
    }
    expect(r.core.some((row) => row.cells.ai !== undefined)).toBe(false);
  });

  it("an evaluated deck returns the SAME parameters, now with AI cells", async () => {
    const before = await report(UNEVALUATED, SUPER);
    const after = await report(EVALUATED, SUPER);
    // The negative control for the assertion above: same rows, AI cells present.
    expect(after.core.map((r) => r.key)).toEqual(before.core.map((r) => r.key));
    expect(after.core.some((row) => row.cells.ai !== undefined)).toBe(true);
  });
});

// ── Blind scoring (F0106) — the AI column, on the route that was missing it ──
//
// `GET /api/decks/:id` withholds the AI score from an evaluator who has not
// submitted, and Wave 2 integration closed the same hole on the LIST route.
// The REPORT route was never given the rule, and it is the widest opening of
// the three: seven screens render the report, and it carried every AI
// per-parameter score AND its rationale.
//
// The `role-boundary-leaks` rule for this repo: enforce on the SERVER and
// assert on the RESPONSE PAYLOAD, never by not-rendering. The pair below is the
// negative control in the test itself — the same juror, the same deck, the
// toggle on and off, and the row COUNT moves, not just a mean.

async function setBlind(on: boolean): Promise<void> {
  await env.DB.prepare(
    "UPDATE org_scoring_settings SET show_ai_score_to_jury = ? WHERE edition = 'incubator'",
  )
    .bind(on ? 0 : 1)
    .run();
}

/** A deck this juror has NOT submitted an evaluation for, which the AI HAS scored. */
const UNSUBMITTED = "inc_deck_solarc";

afterEach(async () => {
  await setBlind(false);
});

describe("blind scoring withholds the AI column from the report too", () => {
  it("a juror who has not submitted gets NO AI cells and is told why", async () => {
    await setBlind(true);
    const res = await get(`/api/decks/${UNSUBMITTED}/report`, JURY);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Report & { aiScoreWithheld?: boolean };

    expect(body.aiScoreWithheld).toBe(true);
    expect(body.columns.some((c) => c.kind === "ai")).toBe(false);
    // The payload, not the render: not one cell, and no rationale either.
    expect(body.core.filter((row) => row.cells.ai !== undefined)).toHaveLength(0);
    expect(JSON.stringify(body)).not.toContain("The problem is asserted rather than evidenced");
    // The parameters themselves still come through — the table keeps its shape.
    expect(body.core.length).toBeGreaterThan(0);
  });

  it("the SAME juror and deck DO carry the AI column with the toggle on", async () => {
    await setBlind(false);
    const body = (await report(UNSUBMITTED, JURY)) as Report & { aiScoreWithheld?: boolean };
    expect(body.aiScoreWithheld).toBeUndefined();
    expect(body.columns.some((c) => c.kind === "ai")).toBe(true);
    expect(body.core.filter((row) => row.cells.ai !== undefined).length).toBe(body.core.length);
  });

  it("does not touch a role that oversees rather than scores", async () => {
    await setBlind(true);
    const body = (await report(UNSUBMITTED, SUPER)) as Report & { aiScoreWithheld?: boolean };
    expect(body.aiScoreWithheld).toBeUndefined();
    expect(body.columns.some((c) => c.kind === "ai")).toBe(true);
    expect(body.core.filter((row) => row.cells.ai !== undefined).length).toBe(body.core.length);
  });
});
