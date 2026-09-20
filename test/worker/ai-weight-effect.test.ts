import { SELF, env } from "cloudflare:test";
import { describe, it, expect, afterEach } from "vitest";

/**
 * The client's report, 2026-09-20: "nothing was changing when I changed from
 * 40:60 or 50:50 or any other option, I saw no difference."
 *
 * He asked for the AI-weight options to be HIDDEN. That was a workaround for a
 * defect, not a design request — so this measures what `ai_weight_pct` actually
 * moves before anything is hidden or defaulted.
 */

const BASE = "https://example.com";
const ADMIN = "nisha.kapoor@demo.startupjury.ai";

async function login(email: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo1234" }),
  });
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

async function setWeight(pct: number): Promise<void> {
  await env.DB.prepare("UPDATE org_scoring_settings SET ai_weight_pct = ? WHERE edition = 'incubator'")
    .bind(pct)
    .run();
}

/** Every stored number a deck's score could come from. */
async function storedScores(): Promise<Array<{ id: string; ai: number | null; human: number | null }>> {
  const rows = (
    await env.DB.prepare(
      "SELECT d.id AS id, d.ai_score AS ai, " +
        "(SELECT AVG(e.weighted_total) FROM evaluations e WHERE e.deck_id = d.id AND e.evaluator_id IS NOT NULL) AS human " +
        "FROM decks d WHERE d.edition = 'incubator' ORDER BY d.id",
    ).all<{ id: string; ai: number | null; human: number | null }>()
  ).results;
  return rows;
}

afterEach(async () => {
  await setWeight(40); // migrations/0026 default
});

describe("ai_weight_pct — what it actually moves", () => {
  it("does NOT move any STORED score — and that is correct, not the defect", async () => {
    const cookie = await login(ADMIN);
    let res = await SELF.fetch(`${BASE}/api/config/scoring-framework`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ aiWeightPct: 0 }),
    });
    expect(res.status).toBe(200);
    const atZero = await storedScores();

    res = await SELF.fetch(`${BASE}/api/config/scoring-framework`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ aiWeightPct: 50 }),
    });
    expect(res.status).toBe(200);
    const atFifty = await storedScores();

    // The weight blends AI with human at READ time; it is not baked into either
    // stored number. `rescoreEdition` reads `compositeFormula` only (0 refs to
    // `ai_weight_pct`), which is right — re-weighting must not rewrite history.
    expect(atFifty).toEqual(atZero);
  });

  it("DOES move the blended decisionScore — but by ~0.1, which is why nobody sees it", async () => {
    const cookie = await login(ADMIN);
    const decisions = async () => {
      const r = await SELF.fetch(`${BASE}/api/decks`, { headers: { cookie } });
      const b = (await r.json()) as { decks: Array<{ id: string; decisionScore?: number }> };
      return new Map(
        b.decks.filter((d) => d.decisionScore !== undefined).map((d) => [d.id, d.decisionScore!]),
      );
    };

    await setWeight(0);
    const zero = await decisions();
    await setWeight(50);
    const fifty = await decisions();

    // It is WIRED: at least one deck's blended score changes.
    const moved = [...zero].filter(([id, v]) => fifty.get(id) !== v);
    expect(moved.length).toBeGreaterThan(0);

    // And this is the client's report, quantified: on real data the AI and jury
    // scores sit close together, so the whole 0%->50% sweep moves the number by
    // a rounding-sized amount. Measured on the seed: 7.95 -> 7.88, 8.75 -> 8.73.
    const biggest = Math.max(...moved.map(([id, v]) => Math.abs(fifty.get(id)! - v)));
    expect(biggest).toBeLessThan(0.5);

    // The defect is therefore VISIBILITY, not wiring: `decisionScore` is drawn
    // as "Avg. score" on the Shortlisted / Stage / Calls screens and NOT in the
    // Dashboard's default column set, so the screen an admin is most likely to
    // be looking at while changing this setting never shows the number it moves.
  });
});
