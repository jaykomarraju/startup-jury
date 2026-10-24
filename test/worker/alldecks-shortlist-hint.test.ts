import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { applyShortlistCriteria, type ShortlistCriteriaOutcome } from "../../src/server/routes/pipeline";

// W7-A — the All-decks / Evaluate shortlist hint must say what the SYSTEM will
// do with the deck.
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
// RE-POINTED 23-Oct (tracker row 4, "no manual shortlisting"). The third party
// to the agreement was the manual transition, and no role may shortlist by hand
// any more — `POST …/transition {"action":"shortlist"}` is a 403 for everyone,
// asserted in `shortlist-criteria.test.ts`. What decides now is
// `applyShortlistCriteria`, which applies the SAME floor check the transition
// did (`checkShortlistFloor`), so the property this file guards is unchanged and
// only its third witness moved: the number on screen is the number the criteria
// judge, and the hint agrees with what they do — in both directions, at a split
// that is not the default. Each seed carries its juror's evaluation, so the
// panel is complete and the criteria actually decide rather than wait.
//
// NB storage is isolated per FILE, so the org split this file sets does not
// leak into any other suite.

const BASE = "https://example.com";
const SUPER = "priya.sharma@demo.startupjury.ai"; // incubator superuser
const SCOPE = { tenantId: "t_default", edition: "incubator" } as const;

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
  opts: { ai: number | null; human: number | null; floor: number | null; nullTotal?: boolean },
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
  if (opts.human !== null || opts.nullTotal) {
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

/** Apply the criteria to this one deck, as the last juror's submit does. */
async function criteria(id: string): Promise<ShortlistCriteriaOutcome> {
  const outcome = await applyShortlistCriteria(env.DB, SCOPE, { id, edition: "incubator", status: "jury_evaluation" });
  expect(outcome, `the criteria apply to ${id}`).not.toBeNull();
  return outcome!;
}

async function statusOf(id: string): Promise<string> {
  return (await env.DB.prepare("SELECT status FROM decks WHERE id = ?").bind(id).first<{ status: string }>())!.status;
}

describe("shortlist hint agrees with the shortlist criteria at a NON-default split (W7-A)", () => {
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
    it(`${id}: the list, the detail and the criteria all say ${expected}`, async () => {
      await seed(id, { ai, human, floor });
      const cookie = await login(SUPER);

      const listed = await hintFromList(cookie, id);
      const detail = await hintFromDetail(cookie, id);
      // The number on screen is the number the floor is applied to.
      expect(listed.decisionScore).toBe(score);
      expect(detail.decisionScore).toBe(score);
      expect(listed.shortlistBlocked).toBe(expected === "blocked");
      expect(detail.shortlistBlocked).toBe(expected === "blocked");

      // …and the criteria agree with the hint, in both directions, on the same number.
      const outcome = await criteria(id);
      expect(outcome.score).toBe(score);
      if (expected === "blocked") {
        expect(outcome).toMatchObject({ shortlisted: false, reason: "below_floor" });
        expect(await statusOf(id)).toBe("jury_evaluation");
      } else {
        expect(outcome.shortlisted).toBe(true);
        expect(await statusOf(id)).toBe("shortlisted");
      }
    });
  }

  // RE-POINTED 23-Oct, and this one is a deliberate DISAGREEMENT, pinned so it
  // stays visible. The transition waved an unscored deck through the org
  // threshold ("the org threshold is a score bar, and there is no score"), and
  // the hint (`routes/decks.ts`, not this session's file) still says so. The
  // criteria do not: the system never shortlists a deck with no score under any
  // floor. With no manual shortlist left for the hint to describe, the hint's
  // reading is a transition-era artefact; `docs/parity-requests/A-P4.md` asks the
  // owner of `decks.ts` to align it. A complete panel with no score at all is a
  // juror row whose total is NULL — legacy seeds carry those.
  it("an unscored deck is shortlisted under neither floor — where the hint still reads the transition's rule", async () => {
    await seed("hint_unscored_prog", { ai: null, human: null, floor: 5, nullTotal: true });
    await seed("hint_unscored_org", { ai: null, human: null, floor: null, nullTotal: true });
    const cookie = await login(SUPER);

    expect((await hintFromList(cookie, "hint_unscored_prog")).shortlistBlocked).toBe(true);
    expect(await criteria("hint_unscored_prog")).toMatchObject({ shortlisted: false, reason: "unscored" });
    expect(await statusOf("hint_unscored_prog")).toBe("jury_evaluation");

    expect((await hintFromList(cookie, "hint_unscored_org")).shortlistBlocked).toBe(false);
    expect(await criteria("hint_unscored_org")).toMatchObject({ shortlisted: false, reason: "unscored" });
    expect(await statusOf("hint_unscored_org")).toBe("jury_evaluation");
  });
});
