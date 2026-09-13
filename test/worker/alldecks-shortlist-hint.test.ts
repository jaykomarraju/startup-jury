import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";

// W7-A — the All-decks / Evaluate shortlist hint must say what the transition
// will do.
//
// Wave 2 integration §9: `toDeckView` computed `decisionScore` with the default
// 50/50 split (third argument omitted) while `POST /decks/:id/transition`
// blends at the org's configured `ai_weight_pct`. It also compared against the
// programme floor only, where the transition falls back to the org-wide
// shortlist threshold. So a deck could render as shortlistable and then be
// refused. Every case below is chosen so that the DEFAULT split and the
// CONFIGURED split disagree — which is exactly what the old test suite never
// exercised, because it only ever ran at the shipped default.
//
// NB storage is isolated per FILE, so the org split this file sets does not
// leak into any other suite.

const BASE = "https://example.com";
const SUPER = "priya.sharma@demo.startupjury.ai"; // incubator superuser

async function login(email: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo1234" }),
  });
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

interface HintView {
  id: string;
  decisionScore?: number;
  shortlistBlocked?: boolean;
}

async function seed(
  id: string,
  opts: { ai: number | null; human: number | null; floor: number | null },
): Promise<void> {
  const programId = `prog_${id}`;
  await env.DB.prepare(
    "INSERT INTO programs (id, edition, name, shortlist_min, active, sort_order) VALUES (?, 'incubator', ?, ?, 1, 99)",
  )
    .bind(programId, `Hint ${id}`, opts.floor)
    .run();
  await env.DB.prepare(
    "INSERT INTO decks (id, edition, name, status, ai_score, program_id, assigned_to, uploaded_by, complete) " +
      "VALUES (?, 'incubator', ?, 'jury_evaluation', ?, ?, 'inc_jury', 'inc_pa', 1)",
  )
    .bind(id, `Hint ${id}`, opts.ai, programId)
    .run();
  if (opts.human !== null) {
    await env.DB.prepare(
      "INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, verdict) VALUES (?, ?, 'inc_jury', ?, 'scored')",
    )
      .bind(`ev_${id}`, id, opts.human)
      .run();
  }
}

async function hintFromList(cookie: string, id: string): Promise<HintView> {
  const body = (await (await SELF.fetch(`${BASE}/api/decks`, { headers: { cookie } })).json()) as {
    decks: HintView[];
  };
  const deck = body.decks.find((d) => d.id === id);
  expect(deck, `${id} is in GET /api/decks`).toBeDefined();
  return deck!;
}

async function hintFromDetail(cookie: string, id: string): Promise<HintView> {
  const body = (await (await SELF.fetch(`${BASE}/api/decks/${id}`, { headers: { cookie } })).json()) as {
    deck: HintView;
  };
  return body.deck;
}

async function shortlist(cookie: string, id: string): Promise<{ status: number; score?: number }> {
  const res = await SELF.fetch(`${BASE}/api/decks/${id}/transition`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ action: "shortlist" }),
  });
  const body = (await res.json().catch(() => ({}))) as { score?: number };
  return { status: res.status, score: body.score };
}

describe("shortlist hint agrees with the transition at a NON-default split (W7-A)", () => {
  beforeAll(async () => {
    // 30 % AI · 70 % jury — neither the function default (50) nor the shipped
    // default (40), so an implementation leaning on either one is caught.
    await env.DB.prepare(
      "UPDATE org_scoring_settings SET ai_weight_pct = 30, shortlist_threshold = 7.0 WHERE edition = 'incubator'",
    ).run();
  });

  // [id, ai, human, programme floor, what the configured split decides]
  //   50/50 → (9 + 5) / 2 = 7.00  clears a 7.0 floor
  //   30/70 → 2.7 + 3.5  = 6.20  does NOT
  //   50/50 → (5 + 8.5) / 2 = 6.75  blocked by a 7.0 floor
  //   30/70 → 1.5 + 5.95 = 7.45  clears it
  //   no programme floor → the org threshold (7.0) applies, same arithmetic
  const cases: [string, number, number, number | null, "blocked" | "allowed", number][] = [
    ["hint_ai_heavy", 9, 5, 7, "blocked", 6.2],
    ["hint_jury_heavy", 5, 8.5, 7, "allowed", 7.45],
    ["hint_org_floor_blocked", 9, 5, null, "blocked", 6.2],
    ["hint_org_floor_allowed", 5, 8.5, null, "allowed", 7.45],
  ];

  for (const [id, ai, human, floor, expected, score] of cases) {
    it(`${id}: the list, the detail and the transition all say ${expected}`, async () => {
      await seed(id, { ai, human, floor });
      const cookie = await login(SUPER);

      const listed = await hintFromList(cookie, id);
      const detail = await hintFromDetail(cookie, id);
      // The number on screen is the number the floor is applied to.
      expect(listed.decisionScore).toBe(score);
      expect(detail.decisionScore).toBe(score);
      expect(listed.shortlistBlocked).toBe(expected === "blocked");
      expect(detail.shortlistBlocked).toBe(expected === "blocked");

      // …and the transition agrees with the hint, in both directions.
      const res = await shortlist(cookie, id);
      if (expected === "blocked") {
        expect(res.status).toBe(409);
        expect(res.score).toBe(score);
      } else {
        expect(res.status).toBe(200);
      }
    });
  }

  it("an unscored deck is blocked by a programme floor but not by the org threshold — as enforced", async () => {
    await seed("hint_unscored_prog", { ai: null, human: null, floor: 5 });
    await seed("hint_unscored_org", { ai: null, human: null, floor: null });
    const cookie = await login(SUPER);

    expect((await hintFromList(cookie, "hint_unscored_prog")).shortlistBlocked).toBe(true);
    expect((await shortlist(cookie, "hint_unscored_prog")).status).toBe(409);

    expect((await hintFromList(cookie, "hint_unscored_org")).shortlistBlocked).toBe(false);
    expect((await shortlist(cookie, "hint_unscored_org")).status).toBe(200);
  });
});
