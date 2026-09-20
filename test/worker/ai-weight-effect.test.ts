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
  it("the re-score it triggers is not a function of the weight — 0% and 50% store the same", async () => {
    const cookie = await login(ADMIN);

    // Save at 0% AI ("jury only"), snapshot every stored score...
    let res = await SELF.fetch(`${BASE}/api/config/scoring-framework`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ aiWeightPct: 0 }),
    });
    expect(res.status).toBe(200);
    const atZero = await storedScores();

    // ...then at 50/50, the split the client asked to standardise on.
    res = await SELF.fetch(`${BASE}/api/config/scoring-framework`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ aiWeightPct: 50 }),
    });
    expect(res.status).toBe(200);
    const atFifty = await storedScores();

    // A re-score DOES run (composition changed) and it does move stored values
    // slightly — it recomputes roll-ups from per-parameter scores. But it reads
    // `compositeFormula` only; `rescoreEdition` references `ai_weight_pct` ZERO
    // times. So the two extremes of this control store identical numbers.
    expect(atFifty).toEqual(atZero);
  });

  it("and the number a user reads on the deck list does not move either", async () => {
    const cookie = await login(ADMIN);

    await setWeight(0); // "0% (jury only)" — one end of the offered range
    const juryOnly = (await (await SELF.fetch(`${BASE}/api/decks`, { headers: { cookie } })).json()) as {
      decks: Array<{ id: string; aiScore: number | null; humanAverage?: number | null }>;
    };

    await setWeight(50);
    const fifty = (await (await SELF.fetch(`${BASE}/api/decks`, { headers: { cookie } })).json()) as {
      decks: Array<{ id: string; aiScore: number | null; humanAverage?: number | null }>;
    };

    // Same decks, same AI score, same human average at 0% and at 50% AI.
    const shape = (d: { id: string; aiScore: number | null; humanAverage?: number | null }) =>
      `${d.id}:${d.aiScore}:${d.humanAverage ?? null}`;
    expect(fifty.decks.map(shape)).toEqual(juryOnly.decks.map(shape));
  });
});
