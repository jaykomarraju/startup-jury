import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";

/**
 * W7-D — at the route level:
 *
 *   1. the evaluation report is stage-aware (incubator spec §8.4 / §13
 *      `GET /decks/:id/report?stage=assign|intro`): the right role sections per
 *      originating screen, the jury section READ-ONLY where the spec says so,
 *      and no stage ever widening what the hierarchy lets a viewer see;
 *   2. the Evaluate screen's per-deck recommendation store (0057);
 *   3. the scale boundary (§9): enforced canonical, explained on the org's scale;
 *   4. `/parameters` carries the question bank and scorer-facing description.
 *
 * Storage is isolated per FILE, not per test: fixtures use unique ids and every
 * test that changes org settings puts them back.
 */

const BASE = "https://example.com";
const SUPER = "priya.sharma@demo.startupjury.ai";
const PM = "raj.kumar@demo.startupjury.ai";
const PA = "sunita.rao@demo.startupjury.ai";
const JURY = "rajesh.kumar@demo.startupjury.ai";
const FOUNDER = "meera.sharma@demo.startupjury.ai";
const VC_ANALYST = "rhea.nair@demo.startupjury.ai";

async function login(email: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo1234" }),
  });
  const setCookie = res.headers.get("set-cookie");
  return setCookie ? setCookie.split(";")[0] : "";
}

const get = (p: string, c: string) => SELF.fetch(`${BASE}${p}`, { headers: { cookie: c } });
const send = (method: string, p: string, c: string, body?: unknown) =>
  SELF.fetch(`${BASE}${p}`, {
    method,
    headers: { cookie: c, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

interface Report {
  stage: string;
  stageAware: boolean;
  columns: { id: string; kind: string; role?: string }[];
  additional: { role: string; mode: string; readOnly: boolean; rows: { key: string }[] }[];
  hiddenEvaluators: number;
}

async function report(cookie: string, stage?: string, deckId = "inc_deck_greenroute"): Promise<Report> {
  const q = stage === undefined ? "" : `?stage=${stage}`;
  const res = await get(`/api/decks/${deckId}/report${q}`, cookie);
  expect(res.status).toBe(200);
  return (await res.json()) as Report;
}

const shape = (r: Report) => r.additional.map((g) => `${g.role}:${g.mode}`);

async function setScoring(patch: Record<string, number | string>): Promise<void> {
  const cols = Object.keys(patch);
  await env.DB.prepare(
    `UPDATE org_scoring_settings SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE edition = 'incubator'`,
  )
    .bind(...cols.map((c) => patch[c]))
    .run();
}

beforeEach(async () => {
  await setScoring({
    score_scale: "0-10",
    override_rationale_delta: 2,
    require_override_rationale: 1,
    shortlist_threshold: 7,
    jury_sees_peer_scores: 0,
  });
});

// ── 1 · §8.4 — the stage-aware report ────────────────────────────────────────

describe("GET /api/decks/:id/report?stage= — spec §8.4", () => {
  it("Assign → Program associate + Program manager, and no jury section at all", async () => {
    const r = await report(await login(PM), "assign");
    expect(r.stage).toBe("assign");
    expect(r.stageAware).toBe(true);
    expect(shape(r)).toEqual(["program_associate:read_only", "program_manager:editable"]);
    expect(r.additional.some((g) => g.role === "jury")).toBe(false);
    expect(r.additional.every((g) => g.rows.length === 3)).toBe(true);
  });

  it("Intro calls → PA + PM + Jury, with the jury section read-only 'completed'", async () => {
    const r = await report(await login(PM), "intro");
    expect(shape(r)).toEqual([
      "program_associate:read_only",
      "program_manager:editable",
      "jury:completed",
    ]);
    const jury = r.additional.find((g) => g.role === "jury")!;
    expect(jury.readOnly).toBe(true);
    expect(jury.rows).toHaveLength(3);
  });

  it("anywhere else is single-role: only the viewer's own section, editable", async () => {
    expect(shape(await report(await login(PA)))).toEqual(["program_associate:editable"]);
    expect(shape(await report(await login(PM)))).toEqual(["program_manager:editable"]);
    // An unrecognised stage is the default, never an error and never a widening.
    expect(shape(await report(await login(PM), "signup"))).toEqual(["program_manager:editable"]);
  });

  it("the Jury file: Assigned adds a PA reference; Intro calls adds PA + PM; the jury's own stay editable", async () => {
    const jury = await login(JURY);
    const assign = await report(jury, "assign");
    expect(shape(assign)).toEqual(["program_associate:read_only", "jury:editable"]);
    const intro = await report(jury, "intro");
    expect(shape(intro)).toEqual(["program_associate:read_only", "program_manager:read_only", "jury:editable"]);
    expect(shape(await report(jury))).toEqual(["jury:editable"]);
    // …and the two screens a juror opens it from genuinely differ.
    expect(shape(assign)).not.toEqual(shape(intro));
  });

  it("an overseer keeps every role as reference by default, and the jury is read-only for them at Intro", async () => {
    const su = await login(SUPER);
    expect(shape(await report(su))).toEqual([
      "program_associate:read_only",
      "program_manager:read_only",
      "jury:read_only",
    ]);
    const intro = await report(su, "intro");
    expect(intro.additional.every((g) => g.readOnly)).toBe(true);
    expect(shape(intro).at(-1)).toBe("jury:completed");
  });

  it("a stage only ever removes sections — the columns a viewer may see do not move", async () => {
    const pa = await login(PA);
    const plain = await report(pa);
    for (const stage of ["assign", "intro"]) {
      const staged = await report(pa, stage);
      expect(staged.columns.map((c) => c.id)).toEqual(plain.columns.map((c) => c.id));
      expect(staged.hiddenEvaluators).toBe(plain.hiddenEvaluators);
    }
  });

  it("stays closed to founders whatever the stage", async () => {
    const founder = await login(FOUNDER);
    expect((await get("/api/decks/inc_deck_greenroute/report?stage=intro", founder)).status).toBe(403);
  });
});

// ── 2 · the Evaluate screen's recommendation store ───────────────────────────

async function seedDeck(
  id: string,
  opts: { status: string; assignedTo?: string | null; aiScore?: number | null; edition?: string },
) {
  await env.DB.prepare(
    "INSERT INTO decks (id, edition, name, status, assigned_to, ai_score, uploaded_by, founder, founder_email, founder_phone, city, sector, complete) " +
      "VALUES (?, ?, 'W7D Co', ?, ?, ?, 'inc_founder', 'Ada', 'ada@w7d.example', '+91 98450 11111', 'Pune', 'B2B SaaS', 1)",
  )
    .bind(id, opts.edition ?? "incubator", opts.status, opts.assignedTo ?? null, opts.aiScore ?? null)
    .run();
}

describe("PUT /api/decks/:id/recommendation + GET /api/recommendations", () => {
  it("records a juror's recommendation on their own deck and returns it, with their evaluated decks", async () => {
    await seedDeck("w7d_rec_mine", { status: "assigned", assignedTo: "inc_jury" });
    await seedDeck("w7d_rec_scored", { status: "jury_evaluation", assignedTo: "inc_jury" });
    await env.DB.prepare(
      "INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, verdict) VALUES ('w7d_ev', 'w7d_rec_scored', 'inc_jury', 6.5, 'scored')",
    ).run();

    const jury = await login(JURY);
    const res = await send("PUT", "/api/decks/w7d_rec_mine/recommendation", jury, { status: "hold" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deckId: "w7d_rec_mine", status: "hold" });

    // Choosing again replaces — one row per evaluator per deck.
    expect((await send("PUT", "/api/decks/w7d_rec_mine/recommendation", jury, { status: "shortlist" })).status).toBe(200);
    const rows = await env.DB.prepare(
      "SELECT status FROM evaluation_recommendations WHERE deck_id = 'w7d_rec_mine' AND user_id = 'inc_jury'",
    ).all<{ status: string }>();
    expect(rows.results).toEqual([{ status: "shortlist" }]);

    const list = (await (await get("/api/recommendations", jury)).json()) as {
      recommendations: Record<string, string>;
      evaluated: string[];
    };
    expect(list.recommendations.w7d_rec_mine).toBe("shortlist");
    expect(list.evaluated).toContain("w7d_rec_scored");
    expect(list.evaluated).not.toContain("w7d_rec_mine");
  });

  it("moves nothing — a 'Shortlist' recommendation is not a shortlist", async () => {
    await seedDeck("w7d_rec_nomove", { status: "jury_evaluation", assignedTo: "inc_jury", aiScore: 9 });
    const jury = await login(JURY);
    expect((await send("PUT", "/api/decks/w7d_rec_nomove/recommendation", jury, { status: "shortlist" })).status).toBe(200);
    const deck = await env.DB.prepare("SELECT status FROM decks WHERE id = 'w7d_rec_nomove'").first<{ status: string }>();
    expect(deck!.status).toBe("jury_evaluation");
  });

  it("is private to the evaluator — another user's list does not carry it", async () => {
    await seedDeck("w7d_rec_private", { status: "assigned", assignedTo: "inc_jury" });
    await send("PUT", "/api/decks/w7d_rec_private/recommendation", await login(JURY), { status: "reject" });
    const pm = (await (await get("/api/recommendations", await login(PM))).json()) as {
      recommendations: Record<string, string>;
    };
    expect(pm.recommendations.w7d_rec_private).toBeUndefined();
  });

  it("refuses a juror on a deck that is not theirs, a bad status, a founder, and another edition", async () => {
    await seedDeck("w7d_rec_theirs", { status: "assigned", assignedTo: "inc_pa" });
    const jury = await login(JURY);
    expect((await send("PUT", "/api/decks/w7d_rec_theirs/recommendation", jury, { status: "hold" })).status).toBe(403);
    // Staff may recommend on any deck in the edition.
    expect((await send("PUT", "/api/decks/w7d_rec_theirs/recommendation", await login(PM), { status: "hold" })).status).toBe(200);

    await seedDeck("w7d_rec_bad", { status: "assigned", assignedTo: "inc_jury" });
    const bad = await send("PUT", "/api/decks/w7d_rec_bad/recommendation", jury, { status: "invest" });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe("invalid_status");

    const founder = await login(FOUNDER);
    expect((await send("PUT", "/api/decks/w7d_rec_bad/recommendation", founder, { status: "hold" })).status).toBe(403);
    expect((await get("/api/recommendations", founder)).status).toBe(403);

    // A VC analyst is not an incubator evaluator.
    const vc = await login(VC_ANALYST);
    expect((await send("PUT", "/api/decks/w7d_rec_bad/recommendation", vc, { status: "hold" })).status).toBe(403);
  });

  it("requires a session", async () => {
    expect((await SELF.fetch(`${BASE}/api/recommendations`)).status).toBe(401);
  });
});

// ── 3 · §9 (c) — the scale boundary on the wire ──────────────────────────────

async function paramId(key: string): Promise<string> {
  const row = await env.DB.prepare("SELECT id FROM parameters WHERE edition = 'incubator' AND key = ?")
    .bind(key)
    .first<{ id: string }>();
  return row!.id;
}

async function coreKeys(): Promise<string[]> {
  return (
    await env.DB.prepare(
      "SELECT key FROM parameters WHERE edition = 'incubator' AND active = 1 AND informational = 0 ORDER BY sort_order",
    ).all<{ key: string }>()
  ).results.map((r) => r.key);
}

describe("override delta and shortlist threshold — enforced canonical, explained on the org's scale", () => {
  async function seedOverride(id: string) {
    await seedDeck(id, { status: "assigned", assignedTo: "inc_jury", aiScore: 9 });
    const [first] = await coreKeys();
    await env.DB.prepare(
      "INSERT INTO scores (id, deck_id, evaluator_id, evaluator_kind, parameter_id, value, comment, created_at) VALUES (?, ?, NULL, 'ai', ?, 9, NULL, '2026-09-12')",
    )
      .bind(`${id}_ai`, id, await paramId(first))
      .run();
    return first;
  }

  it("on 0–10 nothing changes: 'more than 2 points', delta 2", async () => {
    const key = await seedOverride("w7d_delta_010");
    const res = await send("POST", "/api/decks/w7d_delta_010/evaluate", await login(JURY), {
      scores: [{ key, value: 3 }],
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; delta: number; deltaDisplay: number; message: string };
    expect(body.error).toBe("rationale_required");
    expect(body.delta).toBe(2);
    expect(body.deltaDisplay).toBe(2);
    expect(body.message).toBe("Explain any score more than 2 points from the AI's.");
  });

  it("on 1–5 the sentence speaks the org's points (0.8), while `delta` stays canonical", async () => {
    const key = await seedOverride("w7d_delta_15");
    await setScoring({ score_scale: "1-5" });
    // Typed 1 on 1–5 = canonical 0, against an AI 9: far beyond the delta.
    const res = await send("POST", "/api/decks/w7d_delta_15/evaluate", await login(JURY), {
      scores: [{ key, value: 1 }],
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { delta: number; deltaDisplay: number; message: string };
    expect(body.delta).toBe(2);
    expect(body.deltaDisplay).toBe(0.8);
    expect(body.message).toBe("Explain any score more than 0.8 points from the AI's.");
  });

  it("a 1–5 admin's '1 point' (stored 2.5) is what a 1–5 juror is held to", async () => {
    const key = await seedOverride("w7d_delta_admin");
    await setScoring({ score_scale: "1-5", override_rationale_delta: 2.5 });
    const jury = await login(JURY);
    // AI 9 canonical is 4.6 on 1–5. A juror typing 3.5 is 1.1 of the org's points away → refused.
    const far = await send("POST", "/api/decks/w7d_delta_admin/evaluate", jury, { scores: [{ key, value: 3.5 }] });
    expect(far.status).toBe(400);
    expect(((await far.json()) as { message: string }).message).toContain("more than 1 point from");
    // Typing 4 is 0.6 away → inside the admin's 1 point → accepted.
    const near = await send("POST", "/api/decks/w7d_delta_admin/evaluate", jury, { scores: [{ key, value: 4 }] });
    expect(near.status).toBe(200);
  });

  it("the shortlist refusal quotes the threshold on the org's scale; the numbers on the wire stay canonical", async () => {
    await seedDeck("w7d_floor_010", { status: "jury_evaluation", assignedTo: "inc_jury", aiScore: 1 });
    await seedDeck("w7d_floor_15", { status: "jury_evaluation", assignedTo: "inc_jury", aiScore: 1 });
    const jury = await login(JURY);

    const ten = await send("POST", "/api/decks/w7d_floor_010/transition", jury, { action: "shortlist" });
    expect(ten.status).toBe(409);
    const tenBody = (await ten.json()) as { minimum: number; score: number; message: string };
    expect(tenBody.message).toBe(
      "Below the organisation's shortlist threshold — at least 7.0 is required, this deck scores 1.00.",
    );

    await setScoring({ score_scale: "1-5" });
    const five = await send("POST", "/api/decks/w7d_floor_15/transition", jury, { action: "shortlist" });
    expect(five.status).toBe(409);
    const fiveBody = (await five.json()) as { minimum: number; score: number; message: string };
    expect(fiveBody.minimum).toBe(7);
    expect(fiveBody.score).toBe(1);
    expect(fiveBody.message).toBe(
      "Below the organisation's shortlist threshold — at least 3.8 is required, this deck scores 1.4.",
    );
  });
});

// ── 4 · the parameter detail's data ──────────────────────────────────────────

describe("GET /api/parameters — the Evaluate detail panel's data", () => {
  it("carries each core area's clarification questions, and the additional parameters' descriptions", async () => {
    const body = (await (await get("/api/parameters", await login(JURY))).json()) as {
      parameters: { key: string; name: string; informational: boolean; questions: string[]; description?: string }[];
    };
    const core = body.parameters.filter((p) => !p.informational);
    expect(core).toHaveLength(13);
    for (const p of core) expect(p.questions.length, p.name).toBeGreaterThanOrEqual(5);
    // Climate Impact & Integrity is the one area with eight (0028).
    expect(Math.max(...core.map((p) => p.questions.length))).toBe(8);
    const barriers = body.parameters.find((p) => p.name === "Barriers of entry");
    expect(barriers?.description).toMatch(/Defensibility/);
  });
});
