import { SELF, env } from "cloudflare:test";
import { describe, it, expect, afterEach } from "vitest";
import {
  NEW_PROGRAMME_AI_WEIGHT_PCT,
  decisionScore,
  reweightPreview,
} from "../../src/shared/scoring";

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

// ═══════════════════════════════════════════════════════════════════════════
// V4-WEIGHT — the fix. Visibility, and a default that only reaches new things.
// ═══════════════════════════════════════════════════════════════════════════

interface PreviewDeck {
  id: string;
  name: string;
  aiScore: number | null;
  humanAverage: number | null;
}

async function framework(cookie: string) {
  const r = await SELF.fetch(`${BASE}/api/config/scoring`, { headers: { cookie } });
  return (await r.json()) as {
    scoring: { aiWeightPct: number };
    weightPreview: { decks: PreviewDeck[]; pinnedDecks: number };
  };
}

/** Every deck's blended `decisionScore` exactly as `GET /api/decks` reports it. */
async function decisionScores(cookie: string): Promise<Map<string, number>> {
  const r = await SELF.fetch(`${BASE}/api/decks`, { headers: { cookie } });
  const b = (await r.json()) as { decks: Array<{ id: string; decisionScore?: number }> };
  return new Map(
    b.decks.filter((d) => d.decisionScore !== undefined).map((d) => [d.id, d.decisionScore!]),
  );
}

describe("the console's before/after preview is the real blend, not a lookalike", () => {
  it("prints exactly what `decisionScore` produces at that split, for the same decks", async () => {
    const cookie = await login(ADMIN);
    await setWeight(40);
    const view = await framework(cookie);
    expect(view.scoring.aiWeightPct).toBe(40);
    // The seed has to be able to demonstrate the control at all, or this test
    // proves nothing — the exact shape of the trap §4.1 records.
    expect(view.weightPreview.decks.length).toBeGreaterThan(0);

    // What the console will draw when the operator moves the select to 50.
    const rows = reweightPreview(view.weightPreview.decks, 40, 50);
    expect(rows.length).toBeGreaterThan(0);

    // …against what the rest of the product computes at each of those splits.
    const atForty = await decisionScores(cookie);
    await setWeight(50);
    const atFifty = await decisionScores(cookie);

    for (const row of rows) {
      expect(atForty.get(row.id), `${row.name} at 40%`).toBe(row.from);
      expect(atFifty.get(row.id), `${row.name} at 50%`).toBe(row.to);
    }

    // And the preview is not a flat list of identical numbers: at least one
    // deck moves, which is the whole claim the strip makes on screen.
    expect(rows.some((r) => r.delta !== 0)).toBe(true);
  });

  it("does not hand a founder the split their deck is judged at", async () => {
    // `GET /api/config/scoring` refuses a founder outright, with a stated
    // reason: the framework tells them nothing they should know about how
    // their deck is judged internally. Publishing `aiWeightPct` on their own
    // deck row would route straight around that refusal — the role-boundary
    // leak this repo keeps rediscovering. Negative control in the same test:
    // an admin DOES receive it, so this is not asserting a field that never
    // ships.
    const founder = await login("meera.sharma@demo.startupjury.ai");
    const refused = await SELF.fetch(`${BASE}/api/config/scoring`, {
      headers: { cookie: founder },
    });
    expect(refused.status).toBe(403);

    const mine = await SELF.fetch(`${BASE}/api/decks`, { headers: { cookie: founder } });
    const body = (await mine.json()) as {
      decks: Array<{ id: string; aiWeightPct?: number; aiWeightSource?: string }>;
    };
    expect(body.decks.length).toBeGreaterThan(0);
    for (const d of body.decks) {
      expect(d.aiWeightPct, `${d.id} leaked the split to a founder`).toBeUndefined();
      expect(d.aiWeightSource).toBeUndefined();
    }

    const admin = await login(ADMIN);
    const staff = await SELF.fetch(`${BASE}/api/decks`, { headers: { cookie: admin } });
    const staffBody = (await staff.json()) as { decks: Array<{ aiWeightPct?: number }> };
    expect(staffBody.decks.every((d) => typeof d.aiWeightPct === "number")).toBe(true);
  });

  it("offers only decks this control can actually move", async () => {
    const cookie = await login(ADMIN);
    const view = await framework(cookie);
    // Both halves of the blend, or the split has nothing to weigh.
    for (const d of view.weightPreview.decks) {
      expect(typeof d.aiScore).toBe("number");
      expect(typeof d.humanAverage).toBe("number");
    }
    // Every seeded programme predates 0074, so nothing is pinned yet.
    expect(view.weightPreview.pinnedDecks).toBe(0);
  });
});

describe("50:50 as the default reaches new programmes and cohorts only", () => {
  const made: string[] = [];

  afterEach(async () => {
    for (const id of made.splice(0)) {
      await env.DB.prepare("DELETE FROM cohorts WHERE program_id = ? OR id = ?").bind(id, id).run();
      await env.DB.prepare("DELETE FROM programs WHERE id = ?").bind(id).run();
    }
    await setWeight(40);
  });

  async function createProgramme(cookie: string, name: string): Promise<string> {
    const res = await SELF.fetch(`${BASE}/api/programs`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name }),
    });
    expect(res.status).toBe(200);
    const id = ((await res.json()) as { program: { id: string } }).program.id;
    made.push(id);
    return id;
  }

  it("stamps a new programme with 50 and leaves every existing row exactly as it was", async () => {
    const cookie = await login(ADMIN);
    // His ruling: "previous cohorts will remain same. only the new program or
    // cohorts would take effect." So capture the old rows FIRST and compare
    // them afterwards — an assertion about the new row alone would pass even
    // if creating it had rewritten the others.
    const before = (
      await env.DB.prepare(
        "SELECT id, ai_weight_pct FROM programs WHERE edition = 'incubator' ORDER BY id",
      ).all<{ id: string; ai_weight_pct: number | null }>()
    ).results;
    expect(before.length).toBeGreaterThan(0);
    // Every programme that predates migration 0074 follows the organisation.
    expect(before.every((r) => r.ai_weight_pct === null)).toBe(true);

    const id = await createProgramme(cookie, "V4 Weight Cohort");

    const fresh = await env.DB.prepare("SELECT ai_weight_pct FROM programs WHERE id = ?")
      .bind(id)
      .first<{ ai_weight_pct: number | null }>();
    expect(fresh!.ai_weight_pct).toBe(NEW_PROGRAMME_AI_WEIGHT_PCT);
    expect(NEW_PROGRAMME_AI_WEIGHT_PCT).toBe(50);

    const after = (
      await env.DB.prepare(
        "SELECT id, ai_weight_pct FROM programs WHERE edition = 'incubator' AND id <> ? ORDER BY id",
      )
        .bind(id)
        .all<{ id: string; ai_weight_pct: number | null }>()
    ).results;
    expect(after).toEqual(before);
  });

  it("stamps a new cohort under an OLD programme — the other half of his sentence", async () => {
    const cookie = await login(ADMIN);
    const old = await env.DB.prepare(
      "SELECT id FROM programs WHERE edition = 'incubator' AND ai_weight_pct IS NULL LIMIT 1",
    ).first<{ id: string }>();
    const res = await SELF.fetch(`${BASE}/api/programs/${old!.id}/cohorts`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "V4 Weight Batch" }),
    });
    expect(res.status).toBe(200);
    const cohortId = ((await res.json()) as { cohort: { id: string } }).cohort.id;
    try {
      const row = await env.DB.prepare("SELECT ai_weight_pct FROM cohorts WHERE id = ?")
        .bind(cohortId)
        .first<{ ai_weight_pct: number | null }>();
      expect(row!.ai_weight_pct).toBe(NEW_PROGRAMME_AI_WEIGHT_PCT);
      // The programme it hangs off is untouched: its older cohorts keep
      // following the organisation's split.
      const prog = await env.DB.prepare("SELECT ai_weight_pct FROM programs WHERE id = ?")
        .bind(old!.id)
        .first<{ ai_weight_pct: number | null }>();
      expect(prog!.ai_weight_pct).toBeNull();
    } finally {
      await env.DB.prepare("DELETE FROM cohorts WHERE id = ?").bind(cohortId).run();
    }
  });

  it("holds a deck in a new programme at 50 while the org split sweeps beneath it", async () => {
    const cookie = await login(ADMIN);
    const id = await createProgramme(cookie, "V4 Weight Pinned");

    // A deck that HAS both halves of the blend, so the split can move it.
    const subject = await env.DB.prepare(
      "SELECT d.id AS id, d.program_id AS program_id FROM decks d WHERE d.edition = 'incubator' " +
        "AND d.ai_score IS NOT NULL AND EXISTS (SELECT 1 FROM evaluations e " +
        "  WHERE e.deck_id = d.id AND e.evaluator_id IS NOT NULL AND e.weighted_total IS NOT NULL) LIMIT 1",
    ).first<{ id: string; program_id: string | null }>();
    expect(subject).toBeTruthy();

    await env.DB.prepare("UPDATE decks SET program_id = ? WHERE id = ?").bind(id, subject!.id).run();
    try {
      await setWeight(0);
      const atZero = await decisionScores(cookie);
      await setWeight(50);
      const atFifty = await decisionScores(cookie);

      // Pinned at its programme's 50 — the org control sweeps and it does not
      // move. "previous cohorts will remain same" is the mirror of this.
      expect(atFifty.get(subject!.id)).toBe(atZero.get(subject!.id));

      // …and it is pinned at FIFTY, not merely frozen at whatever it was.
      const halves = await env.DB.prepare(
        "SELECT d.ai_score AS ai, (SELECT AVG(e.weighted_total) FROM evaluations e " +
          "  WHERE e.deck_id = d.id AND e.evaluator_id IS NOT NULL) AS human FROM decks d WHERE d.id = ?",
      )
        .bind(subject!.id)
        .first<{ ai: number | null; human: number | null }>();
      expect(atZero.get(subject!.id)).toBe(
        decisionScore(halves!.ai, halves!.human === null ? [] : [halves!.human], 50),
      );

      // The negative control, in the same run: a deck still following the org
      // DOES move, so the assertion above is about the pin and not about a
      // control that stopped working.
      const others = [...atZero].filter(([deckId]) => deckId !== subject!.id);
      expect(others.some(([deckId, v]) => atFifty.get(deckId) !== v)).toBe(true);
    } finally {
      await env.DB.prepare("UPDATE decks SET program_id = ? WHERE id = ?")
        .bind(subject!.program_id, subject!.id)
        .run();
    }
  });
});

describe("a re-weight never retro-scores a cohort", () => {
  afterEach(async () => {
    await setWeight(40);
  });

  it("saves a split-only change without re-scoring the edition or touching a deck", async () => {
    const cookie = await login(ADMIN);
    await setWeight(40);
    const before = (
      await env.DB.prepare(
        "SELECT id, ai_score, signal, updated_at FROM decks WHERE edition = 'incubator' ORDER BY id",
      ).all<{ id: string; ai_score: number | null; signal: string | null; updated_at: string }>()
    ).results;

    const res = await SELF.fetch(`${BASE}/api/config/scoring-framework`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ aiWeightPct: 50 }),
    });
    expect(res.status).toBe(200);

    // `rescoreEdition` has zero references to `ai_weight_pct` — it recomputed
    // every stored total to the value it already had, reported "N decks
    // re-scored", and bumped `updated_at` across the whole edition, which the
    // V3 Dashboard sorts by. Nothing moved and everything was written.
    expect(((await res.json()) as { rescored: { decks: number } }).rescored.decks).toBe(0);

    const after = (
      await env.DB.prepare(
        "SELECT id, ai_score, signal, updated_at FROM decks WHERE edition = 'incubator' ORDER BY id",
      ).all<{ id: string; ai_score: number | null; signal: string | null; updated_at: string }>()
    ).results;
    expect(after).toEqual(before);

    // The setting itself did save — this is not a test that passes because the
    // write was refused.
    const stored = await env.DB.prepare(
      "SELECT ai_weight_pct FROM org_scoring_settings WHERE edition = 'incubator'",
    ).first<{ ai_weight_pct: number }>();
    expect(stored!.ai_weight_pct).toBe(50);
  });
});
